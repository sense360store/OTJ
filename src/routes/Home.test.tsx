import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeSwitch } from './Home'

// HomeSwitch is the Home route's dispatch pulled out as a presentational switch
// over the capability set, so the static renderer covers the routing without a
// DOM or a query client, the same style as the rest of the suite. The two home
// trees are stand-ins here; the screen passes the real ParentHome and CoachHome.

function render(caps: Set<string>): string {
  return renderToStaticMarkup(
    <HomeSwitch caps={caps} parent={<span>PARENT_DASHBOARD</span>} coach={<span>COACH_HOME</span>} />,
  )
}

describe('Home routing', () => {
  it('shows the parent dashboard for a member without sessions.create', () => {
    const html = render(new Set())
    expect(html).toContain('PARENT_DASHBOARD')
    expect(html).not.toContain('COACH_HOME')
  })

  it('keeps the coach home for a member who can plan sessions', () => {
    const html = render(new Set(['sessions.create']))
    expect(html).toContain('COACH_HOME')
    expect(html).not.toContain('PARENT_DASHBOARD')
  })

  it('keeps the coach home for a member holding both a coaching role and the parent role', () => {
    // The parent role grants no write capabilities, so a member who also coaches
    // still holds sessions.create and lands on the coach home.
    const html = render(new Set(['sessions.create', 'drills.create']))
    expect(html).toContain('COACH_HOME')
    expect(html).not.toContain('PARENT_DASHBOARD')
  })
})
