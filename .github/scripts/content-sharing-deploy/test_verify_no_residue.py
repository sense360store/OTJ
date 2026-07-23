#!/usr/bin/env python3
"""Tests for verify_no_residue.py.

Runs offline with the standard library only, mocking the psql runner so no
network or database is touched:

    python3 .github/scripts/content-sharing-deploy/test_verify_no_residue.py

Covers a clean result, every dirty residue condition, a changed migration, a
cron job present, a missing DB URL, authentication and connection failure,
malformed output, the read-only transaction commands, the forbidden-SQL guard,
the absence of COMMIT, no DB URL or password leakage, and no fallback to either
Supabase API token.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest

import verify_no_residue as vr

DB_URL_SENTINEL = "postgresql://postgres.abcd:S3cretPass@aws-0-eu.pooler.supabase.com:5432/postgres"
DB_PASSWORD_SENTINEL = "S3cretPass"
ACCESS_TOKEN_SENTINEL = "sbp_ACCESS_TOKEN_MUST_NEVER_BE_USED_111"
READ_TOKEN_SENTINEL = "sbp_READ_TOKEN_MUST_NEVER_BE_USED_222"

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
    "has_cron": False,
}


def make_runner(residue=None, cron_n=None, rc=0, stderr="", stdout=None):
    """Return a fake psql runner and record the scripts it was handed.

    Answers the residue script with `residue` and the cron script with
    `{"n": cron_n}`. When `rc` is non-zero the runner returns it with `stderr`.
    A literal `stdout` overrides JSON generation (for malformed-output tests).
    """
    residue = residue if residue is not None else dict(CLEAN_RESIDUE)
    seen = []

    def runner(script, db_url):
        seen.append({"script": script, "db_url": db_url})
        if rc != 0:
            return rc, "", stderr
        if stdout is not None:
            return 0, stdout, ""
        if "content_shares" in script:
            return 0, json.dumps(residue) + "\n", ""
        if "cron.job" in script:
            return 0, json.dumps({"n": cron_n or 0}) + "\n", ""
        return 0, "{}\n", ""

    runner.seen = seen
    return runner


@contextlib.contextmanager
def db_url(value=DB_URL_SENTINEL):
    prior = os.environ.get(vr.DB_URL_ENV)
    if value is None:
        os.environ.pop(vr.DB_URL_ENV, None)
    else:
        os.environ[vr.DB_URL_ENV] = value
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop(vr.DB_URL_ENV, None)
        else:
            os.environ[vr.DB_URL_ENV] = prior


class TestCleanResult(unittest.TestCase):
    def test_gather_clean_passes(self):
        with db_url():
            data = vr.gather(runner=make_runner())
        self.assertEqual(vr.assert_clean(data), [])

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


class TestReadOnlyTransaction(unittest.TestCase):
    def test_script_has_read_only_commands(self):
        script = vr.build_script(vr.RESIDUE_SELECT).lower()
        self.assertIn("begin;", script)
        self.assertIn("set transaction read only;", script)
        self.assertIn("set local statement_timeout = '30s';", script)
        self.assertIn("rollback;", script)

    def test_script_never_commits(self):
        for select in (vr.RESIDUE_SELECT, vr.CRON_JOBS_SELECT):
            self.assertNotIn("commit", vr.build_script(select).lower())

    def test_runner_receives_read_only_script(self):
        runner = make_runner()
        with db_url():
            vr.gather(runner=runner)
        for call in runner.seen:
            s = call["script"].lower()
            self.assertIn("set transaction read only", s)
            self.assertIn("rollback;", s)
            self.assertNotIn("commit", s)


class TestDirtyResidue(unittest.TestCase):
    def test_enabled_club_fails(self):
        dirty = dict(CLEAN_RESIDUE, clubs_enabled=2)
        self.assertTrue(
            any("clubs_enabled" in e for e in vr.assert_clean({"residue": dirty}))
        )

    def test_share_present_fails(self):
        dirty = dict(CLEAN_RESIDUE, shares=1)
        with db_url():
            data = vr.gather(runner=make_runner(residue=dirty))
        errors = vr.assert_clean(data)
        self.assertTrue(any("shares expected 0, got 1" in e for e in errors), errors)

    def test_dependencies_present_fails(self):
        dirty = dict(CLEAN_RESIDUE, deps=5)
        self.assertTrue(any("deps" in e for e in vr.assert_clean({"residue": dirty})))

    def test_share_audit_present_fails(self):
        dirty = dict(CLEAN_RESIDUE, share_audit=7)
        self.assertTrue(
            any("share_audit" in e for e in vr.assert_clean({"residue": dirty}))
        )

    def test_non_internal_content_fails(self):
        dirty = dict(CLEAN_RESIDUE, non_internal_drills=3, non_internal_media=4)
        errors = vr.assert_clean({"residue": dirty})
        self.assertTrue(any("non_internal_drills" in e for e in errors))
        self.assertTrue(any("non_internal_media" in e for e in errors))

    def test_migration_ledger_moved_fails(self):
        dirty = dict(CLEAN_RESIDUE, last_migration="20260722070000")
        self.assertTrue(
            any("migration ledger changed" in e for e in vr.assert_clean({"residue": dirty}))
        )

    def test_cron_job_present_fails(self):
        cron_residue = dict(CLEAN_RESIDUE, has_cron=True)
        runner = make_runner(residue=cron_residue, cron_n=1)
        with db_url():
            data = vr.gather(runner=runner)
        self.assertEqual(data["cron_jobs"], 1)
        self.assertTrue(any("cron job exists" in e for e in vr.assert_clean(data)))

    def test_cron_schema_absent_passes(self):
        # has_cron false: the cron count query must not run at all.
        runner = make_runner()
        with db_url():
            data = vr.gather(runner=runner)
        self.assertEqual(data["cron_jobs"], 0)
        # The cron-count query (the only one that reads from cron.job) never runs.
        self.assertFalse(any("content_share%" in c["script"] for c in runner.seen))


class TestDbUrlModel(unittest.TestCase):
    def test_missing_db_url_fails_clearly(self):
        with db_url(None):
            with self.assertRaises(SystemExit) as ctx:
                vr.get_db_url()
        msg = str(ctx.exception.code)
        self.assertIn(vr.DB_URL_ENV, msg)
        self.assertIn("never falls back", msg)

    def test_gather_without_db_url_fails(self):
        with db_url(None):
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=make_runner())
        self.assertIn(vr.DB_URL_ENV, str(ctx.exception.code))

    def test_no_fallback_to_api_tokens_in_source(self):
        import inspect
        src = inspect.getsource(vr)
        for name in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_DATABASE_READ_TOKEN"):
            self.assertNotIn(f'get("{name}"', src)
            self.assertNotIn(f'["{name}"', src)
            self.assertNotIn(f"getenv('{name}'", src)
            self.assertNotIn(f'getenv("{name}"', src)

    def test_source_makes_no_management_api_call(self):
        import inspect
        src = inspect.getsource(vr).lower()
        self.assertNotIn("database/query", src)
        self.assertNotIn("api.supabase.com", src)


class TestConnectionErrors(unittest.TestCase):
    def test_auth_failure_fails_closed(self):
        runner = make_runner(rc=2, stderr="psql: error: password authentication failed for user \"postgres\"")
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        self.assertIn("authentication failed", str(ctx.exception.code).lower())

    def test_connection_failure_fails_closed(self):
        runner = make_runner(rc=2, stderr="psql: error: could not connect to server: Connection refused")
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        self.assertIn("could not connect", str(ctx.exception.code).lower())

    def test_unreadable_table_fails_closed(self):
        runner = make_runner(rc=2, stderr="ERROR:  permission denied for table drills")
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        self.assertIn("unreadable", str(ctx.exception.code).lower())

    def test_error_never_leaks_url_or_password(self):
        leaky = f"psql: error: connection to {DB_URL_SENTINEL} failed"
        runner = make_runner(rc=2, stderr=leaky)
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        msg = str(ctx.exception.code)
        self.assertNotIn(DB_URL_SENTINEL, msg)
        self.assertNotIn(DB_PASSWORD_SENTINEL, msg)


class TestMalformedOutput(unittest.TestCase):
    def test_non_json_output_fails(self):
        runner = make_runner(stdout="this is not json\n")
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        self.assertIn("malformed", str(ctx.exception.code).lower())

    def test_empty_output_fails(self):
        runner = make_runner(stdout="")
        with db_url():
            with self.assertRaises(SystemExit) as ctx:
                vr.gather(runner=runner)
        self.assertIn("no output", str(ctx.exception.code).lower())

    def test_missing_values_reported(self):
        # A residue object missing counts reports them as dirty rather than passing.
        runner = make_runner(residue={"last_migration": vr.EXPECTED_LAST_MIGRATION, "has_cron": False})
        with db_url():
            data = vr.gather(runner=runner)
        errors = vr.assert_clean(data)
        self.assertTrue(any("clubs_enabled" in e for e in errors))


class TestForbiddenSqlGuard(unittest.TestCase):
    def test_shipped_selects_are_read_only(self):
        for sql in (vr.RESIDUE_SELECT, vr.CRON_JOBS_SELECT):
            vr.assert_select_only(sql)  # must not raise

    def test_write_and_ddl_statements_rejected(self):
        for bad in (
            "delete from public.content_shares",
            "update public.clubs set public_sharing_enabled = true",
            "insert into public.content_shares default values",
            "drop table public.drills",
            "alter table public.media disable row level security",
            "truncate public.drills",
            "grant select on public.drills to anon",
            "revoke select on public.drills from anon",
            "create table x (id int)",
            "merge into public.drills using x on true when matched then delete",
            "call some_proc()",
            "copy public.drills to stdout",
            "do $$ begin end $$",
            "commit",
            "set role postgres",
            "select 1; drop table public.media",
        ):
            with self.assertRaises(SystemExit, msg=bad):
                vr.assert_select_only(bad)

    def test_guard_runs_before_runner(self):
        def runner(script, db_url):
            raise AssertionError("runner must not be called for a write")
        with db_url():
            with self.assertRaises(SystemExit):
                vr.run_read_only_select("delete from public.drills", runner=runner)


class TestNoSecretPrinted(unittest.TestCase):
    def test_url_never_appears_in_output(self):
        buf = io.StringIO()
        with db_url():
            data = vr.gather(runner=make_runner())
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh)
        try:
            with db_url():
                with contextlib.redirect_stdout(buf):
                    code = vr.main(["verify_no_residue.py", "--sample", path])
        finally:
            os.remove(path)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertNotIn(DB_URL_SENTINEL, buf.getvalue())
        self.assertNotIn(DB_PASSWORD_SENTINEL, buf.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
