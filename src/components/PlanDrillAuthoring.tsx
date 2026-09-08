// =====================================================================
// COACH-11: creating a drill from a plan, the React half, shared.
//
// The dated session planner and the week plan editor both mount the one
// activity list editor (COACH-10). Creating a drill from it is decided
// ONCE here, for both, and the seam itself stays hook free: it renders
// New drill and Turn into a drill only when a host hands it the two
// callbacks this hook returns, and a host without drills.create is
// handed neither.
//
// WHAT THIS HOOK DOES. It holds which request is open (a new drill, or
// the custom row being turned), renders the drill form in plan mode over
// the host, and when the insert lands it writes the created drill into
// the host's plan through the pure rules in ../lib/planDrillAuthoring
// (append, or replace the custom row in place). Add to plan stops there.
// Save and draw it goes on to stash the host's whole draft, with the new
// activity in it, and only then opens the Drill Maker with the address
// to come back to; the stash rules are ../lib/authoringReturn. A stash
// that cannot be written keeps the coach where they are, with the drill
// in the plan and a sentence saying what to do instead.
//
// WHAT THE HOST STILL OWNS. Its draft, its setter and its own address.
// The hook is handed a way to build the whole draft around the plan as
// it will be (draftWith), because the stash must carry the session's
// fields or the template's name as well as the activity list, and only
// the host knows which of those it is.
//
// THE WAY BACK. useAuthoringReturn is the other half: a host that mounts
// with a draft token in its address takes the stash exactly once and
// adopts the draft as its initial state, then removes the token from the
// address so a refresh or a bookmark carries none. The planner calls it
// in its editor; the two screens that can open the week plan editor
// mount RestoredTemplateEditor (./RestoredTemplateEditor.tsx, its own
// file so the modal and this hook do not import each other), which
// reopens the modal on the draft.
//
// PERMISSIONS ARE UNCHANGED, and this file GRANTS none. drills.create is
// what the two affordances need, the same one the Library's Add drill
// needs, and the drills insert policy enforces it whatever the screen
// says. Save and draw it additionally needs the capability the Drill
// Maker ROUTE is gated on, because it navigates there; that is read and
// WITHHELD rather than widened (DRILL_MAKER_ROUTE_CAP below). No
// adaptation semantics: the created drill is a listed, reusable library
// drill, and nothing here knows the word variant.
// =====================================================================
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMyCapabilities } from '../lib/queries'
import { DrillFormModal } from './DrillFormModal'
import { Note } from './primitives'
import {
  applyCreatedDrill,
  leaveToDraw,
  quickDrillPreset,
  STASH_FAILED_NOTE,
  type CreatedDrillTarget,
} from '../lib/planDrillAuthoring'
import {
  browserSessionStorage,
  DRAFT_PARAM,
  dropDraft,
  newDraftToken,
  peekDraft,
  type AuthoringHost,
} from '../lib/authoringReturn'
import type { Activity } from '../lib/data'

export const DRILL_CREATE_CAP = 'drills.create'

// The capability the Drill Maker ROUTE is gated on in App.tsx. It is not the
// same question as "may this member create a drill", and the two are held
// separately: the week plan editor opens under templates.manage, so a member
// can hold drills.create and templates.manage without sessions.create, which
// the admin role grid can grant. Such a member was offered Save and draw it,
// and pressing it inserted the drill, stashed the draft and then met the
// route guard, which sent them Home with the plan's stash unread. Withheld
// rather than widened: this file decides what to OFFER, and moving the route
// gate would be a permissions change, which the guard's own comment argues
// against (it excludes parents deliberately). Add to plan is unaffected.
// planDrillAuthoring.invariant.test.ts pins these two in step with App.tsx.
export const DRILL_MAKER_ROUTE_CAP = 'sessions.create'

export interface PlanDrillAuthoringArgs<D> {
  host: AuthoringHost
  // The session or template being edited, or null for one not yet saved.
  id: string | null
  // The host's own address, without a token; the Drill Maker comes back here.
  returnPath: string
  activities: readonly Activity[]
  // Writes the plan the created drill is now part of: the host's own setter.
  onActivities: (next: Activity[]) => void
  // The whole draft to keep across the trip, around the plan as it will be.
  draftWith: (activities: Activity[]) => D
}

export interface PlanDrillAuthoring {
  // Both undefined for a member without drills.create, so the seam renders
  // neither affordance; both defined otherwise. Never one without the other.
  onNewDrill?: () => void
  onTurnIntoDrill?: (index: number) => void
  // The drill form, while a request is open. The host renders it.
  modal: ReactNode
  // The one sentence this flow can need to say in the host: the draft could
  // not be kept, so the Drill Maker was not opened. Rendered under the list.
  note: ReactNode
}

export function usePlanDrillAuthoring<D>(args: PlanDrillAuthoringArgs<D>): PlanDrillAuthoring {
  const { caps } = useMyCapabilities()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [request, setRequest] = useState<CreatedDrillTarget | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // The insert resolves a render or more after it was pressed. The plan
  // cannot change while the form is over it, but the callback reads the
  // host's current values through a ref rather than the render it was
  // created in, so a later render's setter is the one that is called. The
  // ref is written in an effect, after every render, never during one.
  const latest = useRef(args)
  useEffect(() => {
    latest.current = args
  })

  const canCreate = caps.has(DRILL_CREATE_CAP)
  const canDraw = caps.has(DRILL_MAKER_ROUTE_CAP)

  const open = (target: CreatedDrillTarget) => {
    setNote(null)
    setRequest(target)
  }

  const onCreated: NonNullable<Parameters<typeof DrillFormModal>[0]['plan']>['onCreated'] = (drill, slot, intent) => {
    const a = latest.current
    const target = request ?? { kind: 'append' }
    const next = applyCreatedDrill(a.activities, drill.id, slot, target)
    a.onActivities(next)
    setRequest(null)
    if (intent !== 'draw') return
    const outcome = leaveToDraw({
      storage: browserSessionStorage(),
      userId: user?.id,
      host: a.host,
      id: a.id,
      draft: a.draftWith(next),
      returnPath: a.returnPath,
      drillId: drill.id,
      navigate,
      token: newDraftToken(),
    })
    if (outcome === 'stash_failed') setNote(STASH_FAILED_NOTE)
  }

  const from = request?.kind === 'replace' ? (args.activities[request.index] ?? null) : null

  return {
    onNewDrill: canCreate ? () => open({ kind: 'append' }) : undefined,
    onTurnIntoDrill: canCreate ? (index) => open({ kind: 'replace', index }) : undefined,
    modal: request ? (
      <DrillFormModal
        onClose={() => setRequest(null)}
        plan={{ preset: quickDrillPreset(from), replacing: request.kind === 'replace', canDraw, onCreated }}
      />
    ) : null,
    note: note ? (
      <Note tone="warning" role="alert" className="plan-authoring-note">
        {note}
      </Note>
    ) : null,
  }
}

// The way back. Takes the stash named by the token in this address, once,
// for the signed in user and this host, and strips the token from the
// address. Null when there is no token, no matching stash, or no user yet;
// every host that calls this sits behind RequireAuth, so the user is known
// on the first render and a null user never costs a draft.
export function useAuthoringReturn<D>(host: AuthoringHost): { id: string | null; draft: D } | null {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  // Read ONCE, at mount. The token this mount arrived with is the one it
  // takes and the one it strips; a token that reaches the address later is
  // not this mount's business. leaveToDraw replaces the host's own history
  // entry with the tokenised address a beat before it pushes the Drill
  // Maker, and a strip keyed on "the address has a token" could fire in
  // that beat and replace the Drill Maker's entry with a bare one, sending
  // the coach straight back. Keyed on the mount, it cannot.
  const [arrivedWith] = useState(() => params.get(DRAFT_PARAM))
  // The user id this mount saw, so the render and the effect below decide
  // from the same values rather than from whatever the auth hook holds a
  // beat later.
  const [mountUserId] = useState(() => user?.id ?? null)
  // LOOK during render, REMOVE after it commits. An initializer runs during
  // render, and a render can be double invoked (StrictMode does exactly
  // that) or thrown away before committing. Taking the stash here destroyed
  // the only copy on a render nobody adopted, and the next one found an
  // empty stash and fell back to the saved or blank plan, losing the very
  // draft this whole flow exists to carry. The read is pure now and the
  // removal sits in the effect below, so an abandoned render costs nothing.
  const [taken] = useState(() =>
    mountUserId && arrivedWith
      ? peekDraft<D>(browserSessionStorage(), { host, token: arrivedWith, userId: mountUserId })
      : null,
  )
  // The removal, on exactly the mounts that looked. A host opened with no
  // token, or before the user is known, attempted no take and so clears
  // nothing. Anything else is cleared whether it matched or not, which is
  // the rule the combined read always carried: an entry that did not match
  // this trip is stale.
  useEffect(() => {
    if (!mountUserId || !arrivedWith) return
    dropDraft(browserSessionStorage())
  }, [mountUserId, arrivedWith])
  // The token leaves the address, ONCE, and how it leaves depends on whether
  // there is a draft to protect.
  //
  // Codex, sixth finding. The Drill Maker's Back POPS to the plan beneath, and
  // a pop leaves the Drill Maker as the FORWARD entry. Replacing the address
  // in place left it there: browser Forward reopened the Drill Maker, and its
  // Back popped to a plan entry whose token had been stripped and whose stash
  // had been taken, so the plan rebuilt itself from what was saved and every
  // restored edit went silently. A PUSH truncates the forward entries, which
  // is what removes that trap. The entry it pushes over still carries the
  // token, so a Back from the restored plan lands on the same plan, which the
  // planner does not remount (its key is the session id, not the address) and
  // whose draft therefore survives; a second Back leaves as it always did.
  //
  // Only when a draft was actually adopted. A token that matched nothing has
  // nothing to protect, and an extra history entry there would be noise.
  //
  // The ref, not the address, is what makes this happen once. The effect wakes
  // on every params change, so without it the Back onto the tokenised entry
  // would push the clean address again and the coach could never leave the
  // planner; StrictMode's second invocation would push a second entry too.
  const stripped = useRef(false)
  useEffect(() => {
    if (stripped.current || !arrivedWith || params.get(DRAFT_PARAM) !== arrivedWith) return
    stripped.current = true
    const next = new URLSearchParams(params)
    next.delete(DRAFT_PARAM)
    setParams(next, { replace: !taken })
  }, [arrivedWith, params, setParams, taken])
  return taken
}
