# OTJ Training Hub master roadmap

Status: active source of truth

Last reviewed: 17 August 2026 (SPOND-08 shipped, applied to production and verified live; OPS-02 added from the post-#193 Codex review; DRILL-02 in progress in #189, with print and public share held for DRILL-02b)

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
| REG-01 | Training Day | Fix stored guest removal oscillation so Saved settles correctly | Done | P1 | Shipped in #184; client register state only, no migration, Spond or Edge change |
| PLAN-01 | Planning | Improve Add from Library: shared filters, recent ordering parity and phone-friendly single-column layout | Done | P1 | Shipped in #179; see the Done table |
| TRAIN-01 | Training Day | One-glance authorised coach view of the players in the working groups and their actual bib colours | Done | P1 | Shipped in #185; read-only Players & groups overview using existing inclusion/group/bib semantics |
| SPOND-06 | Spond | Use Spond event location to prefill/match session venue when deterministic | Done | P1 | Shipped in #186; new drafts only, no migration, no Edge change |
| SPOND-08 | Spond | Make a diagnosed OTJ ↔ Spond team mismatch actionable: reconcile the current-season team from a proved Spond member link | Done | P0 | Shipped in #190, completed in #192. Both gates have run: migration 0049 applied 17 August 2026 (hosted head `20260817104226`, `spond_team_reconcile`) and `spond-link-members` deployed at version 4. Verified by a live production smoke test |
| DRILL-02 | Drill Maker | Show existing drill diagrams across Planner, Session Day, Live and print/share views | In progress | P1 | Authenticated surfaces in #189; print and public share need a separate reviewed Edge/snapshot change (DRILL-02b) |
| TRAIN-02 | Training Day | Safe no-login Training Day share | Later | P1 | Separate security-reviewed public projection; never expose player/Spond/private register data |
| DRILL-03 | Drill Maker | Venue/pitch session composer showing how drills are laid out across training areas | Later | P2 | DRILL-02; venue/session design likely required |
| PLAYERS-01 | Registered Players | Bulk select and bulk delete with dependency preview, explicit confirmation and history safety | In progress | P2 | PR #191 open and rebased on main. `0050_bulk_delete_players` is now REGISTERED for apply against `20260817104226` / `spond_team_reconcile` (the row 0049's apply stamped on 17 August 2026) and is in the workflow dropdown, but is NOT applied. Applying it comes BEFORE the merge, because main auto-deploys. Destructive-change review gate; boundary in `docs/security/player-deletion-boundary.md` |
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

1. Finish Drill Maker DRILL-02: the authenticated surfaces are in #189, and the print and public share half needs the separate reviewed DRILL-02b change before the row closes.
2. Pick up QUALITY-01, since re-auditing the old Product Excellence roadmap gates several later items.
3. Treat destructive Registered Players changes and public Training Day sharing as separate reviewed programmes, not opportunistic additions to unrelated PRs.

REG-01, TRAIN-01 and the whole Spond polish set (SPOND-04, SPOND-05, SPOND-06) have shipped and have left this list. SPOND-01 and SPOND-03 have shipped too, so the Spond linking programme that ran from #178 to #187 is closed and stays closed. SPOND-08 was its follow-up rather than its continuation: those items scoped exposing a mismatch and delivered it, and acting on one was a separate piece of work because it writes to a child's registration. It has now shipped, both of its gates have run in production and a live smoke test has confirmed the behaviour, so it no longer outranks DRILL-02 under roadmap rule 4. DRILL-02 is the active step and is partly delivered: its authenticated surfaces are in #189 and its public half is held deliberately, so the row is not closed.

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

- Explicit multi select with a count, never all by default; a dependency preview names what each deletion touches (register entries, Spond links and their cascaded replies, board tokens) before anything runs.
- Explicit confirmation naming the number deleted; one transaction, so a partial failure deletes nobody.
- Session history is never silently destroyed: removals that would orphan register entries are surfaced, and the chosen semantics are stated on screen.
- Audit events per run; concurrency tests for overlapping selections; destructive change review gate.

In progress against the draft PR. The proven cascade, the refusal matrix, the
concurrency argument and the audit shape are recorded in
`docs/security/player-deletion-boundary.md`. The one finding worth reading
before review: `register_entries` is destroyed rather than degraded to a
neutral reference, which the single row Delete permanently has done since 0044
without saying so. The bulk dialog states it in full and counts it; changing
that outcome would be a schema decision, not a UI one, and is out of scope
here. The permanent delete semantic is approved as it stands: Delete
permanently is full erasure of that player identity, their historic register
entries go with them by cascade, the sessions and every other player's history
remain, and the preview and confirmation state that plainly. Withdraw remains
the reversible action for a player genuinely leaving the club. No anonymised
history redesign is in scope.

The migration is written, self verifying and wrapped in its own explicit
transaction, and is NOT applied to production by this PR. It is now REGISTERED
for apply, which is a different thing: the workflow is dispatch only and holds
at the production environment gate for a human.

Numbering: slot 0049 belongs to SPOND-08's `0049_spond_team_reconcile.sql`, so
this file is `0050_bulk_delete_players.sql`; the rename was forced, because two
files carrying one version make `supabase db reset` abort and take the security
suite with it. 0049 has since been applied to production, on 17 August 2026, at
hosted version `20260817104226` / `spond_team_reconcile`, so the row 0050 must
name exists and has been read rather than guessed. 0050 is in
`REVIEWED_MIGRATIONS` against exactly that row, with five object probes and its
own idempotency key, and in the workflow dropdown.

Rollout order, which is the reverse of the usual one: apply 0050 from the
reviewed #191 branch commit FIRST, confirm the pre-apply gate, the apply and
the post-apply readback, and only then merge. Main auto-deploys to Vercel and
the new screens call these functions, so merging first would ship a client
calling an RPC the database does not have.
See the file header and `docs/security/player-deletion-boundary.md`.

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
| SPOND-08 — current-season team reconciled from a proved Spond link | #190, #192 | 16–17 Aug 2026 |

Update this table as subsequent roadmap items ship.