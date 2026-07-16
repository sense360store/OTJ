# Foundation security programme: retrospective

The Foundation programme ran 14 to 15 July 2026 and closed with four merged
pull requests: #97 (executable security harness), #98 (Storage authorisation
boundary), #99 (board and player name safeguarding boundary) and #100
(invite-only auth membership boundary). This document records what was found,
what changed, what was verified in production, and what remains open. It is a
record, not a plan; the forward plan lives in
`product-excellence-roadmap.md` alongside it.

Companion documents written during the programme, which carry the full
technical detail:

- `docs/security/policy-test-matrix.md` (the permission contract and how to run the suite)
- `docs/security/storage-boundary.md` (the media bucket design)
- `docs/security/board-data-boundary.md` (the board token model)
- `docs/security/auth-membership-boundary.md` (the signup and provisioning boundary)
- `docs/adr/ADR-0002-board-player-model.md` and `docs/adr/ADR-0003-invite-only-membership.md`

## Original risks discovered

Three confirmed defects, all present since early migrations. Their
preconditions differed and are worth distinguishing: the Storage defect was
reachable by any authenticated account of any club; the board leakage
occurred when a roster seeded board persisted names into a saved row; and
the signup defect was exploitable by an outsider only if public email
signup was enabled on the hosted project.

1. **Storage was authenticated-only, not authorised.** The three `media`
   bucket policies from `0001_init.sql` distinguished only unauthenticated
   from authenticated callers. Any signed in user of any club could read,
   list, create and delete every object in the bucket, including other
   members' uploads, other clubs' content had a second club ever existed,
   and every avatar. Parents, a read-only role in the database tables, held
   full write and delete on the object store behind those tables.

2. **Board tokens leaked children's names past the roster gate.** The
   `players` table is the only table naming children and its select is
   RLS gated to `sessions.create` holders, so parents can never read it.
   Roster seeding broke that boundary by copying each child's
   `display_name` into `boards.tokens[].label`, and saved boards are club
   readable by design. The parent UI masked the labels with a `numberOnly`
   prop, but that was presentation only: the database returned whatever the
   `tokens` jsonb held to every club member, parents included. A confirmed
   safeguarding defect in the code path and a data minimisation failure,
   proven by a failing test; the later production preflight showed the
   leak had not materialised in stored data (see the findings section
   below).

3. **Client controlled metadata granted club membership.** The
   `handle_new_user` trigger from `0001_init.sql` copied `club_id` and
   `role` straight out of `auth.users.raw_user_meta_data`, which is set by
   the `data` option of `auth.signUp` (callable by anyone holding the anon
   key, which ships in the browser bundle) and rewritable later through
   `auth.updateUser`. If public email signup was enabled on the hosted
   project, a stranger could create an account carrying the club's UUID and
   `role: 'admin'` and receive a profile inside the club: every club wide
   read (drills, media rows and Storage objects, templates, programmes,
   sessions, boards, feedback, Spond counts, teams, every profile), the
   feedback insert, and the admin display role. No content write capability
   followed, because writes flow from `member_roles`, which stayed empty,
   but the read compromise alone was a confirmed defect.

The first PR's harness documented these as failing tests before any fix
existed: four red Storage assertions and one `it.fails` board assertion were
committed as executable evidence, with the explicit rule that a red test
means a policy regressed and must never be weakened to go green.

## What the four PRs changed

### PR #97: executable security harness

Fifteen files, roughly 1,800 lines, no policy or production change. It added
`npm run test:security`, a separate Vitest suite (`vitest.security.config.ts`,
`tests/security/`) that:

- signs five synthetic users in with real JWTs via the password grant
  (admin, two coaches, a parent, and an outsider in a second club) and
  drives PostgREST and the Storage API exactly as production clients do;
- uses the service role only for fixture setup and out of band verification,
  never as the subject of an assertion;
- refuses to talk to anything but a local URL (`assertLocal()` accepts only
  localhost addresses) and resolves keys at runtime from
  `npx supabase status`, so no key is committed and the suite cannot touch
  the hosted project;
- reproduces the legacy Data API blanket grants on the local container only
  (`tests/security/local-grants.sql`), so RLS is exercised the way the
  hosted project actually runs;
- asserts the intended permission contract, not current behaviour, which is
  why it shipped with documented failures.

`docs/security/policy-test-matrix.md` records the contract, the roles and
the exact local command. `npm test` never runs this suite; the main suite
stays green with no database.

### PR #98: Storage authorisation boundary

Migration `0027_storage_boundary.sql` drops the three permissive policies by
name and replaces them with eight class based policies over three path
shapes: club content (`{club_id}/…`), club crest (`{club_id}/crest/…`) and
avatars (`avatars/{user_id}/…`). Reads are scoped to the caller's club.
Writes require the matching capability (`media.create`, `club.manage`) or
ownership, where ownership is `storage.objects.owner_id`, set by the Storage
service from the JWT and not client controllable. There is deliberately no
UPDATE policy for anyone, so replacement through UPDATE or upsert is
refused for every caller. This does not make paths immutable: an authorised
owner or manager can still delete an object and recreate one at the same
path, after which an existing signed URL for that path serves the new
bytes. That delete and recreate route is recorded as an accepted
limitation, not a prevented one (see the accepted risks). The same PR
moved crest uploads from the unscoped `club/…` prefix to
`{club_id}/crest/…`. The four red harness tests now pass and the Storage
suite grew to 27 tests.

### PR #99: board and player name safeguarding boundary

Migration `0028_board_player_boundary.sql` makes the board data boundary
schema enforced. A persisted token now carries at most six fields (`id`,
`number`, `side`, `x`, `y`, `playerId`); the check constraint
`boards_tokens_minimal_shape` refuses anything else, labels included, for
every caller including the service role. Names are never stored on boards:
`playerId` references the roster without a foreign key, and names resolve at
render time through the `sessions.create` gated players select, so RLS
answers the question per caller. The migration backfills existing rows by
linking a label to a player only on an exact unique match and then removing
every label, matched or not; a verification block aborts the migration if
any row would still fail the shape test. The backfill helper
`board_tokens_without_names` is revoked from everything but the service
role. Review hardened the rollout: the new frontend must deploy before the
constraint applies (the old client wrote a `label` key on every token, so
the reverse order would refuse every board save), a counts only preflight
that never outputs a name is required, and a confirmed backup or PITR window
is required because stripping labels is deliberately not reversible.
ADR-0002 records the rejected alternatives.

### PR #100: invite-only auth membership boundary

Migration `0029_signup_hardening.sql` removes all trust in client metadata.
`handle_new_user` now quarantines every new auth user: `club_id` null, role
`parent`, no role or team rows, only the display name copied. A quarantined
profile passes no club scoped policy and cannot read anything, including its
own profile row. The single trusted provisioning path is
`grant_club_membership()`: `SECURITY DEFINER` with an empty `search_path`,
callable by the service role only (enforced both by an in body guard and by
revoked grants), fail closed on every argument (unknown member, cross club
claim, wrong club roles or teams, empty role set), a no-op only when the
requested state exactly matches the existing one so a second grant can never
accumulate privileges, and a derived display role so the caller cannot state
a disagreeing one. Review also found and fixed a race: the function now
locks the profile row with `SELECT … FOR UPDATE`, and a regression test
fires two concurrent grants and asserts exactly one provisions. The
`invite-user` Edge Function was reworked to authenticate the caller, require
`users.manage`, validate every role and team against the caller's own club
rather than the payload, invite with only the display name in metadata, then
provision through the function, deleting the just created auth user if the
grant fails so no half provisioned account remains. The login screen's magic
link now sets `shouldCreateUser: false`, so no app auth flow can register a
user. ADR-0003 records the decision.

## Production verification completed

The programme's rule was that nothing merges on trust: claims about the
hosted project were checked read only where the tooling allowed, anything
unreadable was recorded as pending rather than asserted, and every applied
change was verified after apply.

- **Hosted bucket inspection (before the Storage design was chosen).** Every
  object in the hosted `media` bucket was enumerated read only: 108 club
  prefixed objects (102 referenced by media rows, 6 orphans), 2 avatar
  objects matching their owners, and zero objects under the legacy `club/`
  crest prefix. That inspection is what justified shipping no legacy
  compatibility arm in the policies.
- **Hosted Auth configuration inspection was attempted but blocked.** The
  connector approval needed to read the hosted Auth settings was not
  granted during PR #100, so none of the settings could be read. All five
  hosted configuration checks (public email signup, anonymous sign-in,
  leaked-password protection, the redirect allow-list, and the official
  security advisors) therefore remain pending dashboard confirmation, as
  listed under the operational follow-ups. Nothing was changed and nothing
  about these settings was asserted.
- **Hosted auth boundary behaviour verified.** Separate from the unread
  settings, the boundary itself was verified against the hosted project:
  a direct signup lands quarantined (null club, parent role, no reads),
  a real invitation provisions correctly through `grant_club_membership`,
  the deployed function definitions and their ACLs were read back and
  checked against the migration, and database level advisor equivalent
  SQL checks ran clean.
- **Board data preflight.** The counts only preflight (total boards, boards
  with labels, uniquely matched, ambiguous, unmatched) ran against
  production data without outputting a single name or label value. It
  found one board in total, holding an empty tokens array: zero boards
  with labels, and zero rows for the backfill to change. Migration 0028
  accordingly changed no rows on apply, and its verification block
  re-checked the shape of every row at apply time.
- **Migrations applied and confirmed in the live ledger.** The hosted
  migration ledger now records all three remediation migrations:
  `storage_boundary` applied 14 July 2026, `board_player_boundary` and
  `signup_hardening` applied 15 July 2026 (ledger re-checked read only on
  16 July 2026). The PRs themselves merged the migrations gated, with the
  apply performed as its own verified step per the rollout procedure in each
  companion document.
- **Reworked invite function deployed.** The hosted `invite-user` function
  is at version 14, deployed 15 July 2026, after `signup_hardening` was
  applied, matching the documented order (pause invitations, apply 0029,
  deploy the function, verify a real invite, resume).
- **Suite runs recorded per commit.** Each remediation commit records the
  full suite state it left behind, ending at 107 security tests and 303 unit
  tests passing, with the concurrency test run repeatedly.

## Architectural decisions made

1. **The permission contract is executable.** The security suite asserts
   intent, not behaviour; a red test is a regression, and assertions are
   never weakened to pass. Findings enter the repo as failing tests before
   fixes.
2. **Authorisation is class based on Storage paths.** Three path shapes
   (club content, crest, avatars) with capability and ownership arms, and
   no UPDATE policy for anyone, so in place replacement through UPDATE or
   upsert is refused. Delete and recreate at the same path remains open to
   authorised callers and is the accepted limitation.
3. **Boards persist references, never names.** Child names live in exactly
   one table, gated by RLS; every other surface resolves them at render
   time with the caller's own authority. The shape is enforced below RLS by
   a check constraint that binds even the service role.
4. **Client metadata grants nothing; membership is provisioned.** New auth
   users are quarantined by default, and the only path into a club is a
   service role only, fail closed, race safe function that provisions
   wholesale and never accumulates.
5. **Migrations ship gated with operational procedure attached.** Each
   remediation migration merged unapplied, carrying a mandatory apply
   order, preflight, rollback and post apply verification in a companion
   document, and was applied as a separate verified step.
6. **Decisions are recorded as ADRs** (ADR-0002, ADR-0003) with the
   rejected alternatives, so the boundaries survive future contributors.

## Test coverage now available

- **107 security tests** across nine files, runnable on demand with
  `npm run test:security` against the local Docker stack only: signup and
  provisioning (17), Storage (27), boards (15), drills (10), feedback (9),
  capabilities (8), media rows (7), players (7), sessions (7).
- The suite covers: cross club isolation, parent read-only enforcement per
  table, owner versus manager write arms, the Storage path classes and the
  absence of UPDATE, the board token shape constraint and the RPC lockdown,
  quarantine on direct signup, metadata being ignored, cross club and wrong
  club provisioning refusals, privilege accumulation refusal, the
  provisioning race, and the capability catalogue contract (the thirteen
  seeded keys, the reserved admin only keys, and the exact capability sets
  per role).
- **303 unit tests** in the main suite, which needs no database and is
  unaffected.
- The security suite is intentionally not able to run against the hosted
  project; hosted verification is a documented manual procedure per
  boundary.

## Incidents avoided and production data findings

- **The board name leak was confirmed in code and tests but had not
  materialised in stored production data.** The leaking path (roster
  seeding copying names into club readable token labels) was real and
  proven by the harness, but the verified production preflight found one
  board in total with an empty tokens array, zero boards with labels, and
  zero rows changed by migration 0028. No child's name was ever stored in
  a production board row. The constraint now makes the recurrence
  impossible rather than merely unexercised; the parent smoke test below
  remains open as belt and braces once the first parent account exists.
- **The Storage bucket held 108 objects writable and deletable by any
  authenticated user.** Six were orphans unreferenced by any media row, and
  three admin replaced objects carry an `owner_id` that is not their media
  row's creator. No unauthorised access was observed; the point of the
  finding is that nothing would have distinguished authorised from
  unauthorised access under the old policies.
- **The signup path would have handed a stranger full club read** had
  public email signup been enabled at the hosted project. Whether it was
  enabled is one of the open configuration confirmations below; the code
  boundary now holds regardless of that setting, which is the reason the
  fix removed the metadata trust rather than relying on the toggle.

## Remaining accepted risks

Accepted knowingly, with rationale, and recorded in the boundary documents:

- **Three owner mismatched objects.** Admin replaced objects whose
  `owner_id` is the admin, not the original uploader. The uploader loses
  the owner delete arm on those objects; `media.manage` still covers them.
  Accepted as harmless history.
- **Six orphaned Storage objects.** Club readable, referenced by nothing.
  Cleanup is optional housekeeping, not a security task.
- **Delete and recreate at the same path.** An authorised owner or manager
  can delete an object and upload different bytes under the same path,
  after which an existing signed URL for that path serves the new bytes.
  The missing UPDATE policy blocks only in place replacement through
  UPDATE and upsert; nothing enforces that recreation use a fresh path.
  This is the precise accepted limitation, and it grants an owner no more
  power than editing their own media row.
- **Avatar folders as personal storage.** A user can put arbitrary files
  under their own `avatars/{user_id}/` prefix; content type and size are
  enforced client side only. Bounded blast radius (own folder, same club
  visibility), accepted for now.
- **No size or content type enforcement in Storage policy.** Deliberate
  scope cut; client side checks remain the only guard.
- **`boards.tokens[].playerId` has no foreign key.** By design, so deleting
  a player never breaks a saved board; a dangling reference renders as a
  numbered disc. Accepted.
- **The security suite does not run in CI.** It needs a local Supabase
  stack (Docker) and is unverified under GitHub Actions. Until wired in,
  the suite only protects contributors who run it. Listed as a follow-up
  below.

## Operational follow-ups still open

These are hosted configuration checks and one live verification. They are
deliberately listed apart from the sections above: none of them is an
unresolved code vulnerability. Every code boundary described in this
document is merged, applied to the hosted project and covered by tests
regardless of how these checks come out; they are defence in depth and
routine hygiene on the Supabase project settings.

1. **Confirm the hosted public email signup setting and disable it.** The
   quarantine makes a self signed account inert, but public signup off
   removes the noise of stranger accounts entirely. Recorded as pending
   confirmation in `docs/security/auth-membership-boundary.md`.
2. **Confirm anonymous sign-in is disabled.** Not readable during the
   programme; confirm in the hosted Auth settings.
3. **Enable leaked-password protection** in hosted Auth so known
   compromised passwords are rejected at signup and password change.
4. **Confirm the Auth redirect allow-list** contains only the production
   and preview origins the app actually uses.
5. **Run the official Supabase security advisors** against the hosted
   project and review the report, now that the three remediation
   migrations are applied. Database level SQL checks equivalent to the
   advisors ran clean during the programme; the official dashboard run is
   what remains.
6. **Perform a live parent board-view smoke test when the first parent
   account is invited**: sign in as the parent, open a board seeded from a
   roster, and confirm the client receives shape and numbers only. The
   suite already proves this against the local stack; this is the one
   assertion worth repeating against production with a real account.

One engineering follow-up sits alongside these: **wire the security suite
into CI** so the 107 assertions run on every pull request rather than on
demand. It needs the local Supabase stack booted inside the workflow and is
tracked as ordinary build work, not as a security gap in the product.
