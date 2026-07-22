#!/usr/bin/env python3
"""Tests for verify_inventory.py.

Runs offline with the standard library only:

    python3 .github/scripts/content-sharing-deploy/test_verify_inventory.py

Covers the CLI-JSON verification path, the strict failure modes, the direct
Management API 403 fallback message, and the secret-safety guarantee.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error

import verify_inventory as vi

TOKEN_SENTINEL = "sk-TEST-TOKEN-SHOULD-NEVER-BE-PRINTED-000"

# A well-formed ten-function CLI list, verify_jwt present and correct.
TEN_VALID = [
    {"slug": "invite-user", "verify_jwt": True, "version": 15, "updated_at": "2026-07-01T00:00:00Z", "ezbr_sha256": "aa"},
    {"slug": "fa-import", "verify_jwt": True, "version": 15, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "bb"},
    {"slug": "fa-import-programme", "verify_jwt": True, "version": 14, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "cc"},
    {"slug": "remove-user", "verify_jwt": True, "version": 9, "updated_at": "2026-07-01T00:00:00Z", "ezbr_sha256": "dd"},
    {"slug": "spond-sync", "verify_jwt": True, "version": 9, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "ee"},
    {"slug": "spond-roster-import", "verify_jwt": True, "version": 10, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "ff"},
    {"slug": "feedback-to-github", "verify_jwt": True, "version": 5, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "11"},
    {"slug": "feedback-github-refresh", "verify_jwt": True, "version": 1, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "22"},
    {"slug": "manage-content-share", "verify_jwt": True, "version": 1, "updated_at": "2026-07-22T00:00:00Z", "ezbr_sha256": "33"},
    {"slug": "read-content-share", "verify_jwt": False, "version": 2, "updated_at": "2026-07-22T00:00:00Z", "ezbr_sha256": "44"},
]


def write_json(payload) -> str:
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        if isinstance(payload, str):
            fh.write(payload)
        else:
            json.dump(payload, fh)
    return path


def run_cli(payload) -> tuple[int, str]:
    """Run main(--cli-json <tmp>) and return (exit_code, stdout)."""
    path = write_json(payload)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = vi.main(["verify_inventory.py", "--cli-json", path])
    except SystemExit as exc:  # parse failures raise SystemExit
        code = exc.code if isinstance(exc.code, int) else 1
        return code, buf.getvalue() + str(exc.code if not isinstance(exc.code, int) else "")
    finally:
        os.remove(path)
    return code, buf.getvalue()


class TestValidInventory(unittest.TestCase):
    def test_valid_ten_function_cli_json_passes(self):
        code, out = run_cli(TEN_VALID)
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)
        self.assertIn("JWT posture verified from CLI metadata", out)

    def test_valid_json_wrapped_in_object_passes(self):
        # Defensive: some CLI/API shapes wrap the array under a key.
        code, out = run_cli({"functions": TEN_VALID})
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)


class TestFailureModes(unittest.TestCase):
    def test_missing_manage_content_share_fails(self):
        payload = [f for f in TEN_VALID if f["slug"] != "manage-content-share"]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("missing function(s)", out)
        self.assertIn("manage-content-share", out)

    def test_unexpected_function_fails(self):
        payload = TEN_VALID + [{"slug": "rogue-fn", "verify_jwt": True, "version": 1}]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("unexpected function(s) deployed", out)
        self.assertIn("rogue-fn", out)

    def test_wrong_jwt_posture_fails(self):
        # read-content-share must be anonymous; flip it to verify_jwt=true.
        payload = json.loads(json.dumps(TEN_VALID))
        for fn in payload:
            if fn["slug"] == "read-content-share":
                fn["verify_jwt"] = True
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("read-content-share", out)
        self.assertTrue(
            "verify_jwt expected False" in out
            or "only anonymous function" in out,
            out,
        )

    def test_second_anonymous_function_fails(self):
        payload = json.loads(json.dumps(TEN_VALID))
        for fn in payload:
            if fn["slug"] == "manage-content-share":
                fn["verify_jwt"] = False
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("only anonymous function", out)

    def test_malformed_cli_response_fails(self):
        # Not JSON at all.
        code, out = run_cli("this is not json")
        self.assertEqual(code, 1)
        self.assertIn("could not parse", out)

    def test_malformed_json_wrong_shape_fails(self):
        # Valid JSON, but not an array of functions.
        code, out = run_cli({"message": "permission denied"})
        self.assertEqual(code, 1)
        self.assertIn("unexpected", out)


class TestJwtMetadataAbsent(unittest.TestCase):
    def test_absent_verify_jwt_defers_to_smoke_tests(self):
        # A CLI build that omits verify_jwt: inventory still verified, JWT
        # posture not claimed (deferred), overall PASS on inventory.
        payload = [{k: v for k, v in fn.items() if k != "verify_jwt"} for fn in TEN_VALID]
        code, out = run_cli(payload)
        self.assertEqual(code, 0, out)
        self.assertIn("deferred to smoke tests", out)
        self.assertIn("NOTE:", out)

    def test_absent_metadata_still_fails_on_missing_function(self):
        payload = [
            {k: v for k, v in fn.items() if k != "verify_jwt"}
            for fn in TEN_VALID
            if fn["slug"] != "spond-sync"
        ]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("missing function(s)", out)


class TestDirectApiFallback(unittest.TestCase):
    def test_http_403_message_distinct_and_not_a_deploy_failure(self):
        msg = vi.http_error_message(403)
        self.assertIn("403", msg)
        self.assertIn("does NOT by itself mean the deploy failed", msg)
        self.assertIn("--cli-json", msg)

    def test_http_401_message_distinct_from_403(self):
        msg401 = vi.http_error_message(401)
        msg403 = vi.http_error_message(403)
        self.assertIn("401", msg401)
        self.assertIn("unauthorized", msg401)
        self.assertNotEqual(msg401, msg403)

    def test_direct_fetch_403_raises_clean_message_no_secret(self):
        os.environ["SUPABASE_ACCESS_TOKEN"] = TOKEN_SENTINEL

        def fake_urlopen(req, timeout=30):
            raise urllib.error.HTTPError(
                url="https://api.supabase.com/v1/projects/ref/functions",
                code=403,
                msg="Forbidden",
                hdrs=None,
                fp=io.BytesIO(b'{"message":"forbidden","token":"leaky"}'),
            )

        orig = vi.urllib.request.urlopen
        vi.urllib.request.urlopen = fake_urlopen
        try:
            with self.assertRaises(SystemExit) as ctx:
                vi.fetch_functions_direct("someref")
        finally:
            vi.urllib.request.urlopen = orig
            del os.environ["SUPABASE_ACCESS_TOKEN"]
        message = str(ctx.exception.code)
        self.assertIn("403", message)
        self.assertNotIn(TOKEN_SENTINEL, message)
        self.assertNotIn("leaky", message)  # response body never surfaced


class TestNoSecretPrinted(unittest.TestCase):
    def test_token_never_appears_in_output(self):
        os.environ["SUPABASE_ACCESS_TOKEN"] = TOKEN_SENTINEL
        try:
            code, out = run_cli(TEN_VALID)
        finally:
            del os.environ["SUPABASE_ACCESS_TOKEN"]
        self.assertEqual(code, 0, out)
        self.assertNotIn(TOKEN_SENTINEL, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
