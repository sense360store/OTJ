import { describe, expect, it } from 'vitest'
import { FORMATIONS, clampFraction, formationCount, formationPositions, nextNumber } from './tacticsBoard'

// The board's pure helpers carry the data shape a later phase persists, so the
// suite pins the clamp and the formation maths without a DOM or a pitch.

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
