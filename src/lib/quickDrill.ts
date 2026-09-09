// =====================================================================
// COACH-14B: Quick drill, the fields a coach fills mid plan and what
// they become.
//
// WHAT THIS IS NOT. It is not a second way to create a drill. There is
// exactly one insert into `drills` from the client, `useInsertDrill`
// (src/lib/queries.ts), and a quick drill goes through it like every
// other: the same ownership (created_by is the coach), the same club
// (club_id from the profile), the same RLS and capability
// (drills.create), the same audit trigger and the same sharing default
// (rights is never sent, so the column's own `internal_only` applies).
// Nothing here writes, and nothing here knows the word variant. This
// module owns the FORM's model only: which fields a coach is asked for
// first, which are held back, what makes a set of answers valid, and
// how a valid set becomes the canonical `DrillInput` that insert takes.
//
// WHY A TIER MODEL RATHER THAN A LONGER FORM. COACH-11 already folds
// the drill's other twenty-odd fields under one disclosure
// (src/components/DrillFormModal.tsx), and that disclosure leads with
// the FA taxonomy: corner, skill, level, theme, format, ages. A coach
// who wants to add one coaching point scrolls past six classification
// controls to reach it. The three tiers below say which fields are
// coaching answers a coach can give from memory on the touchline
// (DETAIL) and which are library metadata (CLASSIFICATION), so the
// second group can stay behind the first rather than in front of it.
//
// PURE. Every function takes values and returns an answer. No React, no
// storage, no navigation and no mutation, so each rule is a test.
// =====================================================================
import type { DrillInput } from './queries'
import { quickDrillPreset } from './planDrillAuthoring'
import type { PlanSlot } from './planDrillAuthoring'
import type { Activity } from './data'

// What a coach fills in. `name` and `howItWorks` are prose, the four
// lists are chip editors, `space` is the one free text measurement.
// Deliberately NOT a partial `DrillInput`: the form's vocabulary is the
// coach's ("how it works", "coaching points") and the column names are
// the library's, and quickDrillInput below is where the two meet.
export interface QuickDrillFields {
  name: string
  // The one description. See THE DESCRIPTION DECISION below for why this
  // becomes `summary` rather than `setup_notes`.
  howItWorks: string
  // Minutes, and also the activity's minutes: one number rather than two
  // that could disagree, which is the rule COACH-11's plan form already
  // applies (src/components/DrillFormModal.tsx, submitToPlan).
  duration: number
  coachingPoints: string[]
  equipment: string[]
  // The area the drill needs. Becomes `area`, the column that already
  // holds "e.g. 20 x 20 yd".
  space: string
  easier: string[]
  harder: string[]
}

// Which fields a screen shows before the coach asks for more. The
// vocabulary is closed so a screen cannot invent a fourth tier, and the
// membership is stated here rather than in JSX so a test can read it.
export type QuickDrillTier = 'essential' | 'detail' | 'classification'

// Asked for immediately. Name and minutes are what the plan needs to
// hold an activity at all; the description is what makes the drill
// findable again, which is the whole difference between a quick drill
// and a custom activity.
export const QUICK_DRILL_ESSENTIAL: readonly (keyof QuickDrillFields)[] = ['name', 'howItWorks', 'duration']

// Offered under one "Add detail" disclosure. Every one is a coaching
// answer rather than a taxonomy value, so a coach can give them from
// memory without deciding how the library should file the drill.
export const QUICK_DRILL_DETAIL: readonly (keyof QuickDrillFields)[] = [
  'coachingPoints',
  'equipment',
  'space',
  'easier',
  'harder',
]

// The fields of a drill that quick drill does NOT ask for. Named rather
// than merely absent, so the reason survives: each is library
// classification or provenance, none of it changes what happens on the
// pitch tonight, and every one stays editable on the drill afterwards
// through the full form. `sourceUrl` is the one that is not merely held
// back but deliberately empty: a quick drill is the coach's own work,
// so it carries no third party attribution.
export const QUICK_DRILL_CLASSIFICATION: readonly (keyof DrillInput)[] = [
  'corner',
  'skill',
  'level',
  'ages',
  'theme',
  'format',
  'tags',
  'players',
  'mediaId',
  'setupNotes',
  'sourceUrl',
]

export function quickDrillTier(field: keyof QuickDrillFields): QuickDrillTier {
  return QUICK_DRILL_ESSENTIAL.includes(field) ? 'essential' : 'detail'
}

// The starting values. The minutes and the phase come from
// `quickDrillPreset`, which is COACH-11's own preset and the one place
// the ten minute default for a new activity is stated on this path; a
// second literal here would be a second answer to the same question.
// `from` is a custom activity row being turned into a drill, exactly as
// COACH-11 passes it, so a coach who typed a title keeps it.
export function blankQuickDrill(from: Activity | null = null): QuickDrillFields & { slot: PlanSlot } {
  const preset = quickDrillPreset(from)
  return {
    name: preset.title,
    howItWorks: '',
    duration: preset.duration,
    coachingPoints: [],
    equipment: [],
    space: '',
    easier: [],
    harder: [],
    slot: { phase: preset.phase, duration: preset.duration },
  }
}

// What can be wrong, as a closed set. A screen renders the sentence for
// each; the codes are what tests assert, so rewording a message never
// silently changes which rule fired.
export type QuickDrillProblemCode = 'name-missing' | 'duration-not-positive' | 'duration-too-long'

export interface QuickDrillProblem {
  code: QuickDrillProblemCode
  // The field the message belongs beside, so an error is never a banner
  // the coach has to match up to a control themselves.
  field: keyof QuickDrillFields
  message: string
}

// The upper bound the drill form has always applied (`max={90}` on both
// its minutes inputs). Stated once here so the rule and the input agree.
export const QUICK_DRILL_MAX_MINUTES = 90

// Validation, and it DISCARDS NOTHING: it reads the fields and returns
// what is wrong, never a corrected copy. A caller that wants the trimmed
// values takes them from quickDrillInput, which runs only once the
// answers are valid.
//
// Only two things block. Name, because `drills.title` is NOT NULL and
// because a drill nobody can name is a drill nobody finds again. Minutes,
// because the same number is the activity's duration and a plan cannot
// hold a zero minute activity honestly. Everything else is optional at
// the database, at the existing form and here, and a quick drill that
// says only what it is called and how long it runs is a real drill.
export function validateQuickDrill(fields: QuickDrillFields): QuickDrillProblem[] {
  const problems: QuickDrillProblem[] = []
  if (!fields.name.trim()) {
    problems.push({ code: 'name-missing', field: 'name', message: 'Give the drill a name so you can find it again.' })
  }
  if (!Number.isFinite(fields.duration) || fields.duration < 1) {
    problems.push({
      code: 'duration-not-positive',
      field: 'duration',
      message: 'Set how many minutes this runs for.',
    })
  } else if (fields.duration > QUICK_DRILL_MAX_MINUTES) {
    problems.push({
      code: 'duration-too-long',
      field: 'duration',
      message: `A single activity runs for at most ${QUICK_DRILL_MAX_MINUTES} minutes.`,
    })
  }
  return problems
}

export function isQuickDrillValid(fields: QuickDrillFields): boolean {
  return validateQuickDrill(fields).length === 0
}

// A chip editor can hand back a blank entry or one with stray spaces.
// Trimmed, blanks dropped, order kept.
function cleanList(values: readonly string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0)
}

// =====================================================================
// THE DESCRIPTION DECISION, stated once because it is the only place
// this module chooses between two real columns.
//
// A drill carries two prose fields. `summary` is what the library list,
// the drill card and the text search read (src/lib/drillFilter.ts
// searches title, summary, skill and tags), and it is what the public
// session projection carries. `setup_notes` is the FA session model's
// layout note and is read nowhere near search.
//
// "How it works" is one plain sentence about running the drill, and it
// goes to `summary`, because a quick drill exists to be found and used
// again and only `summary` makes that true. Writing it to `setup_notes`
// would leave every quick drill with an empty summary: unsearchable by
// its own description, blank on its library card, and blank in the
// share projection. `setupNotes` stays empty and stays editable on the
// full drill form, where a coach who wants a separate layout note has
// one.
// =====================================================================

// The canonical insert payload. Every field `DrillInput` declares is
// filled, so this cannot drift out of step with the write mapper: adding
// a column to `DrillInput` breaks this file until somebody decides what
// a quick drill should put there.
//
// TWO DEFAULTS ARE INHERITED RATHER THAN CHOSEN, and both are stated
// because a coach never sees them.
//
//   corner is null, not 'technical'. `Drill.corner` is documented as null
//   when the drill was never classified, and the existing form's create
//   default of 'technical' is visible in the Library because the corner
//   chips sit on screen. In a quick drill they are behind a disclosure,
//   so the same default would file every quick drill under Technical
//   without the coach seeing a control. Null is the honest answer, it
//   changes no phase (phaseFor maps a null corner to 'Skill', the same
//   phase quickDrillPreset already starts on), and the corner stays one
//   tap away on the drill afterwards.
//
//   level is 'Foundation', because `DrillInput.level` is not nullable and
//   the write mapper sends it unconditionally, so SOME level is stored
//   whatever this returns. 'Foundation' is what the drill form has always
//   defaulted to. It is a real default and not a coach's answer, which
//   matters because the library's Level filter is an exact match.
export function quickDrillInput(fields: QuickDrillFields): DrillInput {
  return {
    title: fields.name.trim(),
    summary: fields.howItWorks.trim(),
    corner: null,
    skill: '',
    level: 'Foundation',
    ages: [],
    duration: fields.duration,
    players: '',
    area: fields.space.trim(),
    equipment: cleanList(fields.equipment),
    points: cleanList(fields.coachingPoints),
    tags: [],
    mediaId: null,
    setupNotes: '',
    easier: cleanList(fields.easier),
    harder: cleanList(fields.harder),
    theme: '',
    format: '',
    // A quick drill is the coach's own work. An empty link stores null for
    // both source columns, so nothing claims a third party origin.
    sourceUrl: '',
  }
}
