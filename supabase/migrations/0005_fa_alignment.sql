-- =====================================================================
-- OTJ Training Hub - FA session model alignment
-- Migration 0005_fa_alignment
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- Purely additive columns so drills, sessions, templates and media can
-- carry the England Football Learning session model: STEP adaptations
-- (make it easier, make it harder), setup notes, theme and format,
-- session intentions and space, template programme grouping, and source
-- attribution that travels with imported content. No policy changes, no
-- changes to existing columns. theme, format and skill stay text, not
-- enums; the FA option lists live in src/lib/fa.ts as suggestions.
-- =====================================================================

-- drills: setup notes, STEP adaptations, FA theme and format, source
alter table public.drills add column setup_notes  text;
alter table public.drills add column easier       text[] not null default '{}';
alter table public.drills add column harder       text[] not null default '{}';
alter table public.drills add column theme        text;
alter table public.drills add column format       text;
alter table public.drills add column source_url   text;
alter table public.drills add column source_label text;

-- sessions: intentions, space, source
alter table public.sessions add column intentions   text[] not null default '{}';
alter table public.sessions add column space        text;
alter table public.sessions add column source_url   text;
alter table public.sessions add column source_label text;

-- templates: intentions, programme grouping, source
alter table public.templates add column intentions   text[] not null default '{}';
alter table public.templates add column programme    text;
alter table public.templates add column week         int;
alter table public.templates add column source_url   text;
alter table public.templates add column source_label text;

-- media: attribution travels with the stored image
alter table public.media add column source_url   text;
alter table public.media add column source_label text;
