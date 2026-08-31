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
| `screen` | `home`, `sessions`, `login`, `auth`, `players`, `activity`, `account`, `feedback`, `adminusers`, `adminteams`, `more`, `dialog`, `primitives` |
| `caps` | `coach` (default), `parent`, `viewer`, `auditor`, `admin`, `planner`, `clubadmin` |
| `theme` | `light` (default), `dark` |
| `auth` | `signedin` (default), `signedout` (the default for `screen=login`), `needspassword`, `authloading` |
| `state` | `default`, `loading`, `rowsloading`, `empty`, `error`, `archived`, `withdrawn`, `noseason`, `stale`, `overlimit`, `allactions`, `archivedteam`, `inflight`, `writefails`, `history`, `historylong`, `historyerror`, `renewempty`, `renewalldone`, `spondresult`, `longnames`, `loadingmore`, `guarded`, `photo`, `photoinflight`, `photofails`, `photoslow`, `profileloading`, `longvalues`, `writeslow`, `writeslowfails`, `longclub`, `longmotto`, `commentsloading`, `commentserror`, `promotewarning`, `adminloading`, `adminerror`, `noteams`, `gridloading`, `gridunavailable`, `lastadmin`, `statesunknown` |
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

## Login and Set Password

These two are the product with no shell around it, and the only surfaces
whose acceptance is partly about the BOUNDARY in front of them rather than
about the screen. So `screen=login` and `screen=auth` mount the **real
`App`**: `/login` goes through the product's own `LoginGate`, a protected
address goes through its `RequireAuth`, and an invited member's Set Password
is the one `RequireAuth` renders in place of the application. Mounting
`Login` on its own, which is what the harness used to do, proves the screen
and nothing about the guard, and a fixture that answered for the guard would
be a picture of a redirect that never happened.

`auth` is a KEY OF ITS OWN rather than a `state`, because the two are
orthogonal and one slot cannot hold both: "this member arrived through an
invite and has to set a password" and "the write hangs" are both true of Set
Password in flight. Its default is derived from the screen, so `screen=login`
opens signed out (a signed in visitor is redirected off `/login` by the real
guard, and a screenshot of that is not a Login screenshot) and every other
screen opens signed in exactly as it always has. No existing shot moves.

`at` names the address rather than spelling it: `login` is `/login`,
`protected` is `/players`, which is behind BOTH `RequireAuth` and a
capability guard so a case that reached it proves the outer guard let it
through, and the default is `/`.

`tools/visual/auth.mjs` owns the presses, for the reason `dialogs.mjs` and
`account.mjs` do: all three tools need the same ones. It had already gone
wrong here in the way those modules exist to prevent. `contrast.mjs` used to
open the login screen and click a button matched by `/magic link/i`; no
control on that screen has ever carried those words; the press was wrapped in
a `.catch()`; and every login contrast sweep since has waited thirty seconds,
measured an untouched form and reported it clean.

The auth calls need no state of their own. `inflight` hangs them,
`writefails` refuses them and `writeslow` settles them after a beat, which is
what those three already mean everywhere else, so WHICH call is driven is
decided by the press. `writeslowfails` is the fourth combination and it exists
for one check: a call that settles slowly AND refuses. `writeslow` settles
successfully, and a successful call on these two screens says nothing, so the
outcome message focus would move to is not on screen at all. Under it, "focus
stayed where the member put it" is true of a screen with no repair whatever,
which is precisely how the no-steal check would have gone vacuous when the
repair was retargeted from the pressed control to the message. Both are driven
now, and each names what it proves.

**Three of these states are refusals the SCREEN makes**, before the auth
client is reached: a Set Password mismatch, and each of Login's two "enter
your email first" sentences. Their whole claim is a negative, and a browser
cannot see a call that never happened. They used to be inferred from what WAS
drawn: the mismatch read "the Set Password card is still up, and accepting an
update would have handed the screen to the application", which is two
behaviours standing in for one fact and would hold just as well if the call
were made and its answer thrown away. So the stub COUNTS every call on the
auth client, on `window.__authCalls`, and each of the three asserts a zero. An
absent counter fails rather than passes, because it means the page is not
running the stub the proof was written against. And each zero is paired with a
flow that DOES make the same call and asserts one, since a zero on its own is
also what a deleted `record()` line looks like. `longclub` and `longmotto` are the two strings the
**club** chooses, each at a length a committee would really produce; they are
separate states so a shot named for one is not also carrying the other, and
each entry asserts the other string is still ordinary.

**Two states named in the design read are not states**, and the harness says
so rather than photographing something under their names:

- **Expired link.** An expired invite, magic link or recovery link redirects
  to a bare origin with an error fragment and no session, so the member
  arrives anonymous, `RequireAuth` sends them to `/login`, and the ordinary
  sign in screen renders with nothing said about the link that failed. The
  redirect strips the fragment on the way, so even the URL evidence is gone.
  The `expired-link` guard case drives that arrival and proves what is
  actually there; `expired-link-signedin` drives the same dead link on a
  device that already holds a session, which is let straight through. The
  RULE behind it, that the fragment is not read as an arrival to set a
  password, cannot be tested here at all, because `useAuth` is one of the
  modules this harness stubs; it is proved against the real module in
  `src/routes/login.screens.test.tsx`.
- **Permission limited.** Neither screen reads a role, a profile or a
  capability, and neither can be wrapped by `RequireCap`: `/login` is a
  sibling of the guarded tree, and Set Password is not a route at all. The
  nearest real thing is `LoginGate` turning a signed in visitor away, which
  is a guard answer and is covered as the `signedin-login` guard case.

The route witness is `[data-route]`, rendered only on these two screens.
It is not the same thing as the `data-path` attribute on `.content`, which is
the harness `Shell`'s own witness and does not exist on an auth surface at
all: the real `App` renders its own shell. A check about an auth surface
reads `[data-route]`.

## The Feedback log

The one surface every member of the club both READS and WRITES, parents
included, so its acceptance is a capability matrix as much as a state matrix.
`tools/visual/feedback.mjs` owns the presses for all three tools, for the
reason `dialogs.mjs`, `account.mjs` and `auth.mjs` do.

The list is deliberately ONE list carrying every axis at once, rather than a
state per axis: an item the signed in member filed sits beside items somebody
else filed, an item already promoted to a GitHub issue beside items that are
not, a thread of three comments beside rows with one and rows with none, and
all three kinds beside all five statuses. So a single render is the ownership
matrix, the promotion matrix and the badge matrix, and a shot of it in a
capability variant is the role matrix too.

Three states are its own. `commentsloading` and `commentserror` are the
per item THREAD read, which is a second read that only runs once a row is
opened, so it cannot ride on `loading` and `error`: those answer the page
level read, and a page that never rendered a row has no thread to open.
`promotewarning` is the promotion that succeeded AND carried a warning, which
is neither of the other two outcomes: the public issue exists and writing its
number back to the club's own row did not settle. Everything else reuses the
shared states, and `longnames` carries this screen's long title, body, author
and comment beside the Activity feed's long actor and team.

**Three of its claims are about a call that must NOT happen**, and a browser
cannot see one of those. An ordinary member never triggers the admin GitHub
refresh; a collapsed row never reads its comments; and a form with an
unfinished title never sends anything. So the stub counts every write on
`window.__feedbackCalls`, and the thread reads are recorded as a LIST of
feedback ids rather than a count, because what is claimed is which rows
fetched. An absent counter fails rather than passes, and every zero is paired
with an entry that makes the same call and asserts one.

**A success is applied to the fixture store rather than merely reported.** A
deleted row leaves, a status sticks in its controlled select, a filed item
appears at the top of the log and a posted comment joins the thread and moves
the row's own badge. Without that, every proof of an outcome would hold
whether or not the press did anything, which is the defect the Registered
players Spond import stub was fixed for.

**What the focus checks found, and why one of them is in a primitive.** Three
outcomes on this page take away the control that had focus: a status change
disables its select, a posted comment disables the button and empties the box
it was in, and a deleted item takes its row. All three left focus on the
document body, driven and recorded before anything was repaired, which is what
#215 and #216 asked for. So did a REFUSED write in any of the six dialogs, and
that one turned out to be `Modal`'s: Chrome fires no blur when the focused
element is disabled, so the focusout recovery written for exactly that case
never ran, and with focus outside the dialog its Escape handling and its Tab
trap were both dead. It is fixed in `Modal` rather than six times here.

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

## Admin Users and Admin Teams

Two capability gated screens driven from one module,
`tools/visual/admin.mjs`, for the reason `dialogs.mjs`, `account.mjs`,
`auth.mjs` and `feedback.mjs` each exist: shoot, checks and contrast all need
the same presses, and each of them writing its own is how a matrix and a check
drift apart until one is photographing an untouched page.

Both mount behind the product's own `RequireCap`, so the capability variants
prove a REDIRECT rather than an empty frame. That is a third boundary beside
`players.view` and `audit.view`, and the harness keeps all three apart:
`coach` holds `teams.manage` and `club.manage` and NOT `users.manage`, which
is exactly the partial administrator the Users guard has to turn away, and
`planner` holds neither.

Seven states are their own, and they are named for these screens rather than
reusing `loading`, `empty` and `error`. Those three already answer for the
register, the feed and the log, and the reads this pair needs are shared with
four other harness screens: making `loading` hold the teams read would move
Players, Sessions, Account and Activity. `adminloading` and `adminerror` are
the page's own reads; `noteams` is a club that has never added one;
`gridloading` and `gridunavailable` are the capability grid's own two reads,
which are separate from the page's because the grid renders its heading and
its own state either way; `lastadmin` puts the club's only Admin on somebody
else's row, which is the only arrangement in which the last admin lock is
reachable on a row the signed in member can act on; and `statesunknown` leaves
the member states read unsettled, so no member claims invited or active.

Everything else is the SHARED write phases: `inflight`, `writefails`,
`writeslow` and `writeslowfails` mean here exactly what they mean everywhere
else, and which of the thirteen writes is driven is decided by the control the
driver presses.

One READ answers differently for two screens, and it says so: `useProfiles` is
the Activity feed's list of acting adults AND the Users screen's list of club
members. Widening the Activity fixture to carry the Users matrix would put six
names in Activity's Changed by filter and move every shot it takes, so the
stub branches on `harnessScreen`, once.

The reads come from a small mutable store (`adminStore`), for the same reason
`feedbackStore` exists: most of what these screens do IS a change to a list. A
removed member has to leave it, which is what the focus rule waits for; a
renamed team has to keep its new name; an invited member has to appear; and a
capability tick has to stick, or the grid's pending change count is drawn
rather than derived.

Eleven of the entries claim that a write did NOT happen: a reserved capability
tick that changes nothing, a save that stops at the first refusal without
attempting the second, a form that has not been submitted, the club's only
admin whose removal is refused before it is sent. A browser cannot see a call
that never happened, so every write is counted on `window.__adminCalls` and
every zero is paired with an entry that makes the same call and asserts one.

Which tick belongs to which role and which capability is the identity a visual
refactor is most likely to move silently, so no grid press is ever located by
position: each names BOTH halves through the control's own accessible name
(`"<capability> for <role>"`).
