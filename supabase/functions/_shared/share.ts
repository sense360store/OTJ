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

  const corner = sanitizeText(drill.corner, 40)
  const tags = sanitizeTextArray(drill.tags, MAX_ARRAY_ITEMS, 60)
  let classification: DrillClassification = null
  if (corner !== null) classification = { type: 'corner', value: corner }
  else if (tags.length > 0) classification = { type: 'tags', value: tags }

  const mediaEntries: StoredMedia[] = media ? [buildMediaEntry(media, 'm1')] : []

  const snapshot: StoredDrillSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    kind: 'drill',
    title: sanitizeText(drill.title, 300) ?? 'Untitled drill',
    summary: sanitizeText(drill.summary),
    classification,
    skill: sanitizeText(drill.skill, 300),
    ages: sanitizeTextArray(drill.ages, 32, 40),
    level: sanitizeText(drill.level, 40),
    duration: typeof drill.duration === 'number' && Number.isFinite(drill.duration) ? drill.duration : null,
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
    media: mediaEntries,
    snapshotAt,
    builder: DRILL_BUILDER,
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
export function assertAllowlistedKeys(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('snapshot allow list: not an object')
  }
  const s = snapshot as Record<string, unknown>
  assertKeysWithin(s, TOP_ALLOWED, 'top level')
  if (s.classification && typeof s.classification === 'object') {
    assertKeysWithin(s.classification as Record<string, unknown>, CLASSIFICATION_ALLOWED, 'classification')
  }
  if (s.sourceAttribution && typeof s.sourceAttribution === 'object') {
    assertKeysWithin(s.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'sourceAttribution')
  }
  if (Array.isArray(s.media)) {
    for (const m of s.media as unknown[]) {
      if (!m || typeof m !== 'object') throw new Error('snapshot allow list: media entry not an object')
      assertKeysWithin(m as Record<string, unknown>, MEDIA_ALLOWED, 'media entry')
      const me = m as Record<string, unknown>
      if (me.sourceAttribution && typeof me.sourceAttribution === 'object') {
        assertKeysWithin(me.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'media sourceAttribution')
      }
    }
  }
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
