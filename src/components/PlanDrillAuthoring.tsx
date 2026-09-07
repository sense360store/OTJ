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
// PERMISSIONS ARE UNCHANGED. drills.create is the one capability, the
// same one the Library's Add drill needs, and the drills insert policy
// enforces it whatever the screen says. No adaptation semantics: the
// created drill is a listed, reusable library drill, and nothing here
// knows the word variant.
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
  newDraftToken,
  takeDraft,
  type AuthoringHost,
} from '../lib/authoringReturn'
import type { Activity } from '../lib/data'

export const DRILL_CREATE_CAP = 'drills.create'

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
        plan={{ preset: quickDrillPreset(from), replacing: request.kind === 'replace', onCreated }}
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
  const [taken] = useState(() =>
    user?.id ? takeDraft<D>(browserSessionStorage(), { host, token: params.get(DRAFT_PARAM), userId: user.id }) : null,
  )
  useEffect(() => {
    if (!params.has(DRAFT_PARAM)) return
    const next = new URLSearchParams(params)
    next.delete(DRAFT_PARAM)
    setParams(next, { replace: true })
  }, [params, setParams])
  return taken
}
