// OTJ Training Hub, public share client helpers (Content Sharing PR 2).
//
// Pure, DOM free helpers for the anonymous public DRILL share: the opaque URL
// model (/share/:shareId#secret), reading the secret from the URL fragment, and
// validating the public snapshot schema before rendering. No React, no DOM, no
// network, so this is unit testable without a browser.
//
// URL model. The share is /share/:shareId#secret:
//   - shareId is a lookup id (the share row's own uuid), never a source, club
//     or user id, and it is not an authorisation secret;
//   - the secret lives in the URL FRAGMENT (#secret), which the browser never
//     sends in the request line or the Referer header, so it never reaches
//     Vercel route logs or an external resource the page loads;
//   - the page reads the secret from window.location.hash and sends shareId and
//     secret to read-content-share in a POST body, never in a query string.
//
// The public projection type mirrors the server side snapshot builder
// (supabase/functions/_shared/share.ts). The two are kept in sync deliberately;
// the server is the authority, and this is the client's defensive re-check
// before rendering, so an unknown or tampered shape shows the neutral
// unavailable state rather than anything else.

export const PUBLIC_SNAPSHOT_VERSION = 1

export type PublicMediaType = 'image' | 'pdf' | 'youtube' | 'video'

export interface PublicSourceAttribution {
  url: string
  label: string | null
}

export interface PublicDrillMedia {
  ref: string
  type: PublicMediaType
  caption: string | null
  sourceAttribution: PublicSourceAttribution | null
  link: string | null
  url?: string
}

export type PublicDrillClassification =
  | { type: 'corner'; value: string }
  | { type: 'tags'; value: string[] }
  | null

export interface PublicDrillSnapshot {
  snapshotVersion: number
  kind: 'drill'
  title: string
  summary: string | null
  classification: PublicDrillClassification
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
  sourceAttribution: PublicSourceAttribution | null
  media: PublicDrillMedia[]
  snapshotAt: string
}

// -------------------------------------------------------------------------
// URL model
// -------------------------------------------------------------------------

// Build the full public link, with the secret in the fragment. The origin
// defaults to the current window origin so the link works wherever the app is
// served (production or a preview URL) without hardcoding a host.
export function buildPublicShareUrl(shareId: string, secret: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' && window.location ? window.location.origin : '')
  return `${base}/share/${shareId}#${secret}`
}

// Read the secret from a URL hash (window.location.hash), stripping the leading
// '#'. Returns '' when there is no fragment.
export function readSecretFromHash(hash: string | null | undefined): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash.slice(1) : hash
}

// -------------------------------------------------------------------------
// Public copy (calm, factual, no oracle about which state failed)
// -------------------------------------------------------------------------

export const UNAVAILABLE_HEADING = 'This link is not available'
export const UNAVAILABLE_BODY =
  'If someone shared it with you, ask them to check it or send you a new one.'
export const TRANSIENT_HEADING = 'This could not load right now'
export const TRANSIENT_BODY = 'Try again.'
export const PUBLIC_PAGE_TITLE = 'Shared drill, Ossett Town Juniors'

// Owner facing warnings and confirmation (roadmap sections 8.3, 12).
export const RIGHTS_WARNING =
  'Check the text you wrote, the notes, setup, area and any media captions. Remove any child’s name, and any team, venue or pitch name you would not want public, before you share this. Confirm this text and any diagrams are the club’s own work or cleared for public use, not copied from England Football or another source.'
export const PUBLISH_CONFIRM =
  'Anyone you send this to can open it with no login, and can pass it on. It works until you turn it off or it expires.'
export const ROTATE_WARNING = 'The old link stops working straight away.'
export const SECRET_ONCE_NOTE =
  'This link is shown once. Copy it now. If you lose it, replace the link to get a new one.'
export const KILL_SWITCH_NOTE =
  'Public sharing is turned off for your club. An admin can turn it on.'
export const BLOCKED_FA_NOTE =
  'This uses England Football or other restricted content, which we can only share inside the club.'

// Map a server block reason to calm coach copy.
export function blockedReasonCopy(reasons: string[]): string {
  if (reasons.includes('media_internal_only') || reasons.includes('source_internal_only')) {
    return BLOCKED_FA_NOTE
  }
  if (reasons.includes('media_missing')) {
    return 'A file this drill uses is missing, so it cannot be shared publicly.'
  }
  return 'This drill cannot be shared publicly.'
}

// -------------------------------------------------------------------------
// Snapshot validation (defensive, before rendering)
// -------------------------------------------------------------------------

const TOP_KEYS = new Set<string>([
  'snapshotVersion', 'kind', 'title', 'summary', 'classification', 'skill', 'ages',
  'level', 'duration', 'playerGuidance', 'area', 'equipment', 'setupNotes',
  'coachingPoints', 'easier', 'harder', 'theme', 'format', 'sourceAttribution',
  'media', 'snapshotAt',
])
const MEDIA_KEYS = new Set<string>(['ref', 'type', 'caption', 'sourceAttribution', 'link', 'url'])
const FORBIDDEN = new Set<string>([
  'club_id', 'clubId', 'created_by', 'createdBy', 'media_id', 'mediaId', 'source_key',
  'sourceKey', 'storage_path', 'storagePath', 'token_hash', 'tokenHash', 'secret',
  'coach_id', 'drill_id', 'player_id', 'playerId', 'builder', 'public', '_mid', '_path',
])

function hasNoForbidden(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(hasNoForbidden)
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN.has(k)) return false
      if (!hasNoForbidden(v)) return false
    }
  }
  return true
}

// Validate that a value is a well formed PUBLIC drill snapshot of the pinned
// version and kind, with only allow listed keys and no forbidden key anywhere.
export function validatePublicDrillSnapshot(value: unknown): value is PublicDrillSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'drill') return false
  if (s.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) return false
  for (const key of Object.keys(s)) {
    if (!TOP_KEYS.has(key)) return false
  }
  if (typeof s.title !== 'string') return false
  if (!Array.isArray(s.media)) return false
  for (const m of s.media as unknown[]) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false
    for (const key of Object.keys(m as Record<string, unknown>)) {
      if (!MEDIA_KEYS.has(key)) return false
    }
  }
  return hasNoForbidden(s)
}
