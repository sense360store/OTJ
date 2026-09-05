# OTJ Training Hub master roadmap

Status: active source of truth

Last reviewed: 4 September 2026 (VISUAL-01 delivered in #211; VISUAL-02 in progress, adopted route by route in seven pull requests, #212 to #218, with Home, Sessions and the remaining admin screens still to come; the coaching workflow's four migration-free slices COACH-2, COACH-3, COACH-4 and COACH-10 shipped in #198, #202, #203, #204, #206 and #207, and COACH-1, the club team order, is built on two gated migrations: COACH-1A, `0051_team_sort_order`, merged as #223 and applied on 2 September 2026 (hosted `20260902150212` / `team_sort_order`), and `0052_atomic_team_order`, which adds the transactional writer `set_team_order` because a whole order saved from the browser as separate compare and set statements cannot stop two admins moving disjoint rows and leaving a valid order neither submitted, merged as #226 and applied on 4 September 2026 (hosted `20260904174142` / `atomic_team_order`), with COACH-1B, the Teams screen's ordering affordance, calling that function for its Save; PLAYERS-01 and #196 both merged on 27 August; DRILL-02's public/share half remains separately gated)

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
| OPS-02 | Operations | Harden production migration probe-totality validation for non-function textual privilege lookups | Done | P2 | Shipped in #195; tooling, tests and docs only, no migration, register, Edge or production change. `assert_probe_is_total` now judges an object name by the ARGUMENT POSITION it is handed to rather than by whether the literal carries an argument list, covering every privilege inquiry function PostgreSQL 16 has plus the `regclass` argument family, and refusing a `to_reg*` result passed straight to a strict privilege function. Proved offline and against a real PostgreSQL in CI (`REQUIRE_POSTGRES=1`, so it cannot skip), with each of function, table, schema and sequence mutated back to the textual form and caught before any connection |
| OPS-03 | Operations | Reconcile hosted migration ledger pin after migration 0049 | Done | P0 | Shipped in #199; docs and tests only, no production migration, no register change and no Edge deploy. Moves `EXPECTED_LAST_MIGRATION` from `20260812102912` (0048) to `20260817104226` (`0049_spond_team_reconcile`), which the hosted head has carried since 17 August, so the gated content-sharing Edge deploy stops failing closed on its own ledger gate. The exact-equality assertion is MOVED, never widened: the retired value is now asserted to be rejected, which is what tells a move apart from a loosening. The migration register's `expected_previous_version` is deliberately untouched, because it records what the head was BEFORE 0049 applied, a different fact |
| OPS-04 | Operations | Preserve live sharing state across content-sharing Edge deploys | Done | P0 | Shipped in #200; deploy tooling, tests and docs only, no migration, no register change, no Edge deploy and no hosted data touched. The deploy verifier asserted `content_shares`, `content_share_dependencies` and the `content_share` audit events were EMPTY, which was a correct inert-state invariant during the dark rollout and stopped being one on 10 August when a coach created a share through the shipped feature. Run 32426729784 failed on it at the pre-deploy gate, before either function was deployed. The invariant becomes preservation: the pre phase captures a count and a server-computed fingerprint of each of the three datasets, and the post phase requires both to be unchanged. Strictly stronger in one respect, since a MODIFIED share was invisible to a count check and is caught by the fingerprint. The migration equality gate, the enabled-club allowlist, the drill and media rights assertions and the cron check stay absolute and untouched. A share created by a coach mid-deploy also fails, deliberately: no production lock is taken and no coach is blocked, so an ambiguous difference fails closed and the deploy is rerun |
| REG-01 | Training Day | Fix stored guest removal oscillation so Saved settles correctly | Done | P1 | Shipped in #184; client register state only, no migration, Spond or Edge change |
| PLAN-01 | Planning | Improve Add from Library: shared filters, recent ordering parity and phone-friendly single-column layout | Done | P1 | Shipped in #179; see the Done table |
| TRAIN-01 | Training Day | One-glance authorised coach view of the players in the working groups and their actual bib colours | Done | P1 | Shipped in #185; read-only Players & groups overview using existing inclusion/group/bib semantics |
| SPOND-06 | Spond | Use Spond event location to prefill/match session venue when deterministic | Done | P1 | Shipped in #186; new drafts only, no migration, no Edge change |
| SPOND-08 | Spond | Make a diagnosed OTJ ↔ Spond team mismatch actionable: reconcile the current-season team from a proved Spond member link | Done | P0 | Shipped in #190, completed in #192. Both gates have run: migration 0049 applied 17 August 2026 (hosted head `20260817104226`, `spond_team_reconcile`) and `spond-link-members` deployed at version 4. Verified by a live production smoke test |
| DRILL-02 | Drill Maker | Show existing drill diagrams across Planner, Session Day, Live and print/share views | In progress | P1 | Authenticated surfaces in #189; print and public share need a separate reviewed Edge/snapshot change (DRILL-02b). This public half does not block VISUAL-00/01 |
| VISUAL-00 | Product design | Design Read: define the target OTJ visual language from current code, the reference design and representative real screens before changing pixels | Done | P1 | Delivered in #210 as `docs/design/visual-design-read.md`, captured against `main` at `434f67f` after #196 merged and CI went green. Documentation only: no React, CSS, behaviour, route, permission, Supabase or migration change. Settles the type scale, semantic colour roles and contrast floors, the spacing and radius scales, surfaces, the control primitives, both shells, the modal and sheet contract, the seven state families, focus and touch requirements, non-colour cues and what stays recognisably OTJ. Names the acceptance screens for VISUAL-01/02/03 and records seven open product decisions in its Part 5 |
| VISUAL-01 | Product design | Build the shared visual foundation and app shell: tokens, typography, primitives, sidebar/top bar/content frame and mobile bottom navigation | Done | P1 | Delivered in #211 on 27 August 2026: the token set, the primitives (including the danger and on-dark button variants, Note and Sheet) and the shared shell, implementing Part 2 of `docs/design/visual-design-read.md`, with the five Part 4 acceptance surfaces checked in both themes at every width each exists at and the full suite green. The table and badge primitives are accepted in VISUAL-02, as Part 4 states. Presentation only, no route/permission/data behaviour changes |
| VISUAL-02 | Product design | Apply the new system to stable everyday surfaces including Home, Sessions, Registered Players, Activity, account/login, Feedback and stable admin screens | In progress | P1 | VISUAL-01 delivered. Adopted so far: Registered Players (#212, #213), Activity (#214), Account (#215), Login and Set Password (#216), Feedback (#217), Admin Users and Admin Teams (#218). Home, Sessions and the admin screens beyond Users and Teams are not yet adopted. PLAYERS-01 shipped first, so its destructive flow was redesigned once against final behaviour |
| VISUAL-03 | Product design | Redesign evolving feature areas alongside their functional work rather than polishing them immediately before they change | Later | P1 | VISUAL-01; pair Planner/week plans with COACH-11/12/13, Training Day with COACH-5/6/7/8, public/share after DRILL-02b |
| VISUAL-04 | Product design | Whole-product visual/accessibility QA across phone, tablet, desktop, light/dark/live modes and all state families | Later | P1 | VISUAL-01/02 and the relevant VISUAL-03 waves |
| TRAIN-02 | Training Day | Safe no-login Training Day share | Later | P1 | Separate security-reviewed public projection; never expose player/Spond/private register data |
| DRILL-03 | Drill Maker | Venue/pitch session composer showing how drills are laid out across training areas | Later | P2 | DRILL-02; venue/session design likely required |
| PLAYERS-01 | Registered Players | Bulk select and bulk delete with dependency preview, explicit confirmation and history safety | Done | P2 | Shipped in #191 on 27 August 2026. Migration `0050_bulk_delete_players` was applied first on 23 August (hosted `20260823065041`) and the deploy pin was reconciled in #208 before the application half merged |
| SPOND-07 | Spond | Scheduled/automatic Spond refresh with visible freshness/failure state | Later | P2 | Rate behaviour and scheduling review |
| LIVE-01 | Live session | Screen wake lock while delivering a session | Later | P2 | Browser capability/fallback |
| LIVE-02 | Live session | Unmissable time-up cue and improved live connectivity/offline state | Later | P2 | Coordinate with accessibility |
| LIVE-03 | Live session | Persist coach session/activity notes across devices | Later | P2 | Likely migration/security review |
| LIVE-04 | Live session | Shared pause state for driver/watchers if still needed after re-audit | Parked | P2 | Reconfirm current friction first |
| SHARE-01 | Sharing | Complete safe public session/programme sharing where appropriate | Later | P2 | Existing content-sharing security boundary |
| SHARE-02 | Sharing | Multi-item Share Packs | Parked | P3 | Follow single-item session/programme sharing |
| QUALITY-01 | Product quality | Re-audit old Product Excellence roadmap against current code and retire completed/stale items | Later | P1 | VISUAL-00 absorbs the presentation audit; only non-visual/still-relevant findings should survive a fresh recheck |
| QUALITY-02 | Product quality | Core accessibility pass: modal focus, non-colour cues, live announcements, keyboard paths | Later | P2 | Use as an acceptance lens during VISUAL-01/04; independent residuals can remain separate |
| QUALITY-03 | Product quality | Error resilience and explicit retry/recovery where silent failures remain | Later | P2 | Re-audit current state first |

## Delivery order

When there is capacity, prefer this sequence unless production evidence changes the order:

1. ~~Close PR #196 as the preferred Drill Maker baseline for the visual programme.~~ Done: #196 merged on 27 August 2026 and CI on `main` at `434f67f` is green across all eight jobs. PLAYERS-01 / #191 merged earlier the same day. The redesign baseline is closed.
2. ~~Run **VISUAL-00**, the Design Read.~~ Done. `docs/design/visual-design-read.md` (#210) is the written target visual language, captured against `main` at `434f67f`, and is the task contract for VISUAL-01.
3. ~~Land **VISUAL-01**, the shared foundation and shell, before route-by-route polishing.~~ Done: #211 merged on 27 August 2026. New feature work now inherits the new system rather than extending the old one.
4. Run **VISUAL-02** over the stable everyday surfaces, in reviewable groups rather than one application-wide PR. In progress: seven pull requests, #212 to #218, have adopted Registered Players, Activity, Account, Login and Set Password, Feedback, and Admin Users and Admin Teams; Home, Sessions and the remaining admin screens are still to come.
5. Continue **VISUAL-03** alongside the functional roadmap: Planner/week-plan authoring with COACH-11/12/13, Training Day/setup with COACH-5/6/7/8, public/share only after DRILL-02b, and Live coordinated with LIVE-01/02 and accessibility.
6. Finish with **VISUAL-04**, a whole-product phone-first visual/accessibility QA pass.

DRILL-02b remains a separate security-reviewed public projection decision and does not hold up VISUAL-00/01. QUALITY-01 no longer outranks the redesign: its useful presentation re-audit is part of VISUAL-00, and any genuinely non-visual old-roadmap findings must still be re-derived from current code before implementation.

## Acceptance criteria for scheduled items

Captured 15 August 2026 from the Spond linking investigation (PR #178),
folded here so there is one roadmap. Each set binds the row above it;
deeper design still happens when the item starts.

**VISUAL-00 to VISUAL-04 — visual redesign programme**

- The detailed implementation sequence and boundaries live in `docs/roadmap/visual-redesign-roadmap.md`; this master table owns status and priority.
- The redesign is a presentation programme, not a rewrite. Existing routes, permissions, Supabase/RLS behaviour, data semantics and security boundaries do not move merely to make a design easier.
- VISUAL-00 must establish the target system before VISUAL-01 changes shared styles: typography, colour roles, spacing/density, surfaces, controls, navigation, responsive behaviour, state treatment, accessibility cues and what remains recognisably OTJ.
- VISUAL-01 centralises the system and shell first. VISUAL-02 then applies it to stable surfaces; evolving product areas are handled under VISUAL-03 with their functional work so they are not redesigned twice.
- Do not create one giant redesign PR. Keep foundation, stable surface groups and feature waves independently reviewable, with existing behaviour tests staying green.
- VISUAL-04 is phone-first and then widens to tablet/desktop, and covers long copy, loading/empty/error/destructive states, touch targets, focus/keyboard, contrast/non-colour cues and modal behaviour.

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

**SPOND-08 — reconcile the OTJ team from Spond**

Opened 16 August 2026 as a NEW follow-up, deliberately not by reopening
SPOND-01 or SPOND-03. Those two shipped exactly what they scoped: the
diagnostics correctly EXPOSE a mismatch, and the closeout audit in this file
records that nothing in their scope is outstanding. Production then showed the
next thing, which is a different piece of work with a different risk profile
because it WRITES: the diagnostics now say `OTJ Argonauts / Spond Gladiators`,
`OTJ Argonauts / Spond Spartans` and `OTJ Argonauts / Spond no team`, and the
only remedy on offer was a manager retyping Spond's answer into the players
page by hand.

- Spond is where the club moves a child between teams, so Spond decides the
  current team. Making OTJ agree is one action on the Spond links screen.
- **The identity rule outranks the product rule, and it is enforced in the
  database.** `spond_reconcile_player_team` refuses to move a child who has no
  `player_spond_links` row, and refuses again when that row no longer points at
  the member the caller derived its destination from (`stale_link`). A proved
  child is resolved by member id and the name is never consulted. An unlinked
  child can only be moved by a human first confirming which Spond member they
  are, which creates the link and moves the team in one transaction. Exactly
  one of the two member arguments must be supplied, so a null can never mean
  "any link will do". This is the case `planRosterImport`'s cross team guard
  already refuses and explicitly defers to a durable link for; that guard is
  unchanged.
- Everything ambiguous offers nothing and says which ambiguity it is: a member
  in more than one mapped team's subgroup, a member in a subgroup TWO teams
  both claim (carried as evidence rather than deleted, and outranking any
  unique mapping beside it), a member in a subgroup no team maps (never read as
  Unassigned), two Spond members of one name, two registered children of one
  name in the club, an unproved scan, and a club where any team maps a whole
  Spond group rather than a subgroup.
- Only the CURRENT season moves, because the RPC derives the season and the
  caller cannot name one. No player identity is created, no link is deleted or
  repointed, no register entry or saved session is touched, and nothing is
  written toward Spond.
- Concurrency safe by a per (club, player) then per (club, member) advisory
  lock in that fixed order, a canonically ordered `FOR UPDATE` over the link
  rows, `FOR UPDATE` on the registration and an optimistic expected-team check;
  a repeat press is an idempotent no-op. The member key covers what the row
  locks cannot, a member with no link row yet, so two confirmations of the same
  free member return the documented refusal instead of a raw unique violation.
  Because those locks bind only callers of the RPC while the ordinary linking
  screen inserts directly, the confirmation insert also handles
  unique_violation by re-reading ownership and naming which side lost.
  "Apply all safe Spond changes" is offered only when NO row still needs an
  identity settled.
- Audited by the existing triggers only (`player.team_changed`,
  `player.spond_linked`), sharing one batch id per press. No new audit source
  value.
- Gated: migration `0049_spond_team_reconcile` and the `spond-link-members`
  deploy that adds the member id to a diagnostic row were two separate gated
  steps, safe in either order because the client tolerates each being absent.
  Both have since run; see the closeout below.

**SPOND-08 — production closeout, 17 August 2026**

Shipped in #190 and completed in #192. Both gates the row carried have run, and
the behaviour was confirmed against production rather than against this file.

- **Migration 0049 is applied.** `0049_spond_team_reconcile` went to the hosted
  database through the reviewed production migration workflow on 17 August 2026.
  The hosted ledger head after the apply is version `20260817104226`, name
  `spond_team_reconcile`. The migration adds one function and nothing else, so
  the applied state is the reviewed state.
- **The gated `spond-link-members` deploy has run.** The live function is
  version 4, `verify_jwt` true, status `ACTIVE`. That is the deploy carrying the
  member id on a diagnostic row, which is what a proved reconciliation resolves
  by; a name is still never consulted.
- **A live production smoke test passed**, on a genuine OTJ ↔ Spond team
  mismatch rather than a fixture. The mismatch was presented correctly, the
  human confirmation and linking flow worked, and the child's current season OTJ
  registration reconciled to the team Spond holds. No child is named here.
- **Spond stayed read only throughout.** Nothing was created, modified,
  cancelled or answered on Spond, which is roadmap rule 7 and the standing
  policy in `CLAUDE.md`.
- The row is Done. SPOND-08 was the follow-up to the closed SPOND-01/03
  programme and it closes beside it; nothing in its scope is outstanding.

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

Shipped in #191 on 27 August 2026. The destructive boundary and its documented residuals remain in `docs/security/player-deletion-boundary.md`.

- Explicit multi select with a count, never all by default; a dependency preview names what each deletion touches (register entries, Spond links and their cascaded replies, board tokens) before anything runs.
- Explicit confirmation naming the number deleted; the server revalidates the identity set and the deletion is one transaction, so a server refusal deletes nobody.
- Permanent-delete semantics are explicit: deleting the player also removes that player's historic `register_entries`; sessions and every other player's history remain. Withdraw remains the reversible action for a player genuinely leaving the club.
- The dialog treats dependency counts as a current preview rather than a frozen future total, refuses malformed preview payloads, caps runs at the server's 200-player limit, and handles stale/indeterminate outcomes without offering a retry that can only repeat a terminal refusal.
- Migration `0050_bulk_delete_players` was applied through the gated workflow on 23 August 2026 from the reviewed #191 commit, the hosted ledger stamped `20260823065041` / `bulk_delete_players`, and OPS-05 (#208) reconciled the content-sharing deploy pin before the application half merged.

**DRILL-02 — drill diagrams across session delivery**

- The authenticated surfaces are delivered in #189: the planner activity
  panel, session day setup cards and both live stages (driver and watcher)
  show the drill's saved Drill Maker diagram. One stored diagram, one parser
  (`parseDrillDiagram`), one renderer (`DrillDiagramView`), one display rule
  (`diagramForDisplay`) and one seam (`components/ActivityDiagram.tsx`). No
  migration, no schema change, no Edge Function change.
- The diagram needs its own read, and that is deliberate rather than an
  oversight: `DRILL_COLS` omits the column so a diagram cannot ride a list
  read or a snapshot builder, and an invariant test fails the build on
  widening it. The read stays per drill and shares the drill page's cache key
  rather than adding a batched second cache shape.
- An England Football derived drill shows no hand drawn diagram on any of the
  new surfaces, matching the drill page. The licence excludes a redrawn FA
  diagram wherever it renders, not only where it was made; the FA's own image
  keeps rendering through media.
- **The row stays In progress**, because print and public share are named in
  its scope and neither is delivered. `window.print()` exists in exactly one
  place, `PublicShare.tsx`, and the print stylesheet targets only `.public-*`,
  so there is no authenticated print path: print IS the public share page and
  inherits its gate exactly.

**DRILL-02b — publishing a diagram (separate, security reviewed)**

- Blocked on a decision before it is blocked on code: whether a coach drawn
  diagram may be published at all. A diagram carries free text a coach typed,
  and a share is a frozen copy, so a key that reaches
  `content_shares.snapshot` is served until the link is revoked and no later
  fix to the projection takes it back. That reasoning is recorded in the Edge
  Function's own deny list beside the `'diagram'` entry.
- If agreed, the change is one reviewed PR touching: the Edge `DRILL_COLS`,
  `projectDrillFields`, `TOP_ALLOWED`, `REF_DRILL_ALLOWED`, the removal from
  `FORBIDDEN_ANYWHERE`, `PublicDrillSnapshot` / `PublicReferencedDrill` /
  `PublicSessionSnapshot` with their mirrored client key sets, and a redeploy
  of BOTH `read-content-share` and `manage-content-share`, which share
  `_shared/share.ts`. Existing shares are frozen and would need reminting to
  carry one.
- Print then follows with no further work beyond a page break rule, since it
  renders the snapshot DOM.
- Gated by the review gates in CLAUDE.md, with the deploy verified by reading
  the deployed source back byte for byte rather than by a version number.

**DRILL-03 — venue/pitch composer**

- Captured, not specified: acceptance criteria are written when the Drill Maker and venue composer direction is confirmed, not before. Do not implement ahead of that decision.

## Detailed reference roadmaps

These documents contain deeper design history and security decisions. They do not override the status/priority table above.

- `docs/roadmap/visual-redesign-roadmap.md` — approved VISUAL-00 to VISUAL-04 programme: Design Read, shared foundation/shell, stable-surface waves, feature-area waves and whole-product visual/accessibility QA.
- `docs/roadmap/product-excellence-roadmap.md` — older product-quality survey; re-audit before implementation because it was grounded much earlier in the codebase. Presentation findings are re-derived under VISUAL-00 rather than copied forward.
- `docs/roadmaps/registered-players-delivery-plan.md` — detailed Registered Players programme and data-model history.
- `docs/roadmaps/content-sharing-roadmap.md` — public content-sharing architecture and security model.
- `docs/roadmaps/share-packs-roadmap.md` — later multi-item public sharing design.
- `docs/roadmap/foundation-retrospective.md` — completed security/foundation programme history.
- `docs/product/coaching-workflow/` — end-to-end coaching workflow design (reconciled 18 August 2026 after the completed coach discovery, then corrected: stations and the games phase are declared on an activity rather than inferred from its coaching phase; the games phase is ONE activity carrying a game count, because activities are sequential and summed; venue layouts are scoped to venue, season and age group rather than to a venue alone, and a session's season resolution fails closed rather than falling back to the current season): current-state audit, target product model, data-model proposal, share-boundary analysis and a thirteen-slice implementation plan. The product model is settled, no product question is outstanding. COACH-2A, COACH-2B, COACH-3, COACH-4 and COACH-10 have shipped (#198, #202, #203, #204, #206, #207) and the one content-sharing Edge deploy COACH-2A left outstanding has run. COACH-1, the club team order (`teams.sort_order`, migration M1), is built and took TWO gated migrations rather than the one the plan carried: COACH-1A, `0051_team_sort_order`, merged as #223 and applied on 2 September 2026 (hosted `20260902150212` / `team_sort_order`), and `0052_atomic_team_order`, because the client's multi statement save cannot be a transaction and two admins moving disjoint rows could leave an order neither submitted, so `set_team_order` writes the whole order under one serialization point or writes nothing; it was registered against `20260902150212`, merged as #226 and applied on 4 September 2026 (hosted `20260904174142` / `atomic_team_order`). COACH-1B, the Teams screen's ordering affordance, saves through that one call, with the grouping suggestion still handed no order by decision. It and every later migration is numbered and registered against the hosted ledger head at its own review, never against the highest file on disk. Start at `docs/product/coaching-workflow/README.md`.

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

Dates are merge dates in UTC, as GitHub records `merged_at`; a merge late on a British Summer Time evening is therefore listed under the earlier day.

| Item | PR | Date |
|---|---|---|
| Training-first sessions / All events widening | #165 | 11 Aug 2026 |
| Training Day “Players & groups” foundation | #167, #172, #176 | 11–15 Aug 2026 |
| Session lifecycle and stale-live corrections | #166, #172, #174 | 11–12 Aug 2026 |
| Spond population/count presentation and event classification | #168, #175 | 11–12 Aug 2026 |
| Drill Maker C1 diagram editor | #169 | 11 Aug 2026 |
| Gated production migration workflow | #170 | 11 Aug 2026 |
| Production migration ledger reconciliations through 0047 | #171, #173 | 11–12 Aug 2026 |
| PLAN-01 — Add from Library session planning | #179 | 15 Aug 2026 |
| SPOND-02 — staff and non-player Spond members excluded from linking | #178 | 15 Aug 2026 |
| SPOND-03a — setup diagnostics for unmatched registered players | #182 | 15 Aug 2026 |
| OPS-01 — hosted ledger reconciliation after 0048 | #183 | 15 Aug 2026 |
| REG-01 — stored guest removal settles correctly | #184 | 15 Aug 2026 |
| TRAIN-01 — session day player and bib overview | #185 | 15 Aug 2026 |
| SPOND-04 — British English copy sweep and a widened tripwire | #186 | 16 Aug 2026 |
| SPOND-05 — Spond API and boundary documents reconciled with the code | #186 | 16 Aug 2026 |
| SPOND-06 — deterministic Spond location to venue prefill | #186 | 16 Aug 2026 |
| SPOND-01 — registered players reconciled against Spond members | #187 | 16 Aug 2026 |
| SPOND-03 — member-to-player linking UX, duplicate-member case included | #187 | 16 Aug 2026 |
| SPOND-08 — current-season team reconciled from a proved Spond link | #190, #192 | 16–17 Aug 2026 |
| OPS-03 — hosted ledger reconciliation after 0049 | #199 | 20 Aug 2026 |
| COACH-2A — activity structure model and the active session duration | #198 | 20 Aug 2026 |
| OPS-04 — live sharing state preserved across content-sharing deploys | #200 | 21 Aug 2026 |
| COACH-2B — stations, the games phase and session stand-down authoring | #202 | 21 Aug 2026 |
| COACH-3 — suggested setup generator and the Players & groups screen | #203, #204 | 21–22 Aug 2026 |
| COACH-4 — saved groups preserved as attendance changes | #206 | 22 Aug 2026 |
| COACH-10 — one activity editor shared by the planner and week plans | #207 | 22 Aug 2026 |
| OPS-05 — hosted ledger reconciliation after 0050 | #208 | 23 Aug 2026 |
| PLAYERS-01 — bulk player deletion | #191 | 27 Aug 2026 |
| Drill Maker opens a new diagram on a blank area | #196 | 27 Aug 2026 |
| VISUAL-00 — the OTJ design read | #210 | 27 Aug 2026 |
| VISUAL-01 — shared visual foundation and application shell | #211 | 27 Aug 2026 |
| COACH-1A — the club team ordering field, migration 0051 (applied 2 Sep 2026) | #223 | 2 Sep 2026 |
| OPS-06 — hosted ledger reconciliation after 0051 | #224 | 2 Sep 2026 |

Update this table as subsequent roadmap items ship.