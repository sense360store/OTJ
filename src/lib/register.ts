// The session register: who was there, and what bib they wore.
//
// This is the coach's own record and it stands alone. It needs no Spond
// configuration, no member linking and no RSVP data to be completely
// useful: open the session, see the children the session covers, tick
// the ones in front of you. Release B adds RSVP as context beside a row,
// and if that context is missing or fails to load the register keeps
// working exactly as it does here.
//
// Everything below is pure so the pitch side screen is a thin shell over
// it, and so the rules that matter (who is listed, what bib they wear,
// who can still be added) are unit tested rather than argued about.
import { effectiveBib, bibSwatch } from './bibs'
import type { Player, RegisteredPlayer, Team } from './data'

export interface RegisterEntry {
  sessionId: string
  playerId: string
  present: boolean
  bibColourOverride: string | null
  source: 'roster' | 'manual'
}

export interface RegisterRow {
  player: Player
  present: boolean
  // The override as stored, so the select can show "Team default", a
  // colour, or "No bib" without inferring.
  bibValue: string
  // What they actually wear once the team default is applied.
  bibColour: string | null
  bibSwatch: string | null
  overridden: boolean
  // True when the row exists only because a coach added them on the day.
  // With `present`, this is what pins a row inside the register's Going
  // view (../lib/registerScope): between them they are the marks that say
  // something. A row once carried a hasEntry flag as well, meaning any
  // register entry at all, and pinning on that put an unticked child
  // reading "No reply" inside a list headed Going. An entry that records
  // neither presence nor a quick add is not a statement about tonight, so
  // there is nothing left for such a flag to be used for.
  manual: boolean
}

export interface RegisterGroup {
  // Null for the Unassigned group.
  teamId: string | null
  teamName: string
  rows: RegisterRow[]
  presentCount: number
}

export interface RegisterView {
  groups: RegisterGroup[]
  playerTotal: number
  presentTotal: number
}

// The label the Unassigned group carries. A child with no team is still
// a child of the club, and on a whole club night they are expected.
export const UNASSIGNED_GROUP = 'Unassigned'

// Which players a session lists.
//
// A session covering every team is a whole club night, so it lists every
// registered child INCLUDING those with no team yet. That is the least
// surprising thing pitch side: the alternative hides a real child from a
// register that claims to cover the whole club, and the coach only finds
// out when they are standing in front of them.
//
// A session covering a subset of teams lists exactly those teams. An
// unassigned child is not on any of them, so listing them there would be
// noise; they remain one tap away through quick add.
export function rosterForSession(
  players: Player[],
  coveredTeamIds: string[],
  wholeClub: boolean,
): Player[] {
  if (wholeClub) return players
  const covered = new Set(coveredTeamIds)
  return players.filter((p) => p.teamId !== null && covered.has(p.teamId))
}

// The season's registrations reduced to the children who can actually be
// ticked in. A withdrawn registration is not part of the active roster, so
// it never appears on a register and cannot be quick added. Pending is
// included: a child whose paperwork is still moving is still standing in
// front of the coach.
//
// The one exception is a child who was already marked on this register and
// has since been withdrawn. Dropping them would silently rewrite a record of
// who was at a session that already happened, and change its counts, so an
// existing entry keeps them listed. Passing no entries keeps the plain rule.
export function activeRoster(
  rows: RegisteredPlayer[],
  entries: Pick<RegisterEntry, 'playerId'>[] = [],
): Player[] {
  const marked = new Set(entries.map((e) => e.playerId))
  return rows
    .filter((r) => r.status !== 'withdrawn' || marked.has(r.playerId))
    .map((r) => ({
      id: r.playerId,
      teamId: r.teamId,
      displayName: r.displayName,
      shirtNumber: r.shirtNumber,
      createdBy: r.createdBy,
    }))
}

// Register order is alphabetical by name, not by shirt number the way the
// Players screen orders. At a gate a coach is matching the name a parent
// just said, and half a junior squad has no shirt number, so a number
// first order scatters the children a coach is looking for.
export function registerOrder(a: Player, b: Player): number {
  return a.displayName.localeCompare(b.displayName)
}

function groupName(teamId: string | null, teamById: Record<string, Team | undefined>): string {
  if (teamId === null) return UNASSIGNED_GROUP
  return teamById[teamId]?.name ?? 'Team'
}

function toRow(player: Player, entry: RegisterEntry | undefined, teamDefault: string | null): RegisterRow {
  const override = entry?.bibColourOverride ?? null
  const colour = effectiveBib(override, teamDefault)
  return {
    player,
    present: entry?.present ?? false,
    bibValue: override ?? '',
    bibColour: colour,
    bibSwatch: bibSwatch(colour),
    overridden: override !== null,
    manual: entry?.source === 'manual',
  }
}

// Build the whole view: the covered teams in club order, each with its
// players, then anyone added manually from outside those teams, grouped
// under their own team so a guest never looks like a squad member.
//
// A covered team with no players still gets a group. An empty team is a
// fact worth seeing, not a row to hide.
export function buildRegister(
  players: Player[],
  coveredTeamIds: string[],
  teams: Team[],
  entries: RegisterEntry[],
  wholeClub: boolean,
): RegisterView {
  const teamById: Record<string, Team | undefined> = Object.fromEntries(teams.map((t) => [t.id, t]))
  const entryByPlayer = new Map(entries.map((e) => [e.playerId, e]))
  const listed = rosterForSession(players, coveredTeamIds, wholeClub)
  const listedIds = new Set(listed.map((p) => p.id))

  // Anyone with an entry who is not otherwise listed is a guest: a quick
  // add, or a player whose team changed after they were ticked in.
  const guests = players.filter((p) => !listedIds.has(p.id) && entryByPlayer.has(p.id))

  // Group order: the covered teams in the club's own order, then
  // Unassigned, then the guests' teams.
  const orderedTeamIds: (string | null)[] = teams
    .filter((t) => (wholeClub ? true : coveredTeamIds.includes(t.id)))
    .map((t) => t.id)
  if (wholeClub) orderedTeamIds.push(null)

  // Anyone listed whose team is not among those groups still gets one. A
  // child standing in front of the coach must never be silently dropped
  // because the team cache has not caught up with the roster.
  for (const p of listed) {
    if (!orderedTeamIds.includes(p.teamId)) orderedTeamIds.push(p.teamId)
  }

  const guestTeamIds: (string | null)[] = []
  for (const g of guests) {
    const key = g.teamId
    if (!orderedTeamIds.includes(key) && !guestTeamIds.includes(key)) guestTeamIds.push(key)
  }

  const groups: RegisterGroup[] = []
  let playerTotal = 0
  let presentTotal = 0
  for (const teamId of [...orderedTeamIds, ...guestTeamIds]) {
    const inGroup = [...listed, ...guests].filter((p) => p.teamId === teamId).sort(registerOrder)
    if (inGroup.length === 0 && guestTeamIds.includes(teamId)) continue
    const teamDefault = teamId === null ? null : (teamById[teamId]?.bibColour ?? null)
    const rows = inGroup.map((p) => toRow(p, entryByPlayer.get(p.id), teamDefault))
    // An Unassigned group with nobody in it is noise; a covered team with
    // nobody in it is information.
    if (rows.length === 0 && teamId === null) continue
    const presentCount = rows.filter((r) => r.present).length
    playerTotal += rows.length
    presentTotal += presentCount
    groups.push({ teamId, teamName: groupName(teamId, teamById), rows, presentCount })
  }
  return { groups, playerTotal, presentTotal }
}

// Who quick add may offer: everyone in the current season's roster who is
// not already on the register. That deliberately includes other teams and
// unassigned children, because the whole point is the child standing in
// front of you who was not expected.
export function quickAddPool(
  players: Player[],
  coveredTeamIds: string[],
  entries: RegisterEntry[],
  wholeClub: boolean,
): Player[] {
  const listedIds = new Set(rosterForSession(players, coveredTeamIds, wholeClub).map((p) => p.id))
  const entered = new Set(entries.map((e) => e.playerId))
  return players.filter((p) => !listedIds.has(p.id) && !entered.has(p.id)).sort(registerOrder)
}

// A short summary for the session day card: "12 of 18 in".
export function registerSummary(view: RegisterView): string {
  return `${view.presentTotal} of ${view.playerTotal} in`
}
