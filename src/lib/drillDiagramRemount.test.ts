// A passive diagram is read once, not once per mount.
//
// The defect a review of #189 found: useDrillDiagram set no staleTime, so
// TanStack marked every result stale the instant it arrived and refetched
// whenever a consumer mounted. Collapsing and reopening a planner panel
// repeated the Supabase read, and leaving Session Day's Setup tab and coming
// back remounted every card, repeating one read PER DRILL, despite the shared
// cache and the stated fetch-once intent.
//
// THIS TESTS THE REAL OPTIONS, THROUGH THE REAL MACHINERY. drillDiagramQuery is
// what useDrillDiagram hands to useQuery, and QueryObserver is what useQuery
// sits on: subscribing is a mount and unsubscribing is an unmount, and the
// mount-time refetch decision under test is the same one React would make.
// Only queryFn is replaced, by a counter, so nothing here touches Supabase.
//
// It also pins the half that MUST NOT change: an explicit invalidation after a
// save still refetches. A staleTime that bought quiet by making a saved diagram
// take five minutes to appear would be a worse defect than the one it fixed.
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { DRILL_DIAGRAM_STALE, drillDiagramQuery } from './queries'
import { DRILL_DIAGRAM_VERSION, type DrillDiagram } from './drillDiagram'

const diagram: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'full_pitch', orientation: 'portrait' },
  elements: [{ type: 'ball', id: 'ball-1', x: 0.5, y: 0.5 }],
}

// Let the query machinery's promises and timers settle. Several turns, because
// a fetch resolves through more than one microtask.
async function settle() {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0))
}

function harness(id = 'drill-1') {
  const client = new QueryClient()
  const reads = vi.fn(async () => diagram)
  // The REAL options, with only the network end replaced.
  const options = { ...drillDiagramQuery(id), queryFn: reads }
  // Subscribe is mount, the returned function is unmount.
  const mount = () => new QueryObserver(client, options).subscribe(() => {})
  return { client, reads, mount, key: drillDiagramQuery(id).queryKey }
}

describe('a diagram a session merely shows', () => {
  it('is read once across a mount, an unmount and a remount', async () => {
    const { reads, mount } = harness()

    const first = mount()
    await settle()
    expect(reads).toHaveBeenCalledTimes(1)

    // The planner panel collapses, or Session Day leaves the Setup tab.
    first()
    await settle()

    // And it comes back. Before the fix this was a second request.
    const second = mount()
    await settle()
    expect(reads).toHaveBeenCalledTimes(1)

    second()
  })

  it('is still read once when a session shows the same drill on several cards', async () => {
    // Two activities on one drill, mounted together: TanStack dedupes them
    // under the shared per-drill key, which is the cache shape #189 chose and
    // this change does not touch.
    const { reads, mount } = harness()
    const a = mount()
    const b = mount()
    await settle()
    expect(reads).toHaveBeenCalledTimes(1)
    a()
    b()
  })

  it('reads each drill separately, so the per-drill cache shape still holds', async () => {
    // No batch query was introduced. Two drills are two reads under two keys.
    const one = harness('drill-1')
    const two = harness('drill-2')
    expect(one.key).toEqual(['drill_diagram', 'drill-1'])
    expect(two.key).toEqual(['drill_diagram', 'drill-2'])
    const a = one.mount()
    const b = two.mount()
    await settle()
    expect(one.reads).toHaveBeenCalledTimes(1)
    expect(two.reads).toHaveBeenCalledTimes(1)
    a()
    b()
  })
})

describe('the save path is untouched by the quiet', () => {
  it('refetches on the next mount after an explicit invalidation', async () => {
    const { client, reads, mount, key } = harness()

    const first = mount()
    await settle()
    expect(reads).toHaveBeenCalledTimes(1)
    first()

    // What useUpdateDrillDiagram does in onSettled, with nothing mounted:
    // Drill Maker saved, then the coach walked back to the session.
    await client.invalidateQueries({ queryKey: key })
    await settle()

    const second = mount()
    await settle()
    // An invalidated query refetches on mount whatever its staleTime says, so
    // the coach sees the drawing they just saved rather than the old one.
    expect(reads).toHaveBeenCalledTimes(2)
    second()
  })

  it('refetches immediately for a consumer that is already watching', async () => {
    // The other half of a save: a screen showing the diagram while Drill Maker
    // is open in another tab, or the editor's own read.
    const { client, reads, mount, key } = harness()
    const watching = mount()
    await settle()
    expect(reads).toHaveBeenCalledTimes(1)

    await client.invalidateQueries({ queryKey: key })
    await settle()
    expect(reads).toHaveBeenCalledTimes(2)

    watching()
  })
})

describe('the options say what they mean', () => {
  it('carries a stale window that is actually a window', () => {
    // Zero is the default and is the defect; the value is asserted as
    // meaningful rather than merely present.
    expect(DRILL_DIAGRAM_STALE).toBeGreaterThan(0)
    expect(drillDiagramQuery('drill-1').staleTime).toBe(DRILL_DIAGRAM_STALE)
  })

  it('keeps the rest of the read exactly as it was', () => {
    // The staleTime is the only thing that changed. retry:false still holds,
    // because the failure worth naming is migration 0046 being unapplied and no
    // retry fixes that, and an absent id still disables the read.
    const q = drillDiagramQuery('drill-1')
    expect(q.retry).toBe(false)
    expect(q.enabled).toBe(true)
    expect(drillDiagramQuery(undefined).enabled).toBe(false)
  })
})
