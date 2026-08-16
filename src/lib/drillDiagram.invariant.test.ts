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

  // ---- The session surfaces (DRILL-02) ----------------------------------

  it('leaves every session surface with no SVG of its own', () => {
    // SOURCE TEXT. The one renderer rule got four new call sites when the
    // diagram reached the planner, session day and both live stages, and the
    // realistic mistake is the same one the drill page could have made:
    // somebody drawing a quick simplified pitch inline rather than mounting
    // the component, which then drifts from what the coach actually drew.
    for (const file of ['routes/Planner.tsx', 'routes/SessionDay.tsx', 'routes/LiveSession.tsx']) {
      const src = read(file)
      expect(src, `${file} draws its own SVG`).not.toContain('<svg')
      expect(src, `${file} declares its own viewBox`).not.toContain('viewBox')
      expect(src, `${file} draws its own element shapes`).not.toContain('data-el=')
      // Each reaches the diagram through the one seam and nothing else.
      expect(src, `${file} should mount ActivityDiagram`).toContain('<ActivityDiagram')
    }
  })

  it('keeps the session seam a mount rather than a second renderer', () => {
    // SOURCE TEXT. ActivityDiagram exists to own the read and the rule; the
    // moment it draws anything itself there are two renderers again.
    const seam = read('components/ActivityDiagram.tsx')
    expect(seam).toContain('<DrillDiagramView')
    expect(seam).not.toContain('<svg')
    expect(seam).not.toContain('viewBox')
    expect(seam).not.toContain('data-el=')
  })

  it('decides whether to show a diagram in exactly one place', () => {
    // SOURCE TEXT, and the one that matters most for England Football. Four
    // surfaces answering "may this be shown" for themselves is four chances to
    // disagree about a restricted drill, so the rule lives in
    // drillDiagramRights and no screen derives provenance for a diagram.
    for (const file of [
      'routes/Planner.tsx',
      'routes/SessionDay.tsx',
      'routes/LiveSession.tsx',
      'components/ActivityDiagram.tsx',
    ]) {
      const src = read(file)
      if (file === 'components/ActivityDiagram.tsx') {
        expect(src).toContain('diagramForDisplay')
        continue
      }
      expect(src, `${file} decides diagram display for itself`).not.toContain('diagramForDisplay')
      expect(src, `${file} derives provenance for a diagram`).not.toContain('deriveProvenance')
    }
  })

  it('reads a diagram through the one hook, per drill, with no second read shape', () => {
    // SOURCE TEXT. The tempting shortcut for a session showing N activities is
    // a batched `.in('id', ids)` diagram read. It would mint a SECOND cache
    // shape over rows already cached under ['drill_diagram', id], which is the
    // duplicated diagram state this work exists to avoid, and it would need a
    // second column constant beside the one pinned above.
    const q = read('lib/queries.ts')
    // One column constant, declared once.
    expect(q.match(/DRILL_DIAGRAM_COLS\s*=\s*'/g) ?? []).toHaveLength(1)
    // Every diagram select goes through it, and none of them is a batch: an
    // `.in(` beside a diagram select is the second read shape this forbids.
    for (const sel of q.match(/\.select\(DRILL_DIAGRAM_COLS\)[^\n]*/g) ?? []) {
      expect(sel, 'a batched diagram read').not.toContain('.in(')
    }
    expect(q).not.toContain("select('id, diagram")
    // Only the seam mounts the hook; the screens go through the seam.
    expect(read('components/ActivityDiagram.tsx')).toContain('useDrillDiagram')
    for (const file of ['routes/Planner.tsx', 'routes/SessionDay.tsx', 'routes/LiveSession.tsx']) {
      expect(read(file), `${file} reads a diagram itself`).not.toContain('useDrillDiagram')
    }
  })

  it('parses a diagram nowhere but the model and the query layer', () => {
    // SOURCE TEXT. One parser. A screen calling parseDrillDiagram on something
    // it fetched its own way is the second reading this rule forbids.
    for (const file of [
      'routes/Planner.tsx',
      'routes/SessionDay.tsx',
      'routes/LiveSession.tsx',
      'components/ActivityDiagram.tsx',
      'components/DrillDiagramView.tsx',
    ]) {
      // A CALL, not a mention: the seam's comments explain why a corrupt row
      // reads as no diagram, and naming the parser there is the explanation,
      // not a second parse.
      expect(read(file), `${file} parses a diagram`).not.toContain('parseDrillDiagram(')
    }
  })

  it('never turns a structured diagram into stored or uploaded media', () => {
    // SOURCE TEXT. The two diagram systems stay apart: a DrillDiagram is never
    // rasterised, wrapped as a MediaItem or pushed through the uploaded image
    // viewer to borrow its modal. Session day renders both, side by side,
    // through their own paths.
    const seam = read('components/ActivityDiagram.tsx')
    for (const forbidden of ['MediaItem', 'DiagramViewer', 'DiagramSlide', 'storagePath', 'toDataURL', 'canvas']) {
      expect(seam, `the seam reaches for ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('writes nothing from any of the session surfaces to show a diagram', () => {
    // SOURCE TEXT. Rendering a picture is a read. The seam holds no mutation
    // and imports no write hook.
    const seam = read('components/ActivityDiagram.tsx')
    expect(seam).not.toContain('mutate')
    expect(seam).not.toContain('useUpdateDrillDiagram')
    expect(seam).not.toContain('saveDrillDiagram')
  })

  it('bounds the size of a diagram on every surface that is not the drill page', () => {
    // SOURCE TEXT, and the weakest check in this file, for the reason the
    // editor canvas check already gives: there is no DOM here to measure a box
    // in, so this reads the declared CSS rather than a rendered one. It exists
    // because the tall case is genuinely tall (a portrait full pitch is one and
    // a half times as high as it is wide, so roughly 840px on a 560px live
    // stage), and an unbounded diagram on a phone pushes the coaching points
    // and the rest of the session off the screen.
    const css = readFileSync(join(SRC, 'components/DrillDiagram.css'), 'utf8')
    const block = (name: string) => {
      const at = css.indexOf(`.${name} {`)
      expect(at, `.${name} is not declared`).toBeGreaterThan(-1)
      return css.slice(at, css.indexOf('}', at))
    }
    // The planner panel matches the media cap above it in the same column. A
    // width cap IS a height bound while the ratio holds, so it needs no second.
    expect(block('dd-in-panel')).toContain('max-width: 420px')
    // The two surfaces whose hazard is height rather than width. EACH MUST CAP
    // BOTH: width:100% plus an aspect ratio plus a max-height cannot all hold,
    // and a height cap on its own leaves the box the whole column with the
    // pitch drawn small in the middle of it. That is the defect the editor
    // canvas fixed once already, so it is pinned rather than rediscovered.
    for (const name of ['dd-in-sd', 'dd-in-live']) {
      const b = block(name)
      expect(b, `.${name} has no height cap`).toContain('max-height')
      expect(b, `.${name} caps height without bounding width`).toContain('max-width')
      expect(b, `.${name} should bound width from the surface ratio`).toContain('--dd-ratio')
    }
    // And the ratio has ONE source: the renderer emits it from the same
    // geometry the aspect ratio comes from, so the stylesheet never hard codes
    // a per surface number.
    expect(read('components/DrillDiagramView.tsx')).toContain("'--dd-ratio'")
    expect(css, 'a hard coded ratio in the stylesheet').not.toMatch(/--dd-ratio:\s*[\d.]/)
    // And the shared surface itself is unchanged: still full width, still
    // taking its ratio from the diagram rather than from a stylesheet.
    const surface = block('dd-surface')
    expect(surface).toContain('width: 100%')
    expect(surface).not.toContain('aspect-ratio')
  })

  it('paints nothing over the pitch from a theme token', () => {
    // SOURCE TEXT. The pitch stays green in dark mode by decision, so every
    // mark drawn ON it has to be theme independent too. .dd-chip-text read
    // var(--ink), which the live view's forced .theme-dark flips to near white
    // on a fixed near white chip: the pill stayed and the word disappeared.
    // Latent on the drill page for a dark mode coach, certain on the touchline.
    const css = readFileSync(join(SRC, 'components/DrillDiagram.css'), 'utf8')
    for (const m of css.match(/(fill|stroke|color):\s*var\(--[a-z-]+/g) ?? []) {
      expect(m, `${m} takes a theme token over the pitch`).toContain('--pitch')
    }
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
