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
import pathlib
import re
import tempfile
import unittest
import urllib.error

import verify_inventory as vi

TOKEN_SENTINEL = "sk-TEST-TOKEN-SHOULD-NEVER-BE-PRINTED-000"

# A well-formed ELEVEN-function CLI list, verify_jwt present and correct: the
# nine authenticated functions plus the two sharing ones. Written out rather
# than derived from vi.EXPECTED on purpose. Deriving it would make the
# happy-path test tautological, since the fixture would agree with the pin by
# construction whatever the pin said; this is a second, independent statement
# of the production inventory, and test_the_fixture_and_the_pin_agree below is
# what reports it if the two ever drift.
ELEVEN_VALID = [
    {"slug": "invite-user", "verify_jwt": True, "version": 15, "updated_at": "2026-07-01T00:00:00Z", "ezbr_sha256": "aa"},
    {"slug": "fa-import", "verify_jwt": True, "version": 15, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "bb"},
    {"slug": "fa-import-programme", "verify_jwt": True, "version": 14, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "cc"},
    {"slug": "remove-user", "verify_jwt": True, "version": 9, "updated_at": "2026-07-01T00:00:00Z", "ezbr_sha256": "dd"},
    {"slug": "spond-sync", "verify_jwt": True, "version": 9, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "ee"},
    {"slug": "spond-roster-import", "verify_jwt": True, "version": 10, "updated_at": "2026-06-01T00:00:00Z", "ezbr_sha256": "ff"},
    {"slug": "spond-link-members", "verify_jwt": True, "version": 4, "updated_at": "2026-08-17T10:52:25Z", "ezbr_sha256": "55"},
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
    def test_the_exact_eleven_function_inventory_passes(self):
        code, out = run_cli(ELEVEN_VALID)
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)
        self.assertIn("JWT posture verified from CLI metadata", out)
        # The count in the PASS line is derived from EXPECTED, not written out
        # again, so a future addition cannot leave a stale number behind.
        self.assertIn(f"{len(vi.EXPECTED)} functions present", out)
        self.assertEqual(len(ELEVEN_VALID), 11)

    def test_valid_json_wrapped_in_object_passes(self):
        # Defensive: some CLI/API shapes wrap the array under a key.
        code, out = run_cli({"functions": ELEVEN_VALID})
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)


class TestFailureModes(unittest.TestCase):
    def test_missing_manage_content_share_fails(self):
        payload = [f for f in ELEVEN_VALID if f["slug"] != "manage-content-share"]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("missing function(s)", out)
        self.assertIn("manage-content-share", out)

    def test_unexpected_function_fails(self):
        payload = ELEVEN_VALID + [{"slug": "rogue-fn", "verify_jwt": True, "version": 1}]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("unexpected function(s) deployed", out)
        self.assertIn("rogue-fn", out)

    def test_wrong_jwt_posture_fails(self):
        # read-content-share must be anonymous; flip it to verify_jwt=true.
        payload = json.loads(json.dumps(ELEVEN_VALID))
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
        payload = json.loads(json.dumps(ELEVEN_VALID))
        for fn in payload:
            if fn["slug"] == "manage-content-share":
                fn["verify_jwt"] = False
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("only anonymous function", out)

    def test_missing_spond_link_members_fails(self):
        """The new pin must bite in the missing direction as well.

        Adding a slug to an allowlist is only half a reconciliation: if the
        function then disappears from hosted, the gate has to notice.
        """
        payload = [f for f in ELEVEN_VALID if f["slug"] != "spond-link-members"]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("missing function(s)", out)
        self.assertIn("spond-link-members", out)
        self.assertIn(f"expected {len(vi.EXPECTED)} functions, found 10", out)

    def test_spond_link_members_anonymous_fails(self):
        """It is an authenticated function and must stay one.

        Two assertions catch this independently: its own verify_jwt pin, and
        the rule that read-content-share is the only anonymous function. Both
        are checked here so neither can be quietly removed.
        """
        payload = json.loads(json.dumps(ELEVEN_VALID))
        for fn in payload:
            if fn["slug"] == "spond-link-members":
                fn["verify_jwt"] = False
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("spond-link-members: verify_jwt expected True, got False", out)
        self.assertIn("only anonymous function", out)

    def test_read_content_share_remains_the_only_anonymous_function(self):
        """Stated over the pin itself, not only over a fixture.

        A fixture can be edited to agree with a mistake. This asserts the
        reviewed allowlist carries exactly one anonymous entry, so widening the
        anonymous surface fails here even if every fixture were updated to
        match.
        """
        anonymous = sorted(slug for slug, jwt in vi.EXPECTED.items() if jwt is False)
        self.assertEqual(anonymous, ["read-content-share"])
        fixture_anonymous = sorted(
            fn["slug"] for fn in ELEVEN_VALID if fn["verify_jwt"] is False
        )
        self.assertEqual(fixture_anonymous, ["read-content-share"])

    def test_an_unknown_function_alongside_spond_link_members_still_fails(self):
        """Reconciling one function must not make the gate tolerant of another.

        This is the failure the reconciliation is answering, so it is worth
        proving that the answer was "add the reviewed slug" and not "stop
        minding extra slugs".
        """
        payload = ELEVEN_VALID + [
            {"slug": "spond-link-members-v2", "verify_jwt": True, "version": 1}
        ]
        code, out = run_cli(payload)
        self.assertEqual(code, 1)
        self.assertIn("unexpected function(s) deployed", out)
        self.assertIn("spond-link-members-v2", out)
        self.assertIn(f"expected {len(vi.EXPECTED)} functions, found 12", out)

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
        payload = [{k: v for k, v in fn.items() if k != "verify_jwt"} for fn in ELEVEN_VALID]
        code, out = run_cli(payload)
        self.assertEqual(code, 0, out)
        self.assertIn("deferred to smoke tests", out)
        self.assertIn("NOTE:", out)

    def test_absent_metadata_still_fails_on_missing_function(self):
        payload = [
            {k: v for k, v in fn.items() if k != "verify_jwt"}
            for fn in ELEVEN_VALID
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
            code, out = run_cli(ELEVEN_VALID)
        finally:
            del os.environ["SUPABASE_ACCESS_TOKEN"]
        self.assertEqual(code, 0, out)
        self.assertNotIn(TOKEN_SENTINEL, out)


class TestInventoryPinIsReconciled(unittest.TestCase):
    """Guards against the drift that caused GitHub Actions run 32480333370.

    spond-link-members was added to the repository and deployed on 17 August
    2026 through its own gated workflow. This pin was not reconciled with it,
    and the next content-sharing deploy failed at the inventory step with both
    sharing functions already deployed. Nothing in the build said so first.
    """

    def test_the_pin_holds_exactly_eleven_functions(self):
        self.assertEqual(len(vi.EXPECTED), 11)

    def test_the_fixture_and_the_pin_agree(self):
        """The fixture is an independent statement; report drift, do not hide it."""
        self.assertEqual(
            sorted(fn["slug"] for fn in ELEVEN_VALID), sorted(vi.EXPECTED)
        )
        for fn in ELEVEN_VALID:
            self.assertIs(
                fn["verify_jwt"], vi.EXPECTED[fn["slug"]],
                f"{fn['slug']}: fixture and pin disagree on verify_jwt",
            )

    def test_expected_matches_the_repositorys_edge_functions(self):
        """Every deployable function directory must be in the pin, and vice versa.

        This is the tripwire that was missing. Adding
        supabase/functions/<slug>/ without reconciling EXPECTED now fails the
        build at review time instead of at a production deploy.

        What it cannot catch, stated rather than implied: a function that
        exists on hosted but not in this repository. Nothing in the repository
        can see that, and it is precisely what the inventory gate itself
        catches at deploy time by comparing the pin against the live CLI list.

        Directories beginning with an underscore are shared modules, not
        deployable functions, and are excluded.
        """
        root = pathlib.Path(vi.__file__).resolve().parents[3]
        functions_dir = root / "supabase" / "functions"
        self.assertTrue(functions_dir.is_dir(), f"not found: {functions_dir}")
        on_disk = sorted(
            d.name for d in functions_dir.iterdir()
            if d.is_dir() and not d.name.startswith("_")
        )
        self.assertTrue(on_disk, "found no function directories to compare")
        self.assertEqual(
            on_disk, sorted(vi.EXPECTED),
            "the reviewed inventory pin and supabase/functions/ disagree. "
            "Adding an Edge Function means reconciling EXPECTED in "
            "verify_inventory.py, even when the function is unrelated to "
            "content sharing and has its own gated deploy workflow.",
        )

    def test_every_pinned_function_declares_its_jwt_posture_in_config(self):
        """config.toml and the pin must not disagree about the anonymous one.

        Only functions with an explicit [functions.<slug>] block are checked;
        the deployer's default is verify_jwt = true and the pin agrees with
        that default for the rest. A block saying false for anything but
        read-content-share, or true for read-content-share, fails here.
        """
        root = pathlib.Path(vi.__file__).resolve().parents[3]
        config = (root / "supabase" / "config.toml").read_text(encoding="utf-8")
        declared = dict(
            re.findall(
                r"\[functions\.([\w-]+)\]\s*\n\s*verify_jwt\s*=\s*(true|false)",
                config,
            )
        )
        self.assertIn("read-content-share", declared,
                      "config.toml no longer declares read-content-share's posture")
        for slug, value in declared.items():
            if slug not in vi.EXPECTED:
                continue
            self.assertIs(
                value == "true", vi.EXPECTED[slug],
                f"{slug}: config.toml says verify_jwt = {value}, the pin says "
                f"{vi.EXPECTED[slug]}",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
