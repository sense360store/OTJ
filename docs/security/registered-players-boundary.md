# Registered players data boundary

How the Registered Players model stores, scopes and protects the only child
data the app holds: the names on the club's player register. This is the
successor to `docs/security/board-data-boundary.md` in method: state the
boundary, then make it enforceable in Postgres, not in the UI. Companion
documents: `docs/product/registered-players-spec.md` (the product model),
`docs/security/registered-players-threat-model.md` (the threat catalogue and
security test plan), `docs/security/app-audit-boundary.md` (the append only
audit enforcement), and `docs/adr/ADR-0005-registered-players-and-seasons.md`
(the identity split decision record).

Throughout this document, three kinds of statement are distinguished:
confirmed current behaviour carries a citation to a file and policy, function
or line; proposed product defaults are labelled as proposals; unresolved
decisions requiring approval are marked APPROVAL REQUIRED and listed again in
Unresolved items.

## Status

Draft for review.

## Decision owners

Club owner (product); repository maintainer (security and data model).

## Confirmed current state

### The players table and its policies

`public.players` (created by `supabase/migrations/0021_players.sql:72-80`)
holds: id, club_id (FK clubs, on delete cascade), team_id (not null, FK teams,
on delete cascade), display_name (text, check 1 to 40 chars, the child's full
name since `0023_players_fullname.sql`), shirt_number (int, check 1 to 99,
nullable), created_by (not null, FK profiles, on delete cascade), created_at.
There is no updated_at, no status, no season concept, no updated_by, and no
uniqueness constraint beyond the primary key.

RLS (0021_players.sql:99-115): `players_select_coach` gates select on
`club_id = public.my_club() and public.has_perm('sessions.create')`; one
`for all` policy `players_manage_coach` carries the identical condition in
both the using and with check arms. This is the only select gated content
table in the app; every other content read is club wide
(`docs/security/policy-test-matrix.md`, players rows).

Confirmed comment mismatch: the 0021 comment above the manage policy
(0021_players.sql:106-108) claims the with check arm "pins created_by to the
writer", but the actual clause contains no `created_by = auth.uid()` term.
The client (`src/lib/queries.ts:3507`) and the Spond import
(`supabase/functions/spond-roster-import/index.ts:258`) both set created_by
to the caller, but the database does not enforce it. Every insert policy in
the new model pins created_by explicitly, closing this gap.

RLS on players is enabled, not forced (0021_players.sql:99; no
`force row level security` exists anywhere in the schema), so the table owner
and the service role bypass it. That is consistent across the schema and is
addressed under Service role and definer exposure points below.

### The parent exclusion chain today

Four layers, all confirmed:

1. The parent system role holds zero `role_capabilities` rows
   (0012_rbac.sql:236-239 seed; verified empty over a real parent JWT in
   `tests/security/capabilities.test.ts:188`), so `has_perm` returns false
   for every capability and every players policy arm fails.
2. RLS returns zero rows on select (not an error) and 42501 on insert,
   proven by `tests/security/players.test.ts` (parent select strictly `[]`,
   parent insert refused, parent update and delete affect zero rows).
3. The route guard `RequireCap` renders a full screen Splash while the
   capability set loads and only then either renders the outlet or redirects
   (`src/components/RequireCap.tsx:33-38`). There is no transient render of
   gated content. This is the established pattern the new pages keep.
4. Board name resolution returns nothing to a parent: the session day embed
   never issues the players query (`src/routes/SessionDay.tsx:465-466` gates
   `usePlayers` on the viewer's capability, `src/lib/queries.ts:3470-3474`),
   and if anything ever did, RLS answers with zero rows.

### Teams and the standing rule

`member_teams` (member_id, team_id) plus `profiles.all_teams` arrived in
`0016_member_teams.sql`. The standing rule is recorded verbatim at
0016_member_teams.sql:22-25: "teams scope no row level security. Content
stays club wide; the membership set and the flag drive the planner team
filter and switcher only. Hard team isolation, if ever wanted, is a separate
phase." No policy outside 0016's own member_teams policies references
member_teams today.

Writes to `member_teams` require `users.manage` (0016_member_teams.sql:63-83),
`profiles.all_teams` is writable only through `profiles_users_manage`
(0012_rbac.sql:389-393) and is pinned against self service in
`profiles_update_self` via `all_teams = public.my_all_teams()`
(0016_member_teams.sql:121-129). The helper `public.my_all_teams()` is
defined at 0016_member_teams.sql:104-114.

### Boards

Post `0028_board_player_boundary.sql`, a board token persists at most
`{id, number, side, x, y, playerId}`, enforced by the check constraint
`boards_tokens_minimal_shape` (0028:209-211), which holds below RLS for every
caller, service role included. `playerId` references `public.players` without
a foreign key, so deleting a player leaves the board intact and its disc
shows the number alone (0028 column comment, 0028:213-214). Board reads are
club wide (`boards_select_club`, 0020_boards.sql:85-86). Names resolve at
render time through the gated players select only.

### Spond roster import

`spond-roster-import` runs with the caller's JWT and the anon key, never the
service role (index.ts:46-48); it gates on
`has_perm('sessions.create')` via RPC before contacting Spond
(index.ts:165-174); it inserts exactly
`{club_id: caller.clubId, team_id, display_name, shirt_number, created_by:
caller.userId}` (index.ts:252-260); it deduplicates case insensitively on
(club_id, team_id, display_name) in memory; it logs only HTTP status and
counts, never a name, and persists no Spond member ids, guardian or contact
data. Confirmed wording mismatch: CLAUDE.md calls this import "admin
triggered", but the implemented gate is `sessions.create` and the button sits
on the coach facing Roster page (`src/routes/Roster.tsx`). The capability
move proposed below makes the documented intent real.

### Lifecycle hazards confirmed

- Deleting a team hard deletes its roster rows: `players.team_id` is on
  delete cascade (0021_players.sql:75), yet the AdminTeams confirm modal
  says "No sessions or people are removed" (`src/routes/AdminTeams.tsx:43-47`)
  and counts only members and sessions. Children's rows are silently lost.
- Removing a coach hard deletes the players they curated:
  `players.created_by` is on delete cascade (0021_players.sql:78), and the
  remove-user success message does not mention players.

The new model fixes both: registrations reference teams with on delete set
null (players become Unassigned), and the person FKs become nullable with on
delete set null.

### Test coverage and CI today

`tests/security/players.test.ts` proves seven cells (coach and admin read,
parent select `[]`, outsider select `[]`, parent insert 42501, parent update
and delete zero rows, coach insert and delete). Refusal conventions: blocked
insert 42501, blocked update and delete zero rows, trigger P0001, check
constraint 23514 (`tests/security/stack.ts:187-203`). The capability tripwire
pins a 13 key catalogue and scans `src/` with a regex covering only eight
capability prefixes (`tests/security/capabilities.test.ts`). The security
suite is not wired into CI (`docs/security/policy-test-matrix.md:155-162`).
No seasons concept, no audit mechanism and no registration status exist
anywhere in the schema or the app.

## Proposal

### 1. Boundary statement, classification and minimisation

Classification: every row of `players` and `player_registrations` is child
personal data, the most sensitive data class the app holds. `seasons` rows
carry no child data. `audit_events` rows carry no child NAMES, but a child
linked audit event (entity_type player) is pseudonymous child personal data:
it holds a stable player_id and that child's attribute history
(`docs/security/app-audit-boundary.md`, Data classification). It is protected
accordingly, not treated as free of child data. The boundary statement,
extending the one on 0021 and 0023:

The register holds, for each child, exactly one bounded display name and,
per season, one team reference, one status word, one optional shirt number
and one optional registration date. Nothing else. A player is a label on a
register, never an application account.

Exact fields and their operational purpose (full model in
`docs/product/registered-players-spec.md`):

| Table | Field | Operational purpose |
|---|---|---|
| players | id | Stable identity; the value board tokens and audit events reference across seasons |
| players | club_id | Club isolation term in every policy |
| players | display_name | The one name coaches know the child by (1 to 40 chars, full name per 0023); a bounded display name, not a required legal name |
| players | created_by, created_at, updated_by, updated_at | Accountability for who touched the record; person FKs nullable, on delete set null |
| player_registrations | id, club_id | Row identity and the denormalised club isolation term (must equal the player's club, enforced) |
| player_registrations | player_id | Which child this season row belongs to (FK players, on delete cascade) |
| player_registrations | season_id | Which season (FK seasons, on delete restrict) |
| player_registrations | team_id | Team assignment, nullable for Unassigned (FK teams, on delete set null) |
| player_registrations | status | pending, registered or withdrawn (text with check constraint) |
| player_registrations | shirt_number | Optional kit number, 1 to 99 |
| player_registrations | registered_date | When registration completed, for club administration |
| player_registrations | created_by, created_at, updated_by, updated_at | Accountability, person FKs nullable, on delete set null |

Deliberately excluded, restated from the task's boundary and to be written
into the table comments exactly as 0021 and 0023 did: date of birth; age;
guardian or parent details; email; telephone; address; emergency contacts;
medical information; allergy or dietary information; payment information;
registration payment state; photographs; identity documents; consent forms;
safeguarding notes; unrestricted free text notes; links to auth.users; Spond
member ids; anything else not required for the operational purpose above.
Any future proposal to add a field to either table is a gated migration and
a boundary change requiring this document's revision.

Minimisation consequences of the identity split (rationale in
`docs/adr/ADR-0005-registered-players-and-seasons.md`): season renewal
creates one small registration row instead of duplicating the child's name
each season, so the split stores less child data over time, not more, and
deletion of a child is one identity row plus cascaded registrations.

### 2. Capabilities and enforcement

Seven new capability keys (catalogue grows from 13 to 20): `players.view`,
`players.manage`, `players.import`, `players.export`, `players.delete`,
`seasons.manage`, `audit.view`. All are grantable to custom roles; the
reserved trigger list (`users.manage`, `club.manage`) is unchanged. Import
and export stay separate capabilities because the risks differ: export
exfiltrates names, import mutates records.

Default grants (seed, proposed):

- admin (system): all seven.
- manager (system): players.view, players.manage, players.import,
  players.export, audit.view. Not players.delete (an admin grants it
  explicitly if wanted). Not seasons.manage by default (APPROVAL REQUIRED;
  seasons.manage defaults to admin only because activation reshapes the whole
  club's operational view).
- coach (system): players.view only.
- parent (system): none. No player, import, export or audit access of any
  kind.

`sessions.create` stops gating players once `players.view` exists. Coaches
keep club wide READ of the register through `players.view`; they lose the
WRITE powers `sessions.create` gives them today (add, edit, hard delete, Spond
import). This is a WRITE reduction, not a read reduction: COACH WRITE
REDUCTION, APPROVAL REQUIRED. The fallback, if the club wants coaches to keep
writing, seeds coach with players.manage and players.import; with club wide
read there is no team entanglement, so the fallback simply gives write back.
The recommendation is the reduction. Enforcement is always Postgres RLS
through `has_perm` (`supabase/migrations/0015_rbac_roles.sql:407-421`); the UI
only decides what to surface.

### 3. Read is club wide; team is a filter, not an access boundary

Recommended default: `players.view` grants CLUB-WIDE read of every registered
player, all teams and Unassigned included, across the seasons the caller may
view. There is no team scope arm on any select policy. Team is a filter and a
management attribute in the UI and the data, never a row level security read
boundary. This is the requested product outcome: authorised members see the
registered player list and filter All teams or one team.

The standing rule recorded at
`supabase/migrations/0016_member_teams.sql:22-25` ("teams scope no row level
security") is therefore PRESERVED and unchanged. This is a reversal of an
earlier draft of this document, which had proposed the first team scoped RLS
in the app; that design is retained only as a clearly rejected alternative
(see Alternatives) for four reasons: it makes cross season history incoherent
when a coach or a player moves team; a team scoped custom role could rename or
delete a stable identity that also belongs to other teams; Unassigned players
would disappear from the coaches who must allocate them; and it is a large new
access control precedent the feature request does not need. `member_teams` and
`profiles.all_teams` remain what 0016 made them, UI filter and default drivers
that scope no row level security.

Mutations stay capability gated (`players.manage`), import and export stay
capability gated (`players.import`, `players.export`), all club scoped, with
no team arms anywhere. The board name resolution consequence noted in earlier
drafts (a coach seeing numbered discs on another team's board) disappears:
read is club wide, so names resolve club wide for every `players.view` holder.

### 4. Exact policy semantics (proposal, pseudo SQL)

Terms used below, all existing and confirmed:

- `public.my_club()`: the caller's club_id from profiles
  (`supabase/migrations/0001_init.sql:131-139`).
- `public.has_perm(capability)`: true when any role the caller holds grants
  the capability (`0015_rbac_roles.sql:407-421`).

There is no team term: reads and writes are club scoped and capability gated,
with no `member_teams` or `all_teams` arm (section 3).

Policy names are indicative; migration numbering is provisional (likely 0030
onward) and the live ledger must be confirmed at apply time. New SQL follows
the Foundation convention: `set search_path = ''` with schema qualified names
on every new function, explicit grants, and the standing review banner.
Grants follow the standing rule of no grant for a verb without a policy for
that verb: `players` and `player_registrations` get `grant select, insert,
update, delete ... to authenticated`; `seasons` gets `grant select, insert,
update` only (no delete policy exists, see the seasons notes);
`import_batches` gets `grant select` only. `anon` receives nothing, per the
0021 explicit grants lesson.

#### players (identity)

```sql
create policy "players_select_view" on public.players
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

create policy "players_insert_manage" on public.players
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
    and created_by = auth.uid()
  );

create policy "players_update_manage" on public.players
  for update using (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );

create policy "players_delete_admin" on public.players
  for delete using (
    club_id = public.my_club()
    and public.has_perm('players.delete')
  );
```

Notes. Read is club wide for `players.view` holders: every registered child in
the club is visible, name included, with no team arm (section 3). The Add
player flow writes the identity row and its registration together in one
transactional RPC, mandatory rather than optional: two separate client inserts
could leave an identity with no registration if the second failed, and every
sibling document treats the paired write as atomic. Every insert arm pins
`created_by = auth.uid()`, closing the confirmed 0021 comment versus clause
mismatch. `updated_by` and `updated_at` are never trusted from the client:
the audit foundation's triggers set them server side (see
`docs/security/app-audit-boundary.md`).

#### player_registrations

```sql
create policy "player_registrations_select_view" on public.player_registrations
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

create policy "player_registrations_insert_manage" on public.player_registrations
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
    and created_by = auth.uid()
  );

create policy "player_registrations_update_manage" on public.player_registrations
  for update using (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );

create policy "player_registrations_delete_admin" on public.player_registrations
  for delete using (
    club_id = public.my_club()
    and public.has_perm('players.delete')
  );
```

Notes. Read and write are club wide and capability gated, with no team arm
(section 3). Unassigned registrations (team_id null) are read and managed like
any other by `players.view` and `players.manage` holders, which keeps the
coaches who must allocate them able to see them. The denormalised club_id must
equal the referenced player's club, enforced
structurally (composite foreign key on (player_id, club_id) against a unique
(id, club_id) on players, or a trigger; decided at implementation, the
invariant is fixed here). Registration rows are never deleted in normal
flows (Withdraw is an update); the delete policy exists for completeness and
requires `players.delete`. Cascaded deletes arriving from an identity delete
run below RLS by design; the gate is the identity delete policy. Beyond RLS:
a check constraint holds the status vocabulary
(pending, registered, withdrawn), a check holds shirt_number 1 to 99, a
unique constraint holds one registration per (player_id, season_id), status
transitions are validated server side, and a trigger refuses insert, update
and delete when the referenced season has archived_at set (P0001, matching
the harness's trigger refusal convention).

Provenance and linkage are immutable after insert, enforced by trigger
because a `with check` arm cannot compare to the old row: the BEFORE UPDATE
touch triggers that maintain `updated_at` and `updated_by`
(`docs/security/app-audit-boundary.md`, companion housekeeping) also refuse
any change to `created_by` or `created_at` on either table, and to
`player_id` or `season_id` on `player_registrations`, raising P0001 per the
harness convention. Without this guard an authorised updater could rewrite
provenance columns invisibly (neither appears in the audit allow lists) or
repoint a registration at a different child in the club, which the composite
club foreign key alone would not catch. No product flow changes either
linkage: renewal creates new rows, and a wrongly linked registration is
removed and recreated.

#### seasons

```sql
create policy "seasons_select_club" on public.seasons
  for select using ( club_id = public.my_club() );

create policy "seasons_insert_manage" on public.seasons
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('seasons.manage')
    and created_by = auth.uid()
  );

create policy "seasons_update_manage" on public.seasons
  for update using ( club_id = public.my_club() and public.has_perm('seasons.manage') )
  with check   ( club_id = public.my_club() and public.has_perm('seasons.manage') );
```

Notes. Season rows carry no person data, so the select is club wide with no
capability, matching the teams precedent (`teams_select_club`). The exactly
one current season per club invariant is enforced by two mechanisms together
(`docs/adr/ADR-0005-registered-players-and-seasons.md`). A partial unique
index on (club_id) where is_current enforces at most one current season and
holds below RLS for every writer including the service role. A guard trigger
on seasons (BEFORE UPDATE OR DELETE) completes the invariant to exactly one:
it refuses any update that clears is_current outside `activate_season` (the
RPC identifies itself to the trigger through a transaction local flag set
via set_config, the same mechanism the audit foundation uses for flow
context), refuses any update that sets archived_at while is_current is true
(archiving the current season alone), and refuses deleting a current season,
each refusal raising P0001 per the harness convention. The index alone would
not be enough: without the trigger, a direct
`update seasons set is_current = false` through the ordinary
`seasons_update_manage` policy would leave a club with no current season.
Activation goes through the `activate_season` RPC (one transaction,
audited). `player_registrations.season_id` references seasons with on delete
restrict, so a season with registrations cannot be deleted. There is
deliberately no delete policy and no delete grant: no season delete flow
exists in the product, the guard trigger refuses deleting a current season
for every writer, the on delete restrict already makes any used season
undeletable, and the audit trigger mapping defines no season delete action
(`docs/security/app-audit-boundary.md`: no season delete flow exists; if one
is ever added it gains its own action first). A mistaken empty season is
renamed or archived under `seasons.manage`, never deleted; a delete flow, if
ever wanted, arrives with its own policy, grant and audit action in one
gated migration.

#### import_batches

The batch bookkeeping table (shape and idempotency contract in
`docs/adr/ADR-0007-player-import-export-architecture.md`) records actor,
club, season, counts, format and state; never a file fingerprint, names, rows
or filenames. The browser parses the file and sends only parsed rows, so the
server never receives the original bytes and stores no fingerprint (a client
declared hash is unverifiable and is not kept). ADR-0007 and the threat model
defer its access contract to this document, and this is that contract:

```sql
create policy "import_batches_select_view" on public.import_batches
  for select using (
    club_id = public.my_club()
    and public.has_perm('audit.view')
  );
```

- Writes: no insert, update or delete policy or grant exists for any client
  role, extending the audit table's append only rule to all three write
  verbs. The table is written only from inside the `import_players` RPC,
  which runs as its owner and needs no client grant. Spreadsheet imports are
  the table's whole scope: its format vocabulary is csv and xlsx and its
  count semantics describe an uploaded file (ADR-0007). The
  Spond commit RPC and `renew_registrations` record no import_batches row;
  their batch ids exist only on their audit events (the per row events plus
  the run summary, `docs/security/app-audit-boundary.md`), and Spond replay
  protection is the name dedupe within (club, season, team), never batch
  replay.
- Reads: `grant select` to authenticated, gated `audit.view` plus club, the
  proposed default recorded in `docs/security/app-audit-boundary.md`. This
  serves the import history views; parents and coaches without `audit.view`
  read zero rows.
- Replay is not a table read. A repeated `import_players` call with the same
  batch id returns the stored result to a caller the RPC's own in body gate
  permits: same club and `has_perm('players.import')`. It does not require
  `audit.view`. A batch id recorded for another club matches nothing and
  behaves as unknown, a refusal, never a replay (ADR-0007 step 3; threat
  model T14). The stored result carries counts and outcome only, never a file
  fingerprint, row content or names.

#### player_history

The per player history read path (unresolved decision 15, recommended
separate paths; mechanism in `docs/security/app-audit-boundary.md`, which
defers the exact semantics here):

- Shape: an RPC `player_history(p_player_id uuid)` (or an equivalent definer
  backed view), SECURITY DEFINER, `set search_path = ''` with schema
  qualified names, EXECUTE granted to authenticated and self gating in its
  body, the `member_states` shape, so refusal is a clean capability error.
- Gate: the caller must be in the player's club (`my_club()`) and hold
  `players.view`. There is no team arm: read is club wide (section 3), so a
  `players.view` holder may read any club player's history, exactly matching
  `players_select_view` visibility. A child linked history row is pseudonymous
  child personal data (`docs/security/app-audit-boundary.md`, Data
  classification), so this gate is a real access control, not a formality.
- Rows returned: the entity's `audit_events` rows, which carry no child
  names by construction (action, occurred_at, actor name, changed_fields,
  safe_changes, source, batch reference, season and team ids). The stable
  `player_id` and the attribute history they carry are pseudonymous child
  personal data, which is why the read is capability gated.
- The full history is returned across seasons, including events whose team_id
  is a team other than the player's current one; a past team assignment is an
  operational fact held in safe fields only.
- Parents hold neither `players.view` nor `audit.view`; the RPC refuses and
  the underlying select policies return zero rows regardless.

### 5. Parent exclusion chain, restated for the new model

The four layer chain is preserved and extended:

1. Capability: the parent system role receives none of the seven new keys.
   `has_perm` returns false, so every arm of every policy above fails.
2. RLS: parent selects on players, player_registrations, import_batches and
   audit_events return zero rows; inserts are refused 42501. No transient
   read exists at the database whatever the client does.
3. Route: `/players` (and the Activity page) sit behind the RequireCap
   pattern, which renders a Splash until the capability set resolves and
   never transiently renders gated content
   (`src/components/RequireCap.tsx:33-38`). Guards check a capability, never
   a role name.
4. Boards: tokens carry no names (constraint `boards_tokens_minimal_shape`),
   the parent client never issues the players query, and a playerId resolves
   to nothing for a reader whose players select returns zero rows. Parents
   see shape and numbers only, enforced by Postgres.

### 6. Tactics board interaction

The board boundary from 0028 is unchanged and is a design input here:

- `boards.tokens[].playerId` references `players.id` with no foreign key.
  The identity split keeps `players.id` stable across seasons, so every
  existing board token reference stays valid forever. A per season row model
  would have minted new ids each season and orphaned board references; this
  is a core reason for the split
  (`docs/adr/ADR-0005-registered-players-and-seasons.md`).
- Name resolution: read is club wide (section 3), so any `players.view`
  holder resolves names on any board in the club. The earlier draft's coach
  sees numbered discs on another team's board trade off no longer exists.
  Parents, holding no `players.view`, still see numbers only, enforced by the
  players select policy exactly as 0028 intends.
- Deletion and withdrawal never corrupt boards. Deleting a player leaves the
  disc showing its number alone (0028 column comment; pinned by
  `tests/security/boards.test.ts`). Withdrawing changes board eligibility
  for new seeding only (eligibility rules in
  `docs/product/registered-players-spec.md`); saved boards are point in time
  shapes and are untouched.
- Board roster seeding reads only ids and shirt numbers, never names, and
  seeds from the current season's eligible registrations.
- No conflict between the board implementation and this design was found.
  One adjacent defect is recorded here because it sits in the code the PR 3
  board eligibility work touches: two players sharing a shirt number yield
  duplicate token ids when seeding a board (`src/lib/tacticsBoard.ts:189-190`,
  where `takeNumber` returns a supplied shirt number without a uniqueness
  check, feeding the side plus number token id template further down
  `rosterTokens`). It is a rendering bug, not a boundary breach, and is
  fixed or explicitly deferred with the PR 3 board eligibility work
  (`docs/roadmaps/registered-players-delivery-plan.md`).

Boards are club internal today; no public or external sharing surface
exists. Any future proposal to share a board outside the signed in club (a
public link, an export, an embed) is a boundary change requiring this
document's revision, and its baseline rule is fixed now: a shared or public
board representation must strip playerId values entirely and must never
resolve names. Shape and numbers only.

### 7. Spond import boundary

The function's child data boundary is preserved exactly: names plus optional
shirt number only, no Spond member ids, no guardians, no contacts, counts
only logging, fails closed on missing secrets, caller JWT plus anon key with
no service role. What changes:

- Permission: the gate moves from `sessions.create` to `players.import`
  (RPC probe before Spond is contacted, same pattern as today at
  index.ts:165-174). Under the recommended default grants coaches lose the
  trigger; this is part of the COACH ACCESS REDUCTION decision (APPROVAL
  REQUIRED) and finally aligns the implementation with CLAUDE.md's "admin
  triggered" wording, which today it contradicts.
- Season: chosen server side as the club's current season; the function
  refuses when the club has none. The client cannot pick an arbitrary
  season.
- Season: Spond import stays current-season-only (recommended operational
  decision; alternative any non archived season). Unlike the spreadsheet
  import, which may target any non archived season (section 7 of
  `docs/product/registered-players-import-export.md`), the Spond organiser
  account's live subgroup reflects the current squad, so importing it into a
  future season is ambiguous. The function chooses the current season server
  side and refuses when the club has none.
- Target: imported players land as registrations in the current season with
  status pending (recommended; APPROVAL REQUIRED, alternative registered),
  deduplicated by normalised name within (club, season, team) against
  registrations, idempotent on re-run. This name only dedupe has an
  unavoidable limitation, documented in
  `docs/product/registered-players-import-export.md`: because Spond member ids
  are deliberately never persisted, two different children with the same name
  in the same subgroup are treated as one on import. The manual add or the id
  keyed spreadsheet import represents genuine namesakes; Spond cannot.
- Audit: each run gets a batch id and sets the same transaction local
  context the CSV import uses. Per row events are `player.created`, raised
  by the registration insert trigger with source `spond_import` and the
  run's batch id via the GUC; exactly one `players.spond_imported` batch
  summary per run is written through the private writer `log_audit_event`.
  This is the action catalogue and writer split of
  `docs/security/app-audit-boundary.md`, which is canonical for the event
  grammar.

Transitional state (the PR 2 compatibility shim). The delivery plan lands
the schema change and the function rework in different phases
(`docs/roadmaps/registered-players-delivery-plan.md`, PRs 2 and 6), so
between them the function runs a deliberately interim configuration: its
early probe moves from `sessions.create` to `players.manage`, so the probe
matches the write policies the function writes under and cannot drift, and
it writes registrations as status registered, preserving today's behaviour
exactly as the backfill does. The `players.import` gate, the Pending default
(APPROVAL REQUIRED, decision 6) and the batch audit arrive together in the
PR 6 rework, which supersedes the shim. The child data boundary is identical
in both states.

Scope enforcement. Through the shim the function writes through RLS as the
caller, so the club scoped registration write policies in section 4 bind it
directly. The PR 6 rework routes the commit through a transactional
SECURITY DEFINER commit RPC, so the GUC context can stamp source and batch
id (`docs/security/app-audit-boundary.md`, Writers), and RLS does not bind a
definer function's writes; the commit RPC therefore re-checks club and
`players.import` in its own body, exactly as `import_players` does
(section 10). There is no team scope arm to enforce: read and write are club
wide (section 3).

### 8. Permanent deletion, retention and audit

Normal removal is Withdraw, which deletes nothing. Permanent deletion is the
exception path (APPROVAL REQUIRED as against the anonymisation alternative;
recommended: true deletion, for data minimisation):

- Who: holders of `players.delete` only (admin by default), with typed
  confirmation. Full flow in `docs/product/registered-players-spec.md` and
  `docs/product/registered-players-ux.md`.
- What it removes: the identity row and, by cascade, every registration row.
  The child's name then exists nowhere in the database.
- What it does not remove: audit rows (the tombstone rule: a
  `player.deleted` event commits atomically with the row deletion in the
  same transaction, written by the AFTER DELETE trigger on the identity row
  per `docs/security/app-audit-boundary.md`, retaining the opaque entity id
  and no name; history renders "Deleted player"); board tokens (no FK, discs fall back to numbers,
  structurally untouched); and files already exported to members' devices,
  which are outside the system boundary (see spreadsheet handling below).
- Retention, player rows and audit rows both matter: player and registration
  rows live until withdrawn (kept, hidden by default) or permanently deleted.
  Audit rows carry no child names anywhere by design (changed_fields records
  the field name only for display_name changes; safe_changes is limited to
  the approved list: team_id, status, shirt_number, registered_date,
  season_id). But a child linked audit row is still pseudonymous child
  personal data: it holds a stable player_id and that child's attribute
  history (`docs/security/app-audit-boundary.md`, Data classification). So a
  subject deletion request is NOT satisfied by the players deletion path
  alone: removing the identity row is necessary but not sufficient, because
  child linked audit rows and backups still hold pseudonymous history keyed to
  that child. The recommended handling (approval required alongside retention):
  on a substantiated erasure request the child linked audit rows for that
  entity are addressed explicitly (deletion or irreversible severing of the
  identifier), and the obligation is recorded as re appliable after any
  restore. Audit retention (recommended: indefinite at current scale, reviewed
  annually; APPROVAL REQUIRED) is therefore a child personal data decision, not
  decoupled from child data. Actor name snapshots in audit rows are adult
  operational data and persist after profile deletion for accountability. No
  legal retention period is claimed.
- Backups and restores: a database restore can resurrect deleted child rows,
  and child linked audit rows; after any restore, deletion and erasure
  requests actioned since the restore point must be re-applied. Forward only
  migrations, no destructive down migrations for child data, restore point
  documented per the 0028 precedent.

### 9. Cross club isolation

Every policy above pins `club_id = public.my_club()`. A quarantined account
(club_id null, `0029_signup_hardening.sql`) fails every arm closed. The
outsider fixture (a coach in club B) must continue to read zero rows from
players, player_registrations, seasons, import_batches and audit_events in
club A. The import RPC re-verifies every supplied player_id as belonging to
the caller's club and every team id as the club's own (section 10); the export
RPC derives club and actor server side. No cross club matching, reading or writing exists on any
path. Client supplied club_id, actor id, role, capability or count values
are never trusted anywhere.

### 10. Service role and definer exposure points

RLS is enabled, not forced, on all three tables, consistent with the rest of
the schema, so the paths that bypass it must be enumerated and each one
bounded:

- The service role key: never in the client (CLAUDE.md Secrets); used only
  by `invite-user` and `remove-user` today, neither of which touches player
  data. The Spond functions do not hold it. No new service role surface is
  added by this design.
- SECURITY DEFINER RPCs: `import_players`, `export_players`,
  `renew_registrations`, the Spond commit RPC, `activate_season` and the
  `player_history` read all run as their owner, so RLS does not bind them
  and every check lives in their bodies, failing closed: each re-checks its
  capability via `has_perm`, derives club and actor from `auth.uid()` and
  `my_club()`, and validates every row independently of the client preview
  (`docs/adr/ADR-0007-player-import-export-architecture.md`). There is no team
  scope arm to enforce in body, because read and write are club wide
  (section 3): the RPCs check capability and club and validate that every
  supplied player_id and team_id belongs to the caller's club, and that is the
  whole scope. `export_players` applies the same club scope to its read, and
  `player_history` gates on `players.view` per section 4. Definer functions
  use `set search_path = ''` with schema qualified names.
- The audit writer `log_audit_event` has EXECUTE revoked from public, anon
  and authenticated, following the 0028 revoke pattern proven for
  `board_tokens_without_names` (0028:175-176); it is callable only from
  other definer RPCs and the service role.
- FK cascades (identity delete removing registrations) run below RLS; the
  gate is the identity delete policy.
- Constraints that hold below RLS for every caller, service role included:
  the status vocabulary check, the shirt and name bounds, the at most one
  current season partial unique index, one registration per
  (player_id, season_id), and `boards_tokens_minimal_shape` (check
  constraints are not RLS, 0028:50-51). The seasons guard trigger and the
  archived season registration trigger likewise bind every writer,
  completing the exactly one current season invariant for paths RLS does not
  reach (section 4 seasons notes; ADR-0005).
- Migrations and backfills run as owner; each is a gated review per
  CLAUDE.md's review gates and carries the standing review banner.

### 11. Privacy and safeguarding review checklist

The documentation the task requires, with where each item lives (the
enumerated threat catalogue is in
`docs/security/registered-players-threat-model.md`, not here):

| Item | Where documented |
|---|---|
| Child data classification, operational purpose, minimisation | Section 1 above |
| Parent exclusion | Section 5 above |
| Coach visibility | Section 3 above (club wide read via players.view) |
| Manager and admin export risk | `players.export` as a separate capability, export confirmation dialog, audited export, no player data in filenames: `docs/product/registered-players-import-export.md` |
| Spreadsheet handling and local download risk | Parsing in the uploading manager's own browser session; exported and rejected row files exist only on the member's device and the confirmation copy says to store and share them securely: `docs/product/registered-players-import-export.md` |
| No raw file retention | No uploaded file stored, filename never persisted, no file fingerprint stored (the server never receives the file bytes): `docs/adr/ADR-0007-player-import-export-architecture.md` |
| No personal data in logs | The Spond counts only precedent extends to every new path; the import RPC and audit rows never contain row content or names |
| Audit minimisation | Field name only for display_name, safe_changes allow list, no snapshots: `docs/security/app-audit-boundary.md` |
| Deletion and retention | Section 8 above |
| Cross club isolation | Section 9 above |
| Service role risks | Section 10 above |
| Guessed ids | playerId and batch uuids are opaque; a guessed player_id fails club ownership validation in the import RPC; a guessed batch id from another club matches nothing and behaves as unknown, and within the club replay answers only players.import holders (import_batches contract, section 4) |
| Malicious spreadsheet content, formula injection | Browser side parse in the uploader's own privilege context, size and row caps, no formula evaluation, formulas treated as invalid values; export escaping: `docs/security/registered-players-threat-model.md` and ADR-0007 |
| Accidental bulk changes | All or nothing import commit, a file only adds and updates, missing rows never withdraw or delete, mass withdrawal out of scope |
| Insider misuse | Capability separation, every import, export and change audited with actor, audit.view gating the club wide feed |
| Backup implications | Section 8 above |

## Alternatives

- Club wide read (RECOMMENDED, adopted). `players.view` reads every child in
  the club; team is a filter, not a read boundary. This is the requested
  product outcome and preserves the 0016 standing rule. Adopted.
- Team scoped RLS for the players domain (the first team scoped RLS in the
  app). REJECTED. Holders without `all_teams` would read only their
  `member_teams` registrations, changing the 0016 standing rule. Rejected for
  four reasons: it makes cross season history incoherent when a coach or a
  child moves team; a team scoped custom role could rename or delete a stable
  identity that also belongs to other teams; Unassigned players would
  disappear from the coaches who must allocate them; and it is a large new
  access control precedent the feature request does not need. Retained here
  only as the rejected alternative.
- Assigned teams plus Unassigned for coaches. A softer variant of the rejected
  team scope; carries the same coherence and precedent problems and still
  hides genuine club roster from coaches. Rejected with the team scope.
- Read all, edit only assigned. Splits read from write scope for no operational
  need the club has stated; adds complexity. Rejected.
- Anonymisation instead of permanent deletion (rename to "Player N", keep
  rows). Preserves referential convenience but retains a child shaped record
  indefinitely; recommended default is true deletion.
- Coach continuity capability seed (coach keeps manage and import). Documented
  fallback under decision 3; with club wide read there is no team entanglement,
  so this simply gives coaches write back. Recommendation is the write
  reduction (coach keeps club wide read, loses write).
- Enforcing scope in the UI only. Rejected outright: access is never
  enforced by filters; Postgres RLS is always the boundary (repo standing
  rule).

## Decision

This document records the recommended boundary design: the identity split,
the seven capability catalogue additions with the stated default grants, club
wide capability gated RLS for the players domain (no team scope, the 0016
standing rule preserved) with the exact policy semantics in section 4, the
preserved parent exclusion chain, the Spond gate move to `players.import`,
admin only permanent deletion with an audit tombstone, and name free audit
rows that are nonetheless classified as pseudonymous child personal data when
child linked. Every item marked APPROVAL REQUIRED awaits sign off by the
decision owners before any implementation PR proceeds; the coach write
reduction and permanent deletion in particular must not be implemented before
explicit approval. Nothing in this document changes code, schema or
configuration.

## Consequences

- The 0016 standing rule is PRESERVED: player reads are club wide and
  capability gated, no team scoped RLS is introduced, and `member_teams` and
  `profiles.all_teams` stay UI filter and default drivers, not access
  controls. No new team scoping precedent is set.
- Coaches keep club wide READ of the register under the recommended grants
  (`players.view`), and lose the WRITE powers `sessions.create` gives them
  today (add, edit, hard delete, Spond import). This is a write reduction, not
  a read reduction, and is the decision requiring approval.
- Board name resolution is club wide: any `players.view` holder resolves names
  on any board; parents still see numbers only.
- `tests/security/players.test.ts` grows from seven cells to the new capability
  matrix (coach with players.view reads club wide, manager, admin, parent
  reads nothing, outsider reads nothing, anon reads nothing), and
  `capabilities.test.ts` needs both its catalogue pin and its regex extended
  for the `players.`, `seasons.` and `audit.` prefixes; the security suite must
  be wired into CI in the first implementation PR
  (`docs/roadmaps/registered-players-delivery-plan.md`).
- Team deletion stops destroying child rows (registrations become
  Unassigned), and the misleading AdminTeams copy is corrected in the same
  phase.
- Two table reads (identity join registration) replace the single table
  roster query throughout the client.
- Child linked audit events are pseudonymous child personal data
  (`docs/security/app-audit-boundary.md`), so subject deletion and retention
  consider audit identifiers and backups, not only the current rows.

## Unresolved items

The numbered decisions from the canonical list that belong to this document,
each with its recommended default. The numbers are the canonical list's own
and are not sequential here, so they are written as explicit labels rather
than an ordered list (which a Markdown renderer would renumber):

- Decision 1, identity split versus one row per child per season: recommended
  split (stable identity plus seasonal registration).
- Decision 2, coach team scope: recommended CLUB-WIDE read via players.view
  (team is a filter, not an access boundary; the 0016 standing rule is
  preserved). The team scoped read is the rejected alternative (Alternatives).
- Decision 3, coach access change from today's sessions.create powers:
  recommended coach keeps club wide read and loses write (add, edit, import);
  the fallback grants write back. Read is not reduced.
- Decision 4, export capability holders: recommended managers and admins.
- Decision 5, separate players.import and players.export capabilities:
  recommended yes.
- Decision 6, Spond import default status: recommended pending.
- Decision 7, historic name retention in audit: recommended no name values
  recorded, field name only.
- Decision 8, audit retention: recommended indefinite at current scale,
  reviewed annually.
- Decision 9, permanent deletion versus anonymisation: recommended deletion,
  admin only via players.delete.
- Decision 14, archived season absoluteness: recommended read only, with an
  audited unarchive escape hatch under seasons.manage.

Additional item from the same list: seasons.manage default holders,
recommended admin only. The remaining numbered decisions (10, 11, 12, 13, 15
and the backfill values) belong to the sibling documents named in the
introduction and in `docs/roadmaps/registered-players-delivery-plan.md`.

## Implementation dependencies

- Migration order per the delivery plan: audit foundation and capability
  catalogue rows first, then seasons plus the identity and registration
  split with RLS, backfill and the two cascade fixes. All numbering is
  provisional (likely 0030 onward); the live migration ledger must be
  confirmed read only at apply time, never assumed from filenames.
- Every migration here touches the security boundary and is a gated human
  review per CLAUDE.md's review gates; no auto merge.
- The audit foundation (`docs/security/app-audit-boundary.md`,
  `docs/adr/ADR-0006-app-audit-events.md`) must land before the players
  domain triggers that depend on it, including the updated_by and updated_at
  writers.
- The Spond function change (gate move, season awareness) is its own gated
  function change with byte for byte deploy verification per CLAUDE.md.
- Test harness updates travel with each phase: catalogue pin, capability
  regex, new matrix files under `tests/security/`, and CI wiring for
  `npm run test:security` in the first implementation PR.
- Route and navigation changes (the `/players` page, `/roster` redirect,
  RequireCap gating) are specified in
  `docs/product/registered-players-ux.md` and depend on the capability seed
  landing first.
