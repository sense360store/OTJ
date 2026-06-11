-- =====================================================================
-- OTJ Training Hub, migration B: roles and teams become many to many
--
-- REVIEW REQUIRED. Migrations are gated. Applied by hand through the
-- Supabase connector after line by line review, and only after migration
-- A (the manager enum value) is live, because this file seeds rows
-- against 'manager'. Numbering follows migration A: if A is 0013 this is
-- 0014, and both shift together if the pending FA video migration takes a
-- slot first. Do not auto-merge.
--
-- The model. Until now a member held exactly one role (profiles.role) and
-- at most one team (profiles.team_id). This migration makes both many to
-- many through two join tables, member_roles and member_teams, which
-- become the source of truth for permissions and team membership. A
-- member can hold several roles at once, for example admin and coach, or
-- coach and parent (the common grassroots case of a coach who also has a
-- child at the club), and belong to several teams.
--
-- has_perm() is rewritten to grant a capability when ANY role the member
-- holds grants it. That single change is what makes dual roles work;
-- every policy that calls has_perm is unchanged and needs no edit.
--
-- profiles.role and profiles.team_id are kept as denormalized primaries
-- for display and sorting, NOT as the permission or membership truth.
-- They stay coherent because the only writers set the primary alongside
-- the join rows: handle_new_user on invite, the invite-user function, and
-- the Users screen all write profiles.role to the highest privilege role
-- held and profiles.team_id to the chosen primary team. The columns are
-- never read for access; member_roles and member_teams are.
--
-- Teams still scope no row level security. No policy references team_id or
-- member_teams for access; content stays club wide. This phase keeps
-- teams an organizing and assignment dimension, exactly as profiles.team_id
-- was. Hard team isolation, if it is ever wanted, is a separate change.
--
-- Self escalation stays closed. 0012's profiles_update_self still pins
-- role and club_id to their current values, so a member cannot raise
-- their own primary role; and member_roles, the real permission source,
-- is write gated on users.manage, so a member cannot grant themselves a
-- role or a capability. The two together mean a member can change neither
-- what has_perm reads for them nor the primary that display trusts. This
-- file does not touch profiles_update_self; the guard is left as 0012 set
-- it.
--
-- The whole file applies in one transaction. Every statement is idempotent
-- friendly (if not exists, on conflict do nothing) for review replays, and
-- the file is not meant to be reversed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- member_roles: the source of truth for a member's roles. The primary key
-- on (member_id, role) makes each role at most once per member. On delete
-- cascade so a removed member's roles go with their profile.
-- ---------------------------------------------------------------------
create table if not exists public.member_roles (
  member_id uuid not null references public.profiles (id) on delete cascade,
  role      role_kind not null,
  primary key (member_id, role)
);

-- member_teams: the source of truth for a member's teams. Same shape, with
-- both foreign keys cascading so a removed member or a removed team drops
-- its membership rows.
create table if not exists public.member_teams (
  member_id uuid not null references public.profiles (id) on delete cascade,
  team_id   uuid not null references public.teams (id)    on delete cascade,
  primary key (member_id, team_id)
);

-- Indexes for the reverse lookups: counting admins by role (the last admin
-- guard) and listing a team's members. The primary keys already cover
-- lookups by member_id.
create index if not exists member_roles_role_idx on public.member_roles (role);
create index if not exists member_teams_team_id_idx on public.member_teams (team_id);

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so the grants are explicit; RLS below is the real gate. The
-- Users screen reads both and writes both as the signed in admin. A
-- membership row has no mutable column, so it is inserted or deleted, never
-- updated; no update grant is given.
-- ---------------------------------------------------------------------
grant select, insert, delete on public.member_roles to authenticated;
grant select, insert, delete on public.member_teams to authenticated;

-- ---------------------------------------------------------------------
-- RLS. Club members read both join tables, scoped to their own club
-- through the profiles row the membership belongs to, so no member sees
-- another club's memberships. Writing either is user administration, gated
-- on users.manage, the same capability gate role_capabilities already
-- uses; team assignment counts as user administration too.
-- ---------------------------------------------------------------------
alter table public.member_roles enable row level security;

drop policy if exists "member_roles_select_members" on public.member_roles;
create policy "member_roles_select_members" on public.member_roles
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = member_roles.member_id and p.club_id = public.my_club()
    )
  );

drop policy if exists "member_roles_insert_users_manage" on public.member_roles;
create policy "member_roles_insert_users_manage" on public.member_roles
  for insert with check ( public.has_perm('users.manage') );

drop policy if exists "member_roles_delete_users_manage" on public.member_roles;
create policy "member_roles_delete_users_manage" on public.member_roles
  for delete using ( public.has_perm('users.manage') );

alter table public.member_teams enable row level security;

drop policy if exists "member_teams_select_members" on public.member_teams;
create policy "member_teams_select_members" on public.member_teams
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = member_teams.member_id and p.club_id = public.my_club()
    )
  );

drop policy if exists "member_teams_insert_users_manage" on public.member_teams;
create policy "member_teams_insert_users_manage" on public.member_teams
  for insert with check ( public.has_perm('users.manage') );

drop policy if exists "member_teams_delete_users_manage" on public.member_teams;
create policy "member_teams_delete_users_manage" on public.member_teams
  for delete using ( public.has_perm('users.manage') );

-- ---------------------------------------------------------------------
-- has_perm, rewritten. The capability is granted when ANY role the member
-- holds in member_roles maps to it in role_capabilities. This is the only
-- change the dual role model needs; every policy that calls has_perm is
-- left exactly as 0012 wrote it. The function stays SECURITY DEFINER,
-- STABLE and search path locked, so it reads the join tables without
-- re-triggering their RLS (which is also what lets the member_roles select
-- policy call has_perm without recursing). The parameter is referenced as
-- has_perm.capability so the bare name does not resolve to the column.
-- ---------------------------------------------------------------------
create or replace function public.has_perm(capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.member_roles mr
    join public.role_capabilities rc on rc.role = mr.role
    where mr.member_id = auth.uid()
      and rc.capability = has_perm.capability
  );
$$;

-- ---------------------------------------------------------------------
-- Data migration, preserving today's access exactly. Each member's current
-- single role becomes their first member_roles row, and each non null
-- team_id becomes their first member_teams row. After this, has_perm reads
-- the same effective access every member had through the single columns,
-- so nothing changes for anyone until an admin edits their roles.
-- ---------------------------------------------------------------------
insert into public.member_roles (member_id, role)
  select id, role from public.profiles
  on conflict do nothing;

insert into public.member_teams (member_id, team_id)
  select id, team_id from public.profiles where team_id is not null
  on conflict do nothing;

-- ---------------------------------------------------------------------
-- Seed the manager capability bundle. Manager manages all football content
-- across the club: the create and manage capabilities for drills, media,
-- templates, programmes and sessions, plus teams.manage. Manager
-- deliberately does NOT hold users.manage or club.manage; user and club
-- administration stay with admin. The enum value is live from migration A,
-- so seeding rows against 'manager' is safe here. The tick grid can move
-- this line later.
-- ---------------------------------------------------------------------
insert into public.role_capabilities (role, capability) values
  ('manager', 'drills.create'),
  ('manager', 'drills.manage'),
  ('manager', 'media.create'),
  ('manager', 'media.manage'),
  ('manager', 'templates.create'),
  ('manager', 'templates.manage'),
  ('manager', 'programmes.create'),
  ('manager', 'programmes.manage'),
  ('manager', 'sessions.create'),
  ('manager', 'sessions.manage'),
  ('manager', 'teams.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- handle_new_user, updated so an invited member's seeded role lands in
-- member_roles too, not only the profiles.role primary. The invite
-- metadata still carries a single role, the chosen primary; the
-- invite-user function adds any further roles and the teams after this row
-- exists. profiles.role stays the primary for display. The member_roles
-- insert is guarded with on conflict do nothing so a replay is safe.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seeded_role role_kind := coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::role_kind, 'coach');
begin
  insert into public.profiles (id, full_name, club_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(new.raw_user_meta_data ->> 'club_id', '')::uuid,
    seeded_role
  );
  insert into public.member_roles (member_id, role)
  values (new.id, seeded_role)
  on conflict do nothing;
  return new;
end;
$$;
