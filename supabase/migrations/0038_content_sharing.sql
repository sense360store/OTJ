-- =====================================================================
-- OTJ Training Hub, migration 0038_content_sharing: the rights model,
-- sharing capabilities and the secure public share substrate
-- (Content Sharing PR 1)
--
-- REVIEW REQUIRED. This is the security substrate for later public content
-- sharing. It touches the security boundary in five ways: a new content
-- rights classification and its backfill; two new capabilities and their
-- role grants; a per club public sharing kill switch; two private tables
-- (content_shares, content_share_dependencies) with NO client policy and NO
-- client grant; and a service role only lifecycle RPC plus a sharing audit
-- writer and a rights downgrade invalidation trigger. Migrations are gated.
-- Run by hand via the connector after line by line review, and only once the
-- live ledger is confirmed to have this slot free. Do not auto-merge. No
-- Edge Function, no public route and no anonymous access is added here.
--
-- NO VISIBLE FEATURE SHIPS. There is no public read path, no public Edge
-- Function and no public route in this migration. Public reading is PR 2. The
-- kill switch defaults OFF, so even the lifecycle create path fails closed on
-- a fresh club until an admin turns it on.
--
-- Numbering: confirmed 0038. Evidence, gathered read only on 2026-07-21:
--   * Files on disk end at 0037_audit_rollout.sql (gaps at 0003, 0004, 0010;
--     0033_players_legacy_columns.sql is present on disk but is the
--     deliberately unapplied legacy column drop, so its slot is taken).
--   * The live hosted ledger (list_migrations, project uynorsnrvocksgqweucu,
--     read only) ends at 20260721080146 audit_rollout, and does NOT contain
--     players_legacy_columns: 0033 remains merged but intentionally unapplied
--     and MUST remain absent (this migration neither applies nor alters it).
--   * A merged but unapplied migration counts as a taken slot, so 0033 is
--     occupied and the next free number from disk and the ledger together is
--     0038. Per the standing rule the ledger is the authority and is
--     re-confirmed at apply time.
--
-- WHAT THIS IS, and what it deliberately is not:
--   1. A content rights vocabulary (internal_only / public_link_only /
--      public_full) as a Postgres enum, applied to media, drills, sessions,
--      programmes and templates, with a fail closed default and a backfill.
--   2. Two capabilities, shares.create and shares.manage, and their grants.
--   3. A per club kill switch, clubs.public_sharing_enabled, default false.
--   4. content_shares: the private table for future public share records,
--      hashed fragment secret only, one active share per source, no client
--      access at all.
--   5. content_share_dependencies: the private reverse dependency index.
--   6. manage_content_share: the service role only lifecycle RPC (create,
--      refresh, rotate, revoke), the final authority, re-validating the
--      passed actor's club, sharing capability, source capability, source
--      ownership and source club inside the transaction.
--   7. The rights downgrade path: a trigger that invalidates exactly the
--      dependent active shares when an item drops to internal_only.
--   8. The sharing audit writer and its safe metadata allow list.
-- It builds NO public read logic, NO snapshot projection (PR 2 owns the
-- snapshot builders; this migration stores a minimal non-public placeholder
-- so a created share carries no content that could leak), and NO Edge
-- Function.
--
-- FAIL CLOSED THROUGHOUT. Rights default to internal_only; the kill switch
-- defaults off; a missing or unknown nested item blocks an aggregate; the
-- two tables have no client policy and no client grant; the lifecycle RPC is
-- service role only and re-derives authority from the passed actor id; and
-- the sharing audit metadata is an allow list, never free text.
--
-- FOUNDATION SQL CONVENTIONS followed throughout (the 0028 / 0029 / 0030 /
-- 0037 form): every privileged function is SECURITY DEFINER with
-- set search_path = '' and fully schema qualified references; EXECUTE is
-- revoked from public, anon and authenticated on every private function
-- (service_role kept only where a trusted server caller needs it); grants are
-- explicit; and the migration self verifies with a DO block before it
-- commits. One transaction (implicit; the connector wraps the file).
-- =====================================================================

-- =====================================================================
-- PART 1: rights vocabulary, columns and backfill
-- =====================================================================

-- The authoritative rights classification for shareable content and media.
-- A Postgres enum makes an unknown value impossible: the type system refuses
-- anything outside the three words, for every writer including the service
-- role, so eligibility can never be decided on a value the model does not
-- know. Semantics:
--   * internal_only: never leaves the club. It cannot be included in a public
--     share, and it blocks an aggregate public share if nested. The default
--     for England Football derived content and for unclassified media.
--   * public_link_only: a metadata or text projection may be shareable, but
--     binary or downloadable media must not be exported as a downloadable
--     public file. Exact enforcement is completed in the PR 2 snapshot
--     builders; here it is a stored classification only.
--   * public_full: eligible for public projection and eligible media
--     delivery, still subject to the PR 2 snapshot allow lists.
create type public.content_rights as enum ('internal_only', 'public_link_only', 'public_full');

comment on type public.content_rights is
  $$The rights classification for shareable content and media (0038_content_sharing.sql). internal_only never leaves the club and blocks a nested aggregate; public_link_only allows a metadata or text projection but not binary media export; public_full is eligible for public projection, subject to the PR 2 snapshot allow lists. An enum so an unknown value is impossible. Default internal_only on every carrying table (fail closed). See docs/security/content-sharing-boundary.md.$$;

-- The source kind of a public share: exactly the three shareable top level
-- entities. A separate enum from content_rights.
create type public.content_share_kind as enum ('drill', 'session', 'programme');

comment on type public.content_share_kind is
  $$The source kind of a public share row: drill, session or programme (0038_content_sharing.sql). Exactly one of content_shares.drill_id, session_id or programme_id is set and must match this kind.$$;

-- The FA classifier, mirroring src/lib/fa.ts isFaUrl exactly: a URL is FA
-- derived when its host is one of the two England Football Learning hosts.
-- Immutable and argument only, so it is legal in the backfill and the self
-- verification. It is used to PROVE the FA backfill invariant, not to relax
-- it: any FA derived row must end internal_only.
create or replace function public.content_rights_is_fa_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
    and lower(coalesce(substring(p_url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), ''))
        in ('learn.englandfootball.com', 'cdn.englandfootball.com')
$$;

comment on function public.content_rights_is_fa_url(text) is
  $$True when a URL's host is an England Football Learning host (learn.englandfootball.com or cdn.englandfootball.com), mirroring src/lib/fa.ts isFaUrl. Used by the 0038 rights backfill and self verification to prove FA derived content is internal_only. See docs/security/content-sharing-boundary.md.$$;

-- The rights column on every carrying table. NOT NULL with a fail closed
-- default of internal_only, so adding the column sets every existing row to
-- internal_only and every future insert that does not classify itself is
-- internal_only too. This is the safe baseline; the backfill below promotes
-- only the narrow, evidenced club original CONTENT case.
alter table public.media      add column rights public.content_rights not null default 'internal_only';
alter table public.drills     add column rights public.content_rights not null default 'internal_only';
alter table public.sessions   add column rights public.content_rights not null default 'internal_only';
alter table public.programmes add column rights public.content_rights not null default 'internal_only';
alter table public.templates  add column rights public.content_rights not null default 'internal_only';

-- ---------------------------------------------------------------------
-- BACKFILL RULES, stated precisely (documented in
-- docs/security/content-sharing-boundary.md):
--
--   * MEDIA: every existing media row is internal_only. Media is where the
--     FA rights concentrate (images, PDFs, Vimeo embeds, and the downloaded
--     FA MP4 bytes stored in the private bucket by faAttach.ts), and
--     unclassified uploaded media defaults internal_only. No media is
--     promoted; the column default already set every row internal_only, so
--     no media UPDATE is needed. Stored FA video bytes therefore stay
--     internal_only, as required.
--
--   * CONTENT (drills, sessions, programmes, templates): a row is promoted to
--     public_full ONLY when it carries NO third party source evidence at all,
--     i.e. source_url IS NULL AND source_label IS NULL (AND source_key IS
--     NULL for drills). Any row with a source_url, a source_label or (drills)
--     a source_key stays internal_only. This means:
--       - FA derived content (an FA source_url) stays internal_only.
--       - Non FA third party sourced content stays internal_only
--         (unknown/unclassified third party fails closed).
--       - Club original content with no recorded source becomes public_full,
--         the roadmap approved safe club original default (decision 2), so
--         PR 2 public drill sharing has eligible content to work with.
--     Absent source is treated as club original per the roadmap's explicit
--     approval; the residual (third party text pasted into a no source field)
--     is a known limitation controlled by the PR 2 preview, recorded in the
--     boundary doc. New content created after this migration is internal_only
--     by the column default until explicitly classified (fail closed).
-- ---------------------------------------------------------------------
update public.drills
  set rights = 'public_full'
  where source_url is null and source_label is null and source_key is null;

update public.sessions
  set rights = 'public_full'
  where source_url is null and source_label is null;

update public.programmes
  set rights = 'public_full'
  where source_url is null and source_label is null;

update public.templates
  set rights = 'public_full'
  where source_url is null and source_label is null;

comment on column public.media.rights is
  $$Content rights classification (0038_content_sharing.sql). Every existing media row is internal_only (media is where FA rights concentrate; unclassified uploads default internal_only), including stored FA video bytes. New media defaults internal_only. See docs/security/content-sharing-boundary.md.$$;
comment on column public.drills.rights is
  $$Content rights classification (0038_content_sharing.sql). Backfilled public_full only when source_url, source_label and source_key are all null (club original); any sourced drill (FA or other) stays internal_only. New drills default internal_only. See docs/security/content-sharing-boundary.md.$$;

-- =====================================================================
-- PART 2: sharing capabilities and grants
-- =====================================================================

-- The catalogue grows from twenty to twenty two. shares.create lets a coach
-- create and manage public shares of content they own; shares.manage gives
-- managers and admins club wide oversight (revoke any club share, and, in PR
-- 5, review what a share exposes). shares.manage is a content style
-- management capability, NOT a reserved administrative one: users.manage and
-- club.manage remain the only reserved keys (role_capabilities_guard_reserved
-- from 0015 is unchanged), so shares.manage is freely grantable to the
-- manager role, which the grants below and the security suite both prove.
insert into public.capabilities (key, label, description) values
  ('shares.create', 'Create shares', 'Create and manage public share links for content you own.'),
  ('shares.manage', 'Manage shares', 'Oversee and revoke any public share link in the club.')
on conflict (key) do nothing;

-- Default grants, seeded onto each club's system roles by key (the 0030
-- model). Approved matrix:
--   admin   : shares.create, shares.manage
--   manager : shares.create, shares.manage
--   coach   : shares.create
--   parent  : neither
-- On a fresh LOCAL reset the club and its system roles do not exist yet
-- (migrations run before supabase/seed.sql creates the demo club), so this is
-- a harmless no-op locally and the seed's own broad pattern grants the same
-- matrix for the local demo club. On the HOSTED project the club and roles
-- exist, so this seeds the intended matrix. The self verification tolerates
-- both states.
insert into public.role_capabilities (role_id, capability)
select r.id, g.capability
from public.roles r
join (values
  ('admin',   'shares.create'),
  ('admin',   'shares.manage'),
  ('manager', 'shares.create'),
  ('manager', 'shares.manage'),
  ('coach',   'shares.create')
) as g(role_key, capability) on g.role_key = r.key
where r.system
on conflict do nothing;

-- =====================================================================
-- PART 3: the per club public sharing kill switch
-- =====================================================================

-- A club level lever the PR 2 public read will check after resolving a
-- share's club, so a club can turn public reads off instantly in an incident
-- without touching any share row. Default false for safety: public sharing is
-- OFF on every club until an admin turns it on. Changing it is governed by
-- the existing clubs_update_manage policy (0012), which requires club.manage,
-- a capability reserved to admin, so only an admin can flip it; managers,
-- coaches and parents cannot. In this migration only the schema and the
-- lifecycle checks exist; the public read check is PR 2.
alter table public.clubs
  add column public_sharing_enabled boolean not null default false;

comment on column public.clubs.public_sharing_enabled is
  $$Per club kill switch for public content sharing (0038_content_sharing.sql). Default false: public sharing is off until an admin enables it. The lifecycle RPC refuses create, refresh and rotate while it is false (revoke stays allowed); the PR 2 public read will also check it. Changed only through clubs_update_manage (club.manage, admin only). See docs/security/content-sharing-boundary.md.$$;

-- =====================================================================
-- PART 4: content_shares, the private public share record
-- =====================================================================

-- One row per public share. Private in the strongest sense: RLS is enabled,
-- there is NO client policy of any kind, and NO client grant, so neither anon
-- nor authenticated (not even a shares.manage holder) can read or write it
-- through PostgREST. It is reached only through the service role gated
-- lifecycle RPC (as the definer function's owner) and, in PR 2, the read
-- path. The stored secret is a SHA-256 hash only; there is no plaintext or
-- reversible secret column. The snapshot is a minimal non-public placeholder
-- in PR 1 and is cleared to null on revoke (a check constraint pins that).
create table public.content_shares (
  id             uuid primary key default gen_random_uuid(),
  -- Derived server side from the source, never from a client. Cascades with
  -- the tenancy.
  club_id        uuid not null references public.clubs (id) on delete cascade,
  kind           public.content_share_kind not null,
  -- Exactly one source foreign key is non-null, and it matches kind (checks
  -- below). on delete cascade so deleting the source removes the share, the
  -- cheapest way to guarantee a deleted source leaves no live share; the
  -- audit event records the durable source id independently and survives.
  drill_id       uuid references public.drills (id) on delete cascade,
  session_id     uuid references public.sessions (id) on delete cascade,
  programme_id   uuid references public.programmes (id) on delete cascade,
  -- The SHA-256 of the raw fragment secret, always exactly 32 bytes. The raw
  -- secret is generated by the trusted caller and returned to the owner only
  -- on create or rotate; it is never stored, logged or returned by the RPC.
  token_hash     bytea not null,
  -- Set by create so a lost response retry with the same key resolves to the
  -- same row rather than creating another (idempotency index below).
  idempotency_key text,
  snapshot_version integer not null default 1,
  -- The stored safe public projection. In PR 1 this is a minimal placeholder
  -- carrying no content (PR 2 owns the real builders). Cleared to null on
  -- revoke and on rights invalidation, in the same transaction, so no free
  -- text that evaded a future preview persists past the share's live life.
  snapshot       jsonb,
  -- The person columns are on delete set null, not the default no action:
  -- remove-user deletes the profiles row, and no action would block removing
  -- any member who ever created or revoked a share (the 0001 and 0012
  -- precedent). Who shared what survives via the audit actor_name snapshot.
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,
  revoked_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  refreshed_at   timestamptz,
  rotated_at     timestamptz,
  -- Nullable: null means never expire, allowed only for a shares.manage
  -- holder (enforced in the RPC). A coach's share always carries a future
  -- expiry, defaulting to 90 days.
  expires_at     timestamptz,
  revoked_at     timestamptz,
  constraint content_shares_exactly_one_source check (
    (drill_id is not null)::int + (session_id is not null)::int + (programme_id is not null)::int = 1
  ),
  constraint content_shares_kind_matches_source check (
    (kind = 'drill'     and drill_id     is not null and session_id is null and programme_id is null) or
    (kind = 'session'   and session_id   is not null and drill_id   is null and programme_id is null) or
    (kind = 'programme' and programme_id is not null and drill_id   is null and session_id   is null)
  ),
  -- The secret is a SHA-256 digest: exactly 32 bytes, a fixed validated
  -- format, for every writer.
  constraint content_shares_token_hash_is_sha256 check (octet_length(token_hash) = 32),
  constraint content_shares_snapshot_version_positive check (snapshot_version >= 1),
  constraint content_shares_idempotency_key_bounded check (
    idempotency_key is null or char_length(idempotency_key) between 1 and 200
  ),
  -- A revoked share holds no snapshot, at the schema level, for every writer.
  -- This makes "snapshot cleared on revoke" a constraint, not just RPC
  -- behaviour.
  constraint content_shares_revoked_snapshot_cleared check (revoked_at is null or snapshot is null)
);

comment on table public.content_shares is
  $$Private public share records (0038_content_sharing.sql). RLS enabled, NO client policy and NO client grant: neither anon nor authenticated, not even a shares.manage holder, can read or write it. Reached only through the service role gated manage_content_share RPC and, in PR 2, the public read path. Stores only a SHA-256 token hash (no plaintext or reversible secret), one active share per source (partial unique indexes), and a minimal non-public snapshot placeholder cleared on revoke. See docs/security/content-sharing-boundary.md.$$;

-- One active (non-revoked) public share per source entity, enforced by three
-- partial unique indexes, one per nullable source column. A single index
-- cannot span three nullable columns, so all three are spelled out. An
-- expired but not yet revoked share still holds the slot (it is refreshable);
-- a revoked share frees it.
create unique index content_shares_one_active_drill
  on public.content_shares (drill_id) where drill_id is not null and revoked_at is null;
create unique index content_shares_one_active_session
  on public.content_shares (session_id) where session_id is not null and revoked_at is null;
create unique index content_shares_one_active_programme
  on public.content_shares (programme_id) where programme_id is not null and revoked_at is null;

-- Idempotency: a given key is unique per source, so a repeat create with the
-- same key resolves to the existing row rather than acting again.
create unique index content_shares_idempotency
  on public.content_shares (coalesce(session_id, drill_id, programme_id), idempotency_key)
  where idempotency_key is not null;

create index content_shares_club_idx on public.content_shares (club_id);
create index content_shares_created_by_idx on public.content_shares (created_by);

-- No client grant at all. Revoke everything the platform's default privileges
-- may have granted on the freshly created table, and grant NOTHING back. RLS
-- is enabled with no policy, so even if a grant ever leaked the table would
-- still refuse every browser role; the definer RPC reaches it as its owner
-- and the service role bypasses RLS for the PR 2 read path.
revoke all on public.content_shares from anon, authenticated;
alter table public.content_shares enable row level security;
-- No insert, update, delete or select policy. Deliberate and permanent for
-- every client role.

-- =====================================================================
-- PART 5: content_share_dependencies, the private reverse dependency index
-- =====================================================================

-- Every nested entity a share depends on, so a rights downgrade or a source
-- change can find and invalidate exactly the dependent shares without
-- scanning snapshot JSON and without a global sweep. Records nested items
-- only (the source itself lives in content_shares' source columns; the
-- downgrade path checks both). Same private posture as content_shares: RLS on,
-- no client policy, no client grant.
create table public.content_share_dependencies (
  id             uuid primary key default gen_random_uuid(),
  share_id       uuid not null references public.content_shares (id) on delete cascade,
  club_id        uuid not null references public.clubs (id) on delete cascade,
  -- One of the nested kinds. No 'session' kind: a session is only ever a
  -- source, never nested.
  dependency_kind text not null
    constraint content_share_dependencies_kind_check
      check (dependency_kind in ('drill', 'template', 'programme', 'media', 'board')),
  -- The nested entity id. Deliberately NO foreign key: the row is used to
  -- decide that a share must go when the nested entity is deleted, and a real
  -- FK cascade would race that decision. Deletion is handled by the read path
  -- and refresh, not by a cascade on this column.
  dependency_id  uuid not null,
  -- The rights class observed when the snapshot was built (null for a board,
  -- which carries no rights). Lets a later downgrade be detectable by
  -- comparison as well as by the current class.
  rights_class_observed public.content_rights,
  created_at     timestamptz not null default now(),
  -- A share lists each dependency once.
  constraint content_share_dependencies_unique unique (share_id, dependency_kind, dependency_id)
);

comment on table public.content_share_dependencies is
  $$Private reverse dependency index for public shares (0038_content_sharing.sql). Records the nested drills, templates, media and boards a share depends on, so a rights downgrade invalidates exactly the dependent shares by reverse lookup. RLS enabled, NO client policy and NO client grant; written transactionally by the lifecycle RPC and cascaded away with its share. See docs/security/content-sharing-boundary.md.$$;

-- Reverse lookup from a changed dependency to its dependent shares, and the
-- forward lookup by share.
create index content_share_dependencies_reverse
  on public.content_share_dependencies (club_id, dependency_kind, dependency_id);
create index content_share_dependencies_share
  on public.content_share_dependencies (share_id);

revoke all on public.content_share_dependencies from anon, authenticated;
alter table public.content_share_dependencies enable row level security;
-- No policy of any kind, exactly like content_shares.

-- =====================================================================
-- PART 6: the sharing audit writer and its safe metadata allow list
-- =====================================================================

-- Safe metadata for sharing audit events: allow listed keys, each bounded to
-- a fixed vocabulary or a uuid, no free text, no number needed. So no secret,
-- hash, snapshot, title, path or free text can ride in. Immutable and
-- argument only.
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
                '"source_deleted"'::jsonb, '"expired_cleanup"'::jsonb
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

comment on function public.content_share_metadata_ok(jsonb) is
  $$True when a content_share audit metadata value is null or a jsonb object carrying only safe allow listed keys (source_kind, source_id, expiry_state, reason_code, initiator), each bounded to a fixed vocabulary or a uuid. No free text, so no secret, hash, snapshot, title or path can enter sharing audit metadata. Enforced by log_content_share_event. See 0038_content_sharing.sql and docs/security/app-audit-boundary.md.$$;

-- The private writer for content_share lifecycle events. Separate from
-- log_audit_event (0030) whose actor is auth.uid() only, and from
-- log_user_admin_event (0037): this one takes the verified actor and club
-- from the trusted lifecycle RPC (auth.uid() is null under the service role),
-- validates that a non-null actor is a member of the named club, resolves the
-- actor_name server side, and validates the metadata against the sharing
-- allow list. entity_type is 'content_share' and entity_id is the share; the
-- durable source kind and id ride in metadata, so who shared which item
-- resolves even after both the source and the share row are deleted. A null
-- actor is allowed for a system consequence (a rights downgrade invalidation
-- whose caller had no session). EXECUTE is revoked from public, anon and
-- authenticated and granted to service_role only.
create or replace function public.log_content_share_event(
  p_action    text,
  p_source    text,
  p_actor_id  uuid,
  p_club_id   uuid,
  p_share_id  uuid,
  p_metadata  jsonb default null
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
  if p_action not in (
    'content_share.created', 'content_share.refreshed', 'content_share.rotated',
    'content_share.revoked', 'content_share.invalidated', 'content_share.expired'
  ) then
    raise exception 'log_content_share_event: action % is not writable by this writer', p_action;
  end if;
  if p_source not in ('edge_function', 'database_trigger', 'system') then
    raise exception 'log_content_share_event: source % is not permitted', p_source;
  end if;
  if p_club_id is null then
    raise exception 'log_content_share_event: a club is required';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'log_content_share_event: the named club does not exist';
  end if;
  -- A non-null actor must be a real member of the named club (defence in
  -- depth against a forged actor); a null actor is a system event with no
  -- name.
  if p_actor_id is not null then
    select pr.full_name into v_actor_name
    from public.profiles pr
    where pr.id = p_actor_id and pr.club_id = p_club_id;
    if not found then
      raise exception 'log_content_share_event: the actor is not a member of the named club';
    end if;
  end if;
  if not public.content_share_metadata_ok(p_metadata) then
    raise exception 'log_content_share_event: metadata carries a value outside the safe allow list';
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, source, metadata
  )
  values (
    p_club_id, now(), p_actor_id, v_actor_name, p_action, 'content_share',
    p_share_id, p_source, p_metadata
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

comment on function public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb) is
  $$Private SECURITY DEFINER writer for content_share.* lifecycle audit events, called inside manage_content_share and the rights downgrade trigger. The actor and club are the verified values the trusted caller passed; a non-null actor is validated to be a member of the named club and the actor_name is resolved server side. Metadata is validated against content_share_metadata_ok (allow listed safe scalars only). Never accepts a secret, hash, snapshot or free text. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0038_content_sharing.sql and docs/security/app-audit-boundary.md.$$;

revoke execute on function public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb) to service_role;

-- =====================================================================
-- PART 7: internal authorisation and dependency helpers
-- =====================================================================

-- Does the passed actor hold a capability? has_perm reads auth.uid(), which
-- is null under the service role, so the lifecycle RPC cannot use it; this
-- helper answers the same question for an explicit actor id by joining
-- member_roles into role_capabilities. Private: only the definer RPC calls it.
create or replace function public.content_share_actor_has_cap(p_actor uuid, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_roles mr
    join public.role_capabilities rc on rc.role_id = mr.role_id
    where mr.member_id = p_actor
      and rc.capability = p_cap
  );
$$;

comment on function public.content_share_actor_has_cap(uuid, text) is
  $$Whether an explicit actor holds a capability, joining member_roles into role_capabilities. Used by manage_content_share because has_perm is auth.uid() bound and auth.uid() is null under the service role. Private (no client EXECUTE). See 0038_content_sharing.sql.$$;

revoke execute on function public.content_share_actor_has_cap(uuid, text) from public, anon, authenticated;

-- The nested dependency set for a source: every nested drill, template, media
-- and board the source projects, with its current rights class and whether
-- the referenced row still exists. A board carries no rights (null). Used by
-- the lifecycle RPC to evaluate aggregate eligibility (fail closed on a
-- missing item or an internal_only item) and to write the dependency rows.
-- SECURITY DEFINER so it reads the club content tables without their RLS; the
-- RPC has already bound the source to the actor's club, so no cross club id
-- can reach here. Private: only the definer RPC calls it.
create or replace function public.content_share_deps(
  p_kind      public.content_share_kind,
  p_source_id uuid
)
returns table (dep_kind text, dep_id uuid, dep_rights public.content_rights, dep_exists boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'drill' then
    -- The drill's own media.
    return query
      select 'media'::text, d.media_id, m.rights, (m.id is not null)
      from public.drills d
      left join public.media m on m.id = d.media_id
      where d.id = p_source_id and d.media_id is not null;

  elsif p_kind = 'session' then
    -- Nested drills from the activities jsonb (drill_id key; custom
    -- activities carry a title and no drill_id and are skipped).
    return query
      with acts as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.sessions s, lateral jsonb_array_elements(s.activities) a
        where s.id = p_source_id and nullif(a->>'drill_id', '') is not null
      )
      select 'drill'::text, acts.drill_id, d.rights, (d.id is not null)
      from acts left join public.drills d on d.id = acts.drill_id;
    -- The media of those nested drills.
    return query
      with acts as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.sessions s, lateral jsonb_array_elements(s.activities) a
        where s.id = p_source_id and nullif(a->>'drill_id', '') is not null
      ),
      dm as (
        select distinct d.media_id
        from acts join public.drills d on d.id = acts.drill_id
        where d.media_id is not null
      )
      select 'media'::text, dm.media_id, m.rights, (m.id is not null)
      from dm left join public.media m on m.id = dm.media_id;
    -- The attached board (shape and numbers only; no rights class).
    return query
      select 'board'::text, s.board_id, null::public.content_rights, (b.id is not null)
      from public.sessions s
      left join public.boards b on b.id = s.board_id
      where s.id = p_source_id and s.board_id is not null;

  elsif p_kind = 'programme' then
    -- Nested templates (programme weeks).
    return query
      select 'template'::text, t.id, t.rights, true
      from public.templates t
      where t.programme_id = p_source_id;
    -- Nested drills across those templates.
    return query
      with td as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.templates t, lateral jsonb_array_elements(t.activities) a
        where t.programme_id = p_source_id and nullif(a->>'drill_id', '') is not null
      )
      select 'drill'::text, td.drill_id, d.rights, (d.id is not null)
      from td left join public.drills d on d.id = td.drill_id;
    -- The media of those drills.
    return query
      with td as (
        select distinct (a->>'drill_id')::uuid as drill_id
        from public.templates t, lateral jsonb_array_elements(t.activities) a
        where t.programme_id = p_source_id and nullif(a->>'drill_id', '') is not null
      ),
      dm as (
        select distinct d.media_id
        from td join public.drills d on d.id = td.drill_id
        where d.media_id is not null
      )
      select 'media'::text, dm.media_id, m.rights, (m.id is not null)
      from dm left join public.media m on m.id = dm.media_id;
    -- The programme's attached PDF (treated as media).
    return query
      select 'media'::text, p.pdf_media_id, m.rights, (m.id is not null)
      from public.programmes p
      left join public.media m on m.id = p.pdf_media_id
      where p.id = p_source_id and p.pdf_media_id is not null;
  end if;
end;
$$;

comment on function public.content_share_deps(public.content_share_kind, uuid) is
  $$The nested dependency set (drills, templates, media, boards) a share source projects, with each item's current rights class and existence. Used by manage_content_share to evaluate aggregate eligibility (fail closed on a missing or internal_only item) and to write the dependency rows. Private (no client EXECUTE). See 0038_content_sharing.sql.$$;

revoke execute on function public.content_share_deps(public.content_share_kind, uuid) from public, anon, authenticated;

-- =====================================================================
-- PART 8: the lifecycle RPC, the final authority
-- =====================================================================

-- manage_content_share is the single service role only lifecycle function for
-- create, refresh, rotate and revoke. It is the FINAL authority: it gates on
-- the service role, then re-validates the whole authorisation inside this one
-- transaction against the PASSED actor id (auth.uid() is null under the
-- service role), so a capability revoked between a future Edge Function's
-- early check and this call fails closed here. Every state change and its
-- audit event commit together (a function is one transaction). No secret,
-- snapshot or free text is logged or returned; the raw secret is the trusted
-- caller's to return to the owner on create or rotate, never this function's.
--
-- Design for PR 1: PR 2 owns the snapshot builders, so create and refresh
-- store a MINIMAL non-public placeholder snapshot that carries no content and
-- cannot be publicly consumed. The security relevant behaviour (authority,
-- aggregate rights eligibility, dependency recording, one active share,
-- idempotency, kill switch, audit) is fully implemented and testable now.
create or replace function public.manage_content_share(
  p_action          text,
  p_actor_id        uuid,
  p_kind            public.content_share_kind default null,
  p_source_id       uuid        default null,
  p_share_id        uuid        default null,
  p_secret_hash     bytea       default null,
  p_expires_at      timestamptz default null,
  p_no_expiry       boolean     default false,
  p_idempotency_key text        default null
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

    -- Resolve the source, its club, owner and rights.
    if p_kind = 'drill' then
      select d.club_id, d.created_by, d.rights into v_source_club, v_source_owner, v_source_rights
      from public.drills d where d.id = p_source_id;
    elsif p_kind = 'session' then
      select s.club_id, s.coach_id, s.rights into v_source_club, v_source_owner, v_source_rights
      from public.sessions s where s.id = p_source_id;
    else
      select p.club_id, p.created_by, p.rights into v_source_club, v_source_owner, v_source_rights
      from public.programmes p where p.id = p_source_id;
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

    -- Idempotency: a repeat with the same key returns the existing row.
    select cs.id into v_existing from public.content_shares cs
    where cs.idempotency_key = p_idempotency_key
      and coalesce(cs.session_id, cs.drill_id, cs.programme_id) = p_source_id;
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
    for v_dep in select * from public.content_share_deps(p_kind, p_source_id) loop
      if not v_dep.dep_exists then
        raise exception 'manage_content_share: a nested % is missing; the share is blocked', v_dep.dep_kind;
      end if;
      if v_dep.dep_rights is not null and v_dep.dep_rights = 'internal_only' then
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

    -- The minimal non-public placeholder snapshot. It carries NO content; PR
    -- 2 replaces it with the real safe projection. It cannot be publicly
    -- consumed (there is no public read path, and it holds no fields).
    v_snapshot := jsonb_build_object(
      'snapshotVersion', 1, 'kind', p_kind::text, 'builder', 'pending', 'public', false
    );

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
        p_secret_hash, p_idempotency_key, 1, v_snapshot, p_actor_id, p_actor_id,
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
          and coalesce(cs.session_id, cs.drill_id, cs.programme_id) = p_source_id;
      end if;
      return jsonb_build_object('ok', true, 'action', 'create', 'share_id', v_existing, 'existing', true);
    end;

    -- Write the dependency rows for the built snapshot (deduped by the unique
    -- constraint).
    insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id, rights_class_observed)
    select v_new_id, v_club, dep_kind, dep_id, dep_rights
    from public.content_share_deps(p_kind, p_source_id)
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
  -- Re-resolve source rights.
  if v_share.kind = 'drill' then
    select d.club_id, d.rights into v_source_club, v_source_rights from public.drills d where d.id = v_share.drill_id;
  elsif v_share.kind = 'session' then
    select s.club_id, s.rights into v_source_club, v_source_rights from public.sessions s where s.id = v_share.session_id;
  else
    select p.club_id, p.rights into v_source_club, v_source_rights from public.programmes p where p.id = v_share.programme_id;
  end if;
  if v_source_club is null then
    raise exception 'manage_content_share: the source no longer exists';
  end if;
  if v_source_rights = 'internal_only' then
    raise exception 'manage_content_share: the source is now internal_only; refresh is blocked';
  end if;
  for v_dep in select * from public.content_share_deps(
      v_share.kind, coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id)) loop
    if not v_dep.dep_exists then
      raise exception 'manage_content_share: a nested % is missing; refresh is blocked', v_dep.dep_kind;
    end if;
    if v_dep.dep_rights is not null and v_dep.dep_rights = 'internal_only' then
      raise exception 'manage_content_share: a nested % is internal_only; refresh is blocked', v_dep.dep_kind;
    end if;
  end loop;

  -- Replace the dependency set atomically and rebuild the placeholder
  -- snapshot. Recompute expiry: extend a bounded share by 90 days from now, or
  -- keep a never-expiry share as never.
  delete from public.content_share_dependencies where share_id = p_share_id;
  insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id, rights_class_observed)
  select p_share_id, v_club, dep_kind, dep_id, dep_rights
  from public.content_share_deps(v_share.kind, coalesce(v_share.drill_id, v_share.session_id, v_share.programme_id))
  on conflict (share_id, dependency_kind, dependency_id) do nothing;

  v_snapshot := jsonb_build_object(
    'snapshotVersion', 1, 'kind', v_share.kind::text, 'builder', 'pending', 'public', false
  );
  update public.content_shares
    set snapshot = v_snapshot, refreshed_at = now(), updated_by = p_actor_id, updated_at = now(),
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

comment on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text) is
  $$The service role only content share lifecycle RPC (create, refresh, rotate, revoke). The final authority: it gates on the service role, then re-validates the passed actor's club membership, sharing capability, source capability, source ownership and source club inside the one transaction (auth.uid() is null under the service role, so has_perm cannot be used). Enforces one active share per source, idempotent create, the kill switch (create/refresh/rotate fail while off; revoke stays allowed), aggregate rights eligibility (fail closed), and refresh/rotate owner-only (a manager may revoke any club share but never rotate another owner's link). Stores a SHA-256 hash only and a minimal non-public snapshot placeholder; never logs or returns a secret, hash or snapshot. EXECUTE revoked from public, anon and authenticated; granted to service_role only. See 0038_content_sharing.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text) to service_role;

-- =====================================================================
-- PART 9: rights downgrade invalidation
-- =====================================================================

-- When a content or media item drops to internal_only, every active share
-- that depends on it (as its source, or as a nested item) is invalidated in
-- the same transaction: revoked_at set, snapshot cleared, dependency rows
-- removed, and a content_share.invalidated audit event written. Only the
-- dependent shares are touched, found through the source columns and the
-- reverse dependency index, never by a global sweep or a snapshot scan.
-- SECURITY DEFINER so it writes the private tables as their owner; private
-- (no client EXECUTE), called only by the rights triggers below.
create or replace function public.content_share_invalidate_dependents(
  p_entity_kind text,
  p_entity_id   uuid,
  p_actor       uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share record;
begin
  for v_share in
    -- Shares whose SOURCE is this entity (drill, session or programme), and
    -- shares that NEST this entity (via the reverse dependency index). Union
    -- so each affected active share is handled once.
    select cs.id, cs.club_id, cs.kind, cs.created_by,
           coalesce(cs.drill_id, cs.session_id, cs.programme_id) as source_id
    from public.content_shares cs
    where cs.revoked_at is null
      and (
        (p_entity_kind = 'drill'     and cs.drill_id     = p_entity_id) or
        (p_entity_kind = 'session'   and cs.session_id   = p_entity_id) or
        (p_entity_kind = 'programme' and cs.programme_id = p_entity_id) or
        cs.id in (
          select dep.share_id from public.content_share_dependencies dep
          where dep.dependency_kind = p_entity_kind and dep.dependency_id = p_entity_id
        )
      )
  loop
    update public.content_shares
      set revoked_at = now(), revoked_by = p_actor, updated_by = p_actor,
          updated_at = now(), snapshot = null
      where id = v_share.id;
    delete from public.content_share_dependencies where share_id = v_share.id;
    perform public.log_content_share_event(
      'content_share.invalidated', 'database_trigger', p_actor, v_share.club_id, v_share.id,
      jsonb_build_object('source_kind', v_share.kind::text, 'source_id', v_share.source_id,
                         'reason_code', 'rights_downgrade', 'initiator', 'system')
    );
  end loop;
end;
$$;

comment on function public.content_share_invalidate_dependents(text, uuid, uuid) is
  $$Invalidates exactly the active shares that depend on an entity when it drops to internal_only: revoked_at set, snapshot cleared, dependency rows removed, a content_share.invalidated event written, found through the source columns and the reverse dependency index (never a global sweep). Private (no client EXECUTE); called only by the rights downgrade triggers. See 0038_content_sharing.sql and docs/security/content-sharing-boundary.md.$$;

revoke execute on function public.content_share_invalidate_dependents(text, uuid, uuid) from public, anon, authenticated;

-- Trigger functions per carrying table, firing only on a transition to
-- internal_only (the downgrade), and passing the acting user (auth.uid(),
-- which the audit writer tolerates as null for a service role change). A
-- trigger is used, not an explicit function call, because rights are updated
-- through the normal client UPDATE path (no Edge Function in the loop), so the
-- invalidation must ride the same transaction whatever writes the rights.
create or replace function public.audit_rights_downgrade_drills()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('drill', new.id, auth.uid());
  return new;
end;
$$;
create trigger content_share_rights_downgrade_drills
  after update of rights on public.drills
  for each row when (old.rights is distinct from new.rights and new.rights = 'internal_only')
  execute function public.audit_rights_downgrade_drills();

create or replace function public.audit_rights_downgrade_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('media', new.id, auth.uid());
  return new;
end;
$$;
create trigger content_share_rights_downgrade_media
  after update of rights on public.media
  for each row when (old.rights is distinct from new.rights and new.rights = 'internal_only')
  execute function public.audit_rights_downgrade_media();

create or replace function public.audit_rights_downgrade_sessions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('session', new.id, auth.uid());
  return new;
end;
$$;
create trigger content_share_rights_downgrade_sessions
  after update of rights on public.sessions
  for each row when (old.rights is distinct from new.rights and new.rights = 'internal_only')
  execute function public.audit_rights_downgrade_sessions();

create or replace function public.audit_rights_downgrade_programmes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('programme', new.id, auth.uid());
  return new;
end;
$$;
create trigger content_share_rights_downgrade_programmes
  after update of rights on public.programmes
  for each row when (old.rights is distinct from new.rights and new.rights = 'internal_only')
  execute function public.audit_rights_downgrade_programmes();

create or replace function public.audit_rights_downgrade_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.content_share_invalidate_dependents('template', new.id, auth.uid());
  return new;
end;
$$;
create trigger content_share_rights_downgrade_templates
  after update of rights on public.templates
  for each row when (old.rights is distinct from new.rights and new.rights = 'internal_only')
  execute function public.audit_rights_downgrade_templates();

revoke execute on function public.audit_rights_downgrade_drills() from public, anon, authenticated;
revoke execute on function public.audit_rights_downgrade_media() from public, anon, authenticated;
revoke execute on function public.audit_rights_downgrade_sessions() from public, anon, authenticated;
revoke execute on function public.audit_rights_downgrade_programmes() from public, anon, authenticated;
revoke execute on function public.audit_rights_downgrade_templates() from public, anon, authenticated;

-- =====================================================================
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended. Grant assertions phrased as "no violating row exists"
-- are vacuously true on a fresh local reset (no clubs at migration time) and
-- strict on the hosted project.
-- =====================================================================
do $$
declare
  bad integer;
begin
  -- ---- Rights vocabulary and backfill ----
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'content_rights') <> 3 then
    raise exception 'content sharing: content_rights must have exactly three values';
  end if;
  -- Every FA derived content or media row is internal_only (the FA invariant).
  select count(*) into bad from public.media m
    where (public.content_rights_is_fa_url(m.source_url) or m.source_label = 'England Football Learning')
      and m.rights <> 'internal_only';
  if bad > 0 then raise exception 'content sharing: % FA media rows are not internal_only', bad; end if;
  select count(*) into bad from public.drills d
    where (public.content_rights_is_fa_url(d.source_url) or d.source_label = 'England Football Learning')
      and d.rights <> 'internal_only';
  if bad > 0 then raise exception 'content sharing: % FA drill rows are not internal_only', bad; end if;
  -- Every media row is internal_only (media is never promoted in the backfill).
  select count(*) into bad from public.media m where m.rights <> 'internal_only';
  if bad > 0 then raise exception 'content sharing: % media rows are not internal_only', bad; end if;
  -- No content row with a source URL was promoted (only null-source content).
  select count(*) into bad from public.drills d where d.source_url is not null and d.rights = 'public_full';
  if bad > 0 then raise exception 'content sharing: % sourced drills were wrongly promoted to public_full', bad; end if;

  -- ---- Capabilities ----
  if (select count(*) from public.capabilities where key in ('shares.create', 'shares.manage')) <> 2 then
    raise exception 'content sharing: the two sharing capabilities are not both seeded';
  end if;
  if (select count(*) from public.capabilities) <> 22 then
    raise exception 'content sharing: the capability catalogue is not exactly twenty two keys';
  end if;
  if exists (select 1 from public.capabilities where key in ('shares.create', 'shares.manage') and key in ('users.manage', 'club.manage')) then
    raise exception 'content sharing: a sharing key collides with the reserved set';
  end if;
  -- Default grants (strict on hosted, vacuous locally). Admin holds both;
  -- manager holds both; coach holds shares.create but not shares.manage;
  -- parent holds neither.
  select count(*) into bad from public.roles r
    cross join (values ('shares.create'), ('shares.manage')) as k(key)
    where r.system and r.key = 'admin'
      and not exists (select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = k.key);
  if bad > 0 then raise exception 'content sharing: an admin role is missing a sharing capability'; end if;
  select count(*) into bad from public.roles r
    cross join (values ('shares.create'), ('shares.manage')) as k(key)
    where r.system and r.key = 'manager'
      and not exists (select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = k.key);
  if bad > 0 then raise exception 'content sharing: a manager role is missing a sharing capability'; end if;
  if exists (select 1 from public.roles r
             where r.system and r.key = 'coach'
               and not exists (select 1 from public.role_capabilities rc where rc.role_id = r.id and rc.capability = 'shares.create')) then
    raise exception 'content sharing: a coach role is missing shares.create';
  end if;
  if exists (select 1 from public.roles r
             join public.role_capabilities rc on rc.role_id = r.id
             where r.system and r.key = 'coach' and rc.capability = 'shares.manage') then
    raise exception 'content sharing: a coach role holds shares.manage, which it must not';
  end if;
  if exists (select 1 from public.roles r
             join public.role_capabilities rc on rc.role_id = r.id
             where r.system and r.key = 'parent' and rc.capability in ('shares.create', 'shares.manage')) then
    raise exception 'content sharing: a parent role holds a sharing capability, which it must not';
  end if;

  -- ---- Kill switch ----
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clubs' and column_name = 'public_sharing_enabled'
      and is_nullable = 'NO' and column_default like '%false%'
  ) then
    raise exception 'content sharing: clubs.public_sharing_enabled must exist, be not null and default false';
  end if;

  -- ---- Table posture: RLS on, no client grants, no policies ----
  if not (select relrowsecurity from pg_class where oid = 'public.content_shares'::regclass) then
    raise exception 'content sharing: row level security is not enabled on content_shares';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.content_share_dependencies'::regclass) then
    raise exception 'content sharing: row level security is not enabled on content_share_dependencies';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('content_shares', 'content_share_dependencies')) <> 0 then
    raise exception 'content sharing: the private tables must carry no policy';
  end if;
  if has_table_privilege('authenticated', 'public.content_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.content_shares', 'INSERT')
     or has_table_privilege('authenticated', 'public.content_shares', 'UPDATE')
     or has_table_privilege('authenticated', 'public.content_shares', 'DELETE')
     or has_table_privilege('anon', 'public.content_shares', 'SELECT') then
    raise exception 'content sharing: content_shares must hold no client grant';
  end if;
  if has_table_privilege('authenticated', 'public.content_share_dependencies', 'SELECT')
     or has_table_privilege('anon', 'public.content_share_dependencies', 'SELECT') then
    raise exception 'content sharing: content_share_dependencies must hold no client grant';
  end if;

  -- ---- Function privilege boundary ----
  if has_function_privilege('anon', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text)', 'EXECUTE') then
    raise exception 'content sharing: manage_content_share must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text)', 'EXECUTE') then
    raise exception 'content sharing: service_role must be able to execute manage_content_share';
  end if;
  if has_function_privilege('anon', 'public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'content sharing: log_content_share_event must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'content sharing: service_role must be able to execute log_content_share_event';
  end if;
  if has_function_privilege('authenticated', 'public.content_share_deps(public.content_share_kind, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_actor_has_cap(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.content_share_invalidate_dependents(text, uuid, uuid)', 'EXECUTE') then
    raise exception 'content sharing: the internal helpers must not be executable by authenticated';
  end if;

  -- ---- Downgrade triggers attached ----
  if (select count(*) from pg_trigger where not tgisinternal and tgname in (
        'content_share_rights_downgrade_drills', 'content_share_rights_downgrade_media',
        'content_share_rights_downgrade_sessions', 'content_share_rights_downgrade_programmes',
        'content_share_rights_downgrade_templates')) <> 5 then
    raise exception 'content sharing: the five rights downgrade triggers are not all attached';
  end if;

  -- ---- The audit foundation append only grants are untouched ----
  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.audit_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_events', 'DELETE') then
    raise exception 'content sharing: audit_events must still be append only for authenticated';
  end if;
end
$$;
