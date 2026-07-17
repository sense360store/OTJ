# Registered players: product specification

Status: Draft for review

Decision owners: Club owner (product); repository maintainer (security and data model)

This is the anchor product document for the Registered Players work: the evolution of the existing Roster into the club's season based operational register of players. It defines the product vision, the data model at field level, the child data boundary, terminology, the season model, registration status, permissions, team scope, page semantics and the open product decisions. Sibling documents carry the detail it points at:

- docs/product/registered-players-import-export.md: template, file formats, preview, matching, commit and export rules.
- docs/product/registered-players-ux.md: page layouts, states, copy, accessibility, mobile behaviour.
- docs/security/registered-players-boundary.md: exact RLS policies, grants, triggers and constraints.
- docs/security/registered-players-threat-model.md: threats and the security test plan.
- docs/security/app-audit-boundary.md: the append only audit foundation.
- docs/adr/ADR-0005-registered-players-and-seasons.md: the full identity and season decision record.
- docs/adr/ADR-0006-app-audit-events.md: the audit events decision record.
- docs/adr/ADR-0007-player-import-export-architecture.md: the import and export architecture decision record.
- docs/roadmaps/registered-players-delivery-plan.md: phased PRs, acceptance criteria, rollout and rollback.

Throughout this document, three kinds of statement are distinguished explicitly: confirmed current behaviour (cited to files in this repository), proposed product defaults (the recommended design), and unresolved decisions requiring approval (listed in full under Unresolved items). Migration numbers are provisional (likely 0030 onward); the live migration ledger must be confirmed at apply time, never assumed from file names on disk.

---

## Confirmed current state

Everything in this section is confirmed behaviour on main, cited to the source.

### The current Roster page

- Route `/roster`, registered inside the `sessions.create` capability guard (`src/App.tsx:99,103`). `RequireCap` renders a full screen Splash while capabilities load and only then redirects or admits, so there is no transient render of gated content (`src/components/RequireCap.tsx:35-38`). The component adds a belt and braces `if (!caps.has('sessions.create')) return null` (`src/routes/Roster.tsx:217`).
- Nav item "Roster" sits in the Plan group of the coach nav (`src/components/nav.ts:58`); parents never see it. On mobile it is reachable only through the More sheet. Quirk: `screenFromPath` has no `/roster` entry, so while on the Roster the sidebar highlights Home as active (`src/lib/screen.ts:22-41`).
- The page is one card (max width 620px) with: a Team select defaulting to the first team by name; an add form (Full name, max 40 characters, optional shirt number, Enter submits); inline per row edit (rename, renumber, per row Save); a hard delete behind a "Remove player" confirm modal; and an "Import from Spond" button shown only when the selected team has a Spond mapping (`src/routes/Roster.tsx:190-324`). There is no search, no counts, no sort control, no export, no season, no status, no withdraw concept and no history of any kind (confirmed absences, `src/routes/Roster.tsx` and `src/lib/queries.ts:3438-3612`).

### The current data model

The `players` table (`supabase/migrations/0021_players.sql:72-81`): `id`, `club_id` (FK clubs, ON DELETE CASCADE), `team_id` uuid NOT NULL (FK teams, ON DELETE CASCADE), `display_name` text 1 to 40 characters (holding the child's full name since `0023_players_fullname.sql`), `shirt_number` int 1 to 99 nullable, `created_by` NOT NULL (FK profiles, ON DELETE CASCADE), `created_at`. No `updated_at`, no status, no season, no `updated_by`, no unique constraint beyond the primary key.

RLS (`0021_players.sql:101-115`): select gated on `club_id = public.my_club() and public.has_perm('sessions.create')` (policy `players_select_coach`); one FOR ALL write policy `players_manage_coach` with the same condition on both arms. This is the only select gated content table in the app; everything else is club wide read. Note: the 0021 header comment claims the with check arm pins `created_by`, but the clause does not (`0021_players.sql:106-115`); new policies must pin `created_by = auth.uid()` explicitly on insert.

The data layer (`src/lib/queries.ts:3438-3612`): `usePlayers` reads the whole club roster under one query key `['players']`; `useInsertPlayer`, `useUpdatePlayer` and `useDeletePlayer` invalidate `['players']` on settled and none is optimistic. There is no season entity, no audit or history mechanism, and no CSV or XLSX dependency anywhere in the project (runtime dependencies are only `@supabase/supabase-js`, `@tanstack/react-query`, `react`, `react-dom`, `react-router-dom`, `package.json:14-20`).

### Three confirmed hazards in today's model

1. **Team deletion silently deletes children's records.** `players.team_id` is ON DELETE CASCADE (`0021_players.sql:75`), as are `spond_groups.team_id` (`0013_spond.sql:60`) and `member_teams.team_id` (`0016_member_teams.sql:43`). The team delete confirm modal counts only members and sessions and its copy reads "They keep working; their team is cleared. No sessions or people are removed." (`src/routes/AdminTeams.tsx:43-47`). That copy is wrong for player data: deleting a team hard deletes every roster row on it, plus the team's Spond mapping.
2. **Removing a member silently deletes the players they curated.** `players.created_by` is ON DELETE CASCADE (`0021_players.sql:78`). The `remove-user` Edge Function deletes the auth user; the profile cascades, and with it the players that member created (and their boards, `0020_boards.sql:57`). The function's success message names only drills, media, templates, programmes and sessions as surviving (`supabase/functions/remove-user/index.ts:172-176`).
3. **Moving a player between teams is impossible today.** `useUpdatePlayer` patches only `display_name` and `shirt_number`; its input type has no team field (`src/lib/queries.ts:3517-3533`). Move team is new functionality in this design, not preserved functionality, and so is Withdraw: the only removal today is hard delete.

### Related surfaces this design must keep working

- **Tactics boards.** A persisted board token carries at most `{id, number, side, x, y, playerId}`, enforced by the `boards_tokens_minimal_shape` check constraint (`supabase/migrations/0028_board_player_boundary.sql:209-211`). `playerId` references `players.id` with no foreign key; deleting a player leaves a numbered disc. Names resolve at render time through the players select, so parents see shape and numbers only, enforced by Postgres. Board seeding feeds only `{id, shirtNumber}` into tokens (`src/routes/Board.tsx:151-160`).
- **Spond roster import.** `spond-roster-import` runs with the caller's JWT through RLS (no service role), gates on `has_perm('sessions.create')` before contacting Spond, dedupes on case insensitive `(club_id, team_id, display_name)` in memory, inserts names and optional shirt numbers only, and never persists or logs Spond member ids, guardian or contact data (`supabase/functions/spond-roster-import/index.ts`). Confirmed mismatch: CLAUDE.md calls this import "admin triggered", but the gate is `sessions.create` and the button sits on the coach facing Roster page, so coaches can trigger it today. This design makes the documented intent real (see Permissions and capabilities).
- **RBAC v2.** Roles are data (`0015_rbac_roles.sql`): a member holds a set of roles through `member_roles`, capabilities attach to roles in `role_capabilities`, and `has_perm(capability)` grants on any held role. The catalogue holds exactly 13 capability keys today; `users.manage` and `club.manage` are trigger locked to the system admin role. The system Manager role exists and holds the eleven content capabilities.
- **Teams and membership.** `member_teams` plus `profiles.all_teams` (admins and managers defaulted true) exist since `0016_member_teams.sql`, with the standing rule recorded there: "teams scope no row level security". Their write policies already require `users.manage` (`0016_member_teams.sql:61-83`).

---

## Proposal

### Product vision

Evolve the existing Roster into a canonical Registered Players section: the club's season based operational register of players who have signed up, or are being processed, for a season. One product, one player database. Registered Players continues to feed the tactics board and continues to accept the Spond squad import; nothing forks into a second competing list. What changes is that the register becomes season aware, status aware, auditable, importable and exportable, and stops losing data when a team or a member is removed.

### Primary user outcomes

Authorised club members can: see every registered player record they are permitted to view; default to the current season and switch to an archived one; view all teams, one team, or Unassigned players; search by name; filter by registration status; sort by name, team, status, shirt number or registration date; see total and filtered counts; add and edit players; move a player between teams or leave them unassigned; change registration status; withdraw and restore a player; download a blank import template; upload CSV or XLSX; preview and validate an import before anything is written; confirm an import safely; download rejected rows; export the currently filtered list or everything they may access; keep using Import from Spond; seed tactics boards from current season eligible players; see who changed a record and what changed (per player History); see import and export history; and, where granted, use a club wide Activity page. Parents can do none of this: they never read player records, exports or audit data, with no transient read during loading.

### Product terminology

Proposed product defaults (full copy strings in docs/product/registered-players-ux.md):

| Concept | Name |
|---|---|
| Navigation item | Players |
| Page title | Registered players |
| Route | `/players` (`/roster` redirects to it) |
| Statuses | Pending, Registered, Withdrawn |
| Season label | "2026/27" format |
| Team filter values | All teams, each team name, Unassigned |
| Removal verbs | Withdraw and Restore (never Delete in normal flows) |
| Buttons | Add player, Import players, Export, Download template, Import from Spond |
| Per player audit | History |
| Club wide audit | Activity |
| Import batch reference | "Import <short batch ref>" |

### Canonical identity model (summary)

This is the headline decision, recorded in full in docs/adr/ADR-0005-registered-players-and-seasons.md. It is marked APPROVAL REQUIRED.

Recommended: split the model into a stable identity plus a seasonal registration. `players` (the existing table, evolved) holds one row per child per club: the durable identity. A new `player_registrations` table holds one row per child per season: team, status, shirt number and registration date. A new `seasons` table anchors registrations.

Why the split, in brief: (a) board tokens reference `players.id` with no foreign key, so a per season row model would mint a new id per child per season and orphan or fragment board references, while the stable identity keeps every existing board token valid forever; (b) season renewal creates one small registration row instead of duplicating the child's name each season, which is less child data duplication, not more; (c) audit and per player history attach to one stable entity id across seasons; (d) import dedupe gets a durable Player ID; (e) deleting a child is one identity row plus cascaded registrations. Trade offs: reads join two tables, and the migration must backfill by splitting each existing row into an identity plus a registration. The alternative (one row per child per season) is documented and rejected in ADR-0005 for the board reference and name duplication reasons.

Backfill: each existing `players` row becomes one identity plus one registration in the initial season, with `team_id` and `shirt_number` carried over, status set to `registered` (they are live operational rosters today; APPROVAL REQUIRED) and `registered_date` set to `created_at::date` (APPROVAL REQUIRED). No automatic merging of same named rows: two children are never merged on name alone; duplicates across teams remain separate identities, cleaned up manually later if the club confirms they are the same child.

### Data model: the operational purpose of every field

Proposed product defaults. Exact DDL, constraints, grants and RLS live in docs/security/registered-players-boundary.md and the implementation migrations (provisional 0030 onward; confirm the live ledger at apply time).

#### `players` (evolved): stable club level identity

| Field | Operational purpose |
|---|---|
| `id` | The durable Player ID. Board tokens reference it (no FK), imports match on it, exports publish it, audit and history attach to it. Existing uuids are kept so every saved board token stays valid. |
| `club_id` | Club scoping. Every RLS arm anchors on `club_id = my_club()`; cross club reads and writes fail on it. FK clubs, ON DELETE CASCADE: a deleted club takes its player records with it. |
| `display_name` | The child's name as the club knows them, 1 to 40 characters, full name per `0023_players_fullname.sql`. A bounded display name, not a required legal name. The only name field, and the only field on this table that identifies a child. |
| `created_by` | Who first created the identity, for accountability display in History. Becomes nullable with ON DELETE SET NULL, fixing the current cascade that deletes children's records when the curating member is removed. |
| `created_at` | When the identity was created. The backfill source for `registered_date` on the initial season's registrations. |
| `updated_by` | Who last changed the identity row (in practice, who last corrected the name). Nullable, ON DELETE SET NULL. |
| `updated_at` | When the identity row last changed. Together with the registration's `updated_at` it drives the Last updated column. |

Nothing else. `team_id` and `shirt_number` move to registrations; they are seasonal facts, not identity facts.

#### `player_registrations` (new): one row per child per season

| Field | Operational purpose |
|---|---|
| `id` | Registration row id. |
| `club_id` | Denormalised club scoping so registration RLS never needs a join to decide club membership. Must equal the player's club; enforced in the database (see the boundary document). |
| `player_id` | The identity link. FK players, ON DELETE CASCADE: deleting a child removes all their seasonal rows in one action. |
| `season_id` | Which season the registration belongs to. FK seasons, ON DELETE RESTRICT: a season with registrations cannot be deleted. |
| `team_id` | Team allocation for the season. Nullable: null means Unassigned. FK teams, ON DELETE SET NULL: deleting a team makes its players Unassigned instead of deleting them, fixing hazard 1 above. |
| `status` | Registration state, text with a CHECK constraint in ('pending','registered','withdrawn'). Drives list visibility, board eligibility, counts and export values. |
| `shirt_number` | Optional squad number for the season, 1 to 99. Feeds board token numbers when seeding. Duplicate numbers within a team are a warning, not an error. |
| `registered_date` | The date club registration was completed. Set automatically when status first becomes registered and the field is empty; manually editable by `players.manage` holders for backdating paper registrations; import may supply it. |
| `created_by`, `created_at` | Who created the registration and when, for History. Person FK nullable, ON DELETE SET NULL. |
| `updated_by`, `updated_at` | Who last changed the registration and when. Person FK nullable, ON DELETE SET NULL. |

UNIQUE `(player_id, season_id)`: one registration per child per season.

#### `seasons` (new)

| Field | Operational purpose |
|---|---|
| `id` | Season id, referenced by registrations, templates of behaviour (defaults, exports, imports) and audit events. |
| `club_id` | Club scoping. FK clubs, ON DELETE CASCADE. |
| `name` | The label everywhere ("2026/27"), 1 to 20 characters, unique per club. |
| `starts_on`, `ends_on` | Informational date range for orientation and export naming context. CHECK `ends_on > starts_on`. Overlap between seasons is deliberately not constrained: adjacent grassroots seasons may straddle. |
| `is_current` | The single operational default: the players page opens on it, boards seed from it, Spond imports write into it, exports default to it. Exactly one current season per club, enforced by a partial unique index on `(club_id)` WHERE `is_current`. |
| `archived_at` | Read only marker. A season with `archived_at` set refuses registration writes in the database; the escape hatch is unarchive (admin, `seasons.manage`, audited). |
| `created_by`, `updated_by` | Accountability, nullable, ON DELETE SET NULL. |
| `created_at`, `updated_at` | Row timestamps. |

### The player data boundary: excluded data

The register expands the app's existing child data boundary without widening it: name, seasonal team, status, optional shirt number and a registration date are everything the defined operational purpose (planning training, seeding a board, tracking who is signed up this season) requires. A player is a label on a register, never an application account. The following are excluded, and the exclusion holds for the stated reason:

| Excluded | Why the exclusion holds |
|---|---|
| Date of birth, age | Not needed to plan a session or seed a board; age banding lives in team names. Identifying data with no operational use here. |
| Guardian or parent details | The club's guardian relationships live in Spond and FA systems. Storing them here would link children to adults in a database whose purpose does not need it. |
| Email, telephone, address | The app never contacts a child. Contact data multiplies breach impact for zero function. |
| Emergency contacts | Matchday safeguarding information belongs with the FA registration and the coach's matchday pack, not a training planner. |
| Medical, allergy or dietary information | Special category data. The app has no feature that could justify holding it, and no access model fit to protect it. |
| Payment information, registration payment state | Money is handled elsewhere. Status here is operational (pending, registered, withdrawn), never financial. |
| Photographs, identity documents, consent forms | Documents and images of children are out of scope entirely; the media library is coaching content only. |
| Safeguarding notes, unrestricted free text notes | A free text field invites exactly the sensitive data every other exclusion keeps out. No notes field exists anywhere on the model. |
| Links to `auth.users` | A player is not an account. No login, no email, no session ever attaches to a child. |
| Spond member ids | The Spond import reads names transiently and persists none of Spond's identifiers, preserving the `spond-roster-import` boundary (`supabase/functions/spond-roster-import/index.ts`). |
| Anything else not required for the defined operational purpose | Data minimisation is the standing rule; additions require a new gated decision, not a column. |

Audit events extend the same boundary: no player name ever appears in audit values or metadata (a name correction records that the field changed, never the old or new value). See docs/security/app-audit-boundary.md.

### Season model

Proposed product defaults (decision record in docs/adr/ADR-0005-registered-players-and-seasons.md):

- The current season invariant is "at most one at all times, exactly one after setup". A partial unique index on `(club_id)` WHERE `is_current` enforces at most one current season for every writer, always. The lower bound is provided by bootstrap: the initial season migration creates the one current season for the existing club, and any future club creation path must transactionally create an initial current season in the same transaction as the club row (there is no in app club creation flow today, so this is a requirement on any future bootstrap and on the local seed). So a live club always has exactly one current season; the only zero state is a club that has not yet run setup, which bootstrap eliminates. The document does not claim an unconditional "exactly one" while allowing a club with none. Name and dates are required and validated (name 1 to 20 characters unique per club, `ends_on` after `starts_on`); date ranges may overlap between seasons because adjacent grassroots seasons straddle in practice.
- `seasons.manage` gates create, update, activate and archive. Recommended default holders: admin only, because activation reshapes the whole club's operational view; managers can be granted it through the capability grid. APPROVAL REQUIRED.
- Activation is one transactional RPC (`activate_season`): clears `is_current` on the old row, sets it on the new, and writes the `season.activated` audit event. Archiving the outgoing season is an explicit option on the call, never automatic; when the option is taken, the same transaction sets `archived_at` on the outgoing season and writes `season.archived` alongside `season.activated`. The proposed default does not take the option: the outgoing season stays open, non current but still writable, so late corrections during the changeover period need no unarchive round trip, and it is archived later by the explicit Archive action on a non current season (docs/adr/ADR-0005-registered-players-and-seasons.md). Activating does not create, copy or modify any registration.
- Archiving the current season alone is refused: a club always has a current, unarchived season after setup. Archival happens through the explicit option on activation, or explicitly on a non current season.
- Archived seasons are read only for registrations, enforced in the database, not the UI: registration write paths refuse when the season has `archived_at` set. The only override is unarchive (clear `archived_at`; `seasons.manage`; audited). APPROVAL REQUIRED on the absoluteness.
- Renewal: moving into a new season creates new registration rows against the same identities. Recommended: an explicit bulk Renew action (`players.manage`) copying chosen registrations from a source season into the current season as status pending, team carried forward, shirt number carried forward, `registered_date` empty, run as one transactional RPC with a batch id and audit events (source `renewal`). The export and import round trip works day one without it; Renew ships late in the plan (the PR 6 window in docs/roadmaps/registered-players-delivery-plan.md). APPROVAL REQUIRED on the status reset to pending and the carry forward of team and shirt.
- Current season is the default everywhere, but not the only importable season. The players page opens on the current season; board seeding uses it; exports name the selected season in the filename and a column. Spreadsheet import defaults to the current season but MAY target any season of the club that is not archived and that the caller's capability permits, so a manager can prepare next season while the current season is still active (docs/product/registered-players-import-export.md). The Spond import stays current-season-only (chosen server side; the client cannot pick an arbitrary season), because the organiser account's live subgroup reflects the current squad; this is a recommended operational decision with the alternative (any non archived season) noted under Unresolved items.
- No current season (pre setup only): the players page shows a setup prompt to admins and an empty state to everyone else; imports and board roster seeding are unavailable until a season exists. Bootstrap creates the initial current season (the migration for the existing club, and any future club creation path in the same transaction), so a live club is never in this state; it can occur only for a club that has not yet run setup.

#### Season management surface

Season creation and activation do not live on the players page; they live on a dedicated admin surface. This is the surface docs/product/registered-players-ux.md points at from its season selector and its "No current season" state. Proposed product defaults:

- An admin page at `/admin/seasons`, following the existing admin page pattern (`/admin/teams`, `src/App.tsx:119`). It is visible only to `seasons.manage` holders: the nav item is absent for everyone else and a direct URL hit follows the RequireCap pattern, rendering nothing gated before redirect.
- The page lists every season newest first, showing name, date range, a Current marker and an Archived marker, with per row actions driven by state.
- Create: a modal taking name (1 to 20 characters, unique per club) and the two dates (`ends_on` after `starts_on`, both required). Creating a season never changes the current season.
- Activate: a per row action on a non current season calling the `activate_season` RPC, behind a confirmation dialog that names both seasons and states the consequence. The dialog carries the explicit archive option of docs/adr/ADR-0005-registered-players-and-seasons.md as an "Also archive 2026/27" checkbox, unticked by default, matching the RPC default of leaving the outgoing season open. Proposed copy: "Make 2027/28 the current season? The players page, board seeding, imports and exports switch to it. 2026/27 stays open until you archive it." With the checkbox ticked, the final sentence becomes "2026/27 is archived and becomes read only." Either way the whole change is one transaction.
- Archive: a per row action on non current seasons only. Archiving the current season alone is refused, matching the rule above. Under the activation default this row action is the normal route by which an outgoing season is eventually archived.
- Unarchive: the audited escape hatch, a per row action on an archived season with a confirmation stating that its registrations become editable again.
- The "Set up season" call to action in the players page's no current season state links here.

The surface performs no registration work of any kind; it only manages season rows, and every action on it is audited (`season.created`, `season.updated`, `season.activated`, `season.archived`). Layout, states and copy detail belong to docs/product/registered-players-ux.md; delivery sequencing to docs/roadmaps/registered-players-delivery-plan.md.

### Unassigned players

A registration with `team_id` null is Unassigned. This supports registering children before team allocation, and it is what team deletion now produces (SET NULL) instead of data loss. Product semantics:

- The team filter offers Unassigned alongside All teams and each team; assigning or moving a team is an edit on the registration (audited as `player.team_changed`).
- Import: a blank Team cell lands the row as Unassigned; an unknown team name is a row error, never a silent Unassigned (see docs/product/registered-players-import-export.md).
- Boards: Unassigned players appear in the board picker only when its team selector is explicitly set to Unassigned; they never ride along with a team's seed.
- Team scope: read is club wide via `players.view`, so Unassigned registrations are visible to every viewer, including the coaches who allocate them. Team is a filter, not an access boundary; the 0016 standing rule is preserved. The team scoped read is the rejected alternative (see Team scope and read access).

### Registration status

Proposed product defaults (values and transitions enforced server side, not UI only):

- Values: `pending`, `registered`, `withdrawn`. Text plus a CHECK constraint, not an enum, so extension needs no enum migration and matches the constraint style of `0021_players.sql`.
- Allowed transitions, exactly these and no others:
  - pending -> registered (Confirm, or Mark registered)
  - pending -> withdrawn (Withdraw, confirmation dialog)
  - registered -> withdrawn (Withdraw, confirmation dialog)
  - withdrawn -> pending (Restore, actor chooses; confirmation)
  - withdrawn -> registered (Restore, actor chooses; confirmation)
- `registered_date` is set automatically to the club's current date when status first becomes registered and the field is empty; it stays manually editable (`players.manage`) for backdating paper registrations, and import may supply it.
- Withdraw keeps `team_id` and `shirt_number` (history and restore fidelity) and deletes nothing.
- Withdrawn rows are hidden from the default list view (the status filter defaults to Pending plus Registered, with explicit Withdrawn and All options), excluded from board selection entirely, and excluded from exports only when the active filters exclude them (exports respect filters). On import, a blank status maps to pending by default.
- Board eligibility: current season, status registered, selected team only, by default. Pending players may be included through an explicit toggle in the picker (recommended: ship the toggle; early season trialists are a real grassroots need; APPROVAL REQUIRED). Withdrawn never. Unassigned only when deliberately selected.
- Archived seasons: no status changes (the read only rule above).
- Every transition writes exactly one audit event (`player.status_changed`, or the dedicated `player.withdrawn` and `player.restored` actions).

### Permissions and capabilities

Proposed product defaults. No hard coded role names appear in RLS or the UI; everything flows through capabilities so custom roles work. The catalogue grows from 13 to 20 keys with seven new capabilities, all grantable to custom roles (the reserved trigger list of `users.manage` and `club.manage` is unchanged):

`players.view`, `players.manage`, `players.import`, `players.export`, `players.delete`, `seasons.manage`, `audit.view`.

Import and export stay separate capabilities deliberately: they carry different risks (export exfiltrates children's names; import mutates records).

Default grants by role:

| Capability | Coach | Manager | Admin | Parent | Custom roles |
|---|---|---|---|---|---|
| `players.view` | yes | yes | yes | no | grantable |
| `players.manage` | no | yes | yes | no | grantable |
| `players.import` | no | yes | yes | no | grantable |
| `players.export` | no | yes | yes | no | grantable |
| `players.delete` | no | no | yes | no | grantable |
| `seasons.manage` | no | no | yes | no | grantable |
| `audit.view` | no | yes | yes | no | grantable |

What each operation requires:

| Operation | Capability | Default scope |
|---|---|---|
| View, search, filter, sort players; per player History | `players.view` | Coach, manager and admin: club wide read (team is a filter, not an access boundary; see Team scope and read access). |
| Add, edit, move team, change status, withdraw, restore, bulk assign, Renew | `players.manage` | Same scope arms as view; managers and admins effectively club wide. |
| Upload and confirm a CSV or XLSX import; Import from Spond; download the blank template | `players.import` | Spreadsheet import: any non archived season the caller may write, defaulting to current. Spond import: current season only (server chosen). |
| Export filtered list or all accessible records | `players.export` | The viewer's own visible scope, enforced server side. |
| Permanent deletion of a player | `players.delete` | Admin only by default, typed confirmation. |
| Create, update, activate, archive, unarchive seasons | `seasons.manage` | Admin only by default. APPROVAL REQUIRED. |
| Club wide Activity page | `audit.view` | Club wide feed. Per player History does not require it (separate access path, decision 15). |

Parents hold none of these: no player records, no exports, no audit, and no transient read during loading (the RequireCap pattern already renders nothing until capabilities resolve, `src/components/RequireCap.tsx:35-38`, and RLS returns zero rows regardless). A custom Manager style role acquires any of this through the existing capability grid.

**Coach write reduction: decision requiring approval.** Today, `sessions.create` gates the roster, so every coach can add, edit, hard delete and Spond import players club wide (`0021_players.sql:101-115`; `supabase/functions/spond-roster-import/index.ts:168-174`). Under the recommended defaults, `sessions.create` stops gating players once `players.view` exists. Coaches KEEP club wide READ of the register through `players.view`, and LOSE the write powers: no add, no edit, no import, no export. This is a deliberate, prominent reduction of coach WRITE access, not of read access, and it also makes CLAUDE.md's "admin triggered" description of the Spond roster import real for the first time. If the club wants coaches to keep writing, the fallback seed grants coach `players.manage` plus `players.import`. Because read and write are club wide (team is a filter, not an access boundary; see Team scope and read access), the fallback simply gives coaches write back with no team entanglement. Both options are presented; the write reduction is recommended. A middle option was also assessed: limited shirt number edits for coaches. Capabilities gate operations, not columns, so a shirt number only write would need a dedicated capability plus a column restricted write path (a dedicated RPC or a trigger guard), a third write grant shape carried for one field. It is rejected for v1 as disproportionate to the benefit (managers correct shirt numbers; coaches request changes) and remains available as a follow up capability if the reduction proves too tight in practice. APPROVAL REQUIRED (Unresolved item 3).

### Team scope and read access

**Read is club wide; team is a filter.** The recommended default is that `players.view` grants CLUB-WIDE read of every registered player, all teams and Unassigned included, across the seasons the caller may view. Team is a filter and a management attribute, never a row level security read boundary. This is the requested product outcome: authorised members see the register and filter All teams or one team. The standing rule recorded in `0016_member_teams.sql` ("teams scope no row level security") is therefore PRESERVED and unchanged.

Exact semantics (full policy text in docs/security/registered-players-boundary.md): the players and player_registrations select policies require club membership and `players.view`, with no team arm; writes require `players.manage`, club scoped, no team arm. Unassigned registrations are read and managed like any other, so the coaches who allocate them keep seeing them. Consequence worth stating: board name resolution is club wide, so any `players.view` holder resolves names on any board; parents, holding no `players.view`, see numbers only.

Rejected alternative: team scoped RLS for the players domain (the first team scoped RLS in the app), where holders without `all_teams` would read only their `member_teams` registrations. Rejected for four reasons: it makes cross season history incoherent when a coach or a child moves team; a team scoped custom role could rename or delete a stable identity that also belongs to other teams; Unassigned players would disappear from the coaches who must allocate them; and it is a large new access control precedent the feature request does not need. The softer variants (own teams plus Unassigned; read all, edit assigned) carry the same problems and are rejected with it. The recommendation is club wide read.

### Filters and counts

Semantics only; layout, states and copy live in docs/product/registered-players-ux.md.

- Filters: season (defaults to the current season; archived seasons selectable, shown with a read only banner), team (All teams, each team, Unassigned), status (defaults to Pending plus Registered; explicit Withdrawn and All options), and a name search box.
- Sort: Name ascending by default; Team, Status, Shirt number, Registered date and Last updated also offered; every sort carries a deterministic id tiebreak.
- Counts: the summary shows the total for the selected season within the viewer's visible scope, per status counts, and the filtered count when filters narrow the list. Withdrawn players are counted in the totals and the Withdrawn count even while hidden by the default status filter, so the summary never silently understates the register.
- Exports respect the active filters; a separate explicit option exports everything the caller may access (see docs/product/registered-players-import-export.md).
- Filters persist in the URL query (`?season=&team=&status=&q=&sort=`) for shareable views, with a reset control clearing to defaults. This is a new, small pattern; today only the Planner (`?sessionId`) and Library (`?corner`) read URL params.
- No pagination for the players list: at the club's scale (roughly 75 to 125 players per season) client side filtering matches the Library pattern. Audit lists are server paginated (see the Activity page).

### Manual add and edit

Behaviour level; exact modal copy in docs/product/registered-players-ux.md.

- Add and Edit use a modal (repo convention): name (required, 1 to 40 characters), team (defaults to the current team filter; Unassigned allowed), status (defaults to pending), shirt number optional (1 to 99; a duplicate within team and season is a warning, not an error), registered date optional.
- A duplicate name warning (same normalised name in the season) shows inline before save; save remains allowed, and nothing is ever auto merged.
- Saves are confirmed writes only: standard mutation, button busy, the modal stays open on failure with the error and a retry; no optimistic update; success closes the modal and invalidates. No write may silently fail or navigate before confirmation.
- Withdraw shows a confirm dialog stating the player stays in history and can be restored. Restore lets the actor choose Pending or Registered. Move team is an inline action or the edit modal, audited as `player.team_changed`.
- Permanent deletion is admin only (`players.delete`): typed confirmation; consequence text explaining it removes the child's name from the club's records, that History keeps a neutral "Deleted player" tombstone, and that board discs fall back to numbers only; deletes the identity and its registrations by cascade; the `player.deleted` audit event is raised by the AFTER DELETE trigger on the identity row and commits atomically with the deletion (entity id retained, no name), per docs/security/app-audit-boundary.md. Boards are structurally unaffected: there is no FK and the disc shows its number, the verified 0028 design. The anonymisation alternative (rename to "Player N") is documented; the recommended default is true deletion for data minimisation. APPROVAL REQUIRED (Unresolved item 9).

### Per player history and the Activity page

Product level; the audit data model and its append only enforcement live in docs/security/app-audit-boundary.md and docs/adr/ADR-0006-app-audit-events.md.

- **History (per player).** A panel on the player row showing date and time, actor, action, safe changed fields, source, and the import batch reference where one applies. Example entries: "16 Jul, 14:32 / Mark Taylor / Registration changed: Pending to Registered"; "15 Jul, 10:18 / Neil McRae / Team changed: Unassigned to U8 Titans"; "14 Jul, 09:05 / CSV import / Registration created". Distinct actions back these entries: `player.created` for a new identity, `player.registration_created` for a season registration, then `player.status_changed`, `player.team_changed` and the rest (docs/security/app-audit-boundary.md). Names of actors, teams and players resolve at read time; after a permanent deletion the display shows a neutral identifier (Deleted player, Deleted team). Access rides `players.view` (club wide read), through a dedicated read path (`player_history`), so a coach sees any club player's history without holding `audit.view`. A child linked history row is pseudonymous child personal data (docs/security/app-audit-boundary.md), so this gate is a real access control. This separation is decision 15, recommended.
- **Activity (club wide).** A management page listing the club's audit events newest first, deterministically ordered and server paginated, with filters for date range, actor, entity type, action, team, season, source and import batch. Requires `audit.view` (managers and admins by default); parents never; coaches only if granted. Deleted entities display neutrally. No audit feed export in v1.
- Audit is not undo. Recovery is Withdraw and Restore, team and status correction, import retry, and admin deletion. No replay mechanism exists or is planned.
- No player name ever appears in audit values or metadata: a name correction records `changed_fields = ['display_name']` with no values, rendered as "Player name corrected" (Unresolved item 7, recommended: no values recorded).

### Search and performance

Realistic scale: one club, five teams, roughly 15 to 25 players per team (75 to 125 per season), imports well under 500 rows, audit volume in the low thousands of events per season.

- Player list reads are one season's registrations joined to identities; filtering and search run client side over that set, matching the Library pattern. No pagination, no virtualisation.
- Search is case insensitive substring match on the display name, with input trimmed; matching normalisation (trim, case fold, collapse spaces) is shared with import matching.
- Deterministic sort everywhere: every ordering ends with an id tiebreak so lists never shuffle between refetches.
- Indexes ride the migrations (registrations by club and season, by team and by player); the exact list lives in docs/roadmaps/registered-players-delivery-plan.md (Data migration plan, step 8), and the audit event indexes also in docs/security/app-audit-boundary.md. Archived season reads are the same shaped query with a different `season_id` and stay cheap at this scale.
- Audit reads are server filtered and server paginated; the client never downloads the whole audit history.
- Query caching follows the existing TanStack Query conventions; player mutations stay non optimistic with invalidation on settled, as today.

---

## Alternatives

Summarised here; each is treated fully where indicated.

- **One row per child per season** instead of the identity split: fewer tables, but every season mints a new id per child, fragmenting board references and duplicating names. Rejected. Full comparison in docs/adr/ADR-0005-registered-players-and-seasons.md.
- **Coach continuity** instead of the write reduction: seed coach with `players.manage` plus `players.import`, preserving today's de facto write powers. Because read and write are club wide (team is a filter, not an access boundary), this fallback simply gives coaches write back, club wide, with no team entanglement. Presented as the fallback; the write reduction is recommended.
- **Coach shirt number edits** as a middle option between view only and full continuity: assessed under Permissions and capabilities; rejected for v1 because a single column write path needs a dedicated RPC or trigger guard the capability model does not otherwise require, for marginal benefit.
- **Team scoped read** (own teams, own teams plus Unassigned, or read all edit assigned) instead of club wide read: documented and rejected under Team scope and read access; club wide read is recommended, preserving the 0016 standing rule.
- **Coach export within team scope** instead of managers and admins only holding `players.export`: expressible (the export RPC already applies the viewer's scope), but rejected because export is the bulk exfiltration path for children's names and warrants the narrowest holder set. Full treatment in docs/product/registered-players-import-export.md.
- **Anonymisation** ("Player N") instead of permanent deletion: keeps row shape at the cost of retaining a record of the child's existence; true deletion recommended for data minimisation.
- **Fixed audit retention with scheduled pruning** instead of indefinite retention reviewed annually: rejected at the club's scale because audit rows carry no child names and pruning erases accountability for no privacy gain. Full treatment in docs/security/app-audit-boundary.md and docs/adr/ADR-0006-app-audit-events.md.
- **Absolute archived seasons** (read only with no unarchive) or a softer admin override without unarchiving, instead of read only with an audited unarchive: absolute read only turns a mistaken archive into a migration, and a silent override weakens the read only guarantee. The audited unarchive is recommended; full treatment in docs/adr/ADR-0005-registered-players-and-seasons.md.
- **Export and import round trip** instead of a dedicated Renew action: works day one, more manual; the bulk Renew RPC is recommended and ships late in the plan.
- **Server side spreadsheet parsing** (Edge Function) instead of the browser, and **Edge Function commit** instead of a transactional RPC: both rejected as larger surfaces for no boundary gain; see docs/adr/ADR-0007-player-import-export-architecture.md.
- **A player only history table** instead of the generic audit foundation: rejected; it would later compete with app wide audit. See docs/adr/ADR-0006-app-audit-events.md.

## Decision

Adopt, subject to the approvals listed under Unresolved items: the stable identity plus seasonal registration model; the `seasons` table with exactly one current season per club after setup (bootstrap created) and read only archived seasons; the pending, registered, withdrawn status model with server enforced transitions; the seven new capabilities with the default grants above, including the coach write reduction (coach keeps club wide read, loses write); club wide capability gated RLS for the players domain (no team scope, the 0016 standing rule preserved); the Players page semantics (filters, counts, URL state, no pagination); manual operations with Withdraw as the normal removal and admin only permanent deletion; per player History gated by `players.view` and the club wide Activity page gated by `audit.view`; and the browser parsed, RPC committed import and export architecture recorded in the sibling ADRs. Every decision marked APPROVAL REQUIRED is written up as the recommended default and does not proceed without the decision owners' sign off.

## Consequences

- Coaches lose club wide roster WRITE access by default but keep club wide READ; managers and admins take over import, export and management. This write reduction is the single largest behaviour change and is flagged for approval. Read stays club wide, so the 0016 standing rule is preserved and no team scoped RLS is introduced.
- Deleting a team stops destroying children's records: registrations go Unassigned. The current team delete modal copy ("No sessions or people are removed.", `src/routes/AdminTeams.tsx:43-47`) is wrong today and is corrected as part of this work.
- Removing a member stops deleting the players they curated: `created_by` and `updated_by` become nullable with SET NULL.
- Hard delete leaves the normal workflow: Withdraw and Restore replace it, and permanent deletion becomes a rare, admin only, audited act.
- The Roster page is replaced by Registered players at `/players` with `/roster` redirecting; the tactics board and Spond import keep working against the same identities, with board seeding narrowed to current season registered players by default and the Spond import landing pending registrations in the current season under `players.import`.
- Every player, registration and season change becomes visible in History and Activity; nothing about a child beyond the bounded display name is stored anywhere new.
- The capability catalogue grows to 20 keys, which requires extending the pinned `EXPECTED_CATALOGUE` and the capability literal regex in `tests/security/capabilities.test.ts`.
- Two table reads replace one table reads in the player data layer, and the migration performs a backfill split of every existing row.

## Unresolved items

The decisions below require explicit approval. Each is written up above as the recommended default. This table is the canonical in repo list of unresolved decisions for the whole document set; each sibling document carries the subset it owns, numbered consistently with this table, and refers back here.

| # | Decision | Recommended default |
|---|---|---|
| 1 | Identity split versus one row per season | Split: stable identity plus seasonal registration |
| 2 | Coach team scope | Club wide read via `players.view`; team is a filter, 0016 standing rule preserved; team scoped RLS is the rejected alternative |
| 3 | Coach access change from today's `sessions.create` powers | Coach keeps club wide read, loses write (add, edit, import); read not reduced |
| 4 | Export capability holders | Managers and admins |
| 5 | Separate `players.import` and `players.export` capabilities | Yes, separate |
| 6 | Spond import default status | Pending |
| 7 | Historic name retention in audit | No values recorded, ever |
| 8 | Audit retention | Indefinite at current scale, reviewed annually |
| 9 | Permanent deletion versus anonymisation | True deletion, admin only |
| 10 | Season renewal mechanism | Bulk Renew to pending with team and shirt carried forward |
| 11 | Pending players on boards | Yes, via an explicit picker toggle |
| 12 | Browser versus server XLSX parsing | Browser |
| 13 | RPC versus Edge Function import commit | Transactional RPC |
| 14 | Archived season absoluteness | Read only, with an audited unarchive escape hatch |
| 15 | `audit.view` versus per player history access | Separate paths: History rides `players.view`, Activity requires `audit.view` |

Decision 3 (coach write reduction) is independent of decision 2 now that read is club wide: whether coaches keep write or lose it, read stays club wide and no team scope is introduced. The continuity fallback simply grants coaches `players.manage` and `players.import` club wide (see Permissions and capabilities).

Three supplementary items are carried alongside the numbered list, unnumbered here and in the sibling documents, and require the same explicit approval:

- Backfill status and date values: recommended status `registered` with `registered_date = created_at::date`.
- `seasons.manage` default holders: recommended admin only.
- All or nothing import commit versus skip and report: recommended all or nothing; any server side row failure aborts the whole transaction.
- Spond import season targeting: recommended current season only (the organiser account's live subgroup reflects the current squad); the alternative is any non archived season, as the spreadsheet import allows.

## Implementation dependencies

- Migrations land in order: audit foundation plus capability catalogue rows first, then seasons, the identity and registration split, RLS, the backfill and both cascade fixes, then the UI phases. Provisional numbering starts at 0030 (files on disk end at `0029_signup_hardening.sql`); the live ledger is the source of truth and must be confirmed read only at apply time. Forward only migrations; no destructive down migrations for child data; a restore point is documented per the 0028 precedent.
- Every migration here touches the security boundary and goes through the repository's review gates: human review, no auto merge.
- New SQL follows the Foundation era convention: `set search_path = ''` with schema qualified names, explicit grants, and EXECUTE revoked from public, anon and authenticated on privileged functions.
- The security test suite must be wired into CI as part of the first PR (the recorded gap in docs/security/policy-test-matrix.md), and `tests/security/capabilities.test.ts` needs its catalogue pin and literal scanning regex extended for the `players.*`, `seasons.*` and `audit.*` prefixes.
- The non dismissible import confirm state REUSES the existing Modal `dismissible` contract shipped in PR #103 (`dismissible={false}` makes Escape inert, the overlay non closing and the X disabled, `src/components/ui.tsx`, `modalDismissControls`, tested in `src/components/ui.test.tsx`); it is not new work. The only new accessibility work on Modal is `role="dialog"`, `aria-modal`, focus trap and focus restore, which remain absent; details in docs/product/registered-players-ux.md.
- `spond-roster-import` gains season and registration awareness in its own gated function change, moving its gate to `players.import`, writing pending registrations into the server chosen current season, and keeping its child data boundary intact.
- XLSX support requires a new dependency (SheetJS `xlsx`, evaluated in the implementation PR); nothing is added by this scoping work.
- Delivery sequencing, per PR acceptance criteria, rollout order and rollback live in docs/roadmaps/registered-players-delivery-plan.md.
