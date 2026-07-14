# Policy test matrix

Executable verification of the database Row-Level Security and Storage
policies, against the local Supabase stack only. The suite asserts the
intended permission contract, not the current behaviour. The four Storage
failures this harness originally documented are fixed by
`0027_storage_boundary.sql` (see `docs/security/storage-boundary.md`), so
the suite is green today except for one expected failure (the board token
finding, still open). Do not weaken an assertion to make the suite green;
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
| coachOne | coach | A |
| coachTwo | coach (non-owner foil) | A |
| parent | parent | A |
| outsider | coach | fixture club B |

Users are created through the auth admin API so the `handle_new_user`
trigger builds their profiles exactly as production sign-up would, then
given the `member_roles` row the invite-user function would create (the
trigger alone sets only the display role; capabilities flow from
`member_roles` since `0015_rbac_roles`). Club B exists so the club
isolation contract is executable while the real seed has one club. Every
test authenticates with a real JWT via the password grant and exercises
PostgREST or the Storage API, the same path production clients use; the
service role key is used only for fixture setup and out-of-band
verification, never as the subject of an assertion.

## Tables tested

`drills`, `media` (rows), `sessions`, `players`, `boards`, `feedback`,
plus `capabilities` / `role_capabilities` / `member_roles` for the
capability consistency checks.

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
| boards: read | yes | yes | yes, **but never roster-derived names** | no |
| boards: create | yes | yes (`sessions.create`) | no | no |
| boards: edit or delete | any (`club.manage`) | own only | no | no |
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

## Remediated findings and the one still open

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

Still open, by design:

| Test | Why it fails today | Finding |
|---|---|---|
| `boards.test.ts` — parent must not receive roster-derived token labels (marked `it.fails`) | board tokens snapshot roster names into a club-readable row while `players` itself is parent-blocked | 3 |

The boards test is declared with `it.fails`, so the runner reports it as
an expected failure rather than red; when its remediation lands, remove
`.fails` so it becomes a permanent regression guard. It is deliberately
out of scope for the Storage remediation.

## CI

Not wired into CI yet. With the Storage remediation landed the suite is
green (one expected fail), so the original blocker is gone; what remains
is that it needs `supabase start` (Docker image pulls), which is slow and
unverified in this repo's Actions setup. Follow-up requirement: add a
workflow job that runs `npx supabase start`, `npx supabase db reset`, then
`npm run test:security`, and gate merges on it; keep it out of the
required checks until it has proven reliable (image caching, health-check
timeouts).

## Limitations

- Local stack only. Nothing here touches the hosted project, and the
  hosted project's live grants and policies are not probed; the suite
  assumes the migrations on disk describe production.
- `tests/security/local-grants.sql` reproduces the legacy Data API grants
  on the local database (the hosted project predates Supabase's revoked
  auto-grants; a fresh local stack does not), so the suite exercises RLS
  the way production does. It is applied by the test setup through the
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
