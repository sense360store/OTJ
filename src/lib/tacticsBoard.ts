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
