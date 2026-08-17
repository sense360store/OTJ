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

Today a session is a linear timeline. `sessionMinutes` is the sum of every
activity's duration and the Live view walks activities one at a time. Real
station training is parallel: four stations run simultaneously for ten minutes,
everybody rotates, repeat.

The consequences of not modelling it are concrete, not theoretical:

- A four-station block of ten minutes each reads as forty minutes of session, so
  a one hour session says ninety minutes.
- `sessionLifecycle.ts` derives the expected end from that total, so the session
  stays "active" long after it finished.
- `src/lib/ics.ts` exports the wrong length to a calendar.
- The Live timer runs four stations in series, which is not what happens.
- There is nothing for the venue composer to place, because "which activities are
  the stations?" has no answer in the data.

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

**Decision: a group is a bib colour. Introduce no group entity.**

This is already true in the code (`tonightGroups` keys the selected children on
effective bib colour) and it is already true on the pitch: coaches say "reds go
to station two". The bib vocabulary is closed and shared with the diagram
palette, so a group's colour and the colour of the players drawn on the drill are
the same word.

Nine colours is a hard ceiling on group count. Four to six groups is the
requirement. That is comfortable.

**Starting stations are derived, not stored.** Groups in a stable order start at
stations in order: reds at 1, blues at 2, greens at 3, yellows at 4. Rotation is
then modular arithmetic over the rotation index. This costs no state, no
migration and no write, and it is correct for the normal case the discovery
describes.

An override ("actually put the blues on the goalkeeping station first") is
deliberately **not** in the plan. If coaches ask for it, it is one small piece of
per-session state and can be added then. Recorded in `08-open-questions.md`, Q5.

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

Each station in a session's block is assigned to a venue sub-area. That is the
session venue composer, the item the roadmap calls DRILL-03.

The assignment is **per session**, because that is what changes weekly, and it is
**a reference to a sub-area id**, not a copy of the geometry, so moving a pitch
in the venue layout moves every future session's stations with it.

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

The overview draws **areas and numbers**, not four drill diagrams shrunk to fit.
That is the trap at phone width, and drawing it is what makes zoom unnecessary
rather than what makes zoom essential. Pinch and pan remain available on the
surface because they cost nothing, but the design does not depend on them.

Everything on this screen comes from rows the coach is already authorised to
read. There is no new payload, no new read path and no new permission.

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
| Drill diagram | Stays on the drill | None |
| Station block | **New**: parallel activities with a rotation count | Block metadata |
| Session workflow state | **Derived**, never stored | None |
| Group | A bib colour, as today | None |
| Starting station | Derived by order | None |
| Suggested split | A pure function producing a draft | None |
| Venue layout | **New**: fraction-coordinate areas, admin owned | `venues.layout` |
| Station placement | A reference to a sub-area, per session | Activity key |
| Training-day view | Composed from existing reads | None |
| Motion | Deferred. Additive, gated, reader-first. | Diagram schema widening |

Exact column and constraint proposals are in `04-data-model-proposal.md`.
