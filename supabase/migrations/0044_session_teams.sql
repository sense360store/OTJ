-- =====================================================================
-- OTJ Training Hub, migration 0044_session_teams: a session covers
-- teams through a join table; teams gain a default bib colour
-- (training day logistics, PR 3)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free (apply 0043_venues first; this file is
-- independent of it but the queue's order is the review order). Do not
-- auto-merge. No Edge Function changes accompany this migration.
--
-- Numbering: provisional 0044. The files on disk end at 0043_venues.sql
-- (also unapplied, gated); the live ledger is the authority.
--
-- WHAT THIS IS. Decision record docs/adr/ADR-0008-training-day-logistics.md:
-- a session is one whole club training slot, and the teams it covers are
-- rows in session_teams, built on the player_registrations composite
-- club scoped FK pattern. sessions.team_id is FROZEN as a legacy column
-- per the players.team_id precedent (0032): retained, never written by
-- new code, read as "covers that one team" for rows predating the join
-- table (a legacy null team reads as covering the whole club). There is
-- NO backfill and NO compatibility trigger by design: nothing needs
-- translating, the read fallback carries old rows until they are edited.
-- teams gain bib_colour, the default bib for the team, a colour label
-- with no stock tracking.
--
-- WHAT THIS DELIBERATELY IS NOT. No register (PR 7), no Spond link
-- tables (PR 4), no destructive drop of the frozen column (unscheduled,
-- would be its own 0033 style deliberately deferred migration).
-- =====================================================================

-- ---------------------------------------------------------------------
-- The composite FK target on sessions, the enabling step 0032 took for
-- teams: club scoped children can now reference (id, club_id) and the
-- "row's club equals the parent's club" rule is declarative.
-- ---------------------------------------------------------------------
alter table public.sessions
  add constraint sessions_id_club_unique unique (id, club_id);

-- ---------------------------------------------------------------------
-- session_teams: which teams a session covers. Composite FKs pin both
-- parents to the row's club; deleting a session or a team cascades its
-- rows (a cascade is covered by the parent's own audit event).
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
  $$The teams a session covers (ADR-0008). A session with no rows is a legacy row: its frozen sessions.team_id reads as covering that one team, and null as covering the whole club. Teams are a filter and a grouping, never access control (the 0016 standing rule); this table appears in no policy beyond its own.$$;

comment on column public.sessions.team_id is
  $$FROZEN legacy compatibility column. The canonical coverage is session_teams rows per session (ADR-0008). A legacy row with no session_teams rows reads as covering this one team, or the whole club when null. Retained as the read fallback for rows predating the join table; new code never writes it. No destructive drop is scheduled.$$;

-- ---------------------------------------------------------------------
-- RLS. Reads club wide (coverage is scheduling data, parents included);
-- writes follow the parent session's own write rule: its owner holding
-- sessions.create, or sessions.manage, in the caller's club.
-- ---------------------------------------------------------------------
alter table public.session_teams enable row level security;

create policy "session_teams_select_club" on public.session_teams
  for select using ( club_id = public.my_club() );

create policy "session_teams_write" on public.session_teams
  for all
  using (
    club_id = public.my_club()
    and exists (
      select 1 from public.sessions s
      where s.id = session_teams.session_id
        and s.club_id = public.my_club()
        and ( public.has_perm('sessions.manage')
              or (s.coach_id = auth.uid() and public.has_perm('sessions.create')) )
    )
  )
  with check (
    club_id = public.my_club()
    and exists (
      select 1 from public.sessions s
      where s.id = session_teams.session_id
        and s.club_id = public.my_club()
        and ( public.has_perm('sessions.manage')
              or (s.coach_id = auth.uid() and public.has_perm('sessions.create')) )
    )
  );

revoke all on public.session_teams from anon, authenticated;
grant select, insert, delete on public.session_teams to authenticated;
-- No update grant and no update policy: coverage changes are inserts and
-- deletes of pair rows, the member_teams convention.

-- ---------------------------------------------------------------------
-- teams.bib_colour: the team's default bib, a short colour label chosen
-- in the admin teams screen. Register entries can override it per
-- session (PR 7). Not on the audit_teams allow list: kit cosmetics, not
-- an accountability fact, and the allow list's own comment defines an
-- audited team update as a rename.
-- ---------------------------------------------------------------------
alter table public.teams
  add column bib_colour text check (bib_colour is null or char_length(bib_colour) between 1 and 20);

comment on column public.teams.bib_colour is
  $$The team's default bib colour, a short label (for example red). Register entries may override it per session. No stock tracking.$$;

-- ---------------------------------------------------------------------
-- Audit, the 0037 pattern: coverage changes are session events with the
-- team riding the event's team_id. A row removed by a session or team
-- delete cascade is covered by session.deleted or team.deleted and
-- writes nothing of its own.
-- ---------------------------------------------------------------------
create or replace function public.audit_session_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'session.team_added', 'session', new.session_id, new.team_id, null);
    return new;
  end if;
  if not exists (select 1 from public.sessions s where s.id = old.session_id)
     or not exists (select 1 from public.teams t where t.id = old.team_id) then
    return old;
  end if;
  perform public.audit_domain_event(old.club_id, auth.uid(), 'session.team_removed', 'session', old.session_id, old.team_id, null);
  return old;
end;
$$;

create trigger audit_session_teams
  after insert or delete on public.session_teams
  for each row execute function public.audit_session_teams();

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  if to_regclass('public.session_teams') is null then
    raise exception 'session_teams: the table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.session_teams'::regclass) then
    raise exception 'session_teams: row level security is not enabled';
  end if;

  -- Grants: select, insert, delete and nothing else for authenticated;
  -- anon nothing.
  if not (has_table_privilege('authenticated', 'public.session_teams', 'SELECT')
          and has_table_privilege('authenticated', 'public.session_teams', 'INSERT')
          and has_table_privilege('authenticated', 'public.session_teams', 'DELETE')) then
    raise exception 'session_teams: authenticated is missing an intended grant';
  end if;
  if has_table_privilege('authenticated', 'public.session_teams', 'UPDATE')
     or has_table_privilege('authenticated', 'public.session_teams', 'TRUNCATE') then
    raise exception 'session_teams: authenticated must not hold UPDATE or TRUNCATE';
  end if;
  if has_table_privilege('anon', 'public.session_teams', 'SELECT') then
    raise exception 'session_teams: anon must hold no grant';
  end if;

  -- The composite FK target and the frozen column comment are in place.
  if not exists (select 1 from pg_constraint where conname = 'sessions_id_club_unique') then
    raise exception 'session_teams: sessions_id_club_unique is missing';
  end if;
  if coalesce(col_description('public.sessions'::regclass,
       (select attnum from pg_attribute where attrelid = 'public.sessions'::regclass and attname = 'team_id')
     ), '') not like 'FROZEN%' then
    raise exception 'session_teams: the frozen comment on sessions.team_id is missing';
  end if;

  -- teams.bib_colour exists with its length check.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teams' and column_name = 'bib_colour'
  ) then
    raise exception 'session_teams: teams.bib_colour was not added';
  end if;

  -- Policies and the audit trigger are in place.
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'session_teams';
  if bad <> 2 then
    raise exception 'session_teams: expected 2 policies, found %', bad;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_session_teams' and not tgisinternal) then
    raise exception 'session_teams: the audit trigger is missing';
  end if;

  -- No backfill by design: the table starts empty even where sessions
  -- exist (the read fallback carries legacy rows).
  if exists (select 1 from public.session_teams) then
    raise exception 'session_teams: the table must start empty, no backfill by design';
  end if;
end
$$;
