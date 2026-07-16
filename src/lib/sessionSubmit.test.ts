import { describe, expect, it, vi } from 'vitest'
import { createGuardedSubmit, createPlannerActions } from './sessionSubmit'
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
    onPending: (a) => pendings.push(a),
    onFailure: (a) => failures.push(a),
  }
  return { actions: createPlannerActions(cb), cb, upsert, waiting, pendings, failures }
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

describe('guarded submit (the shape every other session-writing flow uses)', () => {
  it('runs the close-and-navigate step only after the write resolves', async () => {
    const d = deferred<string>()
    const onSuccess = vi.fn()
    const onFailure = vi.fn()
    const submit = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: () => {},
      onSuccess,
      onFailure,
    })
    const done = submit(1)
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
    const submit = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: () => {},
      onSuccess,
      onFailure,
    })
    const done = submit(1)
    const boom = new Error('boom')
    d.reject(boom)
    await done
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledWith(boom, 1)
  })

  it('brackets each attempt with pending true then false, before the outcome callback', async () => {
    const order: string[] = []
    const d = deferred<string>()
    const submit = createGuardedSubmit<number, string>({
      perform: () => d.promise,
      onPending: (p) => order.push(`pending:${p}`),
      onSuccess: () => order.push('success'),
      onFailure: () => order.push('failure'),
    })
    const done = submit(1)
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
    const submit = createGuardedSubmit<number, string>({
      perform,
      onPending: () => {},
      onSuccess: () => {},
      onFailure: () => {},
    })
    const first = submit(1)
    void submit(2)
    expect(perform).toHaveBeenCalledTimes(1)
    waiting[0].reject(new Error('boom'))
    await first
    const second = submit(3)
    expect(perform).toHaveBeenCalledTimes(2)
    expect(perform).toHaveBeenLastCalledWith(3)
    waiting[1].resolve('ok')
    await second
  })
})
