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
- `idempotency_key` plus its partial unique index makes a lost response retry
  resolve to the same row.
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
function. A trigger is used, not an explicit function call, because rights are
updated through the normal client UPDATE path (no Edge Function in the loop),
so the invalidation must ride the same transaction whatever writes the rights.
No stale share remains potentially usable by PR 2 later.

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
