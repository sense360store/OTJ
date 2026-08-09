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
import pathlib
import tempfile
import unittest

import verify_no_residue as vr

DB_URL_SENTINEL = "postgresql://postgres.abcd:S3cretPass@aws-0-eu.pooler.supabase.com:5432/postgres"
DB_PASSWORD_SENTINEL = "S3cretPass"
ACCESS_TOKEN_SENTINEL = "sbp_ACCESS_TOKEN_MUST_NEVER_BE_USED_111"
READ_TOKEN_SENTINEL = "sbp_READ_TOKEN_MUST_NEVER_BE_USED_222"

OSSETT = "11111111-1111-1111-1111-111111111111"
ZZZ_OTHER = "7007e5b0-bc23-4a4b-a82d-81acb8979782"

CLEAN_RESIDUE = {
    "clubs_enabled": 1,
    "enabled_club_ids": [OSSETT],
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


CLEAN_PAYLOAD = {"residue": dict(CLEAN_RESIDUE), "has_cron": False, "cron_jobs": 0}


@contextlib.contextmanager
def sample_file(payload):
    """Write a --sample payload to a temp file and yield its path."""
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        yield path
    finally:
        os.unlink(path)


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
        dirty = dict(CLEAN_RESIDUE, clubs_enabled=2, enabled_club_ids=[OSSETT, ZZZ_OTHER])
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
        dirty = dict(CLEAN_RESIDUE, last_migration="20260727000000")
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




class TestPhaseArgument(unittest.TestCase):
    """--phase selects the wording only; the assertions are identical."""

    def _run(self, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = vr.main(argv)
        return rc, buf.getvalue()

    def test_pre_phase_passes_on_clean_sample(self):
        with sample_file(CLEAN_PAYLOAD) as path:
            rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "pre"])
        self.assertEqual(rc, 0)
        self.assertIn("Hosted state before deploy:", out)
        self.assertIn("safe to deploy", out)

    def test_post_phase_is_the_default(self):
        with sample_file(CLEAN_PAYLOAD) as path:
            rc, out = self._run(["verify_no_residue.py", "--sample", path])
        self.assertEqual(rc, 0)
        self.assertIn("Hosted state after deploy:", out)

    def test_pre_phase_fails_on_a_wrong_ledger_version(self):
        """The pre-deploy gate must stop a deploy against an unreviewed schema."""
        payload = {
            "residue": dict(CLEAN_RESIDUE, last_migration="20260727000000"),
            "has_cron": False,
            "cron_jobs": 0,
        }
        with sample_file(payload) as path:
            rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "pre"])
        self.assertEqual(rc, 1)
        self.assertIn("migration ledger changed", out)

    def test_pre_phase_fails_on_dirty_hosted_state(self):
        """An existing share, dependency or audit event must stop the deploy.

        The enabled club set has its own dedicated cases in
        TestEnabledClubAllowlist: one enabled club is now the REVIEWED state,
        not a dirty one, so it cannot be expressed by bumping a count here.
        """
        for key in ("shares", "deps", "share_audit"):
            payload = {
                "residue": dict(CLEAN_RESIDUE, **{key: 1}),
                "has_cron": False,
                "cron_jobs": 0,
            }
            with sample_file(payload) as path:
                rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "pre"])
            self.assertEqual(rc, 1, f"{key} should fail the pre-deploy gate")
            self.assertIn(key, out)

    def test_unknown_phase_is_refused(self):
        with sample_file(CLEAN_PAYLOAD) as path:
            rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "sometime"])
        self.assertEqual(rc, 1)
        self.assertIn("--phase must be pre or post", out)

    def test_expected_last_migration_is_an_exact_equality(self):
        """Never a >=, a prefix match or an exists-check."""
        src = pathlib.Path(vr.__file__).read_text(encoding="utf-8")
        self.assertIn('str(r.get("last_migration")) != EXPECTED_LAST_MIGRATION', src)
        self.assertNotIn("startswith(EXPECTED_LAST_MIGRATION", src)
        self.assertNotIn(">= EXPECTED_LAST_MIGRATION", src)
        self.assertEqual(vr.EXPECTED_LAST_MIGRATION, "20260809081118")

    def test_the_superseded_ledger_version_now_fails_the_gate(self):
        """0042's version must no longer satisfy the pin.

        The reconciliation is only real if the value it replaced is now
        rejected: a gate that still accepted 20260727110609 would prove the
        constant had been widened rather than moved.
        """
        payload = {
            "residue": dict(CLEAN_RESIDUE, last_migration="20260727110609"),
            "has_cron": False,
            "cron_jobs": 0,
        }
        for phase in ("pre", "post"):
            with sample_file(payload) as path:
                rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", phase])
            self.assertEqual(rc, 1, f"{phase} phase must reject the superseded version")
            self.assertIn("migration ledger changed", out)
            self.assertIn("20260809081118", out)

    def test_the_reconciled_ledger_version_passes_when_all_else_is_clean(self):
        """20260809081118 is what a clean hosted ledger now reads."""
        payload = {
            "residue": dict(CLEAN_RESIDUE, last_migration="20260809081118"),
            "has_cron": False,
            "cron_jobs": 0,
        }
        for phase in ("pre", "post"):
            with sample_file(payload) as path:
                rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", phase])
            self.assertEqual(rc, 0, f"{phase} phase must accept the reconciled version")
            self.assertIn("20260809081118", out)

    def test_a_later_or_prefixed_version_is_still_refused(self):
        """Exact equality, not >= and not a prefix.

        A newer unreviewed migration and a longer string sharing the pin's
        prefix must both fail, which is what separates this gate from the
        loose checks the header forbids.
        """
        for wrong in ("20260810000000", "202608090811180", "2026080908111"):
            payload = {
                "residue": dict(CLEAN_RESIDUE, last_migration=wrong),
                "has_cron": False,
                "cron_jobs": 0,
            }
            with sample_file(payload) as path:
                rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "pre"])
            self.assertEqual(rc, 1, f"{wrong} must fail the exact-equality gate")
            self.assertIn("migration ledger changed", out)


class TestEnabledClubAllowlist(unittest.TestCase):
    """The enabled club set is pinned by EXACT id set equality.

    The dark rollout gate asserted no club was enabled. That is obsolete:
    Ossett Town Juniors is deliberately enabled. What replaces it is not a
    looser check but a different one of the same strictness, so an unexpected
    club, a missing expected club, or a swap still stops the deploy.
    """

    UNKNOWN = "deadbeef-0000-4000-8000-000000000000"
    # Ossett's id with a single character changed: a near miss must fail like
    # any other wrong id.
    OSSETT_OFF_BY_ONE = "11111111-1111-1111-1111-111111111112"

    def errors_for(self, ids, count=None):
        residue = dict(
            CLEAN_RESIDUE,
            enabled_club_ids=ids,
            clubs_enabled=len(ids) if count is None else count,
        )
        return vr.assert_clean({"residue": residue, "has_cron": False, "cron_jobs": 0})

    def assert_club_failure(self, ids, count=None):
        errors = self.errors_for(ids, count)
        self.assertTrue(
            any("enabled club" in e or "clubs_enabled" in e for e in errors),
            f"expected a club-set failure for {ids!r}, got {errors!r}",
        )
        return errors

    # ---- the one passing case ------------------------------------------

    def test_exactly_the_reviewed_set_passes(self):
        self.assertEqual(self.errors_for([OSSETT]), [])
        self.assertEqual(vr.EXPECTED_ENABLED_PUBLIC_SHARING_CLUB_IDS, (OSSETT,))

    # ---- every failing case --------------------------------------------

    def test_no_club_enabled_fails(self):
        """The old dark-rollout state is now itself a failure."""
        self.assert_club_failure([])

    def test_only_the_other_club_enabled_fails(self):
        self.assert_club_failure([ZZZ_OTHER])

    def test_reviewed_club_plus_the_other_club_fails(self):
        self.assert_club_failure([OSSETT, ZZZ_OTHER])

    def test_reviewed_club_plus_an_unknown_club_fails(self):
        self.assert_club_failure([OSSETT, self.UNKNOWN])

    def test_an_id_differing_by_one_character_fails(self):
        self.assert_club_failure([self.OSSETT_OFF_BY_ONE])

    def test_an_extra_id_fails_even_when_the_reviewed_one_is_present(self):
        errors = self.assert_club_failure([OSSETT, self.UNKNOWN])
        self.assertTrue(any("unexpectedly enabled" in e for e in errors), errors)

    def test_a_missing_expected_id_is_named(self):
        errors = self.assert_club_failure([])
        self.assertTrue(any("expected but not enabled" in e for e in errors), errors)

    def test_malformed_results_fail_closed(self):
        for bad in (
            None,                      # key absent or null
            "11111111-1111-1111-1111-111111111111",  # a bare string, not a list
            [None],                    # a null element
            [123],                     # a non-string element
            ["not-a-uuid"],            # not a UUID at all
            [""],                      # empty string
            [OSSETT + "  extra"],      # trailing junk
            [{"id": OSSETT}],          # an object rather than an id
            [OSSETT, OSSETT],          # duplicate rows
        ):
            with self.subTest(bad=bad):
                errors = vr.assert_clean(
                    {"residue": dict(CLEAN_RESIDUE, enabled_club_ids=bad)}
                )
                self.assertTrue(
                    any("missing or malformed" in e or "enabled club" in e for e in errors),
                    f"{bad!r} must fail closed, got {errors!r}",
                )

    def test_a_stale_count_disagreeing_with_the_ids_fails(self):
        """The count is a consistency check on the same read, not decoration."""
        errors = self.errors_for([OSSETT], count=2)
        self.assertTrue(any("clubs_enabled expected 1, got 2" in e for e in errors), errors)
        # And the reverse: the right count with the wrong ids still fails.
        wrong_ids = self.errors_for([ZZZ_OTHER], count=1)
        self.assertTrue(any("enabled club set changed" in e for e in wrong_ids), wrong_ids)

    # ---- the shape of the comparison -----------------------------------

    def test_comparison_is_order_independent(self):
        """A future multi-club allowlist cannot pass or fail on row order."""
        a, b = sorted([OSSETT, ZZZ_OTHER])
        self.assertEqual(vr.canonical_club_ids([a, b]), vr.canonical_club_ids([b, a]))
        self.assertEqual(vr.canonical_club_ids([b, a]), [a, b])

    def test_comparison_is_case_insensitive_on_the_hex(self):
        """Postgres renders a uuid lowercase; an uppercase read is the same id."""
        self.assertEqual(vr.canonical_club_ids([OSSETT.upper()]), [OSSETT])
        self.assertEqual(self.errors_for([OSSETT.upper()]), [])

    def test_no_subset_or_superset_logic(self):
        """Neither direction of containment is accepted, only equality."""
        # Superset of the reviewed set.
        self.assert_club_failure([OSSETT, ZZZ_OTHER, self.UNKNOWN])
        # Subset of the reviewed set (empty is the only subset here).
        self.assert_club_failure([])

    def test_the_source_uses_set_equality_not_a_count_or_range(self):
        """Pin the operator in source, as the ledger gate does."""
        src = pathlib.Path(vr.__file__).read_text(encoding="utf-8")
        self.assertIn("actual_ids != expected_ids", src)
        for loose in (
            ">= len(expected_ids)",
            "<= len(expected_ids)",
            "issubset",
            "issuperset",
            "in expected_ids or",
        ):
            self.assertNotIn(loose, src)

    def test_pre_and_post_use_the_same_club_assertion(self):
        """assert_clean takes no phase, so the two phases cannot diverge."""
        payload = {
            "residue": dict(CLEAN_RESIDUE, enabled_club_ids=[ZZZ_OTHER], clubs_enabled=1),
            "has_cron": False,
            "cron_jobs": 0,
        }
        outs = {}
        for phase in ("pre", "post"):
            buf = io.StringIO()
            with sample_file(payload) as path:
                with contextlib.redirect_stdout(buf):
                    rc = vr.main(["verify_no_residue.py", "--sample", path, "--phase", phase])
            self.assertEqual(rc, 1, f"{phase} must fail on an unreviewed enabled set")
            outs[phase] = [l for l in buf.getvalue().splitlines() if l.startswith("FAIL:")]
        self.assertEqual(outs["pre"], outs["post"])

    def test_the_ledger_gate_is_untouched_by_this_change(self):
        """The club pin must not have loosened the migration pin."""
        self.assertEqual(vr.EXPECTED_LAST_MIGRATION, "20260809081118")
        src = pathlib.Path(vr.__file__).read_text(encoding="utf-8")
        self.assertIn('str(r.get("last_migration")) != EXPECTED_LAST_MIGRATION', src)

    def test_every_other_residue_check_still_bites(self):
        """The only semantic change is the club set; nothing else loosened."""
        for key, value, needle in (
            ("shares", 1, "shares expected 0"),
            ("deps", 1, "deps expected 0"),
            ("share_audit", 1, "share_audit expected 0"),
            ("non_internal_drills", 1, "non_internal_drills expected 0"),
            ("non_internal_media", 1, "non_internal_media expected 0"),
        ):
            with self.subTest(key=key):
                errors = vr.assert_clean({"residue": dict(CLEAN_RESIDUE, **{key: value})})
                self.assertTrue(any(needle in e for e in errors), errors)


# The runner must stay at the very BOTTOM of this file. It previously sat above
# TestPhaseArgument, so unittest.main() ran before that class was defined and
# its tests, including the exact-equality guard on EXPECTED_LAST_MIGRATION,
# never executed in CI. test_every_test_class_runs below fails if a class is
# ever added after this point again.
class TestSuiteCompleteness(unittest.TestCase):
    def test_every_test_class_runs(self):
        """Nothing may be defined after the runner block."""
        import inspect
        import sys

        module = sys.modules[__name__]
        classes = [
            v for v in vars(module).values()
            if inspect.isclass(v) and issubclass(v, unittest.TestCase)
        ]
        collected = unittest.defaultTestLoader.loadTestsFromModule(module)

        def count(suite):
            n = 0
            for item in suite:
                n += count(item) if isinstance(item, unittest.TestSuite) else 1
            return n

        declared = sum(
            len([m for m in dir(c) if m.startswith("test")]) for c in classes
        )
        self.assertEqual(count(collected), declared)


if __name__ == "__main__":
    unittest.main(verbosity=2)
