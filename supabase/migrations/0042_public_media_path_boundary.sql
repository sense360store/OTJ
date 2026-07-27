-- =====================================================================
-- OTJ Training Hub, migration 0042_public_media_path_boundary: constrain
-- media.storage_path and make the live row, not the frozen snapshot, the
-- signing authority for public shares (Content Sharing, media path hardening)
-- =====================================================================
--
-- REVIEW REQUIRED. Migrations are gated. This one touches the security
-- boundary (the service role read path an anonymous Edge Function calls, and a
-- new integrity constraint on a production table). Run by hand via the
-- connector after review. Do not auto-merge. No club is enabled, no share is
-- created and no content is reclassified by this migration.
--
-- HOSTED LEDGER VERSION. The deploy residue verifier
-- (.github/scripts/content-sharing-deploy/verify_no_residue.py) asserts the
-- newest ledger version EXACTLY. The version is assigned BY THE APPLY, not by
-- this file: the connector stamps it from the server clock at apply time. The
-- apply order is therefore:
--
--   1. apply this migration through the connector after review;
--   2. read back the recorded version:
--        select max(version) from supabase_migrations.schema_migrations;
--   3. set EXPECTED_LAST_MIGRATION to exactly that value and commit it;
--   4. only then run the Edge Function deploy workflow.
--
-- The assertion stays an exact equality throughout: it is never relaxed to a
-- >=, a prefix match or an "exists somewhere" check.
--
-- ---------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------
--
-- media.storage_path is a key into the private `media` Storage bucket. The
-- anonymous read path (read-content-share) signs it with the SERVICE ROLE,
-- which bypasses every Storage RLS policy in 0027_storage_boundary.sql. Until
-- this migration the column was bare nullable text: the update policy
-- media_update_owner_or_manager (0012_rbac.sql) constrains club_id and
-- capability, never the storage_path VALUE. A member who could edit a media row
-- could therefore point a public_full row at:
--
--   * another club's object (the club prefix was never checked);
--   * a member's avatar, since avatars/{user_id}/... shares the same bucket and
--     profiles.avatar_url is readable club-wide, so the exact key was known;
--   * an internal_only row's object, because rights live on the ROW and the
--     bytes were reachable by any row that named the same path;
--   * a path shaped so that Storage might resolve it differently from the way
--     the application read it.
--
-- Separately, the read path re-checked the live media row's RIGHTS but then
-- signed the path frozen in the snapshot (0041 lines 202-207: it read
-- m.storage_path into v_sp, used v_sp only as a null test, and signed
-- v_entry->>'_path'). A storage_path changed after the share was created left
-- the share serving the OLD object indefinitely.
--
-- The layers added here, smallest set that closes all of it:
--
--   1. one canonical grammar, is_canonical_media_path, stated identically in
--      Postgres, Deno (supabase/functions/_shared/mediaPath.ts) and the browser
--      (src/lib/mediaPath.ts), pinned together by
--      tests/fixtures/media-path-cases.json;
--   2. a CHECK constraint so a non canonical or cross club path cannot be
--      STORED, and a unique index so two rows can never name one object (which
--      is what made "point a public_full row at an internal_only object's path"
--      work);
--   3. the read path signs the LIVE path and refuses the whole share when the
--      snapshot disagrees with it;
--   4. a trigger so changing a path invalidates the shares that depend on it,
--      matching how a rights downgrade already behaves.
--
-- Layer 2 is the boundary. Layers 1, 3 and 4 are defence in depth, and the Edge
-- Function refusal (a 422 carrying media_path_invalid) is the reportable one.
--
-- ---------------------------------------------------------------------
-- EXISTING DATA
-- ---------------------------------------------------------------------
--
-- A read-only preflight over the hosted project ran before this migration was
-- written: 105 of 111 media rows carry a storage_path, and all 105 already
-- match the grammar below exactly, with zero rows outside their club prefix,
-- zero in the avatars namespace, zero duplicates and zero malformed paths. The
-- constraint is therefore added VALIDATED, with no data remediation and no
-- production row rewritten by this migration. If it ever fails to validate, the
-- apply aborts in its own transaction and nothing is changed.
--
-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--
-- Fully reversible, in this order, in one transaction:
--
--   drop trigger if exists content_share_storage_path_change_media on public.media;
--   drop function if exists public.audit_storage_path_change_media();
--   drop index  if exists public.media_storage_path_unique;
--   alter table public.media drop constraint if exists media_storage_path_canonical;
--   -- then re-run the read_public_share body from 0041_public_programme_read.sql,
--   -- re-run content_share_metadata_ok and content_share_invalidate_dependents
--   -- from 0038_content_sharing.sql (restoring the 4 argument signature), and
--   --   drop function if exists public.is_canonical_media_path(text, uuid);
--
-- Rolling back restores the pre-0042 behaviour exactly, including the stale
-- path exposure, so it is a break-glass step and not a routine one. Public
-- sharing is disabled on every club throughout; nothing here enables it.

begin;

-- =====================================================================
-- PART 1: the canonical media storage path grammar
-- =====================================================================
--
-- Accepts exactly `{club_id}/{segment}[/{segment}...]`. A segment starts
-- alphanumeric and then allows dot, dash and underscore, which is what makes
-- `.` and `..` unrepresentable without a separate traversal rule. The character
-- set contains no `/` inside a segment, no `\`, no `%`, no `:`, no space and no
-- control byte, so traversal, percent encoding and control character tricks are
-- refused by construction. Nothing here rewrites a path; it only accepts or
-- rejects one, because normalising an attacker's string and then trusting the
-- result is the bug class this avoids.
--
-- IMMUTABLE so it can back a CHECK constraint. It reads no table, so it is safe
-- in one (the usual warning about constraint functions querying other tables
-- does not apply).
create or replace function public.is_canonical_media_path(p_path text, p_club_id uuid)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_path is not null
     and p_club_id is not null
     and length(p_path) between 1 and 512
     -- The club id renders lowercase from uuid::text, and the pattern is
     -- anchored, so `{club}9/x` and `{club}x/x` are both refused: the club
     -- segment must be followed by a separator, never by more characters.
     and p_path ~ ('^' || p_club_id::text
                   || '/[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$')
     -- Reserved namespace at any depth. avatars/{user_id}/... shares the media
     -- bucket but deliberately has no media row; a media row pointing into it
     -- would publish a member's face. The club prefix rule already refuses a
     -- root level avatars path; this refuses it nested too.
     and p_path !~* '(^|/)avatars(/|$)';
$$;

-- EXECUTE deliberately stays with PUBLIC. A CHECK constraint is evaluated with
-- the privileges of the role performing the write, so revoking EXECUTE here
-- turns every media insert and update by `authenticated` into
-- "permission denied for function is_canonical_media_path" (42501) instead of
-- a clean constraint violation. The function is a pure predicate over two
-- scalars: it reads no table, returns nothing but a boolean, and discloses
-- nothing a caller did not already supply, so leaving it callable costs
-- nothing. Do not revoke it.

comment on function public.is_canonical_media_path(text, uuid) is
  $$True only when the path is the canonical storage key of an object owned by the named club: exactly {club_id}/{segment}[/{segment}...], each segment starting alphanumeric and drawn from [A-Za-z0-9._-], at most 512 characters, never in the reserved avatars namespace at any depth. Refuses rather than normalises, so traversal, percent encoding, backslashes and control bytes fail on the character set before any structural test. Stated identically in supabase/functions/_shared/mediaPath.ts and src/lib/mediaPath.ts and pinned to them by tests/fixtures/media-path-cases.json. IMMUTABLE and table free so it can back the media_storage_path_canonical CHECK constraint. See 0042_public_media_path_boundary.sql.$$;

-- =====================================================================
-- PART 2: the storage_path integrity boundary on media
-- =====================================================================

-- A stored path must be this row's own club's object. Row local (club_id is a
-- column of the same row), so it is expressible as a CHECK. Added validated:
-- the hosted preflight found zero violating rows.
alter table public.media
  add constraint media_storage_path_canonical
  check (storage_path is null or public.is_canonical_media_path(storage_path, club_id));

comment on constraint media_storage_path_canonical on public.media is
  $$A stored media object must live at the canonical path of its own club: {club_id}/... , never another club's prefix, never the avatars namespace, never a traversal or encoded form. Closes the path half of the public sharing boundary; the rights columns close the other half. See 0042_public_media_path_boundary.sql.$$;

-- One object, one media row. This is the control that stops a public_full row
-- being pointed at an internal_only row's object: the second row naming the
-- same path is refused outright, so the rights class can no longer be detached
-- from the bytes it protects by duplicating the key.
create unique index media_storage_path_unique
  on public.media (storage_path)
  where storage_path is not null;

comment on index public.media_storage_path_unique is
  $$At most one media row may name any stored object. Prevents the duplicate path attack, where a second row with weaker rights names an existing object and inherits access to its bytes. Partial so the many rows with no stored object (YouTube and link only media) are unaffected. See 0042_public_media_path_boundary.sql.$$;

-- =====================================================================
-- PART 3: the audit reason vocabulary gains path_changed
-- =====================================================================
--
-- Recreated verbatim from 0038 with one value added to the reason_code list, so
-- an invalidation caused by a moved object is not mislabelled as a rights
-- downgrade. Everything else about the allow list is unchanged: the same five
-- keys, the same closed value sets, no free text, no identifier.
create or replace function public.content_share_metadata_ok(p_metadata jsonb)
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
          e.key not in ('source_kind', 'source_id', 'expiry_state', 'reason_code', 'initiator')
          or not (
            case e.key
              when 'source_kind' then e.value in ('"drill"'::jsonb, '"session"'::jsonb, '"programme"'::jsonb)
              when 'expiry_state' then e.value in ('"default"'::jsonb, '"custom"'::jsonb, '"none"'::jsonb)
              when 'reason_code' then e.value in (
                '"owner_revoke"'::jsonb, '"manager_revoke"'::jsonb, '"rights_downgrade"'::jsonb,
                '"source_deleted"'::jsonb, '"expired_cleanup"'::jsonb, '"path_changed"'::jsonb
              )
              when 'initiator' then e.value in ('"owner"'::jsonb, '"manager"'::jsonb, '"system"'::jsonb)
              when 'source_id' then
                jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              else false
            end
          )
      )
    )
$$;

-- =====================================================================
-- PART 4: invalidating dependent shares when an object moves
-- =====================================================================
--
-- The invalidator gains a reason, defaulted to the value it always used, so the
-- five existing rights downgrade trigger functions keep calling it with four
-- arguments and keep writing rights_downgrade. Dropped and recreated because a
-- create or replace cannot change the argument list; the trigger functions
-- late-bind, so no trigger needs recreating.
drop function if exists public.content_share_invalidate_dependents(text, uuid, uuid, uuid);

create or replace function public.content_share_invalidate_dependents(
  p_entity_kind  text,
  p_entity_id    uuid,
  p_entity_club  uuid,
  p_actor        uuid,
  p_reason       text default 'rights_downgrade'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share record;
  v_actor uuid := p_actor;
begin
  if p_reason not in ('rights_downgrade', 'path_changed') then
    raise exception 'content_share_invalidate_dependents: unknown reason %', p_reason;
  end if;

  -- A non member (or null) server derived actor is recorded as system.
  if v_actor is not null
     and not exists (select 1 from public.profiles pr where pr.id = v_actor and pr.club_id = p_entity_club) then
    v_actor := null;
  end if;

  for v_share in
    select cs.id, cs.club_id, cs.kind, cs.created_by,
           coalesce(cs.drill_id, cs.session_id, cs.programme_id) as source_id
    from public.content_shares cs
    where cs.revoked_at is null
      and cs.club_id = p_entity_club
      and (
        (p_entity_kind = 'drill'     and cs.drill_id     = p_entity_id) or
        (p_entity_kind = 'session'   and cs.session_id   = p_entity_id) or
        (p_entity_kind = 'programme' and cs.programme_id = p_entity_id) or
        cs.id in (
          select dep.share_id from public.content_share_dependencies dep
          where dep.dependency_kind = p_entity_kind and dep.dependency_id = p_entity_id
            and dep.club_id = p_entity_club
        )
      )
  loop
    update public.content_shares
      set revoked_at = now(), revoked_by = v_actor, updated_by = v_actor,
          updated_at = now(), snapshot = null
      where id = v_share.id;
    delete from public.content_share_dependencies where share_id = v_share.id;
    perform public.log_content_share_event(
      'content_share.invalidated', 'database_trigger', v_actor, v_share.club_id, v_share.id,
      jsonb_build_object('source_kind', v_share.kind::text, 'source_id', v_share.source_id,
                         'reason_code', p_reason, 'initiator', 'system')
    );
  end loop;
end;
$$;

comment on function public.content_share_invalidate_dependents(text, uuid, uuid, uuid, text) is
  $$Invalidates exactly the active shares in the entity's club that depend on it: revoked_at set, snapshot cleared, dependency rows removed, a content_share.invalidated event written, found through the source columns and the reverse dependency index, both club scoped (never a global sweep, never cross club). Called by the five rights downgrade triggers with the default rights_downgrade reason, and by the media storage_path change trigger with path_changed. A non member or null server derived actor is recorded as a system event. Private (no client EXECUTE). See 0042_public_media_path_boundary.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.content_share_invalidate_dependents(text, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- Moving or re-homing an object invalidates every share that depends on it,
-- exactly as dropping it to internal_only already does. Without this a share
-- would keep pointing at bytes the club has since replaced. The read path also
-- refuses such a share (PART 5), so this is the tidy-up that keeps stored state
-- honest rather than the control that keeps it safe.
create or replace function public.audit_storage_path_change_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('media', new.id, new.club_id, auth.uid(), 'path_changed');
  -- A row that moved between clubs must also drop the shares recorded against
  -- the club it left, which the call above (scoped to the new club) would miss.
  if old.club_id is distinct from new.club_id then
    perform public.content_share_invalidate_dependents('media', new.id, old.club_id, auth.uid(), 'path_changed');
  end if;
  return new;
end;
$$;

create trigger content_share_storage_path_change_media
  after update of storage_path, club_id on public.media
  for each row
  when (old.storage_path is distinct from new.storage_path
        or old.club_id is distinct from new.club_id)
  execute function public.audit_storage_path_change_media();

revoke execute on function public.audit_storage_path_change_media() from public, anon, authenticated;

-- =====================================================================
-- PART 5: the read path signs the LIVE path, never the frozen one
-- =====================================================================
--
-- Recreated from 0041 with the signing authority moved. The dependency loop
-- already re-read each media row's current rights and club; it now also keeps
-- that row's current storage_path, validates it, and signs THAT. The snapshot's
-- _path is demoted to a marker that must agree: if it disagrees, the object
-- moved after the share was built and the whole share fails closed, neutrally,
-- exactly as a rights downgrade already does. There is no partial render.
--
-- Also removed: the unguarded v_mid::uuid cast, which raised (a 500) on a
-- malformed marker instead of returning the neutral unavailable response.
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
  -- media id (text) -> the live, validated storage path. Membership of this map
  -- is what makes an entry signable; there is no separate id list, so a path is
  -- never signed without the live row it came from.
  v_live_paths  jsonb := '{}'::jsonb;
  v_media_out   jsonb := '[]'::jsonb;
  v_sign        jsonb := '[]'::jsonb;
  v_entry       jsonb;
  v_mid         text;
  v_path        text;
  v_live        text;
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

  -- Snapshot must be a real public projection (never the PR 1 placeholder), of
  -- a known version, and of a kind the public page renders. The allow list is
  -- the whole content_share_kind enum; any future kind must widen it
  -- deliberately, and there is still no generic renderer.
  if v_share.snapshot is null
     or coalesce(v_share.snapshot->>'public', '') <> 'true'
     or coalesce(v_share.snapshot->>'snapshotVersion', '') <> '1'
     or v_share.kind not in ('drill', 'session', 'programme') then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Third safety layer: every recorded dependency must still exist and be
  -- eligible (rights not internal_only). Reads the rights, club and storage
  -- path columns only, never content. A dependency later downgraded, deleted or
  -- moved to another club fails the WHOLE share closed: no partial drill, no
  -- partial session, no partial programme.
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
        -- The live path is the only thing that will be signed, so it is
        -- validated here rather than trusted. A row that predates the CHECK
        -- constraint, or that some future path bypasses it, stops the share.
        if not public.is_canonical_media_path(v_sp, v_share.club_id) then
          return jsonb_build_object('status', 'unavailable');
        end if;
        v_live_paths := jsonb_set(v_live_paths, array[v_dep.dependency_id::text], to_jsonb(v_sp));
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
      -- A board carries no rights class, so only existence and club are
      -- checked, never content.
      if not exists (select 1 from public.boards b where b.id = v_dep.dependency_id and b.club_id = v_share.club_id) then
        return jsonb_build_object('status', 'unavailable');
      end if;
    end if;
  end loop;

  -- Build the public media array (private fields stripped) and the sign list.
  -- This is the flat top-level media pool; for a session share it holds every
  -- referenced drill's media once, keyed by ref, and for a programme share it
  -- holds every week's drills' media plus the attached PDF once, keyed by ref.
  for v_entry in select value from jsonb_array_elements(coalesce(v_share.snapshot->'media', '[]'::jsonb)) loop
    v_mid  := v_entry->>'_mid';
    v_path := v_entry->>'_path';
    -- _path present means the snapshot was built from a public_full stored
    -- object. Absent means there was nothing to sign then (a YouTube link, a
    -- link only item), and there is nothing to sign now either: leave it,
    -- safe by omission, exactly as before.
    if v_mid is not null and v_path is not null then
      v_live := v_live_paths->>v_mid;
      if v_live is null then
        -- No live signable row behind this marker: the media is no longer
        -- public_full, or no longer stored, or was never a recorded dependency.
        -- Nothing is signed and the entry renders without its object.
        null;
      elsif v_path <> v_live then
        -- The object moved after the snapshot was frozen. Signing either path
        -- would be wrong: the frozen one serves bytes the club has replaced,
        -- and the live one serves bytes this share was never reviewed against.
        -- Fail the whole share closed.
        return jsonb_build_object('status', 'unavailable');
      else
        v_sign := v_sign || jsonb_build_array(jsonb_build_object('ref', v_entry->>'ref', 'path', v_live));
      end if;
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
  $$The single narrow SECURITY DEFINER read path for public shares, called by the anonymous read-content-share Edge Function under the service role. Verifies the secret hash (keyed lookup), revoked_at, expires_at and the per club kill switch, refuses a placeholder or unknown-version snapshot and any kind outside {drill, session, programme}, re-checks every dependency's current rights, club and existence (never content), and returns only the safe public snapshot (private media fields and internal markers stripped) plus the explicit list of eligible media paths to sign. The path signed is the LIVE media row's storage_path, revalidated against is_canonical_media_path; the snapshot's _path is only a marker that must agree with it, and a disagreement (the object moved after the snapshot was frozen) fails the whole share closed. One dependency missing, moved to another club or downgraded to internal_only fails the whole share closed, so no partial drill, session or programme is ever returned. Every failure returns the identical neutral {status:'unavailable'}. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0042_public_media_path_boundary.sql and docs/security/content-sharing-boundary.md.$$;

-- Grants are preserved across create-or-replace of an unchanged signature;
-- re-stated here so the service-role-only boundary is explicit and idempotent.
revoke execute on function public.read_public_share(uuid, bytea) from public, anon, authenticated;
grant execute on function public.read_public_share(uuid, bytea) to service_role;

-- =====================================================================
-- PART 6: self verification
-- =====================================================================
--
-- The migration proves its own boundary rather than trusting that the
-- statements above did what they read like. A failure here aborts the whole
-- transaction and nothing is applied.
do $$
declare
  v_club uuid := '00000000-0000-4000-8000-0000000000aa';
begin
  -- The grammar accepts what it must and refuses each attack shape.
  if not public.is_canonical_media_path(v_club || '/abc-file.png', v_club) then
    raise exception '0042: the canonical grammar refuses a valid same club path';
  end if;
  if public.is_canonical_media_path('00000000-0000-4000-8000-0000000000bb/abc-file.png', v_club) then
    raise exception '0042: the canonical grammar accepts another club prefix';
  end if;
  if public.is_canonical_media_path('avatars/' || v_club || '/face.jpg', v_club) then
    raise exception '0042: the canonical grammar accepts the avatars namespace';
  end if;
  if public.is_canonical_media_path(v_club || '/avatars/face.jpg', v_club) then
    raise exception '0042: the canonical grammar accepts a nested avatars namespace';
  end if;
  if public.is_canonical_media_path('/' || v_club || '/file.png', v_club) then
    raise exception '0042: the canonical grammar accepts a leading slash';
  end if;
  if public.is_canonical_media_path(v_club || '/../other/file.png', v_club) then
    raise exception '0042: the canonical grammar accepts a dot dot segment';
  end if;
  if public.is_canonical_media_path(v_club || '/%2e%2e/file.png', v_club) then
    raise exception '0042: the canonical grammar accepts percent encoded traversal';
  end if;
  if public.is_canonical_media_path(v_club || E'/file\nx.png', v_club) then
    raise exception '0042: the canonical grammar accepts a control character';
  end if;
  if public.is_canonical_media_path(v_club || '9/file.png', v_club) then
    raise exception '0042: the canonical grammar accepts a bare club prefix';
  end if;
  if public.is_canonical_media_path('https://example.test/' || v_club || '/f.png', v_club) then
    raise exception '0042: the canonical grammar accepts an absolute url';
  end if;

  -- The constraint, the unique index and the trigger are actually attached.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.media'::regclass and conname = 'media_storage_path_canonical'
  ) then
    raise exception '0042: media_storage_path_canonical is not attached';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'media_storage_path_unique'
  ) then
    raise exception '0042: media_storage_path_unique is not attached';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.media'::regclass
      and tgname = 'content_share_storage_path_change_media'
      and not tgisinternal
  ) then
    raise exception '0042: the storage_path change trigger is not attached';
  end if;
  -- The five pre-existing rights downgrade triggers survived the invalidator
  -- being dropped and recreated with a new signature.
  if (
    select count(*) from pg_trigger
    where tgname like 'content_share_rights_downgrade_%' and not tgisinternal
  ) <> 5 then
    raise exception '0042: the five rights downgrade triggers are not all attached';
  end if;

  -- The read path stayed service-role only.
  if has_function_privilege('anon', 'public.read_public_share(uuid, bytea)', 'execute')
     or has_function_privilege('authenticated', 'public.read_public_share(uuid, bytea)', 'execute') then
    raise exception '0042: read_public_share is executable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.read_public_share(uuid, bytea)', 'execute') then
    raise exception '0042: read_public_share is not executable by the service role';
  end if;
  if has_function_privilege('authenticated',
       'public.content_share_invalidate_dependents(text, uuid, uuid, uuid, text)', 'execute') then
    raise exception '0042: the invalidator is executable by authenticated';
  end if;
  -- The writing roles must KEEP execute on the validator: a CHECK constraint is
  -- evaluated with the writer's privileges, so losing it breaks every media
  -- write with a permission error rather than a constraint violation.
  if not has_function_privilege('authenticated', 'public.is_canonical_media_path(text, uuid)', 'execute') then
    raise exception '0042: authenticated lost execute on the path validator; media writes would fail 42501';
  end if;

  -- The constraint bites through the function, proved rather than assumed.
  create temporary table zz_0042_probe (
    club_id uuid,
    storage_path text
      check (storage_path is null or public.is_canonical_media_path(storage_path, club_id))
  ) on commit drop;
  begin
    insert into zz_0042_probe values (v_club, 'avatars/' || v_club::text || '/face.jpg');
    raise exception '0042: a constraint backed by the validator did not refuse a bad path';
  exception when check_violation then null;
  end;
  insert into zz_0042_probe values (v_club, v_club::text || '/ok-file.png');

  -- The audit vocabulary gained exactly one value and kept its closed shape.
  if not public.content_share_metadata_ok(jsonb_build_object('reason_code', 'path_changed')) then
    raise exception '0042: path_changed is not an accepted reason code';
  end if;
  if public.content_share_metadata_ok(jsonb_build_object('reason_code', 'anything_else')) then
    raise exception '0042: the reason code allow list is not closed';
  end if;
  if public.content_share_metadata_ok(jsonb_build_object('storage_path', 'x')) then
    raise exception '0042: the metadata allow list accepts an unlisted key';
  end if;

  -- Every existing row satisfies the new invariant (belt and braces: the
  -- constraint was added validated, so this can only fail if it was not).
  if exists (
    select 1 from public.media
    where storage_path is not null
      and not public.is_canonical_media_path(storage_path, club_id)
  ) then
    raise exception '0042: an existing media row violates the canonical path invariant';
  end if;
end;
$$;

commit;
