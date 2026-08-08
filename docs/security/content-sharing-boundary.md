# Content sharing boundary: the rights model and secure share substrate (PR 1)

This document is the authoritative security boundary for the Content Sharing
programme's first implementation phase (PR 1), delivered by
`0038_content_sharing.sql`. The programme design is
`docs/roadmaps/content-sharing-roadmap.md`; this document is the security
contract for what PR 1 actually builds. The audit side is
`docs/security/app-audit-boundary.md`; the test coverage is
`docs/security/policy-test-matrix.md` (Content share substrate).

PR 1 ships **no visible feature**. There is no public route, no public Edge
Function, no anonymous read, no public snapshot rendering. It builds the secure
substrate the later public sharing phases require: a rights classification,
sharing capabilities, the private share tables, the lifecycle write contract,
dependency tracking, rights downgrade invalidation, audit coverage and a per
club kill switch. Public reading is PR 2 and is not included here.

## 1. Rights classification

The `content_rights` Postgres enum is the authoritative classification for
shareable content and media. An enum, not free text, so an unknown value is
impossible for every writer including the service role: eligibility can never
be decided on a value the model does not know.

- `internal_only`: never leaves the club. It cannot be included in a public
  share, and it blocks an aggregate public share if nested. The default for
  England Football derived content and for unclassified media.
- `public_link_only`: a metadata or text projection may be shareable, but
  binary or downloadable media must not be exported as a downloadable public
  file. Exact enforcement is completed in the PR 2 snapshot builders; in PR 1
  it is a stored classification only.
- `public_full`: eligible for public projection and eligible media delivery,
  still subject to the PR 2 snapshot allow lists and later enforcement.

The `rights` column is carried by `media`, `drills`, `sessions`, `programmes`
and `templates` (templates because a programme's aggregate eligibility depends
on its week templates). It is `not null` with a fail closed default of
`internal_only`, so any row not explicitly classified is internal only.

### Backfill rules (precise, and documented once here)

The migration adds the column with default `internal_only`, so every existing
row starts internal only, then promotes only the narrow, evidenced club
original CONTENT case:

- **Media**: every media row stays `internal_only`. Media is where the FA
  rights concentrate (images, PDFs, Vimeo embeds, and the downloaded FA MP4
  bytes stored in the private bucket by `faAttach.ts`), and unclassified
  uploaded media defaults internal only. No media is promoted. Stored FA video
  bytes therefore remain internal only, as required.
- **Content** (`drills`, `sessions`, `programmes`, `templates`): a row is
  promoted to `public_full` **only** when it carries no third party source
  evidence at all, i.e. `source_url IS NULL AND source_label IS NULL` (and,
  for drills, `source_key IS NULL`). Any row with a `source_url`, a
  `source_label` or a `source_key` stays `internal_only`. This means:
  - FA derived content (an FA `source_url`) stays internal only.
  - Non FA third party sourced content stays internal only (unknown or
    unclassified third party fails closed).
  - Club original content with no recorded source becomes `public_full`, the
    roadmap approved safe club original default, so PR 2 public drill sharing
    has eligible content to work with.

Absent source is treated as club original per the roadmap's explicit approval
(decision 2). The known residual is third party text pasted into a no source
field: it defaults `public_full` and there is no server signal that
distinguishes it from genuine club original text. That residual is controlled
by the PR 2 pre publish preview and its "club's own work or cleared for public
use" confirmation, not by this backfill. New content created after this
migration is `internal_only` by the column default until explicitly classified
(fail closed).

The migration self verifies the FA invariant: no row whose `source_url` is an
England Football Learning host (mirroring `src/lib/fa.ts` `isFaUrl` through
`content_rights_is_fa_url`) or whose `source_label` is "England Football
Learning" ends with rights other than `internal_only`, and no media row is
anything but `internal_only`.

The local seed (`supabase/seed.sql`) replicates the content backfill so the
local database matches the hosted end state; on a fresh local reset the
migration backfill runs before the seed inserts the demo rows, exactly as the
capability seeds do.

## 2. Sharing capabilities

Two capabilities join the catalogue (twenty to twenty two):

- `shares.create`: create and manage public share links for content you own.
- `shares.manage`: club wide oversight, revoke any club share (and, in PR 5,
  review what a share exposes).

Approved grants (seeded on each club's system roles by the migration, and by
the seed's broad pattern locally):

| Role | shares.create | shares.manage |
|---|---|---|
| admin | yes | yes |
| manager | yes | yes |
| coach | yes | no |
| parent | no | no |

`shares.manage` follows the `.manage` naming convention but is **not** a
reserved administrative capability. The reserved set stays exactly
`users.manage` and `club.manage` (enforced by `role_capabilities_guard_reserved`
from 0015, unchanged here), so `shares.manage` is freely grantable to the
manager role, which the security suite proves. Do not add `shares.manage` to
`RESERVED_CAPABILITIES`.

## 3. Per club kill switch

`clubs.public_sharing_enabled` is a `not null` boolean defaulting `false`:
public sharing is off on every club until an admin turns it on. It is changed
only through the existing `clubs_update_manage` policy (`club.manage`, reserved
to admin), so managers, coaches and parents cannot flip it.

The lifecycle RPC checks it: create, refresh and rotate fail closed while the
switch is off; revoke stays allowed so a club can always turn a live link off.
The PR 2 public read will also check it after resolving a share's club, giving
an instant per club stop without touching any share row. PR 1 provides the
schema and the internal management path only; there is no public read to gate
yet.

## 4. The private tables

### content_shares

One row per public share. Private in the strongest sense: RLS is enabled,
there is **no client policy of any kind and no client grant**, so neither anon
nor authenticated (not even a `shares.manage` holder) can read or write it
through PostgREST. It is reached only through the service role gated lifecycle
RPC (as the definer function's owner) and, in PR 2, the read path. This is
stronger than the existing content tables, whose select policies are `TO
public` and fail closed for anon only because `my_club()` is null.

- Exactly one of `drill_id`, `session_id`, `programme_id` is non-null and
  matches `kind` (two check constraints). The source FKs are `on delete
  cascade`, so deleting the source removes the share; the audit event records
  the durable source id independently and survives.
- The secret is stored as `token_hash bytea` only, constrained to exactly 32
  bytes (a SHA-256 digest). There is no plaintext or reversible secret column.
  The raw secret is generated by the trusted caller and returned to the owner
  only on create or rotate; it is never stored, logged or returned by the RPC.
  Losing the secret requires rotation.
- One active (non revoked) share per source is enforced by three partial
  unique indexes (`where <col> is not null and revoked_at is null`), one per
  source column; a single index cannot span three nullable columns.
- `idempotency_key` plus its partial unique index (partial on `revoked_at is
  null`) makes a lost response retry resolve to the same active row, and frees
  the key when the share is revoked, so a reused key after revoke never
  resurfaces the dead share as a "successful" create and a fresh share can be
  minted for the same source.
- `snapshot` is a minimal non-public placeholder in PR 1 (it carries no
  content; PR 2 owns the real builders) and is cleared to `null` on revoke and
  on rights invalidation. A check constraint (`revoked_at is null or snapshot
  is null`) makes "snapshot cleared on revoke" a schema level guarantee.
- `created_by`, `updated_by`, `revoked_by` are `on delete set null`, so
  removing a member who ever created or revoked a share is not blocked; who
  shared what survives via the audit `actor_name` snapshot.

### content_share_dependencies

The private reverse dependency index: every nested drill, template, media and
board a share depends on. Same posture as `content_shares` (RLS on, no client
policy, no client grant). `dependency_kind` is one of `drill`, `template`,
`programme`, `media`, `board` (no `session`; a session is only ever a source).
`dependency_id` deliberately has no foreign key, so a nested entity can be
deleted while the dependency row is used to decide the share must go. A unique
constraint per `(share_id, dependency_kind, dependency_id)` prevents duplicate
rows, and an index on `(club_id, dependency_kind, dependency_id)` supports the
reverse lookup. Rows cascade away with their share.

## 5. The lifecycle write contract

`public.manage_content_share(action, actor_id, kind, source_id, share_id,
secret_hash, expires_at, no_expiry, idempotency_key)` is the single service
role only lifecycle function (create, refresh, rotate, revoke). EXECUTE is
revoked from `public`, `anon` and `authenticated` and granted to `service_role`
only, and the body additionally gates on `auth.role() = 'service_role'` (the
`grant_club_membership` precedent).

It is the **final authority**. Because `auth.uid()` is null under the service
role, `has_perm` cannot be used; the RPC re-derives the whole authorisation
from the passed actor id inside the one transaction, so a capability revoked
between a future Edge Function's early check and this call fails closed here.
Every check runs before any mutation:

- the actor is a real club member (a profile with a club);
- the actor's club equals the source's club, and the share's `club_id` is
  derived from the source, never from a client (no crossing clubs);
- the actor holds the sharing capability;
- the actor holds the source capability and satisfies ownership;
- the source rights are eligible and the aggregate nested rights are eligible
  (fail closed on a missing or `internal_only` nested item);
- the kill switch is on for create, refresh and rotate.

### Lifecycle action matrix

| Action | Who | Kill switch | Effect |
|---|---|---|---|
| create | owner with `shares.create` + source `*.create`, or `shares.create` + source `*.manage` | must be on | mints a share (SHA-256 hash, placeholder snapshot), writes the dependency set, one active per source, idempotent by key |
| refresh | the share creator, with `shares.create` | must be on | rebuilds the dependency set and re-checks aggregate rights, keeps the secret, extends a bounded expiry |
| rotate | the share creator, with `shares.create` | must be on | replaces the hash atomically (old secret dies instantly), retains snapshot and dependencies |
| revoke | the share creator with `shares.create`, or any `shares.manage` holder | allowed while off | sets `revoked_at`, clears the snapshot and dependency rows, idempotent |

### Owner versus manager

A `shares.manage` holder may **revoke** any club share, but may **not rotate or
refresh** another creator's share. Refresh and rotate are the creator's alone
(`created_by = actor`): rotate would silently kill the owner's live link and
hand the new secret to the wrong person, and refresh republishes the owner's
content. A manager who judges a share unsafe revokes it; the owner then creates
a fresh one. The RPC never transfers ownership (`created_by` never changes).

### Secret and hash model

At least 256 bits of randomness, base64url in the URL fragment (PR 2), SHA-256
stored. The RPC accepts and stores only the 32 byte hash; it never sees, logs
or returns the raw secret. Rotate replaces the hash; refresh does not touch it.
Stored hashes are never returned.

### Snapshot in PR 1

PR 2 owns the snapshot builders, so PR 1 stores a minimal placeholder
(`{snapshotVersion, kind, builder: pending, public: false}`) that carries no
content and cannot be publicly consumed (there is no public read path). This
is deliberately not a public-ready snapshot; the security relevant behaviour
(authority, aggregate eligibility, dependency recording, one active share,
idempotency, kill switch, audit) is fully implemented and tested now.

## 6. Aggregate block behaviour

One restricted nested item blocks the whole share. Create and refresh resolve
the full dependency set (nested drills, their media, the board for a session;
nested templates, their drills, media and the attached PDF for a programme;
the media for a drill) and refuse the share if the source's own rights are
`internal_only`, if any nested rights bearing item is `internal_only`, or if a
referenced entity is missing (fail closed). Restricted content is never
silently omitted, and PR 1 creates no partial snapshots.

Club scoping is load bearing. `content_share_deps` resolves every nested id
club scoped to the source's club (the nested ids come from the free form
`activities` jsonb and from `media_id` / `board_id` / `pdf_media_id`, none of
which is club constrained by a foreign key), so a same club source that
references a known foreign club entity uuid resolves that entity as a missing
dependency and blocks the share. No cross club dependency row is ever recorded.

Concurrency. A create or refresh reads the source rights and each nested rights
bearing row `FOR SHARE` (`content_share_lock_rights`), which conflicts with the
`FOR NO KEY UPDATE` a rights downgrade takes, so a concurrent downgrade either
waits until the share commits (then its trigger invalidates the new share) or
this read blocks until the downgrade commits (then it observes `internal_only`
and blocks). This closes the create versus downgrade TOCTOU where an
uncommitted new share would be invisible to the downgrade trigger.

## 7. Rights downgrade invalidation

When a content or media item drops to `internal_only`, every active share that
depends on it (as its source or as a nested item) is invalidated in the same
transaction: `revoked_at` set, snapshot cleared, dependency rows removed, and a
`content_share.invalidated` audit event written. Only the dependent shares are
touched, found through the source columns and the reverse dependency index,
never by a global sweep or a snapshot scan.

This is implemented as `after update of rights` triggers on `drills`, `media`,
`sessions`, `programmes` and `templates`, firing only on a transition to
`internal_only`, calling the private `content_share_invalidate_dependents`
function, which is club scoped to the entity's club on both the source column
arm and the reverse dependency arm (so a foreign club rights change can never
reach a same uuid share, and a non member or null server derived actor is
recorded as a system event rather than raising). A trigger is used, not an
explicit function call, because rights are updated through the normal client
UPDATE path (no Edge Function in the loop), so the invalidation must ride the
same transaction whatever writes the rights. Together with the create/refresh
`FOR SHARE` locking (section 6), no stale share remains potentially usable by
PR 2 later; PR 2's read path adds a third layer by verifying dependency
eligibility on every read.

## 8. Audit actions and metadata

The dedicated private writer `log_content_share_event` (service_role only,
`security definer`, fixed `search_path`) writes `content_share.created`,
`content_share.refreshed`, `content_share.rotated`, `content_share.revoked` and
`content_share.invalidated`, and registers `content_share.expired` for the PR 2
scheduled cleanup. `entity_type` is `content_share`; the durable source kind and
id ride in metadata so who shared which item resolves after both the source and
the share row are deleted.

Metadata is an allow list (`content_share_metadata_ok`): only `source_kind`,
`source_id`, `expiry_state`, `reason_code` and `initiator`, each bounded to a
fixed vocabulary or a uuid. No raw secret, secret hash, snapshot, source title,
session detail, drill or programme text, media path or free text can ever
appear. A refused or rolled back action writes nothing (the audit insert is in
the same transaction as the mutation). Full detail is in
`docs/security/app-audit-boundary.md` (Content share audit).

## 9. Security posture and direct access denial

- The migration is additive; a rollback drops the tables, columns, functions,
  enums and grants through the gated procedure.
- No anonymous access, no public route, no `verify_jwt = false` function, no
  public Edge Function are added.
- Neither `content_shares` nor `content_share_dependencies` grants anon or
  authenticated any privilege, and neither carries any RLS policy, so no
  browser role can read or write them; a `shares.manage` holder's oversight
  goes through the service role lifecycle path, not a direct select.
- The lifecycle RPC and the sharing audit writer have exact function signature
  grants (service_role only, EXECUTE revoked from PUBLIC, anon and
  authenticated); the internal helpers (`content_share_deps`,
  `content_share_actor_has_cap`, `content_share_invalidate_dependents`) are
  private (no client EXECUTE). The migration self verifies these grants.
- Every `security definer` function sets a fixed safe `search_path = ''` and
  fully schema qualifies its references; there is no dynamic SQL, and no user
  controlled identifier is interpolated into SQL (the capability keys the RPC
  builds from `kind` are values compared as parameters, from a three value
  enum, never identifiers).
- No path crosses clubs, acts as another user, or lets a manager rotate
  another coach's link; revoke stays available while the kill switch is off.
- RLS is enabled (not forced, matching every other table and the definer
  function ownership model, so the lifecycle RPC reaches the tables as their
  owner).

## 10. What PR 1 does not do (the PR 2 dependency)

PR 1 is the security substrate only. It does not build the snapshot builders,
the public read function, the public route, media signing, the rate limit, the
scheduled expiry cleanup or any UI. Those are PR 2 and later. The kill switch
check on a public read, and `content_share.expired`, exist in schema and
writer form here but are exercised only from PR 2. No public reading is
implemented; do not treat the placeholder snapshot as a public projection.

---

# Content sharing boundary: the public read path (PR 2)

This part is the security contract for Content Sharing PR 2 (public drill
sharing), delivered by `0039_public_share_read.sql`, the two Edge Functions
`manage-content-share` and `read-content-share`, the shared module
`supabase/functions/_shared/share.ts`, and the public route `/share/:shareId`.
PR 2 is **drill only**: sessions and programmes remain unsupported publicly, and
there is no generic renderer that could silently expose another source kind.

## 11. The public route and secret model

- The public URL is `/share/:shareId#secret`.
  - `shareId` is the share row's own uuid, a lookup id, never a source, club or
    user id, and not an authorisation secret.
  - The `secret` lives in the URL **fragment** (`#secret`), which the browser
    never sends in the request line or the `Referer` header, so it never reaches
    Vercel route logs or an external resource the page loads.
  - The page reads the secret from `window.location.hash` and sends `shareId`
    and `secret` to `read-content-share` in a POST body, never in a query
    string or the path.
- The secret is 256 bits of `crypto.getRandomValues` randomness, base64url
  encoded (43 chars). Only its SHA-256 hash is stored (`token_hash bytea`, 32
  bytes, a schema constraint). The raw secret is generated server side and
  returned to the owner **only once** on create or rotate; it is never stored,
  never logged, never placed in localStorage, analytics, the audit log or a
  query cache. Losing it requires rotation.
- The public lookup hashes the presented secret and the definer function
  `read_public_share` does a keyed lookup (`where id = $1 and token_hash = $2`),
  so an unknown id and a wrong secret are indistinguishable. The residual timing
  signal of a keyed equality is negligible (256-bit secret, generic response,
  rate limited); this is the accepted model from the roadmap section 14.

## 12. The snapshot: builder, schema and public fields

- The snapshot is built server side by the trusted management function from the
  live drill and its optional media, through the pure `buildDrillSnapshot` in
  `_shared/share.ts`. It is a strict allow list: only the named fields are
  copied. A recursive scanner (`assertAllowlistedKeys`, `assertNoForbiddenKeys`)
  asserts no key outside the allow list, and no forbidden key, reaches the
  payload at any nesting level.
- `snapshotVersion` is pinned to `1` (`SNAPSHOT_VERSION`); the read path and the
  public page refuse an unknown version. The stored snapshot carries internal
  markers (`builder: 'drill@1'`, `public: true`) that the read path strips; a PR
  1 placeholder (`builder: 'pending'`, `public: false`) is never publicly
  readable.
- Included public drill fields: `title`, `summary`, `classification` (corner or
  public tags), `skill`, `ages`, `level`, `duration`, `playerGuidance` (the
  `players` field), `area`, `equipment`, `setupNotes`, `coachingPoints` (the
  `points` field), `easier`, `harder`, `theme`, `format`, `sourceAttribution`
  (`source_url`/`source_label` where present), `media`, `snapshotAt`.
- Excluded, by allow list and by the recursive forbidden-key scan: `club_id`,
  `created_by`, `created_at`, `media_id`, `source_key`, `source_programme_id`,
  the real drill/media uuids, `storage_path`, `embed_url`, `token_hash`,
  `coach_id`, any member id or name, `author`, and any internal or operational
  field. Free text is sanitised (HTML tags, script/style/embed blocks,
  event-handler remnants and `javascript:`/`data:`/`vbscript:` schemes stripped);
  the public page renders every field as a React text node, never via innerHTML.

## 13. Media behaviour (fail closed)

- `internal_only` media never appears and, as a nested dependency, blocks the
  whole drill share (the PR 1 aggregate block rule; enforced in the lifecycle
  RPC and re-checked at read time).
- `public_full` stored media (image, pdf, video with a `storage_path`) is
  delivered through a short lived (ten minute) signed URL minted at read time by
  `read-content-share`, for the exact path the definer function named, never a
  caller-supplied path. No expiring signed URL is ever stored in the snapshot;
  the snapshot holds the path in a private `_path` field that the read path
  strips from the response, and re-signs on each read.
- `public_link_only` media (for example a public YouTube link) is represented as
  an external link only, never a downloadable stored binary. A `public_link_only`
  stored object with no external link is rendered as caption only.
- Honest residual (unchanged from the roadmap, sharpened in PR 3): a Supabase
  signed URL embeds the object path (`{club_id}/{uuid}-{filename}`) in cleartext,
  so the anonymous viewer receives the club and object uuids AND the original
  uploaded file name (lowercased, non-word runs replaced, but otherwise intact).
  The uuids are a low-impact correlation handle, but the file name can itself
  carry a human identifier: a coach who uploads a file named after a child leaks
  that name through the link, even though the name never appears as text in the
  preview and is not covered by the caption scrub. The v1 mitigation is the
  coach-facing warning ("The name of an uploaded file can also be seen by anyone
  who opens it, so replace a file whose name includes a child's name before
  sharing", `RIGHTS_WARNING`); the full fix (copying or content-addressing media
  to a name-free path at share time) is deferred past v1 and is the same deferred
  work the roadmap named in sections 8.2 and 11.5. PR 3 broadens the exposure
  (one session pools media from several drills), so the warning matters more.

## 14. Preview flow

Before a coach creates a public link, the management function's `preview` action
builds the exact projection through the SAME builder as create (no separate
frontend eligibility path that could drift), and returns it with the rights
status and the eligibility result. The Drill Detail preview modal shows every
public field, marks the coach-authored free-text group ("You wrote this, it will
be public"), carries the rights warning ("Confirm this text and any diagrams are
the club's own work or cleared for public use..."), and blocks publishing when
the source or any dependency is `internal_only`, offering the internal club link
instead. Preview writes nothing and emits no audit event.

## 15. Kill switch

Public read fails closed while `clubs.public_sharing_enabled` is false:
`read_public_share` checks it after resolving the share's club and returns the
neutral unavailable response. Create, refresh and rotate already fail closed
while off (PR 1); revoke stays allowed. The management function's `status` action
surfaces the club switch state so the UI shows a calm disabled state. No
migration, deploy or test enables the switch; it stays false on every club, and
hosted production remains disabled until a separate explicit approval.

## 16. The two Edge Functions

- `manage-content-share` (verify_jwt ON): authenticates the caller
  (`resolveCaller`), makes an early `has_perm` capability check under the
  caller's identity, derives club and source authority server side, builds the
  snapshot server side, generates the raw secret only for create/rotate, hashes
  it before passing to the RPC, and calls the service role lifecycle RPC which is
  the final authority. It never accepts `club_id`, an actor id or a snapshot from
  the body; it never returns the token hash; it never logs the secret, snapshot
  or drill text. Drill only; a non-drill kind is refused. An idempotency key is
  required for create.
- `read-content-share` (verify_jwt OFF, declared in `config.toml`): the first and
  only anonymous function. It holds the service role (to read `content_shares`
  and sign private media) and reaches the database only through the narrow
  `read_public_share` SECURITY DEFINER function. It accepts only a bounded
  `shareId` and `secret` in a POST body, hashes the secret, returns only the
  stored snapshot with a short lived signed URL per eligible media, sets
  `Cache-Control: no-store` and security headers, locks CORS to `APP_ORIGIN`,
  allows only POST/OPTIONS, and returns the identical neutral
  `{ status: 'unavailable' }` for every lifecycle failure. It never returns a
  `content_shares` column, hash, source id, club id or member id, and never logs
  the secret or snapshot. The lifecycle RPC is never exposed to browser clients.

## 17. Anonymous-reader failure uniformity

Unknown id, wrong secret, revoked, expired, kill-switch-off, placeholder
snapshot, unknown version, non-drill kind, and an ineligible or missing
dependency ALL return the identical `{ status: 'unavailable' }` at HTTP 200, with
no distinguishing header, body or status code. A transport failure (5xx/network)
is distinct (`{ status: 'error' }` with a retry), because it reveals nothing
about the link's lifecycle. Malformed input is treated as unavailable.

## 18. Expiry

- Enforcement is at read time: `read_public_share` compares `expires_at` and
  returns unavailable the instant a share is past expiry, mutating nothing.
- Physical clearing is deferred to `content_share_expiry_cleanup(retention)`, a
  service-role function that nulls the snapshot and removes the dependency rows
  of a share expired beyond a retention window (default seven days) and emits
  `content_share.expired` (a system event, `reason_code: expired_cleanup`).
  During the window an expired share is inaccessible but still stored, so a
  Refresh can extend it. This migration creates NO schedule (no casual unaudited
  background job); wiring a daily invocation is a gated deploy step with a named
  owner (roadmap section 25). Until then, expiry is read-time enforced and an
  expired share retains its stored snapshot until Revoke or a manual cleanup run.

## 19. Rate limiting

`read-content-share` is internet facing. It enforces hard input caps (bounded
token length/charset, a body size limit, a POST-only method allow-list, and a
single indexed row lookup) which hold per request. It also applies a
best-effort in-memory limiter keyed by `shareId` and by a hashed source IP (the
raw IP is never stored or logged), falling back to `shareId` alone when a
trustworthy IP is unavailable. HONEST LIMITATION: this limiter is per worker and
is NOT globally durable; it is a first line, not a claimed global control. A
durable distributed limit (a platform rate limit or a shared store the function
can reach) is a PR 2 design gate and a follow up; until it exists, the section
23 detection lines that depend on a global limiter are best-effort only.

## 20. Management authority matrix (PR 2)

| Action | Who |
|---|---|
| preview, create | drill owner with `shares.create` + `drills.create`, or `drills.manage` + `shares.create` |
| refresh, rotate | the share creator only, with `shares.create` (a manager may NOT refresh or rotate another creator's link) |
| revoke | the share creator with `shares.create`, or any `shares.manage` holder (revoke works while the kill switch is off) |
| status/review | the share owner, or a `shares.manage` holder |
| parent | none |

The UI mirrors this but is never the boundary; the lifecycle RPC re-validates
the passed actor's club, sharing capability, source capability, ownership and
source club inside the transaction, so a capability revoked between the Edge
Function check and the RPC fails closed.

## 21. Audit behaviour

Uses the PR 1 registered actions only. Exactly one audit event per successful
management action (`content_share.created/refreshed/rotated/revoked`); the
downgrade trigger emits `content_share.invalidated`; the expiry cleanup emits
`content_share.expired`. No event on preview, no event on an anonymous read, no
event on an invalid token probe, and a refused or rolled-back write emits
nothing (the audit insert is in the same transaction as the mutation). Metadata
stays within the PR 1 allow list; a raw secret, hash, snapshot or drill text
never enters the audit log.

## 22. Indexing and caching

- `X-Robots-Tag: noindex, nofollow` on `/share/*` at the Vercel edge
  (`vercel.json`), plus a client `<meta name="robots">`, so the unlisted links
  are not indexed.
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a
  Content-Security-Policy on `/share/*` limiting scripts to self, framing to
  none, and connect/img/media to self, the Supabase origin and
  `img.youtube.com`, with no third-party script origins.
- `Cache-Control: no-store` on the read API response, so intermediaries do not
  cache a snapshot.

## 23. What PR 2 does NOT do

- No public session sharing and no public programme sharing (`read_public_share`
  refuses any non-drill kind).
- No direct anonymous or authenticated database access to `content_shares` or
  `content_share_dependencies` (no client policy or grant is added); the public
  boundary remains the Edge Function/service layer.
- No plaintext secret storage; no hosted migration applied; no hosted Edge
  Function deployed; `public_sharing_enabled` stays false on every club.
- No change to the existing FA import/content behaviour; all existing drills
  remain `internal_only` and are therefore not eligible for public sharing.

---

# Content sharing boundary: public session sharing (PR 3)

This part is the security contract for Content Sharing PR 3 (public session
sharing), delivered by `0040_public_session_read.sql`, the session builder in
`supabase/functions/_shared/share.ts`, the session branches of
`manage-content-share` and `read-content-share`, and the session rendering in
`src/routes/PublicShare.tsx` / `src/components/PublicSessionView.tsx`. PR 3 is
**drill and session only**: a programme share remains unsupported publicly and
`read_public_share` still fails a programme kind closed.

## 24. What already existed (PR 1 substrate, reused unchanged)

The whole management substrate was built polymorphic in PR 1 and needs no
schema change for sessions: `content_shares.kind` already includes `session`,
the kind/source check constraints and the one-active-per-source and idempotency
indexes already cover `session_id`, and `manage_content_share` and
`content_share_deps` already branch on `kind = 'session'` to lock the session
`FOR SHARE`, resolve its nested drills from the `activities` jsonb, those
drills' media, and the attached board, and to record the authoritative server
derived dependency set. The downgrade invalidation triggers and the audit
writer already cover a session source. The client never submits the dependency
graph; the RPC re-derives it.

## 25. The one migration (0040) and why it is required

The only drill-only code in the shipped path was the anonymous read:
`read_public_share` failed closed for any kind other than drill. Because the
read returns the neutral unavailable response before returning any snapshot, a
session share could not be read publicly without widening that gate. `0040`
recreates `read_public_share` with a single behavioural change, the kind gate
from `= drill` to `in (drill, session)`; its board dependency arm is byte for
byte 0039 (`b.club_id = v_share.club_id`), unchanged.

`0040` also recreates `content_share_deps` with one change confined to the board
arm. `boards.club_id` is a real `not null` column (0020), the column the boards
RLS and `read_public_share` already scope by, but `content_share_deps` (0038)
scoped the board dependency through the board CREATOR'S profile club
(`bpr.club_id = p_club`) rather than the board's own `club_id`. That creator
scoping is a different, weaker rule: it is three-valued (SQL NULL, which the
RPC's `if not dep_exists` skips) when a creator's profile club is null, and it
mis-scopes a board whose creator later changed clubs. PR 3 is the first to
exercise the board arm (a board is only ever a session dependency), so `0040`
aligns `content_share_deps` to scope the board by its own `club_id`, identical
to `read_public_share` and the boards RLS: create-time and read-time board
scoping are now consistent, canonical and two-valued (never NULL). No public
data was ever exposed by the old scoping (the read path already used
`b.club_id`). The migration is additive and reversible (recreate the 0038/0039
bodies to roll back), adds no client grant or policy, creates no schedule,
reclassifies nothing, and does not enable the kill switch.

## 26. The session snapshot and media pool

The session snapshot (`buildSessionSnapshot`, `SESSION_BUILDER = 'session@1'`)
is a strict allow list, the same discipline as the drill builder: an allow list
scanner asserts no key outside the named set at any level, and a recursive
forbidden-key scan (extended with the session operational columns `team_id`,
`venue`, `start_time`, `spond_event_id`, `board_id`, the live state and `date`)
rejects any leak. Public fields: `displayTitle`, `focus`, `ageGroup`,
`totalDuration` (derived), `intentions`, `space`, ordered `activities` (each a
`phase` and `duration` plus either a `customTitle` or a snapshot-local
`drillRef`), `referencedDrills` (the full safe drill projection keyed by a
snapshot-local ref, media referenced by ref), a safe `board` (`formation` plus
tokens stripped to `number`, `side`, `x`, `y` only, no `id`, no `playerId`, no
name, honouring the registered players board boundary), a flat top-level
`media` pool, `sourceAttribution`, and `snapshotAt`. Excluded operational
columns: `club_id`, `coach_id` and coach name, `team_id` and team name, `date`,
`start_time`, `venue`, `spond_event_id` and all attendance, the live state,
`status`, `programme_id`/`programme_week`, the real `board_id`/`media_id` and
any uuid, and player names or ids.

Media is a single flat top-level pool so `read_public_share` signs it with the
exact loop it uses for a drill (no nested traversal, no SQL change): every
referenced drill's media is pooled once, keyed by ref, and the referenced
drills point in by `mediaRefs`. The read path signs only `public_full` stored
media by the path the definer function named, strips `_mid`/`_path`, and never
signs a caller-supplied path, identically to the drill flow.

## 27. Aggregate block and read-time re-eligibility (fail closed, no partial)

The PR 1 aggregate block rule applies unchanged: a session share is created or
refreshed only when the session's own rights and every nested drill, its media,
and the attached board are eligible and present in the source's club. One
`internal_only`, missing or cross-club dependency, an unsupported activity item
(a non-object entry or a `drill_id` that is not a uuid), or a malformed board
blocks the whole share; nothing is silently omitted. At read time
`read_public_share` re-checks every recorded dependency's current rights and
existence; a nested drill or media downgraded to `internal_only` after creation,
or a nested entity removed, fails the entire share closed. There is never a
partial session.

## 28. The two Edge Functions (session branch)

`manage-content-share` (verify_jwt ON) accepts `kind` of `drill` or `session`;
a programme kind is refused. For a session it reads the session, its nested
drills, their media and the attached board under the service role, each
manually club scoped exactly as `content_share_deps` does, evaluates eligibility
(`evaluateSessionEligibility`), builds the snapshot server side, and passes it
to the lifecycle RPC, which is the final authority and independently re-derives
the dependency set. It never accepts a club id, actor id, snapshot or dependency
list from the body; it never returns the token hash; it never logs the secret,
snapshot or session text. `read-content-share` (verify_jwt OFF) dispatches the
public validation on `snapshot.kind` (`validatePublicDrillSnapshot` or
`validatePublicSessionSnapshot`); any other kind fails closed to the neutral
unavailable response. Its media signing loop is unchanged (the flat top-level
pool). Failure uniformity, CORS, `Cache-Control: no-store`, the security headers
and the rate limit are unchanged.

## 29. What PR 3 does NOT do

- No public programme sharing (`read_public_share` still refuses a programme
  kind); copy/import remains a separate future programme.
- No new client policy or grant on `content_shares` or
  `content_share_dependencies`; the public boundary remains the Edge
  Function/service layer.
- No new capability, no new audit action (it reuses the PR 1 registered
  actions), no plaintext secret storage.
- No hosted migration applied, no hosted Edge Function deployed, no production
  share created, no content reclassified; `public_sharing_enabled` stays false
  on every club, and hosted public sharing stays disabled until a separate
  explicit approval.

---

# Part four: public programme sharing and safe print (Content Sharing PR 4, with the browser-print portion of PR 6)

## 30. What PR 4 adds

Public sharing of a whole PROGRAMME: its overview, its ordered weeks, each
week's ordered activities, the drills those activities reference, those drills'
media, and an optional attached PDF. Plus a Print / Save as PDF action on the
public page, which is the browser-print portion of PR 6.

The management model, the URL and secret model, the lifecycle, the audit
actions, the kill switch, the expiry policy, the failure uniformity and the
rate limit are all unchanged from PR 1 to PR 3. A programme share is another
source kind inside the same substrate, with its own explicit branch at every
layer.

## 31. The programme dependency graph

```
programme (source, rights)
 ├─ templates WHERE programme_id = programme.id AND club_id = club   -> dependency_kind 'template'
 │    └─ activities[].drill_id -> drills (club scoped)               -> dependency_kind 'drill'
 │          └─ drills.media_id -> media (club scoped)                -> dependency_kind 'media'
 └─ programmes.pdf_media_id    -> media (club scoped)                -> dependency_kind 'media'
```

The graph is derived server side by `content_share_deps`, which already had a
complete programme branch from 0040, club scoped at every hop. A cross club or
absent nested id resolves as a missing dependency (`dep_exists` false) and
blocks the share; it is never followed. The dependency set is never taken from
the client, on create or on refresh.

A week is not a table: it is a `templates` row carrying `programme_week`. Every
template belonging to the programme is a dependency, including one with no week
assigned. An unassigned template is not rendered but its rights still gate the
share. The asymmetry is deliberate and strictly fail closed: a share can be
blocked by a template the public page would not have shown, never the reverse.

## 32. The public programme snapshot

Allow listed, versioned (`snapshotVersion: 1`), built server side, and validated
by its own guard at three points: the builder's own allow list scan, the read
function's public validator, and the browser's independent re-check before
anything renders.

Top level: `snapshotVersion`, `kind`, `displayTitle`, `focus`, `summary`,
`intentions`, `weeks`, `orderedWeekNumbers`, `weekTemplates`,
`referencedDrills`, `pdf`, `media`, `sourceAttribution`, `snapshotAt`, plus the
stored-only `builder` and `public` markers the read path strips.

Each week carries `week`, `title`, `focus`, `activities`, `totalDuration`. The
number field is named `week`: `programmeWeek` and `programme_week` are both in
`FORBIDDEN_ANYWHERE`, so a projection that used either would make the builder
throw on its own output.

**`templates.author` is the hard exclusion.** It is a club member's full name in
plain text. It is not in the column list the Edge Function reads, not in the
`TemplateRow` type, not in the allow list, and it is in the forbidden key
scanner on both the server and the client. Four independent layers.

Also excluded: every real id (programme, template, drill, media), `club_id`,
`created_by`, `created_at`, `rights`, `storage_path`, `embed_url`, the legacy
`programme` and `week` label columns, and every operational field a programme
page shows but a public copy must not (the linked club sessions, per team
progress, team names and ids, session dates, venues, `spond_event_id`, live
state). Drill and media references are snapshot-local refs (`d1`, `m1`) minted
in the snapshot, never database ids.

`created_at` is READ from templates, for ordering only. Weeks are walked in
ascending week order, tie broken by `created_at` then by id, so the earliest
created template claims a contested week exactly as the club's programme page
renders it, and the output is deterministic regardless of the row order
Postgres returned. It never enters the snapshot.

## 33. Caps (reported, never silently applied)

| Cap | Value | Enforced |
|---|---|---|
| Weeks | 12 | builder, with a stated reason |
| Referenced media | 64 | builder, with a stated reason |
| Stored snapshot | 256 KiB | the RPC is the authority; the builder checks it too so the coach gets a reason instead of a bare failure |

A programme over any cap is refused. It is never truncated, because a truncated
programme would publish a partial copy of the club's material while presenting
itself as the whole thing.

## 34. The attached PDF policy (explicit)

The programme PDF is private media and is treated exactly like any other media
dependency. It is shared only when it exists in the same club, is not
`internal_only`, is in the server derived dependency set, and is referenced
through a snapshot-local media ref. The read function signs only the stored path
the database read function returned.

**An `internal_only`, missing or cross club PDF blocks the WHOLE programme
share.** It is never silently omitted. The rule is stated here because the
alternative (publish the programme without its document) was available and was
rejected: the PDF is usually the programme's substance, and a copy without it
would misrepresent what was shared. `content_share_deps` already emits
`pdf_media_id` as a media dependency, so the RPC enforces this independently of
the builder. Both the builder and the database refuse it, and a test pins each.

A programme with no weeks at all is refused too (`no_weeks`), for the same
reason: an overview with no content is not a useful public copy.

The media bucket stays private. Nothing here makes it public.

## 35. The one migration (0041) and why it is required

Every programme-shaped piece of the substrate already existed and was already
live: the `programme` value in `content_share_kind`, `content_shares.programme_id`
with both check constraints, the one-active and idempotency indexes, the
`content_share_deps` programme branch, the `content_share_lock_rights` template
and programme arms, the lifecycle RPC's programme arms, the `programmes.manage`
and `programmes.create` capabilities, the audit `source_kind` vocabulary, and
the rights downgrade triggers on `programmes` and `templates`.

The one blocker was the anonymous READ path. `read_public_share` failed closed
for any kind other than drill or session. 0041 widens that allow list from
`{drill, session}` to `{drill, session, programme}` and nothing else. Outside
comments, the function body differs from 0040 in exactly one line. The signature
is unchanged, so the signature pin and the existing grants are untouched (the
grants are re-stated anyway). The migration changes no table, column, enum,
constraint, index, trigger or capability, enables no club, creates no share and
reclassifies no content, and its self-verification block asserts all of that.

## 36. Read-time re-eligibility (fail closed, no partial programme)

`read_public_share` re-checks every recorded dependency's current rights and
existence on every read. A programme's dependency kinds are `template`, `drill`
and `media`, and each already had an arm. So a week template, a nested drill, a
nested media item or the attached PDF that is later downgraded to
`internal_only`, deleted, or moved to another club takes the WHOLE programme
share dark, with the identical neutral unavailable response. No partial
programme is ever returned.

The rights downgrade triggers additionally revoke an active programme share in
the same transaction as the downgrade and null its snapshot.

**Known residual, unchanged from PR 2 and PR 3.** `read_public_share` re-checks
every DEPENDENCY's rights, but not the SOURCE row's own current rights, because
`content_share_deps` never emits the source as a dependency of itself. This is
true for drill and session sources today and is now true for programme sources
too; PR 4 deliberately did not change it, because doing so would alter drill and
session read behaviour and is beyond widening the kind gate. The compensating
control is the downgrade trigger, which revokes the share the moment the source
is downgraded. Worth revisiting as its own change, for all three kinds at once.

## 37. The two Edge Functions (programme branch)

`manage-content-share` gains an explicit programme branch: `PROGRAMME_COLS` and
`TEMPLATE_COLS` (no `author`, no `created_by`), `loadProgrammeForShare` (which
matches `content_share_deps`' programme branch set for set), programme
eligibility, the programme builder, and programme arms for preview, create,
refresh and status. Its kind resolve is now exhaustive: an unrecognised kind is
refused rather than coerced. This closed a real defect, where
`{action:'status', kind:'programme'}` silently became a drill lookup and queried
the wrong source column.

`read-content-share` gains one arm: a programme snapshot is validated by
`validatePublicProgrammeSnapshot`. There is no generic validator; each kind
keeps its own guard, and an unknown kind fails closed. `verify_jwt` stays true
on manage and false on read, and read remains the only anonymous function.

`assertAllowlistedKeys` now dispatches explicitly on `drill | session |
programme` and throws on any unknown kind, replacing an unguarded fallthrough
that would have validated a future fourth kind against the drill allow list.

## 38. Print and Save as PDF (the browser-print portion of PR 6)

The public page offers a Print / Save as PDF action. It calls `window.print()`
on the already rendered, already validated snapshot DOM.

- It makes no request, reads no live row, adds no database access, needs no
  Edge Function and generates no server side PDF.
- The page content it prints is structurally incapable of carrying anything the
  public projection did not: the page imports no authenticated data layer, and
  the button sits inside the post-validation render branch.
- The browser's OWN print chrome is the exception, and both halves are handled.
  Browsers print `document.title` in the header and `document.URL` in the
  footer by default. The title was already overwritten with neutral copy. The
  URL is the one that mattered: our secret lives in the URL FRAGMENT, so a naive
  print would have stamped a working credential onto every sheet of a saved PDF,
  and that PDF is exactly what recipients forward on. The page now strips the
  fragment for the duration of the print and restores it immediately after, via
  both the button handler and `beforeprint`/`afterprint` (so the browser's own
  Ctrl+P is covered too). The fragment is restored rather than dropped, so a
  plain page reload still works.
- The print stylesheet hides every control (the reload button, the print button
  itself, the print note and the page footer), keeps weeks, activities, drills
  and media figures from splitting across pages, starts each programme week on a
  fresh page, and preserves colour so a four corners tag stays legible.
- Attribution is kept visible in print, because the FA terms require the source
  to appear wherever the image renders.

The page states plainly: **"A downloaded or printed copy cannot be turned off or
recalled."** Revoking a link cannot reach a copy that has already left the
platform. That is a property of any export, and saying so is the honest control.

No generated PDF service was built. If browser print ever proves inadequate, a
server side PDF function is its own gated change, not an extension of this one.

## 38a. Residuals recorded by the PR 4 adversarial review

These are true, are NOT introduced by this branch, and are recorded so they are
not mistaken for new findings later. None of them is a fail-open.

- **`media.storage_path` is free text, and the path is what gets signed.** The
  rights gate is on the media ROW, while the capability granted is the PATH
  string frozen in the snapshot, signed under the service role. A coach with
  `media.create` could insert a `public_full` media row whose `storage_path`
  duplicates an `internal_only` object's path (or an `avatars/` path), attach it
  and publish it with every gate satisfied. This primitive has existed since
  PR 2 (drill media has the identical shape); the programme PDF is a new
  instantiation of it, not a new primitive. **Worth constraining
  `media.storage_path` to the caller's club prefix, and excluding `avatars/`,
  before any club is enabled.** That is a schema change and belongs in its own
  gated migration.
- **The signed path is the snapshot's frozen `_path`, not the live
  `media.storage_path`.** Repointing a media row after publish keeps serving the
  old object. Same family as above, identical in 0039 and 0040.
- **A demoted share owner keeps refresh and rotate authority.** The lifecycle
  RPC re-checks share ownership plus `shares.create`, never the SOURCE
  capability that create required. Pre-existing; broader in effect for a
  programme than for a drill.
- **`sanitizeText` is quadratic on hostile input** (the regex chain runs before
  the length slice), and a programme multiplies that cost across every
  referenced drill. Pre-existing PR 2 code; not changed here to keep drill and
  session behaviour identical.
- **Caps are measured after materialisation.** Nothing bounds activities per
  week or referenced drills; the size cap is checked on the built snapshot. All
  insider-reachable only, all fail closed. The week and media caps now bind
  before materialisation.
- **A non-array `templates.activities` produces a misleading 403** rather than a
  stated reason, because the dependency resolver raises inside the RPC. Fail
  closed, wrong message. Same shape for sessions since PR 3.
- **A template carrying `programme_id` with no rendered week is a blocking
  dependency no page shows.** Deliberate and documented in section 31; deleting
  such a template takes a live link unavailable until someone refreshes.

## 39. Management authority matrix (programme)

| Action | Who |
|---|---|
| preview, create | programme owner with `shares.create` + `programmes.create`, or `programmes.manage` + `shares.create` |
| refresh, rotate | the share creator only, with `shares.create` |
| revoke | the share creator with `shares.create`, or any `shares.manage` holder |
| status/review | the share owner, or a `shares.manage` holder |
| parent | none |

No new capability was introduced. The lifecycle RPC resolves programme authority
through its existing `p_kind::text || 's.manage'` and `p_kind::text || 's.create'`
construction, which lands on the capabilities that already govern the programme
edit buttons. Expiry policy is unchanged: 90 days for a `shares.create` holder,
no-expiry only for a `shares.manage` holder. The roadmap's floated 180 day
programme default is NOT implemented; it would require changing the SQL expiry
policy, which is a separate decision.

## 40. Signed URL residual, widened scope

A programme pools media from many weeks and many drills, so one programme link
can expose more uploaded FILENAMES (visible inside a signed URL) than a drill or
session link does. The residual itself is unchanged and already documented in
section 13; PR 4 only widens how much of it one link can carry. The owner facing
warning about file names is shown on the programme control exactly as it is on
the drill and session controls.

## 41. What PR 4 does NOT do

- No authenticated copy or import of a shared programme; that remains a
  separately scoped future programme (roadmap PR 7).
- No generated server side PDF.
- No club-wide shared links management surface; that is its own PR.
- No new client policy or grant on `content_shares` or
  `content_share_dependencies`.
- No new capability, no new audit action, no plaintext secret storage, no change
  to the expiry policy.
- No change to drill or session behaviour: the existing tests all still pass
  unchanged, and 0041's executable SQL differs from 0040 in one line.
- No hosted migration applied, no hosted Edge Function deployed, no production
  share created, no content reclassified; `public_sharing_enabled` stays false
  on every club, and hosted public sharing stays disabled until a separate
  explicit approval.

---

# Content sharing boundary: the media signing path (0042)

## 42. The threat this closes

`media.storage_path` is a key into the private `media` Storage bucket. The
anonymous read path signs it with the **service role**, which bypasses every
Storage policy in `0027_storage_boundary.sql`. Until 0042 the column was bare
nullable text: `media_update_owner_or_manager` (0012) constrains `club_id` and
capability, never the path VALUE, so a member who could edit a media row could
point a `public_full` row at:

| # | Target | Why it was reachable |
|---|---|---|
| a | Another club's object | No club prefix was ever checked. |
| b | A member's avatar | `avatars/{user_id}/...` shares the bucket, and `profiles.avatar_url` is readable club-wide, so the exact key was known. Signing it published a member's face on an unauthenticated URL. |
| c | An `internal_only` row's object | Rights live on the ROW. `media_select_club` exposes `storage_path` club-wide, so a second row could name the same bytes and carry weaker rights. |
| d | An object it never created | Nothing tied the column to any object the writer was permitted to write. |
| e | A stale object | The read path re-checked the live row's RIGHTS but signed the path frozen in the snapshot, so a later path change left the share serving the old object. |

(a), (b) and (c) were exploitable with no guessing. All of them required an
authenticated member and an enabled club, and `public_sharing_enabled` has been
false on every club throughout, so none was ever reachable in production.

## 43. The canonical grammar

A stored media object lives at exactly:

```
{club_id}/{segment}[/{segment}...]
```

Each segment starts alphanumeric and then allows `.`, `-` and `_`; the whole
path is at most 512 characters and may never contain an `avatars` segment at any
depth. The character set contains no `/` within a segment, no `\`, no `%`, no
`:`, no space and no control byte, so traversal, percent encoding and control
character tricks fail the character test before any structural test runs.
Nothing normalises a path: the grammar accepts or rejects, because normalising
an attacker's string and then trusting the result is the bug class being closed.

Stated three times, and pinned together by `tests/fixtures/media-path-cases.json`
which all three suites run:

| Implementation | Used by |
|---|---|
| `public.is_canonical_media_path(text, uuid)` | the CHECK constraint and the read path |
| `supabase/functions/_shared/mediaPath.ts` | the snapshot builder and the manage function |
| `src/lib/mediaPath.ts` | the upload flows |

The SQL function is not executable by `anon` or `authenticated`. A CHECK
constraint does not require the writing role to hold EXECUTE on a function it
calls, which 0042 asserts rather than assumes.

## 44. The enforcement layers

1. **Upload.** `mediaStoragePath()` builds the key and refuses one the database
   would reject, so a bad path never leaves an orphaned object in the bucket.
2. **Database (the boundary).** `media_storage_path_canonical` refuses a
   non canonical or cross club path outright. `media_storage_path_unique`
   allows at most one row per stored object, which is what closes (c): the
   rights class can no longer be detached from the bytes it protects.
3. **Snapshot creation.** `invalidMediaPaths()` makes the manage function return
   a 422 carrying `media_path_invalid`, and `buildMediaEntry` throws rather than
   put an unvalidated path into `_path`.
4. **Read and signing.** `read_public_share` signs the **live** media row's
   path, revalidated against the grammar. The snapshot's `_path` is demoted to a
   marker that must agree; a disagreement fails the whole share closed,
   neutrally. `read-content-share` re-checks the club agnostic shape as the last
   gate before the service role signs.
5. **Dependency lifecycle.** Changing a `storage_path` or `club_id` invalidates
   every dependent active share and records `reason_code = path_changed`,
   matching how a rights downgrade already behaves. All or nothing is preserved
   throughout: there is no partial drill, session or programme.

## 45. Existing data and rollback

A read-only hosted preflight ran before the migration was written: 105 of 111
media rows carry a path and **all 105 already satisfied the grammar**, with zero
rows outside their club prefix, zero avatars paths, zero duplicates and zero
malformed paths. The constraint was therefore added validated, with no data
remediation and no production row rewritten.

Rollback is documented in the migration header and is fully reversible: drop the
trigger, function, index and constraint, then restore `read_public_share`,
`content_share_metadata_ok` and `content_share_invalidate_dependents` from their
0041/0038 bodies. Rolling back restores the stale path exposure, so it is a
break-glass step rather than a routine one.

## 46. What 0042 does NOT do

- No club is enabled, no share is created, no content is reclassified.
- No new capability, no new client policy and no new client grant.
- No change to the rights model, the secret model, expiry or rate limiting.
- The only audit change is one added `reason_code` value; the metadata allow
  list stays closed and still carries no free text and no identifier.
### Residuals

Two, both recorded rather than fixed, and both bounded to the club's own
namespace:

1. **Orphan adoption.** An object in the club's own bucket prefix that no media
   row names (an orphan left by a failed replace) can still be adopted by a new
   row. Bounded to objects created under `media.create` by that club. Fixing it
   needs an object ownership check the Storage schema does not expose to a row
   constraint.
2. **Delete and re-upload at the same key.** The invalidation trigger keys on the
   media ROW's `storage_path` changing, so deleting the Storage object and
   re-uploading different bytes at the same key leaves the row, the snapshot and
   the share untouched, and the share then serves the new bytes. The in-place
   overwrite route is already closed (`0027` has no UPDATE policy, so the Storage
   API's upsert and move are refused for every caller), so this needs a delete
   followed by an upload, which only a member holding `media.create` in that club
   can do, against their own club's object. It is unchanged by 0042 rather than
   introduced by it. Closing it would mean content-addressing the object or
   recording an object version in the snapshot, which is a larger change than
   this boundary needs.

---

# Rights classification and the England Football lock (0043)

## 47. What this migration exists to prevent

Migration `0038` added the `rights` column, classified every existing row and
proved the invariant that no England Football derived row is publishable. It
proved that invariant once, at backfill time, and enforced it with nothing.
The source and rights columns are ordinary editable columns covered by the
same owner-or-manager UPDATE policy as everything else, so any member holding
the write arm could have set `rights = 'public_full'` on an FA imported row
through a hand written PostgREST call. The only reason it had not happened is
that no screen offered it, which is exactly what the rights classification UI
(PR 137) adds. That UI must therefore not deploy before this guard is live,
which is why `0043` lands and applies first, on its own.

## 48. Provenance is the source columns, never the rights value

Provenance is derived from `source_url`, `source_label` and (drills)
`source_key`:

| Provenance | Evidence | Consequence |
|---|---|---|
| England Football | an England Football Learning host, or the England Football Learning label | locked at club only, enforced by the database |
| third party | any other recorded source | classifiable; evidence, not proof of a restriction |
| none | no recorded source | classifiable; the same rule 0038's backfill used |

The database rule is `public.content_rights_fa_evidence(text, text, text)`,
called by the five triggers. The client and Edge Function mirrors of this rule
arrive with PR 137; the database is the boundary, and the mirrors are
deliberately no wider than the database will accept.

## 49. The write path is ordinary RLS

Classification is a plain `UPDATE` of the `rights` column on the row's own
table. The existing `*_update_owner_or_manager` policy is already exactly the
right authority: the owner holding the create capability, or a manager holding
the manage capability, in their own club. No service role path, no new
capability, no new policy and no new RPC. A parent, a non-owner and a member
of another club are refused by the policy that already exists, and the suite
proves each.

## 50. The England Football lock (migration 0043)

Five `BEFORE INSERT OR UPDATE` triggers, one per rights carrying table
(`drills`, `sessions`, `programmes`, `templates`, `media`), each a small
SECURITY INVOKER function reading its own columns and calling two shared
helpers: `content_rights_fa_evidence(url, key, label)` states what counts as
England Football provenance, and `content_rights_fa_assert(...)` states the
two refusals. Both refusals raise `42501`.

**Rule 1.** A row whose recorded source is England Football derived cannot be
raised above `internal_only`.

**Rule 2.** That recorded source cannot be removed.

Rule 2 is what makes rule 1 real. Without it a coach could clear the Source
link field in the edit form (one save, rights untouched, so rule 1 never
fires), reopen the form and classify the now source-free row as public (a
second save, no evidence left for rule 1 to see). Two ordinary saves, no hand
written call, and an England Football session is public. Rule 2 is also
correct on its own terms: the club's permission to use England Football
content is conditional on the source being recorded and displayed, so a write
that strips the attribution is one to refuse whatever it does to rights.
Swapping one England Football source for another stays allowed; only leaving
the England Football set is refused.

Both rules are data rules, not permissions: the owning coach, a manager, an
admin and the service role are refused equally, and the suite proves the
service role case explicitly. Lowering back to club only is always allowed,
an ordinary edit that leaves the level and the source alone is untouched, and
a row that tries to acquire an England Football source while already
classified as publishable is refused too.

### The host rule

`0038`'s `content_rights_is_fa_url` extracted the host with `[^/:?#]+`, which
stops at the first colon and treats userinfo as part of the host. The
TypeScript readers use the WHATWG URL parser. They disagreed, and the
disagreement ran the permissive way for the database:

| URL | 0038 SQL | JS | 0043 SQL |
|---|---|---|---|
| `https://x@learn.englandfootball.com/a` | not FA | FA | FA |
| `https://learn.englandfootball.com:8080@evil.test/` | FA | not FA | not FA |
| `https:\learn.englandfootball.com` | not FA | FA | FA |
| `'  https://learn.englandfootball.com/a'` | not FA | FA | FA |

`0043` replaces the body: it takes the whole authority, translates
backslashes, trims whitespace, drops userinfo at the last `@` and drops the
port. A read only check of the hosted data before writing the migration found
zero rows on any of the five tables carrying an `@`, a backslash or a port in
`source_url`, so no existing classification changes.

### Self verification

The migration proves, before it commits: no existing England Football derived
row is classified above club only; all five triggers are installed by name;
the two helpers and `content_rights_is_fa_url` are still executable by
`authenticated` (a SECURITY INVOKER trigger evaluates them as the writing
role, the lesson 0042 learned with the media path CHECK constraint); and the
corrected host rule matches the URL parser in both directions.

## 51. Non England Football third party content

A recorded non England Football source is evidence of third party origin, not
proof of a restriction: the club may well own or be cleared for it. The
database therefore does not lock it. The classification UI (PR 137) requires
an explicit confirmation before a public level is saved on such a row; that
is a client behaviour, not part of this boundary.

## 52. What 0043 does NOT do

- No row is reclassified, and no club is enabled.
- No policy, grant, capability or role changes.
- No change to `content_shares`, the lifecycle RPC, the read path, the secret
  model, token handling, expiry, the kill switch or the anonymous read
  posture.
- No sharing UI, and no share is created.

## 53. Rollout order

1. This migration merges and is applied to hosted Supabase, a separate human
   approved step.
2. After the hosted apply, the exact version the migration ledger records for
   `0043` is read back and reconciled into `EXPECTED_LAST_MIGRATION` in
   `.github/scripts/content-sharing-deploy/verify_no_residue.py` (and its
   test) in a separate small PR, before any Edge Function deployment.
3. Only then does PR 137 (the sharing UI and the Edge Function changes)
   merge and deploy.

Rollback is documented in the migration header: drop the five triggers and
their functions, drop the two helpers, and restore `content_rights_is_fa_url`
from its `0038` body. Rolling back restores the pre `0043` position, so it is
a break-glass step rather than a routine one.
