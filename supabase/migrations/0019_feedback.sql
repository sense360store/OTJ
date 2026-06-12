-- =====================================================================
-- OTJ Training Hub, migration 0019_feedback: the club feedback log
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review in the main session, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge.
--
-- What this is. A log of feature requests, bug reports and general
-- feedback from club members, with a status that moves as items
-- progress. Feedback is CLUB VISIBLE BY DESIGN: every member reads the
-- whole log, so duplicates surface before they are filed and the status
-- of every item is transparent to the people who asked. There is no
-- private feedback; anything needing privacy goes to a person, not
-- this table.
--
-- Who writes what. Any club member files feedback, parents included:
-- feedback is about the app, not coaching content, so this is
-- deliberately the one insert open to the parent role. A creator edits
-- and deletes their own items (title, body and kind, never the
-- status); holders of club.manage move status and rewrite nothing
-- else. RLS grants rows, not columns, and a with check sees only the
-- new row, so the column rules are held by trigger: status moves need
-- club.manage, content edits need the creator, and a row's identity
-- columns never change.
--
-- updated_at carries no trigger, matching the rest of the schema
-- (nothing else has one); the application sets it on update.
--
-- Numbering: the ledger ends at 0018_spond_type, so this is 0019.
--
-- RLS form. Capability form, as everything since 0012. Reads are club
-- wide for every member and gated by no capability, the standing rule
-- for content tables. Status changes follow has_perm('club.manage'),
-- which already exists in the catalogue; this migration adds no
-- capability.
-- =====================================================================

-- ---------------------------------------------------------------------
-- feedback: one row per filed item. kind is what it is, status is where
-- it stands. The checks mirror the form's limits so a bypassed client
-- still cannot store junk. created_by cascades on delete, unlike the
-- set null on coaching content: a feedback item is a conversation with
-- its author, and one whose author left answers to nobody.
-- ---------------------------------------------------------------------
create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('feature', 'bug', 'general')),
  title      text not null check (char_length(title) between 3 and 120),
  body       text check (char_length(body) <= 2000),
  status     text not null default 'new'
    check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.feedback (club_id, created_at desc);

-- ---------------------------------------------------------------------
-- The column guard. The update policies below give a creator their own
-- row and club.manage holders any row, but a row policy cannot say
-- which columns, and only a trigger can compare old to new, so the
-- column rules are held here whatever writes the table:
--   * any status move, including filing an item as something other
--     than new, requires club.manage;
--   * title, body and kind change only by the creator, so a status
--     manager cannot silently rewrite someone else's words;
--   * club_id, created_by and created_at never change, so an item is
--     never reassigned to another club, author or moment.
-- A creator holding club.manage passes both lines on their own items.
-- ---------------------------------------------------------------------
create or replace function public.feedback_guard_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'new' and not public.has_perm('club.manage') then
      raise exception 'new feedback starts as new; setting a status requires club.manage';
    end if;
    return new;
  end if;
  if new.club_id <> old.club_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'feedback rows keep their club, author and filing time';
  end if;
  if new.status is distinct from old.status and not public.has_perm('club.manage') then
    raise exception 'changing feedback status requires club.manage';
  end if;
  if (new.title is distinct from old.title
      or new.body is distinct from old.body
      or new.kind is distinct from old.kind)
    and old.created_by <> auth.uid() then
    raise exception 'feedback content can be edited only by its creator';
  end if;
  return new;
end;
$$;

create trigger feedback_guard_columns
  before insert or update on public.feedback
  for each row execute function public.feedback_guard_columns();

-- ---------------------------------------------------------------------
-- Grants. Hosted Supabase no longer auto grants Data API access to new
-- tables, so they are explicit (the 0012 lesson). RLS below is the real
-- gate; this only makes the table reachable.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.feedback to authenticated;

-- ---------------------------------------------------------------------
-- Row-Level Security. Reads are club wide so the log does its job (see
-- the header). Inserting pins the row to the caller's club and to
-- themselves, with no capability gate: every member may file. Update is
-- two permissive arms, creator and club.manage, with the trigger above
-- holding the column rules between them. Delete belongs to the creator
-- alone: the manager path for an unwanted item is the declined status,
-- in the open, not removal.
-- ---------------------------------------------------------------------
alter table public.feedback enable row level security;

create policy "feedback_select_club" on public.feedback
  for select using ( club_id = public.my_club() );

create policy "feedback_insert_own" on public.feedback
  for insert with check ( club_id = public.my_club() and created_by = auth.uid() );

-- with check mirrors using, so a creator cannot reassign the row's club
-- or author while editing it (the standing update form since 0012).
create policy "feedback_update_own" on public.feedback
  for update using ( club_id = public.my_club() and created_by = auth.uid() )
  with check ( club_id = public.my_club() and created_by = auth.uid() );

create policy "feedback_update_manage" on public.feedback
  for update using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

create policy "feedback_delete_own" on public.feedback
  for delete using ( club_id = public.my_club() and created_by = auth.uid() );
