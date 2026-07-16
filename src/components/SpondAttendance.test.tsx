import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpondAttendanceCard } from './SpondAttendance'
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
