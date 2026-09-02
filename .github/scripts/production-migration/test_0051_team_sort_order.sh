#!/usr/bin/env bash
#
# Run 0051_team_sort_order against a real PostgreSQL, on a faithful stand-in
# of the teams substrate it changes, and then EXERCISE what it adds: the
# nullable column, the partial unique index, the audit allow list, and the
# policy and grant posture it must leave exactly where it found it. Its three
# registered object probes are flipped here too, against the same server, in
# the state the pre gate reads and the state the post gate reads.
#
# WHY THIS EXISTS. The vitest suite cannot reach a database, the security
# policy suite needs the whole local Supabase stack, and the migration's own
# self-verification is a set of assertions that could each have gone vacuous
# without anybody noticing, which is what 0049's \b defect taught. So this
# file proves four things the others cannot, on the real migration file:
#
#   * the file applies, orders nobody, and leaves every other column of
#     every team row byte for byte what it was;
#   * driven through row level security as the roles the product has, the
#     column reads club wide, writes only under teams.manage, refuses a
#     shared position within one club, allows one across clubs, allows any
#     number of unordered teams, and leaves exactly the audit trail the
#     allow list says, with no value in it;
#   * the register's probes are TOTAL: false before, true after, and never
#     an error in the one state the pre gate exists to confirm;
#   * the self-verification BITES: seventeen mutations of the file, ten
#     doing one thing the header forbids and seven changing nothing the
#     behavioural probe can see, each abort the apply with the message of
#     the ONE check that catches it and leave the database untouched. The
#     second family exists because the first cannot tell whether the
#     stored source and trigger checks exist at all: a broken allow list
#     is caught by the behavioural probe's counts before the catalogue is
#     read, so a harness that accepted either message was proving the
#     probe and assuming the rest.
#
# WHAT IT IS NOT. The stand-in carries the tables, triggers, policies, grants
# and helper functions 0051 reads or asserts against, shaped as 0002, 0012,
# 0031, 0032, 0037 and 0044 left them, with the hosted project's blanket
# Data API grants. It is not the hosted schema and cannot prove the hosted
# schema matches. The pre and post apply gates do that, at apply time,
# against the real database.
#
# It runs in CI with REQUIRE_POSTGRES=1, which turns every skip below into a
# failure, because a skipped proof reported as a green check is worth less
# than no check at all. Run by hand it still skips where no server exists:
#
#   bash .github/scripts/production-migration/test_0051_team_sort_order.sh
#
# Nothing here reads, writes or connects to any hosted project, and the
# reviewed migration file is never modified: every mutation is applied to a
# copy.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION_PATH="supabase/migrations/0051_team_sort_order.sql"
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
PORT="${PGPORT_TEST:-5462}"

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
DB=otj_0051
run() { psql_run -d "${DB}" -q -c "$1" >/dev/null; }
scalar() { psql_run -d "${DB}" -tAc "$1"; }

# Synthetic clubs, members and teams. The team names are the phonetic
# alphabet on purpose: no club team name appears anywhere in this file.
CLUB_A=11111111-0000-4000-8000-00000000000a
CLUB_B=11111111-0000-4000-8000-00000000000b
ADMIN_A=cccccccc-0000-4000-8000-000000000001
COACH_A=cccccccc-0000-4000-8000-000000000002
ADMIN_B=cccccccc-0000-4000-8000-000000000003
A1=aaaaaaaa-0000-4000-8000-000000000001
A2=aaaaaaaa-0000-4000-8000-000000000002
A3=aaaaaaaa-0000-4000-8000-000000000003
A4=aaaaaaaa-0000-4000-8000-000000000004
A5=aaaaaaaa-0000-4000-8000-000000000005
B1=bbbbbbbb-0000-4000-8000-000000000001
B2=bbbbbbbb-0000-4000-8000-000000000002

# ---------------------------------------------------------------------
# The stand-in, written to a file so a fresh database can be built from it
# for every mutation in section F.
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

-- teams as 0002 created it, 0032 keyed it and 0044 extended it.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  bib_colour text,
  unique (club_id, name),
  constraint teams_id_club_unique unique (id, club_id),
  constraint teams_bib_colour_vocabulary check (bib_colour is null or public.is_bib_colour(bib_colour))
);
create index on public.teams (club_id);

-- seasons, only as far as a clubs insert cascades: the migration's probe
-- inserts two synthetic clubs, and on the hosted database that fires
-- 0031's bootstrap trigger, so the stand-in fires it too.
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false, archived_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);
create unique index seasons_one_current_per_club on public.seasons (club_id) where is_current;
create function public.season_bounds(p_ref date) returns table (name text, starts_on date, ends_on date)
language sql immutable as $fn$
  select '2026/27'::text, date '2026-07-01', date '2027-06-30'
$fn$;
create function public.clubs_bootstrap_season() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_bounds record;
begin
  if exists (select 1 from public.seasons s where s.club_id = new.id) then return new; end if;
  select * into v_bounds from public.season_bounds((now() at time zone 'utc')::date);
  insert into public.seasons (club_id, name, starts_on, ends_on, is_current, created_by)
  values (new.id, v_bounds.name, v_bounds.starts_on, v_bounds.ends_on, true, auth.uid());
  return new;
end $fn$;
create trigger clubs_bootstrap_season after insert on public.clubs
  for each row execute function public.clubs_bootstrap_season();

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid, actor_name text, action text not null, entity_type text not null,
  entity_id uuid, season_id uuid, team_id uuid, source text not null,
  changed_fields text[], safe_changes jsonb, metadata jsonb, batch_id uuid,
  constraint audit_events_source_check check (source in (
    'manual','csv_import','xlsx_import','spond_import','renewal','system','edge_function','database_trigger'))
);

-- The bootstrapped season is audited on the hosted database (0031's
-- audit_seasons writes season.created), so the probe's club insert leaves an
-- audit row of ANOTHER entity type inside the subtransaction. The stand-in
-- writes it too, so the rollback of that row is exercised rather than assumed.
create function public.audit_seasons() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.audit_events (club_id, actor_id, action, entity_type, entity_id, season_id, source)
  values (new.club_id, auth.uid(), 'season.created', 'season', new.id, new.id, public.audit_source_context(auth.uid()));
  return new;
end $fn$;
create trigger audit_seasons after insert on public.seasons
  for each row execute function public.audit_seasons();

-- audit_domain_event, in behaviour verbatim from 0037.
create function public.audit_domain_event(
  p_club uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_team_id uuid default null, p_changed_fields text[] default null
) returns void language plpgsql security definer set search_path = '' as $fn$
declare v_actor_name text;
begin
  if p_club is null or not exists (select 1 from public.clubs c where c.id = p_club) then return; end if;
  if p_actor is not null then
    select pr.full_name into v_actor_name from public.profiles pr where pr.id = p_actor;
  end if;
  insert into public.audit_events (club_id, occurred_at, actor_id, actor_name, action, entity_type,
                                   entity_id, team_id, source, changed_fields, batch_id)
  values (p_club, now(), p_actor, v_actor_name, p_action, p_entity_type, p_entity_id, p_team_id,
          public.audit_source_context(p_actor), nullif(p_changed_fields, '{}'), public.audit_batch_context());
end $fn$;

-- audit_teams exactly as 0044 left it, under the trigger 0037 attached.
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
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'team.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function public.audit_teams();

-- Row level security and the two policies, as 0002 and 0012 left them.
alter table public.teams enable row level security;
create policy "teams_select_club" on public.teams
  for select using ( club_id = public.my_club() );
create policy "teams_manage" on public.teams
  for all using ( club_id = public.my_club() and public.has_perm('teams.manage') )
  with check ( club_id = public.my_club() and public.has_perm('teams.manage') );

-- The hosted grant posture: the legacy blanket Data API grants, as
-- tests/security/local-grants.sql reproduces them, with the audit writer
-- kept private as 0037 leaves it.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
revoke execute on function public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[]) from public, anon, authenticated;

-- A stand-in ledger holding the row 0051 is REVIEWED AGAINST: the version
-- the 0050 apply stamped on 23 August 2026.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[], idempotency_key text unique);
insert into supabase_migrations.schema_migrations (version, name, statements, idempotency_key)
values ('20260823065041', 'bulk_delete_players', array['-- reviewed elsewhere'],
        'otj:migration:0050_bulk_delete_players');
SQL

cat >"${WORK}/rows.sql" <<SQL
insert into public.clubs (id, name) values ('${CLUB_A}', 'Synthetic Club A'), ('${CLUB_B}', 'Synthetic Club B');
insert into public.profiles values
  ('${ADMIN_A}', 'Synthetic Admin A'), ('${COACH_A}', 'Synthetic Coach A'), ('${ADMIN_B}', 'Synthetic Admin B');
insert into public.teams (id, club_id, name, bib_colour) values
  ('${A1}', '${CLUB_A}', 'Alpha',   'red'),
  ('${A2}', '${CLUB_A}', 'Bravo',   null),
  ('${A3}', '${CLUB_A}', 'Charlie', 'blue'),
  ('${A4}', '${CLUB_A}', 'Delta',   null),
  ('${A5}', '${CLUB_A}', 'Echo',    'green'),
  ('${B1}', '${CLUB_B}', 'Foxtrot', null),
  ('${B2}', '${CLUB_B}', 'Golf',    'yellow');
SQL

fresh_db() { # fresh_db <name>: the stand-in plus the rows, in a new database
  psql_run -d postgres -q -c "drop database if exists $1" >/dev/null
  psql_run -d postgres -q -c "create database $1" >/dev/null
  psql_run -d "$1" -q -f "${WORK}/standin.sql" >/dev/null
  psql_run -d "$1" -q -f "${WORK}/rows.sql" >/dev/null
}
fresh_db "${DB}"

# Every "changed nothing else" assertion is made against these, computed
# from OUTSIDE the migration.
ROWS_SQL="select coalesce(md5(string_agg(to_jsonb(t)::text, ',' order by t.id)), 'empty') from public.teams t"
ROWS_LESS_SQL="select coalesce(md5(string_agg((to_jsonb(t) - 'sort_order')::text, ',' order by t.id)), 'empty') from public.teams t"
ROWS_BEFORE="$(scalar "${ROWS_SQL}")"
# The seven team inserts and the two bootstrapped seasons each fire an audit
# trigger, so the baseline is nine rather than zero; comparing against a
# literal would assert the seed.
AUDIT_AT_SEED="$(scalar "select count(*) from public.audit_events")"
same "the seed left one team.created event per team" "$(scalar "select count(*) from public.audit_events where action = 'team.created'")" "7"
same "and one season.created event per bootstrapped season" "$(scalar "select count(*) from public.audit_events where action = 'season.created'")" "2"
same "the seed left one bootstrapped season per club" "$(scalar "select count(*) from public.seasons")" "2"

# ---------------------------------------------------------------------
# The register's probes, composed by the real verifier.
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

P_COLUMN="public.teams.sort_order, a nullable integer with no default"
P_INDEX="teams_sort_order_unique, a two column partial unique index on teams"
P_AUDIT="audit_teams() names sort_order on its allow list"
ALL=("${P_COLUMN}" "${P_INDEX}" "${P_AUDIT}")

# apply <file>: run a migration file, capturing rc and output.
APPLY_OUT=""
apply() {
  set +e
  APPLY_OUT="$(PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "$1" -f "$2" 2>&1)"
  local rc=$?
  set -e
  return ${rc}
}

# run_as <role> <club> <caps> <uid> <sql>: one statement as a Data API role,
# under row level security, with the JWT facts supplied as GUCs.
run_as() {
  local role="$1" club="$2" caps="$3" uid="$4" sql="$5"
  PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -tA -d "${DB}" -c "
      set role ${role};
      set otj.test_club = '${club}';
      set otj.test_caps = '${caps}';
      set otj.test_uid = '${uid}';
      ${sql}"
}
# updated_as <club> <caps> <uid> <set clause> <team id>: the number of rows a
# teams.manage decision actually reached.
updated_as() {
  run_as authenticated "$1" "$2" "$3" \
    "with r as (update public.teams set $4 where id = '$5' returning 1) select count(*) from r;"
}

echo
echo "== A. PRE state: the probes are FALSE, and the pre gate passes"
grep -q "set transaction read only" "${WORK}/state.sql" || fail "the composed script is not read only"
grep -q "rollback;" "${WORK}/state.sql" || fail "the composed script does not roll back"
read_state || fail "the composed query ERRORED against the pre-apply database: $(cat "${WORK}/state.err")"
ok "the composed query ran without error against the pre-apply state, which is what total means"
for label in "${ALL[@]}"; do
  same "absent: ${label:0:60}" "$(probe "${label}")" "False"
done
same "audit_teams() already exists before the apply, so its probe flips on the BODY and not on presence" \
  "$(scalar "select count(*) from pg_proc where proname = 'audit_teams'")" "1"
gate pre || fail "the pre gate rejected a correct pre-apply database: $(cat "${WORK}/gate.out")"
ok "the pre gate PASSES, so a run would proceed to the apply"
gate post && fail "the post gate passed on a database where nothing was applied" || true
ok "and the post gate correctly refuses the same read"

echo
echo "== B. the migration applies against the stand-in and its self-verification passes"
apply "${DB}" "${MIGRATION}" || fail "0051 did not apply: ${APPLY_OUT}"
ok "0051 applied"
same "the column exists as a nullable integer with no default" \
  "$(scalar "select count(*) from information_schema.columns where table_schema='public' and table_name='teams' and column_name='sort_order' and data_type='integer' and is_nullable='YES' and column_default is null")" "1"
same "the index is the reviewed definition" \
  "$(scalar "select pg_get_indexdef(indexrelid) from pg_index where indrelid = 'public.teams'::regclass and indexrelid::regclass::text = 'teams_sort_order_unique'")" \
  "CREATE UNIQUE INDEX teams_sort_order_unique ON public.teams USING btree (club_id, sort_order) WHERE (sort_order IS NOT NULL)"
same "the before fingerprint table was dropped at commit" \
  "$(scalar "select count(*) from pg_class where relname = '_0051_before'")" "0"
same "NOBODY WAS ORDERED: every team is null" \
  "$(scalar "select count(*) from public.teams where sort_order is not null")" "0"
same "every other column of every team row is byte for byte what it was" \
  "$(scalar "${ROWS_LESS_SQL}")" "${ROWS_BEFORE}"
same "the migration wrote no audit event" \
  "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"
same "the probe's synthetic clubs did not survive" \
  "$(scalar "select count(*) from public.clubs")" "2"
same "the probe's synthetic teams did not survive" \
  "$(scalar "select count(*) from public.teams")" "7"
same "the probe's cascaded seasons did not survive" \
  "$(scalar "select count(*) from public.seasons")" "2"
same "nor did their season.created audit rows" \
  "$(scalar "select count(*) from public.audit_events where action = 'season.created'")" "2"
same "the two policies are still the two" \
  "$(scalar "select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'teams'")" \
  "teams_manage:ALL,teams_select_club:SELECT"
same "row level security is still on" \
  "$(scalar "select relrowsecurity from pg_class where oid = 'public.teams'::regclass")" "t"
same "no capability key was added" \
  "$(scalar "select count(*) from public.capabilities")" "3"
same "the audit trigger still fires audit_teams()" \
  "$(scalar "select tgfoid::regproc::text from pg_trigger where tgrelid = 'public.teams'::regclass and tgname = 'audit_teams'")" "audit_teams"

echo
echo "== C. POST state: the probes are TRUE, the post gate passes, the pre gate refuses"
read_state || fail "the composed query errored after the apply: $(cat "${WORK}/state.err")"
for label in "${ALL[@]}"; do
  same "present: ${label:0:60}" "$(probe "${label}")" "True"
done
gate pre && fail "the pre gate passed with the reviewed objects already present" || true
ok "the pre gate now refuses, so a repeat press stops before applying twice"
PYTHONPATH="${HERE}" python3 - "${MIGRATION}" >"${WORK}/ledger.sql" <<'PYEOF'
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"])
import reviewed_migrations as rm
sql = rm.read_migration_sql(sys.argv[1])
tag = "$OTJMIG$"
assert tag not in sql, "the dollar quote tag collides with the migration body"
sys.stdout.write(
    "insert into supabase_migrations.schema_migrations "
    "(version, name, statements, idempotency_key) values ('20260902120000', "
    "'team_sort_order', array[" + tag + sql + tag + "], "
    "'otj:migration:0051_team_sort_order');\n"
)
PYEOF
psql_run -d "${DB}" -q -f "${WORK}/ledger.sql" >/dev/null
read_state || fail "the composed query errored after the ledger row: $(cat "${WORK}/state.err")"
gate post || fail "the post gate rejected a correct applied database: $(cat "${WORK}/gate.out")"
ok "the post gate PASSES against the ledger row 0051's apply would write"

echo
echo "== D. the column, driven through row level security as the roles the product has"
same "D1 a club member reads every team of their club, all unordered" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "select count(*) from public.teams where sort_order is null;")" "5"
same "D1 a member of another club reads none of them" \
  "$(run_as authenticated "${CLUB_B}" "teams.manage" "${ADMIN_B}" "select count(*) from public.teams where club_id = '${CLUB_A}';")" "0"
same "D1 anon reads nothing" \
  "$(run_as anon "" "" "" "select count(*) from public.teams;")" "0"

same "D2 a coach WITHOUT teams.manage changes zero rows" \
  "$(updated_as "${CLUB_A}" "sessions.create" "${COACH_A}" "sort_order = 1" "${A1}")" "0"
same "D2 and the team is still unordered" "$(scalar "select coalesce(sort_order::text, 'null') from public.teams where id = '${A1}'")" "null"
same "D2 and no event was written" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"

for i in 1 2 3 4 5; do
  var="A${i}"
  same "D3 a teams.manage holder positions team ${i}" \
    "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = ${i}" "${!var}")" "1"
done
same "D3 five positionings left five team.updated events naming sort_order and nothing else" \
  "$(scalar "select count(*) from public.audit_events where action = 'team.updated' and changed_fields = array['sort_order'] and safe_changes is null and metadata is null and entity_type = 'team' and actor_id = '${ADMIN_A}' and source = 'manual' and team_id = entity_id")" "5"
same "D3 and no other event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_AT_SEED + 5))"

set +e
DUP_OUT="$(run_as authenticated "${CLUB_A}" "teams.manage" "${ADMIN_A}" "update public.teams set sort_order = 1 where id = '${A2}';" 2>&1)"
DUP_RC=$?
set -e
[ "${DUP_RC}" -ne 0 ] || fail "D4 two teams in one club took the same position"
echo "${DUP_OUT}" | grep -q "teams_sort_order_unique" || fail "D4 the duplicate was refused by something else: ${DUP_OUT}"
echo "${DUP_OUT}" | grep -q "duplicate key value violates unique constraint" || fail "D4 not a unique violation: ${DUP_OUT}"
ok "D4 a duplicate position within one club is refused by teams_sort_order_unique"
same "D4 and the refused row is where it was" "$(scalar "select sort_order from public.teams where id = '${A2}'")" "2"
same "D4 and the refusal wrote no event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_AT_SEED + 5))"

same "D5 the SAME position in a DIFFERENT club is allowed (1)" \
  "$(updated_as "${CLUB_B}" "teams.manage" "${ADMIN_B}" "sort_order = 1" "${B1}")" "1"
same "D5 the SAME position in a DIFFERENT club is allowed (2)" \
  "$(updated_as "${CLUB_B}" "teams.manage" "${ADMIN_B}" "sort_order = 2" "${B2}")" "1"

same "D6 a position can be given back" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = null" "${A1}")" "1"
same "D6 and another" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = null" "${A3}")" "1"
same "D6 and a third" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = null" "${A4}")" "1"
same "D6 three unordered teams coexist beside two ordered ones" \
  "$(scalar "select count(*) from public.teams where club_id = '${CLUB_A}' and sort_order is null")" "3"
same "D6 a freed position can be taken by another team" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = 3" "${A1}")" "1"
same "D6 positions need not be contiguous: 7 beside 2, 3 and 5 is accepted" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = 7" "${A4}")" "1"

AUDIT_D6="$(scalar "select count(*) from public.audit_events")"
same "D7 a rename still records name alone" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "name = 'Echo, renamed'" "${A5}")" "1"
same "D7 (event)" "$(scalar "select count(*) from public.audit_events where entity_id = '${A5}' and changed_fields = array['name']")" "1"
same "D7 a rename and a repositioning in one statement record both, in allow list order" \
  "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "name = 'Echo, renamed twice', sort_order = 9" "${A5}")" "1"
same "D7 (event)" "$(scalar "select count(*) from public.audit_events where entity_id = '${A5}' and changed_fields = array['name','sort_order']")" "1"
same "D7 a bib change still records bib_colour alone" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "bib_colour = 'pink'" "${A2}")" "1"
same "D7 (event)" "$(scalar "select count(*) from public.audit_events where entity_id = '${A2}' and changed_fields = array['bib_colour']")" "1"
same "D7 a write that changes nothing on the allow list reaches the row" "$(updated_as "${CLUB_A}" "teams.manage" "${ADMIN_A}" "sort_order = null" "${A3}")" "1"
same "D7 and writes no event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_D6 + 3))"
same "D7 no team event anywhere carries a value" \
  "$(scalar "select count(*) from public.audit_events where entity_type = 'team' and (safe_changes is not null or metadata is not null)")" "0"
same "D7 the position reads back club wide under the existing read policy" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "select sort_order from public.teams where id = '${A5}';")" "9"

same "D8 anon changes zero rows" "$(run_as anon "" "" "" "with r as (update public.teams set sort_order = 42 where id = '${A1}' returning 1) select count(*) from r;")" "0"
same "D9 a teams.manage holder of ANOTHER club changes zero rows of this one" \
  "$(updated_as "${CLUB_B}" "teams.manage" "${ADMIN_B}" "sort_order = 42" "${A1}")" "0"
same "D9 and the row is untouched" "$(scalar "select sort_order from public.teams where id = '${A1}'")" "3"
same "D8/D9 wrote no event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_D6 + 3))"

echo
echo "== E. a second apply fails at its FIRST statement and changes nothing"
ROWS_E="$(scalar "${ROWS_SQL}")"
AUDIT_E="$(scalar "select count(*) from public.audit_events")"
apply "${DB}" "${MIGRATION}" && fail "a second apply of 0051 succeeded" || true
echo "${APPLY_OUT}" | grep -q 'column "sort_order" of relation "teams" already exists' \
  || fail "the second apply did not stop at the column add: ${APPLY_OUT}"
ok "the second apply stopped at the column add, loudly"
same "and every team row, positions included, is exactly what it was" "$(scalar "${ROWS_SQL}")" "${ROWS_E}"
same "and no event was written" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_E}"
same "and the index is still there, once" \
  "$(scalar "select count(*) from pg_index where indexrelid::regclass::text = 'teams_sort_order_unique'")" "1"
same "and the before fingerprint table left nothing behind" \
  "$(scalar "select count(*) from pg_class where relname = '_0051_before'")" "0"

echo
echo "== F. the self-verification BITES: each forbidden thing aborts the apply and leaves the database untouched"
#
# Every mutation is applied to a COPY of the reviewed file against a FRESH
# pre-apply database. The apply must abort with the ONE assertion that
# catches it, matched by that assertion's own message and never by an
# alternation that another check could satisfy, and the database must show
# no sort_order column, no extra event and no probe residue afterwards,
# because the whole file is one transaction.
#
# Two families. F1 to F10 each do one thing the header forbids; four of
# them (F4, F7, F9, F10) change what the trigger writes, so the behavioural
# probe's counts in step 4 catch them before the stored source is read, and
# they are pinned to those counts honestly. F11 to F17 change NOTHING step
# 4 can see: the operands of one comparison swapped, a second read that
# prints at a level nobody listens to, a writer or an action string in dead
# code, SECURITY DEFINER dropped while the apply runs as a superuser anyway,
# the trigger recreated under another name, and a second trigger that does
# nothing. Only the catalogue reads of steps 6 and 7 can catch those, so
# each one proves that its check is still there and still bites.
mutate() { # mutate <outfile> <python replace expression on `s`>
  python3 - "${MIGRATION}" "$1" "$2" <<'PYEOF'
import sys, pathlib
src, out, expr = sys.argv[1], sys.argv[2], sys.argv[3]
s = pathlib.Path(src).read_text()
before = s
s = eval(expr)
assert s != before, "the mutation matched nothing, so this run would prove nothing"
pathlib.Path(out).write_text(s)
PYEOF
}
check_mutation() { # check_mutation <label> <expected message regex>
  local label="$1" expect="$2" db="otj_0051_mut"
  fresh_db "${db}"
  local audit_before; audit_before="$(psql_run -d "${db}" -tAc "select count(*) from public.audit_events")"
  apply "${db}" "${WORK}/mutant.sql" && fail "${label}: the apply did NOT abort, so the check is vacuous" || true
  echo "${APPLY_OUT}" | grep -Eq "${expect}" || fail "${label}: aborted for the wrong reason: ${APPLY_OUT}"
  same "${label}: aborted, and the column does not exist" \
    "$(psql_run -d "${db}" -tAc "select count(*) from information_schema.columns where table_name = 'teams' and column_name = 'sort_order'")" "0"
  same "${label}: and no event, club or team survived" \
    "$(psql_run -d "${db}" -tAc "select (select count(*) from public.audit_events) || ':' || (select count(*) from public.clubs) || ':' || (select count(*) from public.teams)")" "${audit_before}:2:7"
}

mutate "${WORK}/mutant.sql" "s.replace('alter table public.teams add column sort_order integer;', 'alter table public.teams add column sort_order integer;\nupdate public.teams set sort_order = 1 where id = (select id from public.teams order by name limit 1);', 1)"
check_mutation "F1 a backfill" "must order nobody"

mutate "${WORK}/mutant.sql" "s.replace('  on public.teams (club_id, sort_order)\n  where sort_order is not null;', '  on public.teams (club_id, sort_order);', 1)"
check_mutation "F2 a non partial index" "is missing or is not a two column partial unique index"

mutate "${WORK}/mutant.sql" "s.replace('  on public.teams (club_id, sort_order)\n  where sort_order is not null;', '  on public.teams (sort_order, club_id)\n  where sort_order is not null;', 1)"
check_mutation "F3 the key columns reversed" "the index definition is not the reviewed one"

mutate "${WORK}/mutant.sql" "s.replace(\"    if new.sort_order is distinct from old.sort_order then v_changed := array_append(v_changed, 'sort_order'); end if;\n\", '', 1)"
check_mutation "F4 sort_order missing from the allow list, which the probe sees as no event" "a team positioned then unordered must leave two team.updated events \(got 0\)"

mutate "${WORK}/mutant.sql" "s.replace('  where sort_order is not null;', '  where sort_order is not null;\ncreate policy teams_probe_policy on public.teams for select using (true);', 1)"
check_mutation "F5 a new policy" "must change no policy"

mutate "${WORK}/mutant.sql" "s.replace('  where sort_order is not null;', '  where sort_order is not null;\ngrant select (sort_order) on public.teams to anon;', 1)"
check_mutation "F6 a column scoped grant" "sort_order must carry no column scoped grant"

mutate "${WORK}/mutant.sql" "s.replace(\"  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));\n\", \"  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));\n  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));\n\", 1)"
check_mutation "F7 the writer called twice, which the probe sees as a doubled trail" "a team positioned then unordered must leave two team.updated events \(got 4\)"

mutate "${WORK}/mutant.sql" "s.replace('  where sort_order is not null;', \"  where sort_order is not null;\ninsert into public.capabilities (key, label, description) values ('teams.order', 'Order teams', 'probe');\", 1)"
check_mutation "F8 a new capability key" "must add no capability key"

mutate "${WORK}/mutant.sql" "s.replace('  where sort_order is not null;', '  where sort_order is not null;\ndrop trigger audit_teams on public.teams;', 1)"
check_mutation "F9 the audit trigger dropped, which the probe sees as no event" "a team positioned then unordered must leave two team.updated events \(got 0\)"

mutate "${WORK}/mutant.sql" "s.replace(\"    v_action := 'team.updated';\n\", \"    v_action := 'team.updated';\n    insert into public.audit_events (club_id, action, entity_type, entity_id, source, safe_changes) values (v_club, 'team.updated', 'team', v_id, 'manual', jsonb_build_object('sort_order', new.sort_order));\n\", 1)"
check_mutation "F10 a value written into an event, which the probe sees as a doubled trail" "a team positioned then unordered must leave two team.updated events \(got 4\)"

# The behaviour neutral family: step 4 passes on every one of these, so the
# abort can only come from the catalogue reads.
mutate "${WORK}/mutant.sql" "s.replace('    if new.sort_order is distinct from old.sort_order then', '    if old.sort_order is distinct from new.sort_order then', 1)"
check_mutation "F11 the comparison's operands swapped (same behaviour, different source)" "the audit_teams allow list must name sort_order by the same comparison the other fields use"

mutate "${WORK}/mutant.sql" "s.replace(\"    if new.sort_order is distinct from old.sort_order then v_changed := array_append(v_changed, 'sort_order'); end if;\n\", \"    if new.sort_order is distinct from old.sort_order then v_changed := array_append(v_changed, 'sort_order'); end if;\n    raise debug '%', new.sort_order;\n\", 1)"
check_mutation "F12 a second read of the column at a level nobody listens to" "audit_teams must read sort_order only in the comparison that names the field"

mutate "${WORK}/mutant.sql" "s.replace(\"  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));\n\", \"  if false then perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, null); end if;\n  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));\n\", 1)"
check_mutation "F13 a second writer in dead code" "audit_teams must call audit_domain_event exactly once"

mutate "${WORK}/mutant.sql" "s.replace(\"    v_action := 'team.updated';\n\", \"    v_action := 'team.updated';\n    if false then v_action := 'team.reordered'; end if;\n\", 1)"
check_mutation "F14 a fourth action string in dead code" "audit_teams must carry exactly three team actions \(got 4\)"

mutate "${WORK}/mutant.sql" "s.replace('language plpgsql\nsecurity definer\nset search_path = \'\'', 'language plpgsql\nset search_path = \'\'', 1)"
check_mutation "F15 SECURITY DEFINER dropped, invisible to an apply that runs as a superuser" "audit_teams must stay SECURITY DEFINER with an empty search_path"

mutate "${WORK}/mutant.sql" "s.replace('  where sort_order is not null;', '  where sort_order is not null;\ndrop trigger audit_teams on public.teams;\ncreate trigger audit_teams_renamed after insert or update or delete on public.teams for each row execute function public.audit_teams();', 1)"
check_mutation "F16 the audit trigger recreated under another name, still firing" "the audit_teams trigger must still fire audit_teams\(\) after insert, update and delete"

mutate "${WORK}/mutant.sql" 's.replace("  where sort_order is not null;", "  where sort_order is not null;\ncreate function public._0051_probe_noop() returns trigger language plpgsql as $$ begin return null; end $$;\ncreate trigger zz_0051_probe after update on public.teams for each row execute function public._0051_probe_noop();", 1)'
check_mutation "F17 a second trigger that does nothing" "the trigger set on teams must not move"

echo
echo "== G. nothing here touched a reviewed migration file"
same "no tracked migration file is modified" \
  "$(cd "${REPO}" && git diff --name-only -- supabase/migrations | wc -l | tr -d ' ')" "0"

echo
echo "ALL 0051 TEAM SORT ORDER ASSERTIONS PASSED"
