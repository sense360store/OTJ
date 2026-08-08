# ADR-0008: Training day logistics: the whole club session model and the amended Spond boundary

Status: Accepted (owner decision of record, recorded 2026-08-08; the implementing migrations are provisional 0043 onward, every number to be confirmed against the live ledger at apply time)
Date: 2026-08-08

Decision owners: Club owner (product, and the Spond boundary amendment); repository maintainer (security and data model).

Numbering note: the repo's ADRs are ADR-0002, ADR-0003, ADR-0005, ADR-0006 and ADR-0007; there is no ADR-0001 or ADR-0004. This file takes the next free number.

This ADR records two decisions for the training day logistics programme: the whole club session model (a session covers several teams through a join table, with the single team column and the free text venue column frozen as legacy), and the owner's amendment to the Spond children's data boundary (the app stores per member event responses, as opaque ids and statuses only, so the attendance Register can exist). The full amended boundary mechanism lives in `docs/security/spond-data-boundary.md`; the audit conventions the new tables follow are in `docs/adr/ADR-0006-app-audit-events.md` and `docs/security/app-audit-boundary.md`; the player identity model the links attach to is `docs/adr/ADR-0005-registered-players-and-seasons.md`.

Every statement below is one of three kinds and is labelled where it matters: confirmed current behaviour (cited to a file and object), a decided position (the owner decision this ADR records, or this ADR's design), or an unresolved decision requiring approval (listed under Unresolved items).

## Context

### Confirmed current state

All of the following was verified first hand against the repository on 2026-08-08.

- A session carries a single nullable `team_id` (`supabase/migrations/0002_teams_roles.sql`), used as a view filter and default, never in any policy. The planner offers one team select with a "Club (no team)" option (`src/routes/Planner.tsx`); a null team renders as "Club" everywhere.
- The venue is a free text column, `sessions.venue text` (`supabase/migrations/0001_init.sql:112`), written by the planner form, the programme apply modal and the start from template path (which default it to "Springmill 3G"), displayed on session cards, the session day header and the parent dashboard, and deliberately excluded from public share snapshots (`src/lib/publicShare.ts`, `supabase/functions/_shared/share.ts`).
- Spond attendance is aggregate counts only. `spond_events` (`supabase/migrations/0013_spond.sql`) holds four integer counts per event plus event facts, with no payload or member columns by design. `deriveCounts` (`supabase/functions/_shared/spond.ts`) takes the four counts as array lengths and never reads the ids inside the arrays; the boundary is pinned by `supabase/functions/_shared/spond_test.ts`.
- The roster import is the one place the Spond pipeline reads member names. `reduceMember` (`supabase/functions/_shared/spond.ts`) reads only `firstName` and `lastName` plus an optional shirt number; Spond member ids are deliberately never persisted, which `docs/security/registered-players-boundary.md` records with its accepted limitation: two children with the same name in the same subgroup are treated as one on import.
- Players are stable identities with per season registrations (`supabase/migrations/0032_registered_players.sql`, per ADR-0005). `players.display_name` is the only child personal field in the schema, its select gated on `players.view`. The frozen legacy column precedent is `players.team_id` and `players.shirt_number` (0032): retained nullable with a `comment on column` saying FROZEN, translated by compatibility triggers, never written by new code, dropped by a deliberately deferred destructive migration (`0033_players_legacy_columns.sql`, shipped unapplied).
- The composite foreign key integrity pattern is `player_registrations` (0032): a denormalised `club_id not null` on the child table, with each referencing pair `(other_id, club_id)` declared against a `unique (id, club_id)` constraint on the parent (`players_id_club_unique` and `teams_id_club_unique` from 0032, `seasons_id_club_unique` from 0031), so "the row's club equals the parent's club" is enforced declaratively for every writer. Neither `sessions` nor `spond_events` has a `(id, club_id)` unique constraint yet.
- Access decisions are capability checks through `public.has_perm(...)` (`0012_rbac.sql`, rewritten `0015_rbac_roles.sql`); the catalogue is 22 keys. `spond_events` writes are gated `sessions.create`; `spond_groups` writes are gated `club.manage`; `players` reads are gated `players.view` and writes `players.manage`.
- Audit conventions (`0030_audit_foundation.sql`, `0037_audit_rollout.sql`, per ADR-0006): AFTER row triggers writing one semantic event per committed change through `public.audit_domain_event(...)`, field names never values, structural allow lists, child linked events pseudonymous (a stable `players.id`, never a name).

### The problem

The club trains as one slot: all five teams attend together for about an hour, rotate through drill stations, then play a game. The data model says a session belongs to at most one team, so the real training day is unrepresentable: it is stored either as five duplicate sessions or as one "Club" session that names no teams at all.

On the day, the coach needs a Register: every player of the session's teams, who said they were coming, who has actually arrived. Spond knows who responded, but the Hub deliberately stores only four integers per event, so the Register cannot exist under the counts only boundary. The owner has weighed that trade and decided to amend the boundary, narrowly.

The venue is free text, so nothing can be computed from it. The setup composer needs real measured boundaries to lay stations onto; "Flushdyke" as a string cannot warn a coach that two U9 pitches barely fit.

## Proposal

### The whole club session model: session_teams

A new `session_teams` join table records which teams a session covers, club scoped in the `player_registrations` composite pattern: `(session_id, club_id)` references a new `sessions_id_club_unique` constraint, `(team_id, club_id)` references `teams_id_club_unique`, with a denormalised `club_id` on the row. Session create and edit select the covered teams, defaulting to all the club's teams. Team remains a filter and a grouping, never access control; the standing rule "teams scope no row level security" (0016) is unchanged.

`sessions.team_id` becomes a frozen legacy column, following the `players.team_id` precedent exactly: retained nullable, a `comment on column` marking it FROZEN, new code never writes it, existing rows keep their value so old session views are unaffected. Unlike 0032 there is no compatibility trigger, because nothing needs translating: a legacy row with a `team_id` simply reads as covering that one team until edited. No destructive drop is scheduled by this programme.

`sessions.venue` is frozen the same way once venues become first class: a `venues` table (with `venue_areas` carrying measured boundary polygons) and a nullable `sessions.venue_id`, with the free text column retained for old rows and never written by new code.

### Team bib colours

Each team gains a default bib colour (`teams.bib_colour`, written under the existing `teams_manage` policy, the `teams.manage` capability). A register entry can override the colour per session. No stock tracking, no bib inventory: a colour label, nothing more.

### The owner decision: per member Spond responses

Decided by the club owner, outside the implementation loop, as a deliberate ADR level amendment to the Spond children's data boundary. The app will store per member event responses so the Register can show, per player, whether they said they were coming. This is the first widening of the boundary since it was drawn, it is exact, and it is not a precedent for further widening: any field beyond the allow list below is a new owner decision, not an extension.

The amended boundary, in full:

MAY BE STORED (the complete allow list):

- `spond_member_id`, an opaque Spond identifier, only in the player link table and the per event response rows below
- per event response status per linked member: accepted, declined, unanswered, waiting
- the link between a `spond_member_id` and an existing `public.players` row

MAY BE READ TRANSIENTLY, RETURNED ONLY TO AN AUTHORISED COACH CLIENT DURING THE LINKING FLOW, NEVER PERSISTED AND NEVER LOGGED:

- member display names, solely to present match candidates for linking

REMAINS ABSOLUTELY FORBIDDEN, STORED OR LOGGED, ANYWHERE:

- member or guardian names (beyond the transient linking read above), emails, phone numbers, comments, addresses, dates of birth, medical or consent data, photographs, or any other payload fragment

Names in the app resolve exclusively through `public.players.display_name` via the link. The response rows carry no name and can carry no name: their table has no name column, and the sync writer's row shape is a fixed key set the boundary tests pin, the same structural enforcement `SPOND_EVENT_COLUMNS` gives `spond_events` today.

Rationale. The Register is the product: a coach at the gate ticking off arrivals needs "who said yes" beside "who is here", per child, not as a count. The narrowest data that achieves it is an opaque member id joined to the roster the club already curates. The id is pseudonymous: it resolves to a child only through the link table, inside the app, under the same capability that already guards the roster. The existing counts stay on `spond_events` untouched; the counts only tests are rewritten to pin the new allow list rather than deleted, so the fence moves but remains a fence.

### The new tables

Shapes at decision level; the gated migrations carry the exact DDL.

- `player_spond_links`: one row links one player identity to one Spond member. `player_id` unique (a player has at most one Spond identity), `spond_member_id` unique per club (a Spond member links to at most one player), `matched_by` auto or manual, `confirmed_at`, `created_by`, composite club scoped FK to `players` ON DELETE CASCADE (erasing a player severs the link atomically).
- `spond_event_responses`: one row per (event, linked member) with a status from the four Spond states and a `synced_at`. Composite club scoped FK to `spond_events` ON DELETE CASCADE, unique per (event, member). Written only by the sync path, which stores rows solely for member ids present in `player_spond_links`: ids without a link are counted into the aggregates and discarded, exactly as today. A newly created link surfaces statuses from the next sync onward. Each sync replaces the event's rows wholesale, so they never drift from Spond and rows for a severed link disappear at the next re-sync.
- `register_entries` (the Register's own state, one row per session and player): present flag, per session bib colour override, source spond or manual (the quick add for a player who turns up without an RSVP). Composite club scoped FKs to `sessions` and `players`, both ON DELETE CASCADE.

### Retention and erasure

Response rows live and die with their synced event: they cascade with the `spond_events` row and a re-sync replaces them wholesale. Deleting a player cascades the link row and the player's register entries; response rows are keyed by the opaque member id, not the player, so from that moment they resolve to nothing inside the app, and because the sync writes rows only for linked ids, the next re-sync removes them entirely. They are still treated as pseudonymous child data for retention purposes (an opaque identifier plus attendance history), consistent with how ADR-0006 treats child linked audit events: name free is not exempt. The link table is the erasure pivot: severing it is what disconnects every stored Spond fact from a child, and the sync's linked only filter is what makes the disconnection drain to zero rows on its own.

### RLS intent

Mirroring the existing capability patterns, enforcement in Postgres, the UI only deciding what to surface:

- Reads of `player_spond_links`, `spond_event_responses` and `register_entries` are gated `players.view`, the same gate as the roster they resolve against. Parents hold no capabilities and read none of it; the Register is a coach surface.
- `player_spond_links` writes are gated `players.manage` with `created_by` pinned on insert: linking is roster curation.
- `spond_event_responses` writes are gated `sessions.create`, mirroring `spond_events_manage` (the sync runs through RLS as the calling coach today; the extension keeps that).
- `register_entries` writes are gated `sessions.create`, club scoped: any coach marks arrivals on the day, not only the session's owner, matching how the club actually staffs a whole club slot.
- `session_teams` writes follow the session they belong to (owner holding `sessions.create`, or `sessions.manage`), via exists() against the parent row in the `member_teams` join table style; reads are club wide like sessions themselves.
- `teams.bib_colour` rides the existing `teams_manage` policy; `venues` and `venue_areas` writes are admin surface (`club.manage`), reads club wide.

### Audit treatment

Rows referencing a player are pseudonymous child data and follow the ADR-0006 conventions. Link create and delete are audited through the 0037 trigger pattern as player events (entity the stable player id, field names only; the opaque member id is a value and is never recorded). Response rows are bulk sync output and are not audited per row, mirroring `spond_events`, which has no audit trigger and a reserved `spond.sync_completed` summary action. Register ticks are high frequency operational touches; the proposal is not to audit them per tick (the register row itself is the record), listed under Unresolved items for explicit approval.

## Alternatives considered

### Per member attendance

#### A. Keep counts only, coaches check Spond on the day (rejected)

The status quo. Preserves the boundary unchanged, and fails the product: the Register cannot exist, coaches juggle two apps at the gate, and the Hub's roster and Spond's responses never meet. The owner explicitly weighed this and decided against it.

#### B. Fetch responses live from Spond when the Register opens, storing nothing (rejected)

Narrowest storage, but the worst path operationally and for the data itself: it puts the Spond credentials on a per page view path, re-reads a member identifying payload on every open, and depends on pitch side signal, which the Register's design explicitly refuses to do (load up front, edits optimistic). Repeatedly reading a payload that names children, to avoid storing an opaque id, is not the safer trade.

#### C. Store responses with member names (rejected outright)

Breaches the boundary that keeps children's names in exactly one select gated table (`0021`, `0023`, `0028`, restated by 0032). Names would arrive from an external system into sync written rows, unreviewed, and every register read would carry them. Not considered further.

#### D. Store opaque member ids and statuses, linked to the curated roster (CHOSEN)

The owner decision. The minimum stored surface that makes the Register real: ids resolve to names only through the link, inside the app, under `players.view`; retention rides the event lifecycle; erasure pivots on one row. The linking flow reads names transiently to build the link, which is the one moment the mapping must be visible to a human, and persists none of them.

### Covering teams

#### A. One session row per team per slot (rejected)

Five duplicate plans to keep in step, five live runners for one shared game, and the Register fragments per copy. The club's training day is one event; the model should say so.

#### B. Repurpose the single team_id, null meaning whole club (rejected)

Cannot express "these three teams but not those two", and overloads null, which already means "club event" for shared Spond events. No migration is saved, expressiveness is lost.

#### C. A session_teams join table, team_id frozen legacy (CHOSEN)

Additive and backwards compatible: old rows keep their meaning, new code writes the join table, the composite FK pattern keeps every row club consistent, and the frozen column follows a precedent the repo has already exercised end to end.

## Decision

**A session is a whole club training slot. A new `session_teams` join table carries the teams a session covers (defaulting to all of them), built on the `player_registrations` composite club scoped FK pattern; `sessions.team_id` and, once venues are first class, `sessions.venue` are frozen legacy columns per the `players.team_id` precedent, never written by new code and not scheduled for a destructive drop by this programme. By owner decision of record, the Spond children's data boundary is amended, exactly and only, to allow storing opaque `spond_member_id`s in a player link table, per event response statuses for linked members, and the link itself; member display names may be read transiently during the coach linking flow and are never persisted or logged; everything else Spond knows about a member remains forbidden to store or log anywhere. Names resolve exclusively through `public.players.display_name` via the link. Reads of the new child adjacent tables are gated `players.view`; writes follow the mirrored capability patterns above; response rows cascade with their event and are replaced by every re-sync.**

## Trade-offs

- The app now holds a per child attendance pattern (opaque id plus statuses over time), where before it held only aggregates. Accepted by the owner as the price of the Register, bounded by the allow list, the event lifetime retention and the single erasure pivot.
- The counts only story, quoted in several documents, becomes historically true rather than currently true. The mechanism chosen is supersession, not a sweep: `docs/security/spond-data-boundary.md` is the authoritative statement and says so in its preamble, CLAUDE.md is amended in the same change, and each older document stands as the accurate record of the era it describes. A reader of any older restatement is one cross reference away from the current boundary.
- Two frozen columns accumulate on `sessions` (`team_id`, `venue`) with no drop scheduled. Accepted: the 0032/0033 precedent shows the drop can come later as its own deliberate step, and old rows keep rendering meanwhile.
- The linking flow shows member names to a coach client transiently. This is the same exposure class as the roster import that already exists, gated the same way, and it persists nothing; but it is a name bearing payload crossing the wire on demand, and the boundary doc records the exact obligations on it.

## Consequences

- The Spond boundary documentation moves: `docs/security/spond-data-boundary.md` becomes the authoritative statement of the amended boundary, CLAUDE.md's Spond section is updated to match, and the historical sections of `docs/security/registered-players-boundary.md` stand as written for the import era they describe.
- The existing counts only boundary tests in `supabase/functions/_shared/spond_test.ts` will fail against the sync extension by design. Rewriting them to pin the new allow list, and to prove the forbidden list stays out of every written row, log line and response body except the linking flow's name and id pairs, is part of the work, not a violation.
- The accepted namesake limitation of the roster import (two same named children in one subgroup collapse on import) becomes resolvable: the linking screen can bind each Spond member id to its own player row. The import itself is unchanged.
- `sessions` and `spond_events` each gain a `(id, club_id)` unique constraint so composite FKs can reference them, the same enabling step 0032 took for `teams`.
- New code never writes `sessions.team_id` or, post venues, `sessions.venue`. Existing session views are unaffected for old rows: a legacy `team_id` reads as covering that one team.
- The capability catalogue is unchanged; every gate above reuses an existing key. If a dedicated register capability is ever wanted, that is a catalogue growth decision with its own review.
- Migrations, RLS policies and Edge Function changes in this programme are review gated per CLAUDE.md: written and shipped in PRs, applied or deployed only by hand after human review, never from the implementation loop.

## Unresolved items

- Register tick auditing. Recommended default: no per tick audit events (the register row is the record; ticks are high frequency operational touches like kit check offs). If the club later wants an arrivals trail, that is a catalogue addition (`register.*`) with its own volume story. APPROVAL REQUIRED only if the default is rejected.
- A destructive drop of the frozen `sessions.team_id` and `sessions.venue` columns, in the 0033 style (shipped unapplied, preflight, PITR recovery note). Not scheduled by this programme; propose only after the join table and venues have baked through a season.
- Whether `spond_event_responses` should also be pruned when an event ages out of the sync window rather than only on event deletion or re-sync. Recommended default: keep them for as long as the event row itself is kept, which is the existing spond_events retention.

## Implementation dependencies

- Delivered as the training day logistics PR queue: the ADR and boundary doc (this change), then venues, session_teams and bibs, the Spond link and response schema, the sync extension and linking function, the linking screen, the Register, and the drill layout foundation, in that order; each migration is provisional against the live ledger and review gated.
- The sync extension and the linking function must land with the rewritten boundary tests in the same PR, so the fence never has a gap between the old pins and the new.
- `docs/security/policy-test-matrix.md` gains contract rows and `tests/security/*.test.ts` files for each new table when its migration lands.
- Depends on ADR-0005 for the player identity the links attach to, ADR-0006 for the audit conventions, and the 0027 storage boundary and 0032 composite FK groundwork as cited above.
