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
import probe_shapes as ps  # noqa: E402
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

    Every rule here is about eager name resolution, and all of them are
    enforced in state_select rather than only here, so the composition fails
    before the run connects to anything.

    The guard was widened after a late review pointed out that the first
    version asked the wrong question. It refused a quoted literal CARRYING AN
    ARGUMENT LIST, which is true of a function signature and of nothing else,
    so has_table_privilege('authenticated', 'public.new_table', 'SELECT')
    passed while resolving its argument every bit as eagerly. The rule is now
    about the ARGUMENT POSITION: a literal is judged by what it is handed to,
    which covers relations, schemas, sequences, types, roles and the rest of
    the privilege inquiry family in one statement.
    """

    @staticmethod
    def _probe(probe: str) -> rm.ReviewedMigration:
        return rm.ReviewedMigration(
            path="x.sql", ledger_name="x", idempotency_key="k",
            expected_previous_version="20260810182333",
            expected_previous_name="spond_links", objects={"bad": probe},
        )

    def _refuse(self, probe: str) -> str:
        """Compose the probe, expect a refusal, and hand back the message."""
        with self.assertRaises(SystemExit) as ctx:
            vh.state_select(self._probe(probe), "0" * 32)
        return str(ctx.exception.code)

    def test_a_textual_function_signature_given_to_a_privilege_test_is_refused(self):
        # Verbatim the shape that failed in production.
        bad = (
            "(select has_function_privilege('authenticated', "
            "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)', "
            "'EXECUTE'))"
        )
        self.assertIn("to_regprocedure", self._refuse(bad))

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

    def test_a_table_name_literal_is_still_allowed_outside_a_lookup(self):
        # The rule targets an object name being HANDED to something that
        # resolves it. A relation name compared as text resolves nothing, so
        # forbidding it would fail probes that are already correct.
        ok = "(select count(*) > 0 from pg_namespace where nspname = 'public')"
        vh.state_select(self._probe(ok), "0" * 32)

    # ------------------------------------------------------------------
    # The rule the first version of this guard did not have. It refused a
    # quoted literal CARRYING AN ARGUMENT LIST, which is a property of a
    # function signature and of nothing else, so it caught the 0049 defect and
    # stopped there. 'public.new_table' has no argument list and resolves every
    # bit as eagerly, and so does a schema, a sequence and every other kind.
    # ------------------------------------------------------------------

    def test_a_textual_table_name_given_to_a_privilege_test_is_refused(self):
        message = self._refuse(
            "(select has_table_privilege('authenticated', 'public.new_table', 'SELECT'))"
        )
        self.assertIn("EAGERLY", message)
        self.assertIn("to_regclass", message)

    def test_a_textual_sequence_name_given_to_a_privilege_test_is_refused(self):
        message = self._refuse(
            "(select has_sequence_privilege('authenticated', "
            "'public.new_sequence', 'USAGE'))"
        )
        self.assertIn("EAGERLY", message)
        self.assertIn("to_regclass", message)

    def test_a_textual_schema_name_given_to_a_privilege_test_is_refused(self):
        message = self._refuse(
            "(select has_schema_privilege('authenticated', 'new_schema', 'USAGE'))"
        )
        self.assertIn("EAGERLY", message)
        self.assertIn("to_regnamespace", message)

    def test_the_two_argument_form_is_refused_as_well_as_the_three(self):
        """The object is second from last, so dropping the user argument moves
        it from index 1 to index 0 and must still be found."""
        self.assertIn(
            "EAGERLY",
            self._refuse("(select has_table_privilege('public.new_table', 'SELECT'))"),
        )

    def test_every_covered_privilege_inquiry_function_refuses_a_textual_name(self):
        """Not only the four the roadmap names. Each is called in its own
        three argument form, so the object sits second from last."""
        calls = {
            "has_any_column_privilege": "'public.new_table', 'SELECT'",
            "has_column_privilege": "'public.new_table', 'new_col', 'SELECT'",
            "has_database_privilege": "'new_db', 'CONNECT'",
            "has_foreign_data_wrapper_privilege": "'new_fdw', 'USAGE'",
            "has_function_privilege": "'public.f(uuid)', 'EXECUTE'",
            "has_language_privilege": "'new_lang', 'USAGE'",
            "has_schema_privilege": "'new_schema', 'USAGE'",
            "has_sequence_privilege": "'public.new_sequence', 'USAGE'",
            "has_server_privilege": "'new_server', 'USAGE'",
            "has_table_privilege": "'public.new_table', 'SELECT'",
            "has_tablespace_privilege": "'new_space', 'CREATE'",
            "has_type_privilege": "'public.new_type', 'USAGE'",
            "pg_has_role": "'new_role', 'MEMBER'",
        }
        self.assertEqual(sorted(calls) + ["row_security_active"],
                         sorted(vh.PRIVILEGE_INQUIRY_FUNCTIONS))
        for name, arguments in calls.items():
            with self.subTest(function=name):
                self.assertIn(
                    "EAGERLY",
                    self._refuse(f"(select {name}('authenticated', {arguments}))"),
                )
        # row_security_active takes the relation alone, so its object is the
        # only argument rather than the second from last.
        self.assertIn(
            "EAGERLY", self._refuse("(select row_security_active('public.new_table'))")
        )

    def test_an_absent_column_of_a_present_table_is_refused_too(self):
        """has_column_privilege names TWO object arguments. An absent column
        raises exactly as an absent table does, and a new column is the normal
        pre-apply state for a migration that adds one."""
        self.assertIn(
            "EAGERLY",
            self._refuse(
                "(select count(*) > 0 from pg_class c "
                "where c.oid = to_regclass('public.drills') "
                "and has_column_privilege('authenticated', c.oid, 'new_col', 'SELECT'))"
            ),
        )

    def test_the_regclass_argument_family_is_refused_as_well(self):
        """These take regclass, so a bare literal is coerced by the regclass
        input function. That is the implicit form of the ::regclass cast."""
        for probe in (
            "(select pg_relation_size('public.new_table') > 0)",
            "(select pg_total_relation_size('public.new_table') > 0)",
            "(select pg_get_serial_sequence('public.new_table', 'id') is not null)",
            "(select pg_sequence_last_value('public.new_sequence') is not null)",
        ):
            with self.subTest(probe=probe):
                self.assertIn("EAGERLY", self._refuse(probe))

    def test_a_nullable_resolver_handed_straight_to_a_privilege_test_is_refused(self):
        """These functions are STRICT. to_regclass answering null makes the
        whole probe null, and object_errors refuses a non boolean rather than
        reading it as absent, so the pre gate fails with the object correctly
        absent. That is the 0049 outcome by another route."""
        for probe in (
            "(select has_table_privilege('authenticated', "
            "to_regclass('public.new_table'), 'SELECT'))",
            "(select has_schema_privilege('authenticated', "
            "to_regnamespace('new_schema'), 'USAGE'))",
            "(select has_function_privilege('authenticated', "
            "to_regprocedure('public.f(uuid)'), 'EXECUTE'))",
            # coalescing the oid does not rescue it: has_table_privilege raises
            # for oid 0 in the same way, so the guard refuses the shape.
            "(select has_table_privilege('authenticated', "
            "coalesce(to_regclass('public.new_table'), 0), 'SELECT'))",
        ):
            with self.subTest(probe=probe):
                self.assertIn("STRICT", self._refuse(probe))

    def test_the_reviewed_safe_shapes_are_accepted(self):
        """One per object kind. Each resolves the name once, through a nullable
        lookup, and reads the privilege off the catalog row that resolution
        found, so an absent object matches nothing and the count is 0."""
        for probe in (
            # function
            "(select count(*) > 0 from pg_proc p "
            "where p.oid = to_regprocedure('public.f(uuid)') "
            "and has_function_privilege('authenticated', p.oid, 'EXECUTE') "
            "and not has_function_privilege('anon', p.oid, 'EXECUTE'))",
            # table
            "(select count(*) > 0 from pg_class c "
            "where c.oid = to_regclass('public.new_table') and c.relkind = 'r' "
            "and has_table_privilege('authenticated', c.oid, 'SELECT'))",
            # sequence, which lives in pg_class too
            "(select count(*) > 0 from pg_class c "
            "where c.oid = to_regclass('public.new_sequence') and c.relkind = 'S' "
            "and has_sequence_privilege('authenticated', c.oid, 'USAGE'))",
            # schema
            "(select count(*) > 0 from pg_namespace n "
            "where n.oid = to_regnamespace('new_schema') "
            "and has_schema_privilege('authenticated', n.oid, 'USAGE'))",
            # column, through pg_attribute rather than a column name literal
            "(select count(*) > 0 from pg_attribute a "
            "where a.attrelid = to_regclass('public.new_table') "
            "and a.attname = 'new_col' "
            "and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT'))",
            # an object kind with no to_reg* at all: a nullable catalog lookup
            # yields the oid instead, which is the same shape from another
            # source.
            "(select count(*) > 0 from pg_database d where d.datname = 'postgres' "
            "and has_database_privilege('authenticated', d.oid, 'CONNECT'))",
        ):
            with self.subTest(probe=probe):
                vh.state_select(self._probe(probe), "0" * 32)   # raises if refused

    def test_has_parameter_privilege_is_deliberately_not_covered(self):
        """It is the one member of the family that is already total: an
        unrecognised configuration parameter reads as false rather than
        raising, because a parameter is not a catalog object. Covering it would
        refuse a correct probe. test_probe_totality.sh proves the behaviour on a
        real server rather than trusting this comment."""
        self.assertNotIn("has_parameter_privilege", vh.PRIVILEGE_INQUIRY_FUNCTIONS)
        vh.state_select(
            self._probe(
                "(select has_parameter_privilege('authenticated', 'work_mem', 'SET'))"
            ),
            "0" * 32,
        )

    def test_ordinary_string_literals_are_untouched(self):
        """The guard is about an object name reaching a lookup, never about
        SQL literals in general. Banning those would fail most of the register."""
        for probe in (
            "(select count(*) > 0 from pg_namespace where nspname = 'public')",
            "(select count(*) > 0 from pg_class where relname = 'players')",
            "(select count(*) > 0 from information_schema.columns "
            "where table_schema = 'public' and table_name = 'drills' "
            "and column_name = 'diagram')",
            "(select count(*) = 1 from public.sessions "
            "where spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac')",
        ):
            with self.subTest(probe=probe):
                vh.state_select(self._probe(probe), "0" * 32)

    def test_the_scanner_reads_literals_as_values_not_as_syntax(self):
        """A comma inside a literal must not split the argument list.

        Without that, has_table_privilege('authenticated', c.oid, 'SELECT,
        INSERT') reads as four arguments, the object position lands on the
        first half of the privilege string, and a correct probe is refused for
        carrying a quote. A doubled quote is one character of the value for the
        same reason.
        """
        for probe in (
            "(select count(*) > 0 from pg_class c "
            "where c.oid = to_regclass('public.drills') "
            "and has_table_privilege('authenticated', c.oid, 'SELECT, INSERT'))",
            "(select count(*) > 0 from pg_class c "
            "where c.relname = 'it''s fine' "
            "and has_table_privilege('authenticated', c.oid, 'SELECT'))",
        ):
            with self.subTest(probe=probe):
                vh.state_select(self._probe(probe), "0" * 32)

    def test_a_bare_call_name_inside_a_literal_is_not_read_as_a_call(self):
        vh.state_select(
            self._probe(
                "(select count(*) > 0 from pg_class "
                "where relname = 'has_table_privilege')"
            ),
            "0" * 32,
        )

    # ------------------------------------------------------------------
    # Dollar quoting. Found by a review of the widened guard, and it is the
    # same defect one syntax along: every rule above looks for an apostrophe,
    # PostgreSQL has a second string literal syntax that carries none, and
    # $$public.new_table$$ raises for an absent object exactly as
    # 'public.new_table' does. It went straight through.
    # ------------------------------------------------------------------

    def test_a_dollar_quoted_object_name_is_refused(self):
        for probe in (
            "(select has_table_privilege('authenticated', $$public.new_table$$, 'SELECT'))",
            "(select has_schema_privilege('authenticated', $$new_schema$$, 'USAGE'))",
            "(select has_sequence_privilege('authenticated', $$public.new_seq$$, 'USAGE'))",
            "(select row_security_active($$public.new_table$$))",
        ):
            with self.subTest(probe=probe):
                self.assertIn("Dollar quoting", self._refuse(probe))

    def test_a_TAGGED_dollar_quoted_signature_is_refused(self):
        """The tagged form carries the argument list the original backstop
        looks for, and still slipped past it: that rule reads apostrophes."""
        self.assertIn(
            "Dollar quoting",
            self._refuse(
                "(select has_function_privilege('authenticated', "
                "$fn$public.f(uuid)$fn$, 'EXECUTE'))"
            ),
        )

    def test_a_dollar_sign_is_refused_wherever_it_sits(self):
        """Not only in an object position. A dollar string can CONTAIN an
        apostrophe, which desynchronises the literal scanner and makes the rest
        of the probe unparseable, so the character is refused outright rather
        than parsed."""
        for probe in (
            "(select count(*) > 0 from pg_class c where c.relname = $$players$$)",
            "(select count(*) > 0 from pg_class c where c.relname = $$it's$$ "
            "and has_table_privilege('authenticated', c.oid, 'SELECT'))",
            "(select count(*) > 0 from pg_proc p where p.oid = "
            "to_regprocedure($$public.f(uuid)$$))",
        ):
            with self.subTest(probe=probe):
                self.assertIn("Dollar quoting", self._refuse(probe))

    def test_the_guard_refuses_dollar_quoting_on_its_own_terms(self):
        """assert_probe_is_total is called directly by the tests and by
        test_probe_totality.sh, so it cannot rely on state_select's separate
        _PROBE_FORBIDDEN sweep having run first."""
        with self.assertRaises(SystemExit) as ctx:
            vh.assert_probe_is_total(
                "bad",
                "(select has_table_privilege('authenticated', "
                "$$public.new_table$$, 'SELECT'))",
            )
        self.assertIn("Dollar quoting", str(ctx.exception.code))
        self.assertIn("$", vh._PROBE_FORBIDDEN)

    def test_no_registered_probe_uses_a_dollar_sign(self):
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            for label, probe in mig.objects.items():
                with self.subTest(path=path, label=label):
                    self.assertNotIn("$", probe)

    def test_chr_is_still_the_escape_hatch_for_a_refused_character(self):
        """The register already composes chr(34) for a double quote. The same
        door stays open for a dollar, so refusing the character costs nothing."""
        vh.state_select(
            self._probe(
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure('public.f(uuid)') "
                "and p.proconfig @> array[concat(chr(36), chr(36))])"
            ),
            "0" * 32,
        )

    def test_a_probe_with_unbalanced_parentheses_fails_closed(self):
        self.assertIn(
            "unbalanced",
            self._refuse("(select has_table_privilege('authenticated', 'public.t', 'SELECT'"),
        )

    def test_no_registered_probe_resolves_a_name_eagerly(self):
        # The register as it actually stands, not a fixture of it.
        for path, mig in rm.REVIEWED_MIGRATIONS.items():
            for label, probe in mig.objects.items():
                with self.subTest(path=path, label=label):
                    vh.assert_probe_is_total(label, probe)

    def test_every_0049_probe_resolves_through_to_regprocedure(self):
        # 0049 has been applied, so both its phases have run against the
        # hosted database; these probes stay pinned because a later edit to
        # them would change what a re-read of that state reports. They are
        # named individually because the generic rule above would still pass
        # a probe that resolved nothing at all.
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


class ADataValueMaySpellAForbiddenWord(unittest.TestCase):
    """0050 is called bulk_delete_players, and it is entitled to be.

    assert_select_only bans seventeen words as substrings of the whole
    statement, bluntly, so no register edit can smuggle a write in through an
    object probe. Nine of them are ordinary migration vocabulary, so a ledger
    name was always going to spell one eventually. The guard is not relaxed;
    the VALUE is composed instead, and the statement carries no banned
    substring while comparing the identical text.
    """

    BULK = "supabase/migrations/0050_bulk_delete_players.sql"

    def test_a_clean_value_is_still_an_ordinary_literal(self):
        # The common case is untouched: no concat, no cleverness.
        self.assertEqual(vh.sql_text_value("spond_team_reconcile"), "'spond_team_reconcile'")
        self.assertEqual(vh.sql_text_value("20260817104226"), "'20260817104226'")

    def test_a_value_that_spells_one_is_composed(self):
        out = vh.sql_text_value("bulk_delete_players")
        self.assertNotIn("delete", out.lower())
        self.assertTrue(out.startswith("concat("))

    def test_every_forbidden_token_can_be_expressed(self):
        # Not only "delete". A future migration may be called anything.
        for bad in vh._FORBIDDEN_TOKENS:
            value = f"before_{bad.strip()}_after"
            with self.subTest(token=bad):
                out = vh.sql_text_value(value)
                self.assertIsNone(vh._banned_token_in(out), out)

    def test_the_composed_value_is_the_same_text(self):
        # Composing must not change what the ledger is asked about, or the gate
        # would compare against a name no row carries.
        for value in ("bulk_delete_players", "otj:migration:0050_bulk_delete_players"):
            with self.subTest(value=value):
                pieces = re.findall(r"'([^']*)'", vh.sql_text_value(value))
                self.assertEqual("".join(pieces), value)

    def test_the_statement_guard_itself_is_unchanged(self):
        # The point of the whole exercise: the guard is exactly as strict.
        for sql in ("insert into t values (1)", "select 1; delete from t",
                    "update t set a = 1", "select 1 from t; drop table t"):
            with self.subTest(sql=sql):
                with self.assertRaises(SystemExit):
                    vh.assert_select_only(sql)

    def test_the_bulk_delete_register_entry_composes_and_is_read_only(self):
        entry = rm.REVIEWED_MIGRATIONS[self.BULK]
        md5 = rm.md5_hex(rm.read_migration_sql(os.path.join(REPO, entry.path)))
        script = vh.build_script(vh.state_select(entry, md5))
        self.assertIn("set transaction read only", script)
        self.assertTrue(script.rstrip().endswith("rollback;"))
        # And the ledger question is still asked about the real name.
        self.assertIn("concat('bulk_delet', 'e_players')", script)

    def test_a_probe_cannot_reach_a_function_that_runs_text_as_sql(self):
        """Composition is now a sanctioned technique, so the executors that
        could turn a composed string into a statement are refused outright."""
        for probe in (
            "(select query_to_xml('select 1', false, true, ''))",
            "(select count(*) from pg_proc where pg_read_file('/etc/passwd') is not null)",
            "(select dblink('', 'select 1'))",
        ):
            with self.subTest(probe=probe):
                with self.assertRaises(SystemExit) as ctx:
                    vh.assert_probe_is_total("bad", probe)
                self.assertIn("runs text as SQL", str(ctx.exception.code))


class TheBulkDeleteRegistration(unittest.TestCase):
    """0050 is DESTRUCTIVE, so what it is registered against is pinned."""

    BULK = "supabase/migrations/0050_bulk_delete_players.sql"

    def entry(self):
        return rm.REVIEWED_MIGRATIONS[self.BULK]

    def test_it_is_registered_against_the_applied_0049_row(self):
        # The hosted row 0049's apply stamped on 17 August 2026. Recorded in
        # docs/operations/production-migration-apply.md and in the roadmap's
        # SPOND-08 entry; a wrong value here fails the pre gate closed, which
        # is safe, but it would also stop a correct apply.
        e = self.entry()
        self.assertEqual(e.expected_previous_version, "20260817104226")
        self.assertEqual(e.expected_previous_name, "spond_team_reconcile")

    def test_the_repository_record_agrees_with_the_registration(self):
        # The two are compared rather than both trusted: the register is the
        # thing that runs, the document is the thing a human reads.
        with open(os.path.join(REPO, "docs/operations/production-migration-apply.md"),
                  "r", encoding="utf-8") as fh:
            doc = fh.read()
        self.assertIn("`20260817104226`", doc)
        self.assertIn("`spond_team_reconcile`", doc)
        e = self.entry()
        self.assertIn(e.expected_previous_version, doc)

    def test_it_names_the_file_and_carries_its_own_key(self):
        e = self.entry()
        self.assertEqual(e.ledger_name, "bulk_delete_players")
        self.assertEqual(e.idempotency_key, "otj:migration:0050_bulk_delete_players")

    def test_it_probes_all_four_functions_the_migration_creates(self):
        # One probe per object, so a partial apply cannot read as a whole one.
        self.assertEqual(len(self.entry().objects), 5)

    def test_no_probe_resolves_a_name_eagerly_or_needs_a_resolver(self):
        # Absence safe BY CONSTRUCTION rather than by using to_reg* carefully:
        # every probe joins pg_proc to pg_namespace and reads the privilege off
        # the row it found, so an absent function is an empty join and false.
        for label, probe in self.entry().objects.items():
            with self.subTest(label=label):
                vh.assert_probe_is_total(label, probe)
                self.assertIn("pg_proc", probe)
                self.assertNotIn("to_regprocedure", probe)
                self.assertNotIn("::", probe)

    def test_the_boundary_probes_say_who_may_and_may_not_execute(self):
        objects = self.entry().objects
        acl = objects["authenticated may execute the bulk deletion entry point and anon may not"]
        self.assertIn("has_function_privilege('authenticated', p.oid, 'EXECUTE')", acl)
        self.assertIn("not has_function_privilege('anon', p.oid, 'EXECUTE')", acl)
        # The counting helper is reachable by NOBODY: a grant there would hand
        # every signed in user a club wide count of what deleting a child
        # destroys.
        counts = objects[
            "public.player_deletion_counts(uuid, uuid[]) exists and no client role may execute it"
        ]
        self.assertIn("not has_function_privilege('authenticated', p.oid, 'EXECUTE')", counts)
        self.assertIn("not has_function_privilege('anon', p.oid, 'EXECUTE')", counts)

    def test_it_is_offered_by_the_workflow(self):
        with open(os.path.join(REPO, ".github/workflows/apply-production-migration.yml"),
                  "r", encoding="utf-8") as fh:
            wf = fh.read()
        self.assertIn(self.BULK, wf)


class TheTeamOrderRegistration(unittest.TestCase):
    """0051 is the first coaching workflow migration, and it is registered
    against the head 0050's apply left, so what it is pinned to is pinned."""

    ORDER = "supabase/migrations/0051_team_sort_order.sql"

    def entry(self):
        return rm.REVIEWED_MIGRATIONS[self.ORDER]

    def test_it_is_registered_against_the_applied_0050_row(self):
        # The hosted row 0050's apply stamped on 23 August 2026, read from
        # the hosted ledger on 2 September 2026. A wrong value here fails
        # the pre gate closed, which is safe, but it would also stop a
        # correct apply.
        e = self.entry()
        self.assertEqual(e.expected_previous_version, "20260823065041")
        self.assertEqual(e.expected_previous_name, "bulk_delete_players")

    def test_the_repository_record_agrees_with_the_registration(self):
        with open(os.path.join(REPO, "docs/operations/production-migration-apply.md"),
                  "r", encoding="utf-8") as fh:
            doc = fh.read()
        e = self.entry()
        self.assertIn("`20260823065041`", doc)
        self.assertIn("`bulk_delete_players`", doc)
        self.assertIn(e.expected_previous_version, doc)
        self.assertIn("0051_team_sort_order", doc)

    def test_it_names_the_file_and_carries_its_own_key(self):
        e = self.entry()
        self.assertEqual(e.ledger_name, "team_sort_order")
        self.assertEqual(e.idempotency_key, "otj:migration:0051_team_sort_order")

    def test_it_probes_the_column_the_index_and_the_allow_list(self):
        # One probe per object, so a partial apply cannot read as a whole one.
        self.assertEqual(len(self.entry().objects), 3)

    def test_every_probe_is_total(self):
        for label, probe in self.entry().objects.items():
            with self.subTest(label=label):
                vh.assert_probe_is_total(label, probe)

    def test_the_column_probe_pins_the_shape_and_not_only_the_name(self):
        probe = self.entry().objects["public.teams.sort_order, a nullable integer with no default"]
        self.assertIn("information_schema.columns", probe)
        self.assertNotIn("pg_attribute", probe)
        self.assertIn("data_type = 'integer'", probe)
        self.assertIn("is_nullable = 'YES'", probe)
        self.assertIn("column_default is null", probe)

    def test_the_index_probe_pins_unique_partial_and_two_key_columns(self):
        probe = self.entry().objects[
            "teams_sort_order_unique, a two column partial unique index on teams"
        ]
        self.assertIn("to_regclass('public.teams')", probe)
        self.assertIn("x.indisunique", probe)
        self.assertIn("not x.indisprimary", probe)
        self.assertIn("x.indpred is not null", probe)
        self.assertIn("x.indnkeyatts = 2", probe)

    def test_the_audit_probe_flips_on_the_body_of_a_function_that_already_exists(self):
        # audit_teams() exists before the apply (0037, replaced by 0044), so
        # its probe cannot be a presence check: it reads the stored body for
        # the exact comparison that names the field.
        probe = self.entry().objects["audit_teams() names sort_order on its allow list"]
        self.assertIn("to_regprocedure('public.audit_teams()')", probe)
        self.assertIn("pg_get_functiondef(p.oid)", probe)
        self.assertIn("new.sort_order is distinct from old.sort_order", probe)
        self.assertNotIn("pg_get_function_identity_arguments", probe)

    def test_the_migration_file_carries_the_reviewed_shape(self):
        sql = rm.read_migration_sql(os.path.join(REPO, self.ORDER))
        self.assertIn("alter table public.teams add column sort_order integer;", sql)
        self.assertIn(
            "create unique index teams_sort_order_unique\n"
            "  on public.teams (club_id, sort_order)\n"
            "  where sort_order is not null;",
            sql,
        )
        self.assertIn(
            "if new.sort_order is distinct from old.sort_order then "
            "v_changed := array_append(v_changed, 'sort_order'); end if;",
            sql,
        )
        # Nullable, no default, no check constraint, and not `if not exists`:
        # a second run must fail at its first statement.
        self.assertNotRegex(sql, r"sort_order integer\s+(not null|default)")
        self.assertNotIn("check (sort_order", sql)
        self.assertNotIn("add column if not exists", sql)
        self.assertNotIn("create unique index if not exists", sql)

    def test_the_file_backfills_nothing(self):
        # The only writes of a position in the file are the probe's, and
        # each names one synthetic team by the variable the probe holds it
        # in. Matched per STATEMENT rather than per line, so an aliased
        # table, a multi column set list or an insert carrying the column
        # cannot slip past a filter that only knew one spelling. This is
        # the offline tripwire; the guard at apply time is step 2 of the
        # file itself, which harness mutation F1 proves bites.
        sql = rm.read_migration_sql(os.path.join(REPO, self.ORDER))
        statements = re.findall(
            r"(?is)\b(?:update|insert\s+into)\s+public\.teams\b[^;]*;", sql)
        self.assertTrue(statements, "the probe must exercise the table")
        writes = [s for s in statements if re.search(r"(?i)\bsort_order\b", s)]
        self.assertTrue(writes, "the probe must exercise the column")
        for stmt in writes:
            with self.subTest(statement=" ".join(stmt.split())):
                # A plain update of the table by that name, with sort_order
                # the only column it sets, addressed to one probe variable.
                self.assertRegex(stmt, r"(?is)\Aupdate\s+public\.teams\s+set\s+sort_order\s*=")
                self.assertNotRegex(stmt, r"(?is)\bset\b[^;]*,")
                self.assertRegex(stmt, r"(?is)\bwhere\s+id\s*=\s*v_t[0-9]\s*;\Z")
        for stmt in statements:
            if re.match(r"(?i)insert", stmt):
                with self.subTest(statement=" ".join(stmt.split())):
                    self.assertNotRegex(stmt, r"(?i)sort_order")

    def test_it_is_offered_by_the_workflow(self):
        with open(os.path.join(REPO, ".github/workflows/apply-production-migration.yml"),
                  "r", encoding="utf-8") as fh:
            self.assertIn(self.ORDER, fh.read())


class MutatingASafeProbeBackIsCaught(unittest.TestCase):
    """The four protected classes, mutated back and proved to be caught.

    A test that only asserts the safe forms are accepted would pass just as
    happily over a guard that had been deleted. These take the reviewed safe
    probe for each object kind and the same probe with the resolution taken
    out, and prove the composition accepts the first and refuses the second.
    Both come from probe_shapes.py, rendered from one set of fields, so the
    mutation is the safe shape minus its resolution rather than a separately
    invented mistake, and section H of test_probe_totality.sh runs these exact
    strings against a real PostgreSQL.

    It also proves WHERE the refusal happens. state_select is pure: it reads no
    environment and opens no connection, so the guard fires with no
    SUPABASE_DB_URL set at all, which is what makes this a CI check rather than
    something production finds out.
    """

    def _probe(self, probe: str) -> rm.ReviewedMigration:
        return rm.ReviewedMigration(
            path="x.sql", ledger_name="x", idempotency_key="k",
            expected_previous_version="20260810182333",
            expected_previous_name="spond_links", objects={"bad": probe},
        )

    def test_the_four_protected_classes_are_all_covered(self):
        self.assertEqual(
            sorted(ps.BY_KIND), ["function", "schema", "sequence", "table"]
        )

    def test_each_safe_probe_composes(self):
        for shape in ps.SHAPES:
            with self.subTest(kind=shape.kind):
                self.assertIn(shape.resolver, shape.safe)
                vh.state_select(self._probe(shape.safe), "0" * 32)

    def test_each_mutation_is_refused_before_any_connection(self):
        saved = os.environ.pop(vh.DB_URL_ENV, None)
        try:
            for shape in ps.SHAPES:
                with self.subTest(kind=shape.kind):
                    # The mutation is the eager textual form: the name is
                    # handed to the privilege function and nothing resolves it.
                    self.assertNotIn("to_reg", shape.unsafe)
                    self.assertIn(f"'{shape.name}'", shape.unsafe)
                    with self.assertRaises(SystemExit) as ctx:
                        vh.state_select(self._probe(shape.unsafe), "0" * 32)
                    message = str(ctx.exception.code)
                    self.assertIn("EAGERLY", message)
                    self.assertIn(shape.privilege, message)
                    self.assertNotIn(vh.DB_URL_ENV, message)
        finally:
            if saved is not None:
                os.environ[vh.DB_URL_ENV] = saved

    def test_the_safe_and_unsafe_forms_ask_the_same_question(self):
        """Otherwise the pair proves nothing: a mutation that also changed the
        privilege, the role or the object would be a different probe rather
        than the same probe with its resolution removed."""
        for shape in ps.SHAPES:
            with self.subTest(kind=shape.kind):
                for part in (shape.privilege, shape.name, shape.access, "authenticated"):
                    self.assertIn(part, shape.safe)
                    self.assertIn(part, shape.unsafe)


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
