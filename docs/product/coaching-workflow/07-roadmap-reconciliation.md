# Roadmap reconciliation

Status: proposal, reconciled 18 August 2026. **No status in
`docs/roadmap/master-roadmap.md` has been changed by this task**, beyond two
factual corrections named in section 5. The table changes when the proposal in
section 2 is approved.

---

## 1. Pull request state, verified rather than assumed

Read from GitHub on 18 August 2026, not carried forward from the previous
revision, which described two of these as open.

| PR | State | What it is | Relationship to this programme |
|---|---|---|---|
| **#189** | **Merged**, in `main` at `afe790d` | DRILL-02's authenticated half: saved drill diagrams on the planner, session day and both live stages | **Delivered.** Its seam is what COACH-7 mounts. No longer any part of this plan. |
| **#195** | **Merged**, in `main` at `df41895` | OPS-02, production migration probe totality | Done on the roadmap already. Its tooling benefits this programme's four migrations. |
| **#191** | **Open, draft** | PLAYERS-01, bulk permanent deletion, carrying migration `0050_bulk_delete_players.sql` | **Stays separate.** Nothing from this programme belongs in it, and it claims the next migration number. |
| **#196** | **Open**, not a draft, `mergeable_state: clean`, based on `2283350` | Drill Maker opening a new diagram on a blank area | **Stays separate.** A focused default change with no schema. |

**There was no open pull request for the coaching workflow discovery branch**
before this reconciliation, checked by listing pull requests filtered on both the
discovery branch and this one.

**Two corrections to the previous revision, which is where the stale references
came from.** It recorded #189 as open with a merge conflict and no human review,
and it recorded a merge hazard on `docs/roadmap/master-roadmap.md` between #189
and the discovery branch. Both are resolved: #189 merged, and the roadmap
conflict was resolved on the way in.

## 2. Proposed rows

Added to the current roadmap table. Statuses are proposals; nothing is set until
approved. The namespace **COACH** is new and collides with nothing.

**Only COACH-2A is Done.** A settled design is not delivered work, and the one
slice that has been built is named as built rather than left to be inferred from
the table below.

| ID | Workstream | Item | Proposed status | Priority | Dependencies / gates |
|---|---|---|---|---|---|
| COACH-00 | Coaching workflow | End-to-end coaching workflow discovery, architecture and post-discovery reconciliation | Done (docs only) | P1 | This document set. No code, no migration. |
| COACH-1 | Coaching workflow | The club's team order (`teams.sort_order`) and an admin reorder | Later | P1 | Migration M1, gated, and sequenced against the hosted ledger rather than by filename. The one irreducible new fact. |
| COACH-2A | Coaching workflow | The activity structure model: `slot`, `skipped`, the derivation module and the active session duration in all four implementations | **Done** | P1 | **No migration.** Two keys in the existing activity jsonb. Leaves one content-sharing Edge Function deploy outstanding. |
| COACH-2B | Coaching workflow | The authoring affordances: mark a station or the games phase, and a Not running tonight toggle on a dated session | Next | P1 | No migration. Depends on COACH-2A. Gates COACH-3, COACH-6, COACH-7, COACH-8. |
| COACH-3 | Coaching workflow | Suggested setup from confirmed attendance: station count, groups, unique colours, readiness | Next | P1 | No schema. Depends on COACH-2, wants COACH-1 and degrades honestly without it. |
| COACH-4 | Coaching workflow | Preserve the coach's setup when attendance changes | Next | P1 | No schema. Depends on COACH-3. |
| COACH-5 | Coaching workflow | Venue layouts scoped to venue, season and age group: four and five station layouts, one and two game visuals, admin owned | Later | P1 | Migration M2, gated, and the largest review here. New table, new shape boundary. Independent. |
| COACH-6 | Coaching workflow | The setup map on session day | Later | P1 | Depends on COACH-2 and COACH-5. |
| COACH-7 | Coaching workflow | The full screen station detail, browsing only | Later | P1 | Depends on COACH-6. Pull the phone half of QUALITY-02 in here. |
| COACH-8 | Coaching workflow | The game plan and a separate game bib | Later | P2 | Migration M3, gated. Depends on COACH-3, wants COACH-1 and COACH-5. |
| COACH-9 | Coaching workflow | Keep the protected session share reachable, and pin its payload | Later | P2 | No schema. Mostly a test. |
| COACH-10 | Coaching workflow | One shared activity authoring seam | Next | P1 | Pure refactor, no user-visible change, no migration. Gates COACH-11 and COACH-12. |
| COACH-11 | Coaching workflow | Create and draw a drill from either planning surface | Later | P1 | No schema. Depends on COACH-10. |
| COACH-12 | Coaching workflow | Adapt a drill for one session, unlisted, with Save as reusable | Later | P2 | Migration M4, gated. Depends on COACH-10. |
| COACH-13 | Coaching workflow | Week plan naming, promotion and two deliveries of one plan | Later | P2 | No schema. |
| COACH-P1 | Coaching workflow | Drill Maker authoring improvements | Parked | P2 | No schema. Pick up on capacity. |
| COACH-P2 | Coaching workflow | Optional drill motion | Parked | P3 | Gated on evidence of use, not enthusiasm. |

**Rows that existed in the previous proposal and are withdrawn:** COACH-A (it is
#189 and it merged), COACH-F and COACH-F2 (station blocks and the block-hosted
game phase, both removed), COACH-I as a weekly composer (venue layouts replace
it), COACH-K (the generated message, withdrawn), COACH-K2 (a public operational
projection, which belongs to TRAIN-02 and to DRILL-02b rather than to this
programme).

## 3. How this relates to existing items

### DRILL-02 (In progress, P1)

**#189 merged.** The authenticated surfaces are delivered and in `main`. The row
correctly stays **In progress** rather than Done, because its print and public
share half is deliberately held as **DRILL-02b**.

**Recommendation: no status change**, and one wording correction so the header
line does not read as though #189 were still open (section 5).

**DRILL-02b stays where #189 left it**, outside this programme. It would require
changing the Edge `DRILL_COLS`, `projectDrillFields`, `TOP_ALLOWED` and
`REF_DRILL_ALLOWED`, removing `'diagram'` from `FORBIDDEN_ANYWHERE`, the three
client snapshot types and their mirrored key sets, redeploying both Edge
Functions, and refreshing every existing share because a snapshot is frozen. It
is a prerequisite for nothing here.

**Print needs no row.** #189 traced it: `window.print()` exists once in `src/`,
in `PublicShare.tsx`, and `@media print` targets only `.public-*`. There is no
authenticated print path, so print inherits the public share gate.

### DRILL-03 (Later, P2)

**Recommendation: keep the row and correct its dependency.** Its acceptance
criteria say the criteria are written when the Drill Maker and venue composer
direction is confirmed. This set is that confirmation, and the direction changed:

- The composer is **not weekly**. It is an **admin owned venue layout scoped to
  venue, season and age group** (COACH-5), loaded automatically from the station
  count, and a session stores no geometry.
- It needs the **declared station list** (COACH-2), not a station block column.

So DRILL-03's dependency line becomes: venue layouts (COACH-5); declared stations
(COACH-2). Two earlier proposals are withdrawn with it: a station blocks
dependency, and a venue-only layout scope.

### TRAIN-02 (Later, P1) safe no-login Training Day share

**Recommendation: keep the row, keep it off the critical path, and keep its
payload question with it rather than in this document set.**

Nothing in this programme depends on it. The coach-to-coach sharing requirement
is met by the protected link that already ships, and no phase reads or writes a
share.

One factual note for whoever picks it up: its stated payload of "name, date,
time, venue, plan" is a **widening** of the current contract rather than a
projection of it. Date, time and venue are refused today on the server, because
the builder never reads those columns, and independently in the browser, because
all three are on the forbidden-key list. A snapshot carrying them says "a group
of children will be at this place at this time" on a login-free URL that anyone
can forward. That is a club decision with its own security review, and this
programme neither needs it nor blocks on it.

### PLAYERS-01 (Later, P2) and open draft #191

Unaffected, and **kept strictly separate**. It carries migration `0050`, so this
programme's first migration is `0051` at the earliest, confirmed against the
hosted ledger.

### PLAN-01 (Done, #179) and TRAIN-01 (Done, #185)

Reused by COACH-11 unchanged. **COACH-12 changes what it reads**: the picker and
the Library screen share one unfiltered `useDrills()`, so both move to the
reusable-library read that excludes unlisted adaptations. The
one-glance coach view is the foundation COACH-6 builds on, and its acceptance
criteria carry forward unchanged as constraints on COACH-3 and COACH-6: one count
builder, no aggregate figure on a per-player surface, works with nothing
configured, parents never reach it.

### The Spond set, and SPOND-07

SPOND-01 through SPOND-06 and SPOND-08 are Done and closed. Nothing here reopens
them. COACH-3 reads what they built and adds a draft-producing suggestion beside
it; it changes no Spond rule, persists no new Spond field and writes nothing
toward Spond.

**SPOND-07** (scheduled refresh) becomes more valuable once COACH-3 exists,
because a coach preparing groups two days out wants current replies without
pressing Refresh. It is not a dependency and must not become one: every
operational surface keeps working with a manual refresh.

### Live-session items

**Correction to the previous revision.** It said LIVE-01 (wake lock) and LIVE-02
(time-up cue) become materially more valuable under station blocks, because a
rotation cue nobody sees is a rotation that does not happen. **That reasoning is
withdrawn**: OTJ does not cue rotations and does not track them. Coaches keep
track of the rotation themselves.

**LIVE-01 through LIVE-04 are unaffected by this programme**, and the live
session view is explicitly out of its scope.

### SHARE-01 and SHARE-02

**SHARE-01** stays the content-sharing workstream's own item. This programme
neither depends on it nor duplicates it, since the generated message is
withdrawn. **SHARE-02** stays parked.

### QUALITY-01 (Next, P1)

Unaffected as a row. Whoever picks it up should read `00-current-state-audit.md`
first: several older observations in the Product Excellence roadmap are
answerable from it without re-auditing.

### QUALITY-02 (accessibility, Later, P2)

**Recommendation: fold the phone-delivery half into COACH-7** rather than
deferring it again. COACH-7 is where tap targets, non-colour cues, keyboard paths
and screen-reader announcements are decided for what will become the most-used
screen in the product. The rest of QUALITY-02 stays as its own row.

### QUALITY-03 and OPS-02

QUALITY-03 unaffected. **OPS-02 is Done** (#195), and its hardened probe
totality checks apply to all four migrations proposed here.

## 4. Delivery order recommendation

The current roadmap's order says finish DRILL-02, then pick up QUALITY-01, and
treat destructive Registered Players changes and public Training Day sharing as
separate reviewed programmes. **That order still holds and this programme fits
after it rather than in front of it.**

### Migration sequencing, stated because it constrains the order

**Open draft PR #191 owns reviewed migration `0050`. This programme does not
modify it, does not depend on it, and must not assume it.**

The reviewed register
(`.github/scripts/production-migration/reviewed_migrations.py`) pins every
migration to the hosted ledger head it was written against, through
`expected_previous_version` and `expected_previous_name`. So a file number
reserves nothing, a register entry cannot be written before its head is known,
and no coaching migration is authored as "the one after 0050" while `0050` is
unresolved. Each is numbered and registered at the moment it is ready for its own
application review, against the live ledger as it stands then.

**The non-migration slices are not sequenced by any of that** and proceed on
their own dependencies.

### Proposed sequence

1. **DRILL-02b or a decision to leave it**, so the DRILL-02 row can close or be
   restated. Not this programme's work.
2. **QUALITY-01**, unchanged, since it gates several later items and this audit
   has reduced its cost.
3. **COACH-2**, declaring stations and games. No migration, and the root of the
   operational track.
4. **COACH-3**, the suggested setup, then **COACH-4**.
5. **COACH-10**, the authoring seam, whenever capacity allows. No migration.
6. **COACH-1** (M1), the first gated coaching migration, timed against the
   ledger.
7. **COACH-5** (M2), the venue layouts table, then **COACH-6** and **COACH-7**.
8. **COACH-8** (M3), the game plan. **COACH-9** any time.
9. **COACH-11**, **COACH-12** (M4) and **COACH-13** on the authoring track.
10. COACH-P1 and COACH-P2 on capacity and on evidence respectively.

**#191 and #196 proceed on their own merits and are not sequenced by this
programme.**

## 5. What this task changed outside these documents

Two factual corrections in `docs/roadmap/master-roadmap.md`, and nothing else:

1. The **Last reviewed** header line, so DRILL-02's authenticated half reads as
   merged in #189 rather than in progress in an open pull request.
2. The **detailed reference roadmaps** pointer to this document set, so it
   describes the reconciled set rather than the superseded twelve-phase plan.

**No status was changed, no row was added to the table, no row was removed, no
priority was altered and nothing was moved to Done.** Roadmap rule 2 is intact
and the history is intact.
