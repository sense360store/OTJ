-- =====================================================================
-- OTJ Training Hub, migration 0047_drill_layout: the layout column for
-- authored drills (training day logistics, PR 8)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free (apply order within the queue: 0043 to 0046,
-- then this file). Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: provisional 0047. The files on disk end at
-- 0046_register_entries.sql (also unapplied, gated); the live ledger is
-- the authority.
--
-- WHAT THIS IS. ADR-0008's drill layout foundation: a nullable jsonb
-- column on drills carrying the structured layout model (metres relative
-- to the drill's own declared area; entities, zones and typed arrows; one
-- to four static phases sharing entity identity). drill_layout_ok is the
-- database's guard on the storable envelope, in the venue_boundary_ok
-- style: shape, value types, closed field lists, string caps, array caps
-- and a total size cap. The rules that need arithmetic (coordinate
-- ranges, zone fit, rotation bounds, id uniqueness, shared identity
-- across phases) live in src/lib/drillLayout.ts, the client twin, which
-- is strictly stricter: every value the client validates clean is
-- storable here.
--
-- NO PERSON DATA, ENFORCED HERE. A layout's only free text is the capped
-- labels and notes: ids at most 40 characters, entity labels 3, zone
-- labels 20, phase notes 200, kinds and teams drawn from closed lists,
-- every field list closed against unknown keys, and the whole payload
-- capped at 256 KiB (unreachable by honest content, a backstop against
-- absurd numeric precision). The 0028 board token precedent: the
-- children's data boundary binds at the schema, not in the client,
-- whoever writes the row.
--
-- NEVER RETROFITTED. Existing FA imported drills keep their image and
-- video media unchanged forever; their layout stays null and no backfill
-- exists or ever will. A null layout is the discriminator the drill
-- detail renders by.
-- =====================================================================

create or replace function public.drill_layout_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) is distinct from 'object' then false
    when octet_length(p::text) > 262144 then false
    when exists (
      select 1 from jsonb_object_keys(p) as t(key)
      where t.key not in ('version', 'area', 'frames')
    ) then false
    -- is distinct from, not <>: a missing key yields SQL null, and a null
    -- case condition would fall through as if the check had passed.
    when p -> 'version' is distinct from '1'::jsonb then false
    when jsonb_typeof(p -> 'area') is distinct from 'object' then false
    when exists (
      select 1 from jsonb_object_keys(p -> 'area') as t(key)
      where t.key not in ('width', 'length')
    ) then false
    when jsonb_typeof(p -> 'area' -> 'width') is distinct from 'number' then false
    when jsonb_typeof(p -> 'area' -> 'length') is distinct from 'number' then false
    when (p -> 'area' ->> 'width')::numeric not between 2 and 150 then false
    when (p -> 'area' ->> 'length')::numeric not between 2 and 150 then false
    when jsonb_typeof(p -> 'frames') is distinct from 'array' then false
    when jsonb_array_length(p -> 'frames') not between 1 and 4 then false
    else not exists (
      select 1
      from jsonb_array_elements(p -> 'frames') as f(frame)
      where case
        when jsonb_typeof(f.frame) is distinct from 'object' then true
        when exists (
          select 1 from jsonb_object_keys(f.frame) as t(key)
          where t.key not in ('entities', 'zones', 'arrows', 'note')
        ) then true
        when jsonb_typeof(f.frame -> 'entities') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'entities') > 80 then true
        when jsonb_typeof(f.frame -> 'zones') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'zones') > 10 then true
        when jsonb_typeof(f.frame -> 'arrows') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'arrows') > 40 then true
        when f.frame -> 'note' is not null and (
          jsonb_typeof(f.frame -> 'note') is distinct from 'string'
          or char_length(f.frame ->> 'note') > 200
        ) then true
        when exists (
          select 1 from jsonb_array_elements(f.frame -> 'entities') as e(ent)
          where case
            when jsonb_typeof(e.ent) is distinct from 'object' then true
            when exists (
              select 1 from jsonb_object_keys(e.ent) as t(key)
              where t.key not in ('id', 'kind', 'x', 'y', 'rotation', 'team', 'label')
            ) then true
            when jsonb_typeof(e.ent -> 'id') is distinct from 'string' then true
            when char_length(e.ent ->> 'id') not between 1 and 40 then true
            when coalesce(e.ent ->> 'kind', '')
              not in ('cone', 'marker', 'goal', 'mini_goal', 'mannequin', 'player', 'ball') then true
            when jsonb_typeof(e.ent -> 'x') is distinct from 'number' then true
            when jsonb_typeof(e.ent -> 'y') is distinct from 'number' then true
            when e.ent -> 'rotation' is not null
              and jsonb_typeof(e.ent -> 'rotation') is distinct from 'number' then true
            when e.ent -> 'team' is not null
              and coalesce(e.ent ->> 'team', '') not in ('attack', 'defence', 'neutral') then true
            when e.ent -> 'label' is not null and (
              jsonb_typeof(e.ent -> 'label') is distinct from 'string'
              or char_length(e.ent ->> 'label') > 3
            ) then true
            else false
          end
        ) then true
        when exists (
          select 1 from jsonb_array_elements(f.frame -> 'zones') as z(zone)
          where case
            when jsonb_typeof(z.zone) is distinct from 'object' then true
            when exists (
              select 1 from jsonb_object_keys(z.zone) as t(key)
              where t.key not in ('id', 'x', 'y', 'width', 'height', 'label')
            ) then true
            when jsonb_typeof(z.zone -> 'id') is distinct from 'string' then true
            when char_length(z.zone ->> 'id') not between 1 and 40 then true
            when jsonb_typeof(z.zone -> 'x') is distinct from 'number' then true
            when jsonb_typeof(z.zone -> 'y') is distinct from 'number' then true
            when jsonb_typeof(z.zone -> 'width') is distinct from 'number' then true
            when jsonb_typeof(z.zone -> 'height') is distinct from 'number' then true
            when z.zone -> 'label' is not null and (
              jsonb_typeof(z.zone -> 'label') is distinct from 'string'
              or char_length(z.zone ->> 'label') > 20
            ) then true
            else false
          end
        ) then true
        when exists (
          select 1 from jsonb_array_elements(f.frame -> 'arrows') as a(arrow)
          where case
            when jsonb_typeof(a.arrow) is distinct from 'object' then true
            when exists (
              select 1 from jsonb_object_keys(a.arrow) as t(key)
              where t.key not in ('id', 'kind', 'from', 'to')
            ) then true
            when jsonb_typeof(a.arrow -> 'id') is distinct from 'string' then true
            when char_length(a.arrow ->> 'id') not between 1 and 40 then true
            when coalesce(a.arrow ->> 'kind', '') not in ('pass', 'run', 'dribble', 'shot') then true
            when jsonb_typeof(a.arrow -> 'from') is distinct from 'object' then true
            when jsonb_typeof(a.arrow -> 'to') is distinct from 'object' then true
            when exists (
              select 1 from jsonb_object_keys(a.arrow -> 'from') as t(key)
              where t.key not in ('x', 'y')
            ) then true
            when exists (
              select 1 from jsonb_object_keys(a.arrow -> 'to') as t(key)
              where t.key not in ('x', 'y')
            ) then true
            when jsonb_typeof(a.arrow -> 'from' -> 'x') is distinct from 'number' then true
            when jsonb_typeof(a.arrow -> 'from' -> 'y') is distinct from 'number' then true
            when jsonb_typeof(a.arrow -> 'to' -> 'x') is distinct from 'number' then true
            when jsonb_typeof(a.arrow -> 'to' -> 'y') is distinct from 'number' then true
            else false
          end
        ) then true
        else false
      end
    )
  end
$$;

alter table public.drills
  add column layout jsonb check (public.drill_layout_ok(layout));

-- Never retrofitted, enforced cross field: an imported drill carries a
-- source URL and never a layout, whoever writes the row. Every existing
-- row satisfies this (imports have source_url and null layout; authored
-- drills have no layout yet).
alter table public.drills
  add constraint drills_layout_never_imported
  check (source_url is null or layout is null);

comment on column public.drills.layout is
  $$The structured layout of an authored drill (ADR-0008): metres relative to the drill's declared area, entities, zones and typed arrows across one to four static phases. Null for every FA imported drill, forever; they keep their image and video media and are never retrofitted. drill_layout_ok enforces the storable envelope here (shape, types, closed field lists, string caps, size cap); the arithmetic rules live in src/lib/drillLayout.ts.$$;

-- No policy change: the layout rides the drills row under the existing
-- drills policies (club wide read; create and owner edit under
-- drills.create, any under drills.manage).

-- ---------------------------------------------------------------------
-- Self verification.
-- ---------------------------------------------------------------------
do $$
declare
  v_big text := repeat('9', 100000);
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'drills' and column_name = 'layout'
  ) then
    raise exception 'drill_layout: the column was not added';
  end if;

  -- The outer guard bites and accepts.
  if public.drill_layout_ok('{"version":2,"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted a wrong version';
  end if;
  if public.drill_layout_ok('{"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted a missing version';
  end if;
  if public.drill_layout_ok('{"version":1,"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted a missing area';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10}}'::jsonb) then
    raise exception 'drill_layout: the check accepted missing frames';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted a frame with no entities array';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":1,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted an area below bounds';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[]}'::jsonb) then
    raise exception 'drill_layout: the check accepted zero frames';
  end if;

  -- The person data envelope bites: caps, closed field lists, closed
  -- kind lists.
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[{"id":"p1","kind":"player","x":1,"y":1,"label":"Jack"}],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted a four character label';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[{"id":"p1","kind":"player","x":1,"y":1,"name":"x"}],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted an unknown entity field';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[]}],"author":"x"}'::jsonb) then
    raise exception 'drill_layout: the check accepted an unknown top level field';
  end if;
  if public.drill_layout_ok(('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[{"id":"' || repeat('x', 41) || '","kind":"cone","x":1,"y":1}],"zones":[],"arrows":[]}]}')::jsonb) then
    raise exception 'drill_layout: the check accepted a forty one character id';
  end if;
  if public.drill_layout_ok(('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[{"id":"z1","x":0,"y":0,"width":2,"height":2,"label":"' || repeat('x', 21) || '"}],"arrows":[]}]}')::jsonb) then
    raise exception 'drill_layout: the check accepted an over long zone label';
  end if;
  if public.drill_layout_ok(('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[],"note":"' || repeat('x', 201) || '"}]}')::jsonb) then
    raise exception 'drill_layout: the check accepted an over long note';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[],"zones":[],"arrows":[{"id":"a1","kind":"pass","from":{"x":1,"y":1,"z":1},"to":{"x":2,"y":2}}]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted an unknown arrow point field';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[{"id":"p1","kind":"flag","x":1,"y":1}],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted an unknown entity kind';
  end if;
  if public.drill_layout_ok('{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":[{"id":"p1","kind":"player","x":1,"y":1,"team":"reds"}],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check accepted an unknown team';
  end if;
  -- Three 100000 digit numbers push the payload past 256 KiB while every
  -- other rule still passes: only the size cap can refuse it.
  if public.drill_layout_ok((
    '{"version":1,"area":{"width":10,"length":10},"frames":[{"entities":['
    || '{"id":"e1","kind":"cone","x":' || v_big || ',"y":1},'
    || '{"id":"e2","kind":"cone","x":' || v_big || ',"y":1},'
    || '{"id":"e3","kind":"cone","x":' || v_big || ',"y":1}'
    || '],"zones":[],"arrows":[]}]}')::jsonb) then
    raise exception 'drill_layout: the check accepted an oversized payload';
  end if;

  -- And accepts what the client validates clean.
  if not public.drill_layout_ok('{"version":1,"area":{"width":12,"length":12},"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check refused a minimal valid layout';
  end if;
  if not public.drill_layout_ok('{"version":1,"area":{"width":12,"length":12},"frames":[{"entities":[{"id":"p1","kind":"player","x":1,"y":1,"rotation":90,"team":"attack","label":"GK"}],"zones":[{"id":"z1","x":0,"y":0,"width":6,"height":6,"label":"Build zone"}],"arrows":[{"id":"a1","kind":"pass","from":{"x":1,"y":1},"to":{"x":5,"y":5}}],"note":"Pass and follow."}]}'::jsonb) then
    raise exception 'drill_layout: the check refused a fully featured valid layout';
  end if;
  if not public.drill_layout_ok(null) then
    raise exception 'drill_layout: null must remain valid, it is the FA discriminator';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'drills_layout_never_imported' and conrelid = 'public.drills'::regclass
  ) then
    raise exception 'drill_layout: the never retrofitted cross field constraint is missing';
  end if;
end
$$;
