import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillDiagramSection } from './DrillDetail'
import { DiagramEditorView, type SaveState } from './DrillDiagramEditor'
import { emptyDiagram, type DiagramElement, type DrillDiagram } from '../lib/drillDiagram'
import { editorReducer, initEditor, type DiagramAction, type DiagramEditorState } from '../lib/drillDiagramEditor'
import { diagramEditDecision } from '../lib/drillDiagramRights'

// The two screens Drill Maker adds, rendered for real. This project has no DOM
// under test, so these are static renders: they prove what a coach is OFFERED
// and what they are TOLD, which is where the product rules show. The behaviour
// behind each control is proved in the pure reducer's own suite.

const noop = () => {}

function drillPage(diagram: DrillDiagram | null, canEdit: boolean): string {
  return renderToStaticMarkup(<DrillDiagramSection diagram={diagram} canEdit={canEdit} onOpen={noop} />)
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
    expect(html).toContain('Play runs')
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
  it('draws the pitch and everything on it', () => {
    let s = initEditor(null)
    const types: DiagramElement['type'][] = ['player', 'cone', 'ball', 'goal', 'arrow', 'zone', 'text']
    for (const t of types) s = editorReducer(s, { op: 'add', element: t, at: { x: 0.4, y: 0.5 } })
    const html = editor({ state: s })
    for (const t of types) expect(html, `${t} is missing from the canvas`).toContain(`data-el="${t}"`)
    expect(html).toContain('dd-lines')
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
    expect(html).toContain('selected. Drag to move.')
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

  it('offers no selection controls when nothing is selected', () => {
    expect(editor()).not.toContain('dde-selbar')
  })
})
