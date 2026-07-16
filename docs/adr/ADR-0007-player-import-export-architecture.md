# ADR-0007: Player import and export architecture

Status: Proposed (draft for review; scoping only, no implementation lands with this document)
Date: 2026-07-16
Decision owners: Club owner (product); repository maintainer (security and data model)

This record decides where spreadsheet parsing happens, what the single commit path for a player import is, how idempotency works, and where export files are generated. It is one of a set. The registered players model it writes into is decided in `docs/adr/ADR-0005-registered-players-and-seasons.md`; the audit foundation it writes events into is decided in `docs/adr/ADR-0006-app-audit-events.md`. Formats, template headers, matching rules and size limits are specified in full in `docs/product/registered-players-import-export.md`; the preview and confirm UI in `docs/product/registered-players-ux.md`; RLS, capability grants and grants for the new table in `docs/security/registered-players-boundary.md`; the attack scenarios in `docs/security/registered-players-threat-model.md`; the append only audit rules in `docs/security/app-audit-boundary.md`; sequencing in `docs/roadmaps/registered-players-delivery-plan.md`. This document summarises those where needed and does not repeat them.

Throughout, statements are one of three kinds: confirmed current behaviour (cited to repository files), proposed defaults (this document's recommendations), and unresolved decisions requiring approval (listed under Unresolved items).

## Confirmed current state

All of the following is verified against the repository, not assumed.

- No spreadsheet, CSV, download or file saver library exists anywhere in the dependency tree. The runtime dependencies are exactly five packages: `@supabase/supabase-js`, `@tanstack/react-query`, `react`, `react-dom`, `react-router-dom` (`package.json:14-20`). Lockfile searches for csv, xlsx, sheetjs, exceljs, papaparse, file-saver, jszip and similar return nothing. Any parser or file generator is new code, and XLSX support requires the repository's first spreadsheet dependency.
- The app's only file download is the calendar export, `downloadSessionIcs` (`src/lib/ics.ts:73`): a pure string builder separated from the DOM side effect, then Blob, `URL.createObjectURL`, a temporary `<a download>` click, and revoke. The builder is unit tested; the DOM step is not.
- The only delimited text parsing is the FA video manifest parser, `parseManifest` (`src/lib/faAttach.ts:80`): headerless lines split on comma, tab or semicolon, conflicts dropped with warnings, never guessed. The only bulk import preview is `planAttach` (`src/lib/faAttach.ts:257`), which resolves every picked file to store, skip, unmatched or rejected with a per file reason before any bytes move. That plan then confirm shape is the house style a spreadsheet import preview extends.
- Eight Edge Functions exist. Six use the RLS as caller skeleton: `resolveCaller` (`supabase/functions/_shared/fa.ts:72`) builds an anon key client with the caller's Authorization header forwarded, takes identity from `auth.getUser(jwt)` and club from the caller's own `profiles` row, never from the payload; capability gates call the live `has_perm` function through the caller's client before any external contact (for example `spond-roster-import/index.ts:168`). Two functions (`invite-user`, `remove-user`) hold the service role key and replicate the capability probe manually. CORS is pinned to `APP_ORIGIN`. Function deploys are gated beyond merge and verified by reading the deployed source back byte for byte (CLAUDE.md, Edge Function deploys).
- There is no idempotency framework of any kind. What exists is per feature dedupe: fa-import's 409 `already_imported` refusal, `drills.source_key` reuse, the programme upsert on source URL, the `spond_events` upsert on `(club_id, spond_event_id)`, the roster import's in memory name dedupe, and the feedback promotion guard. No table stores an idempotency key, and the client's import mutations accept partial persistence by invalidating on settled because the FA functions write row by row with no transaction. `import_batches` is new ground.
- Exactly one database RPC is called from the client today: `member_states` (`src/lib/queries.ts:3219`; defined in `supabase/migrations/0012_rbac.sql`), a SECURITY DEFINER function that self gates in its own body on `has_perm('users.manage')`. The two functions proposed here would be the second and third client callable RPCs, following the same self gating shape.
- No audit, history or activity mechanism exists anywhere in the schema or the app. The nearest cousins are the feedback status trigger (guards the current value only, stores no history) and `spond_events.synced_at`. The foundation this architecture writes into is itself new work, decided in `docs/adr/ADR-0006-app-audit-events.md`.
- `players` today (`supabase/migrations/0021_players.sql`) is the only select gated content table: `players_select_coach` requires the caller's club and `has_perm('sessions.create')`; writes ride one FOR ALL policy, `players_manage_coach`. The identity plus registration model that imports will actually write is decided in ADR-0005.
- Privileged function conventions: Foundation era functions use `set search_path = ''` with schema qualified names, and functions that must not be client callable revoke EXECUTE from public, anon and authenticated (`0028_board_player_boundary.sql:175`, `0029_signup_hardening.sql:317`). `has_perm` stays granted to anon and authenticated so policy evaluation never errors.
- Migration ledger: files on disk end at `0029_signup_hardening.sql`, with development gaps at 0003, 0004 and 0010. The live ledger is the source of truth and was last confirmed ending at signup_hardening on 2026-07-16 (`docs/roadmap/foundation-retrospective.md`). The next slot is provisionally 0030. Every migration number in this document is provisional and must be confirmed against the live ledger at apply time.

## Proposal

### Parsing location: the browser

Both accepted formats are parsed in the browser, in the uploading user's own session.

- CSV is parsed by a small hand rolled tokenizer implementing RFC 4180 quoting. No dependency is needed; the repository already hand rolls its one delimited format (`src/lib/faAttach.ts:80`) and its one file builder (`src/lib/ics.ts`).
- XLSX is parsed with SheetJS (the `xlsx` package), added as a dependency in the implementation PR only and evaluated there. Nothing is added by this scoping work.
- Defensive caps run before parse (file size: 1 MB CSV, 2 MB XLSX) and immediately after (500 data rows, 30 columns), bounding decompression bombs. The full limit and rejection list (`.xls`, `.xlsm`, macro content, encrypted workbooks, external link parts, merged cells, wrong MIME, and the rest) lives in `docs/product/registered-players-import-export.md`.
- Formulas are never evaluated. SheetJS parsing performs no formula evaluation; a formula arrives as an inert string, and any cell carrying one is treated as an invalid value for import, reported in the preview like any other bad cell.

Why the browser is the right place: the parser runs with the privileges of the person who chose the file, inside their own browser tab. A hostile file can attack only its own uploader's session, which the uploader already controls. Moving parsing to a server would place untrusted file handling next to privileged runtimes for no boundary gain, because the parse output is never trusted anyway: the server re-validates every row at commit regardless of where parsing happened. Parsing location is a convenience decision; commit authority is the security decision, and it is settled separately below.

### Commit path: one transactional SECURITY DEFINER RPC

The only commit path for a spreadsheet import is a single database function:

```
import_players(p_batch_id uuid, p_season_id uuid, p_rows jsonb)
```

SECURITY DEFINER, `set search_path = ''` with schema qualified names (the Foundation convention), EXECUTE granted to authenticated because it self gates in its own body, exactly as `member_states` does. Selecting a file never writes; stage one (parse, validate, preview) is entirely client side, and only the explicit Confirm calls this function. In one transaction it:

1. Re-checks `has_perm('players.import')` and refuses without it. Because the function is SECURITY DEFINER, this in body check is the enforcement, not a courtesy: RLS does not constrain the function's own writes, so the gate must live inside it and fail closed.
2. Derives the club from `my_club()` and the actor from `auth.uid()`. A caller with no club is refused. Nothing identity shaped is read from the payload.
3. Claims the batch: inserts `p_batch_id` into `import_batches`. If a batch with that id already exists for the caller's club, the function returns the stored result and applies nothing. A guessed or replayed id from another club matches nothing and behaves as unknown (see `docs/security/registered-players-threat-model.md`).
4. Validates the season: it exists, belongs to the caller's club, is the current season, and is not archived.
5. Validates every row independently, unbound by the client's preview: display name bounds (1 to 40 characters after trim), status vocabulary (pending, registered, withdrawn), shirt number bounds (1 to 99 or empty), registered date format, team ids re-verified as teams of the caller's club (the client resolves team names to ids at preview; the server accepts only ids and re-verifies each one), and Player ID ownership for updates (the identity row must belong to the caller's club).
6. Re-derives the match outcome for every row (new insert, update, already present) server side. The preview's classifications are display only and are never sent as instructions.
7. Applies the inserts and updates. `created_by` and `updated_by` are set server side from `auth.uid()`.
8. Sets the transaction local audit context (`set_config('otj.audit_source', ...)` with `csv_import` or `xlsx_import`, and `otj.audit_batch` with the batch id) so the audit foundation's row triggers stamp every per row event, then writes the `players.import_completed` batch summary through the private writer `log_audit_event` (ADR-0006). A rolled back import rolls back its events; no event ever claims completion before commit.
9. Records the counts, the declared file fingerprint and the outcome on the batch row, and returns the structured result.

The structured result carries what the results screen shows (`docs/product/registered-players-import-export.md` owns the copy): rows received, added, updated, already present, skipped, the final outcome, the batch id and the server timestamp. The structured error on a failed attempt carries the failing row number and a reason the user can act on, never row content beyond what identifies the row. Per player history and the Activity page reference a batch as "Import" plus a short batch reference derived from the id, per the naming decisions in `docs/product/registered-players-spec.md`.

Function grants follow the repository's two established shapes. `import_players` and `export_players` are granted EXECUTE to authenticated and self gate in their bodies, the `member_states` shape, because they are the intended client entry points and their refusal must be a clean capability error rather than a missing function. The audit writer they call, `log_audit_event`, takes the opposite shape: EXECUTE revoked from public, anon and authenticated (the `0028`/`0029` revoke pattern), callable only from definer functions and the service role, per ADR-0006.

The commit is all or nothing (recommended default; approval required, see Unresolved items). Rows the preview marked invalid are never sent. If any submitted row fails server validation, every business write in the attempt rolls back and a structured error is returned naming the row and reason: no player row, no registration row, no per row audit event survives a failed attempt. The recommended implementation shape is an exception handled inner block: the business writes roll back atomically while the function still records the batch row with outcome failed and writes the `players.import_failed` summary event, so even a failed attempt is idempotent (a duplicate Confirm of a failed batch returns the stored failure rather than re-running). Whether the failure bookkeeping commits through that inner block or a separate definer call is settled in the implementation PR under review, with two fixed constraints: a failed import never leaves partial player data, and no success event ever exists for work that did not commit.

The Spond roster import is not routed through `import_players`. It remains its own sanctioned server path because it must contact Spond with function secrets; it gains season, status, batch and audit awareness in its own gated change, specified in `docs/product/registered-players-import-export.md` and ADR-0006.

Manual add and edit operations likewise do not use this RPC; they remain ordinary RLS governed mutations per `docs/product/registered-players-spec.md`, audited by the same row triggers with source `manual`.

### The import_batches table

A new table gives the app its first idempotency mechanism. Proposed shape (the exact column list is fixed in the reviewed implementation migration, provisional slot 0030 onward, live ledger confirmed at apply time):

- `id` uuid primary key. Client minted (`crypto.randomUUID()`), one id per produced preview: every Confirm press for a given preview carries the same id, and producing a new preview (a new file, or re parsing after correction) mints a new id. The server treats it purely as an idempotency key: it must be a valid uuid, it is unique, and replay lookup is scoped to the caller's club.
- `club_id`, `actor_id` (nullable, on delete set null), `season_id`.
- `format` text, check in ('csv', 'xlsx').
- `file_sha256` text: a non reversible fingerprint of the file bytes, computed client side and recorded as declared correlation metadata. It is not verified (the server never sees the file) and no security decision rests on it.
- `rows_received`, `added`, `updated`, `already_present`, `skipped` integer counts.
- `outcome` text, check in ('completed', 'failed').
- `created_at` timestamptz default now().

By design there is no filename column (a filename can itself contain personal data), no row content, no names, no raw validation text. Client grants: none of insert, update or delete; the table is written only from inside the RPC. Whether authenticated receives a scoped select, or batch summaries are read only through their audit events, is fixed in `docs/security/registered-players-boundary.md`.

### The trust boundary: what the server refuses to take from the client

The RPC treats the browser as untrusted in full. It refuses to trust, and derives or re-verifies server side, every one of the following:

- club_id: derived from `my_club()`; never read from the payload.
- actor identity: `auth.uid()` only; `actor_name` on audit events resolved server side from `profiles`.
- role and capability claims: `has_perm('players.import')` checked in the function body at commit time.
- `created_by` and `updated_by`: set server side, never accepted as input.
- audit metadata: source, batch linkage, `occurred_at` and actor fields are all server derived; the client cannot author an audit event (append only rules in `docs/security/app-audit-boundary.md`).
- import counts and preview classifications: the server recounts and re-derives every row's outcome; the preview is advisory display, not instruction.
- team access and team resolution: names resolve to ids only at preview; the server accepts ids alone and re-verifies each belongs to the caller's club.
- season access: the season id is validated as the caller's club's current, unarchived season.
- Player ID ownership: an update key must reference an identity row in the caller's club, closing cross club id injection.
- row contents: name bounds, status vocabulary, shirt bounds and date formats re-validated per row.
- the file fingerprint: recorded as declared metadata only.
- the batch id: accepted only as an idempotency key, never as an identity or authority claim.

### Failure behaviour

The nine failure situations the architecture must handle, with the designed behaviour of each:

1. Validation failure before commit (the server finds an invalid row). All business writes in the attempt roll back; a structured error names the row and reason; no partial data, no per row events. The batch is recorded as failed so the attempt is visible and idempotent.
2. One bad row among valid rows. Identical to the previous case under the all or nothing default: the whole file is refused, the error identifies the offending row, the user corrects the file and re-imports. The corrected preview mints a new batch id; the failed batch id stays a terminal record.
3. Commit succeeded but the response was lost. The client retries Confirm with the same batch id; the server finds the batch row and returns the stored result without applying anything. No duplicates, and the user sees the true outcome.
4. Network failure before the request reached the server. Retry with the same batch id finds no batch row, so the import applies normally. Across both failure modes the batch applies exactly once.
5. Repeated Confirm (double press). The confirm control is frozen while pending (`docs/product/registered-players-ux.md`), and the batch id makes even a racing duplicate harmless: the second call collides on the unique batch id, waits for the first to finish, and returns the stored result.
6. Retry after a timeout. The client cannot know whether the commit landed; it retries with the same batch id and receives either the stored result (it landed) or a fresh single application (it did not). Ambiguity is resolved server side, never by guessing client side.
7. Stale preview (data changed between preview and Confirm). The server re-validates and re-matches every row against current data; outcomes may lawfully differ from the preview (a row previewed as new may commit as already present). Anything that no longer validates fails the attempt with a structured error and the user re-previews.
8. Team or season changed after preview (team deleted, season archived or switched). Season validation (step 4) and per row team re-verification (step 5) fail closed; the structured error names the cause; nothing is written.
9. Permission revoked after preview. The in body `has_perm('players.import')` check at commit refuses the call before any write. Because the function is SECURITY DEFINER, this check is the enforcement and it runs at commit time, not preview time.

### Export: RPC read, client side file generation

Export mirrors the import split: the server is the authority for what data leaves and for the audit record; the client does the file mechanics.

```
export_players(p_season_id, p_filters)
```

SECURITY DEFINER, same conventions as `import_players`, EXECUTE granted to authenticated, self gating. In one transaction it:

- enforces `has_perm('players.export')` in its body;
- derives club and actor server side;
- applies the season, the structural filters (team, status set, name search) and the team scope from `docs/security/registered-players-boundary.md`, so the caller receives only rows they are authorised to read: the default export scope is the currently filtered list, with an explicit secondary "Export all I can access" option;
- writes the `players.exported` audit event in the same transaction as the read, recording record count, declared format, season and a safe filter summary. The search text is never persisted anywhere, because a search string can contain a child's name; the summary records only that a search was applied. The event never carries rows or names;
- returns the authorised dataset.

The client generates the file from the returned rows: CSV through a small hand rolled RFC 4180 writer, XLSX through the same library the import parser uses, then downloads it with the established pattern from `downloadSessionIcs` (`src/lib/ics.ts:73`): Blob, object URL, temporary anchor, revoke. Columns, ordering, encoding and the filename convention are fixed in `docs/product/registered-players-import-export.md`. Formula injection is defended in both directions: any cell whose first character is `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a single quote in CSV output and written as an explicit text cell (never a formula type) in XLSX; the import parser strips exactly one leading apostrophe when followed by `=`, `+`, `-` or `@` so round trips are stable.

The audit event rides the read because the read is the only server touch point in a client generated export: it is the last moment the server can guarantee a record exists for every export of children's names. The dataset is never stored server side; there is no export file in Storage, no download URL, no server copy. If the client fails to build the file after a successful RPC, the audit records an export that produced no file. That is the safe direction of error (over recording rather than under recording), and the event carries counts only. A lightweight confirmation dialog precedes every export (`docs/product/registered-players-ux.md`).

## Alternatives

Each alternative is assessed against the server authority requirements: server side permission validation; server derived club and actor; season, team and row validation; one transactional commit; audit in the same transaction; batch idempotency; no partial unexplained result; safe retry after an ambiguous network failure; no trust in the client preview.

| Requirement | A. RPC (chosen) | B. Direct RLS writes | C. Edge Function plus RPC | D. Storage plus server processing |
|---|---|---|---|---|
| Server side permission validation | yes, in body at commit | yes, per row via RLS | yes, but duplicated across two layers | yes |
| Server derived club and actor | yes | yes | yes | yes |
| Season, team and row validation | yes, independent of preview | partial, per row constraints only, no batch level season check | yes | yes |
| One transactional commit | yes | no | yes, but only via the RPC it wraps | yes, via the same RPC |
| Audit in the same transaction | yes | no place for a batch event | yes, via the RPC | yes, via the RPC |
| Batch idempotency | yes, import_batches | no | yes, via the RPC | yes, via the RPC |
| No partial unexplained result | yes | no, partial persistence is the current documented posture | yes | yes |
| Safe retry after ambiguous network failure | yes | no | yes | yes |
| No trust in client preview | yes | weakest, the client drives every write | yes | yes |
| Added surface | none | none | second runtime, deploy gates, CORS and secret config, service role adjacency | retained file at rest, new storage object class, upload plumbing |

Every requirement alternative C meets, it meets through the RPC it would wrap, which is why it is rejected for v1 rather than on capability grounds. Alternative D additionally violates the no retention rule outright.

### A. Browser parse, transactional RPC commit, RPC read with client file generation (chosen)

Meets every requirement in the smallest architecture available. All authority lives in two database functions; the only transaction capable layer in the stack (Postgres) holds the only commit path; audit commits with the business change because both run in the same transaction; idempotency is one table and one unique key. No new runtime, no new secret, no new deployment surface, no retained file.

### B. Direct RLS writes from the client (rejected)

The client would insert and update `players` and `player_registrations` row by row through ordinary policies, the way the FA importers write drills and media one by one. Permission validation and club and actor derivation would hold, because RLS enforces them per row. Everything else fails:

- No batch atomicity. A failure mid file leaves a partial import, which is precisely the confusion the two stage flow exists to prevent. The repository's current posture for this is documented acceptance of partial persistence (import hooks invalidate on settled because "rows persist even when the call ultimately reports an error"); that posture is not acceptable for child records.
- No same transaction audit for the batch. There is no server side moment at which the batch exists as one action, so `players.import_completed` with trustworthy counts cannot be written atomically with the rows it describes.
- No idempotency. A lost response followed by a retry duplicates rows; nothing server side can recognise the retry.

### C. Edge Function plus RPC (rejected for v1)

An Edge Function would receive the parsed rows (or the file itself, in the server parsing variant), validate, and call the RPC or write directly. Assessed honestly, it adds no authority the RPC does not already have: the capability re-check, identity derivation, row validation, single transaction, same transaction audit and batch idempotency all live in the database function either way, because only the database can make the commit atomic. What the function adds is cost, and the repository's own prior art prices it:

- the caller resolution plumbing (`resolveCaller`, `supabase/functions/_shared/fa.ts:72`) plus CORS pinned to `APP_ORIGIN` and its secret configuration;
- a second deployment surface whose deploys are gated beyond merge and verified by byte for byte readback of the deployed source (CLAUDE.md, Edge Function deploys), with the recorded history of inline deploy truncation that discipline exists to catch;
- runtime adjacency to the service role functions (`invite-user`, `remove-user`);
- a second copy of validation to keep in step with the RPC forever.

Edge Functions earn that cost when a flow needs an external call or a secret: Spond, GitHub and the FA fetches all do; this flow needs neither. The server parsing variant adds still more surface (upload handling of untrusted files in a privileged runtime) for no boundary gain, since parse output is untrusted wherever it is produced. Rejected for v1; revisited only if imports ever need server side file handling or an external verification step.

### D. Storage upload plus server processing (rejected)

The browser uploads the spreadsheet to a bucket and a server process parses and applies it. Rejected on the retention rule alone: the standing rule is that the uploaded file is never retained, no filename is persisted, and the sha256 fingerprint is the only trace. A Storage object exists precisely to persist; it would put a spreadsheet of children's names at rest in a second system, require a new object class in the 0027 storage boundary with its own policies and deletion lifecycle, and still need the same transactional RPC to apply the rows. It also breaks the stage one guarantee that selecting a file writes nothing.

### Export variants (rejected with C and D)

Generating the export file server side in an Edge Function inherits every cost in alternative C for a flow with no external call. Writing the export to Storage and returning a signed URL creates a stored dataset of children's names plus a bearer URL to it, inheriting alternative D's retention problem. Client generation from an RPC returned dataset keeps zero server copies while the same transaction audit event keeps the record.

## Decision

1. Parsing happens in the browser. CSV by a hand rolled RFC 4180 tokenizer; XLSX by SheetJS (the `xlsx` package) added as a dependency in the implementation PR only. Caps run before parse (file size) and after (rows, columns). Formulas are never evaluated and a formula bearing cell is an invalid value.
2. The only commit path for spreadsheet imports is the single transactional SECURITY DEFINER RPC `import_players(p_batch_id uuid, p_season_id uuid, p_rows jsonb)`, which re-checks the capability, derives club and actor server side, independently validates and matches every row, applies all writes and their audit events in one transaction, and trusts nothing from the preview.
3. Idempotency comes from the new `import_batches` table keyed on a client minted uuid v4: a repeated call with the same batch id returns the stored result without re-applying, making lost responses, timeouts and double presses safe. The recommended commit semantics are all or nothing.
4. Export is the `export_players(p_season_id, p_filters)` RPC: it enforces `players.export`, applies the team scope, writes the `players.exported` audit event in the same transaction as the read, and returns the dataset. The file is generated client side and never stored server side.
5. No Edge Function and no Storage object participates in v1. The Spond roster import remains its own sanctioned Edge Function path because it must contact Spond with secrets.

## Consequences

- The repository gains its first spreadsheet dependency, in the import implementation PR (PR 5 in `docs/roadmaps/registered-players-delivery-plan.md`), growing the five package runtime list. The export PR (PR 4) precedes it; if XLSX export ships in PR 4 the dependency lands there instead, a sequencing detail the delivery plan owns.
- Two new client callable SECURITY DEFINER functions join `member_states`. The security suite must prove their self gates: unauthorised callers refused, cross club rows refused, client supplied identity ignored, duplicate confirmation producing no duplicates, lost response plus retry idempotent, import transaction and audit committing together, export injection escaped, and file formulas never evaluated. The full proof list and its phase mapping live in `docs/security/registered-players-threat-model.md` and the delivery plan; the suite must run in CI from PR 1, closing the recorded gap in `docs/security/policy-test-matrix.md`.
- `import_batches` is a new table and the app's first idempotency mechanism; its migration is review gated like all migrations, numbered provisionally from 0030 onward with the live ledger confirmed at apply time, and never auto merged (CLAUDE.md review gates).
- All or nothing commit means one bad row that survived preview blocks the whole file. Accepted: the preview catches nearly everything client side, the structured error names the row, and the alternative (partial commit with a skip report) reintroduces the ambiguous outcomes the two stage flow exists to remove.
- The export audit can over record (an audited export whose file generation failed client side) but can never under record. Accepted as the safe direction for child data.
- The parser processes hostile input in the uploading user's own session; caps and format rejections are the browser side defence, and the RPC treats the parse output as untrusted input regardless. A bypassed or tampered preview can at worst submit rows the server then validates like any other input.
- The import confirm flow needs a locked, non dismissible pending state, which the shared Modal cannot express today; that is explicit new UI work specified in `docs/product/registered-players-ux.md`.
- Nothing about the uploaded file persists anywhere: no file, no filename, no row content in logs or audit metadata, only the sha256 fingerprint and counts on the batch row.

## Unresolved items

The unresolved decisions from the canonical list that belong to this document, each written up above as the recommended default:

- Decision 12: XLSX parsing in the browser versus on a server. Recommended default: browser, with caps before parse and no formula evaluation.
- Decision 13: transactional RPC versus Edge Function plus RPC as the commit path. Recommended default: RPC only, no Edge Function in v1.
- All or nothing import commit versus skip and report (the D7 commit semantics question). Recommended default: all or nothing; rows failing server validation abort the whole attempt.

Related approval items that shape this architecture but are owned by sibling documents: separate `players.import` and `players.export` capabilities (decision 5) and export capability holders (decision 4) in `docs/product/registered-players-spec.md` and `docs/security/registered-players-boundary.md`; the Spond default status (decision 6) in `docs/product/registered-players-import-export.md`; audit retention (decision 8) in `docs/security/app-audit-boundary.md`.

## Implementation dependencies

- The audit foundation (ADR-0006, delivery plan PR 1) must exist first: the row triggers, the transaction local GUC context, the private `log_audit_event` writer and the `audit_events` table are what `import_players` and `export_players` write through.
- Seasons and the identity plus registration split (ADR-0005, PR 2) must exist before import: season validation requires the `seasons` table and its one current season invariant, and imports write `player_registrations`.
- The capability keys `players.import` and `players.export` must be seeded per `docs/security/registered-players-boundary.md`, including the security test catalogue pin and the capability literal scan, both of which need extending for the new prefixes.
- Export and the template ship before import (PR 4 before PR 5 in `docs/roadmaps/registered-players-delivery-plan.md`), so `export_players` precedes `import_players`.
- All SQL in this architecture (the two functions, `import_batches`, grants) arrives in review gated migrations with provisional numbers from 0030 onward; the number is confirmed against the live migration ledger at apply time, never assumed from the files on disk.
- The `xlsx` dependency is added and evaluated in the implementation PR only; nothing is added by the scoping PR.
- The Modal locked mode and the preview accessibility work in `docs/product/registered-players-ux.md` must land with or before the import confirm flow.
- The Spond roster import's move to `players.import`, current season registrations and batch audited runs is its own gated function change, sequenced in PR 6 of the delivery plan.
