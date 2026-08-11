import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpondAttendanceCard } from './SpondAttendance'
import { pickerEvents } from '../lib/spond'
import type { SpondEvent } from '../lib/data'

// SpondAttendanceCard reads the synced events through useSpondEvents, so the
// static renderer wraps it in a QueryClientProvider. renderToStaticMarkup runs
// no effects, so the query never fetches; seeding the cache with setQueryData
// gives the linked state its event without a network call. busy is the freeze
// flag the planner passes while a write is in flight: linking or unlinking
// edits the draft, so both controls must disable.

const noop = () => {}

function ev(over: Partial<SpondEvent> & Pick<SpondEvent, 'id'>): SpondEvent {
  return {
    title: 'U8 Training',
    startsAt: '2026-06-16T17:30:00Z',
    teamId: 'team-1',
    teamName: 'Titans',
    spondType: null,
    accepted: 9,
    declined: 2,
    unanswered: 1,
    waiting: 0,
    cancelled: false,
    syncedAt: '2026-06-13T12:00:00Z',
    ...over,
  }
}

function render(over: Partial<Parameters<typeof SpondAttendanceCard>[0]> = {}, events?: SpondEvent[]): string {
  const client = new QueryClient()
  if (events) client.setQueryData(['spond_events'], events)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SpondAttendanceCard
        spondEventId={null}
        teamId={null}
        date="2026-06-10"
        time="17:30"
        canEdit
        onLink={noop}
        {...over}
      />
    </QueryClientProvider>,
  )
}

describe('SpondAttendanceCard freeze', () => {
  it('freezes the Link Spond event control while a write is pending', () => {
    const html = render({ busy: true })
    expect(html).toContain('Link Spond event')
    // The linking affordance is disabled, so the draft cannot gain a Spond
    // link under an in-flight save.
    expect(/<button[^>]*disabled/.test(html)).toBe(true)
  })

  it('leaves the Link Spond event control live when idle', () => {
    const html = render({ busy: false })
    expect(html).toContain('Link Spond event')
    expect(/<button[^>]*disabled/.test(html)).toBe(false)
  })

  it('freezes the Unlink control on a linked event while a write is pending', () => {
    const html = render({ busy: true, spondEventId: 'e1' }, [ev({ id: 'e1' })])
    const unlinkTag = html.match(/<button\b[^>]*>[\s\S]*?Unlink/)?.[0] ?? ''
    expect(unlinkTag).toContain('disabled')
  })

  it('leaves the Unlink control live on a linked event when idle', () => {
    const html = render({ busy: false, spondEventId: 'e1' }, [ev({ id: 'e1' })])
    const unlinkTag = html.match(/<button\b[^>]*>[\s\S]*?Unlink/)?.[0] ?? ''
    expect(unlinkTag).not.toContain('disabled')
  })
})

// ---- The picker's own rule, out where a test can reach it ----------------
//
// The picker renders inside a modal that opens on a tap, and this project
// has no DOM, so its filtering used to be unreachable: an adversarial
// review changed it to `matchesEventKind(e, 'all')` and the whole suite
// stayed green while the Training chip rendered pressed over a list of
// fixtures. pickerEvents is that rule as a pure function.

describe('pickerEvents', () => {
  const training = ev({ id: 'p-train', title: 'Titans Tuesday', startsAt: '2026-06-16T17:30:00Z' })
  const match = ev({
    id: 'p-match',
    title: 'U8 v Horbury',
    spondType: 'MATCH',
    startsAt: '2026-06-17T10:00:00Z',
  })
  const otherTeam = ev({
    id: 'p-other',
    title: 'Trojans Thursday',
    teamId: 'team-2',
    startsAt: '2026-06-18T17:30:00Z',
  })
  const all = [training, match, otherTeam]
  const base = { showAll: false, teamId: 'team-1', date: '2026-06-16', time: '17:30' }
  const ids = (rows: SpondEvent[]) => rows.map((r) => r.id)

  it('lists training only under the default kind', () => {
    expect(ids(pickerEvents(all, { ...base, kind: 'training' }))).toEqual(['p-train'])
  })

  it('brings the match back under All events', () => {
    expect(ids(pickerEvents(all, { ...base, kind: 'all' }))).toEqual(['p-train', 'p-match'])
  })

  it('keeps team a narrowing within the kind', () => {
    // Widening to all club events adds the other team's training and still
    // no fixture: changing team changed the team and nothing else.
    expect(ids(pickerEvents(all, { ...base, kind: 'training', showAll: true }))).toEqual(['p-train', 'p-other'])
  })

  it('orders by closeness to the session, not by the filter', () => {
    const out = pickerEvents(all, { ...base, kind: 'all', showAll: true, date: '2026-06-18', time: '17:30' })
    expect(out[0].id).toBe('p-other')
  })
})
