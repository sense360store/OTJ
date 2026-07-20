-- =====================================================================
-- OTJ Training Hub, migration 0036_spond_and_renew: the two transactional,
-- capability gated commit RPCs for the Spond squad import and season Renew
-- (Registered Players PR 6)
--
-- REVIEW REQUIRED. This file adds two child data WRITE paths:
-- spond_import_roster creates children's identities and current season
-- registrations from a Spond squad, and renew_registrations copies chosen
-- registrations from one season into another. Both are SECURITY DEFINER, so
-- the in body capability and club checks are the enforcement, not RLS.
-- Migrations are gated. Run by hand via the connector after line by line
-- review, and only once the live ledger is confirmed to have this slot free.
-- Do not auto-merge. The Spond Edge Function is reworked to call
-- spond_import_roster, but that Edge Function deploy is a SEPARATE, gated
-- step (byte for byte readback) that does not happen with this migration.
--
-- Numbering: PROVISIONAL 0036. The files on disk end at
-- 0035_import_players.sql; 0033_players_legacy_columns.sql is MERGED BUT
-- DEFERRED and NOT YET APPLIED (the PR 3 legacy column drop, applied late per
-- the delivery plan). The live hosted ledger ends at import_players (0035,
-- version 20260719142052), with players_legacy_columns (0033) intentionally
-- absent. Per the standing rule the ledger is the authority, and a merged but
-- not yet applied migration still counts as a taken slot, so the next free
-- number confirmed against BOTH the live ledger and the merged files together
-- is 0036. Confirm 0036 is still free against the live ledger immediately
-- before applying. 0033 remains a separate, deferred, unapplied step and is
-- NOT applied by or with this migration.
--
-- WHAT THIS IS. The PR 6 half of the Registered Players programme
-- (docs/roadmaps/registered-players-delivery-plan.md, PR 6): the Spond commit
-- RPC of docs/security/registered-players-boundary.md section 7, and the bulk
-- Renew action of docs/adr/ADR-0005-registered-players-and-seasons.md decision
-- 10. It adds NO table, NO column and NO capability: the audit_events.source
-- vocabulary already lists 'spond_import' and 'renewal' (0030), the private
-- writer log_audit_event already accepts the 'players.spond_imported' action
-- and 'spond_import' source (0030), the per row triggers already emit
-- 'player.renewed' when the transaction local source is 'renewal' (0032), and
-- the players.import and players.manage capabilities already exist (0030). This
-- migration is the two commit functions and their grants, nothing else.
--
-- WHAT THIS DELIBERATELY IS NOT. Neither RPC records an import_batches row:
-- that table's format vocabulary (csv, xlsx) and count semantics describe an
-- uploaded spreadsheet, and a Spond run or a renewal has no file
-- (docs/adr/ADR-0007-player-import-export-architecture.md; the boundary doc
-- section 4). The batch id each RPC stamps exists only on the audit events. No
-- Spond member id, guardian, contact, raw payload or file is ever received,
-- stored or logged; the Spond function reduces each member to a name plus an
-- optional shirt number BEFORE this RPC is called, so the RPC only ever sees
-- {name, shirt_number}. This is NOT the Activity page or the wider audit
-- rollout; those are PR 7 and PR 8 and are out of scope here.
--
-- CHILD DATA WRITE, and how it is bounded:
--   * spond_import_roster gates on players.import (managers and admins by
--     default), renew_registrations on players.manage, re checked in the
--     function body because a SECURITY DEFINER function is NOT bound by RLS.
--     Both fail closed.
--   * club and actor are derived server side (my_club(), auth.uid()); nothing
--     identity or authority shaped is trusted from the payload. A client
--     supplied team id, season id or player id is re validated to belong to
--     the caller's club, or it is skipped or refused.
--   * Spond import is current-season-only: the season is the club's current
--     season, chosen server side, and the caller cannot pick it. It refuses
--     when the club has no current season.
--   * the dedupe key for Spond is the normalised name within (club, season,
--     team) against live registrations, so a repeat import adds nothing and no
--     existing registration is ever updated, deleted or moved. Because Spond
--     member ids are never persisted, two different children with the same
--     name in one subgroup are treated as one (the second is not inserted); a
--     documented, accepted trade off of the child data boundary.
--   * renew never mutates the source registration, only creates the target
--     season registration; the unique (player_id, season_id) constraint plus
--     ON CONFLICT DO NOTHING make a double submit or retry idempotent.
--   * both are one transaction: a mid run failure rolls every write back (no
--     partial import, no partial renewal, and no audit claim of success for
--     work that did not commit).
--   * audit metadata carries SAFE server derived counts only (the 0030
--     audit_metadata_ok allow list), never a child name, a member id, a raw
--     row or a file.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0035 form): SECURITY DEFINER with set
-- search_path = '' and fully schema qualified references, so no caller
-- controlled search path can redirect a reference; EXECUTE granted to
-- authenticated (self gating in body, the member_states shape) and revoked
-- from anon and public; the migration self verifies with a DO block before it
-- commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- spond_import_roster: the transactional commit path for a Spond squad import.
-- The Edge Function (spond-roster-import) authenticates the caller, reduces
-- each Spond member to exactly {name, shirt_number} (the child data boundary),
-- and calls this RPC with the reduced roster for one mapped team. This function
-- derives the club and the current season server side, re checks players.import,
-- stamps the audit context (source 'spond_import' plus the run's batch id), and
-- inserts a new identity plus a current season Pending registration for every
-- name not already registered on that team this season. It records NO
-- import_batches row; the batch id exists only on the audit events. Idempotent
-- and safe against a double submit: a per (club, team) advisory lock serialises
-- concurrent imports, and the live name snapshot is taken inside the lock so a
-- stale candidate list adds nothing.
--
-- Signature: spond_import_roster(p_batch_id uuid, p_team_id uuid, p_members jsonb).
--   p_batch_id  the run's batch id (client minted in the Edge Function); it is
--               an audit grouping key only, never an authority claim, and no
--               import_batches row is keyed on it.
--   p_team_id   the mapped team to import into; re validated to be a team of
--               the caller's club (a forged or cross club id is refused).
--   p_members   a jsonb array of reduced roster rows, each
--               { "name": text, "shirt_number": int|null }. Never a Spond
--               member id, guardian or contact: the Edge Function stripped
--               those before calling. Capped at 200.
--
-- Returns jsonb the Edge Function folds into its response:
--   { batch_id, added, already_present, skipped, outcome ('succeeded') }.
-- On any failure the function RAISES and the whole transaction rolls back
-- (no partial import, no audit summary); the Edge Function surfaces the error.
-- ---------------------------------------------------------------------
create or replace function public.spond_import_roster(
  p_batch_id uuid,
  p_team_id  uuid,
  p_members  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_club    uuid := public.my_club();
  v_season  uuid;
  v_count   integer;
  v_i       integer;
  v_op      jsonb;
  v_name    text;
  v_key     text;
  v_shirt   integer;
  v_new_pid uuid;
  v_added   integer := 0;
  v_already integer := 0;
  v_skipped integer := 0;
  v_seen    text[] := array[]::text[];
  v_existing text[] := array[]::text[];
  v_meta    jsonb;
begin
  -- ============ Caller and capability (raise 42501) ========================
  if v_actor is null or v_club is null then
    raise exception 'spond_import_roster: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('players.import') then
    raise exception 'spond_import_roster: requires the players.import capability' using errcode = '42501';
  end if;

  -- ============ Team must be a team of the caller's club (T3 sibling) =======
  if p_team_id is null or not exists (
    select 1 from public.teams t where t.id = p_team_id and t.club_id = v_club
  ) then
    raise exception 'spond_import_roster: the team is not in your club' using errcode = '42501';
  end if;

  -- ============ Season is the club's current season, chosen server side. The
  -- client never picks it; Spond stays current-season-only. Refuse when none. ==
  select s.id into v_season from public.seasons s
    where s.club_id = v_club and s.is_current;
  if v_season is null then
    raise exception 'spond_import_roster: the club has no current season' using errcode = 'P0001';
  end if;

  -- ============ Envelope: a jsonb array capped at 200 members ===============
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'spond_import_roster: the roster payload is malformed' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_members);
  if v_count > 200 then
    raise exception 'spond_import_roster: too many members in one import (the limit is 200)' using errcode = 'P0001';
  end if;

  -- ============ Serialise concurrent imports of the same team, so two racing
  -- runs cannot both insert the same new name. The lock releases at commit. ===
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('otj.spond_import:' || v_club::text || ':' || p_team_id::text)
  );

  -- ============ Stamp the audit context so the identity and registration
  -- insert triggers record source 'spond_import' and this run's batch id. A
  -- browser cannot set these GUCs; they are provenance labelling only, bounded
  -- by the audit_events.source CHECK. ======================================
  perform set_config('otj.audit_source', 'spond_import', true);
  perform set_config('otj.audit_batch', p_batch_id::text, true);

  -- ============ Snapshot the names already registered on this team this
  -- season (taken inside the lock, so it is authoritative for this run). Case
  -- and whitespace folded, the same normalisation the plan uses. ============
  select coalesce(array_agg(distinct lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g'))), array[]::text[])
    into v_existing
    from public.player_registrations r
    join public.players p on p.id = r.player_id
    where r.club_id = v_club and r.season_id = v_season and r.team_id = p_team_id;

  -- ============ Insert a new identity plus a Pending current season
  -- registration for every name not already present. Never an update, delete or
  -- team move of an existing row. ==========================================
  for v_i in 0 .. v_count - 1 loop
    v_op := p_members->v_i;
    if v_op is null or jsonb_typeof(v_op) <> 'object' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_name := btrim(coalesce(v_op->>'name', ''));
    -- A name outside the identity bounds, or carrying control characters, is a
    -- malformed member: skipped, never inserted. The Edge Function's reduction
    -- clamps to 40 chars, so this is defence in depth.
    if char_length(v_name) < 1 or char_length(v_name) > 40 or v_name ~ '[[:cntrl:]]' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Shirt number: null, or a whole number 1..99. An out of range value is
    -- dropped to null rather than failing the whole import (the shirt is
    -- advisory metadata, not identity).
    if jsonb_typeof(v_op->'shirt_number') = 'number' then
      begin
        v_shirt := (v_op->>'shirt_number')::numeric::int;
        if v_shirt::numeric <> (v_op->>'shirt_number')::numeric or v_shirt < 1 or v_shirt > 99 then
          v_shirt := null;
        end if;
      exception when others then
        v_shirt := null;
      end;
    else
      v_shirt := null;
    end if;

    v_key := lower(regexp_replace(v_name, '\s+', ' ', 'g'));

    -- Already registered on this team this season, or already inserted earlier
    -- in this same run (a namesake within the subgroup): do not insert again.
    if v_key = any (v_existing) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_key = any (v_seen) then
      -- The name only dedupe limitation: a second child with the same name in
      -- one Spond subgroup collapses to the first (documented, accepted).
      v_already := v_already + 1;
      continue;
    end if;
    v_seen := array_append(v_seen, v_key);

    v_new_pid := pg_catalog.gen_random_uuid();
    insert into public.players (id, club_id, display_name, created_by)
      values (v_new_pid, v_club, v_name, v_actor);
    insert into public.player_registrations
      (club_id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by)
      values (v_club, v_new_pid, v_season, p_team_id, 'pending', v_shirt, null, v_actor);
    v_added := v_added + 1;
  end loop;

  -- ============ One run summary through the private writer. The per row
  -- player.created and player.registration_created events came from the
  -- triggers above (source 'spond_import', batch id via the GUC); this is the
  -- one and only players.spond_imported event, and it is never a per row event.
  -- metadata carries safe server derived counts only (already_present is not on
  -- the 0030 allow list, so it lives on the returned result, not the metadata).
  v_meta := jsonb_build_object('rows_received', v_count, 'added', v_added, 'skipped', v_skipped, 'outcome', 'succeeded');
  perform public.log_audit_event(
    p_action      => 'players.spond_imported',
    p_entity_type => 'import_batch',
    p_source      => 'spond_import',
    p_entity_id   => p_batch_id,
    p_season_id   => v_season,
    p_team_id     => p_team_id,
    p_batch_id    => p_batch_id,
    p_metadata    => v_meta
  );

  return jsonb_build_object(
    'batch_id', p_batch_id, 'added', v_added, 'already_present', v_already,
    'skipped', v_skipped, 'outcome', 'succeeded'
  );
end;
$$;

comment on function public.spond_import_roster(uuid, uuid, jsonb) is
  $$The transactional, capability gated Spond squad commit path (0036_spond_and_renew.sql): SECURITY DEFINER, self gates on players.import, derives club and the current season server side (Spond is current-season-only), re validates the team belongs to the club, dedupes the reduced {name, shirt_number} roster by normalised name within (club, current season, team) against live registrations, inserts a new identity plus a Pending registration for every new name, and stamps source 'spond_import' plus the run batch id so the triggers emit per row player.created / player.registration_created and this function writes one players.spond_imported summary. Records NO import_batches row. Idempotent under a per (club, team) advisory lock. Sees only {name, shirt_number}, never a Spond member id. See docs/security/registered-players-boundary.md section 7 and docs/security/app-audit-boundary.md.$$;

revoke execute on function public.spond_import_roster(uuid, uuid, jsonb) from public, anon;
grant execute on function public.spond_import_roster(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- renew_registrations: the bulk Renew action. Copies chosen registrations from
-- a source season into a target season as Pending, carrying team and shirt
-- number forward and leaving registered_date empty, in one transaction, audited
-- as source 'renewal' with a shared batch id. It NEVER mutates the source
-- registration and NEVER updates an existing target registration: the unique
-- (player_id, season_id) constraint plus ON CONFLICT DO NOTHING make a repeat
-- run, a double submit or a retry idempotent per (player, season). It records
-- NO import_batches row; the batch id exists only on the audit events.
--
-- Signature: renew_registrations(p_batch_id uuid, p_source_season_id uuid,
--                                p_target_season_id uuid, p_player_ids uuid[]).
--   p_batch_id         the run's batch id (client minted); an audit grouping
--                      key only.
--   p_source_season_id the season the chosen registrations are read from; must
--                      belong to the caller's club (may be archived: reading is
--                      allowed).
--   p_target_season_id the season the new registrations are created in; must
--                      belong to the caller's club, be non archived, and differ
--                      from the source.
--   p_player_ids       the chosen player identities. A player with no
--                      registration in the source season, or outside the
--                      caller's club, is skipped (never renewed), so a forged
--                      or cross club id renews nothing.
--
-- Returns jsonb { batch_id, renewed, already_in_target, skipped,
--                 outcome ('succeeded') }.
-- ---------------------------------------------------------------------
create or replace function public.renew_registrations(
  p_batch_id         uuid,
  p_source_season_id uuid,
  p_target_season_id uuid,
  p_player_ids       uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_club     uuid := public.my_club();
  v_target   public.seasons;
  v_count    integer;
  v_pid      uuid;
  v_seen     uuid[] := array[]::uuid[];
  v_src_team uuid;
  v_src_shirt integer;
  v_found    boolean;
  v_new_id   uuid;
  v_renewed  integer := 0;
  v_already  integer := 0;
  v_skipped  integer := 0;
begin
  -- ============ Caller and capability (raise 42501) ========================
  if v_actor is null or v_club is null then
    raise exception 'renew_registrations: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('players.manage') then
    raise exception 'renew_registrations: requires the players.manage capability' using errcode = '42501';
  end if;

  -- ============ Seasons: both in the caller's club; different; target not
  -- archived. Cross club source or target is refused (derived club, not the
  -- payload). Renewing into the same season is refused. ====================
  if p_source_season_id = p_target_season_id then
    raise exception 'renew_registrations: source and target season must differ' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.seasons s where s.id = p_source_season_id and s.club_id = v_club) then
    raise exception 'renew_registrations: source season not found in your club' using errcode = '42501';
  end if;
  select * into v_target from public.seasons s where s.id = p_target_season_id and s.club_id = v_club;
  if not found then
    raise exception 'renew_registrations: target season not found in your club' using errcode = '42501';
  end if;
  if v_target.archived_at is not null then
    raise exception 'renew_registrations: the target season is archived and cannot be renewed into' using errcode = 'P0001';
  end if;

  -- ============ Payload: a bounded array of player ids ======================
  if p_player_ids is null then
    v_count := 0;
  else
    v_count := array_length(p_player_ids, 1);
    if v_count is null then v_count := 0; end if;
  end if;
  if v_count > 500 then
    raise exception 'renew_registrations: too many players in one renewal (the limit is 500)' using errcode = 'P0001';
  end if;

  if v_count = 0 then
    return jsonb_build_object('batch_id', p_batch_id, 'renewed', 0, 'already_in_target', 0, 'skipped', 0, 'outcome', 'succeeded');
  end if;

  -- ============ Stamp the audit context so the registration insert trigger
  -- records action 'player.renewed' (source 'renewal') plus the batch id. ====
  perform set_config('otj.audit_source', 'renewal', true);
  perform set_config('otj.audit_batch', p_batch_id::text, true);

  -- ============ Copy each chosen registration into the target season. Read
  -- team and shirt from the SOURCE registration (server authoritative, never
  -- the client); status Pending; registered_date empty. ON CONFLICT DO NOTHING
  -- makes an existing target registration a no op (already_in_target), so a
  -- repeat run or retry never duplicates. The source row is only read. ======
  foreach v_pid in array p_player_ids loop
    -- A repeated player id in one call is deduped so the count is honest.
    if v_pid = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_pid);

    select r.team_id, r.shirt_number into v_src_team, v_src_shirt
      from public.player_registrations r
      where r.player_id = v_pid and r.season_id = p_source_season_id and r.club_id = v_club;
    if not found then
      -- No registration for this player in the source season, or the id is
      -- outside the club: skipped, never renewed (a forged id renews nothing).
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_new_id := null;
    insert into public.player_registrations
      (club_id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by)
      values (v_club, v_pid, p_target_season_id, v_src_team, 'pending', v_src_shirt, null, v_actor)
      on conflict (player_id, season_id) do nothing
      returning id into v_new_id;
    if v_new_id is null then
      v_already := v_already + 1;
    else
      v_renewed := v_renewed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', p_batch_id, 'renewed', v_renewed, 'already_in_target', v_already,
    'skipped', v_skipped, 'outcome', 'succeeded'
  );
end;
$$;

comment on function public.renew_registrations(uuid, uuid, uuid, uuid[]) is
  $$The transactional, capability gated bulk Renew path (0036_spond_and_renew.sql): SECURITY DEFINER, self gates on players.manage, derives club and actor server side, validates the source and target seasons belong to the club (target non archived, source and target distinct), and copies each chosen registration from the source season into the target as Pending, carrying team and shirt number forward and leaving registered_date empty. Never mutates the source registration; ON CONFLICT DO NOTHING on the unique (player_id, season_id) makes a repeat, double submit or retry idempotent. Stamps source 'renewal' plus the run batch id so the registration insert trigger emits player.renewed. Records NO import_batches row. See docs/adr/ADR-0005-registered-players-and-seasons.md decision 10 and docs/security/registered-players-boundary.md.$$;

revoke execute on function public.renew_registrations(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.renew_registrations(uuid, uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless both functions exist,
-- are SECURITY DEFINER with an empty search_path, and are EXECUTE for
-- authenticated but not anon. No data assertions (both are pure commit paths).
-- ---------------------------------------------------------------------
do $$
begin
  -- spond_import_roster
  if to_regprocedure('public.spond_import_roster(uuid, uuid, jsonb)') is null then
    raise exception 'spond_and_renew: spond_import_roster was not created';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'spond_import_roster') then
    raise exception 'spond_and_renew: spond_import_roster must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'spond_import_roster'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'spond_and_renew: spond_import_roster must set search_path to empty';
  end if;
  if not has_function_privilege('authenticated', 'public.spond_import_roster(uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'spond_and_renew: authenticated cannot execute spond_import_roster';
  end if;
  if has_function_privilege('anon', 'public.spond_import_roster(uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'spond_and_renew: anon must not execute spond_import_roster';
  end if;

  -- renew_registrations
  if to_regprocedure('public.renew_registrations(uuid, uuid, uuid, uuid[])') is null then
    raise exception 'spond_and_renew: renew_registrations was not created';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'renew_registrations') then
    raise exception 'spond_and_renew: renew_registrations must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'renew_registrations'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'spond_and_renew: renew_registrations must set search_path to empty';
  end if;
  if not has_function_privilege('authenticated', 'public.renew_registrations(uuid, uuid, uuid, uuid[])', 'EXECUTE') then
    raise exception 'spond_and_renew: authenticated cannot execute renew_registrations';
  end if;
  if has_function_privilege('anon', 'public.renew_registrations(uuid, uuid, uuid, uuid[])', 'EXECUTE') then
    raise exception 'spond_and_renew: anon must not execute renew_registrations';
  end if;
end
$$;
