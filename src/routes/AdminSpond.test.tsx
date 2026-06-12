import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SyncReport } from './AdminSpond'
import type { SpondSyncResult } from '../lib/queries'

// SyncReport is presentational, so the static renderer covers it without a
// DOM or a query client, the same style as the rest of the suite. The
// mapping of the spond-sync response body into SpondSyncResult lives in
// useSpondSync; this pins how a run's outcomes read on screen.

const result: SpondSyncResult = {
  ok: false,
  message: '',
  window: { from: '2026-05-29T00:00:00.000Z', to: '2026-09-10T00:00:00.000Z' },
  outcomes: [
    {
      id: 'mapping-1',
      name: 'U8 Tigers',
      status: 'synced',
      events: 12,
      warnings: [],
      error: '',
    },
    {
      id: 'mapping-2',
      name: 'U10 Lions',
      status: 'failed',
      events: 0,
      warnings: [
        'This group hit the cap of 100 events; later events in the window were not synced.',
        '2 events were already synced by an earlier mapping this run.',
      ],
      error: 'Could not write the synced events. Check your access and try again.',
    },
  ],
  eventsTotal: 12,
  stopped: '',
}

function render(r: SpondSyncResult): string {
  return renderToStaticMarkup(<SyncReport result={r} />)
}

describe('SyncReport', () => {
  it('reports each mapping by name with its status and event count', () => {
    const html = render(result)
    expect(html).toContain('U8 Tigers')
    expect(html).toContain('Synced')
    expect(html).toContain('12 events')
    expect(html).toContain('U10 Lions')
    expect(html).toContain('Failed')
    expect(html).toContain('0 events')
  })

  it('shows the failed mapping error text and every warning verbatim', () => {
    const html = render(result)
    expect(html).toContain('Could not write the synced events. Check your access and try again.')
    expect(html).toContain('This group hit the cap of 100 events; later events in the window were not synced.')
    expect(html).toContain('2 events were already synced by an earlier mapping this run.')
  })

  it('totals the run and names the sync window', () => {
    const html = render(result)
    expect(html).toContain('12 events synced')
    expect(html).toContain('window')
  })

  it('surfaces an early stop and the no mappings message', () => {
    expect(render({ ...result, stopped: 'Sync stopped: Spond returned HTTP 429. Try again later.' })).toContain(
      'Sync stopped: Spond returned HTTP 429. Try again later.',
    )
    expect(
      render({
        ...result,
        outcomes: [],
        window: null,
        message: 'No Spond groups are mapped yet. An admin adds the first mapping.',
      }),
    ).toContain('No Spond groups are mapped yet.')
  })
})
