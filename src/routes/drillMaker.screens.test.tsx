import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillDiagramSection } from './DrillDetail'
import { DiagramEditorView, type SaveState } from './DrillDiagramEditor'
import { emptyDiagram, type DiagramElement, type DrillDiagram } from '../lib/drillDiagram'
import { editorReducer, initEditor, type DiagramAction, type DiagramEditorState } from '../lib/drillDiagramEditor'
import { diagramEditDecision, FA_DIAGRAM_NOTE } from '../lib/drillDiagramRights'

// The two screens Drill Maker adds, rendered for real. This project has no DOM
// under test, so these are static renders: they prove what a coach is OFFERED
// and what they are TOLD, which is where the product rules show. The behaviour
// behind each control is proved in the pure reducer's own suite.

const noop = () => {}

function drillPage(
  diagram: DrillDiagram | null,
  canEdit: boolean,
  over: Partial<Parameters<typeof DrillDiagramSection>[0]> = {},
): string {
  return renderToStaticMarkup(
    <DrillDiagramSection diagram={diagram} canEdit={canEdit} onOpen={noop} {...over} />,
  )
}

const withCone: DrillDiagram = {
  ...emptyDiagram(),
  elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.3, colour: 'orange' }],
}

describe('the drill page', () => {
  it('offers Build diagram when the drill has none and the coach may draw', () => {
    const html = drillPage(null, true)
    expect(html).toContain('Build diagram')
    expect(html).not.toContain('Edit diagram')
  })

  it('shows the diagram and offers Edit diagram when there is one', () => {
    const html = drillPage(withCone, true)
    expect(html).toContain('Edit diagram')
    expect(html).not.toContain('Build diagram')
    expect(html).toContain('data-el="cone"')
  })

  it('renders the diagram rather than dumping its data', () => {
    const html = drillPage(withCone, true)
    expect(html).toContain('<svg')
    expect(html).not.toContain('"version":1')
    expect(html).not.toContain('cone-1')
  })

  it('shows the diagram to somebody who may not edit it, with no way in', () => {
    // Club wide read, personal write: the same rule as every other piece of
    // coaching content.
    const html = drillPage(withCone, false)
    expect(html).toContain('data-el="cone"')
    expect(html).not.toContain('Edit diagram')
    expect(html).not.toContain('Build diagram')
  })

  it('shows nothing at all when there is no diagram and no way to make one', () => {
    // Not a disabled button and not an explanation nobody asked for: an England
    // Football derived drill already carries the FA's own diagram as media.
    expect(drillPage(null, false)).toBe('')
  })

  it('treats a diagram whose elements were all deleted as no diagram', () => {
    const html = drillPage(emptyDiagram(), true)
    expect(html).toContain('Build diagram')
    expect(html).not.toContain('data-el=')
  })

  it('offers no way in for an England Football derived drill, through the real rule', () => {
    // The decision the drill page actually uses, not a restatement of it.
    const decision = diagramEditDecision({
      canManage: true,
      source: { sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc' },
    })
    expect(drillPage(null, decision.canEdit)).toBe('')
  })

  it('does not show a diagram stranded on an England Football derived drill', () => {
    // REACHABLE, and the reason this branch exists: a coach draws a diagram on
    // their own drill, then later records an England Football source on it.
    // Showing the drawing is exactly what the licence excludes, and with the
    // editor refusing every writer it could never be corrected or removed.
    const html = drillPage(withCone, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: true })
    expect(html).not.toContain('data-el="cone"')
    expect(html).toContain('England Football Learning')
  })

  it('offers to remove a stranded diagram, so it is not trapped for ever', () => {
    const html = drillPage(withCone, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: true })
    expect(html).toContain('Remove diagram')
    expect(html).not.toContain('Edit diagram')
    expect(html).not.toContain('Build diagram')
  })

  it('offers no removal to somebody who could not edit the drill anyway', () => {
    const html = drillPage(withCone, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: false })
    expect(html).toContain('England Football Learning')
    expect(html).not.toContain('Remove diagram')
  })

  it('shows nothing on a restricted drill that has no diagram, rather than a rule nobody asked about', () => {
    expect(drillPage(null, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: true })).toBe('')
  })

  it('says a removal is in flight, and reports one that failed', () => {
    const busy = drillPage(withCone, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: true, removing: true })
    expect(busy).toContain('Removing…')
    expect(busy).toContain('disabled')
    const failed = drillPage(withCone, false, { restrictedReason: FA_DIAGRAM_NOTE, canRemove: true, removeFailed: true })
    expect(failed).toContain('Could not remove the diagram')
  })

  it('carries no editor chrome onto the drill page', () => {
    const html = drillPage(withCone, true)
    expect(html).not.toContain('dde-')
    expect(html).not.toContain('dd-selected')
    expect(html).not.toContain('aria-pressed')
  })
})

// ---- The editor ---------------------------------------------------------

function state(...actions: DiagramAction[]): DiagramEditorState {
  return actions.reduce(editorReducer, initEditor(null))
}

function editor(over: Partial<Parameters<typeof DiagramEditorView>[0]> = {}): string {
  return renderToStaticMarkup(
    <DiagramEditorView
      title="Rondo 4v1"
      state={over.state ?? state()}
      dispatch={noop}
      saveState={over.saveState ?? 'clean'}
      errorMessage={over.errorMessage ?? null}
      armed={over.armed ?? null}
      onArm={noop}
      onSave={noop}
      onBack={noop}
      {...over}
    />,
  )
}

describe('the editor top bar', () => {
  it('names the drill being drawn', () => {
    expect(editor()).toContain('Rondo 4v1')
  })

  it('always offers Back and Save', () => {
    const html = editor()
    expect(html).toContain('Back')
    expect(html).toContain('Save')
  })

  it('says the saved state in words, for each of the four states', () => {
    // Never a colour on its own: a coach standing on a touchline has to know
    // whether their work is stored.
    const words: Record<SaveState, string> = {
      clean: 'Saved',
      dirty: 'Unsaved',
      saving: 'Saving',
      error: 'Not saved',
    }
    for (const [s, word] of Object.entries(words)) {
      expect(editor({ saveState: s as SaveState }), s).toContain(word)
    }
  })

  it('announces a change of state rather than only showing it', () => {
    expect(editor({ saveState: 'dirty' })).toContain('role="status"')
  })

  it('disables Save when there is nothing to save', () => {
    expect(editor({ saveState: 'clean' })).toMatch(/Save[\s\S]{0,40}/)
    expect(editor({ saveState: 'clean' })).toContain('disabled')
  })

  it('offers Save while there are unsaved changes', () => {
    const html = editor({ saveState: 'dirty', state: state({ op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } }) })
    expect(html).toContain('Unsaved')
    // The Save button itself is not disabled: the only disabled control in a
    // dirty editor with a selection would be a full palette, which this is not.
    expect(html).not.toContain('Saving…')
  })

  it('shows a save failure as text a coach can act on, and keeps the drawing', () => {
    const s = state({ op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    const html = editor({ saveState: 'error', errorMessage: 'Could not save the diagram.', state: s })
    expect(html).toContain('Could not save the diagram.')
    expect(html).toContain('role="alert"')
    // The work is still on the canvas.
    expect(html).toContain('data-el="cone"')
  })
})

describe('the editor tool palette', () => {
  it('offers all seven element types, each named', () => {
    const html = editor()
    for (const name of ['Player', 'Cone', 'Ball', 'Goal', 'Arrow', 'Zone', 'Label']) {
      expect(html, `${name} tool is missing`).toContain(name)
    }
  })

  it('names every tool in text, not by icon alone', () => {
    // Seven small icons on a phone is seven guesses.
    expect((editor().match(/class="dde-tool"/g) ?? []).length).toBe(7)
  })

  it('shows an armed tool as pressed, and says what to do next', () => {
    const html = editor({ armed: 'cone' })
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Tap the pitch to place a cone.')
  })

  it('offers the three surfaces and a way to turn the pitch', () => {
    const html = editor()
    expect(html).toContain('Full pitch')
    expect(html).toContain('Half pitch')
    expect(html).toContain('Blank area')
    // The control is labelled with what it DOES, not with the state it is
    // leaving. It read "Play runs up" while the pitch was portrait and then
    // "Play runs across" after it had been pressed, so the text named the
    // opposite of the button's effect.
    expect(html).toContain('Turn the pitch')
    expect(html).not.toContain('Play runs up')
  })

  it('opens a drill with no diagram on a blank area, with the pitches still offered', () => {
    // Build diagram on a drill that has none is initEditor(null), which is what
    // `state()` is here. Most drills are a grid, a channel or a box, so a blank
    // area is what a coach starts on and a pitch is one tap from the same
    // selector. Rendered, not read off the model, because the selector is what
    // a coach actually sees.
    const html = editor({ state: initEditor(null) })
    expect(html).toMatch(/<option[^>]*value="blank"[^>]*selected/)
    expect(html).not.toMatch(/<option[^>]*value="full_pitch"[^>]*selected/)
    expect(html).not.toContain('dd-lines')
    expect(html).toContain('Full pitch')
    expect(html).toContain('Half pitch')
  })

  it('opens a saved diagram on the surface it was saved on, not on the new diagram default', () => {
    // The other half of the same rule: changing what a NEW diagram starts as
    // must not redraw work already in the column.
    const stored: DrillDiagram = {
      ...emptyDiagram(),
      surface: { kind: 'full_pitch', orientation: 'landscape' },
      elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.3, colour: 'orange' }],
    }
    const html = editor({ state: initEditor(stored) })
    expect(html).toMatch(/<option[^>]*value="full_pitch"[^>]*selected/)
    expect(html).toContain('dd-lines')
  })

  it('shows how full the diagram is', () => {
    expect(editor()).toContain('0 of 60')
  })

  it('stops adding, and says why, once the diagram is full', () => {
    let s = initEditor(null)
    for (let i = 0; i < 60; i++) s = editorReducer(s, { op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    const html = editor({ state: s })
    expect(html).toContain('This diagram is full')
    expect(html).toContain('60 of 60')
  })
})

describe('the editor canvas', () => {
  it('draws the surface and everything on it', () => {
    let s = initEditor(null)
    const types: DiagramElement['type'][] = ['player', 'cone', 'ball', 'goal', 'arrow', 'zone', 'text']
    for (const t of types) s = editorReducer(s, { op: 'add', element: t, at: { x: 0.4, y: 0.5 } })
    const html = editor({ state: s })
    for (const t of types) expect(html, `${t} is missing from the canvas`).toContain(`data-el="${t}"`)
    expect(html).toContain('dd-svg')
    // A new diagram opens blank, so there are no markings to draw yet.
    expect(html).not.toContain('dd-lines')
    // Choosing a pitch draws them, through the real action the selector fires.
    const onPitch = editor({ state: editorReducer(s, { op: 'setSurface', surface: 'full_pitch' }) })
    expect(onPitch).toContain('dd-lines')
    for (const t of types) expect(onPitch, `${t} was lost with the surface`).toContain(`data-el="${t}"`)
  })

  it('gives every element a generous invisible target and a name', () => {
    const s = state({ op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    const html = editor({ state: s })
    expect(html).toContain('data-hit')
    expect(html).toContain('aria-label="Cone, Orange"')
  })

  it('makes every element reachable from a keyboard', () => {
    const s = state({ op: 'add', element: 'ball', at: { x: 0.5, y: 0.5 } })
    expect(editor({ state: s })).toContain('tabindex="0"')
  })

  it('marks the selection by shape and by name, never by colour alone', () => {
    const s = state({ op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    const html = editor({ state: s })
    expect(html).toContain('dde-ring')
    expect(html).toContain('aria-pressed="true"')
    // Named in words as well as ringed, and announced.
    expect(html).toContain('Cone, Orange selected')
    expect(html).toContain('role="status"')
  })

  it('gives a selected zone two large handles, not eight small ones', () => {
    const s = state({ op: 'add', element: 'zone', at: { x: 0.5, y: 0.5 } })
    const html = editor({ state: s })
    expect((html.match(/dde-handle-dot/g) ?? []).length).toBe(2)
    expect(html).toContain('Resize the zone from the top left')
    expect(html).toContain('Resize the zone from the bottom right')
  })

  it('gives a selected arrow a handle at each end', () => {
    const s = state({ op: 'add', element: 'arrow', at: { x: 0.5, y: 0.5 } })
    const html = editor({ state: s })
    expect((html.match(/dde-handle-dot/g) ?? []).length).toBe(2)
    expect(html).toContain('Move the arrow start')
    expect(html).toContain('Move the arrow end')
  })

  it('gives nothing else handles, so a cone has one thing to grab', () => {
    const s = state({ op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    expect(editor({ state: s })).not.toContain('dde-handle-dot')
  })

  it('takes the touch on the canvas, so a drag draws instead of scrolling', () => {
    expect(editor()).toContain('dde-canvas')
  })
})

describe('the editor selection controls', () => {
  it('offers colours for a player, a cone and a zone', () => {
    for (const t of ['player', 'cone', 'zone'] as const) {
      const html = editor({ state: state({ op: 'add', element: t, at: { x: 0.5, y: 0.5 } }) })
      expect(html, t).toContain('dde-swatch')
      expect(html, t).toContain('aria-label="Red"')
    }
  })

  it('offers no colour for a ball or a goal, which are the objects they are', () => {
    for (const t of ['ball', 'goal'] as const) {
      expect(editor({ state: state({ op: 'add', element: t, at: { x: 0.5, y: 0.5 } }) }), t).not.toContain('dde-swatch')
    }
  })

  it('offers the three arrow meanings in words', () => {
    const html = editor({ state: state({ op: 'add', element: 'arrow', at: { x: 0.5, y: 0.5 } }) })
    expect(html).toContain('Run')
    expect(html).toContain('Pass')
    expect(html).toContain('Dribble')
  })

  it('offers the four ways a goal can face', () => {
    const html = editor({ state: state({ op: 'add', element: 'goal', at: { x: 0.5, y: 0.5 } }) })
    for (const f of ['Up', 'Down', 'Left', 'Right']) expect(html, f).toContain(f)
  })

  it('offers a bounded label field for a coaching label', () => {
    const html = editor({ state: state({ op: 'add', element: 'text', at: { x: 0.5, y: 0.5 } }) })
    expect(html).toContain('maxLength="24"')
  })

  it('offers a much shorter field for a player badge', () => {
    const html = editor({ state: state({ op: 'add', element: 'player', at: { x: 0.5, y: 0.5 } }) })
    expect(html).toContain('maxLength="3"')
  })

  it('offers Delete for whatever is selected', () => {
    expect(editor({ state: state({ op: 'add', element: 'ball', at: { x: 0.5, y: 0.5 } }) })).toContain('Delete')
  })

  it('offers no selection controls when nothing is selected, but keeps the bar', () => {
    // The BAR stays and holds the instruction instead. It used to appear only
    // on selection, and being a fixed-height band it took its height straight
    // out of the canvas: every tap resized and re-centred the pitch under the
    // coach's finger, moving the very element they had just touched.
    const html = editor()
    expect(html).toContain('dde-selbar')
    expect(html).toContain('Pick a tool, then tap the pitch.')
    expect(html).not.toContain('dde-swatch')
    expect(html).not.toContain('Delete')
  })

  it('keeps the bar at one height whether or not something is selected', () => {
    // Pinned in the stylesheet, since there is no DOM here to measure it.
    const css = readFileSync(join(import.meta.dirname, 'DrillDiagramEditor.css'), 'utf8')
    expect(/\.dde-selbar \{[\s\S]*?min-height: \d+px/.test(css)).toBe(true)
  })
})
