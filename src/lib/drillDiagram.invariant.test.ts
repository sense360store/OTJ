import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BIB_COLOURS } from './bibs'
import {
  DIAGRAM_COLOURS,
  ELEMENT_TYPES,
  MAX_DIAGRAM_ELEMENTS,
  emptyDiagram,
  nextElementId,
  parseDrillDiagram,
  serializeDrillDiagram,
  type DiagramElement,
} from './drillDiagram'
import { DRILL_DIAGRAM_COLS, drillDiagramWriteRow } from './queries'
// The REAL Edge Function projection, imported directly rather than mirrored in
// a fixture. It has one relative import and no Deno globals at module level, so
// vitest loads it; testing the mirror instead would prove nothing about what
// actually builds a public snapshot.
import { buildDrillSnapshot } from '../../supabase/functions/_shared/share.ts'

// The tripwire for Drill Maker's seams.
//
// WHAT IT CAN CATCH. Most of what follows is BEHAVIOURAL: it calls the real
// functions and checks the real answers, so it holds however the code is
// rearranged. Three checks read source text, and they are marked. Those three
// catch the realistic mistake, which is somebody typing the obvious thing in a
// hurry: a second SVG in the drill page, a `mutate` inside a pointer handler, a
// `diagram` key added to the whole drill write.
//
// WHAT IT CANNOT CATCH. The source text checks are defeated by anything
// indirect: a renderer reached through a variable, a save called through a
// helper in another file, a column name assembled from fragments. They are a
// tripwire, never a proof, and a passing run means "nobody typed the obvious
// thing", not "there is only one renderer". The behavioural checks are stronger
// but they only test the paths they call: they cannot prove that some future
// module does not parse a diagram its own way, only that the ones here do not.
//
// It also deliberately does NOT try to prove the editor and the renderer draw
// the same shapes by reading imports. Presence of an identifier says nothing
// about which call site uses it. What it checks instead is that the drill page
// contains no SVG of its own, which is the thing that would actually go wrong.

const SRC = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

const ALL: DiagramElement[] = [
  { type: 'player', id: 'player-1', x: 0.5, y: 0.5, colour: 'blue', label: '9' },
  { type: 'cone', id: 'cone-2', x: 0.2, y: 0.3, colour: 'orange' },
  { type: 'ball', id: 'ball-3', x: 0.4, y: 0.6 },
  { type: 'goal', id: 'goal-4', x: 0.5, y: 0.1, width: 0.24, facing: 'up' },
  { type: 'arrow', id: 'arrow-5', x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.7, arrow: 'pass' },
  { type: 'zone', id: 'zone-6', x: 0.1, y: 0.1, w: 0.4, h: 0.3, colour: 'yellow' },
  { type: 'text', id: 'text-7', x: 0.5, y: 0.9, text: 'Press' },
]

const withAll = () => ({ ...emptyDiagram(), elements: ALL })

describe('coordinates are fractions, never pixels', () => {
  it('stores every number between zero and one, for every element type', () => {
    // BEHAVIOURAL. A renderer that started storing screen pixels would put a
    // number in the hundreds here, whatever it called the field.
    const stored = serializeDrillDiagram(withAll()) as { elements: Record<string, unknown>[] }
    for (const el of stored.elements) {
      for (const [k, v] of Object.entries(el)) {
        if (typeof v !== 'number') continue
        expect(v, `${el.type}.${k}`).toBeGreaterThanOrEqual(0)
        expect(v, `${el.type}.${k}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is unchanged by the size of the surface it is drawn on', () => {
    // BEHAVIOURAL. A stored diagram must mean the same thing on a phone and on
    // a desktop, which is only true while nothing about the surface reaches the
    // stored numbers.
    const portrait = serializeDrillDiagram(withAll())
    const landscape = serializeDrillDiagram({
      ...withAll(),
      surface: { kind: 'full_pitch', orientation: 'landscape' },
    }) as { elements: unknown }
    expect(JSON.stringify((portrait as { elements: unknown }).elements)).toBe(JSON.stringify(landscape.elements))
  })
})

describe('element identity is stable and unique', () => {
  it('never mints an id that any element already carries', () => {
    // BEHAVIOURAL, and the exact failure an array index walks into: delete from
    // the middle, add, collide.
    let elements: DiagramElement[] = ALL.slice()
    for (let i = 0; i < 30; i++) {
      if (i % 3 === 0 && elements.length > 1) elements = elements.slice(1)
      const type = ELEMENT_TYPES[i % ELEMENT_TYPES.length]
      const id = nextElementId(type, elements)
      expect(elements.some((e) => e.id === id), `${id} was reissued`).toBe(false)
      elements = [...elements, { ...ALL[0], id } as DiagramElement]
    }
  })

  it('never returns two elements under one id from a read', () => {
    // BEHAVIOURAL. Two elements sharing an id would make select, move and
    // delete act on whichever the search reached first.
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [...ALL, ...ALL].map((e) => ({ ...e })),
    })
    const ids = parsed!.elements.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('no child, and no person, can reach a diagram', () => {
  const IDENTITY = [
    'playerId', 'player_id', 'spondMemberId', 'spond_member_id', 'memberId', 'member_id',
    'name', 'displayName', 'display_name', 'firstName', 'lastName', 'guardian', 'guardianName',
    'email', 'phone', 'address', 'shirtNumber', 'shirt_number', 'dob', 'teamId', 'team_id',
  ]

  it('strips every identity-shaped key on the way in and on the way out', () => {
    // BEHAVIOURAL, and the strongest form available: the parser and the
    // serialiser both REBUILD each element from an allow-list, so this holds for
    // any key ever invented, not only the ones listed above.
    const contaminated = ALL.map((e) => {
      const extra: Record<string, unknown> = {}
      for (const k of IDENTITY) extra[k] = 'Jamie Smith'
      return { ...e, ...extra }
    })
    const json = JSON.stringify(serializeDrillDiagram(parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: contaminated,
    })!))
    for (const k of IDENTITY) expect(json, `${k} survived`).not.toContain(k)
    expect(json).not.toContain('Jamie Smith')
  })

  it('declares no field on any element type that could hold a person', () => {
    // SOURCE TEXT. Catches a field being ADDED to the model, which the
    // behavioural check above cannot see because a new allowed field would pass
    // straight through it.
    const model = read('lib/drillDiagram.ts')
    const interfaces = model.slice(model.indexOf('export interface PlayerElement'), model.indexOf('export type DiagramElement ='))
    for (const k of IDENTITY) {
      expect(interfaces, `the model declares ${k}`).not.toMatch(new RegExp(`^\\s+${k}\\??:`, 'm'))
    }
  })
})

describe('the diagram save writes the diagram and nothing else', () => {
  it('sends exactly one column', () => {
    // BEHAVIOURAL.
    expect(Object.keys(drillDiagramWriteRow(withAll()))).toEqual(['diagram'])
  })

  it('reads back exactly the id and the diagram', () => {
    expect(DRILL_DIAGRAM_COLS).toBe('id, diagram')
  })

  it('keeps the diagram out of the whole drill write and out of every drill read', () => {
    // SOURCE TEXT. The point of the separation is that no OTHER drill path
    // learns about the column: not the library list, not the planner, not the
    // share snapshot builders. Adding it to either constant would undo that in
    // one line, and nothing behavioural would notice until something leaked.
    const q = read('lib/queries.ts')
    const drillCols = /const DRILL_COLS =\s*\n?\s*'([^']*)'/.exec(q)
    expect(drillCols, 'DRILL_COLS could not be read').toBeTruthy()
    expect(drillCols![1]).not.toContain('diagram')
    const writeRow = q.slice(q.indexOf('function toDrillWriteRow'), q.indexOf('export function useInsertDrill'))
    expect(writeRow).not.toContain('diagram')
  })
})

describe('nothing persists while a finger is moving', () => {
  const editor = read('routes/DrillDiagramEditor.tsx')

  it('keeps the reducer free of any data layer at all', () => {
    // BEHAVIOURAL in effect: a module that imports no client cannot make a
    // request, and every drag goes through this module.
    const reducer = read('lib/drillDiagramEditor.ts')
    expect(reducer).not.toContain('supabase')
    expect(reducer).not.toContain('./queries')
    expect(reducer).not.toContain('fetch(')
  })

  it('calls the save exactly once in the whole editor, and not from a pointer handler', () => {
    // SOURCE TEXT. A drag emits a move action per pointer event; a mutation on
    // that path would be a write per pixel. One call site is the check, and its
    // position relative to the pointer handlers is the second.
    const calls = editor.match(/save\.mutate\(/g) ?? []
    expect(calls).toHaveLength(1)
    const pointerSection = editor.slice(editor.indexOf('const move = (id: string)'), editor.indexOf('const up = (id: string)'))
    expect(pointerSection).not.toContain('mutate')
  })

  it('drags an element by its grab offset, never by the raw pointer position', () => {
    // SOURCE TEXT, and the weakest kind: this is the one rule in Drill Maker
    // that mutation testing could not kill behaviourally. The arithmetic lives
    // in a pointer handler, and this project has no DOM under test, so no test
    // can fire a pointer event to observe it. What CAN be proved behaviourally
    // is elementAnchor, the point the offset is measured from, and it is
    // (drillDiagramEditor.test.ts: move to an element's own anchor changes
    // nothing, for every type).
    //
    // Dropping the offset teleports the element under the thumb the instant a
    // drag starts, and it is invisible in every test. So the dispatch is
    // checked for the subtraction. This catches somebody deleting it; it does
    // not catch the offset being computed wrongly, or measured from the wrong
    // point, or a sign error.
    expect(editor).toContain('elementAnchor(el)')
    expect(editor).toMatch(/op: 'move', id, x: f\.x - g\.grabX, y: f\.y - g\.grabY/)
  })

  it('has no autosave: the save runs from the Save handler, never from an effect', () => {
    // SOURCE TEXT. A coach has to know whether their work is stored, which is
    // the whole reason the state is shown in words in the top bar.
    const effects = editor.match(/useEffect\([\s\S]*?\n {2}\}, \[/g) ?? []
    for (const e of effects) expect(e).not.toContain('mutate')
    expect(editor).toContain('function onSave()')
  })
})

describe('one renderer draws a diagram', () => {
  it('leaves the drill page with no SVG of its own', () => {
    // SOURCE TEXT. The realistic mistake is a second, simpler diagram drawn
    // inline on the drill page that then drifts from the editor's. The drill
    // page renders DrillDiagramView and draws nothing itself.
    const detail = read('routes/DrillDetail.tsx')
    expect(detail).not.toContain('<svg')
    expect(detail).not.toContain('viewBox')
    expect(detail).toContain('<DrillDiagramView')
  })

  it('leaves the editor with no element shapes of its own', () => {
    // SOURCE TEXT. The editor composes the renderer's shapes and adds chrome;
    // it never draws a player, a cone or a ball itself. Anything it does draw
    // (rings, handles, invisible hit areas) is editor chrome, and none of it
    // carries a data-el marker, which is how the read only view is identified.
    const editor = read('routes/DrillDiagramEditor.tsx')
    expect(editor).toContain('<DiagramElementShape')
    expect(editor).toContain('<DiagramSurfaceBackdrop')
    expect(editor).not.toContain('data-el=')
  })
})

describe('the diagram stays out of a public link', () => {
  it('is not projected into a public drill snapshot', () => {
    // BEHAVIOURAL, against the REAL Edge Function builder. A drill row carrying
    // a diagram builds a snapshot without one, and the builder's own
    // assertAllowlistedKeys would throw if it ever did carry one.
    const row = {
      id: 'd1',
      club_id: 'c1',
      title: 'Rondo 4v1',
      summary: 'Keep the ball.',
      corner: 'technical',
      skill: 'Passing',
      level: 'Foundation',
      ages: ['U9'],
      duration: 15,
      players: '5',
      area: '12x12',
      equipment: ['Cones'],
      points: [],
      tags: [],
      media_id: null,
      setup_notes: null,
      easier: [],
      harder: [],
      theme: null,
      format: null,
      source_url: null,
      source_label: null,
      source_key: null,
      rights: 'public_full',
      // The column this whole section exists for.
      diagram: serializeDrillDiagram(withAll()),
    }
    const snapshot = buildDrillSnapshot(row as never, null, '2026-08-11T00:00:00Z')
    const json = JSON.stringify(snapshot)
    expect(Object.keys(snapshot)).not.toContain('diagram')
    expect(json).not.toContain('diagram')
    expect(json).not.toContain('elements')
    // And the drill itself did project: this is not passing because the builder
    // returned nothing.
    expect(json).toContain('Rondo 4v1')
  })

  it('is named in both deny lists, so a future projection throws instead of shipping', () => {
    // SOURCE TEXT, and it is the cheap half of a real protection: the positive
    // allow list is what actually keeps the diagram out. This names it in the
    // belt and braces list on both sides, which matters more here than
    // elsewhere because a share is a FROZEN COPY: once a key reaches
    // content_shares.snapshot the read path serves it until the link is
    // revoked, and no later fix to the projection takes it back.
    expect(read('lib/publicShare.ts')).toContain("'diagram',")
    const server = readFileSync(join(SRC, '..', 'supabase/functions/_shared/share.ts'), 'utf8')
    const forbidden = server.slice(server.indexOf('const FORBIDDEN_ANYWHERE'), server.indexOf('function assertKeysWithin'))
    expect(forbidden).toContain("'diagram'")
  })
})

describe('the tactics board is not part of this', () => {
  it('does not know the diagram exists', () => {
    // SOURCE TEXT. The dependency runs one way on purpose: the diagram borrows
    // clampFraction and isDrag from the board, and the board borrows nothing.
    // A change here would mean the two features had started to merge, which is
    // exactly what the model header says they must not do.
    for (const f of ['lib/tacticsBoard.ts', 'components/TacticsPitch.tsx', 'components/TacticsBoardView.tsx']) {
      expect(read(f), `${f} reaches into the diagram`).not.toContain('drillDiagram')
    }
  })

  it('keeps its own pitch, drawn its own way', () => {
    // The board's 680 by 1050 JSX pitch is coupled to Board.css's aspect ratio
    // and nothing asserts that coupling, so it is left alone. The diagram has
    // its own data driven markings instead.
    expect(read('components/TacticsBoardView.tsx')).toContain('viewBox="0 0 680 1050"')
  })
})

describe('the editor layout defects that a static render cannot catch', () => {
  // SOURCE TEXT over CSS, and the weakest checks in this file. They exist
  // because there is no DOM under test, so nothing here can measure a box: both
  // of these were found by rendering the real components with the real
  // stylesheets in a real browser, and neither would have failed a single
  // existing test. What they pin is the exact numbers that were wrong, which is
  // all a text check can honestly do. They will not catch the same defect
  // arriving through a different property, a wider container or a longer tool
  // name.
  const css = read('routes/DrillDiagramEditor.css')

  it('keeps all seven tools inside the narrowest phone, with no sideways scroll', () => {
    // The row was 430 wide inside a 374 bar, so Label sat off the right edge
    // behind a scroll nobody would try, and the label tool was effectively
    // missing on a phone.
    const minWidth = Number(/\.dde-tool \{[\s\S]*?min-width: (\d+)px/.exec(css)?.[1])
    const gap = Number(/\.dde-tool-row \{[\s\S]*?gap: (\d+)px/.exec(css)?.[1])
    expect(Number.isFinite(minWidth) && Number.isFinite(gap)).toBe(true)
    // 360 is the narrowest phone the app supports, less the palette's padding.
    expect(ELEMENT_TYPES.length * minWidth + (ELEMENT_TYPES.length - 1) * gap).toBeLessThanOrEqual(344)
    // And no smaller than a touch target.
    expect(minWidth).toBeGreaterThanOrEqual(44)
  })

  it('never gives the editor canvas an aspect ratio, which is what collapsed the pitch', () => {
    // .dd-surface sets `width: 100%` and an aspect ratio; the editor added
    // `max-height: 100%` on top. All three cannot hold: with the width definite
    // the max-height clips the height and the ratio is lost. On a phone held
    // sideways the box came out 844 by 118 and the pitch drew 76 pixels wide.
    // The canvas fills its space instead and the SVG letterboxes the pitch
    // itself, which is why pointerFraction does the matching arithmetic.
    const block = /\.dde-canvas \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
    expect(block).not.toContain('aspect-ratio')
    expect(block).not.toContain('max-height')
    expect(block).toContain('height: 100%')
  })
})

describe('the vocabulary does not drift', () => {
  it('offers only colours the club already uses for bibs', () => {
    // BEHAVIOURAL. A coach setting up a drill thinks in bibs, so the diagram
    // uses the same words and the same swatches rather than a second colour
    // language.
    const bibs = new Set(BIB_COLOURS.map((b) => b.value))
    for (const c of DIAGRAM_COLOURS) expect(bibs.has(c), `${c} is not a bib colour`).toBe(true)
  })

  it('bounds a diagram, so one can never become a payload', () => {
    expect(MAX_DIAGRAM_ELEMENTS).toBeGreaterThan(20)
    expect(MAX_DIAGRAM_ELEMENTS).toBeLessThanOrEqual(120)
    const many = Array.from({ length: MAX_DIAGRAM_ELEMENTS * 3 }, (_, i) => ({ ...ALL[2], id: `ball-${i}` }))
    const parsed = parseDrillDiagram({ version: 1, surface: { kind: 'blank' }, elements: many })
    expect(parsed!.elements.length).toBe(MAX_DIAGRAM_ELEMENTS)
  })

  it('states the same shape in the migration that the client writes', () => {
    // SOURCE TEXT, over SQL. The check constraint is the identity boundary as
    // schema; a field added to the client model without a matching migration
    // would be refused by the database at save time, which is a bug a coach
    // finds rather than a test does.
    const sql = readFileSync(join(SRC, '..', 'supabase/migrations/0046_drill_diagram.sql'), 'utf8')
    const stored = serializeDrillDiagram(withAll()) as { elements: Record<string, unknown>[] }
    for (const el of stored.elements) {
      const line = new RegExp(`when '${el.type}'[\\s\\S]*?\\]\\)`).exec(sql)
      expect(line, `the migration has no shape for ${el.type}`).toBeTruthy()
      for (const key of Object.keys(el)) {
        expect(line![0], `the migration refuses ${el.type}.${key}`).toContain(`'${key}'`)
      }
    }
  })
})
