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

-- 0030 audit foundation. audit_events is append only by grant: authenticated
-- holds SELECT only and anon holds nothing, so a client cannot insert, update,
-- delete or truncate an event, and the refusal happens at the grant (42501),
-- not as RLS zero rows. The private writer log_audit_event is service_role
-- only. The blanket grants above would resurrect ALL of these locally
-- (including TRUNCATE), so revoke everything and grant back SELECT alone,
-- exactly as the migration does, to mirror production. See
-- 0030_audit_foundation.sql and docs/security/app-audit-boundary.md.
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
revoke execute on function public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid) from anon, authenticated;
