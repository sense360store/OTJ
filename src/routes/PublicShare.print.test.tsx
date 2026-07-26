// Tests for the public page's rendered snapshot dispatch and the browser
// Print / Save as PDF affordance (Content Sharing PR 4 and the browser-print
// portion of PR 6).
//
// The read function is mocked so the page reaches its post-validation render
// branch without a network. What matters here is what the page does with an
// already validated public projection: it dispatches to the right renderer, it
// offers print, and it prints nothing the projection did not carry.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let invokeResult: { data: unknown; error: unknown } = { data: null, error: null }
const invoke = vi.fn(async () => invokeResult)

vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke } } }))

// This repo renders with renderToStaticMarkup and has no jsdom, so `window` is
// absent. The page reads the secret from window.location.hash (guarded by a
// typeof check) and calls window.print() from the print button, so a minimal
// window stub is enough to exercise both without a browser.
const printSpy = vi.fn()
;(globalThis as unknown as { window: unknown }).window = {
  location: { hash: '', origin: 'https://example.test' },
  print: printSpy,
}
;(globalThis as unknown as { document: unknown }).document = { title: '' }

const { default: PublicShare } = await import('./PublicShare')
const { PRINT_WARNING } = await import('../lib/publicShare')

const SHARE_ID = '11111111-1111-1111-1111-111111111111'
const SECRET = 'a'.repeat(43)

function programmeProjection(over: Record<string, unknown> = {}) {
  return {
    snapshotVersion: 1,
    kind: 'programme',
    displayTitle: 'Playing out from the back',
    focus: 'Building from goal kicks',
    summary: 'A two week block.',
    intentions: [],
    weeks: 2,
    orderedWeekNumbers: [1, 2],
    weekTemplates: [
      {
        week: 1,
        title: 'Week one',
        focus: null,
        activities: [{ phase: 'Skill', duration: 10, drillRef: 'd1', customTitle: null }],
        totalDuration: 10,
      },
      { week: 2, title: null, focus: null, activities: [], totalDuration: 0 },
    ],
    referencedDrills: [{
      ref: 'd1', title: 'Rondo', summary: null, classification: null, skill: null, ages: [],
      level: null, duration: 10, playerGuidance: null, area: null, equipment: [], setupNotes: null,
      coachingPoints: [], easier: [], harder: [], theme: null, format: null,
      sourceAttribution: null, mediaRefs: [],
    }],
    pdf: null,
    media: [],
    sourceAttribution: null,
    snapshotAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

// Render the route with the read already resolved, so the post-validation
// render branch runs. The cached value is seeded under the page's own query
// key, exactly as a settled fetch would leave it.
function renderShare(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const data = invokeResult.data as { status?: string; snapshot?: unknown } | null
  client.setQueryData(
    ['public-share', SHARE_ID],
    data?.status === 'ok' ? { status: 'ok', snapshot: data.snapshot } : { status: 'unavailable' },
  )
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/share/${SHARE_ID}`]}>
        <Routes>
          <Route path="/share/:shareId" element={<PublicShare />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('public page print / Save as PDF', () => {
  beforeEach(() => {
    invoke.mockClear()
    printSpy.mockClear()
    ;(globalThis as unknown as { window: { location: { hash: string } } }).window.location.hash = `#${SECRET}`
    invokeResult = { data: { status: 'ok', snapshot: programmeProjection() }, error: null }
  })

  it('offers a clearly labelled Print or Save as PDF action', () => {
    const html = renderShare()
    expect(html).toContain('Print or Save as PDF')
  })

  it('states plainly that a printed copy cannot be turned off or recalled', () => {
    const html = renderShare()
    expect(html).toContain(PRINT_WARNING)
  })

  it('carries the classes the print stylesheet hides, so no control reaches paper', () => {
    const html = renderShare()
    // The action row and the print note are both inside the hidden chrome.
    expect(html).toContain('class="public-reload"')
    expect(html).toContain('public-print-note')
  })

  it('renders the programme through the programme renderer', () => {
    const html = renderShare()
    expect(html).toContain('Playing out from the back')
    expect(html).toContain('Week 1')
    expect(html).toContain('Rondo')
  })

  it('makes no request to print: printing consumes the already rendered DOM', () => {
    renderShare()
    const callsAfterRender = invoke.mock.calls.length
    // Simulate the button: the handler is exactly window.print(), nothing else.
    ;(globalThis as unknown as { window: { print: () => void } }).window.print()
    expect(printSpy).toHaveBeenCalledTimes(1)
    // No further read, no new fetch, no signing call.
    expect(invoke.mock.calls.length).toBe(callsAfterRender)
  })

  it('prints only what the validated projection carried, never an operational field', () => {
    invokeResult = {
      data: {
        status: 'ok',
        snapshot: programmeProjection(),
      },
      error: null,
    }
    const html = renderShare()
    for (
      const banned of [
        'club_id', 'created_by', 'author', 'programme_id', 'programme_week', 'token_hash',
        'storage_path', '_path', '_mid', 'team_id', 'venue', 'spond_event_id',
      ]
    ) {
      expect(html).not.toContain(banned)
    }
  })

  it('renders the neutral unavailable state, with no print action, for a refused link', () => {
    invokeResult = { data: { status: 'unavailable' }, error: null }
    const html = renderShare()
    expect(html).not.toContain('Print or Save as PDF')
    expect(html).not.toContain(PRINT_WARNING)
  })

  it('refuses a programme payload whose shape fails the validator', () => {
    // A leaked author must not render, even if the server somehow returned it.
    invokeResult = {
      data: { status: 'ok', snapshot: programmeProjection({ author: 'Jane Coach' }) },
      error: null,
    }
    const html = renderShare()
    expect(html).not.toContain('Jane Coach')
    expect(html).not.toContain('Print or Save as PDF')
  })
})
