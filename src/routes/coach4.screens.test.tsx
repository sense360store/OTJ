// =====================================================================
// COACH-4 on the screen a coach actually uses.
//
// ../lib/setupReconcile.test.ts proves the rules; this proves the card
// renders them and offers the one control to the right people. The same
// split as coach3.screens.test.tsx, over the same real exported halves,
// for the same reason: the rules can be perfect while the card offers a
// regeneration to an arranged night or a control to somebody who may not
// edit, and neither is visible at the seam.
//
// STATIC RENDER ONLY. There is no DOM in this project, so what a press
// DOES is proved at the seam over the same pure functions the screen
// calls; what the surface SHOWS is proved here.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SETUP_UPDATE_GROUPS, SetupSuggestionView } from '../components/SetupSuggestion'
import { TonightScreenView } from './SessionRegister'
import { planSetup, setupReadiness, stationAdvice } from '../lib/sessionSetup'
import { reconcileSetup, reconciliationNote } from '../lib/setupReconcile'
import {
  type TonightDraft,
  type TonightRow,
  draftFromEntries,
  tonightCounts,
} from '../lib/tonight'
import type { RsvpStatus } from '../lib/spondRsvp'

const noop = () => {}

let seq = 0
const row = (over: Partial<TonightRow> = {}): TonightRow => {
  seq += 1
  return {
    playerId: `p${seq}`,
    displayName: `Player ${seq}`,
    shirtNumber: null,
    teamId: 't1',
    teamName: 'One',
    teamBib: null,
    response: null,
    manual: false,
    ...over,
  }
}

const squad = (
  n: number,
  teamId: string,
  teamName: string,
  teamBib: string | null = null,
  response: RsvpStatus | null = null,
) => Array.from({ length: n }, () => row({ teamId, teamName, teamBib, response }))

const includeAll = (rows: TonightRow[]): TonightDraft => ({
  included: Object.fromEntries(rows.map((r) => [r.playerId, true])),
  attendance: {},
  bibs: {},
  added: {},
  touched: {},
})

// The card, wired exactly as the container wires it: every value from the
// modules, nothing decided here.
function card(
  rows: TonightRow[],
  draft: TonightDraft,
  opts: { canEdit?: boolean; onApply?: () => void; onReconcile?: () => void } = {},
): string {
  const plan = planSetup(rows, draft, null)
  return renderToStaticMarkup(
    <SetupSuggestionView
      plan={plan}
      fit={stationAdvice(plan.recommendation, [])}
      readiness={setupReadiness(rows, draft, plan.recommendation.groups)}
      reconcile={reconcileSetup(rows, draft)}
      canEdit={opts.canEdit ?? true}
      onApply={opts.onApply ?? noop}
      onReconcile={opts.onReconcile ?? noop}
    />,
  )
}

function screen(rows: TonightRow[], draft: TonightDraft): string {
  const plan = planSetup(rows, draft, null)
  return renderToStaticMarkup(
    <TonightScreenView
      rows={rows}
      counts={tonightCounts(rows, draft, null)}
      draft={draft}
      setup={{
        plan,
        fit: stationAdvice(plan.recommendation, []),
        readiness: setupReadiness(rows, draft, plan.recommendation.groups),
        reconcile: reconcileSetup(rows, draft),
      }}
      filter="all"
      canEdit
      saveStatus="dirty"
      hasSpondEvent={false}
      hasResponses={false}
      eventNote=""
      staleNote={null}
      linkNote=""
      unlinkedNote=""
      audienceNote=""
      refreshing={false}
      refreshFailed={false}
      unset={false}
      onFilter={noop}
      onToggle={noop}
      onPresent={noop}
      onBib={noop}
      onSelectAll={noop}
      onClearSelection={noop}
      onSave={noop}
      onQuickAdd={noop}
      onApplySetup={noop}
      onReconcileSetup={noop}
    />,
  )
}

// An arranged night where one included child has declined and one going
// child is not yet in: one removal, one arrival.
function changedNight() {
  const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
  const staying = squad(5, 'a', 'A', 'red', 'accepted')
  const arriving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
  const rows = [leaving, ...staying, arriving]
  return { rows, draft: includeAll([leaving, ...staying]) }
}

// ---------------------------------------------------------------------

describe('an arranged night is reconciled, not regenerated', () => {
  it('shows the change sentence verbatim from the one formatter, with the one control', () => {
    const { rows, draft } = changedNight()
    const note = reconciliationNote(reconcileSetup(rows, draft))
    expect(note).toBe('Attendance updated: 1 added, 1 removed. Existing groups kept.')
    const html = card(rows, draft)
    expect(html).toContain(note)
    expect(html).toMatch(new RegExp(`<button[^>]*>${SETUP_UPDATE_GROUPS}<`))
  })

  it('offers no full-plan Apply once anybody is included', () => {
    const { rows, draft } = changedNight()
    expect(card(rows, draft)).not.toMatch(/<button[^>]*>Apply</)
  })

  it('says no changes were needed when the replies already agree', () => {
    const rows = squad(6, 'a', 'A', 'red', 'accepted')
    const html = card(rows, includeAll(rows))
    expect(html).toContain('No group changes needed.')
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${SETUP_UPDATE_GROUPS}<`))
  })

  it('says nothing at a club with no reply context', () => {
    // No Spond has nothing for attendance to update, and "no changes"
    // would claim a comparison that never ran.
    const rows = squad(6, 'a', 'A', 'red')
    const html = card(rows, includeAll(rows))
    expect(html).not.toContain('No group changes needed.')
    expect(html).not.toContain('Attendance updated')
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${SETUP_UPDATE_GROUPS}<`))
  })
})

describe('the unarranged night still belongs to the suggestion', () => {
  it('offers Apply and no reconcile control over nobody', () => {
    const rows = squad(6, 'a', 'A', 'red', 'accepted')
    const html = card(rows, draftFromEntries([]))
    expect(html).toMatch(/<button[^>]*>Apply</)
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${SETUP_UPDATE_GROUPS}<`))
    expect(html).not.toContain('Attendance updated')
    expect(html).not.toContain('No group changes needed.')
  })
})

describe('the control is offered only to somebody who may edit', () => {
  it('a read-only viewer reads the sentence and gets no button', () => {
    const { rows, draft } = changedNight()
    const html = card(rows, draft, { canEdit: false })
    expect(html).toContain('Attendance updated: 1 added, 1 removed. Existing groups kept.')
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${SETUP_UPDATE_GROUPS}<`))
    expect(html).not.toMatch(/<button[^>]*>Apply</)
  })
})

describe('nothing the card offers is a write, and nothing resets', () => {
  it('hands the update to a callback, never to a mutation, and never calls it on render', () => {
    const update = vi.fn()
    const { rows, draft } = changedNight()
    card(rows, draft, { onReconcile: update })
    expect(update).not.toHaveBeenCalled()
  })

  it('renders no reset, rebuild or regenerate in any state', () => {
    const { rows, draft } = changedNight()
    for (const html of [
      card(rows, draft),
      card(rows, includeAll([])),
      card(squad(6, 'a', 'A', 'red', 'accepted'), includeAll(rows)),
    ]) {
      expect(html).not.toMatch(/\breset\b|\brebuild\b|\bregenerate\b|\bstart over\b/i)
    }
  })
})

describe('the screen wires it and Save is untouched', () => {
  it('renders the sentence on Players & groups with Save still live', () => {
    const { rows, draft } = changedNight()
    const html = screen(rows, draft)
    expect(html).toContain('Attendance updated: 1 added, 1 removed. Existing groups kept.')
    const save = html.match(/<button[^>]*tn-save-btn[^>]*>/)?.[0] ?? ''
    expect(save).not.toBe('')
    expect(save).not.toContain('disabled')
  })
})
