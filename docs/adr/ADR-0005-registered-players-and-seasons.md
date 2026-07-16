# ADR-0005: Registered players and seasons: stable identity plus seasonal registration

Status: Proposed
Date: 2026-07-16

Decision owners: Club owner (product); repository maintainer (security and data model).

Numbering note: the repo's existing ADRs are ADR-0002 (`docs/adr/ADR-0002-board-player-model.md`) and ADR-0003 (`docs/adr/ADR-0003-invite-only-membership.md`); there is no ADR-0001 or ADR-0004. This file takes the next free number, alongside `docs/adr/ADR-0006-app-audit-events.md` and `docs/adr/ADR-0007-player-import-export-architecture.md`.

This ADR records the headline data model decision for the Registered Players work: the canonical player identity model, the seasons table and its invariants, the schema aspects of registration status and Unassigned players, and a summary of the data migration. Product behaviour lives in `docs/product/registered-players-spec.md`, page design in `docs/product/registered-players-ux.md`, the import and export pipeline in `docs/product/registered-players-import-export.md` and `docs/adr/ADR-0007-player-import-export-architecture.md`, the RLS and capability boundary in `docs/security/registered-players-boundary.md`, the audit foundation in `docs/adr/ADR-0006-app-audit-events.md` and `docs/security/app-audit-boundary.md`, the threat model in `docs/security/registered-players-threat-model.md`, and the phased delivery plan in `docs/roadmaps/registered-players-delivery-plan.md`.

Every statement below is one of three kinds and is labelled where it matters: confirmed current behaviour (cited to a file and object), a proposed product default (this ADR's recommendation), or an unresolved decision requiring approval (marked APPROVAL REQUIRED and listed under Unresolved items).

## Context

### Confirmed current state

All of the following was verified first hand against the repository on 2026-07-16.

The `players` table (`supabase/migrations/0021_players.sql:72-80`) is the app's only table naming children:

- Columns: `id uuid` (default `gen_random_uuid()`), `club_id` (FK `clubs` ON DELETE CASCADE), `team_id uuid NOT NULL` (FK `teams` ON DELETE CASCADE), `display_name text` checked 1 to 40 characters, `shirt_number int` checked 1 to 99, nullable, `created_by uuid NOT NULL` (FK `profiles` ON DELETE CASCADE), `created_at`. There is no `updated_at`, no `updated_by`, no status, no season and no unique constraint beyond the primary key. One index on `(club_id, team_id)` (`0021_players.sql:81`).
- `display_name` holds the child's full name since `supabase/migrations/0023_players_fullname.sql`, a comment only migration that restated the child data boundary after the Spond roster import moved names to full names.
- RLS: `players_select_coach` gates select on `club_id = public.my_club() and public.has_perm('sessions.create')` (`0021_players.sql:101-104`); `players_manage_coach` is one FOR ALL policy with the same condition on both arms (`0021_players.sql:109-115`). This is the one content table in the app whose read is capability gated rather than club wide (`0021_players.sql:91-97`).
- Confirmed comment versus clause mismatch: the 0021 comment claims the with check arm "pins created_by to the writer" (`0021_players.sql:106-108`) but the clause contains no `created_by = auth.uid()` term. The new policies must pin `created_by` explicitly on insert.

Two confirmed data loss hazards follow from the 0021 cascades:

- Team deletion deletes children's rows. `players.team_id` is ON DELETE CASCADE (`0021_players.sql:75`), yet the AdminTeams delete confirmation counts only members and sessions and says "They keep working; their team is cleared. No sessions or people are removed." (`src/routes/AdminTeams.tsx:43-47`). Deleting a team silently hard deletes every roster row on it (and the team's `spond_groups` mapping, `supabase/migrations/0013_spond.sql:60`). The copy is wrong for player data today.
- Coach removal deletes the players they curated. `players.created_by` is ON DELETE CASCADE (`0021_players.sql:78`), and the `remove-user` Edge Function deletes the auth user, cascading through `profiles` (`supabase/functions/remove-user/index.ts`); its success message names only drills, media, templates, programmes and sessions.

Board integration (`supabase/migrations/0028_board_player_boundary.sql`):

- A board token persists at most six fields, `id, number, side, x, y, playerId`, enforced by the check constraint `boards_tokens_minimal_shape` (`0028_board_player_boundary.sql:209-211`), which binds every writer, service role included.
- `playerId` references `public.players` deliberately without a foreign key: "playerId references the roster row (no foreign key: tokens are jsonb, and a deleted player must leave the board intact, its disc simply showing the number). The NAME IS NEVER STORED" (`0028_board_player_boundary.sql:21-24`). The column comment set by 0028 repeats this: "playerId references public.players without a foreign key, so deleting a player leaves the board intact and its disc shows the number alone" (`0028_board_player_boundary.sql:213-214`).
- Names resolve at render time through the gated players select; a parent sees numbered discs only, enforced by Postgres, not the UI. ADR-0002 records the decision and mandates the reference plus gated resolution pattern for any future feature putting person data near club readable rows.

Data layer facts relevant to the decision:

- `usePlayers` reads the whole club roster under the single query key `['players']` (`src/lib/queries.ts`, function `usePlayers`); `useUpdatePlayer` cannot change `team_id`, so moving a player between teams is impossible in today's UI (`src/lib/queries.ts`, function `useUpdatePlayer`); `useDeletePlayer` is a hard delete with no soft delete or archive concept.
- The Spond roster import (`supabase/functions/spond-roster-import/index.ts`) runs with the caller's JWT under RLS, gates on `has_perm('sessions.create')`, dedupes case insensitively on `(club_id, team_id, display_name)` in memory (no database uniqueness exists), and inserts names plus optional shirt numbers only.

Confirmed absences: no seasons concept exists anywhere in schema or app code; no registration status of any kind; no audit or history mechanism; no `updated_by` column anywhere in the migrations.

Migration ledger: files on disk end at `0029_signup_hardening.sql`, with development gaps at 0003, 0004 and 0010. The live ledger is the source of truth for the next number (CLAUDE.md standing rule); `docs/roadmap/foundation-retrospective.md` records the ledger re checked read only on 2026-07-16 ending at 0029. The next slot is therefore provisionally 0030, and every migration number in this document is provisional until confirmed against the live ledger at apply time.

### The problem

The Registered Players work needs a season based register: which children are signed up, or being processed, for which season, on which team, in what state. The current table cannot express any of that. It also destroys child data on two administrative actions (team deletion, coach removal) that its own UI copy says are safe, it cannot hold a child who has not yet been allocated a team (`team_id` is NOT NULL), and it offers no durable key for imports or history. Any redesign is constrained by one hard external fact: saved tactics boards already hold `playerId` values referencing `players.id` with no foreign key, and those references must keep meaning indefinitely.

## Decision

The proposal and the decision of record are the same schema, subject to the approvals listed under Unresolved items.

**Split the model into a stable club level player identity plus a seasonal registration, with a first class seasons table.** Three tables: `seasons` (new), `players` (existing table, evolved, keeping every existing uuid), `player_registrations` (new, one row per child per season).

### `seasons` (new)

| Column | Type and constraint |
|---|---|
| `id` | uuid primary key |
| `club_id` | uuid NOT NULL, FK `clubs` ON DELETE CASCADE |
| `name` | text, 1 to 20 characters (for example "2026/27"), unique per club |
| `starts_on` | date NOT NULL |
| `ends_on` | date NOT NULL, CHECK `ends_on > starts_on` |
| `is_current` | boolean NOT NULL default false |
| `archived_at` | timestamptz nullable |
| `created_by` | uuid nullable, FK `profiles` ON DELETE SET NULL |
| `updated_by` | uuid nullable, FK `profiles` ON DELETE SET NULL |
| `created_at` | timestamptz NOT NULL default now() |
| `updated_at` | timestamptz NOT NULL default now() |

Invariants and behaviour:

- **Exactly one current season per club**, enforced in the database by a partial unique index on `(club_id) WHERE is_current`.
- **Date overlap is not constrained.** Adjacent grassroots seasons may straddle; the name and dates are informational. Validation requires a name and ordered dates.
- **`seasons.manage`** gates create, update, activate and archive. Recommended default grant: admin only, because activation reshapes the whole club's operational view; an admin can grant it to managers through the capability grid. APPROVAL REQUIRED. The capability catalogue changes are specified in `docs/security/registered-players-boundary.md`.
- **Activation is an RPC** (`activate_season`), one transaction: clear `is_current` on the old row, set it on the new, write the `season.activated` audit event (plus `season.archived` when the old season is archived in the same action). Activation never creates, copies or modifies any registration.
- **Archiving the current season alone is refused**: a club always has a current season after setup. Archival happens by activating a successor (the old season gains `archived_at`) or explicitly on a non current season.
- **Archived seasons are read only for registrations**, enforced in the database: the registration write path refuses when the season has `archived_at` set. The only escape is unarchive (clear `archived_at`, gated `seasons.manage`, audited). APPROVAL REQUIRED on absoluteness.
- **Renewal** into a new season creates new registration rows against the same player identities. Recommended: an explicit bulk Renew action (`players.manage`) copying chosen registrations from a source season into the current season as status pending, team carried forward, shirt number carried forward, `registered_date` empty, run as one transactional RPC with a batch id and audit events (source `renewal`). The export and import round trip works day one without the dedicated action. Renew ships late in the plan (the PR 6 window in `docs/roadmaps/registered-players-delivery-plan.md`). APPROVAL REQUIRED on the status reset to pending and the carry forward of team and shirt.
- **Current season defaults everywhere**: the players page opens on the current season, board seeding uses it, the Spond import writes into it (chosen server side, never by the client), and exports name the selected season in the filename and a column.
- **No current season** (pre setup): the players page shows a setup prompt to admins and an empty state to others; imports and board roster seeding are unavailable until a season exists. The migration creates the initial season, so this state only occurs for a hypothetical new club.

### `players` (existing table, evolved: the stable identity)

One row per child per club, keeping the existing uuid so every board `playerId` reference keeps meaning. Fields, and nothing else:

| Column | Type and constraint | Change from today |
|---|---|---|
| `id` | uuid primary key | unchanged, existing values kept |
| `club_id` | uuid NOT NULL, FK `clubs` ON DELETE CASCADE | unchanged |
| `display_name` | text, 1 to 40 characters, the child's full name per 0023 | unchanged |
| `created_by` | uuid nullable, FK `profiles` ON DELETE SET NULL | was NOT NULL ON DELETE CASCADE: **the created_by cascade fix** |
| `created_at` | timestamptz NOT NULL | unchanged |
| `updated_by` | uuid nullable, FK `profiles` ON DELETE SET NULL | new |
| `updated_at` | timestamptz NOT NULL | new |

`team_id` and `shirt_number` move to `player_registrations`. The child data boundary of 0021 and 0023 carries over unchanged: no date of birth, no guardian or contact data, no medical or safeguarding fields, no photos, no link to auth users, no Spond member ids. The exact field justifications and exclusions are in `docs/product/registered-players-spec.md`; the boundary restatement is in `docs/security/registered-players-boundary.md`.

### `player_registrations` (new: the seasonal record)

| Column | Type and constraint |
|---|---|
| `id` | uuid primary key |
| `club_id` | uuid NOT NULL, denormalised for RLS; must equal the player's club, enforced |
| `player_id` | uuid NOT NULL, FK `players` ON DELETE CASCADE |
| `season_id` | uuid NOT NULL, FK `seasons` ON DELETE RESTRICT |
| `team_id` | uuid nullable, FK `teams` ON DELETE SET NULL: **the team cascade fix**; deleting a team makes its players Unassigned instead of deleting them |
| `status` | text NOT NULL, CHECK in ('pending', 'registered', 'withdrawn') |
| `shirt_number` | int, CHECK 1 to 99, nullable |
| `registered_date` | date nullable |
| `created_by` | uuid nullable, FK `profiles` ON DELETE SET NULL |
| `created_at` | timestamptz NOT NULL default now() |
| `updated_by` | uuid nullable, FK `profiles` ON DELETE SET NULL |
| `updated_at` | timestamptz NOT NULL default now() |

**UNIQUE `(player_id, season_id)`**: one registration per child per season.

A registration row carries no name. The name lives once, on the identity row, and resolves through the players select exactly as board tokens do today.

### Registration status: schema aspects

The status vocabulary is `pending`, `registered`, `withdrawn`, held as text with a CHECK constraint, not an enum. Text plus CHECK extends without an enum migration and matches the check constraint style 0021 established. Schema and server rules (the full product behaviour, including default visibility and board eligibility, is in `docs/product/registered-players-spec.md`):

- Allowed transitions, enforced server side by trigger or RPC validation, never UI only:
  - pending -> registered
  - pending -> withdrawn
  - registered -> withdrawn
  - withdrawn -> pending
  - withdrawn -> registered
  - No other transition is accepted.
- `registered_date` is set automatically to the club's current date when status first becomes registered and the field is empty; it stays manually editable under `players.manage` for backdating paper registrations, and import may supply it.
- Withdrawing keeps `team_id` and `shirt_number` and deletes nothing: history and restore fidelity.
- Registrations in an archived season accept no status change (the read only rule above).
- Every transition writes exactly one audit event (`player.status_changed`, or the dedicated `player.withdrawn` and `player.restored` actions) per `docs/adr/ADR-0006-app-audit-events.md`.

### Unassigned players: schema aspects

- Unassigned is `team_id IS NULL` on the registration, a first class state, not a sentinel team.
- Team deletion sets `team_id` null via the FK, turning that team's players Unassigned. This makes the AdminTeams confirmation copy true for player data for the first time; the copy itself is corrected in the page work (`docs/product/registered-players-ux.md`).
- A blank Team cell on import maps to Unassigned (`docs/product/registered-players-import-export.md`).
- Who can see Unassigned registrations under the proposed coach team scope (by default, all_teams holders only) is an RLS question specified in `docs/security/registered-players-boundary.md`.

### Backfill

Each existing `players` row becomes one identity row (same uuid, `display_name`, `created_by`, `created_at` kept) plus one registration row in the initial season, with:

- `team_id` carried from the existing row;
- `shirt_number` carried from the existing row;
- `status = 'registered'`, because today's rows are live operational rosters, not applications in progress. APPROVAL REQUIRED.
- `registered_date = created_at::date`. APPROVAL REQUIRED.

No automatic merging of same named rows: two children are never merged on name alone. Duplicates across teams remain separate identities, cleaned up manually later if the club confirms they are the same child.

## Alternatives considered

### A. One row per child per season (rejected)

Keep `players` as the only table and add `season_id`, `status`, `registered_date` and the audit columns to it. Each season mints a fresh row (a fresh uuid) per child, with the name repeated on every row.

This is the smaller migration, and every read stays single table. It was rejected on the comparison below, decisively on the board reference dimension and the name duplication dimension.

A sub variant, a free text season label column instead of a seasons table, was rejected without full assessment: it cannot enforce the one current season invariant, cannot drive activation or archival, and invites typo fragmented seasons. The task brief requires a proper seasons table.

### B. Stable identity plus seasonal registration (CHOSEN)

The split described under Decision. The comparison that decided it, across the twelve assessment dimensions, each argued for both models:

1. **Privacy.** Split: each child's name is stored exactly once, on one identity row; every other row (registrations, audit, board tokens) carries only uuids. Data minimisation improves over today. Per season: the name is duplicated onto a new row every season, so the quantity of stored child name data grows linearly with seasons retained, the opposite of minimisation.
2. **Deduplication.** Split: a durable Player ID exists, so imports and manual checks can dedupe against one identity set, and "same child, new season" is an id match, not a name guess. Per season: there is no durable key; the only cross season signal is the name, and the club's own rule (never merge on name alone) makes name based dedupe inadmissible, so duplicates accumulate unchecked.
3. **Season renewal.** Split: renewal creates one small registration row per child (season, team, status, shirt), no name copied, expressible as a single transactional bulk action. Per season: renewal duplicates the entire child row including the name, and any correction to a name must then be applied to every season's copy or the copies drift.
4. **Audit history.** Split: audit events attach to one stable `entity_id` across seasons, so a per player history is a single indexed lookup and reads coherently across years. Per season: history fragments across a different entity id per season; assembling one child's history requires joining ids by name, which is both unreliable and exactly the kind of name processing the audit design forbids (see `docs/adr/ADR-0006-app-audit-events.md`).
5. **Deletion.** Split: erasing a child is one identity row delete; registrations cascade with it, and the name is gone from the register in one action. Per season: erasure means finding every season row for the child, matched by name across seasons, with real risk of missing one; a partial erasure silently retains a child's name.
6. **Imports.** Split: the template's Player ID column round trips through export and import, giving a safe update key that stays valid across seasons; last season's export can seed this season's import. Per season: the row id changes every season, so an exported Player ID is stale the moment the season rolls over, and the import falls back to name matching with all its ambiguity. See `docs/adr/ADR-0007-player-import-export-architecture.md`.
7. **Spond integration.** Split: the roster import creates or matches registrations in the current season against existing identities; a repeat import is idempotent within the season, and the same child imported next season attaches to the same identity. Per season: each season's import mints fresh unrelated rows; the Spond pipeline gains no continuity and the dedupe key resets to names every season. See `docs/product/registered-players-import-export.md` for the function change.
8. **Tactics board references.** This is the load bearing dimension. Saved boards hold `playerId` values referencing `players.id` with no foreign key, by design: the token shape is constrained to `id, number, side, x, y, playerId` by `boards_tokens_minimal_shape` (`0028_board_player_boundary.sql:209-211`), and the column comment states "playerId references public.players without a foreign key, so deleting a player leaves the board intact and its disc shows the number alone" (`0028_board_player_boundary.sql:213-214`). Because there is no FK, nothing in the database signals or repairs a stale reference; the reference must simply stay correct. Split: `players.id` is stable for the life of the child's time at the club, so every existing token keeps resolving, this season and every future season, with zero board changes. Per season: at the first season rollover every token's `playerId` points at last season's row; either it dangles (child not re registered under that id) or the child now has a different id, so every saved board in the club degrades to numbered discs after one season and no board can ever reference a child across seasons. The 0028 boundary (reference, not copy; resolve at render) only works if the reference is durable. The per season model breaks it silently.
9. **Migration complexity.** Per season: genuinely simpler, roughly four added columns, one backfilled season value, no new join and minimal data layer change. Split: two new tables, a backfill that splits every existing row into identity plus registration, new RLS on two tables, and a reshaped data layer. This is the one dimension the per season model wins. The cost is accepted: it is paid once, at a scale of roughly 75 to 125 rows, and buys every other dimension.
10. **Child name retention.** Split: one copy of the name per child, ever; historical seasons hold uuids only, so retaining season history retains no additional name data, and audit rows never need a name (they cite the entity id). Per season: retaining N seasons of history retains N copies of every child's name, and deleting old seasons to reduce that conflicts with keeping operational history.
11. **Same player across seasons.** Split: a first class fact; one identity, many registrations, so "which seasons has this child been registered for" is a query, and renewal, history and imports all agree on who the child is. Per season: the question is unanswerable except by name matching, which the never merge on name alone rule rightly forbids as an automatic basis; the model cannot represent its own core continuity.
12. **Player switching teams.** Split: within a season, a team move is one update to `registration.team_id` (audited as `player.team_changed`); across seasons the new registration simply carries the new team; the identity and every board reference are untouched. Per season: within a season the update is the same, but a cross season team switch is indistinguishable from a brand new child, and today's model cannot move a player at all (`useUpdatePlayer` has no team path, confirmed in `src/lib/queries.ts`), so either model is new functionality here; the split makes the move auditable against a stable subject.

The default preference in the task brief was to adopt the split only if it materially improves season renewal and audit safety without expanding the child data stored. It does both: renewal stops duplicating names (dimension 3), audit gains a stable subject without ever recording a name (dimension 4), and the total child data stored strictly shrinks relative to the alternative (dimensions 1 and 10).

## Trade-offs

Accepted costs of the chosen model:

- **Two table reads.** The common list view is a join of registrations to identities (and the name only resolves through the identity row). At club scale (roughly 75 to 125 registrations per season) this is negligible, but every query, hook and RLS policy must handle two tables where today there is one.
- **More migration work.** The backfill splits every row, the RLS is written twice, and the data layer (`usePlayers` and the mutation hooks in `src/lib/queries.ts`) is reshaped rather than extended. Bounded, one off, reviewed as a gated migration.
- **Identity rows outlive registrations.** A child's name persists on the identity row until deliberately deleted, even in a season where they hold no registration. This is the intended retention point (the register keeps continuity), but it means erasure is an explicit act (the admin only permanent delete, `docs/product/registered-players-spec.md`), not a side effect of a season ending.
- **Seasons are effectively permanent once used.** `season_id` is ON DELETE RESTRICT, so a season with registrations cannot be deleted, only archived. This is deliberate (deleting a season must never silently delete registrations) but means season cleanup is archival, not removal.
- **Setup dependency.** Imports, renewal and board roster seeding all require a current season. The migration creates the initial season, so in practice this bites only a hypothetical new club.
- **Enum extensibility bought with weaker typing.** Status as text plus CHECK means the database will accept any value the CHECK lists and nothing else, but there is no enum type for tooling to introspect. Consistent with 0019 (`feedback.status`) and 0021's constraint style.

## Consequences

- **The two confirmed data loss hazards close.** Team deletion sets registrations Unassigned instead of deleting children's rows; removing a coach sets `created_by` and `updated_by` null instead of deleting the players and registrations they created. The AdminTeams confirmation copy, wrong today for player data (`src/routes/AdminTeams.tsx:43-47` versus `0021_players.sql:75`), becomes true and is corrected in the page phase.
- **Every existing board token stays valid forever.** No board migration, no token rewrite, no change to `boards_tokens_minimal_shape` or the render time resolution model of ADR-0002 and 0028. Deleting a player still degrades its discs to numbers, exactly as documented.
- **The players RLS is rewritten.** The select gate moves from `sessions.create` to the new `players.view` capability, writes to `players.manage`, with the proposed coach team scope applied to both tables and the insert policies pinning `created_by = auth.uid()` explicitly (closing the confirmed 0021 comment versus clause gap). The exact policy semantics, the capability catalogue growth from thirteen to twenty keys, the default grants and the deliberate coach access reduction are specified in `docs/security/registered-players-boundary.md` and are approval gated there.
- **The data layer is reshaped.** `Player` splits into identity and registration types; `usePlayers` becomes season parameterised; team moves become possible for the first time; hard delete is replaced by Withdraw and Restore as the normal flow, with permanent deletion admin only. The page replacing Roster is specified in `docs/product/registered-players-ux.md`.
- **The Spond roster import gains season and registration awareness** in its own gated function change: it writes registrations into the club's current season (chosen server side), default status pending, gated by `players.import`. See `docs/product/registered-players-import-export.md`.
- **Audit attaches cleanly.** The audit triggers of `docs/adr/ADR-0006-app-audit-events.md` fire on `players`, `player_registrations` and `seasons`; `updated_at` and `updated_by` on the players domain tables are set by those triggers, establishing the convention the current schema lacks.
- **A durable Player ID exists** for the import and export template (`docs/adr/ADR-0007-player-import-export-architecture.md`).
- **Precedent.** This introduces the first team scoped RLS in the app (players domain only), explicitly changing the standing rule recorded in `supabase/migrations/0016_member_teams.sql` for this domain alone. The change and its precedent are flagged for human review in `docs/security/registered-players-boundary.md`.

## Data migration plan (summary)

The full plan, per PR, with acceptance criteria, rollback and review gates, is `docs/roadmaps/registered-players-delivery-plan.md`. The shape:

- **Numbering is provisional.** Files on disk end at 0029; the next slot is likely 0030, but the live ledger must be confirmed at apply time before any number is fixed (CLAUDE.md standing rule, restated in the numbering paragraphs of 0025 and 0026). Every migration in this programme carries the repo's REVIEW REQUIRED banner and is never auto merged.
- **Order.** First the audit foundation and the capability catalogue rows (provisionally 0030 territory, per ADR-0006), because the schema split's triggers write audit events and its policies reference the new capabilities. Then one gated migration for the seasons table, the identity and registration split, the new RLS, the backfill, the team cascade fix and the created_by cascade fix. UI phases follow with no further schema change until the Spond function update.
- **Backfill.** Creates the initial season (marked current), then splits each existing `players` row into identity plus registration as specified under Decision, carrying team and shirt, with the approval gated status and date defaults. Row counts are verified in the migration, following the 0028 self verifying pattern.
- **Rollback.** Forward only migrations; no destructive down migration is ever written for child data. UI rollback is a feature flag or hidden navigation. A confirmed restore point (backup or PITR window) is required before applying, per the 0028 precedent.
- **New SQL conventions.** Foundation era style: `set search_path = ''` with schema qualified names, explicit grants, no update grant without an update policy, EXECUTE revoked from public, anon and authenticated on privileged functions.

## Unresolved items

The decisions below require approval before the schema migration is written. Numbers follow the canonical list shared across this document set; each is stated with its recommended default. The remaining numbered decisions live with their owning documents: 2 to 5 in `docs/security/registered-players-boundary.md`, 6, 12 and 13 in `docs/adr/ADR-0007-player-import-export-architecture.md` and `docs/product/registered-players-import-export.md`, 7, 8 and 15 in `docs/adr/ADR-0006-app-audit-events.md` and `docs/security/app-audit-boundary.md`, 9 and 11 in `docs/product/registered-players-spec.md`.

- **Decision 1: identity split versus one row per child per season.** Recommended: the split, as decided above. This is the headline decision of this ADR and the reasoning is the twelve dimension comparison.
- **Decision 10: season renewal mechanism.** Recommended: an explicit bulk Renew action into the current season as status pending, with team and shirt number carried forward and `registered_date` empty; the export and import round trip is the day one alternative. Within this: approval on the status reset to pending and on the carry forward of team and shirt.
- **Decision 14: archived season absoluteness.** Recommended: archived seasons are read only for registrations, enforced in the database, with unarchive (gated `seasons.manage`, audited) as the only escape hatch.

Plus the unnumbered schema defaults raised in this document:

- **Backfill status value.** Recommended: `registered` (today's rows are live operational rosters).
- **Backfill `registered_date` value.** Recommended: `created_at::date`.
- **`seasons.manage` default holders.** Recommended: admin only; grantable to managers through the capability grid.

## Implementation dependencies

- **Live ledger confirmation** before any migration number is fixed; 0030 onward is provisional throughout.
- **ADR-0006 audit foundation lands first**: the split migration's row triggers write `audit_events`, and the transitions rule depends on the trigger or RPC layer it establishes.
- **Capability catalogue extension** (`players.view`, `players.manage`, `players.import`, `players.export`, `players.delete`, `seasons.manage`, `audit.view`) per `docs/security/registered-players-boundary.md`; the security harness's catalogue pin and capability regex in `tests/security/capabilities.test.ts` must be extended in the same PR, and the delivery plan requires wiring `tests/security` into CI as part of PR 1 (the suite is confirmed absent from CI today).
- **RLS and policy work** exactly as specified in `docs/security/registered-players-boundary.md`, including the team scope change, the `created_by` pin and the parent role's continued total exclusion.
- **Data layer and page work** per `docs/product/registered-players-ux.md` (the Players page replacing Roster) and `docs/product/registered-players-spec.md` (manual operations, statuses, filters).
- **Spond function change** (`spond-roster-import` season and registration awareness) per `docs/product/registered-players-import-export.md`, deployed and verified under the repo's byte for byte readback rule.
- **Import and export pipeline** per `docs/adr/ADR-0007-player-import-export-architecture.md`, which depends on the Player ID and season model decided here.
- **Security tests and threat coverage** per `docs/security/registered-players-threat-model.md`, mapped to phases in `docs/roadmaps/registered-players-delivery-plan.md`.
- **Human review gates**: every migration in this programme, the RLS, the capability defaults and the backfill values are review gated and must not auto merge, per CLAUDE.md and the delivery plan.
