// =====================================================================
// The pre-filled session name is SELECTED when it is focused, on BOTH
// planning surfaces.
//
// WHAT WENT WRONG IN PRODUCTION. A new session's name is real content
// rather than a placeholder, so a coach who tapped the field and typed
// appended to it: the smoke test produced a session called
// "New SessionSmoke Test". Focusing selects the name while it is still
// the one nobody chose, so typing replaces it.
//
// WHY THIS FILE COVERS TWO SURFACES AT ONCE. The fix is one rule
// (sessionNameIsUntouched) wired into two independent inputs, the full
// planner's field and the guided builder's. Nothing structural keeps
// them in step, so either could be dropped in a refactor while the other
// kept working and every other suite stayed green. Each surface has its
// own assertions here, so removing one handler fails on that surface by
// name rather than on a count that could be satisfied by the other.
//
// HOW IT TESTS A FOCUS HANDLER WITH NO DOM. Both subjects are hook free,
// so each is invoked as a plain function and its returned element tree is
// walked WITHOUT invoking the components inside it: TextField is not hook
// free, and calling it outside React would throw. Walking shallowly finds
// the handler wherever it is attached, on a host input in the planner and
// on a TextField element in the guide, and the handler is then called
// with a stand in event. That is the same technique
// src/components/ActivityListEditor.test.tsx uses, and it proves what a
// press DOES rather than that somebody typed the right words.
//
// Names in fixtures are invented. No child or coach appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { SessionFieldsView } from './Planner'
import { GuidedBasicsStep } from '../components/GuidedPlanner'
import { blankSession, NEW_SESSION_NAME } from '../lib/data'
import type { Session } from '../lib/data'

const ME = 'coach-me'
const TEAMS = [{ id: 'titans', name: 'Titans', bibColour: null, sortOrder: null }]

interface El {
  type: unknown
  props: Record<string, unknown>
}

// Every element in the tree, in order, WITHOUT invoking any of them. A
// function component's own output is deliberately not entered: this walk
// reads the elements the subject itself created, which is where the
// handler is attached.
function elements(node: unknown, out: El[] = []): El[] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out)
    return out
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (!el.type) return out
  out.push({ type: el.type, props: el.props ?? {} })
  elements((el.props as { children?: unknown } | undefined)?.children, out)
  return out
}

type FocusHandler = (e: { target: { value: string; select: () => void } }) => void

// Focus the field with this value in it, and report whether the control
// selected itself.
function focusWith(onFocus: FocusHandler, value: string): boolean {
  const select = vi.fn()
  onFocus({ target: { value, select } })
  return select.mock.calls.length > 0
}

// ---- the two surfaces, each found on its own terms --------------------

const session = (over: Partial<Session> = {}): Session => ({ ...blankSession(ME), ...over })

// The full planner attaches the handler to a host input. Exactly one of
// its inputs carries one, and it is the name.
function plannerNameFocus(name: string): FocusHandler | undefined {
  const tree = SessionFieldsView({
    session: session({ name }),
    readOnly: false,
    busy: false,
    teams: TEAMS,
    venues: [],
    venuesUnavailable: false,
    ageGroups: undefined,
    attachedBoardName: undefined,
    onField: () => {},
    onIntentions: () => {},
    onVenue: () => {},
    onToggleTeam: () => {},
    onAllTeams: () => {},
    onRemoveBoard: () => {},
    onOpenBoardPicker: () => {},
  })
  const withFocus = elements(tree).filter((e) => e.type === 'input' && typeof e.props.onFocus === 'function')
  // Stated as an equality rather than a lookup, so a second focus handler
  // appearing on some other planner field is noticed rather than silently
  // shadowing this one.
  expect(withFocus, 'exactly one planner input carries a focus handler').toHaveLength(1)
  expect(withFocus[0].props.value, 'and it is the session name').toBe(name)
  return withFocus[0].props.onFocus as FocusHandler
}

// The guide attaches it to a TextField, which is a component rather than
// a host element, so it is found by the label it is given.
function guidedNameFocus(name: string): FocusHandler | undefined {
  const tree = GuidedBasicsStep({
    session: session({ name }),
    teams: TEAMS,
    ageGroups: undefined,
    busy: false,
    targetMinutes: 60,
    onField: () => {},
    onName: () => {},
    onToggleTeam: () => {},
    onAllTeams: () => {},
    onType: () => {},
    onCommit: () => {},
  })
  const named = elements(tree).filter((e) => e.props.label === 'Session name')
  expect(named, 'the guide asks for the session name exactly once').toHaveLength(1)
  expect(named[0].props.value, 'and the field carries the draft name').toBe(name)
  return named[0].props.onFocus as FocusHandler | undefined
}

// ---- the full planner -------------------------------------------------

describe('the full planner session name field', () => {
  it('carries a focus handler at all', () => {
    // The assertion that fails if this surface's handler is removed on its
    // own, which is the regression that reached production.
    expect(typeof plannerNameFocus(NEW_SESSION_NAME)).toBe('function')
  })

  it('selects the name nobody chose, so typing replaces it', () => {
    expect(focusWith(plannerNameFocus(NEW_SESSION_NAME)!, NEW_SESSION_NAME)).toBe(true)
  })

  it('selects an empty name too, which nobody chose either', () => {
    expect(focusWith(plannerNameFocus('')!, '')).toBe(true)
  })

  it('NEVER selects a name a coach wrote', () => {
    // The half of the rule that matters most: a coach returning to a name
    // they typed must not have it selected out from under them, because
    // the next keystroke would delete it.
    expect(focusWith(plannerNameFocus('Thursday finishing')!, 'Thursday finishing')).toBe(false)
  })

  it('reads the value it is given rather than the draft it rendered with', () => {
    // The handler answers about what is in the box at the moment of focus,
    // which is what makes it correct after the coach has typed.
    const onFocus = plannerNameFocus(NEW_SESSION_NAME)!
    expect(focusWith(onFocus, 'Titans training')).toBe(false)
  })
})

// ---- the guided builder -----------------------------------------------

describe('the guided builder session name field', () => {
  it('carries a focus handler at all', () => {
    // The assertion that fails if the guide's handler is removed on its
    // own, independently of the planner's.
    expect(typeof guidedNameFocus(NEW_SESSION_NAME)).toBe('function')
  })

  it('selects the name nobody chose, so typing replaces it', () => {
    expect(focusWith(guidedNameFocus(NEW_SESSION_NAME)!, NEW_SESSION_NAME)).toBe(true)
  })

  it('selects an empty name too, which nobody chose either', () => {
    expect(focusWith(guidedNameFocus('')!, '')).toBe(true)
  })

  it('NEVER selects a name a coach wrote', () => {
    expect(focusWith(guidedNameFocus('Thursday finishing')!, 'Thursday finishing')).toBe(false)
  })

  it('does not select the SUGGESTION either, because a coach may be editing it', () => {
    // The guide writes a real name into the draft, so by the time a coach
    // taps the field it is no longer the blank default. Selecting a
    // generated name would be indistinguishable from selecting one they
    // typed, and the rule reads the string rather than its provenance.
    expect(focusWith(guidedNameFocus('Club training')!, 'Club training')).toBe(false)
  })
})

// ---- the two stay in step ---------------------------------------------

describe('both surfaces answer the same way', () => {
  it('agrees on every case, because it is one rule wired twice', () => {
    for (const value of [NEW_SESSION_NAME, '', '   ', 'Thursday finishing', 'Club training']) {
      const planner = focusWith(plannerNameFocus(value)!, value)
      const guided = focusWith(guidedNameFocus(value)!, value)
      expect(guided, `the two surfaces disagree about "${value}"`).toBe(planner)
    }
  })
})
