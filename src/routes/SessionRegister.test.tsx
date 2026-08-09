import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RegisterCardView, RegisterRowView, RegisterScreenView, QuickAddView } from './SessionRegister'
import { buildRegister, type RegisterEntry } from '../lib/register'
import type { Player, Session, Team } from '../lib/data'
import { blankSession } from '../lib/data'

// The register's presentational shells, rendered without hooks or a query
// client, the same style as SessionBoardCardView. The composition rules
// themselves are covered in lib/register.test.ts; here the questions are
// what a coach can tap, what a read only holder cannot, and whether the
// screen ever presents an unknown register as an empty one. Names are
// synthetic, never real children.

const teams: Team[] = [
  { id: 't1', name: 'Titans', bibColour: 'red' },
  { id: 't2', name: 'Trojans', bibColour: null },
]

const player = (id: string, name: string, teamId: string | null, shirt: number | null = null): Player => ({
  id,
  teamId,
  displayName: name,
  shirtNumber: shirt,
  createdBy: null,
})

const players = [player('p1', 'Alpha Synthetic', 't1', 7), player('p2', 'Beta Synthetic', 't1')]

const session = (over: Partial<Session> = {}): Session => ({
  ...blankSession('coach', null),
  id: 's1',
  name: 'Thursday night',
  teamIds: ['t1'],
  ...over,
})

const entries: RegisterEntry[] = [
  { sessionId: 's1', playerId: 'p1', present: true, bibColourOverride: null, source: 'roster' },
]

const noop = () => {}

const screen = (over: Partial<Parameters<typeof RegisterScreenView>[0]> = {}) =>
  renderToStaticMarkup(
    <RegisterScreenView
      session={session()}
      teams={teams}
      players={players}
      entries={entries}
      canMark
      onToggle={noop}
      onBib={noop}
      onRemove={noop}
      onQuickAdd={noop}
      {...over}
    />,
  )

describe('RegisterScreenView', () => {
  it('shows the count, the covered team and its players', () => {
    const html = screen()
    expect(html).toContain('1 of 2 in')
    expect(html).toContain('Titans')
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('Beta Synthetic')
    expect(html).toContain('Add player')
  })

  it('says so when the session has no teams rather than listing the whole club', () => {
    // The failure this guards: absence read as "everyone", which would put
    // every child in the club on a register for one team.
    const html = screen({ session: session({ teamIds: [] }), entries: [] })
    expect(html).toContain('This session has no teams yet')
    expect(html).not.toContain('Alpha Synthetic')
  })

  it('offers no write affordance to a holder who may read but not mark', () => {
    const html = screen({ canMark: false })
    expect(html).toContain('Alpha Synthetic')
    expect(html).not.toContain('Add player')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('aria-pressed')
  })
})

describe('RegisterRowView', () => {
  const row = (over: Partial<RegisterEntry> = {}) =>
    buildRegister(players, ['t1'], teams, [{ ...entries[0], ...over }], false).groups[0].rows[0]

  it('makes the whole name row the tick target and keeps the bib separate', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView row={row()} canMark onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain('aria-label="Mark Alpha Synthetic present"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Bib colour for Alpha Synthetic"')
    // The team default shows as a swatch without claiming to be an override.
    expect(html).toContain('#e23b3b')
    expect(html).toContain('value="" selected="">Team bib')
  })

  it('shows the shirt number and marks a quick add as added on the day', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView row={row({ source: 'manual' })} canMark onToggle={noop} onBib={noop} onRemove={noop} />,
    )
    expect(html).toContain('#7')
    expect(html).toContain('Added on the day')
    expect(html).toContain('aria-label="Remove Alpha Synthetic from the register"')
  })

  it('offers no remove button for a roster row', () => {
    const html = renderToStaticMarkup(<RegisterRowView row={row()} canMark onToggle={noop} onBib={noop} />)
    expect(html).not.toContain('from the register')
  })
})

describe('QuickAddView', () => {
  it('lists the pool and says when there is nobody left to add', () => {
    expect(renderToStaticMarkup(<QuickAddView pool={players} onAdd={noop} onClose={noop} />)).toContain(
      'Alpha Synthetic',
    )
    expect(renderToStaticMarkup(<QuickAddView pool={[]} onAdd={noop} onClose={noop} />)).toContain(
      'Everyone in the club is already on this register',
    )
  })
})

describe('RegisterCardView', () => {
  it('carries the summary through to session day', () => {
    const html = renderToStaticMarkup(<RegisterCardView summary="1 of 2 in" note="" onOpen={noop} />)
    expect(html).toContain('Register')
    expect(html).toContain('1 of 2 in')
  })

  it('never presents a failed read as a confident zero', () => {
    const html = renderToStaticMarkup(
      <RegisterCardView summary="Could not load the register" note="" onOpen={noop} />,
    )
    expect(html).toContain('Could not load the register')
    expect(html).not.toContain('0 of 0 in')
  })
})
