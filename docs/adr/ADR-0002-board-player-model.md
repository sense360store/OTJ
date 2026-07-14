# ADR-0002: Board player model — persist references, resolve names

Status: proposed (lands with the 0028 migration, pending review)
Date: 2026-07-14

Note on numbering: this is the repo's first file under `docs/adr/`; it is
numbered 0002 to match the remediation programme's naming (the Storage
boundary work that preceded it is documented in
`docs/security/storage-boundary.md`).

## Context

The tactics board seats numbered discs on a pitch. A coach can seed the
discs from a team roster (`players`, the only table naming children, its
select RLS-gated to `sessions.create` so parents can never read it).

The original design treated a saved board as a self-contained snapshot:
seeding copied each child's `display_name` into the token's free text
`label`, and the saved `boards.tokens` jsonb kept it. Boards are club
readable by design, so the copy moved children's names from the one
gated table into rows every club member, parents included, can read. The
parent UI masked the labels (`numberOnly`), but the database still
returned the names. That is a confirmed safeguarding issue and a GDPR
data minimisation failure: the same personal data held twice, once
gated, once not.

A relevant history note: the board once had a free text label input, so a
persisted label is not always a roster name; it may be old hand typed
text. Any remediation has to treat surviving labels as
indistinguishable-from-names unless proven otherwise.

## Decision

Persist references, resolve names at render time.

A stored token carries at most `{ id, number, side, x, y, playerId }`.
`playerId` references the roster row (no foreign key: a deleted player
must never corrupt a board). The name is never persisted anywhere in a
board. The client's `Token` type loses its `label` field entirely, so
there is no place for a name in the state model, the serialiser or the
store.

- Coach and admin UIs resolve `playerId` to the current roster name
  through the existing `players` select (RLS: `sessions.create`).
- Parent UIs receive the board row only, never issue the players query,
  and could resolve nothing if they did. The `numberOnly` masking prop is
  deleted: there is nothing to mask.
- A check constraint (`boards_tokens_minimal_shape`) turns the six field
  shape into schema: any write carrying a label, or any other stray token
  field a name could hide in, is refused for every caller, service role
  included.

One gated migration (`0028_board_player_boundary.sql`) backfills existing
rows: labels exactly matching one club player become `playerId`
references; every label is then removed; positions, numbers, token ids
and manual tokens survive; a verification block aborts the migration if
any row still fails the shape test; then the constraint lands.

## Alternatives considered

### A. Persist `playerId` + `shirtNumber` only, resolve names when authorised — CHOSEN

What is described above (with `position`/`side` kept as the existing
`x`, `y`, `side` fields).

- Safeguarding: the strongest of the three. No name exists outside the
  gated table, so there is nothing to leak, and the constraint makes the
  regression class unwritable rather than merely untested.
- GDPR / data minimisation: each name is held exactly once; renaming or
  erasing a child propagates everywhere instantly because there is one
  copy.
- Historical accuracy: shape, numbers and references are point in time;
  the name shown is the current roster name. A renamed child shows the
  new name on old boards (arguably more correct, and required behaviour
  for rename); a deleted child degrades to a numbered disc.
- Offline: a cached board renders; names render if the players query is
  also cached (it is, under TanStack Query's `['players']` key, fetched
  by the board page itself). Degradation is to numbers, never to an
  error.
- Complexity: less client code than before (no masking prop, no label
  plumbing); one extra cached query on the session day embed for coaches.

### B. Persist `playerId` + `publicLabel` + `privateLabel`

Store a parent-visible label and a coach-only label per token, and reject
if `privateLabel` remains visible to parent queries.

Rejected. Postgres RLS is row level, not field level: a club readable
row cannot hide one jsonb key from one role. Enforcing per-field
visibility would need a view or RPC layer splitting every board read into
role shaped variants, reintroducing the exact class of presentation-layer
filtering that caused the finding, with more machinery. It also keeps a
name (the private label) duplicated outside the roster, so rename, erase
and minimisation all stay broken. Strictly worse than A on every
criterion that matters here.

### C. Persist `shirtNumber` only, resolve from the current roster

No `playerId`; a render matches disc numbers against the team's current
shirt numbers.

Rejected. Safeguarding equals A, but correctness is fragile: shirt
numbers are optional in the roster (Spond imports carry none), not
guaranteed unique over time, and reassigning a number silently relabels
old boards with the wrong child, which is worse than showing no name.
Also unable to distinguish a roster disc from a manual tactical disc that
happens to share a number. The reference in A costs one uuid per token
and removes the whole ambiguity class.

## Trade-offs accepted

- Old boards no longer show names for children whose labels could not be
  matched to exactly one current player (deleted players, ambiguous
  twins, pre-history hand typed labels). Those discs show numbers. This
  is the deliberate safeguarding-first direction: uncertain text that
  could be a child's name does not survive.
- The name a coach sees on an old board is the current roster name, not
  the name at save time. For a children's coaching club this is the
  desired behaviour (renames are corrections), but it is a semantic
  change from "snapshot".
- Board token shirt numbers stay point in time; a roster shirt number
  change does not rewrite saved boards. A fresh seed picks it up.
- `playerId` values (opaque uuids) are visible club wide inside board
  rows. They resolve to nothing without the gated players select and
  identify no one on their own.

## Migration

See `0028_board_player_boundary.sql` and
`docs/security/board-data-boundary.md`. Key properties: single gated
migration; certain rules only (exact unique match links, everything else
strips — no name detection heuristics); self verifying before the
constraint lands; transform preserved as a SQL function so the security
harness proves the applied semantics; rollback restores structure but
deliberately not the stripped labels (point in time restore is the
recovery path).

## Future implications

- Any future feature that puts person data near club readable rows must
  follow this pattern: store a reference, gate the resolving table,
  resolve at render. The check constraint is the template for making
  such boundaries schema instead of convention.
- If per-token free text labels ("GK", "press here") are ever wanted
  back, they must come with an allowlisted key added to the constraint,
  a validation rule that the text is bounded and, given this history, a
  security test asserting roster names cannot be persisted through it.
  The constraint forces that conversation to happen in a migration
  review rather than in a UI PR.
- If parents should ever see their own child's name on a board, that is
  a players RLS change (a parent-child link the schema deliberately does
  not have today), not a boards change; the board model already supports
  it without modification.
- The `board_tokens_without_names` function can be dropped in a later
  migration once the harness no longer needs it, or kept as the
  sanctioned cleanup tool for imported or restored board data.
