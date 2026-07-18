# ADR-0006: App-wide audit events, one generic append-only table

Status: Proposed (draft for review; lands with the provisional 0030 audit foundation migration, number to be confirmed against the live ledger at apply time)
Date: 2026-07-16
Decision owners: Club owner (product); repository maintainer (security and data model)

## Context

The Registered Players work (docs/adr/ADR-0005-registered-players-and-seasons.md) needs trustworthy answers to four questions about every committed change to player and season records: what changed, who changed it, when, and where the change came from (a manual edit, a spreadsheet import, a Spond import, a renewal, a server process). The same questions will eventually apply to user management, teams, Spond configuration and content deletions. This ADR decides the shape of the mechanism that answers them. The full mechanism specification (exact trigger bodies, policies, grants, catalogue and test obligations) lives in docs/security/app-audit-boundary.md; this document records the decision and its reasoning.

The scope constraint set by the task is explicit: the foundation must be generic and app-wide, first integrated with Registered Players, and must not be a player-only history table that later competes with a global audit mechanism.

### Confirmed current state

All of the following is verified against the repository as of 2026-07-16.

- There is no persisted audit, history or activity mechanism anywhere in the schema or the application. A case insensitive search for "audit" across the repository matches only an unrelated comment in `supabase/seed.sql` ("auditable map from the prototype text ids"). No migration creates a log, history or activity table.
- The nearest existing cousins are all current-value bookkeeping, not history. The `feedback` table stores only its current `status`, guarded by the trigger `feedback_guard_status` (`supabase/migrations/0019_feedback.sql`); prior statuses are not retained anywhere, despite UI copy in `src/routes/Feedback.tsx` that refers to "status history". `feedback_comments` carries the schema's only generic `updated_at` trigger (`feedback_comments_touch_updated_at`, `supabase/migrations/0024_feedback_comments.sql`). `spond_events.synced_at` (`supabase/migrations/0013_spond.sql`) records the last sync time only.
- Edge Function run summaries are returned in the HTTP response and never persisted (for example `spond-sync/index.ts` replies with per mapping outcomes and totals). Server side logging is `console.error` with status codes and counts only, per the children's data boundary; `src/` contains no console logging at all. None of this survives as a queryable record.
- Provenance columns today are `created_by` and `created_at` only. No table has an `updated_by` column. `updated_at` exists on just three tables (`feedback`, `boards`, `feedback_comments`), set by application code by convention with the one trigger exception noted above.
- The capability catalogue is exactly thirteen keys, seeded in `supabase/migrations/0012_rbac.sql`, changed only by migration (clients cannot write the `capabilities` table), and pinned by an executable tripwire: `tests/security/capabilities.test.ts` asserts the catalogue equals `EXPECTED_CATALOGUE` and statically scans `src/` for capability strings. Adding audit capabilities requires extending both the pin and the scan regex.
- Established conventions the audit foundation must follow: Foundation era functions use `set search_path = ''` with schema qualified references (`supabase/migrations/0028_board_player_boundary.sql`, `0029_signup_hardening.sql`); privileged functions revoke EXECUTE from `public`, `anon` and `authenticated` and grant it to `service_role` (the `board_tokens_without_names` and `grant_club_membership` pattern); every new table gets explicit grants, and no update grant is issued where no update policy exists (`0015_rbac_roles.sql`, `0016_member_teams.sql`); boundaries become schema (check constraints, triggers, comments persisted with `comment on`), not UI conventions.
- The `players` table (`supabase/migrations/0021_players.sql`) is the only select gated content table (`players_select_coach`, gated on `sessions.create` today) and the only table holding children's names. Any audit design must keep names out of the audit trail entirely, per the boundary restated in `0023_players_fullname.sql` and `0028_board_player_boundary.sql`.
- Scale reality: one club, five teams, roughly 75 to 125 players per season. Expected audit volume is low thousands of events per season. Nothing here needs partitioning or archival machinery on day one.
- The security suite runs only against a local stack and is not yet wired into CI (`docs/security/policy-test-matrix.md` records the gap); the delivery plan closes it in the first implementation PR.

## Proposal

One generic, append-only `audit_events` table, club scoped, written by database triggers in the same transaction as the business change, supplemented by one private SECURITY DEFINER writer function for events that have no row trigger. This is decision D6 of the scoping brief, integrated first with Registered Players and deliberately not a player-only history table.

### Activity events, not row journals

The table records activity events (a committed business action: player created, status changed, season activated, import completed) plus bounded field history for an approved safe field list. It never records complete row images. The distinction matters for children's data: an activity event can say that a display name was corrected without ever storing the old or new name; a row journal cannot.

### The table

Exact field list (types and constraints specified in full in docs/security/app-audit-boundary.md):

| Field | Type and semantics |
|---|---|
| `id` | uuid, primary key |
| `club_id` | uuid, stamped server side from the affected row, never from the client |
| `occurred_at` | timestamptz, server derived (`now()`), never client supplied |
| `actor_id` | uuid nullable, FK `profiles` ON DELETE SET NULL |
| `actor_name` | text snapshot, resolved from `profiles` server side at write time; survives profile deletion |
| `action` | text, from the documented action catalogue |
| `entity_type` | text (for example `player`, `season`, `import_batch`). Registration row events anchor to the stable player identity id, so registration is not an entity type |
| `entity_id` | uuid nullable |
| `season_id` | uuid nullable |
| `team_id` | uuid nullable |
| `source` | text, CHECK constrained to `manual`, `csv_import`, `xlsx_import`, `spond_import`, `renewal`, `system`, `edge_function`, `database_trigger` |
| `changed_fields` | text[], field names only, never values, used for name like fields |
| `safe_changes` | jsonb, old and new values for the approved safe list only: `team_id`, `status`, `shirt_number`, `registered_date`, `season_id` |
| `batch_id` | uuid nullable, links row level events to an import or renewal batch |
| `metadata` | jsonb, safe scalar facts only (counts, format, filter summary) |
| `request_id` | text nullable, correlation id populated only by server side writers |

No row snapshots, ever. No player names in `safe_changes` or `metadata`, ever: a display name change records `changed_fields = ['display_name']` with no values, and the UI renders "Player name corrected".

Assessed and excluded: an actor role or capability snapshot per event. Every audited action is already capability gated at commit time, the product pages have no read use for a per event grants list, and the column can be added later without disturbing anything. Also excluded: request bodies, filenames, file fingerprints (the import batch stores none, because the browser parses the file and the server never receives the bytes, per docs/adr/ADR-0007-player-import-export-architecture.md), tokens and secrets of any kind.

### Same transaction, or no event

The base writers are AFTER row triggers on `players`, `player_registrations` and `seasons`. An AFTER row trigger commits with the business change: a rolled back change rolls back its audit row, a failed action leaves no success event, and no event ever claims completion before the change is committed. The triggers fire for every write path to those tables, including RPCs and service role writes; there is no mutation route that skips them short of superuser DDL, so audit generation cannot be bypassed by choosing a different mutation path.

Events with no underlying row write (the export event `players.exported`, the import batch summaries `players.import_completed` and `players.import_failed`) are written by a private SECURITY DEFINER function `log_audit_event(...)` with EXECUTE revoked from `public`, `anon` and `authenticated` (the `0028` revoke pattern), callable only from other definer RPCs and the service role. The export RPC writes `players.exported` in the same transaction as the read it audits. A failed import commits no player rows and no success event; its only committed trace is the batch record (moved to state `failed`) and the `players.import_failed` summary, written by the outer function after an inner PL/pgSQL exception subtransaction has rolled back every business change and per row event (the failure bookkeeping is fixed, not deferred, in docs/adr/ADR-0007-player-import-export-architecture.md).

### Source context: the GUC mechanism and its failure default

Row triggers know what changed but not which business flow caused it. The import, renewal and Spond flows therefore set two transaction local GUCs before writing rows: `set_config('otj.audit_source', ...)` and `set_config('otj.audit_batch', ...)`, set only inside trusted definer RPCs, never accepted from the client. The trigger reads them when present.

The failure default is precise and fails safe:

- If `otj.audit_source` is set, its value is recorded, subject to the CHECK constraint on `source`.
- If it is unset and `auth.uid()` is non null, the write is a direct authenticated mutation through row level security (an Add player modal save, an inline edit) and the trigger records `source = 'manual'`.
- If it is unset and `auth.uid()` is null (a migration backfill, service role maintenance), the trigger records `source = 'database_trigger'`.

A value outside the vocabulary fails the CHECK constraint and aborts the whole transaction, so a mislabelled write never commits. The GUC is context, not a security control: browser clients have no path to set `otj.*` settings (PostgREST exposes no arbitrary SQL, and no exposed function forwards a client supplied source), and even a hypothetically forged source could only mislabel the channel, never the actor, club or timestamp, which are always server derived.

### Forge resistance and append-only enforcement

- Table grants to `authenticated` are SELECT only. There are no insert, update or delete policies for `authenticated` at all, so audit rows are immutable through the app by construction, matching the repository rule that no update grant exists without an update policy.
- `actor_id` is `auth.uid()` read server side; `actor_name` is resolved from `profiles` server side; `occurred_at` is `now()`; `club_id` comes from the affected row. No client supplied identity field is ever trusted, so an event cannot be written as someone else.
- Trigger and writer functions are SECURITY DEFINER with `set search_path = ''` and schema qualified references (the Foundation convention from `0028` and `0029`), so no caller controlled search path can redirect a reference. `safe_changes` is computed from an explicit column allow list, never `row_to_json`, so a future column addition cannot silently leak values into the trail.
- Actor profile deletion is safe: the FK sets `actor_id` null and the `actor_name` snapshot keeps the record legible. This is adult operational data, retained for accountability.

### Club scoping and read paths

The select policy is `club_id = my_club() AND has_perm('audit.view')`. `audit.view` is a new capability catalogue row (part of the D3 catalogue growth from thirteen to twenty keys), granted by default to admin and manager, never to parent. Cross club reads fail on the club arm exactly as every other club scoped table does.

Per player history is a separate read path but gated the same way: an RPC or view `player_history(player_id)` requires `audit.view`, not `players.view` (docs/security/registered-players-boundary.md), so a coach holding only `players.view` does not see a player's history by default. A child linked history row is pseudonymous child personal data, so this gate is a real access control, and requiring `audit.view` keeps historical child linked audit records off the coach surface by default; managers and admins, who hold `audit.view`, do see per player history. The trade-off (coaches do not get per player history by default) is accepted for safety. The per player History UI is deferred and not built in PR 2; only this gated database read path exists. The club-wide Activity page also requires `audit.view`. Product behaviour for both surfaces is specified in docs/product/registered-players-spec.md and docs/product/registered-players-ux.md.

### Action catalogue and what is never logged

The initial catalogue covers Registered Players and seasons, with distinct business actions so the Activity feed reads accurately from the action alone: `player.created` (a new stable identity), `player.registration_created` (a registration added for a season), `player.renewed` (a registration created by the bulk renewal path), `player.updated` (identity, the display name correction), `player.registration_updated`, `player.team_changed`, `player.status_changed`, `player.withdrawn`, `player.restored`, `player.deleted`; `players.import_completed`, `players.import_failed`, `players.exported`, `players.spond_imported`; `season.created`, `season.updated`, `season.activated`, `season.archived`. The Add player flow (identity plus registration, atomic) writes both `player.created` and `player.registration_created`. `players.import_started` is deliberately not written: the batch row itself records initiation, and a started event with no completed event adds noise without operational value. Namespaces for future rollout (user.*, team.*, content_share.*, spond.*, drill.*, template.*, programme.*, session.*) are reserved in the catalogue documented in docs/security/app-audit-boundary.md.

Never logged: page views, reads, searches, keystrokes, unsaved or uncommitted edits, optimistic UI changes, secrets, invite or share tokens, JWTs, raw request bodies, spreadsheet contents, full before and after rows.

### Retention

APPROVED policy (PR 2). Child linked audit events are retained indefinitely at current scale (low thousands of events per season), with the retention policy reviewed annually. Audit rows carry no child names, but a child linked event (entity_type player) is pseudonymous child personal data: it holds a stable player_id and that child's attribute history, so retention is a CHILD personal data decision, not merely operational, and it is not decoupled from child data. A verified subject erasure request is therefore NOT satisfied by the players and registrations deletion path alone: it runs as a controlled administrative process that also addresses the child linked audit identifiers and `safe_changes` (deletion or irreversible severing of the identifier), and the relevant backup implications, since a restore can resurrect them. Removing the current player row is necessary but not sufficient; the tombstone rule ("Deleted player") limits exposure but the stable identifier and attribute history remain personal data. No automatic deletion or purge behaviour is implemented in PR 2. Actor name snapshots persist after profile deletion for accountability (adult operational data). No legal retention period is claimed; none has been evidenced. The full classification is in docs/security/app-audit-boundary.md (Data classification).

### Audit is not undo

The trail explains changes; it does not reverse them. Recovery is Withdraw and Restore, team or status correction, import retry, or explicit admin deletion. There is no mechanism that replays audit JSON back into tables, and none is planned.

## Alternatives considered

### A. One generic append-only audit_events table with trigger writers plus a private definer writer (CHOSEN)

One table to secure, one select policy, one enforcement story, one Activity page query. Triggers give the same transaction guarantee for free and cover every write path. The definer writer covers the two event families with no row write. Costs: a trigger touch on every player domain write (negligible at this scale) and the GUC plumbing for flow context.

### B. Per feature history tables

A `players_history` table now, then `seasons_history`, then one per audited feature. Rejected. Each table needs its own policies, grants, retention story and tests; the club-wide Activity page becomes a union query across ever more shapes; and a player-only history table built first would be exactly the competing mechanism the task forbids, either thrown away or dragged along when the app-wide need arrives. The generic table costs the same to build once and nothing to extend.

### C. Row snapshot journaling

A generic trigger writing `row_to_json(OLD)` and `row_to_json(NEW)` per change. Rejected outright. Full row snapshots are forbidden by the task, and for good reason here: `players.display_name` holds children's full names, so a snapshot journal would replicate every child's name into an append-only trail, breaching the boundary that keeps names in exactly one select gated table (`0021`, `0023`, `0028` pattern) and making retention and deletion requests unanswerable. Snapshots also capture whatever columns are added later, silently. The explicit allow list (`safe_changes`) exists precisely to prevent this class of leak.

### D. Write ahead application logging in Edge Functions

Each Edge Function or client flow writes an audit row before or after performing its change. Rejected. It breaks the same transaction property both ways: a change that fails after the log line leaves a success looking event for something that never happened, and a crash before the log line loses the event for something that did. It is trivially bypassed by any write path that does not go through the function, and most player writes are direct RLS mutations from the browser with no function in the path at all. The repository's own history illustrates the ephemerality: today's function run summaries live only in HTTP responses and `console.error`, and none of it is queryable after the fact.

### E. Supabase Realtime or an external log store

Broadcasting change events over Realtime, or shipping them to an external store (platform logs, a log service, WAL based capture). Rejected. Realtime delivers to currently connected clients and persists nothing. External stores sit outside Postgres row level security, so club scoping, `audit.view` gating and the per player history path would need a second, parallel authorisation system; they add an egress path for club operational data to a third party; and they cannot join back to entities for the Activity page without another pipeline. Platform database and function logs additionally rotate on the provider's schedule and are inaccessible to the product. None of these gives an in product, RLS governed, queryable record, which is the requirement.

## Decision

**The app gains one generic, append-only `audit_events` table, club scoped, written by AFTER row triggers on the player domain tables in the same transaction as the business change, plus a private SECURITY DEFINER writer `log_audit_event(...)` (EXECUTE revoked from `public`, `anon` and `authenticated`) for export and batch summary events. Flow context reaches the triggers through transaction local GUCs set only by trusted definer RPCs, with the precise failure default given above. Reads require `audit.view` club-wide, and the separate per player history path is gated on the same `audit.view`, so coaches holding only `players.view` do not get per player history by default. The foundation is integrated first with Registered Players and is deliberately not a player-only history table.**

This is decision D6 of the scoping brief. The full mechanism (DDL, trigger bodies, policies, grants, catalogue, test obligations) is specified in docs/security/app-audit-boundary.md and must land as the first implementation PR of docs/roadmaps/registered-players-delivery-plan.md, ahead of the seasons and registration schema, so that every subsequent player domain write is audited from the moment it exists.

## Consequences

- The schema gains its first persisted history mechanism. The player domain tables (`players`, `player_registrations`, `seasons`) get audit triggers from birth or first write; the audit foundation's triggers also maintain `updated_at` and `updated_by` on those tables, giving the players domain a consistent convention where the wider schema currently has two.
- The capability catalogue grows to include `audit.view` (with the players and seasons keys, thirteen to twenty in total per docs/product/registered-players-spec.md). `tests/security/capabilities.test.ts` must extend both the `EXPECTED_CATALOGUE` pin and the static scan regex, which today covers only the eight existing capability prefixes.
- Every future feature that wants history gets it by adding catalogue actions and, where needed, a trigger; nothing about the table changes. The wider rollout (users and roles, teams, sharing, Spond configuration, content deletions) is the final phase of the delivery plan.
- The same transaction property makes audit an honest witness: a change and its event are one commit. The corollary is that audit writes can abort business writes (a CHECK violation in the trigger rolls back the change); this is intended fail closed behaviour and must be covered by tests.
- Parents never see audit data: no capability, no policy arm, and the RequireCap pattern renders nothing while capabilities load. Coaches holding only `players.view` see neither per player history nor the club-wide Activity feed; both require `audit.view`, granted by default to managers and admins.
- Audit rows are deliberately name free, but child linked events are pseudonymous child personal data (a stable player_id plus attribute history), so retention and erasure treat them as child data, not as a name free trail exempt from those obligations (docs/security/app-audit-boundary.md, Data classification). The cost of the name free design is softer history copy ("Player name corrected" rather than the values), accepted as decision 7.
- The migration is review gated like every file under `supabase/migrations/` (CLAUDE.md review gates): opened as a PR, human reviewed, never auto merged, applied by hand once the live ledger confirms the slot.
- Threats against the mechanism itself (forged actor, direct insert attempts, cross club reads, tampering, leaking deleted player names) are enumerated with tests in docs/security/registered-players-threat-model.md.

## Unresolved items

The following numbered decisions from the scoping brief belong to this document. Decision 7 is written up above as the recommended default and requires explicit approval; decisions 8 and 15 are APPROVED (PR 2) and recorded above.

- Decision 7: historic name retention in audit. Recommended default: no name values are ever recorded; display name changes record the field name only and render as "Player name corrected". If exact prior names are ever deemed operationally essential, that is a separately protected player history mechanism with its own capability, retention and deletion story, not a change to the generic trail.
- Decision 8: audit retention period. APPROVED (PR 2): retain child linked audit events indefinitely at current scale, with the retention policy reviewed annually; no legal period claimed and no automatic deletion or purge added in PR 2. Child linked events are pseudonymous child personal data, so a verified subject erasure request runs as a controlled administrative process against the audit identifiers and `safe_changes` and the relevant backup implications, not by the players deletion path alone.
- Decision 15: club-wide `audit.view` versus per player history access. RESOLVED (PR 2) to `audit.view`: per player history through `player_history(...)` requires `audit.view`, the same gate as the club-wide Activity page, so managers and admins see it and coaches holding only `players.view` do not get per player history by default. This is the safer direction, chosen so historical child linked audit records are not exposed to coaches by default.

## Implementation dependencies

- Ships as PR 1 of docs/roadmaps/registered-players-delivery-plan.md: the `audit_events` schema, append-only enforcement, the capability catalogue rows, the writer functions, core queries and the security tests, before the seasons and registration schema (PR 2) so the backfill and every later write is audited.
- Migration number is provisional (likely 0030). Files on disk end at `0029_signup_hardening.sql`; the live ledger is the source of truth and must be confirmed read only at apply time, per the standing rule in CLAUDE.md and every recent migration header.
- The first PR must also wire `tests/security` into CI, closing the gap recorded in docs/security/policy-test-matrix.md, so the append-only proofs actually gate later phases.
- The import and export RPCs (docs/adr/ADR-0007-player-import-export-architecture.md) depend on this foundation for the GUC context, `batch_id` linkage and the `log_audit_event` writer; the Spond roster import adopts the same batch and source mechanism (`spond_import`) in its own gated change.
- Depends on the identity and seasons model of docs/adr/ADR-0005-registered-players-and-seasons.md for the entity ids the events reference, and on the RLS scope of docs/security/registered-players-boundary.md for the per player history gate.
- Human review gates: the migration, the RLS policies, the definer functions and the retention decision all require explicit human review; no implementation PR in this area may auto merge.
