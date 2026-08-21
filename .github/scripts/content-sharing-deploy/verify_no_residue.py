#!/usr/bin/env python3
"""Read-only proof that the deploy changed nothing it must not change.

Runs a small set of SELECT-only queries through psql against a full PostgreSQL
connection string. Two kinds of check, and the difference between them is the
whole design:

ABSOLUTE INVARIANTS, asserted identically in both phases against fixed
reviewed values. A breach stops the deploy outright:

  - the set of clubs with public_sharing_enabled is EXACTLY the reviewed
    allowlist of club ids (see EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS);
  - every drill is internal_only;
  - every media row is internal_only;
  - the migration ledger's newest version is exactly EXPECTED_LAST_MIGRATION,
    currently 20260817104226 (0049, spond_team_reconcile);
  - no pg_cron job references content_share (no cleanup schedule was created).

LIVE SHARING STATE, which is legitimate mutable product data and is therefore
PRESERVED rather than pinned. Three datasets are baselined before the deploy
and proved unchanged after it:

  - public.content_shares
  - public.content_share_dependencies
  - public.audit_events where entity_type = 'content_share'

Why this is not a relaxation. Until 10 August 2026 those three were asserted to
be EMPTY, and that was correct: public sharing had shipped switched off, so a
deploy could prove it changed nothing observable by proving nothing observable
existed. Ossett Town Juniors was then deliberately enabled and a coach created
a session share through manage-content-share, which is the feature working as
designed. From that moment "must be empty" asserted a state the product is
built to leave behind, and it failed every deploy: GitHub Actions run
32426729784 stopped at this gate with `shares expected 0, got 1` and
`share_audit expected 0, got 1`, before either function was deployed.

The invariant it is replaced by is strictly about the DEPLOYMENT, which is what
this verifier exists to police: the sharing state immediately after the deploy
must be byte-identical to the sharing state immediately before it. A share
created, refreshed, rotated, revoked or deleted during the deploy window fails
the run, whatever created it. That is a preservation gate, not a looser count.

Runs TWICE in the deploy workflow:

  --phase pre --baseline-out PATH
                 before either function is deployed. Asserts every absolute
                 invariant while both functions are still untouched, then
                 captures the live sharing baseline. A wrong ledger version or
                 a breached absolute invariant stops the workflow with nothing
                 deployed, and no baseline is written.
  --phase post --baseline-in PATH
                 after the deploy. Asserts every absolute invariant again, then
                 requires each dataset's count AND fingerprint to equal the
                 baseline exactly.

The assertion on the ledger version is an EXACT equality in both phases. It is
never relaxed to a >=, a prefix match or an "exists somewhere" check: the point
is to prove the hosted schema is precisely the reviewed one, and a loose check
would pass against an unreviewed migration.

Fingerprints
------------
Computed SERVER SIDE. Only a count and a 32 hex digit aggregate hash ever leave
Postgres, so no share row, token hash, snapshot, audit metadata or actor
identity reaches Python, the runner filesystem, the log, the job summary or an
artifact. See STATE_SELECT for the construction and its determinism argument.

Credential model
----------------
The connection string is read ONLY from SUPABASE_DB_URL, the full Postgres URI
copied from Project -> Connect -> Direct -> Session pooler, carrying the project
database password. It is used only to open the psql connection and is never
printed; error output is redacted so neither the URL nor the password can leak.

This script never reads SUPABASE_DATABASE_READ_TOKEN, SUPABASE_ACCESS_TOKEN, or
any Supabase Management API endpoint. The Management API read-only SQL endpoint
returned HTTP 403 for the classic access token on this project, which was the
original cause of the "database query API returned HTTP 403" failure; the direct
Postgres connection avoids that endpoint entirely.

Read-only transaction
---------------------
Every psql invocation runs its SELECT inside

  BEGIN;
  SET TRANSACTION READ ONLY;
  SET LOCAL statement_timeout = '30s';
  SELECT ...;
  ROLLBACK;

so nothing can be committed. psql runs with --no-psqlrc and ON_ERROR_STOP=1,
emits machine-readable JSON (tuples-only, unaligned), connects with
PGSSLMODE=require and a bounded connection timeout, and a guard rejects any
statement that is not a single read-only SELECT before it is ever sent.

Usage:
  verify_no_residue.py --phase pre  --baseline-out <baseline.json>
  verify_no_residue.py --phase post --baseline-in  <baseline.json>
  verify_no_residue.py --sample <results.json> [--phase pre|post] [...]
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import subprocess
import sys
import urllib.parse

# The EXACT version the migration ledger's newest row must carry after a
# successful deploy. This is an equality assertion on purpose: it proves the
# hosted schema is precisely the one this deploy was reviewed against. It is
# deliberately NOT a ">=", a prefix match or an "exists somewhere" check, any of
# which would let an unreviewed migration land unnoticed.
#
# It moves in lockstep with the migration actually applied to hosted. The value
# below is RECONCILED: 0049_spond_team_reconcile was deliberately applied to
# the hosted project through the gated production process, and hosted assigned
# it this exact version, 20260817104226. It was read back from
# supabase_migrations.schema_migrations after the apply and confirmed to be the
# unique newest ledger entry, appearing exactly once with no row newer, and
# with the previously pinned 20260812102912 / spond_session_link_unique now the
# entry before it.
#
# The row carries the evidence the gated workflow
# (.github/workflows/apply-production-migration.yml) records. Each fact below
# names WHAT ESTABLISHED IT, because the mechanisms do not cover the same
# ground and an auditor who assumes they do will trust more than was checked:
#
#   ASSERTED BY THE POST-APPLY GATE (verify_hosted_state.assert_post), and
#   read back again here:
#     - the row is the unique newest one, recorded at the newest version;
#     - the VERSION of the row before it is 20260812102912. Only the version:
#       assert_post compares second_version against expected_previous_version
#       and never compares second_name, which it reads but uses only in the
#       failure message and the report table. The NAME below is readback;
#     - statements holds exactly one entry, and md5(statements[1]) is
#       d9d2199dcaabbc2da9248489754dc28a, the reviewed file with its trailing
#       newline stripped;
#     - and, through the three registered object probes in
#       reviewed_migrations.py, that public.spond_reconcile_player_team
#       resolves at EXACTLY the reviewed type signature
#       (uuid, uuid, uuid, text, text, uuid), that it is SECURITY DEFINER with
#       an empty search_path, and that authenticated may EXECUTE it while anon
#       may not.
#
#   READ BACK HERE ONLY, and NOT asserted by that gate:
#     - created_by is
#       github-actions:apply-production-migration@694e1922e69552ff8f98310ae79d0cdcd99f76fd,
#       naming the workflow and the commit it ran from. The gate never selects
#       this column at all;
#     - idempotency_key is otj:migration:0049_spond_team_reconcile against a
#       UNIQUE column, so the same migration cannot be applied twice. The gate
#       checks that key only BEFORE the apply, to prove the migration had not
#       already run; assert_post does not re-read it;
#     - the NAME of the preceding row is spond_session_link_unique. A row that
#       kept version 20260812102912 under a different name would satisfy the
#       gate, so this half of that row's identity rests on the readback.
#
# Those probes are why the object's existence and its security posture belong
# above and not here: they are asserted by the gate on every run, not merely
# read back once. What the readback adds, and the ONLY thing it adds, is the
# six parameter NAMES: p_player_id, p_expected_team_id, p_target_team_id,
# p_expected_member_id, p_confirm_member_id, p_batch_id. It read them with
# pg_get_function_identity_arguments, and pg_proc.proargnames holds all six.
#
# No probe reads proargnames, so a function with the same TYPES and renamed
# parameters would satisfy all three of them. That gap is the reason the names
# are recorded here at all, and it is a real one: a PostgREST call using named
# arguments would break on it while the gate stayed green.
#
# What NONE of that establishes is the other half of "0049 adds one function
# and NOTHING else". The probes look at one function and its privileges, and
# the readback at that same function; neither inventories tables, columns,
# indexes, policies or triggers, so nothing in either could tell a 0049 that
# added only the function from one that added the function and something more.
#
# Nor does 0049's own in-migration self-verification establish it, and an
# earlier draft of this block wrongly said it did. That block does compare a
# fingerprint taken BEFORE the DDL against the same reads after, which is a
# real comparison rather than a value compared with itself, but it is an
# ENUMERATED comparison and not a schema wide one: row counts on
# player_registrations, player_spond_links, register_entries,
# spond_event_responses and audit_events, plus the policy count, the grant
# string and the trigger names over a named handful of tables. An added table,
# column or index, or a policy on a table outside that list, would leave every
# one of those assertions passing.
#
# "One function and nothing else" therefore rests on REVIEW OF THE MIGRATION
# SQL, which is what the gated production process exists to provide, and this
# block claims no more than that.
#
# This constant's move is a RECONCILIATION of an already applied, already
# reviewed migration. Changing it deploys nothing, applies nothing and alters
# no schema: it only tells the fail closed verifier which reviewed hosted state
# it is now checking against.
#
# The ledger version is assigned BY THE APPLY (stamped from the server clock),
# so it cannot be known before the apply happens. The order is always: apply ->
# read back the recorded version -> set this constant to exactly that value in
# a reviewed pull request -> only then deploy.
EXPECTED_LAST_MIGRATION = "20260817104226"  # 0049_spond_team_reconcile

# The EXACT set of club ids permitted to have public_sharing_enabled true.
# This is a deployment review pin in the same sense as
# EXPECTED_LAST_MIGRATION, and it is asserted as SET EQUALITY, never as a
# count, a minimum, a maximum or a "contains".
#
# Provenance. During the initial dark rollout the gate asserted that NO club
# had public sharing enabled: the feature shipped with its machinery in place
# and switched off, so the deploy could prove it changed nothing observable.
# That phase is over. Ossett Town Juniors
# (11111111-1111-1111-1111-111111111111) was deliberately enabled afterwards,
# a product decision, not residue. The hosted state was read back and the
# gate now permits exactly that reviewed set: Ossett enabled, every other
# club (including Zzz Other Club,
# 7007e5b0-bc23-4a4b-a82d-81acb8979782) disabled.
#
# The property that matters is unchanged and is the whole point of pinning
# the identities rather than the count: an unexpected club being enabled, the
# expected club being disabled, or one enabled club being swapped for another
# all still stop the deploy, before anything is deployed. Any intended change
# to the enabled set is a separate reviewed reconciliation pull request that
# reads hosted back first, exactly as a migration apply is.
#
# clubs.public_sharing_enabled remains the authoritative per club kill
# switch; this constant only records which clubs the deploy was reviewed
# against. Nothing here reads or writes that switch.
EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS = (
    "11111111-1111-1111-1111-111111111111",  # Ossett Town Juniors
)

DB_URL_ENV = "SUPABASE_DB_URL"

# Bounded connection timeout (seconds) and an overall subprocess wall-clock cap.
# statement_timeout below bounds the query itself; these bound the connect and
# the process so a wedged network can never hang the job.
CONNECT_TIMEOUT_SECONDS = 15
SUBPROCESS_TIMEOUT_SECONDS = 60

# The read-only preamble every statement runs under. No COMMIT ever appears; the
# transaction is always discarded with ROLLBACK.
#
# The output-formatting GUCs are pinned because the state fingerprints below
# render WHOLE ROWS through to_jsonb(t)::text, and several PostgreSQL types are
# rendered according to a session setting. The same unchanged row then hashes
# two ways in two sessions, which would report the live sharing state as
# changed when nothing had changed. A fail-closed gate that cries wolf is a
# gate somebody switches off, so this is a correctness requirement rather than
# tidiness.
#
# Two of these were MEASURED against this project's database, not assumed:
#
#   TimeZone, for timestamptz (content_shares.created_at and five more):
#     UTC              {"c": "2026-08-10T17:14:53.087233+00:00"}
#                      md5 ac1dd26dbe9da00843070d826a17f311
#     America/New_York {"c": "2026-08-10T13:14:53.087233-04:00"}
#                      md5 1010c8de772c30ce2fcd8fc225914fed
#
#   bytea_output, for bytea (content_shares.token_hash):
#     hex              {"b": "\\xdeadbeef01"}
#                      md5 249af7b5e5582f80b1f4434c6150d254
#     escape           {"b": "\\336\\255\\276\\357\\001"}
#                      md5 5e46159b11924b75616ee4f7598e836f
#
# The other three are prophylactic, and deliberately so. to_jsonb(t) covers the
# whole row precisely SO THAT a column added by a future migration is
# fingerprinted without this file being edited, which means the class of
# session-dependent rendering is open even though no interval, float or bare
# date column exists in these three tables today. Closing the class costs three
# lines; discovering it later costs a deploy that fails on an unchanged
# database. Each is pinned to the value that is already the default, so nothing
# about today's rendering changes.
#
# SET LOCAL is transaction-scoped and is not a write; a read-only transaction
# permits it.
READ_ONLY_PREAMBLE = (
    "begin;\n"
    "set transaction read only;\n"
    "set local statement_timeout = '30s';\n"
    "set local timezone = 'UTC';\n"
    "set local bytea_output = 'hex';\n"
    "set local datestyle = 'ISO, MDY';\n"
    "set local intervalstyle = 'postgres';\n"
    "set local extra_float_digits = 3;\n"
)
READ_ONLY_EPILOGUE = "rollback;\n"

# Every ABSOLUTE invariant fact plus the cron-schema probe, emitted as one JSON
# object. count(*) renders as a JSON number; max(version) is text and renders as
# a JSON string; has_cron is a JSON boolean.
#
# The three live sharing datasets are deliberately ABSENT here. They are read by
# STATE_SELECT instead, which takes each dataset's count and its fingerprint in
# ONE statement and therefore one snapshot: a count from this query and a
# fingerprint from that one would be two transactions, and a share created
# between them would make the pair disagree with itself.
RESIDUE_SELECT = """select json_build_object(
  'clubs_enabled',       (select count(*) from public.clubs where public_sharing_enabled),
  'enabled_club_ids',    (select coalesce(json_agg(c.id::text order by c.id::text), '[]'::json)
                          from public.clubs c where c.public_sharing_enabled),
  'non_internal_drills', (select count(*) from public.drills where rights <> 'internal_only'),
  'non_internal_media',  (select count(*) from public.media  where rights <> 'internal_only'),
  'total_drills',        (select count(*) from public.drills),
  'total_media',         (select count(*) from public.media),
  'last_migration',      (select max(version) from supabase_migrations.schema_migrations),
  'has_cron',            (to_regclass('cron.job') is not null)
)"""

# The three live sharing datasets, each as a count and a deterministic
# fingerprint of its complete row content, in ONE statement so both halves of a
# pair describe the same snapshot.
#
# Construction, per dataset:
#
#   md5( coalesce( string_agg( md5(to_jsonb(t)::text), '' order by t.id ), '' ) )
#
#   to_jsonb(t)     the WHOLE row, so a column added by a future migration is
#                   covered without this query being edited, and no column has
#                   to be named here (naming one would also be the only way a
#                   word like "created_at" could reach the SELECT-only guard's
#                   forbidden-token list and be refused as if it were DDL);
#   ::text          jsonb renders with its keys in a canonical order, so the
#                   physical column order cannot change the hash;
#   md5(...) inner  a FIXED-LENGTH 32 character hash per row, so concatenation
#                   is unambiguous: two rows cannot be concatenated into the
#                   same string as two other rows;
#   order by t.id   explicit and total. Every one of the three tables has a uuid
#                   primary key named id. Ordered by the uuid ITSELF rather than
#                   by id::text, because text ordering is collation dependent
#                   and the uuid type compares by value, so row order cannot
#                   move with a database's lc_collate;
#   coalesce(...,'')  string_agg over zero rows is NULL, so an empty dataset
#                   fingerprints as md5('') = EMPTY_FINGERPRINT rather than as
#                   SQL NULL, which would compare unequal to itself;
#   md5(...) outer  one aggregate value.
#
# This is a CHANGE DETECTION fingerprint, not an authentication primitive. It
# answers "is this byte-identical to what I saw before"; md5 is appropriate for
# that and needs no extension. The security control on who may write these rows
# is the database's own RLS and grants, not this hash.
#
# What leaves Postgres is a count and 32 hex digits per dataset. Row bodies,
# token hashes, share snapshots, audit metadata and actor identities are hashed
# inside the server and never materialise in Python, on the runner's disk, in
# the log or in the job summary.
STATE_SELECT = """select json_build_object(
  'content_shares', json_build_object(
    'count',       (select count(*) from public.content_shares),
    'fingerprint', (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by t.id), ''))
                    from public.content_shares t)
  ),
  'content_share_dependencies', json_build_object(
    'count',       (select count(*) from public.content_share_dependencies),
    'fingerprint', (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by t.id), ''))
                    from public.content_share_dependencies t)
  ),
  'content_share_audit_events', json_build_object(
    'count',       (select count(*) from public.audit_events t where t.entity_type = 'content_share'),
    'fingerprint', (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by t.id), ''))
                    from public.audit_events t where t.entity_type = 'content_share')
  )
)"""

# The three datasets, in the order they are reported. Every baseline must carry
# exactly these keys: a baseline missing one, or carrying an unknown one, is
# refused rather than partially compared.
MUTABLE_DATASETS = (
    "content_shares",
    "content_share_dependencies",
    "content_share_audit_events",
)

# md5 of the empty string: what an empty dataset fingerprints to. Written out
# rather than computed so a test can pin the value the SQL must produce.
EMPTY_FINGERPRINT = "d41d8cd98f00b204e9800998ecf8427e"

# The baseline file's format. POST refuses any other value outright rather than
# guessing which fields a future shape carries.
BASELINE_FORMAT_VERSION = 1

# Only run when has_cron is true; referencing cron.job when the schema is absent
# would error at parse time, so the schema's presence is proven first.
CRON_JOBS_SELECT = (
    "select json_build_object('n', count(*)) "
    "from cron.job where command ilike '%content_share%'"
)

# Statements that would mutate data, schema, permissions or the session role, or
# end the transaction with a commit. The verifier is read only; this guard is
# defence in depth so a future edit cannot smuggle a write past the read-only
# transaction (which would reject it anyway, but fail late).
_FORBIDDEN_TOKENS = (
    "insert", "update", "delete", "merge", "alter", "drop", "create",
    "truncate", "grant", "revoke", "call", "copy", "do ", "commit",
    "set role", "reset role", "set session authorization",
)


def get_db_url() -> str:
    """Return the Postgres connection string, or exit with a precise message.

    Reads ONLY SUPABASE_DB_URL. Never reads SUPABASE_DATABASE_READ_TOKEN or
    SUPABASE_ACCESS_TOKEN; those credentials are not consulted for SQL.
    """
    url = os.environ.get(DB_URL_ENV, "")
    if not url:
        raise SystemExit(
            f"FAIL: {DB_URL_ENV} is not set. This verifier connects to Postgres "
            "directly with psql; it never falls back to a Supabase API token."
        )
    return url


def redact(text: str, db_url: str) -> str:
    """Remove the connection string and its password from a string.

    Applied to any psql stderr before it is surfaced, so neither the URL nor the
    database password can reach the log on a failure path.
    """
    if not text:
        return ""
    out = text.replace(db_url, "[redacted]")
    try:
        parsed = urllib.parse.urlsplit(db_url)
        if parsed.password:
            out = out.replace(parsed.password, "[redacted]")
        if parsed.username:
            out = out.replace(parsed.username, "[redacted]")
    except ValueError:
        pass
    return out


def assert_select_only(sql: str) -> None:
    """Reject any statement that is not a single read-only SELECT."""
    # Strip line comments so a comment cannot hide a keyword or a statement.
    lines = []
    for raw in sql.splitlines():
        stripped = raw.split("--", 1)[0]
        lines.append(stripped)
    cleaned = " ".join(lines).strip().lower()
    if not cleaned.startswith("select"):
        raise SystemExit("FAIL: refusing to run a non-SELECT statement")
    if ";" in cleaned.rstrip(";"):
        raise SystemExit("FAIL: refusing to run multiple statements")
    for bad in _FORBIDDEN_TOKENS:
        if bad in cleaned:
            raise SystemExit(f"FAIL: refusing statement containing '{bad.strip()}'")


def build_script(select_sql: str) -> str:
    """Wrap one SELECT in the read-only, rollback-only transaction.

    The inner statement is validated first, then framed by the preamble and a
    ROLLBACK epilogue. The result never contains COMMIT.
    """
    assert_select_only(select_sql)
    script = f"{READ_ONLY_PREAMBLE}{select_sql};\n{READ_ONLY_EPILOGUE}"
    # Defence in depth: the assembled script must never commit and must roll back.
    if "commit" in script.lower():
        raise SystemExit("FAIL: refusing a script that contains COMMIT")
    if "rollback" not in script.lower():
        raise SystemExit("FAIL: refusing a script that does not ROLLBACK")
    return script


def classify_error(returncode: int, stderr: str, db_url: str) -> str:
    """A precise, secret-safe FAIL message for a psql failure.

    Never returns the raw stderr; the connection string and password are
    redacted before a bounded excerpt is included for diagnosis.
    """
    low = (stderr or "").lower()
    excerpt = redact((stderr or "").strip().splitlines()[0] if stderr.strip() else "", db_url)
    if "authentication failed" in low or "password authentication" in low:
        return (
            "FAIL: authentication failed connecting to Postgres. The "
            f"{DB_URL_ENV} password is wrong or the role is not permitted. "
            f"({excerpt})"
        )
    if any(s in low for s in (
        "could not connect", "could not translate host", "connection refused",
        "no route to host", "timeout expired", "server closed the connection",
        "could not receive data", "connection timed out",
    )):
        return f"FAIL: could not connect to Postgres. ({excerpt})"
    if "canceling statement due to statement timeout" in low:
        return f"FAIL: residue query exceeded statement_timeout. ({excerpt})"
    if "permission denied" in low or "does not exist" in low:
        return (
            "FAIL: a queried schema or table is unreadable to this role. "
            f"({excerpt})"
        )
    return f"FAIL: psql exited {returncode}. ({excerpt})"


def _default_runner(script: str, db_url: str) -> tuple[int, str, str]:
    """Run one read-only script through psql and return (rc, stdout, stderr).

    Injectable in tests. --no-psqlrc ignores any user startup file; ON_ERROR_STOP
    aborts on the first error; -q -t -A yield a single machine-readable JSON line
    with no command tags. PGSSLMODE=require forces TLS; PGCONNECT_TIMEOUT bounds
    the connect. The URL is passed as the connection argument and is never echoed.
    """
    cmd = [
        "psql",
        "--no-psqlrc",
        "--set", "ON_ERROR_STOP=1",
        "-q",            # quiet: no command tags (BEGIN/SET/ROLLBACK) on stdout
        "-t",            # tuples only
        "-A",            # unaligned
        "-d", db_url,
        "-f", "-",       # read the script from stdin
    ]
    env = dict(os.environ)
    env["PGSSLMODE"] = "require"
    env["PGCONNECT_TIMEOUT"] = str(CONNECT_TIMEOUT_SECONDS)
    try:
        proc = subprocess.run(
            cmd,
            input=script,
            capture_output=True,
            text=True,
            env=env,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        raise SystemExit("FAIL: psql is not installed on the runner")
    except subprocess.TimeoutExpired:
        raise SystemExit("FAIL: psql timed out connecting to or querying Postgres")
    return proc.returncode, proc.stdout, proc.stderr


def parse_json_output(stdout: str) -> object:
    """Parse the single JSON value psql emitted, or fail closed."""
    text = (stdout or "").strip()
    if not text:
        raise SystemExit("FAIL: psql returned no output")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Tolerate a stray line (e.g. an unexpected NOTICE) by finding the JSON.
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("{") or line.startswith("["):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise SystemExit("FAIL: psql returned malformed (non-JSON) output")


def run_read_only_select(select_sql: str, runner=None) -> object:
    """Validate, wrap, run one SELECT read-only, and return its parsed JSON."""
    script = build_script(select_sql)
    db_url = get_db_url()
    if runner is None:
        runner = _default_runner
    rc, stdout, stderr = runner(script, db_url)
    if rc != 0:
        raise SystemExit(classify_error(rc, stderr, db_url))
    return parse_json_output(stdout)


def gather(runner=None) -> dict:
    residue = run_read_only_select(RESIDUE_SELECT, runner)
    if not isinstance(residue, dict):
        raise SystemExit("FAIL: residue query returned an unexpected shape")
    has_cron = bool(residue.get("has_cron"))
    cron_jobs = 0
    if has_cron:
        cron = run_read_only_select(CRON_JOBS_SELECT, runner)
        if not isinstance(cron, dict):
            raise SystemExit("FAIL: cron probe returned an unexpected shape")
        cron_jobs = int(cron.get("n", 0))
    state = run_read_only_select(STATE_SELECT, runner)
    if not isinstance(state, dict):
        raise SystemExit("FAIL: sharing state query returned an unexpected shape")
    return {
        "residue": residue,
        "has_cron": has_cron,
        "cron_jobs": cron_jobs,
        "state": state,
    }


def as_int(row: dict, key: str) -> int:
    val = row.get(key)
    return int(val) if val is not None else -1


# A club id is a canonical lowercase UUID. Anything else is malformed and the
# comparison fails closed rather than guessing what was meant.
_UUID_RE = re.compile(r"\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")


def canonical_club_ids(value: object) -> list[str] | None:
    """Canonicalise a club id list for exact set comparison.

    Returns the ids lowercased and sorted, or None when the value cannot be
    trusted: not a list, a non-string element, anything that is not a
    canonical UUID, or a duplicate id. None always fails the assertion; it is
    never treated as "no clubs enabled", which would turn a malformed or
    missing read into a silent pass.

    Sorting is what makes the comparison order independent, so a future
    allowlist of several clubs cannot pass or fail on the order the database
    happened to return.
    """
    if not isinstance(value, list):
        return None
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            return None
        ident = item.strip().lower()
        if not _UUID_RE.match(ident):
            return None
        out.append(ident)
    if len(set(out)) != len(out):
        return None
    return sorted(out)


def expected_enabled_club_ids() -> list[str]:
    """The reviewed allowlist, canonicalised the same way as the hosted read."""
    return sorted(c.strip().lower() for c in EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS)


def assert_absolute_invariants(data: dict) -> list[str]:
    """The checks that hold against FIXED reviewed values, in both phases.

    Deliberately does NOT look at content_shares, content_share_dependencies or
    the content_share audit events. Those are live product state: they are
    preserved across the deploy by compare_state, never pinned to a value. Every
    check here is one a correct deploy can never move.
    """
    errors: list[str] = []
    r = data.get("residue", {})
    checks = {
        "non_internal_drills": 0,
        "non_internal_media": 0,
    }
    for key, want in checks.items():
        got = as_int(r, key)
        if got != want:
            errors.append(f"{key} expected {want}, got {got}")

    # The enabled club set: EXACT equality against the reviewed allowlist.
    # Never a count on its own, never a subset, never a superset.
    expected_ids = expected_enabled_club_ids()
    actual_ids = canonical_club_ids(r.get("enabled_club_ids"))
    if actual_ids is None:
        errors.append(
            "enabled club ids are missing or malformed "
            f"(got {r.get('enabled_club_ids')!r}); expected exactly {expected_ids}"
        )
    elif actual_ids != expected_ids:
        missing = [c for c in expected_ids if c not in actual_ids]
        unexpected = [c for c in actual_ids if c not in expected_ids]
        detail = []
        if unexpected:
            detail.append(f"unexpectedly enabled {unexpected}")
        if missing:
            detail.append(f"expected but not enabled {missing}")
        errors.append(
            "public sharing enabled club set changed: "
            + ", ".join(detail)
            + f" (hosted {actual_ids}, reviewed {expected_ids})"
        )
    # The count is kept as a consistency check on the same read, so a stale or
    # disagreeing count is caught rather than quietly ignored. It never
    # replaces the id assertion above.
    count = as_int(r, "clubs_enabled")
    if count != len(expected_ids):
        errors.append(f"clubs_enabled expected {len(expected_ids)}, got {count}")
    elif actual_ids is not None and count != len(actual_ids):
        errors.append(
            f"clubs_enabled ({count}) disagrees with the enabled club ids returned "
            f"({len(actual_ids)}): {actual_ids}"
        )

    if str(r.get("last_migration")) != EXPECTED_LAST_MIGRATION:
        errors.append(
            f"migration ledger changed: newest is {r.get('last_migration')!r}, "
            f"expected {EXPECTED_LAST_MIGRATION}"
        )
    if int(data.get("cron_jobs", 0)) != 0:
        errors.append(f"a content_share cron job exists (cron_jobs={data.get('cron_jobs')})")
    return errors


# A fingerprint is exactly 32 lowercase hex digits, the shape md5() returns.
# Anything else is malformed and fails closed; it is never coerced or trusted.
_FINGERPRINT_RE = re.compile(r"\A[0-9a-f]{32}\Z")


def canonical_dataset(value: object) -> dict | None:
    """Canonicalise one dataset's {count, fingerprint}, or None if untrustworthy.

    None always fails the caller's assertion. It is never read as "empty
    dataset", which would turn a malformed or missing read into a silent pass,
    the same rule canonical_club_ids follows for the club allowlist.
    """
    if not isinstance(value, dict):
        return None
    count = value.get("count")
    # bool is a subclass of int; True must not read as a count of 1.
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        return None
    fingerprint = value.get("fingerprint")
    if not isinstance(fingerprint, str) or not _FINGERPRINT_RE.match(fingerprint):
        return None
    return {"count": count, "fingerprint": fingerprint}


def canonical_state(value: object) -> dict | None:
    """Canonicalise all three datasets, or None if any one is untrustworthy.

    All or nothing: a state missing one dataset cannot be partially compared,
    because the dataset it is missing is exactly the one a comparison would
    then fail to notice had changed.
    """
    if not isinstance(value, dict):
        return None
    out: dict[str, dict] = {}
    for name in MUTABLE_DATASETS:
        one = canonical_dataset(value.get(name))
        if one is None:
            return None
        out[name] = one
    return out


def build_baseline(state: dict, github_sha: str | None) -> dict:
    """The baseline document. Counts and fingerprints only, by construction.

    Names the two keys it copies rather than copying the dataset dict, so this
    function strips on its own account and does not rely on having been handed
    an already-canonical state. Both layers matter and both are pinned: a test
    that only goes end to end passes as soon as EITHER strips, so it cannot say
    which is doing the work. Replacing this dict literal with dict(state[name])
    left such a test green.
    """
    doc: dict = {
        "format": BASELINE_FORMAT_VERSION,
        "datasets": {
            name: {
                "count": state[name]["count"],
                "fingerprint": state[name]["fingerprint"],
            }
            for name in MUTABLE_DATASETS
        },
    }
    if github_sha:
        doc["github_sha"] = github_sha
    return doc


def write_baseline(path: str, doc: dict) -> None:
    """Write the baseline runner-locally, 0600, never overwriting.

    Refusing an existing file is the point rather than tidiness: a baseline
    already at this path was written by something this run does not know about,
    and silently replacing it would let a POST phase compare against a state
    that was never this deploy's starting point.

    The write goes through a .partial file and os.replace, so a reader never
    sees a half-written baseline. That is not a defence against a racing
    writer: the existence check and the replace are two operations, and a file
    appearing between them would be overwritten. It does not need to be. This
    runs once per job, in that job's own RUNNER_TEMP, under a concurrency group
    that admits one production deploy at a time.
    """
    if os.path.exists(path):
        raise SystemExit(
            f"FAIL: refusing to overwrite an existing baseline at {path}. "
            "Remove it and rerun, or use a fresh path; a stale baseline would "
            "prove the wrong thing."
        )
    partial = f"{path}.partial"
    try:
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit(
            f"FAIL: a partial baseline already exists at {partial}; refusing to "
            "reuse it."
        )
    except OSError as exc:
        raise SystemExit(f"FAIL: cannot create the baseline file: {exc.strerror}")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(partial, path)
    except OSError as exc:
        with contextlib.suppress(OSError):
            os.unlink(partial)
        raise SystemExit(f"FAIL: cannot write the baseline file: {exc.strerror}")


def load_baseline(path: str) -> dict:
    """Read and fully validate a baseline, or fail closed.

    Every rejection below is a case where continuing would compare against
    something that is not a baseline this run wrote, so each one stops the
    deploy rather than degrading to a weaker comparison.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        raise SystemExit(
            f"FAIL: no pre-deploy baseline at {path}. The post-deploy phase "
            "cannot prove the live sharing state is unchanged without the "
            "state captured before the deploy."
        )
    except json.JSONDecodeError:
        raise SystemExit(f"FAIL: the baseline at {path} is not valid JSON")
    except OSError as exc:
        raise SystemExit(f"FAIL: cannot read the baseline at {path}: {exc.strerror}")

    if not isinstance(doc, dict):
        raise SystemExit("FAIL: the baseline is not a JSON object")
    if doc.get("format") != BASELINE_FORMAT_VERSION:
        raise SystemExit(
            f"FAIL: baseline format {doc.get('format')!r}, expected "
            f"{BASELINE_FORMAT_VERSION}"
        )
    datasets = doc.get("datasets")
    if not isinstance(datasets, dict):
        raise SystemExit("FAIL: the baseline carries no datasets object")
    unknown = sorted(set(datasets) - set(MUTABLE_DATASETS))
    if unknown:
        raise SystemExit(f"FAIL: the baseline carries unknown datasets: {unknown}")
    canonical = canonical_state(datasets)
    if canonical is None:
        missing = [n for n in MUTABLE_DATASETS if n not in datasets]
        if missing:
            raise SystemExit(f"FAIL: the baseline is missing datasets: {missing}")
        raise SystemExit(
            "FAIL: the baseline carries a malformed count or fingerprint; a "
            "fingerprint must be 32 lowercase hex digits and a count a "
            "non-negative integer"
        )

    sha = doc.get("github_sha")
    if sha is not None and not isinstance(sha, str):
        raise SystemExit("FAIL: the baseline's github_sha is not a string")
    return {"datasets": canonical, "github_sha": sha}


def assert_baseline_commit(baseline: dict, github_sha: str | None) -> list[str]:
    """Bind the baseline to the checkout that wrote it, when both know it.

    A baseline from a different commit is a baseline from a different run, so
    comparing against it would prove nothing about THIS deploy. Binding is
    skipped only when the pre phase recorded no SHA, which is the case outside
    Actions; it is never skipped merely because the post phase lost its own.
    """
    recorded = baseline.get("github_sha")
    if not recorded:
        return []
    if not github_sha:
        return [
            "the baseline is bound to commit "
            f"{recorded} but this phase has no GITHUB_SHA to compare it with"
        ]
    if recorded != github_sha:
        return [
            f"the baseline was captured on commit {recorded}, but this phase is "
            f"running on {github_sha}"
        ]
    return []


def compare_state(baseline: dict, current: dict) -> list[str]:
    """Require every dataset to be byte-identical to the baseline.

    Reports WHICH dataset moved and, for a count change, by how much. It never
    reports a row: the verifier holds no row to report, having only ever
    received two scalars per dataset from the server.
    """
    errors: list[str] = []
    for name in MUTABLE_DATASETS:
        was = baseline[name]
        now = current[name]
        if was["count"] != now["count"]:
            errors.append(
                f"{name} changed during deploy: count {was['count']} -> {now['count']}"
            )
        elif was["fingerprint"] != now["fingerprint"]:
            errors.append(
                f"{name} changed during deploy: same row count ({now['count']}) "
                "but the row contents differ from the pre-deploy baseline"
            )
    return errors


def main(argv: list[str]) -> int:
    sample = ""
    phase = "post"
    baseline_out = ""
    baseline_in = ""
    i = 1
    while i < len(argv):
        if argv[i] == "--sample" and i + 1 < len(argv):
            sample = argv[i + 1]
            i += 2
        elif argv[i] == "--phase" and i + 1 < len(argv):
            phase = argv[i + 1]
            if phase not in ("pre", "post"):
                print(f"FAIL: --phase must be pre or post, got {phase!r}")
                return 1
            i += 2
        elif argv[i] == "--baseline-out" and i + 1 < len(argv):
            baseline_out = argv[i + 1]
            i += 2
        elif argv[i] == "--baseline-in" and i + 1 < len(argv):
            baseline_in = argv[i + 1]
            i += 2
        else:
            print(f"FAIL: unknown argument {argv[i]}")
            return 1

    if baseline_out and phase != "pre":
        print("FAIL: --baseline-out is only meaningful with --phase pre")
        return 1
    if baseline_in and phase != "post":
        print("FAIL: --baseline-in is only meaningful with --phase post")
        return 1
    # The post phase REQUIRES a baseline. Without one it has nothing to prove
    # the sharing state against, and a phase that quietly skipped its own
    # comparison would report PASS having checked less than it claims. The pre
    # phase's flag is not required in the same way: a pre run that writes no
    # baseline leaves the post phase with nothing to load, which fails closed
    # there rather than passing here.
    if phase == "post" and not baseline_in:
        print(
            "FAIL: --phase post requires --baseline-in <path>; the live sharing "
            "state cannot be proved unchanged without the pre-deploy baseline"
        )
        return 1

    if sample:
        with open(sample, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = gather()

    github_sha = os.environ.get("GITHUB_SHA") or None
    r = data.get("residue", {})
    state = canonical_state(data.get("state"))

    print("Hosted state before deploy:" if phase == "pre" else "Hosted state after deploy:")
    print(f"  clubs with public_sharing_enabled : {as_int(r, 'clubs_enabled')}")
    print(f"    enabled club ids                : {r.get('enabled_club_ids')}")
    print(f"    reviewed allowlist              : {expected_enabled_club_ids()}")
    print(f"  drills not internal_only          : {as_int(r, 'non_internal_drills')} "
          f"(of {as_int(r, 'total_drills')})")
    print(f"  media not internal_only           : {as_int(r, 'non_internal_media')} "
          f"(of {as_int(r, 'total_media')})")
    print(f"  newest migration version          : {r.get('last_migration')}")
    print(f"  content_share cron jobs           : {data.get('cron_jobs', 0)} "
          f"(pg_cron present: {data.get('has_cron')})")
    # Counts only. The fingerprints are never printed: they are a derived
    # summary of live sharing rows and belong in the runner-local baseline
    # alone, not in a log a person can read or a summary GitHub retains.
    print("Live sharing state (preserved across the deploy, never pinned):")
    if state is None:
        print("  content_shares rows               : unavailable")
        print("  content_share_dependencies rows   : unavailable")
        print("  content_share audit events        : unavailable")
    else:
        print(f"  content_shares rows               : {state['content_shares']['count']}")
        print(f"  content_share_dependencies rows   : "
              f"{state['content_share_dependencies']['count']}")
        print(f"  content_share audit events        : "
              f"{state['content_share_audit_events']['count']}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sfh:
            heading = (
                "Pre-deploy hosted gates and live sharing baseline"
                if phase == "pre"
                else "Post-deploy hosted gates and live sharing comparison"
            )
            sfh.write(f"\n### {heading}\n\n")
            sfh.write("| Check | Value | Expected |\n|---|---|---|\n")
            sfh.write(
                f"| clubs public_sharing_enabled | {as_int(r,'clubs_enabled')} | "
                f"{len(expected_enabled_club_ids())} |\n"
            )
            sfh.write(
                f"| enabled club ids | {canonical_club_ids(r.get('enabled_club_ids'))} | "
                f"{expected_enabled_club_ids()} |\n"
            )
            sfh.write(f"| drills not internal_only | {as_int(r,'non_internal_drills')} | 0 |\n")
            sfh.write(f"| media not internal_only | {as_int(r,'non_internal_media')} | 0 |\n")
            sfh.write(f"| newest migration | {r.get('last_migration')} | {EXPECTED_LAST_MIGRATION} |\n")
            sfh.write(f"| content_share cron jobs | {data.get('cron_jobs',0)} | 0 |\n")
            if state is not None:
                expectation = (
                    "baselined" if phase == "pre" else "unchanged from baseline"
                )
                for name in MUTABLE_DATASETS:
                    sfh.write(
                        f"| {name} rows | {state[name]['count']} | {expectation} |\n"
                    )
            sfh.write("\n")

    errors = assert_absolute_invariants(data)
    if state is None:
        errors.append(
            "the live sharing state read is missing or malformed; a count must "
            "be a non-negative integer and a fingerprint 32 lowercase hex digits"
        )

    # The absolute gates decide first, in BOTH phases. In the pre phase that
    # ordering is load bearing: no baseline is written unless the hosted state
    # is one this commit was reviewed against, so a refused run leaves nothing
    # behind for a later run to compare against by mistake.
    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1

    if phase == "pre":
        if baseline_out:
            write_baseline(baseline_out, build_baseline(state, github_sha))
            print(
                "PASS: absolute hosted-state gates passed and the live sharing "
                "baseline was captured; safe to deploy"
            )
        else:
            print(
                "PASS: absolute hosted-state gates passed (no --baseline-out "
                "given, so no baseline was captured)"
            )
        return 0

    baseline = load_baseline(baseline_in)
    errors = assert_baseline_commit(baseline, github_sha)
    errors += compare_state(baseline["datasets"], state)
    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1
    print(
        "PASS: absolute hosted-state gates still hold and live sharing state is "
        "unchanged from the pre-deploy baseline"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
