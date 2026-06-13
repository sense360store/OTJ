import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanFromSpondView } from './PlanFromSpond'
import type { SpondEvent } from '../lib/data'

// PlanFromSpondView is the suggestions surface pulled out as a presentational
// component, so the static renderer covers the rows, counts and toggles
// without a query client, the same style as the rest of the suite. The
// container resolves scope, filtering and the create handler and feeds plain
// props in.

function ev(over: Partial<SpondEvent> & Pick<SpondEvent, 'id'>): SpondEvent {
  return {
    title: 'U8 Training',
    startsAt: '2026-06-16T17:30:00Z',
    teamId: 'team-1',
    teamName: 'Titans',
    spondType: null,
    accepted: 9,
    declined: 2,
    unanswered: 1,
    waiting: 0,
    cancelled: false,
    syncedAt: '2026-06-13T12:00:00Z',
    ...over,
  }
}

const noop = () => {}

function render(props: Partial<Parameters<typeof PlanFromSpondView>[0]> = {}): string {
  return renderToStaticMarkup(
    <PlanFromSpondView
      rows={[ev({ id: 'e1' })]}
      eventsExist
      trainingOnly
      onTrainingOnly={noop}
      showAll={false}
      onShowAll={noop}
      showAllToggle
      onPlan={noop}
      loading={false}
      error={false}
      {...props}
    />,
  )
}

describe('PlanFromSpondView', () => {
  it('renders a row with the title, team, counts and a plan control', () => {
    const html = render()
    expect(html).toContain('Plan from Spond')
    expect(html).toContain('U8 Training')
    expect(html).toContain('Titans')
    expect(html).toContain('Plan this')
    // The four attendance counts show as planning context.
    expect(html).toContain('>9</b> accepted')
    expect(html).toContain('>2</b> declined')
  })

  it('offers the training and all teams toggles', () => {
    const html = render()
    expect(html).toContain('Training only')
    expect(html).toContain('All teams')
  })

  it('hides the all teams toggle when the coach has no specific team subset', () => {
    expect(render({ showAllToggle: false })).not.toContain('All teams')
  })

  it('labels a club event as All teams and badges a match', () => {
    const html = render({ rows: [ev({ id: 'e2', teamId: null, teamName: null, spondType: 'MATCH' })] })
    expect(html).toContain('All teams')
    expect(html).toContain('Match')
  })

  it('points an empty surface at Sync when nothing is synced', () => {
    const html = render({ rows: [], eventsExist: false })
    expect(html).toContain('Nothing synced yet')
    expect(html).not.toContain('Plan this')
  })

  it('explains an empty surface that has events but no matches', () => {
    const html = render({ rows: [], eventsExist: true })
    expect(html).toContain('No unplanned events match')
  })
})
