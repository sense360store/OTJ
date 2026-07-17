# App audit boundary: the append only audit_events foundation

Status: Draft for review

Decision owners: Club owner (product); repository maintainer (security and data model)

This document is the app wide audit architecture: the `audit_events` table, its append only enforcement, its writers, the action catalogue, what is never logged, and retention. The decision record is docs/adr/ADR-0006-app-audit-events.md; the full mechanism lives here. The first integration is Registered Players (docs/product/registered-players-spec.md), whose access boundary is docs/security/registered-players-boundary.md and whose threat model is docs/security/registered-players-threat-model.md. Import and export specifics beyond their audit records live in docs/product/registered-players-import-export.md and docs/adr/ADR-0007-player-import-export-architecture.md. Delivery phasing is docs/roadmaps/registered-players-delivery-plan.md.

Three kinds of statement appear throughout and are labelled: confirmed current behaviour (cited to repository files), proposed product defaults (the recommended design), and unresolved decisions requiring approval (gathered in Unresolved items).

The audit foundation exists to give trustworthy answers to four questions about any committed change: what changed, who changed it, when, and where the change came from. It is a generic app wide foundation, integrated first with Registered Players. There is deliberately no player only history table that would later compete with a global audit log.

---

## Confirmed current state

Everything in this section is confirmed current behaviour, verified against the repository.

### No audit mechanism exists today

- A case insensitive search for "audit" across the whole repository matches exactly one line: a comment in `supabase/seed.sql` ("Stable UUID scheme (auditable map from the prototype text ids)"), which is unrelated. No table, migration, document, roadmap item or code path implements an audit log, activity log or change history.
- No migration creates any log, audit, history or activity table. The full ledger on disk runs 0001 to 0029 with development gaps at 0003, 0004 and 0010 (`supabase/migrations/`, per CLAUDE.md the live ledger, not the file names, is the source of truth).
- "Activity" in the schema means the live session pointer (`sessions.live_activity_index`, `sessions.live_activity_started_at`, `0006_live_state.sql`), ephemeral state overwritten per activity change, not a log.
- No `updated_by` column exists anywhere. `created_by` and `created_at` are the only provenance columns on content tables, plus `github_issued_by` and `github_issued_at` on `feedback` (`0025_feedback_github.sql`) and `synced_at` on `spond_events` (`0013_spond.sql:89`).
- `updated_at` exists on only three tables (`feedback`, `boards`, `feedback_comments`), with two sanctioned conventions: set by application code (`0019_feedback.sql`, `0020_boards.sql`) or by trigger (`feedback_comments_touch_updated_at`, `0024_feedback_comments.sql`, the only `updated_at` trigger in the schema).
- The `players` table (`0021_players.sql`) has no `updated_at`, no `updated_by`, no status, no history of any kind.

### Nearest cousins

The closest existing things to an audit trail, none of which stores history:

- The feedback status guard trigger `feedback_guard_status` (`0019_feedback.sql:65-86`): a BEFORE trigger comparing old and new to protect the current status value. It stores nothing; the row carries only its current status. It is the repository's precedent that "only a trigger can compare old to new".
- The `feedback_comments` touch trigger (`0024_feedback_comments.sql`): keeps `updated_at` honest whatever writes the table, the one trigger maintained timestamp in the schema.
- `spond_events.synced_at` (`0013_spond.sql:89`): sync bookkeeping, one timestamp per event row, overwritten each run.
- The one way `github_issued_*` promotion columns on `feedback` (`0025_feedback_github.sql`): a record that a promotion happened, current value only.
- Edge Function run summaries (for example `spond-sync`) are returned in the HTTP response only and never persisted; server side `console.error` logging carries status codes and counts only, never names, and `src/` contains no console logging at all.

### Conventions this design builds on

- Privilege revocation precedent: `revoke execute on function public.board_tokens_without_names(jsonb, uuid) from public, anon, authenticated;` followed by a grant to `service_role` only (`0028_board_player_boundary.sql:175-176`). The private audit writer follows this exactly.
- Foundation search_path convention: `0028` and `0029` functions use `set search_path = ''` with fully schema qualified references ("no caller-set search_path can redirect a reference", `0029_signup_hardening.sql`). New privileged SQL follows this form, not the older `set search_path = public` used by `has_perm` (`0015_rbac_roles.sql:407-421`).
- Explicit grants since 0012 ("Hosted Supabase no longer auto grants Data API access", the 0012 lesson), and the standing rule of no update grant where no update policy exists (`0015_rbac_roles.sql`). This design extends that rule to all three write verbs on `audit_events`.
- The capability catalogue is exactly thirteen keys today, seeded in `0012_rbac.sql` and changed only by migration; `tests/security/capabilities.test.ts` pins the catalogue as `EXPECTED_CATALOGUE` and statically scans `src/` with a regex covering eight capability prefixes. Adding `audit.view` (and the players and seasons keys) requires extending both the pin and the regex.
- `players` is the only select gated content table (`players_select_coach`, `0021_players.sql`); everything else is club wide read. The audit select policy introduces a second capability gated read, deliberately.
- The security harness runs only against a local stack, with fixed refusal conventions (blocked INSERT 42501, blocked UPDATE and DELETE zero rows, trigger P0001, check constraint 23514) per `tests/security/stack.ts` and docs/security/policy-test-matrix.md. The security suite is not yet wired into CI (the matrix records the gap); the delivery plan closes it in PR 1.

---

## Proposal

Everything in this section is a proposed product default unless marked otherwise.

### Activity events versus field history

The design distinguishes two things and stores only safe forms of each:

- An activity event records that a committed business action happened: who, what action, when, where from, against which entity. Every row in `audit_events` is an activity event.
- Field history records which fields changed and, for an approved allow list only, the old and new values. This rides on the event row (`changed_fields`, `safe_changes`); it is not a separate table.

No complete row snapshots are ever stored, in any column, for any table.

### The audit_events table

One generic append only table, club scoped. It is not a player only history table. Provisional migration slot 0030 (files on disk end at 0029; the live ledger must be confirmed at apply time, never assumed from disk).

Field list, with type, nullability and the server derivation rule per field. No field is ever populated from a client supplied value except where explicitly stated:

| Field | Type | Null | Server derivation rule |
|---|---|---|---|
| `id` | uuid | not null | `default gen_random_uuid()`, primary key. Never client supplied. |
| `club_id` | uuid | not null | In triggers, the changed row's `club_id`. In the writer function, `public.my_club()` for user initiated events, or the validated entity's club for service role events. Proposed FK `references public.clubs (id) on delete cascade`, matching every club scoped table since 0001: deleting a club removes its entire audit trail with the tenancy. |
| `occurred_at` | timestamptz | not null | `default now()`. Never a parameter, never client supplied. |
| `actor_id` | uuid | nullable | `auth.uid()` read server side inside the trigger or writer. Null when there is no signed in actor (system events) and after actor profile deletion. FK `references public.profiles (id) on delete set null`. |
| `actor_name` | text | nullable | Resolved server side from `public.profiles.full_name` at write time. A snapshot: it survives profile deletion. Null only when `actor_id` was null at write time. |
| `action` | text | not null | Set by the writer from the action catalogue below. No CHECK list is maintained on this column: the writers are the only insert paths, and a CHECK would force a migration per new action for no boundary gain (assessed under Alternatives). |
| `entity_type` | text | not null | Set by the writer: `player`, `season`, `import_batch` or `export` initially. Player events anchor to the stable identity (see below), so `player_registration` is not an entity type. `export` is the value for `players.exported` events, which have no single entity row (`entity_id` null). The Activity page's Entity filter options (Player, Season, Import, Export; docs/product/registered-players-ux.md) map one to one onto this vocabulary, with Import meaning `import_batch`. |
| `entity_id` | uuid | nullable | The stable entity id: `players.id` for player events (including events raised by registration row changes, per the D1 rationale that history attaches to one stable identity across seasons), `seasons.id` for season events, the batch id for batch summary events. Null for events with no single entity (`players.exported`, entity_type `export`). No FK by design: the id is an immutable historical fact; resolution happens at read time and falls back to a neutral label (Deleted player, Deleted team) when the row no longer exists. |
| `season_id` | uuid | nullable | From the changed registration or season row, or the RPC's validated season. No FK, same rationale as `entity_id`. |
| `team_id` | uuid | nullable | From the changed row. No FK; renders as Deleted team when unresolvable. |
| `source` | text | not null | `check (source in ('manual','csv_import','xlsx_import','spond_import','renewal','system','edge_function','database_trigger'))`. Three way derivation, identical to docs/adr/ADR-0006-app-audit-events.md: when the transaction local GUC `otj.audit_source` is set, its value is recorded, subject to the CHECK; when it is unset and `auth.uid()` is non null, the write is a direct authenticated mutation through row level security and `manual` is recorded; when it is unset and `auth.uid()` is null (service role maintenance, a corrective migration running after the triggers attach), `database_trigger` is recorded. |
| `changed_fields` | text[] | nullable | Computed in the trigger from an explicit per table column allow list, never from `row_to_json`. Field names only, never values. This is the only place a name like field (`display_name`) is ever referenced, and only by name. |
| `safe_changes` | jsonb | nullable | Old and new value pairs computed in the trigger for the approved safe field list only: `team_id`, `status`, `shirt_number`, `registered_date`, `season_id`. Nothing else, ever. |
| `batch_id` | uuid | nullable | Read from the transaction local GUC `otj.audit_batch`, set by the import, renewal and Spond commit RPCs. Equals the `import_batches` id for imports, so row level events link to their batch. |
| `metadata` | jsonb | nullable | Safe scalar facts written by server side writers only: counts, format, filter summary (defined concretely under Export audit), outcome. Never names, rows, search strings, file content or free text derived from user data. |
| `request_id` | text | nullable | Optional correlation identifier attached by server side writers (for example an Edge Function request id). An opaque label; no access decision reads it, and it is never trusted as identity. |

There is no row snapshot column by design. No player name appears in `safe_changes` or `metadata`, ever.

Proposed indexes: `(club_id, occurred_at desc)` for the Activity feed; `(club_id, entity_type, entity_id, occurred_at desc)` for per player history; a partial index on `batch_id` where not null. Activity reads are server paginated (docs/product/registered-players-ux.md); the client never downloads the whole history. `audit_events` is not added to the realtime publication.

### Append only enforcement

Exactly this, and nothing looser:

- RLS is enabled on `audit_events`. One select policy:

  `create policy "audit_events_select_view" on public.audit_events for select using ( club_id = public.my_club() and public.has_perm('audit.view') );`

- There are no insert, update or delete policies for any client role. None will ever be added for `authenticated`.
- Table grants to `authenticated` are `select` only: `grant select on public.audit_events to authenticated;`. No insert, update or delete grant exists, extending the repository's standing "no update grant without an update policy" rule (`0015_rbac_roles.sql`) to all three write verbs. `anon` receives nothing.
- RLS is enabled, not forced, matching every existing table. The service role can therefore technically write rows; this is the same accepted key custody residual that applies to every table in the schema, and the service role's only sanctioned write path is the private writer function below.

A browser client therefore cannot insert, update or delete an audit event through any request shape: the grants refuse before RLS is even consulted, and no policy would admit the write anyway.

### Writers

Two server side writers exist. Nothing else writes the table.

(a) AFTER row triggers, the base writer. `after insert or update or delete ... for each row` triggers on `players`, `player_registrations` and `seasons`. Because triggers attach to the tables rather than to any call path, they cannot be bypassed: a direct RLS mutation from the app's TanStack hooks, an RPC, an Edge Function writing through the caller's JWT, and even a service role write all fire them. They commit in the same transaction as the business change, so a rolled back change rolls back its audit row.

Trigger function properties, per the Foundation convention: `security definer` (the invoking client has no insert grant on `audit_events`, so the function must run as its owner), `set search_path = ''`, every reference schema qualified, and `safe_changes` computed from an explicit column allow list, never `row_to_json`.

Proposed action mapping (implementers need this exact):

- `player_registrations` INSERT: `player.created`. The registration is what creates a player in a season's register; a brand new child and a renewal into a new season both record `player.created`, distinguished by `season_id` and `source`. The `players` identity INSERT writes no event of its own, because no defined flow creates an identity without a registration in the same action. That mapping is sound only while the pairing is atomic, so this specification requires it: the Add player flow must commit the identity insert and the registration insert in one transaction (in practice a single transactional add RPC, since two PostgREST requests cannot share a transaction). The "may wrap that in one transactional RPC" note in docs/security/registered-players-boundary.md is tightened to a must by this rule; without it, a registration insert failing after a committed identity insert would leave a child's name row with zero audit events, breaching the manual change guarantee below. Any future flow that creates an identity without a registration gains its own mapping first.
- `players` UPDATE: `player.updated` (this is where the display name correction rule applies, below).
- `players` DELETE: `player.deleted`, carrying `old.id` and no name. The event and the deletion commit together in one transaction.
- `player_registrations` UPDATE, by precedence, one event per row change: status becoming `withdrawn` writes `player.withdrawn`; status leaving `withdrawn` writes `player.restored`; any other status change writes `player.status_changed`; otherwise a `team_id` change writes `player.team_changed`; otherwise `player.updated`. Whatever action is chosen, every changed audited field still appears in `changed_fields` and `safe_changes`.
- `player_registrations` DELETE: when the parent identity no longer exists (the cascade from `player.deleted`), no separate event; the identity deletion covers it. When the parent survives (a data repair only; no product flow deletes a registration alone, Withdraw is the product operation), `player.updated` with metadata noting the registration removal.
- `seasons` INSERT: `season.created`. `seasons` UPDATE, by precedence, at most one event per row change: `archived_at` becoming set writes `season.archived`, and this wins even when the same UPDATE also clears `is_current` (the paired `season.activated` on the new current row records the switch); otherwise `is_current` becoming true writes `season.activated`; otherwise `is_current` becoming false with no other audited field changed writes no event, deliberately suppressed, because the only defined flow demoting a row is `activate_season` and the `season.activated` event on the incoming row is the record of that switch (the spec, ADR-0005 and the delivery plan all describe activation as writing `season.activated` plus optionally `season.archived`, and nothing else); otherwise `archived_at` becoming null (unarchive) writes `season.updated` with `changed_fields = ['archived_at']`; otherwise `season.updated`. The `activate_season` RPC (docs/product/registered-players-spec.md) is one transaction over both season rows, so its trigger raised events commit atomically with the activation. No season delete flow exists; if one is ever added it gains its own action first.

(b) Transaction local context. RPCs that act in bulk set two GUCs at the top of their transaction via `set_config('otj.audit_source', <source>, true)` and `set_config('otj.audit_batch', <batch uuid>, true)` (the third argument true makes them transaction local). The triggers read them with `current_setting(..., true)`. When `otj.audit_batch` is unset, `batch_id` is null. When `otj.audit_source` is unset, the fallback is the three way rule from docs/adr/ADR-0006-app-audit-events.md, restated in the field table above: `manual` when `auth.uid()` is non null, `database_trigger` when `auth.uid()` is null (service role maintenance, a corrective migration running after the triggers attach). The PR 2 registration backfill deliberately writes no audit events: the 0032 migration attaches the AFTER row triggers after the backfill inside the same transaction, its self verification DO block aborts unless `audit_events` holds zero player events from the backfill, and the migration itself is the record of the backfill (docs/roadmaps/registered-players-delivery-plan.md, Data migration plan steps 6 and 12). The `database_trigger` fallback therefore describes post attachment writes only, never the founding backfill. Because transaction local settings do not survive across PostgREST requests, any caller needing a non manual source must perform its writes inside a single RPC that sets the context first: `import_players` does exactly this (docs/adr/ADR-0007-player-import-export-architecture.md), the bulk Renew RPC does the same with source `renewal`, and the Spond roster import's write path gains an equivalent commit RPC in its own gated change (docs/product/registered-players-spec.md, Spond section).

On GUC forgery: PostgREST exposes only functions in the exposed schema, so a browser cannot call `set_config` directly, and no exposed RPC sets these GUCs from client parameters. Even if a source label were somehow forged, it is provenance labelling only, bounded by the CHECK vocabulary; actor, club and timestamp remain server derived regardless. The threat model covers the forged actor case (docs/security/registered-players-threat-model.md).

(c) The private writer function, for events with no row trigger. `public.log_audit_event(...)` writes `players.exported`, `players.import_completed`, `players.import_failed` and `players.spond_imported` batch summaries. Properties: `security definer`, `set search_path = ''`, schema qualified references, actor derived from `auth.uid()`, actor_name resolved from `public.profiles`, club derived from `public.my_club()` (or the validated entity for service role calls), `occurred_at` from `now()`. EXECUTE is revoked from `public`, `anon` and `authenticated` and granted to `service_role`, following the `0028_board_player_boundary.sql:175-176` precedent exactly. It is therefore not a client callable RPC: a browser hitting `/rpc/log_audit_event` fails on EXECUTE. Legitimate calls come from other SECURITY DEFINER RPCs (`export_players`, `import_players`, the Spond commit RPC), which run as the function owner and so retain EXECUTE, and from the service role for system events. Unlike `grant_club_membership` (`0029`), no in body role guard is added, because the function must serve definer RPCs acting for signed in users; the defence is the revoke, backed by a security test proving the direct client call fails. Residual: even if EXECUTE were mistakenly re granted, a caller could fabricate only action and metadata within their own club; actor, name, club and time are derived inside the function and cannot be supplied.

Companion housekeeping: the players domain tables (`players`, `player_registrations`, `seasons`) get BEFORE UPDATE triggers setting `updated_at = now()` and `updated_by = auth.uid()`, following the `feedback_comments` trigger precedent (`0024_feedback_comments.sql`) rather than the application code convention (`0019`, `0020`), because audited tables must not depend on client discipline for their own provenance columns. The same BEFORE UPDATE triggers also enforce provenance immutability: they refuse any change to `created_by` or `created_at` on `players` and `player_registrations`, and any change to `player_id` or `season_id` on `player_registrations`, raising P0001 per the harness convention. The owning specification for that guard is docs/security/registered-players-boundary.md (Provenance and linkage); without it an authorised updater could rewrite provenance columns invisibly, since neither appears in the audit allow lists.

### The same transaction guarantee and its consequences

Audit commits with the business change in the same transaction, always. Consequences, all deliberate:

- A failed or rolled back action produces no success event and no per row events: no success event ever exists for work that did not commit. An RLS refusal, a constraint violation or a validation abort leaves no player, registration or season event in `audit_events`, and attempted action logging is out of scope. One deliberate, narrow exception exists for imports: a failed `import_players` attempt rolls back every business write and every per row event, while its batch bookkeeping (the `import_batches` row with outcome failed plus the `players.import_failed` summary) commits through the recommended inner block shape of docs/adr/ADR-0007-player-import-export-architecture.md, finalised in the implementation PR under that ADR's two fixed constraints (no partial player data; no success event for uncommitted work), so a failed attempt is traceable and idempotent without any success record (see Import audit).
- No event ever claims completion before commit. Under MVCC no other session can read the event before the change it describes is durable.
- There are no "started" events for transactional operations. `players.import_started` is not written: the `import_batches` row records initiation, and every finished run, success or failure, carries its outcome on the batch row plus the matching summary event.
- Retry after a lost response is resolved by the idempotent batch id (below), never by hunting for a dangling started event.

### Club scoping and cross club inaccessibility

Every event row carries a `club_id` derived server side from the changed row or the actor's own club. The select policy scopes reads to `club_id = public.my_club()` and `has_perm('audit.view')`; a member of another club, or an outsider, receives zero rows for every query shape. The per player history path re checks club and team scope in its own gate. No read or write path crosses clubs; the security test plan proves the outsider fixture reads nothing (docs/security/registered-players-threat-model.md).

### Actor profile deletion

When an actor's profile is deleted, `actor_id` becomes null via the FK `on delete set null`, and the `actor_name` snapshot is retained. Justification: the snapshot is the adult member's own name recorded against their own operational actions, kept for accountability; it is operational adult data, not child data, and losing it would make historical events anonymous exactly when accountability matters most. The display layer keeps working without a join. This also repairs a real hazard: today `remove-user` cascades away the players a departing coach created (confirmed in discovery; `players.created_by` is `on delete cascade` in `0021_players.sql`), so provenance vanishes with the person. Under the new model the person FK columns on the players domain become nullable `set null`, and the audit trail carries the durable record.

### Read paths

Two separate access paths, by design (unresolved decision 15, recommended default separate paths):

- Club wide: the Activity page reads `audit_events` directly under the select policy, so it requires `audit.view` (default holders: admin and manager, per docs/security/registered-players-boundary.md). Parents never hold it and RLS returns them zero rows regardless of UI.
- Per player: an RPC or view `player_history(p_player_id)` gated on `players.view` plus the coach team scope, so a coach sees the history of players they can already see without holding `audit.view`. Exact semantics, including the team scope arms, live in docs/security/registered-players-boundary.md; presentation lives in docs/product/registered-players-ux.md.

### Action catalogue

Written from launch (source values in parentheses where fixed):

| Action | Raised by |
|---|---|
| `player.created` | registration INSERT trigger (manual, csv_import, xlsx_import, spond_import, renewal) |
| `player.updated` | identity or registration UPDATE trigger |
| `player.team_changed` | registration UPDATE trigger |
| `player.status_changed` | registration UPDATE trigger |
| `player.withdrawn` | registration UPDATE trigger |
| `player.restored` | registration UPDATE trigger |
| `player.deleted` | identity DELETE trigger |
| `players.import_completed` | writer function, from `import_players` (csv_import, xlsx_import) |
| `players.import_failed` | writer function, from `import_players` (csv_import, xlsx_import, matching the attempt's format) |
| `players.exported` | writer function, from `export_players` (manual; entity_type `export`, entity_id null) |
| `players.spond_imported` | writer function, one summary event per Spond run (entity_type `import_batch`, source spond_import) |
| `season.created` | seasons INSERT trigger |
| `season.updated` | seasons UPDATE trigger (includes unarchive) |
| `season.activated` | seasons UPDATE trigger, inside `activate_season` |
| `season.archived` | seasons UPDATE trigger |

The shape of a Spond roster run's audit output, for the avoidance of doubt: per row `player.created` events from the registration INSERT trigger (source `spond_import`, batch id set via the GUC), plus exactly one `players.spond_imported` run summary from the writer function. `players.spond_imported` is never a per row event. This catalogue is the authoritative statement; sibling documents describing the Spond run's events are read against it.

Not written: `players.import_started`. There is no operational need; the batch row records initiation.

Reserved future actions, catalogued now so later phases extend rather than redesign (emitted from the wider rollout phase onward, per docs/roadmaps/registered-players-delivery-plan.md): `user.invited`, `user.removed`, `user.role_changed`, `user.capabilities_changed`; `team.created`, `team.updated`, `team.deleted`; `content_share.created`, `content_share.refreshed`, `content_share.revoked`; `spond.mapping_changed`, `spond.sync_completed`; and create, update and delete actions for `drill.*`, `template.*`, `programme.*` and `session.*`.

### Never logged

The following are never logged, in any field, by any writer: page views; reads; searches; keystrokes; unsaved edits; optimistic changes; non committing clicks; secrets; invite tokens; share tokens; JWTs; raw request bodies; full spreadsheet contents; uploaded file content; raw rows; full before and after row snapshots.

### Player safe changes and the display name rule

The safe field allow list, the only fields whose old and new values ever appear in `safe_changes`: `team_id`, `status`, `shirt_number`, `registered_date`, `season_id`. These are operational facts, not personal data; ids resolve to names at read time and degrade to neutral labels after deletion.

Display name corrections are handled specially. When `display_name` changes, the event records `changed_fields = ['display_name']` with no values anywhere in the row, and the UI renders the fixed copy string "Player name corrected". No historic child name is retained in the generic audit payload, ever.

Assessment of whether exact prior names are operationally essential: no. At grassroots scale a name change is a typo fix or a formatting correction; the current name is always visible on the record, and a wrong correction is simply corrected again. If the club ever demonstrates a genuine need for prior names, that would be a separately protected player history mechanism with a tighter capability, an explicit retention period, no club wide exposure and an explicit deletion path, designed as its own gated change. It is not proposed now. This is unresolved decision 7 (recommended default: no values recorded).

### Import audit

A successful confirmed import produces three linked records, all committed in the one transaction of the `import_players` RPC:

- One row in `import_batches`: id (the client generated uuid v4, unique, doubling as the idempotency key), actor, club, season, format, the counts defined below, the sha256 fingerprint of the file bytes, outcome completed, and timestamp. A repeated call with the same batch id returns the stored result without re applying, so a lost response, a retry after timeout or a double click can never double import, and the audit trail shows one batch. Reads of `import_batches` serve the import history views and are gated `audit.view` (proposed default); writes happen only inside the RPC.
- One batch summary event: `players.import_completed`, entity_type `import_batch`, entity_id the batch id, source `csv_import` or `xlsx_import`, metadata holding the same counts, format and outcome as the batch row.
- Per row events (`player.created`, `player.updated`, and so on) from the triggers, each carrying the batch id via the `otj.audit_batch` GUC, so row level history links to its batch.

A failed attempt has a smaller, different shape, per the sanctioned exception in the same transaction guarantee above: every business write and every per row event rolls back and no partial player data survives, while the `import_batches` row (outcome failed) and the `players.import_failed` summary event (source `csv_import` or `xlsx_import`, matching the attempt's format like the completed summary) commit through the recommended inner block shape of docs/adr/ADR-0007-player-import-export-architecture.md, finalised in the implementation PR under its two fixed constraints (no partial player data; no success event for uncommitted work). That committed failure record also makes a duplicate Confirm of a failed batch return the stored failure rather than re running it.

The batch counts are exactly ADR-0007's column list: `rows_received`, `added`, `updated`, `already_present`, `skipped`. There is no rejected column. Provenance per count: `rows_received` is the number of rows submitted to the RPC; `added`, `updated` and `already_present` are re derived server side and never taken from the preview; `skipped` is the one declared client count kept on the batch row (the preview's withheld total: rows already present at preview, held back and invalid, per docs/product/registered-players-import-export.md), recorded like the file fingerprint as declared correlation metadata on which no decision rests. The preview's separate rejected, warnings and blank row numbers exist only in the client preview and results screen and never enter the batch record or any audit metadata.

The sha256 fingerprint is a non reversible digest of the uploaded bytes: it lets an admin establish whether two runs used the same file without retaining any content, and it cannot be reversed into names.

Never retained by the import audit, or anywhere server side: the original filename (filenames can contain personal information), the original file, player names, complete rows, raw validation messages containing personal data, formulas, contact details. The rejected row report is generated client side and never uploaded (docs/product/registered-players-import-export.md).

### Export audit

`export_players` writes one `players.exported` event in the same transaction as the read it serves, entity_type `export`, entity_id null, source `manual` (a user triggered action; the writer function passes it explicitly, satisfying the not null CHECK). Recorded: actor, timestamp, format, season, the safe filter summary, and the record count. The safe filter summary is exactly this and nothing more: the team id filter, the status set, and a boolean stating whether a name search was applied. The search string itself is never recorded anywhere, not in the summary, not in metadata and not in any log, because a search string can contain a child's name; the summary records only that a search was applied, matching docs/adr/ADR-0007-player-import-export-architecture.md. A failed export rolls the transaction back and produces no dataset and no event, which satisfies the rule that a failed action leaves no success record; there is no separate export failed action. Never retained: the dataset, the name list, the search string, the generated file, or any download URL (file generation is client side from the RPC's returned data; no server side URL ever exists).

### Manual change audit

Every manual mutation (the standard direct RLS write hooks, the edit modal, withdraw, restore, move team, admin deletion) is captured by the row triggers with source defaulting to `manual`, actor from `auth.uid()`, and safe changed fields per the allow list. Audit generation cannot be bypassed by choosing a different mutation path, because the triggers attach to the tables, not to any code path: any insert, update or delete that succeeds through any granted route fires them, service role included. The only ways to skip them are superuser level operations outside the application's trust model (noted as an accepted residual, consistent with the service role custody residual above).

### Retention

Retention is a product decision requiring approval (unresolved decision 8). No legal retention period is claimed anywhere, because none has been evidenced. The recommended operational default: retain audit events indefinitely at current scale, reviewed annually. At this club's scale (one club, five teams, roughly 75 to 125 players a season) audit volume is low thousands of events per season; indefinite retention costs almost nothing and preserves accountability.

The policy across every lifecycle case:

- Active season: full retention, no pruning.
- Archived seasons: archiving changes nothing; events are retained.
- Withdrawal: a status change like any other, audited and retained; withdrawal deletes nothing.
- Permanent player deletion: `player.deleted` commits with the deletion, entity id retained, no name. Earlier events for that entity are retained; they carry no names by construction, so nothing about the child persists except opaque ids. History renders the neutral label Deleted player.
- Actor profile deletion: `actor_id` nulls, `actor_name` snapshot retained (justified above).
- Deleted teams: `team_id` values already written remain as historical facts (no FK); they render as Deleted team when unresolvable.
- Deleted clubs: the proposed `club_id` cascade removes the whole audit trail with the tenancy.
- Backup and restore: audit rows ride the standard database backups and PITR exactly like every other table; a restore restores audit alongside the data it describes. A restore is itself an operator action outside the audit trail, an accepted residual consistent with the 0028 restore precedent.
- Growth: indexes and server paginated reads carry the expected volume comfortably; the annual review reconsiders if volume changes materially.
- Legal deletion requests: audit rows carry no child names, so a subject deletion request is satisfied by the players and registrations deletion path plus the tombstone rule; the remaining events contain only ids that resolve to nothing.
- Actor display name snapshots: adult operational data, retained for accountability.
- Old player identifiers: bare uuids retained after deletion identify no one without the deleted row.

### Audit is not undo

The audit log records what happened; it does not reverse anything, and no mechanism will replay audit JSON into table state. Recovery from mistakes uses the product's own operations: Withdraw, Restore, correcting a team assignment, correcting a status, retrying an import (idempotent by batch id), and explicit admin deletion. A generic restore from audit mechanism is explicitly out of scope, permanently, because replaying partial field history against a moved on schema is exactly the class of silent corruption the append only design exists to avoid.

---

## Alternatives

Assessed and rejected, or assessed and adopted in combination:

- A player only history table. Rejected. It would answer the immediate need, then compete with the app wide audit foundation the moment any other domain (users, teams, content, Spond configuration) needs history, forcing either a migration of history rows or two permanent systems. The generic table costs little more now and the reserved catalogue shows the growth path.
- Triggers alone. Adopted as the base writer, insufficient alone. Triggers are unbypassable and atomic, but they know nothing beyond the row: they cannot distinguish a CSV import from a manual edit (hence the GUC context) and they cannot record events with no row change (exports, batch summaries; hence the writer function).
- Transactional RPCs as the only writer. Rejected as sole mechanism. It gives atomicity, but the app's established architecture is direct RLS mutations from client hooks; an RPC only audit would silently miss every direct write unless the whole write surface moved into RPCs, abandoning the architecture and still leaving the bypass risk for any future direct path. RPCs are retained for what they are good at: setting transaction context and making multi row operations atomic.
- Trusted Edge Functions writing audit rows. Rejected as a writer. A Deno function cannot share the business change's database transaction across two network calls, so the same transaction guarantee (failed action, no success event; no event before commit) breaks by construction. It also enlarges the surface toward the service role for no boundary gain. Edge Functions that change audited rows get their audit from the triggers like every other writer, via a commit RPC that sets the GUC context.
- Service role direct inserts. Rejected. Bypasses RLS by design, rests the append only property entirely on key custody, and shares no transaction with the user's change. The service role's only sanctioned path is EXECUTE on the private writer, for system events.
- SECURITY DEFINER functions. Adopted as the privilege bridge, not as a standalone answer: both the trigger functions and `log_audit_event` are definer so that clients need no insert grant at all, hardened per the Foundation convention (empty search_path, schema qualified references, revoked EXECUTE per the 0028 precedent).

The chosen mix wins because each piece covers the others' gaps: triggers make capture unbypassable and atomic, GUCs give the triggers provenance context, the private definer writer covers non row events, and RPCs bound multi row operations into single transactions. No browser writable surface exists anywhere in the mix.

Also assessed:

- An actor role or capability snapshot column. Rejected. A member holds a set of roles (`member_roles`, `0015_rbac_roles.sql`), so a single role label is misleading; the display primary is denormalised; and the successful write itself already proves the actor held the required capability at that moment. Recording the full capability set per event is churn without decisions riding on it.
- A CHECK constraint on `action`. Rejected. The writers are the only insert paths, so the catalogue is enforced where events are made; a CHECK would add a migration per new action for no additional boundary (a forger who could insert rows at all has already defeated the grants, which is the real boundary and is tested).
- Fixed retention with scheduled pruning, the alternative to unresolved decision 8. Rejected as the recommended default. Audit rows carry no child names by construction, so pruning erases accountability for no privacy gain at this club's scale (low thousands of events per season); a pruning job is also new moving machinery whose failure modes (silent non pruning, over pruning) cost more than the storage it saves. The annual review is the check that this reasoning still holds; if volume or the data profile changes materially, a fixed period becomes a small follow up decision, not a redesign.
- A single read path requiring `audit.view` for per player history, the alternative to unresolved decision 15. Rejected. It forces a bad choice: either coaches are denied the history of players they can already see (making History useless to its main audience), or `audit.view` is granted club wide to coaches, a grant far broader than the need that also opens the whole Activity feed. The separate `player_history` path gives each audience exactly its scope: coaches see their players' history under `players.view` plus the team scope, and only `audit.view` holders see the club wide feed.

---

## Decision

Adopt the generic append only `audit_events` foundation exactly as proposed: one club scoped table; select only access gated by `audit.view` plus a separately gated per player history path; AFTER row triggers as the base writer with transaction local GUC enrichment; a private SECURITY DEFINER writer with EXECUTE revoked per the 0028 precedent for non row events; the same transaction guarantee; the action catalogue with its reserved future actions; the safe changes allow list with the display name correction rule; no names in audit, ever; retention as an approved product decision. The decision record is docs/adr/ADR-0006-app-audit-events.md.

---

## Consequences

- The capability catalogue grows (thirteen keys today) to include `audit.view` alongside the players and seasons keys; default grants and the full capability design are in docs/security/registered-players-boundary.md. `tests/security/capabilities.test.ts` needs its catalogue pin and its source scanning regex extended, or the tripwire fails.
- A second capability gated select policy enters the schema (after `players`); the standing club wide read rule for content tables is otherwise untouched.
- The audit foundation is PR 1 of the delivery plan and everything later depends on it; PR 1 also wires the security suite into CI, closing the recorded gap (docs/roadmaps/registered-players-delivery-plan.md).
- Every audited domain gains honest `updated_at` and `updated_by` maintenance by trigger, a small departure from the app code convention on `feedback` and `boards`.
- Audited scope is initially players, registrations and seasons; the wider rollout (users, teams, content, sharing, Spond configuration) is a later phase using the reserved actions.
- The migration is review gated like everything under `supabase/migrations/` (CLAUDE.md review gates); its number is provisional 0030 and must be confirmed against the live ledger at apply time.

---

## Unresolved items

The numbered decisions from the canonical decision list that belong to this document, each with its recommended default. All require approval by the decision owners:

- Decision 7: historic name retention in audit. Recommended default: no values are ever recorded for name like fields; `display_name` changes record `changed_fields = ['display_name']` only, rendered as "Player name corrected". A separately protected name history mechanism is designed only if a genuine need is demonstrated.
- Decision 8: audit retention. Recommended default: retain indefinitely at current scale, reviewed annually; no legal period claimed; subject deletion satisfied by the deletion path plus the tombstone rule.
- Decision 15: `audit.view` versus per player history access. Recommended default: separate paths; `player_history` gated on `players.view` plus the coach team scope, the club wide Activity page gated on `audit.view`.

Related decisions owned by sibling documents that shape audit reads: the coach team scope (decision 2, docs/security/registered-players-boundary.md) determines whose history `player_history` returns; the import commit semantics (decision on all or nothing, docs/adr/ADR-0007-player-import-export-architecture.md) determine which batch outcomes can exist.

---

## Implementation dependencies

- Provisional migration 0030 (audit table, grants, select policy, writer function, capability catalogue rows); the live ledger must be confirmed at apply time, never assumed from the files on disk. The registration and season triggers land with the schema split migration (ADR at docs/adr/ADR-0005-registered-players-and-seasons.md); the exact split across PRs is in docs/roadmaps/registered-players-delivery-plan.md.
- `audit.view` default grants and the players and seasons capability keys: docs/security/registered-players-boundary.md.
- `import_players`, `export_players`, `import_batches` and the idempotency contract: docs/adr/ADR-0007-player-import-export-architecture.md and docs/product/registered-players-import-export.md.
- The Spond roster import commit RPC change (season awareness, `players.import` gate, GUC context): docs/product/registered-players-spec.md, Spond section.
- `player_history` gate semantics under the coach team scope: docs/security/registered-players-boundary.md.
- Activity page and History drawer presentation, pagination and deleted entity display: docs/product/registered-players-ux.md.
- Security tests for every append only proof (client insert, update and delete refused; forged actor ignored; cross club zero rows; one event per successful change; no success event on failure, with the sanctioned import failure bookkeeping as the only committed failure record; batch idempotency; profile deletion display): docs/security/registered-players-threat-model.md, executed under the existing local harness conventions (`tests/security/`, docs/security/policy-test-matrix.md), wired into CI in PR 1.
