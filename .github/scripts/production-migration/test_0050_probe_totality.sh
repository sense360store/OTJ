#!/usr/bin/env bash
#
# The 0050_bulk_delete_players object probes, composed by the real verifier and
# run against a real PostgreSQL, in the state the pre gate reads and the state
# the post gate reads.
#
# WHY 0050 GETS ITS OWN FILE. test_probe_totality.sh proves the guard's rules
# against 0049 and against four synthetic object classes. This one proves the
# REGISTERED probes of a DESTRUCTIVE migration, and they are shaped unlike
# every other entry in the register for two reasons worth pinning:
#
#   1. THEY RESOLVE NO NAME AT ALL. Where 0049 resolves through to_regprocedure
#      and reads the ACL off the resolved oid, these join pg_proc to
#      pg_namespace and read it off the row the join found. Absence safe by
#      construction: an absent function is an empty join, so the probe is false
#      rather than null and rather than an error. There is no resolver result
#      to hand to a strict privilege function, which is the trap #195 added
#      rule 3 for.
#
#   2. THEY DO NOT SPELL THE FUNCTION NAMES. Three of the four carry the
#      substring "delete", which assert_select_only bans outright as a
#      substring of the whole statement so that no register edit can smuggle a
#      write in through a probe. That guard is blunt on purpose, and weakening
#      it to fit a migration that DELETES CHILD DATA would be the wrong trade in
#      the wrong place, so the names are composed instead. This file is what
#      proves the composed name still identifies the real function: it creates
#      stand-ins carrying the reviewed signatures and grants, and watches every
#      probe flip.
#
# The stand-ins are faithful subjects because the probes read pg_proc and the
# ACL and nothing else. Nothing here reads, writes or connects to any hosted
# project, and the reviewed migration file is never modified.
#
# Run by hand:  bash .github/scripts/production-migration/test_0050_probe_totality.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION_PATH="supabase/migrations/0050_bulk_delete_players.sql"

REQUIRE_POSTGRES="${REQUIRE_POSTGRES:-0}"
skip_or_fail() {
  if [ "${REQUIRE_POSTGRES}" = "1" ]; then
    echo "FAIL: $1 (REQUIRE_POSTGRES=1, so this run must not skip)"
    exit 1
  fi
  echo "SKIP: $1"
  exit 0
}

PGBIN="${PGBIN:-}"
if [ -z "${PGBIN}" ]; then
  for candidate in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /usr/pgsql-*/bin; do
    if [ -x "${candidate}/initdb" ]; then PGBIN="${candidate}"; break; fi
  done
fi
if [ -z "${PGBIN}" ] || [ ! -x "${PGBIN}/initdb" ]; then
  skip_or_fail "no PostgreSQL server binaries found (set PGBIN to a directory containing initdb)"
fi

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  RUN_AS="${PGUSER_ACCOUNT:-postgres}"
  if ! getent passwd "${RUN_AS}" >/dev/null; then
    skip_or_fail "running as root and no ${RUN_AS} account exists to own the cluster"
  fi
fi

WORK="$(mktemp -d)"
if [ -n "${RUN_AS}" ]; then WORK="$(su "${RUN_AS}" -c 'mktemp -d')"; fi
chmod 711 "${WORK}"
DATA="${WORK}/data"
PORT="${PGPORT_TEST:-5459}"

as_owner() { if [ -n "${RUN_AS}" ]; then su "${RUN_AS}" -c "$1"; else bash -c "$1"; fi }
cleanup() {
  as_owner "${PGBIN}/pg_ctl -D ${DATA} -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "${WORK}" 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; exit 1; }
ok() { echo "  ok: $1"; }
same() { [ "$2" = "$3" ] || fail "$1 (expected '$3', got '$2')"; ok "$1"; }

echo "== starting a throwaway PostgreSQL in ${WORK}"
as_owner "${PGBIN}/initdb -D ${DATA} -U postgres --auth=trust" >"${WORK}/initdb.log" 2>&1
as_owner "${PGBIN}/pg_ctl -D ${DATA} -o '-k ${WORK} -h \"\" -p ${PORT}' -l ${WORK}/server.log start -w" >/dev/null

psql_run() { PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' psql --no-psqlrc --set ON_ERROR_STOP=1 "$@"; }
DB=otj_0050
psql_run -d postgres -q -c "create database ${DB}" >/dev/null
run() { psql_run -d "${DB}" -q -c "$1" >/dev/null; }
scalar() { psql_run -d "${DB}" -tAc "$1"; }

run "create role authenticated"
run "create role anon"

# A stand-in ledger holding the row 0050 is REVIEWED AGAINST: the version the
# 0049 apply stamped on 17 August 2026.
run "create schema supabase_migrations"
run "create table supabase_migrations.schema_migrations (
       version text primary key, name text, statements text[], idempotency_key text)"
run "insert into supabase_migrations.schema_migrations (version, name, statements, idempotency_key)
     values ('20260817104226', 'spond_team_reconcile', array['-- reviewed elsewhere'],
             'otj:migration:0049_spond_team_reconcile')"

compose() {
  PYTHONPATH="${HERE}" python3 - "$1" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm, verify_hosted_state as vh
repo = os.path.abspath(os.path.join(os.environ["PYTHONPATH"], "..", "..", ".."))
entry = rm.lookup(sys.argv[1])
md5 = rm.md5_hex(rm.read_migration_sql(os.path.join(repo, entry.path)))
sys.stdout.write(vh.build_script(vh.state_select(entry, md5)))
PYEOF
}

compose "${MIGRATION_PATH}" >"${WORK}/state.sql"

read_state() {
  set +e
  PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -t -A -d "${DB}" -f "${WORK}/state.sql" \
    >"${WORK}/state.json" 2>"${WORK}/state.err"
  local rc=$?
  set -e
  return ${rc}
}

probe() { python3 -c "
import json,sys
print(json.load(open(sys.argv[1]))['objects'][sys.argv[2]])
" "${WORK}/state.json" "$1"; }

gate() {
  set +e
  ( cd "${REPO}" && python3 "${HERE}/verify_hosted_state.py" \
      --phase "$1" --migration "${MIGRATION_PATH}" --sample "${WORK}/state.json" ) \
      >"${WORK}/gate.out" 2>&1
  local rc=$?
  set -e
  return ${rc}
}

P_ENTRY="the bulk deletion entry point (uuid[], int), SECURITY DEFINER with an empty search_path"
P_ACL="authenticated may execute the bulk deletion entry point and anon may not"
P_PREVIEW="the deletion preview (uuid[]), SECURITY DEFINER, executable by authenticated only"
P_COUNTS="public.player_deletion_counts(uuid, uuid[]) exists and no client role may execute it"
P_AUDIT="the audit metadata predicate (jsonb)"
ALL=("${P_ENTRY}" "${P_ACL}" "${P_PREVIEW}" "${P_COUNTS}" "${P_AUDIT}")

echo
echo "== A. the composed statement is read only AND carries no banned word"
grep -q "set transaction read only" "${WORK}/state.sql" || fail "the composed script is not read only"
grep -q "rollback;" "${WORK}/state.sql" || fail "the composed script does not roll back"
# The whole point of sql_text_value: the ledger name is bulk_delete_players and
# the statement asks about it without ever spelling the banned word.
grep -qi "delete" "${WORK}/state.sql" && fail "the composed statement spells a forbidden token"
grep -q "concat('bulk_delet', 'e_players')" "${WORK}/state.sql" \
  || fail "the ledger name is not composed, so the guard cannot have passed honestly"
ok "read only, rollback only, and the ledger name composed rather than spelled"

echo
echo "== B. PRE state: none of the four functions exists"
same "the entry point really is absent" \
  "$(scalar "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = concat('delet', 'e_players')")" "0"
read_state || fail "the composed query ERRORED against absent functions: $(cat "${WORK}/state.err")"
ok "the composed query ran without error, which is what absence safe means"
for label in "${ALL[@]}"; do
  same "absent: ${label:0:52}" "$(probe "${label}")" "False"
done
gate pre || fail "the pre gate rejected a correct pre-apply database: $(cat "${WORK}/gate.out")"
ok "the pre gate PASSES, so a run would proceed to the apply"
gate post && fail "the post gate passed on a database where nothing was applied" || true
ok "and the post gate correctly refuses the same read"

echo
echo "== C. POST state: created exactly as 0050 creates them"
run "create function public.audit_bulk_delete_metadata_ok(p_metadata jsonb)
     returns boolean language sql immutable set search_path = '' as \$fn\$ select true \$fn\$"
run "create function public.player_deletion_counts(p_club uuid, p_ids uuid[])
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
run "revoke execute on function public.player_deletion_counts(uuid, uuid[]) from public, anon, authenticated"
run "create function public.preview_delete_players(p_player_ids uuid[])
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
run "revoke execute on function public.preview_delete_players(uuid[]) from public, anon"
run "grant execute on function public.preview_delete_players(uuid[]) to authenticated"
run "create function public.delete_players(p_player_ids uuid[], p_expected_count int)
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
run "revoke execute on function public.delete_players(uuid[], int) from public, anon"
run "grant execute on function public.delete_players(uuid[], int) to authenticated"

read_state || fail "the composed query errored with the functions present: $(cat "${WORK}/state.err")"
for label in "${ALL[@]}"; do
  same "present: ${label:0:52}" "$(probe "${label}")" "True"
done
gate pre && fail "the pre gate passed with the reviewed objects already present" || true
ok "the pre gate now refuses, so a repeat press stops before applying twice"

PYTHONPATH="${HERE}" python3 - "${REPO}/${MIGRATION_PATH}" >"${WORK}/ledger.sql" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm
sql = rm.read_migration_sql(sys.argv[1])
tag = "$OTJMIG$"
assert tag not in sql, "the dollar quote tag collides with the migration body"
sys.stdout.write(
    "insert into supabase_migrations.schema_migrations "
    "(version, name, statements, idempotency_key) values ('20260818090000', "
    "'bulk_delete_players', array[" + tag + sql + tag + "], "
    "'otj:migration:0050_bulk_delete_players');\n"
)
PYEOF
psql_run -d "${DB}" -q -f "${WORK}/ledger.sql" >/dev/null

read_state || fail "the composed query errored after the ledger row: $(cat "${WORK}/state.err")"
gate post || fail "the post gate rejected a correct applied database: $(cat "${WORK}/gate.out")"
ok "the post gate PASSES against the ledger row 0050's apply would write"

echo
echo "== D. the boundary probes refuse what they were written to refuse"
neg() { # neg <message> <probe label> <setup> <teardown>
  run "$3"
  read_state || fail "$1: the composed query errored instead of answering"
  same "$1" "$(probe "$2")" "False"
  run "$4"
}

# The destructive entry point must not be reachable by anon.
neg "anon granted the bulk deletion is refused" "${P_ACL}" \
  "grant execute on function public.delete_players(uuid[], int) to anon" \
  "revoke execute on function public.delete_players(uuid[], int) from anon"
neg "a grant to PUBLIC is refused, because anon inherits it" "${P_ACL}" \
  "grant execute on function public.delete_players(uuid[], int) to public" \
  "revoke execute on function public.delete_players(uuid[], int) from public"
neg "authenticated without EXECUTE is refused" "${P_ACL}" \
  "revoke execute on function public.delete_players(uuid[], int) from authenticated" \
  "grant execute on function public.delete_players(uuid[], int) to authenticated"
# The counting helper must stay reachable by nobody: a grant would hand every
# signed in user a club wide count of what deleting a named child destroys.
neg "the counting helper granted to authenticated is refused" "${P_COUNTS}" \
  "grant execute on function public.player_deletion_counts(uuid, uuid[]) to authenticated" \
  "revoke execute on function public.player_deletion_counts(uuid, uuid[]) from authenticated"
neg "the counting helper granted to PUBLIC is refused" "${P_COUNTS}" \
  "grant execute on function public.player_deletion_counts(uuid, uuid[]) to public" \
  "revoke execute on function public.player_deletion_counts(uuid, uuid[]) from public"
neg "the preview granted to anon is refused" "${P_PREVIEW}" \
  "grant execute on function public.preview_delete_players(uuid[]) to anon" \
  "revoke execute on function public.preview_delete_players(uuid[]) from anon"

# SECURITY DEFINER and the empty search_path are each load bearing: the in body
# capability check is the enforcement, and it is only enforcement if the
# function runs as its owner with a search_path nobody can move.
run "drop function public.delete_players(uuid[], int)"
run "create function public.delete_players(p_player_ids uuid[], p_expected_count int)
     returns jsonb language plpgsql set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
read_state || fail "the composed query errored on a non secdef entry point"
same "SECURITY INVOKER is refused" "$(probe "${P_ENTRY}")" "False"
run "drop function public.delete_players(uuid[], int)"
run "create function public.delete_players(p_player_ids uuid[], p_expected_count int)
     returns jsonb language plpgsql security definer set search_path = 'public'
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
read_state || fail "the composed query errored on a non empty search_path"
same "a non empty search_path is refused" "$(probe "${P_ENTRY}")" "False"

# A same named function of a DIFFERENT shape is not the reviewed one.
run "drop function public.delete_players(uuid[], int)"
run "create function public.delete_players(p_player_ids uuid[])
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
read_state || fail "the composed query errored on a wrong overload"
same "a one argument overload is not the reviewed entry point" "$(probe "${P_ENTRY}")" "False"
same "and its ACL probe does not answer for it either" "$(probe "${P_ACL}")" "False"
run "drop function public.delete_players(uuid[])"

echo
echo "== E. and the shapes this register REFUSED are proved to be defects"
#
# Without this the file only says the registered probes work. It would pass
# just as happily over a register that had reached for a shortcut, so the two
# shortcuts are run here on the same server.

old_probe() {
  set +e
  local out
  out="$(PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres psql --no-psqlrc \
    --set ON_ERROR_STOP=1 -q -t -A -d "${DB}" -c "select $1" 2>/dev/null)"
  local rc=$?
  set -e
  if [ ${rc} -ne 0 ]; then echo "THREW"; else echo "${out}"; fi
}

# Everything is absent again at this point except the three helpers.
run "drop function public.preview_delete_players(uuid[])"
run "drop function public.player_deletion_counts(uuid, uuid[])"
run "drop function public.audit_bulk_delete_metadata_ok(jsonb)"

same "the eager textual form THROWS for the absent entry point, which is why it is not used" \
  "$(old_probe "has_function_privilege('authenticated', 'public.delete_players(uuid[], int)', 'EXECUTE')")" "THREW"
same "and the resolver handed straight to it is NULL rather than false" \
  "$(old_probe "has_function_privilege('authenticated', to_regprocedure('public.delete_players(uuid[], int)'), 'EXECUTE')")" ""
read_state || fail "the registered probes errored in the fully absent state"
same "while the REGISTERED entry point probe answers false in that same state" \
  "$(probe "${P_ENTRY}")" "False"

echo
echo "== F. nothing here touched any reviewed migration file"
same "no migration file is modified" \
  "$(cd "${REPO}" && git status --porcelain -- supabase/migrations | wc -l | tr -d ' ')" "0"

echo
echo "ALL 0050 PROBE TOTALITY ASSERTIONS PASSED"
