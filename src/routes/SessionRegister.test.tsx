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
  it('lists the pool', () => {
    expect(
      renderToStaticMarkup(<QuickAddView pool={players} rosterEmpty={false} onAdd={noop} onClose={noop} />),
    ).toContain('Alpha Synthetic')
  })

  it('tells a club with no roster where to start, not that everyone is listed', () => {
    expect(renderToStaticMarkup(<QuickAddView pool={[]} rosterEmpty onAdd={noop} onClose={noop} />)).toContain(
      'Nobody is registered for this season yet',
    )
    expect(
      renderToStaticMarkup(<QuickAddView pool={[]} rosterEmpty={false} onAdd={noop} onClose={noop} />),
    ).toContain('Everyone in the club is already on this register')
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

// ---- Spond RSVP as context, never attendance -------------------------------
//
// The questions here are the ones a wrong answer would make dangerous:
// does the pill ever change what the register composes or how it reads,
// and does a broken Spond read take the register with it.

describe('RSVP context beside the register', () => {
  const row = buildRegister(players, ['t1'], teams, entries, false).groups[0].rows[0]

  it('renders nothing at all when there is no reply, exactly as before', () => {
    const without = renderToStaticMarkup(
      <RegisterRowView row={row} canMark onToggle={noop} onBib={noop} />,
    )
    const withNull = renderToStaticMarkup(
      <RegisterRowView row={row} canMark rsvp={null} onToggle={noop} onBib={noop} />,
    )
    expect(withNull).toBe(without)
    expect(without).not.toContain('reg-rsvp')
  })

  it('shows the reply as words, never as a tick or a yes', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        row={row}
        canMark
        rsvp={{ status: 'accepted', syncedAt: new Date().toISOString() }}
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(html).toContain('Going')
    expect(html).not.toMatch(/>\s*Yes\s*</)
    // Outside the tick button, so it can never take the tap.
    expect(html.indexOf('reg-rsvp')).toBeGreaterThan(html.indexOf('</button>'))
  })

  it('a declined child keeps their place, their tick and their prominence', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        row={row}
        canMark
        rsvp={{ status: 'declined', syncedAt: new Date().toISOString() }}
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(html).toContain('Not going')
    // Still ticked (this row is present), still tappable, not dimmed.
    expect(html).toContain('reg-row on')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('disabled')
  })

  it('the reply never announces itself as part of the attendance control', () => {
    const html = renderToStaticMarkup(
      <RegisterRowView
        row={row}
        canMark
        rsvp={{ status: 'unanswered', syncedAt: new Date().toISOString() }}
        onToggle={noop}
        onBib={noop}
      />,
    )
    expect(html).toContain('aria-label="Spond reply: no reply"')
    expect(html).toContain('aria-label="Mark Alpha Synthetic present"')
  })

  it('a screen with replies renders the same rows, in the same order, as one without', () => {
    // Under Everyone, which is what a screen with no Spond always shows.
    // Replies decorate the rows; they never recompose or reorder them, and
    // buildRegister still never sees them. The Going view narrows what is
    // LISTED, which is a separate step covered below.
    const bare = screen()
    const withRsvp = screen({
      scope: 'all',
      rsvpByPlayer: {
        p1: { status: 'declined', syncedAt: new Date().toISOString() },
        p2: { status: 'accepted', syncedAt: new Date().toISOString() },
      },
    })
    const names = (html: string) => [...html.matchAll(/reg-name-main">([^<]+)</g)].map((m) => m[1])
    expect(names(withRsvp)).toEqual(names(bare))
    expect(withRsvp).toContain('Not going')
    // The count is attendance, never the replies.
    expect(names(bare).length).toBe(2)
  })

  it('an absent lookup leaves the register byte identical to today', () => {
    expect(screen({ rsvpByPlayer: undefined })).toBe(screen())
    expect(screen({ rsvpByPlayer: {} })).toBe(screen())
  })

  it('the stale line counts only replies actually on this register', () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    // p9 is linked and replied to this event, but is not on a team this
    // session covers, so no pill of theirs renders. A freshness claim
    // about a reply nobody can see is one the screen cannot back up.
    expect(screen({ rsvpByPlayer: { p9: { status: 'accepted', syncedAt: old } } })).not.toContain(
      'Spond replies from',
    )
  })

  it('says so when the replies are stale, and stays quiet when they are fresh', () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(screen({ rsvpByPlayer: { p1: { status: 'accepted', syncedAt: old } } })).toContain(
      'Spond replies from 3 days ago',
    )
    expect(
      screen({ rsvpByPlayer: { p1: { status: 'accepted', syncedAt: new Date().toISOString() } } }),
    ).not.toContain('Spond replies from')
  })
})

// ---- Organising tonight: the Going view -----------------------------------
//
// Going means the parent accepted in Spond. It never means the coach has
// ticked the child in, and it never becomes a claim about who is present.
// The rules themselves are pinned in lib/registerScope.test.ts; here the
// questions are what a coach sees, what they can still tap, and whether a
// club with no Spond can ever be shown an empty register.

describe('the Going view', () => {
  const names = (html: string) => [...html.matchAll(/reg-name-main">([^<]+)</g)].map((m) => m[1])
  const fresh = () => new Date().toISOString()

  it('offers no Going toggle at all to a club with no Spond context', () => {
    // The safety property. No Spond, no linked event, no links, a read
    // still in flight and a read that failed are one case, and that case
    // shows the complete register.
    const html = screen()
    expect(html).not.toContain('Going')
    expect(html).not.toContain('Everyone')
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic'])
  })

  it('cannot be forced into an empty register by asking for Going without context', () => {
    // Even if a caller passes the scope explicitly, missing context wins.
    // "Nobody is coming" must not be renderable out of absence.
    const html = screen({ scope: 'going', rsvpByPlayer: {} })
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic'])
  })

  it('defaults to Going once this session has replies to show', () => {
    const html = screen({
      entries: [],
      rsvpByPlayer: { p2: { status: 'accepted', syncedAt: fresh() } },
    })
    expect(html).toContain('aria-pressed="true">Going</button>')
    expect(html).toContain('aria-pressed="false">Everyone</button>')
    expect(names(html)).toEqual(['Beta Synthetic'])
  })

  it('lists an accepted child nobody has ticked in yet', () => {
    // Going is about what the parent said, not about what the coach has
    // done. An empty register with two accepted children lists both.
    const html = screen({
      entries: [],
      rsvpByPlayer: {
        p1: { status: 'accepted', syncedAt: fresh() },
        p2: { status: 'accepted', syncedAt: fresh() },
      },
    })
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic'])
    expect(html).toContain('0 of 2 in')
  })

  it('keeps a child the coach has already ticked in, whatever they replied', () => {
    // p1 is present and declined. Nothing the coach recorded disappears.
    const html = screen({
      rsvpByPlayer: { p1: { status: 'declined', syncedAt: fresh() } },
    })
    expect(names(html)).toContain('Alpha Synthetic')
    expect(html).toContain('Not going')
  })

  it('leaves an unlinked child out of Going without ever calling them No reply', () => {
    // p2 has no link, so there is no reply of theirs to have. p1 is linked
    // and has not answered, which is a different fact and the only one of
    // the two that gets a pill.
    const html = screen({
      entries: [],
      scope: 'going',
      rsvpByPlayer: { p1: { status: 'unanswered', syncedAt: fresh() } },
    })
    expect(names(html)).not.toContain('Beta Synthetic')
    expect(html).not.toContain('No reply')
  })

  it('finds the unlinked child under Everyone, still with no pill', () => {
    const html = screen({
      entries: [],
      scope: 'all',
      rsvpByPlayer: { p1: { status: 'accepted', syncedAt: fresh() } },
    })
    expect(names(html)).toEqual(['Alpha Synthetic', 'Beta Synthetic'])
    expect(html).toContain('Going')
    // One pill, for the one child who has a reply.
    expect([...html.matchAll(/reg-rsvp/g)]).toHaveLength(1)
  })

  it('says how many it is holding back rather than narrowing silently', () => {
    const html = screen({
      entries: [],
      rsvpByPlayer: { p1: { status: 'accepted', syncedAt: fresh() } },
    })
    expect(html).toContain('1 hidden')
  })

  it('stays fully markable in Going, which is where a coach spends the night', () => {
    const html = screen({
      entries: [],
      rsvpByPlayer: { p1: { status: 'accepted', syncedAt: fresh() } },
    })
    expect(html).toContain('aria-label="Mark Alpha Synthetic present"')
    expect(html).toContain('aria-label="Bib colour for Alpha Synthetic"')
    expect(html).toContain('Add player')
  })

  it('points an empty Going view at Everyone instead of claiming nobody is coming', () => {
    const html = screen({
      entries: [],
      rsvpByPlayer: { p1: { status: 'declined', syncedAt: fresh() } },
    })
    expect(html).toContain('Everyone')
    expect(html).not.toMatch(/nobody is coming/i)
    expect(html).toContain('2 hidden')
  })
})

describe('refreshing the Spond context on the night', () => {
  const fresh = () => new Date().toISOString()
  const context = { p1: { status: 'accepted' as const, syncedAt: fresh() } }

  it('offers Refresh only where there is context to refresh', () => {
    expect(screen({ onRefresh: () => {} })).not.toContain('Refresh')
    expect(screen({ rsvpByPlayer: context, onRefresh: () => {} })).toContain('Refresh')
  })

  it('says it is working without taking the register away', () => {
    const html = screen({ rsvpByPlayer: context, onRefresh: () => {}, refreshing: true })
    expect(html).toContain('Refreshing')
    expect(html).toContain('Alpha Synthetic')
  })

  it('keeps every reply it already had when a refresh fails', () => {
    // The rule: a failed refresh degrades to the last known context, never
    // to no context and never to an error page. The coach keeps working.
    const html = screen({ rsvpByPlayer: context, onRefresh: () => {}, refreshFailed: true })
    expect(html).toContain('Going')
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('Could not refresh')
    expect(html).not.toContain('Something went wrong')
  })
})
