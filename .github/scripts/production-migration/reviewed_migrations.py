#!/usr/bin/env python3
"""The closed register of migrations this workflow is allowed to apply.

WHY A REGISTER AT ALL

The production migration workflow applies exactly ONE migration file per run,
and the file is not free text. It is chosen from a dropdown whose options are
the keys of REVIEWED_MIGRATIONS below, so the operator cannot type a path and
the workflow cannot be pointed at an unreviewed file. Adding a migration to
this register is itself a reviewed pull request, which is the point: the review
of the SQL and the review of "this SQL may be applied to production" are the
same review.

Each entry also carries the hosted state the migration was reviewed AGAINST:
the ledger row that must still be newest before it runs, and the database
objects that must be absent before and present after. Those turn "apply the
migration" into "apply the migration to the exact database it was written for",
which is what makes a second run of the same button a refusal rather than a
surprise.

This module touches no database and reads no secret. It reads the migration
file from the checked-out commit, hashes it, and prints the plan.

Usage:
  reviewed_migrations.py --migration <repo-relative path> [--commit <sha>]
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from dataclasses import dataclass, field

# A ledger name is the migration file's stem with its number removed, which is
# how every existing hosted row is named (0045_spond_links.sql -> spond_links).
LEDGER_NAME_RE = re.compile(r"\A[a-z][a-z0-9_]*\Z")
# A hosted ledger version is a 14 digit UTC timestamp, stamped by the apply.
LEDGER_VERSION_RE = re.compile(r"\A[0-9]{14}\Z")


@dataclass(frozen=True)
class ReviewedMigration:
    """One migration this workflow may apply, and the state it expects."""

    path: str
    # The value written to supabase_migrations.schema_migrations.name.
    ledger_name: str
    # Written to the ledger's UNIQUE idempotency_key column. Postgres, not this
    # script, is then what refuses a second apply of the same migration: the
    # insert runs BEFORE the DDL in the same transaction, so a duplicate key
    # aborts the whole apply with the schema untouched.
    idempotency_key: str
    # The ledger row that must still be the unique newest one before this runs.
    expected_previous_version: str
    expected_previous_name: str
    # Named boolean SQL expressions. Every one must be FALSE before the apply
    # and TRUE after it. Absent-before is what makes a repeat run stop; present
    # after is what proves the apply did what it claimed.
    objects: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not LEDGER_NAME_RE.match(self.ledger_name):
            raise ValueError(f"ledger name is not a bare identifier: {self.ledger_name!r}")
        if not LEDGER_VERSION_RE.match(self.expected_previous_version):
            raise ValueError(
                f"expected previous version is not a 14 digit stamp: "
                f"{self.expected_previous_version!r}"
            )
        if not LEDGER_NAME_RE.match(self.expected_previous_name):
            raise ValueError(
                f"expected previous name is not a bare identifier: "
                f"{self.expected_previous_name!r}"
            )
        if not self.objects:
            raise ValueError(f"{self.path} declares no object checks")


REVIEWED_MIGRATIONS: dict[str, ReviewedMigration] = {
    # ------------------------------------------------------------------
    # 0046_drill_diagram: adds public.drills.diagram, three immutable shape
    # functions and the drills_diagram_shape check constraint. It changes no
    # policy, grant, capability, role or trigger, and changes no row. See the
    # file's own header for the full review.
    #
    # It was written against a hosted database whose newest ledger row is
    # 20260810182333 / spond_links, checked 2026-08-11. If that is no longer
    # the newest row the database has moved since the review, and this run
    # stops before it touches anything.
    # ------------------------------------------------------------------
    "supabase/migrations/0046_drill_diagram.sql": ReviewedMigration(
        path="supabase/migrations/0046_drill_diagram.sql",
        ledger_name="drill_diagram",
        idempotency_key="otj:migration:0046_drill_diagram",
        expected_previous_version="20260810182333",
        expected_previous_name="spond_links",
        objects={
            # information_schema.columns rather than pg_attribute: it already
            # excludes dropped columns, and pg_attribute's attisdropped carries
            # the substring "drop", which the verifier's read-only statement
            # guard rejects outright. test_reviewed_migrations.py runs every
            # probe here through that guard so a probe can never fail for the
            # first time during a production run.
            "public.drills.diagram column": (
                "(select count(*) > 0 from information_schema.columns "
                "where table_schema = 'public' and table_name = 'drills' "
                "and column_name = 'diagram')"
            ),
            "drills_diagram_shape check constraint": (
                "(select count(*) > 0 from pg_constraint c "
                "where c.conrelid = to_regclass('public.drills') "
                "and c.conname = 'drills_diagram_shape')"
            ),
            # All three, counted as distinct names, so two of three present is
            # a failure rather than a pass.
            "the three drill diagram validation functions": (
                "(select count(distinct p.proname) = 3 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' and p.proname in "
                "('drill_diagram_is_valid', 'drill_diagram_element_is_valid', "
                "'drill_diagram_keys_within'))"
            ),
        },
    ),
    # ------------------------------------------------------------------
    # 0047_register_group_inclusion: adds
    # public.register_entries.included_in_groups so that `present` can go
    # back to meaning physical attendance. It adds ONE column and three
    # comments. It writes no row, and in particular copies nothing between
    # the two columns in either direction; its own self-verification
    # fingerprints the attendance record before and after and aborts if it
    # moved, and refuses to complete if any row came out marked as
    # included. It changes no policy, grant, capability, role or trigger,
    # and the same self-verification proves that too.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260811210248 / drill_diagram, checked 2026-08-11.
    # ------------------------------------------------------------------
    "supabase/migrations/0047_register_group_inclusion.sql": ReviewedMigration(
        path="supabase/migrations/0047_register_group_inclusion.sql",
        ledger_name="register_group_inclusion",
        idempotency_key="otj:migration:0047_register_group_inclusion",
        expected_previous_version="20260811210248",
        expected_previous_name="drill_diagram",
        objects={
            # information_schema.columns, never pg_attribute: attisdropped
            # carries the substring "drop", which the verifier's read-only
            # statement guard rejects. test_reviewed_migrations.py runs
            # every probe here through that guard.
            "public.register_entries.included_in_groups column": (
                "(select count(*) > 0 from information_schema.columns "
                "where table_schema = 'public' and table_name = 'register_entries' "
                "and column_name = 'included_in_groups')"
            ),
            # The shape matters as much as the presence: a nullable column,
            # or one defaulting to true, would be a different migration.
            "included_in_groups is NOT NULL and defaults to false": (
                "(select count(*) > 0 from information_schema.columns "
                "where table_schema = 'public' and table_name = 'register_entries' "
                "and column_name = 'included_in_groups' "
                "and is_nullable = 'NO' and column_default = 'false')"
            ),
        },
    ),
    # ------------------------------------------------------------------
    # 0048_spond_session_link_unique: repairs ONE bad Spond link and adds
    # the partial unique index that makes the class of corruption
    # impossible. It clears sessions.spond_event_id on one named June
    # session, creates sessions_spond_event_id_unique, and does nothing
    # else: it deletes no session, rewrites no status, clears no
    # live_activity_index, and changes no policy, grant, capability, role
    # or trigger. Its own self-verification fingerprints every other
    # session row whole, before and after, and aborts if any of them
    # moved. It refuses to run at all if the hosted database holds any
    # duplicate Spond link other than the reviewed pair.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260812064038 / register_group_inclusion, checked 2026-08-12.
    # ------------------------------------------------------------------
    "supabase/migrations/0048_spond_session_link_unique.sql": ReviewedMigration(
        path="supabase/migrations/0048_spond_session_link_unique.sql",
        ledger_name="spond_session_link_unique",
        idempotency_key="otj:migration:0048_spond_session_link_unique",
        expected_previous_version="20260812064038",
        expected_previous_name="register_group_inclusion",
        objects={
            # pg_index rather than information_schema: an index is not a
            # constraint here, so information_schema.table_constraints
            # cannot see it. The shape is probed, not only the name: a
            # non-unique or non-partial index of the same name would be a
            # different migration.
            "sessions_spond_event_id_unique, unique and partial": (
                "(select count(*) > 0 from pg_index x "
                "join pg_class c on c.oid = x.indexrelid "
                "where x.indrelid = to_regclass('public.sessions') "
                "and c.relname = 'sessions_spond_event_id_unique' "
                "and x.indisunique and x.indpred is not null)"
            ),
            # The data half, which the index alone does not prove: the
            # 11 August event is held by exactly one session. False before
            # (two sessions hold it), true after.
            "the 11 August Spond event is held by exactly one session": (
                "(select count(*) = 1 from public.sessions "
                "where spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac')"
            ),
            # And the general form of the same claim, so a repair that
            # fixed the named pair while leaving another duplicate behind
            # could not pass.
            "no Spond event is held by more than one session": (
                "(select count(*) = 0 from (select spond_event_id "
                "from public.sessions where spond_event_id is not null "
                "group by spond_event_id having count(*) > 1) dupes)"
            ),
        },
    ),
    # ------------------------------------------------------------------
    # 0049_spond_team_reconcile: adds ONE function,
    # public.spond_reconcile_player_team, and nothing else. No table, no
    # column, no index, no policy, no grant on any table, no capability
    # key, no trigger, and no value added to any vocabulary (the
    # audit_events.source CHECK and player_spond_links.matched_by are both
    # untouched). The only privilege it moves is EXECUTE on its own
    # function: revoked from public and anon, granted to authenticated,
    # with the function self gating on players.manage in its body.
    #
    # What the function does: makes one child's CURRENT SEASON team
    # assignment agree with Spond, optionally binding the Spond member id
    # a human confirmed in the same transaction. It refuses to move a
    # child who carries no player_spond_links row, so "never move anybody
    # on a name match" is a database rule rather than a screen's
    # convention. It creates no player identity, deletes and repoints no
    # link, names no season (so no historic or archived registration is
    # addressable), touches no register entry, session or Spond mirror
    # row, and makes no network call.
    #
    # It changes no data. Its own self-verification takes a BEFORE
    # fingerprint of the registrations, links, register entries, stored
    # RSVP, audit rows, policies, grants and triggers in a transaction
    # local table BEFORE the function is created and compares it AFTER, so
    # the "changed nothing" claim is a real comparison across the DDL
    # rather than a value compared with itself. It also reads the STORED
    # function definition back and asserts the boundaries the header
    # claims, so those hold against what will actually run.
    #
    # Its behaviour was exercised against a real PostgreSQL before
    # shipping:
    # .github/scripts/production-migration/test_0049_spond_team_reconcile.sh
    # builds a stand-in and runs the proved move, the Unassigned move, the
    # unlinked refusal, the confirm-and-move, the atomicity of those two
    # halves, both link preservation refusals, every gate, and two
    # connections racing on one child. It needs a local PostgreSQL server
    # and is therefore not part of CI; run it by hand when reviewing.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260812102912 / spond_session_link_unique, checked 2026-08-16.
    # ------------------------------------------------------------------
    "supabase/migrations/0049_spond_team_reconcile.sql": ReviewedMigration(
        path="supabase/migrations/0049_spond_team_reconcile.sql",
        ledger_name="spond_team_reconcile",
        idempotency_key="otj:migration:0049_spond_team_reconcile",
        expected_previous_version="20260812102912",
        expected_previous_name="spond_session_link_unique",
        objects={
            # The function exists with exactly the reviewed signature. The
            # argument types are part of the probe: a different overload
            # would be a different migration.
            "public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = 'spond_reconcile_player_team' "
                "and pg_get_function_identity_arguments(p.oid) = "
                "'uuid, uuid, uuid, text, uuid')"
            ),
            # And it is SECURITY DEFINER with an empty search_path, which
            # is what makes the in body capability check the enforcement
            # rather than a suggestion.
            # chr(34) rather than a literal double quote: the verifier
            # refuses a probe carrying a quote of any kind, so the empty
            # search_path setting is composed instead of written.
            "it is SECURITY DEFINER with an empty search_path": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = 'spond_reconcile_player_team' "
                "and p.prosecdef "
                "and p.proconfig @> array[concat('search_path=', chr(34), chr(34))])"
            ),
            # authenticated may execute it and anon may not. Absent
            # before, present after, like every probe here.
            "authenticated executes it and anon does not": (
                "(select has_function_privilege('authenticated', "
                "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)', 'EXECUTE') "
                "and not has_function_privilege('anon', "
                "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, uuid)', 'EXECUTE'))"
            ),
        },
    ),
}


def lookup(path: str) -> ReviewedMigration:
    """Return the register entry for a path, or exit with the allowed list."""
    entry = REVIEWED_MIGRATIONS.get(path)
    if entry is None:
        allowed = "\n".join(f"  {p}" for p in sorted(REVIEWED_MIGRATIONS))
        raise SystemExit(
            f"FAIL: {path!r} is not a reviewed migration. This workflow applies "
            f"only these:\n{allowed}"
        )
    return entry


def read_migration_sql(path: str) -> str:
    """Read the migration exactly as the ledger will record it.

    Trailing newlines are stripped because that is the shape every existing
    hosted row carries: the recorded statement for 0044_training_day_core
    hashes to the file with its trailing newline removed. The workflow passes
    the same value to psql through command substitution, which strips trailing
    newlines identically, so the hash printed here is the hash the post-apply
    readback compares the stored row against.
    """
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except FileNotFoundError:
        raise SystemExit(f"FAIL: migration file not found: {path}")
    if not raw:
        raise SystemExit(f"FAIL: migration file is empty: {path}")
    if b"\x00" in raw:
        raise SystemExit(f"FAIL: migration file contains a NUL byte: {path}")
    if b"\r" in raw:
        # A CR would survive into the ledger and break the byte-for-byte
        # comparison between the stored statement and the reviewed file.
        raise SystemExit(f"FAIL: migration file contains a carriage return: {path}")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SystemExit(f"FAIL: migration file is not valid UTF-8: {path} ({exc})")

    # The migration is read by psql, which acts on backslash meta-commands. A
    # migration is pure SQL and none of the 46 in this repository has ever
    # started a line with a backslash, so refusing one costs nothing and closes
    # the one way a single reviewed file could pull in a second: `\i`.
    for number, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("\\"):
            raise SystemExit(
                f"FAIL: {path} line {number} is a psql meta-command. A migration is "
                "SQL only; a meta-command could read in another file."
            )
    # psql substitutes :name outside quoted strings. A migration that named one
    # of the apply's own variables could read the interpolated values back or
    # derail the apply, so the collision is refused rather than reasoned about.
    for variable in ("ledger_name", "ledger_key", "created_by", "migration_sql",
                     "migration_path"):
        for form in (f":{variable}", f":'{variable}'", f':"{variable}"'):
            if form in text:
                raise SystemExit(
                    f"FAIL: {path} references the psql variable {form}, which the "
                    "apply sets. Refusing to run it."
                )
    return text.rstrip("\n")


def transaction_shape(sql: str) -> tuple[bool, bool]:
    """Does the migration open and close its own transaction?

    The apply wraps `\\i <file>` in an outer BEGIN so the ledger insert and the
    DDL commit together. That only holds because the file itself ends with a
    COMMIT: the file's own COMMIT is what commits the outer transaction, and
    any failure before it rolls the ledger row back with the schema. A file
    that does not close its own transaction is still applied atomically by the
    outer COMMIT, but a file with a stray COMMIT in the middle would not be, so
    the shape is reported and asserted rather than assumed.
    """
    statements = [
        line.strip().lower().rstrip(";").strip()
        for line in sql.splitlines()
        if line.strip() and not line.strip().startswith("--")
    ]
    opens = statements[0] == "begin" if statements else False
    closes = statements[-1] == "commit" if statements else False
    return opens, closes


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def md5_hex(text: str) -> str:
    """The hash the hosted ledger row's statements[1] must match after apply."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def plan(path: str, commit: str) -> list[str]:
    entry = lookup(path)
    sql = read_migration_sql(entry.path)
    opens, closes = transaction_shape(sql)
    if not closes:
        raise SystemExit(
            f"FAIL: {entry.path} does not end with COMMIT. The apply relies on "
            "the file closing its own transaction; refusing to guess."
        )
    if not opens:
        raise SystemExit(
            f"FAIL: {entry.path} does not begin with BEGIN. The apply relies on "
            "the file being one transaction; refusing to guess."
        )
    return [
        "## Production migration apply plan",
        "",
        "This run applies **one** reviewed migration file and records it in the",
        "hosted ledger. It deploys no frontend code and no Edge Function.",
        "",
        "| Field | Value |",
        "|---|---|",
        f"| Commit | `{commit}` |",
        f"| Migration file | `{entry.path}` |",
        f"| SHA-256 of the file | `{sha256_hex(sql)}` |",
        f"| MD5 of the recorded statement | `{md5_hex(sql)}` |",
        f"| Bytes recorded | {len(sql.encode('utf-8'))} |",
        f"| Ledger name | `{entry.ledger_name}` |",
        f"| Ledger idempotency key | `{entry.idempotency_key}` |",
        f"| Requires ledger newest to still be | `{entry.expected_previous_version}` / "
        f"`{entry.expected_previous_name}` |",
        "",
        "The hosted ledger version is assigned BY THE APPLY from the database",
        "server clock, so it cannot be printed here. It is read back and printed",
        "after the apply.",
        "",
    ]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--migration", required=True)
    parser.add_argument("--commit", default=os.environ.get("GITHUB_SHA", "unknown"))
    args = parser.parse_args(argv[1:])

    lines = plan(args.migration, args.commit)
    for line in lines:
        print(line)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
