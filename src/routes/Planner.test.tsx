import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ActivityCardView } from './Planner'
import type { Activity, Drill } from '../lib/data'

// ActivityCardView is the planner's drill row pulled out as a presentational
// component, so the static renderer covers expand and collapse and the row
// controls without a DOM or a query client, the same style as the rest of the
// suite. ActivityRow in the screen resolves the drill and the media nodes and
// passes them in; here they are plain fixtures, and the media preview is a
// stand-in so no signed-URL hook runs.

const drill: Drill = {
  id: 'd1',
  title: 'Rondo 4v1',
  corner: 'technical',
  skill: 'Passing',
  ages: ['U9', 'U10'],
  level: 'Foundation',
  duration: 15,
  players: '5',
  area: '12x12',
  equipment: ['Cones', 'Bibs'],
  mediaId: null,
  summary: 'Keep the ball away from the defender.',
  points: ['Open your body', 'Pass and move'],
  tags: ['rondo'],
  setupNotes: '',
  easier: ['Make the area bigger'],
  harder: ['Add a second defender'],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  createdAt: '2026-01-01',
}

const act: Activity = { phase: 'Skill', drillId: 'd1', duration: 15 }

const noop = () => {}

function render(expanded: boolean, opts: { readOnly?: boolean; drill?: Drill | null } = {}): string {
  const rowDrill = 'drill' in opts ? opts.drill! : drill
  return renderToStaticMarkup(
    <MemoryRouter>
      <ActivityCardView
        act={act}
        idx={0}
        title={rowDrill ? rowDrill.title : 'Custom activity'}
        drill={rowDrill}
        thumb={<span>thumb</span>}
        expandedMedia={<span>media-preview</span>}
        drillHref="/drill/d1"
        expanded={expanded}
        onToggle={noop}
        onRemove={noop}
        onDur={noop}
        onPhase={noop}
        dragHandlers={{ onDragStart: noop, onDragEnter: noop, onDragEnd: noop, onDragOver: noop }}
        dragging={false}
        readOnly={opts.readOnly ?? false}
      />
    </MemoryRouter>,
  )
}

describe('ActivityCardView', () => {
  it('keeps the drill detail out of the markup until the card is expanded', () => {
    const html = render(false)
    expect(html).toContain('Rondo 4v1')
    expect(html).toContain('aria-expanded="false"')
    // No summary, coaching points, adaptations or detail link while collapsed.
    expect(html).not.toContain('Keep the ball away from the defender.')
    expect(html).not.toContain('Open your body')
    expect(html).not.toContain('Make it harder')
    expect(html).not.toContain('Open full drill')
    expect(html).not.toContain('media-preview')
  })

  it('shows the summary, coaching points and adaptations when expanded', () => {
    const html = render(true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Keep the ball away from the defender.')
    expect(html).toContain('Coaching points')
    expect(html).toContain('Open your body')
    expect(html).toContain('Pass and move')
    expect(html).toContain('Make it easier')
    expect(html).toContain('Make the area bigger')
    expect(html).toContain('Make it harder')
    expect(html).toContain('Add a second defender')
    expect(html).toContain('Cones')
    // The injected media preview and the link out to the full drill route.
    expect(html).toContain('media-preview')
    expect(html).toContain('Open full drill')
    expect(html).toContain('href="/drill/d1"')
  })

  it('keeps the remove and phase controls present and wired in both states', () => {
    for (const html of [render(false), render(true)]) {
      // The phase select offers every phase, so changing it still drives onPhase.
      expect(html).toContain('<select')
      for (const phase of ['Warm-Up', 'Skill', 'Game', 'Cool-Down']) {
        expect(html).toContain(`>${phase}</option>`)
      }
      // The remove control survives expansion rather than being swallowed.
      expect(html).toContain('aria-label="Remove activity"')
    }
  })

  it('offers no expansion for a custom activity that has no drill', () => {
    const html = render(false, { drill: null })
    expect(html).toContain('Custom activity')
    expect(html).not.toContain('aria-expanded')
  })

  it('drops the grip and remove control in a read-only session but still expands', () => {
    const html = render(true, { readOnly: true })
    expect(html).not.toContain('aria-label="Remove activity"')
    expect(html).not.toContain('act-grip')
    // Expansion is independent of edit rights: the detail still renders, and
    // the phase select is disabled rather than removed.
    expect(html).toContain('Open your body')
    expect(html).toContain('disabled')
  })
})
