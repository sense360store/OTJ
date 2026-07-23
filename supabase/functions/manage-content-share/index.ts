// OTJ Training Hub, manage-content-share Edge Function (Content Sharing PR 2).
//
// The authenticated management function for public DRILL and SESSION shares
// (Content Sharing PR 3 adds sessions; PR 2 shipped drills). verify_jwt is ON
// (the default; no config block). It authenticates the caller, makes an early
// capability check under the caller's identity, builds the safe public snapshot
// server side from the live rows, and calls the service role lifecycle RPC
// (manage_content_share) which is the final authority and re-validates the
// whole authorisation, the aggregate rights eligibility and the authoritative
// server derived dependency set inside its transaction. The dependency graph is
// NEVER taken from the client; the RPC re-derives it with content_share_deps.
//
// Actions: preview | create | refresh | rotate | revoke | status. Drill or
// session; a programme kind is refused (no public programme renderer yet).
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
  type BoardRow,
  buildDrillSnapshot,
  buildSessionSnapshot,
  type ContentRights,
  type DrillRow,
  evaluateDrillEligibility,
  evaluateSessionEligibility,
  generateSecret,
  type MediaRow,
  type SessionRow,
  SNAPSHOT_VERSION,
  secretHashLiteral,
  toPublicProjection,
  toPublicSessionProjection,
} from '../_shared/share.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 8 * 1024

const DRILL_COLS =
  'id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, setup_notes, easier, harder, theme, format, source_url, source_label, media_id, rights'
const MEDIA_COLS = 'id, club_id, name, type, storage_path, yt_url, embed_url, source_url, source_label, rights'
const SESSION_COLS =
  'id, club_id, name, focus, age_group, intentions, space, activities, board_id, source_url, source_label, rights'
// The boards table has no club_id column; the club is resolved through the
// creator's profile, exactly as content_share_deps does server side.
const BOARD_COLS = 'id, formation, tokens, created_by'

type Kind = 'drill' | 'session'
const KINDS: Kind[] = ['drill', 'session']
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

    // Drills and sessions can be shared publicly (PR 3); any other kind is
    // refused, never silently accepted. A programme has no public renderer yet.
    if (
      (action === 'preview' || action === 'create') &&
      (typeof kind !== 'string' || !KINDS.includes(kind as Kind))
    ) {
      return reply(400, { error: 'Only drills and sessions can be shared publicly.' })
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

    // The validated share kind. preview/create already gated kind to
    // {drill, session}; status carries it too and defaults to drill.
    const shareKind: Kind = kind === 'session' ? 'session' : 'drill'

    try {
      switch (action) {
        case 'preview':
          return await handlePreview(admin, caller.clubId, shareKind, sourceId)
        case 'create':
          return await handleCreate(admin, caller, shareKind, sourceId, idempotencyKey, expiresAt, noExpiry)
        case 'refresh':
          return await handleRefresh(admin, caller, shareId)
        case 'rotate':
          return await handleRotate(admin, caller, shareId)
        case 'revoke':
          return await handleRevoke(admin, caller, shareId)
        case 'status':
          return await handleStatus(admin, caller, shareKind, sourceId, canManage === true)
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

// The rows a session share projects: the session, the club scoped drills its
// activities reference, those drills' media, and the optional attached board.
interface LoadedSession {
  session: SessionRow
  drills: DrillRow[]
  media: MediaRow[]
  board: BoardRow | null
}

// Read a session and its full dependency set, each club scoped exactly as
// content_share_deps does: a cross club or absent nested id simply does not
// appear in the returned rows, so eligibility resolves it as missing and the
// share fails closed. All reads are under the service role; the lifecycle RPC
// re-derives the authoritative dependency set and re-validates authority. The
// snapshot is only ever built from what this returns, never from a client list.
async function loadSessionForShare(
  admin: AdminClient,
  clubId: string,
  sourceId: string,
): Promise<LoadedSession | Response> {
  const { data: session, error } = await admin.from('sessions').select(SESSION_COLS).eq('id', sourceId).maybeSingle()
  if (error) return reply(500, { error: 'Could not read the session. No change was made.' })
  if (!session || session.club_id !== clubId) return reply(404, { error: 'That session was not found in your club.' })

  // Distinct drill ids referenced by the activities jsonb (custom activities
  // carry a title and no drill_id and are skipped). Only well formed uuids are
  // queried; a malformed drill_id is left to eligibility, which flags it as an
  // unsupported item rather than a missing drill.
  const activities = Array.isArray(session.activities) ? session.activities : []
  const drillIds = [
    ...new Set(
      activities
        .map((a: unknown) => (a && typeof a === 'object' ? (a as { drill_id?: unknown }).drill_id : null))
        .filter((id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id)),
    ),
  ]

  let drills: DrillRow[] = []
  if (drillIds.length > 0) {
    const { data: drillRows, error: dErr } = await admin.from('drills').select(DRILL_COLS).in('id', drillIds)
    if (dErr) return reply(500, { error: 'Could not read the session drills. No change was made.' })
    drills = ((drillRows ?? []) as DrillRow[]).filter((d) => d.club_id === clubId)
  }

  const mediaIds = [
    ...new Set(drills.map((d) => d.media_id).filter((id): id is string => typeof id === 'string')),
  ]
  let media: MediaRow[] = []
  if (mediaIds.length > 0) {
    const { data: mediaRows, error: mErr } = await admin.from('media').select(MEDIA_COLS).in('id', mediaIds)
    if (mErr) return reply(500, { error: 'Could not read the session media. No change was made.' })
    media = ((mediaRows ?? []) as MediaRow[]).filter((m) => m.club_id === clubId)
  }

  // The attached board, club scoped through its creator's profile (the boards
  // table has no club_id). A cross club or vanished board resolves to null, so
  // eligibility flags board_missing and the share fails closed.
  let board: BoardRow | null = null
  if (session.board_id) {
    const { data: boardRow, error: bErr } = await admin.from('boards').select(BOARD_COLS).eq('id', session.board_id)
      .maybeSingle()
    if (bErr) return reply(500, { error: 'Could not read the session board. No change was made.' })
    if (boardRow && boardRow.created_by) {
      const { data: prof, error: pErr } = await admin.from('profiles').select('club_id').eq('id', boardRow.created_by)
        .maybeSingle()
      if (pErr) return reply(500, { error: 'Could not read the session board. No change was made.' })
      if (prof && prof.club_id === clubId) board = boardRow as BoardRow
    }
  }

  return { session: session as SessionRow, drills, media, board }
}

async function handlePreview(
  admin: AdminClient,
  clubId: string,
  kind: Kind,
  sourceId: string | null,
): Promise<Response> {
  if (kind === 'session') return handlePreviewSession(admin, clubId, sourceId)
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

async function handlePreviewSession(admin: AdminClient, clubId: string, sourceId: string | null): Promise<Response> {
  if (!sourceId) return reply(400, { error: 'A session is required.' })
  const loaded = await loadSessionForShare(admin, clubId, sourceId)
  if (loaded instanceof Response) return loaded
  const { session, drills, media, board } = loaded
  const elig = evaluateSessionEligibility(session, drills, media, board)
  let preview: unknown = null
  if (elig.eligible) {
    preview = toPublicSessionProjection(buildSessionSnapshot(session, drills, media, board, new Date().toISOString()))
  }
  return reply(200, {
    ok: true,
    eligible: elig.eligible,
    blocked: elig.blocked,
    rights: { source: session.rights as ContentRights },
    preview,
  })
}

async function handleCreate(
  admin: AdminClient,
  caller: Caller,
  kind: Kind,
  sourceId: string | null,
  idempotencyKey: string | null,
  expiresAt: string | null,
  noExpiry: boolean,
): Promise<Response> {
  if (kind === 'session') return handleCreateSession(admin, caller, sourceId, idempotencyKey, expiresAt, noExpiry)
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

async function handleCreateSession(
  admin: AdminClient,
  caller: Caller,
  sourceId: string | null,
  idempotencyKey: string | null,
  expiresAt: string | null,
  noExpiry: boolean,
): Promise<Response> {
  if (!sourceId) return reply(400, { error: 'A session is required.' })
  if (!idempotencyKey) return reply(400, { error: 'An idempotency key is required.' })
  const loaded = await loadSessionForShare(admin, caller.clubId, sourceId)
  if (loaded instanceof Response) return loaded
  const { session, drills, media, board } = loaded
  const elig = evaluateSessionEligibility(session, drills, media, board)
  if (!elig.eligible) {
    return reply(422, { error: 'This session cannot be shared publicly.', blocked: elig.blocked })
  }

  const snapshot = buildSessionSnapshot(session, drills, media, board, new Date().toISOString())
  const secret = generateSecret()
  const secretHash = await secretHashLiteral(secret)

  const { data, error } = await admin.rpc('manage_content_share', {
    p_action: 'create',
    p_actor_id: caller.userId,
    p_kind: 'session',
    p_source_id: sourceId,
    p_secret_hash: secretHash,
    p_expires_at: expiresAt,
    p_no_expiry: noExpiry,
    p_idempotency_key: idempotencyKey,
    p_snapshot: snapshot,
    p_snapshot_version: SNAPSHOT_VERSION,
  })
  if (error) {
    console.error('manage-content-share: create session rpc failed', { code: errCode(error) })
    return reply(403, { error: 'Could not create the public link. You may not be able to share this session.' })
  }
  const shareId = data?.share_id as string | undefined
  if (!shareId) return reply(500, { error: 'Could not create the public link. No change was made.' })
  if (data?.existing === true || data?.idempotent === true) {
    return reply(200, {
      ok: true,
      shareId,
      existing: true,
      message: 'A public link already exists for this session. Replace the link to get a new URL.',
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
  if (share.kind === 'session') return handleRefreshSession(admin, caller, shareId, share.session_id)
  if (share.kind !== 'drill' || !share.drill_id) {
    return reply(400, { error: 'Only drill or session links can be refreshed here.' })
  }

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

async function handleRefreshSession(
  admin: AdminClient,
  caller: Caller,
  shareId: string,
  sessionId: string | null,
): Promise<Response> {
  if (!sessionId) return reply(400, { error: 'That link is not a session link.' })
  const loaded = await loadSessionForShare(admin, caller.clubId, sessionId)
  if (loaded instanceof Response) return loaded
  const { session, drills, media, board } = loaded
  const elig = evaluateSessionEligibility(session, drills, media, board)
  if (!elig.eligible) {
    return reply(422, { error: 'This session can no longer be shared publicly.', blocked: elig.blocked })
  }
  const snapshot = buildSessionSnapshot(session, drills, media, board, new Date().toISOString())

  const { data: _data, error } = await admin.rpc('manage_content_share', {
    p_action: 'refresh',
    p_actor_id: caller.userId,
    p_share_id: shareId,
    p_snapshot: snapshot,
    p_snapshot_version: SNAPSHOT_VERSION,
  })
  if (error) {
    console.error('manage-content-share: refresh session rpc failed', { code: errCode(error) })
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
  kind: Kind,
  sourceId: string | null,
  canManage: boolean,
): Promise<Response> {
  if (!sourceId) return reply(400, { error: kind === 'session' ? 'A session is required.' : 'A drill is required.' })

  // The club kill switch, so the UI can show a calm disabled state.
  const { data: club } = await admin
    .from('clubs')
    .select('public_sharing_enabled')
    .eq('id', caller.clubId)
    .maybeSingle()
  const sharingEnabled = club?.public_sharing_enabled === true

  const sourceColumn = kind === 'session' ? 'session_id' : 'drill_id'
  const { data: rows, error } = await admin
    .from('content_shares')
    .select(
      'id, club_id, kind, drill_id, session_id, created_by, snapshot, snapshot_version, expires_at, created_at, refreshed_at, rotated_at, revoked_at',
    )
    .eq(sourceColumn, sourceId)
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
    .select('id, club_id, kind, drill_id, session_id, created_by, revoked_at')
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
