import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CapGate } from '../components/RequireCap'
import { navItemsFor } from '../components/nav'

// The roster names children, so its select is the one content read in the app
// that a parent must not reach. The players RLS enforces that server side
// (0021_players.sql gates select on sessions.create, not club wide). These
// static tests cover the two UI layers that mirror it: the route gate and the
// nav, the same style as RequireCap.test and Sidebar.test. A parent is
// redirected away from the roster and never sees the destination.

function renderAt(path: string, caps: Set<string>): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CapGate caps={caps} cap="sessions.create" redirect="/" />}>
          <Route path="roster" element={<span>ROSTER</span>} />
        </Route>
        <Route path="/" element={<span>HOME</span>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Roster route capability gate', () => {
  it('redirects a parent away from the roster', () => {
    // No sessions.create, so the gate renders a redirect to Home and the roster
    // never mounts: a parent never sees a player name.
    expect(renderAt('/roster', new Set())).not.toContain('ROSTER')
  })

  it('lets a coach into the roster', () => {
    expect(renderAt('/roster', new Set(['sessions.create']))).toContain('ROSTER')
  })
})

describe('Roster navigation', () => {
  it('hides the roster from a parent nav', () => {
    expect(navItemsFor(new Set()).map((it) => it.id)).not.toContain('roster')
  })

  it('shows the roster to a coach', () => {
    expect(navItemsFor(new Set(['sessions.create'])).map((it) => it.id)).toContain('roster')
  })
})
