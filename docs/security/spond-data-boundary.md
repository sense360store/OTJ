# Spond data boundary

The authoritative statement of what the app may hold, read, log and return
from Spond, as amended by the owner decision recorded in
`docs/adr/ADR-0008-training-day-logistics.md`. Spond event responses identify
children and their guardians; this document is the fence around that payload.
It supersedes the counts only statements in earlier documents as the current
boundary; the Spond sections of
`docs/security/registered-players-boundary.md` (section 7, the roster import)
stand as the historical record of the import era and remain accurate for the
import itself. Companion documents: `docs/adr/ADR-0008-training-day-logistics.md`
(the decision record and its rationale),
`docs/security/registered-players-boundary.md` (the roster and its
capability gates), `docs/security/app-audit-boundary.md` (audit conventions
for child adjacent rows), and `docs/security/policy-test-matrix.md` (the
executable proof index).

Throughout this document, three kinds of statement are distinguished:
confirmed current behaviour carries a citation to a file and policy, function
or line; decided positions record the ADR-0008 owner decision and its design;
obligations name what every implementing change must prove.

## Status

Current. The amended boundary below is the owner decision of record
(ADR-0008, 2026-08-08). The implementing schema and function changes land
across the training day logistics PR queue, each review gated; until a given
piece lands, the confirmed current behaviour cited beside it continues to
hold.

## Decision owners

Club owner (product, and the boundary amendment); repository maintainer
(security and data model).

## Confirmed current state

- The integration is read only toward Spond. Authentication
  (`POST auth2/login`) is the only non GET call anywhere
  (`supabase/functions/spond-sync/index.ts`,
  `supabase/functions/spond-roster-import/index.ts`); nothing the app does
  creates, modifies, cancels or responds to anything on Spond, and no write
  of any kind flows from this app to Spond without an explicit new decision.
- Attendance sync is counts only today. `spond_events`
  (`supabase/migrations/0013_spond.sql`) holds four integer counts plus event
  facts and has no payload or member columns by design; `deriveCounts`
  (`supabase/functions/_shared/spond.ts`) takes array lengths and never reads
  the member ids inside the arrays; `buildEventRow`'s complete key set is
  `SPOND_EVENT_COLUMNS`, pinned by
  `supabase/functions/_shared/spond_test.ts` ("the upsert row carries counts
  only, never the ids or names behind them"; "the row contains exactly the
  allowed spond_events columns").
- The roster import is the single place member names are read.
  `reduceMember` reduces a member to `{ display_name, shirt_number }` and
  nothing else, never a guardian, contact, or the member's id
  (`supabase/functions/_shared/spond.ts`, pinned by
  `supabase/functions/_shared/spond_roster_test.ts`); the commit payload
  carries only name and shirt into the `spond_import_roster` RPC
  (`supabase/migrations/0036_spond_and_renew.sql`).
- Logging in both functions is `console.error` with HTTP status codes and
  the function's own context only; non OK response bodies are cancelled
  unread. No name, member id, email, phone or payload fragment is ever
  logged.
- Credentials live only in the `SPOND_EMAIL` and `SPOND_PASSWORD` function
  secrets; both functions fail closed when they are missing. A dedicated
  organiser account is used, never a personal login. The caller's JWT plus
  the anon key is the only database identity; the service role key appears
  in neither function.
- Test fixtures are synthetic, never real payloads
  (`SYNTHETIC_EVENT`, `SYNTHETIC_MEMBER`, invented ids and names).

## The amended boundary

Decided by the club owner as an ADR level amendment (ADR-0008). It is exact:
anything not on the allow list is forbidden, and the allow list is not a
precedent for its own growth.

### May be stored (the complete allow list)

- `spond_member_id`, an opaque Spond identifier, in exactly two places: the
  player link table (`player_spond_links`) and the per event response rows
  (`spond_event_responses`).
- Per event response status per linked member: accepted, declined,
  unanswered, waiting.
- The link between a `spond_member_id` and an existing `public.players` row
  (with its bookkeeping: matched automatically or manually, when confirmed,
  by whom).

### May be read transiently, never persisted, never logged

- Member display names, read during the coach linking flow only, returned
  only to an authorised coach client, solely to present match candidates for
  linking. The transient read is the linking function's response body and
  nothing else: no cache, no table, no log line, no error message carries a
  name.

### Remains absolutely forbidden, stored or logged, anywhere

- Member or guardian names (beyond the transient linking read above),
  emails, phone numbers, comments, addresses, dates of birth, medical or
  consent data, photographs, or any other payload fragment.

Names in the app resolve exclusively through `public.players.display_name`
via the link table. No other name path exists, and none may be added.

## Enforcement duties

The boundary is enforced structurally, the way the current one is: fixed row
shapes at the only places a payload becomes a row, no columns that could hold
the forbidden data, and tests that pin both. Every implementing PR carries
these duties:

- The response upsert row shape is a fixed, exported key set (the
  `SPOND_EVENT_COLUMNS` pattern): event reference, `spond_member_id`,
  status, `synced_at`, club scoping, and nothing else. The reducer that
  builds it reads the response id arrays only; the `recipients` object,
  which embeds member profiles, is never read.
- The sync stores response rows solely for member ids present in
  `player_spond_links`, read through RLS as the caller: ids without a link
  are counted into the aggregates and discarded, exactly as today. A newly
  created link surfaces statuses from the next sync onward; the storage is
  per linked member, never per invitee, which is what keeps guardian and
  adult member ids out of the tables entirely.
- `spond_event_responses` and `player_spond_links` have no name, contact or
  free text payload columns by design, so the forbidden list is unstorable,
  not merely unstored. Status is constrained to the four Spond states.
- The linking function reads, per member, exactly the member id and display
  name, shapes them into the response body, and persists nothing. Its
  logging is status codes and counts only, like the existing functions. Its
  capability gate runs before any Spond call.
- Sync direction remains Spond to app only; login remains the only non GET
  call; credentials remain function secrets only; both functions keep
  failing closed without them; the service role stays out of the Spond
  functions; fixtures stay synthetic.
- The existing counts only tests are rewritten, not deleted: they must pin
  the new allow list (row key sets exactly as designed) and prove the
  forbidden list stays out of every written row, every log line and every
  response body, with the single exception of the linking flow's name and
  id pairs in its own response.

## Retention and erasure

- Response rows live and die with their synced event: ON DELETE CASCADE
  from the `spond_events` row, and each sync replaces the event's rows
  wholesale, so they never drift from what Spond currently says.
- Deleting a player cascades its `player_spond_links` row and its register
  entries. Response rows are keyed by the opaque member id, not the player,
  so from that moment they resolve to nothing inside the app, and because
  the sync writes rows only for linked ids, the next re-sync removes them
  entirely. The link table is the erasure pivot that disconnects every
  stored Spond fact from a child, and the linked only filter drains the
  disconnected rows to zero on its own.
- Link rows, response rows and register entries referencing a player are
  pseudonymous child data for retention purposes, consistent with
  ADR-0006's treatment of child linked audit events: name free is not
  exempt. Retention of response rows equals the retention of `spond_events`
  rows themselves (kept, including cancelled events, because sessions may
  reference them).

## Row level security intent

Postgres RLS is the enforcement; the UI only decides what to surface. The
policies land with their migrations, review gated, and mirror existing
capability patterns:

- Reads of `player_spond_links`, `spond_event_responses` and
  `register_entries` require `players.view`, the same gate as the roster
  they resolve against. Parents hold no capabilities and read none of it.
- `player_spond_links` writes require `players.manage`, with `created_by`
  pinned on insert: linking is roster curation.
- `spond_event_responses` writes require `sessions.create`, mirroring
  `spond_events_manage` (0013): the sync writes through RLS as the calling
  coach. The sync's linked only filter reads `player_spond_links` under the
  same RLS, so a caller holding `sessions.create` without `players.view`
  syncs counts and stores no response rows. That is fail closed behaviour,
  not a bug; it is never fixed by widening the links read policy.
- `register_entries` writes require `sessions.create`, club scoped: any
  coach marks arrivals at a whole club slot.
- The aggregate counts on `spond_events` and their club wide read are
  unchanged.

## Audit

Per ADR-0006 conventions: link create, re-link (the member id changing,
recorded as the field name only) and delete are audited as player events
through the 0037 trigger pattern (entity the stable player id, field names
only; the opaque member id is a value and is never recorded in
`changed_fields`, `safe_changes` or `metadata`). The link's player is
frozen by a touch trigger: re-pointing a link to a different child is an
audited unlink plus an audited link, never a silent update. Response rows are bulk sync
output and carry no per row audit, mirroring `spond_events`; the reserved
`spond.sync_completed` summary action remains available. Register ticks are
proposed unaudited (ADR-0008, Unresolved items).

## Test obligations

- Deno tests beside the functions pin the reducers and row shapes exactly as
  the current `spond_test.ts` and `spond_roster_test.ts` do, rewritten for
  the amended allow list: response rows carry exactly the allowed keys; the
  boundary test stringifies every written row and asserts none of the
  synthetic names, guardian ids, emails or phone fragments appear; the
  linking function's response carries name and id pairs and nothing else,
  and its failure paths log status only.
- `tests/security/*.test.ts` files land with each migration:
  `player_spond_links`, `spond_event_responses` and `register_entries` each
  get the per role matrix (42501 on refused insert, zero row update and
  delete filtering, parent reads empty, cross club refused), and
  `docs/security/policy-test-matrix.md` gains their contract rows.
- Fixtures remain synthetic in every suite. A real Spond payload never
  enters the repository.
