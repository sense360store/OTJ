// Bulk selection and bulk permanent deletion on the Registered players page
// (roadmap PLAYERS-01). Pure: every rule about what is selected, what a
// selection would destroy and whether the admin has confirmed it lives here, so
// the whole model is provable without a DOM. The screen holds one Set of player
// ids and calls these; it decides nothing itself.
//
// No child name is written, encoded or logged by this module. Names reach the
// confirmation dialog from rows the caller already holds, and they never enter
// a URL, a query key, a log line or the audit payload; the server's audit
// metadata is numbers only (0049_bulk_delete_players.sql).
import type { RegisteredPlayer } from './data'

// ---------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------

// Selection is keyed on the stable player id, never the registration id: the
// thing being deleted is the identity, and the identity is what the server is
// asked for. A season's register shows one row per player, so the two are one
// to one on screen, but only one of them is the thing that goes.
export type PlayerSelection = ReadonlySet<string>

export const EMPTY_SELECTION: PlayerSelection = new Set<string>()

// THE RULE THIS MODULE EXISTS FOR: a selection is only ever the players the
// coach can currently see. Every function below either respects that or
// enforces it, because the two ways a bulk delete goes wrong are deleting
// somebody who was never looked at and deleting more than the confirmation
// named.

export function toggleSelected(selection: PlayerSelection, playerId: string): PlayerSelection {
  const next = new Set(selection)
  if (next.has(playerId)) next.delete(playerId)
  else next.add(playerId)
  return next
}

// Select all of the CURRENTLY SHOWN rows and nothing else. It is a union with
// what is already selected rather than a replacement, so it can never quietly
// drop a row the coach ticked; and because the only ids it can add are the ones
// passed in, it can never reach a row the filters are hiding.
export function selectAllShown(selection: PlayerSelection, shownIds: readonly string[]): PlayerSelection {
  const next = new Set(selection)
  for (const id of shownIds) next.add(id)
  return next
}

export function clearSelection(): PlayerSelection {
  return new Set<string>()
}

// Confine a selection to what is shown, dropping anybody the current filters
// hide. Called whenever the shown set changes, which is what stops a filter
// change from silently broadening (or secretly preserving) a selection: a
// player who leaves the view leaves the selection, and re-widening the filter
// brings the row back unticked.
//
// Returns the SAME Set instance when nothing was dropped, so a caller can
// assign it back into state unconditionally without causing a render loop.
export function confineToShown(
  selection: PlayerSelection,
  shownIds: readonly string[],
): { next: PlayerSelection; dropped: number } {
  const shown = new Set(shownIds)
  let dropped = 0
  for (const id of selection) if (!shown.has(id)) dropped += 1
  if (dropped === 0) return { next: selection, dropped: 0 }
  const next = new Set<string>()
  for (const id of selection) if (shown.has(id)) next.add(id)
  return { next, dropped }
}

// The selection a filter or search change leaves behind: what the NEW view will
// show, and nothing else. The caller passes the rows the new filters admit
// (filterRows already computes them), so the drop happens in the same handler
// as the filter change rather than as a reaction to it, and there is no moment
// where a hidden row is still selected. A season change passes no rows, because
// a different season is a different register entirely.
export function selectionForFilters(
  selection: PlayerSelection,
  nextVisible: readonly RegisteredPlayer[],
): PlayerSelection {
  return confineToShown(
    selection,
    nextVisible.map((r) => r.playerId),
  ).next
}

// The filter keys that change WHAT IS SHOWN, as opposed to the order it is
// shown in. Owned here rather than in the component, so the question "does this
// filter change need to drop a selection" has one answer with one test.
// Reordering the same rows reveals nobody new, so sort is deliberately absent.
const VIEW_KEYS = ['team', 'status', 'q'] as const

// What a filter change leaves selected. Three cases and no fourth:
//   a season change     -> nothing, because a different season is a different
//                          register and the rows are refetched;
//   a change to the view -> only what the new view will show;
//   anything else (sort) -> untouched.
// The caller passes the keys its patch carries and the rows the new filters
// admit; this decides. Pure, so the drop rule is provable without a DOM, which
// is the repo's own lesson about rules that hide inside a component.
export function selectionAfterFilterChange(
  selection: PlayerSelection,
  changedKeys: readonly string[],
  nextVisible: readonly RegisteredPlayer[],
): PlayerSelection {
  if (changedKeys.includes('seasonId')) return clearSelection()
  if (!changedKeys.some((k) => (VIEW_KEYS as readonly string[]).includes(k))) return selection
  return selectionForFilters(selection, nextVisible)
}

// The selected rows, in the order the table is showing them, so the
// confirmation lists names the way the coach just read them.
export function selectedRows(rows: readonly RegisteredPlayer[], selection: PlayerSelection): RegisteredPlayer[] {
  return rows.filter((r) => selection.has(r.playerId))
}

// The ids to send, deduplicated and in a stable order. One row per player per
// season means duplicates cannot arise from the table, but the server folds
// them anyway and so does this: the count the confirmation names has to be the
// count the server sees.
export function selectionIds(selection: PlayerSelection): string[] {
  return Array.from(new Set(selection)).sort()
}

export function allShownSelected(selection: PlayerSelection, shownIds: readonly string[]): boolean {
  return shownIds.length > 0 && shownIds.every((id) => selection.has(id))
}

// Whether the bulk affordance may be offered at all. Deliberately the same
// three conditions the existing single row Delete permanently is gated on
// (playersView.rowActionKeys): players.manage plus a writable season for any
// write surface, and players.delete for the destructive one. Bulk mode is a
// faster way to spend an existing permission, never a new one, so an archived
// or superseded season stays read only here exactly as it is for every other
// write on the page.
export function canBulkDelete(opts: { canManage: boolean; canDelete: boolean; writable: boolean }): boolean {
  return opts.canManage && opts.canDelete && opts.writable
}

// ---------------------------------------------------------------------
// The confirmation gate
// ---------------------------------------------------------------------

// The typed phrase. The single row delete asks for the child's name, which does
// not scale and would mean typing six names; the bulk gate asks for a phrase
// that NAMES THE NUMBER, so a stale count is something the admin has to retype
// rather than something they can miss. Plural agreement matters: an admin who
// has to type DELETE 1 PLAYER cannot be halfway through confirming six.
export function bulkDeletePhrase(count: number): string {
  return `DELETE ${count} ${count === 1 ? 'PLAYER' : 'PLAYERS'}`
}

// Case and surrounding whitespace are forgiven, and runs of inner whitespace
// collapse, because those are typing accidents rather than a different
// intention. The words and the number are not forgiven.
export function bulkDeleteConfirmed(typed: string, count: number): boolean {
  if (count < 1) return false
  const normalised = typed.trim().replace(/\s+/g, ' ').toUpperCase()
  return normalised === bulkDeletePhrase(count)
}

export function bulkDeleteButtonLabel(count: number): string {
  return `Delete ${count} ${count === 1 ? 'player' : 'players'} permanently`
}

// ---------------------------------------------------------------------
// The dependency preview
// ---------------------------------------------------------------------

// What preview_delete_players and delete_players return. Every field is a
// server computed count over server truth; nothing here is derived in the
// browser, because a browser derived preview of a destructive operation is a
// guess wearing a number.
export interface DeletePreview {
  // How many distinct ids were asked about.
  requested: number
  // How many of them are live players of the caller's club. Less than
  // requested means the selection is already stale and the server will refuse.
  players: number
  registrations: number
  registrationSeasons: number
  registrationsCurrent: number
  registrationsArchived: number
  registerEntries: number
  registerSessions: number
  spondLinks: number
  spondReplies: number
  boardTokens: number
  boards: number
}

export const ZERO_PREVIEW: DeletePreview = {
  requested: 0,
  players: 0,
  registrations: 0,
  registrationSeasons: 0,
  registrationsCurrent: 0,
  registrationsArchived: 0,
  registerEntries: 0,
  registerSessions: 0,
  spondLinks: 0,
  spondReplies: 0,
  boardTokens: 0,
  boards: 0,
}

function num(raw: Record<string, unknown>, key: string): number {
  const v = raw[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// Adapt the RPC's jsonb to the app shape. Defensive rather than trusting: a
// missing or non numeric field reads as 0 rather than NaN, so the dialog can
// never render "NaN register entries" at an admin about to erase children.
export function parseDeletePreview(raw: unknown): DeletePreview {
  if (!raw || typeof raw !== 'object') return ZERO_PREVIEW
  const r = raw as Record<string, unknown>
  return {
    requested: num(r, 'requested'),
    players: num(r, 'players'),
    registrations: num(r, 'registrations'),
    registrationSeasons: num(r, 'registration_seasons'),
    registrationsCurrent: num(r, 'registrations_current'),
    registrationsArchived: num(r, 'registrations_archived'),
    registerEntries: num(r, 'register_entries'),
    registerSessions: num(r, 'register_sessions'),
    spondLinks: num(r, 'spond_links'),
    spondReplies: num(r, 'spond_replies'),
    boardTokens: num(r, 'board_tokens'),
    boards: num(r, 'boards'),
  }
}

// The server has already been asked about a selection that no longer exists as
// asked: somebody else deleted one of these children between the preview and
// now. The dialog says so and refuses to arm, rather than letting an admin
// confirm a number the server will reject anyway.
export function previewIsStale(p: DeletePreview): boolean {
  return p.players !== p.requested
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The "this will remove" list. Rows that would remove nothing are left out
// entirely, so a club with no Spond and no boards reads a short honest list
// instead of a wall of zeroes; the identities line is always present because it
// is the operation itself.
export function removalLines(p: DeletePreview): string[] {
  const lines: string[] = [plural(p.players, 'player identity', 'player identities')]
  if (p.registrations > 0) {
    const where: string[] = []
    if (p.registrationsCurrent > 0) where.push(`${p.registrationsCurrent} in the current season`)
    if (p.registrationsArchived > 0) where.push(`${p.registrationsArchived} in an archived season`)
    const scope = p.registrationSeasons > 1 ? ` across ${p.registrationSeasons} seasons` : ''
    lines.push(
      `${plural(p.registrations, 'season registration', 'season registrations')}${scope}` +
        (where.length > 0 ? ` (${where.join(', ')})` : ''),
    )
  }
  if (p.registerEntries > 0) {
    lines.push(
      `${plural(p.registerEntries, 'register entry', 'register entries')} across ` +
        plural(p.registerSessions, 'session', 'sessions'),
    )
  }
  if (p.spondLinks > 0) lines.push(plural(p.spondLinks, 'Spond link', 'Spond links'))
  if (p.spondReplies > 0) lines.push(plural(p.spondReplies, 'stored Spond reply', 'stored Spond replies'))
  return lines
}

// What changes without being removed. Separate from the removal list because
// "loses a name" and "is destroyed" are different outcomes and reading them in
// one list makes the destructive half look softer than it is.
export function changeLines(p: DeletePreview): string[] {
  if (p.boardTokens < 1) return []
  const verb = p.boardTokens === 1 ? 'loses its name and keeps its' : 'lose their name and keep their'
  return [
    `${plural(p.boardTokens, 'saved board disc', 'saved board discs')} on ` +
      `${plural(p.boards, 'board', 'boards')} ${verb} number and position`,
  ]
}

// The history statement, always shown in full and never conditional on the
// counts. This is the "surface it explicitly" half of the roadmap acceptance
// criteria: register entries are the one dependency that is DESTROYED rather
// than degraded to a neutral reference, so the dialog says so in the plainest
// words available rather than leaving it to a number in a list.
export function historyLines(p: DeletePreview): string[] {
  const lines: string[] = []
  if (p.registerEntries > 0) {
    lines.push(
      'Session history: each of those register entries is that child’s own attendance, group inclusion and bib ' +
        'for one session. It goes with them and is kept nowhere else. The sessions themselves, their plans and every ' +
        'other child’s entries are untouched.',
    )
  } else {
    lines.push(
      'Session history: these players have no register entries, so no session record changes. The sessions ' +
        'themselves are never touched by a deletion.',
    )
  }
  lines.push(
    'Activity: each deletion is recorded as a neutral Deleted player entry carrying no name, plus one entry for ' +
      'this run. Nothing is removed from the activity log.',
  )
  lines.push(
    'Spond: nothing is deleted or changed in Spond. Only the club’s own stored link and copied replies go.',
  )
  lines.push(
    'This cannot be undone. Withdraw is the reversible way to remove a player from a season.',
  )
  return lines
}
