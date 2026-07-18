import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CapGate } from '../components/RequireCap'
import { navItemsFor } from '../components/nav'
import { DeletePlayerModal } from './Roster'
import { deleteConfirmed } from './rosterHelpers'
import type { Player } from '../lib/data'

// The roster names children, so its select is the one content read in the app
// that a parent must not reach. The players RLS enforces that server side; since
// the PR 2 split it gates select on players.view (club wide read, coaches and
// admins hold it, parents do not; 0032_registered_players.sql). These static
// tests cover the two UI layers that mirror it: the route gate and the nav, the
// same style as RequireCap.test and Sidebar.test. A parent is redirected away
// from the roster and never sees the destination.

function renderAt(path: string, caps: Set<string>): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CapGate caps={caps} cap="players.view" redirect="/" />}>
          <Route path="roster" element={<span>ROSTER</span>} />
        </Route>
        <Route path="/" element={<span>HOME</span>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Roster route capability gate', () => {
  it('redirects a parent away from the roster', () => {
    // No players.view, so the gate renders a redirect to Home and the roster
    // never mounts: a parent never sees a player name.
    expect(renderAt('/roster', new Set())).not.toContain('ROSTER')
  })

  it('lets a coach into the roster', () => {
    // A coach holds players.view (club wide read), so the roster mounts.
    expect(renderAt('/roster', new Set(['players.view']))).toContain('ROSTER')
  })
})

describe('Roster navigation', () => {
  it('hides the roster from a parent nav', () => {
    expect(navItemsFor(new Set()).map((it) => it.id)).not.toContain('roster')
  })

  it('shows the roster to a coach', () => {
    // The Plan group needs sessions.create; the roster item additionally gates
    // on players.view. A coach holds both.
    expect(navItemsFor(new Set(['sessions.create', 'players.view'])).map((it) => it.id)).toContain('roster')
  })
})

// --- Permanent delete UX (item 4) ---
const SAMPLE_PLAYER: Player = {
  id: 'p1',
  teamId: 't1',
  displayName: 'Alex Morgan',
  shirtNumber: 9,
  createdBy: 'coach-1',
}

describe('permanent delete typed confirmation gate', () => {
  it('requires the display name typed exactly (trimmed) before enabling', () => {
    expect(deleteConfirmed('', 'Alex Morgan')).toBe(false)
    expect(deleteConfirmed('Alex', 'Alex Morgan')).toBe(false)
    expect(deleteConfirmed('alex morgan', 'Alex Morgan')).toBe(false)
    expect(deleteConfirmed('  Alex Morgan  ', 'Alex Morgan')).toBe(true)
    expect(deleteConfirmed('Alex Morgan', 'Alex Morgan')).toBe(true)
  })
})

describe('DeletePlayerModal copy and initial state', () => {
  function renderModal(): string {
    const qc = new QueryClient()
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <DeletePlayerModal player={SAMPLE_PLAYER} onClose={() => {}} />
      </QueryClientProvider>,
    )
  }

  it('names the permanent, all-seasons, irreversible nature of the deletion', () => {
    const html = renderModal()
    expect(html).toContain('Permanently delete player')
    expect(html).toContain('every one of their registrations')
    expect(html).toContain('cannot be undone')
    // The apostrophe in "player's" is HTML-escaped in static markup.
    expect(html).toContain('type the player')
  })

  it('disables the destructive button until the name is typed', () => {
    // With nothing typed, the confirm button is disabled (the gate above proves
    // typing the exact name enables it).
    const html = renderModal()
    // The primary (destructive) button carries the confirm label and is disabled.
    expect(html).toMatch(/Permanently delete<\/button>|Permanently delete<\/span>/)
    expect(html).toContain('disabled')
  })
})
