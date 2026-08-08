import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RegisterGroupView, RegisterRowView } from './SessionRegister'
import { buildRegister } from '../lib/register'
import type { Team } from '../lib/data'

// The Register's presentational pieces: a row is one big tick target with
// the badge and the bib select beside it, and a group collapses declined
// behind a toggle without ever dropping them. Names are synthetic, never
// real children.

const noop = () => {}

const teams: Team[] = [{ id: 't1', name: 'Titans', bibColour: 'red' }]

const group = (links: Parameters<typeof buildRegister>[3], responses: Parameters<typeof buildRegister>[4]) =>
  buildRegister(
    [
      { id: 'p1', teamId: 't1', displayName: 'Alpha Synthetic', shirtNumber: 7, createdBy: null },
      { id: 'p2', teamId: 't1', displayName: 'Beta Synthetic', shirtNumber: null, createdBy: null },
    ],
    ['t1'],
    teams,
    links,
    responses,
    [],
  ).groups[0]

describe('RegisterRowView', () => {
  it('renders the tick state, name, shirt number and badge', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        name="Alpha Synthetic"
        shirtNumber={7}
        badge="accepted"
        present
        bibValue=""
        bibSwatchColour="#e23b3b"
        busy={false}
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(html).toContain('Alpha Synthetic · 7')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Going')
    expect(html).toContain('aria-label="Bib colour for Alpha Synthetic"')
  })

  it('an unlinked player is still tickable', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        name="Beta Synthetic"
        shirtNumber={null}
        badge="unlinked"
        present={false}
        bibValue=""
        bibSwatchColour={null}
        busy={false}
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(html).toContain('Not linked')
    expect(html).toContain('aria-pressed="false"')
    expect(/<button[^>]*aria-pressed="false"(?![^>]*disabled)/.test(html)).toBe(true)
  })

  it('freezes for a viewer who cannot tick', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        name="Beta Synthetic"
        shirtNumber={null}
        badge="none"
        present={false}
        bibValue=""
        bibSwatchColour={null}
        busy
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(/<button[^>]*disabled/.test(html)).toBe(true)
    expect(/<select[^>]*disabled/.test(html)).toBe(true)
  })
})

describe('RegisterGroupView', () => {
  it('shows the team heading with the present count and every active row', () => {
    const g = group([], [])
    const html = renderToStaticMarkup(
      <RegisterGroupView group={g} busy={false} canTick onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain('Titans')
    expect(html).toContain('0 of 2 here')
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('Beta Synthetic')
  })

  it('collapses declined behind a toggle without dropping them', () => {
    const g = group(
      [{ id: 'l1', playerId: 'p1', spondMemberId: 'M1', matchedBy: 'auto', confirmedAt: null }],
      [{ spondMemberId: 'M1', status: 'declined' }],
    )
    const html = renderToStaticMarkup(
      <RegisterGroupView group={g} busy={false} canTick onToggle={noop} onBib={noop} />,
    )
    // The declined player renders only behind the toggle in the initial state.
    expect(html).toContain('Show declined (1)')
    expect(html).not.toContain('Alpha Synthetic')
    expect(html).toContain('Beta Synthetic')
  })
})
