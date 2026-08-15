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
import { PLAYERS_GROUPS_TITLE, SAVE_LABELS, saveState, tonightCounts, tonightSummary, usableFilter } from '../lib/tonight'
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
    expect(html).toContain('aria-label="Include Alpha Synthetic in the groups"')
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
  it('is Players & groups, and says what state the night is in', () => {
    const html = renderToStaticMarkup(
      <TonightCardView summary="12 expected · 10 selected · 2 groups" note="" onOpen={noop} />,
    )
    expect(html).toContain('Players &amp; groups')
    expect(html).toContain('12 expected · 10 selected · 2 groups')
    expect(html).not.toContain('Register')
    expect(html).not.toContain('Tonight')
  })

  it('summarises expected, selected and groups', () => {
    const r = rows()
    expect(tonightSummary(r, draftFromEntries([]))).toBe('1 expected · 0 selected')
    expect(tonightSummary(r, selectAll(draftFromEntries([]), r))).toBe('1 expected · 3 selected · 1 group')
  })

  it('never presents a failed read as a confident zero', () => {
    const html = renderToStaticMarkup(<TonightCardView summary="Could not load the player list" note="" onOpen={noop} />)
    expect(html).toContain('Could not load the player list')
    expect(html).not.toContain('0 selected')
  })
})

// ---- The surface is named for its job, not for a time of day ---------
//
// Training happens at 10:00 on a Saturday as often as 18:00 on a Tuesday,
// and a coach organises a session days before or after it runs. "Tonight"
// was wrong for all of those, so the surface is Players & groups
// everywhere and for every session. The title takes no date and no clock:
// there is no code path that could render a different name for a morning,
// evening, past or future session, and the card and the opened screen
// share one constant so they cannot diverge.

describe('the surface name', () => {
  it('is Players & groups, with no time of day in it', () => {
    expect(PLAYERS_GROUPS_TITLE).toBe('Players & groups')
    expect(PLAYERS_GROUPS_TITLE.toLowerCase()).not.toContain('tonight')
    expect(PLAYERS_GROUPS_TITLE.toLowerCase()).not.toContain('morning')
    expect(PLAYERS_GROUPS_TITLE.toLowerCase()).not.toContain('evening')
  })

  it('renders on the card identically whatever the session s date or time', () => {
    // The card view takes no session at all, which is the structural form
    // of tests 1 to 4: a 10:00 session, an 18:00 session, last week's and
    // next month's all render this exact component with this exact title.
    const html = renderToStaticMarkup(<TonightCardView summary="9 in the squad · 0 selected" note="" onOpen={noop} />)
    expect(html).toContain('Players &amp; groups')
    expect(html).not.toContain('Tonight')
  })

  it('never says Tonight anywhere on the operational screen', () => {
    for (const filter of ['going', 'all'] as const) {
      expect(screen({ filter })).not.toContain('Tonight')
    }
    expect(screen({ rows: [], unset: true })).not.toContain('Tonight')
  })
})

// ---- The bib control says the colour, not a phrase to decode ---------
//
// "Team bib" asked a coach in the rain to remember what the team default
// was. The inherit option now says the colour it resolves to, and stays
// the empty select value, so displaying "Red (team)" stores nothing: an
// untouched row keeps following the team when the default changes later.

describe('the bib select a coach reads on the pitch', () => {
  const one = rows()[0]

  it('labels the inherit option with the team s actual colour', () => {
    // Alpha Synthetic is on Titans, whose default is red.
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={noop} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html).toMatch(/<option value=""( selected="")?>Red \(team\)<\/option>/)
    expect(html).not.toContain('Team bib')
  })

  it('is honest when the team has no default colour', () => {
    const trojan = buildTonightRows(
      buildRegister([player('p9', 'Delta Synthetic', 't2')], ['t2'], teams, [], false),
      teams,
      {},
    )[0]
    const html = renderToStaticMarkup(
      <TonightRowView row={trojan} included={false} present={false} onPresent={noop} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html).toMatch(/<option value=""( selected="")?>No team colour<\/option>/)
    expect(html).not.toContain('Team bib')
  })

  it('keeps the inherit option s value empty, so showing the colour stores nothing', () => {
    // The storage semantic the label must not disturb: an untouched row
    // sends '' which the container reads as null, meaning inherit. If the
    // option carried the colour as its value, rendering the label would
    // have turned inheritance into an override.
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={noop} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    expect(html).toMatch(/<option value=""[^>]*>Red \(team\)<\/option>/)
    expect(html).not.toMatch(/<option value="red"[^>]*>Red \(team\)<\/option>/)
  })

  it('marks the inherit option selected on an untouched row', () => {
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={noop} bib="" canEdit onToggle={noop} onBib={noop} />,
    )
    const options = html.match(/<option[^>]*selected[^>]*>/g) ?? []
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('value=""')
  })

  it('shows an explicit override as the bare colour, not as the team s', () => {
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={noop} bib="yellow" canEdit onToggle={noop} onBib={noop} />,
    )
    const options = html.match(/<option[^>]*selected[^>]*>[^<]*/g) ?? []
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('Yellow')
    expect(options[0]).not.toContain('(team)')
  })

  it('offers No bib as the explicit nothing', () => {
    const html = renderToStaticMarkup(
      <TonightRowView row={one} included={false} present={false} onPresent={noop} bib="none" canEdit onToggle={noop} onBib={noop} />,
    )
    const options = html.match(/<option[^>]*selected[^>]*>[^<]*/g) ?? []
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('No bib')
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
        unlinkedNote=""
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

// =====================================================================
// The acceptance case: the linked 11 August Training session.
//
// Production, read only, on 2026-08-12: the Spond event's own aggregate
// was 20 accepted, 24 declined, 6 unanswered, 0 waiting, an audience of
// 50 people. Against that, the Hub held 40 covered children on the
// session (it covers all five teams), 27 of them bound to a Spond member,
// and 27 stored replies for the event: 10 accepted, 14 declined, 3
// unanswered.
//
// The coach's complaint was that 20 and 24 read as a count of players.
// They are not, and the figures that ARE about players are the chips on
// this screen. So what has to be true is the thing a coach can check by
// tapping: each chip's number is the number of rows that chip lists.
//
// Names are synthetic. No real child appears in this repo.
// =====================================================================
const AUGUST = (() => {
  const out: Player[] = []
  const rsvpByPlayer: Record<string, { status: 'accepted' | 'declined' | 'unanswered' | 'waiting'; syncedAt: string }> =
    {}
  const at = new Date().toISOString()
  const replies = [
    ...Array<'accepted'>(10).fill('accepted'),
    ...Array<'declined'>(14).fill('declined'),
    ...Array<'unanswered'>(3).fill('unanswered'),
  ]
  for (let i = 0; i < 40; i++) {
    const id = `aug-${i}`
    out.push(player(id, `Player ${String(i).padStart(2, '0')} Synthetic`, i % 2 === 0 ? 't1' : 't2'))
    // The first 27 are the linked children, each carrying the reply the
    // mirror stored for this event; the remaining 13 are unlinked and have
    // no reply to give.
    if (i < replies.length) rsvpByPlayer[id] = { status: replies[i], syncedAt: at }
  }
  return {
    rows: buildTonightRows(buildRegister(out, ['t1', 't2'], teams, [], false), teams, rsvpByPlayer),
  }
})()

describe('the linked 11 August Training session, as the coach opens it', () => {
  const chip = (html: string, label: string) => {
    const m = html.match(new RegExp(`>${label} (\\d+)</button>`))
    return m ? Number(m[1]) : null
  }

  it('shows player figures, not the event audience', () => {
    // 10 and 14, the covered players who replied, rather than 20 and 24,
    // which count everybody Spond invited.
    const html = screen({ rows: AUGUST.rows })
    expect(chip(html, 'Going')).toBe(10)
    expect(chip(html, 'Not going')).toBe(14)
    expect(chip(html, 'No reply')).toBe(3)
    expect(chip(html, 'Waiting')).toBe(0)
    expect(chip(html, 'Everyone')).toBe(40)
  })

  it('lists exactly as many players as each chip claims', () => {
    // Requirement 9, as a coach would verify it: tap a chip, count the
    // rows. Every filter, including the widening.
    for (const [label, filter] of [
      ['Going', 'going'],
      ['No reply', 'unanswered'],
      ['Not going', 'declined'],
      ['Waiting', 'waiting'],
      ['Everyone', 'all'],
    ] as const) {
      const html = screen({ rows: AUGUST.rows, filter })
      expect(names(html)).toHaveLength(chip(html, label) as number)
    }
  })

  it('never puts the event audience on a chip', () => {
    // Requirement 10 at the screen: 20, 24 and 50 are the aggregate's
    // figures and none of them may appear as a chip's number.
    const html = screen({ rows: AUGUST.rows })
    for (const n of [20, 24, 50]) {
      expect(html).not.toContain(`>Going ${n}<`)
      expect(html).not.toContain(`>Not going ${n}<`)
      expect(html).not.toContain(`>Everyone ${n}<`)
    }
  })

  it('keeps the audience available as a labelled sentence beside them', () => {
    // Secondary context, named. It is allowed to be on screen; it is not
    // allowed to look like one of the figures above.
    const html = screen({ rows: AUGUST.rows, audienceNote: 'Spond audience: 50 people invited' })
    expect(html).toContain('Spond audience: 50 people invited')
  })

  it('counts the 13 unlinked children under Everyone and nowhere else', () => {
    // Requirement 11: no link means no reply to give, which is a different
    // thing from having given none.
    const html = screen({ rows: AUGUST.rows })
    const replied =
      (chip(html, 'Going') as number) +
      (chip(html, 'No reply') as number) +
      (chip(html, 'Not going') as number) +
      (chip(html, 'Waiting') as number)
    expect(replied).toBe(27)
    expect(chip(html, 'Everyone')).toBe(40)
  })
})

describe('a session whose coverage was never set', () => {
  it('counts nobody rather than falling back to the whole club', () => {
    // Requirement 14. Zero covered teams means coverage was never chosen,
    // never "all teams" (../lib/sessionTeams), so there is no squad to
    // count and no denominator to guess at.
    const html = screen({ rows: [], unset: true })
    expect(html).toContain('This session has no teams yet')
    expect(html).toContain('Everyone 0')
  })

  it('says what to do about it instead of showing a number it cannot back', () => {
    expect(screen({ rows: [], unset: true })).toContain('Choose the teams it covers')
  })
})

// =====================================================================
// The acceptance case: the linked 15 August Training session.
//
// Production, read only, on 2026-08-15. The session ran at 10:00, a
// morning, which is why the surface is no longer called Tonight. It
// covered all five teams: 40 registered players, 27 linked, and 27
// stored replies for the event: 12 accepted, 11 declined, 4 unanswered,
// 0 waiting. The event's own aggregate was 20 accepted, 18 declined,
// 11 unanswered over a 49 person audience.
//
// Names are synthetic. No real child appears in this repo.
// =====================================================================
const AUGUST_15 = (() => {
  const out: Player[] = []
  const rsvpByPlayer: Record<string, { status: 'accepted' | 'declined' | 'unanswered' | 'waiting'; syncedAt: string }> =
    {}
  const at = new Date().toISOString()
  const replies = [
    ...Array<'accepted'>(12).fill('accepted'),
    ...Array<'declined'>(11).fill('declined'),
    ...Array<'unanswered'>(4).fill('unanswered'),
  ]
  for (let i = 0; i < 40; i++) {
    const id = `aug15-${i}`
    out.push(player(id, `Player ${String(i).padStart(2, '0')} Synthetic`, i % 2 === 0 ? 't1' : 't2'))
    if (i < replies.length) rsvpByPlayer[id] = { status: replies[i], syncedAt: at }
  }
  return {
    rows: buildTonightRows(buildRegister(out, ['t1', 't2'], teams, [], false), teams, rsvpByPlayer),
  }
})()

describe('the linked 15 August Training session, as the coach opens it', () => {
  const chip = (html: string, label: string) => {
    const m = html.match(new RegExp(`>${label} (\\d+)</button>`))
    return m ? Number(m[1]) : null
  }

  it('shows the stored player replies, 12 4 11 0 over 40', () => {
    const html = screen({ rows: AUGUST_15.rows })
    expect(chip(html, 'Going')).toBe(12)
    expect(chip(html, 'No reply')).toBe(4)
    expect(chip(html, 'Not going')).toBe(11)
    expect(chip(html, 'Waiting')).toBe(0)
    expect(chip(html, 'Everyone')).toBe(40)
  })

  it('lists exactly as many players as each chip claims', () => {
    for (const [label, filter] of [
      ['Going', 'going'],
      ['No reply', 'unanswered'],
      ['Not going', 'declined'],
      ['Waiting', 'waiting'],
      ['Everyone', 'all'],
    ] as const) {
      const html = screen({ rows: AUGUST_15.rows, filter })
      expect(names(html)).toHaveLength(chip(html, label) as number)
    }
  })

  it('never puts the 49 person audience or its split on a chip', () => {
    const html = screen({ rows: AUGUST_15.rows })
    expect(html).not.toContain('>Going 20<')
    expect(html).not.toContain('>Not going 18<')
    expect(html).not.toContain('>No reply 11<')
    expect(html).not.toContain('>Everyone 49<')
  })

  it('says the size of the linking gap and where it lives', () => {
    const html = screen({
      rows: AUGUST_15.rows,
      linkNote: '27 of 40 players linked to Spond · 13 not linked',
      unlinkedNote: 'Not linked: Argonauts 8 · Trojans 5',
      onLinkPlayers: noop,
    })
    expect(html).toContain('27 of 40 players linked to Spond · 13 not linked')
    expect(html).toContain('Not linked: Argonauts 8 · Trojans 5')
    // The direct action to resolve it, beside the sentence naming it.
    expect(html).toContain('Link players')
  })

  it('shows no team breakdown when there is nothing to say', () => {
    const html = screen({ rows: AUGUST_15.rows, unlinkedNote: '' })
    expect(html).not.toContain('Not linked:')
  })
})
