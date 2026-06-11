-- =====================================================================
-- OTJ Training Hub, migration 0013_spond: Spond attendance, counts only
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge.
--
-- What this is. Spond is where the club arranges sessions and parents
-- respond. This integration pulls attendance from Spond so the planner
-- knows who is coming. It is read only: Spond stays the place sessions
-- are arranged and parents respond, the Hub mirrors a synced copy. The
-- sync runs in the spond-sync Edge Function (PR A2); this migration is
-- only the tables it writes and the link a session carries.
--
-- THE CHILDREN'S DATA BOUNDARY, the rule that shapes these tables.
-- Spond event responses identify children and parents by name. Phases A
-- to C store AGGREGATE COUNTS ONLY: accepted, declined, unanswered,
-- waiting. The sync function counts the response arrays in memory and
-- discards every name and member id before it writes. So:
--   * spond_events has no member columns and no raw payload column. It
--     holds four integer counts and nothing that identifies a person.
--   * spond_name on spond_groups is a team display label such as
--     "U8 Tigers", never a person's name.
-- Per person attendance is Phase D and is gated behind the production
-- readiness phase and the players data model phase, where GDPR and
-- safeguarding get deliberate design. No name or member id reaches any
-- column here, even incidentally. This comment is part of the boundary:
-- it survives in the schema so the rule is visible to anyone changing it.
--
-- Numbering: the ledger ends at 0012_rbac, so this is 0013.
--
-- RLS form. This lands after RBAC (0012), so the policies are written in
-- the capability form, has_perm(...). The role form translation, kept
-- the way 0011 documented both directions in case ordering ever changes:
--   * has_perm('club.manage')     == my_role() = 'admin'
--                                    (the mapping is club administration)
--   * has_perm('sessions.create') == my_role() in ('coach','admin')
--                                    (any coach may sync)
-- Reads are club wide for every member and gated by no capability, the
-- standing rule for content tables. Both capabilities already exist in
-- the 0012 catalogue; this migration adds none.
-- =====================================================================

-- ---------------------------------------------------------------------
-- spond_groups: the mapping an admin edits once, from a Spond group or
-- subgroup to a Hub team. The sync processes only groups present here,
-- so this table is also the allow list. spond_name is a team display
-- label (never a person). A null spond_subgroup_id maps the whole group;
-- a set one maps a single subgroup. The unique constraint treats nulls
-- as not distinct (PG15+), so the database itself blocks a second whole
-- group row for the same group, not only the mapping editor. team_id cascades
-- on delete: a mapping to a removed team has no meaning and goes with it.
-- ---------------------------------------------------------------------
create table public.spond_groups (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references public.clubs (id) on delete cascade,
  spond_group_id    text not null,
  spond_subgroup_id text,
  spond_name        text not null,
  team_id           uuid not null references public.teams (id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique nulls not distinct (club_id, spond_group_id, spond_subgroup_id)
);

-- ---------------------------------------------------------------------
-- spond_events: synced events, AGGREGATE COUNTS ONLY. No member columns,
-- no raw payload column, nothing that identifies a person. team_id is
-- resolved through spond_groups at sync time and nulls if the team is
-- later deleted, leaving the event in place. A session links to a row
-- here; that link is set null on delete (see sessions below), never
-- cascaded, so removing an event detaches a session, never deletes it.
-- cancelled marks an event Spond cancelled or dropped, kept rather than
-- deleted because a session may still point at it.
-- ---------------------------------------------------------------------
create table public.spond_events (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs (id) on delete cascade,
  spond_event_id   text not null,
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  location         text,
  team_id          uuid references public.teams (id) on delete set null,
  accepted_count   int not null default 0,
  declined_count   int not null default 0,
  unanswered_count int not null default 0,
  waiting_count    int not null default 0,
  cancelled        boolean not null default false,
  synced_at        timestamptz not null,
  unique (club_id, spond_event_id)
);
create index on public.spond_events (club_id, starts_at);

-- ---------------------------------------------------------------------
-- The link a session carries. Nullable: most sessions have none. On
-- delete set null so removing a synced event detaches the session and
-- never deletes it. The column rides the existing sessions policies
-- unchanged; this migration adds no sessions policy.
-- ---------------------------------------------------------------------
alter table public.sessions
  add column spond_event_id uuid references public.spond_events (id) on delete set null;
create index on public.sessions (spond_event_id);

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so they are explicit (the 0012 lesson). RLS below is the real
-- gate; these only make the tables reachable. Both are writable through
-- the API (the mapping editor writes spond_groups; the sync writes
-- spond_events as the calling coach), so both get the full set.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.spond_groups to authenticated;
grant select, insert, update, delete on public.spond_events to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security. Club members read both tables. Writing the mapping
-- is club administration (club.manage); writing events is any coach who
-- can sync (sessions.create). The select policy and the manage policy
-- are both permissive, so a member without the capability still reads
-- through the select policy while writes stay gated by the manage one.
-- ---------------------------------------------------------------------
alter table public.spond_groups enable row level security;

create policy "spond_groups_select_club" on public.spond_groups
  for select using ( club_id = public.my_club() );

-- Mapping is admin only club administration. for all so insert, update
-- and delete share the one condition.
create policy "spond_groups_manage" on public.spond_groups
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

alter table public.spond_events enable row level security;

create policy "spond_events_select_club" on public.spond_events
  for select using ( club_id = public.my_club() );

-- Any coach may sync. for all so the upsert (insert plus update) shares
-- the one condition. The function never deletes rows a session may link
-- to; the policy still names delete so an admin can prune if needed, and
-- the set null on the sessions link keeps that safe.
create policy "spond_events_manage" on public.spond_events
  for all using ( club_id = public.my_club() and public.has_perm('sessions.create') )
  with check ( club_id = public.my_club() and public.has_perm('sessions.create') );
