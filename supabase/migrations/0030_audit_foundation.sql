-- =====================================================================
-- OTJ Training Hub, migration 0030_audit_foundation: the append only
-- audit_events substrate and the registered players capability catalogue
--
-- REVIEW REQUIRED. This file creates the app's first persisted history
-- mechanism and grows the capability catalogue, both security boundary
-- work. Migrations are gated. Run by hand via the connector after line by
-- line review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge. No Edge Function changes accompany this.
--
-- Numbering: confirmed 0030. The files on disk end at
-- 0029_signup_hardening.sql, and the live hosted ledger also ends at
-- signup_hardening (list_migrations, read only, 2026-07-17), so 0030 is
-- the next free slot from both sources. Per the standing rule the ledger
-- is the authority; it agrees with disk here.
--
-- WHAT THIS IS, and what it deliberately is not. This is decision D6 of
-- the Registered Players programme (docs/adr/ADR-0006-app-audit-events.md,
-- docs/security/app-audit-boundary.md): ONE generic, append only,
-- club scoped audit_events table, integrated first with Registered Players
-- and deliberately NOT a player only history table. This migration lays
-- the substrate ONLY:
--   * the table, its append only enforcement and indexes;
--   * the private SECURITY DEFINER writer log_audit_event for events with
--     no row trigger (exports and batch summaries);
--   * the seven new capability catalogue rows and their default grants.
-- It creates NO triggers on players, player_registrations or seasons (those
-- tables do not exist yet; the triggers attach in the PR 2 schema split),
-- so NO player linked audit event is produced by this migration. At this
-- point audit_events holds no child linked data at all.
--
-- CHILD DATA CLASSIFICATION, recorded in the schema. Once the PR 2 triggers
-- attach, a row whose entity_type is 'player' is CHILD LINKED and is
-- pseudonymous child personal data: it carries no name, but it holds a
-- stable player id plus that child's attribute history. This table is
-- designed so a NAME can never enter it (no row snapshots; safe_changes is
-- an explicit id and scalar allow list that excludes display_name; the
-- writer validates metadata against a safe allow list). Names are not the
-- only personal data, though: the stable identifier and attribute history
-- are personal data, so retention and erasure of child linked events are a
-- child data decision, addressed in PR 2 onward, not here.
--
-- RETENTION. No automated retention or deletion behaviour is added by this
-- PR, deliberately. Audit retention (recommended default: retain
-- indefinitely at current scale, reviewed annually) remains a product
-- decision to be recorded before child linked events begin in PR 2. This
-- substrate holds no child linked events yet.
--
-- FOUNDATION SQL CONVENTIONS followed throughout (the 0028 and 0029 form):
-- every privileged function is SECURITY DEFINER with set search_path = ''
-- and fully schema qualified references, so no caller controlled search
-- path can redirect a reference; grants are explicit; EXECUTE is revoked
-- from public, anon and authenticated on the private writer and granted to
-- service_role only (the 0028 board_tokens_without_names precedent); and
-- the migration self verifies with a DO block before it commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shape predicate for safe_changes. safe_changes may hold old and new
-- values ONLY for the approved safe field allow list; display_name is
-- deliberately absent, so a name value can never be stored, for any writer
-- including the service role (a check constraint is not RLS). Immutable: it
-- computes on its argument alone, so it is legal in a check constraint.
-- ---------------------------------------------------------------------
create or replace function public.audit_safe_changes_ok(p_safe_changes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_safe_changes is null
    or (
      jsonb_typeof(p_safe_changes) = 'object'
      and not exists (
        select 1
        from jsonb_object_keys(p_safe_changes) as k(key)
        where k.key not in ('team_id', 'status', 'shirt_number', 'registered_date', 'season_id')
      )
    )
$$;

comment on function public.audit_safe_changes_ok(jsonb) is
  $$True when an audit_events.safe_changes value is null or a jsonb object whose keys are all within the approved safe field allow list (team_id, status, shirt_number, registered_date, season_id). display_name is deliberately excluded so no child name value can ever be stored in safe_changes. Backs the audit_events_safe_changes_shape check constraint. See 0030_audit_foundation.sql and docs/security/app-audit-boundary.md.$$;

-- ---------------------------------------------------------------------
-- Metadata predicate, used by the private writer only (NOT a table check,
-- because later phases add trigger written metadata for other domains with
-- their own safe shapes). metadata holds safe scalar facts only: counts,
-- format, outcome, a season id, and the export filter summary (the team id
-- filter, the status set, and a boolean stating whether a name search was
-- applied). No free text, so a child name cannot be smuggled through
-- metadata: keys are allow listed and every text valued key is bounded to a
-- fixed vocabulary. Immutable and argument only, like the shape predicate.
-- ---------------------------------------------------------------------
create or replace function public.audit_metadata_ok(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metadata is null
    or (
      jsonb_typeof(p_metadata) = 'object'
      and not exists (
        select 1
        from jsonb_each(p_metadata) as e(key, value)
        where
          e.key not in (
            'rows_received', 'added', 'updated', 'resolved_new', 'skipped',
            'invalid', 'record_count', 'format', 'outcome', 'season_id',
            'team_id_filter', 'status_filter', 'name_search_applied'
          )
          or not (
            case e.key
              when 'format' then e.value in ('"csv"'::jsonb, '"xlsx"'::jsonb)
              when 'outcome' then e.value in ('"succeeded"'::jsonb, '"failed"'::jsonb)
              when 'name_search_applied' then jsonb_typeof(e.value) = 'boolean'
              when 'status_filter' then
                jsonb_typeof(e.value) = 'array'
                and not exists (
                  select 1 from jsonb_array_elements(e.value) as s(v)
                  where s.v not in ('"pending"'::jsonb, '"registered"'::jsonb, '"withdrawn"'::jsonb)
                )
              when 'season_id' then
                jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              when 'team_id_filter' then
                jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              else jsonb_typeof(e.value) = 'number'
            end
          )
      )
    )
$$;

comment on function public.audit_metadata_ok(jsonb) is
  $$True when an audit_events.metadata value is null or a jsonb object carrying only safe scalar facts (counts as numbers; format in csv/xlsx; outcome in succeeded/failed; season_id and team_id_filter as uuid strings; status_filter as an array of status words; name_search_applied as a boolean). No free text is admitted, so a child name cannot enter metadata. Enforced by the private writer log_audit_event, not by a table check. See 0030_audit_foundation.sql and docs/security/app-audit-boundary.md.$$;

-- ---------------------------------------------------------------------
-- audit_events: one generic, append only, club scoped activity log. It
-- records committed business actions (who, what, when, where from, against
-- which entity) plus bounded field history for the safe field allow list.
-- It NEVER stores complete row snapshots, and NEVER stores a child name in
-- any column. Field derivation rules are in docs/security/app-audit-boundary.md;
-- every field except metadata, request_id and the entity/season/team ids is
-- server derived by a writer, never taken from a client.
-- ---------------------------------------------------------------------
create table public.audit_events (
  id             uuid primary key default gen_random_uuid(),
  -- Stamped server side from the affected row or the actor's own club,
  -- never from a client. Cascades with the tenancy, matching every club
  -- scoped table since 0001.
  club_id        uuid not null references public.clubs (id) on delete cascade,
  -- Server derived now(); never a parameter, never client supplied.
  occurred_at    timestamptz not null default now(),
  -- auth.uid() read server side. Null for system events and after the
  -- actor's profile is deleted; the actor_name snapshot keeps the record
  -- legible.
  actor_id       uuid references public.profiles (id) on delete set null,
  -- A snapshot resolved from profiles at write time; survives profile
  -- deletion (adult operational data, retained for accountability).
  actor_name     text,
  -- From the writer's action catalogue. No check list on the column: the
  -- writers (this migration's log_audit_event, and the PR 2 triggers) are
  -- the only insert paths, and they validate the action against their own
  -- allow lists, so a check would force a migration per new action for no
  -- boundary gain (docs/adr/ADR-0006-app-audit-events.md).
  action         text not null,
  -- player, season, import_batch or export. Registration changes surface
  -- as player events, so player_registration is not an entity type.
  entity_type    text not null,
  -- The stable entity id (players.id, seasons.id, or a batch id). No FK by
  -- design: the id is an immutable historical fact resolved at read time
  -- and degraded to a neutral label when the row no longer exists.
  entity_id      uuid,
  season_id      uuid,
  team_id        uuid,
  -- The provenance channel. The check is the only vocabulary gate; a
  -- mislabelled write fails the check and aborts the whole transaction.
  source         text not null,
  -- Field names only, never values; the only place a name like field
  -- (display_name) is ever referenced, and only by name.
  changed_fields text[],
  -- Old and new values for the approved safe field allow list only. The
  -- check constraint below refuses any other key, display_name included,
  -- for every writer.
  safe_changes   jsonb,
  -- Links row level events to an import or renewal batch. No FK.
  batch_id       uuid,
  -- Safe scalar facts only (counts, format, filter summary). The private
  -- writer validates it against audit_metadata_ok; trigger written metadata
  -- in later phases carries its own safe shapes.
  metadata       jsonb,
  -- An opaque correlation id populated only by server side writers. No
  -- access decision reads it and it is never trusted as identity.
  request_id     text,
  constraint audit_events_source_check
    check (source in (
      'manual', 'csv_import', 'xlsx_import', 'spond_import',
      'renewal', 'system', 'edge_function', 'database_trigger'
    )),
  constraint audit_events_safe_changes_shape
    check (public.audit_safe_changes_ok(safe_changes)),
  constraint audit_events_metadata_is_object
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

comment on table public.audit_events is
  $$Generic, append only, club scoped activity and audit log (0030_audit_foundation.sql). Records committed business actions plus bounded field history for a safe allow list; never row snapshots and never a child name. Authenticated clients hold SELECT only (append only by grant), gated by the audit_events_select_view policy to club_id = my_club() and has_perm('audit.view'). Written only by the private SECURITY DEFINER writer log_audit_event and, from PR 2, by AFTER row triggers on the player domain. A row whose entity_type is 'player' is pseudonymous child personal data even though it holds no name. See docs/adr/ADR-0006-app-audit-events.md and docs/security/app-audit-boundary.md.$$;

comment on column public.audit_events.safe_changes is
  $$Old and new values for the approved safe field allow list ONLY: team_id, status, shirt_number, registered_date, season_id. display_name is excluded, so no child name value is ever stored here; a display name change records changed_fields = ['display_name'] with no value. Enforced by the audit_events_safe_changes_shape check constraint for every writer. See 0030_audit_foundation.sql.$$;

-- ---------------------------------------------------------------------
-- Indexes: the Activity feed, the per player history read, and the batch
-- lookup (docs/security/app-audit-boundary.md). Activity reads are server
-- paginated; the client never downloads the whole history.
-- ---------------------------------------------------------------------
create index audit_events_club_occurred_idx
  on public.audit_events (club_id, occurred_at desc);
create index audit_events_club_entity_idx
  on public.audit_events (club_id, entity_type, entity_id, occurred_at desc);
create index audit_events_batch_idx
  on public.audit_events (batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------
-- Grants: SELECT only to authenticated, extending the standing rule of no
-- write grant without a write policy (0015) to all three write verbs. anon
-- receives nothing. The private writer below is the only sanctioned write
-- path; service_role keeps its own grants for that path.
--
-- Revoke everything first, then grant back SELECT alone, so authenticated
-- ends with EXACTLY SELECT and anon with nothing, whatever the platform's
-- default privileges granted on the freshly created table (a local stack
-- auto grants ALL, including INSERT, UPDATE, DELETE and TRUNCATE; the hosted
-- project does not auto grant new tables, the 0012 lesson, so the revoke is
-- a no-op there). Revoking only the row write verbs is not enough: TRUNCATE
-- would still let a client empty the table. This migration self verifies the
-- SELECT only end state below.
-- ---------------------------------------------------------------------
revoke all on public.audit_events from authenticated, anon;
grant select on public.audit_events to authenticated;

-- ---------------------------------------------------------------------
-- Row level security: enabled, one select policy, and NO insert, update or
-- delete policy for any client role, ever. A browser cannot write an event
-- through any request shape: the missing grants refuse before RLS is even
-- consulted, and no policy would admit the write anyway.
-- ---------------------------------------------------------------------
alter table public.audit_events enable row level security;

create policy "audit_events_select_view" on public.audit_events
  for select using (
    club_id = public.my_club() and public.has_perm('audit.view')
  );
-- No insert, update or delete policies on audit_events. This is deliberate
-- and permanent for authenticated clients; the append only property is by
-- construction.

-- ---------------------------------------------------------------------
-- log_audit_event: the private writer for events with no row trigger
-- (players.exported, players.import_completed, players.import_failed,
-- players.spond_imported). It is NOT a client callable RPC: EXECUTE is
-- revoked from public, anon and authenticated below and granted to
-- service_role only. Legitimate callers are the future export, import and
-- Spond commit definer RPCs (which run as this function's owner and so
-- retain EXECUTE) and the service role for system events.
--
-- Everything that authorises or identifies is derived server side and
-- cannot be supplied by a caller:
--   * actor_id  = auth.uid() (null for a service role system caller);
--   * actor_name = the actor's profiles.full_name at write time;
--   * club_id   = my_club() for a signed in caller, so a supplied club is
--     IGNORED when a session exists; only a service role system caller (no
--     session) provides the club, and it is validated to exist;
--   * occurred_at = now().
-- The action, entity_type, source and metadata arguments are validated
-- against explicit allow lists, so the writer can emit only its sanctioned
-- events and metadata can carry no free text. No in body role guard is
-- added (unlike grant_club_membership): the function must serve definer
-- RPCs acting for signed in users, so the revoke is the boundary, proven by
-- a security test that the direct client call fails.
-- ---------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action      text,
  p_entity_type text,
  p_source      text,
  p_entity_id   uuid  default null,
  p_season_id   uuid  default null,
  p_team_id     uuid  default null,
  p_batch_id    uuid  default null,
  p_metadata    jsonb default null,
  p_request_id  text  default null,
  p_club_id     uuid  default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_club       uuid;
  v_actor_name text;
  v_event_id   uuid;
begin
  -- Action allow list: the writer emits only the non row events. Player and
  -- season row events come from the PR 2 AFTER row triggers, never here.
  if p_action not in (
    'players.exported', 'players.import_completed',
    'players.import_failed', 'players.spond_imported'
  ) then
    raise exception 'log_audit_event: action % is not writable by the writer', p_action;
  end if;

  -- Entity type allow list for the writer's events.
  if p_entity_type not in ('export', 'import_batch') then
    raise exception 'log_audit_event: entity_type % is not writable by the writer', p_entity_type;
  end if;

  -- Source allow list for the writer's events (a subset of the column's
  -- vocabulary; renewal and database_trigger are trigger domain).
  if p_source not in ('manual', 'csv_import', 'xlsx_import', 'spond_import', 'system', 'edge_function') then
    raise exception 'log_audit_event: source % is not permitted for the writer', p_source;
  end if;

  -- Metadata allow list: safe scalar facts only, never names or free text.
  if not public.audit_metadata_ok(p_metadata) then
    raise exception 'log_audit_event: metadata carries a value outside the safe allow list';
  end if;

  -- Actor, actor name, club and timestamp are derived server side. A signed
  -- in caller (reached through a trusted definer RPC) stamps their own uid
  -- and club, so a supplied p_club_id is ignored. A service role system
  -- caller has no session, so the club must be named and is validated.
  if v_actor is not null then
    v_club := public.my_club();
    if v_club is null then
      raise exception 'log_audit_event: the acting member has no club';
    end if;
    select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;
  else
    v_club := p_club_id;
    if v_club is null then
      raise exception 'log_audit_event: a system event must name its club';
    end if;
    if not exists (select 1 from public.clubs c where c.id = v_club) then
      raise exception 'log_audit_event: the named club does not exist';
    end if;
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, season_id, team_id, source, batch_id, metadata, request_id
  )
  values (
    v_club, now(), v_actor, v_actor_name, p_action, p_entity_type,
    p_entity_id, p_season_id, p_team_id, p_source, p_batch_id, p_metadata, p_request_id
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid) is
  $$Private SECURITY DEFINER writer for audit events that have no row trigger (exports and batch summaries). actor, actor_name, club and occurred_at are derived server side and cannot be supplied; action, entity_type, source and metadata are validated against explicit allow lists. EXECUTE is revoked from public, anon and authenticated (0028 revoke precedent) and granted to service_role only; legitimate callers are the export, import and Spond commit definer RPCs and the service role for system events. See 0030_audit_foundation.sql and docs/security/app-audit-boundary.md.$$;

-- Not callable by any application client: PostgREST exposes public functions
-- as RPC to anon and authenticated, so those grants (and the PUBLIC default)
-- are revoked. service_role keeps EXECUTE for system events; definer RPCs
-- retain it as the function owner.
revoke execute on function public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- The capability catalogue grows from thirteen to twenty. Seven new keys
-- for Registered Players and seasons. Keys are stable once seeded; labels
-- and descriptions are what the admin tick grid shows. None of the new keys
-- is reserved (users.manage and club.manage remain the only reserved keys,
-- guarded by role_capabilities_guard_reserved from 0015), so all seven are
-- grantable to custom roles.
-- ---------------------------------------------------------------------
insert into public.capabilities (key, label, description) values
  ('players.view',   'View players',   'See the club''s registered players and their season registrations.'),
  ('players.manage', 'Manage players', 'Add, edit, move between teams and withdraw or restore registered players.'),
  ('players.import', 'Import players', 'Import players from a spreadsheet or a Spond squad.'),
  ('players.export', 'Export players', 'Download the registered players list as a spreadsheet.'),
  ('players.delete', 'Delete players', 'Permanently delete a player and every one of their season registrations.'),
  ('seasons.manage', 'Manage seasons', 'Create, activate, archive and unarchive the club''s seasons.'),
  ('audit.view',     'View activity',  'Read the club wide activity and audit log of who changed what and when.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Default grants for the new keys, seeded onto each club's system roles by
-- id (the 0015 model). On the HOSTED project the club and its system roles
-- exist, so these seed the intended matrix. On a fresh LOCAL reset the
-- migrations run before supabase/seed.sql creates the club, so these are a
-- harmless no-op locally and supabase/seed.sql seeds the same matrix for
-- the local demo club. The self verification below tolerates both states.
--
-- The matrix (docs/security/registered-players-boundary.md section 2):
--   admin   : all seven.
--   manager : players.view, players.manage, players.import, players.export,
--             audit.view. NOT players.delete (an admin grants it if wanted),
--             NOT seasons.manage (admin only; activation reshapes the whole
--             club's operational view).
--   coach   : players.view only. Coaches keep club wide READ of the register
--             and receive no other new capability; in particular NOT
--             audit.view, because a coach's need is per player history
--             (a separate players.view gated path, PR 2), not the club wide
--             activity feed, and audit.view would open the whole feed.
--   parent  : none.
-- ---------------------------------------------------------------------
insert into public.role_capabilities (role_id, capability)
select r.id, g.capability
from public.roles r
join (values
  ('admin',   'players.view'),
  ('admin',   'players.manage'),
  ('admin',   'players.import'),
  ('admin',   'players.export'),
  ('admin',   'players.delete'),
  ('admin',   'seasons.manage'),
  ('admin',   'audit.view'),
  ('manager', 'players.view'),
  ('manager', 'players.manage'),
  ('manager', 'players.import'),
  ('manager', 'players.export'),
  ('manager', 'audit.view'),
  ('coach',   'players.view')
) as g(role_key, capability) on g.role_key = r.key
where r.system
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended. The grant assertions are phrased as "no violating
-- row exists", so they are vacuously true on a fresh local reset (no clubs
-- at migration time) and strict on the hosted project (the real club's
-- system roles must match the matrix).
-- ---------------------------------------------------------------------
do $$
declare
  new_keys constant text[] := array[
    'players.view', 'players.manage', 'players.import', 'players.export',
    'players.delete', 'seasons.manage', 'audit.view'
  ];
  manager_keys constant text[] := array[
    'players.view', 'players.manage', 'players.import', 'players.export', 'audit.view'
  ];
  bad integer;
begin
  -- Catalogue: the seven new keys exist and the catalogue is exactly twenty.
  if (select count(*) from public.capabilities where key = any (new_keys)) <> 7 then
    raise exception 'audit foundation: the seven new capability keys are not all seeded';
  end if;
  if (select count(*) from public.capabilities) <> 20 then
    raise exception 'audit foundation: the capability catalogue is not exactly twenty keys';
  end if;

  -- None of the new keys is reserved; the reserved set is unchanged.
  if exists (
    select 1 from public.capabilities where key = any (new_keys) and key in ('users.manage', 'club.manage')
  ) then
    raise exception 'audit foundation: a new key collides with the reserved set';
  end if;

  -- Append only by grant: authenticated holds SELECT and none of the write
  -- verbs on audit_events; anon holds nothing.
  if not has_table_privilege('authenticated', 'public.audit_events', 'SELECT') then
    raise exception 'audit foundation: authenticated is missing SELECT on audit_events';
  end if;
  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.audit_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE') then
    raise exception 'audit foundation: authenticated must hold SELECT only on audit_events (a write or truncate grant leaked)';
  end if;
  if has_table_privilege('anon', 'public.audit_events', 'SELECT')
     or has_table_privilege('anon', 'public.audit_events', 'INSERT')
     or has_table_privilege('anon', 'public.audit_events', 'TRUNCATE') then
    raise exception 'audit foundation: anon must hold no grant on audit_events';
  end if;

  -- The private writer is service_role only.
  if has_function_privilege('anon', 'public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid)', 'EXECUTE') then
    raise exception 'audit foundation: log_audit_event must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.log_audit_event(text, text, text, uuid, uuid, uuid, uuid, jsonb, text, uuid)', 'EXECUTE') then
    raise exception 'audit foundation: service_role must be able to execute log_audit_event';
  end if;

  -- RLS is enabled on audit_events.
  if not (select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass) then
    raise exception 'audit foundation: row level security is not enabled on audit_events';
  end if;

  -- Default grants (strict on hosted, vacuous on a fresh local reset). Each
  -- check counts violating rows, so zero clubs means zero violations.

  -- Every admin system role holds all seven.
  select count(*) into bad
  from public.roles r
  cross join unnest(new_keys) as k(key)
  where r.system and r.key = 'admin'
    and not exists (
      select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = k.key
    );
  if bad > 0 then
    raise exception 'audit foundation: an admin system role is missing a new capability (% gaps)', bad;
  end if;

  -- Every manager system role holds exactly the five, and none of the two
  -- it must not hold.
  select count(*) into bad
  from public.roles r
  cross join unnest(manager_keys) as k(key)
  where r.system and r.key = 'manager'
    and not exists (
      select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = k.key
    );
  if bad > 0 then
    raise exception 'audit foundation: a manager system role is missing an intended capability (% gaps)', bad;
  end if;
  if exists (
    select 1 from public.roles r
    join public.role_capabilities rc on rc.role_id = r.id
    where r.system and r.key = 'manager' and rc.capability in ('players.delete', 'seasons.manage')
  ) then
    raise exception 'audit foundation: a manager system role holds players.delete or seasons.manage, which it must not';
  end if;

  -- Every coach system role holds players.view and none of the other six.
  if exists (
    select 1 from public.roles r
    where r.system and r.key = 'coach'
      and not exists (
        select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = 'players.view'
      )
  ) then
    raise exception 'audit foundation: a coach system role is missing players.view';
  end if;
  if exists (
    select 1 from public.roles r
    join public.role_capabilities rc on rc.role_id = r.id
    where r.system and r.key = 'coach'
      and rc.capability = any (new_keys) and rc.capability <> 'players.view'
  ) then
    raise exception 'audit foundation: a coach system role holds a new capability beyond players.view';
  end if;

  -- No parent system role holds any of the seven.
  if exists (
    select 1 from public.roles r
    join public.role_capabilities rc on rc.role_id = r.id
    where r.system and r.key = 'parent' and rc.capability = any (new_keys)
  ) then
    raise exception 'audit foundation: a parent system role holds a new capability, which it must not';
  end if;
end
$$;
