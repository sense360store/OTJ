# Product excellence roadmap

With the Foundation security programme complete (see
`foundation-retrospective.md`), the next phase is product quality. This
roadmap is built from a read of the current code, not from generic ideas:
every problem below cites the file and line that evidences it, as of the
merge of PR #100.

## How the ranking was made

The weekly life of a grassroots coach with this app runs: browse the
library and plan a session, save it, run it live on the touchline from a
phone, with Spond attendance checked along the way. So the highest traffic
surfaces are the Planner and Sessions list (used every week), the live
session view (every training night), the Library and its add-to-session
modal (feeding every plan), and the Spond attendance card. Templates,
programmes, the roster and the tactics board are lower frequency setup
surfaces.

Two observations shaped the order more than any other:

- The two flows most used on a phone at the pitch, live delivery and
  reordering while planning, are exactly the two with the sharpest friction
  (no wake lock, silent write failures, and a reorder built on desktop only
  drag and drop).
- The app's biggest reliability risks are silent failures, not crashes:
  a session save that fails on poor signal navigates away as if it worked
  and the work quietly vanishes.

Each initiative is scored on user value, frequency of use, current
friction, implementation effort, technical risk and dependency order. Rank
1 is what to do first, which is not always what is most valuable in the
abstract: the top slot goes to the smallest certain win, and reliability
work comes early because later initiatives build on its surfaces.

## Ranked initiatives

| # | Initiative | Value | Frequency | Friction | Effort | Risk |
|---|---|---|---|---|---|---|
| 1 | Content lists newest first (Library "Recent" fix) | Medium | High | High | XS | Low |
| 2 | Make save failures visible | High | High | Hidden until it bites | S | Low |
| 3 | Sessions list built around the week | High | High | Medium | S | Low |
| 4 | Planner works by touch | High | High | High on mobile | M | Low |
| 5 | Touchline hardening for live sessions | High | High | High at the pitch | M | Medium |
| 6 | Session notes that survive | Medium | Medium | Medium | S | Low |
| 7 | Add-from-library modal parity | Medium | High | Medium | S | Low |
| 8 | Error resilience baseline | Medium | Always on | Low until an error | S | Low |
| 9 | Scheduled Spond sync | Medium | Medium | Medium | M | Medium |
| 10 | Accessibility pass on the core loop | Medium | Always on | High for affected users | M | Low |

Deliberately not on the list yet: pagination and richer search in the
Library (`useDrills` fetches every row and filters client side,
`src/lib/queries.ts:413-426`, `src/routes/Library.tsx:71-97`). At the
current scale of a one club deployment this is not felt friction; it
becomes an initiative when the library approaches hundreds of items.
Likewise drawing tools and animation on the tactics board are real wishes
but sit behind everything above on frequency.

---

### 1. Content lists newest first (the Library "Recent" fix)

**Problem.** The Library's default sort is labelled "Sort: Recent" but
shows the oldest drills first. New content sinks to the bottom of the
default view, which is the opposite of what a coach scanning for the drill
they just added expects.

**Evidence.** `useDrills` orders `created_at` ascending
(`src/lib/queries.ts:420`) with an ascending id tiebreak (`:421`). The
Library's sort logic re-sorts only for `duration` and `az`
(`src/routes/Library.tsx:94-95`); there is no `recent` branch, so the
default `'recent'` state (`Library.tsx:42`) falls through to the untouched
ascending query order. The same ascending pattern applies to `useMedia`
(`queries.ts:447`), `useTemplates` (`queries.ts:462`) and `useProgrammes`
(`queries.ts:479`), and the Media page has no sort control at all, so every
content list in the app presents oldest first.

**Proposed outcome.** "Recent" means newest first, everywhere content is
listed.

**Scope.** Flip the four list hooks to `ascending: false` on `created_at`
(keeping the id tiebreak), add an explicit `recent` sort branch in the
Library so the label is honest even if the query order changes again, and a
unit test pinning newest first. No schema change, no new UI.

**Acceptance criteria.** A newly created drill appears first in the
Library's default view; A to Z and Shortest are unchanged; Media,
Templates and Programmes list newest first; the sort behaviour is covered
by a test.

**Estimated size.** XS. One PR, well under 100 lines including the test.

**Dependencies.** None.

### 2. Make save failures visible

**Problem.** A coach who saves a session on poor signal is navigated to the
sessions list as if the save succeeded, while the optimistic cache silently
rolls back and the session vanishes. Live activity changes that fail to
reach Supabase are swallowed the same way, freezing watchers with no
indication to the driver. These are the app's two most important writes and
both fail silently.

**Evidence.** `save()` calls `upsertSession(session)` then immediately
navigates (`src/routes/Planner.tsx:442-445`); the context fires the
mutation with no callbacks (`src/components/SessionsContext.tsx:22-24`);
the mutation's `onError` restores the cache and nothing else
(`src/lib/queries.ts:1706-1709`). `useSetLiveActivity` defines `onSuccess`
only, with no `onError` (`queries.ts:1748-1751`). `start()` shares the
fire-and-forget pattern (`Planner.tsx:446-449`).

**Proposed outcome.** A failed save keeps the coach on the planner with a
clear message and a retry; a failed live activity write tells the driver
that watchers are behind and retries.

**Scope.** One small notification primitive (toast or inline banner) in
`src/components/`, awaiting the session mutation before navigating, an
error path on `useSetLiveActivity` with retry, and the same treatment for
`start()`. No schema change.

**Acceptance criteria.** With the network cut, saving a session shows a
failure and the edits remain on screen; restoring the network and retrying
succeeds; a failed live activity write is surfaced to the driver; unit
tests cover the failure paths.

**Estimated size.** S. One PR.

**Dependencies.** None. Initiatives 4, 5 and 6 reuse the notification
surface, so this lands before them.

### 3. Sessions list built around the week

**Problem.** The sessions list is a flat grid sorted oldest first, so past
sessions occupy the top and the session a coach is about to run is buried.
There is also no way to duplicate a session: to reuse last week's plan a
coach must rebuild it or first convert it into a template.

**Evidence.** The query orders by `date` then `start_time` ascending
(`src/lib/queries.ts:506-508`); the page renders one flat
`auto-fill minmax(330px, 1fr)` grid with no grouping or filter
(`src/routes/Sessions.tsx:274`); no duplicate affordance exists in
`Sessions.tsx` or `Planner.tsx`; the only reuse path is Templates
("Use template", `src/routes/Templates.tsx:67`).

**Proposed outcome.** Upcoming sessions first with the next one prominent,
past sessions grouped below or behind a filter, and a one tap "duplicate"
that opens the planner on a copy with today's date.

**Scope.** Sort and group in the Sessions page, a duplicate action that
copies name, focus, team and activities into a new unsaved session, and
list state for showing past sessions. No schema change.

**Acceptance criteria.** The next upcoming session renders first; completed
and past sessions do not appear above upcoming ones; duplicating a session
opens the planner pre-filled and saving it creates a new row; covered by
component tests.

**Estimated size.** S to M. One PR.

**Dependencies.** Initiative 2 (save feedback on the new duplicate path).

### 4. Planner works by touch

**Problem.** Reordering activities uses native HTML5 drag and drop, which
does not fire on touch devices, so the planner's core interaction is
effectively broken on phones and tablets. The same rows have two smaller
hazards: list keys are array indexes while rows are reordered by splice,
and clearing the duration field coerces to a 0 minute activity that flows
into totals and the live timer.

**Evidence.** Reorder handlers are `onDragStart`/`onDragEnter`/`onDragEnd`
(`src/routes/Planner.tsx:522-535`) on rows marked `draggable`
(`Planner.tsx:168`), with no pointer or touch fallback. The tactics board
already solved this correctly with pointer events, capture and a tap versus
drag threshold (`src/components/TacticsPitch.tsx:83-115`), so the repo
contains its own reference implementation. Keys: `key={i}` at
`Planner.tsx:511` and `src/routes/Sessions.tsx:97`. Duration:
`parseInt(e.target.value) || 0` (`Planner.tsx:245`) under an input declaring
`min=1` (`Planner.tsx:239-257`).

**Proposed outcome.** Activities reorder by touch and mouse alike, with
move up and move down buttons as the keyboard and fallback path; stable
keys; a duration field that cannot produce a 0 minute activity.

**Scope.** Replace the drag implementation with pointer events following
the `TacticsPitch` pattern, add per row move buttons, give activities a
stable client id for keys, clamp duration on blur. Planner only; no schema
change.

**Acceptance criteria.** On a touch device (or emulated touch), an activity
can be dragged to a new position; move buttons reorder without drag;
expanded row state stays with the right activity after a move; an emptied
duration field settles to a valid minimum, not 0; covered by component
tests.

**Estimated size.** M. One PR.

**Dependencies.** None hard; lands best after 2 so any save made from the
planner has visible failure handling.

### 5. Touchline hardening for live sessions

**Problem.** The live view is designed for the touchline but the phone
screen sleeps mid activity, the timer reaching zero changes colour and
nothing else, and the driver's pause is local only so a watcher's clock
runs on past zero. Together these make the app's most time critical screen
the one that most needs a coach to babysit it.

**Evidence.** No wake lock anywhere (zero matches for
`wakeLock`/`navigator.onLine`/`serviceWorker` across the repo). The driver
interval clamps `remaining` at 0 and stops (`src/routes/LiveSession.tsx:249-252`);
the only end of time cue is the `warn` class at 30 seconds
(`LiveSession.tsx:362`), colour only. Pause, play and reset are explicitly
local (comment at `LiveSession.tsx:275`); watchers recompute the clock from
`live_activity_started_at` (`LiveSession.tsx:463-468`) and never learn about
a pause. The design strengths worth keeping are real: timestamp based
watcher sync (`src/lib/queries.ts:1760-1793`), the driver's timer state
persisted to `localStorage` every tick (`LiveSession.tsx:259-261`) so an
offline driver survives a reload, and forced dark theme for contrast.

**Proposed outcome.** The screen stays awake while a live session runs, the
end of an activity is unmissable (vibration and a visible flash, sound
optional), pauses are visible to watchers, and both roles can see when they
have lost connection.

**Scope.** Screen Wake Lock API with reacquire on visibility change,
vibration plus visual cue at zero, a shared paused flag (either a
`live_paused_at` column, which is a gated migration, or a client protocol
on the existing columns; the migration is cleaner and small), and a
connection indicator fed by Realtime channel state. Driver logic and
watcher rendering in `LiveSession.tsx`, sync hooks in `queries.ts`.

**Acceptance criteria.** The device does not sleep during a driven live
session; at zero the phone vibrates and the UI flashes without user
interaction; pausing as driver freezes the watcher clock; pulling the
network shows a disconnected state on both roles within seconds; timer
logic covered by unit tests.

**Estimated size.** M. One PR, plus a small gated migration if the shared
pause column is chosen (review required per CLAUDE.md).

**Dependencies.** Initiative 2 (the live write error path is the natural
place to hang the connection indicator).

### 6. Session notes that survive

**Problem.** The live view's per activity "Quick note" is saved only to
`localStorage` and shown once on the completion screen. A coach's touchline
reflections, the raw material for the next plan, are lost on cache clear
and invisible on any other device.

**Evidence.** Notes are written to component state and mirrored to
`localStorage` (`src/routes/LiveSession.tsx:414-430`), surfaced on the
complete screen (`LiveSession.tsx:167-186`), and never sent to the
database. No notes column exists on `sessions`.

**Proposed outcome.** Notes recorded during a live session persist with the
session and are visible when viewing or duplicating it later.

**Scope.** A nullable jsonb `notes` (or per activity notes inside a small
structure) on `sessions` via a gated migration, a write on session end
with the offline fallback keeping `localStorage` as the buffer, and a read
surface on the session card or planner. Parents never write; the existing
update policies already enforce that.

**Acceptance criteria.** Notes typed during a live session appear on the
session after it ends, from another signed in device; a note typed while
offline survives and syncs when the network returns; RLS tests cover that
parents cannot write notes.

**Estimated size.** S to M. One PR including the gated migration.

**Dependencies.** Initiative 2 (failure surfacing for the notes write);
migration review gate.

### 7. Add-from-library modal parity

**Problem.** The modal that feeds every session plan is a checkbox grid
with a single free text search, none of the Library's corner, age, skill or
level filters, and a fixed two column layout that gets very narrow on a
phone.

**Evidence.** `AddDrillModal` filters by one search string only
(`src/components/AddDrillModal.tsx:12`), renders a checkbox multi select
grid (`AddDrillModal.tsx:52-93`) in a hard two column grid that does not
collapse (`AddDrillModal.tsx:47`). The Library itself has the full filter
set (`src/routes/Library.tsx:71-97`).

**Proposed outcome.** Planning from the modal feels like browsing the
Library: filter by corner and age at minimum, single column on small
screens.

**Scope.** Lift the shared filter logic out of `Library.tsx` into a hook or
helper, apply it in the modal, responsive grid. No schema change.

**Acceptance criteria.** Corner and age filters work inside the modal and
match Library results for the same inputs; the grid is single column below
the phone breakpoint; existing selection behaviour unchanged; covered by
component tests.

**Estimated size.** S. One PR.

**Dependencies.** Initiative 1 (so "Recent" inside the modal is also
newest first, for free via the shared hooks).

### 8. Error resilience baseline

**Problem.** There is no error boundary, so any render error white screens
the whole app; the query client is default constructed with no tuning; and
the shared error state is a dead end with no retry. The page level
loading, error and empty states are otherwise a genuine strength worth
building on.

**Evidence.** Zero matches for `ErrorBoundary`/`componentDidCatch` in
`src`. `new QueryClient()` with no options (`src/main.tsx:10`). The shared
`ErrorNote` renders a generic message with no retry action (used at, for
example, `src/routes/Library.tsx:102-103`, `src/routes/Sessions.tsx:173-174`).
Consistent `Loading`/`ErrorNote`/`Empty` usage across routes is already in
place.

**Proposed outcome.** A render error shows a recoverable club styled
fallback instead of a blank page; failed list loads offer retry; query
retry and staleness are deliberate rather than default.

**Scope.** One `ErrorBoundary` at the shell and one around the live view,
a retry button on `ErrorNote` wired to `refetch`, and explicit
`QueryClient` defaults (retry counts, `staleTime`, focus refetch) chosen
for a touchline device. No schema change.

**Acceptance criteria.** A thrown render error in a route shows the
fallback with a working reload; a failed drills fetch can be retried in
place; query defaults are set in one place with a comment stating the
choice.

**Estimated size.** S. One PR.

**Dependencies.** None.

### 9. Scheduled Spond sync

**Problem.** Attendance counts refresh only when an admin presses "Sync
now", so the counts a coach checks before a session are as fresh as
someone remembered to make them. The function itself is the best
engineered flow in the app; the gap is purely cadence.

**Evidence.** The sync is invoked only from the admin screen
(`src/routes/AdminSpond.tsx:258-268`); no schedule or interval exists
(no cron config, no `refetchInterval`). Freshness is surfaced as
"synced N ago" (`src/components/SpondAttendance.tsx:209`). The function
already handles rate limits with a hard stop on 429 and 5xx
(`supabase/functions/spond-sync/index.ts:174-178, 386-402`) and fails
closed without secrets (`index.ts:208-213`).

**Proposed outcome.** Counts refresh on a schedule (for example hourly in
the daytime), the manual button remains, and stale data is visibly flagged
on the attendance card.

**Scope.** A scheduled invocation of the existing function (Supabase cron
to the Edge Function), a staleness threshold in the attendance UI, and
admin visibility of the last scheduled run's outcome. The Spond policy is
untouched: read only, counts only, same function, same secrets.

**Acceptance criteria.** Counts update without manual action on the
schedule; a failed scheduled run is visible on the admin screen; the
attendance card flags counts older than the threshold; no new data leaves
or enters beyond what the function already handles.

**Estimated size.** M. One PR, touching scheduling configuration
(review with care since it exercises the standing Spond policy, though it
changes none of it).

**Dependencies.** None hard. Technical risk is the highest on this list
(scheduling infrastructure, Spond rate behaviour under a fixed cadence),
which is why it ranks below smaller certain wins despite good value.

### 10. Accessibility pass on the core loop

**Problem.** The app has decent label coverage but three systematic gaps:
the live timer is silent to screen readers and has no non visual cue,
phase and corner meaning is carried by colour alone in the mini timelines
and live progress bar, and modals manage no focus.

**Evidence.** 87 `aria-label`s and consistently labelled icon buttons, but
only 3 `aria-live` regions and none of them the countdown
(`src/routes/LiveSession.tsx:362, 645`). Mini timeline segments carry only
a `title` (`src/routes/Sessions.tsx:95-98`, `src/routes/Templates.tsx:59-62`),
as does the live progress bar (`LiveSession.tsx:351`). The shared `Modal`
has no focus trap or focus return; only ad hoc `autoFocus` exists
(`src/routes/Media.tsx:222`, `src/components/AddDrillModal.tsx:42`). The
tactics board is the counter example done right: focusable discs with
`aria-pressed`, descriptive labels and keyboard delete
(`src/components/TacticsPitch.tsx:119-146`).

**Proposed outcome.** The plan and deliver loop is usable by keyboard and
screen reader: announced timer milestones, text or pattern alongside
colour, and modals that trap and return focus.

**Scope.** An `aria-live` polite region announcing activity changes and
final seconds, text labels or patterns on colour coded segments, focus
trap and restore in the shared `Modal`, and a keyboard path through the
planner (which initiative 4's move buttons largely provide). No schema
change.

**Acceptance criteria.** A screen reader announces activity start and time
up in live mode; mini timeline information is available without colour
perception; Tab cannot leave an open modal and focus returns to the
trigger on close; verified with an automated accessibility check in tests
where feasible.

**Estimated size.** M. One or two PRs.

**Dependencies.** Initiative 4 (shares the planner keyboard work);
initiative 5 (the timer cue and the announcement are one feature).

---

## The first product PR

**Ship initiative 1, the newest first ordering fix, as its own small PR
first.** It is the highest confidence change on the list: the defect is
confirmed at specific lines (`src/lib/queries.ts:420`,
`src/routes/Library.tsx:93-96`), the fix is a handful of lines plus a
test, it touches no schema, no policy and no gated surface, it is visible
to every user on the app's most browsed screen the moment it lands, and it
cannot regress anything that the existing unit suite plus one new test
would not catch.

### Verdict on the Library "Recent" sorting bug

Previously confirmed, and reconfirmed in this survey: `useDrills` orders
`created_at` ascending and the `recent` branch never re-sorts, so the
default view is oldest first. **It should be the first quick product fix,
standalone, not bundled into a broader Library improvement.** Two reasons:

- The broader Library work (pagination, richer search, filter
  improvements) is not yet scheduled on this roadmap because it is not yet
  felt friction at current scale. Holding a confirmed, user visible,
  one line class of defect hostage to an unscheduled initiative is the
  wrong trade.
- The fix is not quite a single line, and that is exactly why it deserves
  its own reviewable PR: the same ascending order pattern exists in
  `useMedia`, `useTemplates` and `useProgrammes`
  (`src/lib/queries.ts:447, 462, 479`), so the PR should sweep all four
  list hooks and add the explicit `recent` sort branch, and nothing else.
  That is a coherent, testable unit on its own.

The one Library item worth bundling with it is nothing: keep it surgical,
land it, and let initiative 7 pick up the shared filter work later.
