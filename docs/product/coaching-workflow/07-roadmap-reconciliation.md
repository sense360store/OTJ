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
| COACH-A | Coaching workflow | Show saved drill diagrams in planner, session day and live | Next | P1 | **Is DRILL-02.** See section 3. |
| COACH-B | Coaching workflow | Create and draw a drill without leaving the planner | Next | P1 | No schema. Draft preservation is the review. |
| COACH-C | Coaching workflow | Copy and adapt a drill without rewriting history | Later | P1 | Migration M1, gated. |
| COACH-D | Coaching workflow | Drill Maker authoring improvements | Later | P2 | No schema. Can run in parallel. |
| COACH-E | Coaching workflow | Week plans, promotion and two deliveries of one plan | Later | P2 | Migration M2, gated. Copy rename. |
| COACH-F | Coaching workflow | Station blocks: parallel stations and honest session duration | Later | P1 | Migration M3, gated. Touches lifecycle and ics. |
| COACH-G | Coaching workflow | Suggested groups and derived readiness | Later | P2 | Depends on COACH-F. No schema. |
| COACH-H | Coaching workflow | Venue layout: reusable training areas | Later | P2 | Migration M4, gated. Audit label correction. |
| COACH-I | Coaching workflow | Session venue composer: place the week's stations | Later | P2 | **Is DRILL-03.** Depends on F and H. |
| COACH-J | Coaching workflow | Training-day mobile delivery | Later | P1 | Depends on A, F, G, H, I. Pull QUALITY-02 in here. |
| COACH-K | Coaching workflow | Safe group and bib share output | Later | P2 | **Supersedes TRAIN-02's scope.** Security review. |
| COACH-L | Coaching workflow | Optional drill motion | Parked | P3 | Gated on evidence of use, not enthusiasm. |

## 3. How this relates to existing items

### DRILL-02 (Next, P1)

**Recommendation: keep the row, keep the status, and record that COACH-A is the
same work.** Do not renumber it and do not mark it superseded. Its outcome
("Show existing drill diagrams across Planner, Session Day, Live and print/share
views") is accurate and the audit confirms it is genuinely open: `drills.diagram`
is read only by `DrillDetail.tsx` and `DrillDiagramEditor.tsx`.

One narrowing this programme proposes: DRILL-02's wording includes **print and
share** views. Publishing a diagram is a rights and free-text decision
(`05-security-share-boundary.md` section 5), not a rendering one. Recommend
splitting the share half out to COACH-K so DRILL-02 stays a small, shippable,
no-schema PR.

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

**Recommendation: keep the row, and revise its stated payload before it starts.**

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

Unaffected. It is migration-tooling work and this programme's five migrations
will benefit from it if it lands first, but none of them depends on it.

## 4. Delivery order recommendation

The current roadmap's delivery order says: continue Drill Maker with DRILL-02
before the larger venue composer DRILL-03, then pick up QUALITY-01.

**This programme agrees with that order and refines it.** DRILL-02 is COACH-A, it
is still the right next thing, and this document set has now given it a reason
beyond "it is next": it is the cheapest possible proof that the diagram is the
right primitive for the whole training-day experience. If coaches do not use the
diagram once it is visible everywhere, the rest of the programme needs
rethinking, and that is worth knowing after one small PR rather than after five
migrations.

Proposed sequence:

1. **COACH-A** (DRILL-02). Small, no schema, already agreed.
2. **COACH-B**. The workflow gap coaches actually feel.
3. **QUALITY-01**, unchanged, since it gates several later items and this audit
   has reduced its cost.
4. **COACH-F**, because it unblocks G, I and J and because its arithmetic is the
   riskiest thing in the programme and should not be rushed at the end.
5. **COACH-H**, in parallel if capacity allows, since it is independent.
6. Then C, D, E, G, I, J by capacity.
7. **COACH-K** only after a club decision on section 3's TRAIN-02 revision.
8. **COACH-L** only on evidence.

## 5. What this task changed on the roadmap

One line, in the "Detailed reference roadmaps" section of
`docs/roadmap/master-roadmap.md`, pointing at this document set.

No status was changed, no row was added to the table, no row was removed, no
priority was altered and nothing was moved to Done. Rule 2 is intact and the
history is intact. The table changes only when the proposal in section 2 is
approved.
