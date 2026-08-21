// COACH-2B, the authoring rules. What a role press writes, what it removes,
// what a stand-down does, and the sentence a planner shows.
//
// These are the RULES, not the screens: src/routes/coach2b.screens.test.tsx
// renders the two real authoring surfaces over them.
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_ROLES,
  ACTIVITY_ROLE_LABELS,
  NOT_RUNNING_LABEL,
  activityRoleBadge,
  applyRole,
  canStandDown,
  roleOf,
  setNotRunning,
  structureSummary,
} from './activityRole'
import type { Activity } from './data'

const act = (over: Partial<Activity> = {}): Activity => ({
  phase: 'Skill',
  drillId: 'd1',
  duration: 10,
  ...over,
})

const stations = (n: number, over: Partial<Activity> = {}) =>
  Array.from({ length: n }, () => act({ slot: 'station', ...over }))

describe('roleOf', () => {
  it('reads a declared station and the games phase', () => {
    expect(roleOf(act({ slot: 'station' }))).toBe('station')
    expect(roleOf(act({ slot: 'game' }))).toBe('game')
  })

  it('reads an undeclared activity as standard', () => {
    expect(roleOf(act())).toBe('standard')
    expect(roleOf(undefined)).toBe('standard')
  })

  it('reads a malformed slot as standard rather than as a declaration', () => {
    // activities is unconstrained jsonb, so these are reachable. Failing
    // closed means a malformed value never presents as something the coach
    // declared.
    for (const slot of ['Station', 'STATION', 'games', 3, true, null, '']) {
      expect(roleOf({ duration: 10, slot } as unknown as Activity)).toBe('standard')
    }
  })
})

describe('applyRole', () => {
  it('stores slot on Standard to Station', () => {
    expect(applyRole(act(), 'station')).toEqual({ phase: 'Skill', drillId: 'd1', duration: 10, slot: 'station' })
  })

  it('stores slot on Standard to Games', () => {
    expect(applyRole(act(), 'game')).toEqual({ phase: 'Skill', drillId: 'd1', duration: 10, slot: 'game' })
  })

  it('REMOVES slot going back to Standard, rather than nulling it', () => {
    for (const slot of ['station', 'game'] as const) {
      const next = applyRole(act({ slot }), 'standard')
      expect('slot' in next).toBe(false)
      expect(next).toEqual({ phase: 'Skill', drillId: 'd1', duration: 10 })
    }
  })

  it('removes a stand-down when a stood-down station changes role', () => {
    // The rule COACH-2B states: stale session-local state must not follow an
    // activity into another role and stand down a later Games assignment.
    for (const role of ['standard', 'game'] as const) {
      const next = applyRole(act({ slot: 'station', skipped: true }), role)
      expect('skipped' in next).toBe(false)
    }
  })

  it('keeps a stand-down when the role is unchanged', () => {
    const next = applyRole(act({ slot: 'station', skipped: true }), 'station')
    expect(next.skipped).toBe(true)
    expect(next.slot).toBe('station')
  })

  it('never carries a stand-down INTO a station from another role', () => {
    // The mirror of the stated rule. A games activity carrying skipped is not
    // reachable through the UI, but the model permits it and jsonb permits
    // anything, so becoming a station must not inherit it.
    const next = applyRole(act({ slot: 'game', skipped: true }), 'station')
    expect('skipped' in next).toBe(false)
    expect(next.slot).toBe('station')
  })

  it('normalises a malformed slot rather than leaving it', () => {
    const next = applyRole({ phase: 'Skill', duration: 10, slot: 'Station' } as unknown as Activity, 'standard')
    expect('slot' in next).toBe(false)
  })

  it('never writes slot as null, an empty string, or skipped as false', () => {
    for (const role of ACTIVITY_ROLES) {
      for (const start of [act(), act({ slot: 'station' }), act({ slot: 'game' }), act({ slot: 'station', skipped: true })]) {
        const next = applyRole(start, role)
        expect(next.slot === null || (next.slot as unknown) === '').toBe(false)
        expect((next as { skipped?: unknown }).skipped).not.toBe(false)
        if ('slot' in next) expect(['station', 'game']).toContain(next.slot)
        if ('skipped' in next) expect(next.skipped).toBe(true)
      }
    }
  })

  it('never touches phase, duration or the drill', () => {
    const start = act({ phase: 'Warm-Up', duration: 17, drillId: 'd9' })
    for (const role of ACTIVITY_ROLES) {
      const next = applyRole(start, role)
      expect(next.phase).toBe('Warm-Up')
      expect(next.duration).toBe(17)
      expect(next.drillId).toBe('d9')
    }
  })

  it('leaves slot alone when phase changes, which is the caller patching phase', () => {
    // The two are independent keys; this pins that nothing in this module
    // reads phase and nothing that writes phase needs to consider slot.
    const start = act({ slot: 'station' })
    const phaseChanged: Activity = { ...start, phase: 'Cool-Down' }
    expect(phaseChanged.slot).toBe('station')
    expect(roleOf(phaseChanged)).toBe('station')
  })
})

describe('setNotRunning', () => {
  it('writes the literal true', () => {
    expect(setNotRunning(act({ slot: 'station' }), true).skipped).toBe(true)
  })

  it('REMOVES the key on restore, never writing false', () => {
    const down = setNotRunning(act({ slot: 'station' }), true)
    const back = setNotRunning(down, false)
    expect('skipped' in back).toBe(false)
    expect(back).toEqual({ phase: 'Skill', drillId: 'd1', duration: 10, slot: 'station' })
  })

  it('round trips to an object equal to the one never stood down', () => {
    const original = act({ slot: 'station' })
    expect(setNotRunning(setNotRunning(original, true), false)).toEqual(original)
  })

  it('does not move, delete or reduce the activity', () => {
    const down = setNotRunning(act({ slot: 'station', duration: 12 }), true)
    expect(down.duration).toBe(12)
    expect(down.slot).toBe('station')
    expect(down.drillId).toBe('d1')
  })
})

describe('canStandDown', () => {
  it('offers the toggle on a dated session station only', () => {
    expect(canStandDown(act({ slot: 'station' }), { dated: true })).toBe(true)
  })

  it('never offers it on a week plan, whatever the role', () => {
    for (const slot of ['station', 'game', undefined] as const) {
      expect(canStandDown(act({ slot }), { dated: false })).toBe(false)
    }
  })

  it('never offers it on the games phase or a standard activity', () => {
    expect(canStandDown(act({ slot: 'game' }), { dated: true })).toBe(false)
    expect(canStandDown(act(), { dated: true })).toBe(false)
  })
})

describe('activityRoleBadge', () => {
  it('says nothing for a standard activity', () => {
    expect(activityRoleBadge([act()], 0)).toBeNull()
  })

  it('numbers active stations in plan order', () => {
    const plan = [act(), act({ slot: 'station' }), act(), act({ slot: 'station' })]
    expect(activityRoleBadge(plan, 1)).toBe('Station 1')
    expect(activityRoleBadge(plan, 3)).toBe('Station 2')
  })

  it('skips a stood-down station when numbering, and names it', () => {
    const plan = [
      act({ slot: 'station' }),
      act({ slot: 'station', skipped: true }),
      act({ slot: 'station' }),
    ]
    expect(activityRoleBadge(plan, 0)).toBe('Station 1')
    expect(activityRoleBadge(plan, 1)).toBe(`${ACTIVITY_ROLE_LABELS.station} · ${NOT_RUNNING_LABEL}`)
    // The third station becomes Station 2 while the second is down.
    expect(activityRoleBadge(plan, 2)).toBe('Station 2')
  })

  it('restores the original numbering when the station comes back', () => {
    const plan = [
      act({ slot: 'station' }),
      act({ slot: 'station', skipped: true }),
      act({ slot: 'station' }),
    ]
    const restored = [...plan]
    restored[1] = setNotRunning(restored[1], false)
    expect(activityRoleBadge(restored, 1)).toBe('Station 2')
    expect(activityRoleBadge(restored, 2)).toBe('Station 3')
  })

  it('names the games phase', () => {
    expect(activityRoleBadge([act({ slot: 'game' })], 0)).toBe('Games phase')
  })

  it('names a stood-down games activity rather than presenting it as running', () => {
    // COACH-2B offers no control that creates this state, deliberately. The
    // model permits it and every reader honours it, so a plan carrying one
    // must not read as a running games phase while its minutes are absent
    // from the total.
    expect(activityRoleBadge([act({ slot: 'game', skipped: true })], 0)).toBe(
      `Games phase · ${NOT_RUNNING_LABEL}`,
    )
  })
})

describe('structureSummary', () => {
  it('names four and five station carousels without a warning', () => {
    for (const n of [4, 5]) {
      const s = structureSummary([...stations(n), act({ slot: 'game' })])
      expect(s.headline).toBe(`${n} stations · Games phase set`)
      expect(s.warnings).toEqual([])
      expect(s.notes).toEqual([])
    }
  })

  it('warns at three and at six, and never blocks', () => {
    for (const n of [1, 2, 3]) {
      const s = structureSummary(stations(n))
      expect(s.headline).toContain(`${n} station`)
      expect(s.warnings).toContain('too-few-stations')
      expect(s.notes).toContain('A carousel runs four or five stations.')
    }
    const six = structureSummary(stations(6))
    expect(six.warnings).toContain('too-many-stations')
    expect(six.notes).toContain('A carousel runs four or five stations.')
  })

  it('tells a marked-but-stood-down games phase apart from an unmarked one', () => {
    // Reading the first as the second would tell a coach to mark a games
    // phase they already have.
    expect(structureSummary([...stations(4)]).headline).toContain('Games phase not set')
    expect(
      structureSummary([...stations(4), act({ slot: 'game', skipped: true })]).headline,
    ).toContain('Games phase not running')
  })

  it('says none are declared rather than guessing', () => {
    const s = structureSummary([act(), act({ phase: 'Game' })])
    expect(s.headline).toBe('No stations declared · Games phase not set')
    expect(s.warnings).toContain('no-stations-declared')
  })

  it('names the all-stood-down state', () => {
    const s = structureSummary(stations(4, { skipped: true }))
    expect(s.headline).toBe('4 stations · none running · Games phase not set')
    expect(s.warnings).toContain('all-stations-stood-down')
    expect(s.notes).toContain('Every station is stood down, so the carousel runs nothing.')
  })

  it('counts the running stations and names how many are not', () => {
    const plan = [...stations(4), act({ slot: 'station', skipped: true })]
    expect(structureSummary(plan).headline).toBe('4 stations · 1 not running · Games phase not set')
  })

  it('is singular for one station', () => {
    expect(structureSummary(stations(1)).headline).toBe('1 station · Games phase not set')
  })

  it('warns visibly when more than one games activity is active', () => {
    const s = structureSummary([...stations(4), act({ slot: 'game' }), act({ slot: 'game' })])
    expect(s.headline).toBe('4 stations · Games phase marked 2 times')
    expect(s.warnings).toContain('multiple-active-games')
    expect(s.notes).toContain('More than one activity is marked as the games phase.')
  })

  it('does not silently unmark an earlier games activity when a second is marked', () => {
    // Marking is a per-activity write; nothing here or in applyRole reaches
    // across the plan, so the ambiguity stays visible for the coach to
    // resolve deliberately.
    const plan = [act({ slot: 'game' }), act()]
    const next = [...plan]
    next[1] = applyRole(next[1], 'game')
    expect(next[0].slot).toBe('game')
    expect(next[1].slot).toBe('game')
    expect(structureSummary(next).warnings).toContain('multiple-active-games')
  })

  it('never infers structure from phase', () => {
    // The defect the programme exists to remove, as a direct test. A Game
    // phase activity nobody marked is not the games phase, and a Warm-Up
    // phase activity marked Station is a station.
    const plan = [
      act({ phase: 'Game' }),
      act({ phase: 'Game' }),
      act({ phase: 'Warm-Up', slot: 'station' }),
    ]
    const s = structureSummary(plan)
    expect(s.headline).toBe('1 station · Games phase not set')
    expect(activityRoleBadge(plan, 0)).toBeNull()
    expect(activityRoleBadge(plan, 2)).toBe('Station 1')
  })

  it('reads an empty plan and a null plan without inventing anything', () => {
    for (const plan of [[], null, undefined]) {
      const s = structureSummary(plan)
      expect(s.headline).toBe('No stations declared · Games phase not set')
    }
  })
})
