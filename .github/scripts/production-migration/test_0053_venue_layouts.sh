#!/usr/bin/env bash
#
# Run 0053_venue_layouts against a real PostgreSQL, on a faithful stand-in of
# the clubs, venues, seasons and audit substrate it changes, and then EXERCISE
# what it adds: the club's age group list, the venue_layouts table, its shape
# constraint, its two policies, its grants and its audit trigger, driven
# through row level security as the roles the product has. Its five
# registered object probes are flipped here too, against the same server, in
# the state the pre gate reads and the state the post gate reads.
#
# WHY THIS EXISTS. The vitest suite cannot reach a database, the security
# policy suite needs the whole local Supabase stack, and the migration's own
# self-verification is a set of assertions that could each have gone vacuous
# without anybody noticing, which is what 0049's \b defect taught. So this
# file proves five things the others cannot, on the real migration file:
#
#   * the file applies, rewrites no club, venue, season or session row, and
#     leaves every one of them byte for byte what it was, with the new column
#     empty on every club and the new table empty;
#   * driven through row level security as the roles the product has, the
#     table reads club wide, writes only under club.manage, refuses a second
#     layout of one kind and slots in one scope, refuses every shape the
#     constraint exists to refuse from a real client role, and leaves exactly
#     the audit trail the allow list says, with no value in it, from a writer
#     who cannot call the trigger function at all;
#   * the club's age group list is writable under club.manage alone and
#     bounded for every writer;
#   * the register's probes are TOTAL: false before, true after, and never an
#     error in the one state the pre gate exists to confirm;
#   * the self-verification BITES: twenty mutations of the file, each doing one
#     thing the header forbids or changing nothing a behavioural probe could
#     see, each abort the apply with the message of the ONE check that catches
#     it and leave the database untouched.
#
# WHAT IT IS NOT. The stand-in carries the tables, triggers, policies, grants
# and helper functions 0053 reads or asserts against, shaped as 0001, 0012,
# 0031, 0037, 0038 and 0044 left them, with the hosted project's blanket Data
# API grants where those tables predate the explicit grant convention. It is
# not the hosted schema and cannot prove the hosted schema matches. The pre
# and post apply gates do that, at apply time, against the real database.
#
# It runs in CI with REQUIRE_POSTGRES=1, which turns every skip below into a
# failure, because a skipped proof reported as a green check is worth less
# than no check at all. Run by hand it still skips where no server exists:
#
#   bash .github/scripts/production-migration/test_0053_venue_layouts.sh
#
# Nothing here reads, writes or connects to any hosted project, and the
# reviewed migration file is never modified: every mutation is applied to a
# copy.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION_PATH="supabase/migrations/0053_venue_layouts.sql"
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
PORT="${PGPORT_TEST:-5464}"

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
DB=otj_0053
run() { psql_run -d "${DB}" -q -c "$1" >/dev/null; }
scalar() { psql_run -d "${DB}" -tAc "$1"; }

# Synthetic clubs, members, venues, seasons and sessions. Every name is
# invented: no club venue, team or person appears anywhere in this file.
CLUB_A=11111111-0000-4000-8000-00000000000a
CLUB_B=11111111-0000-4000-8000-00000000000b
ADMIN_A=cccccccc-0000-4000-8000-000000000001
COACH_A=cccccccc-0000-4000-8000-000000000002
PARENT_A=cccccccc-0000-4000-8000-000000000004
ADMIN_B=cccccccc-0000-4000-8000-000000000003
VENUE_A1=aaaaaaaa-0000-4000-8000-000000000001
VENUE_A2=aaaaaaaa-0000-4000-8000-000000000002
VENUE_B1=bbbbbbbb-0000-4000-8000-000000000001
SEASON_A_PAST=dddddddd-0000-4000-8000-000000000001
SESSION_A1=eeeeeeee-0000-4000-8000-000000000001
SESSION_A2=eeeeeeee-0000-4000-8000-000000000002

# The canonical layouts the client writes, one per (kind, slots).
FOUR='{"version":1,"size":{"metres_wide":60,"metres_long":40},"zones":[{"n":1,"name":"Top left","x":0.02,"y":0.02,"w":0.45,"h":0.45},{"n":2,"x":0.53,"y":0.02,"w":0.45,"h":0.45},{"n":3,"x":0.02,"y":0.53,"w":0.45,"h":0.45},{"n":4,"x":0.53,"y":0.53,"w":0.45,"h":0.45}]}'
FIVE='{"version":1,"zones":[{"n":1,"x":0.02,"y":0.02,"w":0.3,"h":0.45},{"n":2,"x":0.35,"y":0.02,"w":0.3,"h":0.45},{"n":3,"x":0.68,"y":0.02,"w":0.3,"h":0.45},{"n":4,"x":0.02,"y":0.53,"w":0.45,"h":0.45},{"n":5,"x":0.53,"y":0.53,"w":0.45,"h":0.45}]}'
ONE='{"version":1,"zones":[{"n":1,"name":"Main pitch","x":0.1,"y":0.1,"w":0.8,"h":0.8}]}'
TWO='{"version":1,"zones":[{"n":1,"x":0.02,"y":0.1,"w":0.45,"h":0.8},{"n":2,"x":0.53,"y":0.1,"w":0.45,"h":0.8}]}'
THREE='{"version":1,"zones":[{"n":1,"x":0,"y":0,"w":0.3,"h":1},{"n":2,"x":0.35,"y":0,"w":0.3,"h":1},{"n":3,"x":0.7,"y":0,"w":0.3,"h":1}]}'

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
-- club.manage holder, a coach without it, a member of another club, or
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

-- clubs as 0001 created it and 0038 extended it; no explicit grant and no
-- audit trigger, which is the hosted posture.
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null, crest_url text, motto text,
  created_at timestamptz not null default now(),
  public_sharing_enabled boolean not null default false
);
alter table public.clubs enable row level security;
create policy "clubs_select_own" on public.clubs
  for select using ( id = public.my_club() );
create policy "clubs_update_manage" on public.clubs
  for update using ( id = public.my_club() and public.has_perm('club.manage') )
  with check ( id = public.my_club() and public.has_perm('club.manage') );

create table public.profiles (id uuid primary key, full_name text);
create table public.capabilities (key text primary key, label text, description text);
insert into public.capabilities values
  ('club.manage', 'Manage club settings', 'Edit the club name, motto and crest.'),
  ('sessions.create', 'Create sessions', 'Plan sessions.'),
  ('players.view', 'View players', 'See the registered players.');

-- seasons as 0031 left it: the composite key the layouts reference, one
-- current season per club, the bootstrap on a club insert, the guard that
-- refuses deleting a current season, no client delete grant.
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  starts_on date not null, ends_on date not null,
  is_current boolean not null default false, archived_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint seasons_dates_ordered check (ends_on > starts_on),
  constraint seasons_name_unique_per_club unique (club_id, name),
  constraint seasons_id_club_unique unique (id, club_id)
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
create function public.seasons_guard() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    if old.is_current and exists (select 1 from public.clubs c where c.id = old.club_id) then
      raise exception 'seasons_guard: the current season cannot be deleted';
    end if;
    return old;
  end if;
  return new;
end $fn$;
create trigger seasons_guard before delete on public.seasons
  for each row execute function public.seasons_guard();
alter table public.seasons enable row level security;
create policy "seasons_select_club" on public.seasons
  for select using ( club_id = public.my_club() );
create policy "seasons_insert_manage" on public.seasons
  for insert with check ( club_id = public.my_club() and public.has_perm('seasons.manage') and created_by = auth.uid() );
create policy "seasons_update_manage" on public.seasons
  for update using ( club_id = public.my_club() and public.has_perm('seasons.manage') )
  with check ( club_id = public.my_club() and public.has_perm('seasons.manage') );

-- venues exactly as 0044 created it, with the club scoped composite key the
-- layouts reference, and sessions as far as the venue reference reaches.
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint venues_name_unique_per_club unique (club_id, name),
  constraint venues_name_not_blank check (btrim(name, E' \t\r\n') <> ''),
  constraint venues_id_club_unique unique (id, club_id)
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null, age_group text, venue text, venue_id uuid,
  created_at timestamptz not null default now(),
  constraint sessions_id_club_unique unique (id, club_id),
  constraint sessions_venue_fk foreign key (venue_id, club_id) references public.venues (id, club_id)
    on delete set null (venue_id)
);

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

-- audit_venues exactly as 0044 left it.
create function public.audit_venues() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'venue.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'venue.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'venue.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger audit_venues after insert or update or delete on public.venues
  for each row execute function public.audit_venues();

-- Row level security and the venues policies, as 0044 left them.
alter table public.venues enable row level security;
create policy "venues_select_club" on public.venues
  for select using ( club_id = public.my_club() );
create policy "venues_manage" on public.venues
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );
alter table public.sessions enable row level security;
create policy "sessions_select_club" on public.sessions
  for select using ( club_id = public.my_club() );

-- The hosted grant posture: the legacy blanket Data API grants on the
-- tables that predate the explicit convention (clubs, profiles, sessions),
-- then the explicit revoke and grant 0031 and 0044 made, and the audit
-- writer kept private as 0037 leaves it.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
revoke all on public.seasons from anon, authenticated;
grant select, insert, update on public.seasons to authenticated;
revoke all on public.venues from anon, authenticated;
grant select, insert, update, delete on public.venues to authenticated;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
revoke execute on function public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.audit_source_context(uuid) from anon, authenticated;
revoke execute on function public.audit_batch_context() from anon, authenticated;

-- A stand-in ledger holding the row 0053 is REVIEWED AGAINST: the version
-- the 0052 apply stamped on 4 September 2026.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[], idempotency_key text unique);
insert into supabase_migrations.schema_migrations (version, name, statements, idempotency_key)
values ('20260904174142', 'atomic_team_order', array['-- reviewed elsewhere'],
        'otj:migration:0052_atomic_team_order');
SQL

cat >"${WORK}/rows.sql" <<SQL
insert into public.clubs (id, name) values ('${CLUB_A}', 'Synthetic Club A'), ('${CLUB_B}', 'Synthetic Club B');
insert into public.profiles values
  ('${ADMIN_A}', 'Synthetic Admin A'), ('${COACH_A}', 'Synthetic Coach A'),
  ('${PARENT_A}', 'Synthetic Parent A'), ('${ADMIN_B}', 'Synthetic Admin B');
insert into public.venues (id, club_id, name) values
  ('${VENUE_A1}', '${CLUB_A}', 'Synthetic Ground One'),
  ('${VENUE_A2}', '${CLUB_A}', 'Synthetic Ground Two'),
  ('${VENUE_B1}', '${CLUB_B}', 'Synthetic Ground Three');
insert into public.seasons (id, club_id, name, starts_on, ends_on, is_current) values
  ('${SEASON_A_PAST}', '${CLUB_A}', '2025/26', date '2025-07-01', date '2026-06-30', false);
insert into public.sessions (id, club_id, name, age_group, venue_id) values
  ('${SESSION_A1}', '${CLUB_A}', 'Synthetic session one', 'U8s', '${VENUE_A1}'),
  ('${SESSION_A2}', '${CLUB_A}', 'Synthetic session two', null, null);
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
CLUBS_SQL="select coalesce(md5(string_agg(to_jsonb(c)::text, ',' order by c.id)), 'empty') from public.clubs c"
CLUBS_LESS_SQL="select coalesce(md5(string_agg((to_jsonb(c) - 'age_groups')::text, ',' order by c.id)), 'empty') from public.clubs c"
VENUES_SQL="select coalesce(md5(string_agg(to_jsonb(v)::text, ',' order by v.id)), 'empty') from public.venues v"
SEASONS_SQL="select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') from public.seasons s"
SESSIONS_SQL="select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') from public.sessions s"
CLUBS_BEFORE="$(scalar "${CLUBS_SQL}")"
VENUES_BEFORE="$(scalar "${VENUES_SQL}")"
SEASONS_BEFORE="$(scalar "${SEASONS_SQL}")"
SESSIONS_BEFORE="$(scalar "${SESSIONS_SQL}")"
# The three venue inserts and the two bootstrapped seasons each fire an audit
# trigger, so the baseline is five rather than zero; comparing against a
# literal would assert the seed.
AUDIT_AT_SEED="$(scalar "select count(*) from public.audit_events")"
same "the seed left one venue.created event per venue" "$(scalar "select count(*) from public.audit_events where action = 'venue.created'")" "3"
same "and one season.created event per season" "$(scalar "select count(*) from public.audit_events where action = 'season.created'")" "3"
same "the seed left one bootstrapped season per club plus one past season" "$(scalar "select count(*) from public.seasons")" "3"
CURRENT_A="$(scalar "select id from public.seasons where club_id = '${CLUB_A}' and is_current")"
CURRENT_B="$(scalar "select id from public.seasons where club_id = '${CLUB_B}' and is_current")"

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

P_COLUMN="public.clubs.age_groups, a text array, not null, default empty"
P_TABLE="public.venue_layouts, with row level security enabled"
P_SCOPE="venue_layouts_scope_unique, the unique scope key"
P_SHAPE="public.venue_layout_is_valid(jsonb, integer), the shape predicate"
P_AUDIT="audit_venue_layouts() is SECURITY DEFINER and private to the trigger"
ALL=("${P_COLUMN}" "${P_TABLE}" "${P_SCOPE}" "${P_SHAPE}" "${P_AUDIT}")

# apply <db> <file>: run a migration file, capturing rc and output.
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
# try_as: run_as with the failure captured rather than fatal, for the
# statements that are SUPPOSED to be refused.
TRY_OUT=""
try_as() {
  set +e
  TRY_OUT="$(run_as "$@" 2>&1)"
  local rc=$?
  set -e
  return ${rc}
}
# insert_layout_as <club> <caps> <uid> <club_id> <venue> <season> <age> <kind> <slots> <zones>
insert_layout_as() {
  run_as authenticated "$1" "$2" "$3" \
    "with r as (insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
                values ('$4', '$5', '$6', '$7', '$8', $9, '${10}'::jsonb) returning 1) select count(*) from r;"
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
gate pre || fail "the pre gate rejected a correct pre-apply database: $(cat "${WORK}/gate.out")"
ok "the pre gate PASSES, so a run would proceed to the apply"
gate post && fail "the post gate passed on a database where nothing was applied" || true
ok "and the post gate correctly refuses the same read"

echo
echo "== B. the migration applies against the stand-in and its self-verification passes"
apply "${DB}" "${MIGRATION}" || fail "0053 did not apply: ${APPLY_OUT}"
ok "0053 applied"
same "the column exists as a text array, not null, default empty" \
  "$(scalar "select count(*) from information_schema.columns where table_schema='public' and table_name='clubs' and column_name='age_groups' and udt_name='_text' and is_nullable='NO' and column_default = '''{}''::text[]'")" "1"
same "the table exists with row level security on" \
  "$(scalar "select relrowsecurity from pg_class where oid = 'public.venue_layouts'::regclass")" "t"
same "the before fingerprint table was dropped at commit" \
  "$(scalar "select count(*) from pg_class where relname = '_0053_before'")" "0"
same "NO CLUB WAS CONFIGURED: every age group list is empty" \
  "$(scalar "select count(*) from public.clubs where age_groups <> '{}'")" "0"
same "every other column of every club row is byte for byte what it was" \
  "$(scalar "${CLUBS_LESS_SQL}")" "${CLUBS_BEFORE}"
same "every venue row is byte for byte what it was" "$(scalar "${VENUES_SQL}")" "${VENUES_BEFORE}"
same "every season row is byte for byte what it was" "$(scalar "${SEASONS_SQL}")" "${SEASONS_BEFORE}"
same "every session row is byte for byte what it was, age groups included" "$(scalar "${SESSIONS_SQL}")" "${SESSIONS_BEFORE}"
same "the table is empty" "$(scalar "select count(*) from public.venue_layouts")" "0"
same "the migration wrote no audit event" \
  "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"
same "the probe's synthetic club did not survive" \
  "$(scalar "select count(*) from public.clubs")" "2"
same "the probe's synthetic venue did not survive" \
  "$(scalar "select count(*) from public.venues")" "3"
same "the probe's synthetic and cascaded seasons did not survive" \
  "$(scalar "select count(*) from public.seasons")" "3"
same "the two policies are the two, mirroring venues" \
  "$(scalar "select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'venue_layouts'")" \
  "venue_layouts_manage:ALL,venue_layouts_select_club:SELECT"
same "the venues policies are still the two" \
  "$(scalar "select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where tablename = 'venues'")" \
  "venues_manage:ALL,venues_select_club:SELECT"
same "clubs gained no policy" \
  "$(scalar "select count(*) from pg_policies where tablename = 'clubs'")" "2"
same "authenticated holds exactly the four verbs on the table" \
  "$(scalar "select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name = 'venue_layouts' and grantee = 'authenticated'")" \
  "DELETE,INSERT,SELECT,UPDATE"
same "anon holds nothing on the table" \
  "$(scalar "select count(*) from information_schema.role_table_grants where table_name = 'venue_layouts' and grantee = 'anon'")" "0"
same "no capability key was added" \
  "$(scalar "select count(*) from public.capabilities")" "3"
same "the audit trigger fires audit_venue_layouts()" \
  "$(scalar "select tgfoid::regproc::text from pg_trigger where tgrelid = 'public.venue_layouts'::regclass and tgname = 'audit_venue_layouts'")" "audit_venue_layouts"
same "the venues audit trigger still fires audit_venues()" \
  "$(scalar "select tgfoid::regproc::text from pg_trigger where tgrelid = 'public.venues'::regclass and tgname = 'audit_venues'")" "audit_venues"
same "authenticated cannot execute the trigger function" \
  "$(scalar "select has_function_privilege('authenticated', 'public.audit_venue_layouts()', 'EXECUTE')")" "f"
same "but can evaluate the shape predicate, so a refused save is a constraint violation and not 42501" \
  "$(scalar "select has_function_privilege('authenticated', 'public.venue_layout_is_valid(jsonb, integer)', 'EXECUTE')")" "t"

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
    "(version, name, statements, idempotency_key) values ('20260907120000', "
    "'venue_layouts', array[" + tag + sql + tag + "], "
    "'otj:migration:0053_venue_layouts');\n"
)
PYEOF
psql_run -d "${DB}" -q -f "${WORK}/ledger.sql" >/dev/null
read_state || fail "the composed query errored after the ledger row: $(cat "${WORK}/state.err")"
gate post || fail "the post gate rejected a correct applied database: $(cat "${WORK}/gate.out")"
ok "the post gate PASSES against the ledger row 0053's apply would write"

echo
echo "== D. the table and the column, driven through row level security as the roles the product has"
# D1: the club's age group list. club.manage alone writes it; everybody in
# the club reads it; nobody outside does.
same "D1 a coach WITHOUT club.manage changes zero clubs" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "with r as (update public.clubs set age_groups = array['U8s'] where id = '${CLUB_A}' returning 1) select count(*) from r;")" "0"
same "D1 a club.manage holder of ANOTHER club changes zero rows of this one" \
  "$(run_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" "with r as (update public.clubs set age_groups = array['U8s'] where id = '${CLUB_A}' returning 1) select count(*) from r;")" "0"
same "D1 a club.manage holder sets the club's list" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (update public.clubs set age_groups = array['U7s','U8s','U9s'] where id = '${CLUB_A}' returning 1) select count(*) from r;")" "1"
same "D1 and a coach reads it back" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "select array_to_string(age_groups, ',') from public.clubs where id = '${CLUB_A}';")" "U7s,U8s,U9s"
same "D1 a parent, holding nothing, reads it too" \
  "$(run_as authenticated "${CLUB_A}" "" "${PARENT_A}" "select array_to_string(age_groups, ',') from public.clubs where id = '${CLUB_A}';")" "U7s,U8s,U9s"
same "D1 the other club reads none of it" \
  "$(run_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" "select count(*) from public.clubs where id = '${CLUB_A}';")" "0"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "update public.clubs set age_groups = array['U8s','U8s'] where id = '${CLUB_A}';" \
  && fail "D1 a duplicate age group was accepted from a club.manage holder" || true
echo "${TRY_OUT}" | grep -q "clubs_age_groups_valid" || fail "D1 the duplicate was refused by something else: ${TRY_OUT}"
ok "D1 a duplicate age group is refused by clubs_age_groups_valid for the holder too"
same "D1 and the list is where it was" \
  "$(scalar "select array_to_string(age_groups, ',') from public.clubs where id = '${CLUB_A}'")" "U7s,U8s,U9s"
same "D1 no audit event was written for the club (clubs carry no trigger, by decision)" \
  "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"

# D2: a coach without club.manage cannot create, redraw or remove a layout.
try_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A1}', '${CURRENT_A}', 'U8s', 'stations', 4, '${FOUR}');" \
  && fail "D2 a coach without club.manage inserted a layout" || true
echo "${TRY_OUT}" | grep -q "row-level security" || fail "D2 refused by something other than row level security: ${TRY_OUT}"
ok "D2 a coach WITHOUT club.manage cannot insert a layout"
same "D2 and the table is still empty" "$(scalar "select count(*) from public.venue_layouts")" "0"
same "D2 and no event was written" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"

# D3: a club.manage holder draws the four layouts of one scope, and the
# trail is the allow list and nothing more, from a writer who cannot call
# the trigger function.
same "D3 the holder draws four stations" "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${CURRENT_A}" "U8s" "stations" 4 "${FOUR}")" "1"
same "D3 five stations" "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${CURRENT_A}" "U8s" "stations" 5 "${FIVE}")" "1"
same "D3 one game" "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${CURRENT_A}" "U8s" "games" 1 "${ONE}")" "1"
same "D3 two games" "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${CURRENT_A}" "U8s" "games" 2 "${TWO}")" "1"
same "D3 and a second age group at the same venue gets its own four station layout" \
  "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${CURRENT_A}" "U7s" "stations" 4 "${FOUR}")" "1"
same "D3 and the past season at the same venue gets its own too" \
  "$(insert_layout_as "${CLUB_A}" "club.manage" "${ADMIN_A}" "${CLUB_A}" "${VENUE_A1}" "${SEASON_A_PAST}" "U8s" "stations" 4 "${FOUR}")" "1"
same "D3 six creations left six venue_layout.created events with the actor, the manual source and no field or value" \
  "$(scalar "select count(*) from public.audit_events where action = 'venue_layout.created' and entity_type = 'venue_layout' and actor_id = '${ADMIN_A}' and source = 'manual' and changed_fields is null and safe_changes is null and metadata is null and team_id is null")" "6"
same "D3 and no other event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_AT_SEED + 6))"
L_G1="$(scalar "select id from public.venue_layouts where kind = 'games' and slots = 1")"
L_S4="$(scalar "select id from public.venue_layouts where kind = 'stations' and slots = 4 and age_group = 'U8s' and season_id = '${CURRENT_A}'")"
same "D3 the holder redraws one game" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (update public.venue_layouts set zones = jsonb_set(zones, '{zones,0,x}', '0.15') where id = '${L_G1}' returning 1) select count(*) from r;")" "1"
same "D3 which records zones by name and nothing else" \
  "$(scalar "select count(*) from public.audit_events where entity_id = '${L_G1}' and action = 'venue_layout.updated' and changed_fields = array['zones'] and safe_changes is null and metadata is null and actor_id = '${ADMIN_A}'")" "1"
same "D3 a write that changes nothing reaches the row" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (update public.venue_layouts set zones = zones where id = '${L_G1}' returning 1) select count(*) from r;")" "1"
same "D3 and writes no event" "$(scalar "select count(*) from public.audit_events")" "$((AUDIT_AT_SEED + 7))"
same "D3 refiling under another age group records age_group by name" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (update public.venue_layouts set age_group = 'U9s' where id = '${L_G1}' returning 1) select count(*) from r;")" "1"
same "D3 (event)" "$(scalar "select count(*) from public.audit_events where entity_id = '${L_G1}' and changed_fields = array['age_group']")" "1"
same "D3 the holder removes one layout" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (delete from public.venue_layouts where id = '${L_G1}' returning 1) select count(*) from r;")" "1"
same "D3 (event)" "$(scalar "select count(*) from public.audit_events where entity_id = '${L_G1}' and action = 'venue_layout.deleted'")" "1"
same "D3 no layout event anywhere carries a value" \
  "$(scalar "select count(*) from public.audit_events where entity_type = 'venue_layout' and (safe_changes is not null or metadata is not null)")" "0"

# D4: the trail was written by a writer who cannot call the function.
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "select public.audit_venue_layouts();" \
  && fail "D4 authenticated called the trigger function directly" || true
echo "${TRY_OUT}" | grep -q "permission denied for function audit_venue_layouts" || fail "D4 refused for another reason: ${TRY_OUT}"
ok "D4 a direct call of audit_venue_layouts() is refused with permission denied, and the trigger fired all the same"

# D5: reads are club wide and the club boundary holds both ways.
same "D5 a coach reads the club's layouts" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "select count(*) from public.venue_layouts;")" "5"
same "D5 a parent, holding nothing, reads them too (a layout names no child)" \
  "$(run_as authenticated "${CLUB_A}" "" "${PARENT_A}" "select count(*) from public.venue_layouts;")" "5"
same "D5 a club.manage holder of another club reads none" \
  "$(run_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" "select count(*) from public.venue_layouts;")" "0"
try_as anon "" "" "" "select count(*) from public.venue_layouts;" \
  && fail "D5 anon read the table" || true
echo "${TRY_OUT}" | grep -q "permission denied for table venue_layouts" || fail "D5 anon was stopped by something other than the missing grant: ${TRY_OUT}"
ok "D5 anon holds no grant at all, so it is refused before row level security is even consulted"
try_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A2}', '${CURRENT_A}', 'U8s', 'games', 1, '${ONE}');" \
  && fail "D5 a club.manage holder planted a layout in another club" || true
echo "${TRY_OUT}" | grep -q "row-level security" || fail "D5 refused by something other than row level security: ${TRY_OUT}"
ok "D5 a club.manage holder cannot plant a layout in another club"
try_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_B}', '${VENUE_A2}', '${CURRENT_B}', 'U8s', 'games', 1, '${ONE}');" \
  && fail "D5 a layout in club B was filed against a club A venue" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_venue_fk" || fail "D5 refused by something other than the composite venue key: ${TRY_OUT}"
ok "D5 a layout cannot reference another club's venue: the composite key carries the club"
try_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_B}', '${VENUE_B1}', '${CURRENT_A}', 'U8s', 'games', 1, '${ONE}');" \
  && fail "D5 a layout in club B was filed under a club A season" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_season_fk" || fail "D5 refused by something other than the composite season key: ${TRY_OUT}"
ok "D5 nor another club's season"
same "D5 the other club changes zero rows of this one" \
  "$(run_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" "with r as (update public.venue_layouts set age_group = 'U12s' where id = '${L_S4}' returning 1) select count(*) from r;")" "0"
same "D5 and removes none" \
  "$(run_as authenticated "${CLUB_B}" "club.manage" "${ADMIN_B}" "with r as (delete from public.venue_layouts where id = '${L_S4}' returning 1) select count(*) from r;")" "0"
same "D5 a coach without club.manage changes zero rows" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "with r as (update public.venue_layouts set zones = '${FIVE}' where id = '${L_S4}' returning 1) select count(*) from r;")" "0"
same "D5 and removes none" \
  "$(run_as authenticated "${CLUB_A}" "sessions.create" "${COACH_A}" "with r as (delete from public.venue_layouts where id = '${L_S4}' returning 1) select count(*) from r;")" "0"
try_as anon "" "" "" "update public.venue_layouts set age_group = 'U12s' where id = '${L_S4}';" \
  && fail "D5 anon changed a row" || true
echo "${TRY_OUT}" | grep -q "permission denied for table venue_layouts" || fail "D5 anon write stopped by something other than the missing grant: ${TRY_OUT}"
ok "D5 and anon cannot write either"
AUDIT_D5="$(scalar "select count(*) from public.audit_events")"

# D6: the shape and the vocabulary bite for the holder, by name.
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A1}', '${CURRENT_A}', 'U8s', 'stations', 4, '${FOUR}');" \
  && fail "D6 a second four station layout in one scope was accepted" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_scope_unique" || fail "D6 the duplicate was refused by something else: ${TRY_OUT}"
ok "D6 one layout per kind and slots per scope, refused by venue_layouts_scope_unique"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A2}', '${CURRENT_A}', 'U8s', 'stations', 3, '${THREE}');" \
  && fail "D6 a three station layout was accepted" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_slots_valid" || fail "D6 three stations were refused by something else: ${TRY_OUT}"
ok "D6 three stations are not storable (venue_layouts_slots_valid)"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A2}', '${CURRENT_A}', 'U8s', 'stations', 5, '${FOUR}');" \
  && fail "D6 four zones were accepted on a five slot row" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_zones_shape" || fail "D6 the pair was refused by something else: ${TRY_OUT}"
ok "D6 four zones on a slots = 5 row are refused (venue_layouts_zones_shape)"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "update public.venue_layouts set zones = zones || '{\"lat\":53.68,\"lng\":-1.58}' where id = '${L_S4}';" \
  && fail "D6 a coordinate pair was accepted" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_zones_shape" || fail "D6 the coordinate pair was refused by something else: ${TRY_OUT}"
ok "D6 a coordinate pair is refused for the holder (venue_layouts_zones_shape)"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "update public.venue_layouts set zones = jsonb_set(zones, '{zones,0,player_id}', '\"abc\"') where id = '${L_S4}';" \
  && fail "D6 a player id was accepted on a zone" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_zones_shape" || fail "D6 the player id was refused by something else: ${TRY_OUT}"
ok "D6 a player id on a zone is refused for the holder"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "update public.venue_layouts set zones = jsonb_set(zones, '{zones,0,x}', '\"0.1\"') where id = '${L_S4}';" \
  && fail "D6 a string coordinate was accepted" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_zones_shape" || fail "D6 a string coordinate must fail the constraint rather than raise a cast error: ${TRY_OUT}"
ok "D6 a string coordinate fails the constraint cleanly, not as a cast error"
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" \
  "insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones) values ('${CLUB_A}', '${VENUE_A2}', '${CURRENT_A}', ' U8s', 'games', 1, '${ONE}');" \
  && fail "D6 an untrimmed age group was accepted" || true
echo "${TRY_OUT}" | grep -q "venue_layouts_age_group_bounded" || fail "D6 refused by something else: ${TRY_OUT}"
ok "D6 an untrimmed age group is refused (venue_layouts_age_group_bounded)"
same "D6 none of the refusals wrote an event" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_D5}"
same "D6 and the refused row is where it was" \
  "$(scalar "select zones::text = '${FOUR}'::jsonb::text from public.venue_layouts where id = '${L_S4}'")" "t"

# D7: the references. A season with layouts stays; a removed venue takes its
# layouts with it, records each, and leaves its sessions unplaced (0044).
try_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "delete from public.seasons where id = '${SEASON_A_PAST}';" \
  && fail "D7 a season holding layouts was deleted (or the holder had a delete grant)" || true
ok "D7 a club.manage holder cannot delete a season at all (no grant, as 0031 leaves it)"
set +e
SEASON_OUT="$(psql_run -d "${DB}" -tAc "delete from public.seasons where id = '${SEASON_A_PAST}';" 2>&1)"
SEASON_RC=$?
set -e
[ "${SEASON_RC}" -ne 0 ] || fail "D7 a season holding layouts was deleted by the owner"
echo "${SEASON_OUT}" | grep -q "venue_layouts_season_fk" || fail "D7 refused by something other than the restrict: ${SEASON_OUT}"
ok "D7 and even the owner cannot: venue_layouts_season_fk restricts"
N_AT_VENUE="$(scalar "select count(*) from public.venue_layouts where venue_id = '${VENUE_A1}'")"
same "D7 the holder removes the venue" \
  "$(run_as authenticated "${CLUB_A}" "club.manage" "${ADMIN_A}" "with r as (delete from public.venues where id = '${VENUE_A1}' returning 1) select count(*) from r;")" "1"
same "D7 which takes its layouts with it" "$(scalar "select count(*) from public.venue_layouts where venue_id = '${VENUE_A1}'")" "0"
same "D7 and records each" \
  "$(scalar "select count(*) from public.audit_events where action = 'venue_layout.deleted' and actor_id = '${ADMIN_A}' and source = 'manual'")" "$((N_AT_VENUE + 1))"
same "D7 and leaves the session at that venue in place, unplaced" \
  "$(scalar "select count(*) from public.sessions where id = '${SESSION_A1}' and venue_id is null")" "1"
same "D7 with its age group untouched" \
  "$(scalar "select age_group from public.sessions where id = '${SESSION_A1}'")" "U8s"

echo
echo "== E. a second apply fails at its first non idempotent statement and changes nothing"
CLUBS_E="$(scalar "${CLUBS_SQL}")"
AUDIT_E="$(scalar "select count(*) from public.audit_events")"
LAYOUTS_E="$(scalar "select count(*) from public.venue_layouts")"
FN_E="$(scalar "select md5(pg_get_functiondef('public.age_group_list_is_valid(text[])'::regprocedure))")"
apply "${DB}" "${MIGRATION}" && fail "a second apply of 0053 succeeded" || true
echo "${APPLY_OUT}" | grep -q 'column "age_groups" of relation "clubs" already exists' \
  || fail "the second apply did not stop at the column add: ${APPLY_OUT}"
ok "the second apply stopped at the column add, loudly"
same "and every club row, lists included, is exactly what it was" "$(scalar "${CLUBS_SQL}")" "${CLUBS_E}"
same "and every layout is still there" "$(scalar "select count(*) from public.venue_layouts")" "${LAYOUTS_E}"
same "and no event was written" "$(scalar "select count(*) from public.audit_events")" "${AUDIT_E}"
same "and the predicate the file replaces first rolled back to what it was" \
  "$(scalar "select md5(pg_get_functiondef('public.age_group_list_is_valid(text[])'::regprocedure))")" "${FN_E}"
same "and the before fingerprint table left nothing behind" \
  "$(scalar "select count(*) from pg_class where relname = '_0053_before'")" "0"

echo
echo "== F. the self-verification BITES: each forbidden thing aborts the apply and leaves the database untouched"
#
# Every mutation is applied to a COPY of the reviewed file against a FRESH
# pre-apply database. The apply must abort with the ONE assertion that
# catches it, matched by that assertion's own message and never by an
# alternation that another check could satisfy, and the database must show
# no age_groups column, no venue_layouts table, no extra event and no probe
# residue afterwards, because the whole file is one transaction.
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
  local label="$1" expect="$2" db="otj_0053_mut"
  fresh_db "${db}"
  local audit_before; audit_before="$(psql_run -d "${db}" -tAc "select count(*) from public.audit_events")"
  apply "${db}" "${WORK}/mutant.sql" && fail "${label}: the apply did NOT abort, so the check is vacuous" || true
  echo "${APPLY_OUT}" | grep -Eq "${expect}" || fail "${label}: aborted for the wrong reason: ${APPLY_OUT}"
  same "${label}: aborted, and neither the column nor the table exists" \
    "$(psql_run -d "${db}" -tAc "select (select count(*) from information_schema.columns where table_name = 'clubs' and column_name = 'age_groups') || ':' || (to_regclass('public.venue_layouts') is not null)::text")" "0:false"
  same "${label}: and no event, club, venue or season survived" \
    "$(psql_run -d "${db}" -tAc "select (select count(*) from public.audit_events) || ':' || (select count(*) from public.clubs) || ':' || (select count(*) from public.venues) || ':' || (select count(*) from public.seasons)")" "${audit_before}:2:3:3"
}

TRIGGER_LINE="  for each row execute function public.audit_venue_layouts();\n"

mutate "${WORK}/mutant.sql" "s.replace(\"  add column age_groups text[] not null default '{}';\", \"  add column age_groups text[] not null default '{}';\nupdate public.clubs set age_groups = array['U8s'];\", 1)"
check_mutation "F1 a backfill of the club list" "every club must start with an empty age group list"

mutate "${WORK}/mutant.sql" "s.replace(\"(kind = 'stations' and slots in (4, 5))\", \"(kind = 'stations' and slots in (3, 4, 5))\", 1)"
check_mutation "F2 three stations allowed" "a three station layout was accepted"

mutate "${WORK}/mutant.sql" "s.replace(\"                jsonb_array_length(p_layout -> 'zones') = p_slots\", \"                jsonb_array_length(p_layout -> 'zones') >= 1\", 1)"
check_mutation "F3 the zone count no longer tied to slots" "a sixth zone on a five slot row must be refused"

mutate "${WORK}/mutant.sql" "s.replace(\"    if new.zones is distinct from old.zones then v_changed := array_append(v_changed, 'zones'); end if;\n\", '', 1)"
check_mutation "F4 zones missing from the allow list" "must name zones on its allow list"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', '${TRIGGER_LINE}create policy venues_probe_policy on public.venues for select using (true);\n', 1)"
check_mutation "F5 a new policy on venues" "a policy on clubs, venues or seasons changed"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', '${TRIGGER_LINE}grant select on public.venue_layouts to anon;\n', 1)"
check_mutation "F6 a grant to anon" "anon must hold no grant on the table"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', '${TRIGGER_LINE}drop trigger audit_venue_layouts on public.venue_layouts;\n', 1)"
check_mutation "F7 the audit trigger dropped" "the audit trigger is missing"

mutate "${WORK}/mutant.sql" "s.replace('revoke execute on function public.audit_venue_layouts() from public, anon, authenticated;\n', '', 1)"
check_mutation "F8 EXECUTE on the trigger function left with public" "EXECUTE on audit_venue_layouts\(\) must be revoked from anon and authenticated"

mutate "${WORK}/mutant.sql" "s.replace(\"    v_action := 'venue_layout.updated';\n\", \"    v_action := 'venue_layout.updated';\n    insert into public.audit_events (club_id, action, entity_type, entity_id, source, safe_changes) values (v_club, 'venue_layout.updated', 'venue_layout', v_id, 'manual', jsonb_build_object('zones', new.zones));\n\", 1)"
check_mutation "F9 a value written into an event" "must never touch safe_changes or metadata"

mutate "${WORK}/mutant.sql" "s.replace(\"  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue_layout', v_id, null, nullif(v_changed, '{}'));\n\", \"  if false then perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue_layout', v_id, null, null); end if;\n  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue_layout', v_id, null, nullif(v_changed, '{}'));\n\", 1)"
check_mutation "F10 a second writer in dead code" "must call audit_domain_event exactly once"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', '${TRIGGER_LINE}create index venue_layouts_scope_prefix on public.venue_layouts (club_id, venue_id, season_id);\n', 1)"
check_mutation "F11 a redundant prefix index" "expected exactly two indexes"

mutate "${WORK}/mutant.sql" "s.replace('    foreign key (season_id, club_id) references public.seasons (id, club_id)\n    on delete restrict,', '    foreign key (season_id, club_id) references public.seasons (id, club_id)\n    on delete cascade,', 1)"
check_mutation "F12 the season reference cascading" "the season reference must be composite and restrict"

mutate "${WORK}/mutant.sql" "s.replace(\"  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )\n  with check ( club_id = public.my_club() and public.has_perm('club.manage') );\", \"  for all using ( club_id = public.my_club() and public.has_perm('sessions.create') )\n  with check ( club_id = public.my_club() and public.has_perm('sessions.create') );\", 1)"
check_mutation "F13 the write loosened to sessions.create" "venue_layouts_manage is not the club.manage write on both arms"

mutate "${WORK}/mutant.sql" "s.replace('create policy \"venue_layouts_select_club\" on public.venue_layouts\n  for select using ( club_id = public.my_club() );', 'create policy \"venue_layouts_select_club\" on public.venue_layouts\n  for select using ( true );', 1)"
check_mutation "F14 the read widened beyond the club" "venue_layouts_select_club is not the club wide read"

mutate "${WORK}/mutant.sql" "s.replace('create or replace function public.audit_venue_layouts()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = \'\'', 'create or replace function public.audit_venue_layouts()\nreturns trigger\nlanguage plpgsql\nset search_path = \'\'', 1)"
check_mutation "F15 SECURITY DEFINER dropped, invisible to an apply that runs as a superuser" "must be SECURITY DEFINER with an empty search_path"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', \"${TRIGGER_LINE}insert into public.capabilities (key, label, description) values ('layouts.manage', 'Manage layouts', 'probe');\n\", 1)"
check_mutation "F16 a new capability key" "the capability catalogue changed"

mutate "${WORK}/mutant.sql" "s.replace(\"              or g.label <> btrim(g.label, E' \\\\t\\\\r\\\\n')\n\", '', 1)"
check_mutation "F17 an untrimmed age group allowed" "an untrimmed age group must be refused"

mutate "${WORK}/mutant.sql" "s.replace(\"    and public.venue_layout_number(p_zone, 'w') between 0.05 and 1\", \"    and public.venue_layout_number(p_zone, 'w') between 0 and 1\", 1)"
check_mutation "F18 the minimum zone size dropped" "a zone narrower than the minimum must be refused"

mutate "${WORK}/mutant.sql" "s.replace('${TRIGGER_LINE}', \"${TRIGGER_LINE}update public.sessions set age_group = 'U8' where age_group = 'U8s';\n\", 1)"
check_mutation "F19 a session age group rewritten" "a session age group was rewritten"

mutate "${WORK}/mutant.sql" "s.replace(\"    and jsonb_typeof(p_layout -> 'version') = 'number'\n\", '', 1)"
check_mutation "F20 a string version accepted" "a string version must be refused"

echo
echo "== G. nothing here touched a reviewed migration file"
same "no tracked migration file is modified" \
  "$(cd "${REPO}" && git diff --name-only -- supabase/migrations | wc -l | tr -d ' ')" "0"

echo
echo "ALL 0053 VENUE LAYOUTS ASSERTIONS PASSED"
