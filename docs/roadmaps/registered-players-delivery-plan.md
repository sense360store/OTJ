# Registered players, seasons, import/export and app audit: delivery plan

Status: Draft for review

Decision owners: Club owner (product); repository maintainer (security and data model)

This is the phasing, migration, rollback and gating document for the Registered Players programme. Product behaviour is specified in docs/product/registered-players-spec.md, file formats and the import pipeline in docs/product/registered-players-import-export.md, page design and copy in docs/product/registered-players-ux.md, exact policy semantics in docs/security/registered-players-boundary.md, threats and the security test plan in docs/security/registered-players-threat-model.md, the audit trust boundary in docs/security/app-audit-boundary.md, and the three architectural decisions in docs/adr/ADR-0005-registered-players-and-seasons.md, docs/adr/ADR-0006-app-audit-events.md and docs/adr/ADR-0007-player-import-export-architecture.md. This document does not restate their content; it sequences it.

Throughout: statements about current behaviour are confirmed and cited; the plan itself is a proposal; anything requiring sign off is listed under Unresolved items.

**Migration numbering.** Every migration number in this document is provisional. The files on disk end at `supabase/migrations/0029_signup_hardening.sql`, and the live hosted ledger also ends at 0029 (re-checked read only on 16 July 2026, recorded in docs/roadmap/foundation-retrospective.md). The likely slots are therefore 0030 onward, but the standing rule holds for every one of them: confirm the next free number against the live migration ledger at apply time, never from the highest file on disk (CLAUDE.md, Data model notes; restated in the 0025 and 0026 migration headers).

---

## Confirmed current state

All of the following was verified against the repository at head.

- `players` (`supabase/migrations/0021_players.sql`) holds id, club_id, team_id (NOT NULL), display_name (1 to 40 chars, the child's full name since `0023_players_fullname.sql`), shirt_number (1 to 99, nullable), created_by (NOT NULL), created_at. No updated_at, no status, no season, no uniqueness beyond the primary key. All three FKs are ON DELETE CASCADE: deleting a team or the curating coach's profile silently deletes children's roster rows today (0021 columns team_id and created_by; the remove-user Edge Function relies on those cascades).
- The AdminTeams delete confirmation copy says "No sessions or people are removed." (`src/routes/AdminTeams.tsx`) while the players cascade deletes roster rows. The copy is wrong today; this plan fixes the data loss and the copy.
- players RLS is the one select gated content table: policies `players_select_coach` and `players_manage_coach` both require `club_id = my_club() and has_perm('sessions.create')` (0021). The 0021 header claims the with check arm pins created_by to the writer; the actual clause does not (confirmed mismatch). New insert policies must pin `created_by = auth.uid()` explicitly.
- The capability catalogue is exactly thirteen keys seeded by `0012_rbac.sql`; `users.manage` and `club.manage` are reserved to the admin system role by the `role_capabilities_guard_reserved` trigger (`0015_rbac_roles.sql`). The system Manager role exists and holds the eleven content capabilities. The standing rule "teams scope no row level security" is recorded in `0016_member_teams.sql`.
- The Roster page lives at `/roster` behind `RequireCap cap="sessions.create"` (`src/App.tsx`), with a hard delete ("Remove player"), no search, no counts, no sort control, no export, and a Spond import button shown when `mappingForTeam` finds a mapping (`src/routes/Roster.tsx`). `useUpdatePlayer` cannot change team_id, so moving a player between teams is impossible in today's UI (`src/lib/queries.ts`).
- `spond-roster-import` runs as the caller through RLS, gates on `has_perm('sessions.create')`, dedupes in memory on lowercased display_name within (club_id, team_id), and inserts names plus optional shirt numbers only (`supabase/functions/spond-roster-import/index.ts`, `_shared/spond.ts`). CLAUDE.md calls this import "admin triggered"; the implemented gate is sessions.create and the button sits on the coach facing Roster page. The capability move in this plan makes the documented intent real.
- Board tokens persist at most `{id, number, side, x, y, playerId}` enforced by the `boards_tokens_minimal_shape` check constraint; playerId references players.id with no foreign key (`0028_board_player_boundary.sql`). Names resolve at render time through the players select.
- There is no seasons concept, no audit or history mechanism, and no CSV or XLSX dependency anywhere (runtime dependencies confirmed in `package.json`: supabase-js, TanStack Query, react, react-dom, react-router-dom only).
- The security suite (`tests/security/`) runs only against a local stack (`assertLocal` in `tests/security/stack.ts`) and is NOT wired into CI: `.github/workflows/ci.yml` runs `npm test` only, and docs/security/policy-test-matrix.md (lines 155 to 162) records the gap and the follow up requirement. `tests/security/capabilities.test.ts` pins `EXPECTED_CATALOGUE` (13 keys) and scans `src/` with a regex covering only the eight existing capability prefixes; both must be extended when the catalogue grows.
- Migration discipline: every migration carries the "REVIEW REQUIRED... Do not auto-merge" banner, applies as one transaction, is applied by hand via the connector after review, and Foundation era SQL uses `set search_path = ''` with schema qualified names (`0028`, `0029`). 0028 established the restore point precedent: preflight, PITR backup, self verifying DO block, and an explicit statement of what rollback cannot recover.
- Edge Function deploys go from files on disk and are verified by reading the deployed source back byte for byte (CLAUDE.md, Edge Function deploys).
- The shared Modal primitive (`src/components/ui.tsx`) closes unconditionally on Escape, overlay click and X; a non dismissible pending state does not exist today and is new UI work (specified in docs/product/registered-players-ux.md). No tables and no pagination exist anywhere in the app.

---

## Proposal

### Overview: eight PRs, provisional migration map

| PR | Title | Migrations (provisional, confirm slot against the live ledger at apply time) | Edge Function work |
|---|---|---|---|
| 1 | Audit foundation and capability catalogue | 0030 | none |
| 2 | Seasons and registered player schema | 0031, 0032 | spond-roster-import compatibility change |
| 3 | Registered Players page | 0033 (legacy column drop, applied late) | none |
| 4 | Safe export and template | 0034 (export_players RPC) | none |
| 5 | CSV/XLSX preview and import | 0035 (import_batches, import_players RPC) | none |
| 6 | Spond integration and Renew | 0036 (renew_registrations RPC) | spond-roster-import rework |
| 7 | Club wide Activity page | none | none |
| 8 | Wider app audit rollout | 0037 | invite-user, remove-user audit writes |

Each PR is a branch cut from current main, one PR per phase, per the repo's build order convention. Every PR in this programme is prohibited from auto merge (see Human gates).

### The compatibility seam: Roster stays functional through PR 2

The old Roster page must keep working until PR 3 replaces it. The seam is **adapted hooks, not a database view**: PR 2 rewrites `usePlayers`, `useInsertPlayer`, `useUpdatePlayer` and `useDeletePlayer` in `src/lib/queries.ts` to read and write the identity plus current season registration pair, returning the same client `Player` shape the Roster and board seeding already consume. A view was considered and rejected: an updatable view over the split needs INSTEAD OF triggers and a security_invoker declaration to avoid bypassing RLS, which adds a new definer adjacent surface to the most sensitive domain for no gain over four hook edits (see Alternatives).

For deploy ordering safety the migration additionally keeps the legacy `players.team_id` and `players.shirt_number` columns for one phase, frozen at their backfill values and never written by new code, following the 0011 programmes precedent for legacy label columns. `players.team_id` is made nullable with ON DELETE SET NULL at the same time so the team deletion data loss fix is effective immediately even on the legacy column. The frozen columns mean the previous frontend build still renders the roster against the new schema, which is the UI rollback lever until they are dropped (provisional 0033, PR 3, after the new page is verified live; slot confirmed against the live ledger at apply time).

---

### PR 1: Audit foundation and capability catalogue

1. **User outcome.** No visible change. From this point the club has a trustworthy, append only audit substrate that every later phase writes into, and the seven new capabilities exist with their default grants. The security suite runs in CI, so every later phase's security tests actually gate merges.
2. **Dependencies.** None on other PRs. Requires sign off on capability defaults (D14 items 3, 4, 5), audit retention (item 8) and no historic names in audit (item 7).
3. **Likely files.** `supabase/migrations/0030_audit_foundation.sql` (provisional; ledger check at apply time); `tests/security/audit.test.ts` (new); `tests/security/capabilities.test.ts` (EXPECTED_CATALOGUE 13 to 20, CAPABILITY_PATTERN extended to the players, seasons and audit prefixes and the view, import, export and delete verbs); `tests/security/local-grants.sql` (restate the log_audit_event execute revoke for the local stack); `.github/workflows/ci.yml` (new security job); `docs/security/policy-test-matrix.md` (new contract rows); `src/routes/AdminUsers.tsx` (extend ENTITY_ORDER so the capability grid renders the new families).
4. **Migration or Edge Function work.** 0030 (provisional): `audit_events` table with the field list in docs/adr/ADR-0006-app-audit-events.md; SELECT only grant to authenticated; select policy `club_id = my_club() and has_perm('audit.view')`; no insert, update or delete policies for clients; `log_audit_event(...)` SECURITY DEFINER writer with `set search_path = ''`, EXECUTE revoked from public, anon and authenticated (0028 revoke pattern); audit indexes; the seven catalogue rows (players.view, players.manage, players.import, players.export, players.delete, seasons.manage, audit.view); default grants (admin all seven; manager players.view, players.manage, players.import, players.export, audit.view; coach players.view only; parent none). No policy references the new keys yet, so behaviour is unchanged at this PR.
5. **Acceptance criteria.** Catalogue is exactly twenty keys; reserved trigger list unchanged; audit_events append only for every client role; writer callable by service role only; grants match the approved defaults; the capability grid renders the new rows; security suite green locally AND in CI. Wiring `tests/security` into CI is an acceptance criterion of this PR, closing the recorded gap (docs/security/policy-test-matrix.md, lines 155 to 162; `.github/workflows/ci.yml` currently runs `npm test` only).
6. **Unit tests.** None new beyond existing suites (no frontend behaviour change); the capability grid ordering change is covered by a small render assertion if AdminUsers has one to extend.
7. **Integration tests.** Local stack: a service role call to `log_audit_event` writes a row whose occurred_at and actor fields are server derived; a rolled back transaction containing an audit write leaves no row.
8. **Security tests.** Parent cannot read audit_events; coach without audit.view reads zero rows; cross club reads return nothing; direct insert, update and delete refused for admin, coach and parent clients; forged actor_id in a writer call is ignored (server derives auth.uid()); catalogue equality pin updated.
9. **Accessibility checks.** None (no user facing UI).
10. **Human review gate.** Migration review (CLAUDE.md review gates: anything under `supabase/migrations/`); capability default grants are role assignment logic, also gated; audit retention decision recorded before merge.
11. **Rollout order.** Merge after review; confirm the live ledger's next free slot; apply 0030 by hand via the connector; verify grants, catalogue count and the append only refusals against the hosted project with disposable rows.
12. **Smoke test.** Signed in admin selects audit_events (empty list acceptable); coach select returns zero rows; the Users screen capability grid shows the seven new rows with the seeded ticks.
13. **Rollback.** Nothing user facing depends on this PR. A defect is fixed forward with a gated migration; audit.view grants can be revoked in the capability grid immediately. No child data is involved, so no restore point is needed beyond the standing preflight.
14. **Auto merge prohibition.** Prohibited. The PR is a migration touching RLS, grants and role capability seeds, all named in CLAUDE.md "Review gates (do not auto-merge)".

### PR 2: Seasons and registered player schema

1. **User outcome.** Invisible on the surface: the Roster page keeps working. Underneath, every player now has a stable identity plus a current season registration, deleting a team no longer deletes children's records (they become Unassigned), removing a coach no longer deletes the players they created, and every player, registration and season change writes an audit event.
2. **Dependencies.** PR 1 applied (audit table and capability keys must exist). Requires sign off on the identity split (D14 item 1), coach team scope and the standing rule change (item 2), coach access reduction (item 3), backfill status and date values, seasons.manage default holders, and archived season absoluteness (item 14).
3. **Likely files.** `supabase/migrations/0031_seasons.sql` and `supabase/migrations/0032_registered_players.sql` (provisional; ledger check at apply time); `src/lib/queries.ts` (adapted player hooks, `useSeasons`, `useCurrentSeason`); `src/lib/data.ts` (Season, PlayerRegistration types); `src/App.tsx` (move `/roster` to its own `RequireCap cap="players.view"` block); `src/routes/Roster.tsx` (affordances keyed to players.manage; Remove hidden unless players.delete); `supabase/functions/spond-roster-import/index.ts` and `supabase/functions/_shared/spond.ts` (compatibility change); `supabase/functions/_shared/spond_roster_test.ts`; `tests/security/players.test.ts` (rewritten matrix), `tests/security/seasons.test.ts`, `tests/security/registrations.test.ts` (new); `docs/security/policy-test-matrix.md`.
4. **Migration or Edge Function work.** 0031 (provisional): `seasons` table, the one current season partial unique index, `activate_season` RPC, seasons RLS and grants, initial season creation. 0032 (provisional): `player_registrations`, the players evolution, backfill, cascade fixes, RLS rewrite, audit triggers, status transition and archived season enforcement triggers, `player_history` read path. Full step list in the Data migration plan below. Edge Function: spond-roster-import gains a minimal compatibility change (writes identity plus current season registration; early probe moves from sessions.create to players.manage so the probe matches the write policies exactly and cannot drift; dedupe unchanged in semantics, now against current season registrations per team; status 'registered' to preserve today's behaviour, with the change to 'pending' deferred to PR 6 where it is an approved product decision).
5. **Acceptance criteria.** Backfill counts verified in transaction (registrations count equals prior players count; every backfilled row status 'registered', registered_date equal to created_at::date); exactly one current season per club enforced; team delete leaves players Unassigned and deletes no child row; profile removal nulls created_by and deletes no child row; Roster works unchanged for managers and admins; board name resolution and seeding unchanged; parent reads nothing from any of the three tables; sessions.create no longer appears in any players policy.
6. **Unit tests.** Hook mapping tests for the adapted shapes; `Roster.test.tsx` updated to gate on players.view; nav tests unchanged (coaches keep sessions.create so FULL_NAV is unaffected).
7. **Integration tests.** Local stack backfill verification (the migration's own DO block plus a harness re-check); activate_season swaps is_current atomically and writes season.activated; archived season registration writes refused; status transition matrix (pending -> registered, pending -> withdrawn, registered -> withdrawn, withdrawn -> pending, withdrawn -> registered allowed; everything else refused).
8. **Security tests.** The new players and registrations matrices per docs/security/registered-players-boundary.md: coach reads assigned teams only; coach cannot read another team's registrations or the identities behind them; Unassigned visible to all_teams holders only; parent and outsider read nothing; insert pins created_by = auth.uid(); client supplied club_id ignored or refused; one current season per club; archived season unchangeable without permission; every successful change writes exactly one audit event and a failed change writes none; audit rows club scoped.
9. **Accessibility checks.** None new (no new UI).
10. **Human review gate.** The most sensitive review of the programme: child data RLS rewrite, the first team scoped RLS in the app (explicitly changing the 0016 standing rule for the players domain only), cascade behaviour changes, and the backfill. Edge Function change reviewed line by line and its deploy verified by byte for byte readback.
11. **Rollout order.** Announce a short quiet window (single club; roster edits paused). Take the restore point (preflight plus PITR backup, 0028 precedent). Confirm the live ledger's next free slots. Merge PR 2 (the frontend deploys; the roster is degraded for the minutes until apply). Apply 0031 then 0032 by hand via the connector. Deploy the adapted spond-roster-import from files on disk and verify by readback. Run the smoke test. If the window between deploy and apply is unacceptable, apply first: the frozen legacy columns keep the previous build working against the new schema, so the reverse order also holds.
12. **Smoke test.** Manager opens Roster, adds a player (identity plus registration rows appear, two audit events), renames them, runs a Spond import for a mapped team (counts as before), seeds a board from the roster and sees names; a parent account still sees no Players surface and no rows; delete a disposable test team and confirm its test registration became Unassigned.
13. **Rollback.** No down migration exists or is written (child data). A defect found after apply is fixed forward by a gated corrective migration; a frontend defect is rolled back by redeploying the previous build, which works against the new schema through the frozen legacy columns; a catastrophic backfill defect within the window is a PITR restore per the 0028 procedure, with the loss window stated at restore time.
14. **Auto merge prohibition.** Prohibited. Migrations, RLS and the child data boundary are all CLAUDE.md review gates, and the Edge Function change is gated beyond merge by the deploy readback rule.

Known interim limitation, accepted through PR 3: under the recommended coach reduction, coaches hold players.view only, so the old Roster becomes read only for them at PR 2 apply (a deliberate approved decision, not a regression; the continuity fallback seed in PR 1 avoids it if chosen). Managers cannot hard delete (players.delete defaults to admin only); the Remove button hides without it, and Withdraw arrives in PR 3.

### PR 3: Registered Players page

1. **User outcome.** The Roster is replaced by the Registered players page at `/players` (`/roster` redirects): season selector including archived seasons, search, team and status filters, counts, sortable list, table on desktop and cards on mobile, add and edit modal, move team, withdraw and restore, admin only permanent delete, per player History drawer, URL persisted filters, and every state in docs/product/registered-players-ux.md. Board selection gains the eligibility rules (current season, Registered, selected team; Pending via the explicit toggle; Withdrawn never).
2. **Dependencies.** PR 2 applied. Requires sign off on permanent deletion versus anonymisation (D14 item 9) and the Pending on boards toggle (item 11).
3. **Likely files.** `src/routes/Players.tsx` (new), `src/components/PlayerFormModal.tsx`, `src/components/PlayerHistoryDrawer.tsx`, `src/components/PlayerFilters.tsx` (new); `src/routes/Roster.tsx` (deleted); `src/App.tsx` (route `/players`, redirect from `/roster`); `src/components/nav.ts` (item Players, ITEM_CAP entry `players: 'players.view'`); `src/lib/screen.ts` (a `players` Screen entry, fixing the active highlight quirk the roster has today); `src/lib/queries.ts` (registration mutations, withdraw and restore, move team, `usePlayerHistory`); `src/routes/Board.tsx` and `src/lib/tacticsBoard.ts` (eligibility filter and toggle); `src/routes/AdminTeams.tsx` (corrected delete copy: players become Unassigned); `supabase/migrations/0033_players_legacy_columns.sql` (provisional; ledger check at apply time; drops the frozen legacy columns); `src/routes/Players.test.tsx` and component tests.
4. **Migration or Edge Function work.** 0033 (provisional) only: drop `players.team_id` and `players.shirt_number` after verifying registrations carry the live values. No Edge Function change.
5. **Acceptance criteria.** Every filter, sort, count, state and copy string in docs/product/registered-players-ux.md; withdraw keeps team and shirt and hides the row from the default view; restore offers Pending or Registered; permanent delete requires players.delete, typed confirmation, writes player.deleted before the row deletion in the same transaction, and leaves boards structurally intact; archived seasons render read only with every mutating affordance hidden; no optimistic writes anywhere on the page.
6. **Unit tests.** Filter, sort and count reducers; URL query round trip; status badge rendering (text plus colour, never colour only); board eligibility selector (Withdrawn excluded from default selection, Pending only with the toggle, Unassigned only when explicitly selected).
7. **Integration tests.** Local stack: withdraw and restore round trip preserves team and shirt; move team writes player.team_changed with safe old and new values; permanent delete cascades registrations and leaves the audit trail with a neutral entity reference.
8. **Security tests.** Re-run the full suite (CI); add: deletion does not expose or corrupt boards; a coach's Players page query set returns only assigned team rows over a real JWT; parent deep linking `/players` is redirected and issues no players query (RequireCap renders nothing until capabilities resolve, the established no transient read pattern in `src/components/RequireCap.tsx`).
9. **Accessibility checks.** Labelled filter controls; full keyboard operation of list, row actions and modals; table headers with scope; mobile card alternative with no horizontal table scroll; status conveyed as text plus badge; focus moved into and restored from every modal and the History drawer; `role="alert"` on failure notes.
10. **Human review gate.** Permanent deletion flow and copy; the 0033 destructive drop (only after live verification that the new page is correct); child data surfaces reviewed against the boundary doc.
11. **Rollout order.** Merge and deploy the page first; run it live for a verification period; then confirm the ledger slot and apply 0033 via the connector. The drop is deliberately last so the UI rollback lever (previous build against frozen columns) survives the page's bedding in.
12. **Smoke test.** Coach sees only their teams; manager sees all; withdraw then restore a test row; open History and see the entries; parent account sees no Players nav and is redirected from the URL; seed a board and confirm Withdrawn players are absent from the picker.
13. **Rollback.** Before 0033 applies: redeploy the previous build (Roster returns). After 0033: the rollback floor is this PR's build; a page defect is fixed forward or the nav item is hidden (nav.ts change) while the route stays capability gated. No schema rollback.
14. **Auto merge prohibition.** Prohibited. Contains a migration (CLAUDE.md gate) and is the primary child data surface; the programme's standing rule is that no PR in it auto merges.

### PR 4: Safe export and template

1. **User outcome.** Holders of players.export can download the blank import template (CSV primary, XLSX compatibility) and export the currently filtered list or everything they can access, in CSV or XLSX, with formula injection protection, a confirmation dialog stating count, season and filters, and an audit event per export.
2. **Dependencies.** PR 3 (the page hosts the buttons). Requires sign off on export capability holders (D14 item 4) and separate import and export capabilities (item 5). First PR to add the XLSX dependency (SheetJS `xlsx`, evaluated in this PR per docs/adr/ADR-0007-player-import-export-architecture.md; no dependency exists today, confirmed in `package.json`).
3. **Likely files.** `src/lib/playersExport.ts` (pure CSV and XLSX builders plus escaping, unit tested like `src/lib/ics.ts`); `src/lib/playersTemplate.ts`; `src/components/ExportConfirmModal.tsx`; `src/lib/queries.ts` (`useExportPlayers`); `supabase/migrations/0034_export_players.sql` (provisional; ledger check at apply time); `tests/security/export.test.ts`; `src/lib/playersExport.test.ts`.
4. **Migration or Edge Function work.** 0034 (provisional): `export_players(p_season_id, p_filters)` SECURITY DEFINER RPC, `set search_path = ''`, re-checks players.export, applies the team scope, writes players.exported in the same transaction as the read (count, format, season, safe filter summary; never rows). No Edge Function.
5. **Acceptance criteria.** Column order, filename shape, BOM, quoting, date format and Unassigned representation exactly per docs/product/registered-players-import-export.md; any cell starting with =, +, -, @, tab or CR neutralised in CSV and written as an explicit text cell in XLSX; export respects the active filters; the confirmation dialog appears for every export; one audit row per export, none on cancel.
6. **Unit tests.** Builder round trips; escaping table (every trigger character, both formats); filename generator; template header stability pin.
7. **Integration tests.** Local stack: export_players returns only rows the caller's scope allows; the audit row commits with the read; a refused call writes nothing.
8. **Security tests.** Unauthorised coach cannot export (RPC refusal without players.export); parent cannot execute; cross club season id refused; export formula injection escaped (unit proof referenced from the matrix); audit actor server derived.
9. **Accessibility checks.** Confirmation dialog focus management; download completion announced; the export buttons reachable and labelled.
10. **Human review gate.** Export of children's names is the highest sensitivity read path: club owner signs the confirmation copy and the holder list; migration gate applies; first live export is supervised.
11. **Rollout order.** Merge; confirm ledger slot; apply 0034 via the connector; deploy rides the merge; supervised first live export by an admin.
12. **Smoke test.** Manager exports a filtered CSV, opens it, checks columns and the neutralised test cell; the Activity substrate shows the players.exported row (via SQL until PR 7); a coach without players.export sees no export affordance and the RPC refuses a direct call.
13. **Rollback.** Revoke players.export grants in the capability grid (immediate, no deploy); a deeper defect gets EXECUTE revoked from the RPC by a gated hotfix migration; nothing is stored server side, so there is no dataset to clean up.
14. **Auto merge prohibition.** Prohibited. Migration plus a new child data egress path; CLAUDE.md migration gate and the programme rule.

### PR 5: CSV/XLSX preview and import

1. **User outcome.** Holders of players.import upload a CSV or XLSX, see a full validation preview (nothing written on file selection), download rejected and warning rows, and confirm an all or nothing transactional import that is idempotent, audited per row and per batch, and safe against double clicks and lost responses.
2. **Dependencies.** PR 4 (template and the xlsx dependency). Requires sign off on browser parsing (D14 item 12), the RPC commit (item 13) and all or nothing commit.
3. **Likely files.** `src/lib/playersImportParse.ts` (RFC 4180 CSV tokenizer plus XLSX reader with the caps); `src/lib/playersImportPlan.ts` (matching, duplicates, row validation); `src/lib/playersImport.ts` (batch orchestration, rejected row report builder); `src/components/ImportPlayersModal.tsx`; `src/components/ui.tsx` (Modal gains a locked busy mode suppressing X, Escape and overlay close, with aria-modal and a focus trap; new work, specified in the UX doc); `src/lib/queries.ts` (`useImportPlayers`); `supabase/migrations/0035_import_players.sql` (provisional; ledger check at apply time); `tests/security/import.test.ts`; unit tests beside each lib file with synthetic fixtures only.
4. **Migration or Edge Function work.** 0035 (provisional): `import_batches` table and the `import_players(p_batch_id, p_season_id, p_rows)` SECURITY DEFINER RPC per docs/adr/ADR-0007-player-import-export-architecture.md: re-checks players.import, derives club and actor server side, revalidates every row, applies in one transaction, sets the audit GUCs (otj.audit_source, otj.audit_batch), writes the batch summary event, and returns the stored result for a repeated batch id without re-applying. No Edge Function.
5. **Acceptance criteria.** Every format rule, cap, matching rule and preview category in docs/product/registered-players-import-export.md; file selection never writes; Confirm disabled until eligible; the confirming modal not dismissible by any route; repeated Confirm blocked client side and idempotent server side; server validation failure aborts the whole transaction with a structured error; rejected row report generated client side and never uploaded.
6. **Unit tests.** Tokenizer edge cases (quoting, BOM, delimiters, blank rows); planner matrix (Player ID updates, already present, cross team duplicate warning, in file duplicates held back, unknown team, season cell mismatch, status vocabulary, date formats, leading apostrophe strip); caps enforcement before parse.
7. **Integration tests.** Local stack: happy path insert and update counts; same batch id replay returns the stored result and writes nothing; transaction failure leaves zero rows and zero success audit events; batch and row events share batch_id.
8. **Security tests.** Unauthorised coach cannot import; cross club player ids fail; client club id and actor ignored; import transaction and audit commit together; duplicate confirmation produces no duplicates; lost response plus retry idempotent; file formulas not evaluated (inert strings, invalid cell values); stale preview (changed team or season) aborts; permission revoked between preview and commit refused; team deleted during import rejected by server revalidation; season archived during import refused; guessed batch id yields nothing across clubs.
9. **Accessibility checks.** Preview errors navigable and screen reader readable per row; the locked modal announces progress and result; focus trapped while confirming and restored after; the rejected report download labelled with its content and sensitivity.
10. **Human review gate.** Spreadsheet processing is explicitly reviewable (task rule); migration gate; first live import is supervised with a file prepared with the club owner.
11. **Rollout order.** Merge; confirm ledger slot; apply 0035 via the connector; deploy rides the merge; supervised first live import.
12. **Smoke test.** Import the template with two synthetic rows; verify preview counts, confirm, check the rows, the audit events and the batch record; re-confirm the same batch and verify nothing doubled.
13. **Rollback.** Failed imports leave nothing (transactional). Disable the feature by revoking players.import grants (immediate) or EXECUTE on import_players via gated hotfix; a bad committed import is recovered through the product flows (withdraw, team correction, re-import with Player IDs), never by editing audit or replaying it.
14. **Auto merge prohibition.** Prohibited. Migration, child data write path and spreadsheet handling are all gated; CLAUDE.md migration gate applies.

### PR 6: Spond integration and Renew

1. **User outcome.** Import from Spond lands squad members into the current season as Pending registrations (subject to approval), gated by players.import, idempotent per season and team, audited as a batch with source spond_import. The bulk Renew action copies chosen registrations from a source season into the current season as Pending with team and shirt carried forward.
2. **Dependencies.** PR 5 (the transactional commit path the function reuses). Requires sign off on the Spond default status (D14 item 6) and the renewal mechanism (item 10).
3. **Likely files.** `supabase/functions/spond-roster-import/index.ts`, `supabase/functions/_shared/spond.ts`, `supabase/functions/_shared/spond_roster_test.ts`; `src/routes/Players.tsx` (Import from Spond and Renew affordances); `src/components/RenewSeasonModal.tsx` (new); `src/lib/queries.ts`; `supabase/migrations/0036_renew_registrations.sql` (provisional; ledger check at apply time); `tests/security/renew.test.ts`.
4. **Migration or Edge Function work.** 0036 (provisional): `renew_registrations` transactional SECURITY DEFINER RPC (players.manage, batch id, audit source 'renewal'). Edge Function rework: gate moves to players.import (making CLAUDE.md's "admin triggered" intent real under the default grants); season chosen server side as the club's current season, refusing when none exists; commit goes through the transactional RPC path so the GUC enrichment stamps source 'spond_import' and the batch id; dedupe by normalised name within (club, season, team) against registrations; still names and optional shirt numbers only, counts only logging, fail closed on missing secrets.
5. **Acceptance criteria.** Repeat Spond import adds nothing; imported rows are Pending in the current season (or the approved alternative); each run writes players.spond_imported events plus a batch summary; the function never accepts a client supplied season; Renew copies exactly the chosen registrations, resets status to Pending, carries team and shirt, leaves registered_date empty, and is idempotent per (player, season).
6. **Unit tests.** `spond_roster_test.ts` extended: reduction boundary unchanged (the existing key and guardian assertions stay green), new season aware planning, capped selection.
7. **Integration tests.** Local stack: renew_registrations round trip, idempotency, audit batch; the RPC refuses a source season outside the club.
8. **Security tests.** Function level tests remain in the Deno suite (the local harness does not run the edge runtime, per docs/security/policy-test-matrix.md limitations); harness proofs: renew requires players.manage; parent and coach without grant refused; Spond path writes carry server derived actor and source.
9. **Accessibility checks.** The Spond and Renew modals follow the PR 5 locked modal and focus rules; result counts announced.
10. **Human review gate.** Edge Function reviewed line by line; deploy from files on disk and verified by byte for byte readback (CLAUDE.md Edge Function deploys); migration gate for 0036; the children's data boundary sections of the function header re-reviewed.
11. **Rollout order.** Merge; confirm ledger slot; apply 0036 via the connector; deploy the function and verify readback; supervised first run against one mapped team.
12. **Smoke test.** Import a mapped team from Spond twice; second run adds zero; rows are Pending in the current season; renew two test registrations into a scratch season on the local stack (production renewal waits for a real season change).
13. **Rollback.** Redeploy the previous function version from git (functions are stateless; readback verified); pause imports by revoking players.import grants; renew disabled by EXECUTE revoke via gated hotfix. Committed rows are corrected through the product flows.
14. **Auto merge prohibition.** Prohibited. Edge Function touching the child data pipeline plus a migration; both are CLAUDE.md gates.

### PR 7: Club wide Activity page

1. **User outcome.** Holders of audit.view get an Activity page: newest first, server paginated, filterable by date range, actor, entity type, action, team, season, source and import batch, with neutral display for deleted entities and deep links where a target still exists. Parents never see it; coaches without audit.view keep only per player History.
2. **Dependencies.** PR 1 (substrate), PR 3 (entity resolution patterns). No migration (indexes shipped in 0030).
3. **Likely files.** `src/routes/Activity.tsx` (new); `src/components/nav.ts` (item behind audit.view); `src/App.tsx` (`RequireCap cap="audit.view"` block); `src/lib/screen.ts`; `src/lib/queries.ts` (paginated audit query using range windows; never the whole history to the browser); `src/routes/Activity.test.tsx`.
4. **Migration or Edge Function work.** None. If live filtering shows a missing index, a follow up gated migration is raised separately (provisional slot confirmed against the live ledger at apply time).
5. **Acceptance criteria.** Deterministic ordering (occurred_at desc, id desc tiebreak); pagination stable under concurrent writes; every rendered string sourced from the safe fields only (no child names anywhere; "Player name corrected" rendering per docs/security/app-audit-boundary.md); deleted actor shows the actor_name snapshot; deleted player and team show neutral identifiers; no audit feed export in v1.
6. **Unit tests.** Event renderer per action type; filter serialisation; pagination reducer.
7. **Integration tests.** Local stack: page size windows return disjoint, complete slices; filters compose.
8. **Security tests.** Parent cannot read audit (re-pinned through the page's exact query shape over a real JWT); coach without audit.view reads zero rows; club scoping; profile deletion does not break audit display or leak.
9. **Accessibility checks.** Filterable list keyboard operable; date range inputs labelled; loading, empty and error states announced; mobile layout without horizontal scroll.
10. **Human review gate.** Exposure review: the page renders the club's operational history; reviewers confirm no unsafe field reaches the renderer.
11. **Rollout order.** Merge and deploy; no apply step.
12. **Smoke test.** Admin filters by source csv_import and finds the PR 5 smoke batch; manager sees the page; coach and parent do not.
13. **Rollback.** Hide the nav item and route (frontend only redeploy); RLS keeps the data inaccessible regardless.
14. **Auto merge prohibition.** Prohibited. No migration, but the page surfaces the audit boundary and the programme rule stands: no PR in this programme auto merges; review confirms the safe field discipline.

### PR 8: Wider app audit rollout

1. **User outcome.** The Activity page fills out: user invites, removals, role and capability changes, team changes, Spond mapping and sync events, and content lifecycle events (drills, media, templates, programmes, sessions, boards, feedback status) all appear, giving the club one place to answer what changed, who, when and where from.
2. **Dependencies.** PRs 1 and 7. The action catalogue extensions per docs/adr/ADR-0006-app-audit-events.md future list.
3. **Likely files.** `supabase/migrations/0037_audit_rollout.sql` (provisional; ledger check at apply time); `supabase/functions/invite-user/index.ts` and `supabase/functions/remove-user/index.ts` (service role calls to log_audit_event for user.invited and user.removed); `src/routes/Activity.tsx` (renderers for the new actions); `tests/security/audit.test.ts` (extended).
4. **Migration or Edge Function work.** 0037 (provisional): AFTER row triggers on roles, member_roles, role_capabilities, member_teams, teams, spond_groups and the content tables, each with an explicit safe field allow list (no body text, no tokens, no secrets, no raw rows); catalogue action rows extended. Edge Function updates deployed with readback verification.
5. **Acceptance criteria.** Every listed action writes exactly one event per committed change; nothing in the never log list is captured (reads, searches, tokens, raw bodies); trigger failure semantics reviewed (an audit failure fails the transaction, deliberately, consistent with PR 1).
6. **Unit tests.** Renderer coverage for each new action.
7. **Integration tests.** Local stack: role grant, team rename and drill delete each produce their event; a refused write produces none.
8. **Security tests.** Re-run the full suite; add: content trigger events carry no body content; invite and removal events carry no email beyond the profile display already club visible; forged source GUC from a client session has no effect (clients cannot reach the writer).
9. **Accessibility checks.** New event rows follow the PR 7 patterns.
10. **Human review gate.** Migration gate; service role writer use in the two functions is explicitly reviewed (CLAUDE.md gates cover invite and role assignment logic); global audit rollout named reviewable by the task.
11. **Rollout order.** Merge; confirm ledger slot; apply 0037 via the connector; deploy both functions with readback verification; verify a disposable role grant appears in Activity.
12. **Smoke test.** Rename a test team, grant and revoke a capability on a scratch role, delete a scratch drill; all three appear correctly rendered.
13. **Rollback.** Drop offending triggers via gated hotfix migration (audit gaps accepted and recorded for the gap window); function changes redeploy previous versions.
14. **Auto merge prohibition.** Prohibited. Migration plus invite and role assignment adjacent Edge Function changes, both CLAUDE.md gates.

---

### Data migration plan

The authoritative field lists live in docs/adr/ADR-0005-registered-players-and-seasons.md and the exact policy text in docs/security/registered-players-boundary.md. This section is the operational sequence. All slots provisional; each is confirmed against the live ledger at apply time.

1. **Preflight and restore point.** Before 0032 (provisional) is applied: row counts recorded, PITR backup point taken, quiet window announced. This follows the 0028 precedent (preflight, backup, self verifying migration, explicit non recoverability statement).
2. **Initial season (0031, provisional).** One `seasons` row per club: name "2026/27", starts_on 2026-07-01, ends_on 2027-06-30, is_current true. The name and dates are proposed product defaults for the club owner to confirm alongside the backfill values. The partial unique index on (club_id) where is_current enforces the one current season invariant from the first row.
3. **Players evolution (0032, provisional).** Add updated_by (nullable, FK profiles ON DELETE SET NULL) and updated_at; created_by becomes nullable and its FK is recreated ON DELETE SET NULL, ending the profile removal cascade that deletes children's rows today (confirmed against 0021 and the remove-user function). A unique (id, club_id) index supports the composite FK in step 4.
4. **player_registrations (0032).** Created per docs/adr/ADR-0005-registered-players-and-seasons.md: player_id FK players ON DELETE CASCADE; season_id FK seasons ON DELETE RESTRICT; team_id nullable FK teams ON DELETE SET NULL (team deletion makes players Unassigned, fixing today's cascade data loss); person FKs nullable ON DELETE SET NULL; UNIQUE (player_id, season_id); status text CHECK in ('pending','registered','withdrawn'); shirt_number CHECK 1 to 99. The club equality rule (registration club must equal the player's club) is enforced declaratively by a composite FK (player_id, club_id) referencing players (id, club_id); the boundary doc holds the exact form.
5. **Backfill (0032, same transaction).** One registration per existing players row in the initial season: team_id and shirt_number carried; status 'registered' (APPROVAL REQUIRED; they are live operational rosters); registered_date = created_at::date (APPROVAL REQUIRED); created_by and created_at carried; updated_at initialised to created_at; updated_by null. No merging of same named rows, ever; duplicates across teams remain separate identities for manual review.
6. **Self verification (0032).** A DO block aborts the transaction unless the registration count equals the prior players count and every backfilled row passes the status and date rules (0028 pattern).
7. **Legacy columns.** `players.team_id` (made nullable, FK ON DELETE SET NULL) and `players.shirt_number` are retained frozen for one phase as the backfill source and the UI rollback lever, never written by new code (0011 programmes precedent), then dropped in 0033 (provisional) after PR 3 is verified live.
8. **Indexes.** player_registrations: (club_id, season_id), (club_id, season_id, team_id), (season_id, status), plus the (player_id, season_id) unique; seasons: (club_id) plus the partial unique; audit_events (shipped in 0030): (club_id, occurred_at desc), (club_id, entity_type, entity_id, occurred_at desc), (batch_id).
9. **Grants.** Explicit per the 0012 lesson: full DML on seasons and player_registrations to authenticated (policies gate); SELECT only on audit_events; every privileged function follows the revoke EXECUTE from public, anon and authenticated pattern where it is not a client RPC; no update grant is issued where no update policy exists.
10. **RLS.** `players_select_coach` and `players_manage_coach` are dropped and replaced with the D4 semantics (team scoped reads for non all_teams holders, capability form, club scoped); every insert policy pins `created_by = auth.uid()` explicitly, closing the confirmed 0021 comment versus clause mismatch; seasons readable club wide (no child data), writable under seasons.manage; exact policy text in docs/security/registered-players-boundary.md. This is the first team scoped RLS in the app and changes the 0016 standing rule for the players domain only; the migration header states so.
11. **Capability catalogue and tests.** 0030 (provisional) grows the catalogue 13 to 20 and seeds the default grants. In the same PR, `tests/security/capabilities.test.ts` updates `EXPECTED_CATALOGUE` to the twenty keys and extends `CAPABILITY_PATTERN` to cover the players, seasons and audit prefixes and the view, import, export and delete verbs; without both changes the equality pin fails and the frontend drift scan is blind to the new family (confirmed from the current regex).
12. **Audit foundation and triggers.** 0030 creates the substrate; 0032 attaches the AFTER row triggers to players, player_registrations and seasons, plus the status transition validation trigger, the archived season write refusal trigger, and updated_at and updated_by touch triggers for the players domain. All new SQL functions use `set search_path = ''` with schema qualified names (the 0028 and 0029 Foundation convention); safe_changes is computed from an explicit column allow list, never row_to_json.
13. **RPCs.** activate_season and player_history in PR 2; export_players (0034), import_players with import_batches (0035), renew_registrations (0036), all provisional, all confirmed against the live ledger at apply time, all SECURITY DEFINER with in body capability checks and server derived identity.
14. **Spond function rework.** A compatibility change rides PR 2 (split aware writes, players.manage probe); the full rework (players.import gate, Pending status, RPC commit with batch audit) rides PR 6. Both deploys verified by byte for byte readback.
15. **Board query compatibility.** No boards DDL at any point. Board tokens keep referencing players.id, which the identity split deliberately preserves (the headline reason for the split in ADR-0005); seeding and name resolution adapt in the hooks; a coach viewing another team's board sees numbered discs under the D4 scope, an accepted and documented trade off.
16. **Rollback limitations.** All migrations are forward only. No down migration is written for any child data change; recovery within the apply window is PITR restore per the 0028 procedure, and after the window it is corrective gated migrations plus the product flows. The single destructive step in the whole plan, the 0033 legacy column drop, is deferred, separately gated, and applied only after live verification.

### Rollback

There is no feature flag framework in this repo. The rollback levers, in preference order: hide navigation (frontend redeploy, minutes), revoke capability grants in the users.manage grid (immediate, no deploy), revoke EXECUTE on an RPC via a gated hotfix migration, redeploy a previous frontend build or Edge Function version, and, only within an apply window, PITR restore.

1. **Schema applied but UI not deployed.** Safe by design: the frozen legacy columns keep the previous build working (PR 2), and PRs 4 to 6 add RPCs nothing calls yet. Hold the frontend; no schema action.
2. **UI deployed but import disabled.** The import affordance is capability gated: revoke players.import grants and the button disappears for everyone while the rest of the page works. The RPC refuses regardless.
3. **Audit foundation failure.** Because audit commits with the business change, a broken trigger blocks player writes. Response: gated hotfix migration dropping the failing trigger (audit gap accepted and recorded for the gap window), fix forward, re-attach. The table itself carries no child names, so no data cleanup arises.
4. **Import RPC failure.** Failed runs are transactional and leave nothing. Disable by EXECUTE revoke (gated hotfix) plus grant revocation; a retry after fix with the same batch id is safe by design.
5. **Bad capability grants.** Corrected immediately in the capability grid by a users.manage holder; the seed defect is then fixed by a follow up migration. RLS fails closed throughout, so a missing grant hides features and never exposes data.
6. **Wrong season backfill.** Status, dates and team on registrations are correctable by a gated corrective migration (they are ordinary columns, not history). A wholesale wrong backfill discovered inside the apply window is a PITR restore per the 0028 procedure. Never a destructive down migration.
7. **Export defect.** Revoke players.export grants (immediate). Nothing is stored server side, so the only exposure is files already downloaded; the confirmation dialog's secure handling reminder is the mitigation for those.
8. **XLSX parser defect.** Browser side only; a hostile or broken file affects the uploading manager's own tab. Disable the XLSX accept path (frontend redeploy), leaving CSV working; the size, row and column caps bound the damage meanwhile.
9. **Spond regression.** Redeploy the previous function version from git with readback verification; pause the trigger by revoking players.import; the secrets fail closed behaviour is unchanged throughout.
10. **Board regression.** Seeding and name resolution are frontend only; redeploy the previous build. Before 0033 applies any prior build works; after 0033 the rollback floor is the PR 3 build (stated in PR 3's rollout).

### Human gates

Explicit human review and sign off, with no auto merge, applies to:

- The player data model and identity split (PR 2).
- The season model and the one current season invariant (PR 2).
- Capability defaults and the coach access reduction (PR 1 seeds; PR 2 makes them effective).
- The coach view scope and the 0016 standing rule change (PR 2).
- Import and export permission holders (PR 1 seeds; PRs 4 and 5 surfaces).
- Every migration: all of PRs 1 to 6 and 8 contain migrations, and CLAUDE.md "Review gates (do not auto-merge)" already gates anything under `supabase/migrations/`, especially RLS.
- Every RLS change (same gate).
- Any service role use: log_audit_event callers, and the PR 8 function writers.
- Every Edge Function change (PR 2 shim, PR 6 rework, PR 8 writers), each deployed from files on disk and verified by byte for byte readback per CLAUDE.md Edge Function deploys.
- Audit retention (decided at PR 1, revisited annually).
- Permanent deletion flow and copy (PR 3).
- Production migration apply: always by hand via the connector, after confirming the live ledger's next free slot and, for child data migrations, after the restore point (repo practice per 0028 and 0029 and the foundation retrospective).
- Production Edge Function deploys (readback verification, as above).
- First live import (PR 5), first live export (PR 4) and first live season activation (first real season change): each performed supervised, by an admin, with the result checked against the audit trail.

Standing rule for the whole programme: **no PR in this plan may auto merge**, including the two without migrations (PRs 3 and 7), because every one of them either touches the child data boundary, renders child data, or surfaces the audit boundary.

---

## Alternatives

- **One large PR.** Rejected: unreviewable against the CLAUDE.md gates, and a single failure would roll back the audit substrate along with the schema. The eight way split keeps migrations, child data RLS, spreadsheet processing and the global audit rollout independently reviewable, as the task requires.
- **UI first, schema later.** Rejected: the page cannot demonstrate seasons, statuses or scoping against the old schema, and the audit substrate must predate the first schema change so the backfill and every subsequent write are recorded.
- **Database view as the Roster compatibility seam.** Rejected in favour of adapted hooks: an updatable view needs INSTEAD OF triggers and security_invoker care to avoid an RLS bypass, creating a new reviewed surface in the most sensitive domain, where the hook adaptation is four functions in `src/lib/queries.ts` already covered by the existing test pattern. The frozen legacy columns cover deploy ordering instead.
- **Edge Function based import.** Rejected in docs/adr/ADR-0007-player-import-export-architecture.md; recorded here because it changes this plan's shape (no new function deploys in PRs 4 and 5, so those phases have no readback step and one fewer gate).
- **Audit rollout before the players work (PR 8 earlier).** Rejected: the wider rollout multiplies trigger surface before the pattern is proven on one domain; players is the proving ground.

## Decision

Adopt the eight PR plan, the provisional migration map 0030 to 0037 (every slot confirmed against the live ledger at apply time), the adapted hooks compatibility seam with frozen legacy columns dropped in a late gated migration, forward only migrations with the 0028 restore point procedure for child data, and the human gates listed above. The plan executes only as its prerequisite approvals in Unresolved items are granted; PR boundaries do not move without updating this document.

## Consequences

- Coaches lose roster write access at PR 2 apply under the recommended reduction (read only Roster until PR 3, then a read only Players page scoped to their teams). This is deliberate and prominently flagged; the continuity fallback seed in PR 1 is the alternative.
- Managers cannot remove players between PR 2 and PR 3 (players.delete defaults to admin only and Withdraw arrives with the new page). Accepted as a days long interim.
- The audit triggers make audit availability a dependency of player writes: a broken trigger blocks the write rather than losing the record. Chosen deliberately; the rollback path is the trigger drop hotfix.
- Two quiet windows are required of the club (PR 2 apply, PR 3's 0033 apply); all other phases deploy without downtime.
- Until PR 7 there is no audit UI; verification of PRs 1 to 6 audit output is by SQL through the connector.
- The security suite in CI adds Docker based supabase start to the pipeline; per docs/security/policy-test-matrix.md it stays out of the required checks only until proven reliable, then gates merges.

## Unresolved items

The numbered decisions from the canonical list that gate this plan, each with the recommended default and the PR it blocks:

1. Identity split (recommended: split; blocks PR 2).
2. Coach team scope including the 0016 standing rule change (recommended: assigned teams only; blocks PR 2).
3. Coach access reduction from today's sessions.create powers (recommended: reduce to view; blocks PR 1 seeds and PR 2).
4. Export capability holders (recommended: managers and admins; blocks PR 1 seeds and PR 4).
5. Separate players.import and players.export capabilities (recommended: yes; blocks PR 1).
6. Spond default status (recommended: pending; blocks PR 6; PR 2's shim preserves today's behaviour meanwhile).
7. Historic name retention in audit (recommended: no values recorded; blocks PR 1).
8. Audit retention (recommended: indefinite, reviewed annually; blocks PR 1).
9. Permanent deletion versus anonymisation (recommended: deletion, admin only; blocks PR 3).
10. Renewal mechanism (recommended: bulk Renew to pending with carry forward; blocks PR 6).
11. Pending on boards toggle (recommended: yes, explicit toggle; blocks PR 3).
12. Browser versus server XLSX parsing (recommended: browser; blocks PR 5).
13. RPC versus Edge Function import commit (recommended: RPC; blocks PR 5).
14. Archived season absoluteness (recommended: read only with the unarchive escape hatch; blocks PR 2).
15. audit.view versus per player history access (recommended: separate paths; blocks PR 2 and PR 7).

Plus, from the same list: the backfill status and date values (recommended: 'registered' and created_at::date; blocks PR 2), the seasons.manage default holders (recommended: admin only; blocks PR 1 seeds), and all or nothing import commit (recommended: all or nothing; blocks PR 5). The initial season name and dates in the Data migration plan are confirmed with the club owner at the PR 2 review.

## Implementation dependencies

- Sibling documents approved first: docs/product/registered-players-spec.md, docs/product/registered-players-import-export.md, docs/product/registered-players-ux.md, docs/security/registered-players-boundary.md, docs/security/registered-players-threat-model.md, docs/security/app-audit-boundary.md, docs/adr/ADR-0005-registered-players-and-seasons.md, docs/adr/ADR-0006-app-audit-events.md, docs/adr/ADR-0007-player-import-export-architecture.md.
- The approvals in Unresolved items, in PR order (items blocking PR 1 first).
- CI capacity for the security job (Docker image pulls for the local stack; caching and health check timeouts proven before the job joins the required checks, per docs/security/policy-test-matrix.md).
- The SheetJS `xlsx` dependency evaluation at PR 4 (no dependency is added by the scoping PR; none exists today).
- Connector access for by hand migration applies and the live ledger read before every apply.
- The Spond organiser secrets remain configured (SPOND_EMAIL, SPOND_PASSWORD); the functions fail closed without them.
- Club owner availability for the PR 2 and PR 3 quiet windows and the three supervised firsts (import, export, season activation).
