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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isCanonicalMediaPath } from './mediaPath'
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_SELECT_COLUMNS,
  activityQueryConditions,
  keysetOrFilter,
  nextCursor,
  type ActivityCursor,
  type ActivityEvent,
  type ActivityFilters,
} from './activityView'
import { useAuth } from '../hooks/useAuth'
import type { ExportFilterPayload, ExportPlayerRow } from './playersExport'
import { parseDeletePreview, type DeletePreview } from './playersBulk'
import type { ImportPayload, ImportServerResult } from './playersImportCommit'
import type {
  Activity,
  Capability,
  Club,
  CornerKey,
  ContentRights,
  Drill,
  FeedbackComment,
  FeedbackItem,
  FeedbackKind,
  FeedbackStatus,
  Level,
  MediaItem,
  MediaType,
  Member,
  Phase,
  Player,
  PlayerHistoryEntry,
  Programme,
  RegisteredPlayer,
  RegistrationStatus,
  Season,
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
import { nextPrimaryTeamId, primaryRoleKey, SHARE_CAPS, sortRoles, youtubeId } from './data'
import { isActivitySlot } from './activityStructure'
import type { ActivitySlot } from './activityStructure'
import { SESSION_SPOND_LINK_TAKEN_ERROR } from './sessionSubmit'
import { type EventKindContext, spondEventLookup } from './eventKind'
import { diagramSignature, parseDrillDiagram, serializeDrillDiagram, type DrillDiagram } from './drillDiagram'
import { countLinkedResponses, tonightUpsertBatches, type ResponseCounts, type TonightChange } from './tonight'
import type { Venue } from './venues'
import type { RegisterEntry } from './register'
import { buildRsvpByPlayer } from './spondRsvp'
import { isSpondMemberId } from './spondLinking'
import type { LinkCandidate, SpondGroupMember, SpondLink } from './spondLinking'
import type { Rsvp, RsvpLinkRow, RsvpResponseRow } from './spondRsvp'
import { EMPTY_SHARE_FILTERS, filtersToRequest } from './sharesView'
import type { ManagedShareKind, ManagedShareStatus, ShareFilters } from './sharesView'
import { newestFirst } from './contentOrder'
import { RIGHTS_REFUSED_MESSAGE, type RightsKind } from './contentRights'
import { readProvenance, type SharePreviewProvenance } from './shareBlockers'
import type { Board, Token } from './tacticsBoard'
import { deserializeTokens, serializeTokens } from './tacticsBoard'
import { sourceLabelForUrl } from './fa'
import { seasonDatePayload } from './seasonForm'
import { formatBytes } from './faAttach'
import type { AttachPlan } from './faAttach'
import { uploadFileWithProgress } from './storageUpload'
import type { UploadProgressFn } from './storageUpload'

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
  // Read for provenance only: an FA imported drill can carry its England
  // Football identity here with no source_url, and the sharing level control
  // must lock exactly what migration 0043 refuses.
  source_key: string | null
  rights: ContentRights
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
  rights: ContentRights
}

// The activities jsonb element. drill_id on the wire maps to drillId in the UI.
//
// `slot` and `skipped` are the same lowercase word on both sides, so there is
// no snake_case mapping to get wrong, exactly as `phase` and `duration`
// already are. Neither is constrained by the database: activities is
// unconstrained jsonb, so both mappers validate rather than cast, and a
// malformed value declares nothing.
export interface ActivityRow {
  phase: Phase
  duration: number
  drill_id?: string | null
  title?: string | null
  slot?: ActivitySlot
  skipped?: true
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
  rights: ContentRights
}

export interface ProgrammeRow {
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
  rights: ContentRights
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
  board_id: string | null
  rights: ContentRights
  venue_id: string | null
  // The coverage embed rides the session read, so a screen never has to
  // fetch coverage separately and can never render a stale set.
  session_teams?: { team_id: string }[] | null
}

interface TeamRow {
  id: string
  club_id: string
  name: string
  bib_colour: string | null
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
  'id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, media_id, created_by, created_at, setup_notes, easier, harder, theme, format, source_url, source_label, source_key, rights'
const MEDIA_COLS =
  'id, club_id, name, type, kind, storage_path, embed_url, yt_url, size, dims, length, pages, created_by, created_at, source_url, source_label, rights'
const TEMPLATE_COLS =
  'id, club_id, name, focus, author, activities, created_by, created_at, intentions, programme, week, programme_id, programme_week, source_url, source_label, rights'
const PROGRAMME_COLS =
  'id, club_id, name, focus, summary, intentions, weeks, pdf_media_id, source_url, source_label, created_by, created_at, rights'
// session_teams rides the session read as an embed, so coverage is always
// exactly as fresh as the row it belongs to.
const SESSION_COLS =
  'id, club_id, coach_id, team_id, name, focus, date, start_time, venue, age_group, status, activities, created_at, intentions, space, source_url, source_label, programme_id, programme_week, live_activity_index, live_activity_started_at, spond_event_id, board_id, rights, venue_id, session_teams(team_id)'
const TEAM_COLS = 'id, club_id, name, bib_colour, created_at'
// The role and team assignment sets ride the profiles read as embeds, so the
// Users screen and the owner labels share one query.
const PROFILE_COLS =
  'id, full_name, avatar, avatar_url, role, team_id, all_teams, created_at, member_roles(roles(id, key, label, system)), member_teams(team_id)'
const ROLE_COLS = 'id, club_id, key, label, system'
const CLUB_COLS = 'id, name, motto, crest_url'

// ---- Mappers -----------------------------------------------------------

// Both mappers rebuild field by field from an allow-list and DROP any key they
// do not name, so a key added to one and not the other is lost on the next
// save. They are shared and context free: the template read and the session
// read both call toActivity, and all three writes call toActivityRow, so a
// mapper cannot tell which side it is on and cannot make a key session local
// by itself. stripSessionLocalActivityKeys below is what does that.
//
// `slot` and `skipped` are VALIDATED rather than copied. activities is
// unconstrained jsonb, so a row can carry slot: 'Station', slot: 3 or
// skipped: 'yes'. Every one of those declares nothing and stands nothing
// down, which is the direction that fails towards running the drill.
export function toActivity(a: ActivityRow): Activity {
  const out: Activity = { phase: a.phase, duration: a.duration }
  if (a.drill_id != null) out.drillId = a.drill_id
  if (a.title != null) out.title = a.title
  if (isActivitySlot(a.slot)) out.slot = a.slot
  if (a.skipped === true) out.skipped = true
  return out
}

export function toActivityRow(a: Activity): ActivityRow {
  const out: ActivityRow = { phase: a.phase, duration: a.duration }
  if (a.drillId != null) out.drill_id = a.drillId
  if (a.title != null) out.title = a.title
  if (isActivitySlot(a.slot)) out.slot = a.slot
  // Only literal true is ever written. Restoring a station removes the key,
  // so each state has exactly one representation and no stored row says
  // skipped: false.
  if (a.skipped === true) out.skipped = true
  return out
}

// The activity keys that belong to ONE EVENING and never to a reusable plan.
// A list rather than a line of code, so the next session-local key joins it
// instead of growing a second code path.
export const SESSION_LOCAL_ACTIVITY_KEYS = ['skipped'] as const

// THE TEMPLATE BOUNDARY. One helper, applied at every point an activity
// crosses into or out of a template, because the shared mappers cannot tell
// which side they are on.
//
// It is applied at BOTH ends deliberately, and neither end depends on the
// other: the write paths strip the key so a template never stores it, and the
// read ignores it so a row that predates this helper, or one written by some
// future hand-rolled call, still behaves. A template somehow carrying
// `skipped` is read exactly as if it did not.
//
// `slot` is NOT stripped. Declaring which activities are the stations and
// which is the games phase belongs to the reusable plan, so a week plan
// carries it and every dated session built from that template inherits it.
//
// THERE IS A FOURTH TEMPLATE WRITE AND IT IS NOT IN THIS FILE.
// supabase/functions/_shared/fa.ts inserts an FA imported template straight
// into the table from Deno, which this helper structurally cannot reach. It
// is safe because it CONSTRUCTS its activities from drill ids rather than
// copying a session's, so no session-local key can arrive there; that is a
// property of the literal, and activityStructure.invariant.test.ts is what
// notices if the literal ever starts carrying one.
export function stripSessionLocalActivityKeys(row: ActivityRow): ActivityRow {
  // A jsonb element that is not an object carries no keys to strip, and is
  // handed back exactly as it arrived. Spreading it instead would turn null
  // into {}, and a string OR AN ARRAY into an index map, which would quietly
  // change what toActivity does with a malformed stored row. `typeof [] ===
  // 'object'`, so the array clause is the one this guard needs spelling out,
  // the same clause activityShape uses over the same jsonb in the Deno share
  // module. This helper strips keys; it is not the place a shape problem is
  // discovered or repaired.
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const out: ActivityRow = { ...row }
  for (const key of SESSION_LOCAL_ACTIVITY_KEYS) delete out[key]
  return out
}

// The template's activities, in either direction: rows on the way in from the
// database, rows on the way out to it. Named so a call site reads as what it
// is rather than as a map of a map.
export function toTemplateActivityRows(activities: readonly ActivityRow[] | null | undefined): ActivityRow[] {
  return (activities ?? []).map(stripSessionLocalActivityKeys)
}

// Of the imported drills tied to a programme or template being deleted, which
// to remove and which to keep. The locked rule (issue #91, part 2): a drill a
// session still references is kept and detached from the deleted source, never
// removed, so a coach's planned session does not lose a drill; only a drill no
// session uses is removed. usedDrillIds is every drill id referenced by a
// session activity, club wide. Pure so the decision is unit testable on its
// own, away from the Supabase round trips that feed it.
export function partitionDrillsByUsage(
  candidateIds: string[],
  usedDrillIds: Set<string>,
): { toDelete: string[]; toKeep: string[] } {
  const toDelete: string[] = []
  const toKeep: string[] = []
  for (const id of candidateIds) {
    if (usedDrillIds.has(id)) toKeep.push(id)
    else toDelete.push(id)
  }
  return { toDelete, toKeep }
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
    sourceKey: r.source_key ?? '',
    // Fail closed: a read that predates the column, or a row the select could
    // not resolve, presents as club only rather than as publishable.
    rights: r.rights ?? 'internal_only',
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
    rights: r.rights ?? 'internal_only',
    createdAt: r.created_at,
  }
}

function toTemplate(r: TemplateRow): Template {
  return {
    id: r.id,
    name: r.name,
    author: r.author ?? '',
    focus: r.focus ?? '',
    createdBy: r.created_by ?? undefined,
    // Through the template boundary on the way out too, so a row that somehow
    // carries a session-local key is read as if it did not.
    activities: toTemplateActivityRows(r.activities).map(toActivity),
    intentions: r.intentions ?? [],
    programme: r.programme ?? '',
    week: r.week,
    programmeId: r.programme_id,
    programmeWeek: r.programme_week,
    sourceUrl: r.source_url ?? '',
    sourceLabel: r.source_label ?? '',
    rights: r.rights ?? 'internal_only',
    createdAt: r.created_at,
  }
}

export function toProgramme(r: ProgrammeRow): Programme {
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
    rights: r.rights ?? 'internal_only',
    createdAt: r.created_at,
  }
}

// The whole transformation useProgrammes applies to the rows a read returns,
// exported so the ordering regression test exercises exactly what the hook
// does.
export function toProgrammeList(rows: ProgrammeRow[]): Programme[] {
  return newestFirst(rows.map(toProgramme))
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
    boardId: r.board_id ?? null,
    venueId: r.venue_id ?? null,
    // The EFFECTIVE coverage, normalised here at the read boundary so every
    // consumer sees one answer: the session_teams rows, or the frozen
    // team_id for a session saved before coverage existed, or nothing.
    //
    // Normalising here rather than in each screen is what lets a save clear
    // team_id safely. Without it, an empty set reaching the write path could
    // mean either "a coach cleared coverage" or "this session is legacy and
    // nobody looked at its coverage", and retiring team_id would silently
    // destroy the second one. After this, empty means empty.
    //
    // Sorted so the covered set is a stable value: two reads of the same
    // coverage compare equal whatever order PostgREST returned the rows.
    teamIds: (() => {
      const rows = [...new Set((r.session_teams ?? []).map((t) => t.team_id))].sort()
      if (rows.length > 0) return rows
      return r.team_id ? [r.team_id] : []
    })(),
    rights: r.rights ?? 'internal_only',
  }
}

function toTeam(r: TeamRow): Team {
  return { id: r.id, name: r.name, bibColour: r.bib_colour ?? null }
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

// The content list reads return newest first. The order is asked of the
// database and then re-applied client side (src/lib/contentOrder.ts), so no
// consumer depends on the order the wire happened to return. A caller that
// needs creation order (the FA attach fallback, a programme week's earliest
// template) re-sorts locally with oldestFirst.
export function useDrills() {
  return useQuery({
    queryKey: ['drills'],
    queryFn: async (): Promise<Drill[]> => {
      const { data, error } = await supabase
        .from('drills')
        .select(DRILL_COLS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (error) throw error
      return newestFirst((data as unknown as DrillRow[]).map(toDrill))
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
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (error) throw error
      return newestFirst((data as unknown as MediaRow[]).map(toMedia))
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
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (error) throw error
      return newestFirst((data as unknown as TemplateRow[]).map(toTemplate))
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
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (error) throw error
      return toProgrammeList(data as unknown as ProgrammeRow[])
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

// The signed in member's team scope: the specific teams they belong to
// (member_teams) plus the durable all teams flag on their profile. Teams gate
// no row level security, so this only narrows a view; the parent dashboard
// uses it to focus club wide content on the member's team(s). Both reads ride
// existing policies open to every club member: the member_teams club select
// and the profiles club select.
export interface MyTeams {
  teamIds: string[]
  allTeams: boolean
}

export function useMyTeams() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my_teams', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MyTeams> => {
      const [profileRes, teamsRes] = await Promise.all([
        supabase.from('profiles').select('all_teams').eq('id', user!.id).maybeSingle(),
        supabase.from('member_teams').select('team_id').eq('member_id', user!.id),
      ])
      if (profileRes.error) throw profileRes.error
      if (teamsRes.error) throw teamsRes.error
      return {
        allTeams: (profileRes.data as { all_teams: boolean } | null)?.all_teams ?? false,
        teamIds: (teamsRes.data ?? []).map((r: { team_id: string }) => r.team_id),
      }
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

// The per file upload ceiling. Raised to 500 MB on the Supabase Pro plan so
// self hosted FA session videos fit inline playback, up from the 300 MB that
// suited the old Free plan. This single constant is the one frontend source
// of truth: every client side size check derives from it, so the checks
// cannot drift apart. config.toml and the hosted project's storage limits
// must carry the same value, or the server rejects what the client allows.
// Checked before any bytes move, so an oversized pick fails at once with a
// plain message instead of a storage error at the end of a long upload.
export const MEDIA_MAX_BYTES = 500 * 1024 * 1024

export function oversizeMessage(file: File): string | null {
  if (file.size <= MEDIA_MAX_BYTES) return null
  return `That file is ${formatBytes(file.size)} and the upload limit is ${formatBytes(MEDIA_MAX_BYTES)}. Compress the file or trim the clip and try again.`
}

// A storage key safe filename: keep word characters, dots and hyphens, collapse
// the rest. The {club_id}/{uuid}- prefix guarantees uniqueness regardless.
// Builds the canonical storage key for a club's own object and refuses to
// return one the database CHECK constraint (media_storage_path_canonical,
// 0042) would reject. Called before the object is written, so a path that
// could never be stored does not leave an orphaned object in the bucket.
// Avatars deliberately do not come through here: they live at
// avatars/{user_id}/... , outside any club prefix, and carry no media row.
function mediaStoragePath(clubId: string, filename: string, folder?: string): string {
  const name = `${crypto.randomUUID()}-${sanitiseFilename(filename)}`
  const path = folder ? `${clubId}/${folder}/${name}` : `${clubId}/${name}`
  if (!isCanonicalMediaPath(path, clubId)) {
    throw new Error('That file name cannot be stored safely. Rename the file and try again.')
  }
  return path
}

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

// onProgress reports real upload bytes for a file upload so the UI can show a
// progress bar; it never fires for a YouTube link, which moves no bytes.
export type UploadArgs = { input: UploadInput; onProgress?: UploadProgressFn }

// Creates a library media row from a file upload or a YouTube link. The
// mutation resolves to the new row's id so a caller can link it at once; the
// drill form's inline creator sets it as the drill's media.
export function useUploadMedia() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation<string, Error, UploadArgs>({
    mutationFn: async ({ input, onProgress }) => {
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
      const path = mediaStoragePath(clubId, file.name)
      const { error: uploadError } = await uploadFileWithProgress('media', path, file, { onProgress })
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

  return useMutation<void, Error, { id: string; previousPath?: string | null; input: UploadInput; onProgress?: UploadProgressFn }>({
    mutationFn: async ({ id, previousPath, input, onProgress }) => {
      if (!profile?.club_id) {
        throw new Error('You must be signed in to replace media.')
      }
      const clubId = profile.club_id

      const applyUpdate = async (patch: Record<string, unknown>) => {
        const { data, error } = await supabase.from('media').update(patch).eq('id', id).select('id')
        if (error) {
          // An England Football refusal (0043) reads as itself; anything else
          // keeps the existing wording.
          if ((error as { code?: string }).code === '42501') throw contentWriteError(error)
          throw new Error(`Could not update the media record: ${error.message}`)
        }
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

        const path = mediaStoragePath(clubId, file.name)
        const { error: uploadError } = await uploadFileWithProgress('media', path, file, { onProgress })
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
    {
      plan: AttachPlan<File>
      onProgress?: (done: number, total: number) => void
      onBytes?: (p: { name: string; loaded: number; total: number }) => void
    }
  >({
    mutationFn: async ({ plan, onProgress, onBytes }) => {
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
        const path = mediaStoragePath(clubId, file.name)
        const { error: uploadError } = await uploadFileWithProgress('media', path, file, {
          onProgress: (loaded, total) => onBytes?.({ name: file.name, loaded, total }),
        })
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
// Migration 0043 refuses two writes on England Football derived content: raising
// its sharing level, and clearing its recorded source. Both arrive as 42501.
// Every content write can trip them now (pasting an England Football link into
// the Source field of a row that is already public, or clearing that field on an
// imported row), so each one translates the refusal into the sentence the locked
// control shows plus the hint that says which field to change. Without this the
// coach sees the raw database message and no way to act on it.
export function contentWriteError(error: unknown): Error {
  const e = error as { code?: string; message?: string; hint?: string } | null
  if (e && e.code === '42501' && e.message) {
    return new Error(e.hint ? `${e.message} ${e.hint}` : e.message)
  }
  return error instanceof Error ? error : new Error('Something went wrong. Try again.')
}

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
      if (error) throw contentWriteError(error)
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
      if (error) throw contentWriteError(error)
      return toDrill(data as unknown as DrillRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['drills'] }),
  })
}

// ---- Drill diagram (Drill Maker C1) --------------------------------------
//
// The diagram is read and written on its OWN, never as part of a drill row.
// Three things follow from that, all deliberate:
//
//   1. DRILL_COLS does not gain `diagram`, so the library list, the planner,
//      the share snapshot builders and every other drill read carry exactly
//      what they carried before. A diagram cannot leak through a path that was
//      never told about it, and the list payload does not grow.
//   2. The save sends ONE column. A coach with an editor open holds a drill
//      that another coach may have renamed since; a whole-row update would put
//      the stale title back. This one cannot, whatever it is holding.
//   3. Nothing new is granted. The write rides the existing drills UPDATE
//      policy (owner holding drills.create, or drills.manage), which already
//      covers every column, so there is no new boundary to get wrong.
export const DRILL_DIAGRAM_COLS = 'id, diagram'

// The complete payload a diagram save sends. One key, by construction.
export function drillDiagramWriteRow(diagram: DrillDiagram): { diagram: unknown } {
  return { diagram: serializeDrillDiagram(diagram) }
}

// Whether the database is holding the diagram that was sent to it. A request
// that returned is not a save: the row that came back has to be the same
// diagram, field for field, in the canonical form. A stored value that will not
// parse, or that parses to something else, is not a match.
export function diagramSaveMatches(submitted: DrillDiagram, stored: unknown): boolean {
  const back = parseDrillDiagram(stored)
  return back !== null && diagramSignature(back) === diagramSignature(submitted)
}

// The write itself, pulled out of the hook so the payload, the filter and the
// readback comparison are testable against a recording client (see
// drillDiagramSave.test.ts). Returns what the database now holds, and whether
// it is what was asked for.
export async function saveDrillDiagram(
  id: string,
  diagram: DrillDiagram,
): Promise<{ diagram: DrillDiagram | null; matched: boolean }> {
  const { data, error } = await supabase
    .from('drills')
    .update(drillDiagramWriteRow(diagram))
    .eq('id', id)
    .select(DRILL_DIAGRAM_COLS)
    .maybeSingle()
  if (error) throw contentWriteError(error)
  // Row level security refusing the update returns no row and no error.
  // Reporting that as saved would be a false statement about a coach's work.
  if (!data) throw new Error('You do not have permission to change this drill.')
  const stored = (data as { diagram: unknown }).diagram
  return { diagram: parseDrillDiagram(stored), matched: diagramSaveMatches(diagram, stored) }
}

// How long a read diagram counts as fresh. FIVE MINUTES, and the number matters
// less than the fact that it is not zero.
//
// A diagram changes when a coach presses Save in Drill Maker, and that save
// invalidates this key explicitly (useUpdateDrillDiagram below). Nothing else
// changes it, so there is no reason for a screen that merely SHOWS one to go
// back to the database every time it mounts. With no staleTime TanStack marks
// the result stale the instant it arrives, and every remount is a mount of a
// stale query, so it refetches: collapsing and reopening a planner panel
// repeated the read, and leaving Session Day's Setup tab and coming back
// remounted every card and repeated one read PER DRILL. A session of eight
// drills paid eight requests for a tab change that showed the same pictures.
//
// This does NOT weaken the save. invalidateQueries marks the query invalidated
// as well as stale, and an invalidated query refetches on mount and on the spot
// for anything already watching it, whatever the staleTime says. So a coach who
// saves a diagram and walks back into the session still sees the new drawing
// immediately; what stops is the traffic that changed nothing.
export const DRILL_DIAGRAM_STALE = 5 * 60 * 1000

// The drill's diagram, read on its own. Separate from useDrill so the diagram
// never rides a list read.
//
// The options are a named value rather than an object literal inline, so the
// remount behaviour above can be proved against the REAL options a screen uses
// rather than against a retyped copy of them (drillDiagramRemount.test.ts).
export function drillDiagramQuery(id: string | undefined) {
  return {
    queryKey: ['drill_diagram', id] as const,
    enabled: !!id,
    // No retry. This read fires on EVERY drill page for every role, parents
    // included, and the one failure mode worth naming is the column not being
    // there yet (migration 0046 unapplied), which no number of retries will
    // fix. Four rejected requests per page view is noise nobody can act on.
    retry: false as const,
    staleTime: DRILL_DIAGRAM_STALE,
    queryFn: async (): Promise<DrillDiagram | null> => {
      const { data, error } = await supabase.from('drills').select(DRILL_DIAGRAM_COLS).eq('id', id!).maybeSingle()
      if (error) throw error
      // A stored value that will not parse reads as no diagram, so a hand
      // edited or future shaped row shows the empty state rather than
      // crashing the drill page.
      return data ? parseDrillDiagram((data as { diagram: unknown }).diagram) : null
    },
  }
}

export function useDrillDiagram(id: string | undefined) {
  return useQuery(drillDiagramQuery(id))
}

export function useUpdateDrillDiagram() {
  const qc = useQueryClient()
  return useMutation<{ diagram: DrillDiagram | null; matched: boolean }, Error, { id: string; diagram: DrillDiagram }>({
    mutationFn: ({ id, diagram }) => saveDrillDiagram(id, diagram),
    onSettled: (_data, _err, vars) => qc.invalidateQueries({ queryKey: ['drill_diagram', vars.id] }),
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
    // Both the insert and the update go through here, so the template
    // boundary is crossed once for the two of them. `slot` survives; the
    // session-local keys do not.
    activities: toTemplateActivityRows(input.activities.map(toActivityRow)),
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
      if (error) throw contentWriteError(error)
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
      if (error) throw contentWriteError(error)
      return toTemplate(data as unknown as TemplateRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

// Every drill id any club session references, read once so a source delete can
// tell which of its imported drills are still in use. Visibility is club wide,
// so this reads every session's activities; RLS scopes it to the club. A failed
// read returns an empty set, which keeps the delete cautious: nothing counts as
// used, so the cascade would remove an imported drill it could not prove is in
// a session. To stay on the safe side a read error instead leaves every
// candidate untouched, handled by the caller treating a thrown read as "keep
// all".
async function fetchUsedDrillIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('sessions').select('activities')
  if (error) throw error
  const used = new Set<string>()
  for (const row of (data ?? []) as { activities: ActivityRow[] | null }[]) {
    for (const a of row.activities ?? []) {
      if (a.drill_id) used.add(a.drill_id)
    }
  }
  return used
}

// Remove the imported drills a deleted source brought into the library, except
// any a session still uses (issue #91, part 2). The candidates are the FA
// imported drills tied to the source; a drill in use is kept and detached (the
// source row's delete nulls its link, or for a template its source_url simply
// stays as attribution), a drill no session references is removed. Best effort
// by design: the drills delete runs under RLS, so a coach removes only drills
// they own (an admin any), and a blocked row is left rather than erroring; if
// the session read fails every candidate is kept. This never throws, so a
// problem here cannot block the source delete that follows it.
async function deleteUnusedImportedDrills(candidateIds: string[]): Promise<void> {
  if (candidateIds.length === 0) return
  let used: Set<string>
  try {
    used = await fetchUsedDrillIds()
  } catch {
    // Could not confirm usage: keep every candidate rather than risk removing
    // a drill a session needs.
    return
  }
  const { toDelete } = partitionDrillsByUsage(candidateIds, used)
  if (toDelete.length === 0) return
  await supabase.from('drills').delete().in('id', toDelete)
}

// Sessions built from a template copy its activities, so deleting the
// template leaves them untouched. A template serving as a programme week
// leaves that week empty, which the programme page shows as unassigned.
// Deleting an FA imported template also removes the library drills that import
// brought in (matched by the shared source_url), except any a session still
// uses, which are kept (issue #91). A hand made template carries no source_url
// and so removes no drills.
export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; sourceUrl?: string }>({
    mutationFn: async ({ id, sourceUrl }) => {
      if (sourceUrl) {
        const { data } = await supabase
          .from('drills')
          .select('id')
          .eq('source_url', sourceUrl)
          .not('source_key', 'is', null)
        await deleteUnusedImportedDrills((data ?? []).map((d) => d.id as string))
      }
      const { error } = await supabase.from('templates').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
    },
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
      if (error) throw contentWriteError(error)
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
      if (error) throw contentWriteError(error)
      return toProgramme(data as unknown as ProgrammeRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['programmes'] }),
  })
}

// Owner or admin only; the programmes delete RLS is the real enforcement.
// Deleting a programme leaves its templates and sessions intact: the foreign
// keys null out in Postgres, so those caches refetch too. It also removes the
// library drills the import brought in (tied to the programme by
// source_programme_id), except any a session still uses, which are kept and
// detached by the programme row's on delete set null (issue #91). The drills
// are read and the unused ones removed before the programme is deleted, so the
// link is still there to find them by.
export function useDeleteProgramme() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data } = await supabase.from('drills').select('id').eq('source_programme_id', id)
      await deleteUnusedImportedDrills((data ?? []).map((d) => d.id as string))
      const { error } = await supabase.from('programmes').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['programmes'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['drills'] })
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
        // The third template write path, and the one a reader misses: a
        // programme week copy is an insert of its own rather than a call to
        // toTemplateWriteRow, so it crosses the boundary explicitly.
        activities: toTemplateActivityRows(template.activities.map(toActivityRow)),
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

// The optimistic cache pieces, kept pure so the rollback rules are testable.
// applySessionUpsert writes one session into the list; revertSessionUpsert
// undoes exactly that one entry (removing an inserted row, restoring an
// updated one) and leaves every other session alone, so rolling back one
// failed write cannot wipe another session's newer optimistic entry.

// Whether either cache already holds the row: the hint useUpsertSession uses to
// prefer the update fast path. The per-id cache (oneEntry) matters because the
// planner loads an existing session through useSession, keyed by id, even when
// the sessions list has not loaded, so an edit before the list arrives no
// longer misfires as an insert. It is only a hint; the server stays the
// authority through upsertSessionWrite's duplicate-key recovery.
export function sessionExistsInCache(listEntry: Session | undefined, oneEntry: Session | undefined): boolean {
  return listEntry !== undefined || oneEntry !== undefined
}

export function applySessionUpsert(list: Session[] | undefined, s: Session): Session[] {
  const l = list ?? []
  const i = l.findIndex((x) => x.id === s.id)
  if (i === -1) return [...l, s]
  const copy = [...l]
  copy[i] = s
  return copy
}

export function revertSessionUpsert(
  list: Session[] | undefined,
  prevEntry: Session | undefined,
  id: string,
): Session[] | undefined {
  if (!list) return list
  if (!prevEntry) return list.filter((s) => s.id !== id)
  return list.map((s) => (s.id === id ? prevEntry : s))
}

// Tracks the newest write attempt per session id, so an older attempt that
// fails after a newer one has already run cannot roll the cache back over the
// newer state. The UI serialises submissions per flow, but the cache layer
// does not rely on that.
export function createAttemptTracker() {
  let seq = 0
  const latest = new Map<string, number>()
  return {
    begin(id: string): number {
      const attempt = ++seq
      latest.set(id, attempt)
      return attempt
    },
    isLatest(id: string, attempt: number): boolean {
      return latest.get(id) === attempt
    },
    end(id: string, attempt: number): void {
      if (latest.get(id) === attempt) latest.delete(id)
    },
  }
}

// A Postgres unique_violation, surfaced by PostgREST as code 23505. On the
// sessions insert it means the primary key already exists: a prior attempt
// committed even though its response was lost, or the row already existed.
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

// The unique index migration 0048 adds: at most one Hub session per mirrored
// Spond event. Named here because the client recognises the refusal by name,
// and a rename that quietly stopped matching would turn a clear sentence back
// into an opaque database error.
export const SPOND_LINK_UNIQUE_INDEX = 'sessions_spond_event_id_unique'

// The write was refused because ANOTHER session already links this Spond
// event. 23505 alone cannot say that: a duplicate PRIMARY KEY carries the
// same code and means something entirely different (a retry whose first
// attempt committed), and recovering THAT into an update is exactly right
// while recovering this one is exactly wrong. So the constraint is
// identified, not just the class of error.
//
// PostgREST names the index in `message` ("duplicate key value violates
// unique constraint ...") and the offending column in `details` ("Key
// (spond_event_id)=(...) already exists."). Both are read: `details` is
// omitted on some deployments, and matching the column as well as the index
// name means renaming the index degrades to the right answer rather than to
// silence.
export function isSpondLinkTaken(err: unknown): boolean {
  if (!isUniqueViolation(err)) return false
  const e = err as { message?: unknown; details?: unknown }
  const text = [e.message, e.details].filter((v) => typeof v === 'string').join(' ')
  return text.includes(SPOND_LINK_UNIQUE_INDEX) || text.includes('spond_event_id')
}

// The refusal, as an Error the surfaces can recognise after the raw
// PostgREST object has been translated. A class rather than a flag on a
// plain Error because `instanceof` survives being thrown through the guarded
// submit seam, where the raw code does not: contentWriteError below returns a
// fresh Error for anything that is not an FA rights refusal, which drops the
// code.
export class SpondLinkTakenError extends Error {
  constructor() {
    super(SESSION_SPOND_LINK_TAKEN_ERROR)
    this.name = 'SpondLinkTakenError'
  }
}

// Every sessions write goes through this rather than contentWriteError
// directly, so the one refusal a coach can act on keeps its meaning and
// everything else behaves exactly as it did.
export function sessionWriteError(error: unknown): Error {
  if (isSpondLinkTaken(error)) return new SpondLinkTakenError()
  return contentWriteError(error)
}

// The server-safe insert-versus-update decision, kept pure so its idempotency
// is provable without a database. The cache is only a hint for the fast path;
// the server is the authority on whether a row exists:
//
// - A known-existing row updates directly (updates are naturally idempotent).
// - Otherwise it inserts. If the insert collides on the primary key, a prior
//   attempt's insert committed but its response was lost (or the row already
//   existed under a stale or absent cache), so it recovers into an update of
//   the same id. A retry then resolves to the existing row rather than
//   duplicating it or sticking on the duplicate key.
//
// The update never sends coach_id or club_id (the callers below build it that
// way), so recovery cannot change ownership or club, and an unauthorised
// recovery updates no rows and surfaces its error, failing closed.
export async function upsertSessionWrite(opts: {
  exists: boolean
  insert: () => Promise<Session>
  update: () => Promise<Session>
  isUniqueViolation: (err: unknown) => boolean
  // The one duplicate key that must NEVER recover into an update. A refused
  // Spond link (0048) means ANOTHER session already holds the event, so there
  // is no row of this id to update: recovering would report "no rows" and
  // bury the one fact the coach needs. Optional so the pure function keeps
  // its old behaviour for callers that do not write a Spond link.
  isLinkConflict?: (err: unknown) => boolean
}): Promise<Session> {
  if (opts.exists) return opts.update()
  try {
    return await opts.insert()
  } catch (err) {
    if (opts.isLinkConflict?.(err)) throw err
    if (opts.isUniqueViolation(err)) return opts.update()
    throw err
  }
}

interface UpsertCtx {
  prevEntry?: Session
  prevOne?: Session
  attempt: number
}

// The editable session columns for an insert or an update, as one pure
// value so the FROZEN column rules are testable rather than argued about.
//
// Neither the update path nor the duplicate-key recovery sends coach_id or
// club_id, so a save never changes ownership or club; only the insert sets
// them, from the signed-in user.
//
// The two FROZEN columns (0044) are the reason this is worth extracting. New
// code never writes a VALUE to either; it retires them, so the read fallback
// behind each cannot resurrect and contradict the real field.
//
//   team_id  NOT touched here. Coverage lives in session_teams, and retiring
//            the frozen team before those rows exist would destroy a legacy
//            session's only record of its team if the coverage write then
//            failed. retireLegacySessionTeam runs after reconcile succeeds.
//   venue    cleared only when a real venue is chosen, so a session saved
//            before venues existed keeps its typed label until someone
//            positively replaces it. Never written with a value, so a new
//            session cannot claim to be somewhere nobody chose.
export function toSessionWriteRow(input: Session): Record<string, unknown> {
  return {
    name: input.name,
    focus: input.focus,
    date: input.date || null,
    start_time: input.time,
    age_group: input.ageGroup,
    status: input.status,
    venue_id: input.venueId,
    ...(input.venueId ? { venue: null } : {}),
    activities: input.activities.map(toActivityRow),
    intentions: input.intentions,
    space: input.space || null,
    ...toSourceFields(input.sourceUrl),
    // The programme link travels with the session on insert and update, so
    // applying a programme tags the rows and a planner edit keeps them.
    programme_id: input.programmeId,
    programme_week: input.programmeWeek,
    // The Spond event link travels the same way: linking in the planner
    // edits the draft and saving writes it here.
    spond_event_id: input.spondEventId,
    // The attached tactics board, set in the planner draft or on the session
    // day, travels with the session on insert and update.
    board_id: input.boardId,
  }
}

export function useUpsertSession() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  // existed records whether each id was already present before the optimistic
  // cache write, so the mutation can choose insert versus update without
  // re-reading the cache that onMutate has just changed.
  const existed = useRef(new Map<string, boolean>())
  // attempts guards the rollback: only the newest attempt per id may revert
  // the optimistic entry, so an older failure cannot undo a newer success.
  const attempts = useRef(createAttemptTracker())

  return useMutation<Session, Error, Session, UpsertCtx>({
    mutationFn: async (input) => {
      const editable = toSessionWriteRow(input)

      const update = async (): Promise<Session> => {
        const { data, error } = await supabase
          .from('sessions')
          .update(editable)
          .eq('id', input.id)
          .select(SESSION_COLS)
          .single()
        if (error) throw sessionWriteError(error)
        return toSession(data as unknown as SessionRow)
      }

      const insert = async (): Promise<Session> => {
        if (!user || !profile?.club_id) {
          throw new Error('You must be signed in to save a session.')
        }
        const { data, error } = await supabase
          .from('sessions')
          .insert({ id: input.id, coach_id: user.id, club_id: profile.club_id, ...editable })
          .select(SESSION_COLS)
          .single()
        if (error) throw sessionWriteError(error)
        return toSession(data as unknown as SessionRow)
      }

      // exists is a cache-derived hint for the fast path only; the server is
      // the authority through the duplicate-key recovery inside
      // upsertSessionWrite.
      const saved = await upsertSessionWrite({
        exists: existed.current.get(input.id) ?? false,
        insert,
        update,
        isUniqueViolation,
        // A refused Spond link is a duplicate key that recovery must not
        // touch. Both write closures translate it to SpondLinkTakenError
        // above, so the test is on the translated error rather than on a
        // code that no longer survives the wrapping.
        isLinkConflict: (err) => err instanceof SpondLinkTakenError,
      })
      const teamIds = await reconcileSessionTeams(saved.id, input.teamIds, profile?.club_id ?? null)
      // Only now, with coverage recorded, is the frozen column safe to clear.
      // Only a legacy row still carries one, so this fires once per session
      // ever, never on a session created since 0044.
      if (saved.teamId) await retireLegacySessionTeam(saved.id)
      return { ...saved, teamId: null, teamIds }
    },
    // Optimistic and synchronous: the list and the per-id cache are both
    // seeded, so a screen arriving by session id straight after a successful
    // save (the live view after Start) renders at once instead of waiting for
    // the settled invalidation refetch. Navigation itself waits for the write
    // through the guarded submit seam.
    onMutate: (input) => {
      const list = qc.getQueryData<Session[]>(['sessions'])
      const prevEntry = list?.find((s) => s.id === input.id)
      const prevOne = qc.getQueryData<Session>(['sessions', input.id])
      // Prefer the update fast path when either cache already holds the row.
      // When both are absent the write still self-corrects: an insert that
      // collides recovers into an update (see upsertSessionWrite).
      existed.current.set(input.id, sessionExistsInCache(prevEntry, prevOne))
      const attempt = attempts.current.begin(input.id)
      qc.setQueryData<Session[]>(['sessions'], (old) => applySessionUpsert(old, input))
      qc.setQueryData<Session>(['sessions', input.id], input)
      return { prevEntry, prevOne, attempt }
    },
    onError: (_err, input, ctx) => {
      // Roll back only this session's entry, and only while this attempt is
      // still the newest for the id: restoring an older snapshot after a newer
      // attempt has run would overwrite the newer state. The settled
      // invalidation refetches the server truth either way, which also covers
      // the pathological overlap this snapshot cannot: two concurrent
      // attempts for the same id both failing leaves the first attempt's
      // optimistic entry until that refetch lands.
      if (!ctx || !attempts.current.isLatest(input.id, ctx.attempt)) return
      qc.setQueryData<Session[]>(['sessions'], (old) => revertSessionUpsert(old, ctx.prevEntry, input.id))
      // A failed insert has no previous per-id value, and setQueryData with
      // undefined is a no-op, so drop the optimistic entry instead: nothing
      // may keep serving a session the database refused.
      if (ctx.prevOne === undefined) qc.removeQueries({ queryKey: ['sessions', input.id], exact: true })
      else qc.setQueryData(['sessions', input.id], ctx.prevOne)
    },
    onSettled: (_data, _err, input, ctx) => {
      existed.current.delete(input.id)
      if (ctx) attempts.current.end(input.id, ctx.attempt)
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

// Bring a session's covered teams to exactly the set the caller asked for.
//
// The desired set is taken literally, empty included: a coach who clears
// every team means it, and the register then says the session has no teams
// rather than quietly listing the whole club. Whatever default a new
// session starts from is chosen in the planner, where the coach can see it
// before saving.
//
// currentIds must be server truth (the row read back by the write), not a
// cache: a stale cache that had not yet seen the coverage rows would leave
// real rows behind that this diff never removes.
export async function reconcileSessionTeams(
  sessionId: string,
  desiredIds: string[],
  clubId: string | null,
): Promise<string[]> {
  const desired = [...new Set(desiredIds)].sort()
  // The CURRENT set is read here rather than taken from the caller, and it is
  // the rows themselves, never the normalised coverage. A caller passing the
  // normalised set would hide the case this diff exists to handle: a legacy
  // session reads as covering its frozen team while having no row at all, so
  // the diff would find nothing to add and the row would never be written.
  const { data: rows, error: readError } = await supabase
    .from('session_teams')
    .select('team_id')
    .eq('session_id', sessionId)
  if (readError) throw readError
  const currentIds = [...new Set((rows as { team_id: string }[]).map((r) => r.team_id))]
  const toAdd = desired.filter((id) => !currentIds.includes(id))
  const toRemove = currentIds.filter((id) => !desired.includes(id))
  if (toAdd.length > 0) {
    if (!clubId) throw new Error('You must be signed in to save a session.')
    const { error } = await supabase
      .from('session_teams')
      .upsert(
        toAdd.map((team_id) => ({ session_id: sessionId, team_id, club_id: clubId })),
        { onConflict: 'session_id,team_id', ignoreDuplicates: true },
      )
    if (error) throw error
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('session_teams')
      .delete()
      .eq('session_id', sessionId)
      .in('team_id', toRemove)
    if (error) throw error
  }
  return desired
}

// Retire a legacy session's frozen team_id, once, AFTER its replacement
// coverage rows are recorded. Splitting it from the main write is what makes
// the transition safe without a transaction across two tables: if this fails,
// the session simply keeps both, coverage rows win on read, and the next save
// retires it. If it ran first and the coverage write then failed, a legacy
// session would be left with no record of its team at all.
export async function retireLegacySessionTeam(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({ team_id: null }).eq('id', sessionId)
  if (error) throw error
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
  location: string | null
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
//
// `location` joins the event facts here. It is a column the sync has written
// since 0013 and the table has no member or payload column to reach by
// accident, so this widens the read by one FACT ABOUT THE EVENT and by
// nothing about a person. It is what a new session's venue defaults from.
const SPOND_MAPPING_COLS = 'id, spond_group_id, spond_subgroup_id, spond_name, team_id, created_at, teams(name)'
const SPOND_EVENT_COLS =
  'id, title, starts_at, location, team_id, spond_type, accepted_count, declined_count, unanswered_count, waiting_count, cancelled, synced_at, teams(name)'

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
    location: r.location,
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
export function useSpondEvents(enabled = true) {
  return useQuery({
    enabled,
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

// Everything the training classifier needs beyond the row it is handed,
// as ONE hook, because a screen that wires half the context reads exactly
// like a screen that wired all of it.
//
// The two facts, and the job each does:
//
//   spondEvents  the synced events indexed by id, for classifying a
//                SESSION planned from a Spond event. A session row cannot
//                carry spond_type, so the link is resolved through this.
//   teamNames    the club's own team names, so an opponent-versus-team
//                fixture title ("TROJANS – Rastrick") is recognised as a
//                fixture rather than read as training.
//
// Both ride queries the screens already hold, so this costs no extra read
// on a screen that lists sessions; `enabled` is false for members who
// never filter by event kind. Teams are read unconditionally because the
// teams query is club wide, tiny and already cached everywhere.
export function useEventKindContext(enabled = true): EventKindContext {
  const { data: events } = useSpondEvents(enabled)
  const { data: teams } = useTeams()
  const spondEvents = useMemo(() => spondEventLookup(events ?? []), [events])
  const teamNames = useMemo(() => (teams ?? []).map((t) => t.name), [teams])
  return useMemo(() => ({ spondEvents, teamNames }), [spondEvents, teamNames])
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['spond_events'] })
      // The replies too. Every screen that shows a child's answer reads
      // spondRsvpKey, so a sync that refreshed only the event row left the
      // chips, the counts and every pill exactly as they were: a refresh
      // that visibly did nothing.
      void qc.invalidateQueries({ queryKey: ['spond_rsvp'] })
    },
  })
}

// Refetch what the club has actually planned: the sessions list and the synced
// events beside it.
//
// It exists as a named hook rather than a useQueryClient call inside a screen
// because the thing being refreshed is a fact ("which Spond events already
// have a session"), not a cache detail, and because every other invalidation
// in the product lives in this file. Plan from Spond calls it when the
// database refuses a duplicate link: the losing coach's list then catches up
// with the coach who won the race, and the event stops being suggested.
export function useRefreshSpondPlanning(): () => void {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['sessions'] })
    void qc.invalidateQueries({ queryKey: ['spond_events'] })
  }, [qc])
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
      // sessionWriteError, not the raw error: since 0048 this update can be
      // refused because another session already links the chosen event, and
      // "duplicate key value violates unique constraint" is not a sentence to
      // put in front of a coach. Every other failure is passed through
      // unchanged.
      if (error) throw sessionWriteError(error)
      if (!data?.length) throw new Error('Only the session owner or an admin can change its Spond link.')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      // The register's RSVP context is keyed by event, so changing which
      // event a session points at already reads a different entry. Drop
      // the old one rather than leaving it to gcTime.
      qc.invalidateQueries({ queryKey: ['spond_rsvp'] })
    },
  })
}

// Attaches a saved board to a session, or detaches it when boardId is null.
// Used on the session day, where the change writes at once (unlike the
// planner draft, which carries board_id through the upsert). The sessions
// update RLS (owner, or admin) is the real enforcement; a blocked write
// updates no rows and is reported. Both the list and the per-id cache are
// invalidated so the embedded board appears or clears without a manual reload.
export function useLinkSessionBoard() {
  const qc = useQueryClient()
  return useMutation<void, Error, { sessionId: string; boardId: string | null }>({
    mutationFn: async ({ sessionId, boardId }) => {
      const { data, error } = await supabase
        .from('sessions')
        .update({ board_id: boardId })
        .eq('id', sessionId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Only the session owner or an admin can attach a board.')
    },
    onSettled: (_data, _err, { sessionId }) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['sessions', sessionId] })
    },
  })
}

// ---- Feedback --------------------------------------------------------------
// The club feedback log: feature requests, bug reports and general feedback.
// Club visible by design, so duplicates are avoided and status is
// transparent. The feedback RLS is the enforcement: every member reads and
// files, a creator edits and deletes their own items, and status moves only
// with club.manage (the feedback_guard_status trigger holds that line server
// side). The UI only decides what to surface.

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
  github_issue_number: number | null
  github_issue_url: string | null
}

const FEEDBACK_COLS =
  'id, club_id, created_by, kind, title, body, status, created_at, updated_at, github_issue_number, github_issue_url'

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
    githubIssueNumber: r.github_issue_number ?? null,
    githubIssueUrl: r.github_issue_url ?? null,
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

// club.manage only. The manage arm of the update RLS plus the status guard
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

// Promotes one feedback item to a public GitHub issue through the
// feedback-to-github Edge Function. ADMIN ONLY: the function gates on
// club.manage, so a coach never reaches it; the UI hides the action from
// anyone without the capability anyway. The repository is public, so the
// admin's approved title and body are the issue content and carry no
// identifying data. The function is idempotent: a second promotion of an
// already promoted item returns the existing issue with alreadyPromoted set
// rather than creating a duplicate. A 403 (capability), 503 (the GITHUB_TOKEN
// secret is missing) or 502 (GitHub unreachable or refusing) replies with a
// plain { error } body shown verbatim. On success the feedback query is
// invalidated so the row shows the link and its planned status.
export interface PromoteFeedbackResult {
  ok: boolean
  alreadyPromoted: boolean
  issueNumber: number | null
  issueUrl: string
  warning: string
}

interface PromoteFeedbackBody {
  ok?: boolean
  already_promoted?: boolean
  issue_number?: number
  issue_url?: string
  warning?: string
}

export function usePromoteFeedbackToGithub() {
  const qc = useQueryClient()
  return useMutation<PromoteFeedbackResult, Error, { id: string; title: string; body: string }>({
    mutationFn: async ({ id, title, body }) => {
      const { data, error } = await supabase.functions.invoke('feedback-to-github', {
        body: { feedback_id: id, title, body },
      })
      if (error) {
        let message = 'Could not create the GitHub issue. Try again.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const errBody = (await ctx.json()) as { error?: string }
            if (errBody?.error) message = errBody.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      const result = (data ?? {}) as PromoteFeedbackBody
      return {
        ok: result.ok === true,
        alreadyPromoted: result.already_promoted === true,
        issueNumber: typeof result.issue_number === 'number' ? result.issue_number : null,
        issueUrl: result.issue_url ?? '',
        warning: result.warning ?? '',
      }
    },
    // Settled, not success: a write back failure still created the public issue,
    // and a re read shows the true state either way.
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// Refreshes promoted feedback items from their GitHub issues through the
// feedback-github-refresh Edge Function, the issue-state-flows-back half of
// the lifecycle (issue #83). ADMIN ONLY: the function gates on club.manage,
// so a coach never reaches it; the screen only fires it for holders anyway.
// For each promoted item whose linked issue is now closed and that is not
// already done or declined, the function moves the item to done. It is best
// effort and idempotent: a GitHub read failure changes nothing, and a second
// run once everything is synced changes nothing. This runs quietly when an
// admin opens the feedback screen; its result is not shown, the feedback
// query is invalidated on settled so any moved status simply appears.
export interface RefreshFeedbackResult {
  ok: boolean
  checked: number
  updated: number
  failed: number
  stopped: boolean
}

interface RefreshFeedbackBody {
  ok?: boolean
  checked?: number
  updated?: number
  failed?: number
  stopped?: boolean
}

export function useRefreshFeedbackFromGithub() {
  const qc = useQueryClient()
  return useMutation<RefreshFeedbackResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('feedback-github-refresh', {})
      if (error) {
        let message = 'Could not refresh issue state from GitHub.'
        const ctx = (error as { context?: Response }).context
        if (ctx) {
          try {
            const errBody = (await ctx.json()) as { error?: string }
            if (errBody?.error) message = errBody.error
          } catch {
            // keep the generic message
          }
        }
        throw new Error(message)
      }
      const body = (data ?? {}) as RefreshFeedbackBody
      return {
        ok: body.ok === true,
        checked: body.checked ?? 0,
        updated: body.updated ?? 0,
        failed: body.failed ?? 0,
        stopped: body.stopped === true,
      }
    },
    // Settled, not success: the function moves items one at a time, so any
    // status moved before a late stop must show, and a re read shows the true
    // state either way.
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  })
}

// ---- Feedback comments -----------------------------------------------------
// Replies on a feedback item, club visible by design, the same transparency
// as the log itself: the whole club reads a thread just as it reads the item.
// Any member files a comment (parents included, no capability gate); an author
// edits and deletes their own; club.manage may also delete any for
// moderation. The feedback_comments RLS is the enforcement; the UI only
// decides what to surface. The comment list and the per item counts share the
// ['feedback_comments'] key so a post refreshes both the open thread and the
// collapsed row badges.

interface FeedbackCommentRow {
  id: string
  feedback_id: string
  created_by: string
  body: string
  created_at: string
  updated_at: string
}

const FEEDBACK_COMMENT_COLS = 'id, feedback_id, created_by, body, created_at, updated_at'

function toFeedbackComment(r: FeedbackCommentRow): FeedbackComment {
  return {
    id: r.id,
    feedbackId: r.feedback_id,
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// One item's thread, oldest first so a conversation reads top to bottom.
export function useFeedbackComments(feedbackId: string) {
  return useQuery({
    queryKey: ['feedback_comments', feedbackId],
    enabled: !!feedbackId,
    queryFn: async (): Promise<FeedbackComment[]> => {
      const { data, error } = await supabase
        .from('feedback_comments')
        .select(FEEDBACK_COMMENT_COLS)
        .eq('feedback_id', feedbackId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as FeedbackCommentRow[]).map(toFeedbackComment)
    },
  })
}

// A count per feedback item for the collapsed row badge, in one club wide
// read rather than a query per row. RLS scopes it to the club already.
export function useFeedbackCommentCounts() {
  return useQuery({
    queryKey: ['feedback_comments', 'counts'],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('feedback_comments').select('feedback_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const r of (data ?? []) as { feedback_id: string }[]) {
        counts[r.feedback_id] = (counts[r.feedback_id] ?? 0) + 1
      }
      return counts
    },
  })
}

// Files a comment as the signed in member. club_id and created_by are pinned
// to the caller, matching the insert RLS.
export function useAddFeedbackComment() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<void, Error, { feedbackId: string; body: string }>({
    mutationFn: async ({ feedbackId, body }) => {
      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to comment.')
      }
      const { error } = await supabase.from('feedback_comments').insert({
        feedback_id: feedbackId,
        club_id: profile.club_id,
        created_by: user.id,
        body: body.trim(),
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback_comments'] }),
  })
}

// Author only, body only. The update RLS is the real enforcement, and a
// write it blocks updates no rows, which is reported rather than swallowed.
export function useEditFeedbackComment() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; body: string }>({
    mutationFn: async ({ id, body }) => {
      const { data, error } = await supabase
        .from('feedback_comments')
        .update({ body: body.trim() })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only edit comments you wrote.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback_comments'] }),
  })
}

// Author, or a club.manage holder moderating. The delete RLS (two arms) is
// the real enforcement; a blocked delete removes nothing and is reported.
export function useDeleteFeedbackComment() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase
        .from('feedback_comments')
        .delete()
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only delete your own comment, unless you manage the club.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback_comments'] }),
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
// bucket under {club_id}/crest/, stored on the row as its path and signed for rendering
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
      const path = mediaStoragePath(club.id, file.name, 'crest')
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
// template.
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

// The fa-import request body. The client never asks for a re-import: a page
// already in the library is kept or viewed, never imported a second time.
export function faImportBody(url: string): { url: string } {
  return { url }
}

export function useImportFA() {
  const qc = useQueryClient()
  return useMutation<ImportFAOutcome, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      const { data, error } = await supabase.functions.invoke('fa-import', { body: faImportBody(url) })
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

// ---- Tactics boards --------------------------------------------------------
// The save and load layer for the tactics board. Reads are club wide (select
// is club wide RLS), so the list is every board in the club; ownership only
// decides who may rename or delete. The tokens jsonb carries no person data:
// numbers, sides, positions and player ids only, never a name, enforced by a
// check constraint (0028_board_player_boundary.sql). Names are resolved at
// render time through usePlayers, whose RLS answers sessions.create holders
// only, so a club wide board read hands a parent nothing to resolve. The
// mappers below go through serializeTokens and deserializeTokens, the single
// seam between the stored array and the board's state shape. updated_at has no
// trigger, so the write hooks set it in application code.

interface BoardRow {
  id: string
  name: string
  formation: string | null
  team_id: string | null
  tokens: unknown
  created_by: string
  created_at: string
  updated_at: string
}

const BOARD_COLS = 'id, name, formation, team_id, tokens, created_by, created_at, updated_at'

function toBoard(r: BoardRow): Board {
  return {
    id: r.id,
    name: r.name,
    formation: r.formation,
    teamId: r.team_id,
    tokens: deserializeTokens(r.tokens),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// The club's saved boards, newest first by last update so the most recently
// touched board sits at the top of the list.
export function useBoards() {
  return useQuery({
    queryKey: ['boards'],
    queryFn: async (): Promise<Board[]> => {
      const { data, error } = await supabase
        .from('boards')
        .select(BOARD_COLS)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
      if (error) throw error
      return (data as unknown as BoardRow[]).map(toBoard)
    },
  })
}

// One saved board by id, for the session day embed: a session carries a
// board_id and renders that board read only inline. Club wide read RLS gates
// it the same as the list, so a parent who reaches the session day reads the
// attached board too. Returns null for a missing or detached board.
export function useBoard(id: string | undefined) {
  return useQuery({
    queryKey: ['boards', id],
    enabled: !!id,
    queryFn: async (): Promise<Board | null> => {
      const { data, error } = await supabase.from('boards').select(BOARD_COLS).eq('id', id!).maybeSingle()
      if (error) throw error
      return data ? toBoard(data as unknown as BoardRow) : null
    },
  })
}

export interface BoardInput {
  // Null inserts a fresh board; a present id updates the board already loaded.
  id: string | null
  name: string
  formation: string | null
  teamId: string | null
  tokens: Token[]
}

// Saves the current board: a present id updates that board, a null id inserts
// a fresh one. Insert sets club_id and created_by from the signed-in user,
// which the RLS insert check requires; update sends neither, so a board never
// changes club or owner. updated_at is set here because the schema carries no
// updated_at trigger. The boards RLS is the real enforcement; the page only
// decides whether to surface the action.
export function useSaveBoard() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<Board, Error, BoardInput>({
    mutationFn: async (input) => {
      const name = input.name.trim()
      if (!name) throw new Error('Give the board a name before saving.')
      const tokens = serializeTokens(input.tokens)

      if (input.id) {
        const { data, error } = await supabase
          .from('boards')
          .update({
            name,
            formation: input.formation || null,
            team_id: input.teamId,
            tokens,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.id)
          .select(BOARD_COLS)
          .single()
        if (error) throw error
        return toBoard(data as unknown as BoardRow)
      }

      if (!user || !profile?.club_id) {
        throw new Error('You must be signed in to save a board.')
      }
      const { data, error } = await supabase
        .from('boards')
        .insert({
          club_id: profile.club_id,
          created_by: user.id,
          name,
          formation: input.formation || null,
          team_id: input.teamId,
          tokens,
        })
        .select(BOARD_COLS)
        .single()
      if (error) throw error
      return toBoard(data as unknown as BoardRow)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  })
}

// Renames a board in place. Creator or admin only; the boards update RLS is
// the real enforcement, and a write it blocks updates no rows, which is
// reported rather than swallowed. updated_at is set here for the same reason
// as the save.
export function useRenameBoard() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Enter a name.')
      const { data, error } = await supabase
        .from('boards')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only rename your own boards.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  })
}

// Creator or admin only; the boards delete RLS is the real enforcement, and a
// blocked delete (no error, zero rows) removes nothing and is reported.
export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.from('boards').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You can only delete your own boards.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  })
}

// ---- Players: the optional team roster (sessions.create) ------------------
// The first child data the app holds, so the read is the deliberate exception
// to the club wide content rule: the players RLS gates select on
// sessions.create, so this hook returns nothing for a parent (and the roster
// manager and board routes are sessions.create gated regardless). The board
// seeds tokens from these by id: a token references its player and the render
// resolves the name through this query, so the name itself never reaches the
// boards table (see tacticsBoard.ts and 0028_board_player_boundary.sql).
// Deleting a player leaves any token referencing it as a plain numbered disc.
// See 0021_players.sql for the full child data boundary.

interface SeasonRow {
  id: string
  name: string
  starts_on: string
  ends_on: string
  is_current: boolean
  archived_at: string | null
}

const SEASON_COLS = 'id, name, starts_on, ends_on, is_current, archived_at'

function toSeason(r: SeasonRow): Season {
  return {
    id: r.id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    isCurrent: r.is_current,
    archivedAt: r.archived_at,
  }
}

// The club's seasons (0031_seasons.sql). Read is club wide; every member with
// players.view can see them. Ordered newest start first.
export function useSeasons(enabled = true) {
  return useQuery({
    queryKey: ['seasons'],
    enabled,
    queryFn: async (): Promise<Season[]> => {
      const { data, error } = await supabase
        .from('seasons')
        .select(SEASON_COLS)
        .order('starts_on', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return (data as unknown as SeasonRow[]).map(toSeason)
    },
  })
}

// The one current season for the club, or null before setup. Everything
// seasonal (the roster query, board seeding) reads from it. A separate cache
// key from the roster so activating a season invalidates it independently.
export function useCurrentSeason(enabled = true) {
  return useQuery({
    queryKey: ['seasons', 'current'],
    enabled,
    queryFn: async (): Promise<Season | null> => {
      const { data, error } = await supabase
        .from('seasons')
        .select(SEASON_COLS)
        .eq('is_current', true)
        .maybeSingle()
      if (error) throw error
      return data ? toSeason(data as unknown as SeasonRow) : null
    },
  })
}

interface RegistrationJoinRow {
  player_id: string
  team_id: string | null
  shirt_number: number | null
}
interface IdentityRow {
  id: string
  display_name: string
  created_by: string | null
}

const PLAYER_ORDER = (a: Player, b: Player): number => {
  const sa = a.shirtNumber
  const sb = b.shirtNumber
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sa - sb
  }
  return a.displayName.localeCompare(b.displayName)
}

// The club's roster for the current season, assembled into the stable client
// Player shape (id, teamId, displayName, shirtNumber, createdBy). Since PR 2
// the name lives once on public.players (the identity) and the seasonal team
// and shirt live on public.player_registrations, so this reads both under the
// players.view RLS and joins them by id, ordered by shirt number (nulls last)
// then name. Keyed by the current season id so activating a season cannot mix
// stale rows. The roster manager filters this to the selected team and the
// board reads the selected team's slice. The enabled flag lets the session day
// board embed skip the query for a viewer without players.view; RLS returns
// zero rows anyway, but a parent should never even ask.
export function usePlayers(enabled = true) {
  const seasonQuery = useCurrentSeason(enabled)
  const seasonId = seasonQuery.data?.id ?? null
  const query = useQuery({
    queryKey: ['players', seasonId],
    enabled: enabled && !!seasonId,
    queryFn: async (): Promise<Player[]> => {
      const [regs, ids] = await Promise.all([
        supabase
          .from('player_registrations')
          .select('player_id, team_id, shirt_number')
          .eq('season_id', seasonId as string),
        supabase.from('players').select('id, display_name, created_by'),
      ])
      if (regs.error) throw regs.error
      if (ids.error) throw ids.error
      const identityById = new Map(
        (ids.data as unknown as IdentityRow[]).map((p) => [p.id, p]),
      )
      const players: Player[] = []
      for (const r of regs.data as unknown as RegistrationJoinRow[]) {
        const identity = identityById.get(r.player_id)
        if (!identity) continue
        players.push({
          id: r.player_id,
          teamId: r.team_id,
          displayName: identity.display_name,
          shirtNumber: r.shirt_number,
          createdBy: identity.created_by,
        })
      }
      players.sort(PLAYER_ORDER)
      return players
    },
  })
  // Fold the current-season fetch into the loading and error state: while the
  // season is still resolving the players query is disabled (no season id yet),
  // so without this a consumer would see isLoading false with empty data and
  // briefly flash an empty roster. The data shape is unchanged.
  return {
    ...query,
    isLoading: (enabled && seasonQuery.isLoading) || query.isLoading,
    isError: seasonQuery.isError || query.isError,
  }
}

interface AddPlayerRow {
  id: string
  team_id: string | null
  display_name: string
  shirt_number: number | null
  created_by: string | null
}

// Adds a player through the transactional add_player RPC (0032), which commits
// the stable identity and its current season registration together so neither
// can exist without the other. The caller mints a stable id (see the Roster's
// guarded submit) so an ambiguous lost response retry reuses the same identity
// rather than duplicating the child. club_id, actor and the season are derived
// server side; the RLS on both inserts requires players.manage, so the button
// is only surfaced to a manager or admin. status is registered to preserve the
// current Roster's behaviour (the pending default and approval flow arrive with
// the Registered Players page in PR 3). Returns the adapted Player shape.
export function useInsertPlayer() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<
    Player,
    Error,
    {
      id: string
      teamId: string | null
      displayName: string
      shirtNumber: number | null
      // The registration status the child is added as. add_player writes into
      // the current season server side; the Registered players page offers
      // Pending (the default) or Registered on create (0032). registeredDate is
      // for a backdated paper registration; left null the trigger fills it the
      // first time the status is registered.
      status?: RegistrationStatus
      registeredDate?: string | null
    }
  >({
    mutationFn: async ({ id, teamId, displayName, shirtNumber, status = 'registered', registeredDate = null }) => {
      const name = displayName.trim()
      if (!name) throw new Error('Enter a name.')
      if (!user || !profile?.club_id) throw new Error('You must be signed in.')
      const { data, error } = await supabase.rpc('add_player', {
        p_id: id,
        p_display_name: name,
        p_team_id: teamId,
        p_shirt_number: shirtNumber,
        p_status: status,
        p_registered_date: registeredDate,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as AddPlayerRow
      return {
        id: row.id,
        teamId: row.team_id,
        displayName: row.display_name,
        shirtNumber: row.shirt_number,
        createdBy: row.created_by,
      }
    },
    // Invalidate the season-aware register the Registered players page reads
    // (['registrations']), plus the current-season roster and any board name
    // map, so an add, edit or delete refreshes every reader consistently.
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// Renames a player and/or sets their current-season shirt number, atomically,
// through the transactional update_player RPC (0032). The name is an identity
// edit on public.players; the shirt is a seasonal fact on the current
// registration (never the frozen players.shirt_number). Doing both in one
// transaction means a failure after the first change can never leave a partial
// edit. p_expected_season pins the edit to the season the screen was showing so
// a concurrent activation cannot redirect it, and the RPC takes the same per
// club advisory lock as activate_season. Only supplied fields change:
// displayName undefined leaves the name; shirtNumber undefined leaves the shirt
// (null clears it). players.manage RLS binds both writes. Returns the adapted
// Player shape so the caller can reconcile without a refetch race.
export function useUpdatePlayer() {
  const qc = useQueryClient()
  return useMutation<
    Player,
    Error,
    { id: string; expectedSeason: string; displayName?: string; shirtNumber?: number | null }
  >({
    mutationFn: async ({ id, expectedSeason, displayName, shirtNumber }) => {
      const name = displayName === undefined ? null : displayName.trim()
      if (displayName !== undefined && !name) throw new Error('Enter a name.')
      const { data, error } = await supabase.rpc('update_player', {
        p_id: id,
        p_expected_season: expectedSeason,
        p_display_name: name,
        p_set_shirt: shirtNumber !== undefined,
        p_shirt_number: shirtNumber === undefined ? null : shirtNumber,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as AddPlayerRow | undefined
      if (!row) throw new Error('The player was not updated. Reload and try again.')
      return {
        id: row.id,
        teamId: row.team_id,
        displayName: row.display_name,
        shirtNumber: row.shirt_number,
        createdBy: row.created_by,
      }
    },
    // Invalidate the season-aware register the Registered players page reads
    // (['registrations']), plus the current-season roster and any board name
    // map, so an add, edit or delete refreshes every reader consistently.
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// Permanently deletes a player identity (players.delete, admin only), which
// cascades every one of their season registrations. delete(...).select('id')
// returns the deleted rows: exactly one must come back, so a zero-row result
// (RLS filtered the row, or it was already gone) is surfaced as a failure
// rather than a silent success. A board token referencing the player keeps its
// position and number and simply loses its name resolution, so a deletion never
// corrupts a board. The boards query is invalidated alongside the roster so
// every name resolving render refreshes.
// A destructive delete must affect exactly one row: zero rows means RLS
// filtered it or it was already gone (a silent no-op that must surface as a
// failure), and the select('id') return is what proves it. Pure, so it is unit
// tested directly.
export function deletedExactlyOne(rows: { id: string }[] | null): boolean {
  return !!rows && rows.length === 1
}

export function useDeletePlayer() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.from('players').delete().eq('id', id).select('id')
      if (error) throw error
      if (!deletedExactlyOne(data as { id: string }[] | null)) {
        throw new Error('The player was not deleted. Reload and try again.')
      }
    },
    // Invalidate the season-aware register the Registered players page reads
    // (['registrations']), plus the current-season roster and any board name
    // map, so an add, edit or delete refreshes every reader consistently.
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// ---------------------------------------------------------------------
// Bulk permanent deletion (roadmap PLAYERS-01, 0050_bulk_delete_players.sql)
// ---------------------------------------------------------------------

// The dependency preview a bulk deletion opens with. A QUERY rather than a
// mutation: it writes nothing and audits nothing, so it may be re-asked freely,
// and the modal gets loading, error and retry from the query layer instead of
// hand rolling three states around a destructive dialog. The key carries the
// player ids, which are opaque uuids and never names; the search term and the
// names themselves stay out of it, as they stay out of the URL.
//
// staleTime 0 and gcTime 0: a preview of a destructive operation must never be
// served from cache. Between opening the dialog twice another admin may have
// deleted somebody, and a cached identity count is exactly the stale
// confirmation the server refuses. That refusal covers the PLAYER SELECTION
// only: the dependency counts are informational current-state context, which
// the server recomputes as truth under the deletion lock rather than
// revalidating against this preview, and the dialog's copy says so.
export function useDeletePlayersPreview(playerIds: string[], enabled: boolean) {
  const key = playerIds.slice().sort()
  return useQuery({
    queryKey: ['player-delete-preview', key],
    enabled: enabled && key.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<DeletePreview> => {
      const { data, error } = await supabase.rpc('preview_delete_players', { p_player_ids: key })
      if (error) throw error
      // A malformed payload REFUSES rather than reading as zeroes: the dialog
      // lands on its error and retry path, and nothing arms against counts
      // that were never established.
      const parsed = parseDeletePreview(data)
      if (parsed === null) throw new Error('the deletion preview could not be read')
      return parsed
    },
  })
}

// The server refused because the selection is no longer what was previewed:
// another admin deleted one of these children, or an id is not this club's.
// Recognised by the message the RPC raises (0050) so the dialog can say
// something a person can act on ("review the preview again") rather than a
// generic failure. Pure, so it is unit tested directly.
export function isStaleBulkSelection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /out of date|selection changed/i.test(message)
}

// The transactional bulk permanent deletion. One RPC call, one database
// transaction: a failure anywhere deletes nobody, so there is deliberately no
// per player loop, no partial result and nothing to reconcile on retry.
//
// expectedCount is the number the admin's typed confirmation named. The server
// revalidates it inside the transaction against the live set and refuses on a
// mismatch, so a selection that went stale while the dialog was open cannot
// become a deletion of a different number of children. That revalidation is
// the identity count only, by design: the dependency counts are recomputed as
// server truth under the deletion lock and are returned and audited from
// there, never compared against the preview the dialog showed.
export function useBulkDeletePlayers() {
  const qc = useQueryClient()
  return useMutation<DeletePreview, Error, { playerIds: string[]; expectedCount: number }>({
    mutationFn: async ({ playerIds, expectedCount }) => {
      const { data, error } = await supabase.rpc('delete_players', {
        p_player_ids: playerIds,
        p_expected_count: expectedCount,
      })
      if (error) throw error
      const result = parseDeletePreview(data)
      // The RPC returns what it actually deleted. A reply that cannot be read
      // or does not account for the confirmed number is surfaced as a failure
      // rather than reported as a success, the same rule deletedExactlyOne
      // applies to the single row path.
      if (result === null || result.players !== expectedCount) {
        throw new Error('The players were not deleted. Reload and try again.')
      }
      return result
    },
    // The register, the current-season list and every board name map refresh,
    // exactly as they do after a single deletion. The activity feed is
    // invalidated too, because a run writes one event per identity plus its
    // own, and an admin who deletes from one tab expects to see it in another.
    onSettled: () => {
      invalidatePlayerReads(qc)
      qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

// The spond-roster-import response, mapped to the app contract. The import
// brings the children in a team's mapped Spond group into that team's
// roster: names only, each child's full name (see 0021_players.sql, updated
// by 0023_players_fullname.sql, and the function's name boundary). The browser never
// calls Spond; the only network this touches is the Edge Function, which
// reads the names server side and returns counts, never a payload.
export interface RosterImportResult {
  ok: boolean
  added: number
  alreadyPresent: number
  skipped: number
  // Members left alone because that name already holds a current season
  // registration that is not on this team: another team, Unassigned, or
  // withdrawn. They are neither imported nor moved, so no second record is
  // created for a child who already exists this season. A name is not an
  // identity, so where they belong stays a manager's decision. A count only,
  // never a name.
  registeredElsewhere: number
  // The no mapping outcome carries a message instead of counts.
  message: string
  warnings: string[]
}

interface RosterImportBody {
  ok?: boolean
  added?: number
  already_present?: number
  skipped?: number
  registered_elsewhere?: number
  message?: string
  warnings?: string[]
}

// Triggers the spond-roster-import Edge Function for one team. The function
// checks players.import before contacting Spond and commits through the
// transactional spond_import_roster RPC (Pending registrations in the current
// season, audited as source spond_import); a 403 (capability), 503 (the
// organiser account secrets are missing), 409 (no current season) or 502 (Spond
// unreachable) replies with a plain { error } body shown verbatim. On success the
// roster query is invalidated so the new players appear.
export function useSpondRosterImport() {
  const qc = useQueryClient()
  return useMutation<RosterImportResult, Error, { teamId: string }>({
    mutationFn: async ({ teamId }) => {
      const { data, error } = await supabase.functions.invoke('spond-roster-import', { body: { team_id: teamId } })
      if (error) {
        let message = 'Could not import from Spond. Try again.'
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
      const body = (data ?? {}) as RosterImportBody
      return {
        ok: body.ok === true,
        added: body.added ?? 0,
        alreadyPresent: body.already_present ?? 0,
        skipped: body.skipped ?? 0,
        registeredElsewhere: body.registered_elsewhere ?? 0,
        message: body.message ?? '',
        warnings: body.warnings ?? [],
      }
    },
    // Settled, not success: an error after a partial write still refreshes the
    // reads so the screen shows the true state. The Registered players page reads
    // ['registrations'], so invalidate that too, not only ['players'].
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// ---- Registered players page: season-aware reads and writes ---------------
// The Registered players page (PR 3) reads a chosen season's registrations
// joined to the stable identities, so it can show any season, current or
// archived, not only the current one usePlayers returns. Read is club wide
// under players.view; parents hold neither and the route guard keeps them out.

interface RegistrationFullRow {
  id: string
  player_id: string
  season_id: string
  team_id: string | null
  status: RegistrationStatus
  shirt_number: number | null
  registered_date: string | null
  created_by: string | null
  updated_at: string
}

// The selected season's register, assembled into RegisteredPlayer rows (the
// registration id, its seasonal facts, and the identity's name resolved by id).
// Keyed by the season id so switching season or activating one cannot mix
// stale rows. Rows are returned unsorted; the page's pure sort reducer orders
// them, so the ordering is unit tested without a database. The name resolves
// from the identity read; a registration whose identity is missing (should not
// happen given the FK) is skipped rather than shown nameless.
export function useRegisteredPlayers(seasonId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['registrations', seasonId],
    enabled: enabled && !!seasonId,
    queryFn: async (): Promise<RegisteredPlayer[]> => {
      const [regs, ids] = await Promise.all([
        supabase
          .from('player_registrations')
          .select('id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by, updated_at')
          .eq('season_id', seasonId as string),
        supabase.from('players').select('id, display_name'),
      ])
      if (regs.error) throw regs.error
      if (ids.error) throw ids.error
      const nameById = new Map(
        (ids.data as unknown as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]),
      )
      const rows: RegisteredPlayer[] = []
      for (const r of regs.data as unknown as RegistrationFullRow[]) {
        const name = nameById.get(r.player_id)
        if (name === undefined) continue
        rows.push({
          registrationId: r.id,
          playerId: r.player_id,
          seasonId: r.season_id,
          teamId: r.team_id,
          displayName: name,
          shirtNumber: r.shirt_number,
          status: r.status,
          registeredDate: r.registered_date,
          createdBy: r.created_by,
          updatedAt: r.updated_at,
        })
      }
      return rows
    },
  })
}

// Every player identity in the club, id to display name, for the import preview
// only: it verifies a pasted Player ID belongs to the club (a valid uuid absent
// from this set does not) and supplies the stored name for the rename warning on
// a cross season update, so the renewal round trip (last season's export imported
// into a new season) previews correctly. Club wide, read gated by the players
// select policy (a players.import holder always holds players.view); no season,
// no team, no registration, and no name ever leaves this map into a log or URL.
// Keyed by lowercased uuid to match the Player ID normalisation in the plan.
export function useClubPlayerIdentities(enabled = true) {
  return useQuery({
    queryKey: ['player_identities'],
    enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      // Page through every identity. PostgREST caps a single response at
      // db.max_rows (1000, supabase/config.toml), so an unpaged select silently
      // truncates once the club has accumulated more than a page of children
      // across seasons. That truncation matters beyond the import preview: the
      // Activity page treats an id absent from this map as a deleted player, so
      // a real child past row 1000 would render as "Deleted player" and lose
      // View history. Advance by the rows actually returned and stop on the
      // first empty page, which stays correct whatever the server cap is.
      const map = new Map<string, string>()
      const PAGE = 1000
      for (let from = 0; ; ) {
        const { data, error } = await supabase
          .from('players')
          .select('id, display_name')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw error
        const rows = (data ?? []) as unknown as { id: string; display_name: string }[]
        for (const p of rows) map.set(p.id.toLowerCase(), p.display_name)
        if (rows.length === 0) break
        from += rows.length
      }
      return map
    },
  })
}

// The shared invalidation for a registration write: the season's register (the
// Registered players table, keyed ['registrations', seasonId], so a prefix
// invalidation refreshes it after every add, edit, delete or import), the
// current-season roster usePlayers reads, and any board resolving names.
// Exported so the set of refreshed reads is pinned in a unit test.
export function invalidatePlayerReads(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['registrations'] })
  qc.invalidateQueries({ queryKey: ['players'] })
  qc.invalidateQueries({ queryKey: ['boards'] })
}

// The audited export read (players.export, 0034_export_players.sql). Calls the
// export_players RPC, which re-checks the capability and club server side,
// applies the caller's view filter under the club wide read scope, writes the
// one players.exported audit event in the same transaction (never a name, a row
// or the search string), and returns the dataset the client shapes into a CSV
// or XLSX file. Read only, so nothing is invalidated. Calling it IS the export
// for audit purposes: a successful RPC is recorded even if the browser then
// fails to build the file (the safe, over recording direction for child data).
export function useExportPlayers() {
  return useMutation<
    ExportPlayerRow[],
    Error,
    { seasonId: string; filters: ExportFilterPayload; format: 'csv' | 'xlsx' }
  >({
    mutationFn: async ({ seasonId, filters, format }) => {
      const { data, error } = await supabase.rpc('export_players', {
        p_season_id: seasonId,
        p_filters: { team: filters.team, statuses: filters.statuses, search: filters.search, format },
      })
      if (error) throw error
      return (data ?? []) as ExportPlayerRow[]
    },
  })
}

// The transactional spreadsheet import commit (players.import,
// 0035_import_players.sql). Calls the import_players RPC with the client minted
// batch id, the target season and the confirmed payload (format plus the
// minimum normalised operations); the RPC re-checks the capability and club,
// re-validates every row, applies all writes and their audit events in one
// transaction (all or nothing), records the batch, and is idempotent on the
// batch id. It RETURNS a structured result: outcome 'succeeded' with counts, or
// outcome 'failed' with a safe reason (a row failure commits a failed batch, so
// there is no error to throw). A RAISED error (missing capability, cross club or
// archived season, a malformed payload, a cross club batch id) rejects instead,
// which the caller distinguishes by the error carrying a Postgres code. Settled,
// not success: the reads refresh after any attempt so the register shows the
// true state, and the import preview's identity map refreshes so a re-import
// previews against the new rows.
export function useImportPlayers() {
  const qc = useQueryClient()
  return useMutation<ImportServerResult, Error, { batchId: string; seasonId: string; payload: ImportPayload }>({
    mutationFn: async ({ batchId, seasonId, payload }) => {
      const { data, error } = await supabase.rpc('import_players', {
        p_batch_id: batchId,
        p_season_id: seasonId,
        p_rows: payload,
      })
      if (error) throw error
      return data as ImportServerResult
    },
    onSettled: () => {
      invalidatePlayerReads(qc)
      qc.invalidateQueries({ queryKey: ['player_identities'] })
    },
  })
}

// The transactional bulk Renew commit (players.manage, 0036_spond_and_renew.sql).
// Calls the renew_registrations RPC with a client minted batch id, the chosen
// source and target season ids and the chosen player ids; the RPC re-checks the
// capability and club, validates both seasons belong to the club (target non
// archived, source and target distinct), reads team and shirt from each source
// registration server side, and creates a Pending target registration for every
// chosen player not already registered there, in one transaction, audited as
// source 'renewal' (player.renewed). It never mutates the source registration
// and records no import_batches row. Idempotent per (player, season): a repeat
// or a lost-response retry creates no duplicates (the RPC returns already_in_target
// for rows that exist), so no optimistic write and a safe retry. Settled, not
// success: the register refreshes after any attempt so the target season shows
// the true state.
export interface RenewResult {
  batchId: string
  renewed: number
  alreadyInTarget: number
  skipped: number
  outcome: string
}

interface RenewResultRow {
  batch_id?: string
  renewed?: number
  already_in_target?: number
  skipped?: number
  outcome?: string
}

export function useRenewRegistrations() {
  const qc = useQueryClient()
  return useMutation<
    RenewResult,
    Error,
    { batchId: string; sourceSeasonId: string; targetSeasonId: string; playerIds: string[] }
  >({
    mutationFn: async ({ batchId, sourceSeasonId, targetSeasonId, playerIds }) => {
      const { data, error } = await supabase.rpc('renew_registrations', {
        p_batch_id: batchId,
        p_source_season_id: sourceSeasonId,
        p_target_season_id: targetSeasonId,
        p_player_ids: playerIds,
      })
      if (error) throw error
      const r = (data ?? {}) as RenewResultRow
      return {
        batchId: r.batch_id ?? batchId,
        renewed: r.renewed ?? 0,
        alreadyInTarget: r.already_in_target ?? 0,
        skipped: r.skipped ?? 0,
        outcome: r.outcome ?? 'succeeded',
      }
    },
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// Moves a registration to another team, or to Unassigned (null). A seasonal
// edit on the registration, never the frozen players.team_id; the audit trigger
// records player.team_changed with safe old and new team ids (no name). The
// update targets the registration by id and requires exactly one affected row,
// so an RLS filtered or already-gone row surfaces as a failure rather than a
// silent no-op. Not offered on an archived season (the guard refuses a non-null
// team change there, and the page hides the affordance).
export function useMovePlayerTeam() {
  const qc = useQueryClient()
  return useMutation<void, Error, { registrationId: string; teamId: string | null }>({
    mutationFn: async ({ registrationId, teamId }) => {
      const { data, error } = await supabase
        .from('player_registrations')
        .update({ team_id: teamId })
        .eq('id', registrationId)
        .select('id')
      if (error) throw error
      if (!deletedExactlyOne(data as { id: string }[] | null)) {
        throw new Error('The player was not moved. Reload and try again.')
      }
    },
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// Sets a registration's status, the single write behind Withdraw (-> withdrawn),
// Restore (-> pending or registered) and the pending/registered transitions.
// Withdraw keeps the team and shirt untouched (only status changes), so the
// record can be restored intact. Server enforced transitions (0032) reject an
// invalid move; the UI only offers valid ones. Requires exactly one affected
// row. Restoring to registered with no registered_date lets the trigger fill it.
export function useSetRegistrationStatus() {
  const qc = useQueryClient()
  return useMutation<void, Error, { registrationId: string; status: RegistrationStatus }>({
    mutationFn: async ({ registrationId, status }) => {
      const { data, error } = await supabase
        .from('player_registrations')
        .update({ status })
        .eq('id', registrationId)
        .select('id')
      if (error) throw error
      if (!deletedExactlyOne(data as { id: string }[] | null)) {
        throw new Error('The change was not saved. Reload and try again.')
      }
    },
    onSettled: () => invalidatePlayerReads(qc),
  })
}

// The per player History read path (0032 player_history RPC), gated server side
// on audit.view (managers and admins). Returns the child's audit trail newest
// first, carrying no name: the action and safe fields describe the change, and
// the actor, team and player names resolve at render time by id. A coach
// (players.view only) is refused by the RPC; the page hides the affordance for
// them, and RequireCap keeps parents off the page entirely.
interface PlayerHistoryRow {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_id: string
  season_id: string | null
  team_id: string | null
  source: string
  changed_fields: string[] | null
  safe_changes: Record<string, { old?: unknown; new?: unknown }> | null
}

export function usePlayerHistory(playerId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['playerHistory', playerId],
    enabled: enabled && !!playerId,
    queryFn: async (): Promise<PlayerHistoryEntry[]> => {
      const { data, error } = await supabase.rpc('player_history', {
        p_player_id: playerId,
        p_limit: 200,
        p_offset: 0,
      })
      if (error) throw error
      return (data as unknown as PlayerHistoryRow[]).map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        seasonId: r.season_id,
        teamId: r.team_id,
        source: r.source,
        changedFields: r.changed_fields,
        safeChanges: r.safe_changes,
      }))
    },
  })
}

// ---- Club wide Activity feed -----------------------------------------------
// The club wide audit feed (0030 audit_events), gated server side on audit.view
// and scoped to the caller's club by the audit_events_select_view policy
// (club_id = my_club()). Parents and coaches without audit.view read zero rows
// regardless of what the client sends. Server paginated by a keyset cursor
// (occurred_at desc, id desc), never OFFSET, so page windows stay disjoint and
// complete while newer events are inserted between requests, and the whole
// history is never downloaded to the browser. The select is EXACTLY the safe
// columns (ACTIVITY_SELECT_COLUMNS): metadata and request_id are never fetched,
// so no raw JSON and no correlation id ever reaches the page; club_id is
// enforced by RLS, never sent by or trusted from the client.
interface AuditActivityRow {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  season_id: string | null
  team_id: string | null
  source: string
  changed_fields: string[] | null
  safe_changes: Record<string, { old?: unknown; new?: unknown }> | null
  batch_id: string | null
}

function toActivityEvent(r: AuditActivityRow): ActivityEvent {
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    seasonId: r.season_id,
    teamId: r.team_id,
    source: r.source,
    changedFields: r.changed_fields,
    safeChanges: r.safe_changes,
    batchId: r.batch_id,
  }
}

export function useAuditActivity(filters: ActivityFilters, enabled = true) {
  // The applied predicates are the cache key, so any filter change starts a
  // fresh paginated read and the batch deep link composes with the rest.
  const conditions = useMemo(() => activityQueryConditions(filters), [filters])
  return useInfiniteQuery({
    queryKey: ['activity', conditions],
    enabled,
    initialPageParam: null as ActivityCursor | null,
    queryFn: async ({ pageParam }): Promise<ActivityEvent[]> => {
      let q = supabase
        .from('audit_events')
        .select(ACTIVITY_SELECT_COLUMNS)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(ACTIVITY_PAGE_SIZE)
      for (const c of conditions) {
        if (c.op === 'eq') q = q.eq(c.column, c.value)
        else if (c.op === 'gte') q = q.gte(c.column, c.value)
        else if (c.op === 'lt') q = q.lt(c.column, c.value)
      }
      const keyset = keysetOrFilter(pageParam)
      if (keyset) q = q.or(keyset)
      const { data, error } = await q
      if (error) throw error
      return (data as unknown as AuditActivityRow[]).map(toActivityEvent)
    },
    // A cursor when the last page was full, else undefined: no more pages.
    getNextPageParam: (lastPage) => nextCursor(lastPage) ?? undefined,
  })
}

// ---- Admin seasons surface -------------------------------------------------
// Season create, activate, archive and unarchive, behind seasons.manage (admin
// only) and backed by the seasons RLS and the activate_season RPC. Every write
// is confirmed (no optimistic mutation) and invalidates the seasons reads, plus
// the register when the current season may have moved.

// Creates a season. Never changes the current season (is_current defaults
// false); club and creator are pinned server side by the insert policy
// (created_by = auth.uid()). Name is 1..20 unique per club; ends_on after
// starts_on. A duplicate name or bad date range surfaces as the mutation error;
// the modal maps it to safe copy through seasonCreateErrorMessage. Blank date
// inputs are normalized from "" to null through seasonDatePayload so an empty
// string never reaches the date columns (SQLSTATE 22007).
export function useCreateSeason() {
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  return useMutation<void, Error, { name: string; startsOn: string; endsOn: string }>({
    mutationFn: async ({ name, startsOn, endsOn }) => {
      if (!user || !profile?.club_id) throw new Error('You must be signed in.')
      const dates = seasonDatePayload({ startsOn, endsOn })
      const { error } = await supabase.from('seasons').insert({
        club_id: profile.club_id,
        name: name.trim(),
        starts_on: dates.starts_on,
        ends_on: dates.ends_on,
        created_by: user.id,
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seasons'] }),
  })
}

// Activates a season through the activate_season RPC (0032), one transaction
// that clears the outgoing current season and sets the target, optionally
// archiving the outgoing season. Registrations are untouched. Invalidates the
// seasons reads and the register, since the current season the page opens on
// has moved.
export function useActivateSeason() {
  const qc = useQueryClient()
  return useMutation<void, Error, { seasonId: string; archiveOutgoing: boolean }>({
    mutationFn: async ({ seasonId, archiveOutgoing }) => {
      const { error } = await supabase.rpc('activate_season', {
        p_season_id: seasonId,
        p_archive_outgoing: archiveOutgoing,
      })
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['seasons'] })
      qc.invalidateQueries({ queryKey: ['registrations'] })
      qc.invalidateQueries({ queryKey: ['players'] })
    },
  })
}

// Archives a non-current season (sets archived_at). The seasons guard refuses
// archiving the current season alone (P0001), so the UI only offers Archive on
// non-current seasons; the audit trigger records season.archived. Requires
// exactly one affected row.
export function useArchiveSeason() {
  const qc = useQueryClient()
  return useMutation<void, Error, { seasonId: string }>({
    mutationFn: async ({ seasonId }) => {
      const { data, error } = await supabase
        .from('seasons')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', seasonId)
        .select('id')
      if (error) throw error
      if (!deletedExactlyOne(data as { id: string }[] | null)) {
        throw new Error('The season was not archived. Reload and try again.')
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seasons'] }),
  })
}

// Unarchives a season (clears archived_at), making it writable again. The audit
// trigger records season.updated with changed_fields ['archived_at']. Requires
// exactly one affected row.
export function useUnarchiveSeason() {
  const qc = useQueryClient()
  return useMutation<void, Error, { seasonId: string }>({
    mutationFn: async ({ seasonId }) => {
      const { data, error } = await supabase
        .from('seasons')
        .update({ archived_at: null })
        .eq('id', seasonId)
        .select('id')
      if (error) throw error
      if (!deletedExactlyOne(data as { id: string }[] | null)) {
        throw new Error('The season was not unarchived. Reload and try again.')
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['seasons'] }),
  })
}

// =====================================================================
// Content Sharing PR 2: public drill share management hooks.
//
// These wrap the authenticated manage-content-share Edge Function. The raw
// secret returned by create and rotate is handed to the caller once and never
// cached in a query (React Query cache is in-memory only and is not persisted);
// the component holds it in local state and clears it on close. The public read
// path is deliberately NOT here: the anonymous public page has its own minimal
// read so it does not pull this module (and useAuth) into its bundle.
// =====================================================================

// Content sharing (Content Sharing PR 2 drills, PR 3 sessions). One kind-aware
// hook set drives the shared ShareModal for a drill, a session and a programme;
// the wire always carries kind + sourceId, and the source column and dependency
// authority are re-derived server side by the lifecycle RPC.
export type ContentShareKind = 'drill' | 'session' | 'programme'

export interface ContentShareStatus {
  shareId: string
  kind: string
  isOwner: boolean
  canManage: boolean
  expiresAt: string | null
  createdAt: string | null
  refreshedAt: string | null
  rotatedAt: string | null
  hasSnapshot: boolean
  snapshot: unknown | null
}

export interface ContentSharePreview {
  eligible: boolean
  blocked: string[]
  rights: { source: string; media?: string | null; hasMedia?: boolean }
  // Bounded provenance, so the blocked copy can tell "set to club only" apart
  // from "came from England Football". Never carries an id, title or count. An
  // older deployed function omits it and readProvenance falls back to "no proof
  // of provenance", which keeps England Football out of the wording.
  provenance: SharePreviewProvenance
  preview: unknown | null
}

export interface ContentShareCreateResult {
  shareId: string
  secret?: string
  existing?: boolean
  message?: string
  expiresAt?: string | null
}

export interface ContentShareRotateResult {
  shareId: string
  secret: string
}

async function invokeManageShare(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('manage-content-share', { body })
  if (error) {
    let message = 'Something went wrong. No change was made.'
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      try {
        const parsed = (await ctx.json()) as { error?: string }
        if (parsed?.error) message = parsed.error
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(message)
  }
  return (data ?? {}) as Record<string, unknown>
}

export interface ContentShareStatusResult {
  share: ContentShareStatus | null
  sharingEnabled: boolean
}

function shareStatusKey(kind: ContentShareKind, sourceId: string | undefined) {
  return ['content-share-status', kind, sourceId] as const
}

// The active public share for a drill or session, for the owner or a manager,
// plus the club kill switch state. share is null when there is none, or when the
// caller is neither the owner nor a manager.
export function useContentShareStatus(
  kind: ContentShareKind,
  sourceId: string | undefined,
  enabled = true,
) {
  const { user } = useAuth()
  return useQuery({
    queryKey: shareStatusKey(kind, sourceId),
    enabled: !!sourceId && !!user && enabled,
    retry: false,
    queryFn: async (): Promise<ContentShareStatusResult> => {
      const data = await invokeManageShare({ action: 'status', kind, sourceId })
      return {
        share: (data.share ?? null) as ContentShareStatus | null,
        sharingEnabled: data.sharingEnabled === true,
      }
    },
  })
}

// Build the exact projection that would become public, without writing anything.
export function usePreviewContentShare() {
  return useMutation<ContentSharePreview, Error, { kind: ContentShareKind; sourceId: string }>({
    mutationFn: async ({ kind, sourceId }) => {
      const data = await invokeManageShare({ action: 'preview', kind, sourceId })
      return {
        eligible: data.eligible === true,
        blocked: Array.isArray(data.blocked) ? (data.blocked as string[]) : [],
        rights: data.rights as ContentSharePreview['rights'],
        provenance: readProvenance(data.provenance),
        preview: data.preview ?? null,
      }
    },
  })
}

// =====================================================================
// Content rights classification.
//
// Club authored content created after migration 0038 lands at the fail closed
// default (club only) and, until now, nothing in the app could change it. This
// is that write, and it is a plain RLS backed table update on purpose: the
// existing owner-or-manager UPDATE policy on each of the five tables is already
// the right authority, so no service role path and no new capability is
// introduced for it.
//
// The England Football lock is a database trigger (migration 0043), not a rule
// this hook applies. A refusal arrives here as a Postgres privilege error and
// is turned into the same sentence the locked control shows, so the two routes
// agree and the client is never the thing deciding.
// =====================================================================

// An explicit closed map. There is no dynamic table name in this write path.
const RIGHTS_TABLE: Record<RightsKind, 'drills' | 'sessions' | 'programmes' | 'templates' | 'media'> = {
  drill: 'drills',
  session: 'sessions',
  programme: 'programmes',
  template: 'templates',
  media: 'media',
}

const RIGHTS_CACHE_KEY: Record<RightsKind, string> = {
  drill: 'drills',
  session: 'sessions',
  programme: 'programmes',
  template: 'templates',
  media: 'media',
}

export function useUpdateContentRights() {
  const qc = useQueryClient()
  return useMutation<
    { id: string; rights: ContentRights },
    Error,
    { kind: RightsKind; id: string; rights: ContentRights }
  >({
    mutationFn: async ({ kind, id, rights }) => {
      const { data, error } = await supabase
        .from(RIGHTS_TABLE[kind])
        .update({ rights })
        .eq('id', id)
        .select('id, rights')
        .maybeSingle()
      if (error) {
        // 42501 is what the England Football lock raises. Anything else is an
        // ordinary failure and keeps the calm generic wording.
        if ((error as { code?: string }).code === '42501') throw new Error(RIGHTS_REFUSED_MESSAGE)
        throw new Error('We could not change the sharing level. Try again.')
      }
      // RLS returns no row rather than an error when the policy refuses.
      if (!data) throw new Error('You cannot change the sharing level for this item.')
      return { id: (data as { id: string }).id, rights: (data as { rights: ContentRights }).rights }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: [RIGHTS_CACHE_KEY[vars.kind]] })
      // A source's own level decides its share, and a nested item's level
      // decides every aggregate above it, so both are invalidated wholesale
      // rather than guessed at.
      void qc.invalidateQueries({ queryKey: ['content-share-status'] })
    },
  })
}

export function useCreateContentShare() {
  const qc = useQueryClient()
  return useMutation<
    ContentShareCreateResult,
    Error,
    { kind: ContentShareKind; sourceId: string; idempotencyKey: string; expiresAt?: string | null; noExpiry?: boolean }
  >({
    mutationFn: async ({ kind, sourceId, idempotencyKey, expiresAt, noExpiry }) => {
      const data = await invokeManageShare({
        action: 'create',
        kind,
        sourceId,
        idempotencyKey,
        expiresAt: expiresAt ?? null,
        noExpiry: noExpiry ?? false,
      })
      return {
        shareId: data.shareId as string,
        secret: data.secret as string | undefined,
        existing: data.existing === true,
        message: data.message as string | undefined,
        expiresAt: (data.expiresAt ?? null) as string | null,
      }
    },
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: shareStatusKey(vars.kind, vars.sourceId) }),
  })
}

export function useRefreshContentShare() {
  const qc = useQueryClient()
  return useMutation<
    { expiresAt: string | null },
    Error,
    { kind: ContentShareKind; sourceId: string; shareId: string }
  >({
    mutationFn: async ({ shareId }) => {
      const data = await invokeManageShare({ action: 'refresh', shareId })
      return { expiresAt: (data.expiresAt ?? null) as string | null }
    },
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: shareStatusKey(vars.kind, vars.sourceId) }),
  })
}

export function useRotateContentShare() {
  const qc = useQueryClient()
  return useMutation<
    ContentShareRotateResult,
    Error,
    { kind: ContentShareKind; sourceId: string; shareId: string }
  >({
    mutationFn: async ({ shareId }) => {
      const data = await invokeManageShare({ action: 'rotate', shareId })
      return { shareId: data.shareId as string, secret: data.secret as string }
    },
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: shareStatusKey(vars.kind, vars.sourceId) }),
  })
}

export function useRevokeContentShare() {
  const qc = useQueryClient()
  return useMutation<
    { status: string },
    Error,
    { kind: ContentShareKind; sourceId: string; shareId: string }
  >({
    mutationFn: async ({ shareId }) => {
      const data = await invokeManageShare({ action: 'revoke', shareId })
      return { status: (data.status ?? 'revoked') as string }
    },
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: shareStatusKey(vars.kind, vars.sourceId) }),
  })
}

// =====================================================================
// Content Sharing PR 5: club wide Shared Links management hooks.
//
// The same manage-content-share function, two more actions, both gated on
// shares.manage server side (a caller without it gets 403, which is why every
// hook here is enabled only when the capability is held: an unauthorised call
// is not a useful thing to make). The browser never selects content_shares
// directly; the table carries no client policy, so this function is the only
// way to see a club's links.
//
// Nothing secret bearing rides these hooks. The list DTO carries no token hash,
// no snapshot and no idempotency key, and the detail snapshot is the same
// already redacted public projection the anonymous page would render. There is
// deliberately no rotate and no refresh here: see AdminShares.tsx.
// =====================================================================

export interface ManagedShare {
  shareId: string
  kind: ManagedShareKind
  sourceId: string | null
  // null when the drill, session or programme behind the link was deleted.
  sourceTitle: string | null
  status: ManagedShareStatus
  createdById: string | null
  createdByName: string | null
  // true when created_by is null, which is what a removed member leaves behind.
  unattributed: boolean
  createdAt: string | null
  expiresAt: string | null
  refreshedAt: string | null
  rotatedAt: string | null
  revokedAt: string | null
  snapshotVersion: number
}

export interface ManagedSharesPage {
  shares: ManagedShare[]
  sharingEnabled: boolean
  hasMore: boolean
  nextCursor: string | null
  total: number | null
}

export interface ManagedShareDetail {
  share: ManagedShare
  // An already redacted public projection, or null. Re-validated in the browser
  // by the public validators before anything renders.
  snapshot: unknown | null
  hasSnapshot: boolean
}

function toManagedShare(value: unknown): ManagedShare {
  const r = (value ?? {}) as Record<string, unknown>
  return {
    shareId: r.shareId as string,
    kind: r.kind as ManagedShareKind,
    sourceId: (r.sourceId ?? null) as string | null,
    sourceTitle: (r.sourceTitle ?? null) as string | null,
    status: r.status as ManagedShareStatus,
    createdById: (r.createdById ?? null) as string | null,
    createdByName: (r.createdByName ?? null) as string | null,
    unattributed: r.unattributed === true,
    createdAt: (r.createdAt ?? null) as string | null,
    expiresAt: (r.expiresAt ?? null) as string | null,
    refreshedAt: (r.refreshedAt ?? null) as string | null,
    rotatedAt: (r.rotatedAt ?? null) as string | null,
    revokedAt: (r.revokedAt ?? null) as string | null,
    snapshotVersion: typeof r.snapshotVersion === 'number' ? r.snapshotVersion : 0,
  }
}

// Every public link in the club, newest first, filtered. Paged with the
// server's cursor rather than an offset, so a link created mid browse cannot
// push a row onto a page the manager already read past.
export function useManagedShares(filters: ShareFilters) {
  const { caps } = useMyCapabilities()
  const canManage = caps.has(SHARE_CAPS.manage)
  return useInfiniteQuery({
    queryKey: ['managed-shares', filters],
    enabled: canManage,
    retry: false,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ManagedSharesPage> => {
      const data = await invokeManageShare(filtersToRequest(filters, { cursor: pageParam }))
      return {
        shares: (Array.isArray(data.shares) ? data.shares : []).map(toManagedShare),
        sharingEnabled: data.sharingEnabled === true,
        hasMore: data.hasMore === true,
        nextCursor: (data.nextCursor ?? null) as string | null,
        total: typeof data.total === 'number' ? data.total : null,
      }
    },
    // A cursor only while the server says another page exists.
    getNextPageParam: (last) => (last.hasMore && last.nextCursor ? last.nextCursor : undefined),
  })
}

// One share plus its stored public projection, for the Review panel. Disabled
// until a share is chosen, so opening the screen reads no snapshots.
export function useManagedShareDetail(shareId: string | null) {
  const { caps } = useMyCapabilities()
  const canManage = caps.has(SHARE_CAPS.manage)
  return useQuery({
    queryKey: ['managed-share-detail', shareId],
    enabled: canManage && !!shareId,
    retry: false,
    queryFn: async (): Promise<ManagedShareDetail> => {
      const data = await invokeManageShare({ action: 'detail', shareId })
      return {
        share: toManagedShare(data.share),
        snapshot: data.snapshot ?? null,
        hasSnapshot: data.hasSnapshot === true,
      }
    },
  })
}

// How many public links a member still has live. Used by the removal warning in
// Admin users, which asks for a single row purely for the server's total, so
// the warning never pulls a page of another member's shares into the browser.
// Returns null when the total is unknown, which the warning treats as "say
// nothing": it must never block a removal.
export function useMemberActiveShareCount(memberId: string | null) {
  const { caps } = useMyCapabilities()
  const canManage = caps.has(SHARE_CAPS.manage)
  return useQuery({
    queryKey: ['managed-shares-count', memberId],
    enabled: canManage && !!memberId,
    retry: false,
    queryFn: async (): Promise<number | null> => {
      const data = await invokeManageShare(
        filtersToRequest(
          { ...EMPTY_SHARE_FILTERS, status: 'active', createdBy: memberId as string },
          { limit: 1 },
        ),
      )
      return typeof data.total === 'number' ? data.total : null
    },
  })
}

// Turn a club link off from the management screen. It reuses the SAME revoke
// action the owner's control uses; there is no manager only write path. Revoke
// is idempotent server side, so a second press on an already revoked link is
// harmless.
export function useRevokeManagedShare() {
  const qc = useQueryClient()
  return useMutation<
    { status: string },
    Error,
    { shareId: string; kind: ManagedShareKind; sourceId: string | null }
  >({
    mutationFn: async ({ shareId }) => {
      const data = await invokeManageShare({ action: 'revoke', shareId })
      return { status: (data.status ?? 'revoked') as string }
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ['managed-shares'] })
      void qc.invalidateQueries({ queryKey: ['managed-shares-count'] })
      void qc.invalidateQueries({ queryKey: ['managed-share-detail', vars.shareId] })
      // The owner's own control on the drill, session or programme page reads
      // the same share through its status key, so refresh that too. With no
      // source id (the source was deleted) the whole status prefix is
      // invalidated rather than guessing a key.
      void qc.invalidateQueries({
        queryKey: vars.sourceId ? shareStatusKey(vars.kind, vars.sourceId) : ['content-share-status'],
      })
    },
  })
}

// ---- Venues (club.manage) --------------------------------------------------
// The club's real places (0044). Reads are club wide because a coach needs
// to know where the session is; writes are the admin surface.

export interface VenueRow {
  id: string
  club_id: string
  name: string
  created_at: string
}

const VENUE_COLS = 'id, club_id, name, created_at'

export function toVenue(r: VenueRow): Venue {
  return { id: r.id, name: r.name }
}

export function useVenues(enabled = true) {
  return useQuery({
    queryKey: ['venues'],
    enabled,
    queryFn: async (): Promise<Venue[]> => {
      const { data, error } = await supabase.from('venues').select(VENUE_COLS).order('name', { ascending: true })
      if (error) throw error
      return (data as unknown as VenueRow[]).map(toVenue)
    },
  })
}

export function useVenueMap(): Record<string, Venue> {
  const { data } = useVenues()
  return useMemo(() => Object.fromEntries((data ?? []).map((v) => [v.id, v])), [data])
}

export function useInsertVenue() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<void, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      if (!profile?.club_id) throw new Error('You must be signed in to add a venue.')
      const { error } = await supabase.from('venues').insert({ club_id: profile.club_id, name })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venues'] }),
  })
}

export function useRenameVenue() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const { error } = await supabase.from('venues').update({ name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venues'] }),
  })
}

// Removing a venue nulls sessions.venue_id (the composite reference names
// that column alone, so club_id survives and the sessions stay put).
export function useDeleteVenue() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('venues').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

// ---- Team bib colour (teams.manage) ----------------------------------------

export function useSetTeamBibColour() {
  const qc = useQueryClient()
  return useMutation<void, Error, { teamId: string; bibColour: string | null }>({
    mutationFn: async ({ teamId, bibColour }) => {
      const { error } = await supabase.from('teams').update({ bib_colour: bibColour }).eq('id', teamId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

// ---- Spond RSVP context (0045) ---------------------------------------------
//
// Sibling of the register, never a child of it. The register's cache key
// prefix is swept by the save's invalidation and its readback puts a
// RegisterEntry[] into that prefix, so a nested key would make
// contamination a matter of care rather than structure.
//
// RSVP is context. Nothing in this section reads or writes
// register_entries.

// Does this error mean "the table is not there yet"? Exactly three codes
// do: 42P01 is Postgres undefined_table, PGRST205 is PostgREST's table
// not found in the schema cache, and PGRST200 is an unresolvable embed,
// which is what a stale schema cache returns. Nothing else counts, so a
// permission error or a network failure is still a real failure.
//
// This exists so the client can be merged and deployed before the
// migration is applied by hand: a pre apply app renders exactly today's
// register, and the moment 0045 lands the next mount starts returning
// context with no redeploy.
export function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST200'
}

// The EVENT is part of the key, not just the session. The rows this hook
// stores are per Spond event, so keying on the session alone would leave
// the previous event's replies in the cache when a session is unlinked
// (enabled: false stops fetching, it does not clear) or repointed, and
// they would render beside named children for a session that no longer
// has that event. Absence must have exactly one appearance, and a
// different event, or none, must therefore read a different entry.
export function spondRsvpKey(sessionId: string, spondEventId: string | null) {
  return ['spond_rsvp', sessionId, spondEventId] as const
}

// PostgREST serves at most this many rows and TRUNCATES a larger result
// silently rather than erroring, so every read below asks for an explicit
// range and pages.
const RSVP_PAGE = 1000
const RSVP_MAX_ROWS = 5000

async function readAllPages<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < RSVP_MAX_ROWS; from += RSVP_PAGE) {
    const { data, error } = await read(from, from + RSVP_PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < RSVP_PAGE) break
  }
  return out
}

// What each player's parent replied for this session's linked Spond
// event. Two plain reads joined in a pure function rather than one
// embedded query: an embed depends on PostgREST resolving a composite
// relationship, and a resolution that silently stopped working would
// render as no context forever, which is indistinguishable from a club
// that has linked nobody.
//
// Both reads are gated on players.view by RLS. The query never fires for
// a session with no linked event, or for a caller without the
// capability, so a club that never used Spond makes no request at all.
export function useSessionSpondRsvp(sessionId: string | undefined, spondEventId: string | null, enabled = true) {
  const { caps } = useMyCapabilities()
  const canRead = caps.has('players.view')
  return useQuery({
    queryKey: spondRsvpKey(sessionId ?? '', spondEventId),
    enabled: enabled && !!sessionId && !!spondEventId && canRead,
    // A pre apply database answers "no such table". That is not a
    // failure worth retrying four times on every mount.
    retry: (count, error) => !isMissingRelation(error) && count < 2,
    queryFn: async (): Promise<Record<string, Rsvp>> => {
      try {
        const [responses, links] = await Promise.all([
          readAllPages<RsvpResponseRow>((from, to) =>
            supabase
              .from('spond_event_responses')
              .select('spond_member_id, status, synced_at')
              .eq('spond_event_id', spondEventId as string)
              .order('spond_member_id', { ascending: true })
              .range(from, to),
          ),
          readAllPages<RsvpLinkRow>((from, to) =>
            supabase
              .from('player_spond_links')
              .select('spond_member_id, player_id')
              .order('spond_member_id', { ascending: true })
              .range(from, to),
          ),
        ])
        return buildRsvpByPlayer(responses, links)
      } catch (e) {
        // Not applied yet degrades to silence, which renders identically
        // to a child with no link. Every other failure is a real one and
        // is surfaced as such to the hook, which the register still
        // never gates on.
        if (isMissingRelation(e)) return {}
        throw e
      }
    },
  })
}

// ---- Linked player replies, per event (players.view) ----------------
//
// THE POPULATION, AND WHY IT CAN BE STATED WITHOUT A SESSION. Every row in
// spond_event_responses belongs to a LINKED member: the foreign key into
// player_spond_links makes an unlinked member's reply unrepresentable
// (migration 0045). So grouping those rows by event and status counts the
// club's own children, and nothing else, for an event that no session has
// been planned from yet.
//
// WHAT IT IS NOT. Tonight's chips count the children a SESSION covers.
// This has no session, so it has no coverage to narrow by, and the screen
// that renders it says "Linked players" rather than borrowing Tonight's
// words. Two populations, two labels; the reply split itself is built by
// the one predicate in ../lib/tonight.
//
// THE READ IS TWO COLUMNS. spond_event_id and status, never the member id:
// the counts need no identifier, so none is fetched. Nothing here can
// resolve to a child even in memory.
export function spondEventResponseCountsKey() {
  return ['spond_rsvp', 'event_counts'] as const
}

interface SpondResponseCountRow {
  spond_event_id: string
  status: string
}

// `available` is false when 0045 has not been applied. An admin screen has
// to tell that apart from "nobody has replied", which is why the shape
// carries the flag rather than an empty record standing for both.
export interface SpondEventResponseCounts {
  byEvent: Record<string, ResponseCounts>
  available: boolean
}

export function useSpondEventResponseCounts(enabled = true) {
  const { caps } = useMyCapabilities()
  return useQuery({
    queryKey: spondEventResponseCountsKey(),
    enabled: enabled && caps.has('players.view'),
    retry: (count, error) => !isMissingRelation(error) && count < 2,
    queryFn: async (): Promise<SpondEventResponseCounts> => {
      try {
        const rows = await readAllPages<SpondResponseCountRow>((from, to) =>
          supabase
            .from('spond_event_responses')
            .select('spond_event_id, status')
            .order('spond_event_id', { ascending: true })
            .range(from, to),
        )
        const statuses = new Map<string, string[]>()
        for (const r of rows) {
          const list = statuses.get(r.spond_event_id)
          if (list) list.push(r.status)
          else statuses.set(r.spond_event_id, [r.status])
        }
        const byEvent: Record<string, ResponseCounts> = {}
        for (const [eventId, list] of statuses) byEvent[eventId] = countLinkedResponses(list)
        return { byEvent, available: true }
      } catch (e) {
        if (isMissingRelation(e)) return { byEvent: {}, available: false }
        throw e
      }
    },
  })
}

// ---- Spond member links (players.view to read, players.manage to write) ----

export function spondLinksKey() {
  return ['spond_links'] as const
}

interface SpondLinkRow {
  spond_member_id: string
  player_id: string
  matched_by: 'suggested' | 'chosen'
  created_at: string
}

// Every binding in the club. Small by construction (one per child at
// most) and read club wide, because the management screen shows progress
// per team and must also show a link whose child has moved team.
//
// `available` is false when 0045 has not been applied yet. The management
// screen must be able to tell that apart from "this club has linked
// nobody": silence is the right answer for context beside a register and
// the wrong answer for a screen whose entire job is the missing thing.
export interface SpondLinksRead {
  links: SpondLink[]
  available: boolean
}

export function useSpondLinks(enabled = true) {
  const { caps } = useMyCapabilities()
  return useQuery({
    queryKey: spondLinksKey(),
    enabled: enabled && caps.has('players.view'),
    retry: (count, error) => !isMissingRelation(error) && count < 2,
    queryFn: async (): Promise<SpondLinksRead> => {
      const { data, error } = await supabase
        .from('player_spond_links')
        .select('spond_member_id, player_id, matched_by, created_at')
        .order('spond_member_id', { ascending: true })
        .range(0, RSVP_MAX_ROWS - 1)
      if (error) {
        if (isMissingRelation(error)) return { links: [], available: false }
        throw error
      }
      return {
        available: true,
        links: (data as unknown as SpondLinkRow[]).map((r) => ({
          spondMemberId: r.spond_member_id,
          playerId: r.player_id,
          matchedBy: r.matched_by,
          createdAt: r.created_at,
        })),
      }
    },
  })
}

export interface LinkWriteInput {
  spondMemberId: string
  playerId: string
  matchedBy: 'suggested' | 'chosen'
}

export interface LinkWriteResult {
  written: number
  // The bindings somebody else claimed between the screen loading and the
  // press. Reported by member id so the caller can name them from the
  // candidate list it already holds.
  conflicted: string[]
  // Rows that failed for some other reason during the row by row retry.
  // Reported rather than thrown, because throwing out of a partly applied
  // loop would tell the manager nothing was saved when some of it was.
  failed: string[]
}

// The insert. The row carries EXACTLY four fields and is built by an
// explicit list rather than a spread, so no Spond display name can ride
// along from the candidate object even by accident. created_by is stamped
// by the database.
function linkRow(input: LinkWriteInput, clubId: string): Record<string, unknown> {
  return {
    club_id: clubId,
    spond_member_id: input.spondMemberId,
    player_id: input.playerId,
    matched_by: input.matchedBy,
  }
}

// Write one or many links. A duplicate key means somebody else linked
// that member or that child first; rather than rolling the whole batch
// back with nothing to act on, the conflicting rows are dropped and the
// rest retried once, and the caller is told which failed.
export function useInsertSpondLinks() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<LinkWriteResult, Error, LinkWriteInput[]>({
    mutationFn: async (inputs) => {
      if (!profile?.club_id) throw new Error('You must be signed in to link Spond members.')
      if (inputs.length === 0) return { written: 0, conflicted: [], failed: [] }
      const clubId = profile.club_id
      const { error } = await supabase.from('player_spond_links').insert(inputs.map((i) => linkRow(i, clubId)))
      if (!error) return { written: inputs.length, conflicted: [], failed: [] }
      if (error.code !== '23505') throw error

      // One row at a time on conflict, so a single contested member does
      // not cost the manager every other decision they just made. Nothing
      // throws out of this loop: by the time it is running, rows may
      // already have landed, and an exception here would report that
      // nothing saved when some of it did.
      const conflicted: string[] = []
      const failed: string[] = []
      let written = 0
      for (const input of inputs) {
        const { error: rowError } = await supabase.from('player_spond_links').insert(linkRow(input, clubId))
        if (!rowError) written++
        else if (rowError.code === '23505') conflicted.push(input.spondMemberId)
        else failed.push(input.spondMemberId)
      }
      return { written, conflicted, failed }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: spondLinksKey() }),
  })
}

// Remove a binding. The database drains that member's stored RSVP in the
// same statement, so nothing here has to sweep anything.
export function useDeleteSpondLink() {
  const qc = useQueryClient()
  return useMutation<void, Error, { spondMemberId: string }>({
    mutationFn: async ({ spondMemberId }) => {
      const { error } = await supabase
        .from('player_spond_links')
        .delete()
        .eq('spond_member_id', spondMemberId)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: spondLinksKey() })
      // A drained member's context is gone; let any open register refetch.
      qc.invalidateQueries({ queryKey: ['spond_rsvp'] })
    },
  })
}

// ---- Making OTJ's team assignment agree with Spond -------------------------

// The outcomes spond_reconcile_player_team (0049) returns. Every one of them
// is a normal thing to tell a manager, which is why they are RETURNED rather
// than raised: a bulk press has to be able to report them per child.
export type ReconcileOutcome =
  | 'moved'
  | 'already_matched'
  | 'stale'
  | 'no_registration'
  | 'not_linked'
  | 'stale_link'
  | 'member_linked_elsewhere'
  | 'player_linked_elsewhere'

export interface ReconcileResultRow {
  outcome: ReconcileOutcome
  playerId: string
  fromTeamId: string | null
  toTeamId: string | null
  linkCreated: boolean
}

interface ReconcileRpcRow {
  outcome?: string
  player_id?: string
  from_team_id?: string | null
  to_team_id?: string | null
  link_created?: boolean
}

const RECONCILE_OUTCOMES: ReconcileOutcome[] = [
  'moved',
  'already_matched',
  'stale',
  'no_registration',
  'not_linked',
  'stale_link',
  'member_linked_elsewhere',
  'player_linked_elsewhere',
]

// One sentence per outcome, a total Record rather than a chain with a
// default: the linking screen learned that lesson once already, when a
// default arm printed "Not a registered player" over every case it did not
// name. The compiler refuses a new outcome with no sentence.
export const RECONCILE_NOTE: Record<ReconcileOutcome, string> = {
  moved: '',
  already_matched: 'That player was already on that team, so nothing changed.',
  stale: 'Somebody moved that player while this screen was open, so nothing was changed. Reload and look again.',
  no_registration: 'That player has no registration in the current season, so there was nothing to change.',
  // The identity rule, refused by the database rather than by this screen.
  not_linked: 'That player is not linked to a Spond member, so nothing was changed. Confirm who they are first.',
  // The other half of it. The change was worked out from one Spond member,
  // and this player is linked to a different one now, so what was worked out
  // no longer describes them. Reloading is the remedy, not retrying.
  stale_link:
    'That player was linked to a different Spond member while this screen was open, so nothing was changed. Reload from Spond and look again.',
  member_linked_elsewhere:
    'That Spond member is already linked to a different registered player, so nothing was changed. Unlink them first if that link is wrong.',
  player_linked_elsewhere:
    'That player is already linked to a different Spond member, so nothing was changed. Unlink them first if that link is wrong.',
}

// PostgREST's answer when the function is not in the schema cache: the
// migration is gated and merging this does not apply it, so the screen has
// to be able to say so rather than showing a generic failure.
export function isMissingFunction(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  return code === 'PGRST202' || code === '42883'
}

export const RECONCILE_UNAVAILABLE =
  'The database change this needs has not been applied yet, so nothing was changed.'

// Move ONE child's current season registration to the team Spond has them
// on, optionally confirming which Spond member they are in the same
// transaction. The whole rule is the RPC's: the club, the actor, the
// capability and the season are derived server side, an unlinked child
// cannot be moved at all, and the expected team is what refuses a decision
// taken against a view somebody else has since changed. Nothing here retries
// and nothing here recovers a refusal into a different write.
//
// Bulk is this hook called once per child, each its own transaction, so a
// partial run is a set of individually complete moves and can be reported
// row by row. That is deliberate: one statement covering the whole press
// would make a single contested child cost a manager every other decision.
export function useReconcileSpondTeam() {
  const qc = useQueryClient()
  return useMutation<
    ReconcileResultRow,
    Error,
    {
      playerId: string
      expectedTeamId: string | null
      targetTeamId: string | null
      // EXACTLY ONE of these, and a null never means "any link will do".
      //
      // expectedMemberId is the proved path: the member whose Spond subgroups
      // produced the target. The RPC refuses (stale_link) if this child's link
      // no longer points at it, which is the race a bare "does this child have
      // a link" check cannot see: another manager can unlink that member and
      // correctly link the child to a different one whose Spond team is
      // somewhere else, and the child's OTJ team need not have moved, so the
      // expected-team check does not catch it either.
      //
      // confirmMemberId is the confirm path: the member a human has just said
      // this child is, bound in the same transaction as the move.
      expectedMemberId?: string | null
      confirmMemberId?: string | null
      batchId?: string | null
    }
  >({
    mutationFn: async ({ playerId, expectedTeamId, targetTeamId, expectedMemberId, confirmMemberId, batchId }) => {
      // Refused here as well as by the RPC, so a caller that gets it wrong
      // sees the mistake rather than a database error a manager might read as
      // being about their data.
      if ((expectedMemberId == null) === (confirmMemberId == null)) {
        throw new Error('That change did not save. Reload and try again.')
      }
      const { data, error } = await supabase.rpc('spond_reconcile_player_team', {
        p_player_id: playerId,
        p_expected_team_id: expectedTeamId,
        p_target_team_id: targetTeamId,
        p_expected_member_id: expectedMemberId ?? null,
        p_confirm_member_id: confirmMemberId ?? null,
        p_batch_id: batchId ?? null,
      })
      if (error) {
        if (isMissingFunction(error)) throw new Error(RECONCILE_UNAVAILABLE)
        throw error
      }
      const row = (Array.isArray(data) ? data[0] : data) as ReconcileRpcRow | undefined
      const outcome = row?.outcome
      // An unrecognised outcome is a failure, never a success: reporting
      // "done" off a shape this build does not understand is exactly how a
      // manager comes to believe a change landed that did not.
      if (!outcome || !RECONCILE_OUTCOMES.includes(outcome as ReconcileOutcome)) {
        throw new Error('That change did not save. Reload and try again.')
      }
      return {
        outcome: outcome as ReconcileOutcome,
        playerId: row?.player_id ?? playerId,
        fromTeamId: row?.from_team_id ?? null,
        toTeamId: row?.to_team_id ?? null,
        linkCreated: row?.link_created === true,
      }
    },
    onSettled: () => {
      // The registration moved, so every player reader refreshes; the link
      // may have been created, so the linking screen's own read does too.
      invalidatePlayerReads(qc)
      qc.invalidateQueries({ queryKey: spondLinksKey() })
    },
  })
}

export interface LinkCandidatesResult {
  members: LinkCandidate[]
  // True when the list is known to be short of the group. A member list
  // that is not provably complete must never be used to decide that a
  // stored link has no member behind it.
  truncated: boolean
  // How many members the server excluded as staff (Spond role holders)
  // and by admin config. Data, not just prose: zero members WITH
  // exclusions is a complete answer (a subgroup holding only staff),
  // while zero members with none is a read that proved nothing, and
  // linkLoadComplete decides between them.
  staffExcluded: number
  ignoredExcluded: number
  // The parent group members this team's mappings do not reach, so the
  // screen can say WHY a registered player has no candidate: their Spond
  // member sits in the group with no subgroup, or in another one.
  //
  // NULL is a third state and the reason this is not an empty array: the
  // deployed function is gated behind its own reviewed deploy, so between
  // merging this and running that workflow the response carries no such
  // field. Null means "this deployment does not answer", an empty array
  // means "it answered, and the mapping misses nobody", and only the
  // second may be reasoned from. Same discipline as the exclusion counts
  // above.
  diagnosticMembers: SpondGroupMember[] | null
  // Whether that scan saw the whole parent group. False on a group the
  // organiser account cannot see, or a cap that bit; no diagnosis is
  // stated then.
  diagnosticComplete: boolean
  warnings: string[]
}

// Load one team's Spond members through spond-link-members. A MUTATION,
// not a query, deliberately: it costs a Spond login round trip and should
// be a decision the manager makes, not a side effect of arriving on a
// screen. gcTime 0 means the display names it returns are dropped from
// the cache as soon as nothing renders them, so a transient name cannot
// outlive the visit.
export function useLoadSpondLinkCandidates() {
  return useMutation<LinkCandidatesResult, Error, { teamId: string }>({
    gcTime: 0,
    mutationFn: async ({ teamId }) => {
      const { data, error } = await supabase.functions.invoke('spond-link-members', {
        body: { team_id: teamId },
      })
      if (error) {
        let message = 'Could not load the Spond members. Try again.'
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
      const body = (data ?? {}) as {
        members?: { spond_member_id?: string; display_name?: string }[]
        truncated?: boolean
        staff_excluded?: number
        ignored_excluded?: number
        diagnostic_members?: { display_name?: string; spond_member_id?: unknown; subgroup_ids?: unknown }[]
        diagnostic_complete?: boolean
        warnings?: string[]
      }
      return {
        members: (body.members ?? [])
          .filter((m) => typeof m.spond_member_id === 'string' && typeof m.display_name === 'string')
          .map((m) => ({ spondMemberId: m.spond_member_id as string, displayName: m.display_name as string })),
        truncated: body.truncated === true,
        // A deployed function predating these fields sends none, which
        // reads as zero exclusions: exactly the old completeness rule.
        staffExcluded: typeof body.staff_excluded === 'number' ? body.staff_excluded : 0,
        ignoredExcluded: typeof body.ignored_excluded === 'number' ? body.ignored_excluded : 0,
        // Absent field to null, so a deployment that does not answer this
        // is not read as "the mapping misses nobody". Only the two fields
        // the closed diagnostic shape carries are taken across; anything
        // else a response held would be dropped here rather than reach the
        // screen.
        diagnosticMembers: Array.isArray(body.diagnostic_members)
          ? body.diagnostic_members
              .filter((m) => typeof m?.display_name === 'string' && m.display_name.length > 0)
              .map((m) => ({
                displayName: m.display_name as string,
                // A deployment predating the reconciliation sends no id,
                // which lands as '' and reads as no identity: the setup
                // sentences are unaffected and no reconciliation action is
                // offered, exactly the null-versus-empty discipline the
                // diagnostics themselves ride. An id that is not the shape
                // the links table accepts is dropped here too rather than
                // offered and refused later.
                spondMemberId: isSpondMemberId(m.spond_member_id) ? m.spond_member_id : '',
                subgroupIds: Array.isArray(m.subgroup_ids)
                  ? m.subgroup_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
                  : [],
              }))
          : null,
        diagnosticComplete: body.diagnostic_complete === true,
        warnings: body.warnings ?? [],
      }
    },
  })
}

// ---- The register (players.view to read, sessions.create to write) ---------

interface RegisterEntryRow {
  session_id: string
  player_id: string
  present: boolean
  included_in_groups: boolean
  bib_colour_override: string | null
  source: 'roster' | 'manual'
}

// The one column list, so the two reads below cannot drift apart. A read
// that fetched present but not included_in_groups would silently give
// every child a false inclusion, which is the shape of the defect 0047
// exists to remove.
const REGISTER_COLUMNS = 'session_id, player_id, present, included_in_groups, bib_colour_override, source'

export function toRegisterEntry(r: RegisterEntryRow): RegisterEntry {
  return {
    sessionId: r.session_id,
    playerId: r.player_id,
    present: r.present,
    includedInGroups: r.included_in_groups,
    bibColourOverride: r.bib_colour_override,
    source: r.source,
  }
}

export function registerKey(sessionId: string) {
  return ['register_entries', sessionId] as const
}

// The register for one session. The caller must surface isError rather
// than treating a failed read as an empty register: "nobody is here" and
// "we could not load who is here" look identical otherwise, and the
// second one must never be written on top of.
export function useRegisterEntries(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: registerKey(sessionId ?? ''),
    enabled: enabled && !!sessionId,
    queryFn: async (): Promise<RegisterEntry[]> => {
      const { data, error } = await supabase
        .from('register_entries')
        .select(REGISTER_COLUMNS)
        .eq('session_id', sessionId as string)
      if (error) throw error
      return (data as unknown as RegisterEntryRow[]).map(toRegisterEntry)
    },
  })
}

// ---- Saving tonight's groups ---------------------------------------
//
// ONE user act, one write. The coach organises the whole night in a local
// draft and commits it once, so this takes the delta and sends it as a
// single upsert rather than a mutation per child.
//
// ATOMICITY, STATED HONESTLY. PostgREST turns one upsert into one
// INSERT ... ON CONFLICT statement, and RLS WITH CHECK is evaluated per
// row inside it, so a row the policy refuses fails the whole statement
// and nothing lands. That is all-or-nothing for this call. It is NOT a
// transaction across the refetch that follows, which is why the screen
// still compares the readback with the draft before it says Saved: the
// claim "your arrangement is stored" is only ever made about data that
// came back from the database.
export function useSaveTonight() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation<RegisterEntry[], Error, { sessionId: string; changes: TonightChange[]; removals?: string[] }>({
    mutationFn: async ({ sessionId, changes, removals = [] }) => {
      // ONE UPSERT PER KEY SHAPE, not one for the whole delta. postgrest-js
      // unions the keys of every object in an array into the `columns`
      // parameter, so a mixed batch proposes NULL for a column an
      // individual row omitted: it would fail on the NOT NULL columns and
      // wipe a stored bib on the nullable one. tonightUpsertBatches groups
      // the rows so each request writes exactly the columns it means to.
      // See its header for why `defaultToNull: false` is worse.
      for (const rows of tonightUpsertBatches(changes, profile?.club_id ?? null)) {
        const { error } = await supabase
          .from('register_entries')
          .upsert(rows, { onConflict: 'session_id,player_id' })
        if (error) throw error
      }
      // Guests the coach took off the list. Separate from the upsert
      // because there is no way to express "remove" in one, and second so
      // a failure here still leaves the arrangement written.
      if (removals.length > 0) {
        const { error } = await supabase
          .from('register_entries')
          .delete()
          .eq('session_id', sessionId)
          .in('player_id', removals)
        if (error) throw error
      }
      // The authoritative readback, in the same act. Returning it rather
      // than only invalidating means the caller compares against what the
      // database actually holds and not against its own optimism.
      const { data, error } = await supabase
        .from('register_entries')
        .select(REGISTER_COLUMNS)
        .eq('session_id', sessionId)
      if (error) throw error
      const entries = (data as unknown as RegisterEntryRow[]).map(toRegisterEntry)
      qc.setQueryData<RegisterEntry[]>(registerKey(sessionId), entries)
      return entries
    },
    // Invalidate once, at the end, so a screen that is showing the
    // readback does not immediately refetch over it.
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: registerKey(vars.sessionId) })
    },
  })
}

// The per row writers this screen used to need are gone. Tonight edits a
// local draft and commits it once through useSaveTonight, so there is no
// longer a mutation that fires on a tick. applyRegisterPatch went with
// them: nothing optimistically patches a single register row any more.
