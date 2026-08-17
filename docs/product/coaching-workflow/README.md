# Coaching workflow programme

Living design documents for the end-to-end coaching workflow overhaul:
programmes, sessions, drills, Drill Maker, the drill library, Spond attendance,
groups and bibs, venue and pitch layout, training-day delivery and shareable
outputs.

**Status: direction approved as the working model; several parts revised after
review and awaiting implementation authorisation. No application or database
behaviour has been implemented by this document set.**

Captured 17 August 2026 against `main` at `2283350`, and revised the same day
after review. The revision corrected four things: Phase A is reconciled with open
PR #189 rather than redesigned, station placement carries a position rather than
only a sub-area id, "a group is a bib colour" is reopened as a product question,
and the station duration claim is corrected against the arithmetic.

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
| 03 | [Target UX journeys](03-ux-journeys.md) | Seven journeys, the components each reuses, and the mobile interaction decision. |
| 04 | [Data model proposal](04-data-model-proposal.md) | The five anticipated migrations, and the three deliberate non-changes. |
| 05 | [Security, privacy and share boundary](05-security-share-boundary.md) | Why the existing public contract cannot carry a group plan, and what to do instead. |
| 06 | [Phased implementation plan](06-phased-plan.md) | Twelve phases, each independently shippable, plus the adversarial pass. |
| 07 | [Roadmap reconciliation](07-roadmap-reconciliation.md) | How this relates to DRILL-02, DRILL-03, TRAIN-02 and the rest. |
| 08 | [Open questions](08-open-questions.md) | Eight decisions needing human input. Only one blocks any work. |

## The findings that shaped everything else

1. **Station-based training has no representation at all.** Not a duration
   defect: four ten-minute stations over four rotations lasts forty minutes and
   the current sum says forty. What is missing is **station identity** (nothing
   says which activities form one carousel), **rotation count** (the thing
   attendance changes), and **parallel delivery** (the live view walks stations in
   series and has no concept of "rotate"). The total is correct until the
   operational layer adjusts the group count, and wrong from then on.

2. **Drill Maker's delivery half is in flight, and its authoring half is the
   gap.** PR #189 puts the saved diagram on the planner, session day and both
   live stages. What remains is that a drill still cannot be created without
   leaving the plan being written, on either planning surface.

3. **Authoring is already duplicated.** The planner and the week plan editor each
   keep their own activity list, add bar, custom activity literal and row
   component. Long range planning happens in the week plan editor, so any
   authoring work must go through one shared seam or diverge three ways.

4. **Venue is a word.** `venues` carries a name and nothing else, so there is no
   coordinate space to build on. A station needs a position within the allocated
   area, not just a pitch, or two stations on one pitch are indistinguishable.

5. **Public sharing is deliberately incapable of carrying an operational plan.**
   Every field a group and bib plan is made of sits on a deny list enforced twice.
   The recommended answer publishes nothing at all, and no phase depends on
   widening it.

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
