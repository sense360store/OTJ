# Visual harness

A development only harness for the visual verification the VISUAL programme
requires. It is not part of the application: nothing under `src/` imports it,
`index.html` never reaches it, and `npm run build` does not include it.

It exists because the acceptance surfaces in
`docs/design/visual-design-read.md` cannot be opened in a browser without a
Supabase project and a signed-in club member, and a redesign that is only
inspected as source is not verified at all.

What it does: mounts the REAL route components, the REAL shell and the REAL
stylesheet, with the data layer replaced by fixtures. Everything a screenshot
shows is the component that ships; only the rows behind it are invented. No
real child, coach or club member appears in the fixtures.

Chromium and `playwright-core` drive it. `playwright-core` is deliberately
NOT a dependency of the application: install it on demand.

```bash
npm install --no-save playwright-core
node tools/visual/fetch-fonts.mjs                    # once: cache the two families

# to look at it
npx vite --config vite.visual.config.ts              # then open the printed URL

# to screenshot and check it
npx vite build --config vite.visual.config.ts
npx vite preview --config vite.visual.config.ts &
node tools/visual/shoot.mjs visual-shots             # one PNG per surface, width, theme and role
node tools/visual/checks.mjs                         # computed styles and live interaction
node tools/visual/contrast.mjs                       # every rendered text run, both themes
```

Build and preview rather than the dev server for the screenshots: the dev
server re-transforms two hundred modules on every page load, which turns the
matrix into half an hour.

**Restart the preview after every build.** `vite build` writes with
`emptyOutDir`, which unlinks the output directory and recreates it, and a
preview started before that keeps serving the deleted files: it answers 200,
every page renders, and every measurement describes a build that no longer
exists. All three tools refuse to run when that has happened
(`tools/visual/fresh.mjs`), because a result about the wrong build reads as
evidence.

Query string, all optional:

| Key | Values |
|---|---|
| `screen` | `home`, `sessions`, `login`, `players`, `more`, `dialog`, `primitives` |
| `caps` | `coach` (default), `parent`, `viewer`, `admin` |
| `theme` | `light` (default), `dark` |
| `state` | `default`, `loading`, `rowsloading`, `empty`, `error`, `archived`, `withdrawn`, `noseason`, `stale`, `overlimit`, `allactions`, `archivedteam`, `inflight`, `writefails`, `history`, `historylong`, `historyerror`, `renewempty`, `renewalldone`, `spondresult` |
| `at` | the address the register opens on, when it differs from `state` |

`state` is read by the screens whose acceptance is a state matrix rather than a
single render. Today that is Registered players, whose reads answer from it, so
every state a screenshot claims is the screen's own branch: `loading` leaves the
seasons read pending (the page level gate), `rowsloading` leaves only the
register pending (the skeleton), `error` fails the register read, `archived`
opens on the past season's address and `withdrawn` on `?status=all`, and `stale`
and `overlimit` are the two refusals the bulk delete dialog can reach.
`allactions` opens on a Spond mapped team's address, which is the only way
Import from Spond is offered, so it is the fullest page header a coach can
reach: nine actions rather than eight. It is also the one state whose proof is
a predicate rather than a selector, because what it claims is that the address
put the team filter on that team and no selector can ask a `select` what it is
set to. `archivedteam` is that address on the archived season instead, and it
exists because `archived` alone leaves the team filter on All teams: Import
from Spond is then absent because no mapped team is selected rather than
because the season is not the current one, and a check asserting the archived
gate against it cannot fail.

The last seven are the DIALOGS' own states, added with VISUAL-02's second
Registered players slice. `inflight` makes every write hang and `writefails`
makes every write reject, so a confirm a driver presses reaches the real
in-flight or refused branch rather than a drawn one; `history`, `historylong`
and `historyerror` are the per player audit read, which answers empty by
default; `renewempty` and `renewalldone` are Renew's two reachable dead ends;
and `spondresult` is the Spond roster import reporting its counts.

`at` exists because a state and an address are two different things.
`playersEntry` derives the address from the state, which is right for the
states that ARE an address, and wrong for `spondresult`: what the write
answers has nothing to do with the team filter, and Import from Spond is
offered only with a Spond mapped team selected. `at` names the address
separately rather than inventing a state per combination.

## The dialogs

`tools/visual/dialogs.mjs` is how a coach reaches each of the eleven
Registered players dialogs, in one place, because all three tools need the
same presses and each of them writing its own is how a matrix and a check
drift apart until one is quietly opening something else.

Every entry names the state the harness must answer with, the title the
dialog must show, and a `proof` of the state its own name claims. Both are
checked: an entry that opens the wrong dialog, or opens the right one in the
wrong state, fails rather than being photographed. That second half is not
decoration. The first version of the import entries handed the file input a
spreadsheet with an invented header row, every row was rejected, the preview
never rendered, and three screenshots were filed under names claiming a
preview, because the driver reported success on the handover.

`tools/visual/shoot.mjs` drives Chromium over the matrix and writes PNGs. It
fails, rather than degrading quietly, when it cannot earn its own result: no
font cache, a cache that does not actually load, a page that threw, or a
required interaction whose control has gone. A screenshot that is present,
plausible and wrong is worse than none.

`tools/visual/contrast.mjs` measures the contrast of every rendered text run,
which is the gap between the other two: the invariant test measures the token
pairings somebody thought to name, and a screenshot shows a colour without
judging it. It found five text runs under their threshold that forty four
invariant tests and the whole screenshot matrix had all passed. It
runs under reduced motion, so it measures the settled paint rather than a
transition, and it treats a gradient as one candidate ground per colour stop
rather than measuring against the page behind it. Two categories are reported
without failing, each for a stated reason rather than as a list of instances:
an inactive control, which WCAG 1.4.3 exempts, and a frozen classification
hue, which the VISUAL programme has not decided to move.
