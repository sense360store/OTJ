-- =====================================================================
-- OTJ Training Hub, migration 0031_seasons: the seasons foundation for
-- Registered Players (PR 2, part 1 of 2)
--
-- REVIEW REQUIRED. This file creates a new security boundary object (the
-- seasons table, its one current season invariant, the seasons.manage
-- write gate and the activate_season RPC) and the first audit row trigger
-- of the programme. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: confirmed 0031. The files on disk end at 0030_audit_foundation.sql
-- and the live hosted ledger ends at audit_foundation (list_migrations, read
-- only, 2026-07-17), so 0031 is the next free slot from both sources. Per the
-- standing rule the ledger is the authority; it agrees with disk here.
--
-- WHAT THIS IS. Decision D5 of the Registered Players programme
-- (docs/adr/ADR-0005-registered-players-and-seasons.md). A club's roster is
-- seasonal: a child registers for a season, on a team, with a shirt number.
-- The seasons table is the spine that makes that seasonal. This migration
-- creates ONLY the seasons half of the schema split; the stable player
-- identity and the seasonal registrations arrive in 0032, which depends on
-- the initial season created here.
--
-- WHAT THIS DELIBERATELY IS NOT. No players change, no player_registrations
-- table, no backfill, no Registered Players page, no import or export, no
-- Activity or History UI. Those are 0032 and later PRs.
--
-- THE ONE CURRENT SEASON INVARIANT, the reason this file is careful. A club
-- has AT MOST ONE current season at all times, and EXACTLY ONE after setup.
-- Two mechanisms hold it together, neither sufficient alone:
--   * a partial unique index on (club_id) where is_current is the upper
--     bound, enforced below RLS for every writer including the service role;
--   * a guard trigger (BEFORE UPDATE OR DELETE) refuses the operations that
--     would create a zero state (a direct clear of is_current outside
--     activate_season, archiving the current season, deleting the current
--     season), each raising P0001 per the harness refusal convention.
-- The lower bound (never zero after setup) is provided by bootstrap: this
-- migration creates the initial current season for every existing club, and
-- a trigger on clubs creates one transactionally for every future club.
--
-- FOUNDATION SQL CONVENTIONS (the 0028, 0029, 0030 form): every privileged
-- function is SECURITY DEFINER with set search_path = '' and fully schema
-- qualified references; grants are explicit (revoke first, then grant only
-- the verbs intended); the migration self verifies with a DO block before it
-- commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- season_bounds(p_ref): the football season (July to June) containing a
-- reference date, returned as (name, starts_on, ends_on). Used by the
-- clubs bootstrap trigger so a future club gets a sensible current season
-- for the date it is created. The existing club's initial season below
-- uses the exact approved literal values, not this helper, so the approved
-- name and dates are fixed regardless of when the migration is applied.
-- Immutable: it computes on its argument alone.
-- ---------------------------------------------------------------------
create or replace function public.season_bounds(p_ref date)
returns table (name text, starts_on date, ends_on date)
language sql
immutable
set search_path = ''
as $$
  select
    (case when extract(month from p_ref) >= 7
       then to_char(p_ref, 'YYYY') || '/' || to_char((p_ref + interval '1 year'), 'YY')
       else to_char((p_ref - interval '1 year'), 'YYYY') || '/' || to_char(p_ref, 'YY')
     end)::text as name,
    (case when extract(month from p_ref) >= 7
       then make_date(extract(year from p_ref)::int, 7, 1)
       else make_date(extract(year from p_ref)::int - 1, 7, 1)
     end) as starts_on,
    (case when extract(month from p_ref) >= 7
       then make_date(extract(year from p_ref)::int + 1, 6, 30)
       else make_date(extract(year from p_ref)::int, 6, 30)
     end) as ends_on
$$;

comment on function public.season_bounds(date) is
  $$The football season (July to June) containing a reference date, as (name, starts_on, ends_on); for example 2026-07-17 gives ('2026/27', 2026-07-01, 2027-06-30). Used by the clubs bootstrap trigger for future clubs; the existing club's initial season uses the exact approved literals. See 0031_seasons.sql.$$;

-- ---------------------------------------------------------------------
-- Audit context helpers, shared by every player domain audit trigger (the
-- season trigger below, and the players and registration triggers in 0032).
-- They read the two transaction local GUCs the audit foundation defines
-- (docs/security/app-audit-boundary.md): otj.audit_source and otj.audit_batch.
-- A browser cannot set otj.* settings (PostgREST exposes no set_config and no
-- RPC forwards a client source), so these are context only, never trusted as
-- identity. EXECUTE is revoked from clients: only the definer trigger
-- functions (which run as the owner) call them.
-- ---------------------------------------------------------------------
create or replace function public.audit_source_context(p_actor uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := current_setting('otj.audit_source', true);
begin
  -- When the GUC is set (only inside a trusted definer RPC), its value is
  -- recorded, subject to the audit_events.source CHECK constraint on insert;
  -- a value outside the vocabulary aborts the whole transaction, fail closed.
  if v is not null and v <> '' then
    return v;
  end if;
  -- Unset and a signed in actor: a direct authenticated mutation. Unset and
  -- no actor: service role maintenance or a corrective migration.
  if p_actor is not null then
    return 'manual';
  end if;
  return 'database_trigger';
end;
$$;

create or replace function public.audit_batch_context()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := current_setting('otj.audit_batch', true);
begin
  if v is null or v = '' then
    return null;
  end if;
  return v::uuid;
end;
$$;

comment on function public.audit_source_context(uuid) is
  $$Derives an audit event source from the transaction local GUC otj.audit_source (validated by the audit_events.source CHECK on insert), or falls back to 'manual' for a signed in actor and 'database_trigger' for a system caller. See docs/security/app-audit-boundary.md and 0031_seasons.sql.$$;

revoke execute on function public.audit_source_context(uuid) from public, anon, authenticated;
revoke execute on function public.audit_batch_context() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- seasons: a club's registration season. name is the label everywhere
-- ("2026/27"), unique per club and bounded. starts_on and ends_on are
-- informational (overlap is not constrained) but ordered. is_current marks
-- the one current season; archived_at makes a past season read only for
-- registrations. created_by/updated_by are accountability only, nullable
-- and ON DELETE SET NULL so removing the adult who made the season never
-- deletes it. There is no child data on this table.
-- ---------------------------------------------------------------------
create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  archived_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seasons_dates_ordered check (ends_on > starts_on),
  constraint seasons_name_unique_per_club unique (club_id, name),
  -- The composite key that 0032's registrations reference so a registration's
  -- season and club must agree (composite FK (season_id, club_id)).
  constraint seasons_id_club_unique unique (id, club_id)
);

-- The upper bound of the one current season invariant: at most one current
-- season per club, for every writer including the service role.
create unique index seasons_one_current_per_club
  on public.seasons (club_id) where is_current;

create index seasons_club_idx on public.seasons (club_id);

comment on table public.seasons is
  $$A club's registration season (0031_seasons.sql). name is the label ("2026/27"), unique per club; starts_on/ends_on are ordered but overlap is unconstrained; is_current marks the one current season (at most one per club by the seasons_one_current_per_club partial unique index, exactly one after setup by bootstrap); archived_at makes a season read only for registrations. Holds no child data. Reads are club wide; writes require seasons.manage; there is deliberately no client delete policy or grant. See docs/adr/ADR-0005-registered-players-and-seasons.md.$$;

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase does not auto grant new tables (the 0012 lesson),
-- so they are explicit; RLS below is the real gate. Revoke everything first
-- (so no platform default privilege, INSERT/UPDATE/DELETE/TRUNCATE, leaks
-- on a local stack that auto grants ALL), then grant back exactly SELECT,
-- INSERT and UPDATE. There is deliberately NO DELETE grant and no delete
-- policy: no season delete flow exists, the guard trigger refuses deleting a
-- current season for every writer, and 0032's registrations reference
-- seasons ON DELETE RESTRICT so any used season is undeletable anyway.
-- ---------------------------------------------------------------------
revoke all on public.seasons from anon, authenticated;
grant select, insert, update on public.seasons to authenticated;

-- ---------------------------------------------------------------------
-- Row level security. Read is club wide (no capability, matching the club
-- wide read model of every content table); writes require seasons.manage.
-- The insert pins created_by to the writer so it cannot be forged.
-- ---------------------------------------------------------------------
alter table public.seasons enable row level security;

create policy "seasons_select_club" on public.seasons
  for select using (
    club_id = public.my_club()
  );

create policy "seasons_insert_manage" on public.seasons
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('seasons.manage')
    and created_by = auth.uid()
  );

create policy "seasons_update_manage" on public.seasons
  for update using (
    club_id = public.my_club()
    and public.has_perm('seasons.manage')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('seasons.manage')
  );
-- No delete policy. Deleting a season is not a product flow.

-- ---------------------------------------------------------------------
-- Touch and immutability trigger (BEFORE UPDATE). Maintains updated_at and
-- updated_by server side, and refuses rewriting the provenance and tenancy
-- columns (club_id, created_by, created_at), which a with check arm cannot
-- express because it cannot see the old row. P0001 per the harness convention.
-- ---------------------------------------------------------------------
create or replace function public.seasons_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.club_id is distinct from old.club_id then
    raise exception 'seasons: club_id is immutable' using errcode = 'P0001';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'seasons: created_by is immutable' using errcode = 'P0001';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'seasons: created_at is immutable' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger seasons_touch
  before update on public.seasons
  for each row execute function public.seasons_touch();

-- ---------------------------------------------------------------------
-- Guard trigger (BEFORE UPDATE OR DELETE): the operational half of the one
-- current season invariant. It refuses the three operations that would leave
-- a club with no current season, each P0001:
--   * clearing is_current outside activate_season (the RPC sets the
--     transaction local flag otj.season_activation to identify itself);
--   * setting archived_at while the row stays current (archiving the current
--     season alone);
--   * deleting a current season.
-- It reads only a GUC and raises, so it needs no elevated privileges; it
-- fires for every writer including the service role.
-- ---------------------------------------------------------------------
create or replace function public.seasons_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_current then
      raise exception 'seasons: the current season cannot be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- UPDATE.
  if old.is_current and not new.is_current then
    if coalesce(current_setting('otj.season_activation', true), '') <> '1' then
      raise exception 'seasons: the current season can only change through activate_season'
        using errcode = 'P0001';
    end if;
  end if;
  if new.is_current and new.archived_at is not null and old.archived_at is null then
    raise exception 'seasons: the current season cannot be archived; activate another season first'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger seasons_guard
  before update or delete on public.seasons
  for each row execute function public.seasons_guard();

-- ---------------------------------------------------------------------
-- Season audit trigger (AFTER INSERT OR UPDATE OR DELETE). Writes one
-- audit_events row per season business change, in the same transaction, per
-- the action mapping (docs/security/app-audit-boundary.md):
--   * INSERT               -> season.created
--   * UPDATE, by precedence, at most one event per row change:
--       archived_at set    -> season.archived (wins even when is_current is
--                             also cleared; the paired season.activated on
--                             the new row records the switch)
--       is_current -> true -> season.activated
--       is_current -> false alone (a demotion) -> no event, suppressed
--       archived_at -> null (unarchive) -> season.updated (['archived_at'])
--       otherwise          -> season.updated
-- SECURITY DEFINER (the invoking client has no insert grant on audit_events),
-- set search_path = '', schema qualified. actor, actor_name, club and
-- occurred_at are derived server side; no row snapshot, no child data (there
-- is none on seasons anyway).
--
-- Attached AFTER the bootstrap below, so the initial season creation is not
-- audited: the migration itself is the record, matching the registration
-- backfill convention in 0032.
-- ---------------------------------------------------------------------
create or replace function public.audit_seasons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_club       uuid;
  v_entity     uuid;
  v_action     text;
  v_changed    text[] := null;
begin
  if tg_op = 'DELETE' then
    -- No season delete action is defined; deletion of a current season is
    -- already refused by the guard, and a non current season delete is not a
    -- product flow. Emit nothing rather than a misleading generic event.
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_club := new.club_id;
    v_entity := new.id;
    v_action := 'season.created';
  else
    v_club := new.club_id;
    v_entity := new.id;
    if new.archived_at is not null and old.archived_at is null then
      v_action := 'season.archived';
    elsif new.is_current and not old.is_current then
      v_action := 'season.activated';
    elsif old.is_current and not new.is_current
          and new.archived_at is not distinct from old.archived_at
          and new.name = old.name
          and new.starts_on = old.starts_on
          and new.ends_on = old.ends_on then
      -- Pure demotion by activate_season; the paired season.activated on the
      -- incoming row is the record of the switch.
      return new;
    elsif old.archived_at is not null and new.archived_at is null then
      v_action := 'season.updated';
      v_changed := array['archived_at'];
    else
      v_action := 'season.updated';
    end if;
  end if;

  if v_actor is not null then
    select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, season_id, source, changed_fields, batch_id
  )
  values (
    v_club, now(), v_actor, v_actor_name, v_action, 'season',
    v_entity, v_entity, public.audit_source_context(v_actor), v_changed, public.audit_batch_context()
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- activate_season: the one atomic switch of a club's current season.
-- SECURITY DEFINER (it must identify itself to the guard trigger through the
-- transaction local flag and re check its capability in body), set
-- search_path = '', EXECUTE granted to authenticated only. It:
--   * requires seasons.manage and derives actor and club from auth.uid() and
--     my_club() server side;
--   * validates the target belongs to the caller's club and is not archived;
--   * takes a per club transaction advisory lock so concurrent activations
--     serialise rather than race;
--   * clears the outgoing current season and sets the target current in one
--     transaction, optionally archiving the outgoing season only when asked;
--   * leaves every registration untouched.
-- The partial unique index guarantees the result is never two current
-- seasons; the guard trigger and bootstrap guarantee never zero.
-- ---------------------------------------------------------------------
create or replace function public.activate_season(
  p_season_id        uuid,
  p_archive_outgoing boolean default false
)
returns public.seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_club     uuid := public.my_club();
  v_target   public.seasons;
  v_outgoing uuid;
  v_result   public.seasons;
begin
  if v_actor is null then
    raise exception 'activate_season: no authenticated actor' using errcode = '42501';
  end if;
  if v_club is null then
    raise exception 'activate_season: the acting member has no club' using errcode = '42501';
  end if;
  if not public.has_perm('seasons.manage') then
    raise exception 'activate_season: requires the seasons.manage capability' using errcode = '42501';
  end if;

  -- Serialise activations within a club so two concurrent calls cannot
  -- interleave. The lock is released at transaction end.
  perform pg_advisory_xact_lock(hashtext('otj.season_activation:' || v_club::text));

  select * into v_target from public.seasons s
    where s.id = p_season_id and s.club_id = v_club;
  if not found then
    raise exception 'activate_season: season not found in your club' using errcode = 'P0001';
  end if;
  if v_target.archived_at is not null then
    raise exception 'activate_season: cannot activate an archived season; unarchive it first'
      using errcode = 'P0001';
  end if;

  -- Identify to the guard trigger for the duration of this transaction.
  perform set_config('otj.season_activation', '1', true);

  select s.id into v_outgoing from public.seasons s
    where s.club_id = v_club and s.is_current and s.id <> p_season_id;

  if v_outgoing is not null then
    if p_archive_outgoing then
      -- Clear current and archive in one update: is_current false first, so
      -- the guard's "archiving the current season" refusal does not apply,
      -- and the audit trigger records a single season.archived event.
      update public.seasons s set is_current = false, archived_at = now()
        where s.id = v_outgoing;
    else
      update public.seasons s set is_current = false
        where s.id = v_outgoing;
    end if;
  end if;

  update public.seasons s set is_current = true
    where s.id = p_season_id and s.club_id = v_club
    returning * into v_result;

  return v_result;
end;
$$;

comment on function public.activate_season(uuid, boolean) is
  $$Atomically makes a season current for the caller's club: requires seasons.manage, validates the target belongs to the club and is not archived, serialises per club with an advisory lock, clears the outgoing current season and sets the target, optionally archiving the outgoing season only when p_archive_outgoing is true, and leaves registrations untouched. Emits season.activated (and season.archived when archiving) through the audit trigger. See 0031_seasons.sql and docs/adr/ADR-0005-registered-players-and-seasons.md.$$;

-- PostgREST exposes public functions as RPC to anon and authenticated; the
-- authorising work is in the body, so keep EXECUTE for authenticated but
-- deny anon, and let service_role keep it for maintenance.
revoke execute on function public.activate_season(uuid, boolean) from public, anon;
grant execute on function public.activate_season(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Future club provisioning. A club created after this migration must get its
-- initial current season transactionally, or the one current season invariant
-- would be violated for that club. A SECURITY DEFINER AFTER INSERT trigger on
-- clubs creates it (bypassing RLS as the owner), using season_bounds for the
-- creation date so the season label matches the year. Idempotent: it does
-- nothing if the club already has a season.
-- ---------------------------------------------------------------------
create or replace function public.clubs_bootstrap_season()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounds record;
begin
  if exists (select 1 from public.seasons s where s.club_id = new.id) then
    return new;
  end if;
  select * into v_bounds from public.season_bounds((now() at time zone 'utc')::date);
  insert into public.seasons (club_id, name, starts_on, ends_on, is_current, created_by)
  values (new.id, v_bounds.name, v_bounds.starts_on, v_bounds.ends_on, true, auth.uid());
  return new;
end;
$$;

create trigger clubs_bootstrap_season
  after insert on public.clubs
  for each row execute function public.clubs_bootstrap_season();

-- ---------------------------------------------------------------------
-- Bootstrap the existing club(s). The one current season for the club that
-- exists today uses the exact approved values (docs/roadmaps/
-- registered-players-delivery-plan.md: name "2026/27", 2026-07-01 to
-- 2027-06-30). Written as insert per club where none exists, so it is
-- idempotent and correct for any number of existing clubs; on a fresh local
-- reset there are no clubs yet (the seed creates the demo club afterwards and
-- the clubs trigger seeds its season), so this is a no-op locally.
-- ---------------------------------------------------------------------
insert into public.seasons (club_id, name, starts_on, ends_on, is_current)
select c.id, '2026/27', date '2026-07-01', date '2027-06-30', true
from public.clubs c
where not exists (select 1 from public.seasons s where s.club_id = c.id);

-- ---------------------------------------------------------------------
-- Attach the season audit trigger AFTER the bootstrap, so the initial season
-- creation writes no audit event (the migration is the record). Every season
-- change after this point, including the clubs trigger's insert for a future
-- club, is audited.
-- ---------------------------------------------------------------------
create trigger audit_seasons
  after insert or update or delete on public.seasons
  for each row execute function public.audit_seasons();

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended. Grant and invariant assertions are phrased so they are
-- vacuous on a fresh local reset (zero clubs at migration time) and strict on
-- the hosted project (the real club must have exactly one current season).
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  -- seasons exists with RLS enabled.
  if to_regclass('public.seasons') is null then
    raise exception 'seasons: the table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.seasons'::regclass) then
    raise exception 'seasons: row level security is not enabled';
  end if;

  -- Grants: authenticated holds SELECT, INSERT, UPDATE and NOT DELETE or
  -- TRUNCATE; anon holds nothing.
  if not (has_table_privilege('authenticated', 'public.seasons', 'SELECT')
          and has_table_privilege('authenticated', 'public.seasons', 'INSERT')
          and has_table_privilege('authenticated', 'public.seasons', 'UPDATE')) then
    raise exception 'seasons: authenticated is missing an intended grant (select/insert/update)';
  end if;
  if has_table_privilege('authenticated', 'public.seasons', 'DELETE')
     or has_table_privilege('authenticated', 'public.seasons', 'TRUNCATE') then
    raise exception 'seasons: authenticated must not hold DELETE or TRUNCATE on seasons';
  end if;
  if has_table_privilege('anon', 'public.seasons', 'SELECT')
     or has_table_privilege('anon', 'public.seasons', 'INSERT') then
    raise exception 'seasons: anon must hold no grant on seasons';
  end if;

  -- The partial unique index exists.
  if not exists (select 1 from pg_class where relname = 'seasons_one_current_per_club' and relkind = 'i') then
    raise exception 'seasons: the one current season partial unique index is missing';
  end if;

  -- activate_season is EXECUTE for authenticated, not anon.
  if not has_function_privilege('authenticated', 'public.activate_season(uuid, boolean)', 'EXECUTE') then
    raise exception 'seasons: authenticated cannot execute activate_season';
  end if;
  if has_function_privilege('anon', 'public.activate_season(uuid, boolean)', 'EXECUTE') then
    raise exception 'seasons: anon must not execute activate_season';
  end if;

  -- Every existing club has exactly one current, unarchived season.
  select count(*) into bad
  from public.clubs c
  where (select count(*) from public.seasons s where s.club_id = c.id and s.is_current and s.archived_at is null) <> 1;
  if bad > 0 then
    raise exception 'seasons: % existing club(s) do not have exactly one current unarchived season', bad;
  end if;

  -- No audit event was written for the bootstrap (the trigger attached after).
  if exists (select 1 from public.audit_events where entity_type = 'season') then
    raise exception 'seasons: the bootstrap must not write audit events (trigger attached too early)';
  end if;
end
$$;
