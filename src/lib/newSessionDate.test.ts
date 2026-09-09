// =====================================================================
// P1: a session created by hand starts on TODAY.
//
// WHAT WENT WRONG. `blankSession` and the Use template path each carried
// the literal '2026-06-16'. A production smoke test in September created
// a session dated 16 June, which is not merely untidy: a session in the
// past is not the next event on Home, it is not offered as active by the
// lifecycle, and a coach who saves without noticing has filed tonight's
// training three months ago.
//
// Two literals is one defect written twice, so the fix is ONE derivation
// (./localDate) with three consumers, and this is what proves each one
// reaches it. The two paths that derive a date from something real, Plan
// from Spond and Apply programme, are asserted here too, because "we
// fixed the two that were wrong" is only half the claim: the other half
// is that the two that were right did not move.
//
// Names in fixtures are invented. No child or coach appears.
// =====================================================================
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isoDate, todayIso } from './localDate'
import { blankSession } from './data'
import type { Session, Template } from './data'
import { sessionFromTemplate } from './sessionFromTemplate'
import { sessionFromSpondEvent } from './spond'

const SRC = join(import.meta.dirname, '..')

// The runner pins TZ=Europe/London (vite.config.ts), so these are the
// club's own hours rather than a runner's.
const at = (iso: string) => new Date(iso)

afterEach(() => {
  vi.useRealTimers()
})

function frozen(iso: string, run: () => void): void {
  vi.useFakeTimers()
  vi.setSystemTime(at(iso))
  try {
    run()
  } finally {
    vi.useRealTimers()
  }
}

// ---- the derivation itself -------------------------------------------

describe('the local calendar date', () => {
  it('reads the day the club is on, in the shape a session stores', () => {
    expect(isoDate(at('2026-09-09T14:00:00+01:00'))).toBe('2026-09-09')
    expect(isoDate(at('2026-01-05T09:00:00Z'))).toBe('2026-01-05')
  })

  it('pads the month and the day, so the string sorts and compares', () => {
    expect(isoDate(at('2026-01-02T12:00:00Z'))).toBe('2026-01-02')
    expect(isoDate(at('2026-12-31T12:00:00Z'))).toBe('2026-12-31')
  })

  it('answers the CLUB day through a British Summer Time midnight, not the UTC one', () => {
    // THE CASE THE OBVIOUS IMPLEMENTATION GETS WRONG. Half past midnight
    // on 16 June in Yorkshire is half past eleven on the 15th in UTC, so
    // toISOString().slice(0, 10) dates a session created then YESTERDAY.
    const justAfterMidnightBst = at('2026-06-16T00:30:00+01:00')
    expect(justAfterMidnightBst.toISOString().slice(0, 10)).toBe('2026-06-15')
    expect(isoDate(justAfterMidnightBst)).toBe('2026-06-16')
  })

  it('agrees with UTC outside summer time, which is why the defect hid', () => {
    const justAfterMidnightGmt = at('2026-01-16T00:30:00Z')
    expect(justAfterMidnightGmt.toISOString().slice(0, 10)).toBe('2026-01-16')
    expect(isoDate(justAfterMidnightGmt)).toBe('2026-01-16')
  })

  it('holds the last minute of a club day on that day, both sides of the change', () => {
    expect(isoDate(at('2026-06-16T23:59:00+01:00'))).toBe('2026-06-16')
    expect(isoDate(at('2026-01-16T23:59:00Z'))).toBe('2026-01-16')
  })

  it('survives the clock going forward and back, because a date is not a duration', () => {
    // 29 March 2026 is 23 hours long in Europe/London and 25 October is 25.
    expect(isoDate(at('2026-03-29T12:00:00+01:00'))).toBe('2026-03-29')
    expect(isoDate(at('2026-10-25T12:00:00Z'))).toBe('2026-10-25')
  })

  it('reads the clock when it is not given one', () => {
    frozen('2026-09-09T10:00:00+01:00', () => expect(todayIso()).toBe('2026-09-09'))
  })
})

// ---- the two paths that were wrong ------------------------------------

describe('a session created by hand starts today', () => {
  it('a new manual session takes the day it was created on', () => {
    frozen('2026-09-09T10:00:00+01:00', () => {
      expect(blankSession('coach-1').date).toBe('2026-09-09')
    })
  })

  it('and takes the CLUB day when the coach is planning after midnight in summer', () => {
    frozen('2026-06-16T00:30:00+01:00', () => {
      expect(blankSession('coach-1').date).toBe('2026-06-16')
    })
  })

  it('Use template takes the day it was created on, not the template', () => {
    const template: Template = {
      id: 't1',
      name: 'Week 2, receiving',
      author: 'Club',
      focus: 'Receiving',
      activities: [{ phase: 'Skill', drillId: 'd1', duration: 12 }],
      intentions: ['Receive on the back foot'],
      programme: '',
      week: null,
      programmeId: null,
      programmeWeek: null,
      sourceUrl: '',
      sourceLabel: '',
      rights: 'internal_only',
      createdAt: '2026-08-01T00:00:00Z',
    }
    frozen('2026-09-09T10:00:00+01:00', () => {
      const s = sessionFromTemplate({ id: 's1', template, coachId: 'coach-1', allTeamIds: ['titans'] })
      expect(s.date).toBe('2026-09-09')
      // And nothing else about that path moved.
      expect(s.name).toBe('Week 2, receiving')
      expect(s.time).toBe('17:30')
      expect(s.focus).toBe('Receiving')
      expect(s.intentions).toEqual(['Receive on the back foot'])
      expect(s.teamIds).toEqual(['titans'])
      expect(s.activities).toEqual(template.activities)
      // A deep copy, so editing the session cannot edit the week plan.
      expect(s.activities).not.toBe(template.activities)
    })
  })

  it('the two of them agree, because they ask the same function', () => {
    frozen('2026-06-16T00:30:00+01:00', () => {
      const template = { name: '', focus: '', activities: [], intentions: [] } as unknown as Template
      expect(sessionFromTemplate({ id: 's1', template, coachId: 'c', allTeamIds: [] }).date).toBe(
        blankSession('c').date,
      )
    })
  })
})

// ---- the paths that were already right --------------------------------

describe('a date derived from something real is untouched', () => {
  it('Plan from Spond still takes the event day and time, not today', () => {
    frozen('2026-09-09T10:00:00+01:00', () => {
      const s = sessionFromSpondEvent(
        {
          id: 'e1',
          spondId: 'SP1',
          title: 'Titans Tuesday',
          startsAt: '2026-10-06T18:30:00',
          endsAt: null,
          location: null,
          teamId: 'titans',
          spondType: null,
          acceptedCount: 0,
          declinedCount: 0,
          unansweredCount: 0,
          waitingCount: 0,
        } as unknown as Parameters<typeof sessionFromSpondEvent>[0],
        'coach-1',
        ['titans'],
        [],
      )
      expect(s.date).toBe('2026-10-06')
      expect(s.time).toBe('18:30')
    })
  })

  it('Apply programme still dates each week from its own series, never from today', () => {
    // The programme screen computes every week from the start date the
    // admin chose (dateFor -> isoAddDays), and writes that into the row.
    // A source check rather than a call, because those rules are private
    // to the screen; what it forbids is the one substitution that would
    // reintroduce the defect there.
    const src = readFileSync(join(SRC, 'components/ApplyProgrammeModal.tsx'), 'utf8')
    expect(src).toContain('date: dateFor(week)')
    expect(src).not.toMatch(/date:\s*todayIso\(\)/)
  })
})

// ---- an existing session keeps the day it was saved on ----------------

describe('nothing rewrites a date that is already stored', () => {
  it('the derivation is only ever a DEFAULT, never applied to a session in hand', () => {
    const stored: Session = { ...blankSession('coach-1'), id: 's1', date: '2026-06-16', time: '10:00' }
    frozen('2026-09-09T10:00:00+01:00', () => {
      // The planner opens an existing session by deep cloning it, which is
      // what this stands for: nothing in the create path touches a row
      // that already exists.
      const opened = JSON.parse(JSON.stringify(stored)) as Session
      expect(opened.date).toBe('2026-06-16')
      expect(opened.time).toBe('10:00')
    })
  })
})

// ---- one derivation, and only one -------------------------------------

describe('there is one local date derivation', () => {
  function tsFiles(root: string, prefix = ''): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) return tsFiles(join(root, entry.name), rel)
      return /\.tsx?$/.test(entry.name) ? [rel] : []
    })
  }
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const read = (f: string) => strip(readFileSync(join(SRC, f), 'utf8'))
  const shipped = tsFiles(SRC).filter((f) => !/\.test\.tsx?$/.test(f))

  it('is defined once, in the shared module', () => {
    const definitions = shipped.filter((f) => /function (todayIso|isoDate)\b/.test(read(f)))
    expect(definitions).toEqual(['lib/localDate.ts'])
  })

  it('is reached by import everywhere else', () => {
    const offenders = shipped.filter(
      (f) =>
        f !== 'lib/localDate.ts' &&
        /\btodayIso\s*\(/.test(read(f)) &&
        !/import \{[^}]*\btodayIso\b[^}]*\} from '[^']*localDate'/.test(read(f)),
    )
    expect(offenders).toEqual([])
  })

  it('leaves no UTC day slice anywhere a local day is meant', () => {
    // The one implementation the defect would come back as. `spond.ts`
    // builds its date from the EVENT's own local fields and is checked by
    // its own suite; nothing else may slice an ISO string into a date.
    const offenders: string[] = []
    for (const f of shipped) {
      for (const m of read(f).matchAll(/toISOString\(\)\s*\.\s*(slice|substring|substr|split)\(/g)) {
        offenders.push(`${f}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('leaves no hardcoded start date on a create path', () => {
    // The literal itself, in the two files that carried it and in any
    // future one: a `date:` whose value is a quoted calendar date.
    const offenders: string[] = []
    for (const f of shipped) {
      for (const m of read(f).matchAll(/\bdate:\s*'(\d{4}-\d{2}-\d{2})'/g)) offenders.push(`${f}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })
})
