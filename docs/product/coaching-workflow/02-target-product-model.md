# Target product model

Status: proposal, awaiting approval. Depends on `00-current-state-audit.md` for
every claim about what exists today.

This document decides what each concept **is**: a reference, a snapshot, a copy,
a version, or a hybrid. It states why, and it names what needs new database
structure and what does not.

---

## 1. The entity chain

```
Programme                the long-running theme, several weeks
  └─ Week plan           the reusable plan for one week: objective + stations
       └─ Session        one dated delivery, at a venue, for a set of teams
            ├─ Attendance      Spond replies, mirrored, read only
            ├─ Groups & bibs   the coach's arrangement for that night
            ├─ Venue setup     which station goes in which training area
            └─ Delivery        what every coach sees on their phone
```

and, crossing it:

```
Library drill            the reusable exercise
  └─ Session activity    a reference, plus a phase and a duration
       └─ Adaptation     a copy of the drill, owned by the session that made it
            └─ Visual    the diagram; optional motion, much later
```

**Every box in the first chain already exists as a row.** The only genuinely new
structure in the whole programme is the venue layout, the drill variant link, the
station block metadata and an explicit week-plan link. That is the central
finding: the current data model is closer to the real workflow than the current
user journeys are.

## 2. Programme, week plan and session are three things, not one

**Decision: keep all three. Add no new planning entity.**

| Concept | Table today | Role |
|---|---|---|
| Programme | `programmes` | The theme. Holds no drills. |
| Week plan | `templates` | The reusable plan: objective, stations, durations. |
| Session | `sessions` | One dated delivery, with a venue and covered teams. |

The temptation is to invent a "weekly plan" entity because the discovery language
says "the planned session/week". That entity already exists and is called a
template. It has `activities`, `intentions`, `focus`, a name, and optional
`programme_id` plus `programme_week`. Adding a fourth row type would duplicate
it, and the adversarial pass in `06-phased-plan.md` rejects it on exactly that
ground.

What is missing is not an entity. It is three journeys:

1. **Promote**: save the session you just planned as a week plan, so the next
   week starts from it.
2. **Two deliveries, one plan**: apply a week plan to more than one date at once
   (Tuesday and Saturday), and show the two sessions as siblings.
3. **Naming**: the word "template" is FA-import language. A coach plans a week.
   The user-visible noun should be **week plan** (or **session plan** for a
   standalone one). This is copy, not schema.

**`sessions.template_id`, one nullable column, is the only structure this
needs.** It makes provenance uniform (today only a programme-applied session
records where it came from), and two sessions sharing a `template_id` are the
sibling link for free.

### Copy or reference, per hop

| Hop | Decision | Why |
|---|---|---|
| Programme → week plan | **Reference** (`templates.programme_id`) | A week belongs to a theme for as long as it does; renaming the programme should move the week with it. |
| Week plan → session | **Copy** (already) | A dated session must not change because someone edited the plan afterwards. This is the historical-safety rule and it already holds. |
| Session → session (Tue and Sat) | **Copy, with a shared `template_id`** | Two deliveries are two records of two different nights. They must diverge freely, and the shared link is how the product can offer "apply this change to Saturday too" as an explicit action rather than a silent one. |

## 3. Drill, session activity and adaptation

**Decision: a session activity stays a reference. Adapting makes a copy.
Nothing is versioned.**

### The three candidate designs, and why copy wins

**Versioning** (a `drill_versions` table, sessions pin a version number). Rejected.
It makes every drill edit mint a row, forces the UI to answer "which version am I
looking at?", and asks a volunteer grassroots coach to hold a concept they have
no use for. It is the speculative complexity principle 10 exists to refuse.

**Session-local overlay** (an override object inside `sessions.activities`).
Rejected. The heavy part of a drill is the diagram, so a meaningful overlay must
carry a diagram, and `sessions.activities` has **no check constraint**
(`00-current-state-audit.md` section 4). That would put a second drill model in a
column with none of the guarantees `drills.diagram` earned in `0046`: no key
allow-list in the database, no shared parser, no share rules, no rights
classification. Two implementations of one thing, one of them unprotected.

**Copy on adapt.** Accepted. "Adapt for this session" duplicates the `drills`
row, diagram included, and repoints the activity at the copy. The copy is an
ordinary drill: same table, same policies, same parser, same renderer, same
rights model, same England Football lock. Nothing new to learn and nothing new to
secure. And the session points at exactly the row it ran, so "what did we
actually do that night?" has one unambiguous answer.

### The one problem copying creates, and its answer

Copies multiply. Four to six stations across forty sessions a season is a lot of
near-duplicate rows in a library a coach browses.

**`drills.variant_of`, one nullable self-reference.** The library lists originals
by default; a variant appears under its parent ("3 adaptations") and in the
session that uses it. It is a display rule, not an access rule, so it needs no
policy work. Everything else about a variant is an ordinary drill.

### What copying does not solve, stated honestly

Editing a library drill still changes every past session that references it. Full
fidelity would mean snapshotting the drill onto every session, which is expensive
and, for grassroots training, nobody's actual question.

**Decision: do not snapshot delivered sessions. Make the edit non-silent
instead.** The drill edit form gains a line naming how many sessions reference
this drill and whether any of them have already been delivered, with "Copy and
adapt instead" beside it. That is a UI honesty measure costing one query, not a
data model.

Recorded as an open question (`08-open-questions.md`, Q3) with a recommended
default of "no freezing", because the mechanism to change our mind later already
exists: the public share snapshot demonstrates it.

### Where the diagram lives

**On the drill, always.** `drills.diagram` is the right home and it is already
correct: versioned, fraction coordinates, allow-listed on read and on write, and
pinned by a check constraint so no client can put a person in it. A session never
holds a diagram. An adaptation holds its own because an adaptation is a drill.

## 4. Station blocks: the model change the workflow actually needs

**Decision: introduce an explicit parallel block. This is the one structural
addition to the session plan.**

**Revised after review.** An earlier draft justified this by claiming the session
total is wrong for station work. That claim was overstated and the arithmetic
refutes it. Four 10 minute stations run as four rotations by four groups lasts
40 minutes, and the sum of four 10 minute activities is 40. **The present total
is not wrong merely because the stations are parallel.** See
`00-current-state-audit.md` section 17 for the full working.

The real justification is three structural absences, of which duration is the
smallest.

### 4.1 There is no station identity

Nothing in the data says which activities form one carousel. Every question this
programme exists to answer needs that fact:

- "Where does station 3 go at the venue?" The composer has nothing to place.
- "Which station does my group start at?" There is no set to index into.
- "Show me the four stations together" on the training-day overview. There is no
  four.

A venue composer cannot be built on top of a flat activity list, which is why
this precedes the composer rather than following it.

### 4.2 Live delivery is sequential, and that is wrong today

`LiveSession.tsx` walks `activities` one at a time and shows the current one to
everybody. During a carousel every group is at a *different* station at the same
moment, and the event that matters is **rotate**, which the live view has no
concept of. This is wrong regardless of duration, and it is wrong right now.

### 4.3 The total is correct until the operational layer does its job

`wall clock = minutesPerRotation × rotations`, while
`sum of durations = minutesPerRotation × stations`. They agree exactly when the
rotation count equals the station count and the stations are equal length.

That holds for the planned default and stops holding in every shape below, of
which the first is the common one:

| Shape | Actual | Sum says |
|---|---|---|
| 4 stations, 3 groups | 30 | 40 |
| 6 stations, 4 groups | 40 | 60 |
| 4 stations, 5 groups | 50 | 40 |
| Unequal stations under a shared rotation length | 48 | 40 |
| 5 stations, each group visiting 4 | 40 | 50 |

The discovery says the group count is set by attendance one or two days before
the session. **So the total is right while nothing changes and becomes wrong at
exactly the moment the operational layer adjusts it.** The knock-on effects on
`plannedMinutes`, the derived lifecycle and the calendar export are real but they
are consequences of that one case, not a standing defect.

### The shape

An activity may carry an optional `blockId`. The session carries a small list of
blocks, each `{ id, minutesPerRotation, rotations }`.

- Activities stay a **flat array**, so the planner's drag and drop, the phase
  chips and the existing reordering are untouched.
- A block's contribution to the total is `minutesPerRotation × rotations`, not the
  sum of its members.
- `rotations` **defaults to the number of stations in the block** and is
  adjustable. That default is itself an expression of principle 6: at planning
  time four stations means four rotations; on the night, three groups turning up
  means three, and the operational layer adjusts it.
- A session with no blocks behaves **exactly as today**, which is what makes the
  phase shippable on its own.

### What a block is not

It is not a workflow object, it has no owner, and it does not know about groups.
Groups meet stations at delivery time through arithmetic, not through stored
state (section 6).

## 5. Session lifecycle: derive, do not store

The discovery asks whether a session has a meaningful lifecycle: planned,
attendance available, groups prepared, setup prepared, ready for training,
delivered.

**Decision: add no stored workflow states. Derive readiness.**

Every one of those six is already answerable from data the screen has read:

| Question | Derived from |
|---|---|
| Planned? | `activities.length > 0` |
| Attendance available? | `spond_event_id` set and responses known |
| Groups prepared? | any `register_entries.included_in_groups` for this session |
| Setup prepared? | every station in the block has an assigned venue area |
| Ready for training? | all of the above that apply |
| Delivered? | `sessionLifecycle.ts` already answers this, three states, derived |

Storing them would create six columns that can each disagree with the record they
describe, plus six writes that must fire at the right moment, plus a repair story
for every row written before the column existed. `sessionLifecycle.ts` exists
precisely because a stored flag (`sessions.status`) went stale and left yesterday's
training on the front page. That lesson applies here without modification.

So: a **readiness readout**, computed by one pure module that imports
`sessionLifecycle` rather than reimplementing it, shown as a short line on the
session, and never written anywhere.

## 6. Groups, bibs and rotation

**Reopened after review.** An earlier draft settled this by pointing at
`tonightGroups` and declaring a group to be a bib colour. That let the current
implementation decide the product model, which is the wrong direction of travel.
The question is reopened properly here, and the final call is left to a human in
`08-open-questions.md`, Q9.

### 6.1 Are group identity and bib colour the same concept?

What the discovery says: the age group trains together; where possible a coach
stays with their own team's players while rotating; attendance may require
combining or rebalancing groups; and the bib colour is how the operational group
is recognised.

Read carefully, that describes a group as having **three** properties, of which
the bib is one:

| Property | Carried by a colour? |
|---|---|
| How everyone recognises it on the grass | **Yes.** This is exactly what a bib is for. |
| Which children are in it | Yes, transitively, through each child's effective bib. |
| Where it came from (which team's players) | **No.** Kept beside the group today as `teamNames`. |
| Which station it starts at, and its rotation order | **No.** Nothing carries this. |
| Its continuity when rebalanced | **No.** Rebalancing means re-bibbing children. |

So the colour is an excellent **label** and a workable **key**, and it is not the
whole concept.

### 6.2 Two real collisions in the current derivation

`tonightGroups` (`src/lib/tonight.ts:1103`) keys on `bib ?? ''`:

1. **Two teams whose `teams.bib_colour` default is the same colour silently
   merge into one group.** Nothing prevents an admin setting two teams to blue,
   and nothing surfaces it when they have. A whole-club session then shows one
   blue group of 18 where the coach expects two of 9.
2. **Every child with no effective bib merges into one "No bibs" group**, which
   already mixes two different facts (a coach who chose no bib, and a team with
   no colour configured). The code says so in its own comment. If a club runs
   five groups with four sets of bibs, the fifth group is not representable.

Neither is fatal and neither is common with five teams and nine colours. Both are
real, and neither is visible to the coach it happens to.

### 6.3 The three options

**A. Keep bib as the group identity, and surface the collisions.**
No schema, no migration, no new concept for a coach to learn. The two collisions
become stated rather than silent: the groups screen says "Titans and Trojans both
default to blue, so they are showing as one group" with the fix beside it.
Rebalancing stays a bib change, which is the gesture coaches already use.
Cost: two groups cannot share a colour, and a group has no identity that survives
a re-bib.

**B. A lightweight operational group, per session.**
An ordered list on the session, each entry `{ id, label, bibColour }`, and a
`group_id` on the register entry. Groups gain continuity, a name, a start station
and the ability to share a colour or have none. Cost: a new column on
`register_entries`, which is currently a very clean table; a second thing a coach
can edit that must stay consistent with the bib; and the genuine risk that the
group and the bib disagree, which is worse on a pitch than either collision above.

**C. Bib as identity, plus a derived group order only.**
Option A, plus the ordering needed for rotation, derived from the club's bib
vocabulary order, which `tonightGroups` already applies.

### 6.4 Recommendation

**Option C for this programme, with option B recorded and not built.**

The reasoning is that B's cost lands in the wrong place. Its benefit is
expressible only in cases the club has not reported (two groups of one colour, a
group that must survive a re-bib, a named group), while its cost is a second
editable identity that can disagree with the colour every child is actually
wearing. On a pitch, the colour wins that argument every time, which means the
stored group id would be the thing that is wrong.

What C commits to:

- The bib colour remains the operational group identity.
- The two collisions in 6.2 are **surfaced**, not left silent. That is a client
  change with no schema.
- Group order comes from the existing bib vocabulary order, so it is stable
  across a re-bib of one child.

**Starting stations are derived, not stored.** Groups in that stable order start
at stations in order, and rotation is modular arithmetic over the rotation index.
No state, no migration, no write.

An override ("put the blues on the goalkeeping station first") is deliberately
not in the plan (`08-open-questions.md`, Q5).

**The trigger for revisiting B is stated in advance**, so this is a decision
rather than a default: if the club reports wanting two groups of one colour, a
group that keeps its identity through a re-bib, or a coach assigned to a named
group, option B is the answer and it is one column plus one jsonb list.

**What Spond contributes, and what it does not.** Spond suggests the pool. The
coach decides the groups. Nothing in the Spond pipeline reads, writes, defaults
or constrains inclusion, presence or bibs, and that rule is unchanged. The one
addition is a **suggested split**: a pure function that takes the included
children and a target group count and proposes a balanced split keeping team
mates together, as a **draft the coach edits**. It writes nothing until Save
groups, exactly like every other Players & groups edit.

## 7. Venue and station layout

**Decision: two layers, one static and admin-owned, one weekly and coach-owned.**

### Layer 1: the venue layout (static)

A venue gains an optional **layout**: the training area the club is allocated,
plus named sub-areas inside it.

- The area is described in **fraction coordinates**, 0 to 1, exactly as
  `drills.diagram` and `boards.tokens` are, so one stored layout renders on a
  phone, a desktop and in print with no second copy.
- It carries an optional **real-world size** (for example 60 metres by 40) so the
  rendering has honest proportions and a coach can judge distances. Optional
  because a club that does not know will not measure.
- Sub-areas are named rectangles: "Pitch 1", "Pitch 2", "Third of pitch 3", "Goal
  end". A venue with one undivided area is a valid layout with one sub-area.
- **No satellite imagery in the first version.** The discovery is explicit that a
  clean rendered representation may be more useful, and an aerial photograph
  brings a third-party rights question, a storage cost and a legibility problem at
  phone width for no gain over a drawn rectangle with a name on it. An optional
  traced background is a later question (`08-open-questions.md`, Q6).
- Owned by `club.manage`, like the venue name it hangs off. Configured once,
  reused every week.

### Layer 2: station placement (weekly)

**Revised after review. An earlier draft assigned each station only a sub-area
id, and that is too coarse to meet the requirement.**

The product requirement is that a coach arriving at the venue can recreate the
layout without another coach explaining it. A sub-area id cannot do that. At
Flushdyke, two pitches side by side hosting four stations means two stations per
pitch, and `area_id` alone renders them stacked at the centre of their pitch,
indistinguishable from each other. The coach still has to be told where station 3
actually goes.

**Decision: a station carries a position, in the venue layout's own fraction
space. Area membership is derived from that position, never stored beside it.**

```json
{ "x": 0.22, "y": 0.35 }
```

optionally with a footprint when the station occupies a meaningful area rather
than a spot:

```json
{ "x": 0.22, "y": 0.35, "w": 0.18, "h": 0.22 }
```

Both are fractions of the whole allocated training area, the same 0 to 1 space
the sub-areas use, clamped by the same rules `drills.diagram` already applies to
a `zone` element. Nothing here is metres and nothing is pixels.

**Why derive the area rather than store it too.** Storing both a position and an
`area_id` creates two facts that can disagree: drag a station across a boundary
and the stored area is now wrong, or move a pitch in the venue layout and every
stored area id is a claim the geometry no longer supports. One fact, derived,
cannot contradict itself. A station whose position falls outside every sub-area
is honestly "placed, not in a marked area" rather than silently reassigned.

**Why this is still not copying the venue geometry.** The station stores two
numbers, or four. The rectangles, their names and their sizes stay on the venue
and are read at render time, so moving Pitch 2 moves every future session's
stations that sit on it, and no session holds a stale copy of the ground.

**Phone consequence, which drove the shape.** With positions, the overview draws
numbered markers where the stations actually go, and four markers spread across
two pitches are four distinguishable tap targets at 390 pixels wide. With area
ids alone they would coincide, and the only way to tell them apart would be to
zoom into something that carries no more information at higher magnification.
The lighter data model is what makes the phone interaction work, not a cost paid
against it.

A session whose venue has no layout, or which has no block, simply has no
composer. The rest of the session is unaffected.

## 8. Training-day delivery

**Decision: overview, then station, then drill. One canonical plan behind all
three.**

```
Session day (phone)
  ├─ Tonight's groups and bibs        ← register_entries + teams.bib_colour
  ├─ Venue overview                   ← venues.layout + station assignment
  │     numbered station markers, tap to focus
  ├─ Station N                        ← the activity, its drill
  │     the drill diagram, large
  │     the objective and coaching points
  │     the setup notes and equipment
  └─ back to overview
```

The overview draws **areas and numbered markers at the stations' actual
positions**, not four drill diagrams shrunk to fit. That is the trap at phone
width, and drawing it this way is what makes zoom unnecessary rather than what
makes zoom essential. Pinch and pan remain available on the surface because they
cost nothing, but the design does not depend on them.

Everything on this screen comes from rows the coach is already authorised to
read. There is no new payload, no new read path and no new permission.

The diagram half of this journey is already built. PR #189 puts the saved
diagram on session day and both live stages through `ActivityDiagram`, so the
station focus screen mounts the existing seam rather than a new renderer
(`00-current-state-audit.md` section 18).

## 8a. One authoring seam, two hosts

**Added after review.** Long range planning happens in the week plan editor,
weeks or months before a dated session exists. Dated planning happens in the
planner. Both edit an activity list, and **both already have their own editor**:
`TemplateFormModal` maintains its own add bar, custom activity literal, row
component and reorder handlers beside the planner's
(`00-current-state-audit.md` section 9).

**Decision: authoring improvements go into one shared seam used by both hosts,
never into the planner alone.**

The seam owns the activity list and its affordances: add from library, add
custom, **new drill**, **draw it**, copy and adapt, reorder, phase and duration.
Its hosts supply what differs, which is very little: what the list belongs to,
how a draft is held and saved, and whether dated affordances (venue, Spond,
station placement) appear at all.

Building "create a drill in the dated planner" first and porting it afterwards
would make a two-way divergence into a three-way one, and would leave the surface
where long range planning actually happens as the last to get the feature. That
is the wrong way round.

## 9. Motion

**Decision: last, and only if the static workflow is proven in use.**

If it happens, the shape is: an optional motion track on a diagram, expressed as
a small number of keyframes per element, with play, pause and restart. Not a
timeline editor, not easing curves, not per-element scripting.

Two hard constraints, from `00-current-state-audit.md` section 7:

1. `drills.diagram` has a **check constraint stating the element key
   allow-list**. Any new key or element type is a **gated migration**, reviewed
   like every other one.
2. The parser **discards a diagram whose version it does not recognise**. So a
   client that can read version 2 must be deployed everywhere **before** anything
   writes version 2, or coaches on a stale tab see their diagrams vanish. Reader
   first, writer second, two releases.

## 10. Decision summary

| Concept | Decision | New structure |
|---|---|---|
| Programme | Keep. Reference from week plans. | None |
| Week plan (template) | Keep. Rename in copy. Add promote and multi-date apply. | None |
| Session from week plan | Copy, as today, plus an explicit link | `sessions.template_id` |
| Two deliveries of one plan | Two sessions sharing `template_id` | None beyond the above |
| Session activity → drill | Reference, as today | None |
| Adapting a drill | **Copy**, never version, never overlay | `drills.variant_of` |
| Editing a library drill | Stays live. Made non-silent in the UI. | None |
| Drill diagram | Stays on the drill. Delivery surfaces in PR #189. | None |
| Activity authoring | **One seam**, hosted by the planner and the week plan editor | None |
| Station block | **New**: station identity, rotation count, parallel delivery | Block metadata |
| Session workflow state | **Derived**, never stored | None |
| Group | Bib colour stays the identity (option C). Collisions surfaced. Reviewed at Q9. | None |
| Starting station | Derived by bib vocabulary order | None |
| Suggested split | A pure function producing a draft | None |
| Venue layout | **New**: fraction-coordinate areas, admin owned | `venues.layout` |
| Station placement | **A position** in the venue's fraction space; area derived | Activity key |
| Training-day view | Composed from existing reads and PR #189's seam | None |
| Motion | Deferred. Additive, gated, reader-first. | Diagram schema widening |

Exact column and constraint proposals are in `04-data-model-proposal.md`.
