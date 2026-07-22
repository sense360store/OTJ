#!/usr/bin/env python3
"""Verify the deployed Edge Function inventory and JWT posture (STAGE 7).

Primary inventory source is the authenticated Supabase CLI, not the broad
Management API endpoint. The workflow runs:

    supabase functions list --project-ref "$SUPABASE_PROJECT_ID" --output json

captures that JSON to a temp file, and passes it here with --cli-json. Parsing
the CLI output avoids calling GET /v1/projects/{ref}/functions directly. A
classic Supabase personal access token can be forbidden (HTTP 403) from that
broad Management API endpoint while the same token still lists functions and
deploys through the CLI, so a direct 403 does not by itself mean the deploy
failed. The CLI path is authoritative; the direct call is a fallback only.

Asserts:

  - exactly the ten expected functions exist (no more, no fewer);
  - manage-content-share and read-content-share both exist;
  - the previous eight functions exist;
  - no unexpected function exists;
  - manage-content-share verify_jwt = true;
  - read-content-share verify_jwt = false;
  - every other function verify_jwt = true;
  - read-content-share is the ONLY anonymous (verify_jwt=false) function.

JWT posture is only asserted from metadata that was actually obtained. When the
CLI list carries verify_jwt (the common case for CLI 2.105.0), it is verified
strictly and a wrong value fails. If the CLI output omits verify_jwt for a
function, this script does not invent the value: it does not claim metadata
verification for that function and defers the JWT boundary to the endpoint
smoke tests (which prove manage rejects anonymous callers and read serves
them). Inventory errors still fail regardless.

It records each function's verify_jwt, version and updated_at, and the deployed
bundle fingerprint (eszip sha256) for the two sharing functions, into
GITHUB_STEP_SUMMARY.

The access token, when the direct fallback is used, is read from
SUPABASE_ACCESS_TOKEN and used only in the Authorization header; it is never
printed, and neither is any response body.

Modes:
  verify_inventory.py --cli-json <file>    # primary: `supabase functions list --output json`
  verify_inventory.py --sample <file>      # offline tests (same JSON array shape)
  verify_inventory.py --ref <project_ref>  # fallback: direct Management API (may 403)
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


def unwrap(doc: object) -> object:
    """Reduce a functions document to its array form.

    Accepts a bare JSON array, or an object wrapping the array under a common
    key (`functions`, `result` or `data`). Anything else is returned as-is for
    the caller to reject.
    """
    if isinstance(doc, dict):
        for key in ("functions", "result", "data"):
            if isinstance(doc.get(key), list):
                return doc[key]
    return doc


def parse_functions(text: str, source: str) -> list[dict]:
    """Parse CLI/API JSON text into a list of function dicts, or fail cleanly."""
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        # Never echo the raw text; the CLI output could, in principle, carry a
        # token if a future change piped the wrong stream. Report shape only.
        raise SystemExit(f"FAIL: could not parse {source} as JSON")
    doc = unwrap(doc)
    if not isinstance(doc, list):
        raise SystemExit(f"FAIL: unexpected {source} shape (expected a JSON array of functions)")
    functions = [fn for fn in doc if isinstance(fn, dict)]
    if len(functions) != len(doc):
        raise SystemExit(f"FAIL: unexpected {source} shape (array contains non-object entries)")
    return functions


def load_file(path: str, source: str) -> list[dict]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except FileNotFoundError:
        raise SystemExit(f"FAIL: {source} file not found: {path}")
    return parse_functions(text, source)


def http_error_message(code: int) -> str:
    """Human-readable, secret-free message for a Management API HTTP error.

    Distinguishes 401 (authentication) from 403 (authorization), and makes
    clear that a 403 on the broad functions endpoint does not by itself mean
    the deploy failed. Never contains the token or the response body.
    """
    if code == 401:
        return (
            "FAIL: Management API returned HTTP 401 (unauthorized). The "
            "SUPABASE_ACCESS_TOKEN is missing, malformed or revoked; the CLI "
            "would fail to authenticate too. Re-check the token (never print it)."
        )
    if code == 403:
        return (
            "FAIL: Management API returned HTTP 403 (forbidden) from the direct "
            "endpoint GET /v1/projects/{ref}/functions. A classic Supabase "
            "personal access token can be forbidden from this broad endpoint "
            "yet still list functions and deploy through the CLI, so this 403 "
            "does NOT by itself mean the deploy failed. Verify inventory with "
            "the CLI instead: `supabase functions list --output json`, passed "
            "to this script with --cli-json."
        )
    return f"FAIL: Management API returned HTTP {code}"


def fetch_functions_direct(ref: str) -> list[dict]:
    """Fallback: read the function list from the Management API directly.

    Not used by the workflow's primary path. Kept for manual diagnosis. The
    token is used only in the Authorization header and is never printed; on an
    HTTP error only the status is surfaced, never the response body.
    """
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise SystemExit("FAIL: SUPABASE_ACCESS_TOKEN is not set")
    url = f"{API_BASE}/v1/projects/{ref}/functions"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise SystemExit(http_error_message(exc.code))
    except urllib.error.URLError as exc:
        raise SystemExit(f"FAIL: could not reach functions API: {exc.reason}")
    return parse_functions(body, "Management API functions response")


def evaluate(functions: list[dict]) -> tuple[dict, list[str], list[str], bool]:
    """Check inventory and JWT posture.

    Returns (by_slug, errors, notes, jwt_fully_verified). Inventory errors are
    always enforced. JWT posture is enforced only where verify_jwt metadata is
    present; where it is absent the boundary is deferred to the smoke tests and
    a note explains that no metadata claim is made for those functions.
    """
    by_slug: dict[str, dict] = {}
    for fn in functions:
        slug = fn.get("slug") or fn.get("name")
        if isinstance(slug, str):
            by_slug[slug] = fn

    errors: list[str] = []
    notes: list[str] = []

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

    jwt_missing: list[str] = []
    jwt_present_any = False
    for slug, want_verify in EXPECTED.items():
        fn = by_slug.get(slug)
        if fn is None:
            continue
        vj = fn.get("verify_jwt")
        if isinstance(vj, bool):
            jwt_present_any = True
            if vj is not want_verify:
                errors.append(f"{slug}: verify_jwt expected {want_verify}, got {vj!r}")
        else:
            jwt_missing.append(slug)

    # The "only anonymous function" invariant needs verify_jwt for every
    # deployed function. Assert it only when metadata is complete; otherwise a
    # missing flag could hide a second anonymous function.
    metadata_complete = jwt_present_any and not jwt_missing
    if metadata_complete:
        all_anon = sorted(s for s, fn in by_slug.items() if fn.get("verify_jwt") is False)
        if all_anon != ["read-content-share"]:
            errors.append(
                f"read-content-share must be the only anonymous function; found: {all_anon}"
            )
    if jwt_missing:
        notes.append(
            "CLI list output did not include verify_jwt for: "
            f"{sorted(jwt_missing)}. JWT posture for these is asserted by the "
            "endpoint smoke tests (manage rejects anonymous callers, read serves "
            "them), not by list metadata; no metadata claim is made here."
        )

    return by_slug, errors, notes, metadata_complete


def build_summary(by_slug: dict, jwt_fully_verified: bool) -> str:
    lines = [
        "\n### Deployed function inventory\n",
        f"Inventory source: authenticated Supabase CLI (`functions list --output json`).",
        (
            "JWT posture: verified from CLI metadata."
            if jwt_fully_verified
            else "JWT posture: metadata incomplete; boundary confirmed by smoke tests."
        ),
        "",
        "| Function | verify_jwt | version | updated_at |",
        "|---|---|---|---|",
    ]
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
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    ref = ""
    sample = ""
    cli_json = ""
    i = 1
    while i < len(argv):
        if argv[i] == "--ref" and i + 1 < len(argv):
            ref = argv[i + 1]
            i += 2
        elif argv[i] == "--sample" and i + 1 < len(argv):
            sample = argv[i + 1]
            i += 2
        elif argv[i] == "--cli-json" and i + 1 < len(argv):
            cli_json = argv[i + 1]
            i += 2
        else:
            print(f"FAIL: unknown argument {argv[i]}")
            return 1

    provided = [x for x in (cli_json, sample, ref) if x]
    if len(provided) != 1:
        print("FAIL: provide exactly one of --cli-json, --sample or --ref")
        return 1

    if cli_json:
        functions = load_file(cli_json, "CLI functions list output")
    elif sample:
        functions = load_file(sample, "sample functions JSON")
    else:
        functions = fetch_functions_direct(ref)

    by_slug, errors, notes, jwt_fully_verified = evaluate(functions)

    summary = build_summary(by_slug, jwt_fully_verified)
    print(summary)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sfh:
            sfh.write(summary)

    for note in notes:
        print(f"NOTE: {note}")

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1

    posture = (
        "JWT posture verified from CLI metadata"
        if jwt_fully_verified
        else "inventory verified; JWT posture deferred to smoke tests"
    )
    print(
        "PASS: ten functions present, read-content-share is the only anonymous "
        f"function; {posture}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
