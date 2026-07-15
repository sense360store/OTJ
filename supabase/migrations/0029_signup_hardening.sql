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
-- rewrite their own metadata later through auth.updateUser. While the
-- hosted project accepts public email signups, anyone could therefore
-- create an auth user carrying club_id = <the club's uuid> and
-- role = 'admin' and receive a profile inside the club. member_roles
-- stays empty for such an account, so no write capability follows, but
-- club membership alone grants every club wide select: drills, media
-- rows and media Storage objects (0027 keys object reads on
-- my_club()), templates, programmes, sessions (club wide since 0002),
-- boards, feedback, spond attendance counts, the teams list and every
-- member's profile row. It also passes the feedback insert policy,
-- which requires only club membership. That is a full read compromise
-- of club data by an unauthenticated stranger, plus the admin display
-- role in the UI.
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
-- apply. The invite-user function must be redeployed together with
-- this migration: until then it still writes club_id and role through
-- invite metadata, which the new trigger ignores, so an invite sent in
-- the window between apply and redeploy would create a quarantined
-- member (fails closed, visible, repaired by re-running the reworked
-- invite or by grant_club_membership from the connector).
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
-- grant_club_membership: the single trusted path onto a club. Called
-- by the invite-user Edge Function with the service role after
-- inviteUserByEmail creates the auth user. One transaction covers the
-- profile update, the role assignments and the team assignments, so a
-- member is either fully provisioned or left quarantined; there is no
-- partial state.
--
-- Fail closed contract, enforced here whatever the caller sends:
--   * the member must already exist as a profile (the invite created
--     it); a missing profile raises.
--   * a member already in a different club is refused, so an invite
--     for club A can never be claimed into club B, and a member can
--     never be moved between clubs through this path.
--   * every role id must be a role of the target club; every team id
--     and the primary team must be a team of the target club, and the
--     primary team must be one of the assigned teams.
--   * at least one role is required; an invite that assigns nothing
--     is meaningless and refused.
--   * re-running with the same arguments converges to the same state
--     (idempotent), so a retried invite repairs a quarantined member
--     instead of erroring or duplicating rows.
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
-- ---------------------------------------------------------------------
create or replace function public.grant_club_membership(
  target_member    uuid,
  target_club      uuid,
  role_ids         uuid[],
  display_role     role_kind,
  primary_team     uuid default null,
  member_team_ids  uuid[] default '{}',
  set_all_teams    boolean default false,
  member_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_club uuid;
  bad_count    int;
begin
  -- Service role only. auth.role() returns the verified JWT role claim
  -- of the caller; the Edge Functions reach this through the service
  -- role key, so they pass, and an anon or authenticated caller that
  -- still holds a re-added EXECUTE grant is refused here.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'grant_club_membership is restricted to the service role';
  end if;

  if target_member is null or target_club is null then
    raise exception 'grant_club_membership: member and club are required';
  end if;
  if role_ids is null or coalesce(array_length(role_ids, 1), 0) = 0 then
    raise exception 'grant_club_membership: at least one role is required';
  end if;

  select p.club_id into current_club
  from public.profiles p
  where p.id = target_member;
  if not found then
    raise exception 'grant_club_membership: no profile exists for the member';
  end if;
  if current_club is not null and current_club <> target_club then
    raise exception 'grant_club_membership: the member already belongs to a different club';
  end if;

  select count(*) into bad_count
  from unnest(role_ids) as rid
  left join public.roles r on r.id = rid and r.club_id = target_club
  where r.id is null;
  if bad_count > 0 then
    raise exception 'grant_club_membership: every role must belong to the target club';
  end if;

  -- While the all teams flag is on, specific teams are moot and the
  -- primary stays empty, exactly as invite-user has always written it.
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

  update public.profiles
  set club_id   = target_club,
      role      = display_role,
      full_name = coalesce(nullif(trim(member_full_name), ''), full_name),
      team_id   = primary_team,
      all_teams = set_all_teams
  where id = target_member;

  insert into public.member_roles (member_id, role_id)
  select target_member, rid from unnest(role_ids) as rid
  on conflict do nothing;

  insert into public.member_teams (member_id, team_id)
  select target_member, tid from unnest(member_team_ids) as tid
  on conflict do nothing;
end;
$$;

-- Functions are executable by PUBLIC on creation; this one is service
-- role only. The revoke is the boundary; the grant makes it reachable
-- for the Edge Functions' service role client.
revoke execute on function public.grant_club_membership(uuid, uuid, uuid[], role_kind, uuid, uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.grant_club_membership(uuid, uuid, uuid[], role_kind, uuid, uuid[], boolean, text) to service_role;
