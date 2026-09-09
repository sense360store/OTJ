// =====================================================================
// COACH-14A: the guided session builder, as rules.
//
// WHAT THIS IS. A coach pressing Plan a session meets a form that
// assumes they already know where OTJ keeps drills, week plans and
// programmes. The guide asks four short questions instead. It is a VIEW
// OVER THE CANONICAL SESSION and nothing else: every answer lands in the
// same `Session` the full planner edits, through the same setters, saved
// by the same seam (../lib/sessionSubmit). There is no second session
// shape, no wizard only field and no separate persistence.
//
// NOTHING HERE IS STORED. Every value the guide holds beyond the session
// is DERIVED from the session on the way in, which is the whole reason
// the guide survives a trip to the Drill Maker without carrying anything
// across it (COACH-11's stash envelope is untouched by this slice):
//
//   the step        the only step that can reach the Drill Maker is the
//                   activity step, and a plan that already has
//                   activities is past the first three questions, so
//                   `initialGuideStep` reads the plan.
//   the shape       materialised into the activities the moment it is
//                   chosen, and read back by `shapeOfActivities`.
//   the target      once a shape is applied the plan totals it, so
//                   `sessionMinutes` is the target.
//   name touched    a name that is not the blank default was written by
//                   somebody, so it is never regenerated over.
//
// A guide that had to carry state across that trip would be a second
// draft contract beside the one COACH-11 settled. Deriving costs nothing
// and cannot fall out of step with the session, because the session is
// the only copy.
//
// PURE, AND NO REACT. The React half is ../components/GuidedPlanner.tsx
// and the host is ../routes/Planner.tsx, which owns the one canonical
// draft in both modes.
// =====================================================================
import { CUSTOM_ACTIVITY_TITLE } from './planDrillAuthoring'
import { activeActivityMinutes, deriveActivityStructure, type ActivitySlot } from './activityStructure'
import { FA_PLAYER_SKILLS } from './fa'
import { sessionMinutes, NEW_SESSION_NAME } from './data'
import type { Activity, Phase, Session } from './data'

// ---- The mode, and how a coach gets into it -------------------------
//
// The guide is a query parameter on the planner's own address rather
// than a path segment, and that is load bearing rather than a
// preference. `safeReturnPath` (../lib/authoringReturn) allows a return
// address only where the allowlisted prefix is the WHOLE segment, so
// '/planner?mode=guide' is accepted and '/planner/guide' is refused. A
// path segment would have needed the COACH-11 allowlist widened, which
// is the security boundary that decides where the Drill Maker may send
// a coach back to. A parameter needs nothing widened: the token strip on
// the way back deletes only its own key and leaves this one alone.
export const PLANNER_MODE_PARAM = 'mode'
export const PLANNER_GUIDE_MODE = 'guide'

export type PlannerMode = 'full' | 'guide'

// Who may be in the guide, decided in one place.
//
// A NEW, EDITABLE session and nothing else. A read only viewer never
// enters, and neither does an existing session: the roadmap's journey
// is creation, and an edit that dropped a coach into step one over a
// plan they had already written would be a worse screen than the one
// they asked for. The read only arm is stated rather than left to the
// implication that a read only session is always an existing one,
// because that implication is what a future caller would break.
export function plannerModeFor(input: {
  requested: string | null
  isExisting: boolean
  readOnly: boolean
}): PlannerMode {
  if (input.readOnly || input.isExisting) return 'full'
  return input.requested === PLANNER_GUIDE_MODE ? 'guide' : 'full'
}

// Whether the planner offers the choice at all. The same answer as
// above, asked before a mode is requested.
export function guidedEntryOffered(input: { isExisting: boolean; readOnly: boolean }): boolean {
  return !input.isExisting && !input.readOnly
}

export const GUIDED_ENTRY_TITLE = 'How would you like to plan this session?'
export const GUIDED_ENTRY_GUIDE_LABEL = 'Build session with guide'
export const GUIDED_ENTRY_FULL_LABEL = 'Use full planner'
export const GUIDED_ENTRY_GUIDE_NOTE = 'Four short questions, then build the activities.'
export const GUIDED_ENTRY_FULL_NOTE = 'Every field at once, which is the planner below.'
export const GUIDED_EXIT_LABEL = 'Use full planner'
export const GUIDED_EXIT_NOTE = 'Everything you have entered is kept.'

// The session fields the guide writes. A strict subset of the planner's
// own SessionFieldKey, declared here rather than imported so a component
// under components/ never imports from routes/. The compiler is what
// keeps the two in step: the host passes its own setField straight in,
// so a key added here that the planner does not carry fails to compile.
export type GuidedField = 'name' | 'date' | 'time' | 'ageGroup' | 'focus'

// ---- The four steps -------------------------------------------------

export type GuidedStep = 'basics' | 'focus' | 'shape' | 'activities'

export const GUIDED_STEPS: readonly GuidedStep[] = ['basics', 'focus', 'shape', 'activities']

// The short label in the progress list, and the question the step asks.
// One meaningful decision per step, so each heading is a question rather
// than a section name.
export const GUIDED_STEP_LABELS: Record<GuidedStep, string> = {
  basics: 'Session',
  focus: 'Focus',
  shape: 'Shape',
  activities: 'Activities',
}

export const GUIDED_STEP_HEADINGS: Record<GuidedStep, string> = {
  basics: 'Who is training, and when?',
  focus: 'What do you want the players to get better at?',
  shape: 'How should the session be shaped?',
  activities: 'Build the activities',
}

export const GUIDED_STEP_HINTS: Record<GuidedStep, string> = {
  basics: 'What OTJ knows is filled in already. Check the date and change anything that is wrong.',
  focus: 'Pick one, or type your own. It guides the plan and never locks it.',
  shape: 'A starting structure, not a rule. You can change every activity next.',
  activities: 'Add drills, reorder them and set the minutes. Nothing is saved until you press Save session.',
}

export function stepIndex(step: GuidedStep): number {
  return GUIDED_STEPS.indexOf(step)
}

export function isGuidedStep(value: unknown): value is GuidedStep {
  return typeof value === 'string' && (GUIDED_STEPS as readonly string[]).includes(value)
}

// The step after this one, or null at the end. Null is the answer for
// the last step rather than a wrap: the activity step finishes with Save
// session, not with Continue.
export function nextStep(step: GuidedStep): GuidedStep | null {
  return GUIDED_STEPS[stepIndex(step) + 1] ?? null
}

// The step before this one, or null at the start. Null is what makes the
// first step's Back leave the guide rather than dead end.
export function previousStep(step: GuidedStep): GuidedStep | null {
  const i = stepIndex(step)
  return i > 0 ? GUIDED_STEPS[i - 1] : null
}

// "Step 2 of 4", so a coach can always see where they are.
export function stepProgressLabel(step: GuidedStep): string {
  return `Step ${stepIndex(step) + 1} of ${GUIDED_STEPS.length}`
}

// The id of the heading each step moves focus to when it changes. A step
// change is a navigation, so focus goes to the new step's heading, the
// same thing a route change should do. It is NOT the restore case
// ../hooks/useFocusRestore owns, which is about an async settle taking
// focus away; this move is deliberate and unconditional, so it must not
// borrow that hook's "only when focus was lost" guard.
export const GUIDED_STEP_HEADING_ID = 'guided-step-heading'

// The refusal beside Continue, so the control can POINT at the sentence
// that accounts for it rather than the sentence merely sitting near it.
export const GUIDE_PROBLEM_ID = 'guided-step-problem'

// ---- The coaching focus ---------------------------------------------
//
// NO NEW VOCABULARY, AND NO NEW TABLE. The chips are the FA player
// skills the product already carries (./fa), which is the same list a
// drill's `skill` is chosen from, so a focus a coach picks here is a
// word the library is already indexed by. The answer lands in
// `sessions.focus`, which has always been free text, and the free text
// field beside the chips is the same field: a coach who wants "playing
// out from the back" types it and nothing refuses them.
//
// The roadmap names a few focuses the FA list does not carry (1v1
// attacking, 1v1 defending, playing out). Adding them would mean either
// editing the FA taxonomy, which is a record of what the FA publishes,
// or starting a second list beside it. Both are worse than a text field
// that already accepts them, so COACH-14A ships neither.
export const GUIDED_FOCUS_GROUP_LABEL = 'Common focuses'
// Named for what it takes, not only for what it is instead of: a screen
// reader announces the label alone, and "Or type your own" answers
// nothing on its own.
export const GUIDED_FOCUS_OWN_LABEL = 'Or type your own focus'

export const guidedFocusOptions = (): readonly string[] => FA_PLAYER_SKILLS

// ---- The session shape ----------------------------------------------
//
// Three starting structures, and every one of them is the CANONICAL
// activity structure (./activityStructure): a station is `slot:
// 'station'`, the games phase is `slot: 'game'`, and nothing else is
// declared. No new role model, no new column and nothing stored that
// says a plan came from the guide.

export type SessionShape = 'simple' | 'stations-4' | 'stations-5'

export const SESSION_SHAPES: readonly SessionShape[] = ['simple', 'stations-4', 'stations-5']

export const SESSION_SHAPE_LABELS: Record<SessionShape, string> = {
  simple: 'Simple session',
  'stations-4': 'Four stations',
  'stations-5': 'Five stations',
}

export const SESSION_SHAPE_NOTES: Record<SessionShape, string> = {
  simple: 'A warm up, one main activity and a game.',
  'stations-4': 'A warm up, a four station carousel and a game.',
  'stations-5': 'A warm up, a five station carousel and a game.',
}

// How many carousel stations each shape declares. Four and five are the
// only counts a carousel runs (MIN_STATIONS and MAX_STATIONS in
// ./activityStructure), which is why there is no three station option:
// the structure rules would warn about it the moment it was applied.
export function shapeStationCount(shape: SessionShape): number {
  return shape === 'stations-4' ? 4 : shape === 'stations-5' ? 5 : 0
}

// What a coach asks for on the first step, and the bounds it is held to.
// The floor keeps every slice at a minute or more; the ceiling keeps
// every slice inside the activity editor's own 90 minute field.
export const MIN_TARGET_MINUTES = 15
export const MAX_TARGET_MINUTES = 240
export const DEFAULT_TARGET_MINUTES = 60

// The lengths a coach picks from in one tap, before reaching for the
// number field.
export const TARGET_MINUTE_PRESETS: readonly number[] = [45, 60, 75, 90]

export function clampTargetMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TARGET_MINUTES
  return Math.min(MAX_TARGET_MINUTES, Math.max(MIN_TARGET_MINUTES, Math.round(value)))
}

// TYPING IS NOT COMMITTING, and clamping every keystroke is why that
// matters. A coach reaching for 75 types a 7 first, and a field that
// clamped as they typed turned it into 15 before they could reach the 5;
// the number they wanted was unreachable and the field could not be
// cleared. So the state holds what they typed, every reader clamps, and
// the value settles when they leave the field.
//
// Zero is how a CLEARED field is carried, which is why it is not simply
// clamped up: a coach who empties the box and leaves wants the default
// back, not the floor.
export function targetMinutesOnBlur(typed: number): number {
  return typed > 0 ? clampTargetMinutes(typed) : DEFAULT_TARGET_MINUTES
}

// What the field shows while they type. An empty box rather than a zero
// they would have to delete before typing anything.
export function targetMinutesFieldValue(typed: number): number | '' {
  return typed > 0 ? typed : ''
}

// One slice of a shape: what it is called on the preview, what it
// becomes in the plan, and how long it runs.
export interface ShapeSlice {
  label: string
  phase: Phase
  slot?: ActivitySlot
  duration: number
}

// THE ONE DIVISION, read by the preview a coach sees and by the
// activities that are created, so the two cannot disagree.
//
// EVERY STATION RUNS THE SAME LENGTH, because that is what a carousel
// is: the groups rotate together. So the remainder cannot be spread
// across the stations, and it goes to the games phase, which is the one
// slice that absorbs slack on a real night. The warm up takes the same
// base length as a station.
export function sessionShapePlan(shape: SessionShape, targetMinutes: number): ShapeSlice[] {
  const target = clampTargetMinutes(targetMinutes)
  const stations = shapeStationCount(shape)
  // Warm up, the middle (one activity, or the stations), and the game.
  const slices = stations === 0 ? 3 : stations + 2
  const base = Math.max(1, Math.floor(target / slices))
  const before = base * (slices - 1)
  const game = Math.max(1, target - before)

  const out: ShapeSlice[] = [{ label: 'Warm up', phase: 'Warm-Up', duration: base }]
  if (stations === 0) out.push({ label: 'Main activity', phase: 'Skill', duration: base })
  else {
    for (let n = 1; n <= stations; n++) out.push({ label: `Station ${n}`, phase: 'Skill', slot: 'station', duration: base })
  }
  out.push({ label: 'Games phase', phase: 'Game', slot: 'game', duration: game })
  return out
}

// What the preview's total says, taken from the slices rather than from
// the target, so a clamped or rounded target cannot be advertised as
// something the plan will not add up to.
//
// Through the shared seam rather than a reduce of its own. A slice
// satisfies StructuredActivity (a duration and an optional slot), so the
// preview total and the total the plan will report once those slices
// become activities are literally the same function, and this file adds
// no fifth answer to how long a session runs.
export function shapePlanMinutes(plan: readonly ShapeSlice[]): number {
  return activeActivityMinutes(plan)
}

// A slice as a plan row. It is BYTE IDENTICAL in shape to the row the
// existing Add custom button writes, plus the structural slot: same
// placeholder title, no drill, so every reader downstream is already
// proved against it and "Turn into a drill" (COACH-11) treats it as the
// custom row it is. That path keeps the slot, so turning Station 3 into
// a drill leaves Station 3 a station.
function sliceActivity(slice: ShapeSlice): Activity {
  const activity: Activity = { phase: slice.phase, title: CUSTOM_ACTIVITY_TITLE, duration: slice.duration }
  return slice.slot ? { ...activity, slot: slice.slot } : activity
}

// A row this module could have written: an empty placeholder. Used to
// decide whether a shape may be applied over what is already there.
function isPlaceholder(activity: Activity): boolean {
  return !activity.drillId && activity.title === CUSTOM_ACTIVITY_TITLE
}

// Whether choosing a shape may rewrite the plan.
//
// ONLY OVER EMPTINESS. A plan that is empty, or that holds nothing but
// placeholders, has no work in it to lose. The moment one row carries a
// real drill the plan is the coach's, and a second press on the shape
// step must not throw it away: the choice is recorded, the plan is left
// exactly as it is, and the step says so. Losing an empty row's minutes
// is worth the simplicity; losing a chosen drill never is.
export function canApplySessionShape(activities: readonly Activity[]): boolean {
  return activities.every(isPlaceholder)
}

export type ShapeApplication =
  | { kind: 'applied'; activities: Activity[] }
  | { kind: 'kept'; activities: Activity[] }

// A starting shape starts an EMPTY plan. Once a coach has chosen a drill
// there is nothing for it to start, so the choice goes inert and says so,
// rather than staying pressable and doing nothing.
export const SHAPE_KEPT_NOTE =
  'This plan already has activities, so a starting shape has nothing to add. Change them on the next step.'

export function applySessionShape(
  activities: readonly Activity[],
  shape: SessionShape,
  targetMinutes: number,
): ShapeApplication {
  if (!canApplySessionShape(activities)) return { kind: 'kept', activities: activities as Activity[] }
  return { kind: 'applied', activities: sessionShapePlan(shape, targetMinutes).map(sliceActivity) }
}

// Which shape a plan currently reads as, or null when it reads as none
// of them. Derived from the canonical structure rather than remembered,
// which is what lets the guide be re-entered, left for the Drill Maker
// and come back without carrying a shape anywhere.
//
// An empty plan has no shape. A plan declaring four or five stations is
// that carousel however it was built. A plan declaring no stations at
// all is the simple shape. Anything else (one to three stations, or six
// and up) is a plan the coach built themselves and is named as none of
// the three rather than rounded to the nearest.
export function shapeOfActivities(activities: readonly Activity[]): SessionShape | null {
  if (activities.length === 0) return null
  const declared = deriveActivityStructure(activities).declaredStations.length
  if (declared === 0) return 'simple'
  if (declared === 4) return 'stations-4'
  if (declared === 5) return 'stations-5'
  return null
}

// ---- The generated session name -------------------------------------

// A name a coach can accept without typing, from what the club already
// knows. Deliberately short and deliberately without the date: the date
// is its own field on the same step and every session list shows it, so
// putting it in the name is asking twice.
export function suggestedSessionName(input: {
  teamNames: readonly string[]
  coversAllTeams: boolean
  ageGroup: string
}): string {
  const names = input.teamNames.filter((n) => n.trim() !== '')
  const who =
    names.length === 0
      ? input.ageGroup.trim()
      : input.coversAllTeams
        ? 'Club'
        : names.length === 1
          ? names[0]
          : names.length === 2
            ? `${names[0]} and ${names[1]}`
            : `${names.length} teams`
  return who === '' ? 'Training' : `${who} training`
}

// Whether a name was written by somebody, so the suggestion must not
// overwrite it. The blank default is the one name nobody chose.
//
// The FULL PLANNER reads this too, for the other half of the same
// problem. Its name field starts on that default as real content rather
// than as a placeholder, so a coach who taps it and types gets
// "New SessionSmoke Test": production did exactly that. Both name fields
// select the default when it is focused, so typing replaces it, and
// neither touches a name somebody wrote.
export function sessionNameIsUntouched(name: string): boolean {
  const trimmed = name.trim()
  return trimmed === '' || trimmed === NEW_SESSION_NAME
}

// ---- The guide's own state ------------------------------------------
//
// Three values, every one of them seeded from the canonical session.
// They live in React state for the life of the guided view, which is
// what makes Back and Continue lossless: moving between steps changes
// `step` and touches nothing else.

export interface GuideState {
  step: GuidedStep
  targetMinutes: number
  shape: SessionShape | null
  // True once the coach has written a name, so the suggestion stops
  // being applied over it.
  nameTouched: boolean
}

// Where a coach entering the guide lands. A plan that already holds
// activities is past the first three questions, which is the honest
// answer for the two ways of arriving with one: switching over from the
// full planner, and coming back from the Drill Maker.
export function initialGuideStep(session: Pick<Session, 'activities'>): GuidedStep {
  return session.activities.length > 0 ? 'activities' : 'basics'
}

export function initialGuideState(session: Pick<Session, 'activities' | 'name'>): GuideState {
  const minutes = sessionMinutes({ activities: session.activities })
  return {
    step: initialGuideStep(session),
    targetMinutes: minutes > 0 ? clampTargetMinutes(minutes) : DEFAULT_TARGET_MINUTES,
    shape: shapeOfActivities(session.activities),
    nameTouched: !sessionNameIsUntouched(session.name),
  }
}

// Moving between steps changes THE STEP AND NOTHING ELSE, and that is
// the whole of "Back and Continue preserve the draft exactly". The
// session is not here to be touched (it is the host's), and the three
// values that are here ride through untouched. Written as functions so
// the claim is a test rather than a promise about a spread somebody
// might narrow later.
export function guideAdvance(state: GuideState): GuideState {
  const to = nextStep(state.step)
  return to === null ? state : { ...state, step: to }
}

export function guideRetreat(state: GuideState): GuideState {
  const to = previousStep(state.step)
  return to === null ? state : { ...state, step: to }
}

// What a press on Continue does, INCLUDING the guard. It is one function
// rather than an early return in the handler because an early return is
// one line for somebody to drop: removing it advances the coach past a
// step that still needs an answer, and every test still passed. Written
// this way, a refusal returns the state it was given, so "Continue never
// moves past an unanswered question" is a property of a tested function
// rather than of a handler's shape.
export function guideContinue(state: GuideState, problem: string | null): GuideState {
  return problem === null ? guideAdvance(state) : state
}

// ---- What a step needs before Continue ------------------------------
//
// A refusal NEVER discards anything: it is a sentence beside the
// control, computed from the draft, and the draft is untouched. There is
// no submit here and nothing to lose.
//
// Deliberately narrow. Coverage is not required, because the full
// planner does not require it either and says so in its own words; a
// guide that blocked on it would be stricter than the screen it is a
// gentler path to.

export const GUIDE_PROBLEM_NAME = 'Give the session a name.'
export const GUIDE_PROBLEM_DATE = 'Choose a date.'
export const GUIDE_PROBLEM_FOCUS = 'Choose a focus, or type your own.'
export const GUIDE_PROBLEM_SHAPE = 'Choose a session shape.'

export function guideStepProblem(
  step: GuidedStep,
  session: Pick<Session, 'name' | 'date' | 'focus' | 'activities'>,
  state: Pick<GuideState, 'shape'>,
): string | null {
  if (step === 'basics') {
    if (session.name.trim() === '') return GUIDE_PROBLEM_NAME
    if (session.date.trim() === '') return GUIDE_PROBLEM_DATE
    return null
  }
  if (step === 'focus') return session.focus.trim() === '' ? GUIDE_PROBLEM_FOCUS : null
  // A shape is asked for only where one could be applied. A coach who has
  // already chosen drills is past the question, and refusing to let them
  // continue over a choice that would change nothing is a dead end.
  if (step === 'shape') {
    if (!canApplySessionShape(session.activities)) return null
    return state.shape === null ? GUIDE_PROBLEM_SHAPE : null
  }
  return null
}

// The teams line the first step states rather than leaves silent. The
// planner's own wording for an empty coverage, so the two screens agree.
export const GUIDE_NO_TEAMS_NOTE = 'No teams selected, so the register will list nobody.'
