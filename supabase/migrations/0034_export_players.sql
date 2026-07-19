-- =====================================================================
-- OTJ Training Hub, migration 0034_export_players: the audited, capability
-- gated registered players export read path (Registered Players PR 4)
--
-- REVIEW REQUIRED. This file adds a new child data EGRESS path: export_players
-- returns children's names to a players.export holder and writes the one
-- server side record of that export. Migrations are gated. Run by hand via the
-- connector after line by line review, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge. No Edge Function
-- changes accompany this migration.
--
-- Numbering: PROVISIONAL 0034. The files on disk end at
-- 0033_players_legacy_columns.sql, which is MERGED BUT DEFERRED and NOT YET
-- APPLIED (the PR 3 legacy column drop, applied late per the delivery plan).
-- The live hosted ledger ends at 0032_registered_players. Per the standing
-- rule the ledger is the authority, and a merged but not yet applied migration
-- still counts as a taken slot, so the next free number confirmed against BOTH
-- the live ledger and the merged files together is 0034. Confirm 0034 is still
-- free against the live ledger immediately before applying. 0033 remains a
-- separate, deferred, unapplied step and is NOT applied by or with this
-- migration.
--
-- WHAT THIS IS. Decision D7 of the Registered Players programme, Export
-- (docs/adr/ADR-0007-player-import-export-architecture.md, "Export: RPC read,
-- client side file generation"; the product contract in
-- docs/product/registered-players-import-export.md, "Export"; the boundary in
-- docs/security/registered-players-boundary.md, section 10; the audit rule in
-- docs/security/app-audit-boundary.md, "Export audit"). Export mirrors the
-- import split: the server is the authority for what data leaves and for the
-- audit record; the client does the file mechanics (CSV and XLSX generation
-- and the download). This migration adds ONLY the read RPC. It creates no
-- table, no trigger, and changes no policy; import_players, import_batches and
-- the Spond commit RPC arrive in later PRs.
--
-- CHILD DATA EGRESS, and how it is bounded:
--   * export_players returns display_name (a child's full name) to the caller,
--     so the gate is players.export (managers and admins by default), re
--     checked in the function body because a SECURITY DEFINER function is NOT
--     bound by RLS. It fails closed.
--   * read is CLUB WIDE with no team arm (docs/security/registered-players-
--     boundary.md, sections 3 and 10). The team, status and name search
--     filters are the caller's VIEW filter, not an access control; the only
--     access scope enforced is capability plus club.
--   * the audit event it writes is the last server side moment a record of the
--     export can be guaranteed. It carries counts and a SAFE filter summary
--     only, NEVER a name, a row, or the search string. A search string can
--     contain a child's name, so only a boolean "a search was applied" is
--     recorded, never the text (docs/security/app-audit-boundary.md, Export
--     audit; the metadata is validated against audit_metadata_ok in the
--     private writer log_audit_event).
--   * the dataset is never stored server side: there is no export file, no
--     download URL, no server copy. A failed export rolls the transaction back
--     and writes no event; only a successful read is recorded.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0032 form): SECURITY DEFINER with set
-- search_path = '' and fully schema qualified references, so no caller
-- controlled search path can redirect a reference; EXECUTE granted to
-- authenticated (self gating in body, the member_states shape) and revoked
-- from anon and public; the migration self verifies with a DO block before it
-- commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- export_players: the audited, club scoped export read. SECURITY DEFINER so it
-- can write the audit event through the private log_audit_event writer (which
-- clients cannot call); the capability and club checks in the body are the
-- enforcement, not RLS. It returns the eight source columns the client shapes
-- into the export file (docs/product/registered-players-import-export.md,
-- Export column order); Last Updated is updated_at, Team resolves to the team
-- name (empty for Unassigned), and Registration Status is returned lower case
-- and capitalised client side.
--
-- p_filters is a small jsonb the client sends: the resolved view filter and the
-- declared format. Recognised keys:
--   * format   : 'csv' | 'xlsx'                 (declared, recorded in the audit)
--   * team     : 'all' | 'unassigned' | <uuid>  (the team view filter)
--   * statuses : text[] subset of the status vocabulary (the status view filter)
--   * search   : text                           (the name search; used transiently
--                                                 to filter, NEVER persisted or logged)
-- An absent or malformed value falls back to the widest safe default (all
-- statuses, all teams, no search), so a hand built payload never widens access
-- beyond the club scope and never errors on a missing key.
-- ---------------------------------------------------------------------
create or replace function public.export_players(
  p_season_id uuid,
  p_filters   jsonb default '{}'::jsonb
)
returns table (
  player_id       uuid,
  player_name     text,
  season_name     text,
  team_id         uuid,
  team_name       text,
  status          text,
  shirt_number    integer,
  registered_date date,
  updated_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid := auth.uid();
  v_club           uuid := public.my_club();
  v_season         public.seasons;
  v_format         text := coalesce(p_filters->>'format', 'csv');
  v_team           text := coalesce(p_filters->>'team', 'all');
  v_team_id        uuid;
  v_search         text := btrim(coalesce(p_filters->>'search', ''));
  v_search_applied boolean;
  v_like           text;
  v_statuses       text[];
  v_count          bigint;
  v_meta           jsonb;
begin
  -- Authn and club. A caller with no session or no club is refused.
  if v_actor is null or v_club is null then
    raise exception 'export_players: not signed in to a club' using errcode = '42501';
  end if;

  -- Capability. SECURITY DEFINER is not bound by RLS, so this in body check is
  -- the enforcement and it fails closed. A players.view holder without
  -- players.export (a coach, by default) is refused here even though they may
  -- read the same rows in the app; the sanctioned, audited egress path is this
  -- RPC alone.
  if not public.has_perm('players.export') then
    raise exception 'export_players: requires the players.export capability' using errcode = '42501';
  end if;

  -- Declared format vocabulary. Also enforced by audit_metadata_ok on the
  -- audit write; checked here so the refusal is a clean, early error.
  if v_format not in ('csv', 'xlsx') then
    raise exception 'export_players: format must be csv or xlsx' using errcode = 'P0001';
  end if;

  -- The season must belong to the caller's club. ANY season is exportable,
  -- including an archived or non current one: a past register is a legitimate
  -- export, so only the club scope is enforced (unlike import, which refuses an
  -- archived season). A cross club or unknown id is refused, closing cross club
  -- id injection (docs/security/registered-players-boundary.md, section 9).
  select * into v_season from public.seasons s
    where s.id = p_season_id and s.club_id = v_club;
  if not found then
    raise exception 'export_players: season not found in your club' using errcode = '42501';
  end if;

  -- Resolve the status view filter. Absent or malformed -> every status (no
  -- narrowing). Only vocabulary values are kept, so a junk value cannot error.
  if jsonb_typeof(p_filters->'statuses') = 'array' then
    select array_agg(value) into v_statuses
    from jsonb_array_elements_text(p_filters->'statuses') as e(value)
    where value in ('pending', 'registered', 'withdrawn');
  end if;
  if v_statuses is null or array_length(v_statuses, 1) is null then
    v_statuses := array['pending', 'registered', 'withdrawn'];
  end if;

  -- Resolve the team view filter. 'all' -> no team arm; 'unassigned' ->
  -- team_id is null; a uuid -> that team; anything else -> 'all'. There is no
  -- team scope on ACCESS (read is club wide); this is a view filter only.
  if v_team ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_team_id := v_team::uuid;
  end if;

  -- The name search matches the client's plain case insensitive substring
  -- (playersView.filterRows): trim, then a LIKE with the LIKE metacharacters
  -- escaped so '%' or '_' in a name is a literal, not a wildcard. The text is
  -- used ONLY to filter here and is never stored or logged.
  v_search_applied := v_search <> '';
  v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Count the rows the export will contain, over the SAME predicate as the
  -- returned set, so the audited record_count is exactly what leaves.
  select count(*) into v_count
  from public.player_registrations r
  join public.players p on p.id = r.player_id
  where r.club_id = v_club
    and r.season_id = p_season_id
    and r.status = any (v_statuses)
    and (
      v_team = 'all'
      or (v_team = 'unassigned' and r.team_id is null)
      or (v_team_id is not null and r.team_id = v_team_id)
    )
    and (not v_search_applied or p.display_name ilike v_like);

  -- The safe filter summary and export facts. NEVER the search string or any
  -- name: only a boolean that a search was applied, the team id filter (a uuid,
  -- absent for All or Unassigned), the status set, the count, the format and
  -- the season. audit_metadata_ok rejects any other key, failing closed.
  v_meta := jsonb_build_object(
    'record_count', v_count,
    'format', v_format,
    'season_id', p_season_id,
    'status_filter', to_jsonb(v_statuses),
    'name_search_applied', v_search_applied
  );
  if v_team_id is not null then
    v_meta := v_meta || jsonb_build_object('team_id_filter', v_team_id);
  end if;

  -- The audit event rides the read, in the same transaction: action
  -- players.exported, entity_type export, entity_id null, source manual
  -- (docs/security/app-audit-boundary.md, Export audit). log_audit_event
  -- derives actor, actor_name, club and occurred_at server side and validates
  -- the metadata against the safe allow list; a supplied club is ignored for a
  -- signed in caller. If the client then fails to build the file, the record
  -- still stands (over record, the safe direction for child data).
  perform public.log_audit_event(
    p_action      => 'players.exported',
    p_entity_type => 'export',
    p_source      => 'manual',
    p_season_id   => p_season_id,
    p_metadata    => v_meta
  );

  -- Return the authorised dataset. Read is club wide (no team arm on access);
  -- the team, status and search filters are the caller's view filter. Ordered
  -- by name then player id for a deterministic export.
  return query
    select
      p.id,
      p.display_name,
      v_season.name,
      r.team_id,
      coalesce(t.name, ''),
      r.status,
      r.shirt_number,
      r.registered_date,
      r.updated_at
    from public.player_registrations r
    join public.players p on p.id = r.player_id
    left join public.teams t on t.id = r.team_id
    where r.club_id = v_club
      and r.season_id = p_season_id
      and r.status = any (v_statuses)
      and (
        v_team = 'all'
        or (v_team = 'unassigned' and r.team_id is null)
        or (v_team_id is not null and r.team_id = v_team_id)
      )
      and (not v_search_applied or p.display_name ilike v_like)
    order by p.display_name, p.id;
end;
$$;

comment on function public.export_players(uuid, jsonb) is
  $$The audited, club scoped registered players export read (0034_export_players.sql): SECURITY DEFINER, self gates on players.export, derives club and actor server side, validates the season belongs to the caller's club (any season, archived included), applies the caller's team/status/name-search VIEW filter under the club wide read scope (no team access arm), writes one players.exported audit event in the same transaction (source manual, entity_type export, entity_id null, a safe filter summary that never carries the search string or a name), and returns the eight source columns the client shapes into the CSV or XLSX file. The dataset is never stored server side. See docs/adr/ADR-0007-player-import-export-architecture.md and docs/security/app-audit-boundary.md.$$;

-- PostgREST exposes public functions as RPC to anon and authenticated; the
-- authorising work is in the body, so keep EXECUTE for authenticated but deny
-- anon and public. service_role keeps it for maintenance.
revoke execute on function public.export_players(uuid, jsonb) from public, anon;
grant execute on function public.export_players(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the RPC is exactly as
-- intended. No data assertions: this migration adds only a function.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.export_players(uuid, jsonb)') is null then
    raise exception 'export_players: the function was not created';
  end if;

  -- SECURITY DEFINER with an empty search_path.
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'export_players') then
    raise exception 'export_players: must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'export_players'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'export_players: must set search_path to empty';
  end if;

  -- EXECUTE for authenticated, not anon.
  if not has_function_privilege('authenticated', 'public.export_players(uuid, jsonb)', 'EXECUTE') then
    raise exception 'export_players: authenticated cannot execute';
  end if;
  if has_function_privilege('anon', 'public.export_players(uuid, jsonb)', 'EXECUTE') then
    raise exception 'export_players: anon must not execute';
  end if;
end
$$;
