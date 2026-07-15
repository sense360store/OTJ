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
uuid)` for exactly two purposes: the local security harness executes it to
prove the semantics the migration applied with, and it is the sanctioned
operator cleanup for board data arriving from a restore or an import. It
is not an application RPC: the migration revokes EXECUTE from PUBLIC,
`anon` and `authenticated`, so no signed-in client can call it through
PostgREST; only `service_role` (and superusers) can, and the harness
asserts that refusal. `board_tokens_are_minimal` keeps its default
grants because the check constraint evaluates it for every writing role
and it is a pure shape predicate reading no table.

Positions, shirt numbers, token ids and manually placed tactical tokens
all survive the backfill unchanged.

### Production apply order (mandatory)

1. **Merge and deploy the frontend first**, and verify the new build is
   live (a board save from the new client writes only six field tokens).
2. **Then apply migration 0028** by hand via the connector.
3. **Then run the post-apply verification** below.

Applying 0028 before the new frontend is live is NOT safe: the old
client's `serializeTokens` writes a `label` key on every token it saves,
including hand placed tokens with an empty label, so the new constraint
would refuse every board save in the club until the frontend caught up.
The reverse direction is safe: the new client reads pre-migration rows
(dropping legacy labels on load) and writes tokens that pass with or
without the constraint.

### Preflight (before applying, read-only)

Run this aggregate preflight against production immediately before the
apply and record the counts. It is read-only and returns COUNTS ONLY: it
never outputs a player name, a label value or any row content. Do not
"improve" it into anything that selects labels or names.

```sql
with labelled as (
  select b.id as board_id, b.club_id, btrim(e.tok ->> 'label') as label
  from public.boards b,
       jsonb_array_elements(b.tokens) as e(tok)
  where jsonb_typeof(b.tokens) = 'array'
    and jsonb_typeof(e.tok) = 'object'
    and btrim(coalesce(e.tok ->> 'label', '')) <> ''
),
matched as (
  select l.board_id,
         (select count(*)
          from public.players p
          where p.club_id = l.club_id
            and p.display_name = l.label) as match_count
  from labelled l
)
select
  (select count(*) from public.boards) as total_boards,
  (select count(distinct board_id) from matched) as boards_with_labels,
  count(*) filter (where match_count = 1) as uniquely_matched_labels,
  count(*) filter (where match_count > 1) as ambiguous_labels,
  count(*) filter (where match_count = 0) as unmatched_labels,
  (select count(*)
   from public.boards b
   where jsonb_typeof(b.tokens) <> 'array'
      or exists (
           select 1
           from jsonb_array_elements(b.tokens) as e(tok)
           where jsonb_typeof(e.tok) <> 'object'
              or exists (
                   select 1
                   from jsonb_object_keys(e.tok) as k(key)
                   where k.key not in ('id', 'number', 'side', 'x', 'y', 'playerId')
                 )
         )) as boards_that_will_change
from matched;
```

Reading it: `uniquely_matched_labels` will become `playerId` references;
`ambiguous_labels` and `unmatched_labels` will be stripped without a
link (expected for deleted players, shared names and pre-history hand
typed labels); `boards_that_will_change` is the exact row count the
backfill UPDATE will touch. Expect `boards_that_will_change` to exceed
`boards_with_labels`: the old client wrote a `label` key on every token,
empty ones included, and an empty label key still needs stripping while
counting as no label. If the counts look surprising (for example far
more unmatched labels than the roster's history explains), stop and
investigate before applying.

The backfill is destructive by design (stripped labels are not
recoverable by rollback), so **confirm a usable backup or point in time
restore window for the project before applying**.

### Post-apply verification

1. `select count(*) from public.boards where not
   public.board_tokens_are_minimal(tokens);` must return 0.
2. An insert with a `label` bearing token must fail with
   `boards_tokens_minimal_shape` (roll it back or use a throwaway row).
3. The number of rows the backfill reported updating matches the
   preflight's `boards_that_will_change`.
4. Spot check as a coach that a roster seeded board resolves names, and
   as a parent that the session day embed shows numbers only.

### Rollback

Structural rollback drops the constraint and the two functions (statements
in the migration header). The stripped labels are deliberately not
recoverable by rollback: removing the duplicated names is the point.
Recovery, were it ever required, is the point in time restore confirmed
in the preflight.

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
  match, ambiguity and manual token rules described above;
- no application role can execute the backfill transform: coach and
  parent RPC calls are refused (EXECUTE is service_role only).

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
