import { describe, expect, it } from 'vitest'
import {
  LAYOUT_MAX_ENTITIES_PER_FRAME,
  LAYOUT_MAX_FRAMES,
  layoutProblems,
} from './drillLayout'
import { FIXTURE_ONE_V_ONE } from './drillLayoutFixtures'
import {
  addArrow,
  addEntity,
  addZone,
  canEditLayout,
  commit,
  duplicatePhase,
  emptyLayout,
  HISTORY_CAP,
  historyOf,
  moveEntity,
  moveZone,
  redo,
  removeArrow,
  removeEntity,
  removePhase,
  removeZone,
  resizeZone,
  rotateEntity,
  setArea,
  setEntityLabel,
  setEntityTeam,
  setPhaseNote,
  setZoneLabel,
  undo,
} from './layoutEditor'

// The editor's pure model. The standing invariant: every operation
// returns a layout that still validates clean, so the editor can never
// build a value the parse gate or the database check would refuse.

const clean = (l: unknown) => expect(layoutProblems(l)).toEqual([])

describe('editor invariant: every operation validates clean', () => {
  it('holds across a whole editing session', () => {
    let l = emptyLayout()
    clean(l)
    l = addEntity(l, 'cone', { x: 1, y: 1 })!
    l = addEntity(l, 'player', { x: 5, y: 5 }, 'defence')!
    l = addEntity(l, 'goal', { x: 10, y: 7 })!
    l = addZone(l, 0, { x: 2, y: 2 })!
    l = addArrow(l, 0, 'pass', { x: 1, y: 1 }, { x: 5, y: 5 })!
    l = duplicatePhase(l, 0)!
    l = moveEntity(l, 1, 'e2', { x: 8, y: 8 })
    l = rotateEntity(l, 1, 'e3')
    l = setEntityLabel(l, 'e2', 'GK')
    l = setEntityTeam(l, 'e2', 'neutral')
    l = setZoneLabel(l, 0, 'z1', 'Build zone')
    l = resizeZone(l, 0, 'z1', 8, 6)
    l = moveZone(l, 0, 'z1', { x: 4, y: 4 })
    l = setPhaseNote(l, 1, 'Then the duel.')
    l = setArea(l, 12, 9)
    clean(l)
    l = removeArrow(l, 0, 'a1')
    l = removeZone(l, 0, 'z1')
    l = removeEntity(l, 'e1')
    l = removePhase(l, 1)!
    clean(l)
  })
})

describe('shared identity across phases', () => {
  it('adding a piece adds it to every phase at the same spot', () => {
    let l = duplicatePhase(emptyLayout(), 0)!
    l = addEntity(l, 'cone', { x: 3, y: 3 })!
    expect(l.frames[0].entities.map((e) => e.id)).toEqual(['e1'])
    expect(l.frames[1].entities.map((e) => e.id)).toEqual(['e1'])
    clean(l)
  })

  it('removing a piece removes it from every phase', () => {
    let l = addEntity(emptyLayout(), 'ball', { x: 2, y: 2 })!
    l = duplicatePhase(l, 0)!
    l = removeEntity(l, 'e1')
    expect(l.frames.every((f) => f.entities.length === 0)).toBe(true)
    clean(l)
  })

  it('zones and arrows belong to one phase only', () => {
    let l = duplicatePhase(emptyLayout(), 0)!
    l = addZone(l, 1, { x: 1, y: 1 })!
    l = addArrow(l, 1, 'run', { x: 0, y: 0 }, { x: 5, y: 5 })!
    expect(l.frames[0].zones).toHaveLength(0)
    expect(l.frames[1].zones).toHaveLength(1)
    expect(l.frames[0].arrows).toHaveLength(0)
    expect(l.frames[1].arrows).toHaveLength(1)
    clean(l)
  })

  it('labels stay the same piece tag in every phase, rotation is per phase', () => {
    let l = addEntity(emptyLayout(), 'player', { x: 2, y: 2 })!
    l = duplicatePhase(l, 0)!
    l = setEntityLabel(l, 'e1', 'A')
    expect(l.frames[0].entities[0].label).toBe('A')
    expect(l.frames[1].entities[0].label).toBe('A')
    l = addEntity(l, 'mannequin', { x: 4, y: 4 })!
    l = rotateEntity(l, 1, 'e2')
    expect(l.frames[0].entities[1].rotation).toBeUndefined()
    expect(l.frames[1].entities[1].rotation).toBe(45)
    clean(l)
  })
})

describe('placement rules', () => {
  it('clamps and snaps placements into the area', () => {
    const l = addEntity(emptyLayout(20, 15), 'cone', { x: 999, y: -3.14159 })!
    expect(l.frames[0].entities[0]).toMatchObject({ x: 20, y: 0 })
    clean(l)
  })

  it('ids never collide, even after a removal', () => {
    let l = addEntity(emptyLayout(), 'cone', { x: 1, y: 1 })!
    l = addEntity(l, 'cone', { x: 2, y: 2 })!
    l = removeEntity(l, 'e1')
    l = addEntity(l, 'cone', { x: 3, y: 3 })!
    expect(l.frames[0].entities.map((e) => e.id)).toEqual(['e2', 'e3'])
  })

  it('refuses past the caps: entities, phases, and a zero length arrow', () => {
    let l = emptyLayout()
    for (let i = 0; i < LAYOUT_MAX_ENTITIES_PER_FRAME; i++) l = addEntity(l, 'cone', { x: 1, y: 1 })!
    expect(addEntity(l, 'cone', { x: 1, y: 1 })).toBeNull()
    let phased = emptyLayout()
    for (let i = 0; i < LAYOUT_MAX_FRAMES - 1; i++) phased = duplicatePhase(phased, 0)!
    expect(duplicatePhase(phased, 0)).toBeNull()
    expect(removePhase(emptyLayout(), 0)).toBeNull()
    expect(addArrow(emptyLayout(), 0, 'pass', { x: 3, y: 3 }, { x: 3, y: 3 })).toBeNull()
  })

  it('a player takes the chosen team, another piece never takes one', () => {
    const l = addEntity(emptyLayout(), 'player', { x: 1, y: 1 }, 'neutral')!
    expect(l.frames[0].entities[0].team).toBe('neutral')
    const cone = addEntity(emptyLayout(), 'cone', { x: 1, y: 1 }, 'attack')!
    expect(cone.frames[0].entities[0].team).toBeUndefined()
    clean(cone)
  })
})

describe('setArea', () => {
  it('shrinking the area pulls every piece, zone and arrow inside', () => {
    const shrunk = setArea(FIXTURE_ONE_V_ONE, 8, 6)
    clean(shrunk)
    for (const f of shrunk.frames) {
      for (const e of f.entities) {
        expect(e.x).toBeLessThanOrEqual(8)
        expect(e.y).toBeLessThanOrEqual(6)
      }
      for (const z of f.zones) {
        expect(z.x + z.width).toBeLessThanOrEqual(8)
        expect(z.y + z.height).toBeLessThanOrEqual(6)
      }
    }
  })

  it('clamps the dimensions to the metre bounds', () => {
    expect(setArea(emptyLayout(), 1, 999).area).toEqual({ width: 2, length: 150 })
  })
})

describe('history', () => {
  it('undo and redo walk the snapshots, and a new commit clears the future', () => {
    const a = emptyLayout()
    const b = addEntity(a, 'cone', { x: 1, y: 1 })!
    const c = addEntity(b, 'ball', { x: 2, y: 2 })!
    let h = commit(commit(historyOf(a), b), c)
    expect(h.layout).toBe(c)
    h = undo(h)
    expect(h.layout).toBe(b)
    h = redo(h)
    expect(h.layout).toBe(c)
    h = undo(h)
    const d = addEntity(b, 'marker', { x: 3, y: 3 })!
    h = commit(h, d)
    expect(h.future).toEqual([])
    expect(undo(h).layout).toBe(b)
  })

  it('undo at the start and redo at the end are no ops', () => {
    const h = historyOf(emptyLayout())
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('caps the past at the history limit', () => {
    let h = historyOf(emptyLayout())
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      h = commit(h, addEntity(h.layout, 'cone', { x: 1, y: 1 }) ?? h.layout)
    }
    expect(h.past.length).toBeLessThanOrEqual(HISTORY_CAP)
  })
})

describe('text safety', () => {
  it('never splits a surrogate pair: a clipped emoji label stays well formed and clean', () => {
    let l = addEntity(emptyLayout(), 'player', { x: 1, y: 1 })!
    l = setEntityLabel(l, 'e1', '\u{1F44D}\u{1F44D}')
    expect(l.frames[0].entities[0].label).toBe('\u{1F44D}')
    clean(l)
    // The storage path: well formed JSON end to end.
    expect(() => JSON.parse(JSON.stringify(l))).not.toThrow()
  })

  it('a crafted enormous id suffix cannot poison the id generator', () => {
    let l = addEntity(emptyLayout(), 'cone', { x: 1, y: 1 })!
    l.frames[0].entities[0].id = 'e' + '9'.repeat(22)
    l = { ...l, frames: l.frames.map((f) => ({ ...f, entities: f.entities.map((e) => ({ ...e })) })) }
    const next = addEntity(l, 'cone', { x: 2, y: 2 })!
    expect(next.frames[0].entities[1].id).toBe('e1')
    clean(next)
  })
})

describe('canEditLayout', () => {
  it('offers the diagram on club authored drills only, never imported ones', () => {
    expect(canEditLayout('')).toBe(true)
    expect(canEditLayout('  ')).toBe(true)
    expect(canEditLayout('https://learn.englandfootball.com/x')).toBe(false)
  })
})
