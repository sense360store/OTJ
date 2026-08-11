-- =====================================================================
-- OTJ Training Hub, migration 0046_drill_diagram: a drill carries its own
-- diagram (Drill Maker C1)
--
-- REVIEW REQUIRED, and NOT APPLIED. Migrations are gated in this repo. This
-- file ships with the pull request and is run by hand after review, once the
-- live ledger is confirmed to have this slot free. Do not auto-merge and do
-- not run `supabase db push` from a session. No Edge Function changes
-- accompany it.
--
-- NUMBERING. The live migration ledger ends at spond_links (0045), checked
-- against the hosted project on 2026-08-11, so this is 0046. The file numbers
-- on disk have gaps (0003, 0004 and 0010 are absent); the ledger is the
-- authority, not the highest file name.
--
-- WHAT IT DOES
--
--   1. Adds public.drills.diagram, a nullable jsonb column.
--   2. Adds three immutable shape functions and one check constraint that pin
--      the stored shape to the exact field set the client writes.
--
-- RLS. NO NEW POLICY, deliberately. The four live policies on public.drills
-- already cover every column of the table:
--   drills_select_club                club_id = my_club()
--   drills_insert_club
--   drills_update_owner_or_manager    club_id = my_club()
--                                     and (has_perm('drills.manage')
--                                          or (created_by = auth.uid()
--                                              and has_perm('drills.create')))
--   drills_delete_owner_or_manager    the same condition
-- A diagram is an ordinary column, so writing one is already exactly as
-- restricted as renaming the drill, and reading one is already exactly as open
-- as reading the drill. Adding a policy here would be a second, weaker
-- statement of a boundary that already holds, and drills_select_club in
-- particular is NOT touched.
--
-- EXECUTE ON THE SHAPE FUNCTIONS STAYS WITH PUBLIC. Unlike the 0028 backfill
-- transform, these are check constraint predicates, and a check constraint is
-- evaluated with the privileges of the role performing the write. Revoking
-- EXECUTE would turn every drill save by `authenticated` into "permission
-- denied for function" (42501) instead of a clean constraint violation. This is
-- the rule 0042_public_media_path_boundary.sql states for
-- is_canonical_media_path; do not revoke it here either. The functions read no
-- table, take only their arguments and return a boolean, so there is nothing to
-- learn by calling one.
--
-- AUDIT. A diagram change writes NO audit row, and that is accepted rather than
-- overlooked. public.audit_drills() (0037_audit_rollout.sql) records an update
-- only when corner, level or duration changed and returns early otherwise, so a
-- save that touches the diagram alone falls through that early return. Drawing
-- is authoring work on the coach's own drill, of the same kind as the summary
-- and the coaching points, which are not audited either; the club feed is for
-- who changed a drill's classification, not for every stroke. If a diagram ever
-- needs an audit trail it is an amendment to audit_drills() in its own gated
-- migration, not a silent widening here.
--
-- WHAT IT DOES NOT DO
--
--   - It changes NO policy, grant, capability, role or trigger.
--   - It changes no row. Every existing drill gets NULL, which the client
--     reads as "no diagram yet".
--   - It does not touch the England Football rights lock (0043). A diagram is
--     an ordinary column, so writing one does not change a row's rights and
--     cannot promote it. The product rule that an England Football derived
--     drill is not given a hand drawn diagram at all is a CLIENT rule, stated
--     in src/lib/drillDiagramRights.ts and pinned by its tests, because it
--     rests on the club's licence terms (unmodified FA images, never
--     recreated) rather than on a data boundary the database can see.
--   - It adds no index. A diagram is read by drill id, which the primary key
--     already answers, and it is never filtered or searched on.
--
-- WHY A CHECK CONSTRAINT AT ALL, and what it is for
--
-- THE IDENTITY BOUNDARY. A drill is a reusable exercise: any coach runs it
-- with any group, so no part of it may name a child. The client's parser and
-- serialiser both rebuild each element from an allow-list, so nothing else can
-- survive a read or a write (src/lib/drillDiagram.ts). This constraint states
-- the same allow-list as SCHEMA, so the boundary holds against any client, a
-- hand written PostgREST call and service_role alike; check constraints are
-- not row level security and nothing bypasses them. That is the shape 0028
-- gave the board tokens, for the same reason and after a real finding.
--
-- The allow-list is the whole mechanism: there is no key named playerId,
-- player_id, spond_member_id, name, display_name, guardian, email, phone or
-- shirt_number in any of the seven element shapes, so none of them can be
-- stored. A deny-list would have to anticipate the next name; this does not.
--
-- WHAT IT DELIBERATELY DOES NOT CHECK. Coordinate ranges are not enforced
-- here. They are clamped on write and clamped again on read, and a coordinate
-- outside 0 to 1 is a drawing that looks wrong rather than a boundary that has
-- been crossed. Refusing the write would turn a cosmetic problem into a failed
-- save, so the constraint stays on the part that matters: which fields may
-- exist at all, how many elements there may be, and how long the two text
-- fields may be.
--
-- ROLLBACK. Structurally:
--   alter table public.drills drop constraint drills_diagram_shape;
--   drop function public.drill_diagram_is_valid(jsonb);
--   drop function public.drill_diagram_element_is_valid(jsonb);
--   drop function public.drill_diagram_keys_within(jsonb, text[]);
--   alter table public.drills drop column diagram;
-- Dropping the column discards every saved diagram, so roll back the
-- constraint alone unless the feature itself is being withdrawn. Nothing else
-- in the schema references the column, so no other object breaks either way.
--
-- APPLY ORDER. Unlike 0028 there is no ordering hazard: the column is new and
-- every value is NULL, so the constraint cannot fail on existing data and no
-- deployed client writes the column yet. Apply before or after the frontend;
-- the frontend simply shows no diagram until the column exists.
-- =====================================================================

-- ONE transaction, as 0041 through 0045 are: the column, the three shape
-- functions and the constraint are one boundary, and a half applied boundary
-- is a column with no rule on it.
begin;

-- ---------------------------------------------------------------------
-- The column. Nullable with no default: NULL means "no diagram was ever
-- built", which is what every existing drill is.
-- ---------------------------------------------------------------------
alter table public.drills
  add column if not exists diagram jsonb;

-- ---------------------------------------------------------------------
-- Are every one of this object's keys inside the allowed set? The one
-- primitive the element shapes are built from. Immutable: it computes on
-- its arguments alone.
-- ---------------------------------------------------------------------
create or replace function public.drill_diagram_keys_within(p_obj jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_obj) = 'object'
     and not exists (
           select 1
           from jsonb_object_keys(p_obj) as k(key)
           where not (k.key = any(p_allowed))
         )
$$;

comment on function public.drill_diagram_keys_within(jsonb, text[]) is
  $$True when every key of the given jsonb object is in the allowed list. The primitive behind the drills_diagram_shape check constraint. See 0046_drill_diagram.sql.$$;

-- ---------------------------------------------------------------------
-- One diagram element. Seven types, each an exact field set, mirroring
-- src/lib/drillDiagram.ts. An unknown type is refused outright, so a new
-- element shape needs a migration rather than arriving unannounced.
--
-- The two text fields are length capped here as well as in the client, so
-- the column cannot become a place to put a paragraph.
-- ---------------------------------------------------------------------
create or replace function public.drill_diagram_element_is_valid(p_el jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_el ->> 'type'
    when 'player' then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y', 'colour', 'label'])
                   and coalesce(length(p_el ->> 'label'), 0) <= 3
    when 'cone'   then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y', 'colour'])
    when 'ball'   then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y'])
    when 'goal'   then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y', 'width', 'facing'])
    when 'arrow'  then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x1', 'y1', 'x2', 'y2', 'arrow'])
    when 'zone'   then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y', 'w', 'h', 'colour'])
    when 'text'   then public.drill_diagram_keys_within(p_el, array['type', 'id', 'x', 'y', 'text'])
                   and coalesce(length(p_el ->> 'text'), 0) <= 24
    else false
  end
$$;

comment on function public.drill_diagram_element_is_valid(jsonb) is
  $$True when a drill diagram element carries only the fields its type allows: player(type,id,x,y,colour,label), cone(type,id,x,y,colour), ball(type,id,x,y), goal(type,id,x,y,width,facing), arrow(type,id,x1,y1,x2,y2,arrow), zone(type,id,x,y,w,h,colour), text(type,id,x,y,text). No element shape has a field that could name a person. See 0046_drill_diagram.sql.$$;

-- ---------------------------------------------------------------------
-- The whole diagram: version 1, an allow-listed top level, a bounded
-- element array, and every element valid.
-- ---------------------------------------------------------------------
create or replace function public.drill_diagram_is_valid(p_diagram jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_diagram is null
      or (
           public.drill_diagram_keys_within(p_diagram, array['version', 'surface', 'elements'])
           and p_diagram ->> 'version' = '1'
           and (
                 p_diagram -> 'surface' is null
                 or public.drill_diagram_keys_within(p_diagram -> 'surface', array['kind', 'orientation'])
               )
           and jsonb_typeof(p_diagram -> 'elements') = 'array'
           and jsonb_array_length(p_diagram -> 'elements') <= 60
           and not exists (
                 select 1
                 from jsonb_array_elements(p_diagram -> 'elements') as e(el)
                 where not public.drill_diagram_element_is_valid(e.el)
               )
         )
$$;

comment on function public.drill_diagram_is_valid(jsonb) is
  $$True when a drills.diagram value is null, or a version 1 diagram carrying only version, surface and elements, with at most 60 elements, each of an allowed type and carrying only that type's fields. Backs the drills_diagram_shape check constraint: no key that could name a child can be persisted in a drill diagram, from any client including service_role. See 0046_drill_diagram.sql.$$;

-- ---------------------------------------------------------------------
-- The boundary as schema. Safe to add unvalidated-free: every existing
-- row has diagram NULL, which the function accepts, so the validation
-- scan cannot fail.
-- ---------------------------------------------------------------------
alter table public.drills
  add constraint drills_diagram_shape
  check (public.drill_diagram_is_valid(diagram));

comment on column public.drills.diagram is
  $$The drill's visual diagram (Drill Maker C1), or null when none was built. A version 1 object of {version, surface{kind,orientation}, elements[]}. Coordinates are FRACTIONS of the surface (0 to 1), never pixels, so one stored diagram renders at any size. Elements are generic coaching objects: player, cone, ball, goal, arrow, zone and text. NO PERSON IS EVER STORED HERE: there is no playerId, no Spond member id, no name and no contact field in any element shape, and the drills_diagram_shape check constraint refuses any key outside the allowed set. A drill is reusable by any coach with any group, which is why. Written only by the focused diagram save (src/lib/queries.ts saveDrillDiagram), never as part of a whole drill update. See 0046_drill_diagram.sql and src/lib/drillDiagram.ts.$$;

-- ---------------------------------------------------------------------
-- Self verification. Proves the constraint accepts what the client writes
-- and refuses what the boundary exists to stop, without leaving a row
-- behind. Aborts the migration if any expectation fails.
-- ---------------------------------------------------------------------
do $$
begin
  -- Null, and a complete valid diagram, are accepted.
  if not public.drill_diagram_is_valid(null) then
    raise exception 'drill diagram: null must be a valid diagram';
  end if;
  if not public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"full_pitch","orientation":"portrait"},"elements":[
        {"type":"player","id":"player-1","x":0.5,"y":0.5,"colour":"blue","label":"9"},
        {"type":"cone","id":"cone-2","x":0.2,"y":0.3,"colour":"orange"},
        {"type":"ball","id":"ball-3","x":0.4,"y":0.6},
        {"type":"goal","id":"goal-4","x":0.5,"y":0.1,"width":0.24,"facing":"up"},
        {"type":"arrow","id":"arrow-5","x1":0.1,"y1":0.1,"x2":0.6,"y2":0.7,"arrow":"pass"},
        {"type":"zone","id":"zone-6","x":0.1,"y":0.1,"w":0.4,"h":0.3,"colour":"yellow"},
        {"type":"text","id":"text-7","x":0.5,"y":0.9,"text":"Press"}
      ]}'::jsonb
  ) then
    raise exception 'drill diagram: the canonical seven element diagram must be valid';
  end if;

  -- The identity boundary: a child cannot be put in a diagram.
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[
        {"type":"player","id":"player-1","x":0.5,"y":0.5,"colour":"blue","label":"9","playerId":"abc"}]}'::jsonb
  ) then
    raise exception 'drill diagram: a playerId must be refused';
  end if;
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[
        {"type":"player","id":"player-1","x":0.5,"y":0.5,"colour":"blue","label":"9","name":"Jamie"}]}'::jsonb
  ) then
    raise exception 'drill diagram: a name must be refused';
  end if;
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[
        {"type":"cone","id":"cone-1","x":0.5,"y":0.5,"colour":"red","spond_member_id":"ABC123"}]}'::jsonb
  ) then
    raise exception 'drill diagram: a Spond member id must be refused';
  end if;

  -- Shape and bounds.
  if public.drill_diagram_is_valid('{"version":2,"surface":{"kind":"blank"},"elements":[]}'::jsonb) then
    raise exception 'drill diagram: an unknown version must be refused';
  end if;
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[{"type":"wormhole","id":"w-1","x":0.5,"y":0.5}]}'::jsonb
  ) then
    raise exception 'drill diagram: an unknown element type must be refused';
  end if;
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[],"roster":["Jamie"]}'::jsonb
  ) then
    raise exception 'drill diagram: an unknown top level key must be refused';
  end if;
  if public.drill_diagram_is_valid(
    ('{"version":1,"surface":{"kind":"blank"},"elements":'
      || (select jsonb_agg(jsonb_build_object('type','ball','id','ball-'||g,'x',0.5,'y',0.5))
          from generate_series(1, 61) as g)::text
      || '}')::jsonb
  ) then
    raise exception 'drill diagram: more than 60 elements must be refused';
  end if;
  if public.drill_diagram_is_valid(
    '{"version":1,"surface":{"kind":"blank"},"elements":[
        {"type":"text","id":"text-1","x":0.5,"y":0.5,"text":"this label is far too long to be a coaching cue"}]}'::jsonb
  ) then
    raise exception 'drill diagram: an over long label must be refused';
  end if;
end
$$;

commit;
