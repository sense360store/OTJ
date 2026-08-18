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
| **Unresolved** | A question discovery did not answer. All of them are in `08-open-questions.md`, split into product decisions (Q) and implementation details (D). |

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
| 04 | [Data model proposal](04-data-model-proposal.md) | Four migrations, three of them a single column, and the deliberate non-changes. |
| 05 | [Security, privacy and share boundary](05-security-share-boundary.md) | Why coach to coach sharing is already safe, and what the new columns oblige. |
| 06 | [Implementation plan](06-phased-plan.md) | Thirteen small slices, what was removed, and the recommended first four. |
| 07 | [Roadmap reconciliation](07-roadmap-reconciliation.md) | Verified pull request state, and how this relates to DRILL-02, DRILL-03 and TRAIN-02. |
| 08 | [Open questions](08-open-questions.md) | Three product questions, four implementation details, and everything discovery closed. |

## The settled model in one page

**Stations.** Exactly four or five, never three. 24 or more confirmed attending
recommends five, fewer recommends four, and the coach may override. Fewer groups
than stations means a station starts empty, and every active group still rotates
through every planned station. Which drill sits out at a four station delivery is
the coach's choice, never OTJ's.

**Attendance.** Yes, No, Unanswered. **Only Yes counts as attending.** Unanswered
gets no bib, no group and no game. The meaningful moment is 24 to 48 hours out.

**Groups and bibs.** The bib colour is the group's name and active colours are
unique. Colours are taken in a fixed order and assigned sequentially to Station 1,
Station 2 and so on, derived on every read and stored nowhere. OTJ generates the
first setup automatically and then **preserves the coach's work** when attendance
changes.

**Rotation.** Always clockwise, not configurable, with a subtle cue. **OTJ tracks
no rotation state.** Previous and Next browse the drills.

**Games.** A separate allocation with a **separate bib**. One game at 12 or fewer
confirmed, two at 13 or more, aiming at 5v5 or 6v6. Two games band by the club's
ordered teams with the middle band as the bridge. Planning the games never
destroys the station plan.

**Venues.** An admin saves two station layouts (four and five) and two game
visuals (one and two) per venue, as numbered rectangular zones on a clean
schematic. OTJ loads the right one automatically. Weekly coaches place nothing.

**Delivery.** A setup map of labelled zones on a phone. Tap a station for a full
screen: number, drill name, large diagram, objective, two or three coaching
points. **No equipment there.** Previous, Next and Back, all browsing.

**Drills.** A session adaptation is an independent copy that stays out of the
library. Save as reusable drill creates a **new** library drill and never
overwrites the original. Coaches never see version numbers.

**Sharing.** The platform share sheet on the protected canonical session link,
carrying no child data. The receiving coach signs in. **This already ships.**

## What this reconciliation removed

Recorded because a design that is merely absent tends to be rebuilt.

| Removed | Why |
|---|---|
| Station blocks on `sessions` and `templates`, and `block_id` on an activity | The station list is derived from plan order and the existing `Phase` vocabulary. |
| The frozen carousel starting-station map | OTJ tracks no running carousel, so there is nothing to protect from moving. |
| Mid-carousel free-ordinal reassignment, and the questions around it | A colour appearing mid-session is a physical event on the grass. |
| Live rotation delivery, one timer per rotation and a Rotate cue | Live administration. The live view is out of scope and unchanged. |
| Per-activity station placement in a venue coordinate space | Layouts are venue level and admin owned. |
| Game sides as sets of bib colours, and "a side may wear two colours" | Reversed by discovery: each game gets two distinguishable colours, and the game bib is its own stored fact. |
| The generated message carrying children's first names | Sharing is coach to coach through the protected link. Nothing leaves the app. |
| `sessions.template_id` | No consumer in the settled model. |
| "20 or more means two games" | The threshold is 13, from a 6v6 target. |
| "Four stations is the default shape" | Four or five, chosen by attendance. |

**Six proposed structures became one column.** The migration count fell from six
to four and no item in the programme now needs a full security review.

## Recommended first implementation slices

Full detail, with dependencies and gates, in `06-phased-plan.md` section 5.

1. **COACH-1**, the club's team order (`teams.sort_order`). One gated migration on
   a five-row table plus an admin reorder. The one irreducible new fact.
2. **COACH-2**, the derived station list. No schema at all.
3. **COACH-3**, the suggested setup from confirmed attendance. The slice a coach
   actually feels, 24 to 48 hours out.
4. **COACH-5** in parallel if there is capacity, the venue layouts
   (`venues.layout`). Depends on nothing.

**Gated migration reviews:** COACH-1, COACH-5, COACH-8, COACH-12. **Full security
reviews: none.**

## House rules these documents follow

- Nothing is asserted about the codebase without a path, table or function to
  check it against.
- Where a fact can be derived from data already read, the proposal derives it.
- No persistence exists to keep OTJ synchronised with a pitch that is moving.
- Every slice leaves OTJ usable and deployable.
- Migrations stay gated, reviewed by a human and applied by hand.
- Public sharing keeps its deliberately reduced projection, and no slice here
  touches it.
