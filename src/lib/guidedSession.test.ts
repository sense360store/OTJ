// =====================================================================
// COACH-14A, the rules the guided builder runs on.
//
// The screens suite (src/routes/guidedSession.screens.test.tsx) proves
// the real planner renders them. This proves what they ANSWER, which is
// where the two costly mistakes live: a shape that quietly writes a plan
// the structure rules would warn about, and a step that loses what a
// coach entered on the way back to it.
//
// No name in a fixture belongs to anybody.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  applySessionShape,
  canApplySessionShape,
  clampTargetMinutes,
  DEFAULT_TARGET_MINUTES,
  GUIDED_STEPS,
  GUIDE_PROBLEM_DATE,
  GUIDE_PROBLEM_FOCUS,
  GUIDE_PROBLEM_NAME,
  GUIDE_PROBLEM_SHAPE,
  guidedEntryOffered,
  guidedFocusOptions,
  guideStepProblem,
  initialGuideState,
  initialGuideStep,
  guideAdvance,
  guideRetreat,
  isGuidedStep,
  MAX_TARGET_MINUTES,
  MIN_TARGET_MINUTES,
  nextStep,
  PLANNER_GUIDE_MODE,
  plannerModeFor,
  previousStep,
  SESSION_SHAPES,
  sessionNameIsUntouched,
  sessionShapePlan,
  shapeOfActivities,
  shapePlanMinutes,
  shapeStationCount,
  stepProgressLabel,
  suggestedSessionName,
  type SessionShape,
} from './guidedSession'
import { blankSession, NEW_SESSION_NAME, sessionMinutes } from './data'
import type { Activity, Session } from './data'
import { deriveActivityStructure } from './activityStructure'
import { CUSTOM_ACTIVITY_TITLE } from './planDrillAuthoring'
import { FA_PLAYER_SKILLS } from './fa'

const session = (over: Partial<Session> = {}): Session => ({ ...blankSession('coach-1'), ...over })

const placeholder = (over: Partial<Activity> = {}): Activity => ({
  phase: 'Skill',
  title: CUSTOM_ACTIVITY_TITLE,
  duration: 10,
  ...over,
})

// ---- who may be in the guide ----------------------------------------

describe('who the guide is for', () => {
  it('opens for a new session when the address asks for it', () => {
    expect(plannerModeFor({ requested: PLANNER_GUIDE_MODE, isExisting: false, readOnly: false })).toBe('guide')
  })

  it('is the full planner when the address asks for nothing, or for something else', () => {
    expect(plannerModeFor({ requested: null, isExisting: false, readOnly: false })).toBe('full')
    expect(plannerModeFor({ requested: 'wizard', isExisting: false, readOnly: false })).toBe('full')
    expect(plannerModeFor({ requested: '', isExisting: false, readOnly: false })).toBe('full')
  })

  it('never lets a read only viewer into an editable guide, whatever the address says', () => {
    expect(plannerModeFor({ requested: PLANNER_GUIDE_MODE, isExisting: true, readOnly: true })).toBe('full')
    // Stated rather than left to the implication that a read only session
    // is always an existing one. That implication is what a future caller
    // would break.
    expect(plannerModeFor({ requested: PLANNER_GUIDE_MODE, isExisting: false, readOnly: true })).toBe('full')
  })

  it('leaves an existing session on the planner it has always opened on', () => {
    expect(plannerModeFor({ requested: PLANNER_GUIDE_MODE, isExisting: true, readOnly: false })).toBe('full')
  })

  it('offers the choice only where the guide could be entered', () => {
    expect(guidedEntryOffered({ isExisting: false, readOnly: false })).toBe(true)
    expect(guidedEntryOffered({ isExisting: true, readOnly: false })).toBe(false)
    expect(guidedEntryOffered({ isExisting: false, readOnly: true })).toBe(false)
    expect(guidedEntryOffered({ isExisting: true, readOnly: true })).toBe(false)
  })
})

// ---- moving between the steps ---------------------------------------

describe('the four steps', () => {
  it('runs basics, focus, shape, activities', () => {
    expect([...GUIDED_STEPS]).toEqual(['basics', 'focus', 'shape', 'activities'])
  })

  it('walks forwards and back over the same order', () => {
    expect(nextStep('basics')).toBe('focus')
    expect(nextStep('focus')).toBe('shape')
    expect(nextStep('shape')).toBe('activities')
    expect(previousStep('activities')).toBe('shape')
    expect(previousStep('focus')).toBe('basics')
  })

  it('ends rather than wrapping, in both directions', () => {
    // The last step finishes with Save session, not with Continue, and
    // the first step's Back leaves the guide rather than dead ending.
    expect(nextStep('activities')).toBeNull()
    expect(previousStep('basics')).toBeNull()
  })

  it('says where the coach is', () => {
    expect(stepProgressLabel('basics')).toBe('Step 1 of 4')
    expect(stepProgressLabel('activities')).toBe('Step 4 of 4')
  })

  it('refuses a step name it does not know', () => {
    expect(isGuidedStep('shape')).toBe(true)
    expect(isGuidedStep('review')).toBe(false)
    expect(isGuidedStep(2)).toBe(false)
    expect(isGuidedStep(null)).toBe(false)
  })
})

describe('moving between steps loses nothing', () => {
  const at = (step: 'basics' | 'focus' | 'shape' | 'activities') => ({
    step,
    targetMinutes: 75,
    shape: 'stations-5' as SessionShape,
    nameTouched: true,
  })

  it('carries every value the coach entered forwards', () => {
    expect(guideAdvance(at('focus'))).toEqual({ ...at('focus'), step: 'shape' })
  })

  it('carries every value the coach entered back', () => {
    expect(guideRetreat(at('shape'))).toEqual({ ...at('shape'), step: 'focus' })
  })

  it('comes back to exactly what it left, all the way there and all the way back', () => {
    const start = at('basics')
    const there = guideAdvance(guideAdvance(guideAdvance(start)))
    expect(there.step).toBe('activities')
    const back = guideRetreat(guideRetreat(guideRetreat(there)))
    expect(back).toEqual(start)
  })

  it('stops at each end rather than wrapping round to the other', () => {
    expect(guideAdvance(at('activities'))).toEqual(at('activities'))
    expect(guideRetreat(at('basics'))).toEqual(at('basics'))
  })
})

// ---- the length a coach asks for ------------------------------------

describe('the target length', () => {
  it('holds a typed number to the bounds', () => {
    expect(clampTargetMinutes(60)).toBe(60)
    expect(clampTargetMinutes(0)).toBe(MIN_TARGET_MINUTES)
    expect(clampTargetMinutes(-30)).toBe(MIN_TARGET_MINUTES)
    expect(clampTargetMinutes(9999)).toBe(MAX_TARGET_MINUTES)
    expect(clampTargetMinutes(62.4)).toBe(62)
  })

  it('answers the default rather than NaN for a cleared field', () => {
    expect(clampTargetMinutes(Number.NaN)).toBe(DEFAULT_TARGET_MINUTES)
  })
})

// ---- the session shape ----------------------------------------------

describe('the session shape, as a plan', () => {
  it('is a warm up, the middle and a games phase', () => {
    expect(sessionShapePlan('simple', 60).map((s) => s.label)).toEqual(['Warm up', 'Main activity', 'Games phase'])
    expect(sessionShapePlan('stations-4', 60).map((s) => s.label)).toEqual([
      'Warm up',
      'Station 1',
      'Station 2',
      'Station 3',
      'Station 4',
      'Games phase',
    ])
    expect(sessionShapePlan('stations-5', 75)).toHaveLength(7)
  })

  it('declares the canonical slots and nothing else', () => {
    // Read through the one structural seam rather than by comparing the
    // slot key here: a slice satisfies StructuredActivity, so the same
    // function that answers for a stored plan answers for a preview, and
    // this file adds no second reader of the vocabulary.
    const plan = sessionShapePlan('stations-4', 60)
    const structure = deriveActivityStructure(plan)
    expect(structure.declaredStations).toHaveLength(4)
    expect(structure.declaredGames).toHaveLength(1)
    expect(plan.length - structure.declaredStations.length - structure.declaredGames.length).toBe(1)
  })

  it('runs every station for the same length, because a carousel rotates together', () => {
    for (const target of [45, 50, 60, 62, 75, 90, 100]) {
      for (const shape of ['stations-4', 'stations-5'] as SessionShape[]) {
        const stations = deriveActivityStructure(sessionShapePlan(shape, target)).declaredStations
        expect(new Set(stations.map((p) => p.activity.duration)).size, `${shape} at ${target}`).toBe(1)
      }
    }
  })

  it('gives the remainder to the games phase, which is where slack goes on the night', () => {
    // 75 over seven slices is ten each with five left over.
    const plan = sessionShapePlan('stations-5', 75)
    expect(plan.map((s) => s.duration)).toEqual([10, 10, 10, 10, 10, 10, 15])
  })

  it('adds up to exactly what the coach asked for', () => {
    for (const target of [15, 30, 45, 50, 60, 62, 73, 90, 120, 240]) {
      for (const shape of SESSION_SHAPES) {
        expect(shapePlanMinutes(sessionShapePlan(shape, target)), `${shape} at ${target}`).toBe(target)
      }
    }
  })

  it('never plans an activity of no minutes, even at the floor', () => {
    for (const shape of SESSION_SHAPES) {
      for (const slice of sessionShapePlan(shape, MIN_TARGET_MINUTES)) expect(slice.duration).toBeGreaterThan(0)
    }
  })

  it('clamps an out of range target rather than planning it', () => {
    expect(shapePlanMinutes(sessionShapePlan('simple', 0))).toBe(MIN_TARGET_MINUTES)
    expect(shapePlanMinutes(sessionShapePlan('simple', 100000))).toBe(MAX_TARGET_MINUTES)
  })

  it('offers four and five stations, never three, because three is a carousel the rules warn about', () => {
    expect(SESSION_SHAPES.map(shapeStationCount)).toEqual([0, 4, 5])
  })
})

describe('applying a shape writes valid session semantics', () => {
  it('turns an empty plan into placeholder activities', () => {
    const applied = applySessionShape([], 'stations-4', 60)
    expect(applied.kind).toBe('applied')
    expect(applied.activities).toHaveLength(6)
    // Byte identical in shape to a row the existing Add custom writes,
    // plus the slot, so nothing downstream meets a new kind of activity.
    for (const a of applied.activities) {
      expect(a.title).toBe(CUSTOM_ACTIVITY_TITLE)
      expect(a.drillId).toBeUndefined()
    }
    // Nothing arrives stood down: every declared station is running.
    const structure = deriveActivityStructure(applied.activities)
    expect(structure.stations).toHaveLength(structure.declaredStations.length)
  })

  it('leaves the structure rules with nothing to warn about, for either carousel', () => {
    for (const shape of ['stations-4', 'stations-5'] as SessionShape[]) {
      const applied = applySessionShape([], shape, 60)
      const structure = deriveActivityStructure(applied.activities)
      expect(structure.warnings, shape).toEqual([])
      expect(structure.stationCount).toBe(shapeStationCount(shape))
      // Exactly one games phase, so nothing double counts a session.
      expect(structure.gamesActivity).not.toBeNull()
      expect(structure.games).toHaveLength(1)
    }
  })

  it('declares no carousel for a simple session, which is a real answer rather than a defect', () => {
    const applied = applySessionShape([], 'simple', 60)
    const structure = deriveActivityStructure(applied.activities)
    expect(structure.stationCount).toBe(0)
    // The one thing the rules say about it, and it blocks no save.
    expect(structure.warnings).toEqual(['no-stations-declared'])
    expect(structure.games).toHaveLength(1)
  })

  it('makes the plan total exactly the length asked for', () => {
    const applied = applySessionShape([], 'stations-5', 75)
    expect(sessionMinutes({ activities: applied.activities })).toBe(75)
  })

  it('replaces placeholders when the coach changes their mind', () => {
    const first = applySessionShape([], 'stations-4', 60)
    const second = applySessionShape(first.activities, 'stations-5', 60)
    expect(second.kind).toBe('applied')
    expect(deriveActivityStructure(second.activities).stationCount).toBe(5)
  })

  it('never throws away an activity carrying a drill', () => {
    const own: Activity[] = [placeholder(), { phase: 'Skill', drillId: 'd-1', duration: 12 }]
    const applied = applySessionShape(own, 'stations-4', 60)
    expect(applied.kind).toBe('kept')
    // The same array back, so nothing re-renders and nothing is rewritten.
    expect(applied.activities).toBe(own)
  })

  it('answers the same question the same way through canApplySessionShape', () => {
    expect(canApplySessionShape([])).toBe(true)
    expect(canApplySessionShape([placeholder(), placeholder({ slot: 'station' })])).toBe(true)
    expect(canApplySessionShape([{ phase: 'Skill', drillId: 'd-1', duration: 10 }])).toBe(false)
    // A row the coach titled themselves is theirs, not a placeholder.
    expect(canApplySessionShape([placeholder({ title: 'Rondo' })])).toBe(false)
  })
})

describe('a plan says which shape it is, so nothing has to be remembered', () => {
  it('round trips every shape it can write', () => {
    for (const shape of SESSION_SHAPES) {
      const applied = applySessionShape([], shape, 60)
      expect(shapeOfActivities(applied.activities), shape).toBe(shape)
    }
  })

  it('has no shape for an empty plan', () => {
    expect(shapeOfActivities([])).toBeNull()
  })

  it('reads a plan with no stations as the simple shape', () => {
    expect(shapeOfActivities([placeholder(), placeholder({ slot: 'game' })])).toBe('simple')
  })

  it('names a carousel nobody offered as none of the three rather than the nearest', () => {
    const stations = (n: number) => Array.from({ length: n }, () => placeholder({ slot: 'station' }))
    expect(shapeOfActivities(stations(3))).toBeNull()
    expect(shapeOfActivities(stations(6))).toBeNull()
  })

  it('counts a stood down station, because the plan still declares it', () => {
    const applied = applySessionShape([], 'stations-4', 60)
    const withStandDown = applied.activities.map((a, i) => (i === 1 ? { ...a, skipped: true as const } : a))
    expect(shapeOfActivities(withStandDown)).toBe('stations-4')
  })
})

// ---- the generated name ---------------------------------------------

describe('the suggested session name', () => {
  it('names one team', () => {
    expect(suggestedSessionName({ teamNames: ['Titans'], coversAllTeams: false, ageGroup: 'U9s' })).toBe('Titans training')
  })

  it('names two', () => {
    expect(suggestedSessionName({ teamNames: ['Titans', 'Trojans'], coversAllTeams: false, ageGroup: 'U9s' })).toBe(
      'Titans and Trojans training',
    )
  })

  it('says Club when the session covers every team the club has', () => {
    expect(
      suggestedSessionName({ teamNames: ['Titans', 'Trojans', 'Spartans'], coversAllTeams: true, ageGroup: 'U9s' }),
    ).toBe('Club training')
  })

  it('counts three or more that are not the whole club', () => {
    expect(
      suggestedSessionName({ teamNames: ['Titans', 'Trojans', 'Spartans'], coversAllTeams: false, ageGroup: 'U9s' }),
    ).toBe('3 teams training')
  })

  it('falls back to the age group while no team is covered', () => {
    expect(suggestedSessionName({ teamNames: [], coversAllTeams: false, ageGroup: 'U9s' })).toBe('U9s training')
  })

  it('still names something when the club has told it nothing', () => {
    expect(suggestedSessionName({ teamNames: [], coversAllTeams: false, ageGroup: '' })).toBe('Training')
    expect(suggestedSessionName({ teamNames: ['  '], coversAllTeams: false, ageGroup: '' })).toBe('Training')
  })

  it('knows a name nobody chose from one somebody wrote', () => {
    expect(sessionNameIsUntouched(NEW_SESSION_NAME)).toBe(true)
    expect(sessionNameIsUntouched('   ')).toBe(true)
    expect(sessionNameIsUntouched('Titans training')).toBe(false)
  })
})

// ---- what the guide derives on the way in ---------------------------

describe('the guide state is derived, never carried', () => {
  it('opens on the first question for a plan with nothing in it', () => {
    expect(initialGuideStep(session())).toBe('basics')
  })

  it('opens on the activities for a plan that already has some', () => {
    // The two ways of arriving with activities: switching over from the
    // full planner, and coming back from the Drill Maker, which appends
    // the created drill before it stashes.
    expect(initialGuideStep(session({ activities: [placeholder()] }))).toBe('activities')
  })

  it('takes the target from the plan once the plan has one', () => {
    const plan = applySessionShape([], 'stations-5', 75).activities
    expect(initialGuideState(session({ activities: plan })).targetMinutes).toBe(75)
  })

  it('takes the default target from an empty plan rather than zero', () => {
    expect(initialGuideState(session()).targetMinutes).toBe(DEFAULT_TARGET_MINUTES)
  })

  it('reads the shape back off the plan', () => {
    const plan = applySessionShape([], 'stations-4', 60).activities
    expect(initialGuideState(session({ activities: plan })).shape).toBe('stations-4')
    expect(initialGuideState(session()).shape).toBeNull()
  })

  it('treats a written name as settled, so re-entering never overwrites it', () => {
    expect(initialGuideState(session({ name: 'Thursday finishing' })).nameTouched).toBe(true)
    expect(initialGuideState(session()).nameTouched).toBe(false)
  })
})

// ---- what a step needs before Continue -------------------------------

describe('a step says what it still needs, and discards nothing saying it', () => {
  const state = { shape: null as SessionShape | null }

  it('is content with a new session as the planner builds one', () => {
    expect(guideStepProblem('basics', session(), state)).toBeNull()
  })

  it('asks for a name and a date', () => {
    expect(guideStepProblem('basics', session({ name: '  ' }), state)).toBe(GUIDE_PROBLEM_NAME)
    expect(guideStepProblem('basics', session({ date: '' }), state)).toBe(GUIDE_PROBLEM_DATE)
  })

  it('asks for a focus only when the coach has cleared it', () => {
    expect(guideStepProblem('focus', session(), state)).toBeNull()
    expect(guideStepProblem('focus', session({ focus: '' }), state)).toBe(GUIDE_PROBLEM_FOCUS)
  })

  it('asks for a shape until one is chosen', () => {
    expect(guideStepProblem('shape', session(), state)).toBe(GUIDE_PROBLEM_SHAPE)
    expect(guideStepProblem('shape', session(), { shape: 'simple' })).toBeNull()
  })

  it('asks nothing on the composing step, which finishes with Save rather than Continue', () => {
    expect(guideStepProblem('activities', session({ name: '', date: '', focus: '' }), state)).toBeNull()
  })

  it('does not require coverage, because the full planner does not either', () => {
    expect(guideStepProblem('basics', session({ teamIds: [] }), state)).toBeNull()
  })
})

// ---- the focus vocabulary --------------------------------------------

describe('the coaching focus reuses the vocabulary the product already has', () => {
  it('is the FA player skills, not a second list', () => {
    expect(guidedFocusOptions()).toBe(FA_PLAYER_SKILLS)
  })
})
