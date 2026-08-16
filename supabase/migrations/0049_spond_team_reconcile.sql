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
--      player_spond_links row, AND refuses when that row no longer points at
--      the member the caller derived its destination from. The only way to
--      acquire a link in the same breath is to pass the member id a human
--      confirmed. A client that forgot any of that cannot move anybody by
--      forgetting it.
--   2. ATOMICITY. Confirming an identity and acting on it are one decision.
--      Two client calls can leave a link created and the move failed, which
--      is a child bound to a Spond member for a move that never happened,
--      or the reverse.
--   3. CONCURRENCY. Two managers pressing at once are serialised by a per
--      (club, player) advisory lock, a per (club, member) advisory lock for
--      the case where the member has no row to lock yet, a canonically
--      ordered FOR UPDATE over the link rows, and a FOR UPDATE on the
--      registration. The second manager is told what happened rather than
--      silently overwriting what the first decided, or seeing a raw
--      constraint violation.
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
--     p_player_id         uuid,
--     p_expected_team_id  uuid,  -- what the screen showed; null = Unassigned
--     p_target_team_id    uuid,  -- Spond's answer; null = Unassigned
--     p_expected_member_id text, -- PROVED path: the member whose Spond
--                                -- subgroups produced the target, which must
--                                -- STILL be this child's link
--     p_confirm_member_id text,  -- CONFIRM path: the member a human just
--                                -- confirmed, to bind where there is no link
--     p_batch_id          uuid   -- audit grouping key for one press
--   ) returns jsonb
--
-- EXACTLY ONE of the two member arguments must be supplied. They are separate
-- parameters rather than one plus a flag because the two mean different
-- things about the SAME id, and a review found what conflating them costs.
--
-- THE STALE LINK RACE, and why "the player has any link" is not proof. The
-- screen derives the target from ONE member's Spond subgroups. Between the
-- scan and the press another manager can unlink that member and correctly
-- link the child to a DIFFERENT one, whose Spond team may be somewhere else
-- entirely. The child still "has a link", and their OTJ team need not have
-- changed, so neither a bare link check nor the expected-team check below
-- catches it, and the move would apply a destination derived from a member
-- this child is no longer. So the proved path names the member it reasoned
-- from and the function refuses when the link no longer points at it.
--
-- A null member argument therefore never means "any existing link will do".
-- The proved path names a member; the confirm path names a member; there is
-- no third mode.
--
-- Outcomes, returned rather than raised, because each is a normal thing for
-- a manager to be told and a bulk caller has to be able to report them per
-- row:
--   moved                    the registration's team changed
--   already_matched          it was already on the target; nothing written
--   stale                    it is on neither the expected nor the target
--                            team, so somebody else moved it; nothing written
--   no_registration          this player has no current season registration
--   not_linked               the proved path was asked for and this child has
--                            no link at all, so there is no identity to move on
--   stale_link               the proved path was asked for and this child's
--                            link no longer points at the member the target
--                            was derived from. Reload from Spond and look again
--   member_linked_elsewhere  that Spond member is already bound to a
--                            different child
--   player_linked_elsewhere  this child is already bound to a different
--                            Spond member
--
-- Raised (the whole call fails and nothing is written): not signed in, no
-- players.manage, a target team outside the caller's club, a malformed
-- member id, both or neither member argument supplied, no current season.
-- ---------------------------------------------------------------------
create or replace function public.spond_reconcile_player_team(
  p_player_id          uuid,
  p_expected_team_id   uuid,
  p_target_team_id     uuid,
  p_expected_member_id text default null,
  p_confirm_member_id  text default null,
  p_batch_id           uuid default null
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
  -- The member id this call names, whichever argument carried it, normalised
  -- once. v_confirming says which of the two modes we are in.
  v_member       text;
  v_confirming   boolean;
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

  -- ============ Exactly one member argument, and it is well formed =========
  -- Neither is a caller that has not said what it reasoned from; both is a
  -- caller that has said two contradictory things. Both are programming
  -- errors rather than states a manager can be in, so both raise.
  if (p_expected_member_id is null) = (p_confirm_member_id is null) then
    raise exception 'spond_reconcile_player_team: name exactly one of the expected or confirmed Spond member'
      using errcode = 'P0001';
  end if;
  v_confirming := p_confirm_member_id is not null;
  v_member := upper(btrim(coalesce(p_confirm_member_id, p_expected_member_id)));
  -- Normalised and checked HERE as well as by the column, so a malformed id
  -- fails before any lock is taken and before anything is written. The class
  -- is the boundary, not a nicety: it admits no space, no '@', no '+', no
  -- '.' and no lowercase letter, so a name, an email address and a phone
  -- number cannot be passed to this function at all.
  if v_member !~ '^[0-9A-F]{16,64}$' then
    raise exception 'spond_reconcile_player_team: that is not a Spond member id'
      using errcode = 'P0001';
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

  -- ============ And two managers acting on the SAME MEMBER ==================
  -- A member that is not linked yet has NO ROW, so there is nothing for FOR
  -- UPDATE to hold: two confirmations of the same free member for two
  -- different children take two different per child locks, both read "nobody
  -- owns this member", and both reach the insert. The unique constraint keeps
  -- the data correct, but the loser comes back as a raw 23505 instead of the
  -- documented member_linked_elsewhere, which is a refusal a manager cannot
  -- act on. This lock is what makes the absent row case deterministic.
  --
  -- The lock ORDER is fixed and that is what keeps it deadlock free: every
  -- call takes the player key first and the member key second, and each call
  -- takes at most one of each. For a cycle, a transaction holding the member
  -- key would have to wait on a player key it does not already hold, but any
  -- transaction wanting that player key takes it BEFORE any member key, so it
  -- cannot be holding one. Both keys are also taken before any row lock, and
  -- the link rows below are locked in one canonically ordered statement, so
  -- no row lock can close a cycle either.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('otj.spond_member:' || v_club::text || ':' || v_member)
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

  if not v_confirming then
    -- THE PROVED PATH. This child must already carry a link, and it must be
    -- the SAME link the caller reasoned from. Together those two checks are
    -- the whole identity rule: without a durable binding there is nothing but
    -- a name, and with the wrong binding there is a destination derived from
    -- somebody else. A client that forgot either cannot move anybody by
    -- forgetting it.
    if v_player_member is null then
      return jsonb_build_object(
        'outcome', 'not_linked', 'player_id', p_player_id, 'season_id', v_season,
        'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
        'linked', false, 'link_created', false
      );
    end if;
    if v_player_member <> v_member then
      -- Somebody re-linked this child between the scan and the press. The
      -- target came from a member they are no longer, so it is not applied
      -- and the screen is told to look again rather than to try again.
      return jsonb_build_object(
        'outcome', 'stale_link', 'player_id', p_player_id, 'season_id', v_season,
        'from_team_id', v_reg.team_id, 'to_team_id', p_target_team_id,
        'linked', true, 'link_created', false
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

comment on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid) is
  $$Makes one child's CURRENT SEASON team assignment agree with Spond, optionally confirming the Spond member link in the same transaction (0049_spond_team_reconcile.sql). SECURITY DEFINER, self gates on players.manage, derives club, actor and the current season server side, and re validates the destination team belongs to the club. THE IDENTITY RULE IS ENFORCED HERE, and it names a member rather than accepting any link: exactly one of p_expected_member_id (the member whose Spond subgroups produced the target, which must STILL be this child's link, else stale_link) and p_confirm_member_id (the member a human just confirmed, bound where there is no link) must be supplied. A child with no link cannot be moved at all. Never creates a player identity, never deletes or repoints a link (a contested member and an already bound child are named refusals), never names a season (so no historic or archived registration is addressable), never touches register_entries, sessions or any Spond mirror table, and never contacts Spond. Concurrency safe: a per (club, player) then per (club, member) advisory lock in that fixed order, a canonically ordered FOR UPDATE over the link rows, FOR UPDATE on the registration, and an optimistic expected-team check that refuses a row somebody else moved and treats a row already on the destination as an idempotent no-op. The member key lock is what makes two confirmations of the same not yet linked member return member_linked_elsewhere instead of a raw unique violation. Audited by the existing triggers only (player.team_changed from 0032, player.spond_linked from 0045), sharing the caller's batch id; adds no audit source value. See docs/security/spond-data-boundary.md.$$;

revoke execute on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid) to authenticated;

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
  if to_regprocedure('public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)') is null then
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
        'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)', 'EXECUTE') then
    raise exception 'spond_team_reconcile: authenticated cannot execute the function';
  end if;
  if has_function_privilege('anon',
        'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)', 'EXECUTE') then
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
    'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)'::regprocedure);
  -- \y and \M, NEVER \b. In PostgreSQL's ARE syntax \b is the BACKSPACE
  -- CHARACTER, not a word boundary assertion, so every one of these read as
  -- "the literal byte 0x08 appears here" and matched nothing at all: the
  -- checks were vacuous and passed for the wrong reason. A review caught it.
  -- The correct assertions are \y (a word boundary), \m (word start) and \M
  -- (word end). The mutation section of
  -- .github/scripts/production-migration/test_0049_spond_team_reconcile.sh
  -- injects each forbidden thing into the function body and proves the apply
  -- ABORTS, so these are checked to bite rather than assumed to.
  --
  -- \M rather than \y here: it anchors the end of "players" so
  -- public.player_spond_links and public.player_registrations are not caught
  -- by a prefix, while an insert into public.players is.
  if v_src ~* 'insert\s+into\s+public\.players\M' then
    raise exception 'spond_team_reconcile: the function must never create a player identity';
  end if;
  if v_src ~* 'delete\s+from\s+public\.player_spond_links'
     or v_src ~* 'update\s+public\.player_spond_links' then
    raise exception 'spond_team_reconcile: the function must never remove or repoint a link';
  end if;
  if v_src ~* '\y(register_entries|session_teams|spond_events|spond_event_responses)\y' then
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
  -- The other half of the identity rule, and the one a review had to find:
  -- "this child has a link" is not proof, because the link can have been
  -- repointed at a different member since the caller read Spond.
  if position('stale_link' in v_src) = 0 then
    raise exception 'spond_team_reconcile: the stale link refusal is missing from the function';
  end if;
  if position('v_player_member <> v_member' in v_src) = 0 then
    raise exception 'spond_team_reconcile: the proved path must compare the link against the named member';
  end if;
  -- And a null member argument must never be able to mean "any link will do".
  if v_src !~* 'p_expected_member_id is null\) = \(p_confirm_member_id is null' then
    raise exception 'spond_team_reconcile: exactly one member argument must be required';
  end if;
  -- Row locks, and the per child serialisation. The link lock must carry its
  -- canonical ORDER BY: without it two crossed confirmations can deadlock.
  if position('for update' in lower(v_src)) = 0 then
    raise exception 'spond_team_reconcile: the registration and link reads must lock their rows';
  end if;
  if v_src !~* 'order by l\.spond_member_id\s+for update' then
    raise exception 'spond_team_reconcile: the link rows must be locked in a canonical order';
  end if;
  -- TWO advisory locks, in a fixed order. The player key serialises two
  -- presses on one child; the member key covers the case the row locks
  -- cannot, a member with no link row yet, where two confirmations would
  -- otherwise both reach the insert and the loser would surface a raw 23505
  -- rather than a refusal a manager can act on.
  if (length(v_src) - length(replace(v_src, 'pg_advisory_xact_lock', ''))) / length('pg_advisory_xact_lock') < 2 then
    raise exception 'spond_team_reconcile: both the per child and the per member locks are required';
  end if;
  if position('otj.spond_reconcile:' in v_src) = 0 or position('otj.spond_member:' in v_src) = 0 then
    raise exception 'spond_team_reconcile: the two advisory lock keys must both be present';
  end if;
  -- And in that order, which is what keeps them deadlock free.
  if position('otj.spond_reconcile:' in v_src) > position('otj.spond_member:' in v_src) then
    raise exception 'spond_team_reconcile: the player key must be taken before the member key';
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
