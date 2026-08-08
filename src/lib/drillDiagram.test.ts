import { describe, expect, it } from 'vitest'
import { arrowShaft, DIAGRAM_LONG_SIDE, diagramScale, wavyPath } from './drillDiagram'

// The renderer's pure geometry: scale trueness and the arrow arithmetic.

describe('diagramScale', () => {
  it('maps the longest side to the fixed viewBox length', () => {
    expect(diagramScale({ width: 12, length: 12 })).toBe(DIAGRAM_LONG_SIDE / 12)
    expect(diagramScale({ width: 30, length: 20 })).toBe(DIAGRAM_LONG_SIDE / 30)
    expect(diagramScale({ width: 10, length: 150 })).toBe(DIAGRAM_LONG_SIDE / 150)
  })

  it('keeps positions scale true: a metre is the same number of units on both axes', () => {
    const k = diagramScale({ width: 15, length: 10 })
    // A 15 by 10 area draws 600 wide and 400 tall: the same k both ways.
    expect(15 * k).toBe(DIAGRAM_LONG_SIDE)
    expect(10 * k).toBe(400)
  })
})

describe('arrowShaft', () => {
  it('pulls the end back along the line by the head allowance', () => {
    const { from, to } = arrowShaft({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)
    expect(from).toEqual({ x: 0, y: 0 })
    expect(to.x).toBeCloseTo(8)
    expect(to.y).toBeCloseTo(0)
  })

  it('pulls back on a diagonal without changing direction', () => {
    const { to } = arrowShaft({ x: 0, y: 0 }, { x: 3, y: 4 }, 1)
    // Length 5 shrinks to 4, direction preserved.
    expect(Math.hypot(to.x, to.y)).toBeCloseTo(4)
    expect(to.y / to.x).toBeCloseTo(4 / 3)
  })

  it('leaves a zero length or too short arrow untouched', () => {
    const zero = arrowShaft({ x: 5, y: 5 }, { x: 5, y: 5 }, 2)
    expect(zero.to).toEqual({ x: 5, y: 5 })
    const short = arrowShaft({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)
    expect(short.to).toEqual({ x: 1, y: 0 })
  })
})

describe('wavyPath', () => {
  it('starts at the from point and ends exactly on the to point', () => {
    const d = wavyPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, 16)
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.endsWith('100 0')).toBe(true)
  })

  it('alternates half waves to both sides and finishes with a straight tail', () => {
    const d = wavyPath({ x: 0, y: 0 }, { x: 64, y: 0 }, 5, 16)
    // 56 waved units at wavelength 16 is 7 half waves; control points
    // alternate above and below a horizontal line, and the final segment
    // runs straight into the endpoint so an auto oriented arrowhead takes
    // the travel direction, not a wave tangent.
    const controls = [...d.matchAll(/Q (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(controls.length).toBe(7)
    expect(controls.filter((y) => y > 0).length).toBe(4)
    expect(controls.filter((y) => y < 0).length).toBe(3)
    expect(controls[0]).toBe(-controls[1])
    expect(d.endsWith('L 64 0')).toBe(true)
  })

  it('always draws at least one wave, and a zero length dribble degrades to a point', () => {
    const short = wavyPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 5, 16)
    expect(short).toContain('Q')
    expect(wavyPath({ x: 2, y: 2 }, { x: 2, y: 2 }, 5, 16)).toBe('M 2 2')
  })
})
