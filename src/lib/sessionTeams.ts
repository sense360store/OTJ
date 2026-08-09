// Which teams a session covers.
//
// Coverage is explicit: the session_teams rows are the answer. A session
// saved before coverage existed has no rows, and its frozen
// sessions.team_id names the one team it was for. Anything else is
// UNSET, and unset is shown as unset rather than guessed at.
//
// That last point is the whole design. An earlier version read "no rows"
// as "the whole club", which meant deleting a team silently widened every
// session that had covered only that team: the row cascaded away,
// coverage read as empty, empty read as everyone, and the register for a
// single team session quietly listed every child in the club. Absence now
// means absence. A session whose only team was deleted reads as unset,
// the screens say so, and a coach sets it again in one tap.
import type { Session, Team } from './data'

export type Coverage =
  | { kind: 'teams'; teamIds: string[] }
  | { kind: 'legacy'; teamIds: string[] }
  | { kind: 'unset'; teamIds: string[] }

type SessionCoverage = Pick<Session, 'teamId' | 'teamIds'>

export function coverageOf(session: SessionCoverage): Coverage {
  if (session.teamIds.length > 0) return { kind: 'teams', teamIds: session.teamIds }
  if (session.teamId) return { kind: 'legacy', teamIds: [session.teamId] }
  return { kind: 'unset', teamIds: [] }
}

// The team ids a session covers. Never widens: an unset session covers
// nothing, and the caller decides what to show for that.
export function coveredTeamIds(session: SessionCoverage): string[] {
  return coverageOf(session).teamIds
}

// Whether the session covers every team the club currently has. Only ever
// true from explicit rows, so it cannot be reached by deleting teams.
export function coversWholeClub(session: SessionCoverage, allTeamIds: string[]): boolean {
  const covered = coveredTeamIds(session)
  if (covered.length === 0 || allTeamIds.length === 0) return false
  return allTeamIds.every((id) => covered.includes(id))
}

// Whether the session covers any of the given teams. An unset session
// matches nothing, so a team filter hides it rather than showing it
// everywhere.
export function sessionCoversAnyTeam(session: SessionCoverage, teamIds: string[]): boolean {
  if (teamIds.length === 0) return false
  return coveredTeamIds(session).some((id) => teamIds.includes(id))
}

// Whether a team filter on a SCHEDULE should show this session.
//
// Deliberately more generous than sessionCoversAnyTeam: a session nobody
// has tagged yet stays visible to everyone, exactly as a team-less session
// did before coverage existed. Hiding it would make a coach's session
// vanish from their own schedule because they had not ticked a team.
//
// The register uses the strict rule instead, because there the cost runs
// the other way: listing children who were never expected.
export function sessionVisibleToTeams(session: SessionCoverage, teamIds: string[]): boolean {
  const coverage = coverageOf(session)
  if (coverage.kind === 'unset') return true
  return coverage.teamIds.some((id) => teamIds.includes(id))
}

// The one team a session is for, or null when it covers several, none, or
// the whole club. Screens use it to default a team scoped affordance.
export function soleCoveredTeamId(session: SessionCoverage): string | null {
  const covered = coveredTeamIds(session)
  return covered.length === 1 ? covered[0] : null
}

// A stable key for "these sessions cover the same teams", for grouping a
// programme's applied sessions. Unset sessions share the empty key, so a
// programme applied before anyone set coverage still groups as one.
export function coverageKey(session: SessionCoverage): string {
  return [...coveredTeamIds(session)].sort().join(',')
}

// The label every session surface shows.
export function sessionTeamsLabel(
  session: SessionCoverage,
  teamById: Record<string, Team | undefined>,
): string {
  const allIds = Object.keys(teamById)
  const coverage = coverageOf(session)
  if (coverage.kind === 'unset') return 'Teams not set'
  if (coversWholeClub(session, allIds)) return 'All teams'
  const names = coverage.teamIds
    .map((id) => teamById[id]?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b))
  // Rows naming only teams that have since been deleted: the caches will
  // catch up, and until they do this is honest about knowing nothing.
  if (names.length === 0) return 'Teams not set'
  return names.join(', ')
}

// The toggle a coverage picker runs. Unlike the earlier version this may
// return an empty selection: a coach clearing every team is a real state
// the planner shows as unset, not something to silently prevent.
export function toggleCoveredTeam(selected: string[], teamId: string): string[] {
  return selected.includes(teamId) ? selected.filter((id) => id !== teamId) : [...selected, teamId]
}
