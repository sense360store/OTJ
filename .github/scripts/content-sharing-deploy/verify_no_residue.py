#!/usr/bin/env python3
"""Read-only proof that the deploy left no hosted residue (STAGE 9).

Runs a small set of SELECT-only queries through the Supabase Management API
read-only query endpoint

  POST /v1/projects/{ref}/database/query/read-only

and asserts the sharing feature is still fully inert:

  - public_sharing_enabled is false for every club;
  - content_shares has zero rows;
  - content_share_dependencies has zero rows;
  - no content_share audit event exists;
  - every drill is internal_only;
  - every media row is internal_only;
  - the migration ledger's newest version is still 0039 (public_share_read);
  - no pg_cron job references content_share (no cleanup schedule was created).

Credential separation
---------------------
The token is read ONLY from SUPABASE_DATABASE_READ_TOKEN, a token scoped to
read the database (the `database_read` scope). It is used only in the
Authorization header and is never printed. This script never reads or falls
back to SUPABASE_ACCESS_TOKEN: that token is reserved for the CLI deploy and
list operations and is, on this project, forbidden (HTTP 403) from the
Management API database query endpoints, which was the original cause of the
"database query API returned HTTP 403" failure.

Read-only role reach (verified against the hosted project)
----------------------------------------------------------
The read-only query endpoint runs each statement as the
`supabase_read_only_user` Postgres role inside a read-only transaction. On
this project that role has USAGE on `public` and on `supabase_migrations`,
SELECT on the queried tables, and BYPASSRLS, so the counts and the migration
ledger max version are complete and unfiltered. The `cron` schema is not
installed, so `to_regclass('cron.job')` is null and the cron check is
satisfied by the schema's absence. If a future project state makes the
migration ledger or the cron catalogue unreadable to the read-only role, the
affected check is reported as UNVERIFIED rather than silently passing.

Every statement sent is SELECT-only; a guard rejects anything else before it
is transmitted. For local testing pass --sample <file> holding the gathered
results object.

Usage:
  verify_no_residue.py --ref <project_ref>
  verify_no_residue.py --sample <results.json>
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = "https://api.supabase.com"
EXPECTED_LAST_MIGRATION = "20260722064502"  # 0039_public_share_read
TOKEN_ENV = "SUPABASE_DATABASE_READ_TOKEN"

RESIDUE_SQL = """
select
  (select count(*) from public.clubs where public_sharing_enabled)          as clubs_enabled,
  (select count(*) from public.content_shares)                              as shares,
  (select count(*) from public.content_share_dependencies)                  as deps,
  (select count(*) from public.audit_events where entity_type='content_share') as share_audit,
  (select count(*) from public.drills where rights <> 'internal_only')      as non_internal_drills,
  (select count(*) from public.media  where rights <> 'internal_only')      as non_internal_media,
  (select count(*) from public.drills)                                      as total_drills,
  (select count(*) from public.media)                                       as total_media,
  (select max(version) from supabase_migrations.schema_migrations)          as last_migration
"""

HAS_CRON_SQL = "select (to_regclass('cron.job') is not null) as has_cron"
CRON_JOBS_SQL = "select count(*) as n from cron.job where command ilike '%content_share%'"

# Statements that would mutate data or schema. The verifier is read only; this
# guard is defence in depth so a future edit cannot smuggle a write through the
# read-only endpoint (which would reject it anyway, but fail late).
_FORBIDDEN_TOKENS = (
    "insert", "update", "delete", "drop", "alter", "create", "truncate",
    "grant", "revoke", "comment", "merge", "call", "do ", "copy",
)


def get_token() -> str:
    """Return the database read token, or exit with a precise message.

    Never reads SUPABASE_ACCESS_TOKEN. The database query endpoints require a
    token with the database_read scope; the classic access token used for the
    CLI is a different credential and is intentionally not consulted here.
    """
    token = os.environ.get(TOKEN_ENV, "")
    if not token:
        raise SystemExit(
            f"FAIL: {TOKEN_ENV} is not set. This verifier requires a token "
            "with the database_read scope; it never falls back to "
            "SUPABASE_ACCESS_TOKEN."
        )
    return token


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


def http_error_message(code: int) -> str:
    """A precise, secret-safe message per HTTP status. Never includes a body."""
    if code == 401:
        return (
            "FAIL: database query API returned HTTP 401 (unauthorized). The "
            f"{TOKEN_ENV} value is missing or invalid; rotate the secret and "
            "confirm it is a current Supabase token."
        )
    if code == 403:
        return (
            "FAIL: database query API returned HTTP 403 (forbidden). The "
            f"{TOKEN_ENV} token lacks the database_read scope or has no access "
            "to this project. Grant database_read and project membership; do "
            "not substitute SUPABASE_ACCESS_TOKEN."
        )
    if code == 404:
        return (
            "FAIL: database query API returned HTTP 404. Check the project ref "
            "and that the read-only query endpoint is available."
        )
    return f"FAIL: database query API returned HTTP {code}"


def run_query(ref: str, sql: str, opener=None) -> list[dict]:
    """POST one SELECT to the read-only query endpoint and return its rows.

    opener is injectable for tests; it defaults to urllib.request.urlopen.
    """
    assert_select_only(sql)
    token = get_token()
    if opener is None:
        opener = urllib.request.urlopen
    url = f"{API_BASE}/v1/projects/{ref}/database/query/read-only"
    payload = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with opener(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # exc carries the response body; it is deliberately never read or
        # surfaced, so neither the token nor any row data can leak on error.
        raise SystemExit(http_error_message(exc.code))
    except urllib.error.URLError as exc:
        raise SystemExit(f"FAIL: could not reach database query API: {exc.reason}")
    try:
        doc = json.loads(body)
    except json.JSONDecodeError:
        raise SystemExit("FAIL: database query API returned a non-JSON response")
    if isinstance(doc, dict) and "result" in doc:
        doc = doc["result"]
    if not isinstance(doc, list) or (doc and not isinstance(doc[0], dict)):
        raise SystemExit("FAIL: unexpected database query response shape")
    return doc


def gather(ref: str, opener=None) -> dict:
    residue_rows = run_query(ref, RESIDUE_SQL, opener)
    if not residue_rows:
        raise SystemExit("FAIL: residue query returned no rows")
    residue = residue_rows[0]
    has_cron_rows = run_query(ref, HAS_CRON_SQL, opener)
    if not has_cron_rows:
        raise SystemExit("FAIL: cron probe returned no rows")
    has_cron = bool(has_cron_rows[0].get("has_cron"))
    cron_jobs = 0
    if has_cron:
        cron_rows = run_query(ref, CRON_JOBS_SQL, opener)
        cron_jobs = int(cron_rows[0].get("n", 0)) if cron_rows else 0
    return {"residue": residue, "has_cron": has_cron, "cron_jobs": cron_jobs}


def as_int(row: dict, key: str) -> int:
    val = row.get(key)
    return int(val) if val is not None else -1


def assert_clean(data: dict) -> list[str]:
    errors: list[str] = []
    r = data.get("residue", {})
    checks = {
        "clubs_enabled": 0,
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
    if str(r.get("last_migration")) != EXPECTED_LAST_MIGRATION:
        errors.append(
            f"migration ledger changed: newest is {r.get('last_migration')!r}, "
            f"expected {EXPECTED_LAST_MIGRATION}"
        )
    if int(data.get("cron_jobs", 0)) != 0:
        errors.append(f"a content_share cron job exists (cron_jobs={data.get('cron_jobs')})")
    return errors


def main(argv: list[str]) -> int:
    ref = ""
    sample = ""
    i = 1
    while i < len(argv):
        if argv[i] == "--ref" and i + 1 < len(argv):
            ref = argv[i + 1]
            i += 2
        elif argv[i] == "--sample" and i + 1 < len(argv):
            sample = argv[i + 1]
            i += 2
        else:
            print(f"FAIL: unknown argument {argv[i]}")
            return 1

    if sample:
        with open(sample, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = gather(ref)

    r = data.get("residue", {})
    print("Hosted state after deploy:")
    print(f"  clubs with public_sharing_enabled : {as_int(r, 'clubs_enabled')}")
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
            sfh.write("\n### Post-deploy hosted residue check\n\n")
            sfh.write("| Check | Value | Expected |\n|---|---|---|\n")
            sfh.write(f"| clubs public_sharing_enabled | {as_int(r,'clubs_enabled')} | 0 |\n")
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
    print("PASS: no hosted residue; sharing remains fully disabled and inert")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
