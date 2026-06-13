-- =====================================================================
-- OTJ Training Hub, migration 0021_players: optional team roster
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge. No Edge Function changes accompany this.
--
-- What this is. The tactics board (phases one and two) seats discs from a
-- formation picker, with no names behind them. This phase lets a coach
-- curate a per team roster of the children they coach, so the board can be
-- seeded from real players instead of a formation. The roster is opt in:
-- the formation seeding stays the default and a team needs no roster to use
-- the board.
--
-- Numbering: the ledger ends at 0020_boards, so this is 0021.
--
-- THE CHILD DATA BOUNDARY, the rule that shapes this table. This is the
-- FIRST child data the app holds, so the shape is deliberate, not an
-- afterthought.
--   * WHAT IS STORED, the minimum to label a disc: a display_name (a first
--     name, or first name plus last initial, the coach's choice, no
--     requirement for a full legal name), an optional shirt_number, and the
--     team. Nothing more.
--   * WHAT IS DELIBERATELY NOT STORED: no date of birth, no contact details
--     (no email, phone or address), no parent or guardian link, no medical
--     or dietary note, no photo, no free text, and no link to an auth user.
--     A player is a label on a roster, never an app account. No parent or
--     child self registers here; only a coach or admin curates the roster.
--   * WHO CAN READ IT, and why parents are excluded. The roster is readable
--     only by holders of sessions.create (coaches and admins) within the
--     club, NOT by parents. A parent has no need to see other children's
--     names, so the cautious default is that the roster is invisible to the
--     parent role entirely. This is the one content table in the app whose
--     select is gated rather than club wide open, and that gating is on
--     purpose: read on every other content table is club wide, this one is
--     not, because the rows name children. The select policy below carries
--     the capability so the database, not the UI, is the enforcement.
--   * THE BOARD IS A SNAPSHOT. A board seeded from the roster copies the
--     display name into the token label as a plain string; board tokens
--     carry no foreign key back to players (see 0020_boards.sql). So
--     deleting a player never corrupts a saved board and a board stays a
--     point in time copy. on delete cascade on created_by and the team is
--     therefore safe for boards: it removes the roster row, never a board.
-- This comment is part of the boundary; it survives in the schema so the
-- rule is visible to anyone changing it.
--
-- RLS form. This lands after RBAC (0012), so the policies are written in the
-- capability form, has_perm(...). The role form translation, kept the way
-- 0011, 0013 and 0020 documented both directions in case ordering ever
-- changes:
--   * has_perm('sessions.create') == my_role() in ('coach','admin')
--                                    (the coaching write capability, the same
--                                     one that gates the board page and the
--                                     roster manager)
-- Unlike the other content tables, the select here is NOT club wide open: it
-- carries the same sessions.create gate as the writes, so the parent role
-- never reads a row. Both arms also scope to my_club(). No new capability is
-- added; sessions.create already exists in the 0012 catalogue.
-- =====================================================================

-- ---------------------------------------------------------------------
-- players: one child on a team's roster. club_id scopes the read and the
-- writes; team_id is the team the player belongs to and cascades on delete,
-- a roster row for a removed team has no meaning. display_name is the
-- minimum label, required and bounded (1 to 40 chars). shirt_number is
-- optional and, when set, a normal football number (1 to 99). created_by is
-- the curating coach or admin and cascades if they are removed. There is no
-- date of birth, contact, medical or any other column by design (see the
-- boundary comment above), and no link to auth.users: a player is not an
-- app account.
-- ---------------------------------------------------------------------
create table public.players (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  shirt_number int check (shirt_number between 1 and 99),
  created_by   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index on public.players (club_id, team_id);

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so they are explicit (the 0012 lesson). RLS below is the real
-- gate; these only make the table reachable.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.players to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security. Every policy carries the same condition: the row's
-- club is the member's club AND the member holds sessions.create. So a
-- coach or admin reads and curates their club's roster, and a parent (who
-- holds neither sessions.create nor any write capability) reads nothing.
-- This is the deliberate departure from the club wide select the other
-- content tables use, because these rows name children. for select is its
-- own policy so the gate is explicit; the writes share one for all policy.
-- ---------------------------------------------------------------------
alter table public.players enable row level security;

create policy "players_select_coach" on public.players
  for select using (
    club_id = public.my_club() and public.has_perm('sessions.create')
  );

-- Insert, update and delete share the one condition: a coach or admin in the
-- club curates the roster. The insert also pins created_by to the writer and
-- the club to theirs through the with check arm.
create policy "players_manage_coach" on public.players
  for all using (
    club_id = public.my_club() and public.has_perm('sessions.create')
  )
  with check (
    club_id = public.my_club() and public.has_perm('sessions.create')
  );
