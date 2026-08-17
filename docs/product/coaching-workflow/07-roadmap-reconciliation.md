# Roadmap reconciliation

Status: proposal, awaiting approval. **No roadmap status has been changed by this
task.** `docs/roadmap/master-roadmap.md` gained one pointer to this document set
and nothing else.

Roadmap rule 2 says an item that ships moves to Done with its PR number rather
than being deleted, and rule 3 says a new idea starts as a one-line outcome
before a large design document is written. This programme arrived with the design
document first, which is the exception rather than the pattern, so the
reconciliation is deliberately conservative: keep every valid row, do not
renumber history, and add the smallest structure that makes the sequence
answerable.

---

## 1. Recommended structure: one umbrella programme with sub-items

Three structures were considered.

**Rewrite several existing items.** Rejected. DRILL-02 and DRILL-03 have accurate
one-line outcomes and DRILL-02 is already the agreed next item. Rewriting them
would destroy the record of what was agreed and when, which rule 2 exists to
protect.

**Twelve new independent item IDs.** Rejected. The phases only make sense in
sequence, and twelve loose rows in a table that is meant to answer "what next?"
makes it answer worse.

**One umbrella programme ID with sub-items.** Recommended. It matches how this
repository has handled multi-phase work before: the Spond linking programme ran
from #178 to #187 under SPOND-01 through SPOND-05, and Content Sharing ran as
numbered PRs under one detailed roadmap.

Proposed ID: **COACH** ("the coaching workflow programme"), with phases as
suffixed sub-items. It is a new namespace, so it collides with nothing.

## 2. Proposed rows

Added to the current roadmap table. Statuses are proposals; nothing is set until
approved.

| ID | Workstream | Item | Proposed status | Priority | Dependencies / gates |
|---|---|---|---|---|---|
| COACH-00 | Coaching workflow | End-to-end coaching workflow discovery and architecture | Done (docs only) | P1 | This document set. No code, no migration. |
| COACH-A | Coaching workflow | Show saved drill diagrams in planner, session day and live | In progress | P1 | **Is DRILL-02, implemented in open PR #189.** Not this programme's work. See section 3. |
| COACH-B1 | Coaching workflow | Extract one activity authoring seam, shared by the planner and the week plan editor | Next | P1 | Pure refactor, no user-visible change. Gates every later authoring phase. |
| COACH-B2 | Coaching workflow | Create and draw a drill from either planning surface | Next | P1 | No schema. Draft preservation across two hosts is the review. Depends on B1. |
| COACH-C | Coaching workflow | Copy and adapt a drill without rewriting history | Later | P1 | Migration M1, gated. Depends on B1. |
| COACH-D | Coaching workflow | Drill Maker authoring improvements | Later | P2 | No schema. Can run in parallel. |
| COACH-E | Coaching workflow | Week plans, promotion and two deliveries of one plan | Later | P2 | Migration M2, gated. Copy rename. |
| COACH-F | Coaching workflow | Station blocks: station identity, parallel delivery and phase-specific setup | Later | P1 | Migration M3, gated. **Duration model untouched**, so no lifecycle or ics risk. Depends on B1. |
| COACH-F2 | Coaching workflow | The game phase: attendance-aware game count and banded sides | Later | P2 | No migration beyond M3. Depends on F and G. |
| COACH-G | Coaching workflow | Team ability order, suggested groups, surfaced collisions and derived readiness | Later | P2 | Migration M6 (`teams.sort_order`), gated. Depends on COACH-F. Q9 is settled, so the scope is fixed. |
| COACH-H | Coaching workflow | Venue layout: reusable training areas | Later | P2 | Migration M4, gated. Audit label correction. |
| COACH-I | Coaching workflow | Session venue composer: place stations by position within the venue | Later | P2 | **Is DRILL-03.** Depends on F and H. |
| COACH-J | Coaching workflow | Training-day mobile delivery | Later | P1 | Depends on #189, F, G, H, I. Pull QUALITY-02 in here. |
| COACH-K | Coaching workflow | Safe group and bib share output (generated message) | Later | P2 | Depends on G. Publishes nothing. Blocks nothing. |
| COACH-K2 | Coaching workflow | Public operational projection, and DRILL-02b (publishing a diagram) | Parked | P3 | **Separate security decision. Not a prerequisite for any other row.** Relates to TRAIN-02. |
| COACH-L | Coaching workflow | Optional drill motion | Parked | P3 | Gated on evidence of use, not enthusiasm. |

## 3. How this relates to existing items

### DRILL-02 (In progress, P1): already implemented in PR #189

**Corrected after review.** The first version of this section described DRILL-02
as open and recommended designing it. It is not open: **PR #189 implements it**,
is CI green on all 10 checks, and has moved DRILL-02 to **In progress** on the
roadmap in its own diff. This programme reconciles with it rather than
redesigning it.

**Recommendation: nothing to change on the row.** #189 already sets it to In
progress with a reference to itself, and deliberately does not mark it Done
because the print and share half of its wording needs a separate decision.

**Two things this programme adopts from #189 rather than deciding for itself:**

1. **DRILL-02b**, proposed in the PR: whether a coach-drawn diagram may be
   published at all. It is adopted here as **COACH-K2**, parked, and it blocks
   nothing.
2. **Print needs no row.** #189 traced it: `window.print()` exists once in
   `src/`, in `PublicShare.tsx`, and `@media print` targets only `.public-*`.
   There is no authenticated print path, so print inherits the public share gate
   and there is nothing to schedule separately.

**One merge hazard, flagged rather than resolved.** #189 is `mergeable_state:
dirty` against current `main`, and the conflicting file is
`docs/roadmap/master-roadmap.md`, which this documentation branch also touches.
Whoever merges second must reconcile the DRILL-02 row by hand so it does not end
up asserting two different statuses. This branch only adds a pointer line in a
different section, so the conflict should be small, but it is not automatic.

### DRILL-03 (Later, P2)

**Recommendation: keep the row, keep the status, and update its dependency.**
Its acceptance criteria say, correctly, "Captured, not specified: acceptance
criteria are written when the Drill Maker and venue composer direction is
confirmed, not before." This document set is that confirmation, and the direction
it confirms adds one dependency the row does not currently carry: the composer
needs **station blocks** (COACH-F) as well as a venue model, because "which
activities are the stations?" has no answer in the data today.

So DRILL-03's dependency line becomes: DRILL-02; venue layout (COACH-H); station
blocks (COACH-F).

### TRAIN-02 (Later, P1) — safe no-login Training Day share

**Recommendation: keep the row, keep it off the critical path, and revise its
stated payload before it starts.** Reaffirmed after review: widening login-free
public sharing is **not** a prerequisite for any part of the coaching workflow
programme, and no phase depends on it. The parent-facing outcome is met by the
generated message in COACH-K, which publishes nothing.

Its current acceptance criteria say the public payload carries "name, date, time,
venue, plan". The audit found that **three of those five are on the forbidden-key
list today**, enforced on the server and independently in the browser
(`05-security-share-boundary.md` section 2). So TRAIN-02 as written is not a
projection of the existing contract; it is a widening of it, and it should be
recorded as one.

Two revisions proposed:

1. State explicitly that date, time and venue are a widening requiring their own
   confirmation and a short default expiry, not fields inherited from the
   session's rights class.
2. Add the recommendation that the **primary** output is a generated message a
   coach sends, not a public page, and that the public page is optional and
   name-free. That is COACH-K, and TRAIN-02 becomes the public half of it.

### PLAN-01 (Done, #179)

Nothing to do. Add from Library is reused unchanged by COACH-B and COACH-C. The
shared filter and selection model in `drillPicker.ts` and `drillFilter.ts` is
exactly the reuse principle 2 asks for.

### TRAIN-01 (Done, #185)

Nothing to do. The one-glance coach view of players and bibs is the foundation
COACH-J builds on, and its acceptance criteria (one count builder, no aggregate
figure on a per-player surface, works with nothing configured, parents never
reach it) carry forward unchanged as constraints on COACH-G and COACH-J.

### REG-01 (Done, #184) and the Spond set

SPOND-01 through SPOND-06 and SPOND-08 are Done and closed. Nothing in this
programme reopens them. COACH-G reads what they built and adds a draft-producing
suggestion beside it; it changes no Spond rule, persists no new Spond field and
writes nothing toward Spond.

**SPOND-07** (scheduled refresh, Later, P2) becomes more valuable once COACH-G
exists, because a coach preparing groups two days out wants replies that are
current without pressing Refresh. It is not a dependency and should not become
one: every operational surface must keep working with a manual refresh.

### Live-session items

**LIVE-01** (wake lock) and **LIVE-02** (time-up cue) become materially more
valuable under COACH-F, because a rotation cue that nobody sees is a rotation
that does not happen. Recommend re-reading their priority when COACH-F is
scheduled, not before, and not changing them now.

**LIVE-03** (persist coach notes) and **LIVE-04** (shared pause, Parked) are
unaffected.

### SHARE-01 and SHARE-02

**SHARE-01** ("complete safe public session/programme sharing where appropriate")
overlaps COACH-K's public half. Recommend keeping SHARE-01 as the content-sharing
workstream's own item and letting COACH-K depend on it rather than duplicate it,
so the content-sharing roadmap stays the authority for its own architecture.

**SHARE-02** (Share Packs, Parked, P3) is unaffected and stays parked.

### QUALITY-01 (Next, P1)

Unaffected as a row, but note the overlap: this audit has just re-read a large
part of the codebase against `docs/roadmap/product-excellence-roadmap.md`'s
subject matter. Whoever picks up QUALITY-01 should read
`00-current-state-audit.md` first; several of that roadmap's older observations
are answerable from it without re-auditing.

### QUALITY-02 (accessibility, Later, P2)

**Recommendation: fold the phone-delivery half of it into COACH-J rather than
deferring it again.** COACH-J is where tap targets, non-colour cues, keyboard
paths and screen-reader announcements are decided for the most-used screen in the
product. Doing it there is cheaper and better than retrofitting it. The rest of
QUALITY-02 (modals, live announcements elsewhere) stays as its own row.

### QUALITY-03 (error resilience, Later, P2)

Unaffected.

### OPS-02 (Later, P2)

Unaffected. It is migration-tooling work and this programme's six migrations
will benefit from it if it lands first, but none of them depends on it.

## 4. Delivery order recommendation

The current roadmap's delivery order says: continue Drill Maker with DRILL-02
before the larger venue composer DRILL-03, then pick up QUALITY-01.

**This programme agrees with that order and refines it.** DRILL-02 is COACH-A and
is already built; merging it is the cheapest possible proof that the diagram is
the right primitive for the whole training-day experience. If coaches do not use
the diagram once it is visible everywhere, the rest of the programme needs
rethinking, and that is worth knowing from one merged PR rather than after five
migrations.

Proposed sequence, revised again after the August coach discovery:

1. **Review and merge PR #189** (COACH-A / DRILL-02), including the phone check
   its own author asked for and the roadmap conflict resolution. Not new work.
2. **COACH-B1**, the shared authoring seam. A no-op refactor that gates every
   later authoring phase, and the thing that stops week plan authoring becoming a
   port of dated authoring.
3. **COACH-B2**, create and draw a drill from either surface.
4. **QUALITY-01**, unchanged, since it gates several later items and this audit
   has reduced its cost.
5. **COACH-F**, station blocks. **Moved earlier in effective priority and
   downgraded in risk**: with the duration model untouched it is no longer the
   phase that must not be rushed, and it unblocks G, I, F2 and J.
6. **COACH-H**, in parallel if capacity allows, since it is independent.
7. **COACH-G**, which now carries M6 (the team ability order) alongside the
   suggestion and readiness.
8. Then C, D, E, I, F2, J by capacity. F2 wants G for the groups and M6 for the
   banding.
9. **COACH-K** (the generated message) after G. It needs no club decision.
10. **COACH-K2** and **COACH-L** only on an explicit decision and on evidence
    respectively. Neither blocks anything.

**One ordering note worth stating.** M6 is one nullable column on a five-row
table and has no consumer until the suggestion exists, so it travels inside
COACH-G rather than ahead of it. Shipping it earlier would put an unread column
in the schema for no benefit.

## 5. What this task changed on the roadmap

One line, in the "Detailed reference roadmaps" section of
`docs/roadmap/master-roadmap.md`, pointing at this document set.

No status was changed, no row was added to the table, no row was removed, no
priority was altered and nothing was moved to Done. Rule 2 is intact and the
history is intact. The table changes only when the proposal in section 2 is
approved.
