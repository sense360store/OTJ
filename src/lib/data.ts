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

// The system role keys, which double as the role_kind enum values behind
// profiles.role (the denormalised display primary). RBAC v2 made roles data:
// access flows from the roles a member holds in member_roles, never from
// this type. Custom roles exist only as RoleInfo rows.
export type Role = 'admin' | 'manager' | 'coach' | 'parent'

// Privilege order for the system roles: sorting role badges, ordering grid
// columns and picking the display primary all use it. Highest first.
export const ROLE_PRECEDENCE: Role[] = ['admin', 'manager', 'coach', 'parent']

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  coach: 'Coach',
  parent: 'Parent',
}

// A club team. Teams are a filter and a default, never access control.
export interface Team {
  id: string
  name: string
}

// A role as a row in the roles table: the four seeded system roles plus any
// custom roles the club's admins create. key is the stable slug code refers
// to; label is what the UI shows; system rows cannot be deleted or re-keyed.
export interface RoleInfo {
  id: string
  key: string
  label: string
  system: boolean
}

// A club member as the Users screen and the owner labels see one. roles and
// teamIds are the real assignment sets (member_roles and member_teams);
// role and teamId remain the denormalised display primaries and sit in no
// access decision. allTeams means every team, current and future, and while
// it is true the specific teamIds are moot.
export interface Member {
  id: string
  fullName: string
  avatar: string | null
  // Storage path of the uploaded profile photo, null for initials.
  avatarUrl: string | null
  role: Role
  teamId: string | null
  joined: string
  roles: RoleInfo[]
  teamIds: string[]
  allTeams: boolean
}

// A capability from the catalogue: a named permission such as
// drills.create. Policies check capabilities through has_perm(), and the
// Users screen's tick grid renders the catalogue and edits which roles
// hold which capabilities.
export interface Capability {
  key: string
  label: string
  description: string
}

// One tick in the role to capability mapping, keyed by the roles table id
// since 0015_rbac_roles re-keyed role_capabilities from the enum.
export interface RoleCapability {
  roleId: string
  capability: string
}

// The two administrative capabilities the database reserves to the admin
// system role. The grid never offers them on any other role; a trigger
// refuses them server side whatever writes the table.
export const RESERVED_CAPABILITIES = ['users.manage', 'club.manage']

// The FA importers write several entities in one call as the signed in
// caller, so the import affordance needs every capability the call would
// use: a session import creates a template plus its drills and media, and a
// programme import additionally creates the programme row.
export const FA_IMPORT_CAPS = ['templates.create', 'drills.create', 'media.create']
export const FA_PROGRAMME_IMPORT_CAPS = [...FA_IMPORT_CAPS, 'programmes.create']

export function hasAllCaps(caps: ReadonlySet<string>, needed: readonly string[]): boolean {
  return needed.every((c) => caps.has(c))
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
  // Embedded video player URL (an FA Vimeo session, for example). Set instead
  // of storagePath for a video that streams from its host rather than a stored
  // file.
  embedUrl?: string
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
  // Null when the drill was never classified (FA imports carry topic tags
  // instead). The UI shows the tags in the corner slot rather than
  // defaulting a corner that was never set.
  corner: CornerKey | null
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
  // The owning member, for the owner arm of the edit and delete affordances.
  // Templates from before ownership existed, and FA imports, have none and
  // are curated through templates.manage only.
  createdBy?: string
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
  // Where this session came from when a programme was applied to a team:
  // the programme and its week. Both null for a session planned by hand.
  programmeId: string | null
  programmeWeek: number | null
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

// ---- Role helpers --------------------------------------------------------
// Pure functions over the RBAC v2 shapes, shared by the Users screen, the
// shell and the assignment mutations.

// Sort position for a role: system roles in privilege order, custom roles
// after them all.
export function rolePrecedence(role: Pick<RoleInfo, 'key' | 'system'>): number {
  const i = role.system ? ROLE_PRECEDENCE.indexOf(role.key as Role) : -1
  return i === -1 ? ROLE_PRECEDENCE.length : i
}

// Privilege order for badges and grid columns: admin, manager, coach, parent,
// then custom roles alphabetically by label.
export function sortRoles<T extends Pick<RoleInfo, 'key' | 'label' | 'system'>>(roles: T[]): T[] {
  return [...roles].sort((a, b) => {
    const d = rolePrecedence(a) - rolePrecedence(b)
    if (d !== 0) return d
    return a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
  })
}

// The display primary for profiles.role: the highest precedence system role
// held, or coach when only custom roles are held. Mirrors the invite-user
// function so the two never disagree.
export function primaryRoleKey(roles: Pick<RoleInfo, 'key' | 'system'>[]): Role {
  const systemKeys = roles.filter((r) => r.system).map((r) => r.key)
  return ROLE_PRECEDENCE.find((k) => systemKeys.includes(k)) ?? 'coach'
}

// A custom role's stable key, derived from its label. Must satisfy the
// database slug constraint, one lowercase word of letters, digits and
// underscores starting with a letter or digit. Empty when the label has
// nothing usable in it, which the UI treats as not ready to create.
export function roleKeyFromLabel(label: string): string {
  return label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63)
}

// ---- Team membership helpers ----------------------------------------------

// The teams a member effectively belongs to: every club team while the all
// teams flag is on (current and future teams alike, which is why the flag is
// durable), otherwise the specific selection.
export function memberTeamIds(
  member: Pick<Member, 'allTeams' | 'teamIds'>,
  allTeamIds: string[],
): string[] {
  return member.allTeams ? allTeamIds : member.teamIds
}

// The display primary team after a membership edit: keep the current primary
// while it is still in the selection, otherwise fall to the first selected
// team, or none.
export function nextPrimaryTeamId(current: string | null, selected: string[]): string | null {
  if (current && selected.includes(current)) return current
  return selected[0] ?? null
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

// ---- Embedded video players ---------------------------------------------
// A video media row can stream from a third party player rather than a stored
// file. Only allowlisted hosts render, so a stored embed_url can never point
// the iframe at an arbitrary origin. player.vimeo.com backs the FA video
// session import; this is the browser side mirror of the importer's allowlist.
const EMBED_HOSTS = ['player.vimeo.com']

export function embedSrc(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && EMBED_HOSTS.includes(u.hostname.toLowerCase()) ? u.href : null
  } catch {
    return null
  }
}

// ---- Samples -------------------------------------------------------------
// A sample is a media row with nothing behind it: no stored file and no
// playable YouTube link. The ten seeded demo rows ship this way (two of them
// carry a bare youtu.be link with no video id, which plays nothing). Samples
// are badged plainly, never offer a View or Play action, and can be replaced
// with real content or removed.
export function isSampleMedia(m: Pick<MediaItem, 'storagePath' | 'yt' | 'embedUrl'>): boolean {
  return !m.storagePath && !youtubeId(m.yt) && !m.embedUrl
}
