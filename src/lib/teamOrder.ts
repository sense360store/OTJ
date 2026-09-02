// The club's ordering of its own teams (COACH-1, the frontend half).
//
// An admin states which of the club's teams is the strongest and which are
// progressively more developmental, so that later coaching suggestions have
// ability context without a per-player field. It is stored as one integer
// per team, `teams.sort_order` (0051), null until the club places the team.
//
// THREE THINGS THIS IS NOT. It is not an ability score: a team's position
// is a statement about the team, and nothing here reads or writes a player.
// It is not the product's display order: every label, filter and list the
// coaching screens show stays alphabetical (`sessionTeamsLabel`, the teams
// read), and the club order is a separate answer that only the Teams admin
// screen renders today. And it is not a rule about team names: Titans,
// Trojans and the rest are this season's contents of an ordered set, and no
// name appears in any rule here.
//
// Nothing in this module consumes the order for a coaching decision. The
// grouping suggestion (`planSetup` in sessionSetup.ts) still takes the
// order as a parameter and is still handed null by the register screen;
// wiring the two together is a later slice's decision, made in the open.
import type { Team } from './data'

// Whether the club has placed every team, some of them, or none.
export type ClubOrderState = 'unset' | 'incomplete' | 'configured'

export interface ClubOrder {
  state: ClubOrderState
  // Every team, in club order: the placed teams ascending by position, then
  // the unplaced teams alphabetically. When nothing is placed this is simply
  // alphabetical, and the state says so rather than letting that read as an
  // ability order.
  teams: Team[]
  // The teams with no position, alphabetically. Empty when configured.
  unplaced: Team[]
}

export type MoveDirection = 'up' | 'down'

// The tie break every ordering here falls back on, so two teams can never
// come out in an order that depends on how the read happened to return
// them: name first, then id for two teams of one name.
export function compareTeamsByName(a: Pick<Team, 'id' | 'name'>, b: Pick<Team, 'id' | 'name'>): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

function comparePlaced(a: Team, b: Team): number {
  // Both have a position here; the caller has already split them out.
  return (a.sortOrder as number) - (b.sortOrder as number) || compareTeamsByName(a, b)
}

export function clubOrderState(teams: readonly Team[]): ClubOrderState {
  if (teams.length === 0) return 'unset'
  const placed = teams.filter((t) => t.sortOrder !== null).length
  if (placed === 0) return 'unset'
  if (placed === teams.length) return 'configured'
  return 'incomplete'
}

// The club order as the admin screen shows it. Positions need not be
// contiguous or start at one (1, 3, 8 is a valid stored order and reads in
// that order), and a duplicate position, which the database refuses but a
// stale cache could still carry, is settled by name rather than left to the
// read's own order.
export function clubOrder(teams: readonly Team[]): ClubOrder {
  const placed = teams.filter((t) => t.sortOrder !== null).sort(comparePlaced)
  const unplaced = teams.filter((t) => t.sortOrder === null).sort(compareTeamsByName)
  return { state: clubOrderState(teams), teams: [...placed, ...unplaced], unplaced }
}

// One press of Move up or Move down on a draft. A press at the top or the
// bottom, or on a team that is not in the list, changes nothing and returns
// the same array, so a caller can tell a no-op from a move by identity.
export function moveTeam<T extends Pick<Team, 'id'>>(ordered: readonly T[], id: string, direction: MoveDirection): T[] {
  const from = ordered.findIndex((t) => t.id === id)
  if (from === -1) return ordered as T[]
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= ordered.length) return ordered as T[]
  const next = [...ordered]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// The positions an explicit save stores: 1..N in the order given. The
// database does not require contiguity; a full save simply normalises to
// the simplest representation of the order the admin can see.
export function canonicalPositions(ordered: readonly Pick<Team, 'id'>[]): Map<string, number> {
  return new Map(ordered.map((t, i) => [t.id, i + 1]))
}

export interface TeamOrderWrite {
  id: string
  position: number
}

// The rows a save has to touch: every team whose stored position differs
// from the position the order gives it, in that order. A team already at
// its position is left alone, so a save rewrites nothing it need not, and
// nothing but sort_order is ever part of this.
export function teamOrderWrites(ordered: readonly Pick<Team, 'id' | 'sortOrder'>[]): TeamOrderWrite[] {
  const positions = canonicalPositions(ordered)
  return ordered
    .filter((t) => t.sortOrder !== positions.get(t.id))
    .map((t) => ({ id: t.id, position: positions.get(t.id) as number }))
}

export function sameIdOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export function sameTeamOrder(a: readonly Pick<Team, 'id'>[], b: readonly Pick<Team, 'id'>[]): boolean {
  return sameIdOrder(
    a.map((t) => t.id),
    b.map((t) => t.id),
  )
}

// The draft the admin is arranging, kept as team ids, brought up to date
// with a fresh read of the teams. The admin's own arrangement of the teams
// the read still holds is kept; a team the read no longer holds leaves the
// draft; a team the draft has never seen joins it in club order among the
// newcomers, which for a team just added is the end of the list, because
// adding a team never states where it stands.
export function reconcileDraft(draft: readonly string[], teams: readonly Team[]): string[] {
  const known = new Set(teams.map((t) => t.id))
  const kept = draft.filter((id) => known.has(id))
  const seen = new Set(kept)
  const newcomers = clubOrder(teams.filter((t) => !seen.has(t.id))).teams.map((t) => t.id)
  return [...kept, ...newcomers]
}

// The teams in the draft's order, for rendering.
export function teamsInDraftOrder(draft: readonly string[], teams: readonly Team[]): Team[] {
  const byId = new Map(teams.map((t) => [t.id, t]))
  return draft.map((id) => byId.get(id)).filter((t): t is Team => t !== undefined)
}

// ---- Saving the order ---------------------------------------------------
//
// The write is described here, against a store the caller supplies, so the
// algorithm is testable with a fake that enforces the unique index and the
// real store in queries.ts is three thin calls that touch nothing but
// sort_order.
//
// WHY TWO PHASES. teams_sort_order_unique (0051) refuses two teams of one
// club at one position, and PostgreSQL checks a unique index per row rather
// than per statement: swapping 1 and 2 as "1 to 2, then 2 to 1" fails on the
// first write, and a bulk upsert would fail the same way while also having to
// carry every NOT NULL column. So the rows whose position changes are first
// cleared to null, which frees their positions, and then each is given its
// final position. A team already at its position is never touched, so the
// positions the unchanged teams hold can never collide with the ones being
// written: the positions are a permutation of 1..N and the unchanged teams
// keep exactly theirs.
//
// WHY IT FAILS SAFE. If the network drops between the phases, what is left is
// an INCOMPLETE order, the untouched teams at their positions and the moved
// ones at null, which the screen names as incomplete; the unique index has
// not been asked to accept anything false, and nothing here retries on its
// own. A second press is the admin's decision, made against the refetched
// truth, so a later change by another admin is never overwritten by a stale
// draft replaying itself.
//
// Every write is read back rather than assumed: row level security answers a
// caller without teams.manage with no row rather than an error, and a count
// that comes back short is a refusal.
//
// The changed set is computed against a FRESH read of the club's teams, not
// against the cache the screen drew from, so a team another admin added,
// removed or placed since the screen loaded is refused with a message rather
// than silently arranged around.
export interface TeamPosition {
  id: string
  sortOrder: number | null
}

export interface TeamOrderStore {
  // Every team of the club, id and position only.
  readPositions(): Promise<TeamPosition[]>
  // Set sort_order to null on exactly these rows, returning the rows as
  // stored afterwards.
  clearPositions(ids: readonly string[]): Promise<TeamPosition[]>
  // Set one row's sort_order, returning the row as stored afterwards.
  setPosition(id: string, position: number): Promise<TeamPosition[]>
}

export class TeamOrderChanged extends Error {
  constructor() {
    super("The club's teams changed while the order was being arranged. The list has been refreshed; check it and save again.")
    this.name = 'TeamOrderChanged'
  }
}

export class TeamOrderRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamOrderRefused'
  }
}

export async function saveTeamOrder(store: TeamOrderStore, orderedIds: readonly string[]): Promise<TeamOrderWrite[]> {
  const fresh = await store.readPositions()
  const known = new Set(fresh.map((r) => r.id))
  const distinct = new Set(orderedIds)
  if (fresh.length !== orderedIds.length || distinct.size !== orderedIds.length || orderedIds.some((id) => !known.has(id))) {
    throw new TeamOrderChanged()
  }
  const byId = new Map(fresh.map((r) => [r.id, r]))
  const writes = teamOrderWrites(orderedIds.map((id) => byId.get(id) as TeamPosition))
  if (writes.length === 0) return []

  const ids = writes.map((w) => w.id)
  const cleared = await store.clearPositions(ids)
  const clearedIds = new Set(cleared.map((r) => r.id))
  if (cleared.length !== ids.length || !ids.every((id) => clearedIds.has(id)) || cleared.some((r) => r.sortOrder !== null)) {
    throw new TeamOrderRefused('The positions could not be cleared for every team that moves, so no position was written.')
  }

  const done: TeamOrderWrite[] = []
  for (const w of writes) {
    const [row] = await store.setPosition(w.id, w.position)
    if (!row || row.id !== w.id || row.sortOrder !== w.position) {
      throw new TeamOrderRefused(
        `A position was not stored. ${done.length} of ${writes.length} moved teams were placed; the rest are unplaced until the order is saved again.`,
      )
    }
    done.push(w)
  }
  return done
}
