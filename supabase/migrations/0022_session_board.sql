-- =====================================================================
-- OTJ Training Hub, migration 0022_session_board: attach a board to a session
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge. No Edge Function changes accompany this.
--
-- Why this exists. Tactics board phase four embeds a saved board in a
-- session: the planner and the session day attach one of the club's boards
-- and the session day renders it read only inline. That phase is frontend
-- only and was meant to reuse an existing nullable session column, but none
-- fit: activities is the drill phase jsonb array, read and written whole by
-- the planner, and every other column is a typed session field. Rather than
-- overload one silently this adds a dedicated column. One session references
-- at most one board.
--
-- Numbering: the ledger ends at 0021_players, so this is 0022.
--
-- board_id. Nullable: a session need not carry a board, and most will not.
-- references boards on delete set null, so deleting a board detaches it from
-- every session that pointed at it rather than leaving a dangling id or
-- blocking the delete. A board is club content, visible club wide (0020), so
-- any club member who can read the session can read its board; no extra read
-- rule is needed. The embedded view hides roster name labels from a parent in
-- application code (tokens by number only); that is presentation, not a data
-- boundary, since a board already holds no person data beyond the free text
-- labels a coach typed.
--
-- RLS. No new policy. The sessions update policies (0012 onward) are row
-- level: the owner, or an admin, may update the row, and that already governs
-- setting or clearing board_id. There is no column level restriction to add;
-- a coach who can edit the session can attach its board, which is the intent.
-- =====================================================================

alter table public.sessions
  add column board_id uuid references public.boards (id) on delete set null;

create index on public.sessions (board_id);
