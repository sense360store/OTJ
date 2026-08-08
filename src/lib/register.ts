// The Register's pure composition (ADR-0008): the players of a session's
// covered teams, grouped by team, each badged by their Spond response
// resolved through the link table, with the coach's ticks and bib colours
// layered on. RSVP is never attendance: every player of the covered teams
// is listed whatever Spond says; a response only badges the row. A player
// with no Spond link shows an unlinked badge and stays tickable. Declined
// players collapse last, never hidden entirely.
import type { Player, Team } from './data'
import { bibSwatch } from './sessionTeams'
import type { PlayerSpondLink } from './spondLinking'

export interface RegisterEntry {
  sessionId: string
  playerId: string
  present: boolean
  bibColourOverride: string | null
  source: 'spond' | 'manual'
}

export interface SpondResponseLite {
  spondMemberId: string
  status: 'accepted' | 'declined' | 'unanswered' | 'waiting'
}

// The badge a register row shows. 'none' is a linked player with no
// response row for this event (not invited, or no responses synced yet);
// 'unlinked' is a player with no Spond link at all.
export type RegisterBadge = 'accepted' | 'declined' | 'unanswered' | 'waiting' | 'none' | 'unlinked'

export const REGISTER_BADGE_META: Record<RegisterBadge, { label: string; tone: 'good' | 'quiet' | 'warn' }> = {
  accepted: { label: 'Going', tone: 'good' },
  waiting: { label: 'Waiting list', tone: 'quiet' },
  unanswered: { label: 'No reply', tone: 'quiet' },
  none: { label: 'No RSVP', tone: 'quiet' },
  unlinked: { label: 'Not linked', tone: 'warn' },
  declined: { label: 'Declined', tone: 'quiet' },
}

// Sort position within a team group: going first, then the undecided
// shapes, declined last (collapsed by the screen). Names break ties.
const BADGE_ORDER: Record<RegisterBadge, number> = {
  accepted: 0,
  waiting: 1,
  unanswered: 1,
  none: 1,
  unlinked: 1,
  declined: 2,
}

// The override value meaning "no bib for this player today", distinct from
// null (no override, the team default applies). Without it a player on a
// team with a default bib could never be marked bibless.
export const BIB_NONE = 'none'

export interface RegisterRow {
  player: Player
  badge: RegisterBadge
  present: boolean
  // The resolved bib colour: the entry's override (BIB_NONE resolving to
  // no bib), else the team default.
  bibColour: string | null
  bibSwatch: string | null
  overridden: boolean
  // What the bib select shows: '' for the team default, BIB_NONE for an
  // explicit no bib, else the override colour.
  bibValue: string
  // A quick added row: the player is outside the covered teams and was
  // added by hand on the day.
  manual: boolean
}

export interface RegisterGroup {
  teamId: string | null
  teamName: string
  rows: RegisterRow[]
  presentCount: number
}

export interface RegisterView {
  groups: RegisterGroup[]
  presentTotal: number
  playerTotal: number
}

export function badgeFor(
  playerId: string,
  linkByPlayer: Map<string, PlayerSpondLink>,
  statusByMember: Map<string, SpondResponseLite['status']>,
): RegisterBadge {
  const link = linkByPlayer.get(playerId)
  if (!link) return 'unlinked'
  return statusByMember.get(link.spondMemberId) ?? 'none'
}

// The composed register. players is the current season roster (id, team,
// name, shirt); coveredTeamIds resolves through the frozen fallback before
// arriving here. Every covered team gets a group even when empty, in the
// order the teams list gives; players outside the covered teams appear
// only when a manual entry added them, grouped under their own team (or
// Unassigned) after the covered groups.
export function buildRegister(
  players: Player[],
  coveredTeamIds: string[],
  teams: Team[],
  links: PlayerSpondLink[],
  responses: SpondResponseLite[],
  entries: RegisterEntry[],
): RegisterView {
  const linkByPlayer = new Map(links.map((l) => [l.playerId, l]))
  const statusByMember = new Map(responses.map((r) => [r.spondMemberId, r.status]))
  const entryByPlayer = new Map(entries.map((e) => [e.playerId, e]))
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const covered = new Set(coveredTeamIds)

  const rowFor = (player: Player, manual: boolean): RegisterRow => {
    const entry = entryByPlayer.get(player.id)
    const team = player.teamId ? teamById.get(player.teamId) : undefined
    const override = entry?.bibColourOverride ?? null
    const colour = override === BIB_NONE ? null : (override ?? team?.bibColour ?? null)
    return {
      player,
      badge: badgeFor(player.id, linkByPlayer, statusByMember),
      present: entry?.present ?? false,
      bibColour: colour,
      bibSwatch: bibSwatch(colour),
      overridden: override !== null,
      bibValue: override ?? '',
      manual,
    }
  }

  const sortRows = (rows: RegisterRow[]) =>
    rows.sort(
      (a, b) =>
        BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] ||
        a.player.displayName.localeCompare(b.player.displayName),
    )

  const groups: RegisterGroup[] = []
  for (const team of teams) {
    if (!covered.has(team.id)) continue
    const rows = sortRows(players.filter((p) => p.teamId === team.id).map((p) => rowFor(p, false)))
    groups.push({
      teamId: team.id,
      teamName: team.name,
      rows,
      presentCount: rows.filter((r) => r.present).length,
    })
  }

  // Quick added players from outside the covered teams, grouped under
  // their own team after the covered groups so a guest never hides.
  const guestRows = players
    .filter((p) => entryByPlayer.has(p.id) && !(p.teamId && covered.has(p.teamId)))
    .map((p) => rowFor(p, true))
  const guestsByTeam = new Map<string | null, RegisterRow[]>()
  for (const row of guestRows) {
    const key = row.player.teamId
    guestsByTeam.set(key, [...(guestsByTeam.get(key) ?? []), row])
  }
  for (const [teamId, rows] of guestsByTeam) {
    sortRows(rows)
    groups.push({
      teamId,
      teamName: teamId ? (teamById.get(teamId)?.name ?? 'Team') : 'Unassigned',
      rows,
      presentCount: rows.filter((r) => r.present).length,
    })
  }

  const allRows = groups.flatMap((g) => g.rows)
  return {
    groups,
    presentTotal: allRows.filter((r) => r.present).length,
    playerTotal: allRows.length,
  }
}

// The quick add pool: club players not already on the register and not in
// a covered team (those are always listed). Sorted by name.
export function quickAddPool(players: Player[], coveredTeamIds: string[], entries: RegisterEntry[]): Player[] {
  const covered = new Set(coveredTeamIds)
  const onRegister = new Set(entries.map((e) => e.playerId))
  return players
    .filter((p) => !(p.teamId && covered.has(p.teamId)) && !onRegister.has(p.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

// Split for the collapsed declined section: the screen renders active rows
// always and declined rows behind a toggle, never hidden entirely.
export function splitDeclined(rows: RegisterRow[]): { active: RegisterRow[]; declined: RegisterRow[] } {
  return {
    active: rows.filter((r) => r.badge !== 'declined'),
    declined: rows.filter((r) => r.badge === 'declined'),
  }
}
