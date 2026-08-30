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

**Rebuild after every source change, and restart the preview after every
build.** Two different staleness failures, and both of them look like a clean
run. `vite build` writes with `emptyOutDir`, which unlinks the output
directory and recreates it, so a preview started before that keeps serving the
deleted files: it answers 200, every page renders, and every measurement
describes a build that no longer exists. And a build older than the source is
the same defect one level up: edit a rule in `styles.css`, run a tool without
rebuilding, and it measures the previous rule and reports it clean. All three
tools refuse both cases before they launch a browser
(`tools/visual/fresh.mjs`), because a result about the wrong build reads as
evidence.

Query string, all optional:

| Key | Values |
|---|---|
| `screen` | `home`, `sessions`, `login`, `players`, `activity`, `account`, `more`, `dialog`, `primitives` |
| `caps` | `coach` (default), `parent`, `viewer`, `auditor`, `admin`, `planner`, `clubadmin` |
| `theme` | `light` (default), `dark` |
| `state` | `default`, `loading`, `rowsloading`, `empty`, `error`, `archived`, `withdrawn`, `noseason`, `stale`, `overlimit`, `allactions`, `archivedteam`, `inflight`, `writefails`, `history`, `historylong`, `historyerror`, `renewempty`, `renewalldone`, `spondresult`, `longnames`, `loadingmore`, `guarded`, `photo`, `photoinflight`, `photofails`, `photoslow`, `profileloading`, `longvalues`, `writeslow` |
| `at` | the address a screen opens on, when it differs from `state` |

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
separately rather than inventing a state per combination. The Activity feed
uses it for the same reason and only for that: `at=batch` opens the batch deep
link, which is the one filter that lives in the URL, and every other filter it
has is page state reached by driving a control.

## The Activity feed

Three of its states are its own. `longnames` is a long acting adult's name
beside a long team name, which are the two strings the feed can render at any
length; it is a STATE rather than a widening of the shared teams and profiles,
so no existing screenshot moves. `loadingmore` makes the next page never
settle, so pressing Load more leaves the control in its real in-flight state.
`guarded` names what the ROUTE GUARD does when the capability set has no
`audit.view`: the reads all succeed and the page never mounts, so the shot
claims something a proof can check rather than being a picture of Home under a
name that says Activity.

`auditor` is a capability set rather than a state: `audit.view` with no
`players.*` at all. It is the variant that proves the two are different
boundaries, because the feed renders in full and every player reference falls
closed to a neutral label with no history offered and no deletion claimed.

The feed's rows are safe fields only, exactly as the real query selects them,
and the harness resolves a player reference through the same `players.view`
gated identity map the product uses. The one child name the page holds is the
History dialog's title, and `checks.mjs` opens that dialog to prove the name
reaches it and reaches nothing else.

`useAuditActivity` in the stub is a real hook with real state, for the same
reason the Spond roster import stub is: Load more is PRESSED, and the second
page arrives because the stub paginates the fixture rows the way the keyset
does. It applies the filters through `activityQueryConditions`, the product's
own predicate builder, so a batch deep link or a chosen Entity really narrows
the feed and an empty-under-a-filter shot is the screen's own branch.

## The Account screen

Its acceptance is forms, avatar upload and the success and error outcomes,
and every one of those outcomes is the result of a WRITE. None of them can be
reached by inventing rows, so `tools/visual/account.mjs` drives each one
through the fields a coach types into and the control a coach presses, in one
place, for the same reason `dialogs.mjs` exists: shoot, checks and contrast
all need the same presses.

The write phases are the SHARED `inflight` and `writefails`, which mean here
exactly what they mean on the register's dialogs: every write hangs, and every
write refuses. There is no state per control, because which write is driven is
decided by the press rather than by the query string.

The photo is the one axis those two cannot carry, since a removal needs a
photo to remove and a state cannot be two things at once. `photo` is a coach
who has uploaded one, and `photoinflight` and `photofails` are that crossed
with the two write phases. The DEFAULT is still a coach with no photo, which
is what the fixture has always been, so no existing screenshot moves.

`writeslow` and `photoslow` are a write that SETTLES rather than hangs, which
`inflight` cannot be: nothing under `inflight` ever finishes, so nothing it
did could ever be undone. They exist for one question, which is the second
half of the focus claim. Only the photo actions are disabled during a removal,
so a coach can carry on using the rest of the page while a write is in flight;
a repair that moves focus on success must leave it where they put it. The
driver starts the write, moves focus, and watches the write finish.

The stub's TIMING is part of what it models, and the first version of it got
that wrong in a way that made a check pass on a repair that did not work.
TanStack invokes a per-call callback inside its notify batch BEFORE it
notifies its listeners, so when `onSuccess` runs React has not re-rendered and
the DOM still shows the in-flight paint: a control the pending render disabled
is still disabled, and focusing it is a no-op. `useCallbackWrite` goes through
the pending render first, on a timeout rather than a microtask, because what
has to have happened is React's commit.

`profileloading` is the page level gate (the profile read has not answered),
and `longvalues` is a long name, a long sign in email, a long club name and a
long team name, which are the four strings this screen renders at a length the
club chooses. Both are states of their own for the same reason `longnames` is:
the shell renders the coach's name and the club's on every other screen.

A success does not merely print a message: the harness holds the three
editable profile fields in a small store, and a successful upload, name save
or team change writes to it. So the screen moves the way it moves in the
product once `refreshProfile` has run, and a shot named for a success shows a
name that changed, a photo that replaced the initials, and a Save that has
gone back to inert. Without it every proof of a success would hold whether or
not the press did anything.

`planner` and `clubadmin` are two capability sets rather than a widening of
the existing ones. `planner` is `sessions.create` and nothing administrative,
which is the variant that gets the Default team control and no Admin card at
all. `clubadmin` adds `users.manage`, which neither `coach` nor `admin` holds:
those two are the partial administrative case, offered Club, Teams and Spond
and not Users, and `clubadmin` is the one offered all four. Adding
`users.manage` to an existing set would have added a sidebar item and moved
every shot that set already takes.

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
