import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AdminSection, TeamSetting } from './Account'

// AdminSection is presentational over the capability set, so the static
// renderer covers it without a DOM or a query client, the same style as the
// rest of the suite. The router wrapper satisfies useNavigate; the live
// capability set comes from useMyCapabilities in the Account screen itself.

function render(caps: Set<string>): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AdminSection caps={caps} />
    </MemoryRouter>,
  )
}

describe('AdminSection', () => {
  it('shows the section for club.manage with only the rows that capability opens', () => {
    const html = render(new Set(['club.manage']))
    expect(html).toContain('Admin')
    expect(html).toContain('Club')
    expect(html).toContain('Spond')
    expect(html).not.toContain('Users')
    expect(html).not.toContain('Teams')
  })

  it('is absent for a member with no admin capability', () => {
    expect(render(new Set())).toBe('')
    expect(render(new Set(['sessions.create']))).toBe('')
  })

  it('lists all four screens when every admin capability is held', () => {
    const html = render(new Set(['club.manage', 'users.manage', 'teams.manage']))
    for (const label of ['Club', 'Users', 'Teams', 'Spond']) {
      expect(html).toContain(label)
    }
  })
})

// TeamSetting is the Profile card's team row pulled out as a presentational
// switch over canPlan, the same style as HomeSwitch. A coach gets the Default
// team control (it seeds the planner default); a parent gets a quiet admin
// managed line, since their scope is member_teams, not a control they drive.

describe('TeamSetting', () => {
  it('shows the Default team control for a coach', () => {
    const html = renderToStaticMarkup(<TeamSetting canPlan={true} control={<span>TEAM_CONTROL</span>} />)
    expect(html).toContain('TEAM_CONTROL')
    expect(html).not.toContain('set by a club admin')
  })

  it('replaces the control with an admin managed line for a parent', () => {
    const html = renderToStaticMarkup(<TeamSetting canPlan={false} control={<span>TEAM_CONTROL</span>} />)
    expect(html).not.toContain('TEAM_CONTROL')
    expect(html).toContain('Your team is set by a club admin.')
  })
})
