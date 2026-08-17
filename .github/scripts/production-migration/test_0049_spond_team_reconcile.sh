#!/usr/bin/env bash
# Run 0049_spond_team_reconcile against a real PostgreSQL and then EXERCISE the
# function it adds, on a faithful stand-in of the hosted schema it was written
# for.
#
# WHY THIS EXISTS. The vitest suite proves the rule that decides what to offer.
# It runs in a browser-shaped world and cannot prove any of the properties that
# actually keep children's records safe, every one of which is a property of
# the SQL:
#
#   * an unlinked child cannot be moved AT ALL, whatever a client sends
#   * a move touches the CURRENT season and no other, so history is untouched
#   * confirming an identity and acting on it land together or not at all
#   * two managers pressing at once cannot duplicate or corrupt an assignment
#   * an existing link is never removed, repointed or overwritten
#   * no player identity is ever created, so no duplicate child appears
#   * the register and the Spond mirror are not touched by a team move
#
# Those are the claims the file's header makes. This runs them.
#
# WHAT IT IS NOT. The stand-in is a stand-in: it carries the tables, triggers,
# policies, grants and helper functions 0049 reads, writes or asserts against,
# and enough of the surrounding machinery for the self-verification to mean
# something. It is not the hosted schema and cannot prove the hosted schema
# matches. The pre and post apply gates in the workflow do that, against the
# real database, at apply time.
#
# It is NOT part of CI: the GitHub runner has no PostgreSQL server, and the
# repository's convention (see test_0048_spond_link_unique.sh) is that a one
# off proof does not earn a standing CI cost. Run it by hand when reviewing
# this migration:
#
#   .github/scripts/production-migration/test_0049_spond_team_reconcile.sh
#
# It exits 0 and prints SKIP when no PostgreSQL server binary is present.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION="${REPO}/supabase/migrations/0049_spond_team_reconcile.sql"

CLUB=11111111-1111-1111-1111-111111111111
OTHER_CLUB=22222222-2222-2222-2222-222222222222
ARGONAUTS=aaaaaaaa-0000-4000-8000-000000000001
GLADIATORS=aaaaaaaa-0000-4000-8000-000000000002
SPARTANS=aaaaaaaa-0000-4000-8000-000000000003
FOREIGN_TEAM=aaaaaaaa-0000-4000-8000-00000000000f
SEASON_NOW=bbbbbbbb-0000-4000-8000-000000000001
SEASON_LAST=bbbbbbbb-0000-4000-8000-000000000002
MANAGER=cccccccc-0000-4000-8000-000000000001
COACH=cccccccc-0000-4000-8000-000000000002
SESSION=dddddddd-0000-4000-8000-000000000001

# Synthetic children and synthetic uppercase hex member ids throughout.
P_JOEY=eeeeeeee-0000-4000-8000-000000000001
P_NOTEAM=eeeeeeee-0000-4000-8000-000000000002
P_UNLINKED=eeeeeeee-0000-4000-8000-000000000003
P_TAKEN=eeeeeeee-0000-4000-8000-000000000004
P_ARCHIVED=eeeeeeee-0000-4000-8000-000000000005
M_JOEY=0123456789ABCDEF0123456789ABCDEF
M_NOTEAM=FEDCBA9876543210FEDCBA9876543210
M_FRESH=AAAABBBBCCCCDDDDEEEEFFFF00001111
M_TAKEN=99998888777766665555444433332222
# Bound to nobody, so the player side refusal can be reached on its own
# rather than shadowed by the member side one.
M_SPARE=1111222233334444555566667777888899990000AAAABBBB

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
DATA="${WORK}/data"
PORT="${PGPORT_TEST:-5456}"

as_owner() { if [ -n "${RUN_AS}" ]; then su "${RUN_AS}" -c "$1"; else bash -c "$1"; fi }
cleanup() {
  as_owner "${PGBIN}/pg_ctl -D ${DATA} -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "${WORK}" 2>/dev/null || true
}
trap cleanup EXIT

echo "== starting a throwaway PostgreSQL in ${WORK}"
as_owner "${PGBIN}/initdb -D ${DATA} -U postgres --auth=trust" >"${WORK}/initdb.log" 2>&1
as_owner "${PGBIN}/pg_ctl -D ${DATA} -o '-k ${WORK} -h \"\" -p ${PORT}' -l ${WORK}/server.log start -w" >/dev/null

psql_run() { PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' psql --no-psqlrc --set ON_ERROR_STOP=1 "$@"; }
scalar() { psql_run -d "$1" -tAc "$2"; }
fail() { echo "FAIL: $1"; exit 1; }
ok() { echo "  ok: $1"; }
same() { [ "$2" = "$3" ] || fail "$1 (expected '$3', got '$2')"; ok "$1"; }

DB=otj_reconcile

# ---------------------------------------------------------------------
# The stand-in. Everything 0049 reads, writes or asserts against.
# ---------------------------------------------------------------------
psql_run -d postgres -qc "drop database if exists ${DB}" >/dev/null
psql_run -d postgres -qc "create database ${DB}" >/dev/null
psql_run -d "${DB}" -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- The caller context. On Supabase these come from the request JWT; here they
-- come from three session GUCs so one connection can act as a manager, a
-- coach with no capability, or a member of another club.
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

-- The two audit context readers, copied in behaviour from 0031.
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

create table public.clubs (id uuid primary key);
create table public.profiles (id uuid primary key, full_name text);
create table public.teams (
  id uuid primary key, club_id uuid not null references public.clubs(id) on delete cascade, name text not null,
  constraint teams_id_club_unique unique (id, club_id)
);
create table public.seasons (
  id uuid primary key, club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null, is_current boolean not null default false, archived_at timestamptz,
  constraint seasons_id_club_unique unique (id, club_id)
);
create unique index seasons_one_current_per_club on public.seasons (club_id) where is_current;

create table public.players (
  id uuid primary key, club_id uuid not null references public.clubs(id) on delete cascade,
  display_name text not null, created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  constraint players_id_club_unique unique (id, club_id)
);
create table public.player_registrations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null, player_id uuid not null, season_id uuid not null, team_id uuid,
  status text not null default 'pending' check (status in ('pending','registered','withdrawn')),
  shirt_number int, registered_date date,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  constraint player_registrations_player_season_unique unique (player_id, season_id),
  constraint player_registrations_player_fk foreign key (player_id, club_id)
    references public.players (id, club_id) on delete cascade,
  constraint player_registrations_season_fk foreign key (season_id, club_id)
    references public.seasons (id, club_id) on delete restrict,
  constraint player_registrations_team_fk foreign key (team_id, club_id)
    references public.teams (id, club_id) on delete set null (team_id)
);
create table public.player_spond_links (
  club_id uuid not null references public.clubs(id) on delete cascade,
  spond_member_id text not null check (spond_member_id ~ '^[0-9A-F]{16,64}$'),
  player_id uuid not null,
  matched_by text not null check (matched_by in ('suggested','chosen')),
  created_by uuid, created_at timestamptz not null default now(),
  primary key (club_id, spond_member_id),
  constraint player_spond_links_player_unique unique (player_id),
  constraint player_spond_links_player_fk foreign key (player_id, club_id)
    references public.players (id, club_id) on delete cascade
);
create table public.spond_events (
  id uuid primary key, club_id uuid not null references public.clubs(id) on delete cascade,
  constraint spond_events_id_club_unique unique (id, club_id)
);
create table public.spond_event_responses (
  club_id uuid not null, spond_event_id uuid not null, spond_member_id text not null,
  status text not null, synced_at timestamptz not null,
  primary key (spond_event_id, spond_member_id),
  constraint spond_event_responses_event_fk foreign key (spond_event_id, club_id)
    references public.spond_events (id, club_id) on delete cascade,
  constraint spond_event_responses_link_fk foreign key (club_id, spond_member_id)
    references public.player_spond_links (club_id, spond_member_id) on delete cascade
);
create table public.sessions (id uuid primary key, club_id uuid not null references public.clubs(id) on delete cascade);
create table public.register_entries (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null,
  present boolean not null default false,
  included_in_groups boolean not null default false,
  bib_colour_override text,
  primary key (session_id, player_id)
);
create table public.audit_events (
  id bigserial primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid, actor_name text, action text not null, entity_type text not null,
  entity_id uuid, season_id uuid, team_id uuid, source text not null,
  changed_fields text[], safe_changes jsonb, batch_id uuid,
  constraint audit_events_source_check check (source in (
    'manual','csv_import','xlsx_import','spond_import','renewal','system','edge_function','database_trigger'
  ))
);

-- The triggers 0049 relies on rather than reimplements: the registration
-- touch, the archived season guard, the registration audit and the link
-- audit. Copied in behaviour from 0032, 0045 and 0037.
create function public.registrations_touch() returns trigger language plpgsql as $fn$
begin
  if new.season_id is distinct from old.season_id then
    raise exception 'player_registrations: season_id is immutable' using errcode = 'P0001';
  end if;
  if new.player_id is distinct from old.player_id then
    raise exception 'player_registrations: player_id is immutable' using errcode = 'P0001';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $fn$;
create trigger registrations_touch before update on public.player_registrations
  for each row execute function public.registrations_touch();

create function public.registrations_guard_archived() returns trigger language plpgsql as $fn$
declare v_archived boolean;
begin
  select (s.archived_at is not null) into v_archived from public.seasons s where s.id = new.season_id;
  if not coalesce(v_archived, false) then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'player_registrations: cannot add a registration to an archived season' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     or new.shirt_number is distinct from old.shirt_number
     or (new.team_id is distinct from old.team_id and new.team_id is not null) then
    raise exception 'player_registrations: an archived season is read only' using errcode = 'P0001';
  end if;
  return new;
end $fn$;
create trigger registrations_guard_archived before insert or update on public.player_registrations
  for each row execute function public.registrations_guard_archived();

create function public.audit_registrations() returns trigger language plpgsql as $fn$
declare v_changed text[] := '{}'; v_safe jsonb := '{}'::jsonb; v_action text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.team_id is distinct from old.team_id then
    v_safe := v_safe || jsonb_build_object('team_id', jsonb_build_object('old', old.team_id, 'new', new.team_id));
    v_changed := array_append(v_changed, 'team_id');
  end if;
  if new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
  if array_length(v_changed, 1) is null then return new; end if;
  if 'status' = any (v_changed) then v_action := 'player.status_changed';
  else v_action := 'player.team_changed'; end if;
  insert into public.audit_events (club_id, actor_id, action, entity_type, entity_id, season_id, team_id,
                                   source, changed_fields, safe_changes, batch_id)
  values (new.club_id, auth.uid(), v_action, 'player', new.player_id, new.season_id, new.team_id,
          public.audit_source_context(auth.uid()), v_changed, v_safe, public.audit_batch_context());
  return new;
end $fn$;
create trigger audit_registrations after insert or update or delete on public.player_registrations
  for each row execute function public.audit_registrations();

create function public.player_spond_links_touch() returns trigger language plpgsql as $fn$
begin
  new.created_by := auth.uid(); new.created_at := now(); return new;
end $fn$;
create trigger player_spond_links_touch before insert on public.player_spond_links
  for each row execute function public.player_spond_links_touch();

create function public.audit_player_spond_links() returns trigger language plpgsql as $fn$
declare v_club uuid; v_player uuid; v_action text;
begin
  if tg_op = 'INSERT' then v_club := new.club_id; v_player := new.player_id; v_action := 'player.spond_linked';
  else v_club := old.club_id; v_player := old.player_id; v_action := 'player.spond_unlinked'; end if;
  insert into public.audit_events (club_id, actor_id, action, entity_type, entity_id, source, batch_id)
  values (v_club, auth.uid(), v_action, 'player', v_player,
          public.audit_source_context(auth.uid()), public.audit_batch_context());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger audit_player_spond_links after insert or delete on public.player_spond_links
  for each row execute function public.audit_player_spond_links();

-- The grant topology as the hosted project has it after 0032 and 0045: the
-- links table carries NO update grant, which is one of the two properties
-- 0049's verification asserts is still true.
alter table public.players enable row level security;
alter table public.player_registrations enable row level security;
alter table public.player_spond_links enable row level security;
alter table public.register_entries enable row level security;
create policy players_select_view on public.players for select to authenticated using (true);
create policy player_registrations_select_view on public.player_registrations for select to authenticated using (true);
create policy player_registrations_update_manage on public.player_registrations for update to authenticated using (true);
create policy player_spond_links_select_view on public.player_spond_links for select to authenticated using (true);
create policy player_spond_links_insert on public.player_spond_links for insert to authenticated with check (true);
create policy player_spond_links_delete on public.player_spond_links for delete to authenticated using (true);
create policy register_entries_select_view on public.register_entries for select to authenticated using (true);
grant select, insert, update, delete on public.players to authenticated;
grant select, insert, update on public.player_registrations to authenticated;
grant select, insert, delete on public.player_spond_links to authenticated;
grant select, insert, update, delete on public.register_entries to authenticated;
SQL

# ---------------------------------------------------------------------
# The rows. One club with three teams and two seasons, so "the current
# season and no other" is a claim with something to be wrong about.
# ---------------------------------------------------------------------
psql_run -d "${DB}" -q <<SQL
insert into public.clubs values ('${CLUB}'), ('${OTHER_CLUB}');
insert into public.profiles values ('${MANAGER}', 'Synthetic Manager'), ('${COACH}', 'Synthetic Coach');
insert into public.teams values
  ('${ARGONAUTS}', '${CLUB}', 'Argonauts'),
  ('${GLADIATORS}', '${CLUB}', 'Gladiators'),
  ('${SPARTANS}', '${CLUB}', 'Spartans'),
  ('${FOREIGN_TEAM}', '${OTHER_CLUB}', 'Somebody Else');
insert into public.seasons values
  ('${SEASON_NOW}',  '${CLUB}', '2026/27', true,  null),
  -- Seeded unarchived and archived below, after its registrations exist: the
  -- guard refuses an insert into an archived season, exactly as it does in
  -- production, where the rows predate the archiving.
  ('${SEASON_LAST}', '${CLUB}', '2025/26', false, null);

insert into public.players (id, club_id, display_name) values
  ('${P_JOEY}',     '${CLUB}', 'Joey Synthetic'),
  ('${P_NOTEAM}',   '${CLUB}', 'Noteam Synthetic'),
  ('${P_UNLINKED}', '${CLUB}', 'Unlinked Synthetic'),
  ('${P_TAKEN}',    '${CLUB}', 'Taken Synthetic'),
  ('${P_ARCHIVED}', '${CLUB}', 'Archived Synthetic');

-- Current season: everybody on Argonauts.
insert into public.player_registrations (club_id, player_id, season_id, team_id, status, shirt_number) values
  ('${CLUB}', '${P_JOEY}',     '${SEASON_NOW}', '${ARGONAUTS}', 'registered', 7),
  ('${CLUB}', '${P_NOTEAM}',   '${SEASON_NOW}', '${ARGONAUTS}', 'registered', 9),
  ('${CLUB}', '${P_UNLINKED}', '${SEASON_NOW}', '${ARGONAUTS}', 'registered', 11),
  ('${CLUB}', '${P_TAKEN}',    '${SEASON_NOW}', '${ARGONAUTS}', 'registered', 4),
  ('${CLUB}', '${P_ARCHIVED}', '${SEASON_NOW}', '${ARGONAUTS}', 'registered', 5);

-- LAST season, archived: Joey was on Spartans. Nothing this function does
-- may ever touch this row, and it is the record every historic assertion
-- below is made against.
insert into public.player_registrations (club_id, player_id, season_id, team_id, status, shirt_number) values
  ('${CLUB}', '${P_JOEY}', '${SEASON_LAST}', '${SPARTANS}', 'registered', 3);

update public.seasons set archived_at = '2026-06-30T00:00:00Z' where id = '${SEASON_LAST}';

insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by) values
  ('${CLUB}', '${M_JOEY}',   '${P_JOEY}',   'chosen'),
  ('${CLUB}', '${M_NOTEAM}', '${P_NOTEAM}', 'chosen'),
  ('${CLUB}', '${M_TAKEN}',  '${P_TAKEN}',  'chosen');

-- A saved night, so "a team move touches no session history" has something
-- to be wrong about, and one stored RSVP behind a link.
insert into public.sessions values ('${SESSION}', '${CLUB}');
insert into public.register_entries (session_id, player_id, present, included_in_groups, bib_colour_override) values
  ('${SESSION}', '${P_JOEY}', true, true, 'blue'),
  ('${SESSION}', '${P_NOTEAM}', false, true, null);
insert into public.spond_events values ('${SESSION}', '${CLUB}');
insert into public.spond_event_responses values ('${CLUB}', '${SESSION}', '${M_JOEY}', 'accepted', now());
SQL

# The baseline every "changed nothing else" assertion is made against,
# computed from OUTSIDE the migration and outside the function.
FINGERPRINT_SQL="select md5(string_agg(x, '|' order by x)) from (
  select r.player_id::text || ':' || r.season_id::text || ':' || coalesce(r.team_id::text,'-') || ':' ||
         r.status || ':' || coalesce(r.shirt_number::text,'-') as x
    from public.player_registrations r
) t"
HISTORIC_SQL="select coalesce(team_id::text,'-') || ':' || status || ':' || coalesce(shirt_number::text,'-')
  from public.player_registrations where season_id = '${SEASON_LAST}'"
REGISTER_SQL="select md5(string_agg(session_id::text || player_id::text || present::text || included_in_groups::text ||
  coalesce(bib_colour_override,'-'), '|' order by player_id::text)) from public.register_entries"
LINKS_SQL="select md5(string_agg(spond_member_id || ':' || player_id::text || ':' || matched_by, '|' order by spond_member_id))
  from public.player_spond_links"
PLAYERS_SQL="select count(*)::text || ':' || md5(string_agg(id::text, '|' order by id::text)) from public.players"
RESPONSES_SQL="select md5(string_agg(spond_member_id || status, '|' order by spond_member_id)) from public.spond_event_responses"

HISTORIC_BEFORE="$(scalar "${DB}" "${HISTORIC_SQL}")"
REGISTER_BEFORE="$(scalar "${DB}" "${REGISTER_SQL}")"
PLAYERS_BEFORE="$(scalar "${DB}" "${PLAYERS_SQL}")"
RESPONSES_BEFORE="$(scalar "${DB}" "${RESPONSES_SQL}")"
# The seed's three link inserts each fire the link audit trigger, so the
# baseline is three rather than zero. Comparing the migration against a
# literal here would have asserted the seed rather than the migration.
AUDIT_AT_SEED="$(scalar "${DB}" "select count(*) from public.audit_events")"

echo
echo "== A. the migration applies against the stand-in and its self-verification passes"
PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=notice' \
  psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "${DB}" -f "${MIGRATION}"
ok "0049 applied"
same "the function exists with exactly one overload" \
  "$(scalar "${DB}" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='spond_reconcile_player_team'")" "1"
same "the before fingerprint table was dropped at commit" \
  "$(scalar "${DB}" "select count(*) from pg_class where relname = '_0049_before'")" "0"
same "the migration wrote no audit event" \
  "$(scalar "${DB}" "select count(*) from public.audit_events")" "${AUDIT_AT_SEED}"

# The caller context helpers. Each call is one psql invocation, and each
# invocation is one connection, which is exactly how a request behaves.
call() { # call <caps> <uid> <club> <sql-args...>
  local caps="$1" uid="$2" club="$3"; shift 3
  psql_run -d "${DB}" -tAc "set otj.test_caps = '${caps}'; set otj.test_uid = '${uid}'; set otj.test_club = '${club}';
    select public.spond_reconcile_player_team($*)"
}
manager_call() { call 'players.view players.manage' "${MANAGER}" "${CLUB}" "$@"; }
# psql echoes a "SET" line per session GUC before the result, so the JSON is
# taken as the last line that looks like an object rather than by flattening
# everything the connection printed.
json_of() { printf '%s\n' "$1" | grep -E '^\{' | tail -n 1; }
outcome() { json_of "$1" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['outcome'])"; }
field() { json_of "$1" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['$2'])"; }
team_of() { scalar "${DB}" "select coalesce(team_id::text,'-') from public.player_registrations where player_id='$1' and season_id='$2'"; }

BATCH_A=f0000000-0000-4000-8000-00000000000a

echo
echo "== B. the proved path: a linked child moves, and only this season moves"
RES="$(manager_call "'${P_JOEY}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, '${BATCH_A}'::uuid")"
same "outcome" "$(outcome "${RES}")" "moved"
same "the current season registration is on Gladiators" "$(team_of "${P_JOEY}" "${SEASON_NOW}")" "${GLADIATORS}"
same "the archived season registration did not move" "$(scalar "${DB}" "${HISTORIC_SQL}")" "${HISTORIC_BEFORE}"
same "the shirt number survived the move" \
  "$(scalar "${DB}" "select shirt_number from public.player_registrations where player_id='${P_JOEY}' and season_id='${SEASON_NOW}'")" "7"
same "the status survived the move" \
  "$(scalar "${DB}" "select status from public.player_registrations where player_id='${P_JOEY}' and season_id='${SEASON_NOW}'")" "registered"
same "one player.team_changed was audited, with the run batch id" \
  "$(scalar "${DB}" "select count(*) from public.audit_events where action='player.team_changed' and batch_id='${BATCH_A}' and entity_id='${P_JOEY}'")" "1"
same "the audit records the old and the new team, and no name" \
  "$(scalar "${DB}" "select safe_changes->'team_id'->>'old' || '>' || (safe_changes->'team_id'->>'new') from public.audit_events where action='player.team_changed' and batch_id='${BATCH_A}'")" \
  "${ARGONAUTS}>${GLADIATORS}"
# Scoped to the events THIS call produced: the seed's own link inserts ran
# with no signed in actor and correctly recorded 'database_trigger', which is
# a fact about the seed rather than about the function.
same "the audit source stayed inside the existing vocabulary" \
  "$(scalar "${DB}" "select distinct source from public.audit_events where batch_id='${BATCH_A}'")" "manual"
same "no player identity was created" "$(scalar "${DB}" "${PLAYERS_SQL}")" "${PLAYERS_BEFORE}"
same "the saved night is untouched" "$(scalar "${DB}" "${REGISTER_SQL}")" "${REGISTER_BEFORE}"
same "the stored Spond replies are untouched" "$(scalar "${DB}" "${RESPONSES_SQL}")" "${RESPONSES_BEFORE}"
same "the links are untouched" \
  "$(scalar "${DB}" "select matched_by from public.player_spond_links where spond_member_id='${M_JOEY}'")" "chosen"

echo
echo "== C. a repeat press is an idempotent no-op, not a second event"
AUDIT_BEFORE="$(scalar "${DB}" "select count(*) from public.audit_events")"
RES="$(manager_call "'${P_JOEY}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, '${BATCH_A}'::uuid")"
same "outcome" "$(outcome "${RES}")" "already_matched"
same "no second audit event" "$(scalar "${DB}" "select count(*) from public.audit_events")" "${AUDIT_BEFORE}"

echo
echo "== D. a row somebody else moved is refused, not overwritten"
psql_run -d "${DB}" -qc "set otj.test_uid = '${MANAGER}'; update public.player_registrations set team_id = '${SPARTANS}'
  where player_id='${P_JOEY}' and season_id='${SEASON_NOW}'" >/dev/null
RES="$(manager_call "'${P_JOEY}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null")"
same "outcome" "$(outcome "${RES}")" "stale"
same "the other manager's decision stands" "$(team_of "${P_JOEY}" "${SEASON_NOW}")" "${SPARTANS}"

echo
echo "== E. Unassigned is a destination, and it is not the same as a refusal"
RES="$(manager_call "'${P_NOTEAM}'::uuid, '${ARGONAUTS}'::uuid, null, '${M_NOTEAM}', null, null")"
same "outcome" "$(outcome "${RES}")" "moved"
same "the registration is Unassigned" "$(team_of "${P_NOTEAM}" "${SEASON_NOW}")" "-"
same "the registration still exists" \
  "$(scalar "${DB}" "select count(*) from public.player_registrations where player_id='${P_NOTEAM}' and season_id='${SEASON_NOW}'")" "1"

echo
echo "== F. THE IDENTITY RULE: an unlinked child cannot be moved, whatever the client sends"
RES="$(manager_call "'${P_UNLINKED}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_FRESH}', null, null")"
same "outcome" "$(outcome "${RES}")" "not_linked"
same "the registration did not move" "$(team_of "${P_UNLINKED}" "${SEASON_NOW}")" "${ARGONAUTS}"
same "no link was invented" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where player_id='${P_UNLINKED}'")" "0"

echo
echo "== G. the confirm path: the link and the move land together, sharing one batch"
BATCH_B=f0000000-0000-4000-8000-00000000000b
RES="$(manager_call "'${P_UNLINKED}'::uuid, '${ARGONAUTS}'::uuid, '${SPARTANS}'::uuid, null, '${M_FRESH}', '${BATCH_B}'::uuid")"
same "outcome" "$(outcome "${RES}")" "moved"
same "link_created" "$(field "${RES}" link_created)" "True"
same "the link exists and records a human decision" \
  "$(scalar "${DB}" "select matched_by from public.player_spond_links where spond_member_id='${M_FRESH}'")" "suggested"
same "the link records who bound it, stamped by the database" \
  "$(scalar "${DB}" "select created_by from public.player_spond_links where spond_member_id='${M_FRESH}'")" "${MANAGER}"
same "the registration moved" "$(team_of "${P_UNLINKED}" "${SEASON_NOW}")" "${SPARTANS}"
same "both events carry the one batch id" \
  "$(scalar "${DB}" "select string_agg(action, ',' order by action) from public.audit_events where batch_id='${BATCH_B}'")" \
  "player.spond_linked,player.team_changed"

echo
echo "== H. ATOMICITY: when the move cannot happen, the link is not created either"
# The archived season guard is the available way to make the UPDATE fail after
# the INSERT has run in the same transaction. It is a stand-in for every
# reason a write can fail; what is being proved is that the two halves share
# a fate, not which failure caused it.
psql_run -d "${DB}" -qc "update public.seasons set archived_at = now() where id = '${SEASON_NOW}'" >/dev/null
set +e
OUT="$(manager_call "'${P_ARCHIVED}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${M_TAKEN}0', null" 2>&1)"
RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "the archived season did not refuse the move"
echo "${OUT}" | grep -q "archived season is read only" || fail "an unexpected error: ${OUT}"
ok "the move was refused"
same "and the link the same call would have created does not exist" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${M_TAKEN}0'")" "0"
same "and the registration did not move" "$(team_of "${P_ARCHIVED}" "${SEASON_NOW}")" "${ARGONAUTS}"
psql_run -d "${DB}" -qc "update public.seasons set archived_at = null where id = '${SEASON_NOW}'" >/dev/null

echo
echo "== I. an existing link is never taken, repointed or overwritten"
LINKS_BEFORE="$(scalar "${DB}" "${LINKS_SQL}")"
# A member already bound to a different child.
RES="$(manager_call "'${P_ARCHIVED}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${M_JOEY}', null")"
same "a contested member is refused" "$(outcome "${RES}")" "member_linked_elsewhere"
same "and nothing moved" "$(team_of "${P_ARCHIVED}" "${SEASON_NOW}")" "${ARGONAUTS}"
# A child already bound to a different member.
RES="$(manager_call "'${P_TAKEN}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${M_SPARE}', null")"
same "an already bound child is refused" "$(outcome "${RES}")" "player_linked_elsewhere"
same "and the free member stayed free, so nothing was half bound" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${M_SPARE}'")" "0"
same "and nothing moved" "$(team_of "${P_TAKEN}" "${SEASON_NOW}")" "${ARGONAUTS}"
same "every stored link is exactly as it was" "$(scalar "${DB}" "${LINKS_SQL}")" "${LINKS_BEFORE}"
# Re-confirming the SAME pairing is a no-op on the link and still moves.
RES="$(manager_call "'${P_TAKEN}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${M_TAKEN}', null")"
same "re-confirming the same pairing moves" "$(outcome "${RES}")" "moved"
same "and creates no second link" "$(field "${RES}" link_created)" "False"

echo
echo "== J. the gates: capability, club and the member id vocabulary"
set +e
OUT="$(call 'players.view' "${COACH}" "${CLUB}" "'${P_JOEY}'::uuid, '${SPARTANS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null" 2>&1)"; RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "a caller without players.manage was allowed"
echo "${OUT}" | grep -q "players.manage" || fail "an unexpected error: ${OUT}"
ok "a coach without players.manage is refused"

set +e
OUT="$(call '' '' '' "'${P_JOEY}'::uuid, '${SPARTANS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null" 2>&1)"; RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "an unauthenticated caller was allowed"
echo "${OUT}" | grep -q "not signed in" || fail "an unexpected error: ${OUT}"
ok "an unauthenticated caller is refused"

set +e
OUT="$(manager_call "'${P_JOEY}'::uuid, '${SPARTANS}'::uuid, '${FOREIGN_TEAM}'::uuid, '${M_JOEY}', null, null" 2>&1)"; RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "a cross club destination team was allowed"
echo "${OUT}" | grep -q "not in your club" || fail "an unexpected error: ${OUT}"
ok "a destination team in another club is refused"

for bad in "'Joey Synthetic'" "'parent@example.invalid'" "'+447700900000'" "'ABCDEF'" "'not-a-member-id'" "''"; do
  set +e
  OUT="$(manager_call "'${P_ARCHIVED}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, ${bad}, null" 2>&1)"; RC=$?
  set -e
  [ "${RC}" -ne 0 ] || fail "the member id vocabulary accepted ${bad}"
done
ok "a name, an email address, a phone number and a too short id are all unrepresentable"
same "and none of them moved anybody" "$(team_of "${P_ARCHIVED}" "${SEASON_NOW}")" "${ARGONAUTS}"

# A LOWERCASE id is normalised rather than refused, which is what
# reduceLinkCandidate already does on the way out of Spond. It is stored in
# the uppercase form the column's own check requires, so the normalisation
# widens what the caller may SEND and never what the column may HOLD.
RES="$(manager_call "'${P_ARCHIVED}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '$(echo "${M_SPARE}" | tr 'A-Z' 'a-z')', null")"
same "a lowercase member id is normalised, not refused" "$(outcome "${RES}")" "moved"
same "and it is stored uppercase" \
  "$(scalar "${DB}" "select spond_member_id from public.player_spond_links where player_id='${P_ARCHIVED}'")" "${M_SPARE}"

RES="$(manager_call "'99999999-9999-4999-8999-999999999999'::uuid, null, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null")"
same "a player with no current season registration is refused, never invented" "$(outcome "${RES}")" "no_registration"
same "no player identity appeared" "$(scalar "${DB}" "${PLAYERS_SQL}")" "${PLAYERS_BEFORE}"

echo
echo "== F2. THE STALE LINK RACE: a proved move names the member it reasoned from"
# The race a review found. The screen works the target out from ONE member's
# Spond subgroups. Between the scan and the press another manager can unlink
# that member and correctly link the child to a DIFFERENT one, whose Spond team
# may be somewhere else entirely. The child still has a link, and their OTJ team
# need not have changed, so neither "does this child have a link" nor the
# expected-team check notices. The move must not apply.
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name)
  values ('eeeeeeee-0000-4000-8000-00000000000c', '${CLUB}', 'Relinked Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status)
  values ('${CLUB}', 'eeeeeeee-0000-4000-8000-00000000000c', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
  values ('${CLUB}', 'CCCC2222CCCC2222CCCC2222CCCC2222', 'eeeeeeee-0000-4000-8000-00000000000c', 'chosen');
SQL
# The screen read member CCCC and worked out Gladiators. Now somebody unlinks
# CCCC and links DDDD instead: same child, same OTJ team, different identity.
psql_run -d "${DB}" -q <<SQL
delete from public.player_spond_links where spond_member_id = 'CCCC2222CCCC2222CCCC2222CCCC2222';
insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
  values ('${CLUB}', 'DDDD3333DDDD3333DDDD3333DDDD3333', 'eeeeeeee-0000-4000-8000-00000000000c', 'chosen');
SQL
RES="$(manager_call "'eeeeeeee-0000-4000-8000-00000000000c'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, 'CCCC2222CCCC2222CCCC2222CCCC2222', null, null")"
same "a repointed link refuses the move it was not derived from" "$(outcome "${RES}")" "stale_link"
same "and the child did not move" "$(team_of 'eeeeeeee-0000-4000-8000-00000000000c' "${SEASON_NOW}")" "${ARGONAUTS}"
same "and the link somebody else made is untouched" \
  "$(scalar "${DB}" "select spond_member_id from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-00000000000c'")" \
  "DDDD3333DDDD3333DDDD3333DDDD3333"
# The same call naming the member the child IS linked to still works, so the
# check refuses a stale identity rather than refusing everything.
RES="$(manager_call "'eeeeeeee-0000-4000-8000-00000000000c'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, 'DDDD3333DDDD3333DDDD3333DDDD3333', null, null")"
same "naming the current link still moves" "$(outcome "${RES}")" "moved"
# A proved call for a child with no link at all is still the other refusal.
RES="$(manager_call "'${P_TAKEN}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_SPARE}', null, null")"
same "a proved call naming a member this child never had is stale_link, not a move" \
  "$(outcome "${RES}")" "stale_link"

# And a null member argument can no longer mean "any link will do".
set +e
OUT="$(manager_call "'${P_TAKEN}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, null, null" 2>&1)"; RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "a call naming no member was accepted"
echo "${OUT}" | grep -q 'exactly one' || fail "an unexpected error: ${OUT}"
set +e
OUT="$(manager_call "'${P_TAKEN}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_TAKEN}', '${M_TAKEN}', null" 2>&1)"; RC=$?
set -e
[ "${RC}" -ne 0 ] || fail "a call naming both members was accepted"
ok "naming neither member, and naming both, are both refused"
psql_run -d "${DB}" -qc "delete from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-00000000000c';
  delete from public.player_registrations where player_id='eeeeeeee-0000-4000-8000-00000000000c';
  delete from public.players where id='eeeeeeee-0000-4000-8000-00000000000c';" >/dev/null

echo
echo "== K. CONCURRENCY: two managers pressing on one child at the same moment"
psql_run -d "${DB}" -qc "set otj.test_uid='${MANAGER}'; update public.player_registrations set team_id='${ARGONAUTS}'
  where player_id='${P_JOEY}' and season_id='${SEASON_NOW}'" >/dev/null
psql_run -d "${DB}" -qc "delete from public.audit_events" >/dev/null

# The first connection takes the per child advisory lock and holds the whole
# decision open; the second is started while it is still inside its
# transaction, so it must WAIT rather than interleave.
(
  psql_run -d "${DB}" -tAc "set otj.test_caps='players.view players.manage'; set otj.test_uid='${MANAGER}'; set otj.test_club='${CLUB}';
    begin;
    select public.spond_reconcile_player_team('${P_JOEY}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null);
    select pg_sleep(2);
    commit;" > "${WORK}/racer1.out" 2>&1
) &
RACER1=$!
sleep 0.6
psql_run -d "${DB}" -tAc "set otj.test_caps='players.view players.manage'; set otj.test_uid='${COACH}'; set otj.test_club='${CLUB}';
  select public.spond_reconcile_player_team('${P_JOEY}'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, '${M_JOEY}', null, null);" \
  > "${WORK}/racer2.out" 2>&1
wait "${RACER1}"

grep -q '"outcome": "moved"' "${WORK}/racer1.out" \
  || fail "the first racer did not move the player: $(cat "${WORK}/racer1.out")"
grep -q 'already_matched' "${WORK}/racer2.out" \
  || fail "the second racer did not see the first one's decision: $(cat "${WORK}/racer2.out")"
ok "the second press waited for the first and then found nothing to do"
same "the child is on exactly one team" "$(team_of "${P_JOEY}" "${SEASON_NOW}")" "${GLADIATORS}"
same "exactly one team change was recorded, not two" \
  "$(scalar "${DB}" "select count(*) from public.audit_events where action='player.team_changed'")" "1"
same "exactly one current season registration exists for that child" \
  "$(scalar "${DB}" "select count(*) from public.player_registrations where player_id='${P_JOEY}' and season_id='${SEASON_NOW}'")" "1"

echo
echo "== K2. CONCURRENCY: two CROSSED confirmations, which is the deadlock shape"
# Two calls, each trying to bind a member that the OTHER call's child already
# holds. They touch the same two link rows, so taking those rows in CALLER
# order admits a lock cycle; the canonical ORDER BY on the lock statement is
# what removes it.
#
# WHAT THIS TEST ACTUALLY PROVES, stated rather than implied. It exercises the
# shape and asserts the honest outcome: both calls REFUSE, neither moves
# anybody, and neither dies with a deadlock (40P01). It does NOT reliably
# reproduce the interleaving that the ordering prevents: the window between
# the two row locks inside the function is microseconds, and this harness
# cannot step a transaction into the middle of a plpgsql body. Reverting the
# ORDER BY and re-running it passes, which was checked rather than assumed. So
# read a pass as "the crossed shape behaves", never as "the ordering is
# proved necessary"; the argument for the ordering is the lock cycle itself,
# and the tripwire in the migration's own verification is what keeps it.
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name) values
  ('eeeeeeee-0000-4000-8000-00000000000a', '${CLUB}', 'Crossed One Synthetic'),
  ('eeeeeeee-0000-4000-8000-00000000000b', '${CLUB}', 'Crossed Two Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status) values
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-00000000000a', '${SEASON_NOW}', '${ARGONAUTS}', 'registered'),
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-00000000000b', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by) values
  ('${CLUB}', 'AAAA0000AAAA0000AAAA0000AAAA0000', 'eeeeeeee-0000-4000-8000-00000000000a', 'chosen'),
  ('${CLUB}', 'BBBB1111BBBB1111BBBB1111BBBB1111', 'eeeeeeee-0000-4000-8000-00000000000b', 'chosen');
SQL

crossed() { # crossed <player> <member> <outfile>
  psql_run -d "${DB}" -tAc "set otj.test_caps='players.view players.manage'; set otj.test_uid='${MANAGER}'; set otj.test_club='${CLUB}';
    begin;
    select pg_sleep(0.2);
    select public.spond_reconcile_player_team('$1'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '$2', null);
    select pg_sleep(0.4);
    commit;" > "$3" 2>&1 || echo "PSQL_FAILED" >> "$3"
}
( crossed 'eeeeeeee-0000-4000-8000-00000000000a' 'BBBB1111BBBB1111BBBB1111BBBB1111' "${WORK}/cross1.out" ) &
C1=$!
( crossed 'eeeeeeee-0000-4000-8000-00000000000b' 'AAAA0000AAAA0000AAAA0000AAAA0000' "${WORK}/cross2.out" ) &
C2=$!
wait "${C1}"; wait "${C2}"
for f in cross1 cross2; do
  grep -q 'deadlock' "${WORK}/${f}.out" && fail "a crossed confirmation deadlocked: $(cat "${WORK}/${f}.out")"
  grep -q 'PSQL_FAILED' "${WORK}/${f}.out" && fail "a crossed confirmation failed: $(cat "${WORK}/${f}.out")"
  # Either refusal is correct: the member side check runs first, so which of
  # the two fires depends on which row is contested, and both mean the same
  # thing to a manager. What must never happen is a move or a deadlock.
  grep -qE 'member_linked_elsewhere|player_linked_elsewhere' "${WORK}/${f}.out" \
    || fail "a crossed confirmation did not refuse: $(cat "${WORK}/${f}.out")"
  grep -q '"outcome": "moved"' "${WORK}/${f}.out" \
    && fail "a crossed confirmation moved somebody: $(cat "${WORK}/${f}.out")"
done
ok "both crossed confirmations refused, and neither deadlocked"
same "and neither link moved" \
  "$(scalar "${DB}" "select string_agg(spond_member_id, ',' order by spond_member_id) from public.player_spond_links where player_id in ('eeeeeeee-0000-4000-8000-00000000000a','eeeeeeee-0000-4000-8000-00000000000b')")" \
  "AAAA0000AAAA0000AAAA0000AAAA0000,BBBB1111BBBB1111BBBB1111BBBB1111"
psql_run -d "${DB}" -qc "delete from public.player_spond_links where player_id in ('eeeeeeee-0000-4000-8000-00000000000a','eeeeeeee-0000-4000-8000-00000000000b');
  delete from public.player_registrations where player_id in ('eeeeeeee-0000-4000-8000-00000000000a','eeeeeeee-0000-4000-8000-00000000000b');
  delete from public.players where id in ('eeeeeeee-0000-4000-8000-00000000000a','eeeeeeee-0000-4000-8000-00000000000b');" >/dev/null

echo
echo "== K3. CONCURRENCY: the SAME not yet linked member confirmed for two children"
# The case the row locks structurally cannot cover, found by a review. A member
# with no link has NO ROW, so there is nothing for FOR UPDATE to hold: two
# confirmations of the same free member take two different per child locks,
# both read "nobody owns this member", and both reach the insert. The unique
# constraint keeps the data correct, but without the per member advisory lock
# the loser surfaces a raw 23505 rather than the documented refusal.
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name) values
  ('eeeeeeee-0000-4000-8000-00000000000d', '${CLUB}', 'Contender One Synthetic'),
  ('eeeeeeee-0000-4000-8000-00000000000e', '${CLUB}', 'Contender Two Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status) values
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-00000000000d', '${SEASON_NOW}', '${ARGONAUTS}', 'registered'),
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-00000000000e', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
SQL
FREE_MEMBER=EEEE4444EEEE4444EEEE4444EEEE4444
same "the contested member starts with no link row to lock" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${FREE_MEMBER}'")" "0"

# The first holds its transaction open across the insert; the second starts
# while it is still open, so without the member key lock it would read an
# empty ownership and race to the same insert.
(
  psql_run -d "${DB}" -tAc "set otj.test_caps='players.view players.manage'; set otj.test_uid='${MANAGER}'; set otj.test_club='${CLUB}';
    begin;
    select public.spond_reconcile_player_team('eeeeeeee-0000-4000-8000-00000000000d'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${FREE_MEMBER}', null);
    select pg_sleep(2);
    commit;" > "${WORK}/free1.out" 2>&1 || echo "PSQL_FAILED" >> "${WORK}/free1.out"
) &
F1=$!
sleep 0.6
psql_run -d "${DB}" -tAc "set otj.test_caps='players.view players.manage'; set otj.test_uid='${COACH}'; set otj.test_club='${CLUB}';
  select public.spond_reconcile_player_team('eeeeeeee-0000-4000-8000-00000000000e'::uuid, '${ARGONAUTS}'::uuid, '${SPARTANS}'::uuid, null, '${FREE_MEMBER}', null);" \
  > "${WORK}/free2.out" 2>&1 || echo "PSQL_FAILED" >> "${WORK}/free2.out"
wait "${F1}"

grep -q '"outcome": "moved"' "${WORK}/free1.out" \
  || fail "the first confirmation did not win: $(cat "${WORK}/free1.out")"
grep -q 'PSQL_FAILED' "${WORK}/free2.out" \
  && fail "the loser raised instead of returning an outcome: $(cat "${WORK}/free2.out")"
grep -qiE 'duplicate key|23505|unique constraint' "${WORK}/free2.out" \
  && fail "the loser surfaced a raw unique violation: $(cat "${WORK}/free2.out")"
grep -q 'member_linked_elsewhere' "${WORK}/free2.out" \
  || fail "the loser did not get the documented refusal: $(cat "${WORK}/free2.out")"
grep -qi 'deadlock' "${WORK}/free1.out" "${WORK}/free2.out" \
  && fail "the free member race deadlocked"
ok "exactly one confirmation won, and the loser got member_linked_elsewhere"
same "exactly one link exists for that member" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${FREE_MEMBER}'")" "1"
same "and it belongs to the winner" \
  "$(scalar "${DB}" "select player_id from public.player_spond_links where spond_member_id='${FREE_MEMBER}'")" \
  "eeeeeeee-0000-4000-8000-00000000000d"
same "the winner moved" "$(team_of 'eeeeeeee-0000-4000-8000-00000000000d' "${SEASON_NOW}")" "${GLADIATORS}"
same "the loser did not move" "$(team_of 'eeeeeeee-0000-4000-8000-00000000000e' "${SEASON_NOW}")" "${ARGONAUTS}"
same "and the loser acquired no link at all" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-00000000000e'")" "0"
psql_run -d "${DB}" -qc "delete from public.player_spond_links where player_id in ('eeeeeeee-0000-4000-8000-00000000000d','eeeeeeee-0000-4000-8000-00000000000e');
  delete from public.player_registrations where player_id in ('eeeeeeee-0000-4000-8000-00000000000d','eeeeeeee-0000-4000-8000-00000000000e');
  delete from public.players where id in ('eeeeeeee-0000-4000-8000-00000000000d','eeeeeeee-0000-4000-8000-00000000000e');" >/dev/null

echo
echo "== K4. CONCURRENCY: a DIRECT link insert racing an RPC confirmation"
#
# A REVIEW FINDING. The two advisory locks serialise callers of this function
# and nothing else. The ordinary linking screen still inserts into
# player_spond_links DIRECTLY, from Accept and from Choose, and takes no
# advisory lock, so the confirmation insert can lose either unique key to it.
# The database stays correct because the constraints are the enforcement;
# what was wrong was the REPORT, a raw 23505 rather than a named outcome.
#
# Both shapes are forced deterministically by holding the direct insert open
# in its own transaction: the RPC reads ownership (sees nothing, the row is
# uncommitted), reaches its INSERT, and BLOCKS on the index until the direct
# transaction commits, at which point it raises and the handler re-reads.

direct_insert_holds() { # direct_insert_holds <member> <player> <outfile>
  psql_run -d "${DB}" -tAc "set otj.test_uid='${MANAGER}';
    begin;
    insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
      values ('${CLUB}', '$1', '$2'::uuid, 'chosen');
    select pg_sleep(2);
    commit;" > "$3" 2>&1 || echo "PSQL_FAILED" >> "$3"
}

no_raw_violation() { # no_raw_violation <label> <outfile>
  grep -qiE 'duplicate key|23505|unique constraint' "$2" \
    && fail "$1: the RPC surfaced a raw unique violation: $(cat "$2")"
  grep -q 'PSQL_FAILED' "$2" && fail "$1: the RPC raised instead of returning: $(cat "$2")"
  grep -qi 'deadlock' "$2" && fail "$1: deadlocked"
  return 0
}

# ---- A. the direct insert claims the same MEMBER for another child --------
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name) values
  ('eeeeeeee-0000-4000-8000-000000000010', '${CLUB}', 'Racer One Synthetic'),
  ('eeeeeeee-0000-4000-8000-000000000011', '${CLUB}', 'Racer Two Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status) values
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-000000000010', '${SEASON_NOW}', '${ARGONAUTS}', 'registered'),
  ('${CLUB}', 'eeeeeeee-0000-4000-8000-000000000011', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
SQL
RACE_MEMBER=FFFF5555FFFF5555FFFF5555FFFF5555
( direct_insert_holds "${RACE_MEMBER}" 'eeeeeeee-0000-4000-8000-000000000011' "${WORK}/directA.out" ) &
DA=$!
sleep 0.6
RES="$(manager_call "'eeeeeeee-0000-4000-8000-000000000010'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${RACE_MEMBER}', null" 2>&1 || echo PSQL_FAILED)"
printf '%s\n' "${RES}" > "${WORK}/rpcA.out"
wait "${DA}"
grep -q 'PSQL_FAILED' "${WORK}/directA.out" && fail "the direct insert did not land: $(cat "${WORK}/directA.out")"
no_raw_violation "member race" "${WORK}/rpcA.out"
same "the RPC names the member side loss" "$(outcome "${RES}")" "member_linked_elsewhere"
same "and the losing child did not move" "$(team_of 'eeeeeeee-0000-4000-8000-000000000010' "${SEASON_NOW}")" "${ARGONAUTS}"
same "exactly one link exists for the contested member" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${RACE_MEMBER}'")" "1"
same "and it belongs to the direct inserter" \
  "$(scalar "${DB}" "select player_id from public.player_spond_links where spond_member_id='${RACE_MEMBER}'")" \
  "eeeeeeee-0000-4000-8000-000000000011"
same "the losing child acquired no link, so nothing landed by halves" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-000000000010'")" "0"
same "and the direct inserter was not moved either, since nothing asked for it" \
  "$(team_of 'eeeeeeee-0000-4000-8000-000000000011' "${SEASON_NOW}")" "${ARGONAUTS}"

# ---- B. the direct insert claims the same PLAYER for another member -------
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name)
  values ('eeeeeeee-0000-4000-8000-000000000012', '${CLUB}', 'Racer Three Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status)
  values ('${CLUB}', 'eeeeeeee-0000-4000-8000-000000000012', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
SQL
RACE_MEMBER_B=AAAA6666AAAA6666AAAA6666AAAA6666
RACE_MEMBER_C=BBBB7777BBBB7777BBBB7777BBBB7777
( direct_insert_holds "${RACE_MEMBER_C}" 'eeeeeeee-0000-4000-8000-000000000012' "${WORK}/directB.out" ) &
DB_PID=$!
sleep 0.6
RES="$(manager_call "'eeeeeeee-0000-4000-8000-000000000012'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${RACE_MEMBER_B}', null" 2>&1 || echo PSQL_FAILED)"
printf '%s\n' "${RES}" > "${WORK}/rpcB.out"
wait "${DB_PID}"
grep -q 'PSQL_FAILED' "${WORK}/directB.out" && fail "the direct insert did not land: $(cat "${WORK}/directB.out")"
no_raw_violation "player race" "${WORK}/rpcB.out"
same "the RPC names the player side loss" "$(outcome "${RES}")" "player_linked_elsewhere"
same "and the child did not move" "$(team_of 'eeeeeeee-0000-4000-8000-000000000012' "${SEASON_NOW}")" "${ARGONAUTS}"
same "exactly one link exists for that child" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-000000000012'")" "1"
same "and it is the one the direct insert made, not the confirmed one" \
  "$(scalar "${DB}" "select spond_member_id from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-000000000012'")" \
  "${RACE_MEMBER_C}"
same "the member the RPC was confirming stayed free" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id='${RACE_MEMBER_B}'")" "0"

# ---- C. and an uncontested confirm still links and moves, atomically ------
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name)
  values ('eeeeeeee-0000-4000-8000-000000000013', '${CLUB}', 'Racer Four Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status)
  values ('${CLUB}', 'eeeeeeee-0000-4000-8000-000000000013', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
SQL
CLEAN_MEMBER=CCCC8888CCCC8888CCCC8888CCCC8888
BATCH_C=f0000000-0000-4000-8000-00000000000c
RES="$(manager_call "'eeeeeeee-0000-4000-8000-000000000013'::uuid, '${ARGONAUTS}'::uuid, '${SPARTANS}'::uuid, null, '${CLEAN_MEMBER}', '${BATCH_C}'::uuid")"
same "an uncontested confirmation still moves" "$(outcome "${RES}")" "moved"
same "and still creates the link" "$(field "${RES}" link_created)" "True"
same "both halves in one batch" \
  "$(scalar "${DB}" "select string_agg(action, ',' order by action) from public.audit_events where batch_id='${BATCH_C}'")" \
  "player.spond_linked,player.team_changed"

# ---- D. and the same pairing arriving by BOTH routes is not a refusal -----
# A direct insert that makes exactly the link this call was going to make is
# not a lost race: the identity is the confirmed one, so the move still runs.
psql_run -d "${DB}" -q <<SQL
insert into public.players (id, club_id, display_name)
  values ('eeeeeeee-0000-4000-8000-000000000014', '${CLUB}', 'Racer Five Synthetic');
insert into public.player_registrations (club_id, player_id, season_id, team_id, status)
  values ('${CLUB}', 'eeeeeeee-0000-4000-8000-000000000014', '${SEASON_NOW}', '${ARGONAUTS}', 'registered');
SQL
SAME_MEMBER=DDDD9999DDDD9999DDDD9999DDDD9999
( direct_insert_holds "${SAME_MEMBER}" 'eeeeeeee-0000-4000-8000-000000000014' "${WORK}/directD.out" ) &
DD=$!
sleep 0.6
RES="$(manager_call "'eeeeeeee-0000-4000-8000-000000000014'::uuid, '${ARGONAUTS}'::uuid, '${GLADIATORS}'::uuid, null, '${SAME_MEMBER}', null" 2>&1 || echo PSQL_FAILED)"
printf '%s\n' "${RES}" > "${WORK}/rpcD.out"
wait "${DD}"
no_raw_violation "same pairing race" "${WORK}/rpcD.out"
same "the same pairing arriving by both routes still moves" "$(outcome "${RES}")" "moved"
same "and this call did not claim to have created the link" "$(field "${RES}" link_created)" "False"
same "exactly one link exists" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where player_id='eeeeeeee-0000-4000-8000-000000000014'")" "1"

psql_run -d "${DB}" -qc "delete from public.player_spond_links where player_id in
    ('eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000011','eeeeeeee-0000-4000-8000-000000000012','eeeeeeee-0000-4000-8000-000000000013','eeeeeeee-0000-4000-8000-000000000014');
  delete from public.player_registrations where player_id in
    ('eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000011','eeeeeeee-0000-4000-8000-000000000012','eeeeeeee-0000-4000-8000-000000000013','eeeeeeee-0000-4000-8000-000000000014');
  delete from public.players where id in
    ('eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000011','eeeeeeee-0000-4000-8000-000000000012','eeeeeeee-0000-4000-8000-000000000013','eeeeeeee-0000-4000-8000-000000000014');" >/dev/null

echo
echo "== L. after everything above: history, the register and the identities are as they were"
same "the archived season registration never moved" "$(scalar "${DB}" "${HISTORIC_SQL}")" "${HISTORIC_BEFORE}"
same "the saved night never moved" "$(scalar "${DB}" "${REGISTER_SQL}")" "${REGISTER_BEFORE}"
same "the stored Spond replies never moved" "$(scalar "${DB}" "${RESPONSES_SQL}")" "${RESPONSES_BEFORE}"
same "no player identity was ever created or removed" "$(scalar "${DB}" "${PLAYERS_SQL}")" "${PLAYERS_BEFORE}"
same "no link was ever deleted" \
  "$(scalar "${DB}" "select count(*) from public.player_spond_links where spond_member_id in ('${M_JOEY}','${M_NOTEAM}','${M_TAKEN}')")" "3"
same "no registration was ever deleted or duplicated" \
  "$(scalar "${DB}" "select count(*) from public.player_registrations")" "6"
same "player_spond_links still grants no UPDATE" \
  "$(scalar "${DB}" "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='player_spond_links' and grantee='authenticated' and privilege_type='UPDATE'")" "0"
same "the audit source vocabulary never gained a value" \
  "$(scalar "${DB}" "select case when pg_get_constraintdef(oid) like '%spond_reconcile%' then 'widened' else 'unchanged' end from pg_constraint where conname='audit_events_source_check'")" "unchanged"

echo
echo "== M. the migration is re-runnable, and a second apply changes nothing"
psql_run -d "${DB}" -q -f "${MIGRATION}"
ok "a second apply succeeds (create or replace, no DDL to collide)"
same "and still no player identity moved" "$(scalar "${DB}" "${PLAYERS_SQL}")" "${PLAYERS_BEFORE}"

# =====================================================================
echo
echo "== N. the stored source self-verification actually BITES"
#
# A review found every one of these checks vacuous. In PostgreSQL's ARE
# syntax \b is the BACKSPACE CHARACTER, not a word boundary assertion, so
# `insert\s+into\s+public\.players\b` read as "followed by the literal byte
# 0x08" and matched nothing at all. The checks passed, and would have passed
# over a function that did the forbidden thing.
#
# So each forbidden thing is INJECTED into the function body as real (never
# executed) SQL and the apply must ABORT. Then the same injections are run
# against a \b version of the same file, which must NOT abort: that is what
# proves these tests fail on the old form and pass on the corrected one,
# rather than passing for a third reason nobody checked.
#
# This section runs last because the \b half deliberately leaves a mutated
# function installed. The final step re-applies the reviewed file, so the
# database ends in a known state.

INJECT_ANCHOR="  if v_actor is null or v_club is null then"

# inject <name> <sql> <outfile>: the reviewed migration with one statement
# added inside the function body.
inject() {
  python3 - "$1" "$2" "${MIGRATION}" <<'PYEOF'
import sys, pathlib
sql, out, migration = sys.argv[1], sys.argv[2], sys.argv[3]
src = pathlib.Path(migration).read_text()
anchor = "  if v_actor is null or v_club is null then"
assert src.count(anchor) == 1, "the injection anchor is not unique"
pathlib.Path(out).write_text(src.replace(anchor, "  " + sql + "\n" + anchor, 1))
PYEOF
}

# The five forbidden things, each with the assertion that must fire.
check_injection() { # check_injection <label> <sql> <expected message> <expect_abort yes|no> <file>
  local label="$1" sql="$2" expect="$3" must_abort="$4" file="$5"
  set +e
  local out; out="$(PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=warning' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "${DB}" -f "${file}" 2>&1)"
  local rc=$?
  set -e
  if [ "${must_abort}" = "yes" ]; then
    [ "${rc}" -ne 0 ] || fail "${label}: the apply did NOT abort, so the check is vacuous"
    echo "${out}" | grep -q "${expect}" || fail "${label}: aborted for the wrong reason: ${out}"
    ok "${label}: detected and the apply aborted"
  else
    [ "${rc}" -eq 0 ] || fail "${label}: the \\b form aborted, so this proves nothing about the fix: ${out}"
    ok "${label}: the \\b form let it through, which is the defect being fixed"
  fi
}

INJECTIONS_SQL=(
  "if false then insert into public.players (id, club_id, display_name) values (p_player_id, v_club, 'x'); end if;"
  "if false then perform 1 from public.register_entries; end if;"
  "if false then perform 1 from public.session_teams; end if;"
  "if false then perform 1 from public.spond_events; end if;"
  "if false then perform 1 from public.spond_event_responses; end if;"
)
INJECTIONS_LABEL=(
  "inserting public.players"
  "referencing register_entries"
  "referencing session_teams"
  "referencing spond_events"
  "referencing spond_event_responses"
)
INJECTIONS_MSG=(
  "must never create a player identity"
  "must not reach the register or the Spond mirror"
  "must not reach the register or the Spond mirror"
  "must not reach the register or the Spond mirror"
  "must not reach the register or the Spond mirror"
)

echo "  -- with the corrected \y and \M assertions, every injection must abort"
for i in "${!INJECTIONS_SQL[@]}"; do
  inject "${INJECTIONS_SQL[$i]}" "${WORK}/inject.sql"
  check_injection "${INJECTIONS_LABEL[$i]}" "${INJECTIONS_SQL[$i]}" "${INJECTIONS_MSG[$i]}" yes "${WORK}/inject.sql"
done

echo "  -- and with the old \b form, not one of them is caught"
for i in "${!INJECTIONS_SQL[@]}"; do
  inject "${INJECTIONS_SQL[$i]}" "${WORK}/inject.sql"
  # Put the C escape back exactly where the review found it.
  python3 - "${WORK}/inject.sql" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
before = s
s = s.replace(r"public\.players\M", r"public\.players")
s = s.replace(r"'\y(register_entries|session_teams|spond_events|spond_event_responses)\y'",
              r"'(register_entries|session_teams|spond_events|spond_event_responses)'")
assert s != before, "the \b downgrade matched nothing, so this run would prove nothing"
p.write_text(s)
PYEOF
  check_injection "${INJECTIONS_LABEL[$i]}" "${INJECTIONS_SQL[$i]}" "" no "${WORK}/inject.sql"
done

echo
echo "== N2. and the LOST RACE checks bite too, on the same terms"
#
# K4 proves the handler works. This proves the self-verification would
# notice if somebody removed it, which is a different claim and the one the
# \b defect taught us to make separately. Both mutations are applied to a
# copy; the reviewed file goes back on below.

# N2a: drop the handler entirely, back to the plain insert #190 shipped.
python3 - "${MIGRATION}" "${WORK}/no_handler.sql" <<'PYEOF'
import re, sys, pathlib

def reconcile_body(text):
    # Only the reconcile function's own body. The header prose above it names
    # the same outcomes, so a mutation assertion read over the whole file
    # would be satisfied by a comment.
    start = text.index("create or replace function public.spond_reconcile_player_team")
    opened = text.index("as $$", start) + len("as $$")
    return text[opened:text.index("$$;", opened)]

src = pathlib.Path(sys.argv[1]).read_text()
# The guarded insert, from its `begin` to the `end;` that closes the handler.
pattern = re.compile(
    r"      begin\n"
    r"        insert into public\.player_spond_links.*?\n"
    r"      end;\n",
    re.S,
)
found = pattern.findall(src)
assert len(found) == 1, f"expected exactly one guarded insert, found {len(found)}"
plain = (
    "      insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)\n"
    "        values (v_club, v_member, p_player_id, 'suggested');\n"
    "      v_link_created := true;\n"
)
out = pattern.sub(lambda _m: plain, src, count=1)
# The handler CLAUSE must be gone. The prose above the insert still discusses
# unique_violation, and that is the point: the check under test reads for the
# clause, so the mutation has to remove the clause and not merely the word.
assert "exception when unique_violation then" not in reconcile_body(out), \
    "the mutation left the handler behind"
pathlib.Path(sys.argv[2]).write_text(out)
PYEOF
check_injection "removing the unique_violation handler" "" \
  "must handle a lost unique race" yes "${WORK}/no_handler.sql"

# N2b: keep the handler, but let it re-raise instead of re-reading. The
# regex check above still passes; only the count notices, which is why the
# count is counted on the RETURNED literal and not on the bare name.
python3 - "${MIGRATION}" "${WORK}/blind_handler.sql" <<'PYEOF'
import re, sys, pathlib

def reconcile_body(text):
    start = text.index("create or replace function public.spond_reconcile_player_team")
    opened = text.index("as $$", start) + len("as $$")
    return text[opened:text.index("$$;", opened)]

src = pathlib.Path(sys.argv[1]).read_text()
pattern = re.compile(
    r"(      exception when unique_violation then\n).*?(?=\n      end;\n)",
    re.S,
)
assert len(pattern.findall(src)) == 1, "expected exactly one handler body"
out = pattern.sub(lambda m: m.group(1) + "        raise;", src, count=1)
body = reconcile_body(out)
assert "unique_violation" in body, "the mutation removed the handler it meant to blind"
assert body.count("'outcome', 'member_linked_elsewhere'") == 1, "the mutation left both returns"
pathlib.Path(sys.argv[2]).write_text(out)
PYEOF
check_injection "a handler that re-raises instead of re-reading" "" \
  "must re-read and name which side lost" yes "${WORK}/blind_handler.sql"

echo "  -- and the reviewed file goes back on, so the database ends clean"
psql_run -d "${DB}" -q -f "${MIGRATION}"
same "the installed function contains no injected statement" \
  "$(scalar "${DB}" "select case when pg_get_functiondef('public.spond_reconcile_player_team(uuid, uuid, uuid, text, text, uuid)'::regprocedure) ~* 'if false then' then 'polluted' else 'clean' end")" \
  "clean"

echo
echo "ALL 0049 ASSERTIONS PASSED"
