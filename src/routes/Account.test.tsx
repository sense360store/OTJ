import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AdminSection } from './Account'

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
