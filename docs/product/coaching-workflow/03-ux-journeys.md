# Target UX journeys

Status: proposal, awaiting approval.

Seven journeys, written as what the coach does rather than as screens. Each names
the existing components it reuses, because the point of the audit was to find
what already works. Each names its device, because principle 7 says authoring may
optimise for a laptop and delivery must be excellent on a phone.

---

## Journey 1: plan a programme for the next six weeks

**Device: laptop. When: weeks or months ahead. Spond: absent.**

1. Programmes, New programme. Name, theme, summary, intentions, number of weeks.
   *Reuses `src/routes/Programmes.tsx`, `ProgrammeFormModal.tsx`. Unchanged.*
2. For each week, set the objective. The week is a **week plan**, the row today
   called a template.
   *Reuses `ProgrammeDetail.tsx`, `TemplateFormModal.tsx`, `useAssignTemplateWeek`.*
3. Weeks may be left empty. A programme with two weeks planned and four to come
   is a normal state and must not read as broken.

**What changes:** the word "template" becomes "week plan" in the interface. No
schema, no new screen.

**What does not change:** a programme still holds no drills. The drills live on
the week plan.

## Journey 2: plan a week's session

**Device: laptop. When: days to weeks ahead. Spond: absent.**

1. Open the week plan, or start a session directly in the planner.
   *Reuses `src/routes/Planner.tsx`, `useStartFromTemplate`.*
2. Warm-up first. Add from library, or create.
3. **Add the stations.** Add four drills, then select them and press **Make these
   a station block**. Set the rotation length, for example ten minutes. The block
   shows "4 stations, 10 min each, 4 rotations, 40 min".
   *New in the planner. The rotation count defaults to the station count.*
4. Small-sided game at the end, as an ordinary activity.
5. The session total now reads sixty minutes, not the ninety it reads today.

**Key detail:** a session with no block is unchanged in every respect. The block
is opt-in and additive.

**The block belongs to the plan, not to the date.** A week plan carries its
station structure so that applying it to Tuesday and Saturday delivers the same
carousel twice. That is why `templates` gains the block metadata alongside
`sessions`, and why the block editor lives in the shared authoring seam rather
than in the planner.

## Journey 3: create a drill without leaving the plan

**Device: laptop. When: mid-planning. This is the journey the product does not
have today, and it must work from BOTH planning surfaces.**

**Revised after review.** An earlier draft described this from the dated planner
only. Long range planning happens in the week plan editor, weeks or months before
a dated session exists, and that editor already keeps its own separate copy of
the activity list, add bar and row component
(`00-current-state-audit.md` section 9). Building this in the planner alone would
leave the long range surface last to receive it and turn a two-way divergence
into a three-way one.

**So the journey is written once, against the shared authoring seam, and both
hosts get it in the same change.**

From a week plan (Programmes, week 3) or from a dated session (the planner):

1. In the add bar, **New drill** beside Add from library and Add custom.
2. A small form: title, phase, duration, objective. Nothing else is required.
   *Reuses `DrillFormModal.tsx`.*
3. Save. The drill exists in the library and the activity is already in the plan.
4. **Draw it** opens the Drill Maker on the new drill and returns to where it was
   opened from, with the draft intact.
   *Reuses `src/routes/DrillDiagramEditor.tsx` at `/drill/:id/diagram`, plus a
   return path that knows its origin.*
5. A **custom activity** (title only) gains **Turn into a drill**, which is the
   same journey starting from a title the coach already typed.

**The rule that makes this safe, and it now has two cases:** both hosts hold an
unsaved draft, and leaving to draw must not lose either. The planner's draft
lives in `sessionSubmit.ts` and `useGuardedSubmit`; the week plan editor's lives
in `TemplateFormModal`'s own form state, inside a modal, which is the harder of
the two because a modal unmounts. Deciding this once, in the seam, is the point.

**England Football drills are excluded from step 4**, unchanged, and now on every
surface: `diagramForDisplay` (added by PR #189) already withholds an FA drill's
hand drawn diagram wherever a session shows it, and `diagramEditDecision`
withholds the affordance to draw one. The two agree by construction and a test in
#189 pins that they do.

**What a coach sees of the diagram afterwards** is already built: PR #189 renders
it in the planner's expanded panel, on session day and on both live stages
(`00-current-state-audit.md` section 18).

## Journey 4: reuse a drill, as-is or adapted

**Device: laptop.**

1. Add from library, exactly as today.
   *Reuses `AddDrillModal.tsx`, `drillPicker.ts`, `drillFilter.ts`, all of PLAN-01.*
2. On the activity in the planner, **Copy and adapt**.
3. The drill is duplicated, diagram included, and the activity now points at the
   copy. The copy is named for its parent, for example "Passing square
   (adapted)", and the coach renames it if they want.
4. Everything is editable on the copy: diagram, rules, objectives, points,
   difficulty, area, equipment. The original is untouched, and so is every other
   session using it.
5. In the library, the copy sits under its parent as one of its adaptations
   rather than as a separate top-level drill.

**Editing a library drill directly** still works and still affects every session
using it. The edit form gains one line: "Used in 6 sessions, 4 already
delivered", with **Copy and adapt instead** beside it. The change becomes a
choice rather than a surprise.

## Journey 5: prepare the night once Spond replies arrive

**Device: laptop or phone. When: one or two days before.**

1. Open the session. Players & groups.
   *Reuses `src/routes/SessionRegister.tsx`, `src/lib/tonight.ts`, entirely.*
2. Refresh Spond, on the existing authenticated sync path.
3. The Going filter is already the default. Select all on the visible set.
4. **Suggest groups** proposes a balanced split of the included children into the
   number of groups the block has stations for, keeping team mates together where
   the numbers allow, and assigns a bib colour to each.
   *New: a pure function producing a draft. It writes nothing.*
5. The coach edits it: move a child, change a bib, add a guest who turned up.
6. **Save groups.** The readback is compared field by field, as today.
7. A readiness line appears on the session: "Plan ready. 22 in 4 groups. Stations
   placed. Ready for Tuesday." Derived on every read, stored nowhere.

**The rule that survives unchanged:** a club with no Spond configuration gets the
complete surface. A Spond failure renders as no context, never as "nobody is
coming".

## Journey 6: lay out the venue

**Device: laptop for the layout, either for the placement.**

**Admin, once per venue:**

1. Admin, Venues, open Flushdyke, **Set up the layout**.
   *Reuses `src/routes/AdminVenues.tsx`.*
2. Optionally state the real size of the area the club is allocated.
3. Draw the sub-areas and name them: "Pitch 1", "Pitch 2".
4. Save. The layout is now reused every week by every coach.

**Coach, weekly:**

1. On the session, **Where the stations go**.
2. The venue's areas render as named rectangles. Each station in the block is a
   numbered marker, **dragged to the spot on the ground where it should be set
   up**, not merely dropped onto a pitch.
3. The marker's derived area is shown as a label beside it ("Station 3, Pitch
   2"), read from where it landed rather than chosen separately, so the two can
   never disagree.
4. A station placed on the grass between two pitches reads as "not in a marked
   area", which is a legitimate answer and not an error.
5. A station **not yet placed** is listed as unplaced rather than hidden or drawn
   at a default position, because an unplaced station is the thing a coach needs
   to notice.
6. Optionally, a station can be given a footprint rather than a spot, for the
   case where the answer is "this drill uses the whole of Pitch 2".

**Why the position and not just the pitch.** At Flushdyke, two pitches side by
side and four stations means two per pitch. Told only "station 3 is on Pitch 2",
a coach arriving still has to ask where on Pitch 2, and which of the two stations
on it is theirs. That question is exactly the verbal briefing this programme
exists to remove.

**A venue with no layout** offers no composer and says so in one sentence, with a
link an admin can follow. It is not an error state.

## Journey 7: arrive and deliver

**Device: phone. This is the primary success scenario.**

1. Open OTJ. The session for today is the first thing on Home.
   *Reuses `pickNextEvent`, `eventFilter.ts`, `sessionLifecycle.ts`. Unchanged.*
2. **Groups and bibs.** Four groups, each a colour, each with its children.
   *Reuses `tonightGroups`, `TRAIN-01`'s read-only overview.*
3. **The setup.** The venue area with four numbered stations in place. One glance
   answers "where does everything go".
4. Tap station 2. The drill fills the screen: the diagram large, the objective,
   the coaching points, the setup notes, what equipment it needs.
   *Reuses `ActivityDiagram` and `DrillDiagramView` exactly as PR #189 mounts
   them on session day, so this is a layout around an existing seam rather than
   a new rendering path.*
5. Back to the overview. Swipe or tap moves between stations.
6. "Your group starts here" is stated on the station a coach's group begins at,
   derived from group order.
7. Optional: **Start** opens the live view, which runs one timer per rotation and
   says **Rotate** rather than walking four stations in series.
   *Reuses `src/routes/LiveSession.tsx`, `useSetLiveActivity`, `0006` live state.*

**What every coach sees is identical**, because it is one session read by
everyone, not a briefing one person gives.

---

## Mobile interaction: the decision, and why

The discovery asks how to fit all the stations on a phone and lists pinch zoom,
pan, swipe, tap to focus, zoom to station and return to overview.

**Decision: overview with numbered markers at their real positions, tap to focus,
back to overview. Swipe moves between stations. Pinch and pan are available and
load-bearing for nothing.**

The reason is what gets drawn. If the overview tries to render four drill
diagrams inside four pitch areas at 390 pixels wide, nothing is legible and zoom
becomes mandatory to use the product at all. If the overview draws **areas and
numbered markers only**, it is legible at phone width with no zoom, and the
detail lives one tap away where it has the whole screen. Zoom then becomes what
it should be: something a coach may do, not something they must do.

**The placement model is what makes this work rather than a cost against it.**
Four stations carrying positions are four separated tap targets. Four stations
carrying only a pitch id would coincide in pairs at each pitch's centre, and no
amount of zooming would separate them, because the information is not in the
data. The lighter model is also the legible one.

Accessibility consequences, which point the same way:

- Tap targets are large numbered markers, comfortably over the 44 pixel minimum
  the rest of the app uses.
- A pinch-only interface is unusable to anyone who cannot pinch. Tap and back
  work with a keyboard, with a screen reader, and with cold wet hands in
  February.
- The station list must also exist as an ordinary list, so the layout is a view of
  the plan and not the only way to reach it.
- Station identity is carried by **number and name**, never by colour alone, the
  same rule the drill diagram already applies to arrow kinds.

## Copy notes

- "Template" becomes **week plan**. "Session plan" for a standalone one.
- The operational surface stays **Players & groups**. Nothing user-visible says
  Tonight or Register (`tonight.invariant.test.ts` enforces this).
- The venue surface is **Setup** or **Where the stations go**, never "pitch map",
  which promises a map.
- A station is a **station**, numbered from 1. Not "activity 3 of 7".
- British English throughout. No use of "roster" in anything a user reads.
