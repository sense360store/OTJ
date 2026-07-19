import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RenewOutcomeBody, RenewRowView } from './RenewSeasonModal'
import type { RenewRow } from '../lib/renewPlan'

// The interactive orchestration (season pickers, selection, confirm, pending) is
// exercised by the renewPlan unit suite and the renew security suite (server
// idempotency and refusals); here the presentational row and outcome body are
// pinned with the static renderer (the house style, Players.test.tsx). These
// prove the accessibility affordances: the class word is always shown (never
// colour alone), the checkbox is disabled and unchecked for an already-in-target
// row, the detail line states what carries forward, and the outcome renders safe
// counts only.

function row(p: Partial<RenewRow> & { playerId: string; klass: RenewRow['klass'] }): RenewRow {
  return {
    displayName: 'Sam Example',
    teamId: null,
    shirtNumber: null,
    sourceStatus: 'registered',
    ...p,
  }
}

function render(r: RenewRow, checked: boolean, disabled?: boolean) {
  return renderToStaticMarkup(
    <RenewRowView row={r} teamName="U8 Tigers" checked={checked} onToggle={() => {}} disabled={disabled} />,
  )
}

describe('RenewRowView', () => {
  it('shows the class word for each class, never colour alone', () => {
    expect(render(row({ playerId: 'a', klass: 'eligible' }), true)).toContain('Eligible')
    expect(render(row({ playerId: 'b', klass: 'needs_decision' }), false)).toContain('Withdrawn')
    expect(render(row({ playerId: 'c', klass: 'already_in_target' }), false)).toContain('Already in target')
  })

  it('states the team and shirt that carry forward, and Pending, for a renewable row', () => {
    const html = render(row({ playerId: 'a', klass: 'eligible', teamId: 't1', shirtNumber: 7 }), true)
    expect(html).toContain('Carries forward: U8 Tigers, shirt 7')
    expect(html).toContain('Renews as Pending')
  })

  it('omits the shirt phrase when there is no shirt number', () => {
    const html = render(row({ playerId: 'a', klass: 'eligible', teamId: 't1', shirtNumber: null }), true)
    expect(html).toContain('Carries forward: U8 Tigers.')
    expect(html).not.toContain('shirt')
  })

  it('disables and unchecks the checkbox for an already-in-target row', () => {
    const html = render(row({ playerId: 'c', klass: 'already_in_target' }), true)
    expect(html).toContain('disabled')
    expect(html).not.toContain('checked')
    expect(html).toContain('Already registered in the target season.')
  })

  it('reflects the checked state and the busy disable for a selectable row', () => {
    expect(render(row({ playerId: 'a', klass: 'eligible' }), true)).toContain('checked')
    expect(render(row({ playerId: 'a', klass: 'eligible' }), false)).not.toContain('checked')
    expect(render(row({ playerId: 'a', klass: 'eligible' }), true, true)).toContain('disabled')
  })

  it('labels the checkbox with the player name for assistive tech', () => {
    expect(render(row({ playerId: 'a', klass: 'eligible', displayName: 'Amara Okafor' }), true)).toContain(
      'aria-label="Renew Amara Okafor"',
    )
  })
})

describe('RenewOutcomeBody', () => {
  it('renders the three safe server counts and the Pending explanation', () => {
    const html = renderToStaticMarkup(
      <RenewOutcomeBody outcome={{ renewed: 12, alreadyInTarget: 3, skipped: 1 }} targetName="2026/27" />,
    )
    expect(html).toContain('Renewed into 2026/27: 12 renewed, 3 already in target, 1 skipped.')
    expect(html).toContain('Pending')
    expect(html).toContain('carried forward')
  })
})
