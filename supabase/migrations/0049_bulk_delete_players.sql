-- =====================================================================
-- OTJ Training Hub, migration 0049_bulk_delete_players: the transactional
-- bulk permanent deletion of player identities (roadmap PLAYERS-01)
--
-- REVIEW REQUIRED, DESTRUCTIVE. This file adds a child data DELETE path
-- that removes many identities in one statement. It is SECURITY DEFINER,
-- so the in body capability and club checks are the enforcement, not RLS.
-- Migrations are gated (CLAUDE.md, "Review gates"). Run by hand through the
-- reviewed production migration workflow after line by line review, and
-- only once the live ledger is confirmed to have this slot free. Do not
-- auto-merge. Nothing in this pull request applies it.
--
-- Numbering: the hosted ledger's newest row is spond_session_link_unique
-- (0048, version 20260812102912), read 2026-08-16, and the files on disk
-- end at 0048. 0033_players_legacy_columns.sql remains MERGED BUT DEFERRED
-- and unapplied, so its slot stays taken. The next free number confirmed
-- against both is 0049. Confirm 0049 is still free against the live ledger
-- immediately before applying.
--
-- WHAT THIS IS. Three functions and one predicate. NO table, NO column, NO
-- policy, NO grant on any table, NO trigger and NO capability key. The
-- permission boundary is unchanged: permanent deletion still requires
-- players.delete, which only admins hold by default (0030), and the
-- players_delete_admin RLS policy from 0032 is untouched. What this adds is
-- a way to spend that same permission on many identities atomically, with
-- the dependency counts computed server side and one audit event per run.
--
-- WHAT PERMANENT DELETION ACTUALLY REMOVES, proved from the schema rather
-- than from comments. Exactly three foreign keys reference public.players,
-- all of them ON DELETE CASCADE on the composite (id, club_id) key:
--
--   player_registrations_player_fk   -> every season registration, in EVERY
--                                       season including archived ones
--                                       (registrations_guard_archived
--                                       deliberately guards INSERT and
--                                       UPDATE only, so the erasure cascade
--                                       still reaches an archived season).
--   register_entries_player_fk       -> every register entry: the coach's
--                                       own record of who attended a
--                                       session, whether they were included
--                                       in the groups, and what bib they
--                                       wore. THIS IS SESSION HISTORY AND
--                                       IT IS DESTROYED, not neutralised.
--                                       See the note below.
--   player_spond_links_player_fk     -> the one opaque Spond member id
--                                       bound to the child, and through
--                                       spond_event_responses_link_fk (also
--                                       ON DELETE CASCADE) every stored
--                                       Spond reply for that member.
--
-- Nothing else references players. boards.tokens holds playerId inside a
-- jsonb array with NO foreign key by design (0028), so a saved board keeps
-- every disc where it was and simply stops resolving a name for that one;
-- audit_events.entity_id holds the player id with NO foreign key by design
-- (0030), so the trail survives the child and degrades to the neutral
-- "Deleted player" label the Activity and History surfaces already render.
--
-- THE HISTORY NOTE, stated because it is the one place this cascade removes
-- rather than neutralises. register_entries carries no audit trigger (0044
-- asserts it must not be audited per tick), so deleting an identity removes
-- that child's attendance, inclusion and bib record for every session they
-- ever appeared in, and leaves no per row trace of the removal. The
-- session, its plan, its groups and every other child's entries are
-- untouched; what goes is that child's own rows. This is NOT a new
-- semantic: it is exactly what the single player Delete permanently has
-- done since 0044, and Withdraw remains the reversible removal. What
-- changes here is that the number is counted and shown BEFORE the run
-- rather than discovered afterwards, and that the run is recorded as one
-- audit event carrying that count. The whole boundary is written up in
-- docs/security/player-deletion-boundary.md, which is authoritative where an
-- older comment or spec paragraph disagrees.
--
-- CONCURRENCY. The identities are locked FOR UPDATE in id order before
-- anything is counted, so two admins deleting overlapping selections queue
-- rather than deadlock, and the second one finds its selection short and
-- refuses whole. FOR UPDATE on the parent also conflicts with the FOR KEY
-- SHARE lock an FK insert takes, so a register tick or a Spond sync cannot
-- add a child row for a locked identity between the count and the delete.
-- The caller's confirmed count is revalidated inside the same transaction
-- and a mismatch aborts, so a stale preview deletes nobody.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0048 form): SECURITY DEFINER with
-- set search_path = '' and fully schema qualified references; EXECUTE
-- granted to authenticated (self gating in body) and revoked from anon and
-- public; internal helpers revoked from every client; the migration self
-- verifies with a DO block before it commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The metadata predicate for the one bulk delete audit event. Deliberately
-- SEPARATE from audit_metadata_ok (0030): that one is the private writer
-- log_audit_event's allow list, whose vocabulary describes an uploaded
-- spreadsheet, and widening it would loosen a boundary shared by four
-- other events. This one admits a closed set of NUMBERS and nothing else,
-- so no text of any kind, and therefore no child name, can enter the
-- metadata of a bulk delete however the caller is confused or malicious.
-- Immutable: it computes on its argument alone.
-- ---------------------------------------------------------------------
create or replace function public.audit_bulk_delete_metadata_ok(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metadata is not null
    and jsonb_typeof(p_metadata) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_metadata) as e(key, value)
      where e.key not in (
              'players', 'registrations', 'registration_seasons',
              'registrations_current', 'registrations_archived',
              'register_entries', 'register_sessions',
              'spond_links', 'spond_replies',
              'board_tokens', 'boards'
            )
         or jsonb_typeof(e.value) <> 'number'
    )
$$;

comment on function public.audit_bulk_delete_metadata_ok(jsonb) is
  $$True when a bulk player deletion audit metadata value is a jsonb object whose keys all come from the closed bulk delete count list and whose every value is a number. No text is admitted, so a child name cannot enter the metadata of a players.bulk_deleted event. Deliberately separate from audit_metadata_ok (0030), whose vocabulary describes an uploaded spreadsheet and is shared by the private writer. See 0049_bulk_delete_players.sql and docs/security/app-audit-boundary.md.$$;

-- ---------------------------------------------------------------------
-- player_deletion_counts: the ONE implementation of "what would deleting
-- these identities touch". Both the preview a coach reads and the commit
-- that revalidates it call this, so the number on the screen and the
-- number in the audit event can never be computed two different ways.
--
-- It counts only rows in the named club, and only for ids that are live
-- players of that club, so a cross club or already deleted id contributes
-- nothing. Duplicate ids are folded by the distinct in the ids CTE.
--
-- Every count is a count of ROWS THAT WOULD GO, except board_tokens and
-- boards, which count references that would stop resolving a name: the
-- board rows themselves are never touched (there is no foreign key from
-- boards to players by design, 0028). playerId is compared as TEXT, never
-- cast to uuid: the boards_tokens_minimal_shape constraint bounds which
-- KEYS a token may carry but not the json type of the value, so a cast
-- would be a way for one malformed board to make the whole preview throw.
--
-- Internal: EXECUTE is revoked from every client below. The two RPCs are
-- SECURITY DEFINER and so retain it as the function owner.
-- ---------------------------------------------------------------------
create or replace function public.player_deletion_counts(p_club uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ids as (
    select distinct p.id
      from public.players p
     where p.club_id = p_club
       and p.id = any(p_ids)
  ),
  regs as (
    select r.season_id
      from public.player_registrations r
      join ids on ids.id = r.player_id
     where r.club_id = p_club
  ),
  links as (
    select l.spond_member_id
      from public.player_spond_links l
      join ids on ids.id = l.player_id
     where l.club_id = p_club
  ),
  entries as (
    select e.session_id
      from public.register_entries e
      join ids on ids.id = e.player_id
     where e.club_id = p_club
  ),
  tokens as (
    select b.id as board_id
      from public.boards b
      cross join lateral jsonb_array_elements(b.tokens) as t(tok)
     where b.club_id = p_club
       and t.tok ->> 'playerId' in (select ids.id::text from ids)
  )
  select jsonb_build_object(
    'players',                (select count(*) from ids),
    'registrations',          (select count(*) from regs),
    'registration_seasons',   (select count(distinct regs.season_id) from regs),
    'registrations_current',  (select count(*) from regs
                                 join public.seasons s on s.id = regs.season_id
                                where s.is_current),
    'registrations_archived', (select count(*) from regs
                                 join public.seasons s on s.id = regs.season_id
                                where s.archived_at is not null),
    'register_entries',       (select count(*) from entries),
    'register_sessions',      (select count(distinct entries.session_id) from entries),
    'spond_links',            (select count(*) from links),
    'spond_replies',          (select count(*) from public.spond_event_responses resp
                                 join links on links.spond_member_id = resp.spond_member_id
                                where resp.club_id = p_club),
    'board_tokens',           (select count(*) from tokens),
    'boards',                 (select count(distinct tokens.board_id) from tokens)
  );
$$;

comment on function public.player_deletion_counts(uuid, uuid[]) is
  $$The single implementation of what permanently deleting a set of player identities would touch: registrations (total, distinct seasons, current season, archived seasons), register entries and the sessions they belong to, Spond links and the replies that cascade from them, and the saved board tokens that would stop resolving a name (the boards themselves are never touched; there is no foreign key from boards to players). Club scoped and duplicate tolerant; a cross club or already deleted id contributes nothing. Called by BOTH preview_delete_players and delete_players so the previewed number and the audited number cannot diverge. Internal: EXECUTE revoked from every client. See 0049_bulk_delete_players.sql.$$;

revoke execute on function public.player_deletion_counts(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- preview_delete_players: the read only dependency preview. Gated on
-- players.delete, not players.view: only somebody who could actually run
-- the deletion has any business asking what it would cost, and the answer
-- is a shape of a child's record.
--
-- It returns the counts from player_deletion_counts plus the two facts the
-- confirmation needs to be honest about a stale selection: how many of the
-- supplied ids are live players of the caller's club (`players`), and how
-- many were supplied after folding duplicates and nulls (`requested`). A
-- screen that shows `requested` where `players` is smaller is showing a
-- selection the server will refuse, which is exactly what it should say.
--
-- It writes nothing, audits nothing and returns no name. Reading a preview
-- is not an act on a child's record; the run is.
-- ---------------------------------------------------------------------
create or replace function public.preview_delete_players(p_player_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club uuid := public.my_club();
  v_ids  uuid[];
begin
  if v_club is null or not public.has_perm('players.delete') then
    raise exception 'preview_delete_players: requires the players.delete capability' using errcode = '42501';
  end if;

  select array_agg(distinct t.id) into v_ids
    from unnest(coalesce(p_player_ids, '{}'::uuid[])) as t(id)
   where t.id is not null;

  if v_ids is null then
    -- Nothing selected is not an error to ask about; it is a preview of
    -- nothing, and every count is zero. The DELETE path refuses it.
    return public.player_deletion_counts(v_club, '{}'::uuid[]) || jsonb_build_object('requested', 0);
  end if;

  return public.player_deletion_counts(v_club, v_ids)
         || jsonb_build_object('requested', array_length(v_ids, 1));
end;
$$;

comment on function public.preview_delete_players(uuid[]) is
  $$The read only dependency preview for a permanent bulk deletion: SECURITY DEFINER, self gates on players.delete (the capability that would run it), club scoped, duplicate and null tolerant. Returns the player_deletion_counts object plus `requested`, the number of distinct ids supplied, so a screen can say when its selection is already stale. Writes nothing, audits nothing, returns no child name. See 0049_bulk_delete_players.sql.$$;

revoke execute on function public.preview_delete_players(uuid[]) from public, anon;
grant execute on function public.preview_delete_players(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- delete_players: the transactional permanent deletion of many identities.
--
-- Signature: delete_players(p_player_ids uuid[], p_expected_count int).
--   p_player_ids     the chosen identities. Duplicates and nulls are
--                    folded before anything else happens, so a repeated id
--                    can never be counted or charged twice. Capped at 200.
--   p_expected_count the number of players the admin confirmed deleting,
--                    which the confirmation phrase they typed also names.
--                    Revalidated inside this transaction against the live
--                    set: a mismatch aborts and deletes nobody. This is
--                    what makes a stale preview safe rather than merely
--                    unlikely.
--
-- Returns the jsonb the screen reports and the audit event records, plus
-- the run's batch id and outcome. On ANY refusal it RAISES, which rolls
-- the whole transaction back: no identity is deleted, no audit event is
-- written and no partial state exists to reconcile. A retry after a
-- failure is therefore safe and starts from the same place.
--
-- WHAT IT DOES NOT DO. It touches Spond only by deleting local rows: no
-- Spond member is deleted or modified, no Spond endpoint is called, and no
-- outbound request of any kind leaves the database. It sets no
-- registration status, moves no team, and deletes no session, board,
-- venue or audit event.
-- ---------------------------------------------------------------------
create or replace function public.delete_players(
  p_player_ids     uuid[],
  p_expected_count int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club       uuid := public.my_club();
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_batch      uuid := gen_random_uuid();
  v_ids        uuid[];
  v_requested  int;
  v_found      int;
  v_counts     jsonb;
  v_deleted    int;
begin
  -- Capability and club, re checked in the body because a SECURITY DEFINER
  -- function is not bound by RLS. Fails closed.
  if v_club is null or not public.has_perm('players.delete') then
    raise exception 'delete_players: requires the players.delete capability' using errcode = '42501';
  end if;

  -- Fold duplicates and nulls before anything counts or deletes.
  select array_agg(distinct t.id) into v_ids
    from unnest(coalesce(p_player_ids, '{}'::uuid[])) as t(id)
   where t.id is not null;

  if v_ids is null then
    raise exception 'delete_players: no players were selected' using errcode = '22023';
  end if;
  v_requested := array_length(v_ids, 1);
  if v_requested > 200 then
    raise exception 'delete_players: at most 200 players can be deleted in one run (% selected)', v_requested
      using errcode = '22023';
  end if;

  -- Lock the identities in id order. Two concurrent runs over overlapping
  -- selections therefore take the shared rows in the same order and queue
  -- instead of deadlocking. FOR UPDATE also conflicts with the FOR KEY
  -- SHARE an FK insert takes on the parent, so no register entry, Spond
  -- link or registration can be added for these children between the count
  -- below and the delete.
  perform 1
     from public.players p
    where p.club_id = v_club
      and p.id = any(v_ids)
    order by p.id
      for update;

  select count(*) into v_found
    from public.players p
   where p.club_id = v_club
     and p.id = any(v_ids);

  -- Every supplied id must be a live player of the caller's club. A cross
  -- club id and an id another admin has just deleted are both refused, and
  -- deliberately with ONE message: distinguishing them would answer "does
  -- this id exist in some other club", which is not a question a member of
  -- this club may ask. Nothing is skipped silently; the run deletes all of
  -- them or none.
  if v_found <> v_requested then
    raise exception
      'delete_players: the selection is out of date (% of % selected players are no longer available); review the preview again',
      v_requested - v_found, v_requested
      using errcode = 'P0001';
  end if;

  -- The confirmed preview, revalidated against server truth inside the
  -- transaction. The admin typed a phrase naming this number; if it is no
  -- longer the number, they confirmed something else.
  if p_expected_count is distinct from v_found then
    raise exception
      'delete_players: the selection changed (% confirmed, % found); review the preview again',
      coalesce(p_expected_count, -1), v_found
      using errcode = 'P0001';
  end if;

  -- Server truth, taken inside the lock, and the same computation the
  -- preview showed. This is both what the caller is told and what the
  -- audit event records.
  v_counts := public.player_deletion_counts(v_club, v_ids);

  if not public.audit_bulk_delete_metadata_ok(v_counts) then
    raise exception 'delete_players: the audit metadata carries a value outside the safe allow list'
      using errcode = 'P0001';
  end if;

  -- Correlate this run's per player player.deleted trigger events (0032's
  -- audit_players, which still fires once per identity) with the one bulk
  -- event below. Transaction local, so it cannot leak into another
  -- statement; a browser cannot set otj.* settings at all.
  perform set_config('otj.audit_batch', v_batch::text, true);

  delete from public.players p
   where p.club_id = v_club
     and p.id = any(v_ids);
  get diagnostics v_deleted = row_count;

  -- The destructive statement must have affected exactly the locked set.
  -- Anything else means the world moved under a held lock, which should be
  -- impossible; refuse rather than report a number that is not true.
  if v_deleted <> v_found then
    raise exception 'delete_players: expected to delete % identities but deleted %', v_found, v_deleted
      using errcode = 'P0001';
  end if;

  if v_actor is not null then
    select pr.full_name into v_actor_name from public.profiles pr where pr.id = v_actor;
  end if;

  -- One event per run, beside the per identity player.deleted events, both
  -- carrying this run's batch id so the Activity feed can open the run and
  -- list exactly which identities went. entity_id is the batch, not a
  -- player: this event is about the run.
  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, source, batch_id, metadata
  )
  values (
    v_club, now(), v_actor, v_actor_name, 'players.bulk_deleted', 'delete_batch',
    v_batch, public.audit_source_context(v_actor), v_batch, v_counts
  );

  return v_counts || jsonb_build_object('batch_id', v_batch, 'outcome', 'succeeded');
end;
$$;

comment on function public.delete_players(uuid[], int) is
  $$The transactional permanent deletion of many player identities (roadmap PLAYERS-01): SECURITY DEFINER, self gates on players.delete and the caller's club, folds duplicate and null ids, caps a run at 200, locks the identities FOR UPDATE in id order (so overlapping concurrent runs queue rather than deadlock and no child row can be added under the lock), refuses whole if any id is not a live player of the club or if the caller's confirmed count no longer matches server truth, deletes them in ONE statement whose cascades remove every registration, register entry, Spond link and cascaded Spond reply, and writes ONE players.bulk_deleted audit event carrying safe numeric counts only, sharing a batch id with the per identity player.deleted events. Any refusal raises and rolls the whole transaction back, so a failure deletes nobody and a retry is safe. Deletes nothing on Spond and calls no Spond endpoint. See 0049_bulk_delete_players.sql.$$;

revoke execute on function public.delete_players(uuid[], int) from public, anon;
grant execute on function public.delete_players(uuid[], int) to authenticated;

-- =====================================================================
-- Self verification. Same transaction as everything above, so any failure
-- rolls the entire release back and leaves the schema exactly as it was.
-- Every assertion states a boundary this release depends on.
-- =====================================================================
do $$
declare
  v_refs text[];
  v_del  text[];
  v_n    int;
begin
  -- ---- The dependency graph this feature previews, pinned ------------
  -- The preview is only honest while these are the foreign keys into
  -- players and they all cascade. Adding a fourth reference without
  -- teaching player_deletion_counts about it would silently undercount a
  -- destructive operation, so it fails the migration instead.
  select array_agg(src.relname order by src.relname),
         array_agg(distinct c.confdeltype::text)
    into v_refs, v_del
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
   where c.contype = 'f'
     and tgt.relname = 'players'
     and tgt.relnamespace = 'public'::regnamespace
     and src.relnamespace = 'public'::regnamespace;
  if v_refs is distinct from array['player_registrations', 'player_spond_links', 'register_entries'] then
    raise exception 'bulk delete: the foreign keys into players are %, not the three this preview counts', v_refs;
  end if;
  if v_del is distinct from array['c'] then
    raise exception 'bulk delete: every foreign key into players must be ON DELETE CASCADE (found %)', v_del;
  end if;

  -- The second hop: a Spond reply exists only for a linked member and goes
  -- with the link. This is what makes "delete the child, the replies drain"
  -- a database fact rather than a sweep.
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'spond_event_responses_link_fk'
       and c.confdeltype = 'c'
  ) then
    raise exception 'bulk delete: spond_event_responses must cascade from player_spond_links';
  end if;

  -- boards must still hold NO foreign key to players: the preview counts
  -- board tokens as references that lose a name, never as rows that go.
  if exists (
    select 1 from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
     where c.contype = 'f' and src.relname = 'boards' and tgt.relname = 'players'
  ) then
    raise exception 'bulk delete: boards must not reference players (0028 board data boundary)';
  end if;

  -- audit_events must still hold NO foreign key on entity_id, so the trail
  -- survives the identities this run removes.
  if exists (
    select 1 from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
     where c.contype = 'f' and src.relname = 'audit_events' and tgt.relname = 'players'
  ) then
    raise exception 'bulk delete: audit_events must not reference players (0030 audit boundary)';
  end if;

  -- ---- The functions exist with the intended EXECUTE ----------------
  if to_regprocedure('public.delete_players(uuid[], int)') is null
     or to_regprocedure('public.preview_delete_players(uuid[])') is null
     or to_regprocedure('public.player_deletion_counts(uuid, uuid[])') is null
     or to_regprocedure('public.audit_bulk_delete_metadata_ok(jsonb)') is null then
    raise exception 'bulk delete: a function was not created';
  end if;

  if not has_function_privilege('authenticated', 'public.delete_players(uuid[], int)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.preview_delete_players(uuid[])', 'EXECUTE') then
    raise exception 'bulk delete: authenticated cannot execute the two client RPCs';
  end if;
  if has_function_privilege('anon', 'public.delete_players(uuid[], int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.preview_delete_players(uuid[])', 'EXECUTE') then
    raise exception 'bulk delete: anon must not execute either client RPC';
  end if;
  if has_function_privilege('authenticated', 'public.player_deletion_counts(uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.player_deletion_counts(uuid, uuid[])', 'EXECUTE') then
    raise exception 'bulk delete: the internal counts helper must not be client callable';
  end if;

  -- Both RPCs are SECURITY DEFINER with an empty search_path, so no caller
  -- controlled path can redirect a schema qualified reference.
  select count(*) into v_n
    from pg_proc p
   where p.oid in (
           'public.delete_players(uuid[], int)'::regprocedure,
           'public.preview_delete_players(uuid[])'::regprocedure,
           'public.player_deletion_counts(uuid, uuid[])'::regprocedure
         )
     and p.prosecdef
     and p.proconfig @> array['search_path=""'];
  if v_n <> 3 then
    raise exception 'bulk delete: the three definer functions must set search_path to empty (got %)', v_n;
  end if;

  -- ---- The metadata predicate actually refuses text -----------------
  if public.audit_bulk_delete_metadata_ok('{"players": "Alex Morgan"}'::jsonb) then
    raise exception 'bulk delete: the metadata predicate admitted a text value';
  end if;
  if public.audit_bulk_delete_metadata_ok('{"note": 1}'::jsonb) then
    raise exception 'bulk delete: the metadata predicate admitted a key outside the closed list';
  end if;
  if not public.audit_bulk_delete_metadata_ok(
       '{"players":1,"registrations":1,"registration_seasons":1,"registrations_current":1,'
       '"registrations_archived":0,"register_entries":0,"register_sessions":0,'
       '"spond_links":0,"spond_replies":0,"board_tokens":0,"boards":0}'::jsonb) then
    raise exception 'bulk delete: the metadata predicate refused the shape this migration writes';
  end if;

  -- ---- Nothing about the existing permission boundary moved ---------
  -- players still carries exactly one delete policy and it is still the
  -- players.delete one from 0032. This migration must not have widened who
  -- may erase a child.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'players' and cmd = 'DELETE';
  if v_n <> 1 then
    raise exception 'bulk delete: players must carry exactly one delete policy (got %)', v_n;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'players'
       and policyname = 'players_delete_admin'
       and qual like '%players.delete%'
  ) then
    raise exception 'bulk delete: the players_delete_admin policy is not the players.delete gate it was';
  end if;

  -- player_registrations still holds no delete grant and no delete policy:
  -- registrations go through the identity cascade and no other way.
  if has_table_privilege('authenticated', 'public.player_registrations', 'DELETE') then
    raise exception 'bulk delete: authenticated must still hold no DELETE on player_registrations';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'player_registrations' and cmd = 'DELETE'
  ) then
    raise exception 'bulk delete: player_registrations must still have no delete policy';
  end if;

  -- The capability catalogue is unchanged: this feature spends
  -- players.delete and introduces no new key.
  if not exists (select 1 from public.capabilities where key = 'players.delete') then
    raise exception 'bulk delete: the players.delete capability is missing';
  end if;
end
$$;
