-- =====================================================================
-- OTJ Training Hub, migration 0053_venue_layouts: the admin owned venue
-- layouts, scoped to venue, season and age group (coaching workflow
-- COACH-5, migration M2), and the club's age group vocabulary that scope
-- key rests on.
--
-- REVIEW REQUIRED, and NOT APPLIED. Migrations are gated in this repo. This
-- file ships with the pull request and is applied through the reviewed
-- production migration workflow after review, once the live ledger is
-- confirmed to still hold the head it was registered against. Do not
-- auto-merge and do not run `supabase db push` from a session. No Edge
-- Function changes accompany it.
--
-- NUMBERING. The hosted ledger's newest row is 20260904174142 /
-- atomic_team_order (0052), read live from the hosted project on
-- 7 September 2026, so this is 0053. The file numbers on disk have gaps
-- (0003, 0004 and 0010 are absent); the ledger is the authority, not the
-- highest file name, and the reviewed register pins this file to that head
-- so it cannot run against any other.
--
-- WHAT IT DOES
--
--   1. Adds public.clubs.age_groups, text[] not null default '{}', the
--      club's canonical age group list, with an immutable predicate and a
--      check constraint bounding it (trimmed, non blank, at most 20
--      characters each, no duplicates, at most 30 entries).
--   2. Adds public.venue_layouts: one row per (club, venue, season, age
--      group, kind, slots), holding an ordered list of numbered zones in
--      fraction coordinates, with the shape stated as a check constraint
--      through three immutable predicates in the manner of 0046.
--   3. Row level security mirroring public.venues exactly, explicit grants,
--      and an audit trigger recording create, update and delete at row
--      granularity through the existing private writer audit_domain_event.
--
-- WHY THE SCOPE IS A TABLE AND NOT A COLUMN ON venues. A layout records the
-- club's ALLOCATION of a ground, which is renegotiated between seasons and
-- differs between the age groups sharing one venue on one night, so the
-- scope is venue, season and age group and is not negotiable down to a
-- venue alone (docs/product/coaching-workflow/02-target-product-model.md
-- section 8). A season is a row, and seasons_id_club_unique (0031) makes a
-- club scoped composite reference to it available; a season id inside a
-- jsonb blob on venues would be unenforceable, and a blob holding every
-- season's and age group's layouts only ever grows and is edited by read
-- modify write, so two admins drawing two age groups on one evening would
-- overwrite each other. One row per layout is the unit of editing, of
-- deletion, and of the unique key that makes "one five station layout per
-- scope" a database fact.
--
-- WHY THE AGE GROUP LIST IS ON clubs AND IS PART OF THIS MIGRATION. The
-- layout is filed under an age group label, and a scope key is only as good
-- as the vocabulary behind it. There was no club level vocabulary at all:
-- public.clubs carries no age group column, and the age_groups text[] that
-- exists is on public.profiles, one coach's personal preference, which two
-- coaches could set to two different lists and which a member editing their
-- own profile would move a scope key with. The session's age group control
-- and the layout admin screen now read ONE list, replacing the two
-- hardcoded literals that disagreed with each other in the client. It is
-- admin managed under the existing club.manage capability, through the
-- existing clubs_update_manage policy (0012), so no new policy and no new
-- capability key. default '{}' means no backfill and no behaviour change on
-- apply: an empty list reads as "not configured yet" and the client offers
-- its previous defaults until an admin sets one. NO sessions.age_group value
-- is rewritten, silently or otherwise: a legacy label simply resolves no
-- layout, which is one of the five named no-layout states.
--
-- THE SHAPE, AND THE DISCIPLINE IT INHERITS. zones is the third fraction
-- coordinate jsonb value in the product, after boards.tokens (0028) and
-- drills.diagram (0046), and inherits their rules rather than inventing a
-- third: fractions 0 to 1 for position, never metres; a version, where an
-- unrecognised one yields no layout rather than a mis drawn one; a key
-- allow list stated as schema so it holds against any client, a hand
-- written PostgREST call and service_role alike; and a parser and
-- serialiser on the client (src/lib/venueLayout.ts) that rebuild field by
-- field and never spread. The predicate takes slots AS WELL AS zones because
-- the zone count is a property of the PAIR: a four zone value on a slots = 5
-- row is exactly the corruption the constraint exists to refuse, and a
-- predicate over zones alone cannot see the row's slots to compare against.
--
-- WHAT THE SHAPE MUST REFUSE, as a checklist the self verification runs:
--   an unrecognised version                  venue_layout_is_valid
--   a key outside the allow list, any depth  venue_layout_is_valid, as 0046
--   a coordinate outside 0 to 1, a zone that
--     leaves the surface, or one below the
--     minimum size                           venue_layout_is_valid
--   a zone count that is not slots           venue_layout_is_valid(zones, slots)
--   station numbers that are not exactly
--     1..slots once each                     venue_layout_is_valid
--   kind = 'stations' with slots not in 4, 5 venue_layouts_slots_valid
--   kind = 'games' with slots not in 1, 2    venue_layouts_slots_valid
--   two layouts of one kind and slots in one
--     scope                                  venue_layouts_scope_unique
-- Coordinates ARE range checked here, unlike 0046, because a zone is not a
-- cosmetic mark: a zone off the surface is a station nobody can find, and
-- the client clamps on write so a refused value can only arrive from a hand
-- written call.
--
-- IT MUST HOLD NO PERSON, NO ADDRESS, NO POSTCODE, NO LATITUDE OR LONGITUDE,
-- NO MAP TILE URL AND NO IMAGERY REFERENCE. The allow list makes each
-- unrepresentable rather than discouraged: the only text a zone carries is
-- its own short name ("Top corner"), capped at 30 characters.
--
-- THE COLUMNS THAT ARE NOT HERE. No created_by, no updated_by, no
-- updated_at. venues (0044) carries none of them and says why: club.manage
-- configuration with no ownership concept, and the audit trail records who.
-- A layout is the same class of thing, so the same reasoning applies
-- without modification, and with the accountability fields removed the
-- audit trail is the ONLY record of who changed a layout, which is why the
-- trigger below is not optional polish. No client writable accountability
-- field remains, so there is nothing to forge.
--
-- NO SEPARATE INDEX. An earlier draft added one on (club_id, venue_id,
-- season_id), which is a strict leading prefix of the unique constraint's
-- own btree, so Postgres already serves that lookup from it. 0044 declines
-- exactly this redundancy by name.
--
-- RLS. venue_layouts_select_club and venue_layouts_manage mirror
-- venues_select_club and venues_manage (0044) exactly: club wide read with
-- no capability, because a coach needs to see where the stations go and the
-- row carries no child data; club.manage write, because it is admin
-- configuration. clubs gains no policy: age_groups is an ordinary column
-- and clubs_update_manage already gates every column of the row.
--
-- GRANTS. Revoke first, then grant exactly what the policies allow, the
-- rule every table added since 0030 follows. anon holds nothing. clubs
-- keeps whatever grant it has: it predates the explicit grant convention
-- and this migration does not reshape it.
--
-- EXECUTE ON THE SHAPE FUNCTIONS STAYS WITH PUBLIC. They are check
-- constraint predicates, and a check constraint is evaluated with the
-- privileges of the role performing the write; revoking EXECUTE would turn
-- every layout save by `authenticated` into 42501 instead of a clean
-- constraint violation. This is the rule 0042 states for
-- is_canonical_media_path and 0046 restates for its predicates. The
-- functions read no table, take only their arguments and return a boolean
-- or a number, so there is nothing to learn by calling one.
--
-- EXECUTE ON THE AUDIT TRIGGER FUNCTION IS REVOKED from public, anon and
-- authenticated, which is stricter than audit_venues() and the other 0037
-- and 0044 trigger functions, and deliberately so: the production security
-- advisor lists every one of those as a SECURITY DEFINER function callable
-- through /rest/v1/rpc, and a trigger function needs EXECUTE only at CREATE
-- TRIGGER time, never at fire time. A direct call is refused with 42501 and
-- the trigger still fires for every writer, which the CI harness proves on
-- a real server rather than asserts. The existing functions are not
-- reshaped here; that is a separate change with its own review.
--
-- AUDIT. Create, update and delete at row granularity, under the actions
-- venue_layout.created, venue_layout.updated and venue_layout.deleted and
-- the entity type venue_layout (review decision R2,
-- docs/product/coaching-workflow/08-open-questions.md). Field NAMES only,
-- from the allow list zones, venue_id, season_id, age_group, kind, slots,
-- never a value: audit_domain_event writes no safe_changes and no metadata,
-- and the self verification reads the stored function back to require that
-- every array_append carries a string literal. audit_events has no action
-- or entity_type check by design (0030), so no vocabulary migration is
-- needed; the client's own vocabulary (src/lib/activityView.ts) gains the
-- three actions and the entity in the same change. Because the layout is a
-- table rather than a column on venues, audit_venues() and the "Venue
-- renamed" label it implies stay true.
--
-- A change to clubs.age_groups writes NO audit row, and that is accepted
-- rather than overlooked: clubs has never carried an audit trigger, so a
-- club rename or a motto change is not recorded either, and this migration
-- does not add one. If the club's vocabulary ever needs a trail it is an
-- audit_clubs() in its own gated migration, not a silent widening here.
--
-- WHAT IT DOES NOT DO
--
--   - It changes no existing policy, no existing grant, no capability key,
--     no role and no existing trigger. The self verification fingerprints
--     the policy set, the grants and the triggers of clubs, venues and
--     seasons BEFORE the DDL and requires each unchanged after it.
--   - It changes no row. Every club gets age_groups = '{}' by default; the
--     table it creates is empty; no session, venue, season or audit row is
--     written, which the same fingerprints prove.
--   - It adds no sessions.season_id. A session's season is DERIVED from its
--     date on the client, failing closed (exactly one containing season
--     wins; zero or more than one loads nothing and says which), because a
--     stored season would be a second fact that can disagree with the date.
--   - It offers no three station layout and no three game layout. Four or
--     five stations and one or two games are the whole v1 vocabulary, and
--     the constraint refuses the rest rather than storing something no
--     screen can draw.
--
-- ROLLBACK. Structurally:
--   drop table public.venue_layouts;                    -- discards every saved layout
--   drop function public.venue_layout_is_valid(jsonb, integer);
--   drop function public.venue_layout_zone_is_valid(jsonb, integer);
--   drop function public.venue_layout_number(jsonb, text);
--   drop function public.venue_layout_keys_within(jsonb, text[]);
--   alter table public.clubs drop constraint clubs_age_groups_valid;
--   alter table public.clubs drop column age_groups;    -- discards every club's list
--   drop function public.age_group_list_is_valid(text[]);
-- Drop the check constraint venue_layouts_zones_shape alone if only the
-- shape is being withdrawn. Dropping the table discards every saved layout,
-- so roll back the constraint alone unless the feature itself is being
-- withdrawn.
--
-- APPLY ORDER. THIS MIGRATION GOES FIRST, before the frontend from the same
-- change is deployed, for the reason 0046 learned: the new screens read
-- clubs.age_groups and venue_layouts, and against a database without them
-- PostgREST answers 42703 and 42P01, so the reads fail. Applying it early
-- is safe: the column is new and '{}' everywhere, the table is new and
-- empty, and no deployed client reads or writes either, so nothing changes
-- for anybody until the frontend ships.
-- =====================================================================

-- ONE transaction, as 0044 through 0052 are: the column, the predicates,
-- the table, its policies, grants and trigger are one boundary, and a half
-- applied boundary is a table with no rule on it.
begin;

-- ---------------------------------------------------------------------
-- 0. The BEFORE fingerprint. Read before any DDL, into a transaction
--    local table, so "changed nothing else" below is a comparison across
--    the change rather than a value compared with itself (0051, 0052).
-- ---------------------------------------------------------------------
create temporary table _0053_before on commit drop as
select
  (select count(*) from public.clubs) as club_rows,
  (select coalesce(md5(string_agg(to_jsonb(c)::text, ',' order by c.id)), 'empty') from public.clubs c) as clubs_fingerprint,
  (select coalesce(md5(string_agg(to_jsonb(v)::text, ',' order by v.id)), 'empty') from public.venues v) as venues_fingerprint,
  (select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') from public.seasons s) as seasons_fingerprint,
  (select coalesce(md5(string_agg(coalesce(s.age_group, '{null}'), ',' order by s.id)), 'empty') from public.sessions s) as session_age_groups_fingerprint,
  (select count(*) from public.audit_events) as audit_rows,
  (select coalesce(md5(string_agg(c.key || ':' || coalesce(c.description, ''), ',' order by c.key)), 'empty') from public.capabilities c) as capabilities_fingerprint,
  (select coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ',' order by p.tablename, p.policyname), '')
     from pg_policies p where p.schemaname = 'public' and p.tablename in ('clubs', 'venues', 'seasons')) as policies,
  (select coalesce(string_agg(g.grantee || ':' || g.table_name || ':' || g.privilege_type, ',' order by g.grantee, g.table_name, g.privilege_type), '')
     from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('clubs', 'venues', 'seasons')
      and g.grantee in ('anon', 'authenticated', 'service_role')) as grants,
  (select coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname), '')
     from pg_trigger t
    where t.tgrelid in ('public.clubs'::regclass, 'public.venues'::regclass, 'public.seasons'::regclass)
      and not t.tgisinternal) as triggers;

-- ---------------------------------------------------------------------
-- 1. The club's age group vocabulary.
-- ---------------------------------------------------------------------

-- The list's shape. Immutable: it computes on its argument alone. Each
-- label is stored trimmed so that 'U8s' and 'U8s ' cannot be two entries,
-- non blank (the whitespace named explicitly, as venues_name_not_blank
-- does, because btrim with no second argument strips the space alone),
-- and at most 20 characters, matching seasons.name and the layout's own
-- age_group bound. No duplicates, at most 30 entries, one dimension.
create or replace function public.age_group_list_is_valid(p_groups text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_groups is not null
     and coalesce(array_ndims(p_groups), 1) = 1
     and coalesce(array_length(p_groups, 1), 0) <= 30
     and not exists (
           select 1
           from unnest(p_groups) as g(label)
           where g.label is null
              or btrim(g.label, E' \t\r\n') = ''
              or g.label <> btrim(g.label, E' \t\r\n')
              or char_length(g.label) > 20
         )
     and (select count(*) from unnest(p_groups) as g(label))
         = (select count(distinct g.label) from unnest(p_groups) as g(label))
$$;

comment on function public.age_group_list_is_valid(text[]) is
  $$True when a clubs.age_groups value is a one dimensional list of at most 30 distinct, trimmed, non blank labels of at most 20 characters each. The empty list is valid and means the club has not configured its age groups. Backs the clubs_age_groups_valid check constraint. See 0053_venue_layouts.sql.$$;

alter table public.clubs
  add column age_groups text[] not null default '{}';

alter table public.clubs
  add constraint clubs_age_groups_valid
  check (public.age_group_list_is_valid(age_groups));

comment on column public.clubs.age_groups is
  $$The club's canonical age group labels (0053), in the order the admin arranged them, e.g. {U7s,U8s,U9s}. Admin managed under club.manage through the existing clubs_update_manage policy. It is the ONE list the session age group control and the venue layout admin read, replacing two hardcoded client literals that disagreed. Empty means not configured yet, which is every club on apply, and the client then offers its previous defaults. It is a vocabulary, not a table: nothing references an age group by id and nothing carries attributes about one. sessions.age_group stays free text and no stored value is rewritten; a label the list does not contain still opens and runs its session, and simply resolves no venue layout. Bounded by clubs_age_groups_valid. Deliberately NOT profiles.age_groups, which is one coach's personal preference and cannot define a club level scope key.$$;

-- ---------------------------------------------------------------------
-- 2. The venue layout shape, as three immutable predicates.
-- ---------------------------------------------------------------------

-- Are every one of this object's keys inside the allowed set? The same
-- primitive 0046 defines as drill_diagram_keys_within, restated under its
-- own name rather than borrowed, so that 0046's documented rollback (which
-- drops that function) cannot orphan this constraint, and so that neither
-- migration's shape depends on the other's continued existence.
create or replace function public.venue_layout_keys_within(p_obj jsonb, p_allowed text[])
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

comment on function public.venue_layout_keys_within(jsonb, text[]) is
  $$True when every key of the given jsonb object is in the allowed list. The primitive behind the venue_layouts_zones_shape check constraint, restated from 0046 under its own name so the two constraints do not share a rollback. See 0053_venue_layouts.sql.$$;

-- A numeric field read safely. The cast only runs when the value IS a JSON
-- number, decided by a CASE so the order is guaranteed; a string, a
-- boolean, a null or an absent key reads as SQL NULL, which every
-- comparison below turns into false through the outer coalesce. Without
-- this, a string where a number belongs would raise 22P02 out of the
-- constraint instead of failing it.
create or replace function public.venue_layout_number(p_obj jsonb, p_key text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_obj -> p_key) = 'number' then (p_obj ->> p_key)::numeric
    else null
  end
$$;

comment on function public.venue_layout_number(jsonb, text) is
  $$The named field of a jsonb object as a numeric when it is a JSON number, else null. A helper for the venue layout predicates so a non numeric value fails the constraint rather than raising a cast error. See 0053_venue_layouts.sql.$$;

-- One zone: a numbered rectangle in fraction coordinates. n is its station
-- or game number within the layout, an integer in 1..slots; name is an
-- optional short label; x, y, w and h are fractions of the surface, the
-- rectangle must lie within it, and neither side may fall below 0.05 of
-- the surface, because a zone smaller than that is invisible on a phone
-- and impossible to grab back in the editor.
--
-- The allow list IS the identity boundary: there is no key named
-- player_id, playerId, spond_member_id, name_of_child, address, postcode,
-- lat, lng, image or url in the shape, so none can be stored.
create or replace function public.venue_layout_zone_is_valid(p_zone jsonb, p_slots integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    public.venue_layout_keys_within(p_zone, array['n', 'name', 'x', 'y', 'w', 'h'])
    and public.venue_layout_number(p_zone, 'n') = floor(public.venue_layout_number(p_zone, 'n'))
    and public.venue_layout_number(p_zone, 'n') between 1 and p_slots
    and (
          p_zone -> 'name' is null
          or (jsonb_typeof(p_zone -> 'name') = 'string' and char_length(p_zone ->> 'name') <= 30)
        )
    and public.venue_layout_number(p_zone, 'x') between 0 and 1
    and public.venue_layout_number(p_zone, 'y') between 0 and 1
    and public.venue_layout_number(p_zone, 'w') between 0.05 and 1
    and public.venue_layout_number(p_zone, 'h') between 0.05 and 1
    and public.venue_layout_number(p_zone, 'x') + public.venue_layout_number(p_zone, 'w') <= 1
    and public.venue_layout_number(p_zone, 'y') + public.venue_layout_number(p_zone, 'h') <= 1,
    false
  )
$$;

comment on function public.venue_layout_zone_is_valid(jsonb, integer) is
  $$True when a venue layout zone carries only n, name, x, y, w and h: n an integer in 1..slots, name absent or a string of at most 30 characters, x and y fractions in 0..1, w and h fractions of at least 0.05, and the rectangle inside the surface. No field in the shape can name a person or a place. See 0053_venue_layouts.sql.$$;

-- The whole value: version 1, an allow listed top level, an optional
-- declared real world size in metres (metadata for labelling and
-- proportion, NEVER the coordinate space), and exactly slots zones whose
-- numbers are exactly 1..slots once each. The array dependent conjuncts
-- sit inside a CASE on the array test, because SQL does not promise the
-- evaluation order of AND and jsonb_array_elements raises on a non array.
--
-- coalesce(..., false) is NOT decoration, for the reason 0046 recorded: the
-- jsonb functions are strict, a missing key makes a conjunct NULL, and a
-- CHECK constraint treats NULL as satisfied.
create or replace function public.venue_layout_is_valid(p_layout jsonb, p_slots integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_layout is not null
    and p_slots is not null
    and public.venue_layout_keys_within(p_layout, array['version', 'size', 'zones'])
    and jsonb_typeof(p_layout -> 'version') = 'number'
    and p_layout ->> 'version' = '1'
    and (
          p_layout -> 'size' is null
          or (
               public.venue_layout_keys_within(p_layout -> 'size', array['metres_wide', 'metres_long'])
               and (p_layout -> 'size' -> 'metres_wide' is null
                    or public.venue_layout_number(p_layout -> 'size', 'metres_wide') between 5 and 300)
               and (p_layout -> 'size' -> 'metres_long' is null
                    or public.venue_layout_number(p_layout -> 'size', 'metres_long') between 5 and 300)
             )
        )
    and p_layout ? 'zones'
    and case
          when jsonb_typeof(p_layout -> 'zones') = 'array' then
                jsonb_array_length(p_layout -> 'zones') = p_slots
            and not exists (
                  select 1
                  from jsonb_array_elements(p_layout -> 'zones') as z(zone)
                  where not public.venue_layout_zone_is_valid(z.zone, p_slots)
                )
            and (select count(distinct public.venue_layout_number(z.zone, 'n'))
                   from jsonb_array_elements(p_layout -> 'zones') as z(zone)) = p_slots
          else false
        end,
    false
  )
$$;

comment on function public.venue_layout_is_valid(jsonb, integer) is
  $$True when a venue_layouts.zones value is a version 1 object carrying only version, size and zones, with size absent or {metres_wide, metres_long} each absent or 5..300, and zones an array of exactly slots valid zones numbered 1..slots once each. Takes the row's slots as well as the value because the zone count is a property of the pair. Backs the venue_layouts_zones_shape check constraint: no key that could name a person or a place can be persisted, from any client including service_role. See 0053_venue_layouts.sql.$$;

-- ---------------------------------------------------------------------
-- 3. The table.
-- ---------------------------------------------------------------------
create table public.venue_layouts (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  venue_id   uuid not null,
  season_id  uuid not null,
  age_group  text not null,
  kind       text not null,
  slots      integer not null,
  zones      jsonb not null,
  -- No created_by, no updated_by and no updated_at. See the header: venues
  -- deliberately carries none of them either, and audit_venue_layouts
  -- records who changed what.
  created_at timestamptz not null default now(),

  -- Club scoped composite references (0032 pattern). Both columns are NOT
  -- NULL, so neither reference can ever set null, and the column list
  -- 0044 had to name on sessions_venue_fk does not arise here.
  -- cascade on the venue: a deleted venue's ground is not a thing any more.
  constraint venue_layouts_venue_fk
    foreign key (venue_id, club_id) references public.venues (id, club_id)
    on delete cascade,
  -- restrict on the season, mirroring player_registrations_season_fk: a
  -- season that has layouts is not silently removable, and seasons has no
  -- client delete policy or grant anyway (0031).
  constraint venue_layouts_season_fk
    foreign key (season_id, club_id) references public.seasons (id, club_id)
    on delete restrict,

  -- The scope key's third part, bounded like the club's own list: trimmed,
  -- non blank, at most 20 characters. A check cannot verify membership of
  -- clubs.age_groups (that needs a subquery); both surfaces offer the one
  -- list, which is the same discipline sessions.age_group has.
  constraint venue_layouts_age_group_bounded
    check (btrim(age_group, E' \t\r\n') <> ''
           and age_group = btrim(age_group, E' \t\r\n')
           and char_length(age_group) <= 20),
  constraint venue_layouts_kind_valid
    check (kind in ('stations', 'games')),
  -- The closed v1 vocabulary: 4 or 5 stations, 1 or 2 games. Three
  -- stations is not offered and is not storable.
  constraint venue_layouts_slots_valid check (
    (kind = 'stations' and slots in (4, 5))
    or (kind = 'games' and slots in (1, 2))
  ),
  -- The predicate takes slots as well as zones. See the header.
  constraint venue_layouts_zones_shape
    check (public.venue_layout_is_valid(zones, slots)),

  -- One layout per kind and slots per scope, as a database fact. Its btree
  -- also serves every by scope lookup, so there is no separate index.
  constraint venue_layouts_scope_unique
    unique (club_id, venue_id, season_id, age_group, kind, slots)
);

comment on table public.venue_layouts is
  $$Admin owned venue layouts (0053, coaching workflow COACH-5): where four stations go, where five go, where one game goes and where two go, at one venue, for one season and one age group. Reads are club wide, because a coach needs to see where the stations go; writes take club.manage. The scope is the unique key; a dated session stores no geometry and resolves its layout from its venue, its age group, its active station count and the season its date falls in. Carries no person data and no place data beyond the venue reference: the zones shape is allow listed by venue_layouts_zones_shape.$$;

comment on column public.venue_layouts.age_group is
  $$The age group label this layout is filed under, one of clubs.age_groups. Trimmed, non blank, at most 20 characters. A session whose age_group is not in the club's list resolves no layout.$$;
comment on column public.venue_layouts.kind is
  $$'stations' or 'games'.$$;
comment on column public.venue_layouts.slots is
  $$How many zones the layout places: 4 or 5 for stations, 1 or 2 for games. The zone count in zones must equal it (venue_layouts_zones_shape).$$;
comment on column public.venue_layouts.zones is
  $$A version 1 object of {version, size{metres_wide,metres_long}, zones[{n,name,x,y,w,h}]}. Coordinates are FRACTIONS of the surface (0 to 1), never metres or pixels; size is labelling metadata only. A station zone means the area normally allocated to Station N, not this week's footprint; a game zone is where that game is played. Written only by the layout editor (src/lib/venueLayout.ts serialiseVenueLayout). See 0053_venue_layouts.sql.$$;

-- ---------------------------------------------------------------------
-- 4. Row level security and grants, mirroring venues exactly.
-- ---------------------------------------------------------------------
alter table public.venue_layouts enable row level security;

create policy "venue_layouts_select_club" on public.venue_layouts
  for select using ( club_id = public.my_club() );
create policy "venue_layouts_manage" on public.venue_layouts
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

revoke all on public.venue_layouts from anon, authenticated;
grant select, insert, update, delete on public.venue_layouts to authenticated;

-- ---------------------------------------------------------------------
-- 5. Audit: create, update and delete at row granularity, field names
--    only, through the private writer 0037 provides.
-- ---------------------------------------------------------------------
create or replace function public.audit_venue_layouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'venue_layout.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'venue_layout.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.zones is distinct from old.zones then v_changed := array_append(v_changed, 'zones'); end if;
    if new.venue_id is distinct from old.venue_id then v_changed := array_append(v_changed, 'venue_id'); end if;
    if new.season_id is distinct from old.season_id then v_changed := array_append(v_changed, 'season_id'); end if;
    if new.age_group is distinct from old.age_group then v_changed := array_append(v_changed, 'age_group'); end if;
    if new.kind is distinct from old.kind then v_changed := array_append(v_changed, 'kind'); end if;
    if new.slots is distinct from old.slots then v_changed := array_append(v_changed, 'slots'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'venue_layout.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'venue_layout', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.audit_venue_layouts() is
  $$AFTER row trigger on venue_layouts (0053): venue_layout.created, venue_layout.updated with the changed field NAMES from the allow list (zones, venue_id, season_id, age_group, kind, slots) and never a value, and venue_layout.deleted, through the private writer audit_domain_event. EXECUTE is revoked from public, anon and authenticated: a trigger function needs it only at CREATE TRIGGER time, so the trigger fires for every writer while a direct /rpc call is refused.$$;

revoke execute on function public.audit_venue_layouts() from public, anon, authenticated;

create trigger audit_venue_layouts
  after insert or update or delete on public.venue_layouts
  for each row execute function public.audit_venue_layouts();

-- ---------------------------------------------------------------------
-- 6. Self verification. Aborts the whole migration unless the substrate
--    is exactly as intended, the shape refuses what it exists to refuse,
--    the audit trail is names alone, and nothing else moved.
-- ---------------------------------------------------------------------
do $$
declare
  b record;
  n integer;
  v_src text;
  v_after text;
  v_club uuid; v_venue uuid; v_season uuid;
  v_l4 uuid; v_l5 uuid; v_g1 uuid; v_g2 uuid; v_other uuid;
  -- The canonical layouts the client writes, one per (kind, slots).
  v_four jsonb := '{"version":1,"size":{"metres_wide":60,"metres_long":40},"zones":[
      {"n":1,"name":"Top left","x":0.02,"y":0.02,"w":0.45,"h":0.45},
      {"n":2,"x":0.53,"y":0.02,"w":0.45,"h":0.45},
      {"n":3,"x":0.02,"y":0.53,"w":0.45,"h":0.45},
      {"n":4,"x":0.53,"y":0.53,"w":0.45,"h":0.45}]}'::jsonb;
  v_five jsonb := '{"version":1,"zones":[
      {"n":1,"x":0.02,"y":0.02,"w":0.3,"h":0.45},
      {"n":2,"x":0.35,"y":0.02,"w":0.3,"h":0.45},
      {"n":3,"x":0.68,"y":0.02,"w":0.3,"h":0.45},
      {"n":4,"x":0.02,"y":0.53,"w":0.45,"h":0.45},
      {"n":5,"x":0.53,"y":0.53,"w":0.45,"h":0.45}]}'::jsonb;
  v_one jsonb := '{"version":1,"zones":[{"n":1,"name":"Main pitch","x":0.1,"y":0.1,"w":0.8,"h":0.8}]}'::jsonb;
  v_two jsonb := '{"version":1,"zones":[
      {"n":1,"x":0.02,"y":0.1,"w":0.45,"h":0.8},
      {"n":2,"x":0.53,"y":0.1,"w":0.45,"h":0.8}]}'::jsonb;
begin
  select * into b from _0053_before;

  -- ---- 1. clubs.age_groups exists in the reviewed shape ---------------
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'clubs' and column_name = 'age_groups'
                   and data_type = 'ARRAY' and udt_name = '_text' and is_nullable = 'NO'
                   and column_default = '''{}''::text[]') then
    raise exception 'venue_layouts: clubs.age_groups must be text[] not null default ''{}''';
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'clubs_age_groups_valid' and conrelid = 'public.clubs'::regclass
                   and contype = 'c' and convalidated) then
    raise exception 'venue_layouts: clubs_age_groups_valid is missing or not validated';
  end if;
  select count(*) into n from public.clubs where age_groups <> '{}';
  if n <> 0 then
    raise exception 'venue_layouts: every club must start with an empty age group list (% did not)', n;
  end if;
  select count(*) into n from public.clubs;
  if n <> b.club_rows then
    raise exception 'venue_layouts: the club count moved (% -> %)', b.club_rows, n;
  end if;

  -- The list predicate accepts what the admin screen writes and refuses
  -- what the bound exists to stop.
  if not public.age_group_list_is_valid('{}') then
    raise exception 'venue_layouts: the empty age group list must be valid';
  end if;
  if not public.age_group_list_is_valid(array['U7s', 'U8s', 'U9s']) then
    raise exception 'venue_layouts: a plain age group list must be valid';
  end if;
  if public.age_group_list_is_valid(null) is not false then
    raise exception 'venue_layouts: a null age group list must be refused, not left null';
  end if;
  if public.age_group_list_is_valid(array['U8s', '']) then
    raise exception 'venue_layouts: a blank age group must be refused';
  end if;
  if public.age_group_list_is_valid(array['U8s', E'\t']) then
    raise exception 'venue_layouts: a whitespace only age group must be refused';
  end if;
  if public.age_group_list_is_valid(array['U8s ']) then
    raise exception 'venue_layouts: an untrimmed age group must be refused';
  end if;
  if public.age_group_list_is_valid(array['U8s', null]) then
    raise exception 'venue_layouts: a null age group entry must be refused';
  end if;
  if public.age_group_list_is_valid(array['U8s', 'U8s']) then
    raise exception 'venue_layouts: a duplicate age group must be refused';
  end if;
  if public.age_group_list_is_valid(array['Under eights and under nines']) then
    raise exception 'venue_layouts: an age group over 20 characters must be refused';
  end if;
  if public.age_group_list_is_valid((select array_agg('G' || g) from generate_series(1, 31) as g)) then
    raise exception 'venue_layouts: more than 30 age groups must be refused';
  end if;
  if public.age_group_list_is_valid(array[['U7s', 'U8s'], ['U9s', 'U10s']]) then
    raise exception 'venue_layouts: a two dimensional age group list must be refused';
  end if;

  -- ---- 2. The table exists in the reviewed shape -----------------------
  if to_regclass('public.venue_layouts') is null then
    raise exception 'venue_layouts: the table was not created';
  end if;
  select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
    into v_after
    from information_schema.columns
   where table_schema = 'public' and table_name = 'venue_layouts';
  if v_after <> 'id:uuid:NO,club_id:uuid:NO,venue_id:uuid:NO,season_id:uuid:NO,age_group:text:NO,'
              || 'kind:text:NO,slots:integer:NO,zones:jsonb:NO,created_at:timestamp with time zone:NO' then
    raise exception 'venue_layouts: the column set is not the reviewed one: %', v_after;
  end if;
  if not exists (select 1 from pg_class
                 where relname = 'venue_layouts' and relnamespace = 'public'::regnamespace and relrowsecurity) then
    raise exception 'venue_layouts: row level security is not enabled';
  end if;

  -- Exactly the two policies, mirroring venues: a club wide select and a
  -- club.manage FOR ALL with the same condition on both arms.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'venue_layouts';
  if n <> 2 then
    raise exception 'venue_layouts: expected exactly two policies (got %)', n;
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'venue_layouts'
                   and policyname = 'venue_layouts_select_club' and cmd = 'SELECT'
                   and qual = '(club_id = my_club())' and with_check is null) then
    raise exception 'venue_layouts: venue_layouts_select_club is not the club wide read';
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'venue_layouts'
                   and policyname = 'venue_layouts_manage' and cmd = 'ALL'
                   and qual = '((club_id = my_club()) AND has_perm(''club.manage''::text))'
                   and with_check = '((club_id = my_club()) AND has_perm(''club.manage''::text))') then
    raise exception 'venue_layouts: venue_layouts_manage is not the club.manage write on both arms';
  end if;

  -- Grants: authenticated holds exactly the four verbs, anon nothing.
  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') into v_after
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'venue_layouts' and grantee = 'authenticated';
  if v_after <> 'DELETE,INSERT,SELECT,UPDATE' then
    raise exception 'venue_layouts: authenticated must hold exactly select, insert, update, delete (got %)', v_after;
  end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'venue_layouts' and grantee = 'anon';
  if n <> 0 then
    raise exception 'venue_layouts: anon must hold no grant on the table (got %)', n;
  end if;

  -- The references: club cascade, venue cascade composite, season restrict
  -- composite.
  if not exists (select 1 from pg_constraint
                 where conname = 'venue_layouts_venue_fk' and conrelid = 'public.venue_layouts'::regclass
                   and contype = 'f' and confrelid = 'public.venues'::regclass and confdeltype = 'c'
                   and array_length(conkey, 1) = 2) then
    raise exception 'venue_layouts: the venue reference must be composite and cascade';
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'venue_layouts_season_fk' and conrelid = 'public.venue_layouts'::regclass
                   and contype = 'f' and confrelid = 'public.seasons'::regclass and confdeltype = 'r'
                   and array_length(conkey, 1) = 2) then
    raise exception 'venue_layouts: the season reference must be composite and restrict';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.venue_layouts'::regclass and contype = 'f'
                   and confrelid = 'public.clubs'::regclass and confdeltype = 'c') then
    raise exception 'venue_layouts: the club reference must cascade';
  end if;
  -- The unique key is the scope, in the reviewed column order.
  select pg_get_constraintdef(oid) into v_after from pg_constraint
   where conname = 'venue_layouts_scope_unique' and conrelid = 'public.venue_layouts'::regclass and contype = 'u';
  if v_after is distinct from 'UNIQUE (club_id, venue_id, season_id, age_group, kind, slots)' then
    raise exception 'venue_layouts: the scope key is not the reviewed one: %', coalesce(v_after, 'missing');
  end if;
  -- No index but the primary key and the scope key: a redundant prefix
  -- index is exactly what the header declines.
  select count(*) into n from pg_index where indrelid = 'public.venue_layouts'::regclass;
  if n <> 2 then
    raise exception 'venue_layouts: expected exactly two indexes, the primary key and the scope key (got %)', n;
  end if;
  foreach v_after in array array['venue_layouts_age_group_bounded', 'venue_layouts_kind_valid',
                                 'venue_layouts_slots_valid', 'venue_layouts_zones_shape'] loop
    if not exists (select 1 from pg_constraint
                   where conname = v_after and conrelid = 'public.venue_layouts'::regclass and contype = 'c') then
      raise exception 'venue_layouts: check constraint % is missing', v_after;
    end if;
  end loop;

  -- ---- 3. The shape accepts what the client writes ---------------------
  if not public.venue_layout_is_valid(v_four, 4) then
    raise exception 'venue_layouts: the canonical four station layout must be valid';
  end if;
  if not public.venue_layout_is_valid(v_five, 5) then
    raise exception 'venue_layouts: the canonical five station layout must be valid';
  end if;
  if not public.venue_layout_is_valid(v_one, 1) then
    raise exception 'venue_layouts: the canonical one game layout must be valid';
  end if;
  if not public.venue_layout_is_valid(v_two, 2) then
    raise exception 'venue_layouts: the canonical two game layout must be valid';
  end if;

  -- ---- and refuses what the boundary exists to stop --------------------
  -- The pair: a four zone value on a five slot row. This is the case a
  -- predicate over zones alone could not catch.
  if public.venue_layout_is_valid(v_four, 5) then
    raise exception 'venue_layouts: four zones on a slots = 5 row must be refused';
  end if;
  if public.venue_layout_is_valid(v_five, 4) then
    raise exception 'venue_layouts: five zones on a slots = 4 row must be refused';
  end if;
  -- Version.
  if public.venue_layout_is_valid(jsonb_set(v_four, '{version}', '2'), 4) then
    raise exception 'venue_layouts: an unknown version must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_four, '{version}', '"1"'), 4) then
    raise exception 'venue_layouts: a string version must be refused';
  end if;
  if public.venue_layout_is_valid(v_four - 'version', 4) is not false then
    raise exception 'venue_layouts: a missing version must be refused, not left null';
  end if;
  -- Null, and the two shapes 0046 found the strict functions turned into
  -- a satisfied constraint.
  if public.venue_layout_is_valid(null, 4) is not false then
    raise exception 'venue_layouts: a null value must be refused by the predicate, not left null';
  end if;
  if public.venue_layout_is_valid(v_four, null) is not false then
    raise exception 'venue_layouts: a null slot count must be refused, not left null';
  end if;
  if public.venue_layout_is_valid('{"version":1}'::jsonb, 4) is not false then
    raise exception 'venue_layouts: a value with no zones key must be refused, not left null';
  end if;
  if public.venue_layout_is_valid('{"version":1,"zones":"nope"}'::jsonb, 4) is not false then
    raise exception 'venue_layouts: a non array zones value must be refused, not left null';
  end if;
  if public.venue_layout_is_valid('{"version":1,"zones":{"n":1}}'::jsonb, 4) is not false then
    raise exception 'venue_layouts: an object where the zones array belongs must be refused';
  end if;
  -- Keys outside the allow list, at every level: a person, a place, an
  -- image, and an arbitrary key.
  if public.venue_layout_is_valid(v_four || '{"address":"12 Church Lane"}', 4) then
    raise exception 'venue_layouts: an address must be refused';
  end if;
  if public.venue_layout_is_valid(v_four || '{"postcode":"WF5 0AA"}', 4) then
    raise exception 'venue_layouts: a postcode must be refused';
  end if;
  if public.venue_layout_is_valid(v_four || '{"lat":53.68,"lng":-1.58}', 4) then
    raise exception 'venue_layouts: a coordinate pair must be refused';
  end if;
  if public.venue_layout_is_valid(v_four || '{"image_url":"https://tiles.example/x.png"}', 4) then
    raise exception 'venue_layouts: an image reference must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_four, '{size,url}', '"https://x"'), 4) then
    raise exception 'venue_layouts: an unknown key inside size must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,player_id}', '"abc"'), 1) then
    raise exception 'venue_layouts: a player_id on a zone must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,playerId}', '"abc"'), 1) then
    raise exception 'venue_layouts: a playerId on a zone must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,spond_member_id}', '"ABC123"'), 1) then
    raise exception 'venue_layouts: a Spond member id on a zone must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,colour}', '"red"'), 1) then
    raise exception 'venue_layouts: a key outside the zone allow list must be refused';
  end if;
  -- Bounds and geometry.
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,x}', '1.2'), 1) then
    raise exception 'venue_layouts: a coordinate above 1 must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,y}', '-0.1'), 1) then
    raise exception 'venue_layouts: a coordinate below 0 must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,x}', '0.5'), 1) then
    raise exception 'venue_layouts: a zone leaving the surface must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,w}', '0.04'), 1) then
    raise exception 'venue_layouts: a zone narrower than the minimum must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,h}', '0'), 1) then
    raise exception 'venue_layouts: a zone with no height must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,x}', '"0.1"'), 1) is not false then
    raise exception 'venue_layouts: a string coordinate must be refused rather than raise';
  end if;
  if public.venue_layout_is_valid(v_one #- '{zones,0,w}', 1) is not false then
    raise exception 'venue_layouts: a zone missing a side must be refused, not left null';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,name}', to_jsonb(repeat('x', 31))), 1) then
    raise exception 'venue_layouts: a zone name over 30 characters must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,name}', '7'), 1) then
    raise exception 'venue_layouts: a non string zone name must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,name}', 'null'), 1) then
    raise exception 'venue_layouts: a JSON null zone name must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_four, '{size,metres_wide}', '2'), 4) then
    raise exception 'venue_layouts: a declared size below 5 metres must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_four, '{size,metres_long}', '"forty"'), 4) is not false then
    raise exception 'venue_layouts: a non numeric declared size must be refused';
  end if;
  -- Numbering: exactly 1..slots once each.
  if public.venue_layout_is_valid(jsonb_set(v_two, '{zones,1,n}', '1'), 2) then
    raise exception 'venue_layouts: two zones sharing a number must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_two, '{zones,1,n}', '3'), 2) then
    raise exception 'venue_layouts: a zone numbered beyond the slot count must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,n}', '0'), 1) then
    raise exception 'venue_layouts: a zone numbered zero must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,n}', '1.5'), 1) then
    raise exception 'venue_layouts: a fractional zone number must be refused';
  end if;
  if public.venue_layout_is_valid(jsonb_set(v_one, '{zones,0,n}', '"1"'), 1) is not false then
    raise exception 'venue_layouts: a string zone number must be refused';
  end if;
  if public.venue_layout_is_valid(v_one #- '{zones,0,n}', 1) is not false then
    raise exception 'venue_layouts: a zone with no number must be refused';
  end if;
  -- Six zones carrying the numbers 1..5: every number is present once,
  -- every zone is in range, and only the count check can see the sixth.
  if public.venue_layout_is_valid(
       jsonb_set(v_five, '{zones}', (v_five -> 'zones') || '{"n":1,"x":0.5,"y":0.5,"w":0.1,"h":0.1}'::jsonb), 5) then
    raise exception 'venue_layouts: a sixth zone on a five slot row must be refused even with 1..5 all present';
  end if;
  -- A corrupt element among sound ones takes the value with it: the
  -- database refuses; the CLIENT drops the zone and keeps the rest, and
  -- the two are different jobs.
  if public.venue_layout_is_valid(jsonb_set(v_four, '{zones,2}', '"not a zone"'), 4) is not false then
    raise exception 'venue_layouts: a non object zone must be refused';
  end if;

  -- ---- 4. The audit function is the reviewed one, read back stored -----
  if not exists (select 1 from pg_trigger t
                 where t.tgname = 'audit_venue_layouts' and t.tgrelid = 'public.venue_layouts'::regclass
                   and t.tgfoid = to_regprocedure('public.audit_venue_layouts()')
                   and t.tgtype & 1 = 1                       -- for each row
                   and t.tgtype & 2 = 0                       -- after, not before
                   and t.tgtype & 4 = 4 and t.tgtype & 8 = 8 and t.tgtype & 16 = 16) then  -- insert, delete, update
    raise exception 'venue_layouts: the audit trigger is missing or not AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW';
  end if;
  if not exists (select 1 from pg_proc p
                 where p.oid = to_regprocedure('public.audit_venue_layouts()')
                   and p.prosecdef
                   and p.proconfig @> array['search_path=' || chr(34) || chr(34)]) then
    raise exception 'venue_layouts: audit_venue_layouts() must be SECURITY DEFINER with an empty search_path';
  end if;
  if has_function_privilege('anon', to_regprocedure('public.audit_venue_layouts()'), 'EXECUTE')
     or has_function_privilege('authenticated', to_regprocedure('public.audit_venue_layouts()'), 'EXECUTE') then
    raise exception 'venue_layouts: EXECUTE on audit_venue_layouts() must be revoked from anon and authenticated';
  end if;
  v_src := pg_get_functiondef(to_regprocedure('public.audit_venue_layouts()'));
  -- The executable half only: strip comment lines, so a word in prose
  -- cannot satisfy a check about code.
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  foreach v_after in array array['venue_layout.created', 'venue_layout.updated', 'venue_layout.deleted'] loop
    if position('''' || v_after || '''' in v_src) = 0 then
      raise exception 'venue_layouts: audit_venue_layouts() must write %', v_after;
    end if;
  end loop;
  -- One writer call, naming the entity type and passing the field names
  -- through the nullif that keeps an empty list out of the row.
  select count(*) into n from regexp_matches(v_src, 'perform public\.audit_domain_event\(', 'g');
  if n <> 1 then
    raise exception 'venue_layouts: audit_venue_layouts() must call audit_domain_event exactly once (found %)', n;
  end if;
  if v_src !~ 'audit_domain_event\(v_club, auth\.uid\(\), v_action, ''venue_layout'', v_id, null, nullif\(v_changed, ''\{\}''\)\)' then
    raise exception 'venue_layouts: the writer call is not the reviewed one';
  end if;
  -- Every field the allow list carries, and nothing that is not a name:
  -- each array_append takes a string literal, and the count of appends is
  -- the count of literal appends.
  foreach v_after in array array['zones', 'venue_id', 'season_id', 'age_group', 'kind', 'slots'] loop
    if position('array_append(v_changed, ''' || v_after || ''')' in v_src) = 0 then
      raise exception 'venue_layouts: audit_venue_layouts() must name % on its allow list', v_after;
    end if;
  end loop;
  select count(*) into n from regexp_matches(v_src, 'array_append\(', 'g');
  if n <> 6 then
    raise exception 'venue_layouts: expected six allow list entries (found % array_append calls)', n;
  end if;
  select count(*) into n from regexp_matches(v_src, 'array_append\(v_changed, ''[a-z_]+''\)', 'g');
  if n <> 6 then
    raise exception 'venue_layouts: every array_append must carry a field name literal (found % of 6)', n;
  end if;
  if v_src ~ '\ysafe_changes\y' or v_src ~ '\ymetadata\y' then
    raise exception 'venue_layouts: audit_venue_layouts() must never touch safe_changes or metadata';
  end if;
  if v_src !~ 'if array_length\(v_changed, 1\) is null then return new; end if;' then
    raise exception 'venue_layouts: a write that changes no allow listed field must write nothing';
  end if;

  -- ---- 5. THE RULES BITE, AND ONLY WHERE THEY SHOULD, proved by running -
  --         them. Synthetic rows inside a subtransaction that is ALWAYS
  --         rolled back: the block ends by raising a private SQLSTATE,
  --         which the handler swallows. Step 6 checks that rather than
  --         trusting it. auth.uid() is null during an apply, so every
  --         event below carries no actor and the database_trigger source;
  --         the assertions are on action, entity and field names, which
  --         do not depend on who.
  begin
    insert into public.clubs (name) values ('0053 probe club') returning id into v_club;
    insert into public.venues (club_id, name) values (v_club, '0053 probe venue') returning id into v_venue;
    -- A non current season, so the seasons guard (0031) is not what
    -- refuses its deletion below: the foreign key must be.
    insert into public.seasons (club_id, name, starts_on, ends_on, is_current)
      values (v_club, '0053 probe', date '2031-07-01', date '2032-06-30', false)
      returning id into v_season;

    -- The club list is writable and readable in the shape the admin
    -- screen sends.
    update public.clubs set age_groups = array['U7s', 'U8s'] where id = v_club;
    if (select age_groups from public.clubs where id = v_club) <> array['U7s', 'U8s'] then
      raise exception 'venue_layouts: the club list did not read back as written';
    end if;
    begin
      update public.clubs set age_groups = array['U8s', 'U8s'] where id = v_club;
      raise exception 'venue_layouts: a duplicate age group was accepted on the row';
    exception
      when check_violation then
        if sqlerrm not like '%clubs_age_groups_valid%' then
          raise exception 'venue_layouts: the duplicate was refused by something other than clubs_age_groups_valid: %', sqlerrm;
        end if;
    end;

    -- The four layouts of one scope.
    insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
      values (v_club, v_venue, v_season, 'U8s', 'stations', 4, v_four) returning id into v_l4;
    insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
      values (v_club, v_venue, v_season, 'U8s', 'stations', 5, v_five) returning id into v_l5;
    insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
      values (v_club, v_venue, v_season, 'U8s', 'games', 1, v_one) returning id into v_g1;
    insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
      values (v_club, v_venue, v_season, 'U8s', 'games', 2, v_two) returning id into v_g2;
    -- A second age group at the same venue gets its own rows and does not
    -- collide with the first's.
    insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
      values (v_club, v_venue, v_season, 'U7s', 'stations', 4, v_four) returning id into v_other;

    -- One layout per kind and slots per scope, refused by name.
    begin
      insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
        values (v_club, v_venue, v_season, 'U8s', 'stations', 4, v_four);
      raise exception 'venue_layouts: a second four station layout in one scope was accepted';
    exception
      when unique_violation then
        if sqlerrm not like '%venue_layouts_scope_unique%' then
          raise exception 'venue_layouts: the duplicate was refused by something other than venue_layouts_scope_unique: %', sqlerrm;
        end if;
    end;
    -- Three stations and three games are not storable.
    begin
      insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
        values (v_club, v_venue, v_season, 'U8s', 'stations', 3,
                '{"version":1,"zones":[{"n":1,"x":0,"y":0,"w":0.3,"h":1},{"n":2,"x":0.35,"y":0,"w":0.3,"h":1},{"n":3,"x":0.7,"y":0,"w":0.3,"h":1}]}');
      raise exception 'venue_layouts: a three station layout was accepted';
    exception
      when check_violation then
        if sqlerrm not like '%venue_layouts_slots_valid%' then
          raise exception 'venue_layouts: three stations were refused by something other than venue_layouts_slots_valid: %', sqlerrm;
        end if;
    end;
    begin
      insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
        values (v_club, v_venue, v_season, 'U8s', 'games', 3,
                '{"version":1,"zones":[{"n":1,"x":0,"y":0,"w":0.3,"h":1},{"n":2,"x":0.35,"y":0,"w":0.3,"h":1},{"n":3,"x":0.7,"y":0,"w":0.3,"h":1}]}');
      raise exception 'venue_layouts: a three game layout was accepted';
    exception
      when check_violation then
        if sqlerrm not like '%venue_layouts_slots_valid%' then
          raise exception 'venue_layouts: three games were refused by something other than venue_layouts_slots_valid: %', sqlerrm;
        end if;
    end;
    -- The pair, on a real row: four zones under slots = 5.
    begin
      update public.venue_layouts set zones = v_four where id = v_l5;
      raise exception 'venue_layouts: four zones were accepted on the five station row';
    exception
      when check_violation then
        if sqlerrm not like '%venue_layouts_zones_shape%' then
          raise exception 'venue_layouts: the pair was refused by something other than venue_layouts_zones_shape: %', sqlerrm;
        end if;
    end;
    -- A location shaped key, on a real row, from the apply's own
    -- privileges, which are wider than any client's.
    begin
      update public.venue_layouts set zones = v_one || '{"lat":53.68,"lng":-1.58}' where id = v_g1;
      raise exception 'venue_layouts: a coordinate pair was accepted on a row';
    exception
      when check_violation then
        if sqlerrm not like '%venue_layouts_zones_shape%' then
          raise exception 'venue_layouts: the coordinate pair was refused by something other than venue_layouts_zones_shape: %', sqlerrm;
        end if;
    end;
    -- The scope key's own bound.
    begin
      insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
        values (v_club, v_venue, v_season, ' U8s', 'games', 1, v_one);
      raise exception 'venue_layouts: an untrimmed age group was accepted';
    exception
      when check_violation then
        if sqlerrm not like '%venue_layouts_age_group_bounded%' then
          raise exception 'venue_layouts: the untrimmed age group was refused by something other than venue_layouts_age_group_bounded: %', sqlerrm;
        end if;
    end;
    -- A venue of another club cannot be referenced: the composite key
    -- carries the club.
    begin
      insert into public.venue_layouts (club_id, venue_id, season_id, age_group, kind, slots, zones)
        values ((select id from public.clubs where id <> v_club order by id limit 1), v_venue, v_season, 'U8s', 'games', 1, v_one);
      raise exception 'venue_layouts: a layout was filed under another club against this venue';
    exception
      when foreign_key_violation then null;
      when not_null_violation then null;   -- a database holding one club has no other id to try
    end;

    -- THE AUDIT TRAIL IS THE ALLOW LIST AND NOTHING MORE.
    select count(*) into n from public.audit_events
     where entity_type = 'venue_layout' and action = 'venue_layout.created'
       and entity_id in (v_l4, v_l5, v_g1, v_g2, v_other) and changed_fields is null and team_id is null;
    if n <> 5 then
      raise exception 'venue_layouts: five creations must leave five venue_layout.created events (got %)', n;
    end if;
    update public.venue_layouts set zones = jsonb_set(v_one, '{zones,0,x}', '0.15') where id = v_g1;
    update public.venue_layouts set zones = jsonb_set(v_one, '{zones,0,x}', '0.15') where id = v_g1;  -- same value: no change, no event
    update public.venue_layouts set age_group = 'U7s', zones = jsonb_set(v_two, '{zones,0,x}', '0.05') where id = v_g2;
    select count(*) into n from public.audit_events
     where entity_id = v_g1 and action = 'venue_layout.updated' and changed_fields = array['zones']
       and safe_changes is null and metadata is null and entity_type = 'venue_layout';
    if n <> 1 then
      raise exception 'venue_layouts: a redraw must leave exactly one venue_layout.updated naming zones (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id = v_g2 and action = 'venue_layout.updated' and changed_fields = array['zones', 'age_group'];
    if n <> 1 then
      raise exception 'venue_layouts: a refiled redraw must name zones and age_group, in allow list order (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_type = 'venue_layout' and (safe_changes is not null or metadata is not null);
    if n <> 0 then
      raise exception 'venue_layouts: no layout event may carry a value (% did)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_type = 'venue_layout' and source <> 'database_trigger';
    if n <> 0 then
      raise exception 'venue_layouts: an event written with no actor must carry the database_trigger source (% did not)', n;
    end if;

    -- A season with layouts is not removable; a removed venue takes its
    -- layouts with it and records each.
    begin
      delete from public.seasons where id = v_season;
      raise exception 'venue_layouts: a season holding layouts was deleted';
    exception
      when foreign_key_violation then
        if sqlerrm not like '%venue_layouts_season_fk%' then
          raise exception 'venue_layouts: the season delete was refused by something other than venue_layouts_season_fk: %', sqlerrm;
        end if;
    end;
    delete from public.venues where id = v_venue;
    select count(*) into n from public.venue_layouts where club_id = v_club;
    if n <> 0 then
      raise exception 'venue_layouts: deleting a venue must remove its layouts (% remain)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_type = 'venue_layout' and action = 'venue_layout.deleted'
       and entity_id in (v_l4, v_l5, v_g1, v_g2, v_other);
    if n <> 5 then
      raise exception 'venue_layouts: the cascade must record five venue_layout.deleted events (got %)', n;
    end if;
    -- Once the layouts are gone the season is removable again.
    delete from public.seasons where id = v_season;

    -- Unwind. Nothing this probe did survives.
    raise exception using errcode = 'OTJ53', message = 'venue_layouts: probe complete, rolling back';
  exception
    when sqlstate 'OTJ53' then
      null;
  end;

  -- ---- 6. NOTHING ELSE MOVED, checked against the before fingerprint ----
  if (select count(*) from public.venue_layouts) <> 0 then
    raise exception 'venue_layouts: the table must be empty after the apply';
  end if;
  select count(*) into n from public.clubs where name = '0053 probe club';
  if n <> 0 then
    raise exception 'venue_layouts: the probe club survived the rollback';
  end if;
  select coalesce(md5(string_agg((to_jsonb(c) - 'age_groups')::text, ',' order by c.id)), 'empty')
    into v_after from public.clubs c;
  if v_after is distinct from b.clubs_fingerprint then
    raise exception 'venue_layouts: a club row changed beyond the new column (% -> %)', b.clubs_fingerprint, v_after;
  end if;
  select coalesce(md5(string_agg(to_jsonb(v)::text, ',' order by v.id)), 'empty') into v_after from public.venues v;
  if v_after is distinct from b.venues_fingerprint then
    raise exception 'venue_layouts: a venue row changed (% -> %)', b.venues_fingerprint, v_after;
  end if;
  select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty') into v_after from public.seasons s;
  if v_after is distinct from b.seasons_fingerprint then
    raise exception 'venue_layouts: a season row changed (% -> %)', b.seasons_fingerprint, v_after;
  end if;
  select coalesce(md5(string_agg(coalesce(s.age_group, '{null}'), ',' order by s.id)), 'empty')
    into v_after from public.sessions s;
  if v_after is distinct from b.session_age_groups_fingerprint then
    raise exception 'venue_layouts: a session age group was rewritten (% -> %)', b.session_age_groups_fingerprint, v_after;
  end if;
  select count(*) into n from public.audit_events;
  if n <> b.audit_rows then
    raise exception 'venue_layouts: the migration must write no audit event (% -> %)', b.audit_rows, n;
  end if;
  select coalesce(md5(string_agg(c.key || ':' || coalesce(c.description, ''), ',' order by c.key)), 'empty')
    into v_after from public.capabilities c;
  if v_after is distinct from b.capabilities_fingerprint then
    raise exception 'venue_layouts: the capability catalogue changed';
  end if;
  select coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ',' order by p.tablename, p.policyname), '')
    into v_after from pg_policies p where p.schemaname = 'public' and p.tablename in ('clubs', 'venues', 'seasons');
  if v_after is distinct from b.policies then
    raise exception 'venue_layouts: a policy on clubs, venues or seasons changed';
  end if;
  select coalesce(string_agg(g.grantee || ':' || g.table_name || ':' || g.privilege_type, ',' order by g.grantee, g.table_name, g.privilege_type), '')
    into v_after
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name in ('clubs', 'venues', 'seasons')
     and g.grantee in ('anon', 'authenticated', 'service_role');
  if v_after is distinct from b.grants then
    raise exception 'venue_layouts: a grant on clubs, venues or seasons changed';
  end if;
  select coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname), '')
    into v_after
    from pg_trigger t
   where t.tgrelid in ('public.clubs'::regclass, 'public.venues'::regclass, 'public.seasons'::regclass)
     and not t.tgisinternal;
  if v_after is distinct from b.triggers then
    raise exception 'venue_layouts: a trigger on clubs, venues or seasons changed';
  end if;
  -- The shape predicates stay callable by every writer, for the reason the
  -- header gives, and the existing audit trigger for venues is untouched.
  if not has_function_privilege('authenticated', to_regprocedure('public.venue_layout_is_valid(jsonb, integer)'), 'EXECUTE') then
    raise exception 'venue_layouts: authenticated must be able to evaluate the shape predicate, or every save becomes 42501';
  end if;
  if to_regprocedure('public.audit_venues()') is null
     or not exists (select 1 from pg_trigger where tgname = 'audit_venues' and tgrelid = 'public.venues'::regclass) then
    raise exception 'venue_layouts: audit_venues must be untouched';
  end if;
end
$$;

commit;
