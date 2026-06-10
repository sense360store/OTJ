-- =====================================================================
-- OTJ Training Hub - roles as data, capability lookups, managed filters
-- Migration 0009_rbac
--
-- REVIEW REQUIRED. This is the largest security change since the original
-- schema. It rewrites every policy that names a role literal, so every
-- line below decides what a signed in user can read or write. Run by hand
-- via the connector after line by line review. Do not auto-merge.
--
-- Design (Phase 8):
--   * A fixed capability catalogue is the vocabulary of the system. It
--     lives in src/lib/permissions.ts and in the check constraint below;
--     the two lists must match exactly. Adding a capability is a migration.
--   * Roles are rows, per club. Admin, Coach and Parent are seeded for
--     every club as system roles. System roles cannot be renamed or
--     deleted (the roles policies exclude them), and the Admin role keeps
--     roles.manage and users.manage (a trigger refuses removing them).
--   * Permissions are role_permissions rows. has_perm(p) is the single
--     lookup every rewritten policy uses. Ownership clauses stay as they
--     were: owners always manage their own items, manage_any extends that
--     to items the user does not own. Templates carry no owner column, so
--     template writes ride on templates.manage alone, as before.
--   * live.drive_any is in the catalogue for the live view affordance.
--     It appears in no policy in this phase: driving writes the session
--     row, and that update stays owner or sessions.manage_any, exactly
--     the pre-phase behaviour. A role ticked live.drive_any without
--     sessions.manage_any sees the drive affordance but the update policy
--     still refuses; wiring it into the sessions update policy is a
--     deliberate later decision, not an accident of this migration.
--   * Role filter tags (role_filters) are enforced curation at the
--     application layer; the club boundary in RLS remains the only hard
--     security boundary. They appear in no policy.
--   * Filter taxonomies become managed rows (filter_options), seeded per
--     club from the FA lists in src/lib/fa.ts, which becomes the seed
--     source rather than the runtime source. Corners and levels stay
--     fixed enums; they are structural.
--   * The role enum column on profiles stays in place, unused by any
--     policy after this migration, as a one phase fallback. Removing it
--     is a later cleanup.
--
-- Also in this migration, flagged for the reviewer:
--   * protect_profile_privileges closes a pre-existing hole: the
--     profiles_update_self policy lets a member update their own row,
--     and nothing stopped that update changing role (and now role_id) or
--     club_id. Self service edits keep working; privilege columns now
--     need users.manage.
--   * seed_club_rbac(uuid) carries the per club seeding so the local
--     seed.sql can reuse it; clients cannot execute it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- The capability catalogue. The check constraint pins the vocabulary to
-- the fifteen capabilities; src/lib/permissions.ts mirrors this list.
create table public.roles (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

create table public.role_permissions (
  role_id    uuid not null references public.roles (id) on delete cascade,
  permission text not null check (permission in (
    'drills.create',
    'drills.manage_any',
    'media.create',
    'media.manage_any',
    'templates.create',
    'templates.manage',
    'sessions.create',
    'sessions.manage_any',
    'live.drive_any',
    'import.fa',
    'teams.manage',
    'filters.manage',
    'roles.manage',
    'users.manage',
    'club.manage'
  )),
  primary key (role_id, permission)
);

-- Filter tags carried by a role: the tagged role's library, templates,
-- media and sessions views lock to matching content in the application.
-- Curation, not a security boundary; these rows appear in no policy.
create table public.role_filters (
  role_id uuid not null references public.roles (id) on delete cascade,
  kind    text not null check (kind in ('theme', 'player_skill', 'coach_skill', 'format', 'age_band')),
  value   text not null,
  primary key (role_id, kind, value)
);

-- The managed filter taxonomies. Retiring a value (active false) drops it
-- from pickers and filter rows; existing content keeps its stored text.
create table public.filter_options (
  id      uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  kind    text not null check (kind in ('theme', 'player_skill', 'coach_skill', 'format', 'age_band')),
  value   text not null,
  sort    int not null default 0,
  active  boolean not null default true,
  unique (club_id, kind, value)
);

create index on public.roles (club_id);
create index on public.filter_options (club_id);

-- The member's role. Null means no capabilities (and no club, or a row
-- from before this migration that the backfill below repairs).
alter table public.profiles add column role_id uuid references public.roles (id) on delete set null;
create index on public.profiles (role_id);

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
-- SECURITY DEFINER like my_club() and my_role(): they read the lookup
-- tables without re-triggering RLS, which keeps the policies below free
-- of recursion. They only ever answer for the calling user.

create or replace function public.has_perm(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on rp.role_id = pr.role_id
    where pr.id = auth.uid()
      and rp.permission = p
  );
$$;

-- my_role() now answers from the role row ("Admin", "Coach", a custom
-- name). After this migration no policy calls it; it stays for
-- compatibility until the role enum column is removed.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 3. Per club seeding and the backfill
-- ---------------------------------------------------------------------
-- Idempotent: system roles, the Admin and Coach grants, and the FA filter
-- taxonomies from src/lib/fa.ts. Reused by supabase/seed.sql for the
-- locally seeded club, which is inserted after migrations run.

create or replace function public.seed_club_rbac(p_club uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_coach uuid;
begin
  insert into public.roles (club_id, name, is_system)
  values
    (p_club, 'Admin', true),
    (p_club, 'Coach', true),
    (p_club, 'Parent', true)
  on conflict (club_id, name) do nothing;

  select id into v_admin from public.roles where club_id = p_club and name = 'Admin';
  select id into v_coach from public.roles where club_id = p_club and name = 'Coach';

  -- Admin: every capability. roles.manage and users.manage are locked on
  -- by the protect_admin_grants trigger below.
  insert into public.role_permissions (role_id, permission)
  select v_admin, p
  from unnest(array[
    'drills.create', 'drills.manage_any',
    'media.create', 'media.manage_any',
    'templates.create', 'templates.manage',
    'sessions.create', 'sessions.manage_any',
    'live.drive_any', 'import.fa',
    'teams.manage', 'filters.manage', 'roles.manage', 'users.manage', 'club.manage'
  ]) as p
  on conflict do nothing;

  -- Coach: the create capabilities plus the FA import, matching the
  -- pre-phase policies exactly. live.drive_any is not granted: driving
  -- stays owner or admin through sessions.manage_any.
  insert into public.role_permissions (role_id, permission)
  select v_coach, p
  from unnest(array[
    'drills.create', 'media.create', 'templates.create', 'sessions.create', 'import.fa'
  ]) as p
  on conflict do nothing;

  -- Parent: no capabilities. Reading club content needs none.

  -- Filter taxonomies, seeded from the FA lists in src/lib/fa.ts.
  insert into public.filter_options (club_id, kind, value, sort)
  select p_club, kind, value, sort
  from (
    values
      ('theme', 'Attacking', 0),
      ('theme', 'Coaching', 1),
      ('theme', 'Defending', 2),
      ('theme', 'Goalkeeping', 3),
      ('theme', 'Futsal', 4),
      ('player_skill', 'Communication', 0),
      ('player_skill', 'Covering', 1),
      ('player_skill', 'Finishing', 2),
      ('player_skill', 'Intercepting', 3),
      ('player_skill', 'Marking', 4),
      ('player_skill', 'Moving with the ball', 5),
      ('player_skill', 'Organisation', 6),
      ('player_skill', 'Passing', 7),
      ('player_skill', 'Pressing', 8),
      ('player_skill', 'Receiving', 9),
      ('player_skill', 'Tackling', 10),
      ('player_skill', 'Turning', 11),
      ('coach_skill', 'Creating the environment', 0),
      ('coach_skill', 'Session design', 1),
      ('coach_skill', 'Game principles', 2),
      ('coach_skill', 'Skills and tactics', 3),
      ('format', '1-4 per side', 0),
      ('format', '5-8 per side', 1),
      ('format', '9-11 per side', 2),
      ('age_band', '4-6 (Play phase)', 0),
      ('age_band', '5-11', 1),
      ('age_band', '12-16', 2),
      ('age_band', '17-21', 3),
      ('age_band', '21+', 4)
  ) as t (kind, value, sort)
  on conflict (club_id, kind, value) do nothing;
end;
$$;

-- Seeding is for migrations and the service side only.
revoke execute on function public.seed_club_rbac(uuid) from public, anon, authenticated;

-- Seed every existing club, then point every profile at its club's system
-- role of the same name as its enum value.
do $$
declare
  c record;
begin
  for c in select id from public.clubs loop
    perform public.seed_club_rbac(c.id);
  end loop;
end;
$$;

update public.profiles p
set role_id = r.id
from public.roles r
where p.role_id is null
  and r.club_id = p.club_id
  and r.is_system
  and lower(r.name) = p.role::text;

-- ---------------------------------------------------------------------
-- 4. The sign-up trigger
-- ---------------------------------------------------------------------
-- The only trigger change of the phase: a role_id in the invite metadata
-- wins when it names a role of the club being joined; otherwise the
-- legacy role string maps to the club's system role of that name,
-- defaulting to Coach. The enum column is still written as the fallback.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club    uuid := nullif(new.raw_user_meta_data ->> 'club_id', '')::uuid;
  v_legacy  public.role_kind :=
    case
      when new.raw_user_meta_data ->> 'role' in ('coach', 'admin', 'parent')
        then (new.raw_user_meta_data ->> 'role')::public.role_kind
      else 'coach'
    end;
  v_role_id uuid := nullif(new.raw_user_meta_data ->> 'role_id', '')::uuid;
begin
  -- Valid means: the role exists and belongs to the club being joined.
  if v_role_id is not null then
    select r.id into v_role_id
    from public.roles r
    where r.id = v_role_id and r.club_id = v_club;
  end if;
  if v_role_id is null then
    select r.id into v_role_id
    from public.roles r
    where r.club_id = v_club and r.is_system and lower(r.name) = v_legacy::text;
  end if;

  insert into public.profiles (id, full_name, club_id, role, role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    v_club,
    v_legacy,
    v_role_id
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Policy rewrites: every role name literal becomes a has_perm lookup
-- ---------------------------------------------------------------------
-- Row shapes (club scoping, ownership clauses, with check conditions) are
-- unchanged from 0001, 0002 and 0007; only the role test changes.

-- clubs: update was my_role() = 'admin'
drop policy "clubs_update_admin" on public.clubs;
create policy "clubs_update_manage" on public.clubs
  for update using ( id = public.my_club() and public.has_perm('club.manage') )
  with check ( id = public.my_club() and public.has_perm('club.manage') );

-- profiles: the admin-everything policy was my_role() = 'admin'
drop policy "profiles_admin_all" on public.profiles;
create policy "profiles_all_users_manage" on public.profiles
  for all using ( club_id = public.my_club() and public.has_perm('users.manage') )
  with check ( club_id = public.my_club() and public.has_perm('users.manage') );

-- drills: insert was role in (coach, admin); update and delete were owner
-- or admin
drop policy "drills_insert_club" on public.drills;
create policy "drills_insert_create" on public.drills
  for insert with check ( club_id = public.my_club() and public.has_perm('drills.create') );
drop policy "drills_update_owner_or_admin" on public.drills;
create policy "drills_update_owner_or_manage" on public.drills
  for update using ( club_id = public.my_club() and (created_by = auth.uid() or public.has_perm('drills.manage_any')) )
  with check ( club_id = public.my_club() );
drop policy "drills_delete_owner_or_admin" on public.drills;
create policy "drills_delete_owner_or_manage" on public.drills
  for delete using ( club_id = public.my_club() and (created_by = auth.uid() or public.has_perm('drills.manage_any')) );

-- media: same pattern as drills
drop policy "media_insert_club" on public.media;
create policy "media_insert_create" on public.media
  for insert with check ( club_id = public.my_club() and public.has_perm('media.create') );
drop policy "media_update_owner_or_admin" on public.media;
create policy "media_update_owner_or_manage" on public.media
  for update using ( club_id = public.my_club() and (created_by = auth.uid() or public.has_perm('media.manage_any')) )
  with check ( club_id = public.my_club() );
drop policy "media_delete_owner_or_admin" on public.media;
create policy "media_delete_owner_or_manage" on public.media
  for delete using ( club_id = public.my_club() and (created_by = auth.uid() or public.has_perm('media.manage_any')) );

-- templates: insert was role in (coach, admin); update and delete were
-- admin only. Templates carry no owner column, so manage stays the only
-- write path beyond insert.
drop policy "templates_insert_club" on public.templates;
create policy "templates_insert_create" on public.templates
  for insert with check ( club_id = public.my_club() and public.has_perm('templates.create') );
drop policy "templates_update_admin" on public.templates;
create policy "templates_update_manage" on public.templates
  for update using ( club_id = public.my_club() and public.has_perm('templates.manage') )
  with check ( club_id = public.my_club() and public.has_perm('templates.manage') );
drop policy "templates_delete_admin" on public.templates;
create policy "templates_delete_manage" on public.templates
  for delete using ( club_id = public.my_club() and public.has_perm('templates.manage') );

-- sessions: insert keeps the own coach_id requirement; update and delete
-- keep the ownership clause. Driving a live session writes through the
-- update policy, so manage_any covers driving any club session.
drop policy "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check ( coach_id = auth.uid() and club_id = public.my_club() and public.has_perm('sessions.create') );
drop policy "sessions_update_own_or_admin" on public.sessions;
create policy "sessions_update_own_or_manage" on public.sessions
  for update using ( coach_id = auth.uid() or (club_id = public.my_club() and public.has_perm('sessions.manage_any')) )
  with check ( club_id = public.my_club() );
drop policy "sessions_delete_own_or_admin" on public.sessions;
create policy "sessions_delete_own_or_manage" on public.sessions
  for delete using ( coach_id = auth.uid() or (club_id = public.my_club() and public.has_perm('sessions.manage_any')) );

-- teams: manage was my_role() = 'admin'
drop policy "teams_admin_manage" on public.teams;
create policy "teams_manage" on public.teams
  for all using ( club_id = public.my_club() and public.has_perm('teams.manage') )
  with check ( club_id = public.my_club() and public.has_perm('teams.manage') );

-- ---------------------------------------------------------------------
-- 6. Policies for the new tables
-- ---------------------------------------------------------------------
-- Club members read; roles.manage writes roles, role_permissions and
-- role_filters; filters.manage writes filter_options. System roles are
-- excluded from update and delete, which is what makes them undeletable
-- and unrenameable. role_permissions and role_filters have no update
-- policy on purpose: a tick is added or removed, never edited.

alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_filters     enable row level security;
alter table public.filter_options   enable row level security;

create policy "roles_select_club" on public.roles
  for select using ( club_id = public.my_club() );
create policy "roles_insert_manage" on public.roles
  for insert with check ( club_id = public.my_club() and public.has_perm('roles.manage') and not is_system );
create policy "roles_update_manage" on public.roles
  for update using ( club_id = public.my_club() and public.has_perm('roles.manage') and not is_system )
  with check ( club_id = public.my_club() and not is_system );
create policy "roles_delete_manage" on public.roles
  for delete using ( club_id = public.my_club() and public.has_perm('roles.manage') and not is_system );

create policy "role_permissions_select_club" on public.role_permissions
  for select using (
    exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );
create policy "role_permissions_insert_manage" on public.role_permissions
  for insert with check (
    public.has_perm('roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );
create policy "role_permissions_delete_manage" on public.role_permissions
  for delete using (
    public.has_perm('roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );

create policy "role_filters_select_club" on public.role_filters
  for select using (
    exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );
create policy "role_filters_insert_manage" on public.role_filters
  for insert with check (
    public.has_perm('roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );
create policy "role_filters_delete_manage" on public.role_filters
  for delete using (
    public.has_perm('roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and r.club_id = public.my_club())
  );

create policy "filter_options_select_club" on public.filter_options
  for select using ( club_id = public.my_club() );
create policy "filter_options_insert_manage" on public.filter_options
  for insert with check ( club_id = public.my_club() and public.has_perm('filters.manage') );
create policy "filter_options_update_manage" on public.filter_options
  for update using ( club_id = public.my_club() and public.has_perm('filters.manage') )
  with check ( club_id = public.my_club() );
create policy "filter_options_delete_manage" on public.filter_options
  for delete using ( club_id = public.my_club() and public.has_perm('filters.manage') );

-- ---------------------------------------------------------------------
-- 7. Protection triggers
-- ---------------------------------------------------------------------
-- Both stand aside when auth.uid() is null (migrations, seeds and the
-- service role, which bypasses RLS anyway); they guard end user sessions.

-- Privilege columns on profiles need users.manage. This closes the
-- pre-existing hole where profiles_update_self allowed a member to change
-- their own role; with role_id now driving every permission, that would
-- be self escalation. The role's club must always match the member's
-- club, whoever is writing. While the legacy enum column remains, a role
-- change written only to it (a not yet redeployed client) re-maps role_id
-- to the matching system role so the two cannot drift.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and new.role_id is not distinct from old.role_id then
    select r.id into new.role_id
    from public.roles r
    where r.club_id = new.club_id and r.is_system and lower(r.name) = new.role::text;
  end if;

  if new.role_id is not null and new.role_id is distinct from old.role_id then
    if not exists (select 1 from public.roles r where r.id = new.role_id and r.club_id = new.club_id) then
      raise exception 'A role must belong to the member''s club.';
    end if;
  end if;

  if auth.uid() is not null
     and (new.role is distinct from old.role
          or new.role_id is distinct from old.role_id
          or new.club_id is distinct from old.club_id)
     and not public.has_perm('users.manage') then
    raise exception 'Changing a role or club needs user management permission.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- The Admin role's roles.manage and users.manage ticks are locked on, so
-- a club can never lock itself out of role and user management.
create or replace function public.protect_admin_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.permission in ('roles.manage', 'users.manage')
     and exists (
       select 1 from public.roles r
       where r.id = old.role_id and r.is_system and r.name = 'Admin'
     ) then
    raise exception 'The Admin role keeps role and user management.';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_admin_grants on public.role_permissions;
create trigger protect_admin_grants
  before delete on public.role_permissions
  for each row execute function public.protect_admin_grants();
