#!/usr/bin/env bash
# Run 0048_spond_session_link_unique against a real PostgreSQL, on a faithful
# stand-in of the hosted state it was written for.
#
# WHY THIS EXISTS. The offline Python tests here prove the register, the
# workflow and the gates. They cannot prove what the SQL DOES, and 0048 is a
# migration that WRITES: it clears one production row's Spond link. "It only
# touches the row it names" and "it refuses to run against a database it does
# not recognise" are exactly the claims that must not rest on reading the file
# carefully. So this builds three databases, runs the file against each, and
# asserts the outcome:
#
#   A. the reviewed state          -> applies, repairs one row, nothing else
#                                     moves, and the duplicate becomes
#                                     impossible afterwards, including for two
#                                     connections racing.
#   B. an unexpected third duplicate -> refuses, and leaves the database
#                                     exactly as it found it.
#   C. a database that never held the bad pair (a fresh `supabase db reset`,
#                                     which is what CI and every developer
#                                     machine runs) -> applies, adds the
#                                     guarantee, and changes no row. A file
#                                     that INSISTED on finding production's
#                                     damage would fail there for being
#                                     right, so this is the case that keeps
#                                     the repository's own migrations
#                                     runnable.
#
# WHAT IT IS NOT. The stand-in is a stand-in: the sessions table here carries
# the columns 0048 reads and writes plus enough of the surrounding machinery
# (RLS, the four policies, the audit trigger's own rule about which columns it
# records) for the migration's self-verification to mean something. It is not
# the hosted schema and it cannot prove the hosted schema matches. The pre and
# post apply gates in the workflow are what do that, against the real database,
# at apply time.
#
# It is NOT part of CI: the GitHub runner has no PostgreSQL server, and adding
# one to install a database for one migration would be a standing cost for a
# one-off proof. Run it by hand when reviewing this migration:
#
#   .github/scripts/production-migration/test_0048_spond_link_unique.sh
#
# It exits 0 and prints SKIP when no PostgreSQL server binary is present.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
MIGRATION="${REPO}/supabase/migrations/0048_spond_session_link_unique.sql"

# The two production rows this migration is about, named once.
EVENT=e3065302-c164-4b23-b52a-2ce813271dac
KEEP=243aab0d-02a1-4ebe-887f-d2de588fc29e
CLEAR=13637155-706f-4d8a-9dec-b5da5a15f620

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

# initdb refuses to run as root, which is the common case in a container. Fall
# back to an unprivileged account that can own the cluster.
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  RUN_AS="${PGUSER_ACCOUNT:-postgres}"
  if ! getent passwd "${RUN_AS}" >/dev/null; then
    echo "SKIP: running as root and no ${RUN_AS} account exists to own the cluster"
    exit 0
  fi
fi

WORK="$(mktemp -d)"
if [ -n "${RUN_AS}" ]; then
  # The cluster must live somewhere the unprivileged owner can reach.
  WORK="$(su "${RUN_AS}" -c 'mktemp -d')"
fi
DATA="${WORK}/data"
PORT="${PGPORT_TEST:-5455}"

as_owner() {
  if [ -n "${RUN_AS}" ]; then su "${RUN_AS}" -c "$1"; else bash -c "$1"; fi
}

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

# ---------------------------------------------------------------------
# The stand-in. Every column 0048 reads or writes, the two structures its
# verification asks about (RLS with the four policies, the audit table), and
# the audit trigger's own rule: it records team_id, date, status, programme_id,
# programme_week and venue_id changes and IGNORES everything else, which is why
# 0048 can assert that its repair wrote no audit row.
# ---------------------------------------------------------------------
build_standin() {
  local db="$1"
  psql_run -d postgres -qc "drop database if exists ${db}" >/dev/null
  psql_run -d postgres -qc "create database ${db}" >/dev/null
  psql_run -d "${db}" -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create table public.clubs (id uuid primary key);
create table public.spond_events (
  id uuid primary key,
  club_id uuid not null,
  title text,
  starts_at timestamptz,
  spond_type text
);
create table public.audit_events (
  id bigserial primary key,
  club_id uuid,
  action text,
  occurred_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  coach_id uuid,
  team_id uuid,
  name text not null,
  focus text,
  date date,
  start_time text,
  venue text,
  age_group text,
  status text not null default 'upcoming',
  activities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  intentions text,
  space text,
  source_url text,
  source_label text,
  programme_id uuid,
  programme_week integer,
  live_activity_index integer,
  live_activity_started_at timestamptz,
  spond_event_id uuid references public.spond_events(id) on delete set null,
  board_id uuid,
  rights text not null default 'internal_only',
  venue_id uuid
);
create index sessions_spond_event_id_idx on public.sessions (spond_event_id);

alter table public.sessions enable row level security;
create policy sessions_select on public.sessions for select to authenticated using (true);
create policy sessions_insert on public.sessions for insert to authenticated with check (true);
create policy sessions_update on public.sessions for update to authenticated using (true);
create policy sessions_delete on public.sessions for delete to authenticated using (true);
grant select, insert, update, delete on public.sessions to authenticated;

-- The audit trigger's rule, copied from the hosted audit_sessions(): a
-- session update is recorded ONLY when one of six columns moved, and
-- spond_event_id is not one of them.
create function public.audit_sessions() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.team_id is not distinct from old.team_id
       and new.date is not distinct from old.date
       and new.status is not distinct from old.status
       and new.programme_id is not distinct from old.programme_id
       and new.programme_week is not distinct from old.programme_week
       and new.venue_id is not distinct from old.venue_id then
      return new;
    end if;
  end if;
  insert into public.audit_events (club_id, action) values (coalesce(new.club_id, old.club_id), tg_op);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;
create trigger audit_sessions after insert or delete or update on public.sessions
  for each row execute function public.audit_sessions();
SQL
}

# The rows: the two that matter, four historic rows carrying a live marker
# nobody cleared, one unlinked session and two future linked sessions. Close
# enough to the hosted shape that "nothing else moved" is a real claim.
seed_reviewed_state() {
  local db="$1"
  psql_run -d "${db}" -q <<SQL
insert into public.clubs values ('11111111-1111-1111-1111-111111111111');
insert into public.spond_events (id, club_id, title, starts_at, spond_type) values
  ('${EVENT}', '11111111-1111-1111-1111-111111111111', 'Training', '2026-08-11T17:00:00Z', 'EVENT'),
  ('b9b8b964-8308-481a-b788-42b1499bb523', '11111111-1111-1111-1111-111111111111', 'Training', '2026-08-04T17:00:00Z', 'EVENT'),
  ('6f7b5dc5-4eda-4de3-94d9-8facc16fee2b', '11111111-1111-1111-1111-111111111111', 'Lindley Moor', '2026-08-22T09:00:00Z', 'MATCH');

insert into public.sessions (id, club_id, coach_id, name, date, start_time, status, spond_event_id, live_activity_index, live_activity_started_at) values
  -- The pair this migration is about.
  ('${KEEP}',  '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Training', '2026-08-11', '18:00', 'upcoming', '${EVENT}', null, null),
  ('${CLEAR}', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Attacking session: 2v2 to score', '2026-06-16', '17:30', 'upcoming', '${EVENT}', 0, '2026-06-16T16:55:16Z'),
  -- Historic rows carrying a live marker nobody cleared. 0048 must leave
  -- every one of them exactly as it is.
  ('a1e1855d-ab71-46d7-8404-519612343e0a', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Marking session: marking rivals', '2026-06-16', '17:30', 'upcoming', null, 0, '2026-06-11T16:43:03Z'),
  ('f0307cef-cf20-4591-99f6-92a514aabc9a', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Marking and intercepting to defend', '2026-06-23', '17:30', 'upcoming', null, 0, '2026-06-16T16:52:28Z'),
  ('70b2415f-712b-418d-ae8b-3a45d1818771', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Marking and intercepting to defend week 6', '2026-07-28', '17:30', 'upcoming', null, 0, '2026-06-16T16:56:03Z'),
  ('66cfe51b-d53b-4380-a6d3-90dc8140b2f5', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Attacking Week 1', '2026-08-01', '09:00', 'upcoming', null, 0, '2026-07-16T11:47:44Z'),
  -- An ordinary unlinked session, and two linked ones that are not duplicated.
  ('9f7d0f1a-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Club night', '2026-05-05', '18:00', 'completed', null, null, null),
  ('83f65322-b7b4-4eba-ba41-1d9e1318b71a', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Training', '2026-08-04', '18:00', 'upcoming', 'b9b8b964-8308-481a-b788-42b1499bb523', null, null),
  ('46af1cdf-fa0a-4e7a-b4fb-f8e56030f4a6', '11111111-1111-1111-1111-111111111111', '523cec32-d847-4a5b-a843-e3aa8ae20572', 'Lindley Moor', '2026-08-22', '10:00', 'upcoming', '6f7b5dc5-4eda-4de3-94d9-8facc16fee2b', null, null);
SQL
}

# The migration itself runs with NOTICE visible, because which branch it took
# (repair, or guarantee only) is something it says out loud and something a
# real apply shows in the workflow log. The stand-in setup above stays quiet.
apply_migration() {
  PGHOST="${WORK}" PGPORT="${PORT}" PGUSER=postgres PGOPTIONS='-c client_min_messages=notice' \
    psql --no-psqlrc --set ON_ERROR_STOP=1 -q -d "$1" -f "${MIGRATION}"
}

# =====================================================================
echo
echo "== A. the reviewed state: the migration applies and repairs exactly one row"
build_standin otj_a
seed_reviewed_state otj_a

before_all="$(scalar otj_a "select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') from public.sessions s where s.id <> '${CLEAR}'::uuid")"
before_clear="$(scalar otj_a "select md5((to_jsonb(s) - 'spond_event_id')::text) from public.sessions s where s.id = '${CLEAR}'::uuid")"
before_audit="$(scalar otj_a "select count(*) from public.audit_events")"
before_live="$(scalar otj_a "select count(*) from public.sessions where live_activity_index is not null")"
before_rows="$(scalar otj_a "select count(*) from public.sessions")"
before_linked="$(scalar otj_a "select count(*) from public.sessions where spond_event_id is not null")"

apply_migration otj_a >/dev/null
ok "the migration committed"

[ "$(scalar otj_a "select count(*) from public.sessions")" = "${before_rows}" ] || fail "a session was deleted"
ok "no session was deleted (${before_rows} rows before and after)"

[ "$(scalar otj_a "select count(*) from public.sessions where spond_event_id is not null")" = "$((before_linked - 1))" ] \
  || fail "more or fewer than one link was cleared"
ok "exactly one link was cleared (${before_linked} linked rows before)"

[ "$(scalar otj_a "select spond_event_id from public.sessions where id = '${KEEP}'::uuid")" = "${EVENT}" ] \
  || fail "the 11 August session lost its Spond link"
ok "the 11 August session keeps the 11 August event"

[ "$(scalar otj_a "select spond_event_id is null from public.sessions where id = '${CLEAR}'::uuid")" = "t" ] \
  || fail "the June session still holds the link"
ok "the June session no longer holds it, and still exists"

after_clear="$(scalar otj_a "select md5((to_jsonb(s) - 'spond_event_id')::text) from public.sessions s where s.id = '${CLEAR}'::uuid")"
[ "${after_clear}" = "${before_clear}" ] || fail "the June session changed in a column other than spond_event_id"
ok "the June session is otherwise byte for byte what it was"

after_all="$(scalar otj_a "select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') from public.sessions s where s.id <> '${CLEAR}'::uuid")"
[ "${after_all}" = "${before_all}" ] || fail "a session other than the repaired one changed"
ok "every other session, including the unlinked ones, is untouched"

[ "$(scalar otj_a "select count(*) from public.audit_events")" = "${before_audit}" ] || fail "the repair wrote an audit row"
ok "no audit row was written (audit_sessions ignores a spond_event_id only change)"

[ "$(scalar otj_a "select count(*) from public.sessions where live_activity_index is not null")" = "${before_live}" ] \
  || fail "a historic live marker was cleared"
[ "$(scalar otj_a "select live_activity_index from public.sessions where id = '${CLEAR}'::uuid")" = "0" ] \
  || fail "the repaired row's live marker moved"
ok "every historic live marker is still stored exactly as it was (${before_live} rows)"

[ "$(scalar otj_a "select count(*) from pg_index x join pg_class c on c.oid = x.indexrelid where x.indrelid = 'public.sessions'::regclass and c.relname = 'sessions_spond_event_id_unique' and x.indisunique and x.indpred is not null")" = "1" ] \
  || fail "the partial unique index is missing"
ok "sessions_spond_event_id_unique exists, unique and partial"

[ "$(scalar otj_a "select count(*) from pg_policies where schemaname='public' and tablename='sessions'")" = "4" ] \
  || fail "the sessions policy set moved"
ok "the four sessions policies are untouched"

# The invariant, from the outside: a second session cannot claim the event.
if psql_run -d otj_a -qc "insert into public.sessions (id, club_id, name, spond_event_id) values ('9f7d0f1a-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sneaky', '${EVENT}')" >/dev/null 2>"${WORK}/dup.err"; then
  fail "a second session was allowed to claim the same Spond event"
fi
grep -q "sessions_spond_event_id_unique" "${WORK}/dup.err" || fail "the refusal did not name the index the client matches on"
ok "a second session on the same event is refused, and the error names the index"

# Many rows may still hold NO link, which is the point of the partial index.
psql_run -d otj_a -qc "insert into public.sessions (id, club_id, name) values ('9f7d0f1a-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'Unlinked one'), ('9f7d0f1a-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'Unlinked two')" >/dev/null
ok "sessions with no Spond link are unaffected by the index"

# =====================================================================
echo
echo "== A2. two connections racing for the same event: one wins, one is refused"
# Connection 1 holds an uncommitted insert; connection 2 attempts the same
# event and BLOCKS on the index until connection 1 commits, then fails. This
# is the case a read-then-write check in the client could never close.
RACE_EVENT=6f7b5dc5-4eda-4de3-94d9-8facc16fee2b
psql_run -d otj_a -qc "update public.sessions set spond_event_id = null where spond_event_id = '${RACE_EVENT}'::uuid" >/dev/null
(
  psql_run -d otj_a -q <<SQL
begin;
insert into public.sessions (id, club_id, name, spond_event_id)
values ('9f7d0f1a-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Coach A plans it', '${RACE_EVENT}');
select pg_sleep(2);
commit;
SQL
) >"${WORK}/race-a.log" 2>&1 &
race_a=$!
sleep 0.7
set +e
psql_run -d otj_a -qc "insert into public.sessions (id, club_id, name, spond_event_id) values ('9f7d0f1a-0000-4000-8000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Coach B plans it', '${RACE_EVENT}')" >/dev/null 2>"${WORK}/race-b.err"
race_b_rc=$?
set -e
wait "${race_a}"
[ "${race_b_rc}" -ne 0 ] || fail "both racing inserts succeeded"
grep -q "sessions_spond_event_id_unique" "${WORK}/race-b.err" || fail "the losing insert did not name the index"
[ "$(scalar otj_a "select count(*) from public.sessions where spond_event_id = '${RACE_EVENT}'::uuid")" = "1" ] \
  || fail "the race left more or fewer than one session on the event"
ok "the second connection blocked, then was refused; exactly one session holds the event"

# =====================================================================
echo
echo "== B. an unexpected third duplicate: the migration refuses and changes nothing"
build_standin otj_b
seed_reviewed_state otj_b
# A second, unreviewed duplicate: two sessions on the 4 August event.
psql_run -d otj_b -qc "insert into public.sessions (id, club_id, name, date, start_time, spond_event_id) values ('9f7d0f1a-0000-4000-8000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Another claim', '2026-08-04', '18:00', 'b9b8b964-8308-481a-b788-42b1499bb523')" >/dev/null

before_b="$(scalar otj_b "select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.sessions s")"
set +e
apply_migration otj_b >"${WORK}/b.log" 2>&1
b_rc=$?
set -e
[ "${b_rc}" -ne 0 ] || fail "the migration applied against an unexpected duplicate"
grep -q "are held by more than one session and are not the reviewed pair" "${WORK}/b.log" \
  || fail "the refusal did not say what it found: $(tail -3 "${WORK}/b.log")"
grep -q "b9b8b964-8308-481a-b788-42b1499bb523" "${WORK}/b.log" \
  || fail "the refusal did not name the offending event"
grep -q "refuses to guess" "${WORK}/b.log" || fail "the refusal did not say why"
ok "it refused, naming the offending event"
[ "$(scalar otj_b "select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.sessions s")" = "${before_b}" ] \
  || fail "the failed run changed a session row"
ok "every session row is exactly as it was"
[ "$(scalar otj_b "select count(*) from pg_class where relname = 'sessions_spond_event_id_unique'")" = "0" ] \
  || fail "the index survived a failed run"
ok "the index was not created"
[ "$(scalar otj_b "select spond_event_id from public.sessions where id = '${CLEAR}'::uuid")" = "${EVENT}" ] \
  || fail "the June link was cleared by a run that aborted"
ok "the June link is still there, because the transaction rolled back"

# =====================================================================
echo
echo "== C. a database that never held the bad pair: the migration applies and changes nothing"
build_standin otj_c
seed_reviewed_state otj_c
# Exactly the shape `supabase db reset` produces: no duplicated link anywhere.
psql_run -d otj_c -qc "update public.sessions set spond_event_id = null where id = '${CLEAR}'::uuid" >/dev/null
before_c="$(scalar otj_c "select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.sessions s")"
before_c_audit="$(scalar otj_c "select count(*) from public.audit_events")"
# NOTICE goes to stderr, and which branch it took is the point of this case.
apply_migration otj_c >"${WORK}/c.log" 2>&1
ok "the migration committed"
[ "$(scalar otj_c "select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.sessions s")" = "${before_c}" ] \
  || fail "the migration changed a row on a database with nothing to repair"
ok "not one session row changed"
[ "$(scalar otj_c "select count(*) from public.audit_events")" = "${before_c_audit}" ] || fail "an audit row was written"
ok "no audit row was written"
[ "$(scalar otj_c "select count(*) from pg_class where relname = 'sessions_spond_event_id_unique'")" = "1" ] \
  || fail "the guarantee was not added"
ok "the guarantee was still added"
grep -q "no erroneous Spond link present" "${WORK}/c.log" || fail "it did not say which branch it took"
ok "and it said so, rather than repairing silently"

# =====================================================================
echo
echo "== D. an empty database, which is what a fresh reset actually looks like"
build_standin otj_d
apply_migration otj_d >/dev/null 2>&1
[ "$(scalar otj_d "select count(*) from pg_class where relname = 'sessions_spond_event_id_unique'")" = "1" ] \
  || fail "the migration did not apply to an empty sessions table"
ok "it applies to an empty sessions table and adds the guarantee"

echo
echo "PASS: 0048 repairs exactly one row where there is one to repair, refuses every"
echo "      duplicate it was not shown, applies cleanly where there is nothing to repair,"
echo "      and the index it adds makes a duplicate Spond link impossible, race included."
