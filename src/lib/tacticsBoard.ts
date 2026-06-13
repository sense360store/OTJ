// The tactics board's data shape and the pure helpers behind it. Phase one is
// frontend only and holds no state past a reload, but positions are kept as
// fractions of the pitch (0 to 1 on each axis) so the layout is resolution
// independent, survives a resize, and drops cleanly into a future persisted
// board without reshaping. Nothing here touches Supabase or React; it is the
// seam a later phase saves and loads.

export type TokenSide = 'home' | 'away'

// A player disc on the board. x runs across the pitch width, y along its
// length, both fractions from 0 (one edge) to 1 (the other). number is the
// shirt number, 1 upward; label is a short free text, empty by default, never
// a real name from any roster. side is the colour only, home or away.
export interface Token {
  id: string
  number: number
  label: string
  side: TokenSide
  x: number
  y: number
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
  return { id: `${side}-${number}`, number, label: '', side, x, y }
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
// The minimum a board needs to seat a team's real players: a display name and
// an optional shirt number. This mirrors the player roster (see data.ts and
// 0021_players.sql) without depending on it, so the pure layout stays testable
// and the board keeps no link back to a player.
export interface RosterPlayer {
  displayName: string
  shirtNumber: number | null
}

// Seed tokens from a team's roster, the opt in alternative to the formation
// picker: one token per player, the player's display name copied into the
// token label and their shirt number used as the token number. A player with
// no number takes the next free one so numbers (and the side-number token id)
// stay unique within the side. Players are laid out in tidy rows across the
// side's half of the pitch, the same fraction coordinates a formation uses, so
// the coach drags them into shape from there.
//
// The label is the display name as a PLAIN STRING copied in here; the token
// carries no id or foreign key back to the player. So a board built or saved
// from a roster is a snapshot: renaming or deleting a player later never
// changes or corrupts it (see 0020_boards.sql tokens and serializeTokens).
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
      label: p.displayName,
      side,
      x,
      y: orient(side, yHome),
    }
  })
}

// ---- Saved boards --------------------------------------------------------
// Phase two persists a board. A saved board is the name, the formation it was
// seeded from, the team it frames and the tokens, plus its ownership and
// timestamps. The tokens carry no person data, only the numbers and free text
// labels a coach typed (see 0020_boards.sql).
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

// Serialise the tokens to the value the jsonb column stores: a plain copy of
// the array as state holds it. Kept explicit rather than passing the live
// array straight through, so the stored shape is the one field set the schema
// documents and a stray property on a token never leaks into the database.
export function serializeTokens(tokens: Token[]): Token[] {
  return tokens.map((t) => ({ id: t.id, number: t.number, label: t.label, side: t.side, x: t.x, y: t.y }))
}

// Read tokens back from the stored jsonb, defensively. The column is just
// jsonb, so a hand edit or a future shape change could leave a stray or
// malformed entry; each token is rebuilt from its fields, the id derived from
// side and number the same way the board mints it, the fractions clamped, and
// anything without a usable number or position dropped. So a loaded board
// always lands inside the pitch.
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
      label: typeof r.label === 'string' ? r.label : '',
      side,
      x: clampFraction(x),
      y: clampFraction(y),
    })
  }
  return out
}

// A board's saved shape flattened to a string, so a move, a relabel, a
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
