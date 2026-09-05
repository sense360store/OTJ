# Target product model

Status: approved product model, reconciled 18 August 2026 after the completed
coach discovery. Five slices of it are built (COACH-2A, COACH-2B, COACH-3,
COACH-4 and COACH-10, recorded in the README's Implementation status as of
2 September 2026); the rest is design. Every claim about what exists today is
carried by `00-current-state-audit.md`.

This document decides what each concept **is**: a reference, a copy, a derived
fact or stored state. It states why, and it names what needs new database
structure and what does not.

**The headline is a subtraction.** An earlier revision proposed six migrations,
station block metadata, a per-activity position in a venue coordinate space, a
frozen carousel assignment map and a generated message carrying children's first
names. All five are gone. What is left is **five columns and one small table**,
plus three keys on an activity that need no migration at all.

**Two things this revision puts back, because the first correction went too far.**
Structure was being derived from the `Phase` vocabulary, which records what kind
of drill was added rather than what part it plays on the night, so stations and
games are now declared explicitly (section 4). And the venue layout was scoped to
a venue alone, which the settled decision does not permit: it is scoped to venue,
season and age group (section 8).

---

## 1. The entity chain

```
Programme                the long-running theme, several weeks
  └─ Week plan           the reusable plan for one week: objective + drills
       └─ Session        one dated delivery, at a venue, for a set of teams
            ├─ Attendance      Spond replies, mirrored, read only
            ├─ Groups & bibs   the coach's arrangement for that night
            ├─ Games           a second, separate arrangement for the same night
            └─ Delivery        what every coach sees on their phone
```

and, crossing it:

```
Library drill            the reusable exercise
  └─ Session activity    a reference, plus a phase and a duration
       └─ Adaptation     a copy owned by the session that made it, unlisted
            └─ Visual    the diagram; optional motion, much later
```

```
Venue                    a named place
  └─ Saved layouts       4 stations, 5 stations, 1 game, 2 games
```

**Every box except the saved layouts already exists as a row.** That is the
central finding and it survived the reconciliation intact: the current data model
is much closer to the real workflow than the current user journeys are.

## 2. Programme, week plan and session are three things, not one

**Decision: keep all three. Add no new planning entity.**

| Concept | Table today | Role |
|---|---|---|
| Programme | `programmes` | The theme. Holds no drills. |
| Week plan | `templates` | The reusable plan: objective, drills, durations. |
| Session | `sessions` | One dated delivery, with a venue and covered teams. |

The temptation is to invent a "weekly plan" entity. It already exists and is
called a template. Adding a fourth row type would duplicate it.

What is missing is not an entity. It is two journeys and one word:

1. **Promote**: save the session you just planned as a week plan.
2. **Two deliveries, one plan**: apply a week plan to more than one date at once.
3. **Naming**: "template" is FA-import language. A coach plans a **week plan**.
   This is copy, not schema.

### `sessions.template_id` is dropped

The previous revision proposed one nullable column so provenance would be uniform
and two sessions sharing a plan would be visible as siblings. **It is withdrawn.**
Both journeys are copies and work without it, nothing in the settled model asks
for a sibling display, and a column with no consumer is a column that will be
read wrongly later. It is recorded in `04-data-model-proposal.md` section 9 as a
deferred option with the trigger that would revive it.

### Copy or reference, per hop

| Hop | Decision | Why |
|---|---|---|
| Programme to week plan | **Reference** (`templates.programme_id`) | A week belongs to a theme for as long as it does. |
| Week plan to session | **Copy** (already) | A dated session must not change because someone edited the plan afterwards. |
| Session to session (Tue and Sat) | **Copy** | Two deliveries are two records of two different nights and must diverge freely. |

## 3. Drill, session activity and adaptation

**Decision: a session activity stays a reference. Adapting makes a copy that
belongs to the session and is not listed in the library. Nothing is versioned.**

### Why copy, and not the alternatives

**Versioning** (a `drill_versions` table, sessions pin a version). Rejected. The
settled decision is explicit that coaches are never shown v1 and v2, and a
version graph is exactly the speculative complexity principle 10 refuses.

**A session-local overlay** inside `sessions.activities`. Rejected. The heavy
part of a drill is the diagram, so a meaningful overlay carries a diagram, and
`sessions.activities` has **no check constraint**
(`00-current-state-audit.md` section 4). That would put a second drill model in a
column with none of the guarantees `drills.diagram` earned in `0046`.

**Copy on adapt.** Accepted. "Adapt for this session" duplicates the `drills`
row, diagram included, and repoints the activity at the copy. The copy is an
ordinary drill: same table, same policies, same parser, same renderer, same
rights model, same England Football lock. The session points at exactly the row
it ran, so "what did we actually do that night?" has one unambiguous answer.

### The one problem copying creates, and its answer

**Copies must not fill the library.** Four or five stations across forty sessions
a season would otherwise put two hundred near-duplicate rows in a list a coach
browses.

**Two facts, two fields.** `drills.variant_of` records **where an adaptation came
from**, and `drills.library_listed` records **whether a drill belongs in the
library**. An adaptation is created unlisted; the library shows listed drills; an
adaptation is reachable from the session that owns it and from its parent's
detail page.

**They cannot be one field**, and the reason is the parent deletion. Deleting the
original must not delete its adaptations, so the parent link is nulled. If the
listing were derived from that link, every adaptation of a deleted drill would
appear in the library at once, without any coach asking for it, which is exactly
the clutter the settled decision forbids. Provenance is allowed to go null;
listing is not allowed to change by itself.

**Save as reusable drill creates a new library drill.** It copies the adaptation
into a new listed row. The original is never overwritten from a session
adaptation.

Neither field needs a policy: both are ordinary columns on `drills`, covered by
the four live policies, which is the reasoning `0046` used for `diagram`. The
listing rule decides what a list shows and never what anyone may read.

### What copying does not solve, stated honestly

Editing a **library** drill still changes every past session that references it
directly. Full fidelity would mean snapshotting the drill onto every session.

**Decision: do not snapshot delivered sessions. Make the edit non-silent
instead.** The drill edit form gains a line naming how many sessions reference
this drill and how many have already been delivered, with "Adapt for one session
instead" beside it. One query, no data model.

**Settled: no freeze and no snapshot system in v1** (`08-open-questions.md`).
The mechanism to change our mind exists if it is ever needed: the public share
snapshot already demonstrates freezing.

### Where the diagram lives

**On the drill, always.** `drills.diagram` is already correct: versioned,
fraction coordinates, allow-listed on read and write, pinned by a check
constraint so no client can put a person in it. A session never holds a diagram.
An adaptation holds its own because an adaptation is a drill.

## 4. Stations and games are declared on the activity, not inferred

**Decision: one new key on an activity, `slot`, with a closed vocabulary of
`'station'` and `'game'`. No station block entity, no `blocks` column, no
migration.**

### Why the phase cannot carry this

An earlier draft of this document derived the station list from the `Skill`
phase and the games from the `Game` phase. **That is wrong and it is disproved by
the code.** `phaseFor` (`src/lib/drillPicker.ts:17`) sets an activity's phase from
the drill's four-corners classification when it is added from the library:

```
physical  -> Warm-Up
social    -> Game
otherwise -> Skill
```

So the phase records **what kind of drill was added**, not what part it plays on
the night. Two consequences follow immediately:

- A physical drill is filed under Warm-Up, and it can perfectly well be one of
  the carousel stations. Deriving stations from `Skill` would silently drop it.
- A social drill is filed under Game, and that says nothing about whether it is
  one of the evening's small-sided games. Deriving games from `Game` would
  silently invent one.

The phase is also freely editable by the coach for coaching reasons that have
nothing to do with structure. **A field that means one thing cannot be read as
though it meant another**, which is the rule this codebase applies everywhere
else, and the fix is to say the structural thing explicitly.

### The shape

An activity may carry `slot`:

| `slot` | Meaning |
|---|---|
| `'station'` | **One** of the carousel stations |
| `'game'` | **The** games phase of the session |
| absent | Neither. A warm-up, a cool-down, a reset, anything the coach did not mark. |

One key, a closed two-value vocabulary, and absence is a real answer rather than
a default that had to be guessed.

**The two values are not symmetrical, and that is deliberate.** `'station'` marks
one of several activities; `'game'` marks **one** activity that is the whole games
phase. Section 4b says why, and why the number of pitches running inside it is a
separate field rather than a second activity.

**Why a single key rather than two booleans.** Two booleans admit a fourth state
that means nothing (`isStation` and `isGame` both true), and a vocabulary refuses
it by construction. `slot` also reads at the call site as what it is: which
operational slot this activity occupies on the night.

**Why `slot` and not `role` or `kind`.** `role` is RBAC in this codebase
(`profiles.role`, `roles`, `member_roles`) and would be actively misleading.
`kind` is already this repo's discriminator for diagram elements and content
shares, and putting `kind` next to `phase` on the same object invites exactly the
confusion this section exists to remove. `slot` is unused as a data key.

### Where it lives, and what it costs

`sessions.activities` and `templates.activities` are unconstrained jsonb
(`00-current-state-audit.md` section 27), so **this is not a migration**. It is
two functions:

- `toActivity` and `toActivityRow` (`src/lib/queries.ts:289`, `:296`) gain
  `slot`. A key those two do not name is dropped on read and lost on the next
  save, so this is not optional and it cannot be done in one of them.
- The key is the same word on both sides, `slot`, because it is one lowercase
  word with no case mapping, exactly as `phase` and `duration` already are.

`slot` belongs to the **plan**, so a week plan carries it and
`useStartFromTemplate`'s deep copy of the mapped activities carries it to every
dated session for free.

### Station numbering is derived and never stored

**Station N is the Nth activity carrying `slot: 'station'` that is running
tonight, in plan order.** Reordering the plan renumbers. Nothing stores a number,
because a stored number can disagree with the list it counts.

The one implementation of this lives beside the plan and every screen reads it,
which is the same rule `tonightGroups` and `sessionLifecycle` already follow.

### A plan authored before this exists declares nothing, and says so

No backfill, and nothing is inferred at read time. A session or week plan written
before `slot` existed carries none, so it has **no stations declared**, and the
setup map says exactly that with a one-press way to fix it.

**That press may be seeded by a suggestion**, including a phase-shaped hint, in
the same spirit as `phaseFor` seeding a phase when a drill is added. The
difference is the whole point: a suggestion at authoring time is confirmed by a
person and then stored, while a heuristic at read time is a guess nobody agreed
to. Only the first is allowed.

### Station count and the four or five rule

- 24 or more confirmed attending recommends 5 stations and 5 groups.
- Fewer than 24 recommends 4.
- 3 is never recommended.
- The coach may override.

**The recommendation never rewrites the plan.** Section 4a says what happens when
a five station plan is delivered as four.

### Duration is untouched, and it was already correct

Every active group completes every planned station once, so the rotation count is
the **station** count, whatever the group count is.

```
rotations        = active stations
wall clock       = minutesPerRotation x active stations
sum of durations = minutesPerRotation x active stations
```

The same expression. `sessionMinutes` (`src/lib/data.ts:539`), `plannedMinutes`
(`src/lib/sessionLifecycle.ts:150`), the derived lifecycle and `src/lib/ics.ts`
already compute it correctly, and neither the station count nor the group count
disturbs them.

**They do change in exactly one respect, stated in section 4a**: the sum runs
over the activities that are actually running, so an activity stood down for the
night is skipped. The expression is untouched. The set of members it runs over is
not.

The one residual is a planning matter rather than a model gap: stations in one
carousel move together, so they share a rotation length. Unequal member durations
describe no real session, and the answer is a planning warning, not a duration
rule.

## 4a. Five planned stations, four tonight

**Settled. The coach chooses which station is not run, and nothing is deleted.**

**Decision: a second key on the activity, `skipped`, written only as `true`,
session-local and reversible. No migration.**

| State | Representation |
|---|---|
| Running tonight | `skipped` absent |
| Stood down tonight | `skipped: true` |
| Restored | the key is removed again |

**Absence must mean running**, which is what decides the sense of the key. Every
activity in every existing session carries nothing, and every one of them runs.
A positively-phrased key would read every existing plan as entirely stood down.
So the key names the exception, `false` is never written, and there is exactly
one representation of each state.

**What it does not touch**, which is the whole requirement:

- The activity **stays in the dated session's plan**, in its place and with its
  duration. Nothing is removed.
- **The week plan is unchanged.** A template never carries `skipped`, and
  section 4c says by what mechanism, because the mappers alone cannot deliver it.
  Ignoring it on a template fails towards running the drill, which is the safe
  direction.
- **The library drill is unchanged.** `skipped` is a fact about one activity on
  one night.
- It is **reversible on one press**, so a coach who stands a drill down on
  Thursday and gets four more confirmations on Friday restores it.

**It applies to any activity carrying a `slot`.** A station stood down is the
ordinary case; a coach who decides there are no games tonight stands the games
activity down the same way. The reader ignores it on an activity with no `slot`,
so a stray value can neither hide a warm-up nor a cool-down.

**"Active" therefore means "carries a `slot` and is not stood down"**, and it is
the only sense in which the station list, the station count and the games phase
are read.

**Station numbering for the night uses only the active stations**, in plan order.
A stood-down station keeps its place in the plan, takes no number, and is shown
as not running tonight rather than hidden.

### A stood-down activity does not count towards the session's length

**This is the one place the programme changes existing behaviour, and it reaches
FOUR independent implementations, not two.**

Rotations follow the **active** stations, so a five station plan delivered as
four runs four rotations, not five. If the stood-down activity's duration still
counted, the planner, the expected end and the calendar export would all overstate
the night by one rotation. The same applies to a stood-down games phase.

### The rule

**An activity stops contributing to the session's length only when it is an
operational activity that has been stood down.** Precisely:

| Activity | Counts? |
|---|---|
| No `skipped` key | **Yes.** Current behaviour, bit for bit |
| `slot` absent, stray `skipped: true` | **Yes.** A warm-up or cool-down is not operational and cannot be stood down |
| `slot: 'station'` + `skipped: true` | No |
| `slot: 'game'` + `skipped: true` | No |

The `slot` qualifier is not optional wording. Without it a stray key removes a
warm-up's minutes, which is exactly what the reader is promised cannot happen.

### Every implementation that must honour it

`00-current-state-audit.md` section 17 carries the re-derived inventory. Four
independent implementations sum **session** activities:

| # | Where | Note |
|---|---|---|
| 1 | `sessionMinutes`, `src/lib/data.ts:539` | Six session surfaces inherit through it |
| 2 | `plannedMinutes`, `src/lib/sessionLifecycle.ts:150` | The expected end and the calendar `DTEND` inherit through it |
| 3 | `src/routes/Planner.tsx:733` | **Inline. Planner.tsx does not import `sessionMinutes`** |
| 4 | `buildSessionSnapshot`, `supabase/functions/_shared/share.ts` | **Deno.** A different runtime, not a call site |

So the ordinary five-planned, four-running night must show the shorter total in
the planner, move the derived expected finish earlier, shorten the calendar
duration, and produce the matching duration in a public snapshot. Changing only
the two named functions leaves the planner's own "min total" headline overstating
the night on the very screen where the coach stands the station down.

**Centralise where practical, but do not assume one helper reaches all four.**
The browser three can share one predicate. `share.ts` runs in Supabase Edge
Functions and cannot import from `src/lib/`, so it needs the same rule expressed
in its own runtime, and that is a duplication to state openly rather than to
paper over.

### Zero is a real answer

`plannedMinutes` is **not** the same expression as the other three:

```
return total > 0 ? total : FALLBACK_SESSION_MINUTES
```

Its comment says *"an empty plan is a session nobody has built yet, not a session
that lasts no time"*, which is correct **today**, when a zero total can only mean
an empty plan. Once a filter can empty the sum, that reading is wrong: a session
whose every operational activity is stood down would become a synthetic 90 minute
session, lengthening the night the rule exists to shorten.

**The correction: a plan that holds activities and stands all the operational
ones down is a real zero and renders as one.** This section first said the
fallback should apply when there are no activities to sum. That mechanism was
rejected at implementation, because it also swallows a plan whose durations are
zero, absent, null or NaN, and such a session would end at its own start
instant. Zero reaches the function two ways and they are opposite facts, so the
shipped rule keys on which one happened: something stood down is a real zero,
nothing stood down is the plan nobody filled in that the fallback has always
covered. `04-data-model-proposal.md` section 2 carries the reasoning.

**It is inert until someone stands something down.** No existing session carries
`skipped`, so every total in the database today is unchanged, and the derived
lifecycle places every existing session exactly where it places it now. That is
what keeps the risk of touching code this widely read to a minimum.

**This does not reopen the parallel-station arithmetic**, which is still correct:
active stations times the rotation length is still both the wall clock and the
sum of the active members' durations. What changes is only which members are
summed.

**OTJ never chooses.** The recommendation names a count and says which count the
plan holds. Which drill sits out is a person's decision, every time.

## 4b. The games phase is one activity, and `gameCount` says how many pitches

**Settled, and it corrects a real defect in the previous revision, which let the
number of simultaneous games be represented by two `slot: 'game'` activities.**

### Why two activities would break the session's own arithmetic

Activities in this product are **sequential and their durations are summed**.
`sessionMinutes` (`src/lib/data.ts:539`) adds every activity's duration,
`plannedMinutes` (`src/lib/sessionLifecycle.ts:150`) reimplements the same sum
behind the derived lifecycle, `src/lib/ics.ts` takes the calendar length from the
same seam, and `LiveSession.tsx` walks the list one activity at a time.

Two pitches running **at the same time** are not two activities. Modelling them
as two would:

- **double the games phase in the session total.** Two 15 minute game activities
  read as 30 minutes of football that never happens, which is wrong on the
  planner, wrong in the derived lifecycle, and wrong in the calendar export.
- **push the session's expected end out**, which is exactly the class of defect
  `sessionLifecycle` exists to prevent.
- **make Live show two game steps in series**, when the coach runs one.

### The shape

**One activity carries `slot: 'game'`. Its duration is the duration of the whole
games phase. How many pitches run inside that phase is a separate field:**

```
Activity      gameCount?: 1 | 2
ActivityRow   game_count?: 1 | 2
```

| Rule | |
|---|---|
| Meaningful only on | `slot: 'game'` |
| Scope | **Session local**, like `skipped` |
| Templates | The two write paths strip it; the reader ignores it on a template |
| Absence means | The operational game count **has not been accepted yet** |
| v1 expects | **At most one active `slot: 'game'` activity** per session |

**It is session local for a stated reason.** How many pitches go out depends on
who confirmed, which is an operational fact 24 to 48 hours out. A week plan
authored in June must not carry a commitment to two games in September, so the
key never reaches `templates` and a plan applied to two dates arrives with the
count unaccepted on both.

**The case mapping is real here**, unlike `slot` and `skipped`: `gameCount` in
the client model, `game_count` in the stored row, which is the ordinary
`drillId`/`drill_id` convention. Both mappers name it or it is lost.

### Recommendation, acceptance and override

- **12 or fewer confirmed Yes recommends `gameCount = 1`. 13 or more recommends
  `2`.** The threshold follows from a 6v6 target, since a thirteenth child in one
  game means a 7v7.
- **A recommendation is not an acceptance.** Nothing is written until the coach
  accepts it or picks the other, which is the same rule as every other Players
  and groups edit.
- **The coach may override**, and an override is just an accepted value the
  recommendation disagrees with.
- **An accepted `gameCount` is never silently rewritten because attendance
  changed.** The screen says what the new attendance would recommend and leaves
  the decision where it belongs. This is the same rule that protects a saved
  group setup.

### What reads it

| Consumer | Use |
|---|---|
| Venue game layout | `gameCount` **is** the `slots` of the games layout: 1 loads the one game layout, 2 loads the two game layout. |
| Game colours | 1 takes the first two planned colours as game 1 A and B; 2 takes the first four as game 1 A/B and game 2 A/B. |
| Player allocation | The suggested sides are built for that many games. |
| Readiness | An unaccepted count is a named gap, not a default. |

**Nothing counts activities to learn how many games there are.** The count is one
field on one activity, and a plan that somehow carries two `slot: 'game'`
activities is a planning problem the screen names rather than silently resolving
by picking the first. It blocks nothing: the rest of the session is unaffected.

### What this does not add

- **No second game activity** to represent a second pitch.
- **No per-player game number** and **no per-player side column**.
- **No stored game colour map.** The ordering is a pure function of the fixed
  vocabulary and `gameCount`.
- **No _further_ change to `sessionMinutes`, `plannedMinutes`, `src/lib/ics.ts`,
  the derived lifecycle or Live's sequential semantics.** One games phase is one
  activity with one duration, which is what all five already assume. The single
  change this programme makes to them belongs to `skipped` (section 4a), and a
  games phase stood down is skipped by that same rule.

## 4c. Session-local keys, and the mechanism that actually makes them so

**Added after review pointed out that the mappers alone cannot deliver this.**

Two of the three activity keys are session local: **`skipped`** and
**`gameCount`**. `slot` is not, because it belongs to the plan.

The obvious reading of "the template write paths strip it" was that
`toActivityRow` does the stripping. **It cannot.** Both template and session
reads call the same `toActivity`, and all three write paths call the same
`toActivityRow` (`00-current-state-audit.md` section 27). A shared mapper has no
idea which side of the fence it is on, so adding a key to it preserves that key
for templates too, and omitting it loses the key from sessions.

**So the contract has three parts, and the mappers are only one of them:**

| Part | Who does it |
|---|---|
| Carry all three keys faithfully | `toActivity` and `toActivityRow`, shared and context free |
| Remove the session-local keys on the way into a template | **One named helper**, called by the two template write paths (`src/lib/queries.ts:1579`, `:1826`) |
| Ignore the session-local keys on the way out of a template | The same helper, applied to the template read (`:385`) |

**Both ends, deliberately.** Stripping on write is what keeps templates clean
going forward; ignoring on read is what makes a row that predates the helper, or
one written by some future hand-rolled call, behave correctly anyway. Neither end
depends on the other being right, which is the same belt-and-braces shape
`0048`'s constraint and its client-side recognition already use.

**One helper for both keys**, not one per key, so a fourth session-local key
later joins a list rather than growing a third code path.

**A template that somehow carries one is read as if it did not**, which fails
towards running the drill and towards an unaccepted game count. Both are the safe
direction.

## 5. Session lifecycle: derive, do not store

**Decision: add no stored workflow states. Derive readiness.**

| Question | Derived from |
|---|---|
| Planned? | `activities.length > 0`. **If any station is declared**, four or five of them are active. A session that declares none is not a carousel night and is not asked to be. |
| Attendance context available? | Whether an external RSVP fact exists at all: `spond_event_id` set and responses known. **No is a real answer and not a failure** — section 6.4 states what the recommendation runs from instead. |
| Groups prepared? | every included player resolves to a bib, and the active groups' colours are unique |
| Games prepared? | **Not applicable** when no games activity is declared, or its activity is stood down. Otherwise: an accepted `gameCount`, and every included player resolving to **a game, a side, and a valid game-side colour**. All three, because a player can hold a colour that names no side. |
| Setup available? | a layout exists for this session's venue, season, age group and **active** slot count. Section 8 names the five no-layout states, and this row uses those names rather than counting them again. |
| Delivered? | `sessionLifecycle.ts` already answers this, three states, derived |

**Not applicable is a real answer, and it is not the same as not ready.** A
session with no games declared is not an unfinished session, and saying so is the
same discipline as absence being a real answer everywhere else in this model.

**Not ready is never blocked.** None of these gates opening, editing or running a
session. `sessionLifecycle.ts` exists precisely because a stored flag
(`sessions.status`) went stale and left yesterday's training on the front page.

## 6. Groups, bibs and rotation

### 6.1 The identity of a station group is its bib colour

Active station groups have **unique** bib colours within a session. There is no
Group entity and no `group_id`, because a group is emergent from per-player bib
resolution and there is no row a unique index could sit on.

**"No bibs" is not a valid group.** An included player with no effective bib is a
readiness failure with the fix named beside it, never a silent merge into a
bibless group, which is what `tonightGroups` does today
(`00-current-state-audit.md` finding 2).

### 6.2 Colours are assigned in a fixed order, and the assignment is derived

**The colour vocabulary is a fixed ordered list of nine**, `BIB_COLOURS` in
`src/lib/bibs.ts`, mirrored by `public.is_bib_colour` which is the authority.

**The rule: take the active bib colours, order them by the fixed vocabulary
order, and assign them sequentially to Station 1, Station 2 and so on.** The
first active colour is group 1 and starts at station 1.

Three things this rule is deliberately not:

- **Not a permanent global colour to station map.** The order is over the colours
  in use this session, not a claim that red is always station 1.
- **Not a persisted index.** Nothing is stored. It is recomputed on every read
  from the saved group setup.
- **Not stable against a group being removed**, and that no longer matters. The
  previous revision proved that no stateless rule can be both unique and stable,
  and concluded that the assignment must be derived once and frozen at carousel
  start inside a stored map. **That whole mechanism is removed.** It only ever
  existed to protect a running carousel from moving underneath a coach, and OTJ
  now tracks no running carousel. Before training, a changed group setup restating
  the plan is what a plan should do. During training, the coach is looking at
  cones and children, not at OTJ.

The arithmetic that produced the proof is still true and is still recorded in
`00-current-state-audit.md` section 22 as a fact about the vocabulary. What is
removed is the conclusion drawn from it.

### 6.3 Two durable facts and two temporary ones

| | What it is | Where it lives | Changes when |
|---|---|---|---|
| **Normal team** | The durable player to team relationship, mirrored from Spond | `player_registrations.team_id`, per season | A child moves team |
| **Team ability order** | The club's ordering of its own teams | **Nothing today.** See 6.5 | The club re-bands, typically per season |
| **Tonight's station bib** | The group for the carousel | `register_entries.bib_colour_override`, else the team default | The coach moves someone for one night |
| **Tonight's game bib** | The bib for the games, a separate fact | **Nothing today.** See section 7 | The coach re-bibs for the games |

**The session-only override already works.** `register_entries.bib_colour_override`
is keyed on `(session_id, player_id)`, writes nothing back to `players`,
`player_registrations` or `teams`, and resolves through `effectiveBib` as
override, then team default, then none. Moving a child into a different group
tonight cannot touch their Spond team, their OTJ team or their default next week,
and the schema is what guarantees that rather than a rule anyone has to remember.

### 6.4 Generating the setup, and keeping the coach's work

**OTJ generates the first suggested setup automatically from the expected
attendance**, about 24 to 48 hours out.

#### Three different facts, defined once

Every recommendation in this product (4 or 5 stations, 1 or 2 games, the groups
themselves) runs off **one** number: how many children are expected. That number
is established by one rule, stated here and used nowhere else in a second form.

| Fact | What it is |
|---|---|
| **RSVP state** | What a parent answered on Spond for one child on one event: accepted, declined, unanswered, waiting |
| **RSVP context availability** | Whether an external RSVP fact exists **at all** for this session. A session with no `spond_event_id`, an unsettled read, or a failed sync all have none |
| **OTJ operational inclusion** | Who the coach has put in tonight's groups, in `register_entries.included_in_groups`. The coach's own record, and the only one that drives the night |

**A player with no Spond link is not a fourth RSVP answer.** It means there is no
external RSVP fact for that player. They are not "unanswered", because nobody was
asked.

#### The one rule

**With RSVP context**, the expected count is the covered players whose RSVP state
is accepted. Declined and unanswered do not count, and that is the settled
decision.

**Without RSVP context**, the expected count is the coach's own included roster
on this session. Absence of Spond data **never** means nobody is attending, and a
failed or missing integration must never produce a zero-player recommendation. A
club that has never configured Spond gets the whole surface: the roster the
session covers, the coach's inclusion ticks, and the same 4/5 station and 1/2
game recommendations running off that local roster.

**Neither branch is a degraded mode.** They are the same recommendation over two
ways of learning the same number, and the screen says which one it used so the
coach can see why it said five.

Priority when building groups:

1. Preserve normal team continuity as far as practical.
2. Combine **adjacent** ability bands when combining is necessary.
3. Keep numbers sensible.
4. Prefer slightly uneven groups over unnecessarily splitting a normal team.
   6/5/5/4 beats 5/5/5/5 bought by breaking up two squads.

**When attendance changes before training, the saved setup is not thrown away:**

- children no longer attending are removed
- newly confirmed children are added sensibly
- **every assignment already saved is preserved**
- rebalancing happens only where it is necessary
- nothing wipes the setup and regenerates by default

**No provenance column is needed to do that**, which is worth stating because it
is the obvious place a schema addition would creep in. The rule is not "preserve
the manual ones", it is **"preserve all of them"**: whatever is saved is the
coach's, whoever put it there. A generator that only fills the gaps needs to know
nothing about who filled the rest.

**A deliberate Reset or Rebuild that regenerates from scratch is a later
addition**, and it is the only path by which a saved setup is discarded.

The output is a **draft the coach edits**. It writes nothing until Save groups,
which is the existing Players and groups rule and is not being changed.

### 6.5 The team ability order, the one thing that must be stored

**Built since, by COACH-1 (#223, #226 and the COACH-1B frontend PR).** `teams`
now carries `sort_order` (migration `0051_team_sort_order`, applied 2 September
2026), `public.set_team_order` writes a whole order atomically (migration
`0052_atomic_team_order`, applied 4 September 2026), and the Teams admin screen
sets the order through one call to it. The paragraph below is what was captured
when this was written.

Verified against the schema then (`00-current-state-audit.md` section 19):
`teams` carried `id, club_id, name, created_at, bib_colour` and nothing else,
and every team order in the product was alphabetical, which for this club
matches the ability order nowhere. There was no `sort_order`, `position`,
`rank` or `ability` column on any table, and `created_at` records when a row
was inserted during setup rather than anything about football.

So this is the programme's one irreducible new fact, and it is deliberately the
smallest possible: **one integer per team**, five rows for this club, set by a
`teams.manage` holder on the existing admin screen.

It is **not an ability score**. A player's ability context is derived:
`player -> current registration -> team -> that team's position`. No per-player
field exists or is proposed, and creating one would be a second answer that can
drift from the first.

**No literal team name appears in any rule.** Titans, Trojans, Gladiators,
Spartans and Argonauts are this season's contents of an ordered set.

Two orders coexist and must not be confused: **alphabetical for labels** (what
`sessionTeamsLabel` does today, unchanged) and **club order for grouping**.

### 6.6 Rotation

**Clockwise, always, and not configurable in v1.** The setup overview carries a
subtle clockwise cue. Coaches keep track of the rotation themselves.

**OTJ tracks no rotation state.** Previous station and Next station are browsing
the drills and must never read as advancing a live session.

**The existing live session view is out of scope for this programme and is
unchanged.** The previous revision proposed rebuilding it as a rotation engine
with one timer per rotation and a Rotate cue. That is withdrawn: it is live
administration, which the settled philosophy removes.

## 7. Games are a separate allocation with a separate bib

**The games phase is the one activity carrying `slot: 'game'`, and `gameCount`
says whether one or two pitches run inside it** (sections 4 and 4b). Neither is
inferred from the `Game` phase, for the reason section 4 gives: the phase records
that a social drill was added, not what part it plays on the night. Nothing counts
activities to learn how many games there are.

**Decision: one new column, `register_entries.game_bib_colour_override`. No
per-player game number, no per-player side, and no session-level colour map.**

### Why the station bib cannot carry both

**Today** `register_entries` holds one row per `(session_id, player_id)` with a
single `bib_colour_override`, written through
`upsert(..., { onConflict: 'session_id,player_id' })`, so a second bib for the
same player in the same session **replaces the first**
(`00-current-state-audit.md` section 21). There is no per-field timestamp, no
prior value, and 0044's self-verification refuses a per-tick audit trigger, so
nothing can reconstruct it either.

The settled model requires the two to coexist: the station bib plan must survive
the games being planned with different bibs, some players are re-bibbed for the
games, and the game plan names each player's side and colour beside the station
groups. One column cannot hold two independent values.

**This is the same defect 0047 already fixed once, on this table.** `present`
carried both attendance and inclusion, a coach who split fourteen of the eighteen
who came had four children recorded absent, and the answer was a second column
that copies nothing from the first.

### How it resolves

```
station bib = station override, else the team default, else none
game bib    = game override,    else the effective station bib
```

The second line is the physical truth: bibs are handed out only to the children
who change. `src/lib/bibs.ts` owns both rules and no screen resolves a bib itself.

### Game and side are derived from the planned colour ordering

**Decision: deterministic, from the club's fixed `BIB_COLOURS` order. Nothing
about the mapping is stored.**

Take the first `2 x gameCount` colours of the fixed vocabulary order that are
available for the games, and read them in order:

```
gameCount = 1     index 0 -> game 1, side A
                  index 1 -> game 1, side B

gameCount = 2     index 0 -> game 1, side A
                  index 1 -> game 1, side B
                  index 2 -> game 2, side A
                  index 3 -> game 2, side B
```

So a child's game bib colour resolves to a game and a side by its position in
that ordered list, and:

- **each game gets two distinguishable colours**, because its two sides take two
  distinct entries;
- **two games use four distinguishable colours** where the vocabulary allows,
  because the list is taken in order without repetition;
- **the UI offers only the colours in that list**, so a colour outside it is not
  reachable through the product at all.

**`gameCount` is the only input to the ordering besides the fixed vocabulary.**
With no accepted count there is no ordering, so there are no game colours to
offer and readiness says the count is not settled.

### The allocation order, which is the part that decides everything

**Settled priority, in this order: sensible game size, then ability banding, then
minimising bib changes. Station-group preservation does NOT outrank banding.**

An earlier revision said the allocation *"writes a game bib for every player whose
station colour is not a game colour"*. That is insufficient and it contradicts the
banding rule beside it. With five groups and `gameCount = 2` it re-bibs only the
fifth group, leaving games 1 and 2 as station groups 1+2 and 3+4 — the station
groups preserved wholesale, which is the opposite of what banding requires. Four
station colours can already sit in the games palette while those very players
belong in different games or on different sides.

**Game and side are decided FIRST, from players. Colour is chosen SECOND, from
the decision.** Never the other way round.

**Step 1, assign each included player to a game.** For `gameCount = 2`, start
from the club's ordered teams: the upper bands form the stronger game's
population, the lower bands the development game's, and the middle band is the
flexible bridge, split between the two wherever that is what produces sensible
numbers. **Sensible game size outranks keeping station groups intact.** For
`gameCount = 1` there is one game and this step is trivial.

**Step 2, split each game into two sides.** Balance player count and ability
within that game's own population, and deliberately avoid turning the ordered
bands into two opposing blocs. For `gameCount = 1` this is where the ability
balance happens: distribute the stronger players across both sides rather than
stacking one.

**Step 3, and only now, choose colours.** The player's game and side select the
deterministic game-side colour from the ordering below. Then compare it with the
player's **effective station bib**:

| Comparison | Write |
|---|---|
| Target game-side colour **equals** the effective station bib | Nothing. `game_bib_colour_override` stays null |
| They **differ** | Write `game_bib_colour_override` to the target game-side colour |

**So the fallback to the station bib means exactly one thing:** *this player's
existing station bib already happens to be the colour of the side they were
assigned to.* It must never be read as *any station colour that appears somewhere
in the four-colour games palette is that player's game assignment.* Those are
different statements and only the first is true.

That also makes the minimise-bib-changes priority real rather than rhetorical: it
is the tie-break inside steps 1 and 2, applied only where game size and banding
leave a genuine choice, and it is never allowed to move a player into the wrong
game or onto the wrong side.

A value outside the list resolves to **no game** and is shown as unassigned, and
readiness names it. It is never guessed into the nearest game.

**No session-level colour map is stored**, and none is proposed. The ordering is
a pure function of the fixed vocabulary and the game count, both of which every
reader already has. A stored map would be a second fact that can disagree with
the bib a child is actually wearing, which is the failure this model avoids
everywhere else. If implementation evidence ever proves the deterministic rule
cannot work, that is the moment to revisit it, and not before.

### Game count and banding

- **12 or fewer confirmed recommends `gameCount = 1`. 13 or more recommends
  `2`.** The coach may override, and an accepted count is never silently
  rewritten because attendance changed (section 4b). The threshold follows from a
  6v6 target, since a thirteenth child in one game means a 7v7.
- **Two games** start from the club's ordered teams: upper teams form the
  stronger game, lower teams the development game, and the middle band is the
  flexible bridge whose players may be split between the two to make sensible
  numbers. **Sensible game size comes before preserving station bib groups.**
- **One game** balances the two sides by ability, distributing players from the
  stronger teams across both sides rather than keeping the bands as opposing
  blocs. Expected to be relatively rare.
- The thresholds are **not policy**. They live in one named, adjustable place
  with the reasoning beside them, and they produce a sentence, never a change.

**A previously documented rule is reversed here and must not survive anywhere.**
The earlier model said a game side may wear two bib colours and that forcing a
redistribution was unnecessary kit churn. The settled decision is the opposite:
each game gets two clearly distinguishable colours where possible, and re-bibbing
for the games is expected. The station bib plan is protected by the second
column, not by refusing to re-bib.

**Physical changes on the pitch are not persisted.** A coach who swaps two
children mid-game does not open their phone, and nothing in this model expects
them to.

## 8. Venue layouts, scoped to venue, season and age group

**Decision: one new table, `venue_layouts`, keyed on
`(club_id, venue_id, season_id, age_group, kind, slots)`. Admin owned, loaded
automatically, and a session stores no geometry.**

**This replaces two earlier proposals.** The first put a fraction-coordinate
position on every station activity with a weekly drag and drop composer, and that
is removed: weekly coaches place nothing. The second put a single `layout` jsonb
column on `venues`, and that is removed too, because it cannot express the scope
the product actually requires.

### The scope is venue, season and age group

Settled in coach discovery, and it is not negotiable down to venue-only:

- **Venue.** The ground is different at Haggs Hill, Flushdyke and Woodkirk.
- **Season.** The club's allocation at a venue changes between seasons, and the
  physical layout is expected to stay stable **through** a season. That is the
  whole reason the scope exists.
- **Age group.** Two age groups at one venue are allocated different areas and
  set up differently.

It is deliberately **not per team**. A team is a filter and a default, never a
unit of ground.

Within one scope the admin saves exactly four layouts:

| `kind` | `slots` |
|---|---|
| `stations` | 4 |
| `stations` | 5 |
| `games` | 1 |
| `games` | 2 |

### Why a table rather than a jsonb column on `venues`

The previous revision argued for a column, on the ground that an ordinary column
on `venues` inherits its club-wide read and `club.manage` write with no new
policy. **That argument is correct and it is outranked by the scope.**

- **A season is a row, not a string.** `seasons` exists (`0031_seasons.sql`) and
  carries `seasons_id_club_unique (id, club_id)`, so a club-scoped composite
  foreign key to it is available. Embedding a season id inside a jsonb blob
  throws that away and makes the reference unenforceable.
- **A column grows without bound.** One row per venue holding every season's and
  every age group's layouts is a blob that only ever accumulates, edited by
  read-modify-write, where two admins editing two different age groups on one
  evening overwrite each other.
- **A row per layout is the natural unit of editing**, of deletion, and of the
  unique key that makes "one 5 station layout per scope" a database fact.

At this club the table holds four rows per venue per age group per season. Three
venues and one age group is twelve rows a season.

### The shape

```
venue_layouts
  id          uuid primary key
  club_id     uuid not null -> clubs
  venue_id    uuid not null            (venue_id, club_id) -> venues on delete cascade
  season_id   uuid not null            (season_id, club_id) -> seasons on delete restrict
  age_group   text not null            bounded, non blank
  kind        text not null            check in ('stations', 'games')
  slots       integer not null         check: stations in (4,5), games in (1,2)
  zones       jsonb not null           versioned, allow-listed, fraction coordinates
  created_at  timestamptz not null
  unique (club_id, venue_id, season_id, age_group, kind, slots)
```

`zones` is an ordered list of named rectangles in **fraction coordinates, 0 to
1**, the same space `drills.diagram` and `boards.tokens` use, with a check
constraint stating the key allow-list exactly as `0046` does. A station zone is
numbered and means "the area normally allocated to Station N"; a game zone is
where that game is played. One shape serves both kinds.

`on delete restrict` on the season mirrors how `player_registrations` references
seasons: a season that has layouts is not silently deletable, and `seasons` has
no client delete path anyway. `on delete cascade` on the venue is right, because
a deleted venue's ground is not a thing any more.

**There is no `created_by`, `updated_by` or `updated_at`**, because `venues` has
none of them and states why: club configuration with no ownership concept, and
the audit trail already records who. `04-data-model-proposal.md` section 3 gives
the full reasoning. No client-writable accountability field remains, so there is
nothing to forge.

Exact SQL, constraints, RLS and audit are in `04-data-model-proposal.md`
section 3.

### How a session finds its layout

The session supplies the venue, the age group and the station count; the season
is derived.

- **Venue**: `sessions.venue_id`.
- **Age group**: `sessions.age_group`.
- **Station count**: the number of active stations in the plan (section 4).
- **Season**: derived from `sessions.date` against `seasons.starts_on` and
  `seasons.ends_on`, and it **fails closed**:

| Seasons containing the date | Result |
|---|---|
| Exactly one | That season. |
| Zero | **Unresolved.** No layout, and the screen says the session's date falls in no season. |
| More than one | **Ambiguous.** No layout, and the screen says the date falls in more than one. |

**There is no fallback to the current season, in either failing branch.** An
earlier draft fell back when zero matched, and a later one kept a narrower
tie-break when more than one did. Both are removed: a season that does not
contain the date is a different season, and picking one to fill a gap is the
confident wrong answer this codebase refuses everywhere else. A 2025 session must
never load the 2026/27 allocation.

**`seasons.is_current` may still be a default when an admin starts drawing a
layout**, because that is a person choosing a scope with the answer in front of
them. It never resolves an existing dated session.

That "refuse to guess when zero or more than one matches" shape is the rule
`matchVenueByLocation` (`src/lib/venues.ts:96`) already applies to venue
matching, and it is now applied faithfully rather than partially.

**`sessions` gains no `season_id`.** A stored season would be a second fact that
can disagree with the date, and the derivation costs one comparison against rows
the screen has already read.

### Two honest gaps, both named rather than hidden

- **Season overlap is unconstrained** by design (`0031`), so a date can fall in
  two seasons. That is a configuration problem with a person's answer, so the
  screen names it and loads nothing rather than picking one.
- **Age group is a free text string, and the club has no canonical list at all.**
  `clubs` carries no age group column; the `age_groups text[]` that exists is on
  `profiles`, where it is one coach's personal preference and cannot define a club
  level scope key (`00-current-state-audit.md` section 26). Two hardcoded literals
  stand in for it today and they disagree: `['U6s' … 'U12s']` in the planner and
  `['U6' … 'U12']` in `AGES`. A scope key is only as good as the vocabulary behind
  it, so **COACH-5 adds `clubs.age_groups text[] not null default '{}'`**, admin
  managed, and both the layout admin screen and the session's age group control
  read it. That is a migration, not client work. No historical
  `sessions.age_group` value is rewritten.

### What a layout is not

- **Not a footprint.** A station zone is an allocation that stays familiar week
  to week, not the exact geometry of this week's drill.
- **Not imagery.** A clean schematic. No satellite tiles, no traced photograph,
  no map reference, no coordinates, no address. The allow-list makes each
  unrepresentable rather than discouraged.
- **Not weekly.** Coaches do not drag or reposition anything in v1.

### The five no-layout states, named once

**A layout can honestly not be found in exactly five ways.** They are one closed
vocabulary, used by every document and every screen that reports one, so nobody
counts them again and arrives at a different number. Only two are an admin's to
fix.

| State | What it means | Fixable by |
|---|---|---|
| **No venue** | The session names no venue, so there is no ground to lay out | **The coach**, by choosing a venue |
| **No age group** | `sessions.age_group` is nullable free text and can be empty, and the scope key cannot be assembled without it | **The coach**, by setting the age group |
| **Season unresolved or ambiguous** | The date falls in no season, or in more than one | **An admin**, by fixing the season configuration |
| **No layout drawn for this scope** | Venue, season and age group all resolved, and nobody has drawn this slot count | **An admin**, with a link |
| **Slot count outside the stored set** | Fewer than four active stations, or more than five | **Nobody.** `venue_layouts` stores 4 and 5 stations and 1 and 2 games, so no layout exists to draw |

**The last one matters because the obvious message is wrong.** A coach who stands
two of five stations down has three active, and telling them to ask an admin to
draw a three station layout points at something the check constraint refuses. The
screen says the delivery has dropped outside the shape v1 supports instead. It is
stated as a slot count rather than as "fewer than four" so a six station plan
lands on the same honest message rather than on the admin link.

**Every one of these is a sentence, never a blank panel**, and none of them
blocks opening, editing or running the session.


## 9. Training-day delivery

**Decision: setup map, then station detail, then back. One canonical plan behind
both, and nothing on the screen implies OTJ knows where the session has got to.**

```
Session day (phone)
  ├─ Tonight's groups and bibs        <- register_entries + teams.bib_colour
  ├─ Setup: stations                  <- the venue's layout for this station count
  │     numbered zones with a clockwise cue, tap to open
  │     └─ Station N                  <- the activity, its drill
  │           station number, drill name
  │           the drill diagram, large
  │           the objective
  │           two or three coaching points
  │           Previous station / Next station / Back to setup map
  ├─ Setup: games                     <- the venue's layout for this game count
  │     which named players and bibs are on each side
  └─ Share                            <- the protected session link, already built
```

**A station zone shows useful overview information, not a drill diagram shrunk to
fit.** That is the trap at 390 pixels wide, and drawing it this way is what makes
zoom unnecessary rather than what makes zoom essential. Pinch and pan remain
available and are load-bearing for nothing.

**Equipment is not on the station detail screen.** Equipment is dealt with during
setup, and the screen a coach reads while coaching carries only what they need
while coaching.

**Previous and Next are browsing.** No progress, no current station, no rotation
state. The clockwise cue tells a coach which way to move their group; they keep
track of it themselves.

Everything on this screen comes from rows the coach is already authorised to
read. There is no new payload, no new read path and no new permission.

The diagram half is already built. `ActivityDiagram` and `DrillDiagramView` are
merged and already render a saved diagram on session day and in the planner
(`00-current-state-audit.md` section 18), so the station detail screen is a
layout around an existing seam rather than a new rendering path.

## 10. One authoring seam, two hosts

**Today, as audited,** the planner and `TemplateFormModal` each maintained their
own activity list, add bar, custom activity literal and row component
(`00-current-state-audit.md` section 9). **Built since, in COACH-10 (#207):**
both hosts now mount one `ActivityListEditor`
(`src/components/ActivityListEditor.tsx`), which is the seam this section
decides on. Long range planning happens in the week plan editor, weeks before a
dated session exists.

**Decision: authoring improvements go into one shared seam used by both hosts,
never into the planner alone.** The seam owns the activity list and its
affordances: add from library, add custom, new drill, draw it, adapt for this
session, reorder, phase and duration. Its hosts supply what genuinely differs.

Building a feature in the dated planner first and porting it afterwards would
make a two-way divergence into a three-way one and would leave the surface where
long range planning happens as the last to receive it.

## 11. Sharing

**Decision: coach to coach, through the protected canonical link, using the
platform share sheet. Nothing new is published and nothing new is built.**

**Today** this already works (`00-current-state-audit.md` section 24).
`src/lib/share.ts` builds `origin + /session-day/:id` with no token, no query
secret and no anonymous route, feature-detects `navigator.share`, falls back to
the clipboard, and reports a deterministic result. The internal arm of
`ShareModal` passes only the session name as the title and text. The recipient
signs in, and Row Level Security stays the only boundary.

That is exactly what the settled decision asks for, so the work is a check rather
than a build:

- keep the share reachable from the delivery surface
- pin the payload with a test asserting it carries no player name, bib, group or
  game data
- no WhatsApp specific integration, ever

**Nothing operational is exposed through a public or login-free share.** The
public share substrate stays as it is, its deny lists stay in step, and no phase
of this programme reads or writes one. `05-security-share-boundary.md` carries
the analysis, including the generated-message design that is now withdrawn.

## 12. Motion

**Decision: last, and only if the static workflow is proven in use.**

If it happens, the shape is an optional motion track expressed as a small number
of keyframes per element, with play, pause and restart. Not a timeline editor.

Two hard constraints, from `00-current-state-audit.md` section 7:

1. `drills.diagram` has a **check constraint stating the element key
   allow-list**. Any new key or element type is a gated migration.
2. The parser **discards a diagram whose version it does not recognise**. A
   client that can read version 2 must be deployed everywhere **before** anything
   writes version 2. Reader first, writer second, two releases.

## 13. Decision summary

| Concept | Decision | New structure |
|---|---|---|
| Programme | Keep. Reference from week plans. | None |
| Week plan (template) | Keep. Rename in copy. Add promote and multi-date apply. | None |
| Session from week plan | Copy, as today | **None.** `template_id` dropped |
| Session activity to drill | Reference, as today | None |
| Adapting a drill | **Copy**, owned by the session, **not listed in the library** | `drills.variant_of` plus `drills.library_listed` |
| Deleting an adaptation's parent | Nulls the provenance link and **leaves the listing alone**, so nothing is promoted | None |
| Save as reusable drill | Creates a **new** library drill. Never overwrites the original. | None |
| Version numbers shown to coaches | **Never** | None |
| Drill diagram | Stays on the drill. Delivery surfaces already merged. | None |
| Activity authoring | **One seam**, hosted by the planner and the week plan editor | None |
| Station identity | **Declared** on the activity: `slot: 'station'`. Never inferred from `Phase`. | Activity key, **no migration** |
| Game identity | **Declared** on the activity: `slot: 'game'`, **one activity, the whole games phase**. Never inferred from `Phase`. | The same key |
| How many pitches run | `gameCount: 1 \| 2` on that activity. **Never a second activity.** | Activity key, **no migration** |
| The games phase duration | The one game activity's own duration. Two activities would double it in `sessionMinutes`, the lifecycle, the calendar and Live. | None |
| Station number | **Derived**: position among active stations in plan order. Never stored. | None |
| Station count | 4 or 5, never 3. 24+ recommends 5, below 24 recommends 4. | None |
| Which drill sits out at 4 stations | **The coach chooses**, and the activity stays in the plan | `skipped: true` on the activity, **no migration** |
| Restoring it | Remove the key. Reversible, session-local, never touches the week plan or the drill. | None |
| Rotations | **Derived**: the station count | None |
| Session duration | The sum of the activities **actually running**. Same expression, fewer members once something is stood down. | `sessionMinutes` and `plannedMinutes` skip `skipped`. **No migration** |
| Rotation direction | **Clockwise, fixed.** Subtle cue on the overview. | None |
| Live rotation progress | **Not tracked.** Previous and Next are browsing. | None |
| Session workflow state | **Derived**, never stored | None |
| Station group identity | **Bib colour**, unique per session | None |
| Colour to station | Active colours in fixed vocabulary order, sequential, **derived every read** | None |
| Frozen carousel assignment | **Removed** | None |
| Suggested setup | Generated from confirmed attendance, a draft the coach saves | None |
| Attendance change before training | Preserve saved assignments, remove leavers, add joiners, minimal rebalance | None |
| Per-player ability | **Never.** Derived through the team's position in the club order. | None |
| Team ability order | **The one irreducible new fact**: one integer per team | `teams` ordering column |
| Game count | 1 at 12 or fewer confirmed, 2 at 13 or more. A **recommendation** the coach accepts or overrides, never silently rewritten. | None |
| Game bib | **A separate fact from the station bib** | `register_entries` game bib column |
| Game side and game number | **Derived** from the game bib colour's position in the planned colour ordering | None |
| Game colours | The first `2 x gameCount` of the fixed order. Two distinguishable per game, four across two, the UI offers only those, and every included player is given one that is in play. | None |
| Venue layout | **New**: fraction-coordinate zones, admin owned, 4/5 stations and 1/2 games | `venue_layouts` table |
| Venue layout scope | **Venue, season and age group.** Never venue-global, never per team. | The table's unique key |
| A session's season | **Derived** from its date and **fails closed**: zero or more than one containing season loads no layout and says which. No fallback to the current season. | None |
| Weekly station placement | **Removed.** Layouts are scoped, admin owned and load automatically. | None |
| Station detail screen | Number, name, large diagram, objective, 2 to 3 coaching points. **No equipment.** | None |
| Sharing | Protected canonical link through the platform share sheet | **None. Already built.** |
| Generated message with names | **Removed** | None |
| Public operational projection | Out of scope, parked, blocks nothing | None |
| Motion | Deferred. Additive, gated, reader first. | Diagram schema widening |

Exact column and constraint proposals are in `04-data-model-proposal.md`.
