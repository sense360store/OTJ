// Shared types and taxonomy for the app. The component-facing shapes here
// (camelCase) are the contract the screens speak. The seed arrays that once
// stood in for the backend were retired in Phase 2: runtime data now comes
// from src/lib/queries.ts, which reads Supabase and maps the snake_case rows
// into these types. Taxonomy constants and sessionMinutes stay here because
// they are static and shared, not server data.

export type CornerKey = 'technical' | 'physical' | 'social' | 'psychological'
export type Phase = 'Warm-Up' | 'Skill' | 'Game' | 'Cool-Down'
export type Level = 'Foundation' | 'Developing' | 'Advanced'
export type MediaType = 'video' | 'youtube' | 'image' | 'pdf'
export type SessionStatus = 'upcoming' | 'completed'
export type Role = 'coach' | 'admin' | 'parent'

// A club team. Teams are a filter and a default, never access control.
export interface Team {
  id: string
  name: string
}

// A club member as the Users screen and the owner labels see one.
export interface Member {
  id: string
  fullName: string
  avatar: string | null
  // Storage path of the uploaded profile photo, null for initials.
  avatarUrl: string | null
  role: Role
  teamId: string | null
  joined: string
}

// The club row. crestUrl is a storage path in the media bucket or a full URL.
export interface Club {
  id: string
  name: string
  motto: string
  crestUrl: string | null
}

export interface CornerInfo {
  key: CornerKey
  label: string
  short: string
  color: string
}

export interface MediaItem {
  id: string
  name: string
  type: MediaType
  kind?: string
  size?: string
  dims?: string
  length?: string
  pages?: number
  yt?: string
  storagePath?: string
  createdBy?: string
  usedIn?: number
  // Attribution for third-party content (CLAUDE.md, Third-party content).
  // Shown as a small line wherever the image renders large.
  sourceUrl?: string
  sourceLabel?: string
}

export interface Drill {
  id: string
  title: string
  corner: CornerKey
  skill: string
  ages: string[]
  level: Level
  duration: number
  players: string
  area: string
  equipment: string[]
  mediaId: string | null
  summary: string
  points: string[]
  tags: string[]
  createdBy?: string
  // FA session model fields. setupNotes describes the layout, easier and
  // harder hold STEP adaptations, theme and format are FA taxonomy text
  // (suggestions in src/lib/fa.ts), source carries attribution.
  setupNotes: string
  easier: string[]
  harder: string[]
  theme: string
  format: string
  sourceUrl: string
  sourceLabel: string
  // Drives the "what's new" recency on Home.
  createdAt: string
}

export interface Activity {
  phase: Phase
  drillId?: string
  title?: string
  duration: number
}

export interface Template {
  id: string
  name: string
  author: string
  focus: string
  activities: Activity[]
  // FA session model fields. intentions copy onto a session built from the
  // template; programme and week are the legacy grouping labels, kept for
  // one phase as the backfill source and no longer written by new code.
  intentions: string[]
  programme: string
  week: number | null
  // Entity-backed programme membership: which programme this template is a
  // week of, and which week. Both null for a standalone template.
  programmeId: string | null
  programmeWeek: number | null
  sourceUrl: string
  sourceLabel: string
  // Drives the "what's new" recency on Home.
  createdAt: string
}

// A programme: an ordered set of weekly session templates, the FA six-week
// format being the model. weeks is the planned length; the week templates
// hang off Template.programmeId and programmeWeek. pdfMediaId attaches the
// offline copy from the media library, and source carries attribution for
// imported programmes.
export interface Programme {
  id: string
  name: string
  focus: string
  summary: string
  intentions: string[]
  weeks: number
  pdfMediaId: string | null
  sourceUrl: string
  sourceLabel: string
  createdBy?: string
}

export interface Session {
  id: string
  name: string
  date: string
  time: string
  ageGroup: string
  venue: string
  focus: string
  status: SessionStatus
  activities: Activity[]
  // Visibility is club-wide; coachId carries ownership for the edit and
  // delete affordances and the My sessions filter. teamId is a filter.
  coachId: string
  teamId: string | null
  // FA session model fields: intentions render at the top FA style, space is
  // the setup area, source carries attribution.
  intentions: string[]
  space: string
  sourceUrl: string
  sourceLabel: string
  // Shared live state, written only by the live view's driver mutation. Both
  // null when the session is not live. The index points into activities and
  // the timestamp is when that activity began; watchers compute the running
  // clock from it locally.
  liveActivityIndex: number | null
  liveActivityStartedAt: string | null
}

// ---- Taxonomy ----------------------------------------------------------
export const CORNERS: Record<CornerKey, CornerInfo> = {
  technical: { key: 'technical', label: 'Technical', short: 'TEC', color: 'var(--c-technical)' },
  physical: { key: 'physical', label: 'Physical', short: 'PHY', color: 'var(--c-physical)' },
  social: { key: 'social', label: 'Social', short: 'SOC', color: 'var(--c-social)' },
  psychological: { key: 'psychological', label: 'Psychological', short: 'PSY', color: 'var(--c-psych)' },
}

export const cornerClass: Record<CornerKey, string> = {
  technical: 'technical',
  physical: 'physical',
  social: 'social',
  psychological: 'psych',
}

export const PHASES: Phase[] = ['Warm-Up', 'Skill', 'Game', 'Cool-Down']
// Skill options moved to the FA player skills in src/lib/fa.ts; stored skill
// values stay free text and existing values keep appearing in selects.
export const AGES: string[] = ['U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12']
export const LEVELS: Level[] = ['Foundation', 'Developing', 'Advanced']

export function sessionMinutes(s: { activities: Activity[] }): number {
  return s.activities.reduce((a, x) => a + (x.duration || 0), 0)
}

// ---- YouTube helpers ---------------------------------------------------
// Pure helpers, shared by the media card, the upload modal and the drill
// detail. They derive the video id from any of the common YouTube URL shapes
// and build the public thumbnail, which needs no signed URL.

export function youtubeId(url: string | undefined | null): string | null {
  if (!url) return null
  const patterns = [/youtu\.be\/([\w-]{11})/, /[?&]v=([\w-]{11})/, /\/embed\/([\w-]{11})/, /\/shorts\/([\w-]{11})/]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

export function youtubeThumb(url: string | undefined | null): string | null {
  const id = youtubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

// ---- Samples -------------------------------------------------------------
// A sample is a media row with nothing behind it: no stored file and no
// playable YouTube link. The ten seeded demo rows ship this way (two of them
// carry a bare youtu.be link with no video id, which plays nothing). Samples
// are badged plainly, never offer a View or Play action, and can be replaced
// with real content or removed.
export function isSampleMedia(m: Pick<MediaItem, 'storagePath' | 'yt'>): boolean {
  return !m.storagePath && !youtubeId(m.yt)
}
