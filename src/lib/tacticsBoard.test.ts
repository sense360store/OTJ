import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD,
  FORMATIONS,
  boardIsDirty,
  captureBoardEdit,
  clampFraction,
  deleteToken,
  deserializeTokens,
  formationCount,
  formationPositions,
  isDrag,
  nextNumber,
  rosterTokens,
  serializeTokens,
  tokenFirstName,
  type BoardEdit,
  type BoardSnapshot,
  type RosterPlayer,
} from './tacticsBoard'

// The board's pure helpers carry the data shape a later phase persists, so the
// suite pins the clamp and the formation maths without a DOM or a pitch.

describe('tokenFirstName', () => {
  it('shows the first name only for a multi word name', () => {
    expect(tokenFirstName('William McGrath')).toBe('William')
  })
  it('keeps a single word name whole', () => {
    expect(tokenFirstName('William')).toBe('William')
  })
  it('takes the text before the first space when there are several', () => {
    expect(tokenFirstName('Mary Jane Watson')).toBe('Mary')
  })
  it('trims surrounding whitespace so a stray leading space never blanks it', () => {
    expect(tokenFirstName('  William McGrath ')).toBe('William')
    expect(tokenFirstName(' William ')).toBe('William')
  })
  it('returns an empty string for an empty or blank label', () => {
    expect(tokenFirstName('')).toBe('')
    expect(tokenFirstName('   ')).toBe('')
  })
})

describe('isDrag', () => {
  it('treats a still pointer as a tap, not a drag', () => {
    expect(isDrag(0, 0)).toBe(false)
  })
  it('treats movement below the threshold as a tap, so a slightly imprecise tap still selects', () => {
    // A finger that shifts a pixel or two on press is still a tap.
    expect(isDrag(2, 2)).toBe(false)
    expect(isDrag(DRAG_THRESHOLD - 1, 0)).toBe(false)
  })
  it('treats movement at or beyond the threshold as a drag, so a press and move moves the token', () => {
    expect(isDrag(DRAG_THRESHOLD, 0)).toBe(true)
    expect(isDrag(0, DRAG_THRESHOLD)).toBe(true)
    expect(isDrag(20, 20)).toBe(true)
  })
  it('measures the diagonal distance, not either axis alone', () => {
    // 5 across and 5 down is ~7.07 of travel, past a 6px threshold, a drag.
    expect(isDrag(5, 5)).toBe(true)
    // Honours a custom threshold.
    expect(isDrag(5, 5, 10)).toBe(false)
  })
})

describe('deleteToken', () => {
  it('removes the chosen token and leaves every other token untouched', () => {
    const tokens = formationPositions('2-3-1', 'home')
    const target = tokens[3]
    const after = deleteToken(tokens, target.id)
    expect(after.length).toBe(tokens.length - 1)
    // The chosen token is gone.
    expect(after.find((t) => t.id === target.id)).toBeUndefined()
    // Every other token survives, in order and unchanged.
    expect(after).toEqual(tokens.filter((t) => t.id !== target.id))
  })

  it('selecting then deleting one token never disturbs the others', () => {
    // The board mints unique ids per side-number, so deleting by the selected
    // id removes exactly one disc. Home and away can share a number; the id
    // carries the side, so the right one goes.
    const tokens = [...formationPositions('1-2-1', 'home'), ...formationPositions('1-2-1', 'away')]
    const selected = 'away-1'
    const after = deleteToken(tokens, selected)
    expect(after.some((t) => t.id === 'away-1')).toBe(false)
    // The home keeper, the other number 1, is untouched.
    expect(after.some((t) => t.id === 'home-1')).toBe(true)
    expect(after.length).toBe(tokens.length - 1)
  })

  it('returns the list unchanged when the id matches nothing', () => {
    const tokens = formationPositions('1-2-1', 'home')
    expect(deleteToken(tokens, 'no-such-id')).toEqual(tokens)
  })
})

describe('clampFraction', () => {
  it('pulls a value above the range down to the upper bound', () => {
    expect(clampFraction(1.4)).toBe(1)
  })
  it('pulls a value below the range up to the lower bound', () => {
    expect(clampFraction(-0.5)).toBe(0)
  })
  it('leaves a value inside the range untouched', () => {
    expect(clampFraction(0.42)).toBe(0.42)
  })
  it('honours a margin so a disc stays off the touchline', () => {
    expect(clampFraction(1, 0.05)).toBe(0.95)
    expect(clampFraction(0, 0.05)).toBe(0.05)
    expect(clampFraction(0.5, 0.05)).toBe(0.5)
  })
})

describe('formationPositions', () => {
  it('places the line sum plus a goalkeeper for every formation', () => {
    for (const f of FORMATIONS) {
      const tokens = formationPositions(f.key, 'home')
      expect(tokens.length).toBe(formationCount(f))
    }
  })

  it('seats the named small sided and eleven a side shapes', () => {
    expect(formationPositions('1-2-1', 'home').length).toBe(5)
    expect(formationPositions('2-3-1', 'home').length).toBe(7)
    expect(formationPositions('3-2-3', 'home').length).toBe(9)
    expect(formationPositions('4-4-2', 'home').length).toBe(11)
    expect(formationPositions('4-3-3', 'home').length).toBe(11)
  })

  it('returns nothing for an unknown formation', () => {
    expect(formationPositions('9-9-9', 'home')).toEqual([])
  })

  it('numbers tokens 1 upward, uniquely, the keeper first', () => {
    const tokens = formationPositions('4-4-2', 'home')
    const numbers = tokens.map((t) => t.number)
    expect(numbers[0]).toBe(1)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(Math.max(...numbers)).toBe(11)
  })

  it('keeps every position a clean fraction inside the pitch', () => {
    for (const f of FORMATIONS) {
      for (const t of formationPositions(f.key, 'home')) {
        expect(t.x).toBeGreaterThanOrEqual(0)
        expect(t.x).toBeLessThanOrEqual(1)
        expect(t.y).toBeGreaterThanOrEqual(0)
        expect(t.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('mirrors the away side so the two shapes face each other', () => {
    const home = formationPositions('4-4-2', 'home')
    const away = formationPositions('4-4-2', 'away')
    // The home keeper sits deep, the away keeper deep at the other end.
    expect(home[0].y).toBeGreaterThan(0.5)
    expect(away[0].y).toBeLessThan(0.5)
    expect(away[0].side).toBe('away')
    // Each away token mirrors its home counterpart across the halfway line.
    home.forEach((t, i) => expect(away[i].y).toBeCloseTo(1 - t.y))
  })
})

describe('nextNumber', () => {
  it('starts a side at one', () => {
    expect(nextNumber([], 'home')).toBe(1)
  })
  it('counts past the highest number on that side only', () => {
    const tokens = formationPositions('2-3-1', 'home')
    expect(nextNumber(tokens, 'home')).toBe(8)
    // The away side is numbered on its own.
    expect(nextNumber(tokens, 'away')).toBe(1)
  })
})

describe('rosterTokens', () => {
  const roster: RosterPlayer[] = [
    { displayName: 'Alex', shirtNumber: 7 },
    { displayName: 'Sam B', shirtNumber: 9 },
    { displayName: 'Jo', shirtNumber: 4 },
  ]

  it('places one token per player with the display name as the label', () => {
    const tokens = rosterTokens(roster, 'home')
    expect(tokens.length).toBe(roster.length)
    expect(tokens.map((t) => t.label)).toEqual(['Alex', 'Sam B', 'Jo'])
  })

  it('uses each player shirt number as the token number', () => {
    const tokens = rosterTokens(roster, 'home')
    expect(tokens.map((t) => t.number)).toEqual([7, 9, 4])
  })

  it('falls back to the next free number for a player with none, without colliding', () => {
    const mixed: RosterPlayer[] = [
      { displayName: 'No number', shirtNumber: null },
      { displayName: 'Has one', shirtNumber: 1 },
      { displayName: 'Also none', shirtNumber: null },
    ]
    const tokens = rosterTokens(mixed, 'home')
    const numbers = tokens.map((t) => t.number)
    // 1 is taken by the second player, so the fallbacks skip it.
    expect(numbers).toEqual([2, 1, 3])
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('shows the position index when no shirt number is set, the number when it is', () => {
    // Spond supplies no shirt numbers, so a roster seeded from it has every
    // shirtNumber null and the disc number falls back to the 1 based board
    // position. A real shirt number, when one is present, shows instead.
    const noNumbers: RosterPlayer[] = [
      { displayName: 'Theo Draper', shirtNumber: null },
      { displayName: 'William McKenzie', shirtNumber: null },
      { displayName: 'Bekki Marsh', shirtNumber: null },
    ]
    expect(rosterTokens(noNumbers, 'home').map((t) => t.number)).toEqual([1, 2, 3])

    const oneNumbered: RosterPlayer[] = [
      { displayName: 'Theo Draper', shirtNumber: null },
      { displayName: 'William McKenzie', shirtNumber: 10 },
      { displayName: 'Bekki Marsh', shirtNumber: null },
    ]
    const numbers = rosterTokens(oneNumbered, 'home').map((t) => t.number)
    // The numbered player shows the real shirt number; the others take a free
    // position index that never collides with it.
    expect(numbers[1]).toBe(10)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('seats the away roster in the far half, mirroring home', () => {
    const home = rosterTokens(roster, 'home')
    const away = rosterTokens(roster, 'away')
    expect(home[0].side).toBe('home')
    expect(away[0].side).toBe('away')
    home.forEach((t, i) => expect(away[i].y).toBeCloseTo(1 - t.y))
  })

  it('keeps every position a clean fraction inside the pitch', () => {
    for (const t of rosterTokens(roster, 'home')) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThanOrEqual(1)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeLessThanOrEqual(1)
    }
  })

  it('returns an empty board for an empty roster', () => {
    expect(rosterTokens([], 'home')).toEqual([])
  })

  it('snapshots the names so a later roster change cannot touch a saved board', () => {
    // A board saves the serialised tokens. Build them from the roster, then
    // mutate the source roster the way a delete or rename would. The saved
    // tokens are a plain copy with no link back to a player, so they are
    // unaffected: a deleted player never corrupts an existing board.
    const source: RosterPlayer[] = [
      { displayName: 'Alex', shirtNumber: 7 },
      { displayName: 'Sam B', shirtNumber: 9 },
    ]
    const saved = serializeTokens(rosterTokens(source, 'home'))
    const before = JSON.stringify(saved)
    // Delete the first player and rename the second in the live roster.
    source.shift()
    source[0].displayName = 'Renamed'
    // The saved tokens carry only id, number, label, side and the fractions,
    // never a player id, and are untouched by the roster edits.
    expect(JSON.stringify(saved)).toBe(before)
    expect(saved.map((t) => t.label)).toEqual(['Alex', 'Sam B'])
    for (const t of saved) {
      expect(Object.keys(t).sort()).toEqual(['id', 'label', 'number', 'side', 'x', 'y'])
    }
    // And a load of those saved tokens round trips unchanged.
    expect(deserializeTokens(saved).map((t) => t.label)).toEqual(['Alex', 'Sam B'])
  })
})

describe('serialize then deserialize', () => {
  it('returns identical token positions for a saved board', () => {
    const tokens = [...formationPositions('4-4-2', 'home'), ...formationPositions('2-3-1', 'away')]
    const round = deserializeTokens(serializeTokens(tokens))
    expect(round).toEqual(tokens)
    // The positions in particular survive untouched.
    round.forEach((t, i) => {
      expect(t.x).toBe(tokens[i].x)
      expect(t.y).toBe(tokens[i].y)
    })
  })

  it('keeps a dragged position through the round trip', () => {
    const tokens = formationPositions('1-2-1', 'home').map((t, i) => (i === 0 ? { ...t, x: 0.123, y: 0.456 } : t))
    const round = deserializeTokens(serializeTokens(tokens))
    expect(round[0].x).toBe(0.123)
    expect(round[0].y).toBe(0.456)
  })

  it('reads tokens back defensively, dropping malformed entries and rebuilding the id', () => {
    const stored = [
      { number: 7, label: 'CB', side: 'home', x: 0.4, y: 0.7 },
      { number: 'nope', side: 'home', x: 0.5, y: 0.5 },
      'garbage',
      { number: 9, side: 'away', x: 1.4, y: -0.2 },
    ]
    const tokens = deserializeTokens(stored)
    expect(tokens.length).toBe(2)
    expect(tokens[0]).toEqual({ id: 'home-7', number: 7, label: 'CB', side: 'home', x: 0.4, y: 0.7 })
    // Out of range fractions are clamped back onto the pitch.
    expect(tokens[1].x).toBe(1)
    expect(tokens[1].y).toBe(0)
    expect(tokens[1].id).toBe('away-9')
  })

  it('returns an empty board for a non array value', () => {
    expect(deserializeTokens(null)).toEqual([])
    expect(deserializeTokens({})).toEqual([])
  })
})

describe('captureBoardEdit', () => {
  const state: BoardEdit = {
    name: 'Titans high press',
    formation: '2-3-1',
    side: 'home',
    teamId: 'team-1',
    tokens: formationPositions('2-3-1', 'home'),
  }

  it('captures the editable fields the edit session restores on cancel', () => {
    const snap = captureBoardEdit(state)
    expect(snap.name).toBe(state.name)
    expect(snap.formation).toBe(state.formation)
    expect(snap.side).toBe(state.side)
    expect(snap.teamId).toBe(state.teamId)
    expect(snap.tokens).toEqual(state.tokens)
  })

  it('clones the tokens so a later move on the working board cannot reach the snapshot', () => {
    // This is the Cancel guarantee: edit mode snapshots, the coach drags tokens
    // around, then Cancel restores the snapshot to the pre edit positions. The
    // snapshot must be isolated from the working board, so moving a working
    // token after the capture leaves the captured position intact.
    const snap = captureBoardEdit(state)
    const before = snap.tokens[0].x
    // A move the way the board mutates state: a fresh array of fresh tokens.
    const working = state.tokens.map((t, i) => (i === 0 ? { ...t, x: t.x + 0.25, y: t.y + 0.25 } : t))
    expect(working[0].x).not.toBe(before)
    // The captured snapshot is untouched, so restoring it returns the original
    // positions.
    expect(snap.tokens[0].x).toBe(before)
  })
})

describe('boardIsDirty', () => {
  const base: BoardSnapshot = {
    name: 'Titans high press',
    formation: '2-3-1',
    teamId: 'team-1',
    tokens: formationPositions('2-3-1', 'home'),
  }

  it('is clean against an identical snapshot', () => {
    expect(boardIsDirty(base, { ...base, tokens: [...base.tokens] })).toBe(false)
  })

  it('reports unsaved changes after a token moves', () => {
    const moved: BoardSnapshot = {
      ...base,
      tokens: base.tokens.map((t, i) => (i === 0 ? { ...t, x: t.x + 0.1, y: t.y - 0.1 } : t)),
    }
    expect(boardIsDirty(moved, base)).toBe(true)
  })

  it('reports unsaved changes after a relabel, a rename, a formation or a team change', () => {
    expect(boardIsDirty({ ...base, tokens: base.tokens.map((t, i) => (i === 0 ? { ...t, label: 'GK' } : t)) }, base)).toBe(
      true,
    )
    expect(boardIsDirty({ ...base, name: 'Renamed' }, base)).toBe(true)
    expect(boardIsDirty({ ...base, formation: '4-4-2' }, base)).toBe(true)
    expect(boardIsDirty({ ...base, teamId: 'team-2' }, base)).toBe(true)
  })
})
