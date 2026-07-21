-- =====================================================================
-- OTJ Training Hub, migration 0037_audit_rollout: the wider application
-- audit rollout (Registered Players PR 8)
--
-- REVIEW REQUIRED. This file extends the append only audit substrate
-- (0030_audit_foundation) to the wider application: user administration,
-- teams and Spond configuration, and content lifecycle. It attaches
-- AFTER row triggers to security boundary tables (member_roles,
-- role_capabilities, member_teams, teams, spond_groups) and to the
-- content tables (drills, templates, programmes, sessions), and adds one
-- private service role writer for the two user administration events that
-- have no application row of their own (user.invited, user.removed).
-- Migrations are gated. Run by hand via the connector after line by line
-- review, and only once the live ledger is confirmed to have this slot
-- free. Do not auto-merge. The two Edge Function changes that call the new
-- writer (invite-user, remove-user) are deployed separately, from files on
-- disk, verified by byte for byte readback, AFTER this migration applies.
--
-- Numbering: confirmed 0037. Evidence, gathered read only on 2026-07-21:
--   * Files on disk end at 0036_spond_and_renew.sql (gaps at 0003, 0004,
--     0010; 0033_players_legacy_columns.sql is present on disk but is the
--     deliberately unapplied legacy column drop, so its slot is taken).
--   * The live hosted ledger (list_migrations, project uynorsnrvocksgqweucu,
--     read only) ends at 20260720090354 spond_and_renew, and does NOT
--     contain players_legacy_columns: 0033 is merged but intentionally
--     unapplied and MUST remain absent (this migration neither applies nor
--     alters it).
--   * A merged but unapplied migration counts as a taken slot (the delivery
--     plan's standing rule), so 0033 is occupied and the next free number
--     from disk and the ledger together is 0037. Per the standing rule the
--     ledger is the authority and is re-confirmed at apply time.
--
-- WHAT THIS IS. The audit foundation (docs/security/app-audit-boundary.md,
-- docs/adr/ADR-0006-app-audit-events.md) reserved a wider action catalogue
-- for a later phase. This migration realises the PR 8 slice of it, and
-- ONLY that slice:
--   * user administration: user.invited, user.removed (writer, from the
--     Edge Functions); user.role_assigned / user.role_removed (member_roles);
--     user.capability_granted / user.capability_revoked (role_capabilities);
--     user.team_assigned / user.team_removed (member_teams);
--   * teams and Spond configuration: team.created / team.updated /
--     team.deleted (teams); spond.mapping_created / spond.mapping_changed /
--     spond.mapping_removed (spond_groups);
--   * content lifecycle: {drill,template,programme,session}.{created,
--     updated,deleted} (the four content tables).
-- The reserved catalogue records the user.*, team.*, spond.* and content
-- namespaces; this migration realises each namespace with distinct
-- directional actions (assigned vs removed, granted vs revoked, created vs
-- changed vs removed) because the Activity feed distinguishes them ONLY by
-- the action key: the feed never receives metadata (the query selects the
-- safe columns only, 0030) and safe_changes is schema locked to the player
-- domain keys, so distinct actions are the only channel that carries the
-- direction to a name free renderer.
--
-- DELIBERATELY OUT OF SCOPE, per docs/roadmaps/registered-players-delivery-plan.md
-- PR 8 and the task boundary:
--   * media, boards and feedback: no triggers, no actions. They are natural
--     extensions of this same pattern and are added only once their actions
--     join the catalogue, in a later increment.
--   * the roles table lifecycle (a role created or deleted): the reserved
--     catalogue has no role.created / role.deleted action, and PR 8 audits
--     role CAPABILITY grant and revoke and role ASSIGNMENT to members, not
--     the role rows themselves, so no trigger is attached to public.roles.
--   * spond.sync_completed: the catalogue reserves it, but the spond-sync
--     Edge Function writes spond_events directly through the caller (no DB
--     RPC), so a per run summary event would require changing and deploying
--     spond-sync, which is outside PR 8's Edge Function scope (invite-user
--     and remove-user only) and the no-deploy constraint. Left reserved and
--     unemitted; spond_events is not triggered.
--   * no audit export, no capability catalogue change (the catalogue stays
--     at the twenty keys seeded in 0030), no change to migration 0033, no
--     change to Registered Players import, export, Renew or Spond roster
--     behaviour, and no production data change.
--
-- SAFE FIELD BOUNDARY. Every audited table has an explicit safe allow list.
-- Only field NAMES are ever recorded (in changed_fields); no VALUE from any
-- of these tables enters an event, so no body text, note, title, JSON,
-- token, secret, Spond id, email, filename, media URL or raw row can leak.
-- safe_changes stays NULL for every event this migration writes: the 0030
-- check constraint audit_events_safe_changes_shape restricts safe_changes
-- to the player domain keys, and none of these domains is the player
-- domain. For the role and capability events the single approved safe label
-- (the role KEY, a bounded slug; or the capability KEY, a fixed catalogue
-- key) rides in changed_fields; never a role LABEL or a member/child name,
-- which are free text or personal data. metadata is not written by any
-- trigger here.
--
-- SAME TRANSACTION GUARANTEE. Every trigger is AFTER ROW and commits in the
-- business change's transaction, exactly as 0032's player domain triggers
-- do. A refused write (RLS 42501, a guard P0001, a check 23514) never
-- commits, so it produces no event; a rolled back transaction rolls back
-- its events; and an audit write failure aborts the business write, the
-- deliberate fail closed behaviour of the foundation. One committed
-- business change produces exactly one event (content and team updates emit
-- at most one; membership and capability changes are one row = one change =
-- one event).
--
-- PROVENANCE. Every event's club, actor, actor_name, source and timestamp
-- are derived server side inside the definer functions, never from a client
-- value. Actor is auth.uid(); the source falls back through
-- audit_source_context (0031). A client cannot set the audit GUCs, forge an
-- actor, or reach the writers (append only client access from 0030 is
-- unchanged: authenticated holds SELECT only on audit_events and no write
-- policy exists).
--
-- FOUNDATION SQL CONVENTIONS followed throughout (the 0028 / 0029 / 0030 /
-- 0031 / 0032 form): every new function is SECURITY DEFINER with
-- set search_path = '' and fully schema qualified references; the private
-- helper and the user administration writer have EXECUTE revoked from
-- public, anon and authenticated (service_role kept only where a service
-- caller needs it); and the migration self verifies with a DO block before
-- it commits. One transaction (implicit; the connector wraps the file).
-- =====================================================================

-- ---------------------------------------------------------------------
-- audit_domain_event: the shared internal writer for the non player,
-- non row-less domains this migration audits. It centralises the three
-- things every domain trigger must do identically: skip when the club is
-- gone (a club delete cascade removes the whole tenancy including its audit
-- trail, and the club row is already gone by the time the cascade reaches
-- these tables, so an event would violate the audit_events club foreign
-- key), resolve the actor name snapshot server side, and derive the source.
-- It writes ONLY safe fields: club, actor, action, entity_type, entity_id,
-- an optional team_id, and an optional changed_fields name/label array.
-- safe_changes and metadata are never set here, so no value from an audited
-- row can enter an event. batch_id rides audit_batch_context (null outside a
-- batch RPC, which none of these domains use). It is definer so the
-- triggers, which run as their owner, can insert without any client grant;
-- EXECUTE is revoked from clients because only the definer triggers call it.
-- ---------------------------------------------------------------------
create or replace function public.audit_domain_event(
  p_club          uuid,
  p_actor         uuid,
  p_action        text,
  p_entity_type   text,
  p_entity_id     uuid,
  p_team_id       uuid    default null,
  p_changed_fields text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
begin
  -- No club, or the club is mid cascade delete: skip. The event would
  -- otherwise fail the audit_events.club_id foreign key, and it would
  -- cascade away with the club anyway.
  if p_club is null or not exists (select 1 from public.clubs c where c.id = p_club) then
    return;
  end if;

  if p_actor is not null then
    select pr.full_name into v_actor_name from public.profiles pr where pr.id = p_actor;
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, team_id, source, changed_fields, batch_id
  )
  values (
    p_club, now(), p_actor, v_actor_name, p_action, p_entity_type,
    p_entity_id, p_team_id, public.audit_source_context(p_actor),
    nullif(p_changed_fields, '{}'), public.audit_batch_context()
  );
end;
$$;

comment on function public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[]) is
  $$Internal SECURITY DEFINER writer for the wider application audit domains (users, teams, Spond configuration, content lifecycle; 0037_audit_rollout.sql). Skips when the club is gone (a club delete cascade), resolves the actor name snapshot and the source server side, and writes only safe fields (never safe_changes, never metadata, never a value from the audited row). EXECUTE is revoked from public, anon and authenticated; only the definer domain triggers call it. See docs/security/app-audit-boundary.md.$$;

revoke execute on function public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[]) from public, anon, authenticated;

-- =====================================================================
-- PART 1: user administration audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- log_user_admin_event: the private writer for the two user administration
-- events that have no application row trigger, user.invited and
-- user.removed. Both happen inside the invite-user and remove-user Edge
-- Functions, which act through the service role (so auth.uid() is null in
-- their calls) but have themselves verified the caller's JWT. The function
-- therefore takes the caller (actor) and the caller's club as arguments,
-- both of which the Edge Function derived from the verified request, and
-- validates them: the actor MUST be a profile of the named club, so a
-- forged cross club or non member actor is refused; the actor NAME is
-- resolved from profiles server side and is never taken from an argument.
--
-- This is a SEPARATE writer from log_audit_event (0030) on purpose:
-- log_audit_event derives its actor solely from auth.uid() and exposes no
-- actor parameter, a property pinned by a security test ("actor identity
-- cannot be forged through supplied arguments"). Rather than loosen that
-- writer, the two edge events get their own writer whose actor is validated
-- to be a real member of the stated club. entity_type is 'user' and the
-- entity is the invited or removed member. source is 'edge_function'. No
-- email, token, password, authorization header or raw request body can
-- reach this function: its only text argument is the bounded action.
--
-- EXECUTE is revoked from public, anon and authenticated (the 0028/0030
-- revoke precedent) and granted to service_role only, so a browser hitting
-- /rpc/log_user_admin_event fails on EXECUTE.
-- ---------------------------------------------------------------------
create or replace function public.log_user_admin_event(
  p_action    text,
  p_actor_id  uuid,
  p_club_id   uuid,
  p_entity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_event_id   uuid;
begin
  if p_action not in ('user.invited', 'user.removed') then
    raise exception 'log_user_admin_event: action % is not writable by this writer', p_action;
  end if;
  if p_club_id is null then
    raise exception 'log_user_admin_event: a club is required';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'log_user_admin_event: the named club does not exist';
  end if;
  -- The actor must be a real member of the named club. The Edge Function
  -- passes the caller it verified from the JWT; this is defence in depth so
  -- a forged actor that is not a member of the club is refused, never
  -- silently recorded.
  if p_actor_id is null then
    raise exception 'log_user_admin_event: an actor is required';
  end if;
  select pr.full_name into v_actor_name
  from public.profiles pr
  where pr.id = p_actor_id and pr.club_id = p_club_id;
  if not found then
    raise exception 'log_user_admin_event: the actor is not a member of the named club';
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, source
  )
  values (
    p_club_id, now(), p_actor_id, v_actor_name, p_action, 'user',
    p_entity_id, 'edge_function'
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.log_user_admin_event(text, uuid, uuid, uuid) is
  $$Private SECURITY DEFINER writer for the user.invited and user.removed audit events, called by the invite-user and remove-user Edge Functions after the business operation succeeds. The actor and club are the caller and club the Edge Function verified from the JWT; the actor is validated to be a member of the named club and the actor name is resolved from profiles server side. No email, token, password or raw body is accepted. EXECUTE is revoked from public, anon and authenticated and granted to service_role only. See 0037_audit_rollout.sql and docs/security/app-audit-boundary.md.$$;

revoke execute on function public.log_user_admin_event(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.log_user_admin_event(text, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- member_roles audit (AFTER INSERT OR DELETE). A role assigned to or
-- removed from a member. entity_type 'user', entity_id the member. The
-- single approved safe label, the role KEY (a bounded slug, never the free
-- text role label and never a name), rides in changed_fields.
--
-- Two skips keep one product action to one event:
--   * auth.uid() is null: a service role write. The only service role
--     writers to member_roles are grant_club_membership (the invite grant,
--     recorded once as user.invited by the Edge Function) and the member
--     removal cascade (recorded once as user.removed), plus migration and
--     seed provisioning. None of those wants a per row assignment event, so
--     they are skipped here; the standalone role editor writes as the
--     authenticated admin (auth.uid() non null) and IS audited.
--   * DELETE whose member profile is already gone: a cascade from member
--     removal; user.removed covers it.
-- INSERT and DELETE only: member_roles is a pair table written as insert
-- and delete diffs (no update path), and a role swap that adds one role and
-- removes another is two genuine changes, one assignment event and one
-- removal event, not a duplicate.
-- ---------------------------------------------------------------------
create or replace function public.audit_member_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_member uuid;
  v_role  uuid;
  v_club  uuid;
  v_key   text;
  v_action text;
begin
  if v_actor is null then
    -- Service role / system write (invite grant, removal cascade, seed).
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_member := new.member_id; v_role := new.role_id; v_action := 'user.role_assigned';
  else
    v_member := old.member_id; v_role := old.role_id; v_action := 'user.role_removed';
    if not exists (select 1 from public.profiles p where p.id = v_member) then
      return old;  -- member removal cascade; user.removed covers it
    end if;
  end if;

  select r.club_id, r.key into v_club, v_key from public.roles r where r.id = v_role;

  perform public.audit_domain_event(
    v_club, v_actor, v_action, 'user', v_member, null,
    case when v_key is not null then array[v_key] else null end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_member_roles
  after insert or delete on public.member_roles
  for each row execute function public.audit_member_roles();

-- ---------------------------------------------------------------------
-- role_capabilities audit (AFTER INSERT OR DELETE). A capability granted to
-- or revoked from a role. entity_type 'role', entity_id the role. The
-- capability KEY (a fixed catalogue key, the safest possible label) rides
-- in changed_fields.
--
-- Skips, mirroring member_roles:
--   * auth.uid() is null: seed and migration provisioning of the default
--     grants, not audited.
--   * DELETE whose role is already gone: a cascade from a role deletion
--     (role lifecycle is out of PR 8 scope), so the revoke is not surfaced.
-- The standalone capability editor writes as the authenticated admin and IS
-- audited. Refused writes (the reserved capability guard P0001, or RLS
-- 42501 without users.manage) never commit, so they never reach this AFTER
-- trigger.
-- ---------------------------------------------------------------------
create or replace function public.audit_role_capabilities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role  uuid;
  v_cap   text;
  v_club  uuid;
  v_action text;
begin
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_role := new.role_id; v_cap := new.capability; v_action := 'user.capability_granted';
  else
    v_role := old.role_id; v_cap := old.capability; v_action := 'user.capability_revoked';
  end if;

  select r.club_id into v_club from public.roles r where r.id = v_role;
  if v_club is null then
    -- The role is gone (a role deletion cascade); nothing to attribute.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.audit_domain_event(v_club, v_actor, v_action, 'role', v_role, null, array[v_cap]);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_role_capabilities
  after insert or delete on public.role_capabilities
  for each row execute function public.audit_role_capabilities();

-- ---------------------------------------------------------------------
-- member_teams audit (AFTER INSERT OR DELETE). A member added to or removed
-- from a team's membership. entity_type 'user', entity_id the member,
-- team_id the team (which the renderer resolves to the team name, or
-- "Deleted team" once the team is gone). No safe label is needed beyond the
-- team id, which is already a first class safe id in every event.
--
-- Same two skips as member_roles: service role writes (the invite grant and
-- the removal cascade) and a DELETE whose member profile is already gone.
-- ---------------------------------------------------------------------
create or replace function public.audit_member_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_member uuid;
  v_team  uuid;
  v_club  uuid;
  v_action text;
begin
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_member := new.member_id; v_team := new.team_id; v_action := 'user.team_assigned';
  else
    v_member := old.member_id; v_team := old.team_id; v_action := 'user.team_removed';
    if not exists (select 1 from public.profiles p where p.id = v_member) then
      return old;  -- member removal cascade; user.removed covers it
    end if;
  end if;

  select t.club_id into v_club from public.teams t where t.id = v_team;

  perform public.audit_domain_event(v_club, v_actor, v_action, 'user', v_member, v_team, null);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_member_teams
  after insert or delete on public.member_teams
  for each row execute function public.audit_member_teams();

-- =====================================================================
-- PART 2: teams and Spond configuration audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- teams audit (AFTER INSERT OR UPDATE OR DELETE). entity_type 'team',
-- entity_id and team_id both the team. The safe update allow list is just
-- the team name; only the field NAME is recorded, never the value, so a
-- rename records changed_fields = ['name'] and the renderer reads "Team
-- renamed". A team update that changes nothing on the allow list writes no
-- event. Deleted teams render neutrally ("Deleted team") wherever a later
-- event still references the id; team deletion changes no registered player
-- safety semantics (that boundary lives entirely in the player domain,
-- 0032, and is untouched here).
-- ---------------------------------------------------------------------
create or replace function public.audit_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'team.updated';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_teams
  after insert or update or delete on public.teams
  for each row execute function public.audit_teams();

-- ---------------------------------------------------------------------
-- spond_groups audit (AFTER INSERT OR UPDATE OR DELETE): the Spond team to
-- subgroup mapping. entity_type 'spond_mapping', entity_id the mapping,
-- team_id the mapped team. Actions spond.mapping_created / mapping_changed /
-- mapping_removed. The safe update allow list is the mapping's own
-- configuration FIELD NAMES only (team_id, spond_group_id, spond_subgroup_id,
-- spond_name); no VALUE is ever recorded, so no Spond token, credential, API
-- payload, member id, child or guardian datum, or group response object can
-- enter an event (spond_groups holds none of those anyway; the values that
-- do exist, the Spond ids and subgroup name, are still never written). A
-- mapping update touching nothing on the allow list writes no event.
--
-- Cascade suppression (the same principle the whole rollout follows, matching
-- 0032's audit_registrations): a row DELETED by a parent cascade is covered by
-- the parent's own event and is NOT separately audited. spond_groups.team_id is
-- NOT NULL and ON DELETE CASCADE, so deleting a team cascade-deletes its
-- mapping; that removal is covered by team.deleted, so a DELETE whose team is
-- already gone (a team delete cascade; a standalone mapping removal always has
-- its team, since team_id is NOT NULL) is skipped. The member_roles,
-- role_capabilities and member_teams triggers get the same suppression for free
-- because they derive their club from the parent role or team, which is null
-- once that parent is gone. A SET NULL survivor (a session losing its team) is
-- audited as a normal field change instead, exactly as 0032 records
-- player.team_changed for a surviving registration.
-- ---------------------------------------------------------------------
create or replace function public.audit_spond_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club   uuid;
  v_id     uuid;
  v_team   uuid;
  v_action text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_team := new.team_id; v_action := 'spond.mapping_created';
  elsif tg_op = 'DELETE' then
    -- Skip a team delete cascade (the mapping's team is already gone); the
    -- team.deleted event covers it. A standalone mapping removal keeps its team.
    if not exists (select 1 from public.teams t where t.id = old.team_id) then
      return old;
    end if;
    v_club := old.club_id; v_id := old.id; v_team := old.team_id; v_action := 'spond.mapping_removed';
  else
    v_club := new.club_id; v_id := new.id; v_team := new.team_id;
    if new.team_id is distinct from old.team_id then v_changed := array_append(v_changed, 'team_id'); end if;
    if new.spond_group_id is distinct from old.spond_group_id then v_changed := array_append(v_changed, 'spond_group_id'); end if;
    if new.spond_subgroup_id is distinct from old.spond_subgroup_id then v_changed := array_append(v_changed, 'spond_subgroup_id'); end if;
    if new.spond_name is distinct from old.spond_name then v_changed := array_append(v_changed, 'spond_name'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'spond.mapping_changed';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'spond_mapping', v_id, v_team, nullif(v_changed, '{}'));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_spond_groups
  after insert or update or delete on public.spond_groups
  for each row execute function public.audit_spond_groups();

-- =====================================================================
-- PART 3: content lifecycle audit (drills, templates, programmes, sessions)
--
-- Each content trigger records creation and deletion always, and an update
-- ONLY when a field on that table's explicit safe allow list changed. The
-- allow lists are deliberately narrow and STRUCTURAL: they exclude every
-- free text field (title, name, summary, focus, author, venue, notes,
-- setup notes, space), every text array (points, equipment, tags, ages,
-- easier, harder, intentions), every JSON body (activities), embedded media
-- and source columns (media_id, pdf_media_id, source_url, source_label),
-- and the ephemeral live pointer. Only field NAMES are recorded, never
-- values, so a title or body edit that is not on the allow list produces no
-- event at all, and an allow listed change records only the field name. No
-- content body text, note, embedded media reference, arbitrary JSON or raw
-- row ever enters an event.
--
-- Safe allow lists (structural attributes and entity links only):
--   * drills:     corner, level, duration
--   * templates:  programme_id, programme_week
--   * programmes: weeks
--   * sessions:   team_id, date, status, programme_id, programme_week, board_id
-- =====================================================================

create or replace function public.audit_drills()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'drill.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'drill.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.corner is distinct from old.corner then v_changed := array_append(v_changed, 'corner'); end if;
    if new.level is distinct from old.level then v_changed := array_append(v_changed, 'level'); end if;
    if new.duration is distinct from old.duration then v_changed := array_append(v_changed, 'duration'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'drill.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'drill', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_drills
  after insert or update or delete on public.drills
  for each row execute function public.audit_drills();

create or replace function public.audit_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'template.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'template.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.programme_id is distinct from old.programme_id then v_changed := array_append(v_changed, 'programme_id'); end if;
    if new.programme_week is distinct from old.programme_week then v_changed := array_append(v_changed, 'programme_week'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'template.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'template', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_templates
  after insert or update or delete on public.templates
  for each row execute function public.audit_templates();

create or replace function public.audit_programmes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_id uuid; v_action text; v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'programme.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'programme.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.weeks is distinct from old.weeks then v_changed := array_append(v_changed, 'weeks'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'programme.updated';
  end if;
  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'programme', v_id, null, nullif(v_changed, '{}'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_programmes
  after insert or update or delete on public.programmes
  for each row execute function public.audit_programmes();

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
    if new.board_id is distinct from old.board_id then v_changed := array_append(v_changed, 'board_id'); end if;
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

create trigger audit_sessions
  after insert or update or delete on public.sessions
  for each row execute function public.audit_sessions();

-- =====================================================================
-- Self verification. Aborts the whole migration unless every trigger and
-- function this file is responsible for exists exactly as intended, the two
-- writers are private, and the audit_events append only grants are still
-- SELECT only for authenticated (0030 must remain intact). Strict on both a
-- fresh local reset and the hosted project.
-- =====================================================================
do $$
declare
  expected_triggers constant text[] := array[
    'audit_member_roles', 'audit_role_capabilities', 'audit_member_teams',
    'audit_teams', 'audit_spond_groups',
    'audit_drills', 'audit_templates', 'audit_programmes', 'audit_sessions'
  ];
  t text;
begin
  -- Every domain trigger is attached.
  foreach t in array expected_triggers loop
    if not exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then
      raise exception 'audit rollout: trigger % is not attached', t;
    end if;
  end loop;

  -- The internal helper and the user administration writer exist and are
  -- private (not executable by anon or authenticated).
  if has_function_privilege('anon', 'public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.audit_domain_event(uuid, uuid, text, text, uuid, uuid, text[])', 'EXECUTE') then
    raise exception 'audit rollout: audit_domain_event must not be executable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'public.log_user_admin_event(text, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.log_user_admin_event(text, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'audit rollout: log_user_admin_event must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.log_user_admin_event(text, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'audit rollout: service_role must be able to execute log_user_admin_event';
  end if;

  -- 0030 append only grants are untouched: authenticated keeps SELECT only
  -- on audit_events, no write verb leaked in.
  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.audit_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE') then
    raise exception 'audit rollout: authenticated must still hold SELECT only on audit_events';
  end if;

  -- The capability catalogue is unchanged by this migration (no new keys):
  -- it must still be exactly the twenty keys 0030 left.
  if (select count(*) from public.capabilities) <> 20 then
    raise exception 'audit rollout: the capability catalogue must remain exactly twenty keys';
  end if;
end
$$;
