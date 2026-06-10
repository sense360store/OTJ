-- =====================================================================
-- OTJ Training Hub - club-wide session visibility and first-class teams
-- Migration 0002_teams_roles
--
-- REVIEW REQUIRED. This file changes the security boundary. Run by hand
-- in the Supabase SQL editor after review. Do not merge without a human
-- review and do not auto-merge.
--
-- Design decision (CLAUDE.md, Roles, teams and permissions): visibility
-- is club-wide, ownership is personal, teams are a filter. Coaches read
-- every club session; write and delete stay owner or admin. Teams are
-- data for filtering and defaults, never access control, so team_id
-- appears in no policy.
-- =====================================================================

-- Coaches see all club sessions. Write and delete policies are untouched:
-- insert own, update own or admin, delete own or admin.
drop policy "sessions_select_own_or_admin" on public.sessions;
create policy "sessions_select_club" on public.sessions
  for select using ( club_id = public.my_club() );

-- Teams as first-class data. Club members read them; admins manage them.
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);
create index on public.teams (club_id);
alter table public.teams enable row level security;
create policy "teams_select_club" on public.teams
  for select using ( club_id = public.my_club() );
create policy "teams_admin_manage" on public.teams
  for all using ( club_id = public.my_club() and public.my_role() = 'admin' )
  with check ( club_id = public.my_club() and public.my_role() = 'admin' );

-- Team attributes, both nullable: a session's team and a coach's default
-- team. Filters and defaults only, never access control. Removing a team
-- nulls the references.
alter table public.sessions add column team_id uuid references public.teams (id) on delete set null;
alter table public.profiles add column team_id uuid references public.teams (id) on delete set null;
create index on public.sessions (team_id);
