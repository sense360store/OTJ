#!/usr/bin/env bash
#
# Run 0052_atomic_team_order against a real PostgreSQL, on a faithful stand-in
# of the teams substrate as 0051 leaves it, and then EXERCISE the one thing
# this migration exists for: TWO CONCURRENT CONNECTIONS cannot both commit a
# whole team order and leave a merge neither of them submitted.
#
# WHY THIS EXISTS, and why it is not the migration's own self-verification.
# The migration's DO block replays the disjoint merge in ONE transaction: it
# calls the function twice in sequence and shows the second is refused. That
# proves the expected-snapshot comparison works. It CANNOT prove the thing
# the whole slice is about, because a single transaction has no second
# session to contend with: whether two real connections are serialised, which
# one wins, whether the loser blocks or interleaves, and whether the loser's
# refusal happens before it has written anything. Those need two backends,
# and this file is where they get them.
#
# THE DEFECT UNDER TEST, in full. PR #225 saves the club order from the
# browser as separate PostgREST statements, each conditioned on the value the
# screen last read. With four teams stored A=1 B=2 C=3 D=4:
#
#   admin one swaps A and B   ->  B=1 A=2 C=3 D=4
#   admin two swaps C and D   ->  A=1 B=2 D=3 C=4
#
# Neither touches a row the other writes, so every per row compare and set
# passes, both commit, and the club is left with B=1 A=2 D=3 C=4, which
# neither admin submitted. teams_sort_order_unique cannot object: the merge
# is a valid permutation. Section C below sets up exactly that, with two real
# connections, and proves the stored result is one of the two submitted
# orders and never the merge.
#
# WHAT ELSE IT PROVES:
#
#   * the file applies, orders nobody, and leaves every other column of every
#     team row byte for byte what it was;
#   * driven through the roles the product has: no club refuses, no
#     teams.manage refuses, anon cannot execute at all, another club's teams
#     are untouched and a foreign id is refused without being echoed;
#   * the whole order commits or nothing does: a refusal writes no row, and a
#     failure injected between the clear and the place leaves the order as it
#     was rather than half written;
#   * an unset club normalises to 1..N, an incomplete one normalises whole,
#     and an unchanged order writes nothing at all;
#   * teams_sort_order_unique still exists, unique and partial, unchanged;
#   * the audit trail is exactly what the header claims, including the two
#     events per moved placed team it does not try to collapse;
#   * the register's three object probes are TOTAL: false before, true after,
#     and never an error in the one state the pre gate exists to confirm;
#   * the self-verification BITES: mutations of the file, each doing one
#     thing the header forbids, abort the apply with the message of the ONE
#     check that catches it and leave the database untouched;
#   * a second apply is refused by the ledger's unique idempotency key with
#     the schema untouched.
#
# WHAT IT IS NOT. The stand-in carries the tables, triggers, policies, grants
# and helper functions 0052 reads or asserts against, shaped as 0002, 0012,
# 0031, 0032, 0037, 0044 and 0051 left them, with the hosted project's
# blanket Data API grants. It is not the hosted schema and cannot prove the
# hosted schema matches. The pre and post apply gates do that, at apply time,
# against the real database.
#
# It runs in CI with REQUIRE_POSTGRES=1, which turns every skip below into a
# failure, because a skipped proof reported as a green check is worth less
# than no check at all. Run by hand it still skips where no server exists:
#
#   bash .github/scripts/production-migration/test_0052_atomic_team_order.sh
#
# Nothing here reads, writes or connects to any hosted project, and the
# reviewed migration file is never modified: every mutation is applied to a
# copy.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION_PATH="supabase/migrations/0052_atomic_team_order.sql"
MIGRATION="${REPO}/${MIGRATION_PATH}"

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
PORT="${PGPORT_TEST:-5463}"

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
DB=otj_0052
run() { psql_run -d "${DB}" -q -c "$1" >/dev/null; }
scalar() { psql_run -d "${DB}" -tAc "$1"; }

# Synthetic clubs, members and teams. The team names are the phonetic
# alphabet on purpose: no club team name appears anywhere in this file.
CLUB_A=11111111-0000-4000-8000-00000000000a
CLUB_B=11111111-0000-4000-8000-00000000000b
ADMIN_A=cccccccc-0000-4000-8000-000000000001
COACH_A=cccccccc-0000-4000-8000-000000000002
A1=aaaaaaaa-0000-4000-8000-000000000001
A2=aaaaaaaa-0000-4000-8000-000000000002
A3=aaaaaaaa-0000-4000-8000-000000000003
A4=aaaaaaaa-0000-4000-8000-000000000004
B1=bbbbbbbb-0000-4000-8000-000000000001

# ---------------------------------------------------------------------
# The stand-in, written to a file so a fresh database can be built from it
# for every mutation in section G. It is the substrate as 0051 LEAVES it,
# because 0052 is reviewed against a database that already has 0051.
# ---------------------------------------------------------------------
cat >"${WORK}/standin.sql" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- The caller context. On Supabase these come from the request JWT; here
-- they come from three session GUCs so one connection can act as a
-- teams.manage holder, a coach without it, a member of another club, or
-- nobody at all.
create schema auth;
create function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('otj.test_uid', true), '')::uuid
$fn$;
create function public.my_club() returns uuid language sql stable as $fn$
  select nullif(current_setting('otj.test_club', true), '')::uuid
$fn$;
create function public.has_perm(capability text) returns boolean language sql stable as $fn$
  select position(capability in coalesce(current_setting('otj.test_caps', true), '')) > 0
$fn$;
create function public.audit_source_context(p_actor uuid) returns text language plpgsql stable as $fn$
declare v text := current_setting('otj.audit_source', true);
begin
  if v is not null and v <> '' then return v; end if;
  if p_actor is not null then return 'manual'; end if;
  return 'database_trigger';
end $fn$;
create function public.audit_batch_context() returns uuid language plpgsql stable as $fn$
declare v text := current_setting('otj.audit_batch', true);
begin
  if v is null or v = '' then return null; end if;
  return v::uuid;
end $fn$;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null, crest_url text, motto text,
  created_at timestamptz not null default now()
);
create table public.profiles (id uuid primary key, full_name text);
create table public.capabilities (key text primary key, label text, description text);
insert into public.capabilities values
  ('teams.manage', 'Manage teams', 'Add, rename and remove the club''s teams.'),
  ('sessions.create', 'Create sessions', 'Plan sessions.'),
  ('players.view', 'View players', 'See the registered players.');

create function public.is_bib_colour(p text) returns boolean language sql immutable set search_path = '' as $fn$
  select p in ('red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black')
$fn$;

-- teams as 0002 created it, 0032 keyed it, 0044 extended it and 0051
-- ordered it. sort_order and its partial unique index are 0051's, and are
-- the substrate 0052 is written against rather than anything it adds.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  bib_colour text,
  sort_order integer,
  unique (club_id, name),
  constraint teams_id_club_unique unique (id, club_id),
  constraint teams_bib_colour_vocabulary check (bib_colour is null or public.is_bib_colour(bib_colour))
);
create index on public.teams (club_id);
create unique index teams_sort_order_unique
  on public.teams (club_id, sort_order) where sort_order is not null;

-- seasons, only as far as a clubs insert cascades: 0031's bootstrap trigger
-- fires on the hosted database, so the stand-in fires it too.
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index seasons_one_current_per_club on public.seasons (club_id) where is_current;

create table public.audit_events (
  id bigserial primary key,
  club_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  subject_id uuid,
  changed_fields text[],
  safe_changes jsonb,
  metadata jsonb,
  source text not null default 'manual',
  batch_id uuid,
  created_at timestamptz not null default now(),
  constraint audit_events_source_check check (source in ('manual', 'database_trigger', 'import', 'spond_sync'))
);

create function public.audit_domain_event(
  p_club uuid, p_actor uuid, p_action text, p_entity_type text,
  p_entity uuid, p_subject uuid, p_changed text[]
) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.audit_events
    (club_id, actor_id, action, entity_type, entity_id, subject_id, changed_fields, source, batch_id)
  values
    (p_club, p_actor, p_action, p_entity_type, p_entity, p_subject, p_changed,
     public.audit_source_context(p_actor), public.audit_batch_context());
end $fn$;

create function public.audit_seasons() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'season.created', 'season', new.id, new.id, null);
  end if;
  return new;
end $fn$;
create trigger audit_seasons_aiu after insert on public.seasons
  for each row execute function public.audit_seasons();

-- The trigger is on CLUBS, so the new row's own id is the club id. 0031
-- guards against a club that already has one; the stand-in guards the same
-- way so a re-seed cannot double the bootstrapped season.
create function public.clubs_bootstrap_season() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists (select 1 from public.seasons s where s.club_id = new.id) then return new; end if;
  insert into public.seasons (club_id, name, is_current) values (new.id, '2026/27', true);
  return new;
end $fn$;
create trigger clubs_bootstrap_season after insert on public.clubs
  for each row execute function public.clubs_bootstrap_season();

-- audit_teams as 0044 shaped it and 0051 extended it: the allow list names
-- sort_order, and no event carries a value.
create function public.audit_teams() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_club   uuid;
  v_id     uuid;
  v_action text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'team.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'team.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.bib_colour is distinct from old.bib_colour then v_changed := array_append(v_changed, 'bib_colour'); end if;
    if new.sort_order is distinct from old.sort_order then v_changed := array_append(v_changed, 'sort_order'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'team.updated';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger audit_teams_aiud after insert or update or delete on public.teams
  for each row execute function public.audit_teams();

alter table public.teams enable row level security;
create policy "teams_select_club" on public.teams
  for select using ( club_id = public.my_club() );
create policy "teams_manage" on public.teams
  for all using ( club_id = public.my_club() and public.has_perm('teams.manage') )
  with check ( club_id = public.my_club() and public.has_perm('teams.manage') );

-- The hosted grant posture: the legacy blanket Data API grants, with the
-- audit writer kept private as 0037 leaves it.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
revoke execute on function public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[]) from public, anon, authenticated;

-- A stand-in ledger holding the row 0052 is REVIEWED AGAINST: the version
-- the 0051 apply stamped on 2 September 2026.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[], idempotency_key text unique);
insert into supabase_migrations.schema_migrations (version, name, statements, idempotency_key)
values ('20260902150212', 'team_sort_order', array['-- reviewed elsewhere'],
        'otj:migration:0051_team_sort_order');
SQL

cat >"${WORK}/rows.sql" <<SQL
insert into public.clubs (id, name) values ('${CLUB_A}', 'Synthetic Club A'), ('${CLUB_B}', 'Synthetic Club B');
insert into public.profiles values ('${ADMIN_A}', 'Synthetic Admin A'), ('${COACH_A}', 'Synthetic Coach A');
insert into public.teams (id, club_id, name, bib_colour, sort_order) values
  ('${A1}', '${CLUB_A}', 'Alpha',   'red',   1),
  ('${A2}', '${CLUB_A}', 'Bravo',   null,    2),
  ('${A3}', '${CLUB_A}', 'Charlie', 'blue',  3),
  ('${A4}', '${CLUB_A}', 'Delta',   null,    4),
  ('${B1}', '${CLUB_B}', 'Foxtrot', null,    1);
SQL

fresh_db() { # fresh_db <name>: the stand-in plus the rows, in a new database
  psql_run -d postgres -q -c "drop database if exists $1" >/dev/null
  psql_run -d postgres -q -c "create database $1" >/dev/null
  psql_run -d "$1" -q -f "${WORK}/standin.sql" >/dev/null
  psql_run -d "$1" -q -f "${WORK}/rows.sql" >/dev/null
}
fresh_db "${DB}"

# Put club A back to Alpha=1 Bravo=2 Charlie=3 Delta=4 between races. In TWO
# statements, because teams_sort_order_unique is checked per row and a single
# UPDATE that permutes positions collides on the first row it moves. That is
# the very constraint the function's clear-then-place exists for, so the
# harness cannot cheat past it either.
reset_order() {
  run "update public.teams set sort_order = null where club_id = '${CLUB_A}'"
  run "update public.teams set sort_order = case name
         when 'Alpha' then 1 when 'Bravo' then 2 when 'Charlie' then 3 when 'Delta' then 4 end
       where club_id = '${CLUB_A}'"
}

# Every "changed nothing else" assertion is made against these, computed
# from OUTSIDE the migration.
ROWS_SQL="select coalesce(md5(string_agg(to_jsonb(t)::text, ',' order by t.id)), 'empty') from public.teams t"
ROWS_BEFORE="$(scalar "${ROWS_SQL}")"
AUDIT_AT_SEED="$(scalar "select count(*) from public.audit_events")"
same "the seed left one team.created event per team" "$(scalar "select count(*) from public.audit_events where action = 'team.created'")" "5"
same "the seed left one bootstrapped season per club" "$(scalar "select count(*) from public.seasons")" "2"

# ---------------------------------------------------------------------
# The register's probes, composed by the real verifier, so this file cannot
# drift from what the gates will actually run.
# ---------------------------------------------------------------------
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

P_FUNC="public.set_team_order(uuid[], integer[])"
P_DEFINER="it is SECURITY DEFINER with an empty search_path"
P_GRANT="authenticated executes it and anon does not"
ALL=("${P_FUNC}" "${P_DEFINER}" "${P_GRANT}")

APPLY_OUT=""
apply() {
  set +e
  APPLY_OUT="$(PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "$1" -f "$2" 2>&1)"
  local rc=$?
  set -e
  return ${rc}
}

# ---------------------------------------------------------------------
echo "== A. the probes are TOTAL in the state the PRE gate reads"
# ---------------------------------------------------------------------
read_state || fail "the state read raised before the apply, which is the one state the pre gate exists to confirm: $(cat "${WORK}/state.err")"
ok "the state read did not raise with the function absent"
for p in "${ALL[@]}"; do
  same "before the apply, '${p}' reads false" "$(probe "${p}")" "False"
done
gate pre || fail "the pre gate refused a database that has not had 0052 applied: $(cat "${WORK}/gate.out")"
ok "the pre gate passes on the database 0052 was written for"
gate post && fail "the post gate passed on a database where nothing was applied" || true
ok "and the post gate refuses that same database, so the two gates are not the same check"

# ---------------------------------------------------------------------
echo "== B. the migration applies, and orders nobody"
# ---------------------------------------------------------------------
apply "${DB}" "${MIGRATION}" || fail "0052 did not apply: ${APPLY_OUT}"
ok "0052 applied, self-verification included"
same "every team row is byte for byte what it was" "$(scalar "${ROWS_SQL}")" "${ROWS_BEFORE}"
same "the migration wrote no audit event" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"
same "no team gained a position" "$(scalar "select count(*) from public.teams where sort_order is not null")" "5"
same "no temporary relation survived the apply" \
  "$(scalar "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname like 'pg_temp%' and c.relname like '%team_order%'")" "0"

read_state || fail "the state read raised after the apply: $(cat "${WORK}/state.err")"
for p in "${ALL[@]}"; do
  same "after the apply, '${p}' reads true" "$(probe "${p}")" "True"
done

# The post gate reads the LEDGER as well as the objects, and this harness
# applies the file directly rather than through apply_one_migration.sql. So
# write exactly the ledger row that a real apply would write, verbatim
# statement included, and gate against that: it is the row the workflow
# produces, not an approximation of it.
PYTHONPATH="${HERE}" python3 - "${MIGRATION}" >"${WORK}/ledger.sql" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm
sql = rm.read_migration_sql(sys.argv[1])
tag = "$OTJMIG$"
assert tag not in sql, "the dollar quote tag collides with the migration body"
sys.stdout.write(
    "insert into supabase_migrations.schema_migrations "
    "(version, name, statements, idempotency_key) values ('20260903120000', "
    "'atomic_team_order', array[" + tag + sql + tag + "], "
    "'otj:migration:0052_atomic_team_order');\n"
)
PYEOF
psql_run -d "${DB}" -q -f "${WORK}/ledger.sql" >/dev/null
read_state || fail "the composed query errored after the ledger row: $(cat "${WORK}/state.err")"
gate post || fail "the post gate rejected a correct applied database: $(cat "${WORK}/gate.out")"
ok "the post gate PASSES against the ledger row 0052's apply would write"

# ---------------------------------------------------------------------
echo "== C. TWO SESSIONS. The disjoint merge #225 cannot prevent"
# ---------------------------------------------------------------------
# The setup is the header's worked example: A=1 B=2 C=3 D=4, admin one swaps
# the top two, admin two swaps the bottom two, and BOTH drafts were drawn
# from the same original snapshot. Under #225's per row compare and set both
# would commit. Here they contend on the serialization point.
#
# Session one opens a transaction, calls the function (which takes the club
# advisory lock and the teams lock and writes), and then HOLDS the
# transaction open. Session two starts while it is held and must block. The
# elapsed time of session two is measured, and the test fails if it did not
# actually wait, because a session two that sailed through would prove
# nothing about serialization even if the final state looked right.
reset_order  # back to Alpha=1 Bravo=2 Charlie=3 Delta=4
run "delete from public.audit_events"

cat >"${WORK}/session_one.sql" <<SQL
begin;
select set_config('otj.test_club', '${CLUB_A}', true);
select set_config('otj.test_caps', 'teams.manage', true);
select set_config('otj.test_uid', '${ADMIN_A}', true);
-- admin one swaps the TOP two, from the snapshot 1,2,3,4
select public.set_team_order(
  array['${A2}','${A1}','${A3}','${A4}']::uuid[],
  array[2,1,3,4]::integer[]);
-- hold the locks so session two must contend rather than follow
select pg_sleep(3);
commit;
SQL

cat >"${WORK}/session_two.sql" <<SQL
select set_config('otj.test_club', '${CLUB_A}', false);
select set_config('otj.test_caps', 'teams.manage', false);
select set_config('otj.test_uid', '${COACH_A}', false);
-- admin two swaps the BOTTOM two, from the SAME snapshot 1,2,3,4. Disjoint
-- rows: nothing here touches Alpha or Bravo.
select public.set_team_order(
  array['${A1}','${A2}','${A4}','${A3}']::uuid[],
  array[1,2,4,3]::integer[]);
SQL

psql_run -d "${DB}" -q -f "${WORK}/session_one.sql" >"${WORK}/one.out" 2>&1 &
ONE_PID=$!
sleep 1  # session one now holds the locks inside its open transaction

TWO_START=$(date +%s%N)
set +e
PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
  psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "${DB}" -f "${WORK}/session_two.sql" \
  >"${WORK}/two.out" 2>&1
TWO_RC=$?
set -e
TWO_MS=$(( ($(date +%s%N) - TWO_START) / 1000000 ))
wait ${ONE_PID} || fail "session one failed: $(cat "${WORK}/one.out")"

[ ${TWO_RC} -ne 0 ] || fail "session two was ACCEPTED; the disjoint merge is possible: $(cat "${WORK}/two.out")"
ok "session two was refused rather than committed"
grep -q "another admin saved a different order" "${WORK}/two.out" \
  || fail "session two failed for the wrong reason: $(cat "${WORK}/two.out")"
ok "and refused with the stale snapshot message"
# The SQLSTATE, not only the words: `code` is what the client matches on,
# because PostgREST returns the SQLSTATE there. Caught by sqlstate and
# re-raised as a distinguishable message, so the assertion does not depend
# on the session's notice level.
cat >"${WORK}/sqlstate.sql" <<SQL
do \$probe\$
begin
  perform set_config('otj.test_club', '${CLUB_A}', true);
  perform set_config('otj.test_caps', 'teams.manage', true);
  begin
    perform public.set_team_order(
      array['${A1}','${A2}','${A4}','${A3}']::uuid[], array[1,2,4,3]::integer[]);
    raise exception 'SQLSTATE-PROBE: the stale order was NOT refused';
  exception when sqlstate '40001' then
    raise exception 'SQLSTATE-PROBE: refused with 40001';
  end;
end
\$probe\$;
SQL
set +e
SQLSTATE_OUT="$(psql_run -d "${DB}" -q -f "${WORK}/sqlstate.sql" 2>&1)"
set -e
echo "${SQLSTATE_OUT}" | grep -q "SQLSTATE-PROBE: refused with 40001" \
  || fail "the stale refusal did not carry SQLSTATE 40001: ${SQLSTATE_OUT}"
ok "the refusal carries SQLSTATE 40001, which is what the client matches on"

# It BLOCKED on the serialization point rather than interleaving. Session one
# holds for 3s and session two started 1s in, so a real wait is ~2s; anything
# under 1s means it never contended and this test proved nothing.
[ "${TWO_MS}" -ge 1000 ] || fail "session two did not block (${TWO_MS}ms); it never reached the serialization point"
ok "session two blocked on the serialization point (${TWO_MS}ms)"

FINAL="$(scalar "select string_agg(name, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")"
same "the stored order is EXACTLY the order session one submitted" "${FINAL}" "Bravo,Alpha,Charlie,Delta"
[ "${FINAL}" != "Bravo,Alpha,Delta,Charlie" ] \
  || fail "the stored order is the MERGE of both submissions, which is the defect this migration exists to prevent"
ok "the stored order is not the merge of the two submissions"
same "session two wrote no row at all" \
  "$(scalar "select count(*) from public.audit_events where action = 'team.updated' and actor_id = '${COACH_A}'")" "0"

# The same race the other way round, to show the winner is whoever reaches the
# serialization point first rather than whoever the test happens to start.
reset_order  # back to Alpha=1 Bravo=2 Charlie=3 Delta=4
# Session three is the BOTTOM swap holding the lock, and the loser is now the
# TOP swap: the mirror of the race above, so the winner is whoever reaches
# the serialization point first rather than whichever order this file happens
# to submit first.
cat >"${WORK}/session_three.sql" <<SQL
begin;
select set_config('otj.test_club', '${CLUB_A}', true);
select set_config('otj.test_caps', 'teams.manage', true);
-- the BOTTOM swap, from the snapshot 1,2,3,4: Delta held 4 and Charlie 3
select public.set_team_order(
  array['${A1}','${A2}','${A4}','${A3}']::uuid[],
  array[1,2,4,3]::integer[]);
select pg_sleep(3);
commit;
SQL
cat >"${WORK}/session_six.sql" <<SQL
select set_config('otj.test_club', '${CLUB_A}', false);
select set_config('otj.test_caps', 'teams.manage', false);
select set_config('otj.test_uid', '${COACH_A}', false);
-- the TOP swap, from the SAME snapshot 1,2,3,4. Disjoint from session three.
select public.set_team_order(
  array['${A2}','${A1}','${A3}','${A4}']::uuid[],
  array[2,1,3,4]::integer[]);
SQL
psql_run -d "${DB}" -q -f "${WORK}/session_three.sql" >"${WORK}/three.out" 2>&1 &
THREE_PID=$!
sleep 1
set +e
PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
  psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "${DB}" -f "${WORK}/session_six.sql" \
  >"${WORK}/six.out" 2>&1
SIX_RC=$?
set -e
wait ${THREE_PID} || fail "session three failed: $(cat "${WORK}/three.out")"
[ ${SIX_RC} -ne 0 ] || fail "the loser was accepted when the bottom swap won the race"
ok "with the roles reversed, the loser is still refused"
same "and the stored order is exactly the WINNER's submission" \
  "$(scalar "select string_agg(name, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")" \
  "Alpha,Bravo,Delta,Charlie"

# OVERLAPPING swaps, where the rows are shared rather than disjoint. #225's
# compare and set does catch these; the point here is that this function does
# not become MORE permissive for them.
reset_order  # back to Alpha=1 Bravo=2 Charlie=3 Delta=4
cat >"${WORK}/session_four.sql" <<SQL
begin;
select set_config('otj.test_club', '${CLUB_A}', true);
select set_config('otj.test_caps', 'teams.manage', true);
select public.set_team_order(
  array['${A2}','${A1}','${A3}','${A4}']::uuid[], array[2,1,3,4]::integer[]);
select pg_sleep(2);
commit;
SQL
cat >"${WORK}/session_five.sql" <<SQL
select set_config('otj.test_club', '${CLUB_A}', false);
select set_config('otj.test_caps', 'teams.manage', false);
-- also moves Alpha and Bravo: overlapping, not disjoint
select public.set_team_order(
  array['${A3}','${A1}','${A2}','${A4}']::uuid[], array[3,1,2,4]::integer[]);
SQL
psql_run -d "${DB}" -q -f "${WORK}/session_four.sql" >"${WORK}/four.out" 2>&1 &
FOUR_PID=$!
sleep 1
set +e
psql_run -d "${DB}" -q -f "${WORK}/session_five.sql" >"${WORK}/five.out" 2>&1
FIVE_RC=$?
set -e
wait ${FOUR_PID} || fail "session four failed: $(cat "${WORK}/four.out")"
[ ${FIVE_RC} -ne 0 ] || fail "an overlapping stale order was accepted"
ok "an overlapping stale order is refused too"
same "and the club holds exactly the winner's order" \
  "$(scalar "select string_agg(name, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")" \
  "Bravo,Alpha,Charlie,Delta"

# TWO CLUBS DO NOT WAIT ON EACH OTHER for the advisory key. They do share the
# teams table lock, which is the stated cost, so this asserts the advisory key
# is club scoped rather than global by showing club B's save completes on its
# own snapshot rather than being refused by club A's.
run "update public.teams set sort_order = 1 where club_id = '${CLUB_B}'"
same "another club saves its own order while club A is configured" \
  "$(psql_run -d "${DB}" -tAc "select set_config('otj.test_club','${CLUB_B}',false) is not null
       and set_config('otj.test_caps','teams.manage',false) is not null;
     select (public.set_team_order(array['${B1}']::uuid[], array[1]::integer[]) ->> 'changed')" | tail -1)" "0"

# ---------------------------------------------------------------------
echo "== D. atomicity: a refusal writes nothing, and there is no half order"
# ---------------------------------------------------------------------
reset_order  # back to Alpha=1 Bravo=2 Charlie=3 Delta=4
BEFORE_D="$(scalar "select string_agg(name || '=' || sort_order, ',' order by name) from public.teams where club_id = '${CLUB_A}'")"

# A stale order refuses before writing: every position is where it was.
set +e
psql_run -d "${DB}" -q -c "select set_config('otj.test_club','${CLUB_A}',false);
  select set_config('otj.test_caps','teams.manage',false);
  select public.set_team_order(array['${A2}','${A1}','${A3}','${A4}']::uuid[], array[9,9,9,9]::integer[]);" \
  >/dev/null 2>&1
set -e
same "a stale order leaves every position exactly where it was" \
  "$(scalar "select string_agg(name || '=' || sort_order, ',' order by name) from public.teams where club_id = '${CLUB_A}'")" \
  "${BEFORE_D}"

# A failure raised INSIDE the caller's transaction after the function
# returned still leaves nothing: the whole transaction rolls back, which is
# what "no partial order" means for a client that does more than one thing.
set +e
psql_run -d "${DB}" -q >/dev/null 2>&1 <<SQL
begin;
select set_config('otj.test_club', '${CLUB_A}', true);
select set_config('otj.test_caps', 'teams.manage', true);
select public.set_team_order(array['${A4}','${A3}','${A2}','${A1}']::uuid[], array[4,3,2,1]::integer[]);
select 1/0;
commit;
SQL
set -e
same "a caller that fails after the call leaves the order untouched" \
  "$(scalar "select string_agg(name || '=' || sort_order, ',' order by name) from public.teams where club_id = '${CLUB_A}'")" \
  "${BEFORE_D}"

# And the clear-then-place never becomes visible as a half order: a swap
# leaves both teams placed, never one of them null.
run "select set_config('otj.test_club','${CLUB_A}',false);
     select set_config('otj.test_caps','teams.manage',false);
     select public.set_team_order(array['${A2}','${A1}','${A3}','${A4}']::uuid[], array[2,1,3,4]::integer[])"
same "after a swap every team still holds a position" \
  "$(scalar "select count(*) from public.teams where club_id = '${CLUB_A}' and sort_order is null")" "0"
same "and the positions are exactly 1..N with no gap or repeat" \
  "$(scalar "select string_agg(sort_order::text, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")" \
  "1,2,3,4"

# ---------------------------------------------------------------------
echo "== E. the gates: identity, capability, club, and the shape of a request"
# ---------------------------------------------------------------------
refuse() { # refuse <label> <sqlstate> <sql>
  local out
  set +e
  out="$(psql_run -d "${DB}" -tAc "$3" 2>&1)"
  local rc=$?
  set -e
  [ ${rc} -ne 0 ] || fail "$1 was accepted"
  echo "${out}" | grep -q "$2" || fail "$1 failed with the wrong error: ${out}"
  ok "$1"
}
CTX_A="select set_config('otj.test_club','${CLUB_A}',false); select set_config('otj.test_caps','teams.manage',false);"

refuse "a caller with no club is refused" "not signed in" \
  "select set_config('otj.test_club','',false); select set_config('otj.test_caps','teams.manage',false);
   select public.set_team_order(array['${A1}']::uuid[], array[1]::integer[]);"
refuse "a caller without teams.manage is refused" "requires the teams.manage capability" \
  "select set_config('otj.test_club','${CLUB_A}',false); select set_config('otj.test_caps','sessions.create',false);
   select public.set_team_order(array['${A1}','${A2}','${A3}','${A4}']::uuid[], array[1,2,3,4]::integer[]);"
refuse "a duplicated id is refused" "appears more than once" \
  "${CTX_A} select public.set_team_order(array['${A1}','${A1}','${A3}','${A4}']::uuid[], array[1,2,3,4]::integer[]);"
refuse "a null id is refused" "a team id is null" \
  "${CTX_A} select public.set_team_order(array['${A1}',null,'${A3}','${A4}']::uuid[], array[1,2,3,4]::integer[]);"
refuse "mismatched array lengths are refused" "aligned with the team ids" \
  "${CTX_A} select public.set_team_order(array['${A1}','${A2}','${A3}','${A4}']::uuid[], array[1,2,3]::integer[]);"
refuse "a null array is refused" "both arrays are required" \
  "${CTX_A} select public.set_team_order(null::uuid[], array[1]::integer[]);"
refuse "an incomplete set is refused" "every team of the club exactly once" \
  "${CTX_A} select public.set_team_order(array['${A1}','${A2}','${A3}']::uuid[], array[1,2,3]::integer[]);"

# A FOREIGN id is refused, and the message does not carry it. The set is kept
# the right SIZE so the completeness count passes and the club check is what
# refuses, which is the path that could otherwise leak.
FOREIGN_OUT="$(psql_run -d "${DB}" -tAc "${CTX_A}
  select public.set_team_order(array['${A1}','${A2}','${A3}','${B1}']::uuid[], array[1,2,3,4]::integer[]);" 2>&1 || true)"
echo "${FOREIGN_OUT}" | grep -q "not in your club" || fail "a foreign team was not refused: ${FOREIGN_OUT}"
echo "${FOREIGN_OUT}" | grep -q "${B1}" && fail "the refusal echoed the foreign team id: ${FOREIGN_OUT}"
echo "${FOREIGN_OUT}" | grep -qi "foxtrot" && fail "the refusal echoed the other club's team name: ${FOREIGN_OUT}"
ok "a foreign team is refused without the id or name reaching the message"

same "the other club's team is untouched by every refusal above" \
  "$(scalar "select name || '=' || sort_order from public.teams where club_id = '${CLUB_B}'")" "Foxtrot=1"

# anon cannot execute it at all: the grant, not the body, is what stops them.
same "anon may not execute the function" \
  "$(scalar "select has_function_privilege('anon', to_regprocedure('public.set_team_order(uuid[], integer[])'), 'EXECUTE')")" "f"
same "authenticated may" \
  "$(scalar "select has_function_privilege('authenticated', to_regprocedure('public.set_team_order(uuid[], integer[])'), 'EXECUTE')")" "t"
same "and PUBLIC may not, so no future role inherits it" \
  "$(scalar "select coalesce(bool_or(acl.grantee = 0), false) from pg_proc p,
       aclexplode(p.proacl) acl where p.oid = to_regprocedure('public.set_team_order(uuid[], integer[])')")" "f"

# ---------------------------------------------------------------------
echo "== F. unset, incomplete, unchanged, and the audit trail"
# ---------------------------------------------------------------------
run "update public.teams set sort_order = null where club_id = '${CLUB_A}'"
run "delete from public.audit_events"
run "${CTX_A} select public.set_team_order(array['${A3}','${A1}','${A4}','${A2}']::uuid[],
       array[null,null,null,null]::integer[])"
same "an unset club normalises to 1..N in the order given" \
  "$(scalar "select string_agg(name, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")" \
  "Charlie,Alpha,Delta,Bravo"
same "an unset club's four placements leave four audit events" \
  "$(scalar "select count(*) from public.audit_events where action = 'team.updated'")" "4"
same "and every one names sort_order" \
  "$(scalar "select count(*) from public.audit_events where action = 'team.updated' and changed_fields = array['sort_order']")" "4"
same "and none carries a value" \
  "$(scalar "select count(*) from public.audit_events where safe_changes is not null or metadata is not null")" "0"

run "delete from public.audit_events"
same "an unchanged order writes no row" \
  "$(scalar "${CTX_A} select (public.set_team_order(array['${A3}','${A1}','${A4}','${A2}']::uuid[],
       array[1,2,3,4]::integer[]) ->> 'changed')" | tail -1)" "0"
same "and therefore no audit event" "$(scalar "select count(*) from public.audit_events")" "0"

# The two events per moved placed team, stated in the header and proved here
# rather than left as a claim.
run "delete from public.audit_events"
run "${CTX_A} select public.set_team_order(array['${A1}','${A3}','${A4}','${A2}']::uuid[],
       array[2,1,3,4]::integer[])"
same "swapping two placed teams writes two rows" \
  "$(scalar "select count(distinct entity_id) from public.audit_events where action = 'team.updated'")" "2"
same "and leaves two events each: the clear and the placement" \
  "$(scalar "select count(*) from public.audit_events where action = 'team.updated'")" "4"
# An UNPLACED team moving records ONE event, because there is nothing to
# clear. The order above left Alpha=1 Charlie=2 Delta=3 Bravo=4, so unplacing
# Alpha leaves the expected snapshot 2, 3, 4, null for Charlie, Delta, Bravo,
# Alpha.
run "delete from public.audit_events"
run "update public.teams set sort_order = null where id = '${A1}'"
run "delete from public.audit_events"
run "${CTX_A} select public.set_team_order(array['${A3}','${A4}','${A2}','${A1}']::uuid[],
       array[2,3,4,null]::integer[])"
same "an unplaced team moving leaves ONE event, not two" \
  "$(scalar "select count(*) from public.audit_events where entity_id = '${A1}'")" "1"
same "and the club is ordered 1..N with the newcomer last" \
  "$(scalar "select string_agg(name, ',' order by sort_order) from public.teams where club_id = '${CLUB_A}'")" \
  "Charlie,Delta,Bravo,Alpha"

# ---------------------------------------------------------------------
echo "== G. the self-verification BITES"
# ---------------------------------------------------------------------
# Each mutation does ONE thing the header forbids, on a COPY, against a fresh
# database. The reviewed file is never modified. A mutation that applied
# cleanly would mean the check meant to catch it is decorative.
mutate() { # mutate <outfile> <python expression over s>
  python3 -c "
import sys
s = open(sys.argv[1]).read()
# The last statement before the verification DO block, so a mutation
# anchored here is one the self-verification still has to catch. Anchoring
# on 'commit;' would put the change AFTER the checks, where nothing looks.
GRANT_LINE = 'grant execute on function public.set_team_order(uuid[], integer[]) to authenticated;\n'
assert GRANT_LINE in s
mutated = $2
if mutated == s:
    sys.exit('the mutation changed nothing, so it would prove nothing')
open(sys.argv[2], 'w').write(mutated)
" "${MIGRATION}" "$1"
}
MUTDB=otj_0052_mut
check_mutation() { # check_mutation <label> <expected message fragment>
  fresh_db "${MUTDB}"
  apply "${MUTDB}" "${WORK}/mutant.sql" && fail "$1: the mutated file applied cleanly"
  echo "${APPLY_OUT}" | grep -q "$2" \
    || fail "$1: aborted for the wrong reason, wanted '$2', got: ${APPLY_OUT}"
  # And it left nothing behind.
  local left
  left="$(psql_run -d "${MUTDB}" -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_team_order'")"
  [ "${left}" = "0" ] || fail "$1: the mutated apply left the function behind"
  ok "$1"
}

mutate "${WORK}/mutant.sql" "s.replace(\"  if not public.has_perm('teams.manage') then\n    raise exception 'set_team_order: requires the teams.manage capability'\n      using errcode = '42501';\n  end if;\n\", '')"
check_mutation "M1 the capability gate removed" "the teams.manage gate is missing"

mutate "${WORK}/mutant.sql" "s.replace('  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtext(\'otj.set_team_order:\' || v_club::text)\n  );', '  -- lock removed')"
check_mutation "M2 the club advisory lock removed" "the club advisory lock is missing"

mutate "${WORK}/mutant.sql" "s.replace('  lock table public.teams in share row exclusive mode;', '  -- membership lock removed')"
check_mutation "M3 the teams membership lock removed" "the teams membership lock is missing"

mutate "${WORK}/mutant.sql" "s.replace('     where n.sort_order is distinct from want.expected', '     where false')"
check_mutation "M4 the expected snapshot comparison defeated" "the expected snapshot comparison is missing"

mutate "${WORK}/mutant.sql" "s.replace(\"      using errcode = '40001';\", \"      using errcode = 'P0001';\", 1)"
check_mutation "M5 the stale refusal no longer uses 40001" "must use SQLSTATE 40001"

mutate "${WORK}/mutant.sql" "s.replace('security definer\nset search_path = ' + chr(39) + chr(39), 'security definer', 1)"
check_mutation "M6 the empty search_path removed" "must set search_path to empty"

mutate "${WORK}/mutant.sql" "s.replace('grant execute on function public.set_team_order(uuid[], integer[]) to authenticated;', 'grant execute on function public.set_team_order(uuid[], integer[]) to authenticated, anon;')"
check_mutation "M7 anon granted execute" "anon must not execute"

mutate "${WORK}/mutant.sql" "s.replace('  v_club     uuid := public.my_club();', '  v_club     uuid := public.my_club();\n  p_club     uuid;', 1)"
check_mutation "M8 a club argument smuggled in" "must not be able to name a club"

mutate "${WORK}/mutant.sql" "s.replace('create or replace function public.set_team_order(\n  p_team_ids             uuid[],\n  p_expected_sort_orders integer[]\n)', 'create or replace function public.set_team_order(\n  p_team_ids             uuid[],\n  p_expected_sort_orders integer[],\n  p_unused               boolean default false\n)', 1)"
check_mutation "M9 the reviewed signature changed" "does not exist\|the function was not created"

mutate "${WORK}/mutant.sql" "s.replace('  lock table public.teams in share row exclusive mode;', '  lock table public.teams in share row exclusive mode;\n  delete from public.teams where false;', 1)"
check_mutation "M10 a delete of teams introduced" "must create and delete no team"

# The second family, which 0051's review separated out: these change nothing
# a behavioural probe can see and are caught only by the BEFORE/AFTER
# fingerprint. A harness without them would be proving the probe and assuming
# the rest of the file.
mutate "${WORK}/mutant.sql" "s.replace(GRANT_LINE, GRANT_LINE + 'update public.teams set sort_order = null;\n', 1)"
check_mutation "M11 a data write smuggled into the migration" "must order nobody\|must add, remove and place no team"

mutate "${WORK}/mutant.sql" "s.replace(GRANT_LINE, GRANT_LINE + 'create policy \"teams_extra\" on public.teams for select using (true);\n', 1)"
check_mutation "M12 a policy added to teams" "must change no policy on teams"

mutate "${WORK}/mutant.sql" "s.replace(GRANT_LINE, GRANT_LINE + 'drop index public.teams_sort_order_unique;\n', 1)"
check_mutation "M13 the 0051 unique index dropped" "must be untouched\|is missing, so 0051 has not been applied"

mutate "${WORK}/mutant.sql" "s.replace(GRANT_LINE, GRANT_LINE + 'grant execute on function public.set_team_order(uuid[], integer[]) to anon;\n', 1)"
check_mutation "M14 anon granted after the fact" "anon must not execute"

# ---------------------------------------------------------------------
echo "== H. a second apply is refused, and changes nothing"
# ---------------------------------------------------------------------
# WHAT REFUSES A SECOND APPLY HERE IS THE LEDGER, NOT THE FILE, and that is
# a real difference from 0051 worth stating rather than papering over. 0051
# adds a column, so a second raw apply dies on `add column`. 0052 creates a
# function with CREATE OR REPLACE, which is idempotent by design: replaying
# the file produces the same function and the same fingerprint comparison,
# so it succeeds and changes nothing. That is the correct property for a
# function migration (0049 and 0050 share it) and it is not the safety net.
# The safety net is apply_one_migration.sql inserting the ledger row as its
# FIRST statement, so a duplicate idempotency key aborts the transaction
# before a single DDL statement runs. Both halves are asserted here.
ROWS_AFTER="$(scalar "${ROWS_SQL}")"
FUNC_BEFORE="$(scalar "select md5(pg_get_functiondef(to_regprocedure('public.set_team_order(uuid[], integer[])')))")"
apply "${DB}" "${MIGRATION}" || fail "a second raw apply of 0052 failed: ${APPLY_OUT}"
ok "a second raw apply is idempotent, as CREATE OR REPLACE makes it"
same "and changes no team row" "$(scalar "${ROWS_SQL}")" "${ROWS_AFTER}"
same "and leaves the identical function definition" \
  "$(scalar "select md5(pg_get_functiondef(to_regprocedure('public.set_team_order(uuid[], integer[])')))")" \
  "${FUNC_BEFORE}"
same "and still exactly one overload" \
  "$(scalar "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_team_order'")" "1"

# The ledger's unique idempotency key is the real gate the workflow uses, and
# it refuses BEFORE any DDL because that insert is apply_one_migration.sql's
# first statement. Section B already wrote the row a real apply writes, so
# this is a genuine second apply rather than a synthetic one.
set +e
LEDGER_OUT="$(psql_run -d "${DB}" -q -c "insert into supabase_migrations.schema_migrations
  (version, name, statements, idempotency_key) values
  ('20260903130000', 'atomic_team_order', array['-- applied'], 'otj:migration:0052_atomic_team_order')" 2>&1)"
LEDGER_RC=$?
set -e
[ ${LEDGER_RC} -ne 0 ] || fail "the ledger accepted the same idempotency key twice"
echo "${LEDGER_OUT}" | grep -q "duplicate key" || fail "the ledger refused for the wrong reason: ${LEDGER_OUT}"
ok "the ledger's unique idempotency key refuses a second apply of 0052"

echo
echo "PASS: 0052_atomic_team_order applies, serialises two real sessions, refuses the"
echo "      disjoint merge that PR #225 cannot prevent, leaves no partial order, and"
echo "      its self-verification bites."
