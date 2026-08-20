#!/usr/bin/env python3
"""Read-only proof that the deploy left no hosted residue (STAGE 9).

Runs a small set of SELECT-only queries through psql against a full PostgreSQL
connection string and asserts the hosted sharing state is exactly the reviewed
one and no share machinery has been left behind:

  - the set of clubs with public_sharing_enabled is EXACTLY the reviewed
    allowlist of club ids (see EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS);
  - content_shares has zero rows;
  - content_share_dependencies has zero rows;
  - no content_share audit event exists;
  - every drill is internal_only;
  - every media row is internal_only;
  - the migration ledger's newest version is exactly EXPECTED_LAST_MIGRATION,
    currently 20260817104226 (0049, spond_team_reconcile);
  - no pg_cron job references content_share (no cleanup schedule was created).

Runs TWICE in the deploy workflow, with identical assertions:

  --phase pre    before either function is deployed. A wrong ledger version or a
                 dirty hosted state stops the workflow while both functions are
                 still untouched, so a deploy is never made against a schema it
                 was not reviewed against.
  --phase post   after the deploy (the original use), proving the deploy itself
                 left no residue.

The assertion on the ledger version is an EXACT equality in both phases. It is
never relaxed to a >=, a prefix match or an "exists somewhere" check: the point
is to prove the hosted schema is precisely the reviewed one, and a loose check
would pass against an unreviewed migration.

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
  verify_no_residue.py [--phase pre|post]
  verify_no_residue.py --sample <results.json> [--phase pre|post]
"""
from __future__ import annotations

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
# (.github/workflows/apply-production-migration.yml) records: created_by names
# the workflow and the commit it ran from,
# 694e1922e69552ff8f98310ae79d0cdcd99f76fd; idempotency_key holds
# otj:migration:0049_spond_team_reconcile against a UNIQUE column, so the same
# migration cannot be applied twice; and md5(statements[1]) is
# d9d2199dcaabbc2da9248489754dc28a, the reviewed file with its trailing newline
# stripped. The workflow's own post-apply gate asserted all of that, and it was
# confirmed again independently before this constant moved.
#
# The structural readback proves the reviewed object was actually created:
# public.spond_reconcile_player_team exists, is SECURITY DEFINER, and takes the
# six arguments 0049 declares (p_player_id, p_expected_team_id,
# p_target_team_id, p_expected_member_id, p_confirm_member_id, p_batch_id).
# That is the SHAPE the migration declares rather than merely a matching name,
# which matters because a name alone would be satisfied by an unrelated object.
#
# What that readback does NOT establish is the other half of "0049 adds one
# function and NOTHING else": no table, column, index, policy, grant or trigger
# was probed here, so nothing in it could tell a 0049 that added only the
# function from one that added the function and something more. That property
# is proved by 0049's own in-migration self-verification, which fingerprints
# the schema before and after inside the apply. It is a different mechanism and
# this block does not claim it.
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
READ_ONLY_PREAMBLE = (
    "begin;\n"
    "set transaction read only;\n"
    "set local statement_timeout = '30s';\n"
)
READ_ONLY_EPILOGUE = "rollback;\n"

# All eight residue facts plus the cron-schema probe, emitted as one JSON object.
# count(*) renders as a JSON number; max(version) is text and renders as a JSON
# string; has_cron is a JSON boolean.
RESIDUE_SELECT = """select json_build_object(
  'clubs_enabled',       (select count(*) from public.clubs where public_sharing_enabled),
  'enabled_club_ids',    (select coalesce(json_agg(c.id::text order by c.id::text), '[]'::json)
                          from public.clubs c where c.public_sharing_enabled),
  'shares',              (select count(*) from public.content_shares),
  'deps',                (select count(*) from public.content_share_dependencies),
  'share_audit',         (select count(*) from public.audit_events where entity_type='content_share'),
  'non_internal_drills', (select count(*) from public.drills where rights <> 'internal_only'),
  'non_internal_media',  (select count(*) from public.media  where rights <> 'internal_only'),
  'total_drills',        (select count(*) from public.drills),
  'total_media',         (select count(*) from public.media),
  'last_migration',      (select max(version) from supabase_migrations.schema_migrations),
  'has_cron',            (to_regclass('cron.job') is not null)
)"""

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
    return {"residue": residue, "has_cron": has_cron, "cron_jobs": cron_jobs}


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


def assert_clean(data: dict) -> list[str]:
    errors: list[str] = []
    r = data.get("residue", {})
    checks = {
        "shares": 0,
        "deps": 0,
        "share_audit": 0,
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


def main(argv: list[str]) -> int:
    sample = ""
    phase = "post"
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
        else:
            print(f"FAIL: unknown argument {argv[i]}")
            return 1

    if sample:
        with open(sample, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = gather()

    r = data.get("residue", {})
    print("Hosted state before deploy:" if phase == "pre" else "Hosted state after deploy:")
    print(f"  clubs with public_sharing_enabled : {as_int(r, 'clubs_enabled')}")
    print(f"    enabled club ids                : {r.get('enabled_club_ids')}")
    print(f"    reviewed allowlist              : {expected_enabled_club_ids()}")
    print(f"  content_shares rows               : {as_int(r, 'shares')}")
    print(f"  content_share_dependencies rows   : {as_int(r, 'deps')}")
    print(f"  content_share audit events        : {as_int(r, 'share_audit')}")
    print(f"  drills not internal_only          : {as_int(r, 'non_internal_drills')} "
          f"(of {as_int(r, 'total_drills')})")
    print(f"  media not internal_only           : {as_int(r, 'non_internal_media')} "
          f"(of {as_int(r, 'total_media')})")
    print(f"  newest migration version          : {r.get('last_migration')}")
    print(f"  content_share cron jobs           : {data.get('cron_jobs', 0)} "
          f"(pg_cron present: {data.get('has_cron')})")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sfh:
            heading = (
                "Pre-deploy hosted ledger and inert-state check"
                if phase == "pre"
                else "Post-deploy hosted residue check"
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
            sfh.write(f"| content_shares rows | {as_int(r,'shares')} | 0 |\n")
            sfh.write(f"| content_share_dependencies rows | {as_int(r,'deps')} | 0 |\n")
            sfh.write(f"| content_share audit events | {as_int(r,'share_audit')} | 0 |\n")
            sfh.write(f"| drills not internal_only | {as_int(r,'non_internal_drills')} | 0 |\n")
            sfh.write(f"| media not internal_only | {as_int(r,'non_internal_media')} | 0 |\n")
            sfh.write(f"| newest migration | {r.get('last_migration')} | {EXPECTED_LAST_MIGRATION} |\n")
            sfh.write(f"| content_share cron jobs | {data.get('cron_jobs',0)} | 0 |\n\n")

    errors = assert_clean(data)
    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1
    if phase == "pre":
        print("PASS: hosted ledger and enabled club set are the reviewed ones, and no share residue exists; safe to deploy")
    else:
        print("PASS: no hosted residue; the enabled club set is unchanged and no share was created")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
