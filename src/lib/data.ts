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
export const SKILLS: string[] = [
  'Dribbling',
  'Passing',
  'Shooting',
  'Ball Mastery',
  '1v1',
  'Turning',
  'Defending',
  'Goalkeeping',
  'Movement',
  'Fun Game',
]
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
