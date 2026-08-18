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
# WHAT SECTIONS G TO M ADD. The guard those sections exercise was widened after
# a late review found the first version asking the wrong question. It refused a
# quoted literal CARRYING AN ARGUMENT LIST, which is a property of a function
# signature and of nothing else, so
#
#   has_table_privilege('authenticated', 'public.new_table', 'SELECT')
#
# went straight through it while resolving its argument every bit as eagerly.
# An absent table is the NORMAL pre-apply state, so the same production stop
# was waiting for the next migration that added one, and for a schema, and for
# a sequence. Sections G to M survey the whole privilege inquiry family on this
# server, run the four protected classes through the pre state, the post state
# and a wrong ACL, and mutate each safe probe back to prove the guard bites
# before anything connects.
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

# A SKIP THAT NOBODY READS IS A GREEN RUN THAT PROVES NOTHING. This file is the
# behavioural half of the probe guard, so the CI job runs it with
# REQUIRE_POSTGRES=1 and every skip below becomes a failure there. It still
# skips by hand on a machine with no server binaries, which is what keeps it
# runnable during a review.
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

# ---------------------------------------------------------------------------
# Everything above is the 0049 incident and stays exactly as it was. What
# follows is the class the first guard did not cover: an object name resolved
# eagerly WITHOUT an argument list, which is every kind but a function.
# ---------------------------------------------------------------------------

# guard <probe>: run the probe through the REAL composition, offline. Echoes
# ACCEPTED or REFUSED. It opens no connection and reads no environment, which
# is the point of section L.
guard() {
  PYTHONPATH="${HERE}" python3 - "$1" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm, verify_hosted_state as vh
entry = rm.ReviewedMigration(
    path="x.sql", ledger_name="x", idempotency_key="k",
    expected_previous_version="20260812102912",
    expected_previous_name="spond_session_link_unique",
    objects={"probe": sys.argv[1]},
)
try:
    vh.state_select(entry, "0" * 32)
except SystemExit:
    print("REFUSED")
else:
    print("ACCEPTED")
PYEOF
}

# compose_probes <probes.json>: the verifier's OWN composition for an arbitrary
# set of named probes rather than for a register entry. The probe guard, the
# read-only statement guard and the transaction wrapper are all the real ones.
compose_probes() {
  PYTHONPATH="${HERE}" python3 - "$1" <<'PYEOF'
import json, os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm, verify_hosted_state as vh
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    probes = json.load(fh)
entry = rm.ReviewedMigration(
    path="x.sql", ledger_name="probe_shapes", idempotency_key="otj:probe:shapes",
    expected_previous_version="20260812102912",
    expected_previous_name="spond_session_link_unique",
    objects=probes,
)
sys.stdout.write(vh.build_script(vh.state_select(entry, "0" * 32)))
PYEOF
}

# read_probes <script> <out.json>: run a composed script, keep psql's exit code
# so "the probe threw" stays observable rather than fatal.
read_probes() {
  set +e
  PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -t -A -d "${DB}" -f "$1" \
    >"$2" 2>"${WORK}/probes.err"
  local rc=$?
  set -e
  return ${rc}
}

probe_at() { python3 -c "
import json,sys
print(json.load(open(sys.argv[1]))['objects'][sys.argv[2]])
" "$1" "$2"; }

# The reviewed safe shapes and their mutations, read out of probe_shapes.py so
# this file and the offline tests prove things about the SAME strings.
python3 "${HERE}/probe_shapes.py" safe   >"${WORK}/safe.json"
python3 "${HERE}/probe_shapes.py" unsafe >"${WORK}/unsafe.json"
shape() { python3 -c "
import json,sys
print(json.load(open(sys.argv[1]))[sys.argv[2]])
" "$1" "$2"; }
KINDS="function table schema sequence"

echo
echo "== G. the guard covers every privilege inquiry function THIS SERVER raises for"
#
# Not a retyped list. The family comes out of the server's own catalog, each
# member is called against an absent object of its own kind, and the set that
# RAISES has to be exactly the set the guard protects. A future PostgreSQL that
# adds another one fails here rather than in a production pre gate.

SERVER_FAMILY="$(scalar "select string_agg(distinct p.proname, ' ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'pg_catalog'
    and (p.proname like 'has\_%\_privilege' or p.proname in ('pg_has_role', 'row_security_active'))")"
[ -n "${SERVER_FAMILY}" ] || fail "the server reported no privilege inquiry functions at all"
ok "the server offers: ${SERVER_FAMILY}"

# name|a call against an absent object of that kind
SURVEY_CALLS=$(cat <<'EOF'
has_any_column_privilege|has_any_column_privilege('authenticated', 'public.otj_absent_table', 'SELECT')
has_column_privilege|has_column_privilege('authenticated', 'public.otj_absent_table', 'id', 'SELECT')
has_database_privilege|has_database_privilege('authenticated', 'otj_absent_db', 'CONNECT')
has_foreign_data_wrapper_privilege|has_foreign_data_wrapper_privilege('authenticated', 'otj_absent_fdw', 'USAGE')
has_function_privilege|has_function_privilege('authenticated', 'public.otj_absent_fn(uuid)', 'EXECUTE')
has_language_privilege|has_language_privilege('authenticated', 'otj_absent_lang', 'USAGE')
has_parameter_privilege|has_parameter_privilege('authenticated', 'otj_absent_param', 'SET')
has_schema_privilege|has_schema_privilege('authenticated', 'otj_absent_schema', 'USAGE')
has_sequence_privilege|has_sequence_privilege('authenticated', 'public.otj_absent_seq', 'USAGE')
has_server_privilege|has_server_privilege('authenticated', 'otj_absent_srv', 'USAGE')
has_table_privilege|has_table_privilege('authenticated', 'public.otj_absent_table', 'SELECT')
has_tablespace_privilege|has_tablespace_privilege('authenticated', 'otj_absent_space', 'CREATE')
has_type_privilege|has_type_privilege('authenticated', 'public.otj_absent_type', 'USAGE')
pg_has_role|pg_has_role('authenticated', 'otj_absent_role', 'MEMBER')
row_security_active|row_security_active('public.otj_absent_table')
EOF
)

SURVEYED=""
RAISED=""
TOTAL_ALREADY=""
while IFS='|' read -r sname scall; do
  [ -n "${sname}" ] || continue
  SURVEYED="${SURVEYED} ${sname}"
  if [ "$(old_probe "${scall}")" = "THREW" ]; then
    RAISED="${RAISED} ${sname}"
  else
    TOTAL_ALREADY="${TOTAL_ALREADY} ${sname}"
  fi
done <<EOF
${SURVEY_CALLS}
EOF

sorted() { echo "$1" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//'; }

same "every function the server offers was actually surveyed" \
  "$(sorted "${SERVER_FAMILY}")" "$(sorted "${SURVEYED}")"

GUARD_SET="$(PYTHONPATH="${HERE}" python3 -c "
import os, sys
sys.path.insert(0, os.environ['PYTHONPATH'])
import verify_hosted_state as vh
print(' '.join(sorted(vh.PRIVILEGE_INQUIRY_FUNCTIONS)))")"

same "the guard protects exactly the functions that RAISE for an absent object" \
  "$(sorted "${GUARD_SET}")" "$(sorted "${RAISED}")"
same "and the one that is already total is the one deliberately left out" \
  "$(sorted "${TOTAL_ALREADY}")" "has_parameter_privilege"

# The guard refuses a textual name for every one of them, which is the offline
# half of the same claim, proved here against the surveyed list rather than
# against a list typed into the test file.
while IFS='|' read -r sname scall; do
  [ -n "${sname}" ] || continue
  case " ${RAISED} " in
    *" ${sname} "*)
      same "the guard refuses the textual form of ${sname}" \
        "$(guard "(select ${scall})")" "REFUSED" ;;
    *)
      same "the guard accepts ${sname}, which does not resolve a catalog object" \
        "$(guard "(select ${scall})")" "ACCEPTED" ;;
  esac
done <<EOF
${SURVEY_CALLS}
EOF

echo
echo "== H. PRE state for the four protected classes: every object absent"
#
# The state a pre gate exists to confirm. The unsafe form of each has to throw,
# because that is the defect; the reviewed safe form has to answer false.

for kind in ${KINDS}; do
  same "the unsafe ${kind} form THROWS with the object absent" \
    "$(old_probe "$(shape "${WORK}/unsafe.json" "${kind}")")" "THREW"
done

compose_probes "${WORK}/safe.json" >"${WORK}/shapes.sql"
grep -q "set transaction read only" "${WORK}/shapes.sql" || fail "the shapes script is not read only"
grep -q "rollback;" "${WORK}/shapes.sql" || fail "the shapes script does not roll back"
read_probes "${WORK}/shapes.sql" "${WORK}/shapes.json" \
  || fail "the safe shapes ERRORED against absent objects: $(cat "${WORK}/probes.err")"
ok "the four safe probes composed and ran without error"
for kind in ${KINDS}; do
  same "the safe ${kind} probe answers absent" "$(probe_at "${WORK}/shapes.json" "${kind}")" "False"
done

echo
echo "== I. and the null trap beside it, which is the same failure by another route"
#
# to_regclass handed STRAIGHT to a privilege function looks absence safe and is
# not: these functions are strict, so a null oid makes the whole probe null.
# The gate refuses a non boolean rather than reading it as absent, so the run
# stops with the reviewed object correctly absent. That is the 0049 outcome
# with a different error message.

same "a resolver handed straight to has_table_privilege is NULL, not false" \
  "$(old_probe "has_table_privilege('authenticated', to_regclass('public.otj_absent_table'), 'SELECT')")" ""
same "the same is true for a schema" \
  "$(old_probe "has_schema_privilege('authenticated', to_regnamespace('otj_absent_schema'), 'USAGE')")" ""
same "the guard refuses that shape offline" \
  "$(guard "(select has_table_privilege('authenticated', to_regclass('public.otj_absent_table'), 'SELECT'))")" \
  "REFUSED"

NULL_VERDICT="$(PYTHONPATH="${HERE}" python3 <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm, verify_hosted_state as vh
entry = rm.ReviewedMigration(
    path="x.sql", ledger_name="x", idempotency_key="k",
    expected_previous_version="20260812102912",
    expected_previous_name="spond_session_link_unique",
    objects={"probe": "(select true)"},
)
errors = vh.object_errors({"objects": {"probe": None}}, entry, want=False)
print("REFUSED" if errors else "READ AS ABSENT")
PYEOF
)"
same "and a null result fails the gate rather than reading as absent" "${NULL_VERDICT}" "REFUSED"

echo
echo "== J. POST state: each object created with the intended privilege"
run "create schema otj_probe_schema"
run "grant usage on schema otj_probe_schema to authenticated"
run "create table public.otj_probe_table (id uuid primary key)"
run "grant select on public.otj_probe_table to authenticated"
run "create sequence public.otj_probe_seq"
run "grant usage on sequence public.otj_probe_seq to authenticated"
run "create function public.otj_probe_fn(p_id uuid) returns uuid
     language sql immutable as \$fn\$ select p_id \$fn\$"
run "revoke all on function public.otj_probe_fn(uuid) from public"
run "grant execute on function public.otj_probe_fn(uuid) to authenticated"

read_probes "${WORK}/shapes.sql" "${WORK}/shapes.json" \
  || fail "the safe shapes errored with the objects present: $(cat "${WORK}/probes.err")"
for kind in ${KINDS}; do
  same "the safe ${kind} probe answers present" "$(probe_at "${WORK}/shapes.json" "${kind}")" "True"
done

# A sequence and a table are both pg_class rows, so the relkind narrowing is
# load bearing rather than decorative: without it either probe would answer for
# the other object.
same "the table probe is not satisfied by the sequence" \
  "$(old_probe "(select count(*) > 0 from pg_class c where c.oid = to_regclass('public.otj_probe_seq') and c.relkind = 'r')")" "f"

echo
echo "== K. WRONG ACL: the object exists, the privilege does not"
neg_shape() { # neg_shape <kind> <revoke sql> <regrant sql>
  run "$2"
  read_probes "${WORK}/shapes.sql" "${WORK}/shapes.json" \
    || fail "$1: the composed query errored instead of answering"
  same "the safe $1 probe answers false on the wrong ACL" \
    "$(probe_at "${WORK}/shapes.json" "$1")" "False"
  run "$3"
}
neg_shape "table" \
  "revoke select on public.otj_probe_table from authenticated" \
  "grant select on public.otj_probe_table to authenticated"
neg_shape "schema" \
  "revoke usage on schema otj_probe_schema from authenticated" \
  "grant usage on schema otj_probe_schema to authenticated"
neg_shape "sequence" \
  "revoke usage on sequence public.otj_probe_seq from authenticated" \
  "grant usage on sequence public.otj_probe_seq to authenticated"
neg_shape "function" \
  "revoke execute on function public.otj_probe_fn(uuid) from authenticated" \
  "grant execute on function public.otj_probe_fn(uuid) to authenticated"

# False above means the ACL, not the object: everything is still there.
for kind in ${KINDS}; do
  same "the ${kind} object is still present, so false meant the privilege" \
    "$(old_probe "$(shape "${WORK}/safe.json" "${kind}")")" "t"
done

echo
echo "== L. MUTATION: each safe probe put back to the textual form is caught"
#
# Sections H to K would pass just as happily over a guard that had been
# deleted, because they only ever run probes that are already correct. These
# take the SAME four shapes with the resolution removed and prove the
# composition refuses them, with no SUPABASE_DB_URL set at all, so the refusal
# demonstrably happens before anything connects to anything.

# Back to the absent state, because absent is where the mutation is dangerous.
run "drop function public.otj_probe_fn(uuid)"
run "drop sequence public.otj_probe_seq"
run "drop table public.otj_probe_table"
run "drop schema otj_probe_schema"

for kind in ${KINDS}; do
  MUTANT="$(shape "${WORK}/unsafe.json" "${kind}")"
  case "${MUTANT}" in *to_reg*) fail "the ${kind} mutation still resolves the name" ;; esac
  same "the ${kind} mutation is refused at composition, with no connection string set" \
    "$( unset SUPABASE_DB_URL; guard "${MUTANT}" )" "REFUSED"
  # And it really is the defect rather than a shape somebody disliked: the
  # same string raises on this server, in the state the pre gate reads.
  same "the ${kind} mutation THROWS on the server, which is what it is refused for" \
    "$(old_probe "${MUTANT}")" "THREW"
  same "while the ${kind} shape it was mutated from answers false" \
    "$(old_probe "$(shape "${WORK}/safe.json" "${kind}")")" "f"
done

echo
echo "== M. dollar quoting, which is the same defect one syntax along"
#
# Found by a review of section L's guard. Every rule it exercises looks for an
# APOSTROPHE, and PostgreSQL has a second string literal syntax that carries
# none: $$public.new_table$$ is the same textual object name, resolves just as
# eagerly, and walked straight through composition. The objects are still
# absent here, which is the state that matters.

# Rendered from probe_shapes.py, from the same fields as the safe and unsafe
# forms, so this is the reviewed name in a second syntax rather than a retyped
# copy of it.
python3 "${HERE}/probe_shapes.py" dollar >"${WORK}/dollar.json"
DOLLAR='$'

for kind in ${KINDS}; do
  DOLLAR_PROBE="$(shape "${WORK}/dollar.json" "${kind}")"
  case "${DOLLAR_PROBE}" in
    *"${DOLLAR}${DOLLAR}"*) : ;;
    *) fail "the ${kind} dollar form was not rendered: ${DOLLAR_PROBE}" ;;
  esac
  same "the dollar quoted ${kind} name THROWS on the server, object absent" \
    "$(old_probe "${DOLLAR_PROBE}")" "THREW"
  same "and the guard refuses it at composition" \
    "$( unset SUPABASE_DB_URL; guard "${DOLLAR_PROBE}" )" "REFUSED"
done

# The tagged form too, which carries the argument list the ORIGINAL backstop
# looks for and still slipped past it, because that rule reads apostrophes.
TAGGED="(select has_function_privilege('authenticated', \$fn\$public.otj_probe_fn(uuid)\$fn\$, 'EXECUTE'))"
same "a TAGGED dollar quoted signature THROWS on the server" "$(old_probe "${TAGGED}")" "THREW"
same "and the guard refuses that too" "$( unset SUPABASE_DB_URL; guard "${TAGGED}" )" "REFUSED"

# And the reason the character is refused rather than parsed: a dollar string
# can CONTAIN an apostrophe, which desynchronises any literal scanner.
CONFUSING="(select count(*) > 0 from pg_class c where c.relname = \$\$it's\$\$ and has_table_privilege('authenticated', c.oid, 'SELECT'))"
same "a dollar string holding an apostrophe is refused rather than parsed" \
  "$( unset SUPABASE_DB_URL; guard "${CONFUSING}" )" "REFUSED"

echo
echo "== N. nothing here touched any reviewed migration file"
same "no migration file is modified" \
  "$(cd "${REPO}" && git status --porcelain -- supabase/migrations | wc -l | tr -d ' ')" "0"

echo
echo "ALL PROBE TOTALITY ASSERTIONS PASSED"
