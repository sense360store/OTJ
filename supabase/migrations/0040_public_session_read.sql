-- =====================================================================
-- OTJ Training Hub, migration 0040_public_session_read: extend the public
-- read path to public SESSION sharing (Content Sharing PR 3)
--
-- REVIEW REQUIRED. Migrations are gated. This one touches the security
-- boundary (the service role read path an anonymous Edge Function calls).
-- Run by hand via the connector after review. Do not auto-merge. NOT applied
-- to hosted as part of PR 3: the hosted project keeps 0039 until a separate
-- explicit approval, and public sharing stays disabled on every club
-- (clubs.public_sharing_enabled). No club is enabled, no share is created and
-- no content is reclassified by this migration.
--
-- Why a migration at all. PR 1 (0038) built the whole management substrate as
-- a first-class polymorphic model: the content_shares.kind enum already
-- includes 'session', the kind/source check constraints already have a session
-- arm, the one-active-per-source and idempotency indexes already cover
-- session_id, and the lifecycle RPC (manage_content_share) and the dependency
-- resolver (content_share_deps) already branch on kind = 'session' to lock the
-- session row FOR SHARE, resolve its nested drills from the activities jsonb,
-- those drills' media, and the attached board, all club scoped and fail
-- closed. The downgrade invalidation triggers and the audit writer already
-- cover a session source too. So creating, refreshing, rotating, revoking and
-- invalidating a session share, and recording its authoritative server derived
-- dependency snapshot, need NO schema change.
--
-- The ONE thing that is drill only in the shipped code is the anonymous READ
-- path. read_public_share (0039) deliberately fails closed for any kind other
-- than drill (its clause `or v_share.kind <> 'drill'`), because PR 2 shipped
-- "drills only, no generic renderer that could silently expose another source
-- kind". Because the anonymous function returns the neutral unavailable
-- response for a non-drill kind BEFORE returning any snapshot, a session share
-- cannot be read publicly without widening that one clause. This migration
-- widens the allow list from {drill} to {drill, session} and nothing else.
--
-- Everything else in read_public_share already supports a session snapshot
-- with no change: the dependency re-eligibility loop already handles the
-- dependency_kind values a session projects (drill, media and board; the board
-- arm checks existence only, as a board carries no rights), and the media
-- signing loop already iterates the flat top-level snapshot->'media' pool,
-- which is exactly where the session snapshot builder places every referenced
-- drill's media (referenced drills point into that pool by ref). So the media
-- signing, the private-field stripping and the internal-marker stripping are
-- unchanged; only the kind gate moves.
--
-- Numbering: the highest migration file on disk is 0039_public_share_read, so
-- this is 0040. The file numbers carry development gaps; confirm the next free
-- slot against the live migration ledger before applying, never assume it from
-- the highest file on disk.
--
-- This migration also hardens the dependency resolver's board arm. In
-- content_share_deps (0038) the board dep_exists was
-- `(b.id is not null and bpr.club_id = p_club)`, which is SQL NULL (not false)
-- when the board's creator profile has a null club_id (a reachable quarantined
-- state). manage_content_share's `if not v_dep.dep_exists then raise` does not
-- fire on NULL, so a session board whose creator is clubless would pass the
-- RPC's aggregate eligibility instead of blocking, a latent fail-open in the
-- authority that PR 3 is the first to exercise (a board is only ever a session
-- dependency). The Edge Function and read_public_share already fail closed for
-- this case, so it leaks nothing, but the RPC must be fail closed on its own.
-- PART 1 recreates content_share_deps with that arm wrapped in coalesce(...,
-- false); every other line is copied verbatim from 0038.
--
-- Additive and reversible. This migration recreates two functions with
-- unchanged signatures: read_public_share (a widened kind clause and a
-- corrected board arm) and content_share_deps (a fail-closed board dep_exists).
-- Rollback is a create-or-replace back to the 0038/0039 bodies. It adds NO
-- client grant, NO policy, NO anon or authenticated access to any table,
-- creates no schedule, and does NOT enable the kill switch.
-- =====================================================================

-- =====================================================================
-- PART 1: content_share_deps, board dep_exists made fail closed
-- =====================================================================

-- Copied verbatim from 0038 with a single change: the board arm's dep_exists is
-- wrapped in coalesce(..., false) so a null-club board creator yields false (a
-- blocked, missing dependency) rather than SQL NULL (which the RPC's
-- `if not dep_exists` would skip, failing open). Every other branch is
-- unchanged. SECURITY DEFINER, stable, private (no client EXECUTE).
create or replace function public.content_share_deps(
  p_kind      public.content_share_kind,
  p_source_id uuid,
  p_club      uuid
)
returns table (dep_kind text, dep_id uuid, dep_rights public.content_rights, dep_exists boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'drill' then
    -- The drill's own media, club scoped.
    return query
      select 'media'::text, d.media_id, m.rights, (m.id is not null)
      from public.drills d
      left join public.media m on m.id = d.media_id and m.club_id = p_club
      where d.id = p_source_id and d.media_id is not null;

  elsif p_kind = 'session' then
    -- Nested drills from the activities jsonb (drill_id key; custom
    -- activities carry a title and no drill_id and are skipped), club scoped.
    return query
      with acts as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.sessions s, lateral jsonb_array_elements(s.activities) a
        where s.id = p_source_id and nullif(a->>'drill_id', '') is not null
      )
      select 'drill'::text, acts.drill_id, d.rights, (d.id is not null)
      from acts left join public.drills d on d.id = acts.drill_id and d.club_id = p_club;
    -- The media of those nested (same club) drills, club scoped.
    return query
      with acts as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.sessions s, lateral jsonb_array_elements(s.activities) a
        where s.id = p_source_id and nullif(a->>'drill_id', '') is not null
      ),
      dm as (
        select distinct d.media_id
        from acts join public.drills d on d.id = acts.drill_id and d.club_id = p_club
        where d.media_id is not null
      )
      select 'media'::text, dm.media_id, m.rights, (m.id is not null)
      from dm left join public.media m on m.id = dm.media_id and m.club_id = p_club;
    -- The attached board (shape and numbers only; no rights class), club scoped
    -- via its creator's profile. dep_exists coalesced to false so a null-club
    -- creator blocks (fail closed) rather than yielding SQL NULL.
    return query
      select 'board'::text, s.board_id, null::public.content_rights,
             coalesce(b.id is not null and bpr.club_id = p_club, false)
      from public.sessions s
      left join public.boards b on b.id = s.board_id
      left join public.profiles bpr on bpr.id = b.created_by
      where s.id = p_source_id and s.board_id is not null;

  elsif p_kind = 'programme' then
    -- Nested templates (programme weeks), club scoped.
    return query
      select 'template'::text, t.id, t.rights, true
      from public.templates t
      where t.programme_id = p_source_id and t.club_id = p_club;
    -- Nested drills across those (same club) templates, club scoped.
    return query
      with td as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.templates t, lateral jsonb_array_elements(t.activities) a
        where t.programme_id = p_source_id and t.club_id = p_club and nullif(a->>'drill_id', '') is not null
      )
      select 'drill'::text, td.drill_id, d.rights, (d.id is not null)
      from td left join public.drills d on d.id = td.drill_id and d.club_id = p_club;
    -- The media of those drills, club scoped.
    return query
      with td as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.templates t, lateral jsonb_array_elements(t.activities) a
        where t.programme_id = p_source_id and t.club_id = p_club and nullif(a->>'drill_id', '') is not null
      ),
      dm as (
        select distinct d.media_id
        from td join public.drills d on d.id = td.drill_id and d.club_id = p_club
        where d.media_id is not null
      )
      select 'media'::text, dm.media_id, m.rights, (m.id is not null)
      from dm left join public.media m on m.id = dm.media_id and m.club_id = p_club;
    -- The programme's attached PDF (treated as media), club scoped.
    return query
      select 'media'::text, p.pdf_media_id, m.rights, (m.id is not null)
      from public.programmes p
      left join public.media m on m.id = p.pdf_media_id and m.club_id = p_club
      where p.id = p_source_id and p.pdf_media_id is not null;
  end if;
end;
$$;

comment on function public.content_share_deps(public.content_share_kind, uuid, uuid) is
  $$The nested dependency set (drills, templates, media, boards) a share source projects, each club scoped to p_club (the source's club) so a cross club nested id read from the free form activities jsonb resolves as a missing dependency and blocks the share. The board arm's dep_exists is coalesced to false so a null-club board creator fails closed. Used by manage_content_share to evaluate aggregate eligibility (fail closed on a missing, cross club or internal_only item) and to write the dependency rows. Private (no client EXECUTE). See 0040_public_session_read.sql (board fail-closed fix) and 0038_content_sharing.sql.$$;

revoke execute on function public.content_share_deps(public.content_share_kind, uuid, uuid) from public, anon, authenticated;

-- =====================================================================
-- PART 2: read_public_share, extended to drill and session shares
-- =====================================================================

-- read_public_share, extended to render both drill and session shares. The
-- body is copied verbatim from 0039 with a single change: the kind gate now
-- accepts 'session' as well as 'drill'. Every other line (the secret hash keyed
-- lookup, revoked_at, expires_at, the per club kill switch, the snapshot
-- version check, the per-dependency current-rights re-check for a nested item
-- gone internal_only or missing, the flat media pool signing list, and the
-- private field and internal marker stripping) is unchanged, so the PR 2 drill
-- read contract is preserved byte for byte in behaviour.
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
  -- of a known version, and of a kind the public page renders. PR 3 widens
  -- this from drill only to {drill, session}; a programme share still fails
  -- closed here (no public programme renderer yet).
  if v_share.snapshot is null
     or coalesce(v_share.snapshot->>'public', '') <> 'true'
     or coalesce(v_share.snapshot->>'snapshotVersion', '') <> '1'
     or v_share.kind not in ('drill', 'session') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Third safety layer: every recorded dependency must still exist and be
  -- eligible (rights not internal_only). Reads the rights column and existence
  -- only, never content. Collects the media ids that are currently public_full
  -- and stored, the only ones eligible for signing. A session share's
  -- dependencies are drills, their media and the attached board; each arm below
  -- already covers those kinds, so a session dependency later downgraded to
  -- internal_only, or a nested drill/media/board removed, fails the whole share
  -- closed exactly as it does for a drill share (no partial session).
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
      -- The boards table has no club_id column; the club is resolved through the
      -- creator's profile, mirroring content_share_deps. (0039's board arm read
      -- a non-existent b.club_id; it was dead code there because PR 2 refused
      -- every non-drill kind before this loop, and a drill share never records a
      -- board dependency. PR 3 activates a session's board dependency, so this
      -- arm is corrected here to club scope via the creator and fail closed.)
      if not exists (
        select 1
        from public.boards b
        join public.profiles bpr on bpr.id = b.created_by
        where b.id = v_dep.dependency_id and bpr.club_id = v_share.club_id
      ) then
        return jsonb_build_object('status', 'unavailable');
      end if;
    end if;
  end loop;

  -- Build the public media array (private fields stripped) and the sign list
  -- (ref plus the stored path, for eligible public_full stored media only).
  -- This is the flat top-level media pool; for a session share it holds every
  -- referenced drill's media once, keyed by ref, and referenced drills point in
  -- by ref, so this one loop signs a session's media exactly as a drill's.
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
  $$The single narrow SECURITY DEFINER read path for public shares, called by the anonymous read-content-share Edge Function under the service role. Verifies the secret hash (keyed lookup), revoked_at, expires_at and the per club kill switch, refuses a placeholder or unknown-version snapshot and any kind other than drill or session (PR 3 renders drills and sessions; a programme share still fails closed here), re-checks every dependency's current rights and existence (rights column only, never content; the board dependency arm checks existence only), and returns only the safe public snapshot (private media fields and internal markers stripped) plus the explicit list of eligible public_full stored media paths to sign. Every failure returns the identical neutral {status:'unavailable'}. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0040_public_session_read.sql and docs/security/content-sharing-boundary.md.$$;

-- Grants are preserved across create-or-replace of an unchanged signature;
-- re-stated here so the service-role-only boundary is explicit and idempotent.
revoke execute on function public.read_public_share(uuid, bytea) from public, anon, authenticated;
grant execute on function public.read_public_share(uuid, bytea) to service_role;

-- Self verification: the two source columns a session share reads must exist,
-- and the read path must remain service-role only (no anon/authenticated
-- EXECUTE crept in). Fails the migration loudly if either invariant is broken.
do $$
begin
  if has_function_privilege('anon', 'public.read_public_share(uuid, bytea)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception '0040 verify: read_public_share must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception '0040 verify: read_public_share must be executable by service_role';
  end if;
  -- content_share_deps stays private (no client EXECUTE) after the recreate.
  if has_function_privilege('anon', 'public.content_share_deps(public.content_share_kind, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_deps(public.content_share_kind, uuid, uuid)', 'EXECUTE') then
    raise exception '0040 verify: content_share_deps must not be executable by anon or authenticated';
  end if;
end $$;
