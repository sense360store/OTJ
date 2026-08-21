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
import hashlib
import io
import json
import os
import pathlib
import stat
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
    "non_internal_drills": 0,
    "non_internal_media": 0,
    "total_drills": 104,
    "total_media": 111,
    "last_migration": vr.EXPECTED_LAST_MIGRATION,
    "has_cron": False,
}

# The live sharing state. NOT an assertion target: these are counts and
# fingerprints of legitimate product data, baselined before a deploy and proved
# unchanged after it. This shape carries one share and one sharing audit event
# on purpose, because that is the production state that broke the old
# empty-only gate (GitHub Actions run 32426729784).
SHARES_FP = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f"
AUDIT_FP = "2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e"

CLEAN_STATE = {
    "content_shares": {"count": 1, "fingerprint": SHARES_FP},
    "content_share_dependencies": {"count": 0, "fingerprint": vr.EMPTY_FINGERPRINT},
    "content_share_audit_events": {"count": 1, "fingerprint": AUDIT_FP},
}


def sample_payload(residue=None, state=None, has_cron=False, cron_jobs=0):
    """A --sample payload: absolute-invariant facts plus live sharing state."""
    import copy
    return {
        "residue": dict(CLEAN_RESIDUE if residue is None else residue),
        "has_cron": has_cron,
        "cron_jobs": cron_jobs,
        "state": copy.deepcopy(CLEAN_STATE if state is None else state),
    }


CLEAN_PAYLOAD = sample_payload()


@contextlib.contextmanager
def github_sha_env(value):
    """Set GITHUB_SHA to `value` (None unsets it) and restore it afterwards.

    Actions always sets GITHUB_SHA and a developer's shell usually does not, so
    any test whose result depends on it must state which it means.
    """
    prior = os.environ.get("GITHUB_SHA")
    if value is None:
        os.environ.pop("GITHUB_SHA", None)
    else:
        os.environ["GITHUB_SHA"] = value
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("GITHUB_SHA", None)
        else:
            os.environ["GITHUB_SHA"] = prior


@contextlib.contextmanager
def baseline_path(name="content-sharing-state-baseline.json"):
    """Yield a path inside a fresh temp dir where no baseline exists yet."""
    with tempfile.TemporaryDirectory() as d:
        yield os.path.join(d, name)


@contextlib.contextmanager
def written_baseline(state=None, github_sha=None):
    """Yield (path, doc) for a baseline captured from `state`."""
    canonical = vr.canonical_state(CLEAN_STATE if state is None else state)
    assert canonical is not None, "test state is malformed"
    with baseline_path() as path:
        vr.write_baseline(path, vr.build_baseline(canonical, github_sha))
        with open(path, "r", encoding="utf-8") as fh:
            yield path, json.load(fh)


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


def make_runner(residue=None, cron_n=None, rc=0, stderr="", stdout=None, state=None):
    """Return a fake psql runner and record the scripts it was handed.

    Answers the residue script with `residue` and the cron script with
    `{"n": cron_n}`. When `rc` is non-zero the runner returns it with `stderr`.
    A literal `stdout` overrides JSON generation (for malformed-output tests).
    """
    residue = residue if residue is not None else dict(CLEAN_RESIDUE)
    state = state if state is not None else CLEAN_STATE
    seen = []

    def runner(script, db_url):
        seen.append({"script": script, "db_url": db_url})
        if rc != 0:
            return rc, "", stderr
        if stdout is not None:
            return 0, stdout, ""
        # Dispatch on a marker unique to each shipped statement. This used to
        # key the residue query on "content_shares", which moved into the state
        # query when the live sharing datasets did; had that key been left
        # alone, the residue query would have fallen through to "{}" and every
        # absolute-invariant test would have passed while asserting nothing.
        if "to_jsonb" in script:
            return 0, json.dumps(state) + "\n", ""
        if "clubs_enabled" in script:
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
        self.assertEqual(vr.assert_absolute_invariants(data), [])

    def test_sample_file_clean_passes(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(CLEAN_PAYLOAD, fh)
        buf = io.StringIO()
        try:
            with written_baseline() as (bl, _doc):
                with contextlib.redirect_stdout(buf):
                    code = vr.main(["verify_no_residue.py", "--sample", path,
                                    "--baseline-in", bl])
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
            any("clubs_enabled" in e for e in vr.assert_absolute_invariants({"residue": dirty}))
        )

    def test_live_sharing_state_is_not_an_absolute_invariant(self):
        """Shares, dependencies and sharing audit rows must NOT fail this gate.

        This is the behaviour change. Until 10 August 2026 each of the three was
        asserted to be zero, which was right while public sharing was switched
        off and wrong the moment a coach used it. They are preserved across a
        deploy instead; see TestLiveSharingStatePreservation.
        """
        busy = {
            "content_shares": {"count": 12, "fingerprint": SHARES_FP},
            "content_share_dependencies": {"count": 30, "fingerprint": AUDIT_FP},
            "content_share_audit_events": {"count": 47, "fingerprint": SHARES_FP},
        }
        with db_url():
            data = vr.gather(runner=make_runner(state=busy))
        self.assertEqual(vr.assert_absolute_invariants(data), [])

    def test_non_internal_content_fails(self):
        dirty = dict(CLEAN_RESIDUE, non_internal_drills=3, non_internal_media=4)
        errors = vr.assert_absolute_invariants({"residue": dirty})
        self.assertTrue(any("non_internal_drills" in e for e in errors))
        self.assertTrue(any("non_internal_media" in e for e in errors))

    def test_migration_ledger_moved_fails(self):
        dirty = dict(CLEAN_RESIDUE, last_migration="20260727000000")
        self.assertTrue(
            any("migration ledger changed" in e for e in vr.assert_absolute_invariants({"residue": dirty}))
        )

    def test_cron_job_present_fails(self):
        cron_residue = dict(CLEAN_RESIDUE, has_cron=True)
        runner = make_runner(residue=cron_residue, cron_n=1)
        with db_url():
            data = vr.gather(runner=runner)
        self.assertEqual(data["cron_jobs"], 1)
        self.assertTrue(any("cron job exists" in e for e in vr.assert_absolute_invariants(data)))

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
        errors = vr.assert_absolute_invariants(data)
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
                with written_baseline() as (bl, _doc):
                    with contextlib.redirect_stdout(buf):
                        code = vr.main(["verify_no_residue.py", "--sample", path,
                                        "--baseline-in", bl])
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

    def _run_phase(self, doc, phase):
        """Run one phase over `doc`, supplying that phase's baseline flag.

        The post phase is handed a baseline captured from the SAME document, so
        the live sharing comparison always succeeds and any failure these tests
        see comes from the absolute invariant they are actually about.
        """
        with sample_file(doc) as path:
            if phase == "pre":
                with baseline_path() as out_path:
                    return self._run(["verify_no_residue.py", "--sample", path,
                                      "--phase", "pre", "--baseline-out", out_path])
            with written_baseline(doc["state"]) as (bl, _doc):
                return self._run(["verify_no_residue.py", "--sample", path,
                                  "--phase", "post", "--baseline-in", bl])

    def test_pre_phase_passes_on_clean_sample(self):
        rc, out = self._run_phase(CLEAN_PAYLOAD, "pre")
        self.assertEqual(rc, 0, out)
        self.assertIn("Hosted state before deploy:", out)
        self.assertIn("safe to deploy", out)

    def test_post_phase_is_the_default(self):
        with sample_file(CLEAN_PAYLOAD) as path:
            with written_baseline() as (bl, _doc):
                rc, out = self._run(["verify_no_residue.py", "--sample", path,
                                     "--baseline-in", bl])
        self.assertEqual(rc, 0, out)
        self.assertIn("Hosted state after deploy:", out)

    def test_post_phase_refuses_to_run_without_a_baseline(self):
        """Post must never report PASS having skipped its own comparison."""
        with sample_file(CLEAN_PAYLOAD) as path:
            rc, out = self._run(["verify_no_residue.py", "--sample", path, "--phase", "post"])
        self.assertEqual(rc, 1)
        self.assertIn("requires --baseline-in", out)
        self.assertNotIn("PASS", out)

    def test_pre_phase_fails_on_a_wrong_ledger_version(self):
        """The pre-deploy gate must stop a deploy against an unreviewed schema."""
        with sample_file(sample_payload(residue=dict(CLEAN_RESIDUE,
                                              last_migration="20260727000000"))) as path:
            with baseline_path() as out_path:
                rc, out = self._run(["verify_no_residue.py", "--sample", path,
                                     "--phase", "pre", "--baseline-out", out_path])
                self.assertEqual(rc, 1)
                self.assertIn("migration ledger changed", out)
                self.assertFalse(os.path.exists(out_path))

    def test_pre_phase_passes_with_live_shares_present(self):
        """The production state that used to fail the gate must now pass it.

        One share and one content_share audit event is exactly what run
        32426729784 found and refused. A reviewer changing the gate back would
        fail here rather than at a dispatched production deploy.
        """
        with sample_file(CLEAN_PAYLOAD) as path:
            with baseline_path() as out_path:
                rc, out = self._run([
                    "verify_no_residue.py", "--sample", path,
                    "--phase", "pre", "--baseline-out", out_path,
                ])
        self.assertEqual(rc, 0, out)
        self.assertIn("safe to deploy", out)
        self.assertEqual(CLEAN_PAYLOAD["state"]["content_shares"]["count"], 1)
        self.assertEqual(CLEAN_PAYLOAD["state"]["content_share_audit_events"]["count"], 1)

    def test_pre_phase_fails_on_a_breached_absolute_invariant(self):
        """A reclassified drill or media row still stops the deploy."""
        for key in ("non_internal_drills", "non_internal_media"):
            with sample_file(sample_payload(residue=dict(CLEAN_RESIDUE, **{key: 1}))) as path:
                with baseline_path() as out_path:
                    rc, out = self._run([
                        "verify_no_residue.py", "--sample", path,
                        "--phase", "pre", "--baseline-out", out_path,
                    ])
                self.assertEqual(rc, 1, f"{key} should fail the pre-deploy gate")
                self.assertIn(key, out)
                self.assertFalse(
                    os.path.exists(out_path),
                    "a refused pre-deploy gate must leave no baseline behind",
                )

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
        self.assertEqual(vr.EXPECTED_LAST_MIGRATION, "20260817104226")

    def test_the_superseded_ledger_version_now_fails_the_gate(self):
        """0048's version must no longer satisfy the pin.

        The reconciliation is only real if the value it replaced is now
        rejected: a gate that still accepted 20260812102912 /
        spond_session_link_unique would prove the constant had been widened
        rather than moved. Every earlier superseded value, 0047's and 0046's
        included, stays rejected by the same equality, and each reconciliation
        adds the value it just retired to the front of this tuple.
        """
        for superseded in ("20260812102912", "20260812064038", "20260811210248",
                           "20260810182333", "20260809184949", "20260809081118"):
            doc = sample_payload(residue=dict(CLEAN_RESIDUE, last_migration=superseded))
            for phase in ("pre", "post"):
                rc, out = self._run_phase(doc, phase)
                self.assertEqual(rc, 1, f"{phase} phase must reject {superseded}")
                self.assertIn("migration ledger changed", out)
                self.assertIn(superseded, out)
                self.assertIn("20260817104226", out)

    def test_the_reconciled_ledger_version_passes_when_all_else_is_clean(self):
        """20260817104226 is what a clean hosted ledger now reads."""
        doc = sample_payload(residue=dict(CLEAN_RESIDUE, last_migration="20260817104226"))
        for phase in ("pre", "post"):
            rc, out = self._run_phase(doc, phase)
            self.assertEqual(rc, 0, f"{phase} phase must accept the reconciled version: {out}")
            self.assertIn("20260817104226", out)

    def test_a_malformed_or_absent_ledger_version_is_refused(self):
        """Nothing unreadable is ever treated as satisfying the pin.

        The comparison stringifies whatever the readback carried, so an empty
        string, a null, a missing key, a number and a whitespace lookalike must
        all land on the failure path rather than coincidentally matching. A
        gate that accepted any of these would pass on a readback that never
        actually reported a ledger version.
        """
        malformed = ("", "   ", None, "20260817104226 ", " 20260817104226", "null",
                     "0049_spond_team_reconcile")
        for wrong in malformed:
            doc = sample_payload(residue=dict(CLEAN_RESIDUE, last_migration=wrong))
            for phase in ("pre", "post"):
                rc, out = self._run_phase(doc, phase)
                self.assertEqual(rc, 1, f"{phase} phase must reject {wrong!r}")
                self.assertIn("migration ledger changed", out)

    def test_the_same_version_as_a_json_number_is_accepted_deliberately(self):
        """str() on the readback is intentional, and this pins that choice.

        The comparison is str(r.get("last_migration")) != EXPECTED, so a
        readback that typed the version as a JSON number rather than a string
        still satisfies the pin. That is correct: it is the same ledger
        version, and the gate exists to detect a DIFFERENT hosted schema, not a
        different JSON scalar type. Pinned so the leniency stays deliberate and
        nobody later mistakes it for the loose matching the header forbids;
        note the whitespace variants above are still refused.
        """
        doc = sample_payload(residue=dict(CLEAN_RESIDUE, last_migration=20260817104226))
        for phase in ("pre", "post"):
            rc, out = self._run_phase(doc, phase)
            self.assertEqual(rc, 0, f"{phase} phase must accept the same version as a number")

    def test_an_absent_last_migration_key_is_refused(self):
        """A readback missing the field entirely fails, it does not skip."""
        residue = {k: v for k, v in CLEAN_RESIDUE.items() if k != "last_migration"}
        doc = sample_payload(residue=residue)
        for phase in ("pre", "post"):
            rc, out = self._run_phase(doc, phase)
            self.assertEqual(rc, 1, f"{phase} phase must reject a missing version")
            self.assertIn("migration ledger changed", out)

    def test_a_later_or_prefixed_version_is_still_refused(self):
        """Exact equality, not >= and not a prefix.

        A newer unreviewed migration and a longer string sharing the pin's
        prefix must both fail, which is what separates this gate from the
        loose checks the header forbids.
        """
        # A genuinely LATER stamp, the pin with a digit appended, and the pin
        # truncated. All three are keyed to the reconciled value and must be
        # rekeyed by every reconciliation: 0046's "later" case was
        # 20260812000000, which 0047's pin of 20260812064038 overtook, so it
        # would have silently stopped covering the newer-unreviewed-migration
        # case it exists for. 0048's pin of 20260812102912 was still earlier
        # than 20260813000000, so that one case survived that move; 0049's pin
        # of 20260817104226 overtook it, so "later" was rekeyed to
        # 20260818000000, and the appended and truncated cases are derived from
        # the new pin as always. The relationships are asserted below rather
        # than left to whoever edits the tuple, because the failure mode is a
        # test that still passes while testing nothing.
        later, appended, truncated = "20260818000000", "202608171042260", "2026081710422"
        pin = vr.EXPECTED_LAST_MIGRATION
        # Both are 14 digit stamps, so the string order is the chronological one.
        self.assertEqual(len(pin), 14)
        self.assertEqual(len(later), 14)
        self.assertGreater(later, pin, "the 'later' case must stay later than the pin")
        # Asserted numerically as well, so a future pin of a different length
        # cannot leave the lexical comparison above quietly meaning something
        # other than "a later migration".
        self.assertGreater(int(later), int(pin), "the 'later' case must stay later than the pin")
        self.assertEqual(appended, pin + "0")
        self.assertEqual(truncated, pin[:-1])
        for wrong in (later, appended, truncated):
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
        return vr.assert_absolute_invariants({"residue": residue, "has_cron": False, "cron_jobs": 0})

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
                errors = vr.assert_absolute_invariants(
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
        """assert_absolute_invariants takes no phase, so they cannot diverge.

        Asserted through main() in both phases rather than on the function, so
        a future phase-specific branch in main would break it too.
        """
        doc = sample_payload(
            residue=dict(CLEAN_RESIDUE, enabled_club_ids=[ZZZ_OTHER], clubs_enabled=1))
        outs = {}
        for phase in ("pre", "post"):
            buf = io.StringIO()
            with sample_file(doc) as path:
                with contextlib.redirect_stdout(buf):
                    if phase == "pre":
                        with baseline_path() as out_path:
                            rc = vr.main(["verify_no_residue.py", "--sample", path,
                                          "--phase", "pre", "--baseline-out", out_path])
                    else:
                        with written_baseline(doc["state"]) as (bl, _doc):
                            rc = vr.main(["verify_no_residue.py", "--sample", path,
                                          "--phase", "post", "--baseline-in", bl])
            self.assertEqual(rc, 1, f"{phase} must fail on an unreviewed enabled set")
            outs[phase] = [l for l in buf.getvalue().splitlines() if l.startswith("FAIL:")]
        self.assertEqual(outs["pre"], outs["post"])

    def test_the_ledger_gate_is_untouched_by_this_change(self):
        """The club pin must not have loosened the migration pin."""
        self.assertEqual(vr.EXPECTED_LAST_MIGRATION, "20260817104226")
        src = pathlib.Path(vr.__file__).read_text(encoding="utf-8")
        self.assertIn('str(r.get("last_migration")) != EXPECTED_LAST_MIGRATION', src)

    def test_every_other_residue_check_still_bites(self):
        """Nothing else in the absolute set loosened alongside the club pin.

        shares, deps and share_audit are deliberately absent: they are no
        longer absolute-invariant keys at all. Preserving them across a deploy
        is TestLiveSharingStatePreservation's job, and a bare count assertion
        here would be the very rule this change removed.
        """
        for key, value, needle in (
            ("non_internal_drills", 1, "non_internal_drills expected 0"),
            ("non_internal_media", 1, "non_internal_media expected 0"),
        ):
            with self.subTest(key=key):
                errors = vr.assert_absolute_invariants({"residue": dict(CLEAN_RESIDUE, **{key: value})})
                self.assertTrue(any(needle in e for e in errors), errors)


class TestPreDeployBaseline(unittest.TestCase):
    """PRE captures the live sharing state; it never requires it to be empty."""

    def _capture(self, state, github_sha=None):
        """Run the pre phase over `state` and return (rc, log, baseline, mode).

        GITHUB_SHA is set explicitly rather than inherited. It was inherited
        once, and the difference between a developer's shell (unset) and an
        Actions runner (always set) made the baseline shape test pass locally
        and fail in CI, which is the one place it mattered.
        """
        doc = sample_payload(state=state)
        buf = io.StringIO()
        with github_sha_env(github_sha):
            with sample_file(doc) as path:
                with baseline_path() as out_path:
                    with contextlib.redirect_stdout(buf):
                        rc = vr.main(["verify_no_residue.py", "--sample", path,
                                      "--phase", "pre", "--baseline-out", out_path])
                    captured, mode = None, None
                    if os.path.exists(out_path):
                        with open(out_path, "r", encoding="utf-8") as fh:
                            captured = json.load(fh)
                        mode = stat.S_IMODE(os.stat(out_path).st_mode)
        return rc, buf.getvalue(), captured, mode

    def test_an_empty_sharing_state_passes(self):
        empty = {name: {"count": 0, "fingerprint": vr.EMPTY_FINGERPRINT}
                 for name in vr.MUTABLE_DATASETS}
        rc, out, doc, _mode = self._capture(empty)
        self.assertEqual(rc, 0, out)
        for name in vr.MUTABLE_DATASETS:
            self.assertEqual(doc["datasets"][name]["count"], 0)
            self.assertEqual(doc["datasets"][name]["fingerprint"], vr.EMPTY_FINGERPRINT)

    def test_one_existing_share_passes(self):
        rc, out, doc, _mode = self._capture(CLEAN_STATE)
        self.assertEqual(rc, 0, out)
        self.assertEqual(doc["datasets"]["content_shares"]["count"], 1)

    def test_existing_dependencies_pass(self):
        state = dict(CLEAN_STATE)
        state["content_share_dependencies"] = {"count": 9, "fingerprint": SHARES_FP}
        rc, out, doc, _mode = self._capture(state)
        self.assertEqual(rc, 0, out)
        self.assertEqual(doc["datasets"]["content_share_dependencies"]["count"], 9)

    def test_existing_sharing_audit_history_passes(self):
        state = dict(CLEAN_STATE)
        state["content_share_audit_events"] = {"count": 250, "fingerprint": AUDIT_FP}
        rc, out, doc, _mode = self._capture(state)
        self.assertEqual(rc, 0, out)
        self.assertEqual(doc["datasets"]["content_share_audit_events"]["count"], 250)

    def test_the_baseline_holds_counts_and_fingerprints_and_nothing_else(self):
        """Both shapes, named: outside Actions, and on a runner.

        The commit binding is the ONLY optional key, and it is present exactly
        when GITHUB_SHA is. Asserting whichever shape the ambient environment
        happened to produce is what made this pass locally and fail in CI.
        """
        for sha, expected in ((None, {"format", "datasets"}),
                              ("a" * 40, {"format", "datasets", "github_sha"})):
            with self.subTest(github_sha=sha):
                rc, out, doc, _mode = self._capture(CLEAN_STATE, github_sha=sha)
                self.assertEqual(rc, 0, out)
                self.assertEqual(set(doc), expected)
                self.assertEqual(set(doc["datasets"]), set(vr.MUTABLE_DATASETS))
                for name in vr.MUTABLE_DATASETS:
                    self.assertEqual(set(doc["datasets"][name]),
                                     {"count", "fingerprint"})
                if sha:
                    self.assertEqual(doc["github_sha"], sha)

    def test_no_row_body_or_sensitive_value_can_reach_the_baseline(self):
        """Extra keys on the server read are dropped, not carried through.

        build_baseline copies two scalars per dataset, so a future query that
        returned more, or a tampered --sample file, cannot smuggle a token
        hash, a snapshot, an actor or a connection string into a file on disk.
        """
        polluted = {
            name: {
                "count": 1,
                "fingerprint": SHARES_FP,
                "token_hash": "\\xdeadbeef",
                "snapshot": {"title": "U9 Tuesday session", "activities": ["shooting"]},
                "actor_name": "A Coach",
                "metadata": {"ip": "203.0.113.7"},
                "id": "dd97e876-d275-40bc-a376-ddb16df30d87",
                "db_url": DB_URL_SENTINEL,
            }
            for name in vr.MUTABLE_DATASETS
        }
        leaks = ("token_hash", "deadbeef", "snapshot", "U9 Tuesday session",
                 "actor_name", "A Coach", "metadata", "203.0.113.7",
                 "dd97e876", DB_URL_SENTINEL, DB_PASSWORD_SENTINEL)

        # End to end, through main().
        rc, out, doc, _mode = self._capture(polluted)
        self.assertEqual(rc, 0, out)
        blob = json.dumps(doc)
        for leak in leaks:
            self.assertNotIn(leak, blob, f"{leak!r} reached the baseline file")
        self.assertNotIn("token_hash", out)
        self.assertNotIn("U9 Tuesday session", out)

        # And at BOTH layers that could carry a key through, separately. The
        # end-to-end case above passes as soon as EITHER one strips, so on its
        # own it cannot tell which is doing the work: replacing build_baseline's
        # two-scalar copy with dict(state[name]) left it green.
        stripped = vr.canonical_dataset(polluted["content_shares"])
        self.assertEqual(set(stripped), {"count", "fingerprint"})

        built = vr.build_baseline(polluted, None)
        for name in vr.MUTABLE_DATASETS:
            self.assertEqual(
                set(built["datasets"][name]), {"count", "fingerprint"},
                "build_baseline must copy two scalars, never the dataset dict",
            )
        for leak in leaks:
            self.assertNotIn(leak, json.dumps(built))

    def test_the_baseline_is_written_owner_only(self):
        rc, out, _doc, mode = self._capture(CLEAN_STATE)
        self.assertEqual(rc, 0, out)
        self.assertEqual(mode, 0o600, f"baseline mode was {mode!r}")

    def test_an_existing_baseline_is_never_overwritten(self):
        """A file already at the path was written by something else."""
        doc = sample_payload()
        with baseline_path() as out_path:
            with open(out_path, "w", encoding="utf-8") as fh:
                fh.write('{"format": 1, "datasets": {}}')
            before = pathlib.Path(out_path).read_text(encoding="utf-8")
            with sample_file(doc) as path:
                with self.assertRaises(SystemExit) as raised:
                    with contextlib.redirect_stdout(io.StringIO()):
                        vr.main(["verify_no_residue.py", "--sample", path,
                                 "--phase", "pre", "--baseline-out", out_path])
            self.assertIn("refusing to overwrite", str(raised.exception))
            self.assertEqual(pathlib.Path(out_path).read_text(encoding="utf-8"), before)

    def test_a_stale_partial_baseline_is_refused(self):
        with baseline_path() as out_path:
            partial = f"{out_path}.partial"
            with open(partial, "w", encoding="utf-8") as fh:
                fh.write("{}")
            canonical = vr.canonical_state(CLEAN_STATE)
            with self.assertRaises(SystemExit) as raised:
                vr.write_baseline(out_path, vr.build_baseline(canonical, None))
            self.assertIn("partial baseline", str(raised.exception))
            self.assertFalse(os.path.exists(out_path))

    def test_the_fingerprints_are_never_printed(self):
        """Counts are safe to log; a derived hash of live rows is not."""
        rc, out, _doc, _mode = self._capture(CLEAN_STATE)
        self.assertEqual(rc, 0, out)
        self.assertNotIn(SHARES_FP, out)
        self.assertNotIn(AUDIT_FP, out)
        self.assertNotIn(vr.EMPTY_FINGERPRINT, out)
        self.assertIn("content_shares rows", out)


class TestLiveSharingStatePreservation(unittest.TestCase):
    """POST requires every dataset to be byte-identical to the baseline."""

    def _post(self, baseline_state, current_state, github_sha=None,
              baseline_sha=None):
        doc = sample_payload(state=current_state)
        buf = io.StringIO()
        prior = os.environ.get("GITHUB_SHA")
        if github_sha is None:
            os.environ.pop("GITHUB_SHA", None)
        else:
            os.environ["GITHUB_SHA"] = github_sha
        try:
            with sample_file(doc) as path:
                with written_baseline(baseline_state, baseline_sha) as (bl, _d):
                    with contextlib.redirect_stdout(buf):
                        rc = vr.main(["verify_no_residue.py", "--sample", path,
                                      "--phase", "post", "--baseline-in", bl])
        finally:
            if prior is None:
                os.environ.pop("GITHUB_SHA", None)
            else:
                os.environ["GITHUB_SHA"] = prior
        return rc, buf.getvalue()

    EMPTY = {name: {"count": 0, "fingerprint": vr.EMPTY_FINGERPRINT}
             for name in vr.MUTABLE_DATASETS}

    def test_identical_empty_state_passes(self):
        rc, out = self._post(self.EMPTY, self.EMPTY)
        self.assertEqual(rc, 0, out)
        self.assertIn("unchanged from the pre-deploy baseline", out)

    def test_identical_non_empty_state_passes(self):
        rc, out = self._post(CLEAN_STATE, CLEAN_STATE)
        self.assertEqual(rc, 0, out)
        self.assertIn("unchanged from the pre-deploy baseline", out)

    def test_a_share_created_during_the_deploy_fails(self):
        after = dict(CLEAN_STATE)
        after["content_shares"] = {"count": 2, "fingerprint": AUDIT_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_shares changed during deploy: count 1 -> 2", out)

    def test_a_share_removed_during_the_deploy_fails(self):
        after = dict(CLEAN_STATE)
        after["content_shares"] = {"count": 0, "fingerprint": vr.EMPTY_FINGERPRINT}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_shares changed during deploy: count 1 -> 0", out)

    def test_a_share_refreshed_rotated_or_revoked_fails_on_the_fingerprint(self):
        """Those edits keep the row count and change the row.

        refreshed_at, rotated_at, revoked_at and token_hash all live inside the
        hashed row, so the count is a false negative here and the fingerprint
        is the check that bites.
        """
        after = dict(CLEAN_STATE)
        after["content_shares"] = {"count": 1, "fingerprint": AUDIT_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("same row count (1) but the row contents differ", out)

    def test_a_dependency_inserted_fails(self):
        after = dict(CLEAN_STATE)
        after["content_share_dependencies"] = {"count": 1, "fingerprint": SHARES_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_share_dependencies changed during deploy: count 0 -> 1", out)

    def test_a_dependency_removed_fails(self):
        before = dict(CLEAN_STATE)
        before["content_share_dependencies"] = {"count": 4, "fingerprint": SHARES_FP}
        rc, out = self._post(before, CLEAN_STATE)
        self.assertEqual(rc, 1)
        self.assertIn("content_share_dependencies changed during deploy: count 4 -> 0", out)

    def test_a_dependency_changed_in_place_fails(self):
        before = dict(CLEAN_STATE)
        before["content_share_dependencies"] = {"count": 4, "fingerprint": SHARES_FP}
        after = dict(CLEAN_STATE)
        after["content_share_dependencies"] = {"count": 4, "fingerprint": AUDIT_FP}
        rc, out = self._post(before, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_share_dependencies changed during deploy", out)
        self.assertIn("row contents differ", out)

    def test_a_sharing_audit_event_inserted_fails(self):
        after = dict(CLEAN_STATE)
        after["content_share_audit_events"] = {"count": 2, "fingerprint": SHARES_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_share_audit_events changed during deploy: count 1 -> 2", out)

    def test_an_existing_sharing_audit_row_changed_fails(self):
        after = dict(CLEAN_STATE)
        after["content_share_audit_events"] = {"count": 1, "fingerprint": SHARES_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        self.assertIn("content_share_audit_events changed during deploy", out)
        self.assertIn("row contents differ", out)

    def test_same_counts_but_changed_contents_fails_in_every_dataset(self):
        """The count alone is not the check; each dataset carries its own hash."""
        for name in vr.MUTABLE_DATASETS:
            with self.subTest(dataset=name):
                before = {n: {"count": 3, "fingerprint": SHARES_FP}
                          for n in vr.MUTABLE_DATASETS}
                after = dict(before)
                after[name] = {"count": 3, "fingerprint": AUDIT_FP}
                rc, out = self._post(before, after)
                self.assertEqual(rc, 1)
                self.assertIn(f"{name} changed during deploy", out)

    def test_the_failure_never_prints_a_row(self):
        after = dict(CLEAN_STATE)
        after["content_shares"] = {"count": 2, "fingerprint": AUDIT_FP}
        rc, out = self._post(CLEAN_STATE, after)
        self.assertEqual(rc, 1)
        # The verifier holds two scalars per dataset, so there is no row to
        # print; this pins that the diagnostic does not start reaching for one.
        for leak in ("token_hash", "snapshot", "actor", "SELECT", "select *"):
            self.assertNotIn(leak, out)
        self.assertNotIn(SHARES_FP, out)
        self.assertNotIn(AUDIT_FP, out)

    def test_absolute_invariants_are_still_asserted_in_the_post_phase(self):
        """A preserved sharing state does not excuse a moved ledger."""
        doc = sample_payload(residue=dict(CLEAN_RESIDUE, last_migration="20260727000000"))
        buf = io.StringIO()
        with sample_file(doc) as path:
            with written_baseline(CLEAN_STATE) as (bl, _d):
                with contextlib.redirect_stdout(buf):
                    rc = vr.main(["verify_no_residue.py", "--sample", path,
                                  "--phase", "post", "--baseline-in", bl])
        self.assertEqual(rc, 1)
        self.assertIn("migration ledger changed", buf.getvalue())


class TestBaselineValidation(unittest.TestCase):
    """Every unusable baseline stops the deploy; none is worked around."""

    def _post_with_baseline_text(self, text, github_sha=None):
        doc = sample_payload()
        buf = io.StringIO()
        prior = os.environ.get("GITHUB_SHA")
        if github_sha is None:
            os.environ.pop("GITHUB_SHA", None)
        else:
            os.environ["GITHUB_SHA"] = github_sha
        try:
            with baseline_path() as bl:
                if text is not None:
                    with open(bl, "w", encoding="utf-8") as fh:
                        fh.write(text)
                with sample_file(doc) as path:
                    try:
                        with contextlib.redirect_stdout(buf):
                            rc = vr.main(["verify_no_residue.py", "--sample", path,
                                          "--phase", "post", "--baseline-in", bl])
                        return rc, buf.getvalue()
                    except SystemExit as exc:
                        return 1, f"{buf.getvalue()}{exc}"
        finally:
            if prior is None:
                os.environ.pop("GITHUB_SHA", None)
            else:
                os.environ["GITHUB_SHA"] = prior

    def _good(self, **over):
        canonical = vr.canonical_state(CLEAN_STATE)
        doc = vr.build_baseline(canonical, over.pop("github_sha", None))
        doc.update(over)
        return doc

    def test_a_missing_baseline_fails(self):
        rc, out = self._post_with_baseline_text(None)
        self.assertEqual(rc, 1)
        self.assertIn("no pre-deploy baseline", out)

    def test_malformed_json_fails(self):
        rc, out = self._post_with_baseline_text("{not json")
        self.assertEqual(rc, 1)
        self.assertIn("not valid JSON", out)

    def test_a_json_scalar_instead_of_an_object_fails(self):
        rc, out = self._post_with_baseline_text('"a string"')
        self.assertEqual(rc, 1)
        self.assertIn("not a JSON object", out)

    def test_a_wrong_format_version_fails(self):
        rc, out = self._post_with_baseline_text(json.dumps(self._good(format=2)))
        self.assertEqual(rc, 1)
        self.assertIn("baseline format", out)

    def test_an_absent_format_version_fails(self):
        doc = self._good()
        doc.pop("format")
        rc, out = self._post_with_baseline_text(json.dumps(doc))
        self.assertEqual(rc, 1)
        self.assertIn("baseline format", out)

    def test_a_missing_datasets_object_fails(self):
        doc = self._good()
        doc.pop("datasets")
        rc, out = self._post_with_baseline_text(json.dumps(doc))
        self.assertEqual(rc, 1)
        self.assertIn("no datasets object", out)

    def test_a_missing_dataset_fails_and_is_named(self):
        for name in vr.MUTABLE_DATASETS:
            with self.subTest(dataset=name):
                doc = self._good()
                doc["datasets"].pop(name)
                rc, out = self._post_with_baseline_text(json.dumps(doc))
                self.assertEqual(rc, 1)
                self.assertIn("missing datasets", out)
                self.assertIn(name, out)

    def test_an_unknown_dataset_fails(self):
        doc = self._good()
        doc["datasets"]["content_share_secrets"] = {"count": 0,
                                                    "fingerprint": vr.EMPTY_FINGERPRINT}
        rc, out = self._post_with_baseline_text(json.dumps(doc))
        self.assertEqual(rc, 1)
        self.assertIn("unknown datasets", out)

    def test_a_malformed_count_fails(self):
        for bad in ("1", 1.5, -1, None, True, [1]):
            with self.subTest(count=bad):
                doc = self._good()
                doc["datasets"]["content_shares"]["count"] = bad
                rc, out = self._post_with_baseline_text(json.dumps(doc))
                self.assertEqual(rc, 1, f"{bad!r} must be refused")
                self.assertIn("malformed count or fingerprint", out)

    def test_a_malformed_fingerprint_fails(self):
        for bad in ("", "xyz", SHARES_FP.upper(), SHARES_FP[:-1], SHARES_FP + "0",
                    f" {SHARES_FP}", None, 12345):
            with self.subTest(fingerprint=bad):
                doc = self._good()
                doc["datasets"]["content_shares"]["fingerprint"] = bad
                rc, out = self._post_with_baseline_text(json.dumps(doc))
                self.assertEqual(rc, 1, f"{bad!r} must be refused")
                self.assertIn("malformed count or fingerprint", out)

    def test_a_baseline_from_another_commit_fails(self):
        rc, out = self._post_with_baseline_text(
            json.dumps(self._good(github_sha="a" * 40)), github_sha="b" * 40)
        self.assertEqual(rc, 1)
        self.assertIn("was captured on commit", out)

    def test_a_bound_baseline_with_no_current_commit_fails(self):
        rc, out = self._post_with_baseline_text(
            json.dumps(self._good(github_sha="a" * 40)), github_sha=None)
        self.assertEqual(rc, 1)
        self.assertIn("no GITHUB_SHA to compare", out)

    def test_a_matching_commit_passes(self):
        rc, out = self._post_with_baseline_text(
            json.dumps(self._good(github_sha="a" * 40)), github_sha="a" * 40)
        self.assertEqual(rc, 0, out)

    def test_an_unbound_baseline_is_compared_without_a_commit(self):
        """Binding is skipped only when PRE recorded no SHA, never silently."""
        rc, out = self._post_with_baseline_text(json.dumps(self._good()),
                                                github_sha="b" * 40)
        self.assertEqual(rc, 0, out)

    def test_a_non_string_commit_in_the_baseline_fails(self):
        doc = self._good()
        doc["github_sha"] = 1234
        rc, out = self._post_with_baseline_text(json.dumps(doc))
        self.assertEqual(rc, 1)
        self.assertIn("github_sha is not a string", out)


class TestStateQuery(unittest.TestCase):
    """The shipped fingerprint SQL: read-only, and deterministic by shape."""

    def test_the_state_query_is_select_only(self):
        vr.assert_select_only(vr.STATE_SELECT)

    def test_the_state_query_runs_read_only_and_rolls_back(self):
        script = vr.build_script(vr.STATE_SELECT).lower()
        self.assertIn("set transaction read only;", script)
        self.assertIn("rollback;", script)
        self.assertNotIn("commit", script)

    def test_no_write_statement_is_introduced(self):
        low = vr.STATE_SELECT.lower()
        for bad in ("insert", "update ", "delete", "merge", "alter", "drop",
                    "truncate", "grant", "revoke", "create"):
            self.assertNotIn(bad, low, f"{bad!r} appears in the state query")

    def test_every_dataset_is_ordered_explicitly_by_its_row_id(self):
        """Order independence rests on this ORDER BY, not on luck.

        string_agg has no defined order without one, so two runs over the same
        unchanged rows could concatenate them differently and report a change
        that never happened. Ordered by the uuid ITSELF rather than id::text,
        because text ordering is collation dependent.
        """
        self.assertEqual(vr.STATE_SELECT.count("order by t.id)"), 3)
        self.assertNotIn("order by t.id::text", vr.STATE_SELECT)

    def test_every_dataset_hashes_whole_rows_and_fixed_length_row_hashes(self):
        self.assertEqual(vr.STATE_SELECT.count("md5(to_jsonb(t)::text)"), 3)
        self.assertEqual(vr.STATE_SELECT.count("coalesce(string_agg("), 3)

    def test_the_three_datasets_are_exactly_the_documented_ones(self):
        self.assertEqual(
            vr.MUTABLE_DATASETS,
            ("content_shares", "content_share_dependencies",
             "content_share_audit_events"),
        )
        self.assertIn("from public.content_shares t", vr.STATE_SELECT)
        self.assertIn("from public.content_share_dependencies t", vr.STATE_SELECT)
        self.assertIn(
            "from public.audit_events t where t.entity_type = 'content_share'",
            vr.STATE_SELECT,
        )

    def test_every_output_formatting_guc_is_pinned(self):
        """to_jsonb renders several types according to a SESSION setting.

        Three were measured against the hosted project. One unchanged
        timestamptz hashed to ac1dd26dbe9da00843070d826a17f311 under UTC and to
        1010c8de772c30ce2fcd8fc225914fed under America/New_York. One unchanged
        bytea (the shape of content_shares.token_hash) hashed to
        249af7b5e5582f80b1f4434c6150d254 under hex and to
        5e46159b11924b75616ee4f7598e836f under escape. And at hosted's own
        extra_float_digits of 0, the two DISTINCT float8 values 0.3 and
        0.30000000000000004 both render {"f": 0.3} and hash identically, so
        that pin is what stops the fingerprint MISSING a change.

        The rest close the same class for column types a future migration could
        add, since to_jsonb(t) fingerprints the whole row by design.
        """
        script = vr.build_script(vr.STATE_SELECT).lower()
        for guc in ("timezone = 'utc'", "bytea_output = 'hex'",
                    "datestyle = 'iso, mdy'", "intervalstyle = 'postgres'",
                    "extra_float_digits = 3", "lc_monetary = 'c'"):
            self.assertIn(f"set local {guc};", vr.READ_ONLY_PREAMBLE.lower(),
                          f"{guc} is not pinned in the preamble")
            self.assertIn(f"set local {guc};", script,
                          f"{guc} does not reach the shipped script")

    def test_the_pinned_gucs_are_session_local_and_not_writes(self):
        """SET LOCAL, never SET; the transaction still rolls back."""
        preamble = vr.READ_ONLY_PREAMBLE.lower()
        for line in preamble.splitlines():
            line = line.strip()
            if line.startswith("set ") and not line.startswith("set transaction"):
                self.assertTrue(line.startswith("set local "),
                                f"{line!r} is not transaction-scoped")
        self.assertIn("rollback;", vr.build_script(vr.STATE_SELECT).lower())

    def test_the_empty_fingerprint_is_md5_of_the_empty_string(self):
        """What coalesce(..., '') makes an empty dataset hash to."""
        self.assertEqual(vr.EMPTY_FINGERPRINT, hashlib.md5(b"").hexdigest())

    def test_the_documented_construction_is_order_independent(self):
        """The algorithm, re-implemented, over the same rows in two orders.

        This tests the CONSTRUCTION described above STATE_SELECT, not the
        server: it cannot prove PostgreSQL's string_agg, md5 or jsonb
        rendering behave as documented. What covers that is
        test_every_dataset_is_ordered_explicitly_by_its_row_id above, plus the
        live read recorded in the operations document.
        """
        def fingerprint(rows):
            ordered = sorted(rows, key=lambda r: r["id"])
            joined = "".join(
                hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest()
                for r in ordered
            )
            return hashlib.md5(joined.encode()).hexdigest()

        rows = [{"id": "b", "v": 2}, {"id": "a", "v": 1}, {"id": "c", "v": 3}]
        self.assertEqual(fingerprint(rows), fingerprint(list(reversed(rows))))
        self.assertEqual(fingerprint([]), vr.EMPTY_FINGERPRINT)
        changed = [dict(r) for r in rows]
        changed[0]["v"] = 99
        self.assertNotEqual(fingerprint(rows), fingerprint(changed))

    def test_the_absolute_query_no_longer_counts_live_sharing_rows(self):
        """Two sources for one count is how a pair comes to disagree."""
        for gone in ("'shares'", "'deps'", "'share_audit'"):
            self.assertNotIn(gone, vr.RESIDUE_SELECT)
        self.assertIn("'clubs_enabled'", vr.RESIDUE_SELECT)
        self.assertIn("'last_migration'", vr.RESIDUE_SELECT)

    def test_the_count_and_fingerprint_of_a_dataset_share_one_statement(self):
        """Two statements would be two snapshots, and could disagree."""
        for name in vr.MUTABLE_DATASETS:
            self.assertIn(f"'{name}', json_build_object(", vr.STATE_SELECT)


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
