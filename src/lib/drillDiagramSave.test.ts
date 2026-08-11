import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDiagram, parseDrillDiagram, serializeDrillDiagram, type DrillDiagram } from './drillDiagram'

// The save path, exercised against a recording stand-in for the Supabase
// client. This is a BEHAVIOURAL test of the real write, not of a helper beside
// it: it captures the table, the payload, the filter and the columns the code
// actually sends. That is what makes "the diagram save cannot overwrite a
// drill's title" provable rather than asserted, and it is the test that fails
// if somebody widens the update to a whole drill row.

const state = vi.hoisted(() => ({
  calls: [] as { table: string; payload?: Record<string, unknown>; eq?: [string, unknown]; cols?: string }[],
  result: { data: null as unknown, error: null as unknown },
}))

vi.mock('./supabase', () => {
  function builder(table: string) {
    const call: { table: string; payload?: Record<string, unknown>; eq?: [string, unknown]; cols?: string } = { table }
    state.calls.push(call)
    const chain = {
      update(payload: Record<string, unknown>) {
        call.payload = payload
        return chain
      },
      eq(col: string, val: unknown) {
        call.eq = [col, val]
        return chain
      },
      select(cols: string) {
        call.cols = cols
        return chain
      },
      async maybeSingle() {
        return state.result
      },
      async single() {
        return state.result
      },
    }
    return chain
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

const { saveDrillDiagram, drillDiagramWriteRow, diagramSaveMatches, DRILL_DIAGRAM_COLS } = await import('./queries')

function withCone(): DrillDiagram {
  return { ...emptyDiagram(), elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.3, colour: 'orange' }] }
}

// What the database would hand back for a save that stored exactly what it was
// sent.
function echo(diagram: DrillDiagram) {
  return { id: 'd1', diagram: serializeDrillDiagram(diagram) }
}

beforeEach(() => {
  state.calls.length = 0
  state.result = { data: null, error: null }
})

describe('what a diagram save writes', () => {
  it('sends the diagram column and nothing else', () => {
    expect(Object.keys(drillDiagramWriteRow(withCone()))).toEqual(['diagram'])
  })

  it('sends the canonical stored form', () => {
    expect(JSON.stringify(drillDiagramWriteRow(withCone()).diagram)).toBe(JSON.stringify(serializeDrillDiagram(withCone())))
  })

  it('updates only the diagram column on the drills table, filtered to one drill', async () => {
    state.result = { data: echo(withCone()), error: null }
    await saveDrillDiagram('d1', withCone())
    const [call] = state.calls
    expect(call.table).toBe('drills')
    expect(call.eq).toEqual(['id', 'd1'])
    expect(Object.keys(call.payload!)).toEqual(['diagram'])
  })

  it('cannot overwrite a drill title, summary, rights, source or media', async () => {
    // The failure this exists for: a coach opens the editor, another coach
    // renames the drill, the first coach saves and the rename is gone. A save
    // that sends only one column cannot do that, whatever stale data the
    // editor is holding.
    state.result = { data: echo(withCone()), error: null }
    await saveDrillDiagram('d1', withCone())
    const payload = state.calls[0].payload!
    for (const forbidden of [
      'title',
      'summary',
      'corner',
      'skill',
      'level',
      'ages',
      'duration',
      'players',
      'area',
      'equipment',
      'points',
      'tags',
      'media_id',
      'setup_notes',
      'easier',
      'harder',
      'theme',
      'format',
      'source_url',
      'source_label',
      'source_key',
      'rights',
      'club_id',
      'created_by',
      'created_at',
    ]) {
      expect(payload, `the save must never write ${forbidden}`).not.toHaveProperty(forbidden)
    }
  })

  it('reads back only the id and the diagram, so no other column rides along', async () => {
    state.result = { data: echo(withCone()), error: null }
    await saveDrillDiagram('d1', withCone())
    expect(state.calls[0].cols).toBe(DRILL_DIAGRAM_COLS)
    expect(DRILL_DIAGRAM_COLS).toBe('id, diagram')
  })
})

describe('what a diagram save believes', () => {
  it('reports saved when the database hands back exactly what was sent', async () => {
    const d = withCone()
    state.result = { data: echo(d), error: null }
    const out = await saveDrillDiagram('d1', d)
    expect(out.matched).toBe(true)
  })

  it('reports NOT saved when the readback differs from what was sent', async () => {
    // A 200 is not a save. If the row that came back is not the diagram that
    // went out, the coach's work is not stored and the screen must keep saying
    // so.
    state.result = { data: { id: 'd1', diagram: serializeDrillDiagram(emptyDiagram()) }, error: null }
    const out = await saveDrillDiagram('d1', withCone())
    expect(out.matched).toBe(false)
  })

  it('reports NOT saved when the readback carries no diagram at all', async () => {
    state.result = { data: { id: 'd1', diagram: null }, error: null }
    expect((await saveDrillDiagram('d1', withCone())).matched).toBe(false)
  })

  it('reports NOT saved when the stored diagram lost an element on the way', async () => {
    const sent = withCone()
    const back = { ...sent, elements: [...sent.elements, { type: 'ball' as const, id: 'ball-2', x: 0.5, y: 0.5 }] }
    state.result = { data: echo(back), error: null }
    expect((await saveDrillDiagram('d1', sent)).matched).toBe(false)
  })

  it('refuses a write the database answered with no row, rather than claiming a save', async () => {
    // Row level security refusing an update returns zero rows and no error.
    // Treating that as success would tell a coach their work was stored when
    // the database never took it.
    state.result = { data: null, error: null }
    await expect(saveDrillDiagram('d1', withCone())).rejects.toThrow(/permission/i)
  })

  it('surfaces a database error rather than swallowing it', async () => {
    state.result = { data: null, error: { code: '42501', message: 'row-level security' } }
    await expect(saveDrillDiagram('d1', withCone())).rejects.toThrow()
  })

  it('hands back the stored diagram it read, so the screen shows what was kept', async () => {
    const d = withCone()
    state.result = { data: echo(d), error: null }
    const out = await saveDrillDiagram('d1', d)
    expect(out.diagram?.elements).toHaveLength(1)
  })

  it('survives a stored diagram that is malformed, without throwing at the screen', async () => {
    state.result = { data: { id: 'd1', diagram: { version: 99 } }, error: null }
    const out = await saveDrillDiagram('d1', withCone())
    expect(out.matched).toBe(false)
    expect(out.diagram).toBeNull()
  })
})

describe('comparing a diagram with its readback', () => {
  it('matches a diagram against its own stored form', () => {
    expect(diagramSaveMatches(withCone(), serializeDrillDiagram(withCone()))).toBe(true)
  })

  it('matches after a full parse and re-serialise, so rounding never reads as a change', () => {
    const d: DrillDiagram = { ...emptyDiagram(), elements: [{ type: 'ball', id: 'ball-1', x: 1 / 3, y: 2 / 3 }] }
    const stored = serializeDrillDiagram(d)
    // What the editor holds after a load is the PARSED diagram, so that is what
    // a later save compares.
    expect(diagramSaveMatches(parseDrillDiagram(stored)!, stored)).toBe(true)
  })

  it('does not match a different surface', () => {
    const other: DrillDiagram = { ...withCone(), surface: { kind: 'blank', orientation: 'portrait' } }
    expect(diagramSaveMatches(withCone(), serializeDrillDiagram(other))).toBe(false)
  })

  it('does not match null, undefined or rubbish', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      expect(diagramSaveMatches(withCone(), bad)).toBe(false)
    }
  })
})
