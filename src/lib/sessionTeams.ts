// The covered teams model (ADR-0008): a session covers teams through
// session_teams rows, with the frozen sessions.team_id as the read fallback
// for legacy rows. These pure helpers are the single place that fallback
// lives, so every screen resolves coverage the same way: rows if any, else
// the one legacy team, else the whole club.
import type { Session, Team } from './data'

// The team ids a session covers. allTeamIds is the club's current teams;
// a legacy club session (no rows, no team) covers all of them.
export function coveredTeamIds(session: Pick<Session, 'teamId' | 'teamIds'>, allTeamIds: string[]): string[] {
  if (session.teamIds.length > 0) return session.teamIds
  if (session.teamId) return [session.teamId]
  return allTeamIds
}

// Whether the session covers any of the given teams. An empty candidate
// list never matches. Rows for teams since deleted match nothing until the
// caches refetch; the state is transient only, because the team FK cascade
// removes the rows server side and the team delete invalidates the sessions
// cache.
export function sessionCoversAnyTeam(session: Pick<Session, 'teamId' | 'teamIds'>, teamIds: string[]): boolean {
  if (teamIds.length === 0) return false
  if (session.teamIds.length > 0) return session.teamIds.some((id) => teamIds.includes(id))
  if (session.teamId) return teamIds.includes(session.teamId)
  return true
}

// Whether the session is a whole club slot: explicit rows spanning every
// current team, or a legacy row with no team.
export function coversWholeClub(session: Pick<Session, 'teamId' | 'teamIds'>, allTeamIds: string[]): boolean {
  if (session.teamIds.length > 0) {
    return allTeamIds.length > 0 && allTeamIds.every((id) => session.teamIds.includes(id))
  }
  return session.teamId == null
}

// The display label every session surface uses: "All teams" for a whole
// club slot with explicit rows, "Club" for a legacy no team row (its
// historical label), the team names for a subset, the one name for a
// legacy team row. Rows naming only deleted teams (a transient cache state,
// see sessionCoversAnyTeam) fall back to the frozen ladder, matching how
// the filters treat them, never claiming All teams for a session a team
// scoped view is hiding.
export function sessionTeamsLabel(
  session: Pick<Session, 'teamId' | 'teamIds'>,
  teamById: Record<string, Team | undefined>,
): string {
  const allIds = Object.keys(teamById)
  if (session.teamIds.length > 0) {
    if (coversWholeClub(session, allIds)) return 'All teams'
    const names = session.teamIds
      .map((id) => teamById[id]?.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b))
    if (names.length > 0) return names.join(', ')
  }
  if (session.teamId) return teamById[session.teamId]?.name ?? 'Team'
  return 'Club'
}

// The one team a session is really about, or null: exactly one covered team
// resolves to it, a legacy row resolves through the frozen column, anything
// broader has no single team. Programme progress groups by this, and the
// Spond link and board picker use it as their team hint.
export function soleCoveredTeamId(session: Pick<Session, 'teamId' | 'teamIds'>): string | null {
  if (session.teamIds.length === 1) return session.teamIds[0]
  if (session.teamIds.length === 0) return session.teamId
  return null
}

// The diff a save applies to session_teams: pair rows are inserted and
// deleted, never updated. Order independent and duplicate safe.
export function sessionTeamsDiff(current: string[], desired: string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current)
  const want = new Set(desired)
  return {
    add: [...want].filter((id) => !cur.has(id)),
    remove: [...cur].filter((id) => !want.has(id)),
  }
}

// Toggling a covered team in the planner: a session always covers at least
// one team, so unticking the last selected team is refused rather than
// leaving an unsaveable empty selection.
export function toggleCoveredTeam(selected: string[], teamId: string): string[] {
  if (selected.includes(teamId)) {
    if (selected.length === 1) return selected
    return selected.filter((id) => id !== teamId)
  }
  return [...selected, teamId]
}

// The bib colour catalogue: the labels a team's default bib (and later a
// register entry's override) chooses from, with a swatch colour for the
// dot beside the label. Values are stored lowercase in teams.bib_colour.
export const BIB_COLOURS: { value: string; label: string; swatch: string }[] = [
  { value: 'red', label: 'Red', swatch: '#e23b3b' },
  { value: 'blue', label: 'Blue', swatch: '#1f43d6' },
  { value: 'green', label: 'Green', swatch: '#16a34a' },
  { value: 'yellow', label: 'Yellow', swatch: '#f4c020' },
  { value: 'orange', label: 'Orange', swatch: '#ef8e1b' },
  { value: 'purple', label: 'Purple', swatch: '#7c4dff' },
  { value: 'pink', label: 'Pink', swatch: '#ec4899' },
  { value: 'white', label: 'White', swatch: '#f4f4f5' },
  { value: 'black', label: 'Black', swatch: '#18181b' },
]

export function bibSwatch(value: string | null | undefined): string | null {
  if (!value) return null
  return BIB_COLOURS.find((b) => b.value === value)?.swatch ?? null
}
