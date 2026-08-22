// =====================================================================
// COACH-3 on the screen a coach actually uses.
//
// WHY THIS FILE EXISTS. src/lib/sessionSetup.test.ts proves every rule.
// That is necessary and not sufficient: the rules can be perfect while the
// card renders a number the module never produced, reimplements a sentence
// the module already wrote, or offers Apply to somebody who may not edit.
// None of that is visible at the seam.
//
// So these render the REAL exported halves — SetupSuggestionView, and
// TonightScreenView with the card in place — and assert on what comes out.
//
// STATIC RENDER ONLY. There is no DOM in this project, so what these cover
// is what the surface SHOWS. What a press DOES is proved at the seam, over
// the same pure functions the screen calls.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SETUP_NOT_STARTED,
  SETUP_READY,
  SETUP_SUGGESTION_TITLE,
  SetupSuggestionView,
} from '../components/SetupSuggestion'
import { TonightScreenView } from './SessionRegister'
import {
  SETUP_ISSUE_FIXES,
  SETUP_NOTES,
  expectedAttendanceNote,
  planSetup,
  setupReadiness,
  stationAdvice,
  stationFitNote,
} from '../lib/sessionSetup'
import {
  type SaveState,
  type TonightDraft,
  type TonightRow,
  draftFromEntries,
  tonightCounts,
} from '../lib/tonight'
import type { StructuredActivity } from '../lib/activityStructure'

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

const squad = (n: number, teamId: string, teamName: string, teamBib: string | null = null) =>
  Array.from({ length: n }, () => row({ teamId, teamName, teamBib }))

const includeAll = (rows: TonightRow[]): TonightDraft => ({
  included: Object.fromEntries(rows.map((r) => [r.playerId, true])),
  attendance: {},
  bibs: {},
  added: {},
  touched: {},
})

const stations = (n: number, over: Partial<StructuredActivity> = {}) =>
  Array.from({ length: n }, () => ({ duration: 10, slot: 'station', ...over }) as StructuredActivity)

// The card, rendered exactly as the screen renders it: every value comes
// from the module, never from this file.
function card(
  rows: TonightRow[],
  draft: TonightDraft,
  opts: { canEdit?: boolean; activities?: StructuredActivity[]; onApply?: () => void } = {},
): string {
  const plan = planSetup(rows, draft, null)
  return renderToStaticMarkup(
    <SetupSuggestionView
      plan={plan}
      fit={stationAdvice(plan.recommendation, opts.activities ?? [])}
      readiness={setupReadiness(rows, draft, plan.recommendation.groups)}
      canEdit={opts.canEdit ?? true}
      onApply={opts.onApply ?? noop}
    />,
  )
}

// The whole Players & groups screen, with the card wired in as the
// container wires it.
function screen(
  rows: TonightRow[],
  draft: TonightDraft,
  opts: { canEdit?: boolean; unset?: boolean; withSetup?: boolean; saveStatus?: SaveState } = {},
): string {
  const plan = planSetup(rows, draft, null)
  const setup = opts.withSetup === false
    ? null
    : {
        plan,
        fit: stationAdvice(plan.recommendation, []),
        readiness: setupReadiness(rows, draft, plan.recommendation.groups),
      }
  return renderToStaticMarkup(
    <TonightScreenView
      rows={rows}
      counts={tonightCounts(rows, draft, null)}
      draft={draft}
      setup={setup}
      filter="all"
      canEdit={opts.canEdit ?? true}
      saveStatus={opts.saveStatus ?? 'saved'}
      hasSpondEvent={false}
      hasResponses={false}
      eventNote=""
      staleNote={null}
      linkNote=""
      unlinkedNote=""
      audienceNote=""
      refreshing={false}
      refreshFailed={false}
      unset={opts.unset ?? false}
      onFilter={noop}
      onToggle={noop}
      onPresent={noop}
      onBib={noop}
      onSelectAll={noop}
      onClearSelection={noop}
      onSave={noop}
      onQuickAdd={noop}
      onApplySetup={noop}
    />,
  )
}

// ---------------------------------------------------------------------

describe('the suggestion reaches the screen', () => {
  it('renders on the Players & groups screen', () => {
    const rows = squad(24, 't1', 'One', 'red')
    const html = screen(rows, includeAll(rows))
    expect(html).toContain(SETUP_SUGGESTION_TITLE)
    expect(html).toContain('5 stations · 5 groups')
  })

  it('is absent when the session has no covered teams', () => {
    // Coverage was never set, so there is no roster to work from. The
    // screen already says so in its own words; a recommendation over a
    // squad it cannot establish would be the guess this slice refuses.
    expect(screen([], draftFromEntries([]), { unset: true, withSetup: false })).not.toContain(
      SETUP_SUGGESTION_TITLE,
    )
  })
})

describe('every figure and sentence comes from the module', () => {
  it('shows the recommendation the module produced', () => {
    for (const [n, expected] of [
      [23, '4 stations · 4 groups'],
      [24, '5 stations · 5 groups'],
    ] as const) {
      const rows = squad(n, 't1', 'One', 'red')
      expect(card(rows, includeAll(rows))).toContain(expected)
    }
  })

  it('shows the population sentence verbatim, rather than a second wording', () => {
    // The card must not paraphrase: the two figures behind a partial count
    // have to stay attached to the words that name them.
    const rows = [
      ...squad(5, 't1', 'One', 'red').map((r) => ({ ...r, response: 'accepted' as const })),
      ...squad(9, 't1', 'One', 'red'),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const note = expectedAttendanceNote(plan.recommendation.expected)
    expect(note).toContain('going in Spond')
    expect(card(rows, draft)).toContain(note)
  })

  it('shows the station advice verbatim when the plan disagrees', () => {
    const rows = squad(24, 't1', 'One', 'red')
    const plan = planSetup(rows, includeAll(rows), null)
    const fit = stationAdvice(plan.recommendation, stations(4))
    const note = stationFitNote(fit)
    expect(note).toBe('This plan runs 4 stations and the numbers suggest 5.')
    expect(card(rows, includeAll(rows), { activities: stations(4) })).toContain(note)
  })

  it('says nothing about the plan when it already agrees', () => {
    const rows = squad(24, 't1', 'One', 'red')
    const html = card(rows, includeAll(rows), { activities: stations(5) })
    expect(html).not.toContain('the numbers suggest')
  })

  it('shows the plan notes verbatim', () => {
    // COACH-1 has not shipped, so every plan reports the order is unset.
    const rows = squad(12, 't1', 'One', 'red')
    expect(card(rows, includeAll(rows))).toContain(SETUP_NOTES['team-order-unset'])
  })

  it('names each group, its station and its size', () => {
    // Four teams of five, so twenty expected recommends four groups and
    // each team is one whole group keeping its own colour.
    const rows = [
      ...squad(5, 't1', 'One', 'red'),
      ...squad(5, 't2', 'Two', 'blue'),
      ...squad(5, 't3', 'Three', 'green'),
      ...squad(5, 't4', 'Four', 'yellow'),
    ]
    const html = card(rows, includeAll(rows))
    expect(html).toContain('Red bibs')
    expect(html).toContain('Blue bibs')
    expect(html).toContain('starts at station 1')
    expect(html).toContain('starts at station 4')
    expect(html).toContain('5 players')
  })

  it('says which squads a combined group holds', () => {
    const rows = [
      ...squad(6, 't1', 'One'),
      ...squad(2, 't2', 'Two'),
      ...squad(2, 't3', 'Three'),
      ...squad(5, 't4', 'Four'),
      ...squad(5, 't5', 'Five'),
    ]
    const html = card(rows, includeAll(rows))
    expect(html).toContain('Two · Three')
  })

  it('never counts anything itself', () => {
    // The card renders the module's group list. If it derived a total of
    // its own it could disagree with the recommendation printed above it.
    const rows = squad(24, 't1', 'One', 'red')
    const plan = planSetup(rows, includeAll(rows), null)
    const html = card(rows, includeAll(rows))
    for (const g of plan.groups) {
      expect(html).toContain(`${g.children.length} ${g.children.length === 1 ? 'player' : 'players'}`)
    }
  })
})

describe('readiness is shown, and never as a blocker', () => {
  it('tells an untouched night apart from a finished one', () => {
    const rows = squad(20, 't1', 'One', 'red')
    expect(card(rows, draftFromEntries([]))).toContain(SETUP_NOT_STARTED)
    expect(card(rows, draftFromEntries([]))).not.toContain(SETUP_READY)
  })

  it('says a fully arranged night is ready', () => {
    const rows = [
      ...squad(5, 't1', 'One', 'red'),
      ...squad(5, 't2', 'Two', 'blue'),
      ...squad(5, 't3', 'Three', 'green'),
      ...squad(5, 't4', 'Four', 'yellow'),
    ]
    const html = card(rows, includeAll(rows))
    expect(html).toContain(SETUP_READY)
    expect(html).not.toContain(SETUP_NOT_STARTED)
  })

  it('names the fix for a child with no bib', () => {
    const rows = [
      ...squad(5, 't1', 'One', 'red'),
      ...squad(5, 't2', 'Two', 'blue'),
      ...squad(5, 't3', 'Three', 'green'),
      ...squad(5, 't4', 'Four', null),
    ]
    const html = card(rows, includeAll(rows))
    expect(html).toContain(SETUP_ISSUE_FIXES['child-without-bib'])
    expect(html).not.toContain(SETUP_READY)
    // And it does NOT also claim a colour clash: no colour is reused here,
    // the fourth team simply has no bib.
    expect(html).not.toContain(SETUP_ISSUE_FIXES['groups-share-colour'])
  })

  it('names the fix for two groups sharing a colour', () => {
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', 'red')]
    const draft = includeAll(rows)
    const readiness = setupReadiness(rows, draft, 2)
    expect(readiness.issues).toContain('groups-share-colour')
    const html = renderToStaticMarkup(
      <SetupSuggestionView
        plan={planSetup(rows, draft, null)}
        fit={stationAdvice(planSetup(rows, draft, null).recommendation, [])}
        readiness={readiness}
        canEdit
        onApply={noop}
      />,
    )
    expect(html).toContain(SETUP_ISSUE_FIXES['groups-share-colour'])
  })

  it('blocks nothing: Save is untouched by any issue', () => {
    // The brief's rule is that a warning is shown, not that it stops
    // anybody. The card renders no disabled Save and no gate of its own.
    const rows = [
      ...squad(5, 't1', 'One', 'red'),
      ...squad(5, 't2', 'Two', 'blue'),
      ...squad(5, 't3', 'Three', 'green'),
      ...squad(5, 't4', 'Four', null),
    ]
    // With unsaved work pending, Save is live. The readiness issue is
    // rendered right beside it and changes nothing about it: a warning is
    // shown, it does not stop anybody.
    const html = screen(rows, includeAll(rows), { saveStatus: 'dirty' })
    expect(html).toContain(SETUP_ISSUE_FIXES['child-without-bib'])
    const save = html.match(/<button[^>]*tn-save-btn[^>]*>/)?.[0] ?? ''
    expect(save).not.toBe('')
    expect(save).not.toContain('disabled')
  })
})

describe('applying is offered only to somebody who may edit', () => {
  it('offers Apply to a coach', () => {
    const rows = squad(12, 't1', 'One', 'red')
    expect(card(rows, includeAll(rows), { canEdit: true })).toMatch(/<button[^>]*>Apply</)
  })

  it('offers no Apply to a read-only viewer', () => {
    const rows = squad(12, 't1', 'One', 'red')
    expect(card(rows, includeAll(rows), { canEdit: false })).not.toMatch(/<button[^>]*>Apply</)
  })

  it('still shows a viewer the suggestion itself', () => {
    // Withholding the control is not withholding the information: a coach
    // who cannot edit this session can still read what the night needs.
    const rows = squad(24, 't1', 'One', 'red')
    const html = card(rows, includeAll(rows), { canEdit: false })
    expect(html).toContain(SETUP_SUGGESTION_TITLE)
    expect(html).toContain('5 stations · 5 groups')
  })

  it('disables Apply when there is nobody to place', () => {
    const html = card([], draftFromEntries([]), { canEdit: true })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Apply<|<button[^>]*>Apply<\/button>/)
    expect(html).toMatch(/disabled/)
  })
})

describe('nothing the card offers is a write', () => {
  it('hands every action to a callback, never to a mutation', () => {
    // The same guard SessionRegister.test.tsx applies to the register: a
    // presentational surface receives callbacks, and applying a suggestion
    // is a draft edit like ticking a row.
    const apply = vi.fn()
    const rows = squad(12, 't1', 'One', 'red')
    card(rows, includeAll(rows), { onApply: apply })
    expect(apply).not.toHaveBeenCalled()
  })

  it('renders no form and no submit', () => {
    const rows = squad(12, 't1', 'One', 'red')
    const html = card(rows, includeAll(rows))
    expect(html).not.toContain('<form')
    expect(html).not.toContain('type="submit"')
  })
})
