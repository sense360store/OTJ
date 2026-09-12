// COACH-14B: quick drill's form model.
//
// SPEC. A quick drill is an ORDINARY library drill created through the
// ordinary insert, so the proof that matters here is that the payload it
// hands that insert is complete, carries no invented provenance, and
// leaves every field a coach was not asked about at a stated default.
// The tiers are pinned because the whole point of a quick drill is what
// it does NOT ask for, and a field quietly promoted into the first view
// is the regression.
import { describe, expect, it } from 'vitest'
import {
  blankQuickDrill,
  isQuickDrillValid,
  QUICK_DRILL_CLASSIFICATION,
  QUICK_DRILL_DETAIL,
  QUICK_DRILL_ESSENTIAL,
  QUICK_DRILL_MAX_MINUTES,
  quickDrillInput,
  quickDrillTier,
  validateQuickDrill,
} from './quickDrill'
import type { QuickDrillFields } from './quickDrill'
import { quickDrillPreset } from './planDrillAuthoring'
import type { Activity } from './data'

const fields = (over: Partial<QuickDrillFields> = {}): QuickDrillFields => ({
  name: 'Passing squares',
  howItWorks: 'Two teams, four gates, keep the ball moving.',
  duration: 12,
  coachingPoints: [],
  equipment: [],
  space: '',
  easier: [],
  harder: [],
  ...over,
})

describe('the starting values', () => {
  it('takes its minutes and phase from COACH-11 preset rather than a second literal', () => {
    const blank = blankQuickDrill()
    const preset = quickDrillPreset(null)
    expect(blank.duration).toBe(preset.duration)
    expect(blank.slot).toEqual({ phase: preset.phase, duration: preset.duration })
  })

  it('starts empty when nothing is being turned into a drill', () => {
    const blank = blankQuickDrill()
    expect(blank.name).toBe('')
    expect(blank.howItWorks).toBe('')
    expect(blank.coachingPoints).toEqual([])
  })

  it('keeps the title of a custom row being turned into a drill', () => {
    const row: Activity = { phase: 'Game', title: 'Rondo', duration: 15 }
    const blank = blankQuickDrill(row)
    expect(blank.name).toBe('Rondo')
    expect(blank.duration).toBe(15)
    expect(blank.slot.phase).toBe('Game')
  })

  it('does not carry the placeholder title into the drill name', () => {
    const row: Activity = { phase: 'Skill', title: 'Custom activity', duration: 10 }
    expect(blankQuickDrill(row).name).toBe('')
  })
})

describe('the tiers', () => {
  it('asks for a name, a description and minutes first and nothing else', () => {
    expect([...QUICK_DRILL_ESSENTIAL]).toEqual(['name', 'howItWorks', 'duration'])
  })

  it('holds the coaching detail back but keeps every field of it a coaching answer', () => {
    expect([...QUICK_DRILL_DETAIL]).toEqual(['coachingPoints', 'equipment', 'space', 'easier', 'harder'])
  })

  it('places every field in exactly one tier', () => {
    const all = [...QUICK_DRILL_ESSENTIAL, ...QUICK_DRILL_DETAIL]
    expect(new Set(all).size).toBe(all.length)
    for (const f of all) {
      expect(quickDrillTier(f)).toBe(QUICK_DRILL_ESSENTIAL.includes(f) ? 'essential' : 'detail')
    }
  })

  it('keeps the library taxonomy out of the form entirely', () => {
    // Not merely out of the first view: a quick drill never asks for
    // these, and the drill form remains where they are edited.
    for (const key of ['corner', 'skill', 'level', 'ages', 'theme', 'format'] as const) {
      expect(QUICK_DRILL_CLASSIFICATION).toContain(key)
    }
  })
})

describe('validation', () => {
  it('accepts a name, a description and minutes', () => {
    expect(validateQuickDrill(fields())).toEqual([])
    expect(isQuickDrillValid(fields())).toBe(true)
  })

  it('accepts a drill with no description, because a name and minutes are a real drill', () => {
    expect(validateQuickDrill(fields({ howItWorks: '' }))).toEqual([])
  })

  it('refuses a blank or whitespace name, against the name field', () => {
    for (const name of ['', '   ']) {
      const problems = validateQuickDrill(fields({ name }))
      expect(problems).toHaveLength(1)
      expect(problems[0].code).toBe('name-missing')
      expect(problems[0].field).toBe('name')
    }
  })

  it('refuses zero, negative and unreadable minutes', () => {
    for (const duration of [0, -5, Number.NaN]) {
      const problems = validateQuickDrill(fields({ duration }))
      expect(problems.map((p) => p.code)).toEqual(['duration-not-positive'])
    }
  })

  it('caps at ninety minutes, the bound the drill form has always applied', () => {
    // Stated as the NUMBER because the boundary test below reads the
    // constant and adds one, which proves the rule fires at whatever the
    // constant says and never that the constant is 90. The drill form's two
    // minutes inputs carry `max={90}` literally (src/components/
    // DrillFormModal.tsx); this is the assertion that notices if the two
    // answers drift apart. Wiring the form to read the constant belongs to
    // the UI slice, not here.
    expect(QUICK_DRILL_MAX_MINUTES).toBe(90)
  })

  it('refuses more minutes than the drill form has ever allowed', () => {
    expect(validateQuickDrill(fields({ duration: QUICK_DRILL_MAX_MINUTES })).length).toBe(0)
    const problems = validateQuickDrill(fields({ duration: QUICK_DRILL_MAX_MINUTES + 1 }))
    expect(problems.map((p) => p.code)).toEqual(['duration-too-long'])
  })

  it('reports both problems at once rather than one at a time', () => {
    const problems = validateQuickDrill(fields({ name: '', duration: 0 }))
    expect(problems.map((p) => p.code)).toEqual(['name-missing', 'duration-not-positive'])
  })

  it('carries a specific sentence for every problem', () => {
    const problems = validateQuickDrill(fields({ name: '', duration: 0 }))
    for (const p of problems) expect(p.message.trim().length).toBeGreaterThan(0)
  })

  it('discards nothing: the fields it was given come back untouched', () => {
    const given = fields({ name: '  ', duration: 0, howItWorks: 'kept' })
    const before = JSON.parse(JSON.stringify(given))
    validateQuickDrill(given)
    expect(given).toEqual(before)
  })
})

describe('the insert payload', () => {
  it('trims the name and the description onto title and summary', () => {
    const input = quickDrillInput(fields({ name: '  Rondo  ', howItWorks: '  Keep it  ' }))
    expect(input.title).toBe('Rondo')
    // The description is the searchable summary, not setup_notes: see the
    // description decision in quickDrill.ts.
    expect(input.summary).toBe('Keep it')
    expect(input.setupNotes).toBe('')
  })

  it('leaves the drill unclassified rather than filing it under Technical unseen', () => {
    expect(quickDrillInput(fields()).corner).toBeNull()
  })

  it('leaves every OTHER classification field at its stated default, by value', () => {
    // The companion to the corner assertion above, and the reason it is by
    // VALUE rather than by key presence: a coach never sees any of these
    // controls, so a default that changed here would file every quick drill
    // somewhere nobody chose and nothing on screen would say so. The
    // completeness test further down proves the KEYS are all sent; only
    // this one proves WHAT they are sent as.
    const input = quickDrillInput(fields())
    // Not nullable at DrillInput and sent unconditionally by the write
    // mapper (toDrillWriteRow sends `level: input.level`, with no `|| null`),
    // so SOME level is always stored whatever this returns. 'Foundation' is
    // the drill form's own create default, and it is a default rather than a
    // coach's answer, which matters because the library's Level filter is an
    // exact match.
    expect(input.level).toBe('Foundation')
    // Empty, never a placeholder word. Each of these stores null through the
    // write mapper's `|| null`, which reads as "not classified"; a filler
    // value would read as a coach's answer and would match a library filter.
    expect(input.skill).toBe('')
    expect(input.theme).toBe('')
    expect(input.format).toBe('')
    // Empty lists, not seeded ones. A tag or an age group invented here
    // would put the drill in a filter nobody picked.
    expect(input.tags).toEqual([])
    expect(input.ages).toEqual([])
  })

  it('claims no third party source, so nothing is attributed to anyone', () => {
    expect(quickDrillInput(fields()).sourceUrl).toBe('')
  })

  it('attaches no media, because a drill needs none', () => {
    expect(quickDrillInput(fields()).mediaId).toBeNull()
  })

  it('carries the coaching detail onto the columns that hold it', () => {
    const input = quickDrillInput(
      fields({
        coachingPoints: ['Head up', 'First touch out of the feet'],
        equipment: ['8 cones', '2 balls'],
        space: '20 x 20 yd',
        easier: ['Bigger area'],
        harder: ['One touch'],
      }),
    )
    expect(input.points).toEqual(['Head up', 'First touch out of the feet'])
    expect(input.equipment).toEqual(['8 cones', '2 balls'])
    expect(input.area).toBe('20 x 20 yd')
    expect(input.easier).toEqual(['Bigger area'])
    expect(input.harder).toEqual(['One touch'])
  })

  it('drops blank and whitespace chips from every list', () => {
    const input = quickDrillInput(
      fields({ coachingPoints: ['  Head up  ', '', '   '], equipment: [''], easier: [' Bigger '], harder: [] }),
    )
    expect(input.points).toEqual(['Head up'])
    expect(input.equipment).toEqual([])
    expect(input.easier).toEqual(['Bigger'])
    expect(input.harder).toEqual([])
  })

  it('fills every field the canonical DrillInput declares', () => {
    // The insert's write mapper reads all of these. A missing key would
    // reach Postgres as undefined and leave the column at its default
    // rather than at the value this module decided.
    const input = quickDrillInput(fields())
    for (const key of [
      'title',
      'summary',
      'corner',
      'skill',
      'level',
      'ages',
      'duration',
      'players',
      'area',
      'equipment',
      'points',
      'tags',
      'mediaId',
      'setupNotes',
      'easier',
      'harder',
      'theme',
      'format',
      'sourceUrl',
    ] as const) {
      expect(Object.prototype.hasOwnProperty.call(input, key)).toBe(true)
    }
  })

  it('sends no ownership, club or rights of its own', () => {
    // useInsertDrill injects club_id and created_by; rights is never sent,
    // so the column's own internal_only default applies. A quick drill
    // that named any of them would be claiming authority it does not have.
    const input = quickDrillInput(fields()) as unknown as Record<string, unknown>
    for (const key of ['clubId', 'club_id', 'createdBy', 'created_by', 'rights', 'id', 'sourceKey', 'source_key']) {
      expect(Object.prototype.hasOwnProperty.call(input, key)).toBe(false)
    }
  })

  it('uses the same number for the drill and for the activity', () => {
    expect(quickDrillInput(fields({ duration: 17 })).duration).toBe(17)
  })
})
