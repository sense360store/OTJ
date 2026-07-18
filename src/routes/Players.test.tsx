import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopTable, PlayerCard, StatusBadge } from './Players'
import type { RegisteredPlayer } from '../lib/data'

// The presentational pieces of the Registered players page are covered with the
// static renderer, the same style as the rest of the suite; the filtering,
// sorting, counting and eligibility logic is unit tested in playersView.test.ts,
// and the write flows are enforced by the security suite. These pin the
// accessibility affordances (table semantics, aria-sort, the status word, the
// labelled overflow menu) and the capability gating of the row actions.

function row(p: Partial<RegisteredPlayer> & { playerId: string }): RegisteredPlayer {
  return {
    registrationId: 'reg-' + p.playerId,
    seasonId: 'season-1',
    teamId: 'titans',
    displayName: 'Jack Reed',
    shirtNumber: 7,
    status: 'registered',
    registeredDate: '2026-07-16',
    createdBy: null,
    updatedAt: '2026-07-16T00:00:00Z',
    ...p,
  }
}

const teamDisplay = (id: string | null) => (id == null ? 'Unassigned' : id === 'titans' ? 'Titans' : 'Deleted team')
const noop = () => {}
const manage = { canManage: true, canDelete: true, canHistory: true, writable: true }

function table(rows: RegisteredPlayer[], caps = manage, sort: 'name' | 'shirt' = 'name'): string {
  return renderToStaticMarkup(
    <DesktopTable
      rows={rows}
      teamDisplay={teamDisplay}
      sort={sort}
      onSort={noop}
      canManage={caps.canManage}
      canDelete={caps.canDelete}
      canHistory={caps.canHistory}
      writable={caps.writable}
      open={noop}
    />,
  )
}

describe('StatusBadge', () => {
  it('always shows the word, never colour alone', () => {
    expect(renderToStaticMarkup(<StatusBadge status="pending" />)).toContain('Pending')
    expect(renderToStaticMarkup(<StatusBadge status="registered" />)).toContain('Registered')
    expect(renderToStaticMarkup(<StatusBadge status="withdrawn" />)).toContain('Withdrawn')
  })
})

describe('DesktopTable accessibility', () => {
  it('is a semantic table with a caption and column headers', () => {
    const html = table([row({ playerId: 'a' })])
    expect(html).toContain('<table')
    expect(html).toContain('Registered players') // the sr-only caption
    expect(html).toContain('scope="col"')
  })

  it('marks the active sort column with aria-sort and leaves the rest none', () => {
    const html = table([row({ playerId: 'a' })], manage, 'name')
    // Name sorts ascending; other columns report none.
    expect(html).toContain('aria-sort="ascending"')
    expect(html).toContain('aria-sort="none"')
  })

  it('mutes a withdrawn row and states the status in words', () => {
    const html = table([row({ playerId: 'a', status: 'withdrawn' })])
    expect(html).toContain('class="withdrawn"')
    expect(html).toContain('Withdrawn')
  })

  it('shows Unassigned for a null team', () => {
    expect(table([row({ playerId: 'a', teamId: null })])).toContain('Unassigned')
  })
})

describe('DesktopTable row actions gate on capability and writability', () => {
  it('offers Edit, History and a labelled overflow menu to a manager on a writable season', () => {
    const html = table([row({ playerId: 'a' })])
    expect(html).toContain('>Edit<')
    expect(html).toContain('>History<')
    expect(html).toContain('aria-label="More actions for Jack Reed"')
  })

  it('gives a players.view only coach no Edit and no overflow menu, only nothing to act with', () => {
    const html = table([row({ playerId: 'a' })], { canManage: false, canDelete: false, canHistory: false, writable: true })
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('More actions for')
  })

  it('shows only History on an archived (read only) season', () => {
    const html = table([row({ playerId: 'a' })], { canManage: true, canDelete: true, canHistory: true, writable: false })
    expect(html).not.toContain('>Edit<')
    expect(html).not.toContain('More actions for')
    expect(html).toContain('>History<')
  })
})

describe('PlayerCard (mobile) has no table dependence', () => {
  it('renders the name, team, status and a labelled actions menu', () => {
    const html = renderToStaticMarkup(
      <PlayerCard
        player={row({ playerId: 'a' })}
        teamDisplay={teamDisplay}
        canManage
        canDelete
        canHistory
        writable
        open={noop}
      />,
    )
    expect(html).not.toContain('<table')
    expect(html).toContain('Jack Reed')
    expect(html).toContain('Titans')
    expect(html).toContain('Registered')
    expect(html).toContain('aria-label="Actions for Jack Reed"')
  })
})
