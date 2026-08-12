// =====================================================================
// Admin → Spond, on the screen the defect was reported from.
//
// WHAT WAS REPORTED. A screenshot of this card showing "20 accepted,
// 24 declined, 6 unanswered" for the 11 August Training event, with the
// note that the Going / Not going numbers were wrong. They were not
// arithmetically wrong: those four figures count every member Spond
// invited, an audience of 50 people. What was wrong is that a reply word
// beside a figure is read as a statement about the club's children
// wherever it appears, and on that night the children were 10 going and
// 14 not going out of 27 linked from a covered squad of 40.
//
// The first correction demoted the aggregate on every coach-facing
// surface and left this one alone, on the reasoning that an admin
// inspecting the mirror wants what was synced. That reasoning was wrong
// in the only way that matters: it left the reported screen unchanged.
//
// So the rule has no exempt surface. This file renders the REAL container
// and proves it, because a source-text check sees an identifier somewhere
// in a file and cannot see what the row prints.
//
// Names in fixtures are invented. No real child appears in this repo.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SpondEvent } from '../lib/data'
import { countLinkedResponses, type ResponseCounts } from '../lib/tonight'

// The 11 August event exactly as production holds it: spond_type null,
// four counts adding to an audience of 50.
const AUGUST: SpondEvent = {
  id: 'evt-aug-11',
  title: 'Training',
  startsAt: '2026-08-11T17:00:00Z',
  teamId: null,
  teamName: null,
  spondType: null,
  accepted: 20,
  declined: 24,
  unanswered: 6,
  waiting: 0,
  cancelled: false,
  syncedAt: '2026-08-12T10:36:30Z',
}

// The stored replies for that event, as spond_event_responses holds them:
// 27 rows, every one belonging to a linked member because the foreign key
// makes an unlinked one unrepresentable (0045).
const LINKED_REPLIES = [
  ...Array<string>(10).fill('accepted'),
  ...Array<string>(14).fill('declined'),
  ...Array<string>(3).fill('unanswered'),
]

interface RepliesRead {
  byEvent: Record<string, ResponseCounts>
  available: boolean
}

const state = {
  events: [AUGUST] as SpondEvent[],
  replies: { byEvent: { 'evt-aug-11': countLinkedResponses(LINKED_REPLIES) }, available: true } as RepliesRead,
  repliesLoading: false,
  repliesError: false,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
  ...over,
})

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: new Set(['club.manage', 'players.view']), isPending: false }),
  useEventKindContext: () => ({ teamNames: ['Titans', 'Trojans'] }),
  useSpondEvents: () => query(state.events),
  useSpondEventResponseCounts: () =>
    query(state.replies, { isLoading: state.repliesLoading, isError: state.repliesError }),
  useTeams: () => query([{ id: 'titans', name: 'Titans', bibColour: null }]),
  useRegisteredPlayers: () => query([]),
  useCurrentSeason: () => query({ id: 'season' }),
  useSpondLinks: () => query({ available: true, links: [] }),
  useSpondMappings: () => query([]),
  useSpondSync: () => ({ mutate: () => {}, isPending: false, isError: false, data: null, error: null }),
  useInsertSpondMapping: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
  useDeleteSpondMapping: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
}))

const { AdminSpond } = await import('./AdminSpond')
const html = () => renderToStaticMarkup(<AdminSpond />)

// Three of the API's four words exist nowhere in the product's own
// vocabulary, which says Going, No reply and Not going. Any appearance of
// one is the aggregate leaking back onto the screen.
const API_ONLY_WORDS = ['accepted', 'declined', 'unanswered'] as const

// The fourth is shared: "waiting" is what the product calls that state
// too, so it is checked by what it counts rather than by being absent.
const SHARED_WORD = 'waiting'

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('the admin Spond screen cannot show the event aggregate as a reply split', () => {
  it('renders none of the API-only reply words at all', () => {
    // The requested regression. Checked as raw substrings against the
    // whole rendered markup, so a pill, a caption, an aria label or a
    // title attribute carrying one would fail it.
    const out = html().toLowerCase()
    for (const word of API_ONLY_WORDS) {
      expect(out).not.toContain(word)
    }
  })

  it('renders the one shared reply word exactly once, on the player figure', () => {
    // "Waiting" is the product's own word as well as the API's, so the
    // question is not whether it appears but what it is counting. Once,
    // and against the linked players.
    const out = html()
    expect(occurrences(out.toLowerCase(), SHARED_WORD)).toBe(1)
    expect(out).toContain('<b>0</b> waiting')
  })

  it('renders none of the aggregate figures as a count', () => {
    // 20, 24 and 6 are the event's own counts. The only figure from that
    // row of four that may appear is the audience total they sum to.
    const out = html()
    for (const n of ['20', '24', '6']) {
      expect(out).not.toContain(`<b>${n}</b>`)
    }
  })

  it('states the audience as one headcount instead', () => {
    expect(html()).toContain('Spond audience: 50 people invited')
  })
})

describe('the reply words appear only against the club s own children', () => {
  it('splits the linked players by what their parents said', () => {
    // 10 / 3 / 14 / 0, from spond_event_responses, which holds a row only
    // for a linked member. These are the figures a coach may read as
    // players, because they are players.
    const out = html()
    expect(out).toContain('Linked players (27)')
    expect(out).toContain('<b>10</b> going')
    expect(out).toContain('<b>3</b> no reply')
    expect(out).toContain('<b>14</b> not going')
    expect(out).toContain('<b>0</b> waiting')
  })

  it('never lets an aggregate figure reach one of those words', () => {
    // The whole defect in one assertion: the audience's 20 and 24 must
    // not be what "going" and "not going" are counting.
    const out = html()
    expect(out).not.toContain('<b>20</b> going')
    expect(out).not.toContain('<b>24</b> not going')
  })

  it('sends a coach to Session day for the night itself', () => {
    // These counts have no session and therefore no covered squad to
    // narrow by, which is a different population from Tonight's chips.
    // The card says where the operational figures are.
    expect(html()).toContain('Session day')
  })
})

describe('a population that cannot be established is not invented', () => {
  const withReplies = (
    replies: RepliesRead,
    over: Partial<Pick<typeof state, 'repliesLoading' | 'repliesError'>> = {},
  ) => {
    const before = { ...state }
    Object.assign(state, { replies, ...over })
    try {
      return html()
    } finally {
      Object.assign(state, before)
    }
  }

  it('says nothing about players when 0045 has not been applied', () => {
    const out = withReplies({ byEvent: {}, available: false })
    expect(out).not.toContain('Linked players')
    expect(out).toContain('Spond audience: 50 people invited')
  })

  it('says nothing about players while the read is still in flight', () => {
    const out = withReplies(state.replies, { repliesLoading: true })
    expect(out).not.toContain('Linked players')
  })

  it('says nothing about players when the read failed', () => {
    const out = withReplies(state.replies, { repliesError: true })
    expect(out).not.toContain('Linked players')
  })

  it('says so plainly for an event no linked child replied to', () => {
    // Available and settled, but this event has no rows: a real state,
    // and different from an unknown one. Zero is only ever printed when
    // zero is actually known.
    const out = withReplies({ byEvent: {}, available: true })
    expect(out).toContain('No linked player has replied to this event.')
    expect(out).not.toContain('Linked players (0)')
  })
})
