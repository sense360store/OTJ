-- =====================================================================
-- OTJ Training Hub, migration 0016_member_teams: teams as a set plus an
-- all teams flag
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge.
--
-- Numbering: provisional, assigned at apply time against the live
-- ledger. Requires the RBAC v2 roles migration before it: the data
-- migration below reads member_roles and roles.
--
-- A member belongs to specific teams (rows in member_teams) or to all
-- teams (profiles.all_teams, a durable boolean meaning every team,
-- current and future, with no re-ticking when a team is added). While
-- all_teams is true any member_teams rows are moot: they stay as the
-- remembered selection but nothing reads them. Admin and manager get
-- all teams behaviour by default (set for existing members below,
-- defaulted by invite-user for new ones), and the flag grants the same
-- to anyone without making them a manager.
--
-- Standing rule, restated: teams scope no row level security. Content
-- stays club wide; the membership set and the flag drive the planner
-- team filter and switcher only. Hard team isolation, if ever wanted,
-- is a separate phase.
--
-- Decision recorded: profiles.team_id is KEPT as a denormalised primary
-- team for display and filter defaults, exactly as profiles.role is
-- kept as the display primary by the roles migration. It appears in no
-- access decision (it never did; 0002 established team_id appears in no
-- policy) and remains self service: a member may point their own
-- default filter at any team. Membership, which the team switcher
-- offers, is member_teams plus the flag and is user administration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- member_teams: which teams a member belongs to. Cascades on both
-- sides: removing a member removes their memberships, removing a team
-- removes its memberships.
-- ---------------------------------------------------------------------
create table public.member_teams (
  member_id uuid not null references public.profiles (id) on delete cascade,
  team_id   uuid not null references public.teams (id) on delete cascade,
  primary key (member_id, team_id)
);
create index on public.member_teams (team_id);

alter table public.member_teams enable row level security;

-- Club members read the club's memberships (the team switcher and the
-- Users screen). The club scope rides the teams row; the insert policy
-- pins both sides to the writer's own club.
create policy "member_teams_select_club" on public.member_teams
  for select using (
    exists (
      select 1 from public.teams t
      where t.id = member_teams.team_id and t.club_id = public.my_club()
    )
  );

-- Team assignment is user administration, so writes take users.manage,
-- not teams.manage (which is about the teams themselves).
create policy "member_teams_insert_users_manage" on public.member_teams
  for insert with check (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.teams t
      where t.id = member_teams.team_id and t.club_id = public.my_club()
    )
    and exists (
      select 1 from public.profiles p
      where p.id = member_teams.member_id and p.club_id = public.my_club()
    )
  );

create policy "member_teams_delete_users_manage" on public.member_teams
  for delete using (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.teams t
      where t.id = member_teams.team_id and t.club_id = public.my_club()
    )
  );

-- No update policy on purpose: a membership is a pair, and a change of
-- pair is a delete plus an insert, each carrying its own checks.

-- ---------------------------------------------------------------------
-- The all teams flag, on profiles. Writable by users.manage through the
-- existing profiles_users_manage policy; pinned against self service
-- below, because team membership is user administration even when it is
-- expressed as a flag.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column all_teams boolean not null default false;

-- my_all_teams: the caller's own flag, for the profiles_update_self pin
-- below. SECURITY DEFINER and STABLE for the same reasons and with the
-- same shape as my_role(): it reads profiles without re-triggering
-- profiles RLS, and inside an update statement it reads the row as it
-- stood before the write. Granted to anon as well because policies
-- evaluate as the calling role and an anonymous attempt must fail on
-- the policy, not error on execute.
create or replace function public.my_all_teams()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select all_teams from public.profiles where id = auth.uid();
$$;

grant execute on function public.my_all_teams() to anon, authenticated;

-- profiles_update_self, recreated from 0012 with one more pinned
-- column. The with check pins role, club_id and now all_teams to their
-- current values, so name, avatar, avatar_url, team_id and age groups
-- stay self service while role, club and the all teams flag change only
-- through profiles_users_manage.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role::text = public.my_role()
    and club_id is not distinct from public.my_club()
    and all_teams = public.my_all_teams()
  );

-- ---------------------------------------------------------------------
-- Data migration. Each existing primary team becomes a membership row,
-- and members holding the admin or manager system role get the all
-- teams default. Matching goes through member_roles and roles keys, so
-- a member holding admin alongside another role is still caught, and
-- nothing here touches the role_kind enum.
-- ---------------------------------------------------------------------
insert into public.member_teams (member_id, team_id)
select p.id, p.team_id
from public.profiles p
where p.team_id is not null
on conflict do nothing;

update public.profiles p
set all_teams = true
where exists (
  select 1
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.member_id = p.id
    and r.system
    and r.key in ('admin', 'manager')
);

-- ---------------------------------------------------------------------
-- Grants, explicit as always since 0012. RLS above is the real gate; no
-- update grant where no update policy exists.
-- ---------------------------------------------------------------------
grant select, insert, delete on public.member_teams to authenticated;
