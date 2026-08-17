# Coaching workflow programme

Living design documents for the end-to-end coaching workflow overhaul:
programmes, sessions, drills, Drill Maker, the drill library, Spond attendance,
groups and bibs, venue and pitch layout, training-day delivery and shareable
outputs.

**Status: architecture and design pass complete, awaiting approval. No
application or database behaviour has been implemented.**

Captured 17 August 2026 against `main` at `2283350`.

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

## The three findings that shaped everything else

1. **The session model is a linear timeline, and station training is parallel.**
   Four ten-minute stations read as forty minutes of sequential work, the live
   timer runs them in series, and there is no data answer to "which activities are
   the stations?". This is the one structural addition the programme makes.

2. **Drill Maker is finished as a model and unfinished as a workflow.** The
   diagram schema, its identity boundary and the editor are all sound. The
   diagram is invisible in the planner, on session day and in the live view, and
   a drill cannot be created without leaving the session being planned.

3. **Public sharing is deliberately incapable of carrying an operational plan.**
   Every field a group and bib plan is made of sits on a deny list enforced twice.
   Any share of groups and bibs is a new, separately reviewed decision, and the
   recommended answer publishes nothing at all.

## Recommended first phase

**COACH-A, which is roadmap item DRILL-02**: show saved drill diagrams in the
planner, on session day and in the live view. No schema change, already agreed as
Next, and the cheapest possible proof that the diagram is the right primitive for
the whole training-day experience.

## House rules these documents follow

- Nothing is asserted about the codebase without a path, table or function to
  check it against.
- Where a fact can be derived from data already read, the proposal derives it
  rather than storing it.
- Every phase leaves OTJ usable and deployable.
- Migrations stay gated, reviewed by a human and applied by hand.
- Public sharing keeps a deliberately reduced projection.
