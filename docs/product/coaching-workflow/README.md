# Coaching workflow programme

Living design documents for the end-to-end coaching workflow overhaul:
programmes, sessions, drills, Drill Maker, the drill library, Spond attendance,
groups and bibs, venue and pitch layout, training-day delivery and shareable
outputs.

**Status: direction approved as the working model. Revised twice after review,
most recently by the August coach discovery. No application or database
behaviour has been implemented by this document set.**

Captured 17 August 2026 against `main` at `2283350`.

**Revision 2** reconciled Phase A with open PR #189, replaced the station
placement model with a position, reopened "a group is a bib colour", and
corrected the station duration claim.

**Revision 3** (this one) settles the grouping model from coach discovery:
rotations follow the station count and not the group count, so the duration model
needs no change at all; the bib colour is the station group's identity and must
be unique; the club's team order is the only new fact worth storing; and a
session has two physical phases, so the venue setup is phase-specific rather than
static.

## The outcome this serves

> A coach should be able to plan training weeks ahead, refine it when Spond
> attendance becomes known, and then every coach should arrive at the venue with
> enough information on their phone to understand the groups, bibs, overall pitch
> setup, individual drill setup and drill objectives without requiring a verbal
> briefing from another coach.

## The documents

| # | Document | What it is for |
|---|---|---|
| 00 | [Current-state architecture audit](00-current-state-audit.md) | What exists today, with repository paths, tables and functions. Read this first. |
| 01 | [Coach workflow and product principles](01-coach-workflow-principles.md) | How training is actually planned and delivered, and the ten principles that follow. |
| 02 | [Target product model](02-target-product-model.md) | What each concept is: reference, snapshot, copy or hybrid, and why. |
| 03 | [Target UX journeys](03-ux-journeys.md) | Eight journeys, the components each reuses, and the mobile interaction decision. |
| 04 | [Data model proposal](04-data-model-proposal.md) | The six anticipated migrations, and the seven deliberate non-changes. |
| 05 | [Security, privacy and share boundary](05-security-share-boundary.md) | Why the existing public contract cannot carry a group plan, and what to do instead. |
| 06 | [Phased implementation plan](06-phased-plan.md) | Fourteen phases, each independently shippable, plus three adversarial passes. |
| 07 | [Roadmap reconciliation](07-roadmap-reconciliation.md) | How this relates to DRILL-02, DRILL-03, TRAIN-02 and the rest. |
| 08 | [Open questions](08-open-questions.md) | Eight open decisions and six now settled. None blocks the critical path. |

## The findings that shaped everything else

1. **Rotations follow stations, not groups, so the duration model is already
   correct.** Every active bib group completes every planned station once, so
   four planned stations run four rotations whether three groups turn up or four;
   with three, one station stands empty. `sessionMinutes`, the derived lifecycle
   and the calendar export all stay as they are. Two earlier revisions of these
   documents claimed otherwise and both were wrong.

2. **Station blocks are still needed, for structure rather than arithmetic.**
   Nothing says which activities form one carousel, so the venue composer, the
   "your group starts at station 2" statement and the training-day overview have
   nothing to compute from. Live also walks stations in series when every group
   is at a different one.

3. **A session has two physical phases.** The carousel comes down and the game
   pitches go out. A block generalises to "the activities occupying the ground at
   the same time", so both setup views come free and no new entity is needed.

4. **A station bib group is not a game side.** One side may wear two colours, and
   forcing a redistribution to tidy that is unnecessary kit churn at the worst
   moment.

5. **Most of the grouping requirement is already in the schema.**
   `register_entries.bib_colour_override` is already a session-only assignment
   that writes back to nothing. The one thing missing is the club's ordering of
   its own teams, which nothing can derive: `teams` carries no order and every
   team list in the product is alphabetical.

6. **Drill Maker's delivery half is in flight** (PR #189) and its authoring half
   is the gap, on both planning surfaces. Authoring is already duplicated between
   the planner and the week plan editor, so it must go through one seam.

7. **Public sharing stays parked and blocks nothing.** The parent-facing outcome
   is met by a generated message that publishes nothing at all.

## Recommended next steps

1. **Review and merge PR #189** (DRILL-02). Already built, CI green, awaiting
   human review, a phone check and a roadmap merge conflict resolution. Not this
   programme's work.
2. **COACH-B1**, the shared authoring seam: a no-op refactor that gates every
   later authoring phase and stops week plan authoring becoming a port of dated
   authoring.

## House rules these documents follow

- Nothing is asserted about the codebase without a path, table or function to
  check it against.
- Where a fact can be derived from data already read, the proposal derives it
  rather than storing it.
- Every phase leaves OTJ usable and deployable.
- Migrations stay gated, reviewed by a human and applied by hand.
- Public sharing keeps a deliberately reduced projection.
