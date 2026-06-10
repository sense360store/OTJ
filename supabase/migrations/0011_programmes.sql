-- =====================================================================
-- OTJ Training Hub - programmes as a first-class entity
-- Migration 0011_programmes
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- A programme is an ordered set of weekly sessions, the FA six-week
-- format being the model. Until now programme support was labels only:
-- templates carry programme text and a week number, and the Templates
-- screen groups by them. This migration adds the programmes table,
-- entity links on templates and sessions, and a backfill that turns the
-- existing labels into rows. The legacy templates.programme and
-- templates.week columns stay for one phase as the backfill source and
-- are not written by new code.
--
-- Numbering: 0008 (avatars) and 0009 (parent owner writes) are on
-- main; 0010 stays reserved for Phase 8's RBAC, so this phase starts
-- at 0011 as the phase plan set out.
--
-- RLS: club members read programmes. Writes ride the templates
-- capabilities, no new capabilities: insert mirrors the templates
-- create condition, and update or delete is owner or the templates
-- managing role, with the owner arm closed to demoted parents the way
-- 0009 closed it elsewhere. Phase 8's RBAC (has_perm) is not live in
-- this schema, so the conditions are expressed with the coaching-roles
-- form spelled out, admin being the templates manager. If 0010_rbac is
-- applied before this file, swap the four conditions to the has_perm
-- form first (insert via has_perm('templates.create'); update and
-- delete as owner holding it, or has_perm('templates.manage')); if
-- this file is applied first, Phase 8's policy translation pass covers
-- programmes with every other table.
-- =====================================================================

-- The programme entity. weeks is the planned length (the FA model is
-- six). pdf_media_id attaches the offline copy through the media
-- library, so the stored file rides the existing storage policies and
-- signed URL path. Deleting the media row detaches the PDF; deleting a
-- programme never deletes media.
create table public.programmes (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs (id) on delete cascade,
  name         text not null,
  focus        text,
  summary      text,
  intentions   text[] not null default '{}',
  weeks        int not null default 6,
  pdf_media_id uuid references public.media (id) on delete set null,
  source_url   text,
  source_label text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (club_id, name)
);
create index on public.programmes (club_id);

-- Entity links on templates. programme_week is the entity-backed week.
-- Removing a programme nulls the references and the templates survive.
alter table public.templates add column programme_id uuid references public.programmes (id) on delete set null;
alter table public.templates add column programme_week int;
create index on public.templates (programme_id);

-- Entity links on sessions, so a scheduled session traces back to its
-- programme and week once a programme is applied to a team. Removing a
-- programme nulls the references and the sessions survive.
alter table public.sessions add column programme_id uuid references public.programmes (id) on delete set null;
alter table public.sessions add column programme_week int;
create index on public.sessions (programme_id);

-- Backfill: one programme row per club per distinct legacy label, with
-- the source fields copied from that programme's earliest template.
-- Then the labelled templates point at the new rows and carry their
-- legacy week across into programme_week.
insert into public.programmes (club_id, name, source_url, source_label)
select distinct on (t.club_id, t.programme)
       t.club_id, t.programme, t.source_url, t.source_label
from public.templates t
where t.programme is not null and t.programme <> ''
order by t.club_id, t.programme, t.created_at, t.id
on conflict (club_id, name) do nothing;

update public.templates t
set programme_id   = p.id,
    programme_week = t.week
from public.programmes p
where t.programme is not null and t.programme <> ''
  and p.club_id = t.club_id
  and p.name = t.programme
  and t.programme_id is null;

-- Row-Level Security ---------------------------------------------------
alter table public.programmes enable row level security;

-- Whole club reads, like every other content table.
create policy "programmes_select_club" on public.programmes
  for select using ( club_id = public.my_club() );

-- Creating mirrors the templates create condition (coaching roles).
create policy "programmes_insert_club" on public.programmes
  for insert with check ( club_id = public.my_club() and public.my_role() in ('coach','admin') );

-- Editing and deleting is owner, or the templates managing role (admin),
-- with the writing roles spelled out on the owner arm so a coach demoted
-- to parent loses write on programmes they created, matching 0009.
-- Backfilled rows have no owner, so only an admin curates them.
create policy "programmes_update_owner_or_admin" on public.programmes
  for update using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
create policy "programmes_delete_owner_or_admin" on public.programmes
  for delete using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') );
