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
  be hand rolled, and the XLSX library is a new dependency added in the first
  implementation PR that needs it: the export PR (PR 4 in
  `docs/roadmaps/registered-players-delivery-plan.md`), which ships XLSX
  export and the XLSX template and evaluates the dependency there. The import
  parser (PR 5) reuses it. Nothing is added by this scoping work.
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
- **Modals can already be made non dismissible.** PR #103 added a `dismissible`
  prop to the shared `Modal` (`src/components/ui.tsx`, `modalDismissControls`,
  tested in `src/components/ui.test.tsx`): `dismissible={false}` makes Escape
  inert, the overlay non closing and the X disabled. The import confirm REUSES
  this; it is not new work. The one Modal gap that remains is dialog and focus
  semantics (`role="dialog"`, `aria-modal`, focus trap and restore), which the
  accessibility work adds (`docs/product/registered-players-ux.md`).
- **No persisted generic batch idempotency framework exists.** Retry and dedupe
  today is per feature (FA import 409 refusal, programme upsert, spond-sync
  upsert, roster name dedupe). PR #103 did add the client stable id plus server
  duplicate key recovery pattern for session creates (`stableCreateId` and
  `upsertSessionWrite`, `src/lib/sessionSubmit.ts` and `src/lib/queries.ts`): a
  create mints its id once and reuses it on retry, and the server recovers a
  duplicate key into an update. The persisted `import_batches` table extends
  exactly that pattern to a durable, replayable batch record. The only database
  RPC the client calls today is `member_states` (`src/lib/queries.ts`).
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
one worksheet named `Players` (the name orients the user; import does not
check it). Proposed template filenames:
`registered-players-template.csv` and `registered-players-template.xlsx`.

The exact header row, stable and documented:

```
Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date
```

Exports add one further column, Last Updated, which the import contract
recognises and silently ignores (see Import formats and file rules), so re
importing the app's own export raises no warning.

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
  season is authoritative. Import may target ANY season of the caller's club
  that is not archived and that the caller's capability permits; the selected
  season defaults to the current season but is not the only importable one, so
  a manager can prepare next season while the current season is still active.
  The commit RPC validates the target season as the club's, not archived, and
  within capability, and refuses an archived or cross club season. The spread
  sheet Import affordance renders whenever a non archived season is selected
  (`docs/product/registered-players-ux.md`). Import from Spond is the exception:
  it stays current-season-only (server chosen). A non empty Season cell that
  does not match the SELECTED season is a row error; this prevents importing
  the wrong season's file by accident. A blank Season cell is accepted, and the
  error copy hints at the renewal path: "If you are bringing another season's
  list forward, clear the Season column, then select the season to import
  into." The renewal procedure is below.
- **Team**: matched by exact name after trim and case fold within the club.
  An unknown team name is a row error. A blank cell means Unassigned.
- **Registration Status**: Pending, Registered or Withdrawn, matched case
  insensitively. Blank maps to Pending. Anything else is a row error. On an
  update row the supplied status must be reachable from the stored status
  under the allowed transitions in `docs/product/registered-players-spec.md`:
  the one impossible move is Registered back to Pending, surfaced as an
  invalid status transition row error, so a stale file cannot quietly regress
  a registration. Supplying the stored status again is not a transition and
  is always accepted. A row without a Player ID may create a registration
  directly as Withdrawn; the Add modal deliberately excludes Withdrawn on
  create, but import permits it for historical data entry and for export
  round trips. Such a row is audited as `player.created` with the withdrawn
  status in the safe change set; no `player.withdrawn` event is written
  because no transition occurred.
- **Shirt Number**: optional integer 1 to 99. Out of range or non numeric is a
  row error.
- **Registered Date**: optional. A blank cell is always valid. Only the FORMAT
  is constrained when a value is supplied: ISO 8601 (`YYYY-MM-DD`), or
  `DD/MM/YYYY` accepted with a warning. A non empty value in any other format is
  a row error.

#### Season renewal round trip

Until the dedicated bulk Renew action ships, the export and import pair is
the season renewal mechanism
(`docs/adr/ADR-0005-registered-players-and-seasons.md`). The procedure:

1. With last season selected, export the default filtered list. The default
   status filter excludes Withdrawn players, which is the right scope for
   renewal; players who left do not come forward.
2. In the file, clear the Season column or overtype it with the new season's
   name. Blank Season cells are accepted; stale season names are row errors
   by design, so an unedited file fails loudly rather than importing into the
   wrong season.
3. Clear both the Registration Status and the Registered Date columns if
   renewals should start as Pending with no date (blank status maps to
   Pending), or leave both to carry last season's statuses and dates
   forward. Leaving either column carries last season's values into the new
   season: in particular, a Registered Date left in place becomes the new
   registration's date, and because the automatic date fills only when the
   field is empty, that stale date persists even after the player is later
   marked registered.
4. Select the new season (it need not be the current season; any non archived
   season is importable) and import. Player IDs make every row an update that
   creates that player's registration in the new season, with team and shirt
   number taken from the file. Because renewal is keyed on Player ID, it never
   merges children by name and never depends on name matching.

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
| MIME type | Not on the extension's accept list (below) | Rejected; the MIME check is advisory, the content checks are the real gate |
| Data rows | Max 500 | Over the cap rejects the file |
| Columns | Max 30 | Over the cap rejects the file |
| Worksheets | Exactly one worksheet | A second worksheet, hidden or visible, is an error; the sheet's name is not checked |
| Merged cells | Any | Error |
| Hidden rows | Any | Treated as data, not skipped |
| Blank rows | Any | Skipped, with a count shown in the preview |
| Encoding | UTF-8 only; a byte order mark is tolerated | Decoded with a fatal UTF-8 decoder; any undecodable byte rejects the whole file |
| CSV delimiter | Comma only | A detected semicolon delimiter gets a clear error message |
| Whitespace | Leading and trailing | Values are trimmed |
| Header row | Required, matched case insensitively | Missing header row is an error |
| Unknown headers | Any not listed as export only | Warned and ignored |
| Export only headers | Last Updated | Recognised and silently ignored; re importing the app's own export raises no warning |
| Duplicate headers | Any | Error |
| Missing required header | Player Name absent | Error |
| Formulas (XLSX) | Any cell parsed as a formula | Never evaluated; treated as an invalid cell value |

Three rules make the table implementable against real files:

- **MIME accept lists**: `.csv` accepts `text/csv`, `application/vnd.ms-excel`
  (what Windows machines with Excel installed report for `.csv`), `text/plain`
  and an empty type; `.xlsx` accepts
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `application/octet-stream` and an empty type. Browsers frequently supply an
  empty or misleading type, so the extension plus the content checks (the zip
  signature, the parse result, the caps) are the real gate; a type outside the
  accept list is still rejected.
- **Encoding is strict**: the file is decoded with a fatal UTF-8 decoder, and
  a single undecodable byte rejects the whole file with a message naming the
  likely cause (Excel's "CSV (Comma delimited)" save on Windows writes
  Windows-1252) and pointing at Excel's "CSV UTF-8" save option. Replacement
  characters are never silently accepted into children's names.
- **XLSX typed cells**: a date typed cell (Excel stores dates as numeric
  serials with a format) is converted to an ISO date and accepted; a numeric
  typed cell is stringified, so shirt numbers typed as numbers work; boolean
  and error typed cells are invalid cell values, a row error; formula cells
  are never evaluated and are invalid cell values, per the table. On the
  export side every XLSX cell is written as a text cell, consistent with the
  formula defence below; dates therefore appear as text in Excel, and because
  import accepts both text and date typed cells, a file edited in Excel
  imports either way.

Parsing happens in the browser, in the uploading user's own session with their
own privileges: a hostile file can only attack its own uploader's tab, and the
caps bound decompression attacks. CSV is parsed by a small hand rolled
tokenizer implementing RFC 4180 quoting; XLSX is parsed with SheetJS (`xlsx`),
the dependency added by the export PR (PR 4) and reused here. SheetJS parsing
performs no formula evaluation; formulas arrive as inert strings and are
treated as invalid cell values for import. The full assessment against server
side parsing is in
`docs/adr/ADR-0007-player-import-export-architecture.md`.

### Import workflow

Two stages, strictly separated:

1. **Parse, validate and preview**, entirely client side. Selecting a file
   never writes anything. The preview classifies every row and shows counts.
2. **Explicit Confirm**, which calls the transactional commit RPC (below).

The preview reports the following categories. The partition is authoritative:
every data row lands in exactly one of five primary classes, valid new, valid
updates, already present, needs your choice or invalid, and those five counts
sum to the total. Warnings are an overlay, not a sixth class. The five classes
plus Warnings are the preview's filter chips in
`docs/product/registered-players-ux.md`, which adds an All chip. The Unassigned
count is also shown as a preview summary line ("n rows have no team and will be
Unassigned"), so the number of rows landing without a team is visible before
Confirm.

The single most important rule: a child is NEVER automatically merged,
updated or skipped from a name match. The only deterministic record update key
is a valid Player ID belonging to the caller's club. A row with no Player ID
whose name collides with an existing registration is never auto classified; it
is presented as "needs your choice" and the user chooses, per row, Skip or
Import as new.

Classification order is fixed, so the partition is deterministic across
implementations:

1. Per row field validation runs first: name bounds, status vocabulary,
   shirt bounds, date format, the Season cross check, team name resolution,
   and Player ID syntax and ownership. Any failure classifies the row
   invalid, regardless of any match it might also have. A Player ID that
   appears on more than one row in the file is a malformed input and
   classifies every such row invalid (the file is corrected, not resolved
   inline).
2. Rows carrying a valid Player ID in the caller's club resolve by ID: values
   differing from the stored registration are valid updates; values all equal
   are already present (no write). This is the only path to already present,
   and it is deterministic by ID, never by name, which is what makes
   re importing an exported file idempotent.
3. Rows with no Player ID resolve by name only to surface possibilities, never
   to act: a normalised name that collides with any existing registration in
   the selected season (same team, another team, or Unassigned against a
   named team), or a normalised name that appears more than once in the file
   without a Player ID, classifies the row needs your choice. The row is held
   back from the Confirm count until the user picks Skip or Import as new.
4. A row with no Player ID and no name collision is valid new.
5. Status transition validation runs last on valid update rows, because it
   needs the resolved match's stored status; a refused transition classifies
   the row invalid.

Warnings are overlays on importable rows and never add to the total: a
`DD/MM/YYYY` date accepted with a warning, or a Player ID row whose Player Name
cell differs from the stored name (import never renames; see matching), so an
attempted rename is surfaced rather than silently swallowed.

| Category | Exact meaning | What the user can do |
|---|---|---|
| Total rows | Data rows read after blank rows are skipped (the blank row count is shown alongside) | Sanity check against the source file |
| Valid new | No Player ID and no name collision: a new identity and registration will be created | Confirm |
| Valid updates | A valid Player ID in the caller's club whose values differ from the stored registration: that player's registration in the selected season will be updated or created | Confirm |
| Already present | A valid Player ID in the caller's club whose values all equal the stored registration: no write, no audit event. Deterministic by Player ID only, never from a name; this is the expected result of re importing an exported file. A differing Player Name cell still raises its warning | Nothing required |
| Needs your choice | No Player ID, and the name collides with an existing registration (same team, another team, or Unassigned against a named team) or appears more than once in the file: the app shows the possible matches and the user picks, per row, Skip (write nothing) or Import as new (create a distinct identity and registration). Never auto merged, never auto skipped. Unresolved rows are held back from Confirm | Choose Skip or Import as new per row, or fix the file and upload again |
| Invalid rows | Rows failing validation: name bounds, unknown status, an invalid status transition, shirt out of range, bad date, Season mismatch, unknown or malformed or cross club Player ID, or a Player ID duplicated in the file | Download the rejected row report, correct, upload again |
| Warnings (overlay) | A `DD/MM/YYYY` date accepted with a warning, or a Player ID row whose Player Name cell differs from the stored name | Review, and either proceed or fix the file and upload again |
| Unknown teams | The Team cell matched no club team; a row error within Invalid rows, counted separately because the fix differs | Fix the spelling, or have a `teams.manage` holder create the team first |
| Unassigned rows | Valid rows with a blank Team cell, importing as Unassigned | Nothing required; assign teams later in the app |
| Rows to skip | The total that will not be sent: already present, invalid, and any needs your choice rows resolved to Skip or still unresolved | Review before confirming; the Confirm button states exactly what will be written |

The user can filter the preview by class and by warnings, inspect each row's
problem, resolve each needs your choice row inline, cancel safely at any point
before Confirm (nothing has been written), and download the rejected and
warning rows as a report (below). Confirm is enabled only when at least one
valid new, valid update, or needs your choice row resolved to Import as new
exists, and it writes only those actionable rows.

While the confirm is in flight the modal is not dismissible. This REUSES the
existing Modal `dismissible={false}` contract shipped in PR #103
(`src/components/ui.tsx`, `modalDismissControls`): the X is disabled, Escape,
overlay clicks and Cancel are inert, all controls are frozen, progress is
visible, and the result is explicit success or explicit failure. It is not new
Modal work; the only new accessibility work is dialog and focus semantics,
owned by `docs/product/registered-players-ux.md` (section 7).

### Import matching and duplicates

The standing rule: two children are never merged solely on a name match. The
preferred update key is a valid internal Player ID belonging to the caller's
club. Name matching uses exact normalisation only: trim, case fold, collapse
internal spaces.

The full matching decision table. It follows the classification order fixed
in Import workflow: field validation first, then file wide duplicate
detection over the surviving rows, then row by row match resolution, so the
first situation restates the validation stage and the two duplicate
situations precede every per row match rule. Within the table it is an
ordered precedence list: for each row the first situation that applies,
reading top to bottom, decides the outcome, so a row satisfying more than
one situation takes the earliest. Matching ignores registration status
throughout: a name match against a Withdrawn registration counts the same as
any other.

| Row situation | Outcome |
|---|---|
| Player ID present but unknown, malformed, or belonging to another club | Row error; the row is invalid and never sent (field validation, before matching) |
| The same Player ID on more than one row in the file | Malformed input: every such row is invalid; the file is corrected and re uploaded (no inline resolution) |
| Player ID present, valid, belongs to the caller's club | Deterministic update by ID: the row targets that player identity and its registration in the selected season (creating the registration if the season has none). A row whose values all equal the stored registration is classified already present instead: no write, no audit event, though a differing Player Name cell still raises the stored name mismatch warning. This is the only deterministic key and the only path to already present |
| No Player ID; the same normalised name appears more than once inside the file | Needs your choice on every such row: the app shows the collision and the user picks Skip or Import as new per row; never auto merged, never auto created |
| No Player ID; exact normalised name matches a registration in the selected season on the same team (a blank Team cell and an Unassigned registration count as the same allocation) | Needs your choice: the row is NOT auto classified already present. The app shows the possible match and the user chooses Skip (treat as the existing registration, write nothing) or Import as new (a distinct child with the same name on the same team, a real possibility). A fresh batch never becomes already present from a name |
| No Player ID; exact normalised name matches an Unassigned registration while the row names a team (or the reverse) | Needs your choice: the app shows the possible match and the user chooses Skip or Import as new |
| No Player ID; exact normalised name matches a registration in the selected season on a different team | Needs your choice, shown as a possible duplicate on another team: the user chooses Skip or Import as new; siblings and namesakes on different teams are common, so nothing is auto decided |
| Near match, no Player ID: the row's name and a stored name are equal after normalisation plus diacritic folding (Unicode NFKD with combining marks removed) but not after normalisation alone. This folding is the only near match rule in v1; no edit distance measure is applied | Needs your choice, shown as a possible near match; the user chooses Skip or Import as new |
| No Player ID; no name collision | Valid new: a new identity and registration |

Further rules:

- The Player Name cell on a Player ID row never renames anyone. It is
  compared to the stored name; a mismatch raises a warning while the stored
  name stays untouched, and the warning attaches whether the row imports as
  an update or is classified already present, so an attempted rename in the
  file always gets feedback. Name corrections are manual only, where the
  audit records a name correction without recording the values.
- Because matching ignores status, restoring a withdrawn child needs the
  Player ID (a status update row) or the manual Restore action; a name only
  row matching a Withdrawn registration is a needs your choice collision, never
  an automatic action.
- Two different children with the same name on the same team and season are
  fully representable: manual Add of the second namesake succeeds (with a non
  blocking possible duplicate warning), a hand made file naming the same child
  twice is held as needs your choice and the user can Import as new for each,
  and an exported file carrying both children (each with its own Player ID)
  updates both by id and merges neither. Names never collapse two identities.
- An update row whose supplied values all equal the stored registration
  applies no write and produces no audit event, and supplying the stored
  status again is not a transition and is never refused. Re importing an
  unchanged export therefore writes nothing and adds nothing to any player's
  history, matched deterministically by Player ID.
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
  club, and is the current season, not archived. The UI mirrors this by
  offering import only when the selected season is the current season; a
  created but not yet activated season is refused here even though manual
  Add accepts it.
- Every row is validated independently on the server; the server is not bound
  by the client preview. Validation covers display name bounds, status
  vocabulary, status transition validity against the stored registration (the
  same transition enforcement that binds manual writes binds the RPC's
  writes; the one refused move is Registered back to Pending, and a same
  value status is not a transition), shirt bounds, date format, team
  resolution by UUID within the club (the client resolves team names to ids
  at preview time; the server verifies the ids again), and Player ID
  ownership for updates.
- The rows sent to the server are the actionable rows only: valid new, valid
  updates, and needs your choice rows the user resolved to Import as new. Rows
  the preview marked invalid, already present, resolved to Skip, or left
  unresolved are never sent. Rows that fail server validation abort the whole
  transaction with a structured error naming the row and reason. All or
  nothing, no partial commit: partial imports are exactly the confusion the two
  stage flow exists to prevent. This choice needs approval (Unresolved items).
- Business writes and their per row audit events run inside a PL/pgSQL
  exception subtransaction, so any failure rolls them all back together; the
  per row events are enriched with the batch id and source through transaction
  local settings (`docs/security/app-audit-boundary.md`). The full failure
  bookkeeping (claim, inner subtransaction, terminal state) is fixed in
  `docs/adr/ADR-0007-player-import-export-architecture.md`.
- The batch is recorded in `import_batches`: id (a client generated UUID v4,
  unique, the idempotency key), actor, club, season, format, state
  (pending, succeeded or failed) and counts. There is no file fingerprint: the
  browser parses the file and sends only parsed rows, so the server never
  receives the bytes and cannot verify a client declared hash (C3 of the
  corrections; `docs/security/app-audit-boundary.md`). A repeated call with the
  same batch id returns the stored result without re applying anything: the
  confirm is idempotent, safe to retry after a lost response, and double click
  safe; a concurrent call with the same id blocks on the batch row lock and
  then replays the committed result.

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
skipped, rejected (invalid), warnings, the final outcome, the batch reference
(rendered as "Import" plus a short batch reference, per the naming in
`docs/product/registered-players-spec.md`), and the timestamp. Added counts
valid new rows plus needs your choice rows resolved to Import as new; skipped
counts already present and Skip resolved rows; rejected counts invalid rows.
After a failed commit the batch state is failed and it shows the structured
error and the fact that nothing was written.

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
here. Nothing else is retained anywhere: the uploaded file is not stored, no
file fingerprint is stored (the server never receives the file bytes), row
content never enters logs or audit metadata, and the original filename is
never persisted.

### Spond import

The Import from Spond workflow is preserved and integrated with seasons,
registrations and audit. Proposed changes to
`supabase/functions/spond-roster-import`, shipped as its own gated function
change per the delivery plan:

- **Season**: Spond import stays current-season-only. Imported players land in
  the club's current season, chosen server side; the function refuses if the
  club has no current season, and the client cannot pick an arbitrary season.
  This differs from the spreadsheet import, which may target any non archived
  season, because the Spond organiser account's live subgroup reflects the
  current squad and importing it into a future season is ambiguous. Keeping
  Spond current-season-only is a recommended operational decision; the
  alternative (any non archived season) is an Unresolved item.
- **Status**: registrations are created as Pending. Rationale: membership of
  a Spond subgroup proves squad membership in Spond, not completed club
  registration. The alternative, landing as Registered, is documented under
  Alternatives; the default needs approval (Unresolved items).
- **Dedupe, and its unavoidable limitation**: the key is the normalised name
  within (club, season, team) against registrations, the same per team
  semantics as today. Repeat imports remain idempotent and never update
  existing rows. Because Spond member ids are deliberately never persisted (the
  child data boundary), Spond re import has no deterministic id key and can
  only match by name. This has an unavoidable limitation: two different
  children with the same name in the same Spond subgroup are treated as one on
  import (the second is skipped). This is a documented, accepted trade off of
  not persisting Spond member ids; the manual Add or the id keyed spreadsheet
  import is how genuine namesakes are represented. The spreadsheet import's
  needs your choice flow does not apply to Spond, which runs unattended against
  the live subgroup.
- **Audit**: each run gets a batch id. Every imported player writes one
  `player.created` row event through the registration insert trigger,
  carrying source `spond_import` and the batch id, and the run writes one
  `players.spond_imported` summary event through the private writer function.
  `players.spond_imported` is a per run summary action, not a per player one.
  See `docs/security/app-audit-boundary.md`.
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

These changes land in two stages
(`docs/roadmaps/registered-players-delivery-plan.md`). PR 2 ships a
compatibility change only: the function writes identity plus current season
registration rows, its early probe moves from `sessions.create` to
`players.manage` so the probe matches the write policies exactly, and
registrations land as Registered to preserve today's behaviour. The
`players.import` gate, the Pending status and the batch audit arrive with the
full rework in PR 6, once the Spond default status decision is approved.
Between those stages the function's gate is `players.manage`, not
`players.import`.

### Export

Export produces CSV or XLSX, generated client side (CSV hand rolled, XLSX via
the same library as import) from data returned by a single RPC:

```
export_players(p_season_id, p_filters)
```

The RPC enforces `players.export`, applies the club scope defined in
`docs/security/registered-players-boundary.md` (read is club wide, no team
arm), and writes the `players.exported` audit event in the same transaction as
the read.

Scope: the default export is the currently filtered list, exactly what is on
screen; exports respect filters, so Withdrawn players are excluded whenever
the active filters exclude them. A secondary, explicit option exports all
records the caller is authorised to access ("Export all I can access"). Both
scopes are bounded to the selected season: `export_players` takes a single
season id, so "all" means every registration in the selected season the caller
may read, which is every registration in the club (read is club wide).
Exporting another season means switching the season selector first.

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
  spreadsheet convention that forces text interpretation. The same prefix is
  also applied to a cell consisting of one or more leading apostrophes
  followed immediately by `=`, `+`, `-` or `@`; this extra condition exists
  so the strip rule below always restores exactly the stored value, closing
  the gap where a stored value beginning with an apostrophe and then a
  trigger character would otherwise export unescaped and import back
  shortened.
- **XLSX**: the cell is written as an explicit text cell, its type never
  formula; the text cell type is the primary defence in that format, and no
  apostrophe prefix is added, because text cells import back verbatim under
  the rule below. Belt and braces across the two formats: no generated cell
  can execute in a spreadsheet application.
- **Round trip rule**: on import from CSV, exactly one leading apostrophe is
  stripped when the rest of the value, ignoring any further leading
  apostrophes, begins with `=`, `+`, `-` or `@`. This covers the plain case
  (stored `=x` exports as `'=x` and strips back to `=x`) and the apostrophe
  prefixed case (stored `'=x` exports as `''=x` under the extra CSV escape
  condition above and strips back to `'=x`). XLSX text cell values are taken
  verbatim with no strip, which is why the XLSX escape adds no prefix.
  Export then import then export is therefore stable in both formats for
  every stored value; no apostrophes accumulate, and a genuine leading
  apostrophe whose apostrophe run does not end at one of those characters is
  untouched in both directions. The tab and carriage return triggers need no
  strip rule: every stored value is trimmed on the way in, by manual entry
  and import alike, so no stored value can begin with either character and
  that escape never fires when exporting stored data.
- On the import side, XLSX formulas are never evaluated; they arrive from the
  parser as inert strings and are treated as invalid cell values (a row
  error), never as data.

### Export confirmation

Every export shows one lightweight confirmation dialog before the file is
generated. It states the record count, the season, the active filters, and the
handling reminder: "Store and share this file securely. It names children."
That string is owned by `docs/product/registered-players-ux.md`; this document
quotes it. One extra click, defensible for child data. Confirming writes the
`players.exported` audit event; the dataset itself is never stored anywhere,
and no download URL exists to retain, because the file is built in the
browser and handed straight to the user.

### Import audit and export audit

Summary of what is recorded; the enforcement architecture (append only table,
trigger writers, transaction local batch context, the private writer function)
is `docs/security/app-audit-boundary.md`, decided in
`docs/adr/ADR-0006-app-audit-events.md`.

Import records:

- One `import_batches` row per import: the client generated batch id, actor,
  club, season, format, state (pending, succeeded or failed) and counts (rows
  received, added, updated, already present, skipped, invalid, all server
  derived). There is deliberately NO file fingerprint: the browser parses the
  file and sends only parsed rows, so the server never receives the bytes and
  cannot verify a client declared hash, which would carry no integrity value
  and is not stored. The batch UUID is the idempotency key and needs none. This
  row is the idempotency record
  (`docs/adr/ADR-0007-player-import-export-architecture.md`,
  `docs/security/app-audit-boundary.md`).
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
  actor, timestamp, format, season, a safe filter summary and the record
  count. Only a successful export produces the event: a failed export rolls
  the transaction back, leaving no dataset and no event, and no separate
  export failed action exists (`docs/security/app-audit-boundary.md`).
- Never recorded: the dataset, any name list, the file, or a download URL.

Spond import records the same shape: per row `player.created` events for new
identities and `player.registration_created` events for the season
registrations, with source `spond_import` and the batch id, plus one
`players.spond_imported` run summary per import
(`docs/security/app-audit-boundary.md`).

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
XLSX (dependency added in the export implementation PR, PR 4, and reused by
import); a two stage workflow
where selecting a file never writes; matching that never merges on name
alone; one transactional, idempotent, all or nothing `import_players` RPC as
the sole commit path; a client generated rejected row report that never
leaves the device; the Spond import moved to `players.import`, landing
Pending registrations in the server chosen current season with batch audit,
staged in two steps per the delivery plan;
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
  the export implementation PR (PR 4 in the delivery plan; the import parser
  in PR 5 reuses it), a deliberate exception to the five package runtime
  dependency list, justified and evaluated in that PR.
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
- Re importing an exported file is a supported, stable round trip: unchanged
  Player ID rows classify as already present and write nothing (no audit
  events), changed rows update, already present detection makes name only
  rows idempotent, the export only Last Updated column is recognised and
  ignored without a warning, and the apostrophe strip rule keeps escaped
  values identical across cycles. Bringing last season's export into a new
  season follows the documented renewal procedure: the Season column is
  cleared or updated first.

## Unresolved items

The relevant numbered decisions from the canonical decision list, each with
its recommended default:

- **2. Coach team scope**: club wide read via `players.view`; team is a
  filter, not an access boundary, so `export_players` reads club wide and the
  0016 standing rule is preserved. Recommended: club wide read (team scoped
  read is the rejected alternative).
- **3. Coach access change**: coaches keep club wide read and lose write (add,
  edit, import), which removes the Spond import trigger from coaches.
  Recommended: coach keeps read, loses write.
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
- **All or nothing import commit** (supplementary): a server side row failure
  aborts the whole transaction rather than skipping the row and reporting.
  Recommended: all or nothing.
- **Spond import season targeting** (supplementary): whether Spond may import
  into a non archived season other than the current one. Recommended: current
  season only, because the organiser account's live subgroup reflects the
  current squad. The spreadsheet import already targets any non archived
  season; this item is only about Spond.

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
- The SheetJS `xlsx` dependency is added in the first implementation PR that
  needs it: PR 4, the export PR, which ships XLSX export and the XLSX
  template and evaluates the dependency there; the import parser in PR 5
  reuses it. Nothing is added by this scoping work.
- The import confirm REUSES the existing Modal `dismissible={false}` contract
  (PR #103, `src/components/ui.tsx`); the import preview UI extends the existing
  plan then confirm prior art (`src/lib/faAttach.ts`, `AttachFAVideosModal`),
  per `docs/product/registered-players-ux.md`.
- The Spond function changes (the PR 2 compatibility change and the PR 6
  rework) follow the repository's Edge Function deploy discipline: deployed
  from the files on disk and verified by reading the deployed source back,
  never trusted from a version number.
- All migration numbers named anywhere in this work are provisional (likely
  0030 onward); the live migration ledger is the source of truth and must be
  confirmed at apply time.
