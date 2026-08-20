# Deploying the Content Sharing Edge Functions

This document describes the gated, manual deployment of the two Content Sharing
Edge Functions to the hosted Supabase project. It covers only the deployment of
`manage-content-share` and `read-content-share`. It does not enable public
sharing, change any hosted setting, apply any migration, or create any share.

The deployment runs through a GitHub Actions workflow rather than an ad hoc CLI
session so the process is reviewable, gated behind an environment approval, and
consistent with the repository's deploy discipline (deploy from files on disk,
never from inline pasted source).

Workflow file: `.github/workflows/deploy-content-sharing-functions.yml`
Helper scripts: `.github/scripts/content-sharing-deploy/`

## What it deploys

| Function | verify_jwt | Role |
|---|---|---|
| `manage-content-share` | `true` | Authenticated management (preview, create, refresh, rotate, revoke, status). |
| `read-content-share` | `false` | The only anonymous function: resolves an opaque public drill, session or programme share to its stored, sanitised snapshot. |

The eight pre-existing functions are untouched and stay `verify_jwt = true`.
After a run the project has exactly ten functions, and `read-content-share` is
the only one reachable without a JWT.

The JWT posture is declared explicitly in `supabase/config.toml`:

```
[functions.manage-content-share]
verify_jwt = true

[functions.read-content-share]
verify_jwt = false
```

`manage-content-share` relies on the config's explicit `true` (no
`--no-verify-jwt` flag is passed). `read-content-share` is deployed with an
explicit `--no-verify-jwt` in addition to the config declaration.

## Required GitHub configuration

- **Environment:** `production`. Configure a required reviewer on this
  environment so the deploy waits for a human approval before it runs.
- **Secrets** (on the `production` environment):
  - `SUPABASE_ACCESS_TOKEN` — a Supabase access token for an account that can
    deploy functions to the target project through the CLI (project list,
    function deploy, function list). It is used for the CLI operations only and
    is never used for the Management API database query endpoints. Never
    printed, echoed, logged or committed.
  - `SUPABASE_DB_URL` — the full PostgreSQL connection string, used only by the
    post-deploy no-residue verifier to connect to the database directly with
    `psql`. It is exposed only to that one step, never placed in the job-wide
    env, and never printed. The verifier never falls back to
    `SUPABASE_ACCESS_TOKEN` or to any Supabase API token. See
    "The `SUPABASE_DB_URL` secret" below for where it comes from and how to
    handle it. `SUPABASE_DATABASE_READ_TOKEN` is no longer used and can be
    removed from the environment once this workflow has run successfully.
  - `SUPABASE_PROJECT_ID` — the target project ref. Expected value:
    `uynorsnrvocksgqweucu`.

A project ref is not a credential; it appears in every function URL. The
workflow hardcodes the intended ref (`uynorsnrvocksgqweucu`) so a valid token
pointed at a different project cannot deploy here.

### Access token type and scopes

Use a classic Supabase personal access token, created from the account's
dashboard token page. Classic personal access tokens do not expose selectable
scopes in the dashboard: there is no `edge_functions_read` or
`edge_functions_write` checkbox to choose, so do not go looking for one and do
not treat its absence as a misconfiguration. The token authenticates the CLI
for everything this workflow needs: listing projects, deploying the two
functions, and listing functions.

The dashboard also offers an experimental API-token option. It is not required
for this deploy; the classic token is sufficient. Do not switch to it to work
around a verification error.

One consequence of the classic token's coarse authorization: the broad
Management API endpoint `GET /v1/projects/{ref}/functions`, called directly
with `Authorization: Bearer <token>`, can return HTTP 403 (forbidden) even
though the same token lists and deploys functions through the CLI. For that
reason the inventory verification reads the function list from the authenticated
CLI (`supabase functions list --output json`), not from a direct call to that
endpoint. A 403 from the direct endpoint does not by itself mean the deploy
failed.

### The `SUPABASE_DB_URL` secret

The no-residue verifier connects to Postgres directly rather than through the
Supabase Management API, so it needs a full connection string.

- Supabase exposes a secret named `SUPABASE_DB_URL` to Edge Functions at
  runtime, but that value is internal to the Edge Function runtime and is not
  automatically available to GitHub Actions. GitHub Actions reads only its own
  secrets.
- Therefore GitHub has its own `SUPABASE_DB_URL` production environment secret,
  set independently of the Edge Function runtime.
- Copy its value from the Supabase dashboard: Project -> Connect -> Direct ->
  Session pooler. It is the session pooler connection string and it embeds the
  project database password.
- It must never be pasted into logs, pull requests, issues or chat. The verifier
  and workflow only ever assert its presence and redact it from any error
  output; treat it with the same care as the database password itself.

Using the classic access token against the Management API database query
endpoints is what previously returned HTTP 403 (`database query API returned
HTTP 403`), the failure this change fixes. The direct Postgres connection
avoids that endpoint entirely. Once this workflow has run successfully,
`SUPABASE_DATABASE_READ_TOKEN` is no longer needed.

## Approval gate

The job declares `environment: production`. GitHub holds the run at "Waiting"
until a configured reviewer approves it. The workflow is `workflow_dispatch`
only; it never runs on push or pull request. A `concurrency` group prevents two
production content-sharing deployments from overlapping.

## Manual procedure

1. Merge this operations change to `main` (the workflow, the config change, the
   scripts and this document) after review.
2. In GitHub, open Actions and select "Deploy content-sharing Edge Functions".
3. Choose "Run workflow" from `main`.
4. For `confirm_project`, type the target project ref exactly:
   `uynorsnrvocksgqweucu`. The job stops unless this equals the configured
   `SUPABASE_PROJECT_ID` and that equals the intended ref.
5. Optionally set `app_origin` to the approved application origin to enable the
   positive CORS assertion in the smoke tests. Leave it blank to skip that one
   assertion; the negative CORS check always runs.
6. Approve the run when prompted (production environment gate).
7. Read the job summary for the source hashes, deployed inventory, readback
   level and the post-deploy residue check.

## How authentication is validated

Before any deploy, the workflow:

- asserts the token and project variables are non-empty (prints only "token
  variable present");
- runs `supabase --version` and asserts the pinned CLI version;
- runs `supabase projects list --output json` into a temporary file, parses it
  with Python, confirms the intended project ref is visible to the token, and
  deletes the file. The token is never printed and the raw list is never dumped
  to the log.

Inventory verification later in the run follows the same pattern: it captures
`supabase functions list --project-ref "$SUPABASE_PROJECT_ID" --output json`
to a temporary file, parses it with
`.github/scripts/content-sharing-deploy/verify_inventory.py`, and deletes the
file. The CLI output is the authoritative inventory source; the direct
Management API functions endpoint is a fallback only (see Access token type and
scopes above).

The workflow never uses `env`, `printenv`, `echo "$SUPABASE_ACCESS_TOKEN"`,
`set` or `set -x`. Every script uses `set -euo pipefail`.

## Deployment commands

From the checked-out repository, with the CLI reading `SUPABASE_ACCESS_TOKEN`
from the environment:

```
supabase functions deploy manage-content-share --project-ref "$SUPABASE_PROJECT_ID"
supabase functions deploy read-content-share  --project-ref "$SUPABASE_PROJECT_ID" --no-verify-jwt
```

Each command packages the function directory and the shared modules its import
graph references:

- `manage-content-share`: `index.ts`, `../_shared/fa.ts`, `../_shared/share.ts`.
- `read-content-share`: `index.ts`, `../_shared/share.ts`.

No source is reconstructed, concatenated or inlined.

## How to inspect deployment results

The job summary records:

- the deployed commit SHA and the source SHA-256 hashes;
- the full function inventory with `verify_jwt`, version and `updated_at`, and
  the eszip bundle fingerprint for the two sharing functions, read from the
  authenticated CLI. When the CLI list carries `verify_jwt`, the JWT posture is
  verified from that metadata; if a CLI build omits it, the inventory is still
  verified and the anonymous-versus-authenticated boundary is confirmed by the
  endpoint smoke tests instead, which the summary states plainly;
- the deployed-source readback level (see below);
- the PRE-deploy ledger and inert-state gate (see below), which runs while both
  functions are still untouched;
- the post-deploy residue check (the same assertions again, proving the deploy
  itself left no residue).

### The ledger and inert-state gate, run twice

`verify_no_residue.py` runs at two points in the workflow, with **identical**
assertions and only the wording differing:

| Phase | Step | Purpose |
|---|---|---|
| `--phase pre` | before either function is deployed | stops the run against a schema this commit was not reviewed against, or a hosted project that is no longer inert, while nothing has been changed |
| `--phase post` | after the deploy | proves the deploy itself left no residue |

Both assert: the set of clubs with `public_sharing_enabled` true is **exactly**
the reviewed allowlist `EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS`;
`content_shares` and
`content_share_dependencies` are empty; there is no `content_share` audit event;
every drill and every media row is `internal_only`; there is no `content_share`
pg_cron job; and the migration ledger's newest version is **exactly**
`EXPECTED_LAST_MIGRATION`.

The ledger assertion is an exact equality and must stay one. It is never
relaxed to a `>=`, a prefix match or an "exists somewhere" check, because the
point is to prove the hosted schema is precisely the reviewed one. A test pins
this (`test_expected_last_migration_is_an_exact_equality`).

### Reconciling EXPECTED_LAST_MIGRATION after applying a migration

The hosted ledger version is stamped **by the apply** (the connector uses the
server clock), so it cannot be predicted before the apply happens. The order is
always:

1. apply the reviewed migration, after its own approval, through the gated
   production migration workflow
   (`docs/operations/production-migration-apply.md`). Migrations before 0046
   were applied by hand through the connector; the order below is the same
   either way;
2. read back the recorded version and name immediately:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 1;`
   The workflow's post-apply gate does this itself and prints the version in
   the job summary;
3. confirm it appears **exactly once** and is the newest row;
4. open a small reconciliation pull request setting `EXPECTED_LAST_MIGRATION` to
   exactly that value, updating its tests, fixtures and this document. Never
   push it straight to `main`;
5. merge it after CI;
6. only then run this deploy workflow.

Because the pre-deploy gate asserts the same constant, running the deploy before
step 5 fails closed with nothing deployed. That is intended: it is far safer
than a loose check that passes regardless.

Current value: `20260817104226` (`0049_spond_team_reconcile`, applied
2026-08-17 under its own production approval).

Hosted ledger newest migration: **`20260817104226` / `spond_team_reconcile`**.
That value was read back from `supabase_migrations.schema_migrations` after the
apply, not predicted before it, and was confirmed to be the unique newest row:
it appears exactly once and no row is newer.

0049 was applied by the gated production migration workflow, so its ledger row
carries that workflow's evidence, all of it confirmed independently before this
constant moved:

Each fact names what established it, because the mechanisms do not cover the
same ground and an auditor who assumes they do will trust more than was checked.

**Asserted by the post-apply gate (`verify_hosted_state.assert_post`), and read
back again for this reconciliation:**

- the row is the unique newest one, recorded at the newest version;
- the **version** of the row before it is `20260812102912`. Only the version:
  `assert_post` compares `second_version` against `expected_previous_version`
  and never compares `second_name`, which it reads but uses only in the failure
  message and the report table;
- `statements` holds exactly one entry whose MD5 is
  `d9d2199dcaabbc2da9248489754dc28a`, the reviewed file with its trailing
  newline stripped;
- and, through the three registered object probes in `reviewed_migrations.py`,
  that `public.spond_reconcile_player_team` resolves at **exactly** the
  reviewed type signature `(uuid, uuid, uuid, text, text, uuid)`, that it is
  `SECURITY DEFINER` with an empty `search_path`, and that `authenticated` may
  `EXECUTE` it while `anon` may not.

**Read back for this reconciliation only, and NOT asserted by that gate:**

- `created_by` is
  `github-actions:apply-production-migration@694e1922e69552ff8f98310ae79d0cdcd99f76fd`,
  naming the workflow and the commit it ran from. The gate never selects this
  column;
- `idempotency_key` is `otj:migration:0049_spond_team_reconcile`, and that
  column is UNIQUE, so the same migration cannot be applied a second time. The
  gate checks that key only **before** the apply, to prove the migration had
  not already run;
- the **name** of the preceding row is `spond_session_link_unique`. A row that
  kept version `20260812102912` under a different name would still satisfy the
  gate, so this half of that row's identity rests on the readback.

Those probes are why the function's existence and its security posture sit in
the gate list rather than under the readback: they are asserted on every run,
not merely read back once. What the readback **adds**, and the only thing it
adds, is the six parameter **names**: `p_player_id`, `p_expected_team_id`,
`p_target_team_id`, `p_expected_member_id`, `p_confirm_member_id`,
`p_batch_id`. It read them with `pg_get_function_identity_arguments`, and
`pg_proc.proargnames` holds all six.

No probe reads `proargnames`, so a function with the same **types** and renamed
parameters would satisfy all three of them. That gap is why the names are
recorded at all, and it is a real one: a PostgREST call using named arguments
would break on it while the gate stayed green.

**What none of that establishes** is the other half of "0049 adds one function
and nothing else". The probes look at one function and its privileges, and the
readback at that same function. Neither inventories tables, columns, indexes,
policies or triggers. That property comes from review of the migration SQL,
which is what the gated production process exists to provide.

The previous value, `20260812102912` / `spond_session_link_unique` (0048), is
now a superseded value and is REJECTED by the gate. That is asserted directly,
because a reconciliation that widened the constant rather than moving it would
otherwise look identical to one that moved it. It remains the row immediately
before the current head, which is why it still appears in the evidence above:
there as the preceding row, here as a value the gate must refuse.

**Everything below this line is history about superseded values, not evidence
for the current pin.** It is kept because a rejected value is easier to trust as
rejected when what it once described is on the record, and it is separated
because evidence that does not validate the value above would be worse than no
evidence at all.

0048 repaired one bad Spond link and added `sessions_spond_event_id_unique`, the
partial unique index over `sessions.spond_event_id`. The read taken after that
apply, in its own reconciliation, showed zero duplicated links across the 10
sessions carrying a `spond_event_id`, which is what the repair plus the index
had to read. That figure was established for 0048 and has not been re-taken for
0049, so it evidences that apply and nothing since.

The earlier superseded values are rejected by the same equality: `20260812064038`
(`0047_register_group_inclusion`, applied 2026-08-12 as the register group
inclusion column), and before it `20260811210248`, `20260810182333`,
`20260809184949` and `20260809081118`. A test pins every one of them, 0048's
value included.

Moving this constant is a **reconciliation**, never a deployment: it records an
already applied, already reviewed hosted state so the fail closed verifier
checks against the right one. It applies nothing and changes no schema.

### The reviewed enabled club set

Public sharing is intentionally enabled only for the reviewed allowlisted club
ids. The deploy verifier requires the hosted enabled set to match that reviewed
set exactly, before and after deployment.

Current value, `EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS` in
`verify_no_residue.py`:

| Club | Id | `public_sharing_enabled` |
|---|---|---|
| Ossett Town Juniors | `11111111-1111-1111-1111-111111111111` | true, reviewed |
| Zzz Other Club | `7007e5b0-bc23-4a4b-a82d-81acb8979782` | false |

The assertion is exact set equality on club **ids**, never a count on its own,
never a minimum, never a name match. An unexpected club enabled, the reviewed
club disabled, or one swapped for another all fail the gate before anything is
deployed, and fail it identically afterwards.

During the initial dark rollout this gate asserted that no club was enabled,
which was correct while the feature shipped switched off. Ossett was enabled
deliberately after that phase, so the count-zero form became obsolete; pinning
the exact ids keeps the same strictness against the current intended state.

Changing which clubs are enabled follows the same discipline as a migration
apply: change the hosted state under its own approval, read the enabled set
back, then open a small reconciliation pull request updating this constant and
its tests. Running the deploy before that reconciliation merges fails closed.

### If the run fails at inventory verification

The two deploy steps run before inventory verification. A failure at the
"Verify deployed inventory and JWT posture" step therefore does not mean the
functions were not deployed; both deploys may have already succeeded. Read the
step summary for the deployed versions before assuming otherwise.

If the verifier reports HTTP 403 from a direct Management API call, that is the
broad functions endpoint refusing a classic personal access token, not a deploy
failure. The workflow's primary path reads inventory from
`supabase functions list --output json`, which the same token is authorised to
run, and does not depend on that endpoint.

## Verification level (be honest about readback)

The authoritative integrity record is:

1. the SHA-256 hashes of the exact on-disk source files that were deployed
   (recorded before deploy), and
2. the deployed function version and eszip bundle fingerprint recorded after
   deploy from the Management API.

The workflow additionally attempts a best-effort `supabase functions download`
readback and hash-compares the downloaded `index.ts` against the repository.
Because a deploy bundles the source, this readback may be unavailable or may
differ through bundler normalization. The summary reports one of:

- `byte-for-byte CONFIRMED` — the downloaded source matched the repository;
- `REVIEW: downloaded index.ts differs from repo` — inspect before relying on
  the deploy;
- `source readback unavailable (bundled deploy)` — integrity rests on the
  source-input hashes plus the version and bundle fingerprint.

Byte-for-byte equality is only claimed when the comparison actually matched.

### Readback cleanup and file ownership

`supabase functions download` may create files under the readback work
directory with ownership or permissions the GitHub runner user cannot remove
directly (commonly root-owned files). A plain `rm -rf` on such a tree returns
non-zero, and under `set -euo pipefail` that would fail the job even though the
deploy already succeeded. The readback step therefore cleans up through
`cleanup_workdir` (`.github/scripts/content-sharing-deploy/readback_cleanup.sh`),
run from an `EXIT` trap so it also fires when a comparison command fails. The
helper restores owner write bits, removes the tree, and falls back to a
privileged `sudo -n rm -rf` scoped only to a path validated as a non-empty,
absolute location under the temporary root (never a repository or workspace
path, never a wildcard). Cleanup never returns non-zero for a validated temp
path, so it can never be the reason the workflow exits. A cleanup message in
the log is not a deployment failure.

### If the readback reports REVIEW (downloaded source differs)

A `REVIEW` result means the downloaded `index.ts` did not hash-match the
repository file. This is often expected: the deploy bundles and may normalize
source, so the downloaded copy is not guaranteed byte-identical. When this
happens the step records a bounded, secret-safe structural comparison in the
summary for `index.ts` and each bundled shared module (`_shared/share.ts`, and
for `manage-content-share` also `_shared/fa.ts`): file sizes, both SHA-256
hashes, and set differences over imports, environment-variable names, RPC
names, `verify_jwt` mentions, and the `CONTROL_CHARS` literal. Full source,
Authorization headers and secret values are never printed. A `REVIEW` is a
review signal, not a cleanup or deploy failure; the deploy is not failed on a
mismatch. The repository source hashes recorded before deploy, together with
the deployed function version and eszip bundle fingerprint, remain the
authoritative deployment record unless byte equality is actually proven.

## Post-deploy no-residue verification (direct Postgres, read-only)

The final step runs
`.github/scripts/content-sharing-deploy/verify_no_residue.py`, a read-only
proof that the deploy changed nothing it was not reviewed to change. It checks,
on the hosted project:

- the set of clubs with `public_sharing_enabled` true is exactly the reviewed
  allowlist (see "The reviewed enabled club set" above);
- `content_shares` has zero rows;
- `content_share_dependencies` has zero rows;
- no `content_share` audit event exists;
- every drill is `internal_only`;
- every media row is `internal_only`;
- total drill and media counts are reported;
- the migration ledger's newest version is exactly `EXPECTED_LAST_MIGRATION`, currently `20260817104226` (0049, the Spond team reconcile function);
- no pg_cron job references `content_share` (the `cron` schema being absent
  satisfies this).

### Connection and credential

The verifier connects to Postgres directly with `psql`, using the full
connection string in `SUPABASE_DB_URL` (see "The `SUPABASE_DB_URL` secret"
above). It never uses the Supabase Management API, never reads
`SUPABASE_ACCESS_TOKEN`, and never reads `SUPABASE_DATABASE_READ_TOKEN`. The CLI
deploy and list operations continue to use `SUPABASE_ACCESS_TOKEN`; the residue
check uses `SUPABASE_DB_URL` and nothing else. The DB URL is exposed only to
this one workflow step, never in the job-wide env, and never printed; error
output is redacted so neither the URL nor the database password can leak.

### Rollback-only read-only transaction

Every query runs inside a transaction that can never commit:

```
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT ...;
ROLLBACK;
```

`psql` runs with `--no-psqlrc` and `ON_ERROR_STOP=1`, emits machine-readable
JSON (tuples-only, unaligned), connects with `PGSSLMODE=require` and a bounded
connection timeout, and rolls back rather than commits. A guard rejects any
statement that is not a single read-only SELECT before it is sent, so no
`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `ALTER`, `DROP`, `CREATE`, `TRUNCATE`,
`GRANT`, `REVOKE`, `CALL`, `COPY`, `DO`, `COMMIT` or role change can ever be
transmitted. The two shipped queries read the residue counts, the migration
ledger max version, and (only when the `cron` schema exists) the count of
`content_share` cron jobs.

### Fails closed

The verifier fails the job on a missing `SUPABASE_DB_URL`, a connection or
authentication failure, an unreadable schema or table, malformed or missing
output, any dirty residue value, a changed migration ledger, or a present
`content_share` cron job. No error path prints the connection string, the
password or the environment. Its offline test suite
(`test_verify_no_residue.py`) mocks `psql` and runs in CI under the
`content-sharing deploy scripts` job.

## What the workflow does NOT do

- It does not enable or disable public sharing for any club.
  `clubs.public_sharing_enabled` is untouched; the workflow verifies read-only,
  before and after the deploy, that the enabled set is exactly the reviewed
  allowlist.
- It does not create, refresh, rotate or revoke any share. The smoke tests send
  a random, never-printed secret against an unknown share id and expect the
  neutral unavailable response.
- It does not reclassify content. All drills and media remain `internal_only`;
  the workflow verifies this after deploy.
- It does not apply a migration, change a grant, or create a cleanup schedule;
  the workflow verifies the migration ledger's newest version is exactly the
  reviewed one (`EXPECTED_LAST_MIGRATION`, named rather than restated here so
  it cannot drift out of date the way `0043` did) and no `pg_cron` job
  references content sharing, both BEFORE and after the deploy. The check is an
  exact equality, so applying a migration without updating
  `EXPECTED_LAST_MIGRATION` fails the deploy before anything is changed, and so
  does updating the constant without applying the migration.

## Rotating the access token

1. In the Supabase dashboard, create a new access token for the deploying
   account and revoke the old one.
2. Update the `SUPABASE_ACCESS_TOKEN` secret on the GitHub `production`
   environment.
3. No code change is required. The next run picks up the new token.

Never place the token in the repository, a workflow input, a log line or this
document.

## Rollback

The functions carry no schema and no data. To roll back, re-run this workflow
from a previously reviewed commit whose function source you trust; the deploy
overwrites the live function with that commit's source. Deploying an earlier
known-good commit is the rollback.

## Emergency disable

Public reading is gated by the per-club kill switch
`clubs.public_sharing_enabled`, which remains the authoritative switch. It is
`true` for Ossett Town Juniors and `false` for every other club. To stop public
reading, set `public_sharing_enabled = false` for the affected club (an
admin-only `club.manage` action). With the switch off, the
public reader returns the neutral unavailable response for every share without
touching any share row. This disables public reads without redeploying or
deleting the functions.

Do this first and reconcile afterwards. Turning a club off (or on) puts the
hosted enabled set out of step with
`EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS`, so the next deploy fails closed at
the pre-deploy gate until a small reconciliation pull request updates that
constant to the new reviewed set. That ordering is deliberate: an emergency
stop must never wait on a code change, and a deploy must never run against a
club state nobody reviewed.
