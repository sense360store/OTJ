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
// Public SESSION snapshot (Content Sharing PR 3)
// -------------------------------------------------------------------------
//
// Mirrors the server session builder (supabase/functions/_shared/share.ts):
// media sits in ONE flat top-level pool so the read path signs it with the
// same loop it uses for a drill; referenced drills point into that pool by ref
// (mediaRefs) and the renderer resolves them. A board carries shape and numbers
// only, never a name or a playerId.

export interface PublicBoardToken {
  number: number | null
  side: 'home' | 'away' | null
  x: number
  y: number
}

export interface PublicSessionBoard {
  formation: string | null
  tokens: PublicBoardToken[]
}

export interface PublicSessionActivity {
  phase: string | null
  duration: number | null
  drillRef: string | null
  customTitle: string | null
}

// A drill referenced by a session: the same safe presentational fields as a
// drill snapshot, keyed by a snapshot-local ref, with its media referenced by
// ref into the session media pool (mediaRefs) rather than embedded.
export interface PublicReferencedDrill {
  ref: string
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
  mediaRefs: string[]
}

export interface PublicSessionSnapshot {
  snapshotVersion: number
  kind: 'session'
  displayTitle: string
  focus: string | null
  ageGroup: string | null
  totalDuration: number
  intentions: string[]
  space: string | null
  activities: PublicSessionActivity[]
  referencedDrills: PublicReferencedDrill[]
  board: PublicSessionBoard | null
  media: PublicDrillMedia[]
  sourceAttribution: PublicSourceAttribution | null
  snapshotAt: string
}

// -------------------------------------------------------------------------
// Public PROGRAMME snapshot (Content Sharing PR 4)
// -------------------------------------------------------------------------
//
// Mirrors the server programme builder (supabase/functions/_shared/share.ts).
// The same flat top-level media pool as a session, shared by every week's
// drills AND the optional attached PDF, which points into it by ref rather than
// carrying a path. A week's number field is `week`; programmeWeek is a
// forbidden key. The template's author is never present: it is a club member's
// full name and is excluded from the projection entirely.

export interface PublicProgrammeWeek {
  week: number
  title: string | null
  focus: string | null
  activities: PublicSessionActivity[]
  totalDuration: number
}

export interface PublicProgrammeSnapshot {
  snapshotVersion: number
  kind: 'programme'
  displayTitle: string
  focus: string | null
  summary: string | null
  intentions: string[]
  weeks: number | null
  orderedWeekNumbers: number[]
  weekTemplates: PublicProgrammeWeek[]
  referencedDrills: PublicReferencedDrill[]
  pdf: { ref: string } | null
  media: PublicDrillMedia[]
  sourceAttribution: PublicSourceAttribution | null
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
// Neutral across kinds: the document title is set at mount, before the snapshot
// (and therefore its kind) has resolved, so it must not name drill or session.
export const PUBLIC_PAGE_TITLE = 'Shared from Ossett Town Juniors'

// Owner facing warnings and confirmation (roadmap sections 8.3, 12).
// The file-name line addresses the honest residual that a shared media file's
// own name is visible to a recipient: as the media caption (which the preview
// does render), and inside the signed URL of the file itself.
export const RIGHTS_WARNING =
  'Check the text you wrote, the notes, setup, area and any media captions. Remove any child’s name, and any team, venue or pitch name you would not want public, before you share this. The name of an uploaded file can also be seen by anyone who opens it, so replace a file whose name includes a child’s name before sharing. Confirm this text and any diagrams are the club’s own work or cleared for public use, not copied from England Football or another source.'
export const PUBLISH_CONFIRM =
  'Anyone you send this to can open it with no login, and can pass it on. It works until you turn it off or it expires.'
export const ROTATE_WARNING = 'The old link stops working straight away.'
export const SECRET_ONCE_NOTE =
  'This link is shown once. Copy it now. If you lose it, replace the link to get a new one.'
export const KILL_SWITCH_NOTE =
  'Public sharing is turned off for your club. An admin can turn it on.'
// Shown on the public page beside the Print / Save as PDF action. A printed or
// saved copy leaves the platform: revoking the link cannot reach it.
export const PRINT_WARNING = 'A downloaded or printed copy cannot be turned off or recalled.'

// Blocker copy moved to src/lib/shareBlockers.ts. It used to live here as three
// per kind functions that mapped every *_internal_only reason to one England
// Football sentence, which told a coach their own club written content came
// from England Football. Reason ordering and provenance now decide the wording;
// see shareBlockers.ts for why.

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
// Kept aligned with FORBIDDEN_ANYWHERE in supabase/functions/_shared/share.ts,
// plus the four client-only markers (builder, public, _mid, _path) that the
// read path strips and must never arrive here. The server is the authority;
// this is the browser's independent re-check before anything renders.
const FORBIDDEN = new Set<string>([
  'club_id', 'clubId', 'created_by', 'createdBy', 'created_at', 'createdAt',
  'media_id', 'mediaId', 'source_key', 'sourceKey', 'source_programme_id',
  'storage_path', 'storagePath', 'embed_url', 'embedUrl', 'token_hash', 'tokenHash',
  'secret', 'coach_id', 'coachId', 'drill_id', 'drillId', 'session_id', 'programme_id',
  'idempotency_key', 'revoked_by', 'updated_by', 'rights_class_observed', 'player_id',
  'playerId', 'author', 'pdf_media_id', 'pdfMediaId', 'sessionId', 'programmeId',
  'team_id', 'teamId', 'venue', 'start_time', 'startTime', 'date',
  'spond_event_id', 'spondEventId', 'board_id', 'boardId', 'programme_week',
  'programmeWeek', 'live_activity_index', 'liveActivityIndex',
  'live_activity_started_at', 'liveActivityStartedAt',
  // Training day columns (0044): venue, coverage, bibs and the register.
  'venue_id', 'venueId', 'teamIds', 'session_teams', 'sessionTeams',
  'bib_colour', 'bibColour', 'bib_colour_override', 'bibColourOverride',
  'register_entries', 'registerEntries', 'present',
  'included_in_groups', 'includedInGroups',
  'marked_by', 'markedBy', 'marked_at', 'markedAt',
  // Spond member links and per child RSVP (0045), kept in step with the
  // server list above.
  'spond_member_id', 'spondMemberId', 'player_spond_links', 'playerSpondLinks',
  'spond_event_responses', 'spondEventResponses', 'matched_by', 'matchedBy',
  'rsvp', 'rsvpStatus',
  // The drill diagram (0046), kept in step with the server list above. C1 does
  // not publish a diagram; this is the browser's half of the tripwire.
  'diagram',
  'builder', 'public', '_mid', '_path',
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

// -------------------------------------------------------------------------
// Session snapshot validation (defensive, before rendering)
// -------------------------------------------------------------------------

const SESSION_TOP_KEYS = new Set<string>([
  'snapshotVersion', 'kind', 'displayTitle', 'focus', 'ageGroup', 'totalDuration',
  'intentions', 'space', 'activities', 'referencedDrills', 'board', 'media',
  'sourceAttribution', 'snapshotAt',
])
const ACTIVITY_KEYS = new Set<string>(['phase', 'duration', 'drillRef', 'customTitle'])
const REF_DRILL_KEYS = new Set<string>([
  'ref', 'title', 'summary', 'classification', 'skill', 'ages', 'level', 'duration',
  'playerGuidance', 'area', 'equipment', 'setupNotes', 'coachingPoints', 'easier',
  'harder', 'theme', 'format', 'sourceAttribution', 'mediaRefs',
])
const BOARD_KEYS = new Set<string>(['formation', 'tokens'])
const TOKEN_KEYS = new Set<string>(['number', 'side', 'x', 'y'])

function keysWithin(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return false
  }
  return true
}

// Validate that a value is a well formed PUBLIC session snapshot of the pinned
// version and kind, with only allow listed keys at every level, a board that is
// numbers and positions only, activity drill references that all resolve, and
// no forbidden key anywhere (blocks playerId/storage_path/_path etc.).
export function validatePublicSessionSnapshot(value: unknown): value is PublicSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'session') return false
  if (s.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) return false
  if (!keysWithin(s, SESSION_TOP_KEYS)) return false
  if (typeof s.displayTitle !== 'string') return false

  if (!Array.isArray(s.media)) return false
  for (const m of s.media as unknown[]) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false
    if (!keysWithin(m as Record<string, unknown>, MEDIA_KEYS)) return false
  }

  if (!Array.isArray(s.activities)) return false
  for (const a of s.activities as unknown[]) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false
    if (!keysWithin(a as Record<string, unknown>, ACTIVITY_KEYS)) return false
  }

  if (!Array.isArray(s.referencedDrills)) return false
  const refs = new Set<string>()
  for (const d of s.referencedDrills as unknown[]) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false
    const dr = d as Record<string, unknown>
    if (!keysWithin(dr, REF_DRILL_KEYS)) return false
    if (typeof dr.ref !== 'string') return false
    refs.add(dr.ref)
  }
  // Every activity drill reference must resolve to a referenced drill.
  for (const a of s.activities as Array<Record<string, unknown>>) {
    if (a.drillRef != null && !refs.has(a.drillRef as string)) return false
  }

  if (s.board !== null) {
    if (!s.board || typeof s.board !== 'object' || Array.isArray(s.board)) return false
    const b = s.board as Record<string, unknown>
    if (!keysWithin(b, BOARD_KEYS)) return false
    if (!Array.isArray(b.tokens)) return false
    for (const t of b.tokens as unknown[]) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) return false
      const tok = t as Record<string, unknown>
      if (!keysWithin(tok, TOKEN_KEYS)) return false
      if (tok.side !== 'home' && tok.side !== 'away' && tok.side !== null) return false
      if (typeof tok.x !== 'number' || !Number.isFinite(tok.x)) return false
      if (typeof tok.y !== 'number' || !Number.isFinite(tok.y)) return false
    }
  }

  return hasNoForbidden(s)
}

// -------------------------------------------------------------------------
// Programme snapshot validation (defensive, before rendering)
// -------------------------------------------------------------------------

const PROGRAMME_TOP_KEYS = new Set<string>([
  'snapshotVersion', 'kind', 'displayTitle', 'focus', 'summary', 'intentions',
  'weeks', 'orderedWeekNumbers', 'weekTemplates', 'referencedDrills', 'pdf',
  'media', 'sourceAttribution', 'snapshotAt',
])
const WEEK_KEYS = new Set<string>(['week', 'title', 'focus', 'activities', 'totalDuration'])
const PDF_KEYS = new Set<string>(['ref'])

// Validate that a value is a well formed PUBLIC programme snapshot of the
// pinned version and kind, with only allow listed keys at every level, week
// numbers that are integers, activity drill references that all resolve, a pdf
// pointer that resolves into the flat media pool, and no forbidden key anywhere
// (blocks author/programme_week/storage_path/_path etc.).
export function validatePublicProgrammeSnapshot(value: unknown): value is PublicProgrammeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'programme') return false
  if (s.snapshotVersion !== PUBLIC_SNAPSHOT_VERSION) return false
  if (!keysWithin(s, PROGRAMME_TOP_KEYS)) return false
  if (typeof s.displayTitle !== 'string') return false

  if (!Array.isArray(s.media)) return false
  const mediaRefs = new Set<string>()
  for (const m of s.media as unknown[]) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false
    if (!keysWithin(m as Record<string, unknown>, MEDIA_KEYS)) return false
    const ref = (m as Record<string, unknown>).ref
    if (typeof ref !== 'string') return false
    mediaRefs.add(ref)
  }

  if (!Array.isArray(s.referencedDrills)) return false
  const drillRefs = new Set<string>()
  for (const d of s.referencedDrills as unknown[]) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false
    const dr = d as Record<string, unknown>
    if (!keysWithin(dr, REF_DRILL_KEYS)) return false
    if (typeof dr.ref !== 'string') return false
    drillRefs.add(dr.ref)
    if (!Array.isArray(dr.mediaRefs)) return false
    for (const mr of dr.mediaRefs as unknown[]) {
      if (typeof mr !== 'string' || !mediaRefs.has(mr)) return false
    }
  }

  if (!Array.isArray(s.orderedWeekNumbers)) return false
  for (const n of s.orderedWeekNumbers as unknown[]) {
    if (typeof n !== 'number' || !Number.isInteger(n)) return false
  }

  if (!Array.isArray(s.weekTemplates)) return false
  for (const w of s.weekTemplates as unknown[]) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return false
    const wk = w as Record<string, unknown>
    if (!keysWithin(wk, WEEK_KEYS)) return false
    if (typeof wk.week !== 'number' || !Number.isInteger(wk.week)) return false
    if (!Array.isArray(wk.activities)) return false
    for (const a of wk.activities as unknown[]) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return false
      const act = a as Record<string, unknown>
      if (!keysWithin(act, ACTIVITY_KEYS)) return false
      // Every activity drill reference must resolve to a referenced drill.
      if (act.drillRef != null && !drillRefs.has(act.drillRef as string)) return false
    }
  }

  if (s.pdf !== null) {
    if (!s.pdf || typeof s.pdf !== 'object' || Array.isArray(s.pdf)) return false
    const pdf = s.pdf as Record<string, unknown>
    if (!keysWithin(pdf, PDF_KEYS)) return false
    // The pdf pointer must resolve into the same flat media pool.
    if (typeof pdf.ref !== 'string' || !mediaRefs.has(pdf.ref)) return false
  }

  return hasNoForbidden(s)
}
