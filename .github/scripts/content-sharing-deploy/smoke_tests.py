#!/usr/bin/env python3
"""Safe post-deploy endpoint smoke tests (STAGE 8). Creates no public share.

manage-content-share (authenticated, verify_jwt=true):
  - POST with no Authorization header is rejected (gateway 401);
  - POST with a malformed bearer token is rejected (gateway 401);
  so anonymous callers never reach application logic.

read-content-share (anonymous, verify_jwt=false):
  - OPTIONS from a disallowed origin never receives that origin (and never '*');
  - OPTIONS from the approved APP_ORIGIN echoes exactly that origin (only when
    APP_ORIGIN_EXPECTED is provided);
  - POST with a well-shaped but unknown shareId and a random, never-printed
    secret returns the neutral {"status":"unavailable"} with Cache-Control:
    no-store, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer and
    no database error, SQLSTATE, stack trace, table name or secret in the body;
  - an unsupported method (GET) is rejected (405).

A real secret is never sent; a random value is generated and never printed.
Request bodies are never logged.

Env:
  SUPABASE_PROJECT_ID   used to build https://<ref>.supabase.co/functions/v1/...
  MANAGE_URL, READ_URL  optional explicit overrides
  APP_ORIGIN_EXPECTED   optional; enables the positive CORS assertion
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request
import uuid

DISALLOWED_ORIGIN = "https://disallowed.invalid"

# Substrings that must never appear in the anonymous reader's response body.
FORBIDDEN_SUBSTRINGS = [
    "sqlstate", "syntax error", "stack", "traceback", "pg_", "postgres",
    "relation ", "content_shares", "content_share_dependencies", "token_hash",
    "service_role", "duplicate key", "constraint",
]


def http(method: str, url: str, headers: dict | None = None, data: bytes | None = None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode(), {k.lower(): v for k, v in resp.headers.items()}, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return None, {}, f"URLERROR: {exc.reason}"


class Results:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}{(' - ' + detail) if detail else ''}")
        if not ok:
            self.failures.append(name)


def test_manage(url: str, r: Results) -> None:
    print("manage-content-share (must reject anonymous):")
    body = json.dumps({"action": "status", "sourceId": str(uuid.uuid4())}).encode()

    status, _, _ = http("POST", url, {"Content-Type": "application/json"}, body)
    r.check("no Authorization header rejected (401)", status == 401, f"status={status}")

    status, _, _ = http(
        "POST", url,
        {"Content-Type": "application/json", "Authorization": "Bearer not.a.valid.jwt"},
        body,
    )
    r.check("malformed bearer token rejected (401)", status == 401, f"status={status}")


def test_read(url: str, r: Results) -> None:
    print("read-content-share (anonymous reader):")

    # OPTIONS from a disallowed origin.
    status, headers, _ = http("OPTIONS", url, {"Origin": DISALLOWED_ORIGIN,
                                               "Access-Control-Request-Method": "POST"})
    allow = headers.get("access-control-allow-origin")
    r.check("OPTIONS handled (200)", status == 200, f"status={status}")
    r.check("disallowed origin not echoed as allowed",
            allow != DISALLOWED_ORIGIN and allow != "*", f"allow-origin={allow!r}")

    # OPTIONS from the approved origin (only when we know it).
    expected_origin = os.environ.get("APP_ORIGIN_EXPECTED", "").strip()
    if expected_origin:
        _, headers, _ = http("OPTIONS", url, {"Origin": expected_origin,
                                              "Access-Control-Request-Method": "POST"})
        allow = headers.get("access-control-allow-origin")
        r.check("approved APP_ORIGIN echoed exactly", allow == expected_origin,
                f"allow-origin={allow!r}")
    else:
        print("  [skip] approved-origin assertion (APP_ORIGIN_EXPECTED not provided)")

    # POST with a well-shaped, unknown share and a random secret (never printed).
    share_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(32)  # generated, never logged
    body = json.dumps({"shareId": share_id, "secret": secret}).encode()
    status, headers, text = http("POST", url, {"Content-Type": "application/json"}, body)
    del secret, body  # drop the secret promptly

    r.check("unknown share returns 200", status == 200, f"status={status}")

    neutral = False
    try:
        parsed = json.loads(text)
        neutral = isinstance(parsed, dict) and set(parsed.keys()) == {"status"} and parsed.get("status") == "unavailable"
    except json.JSONDecodeError:
        neutral = False
    r.check("neutral unavailable body only", neutral,
            "unexpected body shape" if not neutral else "")

    r.check("Cache-Control: no-store", headers.get("cache-control") == "no-store",
            f"got={headers.get('cache-control')!r}")
    r.check("X-Content-Type-Options: nosniff", headers.get("x-content-type-options") == "nosniff",
            f"got={headers.get('x-content-type-options')!r}")
    r.check("Referrer-Policy: no-referrer", headers.get("referrer-policy") == "no-referrer",
            f"got={headers.get('referrer-policy')!r}")

    low = text.lower()
    leaked = [s for s in FORBIDDEN_SUBSTRINGS if s in low]
    r.check("no db error / table name / secret in body", not leaked,
            f"leaked={leaked}" if leaked else "")

    # Unsupported method.
    status, _, _ = http("GET", url)
    r.check("unsupported method rejected (405)", status == 405, f"status={status}")


def main() -> int:
    ref = os.environ.get("SUPABASE_PROJECT_ID", "").strip()
    base = f"https://{ref}.supabase.co/functions/v1" if ref else ""
    manage_url = os.environ.get("MANAGE_URL") or (f"{base}/manage-content-share" if base else "")
    read_url = os.environ.get("READ_URL") or (f"{base}/read-content-share" if base else "")
    if not manage_url or not read_url:
        print("FAIL: could not determine function URLs (set SUPABASE_PROJECT_ID or MANAGE_URL/READ_URL)")
        return 1

    r = Results()
    test_manage(manage_url, r)
    test_read(read_url, r)

    if r.failures:
        print(f"\nFAIL: {len(r.failures)} smoke check(s) failed: {r.failures}")
        return 1
    print("\nPASS: all smoke checks passed; no share created")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
