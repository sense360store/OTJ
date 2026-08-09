import { describe, expect, it } from 'vitest'
import {
  areaLabel,
  boundarySvgPoints,
  formatBoundaryText,
  isBoundary,
  isBoundaryVertex,
  parseBoundaryText,
  parseCentreText,
  polygonAreaSquareMetres,
  type Boundary,
} from './venues'

// The two real venues' boundaries, verbatim from the ADR-0008 programme
// brief and the 0043 seed: owner drawn approximations of the usable green
// areas. The area assertions pin the projection maths against the stated
// real world sizes (Flushdyke about 2,260 m², Haggs Hill about 7,445 m²),
// so a broken projection cannot slip through looking plausible.

const FLUSHDYKE: Boundary = [
  [53.68568155, -1.56218739],
  [53.68529301, -1.56243823],
  [53.68517449, -1.56162951],
  [53.68550302, -1.56145621],
]

const HAGGS_HILL: Boundary = [
  [53.67594325, -1.5545456],
  [53.67614254, -1.55348528],
  [53.67696607, -1.55416899],
  [53.67681938, -1.55521524],
]

describe('isBoundaryVertex', () => {
  it('accepts a lat lng pair within world bounds', () => {
    expect(isBoundaryVertex([53.68, -1.56])).toBe(true)
    expect(isBoundaryVertex([-90, 180])).toBe(true)
  })

  it('refuses wrong shapes and out of range values', () => {
    expect(isBoundaryVertex([53.68])).toBe(false)
    expect(isBoundaryVertex([53.68, -1.56, 0])).toBe(false)
    expect(isBoundaryVertex(['53.68', '-1.56'])).toBe(false)
    expect(isBoundaryVertex([91, 0])).toBe(false)
    expect(isBoundaryVertex([0, -181])).toBe(false)
    expect(isBoundaryVertex([Number.NaN, 0])).toBe(false)
    expect(isBoundaryVertex(null)).toBe(false)
  })
})

describe('isBoundary', () => {
  it('accepts the seeded polygons', () => {
    expect(isBoundary(FLUSHDYKE)).toBe(true)
    expect(isBoundary(HAGGS_HILL)).toBe(true)
  })

  it('refuses too few vertices, non arrays and bad members', () => {
    expect(isBoundary(FLUSHDYKE.slice(0, 2))).toBe(false)
    expect(isBoundary('not a polygon')).toBe(false)
    expect(isBoundary(null)).toBe(false)
    expect(isBoundary([...FLUSHDYKE.slice(0, 3), [91, 0]])).toBe(false)
  })

  it('refuses a boundary over the vertex cap', () => {
    const big = Array.from({ length: 65 }, (_, i) => [53 + i * 0.0001, -1.5] as [number, number])
    expect(isBoundary(big)).toBe(false)
  })
})

describe('polygonAreaSquareMetres', () => {
  it('reproduces the stated Flushdyke usable field area', () => {
    const area = polygonAreaSquareMetres(FLUSHDYKE)
    expect(area).toBeGreaterThan(2260 * 0.95)
    expect(area).toBeLessThan(2260 * 1.05)
  })

  it('reproduces the stated Haggs Hill main field area', () => {
    const area = polygonAreaSquareMetres(HAGGS_HILL)
    expect(area).toBeGreaterThan(7445 * 0.95)
    expect(area).toBeLessThan(7445 * 1.05)
  })

  it('vertex order does not change the magnitude', () => {
    const reversed = [...FLUSHDYKE].reverse()
    expect(polygonAreaSquareMetres(reversed)).toBeCloseTo(polygonAreaSquareMetres(FLUSHDYKE), 6)
  })

  it('a degenerate polygon has no area', () => {
    expect(polygonAreaSquareMetres([])).toBe(0)
    expect(
      polygonAreaSquareMetres([
        [53.0, -1.5],
        [53.0, -1.5],
        [53.0, -1.5],
      ]),
    ).toBe(0)
  })
})

describe('areaLabel', () => {
  it('labels a real boundary with its rounded area', () => {
    expect(areaLabel(FLUSHDYKE)).toMatch(/^about [\d,]+ m²$/)
  })

  it('owns up to an unreadable boundary', () => {
    expect(areaLabel(null)).toBe('Boundary not readable')
  })
})

describe('parseBoundaryText and formatBoundaryText', () => {
  it('round trips a boundary through the textarea format', () => {
    const text = formatBoundaryText(FLUSHDYKE)
    const { boundary, error } = parseBoundaryText(text)
    expect(error).toBeNull()
    expect(boundary).toEqual(FLUSHDYKE)
  })

  it('tolerates blank lines and stray whitespace', () => {
    const { boundary, error } = parseBoundaryText('\n 53.68, -1.56 \n\n53.69 ,-1.57\n53.70,-1.55\n')
    expect(error).toBeNull()
    expect(boundary).toEqual([
      [53.68, -1.56],
      [53.69, -1.57],
      [53.7, -1.55],
    ])
  })

  it('names the line it could not read', () => {
    const { boundary, error } = parseBoundaryText('53.68, -1.56\nnot a vertex\n53.70, -1.55')
    expect(boundary).toBeNull()
    expect(error).toContain('not a vertex')
  })

  it('refuses out of range values and short polygons', () => {
    expect(parseBoundaryText('91, 0\n53, -1\n54, -1').boundary).toBeNull()
    const short = parseBoundaryText('53.68, -1.56\n53.69, -1.57')
    expect(short.boundary).toBeNull()
    expect(short.error).toContain('at least 3')
  })

  it('never fabricates a zero coordinate from an empty part', () => {
    // Number('') is 0, so a bare comma or a trailing comma must be an
    // error, not a vertex at the equator or Greenwich.
    expect(parseBoundaryText(',\n53, -1\n54, -1').boundary).toBeNull()
    expect(parseBoundaryText('53.69,\n53, -1\n54, -1').boundary).toBeNull()
    expect(parseBoundaryText('0x10, 0x20\n53, -1\n54, -1').boundary).toBeNull()
  })

  it('refuses an empty input with a helpful message', () => {
    const { boundary, error } = parseBoundaryText('   \n  ')
    expect(boundary).toBeNull()
    expect(error).toContain('one vertex per line')
  })
})

describe('boundarySvgPoints', () => {
  it('fits the polygon into the box and preserves vertex count', () => {
    const points = boundarySvgPoints(FLUSHDYKE, 200, 120)
    expect(points).not.toBeNull()
    const pairs = points!.split(' ').map((p) => p.split(',').map(Number))
    expect(pairs).toHaveLength(4)
    for (const [x, y] of pairs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(200)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(120)
    }
  })

  it('is scale true: the drawn aspect follows the metric aspect, not the box', () => {
    // Haggs Hill is wider than tall in metres; squeezing it into a tall thin
    // box must letterbox, not stretch. Compare drawn spans against a square
    // box render: the ratio of x span to y span stays the same.
    const inWide = boundarySvgPoints(HAGGS_HILL, 300, 300)!
    const inTall = boundarySvgPoints(HAGGS_HILL, 100, 300)!
    const spans = (pts: string) => {
      const pairs = pts.split(' ').map((p) => p.split(',').map(Number))
      const xs = pairs.map(([x]) => x)
      const ys = pairs.map(([, y]) => y)
      return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))
    }
    expect(spans(inWide)).toBeCloseTo(spans(inTall), 1)
  })

  it('returns null for a degenerate boundary', () => {
    expect(boundarySvgPoints([], 100, 100)).toBeNull()
    expect(
      boundarySvgPoints(
        [
          [53.0, -1.5],
          [53.0, -1.5],
          [53.0, -1.5],
        ],
        100,
        100,
      ),
    ).toBeNull()
  })
})

describe('parseCentreText', () => {
  it('reads a lat, lng pair', () => {
    expect(parseCentreText('53.68541302, -1.56192784')).toEqual({ lat: 53.68541302, lng: -1.56192784 })
  })

  it('refuses anything else', () => {
    expect(parseCentreText('53.68541302')).toBeNull()
    expect(parseCentreText('north, west')).toBeNull()
    expect(parseCentreText('91, 0')).toBeNull()
    expect(parseCentreText('53.68,')).toBeNull()
    expect(parseCentreText(',')).toBeNull()
    expect(parseCentreText('0x10, 0x20')).toBeNull()
  })
})
