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
-- to four static phases sharing entity identity). The full model and its
-- exhaustive validation live in src/lib/drillLayout.ts; this CHECK is the
-- database's bounded outer guard in the venue_boundary_ok style: shape,
-- version, area bounds and array caps, so a wildly malformed or oversized
-- value is unstorable whoever writes it, while the deep per entity rules
-- stay in the one place they can be exhaustive.
--
-- NEVER RETROFITTED. Existing FA imported drills keep their image and
-- video media unchanged forever; their layout stays null and no backfill
-- exists or ever will. A null layout is the discriminator the drill
-- detail renders by. Layouts carry no person data: entity labels are
-- capped at three characters client side and the column check bounds the
-- payload size.
-- =====================================================================

create or replace function public.drill_layout_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) <> 'object' then false
    -- is distinct from, not <>: a missing key yields SQL null, and a null
    -- case condition would fall through as if the check had passed.
    when p -> 'version' is distinct from '1'::jsonb then false
    when jsonb_typeof(p -> 'area') is distinct from 'object' then false
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
        when jsonb_typeof(f.frame -> 'entities') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'entities') > 80 then true
        when jsonb_typeof(f.frame -> 'zones') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'zones') > 10 then true
        when jsonb_typeof(f.frame -> 'arrows') is distinct from 'array' then true
        when jsonb_array_length(f.frame -> 'arrows') > 40 then true
        else false
      end
    )
  end
$$;

alter table public.drills
  add column layout jsonb check (public.drill_layout_ok(layout));

comment on column public.drills.layout is
  $$The structured layout of an authored drill (ADR-0008): metres relative to the drill's declared area, entities, zones and typed arrows across one to four static phases. Null for every FA imported drill, forever; they keep their image and video media and are never retrofitted. The full model and exhaustive validation live in src/lib/drillLayout.ts; drill_layout_ok bounds the outer shape here.$$;

-- No policy change: the layout rides the drills row under the existing
-- drills policies (club wide read; create and owner edit under
-- drills.create, any under drills.manage).

-- ---------------------------------------------------------------------
-- Self verification.
-- ---------------------------------------------------------------------
do $$
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
  if not public.drill_layout_ok('{"version":1,"area":{"width":12,"length":12},"frames":[{"entities":[],"zones":[],"arrows":[]}]}'::jsonb) then
    raise exception 'drill_layout: the check refused a minimal valid layout';
  end if;
  if not public.drill_layout_ok(null) then
    raise exception 'drill_layout: null must remain valid, it is the FA discriminator';
  end if;
end
$$;
