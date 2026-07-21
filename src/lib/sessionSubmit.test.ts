import { describe, expect, it, vi } from 'vitest'
import {
  createGuardedSubmit,
  createPlannerActions,
  plannerBusy,
  sessionBaseline,
  sessionDirty,
  shareDecision,
  stableCreateId,
} from './sessionSubmit'
import type { PlannerAction, PlannerActionCallbacks } from './sessionSubmit'
import type { Session } from './data'

// Behavioural coverage of the submit seam with controlled deferred promises:
// the write resolves or rejects exactly when the test says so, so ordering
// claims (no navigation before resolution, no success step after a failure)
// are proven rather than timed.

function deferred<R>() {
  let resolve!: (value: R) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<R>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Monday training',
    date: '2026-06-10',
    time: '17:30',
    ageGroup: 'U8s',
    venue: 'Springmill 3G',
    focus: 'Passing',
    status: 'upcoming',
    activities: [],
    coachId: 'coach1',
    teamId: null,
    intentions: [],
    space: '',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    spondEventId: null,
    boardId: null,
    ...over,
  }
}

// A planner actions harness around one controllable upsert per attempt.
function plannerHarness() {
  const pendings: (PlannerAction | null)[] = []
  const failures: PlannerAction[] = []
  const shares: Array<{ saved: Session; draft: Session }> = []
  const waiting: Array<ReturnType<typeof deferred<Session>>> = []
  const upsert = vi.fn((draft: Session) => {
    const d = deferred<Session>()
    waiting.push(d)
    return d.promise.then(() => draft)
  })
  const cb: PlannerActionCallbacks = {
    upsert,
    navSessions: vi.fn(),
    navLive: vi.fn(),
    shareSaved: (saved, draft) => shares.push({ saved, draft }),
    onPending: (a) => pendings.push(a),
    onFailure: (a) => failures.push(a),
  }
  return { actions: createPlannerActions(cb), cb, upsert, waiting, pendings, failures, shares }
}

// Lets promise callbacks queued by a resolve or reject run.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('planner save', () => {
  it('does not navigate before the write resolves, then navigates to sessions on success', async () => {
    const h = plannerHarness()
    const done = h.actions.save(session())
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    expect(h.pendings).toEqual(['save'])
    h.waiting[0].resolve(session())
    await done
    expect(h.cb.navSessions).toHaveBeenCalledTimes(1)
    expect(h.pendings).toEqual(['save', null])
  })

  it('stays put on failure: no navigation, pending cleared, the failure reported', async () => {
    const h = plannerHarness()
    const done = h.actions.save(session())
    h.waiting[0].reject(new Error('network down'))
    await done
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    expect(h.cb.navLive).not.toHaveBeenCalled()
    expect(h.failures).toEqual(['save'])
    expect(h.pendings).toEqual(['save', null])
  })

  it('never mutates the draft it submits, so a failed write leaves the visible draft unchanged', async () => {
    // With editing frozen during a pending write, the visible draft is the one
    // submitted. Prove the seam does not alter it: after a failure the draft
    // object is byte-for-byte unchanged and is exactly what a retry resubmits,
    // so nothing the failed attempt captured can displace the coach's draft.
    const h = plannerHarness()
    const draft = session({ name: 'Monday training' })
    const before = JSON.stringify(draft)
    const done = h.actions.save(draft)
    h.waiting[0].reject(new Error('network down'))
    await done
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    expect(JSON.stringify(draft)).toBe(before)
    const retry = h.actions.save(draft)
    h.waiting[1].resolve(session())
    await retry
    expect(h.upsert.mock.calls[1][0]).toBe(draft)
  })

  it('submits the draft it is given, so a retry after edits carries the latest draft', async () => {
    const h = plannerHarness()
    const first = h.actions.save(session({ name: 'Before the edit' }))
    h.waiting[0].reject(new Error('boom'))
    await first
    const second = h.actions.save(session({ name: 'After the edit' }))
    h.waiting[1].resolve(session())
    await second
    expect(h.upsert).toHaveBeenCalledTimes(2)
    expect(h.upsert.mock.calls[0][0].name).toBe('Before the edit')
    expect(h.upsert.mock.calls[1][0].name).toBe('After the edit')
    expect(h.cb.navSessions).toHaveBeenCalledTimes(1)
  })

  it('ignores rapid repeated clicks while an attempt is in flight: one write only', async () => {
    const h = plannerHarness()
    const first = h.actions.save(session())
    void h.actions.save(session())
    void h.actions.save(session())
    expect(h.upsert).toHaveBeenCalledTimes(1)
    h.waiting[0].resolve(session())
    await first
    await flush()
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.cb.navSessions).toHaveBeenCalledTimes(1)
  })

  it('blocks Start while a Save is in flight; the shared guard serialises the two actions', async () => {
    const h = plannerHarness()
    const first = h.actions.save(session())
    void h.actions.start(session(), false)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    h.waiting[0].resolve(session())
    await first
    expect(h.cb.navLive).not.toHaveBeenCalled()
  })
})

describe('planner start', () => {
  it('does not open the live view before the save resolves', async () => {
    const h = plannerHarness()
    const done = h.actions.start(session(), false)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.cb.navLive).not.toHaveBeenCalled()
    h.waiting[0].resolve(session())
    await done
    expect(h.cb.navLive).toHaveBeenCalledWith('s1')
    expect(h.cb.navSessions).not.toHaveBeenCalled()
  })

  it('never opens the live view from a failed save, and a retry works', async () => {
    const h = plannerHarness()
    const first = h.actions.start(session(), false)
    h.waiting[0].reject(new Error('boom'))
    await first
    expect(h.cb.navLive).not.toHaveBeenCalled()
    expect(h.failures).toEqual(['start'])
    const second = h.actions.start(session(), false)
    h.waiting[1].resolve(session())
    await second
    expect(h.cb.navLive).toHaveBeenCalledWith('s1')
  })

  it('navigates to the saved session id returned by the write', async () => {
    const h = plannerHarness()
    const done = h.actions.start(session({ id: 'fresh-id' }), false)
    h.waiting[0].resolve(session())
    await done
    expect(h.cb.navLive).toHaveBeenCalledWith('fresh-id')
  })

  it('never navigates from a write that settles after the editor has gone', async () => {
    const h = plannerHarness()
    const done = h.actions.save(session())
    // The coach leaves the planner while the save is still in flight.
    h.actions.setActive(false)
    h.waiting[0].resolve(session())
    await done
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    // The attempt still settled cleanly: pending cleared, nothing failed.
    expect(h.pendings).toEqual(['save', null])
    expect(h.failures).toEqual([])
  })

  it('read-only Watch live performs no write and navigates straight away', async () => {
    const h = plannerHarness()
    await h.actions.start(session({ id: 's9' }), true)
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.pendings).toEqual([])
    expect(h.cb.navLive).toHaveBeenCalledWith('s9')
  })
})

describe('planner save and share', () => {
  it('does not share before the write resolves, then shares the saved session on success', async () => {
    const h = plannerHarness()
    const done = h.actions.saveAndShare(session({ id: 'saved-1' }))
    expect(h.upsert).toHaveBeenCalledTimes(1)
    // Nothing is shared until the write resolves, so no stale or pre-save data
    // is ever shared.
    expect(h.shares).toEqual([])
    expect(h.pendings).toEqual(['share'])
    h.waiting[0].resolve(session({ id: 'saved-1' }))
    await done
    expect(h.shares.length).toBe(1)
    expect(h.shares[0].saved.id).toBe('saved-1')
    expect(h.pendings).toEqual(['share', null])
    // Save and share does not navigate away like Save or Start.
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    expect(h.cb.navLive).not.toHaveBeenCalled()
  })

  it('produces no share when the save fails', async () => {
    const h = plannerHarness()
    const done = h.actions.saveAndShare(session())
    h.waiting[0].reject(new Error('network down'))
    await done
    expect(h.shares).toEqual([])
    expect(h.failures).toEqual(['share'])
    expect(h.pendings).toEqual(['share', null])
  })

  it('fires one save and one share for a rapid double click', async () => {
    const h = plannerHarness()
    const first = h.actions.saveAndShare(session())
    void h.actions.saveAndShare(session())
    void h.actions.saveAndShare(session())
    expect(h.upsert).toHaveBeenCalledTimes(1)
    h.waiting[0].resolve(session())
    await first
    await flush()
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.shares.length).toBe(1)
  })

  it('does not share from a write that settles after the editor has gone', async () => {
    const h = plannerHarness()
    const done = h.actions.saveAndShare(session())
    // The coach leaves the planner while the save is still in flight.
    h.actions.setActive(false)
    h.waiting[0].resolve(session())
    await done
    expect(h.shares).toEqual([])
    // The write still settled cleanly: pending cleared, nothing failed.
    expect(h.pendings).toEqual(['share', null])
    expect(h.failures).toEqual([])
  })

  it('retries the same session id after a failed save, so no duplicate session is created', async () => {
    const h = plannerHarness()
    const draft = session({ id: 'stable-1' })
    const first = h.actions.saveAndShare(draft)
    h.waiting[0].reject(new Error('boom'))
    await first
    expect(h.shares).toEqual([])
    const retry = h.actions.saveAndShare(draft)
    h.waiting[1].resolve(session({ id: 'stable-1' }))
    await retry
    // Both attempts targeted the same stable id, so a retry updates that row
    // rather than inserting a second session, and the share carries that id.
    expect(h.upsert.mock.calls[0][0].id).toBe('stable-1')
    expect(h.upsert.mock.calls[1][0].id).toBe('stable-1')
    expect(h.shares.length).toBe(1)
    expect(h.shares[0].saved.id).toBe('stable-1')
  })

  it('blocks Save and Start while a Save and share is in flight (shared guard)', async () => {
    const h = plannerHarness()
    const first = h.actions.saveAndShare(session())
    void h.actions.save(session())
    void h.actions.start(session(), false)
    // The one shared guard serialises all three actions.
    expect(h.upsert).toHaveBeenCalledTimes(1)
    h.waiting[0].resolve(session())
    await first
    expect(h.cb.navSessions).not.toHaveBeenCalled()
    expect(h.cb.navLive).not.toHaveBeenCalled()
  })
})

describe('sessionDirty and sessionBaseline', () => {
  it('treats a session with no baseline (never saved) as always dirty', () => {
    expect(sessionBaseline(null)).toBe(null)
    expect(sessionDirty(session(), null)).toBe(true)
  })

  it('reads a freshly cloned session as clean against its baseline', () => {
    const s = session()
    const baseline = sessionBaseline(s)
    const clone = JSON.parse(JSON.stringify(s)) as Session
    expect(sessionDirty(clone, baseline)).toBe(false)
  })

  it('ignores column order: the same content in a different key order is clean', () => {
    const s = session()
    const baseline = sessionBaseline(s)
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as unknown as Session
    expect(sessionDirty(reordered, baseline)).toBe(false)
  })

  it('flags a changed field as dirty', () => {
    const baseline = sessionBaseline(session())
    expect(sessionDirty(session({ name: 'Renamed' }), baseline)).toBe(true)
    expect(sessionDirty(session({ venue: 'Elsewhere' }), baseline)).toBe(true)
  })

  it('flags reordered or removed activities as dirty', () => {
    const a = { phase: 'Skill' as const, drillId: 'd1', duration: 10 }
    const b = { phase: 'Game' as const, drillId: 'd2', duration: 20 }
    const baseline = sessionBaseline(session({ activities: [a, b] }))
    // Same activities, different order.
    expect(sessionDirty(session({ activities: [b, a] }), baseline)).toBe(true)
    // One removed.
    expect(sessionDirty(session({ activities: [a] }), baseline)).toBe(true)
    // Unchanged order is clean.
    expect(sessionDirty(session({ activities: [a, b] }), baseline)).toBe(false)
  })
})

describe('shareDecision', () => {
  it('shares directly, with no write, when the session is saved and clean', () => {
    expect(shareDecision('s1', false)).toBe('direct')
  })

  it('saves first for a never-saved draft (no id)', () => {
    expect(shareDecision(null, false)).toBe('save')
    // Even a "clean" draft with no id cannot share directly: there is no URL.
    expect(shareDecision(null, true)).toBe('save')
  })

  it('saves first for a dirty saved session', () => {
    expect(shareDecision('s1', true)).toBe('save')
  })

  it('flips to a direct share once a saved session reads clean again', () => {
    // The planner advances savedId and baseline after a Save and share, so the
    // same draft then reads clean and the next share needs no second write.
    const draft = session({ id: 'saved-1' })
    // Before any save: new draft with no baseline routes to save.
    expect(shareDecision(null, sessionDirty(draft, null))).toBe('save')
    // After the save advances the baseline and id, the unchanged draft is clean.
    const baseline = sessionBaseline(draft)
    expect(shareDecision('saved-1', sessionDirty(draft, baseline))).toBe('direct')
  })
})

describe('guarded submit (the shape every other session-writing flow uses)', () => {
  it('runs the close-and-navigate step only after the write resolves', async () => {
    const d = deferred<string>()
    const onSuccess = vi.fn()
    const onFailure = vi.fn()
    const guard = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: () => {},
      onSuccess,
      onFailure,
    })
    const done = guard.run(1)
    expect(onSuccess).not.toHaveBeenCalled()
    d.resolve('saved')
    await done
    expect(onSuccess).toHaveBeenCalledWith('saved', 1)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('keeps the flow open on failure: onSuccess never runs, onFailure carries the error', async () => {
    const d = deferred<string>()
    const onSuccess = vi.fn()
    const onFailure = vi.fn()
    const guard = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: () => {},
      onSuccess,
      onFailure,
    })
    const done = guard.run(1)
    const boom = new Error('boom')
    d.reject(boom)
    await done
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledWith(boom, 1)
  })

  it('brackets each attempt with pending true then false, before the outcome callback', async () => {
    const order: string[] = []
    const d = deferred<string>()
    const guard = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: (p) => order.push(`pending:${p}`),
      onSuccess: () => order.push('success'),
      onFailure: () => order.push('failure'),
    })
    const done = guard.run(1)
    d.resolve('ok')
    await done
    expect(order).toEqual(['pending:true', 'pending:false', 'success'])
  })

  it('ignores calls while in flight and accepts a new attempt after settlement', async () => {
    const waiting: Array<ReturnType<typeof deferred<string>>> = []
    const perform = vi.fn(() => {
      const d = deferred<string>()
      waiting.push(d)
      return d.promise
    })
    const guard = createGuardedSubmit<number, string>({
      perform,
      onPending: () => {},
      onSuccess: () => {},
      onFailure: () => {},
    })
    const first = guard.run(1)
    void guard.run(2)
    expect(perform).toHaveBeenCalledTimes(1)
    waiting[0].reject(new Error('boom'))
    await first
    const second = guard.run(3)
    expect(perform).toHaveBeenCalledTimes(2)
    expect(perform).toHaveBeenLastCalledWith(3)
    waiting[1].resolve('ok')
    await second
  })

  it('skips the close-and-navigate step for a write that settles after the surface has gone', async () => {
    const d = deferred<string>()
    const onSuccess = vi.fn()
    const pendings: boolean[] = []
    const guard = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: (p) => pendings.push(p),
      onSuccess,
      onFailure: () => {},
    })
    const done = guard.run(1)
    // The modal is dismissed, or the screen unmounts, while in flight.
    guard.setActive(false)
    d.resolve('saved')
    await done
    expect(onSuccess).not.toHaveBeenCalled()
    // The attempt still settled: pending was cleared.
    expect(pendings).toEqual([true, false])
  })

  it('still reports a failure that settles after the surface has gone', async () => {
    const d = deferred<string>()
    const onFailure = vi.fn()
    const guard = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: () => {},
      onSuccess: () => {},
      onFailure,
    })
    const done = guard.run(1)
    guard.setActive(false)
    const boom = new Error('boom')
    d.reject(boom)
    await done
    expect(onFailure).toHaveBeenCalledWith(boom, 1)
  })
})

describe('stableCreateId', () => {
  it('mints once per key and reuses it, so a retry targets the same row', () => {
    const store = new Map<string, string>()
    let n = 0
    const mint = () => `id-${++n}`
    const first = stableCreateId(store, 'week-1', mint)
    const retry = stableCreateId(store, 'week-1', mint)
    expect(first).toBe('id-1')
    expect(retry).toBe('id-1')
    expect(n).toBe(1)
  })

  it('mints a distinct id for each new key', () => {
    const store = new Map<string, string>()
    let n = 0
    const mint = () => `id-${++n}`
    expect(stableCreateId(store, 'a', mint)).toBe('id-1')
    expect(stableCreateId(store, 'b', mint)).toBe('id-2')
    // The first key still returns its original id after another key minted one.
    expect(stableCreateId(store, 'a', mint)).toBe('id-1')
  })

  it('a fresh store starts over, mirroring a surface that unmounted after success', () => {
    const mint = () => 'x'
    const before = new Map<string, string>()
    stableCreateId(before, 'week-1', () => 'first')
    // A new store (a remounted surface) mints a new id for the same key.
    const after = new Map<string, string>()
    expect(stableCreateId(after, 'week-1', mint)).toBe('x')
  })
})

describe('plannerBusy composition', () => {
  it('is busy for a pending Save or Start', () => {
    expect(plannerBusy('save', false)).toBe(true)
    expect(plannerBusy('start', false)).toBe(true)
  })

  it('is busy while a Plan from Spond create runs, even with no Save or Start', () => {
    // The composition is what stops the two create paths on one planner from
    // running at once: a Spond create freezes Save and Start (and the fields).
    expect(plannerBusy(null, true)).toBe(true)
  })

  it('is idle only when nothing is pending', () => {
    expect(plannerBusy(null, false)).toBe(false)
  })
})
