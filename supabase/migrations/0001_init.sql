-- =====================================================================
-- OTJ Training Hub - initial schema, enums, helpers and Row-Level Security
-- Migration 0001_init
--
-- REVIEW REQUIRED. This file is the security boundary for the whole app.
-- The policies below decide what every logged-in user can read and write.
-- Do not merge changes to this file without a human review.
--
-- v1 assumptions:
--   * Single club (Ossett Town Juniors), but every table carries club_id so
--     multiple clubs are possible later without a rewrite.
--   * Roles: coach (default), admin, parent. parent is read-only and is not
--     wired into policies yet (Phase 5).
--   * Sign-up is invite-only. A profile row is created for each auth user by
--     the handle_new_user trigger; club_id and role come from invite metadata
--     or are set by an admin afterwards.
--   * The my_club() and my_role() helpers are SECURITY DEFINER on purpose:
--     they read the profiles table without re-triggering profiles RLS, which
--     avoids infinite recursion in the policies that call them.
-- =====================================================================

-- Extensions ----------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid()

-- Enums ---------------------------------------------------------------
create type corner_kind   as enum ('technical','physical','social','psychological');
create type level_kind    as enum ('Foundation','Developing','Advanced');
create type media_kind    as enum ('video','youtube','image','pdf');
create type role_kind     as enum ('coach','admin','parent');
create type session_state as enum ('upcoming','completed');

-- Tables --------------------------------------------------------------

-- clubs: the tenant
create table public.clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  crest_url  text,
  motto      text,
  created_at timestamptz not null default now()
);

-- profiles: one row per auth user, sharing the auth user id
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  club_id    uuid references public.clubs (id) on delete set null,
  full_name  text,
  avatar     text,                       -- initials for the coach chip, or a URL later
  role       role_kind not null default 'coach',
  age_groups text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- media: registered files and YouTube links (files live in Supabase Storage)
create table public.media (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  name         text not null,
  type         media_kind not null,
  kind         text,                     -- display tag, e.g. pitch, diagram, pdf
  storage_path text,                     -- key in Storage (null for youtube)
  yt_url       text,                     -- set for youtube items
  size         text,
  dims         text,
  length       text,
  pages        int,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- drills: the shared club library
create table public.drills (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  title      text not null,
  summary    text,
  corner     corner_kind,
  skill      text,
  level      level_kind,
  ages       text[] not null default '{}',
  duration   int,
  players    text,
  area       text,
  equipment  text[] not null default '{}',
  points     text[] not null default '{}',
  tags       text[] not null default '{}',
  media_id   uuid references public.media (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- templates: reusable session blueprints, shared across the club
create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  name       text not null,
  focus      text,
  author     text,                       -- display name for now; could become author_id later
  activities jsonb not null default '[]'::jsonb,   -- [{ phase, drill_id, duration }]
  created_at timestamptz not null default now()
);

-- sessions: a coach's planned sessions
create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  coach_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  focus      text,
  date       date,
  start_time text,                        -- "17:30", mirrors the planner field
  venue      text,
  age_group  text,
  status     session_state not null default 'upcoming',
  activities jsonb not null default '[]'::jsonb,   -- [{ phase, drill_id, duration }]
  created_at timestamptz not null default now()
);

-- Indexes -------------------------------------------------------------
create index on public.drills (club_id);
create index on public.drills (media_id);
create index on public.media (club_id);
create index on public.templates (club_id);
create index on public.sessions (club_id);
create index on public.sessions (coach_id);

-- Helper functions ----------------------------------------------------
-- SECURITY DEFINER so they read profiles without triggering profiles RLS.
-- They only ever return the calling user's own club and role.

create or replace function public.my_club()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select club_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

-- Create a profile automatically when a new auth user is created.
-- club_id and role come from invite metadata when present.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, club_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    nullif(new.raw_user_meta_data ->> 'club_id', '')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::role_kind, 'coach')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-Level Security --------------------------------------------------
alter table public.clubs     enable row level security;
alter table public.profiles  enable row level security;
alter table public.media     enable row level security;
alter table public.drills    enable row level security;
alter table public.templates enable row level security;
alter table public.sessions  enable row level security;

-- clubs: members read their own club; admins update it
create policy "clubs_select_own" on public.clubs
  for select using ( id = public.my_club() );
create policy "clubs_update_admin" on public.clubs
  for update using ( id = public.my_club() and public.my_role() = 'admin' )
  with check ( id = public.my_club() and public.my_role() = 'admin' );

-- profiles: members see club members; you edit yourself; admins manage anyone in club
create policy "profiles_select_club" on public.profiles
  for select using ( club_id = public.my_club() );
create policy "profiles_update_self" on public.profiles
  for update using ( id = auth.uid() )
  with check ( id = auth.uid() );
create policy "profiles_admin_all" on public.profiles
  for all using ( club_id = public.my_club() and public.my_role() = 'admin' )
  with check ( club_id = public.my_club() and public.my_role() = 'admin' );

-- drills: whole club reads; any member adds; owner or admin edits and deletes
create policy "drills_select_club" on public.drills
  for select using ( club_id = public.my_club() );
create policy "drills_insert_club" on public.drills
  for insert with check ( club_id = public.my_club() );
create policy "drills_update_owner_or_admin" on public.drills
  for update using ( club_id = public.my_club() and (created_by = auth.uid() or public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
create policy "drills_delete_owner_or_admin" on public.drills
  for delete using ( club_id = public.my_club() and (created_by = auth.uid() or public.my_role() = 'admin') );

-- media: same pattern as drills
create policy "media_select_club" on public.media
  for select using ( club_id = public.my_club() );
create policy "media_insert_club" on public.media
  for insert with check ( club_id = public.my_club() );
create policy "media_update_owner_or_admin" on public.media
  for update using ( club_id = public.my_club() and (created_by = auth.uid() or public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
create policy "media_delete_owner_or_admin" on public.media
  for delete using ( club_id = public.my_club() and (created_by = auth.uid() or public.my_role() = 'admin') );

-- templates: whole club reads; any member adds; admins curate
create policy "templates_select_club" on public.templates
  for select using ( club_id = public.my_club() );
create policy "templates_insert_club" on public.templates
  for insert with check ( club_id = public.my_club() );
create policy "templates_update_admin" on public.templates
  for update using ( club_id = public.my_club() and public.my_role() = 'admin' )
  with check ( club_id = public.my_club() and public.my_role() = 'admin' );
create policy "templates_delete_admin" on public.templates
  for delete using ( club_id = public.my_club() and public.my_role() = 'admin' );

-- sessions: a coach owns their own; admins see and manage all in the club
create policy "sessions_select_own_or_admin" on public.sessions
  for select using ( coach_id = auth.uid() or (club_id = public.my_club() and public.my_role() = 'admin') );
create policy "sessions_insert_own" on public.sessions
  for insert with check ( coach_id = auth.uid() and club_id = public.my_club() );
create policy "sessions_update_own_or_admin" on public.sessions
  for update using ( coach_id = auth.uid() or (club_id = public.my_club() and public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
create policy "sessions_delete_own_or_admin" on public.sessions
  for delete using ( coach_id = auth.uid() or (club_id = public.my_club() and public.my_role() = 'admin') );

-- Storage: a private media bucket served via signed URLs ---------------
-- v1 grants read and write to any authenticated user. A later refinement
-- scopes objects to the club via a path prefix (club_id/...). Flagged for review.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy "media_bucket_read_authed" on storage.objects
  for select using ( bucket_id = 'media' and auth.uid() is not null );
create policy "media_bucket_write_authed" on storage.objects
  for insert with check ( bucket_id = 'media' and auth.uid() is not null );
create policy "media_bucket_delete_authed" on storage.objects
  for delete using ( bucket_id = 'media' and auth.uid() is not null );
