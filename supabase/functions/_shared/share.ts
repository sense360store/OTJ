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

import { isCanonicalMediaPath } from './mediaPath.ts'

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

// The programme builder identity (Content Sharing PR 4). A programme snapshot is
// a public projection of one saved programme: its overview, its ordered weeks
// (each week being a template row carrying programme_week), each week's ordered
// activities, the full snapshots of every drill those activities reference, an
// optional attached PDF, and one flat top-level pool of the referenced media.
// The pool sits at the top level for the same reason the session pool does:
// read_public_share signs snapshot->'media' and nothing else.
export const PROGRAMME_BUILDER = 'programme@1'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The snapshot size cap, mirrored by the lifecycle RPC (256 KiB). The RPC is the
// authority (content_share_resolve_snapshot rejects an oversized snapshot with a
// bare exception); the programme builder checks it too so a coach gets a stated
// reason instead of a generic failure. A programme is the first kind that can
// realistically approach this cap.
export const MAX_SNAPSHOT_BYTES = 262144

// Programme aggregate caps. Reported, never silently applied: a programme over
// either cap is refused with a stated reason rather than truncated, because a
// truncated programme would publish a partial copy of the club's material.
export const MAX_PROGRAMME_WEEKS = 12
export const MAX_PROGRAMME_MEDIA = 64

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
  // Read for provenance only, never projected (the builder copies an explicit
  // allow list, and source_key is in FORBIDDEN_ANYWHERE).
  source_key?: string | null
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
  | 'media_path_invalid'

export interface Eligibility {
  eligible: boolean
  blocked: BlockReason[]
}

// -------------------------------------------------------------------------
// Provenance (bounded, non identifying)
// -------------------------------------------------------------------------
//
// A blocked share tells a coach WHICH LAYER refused. Until now it told them
// nothing about WHY that layer is club only, so the client said England
// Football for every case, including a coach's own writing. These helpers
// derive provenance from the source columns a row already carries, so the
// client can say England Football only where the data proves it.
//
// This is a classification of the row's recorded origin, never of its content
// and never of a person. What crosses the wire is one enum for the source row
// and one boolean per nested layer; no id, title, path or count.
//
// Mirrors public.content_rights_is_fa_url (the boundary) and src/lib/fa.ts
// isFaUrl. All three read the URL host and nothing else.

export type SourceProvenance = 'none' | 'fa' | 'third_party'

const FA_HOSTS = ['learn.englandfootball.com', 'cdn.englandfootball.com']
const FA_SOURCE_LABEL = 'England Football Learning'

export function isFaSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return FA_HOSTS.includes(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

export interface ProvenanceFields {
  source_url?: string | null
  source_label?: string | null
  source_key?: string | null
}

function filled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

export function rowProvenance(row: ProvenanceFields): SourceProvenance {
  if (isFaSourceUrl(row.source_url) || isFaSourceUrl(row.source_key)) return 'fa'
  if (filled(row.source_label) && row.source_label!.trim() === FA_SOURCE_LABEL) return 'fa'
  if (filled(row.source_url) || filled(row.source_label) || filled(row.source_key)) return 'third_party'
  return 'none'
}

// True when at least one of the given rows both blocks the share (it is club
// only) and is England Football derived. Aggregate by design: it names no row,
// so a coach never learns which of another coach's items is restricted.
export function anyRestricted(
  rows: ReadonlyArray<ProvenanceFields & { rights?: ContentRights }>,
): boolean {
  return rows.some((r) => r.rights === 'internal_only' && rowProvenance(r) === 'fa')
}

export interface SharePreviewProvenance {
  source: SourceProvenance
  restricted: { template: boolean; drill: boolean; media: boolean; pdf: boolean }
}

export function emptyRestricted(): SharePreviewProvenance['restricted'] {
  return { template: false, drill: false, media: false, pdf: false }
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

// The media whose stored path is not the canonical path of an object owned by
// its own club. Callers refuse the whole share rather than dropping the item,
// so a share is never quietly published with one piece missing.
//
// Only a stored object can be wrong this way: a YouTube item carries no path,
// and an item with no path signs nothing. A path that fails here means the row
// points somewhere it does not own (another club, the avatars namespace, an
// object it never created) or is shaped so that Storage might read it
// differently from the way this code does. Either way it must not be signed.
export function invalidMediaPaths(
  media: Array<Pick<MediaRow, 'id' | 'club_id' | 'storage_path' | 'rights' | 'type'>>,
): string[] {
  return media
    .filter(
      (m) =>
        m.rights === 'public_full' &&
        m.type !== 'youtube' &&
        typeof m.storage_path === 'string' &&
        m.storage_path.length > 0 &&
        !isCanonicalMediaPath(m.storage_path, m.club_id),
    )
    .map((m) => m.id)
}

function buildMediaEntry(media: MediaRow, ref: string): StoredMedia {
  const caption = sanitizeText(media.name, 300)
  const sourceAttribution = attributionOf(media.source_url, media.source_label)
  // public_full stored object: reference the private path for read-time signing.
  if (media.rights === 'public_full' && media.storage_path && media.type !== 'youtube') {
    // Never put an unvalidated path into _path. The read path signs with the
    // service role, which bypasses every Storage policy, so a path that is not
    // this club's own object would be a direct disclosure. Defensive: the
    // caller evaluates invalidMediaPaths first and returns a 422, and the
    // database CHECK constraint refuses to store such a path at all. Reaching
    // here means both were bypassed, so fail the whole share closed.
    if (!isCanonicalMediaPath(media.storage_path, media.club_id)) {
      throw new Error('buildMediaEntry: refusing a media path outside its own club namespace')
    }
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
  // The structural declaration and the session-local stand-down. Read as
  // `unknown` and validated below, never projected: neither reaches
  // PublicActivity and neither is allowed to.
  slot?: unknown
  skipped?: unknown
}

// THE ACTIVE DURATION RULE, IN DENO.
//
// This is a DELIBERATE DUPLICATE of src/lib/activityStructure.ts. Edge
// Functions run in their own runtime and cannot import from src/lib/, so the
// choice is one rule written twice and tested at both ends, or one rule and an
// inappropriate cross-runtime import. It is written twice, and
// share_test.ts pins the same cases src/lib/activityStructure.test.ts pins so
// the two cannot drift silently.
//
// An activity stops counting only when it carries a valid operational slot AND
// is stood down. Both halves are load bearing: a stray `skipped` on an
// activity with no slot changes nothing, so the key is inert outside the
// operational plan. No stored row carries `skipped` today, so every existing
// snapshot totals exactly what it totalled before.
//
// SESSIONS ONLY. buildProgrammeSnapshot sums WEEK activities and must not use
// this: a template never carries `skipped`, because the client strips it at
// every template boundary.
function isStoodDownActivity(a: RawActivity): boolean {
  const operational = a.slot === 'station' || a.slot === 'game'
  return operational && a.skipped === true
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
  | 'media_path_invalid'
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

// A drill activity references a drill by a CLEAN uuid; a custom activity has no
// drill_id (absent, null or an empty string). Anything else is an unsupported
// item and fails the whole share closed: a non-object entry, a non-string
// drill_id, or a string that is not a clean uuid (whitespace padded or
// malformed). This is deliberately exact rather than lenient (no trimming), so
// it agrees with the RPC's dependency resolver, which casts the raw jsonb value
// with `::uuid` and would crash on a padded or non-uuid value, and with the
// Edge Function's own raw-uuid drill id collection. A tolerant classification
// here would let preview report eligible while create then failed, or block a
// value the RPC could actually share; keeping all three in lockstep prevents
// both mismatches.
function activityShape(
  raw: RawActivity | unknown,
): { kind: 'drill'; drillId: string } | { kind: 'custom' } | { kind: 'unsupported' } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unsupported' }
  const a = raw as RawActivity
  const rawId = a.drill_id
  // No drill reference (absent, null or empty): a custom activity.
  if (rawId === undefined || rawId === null || rawId === '') return { kind: 'custom' }
  // A drill reference is present: it must be a clean uuid string. A non-string,
  // padded or malformed value is unsupported, never silently treated as custom.
  if (typeof rawId !== 'string' || !UUID_RE.test(rawId)) return { kind: 'unsupported' }
  return { kind: 'drill', drillId: rawId }
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
    // A stood-down activity STAYS IN THE PROJECTED LIST, carrying the duration
    // the coach planned for it, and contributes nothing to the total. That is
    // the smallest consistent choice and it falls out of the existing allow
    // list rather than needing a new rule:
    //
    //   - Dropping the activity would make the public plan disagree with the
    //     plan the coach shared, for no gain.
    //   - Zeroing its own duration would publish WHICH station was stood down,
    //     which is operational detail a frozen public plan has no consumer for
    //     and no business carrying.
    //   - Publishing `skipped` would mean widening two allow lists in two
    //     runtimes. PublicActivity is exactly phase, duration, drillRef and
    //     customTitle, enforced here and by ACTIVITY_KEYS in
    //     src/lib/publicShare.ts, so slot and skipped are already excluded.
    //
    // The consequence is stated rather than hidden: on a session with
    // something stood down, the published activity durations sum to MORE than
    // totalDuration. totalDuration is the answer to how long the session ran,
    // and it is the same number the browser shows.
    if (typeof duration === 'number' && !isStoodDownActivity(a)) totalDuration += duration
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
// The programme snapshot builder (Content Sharing PR 4)
// -------------------------------------------------------------------------

// The subset of programme columns the builder reads. Ownership and operational
// columns (club_id, created_by, created_at) are never read here and never enter
// the snapshot. pdf_media_id is read only to resolve the attached PDF into the
// media pool by ref; the real id never reaches the snapshot.
export interface ProgrammeRow {
  id: string
  name: string | null
  focus: string | null
  summary: string | null
  intentions: string[] | null
  weeks: number | null
  pdf_media_id: string | null
  source_url: string | null
  source_label: string | null
  rights: ContentRights
}

// The subset of template columns the builder reads. Deliberately NO author:
// templates.author is a club member's full name in plain text and is the single
// hard exclusion of this projection (it is also in FORBIDDEN_ANYWHERE, so a
// future reintroduction trips the scanner rather than leaking). No created_by
// either. created_at is read for ORDERING ONLY (the earliest created template
// claims a contested week, matching what the club's programme page renders) and
// is never projected; the allow list and the forbidden key scanner both prove
// that.
export interface TemplateRow {
  id: string
  name: string | null
  focus: string | null
  activities: unknown
  programme_week: number | null
  created_at: string | null
  rights: ContentRights
  // Read for provenance only, never projected. The builder's allow list does
  // not copy them onto a week, and the source attribution a public programme
  // shows is the programme's own.
  source_url?: string | null
  source_label?: string | null
}

// One public programme week: its number, the safe titling of the template that
// claims it, and that template's ordered activities. The field is named `week`,
// never programmeWeek or programme_week, because both of those are in
// FORBIDDEN_ANYWHERE and would make the builder throw on its own output.
export interface PublicWeek {
  week: number
  title: string | null
  focus: string | null
  activities: PublicActivity[]
  totalDuration: number
}

interface ProgrammeSnapshotBase {
  snapshotVersion: number
  kind: 'programme'
  displayTitle: string
  focus: string | null
  summary: string | null
  intentions: string[]
  weeks: number | null
  orderedWeekNumbers: number[]
  weekTemplates: PublicWeek[]
  referencedDrills: ReferencedDrill[]
  pdf: { ref: string } | null
  sourceAttribution: SourceAttribution | null
  snapshotAt: string
}

// The stored programme snapshot: the flat media pool carries the private fields
// and the internal markers the read path strips.
export interface StoredProgrammeSnapshot extends ProgrammeSnapshotBase {
  media: StoredMedia[]
  builder: string
  public: true
}

// The public projection: no private media fields, no internal markers.
export interface PublicProgrammeSnapshot extends ProgrammeSnapshotBase {
  media: PublicMedia[]
}

export type ProgrammeBlockReason =
  | 'source_internal_only'
  | 'template_internal_only'
  | 'drill_internal_only'
  | 'media_internal_only'
  | 'pdf_internal_only'
  | 'drill_missing'
  | 'media_missing'
  | 'media_path_invalid'
  | 'pdf_missing'
  | 'unsupported_item'
  | 'no_weeks'
  | 'too_many_weeks'
  | 'too_many_media'
  | 'snapshot_too_large'

export interface ProgrammeEligibility {
  eligible: boolean
  blocked: ProgrammeBlockReason[]
}

// The programme builder's throws carry the reason they refused, so the caller
// reports what actually happened instead of collapsing every refusal into one
// message. The throws are defensive (the caller must evaluate eligibility
// first), so a reason arriving here at all means eligibility and the builder
// disagreed, which is worth surfacing accurately rather than mislabelling.
export class ProgrammeBuildError extends Error {
  readonly reason: ProgrammeBlockReason
  constructor(reason: ProgrammeBlockReason, message: string) {
    super(message)
    this.name = 'ProgrammeBuildError'
    this.reason = reason
  }
}

// A template claims a week only when programme_week is a positive integer. A
// null, zero, negative or fractional week is unassigned: the club's programme
// page never renders it (its week list runs 1..weekCount), so neither does the
// public copy. An unassigned template is still a DEPENDENCY (content_share_deps
// returns every template with this programme_id), so its rights and its drills
// still gate the share; it simply has no week to render. That asymmetry is
// deliberate and strictly fail closed: a share can be blocked by a template the
// public page would not have shown, never the reverse.
function claimedWeek(template: Pick<TemplateRow, 'programme_week'>): number | null {
  const w = template.programme_week
  if (typeof w !== 'number' || !Number.isInteger(w) || w < 1) return null
  return w
}

// Order templates deterministically and resolve which template owns each week.
// Sort key: week ascending, then created_at ascending, then id ascending. The
// created_at tiebreak reproduces the club programme page's "the earliest created
// template claims the week" rule; the id tiebreak makes the result total, so the
// builder is deterministic even when two templates share a timestamp or the
// database returns rows in an arbitrary order.
function orderProgrammeTemplates(templates: TemplateRow[]): Map<number, TemplateRow> {
  const claimed = templates
    .map((t) => ({ t, week: claimedWeek(t) }))
    .filter((e): e is { t: TemplateRow; week: number } => e.week !== null)
  claimed.sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week
    const ac = a.t.created_at ?? ''
    const bc = b.t.created_at ?? ''
    if (ac !== bc) return ac < bc ? -1 : 1
    return a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0
  })
  const byWeek = new Map<number, TemplateRow>()
  for (const { t, week } of claimed) {
    if (!byWeek.has(week)) byWeek.set(week, t)
  }
  return byWeek
}

// How many weeks the public page renders: the larger of the programme's declared
// week count and the highest week any template claims. This mirrors
// ProgrammeDetail exactly, so the public copy and the club page agree on how
// many weeks a programme has, including weeks no template has filled in yet.
//
// This returns a COUNT and never materialises the list, because programmes.weeks
// is a plain int column: a row carrying 2000000000 (a typo, or a hostile value
// written through the programmes API by a coach who may legitimately edit it)
// would otherwise allocate a two billion entry array before any cap could refuse
// it, hanging the function. The count is compared against the cap first; only a
// count within the cap is ever expanded (programmeWeekNumbers below).
//
// The highest claimed week is found with a loop, not Math.max(...keys), because
// spreading a large key set overflows the call stack.
function programmeWeekCount(programme: Pick<ProgrammeRow, 'weeks'>, byWeek: Map<number, TemplateRow>): number {
  const raw = programme.weeks
  const declared = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  let highestClaimed = 0
  for (const w of byWeek.keys()) {
    if (w > highestClaimed) highestClaimed = w
  }
  return Math.max(declared, highestClaimed, 0)
}

// Expand a week count into 1..count. Only ever called with a count already
// proven to be within MAX_PROGRAMME_WEEKS.
function programmeWeekNumbers(count: number): number[] {
  const out: number[] = []
  for (let i = 1; i <= count; i++) out.push(i)
  return out
}

// Evaluate whether a programme is publicly shareable. Fail closed aggregate
// block rule: the programme's own rights, EVERY template that belongs to it,
// every drill those templates' activities reference, every one of those drills'
// media, and the attached PDF must all be eligible and present in the source's
// club. One restricted, missing or cross club dependency blocks the whole
// programme; nothing is partially published. The caller passes only rows it has
// already club scoped, so a cross club or absent id arrives as a missing row.
//
// A programme with no week at all is refused (no_weeks): an overview with no
// content is not a useful public copy, and refusing keeps "a share always
// carries the material it claims to" true.
export function evaluateProgrammeEligibility(
  programme: Pick<ProgrammeRow, 'rights' | 'weeks' | 'pdf_media_id'>,
  templates: Array<Pick<TemplateRow, 'id' | 'rights' | 'activities' | 'programme_week'>>,
  drills: Array<Pick<DrillRow, 'id' | 'rights' | 'media_id'>>,
  media: Array<Pick<MediaRow, 'id' | 'rights'>>,
): ProgrammeEligibility {
  const blocked = new Set<ProgrammeBlockReason>()
  if (programme.rights === 'internal_only') blocked.add('source_internal_only')

  const drillById = new Map(drills.map((d) => [d.id, d]))
  const mediaById = new Map(media.map((m) => [m.id, m]))

  for (const t of templates) {
    if (t.rights === 'internal_only') blocked.add('template_internal_only')
    for (const raw of parseActivities(t.activities)) {
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
  }

  // The attached PDF is private media like any other. It is shared only when it
  // exists in the same club and is eligible; an internal_only or missing PDF
  // blocks the WHOLE programme rather than being silently dropped, because the
  // PDF is usually the programme's substance and a copy without it would
  // misrepresent what was shared. This matches content_share_deps, which already
  // emits pdf_media_id as a media dependency, so the RPC refuses it too.
  if (programme.pdf_media_id) {
    const pdf = mediaById.get(programme.pdf_media_id)
    if (!pdf) blocked.add('pdf_missing')
    else if (pdf.rights === 'internal_only') blocked.add('pdf_internal_only')
  }

  // The media cap is evaluated here, on the same distinct set the builder will
  // pool (every referenced drill's media, plus the attached PDF), so a
  // programme over the cap is reported as too_many_media rather than sailing
  // through eligibility and being refused later as a size failure.
  const pooled = new Set<string>()
  for (const t of templates) {
    for (const raw of parseActivities(t.activities)) {
      const shape = activityShape(raw)
      if (shape.kind !== 'drill') continue
      const d = drillById.get(shape.drillId)
      if (d?.media_id) pooled.add(d.media_id)
    }
  }
  if (programme.pdf_media_id) pooled.add(programme.pdf_media_id)
  if (pooled.size > MAX_PROGRAMME_MEDIA) blocked.add('too_many_media')

  // Cap checked against the COUNT, before any per week work, so an absurd
  // programmes.weeks value is refused instead of expanded.
  const byWeek = orderProgrammeTemplates(templates as TemplateRow[])
  const weekCount = programmeWeekCount(programme, byWeek)
  // no_weeks means there is nothing to share, which is a stronger statement
  // than "the declared count is zero". A programme carrying weeks = 6 and no
  // week template at all would otherwise project six empty weeks: a public page
  // showing a title and six blank rows, which misrepresents the programme and
  // is worth nothing to a recipient. It is also a structural blocker, so it
  // outranks every rights reason and cannot be cleared by reclassifying the
  // programme row.
  if (weekCount === 0 || byWeek.size === 0) blocked.add('no_weeks')
  if (weekCount > MAX_PROGRAMME_WEEKS) blocked.add('too_many_weeks')

  return { eligible: blocked.size === 0, blocked: [...blocked] }
}

// Build the stored programme snapshot from the live programme, the club scoped
// templates that are its weeks, the club scoped drills those templates
// reference, those drills' media, and the optional attached PDF media.
//
// The caller MUST have confirmed eligibility first (evaluateProgrammeEligibility);
// this throws defensively on any internal_only, missing or unsupported item so
// an ineligible programme can never be projected. Media (including the PDF) is
// deduplicated into ONE flat top-level pool so the read path signs it with its
// existing loop; referenced drills and the pdf pointer both index into that pool
// by ref. Deterministic for a fixed snapshotAt regardless of input row order.
export function buildProgrammeSnapshot(
  programme: ProgrammeRow,
  templates: TemplateRow[],
  drills: DrillRow[],
  media: MediaRow[],
  snapshotAt: string,
): StoredProgrammeSnapshot {
  if (programme.rights === 'internal_only') {
    throw new ProgrammeBuildError('source_internal_only', 'buildProgrammeSnapshot: refusing to project an internal_only programme')
  }
  for (const t of templates) {
    if (t.rights === 'internal_only') {
      throw new ProgrammeBuildError('template_internal_only', 'buildProgrammeSnapshot: refusing to project an internal_only template')
    }
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
    if (!m) throw new ProgrammeBuildError('media_missing', 'buildProgrammeSnapshot: a referenced media is missing')
    if (m.rights === 'internal_only') {
      throw new ProgrammeBuildError('media_internal_only', 'buildProgrammeSnapshot: refusing to project internal_only media')
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
    if (!d) throw new ProgrammeBuildError('drill_missing', 'buildProgrammeSnapshot: a referenced drill is missing')
    if (d.rights === 'internal_only') {
      throw new ProgrammeBuildError('drill_internal_only', 'buildProgrammeSnapshot: refusing to project an internal_only drill')
    }
    const ref = 'd' + (referencedDrills.length + 1)
    // Reserve the ref before projecting so a self reference cannot recurse.
    drillRefById.set(drillId, ref)
    const mediaRefs: string[] = []
    if (d.media_id) mediaRefs.push(ensureMediaRef(d.media_id))
    referencedDrills.push({ ref, ...projectDrillFields(d), mediaRefs })
    return ref
  }

  // Same order as eligibility: the count is capped BEFORE it is expanded, so the
  // builder can never allocate an unbounded week list either.
  const byWeek = orderProgrammeTemplates(templates)
  const weekCount = programmeWeekCount(programme, byWeek)
  // Same rule as eligibility: a declared week count with no template behind it
  // is nothing to share, not six empty weeks.
  if (weekCount === 0 || byWeek.size === 0) {
    throw new ProgrammeBuildError('no_weeks', 'buildProgrammeSnapshot: refusing to project a programme with no weeks')
  }
  if (weekCount > MAX_PROGRAMME_WEEKS) {
    throw new ProgrammeBuildError('too_many_weeks', 'buildProgrammeSnapshot: refusing to project more than the week cap')
  }
  const orderedWeekNumbers = programmeWeekNumbers(weekCount)

  // Weeks are walked in ascending order, and each week's activities in stored
  // order, so ref numbering (d1, d2, m1, m2 ...) is first encounter order over a
  // stable traversal. Any other traversal would make refs depend on the order
  // Postgres happened to return the templates in.
  const weekTemplates: PublicWeek[] = []
  for (const week of orderedWeekNumbers) {
    const t = byWeek.get(week)
    if (!t) {
      // A week no template has filled in yet. The club page renders it as an
      // empty week; so does the public copy.
      weekTemplates.push({ week, title: null, focus: null, activities: [], totalDuration: 0 })
      continue
    }
    const activities: PublicActivity[] = []
    let totalDuration = 0
    for (const raw of parseActivities(t.activities)) {
      const shape = activityShape(raw)
      if (shape.kind === 'unsupported') {
        throw new ProgrammeBuildError('unsupported_item', 'buildProgrammeSnapshot: an unsupported activity item')
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
    weekTemplates.push({
      week,
      title: sanitizeText(t.name, 300),
      focus: sanitizeText(t.focus, 300),
      activities,
      totalDuration,
    })
  }

  // The attached PDF joins the SAME pool and is addressed by a ref. It is never
  // a second pool and never a path, because read_public_share signs exactly the
  // entries of snapshot->'media' and nothing else.
  let pdf: { ref: string } | null = null
  if (programme.pdf_media_id) {
    const m = mediaById.get(programme.pdf_media_id)
    if (!m) throw new ProgrammeBuildError('pdf_missing', 'buildProgrammeSnapshot: the attached PDF is missing')
    if (m.rights === 'internal_only') {
      throw new ProgrammeBuildError('pdf_internal_only', 'buildProgrammeSnapshot: refusing to project an internal_only PDF')
    }
    pdf = { ref: ensureMediaRef(programme.pdf_media_id) }
  }

  if (mediaPool.length > MAX_PROGRAMME_MEDIA) {
    throw new ProgrammeBuildError('too_many_media', 'buildProgrammeSnapshot: refusing to project more than the media cap')
  }

  const snapshot: StoredProgrammeSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    kind: 'programme',
    displayTitle: sanitizeText(programme.name, 300) ?? 'Untitled programme',
    focus: sanitizeText(programme.focus, 300),
    summary: sanitizeText(programme.summary),
    intentions: sanitizeTextArray(programme.intentions),
    weeks: numOrNull(programme.weeks),
    orderedWeekNumbers,
    weekTemplates,
    referencedDrills,
    pdf,
    sourceAttribution: attributionOf(programme.source_url, programme.source_label),
    media: mediaPool,
    snapshotAt,
    builder: PROGRAMME_BUILDER,
    public: true,
  }

  assertAllowlistedKeys(snapshot)

  // The RPC enforces this too and is the authority; checking here turns a bare
  // database exception into a stated reason the coach can act on.
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_SNAPSHOT_BYTES) {
    throw new ProgrammeBuildError('snapshot_too_large', 'buildProgrammeSnapshot: refusing to project a snapshot over the size cap')
  }

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

// Programme snapshot allow lists (Content Sharing PR 4). The week entry's number
// field is `week`; programmeWeek and programme_week are forbidden everywhere.
const PROGRAMME_TOP_ALLOWED = new Set<string>([
  'snapshotVersion', 'kind', 'displayTitle', 'focus', 'summary', 'intentions',
  'weeks', 'orderedWeekNumbers', 'weekTemplates', 'referencedDrills', 'pdf',
  'media', 'sourceAttribution', 'snapshotAt', 'builder', 'public',
])
const WEEK_ALLOWED = new Set<string>(['week', 'title', 'focus', 'activities', 'totalDuration'])
const PDF_ALLOWED = new Set<string>(['ref'])

// Keys that must never appear anywhere in a snapshot, at any level. A belt and
// braces denylist beneath the positive allow list, naming the real columns and
// their camelCase forms that a naive projection could leak.
const FORBIDDEN_ANYWHERE = [
  'club_id', 'clubId', 'created_by', 'createdBy', 'created_at', 'createdAt',
  'media_id', 'mediaId', 'source_key', 'sourceKey', 'source_programme_id',
  'storage_path', 'storagePath', 'embed_url', 'embedUrl', 'token_hash', 'tokenHash',
  'secret', 'coach_id', 'coachId', 'drill_id', 'drillId', 'session_id', 'programme_id',
  'idempotency_key', 'revoked_by', 'updated_by', 'rights_class_observed', 'player_id',
  'playerId', 'author', 'pdf_media_id', 'pdfMediaId', 'sessionId', 'programmeId',
  // Session operational columns (PR 3). The positive allow list already prevents
  // these; naming them here is belt and braces so a future field rename that
  // reintroduced a real column would trip the scanner rather than leak.
  'team_id', 'teamId', 'venue', 'start_time', 'startTime', 'date',
  'spond_event_id', 'spondEventId', 'board_id', 'boardId', 'programme_week',
  'programmeWeek', 'live_activity_index', 'liveActivityIndex',
  'live_activity_started_at', 'liveActivityStartedAt',
  // Training day columns (0044). A session's venue, the teams it covers and
  // above all its register are club operational data about children and
  // where they are on a given evening. None of it is projected; naming it
  // here means a future field rename trips the scanner rather than leaks.
  'venue_id', 'venueId', 'teamIds', 'session_teams', 'sessionTeams',
  'bib_colour', 'bibColour', 'bib_colour_override', 'bibColourOverride',
  'register_entries', 'registerEntries', 'present',
  'included_in_groups', 'includedInGroups',
  'marked_by', 'markedBy', 'marked_at', 'markedAt',
  // Spond member links and per child RSVP (0045). An opaque member id
  // resolves to a named child through the roster, and RSVP says which
  // children replied to which session. None of it is projected; naming it
  // here means a future field rename trips the scanner rather than leaks.
  'spond_member_id', 'spondMemberId', 'player_spond_links', 'playerSpondLinks',
  'spond_event_responses', 'spondEventResponses', 'matched_by', 'matchedBy',
  'rsvp', 'rsvpStatus',
  // The drill diagram (0046). Drill Maker C1 does not publish a diagram: the
  // positive allow list in projectDrillFields never copies it, so nothing
  // reaches a snapshot today. Naming it here is the tripwire, and it matters
  // more than most because a share is a FROZEN COPY: once a key lands in
  // content_shares.snapshot the read path serves it until the link is revoked,
  // and no later fix to the projection can take it back. A diagram also carries
  // free text a coach typed, so publishing one is a decision to review, not a
  // side effect of adding a column.
  'diagram',
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
  if (s.kind === 'programme') {
    assertAllowlistedProgrammeKeys(s)
    return
  }
  // Explicit, exhaustive dispatch. A snapshot of any other kind is refused here
  // rather than falling through to the drill allow list, so a future fourth kind
  // fails loudly at its first build instead of being silently validated against
  // the wrong allow list.
  if (s.kind !== 'drill') {
    throw new Error(`snapshot allow list: unsupported kind "${String(s.kind)}"`)
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

// Validate a STORED programme snapshot's known structure at every level: the top
// level, each week, each week's activities, each referenced drill (and its
// classification and attribution), the pdf pointer and the flat media pool.
function assertAllowlistedProgrammeKeys(s: Record<string, unknown>): void {
  assertKeysWithin(s, PROGRAMME_TOP_ALLOWED, 'programme top level')
  if (s.sourceAttribution && typeof s.sourceAttribution === 'object') {
    assertKeysWithin(s.sourceAttribution as Record<string, unknown>, ATTRIBUTION_ALLOWED, 'programme sourceAttribution')
  }
  if (Array.isArray(s.weekTemplates)) {
    for (const w of s.weekTemplates as unknown[]) {
      if (!w || typeof w !== 'object') throw new Error('snapshot allow list: week not an object')
      const wk = w as Record<string, unknown>
      assertKeysWithin(wk, WEEK_ALLOWED, 'programme week')
      if (Array.isArray(wk.activities)) {
        for (const a of wk.activities as unknown[]) {
          if (!a || typeof a !== 'object') throw new Error('snapshot allow list: activity not an object')
          assertKeysWithin(a as Record<string, unknown>, ACTIVITY_ALLOWED, 'programme week activity')
        }
      }
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
  if (s.pdf && typeof s.pdf === 'object' && !Array.isArray(s.pdf)) {
    assertKeysWithin(s.pdf as Record<string, unknown>, PDF_ALLOWED, 'programme pdf')
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

// Strip the private media fields and the internal markers from a stored
// programme snapshot, producing the public projection. Mirrors read_public_share
// exactly, so the owner preview and the live public read agree.
export function toPublicProgrammeProjection(stored: StoredProgrammeSnapshot): PublicProgrammeSnapshot {
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

// Validate that a value is a well formed PUBLIC programme snapshot: known keys
// only at every level, no private media fields, no forbidden key anywhere, the
// pinned version and kind, and every activity drillRef resolving to a referenced
// drill. Used by the read function before responding and by the public page
// before rendering, so an unknown or tampered shape renders the neutral
// unavailable state rather than anything else.
export function validatePublicProgrammeSnapshot(value: unknown): value is PublicProgrammeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  if (s.kind !== 'programme') return false
  if (s.snapshotVersion !== SNAPSHOT_VERSION) return false
  if (s.public !== undefined || s.builder !== undefined) return false
  try {
    const publicTop = new Set([...PROGRAMME_TOP_ALLOWED].filter((k) => k !== 'builder' && k !== 'public'))
    assertKeysWithin(s, publicTop, 'public programme top level')
    if (!Array.isArray(s.media)) return false
    const mediaRefs = new Set<string>()
    for (const m of s.media as unknown[]) {
      if (!m || typeof m !== 'object') return false
      assertKeysWithin(m as Record<string, unknown>, MEDIA_PUBLIC_ALLOWED, 'public media entry')
      const ref = (m as Record<string, unknown>).ref
      if (typeof ref === 'string') mediaRefs.add(ref)
    }
    if (!Array.isArray(s.referencedDrills)) return false
    const drillRefs = new Set<string>()
    for (const d of s.referencedDrills as unknown[]) {
      if (!d || typeof d !== 'object') return false
      assertKeysWithin(d as Record<string, unknown>, REF_DRILL_ALLOWED, 'public referenced drill')
      const dr = d as Record<string, unknown>
      if (typeof dr.ref === 'string') drillRefs.add(dr.ref)
      // Every media ref a drill points at must exist in the pool.
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
      if (!w || typeof w !== 'object') return false
      const wk = w as Record<string, unknown>
      assertKeysWithin(wk, WEEK_ALLOWED, 'public programme week')
      if (typeof wk.week !== 'number' || !Number.isInteger(wk.week)) return false
      if (!Array.isArray(wk.activities)) return false
      for (const a of wk.activities as unknown[]) {
        if (!a || typeof a !== 'object') return false
        assertKeysWithin(a as Record<string, unknown>, ACTIVITY_ALLOWED, 'public programme week activity')
        // Every activity drill reference must resolve to a referenced drill;
        // a dangling ref means a tampered or partial payload.
        const dref = (a as Record<string, unknown>).drillRef
        if (dref !== null && (typeof dref !== 'string' || !drillRefs.has(dref))) return false
      }
    }
    if (s.pdf !== null) {
      if (!s.pdf || typeof s.pdf !== 'object' || Array.isArray(s.pdf)) return false
      const p = s.pdf as Record<string, unknown>
      assertKeysWithin(p, PDF_ALLOWED, 'public programme pdf')
      // The pdf pointer must resolve into the same flat media pool.
      if (typeof p.ref !== 'string' || !mediaRefs.has(p.ref)) return false
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


// -------------------------------------------------------------------------
// Club-wide shared links management (Content Sharing PR 5)
// -------------------------------------------------------------------------
//
// The management screen needs three decisions that are pure functions of a row
// and a request, so they live here where Deno can test them, leaving the Edge
// Function handler a thin translation into PostgREST calls. Nothing here reads
// a secret, a token hash or a storage path.

export type ManagedShareStatus = 'active' | 'expired' | 'revoked'

/**
 * The lifecycle status of a share, from its columns alone.
 *
 * Revoked wins over expired: a revoked share had its snapshot cleared and its
 * dependency rows deleted, so it can never come back whatever its expiry says.
 * A row with no expiry is active until revoked. `nowIso` is passed in, and the
 * caller computes it ONCE per request, so a list's filter and its labels cannot
 * disagree with each other across a slow page.
 *
 * The label is advisory. read_public_share compares expires_at against Postgres
 * now() and remains the only authority on whether a link actually serves.
 */
export function deriveShareStatus(
  row: { revoked_at?: string | null; expires_at?: string | null },
  nowIso: string,
): ManagedShareStatus {
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(nowIso)) return 'expired'
  return 'active'
}

/**
 * The public projection for a stored snapshot of any supported kind. Throws on
 * an unknown kind rather than guessing: there is deliberately no generic
 * renderer, and a kind added later must widen this explicitly.
 */
export function toPublicProjectionByKind(kind: string, stored: unknown): unknown {
  switch (kind) {
    case 'drill':
      return toPublicProjection(stored as StoredDrillSnapshot)
    case 'session':
      return toPublicSessionProjection(stored as StoredSessionSnapshot)
    case 'programme':
      return toPublicProgrammeProjection(stored as StoredProgrammeSnapshot)
    default:
      throw new Error(`toPublicProjectionByKind: unsupported kind ${kind}`)
  }
}

/**
 * The matching validator. Returns false for an unknown kind rather than
 * throwing, so a management preview fails closed to "no preview" instead of
 * failing the whole request.
 */
export function validatePublicSnapshotByKind(kind: string, value: unknown): boolean {
  switch (kind) {
    case 'drill':
      return validatePublicDrillSnapshot(value)
    case 'session':
      return validatePublicSessionSnapshot(value)
    case 'programme':
      return validatePublicProgrammeSnapshot(value)
    default:
      return false
  }
}

export const SHARE_LIST_MAX_LIMIT = 100
export const SHARE_LIST_DEFAULT_LIMIT = 50

export type ShareStatusFilter = ManagedShareStatus | 'all'
const STATUS_FILTERS: ShareStatusFilter[] = ['active', 'expired', 'revoked', 'all']

export interface ShareListFilter {
  status: ShareStatusFilter
  kind: 'drill' | 'session' | 'programme' | null
  shareId: string | null
  createdBy: string | null
  unattributed: boolean
  limit: number
  cursor: string | null
}

const LIST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS_FOR_LIST = ['drill', 'session', 'programme']

/**
 * Validates a management list request into an allow listed filter, or names the
 * refusal. Every field is closed: an unknown status, an unknown kind, a
 * malformed id, an out of range limit and an unparseable cursor are all
 * refused rather than ignored, so a caller cannot widen a query by sending a
 * field this function does not understand. The club is NOT part of this: it is
 * derived from the verified JWT server side and can never be supplied.
 */
export function buildShareListFilter(
  input: Record<string, unknown>,
): { filter: ShareListFilter } | { error: string } {
  const status = input.status === undefined || input.status === null ? 'all' : input.status
  if (typeof status !== 'string' || !STATUS_FILTERS.includes(status as ShareStatusFilter)) {
    return { error: 'Unknown status filter.' }
  }

  let kind: ShareListFilter['kind'] = null
  if (input.kind !== undefined && input.kind !== null) {
    if (typeof input.kind !== 'string' || !KINDS_FOR_LIST.includes(input.kind)) {
      return { error: 'Unknown share kind.' }
    }
    kind = input.kind as ShareListFilter['kind']
  }

  let shareId: string | null = null
  if (input.shareId !== undefined && input.shareId !== null) {
    if (typeof input.shareId !== 'string' || !LIST_UUID_RE.test(input.shareId)) {
      return { error: 'Invalid share id.' }
    }
    shareId = input.shareId
  }

  const unattributed = input.unattributed === true
  let createdBy: string | null = null
  if (input.createdBy !== undefined && input.createdBy !== null) {
    if (typeof input.createdBy !== 'string' || !LIST_UUID_RE.test(input.createdBy)) {
      return { error: 'Invalid member id.' }
    }
    createdBy = input.createdBy
  }
  if (createdBy !== null && unattributed) {
    return { error: 'Choose a member or unattributed links, not both.' }
  }

  let limit = SHARE_LIST_DEFAULT_LIMIT
  if (input.limit !== undefined && input.limit !== null) {
    if (
      typeof input.limit !== 'number' ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > SHARE_LIST_MAX_LIMIT
    ) {
      return { error: 'Invalid limit.' }
    }
    limit = input.limit
  }

  let cursor: string | null = null
  if (input.cursor !== undefined && input.cursor !== null) {
    if (typeof input.cursor !== 'string' || Number.isNaN(Date.parse(input.cursor))) {
      return { error: 'Invalid cursor.' }
    }
    cursor = input.cursor
  }

  return {
    filter: { status: status as ShareStatusFilter, kind, shareId, createdBy, unattributed, limit, cursor },
  }
}

