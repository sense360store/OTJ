-- =====================================================================
-- OTJ Training Hub, migration 0015_rbac_roles: roles become data
--
-- REVIEW REQUIRED. This is the heart of RBAC v2 and the most security
-- sensitive migration in the project. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge.
--
-- Numbering: provisional, assigned at apply time against the live
-- ledger. This file requires the role_kind manager value migration
-- before it (separate file, see the enum transaction note there) and is
-- required by the member teams migration after it.
--
-- Why this is a redesign and not an addition. 0012_rbac stored roles as
-- the role_kind enum and keyed role_capabilities on it, with has_perm()
-- granting on the caller's single profiles.role. Three requirements
-- break that: a member may hold several roles at once, an admin may
-- create new custom roles at runtime (an enum cannot express that
-- without a migration per role), and team membership becomes a set
-- (next migration). So roles move to a table, assignments move to a
-- member_roles join table, role_capabilities re-keys onto roles by id,
-- and has_perm() grants on any held role. Every existing write policy
-- calls has_perm(capability) with an unchanged signature, so no content
-- policy in this file or any earlier one needs an edit.
--
-- The escalation line, enforced here in the database and not only in
-- the UI. There are thirteen capabilities. Eleven are content
-- capabilities: the create and manage pairs for drills, media,
-- templates, programmes and sessions, plus teams.manage. Two are
-- administrative and reserved: users.manage (invite, remove, change
-- roles, edit the capability grid; it is self propagating because its
-- holders can assign the admin role) and club.manage (club settings and
-- the Spond mapping editor). Custom roles may hold any of the eleven;
-- the two reserved capabilities may map only to the built in admin
-- role, and a trigger below refuses anything else whatever writes the
-- table. Admin stays the only thing that can create admins.
--
-- Decision recorded: profiles.role and the role_kind enum are KEPT.
-- profiles.role becomes a denormalised display primary (the highest
-- precedence system role a member holds), my_role() keeps returning it
-- for display, and handle_new_user keeps writing it from invite
-- metadata. It appears in no access decision after this migration:
-- has_perm() reads member_roles only, and every write policy goes
-- through has_perm(). The role editor and the invite-user function keep
-- the primary coherent with member_roles. Retiring the column was
-- weighed and declined for this phase: it would touch my_role(),
-- handle_new_user, profiles_update_self and the UI in the same gated
-- change, and the column is harmless once it is display only.
--
-- The self escalation guard from 0012 remains provably intact:
--   1. member_roles writes require has_perm('users.manage'). There is
--      deliberately no update policy; an assignment is added or removed,
--      never edited.
--   2. role_capabilities writes require has_perm('users.manage'), and
--      the reserved capability trigger keeps users.manage and
--      club.manage on the admin system role only, so a users.manage
--      holder cannot mint an admin equivalent custom role either.
--   3. profiles_update_self (0012) still pins role and club_id on self
--      edits, so the display primary cannot be self raised. It is
--      recreated unchanged in spirit by the member teams migration,
--      which adds one more pinned column.
--   4. has_perm() stays SECURITY DEFINER, STABLE, search_path locked,
--      and reads only rows where member_id = auth.uid().
-- A member without users.manage therefore cannot grow their own
-- capability set through any path the API exposes.
--
-- Day one access is unchanged for every member. Each member's single
-- profiles.role becomes one member_roles row against the matching
-- system role, and the live role_capabilities rows are copied across
-- keyed by role id, so has_perm() answers exactly as it did the moment
-- before the migration. The new manager role starts with members none,
-- so its seed grants nobody anything. A profile with a null club_id
-- gets no member_roles row and so no capabilities; such a member had no
-- effective write access before either, because every write policy also
-- requires club_id = my_club().
--
-- Deliberate windows between this apply and the rest of RBAC v2
-- landing, all failing closed or visible:
--   * invite-user and remove-user still probe the old role keyed
--     mapping; the probe errors and both functions refuse. Redeploy the
--     reworked functions immediately after this and the member teams
--     migration apply.
--   * The Users screen tick grid reads a role column that no longer
--     exists; the read errors visibly and the screen stays reachable
--     for admins through the UI's admin fallback. The RBAC v2 UI
--     replaces the grid.
--   * The old role editor writes profiles.role, which is now display
--     only; a capability change needs member_roles. Merge the RBAC v2
--     UI promptly so role edits bite again.
--
-- Out of scope, restated: teams still scope no row level security,
-- content stays club wide, and the capability catalogue is unchanged at
-- thirteen rows. Custom roles recombine existing capabilities only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- roles: one row per role per club. The four built ins are system rows;
-- custom rows are created by admins through the roles manager. key is
-- the stable slug code refers to; label is what the UI shows. System
-- rows keep their key, club and system flag and cannot be deleted
-- (trigger below); their labels and capability sets stay editable.
-- Deleting a custom role removes its assignments and its capability
-- rows through the cascades; the UI confirms before doing it.
-- ---------------------------------------------------------------------
create table public.roles (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  key        text not null
    constraint roles_key_is_slug check (key ~ '^[a-z0-9][a-z0-9_]{0,62}$'),
  label      text not null,
  system     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (club_id, key)
);
create index on public.roles (club_id);

-- Protect the system rows. The clubs existence check lets a club delete
-- cascade through (the clubs row is already gone when the cascade
-- reaches roles); every other delete of a system row is refused, as is
-- changing a system row's key, club or system flag, or promoting a
-- custom row to system (only migrations make system rows).
create or replace function public.roles_protect_system()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.system and exists (select 1 from public.clubs c where c.id = old.club_id) then
      raise exception 'system roles cannot be deleted';
    end if;
    return old;
  end if;
  if old.system and (new.key <> old.key or new.club_id <> old.club_id or not new.system) then
    raise exception 'system roles keep their key, club and system flag';
  end if;
  if not old.system and new.system then
    raise exception 'custom roles cannot become system roles';
  end if;
  return new;
end;
$$;

create trigger roles_protect_system
  before update or delete on public.roles
  for each row execute function public.roles_protect_system();

alter table public.roles enable row level security;

create policy "roles_select_club" on public.roles
  for select using ( club_id = public.my_club() );

-- Creating a role is user administration. The insert pins system to
-- false so the API can never mint a system row; the trigger handles the
-- update and delete side.
create policy "roles_insert_users_manage" on public.roles
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('users.manage')
    and system = false
  );

create policy "roles_update_users_manage" on public.roles
  for update using ( club_id = public.my_club() and public.has_perm('users.manage') )
  with check ( club_id = public.my_club() and public.has_perm('users.manage') );

create policy "roles_delete_users_manage" on public.roles
  for delete using ( club_id = public.my_club() and public.has_perm('users.manage') );

-- Seed the four built ins for every existing club (there is one today;
-- written per club so a fresh database replays cleanly whatever clubs
-- exist).
insert into public.roles (club_id, key, label, system)
select c.id, v.key, v.label, true
from public.clubs c
cross join (values
  ('admin',   'Admin'),
  ('manager', 'Manager'),
  ('coach',   'Coach'),
  ('parent',  'Parent')
) as v(key, label)
on conflict (club_id, key) do nothing;

-- ---------------------------------------------------------------------
-- member_roles: which roles a member holds. A set, not a single value:
-- admin plus coach, or coach plus parent, are single members with two
-- rows. Cascades on both sides: removing a member removes their
-- assignments, deleting a custom role unassigns everyone holding it.
-- ---------------------------------------------------------------------
create table public.member_roles (
  member_id uuid not null references public.profiles (id) on delete cascade,
  role_id   uuid not null references public.roles (id) on delete cascade,
  primary key (member_id, role_id)
);
create index on public.member_roles (role_id);

-- The club must keep at least one member holding the admin system role,
-- or nobody can manage users again without database access. remove-user
-- enforces this before deleting a member; this trigger is the server
-- side boundary for the role editor, which writes member_roles
-- directly. The two existence checks let cascades through: when a club
-- delete cascades here the roles row is already gone, and when a member
-- delete cascades here the profiles row is already gone (and remove-user
-- has already applied the rule).
create or replace function public.member_roles_protect_last_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.member_id = old.member_id and new.role_id = old.role_id then
    return new;
  end if;
  if exists (
       select 1 from public.roles r
       where r.id = old.role_id and r.key = 'admin' and r.system
     )
     and exists (select 1 from public.profiles p where p.id = old.member_id)
     and not exists (
       select 1 from public.member_roles mr
       where mr.role_id = old.role_id and mr.member_id <> old.member_id
     )
  then
    raise exception 'the club must keep at least one member holding the admin role';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger member_roles_protect_last_admin
  before update or delete on public.member_roles
  for each row execute function public.member_roles_protect_last_admin();

alter table public.member_roles enable row level security;

-- Club members read the club's assignments (the role badges). The club
-- scope rides the roles row, which the insert policy pins to the
-- writer's own club on both sides, so a cross club assignment cannot be
-- created through the API.
create policy "member_roles_select_club" on public.member_roles
  for select using (
    exists (
      select 1 from public.roles r
      where r.id = member_roles.role_id and r.club_id = public.my_club()
    )
  );

create policy "member_roles_insert_users_manage" on public.member_roles
  for insert with check (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.roles r
      where r.id = member_roles.role_id and r.club_id = public.my_club()
    )
    and exists (
      select 1 from public.profiles p
      where p.id = member_roles.member_id and p.club_id = public.my_club()
    )
  );

create policy "member_roles_delete_users_manage" on public.member_roles
  for delete using (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.roles r
      where r.id = member_roles.role_id and r.club_id = public.my_club()
    )
  );

-- No update policy on purpose: an assignment is a pair, and a change of
-- pair is a delete plus an insert, each carrying its own checks.

-- ---------------------------------------------------------------------
-- role_capabilities re-keys onto roles by id. The enum keyed table from
-- 0012 is renamed aside, its live rows are copied across (live rows,
-- not the original seed, so grid edits made since 0012 survive), and it
-- is dropped in the same transaction, taking its policies and grants
-- with it. The capability column still references the catalogue, so the
-- grid can never grant a capability no policy knows.
-- ---------------------------------------------------------------------
alter table public.role_capabilities rename to role_capabilities_enum;

create table public.role_capabilities (
  role_id    uuid not null references public.roles (id) on delete cascade,
  capability text not null references public.capabilities (key) on delete cascade,
  primary key (role_id, capability)
);

-- The reserved capability guard, in the database so the rule holds
-- whatever writes the table, not only the UI. users.manage and
-- club.manage map only to the admin system role, and they cannot be
-- removed from it either, which would strand the club with no user or
-- club administration. The roles existence check on the removal arm
-- lets a cascade from a roles or clubs delete through (the roles row is
-- already gone by then); it is also what permits cleaning a reserved
-- row off a non admin role, should one ever exist.
create or replace function public.role_capabilities_guard_reserved()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  reserved constant text[] := array['users.manage', 'club.manage'];
begin
  if tg_op in ('INSERT', 'UPDATE') and new.capability = any (reserved) then
    if not exists (
      select 1 from public.roles r
      where r.id = new.role_id and r.key = 'admin' and r.system
    ) then
      raise exception 'capability % is reserved to the admin role', new.capability;
    end if;
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.capability = any (reserved) then
    if (tg_op = 'DELETE' or new.role_id <> old.role_id or new.capability <> old.capability)
       and exists (
         select 1 from public.roles r
         where r.id = old.role_id and r.key = 'admin' and r.system
       )
    then
      raise exception 'capability % cannot be removed from the admin role', old.capability;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger role_capabilities_guard_reserved
  before insert or update or delete on public.role_capabilities
  for each row execute function public.role_capabilities_guard_reserved();

-- Copy the live mapping across, keyed by role id. Every club's system
-- role receives the rows held against its key. The where clause
-- restates the reserved rule: if the old grid was ever used to grant a
-- reserved capability to a non admin role, that row was an escalation
-- hole and is deliberately not carried over (and the guard above would
-- refuse it anyway).
insert into public.role_capabilities (role_id, capability)
select r.id, rce.capability
from public.role_capabilities_enum rce
join public.roles r on r.key = rce.role::text and r.system
where rce.capability not in ('users.manage', 'club.manage')
   or r.key = 'admin';

-- The manager seed: the eleven content capabilities, which is everything
-- except the two reserved administrative ones. Manager is club wide
-- content management without user or club administration. No member
-- holds manager on the day this lands, so these rows change nobody's
-- access.
insert into public.role_capabilities (role_id, capability)
select r.id, c.key
from public.roles r
cross join public.capabilities c
where r.key = 'manager' and r.system
  and c.key not in ('users.manage', 'club.manage')
on conflict do nothing;

drop table public.role_capabilities_enum;

alter table public.role_capabilities enable row level security;

create policy "role_capabilities_select_members" on public.role_capabilities
  for select using (
    exists (
      select 1 from public.roles r
      where r.id = role_capabilities.role_id and r.club_id = public.my_club()
    )
  );

create policy "role_capabilities_insert_users_manage" on public.role_capabilities
  for insert with check (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.roles r
      where r.id = role_capabilities.role_id and r.club_id = public.my_club()
    )
  );

create policy "role_capabilities_delete_users_manage" on public.role_capabilities
  for delete using (
    public.has_perm('users.manage')
    and exists (
      select 1 from public.roles r
      where r.id = role_capabilities.role_id and r.club_id = public.my_club()
    )
  );

-- No update policy, as on member_roles: the grid unticks and ticks,
-- which is a delete and an insert. 0012 carried an update policy; it is
-- deliberately not recreated, removing a path on which the reserved
-- guard would otherwise have to argue about row identity.

-- ---------------------------------------------------------------------
-- has_perm rewritten: grant on any held role. The signature, SECURITY
-- DEFINER (it must read member_roles and role_capabilities without
-- re-triggering their RLS), STABLE and the locked search_path are all
-- unchanged from 0012, so every existing policy that calls it needs no
-- edit and the existing execute grants ride the replace. The parameter
-- is referenced as has_perm.capability because a bare "capability"
-- would resolve to the column, comparing it with itself.
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
    join public.role_capabilities rc on rc.role_id = mr.role_id
    where mr.member_id = auth.uid()
      and rc.capability = has_perm.capability
  );
$$;

-- ---------------------------------------------------------------------
-- Data migration: every member's current single role becomes one
-- member_roles row against the matching system role in their club.
-- Together with the mapping copy above this reproduces today's access
-- exactly; nobody gains or loses a capability when this lands.
-- ---------------------------------------------------------------------
insert into public.member_roles (member_id, role_id)
select p.id, r.id
from public.profiles p
join public.roles r
  on r.club_id = p.club_id and r.key = p.role::text and r.system
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase does not auto grant Data API access to new
-- tables (the 0012 lesson); RLS above remains the real gate. No update
-- grant where no update policy exists. The dropped enum keyed table
-- took its own grants with it, and has_perm kept its execute grants
-- through the replace.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, delete on public.member_roles to authenticated;
grant select, insert, delete on public.role_capabilities to authenticated;
