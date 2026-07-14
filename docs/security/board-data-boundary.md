# Board data boundary

How the tactics board stores, resolves and protects the only child data it
touches: the names on the team roster. Companion to
`docs/adr/ADR-0002-board-player-model.md` (the decision record) and
`0028_board_player_boundary.sql` (the migration that enforces this).

## The finding this closes

The `players` table is the only table naming children. Its select is gated
to `sessions.create` holders (coaches and admins) by RLS, so parents can
never read it (`0021_players.sql`, restated in `0023_players_fullname.sql`).

Before this boundary, the flow leaked around that gate:

```
players.display_name  →  roster seeding  →  boards.tokens[].label
      (RLS gated)          (client copy)        (club readable)
```

Roster seeding copied each child's name into the token labels of a saved
board, and board reads are club wide by design. The parent UI hid the
labels (`numberOnly`), but that was presentation only: the database still
returned the names inside the `tokens` jsonb to every club member, parents
included. A confirmed safeguarding issue.

## The model now

A persisted board token carries at most six fields:

```
{ id, number, side, x, y, playerId }
```

- `id`, `number`, `side`, `x`, `y`: the disc as before (shirt number,
  colour, pitch fractions).
- `playerId`: present only on roster seeded tokens, referencing the
  `players` row. No foreign key on purpose: tokens are jsonb, and deleting
  a player must leave every board intact.
- There is no label field and NO NAME, ever. The client's `Token` type has
  no label property, `serializeTokens` writes only the six fields, and
  `deserializeTokens` drops anything else (including a legacy label on a
  pre-boundary row) on load.

Names are resolved at render time, never persisted:

```
coach or admin:   boards row  +  players select (RLS: sessions.create)
                  → playerId resolves to the current roster name

parent:           boards row only
                  → nothing to resolve against; discs show numbers
```

The parent UI never issues the players query at all (`usePlayers` is
gated on the viewer's capability), and if anything ever did, RLS returns
zero rows. A `playerId` alone identifies nothing to a reader who cannot
query `players`.

## Enforcement layers

1. **Postgres check constraint** (the real boundary):
   `boards_tokens_minimal_shape` on `public.boards` refuses any write whose
   tokens carry a key outside the six field shape. It holds below RLS, for
   every caller including the service role, so no client bug, no Edge
   Function and no operator script can persist a name in a board again.
2. **Players RLS** (unchanged): the select stays gated to
   `sessions.create`, so resolution is impossible for parents.
3. **Client shape**: the `Token` type has no field a name could occupy;
   roster seeding (`rosterTokens`) takes ids and shirt numbers only and
   never touches a display name.
4. **Defensive load**: `deserializeTokens` ignores a legacy label, so even
   a row that predates the migration (or a hand edited one on a stale
   backup) cannot surface a name through the app.

## Behaviour catalogue

| Event | What happens |
|---|---|
| Seed board from roster | Tokens minted with `playerId` and shirt number; no name involved at any point |
| Save / load board | Six field tokens round trip; anything else is dropped on load and refused on write |
| Coach views a board | Names resolve live from the roster; first name on the disc, full name on hover and the accessible name |
| Parent views a board (session day embed) | Numbers and shape only; no players query is issued |
| Player renamed | Every board shows the new name on next render; no board row changes |
| Player deleted | Boards keep the token; the disc shows its number with no name (safe fallback) |
| Shirt number changed | Saved boards keep the number they were saved with (a board is a point in time shape); a fresh seed uses the new number |
| Manual (tactical) token | Never had a player; carries five fields and is untouched by all of the above |

## The migration and its backfill

`0028_board_player_boundary.sql`, gated and applied by hand after review:

1. Reduces every existing token to the six field shape.
2. A token whose label exactly matches (trimmed) the `display_name` of
   exactly one player in the board's club gains that player's `playerId`,
   so coach boards resolve the same names they showed before.
3. Every label is then removed, matched or not. This is the certain-safe
   rule, not a heuristic: the token label input was removed from the UI
   long before this migration, so a surviving label is either a roster
   derived name or old free text that cannot be proven not to be one (for
   example a since-deleted child's name). Nothing that could be a name
   survives; an ambiguous match (two players sharing a name) links nothing
   and is removed like the rest.
4. A `DO` block verifies every row passes the shape test, aborting the
   whole migration otherwise, and only then is the constraint added.

The transform is preserved as `public.board_tokens_without_names(jsonb,
uuid)` so the security harness proves the exact semantics the migration
ran with, without needing pre-migration rows.

Positions, shirt numbers, token ids and manually placed tactical tokens
all survive the backfill unchanged.

### Rollback

Structural rollback drops the constraint and the two functions (statements
in the migration header). The stripped labels are deliberately not
recoverable by rollback: removing the duplicated names is the point.
Recovery, were it ever required, is a point in time restore.

## Executable proof

`tests/security/boards.test.ts` (local stack only, synthetic names only)
pins each guarantee:

- parent board payload contains no child name and only six field tokens;
- parent cannot resolve a `playerId` (players select returns nothing);
- coach resolves names and shirt numbers correctly;
- rename updates coach resolution without touching the board row;
- delete leaves the board intact with a numbered fallback;
- shirt number changes never rewrite a saved board;
- manual tactical tokens survive byte for byte;
- the constraint refuses labels and stray fields for coaches AND for the
  service role;
- the preserved backfill transform strips names with the exact unique
  match, ambiguity and manual token rules described above.

Unit tests (`src/lib/tacticsBoard.test.ts` and the component suites) prove
seeding never sees a name, serialisation has no field to hold one, legacy
labels are dropped on load, and renders without a name map show numbers
only. The former expected failure (`it.fails`) is gone; the suite is fully
green.

## Performance

- Parent paths are unchanged or cheaper: the same single boards read, and
  no name handling at all.
- Coach board page: unchanged; it already fetched the roster.
- Coach session day: one additional `players` select the first time the
  embed renders, cached under TanStack Query's `['players']` key and shared
  with the board and roster pages, so repeat views cost nothing. Name
  lookup at render is a map access per token.
- No database joins were added anywhere; boards and players stay two
  independent, RLS-cheap selects.

No measurable regression; no caching or batching work is warranted.
