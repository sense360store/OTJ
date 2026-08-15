# OTJ Training Hub master roadmap

Status: active source of truth

Last reviewed: 15 August 2026

This file is the short, operational roadmap for the product. Detailed design documents remain authoritative for their specialist areas, but priority and delivery status live here so there is one answer to “what next?”.

## Status key

- **In progress** — actively being worked on now.
- **Next** — ready to pick up once an in-progress item frees capacity.
- **Later** — agreed direction, not yet scheduled.
- **Parked** — intentionally deferred pending evidence, design or dependency.
- **Done** — shipped; retain the PR number so work is not rediscovered.

Priority is P0 (blocking/urgent) through P3 (nice to have).

## Current roadmap

| ID | Workstream | Item | Status | Priority | Dependencies / gates |
|---|---|---|---|---|---|
| SPOND-01 | Spond | Reconcile registered players ↔ Spond members, expose missing candidates and incomplete coverage | In progress | P0 | Human-approved linking; privacy boundary; Edge review if touched |
| SPOND-02 | Spond | Exclude staff/non-player Spond members from player-linking flow | In progress | P0 | Prefer role/staff signal or server-side ignored opaque member IDs |
| SPOND-03 | Spond | Replace confusing manual “Which child is this?” flow with clear member-to-player linking UX | In progress | P0 | SPOND-01 |
| SPOND-04 | Spond | Website-wide British-English sweep: remove user-visible “roster” | In progress | P1 | Internal technical names may remain |
| SPOND-05 | Spond | Audit current Spond API/upstream library and safely usable event/member facts | In progress | P1 | Read-only toward Spond; no new client/fork without a proved gap |
| OPS-01 | Operations | Reconcile hosted migration ledger pin after migration 0048 | Next | P0 | Docs/tests only; no production migration |
| REG-01 | Training Day | Fix stored guest removal oscillation so Saved settles correctly | Next | P1 | Separate from Spond work |
| PLAN-01 | Planning | Improve Add from Library: shared filters, recent ordering parity and phone-friendly single-column layout | Next | P1 | No migration/Edge dependency expected |
| TRAIN-01 | Training Day | One-glance authorised coach view of attending players and their actual bib colours | Next | P1 | Spond/player semantics stable first |
| SPOND-06 | Spond | Use Spond event location to prefill/match session venue when deterministic | Next | P1 | Never fuzzy-overwrite or auto-create venue data |
| DRILL-02 | Drill Maker | Show existing drill diagrams across Planner, Session Day, Live and print/share views | Next | P1 | Builds on Drill Maker C1; no schema change expected |
| TRAIN-02 | Training Day | Safe no-login Training Day share | Later | P1 | Separate security-reviewed public projection; never expose player/Spond/private register data |
| DRILL-03 | Drill Maker | Venue/pitch session composer showing how drills are laid out across training areas | Later | P2 | DRILL-02; venue/session design likely required |
| PLAYERS-01 | Registered Players | Bulk select and bulk delete with dependency preview, explicit confirmation and history safety | Later | P2 | Destructive-change review; no silent history loss |
| SPOND-07 | Spond | Scheduled/automatic Spond refresh with visible freshness/failure state | Later | P2 | Rate behaviour and scheduling review |
| LIVE-01 | Live session | Screen wake lock while delivering a session | Later | P2 | Browser capability/fallback |
| LIVE-02 | Live session | Unmissable time-up cue and improved live connectivity/offline state | Later | P2 | Coordinate with accessibility |
| LIVE-03 | Live session | Persist coach session/activity notes across devices | Later | P2 | Likely migration/security review |
| LIVE-04 | Live session | Shared pause state for driver/watchers if still needed after re-audit | Parked | P2 | Reconfirm current friction first |
| SHARE-01 | Sharing | Complete safe public session/programme sharing where appropriate | Later | P2 | Existing content-sharing security boundary |
| SHARE-02 | Sharing | Multi-item Share Packs | Parked | P3 | Follow single-item session/programme sharing |
| QUALITY-01 | Product quality | Re-audit old Product Excellence roadmap against current code and retire completed/stale items | Next | P1 | Do not implement from PR #100-era evidence without rechecking |
| QUALITY-02 | Product quality | Core accessibility pass: modal focus, non-colour cues, live announcements, keyboard paths | Later | P2 | Coordinate with planning/live work |
| QUALITY-03 | Product quality | Error resilience and explicit retry/recovery where silent failures remain | Later | P2 | Re-audit current state first |

## Delivery order

When there is capacity, prefer this sequence unless production evidence changes the order:

1. Finish current Spond/player-linking correction.
2. Land OPS-01 as a tiny housekeeping PR.
3. Run PLAN-01 in parallel with non-overlapping Spond work.
4. Ship TRAIN-01 and SPOND-06 once the current player/Spond semantics are stable.
5. Continue Drill Maker with DRILL-02 before the larger venue composer DRILL-03.
6. Treat destructive Registered Players changes and public Training Day sharing as separate reviewed programmes, not opportunistic additions to unrelated PRs.

## Detailed reference roadmaps

These documents contain deeper design history and security decisions. They do not override the status/priority table above.

- `docs/roadmap/product-excellence-roadmap.md` — older product-quality survey; re-audit before implementation because it was grounded much earlier in the codebase.
- `docs/roadmaps/registered-players-delivery-plan.md` — detailed Registered Players programme and data-model history.
- `docs/roadmaps/content-sharing-roadmap.md` — public content-sharing architecture and security model.
- `docs/roadmaps/share-packs-roadmap.md` — later multi-item public sharing design.
- `docs/roadmap/foundation-retrospective.md` — completed security/foundation programme history.

## Roadmap rules

1. Every implementation PR updates the relevant row when it changes status.
2. When an item ships, move it to **Done** with the PR number and merge date rather than deleting it.
3. New ideas start here as one-line outcomes before a large design document is written.
4. Production incidents and data-integrity defects outrank feature work until contained.
5. Do not combine unrelated migration, Edge Function, destructive-data and public-sharing changes into one PR.
6. User-facing language should use British English. Prefer **registered players**, **players**, **team** or **squad** by context; do not use “roster” in product copy.
7. Spond remains read-only from OTJ except authentication. Do not expand stored personal data without an explicit security decision.
8. Public sharing must always use a deliberately reduced projection; authenticated operational/player data is never made public by convenience.

## Done

| Item | PR | Date |
|---|---|---|
| Training-first sessions / All events widening | #165 | 11 Aug 2026 |
| Training Day “Players & groups” foundation | #167, #172, #176 | 11–15 Aug 2026 |
| Session lifecycle and stale-live corrections | #166, #172, #174 | 11–12 Aug 2026 |
| Spond population/count presentation and event classification | #168, #175 | 11–15 Aug 2026 |
| Drill Maker C1 diagram editor | #169 | 11 Aug 2026 |
| Gated production migration workflow | #170 | 11 Aug 2026 |
| Production migration ledger reconciliations through 0047 | #171, #173 | 12 Aug 2026 |

Update this table as subsequent roadmap items ship.