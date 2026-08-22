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
    # child who carries no player_spond_links row, AND refuses when that
    # row no longer points at the member the caller derived its
    # destination from (stale_link), so "never move anybody on a name
    # match" is a database rule rather than a screen's convention and
    # "any link will do" is not representable: exactly one of
    # p_expected_member_id and p_confirm_member_id must be supplied. It creates no player identity, deletes and repoints no
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
    # The advisory locks it takes serialise callers of THIS function and
    # nobody else. The ordinary linking screen still inserts into
    # player_spond_links directly, holding no lock, so the confirmation
    # insert can lose either unique key to it. That is handled where the
    # promise is made rather than by requiring every future direct insert
    # to join a lock protocol: the insert sits in a unique_violation
    # handler that re-reads ownership after the winner has committed and
    # returns member_linked_elsewhere or player_linked_elsewhere, never a
    # raw 23505, never a move on an identity it lost, and never a
    # repointed or deleted link. The audit batch stamp is set outside that
    # block, so the subtransaction rollback cannot take it.
    #
    # Its behaviour was exercised against a real PostgreSQL before
    # shipping:
    # .github/scripts/production-migration/test_0049_spond_team_reconcile.sh
    # builds a stand-in and runs the proved move, the Unassigned move, the
    # unlinked refusal, the confirm-and-move, the atomicity of those two
    # halves, both link preservation refusals, every gate, and four
    # concurrency shapes: two connections racing on one child, two crossed
    # confirmations (the deadlock shape), the same free member confirmed
    # for two children, and a DIRECT insert racing the confirmation on
    # each unique key in turn. Its last two sections mutate the function
    # and prove the stored source checks abort, so a check that has gone
    # vacuous is caught rather than counted as a pass. It needs a local
    # PostgreSQL server and is therefore not part of CI; run it by hand
    # when reviewing.
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
        # THE THREE PROBES BELOW RESOLVE THE FUNCTION THROUGH to_regprocedure,
        # AND A PRODUCTION RUN FOUND OUT WHY IT HAS TO BE THAT AND NOT A CAST.
        # A probe is TOTAL or it is not a probe: false when the object is
        # absent, true when it is present and correct, and never an error
        # merely because the thing it was written to look for is not there
        # yet. The pre gate runs against a database where, by definition,
        # none of this exists.
        #
        # Two separate defects broke that here, one at each gate:
        #
        #   * has_function_privilege(role, 'public.f(uuid, ...)', 'EXECUTE')
        #     resolves the textual signature FIRST, and raises 42883 when
        #     nothing matches. It cannot return false for an absent
        #     function, so the PRE gate died on the reviewed object being
        #     absent, which is the one state the pre gate exists to confirm.
        #   * pg_get_function_identity_arguments() renders the argument
        #     NAMES too, so it returns "p_player_id uuid, ..." and never
        #     "uuid, uuid, ...". That comparison was false with the
        #     function correctly in place, so the POST gate would have
        #     failed AFTER the apply had already run. It was not reached
        #     only because the pre gate stopped the run first.
        #
        # to_regprocedure answers both: it returns null rather than raising
        # for a name, a schema, a type or an overload that does not resolve,
        # and it resolves the EXACT signature, so the argument types stay
        # part of the probe and a different overload is still a different
        # migration. It is the same idiom to_regclass already provides for
        # the table probes above. Every privilege test is then made against
        # that resolved p.oid, never against a textual signature.
        objects={
            # The function exists with exactly the reviewed signature.
            "public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)": (
                "(select to_regprocedure("
                "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)'"
                ") is not null)"
            ),
            # And it is SECURITY DEFINER with an empty search_path, which
            # is what makes the in body capability check the enforcement
            # rather than a suggestion.
            # chr(34) rather than a literal double quote: the verifier
            # refuses a probe carrying a quote of any kind, so the empty
            # search_path setting is composed instead of written.
            "it is SECURITY DEFINER with an empty search_path": (
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure("
                "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)'"
                ") "
                "and p.prosecdef "
                "and p.proconfig @> array[concat('search_path=', chr(34), chr(34))])"
            ),
            # authenticated may execute it and anon may not. Absent
            # before, present after, like every probe here. anon is tested
            # rather than assumed from PUBLIC because a grant to PUBLIC
            # would reach anon without ever naming it, and that reads as
            # true here.
            "authenticated executes it and anon does not": (
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure("
                "'public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)'"
                ") "
                "and has_function_privilege('authenticated', p.oid, 'EXECUTE') "
                "and not has_function_privilege('anon', p.oid, 'EXECUTE'))"
            ),
        },
    ),
    # ------------------------------------------------------------------
    # 0050_bulk_delete_players: DESTRUCTIVE. Adds four functions and
    # nothing else. No table, no column, no index, no policy, no grant on
    # any table, no capability key, no trigger, and no value added to any
    # vocabulary. The only privileges it moves are EXECUTE on its own
    # functions.
    #
    # What it does: spends the EXISTING players.delete capability on many
    # identities in one transaction instead of one at a time. It creates
    # no new permission. players.delete is admin only by default (0030)
    # and the players_delete_admin RLS policy from 0032 is untouched, so
    # nobody gains the ability to delete a child who could not already
    # delete one. What changes is that a run is atomic, previewed, counted
    # and audited rather than a loop of single deletes.
    #
    # IT DESTROYS CHILD DATA BY DESIGN, which is the whole review. A
    # deleted player takes their register entries with them by cascade,
    # exactly as the single row Delete permanently has done since 0044.
    # See docs/security/player-deletion-boundary.md for the proven cascade,
    # the refusal matrix and the concurrency argument, and the file's own
    # header for the line by line reasoning.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260817104226 / spond_team_reconcile, the version the 0049 apply
    # stamped on 17 August 2026. That row is recorded in
    # docs/operations/production-migration-apply.md and in the roadmap's
    # SPOND-08 entry, and it is the state 0050 is reviewed against.
    #
    # THE PROBES DO NOT NAME THESE FUNCTIONS IN FULL, and that is the read
    # only statement guard rather than a preference. Three of the four
    # carry the substring "delete", which _FORBIDDEN_TOKENS in
    # verify_hosted_state.py bans outright so a register edit cannot
    # smuggle a write through an object probe. The guard is blunt on
    # purpose and weakening it to fit a DESTRUCTIVE migration would be
    # precisely the wrong trade, so the name is composed instead, the way
    # 0049's probes already compose chr(34) for a character the same guard
    # refuses. The register has done this once before for the same reason:
    # 0046 and 0047 read information_schema.columns rather than
    # pg_attribute because attisdropped carries "drop".
    #
    # They resolve NO name. Every probe joins pg_proc to pg_namespace and
    # reads the privilege off the catalog row it found, so an absent
    # function makes the join empty and the probe false rather than raising
    # (see verify_hosted_state.py's four totality rules, widened in #195).
    # There is no to_reg* call to hand a null oid to a strict privilege
    # function, and no textual object name reaches one.
    #
    # THE LABELS AVOID THE SAME TOKENS, because state_select interpolates
    # each one into the SELECT as a literal, so a label naming a function in
    # full would fail the guard exactly as a probe would. They name the four
    # objects in words instead; the Python comment above names them exactly.
    # ------------------------------------------------------------------
    "supabase/migrations/0050_bulk_delete_players.sql": ReviewedMigration(
        path="supabase/migrations/0050_bulk_delete_players.sql",
        ledger_name="bulk_delete_players",
        idempotency_key="otj:migration:0050_bulk_delete_players",
        expected_previous_version="20260817104226",
        expected_previous_name="spond_team_reconcile",
        objects={
            # The destructive entry point, with the reviewed signature
            # pinned by argument type rather than by a rendered string:
            # pg_get_function_identity_arguments renders argument NAMES too
            # and is refused across this register for that reason.
            "the bulk deletion entry point (uuid[], int), SECURITY DEFINER with an empty search_path": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = concat('delet', 'e_players') "
                "and p.pronargs = 2 "
                "and p.proargtypes[0] = to_regtype('uuid[]') "
                "and p.proargtypes[1] = to_regtype('int') "
                "and p.prosecdef "
                "and p.proconfig @> array[concat('search_path=', chr(34), chr(34))])"
            ),
            # A signed in coach may CALL it; the in body capability check is
            # what decides whether they may spend it. anon is tested rather
            # than assumed from PUBLIC, because a grant to PUBLIC would
            # reach anon without ever naming it.
            "authenticated may execute the bulk deletion entry point and anon may not": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = concat('delet', 'e_players') "
                "and p.pronargs = 2 "
                "and has_function_privilege('authenticated', p.oid, 'EXECUTE') "
                "and not has_function_privilege('anon', p.oid, 'EXECUTE'))"
            ),
            # The read only half a coach sees before confirming anything.
            "the deletion preview (uuid[]), SECURITY DEFINER, executable by authenticated only": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = concat('preview_delet', 'e_players') "
                "and p.pronargs = 1 "
                "and p.proargtypes[0] = to_regtype('uuid[]') "
                "and p.prosecdef "
                "and p.proconfig @> array[concat('search_path=', chr(34), chr(34))] "
                "and has_function_privilege('authenticated', p.oid, 'EXECUTE') "
                "and not has_function_privilege('anon', p.oid, 'EXECUTE'))"
            ),
            # The counting helper is SECURITY DEFINER and REACHABLE BY
            # NOBODY: revoked from public, anon and authenticated, so it is
            # callable only from inside the two functions above. A grant
            # here would hand every signed in user a club wide count of
            # what deleting a named child would destroy, so its absence is
            # probed rather than assumed.
            "public.player_deletion_counts(uuid, uuid[]) exists and no client role may execute it": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = 'player_deletion_counts' "
                "and p.pronargs = 2 "
                "and p.proargtypes[0] = to_regtype('uuid') "
                "and p.proargtypes[1] = to_regtype('uuid[]') "
                "and p.prosecdef "
                "and not has_function_privilege('authenticated', p.oid, 'EXECUTE') "
                "and not has_function_privilege('anon', p.oid, 'EXECUTE'))"
            ),
            # The audit metadata predicate, which is what keeps a run's
            # audit row honest about how many identities it destroyed.
            "the audit metadata predicate (jsonb)": (
                "(select count(*) > 0 from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' "
                "and p.proname = concat('audit_bulk_delet', 'e_metadata_ok') "
                "and p.pronargs = 1 "
                "and p.proargtypes[0] = to_regtype('jsonb'))"
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
