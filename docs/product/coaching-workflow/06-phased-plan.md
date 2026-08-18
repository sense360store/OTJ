# Phased implementation plan

Status: proposal, awaiting approval. Nothing in this plan has been implemented.

Fourteen phases. Every one leaves OTJ usable and deployable, and every one is
useful on its own to a coach even if the next never ships. Phase boundaries were
chosen from the code rather than from the suggested numbering; the mapping to the
discovery's suggested phases is in section 14.

Each phase names its outcome, scope, non-goals, reuse, database change, RLS and
Edge Function implications, backwards compatibility, tests, manual smoke tests,
dependencies, rollout risk, rollback and PR boundaries.

---

## Phase 0: current-state audit and architecture

**Outcome.** A future session can pick up any later phase without re-deriving
what exists.

**Scope.** This document set. Documentation only.

**Non-goals.** No application or database behaviour.

**Deliverables.** `docs/product/coaching-workflow/00` through `08`, and a pointer
from `docs/roadmap/master-roadmap.md`.

**Tests.** None. **Rollback.** Delete the documents.

---

## Phase A: show the drill diagram everywhere a drill appears

*This is roadmap item DRILL-02, and it is **implemented in open PR #189**.*

**Revised after review. This phase is not to be designed, scoped or built by
this programme. It exists, it is in review, and the plan's job is to reconcile
with it and inherit from it.** PR #189 was read directly at head `262ab0e`;
`00-current-state-audit.md` section 18 records what it does.

**Status.** Open, CI green on all 10 checks, no human review yet,
`mergeable_state: dirty` because it branched from `e07a4cf` and `main` has moved
to `2283350`. The conflict is `docs/roadmap/master-roadmap.md`, which both it and
this documentation branch changed.

**Outcome, as delivered by #189.** A coach sees the drill's own diagram in the
planner's expanded panel, on session day and on both live stages, not only on the
drill page.

### The design decisions this programme inherits and must not contradict

| Decision in #189 | What later phases must respect |
|---|---|
| `DrillDiagramView` is the canonical renderer | Phase J's station screen mounts it; it does not draw a pitch. |
| Structured diagrams stay separate from uploaded-media `DiagramViewer` | Nothing rasterises a diagram, wraps it as a `MediaItem`, or pushes it through the media viewer to borrow a modal. |
| `ActivityDiagram` owns the read, `ActivityDiagramView` is pure | Phase J reuses the seam rather than calling `useDrillDiagram` itself. |
| `diagramForDisplay(diagram, source)` is the ONE display rule | No screen derives provenance for a diagram. An invariant test enforces this. |
| **The per-drill cached read is deliberate** | It shares `['drill_diagram', id]` with the drill page and TanStack dedupes concurrent mounts. A batched `.in('id', ids)` read was considered and rejected as a second cache shape over already-cached rows. **Do not change it** unless a later, measured problem justifies it, and then say what was measured. |
| `DRILL_COLS` is never widened to carry `diagram` | Still holds. An invariant test fails the build on it. |
| Planner diagram lives in `.act-panel`, never the draggable `.act-card` | Phase B's authoring seam keeps the same separation. |
| No public share, no print | Phase K, and only after the security decision. |

An earlier draft of this document proposed batching the diagram read and adding a
full-screen treatment on session day. **Both are withdrawn.** The read is
intentional and #189 states why; the full-screen question was explicitly declined
there as a bigger UX decision than that work needed, and it belongs to Phase J
where the whole training-day interaction is designed at once.

**Also inherited: print is not a deferred item.** #189 traced it rather than
assuming: `window.print()` appears once in `src/`, in `PublicShare.tsx:113`, and
`@media print` targets only `.public-*`. There is no authenticated print path, so
print inherits the public share gate exactly and there is nothing to defer.

### What is left of DRILL-02 after #189

**DRILL-02b**, proposed by #189 itself and adopted here as part of **Phase K**:
whether a coach-drawn diagram may be published at all. It requires changing the
Edge `DRILL_COLS`, `projectDrillFields`, `TOP_ALLOWED`, `REF_DRILL_ALLOWED`,
removing `'diagram'` from `FORBIDDEN_ANYWHERE`, the three client snapshot types
and their mirrored key sets, redeploying **both** Edge Functions, and refreshing
every existing share because a snapshot is frozen. That is a security-reviewed
change and it is not a prerequisite for anything else in this programme.

**This programme's only action on Phase A: nothing.** Do not implement it, do not
duplicate it, and do not open a competing PR. If it needs anything, it needs a
human review and a merge, plus the phone check its own author asked for.

**Dependencies.** None. **Rollout risk.** Carried by #189.

**PR boundary.** #189, unchanged.

---

## Phase B: one authoring seam, serving the week plan and the dated session

**Revised after review.** An earlier draft scoped this as "create a drill without
leaving the planner". That would have delivered the feature to the dated surface
only, while long range planning happens in the week plan editor weeks earlier,
and it would have deepened a divergence that already exists.

**Outcome.** A coach writing a plan, whether a programme week or Tuesday's
session, can create the drill they have in mind, draw it, and carry on.

### B1: extract the seam (no new feature)

**Scope.** One shared activity-list editor, used by `Planner.tsx` and
`TemplateFormModal.tsx`. It owns the list, the add bar, the row, reorder, phase
and duration. Its hosts supply what genuinely differs: what the list belongs to,
how the draft is held and saved, and whether dated affordances appear.

**Why first, and why on its own.** The two editors already duplicate the add bar,
the custom activity literal
(`{ phase: 'Skill', title: 'Custom activity', duration: 10 }`, in both files),
the reorder handlers and the row component
(`00-current-state-audit.md` section 9). Every later authoring phase adds to that
surface, so extracting once is cheaper than porting three times. It is also a
pure refactor with no user-visible change, which makes it independently
reviewable against the existing tests.

**Non-goals.** No new affordance at all in B1. If a user notices B1, it went
wrong.

**Tests.** The existing `Planner.test.tsx` and `TemplateFormModal.test.tsx`
suites pass unchanged. A test that both hosts mount the same seam, in the style
of the existing source-text invariants.

**Rollback.** Revert. Nothing user-visible moved.

### B2: create and draw a drill, from either host

**Scope.**
- **New drill** in the shared add bar, beside Add from library and Add custom.
- A minimal create form: title, phase, duration, objective.
- **Draw it** opens `/drill/:id/diagram` and returns to **where it was opened
  from**, with the draft intact.
- **Turn into a drill** on a custom (title-only) activity.

**Non-goals.** No adaptation semantics (Phase C). No Drill Maker tool changes
(Phase D). No new capability: this needs `drills.create`, exactly as creating one
from the library does.

**Reuse.** `DrillFormModal.tsx`, `useInsertDrill`, `DrillDiagramEditor`, and the
B1 seam.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**The hazard, and it has two cases.** Both hosts hold an unsaved draft and
leaving to draw must not lose either.

- The planner's draft lives in `sessionSubmit.ts` and `useGuardedSubmit`.
- The week plan editor's lives in `TemplateFormModal`'s own form state **inside a
  modal**, which unmounts. This is the harder case and it is the reason the seam
  decides the round trip once rather than each host improvising.

Decide explicitly per host: save before opening the editor, or persist and
restore the draft. Do not let the two answers diverge silently.

**England Football.** An FA-derived drill gets no Draw it, unchanged, and PR
#189's `diagramForDisplay` already withholds a stranded FA diagram on every
surface that shows one. The two rules agree by construction and #189 pins it.

**Tests.** The return path preserves the draft, from both hosts. A coach without
`drills.create` sees no New drill on either. A custom activity promotes to a
drill and keeps its title, phase and duration. An FA drill offers no Draw it.

**Manual smoke.** Create a drill mid-flow from a programme week, draw it, return,
save. Repeat from the dated planner. Confirm the drill is in the library and in
both plans.

**Dependencies.** B1. Better after #189 merges, so the drawing is visible where
it was made, but not blocked by it.

**Rollout risk.** Low, except draft preservation, which is the whole review.

**PR boundary.** B1 one PR. B2 one PR, possibly two if the modal round trip is
substantial.

---

## Phase C: adapt a drill without rewriting history

**Outcome.** A coach changes a drill for one session and nothing else changes.

**Scope.**
- **Copy and adapt** on a planner activity: duplicates the drill including the
  diagram, repoints the activity.
- `drills.variant_of` so the library lists originals and shows adaptations under
  their parent.
- A line on the drill edit form: "Used in N sessions, M already delivered", with
  Copy and adapt beside it.

**Non-goals.** No versioning. No snapshotting of delivered sessions. No merge or
"push my change back to the original".

**Database.** **M1** (`04-data-model-proposal.md` section 2). One nullable
column, one composite foreign key with an explicit `set null` column list, one
index.

**RLS.** No new policy. An ordinary column on `drills` is already covered by the
four live policies; this is the reasoning `0046` used for `diagram`.

**Edge Functions.** None. A variant is an ordinary drill to the share builder.

**Backwards compatibility.** `variant_of` null everywhere is the current
behaviour exactly.

**Tests.** Copy produces an independent row; editing it does not change the
original or another session. Deleting the original leaves adaptations alive as
ordinary drills. The library hides variants by default and finds them under the
parent. A security test that a variant obeys the same policies as any drill.

**Manual smoke.** Use a drill in two sessions, adapt it in one, edit the copy,
confirm the other session is untouched. Delete the original, confirm the
adaptation survives.

**Dependencies.** Phase B is the natural pairing but not required.

**Rollout risk.** Low. Migration first, frontend second.

**Rollback.** Drop the constraint and column; adaptations become ordinary drills.

**PR boundary.** One migration PR (gated), one frontend PR.

---

## Phase D: Drill Maker authoring improvements

**Outcome.** Drawing a four-cone grid with six players and two goals takes under
two minutes at a laptop.

**Scope.** Whatever the tool is actually missing, decided by using it: likely
click-to-place, duplicate an element, multi-select and move, undo and redo,
alignment or snapping, keyboard nudge, and one or two starting arrangements (a
cone grid, a small-sided box).

**Non-goals.** No motion. No new element types unless a migration is opened for
them, because the element allow-list is a check constraint. No change to the
stored shape or the version.

**Reuse.** `src/lib/drillDiagramEditor.ts` (the reducer),
`src/lib/drillDiagramGeometry.ts`, `src/routes/DrillDiagramEditor.tsx`.

**Database.** **None**, provided nothing new is stored. Adding a starting
arrangement is a client-side seed of existing element types.

**Tests.** Reducer tests, which is where this codebase already puts them. Undo
and redo prove the signature returns to its previous value.

**Manual smoke.** Draw a real drill from a real session at a laptop and time it.

**Dependencies.** None. Can run in parallel with A, B and C.

**Rollout risk.** Low. **Rollback.** Revert.

**PR boundary.** Two or three small PRs by tool, not one large one.

---

## Phase E: week plans and two deliveries of one plan

**Outcome.** A coach plans Tuesday, and Saturday is one action away.

**Scope.**
- Rename "template" to **week plan** in the interface.
- **Save this session as a week plan**.
- Apply a week plan to more than one date in one action.
- `sessions.template_id`, so provenance is uniform and sibling deliveries are
  visible.
- A session shows "also delivered Saturday 22 August" when a sibling exists.

**Non-goals.** No propagation of an edit from one delivery to the other; the
sibling link makes an explicit "apply to Saturday too" possible later, and this
phase does not build it. No new planning entity
(`02-target-product-model.md` section 2).

**Reuse.** `useStartFromTemplate`, `ApplyProgrammeModal.tsx`,
`useCopyTemplateToWeek`, `TemplateFormModal.tsx`.

**Database.** **M2**. One nullable column, one composite foreign key, one index.
No backfill.

**RLS.** No new policy. **Edge Functions.** None.

**Backwards compatibility.** Null `template_id` is every existing session and
reads as no provenance.

**Tests.** Promote a session and confirm the plan matches. Apply to two dates and
confirm two independent sessions with one `template_id`. A copy sweep test that
no user-visible string says "template".

**Manual smoke.** Plan Tuesday, promote, apply to Saturday, edit Saturday,
confirm Tuesday is unchanged.

**Dependencies.** None.

**Rollout risk.** Low. The copy rename is the widest-reaching part and is pure
text.

**Rollback.** Drop the column; the copy change stands alone.

**PR boundary.** One copy PR, one migration PR (gated), one journeys PR.

---

## Phase F: station blocks

**Reframed twice, and it got smaller both times.** The first version justified
this as a duration defect. The second said the total goes wrong when the group
count changes. **Both were wrong**, and the second was wrong because it assumed
rotations follow groups.

**The rule: every active bib group completes every planned station once, so the
rotation count is the station count.** Four planned stations run four rotations
with three groups or four; with three, one station stands empty each rotation.

`rotations = stations`, so `wall clock = m × stations = sum of durations`. **The
existing total is already correct at every attendance level, and this phase
changes no duration code at all.**

**Outcome.** A session can say which activities occupy the ground at the same
time, and deliver a carousel as a carousel rather than a queue.

### Why this phase exists

1. **Station identity.** Nothing says which activities form one carousel. Phase
   G ("your group starts at station 2"), Phase I (the composer) and Phase J (the
   overview) all need that set and none can be built without it.
2. **Parallel delivery.** `LiveSession.tsx` walks activities one at a time and
   shows the current one to everybody. During a carousel every group is at a
   different station and the event that matters is **rotate**.
3. **Phase-specific setup.** A block is also what makes "the ground is
   rearranged after the carousel" expressible, because a block is exactly the
   set of activities sharing the ground at one time.

**Not on this list: duration.** It is correct as it stands.

**Scope.**
- `sessions.blocks` and `templates.blocks`, each entry `{ id, kind }` with `kind`
  in `carousel | games`; `block_id` on an activity.
- The shared authoring seam (B1) gains **Make these a station carousel** and
  **Mark as the game phase**.
- Live: one timer per rotation, **Rotate** as the cue, all stations listed.
- A planning warning where members of one carousel carry unequal durations.

**Non-goals.** **No duration model change.** No `rotations` field and no
`minutes_per_rotation` field: both are derivable and a stored copy can disagree
with the list it describes. No group assignment (Phase G). No venue placement
(Phase I). No game side allocation (Phase F2). No per-station coach assignment,
ever: coaches rotate with their group and the exceptions should not be modelled.
**Nothing may drop a drill, shorten the carousel or edit the plan because
attendance is low.**

**Reuse.** The existing `Phase` vocabulary already distinguishes `Game` from
`Skill` (`src/lib/data.ts:9`), so the game block leans on a field every screen
already reads rather than inventing a second classification.

**Database.** **M3**. Two nullable jsonb columns and a light shape constraint,
plus `block_id` added to `toActivity` and `toActivityRow`, without which it is
dropped on read and lost on save.

**Migration risk.** Low. Null blocks and no `block_id` is every existing session
and template. **The lifecycle and calendar risk the previous revision warned
about no longer exists**, because no total changes.

**Security and privacy.** None. A block carries no person and no free text.

**Dependencies.** B1 for the authoring surface. Nothing else.

**Manual acceptance test.** Build a one hour session: warm-up, four 10 minute
stations marked as a carousel, a 5 minute Reset, two games. Confirm the total
reads 60 and matches what it read before the blocks existed. Run it live with
three groups and confirm four rotations, one empty station per rotation, and no
drill dropped.

**Rollback.** Drop the columns. Sessions lose their block structure and read as
sequential again; no activity and no duration is lost.

**PR boundary.** One migration PR (gated). One PR for the model and the authoring
affordance. One for the live view.

---

## Phase F2: the game phase

**New, from coach discovery.** Sessions have at least two physical phases, and
the second groups players differently from the first.

**Outcome.** A coach can see how many games the attendance suggests, and which
groups make up each side, without a bib redistribution.

**Scope.**
- A **game count recommendation** from attendance: roughly a dozen children is
  one game, twenty plus is two.
- **Game side allocation**, suggested from the club's team order: stronger groups
  together, weaker groups together.
- A side is **a set of bib groups**, stored on the `'games'` block entry.

**Non-goals, and each of these is a mistake the design is guarding against.**
- **The thresholds are not policy.** They live in one named, adjustable place
  with the reasoning beside them, and they produce a sentence, never a change.
- **The recommendation never rewrites the plan.** A week plan authored with two
  games keeps two games whatever attendance says.
- **A side is never assumed to be one bib colour.** With four groups and one
  game, a side wearing two colours is the expected shape, and nothing forces a
  redistribution to tidy it.
- **No per-player side assignment.** Moving one child is a bib change, already
  one tap and already session-only. Storing a player list would duplicate
  tonight's membership, which already lives in `register_entries`.
- No averaging two games into identical ability mixtures.

**Reuse.** `tonightGroups` for the groups, the M6 team order for the banding, the
existing `Game` activity phase.

**Database.** None beyond M3: the allocation rides the `'games'` block entry.

**Migration risk.** None.

**Security and privacy.** None new. The allocation names bib colours, not
children, so it holds no child data even in memory.

**Dependencies.** F (the block), G (the groups), M6 (the team order, for the
suggestion only; without it the sides are suggested by group order alone).

### Moving one child between sides is a re-bib

Confirmed by the coach: asked whether they would move a child without changing
their bib or re-bib them, they said they would **re-bib**. So no per-player
game-side exception mechanism is needed, and the trigger the previous revision
recorded is resolved.

A side may still hold **two or more bib colours**. The re-bib moves one child
from a colour on one side into a colour on the other; it does not collapse a side
into a single colour and nothing may assume it does.

**Manual acceptance test.** Twenty-two children in four groups, one game planned.
Confirm the suggestion puts two groups a side, that neither side is forced to one
colour, and that changing it and reloading keeps the change. Repeat with two games
and confirm the stronger pair play each other.

**Five proofs the implementation must carry**, from the re-bib architecture check
(`02-target-product-model.md` section 7b):

1. **A re-bib does not change the permanent team.** Re-bib a child mid-session,
   save, reload, then open that child on the Players screen and assert their team
   and season registration are byte-for-byte unchanged. Structurally guaranteed by
   `register_entries` having no path to `player_registrations`, and asserted
   anyway because a well-meaning "also update their team" convenience is the most
   plausible regression in the programme.
2. **A reload preserves the current operational arrangement.** After the re-bib
   and a save, the readback comparison already used by `useSaveTonight` must show
   the new colour, and the groups screen and the game sides must both render from
   it.
3. **Game-side membership follows the bib-side allocation.** The child appears on
   the side their new colour belongs to, with no separate membership list
   consulted anywhere.
4. **No duplicate player-membership list exists.** A source-text check, in the
   style of the existing invariant tests: nothing outside `register_entries`
   stores which player is in which group or on which side.
5. **Station behaviour is not silently corrupted.** This is the sharp one. Take
   four groups, re-bib the **last remaining child of one colour** so that colour's
   group disappears, and assert that **every other group's starting station is
   unchanged**. `tonightGroups` returns an array that is dense over the colours in
   use, so a derivation reading the array index would silently renumber the
   others. The derivation must key on the **bib colour**.

**Attendance is unaffected**, and that should be asserted too: `present` and
`included_in_groups` are separate columns and a bib change must not touch either.

**Rollback.** Revert. Stored allocations become inert.

**PR boundary.** One PR.

## Phase G: operational preparation

**Outcome.** One or two days out, a coach turns "22 replies" into "four groups,
four colours, everyone has a bib".

**Scope.**
- **M6, the team ability order**: one integer per team, set on the existing
  `AdminTeams` screen by a `teams.manage` holder.
- **Suggest groups**: a pure function producing a draft. Keep each normal team
  whole where practical; combine **adjacent** bands when combining is needed;
  prefer 6/5/5/4 over splitting two squads to reach 5/5/5/5; give each group a
  **unique** bib colour.
- **Readiness**, derived: an included child with no effective bib means not
  ready; two active groups sharing a colour means not ready. Both name the fix.
- Group order determines starting station, derived from the bib vocabulary order
  `tonightGroups` already applies.

**Non-goals, each one a mistake this design is guarding against.**
- **No per-player ability score, level or classification.** The context derives
  through the team's position in the club order. M6 stores that order once per
  team, five rows for this club, never per child.
- **No new Group entity** and no `group_id` on `register_entries`. The bib colour
  is the identity, and uniqueness is a domain rule surfaced as readiness rather
  than a constraint, because a group is emergent from per-player bib resolution
  and there is no row a unique index could sit on.
- **No new column for the session-only override.**
  `register_entries.bib_colour_override` already is one.
- **Moving a child tonight writes nothing durable.** Not `players`, not
  `player_registrations`, not `teams`. A test should assert this directly,
  because it is the requirement most likely to be broken by a well-meaning
  "also update their team" convenience.
- **Not ready is never blocked.** The coach opens, edits and runs the session
  regardless.
- No stored workflow states (`02-target-product-model.md` section 5). No change
  to how Spond, presence or inclusion work. Nothing suggests without a press and
  nothing saves without Save groups.

**Reuse.** `src/lib/tonight.ts` entirely, `src/lib/bibs.ts`,
`src/routes/SessionRegister.tsx`, `useSaveTonight`, `sessionLifecycle.ts`,
`AdminTeams.tsx`.

**Database.** **M6** only: `teams.sort_order` plus a partial unique index. Null
everywhere is today's behaviour, and with it null the suggestion keeps each team
whole and declines to claim which teams are adjacent.

**Migration risk.** Low. One nullable column on a five-row table.

**Security and privacy.** None new. `sort_order` is a club configuration value
about teams, not about children. No read path widens and no capability changes:
`teams_manage` already gates the write.

**Rules that must survive.** The three independent facts per child. Spond as
context only. A club with no Spond configuration gets the whole surface. A Spond
failure renders as no context, never as "nobody is coming". One count builder.
Nothing persists outside Save groups.

**Dependencies.** F for the station count. Degrades to a coach-entered group
count without it. M6 is inside this phase rather than before it.

**Manual acceptance test.** Set the club order on the admin screen. Take a
session with 22 replies across five teams and confirm the suggestion keeps teams
whole where it can, combines only adjacent bands, and gives four unique colours.
Move one child into another bib group, save, then open that child on the Players
screen and confirm **their team is unchanged**. Confirm the same child's `present`
flag did not move with the bib. Set two teams to the same default
colour and confirm the screen says so rather than merging them. Remove a child's
bib and confirm not ready, and that the session still opens and runs. Add a late
arrival to a group and confirm readiness recalculates.

**Rollback.** Revert the client. Drop `sort_order` if the column is unwanted;
nothing else reads it.

**PR boundary.** One migration PR (gated, M6). One PR for the suggestion. One for
readiness and the collision surfacing.

---

## Phase H: venue layout

**Outcome.** An admin describes the club's training area at each venue once, and
every coach reuses it.

**Scope.**
- `venues.layout` with a versioned, allow-listed, fraction-coordinate shape.
- `src/lib/venueLayout.ts`: parser, serialiser, signature, description, sharing
  `clampFraction` with the diagram and the board.
- An admin editor on `/admin/venues`.
- A read-only renderer.

**Non-goals.** No imagery, no satellite tiles, no coordinates, no address, no
navigation. No station placement (Phase I).

**Reuse.** The whole shape discipline of `0046` and `src/lib/drillDiagram.ts`,
deliberately, so this is the third instance of a known pattern rather than a new
one.

**Database.** **M4**. One nullable jsonb column plus a check constraint stating
the key allow-list.

**RLS.** No new policy: an ordinary column on `venues`, whose write already takes
`club.manage`.

**Audit, and do not miss this.** `audit_venues()` treats an update as a rename,
and `describeActivityEvent` renders `venue.updated` as **"Venue renamed"**
(`src/lib/activityView.ts:438`). That sentence becomes false. Either add `layout`
to the audited allow list and change the label to "Venue updated", or correct the
label and its comment.

**Backwards compatibility.** Null layout is every existing venue and reads as no
layout, which every surface renders as nothing.

**Tests.** Parser and serialiser round trip; an unknown version yields no layout;
out-of-range coordinates are clamped; a corrupt area is dropped rather than
taking the layout with it; the check constraint refuses a key outside the
allow-list, including a location-shaped one; a security test that the constraint
holds against service_role.

**Manual smoke.** Configure Flushdyke as two pitches side by side. Configure a
venue as one third of a pitch. Confirm both render sensibly at phone width.

**Dependencies.** None.

**Rollout risk.** Medium: a new shape boundary. The mitigation is that it copies
one that has already been reviewed twice.

**Rollback.** Drop the constraint, then the column. Dropping the column discards
every saved layout, so drop the constraint alone unless the feature is being
withdrawn. This is the wording `0046` uses and the same reasoning applies.

**PR boundary.** One migration PR (gated). One PR for the model and its tests.
One for the admin editor.

---

## Phase I: session venue composer

*This is roadmap item DRILL-03, reframed by this programme.*

**Outcome.** "Station 1 goes *here*, station 2 goes *there*", set once a week,
seen by every coach, precise enough that nobody has to be told.

**Revised after review.** An earlier draft stored only an `area_id` per station.
That is too coarse for the stated requirement: at Flushdyke two pitches side by
side host four stations, so two stations share a pitch and `area_id` renders them
coincident at its centre. A coach arriving still has to ask which is theirs and
where on the pitch it goes, which is the briefing this programme exists to
remove.

**Scope.**
- A `place` object on a station activity: `{ x, y }` in the venue layout's own
  fraction space, optionally `{ x, y, w, h }` for a station that occupies an area
  rather than a spot.
- **The sub-area is derived from the position, never stored beside it**, so the
  two can never disagree.
- A composer on the session: drag each numbered station to where it should
  physically be set up. The derived area is shown as a label read back from where
  it landed.
- A station placed between marked areas reads as "not in a marked area", a
  legitimate answer.
- An unplaced station is listed as unplaced, never drawn at a default position.

**Non-goals.** No editing the venue layout from here; that is admin work. No
copying of venue geometry onto the session. No automatic placement. No metres:
positions are fractions, and the venue's declared real size is for labelling.

**Database.** None, provided `place` rides `sessions.activities`. `toActivity`
and `toActivityRow` gain it alongside `block_id`. **`place` is a nested object
and those two functions currently rebuild flat scalars only**, so it must be
rebuilt field by field or an unknown key inside it survives a round trip the
allow-list is meant to prevent.

**Reuse.** The clamping and minimum-size rules of the `zone` element in
`src/lib/drillDiagram.ts`, rather than a second set.

**RLS.** None. Editing a session's plan is already the sessions update policy.

**Edge Functions.** None. `place` must be added to both forbidden-key lists when
it lands, not when it is first shared
(`05-security-share-boundary.md` section 8, rule 7). It names a location, which
is exactly the class of field those lists already refuse.

**Backwards compatibility.** No `place` is every existing session.

**Tests.** Placement round trips, including the nested rebuild dropping an
unknown key. Area membership derives correctly, including a position inside no
area. Moving a sub-area in the venue layout leaves positions untouched and
recomputes the derived area. Deleting a sub-area leaves the station placed.
Changing the session's venue does not silently clear placements.

### Two setup views, and why they cost nothing extra

The ground is rearranged mid-session: the cones come in and the game pitches go
out. So the composer has **two views, one per block**: the carousel's members
placed as numbered markers, and the game block's members placed as pitches.

This needs no setup phase entity, no layout versioning and no per-phase placement
set, because a placement already belongs to an activity and an activity already
belongs to a block. The transition is an ordinary Reset activity in the plan.

A game pitch is where the optional footprint (`w`, `h`) earns its place.

**Manual acceptance test.** Place four stations across Flushdyke's two pitches,
two per pitch, at distinct spots. Confirm they are four separable markers at 390
pixels wide. Switch to the games view and place two pitches with footprints.
Confirm the two views are independent and that neither redraws the other. Move a
pitch in the venue layout and confirm the stations stay where they were on the
ground. Change the session's venue and confirm the warning.

**Dependencies.** Phase F (which activities are stations) and Phase H (the
areas). Both hard.

**Rollout risk.** Low.

**Rollback.** Revert. Stored `place` objects become inert and are dropped on the
next save, which is acceptable and should be stated in the PR.

**PR boundary.** One PR.

---

## Phase J: training-day mobile delivery

**Outcome.** The primary success scenario. A coach arrives, opens their phone,
and needs no briefing.

**Scope.**
- Session day on a phone: groups and bibs, then the **stations** setup view with
  numbered markers, then a station, then back, then the **games** setup view.
- The station screen is the drill visual large, the objective, the coaching
  points, the setup notes and the equipment, and little else.
- "Your group starts here" on the relevant station.
- Swipe between stations; tap to focus; back to overview.

**Non-goals.** No offline support or PWA work (noted as out of scope in
`SessionDay.tsx` today and still out of scope). No pinch-zoom-dependent design.
No new data.

**Reuse.** `SessionDay.tsx`, `DrillDiagramView`, `tonightGroups`, the Phase H
renderer, the Phase I placement.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**Accessibility, which is scope and not a footnote.** Tap targets at or above the
44 pixel minimum the app already uses. Station identity carried by number and
name, never colour alone. Every station reachable as an ordinary list as well as
on the layout. Keyboard and screen reader paths through overview, station and
back. This is where QUALITY-02 should be pulled in rather than deferred again.

**Tests.** Screen-level tests at phone width for the overview, focus and back
path. A parent reaches none of it.

**Manual smoke.** On a real phone, outdoors, at a real venue, with a real session.

**Dependencies.** A, F, G, H, I.

**Rollout risk.** Low technically. The product risk is that it is judged on
whether the *plan* is good, which is Phases A to I.

**Rollback.** Revert.

**PR boundary.** Two or three PRs: overview, station focus, group and bib
integration.

---

## Phase K: shareable operational outputs

**Outcome.** A parent knows their child's group and colour before they arrive,
without anything being published about a child.

**Scope.**
- A **generated message** composed in the browser from the same draft the groups
  screen holds, offered in a with-names and a names-free variant, copied by the
  coach into their existing group.
- Optionally, a **public session projection** carrying date, time, venue, plan,
  group colours and counts, and **no names**, through the existing share
  substrate. This is roadmap item TRAIN-02.

**Non-goals.** **No child's name on any public URL.** No parent-to-child identity
binding (out of scope, `08-open-questions.md` Q2). No new auth surface. No
scheduled or automatic sending.

**Reuse.** `src/lib/tonight.ts` for the source data. For the public half:
`content_shares`, `manage_content_share`, `read_public_share`,
`_shared/share.ts`, `ShareModal.tsx`, `publicShare.ts`.

**Database.** None for the message. For the public projection: no schema, but a
new snapshot builder and a widened set of publishable session fields, which is
the security decision in `05-security-share-boundary.md` sections 4 and 6.

**Edge Functions.** `manage-content-share` and `read-content-share` if the public
half proceeds. **Deploy from files and read the deployed source back byte for
byte**, never paste inline (`CLAUDE.md`, Edge Function deploys).

**Tests.** The message is generated by one pure function from the same draft, is
deterministic, contains no shirt number, team, attendance or Spond figure, and
uses a surname initial only when two children share a first name. For the public
half: a serialised-response test asserting the payload against an explicit field
list, the pattern the existing snapshot tests already use.

**Manual smoke.** Generate both variants, read them as a parent would, confirm the
names-free one is still useful.

**Dependencies.** Phase G. The public half depends on a club decision, not on
code.

**Rollout risk.** **The highest privacy risk in the programme.** Separate
security review, separate PR, and not combined with any other change (roadmap
rule 5).

**Rollback.** Revert the composer. For a public share, revoke: the existing
lifecycle already clears the snapshot on revoke, and the existing warnings
already say a printed or saved copy cannot be recalled.

**PR boundary.** One PR for the message. The public projection is its own
programme with its own review.

---

## Phase L: optional drill motion

**Outcome.** A complex exercise can be played rather than explained.

**Scope, if approved.** A small number of keyframes per element; play, pause,
restart; nothing more.

**Non-goals.** No timeline editor, no easing, no per-element scripting, no video
export.

**Database.** **M5**: widening the `drills.diagram` element allow-list, which is
a check constraint and therefore a gated migration.

**The rollout hazard, restated because it is easy to get wrong.** The parser
**discards a diagram whose version it does not recognise**. A reader that
understands the new shape must be deployed and reach every client **before**
anything writes it. Two releases, reader first. A coach on a stale tab must never
see their diagrams disappear.

**Dependencies.** Everything. This phase is gated on evidence that the static
workflow is in daily use and that motion is the next thing missing, not on
anyone's enthusiasm for animation.

**Rollback.** Version-aware readers make rollback a matter of ceasing to write
the new shape. Removing the constraint widening after diagrams exist would make
those diagrams unwritable, so the rollback story is "stop writing", not "drop the
column".

---

## 13. Dependency graph

```
A (= PR #189, in review, not this programme's work)
                       └───────────────────────────── J

0 ─┬─ B1 ── B2 ─┬─ C
   │            └─ (all later authoring, incl. the block editor in F)
   ├─ D                                    (D also gates L)
   ├─ E
   ├─ B1 ── F ─┬─ F2 ──────────────────────┐
   │           ├─ G ──┬─ F2                ├─ K (message)
   │           └─ I ──┤                    │
   └─ H ───────── I ──┴─ J ────────────────┘

                 K2 / DRILL-02b  (gated on Q1, prerequisite for NOTHING)
                 L               (gated on evidence of use)
```

**Changes from the previous revision:**

- **F no longer gates a duration change**, because there is not one. Its risk
  drops from "the highest in the programme" to low, and it stops being the phase
  that must not be rushed.
- **F now gates F2**, the new game phase, and F2 also wants G for the groups and
  M6 for the banding.
- **M6 moved inside G** rather than standing alone. It is one nullable column on
  a five-row table and it has no consumer until the suggestion exists.
- **F depends on B1**, because the block editor is an authoring affordance and
  belongs in the shared seam rather than in the planner alone.

B1, D, E and H have no dependencies on each other and can be scheduled freely.
B1 gates B2, C and F. F gates G, I and F2. H gates I. I and H gate J. G gates F2
and K's message half.

**Nothing on this graph depends on a public sharing decision.**

## 14. Mapping to the discovery's suggested phases

| Suggested | This plan | Note |
|---|---|---|
| 0 current-state audit | Phase 0 | Same. |
| 1 drill/session authoring | Phases **B1**, **B2** and **C**; **A** is PR #189 | A is in review, not scoped here. B is split so the shared seam is extracted before any feature lands on it, because the week plan editor and the planner already duplicate the activity editor. |
| 2 visual Drill Maker | Phase **D** | Deliberately later: the tool is already capable; the workflow was the gap. |
| 3 programme → weekly session | Phase **E**, plus **F** | F is new and was not in the suggested list. B1 also serves this: week plan authoring is first-class from the start rather than ported later. |
| 4 Spond operational preparation | Phase **G** | Smaller than expected: most of it already ships. Gains the group collision surfacing. |
| 5 venue model | Phase **H** | Same. |
| 6 session venue composer | Phase **I** | Depends on F as well as H, and now places stations by position rather than by area. |
| 7 training-day mobile | Phase **J** | Same, and it mounts PR #189's seam rather than a new renderer. |
| 8 shareable outputs | Phase **K** | Reshaped: a generated message is the deliverable; the public projection is a separate club decision and blocks nothing. |
| 9 optional motion | Phase **L** | Same, with the version rollout hazard named. |

---

## 15. Adversarial pass, fourth round

Run on one question: does representing a game-side move as a re-bib break
anything, given that `register_entries` holds one bib per player per session?

**Does the overwrite lose something the product needs?** The T0 to T6 timeline was
walked explicitly (`02-target-product-model.md` section 7b). At T6 OTJ knows the
permanent team (unchanged), the current bib (BLUE), and the game side (the one
BLUE belongs to). It does **not** know the child wore RED during the carousel, and
that is unrecoverable rather than merely unqueried. Every consumer was then listed
and checked, and none asks the question: the groups screen, the starting station
statement, live delivery, the game allocation, the generated message, the session
day views and the one-glance overview all want the present tense. Attendance is a
separate column and survives.

**Was that conclusion reached honestly, or by wanting the simple answer?** The
test applied was "name a screen that would render differently if the earlier
colour were available". None exists in the built product or in any agreed phase.
The three things that *would* need it are named in 7b (a post-session coaching
log, per-child development tracking, a safeguarding-shaped dispute), none is on
the roadmap, and the smallest answer for them is recorded as a shape so a future
session does not reach for phase-aware bib columns.

**Did the check find anything real?** Yes, and it is not the history question.
`tonightGroups` sorts by the fixed bib vocabulary, which is stable, but the array
it returns is **dense over the colours actually in use**. Re-bib the last child
of a colour and that group vanishes, the array shortens, and every later group
moves down an index. A "group N starts at station N" rule reading the array index
would therefore let one child's re-bib silently reassign *other* groups' starting
stations. The derivation must key on the bib colour. This is now a decision in
7b, a recorded fact in `00-current-state-audit.md` section 22, and proof 5 of
Phase F2's acceptance tests.

That is the more valuable finding, and it is the opposite shape from the one
being looked for: not "we lost data we needed" but "a derivation over live data
is unstable under exactly the edit the coach just told us they make".

**Does the coach's answer actually settle the per-player exception, or dodge it?**
It settles it. The exception mechanism existed only to serve "move a child but
keep their colour", and the coach says they do not do that. The previous revision
recorded a trigger to revisit; the trigger has been resolved by asking, which is
better than leaving it open.

**Does this quietly reintroduce "one side, one colour"?** It could be read that
way and must not be. Guarded in four places: the principles doc, 7a, 7b and Phase
F2 all state that a side of two colours stays a side of two colours, and that the
re-bib moves one child between colours rather than collapsing a side into one.
The acceptance test asserts a side is not "tidied" into a single colour.

**Could a re-bib during the carousel corrupt the rotation?** Yes, and it is
correct behaviour rather than corruption: the coach who moves a child mid-carousel
intends them to move. The unintended consequence is the index instability above,
which the keyed derivation removes. Whether the product should *warn* on a
mid-carousel re-bib is a UI question and is now Q12.

**Is anything being added to the schema by this round?** Nothing. This round
removed a deferred trigger and added zero fields, which is the outcome to prefer.

## 16. Adversarial pass, third round

Run after the coach discovery that produced this revision, and checked
specifically against the contradiction list that discovery supplied. Earlier
rounds are kept below, because two of their conclusions were wrong and the record
matters.

**Does group count control rotation count anywhere?** It did, and it was wrong in
three documents. `02` said rotations default to the station count but "three
groups turning up means three, and the operational layer adjusts it"; `00` and
`06` both carried a table whose first row read "4 stations, 3 groups (3
rotations) = 30 minutes". All are corrected: **rotations are the station count,
full stop**, and `rotations` is no longer a stored field at all because it is
derivable from the member list. The corrected rule is stated in `00` section 17,
`02` section 4.3 and Phase F, and the "one station stands empty" case is now an
explicit acceptance test.

**Does low attendance silently delete a planned drill anywhere?** Not now.
Phase F's non-goals say it in the imperative, `02` section 4.3 has a "what must
never happen" paragraph, and Phase F2 says the game recommendation never rewrites
the plan. The previous revision's "the operational layer adjusts it" was the
sentence that would have licensed it, and it is gone.

**Is a bib group ever confused with a game side?** This was the highest risk of
the new material, because the two are one tap apart on the same screen. Guarded
in four places: `02` section 7a states they are different entities, the side is
modelled as a **set** of groups so the two-colour case is the natural shape
rather than an exception, Phase F2's non-goals refuse the one-colour assumption
outright, and the acceptance test checks that a side wearing two colours is not
"tidied".

**Is the Spond team duplicated as a new ability field?** No, and the design is
now explicit about the distinction that makes it safe. M6 stores **one integer
per team**, which is a club-level fact about five rows that genuinely does not
exist anywhere (`00` section 19 proves it against the schema). There is no
per-player field, and a player's ability context is a derivation through their
existing registration. The audit records that `useTeams` orders by name and that
nothing else could carry the order, so this is not a convenience column.

**Can a session override modify permanent team membership?** Structurally no:
`register_entries.bib_colour_override` is keyed on `(session_id, player_id)` and
has no path to `players`, `player_registrations` or `teams`. The risk is a future
convenience ("they're always in blue now, shall I move them?"), so Phase G's
acceptance test opens the child's record after a bib move and asserts the team is
unchanged. That is a cheap test for the most plausible regression in the
programme.

**Do the game count thresholds become policy?** They are stated as illustrative
in `02` section 7a, required to live in one adjustable named place, and Phase F2
lists "the thresholds are not policy" as a non-goal. The residual risk is a
reviewer hard-coding `if (players >= 20)` inline, which is why the requirement is
"one named place" rather than "a constant somewhere".

**Is the venue still modelled as one static setup?** It was, and the discovery
was right that this was too static. Fixed by generalising the block: a block is
"the activities occupying the ground at the same time", so a setup view is the
placements of one block's members and the carousel and the games get one each.
**No new entity was needed**, which is the outcome to prefer. The transition is
an ordinary activity that already exists.

**Are any new entities being created where existing tables work?** Checked one at
a time and the answer improved this round. No group table (bib colour). No
ability column (team order, derived per player). No override column
(`bib_colour_override` already is one). No rotations field (derived). No setup
phase entity (derived from a block). No game side table (a set of colours on the
block). **One** new column in the whole round, M6, with a proof that nothing can
derive it.

**Is child data exposed anywhere new?** No. The game allocation names bib
colours, so it holds no child identity even in memory. `sort_order` is about
teams. Public sharing is untouched and stays parked, and no phase depends on it.

**Did the block get justified by bad maths again?** This is the third framing of
Phase F and the first with no duration argument in it at all. The justification
is now station identity, parallel delivery and phase-specific setup, each of
which is a structural absence rather than a number. The pleasing consequence is
that the phase got **less** risky as the argument got weaker: no duration change
means no lifecycle risk and no calendar risk.

**What is genuinely weaker after this round?** Two things, both recorded rather
than hidden. The grouping suggestion's quality is unprovable in advance: "keep
teams whole, combine adjacent bands, prefer uneven" is easy to state and will
meet real squads that satisfy none of it cleanly, so it needs coach feedback
after one real use rather than more design. And the game side allocation stores
an override whose shape is defended on reasoning rather than on use, since no
coach has yet adjusted one in this product.

**What could still go wrong that this plan does not cover?** #189 still has a
merge conflict and no human review, unchanged from the last round. And M6 has a
sequencing subtlety worth stating: if the suggestion ships before an admin sets
the order, every team reads as unordered and the suggestion silently declines to
combine anything. That is the correct failure but it will look like a bug, so the
screen should say the order is unset rather than quietly doing less.

## 17. Adversarial pass, second round

Run after the review that produced this revision. The first-round pass is kept
below as section 16, because two of its conclusions were wrong and the record of
how they were reached is worth keeping.

**Was the duration claim actually wrong, or merely imprecise?** Wrong, and it
should have been caught by doing the arithmetic. `m × r` against `m × n` is one
line, and the claim "a one hour session says ninety minutes" does not survive it
for any plausible carousel. The lesson generalises: the first pass reasoned from
"the model is linear, training is parallel, therefore the total is wrong", which
is a shape argument, not a calculation. **Where a claim is numeric, calculate it.**

**Does Phase F survive losing that argument?** Yes, and it is stronger without
it. Station identity is a hard blocker for Phases G, I and J: none of them can be
built on a flat activity list. Parallel delivery in Live is wrong today
regardless of duration. The duration case is real but narrow, and it is now
stated as "correct until the operational layer adjusts the group count" rather
than as a standing defect.

**Is the position-based placement over-engineering?** It is two numbers per
station where the first draft had one string, and it removes a stored fact rather
than adding one, because the area is now derived. The test is whether the
requirement can be met without it: it cannot, because two stations on one pitch
are indistinguishable by area alone, which is the actual Flushdyke case. The
optional `w`/`h` is the part most at risk of being unused, and it is optional
precisely so that it can be left unimplemented in the first cut.

**Does deriving the area create a new failure mode?** One: a station on a
boundary derives whichever area contains its point, which may not be the one the
coach meant. That is answered by showing the derived label live while dragging,
so the coach sees the answer at the moment they choose. It is strictly better
than the stored alternative, where the same ambiguity is frozen and can later
contradict the geometry.

**Was reopening group-versus-bib worth it, or is the answer the same?** The
recommendation is materially the same (bib stays the identity) but the reasoning
changed and the scope grew. The first pass justified it by pointing at
`tonightGroups`, which is the implementation deciding the model. Reopening it
found two real collisions that nobody had written down, and surfacing them is now
scope in Phase G. So the answer held and the work did not.

**Is option B being dismissed too easily?** It is not dismissed; it is deferred
with a stated trigger. The honest risk is that the trigger never gets checked
because nobody asks a coach the question. That is why it is Q9 with a named
decision owner rather than a line in a design document. *(Third round: the coach
was asked, and the answer settled it. Bib colour is the identity, colours are
unique per session, and there is no Group entity. Q9 is closed.)*

**Does splitting B into a refactor and a feature actually help, or is it
ceremony?** It helps, because B1 is provable against the existing test suites
with no user-visible change, and because the alternative is a single PR that
simultaneously moves two editors into one and adds three affordances to it. The
risk B1 carries is the classic one: a refactor that quietly changes behaviour in
one host. Its tests are the existing suites of both hosts, unchanged, which is
the right guard.

**Is week plan authoring genuinely first-class now, or first-class on paper?**
The check is whether any phase delivers a feature to the planner that the week
plan editor does not get. After this revision, none does: B2, C and F all land on
the seam. The dated-only affordances are exactly the ones that cannot exist
without a date (venue, Spond, station placement, delivery), and that is a real
distinction rather than a convenience.

**Does the plan now depend on public sharing anywhere?** No, and this was checked
per phase rather than assumed. Nothing in B, C, D, E, F, G, H, I or J reads or
writes a share. K's message half depends on G alone and publishes nothing. K's
public half and DRILL-02b are both gated on human decisions and block nothing.

**Is #189 correctly represented, or merely cited?** Its decisions are now
inherited as constraints on later phases in a table, including the one this
programme previously proposed to violate: batching the diagram read. The first
draft suggested batching and a session-day full-screen treatment, both of which
#189 considered and rejected with stated reasons. Both are withdrawn.

**What could still go wrong that this plan does not cover?** #189 has a merge
conflict with `main` and no human review, and this documentation branch touches
the same file it conflicts on. If both merge without care, the roadmap's DRILL-02
row could end up saying two different things. Flagged in
`07-roadmap-reconciliation.md`.

## 18. Adversarial pass, first round

Performed before the first publication. Two of its conclusions were wrong and are
corrected above; the rest stand. Kept because the corrections are more useful
beside the reasoning that produced them.

**Is the workflow unnecessarily complex?** The plan adds exactly one new concept
to what a coach must understand: the station block. Everything else is either an
existing concept made reachable (creating a drill while planning), an existing
concept renamed (week plan), or invisible (variants under a parent, derived
readiness). One new concept for a workflow that is genuinely parallel is
proportionate. *(Second round: still one concept. The placement revision adds
precision to an existing gesture, not a concept.)*

**Are programme, session and event duplicated?** Four things exist:
`programmes`, `templates`, `sessions` and `spond_events`. The first three are the
theme, the plan and the delivery, which the discovery itself distinguishes. The
fourth is a mirror, not a plan, and `0048` already makes one session per event a
database fact. **Revision made:** the plan explicitly refuses a new "weekly plan"
entity and instead adds `template_id`, because the fourth row type was the
obvious wrong answer.

**Can drill copying create confusing histories?** A session points at the exact
row it ran, so "what did we do?" is unambiguous. The residual is that editing a
library drill still changes past sessions. **Revision made:** rather than pretend
otherwise, Phase C adds a usage line to the edit form so the change is a choice,
and `08-open-questions.md` Q3 puts freezing to the club as a decision with a
recommended default of no.

**Is Spond timing modelled correctly?** Yes, and mostly by not touching it. No
phase before G reads Spond at all, so planning cannot be blocked by it, and G's
additions are drafts. The existing rules that a club with no Spond gets the whole
surface, and that a failure renders as no context, are restated as constraints on
G rather than left to be rediscovered.

**Do venue layouts work at phone width?** Only if the overview draws areas and
numbers rather than four shrunken drill diagrams. **Revision made:**
`03-ux-journeys.md` states that as the decision and gives the reasoning, and
Phase J's non-goals refuse a pinch-dependent design outright.

**Does the plan over-engineer animation?** It is last, it is gated on evidence
rather than enthusiasm, its scope is keyframes and three buttons, and its two
hazards are named. **Revision made:** the rollback story is stated honestly as
"stop writing", because dropping the constraint widening after diagrams exist
would strand them.

**Does sharing expose children?** Not in the recommended path, because the
recommended path publishes nothing. **Revision made:** the generated message is
the primary output and the public projection is explicitly conditional on a club
decision, rather than both being scoped as work.

**Does any new model duplicate existing state?** The three candidates were
checked. A group entity would duplicate the bib colour, so there is none. A
workflow state column would duplicate what `sessionLifecycle` and the rows
already say, so there is none. A session-local drill overlay would duplicate
`drills` in an unconstrained column, so adaptation is a copy instead. The one
accepted near-duplication is a third fraction-coordinate jsonb column, and it is
accepted only on condition that it inherits the existing discipline rather than
inventing a second one. *(Second round: there was a fourth candidate and this
pass missed it. Storing an `area_id` beside a station position would be two facts
about one thing, and the first draft was heading there. The revision stores the
position and derives the area, so there is nothing to disagree.)*

**Is each phase independently shippable?** Checked one at a time. A, B, D, E, G,
J and K ship alone. C ships alone because `variant_of` unused is current
behaviour. F ships alone because a session with no block is unchanged. H ships
alone because a venue with no layout is unchanged. I is the only phase that
genuinely cannot ship before its dependencies, and it is the only one where the
plan says so. *(Second round: B1 and B2 both ship alone, B1 as a no-op refactor.
A is PR #189 and ships on its own review.)*

**What the adversarial pass could not resolve, and left as questions.** Whether
date, time and venue may be public; whether the club wants a parent-to-child
identity binding; whether delivered sessions should be frozen; whether a coach
override of starting stations is wanted; whether a traced venue background is
worth its rights question. All five are in `08-open-questions.md` because they
are product and club decisions, not engineering ones.
