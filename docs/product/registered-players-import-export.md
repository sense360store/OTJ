# Registered players: import and export

How registered player records enter and leave the Hub in bulk: the downloadable
template, the CSV and XLSX file rules, the two stage import workflow, matching
and duplicate handling, the transactional commit contract, the Spond squad
import, filtered export, and the audit trail both directions leave behind.

This document is product and contract level. The architecture decision (browser
parsing, transactional RPC commit, idempotent batches) is recorded in
`docs/adr/ADR-0007-player-import-export-architecture.md`. The data model it
operates on (stable player identity plus seasonal registration) is specified in
`docs/product/registered-players-spec.md` and decided in
`docs/adr/ADR-0005-registered-players-and-seasons.md`. Screens, modal behaviour
and accessibility are in `docs/product/registered-players-ux.md`. Row Level
Security semantics are in `docs/security/registered-players-boundary.md`, the
threat analysis in `docs/security/registered-players-threat-model.md`, and the
audit enforcement architecture in `docs/security/app-audit-boundary.md`.
Delivery phasing is in `docs/roadmaps/registered-players-delivery-plan.md`.

## Status

Draft for review.

## Decision owners

Club owner (product); repository maintainer (security and data model).

## Confirmed current state

Everything in this section is verified against the repository. Statements
elsewhere in this document are proposals unless marked otherwise.

- **No spreadsheet or CSV dependency exists.** The runtime dependency list is
  exactly five packages: `@supabase/supabase-js`, `@tanstack/react-query`,
  `react`, `react-dom` and `react-router-dom` (`package.json`). Searches of
  `package-lock.json` for csv, xlsx, sheetjs, exceljs, papaparse, file saver,
  jszip and every similar candidate return no matches. Any CSV tokenizer will
  be hand rolled, and the XLSX library is a new dependency added only in the
  implementation PR that ships import, never by this scoping work.
- **No file export of any kind exists except the calendar download.** The one
  download precedent is `downloadSessionIcs` (`src/lib/ics.ts:73-85`): a pure
  string builder separated from the DOM side effect, Blob, `createObjectURL`,
  a temporary anchor with a `download` attribute, then revoke. The builder is
  unit tested; no "Export" or "Download" user facing copy exists anywhere in
  `src/` today.
- **The only delimited text parsing precedent** is the FA video manifest parser
  (`parseManifest`, `src/lib/faAttach.ts:80-131`): headerless lines read via
  the File API's `file.text()`, conflicts dropped with warnings, never guessed.
- **The only plan then confirm import UX precedent** is `planAttach`
  (`src/lib/faAttach.ts:257-385`) rendered by
  `src/components/AttachFAVideosModal.tsx`: every picked file resolves to a
  per item status with a reason before any bytes move, and the confirm button
  carries the plan count. The import preview below extends this house style.
- **Modals cannot currently be made non dismissible.** The shared `Modal`
  (`src/components/ui.tsx:379-418`) always closes on Escape, overlay click and
  the header X. The locked pending state the import confirm needs is new UI
  work, specified in `docs/product/registered-players-ux.md`.
- **No idempotency framework exists.** Retry and dedupe behaviour today is per
  feature (FA import 409 refusal, programme upsert, spond-sync upsert, roster
  name dedupe); there is no generic batch or idempotency key mechanism, and
  the only database RPC the client calls today is `member_states`
  (`src/lib/queries.ts:3219`).
- **The Spond squad import today** (`supabase/functions/spond-roster-import/index.ts`)
  is gated on `has_perm('sessions.create')` checked by RPC before Spond is
  contacted, reads only each child's full name and an optional shirt number,
  dedupes case insensitively on display name within (club_id, team_id) in
  memory (no database unique constraint exists), performs a plain batch insert
  into `players` (never an update), caps selection at 200 members per mapping,
  returns counts and warnings only, logs only HTTP status and counts, and
  fails closed on missing `SPOND_EMAIL` and `SPOND_PASSWORD` secrets. Note the
  wording mismatch: `CLAUDE.md` describes this import as admin triggered, but
  the implemented gate is `sessions.create` and the button sits on the coach
  facing Roster page. The capability move proposed below makes the documented
  intent real.
- **No audit mechanism exists anywhere.** The nearest cousins are the feedback
  status trigger (current value only) and `spond_events.synced_at`. Import and
  export history therefore depend on the audit foundation shipping first (see
  `docs/security/app-audit-boundary.md`).
- **The players table today** (`supabase/migrations/0021_players.sql`) holds
  id, club_id, team_id (not null, cascade on team delete), display_name (the
  child's full name, 1 to 40 characters, per `0023_players_fullname.sql`),
  nullable shirt_number (1 to 99), created_by and created_at. There is no
  season, no status, no updated_at. The import and export design below targets
  the evolved model in `docs/product/registered-players-spec.md`.

## Proposal

### Import template

A blank template is downloadable from the players page (capability
`players.import`; see `docs/product/registered-players-spec.md` for the
capability catalogue). It ships in two formats with identical headers: CSV as
the primary format (opens everywhere) and XLSX as the compatibility format,
one worksheet named `Players`. Proposed template filenames:
`registered-players-template.csv` and `registered-players-template.xlsx`.

The exact header row, stable and documented:

```
Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date
```

Worked example (synthetic names):

```
Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date
,Sam Example,2026/27,Titans,Registered,7,2026-07-01
,Robin Sample,2026/27,,Pending,,
9f2b6c1e-0d4a-4a7e-9c1b-2f3d4e5a6b7c,Alex Sample,2026/27,Trojans,Registered,10,2026-06-28
,Casey Placeholder,2026/27,Spartans,,,
```

Validation notes, row by row:

- Row 1: a new player (blank Player ID). Team is matched by exact name after
  trimming and case folding within the club. The date is ISO 8601.
- Row 2: a new player with a blank Team cell, imported as Unassigned. Blank
  Registration Status maps to Pending. Blank shirt number and date are valid.
- Row 3: Player ID present, so this row updates that player's registration in
  the selected season. Exports populate Player ID; people never type it.
- Row 4: blank status maps to Pending; only Player Name is required.

Column rules:

- **Player ID**: blank for new players; a UUID for updates. Exports populate
  it. An unknown UUID, or one belonging to another club, is a row error.
- **Player Name**: required, 1 to 40 characters after trimming, the child's
  full name. The only required column.
- **Season**: informational cross check only. The import screen's selected
  season is authoritative. A non empty Season cell that does not match the
  selected season is a row error; this prevents importing last season's file
  by accident. A blank Season cell is accepted.
- **Team**: matched by exact name after trim and case fold within the club.
  An unknown team name is a row error. A blank cell means Unassigned.
- **Registration Status**: Pending, Registered or Withdrawn, matched case
  insensitively. Blank maps to Pending. Anything else is a row error.
- **Shirt Number**: optional integer 1 to 99. Out of range or non numeric is a
  row error.
- **Registered Date**: ISO 8601 (`YYYY-MM-DD`) required; `DD/MM/YYYY` is
  accepted with a warning. Anything else is a row error.

### Import formats and file rules

Accepted formats are `.csv` and `.xlsx` only. Defensive caps apply before
parsing: the file size limit is checked first, then row and column caps as the
parse proceeds. Limits are set for grassroots scale (the club runs five teams
of roughly 15 to 25 players; real files are far below every cap).

| Rule | Limit or condition | Behaviour |
|---|---|---|
| CSV file | `.csv`, max 1 MB | Accepted |
| XLSX file | `.xlsx`, max 2 MB | Accepted |
| Legacy Excel | `.xls` | Rejected with a clear error |
| Macro formats | `.xlsm` or any macro content | Rejected |
| Protected workbook | Password protected or encrypted | Rejected |
| External links | Workbook containing external link parts | Rejected |
| MIME type | Does not match the extension's expected type | Rejected |
| Data rows | Max 500 | Over the cap rejects the file |
| Columns | Max 30 | Over the cap rejects the file |
| Worksheets | Exactly one non hidden worksheet is used | Extra sheets are an error |
| Merged cells | Any | Error |
| Hidden rows | Any | Treated as data, not skipped |
| Blank rows | Any | Skipped, with a count shown in the preview |
| Encoding | UTF-8; a byte order mark is tolerated | Accepted |
| CSV delimiter | Comma only | A detected semicolon delimiter gets a clear error message |
| Whitespace | Leading and trailing | Values are trimmed |
| Header row | Required, matched case insensitively | Missing header row is an error |
| Unknown headers | Any | Warned and ignored |
| Duplicate headers | Any | Error |
| Missing required header | Player Name absent | Error |
| Formulas (XLSX) | Any cell parsed as a formula | Never evaluated; treated as an invalid cell value |

Parsing happens in the browser, in the uploading user's own session with their
own privileges: a hostile file can only attack its own uploader's tab, and the
caps bound decompression attacks. CSV is parsed by a small hand rolled
tokenizer implementing RFC 4180 quoting; XLSX is parsed with SheetJS (`xlsx`),
a dependency added in the implementation PR only. SheetJS parsing performs no
formula evaluation; formulas arrive as inert strings and are treated as invalid
cell values for import. The full assessment against server side parsing is in
`docs/adr/ADR-0007-player-import-export-architecture.md`.

### Import workflow

Two stages, strictly separated:

1. **Parse, validate and preview**, entirely client side. Selecting a file
   never writes anything. The preview classifies every row and shows counts.
2. **Explicit Confirm**, which calls the transactional commit RPC (below).

The preview reports the following categories. Each is a count plus a
filterable row list with a per row reason sentence.

| Category | Exact meaning | What the user can do |
|---|---|---|
| Total rows | Data rows read after blank rows are skipped (the blank row count is shown alongside) | Sanity check against the source file |
| Valid new | Rows with no Player ID and no match: a new identity and registration will be created | Confirm |
| Valid updates | Rows with a valid Player ID in the caller's club: the existing player's registration in the selected season will be updated or created | Confirm |
| Already present | No Player ID, but the exact normalised name already has a registration in the selected season on the same team; skipped, making re import idempotent | Nothing required; this is the expected result of importing the same file twice |
| Warnings | Rows that will import but deserve a look: a possible duplicate name on another team, or a `DD/MM/YYYY` date accepted with a warning | Review, and either proceed or fix the file and upload again |
| Ambiguous matches | Rows the import refuses to guess about: a name matching both an Unassigned registration and the row's stated team, or a fuzzy near match; held back, not imported | Resolve manually in the app or the file, then import again |
| Invalid rows | Rows failing validation: name bounds, unknown status, shirt out of range, bad date, Season mismatch, unknown Player ID | Download the rejected row report, correct, upload again |
| Unknown teams | The Team cell matched no club team after trim and case fold; a row error within Invalid rows, counted separately because the fix differs | Fix the spelling, or have a `teams.manage` holder create the team first |
| Unassigned rows | Valid rows with a blank Team cell, importing as Unassigned | Nothing required; assign teams later in the app |
| In-file duplicates | The same normalised name appears twice in the file; both rows are held back pending manual resolution | Remove or disambiguate one row and import again |
| Duplicate Player IDs | The same Player ID appears on more than one row; all such rows are held back | Keep one row per player and import again |
| Status or date problems | The specific validation failures on Registration Status and Registered Date, surfaced with the offending value's column named | Correct the values and upload again |
| Rows to skip | The total that will not be sent: already present plus ambiguous plus invalid plus held back rows | Review before confirming; the Confirm button states exactly what will be written |

The user can filter the preview by category, inspect each row's problem,
cancel safely at any point before Confirm (nothing has been written), and
download the rejected and warning rows as a report (below). Confirm is enabled
only when at least one valid new or valid update row exists.

While the confirm is in flight the modal is not dismissible: the X, Escape,
the overlay and Cancel are all disabled, all controls are frozen, progress is
visible, and the result is explicit success or explicit failure. This requires
extending the shared Modal with a locked mode; the behaviour and its
accessibility requirements are specified in
`docs/product/registered-players-ux.md`.

### Import matching and duplicates

The standing rule: two children are never merged solely on a name match. The
preferred update key is a valid internal Player ID belonging to the caller's
club. Name matching uses exact normalisation only: trim, case fold, collapse
internal spaces.

The full matching decision table:

| Row situation | Outcome |
|---|---|
| Player ID present, valid, belongs to the caller's club | Update: the row targets that player identity and its registration in the selected season (creating the registration if the season has none) |
| Player ID present but unknown, malformed, or belonging to another club | Row error; the row is invalid and never sent |
| The same Player ID on more than one row in the file | All such rows held back as duplicates pending manual resolution |
| No Player ID; exact normalised name matches a registration in the selected season on the same team | Already present: skipped, so re importing the same file is idempotent |
| No Player ID; exact normalised name matches a registration in the selected season on a different team | Warning, "possible duplicate": imported as a new identity and registration, never auto merged; siblings and namesakes on different teams are real |
| No Player ID; exact normalised name matches an Unassigned registration while the row names a team (or the reverse) | Ambiguous: not auto matched, held back pending manual resolution |
| No Player ID; the same normalised name appears twice inside the file | Both rows flagged ambiguous and held back pending manual resolution |
| No Player ID; no match | Valid new: a new identity and registration |
| Fuzzy or near match (similar but not identical after normalisation) | Warning only, never auto applied; the row imports as new with the warning attached |

Further rules:

- No cross club matching of any kind. The server verifies every Player ID and
  team id against the caller's own club.
- Missing rows never withdraw or delete anyone. A file only adds and updates;
  absence from a file means nothing. Mass withdrawal is explicitly out of
  scope as a separate future feature.
- No guardian or contact data participates in matching, because none is stored
  and none is accepted (see `docs/security/registered-players-boundary.md`).

### Import transaction and server authority

The commit is one transactional SECURITY DEFINER RPC:

```
import_players(p_batch_id uuid, p_season_id uuid, p_rows jsonb)
```

The contract, at product level (the architecture assessment is
`docs/adr/ADR-0007-player-import-export-architecture.md`):

- The RPC rechecks `has_perm('players.import')`, derives the club from
  `my_club()` and the actor from `auth.uid()`. The client's claimed club,
  actor, role, capabilities, counts and audit metadata are never trusted.
- The season is validated server side: it exists, belongs to the caller's
  club, and is the current season, not archived.
- Every row is validated independently on the server; the server is not bound
  by the client preview. Validation covers display name bounds, status
  vocabulary, shirt bounds, date format, team resolution by UUID within the
  club (the client resolves team names to ids at preview time; the server
  verifies the ids again), and Player ID ownership for updates.
- Rows the preview marked invalid, ambiguous or already present are never
  sent. Rows that fail server validation abort the whole transaction with a
  structured error naming the row and reason. All or nothing, no partial
  commit: partial imports are exactly the confusion the two stage flow exists
  to prevent. This choice needs approval (Unresolved items).
- Per row audit events are written by the base triggers in the same
  transaction, enriched with the batch id and source through transaction
  local settings, plus one batch summary event. See
  `docs/security/app-audit-boundary.md`.
- The batch is recorded in `import_batches`: id (a client generated UUID v4,
  unique), actor, club, counts, a SHA-256 fingerprint of the file bytes, and
  the outcome. A repeated call with the same batch id returns the stored
  result without re applying anything: the confirm is idempotent, safe to
  retry after a lost response, and double click safe.

Designed behaviour for every failure situation:

1. **Validation failure before commit** (preview stage): nothing is written,
   because file selection and preview never write. The user corrects the file
   and uploads again.
2. **One bad row among valid rows at commit**: the whole transaction aborts
   with a structured error naming the row and reason. Nothing is applied, no
   audit success event exists, and the preview is re run after correction.
3. **Commit succeeded but the response was lost**: the client retries with the
   same batch id; the RPC finds the recorded batch and returns the stored
   result without re applying. The user sees the true outcome, once.
4. **Network failure before the request reached the server**: no batch row
   exists, so the retry with the same batch id simply performs the import.
   Either way the batch applies at most once.
5. **Repeated Confirm** (double click, double tap): the confirm controls are
   frozen while pending, and even if a second call arrives the unique batch id
   returns the stored result. No duplicates.
6. **Retry after a timeout**: identical to situations 3 and 4; the client
   re invokes with the same batch id and the batch record decides whether the
   work already happened.
7. **Stale preview** (data changed between preview and Confirm): the server
   revalidates every row against live data; any row that no longer validates
   aborts the whole transaction with a structured error, and the user re runs
   the preview against current state.
8. **Team or season changed after preview** (a team deleted, the season
   archived or switched): season and team validation at commit time fails,
   the transaction aborts with a structured error, nothing is written.
9. **Permission revoked after preview**: the RPC's own capability recheck
   refuses, the transaction aborts, nothing is written. The client's earlier
   capability read grants nothing.

### Import results

After a successful commit the modal shows: added, updated, already present,
skipped, rejected, warnings, the final outcome, the batch reference (rendered
as "Import" plus a short batch reference, per the naming in
`docs/product/registered-players-spec.md`), and the timestamp. After a failed
commit it shows the structured error and the fact that nothing was written.

The rejected and warning row report is a client generated CSV containing: the
original row number, Player Name, the offending column, and the reason
sentence. Proposed filename: `registered-players-import-issues-<YYYYMMDD-HHmm>.csv`
(no player data in the name). The report applies the same formula escaping
rules as exports. It is generated in the browser, never uploaded, and never
persisted server side.

Privacy assessment of the report: it contains children's names, because a
correction report without the name would be unusable. The file the user just
uploaded already contains those names on the same device, so the report adds
no new exposure beyond what the user already holds; it is a derivative of
their own input. The secure handling guidance shown on export applies equally
here. Nothing else is retained anywhere: the uploaded file is not stored, row
content never enters logs or audit metadata, and the original filename is
never persisted (the batch fingerprint is a SHA-256 of the bytes, from which
neither names nor the filename can be recovered).

### Spond import

The Import from Spond workflow is preserved and integrated with seasons,
registrations and audit. Proposed changes to
`supabase/functions/spond-roster-import`, shipped as its own gated function
change per the delivery plan:

- **Season**: imported players land in the club's current season, chosen
  server side; the function refuses if the club has no current season. The
  client cannot pick an arbitrary season.
- **Status**: registrations are created as Pending. Rationale: membership of
  a Spond subgroup proves squad membership in Spond, not completed club
  registration. The alternative, landing as Registered, is documented under
  Alternatives; the default needs approval (Unresolved items).
- **Dedupe**: the key becomes the normalised name within (club, season, team)
  against registrations, the same per team semantics as today. Repeat imports
  remain idempotent and never update existing rows.
- **Audit**: each run gets a batch id and writes `players.spond_imported`
  events through the same transaction local mechanism, source
  `spond_import`, plus the batch summary. See
  `docs/security/app-audit-boundary.md`.
- **Permission**: the gate moves from `sessions.create` to `players.import`.
  Under the recommended default grants, coaches lose this trigger; that is
  part of the coach access reduction decision flagged in
  `docs/product/registered-players-spec.md` and listed below. This also
  resolves the confirmed mismatch between the `CLAUDE.md` description (admin
  triggered) and the implemented coach reachable gate.
- **Boundary unchanged**: the function still reads only each child's full
  name and an optional shirt number, never Spond member ids, guardians or
  contacts, and still logs only HTTP status and counts. It remains an Edge
  Function because it holds the Spond secrets and makes external calls,
  unlike the file import commit, which is a database RPC (see
  `docs/adr/ADR-0007-player-import-export-architecture.md`).

### Export

Export produces CSV or XLSX, generated client side (CSV hand rolled, XLSX via
the same library as import) from data returned by a single RPC:

```
export_players(p_season_id, p_filters)
```

The RPC enforces `players.export`, applies the team scope defined in
`docs/security/registered-players-boundary.md`, and writes the
`players.exported` audit event in the same transaction as the read.

Scope: the default export is the currently filtered list, exactly what is on
screen; exports respect filters, so Withdrawn players are excluded whenever
the active filters exclude them. A secondary, explicit option exports all
records the caller is authorised to access ("Export all I can access").

The exact column order, and formatting per column:

| Order | Column | Formatting |
|---|---|---|
| 1 | Player ID | UUID of the stable player identity |
| 2 | Player Name | The stored display name, escaped per the formula rules |
| 3 | Season | The season name, e.g. `2026/27` |
| 4 | Team | Team name; an Unassigned registration exports an empty string |
| 5 | Registration Status | `Pending`, `Registered` or `Withdrawn` |
| 6 | Shirt Number | Integer 1 to 99, or empty |
| 7 | Registered Date | ISO 8601 `YYYY-MM-DD`, or empty |
| 8 | Last Updated | ISO 8601 timestamp of the registration's last update |

File rules: UTF-8 with a byte order mark prefix (for Excel), RFC 4180 quoting
in CSV, one worksheet named `Players` in XLSX, no hidden columns, no hidden
sheets, no creator ids, no audit metadata, no unrelated data. Filename:
`registered-players-<season>-<YYYYMMDD-HHmm>.csv` or `.xlsx`, with the season
slug filesystem safe (the `/` in `2026/27` becomes `-`, giving `2026-27`); the
filename never contains player data. The record count is shown in the
confirmation dialog before the file is generated.

### Formula injection protection

Applies to every generated file: exports in both formats, the template, and
the rejected row report.

- Any cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage
  return is escaped.
- **CSV**: the cell is prefixed with a single quote (`'`), the established
  spreadsheet convention that forces text interpretation.
- **XLSX**: the cell is written as an explicit text cell, its type never
  formula; the text cell type is the primary defence in that format. Belt and
  braces across the two formats: no generated cell can execute in a
  spreadsheet application.
- **Round trip rule**: on import, exactly one leading apostrophe is stripped
  when it is followed by `=`, `+`, `-` or `@`, so a value exported with the
  CSV escape imports back to its original form. Export then import then
  export is stable; no apostrophes accumulate, and a genuine leading
  apostrophe in a name (not followed by those characters) is untouched.
- On the import side, XLSX formulas are never evaluated; they arrive from the
  parser as inert strings and are treated as invalid cell values (a row
  error), never as data.

### Export confirmation

Every export shows one lightweight confirmation dialog before the file is
generated. It states the record count, the season, the active filters, and the
handling reminder, exact copy: "Store and share this file securely; it names
children." One extra click, defensible for child data. Confirming writes the
`players.exported` audit event; the dataset itself is never stored anywhere,
and no download URL exists to retain, because the file is built in the
browser and handed straight to the user.

### Import audit and export audit

Summary of what is recorded; the enforcement architecture (append only table,
trigger writers, transaction local batch context, the private writer function)
is `docs/security/app-audit-boundary.md`, decided in
`docs/adr/ADR-0006-app-audit-events.md`.

Import records:

- One `import_batches` row per confirmed import: the client generated batch
  id, actor, club, counts (rows received, added, updated, already present,
  skipped, rejected), the SHA-256 fingerprint of the file bytes, and the
  outcome. This row is also the idempotency record.
- Per row audit events written by the base triggers in the same transaction,
  carrying source `csv_import` or `xlsx_import` and the batch id, so every
  changed record's history links back to its import.
- One batch summary event, `players.import_completed` or
  `players.import_failed`. `players.import_started` is deliberately not
  written; the batch row itself records initiation, and a start event has no
  operational use.
- Never recorded: the original filename (it may contain personal data), the
  file, player names, complete rows, raw validation messages containing
  personal data, formulas, or contact details.

Export records:

- One `players.exported` event, written in the same transaction as the read:
  actor, timestamp, format, season, a safe filter summary, the record count,
  and success or failure.
- Never recorded: the dataset, any name list, the file, or a download URL.

Spond import records the same shape with action `players.spond_imported` and
source `spond_import`.

## Alternatives

- **Server side parsing** (Edge Function or Storage upload plus processing):
  rejected. It creates a larger attack surface (upload plumbing, server side
  spreadsheet parsing adjacent to privileged credentials) for no boundary
  gain, since the browser parser runs with only its own user's privileges and
  the server independently revalidates every row regardless. Full assessment
  in `docs/adr/ADR-0007-player-import-export-architecture.md`.
- **Edge Function commit instead of an RPC**: rejected. The commit makes no
  external calls and needs no secrets; a transactional RPC is the smallest
  architecture meeting every server authority requirement. Same ADR.
- **Skip and report instead of all or nothing commit**: apply the valid rows
  and report the failures. Rejected as the recommended default because a
  partially applied file is precisely the ambiguity the preview exists to
  remove, and the preview already gives per row correction before anything is
  written. Listed as needing approval.
- **Spond imports land as Registered**: documented alternative if the club
  treats Spond squad membership as proof of completed registration. The
  recommended default is Pending, keeping the registration decision a
  deliberate act in the Hub.
- **Direct RLS table writes from the browser for import**: rejected outright;
  no transactional boundary, no batch idempotency, no single audit summary,
  and partial failure behaviour would be whatever the network happened to do.
- **A single combined import and export capability**: rejected; export
  exfiltrates names while import mutates records, different risks warranting
  separate grants (`players.import`, `players.export`).

## Decision

Adopt the proposal above: one downloadable template with the seven stable
headers; CSV and XLSX accepted under the stated caps and rejection rules;
browser parsing with a hand rolled RFC 4180 CSV tokenizer and SheetJS for
XLSX (dependency added in the implementation PR only); a two stage workflow
where selecting a file never writes; matching that never merges on name
alone; one transactional, idempotent, all or nothing `import_players` RPC as
the sole commit path; a client generated rejected row report that never
leaves the device; the Spond import moved to `players.import`, landing
Pending registrations in the server chosen current season with batch audit;
filtered export through `export_players` with the eight stated columns,
formula escaping in both formats with the round trip rule, and a lightweight
confirmation naming the count, season, filters and secure handling; and audit
at batch and row level with no names, rows, filenames or datasets retained.

The decisions marked below remain subject to approval and are presented here
as recommended defaults.

## Consequences

- Two new database RPCs (`import_players`, `export_players`) and one new
  table (`import_batches`) join the security boundary and require the full
  review gate; migration numbers are provisional (likely 0030 onward) and the
  live migration ledger must be confirmed at apply time, never assumed from
  the files on disk.
- The repository gains its first spreadsheet dependency (SheetJS `xlsx`) in
  the import implementation PR, a deliberate exception to the five package
  runtime dependency list, justified and evaluated in that PR.
- The shared Modal needs a locked mode before the import confirm can ship
  (`docs/product/registered-players-ux.md`).
- Coaches lose the Spond import trigger under the recommended default grants;
  if the club instead approves the continuity fallback in
  `docs/product/registered-players-spec.md`, coaches keep `players.import`
  and this document's permission statements apply unchanged with the wider
  holder set.
- Exports put children's names into files on users' devices. The confirmation
  copy, the audit event and the capability gate are the mitigations; the
  residual risk and insider misuse cases are assessed in
  `docs/security/registered-players-threat-model.md`.
- Re importing an exported file is a supported, stable round trip: Player IDs
  make every row an update, already present detection makes name only rows
  idempotent, and the apostrophe strip rule keeps escaped values identical
  across cycles.

## Unresolved items

The relevant numbered decisions from the canonical decision list, each with
its recommended default:

- **2. Coach team scope**: coaches read only registrations on their assigned
  teams; managers and admins read all. This scope is applied by
  `export_players`, so it bounds what a coach holding `players.export` could
  ever export. Recommended: assigned teams only.
- **3. Coach access reduction**: coaches drop from today's full
  `sessions.create` roster powers to view only, which removes the Spond
  import trigger from coaches. Recommended: reduce to view.
- **4. Export capability holders**: who holds `players.export` by default.
  Recommended: managers and admins.
- **5. Separate import and export capabilities**: `players.import` and
  `players.export` as distinct grants. Recommended: yes, keep them separate.
- **6. Spond default status**: the status Spond imported registrations land
  with. Recommended: Pending.
- **12. Browser versus server XLSX parsing**: where the spreadsheet is
  parsed. Recommended: the browser, with defensive caps.
- **13. RPC versus Edge Function commit**: the commit architecture.
  Recommended: a transactional RPC, no Edge Function.
- **All or nothing import commit** (supplementary to the numbered list): a
  server side row failure aborts the whole transaction rather than skipping
  the row and reporting. Recommended: all or nothing.

## Implementation dependencies

- The audit foundation (delivery plan PR 1) must exist before import ships:
  batch events, row events and the transaction local source and batch
  context all depend on it. See `docs/security/app-audit-boundary.md`.
- The seasons and registration schema (PR 2, `docs/adr/ADR-0005-registered-players-and-seasons.md`)
  must exist before any import or export: the template's Season and Player ID
  semantics have no meaning against today's `players` table.
- The capability catalogue rows for `players.import` and `players.export`
  must be seeded with the schema, and the security test catalogue pin and
  literal scan must be extended to cover them.
- Export and the template ship before import (PR 4 before PR 5 in
  `docs/roadmaps/registered-players-delivery-plan.md`), so Player ID
  populated files exist for the import to update against.
- The SheetJS `xlsx` dependency is added in the import implementation PR
  only; nothing is added by this scoping work.
- The Modal locked mode and the import preview UI extend the existing plan
  then confirm prior art (`src/lib/faAttach.ts`, `AttachFAVideosModal`), per
  `docs/product/registered-players-ux.md`.
- The Spond function change (PR 6) follows the repository's Edge Function
  deploy discipline: deployed from the files on disk and verified by reading
  the deployed source back, never trusted from a version number.
- All migration numbers named anywhere in this work are provisional (likely
  0030 onward); the live migration ledger is the source of truth and must be
  confirmed at apply time.
