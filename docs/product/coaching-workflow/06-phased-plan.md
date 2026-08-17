# Phased implementation plan

Status: proposal, awaiting approval. Nothing in this plan has been implemented.

Twelve phases. Every one leaves OTJ usable and deployable, and every one is
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

**Reframed after review.** An earlier draft justified this phase as a duration
defect and claimed a one hour session reads as ninety minutes. **That was wrong.**
Four 10 minute stations run as four rotations lasts 40 minutes and the sum of
four 10 minute activities is 40. The present total is not wrong merely because
the stations are parallel (`00-current-state-audit.md` section 17).

**The genuine need is station identity, parallel delivery and rotation. Duration
correctness is a consequence, and a narrow one.**

**Outcome.** A session can say which activities form one carousel, how many
rotations it runs, and deliver it as a carousel rather than a queue.

### Why this phase exists, in priority order

1. **Station identity.** Nothing today says which activities are stations of one
   block. The venue composer (Phase I), "your group starts at station 2" (Phase
   G) and the training-day overview (Phase J) all need that set, and none of
   them can be built without it. **This is the reason the phase exists.**
2. **Parallel delivery.** `LiveSession.tsx` walks activities one at a time and
   shows the current one to everybody, but during a carousel every group is at a
   different station and the event that matters is **rotate**. This is wrong
   today, independently of any arithmetic.
3. **Rotation count.** The number of rotations is what attendance changes, one
   or two days before the session, and there is nowhere to record it.
4. **Duration, last.** The total is correct while `rotations == stations` with
   equal-length stations, and diverges otherwise: 4 stations with 3 groups is 30
   minutes against a stated 40; 6 stations with 4 groups is 40 against 60. So
   this is not a standing defect, it is a correct answer that stops being correct
   the moment the operational layer adjusts the group count.

**Scope.**
- `sessions.blocks` and `templates.blocks`; `block_id` on an activity.
- Planner: select activities, **Make these a station block**, set the rotation
  length, adjust the rotation count.
- `sessionMinutes` becomes block-aware, and every consumer with it.
- Live view: one timer per rotation, with **Rotate** as the cue and all stations
  listed.

**Non-goals.** No group assignment (Phase G). No venue placement (Phase I). No
per-station coach assignment, ever: the discovery says coaches rotate with their
group and that exceptions should not be modelled.

**Reuse.** `src/lib/data.ts` (`sessionMinutes`), `src/lib/sessionLifecycle.ts`,
`src/lib/ics.ts`, `LiveSession.tsx`, the planner's activity list.

**Database.** **M3**. Two nullable jsonb columns and a light shape constraint.
Plus the mandatory client change to `toActivity` and `toActivityRow`, without
which `block_id` is dropped on read and lost on save.

**RLS.** No new policy on either table. **Edge Functions.** The session share
builder derives `totalDuration` from the activities; it must use the same rule or
a shared session will report a different length from the app. Check
`_shared/share.ts` and keep the two in step.

**Backwards compatibility.** Total. No blocks and no `block_id` is every existing
session, and the maths reduces exactly to the current sum.

**Tests.** Duration maths for a session with a block, without one, and with two.
`sessionLifecycle` derives the expected end from the same total, and the
invariant test still finds exactly one fallback duration. An ics export of a
blocked session has the right length. Live advances by rotation.

**Manual smoke.** Build a real one hour session with a warm-up, four stations and
a game. Confirm the total is sixty. Run it live and rotate.

**Dependencies.** None, but it must precede Phase I.

**Rollout risk.** **The highest in the programme**, because duration feeds the
lifecycle and the lifecycle decides whether a session appears on Home. A wrong
total puts a session in the wrong list. This is why the phase is on its own and
why its tests are about arithmetic before they are about UI.

**Rollback.** Drop the columns. Sessions with blocks lose their block structure
and read as sequential again; no activity is lost.

**PR boundary.** One migration PR (gated). One PR for the duration model and its
consumers, with no UI. One PR for the planner UI. One for the live view.

---

## Phase G: operational preparation

**Outcome.** One or two days out, a coach turns "22 replies" into "four groups,
four colours, ready".

**Scope.**
- **Suggest groups**: a pure function proposing a balanced split of the included
  children into the block's station count, keeping team mates together, assigning
  a bib colour per group. It produces a **draft** the coach edits.
- Group order determines starting station, derived from the bib vocabulary order
  `tonightGroups` already applies.
- **Surface the two group collisions**, which is new scope added after review:
  two teams sharing a default `teams.bib_colour` currently merge into one group
  silently, and every child with no effective bib merges into one "No bibs"
  group. Both become stated, with the fix beside them, rather than left silent
  (`00-current-state-audit.md` finding 2, `02-target-product-model.md` section
  6.2).
- A **readiness readout** on the session, derived and stored nowhere.

**Non-goals.** **No stored workflow states**
(`02-target-product-model.md` section 5). **No group entity**, which is the
recommendation in `02-target-product-model.md` section 6.4 (option C) and is
subject to the explicit product decision at `08-open-questions.md` Q9. If that
decision comes back as option B, this phase gains one column on
`register_entries` and one jsonb list, and its scope is revisited before it
starts rather than during it. No change to how Spond, presence or inclusion work.
No automatic anything: nothing suggests without a press and nothing saves without
Save groups.

**Reuse.** `src/lib/tonight.ts` in its entirety, `src/lib/bibs.ts`,
`src/routes/SessionRegister.tsx`, `useSaveTonight`, `sessionLifecycle.ts`.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**Rules that must survive.** The three independent facts per child. Spond as
context only. A club with no Spond configuration gets the whole surface. A Spond
failure renders as no context, never as "nobody is coming". One count builder.
Nothing persists outside Save groups.

**Tests.** The split is deterministic and balanced; it keeps team mates together
where the numbers allow and says so when they do not; it produces a draft and
writes nothing; it never touches `present`; readiness derives from the same seam
as the lifecycle and never writes.

**Manual smoke.** A real session with real replies. Suggest, adjust, save,
reload, confirm the readback matches.

**Dependencies.** Phase F for the station count. Degrades to a coach-entered
group count without it.

**Rollout risk.** Low. Everything is a draft until Save.

**Rollback.** Revert. Nothing new was stored.

**PR boundary.** One PR for the split, one for the readiness readout.

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

**Manual smoke.** Place four stations across Flushdyke's two pitches, two per
pitch, at distinct spots. Confirm they are four separable markers at 390 pixels
wide. Move a pitch in the venue layout and confirm the stations stay where they
were on the ground. Change the session's venue and confirm the warning.

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
- Session day on a phone: groups and bibs, then the venue overview with numbered
  station markers, then a station, then back.
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
                     └──────────────────────────── J

0 ─┬─ B1 ── B2 ─┬─ C
   │            └─ (all later authoring)
   ├─ D                                (D also gates L)
   ├─ E
   ├─ F ─┬─ G ─┬────────────────────── K (message half)
   │     └─ I ─┘                       K (public half: gated on Q1, NOT a
   └─ H ─── I ─── J                        prerequisite for anything)

                 L (gated on evidence, after the static workflow is in use)
```

**Changes from the first version, all from the review:**

- **A is no longer scheduled work.** It is PR #189 awaiting review and merge.
- **B is split.** B1 extracts the shared authoring seam (pure refactor); B2 adds
  create and draw to both hosts. B1 gates B2 and everything later that touches
  authoring, including C.
- **I now depends on F and H as before**, but its own model changed from an area
  reference to a position.
- **K's public half is explicitly off the critical path.** Nothing depends on it.

B1, D, E, F and H have no dependencies on each other and can be scheduled freely.
F gates G and I. H gates I. F and H together gate I; I and H gate J. G gates K's
message half.

---

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

## 15. Adversarial pass, second round

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
decision owner rather than a line in a design document.

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

## 16. Adversarial pass, first round

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
