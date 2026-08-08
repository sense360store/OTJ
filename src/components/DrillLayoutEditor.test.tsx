import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillLayoutEditor, EditorCanvas } from './DrillLayoutEditor'
import { FIXTURE_ONE_V_ONE } from '../lib/drillLayoutFixtures'

// The editor's static face: the palette, the phase controls, undo and
// redo at their disabled edges, and the canvas drawing the same glyphs
// as the read only renderer with an interactive group around each piece.
// Pointer behaviour itself lives behind the pure model in layoutEditor.ts.

const noop = () => () => {}

describe('DrillLayoutEditor', () => {
  const html = renderToStaticMarkup(<DrillLayoutEditor initial={FIXTURE_ONE_V_ONE} onSave={() => {}} onCancel={() => {}} />)

  it('offers every tool in the palette', () => {
    for (const label of [
      '>Select<',
      '>Cone<',
      '>Flat marker<',
      '>Goal<',
      '>Mini goal<',
      '>Mannequin<',
      '>Player<',
      '>Ball<',
      '>Pass<',
      '>Run<',
      '>Dribble<',
      '>Shot<',
      '>Zone<',
    ]) {
      expect(html).toContain(label)
    }
  })

  it('shows the phase controls and the area inputs', () => {
    expect(html).toContain('>Phase 1<')
    expect(html).toContain('>Phase 2<')
    expect(html).toContain('Duplicate phase')
    expect(html).toContain('Remove phase')
    expect(html).toContain('Area width, m')
    expect(html).toContain('Area length, m')
    expect(html).toContain('Phase note')
  })

  it('starts with undo and redo disabled: nothing to walk yet', () => {
    expect(html).toContain('disabled="">Undo</button>')
    expect(html).toContain('disabled="">Redo</button>')
  })

  it('draws the layout on the canvas with an interactive group per piece', () => {
    expect(html).toContain('drill-editor-canvas')
    // Phase 1 of the fixture: 5 pieces, 1 zone, 1 arrow.
    expect(html.match(/drill-editor-piece/g)).toHaveLength(7)
    expect(html).toContain('dg-mini-goal')
    expect(html).toContain('Duel zone')
  })

  it('offers save and cancel', () => {
    expect(html).toContain('Save diagram')
    expect(html).toContain('>Cancel<')
  })

  it('starts a brand new diagram from the empty layout', () => {
    const fresh = renderToStaticMarkup(<DrillLayoutEditor initial={null} onSave={() => {}} onCancel={() => {}} />)
    expect(fresh).not.toContain('drill-editor-piece')
    expect(fresh).toContain('value="20"')
    expect(fresh).toContain('value="15"')
  })
})

describe('EditorCanvas', () => {
  it('marks the pending arrow start so the second tap has a visible anchor', () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        layout={FIXTURE_ONE_V_ONE}
        frame={0}
        selection={null}
        pendingFrom={{ x: 2, y: 2 }}
        onTapCanvas={() => {}}
        onPiecePointerDown={noop}
        onPiecePointerMove={noop}
        onPiecePointerUp={noop}
      />,
    )
    expect(html).toContain('drill-editor-pending')
  })

  it('marks the selected piece', () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        layout={FIXTURE_ONE_V_ONE}
        frame={0}
        selection={{ type: 'zone', id: 'z1' }}
        pendingFrom={null}
        onTapCanvas={() => {}}
        onPiecePointerDown={noop}
        onPiecePointerMove={noop}
        onPiecePointerUp={noop}
      />,
    )
    expect(html).toContain('drill-editor-piece selected')
  })
})
