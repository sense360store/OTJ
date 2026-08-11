#!/usr/bin/env python3
"""Read-only gate on the hosted database, run before and after the apply.

The production migration workflow runs this twice with the same register entry
and only the phase differing:

  --phase pre    before anything is applied. It fails the run unless the hosted
                 ledger is still exactly the one the migration was reviewed
                 against, and unless every object the migration creates is
                 still absent. A repeat run of the same button therefore stops
                 here, with the database untouched.
  --phase post   after the apply. It fails the run unless the migration is now
                 the unique newest ledger row, the row before it is the one
                 that was newest in the pre phase, the recorded statement
                 hashes to the reviewed file, and every object exists.

Both phases are SELECT only, inside a read-only transaction that is always
rolled back. This script never applies anything and never writes.

Credential model
----------------
The connection string is read ONLY from SUPABASE_DB_URL, the full Postgres URI
from Project -> Connect -> Direct -> Session pooler. It is never printed, and
psql's stderr is redacted before any of it is surfaced.

Direct Postgres rather than the Supabase Management API is deliberate and is
the same finding docs/operations/content-sharing-edge-function-deploy.md
records: the classic personal access token in SUPABASE_ACCESS_TOKEN returns
HTTP 403 against the Management API database endpoints on this project.

Usage:
  verify_hosted_state.py --phase pre|post --migration <path>
  verify_hosted_state.py --phase pre|post --migration <path> --sample <file.json>
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reviewed_migrations import (  # noqa: E402
    LEDGER_VERSION_RE,
    ReviewedMigration,
    lookup,
    md5_hex,
    read_migration_sql,
)

DB_URL_ENV = "SUPABASE_DB_URL"

CONNECT_TIMEOUT_SECONDS = 15
SUBPROCESS_TIMEOUT_SECONDS = 60

READ_ONLY_PREAMBLE = (
    "begin;\n"
    "set transaction read only;\n"
    "set local statement_timeout = '30s';\n"
)
READ_ONLY_EPILOGUE = "rollback;\n"

# Statements that would mutate data, schema, permissions or the session role,
# or end the transaction with a commit. Defence in depth behind the read-only
# transaction, so a future edit to the register cannot smuggle a write in
# through an object probe.
_FORBIDDEN_TOKENS = (
    "insert", "update", "delete", "merge", "alter", "drop", "create",
    "truncate", "grant", "revoke", "call", "copy", "do ", "commit",
    "set role", "reset role", "set session authorization",
)

_MD5_RE = re.compile(r"\A[0-9a-f]{32}\Z")
# The probes come from the register, not from a run input, but they are
# interpolated into SQL, so the shape that makes that safe is asserted rather
# than assumed: no quote of any kind and no statement separator.
_PROBE_FORBIDDEN = ('"', "\\", ";", "--", "/*")


def get_db_url() -> str:
    url = os.environ.get(DB_URL_ENV, "")
    if not url:
        raise SystemExit(
            f"FAIL: {DB_URL_ENV} is not set. This verifier connects to Postgres "
            "directly with psql; it never falls back to a Supabase API token."
        )
    return url


def redact(text: str, db_url: str) -> str:
    """Remove the connection string, its password and its user from a string."""
    if not text:
        return ""
    out = text.replace(db_url, "[redacted]")
    try:
        parsed = urllib.parse.urlsplit(db_url)
        if parsed.password:
            out = out.replace(parsed.password, "[redacted]")
        if parsed.username:
            out = out.replace(parsed.username, "[redacted]")
    except ValueError:
        pass
    return out


def assert_select_only(sql: str) -> None:
    """Reject any statement that is not a single read-only SELECT."""
    cleaned = " ".join(raw.split("--", 1)[0] for raw in sql.splitlines()).strip().lower()
    if not cleaned.startswith("select"):
        raise SystemExit("FAIL: refusing to run a non-SELECT statement")
    if ";" in cleaned.rstrip(";"):
        raise SystemExit("FAIL: refusing to run multiple statements")
    for bad in _FORBIDDEN_TOKENS:
        if bad in cleaned:
            raise SystemExit(f"FAIL: refusing statement containing '{bad.strip()}'")


def build_script(select_sql: str) -> str:
    """Wrap one SELECT in the read-only, rollback-only transaction."""
    assert_select_only(select_sql)
    script = f"{READ_ONLY_PREAMBLE}{select_sql};\n{READ_ONLY_EPILOGUE}"
    if "commit" in script.lower():
        raise SystemExit("FAIL: refusing a script that contains COMMIT")
    if "rollback" not in script.lower():
        raise SystemExit("FAIL: refusing a script that does not ROLLBACK")
    return script


def sql_literal(value: str) -> str:
    """A single-quoted SQL literal for a value already proven to be an identifier.

    Callers pass ledger names, versions and hex digests, each validated against
    its own pattern first, so this never sees a quote to escape. The doubling
    is kept anyway so the function is correct on its own terms.
    """
    return "'" + value.replace("'", "''") + "'"


def state_select(entry: ReviewedMigration, expected_md5: str) -> str:
    """The one read-only SELECT both phases run."""
    if not _MD5_RE.match(expected_md5):
        raise SystemExit(f"FAIL: expected md5 is malformed: {expected_md5!r}")
    for label, probe in entry.objects.items():
        for bad in _PROBE_FORBIDDEN:
            if bad in probe:
                raise SystemExit(
                    f"FAIL: object probe {label!r} contains {bad!r}; refusing to run it"
                )

    name = sql_literal(entry.ledger_name)
    key = sql_literal(entry.idempotency_key)
    prev_version = sql_literal(entry.expected_previous_version)
    objects = ",\n    ".join(
        f"{sql_literal(label)}, {probe}" for label, probe in entry.objects.items()
    )
    return f"""select json_build_object(
  'newest_version',   (select max(version) from supabase_migrations.schema_migrations),
  'newest_name',      (select name from supabase_migrations.schema_migrations
                        order by version desc limit 1),
  'second_version',   (select version from supabase_migrations.schema_migrations
                        order by version desc offset 1 limit 1),
  'second_name',      (select name from supabase_migrations.schema_migrations
                        order by version desc offset 1 limit 1),
  'rows_total',       (select count(*) from supabase_migrations.schema_migrations),
  'target_rows',      (select count(*) from supabase_migrations.schema_migrations
                        where name = {name}),
  'target_key_rows',  (select count(*) from supabase_migrations.schema_migrations
                        where idempotency_key = {key}),
  'target_version',   (select max(version) from supabase_migrations.schema_migrations
                        where name = {name}),
  'target_statements',(select coalesce(array_length(statements, 1), 0)
                        from supabase_migrations.schema_migrations where name = {name}),
  'target_md5',       (select md5(statements[1]) from supabase_migrations.schema_migrations
                        where name = {name}),
  'md5_matches',      (select md5(statements[1]) = {sql_literal(expected_md5)}
                        from supabase_migrations.schema_migrations where name = {name}),
  'prev_rows',        (select count(*) from supabase_migrations.schema_migrations
                        where version = {prev_version}),
  'objects',          json_build_object(
    {objects}
  )
)"""


def classify_error(returncode: int, stderr: str, db_url: str) -> str:
    low = (stderr or "").lower()
    first = (stderr or "").strip().splitlines()[0] if (stderr or "").strip() else ""
    excerpt = redact(first, db_url)
    if "authentication failed" in low or "password authentication" in low:
        return (
            f"FAIL: authentication failed connecting to Postgres. The {DB_URL_ENV} "
            f"password is wrong or the role is not permitted. ({excerpt})"
        )
    if any(s in low for s in (
        "could not connect", "could not translate host", "connection refused",
        "no route to host", "timeout expired", "server closed the connection",
        "could not receive data", "connection timed out",
    )):
        return f"FAIL: could not connect to Postgres. ({excerpt})"
    if "statement timeout" in low:
        return f"FAIL: the state query exceeded statement_timeout. ({excerpt})"
    if "permission denied" in low or "does not exist" in low:
        return f"FAIL: a queried schema or table is unreadable to this role. ({excerpt})"
    return f"FAIL: psql exited {returncode}. ({excerpt})"


def _default_runner(script: str, db_url: str) -> tuple[int, str, str]:
    cmd = [
        "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
        "-q", "-t", "-A", "-d", db_url, "-f", "-",
    ]
    env = dict(os.environ)
    env["PGSSLMODE"] = "require"
    env["PGCONNECT_TIMEOUT"] = str(CONNECT_TIMEOUT_SECONDS)
    try:
        proc = subprocess.run(
            cmd, input=script, capture_output=True, text=True, env=env,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        raise SystemExit("FAIL: psql is not installed on the runner")
    except subprocess.TimeoutExpired:
        raise SystemExit("FAIL: psql timed out connecting to or querying Postgres")
    return proc.returncode, proc.stdout, proc.stderr


def parse_json_output(stdout: str) -> object:
    text = (stdout or "").strip()
    if not text:
        raise SystemExit("FAIL: psql returned no output")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("{") or line.startswith("["):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise SystemExit("FAIL: psql returned malformed (non-JSON) output")


def gather(select_sql: str, runner=None) -> dict:
    script = build_script(select_sql)
    db_url = get_db_url()
    rc, stdout, stderr = (runner or _default_runner)(script, db_url)
    if rc != 0:
        raise SystemExit(classify_error(rc, stderr, db_url))
    state = parse_json_output(stdout)
    if not isinstance(state, dict):
        raise SystemExit("FAIL: the state query returned an unexpected shape")
    return state


def as_int(row: dict, key: str) -> int:
    val = row.get(key)
    try:
        return int(val)
    except (TypeError, ValueError):
        return -1


def object_errors(state: dict, entry: ReviewedMigration, want: bool) -> list[str]:
    """Every declared object must be exactly present or exactly absent.

    A probe that is missing from the result, or is not a boolean, is an error.
    It is never read as "absent", which would turn a broken read into a pass in
    the pre phase.
    """
    errors: list[str] = []
    objects = state.get("objects")
    if not isinstance(objects, dict):
        return [f"object probes missing from the read (got {objects!r})"]
    for label in entry.objects:
        got = objects.get(label)
        if not isinstance(got, bool):
            errors.append(f"object probe {label!r} returned {got!r}, not a boolean")
        elif got is not want:
            errors.append(
                f"{label}: expected {'present' if want else 'absent'}, "
                f"found {'present' if got else 'absent'}"
            )
    return errors


def assert_pre(state: dict, entry: ReviewedMigration) -> list[str]:
    """The database is still the reviewed one and this migration has not run."""
    errors: list[str] = []
    newest_version = str(state.get("newest_version"))
    newest_name = str(state.get("newest_name"))
    if newest_version != entry.expected_previous_version:
        errors.append(
            f"the ledger has moved: newest version is {state.get('newest_version')!r}, "
            f"expected {entry.expected_previous_version}"
        )
    if newest_name != entry.expected_previous_name:
        errors.append(
            f"the ledger has moved: newest name is {state.get('newest_name')!r}, "
            f"expected {entry.expected_previous_name}"
        )
    if as_int(state, "prev_rows") != 1:
        errors.append(
            f"{entry.expected_previous_version} is not a unique ledger row "
            f"(found {as_int(state, 'prev_rows')})"
        )
    if as_int(state, "target_rows") != 0:
        errors.append(
            f"{entry.ledger_name} is already recorded in the ledger "
            f"({as_int(state, 'target_rows')} row(s)); refusing to apply it again"
        )
    if as_int(state, "target_key_rows") != 0:
        errors.append(
            f"the idempotency key {entry.idempotency_key} is already used; "
            "refusing to apply it again"
        )
    errors.extend(object_errors(state, entry, want=False))
    return errors


def assert_post(state: dict, entry: ReviewedMigration) -> list[str]:
    """The migration is now the unique newest row and every object exists."""
    errors: list[str] = []
    newest_name = str(state.get("newest_name"))
    newest_version = str(state.get("newest_version"))
    if newest_name != entry.ledger_name:
        errors.append(
            f"newest ledger name is {state.get('newest_name')!r}, "
            f"expected {entry.ledger_name}"
        )
    if as_int(state, "target_rows") != 1:
        errors.append(
            f"{entry.ledger_name} appears {as_int(state, 'target_rows')} times in the "
            "ledger, expected exactly 1"
        )
    if not LEDGER_VERSION_RE.match(newest_version):
        errors.append(
            f"the assigned version {state.get('newest_version')!r} is not a 14 digit stamp"
        )
    elif newest_version <= entry.expected_previous_version:
        errors.append(
            f"the assigned version {newest_version} is not newer than "
            f"{entry.expected_previous_version}"
        )
    if str(state.get("target_version")) != newest_version:
        errors.append(
            f"{entry.ledger_name} is recorded at {state.get('target_version')!r} but the "
            f"newest row is {state.get('newest_version')!r}; it is not the newest migration"
        )
    if str(state.get("second_version")) != entry.expected_previous_version:
        errors.append(
            f"the row before it is {state.get('second_version')!r} / "
            f"{state.get('second_name')!r}, expected "
            f"{entry.expected_previous_version} / {entry.expected_previous_name}"
        )
    if as_int(state, "target_statements") != 1:
        errors.append(
            f"the recorded statements array holds {as_int(state, 'target_statements')} "
            "entries, expected exactly 1"
        )
    if state.get("md5_matches") is not True:
        errors.append(
            "the recorded statement does not hash to the reviewed file "
            f"(stored md5 {state.get('target_md5')!r})"
        )
    errors.extend(object_errors(state, entry, want=True))
    return errors


def report(state: dict, entry: ReviewedMigration, phase: str) -> list[str]:
    objects = state.get("objects") if isinstance(state.get("objects"), dict) else {}
    heading = (
        "Pre-apply hosted ledger gate" if phase == "pre" else "Post-apply hosted readback"
    )
    lines = [
        f"### {heading}",
        "",
        "| Check | Value |",
        "|---|---|",
        f"| Newest ledger version | `{state.get('newest_version')}` |",
        f"| Newest ledger name | `{state.get('newest_name')}` |",
        f"| Row before it | `{state.get('second_version')}` / `{state.get('second_name')}` |",
        f"| Ledger rows | {as_int(state, 'rows_total')} |",
        f"| Rows named `{entry.ledger_name}` | {as_int(state, 'target_rows')} |",
    ]
    if phase == "post":
        lines.append(
            f"| Recorded statement matches the reviewed file | "
            f"{'yes' if state.get('md5_matches') is True else 'NO'} |"
        )
    for label in entry.objects:
        got = objects.get(label)
        shown = "present" if got is True else "absent" if got is False else f"{got!r}"
        lines.append(f"| {label} | {shown} |")
    lines.append("")
    return lines


def write_summary(lines: list[str]) -> None:
    for line in lines:
        print(line)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=("pre", "post"))
    parser.add_argument("--migration", required=True)
    parser.add_argument("--sample", default="")
    args = parser.parse_args(argv[1:])

    entry = lookup(args.migration)
    expected_md5 = md5_hex(read_migration_sql(entry.path))
    select_sql = state_select(entry, expected_md5)

    if args.sample:
        with open(args.sample, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    else:
        state = gather(select_sql)

    write_summary(report(state, entry, args.phase))

    errors = assert_pre(state, entry) if args.phase == "pre" else assert_post(state, entry)
    if errors:
        for err in errors:
            print(f"FAIL: {err}")
        write_summary([
            f"**The {args.phase} gate failed.** "
            + ("Nothing was applied." if args.phase == "pre"
               else "The apply ran; read the errors above before doing anything else."),
            "",
        ])
        return 1

    if args.phase == "pre":
        print(
            f"PASS: the ledger is still {entry.expected_previous_version} / "
            f"{entry.expected_previous_name}, {entry.ledger_name} has not been applied, "
            "and every object it creates is absent. Safe to apply."
        )
        return 0

    version = state.get("newest_version")
    print(
        f"PASS: {entry.ledger_name} is the unique newest ledger row at version {version}, "
        "the recorded statement matches the reviewed file, and every object exists."
    )
    write_summary([
        "### The assigned hosted migration version",
        "",
        "```",
        f"{version}",
        "```",
        "",
        f"That is the version the hosted ledger assigned to `{entry.ledger_name}`.",
        "",
        "Use this value in a SEPARATE reconciliation pull request that sets",
        "`EXPECTED_LAST_MIGRATION` in",
        "`.github/scripts/content-sharing-deploy/verify_no_residue.py` (and its tests,",
        "fixtures and docs) to exactly this string. Until that lands, the",
        "content-sharing deploy workflow fails closed on its own ledger gate, which is",
        "intended.",
        "",
    ])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
