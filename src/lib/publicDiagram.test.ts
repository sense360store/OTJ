import { describe, expect, it } from 'vitest'
import {
  emptyDiagram,
  MAX_DIAGRAM_ELEMENTS,
  parseDrillDiagram,
  serializeDrillDiagram,
  diagramSignature,
  type DiagramElement,
} from './drillDiagram'
import {
  PUBLIC_DIAGRAM_ELEMENT_KEYS,
  toDrillDiagram,
  validatePublicDiagram,
  type PublicDrillDiagram,
} from './publicDiagram'

// The browser's half of the DRILL-02b contract: what a public diagram may
// look like, and how it becomes the canonical renderer's input. The server's
// half is pinned in supabase/functions/_shared/share_test.ts and the two are
// compared in publicShare.invariant.test.ts.

const ALL: DiagramElement[] = [
  { type: 'player', id: 'player-1', x: 0.5, y: 0.5, colour: 'blue', label: '9' },
  { type: 'cone', id: 'cone-2', x: 0.2, y: 0.3, colour: 'orange' },
  { type: 'ball', id: 'ball-3', x: 0.4, y: 0.6 },
  { type: 'goal', id: 'goal-4', x: 0.5, y: 0.1, width: 0.24, facing: 'up' },
  { type: 'arrow', id: 'arrow-5', x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.7, arrow: 'pass' },
  { type: 'zone', id: 'zone-6', x: 0.1, y: 0.1, w: 0.4, h: 0.3, colour: 'yellow' },
  { type: 'text', id: 'text-7', x: 0.5, y: 0.9, text: 'Press' },
]

// The public shape of ALL: the stored shape with every id removed.
function publicDiagram(): PublicDrillDiagram {
  return {
    surface: { kind: 'half_pitch', orientation: 'landscape' },
    elements: ALL.map((el) => Object.fromEntries(Object.entries(el).filter(([k]) => k !== 'id'))) as PublicDrillDiagram['elements'],
  }
}

function mutated(mutate: (d: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(publicDiagram())) as Record<string, unknown>
  mutate(copy)
  return copy
}
const el = (d: Record<string, unknown>, i: number) => (d.elements as Record<string, unknown>[])[i]

describe('validatePublicDiagram', () => {
  it('accepts null and the exact public shape', () => {
    expect(validatePublicDiagram(null)).toBe(true)
    expect(validatePublicDiagram(publicDiagram())).toBe(true)
  })

  it('refuses absence: a frozen snapshot is the caller’s decision, not this predicate’s', () => {
    expect(validatePublicDiagram(undefined)).toBe(false)
  })

  it('refuses anything wider than the public shape, an element id included', () => {
    const cases: Array<[string, unknown]> = [
      ['a string', 'diagram'],
      ['an array', []],
      ['a stored version key', mutated((d) => { d.version = 1 })],
      ['an element id', mutated((d) => { el(d, 0).id = 'player-1' })],
      ['an unknown element type', mutated((d) => { el(d, 0).type = 'hologram' })],
      ['a key outside the type', mutated((d) => { el(d, 2).label = '9' })],
      ['an identity key', mutated((d) => { el(d, 0).playerId = 'p' })],
      ['an extra surface key', mutated((d) => { (d.surface as Record<string, unknown>).name = 'Pitch' })],
      ['an unknown surface kind', mutated((d) => { (d.surface as Record<string, unknown>).kind = 'ice_rink' })],
      ['an unknown orientation', mutated((d) => { (d.surface as Record<string, unknown>).orientation = 'diagonal' })],
    ]
    for (const [label, value] of cases) {
      expect(validatePublicDiagram(value), `accepted ${label}`).toBe(false)
    }
  })

  it('refuses a malformed value inside an otherwise well formed element', () => {
    const cases: Array<[string, unknown]> = [
      ['a NaN coordinate', mutated((d) => { el(d, 2).x = Number.NaN })],
      ['a coordinate off the surface', mutated((d) => { el(d, 2).y = 1.5 })],
      ['a negative coordinate', mutated((d) => { el(d, 2).y = -0.1 })],
      ['a string coordinate', mutated((d) => { el(d, 2).x = '0.5' })],
      ['a label over the cap', mutated((d) => { el(d, 0).label = 'ABCD' })],
      ['a non string label', mutated((d) => { el(d, 0).label = 9 })],
      ['a lone surrogate in a label', mutated((d) => { el(d, 0).label = '\ud83d' })],
      ['a lone surrogate in a text', mutated((d) => { el(d, 6).text = 'ab\udc00' })],
      ['a text over the cap', mutated((d) => { el(d, 6).text = 'A'.repeat(25) })],
      ['an empty text', mutated((d) => { el(d, 6).text = '' })],
      ['an unknown colour', mutated((d) => { el(d, 0).colour = 'purple' })],
      ['an unknown facing', mutated((d) => { el(d, 3).facing = 'sideways' })],
      ['a goal width off the surface', mutated((d) => { el(d, 3).width = 2 })],
      ['an unknown arrow', mutated((d) => { el(d, 4).arrow = 'teleport' })],
      ['a zone size off the surface', mutated((d) => { el(d, 5).w = 1.2 })],
      ['no elements at all', mutated((d) => { d.elements = [] })],
      ['a non array elements', mutated((d) => { d.elements = {} })],
      ['a non object element', mutated((d) => { (d.elements as unknown[]).push('cone') })],
      ['over the element cap', mutated((d) => {
        d.elements = Array.from({ length: MAX_DIAGRAM_ELEMENTS + 1 }, () => ({ type: 'ball', x: 0.5, y: 0.5 }))
      })],
    ]
    for (const [label, value] of cases) {
      expect(validatePublicDiagram(value), `accepted ${label}`).toBe(false)
    }
  })

  it('accepts a whole emoji in a label, which is two code units', () => {
    expect(validatePublicDiagram(mutated((d) => { el(d, 0).label = 'A😀' }))).toBe(true)
  })

  it('accepts exactly the element cap', () => {
    const atCap = mutated((d) => {
      d.elements = Array.from({ length: MAX_DIAGRAM_ELEMENTS }, () => ({ type: 'ball', x: 0.5, y: 0.5 }))
    })
    expect(validatePublicDiagram(atCap)).toBe(true)
  })
})

describe('the public element keys', () => {
  it('are the stored keys with the id removed, for every element type', () => {
    // BEHAVIOURAL, against the real serialiser: the stored shape is what the
    // client writes, and the public shape is exactly that minus the id.
    const stored = serializeDrillDiagram({ ...emptyDiagram(), elements: ALL }) as { elements: Record<string, unknown>[] }
    for (const s of stored.elements) {
      const type = s.type as keyof typeof PUBLIC_DIAGRAM_ELEMENT_KEYS
      const expected = Object.keys(s).filter((k) => k !== 'id')
      expect([...PUBLIC_DIAGRAM_ELEMENT_KEYS[type]].sort()).toEqual(expected.sort())
    }
    expect(Object.keys(PUBLIC_DIAGRAM_ELEMENT_KEYS).sort()).toEqual(ALL.map((e) => e.type).sort())
  })

  it('name no field that could hold a person', () => {
    for (const keys of Object.values(PUBLIC_DIAGRAM_ELEMENT_KEYS)) {
      for (const key of keys) {
        expect(key).not.toMatch(/player_?id|name|member|guardian|email|phone|shirt|id$/i)
      }
    }
  })
})

describe('toDrillDiagram', () => {
  it('mints ids by position and copies every other field by name', () => {
    const out = toDrillDiagram(publicDiagram())
    expect(out.version).toBe(1)
    expect(out.surface).toEqual({ kind: 'half_pitch', orientation: 'landscape' })
    expect(out.elements.map((e) => e.id)).toEqual([
      'player-1', 'cone-2', 'ball-3', 'goal-4', 'arrow-5', 'zone-6', 'text-7',
    ])
    // Field for field, the drawing is the one that was published.
    expect(diagramSignature(out)).toBe(diagramSignature({ ...emptyDiagram(), surface: { kind: 'half_pitch', orientation: 'landscape' }, elements: ALL }))
  })

  it('produces a diagram the canonical parser reads back unchanged', () => {
    const out = toDrillDiagram(publicDiagram())
    const back = parseDrillDiagram(serializeDrillDiagram(out))
    expect(back).not.toBeNull()
    expect(diagramSignature(back)).toBe(diagramSignature(out))
  })

  it('carries no key it was not told about, even if one reached the input', () => {
    // The validator already refuses this; the adapter is the second lock,
    // copying by name rather than spreading.
    const tainted = publicDiagram() as unknown as { elements: Record<string, unknown>[] }
    tainted.elements[0].playerId = 'p-secret'
    tainted.elements[0].name = 'Riley'
    const out = toDrillDiagram(tainted as unknown as PublicDrillDiagram)
    const flat = JSON.stringify(out)
    expect(flat).not.toContain('p-secret')
    expect(flat).not.toContain('Riley')
    expect(flat).not.toContain('playerId')
  })
})
