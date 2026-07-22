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
| `read-content-share` | `false` | The only anonymous function: resolves an opaque public drill share to its stored, sanitised snapshot. |

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
    deploy functions to the target project and run read-only Management API
    queries. Never printed, echoed, logged or committed.
  - `SUPABASE_PROJECT_ID` — the target project ref. Expected value:
    `uynorsnrvocksgqweucu`.

A project ref is not a credential; it appears in every function URL. The
workflow hardcodes the intended ref (`uynorsnrvocksgqweucu`) so a valid token
pointed at a different project cannot deploy here.

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
  the eszip bundle fingerprint for the two sharing functions;
- the deployed-source readback level (see below);
- the post-deploy residue check (all counts expected to be zero, migration
  ledger newest version `20260722064502`).

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

## What the workflow does NOT do

- It does not enable public sharing. `clubs.public_sharing_enabled` stays
  `false` on every club; the workflow verifies this read-only after deploy.
- It does not create, refresh, rotate or revoke any share. The smoke tests send
  a random, never-printed secret against an unknown share id and expect the
  neutral unavailable response.
- It does not reclassify content. All drills and media remain `internal_only`;
  the workflow verifies this after deploy.
- It does not apply a migration, change a grant, or create a cleanup schedule;
  the workflow verifies the migration ledger is unchanged after `0039` and no
  `pg_cron` job references content sharing.

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
`clubs.public_sharing_enabled`. It is `false` today. If a public share is ever
enabled and must be stopped, set `public_sharing_enabled = false` for the
affected club (an admin-only `club.manage` action). With the switch off, the
public reader returns the neutral unavailable response for every share without
touching any share row. This disables public reads without redeploying or
deleting the functions.
