# OTJ Training Hub master roadmap

Status: active source of truth

Last reviewed: 16 August 2026 (SPOND-01/03 closed in #187; DRILL-02 is next)

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
| SPOND-01 | Spond | Reconcile registered players ↔ Spond members, expose missing candidates and incomplete coverage | Done | P0 | Shipped in #187; duplicate-member classification now remains truthful and human-approved |
| SPOND-02 | Spond | Exclude staff/non-player Spond members from player-linking flow | Done | P0 | Shipped in #178; see the Done table |
| SPOND-03 | Spond | Replace confusing manual “Which child is this?” flow with clear member-to-player linking UX | Done | P0 | Shipped in #187; same-name already-linked member ambiguity is handled without automatic identity matching |
| SPOND-03a | Spond | Read-only setup diagnostics on the unmatched registered players section | Done | P0 | Shipped in #182; the gated `spond-link-members` deploy has since run |
| SPOND-04 | Spond | Website-wide British-English sweep: remove user-visible “roster” | Done | P1 | Shipped in #186; audit found nothing to reword, the tripwire was widened |
| SPOND-05 | Spond | Audit current Spond API/upstream library and safely usable event/member facts | Done | P1 | Shipped in #186; existing docs reconciled, nothing stored was broadened |
| OPS-01 | Operations | Reconcile hosted migration ledger pin after migration 0048 | Done | P0 | Shipped in #183; docs/tests only, no production migration |
| REG-01 | Training Day | Fix stored guest removal oscillation so Saved settles correctly | Done | P1 | Shipped in #184; client register state only, no migration, Spond or Edge change |
| PLAN-01 | Planning | Improve Add from Library: shared filters, recent ordering parity and phone-friendly single-column layout | Done | P1 | Shipped in #179; see the Done table |
| TRAIN-01 | Training Day | One-glance authorised coach view of the players in the working groups and their actual bib colours | Done | P1 | Shipped in #185; read-only Players & groups overview using existing inclusion/group/bib semantics |
| SPOND-06 | Spond | Use Spond event location to prefill/match session venue when deterministic | Done | P1 | Shipped in #186; new drafts only, no migration, no Edge change |
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

1. Continue Drill Maker with DRILL-02 before the larger venue composer DRILL-03.
2. Pick up QUALITY-01, since re-auditing the old Product Excellence roadmap gates several later items.
3. Treat destructive Registered Players changes and public Training Day sharing as separate reviewed programmes, not opportunistic additions to unrelated PRs.

REG-01, TRAIN-01 and the whole Spond polish set (SPOND-04, SPOND-05, SPOND-06) have shipped and have left this list. SPOND-01 and SPOND-03 have now shipped too, so the Spond linking programme is closed and DRILL-02 is the first active step.

## Acceptance criteria for scheduled items

Captured 15 August 2026 from the Spond linking investigation (PR #178),
folded here so there is one roadmap. Each set binds the row above it;
deeper design still happens when the item starts.

**TRAIN-01 — one-glance coach view**

- A coach holding `players.view` sees every included player for a session with their resolved bib colour (override, else team default, else none), grouped as Players &amp; groups groups them.
- Read only: nothing on the surface writes.
- Reply context comes through the same `tonightCounts` populations; no new count builder and no aggregate figure on any per player surface.
- Works with nothing configured beyond a player list; parents never reach it, tested at the screen level.

**SPOND-03a — setup diagnostics for unmatched registered players**

- Captured 15 August 2026 from production, under SPOND-01 and SPOND-03 rather
  than as a new workstream. The #178 reconciliation works: staff are excluded,
  linked players read correctly, team counts reconcile, and "Registered players
  not matched yet" exposes children who were previously invisible. The residual
  is that the section is not actionable: an Argonauts player appeared there and
  Spond showed them present in the club's parent group with no team assigned,
  which the screen could not say because the candidate list is scoped to the
  mapped subgroup and a member outside it is simply absent from it.
- The section becomes **Spond setup to fix**, one sentence per player: `In Spond
  · no team assigned`, `In Spond · assigned to another team: <team>` (or
  `another Spond subgroup` where no single mapped team resolves), `Not found in
  Spond group data`, plus `already linked to another registered player` and an
  ambiguity state. The expected OTJ team is named on the two findings about a
  Spond team assignment.
- `spond-link-members` returns a second, closed structure beside the unchanged
  `LinkCandidate` list: `{ display_name, subgroup_ids }` per member of the same
  already fetched parent group the team's mappings do not reach, plus whether
  that scan saw the whole group. No second Spond call, no member id on a
  diagnostic row, no new persisted data, no write of any kind, and staff
  excluded before any row is emitted.
- Fails closed in both directions: an incomplete scan states nothing at all, and
  a name carried by more than one Spond member is reported as ambiguous rather
  than assigned a category that implies identity. `Not found in Spond group
  data` is deliberately not "not in Spond".
- No migration. The client tolerates a deployment that does not answer yet, so
  merging is safe before the gated `spond-link-members` deploy runs.

**SPOND-01 and SPOND-03 — closeout audit, 15 August 2026**

Audited against current `main`, the deployed Edge Functions and the hosted
database rather than against the roadmap's own wording. Both rows stayed **In
progress** on that date, for one reason, stated below and since closed in #187.
Nothing was implemented for this audit.

- **Every defined product outcome is shipped**, each with executing tests:
  staff and non-player exclusion before the cap and before the reduction;
  human-approved linking, with `matched_by` admitting only `suggested` and
  `chosen` because no server side matcher exists; the missing registered
  player diagnostics and their three sentences; no automatic name linking
  anywhere; ambiguity failing closed on both the Spond side and the player
  side; explicit member selection, with "Which child is this?" gone and
  pinned gone; incomplete candidate data stating nothing in either
  direction; and `SPOND_IGNORED_MEMBER_IDS` as the operational backstop,
  parsed through the same character class the links column enforces.
- **The gated `spond-link-members` deploy has run.** The roadmap said three
  times that it had not. Reading the deployed source back (the check
  `CLAUDE.md` requires, never a version number) shows the live function at
  version 3, deployed 15 August 2026, carrying `collectLinkDiagnostics`,
  `diagnosticsProved`, `SPOND_DIAGNOSTIC_MEMBER_FIELDS` and the
  `diagnostic_members` / `diagnostic_complete` reply fields. The diagnostics
  are live, so the unmatched section is answering rather than falling back
  to "Not compared against the Spond group data".
- **What is left is one client defect, and it is the duplicate member case.**
  Once a child is linked to one Spond member, that child leaves
  `unlinkedByName`, so a SECOND Spond member carrying the same name finds no
  match at all and takes the `not_on_roster` branch before the ambiguity
  check is ever reached. It renders as **"Not a registered player"**, which
  is false about a child who is registered and linked, and it renders it in
  the one section the screen designates as its highest value outcome, a
  child who is in Spond and missing from the player list. A manager reading
  that row is being invited to add somebody who is already there. The player
  side already has the honest wording for the mirror of this shape
  (`name_taken`, "that name is already linked to another registered
  player"); the member side has no equivalent, its reason union carrying
  three values.
- That is an OTJ defect rather than Spond hygiene. The duplicate in Spond is
  the club's to resolve and the product is right to refuse to guess between
  two unlinked members; describing the leftover one as unregistered is our
  sentence, not Spond's.
- **The fix is one reason value and one sentence**, entirely within
  `src/lib/spondLinking.ts` and `src/routes/SpondLinks.tsx`. No Edge Function
  change, no migration, no new screen, and no duplicate member management
  feature. It was deliberately not built in #186, which is a frontend, docs
  and tests programme.
- One latent gap recorded so it is not rediscovered: a registration with no
  team appears in no suggestion pool, no unmatched section and no picker, so
  it cannot be linked by any route. Every current season registration has a
  team today (38 of 38), so this is not a live defect.

**SPOND-01 and SPOND-03 — the closeout fix, shipped 16 August 2026 in #187**

- Built as described above and no wider. The reason union gains `name_taken`,
  the mirror of the player side's state of the same name, and the row reads
  "Same name as a registered player who is already linked". That is the
  deterministic data fact and the whole claim: same normalised name, a
  registered player in the same pool a suggestion may match, that player's one
  link already spent on a different member. It does not say duplicate child,
  duplicate account, same person or wrong Spond record, because two equal names
  prove none of those and the club may hold two children of one name. Choose
  stays on the row, so the case where they are two different children is
  resolved the way it always was, by a human.
- The presentation carried the other half. The sub line was a conditional chain
  whose default arm was "Not a registered player", so every case it did not
  name rendered as that one; it is a `Record` keyed on the union now, and the
  union has one home rather than a copy in the screen, so the compiler refuses
  a reason with no sentence.
- `SPOND_IGNORED_MEMBER_IDS` is untouched: exact opaque ids in a function
  secret, no ignore by name, no ignore UI, no change to the secret's format.
  Identifying which opaque id to ignore is an operational runbook question,
  deliberately separate from this client defect.
- Production re-verified 16 August, read only and aggregates only: 38 current
  season registrations, 0 with no team, 0 withdrawn, 0 names shared by more
  than one registration, 24 links over 24 distinct players. Zero shared names
  on the OTJ side is what makes `name_taken` the right classification rather
  than an ambiguity: the duplicate is entirely Spond side. Zero registrations
  with no team confirms the latent gap above is still latent and is correctly
  not addressed here.
- Both rows are Done. The Spond linking programme that ran from #178 through
  #187 is closed, and nothing in its scope is outstanding: the one recorded
  latent item, a registration with no team, stays latent and is deliberately
  not carried forward as work.

**SPOND-06 — event location to venue**

- Production evidence (15 Aug 2026, re-verified against the hosted database before implementing): exact case insensitive equality matches zero of the nine distinct stored locations; unique case insensitive whole word containment of the venue name matches 7 of 14 events with zero false positives and zero ambiguity; one production session shows human venue choice can disagree with the event location (a session at Flushdyke whose event says Woodkirk Academy).
- `location` joins the client `SpondEvent` shape as an event fact; a pure `matchVenueByLocation` returns a venue id only on exactly one whole word match, null otherwise, no regex built from user text.
- Seeds `venueId` on new Plan from Spond drafts only: no match leaves the venue unset, the frozen free text `sessions.venue` is never written, linking an event to an existing session changes no venue, and no existing row is backfilled by a page render. No migration.
- Tests pin the production positives and negatives, the ambiguity refusal and the substring non match ("Wood" never matches "Woodkirk").
- Delivered in #186. The column existed since `0013_spond.sql` and the deployed sync has always written it, so this was a client read and a pure rule; no migration and no Edge Function change.

**TRAIN-02 — public training day share**

- Public payload carries session facts only: name, date, time, venue, plan. No player name, register entry, bib, Spond figure or member id; a test asserts the serialised response against that list.
- Minted and revoked through the existing share tables and capabilities; no new auth surface or token scheme.
- Separate security review before merge; starts after TRAIN-01, whose composed view it shares.

**PLAYERS-01 — bulk delete**

- Explicit multi select with a count, never all by default; a dependency preview names what each deletion touches (register entries, Spond links and their cascaded replies, board tokens) before anything runs.
- Explicit confirmation naming the number deleted; one transaction, so a partial failure deletes nobody.
- Session history is never silently destroyed: removals that would orphan register entries are surfaced, and the chosen semantics are stated on screen.
- Audit events per run; concurrency tests for overlapping selections; destructive change review gate.

**DRILL-03 — venue/pitch composer**

- Captured, not specified: acceptance criteria are written when the Drill Maker and venue composer direction is confirmed, not before. Do not implement ahead of that decision.

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
| PLAN-01 — Add from Library session planning | #179 | 15 Aug 2026 |
| SPOND-02 — staff and non-player Spond members excluded from linking | #178 | 15 Aug 2026 |
| SPOND-03a — setup diagnostics for unmatched registered players | #182 | 15 Aug 2026 |
| OPS-01 — hosted ledger reconciliation after 0048 | #183 | 15 Aug 2026 |
| REG-01 — stored guest removal settles correctly | #184 | 15 Aug 2026 |
| TRAIN-01 — session day player and bib overview | #185 | 15 Aug 2026 |
| SPOND-04 — British English copy sweep and a widened tripwire | #186 | 15 Aug 2026 |
| SPOND-05 — Spond API and boundary documents reconciled with the code | #186 | 15 Aug 2026 |
| SPOND-06 — deterministic Spond location to venue prefill | #186 | 15 Aug 2026 |
| SPOND-01 — registered players reconciled against Spond members | #187 | 16 Aug 2026 |
| SPOND-03 — member-to-player linking UX, duplicate-member case included | #187 | 16 Aug 2026 |

Update this table as subsequent roadmap items ship.