-- =====================================================================
-- OTJ Training Hub, migration 0020_boards: saved tactics boards
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge. No Edge Function changes accompany this.
--
-- What this is. The tactics board (phase one, the /board page) places
-- numbered discs on a pitch and drags them into shape, in component state
-- only, cleared on reload. This phase persists a board so a coach can save
-- it and load it back later. One row is one saved board.
--
-- Numbering: the ledger ends at 0019_feedback, so this is 0020.
--
-- THE TOKENS JSONB. tokens is the array of token objects exactly as the
-- board holds them in state: number (the shirt number), label (a short free
-- text), side (the home or away colour), and x and y. x and y are PITCH
-- FRACTIONS, each 0 to 1 across the width and along the length, so a board
-- renders identically at any size and survives a resize. The array carries
-- NO PERSON DATA: only numbers and the free text labels a coach typed. There
-- is no roster behind it and no name from any roster reaches this column.
-- This comment is part of that boundary; it survives in the schema so the
-- rule is visible to anyone changing it.
--
-- RLS form. This lands after RBAC (0012), so the policies are written in the
-- capability form, has_perm(...). The role form translation, kept the way
-- 0011 and 0013 documented both directions in case ordering ever changes:
--   * has_perm('sessions.create') == my_role() in ('coach','admin')
--                                    (the coaching write capability, the same
--                                     one that gates the planner and the board
--                                     page itself)
--   * has_perm('club.manage')     == my_role() = 'admin'
--                                    (club administration, the tidy-up arm)
-- Reads are club wide for every member and gated by no capability, the
-- standing rule for content tables. Both capabilities already exist in the
-- 0012 catalogue; this migration adds none.
--
-- updated_at. The schema carries no generic updated_at trigger (0019 noted
-- the same), so the column defaults to now() on insert and the save and
-- rename hooks set it explicitly on update, in application code.
-- =====================================================================

-- ---------------------------------------------------------------------
-- boards: one saved tactics board. club_id scopes it for the club wide
-- read; created_by drives the owner arm of update and delete and cascades
-- if the creator is removed, so a removed coach's boards go with them
-- rather than lingering ownerless. team_id is the team the board frames, a
-- filter and a default only, never access control (CLAUDE.md, teams are a
-- filter); it sets null if the team is later deleted, leaving the board.
-- name is required and bounded. formation is the picker key the board was
-- last seeded from, nullable because a board may be hand placed. See the
-- header for the tokens jsonb shape and its person-data boundary.
-- ---------------------------------------------------------------------
create table public.boards (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete set null,
  name       text not null check (char_length(name) between 1 and 80),
  formation  text,
  tokens     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.boards (club_id, updated_at desc);

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so they are explicit (the 0012 lesson). RLS below is the real
-- gate; these only make the table reachable.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.boards to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security. Club members read every board (select is club wide,
-- the standing content rule). A club member holding sessions.create inserts
-- their own boards. Update and delete follow ownership: the board's creator,
-- or a club.manage holder so an admin can tidy. The insert gate on
-- sessions.create is what keeps a parent (who holds neither capability) from
-- ever creating a board; the owner arm of update and delete is by creator as
-- specified, the admin arm is club.manage.
-- ---------------------------------------------------------------------
alter table public.boards enable row level security;

create policy "boards_select_club" on public.boards
  for select using ( club_id = public.my_club() );

create policy "boards_insert_own" on public.boards
  for insert with check (
    club_id = public.my_club()
    and created_by = auth.uid()
    and public.has_perm('sessions.create')
  );

create policy "boards_update_owner_or_admin" on public.boards
  for update using (
    club_id = public.my_club()
    and (created_by = auth.uid() or public.has_perm('club.manage'))
  )
  with check (
    club_id = public.my_club()
    and (created_by = auth.uid() or public.has_perm('club.manage'))
  );

create policy "boards_delete_owner_or_admin" on public.boards
  for delete using (
    club_id = public.my_club()
    and (created_by = auth.uid() or public.has_perm('club.manage'))
  );
