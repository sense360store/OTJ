-- =====================================================================
-- OTJ Training Hub, migration 0039_public_share_read: the public read path
-- for public drill sharing (Content Sharing PR 2)
--
-- REVIEW REQUIRED. Migrations are gated. This one touches the security
-- boundary (a service role read path an anonymous Edge Function calls, and
-- an extension of the lifecycle RPC). Run by hand via the connector after
-- review. Do not auto-merge. NOT applied to hosted as part of PR 2: the
-- hosted project keeps 0038 until a separate explicit approval, and public
-- sharing stays disabled on every club (clubs.public_sharing_enabled).
--
-- PR 1 (0038_content_sharing.sql) built the rights model, the private share
-- tables, the lifecycle RPC and the downgrade invalidation, and stored a
-- MINIMAL non-public placeholder snapshot because PR 2 owns the real
-- projection. PR 2 needs three additive things on top of that substrate:
--
--   1. The lifecycle RPC must store a real versioned public snapshot,
--      written atomically with its dependency set and audit event. 0038's
--      manage_content_share had no snapshot parameter (it hardcoded the
--      placeholder), so PART 1 drops and recreates it with two appended,
--      defaulted parameters (p_snapshot, p_snapshot_version). A null snapshot
--      keeps the exact PR 1 placeholder behaviour for source kinds PR 2 does
--      not build; a real snapshot is validated (object, public flag, matching
--      kind, matching version, 256 KiB cap) and stored. Every other line of
--      the function is copied verbatim from 0038, so the whole PR 1
--      authorisation, eligibility, one-active-share, idempotency, kill switch
--      and audit contract is unchanged.
--
--   2. read_public_share: the single narrow SECURITY DEFINER read path the
--      anonymous read-content-share Edge Function calls under the service
--      role. It verifies the secret hash, revoked_at, expires_at and the per
--      club kill switch, rejects a placeholder or an unknown snapshot version,
--      re-checks every dependency's current rights as a third safety layer,
--      strips the private media fields, and returns only the safe public
--      snapshot plus the explicit list of eligible stored media paths to sign.
--      It is drill only in PR 2 (a session or programme share, which PR 2
--      never creates, fails closed here too). service_role EXECUTE only.
--
--   3. content_share_expiry_cleanup: the scheduled private cleanup that
--      physically clears the snapshot and dependency rows of a share expired
--      beyond a retention window and emits content_share.expired. Access
--      enforcement itself is at read time (read_public_share compares
--      expires_at); this only clears retained free text after the window.
--      service_role EXECUTE only. The SCHEDULE is not created here (no casual
--      unaudited background job); wiring a daily invocation is a gated deploy
--      step with a named owner (see docs/security/content-sharing-boundary.md).
--
-- Numbering: the highest migration file on disk is 0038_content_sharing, so
-- this is 0039. The file numbers carry development gaps; confirm the next
-- free slot against the live migration ledger before applying, never assume
-- it from the highest file on disk. 0033 remains merged but deliberately
-- unapplied and is untouched here.
--
-- This migration is additive: it drops and recreates one function with a
-- wider signature and adds two new functions. It adds NO client grant, NO
-- policy, NO anon or authenticated access to any table, and does NOT enable
-- the kill switch. The public boundary is the Edge Function/service layer,
-- never direct table access.
-- =====================================================================

-- =====================================================================
-- PART 1: extend manage_content_share to store a real versioned snapshot
-- =====================================================================

-- The snapshot resolver: null keeps the PR 1 non-public placeholder; a real
-- snapshot is validated as a public projection object of the matching kind and
-- version, bounded to 256 KiB, and returned unchanged. immutable and private
-- (no client EXECUTE); called only inside manage_content_share. Defined before
-- the lifecycle RPC that calls it.
create or replace function public.content_share_resolve_snapshot(
  p_snapshot jsonb,
  p_kind     text,
  p_version  integer
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_snapshot is null then
    return jsonb_build_object('snapshotVersion', 1, 'kind', p_kind, 'builder', 'pending', 'public', false);
  end if;
  if jsonb_typeof(p_snapshot) <> 'object'
     or coalesce(p_snapshot->>'public', '') <> 'true'
     or coalesce(p_snapshot->>'kind', '') <> p_kind
     or coalesce(p_version, 0) < 1
     or coalesce(p_snapshot->>'snapshotVersion', '') <> p_version::text then
    raise exception 'content_share_resolve_snapshot: the snapshot is not a valid versioned public projection';
  end if;
  if octet_length(p_snapshot::text) > 262144 then
    raise exception 'content_share_resolve_snapshot: the snapshot exceeds the 256 KiB cap';
  end if;
  return p_snapshot;
end;
$$;

comment on function public.content_share_resolve_snapshot(jsonb, text, integer) is
  $$Resolves the snapshot manage_content_share stores: null yields the PR 1 non-public placeholder; a real snapshot is validated (jsonb object, public flag true, matching kind, matching snapshotVersion, 256 KiB cap) and returned. Private (no client EXECUTE); called only inside manage_content_share. See 0039_public_share_read.sql.$$;

revoke execute on function public.content_share_resolve_snapshot(jsonb, text, integer) from public, anon, authenticated;

-- Drop the 0038 nine-argument signature and recreate with two appended,
-- defaulted parameters. No database object depends on the old signature (the
-- grants are re-issued below; the downgrade triggers call
-- content_share_invalidate_dependents, not this function; the security suite
-- and the Edge Function call by name with named arguments, which resolve to
-- the new signature with the extra parameters defaulted).
drop function if exists public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text);

create or replace function public.manage_content_share(
  p_action          text,
  p_actor_id        uuid,
  p_kind            public.content_share_kind default null,
  p_source_id       uuid        default null,
  p_share_id        uuid        default null,
  p_secret_hash     bytea       default null,
  p_expires_at      timestamptz default null,
  p_no_expiry       boolean     default false,
  p_idempotency_key text        default null,
  p_snapshot        jsonb       default null,
  p_snapshot_version integer    default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_club   uuid;
  v_source_club  uuid;
  v_source_owner uuid;
  v_source_rights public.content_rights;
  v_locked       public.content_rights;
  v_club         uuid;
  v_share        public.content_shares%rowtype;
  v_dep          record;
  v_existing     uuid;
  v_new_id       uuid;
  v_expires      timestamptz;
  v_expiry_state text;
  v_initiator    text;
  v_is_owner     boolean;
  v_snapshot     jsonb;
  v_snapshot_version integer;
  v_reason       text;
begin
  -- Service role only: the trusted caller path. auth.role() reads the
  -- verified JWT role claim and is unaffected by SECURITY DEFINER, so a
  -- browser (anon or authenticated) never reaches the body; the EXECUTE
  -- grant below is the primary boundary and this is defence in depth.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'manage_content_share is restricted to the service role';
  end if;

  if p_action not in ('create', 'refresh', 'rotate', 'revoke') then
    raise exception 'manage_content_share: unknown action %', p_action;
  end if;
  if p_actor_id is null then
    raise exception 'manage_content_share: an actor is required';
  end if;

  -- The actor must be a real member (a profile with a club). A forged or non
  -- member actor is refused here, never silently honoured.
  select p.club_id into v_actor_club from public.profiles p where p.id = p_actor_id;
  if v_actor_club is null then
    raise exception 'manage_content_share: the actor is not a club member';
  end if;

  -- ================= CREATE =================
  if p_action = 'create' then
    if p_kind is null or p_source_id is null then
      raise exception 'manage_content_share: create requires kind and source';
    end if;
    if p_secret_hash is null or octet_length(p_secret_hash) <> 32 then
      raise exception 'manage_content_share: create requires a 32 byte secret hash';
    end if;
    if p_idempotency_key is null then
      raise exception 'manage_content_share: create requires an idempotency key';
    end if;

    -- Resolve the source, its club, owner and rights, locking the source row
    -- FOR SHARE so a concurrent rights downgrade (which takes FOR NO KEY UPDATE)
    -- serialises with this create: either the downgrade waits until this
    -- transaction commits and then its trigger sees and invalidates the new
    -- share, or this read blocks until the downgrade commits and then observes
    -- internal_only and blocks. This closes the create-versus-downgrade race
    -- for the source (the nested items are locked in the aggregate loop below).
    if p_kind = 'drill' then
      select d.club_id, d.created_by, d.rights into v_source_club, v_source_owner, v_source_rights
      from public.drills d where d.id = p_source_id for share;
    elsif p_kind = 'session' then
      select s.club_id, s.coach_id, s.rights into v_source_club, v_source_owner, v_source_rights
      from public.sessions s where s.id = p_source_id for share;
    else
      select p.club_id, p.created_by, p.rights into v_source_club, v_source_owner, v_source_rights
      from public.programmes p where p.id = p_source_id for share;
    end if;
    if v_source_club is null then
      raise exception 'manage_content_share: the source does not exist';
    end if;

    -- No crossing clubs: the actor must belong to the source's club, and the
    -- share's club is derived from the source, never from a client.
    if v_source_club <> v_actor_club then
      raise exception 'manage_content_share: the actor and source are in different clubs';
    end if;
    v_club := v_source_club;

    -- Sharing capability.
    if not public.content_share_actor_has_cap(p_actor_id, 'shares.create') then
      raise exception 'manage_content_share: the actor lacks shares.create';
    end if;

    -- Source capability and ownership: the manage arm shares any club source;
    -- the owner arm shares own content with the source create capability.
    v_is_owner := (v_source_owner is not null and v_source_owner = p_actor_id);
    if not (
      public.content_share_actor_has_cap(p_actor_id, p_kind::text || 's.manage')
      or (v_is_owner and public.content_share_actor_has_cap(p_actor_id, p_kind::text || 's.create'))
    ) then
      raise exception 'manage_content_share: the actor may not share this source';
    end if;

    -- Kill switch: create fails closed while the club has public sharing off.
    if not exists (select 1 from public.clubs c where c.id = v_club and c.public_sharing_enabled) then
      raise exception 'manage_content_share: public sharing is disabled for this club';
    end if;

    -- Idempotency: a repeat with the same key returns the existing ACTIVE row.
    -- A revoked share never matches, so a reused key after revoke does not
    -- resurface a dead share as a successful create.
    select cs.id into v_existing from public.content_shares cs
    where cs.idempotency_key = p_idempotency_key
      and coalesce(cs.session_id, cs.drill_id, cs.programme_id) = p_source_id
      and cs.revoked_at is null;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'action', 'create', 'share_id', v_existing, 'idempotent', true);
    end if;

    -- One active share per source: a second create returns the existing
    -- active row rather than a duplicate.
    if p_kind = 'drill' then
      select cs.id into v_existing from public.content_shares cs where cs.drill_id = p_source_id and cs.revoked_at is null;
    elsif p_kind = 'session' then
      select cs.id into v_existing from public.content_shares cs where cs.session_id = p_source_id and cs.revoked_at is null;
    else
      select cs.id into v_existing from public.content_shares cs where cs.programme_id = p_source_id and cs.revoked_at is null;
    end if;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'action', 'create', 'share_id', v_existing, 'existing', true);
    end if;

    -- Source rights eligibility: the source's own rights must not be
    -- internal_only.
    if v_source_rights = 'internal_only' then
      raise exception 'manage_content_share: the source is internal_only and cannot be shared';
    end if;

    -- Aggregate nested eligibility: fail closed on a missing item or an
    -- internal_only item.
    for v_dep in select * from public.content_share_deps(p_kind, p_source_id, v_club) loop
      if not v_dep.dep_exists then
        raise exception 'manage_content_share: a nested % is missing or cross club; the share is blocked', v_dep.dep_kind;
      end if;
      -- Lock each rights bearing nested row FOR SHARE and re-read its rights
      -- under the lock, so a concurrent downgrade cannot slip an internal_only
      -- item past this check (the TOCTOU the source lock closes for the source).
      -- A board carries no rights and is not locked here.
      v_locked := public.content_share_lock_rights(v_dep.dep_kind, v_dep.dep_id, v_club);
      if v_dep.dep_kind <> 'board' and v_locked is null then
        raise exception 'manage_content_share: a nested % vanished; the share is blocked', v_dep.dep_kind;
      end if;
      if v_locked = 'internal_only' then
        raise exception 'manage_content_share: a nested % is internal_only; the share is blocked', v_dep.dep_kind;
      end if;
    end loop;

    -- Expiry: default 90 days; a coach may shorten but not exceed 90 days and
    -- may not choose never; a shares.manage holder may set any future expiry
    -- or never.
    if p_no_expiry then
      if not public.content_share_actor_has_cap(p_actor_id, 'shares.manage') then
        raise exception 'manage_content_share: a no-expiry share requires shares.manage';
      end if;
      v_expires := null;
      v_expiry_state := 'none';
    elsif p_expires_at is not null then
      if p_expires_at <= now() then
        raise exception 'manage_content_share: expiry must be in the future';
      end if;
      if not public.content_share_actor_has_cap(p_actor_id, 'shares.manage')
         and p_expires_at > now() + interval '90 days' then
        raise exception 'manage_content_share: expiry may not exceed 90 days for this actor';
      end if;
      v_expires := p_expires_at;
      v_expiry_state := 'custom';
    else
      v_expires := now() + interval '90 days';
      v_expiry_state := 'default';
    end if;

    -- The snapshot. PR 2 passes a real versioned public projection built server
    -- side by the trusted Edge Function; a null snapshot falls back to the PR 1
    -- placeholder (kept for source kinds PR 2 does not build). A real snapshot
    -- is validated as a public projection object of the matching kind and
    -- version and bounded to the 256 KiB cap; the read path additionally
    -- refuses any snapshot whose public flag is not true (the placeholder), so
    -- a placeholder is never publicly consumable.
    v_snapshot := public.content_share_resolve_snapshot(p_snapshot, p_kind::text, p_snapshot_version);
    v_snapshot_version := case when p_snapshot is null then 1 else p_snapshot_version end;

    -- The insert is the authoritative one-active-share enforcement: the three
    -- partial unique indexes and the idempotency index reject a duplicate. A
    -- genuinely concurrent second create that passed the pre-checks above loses
    -- the race here; catch the violation and return the winning existing row
    -- rather than a duplicate or an error (fail safe, not fail open).
    begin
      insert into public.content_shares (
        id, club_id, kind, drill_id, session_id, programme_id, token_hash,
        idempotency_key, snapshot_version, snapshot, created_by, updated_by,
        created_at, updated_at, expires_at
      )
      values (
        gen_random_uuid(), v_club, p_kind,
        case when p_kind = 'drill' then p_source_id end,
        case when p_kind = 'session' then p_source_id end,
        case when p_kind = 'programme' then p_source_id end,
        p_secret_hash, p_idempotency_key, v_snapshot_version, v_snapshot, p_actor_id, p_actor_id,
        now(), now(), v_expires
      )
      returning id into v_new_id;
    exception when unique_violation then
      if p_kind = 'drill' then
        select cs.id into v_existing from public.content_shares cs where cs.drill_id = p_source_id and cs.revoked_at is null;
      elsif p_kind = 'session' then
        select cs.id into v_existing from public.content_shares cs where cs.session_id = p_source_id and cs.revoked_at is null;
      else
        select cs.id into v_existing from public.content_shares cs where cs.programme_id = p_source_id and cs.revoked_at is null;
      end if;
      if v_existing is null then
        select cs.id into v_existing from public.content_shares cs
        where cs.idempotency_key = p_idempotency_key
          and coalesce(cs.session_id, cs.drill_id, cs.programme_id) = p_source_id
          and cs.revoked_at is null;
      end if;
      -- If the conflicting active row was revoked in the race window and no
      -- active row remains, fail closed rather than returning a null share id;
      -- the caller retries.
      if v_existing is null then
        raise exception 'manage_content_share: a concurrent create conflict could not be resolved; retry';
      end if;
      return jsonb_build_object('ok', true, 'action', 'create', 'share_id', v_existing, 'existing', true);
    end;

    -- Write the dependency rows for the built snapshot (deduped by the unique
    -- constraint).
    insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id, rights_class_observed)
    select v_new_id, v_club, dep_kind, dep_id, dep_rights
    from public.content_share_deps(p_kind, p_source_id, v_club)
    on conflict (share_id, dependency_kind, dependency_id) do nothing;

    v_initiator := case when v_is_owner then 'owner' else 'manager' end;
    perform public.log_content_share_event(
      'content_share.created', 'edge_function', p_actor_id, v_club, v_new_id,
      jsonb_build_object('source_kind', p_kind::text, 'source_id', p_source_id,
                         'expiry_state', v_expiry_state, 'initiator', v_initiator)
    );

    return jsonb_build_object('ok', true, 'action', 'create', 'share_id', v_new_id, 'status', 'active');
  end if;

  -- ============ REFRESH / ROTATE / REVOKE (share scoped) ============
  if p_share_id is null then
    raise exception 'manage_content_share: % requires a share id', p_action;
  end if;
  select * into v_share from public.content_shares where id = p_share_id;
  if not found then
    raise exception 'manage_content_share: the share does not exist';
  end if;
  -- The actor must belong to the share's club.
  if v_share.club_id <> v_actor_club then
    raise exception 'manage_content_share: the actor and share are in different clubs';
  end if;
  v_club := v_share.club_id;
  v_is_owner := (v_share.created_by is not null and v_share.created_by = p_actor_id);

  -- ================= REVOKE =================
  if p_action = 'revoke' then
    -- Owner with shares.create, or any shares.manage holder. Revoke is
    -- allowed even when the kill switch is off.
    if not (
      (v_is_owner and public.content_share_actor_has_cap(p_actor_id, 'shares.create'))
      or public.content_share_actor_has_cap(p_actor_id, 'shares.manage')
    ) then
      raise exception 'manage_content_share: the actor may not revoke this share';
    end if;
    -- Idempotent: a second revoke is a no-op with no new event, and never
    -- revives the share.
    if v_share.revoked_at is not null then
      return jsonb_build_object('ok', true, 'action', 'revoke', 'share_id', p_share_id, 'status', 'revoked', 'already', true);
    end if;

    update public.content_shares
      set revoked_at = now(), revoked_by = p_actor_id, updated_by = p_actor_id,
          updated_at = now(), snapshot = null
      where id = p_share_id;
    delete from public.content_share_dependencies where share_id = p_share_id;

    v_reason := case when v_is_owner then 'owner_revoke' else 'manager_revoke' end;
    v_initiator := case when v_is_owner then 'owner' else 'manager' end;
    perform public.log_content_share_event(
      'content_share.revoked', 'edge_function', p_actor_id, v_club, p_share_id,
      jsonb_build_object('source_kind', v_share.kind::text,
                         'source_id', coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id),
                         'reason_code', v_reason, 'initiator', v_initiator)
    );
    return jsonb_build_object('ok', true, 'action', 'revoke', 'share_id', p_share_id, 'status', 'revoked');
  end if;

  -- Refresh and rotate are OWNER only (the creator), and never revive a
  -- revoked share. A manager (or source manage holder) is deliberately NOT
  -- allowed to refresh or rotate another creator's share: rotate would
  -- silently kill the owner's live link and hand the new secret to the wrong
  -- person, and refresh republishes the owner's content. A manager who judges
  -- a share unsafe revokes it; the owner then creates a fresh one.
  if v_share.revoked_at is not null then
    raise exception 'manage_content_share: a revoked share cannot be %ed', p_action;
  end if;
  if not (v_is_owner and public.content_share_actor_has_cap(p_actor_id, 'shares.create')) then
    raise exception 'manage_content_share: only the share owner may % this share', p_action;
  end if;
  -- Kill switch: refresh and rotate fail closed while public sharing is off.
  if not exists (select 1 from public.clubs c where c.id = v_club and c.public_sharing_enabled) then
    raise exception 'manage_content_share: public sharing is disabled for this club';
  end if;

  -- ================= ROTATE =================
  if p_action = 'rotate' then
    if p_secret_hash is null or octet_length(p_secret_hash) <> 32 then
      raise exception 'manage_content_share: rotate requires a 32 byte secret hash';
    end if;
    -- One atomic update replaces the hash, so the old secret stops working the
    -- instant the new one starts; the snapshot and dependencies are retained.
    update public.content_shares
      set token_hash = p_secret_hash, rotated_at = now(), updated_by = p_actor_id, updated_at = now()
      where id = p_share_id;
    perform public.log_content_share_event(
      'content_share.rotated', 'edge_function', p_actor_id, v_club, p_share_id,
      jsonb_build_object('source_kind', v_share.kind::text,
                         'source_id', coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id),
                         'initiator', 'owner')
    );
    return jsonb_build_object('ok', true, 'action', 'rotate', 'share_id', p_share_id, 'status', 'active');
  end if;

  -- ================= REFRESH =================
  -- Rebuild the dependency set and re-check aggregate rights from current
  -- content, keeping the same secret. Fails closed if the aggregate is no
  -- longer eligible.
  -- Re-resolve source rights, locking the source FOR SHARE (as create does) so
  -- a concurrent downgrade serialises with this refresh.
  if v_share.kind = 'drill' then
    select d.club_id, d.rights into v_source_club, v_source_rights from public.drills d where d.id = v_share.drill_id for share;
  elsif v_share.kind = 'session' then
    select s.club_id, s.rights into v_source_club, v_source_rights from public.sessions s where s.id = v_share.session_id for share;
  else
    select p.club_id, p.rights into v_source_club, v_source_rights from public.programmes p where p.id = v_share.programme_id for share;
  end if;
  if v_source_club is null then
    raise exception 'manage_content_share: the source no longer exists';
  end if;
  if v_source_rights = 'internal_only' then
    raise exception 'manage_content_share: the source is now internal_only; refresh is blocked';
  end if;
  for v_dep in select * from public.content_share_deps(
      v_share.kind, coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id), v_club) loop
    if not v_dep.dep_exists then
      raise exception 'manage_content_share: a nested % is missing or cross club; refresh is blocked', v_dep.dep_kind;
    end if;
    v_locked := public.content_share_lock_rights(v_dep.dep_kind, v_dep.dep_id, v_club);
    if v_dep.dep_kind <> 'board' and v_locked is null then
      raise exception 'manage_content_share: a nested % vanished; refresh is blocked', v_dep.dep_kind;
    end if;
    if v_locked = 'internal_only' then
      raise exception 'manage_content_share: a nested % is internal_only; refresh is blocked', v_dep.dep_kind;
    end if;
  end loop;

  -- Replace the dependency set atomically and store the rebuilt snapshot.
  -- Recompute expiry: extend a bounded share by 90 days from now, or keep a
  -- never-expiry share as never.
  delete from public.content_share_dependencies where share_id = p_share_id;
  insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id, rights_class_observed)
  select p_share_id, v_club, dep_kind, dep_id, dep_rights
  from public.content_share_deps(v_share.kind, coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id), v_club)
  on conflict (share_id, dependency_kind, dependency_id) do nothing;

  v_snapshot := public.content_share_resolve_snapshot(p_snapshot, v_share.kind::text, p_snapshot_version);
  v_snapshot_version := case when p_snapshot is null then 1 else p_snapshot_version end;
  update public.content_shares
    set snapshot = v_snapshot, snapshot_version = v_snapshot_version, refreshed_at = now(),
        updated_by = p_actor_id, updated_at = now(),
        expires_at = case when v_share.expires_at is not null then now() + interval '90 days' else null end
    where id = p_share_id;

  perform public.log_content_share_event(
    'content_share.refreshed', 'edge_function', p_actor_id, v_club, p_share_id,
    jsonb_build_object('source_kind', v_share.kind::text,
                       'source_id', coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id),
                       'initiator', 'owner')
  );
  return jsonb_build_object('ok', true, 'action', 'refresh', 'share_id', p_share_id, 'status', 'active');
end;
$$;

comment on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer) is
  $$The service role only content share lifecycle RPC (create, refresh, rotate, revoke). Unchanged from 0038 except that create and refresh now store the real versioned public snapshot the trusted Edge Function passes (validated and bounded through content_share_resolve_snapshot), written atomically with the dependency set and audit event; a null snapshot keeps the PR 1 placeholder for source kinds PR 2 does not build. Still the final authority: it gates on the service role, re-validates the passed actor's club membership, sharing capability, source capability, source ownership and source club, enforces one active share per source, idempotent create, the kill switch (create/refresh/rotate fail while off; revoke stays allowed), aggregate rights eligibility (fail closed), and refresh/rotate owner-only. Stores a SHA-256 hash only; never logs or returns a secret, hash or snapshot. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0039_public_share_read.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer) to service_role;

-- =====================================================================
-- PART 2: read_public_share, the narrow anonymous read path
-- =====================================================================

-- read_public_share is the single database read path the anonymous
-- read-content-share Edge Function calls under the service role. It is the
-- only place an anonymous request touches content_shares. It:
--   - looks the share up by id AND the presented SHA-256 secret hash (a keyed
--     lookup: an unknown id and a wrong secret are indistinguishable, both
--     return the neutral unavailable response). The 256 bit secret, the
--     generic response and the Edge Function rate limit make the residual
--     timing signal of a keyed equality negligible (roadmap section 14);
--   - returns the neutral unavailable response for a revoked, expired or
--     kill-switched share, for a placeholder or unknown-version snapshot, and
--     for any source kind other than drill (PR 2 renders drills only), all
--     indistinguishable from each other and from an unknown link;
--   - re-checks every dependency's CURRENT rights as a third safety layer
--     beneath the downgrade trigger and refresh: a nested item now
--     internal_only, or a nested entity now missing, fails the whole share
--     closed. This reads only the rights column and existence of each
--     dependency, never content: all rendered content comes from the stored
--     snapshot;
--   - strips the private media fields (_mid, _path) and the internal markers
--     (builder, public) from the returned snapshot, and returns the explicit
--     list of eligible public_full stored media paths to sign, so the Edge
--     Function signs only those exact paths and never a caller supplied one.
-- SECURITY DEFINER so it reads content_shares (no client grant) as its owner;
-- service_role EXECUTE only, with a defence in depth service role gate in the
-- body. Returns jsonb: {status:'unavailable'} or {status:'ok', snapshot, media}.
create or replace function public.read_public_share(
  p_share_id    uuid,
  p_secret_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share       public.content_shares%rowtype;
  v_dep         record;
  v_signable    uuid[] := '{}';
  v_media_out   jsonb := '[]'::jsonb;
  v_sign        jsonb := '[]'::jsonb;
  v_entry       jsonb;
  v_mid         text;
  v_path        text;
  v_r           public.content_rights;
  v_sp          text;
  v_public      jsonb;
begin
  -- Service role only (defence in depth; the EXECUTE grant is the boundary).
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'read_public_share is restricted to the service role';
  end if;

  if p_share_id is null or p_secret_hash is null or octet_length(p_secret_hash) <> 32 then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Keyed lookup by id and secret hash together: no row for an unknown id or a
  -- wrong secret, both uniformly unavailable.
  select * into v_share from public.content_shares
    where id = p_share_id and token_hash = p_secret_hash;
  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Lifecycle: revoked, expired, kill switch off. All neutral.
  if v_share.revoked_at is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_share.expires_at is not null and v_share.expires_at <= now() then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if not exists (select 1 from public.clubs c where c.id = v_share.club_id and c.public_sharing_enabled) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Snapshot must be a real public projection (never the PR 1 placeholder),
  -- of a known version, and of a kind PR 2 renders (drill only).
  if v_share.snapshot is null
     or coalesce(v_share.snapshot->>'public', '') <> 'true'
     or coalesce(v_share.snapshot->>'snapshotVersion', '') <> '1'
     or v_share.kind <> 'drill' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Third safety layer: every recorded dependency must still exist and be
  -- eligible (rights not internal_only). Reads the rights column and existence
  -- only, never content. Collects the media ids that are currently public_full
  -- and stored, the only ones eligible for signing.
  for v_dep in
    select dependency_kind, dependency_id from public.content_share_dependencies
    where share_id = v_share.id
  loop
    if v_dep.dependency_kind = 'media' then
      select m.rights, m.storage_path into v_r, v_sp
      from public.media m where m.id = v_dep.dependency_id and m.club_id = v_share.club_id;
      if not found or v_r = 'internal_only' then
        return jsonb_build_object('status', 'unavailable');
      end if;
      if v_r = 'public_full' and v_sp is not null then
        v_signable := array_append(v_signable, v_dep.dependency_id);
      end if;
    elsif v_dep.dependency_kind = 'drill' then
      select d.rights into v_r from public.drills d where d.id = v_dep.dependency_id and d.club_id = v_share.club_id;
      if not found or v_r = 'internal_only' then return jsonb_build_object('status', 'unavailable'); end if;
    elsif v_dep.dependency_kind = 'template' then
      select t.rights into v_r from public.templates t where t.id = v_dep.dependency_id and t.club_id = v_share.club_id;
      if not found or v_r = 'internal_only' then return jsonb_build_object('status', 'unavailable'); end if;
    elsif v_dep.dependency_kind = 'programme' then
      select p.rights into v_r from public.programmes p where p.id = v_dep.dependency_id and p.club_id = v_share.club_id;
      if not found or v_r = 'internal_only' then return jsonb_build_object('status', 'unavailable'); end if;
    elsif v_dep.dependency_kind = 'board' then
      if not exists (select 1 from public.boards b where b.id = v_dep.dependency_id and b.club_id = v_share.club_id) then
        return jsonb_build_object('status', 'unavailable');
      end if;
    end if;
  end loop;

  -- Build the public media array (private fields stripped) and the sign list
  -- (ref plus the stored path, for eligible public_full stored media only).
  for v_entry in select value from jsonb_array_elements(coalesce(v_share.snapshot->'media', '[]'::jsonb)) loop
    v_mid  := v_entry->>'_mid';
    v_path := v_entry->>'_path';
    if v_mid is not null and v_path is not null and v_mid::uuid = any(v_signable) then
      v_sign := v_sign || jsonb_build_array(jsonb_build_object('ref', v_entry->>'ref', 'path', v_path));
    end if;
    v_media_out := v_media_out || jsonb_build_array(v_entry - '_mid' - '_path');
  end loop;

  -- Strip the internal markers and replace media with the public array.
  v_public := (v_share.snapshot - 'builder' - 'public');
  v_public := jsonb_set(v_public, '{media}', v_media_out);

  return jsonb_build_object('status', 'ok', 'snapshot', v_public, 'media', v_sign);
end;
$$;

comment on function public.read_public_share(uuid, bytea) is
  $$The single narrow SECURITY DEFINER read path for public shares, called by the anonymous read-content-share Edge Function under the service role. Verifies the secret hash (keyed lookup), revoked_at, expires_at and the per club kill switch, refuses a placeholder or unknown-version snapshot and any non-drill kind (PR 2 renders drills only), re-checks every dependency's current rights and existence (rights column only, never content), and returns only the safe public snapshot (private media fields and internal markers stripped) plus the explicit list of eligible public_full stored media paths to sign. Every failure returns the identical neutral {status:'unavailable'}. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0039_public_share_read.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.read_public_share(uuid, bytea) from public, anon, authenticated;
grant execute on function public.read_public_share(uuid, bytea) to service_role;

-- =====================================================================
-- PART 3: content_share_expiry_cleanup, the scheduled physical clearing
-- =====================================================================

-- Access enforcement is at read time (read_public_share compares expires_at),
-- so this process does NOT gate access; it physically clears the retained
-- snapshot and dependency rows of a share expired beyond a retention window
-- (default seven days), so no free text that evaded the preview persists
-- indefinitely past the share's live life, and emits content_share.expired.
-- During the window an expired share is inaccessible but still stored, so a
-- Refresh can extend it. Idempotent: a share whose snapshot is already null is
-- skipped. service_role EXECUTE only. This migration does NOT create a
-- schedule (no casual unaudited background job); wiring a daily invocation is
-- a gated deploy step with a named owner.
create or replace function public.content_share_expiry_cleanup(
  p_retention interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'content_share_expiry_cleanup is restricted to the service role';
  end if;

  for v_row in
    select cs.id, cs.club_id, cs.kind,
           coalesce(cs.drill_id, cs.session_id, cs.programme_id) as source_id
    from public.content_shares cs
    where cs.revoked_at is null
      and cs.expires_at is not null
      and cs.expires_at < now() - p_retention
      and cs.snapshot is not null
  loop
    update public.content_shares set snapshot = null, updated_at = now() where id = v_row.id;
    delete from public.content_share_dependencies where share_id = v_row.id;
    perform public.log_content_share_event(
      'content_share.expired', 'system', null, v_row.club_id, v_row.id,
      jsonb_build_object('source_kind', v_row.kind::text, 'source_id', v_row.source_id,
                         'reason_code', 'expired_cleanup', 'initiator', 'system')
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'cleared', v_count);
end;
$$;

comment on function public.content_share_expiry_cleanup(interval) is
  $$The scheduled private cleanup for public shares expired beyond a retention window (default seven days): it nulls the snapshot, removes the dependency rows and emits content_share.expired (a system event, no actor). It does NOT enforce access (read_public_share compares expires_at at read time); it only clears retained free text after the window, leaving the row so a within-window Refresh can still extend the share. EXECUTE revoked from public, anon and authenticated; granted to service_role only. No schedule is created by this migration. See 0039_public_share_read.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.content_share_expiry_cleanup(interval) from public, anon, authenticated;
grant execute on function public.content_share_expiry_cleanup(interval) to service_role;

-- =====================================================================
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended. Grant assertions phrased as "no violating row exists"
-- are vacuously true on a fresh local reset and strict on the hosted project.
-- =====================================================================
do $$
begin
  -- ---- The lifecycle RPC has exactly the new eleven argument signature ----
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'manage_content_share') <> 1 then
    raise exception 'public share: manage_content_share must exist exactly once (no stale overload)';
  end if;
  if has_function_privilege('anon', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer)', 'EXECUTE') then
    raise exception 'public share: manage_content_share must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text, jsonb, integer)', 'EXECUTE') then
    raise exception 'public share: service_role must be able to execute manage_content_share';
  end if;

  -- ---- read_public_share: service role only ----
  -- (EXECUTE is revoked from public, anon and authenticated in the body above;
  -- the concrete browser roles anon and authenticated are asserted here. The
  -- pseudo-role 'public' is not a real role and is not passed to
  -- has_function_privilege, which would reject it.)
  if has_function_privilege('anon', 'public.read_public_share(uuid, bytea)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception 'public share: read_public_share must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception 'public share: service_role must be able to execute read_public_share';
  end if;

  -- ---- content_share_expiry_cleanup: service role only ----
  if has_function_privilege('anon', 'public.content_share_expiry_cleanup(interval)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_expiry_cleanup(interval)', 'EXECUTE') then
    raise exception 'public share: content_share_expiry_cleanup must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.content_share_expiry_cleanup(interval)', 'EXECUTE') then
    raise exception 'public share: service_role must be able to execute content_share_expiry_cleanup';
  end if;

  -- ---- content_share_resolve_snapshot: private ----
  if has_function_privilege('anon', 'public.content_share_resolve_snapshot(jsonb, text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_resolve_snapshot(jsonb, text, integer)', 'EXECUTE') then
    raise exception 'public share: content_share_resolve_snapshot must not be executable by anon or authenticated';
  end if;

  -- ---- Still no client access to the private tables (unchanged from 0038) ----
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('content_shares', 'content_share_dependencies')) <> 0 then
    raise exception 'public share: the private tables must still carry no policy';
  end if;
  declare
    r text; tbl text; priv text;
  begin
    foreach r in array array['anon', 'authenticated'] loop
      foreach tbl in array array['public.content_shares', 'public.content_share_dependencies'] loop
        foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
          if has_table_privilege(r, tbl, priv) then
            raise exception 'public share: % must hold no % on %', r, priv, tbl;
          end if;
        end loop;
      end loop;
    end loop;
  end;

  -- ---- The kill switch still defaults false and no club was enabled ----
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clubs' and column_name = 'public_sharing_enabled'
      and is_nullable = 'NO' and column_default like '%false%'
  ) then
    raise exception 'public share: clubs.public_sharing_enabled must still exist, be not null and default false';
  end if;
  if exists (select 1 from public.clubs where public_sharing_enabled) then
    raise exception 'public share: no club may have public sharing enabled by this migration';
  end if;
end
$$;
