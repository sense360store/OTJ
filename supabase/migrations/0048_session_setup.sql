-- =====================================================================
-- OTJ Training Hub, migration 0048_session_setup: where a session's
-- stations stand on a venue area (training day logistics, PR 11)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free (apply order within the queue: 0043 to 0047,
-- then this file). Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: provisional 0048. The files on disk end at
-- 0047_drill_layout.sql (also unapplied, gated); the live ledger is the
-- authority.
--
-- WHAT THIS IS. ADR-0008's setup composer, stored in two parts:
--
--   sessions.setup_area_id  the venue area the session is laid out on, a
--                           real reference with a real foreign key, so a
--                           deleted area cannot leave a dangling id.
--   sessions.setup          the stations themselves as jsonb: axis
--                           aligned rectangles in metres, in the area's
--                           own local frame (the boundary polygon
--                           projected to metres and translated so its
--                           bounding box corner is the origin), each
--                           optionally bound to a drill.
--
-- The frame is derived from the boundary in the browser every time it is
-- needed and never stored, so this column carries no projection the
-- database would have to agree with. A station crossing the drawn
-- boundary is a warning the composer shows and never a refusal: the
-- boundary is the owner's visual approximation of the usable green, and
-- the coach standing on the grass is the authority. Nothing here is
-- enforceable geometry and none of it is attempted.
--
-- session_setup_ok is the bounded outer guard in the drill_layout_ok
-- style: shape, version, closed field lists, string caps, array cap and
-- a size cap, so no free text channel survives a direct write. The
-- arithmetic (station sizes against the area, boundary crossing, drill
-- fit) lives in src/lib/sessionSetup.ts, the client twin, which is
-- strictly stricter.
--
-- CARRIES NO PERSON DATA. A station holds a size, a position, an
-- optional 20 character label and an optional drill id. No names, no
-- children, no attendance: the Register (0046) is where people are. The
-- label names a place, not a person ("Rondo grid", "Far corner"), and is
-- capped at the same 20 characters as a drill diagram's zone label so it
-- cannot become a roster in disguise; the 0028 board token precedent is
-- why the cap is schema and not a UI convention.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enabling constraint. The club scoped composite foreign key pattern
-- (0032, 0044, 0045) needs the parent's (id, club_id) to be unique;
-- venue_areas was created in 0043 with only its primary key. This adds
-- nothing to the data, it only makes the reference below expressible.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venue_areas_id_club_unique' and conrelid = 'public.venue_areas'::regclass
  ) then
    alter table public.venue_areas add constraint venue_areas_id_club_unique unique (id, club_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- The setup shape guard.
-- ---------------------------------------------------------------------
create or replace function public.session_setup_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) is distinct from 'object' then false
    when octet_length(p::text) > 32768 then false
    when exists (
      select 1 from jsonb_object_keys(p) as t(key)
      where t.key not in ('version', 'stations')
    ) then false
    -- is distinct from, not <>: a missing key yields SQL null, and a null
    -- case condition would fall through as if the check had passed.
    when p -> 'version' is distinct from '1'::jsonb then false
    when jsonb_typeof(p -> 'stations') is distinct from 'array' then false
    when jsonb_array_length(p -> 'stations') > 12 then false
    else not exists (
      select 1
      from jsonb_array_elements(p -> 'stations') as s(station)
      where case
        when jsonb_typeof(s.station) is distinct from 'object' then true
        when exists (
          select 1 from jsonb_object_keys(s.station) as t(key)
          where t.key not in ('id', 'x', 'y', 'width', 'length', 'label', 'drillId')
        ) then true
        when jsonb_typeof(s.station -> 'id') is distinct from 'string' then true
        when char_length(s.station ->> 'id') not between 1 and 40 then true
        when jsonb_typeof(s.station -> 'x') is distinct from 'number' then true
        when jsonb_typeof(s.station -> 'y') is distinct from 'number' then true
        when jsonb_typeof(s.station -> 'width') is distinct from 'number' then true
        when jsonb_typeof(s.station -> 'length') is distinct from 'number' then true
        when (s.station ->> 'width')::numeric not between 1 and 150 then true
        when (s.station ->> 'length')::numeric not between 1 and 150 then true
        when s.station -> 'label' is not null and (
          jsonb_typeof(s.station -> 'label') is distinct from 'string'
          or char_length(s.station ->> 'label') > 20
        ) then true
        when s.station -> 'drillId' is not null and (
          jsonb_typeof(s.station -> 'drillId') is distinct from 'string'
          or char_length(s.station ->> 'drillId') not between 1 and 40
        ) then true
        else false
      end
    )
  end
$$;

-- ---------------------------------------------------------------------
-- The columns. Both nullable: a session with no composed setup is the
-- normal case and stays exactly as it is today.
-- ---------------------------------------------------------------------
alter table public.sessions
  add column setup_area_id uuid,
  add column setup jsonb check (public.session_setup_ok(setup));

-- The column list on set null is load bearing, not decoration: a bare
-- "on delete set null" on a composite foreign key nulls every referencing
-- column, club_id included, and the delete then fails on club_id's not
-- null constraint, making the area undeletable. Same form as 0032.
alter table public.sessions
  add constraint sessions_setup_area_fk
  foreign key (setup_area_id, club_id) references public.venue_areas (id, club_id)
  on delete set null (setup_area_id);

create index on public.sessions (setup_area_id);

comment on column public.sessions.setup_area_id is
  $$The venue area this session is laid out on (ADR-0008). Null until a coach composes a setup. On delete set null: removing an area leaves the stations in place but unanchored, and the composer asks for an area again rather than silently drawing on the wrong grass.$$;

comment on column public.sessions.setup is
  $$The session's stations: axis aligned rectangles in metres in the area's own local frame (its boundary projected to metres, origin at the bounding box corner), each optionally bound to a drill. The frame is derived in the browser and never stored. A station crossing the drawn boundary is a warning, never a refusal. session_setup_ok bounds the outer shape here; the arithmetic lives in src/lib/sessionSetup.ts. Carries no person data.$$;

-- No policy change: setup rides the sessions row under the existing
-- sessions policies (club wide read; create and owner edit under
-- sessions.create, any under sessions.manage).

-- ---------------------------------------------------------------------
-- audit_sessions gains setup_area_id on its update allow list. 0037's
-- rule keeps an id whose parent is itself audited: venue_areas carries
-- audit triggers from 0043, so the area qualifies exactly as venue_id
-- did. The stations jsonb is session content, like activities, and
-- stays off the list. The function body is otherwise 0043's verbatim;
-- the existing trigger picks up the replacement.
-- ---------------------------------------------------------------------
create or replace function public.audit_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_team uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_team := new.team_id; v_action := 'session.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_team := old.team_id; v_action := 'session.deleted';
  else
    v_club := new.club_id; v_id := new.id; v_team := new.team_id;
    if new.team_id is distinct from old.team_id then v_changed := array_append(v_changed, 'team_id'); end if;
    if new.date is distinct from old.date then v_changed := array_append(v_changed, 'date'); end if;
    if new.status is distinct from old.status then v_changed := array_append(v_changed, 'status'); end if;
    if new.programme_id is distinct from old.programme_id then v_changed := array_append(v_changed, 'programme_id'); end if;
    if new.programme_week is distinct from old.programme_week then v_changed := array_append(v_changed, 'programme_week'); end if;
    if new.venue_id is distinct from old.venue_id then v_changed := array_append(v_changed, 'venue_id'); end if;
    if new.setup_area_id is distinct from old.setup_area_id then v_changed := array_append(v_changed, 'setup_area_id'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'session.updated';
  end if;
  -- team_id is a safe first class id already used across the audit trail, so
  -- the session's team rides the event; the live pointer, notes and content
  -- never do.
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'session', v_id, v_team, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Self verification.
-- ---------------------------------------------------------------------
do $$
declare
  v_big text := repeat('9', 20000);
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name in ('setup', 'setup_area_id')
    group by table_name having count(*) = 2
  ) then
    raise exception 'session_setup: the columns were not added';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_setup_area_fk' and conrelid = 'public.sessions'::regclass
  ) then
    raise exception 'session_setup: the area foreign key is missing';
  end if;

  -- The outer guard bites.
  if public.session_setup_ok('{"version":2,"stations":[]}'::jsonb) then
    raise exception 'session_setup: the check accepted a wrong version';
  end if;
  if public.session_setup_ok('{"stations":[]}'::jsonb) then
    raise exception 'session_setup: the check accepted a missing version';
  end if;
  if public.session_setup_ok('{"version":1}'::jsonb) then
    raise exception 'session_setup: the check accepted missing stations';
  end if;
  if public.session_setup_ok('{"version":1,"stations":[],"areaId":"x"}'::jsonb) then
    raise exception 'session_setup: the check accepted an unknown top level field';
  end if;
  if public.session_setup_ok('{"version":1,"stations":[{"id":"s1","x":0,"y":0,"width":10,"length":10,"coach":"x"}]}'::jsonb) then
    raise exception 'session_setup: the check accepted an unknown station field';
  end if;
  if public.session_setup_ok('{"version":1,"stations":[{"id":"s1","x":0,"y":0,"width":0.5,"length":10}]}'::jsonb) then
    raise exception 'session_setup: the check accepted a station below the size bound';
  end if;
  if public.session_setup_ok('{"version":1,"stations":[{"id":"s1","x":0,"y":0,"width":10,"length":151}]}'::jsonb) then
    raise exception 'session_setup: the check accepted a station above the size bound';
  end if;
  if public.session_setup_ok(('{"version":1,"stations":[{"id":"s1","x":0,"y":0,"width":10,"length":10,"label":"' || repeat('x', 21) || '"}]}')::jsonb) then
    raise exception 'session_setup: the check accepted an over long label';
  end if;
  if public.session_setup_ok('{"version":1,"stations":[{"id":"s1","x":0,"y":0,"width":10,"length":10,"drillId":""}]}'::jsonb) then
    raise exception 'session_setup: the check accepted an empty drill reference';
  end if;
  if public.session_setup_ok((
    '{"version":1,"stations":[{"id":"s1","x":' || v_big || ',"y":' || v_big || ',"width":10,"length":10}]}')::jsonb) then
    raise exception 'session_setup: the check accepted an oversized payload';
  end if;

  -- The area reference nulls only itself on delete. Confirmed here
  -- because the failure mode (nulling club_id and refusing the delete)
  -- is invisible until an admin tries to remove a venue.
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_setup_area_fk'
      and conrelid = 'public.sessions'::regclass
      and confdeltype = 'n'
      and confdelsetcols = array[
        (select attnum from pg_attribute
         where attrelid = 'public.sessions'::regclass and attname = 'setup_area_id')
      ]
  ) then
    raise exception 'session_setup: the area reference must set null on setup_area_id alone';
  end if;

  -- And accepts what the client validates clean.
  if not public.session_setup_ok('{"version":1,"stations":[]}'::jsonb) then
    raise exception 'session_setup: the check refused an empty setup';
  end if;
  if not public.session_setup_ok('{"version":1,"stations":[{"id":"s1","x":12.3,"y":4,"width":12,"length":12,"label":"Rondo grid","drillId":"11111111-1111-1111-1111-111111111111"}]}'::jsonb) then
    raise exception 'session_setup: the check refused a fully featured setup';
  end if;
  if not public.session_setup_ok(null) then
    raise exception 'session_setup: null must remain valid, it is the unset state';
  end if;
end
$$;
