-- =====================================================================
-- OTJ Training Hub - shared live session state
-- Migration 0006_live_state
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- Design (Phase 5): live state lives on the session row, not a broadcast
-- channel. The row is the single source of truth, so late joiners and
-- refreshes get current state for free, RLS keeps enforcement, and the
-- write rate is one update per activity change. Clients compute the
-- running clock locally from live_activity_started_at.
--
-- No policy changes. The existing club-wide select policy governs who
-- can watch (RLS applies to realtime reads), and the existing update
-- policy (owner, or admin) already means only the owning coach or an
-- admin can drive.
-- =====================================================================

-- Both null when the session is not live. live_activity_index is the
-- position in the activities jsonb array the driver is on, and
-- live_activity_started_at is when that activity began.
alter table public.sessions add column live_activity_index int;
alter table public.sessions add column live_activity_started_at timestamptz;

-- Realtime: watchers subscribe to postgres changes on their session row.
alter publication supabase_realtime add table public.sessions;
