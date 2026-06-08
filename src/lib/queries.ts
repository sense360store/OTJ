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
import { useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from '../hooks/useAuth'
import type {
  Activity,
  CornerKey,
  Drill,
  Level,
  MediaItem,
  MediaType,
  Phase,
  Session,
  SessionStatus,
  Template,
} from './data'

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
}

interface SessionRow {
  id: string
  club_id: string
  coach_id: string
  name: string
  focus: string | null
  date: string | null
  start_time: string | null
  venue: string | null
  age_group: string | null
  status: SessionStatus
  activities: ActivityRow[] | null
  created_at: string
}

// ---- Column lists ------------------------------------------------------
// Explicit so each read is checkable against the schema at a glance.
const DRILL_COLS =
  'id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, media_id, created_by, created_at'
const MEDIA_COLS =
  'id, club_id, name, type, kind, storage_path, yt_url, size, dims, length, pages, created_by, created_at'
const TEMPLATE_COLS = 'id, club_id, name, focus, author, activities, created_at'
const SESSION_COLS =
  'id, club_id, coach_id, name, focus, date, start_time, venue, age_group, status, activities, created_at'

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
  }
}

function toTemplate(r: TemplateRow): Template {
  return {
    id: r.id,
    name: r.name,
    author: r.author ?? '',
    focus: r.focus ?? '',
    activities: (r.activities ?? []).map(toActivity),
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
  }
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
            activities,
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
          activities,
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
