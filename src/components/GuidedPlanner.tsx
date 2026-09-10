// =====================================================================
// COACH-14A: the guided session builder, the React half.
//
// A VIEW OVER THE HOST'S DRAFT, NOT A SECOND ONE. Every control here
// writes into the planner's own `session` state through the planner's
// own setters, and this component holds no copy of it. That is what
// makes "switching to the full planner keeps everything" true by
// construction rather than by a copy step nobody can see: the two modes
// are two renderings of one `useState<Session>`, and the mode is not
// part of it.
//
// WHAT THIS COMPONENT DOES OWN is three values, all of them derived
// from that session on the way in (../lib/guidedSession explains why
// none of them is stored): which step is showing, the length the coach
// asked for, and which shape they picked. It is mounted only while the
// planner is in guide mode, which is deliberate: leaving the guide
// discards those three and re-entering derives them again from the
// plan, so they can never disagree with it.
//
// FOCUS MOVES ON A STEP CHANGE, and that is not the restore case
// ../hooks/useFocusRestore owns. A restore only acts when an async
// settle dropped focus to the body; this is a navigation, so it moves
// focus unconditionally to the new step's heading, which is what a
// route change should do. There is no DOM in this project's tests, so
// what is testable here is the heading being focusable and carrying the
// id the effect aims at; the move itself is a browser check.
//
// The activity composer is NOT rebuilt here. The host passes the one
// shared ActivityListEditor it already mounts (COACH-10), with its add
// bar, its drag handles, its role controls and its COACH-11 authoring
// affordances, so the guide's last step is the same composer the full
// planner shows and interdependent activity work is not split across
// wizard pages.
// =====================================================================
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import { Chip } from './ui'
import { Button, Card, Note, SelectField, TextField } from './primitives'
import { CoveredTeamsField } from './CoveredTeamsField'
import { ageGroupOptions } from '../lib/ageGroups'
import type { Activity, Session, Team } from '../lib/data'
import {
  applySessionShape,
  canApplySessionShape,
  clampTargetMinutes,
  GUIDED_EXIT_LABEL,
  GUIDED_EXIT_NOTE,
  GUIDED_FOCUS_GROUP_LABEL,
  GUIDED_FOCUS_OWN_LABEL,
  GUIDE_PROBLEM_ID,
  GUIDED_STEP_HEADING_ID,
  GUIDED_STEP_HEADINGS,
  GUIDED_STEP_HINTS,
  GUIDED_STEP_LABELS,
  GUIDED_STEPS,
  guidedFocusOptions,
  guideContinue,
  guideRetreat,
  guideStepProblem,
  initialGuideState,
  MAX_TARGET_MINUTES,
  MIN_TARGET_MINUTES,
  nextStep,
  previousStep,
  SESSION_SHAPE_LABELS,
  SESSION_SHAPE_NOTES,
  SESSION_SHAPES,
  sessionNameIsUntouched,
  sessionShapePlan,
  SHAPE_KEPT_NOTE,
  shapePlanMinutes,
  stepIndex,
  stepProgressLabel,
  suggestedSessionName,
  TARGET_MINUTE_PRESETS,
  targetMinutesFieldValue,
  targetMinutesOnBlur,
  type GuidedField,
  type GuideState,
  type SessionShape,
} from '../lib/guidedSession'
import './GuidedPlanner.css'

// The choice a coach meets on a new session, before either surface has
// asked them anything. It never replaces the planner: the full form is
// on the same screen underneath, so nothing that worked before this
// slice needs a press to reach.
export function GuidedEntryChoice({
  title,
  guideLabel,
  guideNote,
  fullLabel,
  fullNote,
  disabled,
  onGuide,
  onFull,
}: {
  title: string
  guideLabel: string
  guideNote: string
  fullLabel: string
  fullNote: string
  disabled: boolean
  onGuide: () => void
  onFull: () => void
}) {
  return (
    <Card className="guide-entry" padded>
      <h2 className="guide-entry-title">{title}</h2>
      <div className="guide-entry-choices">
        <button type="button" className="guide-choice" disabled={disabled} onClick={onGuide}>
          <span className="guide-choice-name">
            <Icon.list />
            {guideLabel}
          </span>
          <span className="guide-choice-note">{guideNote}</span>
        </button>
        <button type="button" className="guide-choice" disabled={disabled} onClick={onFull}>
          <span className="guide-choice-name">
            <Icon.layers />
            {fullLabel}
          </span>
          <span className="guide-choice-note">{fullNote}</span>
        </button>
      </div>
    </Card>
  )
}

// The progress list. Not links: a coach moves with Back and Continue,
// and a step they have not answered is not somewhere to jump to. It
// carries aria-current so the position is exposed rather than being
// conveyed by colour alone.
export function GuidedProgress({ step }: { step: GuideState['step'] }) {
  const at = stepIndex(step)
  return (
    <nav className="guide-progress" aria-label="Session builder steps">
      <ol className="guide-steps">
        {GUIDED_STEPS.map((s, i) => {
          const current = s === step
          return (
            <li
              key={s}
              className={'guide-step' + (current ? ' on' : '') + (i < at ? ' done' : '')}
              aria-current={current ? 'step' : undefined}
            >
              <span className="guide-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="guide-step-label">{GUIDED_STEP_LABELS[s]}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export interface GuidedPlannerProps {
  // The host's canonical draft. Read only here; every change leaves
  // through a callback below.
  session: Session
  teams: Team[]
  // The club's age group list, or undefined while the club read has not
  // answered; the control then offers the standard defaults and always
  // the session's own current label (../lib/ageGroups).
  ageGroups?: readonly string[]
  // The planner's freeze while a write is in flight, so a guided
  // control cannot change a draft that is being written.
  busy: boolean
  // The plan's minutes, through the host's own call to the shared seam
  // (sessionMinutes), so this file adds no second duration answer.
  totalMinutes: number
  onField: (key: GuidedField, value: string) => void
  onToggleTeam: (teamId: string) => void
  onAllTeams: () => void
  onActivities: (next: Activity[]) => void
  // Leave the guide for the full planner, keeping the draft.
  onExit: () => void
  // The one shared activity list editor, mounted by the host.
  composer: ReactNode
  // The host's actions card: Save, Start and Share through the one
  // guarded submit seam.
  actions: ReactNode
}

export function GuidedPlanner({
  session,
  teams,
  ageGroups,
  busy,
  totalMinutes,
  onField,
  onToggleTeam,
  onAllTeams,
  onActivities,
  onExit,
  composer,
  actions,
}: GuidedPlannerProps) {
  const [state, setState] = useState<GuideState>(() => initialGuideState(session))
  // A refusal is shown only after the coach presses Continue, so a step
  // does not open with a complaint about a field they have not reached.
  // It clears on every move, and it discards nothing either way.
  const [refused, setRefused] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  const { step } = state
  const problem = guideStepProblem(step, session, state)
  const back = previousStep(step)
  const forward = nextStep(step)

  // Focus follows the step. Deliberate and unconditional: a step change
  // is a navigation, and the heading names where the coach has arrived.
  useEffect(() => {
    heading.current?.focus()
  }, [step])

  // The generated name, kept in step with the teams and age group until
  // the coach writes one of their own. It is an effect rather than a
  // press handler because the team list answers AFTER the first render
  // (the planner seeds the club's teams when it lands), so a coach who
  // opened the guide before that read would otherwise be looking at the
  // blank default with nothing to prompt them. It converges in one
  // pass: it writes only when the suggestion differs, and `nameTouched`
  // stops it for good the moment the coach types.
  const coversAllTeams = teams.length > 0 && teams.every((t) => session.teamIds.includes(t.id))
  const suggestion = suggestedSessionName({
    teamNames: teams.filter((t) => session.teamIds.includes(t.id)).map((t) => t.name),
    coversAllTeams,
    ageGroup: session.ageGroup,
  })
  useEffect(() => {
    if (state.nameTouched || suggestion === session.name) return
    onField('name', suggestion)
    // The host's setField is rebuilt on every render, so it is
    // deliberately not a dependency: this effect is about the suggestion
    // changing, and naming the setter would run it on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion, session.name, state.nameTouched])

  // Both moves go through the pure transitions, which change the step
  // and nothing else, so nothing a coach entered can be lost by walking
  // the guide backwards and forwards.
  const onBack = () => {
    setRefused(false)
    setState(guideRetreat)
  }
  const onContinue = () => {
    setRefused(problem !== null)
    setState((s) => guideContinue(s, problem))
  }
  // Typing holds what was typed; every reader clamps. Nothing is applied
  // to the plan from a keystroke.
  const typeTarget = (minutes: number) => setState((s) => ({ ...s, targetMinutes: minutes }))
  // Committing settles the value AND re-divides the plan, when the plan is
  // still the shape's to write. Without that second half a coach who went
  // back and changed 60 to 75 got a shape step promising 75 over a plan
  // that still totalled 60, and nothing on the screen said which was true.
  const applyShape = (shape: SessionShape, minutes: number) => {
    const applied = applySessionShape(session.activities, shape, minutes)
    if (applied.kind === 'applied') onActivities(applied.activities)
  }
  const commitTarget = (typed: number) => {
    const minutes = targetMinutesOnBlur(typed)
    setState((s) => ({ ...s, targetMinutes: minutes }))
    if (state.shape) applyShape(state.shape, minutes)
  }
  const chooseShape = (shape: SessionShape) => {
    setRefused(false)
    setState((s) => ({ ...s, shape }))
    applyShape(shape, state.targetMinutes)
  }

  return (
    // aria-busy while a write settles, the same mark PlannerWorkspace puts
    // on the full planner: the guided surface freezes the same controls
    // for the same reason, so it owes assistive technology the same notice.
    <div className="guide" aria-busy={busy}>
      <GuidedProgress step={step} />

      <Card className="guide-card" padded>
        <div className="eyebrow">{stepProgressLabel(step)}</div>
        <h2 className="guide-heading" id={GUIDED_STEP_HEADING_ID} tabIndex={-1} ref={heading}>
          {GUIDED_STEP_HEADINGS[step]}
        </h2>
        <p className="guide-hint">{GUIDED_STEP_HINTS[step]}</p>

        {step === 'basics' && (
          <GuidedBasicsStep
            session={session}
            teams={teams}
            ageGroups={ageGroups}
            busy={busy}
            targetMinutes={state.targetMinutes}
            onField={onField}
            onName={(v) => {
              setState((s) => ({ ...s, nameTouched: true }))
              onField('name', v)
            }}
            onToggleTeam={onToggleTeam}
            onAllTeams={onAllTeams}
            onType={typeTarget}
            onCommit={commitTarget}
          />
        )}
        {step === 'focus' && <GuidedFocusStep focus={session.focus} busy={busy} onFocus={(v) => onField('focus', v)} />}
        {step === 'shape' && (
          <GuidedShapeStep
            activities={session.activities}
            shape={state.shape}
            targetMinutes={state.targetMinutes}
            totalMinutes={totalMinutes}
            busy={busy}
            onShape={chooseShape}
          />
        )}
        {step === 'activities' && (
          <GuidedActivitiesStep totalMinutes={totalMinutes} count={session.activities.length} composer={composer} actions={actions} />
        )}

        {refused && problem !== null && (
          <Note tone="warning" role="alert" id={GUIDE_PROBLEM_ID} className="guide-problem">
            {problem}
          </Note>
        )}
      </Card>

      <div className="guide-foot">
        {back && (
          <Button variant="quiet" icon={Icon.chevL} disabled={busy} onClick={onBack}>
            Back
          </Button>
        )}
        {forward && (
          <Button
            variant="primary"
            disabled={busy}
            aria-describedby={refused && problem !== null ? GUIDE_PROBLEM_ID : undefined}
            onClick={onContinue}
          >
            Continue
          </Button>
        )}
        <Button variant="ghost" className="guide-exit" disabled={busy} onClick={onExit}>
          {GUIDED_EXIT_LABEL}
        </Button>
      </div>
      <p className="guide-foot-note">{GUIDED_EXIT_NOTE}</p>
    </div>
  )
}

// ---- The four steps -------------------------------------------------
//
// Each one is exported and takes plain props, for the reason the
// planner's own views are: this project renders statically with no DOM,
// so a step reachable only by pressing Continue is a step no test can
// see. Exported, every one of them renders on its own and its markup is
// asserted; what a press does is proved over the pure rules.

// ---- Step one: who is training, and when ----------------------------

export function GuidedBasicsStep({
  session,
  teams,
  ageGroups,
  busy,
  targetMinutes,
  onField,
  onName,
  onToggleTeam,
  onAllTeams,
  onType,
  onCommit,
}: {
  session: Session
  teams: Team[]
  ageGroups?: readonly string[]
  busy: boolean
  targetMinutes: number
  onField: (key: GuidedField, value: string) => void
  onName: (value: string) => void
  onToggleTeam: (teamId: string) => void
  onAllTeams: () => void
  // While the coach types: what they typed, unclamped.
  onType: (minutes: number) => void
  // When they settle on it: a preset press, or leaving the field.
  onCommit: (minutes: number) => void
}) {
  return (
    <div className="guide-body">
      <TextField
        label="Session name"
        value={session.name}
        disabled={busy}
        hint="Suggested from the teams and age group. Change it to anything."
        onFocus={(e) => {
          // The suggestion is content rather than a placeholder, so a
          // coach who taps in and types would otherwise append to it.
          if (sessionNameIsUntouched(e.target.value)) e.target.select()
        }}
        onChange={(e) => onName(e.target.value)}
      />
      <div className="guide-pair">
        <TextField
          label="Date"
          type="date"
          value={session.date}
          disabled={busy}
          onChange={(e) => onField('date', e.target.value)}
        />
        <TextField
          label="Time"
          type="time"
          value={session.time}
          disabled={busy}
          onChange={(e) => onField('time', e.target.value)}
        />
      </div>
      <SelectField
        label="Age group"
        value={session.ageGroup}
        disabled={busy}
        onChange={(e) => onField('ageGroup', e.target.value)}
      >
        {ageGroupOptions(ageGroups, session.ageGroup).map((a) => (
          <option key={a}>{a}</option>
        ))}
      </SelectField>
      <CoveredTeamsField
        teams={teams}
        selected={session.teamIds}
        disabled={busy}
        readOnly={false}
        onToggle={onToggleTeam}
        onAll={onAllTeams}
      />
      <div className="field">
        <span className="guide-group-label" id="guide-length-label">
          About how long?
        </span>
        <div className="row wrap guide-mins" role="group" aria-labelledby="guide-length-label">
          {TARGET_MINUTE_PRESETS.map((m) => (
            <Chip key={m} on={targetMinutes === m} disabled={busy} onClick={() => onCommit(m)}>
              {m} min
            </Chip>
          ))}
        </div>
      </div>
      <TextField
        label="Session length in minutes"
        type="number"
        className="guide-mins-field"
        min={MIN_TARGET_MINUTES}
        max={MAX_TARGET_MINUTES}
        value={targetMinutesFieldValue(targetMinutes)}
        disabled={busy}
        hint={`Between ${MIN_TARGET_MINUTES} and ${MAX_TARGET_MINUTES} minutes.`}
        onChange={(e) => onType(parseInt(e.target.value) || 0)}
        onBlur={(e) => onCommit(parseInt(e.target.value) || 0)}
      />
    </div>
  )
}

// ---- Step two: the coaching focus -----------------------------------

export function GuidedFocusStep({ focus, busy, onFocus }: { focus: string; busy: boolean; onFocus: (value: string) => void }) {
  return (
    <div className="guide-body">
      <div className="field">
        <span className="guide-group-label" id="guide-focus-label">
          {GUIDED_FOCUS_GROUP_LABEL}
        </span>
        <div className="row wrap guide-focuses" role="group" aria-labelledby="guide-focus-label">
          {guidedFocusOptions().map((s) => (
            <Chip key={s} on={focus === s} disabled={busy} onClick={() => onFocus(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>
      <TextField label={GUIDED_FOCUS_OWN_LABEL} value={focus} disabled={busy} onChange={(e) => onFocus(e.target.value)} />
    </div>
  )
}

// ---- Step three: the session shape ----------------------------------

export function GuidedShapeStep({
  activities,
  shape,
  targetMinutes,
  totalMinutes,
  busy,
  onShape,
}: {
  activities: Activity[]
  shape: SessionShape | null
  targetMinutes: number
  // What the plan actually totals now, through the shared seam.
  totalMinutes: number
  busy: boolean
  onShape: (shape: SessionShape) => void
}) {
  // A STARTING SHAPE STARTS AN EMPTY PLAN. Once the coach has chosen a
  // drill there is nothing left for it to start, so the choice goes inert
  // and the step describes THE PLAN rather than a division that would
  // never be written. The first version left the buttons live and drew
  // the proposed slices over a plan that did not have them, which is a
  // screen stating something untrue about the session.
  const startable = canApplySessionShape(activities)
  const plan = startable && shape ? sessionShapePlan(shape, targetMinutes) : null
  return (
    <div className="guide-body">
      <div className="guide-target" role="status">
        <span className="guide-target-big">
          {plan ? shapePlanMinutes(plan) : startable ? clampTargetMinutes(targetMinutes) : totalMinutes}
        </span>
        <span className="guide-target-unit">{startable ? 'min planned' : 'min in this plan'}</span>
      </div>
      <div className="guide-shapes" role="group" aria-label="Session shape">
        {SESSION_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className={'guide-shape' + (shape === s ? ' on' : '')}
            aria-pressed={shape === s}
            disabled={busy || !startable}
            onClick={() => onShape(s)}
          >
            <span className="guide-shape-name">
              {shape === s && <Icon.check />}
              {SESSION_SHAPE_LABELS[s]}
            </span>
            <span className="guide-shape-note">{SESSION_SHAPE_NOTES[s]}</span>
          </button>
        ))}
      </div>
      {plan && (
        <ol className="guide-plan">
          {plan.map((slice, i) => (
            <li key={`${slice.label}-${i}`}>
              <span className="guide-plan-label">{slice.label}</span>
              <span className="guide-plan-mins mono">{slice.duration} min</span>
            </li>
          ))}
        </ol>
      )}
      {!startable && (
        <Note tone="info" className="guide-kept">
          {SHAPE_KEPT_NOTE}
        </Note>
      )}
    </div>
  )
}

// ---- Step four: build the activities --------------------------------

export function GuidedActivitiesStep({
  totalMinutes,
  count,
  composer,
  actions,
}: {
  totalMinutes: number
  count: number
  composer: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="guide-body">
      <div className="guide-target" role="status">
        <span className="guide-target-big">{totalMinutes}</span>
        <span className="guide-target-unit">
          min total, {count} {count === 1 ? 'activity' : 'activities'}
        </span>
      </div>
      {composer}
      {actions}
    </div>
  )
}
