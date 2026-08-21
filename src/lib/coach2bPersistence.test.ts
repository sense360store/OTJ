// COACH-2B persistence: a declaration made on either authoring surface
// survives to where it is read, and a stand-down never escapes the evening
// it was made for.
//
// The BOUNDARY functions are COACH-2A's and are already pinned in
// queries.test.ts. What is new here is the PATH the two authoring surfaces
// create: an activity authored in a week plan, carried into a dated session,
// stood down there, and saved back as reusable content.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  toActivity,
  toActivityRow,
  toTemplateActivityRows,
  type ActivityRow,
} from './queries'
import { applyRole, setNotRunning } from './activityRole'
import { sessionMinutes } from './data'
import type { Activity } from './data'

const act = (over: Partial<Activity> = {}): Activity => ({
  phase: 'Skill',
  drillId: 'd1',
  duration: 10,
  ...over,
})

describe('a role authored in a week plan reaches the dated session', () => {
  it('carries a station through the template write, read and copy', () => {
    // Authored in the week-plan editor.
    const authored = applyRole(act(), 'station')
    // Written to the template. The COACH-2A helper keeps `slot`, because
    // declaring the stations belongs to the plan.
    const templateRows = toTemplateActivityRows([authored])
    expect(templateRows[0].slot).toBe('station')
    // Read back and deep copied into a new dated session, which is what
    // useStartFromTemplate does.
    const fromTemplate = toActivity(templateRows[0])
    const copied = JSON.parse(JSON.stringify([fromTemplate])) as Activity[]
    expect(copied[0].slot).toBe('station')
    // And saved on that session.
    expect(toActivityRow(copied[0]).slot).toBe('station')
  })

  it('carries the games phase through the same path', () => {
    const authored = applyRole(act(), 'game')
    const fromTemplate = toActivity(toTemplateActivityRows([authored])[0])
    const copied = JSON.parse(JSON.stringify([fromTemplate])) as Activity[]
    expect(copied[0].slot).toBe('game')
    expect(toActivityRow(copied[0]).slot).toBe('game')
  })

  it('carries an undeclared activity through as undeclared', () => {
    const fromTemplate = toActivity(toTemplateActivityRows([act()])[0])
    expect('slot' in fromTemplate).toBe(false)
  })
})

describe('a stand-down never reaches reusable content', () => {
  it('is stripped when a stood-down session is saved as a week plan', () => {
    const stoodDown = setNotRunning(applyRole(act(), 'station'), true)
    const sessionRow = toActivityRow(stoodDown)
    expect(sessionRow.skipped).toBe(true)

    const templateRows = toTemplateActivityRows([stoodDown])
    expect('skipped' in templateRows[0]).toBe(false)
    // The declaration itself survives; only the evening's decision does not.
    expect(templateRows[0].slot).toBe('station')
  })

  it('cannot come back through the template read', () => {
    // Even a stored template row that somehow carried the key reads clean,
    // because the read side strips it too.
    const stale = [{ phase: 'Skill', duration: 10, slot: 'station', skipped: true }] as ActivityRow[]
    expect('skipped' in toTemplateActivityRows(stale)[0]).toBe(false)
  })

  it('round trips on the dated session it was made for', () => {
    const stoodDown = setNotRunning(applyRole(act(), 'station'), true)
    const back = toActivity(toActivityRow(stoodDown))
    expect(back.skipped).toBe(true)
    expect(back.slot).toBe('station')
    const restored = setNotRunning(back, false)
    expect('skipped' in toActivityRow(restored)).toBe(false)
  })
})

describe('the total a coach reads follows the stand-down through persistence', () => {
  it('falls and returns across a save and a reload', () => {
    const plan = [applyRole(act({ duration: 10 }), 'station'), applyRole(act({ duration: 20 }), 'station')]
    const reload = (list: Activity[]) => list.map((a) => toActivity(toActivityRow(a)))

    expect(sessionMinutes({ activities: reload(plan) })).toBe(30)

    const down = [setNotRunning(plan[0], true), plan[1]]
    expect(sessionMinutes({ activities: reload(down) })).toBe(20)

    const restored = [setNotRunning(down[0], false), down[1]]
    expect(sessionMinutes({ activities: reload(restored) })).toBe(30)
  })
})

describe('the template-to-session copy stays a whole copy', () => {
  it('copies the activities wholesale rather than rebuilding them field by field', () => {
    // A tripwire, not a proof. useStartFromTemplate deep copies the mapped
    // activities, which is exactly why `slot` reaches a new session without
    // that hook knowing the key exists. Rewriting it to pick fields would
    // silently drop every key added after the rewrite, and the path tests
    // above use the same copy rather than the hook itself, so nothing else
    // in this suite would notice.
    //
    // WHAT THIS CANNOT CATCH: a rewrite that still deep copies but then
    // deletes or overwrites a key afterwards, and any change to the hook's
    // behaviour that does not touch this line's shape.
    const src = readFileSync(resolve(__dirname, '../hooks/useStartFromTemplate.ts'), 'utf8')
    expect(src).toContain('JSON.parse(JSON.stringify(t.activities))')
    expect(src).not.toMatch(/activities:\s*t\.activities\.map\(/)
  })
})
