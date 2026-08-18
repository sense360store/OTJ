# Implementation plan

Status: proposal, reconciled 18 August 2026 against `main` at `afe790d`.
**Nothing in this plan has been implemented.** A settled design is not delivered
work, and no slice below is Done.

The order was re-derived from scratch after coach discovery rather than adjusted
from the previous fourteen-phase plan. Thirteen slices, each a small
independently reviewable pull request or a small pair of them, each leaving OTJ
usable and deployable.

---

## 1. What is already true on `main`

Established before anything is planned, because two of the previous plan's phases
turned out to be finished or unnecessary.

| | State |
|---|---|
| Saved drill diagrams on the planner, session day and both live stages | **Merged.** PR #189, in `main` at `afe790d`. `ActivityDiagram`, `ActivityDiagramView` and `diagramForDisplay` are the seam every later slice mounts. |
| Coach to coach protected link sharing | **Merged and shipped long ago.** `src/lib/share.ts` plus the internal arm of `ShareModal`, reachable from session day. |
| Migration gate hardening | **Merged.** PR #195. |
| Groups, bibs, inclusion, attendance, quick add, Save groups | Shipped. `src/lib/tonight.ts` and `SessionRegister.tsx`. |
| Session lifecycle, event classification, the calendar export | Shipped and correct. Untouched by this programme. |
| Migration numbering | `0049` is the highest on disk. `0050` is claimed by open draft PR #191. |

**Two open pull requests must stay separate from this work**, and nothing here
belongs in either: **#191** (draft, PLAYERS-01 bulk permanent deletion, carrying
migration `0050`) and **#196** (open, not draft, Drill Maker opening on a blank
area).

## 2. What this reconciliation removed

Listed because a design that is merely absent tends to be rebuilt. Each of these
was a designed mechanism in the previous revision, and each is now out of scope.

| Removed | It existed to | Why it is gone |
|---|---|---|
| Station blocks (`sessions.blocks`, `templates.blocks`, `block_id`) | Say which activities are one carousel | Derived from plan order and the existing `Phase` vocabulary. |
| The frozen carousel start map (`blocks[].start`) | Stop a group's starting station moving while a carousel runs | OTJ tracks no running carousel. Nothing to protect. |
| The stateless-rule impossibility proof as a design driver | Justify freezing | The arithmetic is still true and is still recorded as a fact. The conclusion no longer applies. |
| Mid-carousel free-ordinal reassignment | Place a bib colour that appears mid-session | A colour appearing mid-session is a physical event the coach handles on the grass. |
| Live rotation delivery (one timer per rotation, a Rotate cue) | Drive the carousel from OTJ | Live administration. Previous and Next are browsing. |
| Per-activity station placement (`activities[].place`) plus derived area membership | Let a coach place stations weekly | Layouts are venue level and admin owned. Weekly coaches place nothing. |
| Game sides as sets of bib colours on a block | Express a side wearing two colours | Reversed by discovery: each game gets two distinguishable colours, and the game bib is its own stored fact. |
| The generated WhatsApp message carrying children's first names | Tell a parent their child's group | Sharing is coach to coach through the protected link. Nothing leaves the app. |
| `sessions.template_id` | Uniform provenance and a sibling link | No consumer in the settled model. |

**Net effect on the schema: six proposed structures became one column**, and the
programme's migration count fell from six to four.

**Net effect on the product: nothing OTJ does depends on OTJ being correct about
a pitch that is currently moving.**

---

## 3. The slices

Each names its outcome, scope, non-goals, reuse, database change, tests,
dependencies and pull request boundary. Gated means a migration and therefore a
human review that is not auto-merged.

### COACH-1: the club's team order

**Outcome.** An admin states the club's ordering of its own teams, so every later
suggestion has ability context without a per-player field.

**Scope.** `teams.sort_order` plus a partial unique index (M1). A reorder
affordance on `AdminTeams.tsx`. A helper that returns teams in club order, beside
the existing alphabetical read rather than replacing it.

**Non-goals.** No per-player ability score, level or classification, ever. No
change to `sessionTeamsLabel`, which stays alphabetical. No consumer yet.

**Database.** M1 (`04-data-model-proposal.md` section 2). One nullable column,
one partial unique index, plus the audit allow-list decision.

**Tests.** Two teams cannot claim one position. Null everywhere reads as
unordered and the screen says so. Label sorting is unchanged. A security test
that the write still takes `teams.manage`.

**Dependencies.** None.

**PR boundary.** One gated migration PR. One small frontend PR.

### COACH-2: the station list, derived

**Outcome.** Every screen agrees on which activities are the stations, what
number each one is, and how many there are.

**Scope.** One module deriving, from a plan: the ordered station list (the
`Skill` phase activities), the station count, and the games (the `Game` phase
activities). One line in the planner and the week plan editor stating what it
derived. The four or five rule stated where a count is shown.

**Non-goals.** **No schema.** No `blocks`, no `block_id`, no marker on an
activity. No refusal: a coach who plans three stations is told, not blocked. No
reordering behaviour change.

**Reuse.** `Phase` (`src/lib/data.ts:9`), `phaseFor` (`src/lib/drillPicker.ts`),
`sessionMinutes` unchanged.

**Database.** None.

**Tests.** Station numbering follows plan order. Reordering renumbers. A plan
with no Skill activities derives no stations rather than guessing. The derived
count is stated, including when it is three or six.

**Dependencies.** None. **Gates** COACH-3, COACH-6 and COACH-7.

**The residual, carried openly.** A `Skill` activity that is not a station makes
the derived count wrong. It is visible rather than silent because the count is
stated. If it proves real in use, the fix is one optional key on the activity
plus `toActivity` and `toActivityRow`, which is not a migration
(`08-open-questions.md`, D4).

**PR boundary.** One PR.

### COACH-3: the suggested setup

**Outcome.** One or two days out, a coach opens the session and the night is
already drafted: the station count, the groups, and a colour for each.

**Scope.**
- A recommendation from **confirmed attendance only**: 24 or more recommends 5
  stations and 5 groups, fewer recommends 4, three is never recommended.
- Group generation: keep normal teams whole where practical, combine only
  **adjacent** bands, prefer 6/5/5/4 over splitting two squads, give each group a
  **unique** bib colour from the fixed vocabulary order.
- The statement that group 1 starts at station 1, derived on every read.
- Readiness, derived: an included child with no effective bib, or two active
  groups sharing a colour, means not ready, with the fix named.

**Non-goals.**
- **Nothing persists without Save groups.** The suggestion is a draft.
- **Nothing is rewritten because attendance changed.** That is COACH-4.
- No per-player ability field. No Group entity. No `group_id`.
- No configuration for rotation direction or starting station.
- **Unanswered is not attending**, and receives no bib, group or game. `waiting`
  is treated the same way and stays visible under Everyone.
- Spond still reads as context only. A club with no Spond gets the whole surface,
  and a Spond failure renders as no context, never as "nobody is coming".

**Reuse.** `src/lib/tonight.ts` entirely, `src/lib/bibs.ts`, `tonightCounts` as
the only count builder, `SessionRegister.tsx`, `useSaveTonight`.

**Database.** None.

**Tests.** 23 confirmed recommends 4 and 24 recommends 5. Three is never
recommended at any count. Colours are unique and follow the vocabulary order. The
generator keeps teams whole where it can and combines only adjacent bands. With
`sort_order` null it keeps teams whole and says the order is unset. Moving a
child writes nothing to `players`, `player_registrations` or `teams`, asserted
directly because a well-meaning "also update their team" convenience is the most
plausible regression in the programme.

**Dependencies.** COACH-2. COACH-1 for banding, degrading honestly without it.

**PR boundary.** One PR for the pure generator and its tests. One for the screen.

### COACH-4: keeping the coach's work when attendance changes

**Outcome.** Replies arriving after the coach has arranged the night do not throw
the arrangement away.

**Scope.** Remove children who are no longer attending; place newly confirmed
children; **keep every assignment already saved**; rebalance only where
necessary; state what changed in one sentence.

**Non-goals.** No regeneration by default, ever. No provenance column: the rule
preserves all saved assignments rather than only the manual ones, so it never
needs to know which were which. A deliberate Reset that regenerates from scratch
is explicitly **later work**, not this slice.

**Database.** None.

**Tests.** A saved setup plus one new confirmation places one child and moves
nobody. A departure empties one place and moves nobody. A save, a refresh and a
second save are idempotent. Reset is absent.

**Dependencies.** COACH-3.

**PR boundary.** One PR.

### COACH-5: venue layouts

**Outcome.** An admin describes each venue once: where four stations go, where
five go, where one game goes, where two go. Every coach reuses it every week.

**Scope.** M2 (`venues.layout`), `src/lib/venueLayout.ts` (parser, serialiser,
signature, sharing `clampFraction` with the diagram and the board), an admin
editor on `/admin/venues` with draggable and resizable numbered zones, and a
read-only renderer.

**Non-goals.** **No imagery, satellite or otherwise.** No coordinates, no
address, no navigation. **No weekly placement of any kind**, and no per session
composer. No layout versioning beyond the shape version.

**Reuse.** The whole shape discipline of `0046` and `src/lib/drillDiagram.ts`,
deliberately, so this is the third instance of a known pattern rather than a new
one.

**Database.** M2. One nullable jsonb column plus a check constraint stating the
key allow-list.

**Audit, and do not miss this.** `audit_venues()` treats an update as a rename
and `describeActivityEvent` renders `venue.updated` as "Venue renamed". That
sentence becomes false. Either the allow list gains `layout` and the label
becomes "Venue updated", or the label and its comment are corrected.

**Tests.** Parser and serialiser round trip. An unknown version yields no layout.
Out-of-range coordinates are clamped. A corrupt zone is dropped rather than
taking the layout with it. The constraint refuses a key outside the allow-list,
including a location-shaped one, and holds against service_role. A zone count
that disagrees with `slots` is refused.

**Manual smoke.** Configure Haggs Hill with four and five station layouts, then a
venue that uses a third of a pitch. Confirm both render legibly at phone width.

**Dependencies.** None. Can run in parallel with COACH-1 through COACH-4.

**Rollback.** Drop the constraint, then the column. **Dropping the column
discards every saved layout**, so drop the constraint alone unless the feature is
being withdrawn.

**PR boundary.** One gated migration PR. One PR for the model and its tests. One
for the admin editor. One for the renderer, or folded into the editor.

### COACH-6: the setup map

**Outcome.** A coach opens the session on their phone and sees where everything
goes, without being told.

**Scope.** On session day, load the venue's layout for the session's derived
station count and draw the zones. Each zone carries the **station number, the
drill name and the group starting there**. A subtle clockwise cue. The same
stations available as an ordinary list.

**Non-goals.** **No drill diagram inside a zone.** No pinch-dependent design. No
progress, no current station, no rotation state. No editing of anything from
here.

**Reuse.** COACH-5's renderer, COACH-2's station list, `tonightGroups`,
`SessionDay.tsx`.

**Database.** None.

**Tests.** A session whose venue has no layout for its count says so in one
sentence and blocks nothing. A session with four stations loads the four station
layout. Zone labels carry number and name, never colour alone. Screen-level tests
at phone width.

**Dependencies.** COACH-2 and COACH-5. COACH-3 for the group labels, degrading to
number and name without it.

**PR boundary.** One PR.

### COACH-7: the station detail screen

**Outcome.** One tap from the map, a coach who has never seen the drill can run
it.

**Scope.** Full screen: station number, drill name, the diagram large, the
objective, two or three concise coaching points. **Previous station**, **Next
station**, **Back to setup map**.

**Non-goals.** **No equipment on this screen**; it belongs to setup and was dealt
with before the children arrived. No administrative metadata. **Previous and Next
are browsing** and must not imply session progress: no wording, no highlight and
no persisted position may suggest otherwise.

**Reuse.** `ActivityDiagram` and `DrillDiagramView` exactly as they are mounted
on session day today, so this is a layout around an existing seam.

**Accessibility, which is scope rather than a footnote.** Tap targets at or above
the 44 pixel minimum the app already uses. Keyboard and screen reader paths
through map, station and back. This is where the phone half of QUALITY-02 should
be pulled in rather than deferred again.

**Tests.** The screen renders number, name, diagram, objective and points and
**not** equipment. Next from the last station does not wrap into a claim about
progress. An England Football drill still shows its own image and no hand drawn
diagram, through the existing rule.

**Dependencies.** COACH-6.

**PR boundary.** One PR, possibly two if the navigation is substantial.

### COACH-8: the game plan

**Outcome.** The games are planned as their own arrangement, with their own bibs,
without destroying the station groups.

**Scope.**
- M3, `register_entries.game_bib_colour_override`.
- Game resolution in `src/lib/bibs.ts`: game override, else the effective station
  bib.
- A recommendation: one game at 12 or fewer confirmed, two at 13 or more, aiming
  at 5v5 or 6v6 and avoiding 7v7.
- Suggested sides from the club team order: with two games the upper teams form
  the stronger game and the lower the development game, with the middle band
  split where the numbers need it; with one game the sides are balanced by
  ability with the stronger players distributed across both.
- Where possible, two clearly distinguishable colours per game.
- The game plan shows player names, side and game bib colour.
- The games view on session day, using the venue's game layout.

**Non-goals.**
- **The station bib plan is never written by this slice**, and a test asserts it.
- **The thresholds are not policy.** One named adjustable place, with the
  reasoning beside them, producing a sentence and never a change.
- **The recommendation never rewrites the plan.** Two planned games stay two.
- No per-player side column and no per-player game number.
- No averaging two games into identical mixtures.

**Database.** M3. One nullable column with the closed colour vocabulary, copying
nothing from the existing column in either direction, proven in the migration's
self-verification in the manner of 0047.

**Tests.** A game re-bib leaves `bib_colour_override` byte for byte unchanged, and
leaves `present` and `included_in_groups` untouched. 12 recommends one game and
13 recommends two. A child nobody re-bibbed plays in their station colour. Sides
follow the club order and the middle band is the one that splits. A save sends
only the columns that changed.

**Dependencies.** COACH-3 for the groups, COACH-1 for the banding, COACH-5 for
the games view.

**Unresolved before this slice starts**, not during it: how a game bib colour
resolves to a game and a side (`08-open-questions.md`, D3).

**PR boundary.** One gated migration PR. One PR for the resolution and the
suggestion. One for the screens.

### COACH-9: the share, checked rather than built

**Outcome.** A coach sends the session to another coach from the delivery
surface, and nothing operational leaves the app.

**Scope.** Keep the existing internal share reachable from the redesigned
delivery surface. Add a test pinning the payload: a URL and a title, with no
player name, bib, group, game or Spond field.

**Non-goals.** No WhatsApp specific integration. No new share seam. No
per-recipient variant. No public projection.

**Database.** None. **Edge Functions.** None.

**Dependencies.** COACH-6 for placement; the test half depends on nothing.

**PR boundary.** One small PR.

### COACH-10: one authoring seam

**Outcome.** The planner and the week plan editor stop maintaining two activity
editors.

**Scope.** One shared activity-list editor used by `Planner.tsx` and
`TemplateFormModal.tsx`, owning the list, the add bar, the row, reorder, phase
and duration. Hosts supply what genuinely differs.

**Non-goals.** **No new affordance at all.** If a user notices this slice, it went
wrong.

**Tests.** The existing `Planner.test.tsx` and `TemplateFormModal.test.tsx`
suites pass unchanged, which is the right guard for a refactor that could quietly
change behaviour in one host. A source-text test that both hosts mount the same
seam.

**Dependencies.** None. **Gates** COACH-11 and COACH-12.

**PR boundary.** One PR.

### COACH-11: create and draw a drill from either surface

**Outcome.** A coach writing a plan, whether a programme week or Tuesday's
session, can create the drill they have in mind, draw it, and carry on.

**Scope.** **New drill** in the shared add bar. A minimal create form. **Draw
it**, opening `/drill/:id/diagram` and returning to where it was opened from with
the draft intact. **Turn into a drill** on a custom activity.

**Non-goals.** No adaptation semantics (COACH-12). No Drill Maker tool changes.
No new capability: this needs `drills.create`, exactly as creating one from the
library does.

**The hazard, and it has two cases.** Both hosts hold an unsaved draft and
leaving to draw must not lose either. The planner's lives in `sessionSubmit.ts`
and `useGuardedSubmit`; the week plan editor's lives in `TemplateFormModal`'s own
form state inside a modal, which unmounts. Decide it once in the seam.

**Dependencies.** COACH-10.

**PR boundary.** One PR, possibly two if the modal round trip is substantial.

### COACH-12: adapt a drill for one session

**Outcome.** A coach changes a drill for Saturday and nothing else changes, and
the library does not fill up with copies.

**Scope.** M4 (`drills.variant_of`). **Adapt for this session** duplicates the
drill including the diagram and repoints the activity. **An adaptation is not
listed in the library**; it is reachable from its session and from its parent.
**Save as reusable drill** creates a new library drill. A usage line on the drill
edit form: "Used in 6 sessions, 4 already delivered", with Adapt for one session
beside it.

**Non-goals.** No versioning and no version numbers shown anywhere. No
snapshotting of delivered sessions. No merge or push-back to the original. **A
session adaptation never overwrites the original.**

**Database.** M4, plus `drills_id_club_unique`, which does not exist yet.

**Tests.** The copy is independent: editing it changes neither the original nor
another session using the original. Deleting the original leaves adaptations
alive as ordinary drills. The library lists no adaptation. Save as reusable
produces a new row with `variant_of` null and leaves the parent untouched. An
adaptation of an England Football derived drill inherits the source attribution
and the redraw prohibition.

**Dependencies.** COACH-10.

**PR boundary.** One gated migration PR. One frontend PR.

### COACH-13: week plans, promotion and two deliveries

**Outcome.** A coach plans Tuesday, and Saturday is one action away, and the
interface stops saying "template".

**Scope.** Rename template to **week plan** in everything a user reads. **Save
this session as a week plan.** Apply a week plan to more than one date in one
action.

**Non-goals.** No propagation of an edit from one delivery to the other. No new
planning entity. **No `template_id`**: the journeys are copies and work without
it (`04-data-model-proposal.md` section 7).

**Database.** None.

**Tests.** Promote produces a plan matching the session. Apply to two dates
produces two independent sessions, and editing one leaves the other untouched. A
copy sweep test that no user-visible string says "template".

**Dependencies.** COACH-10 loosely, for the editor.

**PR boundary.** One copy PR, one journeys PR.

### Parked

| | Why |
|---|---|
| **Drill Maker authoring improvements** (click to place, duplicate, undo, snapping) | Real but not on the settled critical path. No schema. Can be picked up whenever there is capacity. |
| **Drill motion** | Gated on evidence that the static workflow is in daily use, not on enthusiasm. M5 widens a check constraint and carries the reader-first rollout hazard. |
| **A public operational projection, and DRILL-02b** | Separate club and security decisions, owned by TRAIN-02 and by #189's own follow-up. Prerequisites for nothing here. |
| **A deliberate Reset that regenerates the setup** | Explicitly later. COACH-4 preserves; nothing discards. |
| **Parent-facing group information** | Out of the settled model entirely. |

---

## 4. Dependency graph

```
COACH-1 (team order, M1) ─┐
                          ├─ COACH-3 (suggested setup) ─┬─ COACH-4 (attendance change)
COACH-2 (station list) ───┤                             ├─ COACH-8 (games, M3)
                          │                             │
                          └─ COACH-6 (setup map) ─┬─ COACH-7 (station detail)
COACH-5 (venue layouts, M2) ────────────────────┘   └─ COACH-9 (share check)

COACH-10 (authoring seam) ─┬─ COACH-11 (new drill, draw it)
                           ├─ COACH-12 (adapt, M4)
                           └─ COACH-13 (week plans)
```

Two independent tracks. The upper track delivers the primary success scenario.
The lower track is authoring and can be scheduled by capacity, or run in parallel
by a second pair of hands.

**Nothing in this graph depends on a sharing decision, a public projection, an
Edge Function deploy or a Spond change.**

## 5. Recommended first implementation slices

1. **COACH-1**, the team order. One gated migration on a five-row table plus a
   reorder affordance. It is the only irreducible new fact in the programme and
   it gates the useful half of everything operational.
2. **COACH-2**, the station list. No schema at all, one module, and it removes
   the last reason anyone would reach for a blocks column.
3. **COACH-3**, the suggested setup. This is the slice a coach feels: it turns
   "26 replies" into "5 stations, 5 groups, everyone has a colour" at the moment
   they actually look, 24 to 48 hours out.
4. **COACH-5** in parallel if there is capacity, since it depends on nothing and
   its migration and its admin editor are independently reviewable.

Then COACH-4, COACH-6, COACH-7, COACH-8, COACH-9 in that order, with the
authoring track scheduled beside them.

**Gated migration reviews, in order of appearance:** COACH-1 (M1), COACH-5 (M2),
COACH-8 (M3), COACH-12 (M4).

**Full security reviews: none.** `05-security-share-boundary.md` section 9
carries the reasoning, which is a direct consequence of withdrawing the generated
message and proposing no public projection.

## 6. Adversarial pass on this reconciliation

Run against the reconciled model, not against the model it replaces.

**Is removing the frozen assignment a regression waiting to happen?** The old
proof stands as arithmetic: nine colours cannot map injectively into four
stations, and ranking the active colours shifts when one leaves. What changed is
that nothing consumes stability any more. The failure it prevented was "a group's
starting station moves while the carousel is running", and OTJ no longer claims
to know that a carousel is running. Before training, a plan that restates itself
after the coach changes the groups is correct behaviour. **The honest residual:
if the club later asks OTJ to drive the carousel, this decision is reversed, and
the proof and the mechanism are both still on the record.**

**Does deriving the station list from `Phase` smuggle in a hidden model?** It
leans on a field every screen already reads and that the library add path already
sets. The risk is a `Skill` activity that is not a station. It is contained by
stating the derived count rather than hiding it, and the fallback needs no
migration. What would make this wrong is a coach whose sessions routinely mix
carousel and non-carousel skill work, and nobody has reported one.

**Is the second bib column the thing the previous revision correctly refused?**
No, and the difference is worth stating precisely. It refused `carousel_bib` and
`game_bib` as *phases of a general block mechanism* whose count was a planning
decision. There is no general mechanism now: there are exactly two arrangements
per night, and the settled decision requires both to exist at once. Refusing the
column would mean either overwriting the station plan, which discovery forbids,
or inventing a per-player side row, which duplicates membership that already
lives once.

**Does anything else in the new model store what could be derived?** Checked one
at a time. Station identity: derived. Station number: derived. Rotations:
derived. Starting station: derived. Group identity: derived from the bib. Game
side: derived from the game bib. Readiness: derived. Session lifecycle: already
derived. The four stored things are the club's team order, the venue's geometry,
a child's game bib and a drill's parent. **Each is a fact nothing else can
produce.**

**Is the venue layout column doing too much for one jsonb value?** It holds four
layouts. The alternative was a table, and it was rejected because a column on
`venues` inherits the club-wide read and the `club.manage` write with no new
policy and no new grant, which is the argument this repository makes repeatedly.
The residual risk is a bigger check constraint than a single-layout column would
need, and it is bounded because both `kind` and `slots` are closed sets.

**Does anything in the plan require OTJ to be right about a moving pitch?**
Checked per slice. COACH-1 through COACH-5 are all pre-session. COACH-6 and
COACH-7 are read-only browsing. COACH-8 writes a plan a coach saves before
training. COACH-9 shares a link. COACH-10 through COACH-13 are authoring. **No
slice writes during delivery**, and the one thing that does today, the live
driver's activity index, is untouched.

**What is genuinely weaker after this reconciliation?** Three things, all
recorded rather than hidden. The grouping suggestion's quality is unprovable in
advance and needs coach feedback after one real use rather than more design. The
game colour to side derivation is reasoned rather than observed, which is why it
must be settled before COACH-8 starts. And a station derived from `Phase` is a
convention rather than a declaration, which is a trade accepted in exchange for
deleting a migration.

**What could still go wrong that this plan does not cover?** A five drill plan
delivered as four stations still has no agreed gesture, and the wrong answer
would be destructive. It is carried as D2 and the plan explicitly refuses to
invent a behaviour for it.
