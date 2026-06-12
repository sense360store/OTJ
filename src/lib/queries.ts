// The single data layer. Every screen reads its server data through the hooks
// here, and the session writes go through the mutation here. src/lib/supabase.ts
// stays the only client.
//
// The screens speak the camelCase types defined in data.ts (Drill, Media,
// Template, Session, Activity). The database speaks snake_case. The row types
// and the mappers below are the seam between the two, so the screens and their
// props do not change.
//
// RLS scopes every read to the signed-in coach's club automatically. There is
// deliberately no client-side club filter, so a scoping regression cannot be
// masked by belt-and-braces filtering.
//
// Content mutations invalidate their queries on settled, not only on success,
// so a write that fails part way (a multi-step save that stopped midway, a
// delete the server refused) still refreshes the affected lists rather than
// leaving a stale view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../hooks/useAuth'
import type {
  Activity,
  Capability,
  Club,
  CornerKey,
  Drill,
  FeedbackItem,
  FeedbackKind,
  FeedbackStatus,
  Level,
  MediaItem,
  MediaType,
  Member,
  Phase,
  Programme,
  Role,
  RoleCapability,
  RoleInfo,
  Session,
  SessionStatus,
  SpondEvent,
  SpondMapping,
  Team,
  Template,
} from './data'
import { nextPrimaryTeamId, primaryRoleKey, sortRoles, youtubeId } from './data'
import { sourceLabelForUrl } from './fa'
import { formatBytes } from './faAttach'
import type { AttachPlan } from './faAttach'

// ---- Database row shapes (snake_case) ----------------------------------
// Separate from the component-facing camelCase types. Nullable columns are
// reflected here; the mappers coerce them to the non-null component contract.

export interface DrillRow {
  id: string
  club_id: string
  title: string
  summary: string | null
  corner: CornerKey | null
  skill: string | null
  level: Level | null
  ages: string[] | null
  duration: number | null
  players: string | null
  area: string | null
  equipment: string[] | null
  points: string[] | null
  tags: string[] | null
  media_id: string | null
  created_by: string | null
  created_at: string
  setup_notes: string | null
  easier: string[] | null
  harder: string[] | null
  theme: string | null
  format: string | null
  source_url: string | null
  source_label: string | null
}

interface MediaRow {
  id: string
  club_id: string
  name: string
  type: MediaType
  kind: string | null
  storage_path: string | null
  embed_url: string | null
  yt_url: string | null
  size: string | null
  dims: string | null
  length: string | null
  pages: number | null
  created_by: string | null
  created_at: string
  source_url: string | null
  source_label: string | null
}

// The activities jsonb element. drill_id on the wire maps to drillId in the UI.
export interface ActivityRow {
  phase: Phase
  duration: number
  drill_id?: string | null
  title?: string | null
}

interface TemplateRow {
  id: string
  club_id: string
  name: string
  focus: string | null
  author: string | null
  activities: ActivityRow[] | null
  created_by: string | null
  created_at: string
  intentions: string[] | null
  programme: string | null
  week: number | null
  programme_id: string | null
  programme_week: number | null
  source_url: string | null
  source_label: string | null
}

interface ProgrammeRow {
  id: string
  club_id: string
  name: string
  focus: string | null
  summary: string | null
  intentions: string[] | null
  weeks: number
  pdf_media_id: string | null
  source_url: string | null
  source_label: string | null
  created_by: string | null
  created_at: string
}

export interface SessionRow {
  id: string
  club_id: string
  // Null once the owning coach was removed; the session stays club owned.
  coach_id: string | null
  team_id: string | null
  name: string
  focus: string | null
  date: string | null
  start_time: string | null
  venue: string | null
  age_group: string | null
  status: SessionStatus
  activities: ActivityRow[] | null
  created_at: string
  intentions: string[] | null
  space: string | null
  source_url: string | null
  source_label: string | null
  programme_id: string | null
  programme_week: number | null
  live_activity_index: number | null
  live_activity_started_at: string | null
  spond_event_id: string | null
}

interface TeamRow {
  id: string
  club_id: string
  name: string
  created_at: string
}

interface RoleRow {
  id: string
  club_id: string
  key: string
  label: string
  system: boolean
}

// The roles fields the profiles read embeds through member_roles. PostgREST
// returns the to-one side as an object, null if the join found nothing.
interface MemberRoleJoinRow {
  roles: { id: string; key: string; label: string; system: boolean } | null
}

interface ProfileRow {
  id: string
  full_name: string | null
  avatar: string | null
  avatar_url: string | null
  role: Role
  team_id: string | null
  all_teams: boolean
  created_at: string
  member_roles: MemberRoleJoinRow[]
  member_teams: { team_id: string }[]
}

interface ClubRow {
  id: string
  name: string
  motto: string | null
  crest_url: string | null
}

// ---- Column lists ------------------------------------------------------
// Explicit so each read is checkable against the schema at a glance.
const DRILL_COLS =
  'id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, media_id, created_by, created_at, setup_notes, easier, harder, theme, format, source_url, source_label'
const MEDIA_COLS =
  'id, club_id, name, type, kind, storage_path, embed_url, yt_url, size, dims, length, pages, created_by, created_at, source_url, source_label'
const TEMPLATE_COLS =
  'id, club_id, name, focus, author, activities, created_by, created_at, intentions, programme, week, programme_id, programme_week, source_url, source_label'
const PROGRAMME_COLS =
  'id, club_id, name, focus, summary, intentions, weeks, pdf_media_id, source_url, source_label, created_by, created_at'
const SESSION_COLS =
  'id, club_id, coach_id, team_id, name, focus, date, start_time, venue, age_group, status, activities, created_at, intentions, space, source_url, source_label, programme_id, programme_week, live_activity_index, live_activity_started_at, spond_event_id'
const TEAM_COLS = 'id, club_id, name, created_at'
// The role and team assignment sets ride the profiles read as embeds, so the
// Users screen and the owner labels share one query.
const PROFILE_COLS =
  'id, full_name, avatar, avatar_url, role, team_id, all_teams, created_at, member_roles(roles(id, key, label, system)), member_teams(team_id)'
const ROLE_COLS = 'id, club_id, key, label, system'
const CLUB_COLS = 'id, name, motto, crest_url'

// ---- Mappers -----------------------------------------------------------

export function toActivity(a: ActivityRow): Activity {
  const out: Activity = { phase: a.phase, duration: a.duration }
  if (a.drill_id != null) out.drillId = a.drill_id
  if (a.title != null) out.title = a.title
  return out
}

export function toActivityRow(a: Activity): ActivityRow {
  const out: ActivityRow = { phase: a.phase, duration: a.duration }
  if (a.drillId != null) out.drill_id = a.drillId
  if (a.title != null) out.title = a.title
  return out
}

export function toDrill(r: DrillRow): Drill {
  return {
    id: r.id,
    title: r.title,
    // A null corner stays null: an unclassified drill (an FA import) must
    // not present as Technical anywhere.
    corner: r.corner,
    skill: r.skill ?? '',
    ages: r.ages ?? [],
    level: r.level ?? 'Foundation',
    duration: r.duration ?? 0,
    players: r.players ?? '',
    area: r.area ?? '',
    equipment: r.equipment ?? [],
    mediaId: r.media_id,
    summary: r.summary ?? '',
    points: r.points ?? [],
    tags: r.tags ?? [],
    createdBy: r.created_by ?? undefined,
    setupNotes: r.setup_notes ?? '',
    easier: r.easier ?? [],
    harder: r.harder ?? [],
    theme: r.theme ?? '',
    format: r.format ?? '',
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    createdAt: r.created_at,
  }
}

function toMedia(r: MediaRow): MediaItem {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    kind: r.kind ?? undefined,
    size: r.size ?? undefined,
    dims: r.dims ?? undefined,
    length: r.length ?? undefined,
    pages: r.pages ?? undefined,
    yt: r.yt_url ?? undefined,
    storagePath: r.storage_path ?? undefined,
    embedUrl: r.embed_url ?? undefined,
    createdBy: r.created_by ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    sourceLabel: r.source_label ?? undefined,
  }
}

function toTemplate(r: TemplateRow): Template {
  return {
    id: r.id,
    name: r.name,
    author: r.author ?? '',
    focus: r.focus ?? '',
    createdBy: r.created_by ?? undefined,
    activities: (r.activities ?? []).map(toActivity),
    intentions: r.intentions ?? [],
    programme: r.programme ?? '',
    week: r.week,
    programmeId: r.programme_id,
    programmeWeek: r.programme_week,
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    createdAt: r.created_at,
  }
}

function toProgramme(r: ProgrammeRow): Programme {
  return {
    id: r.id,
    name: r.name,
    focus: r.focus ?? '',
    summary: r.summary ?? '',
    intentions: r.intentions ?? [],
    weeks: r.weeks,
    pdfMediaId: r.pdf_media_id,
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    createdBy: r.created_by ?? undefined,
  }
}

export function toSession(r: SessionRow): Session {
  return {
    id: r.id,
    name: r.name,
    date: r.date ?? '',
    time: r.start_time ?? '',
    ageGroup: r.age_group ?? '',
    venue: r.venue ?? '',
    focus: r.focus ?? '',
    status: r.status,
    activities: (r.activities ?? []).map(toActivity),
    // '' when the owning coach was removed: it matches no user id, so the
    // ownership affordances treat the session as someone else's (club owned).
    coachId: r.coach_id ?? '',
    teamId: r.team_id,
    intentions: r.intentions ?? [],
    space: r.space ?? '',
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    programmeId: r.programme_id,
    programmeWeek: r.programme_week,
    liveActivityIndex: r.live_activity_index ?? null,
    liveActivityStartedAt: r.live_activity_started_at ?? null,
    spondEventId: r.spond_event_id ?? null,
  }
}

function toTeam(r: TeamRow): Team {
  return { id: r.id, name: r.name }
}

function toRole(r: RoleRow): RoleInfo {
  return { id: r.id, key: r.key, label: r.label, system: r.system }
}

function toMember(r: ProfileRow): Member {
  return {
    id: r.id,
    fullName: r.full_name ?? '',
    avatar: r.avatar,
    avatarUrl: r.avatar_url,
    role: r.role,
    teamId: r.team_id,
    joined: r.created_at,
    roles: sortRoles((r.member_roles ?? []).flatMap((mr) => (mr.roles ? [mr.roles] : []))),
    teamIds: (r.member_teams ?? []).map((mt) => mt.team_id),
    allTeams: r.all_teams,
  }
}

function toClub(r: ClubRow): Club {
  return { id: r.id, name: r.name, motto: r.motto ?? '', crestUrl: r.crest_url }
}

// ---- Reads -------------------------------------------------------------

export function useDrills() {
  return useQuery({
    queryKey: ['drills'],
    queryFn: async (): Promise<Drill[]> => {
      const { data, error } = await supabase
        .from('drills')
        .select(DRILL_COLS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as DrillRow[]).map(toDrill)
    },
  })
}

export function useDrill(id: string | undefined) {
  return useQuery({
    queryKey: ['drills', id],
    enabled: !!id,
    queryFn: async (): Promise<Drill | null> => {
      const { data, error } = await supabase.from('drills').select(DRILL_COLS).eq('id', id!).maybeSingle()
      if (error) throw error
      return data ? toDrill(data as unknown as DrillRow) : null
    },
  })
}

export function useMedia() {
  return useQuery({
    queryKey: ['media'],
    queryFn: async (): Promise<MediaItem[]> => {
      const { data, error } = await supabase
        .from('media')
        .select(MEDIA_COLS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as MediaRow[]).map(toMedia)
    },
  })
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await supabase
        .from('templates')
        .select(TEMPLATE_COLS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as TemplateRow[]).map(toTemplate)
    },
  })
}

// The club's programmes. RLS scopes the read to the caller's club; ordering
// matches the other content lists.
export function useProgrammes() {
  return useQuery({
    queryKey: ['programmes'],
    queryFn: async (): Promise<Programme[]> => {
      const { data, error } = await supabase
        .from('programmes')
        .select(PROGRAMME_COLS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as ProgrammeRow[]).map(toProgramme)
    },
  })
}

export function useProgramme(id: string | undefined) {
  return useQuery({
    queryKey: ['programmes', id],
    enabled: !!id,
    queryFn: async (): Promise<Programme | null> => {
      const { data, error } = await supabase.from('programmes').select(PROGRAMME_COLS).eq('id', id!).maybeSingle()
      if (error) throw error
      return data ? toProgramme(data as unknown as ProgrammeRow) : null
    },
  })
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async (): Promise<Session[]> => {
      const { data, error } = await supabase
        .from('sessions')
        .select(SESSION_COLS)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as SessionRow[]).map(toSession)
    },
  })
}

export function useSession(id: string | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['sessions', id],
    enabled: !!id,
    queryFn: async (): Promise<Session | null> => {
      const { data, error } = await supabase.from('sessions').select(SESSION_COLS).eq('id', id!).maybeSingle()
      if (error) throw error
      if (data) return toSession(data as unknown as SessionRow)
      // The row may belong to a just-created session whose insert has not
      // committed yet. Fall back to the optimistic entry in the sessions list
      // so opening it (starting a session straight after saving) does not flash
      // "not found". The next invalidation refetch returns the committed row.
      return qc.getQueryData<Session[]>(['sessions'])?.find((s) => s.id === id) ?? null
    },
  })
}

// The club's teams. RLS lets every club member read them; only admins write.
export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase.from('teams').select(TEAM_COLS).order('name', { ascending: true })
      if (error) throw error
      return (data as unknown as TeamRow[]).map(toTeam)
    },
  })
}

// The club's roles, system and custom, in privilege order. Every club member
// may read them (the role badges); only users.manage writes them.
export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    retry: false,
    queryFn: async (): Promise<RoleInfo[]> => {
      const { data, error } = await supabase.from('roles').select(ROLE_COLS).order('created_at', { ascending: true })
      if (error) throw error
      return sortRoles((data as unknown as RoleRow[]).map(toRole))
    },
  })
}

// Club members. The existing profiles RLS already lets club members read club
// profiles; the Users screen and the session owner labels read through this.
export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLS)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data as unknown as ProfileRow[]).map(toMember)
    },
  })
}

// The signed-in member's club row. RLS returns only their own club, so the
// read takes the first row rather than naming an id. Disabled until the
// session exists; the login screen reads the cached branding instead.
export function useClub() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['club'],
    enabled: !!user,
    queryFn: async (): Promise<Club | null> => {
      const { data, error } = await supabase.from('clubs').select(CLUB_COLS).limit(1)
      if (error) throw error
      const row = (data as ClubRow[])[0]
      return row ? toClub(row) : null
    },
  })
}

// Lookup maps built from the cached list reads. The planner, templates, live
// view and drill cards resolve a drill or a media item by id through these,
// the same shape the prototype's drillById and mediaById maps provided.
export function useDrillMap(): Record<string, Drill> {
  const { data } = useDrills()
  return useMemo(() => Object.fromEntries((data ?? []).map((d) => [d.id, d])), [data])
}

export function useMediaMap(): Record<string, MediaItem> {
  const { data } = useMedia()
  return useMemo(() => Object.fromEntries((data ?? []).map((m) => [m.id, m])), [data])
}

export function useTeamMap(): Record<string, Team> {
  const { data } = useTeams()
  return useMemo(() => Object.fromEntries((data ?? []).map((t) => [t.id, t])), [data])
}

export function useProgrammeMap(): Record<string, Programme> {
  const { data } = useProgrammes()
  return useMemo(() => Object.fromEntries((data ?? []).map((p) => [p.id, p])), [data])
}

export function useMemberMap(): Record<string, Member> {
  const { data } = useProfiles()
  return useMemo(() => Object.fromEntries((data ?? []).map((m) => [m.id, m])), [data])
}

// Resolves an activity's display title. A drillId that no longer matches a
// drill (deleted after the session or template was built) gets a quiet
// placeholder, but only once the drills read has settled so a half-loaded
// screen does not flash it.
export function useActivityTitle(): (act: Activity, fallback?: string) => string {
  const byId = useDrillMap()
  const { isPending } = useDrills()
  return (act, fallback = 'Custom activity') => {
    if (act.drillId) {
      const drill = byId[act.drillId]
      if (drill) return drill.title
      return isPending ? '…' : 'Removed drill'
    }
    return act.title || fallback
  }
}

// ---- Media storage: signed URLs ----------------------------------------
// The media bucket is private, so every preview, open or download link is a
// short-lived signed URL. Creation is centralised here and keyed by
// storage_path, so a path used by both a media card and a drill that links it
// mints one URL, shared from the cache. The URL lasts an hour; staleTime sits
// comfortably below that so a cached URL never expires mid-use, and a window
// focus refetches any stale URL, so a tab reopened the next day heals itself
// before anything tries to render.
const SIGNED_URL_TTL = 60 * 60 // one hour, in seconds
const SIGNED_URL_STALE = 50 * 60 * 1000 // 50 minutes, in milliseconds

export function useSignedMediaUrl(storagePath: string | null | undefined) {
  return useQuery({
    queryKey: ['media-url', storagePath],
    enabled: !!storagePath,
    staleTime: SIGNED_URL_STALE,
    gcTime: SIGNED_URL_TTL * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage.from('media').createSignedUrl(storagePath!, SIGNED_URL_TTL)
      if (error) throw error
      return data?.signedUrl ?? null
    },
  })
}

// A signed URL wired for recovery at the point of use. An expired URL makes
// the <img> or <video> fail with a 400 or 403 the element cannot report, so
// on the first load error for a path the URL's query is invalidated and the
// element gets one fresh URL to retry with; if that fails too, src goes null
// and the caller shows its fallback. A successful load re-arms the retry, and
// any newly minted URL (a focus refetch, say) is worth one attempt. Used by
// every render path: thumbnails, the drill detail, the player overlay and
// the diagram viewer.
export function useMediaSrc(storagePath: string | null | undefined) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useSignedMediaUrl(storagePath)
  // One retry per path between successful loads, tracked in a ref only the
  // event handlers touch. URLs that failed even after the retry land in
  // state, which render reads to swap in the fallback; a newly minted URL is
  // never in that set, so it always gets one attempt.
  const retriedPaths = useRef(new Set<string>())
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set())

  const onError = useCallback(() => {
    if (!storagePath) return
    if (!retriedPaths.current.has(storagePath)) {
      retriedPaths.current.add(storagePath)
      void qc.invalidateQueries({ queryKey: ['media-url', storagePath] })
      return
    }
    if (data) setFailedUrls((prev) => (prev.has(data) ? prev : new Set(prev).add(data)))
  }, [qc, storagePath, data])

  const onLoad = useCallback(() => {
    if (storagePath) retriedPaths.current.delete(storagePath)
  }, [storagePath])

  const src = data && !failedUrls.has(data) ? data : null
  const broken = isError || (!!data && failedUrls.has(data))
  return { src, isLoading, broken, onError, onLoad }
}

// ---- Media uploads -----------------------------------------------------
// Detection, client-side metadata and the upload mutation. The bucket and its
// policies already exist; this only puts objects in and registers rows.

export function detectMediaType(mime: string): MediaType | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  return null
}

// Some pickers (Android in particular) hand over files with an empty or
// generic MIME type, and an object stored with the wrong type will not
// render: an <img> refuses an SVG unless it is served as image/svg+xml.
// Uploads therefore always pass an explicit contentType, falling back to the
// extension when the browser offers nothing useful.
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
}

export function contentTypeForFile(file: File): string | null {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return (ext && EXTENSION_MIME[ext]) || null
}

export function mediaTypeForFile(file: File): MediaType | null {
  const mime = contentTypeForFile(file)
  return mime ? detectMediaType(mime) : null
}

// The per file upload ceiling, raised from 50 MB so self hosted FA session
// videos fit inline playback. config.toml and the hosted project's storage
// limits must carry the same value, or the server rejects what the client
// allows. Checked before any bytes move, so an oversized pick fails at once
// with a plain message instead of a storage error at the end of a long
// upload.
export const MEDIA_MAX_BYTES = 300 * 1024 * 1024

export function oversizeMessage(file: File): string | null {
  if (file.size <= MEDIA_MAX_BYTES) return null
  return `That file is ${formatBytes(file.size)} and the upload limit is ${formatBytes(MEDIA_MAX_BYTES)}. Compress the file or trim the clip and try again.`
}

// A storage key safe filename: keep word characters, dots and hyphens, collapse
// the rest. The {club_id}/{uuid}- prefix guarantees uniqueness regardless.
function sanitiseFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
  return cleaned || 'file'
}

function readImageDims(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // An SVG without fixed dimensions reports zero; record nothing.
      if (!img.naturalWidth || !img.naturalHeight) return resolve(undefined)
      resolve(`${img.naturalWidth} × ${img.naturalHeight}`)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(undefined)
    }
    img.src = url
  })
}

function readVideoLength(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const total = Math.round(video.duration)
      if (!isFinite(total) || total <= 0) return resolve(undefined)
      const m = Math.floor(total / 60)
      const s = total % 60
      resolve(`${m}:${String(s).padStart(2, '0')}`)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(undefined)
    }
    video.src = url
  })
}

export type UploadInput = { mode: 'file'; file: File; name: string } | { mode: 'youtube'; ytUrl: string; name: string }

// Creates a library media row from a file upload or a YouTube link. The
// mutation resolves to the new row's id so a caller can link it at once; the
// drill form's inline creator sets it as the drill's media.
export function useUploadMedia() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation<string, Error, UploadInput>({
    mutationFn: async (input) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to upload media.')
      }
      const clubId = profile.club_id

      // YouTube: no file, just a row with the link.
      if (input.mode === 'youtube') {
        if (!youtubeId(input.ytUrl)) {
          throw new Error('Enter a valid YouTube link.')
        }
        const { data, error } = await supabase
          .from('media')
          .insert({
            club_id: clubId,
            created_by: user.id,
            name: input.name,
            type: 'youtube',
            yt_url: input.ytUrl,
          })
          .select('id')
          .single()
        if (error) throw new Error(`Could not save the link: ${error.message}`)
        return (data as { id: string }).id
      }

      // File: detect, guard the size, upload to Storage, then register the
      // row. Every failure surfaces the underlying error text verbatim; the
      // upload modal shows it and stays open.
      const file = input.file
      const contentType = contentTypeForFile(file)
      const type = contentType ? detectMediaType(contentType) : null
      if (!contentType || !type) {
        throw new Error('Unsupported file type. Upload an image, video or PDF.')
      }
      const tooBig = oversizeMessage(file)
      if (tooBig) throw new Error(tooBig)
      const path = `${clubId}/${crypto.randomUUID()}-${sanitiseFilename(file.name)}`
      const { error: uploadError } = await supabase.storage.from('media').upload(path, file, { contentType })
      if (uploadError) throw new Error(`The upload failed: ${uploadError.message}`)

      const size = formatBytes(file.size)
      const dims = type === 'image' ? await readImageDims(file) : undefined
      const length = type === 'video' ? await readVideoLength(file) : undefined

      const { data: inserted, error: insertError } = await supabase
        .from('media')
        .insert({
          club_id: clubId,
          created_by: user.id,
          name: input.name,
          type,
          storage_path: path,
          size,
          dims: dims ?? null,
          length: length ?? null,
        })
        .select('id')
        .single()
      // If the row insert fails after the object uploaded, remove the object so
      // no orphan is left behind in Storage.
      if (insertError) {
        await supabase.storage.from('media').remove([path])
        throw new Error(`The file uploaded but could not be saved to the library: ${insertError.message}`)
      }
      return (inserted as { id: string }).id
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

// ---- Media replace -------------------------------------------------------
// Points an existing media row (a seeded sample, typically) at real content,
// keeping its id so every drill that links it keeps working. A file goes to a
// fresh storage object and the row swaps over to it; a YouTube link clears
// the file fields instead. Owner or admin only; the media update RLS is the
// real enforcement, and a write it blocks updates no rows, which is reported
// rather than swallowed.
export function useReplaceMedia() {
  const qc = useQueryClient()
  const { profile } = useAuth()

  return useMutation<void, Error, { id: string; previousPath?: string | null; input: UploadInput }>({
    mutationFn: async ({ id, previousPath, input }) => {
      if (!profile?.club_id) {
        throw new Error('You must be signed in to replace media.')
      }
      const clubId = profile.club_id

      const applyUpdate = async (patch: Record<string, unknown>) => {
        const { data, error } = await supabase.from('media').update(patch).eq('id', id).select('id')
        if (error) throw new Error(`Could not update the media record: ${error.message}`)
        if (!data?.length) throw new Error('You do not have permission to replace this item.')
      }

      if (input.mode === 'youtube') {
        if (!youtubeId(input.ytUrl)) {
          throw new Error('Enter a valid YouTube link.')
        }
        await applyUpdate({
          name: input.name,
          type: 'youtube',
          yt_url: input.ytUrl,
          storage_path: null,
          size: null,
          dims: null,
          length: null,
          pages: null,
        })
      } else {
        const file = input.file
        const contentType = contentTypeForFile(file)
        const type = contentType ? detectMediaType(contentType) : null
        if (!contentType || !type) {
          throw new Error('Unsupported file type. Upload an image, video or PDF.')
        }
        const tooBig = oversizeMessage(file)
        if (tooBig) throw new Error(tooBig)

        const path = `${clubId}/${crypto.randomUUID()}-${sanitiseFilename(file.name)}`
        const { error: uploadError } = await supabase.storage.from('media').upload(path, file, { contentType })
        if (uploadError) throw new Error(`The upload failed: ${uploadError.message}`)

        const size = formatBytes(file.size)
        const dims = type === 'image' ? await readImageDims(file) : undefined
        const length = type === 'video' ? await readVideoLength(file) : undefined

        try {
          await applyUpdate({
            name: input.name,
            type,
            storage_path: path,
            yt_url: null,
            size,
            dims: dims ?? null,
            length: length ?? null,
            pages: null,
          })
        } catch (e) {
          // The object uploaded but the row did not take it; remove the orphan.
          await supabase.storage.from('media').remove([path])
          throw e
        }
      }

      // Samples have no object behind them, but if the replaced row did,
      // clear it out so storage holds no unreachable file. Best effort.
      if (previousPath) {
        await supabase.storage.from('media').remove([previousPath])
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
    },
  })
}

// ---- FA video source files -------------------------------------------------
// The bulk attach behind the FA video source file pipeline. The FA supplies
// the licensed source MP4s for imported video sessions; the plan
// (src/lib/faAttach.ts) has already matched each file to its FA video media
// row by Vimeo id, or by session and part. Each file goes into the media
// bucket exactly like an uploaded clip, then storage_path is set on the
// matched row, the one write that flips playback from the FA link out to the
// inline player. embed_url, source_url and source_label are not touched, so
// provenance and attribution survive. Every write rides the existing paths:
// the authenticated storage insert policy and the media update RLS (owner
// with media.create, or media.manage), club scoped, so a coach can only
// attach within their own club and a refusal is reported per file, never
// swallowed. The update is conditional on storage_path still being null, so
// re running over the same set skips rather than duplicates even under
// concurrency. No Vimeo fetching of any kind happens here.

export interface AttachFAFilesOutcome {
  fileName: string
  status: 'stored' | 'skipped' | 'unmatched' | 'rejected' | 'failed'
  mediaName?: string
  detail: string
}

export function useAttachFAVideoFiles() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation<
    AttachFAFilesOutcome[],
    Error,
    { plan: AttachPlan<File>; onProgress?: (done: number, total: number) => void }
  >({
    mutationFn: async ({ plan, onProgress }) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to attach files.')
      }
      const clubId = profile.club_id
      const total = plan.storeCount
      let done = 0
      const outcomes: AttachFAFilesOutcome[] = []

      // Sequential on purpose: the files are large, and one upload at a time
      // keeps the progress readable and the failure modes simple.
      for (const entry of plan.entries) {
        if (entry.status !== 'store') {
          outcomes.push({
            fileName: entry.file.name,
            status: entry.status === 'skip' ? 'skipped' : entry.status,
            mediaName: entry.mediaName,
            detail: entry.reason,
          })
          continue
        }

        const file = entry.file
        const path = `${clubId}/${crypto.randomUUID()}-${sanitiseFilename(file.name)}`
        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(path, file, { contentType: contentTypeForFile(file) ?? 'video/mp4' })
        if (uploadError) {
          outcomes.push({
            fileName: file.name,
            status: 'failed',
            mediaName: entry.mediaName,
            detail: `The upload failed: ${uploadError.message}`,
          })
          onProgress?.(++done, total)
          continue
        }

        const length = await readVideoLength(file)
        // Conditional on the path still being empty: a row that gained a file
        // since the plan was made is left alone, and an RLS refusal also lands
        // here as zero rows rather than an exception.
        const { data, error } = await supabase
          .from('media')
          .update({ storage_path: path, size: formatBytes(file.size), length: length ?? null })
          .eq('id', entry.mediaId!)
          .is('storage_path', null)
          .select('id')
        if (error || !data?.length) {
          // The object uploaded but the row did not take it; remove the orphan.
          await supabase.storage.from('media').remove([path])
          if (error) {
            outcomes.push({
              fileName: file.name,
              status: 'failed',
              mediaName: entry.mediaName,
              detail: `Could not update the media record: ${error.message}`,
            })
          } else {
            // Zero rows without an error: read the row back to tell a file
            // attached meanwhile apart from a permission refusal, honestly.
            const { data: row } = await supabase
              .from('media')
              .select('storage_path')
              .eq('id', entry.mediaId!)
              .maybeSingle()
            if ((row as { storage_path: string | null } | null)?.storage_path) {
              outcomes.push({
                fileName: file.name,
                status: 'skipped',
                mediaName: entry.mediaName,
                detail: 'A file was attached to this video meanwhile.',
              })
            } else {
              outcomes.push({
                fileName: file.name,
                status: 'failed',
                mediaName: entry.mediaName,
                detail: 'You do not have permission to attach files to this video.',
              })
            }
          }
          onProgress?.(++done, total)
          continue
        }

        outcomes.push({ fileName: file.name, status: 'stored', mediaName: entry.mediaName, detail: entry.reason })
        onProgress?.(++done, total)
      }
      return outcomes
    },
    // Settled, not success: files store one by one, so rows changed before a
    // late failure must show in the library either way.
    onSettled: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

// ---- Media rename --------------------------------------------------------
// Renames a media item in place; every drill that links it keeps working.
// Owner or admin only; the media update RLS is the real enforcement, and a
// write it blocks updates no rows, which is reported rather than swallowed.
export function useRenameMedia() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const { data, error } = await supabase.from('media').update({ name }).eq('id', id).select('id')
      if (error) throw new Error(`Could not rename: ${error.message}`)
      if (!data?.length) throw new Error('You do not have permission to rename this item.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['media'] }),
  })
}

// ---- Remove the seeded samples -------------------------------------------
// Deletes every sample row (no stored file, no playable link) in one go.
// Surfaced to admins only; the media delete RLS (owner or admin) is the real
// enforcement. Samples have no storage objects, so this is a pure row delete;
// drills that referenced one fall back to no media through the on delete set
// null foreign key.
export function useRemoveSampleMedia() {
  const qc = useQueryClient()
  return useMutation<void, Error, { ids: string[] }>({
    mutationFn: async ({ ids }) => {
      if (ids.length === 0) return
      const { error } = await supabase.from('media').delete().in('id', ids)
      if (error) throw new Error(`Could not remove the samples: ${error.message}`)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
    },
  })
}

// ---- Media delete ------------------------------------------------------
// Owner or admin only; the media RLS delete policy is the real enforcement.
// The row goes first, so the RLS rules before the object is touched: a
// blocked delete (no error, zero rows) removes nothing and is reported. Once
// the row is gone the object is unreachable, so its removal is best effort.
// Drills that link the row fall back to no media through the on delete set
// null foreign key.
export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; storagePath?: string | null }>({
    mutationFn: async ({ id, storagePath }) => {
      const { data, error } = await supabase.from('media').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You do not have permission to delete this item.')
      if (storagePath) await supabase.storage.from('media').remove([storagePath])
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
    },
  })
}

// ---- Drill writes ------------------------------------------------------
// Create, edit and delete for the club drill library. Insert sets club_id and
// created_by: the RLS insert check requires the club, and created_by drives
// the owner or admin update and delete policies. Update sends neither, so a
// drill never changes club or owner. The drills RLS is the real enforcement;
// the screens only decide whether to surface the actions.

export interface DrillInput {
  title: string
  summary: string
  // Null leaves the drill unclassified rather than forcing a corner onto it.
  corner: CornerKey | null
  skill: string
  level: Level
  ages: string[]
  duration: number
  players: string
  area: string
  equipment: string[]
  points: string[]
  tags: string[]
  mediaId: string | null
  setupNotes: string
  easier: string[]
  harder: string[]
  theme: string
  format: string
  sourceUrl: string
}

// The attribution label always derives from the link at write time, so the
// two cannot drift apart. An empty or unparsable link stores null for both.
// Shared by every write that carries a source (drills here, sessions below).
function toSourceFields(rawUrl: string): { source_url: string | null; source_label: string | null } {
  const url = rawUrl.trim()
  return {
    source_url: url || null,
    source_label: url ? sourceLabelForUrl(url) || null : null,
  }
}

function toDrillWriteRow(input: DrillInput) {
  return {
    title: input.title,
    summary: input.summary || null,
    corner: input.corner,
    skill: input.skill || null,
    level: input.level,
    ages: input.ages,
    duration: input.duration || null,
    players: input.players || null,
    area: input.area || null,
    equipment: input.equipment,
    points: input.points,
    tags: input.tags,
    media_id: input.mediaId,
    setup_notes: input.setupNotes || null,
    easier: input.easier,
    harder: input.harder,
    theme: input.theme || null,
    format: input.format || null,
    ...toSourceFields(input.sourceUrl),
  }
}

export function useInsertDrill() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<Drill, Error, DrillInput>({
    mutationFn: async (input) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to add a drill.')
      }
      const { data, error } = await supabase
        .from('drills')
        .insert({ ...toDrillWriteRow(input), club_id: profile.club_id, created_by: user.id })
        .select(DRILL_COLS)
        .single()
      if (error) throw error
      return toDrill(data as unknown as DrillRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['drills'] }),
  })
}

export function useUpdateDrill() {
  const qc = useQueryClient()
  return useMutation<Drill, Error, { id: string; input: DrillInput }>({
    mutationFn: async ({ id, input }) => {
      const { data, error } = await supabase
        .from('drills')
        .update(toDrillWriteRow(input))
        .eq('id', id)
        .select(DRILL_COLS)
        .single()
      if (error) throw error
      return toDrill(data as unknown as DrillRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['drills'] }),
  })
}

// Sessions and templates that reference a deleted drill keep their activities
// jsonb untouched; the planner, live view and template screens render a quiet
// removed drill placeholder for the dangling id.
export function useDeleteDrill() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('drills').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['drills'] }),
  })
}

// ---- Template writes -----------------------------------------------------
// Create, edit and delete for session templates. Creating follows
// templates.create; editing and deleting follow the owner or manager arms of
// the templates RLS. Insert sets club_id and created_by (the owner arm needs
// it) and records the creator's display name as author, matching the
// imported templates; update sends none of them.

export interface TemplateInput {
  name: string
  focus: string
  intentions: string[]
  activities: Activity[]
  sourceUrl: string
}

function toTemplateWriteRow(input: TemplateInput) {
  return {
    name: input.name,
    focus: input.focus || null,
    intentions: input.intentions,
    activities: input.activities.map(toActivityRow),
    ...toSourceFields(input.sourceUrl),
  }
}

export function useInsertTemplate() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<Template, Error, TemplateInput>({
    mutationFn: async (input) => {
      if (!profile?.club_id) {
        throw new Error('You must be signed in to create a template.')
      }
      const { data, error } = await supabase
        .from('templates')
        .insert({
          ...toTemplateWriteRow(input),
          club_id: profile.club_id,
          created_by: user?.id ?? null,
          author: profile.full_name || null,
        })
        .select(TEMPLATE_COLS)
        .single()
      if (error) throw error
      return toTemplate(data as unknown as TemplateRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation<Template, Error, { id: string; input: TemplateInput }>({
    mutationFn: async ({ id, input }) => {
      const { data, error } = await supabase
        .from('templates')
        .update(toTemplateWriteRow(input))
        .eq('id', id)
        .select(TEMPLATE_COLS)
        .single()
      if (error) throw error
      return toTemplate(data as unknown as TemplateRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// Sessions built from a template copy its activities, so deleting the
// template leaves them untouched. A template serving as a programme week
// leaves that week empty, which the programme page shows as unassigned.
export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('templates').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// ---- Programme writes ----------------------------------------------------
// Create and edit for programmes, plus the two ways a template becomes a
// programme week. The programmes RLS is the real enforcement: insert needs a
// coaching role, update and delete follow owner or admin. Insert sets club_id
// and created_by; update sends neither, so a programme never changes club or
// owner.

export interface ProgrammeInput {
  name: string
  focus: string
  summary: string
  intentions: string[]
  weeks: number
  pdfMediaId: string | null
  sourceUrl: string
}

function toProgrammeWriteRow(input: ProgrammeInput) {
  return {
    name: input.name,
    focus: input.focus || null,
    summary: input.summary || null,
    intentions: input.intentions,
    weeks: input.weeks,
    pdf_media_id: input.pdfMediaId,
    ...toSourceFields(input.sourceUrl),
  }
}

export function useInsertProgramme() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<Programme, Error, ProgrammeInput>({
    mutationFn: async (input) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to create a programme.')
      }
      const { data, error } = await supabase
        .from('programmes')
        .insert({ ...toProgrammeWriteRow(input), club_id: profile.club_id, created_by: user.id })
        .select(PROGRAMME_COLS)
        .single()
      if (error) throw error
      return toProgramme(data as unknown as ProgrammeRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['programmes'] }),
  })
}

export function useUpdateProgramme() {
  const qc = useQueryClient()
  return useMutation<Programme, Error, { id: string; input: ProgrammeInput }>({
    mutationFn: async ({ id, input }) => {
      const { data, error } = await supabase
        .from('programmes')
        .update(toProgrammeWriteRow(input))
        .eq('id', id)
        .select(PROGRAMME_COLS)
        .single()
      if (error) throw error
      return toProgramme(data as unknown as ProgrammeRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['programmes'] }),
  })
}

// Owner or admin only; the programmes delete RLS is the real enforcement.
// Deleting a programme leaves its templates and sessions intact: the foreign
// keys null out in Postgres, so those caches refetch too.
export function useDeleteProgramme() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('programmes').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['programmes'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

// Points an existing template at a programme week, or clears the link with
// nulls. This is a templates update, which the RLS allows to the template's
// owner or a templates.manage holder (admin); the builder only surfaces it
// for admins. Coaches add weeks with the copy below.
export function useAssignTemplateWeek() {
  const qc = useQueryClient()
  return useMutation<void, Error, { templateId: string; programmeId: string | null; week: number | null }>({
    mutationFn: async ({ templateId, programmeId, week }) => {
      const { error } = await supabase
        .from('templates')
        .update({ programme_id: programmeId, programme_week: week })
        .eq('id', templateId)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// Copies a template into a programme week as a fresh insert, leaving the
// original untouched. Open to every holder of templates.create through the
// templates insert policy; created_by records the copier as the owner so
// they can edit or delete their copy. The legacy programme and week label
// columns are not written.
export function useCopyTemplateToWeek() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<void, Error, { template: Template; programmeId: string; week: number }>({
    mutationFn: async ({ template, programmeId, week }) => {
      if (!user || !profile?.club_id) throw new Error('You must be signed in.')
      const { error } = await supabase.from('templates').insert({
        club_id: profile.club_id,
        created_by: user.id,
        name: template.name,
        focus: template.focus || null,
        author: template.author || null,
        activities: template.activities.map(toActivityRow),
        intentions: template.intentions,
        programme_id: programmeId,
        programme_week: week,
        ...toSourceFields(template.sourceUrl),
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// ---- Session write -----------------------------------------------------
// One mutation behind the upsertSession(s) seam. A session already in the
// sessions cache is updated; a new one is inserted. On insert, coach_id and
// club_id are set from the signed-in user, which the RLS insert check requires.
// On update, neither is sent, so ownership and club never change.

interface UpsertCtx {
  prevList?: Session[]
  prevOne?: Session
}

export function useUpsertSession() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  // existed records whether each id was already present before the optimistic
  // cache write, so the mutation can choose insert versus update without
  // re-reading the cache that onMutate has just changed.
  const existed = useRef(new Map<string, boolean>())

  return useMutation<Session, Error, Session, UpsertCtx>({
    mutationFn: async (input) => {
      const isUpdate = existed.current.get(input.id) ?? false
      const activities = input.activities.map(toActivityRow)

      const faFields = {
        intentions: input.intentions,
        space: input.space || null,
        ...toSourceFields(input.sourceUrl),
        // The programme link travels with the session on insert and update,
        // so applying a programme tags the rows and a planner edit keeps them.
        programme_id: input.programmeId,
        programme_week: input.programmeWeek,
        // The Spond event link travels the same way: linking in the planner
        // edits the draft and saving writes it here.
        spond_event_id: input.spondEventId,
      }

      if (isUpdate) {
        const { data, error } = await supabase
          .from('sessions')
          .update({
            name: input.name,
            focus: input.focus,
            date: input.date || null,
            start_time: input.time,
            venue: input.venue,
            age_group: input.ageGroup,
            status: input.status,
            team_id: input.teamId,
            activities,
            ...faFields,
          })
          .eq('id', input.id)
          .select(SESSION_COLS)
          .single()
        if (error) throw error
        return toSession(data as unknown as SessionRow)
      }

      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to save a session.')
      }
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          id: input.id,
          coach_id: user.id,
          club_id: profile.club_id,
          name: input.name,
          focus: input.focus,
          date: input.date || null,
          start_time: input.time,
          venue: input.venue,
          age_group: input.ageGroup,
          status: input.status,
          team_id: input.teamId,
          activities,
          ...faFields,
        })
        .select(SESSION_COLS)
        .single()
      if (error) throw error
      return toSession(data as unknown as SessionRow)
    },
    // Optimistic and synchronous, so navigation by session id (start a session
    // straight after saving it) finds the record without waiting for the round
    // trip. The list and the per-id cache are both seeded.
    onMutate: (input) => {
      const prevList = qc.getQueryData<Session[]>(['sessions'])
      existed.current.set(input.id, (prevList ?? []).some((s) => s.id === input.id))
      const prevOne = qc.getQueryData<Session>(['sessions', input.id])
      qc.setQueryData<Session[]>(['sessions'], (old) => {
        const list = old ?? []
        const i = list.findIndex((s) => s.id === input.id)
        if (i === -1) return [...list, input]
        const copy = [...list]
        copy[i] = input
        return copy
      })
      qc.setQueryData<Session>(['sessions', input.id], input)
      return { prevList, prevOne }
    },
    onError: (_err, input, ctx) => {
      qc.setQueryData(['sessions'], ctx?.prevList)
      qc.setQueryData(['sessions', input.id], ctx?.prevOne)
    },
    onSettled: (_data, _err, input) => {
      existed.current.delete(input.id)
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

// Owner or admin only; the sessions delete RLS is the real enforcement.
export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('sessions').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

// ---- Live session state --------------------------------------------------
// The live view's driver writes shared state onto the session row: start sets
// index 0 and a timestamp, next and previous set the new index and reset the
// timestamp, end (index null) clears both and marks the session completed.
// The sessions update RLS (owner, or admin) is the real enforcement of who
// can drive; watchers never call this.

export function useSetLiveActivity() {
  const qc = useQueryClient()
  return useMutation<Session, Error, { id: string; index: number | null }>({
    mutationFn: async ({ id, index }) => {
      const patch =
        index == null
          ? { live_activity_index: null, live_activity_started_at: null, status: 'completed' as SessionStatus }
          : { live_activity_index: index, live_activity_started_at: new Date().toISOString() }
      const { data, error } = await supabase.from('sessions').update(patch).eq('id', id).select(SESSION_COLS).single()
      if (error) throw error
      return toSession(data as unknown as SessionRow)
    },
    onSuccess: (s) => {
      qc.setQueryData(['sessions', s.id], s)
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

// Keeps one session's cache entry in sync with the database row over Supabase
// Realtime, so watchers follow the driver. One channel per session id, removed
// on unmount. The update payload always carries the small live columns, so
// they patch the cache instantly; the invalidation then refetches the full row
// through RLS, which also covers any column the payload may omit.
export function useLiveSessionSync(sessionId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`live-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as Partial<SessionRow>
          qc.setQueryData<Session | null>(['sessions', sessionId], (old) =>
            old
              ? {
                  ...old,
                  status: row.status ?? old.status,
                  liveActivityIndex: row.live_activity_index ?? null,
                  liveActivityStartedAt: row.live_activity_started_at ?? null,
                }
              : old,
          )
          qc.invalidateQueries({ queryKey: ['sessions'] })
        },
      )
      .subscribe((status) => {
        // Cover the gap between the initial read and the subscription being
        // established: a change in that window has no event, so refetch once.
        if (status === 'SUBSCRIBED') qc.invalidateQueries({ queryKey: ['sessions', sessionId] })
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId, qc])
}

// ---- Spond attendance (counts only) ----------------------------------------
// The client side of the Spond mirror: the mapping editor's reads and writes,
// the synced events read, the sync trigger and the session link. THE
// CHILDREN'S DATA BOUNDARY applies here as on the server (CLAUDE.md, Spond
// integration): the reads select the four counts and event facts only, the
// tables hold nothing member identifying by design, and no hook here may
// ever request, store or log anything that does. The browser never calls
// Spond; the only network the sync button touches is the spond-sync Edge
// Function, and freshness comes only from pressing it.
//
// RLS is the enforcement throughout: club members read both tables, writing
// the mapping needs club.manage (spond_groups_manage), the sync writes
// events server side as the caller, and the session link rides the existing
// sessions update policies. The UI only decides what to surface.

interface SpondMappingRow {
  id: string
  spond_group_id: string
  spond_subgroup_id: string | null
  spond_name: string
  team_id: string
  created_at: string
  // The to-one teams embed; null only if the join found nothing.
  teams: { name: string } | null
}

interface SpondEventDbRow {
  id: string
  title: string
  starts_at: string
  team_id: string | null
  spond_type: string | null
  accepted_count: number
  declined_count: number
  unanswered_count: number
  waiting_count: number
  cancelled: boolean
  synced_at: string
  teams: { name: string } | null
}

// Counts and event facts only; there is nothing else in these tables to
// select, and nothing more may ever be added to these lists.
const SPOND_MAPPING_COLS = 'id, spond_group_id, spond_subgroup_id, spond_name, team_id, created_at, teams(name)'
const SPOND_EVENT_COLS =
  'id, title, starts_at, team_id, spond_type, accepted_count, declined_count, unanswered_count, waiting_count, cancelled, synced_at, teams(name)'

function toSpondMapping(r: SpondMappingRow): SpondMapping {
  return {
    id: r.id,
    groupId: r.spond_group_id,
    subgroupId: r.spond_subgroup_id,
    name: r.spond_name,
    teamId: r.team_id,
    teamName: r.teams?.name ?? '',
    createdAt: r.created_at,
  }
}

function toSpondEvent(r: SpondEventDbRow): SpondEvent {
  return {
    id: r.id,
    title: r.title,
    startsAt: r.starts_at,
    teamId: r.team_id,
    teamName: r.teams?.name ?? null,
    spondType: r.spond_type,
    accepted: r.accepted_count,
    declined: r.declined_count,
    unanswered: r.unanswered_count,
    waiting: r.waiting_count,
    cancelled: r.cancelled,
    syncedAt: r.synced_at,
  }
}

// The club's mappings, in the creation order the sync processes them.
export function useSpondMappings() {
  return useQuery({
    queryKey: ['spond_mappings'],
    queryFn: async (): Promise<SpondMapping[]> => {
      const { data, error } = await supabase
        .from('spond_groups')
        .select(SPOND_MAPPING_COLS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as SpondMappingRow[]).map(toSpondMapping)
    },
  })
}

// The synced events, the admin's view of what the mirror holds and the pool
// the session link picker offers. Ordered by start so the table reads as a
// calendar.
export function useSpondEvents() {
  return useQuery({
    queryKey: ['spond_events'],
    queryFn: async (): Promise<SpondEvent[]> => {
      const { data, error } = await supabase
        .from('spond_events')
        .select(SPOND_EVENT_COLS)
        .order('starts_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as SpondEventDbRow[]).map(toSpondEvent)
    },
  })
}

export interface SpondMappingInput {
  groupId: string
  subgroupId: string | null
  name: string
  teamId: string
}

// Adds a mapping row, which is also the sync's allow list. The unique
// constraint (nulls not distinct) refuses a duplicate group or subgroup
// mapping; that lands here as a plain message the form shows inline.
export function useInsertSpondMapping() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<void, Error, SpondMappingInput>({
    mutationFn: async (input) => {
      if (!profile?.club_id) throw new Error('You must be signed in.')
      const { error } = await supabase.from('spond_groups').insert({
        club_id: profile.club_id,
        spond_group_id: input.groupId,
        spond_subgroup_id: input.subgroupId,
        spond_name: input.name,
        team_id: input.teamId,
      })
      if (error) {
        if (error.code === '23505') throw new Error('That Spond group or subgroup is already mapped.')
        throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['spond_mappings'] }),
  })
}

// Removing a mapping stops future syncs for that group. Events already
// synced are untouched: nothing references the mapping, so this is a pure
// row delete.
export function useDeleteSpondMapping() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('spond_groups').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['spond_mappings'] }),
  })
}

// The spond-sync response, mapped to the app contract. One outcome per
// mapping: our mapping id and display label, counts and plain failure text,
// never any Spond payload content.
export interface SpondSyncOutcome {
  id: string
  name: string
  status: 'synced' | 'failed'
  events: number
  warnings: string[]
  error: string
}

export interface SpondSyncResult {
  ok: boolean
  // The no mappings outcome carries a message instead of outcomes.
  message: string
  window: { from: string; to: string } | null
  outcomes: SpondSyncOutcome[]
  eventsTotal: number
  // Set when a Spond rate limit or server error stopped the run early.
  stopped: string
}

interface SpondSyncBody {
  ok?: boolean
  message?: string
  window?: { from?: string; to?: string }
  mappings?: {
    id?: string
    spond_name?: string
    status?: string
    events?: number
    warnings?: string[]
    error?: string
  }[]
  events_total?: number
  stopped?: string
}

// Triggers the spond-sync Edge Function, the only thing that ever refreshes
// the mirror. The function checks sessions.create before contacting Spond; a
// 403 (capability), 503 (the organiser account secrets are missing) or 502
// (Spond unreachable) replies with a plain { error } body shown verbatim.
export function useSpondSync() {
  const qc = useQueryClient()
  return useMutation<SpondSyncResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('spond-sync', {})
      if (error) {
        let message = 'Could not sync from Spond. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) message = body.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      const body = (data ?? {}) as SpondSyncBody
      return {
        ok: body.ok === true,
        message: body.message ?? '',
        window: body.window?.from && body.window?.to ? { from: body.window.from, to: body.window.to } : null,
        outcomes: (body.mappings ?? []).map((m) => ({
          id: m.id ?? '',
          name: m.spond_name ?? '',
          status: m.status === 'synced' ? ('synced' as const) : ('failed' as const),
          events: m.events ?? 0,
          warnings: m.warnings ?? [],
          error: m.error ?? '',
        })),
        eventsTotal: body.events_total ?? 0,
        stopped: body.stopped ?? '',
      }
    },
    // Settled, not success: the function upserts per mapping, so rows written
    // before a late failure must show either way. Sessions are not
    // invalidated because they carry only the link id; the counts always
    // render from the spond_events read.
    onSettled: () => qc.invalidateQueries({ queryKey: ['spond_events'] }),
  })
}

// Links a session to a synced event, or unlinks with null. A plain sessions
// update riding the existing update policies (owner, or sessions.manage),
// so ownership rules apply exactly as they do to any other session edit; a
// write RLS blocks updates no rows, which is reported rather than swallowed.
export function useLinkSessionSpondEvent() {
  const qc = useQueryClient()
  return useMutation<void, Error, { sessionId: string; spondEventId: string | null }>({
    mutationFn: async ({ sessionId, spondEventId }) => {
      const { data, error } = await supabase
        .from('sessions')
        .update({ spond_event_id: spondEventId })
        .eq('id', sessionId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Only the session owner or an admin can change its Spond link.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

// ---- Feedback --------------------------------------------------------------
// The club feedback log: feature requests, bug reports and general feedback.
// Club visible by design, so duplicates are avoided and status is
// transparent. The feedback RLS is the enforcement: every member reads and
// files, a creator edits and deletes their own items, and status moves only
// with club.manage (the feedback_guard_columns trigger holds the column
// rules server side). The UI only decides what to surface.

interface FeedbackRow {
  id: string
  club_id: string
  created_by: string
  kind: FeedbackKind
  title: string
  body: string | null
  status: FeedbackStatus
  created_at: string
  updated_at: string
}

const FEEDBACK_COLS = 'id, club_id, created_by, kind, title, body, status, created_at, updated_at'

function toFeedbackItem(r: FeedbackRow): FeedbackItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body ?? '',
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// The club's feedback, newest first.
export function useFeedback() {
  return useQuery({
    queryKey: ['feedback'],
    queryFn: async (): Promise<FeedbackItem[]> => {
      const { data, error } = await supabase
        .from('feedback')
        .select(FEEDBACK_COLS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return (data as unknown as FeedbackRow[]).map(toFeedbackItem)
    },
  })
}

export interface FeedbackInput {
  kind: FeedbackKind
  title: string
  body: string
}

// Files an item as the signed in member. Status is not sent: it starts as
// new through the column default, and the guard trigger refuses anything
// else from a member without club.manage anyway.
export function useInsertFeedback() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<void, Error, FeedbackInput>({
    mutationFn: async (input) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to send feedback.')
      }
      const { error } = await supabase.from('feedback').insert({
        club_id: profile.club_id,
        created_by: user.id,
        kind: input.kind,
        title: input.title.trim(),
        body: input.body.trim() || null,
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// Creator only, and title, body and kind only; status moves through the
// status hook below. The feedback update RLS is the real enforcement, and a
// write it blocks updates no rows, which is reported rather than swallowed.
// updated_at is set here because the schema carries no updated_at trigger.
export function useUpdateFeedback() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; input: FeedbackInput }>({
    mutationFn: async ({ id, input }) => {
      const { data, error } = await supabase
        .from('feedback')
        .update({
          kind: input.kind,
          title: input.title.trim(),
          body: input.body.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only edit feedback you filed.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// Creator only; the feedback delete RLS is the real enforcement, and a
// blocked delete (no error, zero rows) removes nothing and is reported.
export function useDeleteFeedback() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.from('feedback').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only delete feedback you filed.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// club.manage only. The manage arm of the update RLS plus the column guard
// trigger are the real enforcement; the select on the row only surfaces it.
export function useSetFeedbackStatus() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; status: FeedbackStatus }>({
    mutationFn: async ({ id, status }) => {
      const { data, error } = await supabase
        .from('feedback')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Only a holder of club.manage can change feedback status.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// ---- Teams (teams.manage) -------------------------------------------------
// The teams RLS allows club members to read and teams.manage holders to
// write. Member assignment to teams is user administration and lives in the
// member section below.

export function useInsertTeam() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<void, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      if (!profile?.club_id) throw new Error('You must be signed in.')
      const { error } = await supabase.from('teams').insert({ club_id: profile.club_id, name })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useRenameTeam() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const { error } = await supabase.from('teams').update({ name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

// Removing a team nulls team_id on sessions and profiles through the foreign
// keys, so those caches refetch too.
export function useDeleteTeam() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('teams').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

// ---- Member role and team assignment (users.manage) -----------------------
// RBAC v2 made assignments sets: member_roles and member_teams rows, diffed
// against the desired set and applied as inserts and deletes (the tables
// carry no update policy by design). Both writes are gated server side on
// users.manage and scoped to the club; a permission refusal or the last
// admin trigger surfaces as the mutation error, verbatim. The denormalised
// display primaries on profiles (role, team_id) are kept coherent here, the
// same way the invite-user function keeps them on invite.

export function useSetMemberRoles() {
  const qc = useQueryClient()
  const { user, refreshProfile } = useAuth()
  return useMutation<void, Error, { memberId: string; roleIds: string[] }>({
    mutationFn: async ({ memberId, roleIds }) => {
      const { data: currentRows, error: readError } = await supabase
        .from('member_roles')
        .select('role_id')
        .eq('member_id', memberId)
      if (readError) throw readError
      const current = new Set((currentRows ?? []).map((r: { role_id: string }) => r.role_id))
      const desired = new Set(roleIds)
      const adds = roleIds.filter((id) => !current.has(id))
      const removes = [...current].filter((id) => !desired.has(id))

      // Inserts before deletes, so a failure part way leaves the member with
      // extra roles rather than none. The last admin trigger fires on the
      // delete; its message is the error the UI shows.
      if (adds.length > 0) {
        const { error } = await supabase
          .from('member_roles')
          .insert(adds.map((roleId) => ({ member_id: memberId, role_id: roleId })))
        if (error) throw error
      }
      if (removes.length > 0) {
        const { error } = await supabase
          .from('member_roles')
          .delete()
          .eq('member_id', memberId)
          .in('role_id', removes)
        if (error) throw error
      }

      // Keep the display primary coherent: the highest precedence system role
      // now held. Read the keys back rather than trusting the caller's list.
      const { data: roleRows, error: rolesError } = await supabase
        .from('roles')
        .select('key, system')
        .in('id', roleIds)
      if (rolesError) throw rolesError
      const primary = primaryRoleKey((roleRows ?? []) as { key: string; system: boolean }[])
      const { error: primaryError } = await supabase.from('profiles').update({ role: primary }).eq('id', memberId)
      if (primaryError) throw primaryError
    },
    onSettled: async (_data, _err, { memberId }) => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['my_capabilities'] })
      // An admin editing their own roles changes their own shell at once.
      if (memberId === user?.id) await refreshProfile()
    },
  })
}

export function useSetMemberTeams() {
  const qc = useQueryClient()
  return useMutation<void, Error, { memberId: string; teamIds: string[] }>({
    mutationFn: async ({ memberId, teamIds }) => {
      const { data: currentRows, error: readError } = await supabase
        .from('member_teams')
        .select('team_id')
        .eq('member_id', memberId)
      if (readError) throw readError
      const current = new Set((currentRows ?? []).map((r: { team_id: string }) => r.team_id))
      const desired = new Set(teamIds)
      const adds = teamIds.filter((id) => !current.has(id))
      const removes = [...current].filter((id) => !desired.has(id))

      if (adds.length > 0) {
        const { error } = await supabase
          .from('member_teams')
          .insert(adds.map((teamId) => ({ member_id: memberId, team_id: teamId })))
        if (error) throw error
      }
      if (removes.length > 0) {
        const { error } = await supabase
          .from('member_teams')
          .delete()
          .eq('member_id', memberId)
          .in('team_id', removes)
        if (error) throw error
      }

      // Keep the display primary team valid: unchanged while still selected,
      // otherwise the first selected team or none.
      const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('team_id')
        .eq('id', memberId)
        .maybeSingle()
      if (profileError) throw profileError
      const currentPrimary = (profileRow as { team_id: string | null } | null)?.team_id ?? null
      const nextPrimary = nextPrimaryTeamId(currentPrimary, teamIds)
      if (nextPrimary !== currentPrimary) {
        const { error } = await supabase.from('profiles').update({ team_id: nextPrimary }).eq('id', memberId)
        if (error) throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

// The durable every team flag. While it is on the specific member_teams rows
// stay as the remembered selection but nothing reads them.
export function useSetMemberAllTeams() {
  const qc = useQueryClient()
  return useMutation<void, Error, { memberId: string; allTeams: boolean }>({
    mutationFn: async ({ memberId, allTeams }) => {
      const { error } = await supabase.from('profiles').update({ all_teams: allTeams }).eq('id', memberId)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

// ---- Account self-service -------------------------------------------------
// The signed-in member edits their own profile row through the
// profiles_update_self policy. Role and club are never sent from here, so
// they cannot change; that stays with admins on the Users screen. The auth
// context's profile is refreshed so the shell reflects the change at once.

export function useUpdateMyProfile() {
  const qc = useQueryClient()
  const { user, refreshProfile } = useAuth()
  return useMutation<void, Error, { fullName?: string; teamId?: string | null }>({
    mutationFn: async (input) => {
      if (!user) throw new Error('You must be signed in.')
      const patch: Record<string, unknown> = {}
      if (input.fullName !== undefined) patch.full_name = input.fullName
      if (input.teamId !== undefined) patch.team_id = input.teamId
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (error) throw error
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      await refreshProfile()
    },
  })
}

// The profile photo is a storage object, not a media library item, so no
// media row is registered. The object lives in the media bucket under
// avatars/{user_id}/ and profiles.avatar_url stores the storage path; the
// avatar renders it through the same signed URL hook as media previews.
export function useUploadAvatar() {
  const qc = useQueryClient()
  const { user, profile, refreshProfile } = useAuth()
  return useMutation<void, Error, { file: File }>({
    mutationFn: async ({ file }) => {
      if (!user) throw new Error('You must be signed in.')
      if (detectMediaType(file.type) !== 'image') throw new Error('Choose an image file.')
      const path = `avatars/${user.id}/${crypto.randomUUID()}-${sanitiseFilename(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(path, file, { contentType: file.type || undefined })
      if (uploadError) throw uploadError
      const previous = profile?.avatar_url
      const { error } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', user.id)
      // If the row update fails after the object uploaded, remove the object
      // so no orphan is left behind in Storage.
      if (error) {
        await supabase.storage.from('media').remove([path])
        throw error
      }
      // The replaced photo is unreferenced now; removal is best effort.
      if (previous) void supabase.storage.from('media').remove([previous])
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      await refreshProfile()
    },
  })
}

export function useRemoveAvatar() {
  const qc = useQueryClient()
  const { user, profile, refreshProfile } = useAuth()
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!user) throw new Error('You must be signed in.')
      const previous = profile?.avatar_url
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id)
      if (error) throw error
      if (previous) void supabase.storage.from('media').remove([previous])
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      await refreshProfile()
    },
  })
}

// ---- Club settings (admin) --------------------------------------------------
// Writes go through the clubs_update_admin policy; the screens only decide
// whether to surface the form. The crest is a storage object in the media
// bucket under club/, stored on the row as its path and signed for rendering
// like any other private object. A crest_url holding a full URL (a seeded or
// external value) is left alone by the cleanup, which only removes bucket
// objects.

export function useUpdateClub() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; name?: string; motto?: string }>({
    mutationFn: async ({ id, name, motto }) => {
      const patch: Record<string, unknown> = {}
      if (name !== undefined) patch.name = name
      if (motto !== undefined) patch.motto = motto || null
      const { error } = await supabase.from('clubs').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club'] }),
  })
}

// PNG, JPG and SVG only: the crest renders small in the shell, so these
// cover it and keep the object lightweight.
export const CREST_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']

function isStoragePath(value: string | null): value is string {
  return !!value && !/^https?:\/\//i.test(value)
}

export function useUploadCrest() {
  const qc = useQueryClient()
  return useMutation<void, Error, { club: Club; file: File }>({
    mutationFn: async ({ club, file }) => {
      if (!CREST_TYPES.includes(file.type)) throw new Error('Use a PNG, JPG or SVG file.')
      const path = `club/${crypto.randomUUID()}-${sanitiseFilename(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(path, file, { contentType: file.type || undefined })
      if (uploadError) throw uploadError
      const { error } = await supabase.from('clubs').update({ crest_url: path }).eq('id', club.id)
      // If the row update fails after the object uploaded, remove the object
      // so no orphan is left behind in Storage.
      if (error) {
        await supabase.storage.from('media').remove([path])
        throw error
      }
      // The replaced crest object is unreferenced now; removal is best effort.
      if (isStoragePath(club.crestUrl)) void supabase.storage.from('media').remove([club.crestUrl])
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club'] }),
  })
}

// Back to the bundled crest: clears crest_url and removes the uploaded object.
export function useClearCrest() {
  const qc = useQueryClient()
  return useMutation<void, Error, { club: Club }>({
    mutationFn: async ({ club }) => {
      const { error } = await supabase.from('clubs').update({ crest_url: null }).eq('id', club.id)
      if (error) throw error
      if (isStoragePath(club.crestUrl)) void supabase.storage.from('media').remove([club.crestUrl])
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club'] }),
  })
}

// ---- Invites -------------------------------------------------------------
// The invite goes through the invite-user Edge Function, which holds the
// service role key server side and re-checks that the caller holds the
// users.manage capability. functions.invoke sends the signed in user's
// access token automatically. The function speaks the multi role model:
// roles is an array of role ids validated against the club's roles table,
// and the teams are either a set of ids or the all teams flag.

export interface InviteInput {
  email: string
  fullName: string
  roleIds: string[]
  teamIds: string[]
  allTeams: boolean
}

// ---- Import from England Football ---------------------------------------
// The fetch happens in the fa-import Edge Function because the browser
// cannot reach the FA site cross origin. The function acts as the signed in
// caller through RLS (no service role) and enforces the domain allowlist;
// see CLAUDE.md, Third-party content. functions.invoke sends the signed in
// user's access token automatically.

export interface ImportFAResult {
  templateId: string | null
  templateName: string
  drills: number
  media: number
  // The FA topic tags the import captured onto the drills, for the result
  // card's summary. Empty when the page carried none.
  tags: string[]
  warnings: string[]
}

// The structured 409 fa-import returns for a page the club already
// imported: nothing was created, and the coach is pointed at the existing
// template. Re-calling with reimport: true is the explicit choice to
// create a second copy.
export interface ImportFADuplicate {
  alreadyImported: true
  templateId: string | null
  templateName: string
}

export type ImportFAOutcome = ImportFAResult | ImportFADuplicate

interface ImportFABody {
  template_id?: string
  template_name?: string
  created?: { drills?: number; media?: number }
  tags?: string[]
  warnings?: string[]
}

interface ImportFAErrorBody {
  error?: string
  template_id?: string
  template_name?: string
}

// Recognise the already imported conflict in a fa-import error response.
// Only the dedicated 409 already_imported body counts; every other error
// stays on the plain error path.
export function alreadyImportedFrom(status: number, body: ImportFAErrorBody | null | undefined): ImportFADuplicate | null {
  if (status !== 409 || body?.error !== 'already_imported') return null
  return { alreadyImported: true, templateId: body.template_id ?? null, templateName: body.template_name ?? '' }
}

// The fa-import request body. The reimport flag rides along only when the
// coach explicitly chose a second copy; it is never sent by default.
export function faImportBody(url: string, reimport?: boolean): { url: string; reimport?: true } {
  return reimport === true ? { url, reimport: true } : { url }
}

export function useImportFA() {
  const qc = useQueryClient()
  return useMutation<ImportFAOutcome, Error, { url: string; reimport?: boolean }>({
    mutationFn: async ({ url, reimport }) => {
      const { data, error } = await supabase.functions.invoke('fa-import', { body: faImportBody(url, reimport) })
      if (error) {
        let message = 'Could not import that page. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const body = (await ctx.json()) as ImportFAErrorBody
            const duplicate = alreadyImportedFrom(ctx.status, body)
            if (duplicate) return duplicate
            if (body?.error) message = body.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      const body = (data ?? {}) as ImportFABody
      return {
        templateId: body.template_id ?? null,
        templateName: body.template_name ?? '',
        drills: body.created?.drills ?? 0,
        media: body.created?.media ?? 0,
        tags: body.tags ?? [],
        warnings: body.warnings ?? [],
      }
    },
    // Settled, not success: the function writes drills and media one by one,
    // so rows persist even when the call ultimately reports an error (a
    // partial import, a timeout on a long run). The lists must show them
    // either way, with no manual refresh.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
      qc.invalidateQueries({ queryKey: ['media'] })
    },
  })
}

// Import a whole FA programme from its overview page. The fa-import-programme
// Edge Function performs the single sanctioned one-level follow (the
// overview's own week links, same host, capped) as the signed in caller
// through RLS, ties the weeks to one programme row and attaches the
// programme PDF when present. See CLAUDE.md, Third-party content.

export interface ImportProgrammeWeek {
  week: number
  status: 'imported' | 'skipped' | 'failed'
  templateName: string
  drills: number
  media: number
  // The FA topic tags captured onto the week's drills.
  tags: string[]
  warnings: string[]
  error: string
}

export interface ImportProgrammeResult {
  programmeId: string | null
  programmeName: string
  weeks: ImportProgrammeWeek[]
  warnings: string[]
}

interface ImportProgrammeBody {
  programme_id?: string
  programme_name?: string
  weeks?: {
    week?: number
    status?: string
    template_name?: string
    created?: { drills?: number; media?: number }
    tags?: string[]
    warnings?: string[]
    error?: string
  }[]
  warnings?: string[]
}

export function useImportFAProgramme() {
  const qc = useQueryClient()
  return useMutation<ImportProgrammeResult, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      const { data, error } = await supabase.functions.invoke('fa-import-programme', { body: { url } })
      if (error) {
        let message = 'Could not import that programme. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) message = body.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      const body = (data ?? {}) as ImportProgrammeBody
      return {
        programmeId: body.programme_id ?? null,
        programmeName: body.programme_name ?? '',
        weeks: (body.weeks ?? []).map((w) => ({
          week: w.week ?? 0,
          status: w.status === 'imported' || w.status === 'skipped' ? w.status : 'failed',
          templateName: w.template_name ?? '',
          drills: w.created?.drills ?? 0,
          media: w.created?.media ?? 0,
          tags: w.tags ?? [],
          warnings: w.warnings ?? [],
          error: w.error ?? '',
        })),
        warnings: body.warnings ?? [],
      }
    },
    // Settled, not success: the programme row is created before the weeks
    // import, so it persists even when the call ultimately fails or times
    // out part way. The Programmes screen must show it either way, with no
    // manual refresh.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['programmes'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
      qc.invalidateQueries({ queryKey: ['media'] })
    },
  })
}

export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation<{ warning?: string }, Error, InviteInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: input.email,
          full_name: input.fullName,
          roles: input.roleIds,
          team_ids: input.teamIds,
          all_teams: input.allTeams,
        },
      })
      if (error) {
        // The function replies with a plain { error } body; surface it.
        let message = 'Could not send the invite. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) message = body.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      return (data ?? {}) as { warning?: string }
    },
    // The invite creates the auth user at once, so the new profile row is
    // already in the list, in the invited state until they first sign in.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['member_states'] })
    },
  })
}

// ---- Capabilities and user administration ---------------------------------
// 0012_rbac moved access from role names to capabilities, and 0015_rbac_roles
// made roles data: role_capabilities is keyed by role_id, a member holds one
// or more roles through member_roles, and has_perm() grants on any held
// role. The hooks here mirror that exactly. Everything here only decides
// what the UI surfaces; Postgres RLS and the Edge Functions are the real
// boundary.

// The catalogue, seeded by the migration and read only to clients. The grid
// renders from it so the catalogue and the grid share one source.
export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    retry: false,
    queryFn: async (): Promise<Capability[]> => {
      const { data, error } = await supabase.from('capabilities').select('key, label, description').order('key')
      if (error) throw error
      return (data ?? []) as Capability[]
    },
  })
}

// The whole role to capability mapping, keyed by role_id. Every club member
// may read it; only users.manage may write it. retry is off so the grid
// settles fast rather than retrying a structural failure.
export function useRoleCapabilities() {
  return useQuery({
    queryKey: ['role_capabilities'],
    retry: false,
    queryFn: async (): Promise<RoleCapability[]> => {
      const { data, error } = await supabase
        .from('role_capabilities')
        .select('role_id, capability')
        .order('role_id')
        .order('capability')
      if (error) throw error
      return ((data ?? []) as { role_id: string; capability: string }[]).map((rc) => ({
        roleId: rc.role_id,
        capability: rc.capability,
      }))
    },
  })
}

// The signed in member's capability set: the union across every role they
// hold, exactly as has_perm() grants. Reads the member's own member_roles
// rows, then the capabilities those roles map to. On a genuine load error
// this fails closed to the empty set; the server enforces the real boundary
// either way, so a wrongly empty set can hide affordances but never grant.
export function useMyCapabilities(): { caps: Set<string>; isPending: boolean } {
  const { user } = useAuth()
  const { data, isPending } = useQuery({
    queryKey: ['my_capabilities', user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async (): Promise<string[]> => {
      const { data: roleRows, error: rolesError } = await supabase
        .from('member_roles')
        .select('role_id')
        .eq('member_id', user!.id)
      if (rolesError) throw rolesError
      const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id)
      if (roleIds.length === 0) return []
      const { data: capRows, error: capsError } = await supabase
        .from('role_capabilities')
        .select('capability')
        .in('role_id', roleIds)
      if (capsError) throw capsError
      return [...new Set((capRows ?? []).map((rc: { capability: string }) => rc.capability))]
    },
  })
  return useMemo(() => {
    if (user && isPending) return { caps: new Set<string>(), isPending: true }
    return { caps: new Set(data ?? []), isPending: false }
  }, [user, data, isPending])
}

// Saves a tick grid edit. Changes apply to every member holding the role at
// once: the policies consult the mapping per request, so there is nothing to
// redeploy. Inserts and deletes are separate statements; if one fails part
// way the refetch shows exactly what saved and the grid can be corrected.
export function useSaveRoleCapabilities() {
  const qc = useQueryClient()
  return useMutation<void, Error, { adds: RoleCapability[]; removes: RoleCapability[] }>({
    mutationFn: async ({ adds, removes }) => {
      if (adds.length > 0) {
        const { error } = await supabase
          .from('role_capabilities')
          .insert(adds.map((a) => ({ role_id: a.roleId, capability: a.capability })))
        if (error) throw error
      }
      const byRole = new Map<string, string[]>()
      for (const r of removes) byRole.set(r.roleId, [...(byRole.get(r.roleId) ?? []), r.capability])
      for (const [roleId, capabilities] of byRole) {
        const { error } = await supabase
          .from('role_capabilities')
          .delete()
          .eq('role_id', roleId)
          .in('capability', capabilities)
        if (error) throw error
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['role_capabilities'] })
      qc.invalidateQueries({ queryKey: ['my_capabilities'] })
    },
  })
}

// ---- Custom roles ----------------------------------------------------------
// Admins create, rename and delete custom roles through the roles manager.
// The insert policy pins system to false and a trigger protects the system
// rows, so the worst a UI bug can do is surface a refusal. Deleting a custom
// role cascades its assignments and capability rows away; the UI confirms
// first and says how many members hold it.

export function useCreateRole() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<void, Error, { key: string; label: string }>({
    mutationFn: async ({ key, label }) => {
      if (!profile?.club_id) throw new Error('You must be signed in.')
      const { error } = await supabase.from('roles').insert({ club_id: profile.club_id, key, label })
      if (error) {
        if (error.code === '23505') throw new Error('A role with that name already exists.')
        throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useRenameRole() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; label: string }>({
    mutationFn: async ({ id, label }) => {
      const { error } = await supabase.from('roles').update({ label }).eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('roles').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['role_capabilities'] })
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['my_capabilities'] })
    },
  })
}

// Invited or active, per member id, through the member_states() function
// (users.manage only, so it is fetched only when the caller holds it). The
// function arrives with 0012; on any error the Users screen simply shows no
// state chips.
interface MemberStateRow {
  member_id: string
  state: string
}

export function useMemberStates() {
  const { caps } = useMyCapabilities()
  return useQuery({
    queryKey: ['member_states'],
    enabled: caps.has('users.manage'),
    retry: false,
    queryFn: async (): Promise<Record<string, 'invited' | 'active'>> => {
      const { data, error } = await supabase.rpc('member_states')
      if (error) throw error
      const out: Record<string, 'invited' | 'active'> = {}
      for (const row of (data ?? []) as MemberStateRow[]) {
        if (row.state === 'invited' || row.state === 'active') out[row.member_id] = row.state
      }
      return out
    },
  })
}

// Removal goes through the remove-user Edge Function, which holds the
// service role key server side and re-checks the caller holds users.manage.
// The function refuses self removal and removing the club's only admin. The
// member's content stays with the club (owner references null out), so the
// content caches refetch alongside the member list.
export function useRemoveUser() {
  const qc = useQueryClient()
  return useMutation<{ message?: string }, Error, { userId: string }>({
    mutationFn: async ({ userId }) => {
      const { data, error } = await supabase.functions.invoke('remove-user', { body: { user_id: userId } })
      if (error) {
        // The function replies with a plain { error } body; surface it.
        let message = 'Could not remove the member. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) message = body.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      return (data ?? {}) as { message?: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['member_states'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['programmes'] })
    },
  })
}
