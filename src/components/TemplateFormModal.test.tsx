import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TemplateActivityRow } from './TemplateFormModal'
import type { Activity } from '../lib/data'

// TemplateActivityRow is the template editor's activity row pulled out so the
// static suite can pin its layout. The pin that matters: a long FA drill title
// sits in the flexible ac-body column on an act-edit row, the layout that stops
// it collapsing to a sliver, while the phase, duration and move controls keep
// their place in the row.

const longTitle = 'Goalkeeping session: out of possession actions, Activity 1'
const activity: Activity = { phase: 'Skill', drillId: 'd1', duration: 15 }
const noop = () => {}

function render(): string {
  return renderToStaticMarkup(
    <TemplateActivityRow
      activity={activity}
      title={longTitle}
      skill="Goalkeeping"
      index={0}
      count={3}
      onPhase={noop}
      onDuration={noop}
      onMove={noop}
      onRemove={noop}
    />,
  )
}

describe('TemplateActivityRow', () => {
  it('puts the full drill title in the flexible ac-body column on an act-edit row', () => {
    const html = render()
    // The row carries the act-edit layout that gives the title room.
    expect(html).toContain('class="act-card act-edit"')
    // The whole title renders inside ac-body, not a narrow sliver column.
    expect(html).toMatch(
      /<div class="ac-body"><h4>Goalkeeping session: out of possession actions, Activity 1<\/h4>/,
    )
  })

  it('keeps the phase, duration and move controls in the row', () => {
    const html = render()
    expect(html).toContain('<select')
    for (const phase of ['Warm-Up', 'Skill', 'Game', 'Cool-Down']) {
      expect(html).toContain(`>${phase}</option>`)
    }
    expect(html).toContain('aria-label="Move up"')
    expect(html).toContain('aria-label="Move down"')
    expect(html).toContain('aria-label="Remove activity"')
  })
})
