#!/usr/bin/env python3
"""Offline tests for the reviewed migration register and the state verifier.

These never touch a database, a secret or a hosted project. They are the half
of this tooling that can be proved in CI, and they exist because the other half
runs once, against production, with a person watching.

Run from this directory:  python3 test_reviewed_migrations.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)

import check_db_url_project as cd  # noqa: E402
import redact as rd  # noqa: E402
import reviewed_migrations as rm  # noqa: E402
import verify_hosted_state as vh  # noqa: E402


def sample_state(**overrides) -> dict:
    """A hosted read shaped like the real one, in its pre-apply state."""
    entry = rm.REVIEWED_MIGRATIONS["supabase/migrations/0046_drill_diagram.sql"]
    state = {
        "newest_version": "20260810182333",
        "newest_name": "spond_links",
        "second_version": "20260809184949",
        "second_name": "training_day_core",
        "rows_total": 40,
        "target_rows": 0,
        "target_key_rows": 0,
        "target_version": None,
        "target_statements": 0,
        "target_md5": None,
        "md5_matches": None,
        "prev_rows": 1,
        "objects": {label: False for label in entry.objects},
    }
    state.update(overrides)
    return state


def applied_state(**overrides) -> dict:
    """The same read after a successful apply."""
    entry = rm.REVIEWED_MIGRATIONS["supabase/migrations/0046_drill_diagram.sql"]
    md5 = rm.md5_hex(rm.read_migration_sql(os.path.join(REPO, entry.path)))
    state = {
        "newest_version": "20260811202539",
        "newest_name": "drill_diagram",
        "second_version": "20260810182333",
        "second_name": "spond_links",
        "rows_total": 41,
        "target_rows": 1,
        "target_key_rows": 1,
        "target_version": "20260811202539",
        "target_statements": 1,
        "target_md5": md5,
        "md5_matches": True,
        "prev_rows": 1,
        "objects": {label: True for label in entry.objects},
    }
    state.update(overrides)
    return state


def entry():
    return rm.REVIEWED_MIGRATIONS["supabase/migrations/0046_drill_diagram.sql"]


class RegisterShape(unittest.TestCase):
    def test_the_register_is_not_empty(self):
        self.assertTrue(rm.REVIEWED_MIGRATIONS)

    def test_every_registered_file_exists_and_the_key_is_its_path(self):
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            self.assertEqual(path, mig.path, "register key must be the migration path")
            self.assertTrue(
                os.path.isfile(os.path.join(REPO, path)),
                f"{path} is registered but not in the repository",
            )

    def test_ledger_name_is_the_file_stem_without_its_number(self):
        """0045_spond_links.sql is recorded as spond_links; keep that rule."""
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            stem = os.path.basename(path)[: -len(".sql")]
            self.assertRegex(stem, r"\A[0-9]{4}_")
            self.assertEqual(stem[5:], mig.ledger_name)

    def test_idempotency_key_names_the_file_and_is_unique(self):
        keys = [m.idempotency_key for m in rm.REVIEWED_MIGRATIONS.values()]
        self.assertEqual(len(keys), len(set(keys)))
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            stem = os.path.basename(path)[: -len(".sql")]
            self.assertEqual(mig.idempotency_key, f"otj:migration:{stem}")

    def test_lookup_refuses_a_path_that_is_not_registered(self):
        with self.assertRaises(SystemExit) as caught:
            rm.lookup("supabase/migrations/9999_anything.sql")
        self.assertIn("not a reviewed migration", str(caught.exception))

    def test_lookup_refuses_a_traversal_attempt(self):
        for path in ("../../etc/passwd", "supabase/migrations/../seed.sql", ""):
            with self.assertRaises(SystemExit):
                rm.lookup(path)

    def test_a_register_entry_must_declare_object_checks(self):
        with self.assertRaises(ValueError):
            rm.ReviewedMigration(
                path="x.sql", ledger_name="x", idempotency_key="k",
                expected_previous_version="20260810182333",
                expected_previous_name="spond_links", objects={},
            )

    def test_a_register_entry_rejects_a_malformed_previous_version(self):
        with self.assertRaises(ValueError):
            rm.ReviewedMigration(
                path="x.sql", ledger_name="x", idempotency_key="k",
                expected_previous_version="0045", expected_previous_name="spond_links",
                objects={"a": "(select true)"},
            )


class MigrationFileShape(unittest.TestCase):
    def test_every_registered_migration_is_one_transaction(self):
        """The atomic apply depends on the file opening and closing its own."""
        for path in rm.REVIEWED_MIGRATIONS:
            sql = rm.read_migration_sql(os.path.join(REPO, path))
            opens, closes = rm.transaction_shape(sql)
            self.assertTrue(opens, f"{path} does not begin with BEGIN")
            self.assertTrue(closes, f"{path} does not end with COMMIT")

    def test_read_migration_sql_strips_only_trailing_newlines(self):
        """The recorded statement must equal the file with its trailing
        newline removed. That is the shape the hosted ledger already carries:
        0044_training_day_core's stored statement hashes to exactly this."""
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.sql")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("begin;\nselect 1;\ncommit;\n\n")
            self.assertEqual(rm.read_migration_sql(path), "begin;\nselect 1;\ncommit;")

    def test_read_migration_sql_matches_shell_command_substitution(self):
        """The workflow builds the same value with $(cat file). If these ever
        disagreed the post-apply hash comparison would fail every run."""
        for path in rm.REVIEWED_MIGRATIONS:
            full = os.path.join(REPO, path)
            shell = subprocess.run(
                ["bash", "-c", 'printf "%s" "$(cat "$1")"', "_", full],
                capture_output=True, check=True,
            ).stdout.decode("utf-8")
            self.assertEqual(rm.read_migration_sql(full), shell)

    def test_read_migration_sql_refuses_a_carriage_return(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.sql")
            with open(path, "wb") as fh:
                fh.write(b"begin;\r\ncommit;\n")
            with self.assertRaises(SystemExit):
                rm.read_migration_sql(path)

    def test_read_migration_sql_refuses_a_psql_meta_command(self):
        r"""\i inside a reviewed file is the one way one migration could pull
        in a second. No migration in this repository starts a line with a
        backslash, so refusing it costs nothing."""
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.sql")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("begin;\n\\i /etc/passwd\ncommit;\n")
            with self.assertRaises(SystemExit) as caught:
                rm.read_migration_sql(path)
            self.assertIn("meta-command", str(caught.exception))

    def test_read_migration_sql_refuses_a_collision_with_the_applys_variables(self):
        for body in ("begin;\nselect :'migration_sql';\ncommit;\n",
                     "begin;\nselect :ledger_name;\ncommit;\n"):
            with tempfile.TemporaryDirectory() as tmp:
                path = os.path.join(tmp, "m.sql")
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(body)
                with self.assertRaises(SystemExit) as caught:
                    rm.read_migration_sql(path)
                self.assertIn("psql variable", str(caught.exception))

    def test_a_cast_is_not_mistaken_for_a_psql_variable(self):
        """`::jsonb` is everywhere in these migrations and must stay legal."""
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.sql")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("begin;\nselect '{}'::jsonb, 'a:b' || x::text;\ncommit;\n")
            self.assertIn("::jsonb", rm.read_migration_sql(path))

    def test_every_registered_migration_passes_both_guards(self):
        for path in rm.REVIEWED_MIGRATIONS:
            rm.read_migration_sql(os.path.join(REPO, path))  # raises if refused

    def test_read_migration_sql_refuses_an_empty_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "m.sql")
            open(path, "wb").close()
            with self.assertRaises(SystemExit):
                rm.read_migration_sql(path)

    def test_transaction_shape_sees_through_a_leading_comment_header(self):
        sql = "-- a header\n-- more header\nbegin;\nselect 1;\ncommit;"
        self.assertEqual(rm.transaction_shape(sql), (True, True))

    def test_transaction_shape_rejects_a_file_that_never_commits(self):
        self.assertEqual(rm.transaction_shape("begin;\nselect 1;"), (True, False))


class ComposedQueryIsSafe(unittest.TestCase):
    """The check that would have caught pg_attribute.attisdropped.

    Every object probe in the register is interpolated into the verifier's one
    SELECT, which then goes through the read-only statement guard. A probe that
    trips that guard would fail for the first time in the middle of a
    production run, so it fails here instead.
    """

    def test_every_registered_probe_composes_into_an_accepted_select(self):
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            md5 = rm.md5_hex(rm.read_migration_sql(os.path.join(REPO, path)))
            sql = vh.state_select(mig, md5)
            vh.assert_select_only(sql)          # raises SystemExit if refused
            vh.build_script(sql)                # and the wrapper too

    def test_the_wrapped_script_is_read_only_and_rolls_back(self):
        md5 = rm.md5_hex(rm.read_migration_sql(os.path.join(REPO, entry().path)))
        script = vh.build_script(vh.state_select(entry(), md5))
        self.assertIn("set transaction read only", script)
        self.assertTrue(script.rstrip().endswith("rollback;"))
        self.assertNotIn("commit", script.lower())

    def test_the_guard_refuses_a_probe_that_carries_a_forbidden_token(self):
        bad = rm.ReviewedMigration(
            path="x.sql", ledger_name="x", idempotency_key="k",
            expected_previous_version="20260810182333",
            expected_previous_name="spond_links",
            # attisdropped is the real case: it contains "drop".
            objects={"bad": "(select count(*) > 0 from pg_attribute where not attisdropped)"},
        )
        with self.assertRaises(SystemExit):
            vh.assert_select_only(vh.state_select(bad, "0" * 32))

    def test_a_probe_cannot_smuggle_in_a_second_statement(self):
        for probe in ("(select true); drop table x", "(select 'a\"b')", "(select 1) -- x"):
            bad = rm.ReviewedMigration(
                path="x.sql", ledger_name="x", idempotency_key="k",
                expected_previous_version="20260810182333",
                expected_previous_name="spond_links", objects={"bad": probe},
            )
            with self.assertRaises(SystemExit):
                vh.state_select(bad, "0" * 32)

    def test_a_malformed_md5_is_refused(self):
        with self.assertRaises(SystemExit):
            vh.state_select(entry(), "not-a-hash")

    def test_assert_select_only_refuses_a_write(self):
        for sql in (
            "insert into t values (1)",
            "select 1; delete from t",
            "update t set a = 1",
            "with x as (select 1) create table y as select * from x",
        ):
            with self.assertRaises(SystemExit):
                vh.assert_select_only(sql)


class ProbesAreTotal(unittest.TestCase):
    """The check that would have caught the 0049 privilege probe.

    A probe answers a yes/no question about one object, and the pre gate asks
    it of a database where the answer is no. A probe that RAISES instead of
    answering no is not a probe, and the production run for 0049 stopped on
    exactly that: has_function_privilege was handed the function's textual
    signature, which PostgreSQL resolves eagerly and errors on when nothing
    matches, so the pre gate could not report the absence it exists to
    confirm.

    Both rules here are about eager name resolution, and both are enforced in
    state_select rather than only here, so the composition fails before the
    run connects to anything.
    """

    @staticmethod
    def _probe(probe: str) -> rm.ReviewedMigration:
        return rm.ReviewedMigration(
            path="x.sql", ledger_name="x", idempotency_key="k",
            expected_previous_version="20260810182333",
            expected_previous_name="spond_links", objects={"bad": probe},
        )

    def test_a_textual_function_signature_given_to_a_privilege_test_is_refused(self):
        # Verbatim the shape that failed in production.
        bad = (
            "(select has_function_privilege('authenticated', "
            "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)', "
            "'EXECUTE'))"
        )
        with self.assertRaises(SystemExit) as ctx:
            vh.state_select(self._probe(bad), "0" * 32)
        self.assertIn("to_regprocedure", str(ctx.exception.code))

    def test_a_regprocedure_cast_is_refused(self):
        for probe in (
            "(select 'public.f(uuid)'::regprocedure is not null)",
            "(select 'public.drills'::regclass is not null)",
            "(select 'public.f(uuid)':: regprocedure is not null)",
        ):
            with self.assertRaises(SystemExit) as ctx:
                vh.state_select(self._probe(probe), "0" * 32)
            self.assertIn("return null", str(ctx.exception.code))

    def test_the_to_regprocedure_form_is_accepted(self):
        good = (
            "(select count(*) > 0 from pg_proc p "
            "where p.oid = to_regprocedure('public.f(uuid, text)') "
            "and has_function_privilege('authenticated', p.oid, 'EXECUTE'))"
        )
        vh.state_select(self._probe(good), "0" * 32)   # raises if refused

    def test_a_table_name_literal_is_still_allowed_outside_to_regclass(self):
        # The rule targets signatures, which carry an argument list. A bare
        # relation name resolves lazily wherever it appears, so comparing one
        # as text is not the mistake this class is about, and forbidding it
        # would fail probes that are already correct.
        ok = "(select count(*) > 0 from pg_namespace where nspname = 'public')"
        vh.state_select(self._probe(ok), "0" * 32)

    def test_no_registered_probe_resolves_a_name_eagerly(self):
        # The register as it actually stands, not a fixture of it.
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            for label, probe in mig.objects.items():
                with self.subTest(path=path, label=label):
                    vh.assert_probe_is_total(label, probe)

    def test_every_0049_probe_resolves_through_to_regprocedure(self):
        # 0049 is the unapplied one, so its probes have never run against a
        # database in either phase. They are named individually because the
        # generic rule above would still pass a probe that resolved nothing
        # at all.
        mig = rm.REVIEWED_MIGRATIONS["supabase/migrations/0049_spond_team_reconcile.sql"]
        self.assertEqual(len(mig.objects), 3)
        for label, probe in mig.objects.items():
            with self.subTest(label=label):
                self.assertIn("to_regprocedure(", probe)
                self.assertIn(
                    "'public.spond_reconcile_player_team"
                    "(uuid, uuid, uuid, text, text, uuid)'",
                    probe,
                )

    def test_the_privilege_probe_still_demands_authenticated_and_denies_anon(self):
        # The fix must not have quietly dropped either half of the ACL rule.
        mig = rm.REVIEWED_MIGRATIONS["supabase/migrations/0049_spond_team_reconcile.sql"]
        probe = mig.objects["authenticated executes it and anon does not"]
        self.assertIn("has_function_privilege('authenticated', p.oid, 'EXECUTE')", probe)
        self.assertIn("not has_function_privilege('anon', p.oid, 'EXECUTE')", probe)

    def test_identity_arguments_is_not_used_to_pin_a_signature(self):
        # pg_get_function_identity_arguments renders the argument NAMES as
        # well as the types, so comparing it against a bare type list is
        # false with the function correctly in place. That is the half of
        # this defect that would have failed the POST gate, after the apply.
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            for label, probe in mig.objects.items():
                with self.subTest(path=path, label=label):
                    self.assertNotIn("pg_get_function_identity_arguments", probe)


class ErrorsAreClassifiedTruthfully(unittest.TestCase):
    URL = "postgresql://postgres.abc:pw@aws.pooler.supabase.com:5432/postgres"

    def test_a_missing_object_is_not_reported_as_only_a_permissions_problem(self):
        # The production run reported "a queried schema or table is
        # unreadable to this role" for a function that was simply not
        # created yet, which sends a reader to look at grants.
        message = vh.classify_error(
            1,
            'ERROR:  function "public.spond_reconcile_player_team(uuid)" does not exist',
            self.URL,
        )
        self.assertIn("unreadable", message)
        self.assertIn("missing", message)

    def test_a_permission_denial_still_classifies(self):
        message = vh.classify_error(1, "ERROR:  permission denied for schema x", self.URL)
        self.assertIn("unreadable", message)


class PreGate(unittest.TestCase):
    def test_a_clean_reviewed_database_passes(self):
        self.assertEqual(vh.assert_pre(sample_state(), entry()), [])

    def test_a_moved_ledger_stops_the_run(self):
        errors = vh.assert_pre(
            sample_state(newest_version="20260812000000", newest_name="something_else"),
            entry(),
        )
        self.assertTrue(any("ledger has moved" in e for e in errors))

    def test_an_already_applied_migration_stops_the_run(self):
        errors = vh.assert_pre(sample_state(target_rows=1), entry())
        self.assertTrue(any("already recorded" in e for e in errors))

    def test_a_used_idempotency_key_stops_the_run(self):
        errors = vh.assert_pre(sample_state(target_key_rows=1), entry())
        self.assertTrue(any("idempotency key" in e for e in errors))

    def test_an_object_that_already_exists_stops_the_run(self):
        label = next(iter(entry().objects))
        objects = {k: False for k in entry().objects}
        objects[label] = True
        errors = vh.assert_pre(sample_state(objects=objects), entry())
        self.assertTrue(any(label in e and "expected absent" in e for e in errors))

    def test_a_missing_probe_is_never_read_as_absent(self):
        """An unanswered read must fail the gate, not pass it."""
        errors = vh.assert_pre(sample_state(objects={}), entry())
        self.assertTrue(errors)
        errors = vh.assert_pre(sample_state(objects=None), entry())
        self.assertTrue(errors)

    def test_a_non_boolean_probe_result_is_refused(self):
        objects = {k: False for k in entry().objects}
        objects[next(iter(entry().objects))] = "false"
        errors = vh.assert_pre(sample_state(objects=objects), entry())
        self.assertTrue(any("not a boolean" in e for e in errors))

    def test_a_duplicated_previous_version_stops_the_run(self):
        errors = vh.assert_pre(sample_state(prev_rows=2), entry())
        self.assertTrue(any("not a unique ledger row" in e for e in errors))


class PostGate(unittest.TestCase):
    def test_a_successful_apply_passes(self):
        self.assertEqual(vh.assert_post(applied_state(), entry()), [])

    def test_a_ledger_row_that_is_not_newest_fails(self):
        errors = vh.assert_post(
            applied_state(newest_version="20260812000000", newest_name="something_else"),
            entry(),
        )
        self.assertTrue(any("newest ledger name" in e for e in errors))

    def test_two_rows_for_this_migration_fail(self):
        errors = vh.assert_post(applied_state(target_rows=2), entry())
        self.assertTrue(any("appears 2 times" in e for e in errors))

    def test_a_statement_that_does_not_match_the_reviewed_file_fails(self):
        errors = vh.assert_post(applied_state(md5_matches=False), entry())
        self.assertTrue(any("does not hash to the reviewed file" in e for e in errors))

    def test_a_missing_object_fails_even_with_a_perfect_ledger(self):
        label = next(iter(entry().objects))
        objects = {k: True for k in entry().objects}
        objects[label] = False
        errors = vh.assert_post(applied_state(objects=objects), entry())
        self.assertTrue(any(label in e and "expected present" in e for e in errors))

    def test_a_version_older_than_the_previous_one_fails(self):
        errors = vh.assert_post(
            applied_state(newest_version="20260801000000", target_version="20260801000000"),
            entry(),
        )
        self.assertTrue(any("not newer than" in e for e in errors))

    def test_a_version_that_is_not_a_14_digit_stamp_fails(self):
        errors = vh.assert_post(
            applied_state(newest_version="0046", target_version="0046"), entry()
        )
        self.assertTrue(any("14 digit stamp" in e for e in errors))

    def test_a_row_appearing_between_this_one_and_the_expected_previous_fails(self):
        errors = vh.assert_post(
            applied_state(second_version="20260811000000", second_name="someone_elses"),
            entry(),
        )
        self.assertTrue(any("the row before it is" in e for e in errors))

    def test_more_than_one_recorded_statement_fails(self):
        errors = vh.assert_post(applied_state(target_statements=3), entry())
        self.assertTrue(any("statements array holds 3" in e for e in errors))


class SecretHandling(unittest.TestCase):
    URL = "postgresql://postgres.abcdef:s3cr3t-pw@aws-0.pooler.supabase.com:5432/postgres"

    def test_redact_removes_the_url_password_and_user(self):
        text = f"could not connect using {self.URL} as postgres.abcdef with s3cr3t-pw"
        out = rd.redact(text, self.URL)
        self.assertNotIn("s3cr3t-pw", out)
        self.assertNotIn("postgres.abcdef", out)
        self.assertNotIn(self.URL, out)

    def test_redact_is_a_no_op_without_a_url(self):
        self.assertEqual(rd.redact("plain text", ""), "plain text")

    def test_the_verifier_redacts_psql_stderr_before_reporting_it(self):
        message = vh.classify_error(2, f"FATAL: password authentication failed {self.URL}", self.URL)
        self.assertNotIn("s3cr3t-pw", message)
        self.assertIn("authentication failed", message)

    def test_the_verifier_refuses_to_run_without_a_connection_string(self):
        saved = os.environ.pop(vh.DB_URL_ENV, None)
        try:
            with self.assertRaises(SystemExit) as caught:
                vh.get_db_url()
            self.assertIn("never falls back", str(caught.exception))
        finally:
            if saved is not None:
                os.environ[vh.DB_URL_ENV] = saved

    def test_no_script_here_reads_the_access_token(self):
        """The access token authenticates the CLI in the workflow and nothing
        else. None of these scripts may reach for it.

        The name is allowed to APPEAR: verify_hosted_state.py's header explains
        why the Management API is not used, and deleting that explanation to
        satisfy a substring check would be the wrong trade. What is checked is
        an actual environment read.
        """
        pattern = re.compile(
            r"(environ[^\n]*SUPABASE_ACCESS_TOKEN|getenv\([^)]*SUPABASE_ACCESS_TOKEN)"
        )
        for name in ("reviewed_migrations.py", "verify_hosted_state.py", "redact.py",
                     "check_db_url_project.py"):
            with open(os.path.join(HERE, name), "r", encoding="utf-8") as fh:
                body = fh.read()
            self.assertIsNone(pattern.search(body), f"{name} reads SUPABASE_ACCESS_TOKEN")


class ConnectionStringTargetsTheRightProject(unittest.TestCase):
    """The gate the other project checks cannot stand in for.

    The typed ref, SUPABASE_PROJECT_ID and the access token all guard values
    that psql never uses. SUPABASE_DB_URL is the one it does.
    """

    REF = "uynorsnrvocksgqweucu"
    POOLER = f"postgresql://postgres.{REF}:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"
    DIRECT = f"postgresql://postgres:pw@db.{REF}.supabase.co:5432/postgres"

    def test_a_session_pooler_string_names_the_project_in_its_user(self):
        self.assertEqual(cd.targets_project(self.POOLER, self.REF), (True, "the connection user"))

    def test_a_direct_string_names_the_project_in_its_host(self):
        self.assertEqual(cd.targets_project(self.DIRECT, self.REF), (True, "the connection host"))

    def test_another_project_is_refused(self):
        other = "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0.pooler.supabase.com:5432/postgres"
        matched, _ = cd.targets_project(other, self.REF)
        self.assertFalse(matched)

    def test_the_ref_must_be_a_whole_component_not_a_substring(self):
        """A ref that merely contains ours must not pass."""
        sneaky = f"postgresql://postgres.x{self.REF}x:pw@aws-0.pooler.supabase.com:5432/postgres"
        matched, _ = cd.targets_project(sneaky, self.REF)
        self.assertFalse(matched)

    def test_an_unparseable_string_fails_closed(self):
        for bad in ("", "not a url", "https://example.com", "postgresql:///postgres"):
            with self.assertRaises(ValueError):
                cd.targets_project(bad, self.REF)

    def test_main_refuses_a_missing_variable(self):
        saved = {k: os.environ.pop(k, None) for k in (cd.DB_URL_ENV, cd.REF_ENV)}
        try:
            self.assertEqual(cd.main(["check_db_url_project.py"]), 1)
            os.environ[cd.DB_URL_ENV] = self.POOLER
            self.assertEqual(cd.main(["check_db_url_project.py"]), 1)
            os.environ[cd.REF_ENV] = self.REF
            self.assertEqual(cd.main(["check_db_url_project.py"]), 0)
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_it_never_prints_the_connection_string(self):
        with open(os.path.join(HERE, "check_db_url_project.py"), "r", encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn("print(db_url", src)
        self.assertNotIn("{db_url}", src)


class EndToEndAgainstSampleState(unittest.TestCase):
    """main() with --sample, so the whole path including reporting is run."""

    def run_main(self, phase: str, state: dict) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(state, fh)
            cwd = os.getcwd()
            os.chdir(REPO)
            try:
                return vh.main([
                    "verify_hosted_state.py", "--phase", phase,
                    "--migration", entry().path, "--sample", path,
                ])
            finally:
                os.chdir(cwd)

    def test_pre_passes_and_post_fails_on_a_pre_apply_database(self):
        self.assertEqual(self.run_main("pre", sample_state()), 0)
        self.assertEqual(self.run_main("post", sample_state()), 1)

    def test_post_passes_and_pre_fails_on_an_applied_database(self):
        self.assertEqual(self.run_main("post", applied_state()), 0)
        self.assertEqual(self.run_main("pre", applied_state()), 1)


class LedgerModelIsPinned(unittest.TestCase):
    """The facts read off the hosted project on 2026-08-11, kept as tests.

    They are what the apply's recording model was derived from, so if the
    reasoning is ever revisited these state what it rested on.
    """

    def test_the_expected_previous_row_is_the_one_0046_was_written_against(self):
        self.assertEqual(entry().expected_previous_version, "20260810182333")
        self.assertEqual(entry().expected_previous_name, "spond_links")

    def test_a_hosted_version_is_a_14_digit_stamp_not_a_file_number(self):
        self.assertRegex(entry().expected_previous_version, r"\A[0-9]{14}\Z")
        self.assertNotRegex(entry().expected_previous_version, r"\A0[0-9]{3}_")

    def test_the_recorded_statement_is_the_whole_file_as_one_entry(self):
        """0044_training_day_core is recorded hosted with one statements entry
        whose md5 is the file with its trailing newline stripped. The apply
        reproduces that, and the post gate asserts it."""
        path = os.path.join(REPO, "supabase/migrations/0044_training_day_core.sql")
        if not os.path.isfile(path):
            self.skipTest("0044 is not in this checkout")
        with open(path, "rb") as fh:
            body = fh.read().decode("utf-8").rstrip("\n")
        self.assertEqual(
            hashlib.md5(body.encode("utf-8")).hexdigest(), "3c0086f7e18dfaf5ec0a2b52350e03c5"
        )


class ApplySqlShape(unittest.TestCase):
    """The apply script is small and its order is the safety property."""

    def setUp(self):
        with open(os.path.join(HERE, "apply_one_migration.sql"), "r", encoding="utf-8") as fh:
            self.src = fh.read()
        self.code = "\n".join(
            line for line in self.src.splitlines() if not line.strip().startswith("--")
        )

    def test_it_stops_on_the_first_error(self):
        self.assertIn("\\set ON_ERROR_STOP on", self.code)

    def test_the_ledger_insert_comes_before_the_migration(self):
        insert_at = self.code.index("insert into supabase_migrations.schema_migrations")
        include_at = self.code.index("\\i :migration_path")
        begin_at = self.code.index("begin;")
        self.assertLess(begin_at, insert_at, "the insert must be inside a transaction")
        self.assertLess(insert_at, include_at, "the insert must precede the migration")

    def test_it_includes_exactly_one_migration(self):
        self.assertEqual(self.code.count("\\i "), 1)

    def test_it_records_the_version_from_the_database_clock_in_utc(self):
        self.assertIn("to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS')", self.code)

    def test_it_records_one_statements_entry_holding_the_whole_file(self):
        self.assertIn("array[:'migration_sql']", self.code)

    def test_it_writes_the_idempotency_key_that_makes_a_repeat_impossible(self):
        self.assertIn(":'ledger_key'", self.code)

    def test_it_never_pushes_or_resets(self):
        # self.code, not self.src: the header explains at length why `db push`
        # is wrong for this ledger, and saying so is not doing so.
        for forbidden in ("db push", "db reset", "migration up", "migration repair"):
            self.assertNotIn(forbidden, self.code, f"{forbidden!r} appears in executable SQL")


if __name__ == "__main__":
    unittest.main(verbosity=2)
