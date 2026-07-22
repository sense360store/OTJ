#!/usr/bin/env python3
"""Tests for verify_no_residue.py.

Runs offline with the standard library only:

    python3 .github/scripts/content-sharing-deploy/test_verify_no_residue.py

Covers a clean result, dirty residue, the token model (required, no fallback
to SUPABASE_ACCESS_TOKEN), the HTTP 401/403 messages, malformed responses,
secret safety, and the SELECT-only guard.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error

import verify_no_residue as vr

READ_TOKEN_SENTINEL = "sbp_READ_TOKEN_SHOULD_NEVER_BE_PRINTED_000"
ACCESS_TOKEN_SENTINEL = "sbp_ACCESS_TOKEN_MUST_NEVER_BE_USED_111"

CLEAN_RESIDUE = {
    "clubs_enabled": 0,
    "shares": 0,
    "deps": 0,
    "share_audit": 0,
    "non_internal_drills": 0,
    "non_internal_media": 0,
    "total_drills": 103,
    "total_media": 111,
    "last_migration": vr.EXPECTED_LAST_MIGRATION,
}


class FakeResponse:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def make_opener(by_sql):
    """Return an opener that answers each POST from a SQL-keyed dict.

    Keys are matched by a substring of the request body's query. Records the
    requests it saw on the returned function's `.seen` list.
    """
    captured = []

    def opener(req, timeout=30):
        captured.append(req)
        body = req.data.decode("utf-8")
        query = json.loads(body)["query"]
        for needle, rows in by_sql.items():
            if needle in query:
                return FakeResponse(json.dumps(rows))
        return FakeResponse(json.dumps([]))

    opener.seen = captured
    return opener


def clean_opener(residue=None):
    residue = residue or CLEAN_RESIDUE
    return make_opener({
        "content_shares": [residue],          # the RESIDUE_SQL block
        "to_regclass('cron.job')": [{"has_cron": False}],
    })


@contextlib.contextmanager
def read_token(value=READ_TOKEN_SENTINEL):
    prior = os.environ.get(vr.TOKEN_ENV)
    if value is None:
        os.environ.pop(vr.TOKEN_ENV, None)
    else:
        os.environ[vr.TOKEN_ENV] = value
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop(vr.TOKEN_ENV, None)
        else:
            os.environ[vr.TOKEN_ENV] = prior


class TestCleanResult(unittest.TestCase):
    def test_gather_clean_passes(self):
        with read_token():
            data = vr.gather("someref", opener=clean_opener())
        self.assertEqual(vr.assert_clean(data), [])

    def test_endpoint_is_read_only_variant(self):
        opener = clean_opener()
        with read_token():
            vr.gather("myref", opener=opener)
        for req in opener.seen:
            self.assertTrue(
                req.full_url.endswith("/projects/myref/database/query/read-only"),
                req.full_url,
            )
            self.assertEqual(req.get_method(), "POST")
            self.assertEqual(
                req.headers.get("Authorization"), f"Bearer {READ_TOKEN_SENTINEL}"
            )

    def test_sample_file_clean_passes(self):
        data = {"residue": CLEAN_RESIDUE, "has_cron": False, "cron_jobs": 0}
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                code = vr.main(["verify_no_residue.py", "--sample", path])
        finally:
            os.remove(path)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("PASS", buf.getvalue())


class TestDirtyResidue(unittest.TestCase):
    def test_share_present_fails(self):
        dirty = dict(CLEAN_RESIDUE, shares=1)
        with read_token():
            data = vr.gather("ref", opener=clean_opener(dirty))
        errors = vr.assert_clean(data)
        self.assertTrue(any("shares expected 0, got 1" in e for e in errors), errors)

    def test_enabled_club_fails(self):
        dirty = dict(CLEAN_RESIDUE, clubs_enabled=2)
        self.assertTrue(
            any("clubs_enabled" in e for e in vr.assert_clean({"residue": dirty}))
        )

    def test_migration_ledger_moved_fails(self):
        dirty = dict(CLEAN_RESIDUE, last_migration="20260722070000")
        self.assertTrue(
            any("migration ledger changed" in e for e in vr.assert_clean({"residue": dirty}))
        )

    def test_cron_job_present_fails(self):
        opener = make_opener({
            "content_shares": [CLEAN_RESIDUE],
            "to_regclass('cron.job')": [{"has_cron": True}],
            "command ilike": [{"n": 1}],
        })
        with read_token():
            data = vr.gather("ref", opener=opener)
        self.assertEqual(data["cron_jobs"], 1)
        self.assertTrue(any("cron job exists" in e for e in vr.assert_clean(data)))

    def test_non_internal_content_fails(self):
        dirty = dict(CLEAN_RESIDUE, non_internal_drills=3, non_internal_media=4)
        errors = vr.assert_clean({"residue": dirty})
        self.assertTrue(any("non_internal_drills" in e for e in errors))
        self.assertTrue(any("non_internal_media" in e for e in errors))


class TestTokenModel(unittest.TestCase):
    def test_missing_token_fails_clearly(self):
        with read_token(None):
            with self.assertRaises(SystemExit) as ctx:
                vr.get_token()
        msg = str(ctx.exception.code)
        self.assertIn(vr.TOKEN_ENV, msg)
        self.assertIn("never falls back", msg)

    def test_no_fallback_to_access_token(self):
        # ACCESS token present, READ token absent -> must still fail.
        prior = os.environ.get("SUPABASE_ACCESS_TOKEN")
        os.environ["SUPABASE_ACCESS_TOKEN"] = ACCESS_TOKEN_SENTINEL
        try:
            with read_token(None):
                with self.assertRaises(SystemExit) as ctx:
                    vr.run_query("ref", vr.HAS_CRON_SQL, opener=clean_opener())
        finally:
            if prior is None:
                os.environ.pop("SUPABASE_ACCESS_TOKEN", None)
            else:
                os.environ["SUPABASE_ACCESS_TOKEN"] = prior
        self.assertNotIn(ACCESS_TOKEN_SENTINEL, str(ctx.exception.code))
        self.assertIn(vr.TOKEN_ENV, str(ctx.exception.code))

    def test_source_never_reads_access_token_from_env(self):
        # The name may appear in the docstring explaining the non-fallback, but
        # it must never be looked up from the environment.
        import inspect
        src = inspect.getsource(vr)
        self.assertNotIn('get("SUPABASE_ACCESS_TOKEN"', src)
        self.assertNotIn('["SUPABASE_ACCESS_TOKEN"', src)
        self.assertNotIn("getenv('SUPABASE_ACCESS_TOKEN'", src)
        self.assertNotIn("getenv(\"SUPABASE_ACCESS_TOKEN\"", src)


class TestHttpErrors(unittest.TestCase):
    def _raise(self, code, body=b'{"message":"x","token":"leaky"}'):
        def opener(req, timeout=30):
            raise urllib.error.HTTPError(
                url=req.full_url, code=code, msg="e", hdrs=None, fp=io.BytesIO(body)
            )
        return opener

    def test_401_message(self):
        with read_token():
            with self.assertRaises(SystemExit) as ctx:
                vr.run_query("ref", vr.HAS_CRON_SQL, opener=self._raise(401))
        msg = str(ctx.exception.code)
        self.assertIn("401", msg)
        self.assertIn("unauthorized", msg)

    def test_403_message_mentions_scope_and_no_substitute(self):
        with read_token():
            with self.assertRaises(SystemExit) as ctx:
                vr.run_query("ref", vr.HAS_CRON_SQL, opener=self._raise(403))
        msg = str(ctx.exception.code)
        self.assertIn("403", msg)
        self.assertIn("database_read", msg)
        self.assertNotEqual(vr.http_error_message(401), vr.http_error_message(403))

    def test_error_never_leaks_token_or_body(self):
        with read_token():
            with self.assertRaises(SystemExit) as ctx:
                vr.run_query("ref", vr.HAS_CRON_SQL, opener=self._raise(403))
        msg = str(ctx.exception.code)
        self.assertNotIn(READ_TOKEN_SENTINEL, msg)
        self.assertNotIn("leaky", msg)


class TestMalformedResponse(unittest.TestCase):
    def test_non_json_body_fails(self):
        def opener(req, timeout=30):
            return FakeResponse("this is not json")
        with read_token():
            with self.assertRaises(SystemExit) as ctx:
                vr.run_query("ref", vr.HAS_CRON_SQL, opener=opener)
        self.assertIn("non-JSON", str(ctx.exception.code))

    def test_wrong_shape_fails(self):
        def opener(req, timeout=30):
            return FakeResponse(json.dumps({"message": "permission denied"}))
        with read_token():
            with self.assertRaises(SystemExit) as ctx:
                vr.run_query("ref", vr.HAS_CRON_SQL, opener=opener)
        self.assertIn("unexpected", str(ctx.exception.code))


class TestSelectOnlyGuard(unittest.TestCase):
    def test_shipped_queries_are_select_only(self):
        for sql in (vr.RESIDUE_SQL, vr.HAS_CRON_SQL, vr.CRON_JOBS_SQL):
            vr.assert_select_only(sql)  # must not raise

    def test_write_statement_rejected(self):
        for bad in (
            "delete from public.content_shares",
            "update public.clubs set public_sharing_enabled = true",
            "drop table public.drills",
            "select 1; drop table public.media",
        ):
            with self.assertRaises(SystemExit, msg=bad):
                vr.assert_select_only(bad)

    def test_guard_runs_before_network(self):
        # A write must be rejected without ever invoking the opener.
        def opener(req, timeout=30):
            raise AssertionError("opener must not be called for a write")
        with read_token():
            with self.assertRaises(SystemExit):
                vr.run_query("ref", "delete from public.drills", opener=opener)


class TestNoSecretPrinted(unittest.TestCase):
    def test_token_never_appears_in_output(self):
        buf = io.StringIO()
        with read_token():
            data = vr.gather("ref", opener=clean_opener())
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh)
        try:
            with read_token():
                with contextlib.redirect_stdout(buf):
                    code = vr.main(["verify_no_residue.py", "--sample", path])
        finally:
            os.remove(path)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertNotIn(READ_TOKEN_SENTINEL, buf.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
