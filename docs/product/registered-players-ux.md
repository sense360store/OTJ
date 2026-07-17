# Registered players: page and interaction design

Status: Draft for review

Decision owners: Club owner (product); repository maintainer (security and data model)

This document specifies the user interface for the Registered players work: the page that replaces the Roster, its filters, counts and states, the manual add and edit flows, the import and export dialogs, the per player History panel, the club wide Activity page and the admin seasons surface, plus the accessibility contract for all of it. Data model, statuses and capabilities are defined in docs/product/registered-players-spec.md; file formats, matching rules and the import and export architecture in docs/product/registered-players-import-export.md and docs/adr/ADR-0007-player-import-export-architecture.md; access enforcement in docs/security/registered-players-boundary.md; the audit model in docs/security/app-audit-boundary.md and docs/adr/ADR-0006-app-audit-events.md; sequencing in docs/roadmaps/registered-players-delivery-plan.md. This document does not restate those decisions; it states what appears on screen and how it behaves.

Three kinds of statement appear throughout and are labelled: confirmed current behaviour (with citations), proposed product defaults, and unresolved decisions requiring approval (gathered under Unresolved items).

---

## Confirmed current state

All statements in this section are confirmed against the repository on branch main.

### The Roster page being replaced

- Route `/roster`, registered inside the `sessions.create` guard block (src/App.tsx:99, 103). `RequireCap` renders a Splash while capabilities load, then `CapGate` redirects to `/` when the capability is missing (src/components/RequireCap.tsx:16 to 39); there is no transient render of gated content, and the page adds a belt and braces `return null` (src/routes/Roster.tsx:217).
- The page is a single card, max width 620px: a team select defaulting to the first team by name, an add form (Full name, max 40 characters, optional shirt via `parseShirt`, Enter submits), inline row editing with a per row Save, and a hard delete behind a "Remove player" confirm modal (src/routes/Roster.tsx:190 to 324). There is no search, no count, no sort control, no status, no season, no export and no withdraw concept.
- "Import from Spond" shows only when the selected team has a mapping (src/routes/Roster.tsx:260 to 265); the result copy is "{added} added, {alreadyPresent} already on the roster[, {skipped} skipped]." (src/routes/Roster.tsx:156 to 157).
- Data layer: `usePlayers` reads the whole club roster under the single key `['players']`; `useUpdatePlayer` cannot change `team_id`, so moving a player between teams is impossible today; `useDeletePlayer` is a hard delete; no mutation is optimistic and all invalidate on settled (src/lib/queries.ts:3475 to 3548). Move team and Withdraw are therefore new capabilities, not preserved ones.
- Navigation quirk: `screenFromPath` has no `/roster` entry, so the sidebar highlights Home while on the Roster (src/lib/screen.ts:22 to 41). The nav item "Roster" sits in the Plan group of `FULL_NAV` (src/components/nav.ts:58); on mobile it is reachable only through the More sheet.

### Shared UI primitives and their limits

- `Modal` (src/components/ui.tsx) already supports a non dismissible pending state. PR #103 added a `dismissible` prop (default true): `dismissible={false}` makes the window level Escape listener inert, gives the overlay no close handler, and disables the X. The dismissal contract is a pure helper `modalDismissControls`, unit tested in src/components/ui.test.tsx. So the import confirm and pending write modals REUSE `dismissible={false}`; a locked pending state is not new work.
- `ActionError` (src/components/ui.tsx) is the established inline write failure primitive: `role="alert"`, calm generic wording, an optional Retry button, and the rule that the raw error is logged by the caller and never rendered. Player and import write failures reuse it.
- The guarded submit seam exists: `useGuardedSubmit` (src/hooks/useGuardedSubmit.ts) over `createGuardedSubmit` and `logSessionWriteError` (src/lib/sessionSubmit.ts) gives one attempt at a time (duplicate clicks ignored), clear the previous error on a new attempt, an unmount gate so a late settling write never navigates, and safe write logging (operation name and error only, never content). Player single action writes reuse it.
- What Modal still LACKS: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap and focus restore; the X has no `aria-label`. The only `role="dialog"` in the app is the DiagramViewer (src/components/DiagramViewer.tsx). Dialog and focus semantics are therefore the only genuinely new Modal work here; the dismissal and busy behaviour already exist.
- There are no tables anywhere (no `<table>` markup in src), no pagination (every list renders the full query result), and no toast system (no toast code in src); errors are page level `ErrorNote`, inline `ActionError` (role="alert") at the point of action, or nothing.
- Pending button convention: disabled plus a gerund label ("Saving…", "Importing…"); no spinner component exists (styles.css `.btn:disabled`; instances across DrillFormModal, ImportFAModal, Roster).
- State primitives: `Loading` (default "Loading…"), `ErrorNote` (default "Something went wrong loading this. Refresh to try again.") and `Empty` (src/components/ui.tsx:429 to 454).
- Breakpoints: 1080px (detail grids collapse), 900px (sidebar and topbar swap for mobile topbar and bottom nav), 520px (drill grid to two columns) (src/styles.css:431 to 461).
- URL parameter precedent is limited to Planner `?sessionId` (read on load) and Library `?corner` (read once then cleared); no filter, sort or search state persists in any URL today (src/routes/Planner.tsx and src/routes/Library.tsx, useSearchParams call sites).
- Import prior art: `AttachFAVideosModal` is the plan then confirm pattern this design extends: a client side parse, a dry run plan rendered as per row status pills with a totals sentence, a confirm button that echoes the actionable count, per batch progress in the button label, and an outcome view with per item results and a footer that collapses to a single Close (src/components/AttachFAVideosModal.tsx). The FA import modals establish the footer swap convention (`footer={outcome ? null : …}`) and the outcome card style (src/components/ImportFAModal.tsx).
- File download prior art: `downloadSessionIcs` builds the bytes in a pure function, then Blob, `URL.createObjectURL`, a temporary anchor and revoke (src/lib/ics.ts:73 to 85). Export follows this shape.
- Filter bar conventions: `.filterbar` rows, `.search-lg`, sort options labelled inside the select ("Sort: Recent"), `Chip` toggle pills (currently without `aria-pressed`, src/components/ui.tsx, Chip), a count row between filters and grid, and a Clear affordance that appears only when filters are active (src/routes/Library.tsx:138 to 226).

---

## Proposal

### 1. Navigation, route and guard

Proposed product defaults:

- Nav item: "Players" (replacing "Roster") in the Plan group of `FULL_NAV`. Page title: "Registered players". Route: `/players`; `/roster` becomes a redirect to `/players` so bookmarks keep working.
- Guard: `RequireCap cap="players.view"` in the route table, replacing the `sessions.create` wrap for this route. Parents hold no player capability, so the nav item never renders for them and a direct URL hit redirects to `/` after the capability read resolves, exactly as `RequireCap` behaves today (no transient render; see docs/security/registered-players-boundary.md for the RLS that backs this).
- `screenFromPath` gains a `players` entry and the `Screen` union a `'players'` member, fixing the confirmed active state quirk where Home highlights while on the Roster.
- Mobile: "Players" remains a More sheet destination; the bottom nav row is unchanged.
- Page sub line copy: "The club's register for the season. A name, team, status and shirt number only."

### 2. Desktop page anatomy

Top to bottom, all within the standard content column:

**Header.** `.page-head` with `<h2>Registered players</h2>` and the sub line. The right side action row, each button capability gated (the UI surfaces, the RLS enforces):

| Button | Style | Capability | Notes |
|---|---|---|---|
| Add player | btn-primary | players.manage | Opens the add modal |
| Import players | btn-ghost | players.import | Opens the import modal. Renders whenever a non archived season is selected (the spreadsheet import may target any non archived season, defaulting to current) |
| Import from Spond | btn-ghost | players.import | Renders only when the selected season is the current season and the team filter selects a specific team with a Spond mapping (Spond stays current-season-only) |
| Export | btn-ghost | players.export | Opens the export confirmation |
| Download template | btn-quiet | players.import | Downloads the CSV template immediately, no dialog. The button is a small split control: its default action downloads `registered-players-template.csv`, and an adjacent caret offers "Download XLSX template" (`registered-players-template.xlsx`). Both filenames and their identical header row are fixed in docs/product/registered-players-import-export.md |

A viewer with only `players.view` (the recommended coach default) sees none of these; the page is read only for them. On an archived season every mutating button is hidden regardless of capability; Export and Download template are not mutating buttons and remain, stated below.

Spreadsheet import targets any non archived season: the `import_players` RPC accepts any season of the club that is not archived and that the caller may write, defaulting to the current season, so a manager can prepare next season while the current one is still active (docs/product/registered-players-import-export.md, Season column rules). The "Import players" button renders whenever a non archived season is selected; on an archived season it is absent. Import from Spond is the exception: it stays current-season-only (server chosen), so its button follows the current season. Manual writes are refused only on archived seasons, so Add player, the row actions and bulk actions stay available on a future season, gated by capability as usual. Download template is season neutral and renders for `players.import` holders on any season. Export and Download template remain available on an archived season, because neither mutates a record: the export's only write is its own audit event, and the season renewal round trip in docs/product/registered-players-import-export.md may export a past season, which a club may have archived. `export_players` is bounded to the selected season, current or not; exporting another season means switching the season selector first (docs/product/registered-players-import-export.md).

**Season selector.** A select beside the header actions listing every season newest first, current season marked ("2026/27 (current)"), archived seasons included ("2025/26 (archived)"). Selecting an archived season shows the read only banner (state table below); selecting a non current, unarchived season shows the future season behaviour (state table below). Season creation and activation are not on this page; they live on the admin seasons surface at `/admin/seasons` (section 13; capability, RPC and audit semantics in docs/product/registered-players-spec.md, Season management surface).

**Summary counts.** A count row between the header and filters, following the Library convention: "112 players" (total for the selected season within the viewer's scope), then one pill per status showing the word and the count ("Pending 14", "Registered 93", "Withdrawn 5"). Each pill doubles as a shortcut that sets the status filter. When any filter is active a filtered count appends: "Showing 24 of 112".

Count semantics (proposed defaults): the total counts every registration in the selected season the viewer is permitted to read, all statuses included, before the status, team and search filters apply. The per status pills use the same basis. The "Showing X of Y" count reflects all active filters. Counts are computed client side from the season's query result; there is no separate count query at this scale (roughly 75 to 125 registrations a season; see docs/product/registered-players-spec.md, scale).

**Filter bar.** `.filterbar` rows in the repo convention:

- Row 1: `.search-lg` search input, placeholder "Search by name…", plus the sort select with options labelled inside the control: "Sort: Name", "Sort: Team", "Sort: Status", "Sort: Shirt number", "Sort: Registered date", "Sort: Last updated".
- Row 2: filter label "Team", a select with "All teams", each team by name, then "Unassigned". Filter label "Status", a select with "Pending and registered" (default), "Pending", "Registered", "Withdrawn", "All".
- The "Unassigned" option renders for every viewer. Read is club wide via `players.view` (team is a filter, not an access boundary; docs/security/registered-players-boundary.md), so every viewer, coaches included, can read and filter Unassigned registrations, which is what lets coaches see the pool of children awaiting allocation. The board picker's team selector offers Unassigned the same way (eligibility rules in docs/product/registered-players-spec.md, Unassigned players).
- A "Clear (n)" quiet button appears only when any filter differs from its default, resetting search, team, status and sort and removing every URL parameter.

Sort directions are fixed per key, always with player id ascending as the deterministic tiebreak: Name ascending; Team ascending by team name with Unassigned last; Status in the order Pending, Registered, Withdrawn; Shirt number ascending with blanks last; Registered date descending (newest first) with blanks last; Last updated descending. This matches the repo rule that every sort is explicit with an id tiebreak (src/lib/contentOrder.ts).

**The table.** The first real table in the app (confirmed: none exists today), rendered above 900px only: the confirmed mobile switch is `@media (max-width: 900px)`, inclusive (src/styles.css:437), so at exactly 900px the card list renders, never both. Semantic `<table>` with a visually hidden caption "Registered players" and `<th scope="col">` headers. Columns, in order:

| Column | Content |
|---|---|
| Player | Display name, bold. No photo, no initials disc |
| Team | Team name, or "Unassigned" in muted style |
| Status | Badge: coloured dot plus the word Pending, Registered or Withdrawn |
| Shirt number | Mono style, blank when none |
| Registered date | "16 Jul 2026", blank when none |
| Last updated | "16 Jul 2026", full timestamp in the title attribute |
| Actions | Row actions, below |

Status colours reuse existing tokens (Registered green, Pending amber, Withdrawn muted slate); the word is always present, never colour alone. Withdrawn rows, when visible through the filter, render the whole row slightly muted with the badge stating "Withdrawn".

The table never scrolls horizontally, and neither does the page body. Between 901px and 1080px the sidebar is still present and the content column is roughly 600 to 780px wide, which cannot hold all seven columns plus the bulk checkbox; in that band the Registered date and Last updated columns are not rendered. Both values remain reachable through Edit and the History panel, and both remain valid sort keys (the sort select is independent of visible columns; `aria-sort` applies only while its column is rendered). The full seven column table renders above 1080px, the repo's existing wide breakpoint.

**Row actions.** For `players.manage` holders: an "Edit" ghost button, a "History" ghost button, and an overflow menu (icon button, `aria-label` "More actions for {name}") containing "Move team", "Withdraw" or "Restore" (whichever applies to the row's status), and, for `players.delete` holders only, "Delete permanently". A `players.view` only viewer gets History alone. On an archived season only History remains.

**Bulk actions (recommended, explicitly cuttable).** For `players.manage` holders a leading checkbox column enables selection; a selection bar replaces the count row while anything is selected: "3 selected", buttons "Assign team" (opens the team picker, applies to all selected), "Withdraw selected" (opens one confirm dialog naming the count), and "Clear selection". Each bulk write is a sequence of ordinary mutations with the usual invalidation; a partial failure reports "Updated 2 of 3. The rest were not changed." inline in the selection bar. Cut line: bulk actions may be dropped from the page PR without blocking anything else; every bulk operation is reachable through single row actions, and the import flow covers genuine mass changes. No bulk selection on mobile in v1.

**Pagination decision (proposed default).** No pagination or virtualisation for the players list. The whole selected season loads in one query and filters client side, like the Library. At the confirmed club scale (five teams, roughly 15 to 25 players each) a season is one to two hundred rows at most. Audit lists are the opposite decision: the Activity page is server paginated (section 11).

### 3. Mobile page anatomy (at and below 900px)

The table never renders at or below 900px (the 900px media query is inclusive, src/styles.css:437); a card list replaces it, and nothing scrolls horizontally.

**Card anatomy.** One card per player inside a `<ul>` list:

- Line 1: display name, bold, with the shirt number right aligned in mono style ("9"), blank when none.
- Line 2: team name (or "Unassigned"), then the status badge (dot plus word).
- Right edge: an overflow icon button, `aria-label` "Actions for {name}", opening a bottom sheet menu (`role="menu"`, following the More sheet pattern in src/components/BottomNav.tsx, with Escape handling added) listing the same row actions as desktop: Edit, History, Move team, Withdraw or Restore, Delete permanently (capability gated as on desktop).

**Sticky filter bar.** Below the mobile topbar, a sticky row with the search input and a "Filters" button carrying the active filter count ("Filters (2)"). The button opens a bottom filter sheet containing the season selector, team select, status select, sort select and a "Reset" button. The sheet is a dialog (role, focus and Escape behaviour per section 7), not a plain overlay.

**Primary actions.** "Add player" renders as a full width primary button directly under the filter bar for `players.manage` holders; "Import players", "Import from Spond", "Export" and "Download template" sit in a wrapping action row under it, gated and conditioned exactly as on desktop: "Import players" renders whenever a non archived season is selected, "Import from Spond" renders only on the current season and additionally requires the resolved team filter to select a specific team with a Spond mapping. The team filter lives inside the filter sheet, so the Spond button appears in the action row when the sheet's team choice resolves to a mapped team; the button itself always sits in the action row, never inside the sheet, and a shared link carrying `?team=` surfaces it directly (section 5). The summary counts collapse to the total plus the filtered count on one line; the status pills remain, wrapping.

### 4. Page states

Every state below is required, with the proposed on screen copy. Season names in copy are examples.

| State | Trigger | Rendering and copy |
|---|---|---|
| Loading | Season query pending | A lightweight skeleton: grey blocks for the count row and six table rows (cards on mobile). Where the skeleton is not yet built, the shared `Loading` primitive ("Loading…") is the acceptable floor |
| Empty season | Season loaded, zero registrations in the club | `Empty` primitive, title "No players in 2026/27 yet", body "Add the first player, or import a spreadsheet to bring the register across.", with "Add player" and "Import players" buttons rendered per capability (Import players on any non archived season, per section 2); a `players.view` only viewer (a coach) sees the title and body alone. Because read is club wide, an empty list always means the season is genuinely empty, never that rows are out of the viewer's scope |
| No filter results | Registrations exist, filters exclude all | `Empty`, title "Nothing matches", body "Try clearing a filter or searching a shorter name.", with a "Clear filters" button |
| Error | Season or players query failed | `ErrorNote` default copy: "Something went wrong loading this. Refresh to try again." |
| Partial failure | A mutation failed after others succeeded, or a write failed mid flow | The affected modal or selection bar shows an inline red error ("Could not save the change. Try again."); the list is refreshed by on settled invalidation so it always shows the true server state. There is no toast system; errors render inline at the point of action |
| Archived season | Selected season has `archived_at` | A full width banner above the counts: "2025/26 is archived. Records are read only. Switch season to make changes." Every mutating affordance (Add player, the import buttons, row actions other than History, bulk selection) is absent. The surviving affordances are History, Export and Download template, which mutate nothing (section 2) |
| Future season | Selected season is neither current nor archived (created, not yet activated) | Manual work behaves normally: Add player, row actions and bulk actions render per capability, because the database refuses registration writes only on archived seasons. Import players and Import from Spond are absent; the muted line from section 2 explains: "Imports go into the current season. Switch to 2026/27 to import." |
| No teams | Club has zero teams | The team filter offers "All teams" and "Unassigned" only; a muted line under the filters: "No teams exist yet, so every player is Unassigned. An admin can add teams under Admin, Teams." Add and import still work, landing players as Unassigned; any `players.manage` holder can do so, since Unassigned is a normal club wide value (section 6) |
| No current season | Club has no season with `is_current` | For `seasons.manage` holders: `Empty`, title "Set up the first season", body "Players are registered against a season. Create and activate a season to open the register.", button "Set up season" linking to `/admin/seasons` (section 13). For everyone else: `Empty`, title "No season yet", body "The club has no current season. An admin needs to set one up before players can be registered." Import, export and add are unavailable in this state. The migration creates the initial season, so this state only occurs for a hypothetical new club (docs/product/registered-players-spec.md) |
| Permission denied | Capability missing on a direct URL hit | No copy on this page: `RequireCap` renders the Splash while capabilities load, then redirects to `/`, the confirmed existing pattern. Gated content never renders transiently |
| Offline | Network unavailable | The query error path: `ErrorNote` plus retry on refetch. No optimistic writes exist for player mutations; every write button stays busy until the server confirms, so an offline write fails visibly in place and nothing silently diverges |

### 5. Filters, counts and the URL

**URL query parameter scheme (proposed default).** Filters persist in the URL so a filtered view is shareable. This is a new pattern: the confirmed precedent is only Planner `?sessionId` (read) and Library `?corner` (read once then cleared); no filter persistence exists anywhere today.

`/players?season=&team=&status=&q=&sort=`

| Parameter | Values | Default when omitted |
|---|---|---|
| `season` | Season uuid | The current season |
| `team` | Team uuid, or the literal `unassigned` | All teams |
| `status` | `pending`, `registered`, `withdrawn`, `all` | The default pair, Pending and Registered |
| `q` | Search text, URL encoded | Empty |
| `sort` | `name`, `team`, `status`, `shirt`, `registered`, `updated` | `name` |

Rules:

- Defaults are never written to the URL; a fresh visit to `/players` has no query string.
- All parameter writes use replace state so filtering never fills browser history; `q` is additionally debounced (around 300 ms) so keystrokes do not thrash the URL.
- Unknown or inaccessible values (a deleted team, a season from another club, a misspelled status) fall back silently to the default and the parameter is removed. A shared link can therefore never error the page or leak a foreign id into a request. `team=unassigned` is a valid filter for every viewer (read is club wide, section 2), so it resolves normally.
- "Clear (n)" and the mobile "Reset" remove every parameter and return every control to its default.
- The team filter driving the "Import from Spond" affordance reads the resolved `team` value, so a shared link to a mapped team surfaces the button for an authorised viewer when the selected season is the current one.

**Names in the `q` parameter (assessed and accepted, proposed default).** A name search is usually a child's name, so persisting `q` puts that text where URLs go: the address bar and any bookmark on the device, any link a member chooses to share, and the hosting provider's request logs when a deep link is loaded as a full page request. This exposure is accepted deliberately and narrowly, and it is consistent with the audit documents' refusal to record search strings: that rule keeps the string out of the club's own records and server side logs (docs/security/app-audit-boundary.md, Export audit), and nothing here changes it, because the URL parameter never reaches the database or the audit trail. The residual is local browser state plus hosting request logs, analogous to the exported file residual the threat model accepts (docs/security/registered-players-threat-model.md, T21), and it is bounded: parameter writes use replace state so typing never fills history, `q` is present only while the search box is non empty, Clear and Reset remove it, and a shared link carrying a name is a deliberate act by a signed in member whose recipients still face the capability gate and RLS. If review rejects this residual, the fallback is dropping `q` from the URL scheme and keeping search in component state; season, team, status and sort still make views shareable, and no other decision reopens.

Withdrawn rows are hidden by default (the default status pair), which is the product decision recorded in docs/product/registered-players-spec.md; exports respect the active filters (section 9), so a default export excludes withdrawn players unless the viewer widens the filter first.

### 6. Manual add and edit

All flows follow the repo modal convention (conditional render, footer with Cancel then primary, pending gerund labels, inline `ActionError` at the point of action). No player mutation is optimistic: confirmed writes only, the button stays busy until the server answers, matching the confirmed current data layer, and each single action write is wired through `useGuardedSubmit` (section 7). Every mutating modal passes `dismissible={!mutation.isPending}` (the existing prop from PR #103, section 7) so a write in flight cannot be dismissed. Every committed change writes audit events server side through triggers; nothing in this section asks the client to log anything (docs/security/app-audit-boundary.md).

**Add player modal.** Title "Add player", sub the season name. Fields:

- Full name: required, 1 to 40 characters, autofocus. Helper: none; the placeholder is "Full name".
- Team: select, defaulting to the page's current team filter when a specific team is selected, otherwise "Unassigned". Options are club wide: any `players.manage` holder sees Unassigned plus every team, because writes are club scoped with no team arm (docs/security/registered-players-boundary.md). The default is the page's team filter, or Unassigned when the filter is All teams or Unassigned.
- Status: select, "Pending" (default) or "Registered". Withdrawn is not offered on create.
- Shirt number: optional, 1 to 99, numeric input, `aria-invalid` plus the existing sentence "Shirt number must be a whole number from 1 to 99." when invalid.
- Registered date: optional date input. Helper: "Filled in automatically when the player is marked registered. Set it here for a backdated paper registration."

Inline warnings, shown before save and never blocking it:

- Duplicate name: "A player named {name} already exists in 2026/27 ({team or Unassigned}). Adding another creates a separate player." (Never auto merged; the rule is a warning, not an error.)
- Duplicate shirt: "Number {n} is already worn by another player on this team."

Footer: Cancel; "Add player" with pending label "Adding…". Failure keeps the modal open with the inline error "Could not add the player. Try again." (or the server's message). Success closes and invalidates.

**Edit player modal.** Same fields prefilled, title "Edit player", sub the player's name. The team select is scoped exactly as in Add player. The status select offers only the transitions valid from the current status (Pending: Pending, Registered, Withdrawn; Registered: Registered, Withdrawn; Withdrawn: read only text "Withdrawn", with the hint "Use Restore to bring this player back."). Choosing Withdrawn in this select does not withdraw on Save directly: it routes through the same confirmation dialog as the row Withdraw action ("Withdraw {name}? They stay in history and can be restored."), so a withdrawal is never a silent side effect of an edit. Transition rules are enforced server side; the select merely avoids offering an invalid choice. Pending label "Saving…"; failure copy "Could not save the change. Try again."

**Move team.** The overflow action opens a small modal, title "Move team", sub the player's name, a single team select offering Unassigned plus every club team (club wide, as in Add player), footer Cancel and "Move" ("Moving…"). Also achievable through Edit; the dedicated action exists because it is the most common correction.

**Withdraw.** Confirm dialog, title "Withdraw player", sub the player's name. Body: "This marks {name} as withdrawn for 2026/27. The record keeps its team, shirt number and history, and can be restored later. Nothing is deleted." Footer: Cancel; "Withdraw" ("Withdrawing…") in the destructive style.

**Restore.** Dialog, title "Restore player", sub the player's name. Body: "Bring {name} back into 2026/27." A radio pair: "As pending" (default) and "As registered". Footer: Cancel; "Restore" ("Restoring…").

**Delete permanently.** Admin only (`players.delete`). Dialog, title "Delete player permanently", sub the player's name. Body: "This permanently removes {name} and every season registration from the club's records. The activity history keeps a neutral Deleted player entry with no name. Any saved board disc that referenced them shows a number with no name. This cannot be undone. Withdraw is the normal way to remove a player from a season." A typed confirmation field labelled "Type DELETE to confirm"; the destructive button "Delete permanently" ("Deleting…") stays disabled until the exact word is typed. Whether normal removal is deletion or anonymisation is an unresolved decision (Unresolved items, item 9); this dialog is the recommended deletion default.

### 7. Modal accessibility baseline: dialog and focus semantics (the only new shared UI work)

Confirmed: the non dismissible pending behaviour ALREADY EXISTS. PR #103 added the `dismissible` prop to `Modal`, so `dismissible={false}` freezes Escape, the overlay and the X (src/components/ui.tsx, `modalDismissControls`, tested in src/components/ui.test.tsx). The import confirm and the pending write flows REUSE it; there is no new locked mode to build. What does not exist yet is dialog and focus semantics (`role="dialog"`, `aria-modal`, focus trap, focus restore), so THAT is the genuinely new shared UI work in src/components/ui.tsx, delivered with the players page PR and benefiting every existing modal. See docs/roadmaps/registered-players-delivery-plan.md.

**Baseline (applies to every Modal, existing callers included):**

- `role="dialog"` and `aria-modal="true"` on the modal element; `aria-labelledby` wired to a generated id on the title heading, and `aria-describedby` to the sub line when present.
- Focus moves into the dialog on open: to the first focusable element, or to the dialog container (`tabIndex={-1}`) when there is none. Existing `autoFocus` conventions on first inputs continue to work and take precedence.
- A focus trap while open: Tab and Shift Tab cycle within the dialog.
- Focus restore: on close, focus returns to the element that opened the dialog. When that element no longer exists (the dialog's own action removed it: the row disappeared after Withdraw, Delete permanently or a Move team out of the filtered list), focus moves to a stated fallback in order: the equivalent control on the next row, else the list or table container (`tabIndex={-1}`), else the page heading. Keyboard and screen reader users are never dropped to the document body after a destructive confirmation.
- The Escape handler moves from the window to the dialog scope so stacked overlays no longer all close at once (a confirmed defect of the window listener pattern).
- The close X gains `aria-label="Close"`, matching the sheet and viewer close buttons.

**Non dismissible pending state (reuses the existing `dismissible` prop):**

- The existing `dismissible={false}` (src/components/ui.tsx) already makes Escape inert, the overlay non closing and the X disabled. Callers remain responsible for disabling their own footer and body controls, per the existing pending convention. No new prop is added.
- Focus must not be stranded while non dismissible: the pressed confirm button becomes disabled and the X disabled, which in most browsers would drop focus to the document body, defeating the trap. When a modal becomes non dismissible, focus moves to the dialog container (`tabIndex={-1}`) so the trap always holds a valid target. This focus behaviour is part of the new dialog and focus baseline above, not part of the pre existing dismissible prop.
- Any modal that runs a mutation passes `dismissible={!mutation.isPending}`, and wires the mutation through `useGuardedSubmit` (src/hooks/useGuardedSubmit.ts) so a duplicate click is ignored, the previous error clears on retry, and a late settling write never navigates after the surface has gone. The import confirm and export generation are the mandatory users; player write modals adopt it as the proposed default so no write can be orphaned by a dismissal mid flight.
- A non dismissible modal must tell the user why it will not close: the body shows a progress sentence, and an `aria-live="polite"` region inside the dialog announces the transition into and out of the busy state (for example "Importing. Do not close this window." then the outcome sentence). On completion, focus moves to the outcome's primary button (Done or Close).

### 8. Import workflow (modal and preview)

The two stage flow is defined architecturally in docs/adr/ADR-0007-player-import-export-architecture.md and docs/product/registered-players-import-export.md: stage 1 parses and validates entirely client side and writes nothing; stage 2 is one explicit confirmation calling one transactional RPC with a client generated batch id, all or nothing, idempotent on retry. This section specifies the screens. The closest confirmed prior art is AttachFAVideosModal's plan then confirm shape (client side parse, per row status pills, a confirm button echoing the actionable count, per item outcome, footer swap); this design extends it.

**Entry.** "Import players" opens a wide Modal, title "Import players", sub "Into {selected season}". The button renders whenever the page's selected season is not archived (section 2), so the sub names the season being imported into, which defaults to the current season but may be a future season the club is preparing. The `import_players` RPC revalidates the target independently and refuses an archived or cross club season (docs/product/registered-players-import-export.md). On an archived season the button is absent (sections 2 and 4).

**Stage 0, pick.** A dashed dropzone accepting `.csv` and `.xlsx`, containing a real, visibly focusable "Choose file" button that opens the file picker; the button is the accessible entry to the whole import and drag and drop is an enhancement, never the only mechanism. The confirmed prior art dropzone is a click only div over a hidden input (src/components/AttachFAVideosModal.tsx:184 to 190) and must not be copied verbatim; copied as is it would fail the section 12 rule that no surface is click only. Copy inside: "Choose a CSV or XLSX file. Nothing is written until you confirm." Below the dropzone: a "Download template" quiet button (the same split control as the header, CSV by default with an XLSX option, per docs/product/registered-players-import-export.md), and two fixed muted sentences: "The file is read on this device. It is never uploaded or stored." and "Up to 500 rows. CSV up to 1 MB, XLSX up to 2 MB." Selecting a file replaces any previous selection and re runs the preview (each pick replaces the plan, per the AttachFAVideos convention). Files that fail the format gate (wrong extension, oversized, password protected, macro content) produce a single inline error naming the reason ("This file is password protected and cannot be read.") and no preview; the full rejection list is in docs/product/registered-players-import-export.md.

**Stage 1, preview.** After parsing, the body shows:

- A summary sentence built from the authoritative five category partition (every data row is exactly one of new, update, already present, needs your choice, invalid; the five counts sum to the total, as fixed in docs/product/registered-players-import-export.md): "18 rows: 12 new, 3 updates, 1 already present, 1 needs your choice, 1 invalid." Warnings are an overlay on those rows, not a sixth category, so they are stated separately: "2 of these carry warnings." Only non zero categories are mentioned. Blank rows are noted separately when skipped: "2 blank rows skipped."
- Preview filter chips: All, New, Updates, Already present, Warnings, Needs your choice, Invalid. Each chip carries its count and toggles the row list to that category. Chips use `aria-pressed`.
- The row list, one bordered row per data row: a coloured status pill with the word ("Will add" green, "Will update" blue, "Already present" slate, "Warning" amber, "Needs your choice" amber, "Invalid" red), the player name from the file, and a muted detail line stating the reason in plain language. A "Needs your choice" row also carries two inline controls, "Skip" and "Import as new", so the user resolves the collision without leaving the preview; until one is picked the row is not counted in the actionable total. Examples of detail lines: "Unknown team 'U8 Tigers'"; "Season '2025/26' does not match 2026/27"; "Registered Date '31/13/2025' is not a date"; "Same name as row 12 in this file; choose Skip or Import as new"; "Possible duplicate: same name on U8 Trojans; choose Skip or Import as new"; "Player ID does not belong to this club".
- When any warning, needs your choice or invalid rows exist: a "Download rejected and warning rows (CSV)" button, with the adjacent sentence "The report contains the player names from your file so you can correct them. It stays on this device." The report is generated client side and never uploaded (its columns and the privacy reasoning are in docs/product/registered-players-import-export.md).
- Rows the preview marks invalid, already present, resolved to Skip, or left unresolved are never sent to the server; the confirm covers only the actionable rows (valid new, valid updates, and needs your choice rows resolved to Import as new).

Cancelling at this stage is always safe and discards everything, stated in the modal: selecting a file never writes.

Footer: Cancel; the confirm button, disabled unless at least one row will be added or updated, labelled with the actionable count: "Import 15 rows" (singular handled).

**Stage 2, confirm.** On confirm the modal becomes non dismissible via `dismissible={false}` (section 7): no Escape, no overlay dismissal, the X disabled, Cancel disabled, the dropzone, chips, list and report link inert. The confirm button reads "Importing…" and a progress sentence renders under the list: "Importing. Do not close this window." Repeated confirmation is blocked twice over: `useGuardedSubmit` ignores a second attempt while one is in flight and the button is disabled, and the batch id makes a repeated call return the stored result without re applying (confirmed design in docs/adr/ADR-0007-player-import-export-architecture.md).

**Stage 3, outcome.** The body swaps to the result (footer swap convention) and the footer collapses to a single "Done" primary.

- Success: a green check disc and the summary using the six word outcome vocabulary fixed in docs/product/registered-players-import-export.md (added, updated, already present, skipped, rejected, with warnings noted separately): "Imported into 2026/27: 12 added, 3 updated, 1 already present, 1 skipped, 1 rejected." Here skipped counts the already present and Skip resolved rows and rejected counts the invalid row, kept distinct rather than merged. Followed by the batch reference and time in muted mono style: "Import 3f2a91c8, 16 Jul, 14:32". Where the viewer holds `audit.view`, "View in Activity" links to `/activity?batch={id}`. The link ships with the Activity page: the import modal lands in delivery plan PR 5 and the `/activity` route in PR 7, so until the route exists the outcome shows the batch reference as plain text and offers no link (docs/roadmaps/registered-players-delivery-plan.md).
- Failure: the import is all or nothing (unresolved decision, recommended default), so the copy is unambiguous: a `role="alert"` block reading "Nothing was imported. {reason}." with reasons in plain language ("A team in the file was deleted since the preview. Re open the file to refresh the preview."). There is no Try again button: a failed batch id is a terminal record, and a repeated confirm of it returns the stored failure without re running anything (docs/adr/ADR-0007-player-import-export-architecture.md, failure behaviour). Recovery follows the reason copy: re open the file, which re parses, refreshes the preview and mints a new batch id for the corrected attempt.
- A lost response then retry resolves to the stored result: the user sees the normal success view, never a duplicate import.

The outcome sentence, success or failure, is announced through the modal's `aria-live` region (section 12).

**Import from Spond (dialog).** The Spond affordance carries over from the Roster's confirm first modal (src/routes/Roster.tsx:125 to 188) with its gate moved to `players.import` and its copy updated for seasons; the function change itself is scoped in docs/product/registered-players-spec.md and the delivery plan (PR 6, whose accessibility checks this section satisfies). Title "Import from Spond", sub the team name. Confirm body: "This brings over player names from the mapped Spond group {group} into 2026/27 for {team}. Each child's full name is stored. No guardian, contact or other Spond data is imported. New players land as Pending." (the Pending sentence follows unresolved decision 6's recommended default), with the muted line "Players already in 2026/27 on this team are left as they are, so importing again adds no duplicates." The season named is always the current season: it is chosen server side, the client sends no season, and the function refuses when the club has none. Footer: Cancel; "Import" ("Importing…"). While importing the modal is locked (section 7). The outcome swaps the body and collapses the footer to Done: "Imported into 2026/27: {added} added, {alreadyPresent} already present, {skipped} skipped.", announced through the modal's live region like the file import outcome. Failure renders a `role="alert"` block, "Nothing was imported. {reason}."; the reworked commit path is transactional, so a failure writes nothing and retrying is safe.

### 9. Export dialog and template download

"Export" opens a small Modal, title "Export players", sub the season name. Confirmed prior art for the download itself is the .ics path (pure builder, Blob, temporary anchor); the dialog exists because this file names children.

Body:

- Scope radio: "Filtered list (24 players)" (default, reflecting the page's active filters, withdrawn included only when the filter includes them) and "Everything I can access (112 players)".
- Format radio: "CSV" (default) and "XLSX".
- A muted line restating the context: "2026/27, U8 Titans, Pending and registered." (or "All teams, all statuses" for the full export).
- The fixed reminder sentence, always rendered: "Store and share this file securely. It names children." This document owns the exact string; sibling documents quote it rather than restating it.

Footer: Cancel; "Export CSV" or "Export XLSX" per the format choice, pending label "Preparing…", locked while generating. The data comes from the export RPC, which enforces the capability, applies the viewer's scope and writes the audit event in the same transaction as the read; the file is then assembled and downloaded client side and never stored (docs/product/registered-players-import-export.md). On success the download starts, the dialog closes, and a page level, visually hidden `aria-live="polite"` region announces "Export downloaded, 24 players." (the region lives outside the dialog so the announcement survives the close; delivery plan PR 4 requires download completion to be announced). The same page level region announces "Template downloaded." for the header's Download template button, which has no dialog. On failure the dialog stays open with "Could not export. Try again." Column order, file naming, formula escaping and date formats are fixed in the import and export document and are not restated here.

### 10. Per player History (panel)

The "History" row action opens a Modal (the repo's only overlay primitive; a side drawer is a possible later refinement, Alternatives below), title the player's name, sub "History". Access rides `players.view` (club wide read) through the dedicated per player history path, so a coach sees any club player's history without holding `audit.view` (docs/security/app-audit-boundary.md; separate access paths are unresolved decision 15). A child linked history row is pseudonymous child personal data, so this gate is a real access control.

Entries render newest first as bordered rows: a muted mono timestamp ("16 Jul, 14:32"), the actor, and the event description. The actor cell shows the member's name snapshot for manual changes and the source label for imported changes, with the batch reference beneath ("Import 3f2a91c8"). Example entries, exactly the intended rendering:

- 16 Jul, 14:32 / Mark Taylor / Registration changed: Pending -> Registered
- 15 Jul, 10:18 / Neil McRae / Team changed: Unassigned -> U8 Titans
- 14 Jul, 09:05 / CSV import / Player record created

Rendering rules:

- Names resolve at read time: team names come from the current teams list, actor names from the stored snapshot (which survives profile deletion by design).
- A deleted team renders as "Deleted team" ("Team changed: Deleted team -> U8 Titans").
- A display name correction renders as "Player name corrected" with no values, because historic child names are never stored in audit payloads (docs/security/app-audit-boundary.md; unresolved decision 7).
- Shirt and date changes render with values ("Shirt number changed: 7 -> 9"; "Registered date set: 14 Jul 2026"), since these are on the approved safe field list.
- Empty state: a muted line, "No changes recorded yet."
- Loading and error use the shared primitives inside the modal body.

The Activity page (next section) shows the same events club wide; the History panel is the per child slice and adds no data of its own.

### 11. Club wide Activity page

Route `/activity`, guarded by `RequireCap cap="audit.view"`, nav item "Activity" surfaced only to holders (managers and admins by default; parents never, and coaches only if granted). Page title "Activity", sub "Who changed what, across the club."

**Filters** (same visual conventions as section 2): date range (From and To date inputs), Actor (member select), Entity (Player, Season, Import, Export; mapping one to one onto the entity type vocabulary in docs/security/app-audit-boundary.md, with Import meaning `import_batch`; grows as audit rolls out to other domains), Action, Team, Season, Source (one option per value in the source vocabulary: Manual, CSV import, XLSX import, Spond import, Renewal, System, Edge function, Database trigger), and an import batch filter reachable by deep link (`/activity?batch={id}`) from import outcomes and History entries. The last two source options are operational rather than product flows: Edge function and Database trigger cover server side and maintenance writes (service role work, a corrective migration running after the triggers attach) whenever they occur, and the list renders their rows like any other, so no event in the feed is unfilterable. Either option may legitimately match nothing at launch: the schema backfill deliberately writes no audit events, the migration itself being its record (docs/security/app-audit-boundary.md, source derivation; docs/roadmaps/registered-players-delivery-plan.md, Data migration plan), so the first Database trigger event appears only when such a write first happens. The `batch` parameter is the only URL persisted filter on this page in v1.

**List.** Newest first, deterministic (occurred at descending, id descending as tiebreak). Each row: timestamp, actor (name snapshot), event description in the History grammar, entity reference, source, batch reference where present. Entity references resolve at read time; deleted entities render neutrally as "Deleted player" or "Deleted team", never a stored name. Where the entity still exists and has a surface, the reference is actionable: a player entry offers "View history", opening the same History panel by player id; an import entry links to its batch filter.

**Pagination.** The first server pagination in the app (confirmed: none exists): pages of 50 fetched from the server, a "Load more" button appending the next page. No page numbers, no infinite scroll. The full history is never downloaded to the browser.

**States.** Loading (shared primitive), error (`ErrorNote`), empty ("No activity in this range." with a "Clear filters" button when filters are active, otherwise "No activity yet.").

**Mobile.** Rows render as cards with the same content; filters collapse into the section 3 filter sheet pattern.

**Not in v1.** No export of the audit feed; nothing in the club's operations needs it and it would be a second export surface to protect. Revisit only with a concrete need.

### 12. Accessibility

Confirmed baseline: the app has aria labels on icon buttons, `aria-invalid` on the roster shirt inputs, `aria-live` on UploadProgress, the reusable `ActionError` primitive (`role="alert"`), the `dismissible` Modal prop (PR #103) and `autoFocus` on first modal inputs; it has no dialog semantics on Modal, no focus management, no `aria-pressed` on Chip, no tables and no `aria-sort`. The dialog and focus requirements below are therefore new work; the non dismissible behaviour and the inline alert surface already exist and are reused.

**Filters.** Every filter control has a visible label (the `.filter-label` pattern) and a programmatic one (a `label` element or `aria-label`). The status and preview chips set `aria-pressed`, extending the shared Chip component (a confirmed gap today). The mobile Filters button carries its active count in the accessible name ("Filters, 2 active").

**Table and list.** The desktop table is a semantic `<table>` with a visually hidden caption and `<th scope="col">` headers; the active sort column sets `aria-sort="ascending"` or `"descending"`, driven by the sort select (headers themselves are not clickable in v1). The mobile card list is a `<ul>`; each card's accessible name starts with the player's name. Status is never colour alone: the badge always contains the word. Row action buttons are individually named: "Edit {name}", "History for {name}", "More actions for {name}".

**Keyboard.** Every affordance is a button or link; there are no click only surfaces. The per card and per row action menus, and only they, follow the menu pattern (`role="menu"`, `role="menuitem"`), add Escape to close (the confirmed More sheet lacks it), and return focus to their trigger on close. The mobile filter sheet is not a menu: it contains form controls (season, team, status and sort selects plus Reset), which menu semantics would break for assistive technology, so it uses the section 7 dialog semantics instead (`role="dialog"`, `aria-modal`, focus trap, Escape, focus returned to the Filters button), matching section 3. The sticky mobile filter bar sits in natural DOM order.

**Modals.** All dialog behaviour per section 7: `role="dialog"`, `aria-modal`, labelled by the title, focus in on open, trapped while open, restored on close. While non dismissible (the existing `dismissible={false}`), the suppressed dismissal is compensated by the visible progress sentence and the `aria-live` announcement, and focus lands on the outcome's primary button when the work finishes.

**Import preview and result.** The preview summary is plain text, not an inference from colour; each row's problem is a text detail line adjacent to the name. When parsing completes, an `aria-live="polite"` region announces the summary sentence, built from the same five category partition ("Preview ready. 18 rows: 12 new, 3 updates, 1 already present, 1 needs your choice, 1 invalid. 2 carry warnings."). When the commit completes, the same region announces the outcome sentence ("Imported into 2026/27: 12 added, 3 updated, 1 already present, 1 skipped, 1 rejected."). Failures render in a `role="alert"` block so they announce immediately. Inline save failures in the manual modals also use `role="alert"`.

**Bulk selection** (applies only if bulk actions ship; section 2 marks them cuttable). Each row checkbox is individually named "Select {name}"; the header checkbox is named "Select all players". The selection bar is an `aria-live="polite"` region, so selection count changes announce ("3 selected"), and its partial failure sentence renders in a `role="alert"` block like every other failure surface. If bulk actions are cut, this contract goes with them.

**Pending states.** Buttons keep the confirmed convention (disabled plus gerund label); because a disabled button's label swap is not reliably announced, the modal's live region carries the state change for assistive technology.

**Downloads.** Every download completion is announced: export success and the template download through the page level polite live region (section 9), and the rejected row report through the import modal's live region ("Report downloaded.").

**Downloadable report.** The rejected row report control is a real button labelled exactly by its visible text, "Download rejected and warning rows (CSV)", never a bare icon, with the adjacent sentence stating that it contains player names from the uploaded file. The accessible name matches the visible text (no diverging `aria-label`). The export dialog's download buttons name the format ("Export CSV").

### 13. Admin seasons surface

Seasons are created, activated, archived and unarchived on a dedicated admin page, never on the players page. The capability, the `activate_season` RPC and the audit semantics are defined in docs/product/registered-players-spec.md (Season management surface); that section delegates layout, states and copy to this document. The surface ships in the same PR as the players page (docs/roadmaps/registered-players-delivery-plan.md, PR 3), so the "Set up season" call to action always has a target and the first live season activation has a supervised UI path.

Proposed product defaults:

- Route `/admin/seasons` behind `RequireCap cap="seasons.manage"`, following the `/admin/teams` pattern; the nav item "Seasons" sits with the admin items and never renders for non holders (admin only under the recommended default grant, unresolved decision below). Page title "Seasons", sub "Create and activate the club's seasons. Activation switches the whole club."
- The list renders every season newest first as bordered rows: name, date range ("1 Aug 2026 to 31 Jul 2027"), a "Current" badge on the current season and a muted "Archived" badge on archived ones.
- Per row actions by state: the current season offers Edit only (archiving the current season alone is refused by design); a non current, unarchived season offers Edit, "Make current" and "Archive"; an archived season offers "Unarchive" only, so returning it to service is two audited steps, unarchive then Make current.
- Create: a "New season" primary button opens a modal: name (required, 1 to 20 characters, unique in the club, placeholder "2027/28"), start date and end date (both required, end after start). Inline errors mirror the constraints ("A season named 2027/28 already exists."). Creating never changes the current season; the new row appears with neither badge and the players page treats it as a future season (section 4). Footer: Cancel; "Create season" ("Creating…").
- Edit: the same modal prefilled, title "Edit season", saving name and date corrections only ("Save" and "Saving…"); it never touches `is_current` or `archived_at`.
- Activate: "Make current" opens a confirmation naming both seasons and stating the consequence. Body: "Make 2027/28 the current season? The players page, board seeding, imports and exports switch to it." Beneath the body a checkbox, "Also archive 2026/27. Its records become read only.", unticked by default: archiving the outgoing season is an explicit option on the `activate_season` call, never automatic, and the default leaves the outgoing season open for late corrections during the changeover (docs/adr/ADR-0005-registered-players-and-seasons.md). While the checkbox is ticked the body gains the sentence "2026/27 is archived and becomes read only." and the call archives the outgoing season in the same transaction, writing `season.archived` alongside `season.activated`. Unticked, the outgoing season stays non current and writable and can be archived later with its row action. The whole change is one `activate_season` call either way. Footer: Cancel; "Make current" ("Switching…").
- Archive: confirmation "Archive 2025/26? Its records become read only. You can unarchive it later." Unarchive: confirmation "Unarchive 2025/26? Its records become editable again. This is recorded in the club's activity." Buttons "Archive" ("Archiving…") and "Unarchive" ("Unarchiving…").
- With zero seasons the list shows `Empty`, title "No seasons yet", body "Create a season, then make it current to open the register.", with the "New season" button. This is where the players page's "Set up season" button lands.
- Every modal here follows the section 7 dialog baseline and passes `locked` while its mutation is pending. The page performs no registration work of any kind; every action is audited server side (`season.created`, `season.updated`, `season.activated`, `season.archived`) and surfaces on the Activity page for `audit.view` holders.

---

## Alternatives

- **Card grid instead of a desktop table.** Matches the repo's existing look but hides comparison across seven data columns and makes sorting meaningless at a glance. Rejected; cards remain the mobile rendering, which keeps the no horizontal scroll rule.
- **Clickable column header sorting.** Common in table UIs, but the repo's sort convention is a labelled select, and header sorting adds keyboard and `aria-sort` complexity for no additional capability. Deferred; `aria-sort` still reflects the select's choice.
- **A toast system for mutation errors.** Would give partial failures a global surface, but the repo has none and inline errors at the point of action are more accurate. Rejected for this work; if a toast system ever lands it is a separate shared UI decision.
- **A side drawer primitive for History.** A drawer keeps the list visible behind the panel. The repo has no drawer and the Modal carries the same content today. Deferred; the History content contract is identical either way.
- **Session state or localStorage for filters instead of the URL.** Simpler, but the task requires shareable views, and URL state costs little given the small parameter set. Rejected.
- **Pagination or virtualisation for the players list.** Unnecessary at one to two hundred rows a season and would complicate client side filtering and counts. Rejected for players; adopted for the Activity page where volume grows without bound.
- **Allowing the import modal to stay dismissible while confirming.** Permits an orphaned in flight import with a lost result, the exact confusion the two stage flow exists to prevent. Rejected; the existing `dismissible={false}` prop is used while the confirm is in flight.
- **Edge Function or server side parsing for the preview.** Rejected in docs/adr/ADR-0007-player-import-export-architecture.md; noted here only because it would have changed the preview UX (upload progress, server round trip per file). The chosen browser side parse keeps the preview instant and the file on the device.

## Decision

Adopt the page, flows, states, copy and accessibility contract above as the UX for Registered players, delivered in the phases set by docs/roadmaps/registered-players-delivery-plan.md: the page, filters, manual operations, History panel and the admin seasons surface in the page PR; the export dialog with the template in the export PR; the import modal and preview (reusing the existing `dismissible` prop) in the import PR; the Spond import dialog rework and Renew in the Spond PR; the Activity page in its own PR. The Modal dialog and focus accessibility baseline lands with the page PR and benefits every existing modal; the non dismissible pending behaviour it uses already exists. All copy in this document is the proposed default and may be tuned at review without reopening the design; the states, gating and announcement requirements are the contract.

## Consequences

- The app gains four firsts: a semantic table, URL persisted filters, a locked modal mode, and server pagination (Activity). Each is specified against a confirmed absence, so implementers are building new shared patterns, not copying existing ones.
- The shared Modal upgrade changes every existing modal's semantics (dialog role, focus trap, scoped Escape). This is a deliberate accessibility improvement with a small regression surface: stacked overlay Escape behaviour changes from all close to top close.
- The Roster's hard delete disappears from normal flows; Withdraw and Restore replace it, and Move team becomes possible for the first time (confirmed impossible in today's data layer). The old page's Spond import affordance carries over with its gate moved to `players.import`.
- What each role sees depends directly on unresolved decisions 2 and 3: if coach access is not reduced, coaches see the mutating affordances club wide and the read only description of the coach view in section 2 does not apply.
- Withdrawn players are invisible by default; a coach looking for a withdrawn child must widen the status filter. The count pills make the withdrawn count visible at all times to limit surprise.
- The no toast decision means partial bulk failures surface only in the selection bar; if bulk actions are cut, this consequence disappears.
- `/roster` bookmarks survive through the redirect; the nav active state defect for the roster is fixed as a side effect of the new `screenFromPath` entry.

## Unresolved items

The numbered decisions below are the subset of the canonical list that shapes this document, each with the recommended default. The full list and their owners are in docs/product/registered-players-spec.md.

- 2. Coach team scope: recommended club wide read via `players.view` (team is a filter, not an access boundary; the 0016 standing rule is preserved). A coach's page shows the whole club register, and board name resolution is club wide. The team scoped read is the rejected alternative.
- 3. Coach access change from today's `sessions.create` powers: recommended coach keeps club wide read and loses write; determines whether coaches see Add, Import, Export and the row write actions at all (read, including History, stays club wide either way).
- 6. Spond import default status: recommended Pending; determines the status badge new Spond imported rows carry and the wording of the Spond import result.
- 7. Historic name retention in audit: recommended no values recorded; determines that History renders "Player name corrected" with no before and after.
- 9. Permanent deletion versus anonymisation: recommended true deletion, admin only; determines the Delete permanently dialog and its consequence copy.
- 10. Season renewal mechanism: recommended a bulk Renew action copying registrations into the current season as Pending with team and shirt carried; a UI surface for it lands late in the plan and is not specified in this document beyond the expectation that it follows the non dismissible modal and batch conventions.
- 11. Pending players on boards via an explicit toggle: recommended yes; a board picker concern, noted here because the status badge semantics must match (docs/product/registered-players-spec.md).
- 14. Archived season absoluteness: recommended read only with an admin unarchive escape hatch; determines the archived banner and the removal of all mutating affordances.
- 15. Club wide `audit.view` versus a separate per player history path: recommended separate paths; determines that the History row action works for coaches while the Activity page stays manager and admin.
- All or nothing import commit (unnumbered in the canonical list): recommended all or nothing; determines the failure copy in section 8 ("Nothing was imported.") and the absence of any partial result state.
- `seasons.manage` default holders (unnumbered): recommended admin only; determines who sees the "Set up the first season" call to action and the `/admin/seasons` surface (section 13).

## Implementation dependencies

- Capability keys (`players.view`, `players.manage`, `players.import`, `players.export`, `players.delete`, `audit.view`, `seasons.manage`), their default grants and the players domain RLS: docs/security/registered-players-boundary.md. The page renders nothing useful until the catalogue and policies exist.
- The seasons table, the identity and registration split, and the backfill: docs/product/registered-players-spec.md and docs/adr/ADR-0005-registered-players-and-seasons.md. Migration numbers are provisional (likely 0030 onward) and the live migration ledger must be confirmed at apply time; file names on disk are not the source of truth.
- The audit foundation, the per player history access path and the Activity read with server pagination: docs/security/app-audit-boundary.md and docs/adr/ADR-0006-app-audit-events.md.
- The import and export RPCs, batch idempotency, parsing rules, template and report formats: docs/product/registered-players-import-export.md and docs/adr/ADR-0007-player-import-export-architecture.md. The XLSX dependency is added in the implementation PR only; nothing is added by this scoping work.
- Shared UI work in src/components/ui.tsx: the Modal dialog and focus baseline (section 7; the non dismissible `dismissible` prop already exists from PR #103 and is reused), `aria-pressed` on Chip, and the first table styles. These precede the flows that need them, per docs/roadmaps/registered-players-delivery-plan.md.
- Routing and navigation edits: the `/players` route and guard, the `/roster` redirect, the `screenFromPath` and `Screen` additions, the nav item rename, the `/admin/seasons` route and nav item behind `seasons.manage`, and the Activity route behind `audit.view`.
- Data layer: season parameterised player queries replacing the single `['players']` key, team change support in the update path, and the new mutations (withdraw, restore, delete, import, export, plus season create, update, activate, archive and unarchive), all following the confirmed conventions: no optimistic writes, invalidate on settled, inline error copy.
- The Spond import affordance keeps its mapping check but moves its gate to `players.import`, and its dialog and result copy gain the season context (section 8); the function change itself is scoped in docs/product/registered-players-spec.md and the delivery plan.
