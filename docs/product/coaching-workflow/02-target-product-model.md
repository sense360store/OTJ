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

### 4.3 The duration model needs no change, and rotations are not stored

**Corrected again.** The previous revision said the total goes wrong when the
group count changes. That assumed rotations follow groups. They do not.

**The rule: every active bib group completes every planned station once.** So
the rotation count IS the station count. Four planned stations run four
rotations with three groups or with four; with three, one station stands empty
each rotation. Attendance changes group sizes and station occupancy, never the
plan.

```
rotations        = stations
wall clock       = minutesPerRotation × stations
sum of durations = minutesPerRotation × stations
```

Same expression. **The existing sum is correct at every attendance level**, so
`sessionMinutes`, `plannedMinutes`, the derived lifecycle and `src/lib/ics.ts`
are untouched by this work.

**Two consequences that make the model smaller:**

1. **`rotations` is not stored.** It is the count of stations in the block.
   Storing it would create a number that can disagree with the list it counts.
2. **A block needs no `minutesPerRotation` either.** Stations in one carousel
   move together, so they share a length, and each member activity already
   carries a `duration`. Where they disagree the answer is a planning warning
   ("stations in a carousel run for the same length"), not a second duration
   field to arbitrate between.

**So a block is a grouping and almost nothing else.** See section 4.4.

**What must never happen**, stated because it is the obvious wrong turn: low
attendance must not drop a drill, reduce the station count, shorten the carousel
or edit the planned session in any way. Higher attendance is answered by larger
groups, not by inventing a fifth group to fill a fifth station that was never
planned.

### 4.4 The shape, and it got smaller

An activity may carry an optional `blockId`. The session carries a small ordered
list of blocks, each `{ id, kind }`.

- `kind` is `'carousel'` or `'games'`. That is the only field beyond the id, and
  section 7 explains why the second value exists.
- Activities stay a **flat array**, so the planner's drag and drop, the phase
  chips and the existing reordering are untouched.
- **No `rotations` and no `minutesPerRotation`.** Rotations are the member count;
  the rotation length is the members' own shared duration (4.3).
- A block's contribution to the session total is **the sum of its members**,
  which is what `sessionMinutes` already computes. Nothing about duration
  changes.
- A session with no blocks behaves **exactly as today**, which is what makes the
  phase shippable on its own.

**A block is therefore one sentence: the activities that occupy the ground at
the same time.** A carousel is a block whose groups rotate through the members;
a game phase is a block whose groups are assigned to sides and stay. One concept
covers both, which is why there is no separate "game phase" entity.

### What a block is not

It is not a workflow object, it has no owner, and it does not hold group
membership. Groups meet stations at delivery time through arithmetic, not
through stored state (section 6).

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
| Groups prepared? | every included player resolves to a bib, and the active groups' colours are unique (section 6.3) |
| Setup prepared? | every station in each block carries a position |
| Ready for training? | all of the above that apply |
| Delivered? | `sessionLifecycle.ts` already answers this, three states, derived |

**Not ready is never blocked.** Every one of these describes the data; none gates
opening, editing or running the session. A late arrival added to a bib group
recalculates readiness on the next render, because nothing was stored to go
stale.

Storing them would create six columns that can each disagree with the record they
describe, plus six writes that must fire at the right moment, plus a repair story
for every row written before the column existed. `sessionLifecycle.ts` exists
precisely because a stored flag (`sessions.status`) went stale and left yesterday's
training on the front page. That lesson applies here without modification.

So: a **readiness readout**, computed by one pure module that imports
`sessionLifecycle` rather than reimplementing it, shown as a short line on the
session, and never written anywhere.

## 6. Groups, bibs and rotation

**Settled by coach discovery.** The previous revision reopened this and left it
to a human. It has now been answered, and the answer is recorded here rather than
in the open questions.

### 6.1 The decision

**The coach-facing identity of a station group is its bib colour.** Active
station groups have **unique** bib colours within a session. The coach reports no
use case for two intended groups deliberately sharing a colour, and the silent
merge that happens when they do is a defect rather than a feature.

**No new Group entity**, unless implementation evidence later proves the existing
model cannot carry the agreed behaviour.

**No per-player ability score, level or permanent training classification.** That
information already exists: a player belongs to a team, and the club orders its
teams. Duplicating it per player would create a second answer that can drift from
the first.

### 6.2 Two durable facts and one temporary one

The model must keep these apart, and the schema already does:

| | What it is | Where it lives | Changes when |
|---|---|---|---|
| **Normal team** | The durable player-to-team relationship, mirrored from Spond | `player_registrations.team_id`, per season | A child moves team, via `spond_reconcile_player_team` or a manager |
| **Team ability order** | The club's own ordering of its teams, strongest to weakest | **Nothing today.** See 6.4 | The club re-bands its teams, typically per season |
| **Tonight's bib group** | The operational group for one session | `register_entries.bib_colour_override`, else the team default | The coach moves someone for one night |

**The session-only override already works.** `register_entries.bib_colour_override`
is keyed on `(session_id, player_id)`, writes nothing back to `players`,
`player_registrations` or `teams`, and resolves through `effectiveBib` as
override, then team default, then none. Moving a child into a different bib group
tonight therefore cannot touch their Spond team, their OTJ team or their default
grouping next week. **No schema change is needed for requirement 2.**

### 6.3 What "no bib" means now

An included player with no effective bib means **Groups and bibs is not ready**.
"No bibs" is not a valid station group.

This is a **soft readiness state, never a blocker.** The coach can still open the
session, run it, add a late arrival to an existing bib group and watch readiness
recalculate. Readiness describes the data; it does not gate the product.

The same treatment answers the two collisions the audit found
(`00-current-state-audit.md` finding 2): two teams sharing a default colour, and
the merged "No bibs" group. Both are now named readiness failures with an obvious
fix beside them, rather than silent merges.

**Uniqueness is enforced in the domain and the UI, not in persistence.** A group
is emergent from per-player bib resolution, so there is no row a unique index
could sit on without inventing the Group entity this section declines. The check
belongs beside `tonightGroups`, where the groups are derived, and it surfaces as
readiness rather than as a refused write.

### 6.4 The team ability order, the one thing that must be stored

Verified against the schema (`00-current-state-audit.md` section 19): `teams`
carries `id, club_id, name, created_at, bib_colour` and nothing else. Every team
order in the product is alphabetical, which for this club is Argonauts,
Gladiators, Spartans, Titans, Trojans and matches the ability order nowhere.
There is no `sort_order`, `position`, `rank` or `ability` column on any table.

**Nothing can derive it.** `created_at` records when a row was inserted, which is
an accident of setup rather than a statement about football.

So this is the programme's one genuinely irreducible new fact, and it is
deliberately the smallest possible: **one integer per team**, five rows for this
club, set by a `teams.manage` holder on the existing admin screen.

It is **not** an ability score. It is the club's ordering of its own teams, and a
player's ability context is derived from it:
`player → current registration → team → that team's position`. No per-player
field exists or is proposed.

**The literal names Titans, Trojans, Gladiators, Spartans, Argonauts appear
nowhere in the product.** They are this season's contents of an ordered set. The
order may change between seasons and the model must not care.

Two orders coexist and must not be confused: **alphabetical for labels** (what
`sessionTeamsLabel` does today, unchanged) and **club order for grouping**.

### 6.5 How groups are suggested

Priority, in order:

1. Preserve normal team continuity as far as practical.
2. Combine **adjacent** ability bands when combining is necessary. Titans with
   Trojans, never Titans with Argonauts.
3. Keep numbers sensible.
4. Prefer slightly uneven groups over unnecessarily splitting a normal team.
   6/5/5/4 is better than 5/5/5/5 bought by breaking up two teams.

The output is a **suggestion the coach edits**, never an applied change, and it
writes nothing until Save groups.

### 6.6 Rotation and starting stations

The coach reports no preference about which group starts where, or about
rotation direction. So OTJ chooses deterministically and offers **no
configuration UI at all**: groups in bib vocabulary order start at stations in
order, and rotation is modular arithmetic over the rotation index.

Adding settings for either would be configuration nobody asked for.

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

### Layer 3: the setup changes during the session

**Added after coach discovery. The previous model assumed one session equals one
immutable venue setup, and that is wrong.**

A normal hour looks like this:

```
PHASE A  station carousel   4 to 6 stations set up across the area, groups rotate
   ↓     transition         cones come in, pitches go out
PHASE B  small-sided games  one or two game setups, groups become sides
```

So the venue base is static and reusable, and **the session's physical setup is
phase-specific**. A single "where the stations go" picture cannot describe the
night.

**Decision: a setup view is derived from a block, not from a new entity.**

A block is already "the activities that occupy the ground at the same time"
(section 4.4), which is exactly what a setup view draws. So:

- The **carousel setup view** is the placements of the `'carousel'` block's
  members.
- The **game setup view** is the placements of the `'games'` block's members.
- The **transition** between them is an ordinary activity the coach adds
  ("Reset, 5 min"), which the planner already supports with no new structure at
  all. The training-day view shows it between the two setup views.

**Nothing new is introduced for this.** No setup phase entity, no layout
versions, no workflow engine. Placement already lives on the activity
(`04-data-model-proposal.md` section 6), and grouping activities into blocks is
already the model. A game pitch is a placement with a footprint rather than a
spot, which is exactly what the optional `w` and `h` are for.

A session with one block has one setup view, and a session with none has no
composer. Both are ordinary.

## 7a. Small-sided games

**Added after coach discovery.** Games are not an afterthought to the carousel;
they are the second half of most sessions and they group players differently.

### A game side is not a bib group

**This is the important distinction and the model must not blur it.**

With four station groups and one game, it is entirely acceptable for one playing
side to contain players wearing **two** bib colours. Forcing a full bib
redistribution to make each side one colour is unnecessary kit churn at exactly
the moment the coach is trying to get twenty children playing.

So: **a station bib group and a game side are related concepts and different
things.** No screen, model or output may assume one side equals one colour.

### The shape

A game side is expressed as **a set of bib groups**, not as a list of players.

```
Game 1   side A: red, blue     side B: green
```

Reasons this is the right level:

- It reuses the group identity that already exists and needs no per-player row,
  so player membership is not duplicated (which is the failure mode to avoid).
- It survives a child being re-bibbed, because it names the colour, not the
  child.
- It expresses the two-colours-per-side case directly, which is the requirement.

**Per-player exceptions are deliberately not modelled, and the coach has now
confirmed why that is right.** Asked directly whether they would move a child to
the other side without changing their bib, or re-bib them, the coach said they
would **re-bib**. So the case a per-player exception would have served does not
arise: the child is handed a bib belonging to their new side and their colour
tells the truth about where they are.

This is not the same as "one side, one colour", which stays false. A side of two
colours remains a side of two colours; the re-bib moves one child from one of
those colours into one belonging to the other side.

Like every bib assignment it is **session only**. It cannot reach the child's
Spond team, their OTJ team or next week's default, and the schema is what
guarantees that rather than a rule anyone has to remember.

### How many games

Attendance suggests the count: roughly, a dozen players is one game and twenty
plus is two. **Those numbers are illustrative and must not be hard-coded as
policy.** They belong in one named, adjustable place with the reasoning beside
them, and they produce a **recommendation**, never a change.

The recommendation is **operational and the plan is not rewritten by it.** A week
plan authored with two game activities stays as authored; if attendance suggests
one, the coach is told and decides. Nothing deletes a planned activity because
fewer children replied.

### How sides are suggested

Using the club's team order (section 6.4): **keep stronger players together and
weaker players together.** Do not average two games into identical ability
mixtures, and never mix the strongest and weakest groups merely to make the
numbers equal.

With two games, that means the top bands play each other and the lower bands play
each other. With one game, it means the sides are drawn so the match is sensible
rather than deliberately lopsided.

All of it is a suggestion the coach adjusts on the night.

## 7b. What a re-bib costs, and why it is affordable

**The question this section exists to answer.** `register_entries` holds one row
per player per session with a single `bib_colour_override`, so a re-bib
**overwrites**. If a child wears red through the carousel and blue in the games,
does OTJ afterwards believe they were in the blue station group all along?

**The answer is yes, and it is accepted deliberately.** The reasoning is below,
including what would have made it unacceptable.

### The timeline, answered explicitly

| | Event |
|---|---|
| T0 | The child's normal Spond and OTJ team exists |
| T1 | Assigned RED for tonight's carousel |
| T2 | Rotates every planned station as RED |
| T3 | Carousel ends |
| T4 | Coach moves them to another game side and re-bibs them BLUE |
| T5 | Page reload |
| T6 | Coach opens the game setup and the live view |

What OTJ believes at T6:

| Fact | Value | Where it comes from |
|---|---|---|
| Permanent team | **Unchanged**, exactly as at T0 | `player_registrations.team_id`. A register write structurally cannot reach it. |
| Current bib | **BLUE** | `register_entries.bib_colour_override`, read back after the reload. |
| Game side | **The side BLUE belongs to** | The `'games'` block's side sets, which name colours. |
| Earlier station group | **Not recoverable** | Overwritten. No prior value, no per-field timestamp, and `register_entries` is unaudited by decision and by a schema check that refuses an audit trigger (`00-current-state-audit.md` section 21). |

**Three of the four are right, and the fourth is genuinely gone.** That is stated
rather than softened.

### Why losing the earlier colour is harmless

Each consumer of the effective bib was checked rather than assumed:

| Consumer | Needs history? |
|---|---|
| `tonightGroups`, the groups screen | No. It answers "how do I split these children up **now**". |
| Starting station, "your group starts at station 2" | No. The statement is spent once the carousel has run. |
| Live delivery | No. At T6 it is on a game activity and needs the current sides. |
| Game side allocation | No. It names colours and reads the current ones. |
| The generated WhatsApp message | No. It is sent **before** training, from then-current data, and re-generating after a re-bib correctly shows the new colour. |
| Session day and the one-glance overview | No. Read-only views of current state. |
| Attendance record | **Unaffected.** `present` is a separate column and a bib change does not touch it. |
| Audit and history | No, and deliberately so. 0044 refuses a per-tick audit outright. |

**Nothing in the product, built or agreed, asks "what colour were they during the
carousel?".** The bib answers "which group is this child in now", which is a
question about the present tense on a pitch, and the present tense is the only
tense a coach needs while they are standing on it.

So: **no phase-specific bib persistence, no per-player game-side row, no history
table.** Adding persistence to preserve a fact nobody reads would be the
speculative complexity principle 10 exists to refuse.

### What would change this answer

Recorded so the trade-off can be reversed knowingly rather than rediscovered:

- A post-session record of what each child actually did ("Alfie did the passing
  station with the reds"), for a coaching log or a parent report.
- Any per-child development tracking across sessions.
- A dispute about who was where, which is a safeguarding-shaped question rather
  than a coaching one.

None is on the roadmap. If one arrives, the smallest answer is **not** phase-aware
bib columns: it is an append-only record of bib changes for a session, which is
one narrow table and does not touch the operational read path at all. That is
recorded as a shape, not as work.

### The real hazard this analysis found, and it is not history

Losing the earlier colour turned out to be safe. **A different consequence of the
same overwrite is not, and it would have been easy to ship.**

`tonightGroups` returns groups sorted by the fixed bib vocabulary, which is
stable. But the **array it returns is dense over the colours actually in use**.
Re-bib the last red child to blue and the red group disappears, the array shortens
by one, and every group after it moves down an index.

If "group N starts at station N" reads that **array index**, then one child moving
silently reassigns *other* groups' starting stations, mid-session, with no
indication. If it keys on the **bib colour**, only the child who moved moves.

**Decision: the group-to-starting-station derivation keys on the bib colour, never
on a positional index into the active set.** Pinned as an acceptance test in Phase
F2 rather than left as a note, because the wrong version is the more obvious one
to write.

## 8. Training-day delivery

**Decision: overview, then station, then drill. One canonical plan behind all
three.**

```
Session day (phone)
  ├─ Tonight's groups and bibs        ← register_entries + teams.bib_colour
  ├─ Setup: stations                  ← venues.layout + the carousel block
  │     numbered station markers at their positions, tap to focus
  │     ├─ Station N                  ← the activity, its drill
  │     │     the drill diagram, large
  │     │     the objective and coaching points
  │     │     the setup notes and equipment
  │     └─ back to overview
  ├─ Transition                       ← an ordinary activity ("Reset, 5 min")
  └─ Setup: games                     ← venues.layout + the games block
        the game pitches, and which groups make up each side
```

The overview draws **areas and numbered markers at the stations' actual
positions**, not four drill diagrams shrunk to fit. That is the trap at phone
width, and drawing it this way is what makes zoom unnecessary rather than what
makes zoom essential. Pinch and pan remain available on the surface because they
cost nothing, but the design does not depend on them.

**There are two setup views, not one**, because the ground is rearranged between
them (section 7, layer 3). Each is the placements of one block's members, so the
second costs no new structure.

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
| Station block | **New**: the activities occupying the ground at one time. `{ id, kind }` only. | Block metadata |
| Rotations | **Derived**: the station count. Never the group count, never stored. | None |
| Session duration | **Unchanged.** The existing sum is already correct. | None |
| Session workflow state | **Derived**, never stored | None |
| Station group identity | **Bib colour**, unique per session. Settled. | None |
| Normal team vs tonight's bib | Already two facts: `player_registrations.team_id` and `register_entries.bib_colour_override` | None |
| Per-player ability | **Never.** Derived through the team's position in the club order. | None |
| Team ability order | **New, and the only irreducible one**: one integer per team | `teams` ordering column |
| Starting station and rotation direction | Derived, deterministic, **no configuration UI** | None |
| Suggested split | A pure function producing a draft, using the team order | None |
| Venue layout | **New**: fraction-coordinate areas, admin owned | `venues.layout` |
| Station placement | **A position** in the venue's fraction space; area derived | Activity key |
| Phase-specific setup | **Derived from a block**, not a new entity. Transition is an ordinary activity. | None |
| Game side | **A set of bib groups**, never one colour and never a player list | Block metadata |
| Moving one child between sides | **A re-bib**, confirmed by the coach. No per-player exception mechanism. | None |
| Earlier carousel colour after a re-bib | **Not recoverable, accepted.** Nothing reads it. | None |
| Starting station derivation | Keys on the **bib colour**, never an array index | None |
| Game count | An attendance-driven **recommendation**; never rewrites the plan | None |
| Training-day view | Composed from existing reads and PR #189's seam | None |
| Motion | Deferred. Additive, gated, reader-first. | Diagram schema widening |

Exact column and constraint proposals are in `04-data-model-proposal.md`.
