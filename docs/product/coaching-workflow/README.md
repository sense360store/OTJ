# Coaching workflow programme

Living design documents for the end-to-end coaching workflow: programmes,
sessions, drills, Drill Maker, the drill library, Spond attendance, groups and
bibs, venue layout, training-day delivery and sharing.

**Status: reconciled 18 August 2026 after the completed coach discovery;
implementation status re-verified 2 September 2026.** The product model below
is settled. This document set implemented nothing itself, and a settled design
is not delivered work; what has been built since is recorded below, slice by
slice, with the pull request that built it.

Verified against `main` at `3cb20f9`, which contains PR #189 (drill diagrams
across session delivery), PR #195 (migration probe totality) and the five
coaching slices listed under Implementation status.

## Implementation status

Recorded here so a reader is never left guessing which of this is code and which
is still a document. Five slices have been built; everything else in these
documents remains design.

| Slice | State |
|---|---|
| **COACH-2A**, the activity structure model and the active session duration | **Built** in #198 (20 August 2026). `slot` and `skipped` on an activity, `src/lib/activityStructure.ts`, the template boundary, all four session duration implementations and the public snapshot total. No migration. |
| **COACH-2B**, the authoring affordances | **Built** in #202 (21 August 2026). Marking a station or the games phase and the line stating what is declared, on both authoring surfaces through `src/lib/activityRole.ts`; the Not running tonight toggle on the dated session planner only, because `skipped` is session local and the week plan variant of the shared editor structurally cannot receive it. No migration. |
| **COACH-3**, the suggested setup | **Built** in #203 (the pure generator, 21 August 2026) and #204 (the Players and groups screen, 22 August 2026). No migration. |
| **COACH-4**, preserving the coach's setup when attendance changes | **Built** in #206 (22 August 2026). No migration. |
| **COACH-10**, one authoring seam | **Built** in #207 (22 August 2026). No migration. |
| **COACH-1**, the club's team order | **Built.** COACH-1A, migration `0051_team_sort_order` (M1: `teams.sort_order`, the partial unique index and the audit allow list entry), merged as #223 and applied to production on 2 September 2026 (hosted `20260902150212` / `team_sort_order`). COACH-1B, the frontend half, followed in its own PR: the Teams admin screen lists the club's teams in club order, moves them with Move up and Move down, says whether the order is not set, incomplete or saved, and writes the positions 1..N through one Save team order checkpoint; `src/lib/teamOrder.ts` holds the rules and is the one consumer. Every label stays alphabetical, and the grouping suggestion is still handed no order: wiring the two together is a later, separate decision. |
| Everything else | Not built. |

**COACH-2A's one operational follow-up has run, and no stored snapshot needs
repairing.** COACH-2A changed `supabase/functions/_shared/share.ts`, so the two
content-sharing Edge Functions needed redeploying through
`docs/operations/content-sharing-edge-function-deploy.md`. They were: the
hosted `read-content-share` (version 11) and `manage-content-share` (version 7)
were both deployed at 12:07 UTC on 21 August 2026, and on 2 September their
deployed source was read back through the Supabase API and compared with
`main`'s `_shared/share.ts` byte for byte, which it matches. A share is a
frozen snapshot, so a snapshot minted while the OLD source was live would keep
its old total whatever is deployed later; that window is empty here for two
independent reasons. The only way to stand an activity down is the COACH-2B
control, and #202 merged at 19:53 UTC on 21 August, after the deploy, so no
client could write a stood-down activity while the old source was live. And
production, read on 2 September as aggregates only, holds no session and no
week plan carrying a `skipped` key at all, and exactly one share, created on
10 August 2026 before COACH-2A existed. So a publicly shared session counts a
stood-down activity exactly as every screen in the app does, and there is
nothing to refresh.

## How to read these documents

Three labels are used throughout and each means exactly one thing:

| Label | Meaning |
|---|---|
| **Today** | Current repository behaviour. `00-current-state-audit.md` carries the path, table or function behind every claim. |
| **Target** | Approved product behaviour from coach discovery. Which slices are built is recorded under Implementation status above. |
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
| 04 | [Data model proposal](04-data-model-proposal.md) | Three activity keys with no migration, five columns, one small table, and how the migrations are sequenced. |
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

**Six proposed structures became five columns and one small table**, plus three
keys inside an existing unconstrained jsonb array that need no migration at all.
**No item needs a full RLS or auth review**: no role is added, no existing policy
is altered, and the authentication boundary does not move. COACH-5 needs a policy
and grant review because M2 creates a table, and COACH-2 and COACH-8 each need a
focused content-sharing boundary review.

**One existing rule changes**, and it reaches **four** implementations. The
session's length is the sum of the activities **actually running**, so an activity
carrying a `slot` and `skipped: true` stops counting. The four, re-derived from
source and listed in `00-current-state-audit.md` section 17:

| | |
|---|---|
| `sessionMinutes` | `src/lib/data.ts` |
| `plannedMinutes` | `src/lib/sessionLifecycle.ts`, **and its zero branch needed correcting** so an all-stood-down session is not answered as 90 minutes. Keyed on WHY the sum is zero, never on `activities.length`: `04-data-model-proposal.md` section 2 records why |
| The planner's own inline reduce | `src/routes/Planner.tsx`, which did not import `sessionMinutes` and now does |
| `buildSessionSnapshot` | `supabase/functions/_shared/share.ts`, **in Deno**, so one Edge Function deploy |

`src/lib/ics.ts` inherits from the first two. A five station plan delivered as
four therefore does not overstate the night by a rotation anywhere. It is inert
until something is stood down.

## Recommended first implementation slices

Full detail, with dependencies and gates, in `06-phased-plan.md` section 5.

**The migration-free slices led, and all four have shipped.** They went first
because a file number reserves nothing: the reviewed register pins every
migration to the hosted ledger head it was written against, so an entry cannot
be written until that head is known, and at the time PR #191 still owned
reviewed migration `0050`. #191 merged on 27 August 2026 and `0050` was applied
on 23 August, so the hosted head is now `20260823065041` / `bulk_delete_players`
(read 2 September 2026).

1. ~~**COACH-2**, declare the stations and the games.~~ Built: #198 and #202.
2. ~~**COACH-3**, the suggested setup from confirmed attendance.~~ Built: #203
   and #204.
3. ~~**COACH-4**, preserving the coach's setup when attendance changes.~~
   Built: #206.
4. ~~**COACH-10**, the authoring seam.~~ Built: #207.

**COACH-1** (`teams.sort_order`) is built: COACH-1A, migration
`0051_team_sort_order`, merged as #223 and was applied on 2 September 2026,
and COACH-1B, the Teams screen's ordering affordance, followed in its own PR.
Then **COACH-5**
(`venue_layouts`), **COACH-8** (the game bib) and
**COACH-12** (`drills.variant_of`), each authored and registered against the
ledger as it stands at its own review.

**Full RLS or auth reviews: none.** One policy and grant review, COACH-5, whose
policies mirror `venues`. **Focused content-sharing boundary reviews: two**,
COACH-2 and COACH-8.

## House rules these documents follow

- Nothing is asserted about the codebase without a path, table or function to
  check it against.
- Where a fact can be derived from data already read, the proposal derives it.
- No persistence exists to keep OTJ synchronised with a pitch that is moving.
- Every slice leaves OTJ usable and deployable.
- Migrations stay gated, reviewed by a human and applied by hand.
- Public sharing keeps its deliberately reduced projection, and no slice here
  touches it.
