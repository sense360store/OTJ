# Coaching workflow programme

Living design documents for the end-to-end coaching workflow: programmes,
sessions, drills, Drill Maker, the drill library, Spond attendance, groups and
bibs, venue layout, training-day delivery and sharing.

**Status: reconciled 18 August 2026 after the completed coach discovery.** The
product model below is settled. **No application or database behaviour has been
implemented by this document set**, and a settled design is not delivered work.

Verified against `main` at `afe790d`, which now contains PR #189 (drill diagrams
across session delivery) and PR #195 (migration probe totality).

## How to read these documents

Three labels are used throughout and each means exactly one thing:

| Label | Meaning |
|---|---|
| **Today** | Current repository behaviour. `00-current-state-audit.md` carries the path, table or function behind every claim. |
| **Target** | Approved product behaviour from coach discovery. None of it is built. |
| **Unresolved** | Something still to be decided. **No product or club question is outstanding**; what remains is three decisions taken at a migration's own review, listed in `08-open-questions.md`. |

## The outcome this serves

> A coach should be able to plan training weeks ahead, refine it when Spond
> attendance becomes known, and then every coach should arrive at the venue with
> enough information on their phone to understand the groups, bibs, overall pitch
> setup, individual drill setup and drill objectives without requiring a verbal
> briefing from another coach.

## The one decision that shaped everything else

**OTJ is a prepared training plan and a visual guide. It is not a live
administrative system that coaches keep synchronised while they are coaching.**

Once training starts, small operational changes are handled physically on the
pitch. A late arrival goes into an existing group. A missing coach is covered
between the others. A game changes shape and nobody opens their phone.

That single decision removed more architecture than every other decision
combined, and the result is a significantly simpler target model.

## The documents

| # | Document | What it is for |
|---|---|---|
| 00 | [Current-state architecture audit](00-current-state-audit.md) | What exists today, with repository paths, tables and functions. Read this first. |
| 01 | [Coach workflow and product principles](01-coach-workflow-principles.md) | How training is actually planned and delivered, and the principles that follow. |
| 02 | [Target product model](02-target-product-model.md) | What each concept is: reference, copy, derived fact or stored state, and why. |
| 03 | [Target UX journeys](03-ux-journeys.md) | Eight journeys, the components each reuses, and the mobile interaction decision. |
| 04 | [Data model proposal](04-data-model-proposal.md) | Three activity keys with no migration, four columns, one small table, and how the migrations are sequenced. |
| 05 | [Security, privacy and share boundary](05-security-share-boundary.md) | Why coach to coach sharing is already safe, and what the new columns oblige. |
| 06 | [Implementation plan](06-phased-plan.md) | Thirteen small slices, what was removed, and the recommended first four. |
| 07 | [Roadmap reconciliation](07-roadmap-reconciliation.md) | Verified pull request state, and how this relates to DRILL-02, DRILL-03 and TRAIN-02. |
| 08 | [Decisions](08-open-questions.md) | No open product questions. Three review-time decisions, and the full closed record. |

## The settled model in one page

**Stations.** Exactly four or five, never three. 24 or more confirmed attending
recommends five, fewer recommends four, and the coach may override. Fewer groups
than stations means a station starts empty, and every active group still rotates
through every planned station.

**Stations and games are declared on the activity**, with `slot`, and are never
inferred from the drill's coaching phase. Station numbers follow the plan order
of the stations running tonight and are never stored.

**The games phase is one activity**, whose duration is the whole phase. Whether
one or two pitches run inside it is `gameCount` on that activity, not a second
activity, so the session total, the derived lifecycle, the calendar export and
Live's sequential model all stay correct. Two activities would double the games
phase in every one of them.

**Five planned, four tonight: the coach chooses and nothing is deleted.** The
station is marked `skipped` for that session, keeps its place and duration, and
one press restores it. The week plan and the library drill are untouched.

**Attendance.** Yes, No, Unanswered. **Only Yes counts as attending.** Unanswered
gets no bib, no group and no game. The meaningful moment is 24 to 48 hours out.

**Groups and bibs.** The bib colour is the group's name and active colours are
unique. Colours are taken in a fixed order and assigned sequentially to Station 1,
Station 2 and so on, derived on every read and stored nowhere. OTJ generates the
first setup automatically and then **preserves the coach's work** when attendance
changes.

**Rotation.** Always clockwise, not configurable, with a subtle cue. **OTJ tracks
no rotation state.** Previous and Next browse the drills.

**Games.** A separate allocation with a **separate bib**. `gameCount` of 1 at 12
or fewer confirmed, 2 at 13 or more, aiming at 5v5 or 6v6, accepted by the coach
and never silently rewritten. Two games band by the club's
ordered teams with the middle band as the bridge. Each game gets two
distinguishable colours and two games use four, and every included player is
given one that is in play; a child's game and side derive from their game bib
colour's position in that ordering, with no per-player game or side column and no
stored colour map. Planning the games never destroys the station plan.

**Venues.** Layouts are scoped to **venue, season and age group**, never
venue-global and never per team. Within one scope an admin saves four: stations
for four, stations for five, one game, two games, as numbered rectangular zones
on a clean schematic. OTJ loads the right one automatically, resolving the season
from the session's own date and **failing closed**: zero or more than one
containing season loads no layout and says which. Weekly coaches place nothing.

**Delivery.** A setup map of labelled zones on a phone. Tap a station for a full
screen: number, drill name, large diagram, objective, two or three coaching
points. **No equipment there.** Previous, Next and Back, all browsing.

**Drills.** A session adaptation is an independent copy that stays out of the
library, and deleting the original does not put it there: provenance and listing
are two fields, because only one of them may change by itself. Save as reusable
drill creates a **new** library drill and never overwrites the original. Coaches
never see version numbers.

**Sharing.** The platform share sheet on the protected canonical session link,
carrying no child data. The receiving coach signs in. **This already ships.**

## What this reconciliation removed

Recorded because a design that is merely absent tends to be rebuilt.

| Removed | Why |
|---|---|
| Station blocks on `sessions` and `templates`, and `block_id` on an activity | Two keys on the activity carry it, with no migration. |
| Inferring stations from the `Skill` phase and games from the `Game` phase | `phaseFor` sets the phase from the drill's four corners, so it records what kind of drill was added, not what part it plays. Declared explicitly instead. |
| A single `venues.layout` jsonb column | It cannot express the venue, season and age group scope the product requires. Replaced by a small table, not by a weaker scope. |
| Two `slot: 'game'` activities for two pitches | Activities are sequential and summed, so two would double the games phase in the total, the lifecycle and the calendar. One activity, one `gameCount`. |
| A current-season fallback when a session's date matches no season | It would load this year's allocation onto an old session. Resolution fails closed instead. |
| `created_by` and `updated_by` on `venue_layouts` | `venues` deliberately carries neither and says why. The audit trail records who. |
| The frozen carousel starting-station map | OTJ tracks no running carousel, so there is nothing to protect from moving. |
| Mid-carousel free-ordinal reassignment, and the questions around it | A colour appearing mid-session is a physical event on the grass. |
| Live rotation delivery, one timer per rotation and a Rotate cue | Live administration. The live view is out of scope and unchanged. |
| Per-activity station placement in a venue coordinate space | Layouts are scoped, admin owned and load automatically. Weekly coaches place nothing. |
| Game sides as sets of bib colours, and "a side may wear two colours" | Reversed by discovery: each game gets two distinguishable colours, and the game bib is its own stored fact. |
| The generated message carrying children's first names | Sharing is coach to coach through the protected link. Nothing leaves the app. |
| `sessions.template_id` | No consumer in the settled model. |
| "20 or more means two games" | The threshold is 13, from a 6v6 target. |
| "Four stations is the default shape" | Four or five, chosen by attendance. |

**Six proposed structures became four columns and one small table**, plus three
keys inside an existing unconstrained jsonb array that need no migration at all.
No item in the programme needs a full security review.

**One existing rule changes**, and only one: the session's length is the sum of
the activities **actually running**, so `sessionMinutes` and `plannedMinutes`,
the two places that implement that sum, skip an activity a coach has stood down
and `src/lib/ics.ts` inherits it. A five station plan delivered as four therefore
does not overstate the night by a rotation. It is inert until something is stood
down.

## Recommended first implementation slices

Full detail, with dependencies and gates, in `06-phased-plan.md` section 5.

**The migration-free slices lead**, because open draft PR #191 owns reviewed
migration `0050` and a file number reserves nothing: the reviewed register pins
every migration to the hosted ledger head it was written against, so an entry
cannot be written until that head is known.

1. **COACH-2**, declare the stations and the games. No schema, two mapper
   entries, and the root of everything operational.
2. **COACH-3**, the suggested setup from confirmed attendance. The slice a coach
   actually feels, 24 to 48 hours out.
3. **COACH-4**, preserving the coach's setup when attendance changes.
4. **COACH-10**, the authoring seam, whenever capacity allows.

Then the gated migrations in dependency order: **COACH-1** (`teams.sort_order`),
**COACH-5** (`venue_layouts`), **COACH-8** (the game bib), **COACH-12**
(`drills.variant_of`), each authored and registered against the ledger as it
stands at its own review.

**Full security reviews: none.**

## House rules these documents follow

- Nothing is asserted about the codebase without a path, table or function to
  check it against.
- Where a fact can be derived from data already read, the proposal derives it.
- No persistence exists to keep OTJ synchronised with a pitch that is moving.
- Every slice leaves OTJ usable and deployable.
- Migrations stay gated, reviewed by a human and applied by hand.
- Public sharing keeps its deliberately reduced projection, and no slice here
  touches it.
