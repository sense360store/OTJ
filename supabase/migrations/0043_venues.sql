-- =====================================================================
-- OTJ Training Hub, migration 0043_venues: venues become first class
-- config with measured boundaries (training day logistics, PR 2)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: provisional 0043. The files on disk end at
-- 0042_public_media_path_boundary.sql; per the standing rule the live
-- ledger is the authority and must be confirmed read only at apply time.
--
-- WHAT THIS IS. Decision record docs/adr/ADR-0008-training-day-logistics.md.
-- The club's venues become data: a venues table (name plus a lat/lng
-- centre) and a venue_areas table carrying each usable area's boundary
-- polygon as ordered lat/lng vertices (closing vertex omitted). The two
-- real venues are seeded below with boundaries drawn by the club owner as
-- visual approximations of the usable green areas, which is sufficient
-- precision for the setup composer; they are not survey data and are not
-- to be resurveyed or corrected in code. sessions gain a nullable
-- venue_id; the free text sessions.venue column is FROZEN as legacy per
-- the players.team_id precedent (0032).
--
-- WHAT THIS DELIBERATELY IS NOT. No schematic rendering, no composer, no
-- session venue select (the planner keeps writing the frozen column until
-- its venue select ships and is noted below), no map tiles or external
-- geo dependency of any kind.
--
-- FOUNDATION SQL CONVENTIONS (the 0028 onward form): structural checks in
-- SQL so a malformed boundary is unstorable; explicit grants (revoke
-- first, grant back exactly the intended verbs); refusals raise P0001;
-- audit triggers attach after the seed so the bootstrap writes no events
-- (the 0031 precedent); the migration self verifies with a DO block.
-- =====================================================================

-- ---------------------------------------------------------------------
-- venue_boundary_ok(p): the structural shape check for a boundary
-- polygon. An array of 3 to 64 vertices, each an array of exactly two
-- numbers, latitude then longitude, within world bounds. Backing the
-- CHECK constraint on venue_areas.boundary, so a row that could not be
-- rendered can never be stored, whoever the writer is.
-- ---------------------------------------------------------------------
create or replace function public.venue_boundary_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- CASE makes the evaluation order contractual: the array length check
  -- runs only on an array, the range casts only on numbers, so no input
  -- shape can raise instead of returning false.
  select case
    when jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) not between 3 and 64 then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as v(vertex)
      where case
        when jsonb_typeof(v.vertex) <> 'array' then true
        when jsonb_array_length(v.vertex) <> 2 then true
        when jsonb_typeof(v.vertex -> 0) <> 'number' then true
        when jsonb_typeof(v.vertex -> 1) <> 'number' then true
        when (v.vertex ->> 0)::numeric not between -90 and 90 then true
        when (v.vertex ->> 1)::numeric not between -180 and 180 then true
        else false
      end
    )
  end
$$;

-- ---------------------------------------------------------------------
-- venues: a place the club trains. The centre is a display and default
-- anchor only; the geometry that matters lives on the areas.
-- ---------------------------------------------------------------------
create table public.venues (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  centre_lat double precision not null check (centre_lat between -90 and 90),
  centre_lng double precision not null check (centre_lng between -180 and 180),
  created_at timestamptz not null default now(),
  constraint venues_name_unique_per_club unique (club_id, name),
  -- The composite FK target, so club scoped children can reference
  -- (id, club_id) and "the row's club equals the parent's club" is
  -- declarative (the 0032 teams_id_club_unique pattern).
  constraint venues_id_club_unique unique (id, club_id)
);
create index on public.venues (club_id);

comment on table public.venues is
  $$Club venue config: a named place with a lat/lng centre. The measured geometry lives on venue_areas. Reads are club wide; writes take club.manage (admin surface). Carries no person data.$$;

-- ---------------------------------------------------------------------
-- venue_areas: a bounded area of a venue (the usable field, a pitch, a
-- closed off corner). The boundary is ordered lat/lng vertices with the
-- closing vertex omitted, drawn by the owner as a visual approximation
-- of the usable green area; sufficient precision for the composer, not
-- survey data.
-- ---------------------------------------------------------------------
create table public.venue_areas (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null,
  venue_id   uuid not null,
  name       text not null check (char_length(name) between 1 and 60),
  boundary   jsonb not null,
  usable     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint venue_areas_venue_fk
    foreign key (venue_id, club_id) references public.venues (id, club_id) on delete cascade,
  constraint venue_areas_name_unique_per_venue unique (venue_id, name),
  constraint venue_areas_boundary_shape check (public.venue_boundary_ok(boundary))
);
create index on public.venue_areas (club_id);
create index on public.venue_areas (venue_id);

comment on table public.venue_areas is
  $$A venue's bounded area: ordered lat/lng vertices (closing vertex omitted), 3 to 64 of them, shape enforced by venue_boundary_ok. Boundaries are owner drawn visual approximations of the usable areas, not survey data; do not resurvey or correct them in code. Carries no person data.$$;

-- ---------------------------------------------------------------------
-- RLS. Reads club wide like every config table; writes are the admin
-- surface (club.manage), the spond_groups_manage pattern.
-- ---------------------------------------------------------------------
alter table public.venues enable row level security;
alter table public.venue_areas enable row level security;

create policy "venues_select_club" on public.venues
  for select using ( club_id = public.my_club() );

create policy "venues_manage" on public.venues
  for all
  using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

create policy "venue_areas_select_club" on public.venue_areas
  for select using ( club_id = public.my_club() );

create policy "venue_areas_manage" on public.venue_areas
  for all
  using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

revoke all on public.venues from anon, authenticated;
revoke all on public.venue_areas from anon, authenticated;
grant select, insert, update, delete on public.venues to authenticated;
grant select, insert, update, delete on public.venue_areas to authenticated;

-- ---------------------------------------------------------------------
-- sessions.venue_id, and the freeze of the free text column. The FK is
-- ON DELETE SET NULL so removing a venue detaches sessions, never
-- deletes them. The frozen comment follows the players.team_id wording
-- (0032); the planner keeps writing the free text column until its
-- venue select ships, at which point new code never writes it again.
-- ---------------------------------------------------------------------
alter table public.sessions
  add column venue_id uuid references public.venues (id) on delete set null;
create index on public.sessions (venue_id);

comment on column public.sessions.venue is
  $$FROZEN legacy free text venue. The canonical venue is sessions.venue_id referencing public.venues (ADR-0008). Retained for rows predating venues and as their display fallback; new code stops writing it when the planner's venue select ships. No destructive drop is scheduled.$$;

comment on column public.sessions.venue_id is
  $$The session's venue, nullable (null renders as the frozen free text venue for legacy rows, or no venue). ON DELETE SET NULL: removing a venue detaches sessions.$$;

-- ---------------------------------------------------------------------
-- Seed the two real venues for every existing club, idempotently by
-- name. Coordinates are the owner drawn boundaries recorded in
-- ADR-0008's programme brief, verbatim; centres are the vertex means.
-- Runs before the audit triggers attach, so the seed writes no events
-- (the migration is the record, the 0031 precedent). On a fresh local
-- reset there are no clubs yet and this is a no-op; the local seed can
-- create venues afterwards if it wants them.
-- ---------------------------------------------------------------------
do $$
declare
  c record;
  v_id uuid;
begin
  for c in select id from public.clubs loop
    if not exists (select 1 from public.venues v where v.club_id = c.id and v.name = 'Flushdyke') then
      insert into public.venues (club_id, name, centre_lat, centre_lng)
      values (c.id, 'Flushdyke', 53.68541302, -1.56192784)
      returning id into v_id;
      insert into public.venue_areas (club_id, venue_id, name, boundary, usable)
      values (
        c.id, v_id, 'Field',
        '[[53.68568155,-1.56218739],[53.68529301,-1.56243823],[53.68517449,-1.56162951],[53.68550302,-1.56145621]]'::jsonb,
        true
      );
    end if;
    if not exists (select 1 from public.venues v where v.club_id = c.id and v.name = 'Haggs Hill') then
      insert into public.venues (club_id, name, centre_lat, centre_lng)
      values (c.id, 'Haggs Hill', 53.67646781, -1.55435378)
      returning id into v_id;
      insert into public.venue_areas (club_id, venue_id, name, boundary, usable)
      values (
        c.id, v_id, 'Main field',
        '[[53.67594325,-1.55454560],[53.67614254,-1.55348528],[53.67696607,-1.55416899],[53.67681938,-1.55521524]]'::jsonb,
        true
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Audit, the 0037 pattern: one semantic event per committed change,
-- field names only, never values. Venues are club config like teams and
-- spond_groups, both audited; boundary edits record the field name
-- 'boundary', never coordinates. An area deleted by its venue's cascade
-- is covered by venue.deleted and writes no event of its own.
-- ---------------------------------------------------------------------
create or replace function public.audit_venues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'venue.created', 'venue', new.id, null, null);
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.audit_domain_event(old.club_id, auth.uid(), 'venue.deleted', 'venue', old.id, null, null);
    return old;
  end if;
  if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
  if new.centre_lat is distinct from old.centre_lat then v_changed := array_append(v_changed, 'centre_lat'); end if;
  if new.centre_lng is distinct from old.centre_lng then v_changed := array_append(v_changed, 'centre_lng'); end if;
  if array_length(v_changed, 1) is null then return new; end if;
  perform public.audit_domain_event(new.club_id, auth.uid(), 'venue.updated', 'venue', new.id, null, v_changed);
  return new;
end;
$$;

create trigger audit_venues
  after insert or update or delete on public.venues
  for each row execute function public.audit_venues();

create or replace function public.audit_venue_areas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'venue.area_added', 'venue', new.venue_id, null, null);
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Cascade suppression: an area deleted because its venue was deleted
    -- is covered by venue.deleted.
    if not exists (select 1 from public.venues v where v.id = old.venue_id) then
      return old;
    end if;
    perform public.audit_domain_event(old.club_id, auth.uid(), 'venue.area_removed', 'venue', old.venue_id, null, null);
    return old;
  end if;
  if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
  if new.usable is distinct from old.usable then v_changed := array_append(v_changed, 'usable'); end if;
  if new.boundary is distinct from old.boundary then v_changed := array_append(v_changed, 'boundary'); end if;
  if array_length(v_changed, 1) is null then return new; end if;
  perform public.audit_domain_event(new.club_id, auth.uid(), 'venue.area_updated', 'venue', new.venue_id, null, v_changed);
  return new;
end;
$$;

create trigger audit_venue_areas
  after insert or update or delete on public.venue_areas
  for each row execute function public.audit_venue_areas();

-- ---------------------------------------------------------------------
-- audit_sessions gains venue_id on its update allow list. 0037's stated
-- rule keeps team_id and programme_id on the list because their parents
-- are audited and excludes board_id because boards are not; venues are
-- audited above, so venue_id qualifies. The function body is otherwise
-- 0037's verbatim; the existing trigger picks up the replacement.
-- ---------------------------------------------------------------------
create or replace function public.audit_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_team uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_team := new.team_id; v_action := 'session.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_team := old.team_id; v_action := 'session.deleted';
  else
    v_club := new.club_id; v_id := new.id; v_team := new.team_id;
    if new.team_id is distinct from old.team_id then v_changed := array_append(v_changed, 'team_id'); end if;
    if new.date is distinct from old.date then v_changed := array_append(v_changed, 'date'); end if;
    if new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
    if new.programme_id is distinct from old.programme_id then v_changed := array_append(v_changed, 'programme_id'); end if;
    if new.programme_week is distinct from old.programme_week then v_changed := array_append(v_changed, 'programme_week'); end if;
    if new.venue_id is distinct from old.venue_id then v_changed := array_append(v_changed, 'venue_id'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'session.updated';
  end if;
  -- team_id is a safe first class id already used across the audit trail, so
  -- the session's team rides the event; the live pointer, notes and content
  -- never do.
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'session', v_id, v_team, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended. The seed assertions are vacuous on a fresh local
-- reset (zero clubs at migration time) and strict on the hosted project.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  if to_regclass('public.venues') is null or to_regclass('public.venue_areas') is null then
    raise exception 'venues: a table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.venues'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.venue_areas'::regclass) then
    raise exception 'venues: row level security is not enabled';
  end if;

  -- Grants: authenticated holds exactly select/insert/update/delete; anon nothing.
  if not (has_table_privilege('authenticated', 'public.venues', 'SELECT')
          and has_table_privilege('authenticated', 'public.venues', 'INSERT')
          and has_table_privilege('authenticated', 'public.venues', 'UPDATE')
          and has_table_privilege('authenticated', 'public.venues', 'DELETE')
          and has_table_privilege('authenticated', 'public.venue_areas', 'SELECT')
          and has_table_privilege('authenticated', 'public.venue_areas', 'INSERT')
          and has_table_privilege('authenticated', 'public.venue_areas', 'UPDATE')
          and has_table_privilege('authenticated', 'public.venue_areas', 'DELETE')) then
    raise exception 'venues: authenticated is missing an intended grant';
  end if;
  if has_table_privilege('anon', 'public.venues', 'SELECT')
     or has_table_privilege('anon', 'public.venue_areas', 'SELECT') then
    raise exception 'venues: anon must hold no grant';
  end if;
  if has_table_privilege('authenticated', 'public.venues', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.venue_areas', 'TRUNCATE') then
    raise exception 'venues: authenticated must not hold TRUNCATE';
  end if;

  -- The boundary shape check bites: a two vertex boundary is unstorable.
  if public.venue_boundary_ok('[[53.0,-1.5],[53.1,-1.6]]'::jsonb) then
    raise exception 'venues: venue_boundary_ok accepted a two vertex boundary';
  end if;
  if not public.venue_boundary_ok('[[53.0,-1.5],[53.1,-1.6],[53.2,-1.4]]'::jsonb) then
    raise exception 'venues: venue_boundary_ok refused a valid triangle';
  end if;
  if public.venue_boundary_ok('[[91.0,-1.5],[53.1,-1.6],[53.2,-1.4]]'::jsonb) then
    raise exception 'venues: venue_boundary_ok accepted an out of range latitude';
  end if;

  -- sessions.venue_id exists.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'venue_id'
  ) then
    raise exception 'venues: sessions.venue_id was not added';
  end if;

  -- Policies and audit triggers are in place.
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename in ('venues', 'venue_areas');
  if bad <> 4 then
    raise exception 'venues: expected 4 policies, found %', bad;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_venues')
     or not exists (select 1 from pg_trigger where tgname = 'audit_venue_areas') then
    raise exception 'venues: an audit trigger is missing';
  end if;

  -- Every existing club has the two seeded venues, each with one area,
  -- and the seed wrote no audit events (triggers attached after).
  select count(*) into bad
  from public.clubs c
  where (select count(*) from public.venues v where v.club_id = c.id and v.name in ('Flushdyke', 'Haggs Hill')) <> 2
     or (select count(*) from public.venue_areas a join public.venues v on v.id = a.venue_id
         where v.club_id = c.id and v.name in ('Flushdyke', 'Haggs Hill')) <> 2;
  if bad > 0 then
    raise exception 'venues: % existing club(s) missing the seeded venues or areas', bad;
  end if;
  if exists (select 1 from public.audit_events where entity_type = 'venue') then
    raise exception 'venues: the seed must not write audit events (trigger attached too early)';
  end if;
end
$$;
