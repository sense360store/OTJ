// Tonight, the one operational session-day screen.
//
// The pure rules live in lib/tonight.test.ts. The questions here are what
// a coach sees and can tap: does the screen open on Going, does Select all
// reach only what is visible, does anything persist before Save, and does
// the status line ever say Saved when it is not.
//
// Names are synthetic, never real children.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuickAddView, TonightCardView, TonightRowView, TonightScreenView } from './SessionRegister'
import { SAVE_LABELS, saveState, tonightCounts, tonightSummary, usableFilter } from '../lib/tonight'
import { buildTonightRows, draftFromEntries, selectAll, setDraftBib, type TonightRow } from '../lib/tonight'
import { buildRegister, type RegisterEntry } from '../lib/register'
import type { Player, Team } from '../lib/data'

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

const players = [
  player('p1', 'Alpha Synthetic', 't1', 7),
  player('p2', 'Beta Synthetic', 't1'),
  player('p3', 'Gamma Synthetic', 't1'),
]

const rsvp = {
  p1: { status: 'accepted' as const, syncedAt: new Date().toISOString() },
  p2: { status: 'unanswered' as const, syncedAt: new Date().toISOString() },
}

const rows = (): TonightRow[] =>
  buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, rsvp)

const noop = () => {}

const screen = (over: Partial<Parameters<typeof TonightScreenView>[0]> = {}) => {
  // The counts follow whatever rows and draft the case supplies, so a test
  // can never accidentally assert a chip against a different population
  // than the list it rendered. Links are unknown unless a case says
  // otherwise, which is what a screen with no readable link set gets.
  const r = over.rows ?? rows()
  const d = over.draft ?? draftFromEntries([])
  return renderToStaticMarkup(
    <TonightScreenView
      rows={r}
      counts={tonightCounts(r, d, null)}
      draft={d}
      filter="going"
      canEdit
      saveStatus="saved"
      hasSpondEvent
      hasResponses
      eventNote="Titans Tuesday"
      staleNote={null}
      linkNote=""
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
      onRefresh={noop}
      onQuickAdd={noop}
      {...over}
    />,
  )
}

const names = (html: string) => [...html.matchAll(/reg-name-main">([^<]+)</g)].map((m) => m[1])

describe('the response filters a coach taps', () => {
  it('opens on Going and shows only the accepted child', () => {
    const html = screen()
    expect(html).toContain('aria-pressed="true">Going 1</button>')
    expect(names(html)).toEqual(['Alpha Synthetic'])
  })

  it('carries an actionable count on every chip', () => {
    // The counts describe the Hub players on THIS session, so tapping a
    // chip shows exactly that many rows.
    const html = screen()
    expect(html).toContain('Going 1')
    expect(html).toContain('No reply 1')
    expect(html).toContain('Not going 0')
    expect(html).toContain('Waiting 0')
    expect(html).toContain('Everyone 3')
  })

  it('never counts an unlinked child as No reply', () => {
    // Gamma has no Spond link. Three children, one accepted, one
    // unanswered, and the third counted only under Everyone.
    const html = screen()
    expect(html).toContain('No reply 1')
    expect(html).toContain('Everyone 3')
    expect(names(screen({ filter: 'all' }))).toContain('Gamma Synthetic')
    expect(names(screen({ filter: 'unanswered' }))).not.toContain('Gamma Synthetic')
  })

  it('offers no response chips at all when the session has no Spond event', () => {
    // No event means no replies to have, so no chips and no pills: the
    // screen is the roster and the coach's selection, nothing else.
    const bare = buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, {})
    const html = screen({ rows: bare, hasSpondEvent: false, hasResponses: false, eventNote: '', filter: 'all' })
    expect(html).not.toContain('No reply')
    expect(html).not.toContain('reg-rsvp')
    expect(names(html)).toHaveLength(3)
  })
})

describe('selection', () => {
  it('shows how many of the visible rows are selected', () => {
    const html = screen({ draft: selectAll(draftFromEntries([]), rows().slice(0, 1)) })
    expect(html).toContain('Going 1')
    expect(html).toContain('1 selected')
  })

  it('offers Select all and Clear to a coach who may edit', () => {
    const html = screen()
    expect(html).toContain('Select all')
    expect(html).toContain('Clear')
  })

  it('offers neither to a member who may read but not edit', () => {
    const html = screen({ canEdit: false })
    expect(html).not.toContain('Select all')
    expect(html).not.toContain('Save groups')
    expect(html).not.toContain('<select')
  })

  it('marks the included child on the row, and leaves the reply beside it', () => {
    const html = screen({ draft: selectAll(draftFromEntries([]), rows().slice(0, 1)) })
    expect(html).toContain('reg-row on')
    expect(html).toContain('Going')
  })
})

describe('the row', () => {
  const one = rows()[0]

  it('says Include, never Present or Arrived', () => {
    // The tick is the coach's organisation decision, not a claim that a
    // child walked through the gate.
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={() => {}} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain("aria-label=\"Include Alpha Synthetic in tonight&#x27;s groups\"")
    expect(html).not.toMatch(/Mark .* present/)
    expect(html).not.toContain('Arrived')
  })

  it('keeps the bib control out of the tick target', () => {
    // A mis-tap must change a colour, not who is in tonight's groups.
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included present={false} onPresent={() => {}} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html.indexOf('reg-bib')).toBeGreaterThan(html.indexOf('</button>'))
    expect(html).toContain('aria-label="Bib colour for Alpha Synthetic"')
  })

  it('shows the reply as words, outside the tick button', () => {
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={() => {}} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain('Going')
    expect(html.indexOf('reg-rsvp')).toBeGreaterThan(html.indexOf('</button>'))
  })
})

describe('the groups, which is what the screen is for', () => {
  it('puts the selected children in their team bib group with no per child work', () => {
    const html = screen({ filter: 'all', draft: selectAll(draftFromEntries([]), rows()) })
    expect(html).toContain('Groups')
    expect(html).toContain('Red bibs')
    expect(html).toContain('3 selected')
  })

  it('moves a child into another group the moment their bib changes, before any save', () => {
    const draft = setDraftBib(selectAll(draftFromEntries([]), rows()), 'p2', 'blue')
    const html = screen({ filter: 'all', draft })
    expect(html).toContain('Red bibs')
    expect(html).toContain('Blue bibs')
  })

  it('shows no groups at all until something is selected', () => {
    expect(screen()).not.toContain('Groups')
  })

  it('says No team bib rather than inventing a colour', () => {
    const trojan = [player('p9', 'Delta Synthetic', 't2')]
    const trojanRows = buildTonightRows(buildRegister(trojan, ['t2'], teams, [], false), teams, {})
    const html = screen({ rows: trojanRows, hasResponses: false, filter: 'all', draft: selectAll(draftFromEntries([]), trojanRows) })
    expect(html).toContain('No bibs')
  })
})

describe('save', () => {
  it('reports the four states with the words a coach reads', () => {
    expect(SAVE_LABELS).toEqual({
      saved: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      failed: 'Could not save',
    })
  })

  it('derives the state rather than storing it', () => {
    expect(saveState(false, false, false)).toBe('saved')
    expect(saveState(true, false, false)).toBe('dirty')
    expect(saveState(true, true, false)).toBe('saving')
    expect(saveState(true, false, true)).toBe('failed')
  })

  it('never says Saved while the draft still differs', () => {
    // The rule the whole status line hangs on. A failure that leaves the
    // draft dirty can only read as failed, never as saved.
    expect(saveState(true, false, true)).not.toBe('saved')
    expect(saveState(true, false, false)).not.toBe('saved')
  })

  it('returns to a settled state once a save has landed and nothing has changed', () => {
    // Dirty is computed against the readback, so a clean draft after a
    // successful save is Saved even though a save just failed earlier.
    expect(saveState(false, false, true)).toBe('saved')
  })

  it('holds the button closed when there is nothing to save', () => {
    expect(screen({ saveStatus: 'saved' })).toMatch(/disabled[^>]*>Save groups/)
  })

  it('opens the button and says so when the draft is dirty', () => {
    const html = screen({ saveStatus: 'dirty' })
    expect(html).toContain('Unsaved changes')
    expect(html).not.toMatch(/disabled[^>]*>Save groups/)
  })

  it('says it is working without taking the list away', () => {
    const html = screen({ saveStatus: 'saving' })
    expect(html).toContain('Saving…')
    expect(html).toContain('Alpha Synthetic')
  })

  it('keeps the list and the draft on screen when a save fails', () => {
    const html = screen({ saveStatus: 'failed', draft: selectAll(draftFromEntries([]), rows().slice(0, 1)) })
    expect(html).toContain('Could not save')
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('reg-row on')
  })
})

describe('Spond, inside Tonight rather than beside it', () => {
  it('offers Refresh Spond where the coach already is', () => {
    expect(screen()).toContain('Refresh Spond')
  })

  it('says it is refreshing without blanking anything', () => {
    const html = screen({ refreshing: true })
    expect(html).toContain('Refreshing…')
    expect(html).toContain('Alpha Synthetic')
  })

  it('keeps the responses it already had when a refresh fails', () => {
    const html = screen({ refreshFailed: true })
    expect(html).toContain('Could not refresh from Spond')
    expect(html).toContain('Going 1')
    expect(html).toContain('Alpha Synthetic')
  })

  it('shows linking coverage and a way to fix it', () => {
    const html = screen({ linkNote: '2 of 3 players linked to Spond', onLinkPlayers: noop })
    expect(html).toContain('2 of 3 players linked to Spond')
    expect(html).toContain('Link players')
  })

  it('lets an authorised coach change or unlink the event without a second card', () => {
    const html = screen({ onLinkEvent: noop, onUnlinkEvent: noop })
    expect(html).toContain('Change Spond event')
    expect(html).toContain('Unlink')
  })

  it('offers Link Spond event on a session that has none', () => {
    const html = screen({ hasSpondEvent: false, hasResponses: false, eventNote: '', onLinkEvent: noop, filter: 'all' })
    expect(html).toContain('Link Spond event')
    expect(html).not.toContain('Refresh Spond')
  })
})

describe('the session day card', () => {
  it('is Tonight, and says what state the night is in', () => {
    const html = renderToStaticMarkup(
      <TonightCardView summary="12 expected · 10 selected · 2 groups" note="" onOpen={noop} />,
    )
    expect(html).toContain('Tonight')
    expect(html).toContain('12 expected · 10 selected · 2 groups')
    expect(html).not.toContain('Register')
  })

  it('summarises expected, selected and groups', () => {
    const r = rows()
    expect(tonightSummary(r, draftFromEntries([]))).toBe('1 expected · 0 selected')
    expect(tonightSummary(r, selectAll(draftFromEntries([]), r))).toBe('1 expected · 3 selected · 1 group')
  })

  it('never presents a failed read as a confident zero', () => {
    const html = renderToStaticMarkup(<TonightCardView summary="Could not load tonight" note="" onOpen={noop} />)
    expect(html).toContain('Could not load tonight')
    expect(html).not.toContain('0 selected')
  })
})

describe('a club with no Spond at all', () => {
  it('still organises the night from Everyone', () => {
    const bare = buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, {})
    const html = screen({ rows: bare, hasSpondEvent: false, hasResponses: false, eventNote: '', filter: 'all' })
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic', 'Gamma Synthetic'])
    expect(html).toContain('Select all')
    expect(html).toContain('Save groups')
  })

  it('says so when the session has no teams, rather than listing the club', () => {
    const html = screen({ rows: [], unset: true })
    expect(html).toContain('This session has no teams yet')
  })
})

describe('QuickAddView', () => {
  it('lists the pool', () => {
    expect(
      renderToStaticMarkup(<QuickAddView pool={players} rosterEmpty={false} onAdd={noop} onClose={noop} />),
    ).toContain('Alpha Synthetic')
  })

  it('tells a club with no roster where to start', () => {
    expect(renderToStaticMarkup(<QuickAddView pool={[]} rosterEmpty onAdd={noop} onClose={noop} />)).toContain(
      'Nobody is registered for this season yet',
    )
  })
})

// ---- Nothing persists before Save -----------------------------------

describe('no filter or selection writes anything', () => {
  it('fires no mutation for any draft interaction', () => {
    // The strongest form of "explicit save": the presentational screen is
    // handed callbacks, and every one of them is a draft edit. If a
    // future change wires a mutation into one of these, this fails.
    const spy = vi.fn()
    const html = renderToStaticMarkup(
      <TonightScreenView
        rows={rows()}
        counts={tonightCounts(rows(), draftFromEntries([]), null)}
        draft={draftFromEntries([])}
        filter="going"
        canEdit
        saveStatus="saved"
        hasSpondEvent
        hasResponses
        eventNote=""
        staleNote={null}
        linkNote=""
        audienceNote=""
        refreshing={false}
        refreshFailed={false}
        unset={false}
        onFilter={spy}
        onToggle={spy}
        onPresent={noop}
        onBib={spy}
        onSelectAll={spy}
        onClearSelection={spy}
        onSave={spy}
        onRefresh={spy}
        onQuickAdd={spy}
      />,
    )
    expect(html).toContain('Alpha Synthetic')
    // Rendering alone must never call a handler.
    expect(spy).not.toHaveBeenCalled()
  })
})

// ---- The legacy entry shape still round-trips -----------------------

describe('the stored shape', () => {
  it('reads a saved arrangement back into exactly the same draft', () => {
    // Leaving and reopening rebuilds what was saved, which is what makes
    // the Saved claim worth anything.
    const saved: RegisterEntry[] = [
      { sessionId: 's', playerId: 'p1', present: false, includedInGroups: true, bibColourOverride: 'blue', source: 'roster' },
      { sessionId: 's', playerId: 'p2', present: false, includedInGroups: false, bibColourOverride: null, source: 'roster' },
    ]
    const d = draftFromEntries(saved)
    expect(d.included).toEqual({ p1: true, p2: false })
    expect(d.bibs).toEqual({ p1: 'blue', p2: null })
  })
})

// ---- A club with no Spond opens on a usable screen ------------------

describe('the no Spond path, which is the whole club before linking', () => {
  const bare = buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, {})

  it('shows the whole squad rather than an empty Going view', () => {
    // THE DEFECT THIS PINS. Going is the default and nobody has accepted,
    // so the screen used to render "Nobody under Going" over a full
    // squad. usableFilter falls back to Everyone when this session has no
    // replies at all.
    const html = screen({ rows: bare, hasSpondEvent: false, hasResponses: false, filter: usableFilter(bare, 'going'), eventNote: '' })
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic', 'Gamma Synthetic'])
    expect(html).not.toContain('Nobody under')
  })

  it('keeps the coach s chosen filter once even one child has replied', () => {
    const withOne = buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, {
      p1: { status: 'accepted', syncedAt: 'x' },
    })
    expect(usableFilter(withOne, 'going')).toBe('going')
  })

  it('summarises the card without claiming nobody is expected', () => {
    expect(tonightSummary(bare, draftFromEntries([]))).toContain('in the squad')
    expect(tonightSummary(bare, draftFromEntries([]))).not.toContain('0 expected')
  })
})

// ---- Defects found in adversarial review ----------------------------

describe('Refresh Spond', () => {
  it('is offered on a linked event even before any reply has arrived', () => {
    // The case that most needs it: an event linked and never synced. The
    // chips have nothing to say, and the button used to hide with them.
    const bare = buildTonightRows(buildRegister(players, ['t1'], teams, [], false), teams, {})
    const html = screen({ rows: bare, hasSpondEvent: true, hasResponses: false, eventNote: 'Titans Tuesday' })
    expect(html).toContain('Refresh Spond')
    expect(html).not.toContain('No reply 0')
  })

  it('is absent for a member who may read but not write', () => {
    // spond-sync is gated on sessions.create, so offering it to a reader
    // could only ever produce a failure note for an action they were never
    // allowed to take.
    expect(screen({ canEdit: false, onRefresh: undefined })).not.toContain('Refresh Spond')
  })
})

describe('linking coverage is only claimed when the read can answer', () => {
  it('says nothing rather than "0 of N linked" when there is no note to make', () => {
    const html = screen({ linkNote: '' })
    expect(html).not.toContain('linked to Spond')
    expect(html).not.toContain('Link players')
  })
})

// ---- The two populations, never presented as one --------------------
//
// The "19 vs 11" report. A coach met the Spond event's own aggregate on
// one screen and Tonight's Going chip on another, both as bare numbers,
// and could not tell that they count different sets of people.

describe('every number on Tonight names the population it counted', () => {
  it('counts the chips over Hub players on this session, not the event audience', () => {
    // Three covered children, one of them accepted. The linked Spond event
    // has fifty people on it and twenty one of them going; neither figure
    // may appear on a chip.
    const html = screen({ audienceNote: 'Spond event: 50 invited, 21 going' })
    expect(html).toContain('Going 1')
    expect(html).toContain('Everyone 3')
    expect(html).not.toContain('Going 21')
    expect(html).not.toContain('Everyone 50')
  })

  it('prints the event aggregate as a labelled sentence, never as a chip', () => {
    const html = screen({ audienceNote: 'Spond event: 50 invited, 21 going' })
    expect(html).toContain('Spond event: 50 invited, 21 going')
    // A chip is tappable and filters the list. The aggregate filters
    // nothing and must never look like it does.
    expect(html).not.toMatch(/<button[^>]*>Spond event/)
    expect(html).toContain('tn-audience')
  })

  it('shows the link coverage that explains the gap between the two', () => {
    const html = screen({
      linkNote: '27 of 40 players linked to Spond',
      audienceNote: 'Spond event: 50 invited, 21 going',
    })
    // Read together these answer the question the bare numbers could not:
    // the event reached fifty people, the squad is forty, and twenty seven
    // of them are bound to a Spond member.
    expect(html).toContain('27 of 40 players linked to Spond')
    expect(html).toContain('Spond event: 50 invited, 21 going')
  })

  it('says how many linked players actually have a reply for this event', () => {
    const html = screen({ linkNote: '27 of 40 players linked to Spond · 24 with a reply for this event' })
    expect(html).toContain('24 with a reply for this event')
  })

  it('shows no audience sentence when nothing is linked to say it about', () => {
    const html = screen({ hasSpondEvent: false, hasResponses: false, eventNote: '', audienceNote: '', filter: 'all' })
    expect(html).not.toContain('tn-audience')
    expect(html).not.toContain('invited')
  })
})

describe('a cancelled Spond event still says so', () => {
  it('carries the cancellation into the one surface that remains', () => {
    expect(screen({ eventNote: 'Titans Tuesday · Cancelled' })).toContain('Cancelled')
  })
})

describe('quick add stays reachable', () => {
  it('is offered even when the composed list is empty', () => {
    // A session covering a team with nobody registered still has to let a
    // coach add the child standing in front of them.
    const html = screen({ rows: [], hasSpondEvent: false, hasResponses: false, filter: 'all' })
    expect(html).toContain('Add player')
  })
})

describe('the read only bib cell', () => {
  it('shows the colour a child actually wears, not the stored enum', () => {
    const one = rows()[0]
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included present={false} onPresent={() => {}} bib="red" canEdit={false} onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain('Red')
    expect(html).not.toMatch(/>red</)
  })

  it('falls back to the team colour when there is no override', () => {
    const one = rows()[0]
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included present={false} onPresent={() => {}} bib="" canEdit={false} onToggle={noop} onBib={noop} />,
    )
    expect(html).toContain('Red')
  })
})
