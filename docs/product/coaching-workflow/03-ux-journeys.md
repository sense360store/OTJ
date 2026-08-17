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

## Journey 3: create a drill without leaving the session

**Device: laptop. When: mid-planning. This is the journey the product does not
have today.**

1. In the planner's add bar, **New drill** beside Add from library and Add
   custom.
2. A small form: title, phase, duration, objective. Nothing else is required.
   *Reuses `DrillFormModal.tsx`, opened from the planner for the first time.*
3. Save. The drill exists in the library and the activity is already in the
   session.
4. **Draw it** opens the Drill Maker on the new drill and returns to the planner
   on save, with the session draft intact.
   *Reuses `src/routes/DrillDiagramEditor.tsx` at `/drill/:id/diagram`, plus a
   return path.*
5. A **custom activity** (title only) gains **Turn into a drill**, which is the
   same journey starting from a title the coach already typed.

**The rule that makes this safe:** the planner holds an unsaved draft. Leaving it
to draw must not lose the draft. The session is saved before the editor opens, or
the draft is preserved and restored. `sessionSubmit.ts` and the existing guarded
submit are where that is decided.

**England Football drills are excluded from step 4**, unchanged. The club may use
FA diagrams as they are and may not redraw them
(`src/lib/drillDiagramRights.ts`).

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
2. The venue's areas render. Each station in the block is a numbered marker,
   dragged into an area or tapped into it.
3. A station with no area is shown as unplaced rather than hidden, because an
   unplaced station is the thing a coach needs to notice.

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
   *Reuses `DrillDiagramView`, the drill's own fields.*
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

**Decision: overview with numbered markers, tap to focus, back to overview.
Swipe moves between stations. Pinch and pan are available and load-bearing for
nothing.**

The reason is what gets drawn. If the overview tries to render four drill
diagrams inside four pitch areas at 390 pixels wide, nothing is legible and zoom
becomes mandatory to use the product at all. If the overview draws **areas and
numbers only**, it is legible at phone width with no zoom, and the detail lives
one tap away where it has the whole screen. Zoom then becomes what it should be:
something a coach may do, not something they must do.

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
