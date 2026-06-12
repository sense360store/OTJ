import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ParentDashboard, PracticeAtHome } from './ParentHome'
import type { PracticeSuggestion } from './ParentHome'

// ParentDashboard and PracticeAtHome are presentational over plain props, so
// the static renderer covers the empty and no team states and the practice
// suggestions without a DOM or a query client, the same style as the rest of
// the suite. The container resolves the team scope and the session and drill
// data; these pin what the dashboard surfaces from it.

const noop = () => {}

describe('ParentDashboard empty and no team states', () => {
  it('shows the no team note, a friendly note and the touchline card when nothing is scheduled', () => {
    const html = renderToStaticMarkup(
      <ParentDashboard
        firstName="Sam"
        noTeam={true}
        thisWeek={[]}
        lastSession={null}
        practice={[]}
        programme={null}
        onOpenDrill={noop}
      />,
    )
    // A parent with no team gets a gentle note pointing at an admin, never a
    // blank screen.
    expect(html).toContain('No team set yet')
    expect(html).toContain('Ask a club admin')
    // A brand new season with no sessions still shows a friendly note and the
    // positive support card.
    expect(html).toContain('No sessions yet')
    expect(html).toContain('On the touchline')
    expect(html).toContain('did you have fun?')
  })

  it('drops the no team note once the member belongs to a team', () => {
    const html = renderToStaticMarkup(
      <ParentDashboard
        firstName="Sam"
        noTeam={false}
        thisWeek={[]}
        lastSession={null}
        practice={[]}
        programme={null}
        onOpenDrill={noop}
      />,
    )
    expect(html).not.toContain('No team set yet')
    // The touchline card is always present, team or not.
    expect(html).toContain('On the touchline')
  })
})

describe('PracticeAtHome', () => {
  const suggestions: PracticeSuggestion[] = [
    {
      drillId: 'd1',
      drillTitle: 'Rondo 4v1',
      kind: 'easier',
      text: 'Make the grid bigger so there is more time on the ball.',
    },
    {
      drillId: 'd2',
      drillTitle: 'Dribble gates',
      kind: 'video',
      text: 'Watch the clip together, then have a go in the garden or park.',
    },
  ]

  it('renders the make it easier adaptations as optional, never homework, suggestions', () => {
    const html = renderToStaticMarkup(<PracticeAtHome suggestions={suggestions} onOpenDrill={noop} />)
    expect(html).toContain('Practice at home')
    expect(html).toContain('never homework')
    expect(html).toContain('Make the grid bigger so there is more time on the ball.')
    expect(html).toContain('Make it easier')
    expect(html).toContain('Rondo 4v1')
  })

  it('renders a video drill as a watch together suggestion', () => {
    const html = renderToStaticMarkup(<PracticeAtHome suggestions={suggestions} onOpenDrill={noop} />)
    expect(html).toContain('Watch together')
    expect(html).toContain('Dribble gates')
  })

  it('renders nothing when there are no suggestions', () => {
    expect(renderToStaticMarkup(<PracticeAtHome suggestions={[]} onOpenDrill={noop} />)).toBe('')
  })
})
