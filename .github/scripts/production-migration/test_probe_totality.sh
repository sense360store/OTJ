#!/usr/bin/env bash
#
# The 0049 object probes, composed by the real verifier and run against a real
# PostgreSQL, in both the state the pre gate reads and the state the post gate
# reads.
#
# WHY THIS EXISTS. The production run of the 0049 workflow stopped in the
# pre-apply gate with
#
#   ERROR:  function "public.spond_reconcile_player_team(uuid, ...)" does not exist
#
# reported as "a queried schema or table is unreadable to this role". Nothing
# was unreadable and nothing was wrong with the database: the function had not
# been created yet, which is the ONE state a pre gate exists to confirm. The
# probe asked the question in a form that cannot answer no.
#
# A probe must be TOTAL. False when the reviewed object is absent, true when it
# is present and correct, and never an error because it is not there yet. Two
# separate defects broke that, one at each gate, and only the first was
# reachable because it stopped the run:
#
#   * has_function_privilege(role, 'public.f(uuid, ...)', 'EXECUTE') resolves
#     the textual signature first and raises 42883 when nothing matches. The
#     PRE gate died.
#   * pg_get_function_identity_arguments() renders the argument NAMES as well
#     as the types, so it returns "p_player_id uuid, ..." and the comparison
#     against "uuid, uuid, ..." was false WITH THE FUNCTION CORRECTLY IN
#     PLACE. The POST gate would have failed, after the apply had run.
#
# test_reviewed_migrations.py pins the shape offline for the whole register.
# This file is the behavioural half: it proves the composed SQL actually
# returns the right booleans against a server, which is the only thing that
# could have caught the second defect, because that one was a true statement
# about the wrong string rather than a shape mistake.
#
# The function created here is a STAND-IN carrying the reviewed signature,
# SECURITY DEFINER, empty search_path and grants. The probes read pg_proc and
# the ACL and nothing else, so a stand-in is a faithful subject and this test
# stays about probe semantics rather than about 0049's body. Nothing here
# reads, writes or connects to any hosted project, and the reviewed migration
# file is never modified.
#
# Run by hand:  bash .github/scripts/production-migration/test_probe_totality.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION_PATH="supabase/migrations/0049_spond_team_reconcile.sql"
SIG="public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)"

PGBIN="${PGBIN:-}"
if [ -z "${PGBIN}" ]; then
  for candidate in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /usr/pgsql-*/bin; do
    if [ -x "${candidate}/initdb" ]; then PGBIN="${candidate}"; break; fi
  done
fi
if [ -z "${PGBIN}" ] || [ ! -x "${PGBIN}/initdb" ]; then
  echo "SKIP: no PostgreSQL server binaries found (set PGBIN to a directory containing initdb)"
  exit 0
fi

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  RUN_AS="${PGUSER_ACCOUNT:-postgres}"
  if ! getent passwd "${RUN_AS}" >/dev/null; then
    echo "SKIP: running as root and no ${RUN_AS} account exists to own the cluster"
    exit 0
  fi
fi

WORK="$(mktemp -d)"
if [ -n "${RUN_AS}" ]; then WORK="$(su "${RUN_AS}" -c 'mktemp -d')"; fi
chmod 711 "${WORK}"
DATA="${WORK}/data"
PORT="${PGPORT_TEST:-5458}"

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
DB=otj_probes
psql_run -d postgres -q -c "create database ${DB}" >/dev/null
run() { psql_run -d "${DB}" -q -c "$1" >/dev/null; }
scalar() { psql_run -d "${DB}" -tAc "$1"; }

# The two Supabase platform roles the ACL probe names. They always exist on a
# hosted project; here they are created so the probe means the same thing.
run "create role authenticated"
run "create role anon"

# A stand-in ledger, the four columns the composed SELECT reads, holding the
# row 0049 was reviewed against so the gate's ledger half is satisfied too.
run "create schema supabase_migrations"
run "create table supabase_migrations.schema_migrations (
       version text primary key, name text, statements text[], idempotency_key text)"
run "insert into supabase_migrations.schema_migrations (version, name, statements, idempotency_key)
     values ('20260812102912', 'spond_session_link_unique', array['-- reviewed elsewhere'],
             'otj:migration:0048_spond_session_link_unique')"

# compose <path>: the verifier's OWN read-only script for a register entry,
# probe validation and all. Not a copy of it.
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

# read_state: run the composed script and leave the JSON in ${WORK}/state.json.
# Returns psql's exit code, so "the probe threw" is observable rather than
# fatal.
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

# gate <phase>: the real assertions, fed the real read through --sample.
gate() {
  set +e
  ( cd "${REPO}" && python3 "${HERE}/verify_hosted_state.py" \
      --phase "$1" --migration "${MIGRATION_PATH}" --sample "${WORK}/state.json" ) \
      >"${WORK}/gate.out" 2>&1
  local rc=$?
  set -e
  return ${rc}
}

P_EXISTS="public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)"
P_SECDEF="it is SECURITY DEFINER with an empty search_path"
P_ACL="authenticated executes it and anon does not"

# The reviewed probe SQL itself, read out of the register so section E compares
# the real thing against the real old shape rather than a retyped copy.
probe_sql() {
  PYTHONPATH="${HERE}" python3 - "${MIGRATION_PATH}" "$1" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm
sys.stdout.write(rm.lookup(sys.argv[1]).objects[sys.argv[2]])
PYEOF
}
NEW_ACL_SQL="$(probe_sql "${P_ACL}")"
NEW_EXISTS_SQL="$(probe_sql "${P_EXISTS}")"

echo
echo "== A. the composed query is the verifier's own, and it validates the probes"
grep -q "set transaction read only" "${WORK}/state.sql" || fail "the composed script is not read only"
grep -q "rollback;" "${WORK}/state.sql" || fail "the composed script does not roll back"
grep -q "to_regprocedure" "${WORK}/state.sql" || fail "the composed script does not resolve through to_regprocedure"
ok "composed through build_script(state_select(...)), read only and rollback only"

echo
echo "== B. PRE state: the function is absent, which is the whole point"
same "the function really is absent" "$(scalar "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'spond_reconcile_player_team'")" "0"
read_state || fail "the composed query ERRORED against an absent function, which is the production defect: $(cat "${WORK}/state.err")"
ok "the composed query ran without error"
same "exists probe answers absent"     "$(probe "${P_EXISTS}")" "False"
same "secdef probe answers absent"     "$(probe "${P_SECDEF}")" "False"
same "acl probe answers absent"        "$(probe "${P_ACL}")"    "False"
gate pre || fail "the pre gate rejected a correct pre-apply database: $(cat "${WORK}/gate.out")"
ok "the pre gate PASSES, so the run would have proceeded to the apply"
gate post && fail "the post gate passed on a database where nothing was applied" || true
ok "and the post gate correctly refuses the same read"

echo
echo "== C. POST state: created exactly as 0049 creates it"
run "create function public.spond_reconcile_player_team(
       p_player_id uuid, p_expected_team_id uuid, p_target_team_id uuid,
       p_expected_member_id text default null, p_confirm_member_id text default null,
       p_batch_id uuid default null)
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
run "revoke all on function ${SIG} from public"
run "revoke all on function ${SIG} from anon"
run "grant execute on function ${SIG} to authenticated"

read_state || fail "the composed query errored with the function present: $(cat "${WORK}/state.err")"
same "exists probe answers present"    "$(probe "${P_EXISTS}")" "True"
same "secdef probe answers present"    "$(probe "${P_SECDEF}")" "True"
same "acl probe answers present"       "$(probe "${P_ACL}")"    "True"
gate pre && fail "the pre gate passed with the reviewed object already present" || true
ok "the pre gate now refuses, so a repeat press stops before applying twice"

# The post gate also wants the ledger row, hashing to the reviewed file.
PYTHONPATH="${HERE}" python3 - "${REPO}/${MIGRATION_PATH}" >"${WORK}/ledger.sql" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm
sql = rm.read_migration_sql(sys.argv[1])
tag = "$OTJMIG$"
assert tag not in sql, "the dollar quote tag collides with the migration body"
sys.stdout.write(
    "insert into supabase_migrations.schema_migrations "
    "(version, name, statements, idempotency_key) values ('20260817090000', "
    "'spond_team_reconcile', array[" + tag + sql + tag + "], "
    "'otj:migration:0049_spond_team_reconcile');\n"
)
PYEOF
psql_run -d "${DB}" -q -f "${WORK}/ledger.sql" >/dev/null

read_state || fail "the composed query errored after the ledger row: $(cat "${WORK}/state.err")"
gate post || fail "the post gate rejected a correct applied database: $(cat "${WORK}/gate.out")"
ok "the post gate PASSES, which is the half the identity-arguments defect would have failed"

echo
echo "== D. the probes still refuse everything they were written to refuse"

neg() { # neg <label> <probe label> <setup sql> <teardown sql>
  run "$3"
  read_state || fail "$1: the composed query errored instead of answering"
  same "$1" "$(probe "$2")" "False"
  run "$4"
}

neg "anon granted directly is refused" "${P_ACL}" \
  "grant execute on function ${SIG} to anon" \
  "revoke execute on function ${SIG} from anon"
neg "a grant to PUBLIC is refused, because anon inherits it" "${P_ACL}" \
  "grant execute on function ${SIG} to public" \
  "revoke execute on function ${SIG} from public"
neg "authenticated without EXECUTE is refused" "${P_ACL}" \
  "revoke execute on function ${SIG} from authenticated" \
  "grant execute on function ${SIG} to authenticated"

# Signature exactness: a same named function of a DIFFERENT shape is not it.
run "drop function ${SIG}"
run "create function public.spond_reconcile_player_team(p_player_id uuid)
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
run "grant execute on function public.spond_reconcile_player_team(uuid) to authenticated"
read_state || fail "the composed query errored on a wrong overload"
same "a different overload is not the reviewed function (exists)" "$(probe "${P_EXISTS}")" "False"
same "a different overload is not the reviewed function (secdef)" "$(probe "${P_SECDEF}")" "False"
same "a different overload is not the reviewed function (acl)"    "$(probe "${P_ACL}")"    "False"
run "drop function public.spond_reconcile_player_team(uuid)"

# SECURITY DEFINER and the empty search_path are each load bearing.
run "create function public.spond_reconcile_player_team(
       p_player_id uuid, p_expected_team_id uuid, p_target_team_id uuid,
       p_expected_member_id text default null, p_confirm_member_id text default null,
       p_batch_id uuid default null)
     returns jsonb language plpgsql set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
read_state || fail "the composed query errored on a non secdef function"
same "SECURITY INVOKER is refused" "$(probe "${P_SECDEF}")" "False"
run "drop function ${SIG}"
run "create function public.spond_reconcile_player_team(
       p_player_id uuid, p_expected_team_id uuid, p_target_team_id uuid,
       p_expected_member_id text default null, p_confirm_member_id text default null,
       p_batch_id uuid default null)
     returns jsonb language plpgsql security definer set search_path = 'public'
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
read_state || fail "the composed query errored on a non empty search_path"
same "a non empty search_path is refused" "$(probe "${P_SECDEF}")" "False"
run "drop function ${SIG}"

echo
echo "== E. and the OLD probe forms are proved to be the defects they are"
#
# Without this, the file above only says the new probes work. It would pass
# just as happily over a register that had never been fixed, because it never
# runs the old shapes. So it runs them, on the same server, in the same two
# states.

old_probe() { # old_probe <sql> ; echoes the value, or THREW
  set +e
  local out
  out="$(PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres psql --no-psqlrc \
    --set ON_ERROR_STOP=1 -q -t -A -d "${DB}" -c "select $1" 2>/dev/null)"
  local rc=$?
  set -e
  if [ ${rc} -ne 0 ]; then echo "THREW"; else echo "${out}"; fi
}

OLD_ACL="(select has_function_privilege('authenticated', '${SIG}', 'EXECUTE') and not has_function_privilege('anon', '${SIG}', 'EXECUTE'))"
OLD_EXISTS="(select count(*) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'spond_reconcile_player_team' and pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, uuid, text, text, uuid')"

# The function is absent again at this point.
same "the old ACL probe THROWS when the function is absent, failing the pre gate" \
  "$(old_probe "${OLD_ACL}")" "THREW"
same "the new ACL probe answers false in the same state" \
  "$(old_probe "${NEW_ACL_SQL}")" "f"

run "create function public.spond_reconcile_player_team(
       p_player_id uuid, p_expected_team_id uuid, p_target_team_id uuid,
       p_expected_member_id text default null, p_confirm_member_id text default null,
       p_batch_id uuid default null)
     returns jsonb language plpgsql security definer set search_path = ''
     as \$fn\$ begin return '{}'::jsonb; end \$fn\$"
same "the old signature probe is FALSE with the function correctly present, which would have failed the post gate" \
  "$(old_probe "${OLD_EXISTS}")" "f"
same "the new signature probe is true in that same state" \
  "$(old_probe "${NEW_EXISTS_SQL}")" "t"

echo
echo "== F. nothing here touched the reviewed migration file"
same "0049 is unmodified" "$(cd "${REPO}" && git status --porcelain -- "${MIGRATION_PATH}" | wc -l | tr -d ' ')" "0"

echo
echo "ALL PROBE TOTALITY ASSERTIONS PASSED"
