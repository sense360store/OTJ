// OTJ Training Hub, manage-content-share Edge Function (Content Sharing PR 2).
//
// The authenticated management function for public DRILL shares. verify_jwt is
// ON (the default; no config block). It authenticates the caller, makes an
// early capability check under the caller's identity, builds the safe public
// snapshot server side, and calls the service role lifecycle RPC
// (manage_content_share) which is the final authority and re-validates the
// whole authorisation inside its transaction.
//
// Actions: preview | create | refresh | rotate | revoke | status. Drill only.
//
// Hard rules honoured here:
//   - the actor is derived from the verified JWT, never from the request body;
//   - club and source authority are derived server side, never trusted from
//     the client; the function never accepts club_id, actor_id or a snapshot;
//   - the raw secret is generated server side and returned only on create and
//     rotate; only the SHA-256 hash reaches the RPC; the hash is never
//     returned and the secret is never logged;
//   - the snapshot is always built server side from the live rows;
//   - the lifecycle RPC (not this function) is the security boundary;
//   - logs carry status, action and ids only, never a secret, snapshot or
//     drill text.
//
// This function is review gated (a security boundary). Deploy from disk via the
// CLI and verify by reading the deployed source back byte for byte.

import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  buildDrillSnapshot,
  type ContentRights,
  type DrillRow,
  evaluateDrillEligibility,
  generateSecret,
  type MediaRow,
  SNAPSHOT_VERSION,
  secretHashLiteral,
  toPublicProjection,
} from '../_shared/share.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 8 * 1024

const DRILL_COLS =
  'id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, setup_notes, easier, harder, theme, format, source_url, source_label, media_id, rights'
const MEDIA_COLS = 'id, club_id, name, type, storage_path, yt_url, embed_url, source_url, source_label, rights'

type Action = 'preview' | 'create' | 'refresh' | 'rotate' | 'revoke' | 'status'
const ACTIONS: Action[] = ['preview', 'create', 'refresh', 'rotate', 'revoke', 'status']

interface AdminClient {
  from: (t: string) => {
    // deno-lint-ignore no-explicit-any
    select: (c: string) => any
  }
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>
}

serve()

function serve(): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

    const resolved = await resolveCaller(req)
    if ('response' in resolved) return resolved.response
    const { caller } = resolved

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return reply(503, { error: 'Sharing is not configured. No change was made.' })
    }

    // Bounded body.
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'Request too large.' })
    let body: Record<string, unknown>
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return reply(400, { error: 'Invalid request body.' })
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply(400, { error: 'Invalid request body.' })
    }

    const action = body.action
    if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
      return reply(400, { error: 'Unknown action.' })
    }

    // Strict inputs. The function never reads club_id, actor_id or a snapshot
    // from the body, even if present.
    const kind = body.kind
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId : null
    const shareId = typeof body.shareId === 'string' ? body.shareId : null
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
    const noExpiry = body.noExpiry === true
    const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null

    // Drill only in PR 2: any other kind is refused, never silently accepted.
    if ((action === 'preview' || action === 'create') && kind !== 'drill') {
      return reply(400, { error: 'Only drills can be shared publicly.' })
    }
    if (sourceId !== null && !UUID_RE.test(sourceId)) return reply(400, { error: 'Invalid source id.' })
    if (shareId !== null && !UUID_RE.test(shareId)) return reply(400, { error: 'Invalid share id.' })
    if (idempotencyKey !== null && (idempotencyKey.length < 1 || idempotencyKey.length > 200)) {
      return reply(400, { error: 'Invalid idempotency key.' })
    }
    if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
      return reply(400, { error: 'Invalid expiry.' })
    }

    // Early capability refusal under the caller's identity (a fast path, not the
    // boundary; the RPC re-validates). Revoke and status allow a manager too.
    const needsManageOrCreate = action === 'revoke' || action === 'status'
    const canCreate = await hasPerm(caller.db, 'shares.create')
    const canManage = needsManageOrCreate ? await hasPerm(caller.db, 'shares.manage') : false
    if (canCreate === null || (needsManageOrCreate && canManage === null)) {
      return reply(500, { error: 'Could not check your access. No change was made.' })
    }
    if (needsManageOrCreate) {
      if (!canCreate && !canManage) return reply(403, { error: 'You do not have access to manage public share links.' })
    } else if (!canCreate) {
      return reply(403, { error: 'Creating a public share link needs the shares.create capability.' })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as AdminClient

    try {
      switch (action) {
        case 'preview':
          return await handlePreview(admin, caller.clubId, sourceId)
        case 'create':
          return await handleCreate(admin, caller, sourceId, idempotencyKey, expiresAt, noExpiry)
        case 'refresh':
          return await handleRefresh(admin, caller, shareId)
        case 'rotate':
          return await handleRotate(admin, caller, shareId)
        case 'revoke':
          return await handleRevoke(admin, caller, shareId)
        case 'status':
          return await handleStatus(admin, caller, sourceId, canManage === true)
        default:
          return reply(400, { error: 'Unknown action.' })
      }
    } catch (err) {
      // Never surface a raw database or service role error to the client.
      console.error('manage-content-share: unexpected failure', { action, code: errCode(err) })
      return reply(500, { error: 'Something went wrong. No change was made.' })
    }
  })
}

interface Caller {
  // deno-lint-ignore no-explicit-any
  db: any
  userId: string
  clubId: string
}

// deno-lint-ignore no-explicit-any
async function hasPerm(db: any, capability: string): Promise<boolean | null> {
  const { data, error } = await db.rpc('has_perm', { capability })
  if (error) return null
  return data === true
}

// deno-lint-ignore no-explicit-any
function errCode(err: any): string {
  return (err && (err.code || err.name)) ? String(err.code || err.name) : 'unknown'
}

// Read the drill (club scoped) and its optional media. Returns a neutral 404 if
// the drill is not in the caller's club.
async function loadDrillAndMedia(
  admin: AdminClient,
  clubId: string,
  sourceId: string,
): Promise<{ drill: DrillRow; media: MediaRow | null; mediaMissing: boolean } | Response> {
  const { data: drill, error } = await admin.from('drills').select(DRILL_COLS).eq('id', sourceId).maybeSingle()
  if (error) return reply(500, { error: 'Could not read the drill. No change was made.' })
  if (!drill || drill.club_id !== clubId) return reply(404, { error: 'That drill was not found in your club.' })
  let media: MediaRow | null = null
  let mediaMissing = false
  if (drill.media_id) {
    const { data: m, error: mErr } = await admin.from('media').select(MEDIA_COLS).eq('id', drill.media_id).maybeSingle()
    if (mErr) return reply(500, { error: 'Could not read the drill media. No change was made.' })
    if (!m || m.club_id !== clubId) mediaMissing = true
    else media = m as MediaRow
  }
  return { drill: drill as DrillRow, media, mediaMissing }
}

function eligibilityWithMissing(
  drill: DrillRow,
  media: MediaRow | null,
  mediaMissing: boolean,
): { eligible: boolean; blocked: string[] } {
  const base = evaluateDrillEligibility(drill, media)
  const blocked = [...base.blocked] as string[]
  if (mediaMissing && !blocked.includes('media_missing')) blocked.push('media_missing')
  return { eligible: blocked.length === 0, blocked }
}

function rightsSummary(drill: DrillRow, media: MediaRow | null): Record<string, unknown> {
  return {
    source: drill.rights as ContentRights,
    media: media ? (media.rights as ContentRights) : null,
    hasMedia: Boolean(drill.media_id),
  }
}

async function handlePreview(admin: AdminClient, clubId: string, sourceId: string | null): Promise<Response> {
  if (!sourceId) return reply(400, { error: 'A drill is required.' })
  const loaded = await loadDrillAndMedia(admin, clubId, sourceId)
  if (loaded instanceof Response) return loaded
  const { drill, media, mediaMissing } = loaded
  const elig = eligibilityWithMissing(drill, media, mediaMissing)
  // Build the exact projection the coach would publish, using the same builder
  // as create, but only when eligible (the builder refuses restricted content).
  let preview: unknown = null
  if (elig.eligible) {
    preview = toPublicProjection(buildDrillSnapshot(drill, media, new Date().toISOString()))
  }
  return reply(200, {
    ok: true,
    eligible: elig.eligible,
    blocked: elig.blocked,
    rights: rightsSummary(drill, media),
    preview,
  })
}

async function handleCreate(
  admin: AdminClient,
  caller: Caller,
  sourceId: string | null,
  idempotencyKey: string | null,
  expiresAt: string | null,
  noExpiry: boolean,
): Promise<Response> {
  if (!sourceId) return reply(400, { error: 'A drill is required.' })
  if (!idempotencyKey) return reply(400, { error: 'An idempotency key is required.' })
  const loaded = await loadDrillAndMedia(admin, caller.clubId, sourceId)
  if (loaded instanceof Response) return loaded
  const { drill, media, mediaMissing } = loaded
  const elig = eligibilityWithMissing(drill, media, mediaMissing)
  if (!elig.eligible) {
    return reply(422, { error: 'This drill cannot be shared publicly.', blocked: elig.blocked })
  }

  const snapshot = buildDrillSnapshot(drill, media, new Date().toISOString())
  const secret = generateSecret()
  const secretHash = await secretHashLiteral(secret)

  const { data, error } = await admin.rpc('manage_content_share', {
    p_action: 'create',
    p_actor_id: caller.userId,
    p_kind: 'drill',
    p_source_id: sourceId,
    p_secret_hash: secretHash,
    p_expires_at: expiresAt,
    p_no_expiry: noExpiry,
    p_idempotency_key: idempotencyKey,
    p_snapshot: snapshot,
    p_snapshot_version: SNAPSHOT_VERSION,
  })
  if (error) {
    console.error('manage-content-share: create rpc failed', { code: errCode(error) })
    return reply(403, { error: 'Could not create the public link. You may not be able to share this drill.' })
  }
  const shareId = data?.share_id as string | undefined
  if (!shareId) return reply(500, { error: 'Could not create the public link. No change was made.' })

  // An existing or idempotent match means a link already exists; the raw secret
  // for the fresh call does not match the stored hash, so it is not returned.
  // Rotation is the only way to obtain a new URL.
  if (data?.existing === true || data?.idempotent === true) {
    return reply(200, {
      ok: true,
      shareId,
      existing: true,
      message: 'A public link already exists for this drill. Replace the link to get a new URL.',
    })
  }

  const status = await readStatusRow(admin, shareId)
  console.log('manage-content-share: created', { shareId })
  return reply(200, {
    ok: true,
    shareId,
    secret, // returned exactly once, never stored or logged
    status: 'active',
    expiresAt: status?.expires_at ?? null,
  })
}

async function handleRefresh(admin: AdminClient, caller: Caller, shareId: string | null): Promise<Response> {
  if (!shareId) return reply(400, { error: 'A share id is required.' })
  const share = await readShareForOwnerAction(admin, caller, shareId)
  if (share instanceof Response) return share
  if (share.kind !== 'drill' || !share.drill_id) return reply(400, { error: 'Only drill links can be refreshed here.' })

  const loaded = await loadDrillAndMedia(admin, caller.clubId, share.drill_id)
  if (loaded instanceof Response) return loaded
  const { drill, media, mediaMissing } = loaded
  const elig = eligibilityWithMissing(drill, media, mediaMissing)
  if (!elig.eligible) {
    return reply(422, { error: 'This drill can no longer be shared publicly.', blocked: elig.blocked })
  }
  const snapshot = buildDrillSnapshot(drill, media, new Date().toISOString())

  const { data, error } = await admin.rpc('manage_content_share', {
    p_action: 'refresh',
    p_actor_id: caller.userId,
    p_share_id: shareId,
    p_snapshot: snapshot,
    p_snapshot_version: SNAPSHOT_VERSION,
  })
  if (error) {
    console.error('manage-content-share: refresh rpc failed', { code: errCode(error) })
    return reply(403, { error: 'Could not update the public link.' })
  }
  const status = await readStatusRow(admin, shareId)
  console.log('manage-content-share: refreshed', { shareId })
  return reply(200, { ok: true, status: 'active', expiresAt: status?.expires_at ?? null })
}

async function handleRotate(admin: AdminClient, caller: Caller, shareId: string | null): Promise<Response> {
  if (!shareId) return reply(400, { error: 'A share id is required.' })
  const share = await readShareForOwnerAction(admin, caller, shareId)
  if (share instanceof Response) return share

  const secret = generateSecret()
  const secretHash = await secretHashLiteral(secret)
  const { error } = await admin.rpc('manage_content_share', {
    p_action: 'rotate',
    p_actor_id: caller.userId,
    p_share_id: shareId,
    p_secret_hash: secretHash,
  })
  if (error) {
    console.error('manage-content-share: rotate rpc failed', { code: errCode(error) })
    return reply(403, { error: 'Could not replace the public link.' })
  }
  console.log('manage-content-share: rotated', { shareId })
  return reply(200, { ok: true, shareId, secret, status: 'active' })
}

async function handleRevoke(admin: AdminClient, caller: Caller, shareId: string | null): Promise<Response> {
  if (!shareId) return reply(400, { error: 'A share id is required.' })
  // Revoke authority (owner or manager) is decided by the RPC; we pass the
  // verified actor and let it be the authority.
  const { data, error } = await admin.rpc('manage_content_share', {
    p_action: 'revoke',
    p_actor_id: caller.userId,
    p_share_id: shareId,
  })
  if (error) {
    console.error('manage-content-share: revoke rpc failed', { code: errCode(error) })
    return reply(403, { error: 'Could not turn off the public link.' })
  }
  console.log('manage-content-share: revoked', { shareId, already: data?.already === true })
  return reply(200, { ok: true, status: 'revoked' })
}

// Status by source id: returns the active share's redacted lifecycle for the
// owner or a manager, so the UI can render current state. Never returns the
// token hash or the secret.
async function handleStatus(
  admin: AdminClient,
  caller: Caller,
  sourceId: string | null,
  canManage: boolean,
): Promise<Response> {
  if (!sourceId) return reply(400, { error: 'A drill is required.' })

  // The club kill switch, so the UI can show a calm disabled state.
  const { data: club } = await admin
    .from('clubs')
    .select('public_sharing_enabled')
    .eq('id', caller.clubId)
    .maybeSingle()
  const sharingEnabled = club?.public_sharing_enabled === true

  const { data: rows, error } = await admin
    .from('content_shares')
    .select('id, club_id, kind, drill_id, created_by, snapshot, snapshot_version, expires_at, created_at, refreshed_at, rotated_at, revoked_at')
    .eq('drill_id', sourceId)
    .is('revoked_at', null)
    .limit(1)
  if (error) return reply(500, { error: 'Could not read the share status.' })
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row || row.club_id !== caller.clubId) return reply(200, { ok: true, share: null, sharingEnabled })

  const isOwner = row.created_by === caller.userId
  if (!isOwner && !canManage) return reply(200, { ok: true, share: null, sharingEnabled })

  // Redacted public projection for owner/manager review (no live signing here).
  let projection: unknown = null
  if (row.snapshot && row.snapshot.public === true) {
    projection = stripSnapshotForReview(row.snapshot)
  }
  return reply(200, {
    ok: true,
    sharingEnabled,
    share: {
      shareId: row.id,
      kind: row.kind,
      isOwner,
      canManage,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      refreshedAt: row.refreshed_at,
      rotatedAt: row.rotated_at,
      hasSnapshot: Boolean(projection),
      snapshot: projection,
    },
  })
}

// deno-lint-ignore no-explicit-any
function stripSnapshotForReview(snapshot: any): any {
  const media = Array.isArray(snapshot.media)
    ? snapshot.media.map((m: Record<string, unknown>) => {
      const { _mid: _a, _path: _b, ...rest } = m
      return rest
    })
    : []
  const { builder: _x, public: _y, media: _m, ...rest } = snapshot
  return { ...rest, media }
}

// Read a share and confirm the caller may perform an OWNER action (refresh,
// rotate). The RPC is the authority, but this gives a clean 404/403 first.
async function readShareForOwnerAction(
  admin: AdminClient,
  caller: Caller,
  shareId: string,
  // deno-lint-ignore no-explicit-any
): Promise<any | Response> {
  const { data: row, error } = await admin
    .from('content_shares')
    .select('id, club_id, kind, drill_id, created_by, revoked_at')
    .eq('id', shareId)
    .maybeSingle()
  if (error) return reply(500, { error: 'Could not read the share.' })
  if (!row || row.club_id !== caller.clubId) return reply(404, { error: 'That link was not found in your club.' })
  if (row.revoked_at) return reply(409, { error: 'That link has already been turned off.' })
  if (row.created_by !== caller.userId) {
    return reply(403, { error: 'Only the coach who created this link can update or replace it.' })
  }
  return row
}

// deno-lint-ignore no-explicit-any
async function readStatusRow(admin: AdminClient, shareId: string): Promise<any | null> {
  const { data, error } = await admin.from('content_shares').select('expires_at').eq('id', shareId).maybeSingle()
  if (error) return null
  return data
}
