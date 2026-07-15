-- LOCAL TEST STACK ONLY. Applied by tests/security/global-setup.ts through
-- the local database container, never by any migration and never against a
-- hosted project.
--
-- Why this exists: the hosted project was created before Supabase revoked
-- the automatic Data API grants, so in production the anon, authenticated
-- and service_role roles hold the legacy blanket grants and Postgres RLS is
-- the effective gate (0012 onward add explicit grants for new tables only).
-- A freshly created local stack no longer auto-grants, which makes every
-- pre-0012 table unreachable through the API locally and would fail these
-- tests on grants instead of exercising the policies. Reproducing the
-- legacy grants locally makes the local stack answer like production, so
-- the suite tests the same boundary production relies on: RLS.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Deliberate revokes carved out of the legacy blanket grants. A migration
-- that intentionally revokes a grant describes the production end state,
-- and the blanket grants above must not resurrect it locally; restate each
-- such revoke here so the local stack answers like production. Currently:
-- 0028 makes the board backfill transform service_role only (it is not an
-- application RPC; see 0028_board_player_boundary.sql).
revoke execute on function public.board_tokens_without_names(jsonb, uuid) from anon, authenticated;
