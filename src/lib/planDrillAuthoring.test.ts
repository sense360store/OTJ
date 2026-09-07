// =====================================================================
// COACH-11: what creating a drill from a plan writes into the plan.
//
// The activity rules are pure and shared by both hosts: a drill created
// from the add bar joins the end of the plan, and a custom activity
// turned into a drill is REPLACED in place, keeping its position, its
// phase, its declared role and, on a dated session, its stand down.
// The leave to draw flow is the same function for both hosts too, over
// injected storage and navigation, so "the draft is stashed before the
// navigation and the navigation never happens without it" is a test.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import {
  activityFromCreatedDrill,
  applyCreatedDrill,
  CUSTOM_ACTIVITY_TITLE,
  leaveToDraw,
  quickDrillPreset,
  STASH_FAILED_NOTE,
} from './planDrillAuthoring'
import { AUTHORING_STASH_KEY, DRAFT_PARAM, RETURN_PARAM, type StorageLike } from './authoringReturn'
import type { Activity } from './data'

const custom: Activity = { phase: 'Skill', title: CUSTOM_ACTIVITY_TITLE, duration: 10 }
const station: Activity = { phase: 'Skill', title: CUSTOM_ACTIVITY_TITLE, duration: 12, slot: 'station', skipped: true }
const rondo: Activity = { phase: 'Warm-Up', drillId: 'd1', duration: 8 }

describe('activityFromCreatedDrill', () => {
  it('points at the new drill, carries the chosen phase and minutes, and no title', () => {
    expect(activityFromCreatedDrill('d-new', { phase: 'Game', duration: 15 })).toEqual({
      phase: 'Game',
      drillId: 'd-new',
      duration: 15,
    })
  })

  it('reads a cleared or zero duration as the plan always has, and never negative', () => {
    expect(activityFromCreatedDrill('d-new', { phase: 'Skill', duration: 0 }).duration).toBe(0)
    expect(activityFromCreatedDrill('d-new', { phase: 'Skill', duration: -3 }).duration).toBe(0)
  })
})

describe('applyCreatedDrill', () => {
  it('appends to the end of the plan from the add bar', () => {
    const next = applyCreatedDrill([rondo, custom], 'd-new', { phase: 'Skill', duration: 15 }, { kind: 'append' })
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({ phase: 'Skill', drillId: 'd-new', duration: 15 })
    // The rows already there are the same objects: nothing else moved.
    expect(next[0]).toBe(rondo)
    expect(next[1]).toBe(custom)
  })

  it('replaces the custom activity in place when turning it into a drill', () => {
    const next = applyCreatedDrill([rondo, station, custom], 'd-new', { phase: 'Game', duration: 20 }, { kind: 'replace', index: 1 })
    expect(next).toHaveLength(3)
    expect(next[1]).toEqual({ phase: 'Game', drillId: 'd-new', duration: 20, slot: 'station', skipped: true })
    // The title is gone: the drill's own title is the row's name now.
    expect('title' in next[1]).toBe(false)
    expect(next[0]).toBe(rondo)
    expect(next[2]).toBe(custom)
  })

  it('keeps the declared role and the stand down without naming them', () => {
    // A future structural key on an activity survives the same way, which
    // is the reason the rule copies everything but the title rather than
    // listing what it keeps.
    const odd = { ...custom, slot: 'game' as const, extra: 'kept' } as Activity
    const next = applyCreatedDrill([odd], 'd-new', { phase: 'Skill', duration: 10 }, { kind: 'replace', index: 0 })
    expect(next[0]).toEqual({ phase: 'Skill', drillId: 'd-new', duration: 10, slot: 'game', extra: 'kept' })
  })

  it('refuses to replace a row that already has a drill, or one that is not there', () => {
    // Turn into a drill is offered only on a custom row. A stale index
    // (a row removed while the form was open cannot happen, but a wrong
    // one from a bug can) must not overwrite a library drill.
    const plan = [rondo, custom]
    expect(applyCreatedDrill(plan, 'd-new', { phase: 'Skill', duration: 10 }, { kind: 'replace', index: 0 })).toBe(plan)
    expect(applyCreatedDrill(plan, 'd-new', { phase: 'Skill', duration: 10 }, { kind: 'replace', index: 5 })).toBe(plan)
  })

  it('never mutates the plan it was given', () => {
    const plan = [rondo, custom]
    const copy = JSON.parse(JSON.stringify(plan))
    applyCreatedDrill(plan, 'd-new', { phase: 'Skill', duration: 10 }, { kind: 'replace', index: 1 })
    applyCreatedDrill(plan, 'd-new', { phase: 'Skill', duration: 10 }, { kind: 'append' })
    expect(plan).toEqual(copy)
  })
})

describe('quickDrillPreset', () => {
  it('starts the form from the custom row: its phase and minutes, and no placeholder title', () => {
    // Every custom row today is titled with the placeholder, because the
    // plan offers no title field. A drill called "Custom activity" is not
    // a drill anybody wants, so the title starts empty and the coach names
    // it; the phase and duration are the row's.
    expect(quickDrillPreset(custom)).toEqual({ title: '', phase: 'Skill', duration: 10 })
  })

  it('keeps a real title where one exists', () => {
    expect(quickDrillPreset({ ...custom, title: 'Arrival games', phase: 'Warm-Up' })).toEqual({
      title: 'Arrival games',
      phase: 'Warm-Up',
      duration: 10,
    })
  })

  it('offers the add bar default for a brand new drill', () => {
    expect(quickDrillPreset(null)).toEqual({ title: '', phase: 'Skill', duration: 10 })
  })
})

describe('leaveToDraw', () => {
  function storage(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>()
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v)
      },
      removeItem: (k) => {
        map.delete(k)
      },
    }
  }
  const draft = { name: 'Tuesday', activities: [{ phase: 'Skill', drillId: 'd-new', duration: 10 }] }

  it('stashes the draft under a fresh token, then opens the Drill Maker with a return address carrying it', () => {
    const s = storage()
    const navigate = vi.fn<(to: string, options?: { replace: boolean }) => void>()
    const outcome = leaveToDraw({
      storage: s,
      userId: 'coach-me',
      host: 'planner',
      id: 'session-1',
      draft,
      returnPath: '/planner?sessionId=session-1',
      drillId: 'd-new',
      navigate,
      token: 'tok-1',
    })
    expect(outcome).toBe('left')
    const entry = JSON.parse(s.map.get(AUTHORING_STASH_KEY)!)
    expect(entry).toEqual({ token: 'tok-1', userId: 'coach-me', host: 'planner', id: 'session-1', draft })
    // Two navigations in order: the entry the coach stands on is REPLACED
    // with the tokenised return address, then the Drill Maker is pushed on
    // top, so the system Back gesture and the in page Back both arrive with
    // the token. A push alone left the bare host beneath, and popping to it
    // took nothing and lost the plan.
    const returnTo = `/planner?sessionId=session-1&${DRAFT_PARAM}=tok-1`
    expect(navigate.mock.calls).toEqual([
      [returnTo, { replace: true }],
      [`/drill/d-new/diagram?${RETURN_PARAM}=${encodeURIComponent(returnTo)}`],
    ])
  })

  it('never navigates when the draft could not be stashed, and names the failure', () => {
    const navigate = vi.fn<(to: string, options?: { replace: boolean }) => void>()
    const outcome = leaveToDraw({
      storage: null,
      userId: 'coach-me',
      host: 'template',
      id: null,
      draft,
      returnPath: '/templates',
      drillId: 'd-new',
      navigate,
      token: 'tok-1',
    })
    expect(outcome).toBe('stash_failed')
    expect(navigate).not.toHaveBeenCalled()
    expect(STASH_FAILED_NOTE).toMatch(/still in the plan/)
  })

  it('stashes nothing and goes nowhere without a signed in user', () => {
    const s = storage()
    const navigate = vi.fn<(to: string, options?: { replace: boolean }) => void>()
    expect(
      leaveToDraw({
        storage: s,
        userId: undefined,
        host: 'planner',
        id: null,
        draft,
        returnPath: '/planner',
        drillId: 'd-new',
        navigate,
        token: 'tok-1',
      }),
    ).toBe('stash_failed')
    expect(s.map.size).toBe(0)
    expect(navigate).not.toHaveBeenCalled()
  })
})
