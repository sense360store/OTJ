-- =====================================================================
-- OTJ Training Hub, migration 0041_public_programme_read: extend the public
-- read path to public PROGRAMME sharing (Content Sharing PR 4)
--
-- REVIEW REQUIRED. Migrations are gated. This one touches the security
-- boundary (the service role read path an anonymous Edge Function calls).
-- Run by hand via the connector after review. Do not auto-merge. NOT applied
-- to hosted as part of the pull request: the hosted project keeps 0040 until a
-- separate explicit approval, and public sharing stays disabled on every club
-- (clubs.public_sharing_enabled). No club is enabled, no share is created and
-- no content is reclassified by this migration.
--
-- HOSTED LEDGER VERSION. When this migration is applied it MUST be recorded in
-- supabase_migrations.schema_migrations with version 20260725160000 and name
-- public_programme_read. The post-deploy residue verifier
-- (.github/scripts/content-sharing-deploy/verify_no_residue.py) asserts the
-- newest ledger version EXACTLY, so the applied version and that constant move
-- together or the deploy job fails closed. Confirm the recorded version
-- immediately after applying and before running the Edge Function deploy.
--
-- Why a migration at all. PR 1 (0038) built the management substrate as a
-- first-class polymorphic model, and every programme-shaped piece of it already
-- exists and is already live: content_share_kind already includes 'programme'
-- (0038), content_shares.programme_id already exists with its exactly-one-source
-- and kind-matches-source check constraints and its one-active and idempotency
-- indexes (0038), content_share_deps already resolves a programme's week
-- templates, those templates' drills, those drills' media and the attached PDF,
-- club scoped at every hop (0040), content_share_lock_rights already has
-- template and programme arms (0038), manage_content_share already creates,
-- refreshes, rotates and revokes a programme share and already resolves its
-- authority through programmes.manage / programmes.create (0039), the audit
-- source_kind vocabulary already includes "programme" (0038), and the rights
-- downgrade triggers already fire on programmes and templates (0038).
--
-- The ONE thing that is drill-and-session only in the shipped code is the
-- anonymous READ path. read_public_share (0039, widened by 0040) deliberately
-- fails closed for any kind other than drill or session (its clause
-- `or v_share.kind not in ('drill', 'session')`), because PR 2 shipped "drills
-- only, no generic renderer that could silently expose another source kind" and
-- PR 3 widened it by exactly one kind on the same principle. Because the
-- anonymous function returns the neutral unavailable response for an
-- unsupported kind BEFORE returning any snapshot, a programme share created
-- today is inert. This migration widens the allow list from {drill, session} to
-- {drill, session, programme} and nothing else.
--
-- Everything else in read_public_share already supports a programme snapshot
-- unchanged. The dependency recheck loop already has arms for every
-- dependency_kind a programme projects (template, drill and media; the template
-- arm arrived in 0039 and the media arm signs the attached PDF like any other
-- stored media). The signing loop already iterates the flat top-level media
-- pool, which is exactly where the programme snapshot builder places every
-- week's drills' media and the attached PDF (referenced drills and the pdf
-- pointer both index into that pool by ref). So the media signing, the marker
-- stripping and the neutral failure paths are all reused unchanged; only the
-- kind gate moves.
--
-- Verified byte for byte against 0040: outside comments, this file's
-- read_public_share body differs from the 0040 body in exactly ONE line, the
-- kind allow list. The function signature is unchanged, so the signature pin in
-- tests/security/local-grants.sql and the security suite need no edit and the
-- existing grants survive the create-or-replace (they are re-stated below
-- anyway, so the service-role-only boundary is explicit and idempotent).
--
-- What this migration does NOT do. It does not enable any club, create any
-- share, reclassify any content, add any anonymous table grant or policy, add a
-- generic arbitrary-kind renderer, expose another source kind, or add a
-- schedule. It changes no table, no column, no enum, no constraint, no index,
-- no trigger and no capability.
-- =====================================================================

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
  -- of a known version, and of a kind the public page renders. PR 4 widens
  -- this from {drill, session} to {drill, session, programme}. No other kind
  -- exists in content_share_kind, so the allow list is now the whole enum and
  -- any future kind must widen it again deliberately.
  if v_share.snapshot is null
     or coalesce(v_share.snapshot->>'public', '') <> 'true'
     or coalesce(v_share.snapshot->>'snapshotVersion', '') <> '1'
     or v_share.kind not in ('drill', 'session', 'programme') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Third safety layer: every recorded dependency must still exist and be
  -- eligible (rights not internal_only). Reads the rights column and existence
  -- only, never content. Collects the media ids that are currently public_full
  -- and stored, the only ones eligible for signing. A session share's
  -- dependencies are drills, their media and the attached board; a programme
  -- share's are its week templates, those templates' drills, those drills'
  -- media and the attached PDF (media). Every one of those kinds already has an
  -- arm below, so a dependency later downgraded to internal_only, or a nested
  -- template/drill/media removed, fails the whole share closed exactly as it
  -- does for a drill share (no partial session, no partial programme).
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
      -- Club scoped by the board's own club_id (boards.club_id, not null),
      -- unchanged from 0039 and now matched by content_share_deps. A board gone
      -- or in another club fails the whole session share closed. A board carries
      -- no rights class, so only existence and club are checked, never content.
      if not exists (select 1 from public.boards b where b.id = v_dep.dependency_id and b.club_id = v_share.club_id) then
        return jsonb_build_object('status', 'unavailable');
      end if;
    end if;
  end loop;

  -- Build the public media array (private fields stripped) and the sign list
  -- (ref plus the stored path, for eligible public_full stored media only).
  -- This is the flat top-level media pool; for a session share it holds every
  -- referenced drill's media once, keyed by ref, and for a programme share it
  -- holds every week's drills' media plus the attached PDF once, keyed by ref.
  -- Referenced drills and the programme pdf pointer both point in by ref, so
  -- this one loop signs a programme's media exactly as it signs a drill's.
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
  $$The single narrow SECURITY DEFINER read path for public shares, called by the anonymous read-content-share Edge Function under the service role. Verifies the secret hash (keyed lookup), revoked_at, expires_at and the per club kill switch, refuses a placeholder or unknown-version snapshot and any kind outside {drill, session, programme} (PR 4 renders drills, sessions and programmes; the allow list is the whole content_share_kind enum, and any future kind must widen it deliberately), re-checks every dependency's current rights and existence (rights column only, never content; the board dependency arm checks existence only), and returns only the safe public snapshot (private media fields and internal markers stripped) plus the explicit list of eligible public_full stored media paths to sign. A programme's dependencies are its week templates, those templates' drills, those drills' media and the attached PDF; one of them missing, moved to another club or downgraded to internal_only fails the whole programme share closed, so no partial programme is ever returned. Every failure returns the identical neutral {status:'unavailable'}. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0041_public_programme_read.sql and docs/security/content-sharing-boundary.md.$$;

-- Grants are preserved across create-or-replace of an unchanged signature;
-- re-stated here so the service-role-only boundary is explicit and idempotent.
revoke execute on function public.read_public_share(uuid, bytea) from public, anon, authenticated;
grant execute on function public.read_public_share(uuid, bytea) to service_role;

-- Self verification. Strict, and it fails the migration loudly rather than
-- leaving a half-widened read path:
--   1. the read path stays service-role only (no anon/authenticated EXECUTE);
--   2. content_share_deps stays private (no client EXECUTE);
--   3. the widened allow list is actually present in the installed body, and
--      the drill and session kinds are still in it (a botched replace that
--      dropped a kind would otherwise pass silently);
--   4. the programme source column and enum value the widening depends on still
--      exist;
--   5. nothing was enabled and nothing was created by this migration.
do $$
declare
  v_def text;
begin
  if has_function_privilege('anon', 'public.read_public_share(uuid, bytea)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception '0041 verify: read_public_share must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.read_public_share(uuid, bytea)', 'EXECUTE') then
    raise exception '0041 verify: read_public_share must be executable by service_role';
  end if;

  -- content_share_deps stays private (no client EXECUTE).
  if has_function_privilege('anon', 'public.content_share_deps(public.content_share_kind, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_deps(public.content_share_kind, uuid, uuid)', 'EXECUTE') then
    raise exception '0041 verify: content_share_deps must not be executable by anon or authenticated';
  end if;

  -- The installed body must carry the widened allow list, with all three kinds.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_public_share';
  if v_def is null then
    raise exception '0041 verify: read_public_share is missing';
  end if;
  if position('not in (''drill'', ''session'', ''programme'')' in v_def) = 0 then
    raise exception '0041 verify: read_public_share does not carry the widened kind allow list';
  end if;

  -- The substrate the widening depends on must still exist.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'content_shares' and column_name = 'programme_id'
  ) then
    raise exception '0041 verify: content_shares.programme_id is missing';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'content_share_kind' and e.enumlabel = 'programme'
  ) then
    raise exception '0041 verify: content_share_kind is missing the programme value';
  end if;

  -- This migration enables nothing and creates nothing.
  if exists (select 1 from public.clubs where public_sharing_enabled) then
    raise exception '0041 verify: a club has public sharing enabled; this migration must not enable one';
  end if;
end $$;
