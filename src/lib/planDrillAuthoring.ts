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
import type { Activity, Phase } from './data'
import { drawPath, stashDraft, withDraftToken, type AuthoringHost, type StorageLike } from './authoringReturn'

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
  // The router's navigate: a push by default, a replace when asked.
  navigate: (to: string, options?: { replace: boolean }) => void
  token: string
}): 'left' | 'stash_failed' {
  if (!userId) return 'stash_failed'
  const stashed = stashDraft(storage, { token, userId, host, id, draft })
  if (!stashed) return 'stash_failed'
  const returnTo = withDraftToken(returnPath, token)
  navigate(returnTo, { replace: true })
  navigate(drawPath(drillId, returnTo))
  return 'left'
}
