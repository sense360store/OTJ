// =====================================================================
// COACH-11: create a drill from a plan, and what that writes into it.
//
// A coach writing a plan, a programme week or Tuesday's session, can
// create the drill they have in mind, draw it, and carry on. The drill
// itself is an ordinary library drill: the same insert the Library's Add
// drill uses (useInsertDrill), the same ownership (created_by is the
// coach), the same RLS, the same capability (drills.create), the same
// sharing default. Nothing about it says which plan it was born in, and
// nothing here is a session adaptation: `variant_of` and an unlisted
// drill are COACH-12 and do not exist.
//
// What this module owns is the PLAN side, decided once for both hosts:
//   - the activity the new drill becomes, and where it goes (appended
//     from the add bar, or replacing the custom row it was turned from);
//   - the form's starting values, from a custom row or from nothing;
//   - the leave to draw flow, which stashes the draft and only then
//     navigates (src/lib/authoringReturn.ts holds the stash rules).
//
// Pure over injected storage and navigation. The React wiring is in
// src/components/PlanDrillAuthoring.tsx and the shared activity list
// editor renders the affordances.
// =====================================================================
import type { Activity, Phase, Session } from './data'
import {
  drawPath,
  FROM_PLAN_STATE,
  stashDraft,
  withDraftToken,
  type AuthoringHost,
  type StorageLike,
} from './authoringReturn'

// The placeholder title both hosts give a custom activity and the title
// resolver falls back to. Spelled once here so the preset rule and the
// hosts' literal are compared against the same string.
export const CUSTOM_ACTIVITY_TITLE = 'Custom activity'

// What a coach chooses on the form beyond the drill's own fields: the
// slot the drill takes in THIS plan. Phase is an activity fact, never a
// drill one, which is why the drill form learns it only in plan mode.
export interface PlanSlot {
  phase: Phase
  duration: number
}

export type CreatedDrillTarget = { kind: 'append' } | { kind: 'replace'; index: number }

export function activityFromCreatedDrill(drillId: string, slot: PlanSlot): Activity {
  return { phase: slot.phase, drillId, duration: Math.max(0, slot.duration) }
}

// Where the created drill lands. Append is the add bar. Replace is Turn
// into a drill on a custom row: the row keeps its position and every key
// it carried except the title (its declared role, and on a dated session
// its stand down, ride along without being named), and takes the drill.
// A row that already has a drill, or an index that is not there, is left
// exactly as it was: the same array comes back, so nothing re-renders
// and nothing is overwritten.
export function applyCreatedDrill(
  activities: readonly Activity[],
  drillId: string,
  slot: PlanSlot,
  target: CreatedDrillTarget,
): Activity[] {
  const fresh = activityFromCreatedDrill(drillId, slot)
  if (target.kind === 'append') return [...activities, fresh]
  const current = activities[target.index]
  if (!current || current.drillId) return activities as Activity[]
  const { title: _title, ...rest } = current
  void _title
  const replaced: Activity = { ...rest, ...fresh }
  return activities.map((a, i) => (i === target.index ? replaced : a))
}

// The form's starting values. From a custom row: its phase and minutes,
// and its title unless that is the placeholder, because every custom row
// carries the placeholder today (the plan offers no title field) and a
// drill named "Custom activity" is not one anybody wants in the library.
// From nothing: the add bar's own default activity shape.
export function quickDrillPreset(from: Activity | null): { title: string } & PlanSlot {
  if (!from) return { title: '', phase: 'Skill', duration: 10 }
  const title = from.title && from.title !== CUSTOM_ACTIVITY_TITLE ? from.title : ''
  return { title, phase: from.phase, duration: from.duration }
}

export const STASH_FAILED_NOTE =
  'This browser could not keep the plan while you draw, so nothing was opened. The drill is still in the plan: save the plan, then draw from the drill page.'

// Leave the plan for the Drill Maker with the draft kept. The stash goes
// first and the navigation happens ONLY if it landed: a navigation without
// the stash would lose the plan, which is the one outcome this flow
// exists to prevent. Both hosts call this with their own draft shape.
//
// TWO NAVIGATIONS, AND THE ORDER IS THE POINT. The history entry the coach
// is standing on is REPLACED with the tokenised return address before the
// Drill Maker is pushed on top of it. The Drill Maker's own Back button
// pushes the return address, but a coach on a phone uses the system Back
// gesture as often as any button, and that pops to whatever entry sits
// beneath: left as the bare `/planner`, the host remounted with no token,
// took nothing, and the plan was gone while its stash sat unread. With the
// entry beneath tokenised, both ways back arrive with the token.
export function leaveToDraw<D>({
  storage,
  userId,
  host,
  id,
  draft,
  returnPath,
  drillId,
  navigate,
  token,
}: {
  storage: StorageLike | null
  userId: string | null | undefined
  host: AuthoringHost
  id: string | null
  draft: D
  // The host's own address, without the token; the token is appended here.
  returnPath: string
  drillId: string
  // The router's navigate: a push by default, a replace when asked. It also
  // carries the history state for the pushed entry, which is what lets the
  // Drill Maker's Back POP to the plan beneath rather than push a second one.
  navigate: (to: string, options?: { replace?: boolean; state?: unknown }) => void
  token: string
}): 'left' | 'stash_failed' {
  if (!userId) return 'stash_failed'
  const stashed = stashDraft(storage, { token, userId, host, id, draft })
  if (!stashed) return 'stash_failed'
  const returnTo = withDraftToken(returnPath, token)
  navigate(returnTo, { replace: true })
  navigate(drawPath(drillId, returnTo), { state: FROM_PLAN_STATE })
  return 'left'
}

// =====================================================================
// THE DATED PLANNER'S DRAFT, AND WHY IT IS NOT THE SESSION ALONE.
//
// The planner fills two fields from reads that answer AFTER its first
// render: the teams a NEW session covers, and the club's age group list.
// Each is seeded once, into a draft nobody has touched, and each is then
// SETTLED, so a later refetch cannot rewrite what the coach has since
// chosen. Whether a field is settled is a fact about the draft, so it has
// to travel with the draft.
//
// It used to be inferred on the way back, by reading the mere existence
// of a restored draft as "both settled". That is right whenever the two
// reads had answered before the coach left, and wrong when they had not:
// a coach who pressed Save and draw it while the team read was still in
// flight, or after a failed read that later refetched, came back to a
// session that would never cover anybody and would keep the legacy age
// group rather than the club's own list, and could save that scope with
// nothing on screen saying a choice had been made for them. Codex's sixth
// finding. Carrying the two flags states what actually happened instead
// of guessing it from the draft's existence.
// =====================================================================
export interface PlannerSeeded {
  // The teams the session covers, seeded from the club's team list.
  coverage: boolean
  // The age group, seeded from the club's age group list, and also settled
  // by the coach choosing one.
  age: boolean
}

export interface PlannerDraft {
  session: Session
  seeded: PlannerSeeded
}

export function plannerDraft(session: Session, seeded: PlannerSeeded): PlannerDraft {
  return { session, seeded: { coverage: seeded.coverage, age: seeded.age } }
}

// Reads a draft written by the envelope above, or null. Checked rather
// than cast, because the stash outlives a RELOAD of the tab, which is the
// whole reason it is session storage rather than memory: the bundle that
// reads it need not be the bundle that wrote it, and this envelope is
// itself a change to what was written before. A value of another shape
// answers "no draft", which is the fallback every other mismatch in this
// flow already takes, and never a draft with invented flags: an unsettled
// field read as settled is exactly the defect this replaced.
//
// The session INSIDE the envelope is the host's own state and is passed
// through as it always was. Nothing here validates a plan's fields.
export function readPlannerDraft(value: unknown): PlannerDraft | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { session?: unknown; seeded?: unknown }
  if (!v.session || typeof v.session !== 'object') return null
  if (!v.seeded || typeof v.seeded !== 'object') return null
  const seeded = v.seeded as { coverage?: unknown; age?: unknown }
  if (typeof seeded.coverage !== 'boolean' || typeof seeded.age !== 'boolean') return null
  return { session: v.session as Session, seeded: { coverage: seeded.coverage, age: seeded.age } }
}
