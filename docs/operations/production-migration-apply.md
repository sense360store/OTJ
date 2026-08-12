# Applying a migration to production

`.github/workflows/apply-production-migration.yml` applies ONE reviewed
Supabase migration to the hosted production database, from a button, and
records it in the hosted ledger. It deploys no frontend code, no Edge Function,
no Storage policy and no secret.

Migrations are a review gate in this repository (CLAUDE.md, "Review gates").
This workflow does not loosen that gate. It replaces the by-hand SQL client
with a button and keeps every check the hand was supposed to perform, in an
order where each one fails before the next can do damage.

## Applied through this workflow

| Migration | Hosted version | Applied |
|---|---|---|
| `0046_drill_diagram` | `20260811210248` | 2026-08-11 |
| `0047_register_group_inclusion` | `20260812064038` | 2026-08-12 |

`0047` stays in the dropdown and in `REVIEWED_MIGRATIONS` now that it has run.
Entries are never removed once applied: the register is the closed list of what
this workflow may apply, and an applied entry is what makes a second press fail
closed rather than fail unrecognised. Selecting it again stops at the pre-apply
gate, which now finds the ledger moved, the migration already recorded and the
column already present, and the UNIQUE `idempotency_key` refuses the insert
behind that. Its `expected_previous_version` stays `20260811210248` for the same
reason: it records the state `0047` was REVIEWED against, not the current head.

`0047`'s ledger row records `created_by` as the workflow and the commit it ran
from, `b3f5d5c1a6610a5ff804a7b1b008adc8a4def6cf`, an `idempotency_key` of
`otj:migration:0047_register_group_inclusion`, and one `statements` entry
hashing to `317101852faf1ddc68f8e641f24579b9`, the reviewed file with its
trailing newline stripped. The post-apply gate confirmed it was the unique
newest row with `20260811210248` / `drill_diagram` before it, and that
`public.register_entries.included_in_groups` exists as a NOT NULL boolean
defaulting to false. The attendance record was read either side and did not
move: 9 register rows before and after, 1 with `present` true before and after,
and 0 with `included_in_groups` true immediately afterwards, which is what a
defaulted column with no backfill must read. The four `register_entries` RLS
policies remained 4, with no `FOR ALL` policy introduced.

`0046` is the first migration this workflow applied. Its ledger row records
`created_by` as the workflow and the commit it ran from, an `idempotency_key`
of `otj:migration:0046_drill_diagram`, and one `statements` entry hashing to
the reviewed file. The post-apply gate confirmed it was the unique newest row
with `20260810182333` / `spond_links` before it, and that the column, the check
constraint and the three validation functions all exist.

## What runs, in order

| Step | What it proves |
|---|---|
| Check out the selected commit | The applied file is the one at `github.sha`, not a working copy |
| Confirm target project | The typed ref equals the hardcoded ref AND the `SUPABASE_PROJECT_ID` secret |
| Confirm the migration is on the reviewed list | The path is a key of `REVIEWED_MIGRATIONS`, even when dispatched via the API rather than the dropdown |
| Pin and assert the Supabase CLI | Version `2.105.0`, the same pin the Edge Function deploys use |
| Confirm the token sees the project | `SUPABASE_ACCESS_TOKEN` authenticates and the target project is visible to it |
| Refuse a dirty working tree | Nothing uncommitted can reach the database |
| Record the apply plan | Commit SHA and the migration's SHA-256, in the step summary, BEFORE anything is applied |
| Check the connection string | `SUPABASE_DB_URL` names the expected project ref in its user or host |
| Pre-apply gate | The hosted ledger is still the reviewed one and this migration has never run |
| Apply | One transaction: ledger row, then the migration, one COMMIT |
| Post-apply gate | The migration is now the unique newest row, its recorded statement hashes to the reviewed file, and every object exists |

## The safety model

**It cannot run itself.** `workflow_dispatch` is the only trigger. Merging the
workflow changes no database, and merging a migration changes no database
either. No push, pull request, schedule or workflow_call reaches it, and a test
fails the build if one is added.

**It cannot run unapproved.** The job declares `environment: production`.
Configure a required reviewer on that environment so GitHub holds the run at
"Waiting" until a human approves it. That is a repository setting, not a file,
so nothing in the repository can prove it is set. Check it before the first
run.

**It cannot reach another project.** The operator types the project ref, and it
must equal both a ref hardcoded in the workflow and the configured
`SUPABASE_PROJECT_ID` secret. A valid token pointed elsewhere gets nowhere.

Those three checks all guard values psql never uses, so they are not enough on
their own: `SUPABASE_DB_URL` is a separate secret and is the only thing the
apply actually connects through. `check_db_url_project.py` asserts that it
names the expected project ref as a dotted component of its connection user
(`postgres.<ref>`, session pooler) or its host (`db.<ref>.supabase.co`,
direct), never as a loose substring. It runs in the pre-apply gate and again in
the apply step itself, because the step that opens the connection checks its
own connection. It never prints the string.

**It cannot apply an unreviewed file.** The migration is chosen from a dropdown
whose options are the keys of `REVIEWED_MIGRATIONS` in
`.github/scripts/production-migration/reviewed_migrations.py`. A test fails the
build if the dropdown and the register drift apart. Adding a migration to the
register is its own reviewed pull request, so "this SQL is correct" and "this
SQL may be applied to production" are one review.

**It cannot apply more than one.** There is no "apply everything pending"
operation anywhere in it. The apply opens exactly one database connection and
runs exactly one script, and tests assert both.

**It cannot apply the same migration twice.** Three independent things stop it:
the pre gate refuses when the ledger already carries the migration, the pre
gate refuses when any object the migration creates already exists, and the
ledger's UNIQUE `idempotency_key` makes the insert itself fail. The third is
the database refusing, not a script deciding.

**It cannot half-apply.** The ledger row is inserted FIRST, inside the
transaction, and the migration file's own `COMMIT` commits both together. Any
failure, including the migration's own self-verification blocks, rolls back the
schema change and the ledger row as one. A role that cannot write the ledger
fails before a single DDL statement runs. When the apply does fail, a further
step re-runs the pre gate and states in the summary whether the database is
genuinely untouched.

## Why not `supabase db push`

The repository names its migration files `0001`..`0046`. The hosted ledger
records 14 digit timestamp versions assigned at apply time: `0045_spond_links`
is recorded as `20260810182333` / `spond_links`. `db push` reconciles the two
by pushing every unapplied local file under its own file name as the version,
which would both apply more than one migration in a run and write a version
shape this ledger has never used, permanently splitting the history.

The apply instead records the migration the way every existing hosted row is
recorded: `statements` holding ONE entry with the whole file text, `name`
holding the file stem without its number, and `version` stamped from the
database server clock. That shape was read off the hosted project and is pinned
by a test (`0044_training_day_core`'s stored statement hashes to its file with
the trailing newline stripped).

## Why psql rather than the Management API

`docs/operations/content-sharing-edge-function-deploy.md` records the finding:
the classic personal access token in `SUPABASE_ACCESS_TOKEN` returns HTTP 403
against the Management API database endpoints on this project. Every database
read and the apply itself therefore go through a direct psql connection using
`SUPABASE_DB_URL`, the connection the no-residue verifier already uses from
Actions. `SUPABASE_ACCESS_TOKEN` still authenticates the pinned CLI, used here
for one thing only: proving the run is pointed at a project this account can
see, before psql opens anything.

## Required GitHub configuration

Secrets, on the `production` environment (all three already exist for the Edge
Function deploys):

- `SUPABASE_PROJECT_ID` — the target project ref, `uynorsnrvocksgqweucu`.
- `SUPABASE_ACCESS_TOKEN` — classic personal access token, used only to
  authenticate the CLI for `supabase projects list`.
- `SUPABASE_DB_URL` — the full PostgreSQL connection string from Project ->
  Connect -> Direct -> Session pooler. It carries the database password and is
  exposed only to the three steps that need it, never to the job. It is never
  printed: psql output passes through `redact.py` on success and on failure.

## Running it

1. Merge the migration and its register entry to `main` after review.
2. Actions -> "Apply production migration" -> Run workflow, from `main`.
3. Choose the migration file from the dropdown.
4. Type `uynorsnrvocksgqweucu` for `confirm_project`.
5. Approve the run when GitHub prompts (production environment gate).
6. Read the job summary: the plan with the commit and SHA-256, the pre gate,
   and the post gate with the assigned hosted version.

## Afterwards: reconcile EXPECTED_LAST_MIGRATION

The hosted ledger version is assigned BY THE APPLY, so it cannot be known
before the apply happens. The post gate prints it under "The assigned hosted
migration version".

1. Copy that value.
2. Open a SEPARATE reconciliation pull request setting `EXPECTED_LAST_MIGRATION`
   in `.github/scripts/content-sharing-deploy/verify_no_residue.py` to exactly
   that string, updating its tests, its sample fixture and
   `docs/operations/content-sharing-edge-function-deploy.md` alongside it.
3. Merge it after CI.

Until that lands, the content-sharing Edge Function deploy workflow fails
closed on its own ledger gate. That is intended: it is far safer than a check
that passes regardless.

## What the tests cover, and what they cannot

`.github/scripts/production-migration/test_reviewed_migrations.py` and
`test_workflow_invariants.py` run in CI on every pull request. They check the
register, the gate assertions against sample hosted reads, the apply script's
statement order, and the workflow's shape.

They are tripwires, not proofs. They never connect to a database, so they
cannot tell you the migration is correct, cannot tell you the production
environment has a required reviewer, and cannot tell you the hosted project is
in the state the register expects. The first is what the migration's own pull
request is for; the second is the manual check above; the third is what the pre
gate does at run time, against the real database.

The apply mechanics were exercised end to end against a throwaway PostgreSQL 16
before this shipped: a clean apply, a repeat apply refused by the unique
idempotency key, and a migration failing part way through, which rolled back
the schema change and the ledger row together.
