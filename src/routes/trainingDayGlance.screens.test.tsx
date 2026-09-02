// =====================================================================
// TRAIN-01: the session day Players & groups preview, rendered.
//
// WHAT A COACH ASKS IT. Standing in the car park with a phone: "who have I
// put in, and what bib does each of them need?". The answer used to be one
// tap away behind the editing screen; it is now on the card.
//
// WHY THE REAL CONTAINER. TonightCard IS the session day container for this
// feature: it holds the players.view gate, issues the four gated reads and
// composes the register into groups. A pure helper test would prove the
// model and say nothing about any of that, and this repo has twice shipped a
// green seam with a screen that ignored it. SessionDay's own job is only to
// place the card, which lib/tonight.invariant.test.ts already pins.
//
// THE POPULATION IS `included_in_groups`, NEVER `present`. The fixture below
// carries a child who is present and NOT included, and one who is included
// and NOT present, precisely so swapping the two fails here. They are
// different facts and the whole 0047 migration exists because they were once
// one column.
//
// Every name is synthetic.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BIB_NONE } from '../lib/bibs'
import type { RegisteredPlayer, Session, Team } from '../lib/data'
import type { RegisterEntry } from '../lib/register'

const AT = '2026-08-15T09:00:00.000Z'

// Titans wear red by default; Trojans have no default at all, which is what
// makes a Trojan guest resolve to No bib without any override.
const TEAMS: Team[] = [
  { id: 't1', name: 'Titans', bibColour: 'red', sortOrder: null },
  { id: 't2', name: 'Trojans', bibColour: null, sortOrder: null },
]

const player = (
  id: string,
  displayName: string,
  teamId: string,
  status: RegisteredPlayer['status'] = 'registered',
): RegisteredPlayer => ({
  registrationId: `reg-${id}`,
  playerId: id,
  seasonId: 'season',
  teamId,
  displayName,
  shirtNumber: null,
  status,
  registeredDate: null,
  createdBy: null,
  updatedAt: AT,
})

const PLAYERS: RegisteredPlayer[] = [
  player('p1', 'Alpha Synthetic', 't1'),
  player('p2', 'Beta Synthetic', 't1'),
  player('p3', 'Gamma Synthetic', 't1'),
  // On Trojans, which this session does not cover: a guest, once an entry
  // puts them on the night.
  player('p4', 'Delta Synthetic', 't2'),
  // Withdrawn since, and kept on the list only by their existing entry.
  player('p5', 'Echo Synthetic', 't1', 'withdrawn'),
]

const entry = (playerId: string, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
  sessionId: 's1',
  playerId,
  present: false,
  includedInGroups: false,
  bibColourOverride: null,
  source: 'roster',
  ...over,
})

// One of every case the roadmap names, in one fixture.
const ENTRIES: RegisterEntry[] = [
  // Inherits the Titans default.
  entry('p1', { includedInGroups: true }),
  // Override beats the team default.
  entry('p2', { includedInGroups: true, bibColourOverride: 'blue' }),
  // HERE BUT NOT IN A GROUP. Turned up, not in tonight's split. Must not
  // appear: this is the row that fails if inclusion is read as attendance.
  entry('p3', { includedInGroups: false, present: true }),
  // A guest, on a team with no default colour.
  entry('p4', { includedInGroups: true, source: 'manual' }),
  // Explicitly no bib, and a withdrawn registration held on by this row.
  entry('p5', { includedInGroups: true, bibColourOverride: BIB_NONE }),
]

const SESSION: Session = {
  id: 's1',
  name: 'Titans Saturday',
  date: '2026-08-15',
  time: '10:00',
  ageGroup: '',
  venue: '',
  focus: '',
  status: 'upcoming',
  activities: [],
  coachId: 'coach-1',
  teamId: null,
  // Titans only, so a Trojan on the list is a guest.
  teamIds: ['t1'],
  venueId: null,
  intentions: [],
  space: '',
  sourceUrl: '',
  sourceLabel: '',
  programmeId: null,
  programmeWeek: null,
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  // No Spond event: the club that has configured nothing is the default
  // case, not the exception.
  spondEventId: null,
  boardId: null,
  rights: 'internal_only',
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

const mutation = () => ({
  mutate: () => {},
  mutateAsync: async () => ({}),
  isPending: false,
  isError: false,
  data: null,
  error: null,
  reset: () => {},
})

// Every read the card issues, and whether it was ENABLED. The privacy claim
// is not only "no name in the markup": it is that a viewer without
// players.view never asks for one.
const asked: Record<string, boolean[]> = {}
const record = (name: string, enabled: boolean) => {
  ;(asked[name] ??= []).push(enabled)
}
const resetAsked = () => {
  for (const k of Object.keys(asked)) delete asked[k]
}

const state = {
  caps: new Set(['sessions.create', 'players.view']),
  session: SESSION,
  entries: ENTRIES,
  players: PLAYERS,
  rsvp: query({}) as unknown,
}

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'coach-1' }, profile: null }) }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 's1' }),
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useTeams: () => query(TEAMS),
  useCurrentSeason: (enabled = true) => {
    record('season', enabled)
    return query(enabled ? { id: 'season' } : undefined)
  },
  useRegisteredPlayers: (_seasonId: string | null, enabled = true) => {
    record('players', enabled)
    return query(enabled ? state.players : undefined)
  },
  useRegisterEntries: (_sessionId: string | undefined, enabled = true) => {
    record('register', enabled)
    return query(enabled ? state.entries : undefined)
  },
  useSessionSpondRsvp: (_s: string | undefined, _e: string | null, enabled = true) => {
    record('rsvp', enabled)
    return state.rsvp
  },
  useSpondLinks: () => query({ available: true, links: [] }),
  useSpondEvents: () => query([]),
  useSession: () => query(state.session),
  useSpondSync: () => mutation(),
  useSaveTonight: () => mutation(),
  useLinkSessionSpondEvent: () => mutation(),
  useEventKindContext: () => ({ spondEvents: () => undefined, teamNames: ['Titans', 'Trojans'] }),
  useMediaMap: () => ({}),
  useMediaSrc: () => null,
}))

const { TonightCard } = await import('./SessionRegister')

const html = () => {
  resetAsked()
  return renderToStaticMarkup(<TonightCard session={state.session} />)
}

// Render with one part of the world changed, then put it back.
function withState<T>(over: Partial<typeof state>, run: () => T): T {
  const was = { ...state }
  Object.assign(state, over)
  try {
    return run()
  } finally {
    Object.assign(state, was)
  }
}

// The group cards, in render order, each as its heading text plus its names.
function groups(markup: string): { label: string; names: string; count: string }[] {
  // Split on the group container's exact opening tag. `tn-group-head` does
  // not match it (the quote is part of the needle), so each chunk is one
  // whole group card.
  return markup
    .split('<div class="tn-group">')
    .slice(1)
    .map((block) => ({
      label: /<b>([^<]*)<\/b>/.exec(block)?.[1] ?? '',
      names: /<div class="tn-group-names">([^<]*)/.exec(block)?.[1] ?? '',
      count: /<span class="tn-group-count">([^<]*)/.exec(block)?.[1] ?? '',
    }))
}

describe('the players and bibs a coach needs at a glance', () => {
  it('shows every included player under the bib colour they actually need', () => {
    const out = groups(html())
    expect(out).toEqual([
      // Inherited from the Titans default.
      { label: 'Red bibs', names: 'Alpha Synthetic', count: '1' },
      // The override, which beats that default.
      { label: 'Blue bibs', names: 'Beta Synthetic', count: '1' },
      // Explicit none, and a team with no default: one group, two reasons.
      { label: 'No bibs', names: 'Echo Synthetic, Delta Synthetic', count: '2' },
    ])
  })

  it('leaves out a player who is not in the groups, even one who is here', () => {
    // THE SEMANTIC GUARD. Gamma is present and not included. Reading the
    // population off `present` puts them on this card.
    const out = html()
    expect(out).not.toContain('Gamma Synthetic')
    expect(groups(out).map((g) => g.names).join(' ')).not.toContain('Gamma')
  })

  it('shows a player who is included but has not arrived', () => {
    // The other direction: every child in the fixture's groups has
    // present false, so a card built from attendance would be empty.
    expect(html()).toContain('Alpha Synthetic')
  })

  it('names the colour in words, so nothing depends on telling red from green', () => {
    const out = html()
    expect(out).toContain('<b>Red bibs</b>')
    expect(out).toContain('<b>Blue bibs</b>')
    expect(out).toContain('<b>No bibs</b>')
    // The swatch is decoration and says so.
    expect(out).toMatch(/<span class="reg-swatch"[^>]*aria-hidden="true"/)
  })

  it('keeps the team beside a group that mixes two of them', () => {
    // Echo is a Titan, Delta a Trojan, and they wear the same nothing.
    expect(html()).toContain('Titans · Trojans')
  })

  it('counts each group', () => {
    expect(html()).toContain('<span class="tn-group-count">2</span>')
  })

  it('lists a guest with the same group and bib rules as anybody else', () => {
    expect(html()).toContain('Delta Synthetic')
  })

  it('keeps a withdrawn player their existing entry holds on the list', () => {
    expect(html()).toContain('Echo Synthetic')
  })

  it('still opens the editing screen from the card above it', () => {
    const out = html()
    expect(out).toContain('Players &amp; groups')
    expect(out).toContain('reg-card')
  })

  it('writes nothing: the preview is a projection, with no control on it', () => {
    // No select, no pressed state, no save. The only button is the card
    // itself, which navigates.
    const out = html()
    expect(out).not.toContain('<select')
    expect(out).not.toContain('aria-pressed')
    expect(out).not.toContain('Save groups')
    expect(out.match(/<button/g)).toHaveLength(1)
  })
})

describe('a club that has configured no Spond at all', () => {
  it('renders the whole overview from the register alone', () => {
    // SESSION carries no spondEventId and the reply map is empty. This is
    // the default state of the club, and nothing above depends on Spond.
    expect(state.session.spondEventId).toBeNull()
    expect(groups(html())).toHaveLength(3)
  })

  it('is unmoved by a reply read that failed', () => {
    withState({ rsvp: query(undefined, { isError: true }) }, () => {
      expect(groups(html())).toHaveLength(3)
      expect(html()).toContain('Alpha Synthetic')
    })
  })

  it('is unmoved by a reply read still in flight', () => {
    withState({ rsvp: query(undefined, { isLoading: true }) }, () => {
      expect(groups(html())).toHaveLength(3)
    })
  })
})

describe('the nights with nothing to show', () => {
  it('keeps the coverage sentence when the session has no teams', () => {
    const noTeams = { ...SESSION, teamIds: [] as string[] }
    withState({ session: noTeams }, () => {
      const out = html()
      expect(out).toContain('No teams set, so nobody is listed yet')
      expect(groups(out)).toEqual([])
    })
  })

  it('says the covered teams hold nobody, rather than inventing players', () => {
    withState({ players: [], entries: [] }, () => {
      const out = html()
      expect(out).toContain('No registered players are on the teams this session covers.')
      expect(groups(out)).toEqual([])
    })
  })

  it('says nobody is selected when the squad is there and unpicked', () => {
    withState({ entries: [] }, () => {
      const out = html()
      expect(out).toContain('Nobody selected yet.')
      expect(out).toContain('Not started')
      expect(groups(out)).toEqual([])
    })
  })

  it('does not call an empty squad not started, which it never was', () => {
    withState({ players: [], entries: [] }, () => {
      expect(html()).not.toContain('Not started')
    })
  })
})

describe('who may see a child s name and bib', () => {
  it('shows the overview to a holder of players.view', () => {
    expect(asked).toBeDefined()
    const out = html()
    expect(out).toContain('Alpha Synthetic')
    expect(asked.register).toEqual([true])
    expect(asked.players).toEqual([true])
  })

  it('shows a parent nothing at all: no names, no bibs, no card', () => {
    // A parent holds no players.view. The card renders nothing, so there is
    // no name and no bib allocation to leak.
    withState({ caps: new Set(['sessions.view']) }, () => {
      const out = html()
      expect(out).toBe('')
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo']) {
        expect(out).not.toContain(name)
      }
      expect(out).not.toContain('bibs')
    })
  })

  it('issues no player or register read for a parent, rather than reading and hiding', () => {
    // The stronger half of the claim. The names never arrive in the client
    // at all, which is what the enabled flag on each read is for.
    withState({ caps: new Set(['sessions.view']) }, () => {
      html()
      expect(asked.register).toEqual([false])
      expect(asked.players).toEqual([false])
      expect(asked.season).toEqual([false])
      expect(asked.rsvp).toEqual([false])
    })
  })
})
