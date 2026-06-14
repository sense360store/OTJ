-- =====================================================================
-- OTJ Training Hub, migration 0025_feedback_github: record a feedback
-- item's promotion to a public GitHub issue
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review in the main session, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge. The file is named
-- 0025 because the disk ledger ends at 0024_feedback_comments; confirm
-- the next free number against the live ledger before applying, never
-- assume it from the highest file on disk.
--
-- What this is. Four nullable columns on public.feedback that record a
-- ONE WAY promotion of a feedback item to a GitHub issue. The repository
-- sense360store/OTJ is PUBLIC, so every issue is world readable; the
-- promotion is the act of opening that public issue from an item, done
-- only by an admin, who sees and edits the exact title and body first.
--
-- THE PUBLIC BOUNDARY. The issue itself holds NO identifying data: not
-- the filer's name, not a child's name, not a member email or contact.
-- These columns hold only the issue's own coordinates (its number and
-- url), the moment it was opened, and which admin opened it. They are
-- written by the feedback-to-github Edge Function after GitHub confirms
-- the issue was created, through the caller's own RLS client, never by a
-- service role.
--
-- NO RLS CHANGE. The existing feedback policies already govern the row:
-- reads are club wide, and the update policies restrict who may write a
-- feedback row to its creator or a club.manage holder (0019). The
-- function writes these columns as the calling admin, who holds
-- club.manage, so the manage arm of the update policy is the enforcement;
-- this migration adds no policy and no capability. The status the
-- function also moves stays held by the feedback_guard_status trigger
-- from 0019, which already requires club.manage to change a status.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The promotion record. All nullable: an item that has not been promoted
-- carries four nulls, and promotion is one way, so once set these are not
-- cleared by app code. github_issued_by points at the admin who opened
-- the issue and sets null if that profile is later removed, matching the
-- set null used on coaching content's authorship (0012); the issue stays
-- recorded even when the admin's account is gone. github_issue_number and
-- github_issue_url are GitHub's own coordinates for the issue, holding no
-- member data.
-- ---------------------------------------------------------------------
alter table public.feedback
  add column github_issue_number int,
  add column github_issue_url    text,
  add column github_issued_at    timestamptz,
  add column github_issued_by    uuid references public.profiles (id) on delete set null;
