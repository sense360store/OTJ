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
--   venues                 the club's real places, so every session at
--                          Springmill agrees on the name
--   sessions.venue_id      a real reference; sessions.venue text is
--                          FROZEN legacy, never written with a value and
--                          retired once a real venue is chosen
--   session_teams          which teams a session covers (a session is a
--                          whole club slot far more often than one team)
--   teams.bib_colour       the team's default bib, from a closed list
--   register_entries       who was actually there, and what they wore
--
-- WHAT THIS DOES NOT ADD, ON PURPOSE
--   No Spond member links and no per player RSVP. The register is the
--   coach's own record and must be fully usable with no Spond
--   configuration at all; Spond RSVP arrives later as context beside
--   attendance, never as attendance.
--   No venue areas and no boundary geometry. A venue here is a name a
--   coach picks. Measured areas belong to the session setup work and
--   arrive with the screens that use them, not before.
--
-- CHILD DATA. register_entries names no child: it holds player ids and
-- rides the same players.view gate as the roster it resolves against, so
-- parents (who hold no capabilities) never read it. Writes take
-- sessions.create, club scoped, because any coach on the day marks
-- arrivals, not only the session's owner.
-- =====================================================================

-- ONE transaction, as 0041, 0042 and 0043 are. The self verification at the
-- end runs in the same transaction as every statement above it, so a failed
-- assertion rolls the whole release back rather than leaving a half applied
-- schema live. This matters because the header instructs a by-hand apply: on
-- a statement-at-a-time path an assertion that fires late (the confdelsetcols
-- check, or the row level security count) would otherwise leave the new
-- column, the foreign key, the three tables, their policies and grants and a
-- replaced audit_sessions permanently in place, with a corrective re-run
-- blocked because the create table and the add column are not idempotent.
begin;

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
-- venues: a place the club trains, identified by name.
-- ---------------------------------------------------------------------
create table public.venues (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint venues_name_unique_per_club unique (club_id, name),
  -- btrim with no second argument strips the space character only, so a name
  -- made of tabs or newlines would pass. Name the whitespace explicitly.
  constraint venues_name_not_blank check (btrim(name, E' \t\r\n') <> ''),
  -- The club scoped composite reference pattern needs this on the parent.
  constraint venues_id_club_unique unique (id, club_id)
);
-- No standalone club_id index: venues_name_unique_per_club is a btree on
-- (club_id, name), whose leading column already serves club scoped lookups.
-- No created_by column either. Venues are club.manage configuration with no
-- ownership concept, and audit_venues already records who created each one.

comment on table public.venues is
  $$Club venue config (0044): the named places the club trains at. Reads are club wide, because a coach needs to know where a session is; writes take club.manage. Carries no person data.$$;

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
  $$FROZEN legacy free text venue label (0001_init). New code never writes a VALUE here and reads venue_id instead; it clears this to null at the moment a real venue is chosen, so the read fallback cannot resurrect and contradict venue_id. No backfill: a session saved before venues existed keeps its typed text until someone positively picks a venue for it.$$;

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
--
-- Absence is absence. Zero rows means coverage was never set, NOT the
-- whole club: reading empty as everyone would mean deleting a team
-- silently widened every session that covered only that team from one
-- squad to every child in the club. src/lib/sessionTeams.ts holds the
-- same rule on the client.
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
  $$The teams a session covers (0044). Coverage is a filter and a default, never access control: reads of session content stay club wide. Zero rows means unset, never all teams. Deleting a team removes its coverage rows and leaves the session; deleting a session removes its rows.$$;

comment on column public.sessions.team_id is
  $$FROZEN legacy single team column (0002_teams_roles). New code never writes a VALUE here; coverage is session_teams. A save clears this to null, because the client normalises a legacy row's team into its covered set on read, so leaving it set would mean a session whose coverage a coach cleared still read as covering the old team, with no way to clear it. Until a session is saved again, a legacy row with a team_id reads as covering that one team. No backfill and no destructive drop is scheduled.$$;

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
-- Provenance and immutability. Every write stamps who marked it and
-- when, so the row carries its own provenance without an audit event per
-- tick, and a client cannot forge either. A row's identity and club
-- never change.
--
-- Not SECURITY DEFINER: this reads nothing outside the row it is
-- rewriting, so it needs no elevated rights.
-- ---------------------------------------------------------------------
create or replace function public.register_entries_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.session_id is distinct from old.session_id
       or new.player_id is distinct from old.player_id
       or new.club_id is distinct from old.club_id then
      raise exception 'a register entry cannot change its session, player or club'
        using errcode = 'P0001';
    end if;
  end if;
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$$;

create trigger register_entries_touch
  before insert or update on public.register_entries
  for each row execute function public.register_entries_touch();

-- ---------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------
alter table public.venues           enable row level security;
alter table public.session_teams    enable row level security;
alter table public.register_entries enable row level security;

-- Venues: club wide read (a coach needs to see where the session is),
-- admin surface write.
create policy "venues_select_club" on public.venues
  for select using ( club_id = public.my_club() );
create policy "venues_manage" on public.venues
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

-- Revoke first, then grant exactly what the policies allow. Every table
-- added since 0030 does this: a stack whose default privileges auto grant
-- ALL to anon and authenticated would otherwise leave a wider grant behind
-- these statements than the file appears to give.
revoke all on public.venues           from anon, authenticated;
revoke all on public.session_teams    from anon, authenticated;
revoke all on public.register_entries from anon, authenticated;

-- PostgREST reaches these through the authenticated role. anon receives
-- nothing: none of these tables has an anonymous read path. Coverage has no
-- update grant, because a row is added or removed, never edited.
grant select, insert, update, delete on public.venues to authenticated;
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

-- audit_teams gains bib_colour on its update allow list. A team's default
-- bib is club configuration written under teams.manage, so changing it
-- belongs in the trail beside a rename. Field NAMES only, never values, as
-- everywhere else. The body is otherwise 0037's verbatim; the existing
-- trigger picks up the replacement.
create or replace function public.audit_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club   uuid;
  v_id     uuid;
  v_action text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'team.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'team.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.bib_colour is distinct from old.bib_colour then v_changed := array_append(v_changed, 'bib_colour'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'team.updated';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
-- exactly as intended.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- Tables and columns exist.
  if to_regclass('public.venues') is null
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
   where relname in ('venues','session_teams','register_entries')
     and relnamespace = 'public'::regnamespace and relrowsecurity;
  if n <> 3 then
    raise exception 'training_day_core: row level security is not enabled on all three tables (got %)', n;
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
  -- Coverage select must stay exactly club wide, matching the sessions it
  -- describes; a capability there would hide sessions from their own club.
  if exists (select 1 from pg_policies
             where schemaname='public' and tablename='session_teams' and cmd='ALL') then
    raise exception 'training_day_core: session_teams must not carry a FOR ALL policy';
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

  -- The composite club scoped references are declared.
  if not exists (select 1 from pg_constraint where conname = 'register_entries_session_fk')
     or not exists (select 1 from pg_constraint where conname = 'register_entries_player_fk')
     or not exists (select 1 from pg_constraint where conname = 'session_teams_session_fk')
     or not exists (select 1 from pg_constraint where conname = 'session_teams_team_fk') then
    raise exception 'training_day_core: a composite club scoped foreign key is missing';
  end if;

  -- Audit triggers exist for the configuration tables and not for the
  -- register, which is deliberately unaudited per tick.
  if not exists (select 1 from pg_trigger where tgname = 'audit_venues')
     or not exists (select 1 from pg_trigger where tgname = 'audit_session_teams') then
    raise exception 'training_day_core: an audit trigger is missing';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.register_entries'::regclass
               and tgname like 'audit%') then
    raise exception 'training_day_core: register_entries must not be audited per tick';
  end if;
  -- A team's default bib is club configuration; changing it must leave a
  -- trail beside a rename.
  if position('bib_colour' in pg_get_functiondef('public.audit_teams()'::regprocedure)) = 0 then
    raise exception 'training_day_core: audit_teams must record a bib_colour change';
  end if;

  -- anon holds nothing on any of the three tables: none of them has an
  -- anonymous read path, and a stack with permissive default privileges
  -- would otherwise leave one behind the grants above.
  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('venues','session_teams','register_entries')
     and grantee = 'anon';
  if n <> 0 then
    raise exception 'training_day_core: anon must hold no grant on the new tables (got %)', n;
  end if;

  -- Coverage rows are added and removed, never edited.
  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and table_name='session_teams'
                and grantee='authenticated' and privilege_type='UPDATE') then
    raise exception 'training_day_core: session_teams must not grant UPDATE';
  end if;

  -- The venue name check must bite on whitespace that is not a space.
  begin
    insert into public.venues (club_id, name)
    values ((select id from public.clubs limit 1), E'\t');
    raise exception 'training_day_core: a whitespace only venue name was accepted';
  exception
    when check_violation then null;
    when not_null_violation then null;
  end;

  -- The migration fabricates no coverage and no attendance.
  if (select count(*) from public.session_teams) <> 0 then
    raise exception 'training_day_core: the migration must not create coverage rows';
  end if;
  if (select count(*) from public.register_entries) <> 0 then
    raise exception 'training_day_core: the migration must not create register rows';
  end if;
  if (select count(*) from public.sessions where venue_id is not null) <> 0 then
    raise exception 'training_day_core: the migration must not place any session at a venue';
  end if;
end
$$;

commit;
