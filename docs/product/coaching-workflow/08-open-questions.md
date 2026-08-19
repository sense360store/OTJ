# Decisions, and what is left open

Status: corrected 18 August 2026. **No open product or club questions remain.**

The first revision of this document carried ten. Coach discovery answered or
removed the requirement behind seven, and this correction closes the last three
along with the four implementation details the previous pass had labelled as
unresolved.

What is left is three **review-time decisions**, each belonging to a specific
migration's review rather than to the product, and each with a recommended
default so none of them stalls work.

Nothing here blocks any slice.

---

## Review-time decisions, taken at the migration's own review

These are not product questions. They are the kind of decision this repository
makes inside a gated migration review, recorded here so the reviewer does not
have to rediscover them.

### R1. Does `teams.sort_order` join the audited allow list?

**In:** COACH-1 (M1). **Recommended: yes.**

`audit_teams()` has an allow list, and `describeActivityEvent` renders
`team.updated` as the deliberately general "Team updated"
(`src/lib/activityView.ts:432`), whose comment says it stays general because the
list already carries both the name and the bib colour. A third field does not
falsify that sentence. Re-banding the club's teams is a club-level change worth a
feed entry.

### R2. How is `venue_layouts` audited?

**In:** COACH-5 (M2). **Recommended: create, update and delete, at the same
granularity as venues, under new source values.**

Worth stating alongside it: because the layout is a table rather than a column on
`venues`, `audit_venues()` and `describeActivityEvent`'s "Venue renamed" label
(`src/lib/activityView.ts:438`) **stay true**. The label correction an earlier
revision had to schedule has disappeared, which is one of the reasons the table
is the better shape.

### R3. Which hosted ledger head does each coaching migration pin?

**In:** every gated slice. **Recommended: decided at the moment each migration is
ready for its own application review, never in advance.**

The reviewed register pins `expected_previous_version` and
`expected_previous_name` to the hosted head a migration was written against
(`04-data-model-proposal.md` section 8). Open draft PR #191 owns reviewed
migration `0050`, and this programme neither modifies it nor assumes it. A file
number reserves nothing, so no coaching migration is authored as "the one after
0050" while `0050` is unresolved.

---

## Closed by this correction

Four things the previous revision left labelled as unresolved. All four are now
decided, and the reasoning sits in the document that owns each.

### The station marker. Settled: `slot`

An activity declares `slot: 'station' | 'game'`, and absence means neither. It is
**never inferred from `Phase`**, because `phaseFor` sets the phase from the
drill's four-corners classification, so a physical drill lands in Warm-Up and a
social drill lands in Game whatever part either plays on the night. No migration:
`sessions.activities` is unconstrained jsonb and the cost is two mapper entries.
`02-target-product-model.md` section 4.

The previous revision's "ship it derived, watch, and decide later" is withdrawn.
The evidence that `Phase` is ambiguous was already in the repository.

### Five planned stations, four tonight. Settled: `skipped`

A station stood down for one night carries `skipped: true`, written only as
`true` and removed on restore. The activity stays in the dated session's plan
with its place and duration, the week plan never receives it, the library drill
is untouched, and it is reversible on one press. **OTJ never chooses which drill
sits out.** `02-target-product-model.md` section 4a.

### The venue layout scope. Settled: venue, season and age group

Layouts are scoped to a venue, a season and an age group, never venue-global and
never per team. Within one scope the admin saves four: stations for four,
stations for five, one game, two games. The persistence is a small
`venue_layouts` table whose unique key **is** the scope, because a season is a
row rather than a string and a per-venue blob cannot reference it.
`04-data-model-proposal.md` section 3.

A session resolves its scope from its venue, its age group and its active station
count, with the season derived from its date: exactly one containing season wins;
more than one resolves to the current season only if it is one of them; zero
renders no layout. **No branch picks a season that does not contain the date.**

### The game colour mapping. Settled: deterministic, from the fixed order

For `G` games, take the first `2 x G` colours of the fixed `BIB_COLOURS` order:
index 0 is game 1 side A, index 1 is game 1 side B, index 2 is game 2 side A, and
so on. So each game shows two distinguishable colours, two games use four, and a
child's game and side derive from their game bib colour's position.

The UI offers only those colours, and the suggestion **writes a game bib for
every included player whose station colour is not one of them**, so five groups
and two games leaves nobody without a game. A stored colour outside the list
resolves to **no game** and shows as unassigned, never guessed into the nearest
one. **No per-player game number, no per-player side column, and no
session-level colour map**, and only implementation evidence that the
deterministic rule cannot work would justify one.
`02-target-product-model.md` section 7.

---

## Closed earlier, and not reopened here

### The three product questions the previous revision left open

| Was open | Decision |
|---|---|
| Should a delivered session freeze the drills it ran? | **No freeze and no snapshot system in v1.** Session adaptations stay independent copies, and a library drill edit is made **non-silent** where past sessions reference it: the edit form names how many sessions use it and how many have been delivered, with Adapt for one session beside it. |
| Is replacing the word "template" acceptable? | **Yes.** Coach-facing UI says **week plan**, and "session plan" for a standalone one. The `templates` table keeps its name. **No schema rename.** |
| Should the suggested setup say why it grouped that way? | **Yes, one short line where it helps.** For example "Two neighbouring teams were combined to keep group sizes workable." It does not expose algorithm internals, thresholds or scores. |

### The product philosophy

**OTJ is a prepared training plan and a visual guide, not a live administrative
system.** Once training starts, small operational changes are handled physically.
This closed more questions than any other answer.

### Stations and rotation

| Was open | Answer |
|---|---|
| How many stations | **Exactly four or five. Never three.** 24 or more confirmed recommends five, fewer recommends four, and the coach may override. |
| What drives the count | **Player attendance**, not coach availability. |
| Fewer groups than stations | A station starts empty. Every active group still rotates through every planned station. |
| Which group starts where | Active bib colours in the fixed vocabulary order, assigned sequentially to Station 1 onward. Derived on every read. |
| Rotation direction | **Always clockwise**, not configurable, with a subtle cue. |
| Does OTJ track rotation progress | **No.** Previous and Next browse the drills. |
| A re-bib during the carousel, or a new colour mid-carousel | **Withdrawn with the mechanism.** There is no carousel state to disturb. |
| How the transition between stations and games is timed | **Handled physically.** The games have their own saved layout. |

### Groups and bibs

| Was open | Answer |
|---|---|
| Is a group the same thing as a bib colour | **Yes**, and active colours are unique within a session. No Group entity, no `group_id`. |
| How many groups | One per station. Teams kept whole where practical, only adjacent bands combined, uneven preferred over splitting a squad. |
| Where ability comes from | **The club's ordered teams.** Never a per-player score. |
| Session-only assignment | Already satisfied by `register_entries.bib_colour_override`. |
| Who generates the first setup | **OTJ, automatically, from confirmed attendance.** |
| What happens when attendance changes | Preserve saved assignments, remove leavers, add joiners, rebalance minimally. A deliberate Reset is later work. |
| What counts as attending | **Only Yes.** Unanswered is not attending and gets no bib, group or game. |

### Games

| Was open | Answer |
|---|---|
| Which activities are the games | **The ones declared `slot: 'game'`.** Never the `Game` phase. |
| How many games | **One at 12 or fewer confirmed, two at 13 or more.** A recommendation, never a rewrite. |
| Target size | 5v5 or 6v6. Avoid 7v7 or larger. |
| Are game bibs the same as station bibs | **No.** Two separate stored facts for one session. |
| May a side wear two colours | **Reversed.** Each game gets two clearly distinguishable colours where possible, four across two games, and re-bibbing for the games is expected. |
| How two games are banded | Upper teams form the stronger game, lower teams the development game, the middle band is the flexible bridge and may be split. Sensible game size beats preserving station groups. |
| How one game is balanced | Distribute the stronger players across both sides. |
| What the game plan shows | Player names, side, and game bib colour. |
| On-pitch changes | **Not persisted.** |

### Venue and delivery

| Was open | Answer |
|---|---|
| Aerial or traced imagery | **No.** A clean schematic. |
| Who lays out a venue | **An admin, once per scope.** Weekly coaches place nothing. |
| How many layouts per scope | Four: stations for four, stations for five, one game, two games. Loaded automatically. |
| What a station rectangle means | The area normally allocated to Station N, not this week's exact footprint. |
| Where station numbers come from | Position among the **active** stations, in plan order. Never stored. |
| What a station shows on the map | Useful overview information, never a shrunken drill diagram. |
| What the station detail shows | Station number, drill name, large diagram, objective, two or three coaching points. **No equipment.** |

### Drills and sharing

| Was open | Answer |
|---|---|
| How a drill is adapted for one session | A copy owned by the session, independent of the library drill and of every other session, and not listed in the library. |
| Are versions exposed | **Never.** |
| What Save as reusable does | Creates a **new** library drill. It never overwrites the original. |
| How coaches share a session | The platform Share action on the protected canonical link. Already shipped. |
| Is a WhatsApp integration needed | **No.** |
| Does the share carry player data | **No.** |
| Is public login-free sharing needed for this | **No.** The programme proposes no public projection. |

### Withdrawn because their requirement is gone

- **May a public share carry date, time and venue?** It belongs to TRAIN-02
  (`07-roadmap-reconciliation.md` section 3).
- **Should a signed-in parent see their own child's group?** It would need a new
  identity binding between `profiles` and `players`, which the product
  deliberately does not have. It has **no consumer in the settled model**.
- **Should the live view have an audible rotation cue?** OTJ does not cue
  rotations. LIVE-02 is unaffected.

---

## Summary

| | Blocks | Default |
|---|---|---|
| R1 audit `sort_order` | Nothing | Yes, it joins the allow list |
| R2 audit `venue_layouts` | Nothing | Create, update, delete, like venues |
| R3 which ledger head each migration pins | The timing of each gated slice, and nothing else | Decided at that migration's own review |

**No product or club decision is outstanding.** Every slice in
`06-phased-plan.md` can be picked up on its stated dependencies, and the four
migration-free slices can start today.
