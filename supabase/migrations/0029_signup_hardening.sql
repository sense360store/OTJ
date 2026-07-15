-- =====================================================================
-- OTJ Training Hub, migration 0029_signup_hardening: client metadata
-- grants nothing
--
-- REVIEW REQUIRED. This file changes the trust boundary between
-- Supabase Auth and the application schema. Migrations are gated. Run
-- by hand via the connector after line by line review, and only once
-- the live ledger is confirmed to have this slot free. Do not
-- auto-merge.
--
-- Numbering: confirmed against the live ledger on 2026-07-15. The
-- ledger ends at board_player_boundary (the 0028 file), so 0029 is the
-- next free slot.
--
-- The problem this closes. handle_new_user (0001) copied club_id and
-- role out of auth.users.raw_user_meta_data into the new profile row.
-- raw_user_meta_data is client controlled twice over: signUp accepts
-- arbitrary metadata from anyone holding the anon key (the anon key
-- ships in the browser bundle by design), and a signed in user can
-- rewrite their own metadata later through auth.updateUser. If public
-- email signup is enabled on the hosted project (its current state is
-- pending confirmation), anyone could therefore create an auth user
-- carrying club_id = <the club's uuid> and role = 'admin' and receive a
-- profile inside the club. member_roles stays empty for such an account,
-- so no write capability follows, but club membership alone grants every
-- club wide select: drills, media
-- rows and media Storage objects (0027 keys object reads on
-- my_club()), templates, programmes, sessions (club wide since 0002),
-- boards, feedback, spond attendance counts, the teams list and every
-- member's profile row. It also passes the feedback insert policy,
-- which requires only club membership. That is a full read compromise
-- of club data, plus the admin display role in the UI; its severity
-- depends on whether public signup is enabled, and this migration
-- removes the metadata trust either way.
--
-- The boundary after this migration. Nothing that authorises anything
-- is ever read from raw_user_meta_data. A new auth user, however
-- created, gets a quarantined profile: club_id null, role 'parent'
-- (the display enum's least privileged value), no member_roles, no
-- member_teams, no team_id. Every club scoped policy already fails
-- closed on a null club (my_club() returns null, and null never
-- equals a club id), so a quarantined account can read nothing,
-- write nothing, and cannot even select its own profile row. Club
-- membership, the display role, role assignments and team assignments
-- are granted only by grant_club_membership() below, which only the
-- service role can execute, and which the invite-user Edge Function
-- calls inside its trusted flow. The full_name display string is the
-- one metadata value still copied, because the invite email carries
-- it; it grants nothing and the invite flow overwrites it
-- authoritatively.
--
-- Compatibility. Existing rows are untouched: every invited member
-- keeps their profile, club, roles and teams, and nothing here edits
-- data. The trigger change affects only auth users created after the
-- apply. The invite-user function must be redeployed immediately after
-- this migration, under a paused-invitations rollout (pause, apply,
-- deploy, verify a real invite, resume). An invite sent in the gap lands
-- quarantined (fails closed) and is repaired by deleting the auth user
-- and re-inviting, never by re-inviting the same email, which returns
-- 409 for a duplicate. See docs/security/auth-membership-boundary.md.
--
-- Rollback. Restore the 0001 trigger body and drop
-- grant_club_membership(). Doing so reopens the metadata hole, so the
-- only sanctioned rollback is forward: fix whatever broke and keep the
-- boundary.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles.role stops defaulting to coach. The default only ever
-- matters for inserts that omit the column; every path in the app
-- names it explicitly, but a privileged default is wrong on principle.
-- ---------------------------------------------------------------------
alter table public.profiles alter column role set default 'parent';

-- ---------------------------------------------------------------------
-- handle_new_user, recreated. The trigger reads no authorisation data
-- from the client controlled metadata: club_id stays null and role is
-- pinned to 'parent' whatever the signup carried. full_name is the one
-- display string copied (the invite email template uses it); it
-- appears in no policy and the invite flow overwrites it. on conflict
-- do nothing keeps the trigger safe against a pre-created profile row
-- (the local seed replays this way).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, club_id, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
    null,
    'parent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- grant_club_membership: the single trusted path that provisions an
-- invited member onto a club. Called by the invite-user Edge Function
-- with the service role after inviteUserByEmail creates the auth user.
-- One transaction covers the profile, the role assignments and the team
-- assignments, so a member is either fully provisioned or left
-- quarantined; there is no partial state.
--
-- This is a provisioning function, not a role editor. It moves a member
-- from quarantined to provisioned, and it is idempotent for a retried
-- invite; it never re-shapes an already-provisioned member. Role and
-- team changes on an existing member go through the user-role editor
-- (member_roles / member_teams under the users.manage policies), never
-- here.
--
-- The display role is derived from the validated role ids, not passed
-- in: the highest precedence system role among them (admin, manager,
-- coach, parent), or coach when only custom roles are assigned. The
-- caller cannot therefore state a display role that disagrees with the
-- assigned roles.
--
-- Fail closed contract, enforced here whatever the caller sends:
--   * the member must already exist as a profile (the invite created
--     it); a missing profile raises.
--   * a member already in a different club is refused, so an invite for
--     club A can never be claimed into club B.
--   * a member already in the target club is accepted only when the
--     requested state (display role, primary team, all-teams flag, the
--     role-id set and the team-id set) exactly matches what the member
--     already holds; that makes a retried invite a safe no-op. Any
--     difference is refused (fail closed) and must go through the user
--     role editor: this closes the privilege-accumulation hole where a
--     second grant would otherwise add roles alongside the existing
--     ones.
--   * every role id must be a role of the target club; every team id and
--     the primary team must be a team of the target club, and the
--     primary team must be one of the assigned teams.
--   * at least one role is required; null role and team arrays are
--     normalised to empty first, so a null role array is refused as
--     empty and a primary team with a null or empty team set is refused.
--   * provisioning replaces the member's role and team sets wholesale
--     (delete then insert), so no stale member_roles or member_teams row
--     from an earlier state stays silently active.
--
-- Execution is reserved to the service role two ways, belt and braces:
--   1. an in-body guard rejects any caller whose JWT role is not
--      service_role (auth.role() reads the verified request claims), so
--      the boundary holds even where a platform blanket grant re-adds
--      EXECUTE to anon and authenticated after a migration, as the local
--      stack does on every reset;
--   2. EXECUTE is revoked from public, anon and authenticated and
--      granted to service_role below, the correct ACL hygiene that holds
--      on the hosted project where no blanket re-grant follows.
-- SECURITY DEFINER so the definer's ownership, not the caller's RLS,
-- performs the writes, matching the other privileged helpers; the guard
-- is what makes SECURITY DEFINER safe against a re-added EXECUTE grant.
-- The search_path is empty and every object is schema qualified, so no
-- caller-set search_path can redirect a reference.
-- ---------------------------------------------------------------------
create or replace function public.grant_club_membership(
  target_member    uuid,
  target_club      uuid,
  role_ids         uuid[],
  primary_team     uuid default null,
  member_team_ids  uuid[] default '{}',
  set_all_teams    boolean default false,
  member_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_club      uuid;
  existing_role      public.role_kind;
  existing_team      uuid;
  existing_all_teams boolean;
  bad_count          int;
  system_keys        text[];
  derived_display    text;
  requested_roles    uuid[];
  current_roles      uuid[];
  requested_teams    uuid[];
  current_teams      uuid[];
begin
  -- Service role only. auth.role() returns the verified JWT role claim
  -- of the caller; the Edge Functions reach this through the service
  -- role key, so they pass, and an anon or authenticated caller that
  -- still holds a re-added EXECUTE grant is refused here.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'grant_club_membership is restricted to the service role';
  end if;

  -- Normalise null arrays to empty before any validation, so a null role
  -- array reads as empty (refused below) and a null team array reads as
  -- no teams (a primary team then has nothing to belong to).
  role_ids := coalesce(role_ids, '{}');
  member_team_ids := coalesce(member_team_ids, '{}');

  if target_member is null or target_club is null then
    raise exception 'grant_club_membership: member and club are required';
  end if;
  if coalesce(array_length(role_ids, 1), 0) = 0 then
    raise exception 'grant_club_membership: at least one role is required';
  end if;

  select p.club_id, p.role, p.team_id, p.all_teams
    into existing_club, existing_role, existing_team, existing_all_teams
  from public.profiles p
  where p.id = target_member;
  if not found then
    raise exception 'grant_club_membership: no profile exists for the member';
  end if;
  if existing_club is not null and existing_club <> target_club then
    raise exception 'grant_club_membership: the member already belongs to a different club';
  end if;

  -- Every role must belong to the target club.
  select count(*) into bad_count
  from unnest(role_ids) as rid
  left join public.roles r on r.id = rid and r.club_id = target_club
  where r.id is null;
  if bad_count > 0 then
    raise exception 'grant_club_membership: every role must belong to the target club';
  end if;

  -- While the all-teams flag is on, specific teams are moot and the
  -- primary stays empty, exactly as invite-user writes it.
  if set_all_teams then
    member_team_ids := '{}';
    primary_team := null;
  end if;
  if coalesce(array_length(member_team_ids, 1), 0) > 0 then
    select count(*) into bad_count
    from unnest(member_team_ids) as tid
    left join public.teams t on t.id = tid and t.club_id = target_club
    where t.id is null;
    if bad_count > 0 then
      raise exception 'grant_club_membership: every team must belong to the target club';
    end if;
  end if;
  if primary_team is not null and not (primary_team = any (member_team_ids)) then
    raise exception 'grant_club_membership: the primary team must be one of the assigned teams';
  end if;

  -- Derive the display role from the validated roles: the highest
  -- precedence system role, or coach when only custom roles are held.
  select array_agg(r.key) into system_keys
  from public.roles r
  where r.id = any (role_ids) and r.system;
  system_keys := coalesce(system_keys, '{}');
  derived_display := case
    when 'admin'   = any (system_keys) then 'admin'
    when 'manager' = any (system_keys) then 'manager'
    when 'coach'   = any (system_keys) then 'coach'
    when 'parent'  = any (system_keys) then 'parent'
    else 'coach'
  end;

  -- Distinct, sorted role and team sets: the requested ones, and the
  -- ones the member already holds. Sorting makes the comparison
  -- order-independent.
  requested_roles := (select array(select distinct x from unnest(role_ids) as x order by x));
  requested_teams := (select array(select distinct x from unnest(member_team_ids) as x order by x));
  current_roles := (select array(select mr.role_id from public.member_roles mr where mr.member_id = target_member order by mr.role_id));
  current_teams := (select array(select mt.team_id from public.member_teams mt where mt.member_id = target_member order by mt.team_id));

  -- An already-provisioned member is only ever a no-op: accept it when
  -- the whole requested state matches, refuse any change. Provisioning
  -- writes happen only on the quarantined (null club) path below.
  if existing_club is not null then
    if existing_role = derived_display::public.role_kind
       and existing_team is not distinct from primary_team
       and existing_all_teams = set_all_teams
       and requested_roles = current_roles
       and requested_teams = current_teams
    then
      return;
    end if;
    raise exception
      'grant_club_membership: the member is already provisioned; change roles or teams through the user role editor';
  end if;

  -- Provisioning path: the member is quarantined (null club). Set the
  -- profile and replace the role and team sets wholesale, so no earlier
  -- assignment survives.
  update public.profiles
  set club_id   = target_club,
      role      = derived_display::public.role_kind,
      full_name = coalesce(nullif(trim(member_full_name), ''), full_name),
      team_id   = primary_team,
      all_teams = set_all_teams
  where id = target_member;

  delete from public.member_roles where member_id = target_member;
  insert into public.member_roles (member_id, role_id)
  select target_member, rid from unnest(role_ids) as rid;

  delete from public.member_teams where member_id = target_member;
  insert into public.member_teams (member_id, team_id)
  select target_member, tid from unnest(member_team_ids) as tid;
end;
$$;

-- Functions are executable by PUBLIC on creation; this one is service
-- role only. The revoke is the boundary; the grant makes it reachable
-- for the Edge Functions' service role client.
revoke execute on function public.grant_club_membership(uuid, uuid, uuid[], uuid, uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.grant_club_membership(uuid, uuid, uuid[], uuid, uuid[], boolean, text) to service_role;
