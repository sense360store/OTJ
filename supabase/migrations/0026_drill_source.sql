-- =====================================================================
-- OTJ Training Hub, migration 0026_drill_source: link a library drill to
-- the FA import that created it
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge. The fa-import and fa-import-programme
-- Edge Functions change alongside this and must be deployed from disk via
-- the CLI after review (issue #91, parts 1 and 2). Nothing here touches a
-- policy, a helper or the children's data boundary.
--
-- Why this exists. Imported drills are standalone library rows with no link
-- back to the programme, template or page that created them (issue #91).
-- Without a link an import cannot tell that a drill it is about to create
-- already exists, so re-importing the same FA session or programme makes
-- duplicates; and a programme or template delete cannot find the drills it
-- brought in. Both columns are nullable so existing rows are unaffected and
-- a hand made drill simply carries neither.
--
-- source_key. A stable identity for the FA source a drill came from: the FA
-- source URL plus the activity identity within that page, computed by the
-- pure faSourceKey helper in supabase/functions/_shared/fa.ts. Two drills
-- with the same source_key are the same drill, so the importer reads this to
-- reuse an existing drill rather than insert a duplicate. Text, not a foreign
-- key, because the identity is derived from the FA page, not a row in this
-- database. Null for any drill not created by an FA import.
--
-- source_programme_id. The programme an import attached the drill to, set by
-- fa-import-programme when it imports a programme's weeks. references
-- programmes on delete set null, so deleting a programme detaches its drills
-- rather than blocking the delete or leaving a dangling id; the application
-- deletes the unused ones first and lets this null out the ones it keeps
-- because a session still uses them. Null for a single session import (those
-- are matched back to their template by the shared source_url instead) and
-- for any hand made drill.
--
-- Numbering: the highest migration file on disk is 0025_feedback_github, so
-- this is 0026. The file numbers carry development gaps (0003, 0004, 0010 are
-- absent); confirm the next free slot against the live migration ledger
-- before applying this, never assume it from the highest file on disk.
--
-- RLS. No new policy. Both columns sit on drills, whose existing select,
-- insert, update and delete policies already govern every read and write of
-- the row. The importer writes them through the same RLS bound client it
-- already uses, and the delete cascade runs as the signed in user, so a
-- coach can only remove drills the drills delete policy already lets them
-- remove.
-- =====================================================================

alter table public.drills
  add column source_key text,
  add column source_programme_id uuid references public.programmes (id) on delete set null;

-- The importer's reuse lookup is by club and source_key; the delete cascade
-- for a programme is by source_programme_id.
create index on public.drills (club_id, source_key);
create index on public.drills (source_programme_id);
