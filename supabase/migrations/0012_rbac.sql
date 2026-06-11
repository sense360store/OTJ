-- =====================================================================
-- OTJ Training Hub, migration 0012_rbac: roles hold capabilities
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- Numbering: the phase plan reserved 0010 for this work, but programmes
-- (0011) shipped first and is on the ledger. Migration files must
-- replay in filename order on a fresh database, and this file rewrites
-- the programmes policies, so it must sort after 0011. Hence 0012, and
-- 0010 is never reused.
--
-- The model. A capability is a named permission such as drills.create.
-- Roles hold capabilities through the seeded role_capabilities mapping,
-- which the admin tick grid edits. Policies call has_perm(capability)
-- instead of naming roles, so the mapping becomes the single place
-- access is defined. my_club() and my_role() stay exactly as they are.
--
-- Capability semantics: <entity>.create covers inserting rows and
-- editing or deleting the rows you own; <entity>.manage covers editing
-- or deleting anyone's rows in the club. Read access stays club wide
-- for every member and is gated by no capability.
--
-- The seed reproduces today's effective access:
--   admin:  every capability.
--   coach:  the five create capabilities. Coaches do not get the
--           manage capabilities: today a coach edits and deletes own
--           rows only (0009), does not curate templates (0001), and
--           has no team, user or club administration.
--   parent: no capabilities. Read only, exactly as 0007 and 0009
--           left them, including on rows they created before a
--           demotion: a parent holds neither arm of any write policy.
--
-- Two schema accommodations the rewrite needs:
--   * templates gains created_by. Templates never carried ownership,
--     so update and delete were admin only. The owner arm of the new
--     policy needs the column. Existing rows stay null and remain
--     reachable only through templates.manage, so nothing changes for
--     them; a template created from here on is editable by its owner
--     holding templates.create.
--   * sessions.coach_id becomes nullable with on delete set null. 0001
--     made it on delete cascade, so removing a member would silently
--     delete their sessions. Every other content table keeps a removed
--     member's rows as club owned through set null; sessions now
--     match, which the remove-user function in this phase relies on.
--     A session with a null coach matches no owner arm and is managed
--     through sessions.manage, like a backfilled programme.
--
-- Also closed here, because the capability model would otherwise be
-- bypassable: profiles_update_self carried with check (id = auth.uid())
-- only, which let any member update their own profile row to
-- role = 'admin'. The recreated policy pins role and club_id to their
-- current values, so self service edits (name, avatar, team, age
-- groups) still work and role changes require users.manage.
--
-- member_states() backs the invited or active state on the Users
-- screen. It is the one object here that is not part of the capability
-- model itself; strike it if unwanted and the screen degrades to
-- listing members without the state.
--
-- The whole file applies in one transaction, and every drop sits next
-- to the create that replaces it, so there is no window with a table
-- unpolicied. Statements are idempotent friendly (if exists, if not
-- exists, on conflict do nothing) for review replays; the file is not
-- meant to be reversed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The capabilities catalogue. One row per known capability; the UI
-- reads it to render the tick grid, so the catalogue and the grid share
-- one source. Clients never write it; it changes only by migration.
-- ---------------------------------------------------------------------
create table if not exists public.capabilities (
  key         text primary key,
  label       text not null,
  description text not null
);

-- ---------------------------------------------------------------------
-- The role to capability mapping the tick grid edits. role uses the
-- existing role_kind enum; capability references the catalogue so the
-- grid can never grant a capability no policy knows.
-- ---------------------------------------------------------------------
create table if not exists public.role_capabilities (
  role       role_kind not null,
  capability text not null references public.capabilities (key) on delete cascade,
  primary key (role, capability)
);

-- ---------------------------------------------------------------------
-- has_perm: the one function every rewritten policy calls. SECURITY
-- DEFINER for the same reason as my_role(): it reads tables without
-- re-triggering their RLS, which avoids recursion when the
-- role_capabilities policies themselves call it. The parameter is
-- referenced as has_perm.capability because a bare "capability" inside
-- the where clause would resolve to the column, comparing it with
-- itself and making the test vacuously true.
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
    from public.role_capabilities rc
    where rc.role::text = public.my_role()
      and rc.capability = has_perm.capability
  );
$$;

-- ---------------------------------------------------------------------
-- member_states: invited or active, per member of the caller's club,
-- for the Users screen. Readable only with users.manage; anyone else
-- gets an empty set. Exposes no emails and no timestamps, only the id
-- and the state. A member who has never signed in is an outstanding
-- invite. SECURITY DEFINER because auth.users is not client readable.
-- ---------------------------------------------------------------------
create or replace function public.member_states()
returns table (member_id uuid, state text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         case when u.last_sign_in_at is null then 'invited' else 'active' end
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.club_id = public.my_club()
    and public.has_perm('users.manage');
$$;

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables and functions, so the grants are explicit. RLS below remains
-- the real gate; these only make the objects reachable. has_perm is
-- granted to anon as well because policies evaluate it as the calling
-- role, and an anonymous write attempt must fail on the policy, not
-- error on execute.
-- ---------------------------------------------------------------------
grant select on public.capabilities to authenticated;
grant select, insert, update, delete on public.role_capabilities to authenticated;
grant execute on function public.has_perm(text) to anon, authenticated;
grant execute on function public.member_states() to authenticated;

-- ---------------------------------------------------------------------
-- RLS on the new tables. Club members read both; only users.manage
-- writes the mapping; nobody writes the catalogue through the API.
-- ---------------------------------------------------------------------
alter table public.capabilities enable row level security;

drop policy if exists "capabilities_select_members" on public.capabilities;
create policy "capabilities_select_members" on public.capabilities
  for select using ( public.my_club() is not null );
-- No insert, update or delete policies on capabilities: read only to
-- clients, seeded and changed only by migrations.

alter table public.role_capabilities enable row level security;

drop policy if exists "role_capabilities_select_members" on public.role_capabilities;
create policy "role_capabilities_select_members" on public.role_capabilities
  for select using ( public.my_club() is not null );

drop policy if exists "role_capabilities_insert_users_manage" on public.role_capabilities;
create policy "role_capabilities_insert_users_manage" on public.role_capabilities
  for insert with check ( public.has_perm('users.manage') );

drop policy if exists "role_capabilities_update_users_manage" on public.role_capabilities;
create policy "role_capabilities_update_users_manage" on public.role_capabilities
  for update using ( public.has_perm('users.manage') )
  with check ( public.has_perm('users.manage') );

drop policy if exists "role_capabilities_delete_users_manage" on public.role_capabilities;
create policy "role_capabilities_delete_users_manage" on public.role_capabilities
  for delete using ( public.has_perm('users.manage') );

-- ---------------------------------------------------------------------
-- Seed the catalogue. Keys are stable once seeded; labels and
-- descriptions are what the tick grid shows.
-- ---------------------------------------------------------------------
insert into public.capabilities (key, label, description) values
  ('drills.create',     'Create drills',         'Add drills to the club library and edit or delete the ones you created.'),
  ('drills.manage',     'Manage all drills',     'Edit or delete any drill in the club, whoever created it.'),
  ('media.create',      'Create media',          'Upload media and edit or delete the items you created.'),
  ('media.manage',      'Manage all media',      'Edit or delete any media item in the club.'),
  ('templates.create',  'Create templates',      'Save templates and edit or delete the ones you created.'),
  ('templates.manage',  'Manage all templates',  'Edit or delete any template in the club. This is template curation.'),
  ('programmes.create', 'Create programmes',     'Build programmes and edit or delete the ones you created.'),
  ('programmes.manage', 'Manage all programmes', 'Edit or delete any programme in the club, backfilled ones included.'),
  ('sessions.create',   'Create sessions',       'Plan sessions, and edit, delete or drive the ones you own.'),
  ('sessions.manage',   'Manage all sessions',   'Edit, delete or drive any session in the club.'),
  ('teams.manage',      'Manage teams',          'Add, rename and remove the club''s teams.'),
  ('users.manage',      'Manage users',          'Invite and remove members, change roles and edit this capability grid.'),
  ('club.manage',       'Manage club settings',  'Edit the club name, motto and crest.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Seed the mapping to reproduce today's effective access exactly. Each
-- row names the current policy arm it replaces.
--
-- admin: every capability.
-- ---------------------------------------------------------------------
insert into public.role_capabilities (role, capability) values
  ('admin', 'drills.create'),     -- drills_insert_club admitted coaching roles (0007)
  ('admin', 'drills.manage'),     -- admin arm of drills_update/delete_owner_or_admin (0001, 0009)
  ('admin', 'media.create'),      -- media_insert_club admitted coaching roles (0007)
  ('admin', 'media.manage'),      -- admin arm of media_update/delete_owner_or_admin (0001, 0009)
  ('admin', 'templates.create'),  -- templates_insert_club admitted coaching roles (0007)
  ('admin', 'templates.manage'),  -- templates_update_admin and templates_delete_admin (0001)
  ('admin', 'programmes.create'), -- programmes_insert_club admitted coaching roles (0011)
  ('admin', 'programmes.manage'), -- admin arm of programmes_update/delete_owner_or_admin (0011)
  ('admin', 'sessions.create'),   -- sessions_insert_own admitted coaching roles (0007)
  ('admin', 'sessions.manage'),   -- admin arm of sessions_update/delete_own_or_admin (0001, 0009)
  ('admin', 'teams.manage'),      -- teams_admin_manage (0002)
  ('admin', 'users.manage'),      -- profiles_admin_all (0001) and the invite-user admin check
  ('admin', 'club.manage')        -- clubs_update_admin (0001)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- coach: the five create capabilities and nothing else. A coach writes
-- club content and touches own rows only; granting any manage
-- capability here would let a coach edit anyone's rows or curate
-- templates, which today's policies reserve for admin.
-- ---------------------------------------------------------------------
insert into public.role_capabilities (role, capability) values
  ('coach', 'drills.create'),     -- drills_insert_club (0007) plus the owner arm of 0009
  ('coach', 'media.create'),      -- media_insert_club (0007) plus the owner arm of 0009
  ('coach', 'templates.create'),  -- templates_insert_club (0007); the owner arm starts empty because created_by starts null
  ('coach', 'programmes.create'), -- programmes_insert_club plus the owner arm (0011)
  ('coach', 'sessions.create')    -- sessions_insert_own (0007) plus the owner arm of 0009
on conflict do nothing;

-- parent: no rows. 0007 closed the inserts to parents and 0009 closed
-- the owner arms; a role holding no capability fails every write arm,
-- so a coach demoted to parent loses write on rows they created the
-- moment the role changes.

-- ---------------------------------------------------------------------
-- Schema accommodation one: templates ownership. Existing rows,
-- FA imports included, stay null and so stay manage only.
-- ---------------------------------------------------------------------
alter table public.templates
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- Schema accommodation two: sessions survive their owner. Removing a
-- member nulls coach_id instead of cascading the delete, matching
-- created_by on every other content table.
-- ---------------------------------------------------------------------
alter table public.sessions alter column coach_id drop not null;
alter table public.sessions drop constraint if exists sessions_coach_id_fkey;
alter table public.sessions
  add constraint sessions_coach_id_fkey
  foreign key (coach_id) references public.profiles (id) on delete set null;

-- =====================================================================
-- Policy rewrites. Select policies are untouched on every table: club
-- wide reads for members are by design and name no role. For writes,
-- with check now mirrors using on update, so an owner cannot reassign
-- a row's owner column while editing it; a manager still can. The app
-- never sends owner columns on update, so nothing user facing changes.
-- =====================================================================

-- drills: insert with drills.create; update and delete owner or manager.
drop policy if exists "drills_insert_club" on public.drills;
create policy "drills_insert_club" on public.drills
  for insert with check ( club_id = public.my_club() and public.has_perm('drills.create') );

drop policy if exists "drills_update_owner_or_admin" on public.drills;
drop policy if exists "drills_update_owner_or_manager" on public.drills;
create policy "drills_update_owner_or_manager" on public.drills
  for update using ( club_id = public.my_club()
    and (public.has_perm('drills.manage') or (created_by = auth.uid() and public.has_perm('drills.create'))) )
  with check ( club_id = public.my_club()
    and (public.has_perm('drills.manage') or (created_by = auth.uid() and public.has_perm('drills.create'))) );

drop policy if exists "drills_delete_owner_or_admin" on public.drills;
drop policy if exists "drills_delete_owner_or_manager" on public.drills;
create policy "drills_delete_owner_or_manager" on public.drills
  for delete using ( club_id = public.my_club()
    and (public.has_perm('drills.manage') or (created_by = auth.uid() and public.has_perm('drills.create'))) );

-- media: same pattern as drills.
drop policy if exists "media_insert_club" on public.media;
create policy "media_insert_club" on public.media
  for insert with check ( club_id = public.my_club() and public.has_perm('media.create') );

drop policy if exists "media_update_owner_or_admin" on public.media;
drop policy if exists "media_update_owner_or_manager" on public.media;
create policy "media_update_owner_or_manager" on public.media
  for update using ( club_id = public.my_club()
    and (public.has_perm('media.manage') or (created_by = auth.uid() and public.has_perm('media.create'))) )
  with check ( club_id = public.my_club()
    and (public.has_perm('media.manage') or (created_by = auth.uid() and public.has_perm('media.create'))) );

drop policy if exists "media_delete_owner_or_admin" on public.media;
drop policy if exists "media_delete_owner_or_manager" on public.media;
create policy "media_delete_owner_or_manager" on public.media
  for delete using ( club_id = public.my_club()
    and (public.has_perm('media.manage') or (created_by = auth.uid() and public.has_perm('media.create'))) );

-- templates: insert with templates.create; update and delete owner or
-- manager. Rows without an owner (everything created before this
-- migration, and FA imports until the import functions set created_by)
-- match only the manage arm, preserving admin only curation for them.
drop policy if exists "templates_insert_club" on public.templates;
create policy "templates_insert_club" on public.templates
  for insert with check ( club_id = public.my_club() and public.has_perm('templates.create') );

drop policy if exists "templates_update_admin" on public.templates;
drop policy if exists "templates_update_owner_or_manager" on public.templates;
create policy "templates_update_owner_or_manager" on public.templates
  for update using ( club_id = public.my_club()
    and (public.has_perm('templates.manage') or (created_by = auth.uid() and public.has_perm('templates.create'))) )
  with check ( club_id = public.my_club()
    and (public.has_perm('templates.manage') or (created_by = auth.uid() and public.has_perm('templates.create'))) );

drop policy if exists "templates_delete_admin" on public.templates;
drop policy if exists "templates_delete_owner_or_manager" on public.templates;
create policy "templates_delete_owner_or_manager" on public.templates
  for delete using ( club_id = public.my_club()
    and (public.has_perm('templates.manage') or (created_by = auth.uid() and public.has_perm('templates.create'))) );

-- sessions: insert still pins coach_id to the caller; update and delete
-- owner or manager. The update policy also governs who can drive a live
-- session, which stays owner or manager. The owner arm now names the
-- club explicitly, a no op since a session is created in its owner's
-- club. A session whose coach was removed (coach_id null) matches only
-- the manage arm.
drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check ( coach_id = auth.uid() and club_id = public.my_club() and public.has_perm('sessions.create') );

drop policy if exists "sessions_update_own_or_admin" on public.sessions;
drop policy if exists "sessions_update_owner_or_manager" on public.sessions;
create policy "sessions_update_owner_or_manager" on public.sessions
  for update using ( club_id = public.my_club()
    and (public.has_perm('sessions.manage') or (coach_id = auth.uid() and public.has_perm('sessions.create'))) )
  with check ( club_id = public.my_club()
    and (public.has_perm('sessions.manage') or (coach_id = auth.uid() and public.has_perm('sessions.create'))) );

drop policy if exists "sessions_delete_own_or_admin" on public.sessions;
drop policy if exists "sessions_delete_owner_or_manager" on public.sessions;
create policy "sessions_delete_owner_or_manager" on public.sessions
  for delete using ( club_id = public.my_club()
    and (public.has_perm('sessions.manage') or (coach_id = auth.uid() and public.has_perm('sessions.create'))) );

-- programmes: same pattern. Backfilled programmes have a null
-- created_by, so they match only the manage arm, keeping the admin
-- only intent recorded in 0011.
drop policy if exists "programmes_insert_club" on public.programmes;
create policy "programmes_insert_club" on public.programmes
  for insert with check ( club_id = public.my_club() and public.has_perm('programmes.create') );

drop policy if exists "programmes_update_owner_or_admin" on public.programmes;
drop policy if exists "programmes_update_owner_or_manager" on public.programmes;
create policy "programmes_update_owner_or_manager" on public.programmes
  for update using ( club_id = public.my_club()
    and (public.has_perm('programmes.manage') or (created_by = auth.uid() and public.has_perm('programmes.create'))) )
  with check ( club_id = public.my_club()
    and (public.has_perm('programmes.manage') or (created_by = auth.uid() and public.has_perm('programmes.create'))) );

drop policy if exists "programmes_delete_owner_or_admin" on public.programmes;
drop policy if exists "programmes_delete_owner_or_manager" on public.programmes;
create policy "programmes_delete_owner_or_manager" on public.programmes
  for delete using ( club_id = public.my_club()
    and (public.has_perm('programmes.manage') or (created_by = auth.uid() and public.has_perm('programmes.create'))) );

-- teams: administration requires teams.manage. Reads stay club wide
-- through the untouched teams_select_club.
drop policy if exists "teams_admin_manage" on public.teams;
drop policy if exists "teams_manage" on public.teams;
create policy "teams_manage" on public.teams
  for all using ( club_id = public.my_club() and public.has_perm('teams.manage') )
  with check ( club_id = public.my_club() and public.has_perm('teams.manage') );

-- clubs: settings require club.manage. Reads stay on clubs_select_own.
drop policy if exists "clubs_update_admin" on public.clubs;
drop policy if exists "clubs_update_manage" on public.clubs;
create policy "clubs_update_manage" on public.clubs
  for update using ( id = public.my_club() and public.has_perm('club.manage') )
  with check ( id = public.my_club() and public.has_perm('club.manage') );

-- profiles: user and role administration requires users.manage. Reads
-- stay on profiles_select_club.
drop policy if exists "profiles_admin_all" on public.profiles;
drop policy if exists "profiles_users_manage" on public.profiles;
create policy "profiles_users_manage" on public.profiles
  for all using ( club_id = public.my_club() and public.has_perm('users.manage') )
  with check ( club_id = public.my_club() and public.has_perm('users.manage') );

-- profiles self service, recreated with the escalation closed. The
-- with check pins role and club_id to their current values: my_role()
-- and my_club() are stable, so inside this update statement they read
-- the row as it stood before the write. Name, avatar, avatar_url, team
-- and age groups stay self service; changing role or club goes through
-- profiles_users_manage (the policies are permissive, so a holder of
-- users.manage editing their own row passes through that one).
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using ( id = auth.uid() )
  with check (
    id = auth.uid()
    and role::text = public.my_role()
    and club_id is not distinct from public.my_club()
  );
