# Policy test matrix

Executable verification of the database Row-Level Security and Storage
policies, against the local Supabase stack only. The suite asserts the
intended permission contract, not the current behaviour. The four Storage
failures this harness originally documented are fixed by
`0027_storage_boundary.sql` (see `docs/security/storage-boundary.md`), and
the board token finding is fixed by `0028_board_player_boundary.sql` (see
`docs/security/board-data-boundary.md`), so the suite is fully green with
no expected failures. Do not weaken an assertion to make the suite green;
a red test means a policy regressed.

## Exact local command

```bash
npx supabase start        # once; local Docker stack
npx supabase db reset     # applies migrations and seed.sql
npm run test:security
```

`npm test` never runs this suite; the main suite stays green and needs no
database. The security suite refuses to talk to anything but a local URL,
resolves the local keys at runtime from `npx supabase status` (no key is
committed), and creates its fixtures idempotently, so repeated runs against
the same stack are safe.

## Roles tested

Five synthetic users are created by the global setup (invented names, a
reserved test email domain, one throwaway local password, no real data):

| Fixture | Role | Club |
|---|---|---|
| admin | admin | seeded club (A) |
| manager | manager | A |
| coachOne | coach | A |
| coachTwo | coach (non-owner foil) | A |
| parent | parent | A |
| outsider | coach | fixture club B |

The `manager` fixture (0030) separates manager from coach for the capability
cells: it holds `audit.view` (and the players write, import and export keys),
the coach does not. The club B coach role is granted `audit.view` in the
global setup so the `outsider` fixture proves the audit read is club scoped
(it holds the capability in its own club yet reads zero rows of club A).

Users are created through the auth admin API so the hardened
`handle_new_user` trigger (`0029_signup_hardening`) builds each profile
quarantined exactly as production sign-up would, then granted their club,
role and display primary through `grant_club_membership`, the same
service role only function the invite-user Edge Function calls (the
trigger sets no club and no role; membership flows only through the
trusted grant). Club B exists so the club isolation contract is
executable while the real seed has one club. Every
test authenticates with a real JWT via the password grant and exercises
PostgREST or the Storage API, the same path production clients use; the
service role key is used only for fixture setup and out-of-band
verification, never as the subject of an assertion.

## Tables tested

`drills`, `media` (rows), `sessions`, `players`, `boards`, `feedback`,
`audit_events`, `import_batches`, `content_shares` /
`content_share_dependencies` (the private public share substrate), plus
`capabilities` / `role_capabilities` / `member_roles` for the capability
consistency checks, and `profiles` / `member_roles` / `member_teams` for the
signup membership boundary.

## Content share substrate

`tests/security/content-shares.test.ts` proves the Content Sharing PR 1
substrate from `0038_content_sharing.sql` (full design in
`docs/security/content-sharing-boundary.md`): `content_shares` and
`content_share_dependencies` carry no client policy and no client grant, so
anon, an authenticated coach and a manager (`shares.manage`) all fail to read
or write them directly; the lifecycle RPC `manage_content_share` is
service_role only, with the exact function signature grant proven and no
executable overload; and the RPC, as the final authority, refuses a forged
actor, a cross club source, a parent, and a coach acting on another coach's
source, while a manager may revoke any club share but never rotate or refresh
another creator's share. The suite also proves the kill switch (create,
refresh and rotate refused while off, revoke allowed, only an admin can flip
it), one active share per source, create idempotency, rotate replacing the
hash and invalidating the old secret, refresh keeping the secret while
rebuilding the dependency set, revoke clearing the snapshot and dependency
rows, a revoked share never reviving, a rights downgrade invalidating exactly
the dependent shares, and that the stored secret is only a SHA-256 hash with
no secret, hash or snapshot ever appearing in a lifecycle result or an audit
event. `capabilities.test.ts` pins the catalogue at twenty two keys and the
`shares.create` / `shares.manage` grants.

The same suite proves the Content Sharing PR 2 public read path from
`0039_public_share_read.sql` (design in the PR 2 part of
`docs/security/content-sharing-boundary.md`): the extended lifecycle RPC stores
a real versioned public snapshot (not the PR 1 placeholder) and
`read_public_share` is service_role only (anon and an authenticated coach cannot
execute it, the exact signature grant is proven), returns only the safe
projection with the private media fields and internal markers stripped and no
token hash, club id, source id or member id, and returns the identical neutral
`{status:'unavailable'}` for a wrong secret, an unknown id, a placeholder
snapshot, a revoked share, an expired share, a kill-switched club, a rotated old
secret, a missing or downgraded nested dependency, and a non-drill kind (drills
only render). It also proves the signed-media list names only eligible
`public_full` stored paths by ref, and that `content_share_expiry_cleanup` is
service_role only, clears a share expired beyond the retention window (nulling
the snapshot, removing the dependency rows and emitting exactly one
`content_share.expired` event) while sparing within-window and active shares.
The pure snapshot builder, allow-list scanner, sanitisers and secret/hash
helpers are proven by the Deno suite `supabase/functions/_shared/share_test.ts`,
and the public route, page and share-control views by the Vitest suites
`src/lib/publicShare.test.ts`, `src/components/PublicDrillView.test.tsx`,
`src/components/PublicShareControl.test.tsx` and `src/routes/PublicShare.test.tsx`.

## Signup membership boundary

`tests/security/signup.test.ts` proves the auth membership boundary from
`0029_signup_hardening` (full design in
`docs/security/auth-membership-boundary.md` and
`docs/adr/ADR-0003-invite-only-membership.md`): a direct `auth.signUp`
carrying `club_id`, `role` and `team_id` metadata is quarantined (no club,
parent role, no roles or teams) and reads nothing club scoped, holds zero
capabilities and passes no write policy; the trusted `grant_club_membership`
path provisions an invited coach and parent correctly, is idempotent,
refuses cross-club claims, wrong-club roles or teams, unknown members and
empty role sets, and is not executable by anon or authenticated callers;
duplicate invites and forged invite tokens fail closed; and the standing
fixtures keep their access. Disposable accounts use the reserved test
domain and are deleted in `afterAll`.

## Storage operations tested

On the private `media` bucket, under disposable per-run paths
`<club-uuid>/security-test/<unique-id>/…` (plus the fixture users' own
`avatars/<user-id>/` folders and the `<club-uuid>/crest/` folder, always
with run-unique names) only: list, read (download), create (upload),
replace (upload with upsert), delete, signed URL creation, and the
delete-then-recreate path that would bypass the closed update surface.

## Intended policy contract

Reads of club content are club-wide for every member; writes follow
capabilities; teams are never access control; `players` is the one
select-gated table.

| Surface | admin | coach | parent | other club |
|---|---|---|---|---|
| drills / media rows: read | yes | yes | yes | no |
| drills / media rows: create | yes | yes (`*.create`) | no | no |
| drills / media rows: edit or delete | any (`*.manage`) | own only | no | no |
| sessions: read | yes | yes | yes | no |
| sessions: create | yes (own) | yes (own, pinned to caller) | no | no |
| sessions: edit or delete | any (`sessions.manage`) | own only | no | no |
| players: read | yes | yes (`sessions.create`) | **no** | no |
| players: write | yes | yes | no | no |
| boards: read | yes | yes | yes, **and the row can never contain a name** | no |
| boards: create | yes | yes (`sessions.create`) | no | no |
| boards: edit or delete | any (`club.manage`) | own only | no | no |
| boards: persist a token label or stray field | **no (check constraint, all callers incl. service role)** | no | no | no |
| feedback: read | yes | yes | yes | no |
| feedback: file and edit or delete own | yes | yes | yes (the one deliberate parent write) | no |
| feedback: move status | yes (`club.manage`) | no | no | no |
| Storage media bucket: read | yes | yes | yes (club content, incl. signed URLs) | **no (club isolation)** |
| Storage media bucket: create | yes (`media.create`) | yes (`media.create`) | **no** | no (own club only) |
| Storage media bucket: delete | any (`media.manage`) | own uploads only | **no** | no |
| Storage media bucket: replace/upsert | **no — closed for everyone by design** | no | no | no |
| Storage crest folder (`{club_id}/crest/`): write | yes (`club.manage`) | no | no | no |
| Storage avatars (`avatars/{user_id}/`): write | own folder | own folder | own folder | own folder |
| Storage media bucket: anything unauthenticated | — | — | — | no |

Capability consistency contract: the database catalogue is exactly the
thirteen seeded keys; every capability string the frontend references
exists in the catalogue; `RESERVED_CAPABILITIES` (`users.manage`,
`club.manage`) map only to the admin system role and the database itself
(RLS plus the reserved trigger) refuses any attempt to widen that; the
`useMyCapabilities` read path (replayed query-for-query over real JWTs)
yields all thirteen for admin, the five `*.create` keys for coach, and the
empty set for parent.

## Remediated findings

The Storage policies from `0001_init.sql` distinguished only
unauthenticated from authenticated callers. The four Storage tests this
harness left genuinely red as evidence (parent create, parent delete of
another member's object, cross-club read, cross-club list) pass since
`0027_storage_boundary.sql`, which drops the three permissive policies and
scopes the bucket by club path, capability and uploader; the full design,
residual risks, apply and rollback procedures are in
`docs/security/storage-boundary.md`. The suite now also pins the closed
update surface directly: upsert-replace is refused for everyone, uploader
and `media.manage` holders included, and the parent delete-then-recreate
route around it is refused half by half.

The board token finding (finding 3, the last one open) is remediated by
`0028_board_player_boundary.sql`: board tokens persist player references
and numbers, never names, and a check constraint refuses any write that
tries to bring a label back, from any caller including the service role.
The former `it.fails` expected failure in `boards.test.ts` is now a plain
passing assertion and a permanent regression guard, alongside new tests
covering coach name resolution, rename and delete behaviour, manual token
survival, the constraint, and the exact backfill semantics of the
migration (through the preserved `board_tokens_without_names` function,
whose EXECUTE is service_role only; the suite also asserts coach and
parent RPC calls to it are refused).
The full design is in `docs/security/board-data-boundary.md` and
`docs/adr/ADR-0002-board-player-model.md`.

### audit_events (0030_audit_foundation)

The append only audit substrate (`tests/security/audit.test.ts`). Contract:
reads require `club_id = my_club()` and `has_perm('audit.view')`, so admin and
manager read the club's events, coach and parent read zero, and an outsider
holding `audit.view` in club B still reads zero rows of club A (the club arm,
not the capability, isolates). The table is append only for every client role:
`authenticated` holds `SELECT` only, so insert, update and delete are refused
at the grant with `42501` (a deliberate deviation from the RLS zero-rows
convention, because there is no write grant to filter under), and there are no
write policies; `anon` holds nothing. The private writer `log_audit_event` is
service_role only (`EXECUTE` revoked from anon and authenticated, the 0028
precedent), derives actor, actor name, club and timestamp server side, and
validates action, entity type, source and metadata against explicit allow
lists; a name shaped value cannot enter `safe_changes` (a check constraint
allow list) or `metadata` (the writer's allow list). The same transaction
guarantee is proven by a rolled back writer call leaving no row. No player or
season trigger exists yet (they attach in PR 2), so every event in the file is
a synthetic service role or writer fixture. Full design:
`docs/security/app-audit-boundary.md` and `docs/adr/ADR-0006-app-audit-events.md`.

### import_batches and import_players (0035_import_players)

The transactional spreadsheet import commit (`tests/security/import.test.ts`).
Contract: `import_players(p_batch_id, p_season_id, p_rows)` is SECURITY DEFINER,
self gates on `has_perm('players.import')` (a coach and a parent are refused
`42501`, no batch recorded), derives club and actor server side, validates the
season belongs to the caller's club and is non archived (a cross club season is
`42501` and an archived season is refused, neither recording a batch), and re
validates every proposed row unbound by the preview (status vocabulary and
transition against the stored status, shirt bounds, date validity, team club
membership, and existing player id club ownership; a cross club player id or an
unknown team aborts the whole batch). The commit is all or nothing: one bad row
rolls back every business and per row audit write, records the batch `failed`
with a safe row numbered reason and exactly one `players.import_failed` event,
and a replay returns the stored failure. A success records the batch
`succeeded`, the server derived counts, one `players.import_completed` summary
(source `csv_import` or `xlsx_import`, entity id the batch id) and the per row
trigger events, all sharing the batch id via the `otj.audit_batch` GUC. The
client minted batch id is the idempotency key: a repeated confirm returns the
stored result and applies nothing, and a batch id recorded for another club is
refused, never replayed. `import_batches` reads require `club_id = my_club()`
and `has_perm('audit.view')` (a coach and a parent read zero rows), and the
table is written only from inside the RPC (no client insert, update or delete
grant or policy); it carries counts, format and state only, never a file
fingerprint, a filename, row content or a child name. Full design:
`docs/adr/ADR-0007-player-import-export-architecture.md` and
`docs/security/registered-players-boundary.md` section 4.

## CI

Wired into CI (`.github/workflows/ci.yml`, the `security` job): it runs
`npx supabase start`, `npx supabase db reset`, then `npm run test:security`
against a LOCAL stack only, and a failure fails CI. The stack uses the CLI's
built in local demo keys, so no service-role or hosted-project credential is
needed or exposed; `assertLocal` still refuses any non-local URL. `npm test`
stays independent and needs no database. The job may remain out of the
required checks (a branch-protection decision, not a workflow setting) until
the Docker image pulls and health checks have proven reliable in Actions.

## Limitations

- Local stack only. Nothing here touches the hosted project, and the
  hosted project's live grants and policies are not probed; the suite
  assumes the migrations on disk describe production.
- `tests/security/local-grants.sql` reproduces the legacy Data API grants
  on the local database (the hosted project predates Supabase's revoked
  auto-grants; a fresh local stack does not), so the suite exercises RLS
  the way production does, and then restates the deliberate revokes that
  migrations carve out of those legacy grants (currently the 0028
  service_role-only backfill transform) so the blanket grant cannot
  resurrect them locally. It is applied by the test setup through the
  local Docker container only and must never be applied to a hosted
  project.
- The frontend capability scan is a static string scan; a capability name
  built dynamically at runtime would escape it.
- `useMyCapabilities` is verified through its exact query shape replayed
  over real JWTs, not by executing the React hook.
- Edge Functions (invite-user, fa-import, spond-sync and the rest) are out
  of scope; the local stack runs without the edge runtime here.
- Realtime authorisation (live session watching) is not covered.
- The storage list assertions accept either an error or an empty result,
  because the Storage API reports an RLS-filtered list as empty rather
  than as a refusal.
