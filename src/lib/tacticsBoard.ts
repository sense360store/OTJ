// The tactics board's data shape and the pure helpers behind it. Phase one is
// frontend only and holds no state past a reload, but positions are kept as
// fractions of the pitch (0 to 1 on each axis) so the layout is resolution
// independent, survives a resize, and drops cleanly into a future persisted
// board without reshaping. Nothing here touches Supabase or React; it is the
// seam a later phase saves and loads.

export type TokenSide = 'home' | 'away'

// A player disc on the board. x runs across the pitch width, y along its
// length, both fractions from 0 (one edge) to 1 (the other). number is the
// shirt number, 1 upward; side is the colour only, home or away.
//
// THE NAME BOUNDARY. A token NEVER carries a player's name. A token seeded
// from a team roster carries the player's id in playerId (null for a hand
// placed or formation token); the name is resolved at render time from the
// players table, whose row level security only answers holders of
// sessions.create (coaches and admins, never parents). So a saved board hands
// a parent shape and numbers only: there is no name in the row to leak, and
// the parent's players query returns nothing to resolve against. See
// 0028_board_player_boundary.sql, which also enforces this shape with a
// check constraint on the stored jsonb.
export interface Token {
  id: string
  number: number
  side: TokenSide
  x: number
  y: number
  playerId: string | null
}

// The resolution map a render uses to put a name to a token: playerId to the
// player's display name, built from the (sessions.create gated) players
// query. A viewer without that capability has no map, so every disc shows
// its number alone.
export type PlayerNameMap = Record<string, string>

export function playerNameMap(players: { id: string; displayName: string }[]): PlayerNameMap {
  const map: PlayerNameMap = {}
  for (const p of players) map[p.id] = p.displayName
  return map
}

// The full display name a token resolves to, or an empty string when there is
// nothing to show: a token with no playerId (hand placed or formation), a
// viewer with no name map (a parent), or a playerId whose roster row is gone
// (the player was deleted; the disc safely falls back to its number).
export function tokenDisplayName(token: Token, names?: PlayerNameMap): string {
  if (!token.playerId || !names) return ''
  return names[token.playerId] ?? ''
}

// The name as it shows on the pitch: the first name only. The disc shows just
// the first name so it stays legible, while the full name is kept on the
// title attribute and the disc's accessible name. The first name is the text
// before the first space; a single word name is returned unchanged.
// Surrounding whitespace is trimmed so a stray leading space never yields an
// empty first name.
export function tokenFirstName(label: string): string {
  const trimmed = label.trim()
  const space = trimmed.indexOf(' ')
  return space === -1 ? trimmed : trimmed.slice(0, space)
}

// A formation as the count of outfield players per line, back to front. The
// goalkeeper is implied and added on top, so the token count a formation
// places is the line sum plus one.
export interface Formation {
  key: string
  label: string
  lines: number[]
}

// A few common small sided and eleven a side shapes. The line sums are 4, 6, 8
// and 10, so with the goalkeeper they seat 5, 7, 9 and 11 a side.
export const FORMATIONS: Formation[] = [
  { key: '1-2-1', label: '1-2-1 (5 a side)', lines: [1, 2, 1] },
  { key: '2-3-1', label: '2-3-1 (7 a side)', lines: [2, 3, 1] },
  { key: '3-2-3', label: '3-2-3 (9 a side)', lines: [3, 2, 3] },
  { key: '4-4-2', label: '4-4-2 (11 a side)', lines: [4, 4, 2] },
  { key: '4-3-3', label: '4-3-3 (11 a side)', lines: [4, 3, 3] },
]

// The token count a formation seats: every outfield player plus the keeper.
export function formationCount(f: Formation): number {
  return f.lines.reduce((a, n) => a + n, 0) + 1
}

// Clamp a fraction to the pitch. margin keeps a disc fully inside the
// touchlines while it is dragged; the default of zero is the plain 0 to 1
// clamp the data shape promises. A value outside the range is pulled to the
// nearer bound.
export function clampFraction(value: number, margin = 0): number {
  const lo = margin
  const hi = 1 - margin
  if (value < lo) return lo
  if (value > hi) return hi
  return value
}

// Base layout in "home" coordinates, where the team attacks toward y = 0 and
// defends its own goal at y = 1. The away side mirrors this so the two shapes
// face each other.
const GK_Y = 0.9
const LINE_BACK = 0.74
const LINE_FRONT = 0.2
const X_MARGIN = 0.16

// The y for one outfield line: the back line sits deep, the front line high,
// the rest spread evenly between. A single line sits in the middle of the band.
function lineY(lineIndex: number, lineCount: number): number {
  if (lineCount <= 1) return (LINE_BACK + LINE_FRONT) / 2
  return LINE_BACK - (LINE_BACK - LINE_FRONT) * (lineIndex / (lineCount - 1))
}

// The x for one player in a line of count players: spread across the width
// inside a margin, a lone player centred.
function spreadX(position: number, count: number): number {
  if (count <= 1) return 0.5
  return X_MARGIN + (1 - 2 * X_MARGIN) * (position / (count - 1))
}

// Mirror the home facing y for the away side so it attacks the other way.
function orient(side: TokenSide, y: number): number {
  return side === 'home' ? y : 1 - y
}

function makeToken(side: TokenSide, number: number, x: number, y: number): Token {
  return { id: `${side}-${number}`, number, side, x, y, playerId: null }
}

// Place a formation for one side: a goalkeeper as number 1, then the outfield
// lines back to front, numbered upward. Returns an empty array for an unknown
// key. Every position is a clean fraction inside 0 to 1.
export function formationPositions(key: string, side: TokenSide): Token[] {
  const f = FORMATIONS.find((x) => x.key === key)
  if (!f) return []
  const tokens: Token[] = []
  let n = 1
  tokens.push(makeToken(side, n++, 0.5, orient(side, GK_Y)))
  const lineCount = f.lines.length
  f.lines.forEach((count, lineIndex) => {
    const y = lineY(lineIndex, lineCount)
    for (let p = 0; p < count; p++) {
      tokens.push(makeToken(side, n++, spreadX(p, count), orient(side, y)))
    }
  })
  return tokens
}

// The next shirt number for a side: one past its highest, starting at 1. Used
// by the add token control so numbers stay unique within a side.
export function nextNumber(tokens: Token[], side: TokenSide): number {
  const onSide = tokens.filter((t) => t.side === side)
  if (onSide.length === 0) return 1
  return Math.max(...onSide.map((t) => t.number)) + 1
}

// ---- Roster seeding ------------------------------------------------------
// The minimum a board needs to seat a team's real players: the player's id
// and an optional shirt number. DELIBERATELY NO NAME: seeding never touches a
// display name, so a name cannot reach a token (and so the persisted board)
// even by accident. The render resolves the name from the id, live, through
// the sessions.create gated players query (see tokenDisplayName).
export interface RosterPlayer {
  id: string
  shirtNumber: number | null
}

// Seed tokens from a team's roster, the opt in alternative to the formation
// picker: one token per player, carrying the player's id and using their
// shirt number as the token number. A player with no number takes the next
// free one so numbers (and the side-number token id) stay unique within the
// side. Players are laid out in tidy rows across the side's half of the
// pitch, the same fraction coordinates a formation uses, so the coach drags
// them into shape from there.
//
// The playerId is a REFERENCE, not a copy: renaming a player updates every
// board's display the next time it renders, and deleting a player leaves the
// token in place showing its number alone. The token never stores the name.
export function rosterTokens(players: RosterPlayer[], side: TokenSide): Token[] {
  const used = new Set<number>()
  // Reserve the numbers players already carry so the fallback never collides
  // with a real shirt number that appears later in the list.
  for (const p of players) {
    if (typeof p.shirtNumber === 'number') used.add(p.shirtNumber)
  }
  let nextFree = 1
  function takeNumber(preferred: number | null): number {
    if (typeof preferred === 'number') return preferred
    while (used.has(nextFree)) nextFree++
    used.add(nextFree)
    return nextFree
  }

  const cols = Math.min(5, Math.max(1, players.length))
  const rows = Math.ceil(players.length / cols)
  return players.map((p, i) => {
    const number = takeNumber(p.shirtNumber)
    const col = i % cols
    const row = Math.floor(i / cols)
    const rowCount = Math.min(cols, players.length - row * cols)
    const x = spreadX(col, rowCount)
    // Spread rows down the side's band, then mirror for the away side so the
    // two rosters face each other the way two formations do.
    const yHome = rows <= 1 ? (LINE_BACK + LINE_FRONT) / 2 : LINE_BACK - (LINE_BACK - LINE_FRONT) * (row / (rows - 1))
    return {
      id: `${side}-${number}`,
      number,
      side,
      x,
      y: orient(side, yHome),
      playerId: p.id,
    }
  })
}

// ---- Saved boards --------------------------------------------------------
// Phase two persists a board. A saved board is the name, the formation it was
// seeded from, the team it frames and the tokens, plus its ownership and
// timestamps. The tokens carry no person data: numbers, positions, sides and
// player ids only, never a name (see 0020_boards.sql and the constraint in
// 0028_board_player_boundary.sql).
export interface Board {
  id: string
  name: string
  formation: string | null
  teamId: string | null
  tokens: Token[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

// The part of a board that a save serialises and a load restores: name,
// formation, team and tokens. The side toggle is an authoring control, not
// part of the saved shape, so it is deliberately absent. The unsaved
// indicator compares two of these.
export interface BoardSnapshot {
  name: string
  formation: string | null
  teamId: string | null
  tokens: Token[]
}

// The exact shape one stored token takes in the jsonb column: number, side,
// the fractions, the derived id, and playerId only when the token references
// a roster player. NOTHING ELSE: no label field exists, so there is no place
// for a name to be persisted, and the database enforces the same key set with
// a check constraint (0028_board_player_boundary.sql).
export interface StoredToken {
  id: string
  number: number
  side: TokenSide
  x: number
  y: number
  playerId?: string
}

// Serialise the tokens to the value the jsonb column stores. Kept explicit
// rather than passing the live array straight through, so the stored shape is
// the one field set the schema documents and a stray property on a token
// never leaks into the database. playerId is included only when present, so a
// hand placed token stores five fields and nothing more.
export function serializeTokens(tokens: Token[]): StoredToken[] {
  return tokens.map((t) => ({
    id: t.id,
    number: t.number,
    side: t.side,
    x: t.x,
    y: t.y,
    ...(t.playerId ? { playerId: t.playerId } : {}),
  }))
}

// Read tokens back from the stored jsonb, defensively. The column is just
// jsonb, so a hand edit or a future shape change could leave a stray or
// malformed entry; each token is rebuilt from its fields, the id derived from
// side and number the same way the board mints it, the fractions clamped, and
// anything without a usable number or position dropped. So a loaded board
// always lands inside the pitch. Any legacy `label` (or any other stray
// field) is deliberately IGNORED: a board row written before the name
// boundary landed can still be loaded, but a name it carried never reaches
// the client's token state.
export function deserializeTokens(value: unknown): Token[] {
  if (!Array.isArray(value)) return []
  const out: Token[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const number = typeof r.number === 'number' ? r.number : Number(r.number)
    // side is the home or away colour; accept a colour key too for resilience.
    const side: TokenSide = r.side === 'away' || r.colour === 'away' ? 'away' : 'home'
    const x = typeof r.x === 'number' ? r.x : Number(r.x)
    const y = typeof r.y === 'number' ? r.y : Number(r.y)
    if (!Number.isFinite(number) || !Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({
      id: `${side}-${number}`,
      number,
      side,
      x: clampFraction(x),
      y: clampFraction(y),
      playerId: typeof r.playerId === 'string' && r.playerId !== '' ? r.playerId : null,
    })
  }
  return out
}

// ---- Edit mode -----------------------------------------------------------
// The board page opens in view mode (read only) and enters edit mode on demand.
// Cancel reverts to the board exactly as it was when edit mode was entered, so
// the page snapshots the editable state at that moment and restores it. Unlike
// BoardSnapshot this carries the authoring controls too (the side toggle), since
// Cancel returns them as well, and it is on-screen state, never persisted.
export interface BoardEdit {
  name: string
  formation: string
  side: TokenSide
  teamId: string | null
  tokens: Token[]
}

// Capture the editable state at edit-entry so Cancel can restore it. The tokens
// are cloned so later moves on the working board never reach back and mutate
// the snapshot.
export function captureBoardEdit(state: BoardEdit): BoardEdit {
  return { ...state, tokens: state.tokens.map((t) => ({ ...t })) }
}

// A board's saved shape flattened to a string, so a move, a token change, a
// formation change, a team change or a rename all register as a difference.
export function boardSignature(snap: BoardSnapshot): string {
  return JSON.stringify({
    name: snap.name.trim(),
    formation: snap.formation ?? '',
    teamId: snap.teamId ?? '',
    tokens: serializeTokens(snap.tokens),
  })
}

// True when the on-screen board differs from the last saved or loaded state.
// Drives the quiet unsaved indicator and the warn-before-loading-over check,
// so a coach does not lose work by loading another board on top of unsaved
// changes.
export function boardIsDirty(current: BoardSnapshot, saved: BoardSnapshot): boolean {
  return boardSignature(current) !== boardSignature(saved)
}

// ---- Selection and gestures ---------------------------------------------
// A token on the editable board both drags and selects from one pointer press,
// so press, move and release have to decide between the two. The rule is a
// distance: a release that never travelled far from where it pressed is a tap
// (which selects the token), one that did is a drag (which moved it). The
// threshold is a few pixels so a deliberate drag always crosses it while a
// slightly imprecise tap, a finger that shifts a pixel or two, still selects.
export const DRAG_THRESHOLD = 6

// True when a pointer has moved far enough from its press point to count as a
// drag rather than a tap. Pulled out as a pure helper so the tap-versus-drag
// decision is tested directly, without simulating pointer events in a DOM.
export function isDrag(dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(dx, dy) >= threshold
}

// Remove one token by id: the selection based delete behind the Remove selected
// button and the Delete or Backspace key. Returns a new array without that one
// token and leaves every other token untouched; an id that matches nothing
// returns the list unchanged. Kept pure so "delete the chosen token and only
// that token" is tested without a pitch.
export function deleteToken(tokens: Token[], id: string): Token[] {
  return tokens.filter((t) => t.id !== id)
}
