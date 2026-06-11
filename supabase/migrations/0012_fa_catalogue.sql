-- =====================================================================
-- OTJ Training Hub - the England Football catalogue index
-- Migration 0012_fa_catalogue
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- A browsable index of the England Football Learning sessions listing,
-- so a coach can see what is available under the FA's own taxonomy and
-- import per selection through the smart importer. Each row holds
-- facts and links only: title, summary, taxonomy labels, the listing
-- thumbnail's URL (hot-linked, never stored) and the resource URL. No
-- asset is downloaded or re-hosted at sync time; full assets are
-- stored only when a coach imports that specific resource, unmodified
-- and attributed, exactly as before. Syncing is always user initiated.
-- See CLAUDE.md, Third-party content.
--
-- imported_ref points at the programme or template a resource became
-- once imported. It is polymorphic by imported_kind ('programme' or
-- 'session'), so it carries no foreign key; the fa-catalogue sync
-- reconciles it against the club's programmes and templates by source
-- URL, and a deleted import simply unmarks on the next sync.
--
-- RLS: club members read, like every other content table. Writes
-- require the coaching roles, expressed with the my_role() form the
-- other tables use, since Phase 8's RBAC is not live in this schema.
-- =====================================================================

create table public.fa_catalogue (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs (id) on delete cascade,
  url           text not null,
  title         text,
  summary       text,
  theme         text,
  skills        text[] not null default '{}',
  format        text,
  age_band      text,
  kind          text,
  thumbnail_url text,
  imported_ref  uuid,
  imported_kind text,
  synced_at     timestamptz,
  unique (club_id, url)
);
create index on public.fa_catalogue (club_id);

-- Row-Level Security ---------------------------------------------------
alter table public.fa_catalogue enable row level security;

-- Whole club reads, like every other content table.
create policy "fa_catalogue_select_club" on public.fa_catalogue
  for select using ( club_id = public.my_club() );

-- Syncing and marking imports is for the coaching roles. The rows are a
-- shared club index with no per-row owner, so all three write policies
-- carry the same condition.
create policy "fa_catalogue_insert_coaching" on public.fa_catalogue
  for insert with check ( club_id = public.my_club() and public.my_role() in ('coach','admin') );
create policy "fa_catalogue_update_coaching" on public.fa_catalogue
  for update using ( club_id = public.my_club() and public.my_role() in ('coach','admin') )
  with check ( club_id = public.my_club() );
create policy "fa_catalogue_delete_coaching" on public.fa_catalogue
  for delete using ( club_id = public.my_club() and public.my_role() in ('coach','admin') );
