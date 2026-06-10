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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../hooks/useAuth'
import type {
  Activity,
  Club,
  CornerKey,
  Drill,
  Level,
  MediaItem,
  MediaType,
  Member,
  Phase,
  Programme,
  Role,
  Session,
  SessionStatus,
  Team,
  Template,
} from './data'
import { youtubeId } from './data'
import { sourceLabelForUrl } from './fa'

// ---- Database row shapes (snake_case) ----------------------------------
// Separate from the component-facing camelCase types. Nullable columns are
// reflected here; the mappers coerce them to the non-null component contract.

interface DrillRow {
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
interface ActivityRow {
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

interface SessionRow {
  id: string
  club_id: string
  coach_id: string
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
  live_activity_index: number | null
  live_activity_started_at: string | null
}

interface TeamRow {
  id: string
  club_id: string
  name: string
  created_at: string
}

interface ProfileRow {
  id: string
  full_name: string | null
  avatar: string | null
  avatar_url: string | null
  role: Role
  team_id: string | null
  created_at: string
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
  'id, club_id, name, type, kind, storage_path, yt_url, size, dims, length, pages, created_by, created_at, source_url, source_label'
const TEMPLATE_COLS =
  'id, club_id, name, focus, author, activities, created_at, intentions, programme, week, programme_id, programme_week, source_url, source_label'
const PROGRAMME_COLS =
  'id, club_id, name, focus, summary, intentions, weeks, pdf_media_id, source_url, source_label, created_by, created_at'
const SESSION_COLS =
  'id, club_id, coach_id, team_id, name, focus, date, start_time, venue, age_group, status, activities, created_at, intentions, space, source_url, source_label, live_activity_index, live_activity_started_at'
const TEAM_COLS = 'id, club_id, name, created_at'
const PROFILE_COLS = 'id, full_name, avatar, avatar_url, role, team_id, created_at'
const CLUB_COLS = 'id, name, motto, crest_url'

// ---- Mappers -----------------------------------------------------------

function toActivity(a: ActivityRow): Activity {
  const out: Activity = { phase: a.phase, duration: a.duration }
  if (a.drill_id != null) out.drillId = a.drill_id
  if (a.title != null) out.title = a.title
  return out
}

function toActivityRow(a: Activity): ActivityRow {
  const out: ActivityRow = { phase: a.phase, duration: a.duration }
  if (a.drillId != null) out.drill_id = a.drillId
  if (a.title != null) out.title = a.title
  return out
}

function toDrill(r: DrillRow): Drill {
  return {
    id: r.id,
    title: r.title,
    corner: r.corner ?? 'technical',
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

function toSession(r: SessionRow): Session {
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
    coachId: r.coach_id,
    teamId: r.team_id,
    intentions: r.intentions ?? [],
    space: r.space ?? '',
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    liveActivityIndex: r.live_activity_index ?? null,
    liveActivityStartedAt: r.live_activity_started_at ?? null,
  }
}

function toTeam(r: TeamRow): Team {
  return { id: r.id, name: r.name }
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

// The media bucket rides on the project's global upload limit, 50 MB (the
// same value config.toml sets locally). Checked before any bytes move, so an
// oversized pick fails at once with a plain message instead of a storage
// error at the end of a long upload.
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024

export function oversizeMessage(file: File): string | null {
  if (file.size <= MEDIA_MAX_BYTES) return null
  return `That file is ${formatBytes(file.size)} and the upload limit is 50 MB. Compress the file or trim the clip and try again.`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
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

export function useUploadMedia() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation<void, Error, UploadInput>({
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
        const { error } = await supabase.from('media').insert({
          club_id: clubId,
          created_by: user.id,
          name: input.name,
          type: 'youtube',
          yt_url: input.ytUrl,
        })
        if (error) throw new Error(`Could not save the link: ${error.message}`)
        return
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

      const { error: insertError } = await supabase.from('media').insert({
        club_id: clubId,
        created_by: user.id,
        name: input.name,
        type,
        storage_path: path,
        size,
        dims: dims ?? null,
        length: length ?? null,
      })
      // If the row insert fails after the object uploaded, remove the object so
      // no orphan is left behind in Storage.
      if (insertError) {
        await supabase.storage.from('media').remove([path])
        throw new Error(`The file uploaded but could not be saved to the library: ${insertError.message}`)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
    },
  })
}

// ---- Media delete ------------------------------------------------------
// Owner or admin only; the media RLS delete policy is the real enforcement.
// The storage object goes first, then the row. Drills that link the row fall
// back to no media through the on delete set null foreign key.
export function useDeleteMedia() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; storagePath?: string | null }>({
    mutationFn: async ({ id, storagePath }) => {
      if (storagePath) {
        const { error } = await supabase.storage.from('media').remove([storagePath])
        if (error) throw error
      }
      const { error } = await supabase.from('media').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
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
  corner: CornerKey
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drills'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drills'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drills'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programmes'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programmes'] }),
  })
}

// Points an existing template at a programme week, or clears the link with
// nulls. This is a templates update, which the RLS reserves for the curating
// role (admin); the builder only surfaces it there. Coaches add weeks with
// the copy below.
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// Copies a template into a programme week as a fresh insert, leaving the
// original untouched. Open to every coaching role through the templates
// insert policy. The legacy programme and week label columns are not written.
export function useCopyTemplateToWeek() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<void, Error, { template: Template; programmeId: string; week: number }>({
    mutationFn: async ({ template, programmeId, week }) => {
      if (!profile?.club_id) throw new Error('You must be signed in.')
      const { error } = await supabase.from('templates').insert({
        club_id: profile.club_id,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
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

// ---- Teams and members (admin) ------------------------------------------
// The teams RLS allows club members to read and admins to write. The
// profiles_admin_all policy already permits role and team changes by an
// admin; no policy change was needed for these.

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

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; role?: Role; teamId?: string | null }>({
    mutationFn: async ({ id, role, teamId }) => {
      const patch: Record<string, unknown> = {}
      if (role !== undefined) patch.role = role
      if (teamId !== undefined) patch.team_id = teamId
      const { error } = await supabase.from('profiles').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
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
// service role key server side and re-checks that the caller is an admin.
// functions.invoke sends the signed in user's access token automatically.

export interface InviteInput {
  email: string
  fullName: string
  role: 'coach' | 'admin' | 'parent'
  teamId: string | null
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
  warnings: string[]
}

interface ImportFABody {
  template_id?: string
  template_name?: string
  created?: { drills?: number; media?: number }
  warnings?: string[]
}

export function useImportFA() {
  const qc = useQueryClient()
  return useMutation<ImportFAResult, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      const { data, error } = await supabase.functions.invoke('fa-import', { body: { url } })
      if (error) {
        let message = 'Could not import that page. Try again.'
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
      const body = (data ?? {}) as ImportFABody
      return {
        templateId: body.template_id ?? null,
        templateName: body.template_name ?? '',
        drills: body.created?.drills ?? 0,
        media: body.created?.media ?? 0,
        warnings: body.warnings ?? [],
      }
    },
    onSuccess: () => {
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
          warnings: w.warnings ?? [],
          error: w.error ?? '',
        })),
        warnings: body.warnings ?? [],
      }
    },
    onSuccess: () => {
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
        body: { email: input.email, full_name: input.fullName, role: input.role, team_id: input.teamId },
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
    // already in the list.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}
