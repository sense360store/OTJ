# Target product model

Status: approved product model, reconciled 18 August 2026 after the completed
coach discovery. Nothing here is built. Every claim about what exists today is
carried by `00-current-state-audit.md`.

This document decides what each concept **is**: a reference, a copy, a derived
fact or stored state. It states why, and it names what needs new database
structure and what does not.

**The headline is a subtraction.** The previous revision proposed six migrations,
station block metadata inside `sessions.activities`, a per-activity position in a
venue coordinate space, a frozen carousel assignment map and a generated message
carrying children's first names. Four of those five are gone. What is left is
four small migrations, three of them single columns.

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
read wrongly later. It is recorded in `04-data-model-proposal.md` section 7 as a
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

**`drills.variant_of`, one nullable self-reference, and one display rule: a drill
with `variant_of` set is an adaptation and is not listed in the library at all.**
It is reachable from the session that owns it and from its parent's detail page,
and nowhere else.

**Save as reusable drill creates a new library drill.** Concretely, it copies the
adaptation into a new row with `variant_of` null. That matches the settled
wording exactly: a new reusable drill appears, and the original is never
overwritten from a session adaptation.

Both are display and journey rules over one nullable column. Neither needs a
policy: `variant_of` is an ordinary column on `drills`, covered by the four live
policies, which is the reasoning `0046` used for `diagram`.

### What copying does not solve, stated honestly

Editing a **library** drill still changes every past session that references it
directly. Full fidelity would mean snapshotting the drill onto every session.

**Decision: do not snapshot delivered sessions. Make the edit non-silent
instead.** The drill edit form gains a line naming how many sessions reference
this drill and how many have already been delivered, with "Adapt for one session
instead" beside it. One query, no data model.

Recorded as `08-open-questions.md` Q1, with a recommended default of no freezing.

### Where the diagram lives

**On the drill, always.** `drills.diagram` is already correct: versioned,
fraction coordinates, allow-listed on read and write, pinned by a check
constraint so no client can put a person in it. A session never holds a diagram.
An adaptation holds its own because an adaptation is a drill.

## 4. Stations: derived from the plan, with no new structure

**Decision: the station list is derived from the session plan. No station block
metadata, no `blocks` column, no `block_id` on an activity.**

**This reverses the previous revision**, which proposed `sessions.blocks` and
`templates.blocks` plus a `block_id` key on every station activity. That
structure existed to answer four questions. Three of them have gone away and the
fourth has a cheaper answer:

| The block was going to carry | Status now |
|---|---|
| Which activities form one carousel | Derived from the plan, below |
| Which activities are the games | Derived from the plan, below |
| A frozen starting-station assignment | **Removed.** No live state is tracked. |
| Game side membership | **Moved** to a bib column on the register (section 6) |

### How the station list is derived

**Today** `Phase` is `'Warm-Up' | 'Skill' | 'Game' | 'Cool-Down'`
(`src/lib/data.ts:9`), every screen reads it, and `phaseFor`
(`src/lib/drillPicker.ts:17`) already routes a physical drill to Warm-Up, a
social drill to Game and everything else to Skill.

So:

- **The stations are the `Skill` phase activities, in plan order.** Station
  number is position in that list, which is exactly what the settled decision
  says: station number is determined by drill order in the session plan.
- **The games are the `Game` phase activities.**
- Warm-Up and Cool-Down are neither.

**Nothing is stored and no migration is needed.** A session that has never been
touched by this work reads exactly as it does today.

**The residual, stated rather than hidden.** A coach can add a `Skill` activity
that is not one of the stations, for example a whole-group technical exercise,
and the derived station count would then be wrong. Two things contain it: the
station count is 4 or 5 and the screen states the number it derived, so a wrong
answer is visible rather than silent; and the recommendation is a sentence the
coach reads, never an automatic rewrite.

**If that residual turns out to be real in use**, the narrowest fix is one
optional boolean-shaped key on the activity, added to `toActivity` and
`toActivityRow`. `sessions.activities` is unconstrained jsonb, so **even that
fallback needs no migration**. It is recorded as an implementation detail
(`08-open-questions.md`, D4), not as planned work.

### Duration is untouched, and it was already correct

Every active group completes every planned station once, so the rotation count is
the **station** count, whatever the group count is.

```
rotations        = stations
wall clock       = minutesPerRotation x stations
sum of durations = minutesPerRotation x stations
```

The same expression. `sessionMinutes` (`src/lib/data.ts:539`), `plannedMinutes`
(`src/lib/sessionLifecycle.ts:150`), the derived lifecycle and `src/lib/ics.ts`
are correct as they stand and are not touched by any phase of this programme.

The one residual is a planning matter rather than a model gap: stations in one
carousel move together, so they share a rotation length. Unequal member durations
describe no real session, and the answer is a planning warning, not a duration
rule.

### Station count and the four or five rule

- 24 or more confirmed attending recommends 5 stations and 5 groups.
- Fewer than 24 recommends 4 stations and 4 groups.
- 3 is never recommended.
- The coach may override.

**The recommendation never rewrites the plan.** Where a five drill plan is
delivered as four stations, the coach chooses which drill sits out. Nothing
deletes a planned drill.

**Unresolved: the exact affordance for choosing the four active drills.**
Removing an activity from the dated session already works and already touches
neither the week plan nor the library drill, because a session is a copy. Whether
that is the right gesture, or whether a "not tonight" marker reads better, is an
implementation detail and is recorded as one (`08-open-questions.md`, D2). It is
not a licence to delete a drill on the coach's behalf.

## 5. Session lifecycle: derive, do not store

**Decision: add no stored workflow states. Derive readiness.**

| Question | Derived from |
|---|---|
| Planned? | `activities.length > 0` |
| Attendance available? | `spond_event_id` set and responses known |
| Groups prepared? | every included player resolves to a bib, and the active groups' colours are unique |
| Games prepared? | the recommended number of games is planned, and each game reads as two distinguishable colours |
| Setup available? | the session's venue has a layout for the derived station count |
| Delivered? | `sessionLifecycle.ts` already answers this, three states, derived |

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

**OTJ generates the first suggested setup automatically from the confirmed
attendance**, about 24 to 48 hours out when Spond replies become useful.

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

Verified against the schema (`00-current-state-audit.md` section 19): `teams`
carries `id, club_id, name, created_at, bib_colour` and nothing else, and every
team order in the product is alphabetical, which for this club matches the
ability order nowhere. There is no `sort_order`, `position`, `rank` or `ability`
column on any table, and `created_at` records when a row was inserted during
setup rather than anything about football.

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

**Decision: one new column, `register_entries.game_bib_colour_override`.**

### Why the station bib cannot carry both

**Today** `register_entries` holds one row per `(session_id, player_id)` with a
single `bib_colour_override`, written through
`upsert(..., { onConflict: 'session_id,player_id' })`, so a second bib for the
same player in the same session **replaces the first**
(`00-current-state-audit.md` section 21). There is no per-field timestamp, no
prior value, and 0044's self-verification refuses a per-tick audit trigger
outright, so nothing can reconstruct it either.

The settled model requires the two to coexist:

- the station bib plan must not be overwritten or destroyed because the games use
  different bibs
- some players are re-bibbed for the games, and each game should ideally have two
  clearly distinguishable colours
- the game plan shows each player's game side and game bib colour, while the
  station groups stay readable beside it

One column cannot hold two independent values. **This is the exact shape 0047
already answered once**: `present` carried both attendance and inclusion, a coach
who split fourteen of the eighteen who came had four children recorded absent,
and the fix was a second column that copies nothing from the first. The same
argument applies here and the same migration shape follows it.

The previous revision rejected a phase-specific bib column on the grounds that it
would hard code two phases into a schema whose point was that the block count is
a planning decision. **That objection dies with the blocks.** The settled model
has exactly two arrangements per night, stations and games, and the game bib is a
first-class fact a coach reads off a screen, not a phase of a general mechanism.

### How it resolves

```
game bib = game override, else the effective station bib
```

which is the physical truth: you only hand out new bibs to the children who
change. A player nobody re-bibbed plays in what they are already wearing.

### Side and game membership are derived from the colour

**Decision: no per-player side column and no per-player game number.**

The colours in play for the games are assigned deterministically from the same
fixed vocabulary order the station groups use, two colours per game, so a colour
resolves to a game and a side. Storing a side beside the colour would be two
facts about one thing, and the second could disagree with the bib the child is
actually wearing.

**Unresolved, and labelled as an implementation detail** (`08-open-questions.md`,
D3): whether that derivation holds when a coach picks a colour outside the pair
their game is using. The candidate answers are to offer only the colours in play
for that game, or to carry a small session-level map of game and side to colour.
Both are client-side. Neither is a new column, and this must be settled before
the games slice is built rather than during it.

### Game count and banding

- **12 or fewer confirmed: one game. 13 or more: two games.** The coach may
  override. The threshold follows from a 6v6 target, since a thirteenth child in
  one game means a 7v7.
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
where possible each game has **two clearly distinguishable colours**, and
re-bibbing for the games is expected. The station bib plan is protected by the
second column, not by refusing to re-bib.

## 8. Venue layouts

**Decision: the layout belongs to the venue, is configured by an admin, and is
loaded automatically. A session stores no geometry at all.**

**This replaces the previous revision's model**, which put a
fraction-coordinate position on every station activity in `sessions.activities`,
derived the sub-area from that position, and gave the weekly coach a drag and
drop composer. All of it is removed. The settled decision is that weekly coaches
do not drag or reposition anything in v1, and the physical zone positions stay
familiar week to week, which is a property of the venue rather than of the night.

### The shape

A venue gains an optional **layout** holding a small closed set of saved layouts:

| Kind | Slots | What it is |
|---|---|---|
| stations | 4 | Four numbered station zones |
| stations | 5 | Five numbered station zones |
| games | 1 | One game pitch |
| games | 2 | Two game pitches |

Each layout is an ordered list of named rectangular **zones**. One shape serves
both kinds: a station zone is "the area normally allocated to Station N" and a
game zone is "where that game is played".

- **Fraction coordinates, 0 to 1**, exactly as `drills.diagram` and
  `boards.tokens` are, so one stored layout renders on a phone, a desktop and in
  print with no second copy.
- An optional **real-world size** for honest proportions and labelling. It is
  metadata, never the coordinate space.
- **Versioned**, with the same rule the diagram uses: an unrecognised version
  yields no layout rather than a mis-drawn one.
- **No imagery of any kind.** A clean schematic. Aerial photography brings a
  third-party rights question, a storage cost and a legibility problem at phone
  width, and the settled decision rules it out.
- Owned by `club.manage`, like the venue name it hangs off.

**A station zone is an allocation, not a footprint.** It means "Station 3 goes
roughly here", not "this week's drill occupies exactly this rectangle". That
distinction is what lets one layout serve every week.

### How a session gets its layout

Station number comes from drill order in the plan (section 4). The station count
comes from the same list. So the lookup is `(venue, stations, count)` and there
is nothing to choose and nothing to store on the session.

**A session whose venue has no layout for its station count** says so in one
sentence with a link an admin can follow. It is not an error and it blocks
nothing.

**Unresolved: whether layouts are scoped by season or age group as well as by
venue** (`08-open-questions.md`, D1). The recommended default for v1 is venue
scope only, because a rectangle on the ground is a physical fact that does not
change when a season turns over, and this club trains one age group. The shape
below is a keyed list precisely so a scope key can be added without a rewrite.

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

**Today** the planner and `TemplateFormModal` each maintain their own activity
list, add bar, custom activity literal and row component
(`00-current-state-audit.md` section 9). Long range planning happens in the week
plan editor, weeks before a dated session exists.

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
| Adapting a drill | **Copy**, owned by the session, **not listed in the library** | `drills.variant_of` |
| Save as reusable drill | Creates a **new** library drill. Never overwrites the original. | None |
| Version numbers shown to coaches | **Never** | None |
| Drill diagram | Stays on the drill. Delivery surfaces already merged. | None |
| Activity authoring | **One seam**, hosted by the planner and the week plan editor | None |
| Station identity | **Derived** from plan order and the existing `Phase` vocabulary | **None.** Blocks dropped |
| Station count | 4 or 5, never 3. 24+ recommends 5, below 24 recommends 4. | None |
| Which drill sits out at 4 stations | **The coach chooses.** Nothing is deleted for them. | None |
| Rotations | **Derived**: the station count | None |
| Session duration | **Unchanged.** The existing sum is already correct. | None |
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
| Game count | 1 game at 12 or fewer, 2 at 13 or more. A recommendation. | None |
| Game bib | **A separate fact from the station bib** | `register_entries` game bib column |
| Game side and game number | **Derived** from the game bib colour | None |
| Venue layout | **New**: fraction-coordinate zones, admin owned, 4/5 stations and 1/2 games | `venues` layout column |
| Weekly station placement | **Removed.** Layouts are venue level and load automatically. | None |
| Station detail screen | Number, name, large diagram, objective, 2 to 3 coaching points. **No equipment.** | None |
| Sharing | Protected canonical link through the platform share sheet | **None. Already built.** |
| Generated message with names | **Removed** | None |
| Public operational projection | Out of scope, parked, blocks nothing | None |
| Motion | Deferred. Additive, gated, reader first. | Diagram schema widening |

Exact column and constraint proposals are in `04-data-model-proposal.md`.
