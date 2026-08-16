-- =====================================================================
-- OTJ Training Hub, migration 0049_spond_team_reconcile: one transactional,
-- capability gated RPC that makes a child's CURRENT SEASON team assignment
-- agree with Spond, optionally confirming the Spond member link in the same
-- transaction.
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand through the gated
-- workflow after line by line review, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge. No Edge Function
-- deploy accompanies this migration; the spond-link-members change in the
-- same pull request is its own separate, gated step.
--
-- Numbering: 0049. The files on disk end at
-- 0048_spond_session_link_unique.sql and the live hosted ledger's newest row
-- is 20260812102912 / spond_session_link_unique, read 16 August 2026. Per
-- the standing rule the ledger is the authority; confirm 0049 is still free
-- against it immediately before applying.
--
-- WHAT THIS ADDS. One function, public.spond_reconcile_player_team. Nothing
-- else. It adds NO table, NO column, NO index, NO policy, NO grant on any
-- table, NO capability key, NO trigger, and NO value to any vocabulary,
-- including audit_events.source and player_spond_links.matched_by. Every
-- write it performs is a write the caller could already perform by hand
-- through the existing screens; what it adds is that the two halves happen
-- together or not at all, under one identity rule, with one concurrency
-- guard.
--
-- WHY AN RPC AT ALL, given the caller could do both writes. Three reasons,
-- and the first is the only one that is about safety:
--
--   1. THE IDENTITY RULE BECOMES A DATABASE RULE. "Never move a child on a
--      name match" is enforced here rather than in a screen: the function
--      refuses to touch a registration for a player who has no
--      player_spond_links row, and the only way to acquire one in the same
--      breath is to pass the member id a human confirmed. A client that
--      forgot the rule cannot move anybody by forgetting it.
--   2. ATOMICITY. Confirming an identity and acting on it are one decision.
--      Two client calls can leave a link created and the move failed, which
--      is a child bound to a Spond member for a move that never happened,
--      or the reverse.
--   3. CONCURRENCY. Two managers pressing at once are serialised by a per
--      (club, player) advisory lock and a FOR UPDATE row lock, and the
--      second one is told the row moved rather than silently overwriting
--      what the first decided.
--
-- WHAT IT IS NOT, and these are the load bearing negatives:
--
--   * IT IS NOT A PRIVILEGE. It self gates on players.manage, exactly the
--     capability the player_spond_links insert policy and the
--     player_registrations update policy already name, so it grants no
--     caller any authority they did not already hold. It is SECURITY
--     DEFINER, so RLS does not bind it and the in body checks ARE the
--     enforcement; they fail closed.
--   * IT NEVER TOUCHES ANOTHER SEASON. The season is the club's current
--     season, derived server side from seasons.is_current. The caller
--     cannot name a season, so a historic or archived registration is not
--     addressable through this path at all. Season history is untouched by
--     construction rather than by care.
--   * IT NEVER CREATES A PLAYER IDENTITY. There is no insert into
--     public.players in this file. A child who is not registered this
--     season is refused, never invented, so this path cannot produce the
--     duplicate identity that the roster import's cross team guard exists
--     to prevent.
--   * IT NEVER REMOVES OR REPOINTS A LINK. There is no delete and no update
--     of player_spond_links (the table has neither an update policy nor an
--     update grant, and this function adds neither). A member already bound
--     to a different child, or a child already bound to a different member,
--     is REFUSED with a named outcome. Correcting a wrong link stays what it
--     was: an explicit unlink then link on the linking screen, both audited.
--   * IT NEVER WRITES TO SPOND. It makes no network call of any kind. It
--     receives one opaque member id that a human confirmed in the browser
--     and stores it in the one column that has always held one.
--   * IT NEVER TOUCHES THE REGISTER. register_entries, sessions,
--     session_teams, spond_events and spond_event_responses are not read,
--     written or referenced. A saved night's attendance, inclusion and bibs
--     are facts about that night and do not move when a team assignment
--     does.
--   * IT VALIDATES NO SPOND STATE, because it cannot. Which subgroup a
--     member sits in is live Spond data this app deliberately never
--     persists (docs/security/spond-data-boundary.md), so the destination
--     necessarily arrives from the client that read it. That is not a
--     widening: the destination is re validated to be a team of the caller's
--     club, and moving a child to any team of their club is something a
--     players.manage holder can already do directly through
--     player_registrations. This function narrows that ability (it refuses
--     an unlinked child; a direct update does not); it does not extend it.
--
-- AUDIT. Deliberately no new writer and no new vocabulary. The existing
-- triggers are the record and both already fire:
--   * audit_registrations emits player.team_changed with safe old and new
--     team ids and no name (0032).
--   * audit_player_spond_links emits player.spond_linked, carrying the fact
--     and never the member id (0045).
-- Both ride audit_batch_context, so this function stamps the run's batch id
-- and one press leaves one batch. audit_source_context is left alone, which
-- means source records 'manual': a signed in person pressed a button, which
-- is exactly what that value means. Adding a 'spond_reconcile' source would
-- be a change to the audit_events.source CHECK, an audit boundary change,
-- for a label the paired events already imply.
--
-- CHILD DATA. The function reads and writes no name. Its only text argument
-- is an opaque member id, constrained by the same character class the
-- column enforces, so a name, an email address or a phone number cannot be
-- passed to it. No guardian, contact, comment or payload fragment exists
-- anywhere in this file.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0048 form): SECURITY DEFINER with
-- set search_path = '' and fully schema qualified references; EXECUTE
-- granted to authenticated and revoked from public and anon; the migration
-- self verifies before it commits.
-- =====================================================================

-- ONE transaction, as 0041 through 0048 are, so a failed assertion at the
-- end rolls the function creation back rather than leaving it live.
begin;

-- ---------------------------------------------------------------------
-- The BEFORE fingerprint, taken here rather than inside the verification
-- block, because a fingerprint read after the change and compared with
-- itself asserts nothing. 0048's review made exactly this point about its
-- own session fingerprints and it applies to a migration that claims to
-- change no data even more directly: the whole claim is a comparison across
-- the DDL, so one side of it has to be read before the DDL runs.
--
-- ON COMMIT DROP, so it exists for this transaction only and a rollback or
-- a commit both leave nothing behind.
-- ---------------------------------------------------------------------
create temporary table _0049_before on commit drop as
select
  (select count(*) from public.player_registrations)                          as regs,
  (select count(*) from public.player_registrations where team_id is not null) as regs_teamed,
  (select count(*) from public.player_spond_links)                            as links,
  (select count(*) from public.register_entries)                              as entries,
  (select count(*) from public.spond_event_responses)                         as responses,
  (select count(*) from public.audit_events)                                  as audit_rows,
  (select count(*) from pg_policies
     where schemaname = 'public'
       and tablename in ('player_registrations', 'players', 'player_spond_links', 'register_entries'))
                                                                              as policies,
  (select coalesce(string_agg(grantee || ':' || table_name || ':' || privilege_type, ','
                              order by grantee, table_name, privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('player_registrations', 'players', 'player_spond_links', 'register_entries')
      and grantee in ('anon', 'authenticated', 'service_role'))               as grants,
  (select coalesce(string_agg(tgname, ',' order by tgname), '')
     from pg_trigger
    where tgrelid in ('public.player_registrations'::regclass,
                      'public.players'::regclass,
                      'public.player_spond_links'::regclass)
      and not tgisinternal)                                                   as triggers;

-- ---------------------------------------------------------------------
-- spond_reconcile_player_team
--
-- Signature:
--   spond_reconcile_player_team(
--     p_player_id        uuid,
--     p_expected_team_id uuid,   -- what the screen showed; null = Unassigned
--     p_target_team_id   uuid,   -- Spond's answer; null = Unassigned
--     p_spond_member_id  text,   -- null on the proved path; the member a
--                                -- human confirmed on the confirm path
--     p_batch_id         uuid    -- audit grouping key for one press
--   ) returns jsonb
--
-- Outcomes, returned rather than raised, because each is a normal thing for
-- a manager to be told and a bulk caller has to be able to report them per
-- row:
--   moved                    the registration's team changed
--   already_matched          it was already on the target; nothing written
--   stale                    it is on neither the expected nor the target
--                            team, so somebody else moved it; nothing written
--   no_registration          this player has no current season registration
--   not_linked               no member id was supplied and the player has no
--                            link, so there is no proved identity to move on
--   member_linked_elsewhere  that Spond member is already bound to a
--                            different child
--   player_linked_elsewhere  this child is already bound to a different
--                            Spond member
--
-- Raised (the whole call fails and nothing is written): not signed in, no
-- players.manage, a target team outside the caller's club, a malformed
-- member id, no current season.
-- ---------------------------------------------------------------------
create or replace function public.spond_reconcile_player_team(
  p_player_id        uuid,
  p_expected_team_id uuid,
  p_target_team_id   uuid,
  p_spond_member_id  text default null,
  p_batch_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_club         uuid := public.my_club();
  v_season       uuid;
  v_member       text;
  v_reg          public.player_registrations;
  v_member_owner uuid;
  v_player_member text;
  v_link_created boolean := false;
  v_outcome      text;
begin
  -- ============ Caller and capability (raise 42501) ========================
  -- Re checked in the body because SECURITY DEFINER is not bound by RLS.
  -- players.manage is the capability BOTH halves of this operation already
  -- require: player_spond_links_insert names it, and
  -- player_registrations_update_manage names it. One gate, no new key.
  if v_actor is null or v_club is null then
    raise exception 'spond_reconcile_player_team: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('players.manage') then
    raise exception 'spond_reconcile_player_team: requires the players.manage capability'
      using errcode = '42501';
  end if;

  -- ============ The destination must be a team of the caller's club ========
  -- Null is Unassigned and is always allowed: player_registrations.team_id is
  -- nullable precisely so a registered child can belong to no team.
  if p_target_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_target_team_id and t.club_id = v_club
  ) then
    raise exception 'spond_reconcile_player_team: the destination team is not in your club'
      using errcode = '42501';
  end if;

  -- ============ The member id, when one is supplied ========================
  -- Normalised and checked HERE as well as by the column, so a malformed id
  -- fails before any lock is taken and before anything is written. The class
  -- is the boundary, not a nicety: it admits no space, no '@', no '+', no
  -- '.' and no lowercase letter, so a name, an email address and a phone
  -- number cannot be passed to this function at all.
  if p_spond_member_id is not null then
    v_member := upper(btrim(p_spond_member_id));
    if v_member !~ '^[0-9A-F]{16,64}$' then
      raise exception 'spond_reconcile_player_team: that is not a Spond member id'
        using errcode = 'P0001';
    end if;
  end if;

  -- ============ The season is the club's CURRENT season, server side =======
  -- The caller cannot name a season. This is what makes "historic
  -- registrations are never touched" a property of the signature rather
  -- than of the caller's care. seasons_one_current_per_club makes the
  -- select single valued.
  select s.id into v_season from public.seasons s
    where s.club_id = v_club and s.is_current;
  if v_season is null then
    raise exception 'spond_reconcile_player_team: the club has no current season'
      using errcode = 'P0001';
  end if;

  -- ============ Serialise two managers acting on the SAME child ============
  -- Taken before any read, so the whole decision (read the registration,
  -- read the links, write both) is one critical section per child. It
  -- releases at commit. The row locks below are what protect against a
  -- caller that is not this function; this is what makes two calls of this
  -- function on one child strictly ordered rather than interleaved.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('otj.spond_reconcile:' || v_club::text || ':' || p_player_id::text)
  );

  -- ============ The current season registration, locked ====================
  -- FOR UPDATE, so a concurrent direct update of the same row through
  -- player_registrations waits rather than racing. Club scoped, so a forged
  -- or cross club player id finds nothing and is refused rather than
  -- reaching another club's data.
  select r.* into v_reg
    from public.player_registrations r
    where r.player_id = p_player_id and r.season_id = v_season and r.club_id = v_club
    for update;
  if not found then
    -- No identity is created here, ever. A child who is not registered this
    -- season is a roster question, answered on the players page.
    return jsonb_build_object(
      'outcome', 'no_registration', 'player_id', p_player_id, 'season_id', v_season,
      'from_team_id', null, 'to_team_id', p_target_team_id, 'linked', false, 'link_created', false
    );
  end if;

  -- ============ The optimistic check, BEFORE anything is written ===========
  -- The screen sent the team it was showing. If the row is on neither that
  -- team nor the destination, somebody moved this child while the manager
  -- was reading, and applying a decision taken against the old state would
  -- silently overwrite theirs. Landing ON the destination is not staleness:
  -- it is the idempotent case below, which is what makes a double press, a
  -- retry and two managers agreeing all safe.
  if v_reg.team_id is distinct from p_expected_team_id
     and v_reg.team_id is distinct from p_target_team_id then
    return jsonb_build_object(
      'outcome', 'stale', 'player_id', p_player_id, 'season_id', v_season,
      'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
      'linked', false, 'link_created', false
    );
  end if;

  -- ============ The identity half ==========================================
  -- Every link row this decision could touch is locked in ONE statement,
  -- ordered by the member id, so the two ways this can race (somebody else
  -- binding the same member, or binding this child to another member) block
  -- rather than producing a duplicate key the caller has to interpret.
  --
  -- The ORDER BY is the load bearing part, and it is a deadlock fix rather
  -- than tidiness. Two rows can be involved: the row holding the member being
  -- confirmed, and the row holding this child's existing link. Locking them in
  -- two separate statements takes them in CALLER order, so a call binding
  -- member X to a child already linked to member Y, racing a call binding Y to
  -- a child already linked to X, takes the same two rows in opposite orders
  -- and can deadlock. Both of those calls are refusals, so the deadlock would
  -- be safe rather than corrupting, but a canonical lock order costs one
  -- statement and removes it. The per (club, player) advisory lock above does
  -- not cover this: those two calls are about two different children.
  perform l.spond_member_id
    from public.player_spond_links l
    where l.club_id = v_club
      and (l.spond_member_id = v_member or l.player_id = p_player_id)
    order by l.spond_member_id
    for update;

  -- Read back from the rows now held. No FOR UPDATE here: the lock is taken
  -- above and taking it twice would put the ordering back in caller hands.
  select l.player_id into v_member_owner
    from public.player_spond_links l
    where l.club_id = v_club and l.spond_member_id = v_member;

  select l.spond_member_id into v_player_member
    from public.player_spond_links l
    where l.club_id = v_club and l.player_id = p_player_id;

  if v_member is null then
    -- THE PROVED PATH. No member id was supplied, so this child must already
    -- carry a link. This single check is the whole identity rule: without a
    -- durable binding there is nothing but a name, and a name is not an
    -- identity. A client that forgot the rule cannot move anybody by
    -- forgetting it.
    if v_player_member is null then
      return jsonb_build_object(
        'outcome', 'not_linked', 'player_id', p_player_id, 'season_id', v_season,
        'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
        'linked', false, 'link_created', false
      );
    end if;
  else
    -- THE CONFIRM PATH. A human confirmed which Spond member this child is.
    -- Nothing existing is repointed: a contested member and a child who is
    -- already bound elsewhere are both refusals, so an existing link is
    -- preserved by every branch here.
    if v_member_owner is not null and v_member_owner <> p_player_id then
      return jsonb_build_object(
        'outcome', 'member_linked_elsewhere', 'player_id', p_player_id, 'season_id', v_season,
        'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
        'linked', false, 'link_created', false
      );
    end if;
    if v_player_member is not null and v_player_member <> v_member then
      return jsonb_build_object(
        'outcome', 'player_linked_elsewhere', 'player_id', p_player_id, 'season_id', v_season,
        'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
        'linked', false, 'link_created', false
      );
    end if;
    if v_player_member is null then
      -- The batch stamp goes on before the insert so the link event and the
      -- move event below carry the same batch id: one press, one batch.
      if p_batch_id is not null then
        perform set_config('otj.audit_batch', p_batch_id::text, true);
      end if;
      -- matched_by is 'suggested', which is exactly what this is and what
      -- that value has always meant: a name suggestion computed in the
      -- browser that a manager accepted. There is no 'auto' in the
      -- vocabulary and this migration does not add one, because no server
      -- side name matcher exists here either. club_id and player_id are
      -- server derived; created_by and created_at are stamped by
      -- player_spond_links_touch, not by this function and not by the
      -- caller.
      insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
        values (v_club, v_member, p_player_id, 'suggested');
      v_link_created := true;
    end if;
  end if;

  -- ============ The move ===================================================
  if p_batch_id is not null then
    perform set_config('otj.audit_batch', p_batch_id::text, true);
  end if;

  if v_reg.team_id is not distinct from p_target_team_id then
    -- Already there. No update statement runs at all, so no audit event is
    -- written for a change that did not happen, and a double press or a
    -- retry is a genuine no-op rather than a second identical event.
    v_outcome := 'already_matched';
  else
    -- ONE column. status, shirt_number, registered_date, season_id and every
    -- provenance column are untouched, so a pending child stays pending and
    -- a shirt number survives a team move. registrations_touch stamps
    -- updated_by and updated_at; registrations_guard_archived refuses this
    -- if the current season were ever archived; audit_registrations emits
    -- player.team_changed with the old and new team ids.
    update public.player_registrations r
      set team_id = p_target_team_id
      where r.id = v_reg.id;
    v_outcome := 'moved';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'player_id', p_player_id,
    'season_id', v_season,
    'from_team_id', v_reg.team_id,
    'to_team_id', p_target_team_id,
    'linked', true,
    'link_created', v_link_created
  );
end;
$$;

comment on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid) is
  $$Makes one child's CURRENT SEASON team assignment agree with Spond, optionally confirming the Spond member link in the same transaction (0049_spond_team_reconcile.sql). SECURITY DEFINER, self gates on players.manage, derives club, actor and the current season server side, and re validates the destination team belongs to the club. THE IDENTITY RULE IS ENFORCED HERE: a player with no player_spond_links row cannot be moved by this function at all, and the only way to move one is to supply the opaque member id a human confirmed, which is inserted in the same transaction. Never creates a player identity, never deletes or repoints a link (a contested member and an already bound child are named refusals), never names a season (so no historic or archived registration is addressable), never touches register_entries, sessions or any Spond mirror table, and never contacts Spond. Concurrency safe: a per (club, player) advisory lock plus FOR UPDATE on the registration and both link reads, with an optimistic expected-team check that refuses a row somebody else moved and treats a row already on the destination as an idempotent no-op. Audited by the existing triggers only (player.team_changed from 0032, player.spond_linked from 0045), sharing the caller's batch id; adds no audit source value. See docs/security/spond-data-boundary.md.$$;

revoke execute on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Same transaction as the creation above, so any failure
-- rolls the whole release back and leaves the database exactly as it was.
--
-- It proves what this migration CHANGED, and it proves what it did not.
-- The second half is the load bearing one and follows 0047 and 0048: a
-- migration that adds a function must be shown to have moved no row, no
-- policy, no grant and no trigger, rather than merely asserting that its
-- function exists.
-- ---------------------------------------------------------------------
do $$
declare
  b      _0049_before;
  v_src  text;
begin
  select * into b from _0049_before;
  if not found then
    raise exception 'spond_team_reconcile: the before fingerprint is missing, so nothing can be compared';
  end if;

  -- ---- What the function is -------------------------------------------
  if to_regprocedure('public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)') is null then
    raise exception 'spond_team_reconcile: the function was not created';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'spond_reconcile_player_team') then
    raise exception 'spond_team_reconcile: the function must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spond_reconcile_player_team'
       and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'spond_team_reconcile: the function must set search_path to empty';
  end if;
  if not has_function_privilege('authenticated',
        'public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)', 'EXECUTE') then
    raise exception 'spond_team_reconcile: authenticated cannot execute the function';
  end if;
  if has_function_privilege('anon',
        'public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)', 'EXECUTE') then
    raise exception 'spond_team_reconcile: anon must not execute the function';
  end if;
  -- Exactly one overload, so a stale signature cannot be reached instead.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'spond_reconcile_player_team') <> 1 then
    raise exception 'spond_team_reconcile: more than one overload of the function exists';
  end if;

  -- ---- What the function's own SOURCE may not contain -------------------
  -- These read the stored definition, so they hold against what will
  -- actually run rather than against the file this was reviewed from. Each
  -- is a boundary claim the header makes.
  v_src := pg_get_functiondef(
    'public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)'::regprocedure);
  if v_src ~* 'insert\s+into\s+public\.players\b' then
    raise exception 'spond_team_reconcile: the function must never create a player identity';
  end if;
  if v_src ~* 'delete\s+from\s+public\.player_spond_links'
     or v_src ~* 'update\s+public\.player_spond_links' then
    raise exception 'spond_team_reconcile: the function must never remove or repoint a link';
  end if;
  if v_src ~* '\b(register_entries|session_teams|spond_events|spond_event_responses)\b' then
    raise exception 'spond_team_reconcile: the function must not reach the register or the Spond mirror';
  end if;
  -- The season is derived, never named by the caller. A season argument
  -- would make a historic registration addressable, which is the one thing
  -- this path must not be able to do.
  if v_src ~* 'p_season' then
    raise exception 'spond_team_reconcile: the caller must not be able to name a season';
  end if;
  if v_src !~ 'is_current' then
    raise exception 'spond_team_reconcile: the season must be derived from the current season';
  end if;
  -- The capability gate and the identity gate are both present in what runs.
  if position('players.manage' in v_src) = 0 then
    raise exception 'spond_team_reconcile: the players.manage gate is missing from the function';
  end if;
  if position('not_linked' in v_src) = 0 then
    raise exception 'spond_team_reconcile: the unlinked refusal is missing from the function';
  end if;
  -- Row locks, and the per child serialisation. The link lock must carry its
  -- canonical ORDER BY: without it two crossed confirmations can deadlock.
  if position('for update' in lower(v_src)) = 0 then
    raise exception 'spond_team_reconcile: the registration and link reads must lock their rows';
  end if;
  if v_src !~* 'order by l\.spond_member_id\s+for update' then
    raise exception 'spond_team_reconcile: the link rows must be locked in a canonical order';
  end if;
  if position('pg_advisory_xact_lock' in v_src) = 0 then
    raise exception 'spond_team_reconcile: two managers acting on one child must be serialised';
  end if;
  -- No audit vocabulary is widened: the function must not set a source.
  if v_src ~* 'otj\.audit_source' then
    raise exception 'spond_team_reconcile: the function must not set an audit source';
  end if;

  -- ---- What this migration did NOT change ------------------------------
  -- Compared against the fingerprint taken BEFORE the function was created,
  -- so each of these is a real comparison across the DDL rather than a value
  -- compared with itself. Creating a function cannot move a row, a policy, a
  -- grant or a trigger; these exist so the claim is checked rather than
  -- asserted, and so a future edit to this file that adds a data statement
  -- fails the apply instead of passing review.
  if (select count(*) from public.player_registrations) <> b.regs
     or (select count(*) from public.player_registrations where team_id is not null) <> b.regs_teamed then
    raise exception 'spond_team_reconcile: the migration must not change any registration';
  end if;
  if (select count(*) from public.player_spond_links) <> b.links then
    raise exception 'spond_team_reconcile: the migration must not change any Spond link';
  end if;
  if (select count(*) from public.register_entries) <> b.entries
     or (select count(*) from public.spond_event_responses) <> b.responses then
    raise exception 'spond_team_reconcile: the migration must not touch the register or the RSVP mirror';
  end if;
  if (select count(*) from public.audit_events) <> b.audit_rows then
    raise exception 'spond_team_reconcile: the migration must write no audit event';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('player_registrations', 'players', 'player_spond_links', 'register_entries'))
     <> b.policies then
    raise exception 'spond_team_reconcile: the migration must change no policy';
  end if;
  if (select coalesce(string_agg(grantee || ':' || table_name || ':' || privilege_type, ','
                                 order by grantee, table_name, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in ('player_registrations', 'players', 'player_spond_links', 'register_entries')
         and grantee in ('anon', 'authenticated', 'service_role')) is distinct from b.grants then
    raise exception 'spond_team_reconcile: the migration must change no grant';
  end if;
  if (select coalesce(string_agg(tgname, ',' order by tgname), '')
        from pg_trigger
       where tgrelid in ('public.player_registrations'::regclass,
                         'public.players'::regclass,
                         'public.player_spond_links'::regclass)
         and not tgisinternal) is distinct from b.triggers then
    raise exception 'spond_team_reconcile: the migration must change no trigger';
  end if;
  -- The fingerprint itself must not be empty of meaning: the three audited
  -- tables carry triggers on every database this can apply to, so an empty
  -- trigger string means the fingerprint read nothing and the comparison
  -- above proved nothing.
  if b.triggers = '' then
    raise exception 'spond_team_reconcile: the trigger fingerprint is empty, so it asserts nothing';
  end if;

  -- The two properties the identity rule leans on stay exactly as 0045 left
  -- them: a link is still immutable, and no client may update one.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'player_spond_links' and cmd = 'UPDATE'
  ) then
    raise exception 'spond_team_reconcile: a Spond link must still not be updatable';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'player_spond_links'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'spond_team_reconcile: player_spond_links must still not grant UPDATE';
  end if;

  -- And the audit source vocabulary is untouched, which is what makes
  -- "no new audit value" checkable rather than a claim in a comment.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_events'::regclass
       and conname = 'audit_events_source_check'
       and pg_get_constraintdef(oid) not like '%spond_reconcile%'
  ) then
    raise exception 'spond_team_reconcile: the audit source vocabulary must not gain a value';
  end if;
end
$$;

commit;
