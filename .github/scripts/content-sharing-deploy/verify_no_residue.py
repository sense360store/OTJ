#!/usr/bin/env python3
"""Read-only proof that the deploy left no hosted residue (STAGE 9).

Runs a small set of SELECT-only queries through the Supabase Management API
(POST /v1/projects/{ref}/database/query) and asserts the sharing feature is
still fully inert:

  - public_sharing_enabled is false for every club;
  - content_shares has zero rows;
  - content_share_dependencies has zero rows;
  - no content_share audit event exists;
  - every drill is internal_only;
  - every media row is internal_only;
  - the migration ledger's newest version is still 0039 (public_share_read);
  - no pg_cron job references content_share (no cleanup schedule was created).

The access token is read from SUPABASE_ACCESS_TOKEN and used only in the
Authorization header; it is never printed. Queries are read only. For local
testing pass --sample <file> holding the gathered results object.

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


def run_query(ref: str, sql: str) -> list[dict]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise SystemExit("FAIL: SUPABASE_ACCESS_TOKEN is not set")
    url = f"{API_BASE}/v1/projects/{ref}/database/query"
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"FAIL: database query API returned HTTP {exc.code}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"FAIL: could not reach database query API: {exc.reason}")
    doc = json.loads(body)
    if isinstance(doc, dict) and "result" in doc:
        doc = doc["result"]
    if not isinstance(doc, list):
        raise SystemExit("FAIL: unexpected database query response shape")
    return doc


def gather(ref: str) -> dict:
    residue = run_query(ref, RESIDUE_SQL)[0]
    has_cron = bool(run_query(ref, HAS_CRON_SQL)[0].get("has_cron"))
    cron_jobs = 0
    if has_cron:
        cron_jobs = int(run_query(ref, CRON_JOBS_SQL)[0].get("n", 0))
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
