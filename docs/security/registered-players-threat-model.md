# Registered players: threat model and security test plan

Status: Draft for review

Decision owners: Club owner (product); repository maintainer (security and data model)

This document is the privacy and safeguarding threat model for the registered players, seasons, import and export, and audit work, together with the executable security test plan that proves the designed mitigations. It has two halves: a threat catalogue, and a test plan mapped to the delivery phases in docs/roadmaps/registered-players-delivery-plan.md. The exact policy text, schema and RPC contracts it references are specified in docs/security/registered-players-boundary.md (players domain), docs/security/app-audit-boundary.md (audit append only mechanics), docs/adr/ADR-0006-app-audit-events.md, docs/adr/ADR-0007-player-import-export-architecture.md and docs/product/registered-players-import-export.md (formats and limits). This document does not restate those contracts; it names the mechanism each threat relies on and proves it with a test.

Statements below are one of three kinds and are labelled where the context does not make it obvious: confirmed current behaviour (cited to a file and object), proposed product defaults (the designed mitigations), and unresolved decisions requiring approval (listed in Unresolved items).

---

## Confirmed current state

### The player data boundary today

- `players` is the only table naming children and the only content table whose select is gated: policy `players_select_coach` requires `club_id = public.my_club() and public.has_perm('sessions.create')`, and the single write policy `players_manage_coach` carries the same condition in both arms (supabase/migrations/0021_players.sql:99-115). Parents read zero rows.
- The 0021 header comment claims the insert with check pins `created_by` to the writer; the actual clause does not contain `created_by = auth.uid()` (confirmed mismatch, 0021_players.sql:106-115). The new policies must pin it explicitly.
- `players.team_id` is `on delete cascade` (0021_players.sql:75): deleting a team silently hard deletes that team's roster rows today, while the AdminTeams confirm copy says "No sessions or people are removed" (src/routes/AdminTeams.tsx:43-47). `players.created_by` is also `on delete cascade` (0021_players.sql:78), so removing the curating coach deletes the players they created. Both are confirmed hazards the new schema fixes.
- Board tokens persist at most `{id, number, side, x, y, playerId}`, enforced for every writer including the service role by the check constraint `boards_tokens_minimal_shape` (supabase/migrations/0028_board_player_boundary.sql:209-211). Names resolve at render time through the gated players select; parents see numbered discs only.
- The Spond roster import runs as the caller over RLS (anon key plus forwarded JWT, no service role), gates on `has_perm('sessions.create')` before contacting Spond, reduces each member to exactly `{display_name, shirt_number}` (`reduceMember`, supabase/functions/_shared/spond.ts:370-374), dedupes case insensitively on `(club_id, team_id, display_name)` in memory, and logs status codes and counts only (supabase/functions/spond-roster-import/index.ts). The reduction allow list is pinned by supabase/functions/_shared/spond_roster_test.ts, which asserts the reduced JSON contains no guardian, email or phone markers.
- The route guard renders a full screen Splash while capabilities load and never transiently renders a gated screen (src/components/RequireCap.tsx:35-38). The parent no transient read requirement is already the established pattern.
- No audit or history mechanism, no seasons concept, no registration status and no CSV or XLSX dependency exist anywhere in the schema or the app (confirmed by absence across supabase/migrations and package.json runtime dependencies).

### The security harness today

- Tests live in `tests/security/` under a dedicated vitest config; the suite runs only against a local stack: `assertLocal` refuses any non localhost URL (tests/security/stack.ts:84-93). The service role client is for fixture setup and out of band verification only, never the subject of an assertion (docs/security/policy-test-matrix.md).
- Five fixture users: `admin`, `coachOne`, `coachTwo`, `parent` (all club A) and `outsider` (a coach in club B), provisioned through the real invite path (`handle_new_user` then `grant_club_membership`) so the fixtures exercise production provisioning (tests/security/stack.ts:29-69, tests/security/global-setup.ts).
- Refusal conventions (tests/security/stack.ts:177-203): a blocked INSERT raises `42501`; blocked UPDATE and DELETE are silently filtered by RLS and affect zero rows; triggers raise `P0001` (asserted by message part); check constraints raise `23514` and refuse every caller, service role included.
- `tests/security/capabilities.test.ts` pins `EXPECTED_CATALOGUE` to exactly the 13 seeded capability keys and scans `src/` with `CAPABILITY_PATTERN = /\b(?:drills|media|templates|programmes|sessions|teams|users|club)\.(?:create|manage)\b/g` (capabilities.test.ts:24, 48). Any `players.*`, `seasons.*` or `audit.*` key is invisible to the scan and breaks the catalogue equality until both the pin and the regex are extended in the same change.
- The security suite is not wired into CI: `.github/workflows/ci.yml` runs `npm test` only, and docs/security/policy-test-matrix.md records the follow up requirement to add a workflow job running `npx supabase start`, `npx supabase db reset`, then `npm run test:security` (policy-test-matrix.md:155-162). PR 1 must close this gap or every later phase's security tests fail to gate anything.
- `tests/security/players.test.ts` proves seven cells against today's contract. Confirmed gaps: no anon client cell against `players` directly, no cross club insert attempt, no team scoping cells (read is club wide for capability holders today).

---

## Proposal

### Part one: threat catalogue

Each entry names the threat actor, the vector, the designed mitigation (the exact mechanism from the sibling documents) and the residual risk. Threats T1 to T17 are the mandated list; T18 onward come from the wider privacy review.

**T1. Parent reads players.**
- Actor: a member holding only the parent system role, or a quarantined self signup.
- Vector: direct PostgREST select on `players` or `player_registrations`; a transient UI render before capabilities resolve; resolving a board token `playerId` into a name.
- Mitigation: the select policies require `club_id = my_club() and has_perm('players.view')` (registrations additionally carry the team scope arm; identity rows require a visible registration), and the parent system role holds none of the seven new capabilities. RequireCap renders a Splash until capabilities resolve, so no transient read exists (src/components/RequireCap.tsx:35-38). Board tokens carry no names (`boards_tokens_minimal_shape`, 0028). Exact policy text: docs/security/registered-players-boundary.md.
- Residual risk: none material. A UI regression can mis-hide or mis-show affordances but never grants; Postgres answers zero rows regardless.

**T2. Coach exports without permission.**
- Actor: a coach holding `players.view` only (the recommended default seed).
- Vector: calling the `export_players(p_season_id, p_filters)` RPC directly, bypassing the hidden UI affordance.
- Mitigation: the RPC re-checks `has_perm('players.export')` server side, applies the team scope to the returned rows, and writes the `players.exported` audit event in the same transaction as the read. `players.export` is a separate capability from `players.import` because the risks differ (export exfiltrates names; import mutates records).
- Residual risk: a member with legitimate read access can always transcribe or photograph rows on screen. Export control governs the bulk, audited path, not screen capture; that residual is inherent and accepted.

**T3. Cross club player id import.**
- Actor: an authenticated member of another club, or a hostile file author whose file a club manager uploads.
- Vector: import rows carrying `Player ID` uuids belonging to another club, attempting a cross club update.
- Mitigation: `import_players(p_batch_id, p_season_id, p_rows)` validates every row independently; a player id must belong to the caller's club (derived from `my_club()`, never the payload). Any row failing server validation aborts the whole transaction. The row error says the id is unknown; it never confirms whether the id exists elsewhere.
- Residual risk: none identified. The server is not bound by the client preview.

**T4. Forged audit actor.**
- Actor: any authenticated member; a compromised or modified client.
- Vector: supplying `actor_id`, `actor_name`, `occurred_at` or `source` in any write, or calling an audit writer directly.
- Mitigation: table grants on `audit_events` to `authenticated` are SELECT only, with no insert, update or delete policies. Rows are written by AFTER row triggers that read `auth.uid()` server side, resolve `actor_name` from `profiles` at write time and stamp `occurred_at = now()`; `source` and `batch_id` come from transaction local GUCs (`otj.audit_source`, `otj.audit_batch`) set only inside the definer RPCs. The out of band writer `log_audit_event(...)` is SECURITY DEFINER with EXECUTE revoked from public, anon and authenticated (the 0028 revoke pattern). Trigger and writer functions use `set search_path = ''` with schema qualified names (the Foundation convention of 0028 and 0029). No client supplied identity field is ever trusted.
- Residual risk: the service role and the database owner can write anything (standard Postgres). The service role key never reaches a client and lives only in Edge Function secrets; that operational boundary is the mitigation.

**T5. Malicious XLSX.**
- Actor: a hostile file author, including someone outside the club emailing a "roster file" to a manager.
- Vector: a crafted workbook (zip bomb, macro payload, external link parts, encrypted content) selected on the import screen.
- Mitigation: parsing happens in the browser, in the uploading manager's own session with their own privileges (ADR-0007). Defensive caps apply before parse: 2 MB file size for XLSX (1 MB CSV), then 500 data rows and 30 columns. Rejected outright: `.xls`, `.xlsm`, macro content, password protected or encrypted workbooks, external link parts, wrong MIME. SheetJS parsing evaluates no formulas; a formula arrives as an inert string and is treated as an invalid cell value. The server re-validates every row in `import_players` regardless of what the client parsed.
- Residual risk: a parser exploit could compromise the uploader's own browser tab only; there is no server parsing surface. Keeping the parsing dependency current is an implementation PR responsibility (no dependency is added by this scoping work).

**T6. Formula injection.**
- Actor: anyone who can author a value that later appears in an export (a display name beginning with `=`, `+`, `-` or `@` is possible within the 40 character bound).
- Vector: an exported CSV or XLSX opened in Excel executes a cell as a formula.
- Mitigation: any cell whose first character is `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote in CSV output and written as an explicit text cell (type never formula) in XLSX. Import strips exactly one leading apostrophe when followed by `=`, `+`, `-` or `@` so round trips are stable. Both behaviours are specified in docs/product/registered-players-import-export.md.
- Residual risk: spreadsheets assembled outside the app from screen content are out of scope.

**T7. Duplicate import.**
- Actor: a legitimate manager, by accident (double click, two tabs, replayed request).
- Vector: the commit RPC applied twice.
- Mitigation: the client generates a uuid v4 batch id at preview; `import_batches` holds it unique, and a repeated `import_players` call with the same batch id returns the stored result without re-applying. The confirm modal is locked while committing (X, Escape, overlay and Cancel disabled, controls frozen), which requires the new locked Modal mode specified in docs/product/registered-players-ux.md.
- Residual risk: a re-import under a fresh batch id degrades safely through the matching rules (exact normalised name plus season plus team is "already present"; Player ID matches update in place with the same values).

**T8. Lost response retry.**
- Actor: a legitimate manager on a failing network.
- Vector: the commit succeeds server side but the response is lost; the user retries.
- Mitigation: retrying with the same batch id is the designed recovery: the RPC finds the recorded batch and returns the stored outcome without touching a row. Safe after any ambiguous failure.
- Residual risk: a retry the client issues under a new batch id relies on the matching rules (see T7). A new row without a Player ID retried into a different team context could insert twice; the preview surfaces it as a possible duplicate warning on the next import.

**T9. Partial import.**
- Actor: none (failure mode).
- Vector: some rows applied and others not, leaving unexplained state and a misleading audit trail.
- Mitigation: the commit is one transactional SECURITY DEFINER RPC. Rows the preview marked invalid are never sent; any row failing server validation aborts the whole transaction (all or nothing, an APPROVAL REQUIRED default). Per row audit events and the batch summary commit in the same transaction, so a rolled back import leaves no audit claim of success.
- Residual risk: none by design. The skip and report alternative is documented under Alternatives.

**T10. Stale preview.**
- Actor: a legitimate manager; time passes between preview and confirm.
- Vector: club data changes after the preview (players deleted, teams changed, registrations updated) so the previewed plan no longer matches reality.
- Mitigation: the server is never bound by the client preview. `import_players` re-validates every row at commit: name bounds, status vocabulary, shirt bounds, date format, team ids re-verified within the club, player id ownership, season validity. A mismatch aborts with a structured error telling the user to re-run the preview.
- Residual risk: benign field races (someone else changed a shirt number in the window) resolve last write wins; the audit trail records both changes.

**T11. Permission revocation between preview and commit.**
- Actor: a manager demoted after loading the preview.
- Vector: pressing Confirm with a capability that no longer exists.
- Mitigation: preview writes nothing (selecting a file never writes), and `import_players` re-checks `has_perm('players.import')` at execution time. The revoked caller receives a refusal and the transaction never starts.
- Residual risk: none identified.

**T12. Team deleted during import.**
- Actor: an admin deleting a team concurrently; accidental.
- Vector: the preview resolved a team name to an id; the team row is gone at commit.
- Mitigation: the RPC re-verifies every team id within the club at commit and aborts on an unknown id. Structurally, `player_registrations.team_id` is nullable with `on delete set null`, so a team deleted after commit turns its registrations Unassigned instead of deleting children's rows (fixing the confirmed 0021 cascade hazard; the wrong AdminTeams copy is flagged in docs/product/registered-players-spec.md).
- Residual risk: registrations made Unassigned by a team deletion are visible only to all_teams holders under the recommended scope default; a coach may perceive players as vanished until reassignment. Documented behaviour.

**T13. Season archived during import.**
- Actor: an admin archiving or activating seasons concurrently.
- Vector: the selected season gains `archived_at` between preview and commit.
- Mitigation: the RPC validates the season exists, belongs to the club and is not archived at commit time, and the registration write policies and trigger refuse writes into archived seasons at the database (the archived read only rule of docs/adr/ADR-0005-registered-players-and-seasons.md). No code path bypasses it.
- Residual risk: none; the user re-imports into the current season.

**T14. Guessed import batch id.**
- Actor: another authenticated member, same or another club.
- Vector: calling `import_players` with someone else's batch id to read a stored result, or pre-registering a batch id to poison a future import.
- Mitigation: batch ids are uuid v4 (unguessable in practice) and unique in `import_batches`, which records actor and club. The stored result replay answers only a caller the boundary contract permits (same club, `players.import`; exact semantics in docs/security/registered-players-boundary.md); a batch id recorded for another club is a refusal, never a replay. The stored result carries counts, outcome and the sha256 file fingerprint only, never row content or names, so even a permitted replay reveals no child data.
- Residual risk: negligible (uuid collision probability).

**T15. Audit tampering.**
- Actor: any authenticated member, admins included; a compromised client.
- Vector: updating or deleting `audit_events` rows to rewrite history; inserting fabricated events; reading another club's trail.
- Mitigation: append only by grants and policies: `authenticated` holds SELECT only, there are no insert, update or delete policies, and the select policy is `club_id = my_club() and has_perm('audit.view')`. Writes exist only through the AFTER row triggers and the EXECUTE revoked definer writer. `set search_path = ''` with qualified names closes search path substitution. Full mechanics: docs/security/app-audit-boundary.md.
- Residual risk: service role and database owner access can still alter rows; see T4. Audit is evidence for the club, not a cryptographic ledger.

**T16. Audit leaking deleted player names.**
- Actor: an `audit.view` holder reading history after a child's data was deleted.
- Vector: audit rows carrying names that outlive the deletion path.
- Mitigation: audit rows never contain player names by construction. `safe_changes` holds old and new values only for the approved safe field list (team_id, status, shirt_number, registered_date, season_id); a display name change records `changed_fields = ['display_name']` with no values, rendered as "Player name corrected". `player.deleted` is written before the row deletion in the same transaction and retains the entity id only; the UI shows a neutral "Deleted player" tombstone. Metadata is restricted to safe scalar facts (counts, format, filter summary).
- Residual risk: pseudonymous history (team, status and date changes keyed to an entity id) persists after deletion. It names nobody and is accepted under the retention default (Unresolved items 7 and 8).

**T17. Spond import returning unexpected fields.**
- Actor: a Spond API change, or an unexpected upstream response.
- Vector: the `groups/` response carrying extra member fields, nested guardian data or oversized arrays into the roster import.
- Mitigation: persistence is shaped by the allow list, not by the payload: `reduceMember` returns exactly `{display_name, shirt_number}` and discards everything else (supabase/functions/_shared/spond.ts:370-374, pinned by spond_roster_test.ts), names clamp to 40 characters, selection caps at 200 members per mapping, and the function logs status codes and counts only. The season aware revision keeps this reduction path unchanged, moves the gate to `has_perm('players.import')`, chooses the season server side (the club's current season, refusing when none exists) and writes registrations as status pending with a batch id and `players.spond_imported` audit events (source `spond_import`).
- Residual risk: upstream schema drift can break the import (it fails with an error or a warning), but it cannot widen what is persisted.

**T18. Insider misuse.**
- Actor: a legitimate capability holder using authorised access beyond the club's operational purpose (bulk export for private use, idle browsing of children's records).
- Vector: authorised reads and exports.
- Mitigation: capability minimisation is the primary control: parents hold nothing, coaches default to `players.view` on assigned teams only, export and import sit with managers and admins and remain separately grantable. Every export writes a `players.exported` audit event (count, format, season, safe filter summary) in the same transaction as the read, the export confirmation states that the file names children and must be stored and shared securely, and `audit.view` lets the club review who exported what and when.
- Residual risk: audit is detective, not preventive. A determined authorised insider can copy what they can read. The control is who the club grants export to; that is a club owner decision.

**T19. Accidental bulk change.**
- Actor: a legitimate manager, by mistake.
- Vector: importing the wrong file (typically last season's export), or a wrong bulk action.
- Mitigation: the Season column cross check makes a non empty Season cell that mismatches the selected season a row error, which under all or nothing blocks last season's file outright. The two stage flow shows counts by outcome class before anything is written; missing rows never withdraw or delete anyone (a file only adds and updates; mass withdrawal is explicitly out of scope); bulk actions are limited to assign team and withdraw selected under `players.manage` with confirmation; Withdraw keeps team and shirt number and is reversible by Restore.
- Residual risk: wrongly added or updated rows need manual correction or a corrective re-import; the batch id groups every row event so the blast radius is reviewable on the Activity page.

**T20. Guessed player or registration id.**
- Actor: a parent or outsider holding a leaked uuid, most plausibly a board token `playerId`, which parents can read by design (0028).
- Vector: select or update by primary key.
- Mitigation: knowing an id grants nothing. The select policies return zero rows without `players.view` whatever the filter; writes additionally require `players.manage` within club and scope. This is the same property boards.test.ts already proves for today's tokens.
- Residual risk: none material.

**T21. Exported spreadsheet mishandled on a local device.**
- Actor: an authorised exporter; a lost or shared device; automatic cloud sync of a downloads folder.
- Vector: the exported file contains children's names and lives outside the platform's control.
- Mitigation: the platform minimises what leaves: exports contain the eight documented columns only (no creator ids, no audit metadata, no hidden columns or sheets), the filename carries no player data, the dataset is never stored server side, the rejected row report is generated client side and never uploaded, and the confirmation dialog states the handling expectation. The audit event records that the export happened.
- Residual risk: the file's fate is a club governance matter, not a platform control. Stated plainly rather than pretended away.

**T22. Backup and restore reintroducing deleted child data.**
- Actor: an operator restoring a database backup.
- Vector: a restore resurrects deleted players, registrations and pre tombstone audit rows.
- Mitigation: process control per the 0028 precedent (documented restore points, forward only migrations, no destructive down migrations for child data). After any restore, deletion requests actioned since the backup must be re-applied; the delivery plan's rollback sections carry this step.
- Residual risk: inherent to backups. Backup retention on hosted Supabase follows the platform's schedule (assumption: not controlled by this repo).

### Part two: security test plan

The plan follows the existing harness conventions without exception: local stack only (`assertLocal`, tests/security/stack.ts:84-93), the five fixture users, real JWTs over PostgREST, service role for fixtures and out of band verification only, refusal codes 42501 (blocked insert), zero rows (blocked update and delete), P0001 (trigger, asserted by message part) and 23514 (check constraint, refusing every caller). Two additions the new tables introduce: 23505 (unique violation) for the batch id and the one current season index, and 42501 as the refusal shape for update and delete on `audit_events`, because its grants are SELECT only so the refusal happens at the grant, not as RLS zero rows. Synthetic names only, never real children, per the players.test.ts convention.

#### Harness extensions (all land in PR 1 unless stated)

1. CI wiring. PR 1 adds the workflow job policy-test-matrix.md:155-162 already specifies (`npx supabase start`, `npx supabase db reset`, `npm run test:security`) and gates merges on it once stable. Without this, no later phase's security tests gate anything. This is a PR 1 acceptance criterion.
2. Capability tripwire. `EXPECTED_CATALOGUE` grows from 13 to 20 keys (`players.view`, `players.manage`, `players.import`, `players.export`, `players.delete`, `seasons.manage`, `audit.view`) and `CAPABILITY_PATTERN` (capabilities.test.ts:48) is extended to cover the `players`, `seasons` and `audit` prefixes and the `view`, `import`, `export` and `delete` suffixes, in the same change as the catalogue migration. New default grant cells: admin holds all seven, manager holds five (not `players.delete`, not `seasons.manage`), coach holds `players.view` only, parent holds none; the reserved capability trigger cells stay untouched (the new keys are grantable to custom roles).
3. Fixtures. Add a `manager` fixture user (club A, manager system role, `all_teams` true) for export and import capability cells. Give `coachOne` a `member_teams` row on `TEST_TEAM`; leave `coachTwo` without one as the out of scope foil, making the team scope arms (and `member_teams` as newly load bearing data) directly testable. Extend the signup.test.ts quarantined read loop to include `player_registrations`, `seasons`, `audit_events` and `import_batches`.
4. Matrix doc. Each new table gets a contract row in docs/security/policy-test-matrix.md and a `tests/security/<table>.test.ts` following the established per table structure, header citing its migration (provisional numbers 0030 onward; the live ledger must be confirmed at apply time).

Out of harness scope, per the documented limitations in policy-test-matrix.md: Edge Functions do not run on the local stack, so Spond gate changes are proven by the deno tests beside the function; pure client behaviour (parsers, file builders, board picker eligibility) is proven by colocated vitest unit tests, following the tested pure builder precedent of src/lib/ics.ts.

#### The twenty five properties

| # | Property | Proof location | Phase |
|---|---|---|---|
| 1 | Anon cannot read players | tests/security/players.test.ts, tests/security/player-registrations.test.ts (anonClient select: error or zero rows; closes a confirmed gap in today's file) | PR 2 |
| 2 | Parent cannot read players | players.test.ts and player-registrations.test.ts (parent select strictly `[]`, identity and registration) | PR 2 |
| 3 | Parent cannot read audit | tests/security/audit.test.ts (parent select strictly `[]`; coach without `audit.view` also `[]`) | PR 1 |
| 4 | Unauthorised coach cannot export | tests/security/export.test.ts (`coachOne` calls `export_players`, refused; no `players.exported` row written) | PR 4 |
| 5 | Unauthorised coach cannot import | tests/security/import.test.ts (`coachOne` calls `import_players`, refused, zero rows, no batch row); Spond arm: deno tests pin the `players.import` gate | PR 5; PR 6 |
| 6 | Cross club reads fail | outsider cells in audit.test.ts (PR 1), players.test.ts, player-registrations.test.ts, seasons.test.ts (PR 2) | PR 1, PR 2 |
| 7 | Cross club player ids fail in imports | import.test.ts (row carrying a club B player id fixture: whole transaction refused, zero changes) | PR 5 |
| 8 | Client club id ignored or rejected | player-registrations.test.ts (insert naming club B: 42501); import.test.ts (rows carry no club field; written rows assert the caller's club via `my_club()`) | PR 2, PR 5 |
| 9 | Client actor id ignored or rejected | player-registrations.test.ts (insert with foreign `created_by`: 42501, the with check pins `created_by = auth.uid()`, fixing the 0021 comment mismatch); audit rows offer no writable actor field at all | PR 2 |
| 10 | Audit rows not directly insertable, changeable or deletable | audit.test.ts (insert 42501 for admin, coach, parent, outsider; update and delete 42501 as grant refusals, SELECT only grants; `log_audit_event` rpc 42501 EXECUTE refusal, the boards.test.ts revoked function precedent) | PR 1 |
| 11 | Audit actor and timestamp server derived | audit.test.ts (a `coachOne` registration write yields a row whose `actor_id` equals the JWT user id, `actor_name` equals the fixture profile name, `occurred_at` inside the test window; no supplied value can influence any of them) | PR 2 |
| 12 | Successful change writes exactly one audit event | audit.test.ts with player-registrations.test.ts fixtures (one status transition, exactly one `player.status_changed` row, out of band count) | PR 2 |
| 13 | Failed change writes no success event | audit.test.ts (an RLS refused write and a trigger refused archived season write each leave the audit count unchanged; a rolled back import leaves no per row events, see 14) | PR 2, PR 5 |
| 14 | Import transaction and audit commit together | import.test.ts (happy path: data rows, per row events and the batch summary all present, sharing one `batch_id`; poisoned row: none of the three present) | PR 5 |
| 15 | Duplicate confirmation causes no duplicates | import.test.ts (second `import_players` call with the same `p_batch_id` returns the stored result; row and audit counts unchanged) | PR 5 |
| 16 | Lost response plus retry is idempotent | import.test.ts (same mechanics as 15: a retry after a committed first call is the executable proxy for a lost response) | PR 5 |
| 17 | File formulas are not evaluated | parser unit tests (a `=SUM(A1)` cell parses to an inert string classed invalid); import.test.ts server arm (a formula shaped display_name in `p_rows` is refused as invalid, never evaluated) | PR 5 |
| 18 | Export formula injection escaped | builder unit tests (cells starting `=`, `+`, `-`, `@`, tab, CR quoted in CSV and written as text cells in XLSX; round trip apostrophe rule); export.test.ts proves the RPC side for a fixture named `=SEC TEST...` | PR 4 |
| 19 | Unknown teams are safe | import.test.ts (unknown team uuid aborts the transaction; blank team lands `team_id` null, Unassigned) | PR 5 |
| 20 | Archived seasons unchangeable without permission | tests/security/seasons.test.ts (registration write into an archived season refused by trigger, P0001 message part; unarchive requires `seasons.manage`, coach refused) | PR 2 |
| 21 | One current season per club | seasons.test.ts (second `is_current` row refused 23505 by the partial unique index even via serviceClient, the below RLS boundary; `activate_season` as admin swaps atomically leaving exactly one; coach call refused) | PR 2 |
| 22 | Withdrawn excluded from default board selection | board picker eligibility unit tests (current season, status registered, selected team only; pending only via the explicit toggle; withdrawn never; Unassigned only when explicitly selected) | PR 3 |
| 23 | Deletion does not expose or corrupt boards | tests/security/boards.test.ts extension (delete a fixture identity: board row unchanged, tokens still satisfy `boards_tokens_minimal_shape`, parent resolution still `[]`, coach resolution falls back to number) | PR 2 |
| 24 | Audit club scoped | audit.test.ts (outsider granted `audit.view` on club B in global setup still reads zero club A rows) | PR 1 |
| 25 | Profile deletion does not break audit display or leak | audit.test.ts (disposable coach performs an audited write, `auth.admin.deleteUser` removes them; the row survives with `actor_id` null and the `actor_name` snapshot intact; no child name anywhere in the row) | PR 2 |

#### Per file specifications

**tests/security/audit.test.ts** (new in PR 1, extended in PR 2 and PR 8). PR 1 cells: select matrix (admin with `audit.view` reads club rows; parent, capability-less coach, anon and outsider read zero; outsider with club B `audit.view` reads zero club A rows); write matrix (insert 42501 for every JWT; update and delete 42501, grant level, a documented deviation from the zero rows convention because the table carries SELECT only grants; `log_audit_event` EXECUTE refusal 42501 for coach and parent). PR 2 cells: properties 11, 12, 13 and 25 above, plus a name discipline cell: rename a fixture player and assert the event has `changed_fields = ['display_name']` and no name value in `safe_changes` or `metadata` (string containment check over the row JSON, the boards.test.ts payload technique). PR 8 adds one success event cell per newly audited entity family.

**tests/security/seasons.test.ts** (PR 2). Write matrix (create, update, archive require `seasons.manage`: admin passes, manager, coach and parent refused 42501); properties 20 and 21; `activate_season` writes exactly one `season.activated` event; date order check constraint 23514 via serviceClient. The seasons read policy follows docs/security/registered-players-boundary.md; the file pins whatever that contract says with one cell per role.

**tests/security/players.test.ts** (rewritten in PR 2). The existing seven cells re-pointed at the new contract: read requires `players.view` (parent still `[]`, outsider still `[]`), writes require `players.manage`, insert pins `created_by = auth.uid()`. New cells for the scope arms: `coachOne` (member of `TEST_TEAM`) reads identities with a visible registration; `coachTwo` (no team) reads zero including by direct id; admin and manager (`all_teams`) read all including Unassigned. The header cites the provisional migrations (0030 onward, live ledger confirmed at apply time) and the standing rule change for the players domain.

**tests/security/player-registrations.test.ts** (new in PR 2). Full role by operation matrix under the D4 scope; forged `club_id` and forged `created_by` inserts (properties 8 and 9); status vocabulary check constraint 23514; `UNIQUE (player_id, season_id)` 23505; team deletion turns `team_id` null without deleting the row (the cascade fix, service role fixture); curator profile deletion leaves rows with `created_by` null (the remove-user fix); status transition rules refused server side (a disallowed transition raises P0001).

**tests/security/export.test.ts** (PR 4). Properties 4 and the RPC side of 18; manager export returns only scope filtered rows; exactly one `players.exported` event per call, in the same transaction, carrying count, format and season and no names; parent and outsider refused.

**tests/security/import.test.ts** (PR 5). Properties 5, 7, 8, 13 (import arm), 14, 15, 16, 17 (server arm), 19; season validation (archived or foreign season refused); permission revocation cell (serviceClient removes `players.import` from the fixture role between calls, next call refused, T11); batch id cross club replay refused (T14); `import_batches` readable only per the boundary contract.

**Unit test files** (colocated, run by `npm test`, so they gate in CI today): the CSV and XLSX parser tests (caps, rejects, formula inertness), the export builder tests (escaping, column order, filename shape) and the board picker eligibility tests (property 22). Indicative names: `src/lib/importPlayers.test.ts`, `src/lib/exportPlayers.test.ts`, extensions to `src/lib/tacticsBoard.test.ts`; final names follow the implementation files.

**Deno tests** (PR 6): `supabase/functions/_shared/spond_roster_test.ts` extended to pin the `players.import` gate, the server chosen current season, status pending, dedupe within (club, season, team), the unchanged `{display_name, shirt_number}` reduction and counts only logging.

#### Phase map

| Phase | Security test deliverables |
|---|---|
| PR 1 | audit.test.ts (properties 3, 10, 24; 6 audit arm); capabilities.test.ts catalogue and regex extension; CI wiring for `test:security`; matrix doc rows |
| PR 2 | seasons.test.ts (20, 21); player-registrations.test.ts (1, 2, 6, 8, 9); players.test.ts rewrite; audit.test.ts extensions (11, 12, 13, 25); boards.test.ts extension (23); signup loop extension |
| PR 3 | board picker eligibility unit tests (22); no new database boundary |
| PR 4 | export.test.ts (4, 18); export builder unit tests |
| PR 5 | import.test.ts (5, 7, 8, 13, 14, 15, 16, 17, 19); parser unit tests |
| PR 6 | deno tests for the season aware Spond import (5 Spond arm; T17 pins re-asserted) |
| PR 7 | no new boundary: the Activity page reads through the PR 1 audit select cells; deep link resolution is unit tested |
| PR 8 | audit.test.ts one cell per newly audited entity family |

---

## Alternatives

- Server side spreadsheet parsing (Edge Function or Storage upload plus processing): rejected in docs/adr/ADR-0007-player-import-export-architecture.md as a larger attack surface (service role adjacency, upload plumbing, retained files) for no boundary gain; the browser parser attacks only its own uploader.
- Skip and report partial commit instead of all or nothing: rejected as the default because partial imports are exactly the confusing state the two stage flow exists to prevent; carried as APPROVAL REQUIRED.
- A player only history table instead of the generic append only `audit_events`: rejected in docs/adr/ADR-0006-app-audit-events.md; it would later compete with a global audit and duplicate the append only mechanics.
- Relying on UI filters for coach team scope: rejected; access is never a view filter. If team scoped reads are approved they are RLS arms, specified exactly in docs/security/registered-players-boundary.md.
- Trusting the client preview at commit: rejected; the server re-validates every row, which is what makes T3, T10, T11, T12 and T13 closable.

## Decision

Adopt this catalogue and test plan as the review checklist for the whole programme. Every implementation PR ships the cells the phase map assigns it, green in CI, before merge; the security suite enters CI in PR 1. A threat listed here without its mapped test passing is an open finding, not a documented risk. All schema, policy and RPC mechanics referenced here are decided in the sibling documents; this document decides only that these threats are the set to defend against and these tests are the proof.

## Consequences

- The security suite grows from one players file (seven cells) to five new files plus extensions, on the order of sixty new cells, and its runtime joins CI (Docker pulls for `supabase start`; the matrix doc's caution about reliability before making the job a required check applies).
- The capability catalogue pin and regex become a forcing function again: PR 1 cannot land without extending both, which is the designed behaviour.
- The first team scoped RLS in the app (players domain only, a deliberate change to the 0016 standing rule) is covered by explicit cells, and `member_teams` plus `all_teams` become access relevant and tested for the first time; their write policies already require `users.manage` (0016), so the escalation path is closed and stays pinned.
- Two confirmed data loss hazards (team deletion cascading roster rows; coach removal cascading curated players) become regression tested fixes rather than folklore.
- The audit table's SELECT only grant model introduces one documented deviation from the zero rows refusal convention, recorded in the matrix doc so future authors do not "fix" it back.

## Unresolved items

The following decisions from the canonical list require approval and materially shape threats or tests in this document. Recommended defaults shown; each is written up with alternatives in the named sibling document.

1. Identity split (stable `players` identity plus seasonal `player_registrations`): recommended, split (docs/adr/ADR-0005-registered-players-and-seasons.md). Shapes T12, T16, T20 and property 23.
2. Coach team scope, including the standing rule change for the players domain: recommended, assigned teams only (docs/security/registered-players-boundary.md). Shapes T1, T18 and the players and registrations matrices.
3. Coach access reduction from today's `sessions.create` powers: recommended, reduce to `players.view`. Shapes properties 4 and 5; the continuity fallback seed changes those cells' expectations.
4. Export capability holders: recommended, managers and admins.
5. Separate `players.import` and `players.export` capabilities: recommended, yes.
6. Spond default registration status: recommended, pending (docs/product/registered-players-import-export.md).
7. Historic name retention in audit: recommended, no values recorded (T16).
8. Audit retention: recommended, indefinite at current scale, reviewed annually; no legal period claimed (T16, T22).
9. Permanent deletion versus anonymisation: recommended, true deletion, admin only via `players.delete` (T16, property 23).
10. Renewal mechanism: recommended, bulk Renew to pending with team and shirt carried forward (affects idempotency and audit source cells).
11. Pending players on boards via explicit toggle: recommended, yes (property 22).
12. Browser versus server XLSX parsing: recommended, browser (T5).
13. RPC versus Edge Function commit: recommended, transactional RPC (T7, T8, T9, T14).
14. Archived season absoluteness: recommended, read only with an audited unarchive escape hatch (T13, property 20).
15. `audit.view` versus a separate per player history path: recommended, separate paths (`player_history` gated `players.view` plus scope); adds read cells to audit.test.ts either way.

Also carried as APPROVAL REQUIRED: the all or nothing import commit (T9, property 14) and the default holders of `seasons.manage` (admin only; property 20's role expectations).

## Implementation dependencies

- Sibling contracts this plan tests: docs/security/registered-players-boundary.md (policy arms, RPC signatures, batch replay semantics), docs/security/app-audit-boundary.md (append only mechanics, GUCs, writer revocation), docs/adr/ADR-0005-registered-players-and-seasons.md, docs/adr/ADR-0006-app-audit-events.md, docs/adr/ADR-0007-player-import-export-architecture.md, docs/product/registered-players-import-export.md (formats, limits, template), docs/product/registered-players-ux.md (locked Modal mode for T7; accessibility of refusals), docs/product/registered-players-spec.md (statuses, transitions, bulk actions), docs/roadmaps/registered-players-delivery-plan.md (PR contents and gates).
- Migrations: provisional numbers 0030 onward; the live ledger is the source of truth and the next free number must be confirmed at apply time, never assumed from the files on disk.
- CI: the `test:security` job lands in PR 1 (closing the recorded gap at docs/security/policy-test-matrix.md:155-162) and is a precondition for every later phase's gates.
- Harness: global setup extensions (manager fixture, `member_teams` assignments, club B `audit.view` grant, quarantine loop additions) land with the first file that needs them; `tests/security/local-grants.sql` gains the revoke restatement for `log_audit_event` alongside the existing `board_tokens_without_names` line.
- Dependencies: the XLSX parser is added in its implementation PR only (PR 5); no dependency is added by this scoping work.
- Human gates: every PR named here touches child data RLS, migrations, audit enforcement or spreadsheet processing and is review gated with auto merge prohibited, per the delivery plan.
