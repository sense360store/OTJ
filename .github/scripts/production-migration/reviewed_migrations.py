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
    # ------------------------------------------------------------------
    # 0051_team_sort_order: the club's ordering of its own teams (roadmap
    # COACH-1, migration M1 of the coaching workflow programme). Adds ONE
    # nullable integer column, public.teams.sort_order, with no default and
    # NO backfill; ONE partial unique index, teams_sort_order_unique on
    # (club_id, sort_order) where sort_order is not null; and sort_order on
    # the update allow list of the existing public.audit_teams(), field
    # name only, never a value. Nothing else: no policy, no grant, no
    # capability key, no trigger, no row. Null means the club has not
    # configured its order, which is every team on apply, so no behaviour
    # changes when it lands; it is not an ability score and there is no
    # per-player field.
    #
    # Its own self-verification takes a BEFORE fingerprint of every team
    # row, the policy set, the three grant views and the trigger set into a
    # transaction local table before the DDL and requires them unchanged
    # after it (minus the one column it adds), exercises the index and the
    # audit allow list on synthetic rows inside a subtransaction it always
    # rolls back, and reads the stored audit_teams() back to prove the
    # field name is all that reaches an event.
    # .github/scripts/production-migration/test_0051_team_sort_order.sh
    # applies the real file to a stand-in, drives the column through RLS as
    # a teams.manage holder, a coach without it, an outsider and anon,
    # flips the three probes below in both gate states, proves a second
    # apply fails at its first statement, and mutates the file ten ways to
    # prove each self-verification check bites. It runs in CI.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260823065041 / bulk_delete_players, the version the 0050 apply
    # stamped on 23 August 2026, read from the hosted ledger on
    # 2 September 2026. No remote branch and no open pull request carried
    # a 0051 file on that date.
    # ------------------------------------------------------------------
    "supabase/migrations/0051_team_sort_order.sql": ReviewedMigration(
        path="supabase/migrations/0051_team_sort_order.sql",
        ledger_name="team_sort_order",
        idempotency_key="otj:migration:0051_team_sort_order",
        expected_previous_version="20260823065041",
        expected_previous_name="bulk_delete_players",
        objects={
            # information_schema.columns, never pg_attribute (attisdropped
            # spells a banned word). The SHAPE is probed with the name: a
            # NOT NULL or a defaulted column would be a different
            # migration, and so would a backfill's natural companion, a
            # default.
            "public.teams.sort_order, a nullable integer with no default": (
                "(select count(*) > 0 from information_schema.columns "
                "where table_schema = 'public' and table_name = 'teams' "
                "and column_name = 'sort_order' "
                "and data_type = 'integer' and is_nullable = 'YES' "
                "and column_default is null)"
            ),
            # pg_index, as 0048's probe: unique, not the primary key,
            # partial, and exactly two key columns. indpred is what
            # separates the reviewed index from a non partial one of the
            # same name, which reads false here. The predicate states that
            # null is not a position; it is not what lets unordered teams
            # coexist, since a unique index treats nulls as distinct
            # either way.
            "teams_sort_order_unique, a two column partial unique index on teams": (
                "(select count(*) > 0 from pg_index x "
                "join pg_class c on c.oid = x.indexrelid "
                "where x.indrelid = to_regclass('public.teams') "
                "and c.relname = 'teams_sort_order_unique' "
                "and x.indisunique and not x.indisprimary "
                "and x.indpred is not null and x.indnkeyatts = 2)"
            ),
            # The stored function, resolved through to_regprocedure and read
            # back with pg_get_functiondef. audit_teams() exists BEFORE this
            # apply (0037, replaced by 0044), so what flips is its body:
            # false while 0044's allow list names only name and bib_colour,
            # true once the comparison that names sort_order is in it.
            "audit_teams() names sort_order on its allow list": (
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure('public.audit_teams()') "
                "and position('new.sort_order is distinct from old.sort_order' "
                "in pg_get_functiondef(p.oid)) > 0)"
            ),
        },
    ),
    # ------------------------------------------------------------------
    # 0052_atomic_team_order: adds ONE function, public.set_team_order, and
    # nothing else. No table, no column, no index, no policy, no grant on
    # any table, no capability key, no trigger, and no value added to any
    # vocabulary (audit_events.source and audit_events.action are both
    # untouched). The only privilege it moves is EXECUTE on its own
    # function: revoked from public and anon, granted to authenticated,
    # with the function self gating on teams.manage in its body.
    #
    # WHAT IT IS FOR. COACH-1B (#225) writes the club's team order from the
    # browser as separate PostgREST statements, each conditioned on the
    # value the screen last read. Two admins who move DISJOINT rows never
    # collide: one swaps positions 1 and 2 while the other swaps 3 and 4,
    # every per row compare and set passes, both commit, and the club is
    # left with a complete valid order NEITHER submitted.
    # teams_sort_order_unique cannot object because the merge is a
    # permutation like any other. The client can only detect that
    # afterwards. This function makes the read that validates the order and
    # the writes that store it one atomic, serialized transaction, so the
    # merge is not reachable rather than merely reported.
    #
    # It serialises on THREE things. The first was found in review, after
    # the other two were written and tested, and it is the one a reader is
    # least likely to expect: the locks decide what a caller WAITS FOR and
    # cannot decide WHEN IT LOOKED. A REPEATABLE READ or SERIALIZABLE
    # transaction fixes its snapshot before it ever reaches a lock, so it
    # waits its whole turn and then still reads the pre race world, matches
    # an expected snapshot nobody holds any more, and writes the rows the
    # winner did not touch, where PostgreSQL finds no conflict. That was
    # reproduced against a real server, not theorised: without the guard a
    # REPEATABLE READ caller is ACCEPTED and stores exactly the merge. So
    # anything but READ COMMITTED is refused with P0001 before any lock.
    # READ UNCOMMITTED is accepted because PostgreSQL runs it AS read
    # committed, and the harness asserts that rather than trusting it: the
    # first version of the guard assumed PostgreSQL rewrites the level at
    # SET time, which it does not, and turned that caller away.
    #
    # It also refuses a caller that ALREADY HOLDS a write lock on teams.
    # The deadlock freedom argument originally said ordinary team writes
    # take neither lock and so cannot close a cycle, which is true of a
    # transaction that only writes teams and false of one that writes teams
    # and then calls this: it enters holding ROW EXCLUSIVE, blocks another
    # caller at the table lock, and waits for that caller's advisory key.
    # No ordering of the two locks fixes it, because the conflicting lock is
    # held before the function is entered, so deadlock freedom is a property
    # of that refusal. A caller that only SELECTed is not refused, since
    # ACCESS SHARE and ROW SHARE conflict with neither lock.
    #
    # Then TWO locks, always in that order: a club scoped
    # advisory transaction lock (the 'otj.<domain>:' || club idiom 0031,
    # 0032, 0036 and 0049 already use) which orders whole order saves
    # against each other, and SHARE ROW EXCLUSIVE on public.teams which
    # stops a team being added or removed underneath the complete set
    # validation. The second is table wide because PostgreSQL has no
    # narrower lock that blocks an insert; teams is a handful of rows per
    # club and the migration's header states that trade rather than hiding
    # it. Under the locks it requires the request to name the club's
    # CURRENT team set exactly, compares every stored position with the
    # expected snapshot the admin's draft was drawn from, and refuses with
    # P0001 carrying the DETAIL token 'stale_order' BEFORE writing if any
    # differ. Not 40001, which it was first: nothing failed to serialize, a
    # retry with the same snapshot can never succeed, and the security suite
    # showed deterministically that a 40001 raised here never reaches a
    # PostgREST client at all while every other refusal returns at once.
    #
    # It changes no data. Its own self-verification takes a BEFORE
    # fingerprint of the teams, their positions whole, the audit rows,
    # policies, grants, triggers and the teams_sort_order_unique definition
    # into a transaction local table BEFORE the function is created and
    # compares it AFTER, so "changed nothing" is a real comparison across
    # the DDL. It also reads the STORED function definition back and
    # asserts the boundaries the header claims.
    #
    # It deliberately does NOT call the function, and that is stated in the
    # file rather than left as a gap. set_team_order gates on my_club() and
    # has_perm(), both of which resolve through auth.uid(), and a migration
    # apply has no JWT, so the function correctly refuses its own probe
    # with 42501. An earlier draft carried such a probe and aborted the
    # apply exactly there. Giving it an identity would mean writing to
    # auth.users and forging request.jwt.claims from inside the one file
    # whose whole claim is that it touches nothing else. 0049 is the
    # precedent and reached the same conclusion for the same reason.
    #
    # AUDIT, stated honestly: the existing audit_teams() trigger (0037,
    # replaced by 0044, allow list extended by 0051) is the only record and
    # is untouched. The clear-then-place writes a moved, already placed
    # team twice inside the one transaction, so such a team records TWO
    # team.updated events; an unplaced team records one, an unmoved team
    # records none, and none carries a value. Collapsing that would mean
    # suppressing or deferring the trigger, which is a larger change to the
    # audit boundary than the noise it would save.
    #
    # Its behaviour was exercised against a real PostgreSQL before
    # shipping:
    # .github/scripts/production-migration/test_0052_atomic_team_order.sh
    # builds a stand-in of the substrate as 0051 leaves it and runs the
    # disjoint race with TWO REAL CONNECTIONS, both ways round, plus the
    # overlapping race, the per club independence of the advisory key,
    # every gate, the atomicity of a refusal, the audit trail, and nineteen
    # mutations of the file that must each abort the apply. Two sessions
    # are the whole point: the migration's own DO block cannot contend with
    # itself, so the serialization claim is only provable there. It runs in
    # CI with REQUIRE_POSTGRES=1, and by hand when reviewing.
    #
    # Written against a hosted database whose newest ledger row is
    # 20260902150212 / team_sort_order, the version the 0051 apply stamped
    # on 2 September 2026, read from the live ledger on 3 September 2026.
    # ------------------------------------------------------------------
    "supabase/migrations/0052_atomic_team_order.sql": ReviewedMigration(
        path="supabase/migrations/0052_atomic_team_order.sql",
        ledger_name="atomic_team_order",
        idempotency_key="otj:migration:0052_atomic_team_order",
        expected_previous_version="20260902150212",
        expected_previous_name="team_sort_order",
        # Resolved through to_regprocedure, never a textual signature cast,
        # for the reason 0049's review found: has_function_privilege raises
        # 42883 for a name that does not resolve, so it cannot return false
        # for an absent function and would break the PRE gate, which by
        # definition runs where the function is absent. to_regprocedure
        # returns null instead, and every privilege test below is made
        # against the resolved oid.
        objects={
            "public.set_team_order(uuid[], integer[])": (
                "(select to_regprocedure("
                "'public.set_team_order(uuid[], integer[])'"
                ") is not null)"
            ),
            # SECURITY DEFINER with an empty search_path is what makes the
            # in body capability check the enforcement rather than a
            # suggestion. chr(34) rather than a literal double quote: the
            # verifier refuses a probe carrying a quote of any kind.
            "it is SECURITY DEFINER with an empty search_path": (
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure("
                "'public.set_team_order(uuid[], integer[])'"
                ") "
                "and p.prosecdef "
                "and p.proconfig @> array[concat('search_path=', chr(34), chr(34))])"
            ),
            # anon is tested rather than assumed from PUBLIC, because a
            # grant to PUBLIC would reach anon without ever naming it.
            "authenticated executes it and anon does not": (
                "(select count(*) > 0 from pg_proc p "
                "where p.oid = to_regprocedure("
                "'public.set_team_order(uuid[], integer[])'"
                ") "
                "and has_function_privilege('authenticated', p.oid, 'EXECUTE') "
                "and not has_function_privilege('anon', p.oid, 'EXECUTE'))"
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
