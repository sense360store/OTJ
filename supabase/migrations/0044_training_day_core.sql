-- =====================================================================
-- OTJ Training Hub, migration 0044_training_day_core: Release A of the
-- training day feature, in one atomic deploy
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: 0044. Slot 0043 is occupied by content_rights_fa_lock,
-- applied to hosted as 20260809081118. The live ledger is the authority;
-- confirm the next free slot before applying.
--
-- WHY ONE MIGRATION. This is deliberately not four small migrations. The
-- product boundary is one release: a coach opens a session, sees which
-- teams it covers, sees the players, marks who is here and what bib they
-- wear. Venues, covered teams, bib defaults and the register are useless
-- separately and the frontend reads all of them in the same screens, so
-- splitting them would create an interval where main selects a column
-- hosted does not have. One apply, one release, one rollback.
--
-- WHAT THIS ADDS
--   venues, venue_areas    the club's real places, with owner drawn
--                          boundary polygons on the areas
--   sessions.venue_id      a real reference; sessions.venue text is
--                          FROZEN legacy and never written by new code
--   session_teams          which teams a session covers (a session is a
--                          whole club slot far more often than one team)
--   teams.bib_colour       the team's default bib, from a closed list
--   register_entries       who was actually there, and what they wore
--
-- WHAT THIS DOES NOT ADD, ON PURPOSE. No Spond member links and no per
-- player RSVP. The register is the coach's own record and must be fully
-- usable with no Spond configuration at all; Spond RSVP arrives in
-- Release B as context beside attendance, never as attendance.
--
-- CHILD DATA. register_entries names no child: it holds player ids and
-- rides the same players.view gate as the roster it resolves against, so
-- parents (who hold no capabilities) never read it. Writes take
-- sessions.create, club scoped, because any coach on the day marks
-- arrivals, not only the session's owner.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enabling constraint. The club scoped composite foreign key pattern
-- (0032) needs the parent's (id, club_id) to be unique. players and
-- teams already carry theirs; sessions does not.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_id_club_unique' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions add constraint sessions_id_club_unique unique (id, club_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- The bib colour vocabulary, enforced in the schema so a colour is
-- always renderable. src/lib/bibs.ts mirrors this list; this constraint
-- is the authority.
-- ---------------------------------------------------------------------
create or replace function public.is_bib_colour(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p in ('red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black')
$$;

comment on function public.is_bib_colour(text) is
  $$The closed bib colour vocabulary shared by teams.bib_colour and register_entries.bib_colour_override. Mirrored by BIB_COLOURS in src/lib/bibs.ts; this function is the authority. See 0044_training_day_core.sql.$$;

-- ---------------------------------------------------------------------
-- venue_boundary_ok: the structural shape check for a boundary polygon.
-- An array of 3 to 64 vertices, each an array of exactly two numbers,
-- latitude then longitude, within world bounds. CASE makes the
-- evaluation order contractual: the length check runs only on an array
-- and the range casts only on numbers, so no input shape raises instead
-- of returning false.
-- ---------------------------------------------------------------------
create or replace function public.venue_boundary_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
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
-- convenience; the measured geometry lives on venue_areas.
-- ---------------------------------------------------------------------
create table public.venues (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  centre_lat numeric(9,6),
  centre_lng numeric(9,6),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint venues_name_unique_per_club unique (club_id, name),
  constraint venues_centre_lat_range check (centre_lat is null or centre_lat between -90 and 90),
  constraint venues_centre_lng_range check (centre_lng is null or centre_lng between -180 and 180),
  constraint venues_id_club_unique unique (id, club_id)
);
create index on public.venues (club_id);

comment on table public.venues is
  $$Club venue config: a named place with an optional lat/lng centre. Measured geometry lives on venue_areas. Reads are club wide; writes take club.manage. Carries no person data.$$;

-- ---------------------------------------------------------------------
-- venue_areas: a bounded area of a venue. Boundaries are owner drawn
-- visual approximations of the usable grass, treated as given: never
-- resurveyed or corrected in code.
-- ---------------------------------------------------------------------
create table public.venue_areas (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  venue_id   uuid not null,
  name       text not null,
  boundary   jsonb not null,
  usable     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint venue_areas_venue_fk
    foreign key (venue_id, club_id) references public.venues (id, club_id) on delete cascade,
  constraint venue_areas_name_unique_per_venue unique (venue_id, name),
  constraint venue_areas_boundary_shape check (public.venue_boundary_ok(boundary)),
  -- Release C's session setup will reference an area club scoped; the
  -- constraint is free now and saves an enabling migration later.
  constraint venue_areas_id_club_unique unique (id, club_id)
);
create index on public.venue_areas (club_id);
create index on public.venue_areas (venue_id);

comment on table public.venue_areas is
  $$A venue's bounded area: ordered lat/lng vertices (closing vertex omitted), 3 to 64 of them, shape enforced by venue_boundary_ok. Boundaries are owner drawn visual approximations of the usable area, not survey data; do not resurvey or correct them in code. Carries no person data.$$;

-- ---------------------------------------------------------------------
-- sessions.venue_id, and the free text column frozen behind it.
-- ---------------------------------------------------------------------
alter table public.sessions add column venue_id uuid;

-- The column list on set null is load bearing: a bare "on delete set
-- null" on a composite foreign key nulls EVERY referencing column,
-- club_id included, and the delete then fails on club_id's not null
-- constraint, making the venue undeletable.
alter table public.sessions
  add constraint sessions_venue_fk
  foreign key (venue_id, club_id) references public.venues (id, club_id)
  on delete set null (venue_id);

create index on public.sessions (venue_id);

comment on column public.sessions.venue is
  $$FROZEN legacy free text venue label (0001_init). Retained so existing sessions keep reading as they did; new code never writes it and reads venue_id instead. No backfill: an old row keeps its text until someone edits the session.$$;

comment on column public.sessions.venue_id is
  $$The venue this session is at (0044). Null for an unset or legacy session. On delete set null on venue_id alone, so removing a venue leaves the sessions intact and unplaced.$$;

-- ---------------------------------------------------------------------
-- teams.bib_colour: the team's default bib, overridable per session and
-- per player on the register.
-- ---------------------------------------------------------------------
alter table public.teams add column bib_colour text;
alter table public.teams
  add constraint teams_bib_colour_vocabulary
  check (bib_colour is null or public.is_bib_colour(bib_colour));

comment on column public.teams.bib_colour is
  $$The team's default bib colour, from the closed is_bib_colour vocabulary, null when unset. A register entry may override it for one session and one player. No stock or inventory is modelled: this is a colour, nothing more.$$;

-- ---------------------------------------------------------------------
-- session_teams: which teams a session covers. A session is a whole club
-- slot far more often than a single team one, which the single nullable
-- sessions.team_id could not express.
-- ---------------------------------------------------------------------
create table public.session_teams (
  session_id uuid not null,
  team_id    uuid not null,
  club_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (session_id, team_id),
  constraint session_teams_session_fk
    foreign key (session_id, club_id) references public.sessions (id, club_id) on delete cascade,
  constraint session_teams_team_fk
    foreign key (team_id, club_id) references public.teams (id, club_id) on delete cascade
);
create index on public.session_teams (club_id);
create index on public.session_teams (team_id);

comment on table public.session_teams is
  $$The teams a session covers (0044). Coverage is a filter and a default, never access control: reads of session content stay club wide. Deleting a team removes its coverage rows and leaves the session; deleting a session removes its rows.$$;

comment on column public.sessions.team_id is
  $$FROZEN legacy single team column (0002_teams_roles). New code writes session_teams instead and never writes this. Existing rows keep their value, and a legacy row with a team_id reads as covering that one team until the session is edited. No backfill and no destructive drop is scheduled.$$;

-- ---------------------------------------------------------------------
-- register_entries: who was actually there. The coach's own record.
--
-- Deliberately NOT dependent on Spond: a row exists because a coach
-- ticked someone in, or quick added them. source records which.
-- ---------------------------------------------------------------------
create table public.register_entries (
  session_id         uuid not null,
  player_id          uuid not null,
  club_id            uuid not null,
  present            boolean not null default false,
  -- 'none' is a real choice, not an absence: it means this player wears
  -- no bib today even though their team has a default.
  bib_colour_override text
    check (bib_colour_override is null
           or bib_colour_override = 'none'
           or public.is_bib_colour(bib_colour_override)),
  -- 'roster' the player was in the session's covered teams; 'manual' a
  -- quick add for someone who turned up anyway.
  source             text not null default 'roster' check (source in ('roster', 'manual')),
  marked_by          uuid references public.profiles (id) on delete set null,
  marked_at          timestamptz not null default now(),
  primary key (session_id, player_id),
  constraint register_entries_session_fk
    foreign key (session_id, club_id) references public.sessions (id, club_id) on delete cascade,
  constraint register_entries_player_fk
    foreign key (player_id, club_id) references public.players (id, club_id) on delete cascade
);
create index on public.register_entries (club_id);
create index on public.register_entries (player_id);

comment on table public.register_entries is
  $$The session register (0044): who was present and what bib they wore. Holds player ids only and never a name, so it carries the same child data weight as the roster it resolves against: select is gated players.view and parents never read it. Writes take sessions.create club wide, because any coach on the day marks arrivals, not only the session's owner. Erasing a child or deleting a session removes the rows by cascade. Not audited per tick by deliberate decision: the row is the record and a tick is a high frequency operational touch.$$;

-- ---------------------------------------------------------------------
-- Immutability: a register row's identity and club never change. Also
-- stamps who marked it and when, so the row carries its own provenance
-- without an audit event per tick.
-- ---------------------------------------------------------------------
create or replace function public.register_entries_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.player_id is distinct from old.player_id
     or new.club_id is distinct from old.club_id then
    raise exception 'a register entry cannot change its session, player or club'
      using errcode = 'P0001';
  end if;
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$$;

create trigger register_entries_touch
  before update on public.register_entries
  for each row execute function public.register_entries_touch();

-- ---------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------
alter table public.venues          enable row level security;
alter table public.venue_areas     enable row level security;
alter table public.session_teams   enable row level security;
alter table public.register_entries enable row level security;

-- Venues: club wide read (a coach needs to see where the session is),
-- admin surface write.
create policy "venues_select_club" on public.venues
  for select using ( club_id = public.my_club() );
create policy "venues_manage" on public.venues
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

create policy "venue_areas_select_club" on public.venue_areas
  for select using ( club_id = public.my_club() );
create policy "venue_areas_manage" on public.venue_areas
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

-- Coverage: club wide read like the sessions it describes; writes follow
-- the parent session's own authority, so a coach edits coverage on their
-- own sessions and a manager on any. Separate policies per command
-- rather than FOR ALL, so the select gate stays exactly club wide.
create policy "session_teams_select_club" on public.session_teams
  for select using ( club_id = public.my_club() );

create policy "session_teams_insert_own_session" on public.session_teams
  for insert with check (
    club_id = public.my_club()
    and exists (
      select 1 from public.sessions s
      where s.id = session_teams.session_id
        and s.club_id = public.my_club()
        and ( public.has_perm('sessions.manage')
              or ( public.has_perm('sessions.create') and s.coach_id = auth.uid() ) )
    )
  );

create policy "session_teams_delete_own_session" on public.session_teams
  for delete using (
    club_id = public.my_club()
    and exists (
      select 1 from public.sessions s
      where s.id = session_teams.session_id
        and s.club_id = public.my_club()
        and ( public.has_perm('sessions.manage')
              or ( public.has_perm('sessions.create') and s.coach_id = auth.uid() ) )
    )
  );

-- The register reveals which children attended, so its select rides the
-- players.view gate, exactly like the roster it resolves against.
create policy "register_entries_select_players_view" on public.register_entries
  for select using ( club_id = public.my_club() and public.has_perm('players.view') );

create policy "register_entries_insert" on public.register_entries
  for insert with check ( club_id = public.my_club() and public.has_perm('sessions.create') );
create policy "register_entries_update" on public.register_entries
  for update using ( club_id = public.my_club() and public.has_perm('sessions.create') )
  with check ( club_id = public.my_club() and public.has_perm('sessions.create') );
create policy "register_entries_delete" on public.register_entries
  for delete using ( club_id = public.my_club() and public.has_perm('sessions.create') );

-- No sequence or table grants beyond the defaults the other app tables
-- use; PostgREST reaches these through the authenticated role.
grant select, insert, update, delete on public.venues to authenticated;
grant select, insert, update, delete on public.venue_areas to authenticated;
grant select, insert, delete on public.session_teams to authenticated;
grant select, insert, update, delete on public.register_entries to authenticated;

-- ---------------------------------------------------------------------
-- Audit. Venues and coverage are configuration changes worth a trail.
-- Register ticks are not audited per tick, by deliberate decision
-- recorded in the table comment above.
-- ---------------------------------------------------------------------
create or replace function public.audit_venues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'venue.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'venue.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.centre_lat is distinct from old.centre_lat then v_changed := array_append(v_changed, 'centre_lat'); end if;
    if new.centre_lng is distinct from old.centre_lng then v_changed := array_append(v_changed, 'centre_lng'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'venue.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
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
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'venue_area.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'venue_area.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.boundary is distinct from old.boundary then v_changed := array_append(v_changed, 'boundary'); end if;
    if new.usable is distinct from old.usable then v_changed := array_append(v_changed, 'usable'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'venue_area.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue_area', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_venue_areas
  after insert or update or delete on public.venue_areas
  for each row execute function public.audit_venue_areas();

-- Coverage changes ride the session's own entity, carrying the team id
-- the way every other team scoped event does.
create or replace function public.audit_session_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_session uuid; v_team uuid; v_action text;
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_session := new.session_id; v_team := new.team_id;
    v_action := 'session.team_added';
  else
    v_club := old.club_id; v_session := old.session_id; v_team := old.team_id;
    v_action := 'session.team_removed';
    -- A session or team cascade deletes these rows; the parent's own
    -- delete event is the record, so do not double report it.
    if not exists (select 1 from public.sessions s where s.id = v_session) then
      return old;
    end if;
    if not exists (select 1 from public.teams t where t.id = v_team) then
      return old;
    end if;
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'session', v_session, v_team, null);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_session_teams
  after insert or delete on public.session_teams
  for each row execute function public.audit_session_teams();

-- audit_sessions gains venue_id on its update allow list. 0037's rule
-- keeps an id whose parent is itself audited: venues are audited above,
-- so venue_id qualifies exactly as team_id and programme_id do. The
-- body is otherwise 0037's verbatim; the existing trigger picks up the
-- replacement.
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
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'session', v_id, v_team, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- Tables and columns exist.
  if to_regclass('public.venues') is null
     or to_regclass('public.venue_areas') is null
     or to_regclass('public.session_teams') is null
     or to_regclass('public.register_entries') is null then
    raise exception 'training_day_core: a table was not created';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='sessions' and column_name='venue_id') then
    raise exception 'training_day_core: sessions.venue_id missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='teams' and column_name='bib_colour') then
    raise exception 'training_day_core: teams.bib_colour missing';
  end if;

  -- RLS is on everywhere.
  select count(*) into n from pg_class
   where relname in ('venues','venue_areas','session_teams','register_entries')
     and relnamespace = 'public'::regnamespace and relrowsecurity;
  if n <> 4 then
    raise exception 'training_day_core: row level security is not enabled on all four tables (got %)', n;
  end if;

  -- The register's select gate must stay narrower than its writes, so no
  -- FOR ALL policy may exist on it.
  if exists (select 1 from pg_policies
             where schemaname='public' and tablename='register_entries' and cmd='ALL') then
    raise exception 'training_day_core: register_entries must not carry a FOR ALL policy';
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='register_entries'
                   and cmd='SELECT' and qual like '%players.view%') then
    raise exception 'training_day_core: the register select gate must require players.view';
  end if;

  -- The venue reference nulls only itself on delete; a bare set null
  -- would null club_id too and make the venue undeletable.
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_venue_fk' and conrelid = 'public.sessions'::regclass
      and confdeltype = 'n'
      and confdelsetcols = array[
        (select attnum from pg_attribute
         where attrelid = 'public.sessions'::regclass and attname = 'venue_id')
      ]
  ) then
    raise exception 'training_day_core: the venue reference must set null on venue_id alone';
  end if;

  -- The bib vocabulary bites in both places.
  if public.is_bib_colour('chartreuse') then
    raise exception 'training_day_core: the bib vocabulary accepted an unknown colour';
  end if;
  if not public.is_bib_colour('red') then
    raise exception 'training_day_core: the bib vocabulary refused red';
  end if;

  -- The boundary shape check bites and accepts.
  if public.venue_boundary_ok('[[53.1,-1.5],[53.2,-1.5]]'::jsonb) then
    raise exception 'training_day_core: the boundary check accepted two vertices';
  end if;
  if public.venue_boundary_ok('[[91,0],[0,0],[1,1]]'::jsonb) then
    raise exception 'training_day_core: the boundary check accepted an out of range latitude';
  end if;
  if not public.venue_boundary_ok('[[53.1,-1.5],[53.2,-1.5],[53.2,-1.4]]'::jsonb) then
    raise exception 'training_day_core: the boundary check refused a valid triangle';
  end if;

  -- The composite club scoped references are declared.
  if not exists (select 1 from pg_constraint where conname = 'register_entries_session_fk')
     or not exists (select 1 from pg_constraint where conname = 'register_entries_player_fk')
     or not exists (select 1 from pg_constraint where conname = 'session_teams_session_fk')
     or not exists (select 1 from pg_constraint where conname = 'session_teams_team_fk')
     or not exists (select 1 from pg_constraint where conname = 'venue_areas_venue_fk') then
    raise exception 'training_day_core: a composite club scoped foreign key is missing';
  end if;

  -- Audit triggers exist for the configuration tables and not for the
  -- register, which is deliberately unaudited per tick.
  if not exists (select 1 from pg_trigger where tgname = 'audit_venues')
     or not exists (select 1 from pg_trigger where tgname = 'audit_venue_areas')
     or not exists (select 1 from pg_trigger where tgname = 'audit_session_teams') then
    raise exception 'training_day_core: an audit trigger is missing';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.register_entries'::regclass
               and tgname like 'audit%') then
    raise exception 'training_day_core: register_entries must not be audited per tick';
  end if;
end
$$;
