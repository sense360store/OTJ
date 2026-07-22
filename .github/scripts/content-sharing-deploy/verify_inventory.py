#!/usr/bin/env python3
"""Verify the deployed Edge Function inventory and JWT posture (STAGE 7).

Fetches the project's function list from the Supabase Management API
(GET /v1/projects/{ref}/functions), which returns a verify_jwt flag per
function, and asserts:

  - exactly the ten expected functions exist (no more, no fewer);
  - manage-content-share verify_jwt = true;
  - read-content-share verify_jwt = false;
  - the other eight functions verify_jwt = true;
  - read-content-share is the ONLY anonymous (verify_jwt=false) function.

It also records each function's version and updated_at, and the deployed bundle
fingerprint (eszip sha256) for the two sharing functions, into
GITHUB_STEP_SUMMARY.

The access token is read from SUPABASE_ACCESS_TOKEN in the environment and used
only in the Authorization header; it is never printed. For local testing pass
--sample <file> with a representative functions JSON array instead of calling
the network.

Usage:
  verify_inventory.py --ref <project_ref>
  verify_inventory.py --sample <functions.json>   # offline, for local tests
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

EXPECTED = {
    "fa-import": True,
    "fa-import-programme": True,
    "feedback-github-refresh": True,
    "feedback-to-github": True,
    "invite-user": True,
    "manage-content-share": True,
    "read-content-share": False,
    "remove-user": True,
    "spond-roster-import": True,
    "spond-sync": True,
}
SHARING = ("manage-content-share", "read-content-share")
API_BASE = "https://api.supabase.com"


def fetch_functions(ref: str) -> list[dict]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise SystemExit("FAIL: SUPABASE_ACCESS_TOKEN is not set")
    url = f"{API_BASE}/v1/projects/{ref}/functions"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # Never echo the response body wholesale (defensive); report status only.
        raise SystemExit(f"FAIL: functions API returned HTTP {exc.code}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"FAIL: could not reach functions API: {exc.reason}")
    doc = json.loads(body)
    if isinstance(doc, dict) and "functions" in doc:
        doc = doc["functions"]
    if not isinstance(doc, list):
        raise SystemExit("FAIL: unexpected functions API response shape")
    return doc


def load_sample(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    if isinstance(doc, dict) and "functions" in doc:
        doc = doc["functions"]
    return doc


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

    functions = load_sample(sample) if sample else fetch_functions(ref)

    by_slug: dict[str, dict] = {}
    for fn in functions:
        slug = fn.get("slug") or fn.get("name")
        if isinstance(slug, str):
            by_slug[slug] = fn

    errors: list[str] = []

    got = set(by_slug)
    want = set(EXPECTED)
    missing = sorted(want - got)
    unexpected = sorted(got - want)
    if missing:
        errors.append(f"missing function(s): {missing}")
    if unexpected:
        errors.append(f"unexpected function(s) deployed: {unexpected}")
    if len(by_slug) != len(EXPECTED):
        errors.append(f"expected {len(EXPECTED)} functions, found {len(by_slug)}")

    anon = []
    for slug, want_verify in EXPECTED.items():
        fn = by_slug.get(slug)
        if fn is None:
            continue
        vj = fn.get("verify_jwt")
        if vj is not want_verify:
            errors.append(f"{slug}: verify_jwt expected {want_verify}, got {vj!r}")
        if vj is False:
            anon.append(slug)

    # Also count anon across ALL deployed functions, not just expected ones.
    all_anon = sorted(s for s, fn in by_slug.items() if fn.get("verify_jwt") is False)
    if all_anon != ["read-content-share"]:
        errors.append(f"read-content-share must be the only anonymous function; found: {all_anon}")

    # Summary table.
    lines = ["\n### Deployed function inventory\n",
             "| Function | verify_jwt | version | updated_at |",
             "|---|---|---|---|"]
    for slug in sorted(by_slug):
        fn = by_slug[slug]
        lines.append(
            f"| `{slug}` | `{fn.get('verify_jwt')}` | `{fn.get('version', '?')}` | "
            f"`{fn.get('updated_at', '?')}` |"
        )
    lines.append("")
    lines.append("### Sharing function bundle fingerprints\n")
    lines.append("| Function | eszip sha256 | version |")
    lines.append("|---|---|---|")
    for slug in SHARING:
        fn = by_slug.get(slug, {})
        lines.append(
            f"| `{slug}` | `{fn.get('ezbr_sha256', 'n/a')}` | `{fn.get('version', '?')}` |"
        )
    summary = "\n".join(lines) + "\n"
    print(summary)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sfh:
            sfh.write(summary)

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1
    print("PASS: ten functions present, JWT posture correct, "
          "read-content-share is the only anonymous function")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
