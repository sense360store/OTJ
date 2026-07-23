// OTJ Training Hub, shared content sharing module (Content Sharing PR 2).
//
// Pure, dependency free logic shared by the two sharing Edge Functions and the
// Deno test suite: the public DRILL snapshot builder (a strict allow list that
// names the fields that may appear and copies only those), the recursive allow
// list scanner (asserts no key outside the allow list ever reaches the public
// payload, at every nesting level), free text and URL sanitisation, the public
// projection (strips the private media fields the stored snapshot carries for
// signing), and the secret and hash helpers.
//
// PR 2 is DRILL only. There is no session or programme builder here and no
// generic renderer that could silently expose another source kind. The
// snapshot is versioned (SNAPSHOT_VERSION) so a reader can refuse an unknown
// version. Run the tests with:
//   deno test --allow-read supabase/functions/_shared/share_test.ts
//
// See docs/security/content-sharing-boundary.md and
// docs/roadmaps/content-sharing-roadmap.md (sections 11.2, 11.5, 14, 16).

// The public snapshot schema version. Bump only with a deliberate migration of
// stored snapshots; the read path and the public page refuse an unknown value.
export const SNAPSHOT_VERSION = 1

// The builder identity stored in the snapshot so the read path can distinguish
// a real PR 2 snapshot from the PR 1 placeholder (whose builder is 'pending').
export const DRILL_BUILDER = 'drill@1'

// The session builder identity (Content Sharing PR 3). A session snapshot is a
// public projection of one saved session: its ordered activities, the full
// snapshots of the drills those activities reference, a safe board (numbers and
// positions only), and one flat top-level pool of the referenced media. The
// media pool sits at the top level so read_public_share signs it with the same
// loop it uses for a drill share; referenced drills point into the pool by ref.
export const SESSION_BUILDER = 'session@1'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The snapshot size cap, mirrored by the lifecycle RPC (256 KiB).
export const MAX_SNAPSHOT_BYTES = 262144

// Per field and per array caps, so a pathological drill cannot inflate the
// snapshot or the public page.
const MAX_TEXT_LEN = 4000
const MAX_ARRAY_ITEMS = 64

export type ContentRights = 'internal_only' | 'public_link_only' | 'public_full'
export type MediaType = 'video' | 'youtube' | 'image' | 'pdf'

// The subset of drill columns the builder reads. A superset is harmless (the
// allow list copies only the named fields); a missing column is treated as
// absent.
export interface DrillRow {
  id: string
  club_id: string
  title: string
  summary: string | null
  corner: string | null
  skill: string | null
  level: string | null
  ages: string[] | null
  duration: number | null
  players: string | null
  area: string | null
  equipment: string[] | null
  points: string[] | null
  tags: string[] | null
  setup_notes: string | null
  easier: string[] | null
  harder: string[] | null
  theme: string | null
  format: string | null
  source_url: string | null
  source_label: string | null
  media_id: string | null
  rights: ContentRights
}

export interface MediaRow {
  id: string
  club_id: string
  name: string
  type: MediaType
  storage_path: string | null
  yt_url: string | null
  embed_url: string | null
  source_url: string | null
  source_label: string | null
  rights: ContentRights
}

export interface SourceAttribution {
  url: string
  label: string | null
}

// The public media entry the browser receives. `url` is a short lived signed
// URL injected by the read function for an eligible stored object; `link` is an
// external public link (a public YouTube URL). Never both, never a raw path.
export interface PublicMedia {
  ref: string
  type: MediaType
  caption: string | null
  sourceAttribution: SourceAttribution | null
  link: string | null
  url?: string
}

// The stored media entry additionally carries the private fields the read path
// needs to re-check rights and sign the object, stripped before anything
// reaches the browser.
export interface StoredMedia extends PublicMedia {
  _mid: string
  _path: string | null
}

export type DrillClassification =
  | { type: 'corner'; value: string }
  | { type: 'tags'; value: string[] }
  | null

interface DrillSnapshotBase {
  snapshotVersion: number
  kind: 'drill'
  title: string
  summary: string | null
  classification: DrillClassification
  skill: string | null
  ages: string[]
  level: string | null
  duration: number | null
  playerGuidance: string | null
  area: string | null
  equipment: string[]
  setupNotes: string | null
  coachingPoints: string[]
  easier: string[]
  harder: string[]
  theme: string | null
  format: string | null
  sourceAttribution: SourceAttribution | null
  snapshotAt: string
}

// The stored snapshot: what the lifecycle RPC persists. Carries the private
// media fields and the internal markers (builder, public) the read path strips.
export interface StoredDrillSnapshot extends DrillSnapshotBase {
  media: StoredMedia[]
  builder: string
  public: true
}

// The public projection: what the browser renders. No private media fields, no
// internal markers.
export interface PublicDrillSnapshot extends DrillSnapshotBase {
  media: PublicMedia[]
}

export type BlockReason =
  | 'source_internal_only'
  | 'media_internal_only'
  | 'media_missing'

export interface Eligibility {
  eligible: boolean
  blocked: BlockReason[]
}

// -------------------------------------------------------------------------
// Sanitisation
// -------------------------------------------------------------------------

// Match control characters except tab and newline.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const HORIZONTAL_WS = /[^\S\n]+/g

// Strip HTML tags, script and style blocks and dangerous URI schemes from free
// text, so nothing rich renders and no active content survives even if a
// downstream consumer ignored the "render as text" rule. The public page never
// uses innerHTML; this is a second, machine enforced layer.
export function sanitizeText(value: unknown, maxLen: number = MAX_TEXT_LEN): string | null {
  if (typeof value !== 'string') return null
  let s = value
  // Remove script/style/embed element contents entirely.
  s = s.replace(/<\s*(script|style|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
  // Remove any remaining tags (including an unclosed one at the end).
  s = s.replace(/<[^>]*>/g, ' ')
  s = s.replace(/<[^>]*$/g, ' ')
  // Neutralise dangerous URI schemes appearing inline as text.
  s = s.replace(/\b(?:javascript|data|vbscript)\s*:/gi, ' ')
  // Normalise line endings, then drop control characters except tab and newline.
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(CONTROL_CHARS, '')
  // Collapse horizontal whitespace and tidy spacing around newlines.
  s = s.replace(HORIZONTAL_WS, ' ').replace(/ *\n */g, '\n')
  s = s.trim()
  if (s.length > maxLen) s = s.slice(0, maxLen).trim()
  return s.length > 0 ? s : null
}

export function sanitizeTextArray(
  value: unknown,
  maxItems: number = MAX_ARRAY_ITEMS,
  maxLen: number = MAX_TEXT_LEN,
): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const clean = sanitizeText(item, maxLen)
    if (clean !== null) out.push(clean)
    if (out.length >= maxItems) break
  }
  return out
}

// Return the URL only when it parses to an http(s) URL whose host is allowed.
// Anything else (javascript:, data:, a private scheme, an unparseable string,
// or a host outside the allow list) becomes null.
export function sanitizeHttpUrl(value: unknown, allowedHosts?: string[]): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2000) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (allowedHosts && allowedHosts.length > 0) {
    const host = parsed.hostname.toLowerCase()
    const ok = allowedHosts.some((h) => host === h || host.endsWith('.' + h))
    if (!ok) return null
  }
  return parsed.toString()
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

function attributionOf(sourceUrl: unknown, sourceLabel: unknown): SourceAttribution | null {
  const url = sanitizeHttpUrl(sourceUrl)
  if (url === null) return null
  return { url, label: sanitizeText(sourceLabel, 200) }
}

// -------------------------------------------------------------------------
// Eligibility (fail closed aggregate block rule)
// -------------------------------------------------------------------------

// A drill is publicly shareable only when its own rights are eligible and every
// referenced media item is eligible. One restricted (internal_only) or missing
// dependency blocks the whole share; nothing is silently omitted.
export function evaluateDrillEligibility(
  drill: Pick<DrillRow, 'rights' | 'media_id'>,
  media: Pick<MediaRow, 'rights'> | null,
): Eligibility {
  const blocked: BlockReason[] = []
  if (drill.rights === 'internal_only') blocked.push('source_internal_only')
  if (drill.media_id) {
    if (!media) blocked.push('media_missing')
    else if (media.rights === 'internal_only') blocked.push('media_internal_only')
  }
  return { eligible: blocked.length === 0, blocked }
}

// -------------------------------------------------------------------------
// The drill snapshot builder
// -------------------------------------------------------------------------

function buildMediaEntry(media: MediaRow, ref: string): StoredMedia {
  const caption = sanitizeText(media.name, 300)
  const sourceAttribution = attributionOf(media.source_url, media.source_label)
  // public_full stored object: reference the private path for read-time signing.
  if (media.rights === 'public_full' && media.storage_path && media.type !== 'youtube') {
    return {
      ref,
      type: media.type,
      caption,
      sourceAttribution,
      link: null,
      _mid: media.id,
      _path: media.storage_path,
    }
  }
  // YouTube (public_full or public_link_only): an external public link only,
  // never a stored binary. The read path signs nothing for it.
  if (media.type === 'youtube') {
    const link = sanitizeHttpUrl(media.yt_url, YOUTUBE_HOSTS)
    return { ref, type: 'youtube', caption, sourceAttribution, link, _mid: media.id, _path: null }
  }
  // Any other eligible media (for example a public_link_only stored object):
  // caption and attribution only, no binary and no link. Safe by omission.
  return { ref, type: media.type, caption, sourceAttribution, link: null, _mid: media.id, _path: null }
}

// A finite number, or null. Mirrors the drill duration coercion so a NaN or a
// non-number never reaches the snapshot.
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// The presentational drill fields shared by a standalone drill snapshot and a
// drill referenced inside a session snapshot. No media (a standalone snapshot
// embeds a top-level media array; a referenced drill points into the session
// media pool by ref), no builder or public markers, no snapshotAt.
export interface DrillFields {
  title: string
  summary: string | null
  classification: DrillClassification
  skill: string | null
  ages: string[]
  level: string | null
  duration: number | null
  playerGuidance: string | null
  area: string | null
  equipment: string[]
  setupNotes: string | null
  coachingPoints: string[]
  easier: string[]
  harder: string[]
  theme: string | null
  format: string | null
  sourceAttribution: SourceAttribution | null
}

// Project the safe presentational fields of a drill through the allow list.
// Single source of truth for both the standalone drill builder and the session
// referenced-drill projection.
function projectDrillFields(drill: DrillRow): DrillFields {
  const corner = sanitizeText(drill.corner, 40)
  const tags = sanitizeTextArray(drill.tags, MAX_ARRAY_ITEMS, 60)
  let classification: DrillClassification = null
  if (corner !== null) classification = { type: 'corner', value: corner }
  else if (tags.length > 0) classification = { type: 'tags', value: tags }
  return {
    title: sanitizeText(drill.title, 300) ?? 'Untitled drill',
    summary: sanitizeText(drill.summary),
    classification,
    skill: sanitizeText(drill.skill, 300),
    ages: sanitizeTextArray(drill.ages, 32, 40),
    level: sanitizeText(drill.level, 40),
    duration: numOrNull(drill.duration),
    playerGuidance: sanitizeText(drill.players, 300),
    area: sanitizeText(drill.area, 300),
    equipment: sanitizeTextArray(drill.equipment, MAX_ARRAY_ITEMS, 200),
    setupNotes: sanitizeText(drill.setup_notes),
    coachingPoints: sanitizeTextArray(drill.points),
    easier: sanitizeTextArray(drill.easier),
    harder: sanitizeTextArray(drill.harder),
    theme: sanitizeText(drill.theme, 200),
    format: sanitizeText(drill.format, 200),
    sourceAttribution: attributionOf(drill.source_url, drill.source_label),
  }
}

// Build the stored drill snapshot from the live drill and its optional media.
// The caller MUST have confirmed eligibility first (evaluateDrillEligibility);
// this throws on an internal_only source or media as a defensive guard so an
// ineligible drill can never be projected. The output is deterministic for a
// fixed snapshotAt.
export function buildDrillSnapshot(
  drill: DrillRow,
  media: MediaRow | null,
  snapshotAt: string,
): StoredDrillSnapshot {
  if (drill.rights === 'internal_only') {
    throw new Error('buildDrillSnapshot: refusing to project an internal_only drill')
  }
  if (media && media.rights === 'internal_only') {
    throw new Error('buildDrillSnapshot: refusing to project internal_only media')
  }
  if (drill.media_id && !media) {
    throw new Error('buildDrillSnapshot: the referenced media is missing')
  }

  const mediaEntries: StoredMedia[] = media ? [buildMediaEntry(media, 'm1')] : []

  const snapshot: StoredDrillSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    kind: 'drill',
    ...projectDrillFields(drill),
    media: mediaEntries,
    snapshotAt,
    builder: DRILL_BUILDER,
    public: true,
  }

  assertAllowlistedKeys(snapshot)
  return snapshot
}

// -------------------------------------------------------------------------
// The session snapshot builder (Content Sharing PR 3)
// -------------------------------------------------------------------------

// The subset of session columns the builder reads. Operational columns (date,
// start_time, venue, team_id, coach_id, status, spond_event_id, the live state)
// are never read here and never enter the snapshot.
export interface SessionRow {
  id: string
  club_id: string
  name: string | null
  focus: string | null
  age_group: string | null
  intentions: string[] | null
  space: string | null
  activities: unknown
  board_id: string | null
  source_url: string | null
  source_label: string | null
  rights: ContentRights
}

// The subset of board columns the builder reads. The boards table has no
// club_id column; the caller resolves the club through the creator's profile
// and passes only a board it has confirmed is in the source's club.
export interface BoardRow {
  id: string
  formation: string | null
  tokens: unknown
  created_by: string | null
}

// A raw activity as stored in the sessions.activities jsonb (snake_case on the
// wire). A drill activity carries drill_id; a custom activity carries a title.
interface RawActivity {
  phase?: unknown
  drill_id?: unknown
  title?: unknown
  duration?: unknown
}

// A public activity entry: its phase and duration, and EITHER a snapshot-local
// drill reference (drillRef into referencedDrills) OR a custom title. Never a
// real drill id.
export interface PublicActivity {
  phase: string | null
  duration: number | null
  drillRef: string | null
  customTitle: string | null
}

// A drill referenced by a session activity: the same safe presentational fields
// as a standalone drill snapshot, keyed by a snapshot-local ref, with its media
// referenced by ref into the session's flat media pool (mediaRefs).
export interface ReferencedDrill extends DrillFields {
  ref: string
  mediaRefs: string[]
}

// A public board token: shape and numbers only. No id, no playerId, no name, no
// team. The binding constraint from the registered players boundary: a shared
// board strips playerId entirely and never resolves a name.
export interface PublicBoardToken {
  number: number | null
  side: string | null
  x: number
  y: number
}

export interface PublicBoard {
  formation: string | null
  tokens: PublicBoardToken[]
}

interface SessionSnapshotBase {
  snapshotVersion: number
  kind: 'session'
  displayTitle: string
  focus: string | null
  ageGroup: string | null
  totalDuration: number
  intentions: string[]
  space: string | null
  activities: PublicActivity[]
  referencedDrills: ReferencedDrill[]
  board: PublicBoard | null
  sourceAttribution: SourceAttribution | null
  snapshotAt: string
}

// The stored session snapshot: the flat media pool carries the private fields
// and the internal markers the read path strips.
export interface StoredSessionSnapshot extends SessionSnapshotBase {
  media: StoredMedia[]
  builder: string
  public: true
}

// The public projection: no private media fields, no internal markers.
export interface PublicSessionSnapshot extends SessionSnapshotBase {
  media: PublicMedia[]
}

export type SessionBlockReason =
  | 'source_internal_only'
  | 'drill_internal_only'
  | 'media_internal_only'
  | 'drill_missing'
  | 'media_missing'
  | 'board_missing'
  | 'unsupported_item'

export interface SessionEligibility {
  eligible: boolean
  blocked: SessionBlockReason[]
}

// Clamp a pitch fraction into [0, 1]; a non-number or out of range value is
// pulled to a safe centre so a malformed token never renders off pitch.
function clampFraction01(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function parseActivities(activities: unknown): RawActivity[] {
  return Array.isArray(activities) ? (activities as RawActivity[]) : []
}

// A drill activity references a drill by a valid uuid; a custom activity has no
// drill_id. Anything else (a non-object entry, or a drill_id that is not a
// uuid) is an unsupported item and fails the whole share closed.
function activityShape(
  raw: RawActivity | unknown,
): { kind: 'drill'; drillId: string } | { kind: 'custom' } | { kind: 'unsupported' } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unsupported' }
  const a = raw as RawActivity
  const drillIdRaw = typeof a.drill_id === 'string' ? a.drill_id.trim() : ''
  if (drillIdRaw.length > 0) {
    if (!UUID_RE.test(drillIdRaw)) return { kind: 'unsupported' }
    return { kind: 'drill', drillId: drillIdRaw }
  }
  return { kind: 'custom' }
}

// Evaluate whether a session is publicly shareable. Fail closed aggregate block
// rule: the session's own rights, and every referenced drill, its media, and
// the attached board must all be eligible and present in the source's club.
// One restricted, missing or cross club dependency blocks the whole share; an
// unsupported activity item blocks it too. The caller passes only rows it has
// already club scoped, so a cross club or absent id arrives as a missing row.
export function evaluateSessionEligibility(
  session: Pick<SessionRow, 'rights' | 'activities' | 'board_id'>,
  drills: Array<Pick<DrillRow, 'id' | 'rights' | 'media_id'>>,
  media: Array<Pick<MediaRow, 'id' | 'rights'>>,
  board: Pick<BoardRow, 'id'> | null,
): SessionEligibility {
  const blocked = new Set<SessionBlockReason>()
  if (session.rights === 'internal_only') blocked.add('source_internal_only')

  const drillById = new Map(drills.map((d) => [d.id, d]))
  const mediaById = new Map(media.map((m) => [m.id, m]))

  for (const raw of parseActivities(session.activities)) {
    const shape = activityShape(raw)
    if (shape.kind === 'unsupported') {
      blocked.add('unsupported_item')
      continue
    }
    if (shape.kind !== 'drill') continue
    const drill = drillById.get(shape.drillId)
    if (!drill) {
      blocked.add('drill_missing')
      continue
    }
    if (drill.rights === 'internal_only') blocked.add('drill_internal_only')
    if (drill.media_id) {
      const m = mediaById.get(drill.media_id)
      if (!m) blocked.add('media_missing')
      else if (m.rights === 'internal_only') blocked.add('media_internal_only')
    }
  }

  if (session.board_id) {
    if (!board || board.id !== session.board_id) blocked.add('board_missing')
  }

  return { eligible: blocked.size === 0, blocked: [...blocked] }
}

// Project a board to shape and numbers only. Strips id, playerId, name and team
// entirely; keeps the formation label (a standard shape such as "4-4-2", no
// personal data) and each token's number, side and pitch fraction position.
function projectBoard(board: BoardRow): PublicBoard {
  const rawTokens = Array.isArray(board.tokens) ? (board.tokens as unknown[]) : []
  const tokens: PublicBoardToken[] = []
  for (const t of rawTokens) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const tok = t as Record<string, unknown>
    tokens.push({
      number: numOrNull(tok.number),
      side: tok.side === 'home' || tok.side === 'away' ? tok.side : null,
      x: clampFraction01(tok.x),
      y: clampFraction01(tok.y),
    })
    if (tokens.length >= MAX_ARRAY_ITEMS) break
  }
  return { formation: sanitizeText(board.formation, 40), tokens }
}

// Build the stored session snapshot from the live session, the club scoped
// drills its activities reference, those drills' media, and the optional board.
// The caller MUST have confirmed eligibility first (evaluateSessionEligibility);
// this throws defensively on any internal_only, missing or unsupported item so
// an ineligible session can never be projected. Media is deduplicated into one
// flat top-level pool so the read path signs it with its existing loop; each
// referenced drill points into the pool by ref. Deterministic for a fixed
// snapshotAt.
export function buildSessionSnapshot(
  session: SessionRow,
  drills: DrillRow[],
  media: MediaRow[],
  board: BoardRow | null,
  snapshotAt: string,
): StoredSessionSnapshot {
  if (session.rights === 'internal_only') {
    throw new Error('buildSessionSnapshot: refusing to project an internal_only session')
  }

  const drillById = new Map(drills.map((d) => [d.id, d]))
  const mediaById = new Map(media.map((m) => [m.id, m]))

  const mediaPool: StoredMedia[] = []
  const mediaRefById = new Map<string, string>()
  const drillRefById = new Map<string, string>()
  const referencedDrills: ReferencedDrill[] = []

  const ensureMediaRef = (mediaId: string): string => {
    const existing = mediaRefById.get(mediaId)
    if (existing) return existing
    const m = mediaById.get(mediaId)
    if (!m) throw new Error('buildSessionSnapshot: a referenced media is missing')
    if (m.rights === 'internal_only') {
      throw new Error('buildSessionSnapshot: refusing to project internal_only media')
    }
    const ref = 'm' + (mediaPool.length + 1)
    mediaPool.push(buildMediaEntry(m, ref))
    mediaRefById.set(mediaId, ref)
    return ref
  }

  const ensureDrillRef = (drillId: string): string => {
    const existing = drillRefById.get(drillId)
    if (existing) return existing
    const d = drillById.get(drillId)
    if (!d) throw new Error('buildSessionSnapshot: a referenced drill is missing')
    if (d.rights === 'internal_only') {
      throw new Error('buildSessionSnapshot: refusing to project an internal_only drill')
    }
    const ref = 'd' + (referencedDrills.length + 1)
    // Reserve the ref before projecting so a self reference cannot recurse.
    drillRefById.set(drillId, ref)
    const mediaRefs: string[] = []
    if (d.media_id) mediaRefs.push(ensureMediaRef(d.media_id))
    referencedDrills.push({ ref, ...projectDrillFields(d), mediaRefs })
    return ref
  }

  const activities: PublicActivity[] = []
  let totalDuration = 0
  for (const raw of parseActivities(session.activities)) {
    const shape = activityShape(raw)
    if (shape.kind === 'unsupported') {
      throw new Error('buildSessionSnapshot: an unsupported activity item')
    }
    const a = raw as RawActivity
    const phase = sanitizeText(a.phase, 60)
    const duration = numOrNull(a.duration)
    if (typeof duration === 'number') totalDuration += duration
    if (shape.kind === 'drill') {
      activities.push({ phase, duration, drillRef: ensureDrillRef(shape.drillId), customTitle: null })
    } else {
      activities.push({ phase, duration, drillRef: null, customTitle: sanitizeText(a.title, 300) })
    }
  }

  let boardOut: PublicBoard | null = null
  if (session.board_id) {
    if (!board || board.id !== session.board_id) {
      throw new Error('buildSessionSnapshot: the attached board is missing')
    }
    boardOut = projectBoard(board)
  }

  const snapshot: StoredSessionSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    kind: 'session',
    displayTitle: sanitizeText(session.name, 300) ?? 'Untitled session',
    focus: sanitizeText(session.focus, 300),
    ageGroup: sanitizeText(session.age_group, 60),
    totalDuration,
    intentions: sanitizeTextArray(session.intentions),
    space: sanitizeText(session.space, 300),
    activities,
    referencedDrills,
    board: boardOut,
    sourceAttribution: attributionOf(session.source_url, session.source_label),
    media: mediaPool,
    snapshotAt,
    builder: SESSION_BUILDER,
    public: true,
  }

  assertAllowlistedKeys(snapshot)
  return snapshot
}

// -------------------------------------------------------------------------
// The public projection and the allow list scanner
// -------------------------------------------------------------------------

const TOP_ALLOWED = new Set<string>([
  'snapshotVersion', 'kind', 'title', 'summary', 'classification', 'skill', 'ages',
  'level', 'duration', 'playerGuidance', 'area', 'equipment', 'setupNotes',
  'coachingPoints', 'easier', 'harder', 'theme', 'format', 'sourceAttribution',
  'media', 'snapshotAt', 'builder', 'public',
])
const CLASSIFICATION_ALLOWED = new Set<string>(['type', 'value'])
const ATTRIBUTION_ALLOWED = new Set<string>(['url', 'label'])
const MEDIA_ALLOWED = new Set<string>(['ref', 'type', 'caption', 'sourceAttribution', 'link', 'url', '_mid', '_path'])
const MEDIA_PUBLIC_ALLOWED = new Set<string>(['ref', 'type', 'caption', 'sourceAttribution', 'link', 'url'])

// Session snapshot allow lists (Content Sharing PR 3).
const SESSION_TOP_ALLOWED = new Set<string>([
  'snapshotVersion', 'kind', 'displayTitle', 'focus', 'ageGroup', 'totalDuration',
  'intentions', 'space', 'activities', 'referencedDrills', 'board', 'media',
  'sourceAttribution', 'snapshotAt', 'builder', 'public',
])
const ACTIVITY_ALLOWED = new Set<string>(['phase', 'duration', 'drillRef', 'customTitle'])
const REF_DRILL_ALLOWED = new Set<string>([
  'ref', 'title', 'summary', 'classification', 'skill', 'ages', 'level', 'duration',
  'playerGuidance', 'area', 'equipment', 'setupNotes', 'coachingPoints', 'easier',
  'harder', 'theme', 'format', 'sourceAttribution', 'mediaRefs',
])
const BOARD_ALLOWED = new Set<string>(['formation', 'tokens'])
const BOARD_TOKEN_ALLOWED = new Set<string>(['number', 'side', 'x', 'y'])

// Keys that must never appear anywhere in a snapshot, at any level. A belt and
// braces denylist beneath the positive allow list, naming the real columns and
// their camelCase forms that a naive projection could leak.
const FORBIDDEN_ANYWHERE = [
  'club_id', 'clubId', 'created_by', 'createdBy', 'created_at', 'createdAt',
  'media_id', 'mediaId', 'source_key', 'sourceKey', 'source_programme_id',
  'storage_path', 'storagePath', 'embed_url', 'embedUrl', 'token_hash', 'tokenHash',
  'secret', 'coach_id', 'coachId', 'drill_id', 'drillId', 'session_id', 'programme_id',
  'idempotency_key', 'revoked_by', 'updated_by', 'rights_class_observed', 'player_id',
  'playerId', 'author',
  // Session operational columns (PR 3). The positive allow list already prevents
  // these; naming them here is belt and braces so a future field rename that
  // reintroduced a real column would trip the scanner rather than leak.
  'team_id', 'teamId', 'venue', 'start_time', 'startTime', 'date',
  'spond_event_id', 'spondEventId', 'board_id', 'boardId', 'programme_week',
  'programmeWeek', 'live_activity_index', 'liveActivityIndex',
  'live_activity_started_at', 'liveActivityStartedAt',
]

function assertKeysWithin(obj: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`snapshot allow list: unexpected key "${key}" at ${where}`)
    }
  }
}

// Validate a STORED snapshot's known structure (media entries may carry the
// private fields). Throws on any key outside the allow list at any level.
// Dispatches on kind so the drill and session builders share one entry point.
export function assertAllowlistedKeys(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('snapshot allow list: not an object')
  }
  const s = snapshot as Record<string, unknown>
  if (s.kind === 'session') {
    assertAllowlistedSessionKeys(s)
    return
  }
  assertKeysWithin(s, TOP_ALLOWED, 'top level')
  if (s.classification && typeof s.classification === 'object') {
    assertKeysWithin(s.classification as Record<string, unknown>, CLASSIFICATION_ALLOWED, 'classification')
  }
  if (s.sourceAttribution && typeof s.sourceAttribution === 'object') {
    assertKeysWithin(s.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'sourceAttribution')
  }
  assertMediaArrayKeys(s.media)
}

// Assert the media pool (or a drill's embedded media array) carries only allowed
// keys, at the entry and its nested sourceAttribution.
function assertMediaArrayKeys(mediaValue: unknown): void {
  if (!Array.isArray(mediaValue)) return
  for (const m of mediaValue as unknown[]) {
    if (!m || typeof m !== 'object') throw new Error('snapshot allow list: media entry not an object')
    assertKeysWithin(m as Record<string, unknown>, MEDIA_ALLOWED, 'media entry')
    const me = m as Record<string, unknown>
    if (me.sourceAttribution && typeof me.sourceAttribution === 'object') {
      assertKeysWithin(me.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'media sourceAttribution')
    }
  }
}

// Validate a STORED session snapshot's known structure at every level: the top
// level, each activity, each referenced drill (and its classification and
// attribution), the board and its tokens, and the flat media pool.
function assertAllowlistedSessionKeys(s: Record<string, unknown>): void {
  assertKeysWithin(s, SESSION_TOP_ALLOWED, 'session top level')
  if (s.sourceAttribution && typeof s.sourceAttribution === 'object') {
    assertKeysWithin(s.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'session sourceAttribution')
  }
  if (Array.isArray(s.activities)) {
    for (const a of s.activities as unknown[]) {
      if (!a || typeof a !== 'object') throw new Error('snapshot allow list: activity not an object')
      assertKeysWithin(a as Record<string, unknown>, ACTIVITY_ALLOWED, 'activity')
    }
  }
  if (Array.isArray(s.referencedDrills)) {
    for (const d of s.referencedDrills as unknown[]) {
      if (!d || typeof d !== 'object') throw new Error('snapshot allow list: referenced drill not an object')
      const dr = d as Record<string, unknown>
      assertKeysWithin(dr, REF_DRILL_ALLOWED, 'referenced drill')
      if (dr.classification && typeof dr.classification === 'object') {
        assertKeysWithin(dr.classification as Record<string, unknown>, CLASSIFICATION_ALLOWED, 'referenced drill classification')
      }
      if (dr.sourceAttribution && typeof dr.sourceAttribution === 'object') {
        assertKeysWithin(dr.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'referenced drill sourceAttribution')
      }
    }
  }
  if (s.board && typeof s.board === 'object' && !Array.isArray(s.board)) {
    const b = s.board as Record<string, unknown>
    assertKeysWithin(b, BOARD_ALLOWED, 'board')
    if (Array.isArray(b.tokens)) {
      for (const t of b.tokens as unknown[]) {
        if (!t || typeof t !== 'object') throw new Error('snapshot allow list: board token not an object')
        assertKeysWithin(t as Record<string, unknown>, BOARD_TOKEN_ALLOWED, 'board token')
      }
    }
  }
  assertMediaArrayKeys(s.media)
}

// Recursively assert no forbidden key appears anywhere. Used on the public
// projection as the final guarantee before it reaches the browser.
export function assertNoForbiddenKeys(value: unknown): void {
  const forbidden = new Set(FORBIDDEN_ANYWHERE)
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (forbidden.has(key)) {
          throw new Error(`snapshot forbidden key: "${key}" must never reach the public payload`)
        }
        walk(child)
      }
    }
  }
  walk(value)
}

// Strip the private media fields and the internal markers from a stored
// snapshot, producing the public projection. Mirrors exactly what
// read_public_share does in SQL, so the preview (which uses this) and the live
// public read agree. A signed url, when present, is preserved.
export function toPublicProjection(stored: StoredDrillSnapshot): PublicDrillSnapshot {
  const media: PublicMedia[] = stored.media.map((m) => {
    const out: PublicMedia = {
      ref: m.ref,
      type: m.type,
      caption: m.caption,
      sourceAttribution: m.sourceAttribution,
      link: m.link,
    }
    if (typeof m.url === 'string') out.url = m.url
    return out
  })
  const { builder: _builder, public: _public, media: _m, ...rest } = stored
  return { ...rest, media }
}

// Validate that a value is a well formed PUBLIC drill snapshot: known keys
// only, no private media fields, no forbidden key anywhere, the pinned version
// and kind. Used by the read function before responding and by the public page
// before rendering, so an unknown or tampered shape renders the neutral
// unavailable state rather than anything else.
export function validatePublicDrillSnapshot(value: unknown): value is PublicDrillSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'drill') return false
  if (s.snapshotVersion !== SNAPSHOT_VERSION) return false
  if (s.public !== undefined || s.builder !== undefined) return false
  try {
    const publicTop = new Set([...TOP_ALLOWED].filter((k) => k !== 'builder' && k !== 'public'))
    assertKeysWithin(s, publicTop, 'public top level')
    if (!Array.isArray(s.media)) return false
    for (const m of s.media as unknown[]) {
      if (!m || typeof m !== 'object') return false
      assertKeysWithin(m as Record<string, unknown>, MEDIA_PUBLIC_ALLOWED, 'public media entry')
    }
    assertNoForbiddenKeys(s)
  } catch {
    return false
  }
  return true
}

// Strip the private media fields and the internal markers from a stored session
// snapshot, producing the public projection. Mirrors read_public_share exactly.
export function toPublicSessionProjection(stored: StoredSessionSnapshot): PublicSessionSnapshot {
  const media: PublicMedia[] = stored.media.map((m) => {
    const out: PublicMedia = {
      ref: m.ref,
      type: m.type,
      caption: m.caption,
      sourceAttribution: m.sourceAttribution,
      link: m.link,
    }
    if (typeof m.url === 'string') out.url = m.url
    return out
  })
  const { builder: _builder, public: _public, media: _m, ...rest } = stored
  return { ...rest, media }
}

// Validate that a value is a well formed PUBLIC session snapshot: known keys
// only at every level, no private media fields, no forbidden key anywhere, the
// pinned version and kind. Used by the read function before responding and by
// the public page before rendering, so an unknown or tampered shape renders the
// neutral unavailable state rather than anything else.
export function validatePublicSessionSnapshot(value: unknown): value is PublicSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'session') return false
  if (s.snapshotVersion !== SNAPSHOT_VERSION) return false
  if (s.public !== undefined || s.builder !== undefined) return false
  try {
    const publicTop = new Set([...SESSION_TOP_ALLOWED].filter((k) => k !== 'builder' && k !== 'public'))
    assertKeysWithin(s, publicTop, 'public session top level')
    if (!Array.isArray(s.media)) return false
    for (const m of s.media as unknown[]) {
      if (!m || typeof m !== 'object') return false
      assertKeysWithin(m as Record<string, unknown>, MEDIA_PUBLIC_ALLOWED, 'public media entry')
    }
    if (!Array.isArray(s.activities)) return false
    for (const a of s.activities as unknown[]) {
      if (!a || typeof a !== 'object') return false
      assertKeysWithin(a as Record<string, unknown>, ACTIVITY_ALLOWED, 'public activity')
    }
    if (!Array.isArray(s.referencedDrills)) return false
    for (const d of s.referencedDrills as unknown[]) {
      if (!d || typeof d !== 'object') return false
      assertKeysWithin(d as Record<string, unknown>, REF_DRILL_ALLOWED, 'public referenced drill')
    }
    if (s.board !== null) {
      if (!s.board || typeof s.board !== 'object' || Array.isArray(s.board)) return false
      const b = s.board as Record<string, unknown>
      assertKeysWithin(b, BOARD_ALLOWED, 'public board')
      if (!Array.isArray(b.tokens)) return false
      for (const t of b.tokens as unknown[]) {
        if (!t || typeof t !== 'object') return false
        assertKeysWithin(t as Record<string, unknown>, BOARD_TOKEN_ALLOWED, 'public board token')
      }
    }
    assertNoForbiddenKeys(s)
  } catch {
    return false
  }
  return true
}

// -------------------------------------------------------------------------
// Secret and hash
// -------------------------------------------------------------------------

// Encode bytes as base64url without padding, URL safe.
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Generate a 256 bit (32 byte) cryptographically secure secret, base64url
// encoded. This is the sole public credential; it is returned to the owner only
// on create or rotate, never stored or logged.
export function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// SHA-256 of the raw secret string (the value that travels in the URL
// fragment). A single SHA-256 is appropriate because the secret is high entropy
// (256 bits), so a slow password hash buys nothing.
export async function sha256Hex(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

// The bytea literal (\x + hex) the lifecycle RPC and read path expect for the
// token hash parameter. Never returns the raw secret.
export async function secretHashLiteral(secret: string): Promise<string> {
  return '\\x' + (await sha256Hex(secret))
}
