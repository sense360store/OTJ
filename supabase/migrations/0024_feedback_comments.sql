-- =====================================================================
-- OTJ Training Hub, migration 0024_feedback_comments: replies on the
-- feedback log
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review in the main session, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge.
--
-- What this is. A thread of comments under each feedback item. The log
-- was one directional: a member files, an admin sets status, but nobody
-- could reply, so a coach never learned why an item was declined and a
-- manager could not ask a clarifying question. Comments turn the log
-- into the conversation it was meant to be.
--
-- Comments are CLUB VISIBLE BY DESIGN, the same transparency as the
-- feedback log itself: the whole club reads a thread just as it reads
-- the item. There is no private reply; anything needing privacy goes to
-- a person, not this table.
--
-- Who writes what. Any club member files a comment, parents included,
-- with no capability gate: filing a comment is as open as filing
-- feedback. A member edits and deletes only their own comment; holders
-- of club.manage may also delete any comment for moderation, mirroring
-- how feedback itself lets club.manage manage rows.
--
-- The club_id is carried on the comment rather than only inferred
-- through its feedback row, so the RLS scopes by club_id = my_club()
-- directly, the same form as every other table since 0012. The
-- feedback_id cascades on delete, so removing a feedback item removes
-- its whole thread.
--
-- updated_at carries a trigger here, unlike feedback which set it in
-- application code; both forms appear in the codebase and the brief
-- allows either. The trigger keeps an inline body edit honest whatever
-- writes the table.
--
-- Numbering: the live ledger ends at players_fullname, so this is 0024.
--
-- RLS form. Capability form, as everything since 0012. Reads are club
-- wide for every member and gated by no capability, the standing rule
-- for content tables. Moderation delete follows has_perm('club.manage'),
-- which already exists in the catalogue; this migration adds no
-- capability.
-- =====================================================================

-- ---------------------------------------------------------------------
-- feedback_comments: one row per reply on a feedback item. body checks
-- mirror the form's limits so a bypassed client still cannot store junk.
-- created_by cascades on delete, like feedback's own author link: a
-- comment is part of a conversation and one whose author left answers to
-- nobody.
-- ---------------------------------------------------------------------
create table public.feedback_comments (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.feedback_comments (feedback_id, created_at);

-- ---------------------------------------------------------------------
-- updated_at trigger. Keeps the column honest on any body edit whatever
-- writes the table, since the update policy below restricts who but not
-- what.
-- ---------------------------------------------------------------------
create or replace function public.feedback_comments_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger feedback_comments_touch_updated_at
  before update on public.feedback_comments
  for each row execute function public.feedback_comments_touch_updated_at();

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so they are explicit (the 0012 lesson). RLS below is the real
-- gate; this only makes the table reachable.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.feedback_comments to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security. Reads are club wide so a thread is as visible as
-- its item. Inserting pins the row to the caller's club and to
-- themselves, with no capability gate: every member may reply. Update
-- belongs to the author alone (body only in practice; the form sends
-- nothing else). Delete is two permissive arms, the author and
-- club.manage, the latter so an admin can moderate any comment.
-- ---------------------------------------------------------------------
alter table public.feedback_comments enable row level security;

create policy "feedback_comments_select_club" on public.feedback_comments
  for select using ( club_id = public.my_club() );

create policy "feedback_comments_insert_own" on public.feedback_comments
  for insert with check ( club_id = public.my_club() and created_by = auth.uid() );

-- with check mirrors using, so an author cannot reassign the row's club
-- or author while editing it (the standing update form since 0012).
create policy "feedback_comments_update_own" on public.feedback_comments
  for update using ( club_id = public.my_club() and created_by = auth.uid() )
  with check ( club_id = public.my_club() and created_by = auth.uid() );

create policy "feedback_comments_delete_own" on public.feedback_comments
  for delete using ( club_id = public.my_club() and created_by = auth.uid() );

create policy "feedback_comments_delete_manage" on public.feedback_comments
  for delete using ( club_id = public.my_club() and public.has_perm('club.manage') );
