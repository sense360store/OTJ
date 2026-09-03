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
// own. A second press is the admin's decision.
//
// Every write is read back rather than assumed: row level security answers a
// caller without teams.manage with no row rather than an error, and a count
// that comes back short is a refusal.
//
// The changed set is computed against a FRESH read of the club's teams, never
// against the cache the screen drew from, and the caller hands over the
// positions its draft was drawn from: a team another admin added or removed
// since the screen loaded, or a position another admin stored since, is
// refused as TeamOrderChanged rather than silently arranged around or
// overwritten. The screen then drops its draft and shows what is stored, and
// the admin decides again.
//
// THE CHECK COVERS THE WRITES, not only the read before them. Two admins can
// both read fresh before either writes, and both pass; without more, the
// second to finish would clear and replace what the first had just stored,
// and the unique index would allow it because the result is still a valid
// permutation. So every write is a compare and set: a clear lands only while
// the row still holds the position the fresh read saw, and a placement lands
// only while the row is still null, which is what this save's own clear
// left. A write that finds anything else returns no row and the save stops,
// with nothing overwritten. PostgREST offers no transaction across
// statements without a server side function, so a save that stops between
// its phases leaves an honestly INCOMPLETE order, named as such by the
// status the refetch brings, and never a blend presented as configured.
// The unique index remains the last guard for the write itself.
//
// WHAT THE AUDIT TRAIL SHOWS. audit_teams() records every distinct change of
// sort_order as team.updated naming the field and never the value, so a
// reorder of a club whose teams are already placed records TWO events per
// moved team, one for the clear and one for the placement; an unset club's
// clear is null to null and records nothing. Accepted as a property of the
// fail safe strategy; one event per press would need a server side function,
// which is a gated change this slice does not make.
export interface TeamPosition {
  id: string
  sortOrder: number | null
}

/* The positions a screen's draft was drawn from, in the shape the save
   takes as `expected`. Built here so the screen names no field of the Team
   beyond its id: the read's positions go into the save through this one
   function and the screen stays a consumer of the helper, not of the column. */
export function teamPositions(teams: readonly Pick<Team, 'id' | 'sortOrder'>[]): TeamPosition[] {
  return teams.map((t) => ({ id: t.id, sortOrder: t.sortOrder }))
}

export function samePositions(a: readonly TeamPosition[], b: readonly TeamPosition[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.sortOrder === b[i].sortOrder)
}

/* What a draft's snapshot becomes when a FRESH READ lands under it.

   The snapshot is taken when the draft is created and it is the only thing
   the save may refuse against, so it must not be rebuilt from a later read:
   a snapshot taken at Save time from a read that already carries another
   admin's order would agree with the fresh read and let the older draft
   overwrite it. So the read is checked AGAINST the snapshot instead:

   * a team the snapshot knows whose position differs is another admin's
     placement, and the answer is null: the draft is dropped and the screen
     says so;
   * a team the snapshot does not know that arrives UNPLACED is a team just
     added (by this admin or anybody) and joins the snapshot at null, so the
     admin's own add-then-save keeps the arrangement;
   * a team that arrives already placed is somebody's statement about the
     order, and the answer is null;
   * a team the read no longer holds leaves the snapshot, as it leaves the
     draft.

   Otherwise the snapshot is returned in the read's order, so a read that
   changed nothing yields the same content and the screen keeps its state. */
export function snapshotAfterRead(expected: readonly TeamPosition[], read: readonly TeamPosition[]): TeamPosition[] | null {
  const had = new Map(expected.map((r) => [r.id, r.sortOrder]))
  const next: TeamPosition[] = []
  for (const r of read) {
    if (had.has(r.id)) {
      if (had.get(r.id) !== r.sortOrder) return null
    } else if (r.sortOrder !== null) {
      return null
    }
    next.push({ id: r.id, sortOrder: r.sortOrder })
  }
  return next
}

export interface TeamOrderStore {
  // Every team of the club, id and position only.
  readPositions(): Promise<TeamPosition[]>
  // Set sort_order to null on ONE row, and only while that row still holds
  // `from`, the position the fresh read saw (a compare and set). Returns
  // the row as stored afterwards, or no row when it no longer held `from`
  // or the write was refused.
  clearPosition(id: string, from: number): Promise<TeamPosition[]>
  // Set sort_order to `position` on ONE row, and only while that row is
  // still null, which is what this save's own clear left. Returns the row
  // as stored afterwards, or no row when it was placed by somebody else in
  // between or the write was refused.
  setPosition(id: string, position: number): Promise<TeamPosition[]>
}

/* The one sentence a dropped draft is explained with, on the screen and in
   the refusal: the same words for the same fact, wherever it is met. */
export const TEAM_ORDER_CHANGED =
  "The club's teams changed while the order was being arranged. The list has been refreshed; check it and save again."

export class TeamOrderChanged extends Error {
  // `detail`, when given, replaces the general sentence with what THIS
  // refusal knows: how far a save that met another admin's write got.
  constructor(detail?: string) {
    super(detail ?? TEAM_ORDER_CHANGED)
    this.name = 'TeamOrderChanged'
  }
}

export class TeamOrderRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamOrderRefused'
  }
}

/* What a refused save says, beside the refusals it names so the wording and
   the failure it describes cannot drift apart. The two refusals the save
   itself raises are written for a coach and are shown as they are; anything
   else (a dropped connection, a server error) gets the general sentence. */
export function saveFailureMessage(error: unknown): string {
  const lead = 'Could not save the team order.'
  if (error instanceof TeamOrderChanged) return `${lead} ${error.message}`
  if (error instanceof TeamOrderRefused) {
    return `${lead} ${error.message} The status above says what is stored now; check the order and press Save team order again.`
  }
  return `${lead} The status above says what is stored now; the list still shows the order you arranged, so check it and press Save team order again.`
}

// `expected` is what the screen read before the admin arranged anything: the
// positions its draft was drawn from. A fresh position that differs from it
// is another admin's placement landing in between, and the save refuses
// rather than overwriting it. A caller that omits it accepts last writer
// wins for positions, which no screen does.
export async function saveTeamOrder(
  store: TeamOrderStore,
  orderedIds: readonly string[],
  expected?: readonly TeamPosition[],
): Promise<TeamOrderWrite[]> {
  const fresh = await store.readPositions()
  const known = new Set(fresh.map((r) => r.id))
  const distinct = new Set(orderedIds)
  if (fresh.length !== orderedIds.length || distinct.size !== orderedIds.length || orderedIds.some((id) => !known.has(id))) {
    throw new TeamOrderChanged()
  }
  if (expected) {
    const read = new Map(expected.map((r) => [r.id, r.sortOrder]))
    if (fresh.some((r) => read.has(r.id) && read.get(r.id) !== r.sortOrder)) throw new TeamOrderChanged()
  }
  const byId = new Map(fresh.map((r) => [r.id, r]))
  const writes = teamOrderWrites(orderedIds.map((id) => byId.get(id) as TeamPosition))
  if (writes.length === 0) return []

  // Phase one: free the positions of the teams that move, one row at a
  // time, each write conditioned on the position the fresh read saw. A row
  // that no longer holds it was changed by somebody else after the read,
  // and the save stops there: nothing has been placed, and what was cleared
  // is named as unplaced by the status the refetch brings.
  const placed = writes.filter((w) => (byId.get(w.id) as TeamPosition).sortOrder !== null)
  let cleared = 0
  for (const w of placed) {
    const from = (byId.get(w.id) as TeamPosition).sortOrder as number
    const [row] = await store.clearPosition(w.id, from)
    if (!row || row.id !== w.id) {
      throw new TeamOrderChanged(
        `The team order changed while it was being saved, or the write was refused. Nothing was placed; ${cleared} of ${placed.length} moved teams had been cleared. The list has been refreshed; check it and save again.`,
      )
    }
    if (row.sortOrder !== null) throw new TeamOrderRefused('A position was not cleared, so no position was written.')
    cleared += 1
  }

  // Phase two: place each moved team, each write conditioned on the row
  // still being null, which is what this save's own clear left. A row
  // somebody else placed in between is not overwritten.
  const done: TeamOrderWrite[] = []
  for (const w of writes) {
    const [row] = await store.setPosition(w.id, w.position)
    if (!row || row.id !== w.id) {
      throw new TeamOrderChanged(
        `The team order changed while it was being saved, or the write was refused. ${done.length} of ${writes.length} moved teams were placed; the rest are unplaced until the order is saved again. The list has been refreshed; check it and save again.`,
      )
    }
    if (row.sortOrder !== w.position) {
      throw new TeamOrderRefused(
        `A position was not stored. ${done.length} of ${writes.length} moved teams were placed; the rest are unplaced until the order is saved again.`,
      )
    }
    done.push(w)
  }
  return done
}
