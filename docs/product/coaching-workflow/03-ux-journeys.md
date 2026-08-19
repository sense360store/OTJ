# Target UX journeys

Status: approved product model, reconciled 18 August 2026. Nothing here is built.

Eight journeys, written as what the coach does rather than as screens. Each names
the existing components it reuses, because the point of the audit was to find
what already works, and each names its device, because authoring may optimise for
a laptop and delivery is judged on a phone.

**The delivery journeys assume a phone by default.** Most delivery use is an
iPhone or an Android phone, held in one hand, outdoors, often in poor weather.

---

## Journey 1: plan a programme for the next several weeks

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

## Journey 2: plan a week's session

**Device: laptop. When: days to weeks ahead. Spond: absent.**

1. Open the week plan, or start a session directly in the planner.
   *Reuses `src/routes/Planner.tsx`, `useStartFromTemplate`.*
2. Warm-up first.
3. **Add four or five station drills, and mark them as stations.** The planner
   states what the plan declares: "5 stations, 10 minutes each". Station numbers
   follow plan order, so reordering renumbers.
4. **Add the games phase, and mark it as the games.** **One activity**, whose
   duration is the whole games phase. Whether one or two pitches run inside it is
   an operational decision made later, not a second activity.

**Marking is explicit, and that is the point.** The coaching phase of a drill
says what kind of drill it is, not what part it plays on the night: a physical
drill is filed under Warm-Up and can still be a station, and a social drill is
filed under Game without being one of the evening's small-sided games. The
planner may **suggest** which activities look like stations, and a person
confirms it.
5. The session total reads as it does today, computed by `sessionMinutes`.
   Nothing is stood down while authoring, so nothing is skipped and the total is
   the whole plan.

**Three or fewer stations is not offered as a recommendation.** A coach who
declares three anyway is not blocked, and the screen says what the plan declares
rather than refusing.

**A plan opened from before this existed declares nothing**, so it shows no
stations and offers one press to mark them, seeded by a suggestion. Nothing is
guessed on the coach's behalf.

**The station structure belongs to the plan, not to the date.** A week plan
carries its drills in order, so applying it to Tuesday and Saturday delivers the
same stations twice.

## Journey 3: create a drill without leaving the plan

**Device: laptop. When: mid-planning. It must work from BOTH planning surfaces.**

Long range planning happens in the week plan editor, weeks before a dated session
exists, and that editor already keeps its own copy of the activity list, add bar
and row component (`00-current-state-audit.md` section 9). Building this in the
planner alone would leave the long range surface last to receive it and turn a
two-way divergence into a three-way one. So the journey is written once, against
the shared authoring seam, and both hosts get it in the same change.

From a week plan or from a dated session:

1. In the add bar, **New drill**, beside Add from library and Add custom.
2. A minimal form: title, phase, duration, objective. Nothing else required.
   *Reuses `DrillFormModal.tsx`.*
3. Save. The drill exists in the library and the activity is already in the plan.
4. **Draw it** opens the Drill Maker on the new drill and returns to where it was
   opened from, with the draft intact.
   *Reuses `src/routes/DrillDiagramEditor.tsx` at `/drill/:id/diagram`.*
5. A **custom activity** (title only) gains **Turn into a drill**, which is the
   same journey starting from a title the coach already typed.

**The rule that makes this safe, and it has two cases.** Both hosts hold an
unsaved draft, and leaving to draw must not lose either. The planner's draft
lives in `sessionSubmit.ts` and `useGuardedSubmit`; the week plan editor's lives
in `TemplateFormModal`'s own form state inside a modal, which unmounts. Deciding
this once, in the seam, is the point of the seam.

**England Football drills get no Draw it**, unchanged. `diagramEditDecision`
withholds the affordance and `diagramForDisplay` withholds a stranded FA diagram
wherever a session shows one. The two agree by construction and a merged test
pins it.

## Journey 4: reuse a drill, as-is or adapted for one session

**Device: laptop.**

1. Add from library, exactly as today.
   *Reuses `AddDrillModal.tsx`, `drillPicker.ts`, `drillFilter.ts`, all of PLAN-01.*
2. On the activity, **Adapt for this session**.
3. The drill is duplicated, diagram included, and the activity points at the
   copy. The copy belongs to this session.
4. Everything is editable on the copy. **The original is untouched, and so is
   every other session using it, including Tuesday's.**
5. **The adaptation does not appear in the library.** It is reachable from this
   session and from its parent drill's page, and **deleting the original does not
   put it there**: losing its parent link costs it its provenance, not its
   place.
6. If the coach later wants it permanently, **Save as reusable drill** creates a
   **new** library drill. It never overwrites the original.

**No version numbers anywhere.** A coach is never asked which version they are
looking at, and no screen says v1 or v2.

**Editing a library drill directly** still works and still affects every session
referencing it. The edit form gains one line: "Used in 6 sessions, 4 already
delivered", with **Adapt for one session instead** beside it. The change becomes
a choice rather than a surprise.

## Journey 5: prepare the night once Spond replies arrive

**Device: laptop or phone. When: about 24 to 48 hours before.**

1. Open the session. Players and groups.
   *Reuses `src/routes/SessionRegister.tsx`, `src/lib/tonight.ts`, entirely.*
2. Refresh Spond, on the existing authenticated sync path.
3. **OTJ has already drafted the setup from the confirmed attendance.** Only Yes
   counts. Unanswered and waiting are treated as not attending and receive no
   bib, no group and no game.
4. The draft states what it did, in a sentence a coach can argue with:
   - "26 confirmed. 5 stations, 5 groups." (24 or more recommends five; fewer
     recommends four; three is never recommended.)
   - Groups keep normal teams whole where the numbers allow, combine only
     **adjacent** ability bands, and prefer 6/5/5/4 over splitting two squads to
     reach 5/5/5/5.
   - Each group has a **unique** bib colour, taken in the fixed colour order, so
     the first colour is group 1 and starts at station 1.
5. The coach edits it: move a child, change a colour, add a guest who turned up.
   **Moving a child tonight changes nothing durable**: not their Spond team, not
   their OTJ team, not next week's default.
6. **Save groups.** The readback is compared field by field, as today.
7. A readiness line appears: "26 in 5 groups. Everyone has a bib. Layout ready."
   Derived on every read, stored nowhere.

**If attendance says four stations and the plan holds five**, the screen says so
and the **coach** picks the one that is not running tonight. It is marked, not
removed: it keeps its place and its own duration in this session's plan, the week
plan and the library drill are untouched, and one press puts it back if more
children confirm. Station numbers for the night count only the ones running.

**The night gets shorter, and the screen says so.** Four rotations are not five,
so the session total drops by that station's duration and the expected finish
moves with it. Putting the station back restores both.

**When attendance changes again before training**, the screen does not start
over. Children who are no longer attending are removed, newly confirmed children
are placed, **every assignment already saved is kept**, and rebalancing happens
only where it is necessary. A deliberate Reset is the only thing that regenerates
from scratch, and it is a later addition.

**Readiness never blocks.** An included child with no effective bib means not
ready, and the coach can still open, edit and run the session.

**Two states the screen names rather than hides**
(`00-current-state-audit.md` finding 2): two teams whose default colour is the
same, which would otherwise merge two intended groups into one; and children with
no bib at all, which is not a valid group. Both come with the fix beside them.

**The rule that survives unchanged:** a club with no Spond configuration gets the
complete surface. A Spond failure renders as no context, never as "nobody is
coming".

## Journey 6: plan the games

**Device: laptop or phone. When: with the groups, one or two days before.**

1. On the same session, the games section states what it recommends: **one game
   at 12 or fewer confirmed, two at 13 or more**, aiming at 5v5 or 6v6 and
   avoiding 7v7. The coach accepts it or picks the other.
2. **The recommendation changes nothing until it is accepted**, and once accepted
   it is **not** silently rewritten because more replies arrived. The screen says
   what the new attendance would recommend and leaves the decision to the coach.
   Until then the count is simply unaccepted, which the readiness line names.
3. OTJ proposes the sides:
   - **Two games**: the upper ordered teams form the stronger game, the lower
     ordered teams the development game, and the middle band is the flexible
     bridge whose players may be split between the two to make the numbers work.
     **Sensible game size comes before preserving the station bib groups.**
   - **One game**: the two sides are balanced by ability, with players from the
     stronger teams distributed across both sides rather than kept as opposing
     blocs. Expected to be relatively rare.
4. **Where possible each game gets two clearly distinguishable bib colours**, so
   two games use four between them and some children are re-bibbed. That is
   expected, not exceptional. The colour picker offers only the colours in play
   for those games, and a child's game and side follow from the colour they are
   given. **Every included child is given one that is in play**: with five groups
   and two games the fifth group's colour is not one of the four, so those
   children are handed a bib rather than left in neither game.
5. **The station bib plan is untouched by any of it.** The game bib is a separate
   stored fact (`04-data-model-proposal.md` section 4), so planning the games
   cannot destroy the carousel groups, and a coach can read both on one screen.
6. The game plan shows **actual player names, their side and their game bib
   colour**.

**A child nobody re-bibbed plays in what they are already wearing**, which is
both the physical truth and the resolution rule.

**On the day the coach adapts physically without updating OTJ.**

## Journey 7: lay out a venue, once

**Device: laptop. Who: an admin.**

1. Admin, Venues, open Haggs Hill, choose the **season** and the **age group**,
   then **Set up the layouts**.
   *Reuses `src/routes/AdminVenues.tsx`.*
2. Optionally state the real size of the area the club is allocated.
3. Draw the **four station layout**: four numbered rectangular zones, dragged and
   resized to where stations normally go. A zone means "this is the area normally
   allocated to Station N", not the exact footprint of any week's drill.
4. Draw the **five station layout** the same way.
5. Draw the **one game** and **two game** reminder visuals: where the pitches go.
6. Save. Every coach reuses them every week for the rest of that season, and the
   positions stay familiar.

**The scope is venue, season and age group**, never venue-global and never per
team. A second age group at the same venue keeps its own four layouts, and next
season's allocation is drawn without disturbing this season's record.

**Weekly coaches do not drag or reposition anything in v1.** There is no per
session composer, and a session stores no geometry.

**A clean schematic, never a satellite photograph.**

**A session whose scope has no layout for its station count** says so in one
sentence with a link an admin can follow. It is not an error and it blocks
nothing. A session finds its scope from its venue and age group, with the season
read from its own date.

## Journey 8: arrive and deliver

**Device: phone. This is the primary success scenario.**

1. Open OTJ. Today's session is the first thing on Home.
   *Reuses `pickNextEvent`, `eventFilter.ts`, `sessionLifecycle.ts`. Unchanged.*
2. **Groups and bibs.** Five groups, each a colour, each with its children.
   *Reuses `tonightGroups` and TRAIN-01's one-glance overview.*
3. **The setup map.** The five station layout for this venue, season and age
   group, each zone showing useful overview information: the station number, the
   drill name, and the group starting there. A subtle clockwise cue shows which
   way groups move. A station not running tonight is not drawn, and is named as
   not running rather than silently missing.
4. **Tap a station.** It fills the screen:
   - station number
   - drill name
   - the drill diagram, large
   - the objective
   - two or three concise coaching points
   *Reuses `ActivityDiagram` and `DrillDiagramView`, already merged.*
5. **Previous station**, **Next station**, **Back to setup map**. All three are
   browsing. Nothing on the screen says where the session has got to.
6. **The games.** The venue's game layout for the accepted count, one pitch or
   two, and which named players and bibs are
   on each side.
7. **Share** sends the protected session link to another coach through the phone's
   own share sheet. They sign in and see the same plan.
   *Reuses `src/lib/share.ts` and `ShareModal`'s internal arm, already built.*

**What every coach sees is identical**, because it is one session read by
everyone rather than a briefing one person gives.

**Equipment is not on the station screen.** It belongs to setup, and it was dealt
with before the children arrived.

---

## Mobile interaction: the decision, and why

**Decision: a setup map of labelled zones, tap to open a station full screen,
back to the map. Previous and Next browse. Pinch and pan are available and
load-bearing for nothing.**

The reason is what gets drawn. If the map tries to render four or five drill
diagrams inside their zones at 390 pixels wide, nothing is legible and zoom
becomes mandatory to use the product at all. If a zone carries **a number, a
drill name and the group starting there**, it is legible at phone width with no
zoom, and the detail lives one tap away where it has the whole screen. Zoom then
becomes what it should be: something a coach may do, not something they must do.

**The saved layout is what makes this work.** The zones are large
rectangles an admin placed deliberately, so they are separated tap targets by
construction rather than by luck.

Accessibility consequences, which point the same way:

- Tap targets are whole zones, comfortably over the 44 pixel minimum the rest of
  the app uses.
- A pinch-only interface is unusable to anyone who cannot pinch. Tap and back
  work with a keyboard, with a screen reader, and with cold wet hands in
  February.
- **The stations must also exist as an ordinary list**, so the map is a view of
  the plan and not the only way to reach it.
- Station identity is carried by **number and name**, never by colour alone, the
  same rule the drill diagram already applies to arrow kinds.
- The clockwise cue is a cue, not the only statement of direction: the station
  detail says which station a group goes to next in words.

## Copy notes

- "Template" becomes **week plan**. "Session plan" for a standalone one.
- The operational surface keeps its existing title, **Players & groups**
  (`PLAYERS_GROUPS_TITLE`). Nothing user-visible says Tonight or Register, which
  `tonight.invariant.test.ts` enforces.
- The delivery surface is a **setup map**, never a "pitch map", which promises a
  map of a place.
- A station is a **station**, numbered from 1. Not "activity 3 of 7".
- Nothing says "rotation 2 of 4" or "current station", because OTJ does not know.
- British English throughout. No use of "roster" in anything a user reads.
