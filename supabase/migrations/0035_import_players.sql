-- =====================================================================
-- OTJ Training Hub, migration 0035_import_players: the transactional,
-- idempotent, capability gated spreadsheet import commit path (Registered
-- Players PR 5, write half)
--
-- REVIEW REQUIRED. This file adds a child data WRITE path: import_players
-- creates and updates children's identities and registrations from a
-- confirmed spreadsheet import, and import_batches records each attempt.
-- Migrations are gated. Run by hand via the connector after line by line
-- review, and only once the live ledger is confirmed to have this slot free.
-- Do not auto-merge. No Edge Function changes accompany this migration.
--
-- Numbering: PROVISIONAL 0035. The files on disk end at
-- 0034_export_players.sql; 0033_players_legacy_columns.sql is MERGED BUT
-- DEFERRED and NOT YET APPLIED (the PR 3 legacy column drop, applied late per
-- the delivery plan). The live hosted ledger ends at export_players (0034),
-- with players_legacy_columns (0033) intentionally absent. Per the standing
-- rule the ledger is the authority, and a merged but not yet applied migration
-- still counts as a taken slot, so the next free number confirmed against BOTH
-- the live ledger and the merged files together is 0035. Confirm 0035 is still
-- free against the live ledger immediately before applying. 0033 remains a
-- separate, deferred, unapplied step and is NOT applied by or with this
-- migration.
--
-- WHAT THIS IS. Decision D7 of the Registered Players programme, the import
-- commit (docs/adr/ADR-0007-player-import-export-architecture.md, "Commit
-- path: one transactional SECURITY DEFINER RPC" and "The import_batches
-- table"; the product contract in docs/product/registered-players-import-
-- export.md, "Import transaction and server authority"; the boundary in
-- docs/security/registered-players-boundary.md, section 4 "import_batches";
-- the audit rule in docs/security/app-audit-boundary.md, "Import audit"; the
-- threats in docs/security/registered-players-threat-model.md, T3, T7 to T14,
-- T19). The browser parses, validates and previews the file entirely client
-- side (PR 5, merged); this migration adds the one authoritative commit path.
-- It creates the import_batches bookkeeping table and the import_players RPC,
-- and changes no existing policy, table or trigger. The Spond commit RPC and
-- renew_registrations arrive in a later PR and record no import_batches row.
--
-- CHILD DATA WRITE, and how it is bounded:
--   * import_players creates children's identities (public.players) and their
--     seasonal registrations (public.player_registrations), so the gate is
--     players.import (managers and admins by default), re checked in the
--     function body because a SECURITY DEFINER function is NOT bound by RLS. It
--     fails closed.
--   * the SERVER is authoritative and re validates every proposed row,
--     unbound by the client preview: club and actor are derived server side,
--     the season must belong to the caller's club and be non archived, every
--     team id and existing player id must belong to the caller's club, every
--     status, shirt and date is re checked, and every status transition is re
--     validated. Nothing identity or authority shaped is trusted from the
--     payload (T3, T8, T10 to T13).
--   * the commit is ALL OR NOTHING inside one transaction: business writes and
--     their per row audit events run in an inner subtransaction, so any row
--     failure rolls every one of them back (T9). No partial import, ever.
--   * idempotency is the client minted batch id, unique in import_batches: a
--     repeated call with the same id returns the stored terminal result and
--     applies nothing, so a lost response, a timeout or a double click is safe
--     (T7, T8, T14). A batch id recorded for another club is refused, never
--     replayed and never re applied under that id (T14).
--   * import_batches and the audit events carry SAFE counts, format and
--     outcome ONLY: never a child name, a file name, file contents, a raw row,
--     a search string or a file fingerprint (the server never receives the
--     file bytes). The failure summary names a row NUMBER and a fixed reason,
--     never row content.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0034 form): SECURITY DEFINER with set
-- search_path = '' and fully schema qualified references, so no caller
-- controlled search path can redirect a reference; EXECUTE granted to
-- authenticated (self gating in body, the member_states shape) and revoked
-- from anon and public; the table's writes are the definer RPC's alone (no
-- client write grant or policy, the audit_events append only precedent); the
-- migration self verifies with a DO block before it commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- import_batches: the app's first idempotency mechanism, scoped to spreadsheet
-- imports alone. One row per confirmed import attempt, keyed on the client
-- minted batch uuid. It records actor, club, season, format, terminal state and
-- server derived counts, and a safe failure summary. By design there is NO file
-- fingerprint column (the server never receives the file bytes), no filename
-- column (a filename can itself carry personal data), no row content, no names
-- and no raw validation text. Shape and idempotency contract:
-- docs/adr/ADR-0007-player-import-export-architecture.md; read contract:
-- docs/security/registered-players-boundary.md section 4.
-- ---------------------------------------------------------------------
create table public.import_batches (
  -- Client minted uuid v4, one per produced preview; the idempotency key and
  -- the primary key, so a replay collides here and returns the stored result.
  id              uuid primary key,
  -- Denormalised tenancy, stamped server side from my_club(), never the
  -- payload. Cascades with the club, matching every club scoped table.
  club_id         uuid not null references public.clubs (id) on delete cascade,
  -- auth.uid() at claim time; nullable ON DELETE SET NULL so removing the
  -- acting member never deletes the batch record.
  actor_id        uuid references public.profiles (id) on delete set null,
  -- The validated non archived season the import targeted. FK keeps integrity;
  -- the in body check enforces club membership before the row is inserted.
  season_id       uuid not null references public.seasons (id) on delete cascade,
  -- The uploaded file's format, the table's whole vocabulary (spreadsheet
  -- imports only). Drives the csv_import / xlsx_import audit source.
  format          text not null check (format in ('csv', 'xlsx')),
  -- Claimed as pending, then moved to exactly one terminal state.
  state           text not null default 'pending'
                    check (state in ('pending', 'succeeded', 'failed')),
  -- Server derived counts, never trusted from the preview. rows_received is the
  -- count of submitted operations; added, updated, already_present and
  -- resolved_new are re derived while applying; skipped and invalid are 0 on a
  -- successful all or nothing commit (the client withholds skipped and invalid
  -- rows, and any invalid submitted row aborts the whole batch). They exist for
  -- schema completeness and future non spreadsheet writers.
  rows_received   integer not null default 0,
  added           integer not null default 0,
  updated         integer not null default 0,
  already_present integer not null default 0,
  resolved_new    integer not null default 0,
  skipped         integer not null default 0,
  invalid         integer not null default 0,
  -- A SAFE reason on the failed state: a row NUMBER and a fixed reason only,
  -- never row content, a name or the file bytes. Null on pending and succeeded.
  failure_summary text,
  created_at      timestamptz not null default now(),
  -- Set when the batch reaches a terminal state; null while pending.
  settled_at      timestamptz
);

create index import_batches_club_created_idx
  on public.import_batches (club_id, created_at desc);

comment on table public.import_batches is
  $$One row per confirmed spreadsheet import attempt (0035_import_players.sql), keyed on the client minted batch uuid, the app's only idempotency mechanism. Records actor, club, season, format (csv or xlsx), terminal state (pending, succeeded, failed) and server derived counts, plus a safe failure summary (a row number and a fixed reason, never row content). By design there is NO file fingerprint (the server never receives the file bytes), no filename, no row content, no names. Written only from inside the import_players RPC; authenticated clients hold SELECT only, gated by import_batches_select_view to club_id = my_club() and has_perm('audit.view'). A repeated import_players call with the same batch id returns the stored terminal result (replay requires the RPC's own gate, not audit.view); a batch id recorded for another club is refused. See docs/adr/ADR-0007-player-import-export-architecture.md and docs/security/registered-players-boundary.md section 4.$$;

comment on column public.import_batches.failure_summary is
  $$A SAFE failure reason on the failed state: names a row NUMBER and a fixed reason from a bounded vocabulary, never a child name, row content, the file name or the file bytes. Null on pending and succeeded. See 0035_import_players.sql.$$;

-- ---------------------------------------------------------------------
-- Grants and RLS. Reads only for authenticated, gated on audit.view plus club
-- (the import history contract, docs/security/registered-players-boundary.md
-- section 4). No insert, update or delete policy or grant for any client role:
-- the table is written only from inside the import_players RPC, which runs as
-- its owner. Revoke everything first (so no platform default privilege leaks on
-- a local stack that auto grants ALL), then grant back SELECT alone.
-- ---------------------------------------------------------------------
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;

alter table public.import_batches enable row level security;

create policy "import_batches_select_view" on public.import_batches
  for select using (
    club_id = public.my_club()
    and public.has_perm('audit.view')
  );
-- No insert, update or delete policies. The append only property is by
-- construction: the missing grants refuse before RLS is consulted, and the
-- only write path is the definer RPC.

-- ---------------------------------------------------------------------
-- import_players: the one transactional commit path for a spreadsheet import.
-- SECURITY DEFINER so it can write import_batches, the players domain and the
-- private log_audit_event writer as its owner; the in body capability and club
-- checks are the enforcement, not RLS. set search_path = '' with schema
-- qualified references throughout. EXECUTE granted to authenticated (self
-- gating), revoked from anon and public.
--
-- Signature: import_players(p_batch_id uuid, p_season_id uuid, p_rows jsonb),
-- exactly as decided in ADR-0007. p_rows carries the whole confirmed payload as
-- one jsonb object so the fixed three argument signature holds while the format
-- travels with the rows:
--   {
--     "format": "csv" | "xlsx",
--     "rows": [ <operation>, ... ]
--   }
-- Each operation is the MINIMUM normalised proposed write, never a classified
-- preview row. The server derives the operation kind from the presence of a
-- player id (never a client "op" label), and re derives every outcome:
--   * an UPDATE op carries a player_id (an existing identity in the caller's
--     club) and the desired registration fields; no name (import never
--     renames);
--   * a NEW op carries a name and the desired registration fields and no
--     player_id.
--   { "row": <int>,                     -- the file row number, for error text
--     "player_id": <uuid> | null,       -- present => update by id
--     "name": <text> | null,            -- present => new identity
--     "team_id": <uuid> | null,         -- null => Unassigned
--     "status": "pending"|"registered"|"withdrawn",
--     "shirt_number": <1..99> | null,
--     "registered_date": "YYYY-MM-DD" | null }
--
-- Returns a jsonb result the client shows on the outcome screen:
--   { batch_id, outcome ('succeeded'|'failed'), rows_received, added, updated,
--     already_present, resolved_new, skipped, invalid, failure_summary,
--     settled_at }
-- On a row failure the RPC RETURNS a failed result (it does not raise), so the
-- failed batch record and its players.import_failed event COMMIT and a replay
-- returns the stored failure. Only caller, envelope, season and batch id
-- problems RAISE (no batch recorded): those are request level refusals.
-- ---------------------------------------------------------------------
create or replace function public.import_players(
  p_batch_id  uuid,
  p_season_id uuid,
  p_rows      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_club     uuid := public.my_club();
  v_season   public.seasons;
  v_format   text;
  v_source   text;
  v_ops      jsonb;
  v_count    integer;
  v_existing public.import_batches;

  -- per operation working set
  v_i        integer;
  v_op       jsonb;
  v_op_row   integer;
  v_pid_txt  text;
  v_pid      uuid;
  v_name     text;
  v_team_txt text;
  v_team     uuid;
  v_status   text;
  v_shirt    integer;
  v_date_txt text;
  v_date     date;
  v_new_pid  uuid;
  v_reg      public.player_registrations;

  -- accumulated server derived counts (meaningful only on success)
  v_added        integer := 0;
  v_updated      integer := 0;
  v_already      integer := 0;
  v_resolved_new integer := 0;

  -- duplicate operation guard and resolved_new snapshot
  v_seen_pids uuid[] := array[]::uuid[];
  v_existing_names text[] := array[]::text[];

  -- failure bookkeeping
  v_outcome     text := 'succeeded';
  v_fail_row    integer;
  v_fail_reason text;
  v_summary     text;
  v_meta        jsonb;
  v_result      jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- ============ PRE-FLIGHT: caller (raise 42501, no batch recorded) ========
  if v_actor is null or v_club is null then
    raise exception 'import_players: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('players.import') then
    raise exception 'import_players: requires the players.import capability' using errcode = '42501';
  end if;

  -- ============ REPLAY CHECK (before season validation, so a completed batch
  -- replays regardless of the season's current state; T7, T8, T14) ==========
  select * into v_existing from public.import_batches b where b.id = p_batch_id for update;
  if found then
    if v_existing.club_id is distinct from v_club then
      -- A batch id recorded for another club: a refusal, never a replay of the
      -- other club's result and never a fresh import under that id (T14).
      raise exception 'import_players: this import reference is not available' using errcode = 'P0001';
    end if;
    if v_existing.state = 'pending' then
      -- We hold the row lock yet it is still pending: the claiming transaction
      -- ended without finalising (anomalous). Refuse rather than risk double
      -- application; the client retries and observes the terminal state.
      raise exception 'import_players: this import is still in progress; retry shortly' using errcode = 'P0001';
    end if;
    -- Terminal (succeeded or failed): return the stored result, apply nothing.
    return jsonb_build_object(
      'batch_id', v_existing.id, 'outcome', v_existing.state,
      'rows_received', v_existing.rows_received, 'added', v_existing.added,
      'updated', v_existing.updated, 'already_present', v_existing.already_present,
      'resolved_new', v_existing.resolved_new, 'skipped', v_existing.skipped,
      'invalid', v_existing.invalid, 'failure_summary', v_existing.failure_summary,
      'settled_at', v_existing.settled_at
    );
  end if;

  -- ============ PRE-FLIGHT: envelope (raise, no batch recorded) =============
  if p_rows is null or jsonb_typeof(p_rows) <> 'object' then
    raise exception 'import_players: the import payload is malformed' using errcode = 'P0001';
  end if;
  v_format := p_rows->>'format';
  if v_format is null or v_format not in ('csv', 'xlsx') then
    raise exception 'import_players: the import format must be csv or xlsx' using errcode = 'P0001';
  end if;
  v_source := case v_format when 'csv' then 'csv_import' else 'xlsx_import' end;
  v_ops := p_rows->'rows';
  if v_ops is null or jsonb_typeof(v_ops) <> 'array' then
    raise exception 'import_players: the import payload is malformed' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(v_ops);
  if v_count = 0 then
    raise exception 'import_players: there are no rows to import' using errcode = 'P0001';
  end if;
  if v_count > 500 then
    raise exception 'import_players: too many rows in one import (the limit is 500)' using errcode = 'P0001';
  end if;

  -- ============ PRE-FLIGHT: season (raise, no batch recorded; T3, T13) ======
  select * into v_season from public.seasons s where s.id = p_season_id and s.club_id = v_club;
  if not found then
    -- Cross club or unknown: refused without confirming existence elsewhere.
    raise exception 'import_players: season not found in your club' using errcode = '42501';
  end if;
  if v_season.archived_at is not null then
    raise exception 'import_players: the selected season is archived and cannot be imported into' using errcode = 'P0001';
  end if;

  -- ============ CLAIM the batch (pending). A concurrent same id call blocks on
  -- the unique index at INSERT, then replays the committed terminal result. =====
  begin
    insert into public.import_batches (id, club_id, actor_id, season_id, format, state)
      values (p_batch_id, v_club, v_actor, p_season_id, v_format, 'pending');
  exception when unique_violation then
    select * into v_existing from public.import_batches b where b.id = p_batch_id for update;
    if v_existing.club_id is distinct from v_club then
      raise exception 'import_players: this import reference is not available' using errcode = 'P0001';
    end if;
    if v_existing.state = 'pending' then
      raise exception 'import_players: this import is still in progress; retry shortly' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'batch_id', v_existing.id, 'outcome', v_existing.state,
      'rows_received', v_existing.rows_received, 'added', v_existing.added,
      'updated', v_existing.updated, 'already_present', v_existing.already_present,
      'resolved_new', v_existing.resolved_new, 'skipped', v_existing.skipped,
      'invalid', v_existing.invalid, 'failure_summary', v_existing.failure_summary,
      'settled_at', v_existing.settled_at
    );
  end;

  -- ============ INNER SUBTRANSACTION: apply every row and its audit events.
  -- Any failure rolls ALL of them back (all or nothing, T9) and the outer
  -- function then records the batch as failed. The batch pending row inserted
  -- above sits OUTSIDE this savepoint and survives the rollback. =============
  begin
    -- Stamp the per row audit context so the players and registration triggers
    -- record source csv_import / xlsx_import and this run's batch id. A browser
    -- cannot set these GUCs (no exposed set_config, no RPC forwards them); they
    -- are provenance labelling only, bounded by the audit_events.source CHECK.
    perform set_config('otj.audit_source', v_source, true);
    perform set_config('otj.audit_batch', p_batch_id::text, true);

    -- Snapshot the season's existing registration names, so a new identity
    -- whose name already exists in the season counts as resolved_new (the user
    -- chose Import as new despite a collision). Case and whitespace folded; this
    -- is a server derived count only and never changes a write decision.
    select coalesce(array_agg(distinct lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g'))), array[]::text[])
      into v_existing_names
      from public.player_registrations r
      join public.players p on p.id = r.player_id
      where r.club_id = v_club and r.season_id = p_season_id;

    for v_i in 0 .. v_count - 1 loop
      v_op := v_ops->v_i;
      v_fail_reason := null;
      v_op_row := v_i + 1;
      if jsonb_typeof(v_op) = 'object' and jsonb_typeof(v_op->'row') = 'number' then
        v_op_row := (v_op->>'row')::int;
      end if;

      if v_op is null or jsonb_typeof(v_op) <> 'object' then
        v_fail_reason := 'the import payload is malformed.';
        raise exception 'row_failed' using errcode = 'P0001';
      end if;

      -- status vocabulary
      v_status := v_op->>'status';
      if v_status is null or v_status not in ('pending', 'registered', 'withdrawn') then
        v_fail_reason := 'the registration status is not recognised.';
        raise exception 'row_failed' using errcode = 'P0001';
      end if;

      -- shirt number: null, or a whole number 1..99
      if jsonb_typeof(v_op->'shirt_number') = 'null' or (v_op->'shirt_number') is null then
        v_shirt := null;
      elsif jsonb_typeof(v_op->'shirt_number') = 'number' then
        v_shirt := (v_op->>'shirt_number')::numeric::int;
        if v_shirt::numeric <> (v_op->>'shirt_number')::numeric or v_shirt < 1 or v_shirt > 99 then
          v_fail_reason := 'the shirt number must be a whole number from 1 to 99.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
      else
        v_fail_reason := 'the shirt number must be a whole number from 1 to 99.';
        raise exception 'row_failed' using errcode = 'P0001';
      end if;

      -- registered date: null, or a real ISO date
      v_date_txt := v_op->>'registered_date';
      if v_date_txt is null then
        v_date := null;
      else
        begin
          v_date := v_date_txt::date;
        exception when others then
          v_fail_reason := 'the registered date is not valid.';
          raise exception 'row_failed' using errcode = 'P0001';
        end;
      end if;

      -- team: null (Unassigned), or a uuid that is a team of the caller's club
      v_team := null;
      if jsonb_typeof(v_op->'team_id') <> 'null' and (v_op->'team_id') is not null then
        v_team_txt := lower(v_op->>'team_id');
        if v_team_txt !~ uuid_re then
          v_fail_reason := 'the team is not recognised.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        v_team := v_team_txt::uuid;
        if not exists (select 1 from public.teams t where t.id = v_team and t.club_id = v_club) then
          v_fail_reason := 'the team is not in your club.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
      end if;

      -- kind: an update carries a player id, a new op carries a name
      v_pid_txt := v_op->>'player_id';
      if v_pid_txt is not null and v_pid_txt <> '' then
        -- ---------- UPDATE by player id ----------
        v_pid_txt := lower(v_pid_txt);
        if v_pid_txt !~ uuid_re then
          v_fail_reason := 'the player reference is not valid.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        v_pid := v_pid_txt::uuid;
        -- Cross club or unknown id: refused without confirming it exists
        -- elsewhere (T3). This is the only ownership check the update needs.
        if not exists (select 1 from public.players p where p.id = v_pid and p.club_id = v_club) then
          v_fail_reason := 'the player is not in your club.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        -- One operation per registration: a player id may appear once (T19 sibling).
        if v_pid = any (v_seen_pids) then
          v_fail_reason := 'this player appears more than once in the import.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        v_seen_pids := array_append(v_seen_pids, v_pid);

        select * into v_reg from public.player_registrations r
          where r.player_id = v_pid and r.season_id = p_season_id and r.club_id = v_club;
        if found then
          -- Re validate the status transition against the STORED status (the
          -- same rule the trigger enforces; pre checked for a clean reason).
          if v_status <> v_reg.status and not (
               (v_reg.status = 'pending'    and v_status in ('registered', 'withdrawn'))
            or (v_reg.status = 'registered' and v_status = 'withdrawn')
            or (v_reg.status = 'withdrawn'  and v_status in ('pending', 'registered'))
          ) then
            v_fail_reason := 'the registration status change is not allowed.';
            raise exception 'row_failed' using errcode = 'P0001';
          end if;
          -- Already present (no write) when every field equals the stored row;
          -- otherwise an update. Re derived server side against live data, so a
          -- stale preview commits the truth, not the preview (T10).
          if v_reg.team_id is not distinct from v_team
             and v_reg.status = v_status
             and v_reg.shirt_number is not distinct from v_shirt
             and v_reg.registered_date is not distinct from v_date then
            v_already := v_already + 1;
          else
            update public.player_registrations r
              set team_id = v_team, status = v_status, shirt_number = v_shirt, registered_date = v_date
              where r.id = v_reg.id and r.club_id = v_club;
            v_updated := v_updated + 1;
          end if;
        else
          -- The identity is in the club but has no registration this season:
          -- the row creates it (still an update by id, never a name merge).
          insert into public.player_registrations
            (club_id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by)
            values (v_club, v_pid, p_season_id, v_team, v_status, v_shirt, v_date, v_actor);
          v_updated := v_updated + 1;
        end if;
      else
        -- ---------- NEW identity and registration ----------
        v_name := btrim(coalesce(v_op->>'name', ''));
        if char_length(v_name) < 1 or char_length(v_name) > 40 then
          v_fail_reason := 'the player name must be between 1 and 40 characters.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        if v_name ~ '[[:cntrl:]]' then
          v_fail_reason := 'the player name contains characters that are not allowed.';
          raise exception 'row_failed' using errcode = 'P0001';
        end if;
        v_new_pid := pg_catalog.gen_random_uuid();
        insert into public.players (id, club_id, display_name, created_by)
          values (v_new_pid, v_club, v_name, v_actor);
        insert into public.player_registrations
          (club_id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by)
          values (v_club, v_new_pid, p_season_id, v_team, v_status, v_shirt, v_date, v_actor);
        v_added := v_added + 1;
        if lower(regexp_replace(btrim(v_name), '\s+', ' ', 'g')) = any (v_existing_names) then
          v_resolved_new := v_resolved_new + 1;
        end if;
      end if;
    end loop;

    v_outcome := 'succeeded';
  exception
    when others then
      -- Any failure (a controlled row refusal, a cast error, a trigger P0001 or
      -- a constraint) rolls back every business and per row audit write. The
      -- row number is v_op_row; the reason is the controlled v_fail_reason when
      -- set, else a generic sentence. Never row content.
      v_outcome := 'failed';
      v_fail_row := v_op_row;
  end;

  -- ============ FINALISE (outer scope, commits with the batch pending row). ==
  if v_outcome = 'succeeded' then
    update public.import_batches set
      state = 'succeeded', rows_received = v_count,
      added = v_added, updated = v_updated, already_present = v_already,
      resolved_new = v_resolved_new, skipped = 0, invalid = 0,
      failure_summary = null, settled_at = now()
    where id = p_batch_id;
    -- The batch summary event. metadata carries the safe count vocabulary the
    -- 0030 audit_metadata_ok allow list permits; already_present is not in that
    -- allow list, so it lives on the batch row and the returned result, not the
    -- audit metadata. entity_type import_batch, entity_id the batch id, source
    -- csv_import / xlsx_import (docs/security/app-audit-boundary.md, Import audit).
    v_meta := jsonb_build_object(
      'rows_received', v_count, 'added', v_added, 'updated', v_updated,
      'resolved_new', v_resolved_new, 'skipped', 0, 'invalid', 0,
      'format', v_format, 'outcome', 'succeeded'
    );
    perform public.log_audit_event(
      p_action      => 'players.import_completed',
      p_entity_type => 'import_batch',
      p_source      => v_source,
      p_entity_id   => p_batch_id,
      p_season_id   => p_season_id,
      p_batch_id    => p_batch_id,
      p_metadata    => v_meta
    );
  else
    v_summary := coalesce(
      case when v_fail_row is not null
        then 'Row ' || v_fail_row || ': ' || coalesce(v_fail_reason, 'this row could not be imported.')
        else v_fail_reason end,
      'The import could not be completed. No changes were made.'
    );
    update public.import_batches set
      state = 'failed', rows_received = v_count,
      added = 0, updated = 0, already_present = 0, resolved_new = 0, skipped = 0, invalid = 0,
      failure_summary = left(v_summary, 300), settled_at = now()
    where id = p_batch_id;
    v_meta := jsonb_build_object('outcome', 'failed', 'format', v_format);
    perform public.log_audit_event(
      p_action      => 'players.import_failed',
      p_entity_type => 'import_batch',
      p_source      => v_source,
      p_entity_id   => p_batch_id,
      p_season_id   => p_season_id,
      p_batch_id    => p_batch_id,
      p_metadata    => v_meta
    );
  end if;

  select * into v_existing from public.import_batches b where b.id = p_batch_id;
  return jsonb_build_object(
    'batch_id', v_existing.id, 'outcome', v_existing.state,
    'rows_received', v_existing.rows_received, 'added', v_existing.added,
    'updated', v_existing.updated, 'already_present', v_existing.already_present,
    'resolved_new', v_existing.resolved_new, 'skipped', v_existing.skipped,
    'invalid', v_existing.invalid, 'failure_summary', v_existing.failure_summary,
    'settled_at', v_existing.settled_at
  );
end;
$$;

comment on function public.import_players(uuid, uuid, jsonb) is
  $$The one transactional, idempotent, capability gated spreadsheet import commit path (0035_import_players.sql): SECURITY DEFINER, self gates on players.import, derives club and actor server side, validates the season belongs to the caller's club and is non archived, re validates every proposed row (status, shirt, date, team club membership, existing player id club ownership, status transition), applies all business writes and their per row audit events in one inner subtransaction (all or nothing), records the terminal batch state and the players.import_completed / players.import_failed summary, and is idempotent on the client minted batch id (a replay returns the stored result; a cross club batch id is refused). Trusts nothing from the preview. p_rows is a jsonb object {format, rows}. See docs/adr/ADR-0007-player-import-export-architecture.md and docs/security/registered-players-boundary.md section 4.$$;

-- PostgREST exposes public functions as RPC to anon and authenticated; the
-- authorising work is in the body, so keep EXECUTE for authenticated but deny
-- anon and public. service_role keeps it for maintenance.
revoke execute on function public.import_players(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_players(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is exactly
-- as intended. No data assertions (the table starts empty); grant and shape
-- assertions are strict on both the fresh local reset and the hosted project.
-- ---------------------------------------------------------------------
do $$
begin
  -- Table exists with RLS enabled.
  if to_regclass('public.import_batches') is null then
    raise exception 'import_players: the import_batches table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.import_batches'::regclass) then
    raise exception 'import_players: row level security is not enabled on import_batches';
  end if;

  -- Append only by grant: authenticated holds SELECT and none of the write
  -- verbs; anon holds nothing.
  if not has_table_privilege('authenticated', 'public.import_batches', 'SELECT') then
    raise exception 'import_players: authenticated is missing SELECT on import_batches';
  end if;
  if has_table_privilege('authenticated', 'public.import_batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.import_batches', 'UPDATE')
     or has_table_privilege('authenticated', 'public.import_batches', 'DELETE')
     or has_table_privilege('authenticated', 'public.import_batches', 'TRUNCATE') then
    raise exception 'import_players: authenticated must hold SELECT only on import_batches';
  end if;
  if has_table_privilege('anon', 'public.import_batches', 'SELECT')
     or has_table_privilege('anon', 'public.import_batches', 'INSERT') then
    raise exception 'import_players: anon must hold no grant on import_batches';
  end if;

  -- Exactly one policy (the select_view read), no write policies.
  if (select count(*) from pg_policies where tablename = 'import_batches') <> 1 then
    raise exception 'import_players: import_batches must have exactly one (select) policy';
  end if;
  if exists (select 1 from pg_policies where tablename = 'import_batches' and cmd <> 'SELECT') then
    raise exception 'import_players: import_batches must have no write policy';
  end if;

  -- The RPC exists, is SECURITY DEFINER with an empty search_path, EXECUTE for
  -- authenticated but not anon.
  if to_regprocedure('public.import_players(uuid, uuid, jsonb)') is null then
    raise exception 'import_players: the function was not created';
  end if;
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'import_players') then
    raise exception 'import_players: must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'import_players'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'import_players: must set search_path to empty';
  end if;
  if not has_function_privilege('authenticated', 'public.import_players(uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'import_players: authenticated cannot execute';
  end if;
  if has_function_privilege('anon', 'public.import_players(uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'import_players: anon must not execute';
  end if;
end
$$;
