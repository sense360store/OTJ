#!/usr/bin/env python3
"""The workflow YAML parses, and still says what it was reviewed as saying.

This is a tripwire, not a proof. It reads the workflow as data (and in a few
places as text) and fails the build on the mistakes that would actually be made
here: a trigger added so the workflow runs on merge, a widened permission, a
free-text migration input, a `db push` creeping in, the dropdown drifting away
from the reviewed register, or a second migration being applied in one run.

What it cannot catch is stated in its own tests: it does not run the workflow,
it does not talk to GitHub, and it cannot tell whether the production
environment has a required reviewer configured, which is a repository setting
rather than a file. That approval gate is a manual step in the pull request.

Run from this directory:  python3 test_workflow_invariants.py
"""
from __future__ import annotations

import os
import re
import sys
import unittest

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORKFLOW = os.path.join(REPO, ".github/workflows/apply-production-migration.yml")
sys.path.insert(0, HERE)

import reviewed_migrations as rm  # noqa: E402

EXPECTED_PROJECT_REF = "uynorsnrvocksgqweucu"
PINNED_CLI = "2.105.0"


def load() -> dict:
    with open(WORKFLOW, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def text() -> str:
    with open(WORKFLOW, "r", encoding="utf-8") as fh:
        return fh.read()


def commands() -> str:
    """Every shell body in the workflow, with its comments stripped.

    The header explains at length why `supabase db push` is the wrong tool for
    this ledger. Saying so is not doing so, so the "it never applies everything
    pending" checks read what the job RUNS, not what it explains.
    """
    bodies = [s["run"] for s in job(load())["steps"] if "run" in s]
    lines = []
    for body in bodies:
        for line in body.splitlines():
            if line.strip().startswith("#"):
                continue
            lines.append(line)
    return "\n".join(lines)


def job(doc: dict) -> dict:
    jobs = doc["jobs"]
    assert len(jobs) == 1, "this workflow has exactly one job"
    return next(iter(jobs.values()))


class TheYamlIsValid(unittest.TestCase):
    def test_it_parses(self):
        self.assertIsInstance(load(), dict)

    def test_it_has_a_name_and_exactly_one_job(self):
        doc = load()
        self.assertEqual(doc["name"], "Apply production migration")
        self.assertEqual(len(doc["jobs"]), 1)

    def test_every_step_that_runs_a_script_uses_bash_and_strict_mode(self):
        for step in job(load())["steps"]:
            if "run" not in step:
                continue
            self.assertEqual(step.get("shell"), "bash", f"{step.get('name')} does not pin bash")
            self.assertIn(
                "set -euo pipefail", step["run"], f"{step.get('name')} is not in strict mode"
            )

    def test_no_step_turns_on_shell_tracing(self):
        for step in job(load())["steps"]:
            self.assertNotIn("set -x", step.get("run", ""))


class ItCannotRunItself(unittest.TestCase):
    """The one property that makes merging this pull request change nothing."""

    def test_the_only_trigger_is_workflow_dispatch(self):
        # PyYAML reads a bare `on:` key as the boolean True.
        doc = load()
        triggers = doc.get("on", doc.get(True))
        self.assertEqual(list(triggers), ["workflow_dispatch"])

    def test_there_is_no_push_pull_request_or_schedule_trigger(self):
        doc = load()
        triggers = doc.get("on", doc.get(True))
        for forbidden in ("push", "pull_request", "schedule", "repository_dispatch",
                          "workflow_call", "workflow_run", "issue_comment", "release"):
            self.assertNotIn(forbidden, triggers)

    def test_no_other_workflow_calls_this_one(self):
        """A workflow_call trigger is absent above; this also checks nothing
        references the file, so it cannot be reached from CI either."""
        workflows = os.path.join(REPO, ".github/workflows")
        for name in os.listdir(workflows):
            if name == os.path.basename(WORKFLOW):
                continue
            with open(os.path.join(workflows, name), "r", encoding="utf-8") as fh:
                self.assertNotIn("apply-production-migration", fh.read(), f"{name} references it")


class TheGates(unittest.TestCase):
    def test_it_runs_in_the_production_environment(self):
        self.assertEqual(job(load())["environment"], "production")

    def test_permissions_are_read_only(self):
        self.assertEqual(load()["permissions"], {"contents": "read"})

    def test_concurrent_runs_are_serialised_and_never_cancelled(self):
        concurrency = load()["concurrency"]
        self.assertEqual(concurrency["cancel-in-progress"], False)

    def test_the_project_ref_is_hardcoded_as_well_as_typed(self):
        env = job(load())["env"]
        self.assertEqual(env["EXPECTED_PROJECT_REF"], EXPECTED_PROJECT_REF)

    def test_the_typed_ref_is_checked_against_both_the_constant_and_the_secret(self):
        confirm = [
            s for s in job(load())["steps"] if "Confirm target project" in (s.get("name") or "")
        ]
        self.assertEqual(len(confirm), 1)
        body = confirm[0]["run"]
        self.assertIn('"${CONFIRM_PROJECT}" != "${EXPECTED_PROJECT_REF}"', body)
        self.assertIn('"${SUPABASE_PROJECT_ID}" != "${EXPECTED_PROJECT_REF}"', body)

    def test_the_cli_version_is_pinned_and_asserted(self):
        doc_text = text()
        self.assertIn(f"SUPABASE_CLI_VERSION: {PINNED_CLI}", doc_text)
        self.assertIn(f"version: {PINNED_CLI}", doc_text)
        self.assertIn('"${have}" != "${SUPABASE_CLI_VERSION}"', doc_text)

    def test_it_checks_out_the_selected_commit_without_keeping_credentials(self):
        checkout = [
            s for s in job(load())["steps"] if (s.get("uses") or "").startswith("actions/checkout")
        ]
        self.assertEqual(len(checkout), 1)
        self.assertEqual(checkout[0]["with"]["ref"], "${{ github.sha }}")
        self.assertIs(checkout[0]["with"]["persist-credentials"], False)

    def test_it_refuses_a_dirty_working_tree(self):
        self.assertIn("git status --porcelain", text())
        self.assertIn("refusing to apply a migration that is not the committed one", text())

    def test_the_pre_gate_runs_before_the_apply_and_the_post_gate_after(self):
        names = [s.get("name") or "" for s in job(load())["steps"]]
        pre = next(i for i, n in enumerate(names) if n.startswith("Pre-apply gate"))
        apply_at = next(i for i, n in enumerate(names) if n.startswith("Apply the migration"))
        post = next(i for i, n in enumerate(names) if n.startswith("Post-apply gate"))
        self.assertLess(pre, apply_at)
        self.assertLess(apply_at, post)

    def test_the_plan_is_recorded_before_anything_is_applied(self):
        names = [s.get("name") or "" for s in job(load())["steps"]]
        plan = next(i for i, n in enumerate(names) if n.startswith("Record the apply plan"))
        apply_at = next(i for i, n in enumerate(names) if n.startswith("Apply the migration"))
        self.assertLess(plan, apply_at)
        self.assertIn("SHA-256", " ".join(names))


class ExactlyOneMigration(unittest.TestCase):
    def test_the_migration_input_is_a_closed_dropdown_not_free_text(self):
        doc = load()
        triggers = doc.get("on", doc.get(True))
        field = triggers["workflow_dispatch"]["inputs"]["migration_file"]
        self.assertEqual(field["type"], "choice")
        self.assertTrue(field["options"])

    def test_the_dropdown_offers_exactly_the_reviewed_register(self):
        """The two must never drift: an option with no register entry would
        fail mid-run, and a register entry with no option would be unreachable."""
        doc = load()
        triggers = doc.get("on", doc.get(True))
        options = triggers["workflow_dispatch"]["inputs"]["migration_file"]["options"]
        self.assertEqual(sorted(options), sorted(rm.REVIEWED_MIGRATIONS))

    def test_the_first_intended_run_is_0046(self):
        self.assertIn("supabase/migrations/0046_drill_diagram.sql", rm.REVIEWED_MIGRATIONS)

    def test_the_register_is_consulted_again_at_run_time(self):
        """The dropdown limits the UI; the API does not have to use it."""
        self.assertIn("is not a reviewed migration", text())

    def test_it_never_applies_everything_pending(self):
        body = commands()
        for forbidden in ("db push", "db reset", "migration up", "migration repair",
                          "--include-all", "--linked"):
            self.assertTrue(
                forbidden not in body,
                f"{forbidden!r} is run by this workflow; it would not apply exactly one migration",
            )

    def test_exactly_one_migration_script_is_executed(self):
        self.assertEqual(commands().count("apply_one_migration.sql"), 1)

    def test_the_connection_string_is_checked_against_the_project_ref(self):
        """SUPABASE_DB_URL is the only value psql uses, and the typed ref, the
        project secret and the token check all guard something else. Both steps
        that connect must assert it addresses the expected project."""
        steps = [
            s for s in job(load())["steps"]
            if "SUPABASE_DB_URL" in (s.get("env") or {}) and "check_db_url_project.py" in s["run"]
        ]
        self.assertIn("Apply the migration and record it in the hosted ledger",
                      [s["name"] for s in steps])
        self.assertIn("Pre-apply gate (the hosted ledger is still the reviewed one)",
                      [s["name"] for s in steps])

    def test_the_apply_step_is_the_only_one_that_opens_a_shell_connection(self):
        """`-d "${SUPABASE_DB_URL}"` is a psql connection opened by the shell.

        The gates also use psql, but through the read-only verifier, which
        wraps every statement in a read-only transaction it always rolls back.
        The pre gate's `command -v psql` is a presence check and opens nothing,
        which is why this looks for the connection flag rather than the word.
        """
        body = commands()
        self.assertEqual(body.count('-d "${SUPABASE_DB_URL}"'), 1)
        steps = [s for s in job(load())["steps"] if "SUPABASE_DB_URL" in (s.get("env") or {})]
        writers = [s for s in steps if '-d "${SUPABASE_DB_URL}"' in s["run"]]
        self.assertEqual([s["name"] for s in writers],
                         ["Apply the migration and record it in the hosted ledger"])

    def test_the_apply_step_reads_the_path_from_the_register_not_the_input(self):
        apply_step = next(
            s for s in job(load())["steps"] if (s.get("name") or "").startswith("Apply the migration")
        )
        self.assertIn("from reviewed_migrations import lookup", apply_step["run"])
        self.assertIn('cat "${migration_path}"', apply_step["run"])


class SecretsAndScope(unittest.TestCase):
    def test_the_connection_string_is_scoped_to_the_steps_that_need_it(self):
        doc = load()
        self.assertNotIn("SUPABASE_DB_URL", job(doc).get("env", {}))
        steps = [s for s in job(doc)["steps"] if "SUPABASE_DB_URL" in (s.get("env") or {})]
        self.assertEqual(
            sorted((s.get("name") or "") for s in steps),
            ["Apply the migration and record it in the hosted ledger",
             "Post-apply gate (read the hosted ledger back)",
             "Pre-apply gate (the hosted ledger is still the reviewed one)",
             "Prove nothing was applied"],
        )

    def test_no_secret_is_ever_echoed(self):
        body = text()
        for pattern in (r'echo\s+"\$\{?SUPABASE_ACCESS_TOKEN', r'echo\s+"\$\{?SUPABASE_DB_URL',
                        r"\bprintenv\b", r"^\s*env\s*$"):
            self.assertIsNone(re.search(pattern, body, re.MULTILINE), pattern)

    def test_psql_output_is_filtered_before_it_reaches_the_log(self):
        apply_step = next(
            s for s in job(load())["steps"] if (s.get("name") or "").startswith("Apply the migration")
        )
        self.assertIn("redact.py", apply_step["run"])

    def test_it_deploys_nothing(self):
        body = text()
        for forbidden in ("functions deploy", "secrets set", "vercel", "npm run build"):
            self.assertNotIn(forbidden, body)


class TheProbeHarnessActuallyRunsInCi(unittest.TestCase):
    """A skipped proof reported as a green check is worse than no check.

    test_probe_totality.sh is the only thing that runs a composed probe against
    a real server, and it is written to skip itself where no PostgreSQL exists
    so it stays runnable during a review. On the CI runner, which ships the
    server binaries, a skip would mean the image moved under us and the
    behavioural half of the guard silently stopped running. REQUIRE_POSTGRES=1
    turns every skip inside it into a failure, and this asserts CI still sets
    it.
    """

    CI = os.path.join(REPO, ".github/workflows/ci.yml")
    SCRIPT = os.path.join(
        REPO, ".github/scripts/production-migration/test_probe_totality.sh"
    )

    def ci(self) -> dict:
        with open(self.CI, "r", encoding="utf-8") as fh:
            return yaml.safe_load(fh)

    def step(self) -> dict:
        steps = [
            s for job in self.ci()["jobs"].values() for s in job.get("steps", [])
            if "test_probe_totality.sh" in (s.get("run") or "")
        ]
        self.assertEqual(len(steps), 1, "the probe harness runs in exactly one CI step")
        return steps[0]

    def test_ci_runs_the_harness_and_forbids_it_from_skipping(self):
        self.assertEqual((self.step().get("env") or {}).get("REQUIRE_POSTGRES"), "1")

    def test_the_script_honours_that_flag_on_every_skip_it_has(self):
        """Every early exit must go through skip_or_fail, or the flag protects
        only the paths somebody remembered."""
        with open(self.SCRIPT, "r", encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn('REQUIRE_POSTGRES="${REQUIRE_POSTGRES:-0}"', body)
        skips = [
            line.strip() for line in body.splitlines()
            if 'echo "SKIP' in line and not line.strip().startswith("#")
        ]
        self.assertEqual(
            skips, ['echo "SKIP: $1"'],
            "a bare SKIP bypasses REQUIRE_POSTGRES; call skip_or_fail instead",
        )
        self.assertGreaterEqual(
            len([line for line in body.splitlines() if "skip_or_fail " in line]), 2,
            "both early exits should go through skip_or_fail",
        )

    def test_the_harness_reports_a_positive_result_rather_than_only_silence(self):
        with open(self.SCRIPT, "r", encoding="utf-8") as fh:
            self.assertIn("ALL PROBE TOTALITY ASSERTIONS PASSED", fh.read())


class WhatThisFileCannotCatch(unittest.TestCase):
    """Named on purpose, so a green run is not read as more than it is."""

    def test_it_does_not_prove_the_production_environment_has_a_reviewer(self):
        """Required reviewers are a repository setting, not a file. Confirm it
        in GitHub before the first run; nothing here can."""
        self.assertEqual(job(load())["environment"], "production")

    def test_it_does_not_prove_the_migration_sql_is_correct(self):
        """The register says a migration was reviewed. It cannot say it was
        reviewed WELL. That is what the pull request on the migration is for."""
        self.assertTrue(rm.REVIEWED_MIGRATIONS)

    def test_it_does_not_run_psql_or_reach_the_hosted_project(self):
        self.assertNotIn("SUPABASE_DB_URL", os.environ.get("PYTEST_CURRENT_TEST", ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
