import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoundaryPreview } from './AdminVenues'
import type { Boundary } from '../lib/venues'

// BoundaryPreview is the venue screen's scale true outline, presentational:
// a real boundary renders a polygon fitted into the box, an unreadable one
// renders a plain label, never a guessed shape. Coordinates are the seeded
// Flushdyke field, real venue data, no person data involved.

const FLUSHDYKE: Boundary = [
  [53.68568155, -1.56218739],
  [53.68529301, -1.56243823],
  [53.68517449, -1.56162951],
  [53.68550302, -1.56145621],
]

describe('BoundaryPreview', () => {
  it('renders the polygon outline for a boundary', () => {
    const html = renderToStaticMarkup(<BoundaryPreview boundary={FLUSHDYKE} />)
    expect(html).toContain('<svg')
    expect(html).toContain('<polygon')
    // Four vertices survive into the points attribute.
    const points = html.match(/points="([^"]+)"/)?.[1]
    expect(points?.split(' ')).toHaveLength(4)
  })

  it('labels an unreadable boundary instead of drawing one', () => {
    const html = renderToStaticMarkup(<BoundaryPreview boundary={null} />)
    expect(html).not.toContain('<svg')
    expect(html).toContain('No outline to show.')
  })

  it('names itself for assistive tech', () => {
    const html = renderToStaticMarkup(<BoundaryPreview boundary={FLUSHDYKE} />)
    expect(html).toContain('aria-label="Area outline, north up"')
  })
})
