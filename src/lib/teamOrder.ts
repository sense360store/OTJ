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
// The order is saved by ONE call to public.set_team_order (migration 0052,
// applied to production on 4 September 2026 as hosted 20260904174142 /
// atomic_team_order). This module holds the pure half: the request that call
// takes, the failures it can answer with, and the words each failure is shown
// in. src/lib/queries.ts owns the call itself and the translation of a
// PostgREST error into the classes below.
//
// WHY A FUNCTION RATHER THAN WRITES FROM HERE. teams_sort_order_unique (0051)
// refuses two teams of one club at one position and PostgreSQL checks a
// unique index per ROW rather than per statement, so a swap cannot be one
// statement and a whole order cannot be one either. Written from the browser
// it is therefore several statements, and two admins who move DISJOINT rows
// never collide: from A=1 B=2 C=3 D=4 one swaps A and B while the other swaps
// C and D, every per row check passes, both commit, and the club holds an
// order NEITHER submitted, which the unique index cannot object to because a
// merge is a permutation like any other. The missing thing was a transaction,
// and no arrangement of client statements is one. 0052 supplies it: the
// function validates the complete set and the caller's expected snapshot
// under a club advisory lock and SHARE ROW EXCLUSIVE on teams, then clears
// and places the whole order, or writes nothing at all.
//
// SO THIS CLIENT NEVER WRITES sort_order. Not as a fallback, not as a
// retry, not for a single row. teamOrder.invariant.test.ts fails the build if
// such a write appears, because a second path would reopen exactly the race
// the migration closed.
//
// WHAT THE AUDIT TRAIL SHOWS, unchanged by the move: audit_teams() records
// every distinct change of sort_order as team.updated naming the field and
// never the value. The function clears then places inside its one
// transaction, so a moved already placed team still records TWO events; a
// team already at its position is not written and records none; a first order
// on an unset club records one per team. That is the server's shape and is
// stated rather than engineered away.

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

/* The positions a save MEANS to leave: 1..N in the order given. What the
   screen expects its own refetch to carry after a successful save, and what
   the success note is derived against. */
export function intendedPositions(orderedIds: readonly string[]): TeamPosition[] {
  return orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }))
}

/* Whether a read holds exactly the positions a save wrote: the same teams,
   each at the same position, whatever order the read came in. What the
   success note is derived from, so "Team order saved." is never said of an
   order that is not the one this admin saved. */
export function positionsAgree(saved: readonly TeamPosition[], read: readonly TeamPosition[]): boolean {
  if (saved.length !== read.length) return false
  const at = new Map(read.map((r) => [r.id, r.sortOrder]))
  return saved.every((r) => at.has(r.id) && at.get(r.id) === r.sortOrder)
}

export function samePositions(a: readonly TeamPosition[], b: readonly TeamPosition[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.sortOrder === b[i].sortOrder)
}

/* What a draft's snapshot becomes when a FRESH READ lands under it.

   The snapshot is taken when the draft is created and it is the only thing
   the save may be refused against, so it must not be rebuilt from a later
   read: a snapshot taken at Save time from a read that already carries
   another admin's order would agree with the stored order and let the older
   draft overwrite it. So the read is checked AGAINST the snapshot instead:

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

/* The arguments public.set_team_order takes, named as the function names
   them so the call site cannot quietly reorder them.

   ALIGNMENT IS THE WHOLE POINT of building this here rather than at the call
   site. The function reads the two arrays by ORDINALITY: the nth expected
   position is the position it requires the nth team to be holding. The
   snapshot the screen carries is keyed by id and arrives in whatever order
   the read came in, so handing it over as-is would compare each team against
   another team's position, pass or fail for the wrong reason, and store an
   order nobody arranged. It is therefore projected onto the id order here,
   once, with a test that fails when the two disagree.

   `null` is a REAL expected value meaning "this team was unplaced", not a
   missing one, and it survives the projection. A team the snapshot has never
   seen is unplaced by definition and is sent as null. */
export interface TeamOrderRequest {
  p_team_ids: string[]
  p_expected_sort_orders: (number | null)[]
}

export function teamOrderRequest(
  orderedIds: readonly string[],
  expected: readonly TeamPosition[],
): TeamOrderRequest {
  const at = new Map(expected.map((r) => [r.id, r.sortOrder]))
  return {
    p_team_ids: [...orderedIds],
    p_expected_sort_orders: orderedIds.map((id) => at.get(id) ?? null),
  }
}

/* The one sentence a dropped draft is explained with, on the screen and in
   the refusal: the same words for the same fact, wherever it is met. */
export const TEAM_ORDER_CHANGED =
  "The club's teams changed while the order was being arranged. The list has been refreshed; check it and save again."

/* Another admin stored a different order, or the club's teams changed, since
   the draft was drawn. The function refuses the WHOLE order BEFORE writing
   anything, so nothing was stored and there is no partial order to repair.

   Raised only for P0001 carrying the DETAIL token `stale_order`, never for
   P0001 alone: that code also covers every malformed request the function
   refuses, so keying on it would say "another admin saved" for a bug in this
   client, and would say nothing when an admin really was overtaken. */
export class TeamOrderChanged extends Error {
  constructor(detail?: string) {
    super(detail ?? TEAM_ORDER_CHANGED)
    this.name = 'TeamOrderChanged'
  }
}

/* The caller may not manage this club's teams (SQLSTATE 42501): not signed
   in, or signed in without teams.manage. The function self gates on the same
   capability the teams_manage policy names, so this is the same refusal a
   direct write would have met, said in one place instead of read out of an
   empty result. */
export class TeamOrderNotPermitted extends Error {
  constructor() {
    super('You do not have permission to change the team order.')
    this.name = 'TeamOrderNotPermitted'
  }
}

/* The function refused the request itself: a P0001 with no `stale_order`
   token. Every case is a defect in what this client sent rather than
   something an admin did, and every one of them means NOTHING was written:
   the request was refused before any lock or any write. Deliberately NOT
   folded into TeamOrderChanged, because telling an admin that somebody else
   saved when the truth is that we sent a malformed request would send them
   to check an order nobody touched. */
export class TeamOrderRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamOrderRefused'
  }
}

/* What a refused save says, beside the refusals it names so the wording and
   the failure it describes cannot drift apart.

   Every branch says what is true of what is STORED, which the RPC makes
   simple: the function is atomic, so either the whole order was written or
   none of it was, and there is no "how far did it get" to report. A
   transport failure is the one case where this client cannot know which
   happened, and it says so rather than guessing; the screen refetches and
   the refreshed list is the answer. */
export function saveFailureMessage(error: unknown): string {
  const lead = 'Could not save the team order.'
  if (error instanceof TeamOrderChanged) return `${lead} ${error.message}`
  if (error instanceof TeamOrderNotPermitted) {
    return `${lead} ${error.message} The list has been refreshed and shows the stored order.`
  }
  if (error instanceof TeamOrderRefused) {
    return `${lead} ${error.message} Nothing was changed. The list has been refreshed; check it and save again.`
  }
  return `${lead} It is not known whether it reached the server, so the list has been refreshed to show what is stored. Check it and save again if it is not the order you arranged.`
}
