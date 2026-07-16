// The submit seam for every flow that writes a session and then navigates,
// closes or reports success. The database write is awaited: the success step
// runs only after the write resolves, and a failure leaves the caller exactly
// where it was, with its draft and selections intact, so the user can retry.
//
// One attempt runs at a time per submit instance. Calls made while an attempt
// is in flight are ignored, which covers rapid repeated clicks in the window
// before React re-renders and disables the control. Because attempts are
// serialised, an earlier attempt can never resolve after a later one and
// overwrite its outcome.
//
// The initiating component owns the visible state: which action is pending,
// its error and the retry affordance. Nothing here is global.
import type { Session } from './data'

// Calm user-facing wording. The raw error is logged for debugging (operation
// name only, no session content), never rendered.
export const SESSION_SAVE_ERROR = "We couldn't save this session. Check your connection and try again."
export const SESSION_START_ERROR = "We couldn't save this session before starting it. Check your connection and try again."
export const SESSION_CREATE_ERROR = "We couldn't create the session. Check your connection and try again."
export const DRILL_ADD_ERROR = "We couldn't add the drill to that session. Check your connection and try again."

// Diagnostic logging: the operation name and the error object only. Session
// drafts carry venue and team details, so they never go to the log.
export function logSessionWriteError(operation: string, err: unknown): void {
  console.error(`session write failed: ${operation}`, err)
}

export interface GuardedSubmitCallbacks<T, R> {
  // The awaited write.
  perform: (input: T) => Promise<R>
  // Fires with true as an attempt starts and false as it settles, before
  // onSuccess or onFailure. Starting a new attempt is the moment to clear a
  // previous attempt's error.
  onPending: (pending: boolean, input: T) => void
  // Runs only after the write resolves; this is where a caller navigates or
  // closes. A failed write never reaches it.
  onSuccess: (result: R, input: T) => void
  onFailure: (err: unknown, input: T) => void
}

// The returned function never rejects; failures land in onFailure.
export function createGuardedSubmit<T, R>(cb: GuardedSubmitCallbacks<T, R>): (input: T) => Promise<void> {
  let inFlight = false
  return async (input: T) => {
    if (inFlight) return
    inFlight = true
    cb.onPending(true, input)
    try {
      const result = await cb.perform(input)
      inFlight = false
      cb.onPending(false, input)
      cb.onSuccess(result, input)
    } catch (err) {
      inFlight = false
      cb.onPending(false, input)
      cb.onFailure(err, input)
    }
  }
}

export type PlannerAction = 'save' | 'start'

export interface PlannerActionCallbacks {
  // The awaited session write; the draft passed in is the one submitted.
  upsert: (draft: Session) => Promise<Session>
  navSessions: () => void
  navLive: (sessionId: string) => void
  // null clears the pending action as an attempt settles.
  onPending: (action: PlannerAction | null) => void
  onFailure: (action: PlannerAction, err: unknown) => void
}

export interface PlannerActions {
  save: (draft: Session) => Promise<void>
  // A read-only viewer never writes: Watch live navigates straight to the
  // live screen, exactly as before this seam existed.
  start: (draft: Session, readOnly: boolean) => Promise<void>
  // The editor's lifecycle switch. While inactive, a settling write still
  // reports pending and failure (so nothing is lost from the log), but never
  // navigates: a save that resolves after the coach has already left the
  // planner must not yank them to another screen. The write itself still
  // lands and the sessions cache picks it up.
  setActive: (active: boolean) => void
}

// Save and Start share one guard, so neither can run while the other is in
// flight. Each call submits the draft it is given, so a retry made from the
// component naturally carries the latest visible draft, not a payload
// captured by the failed attempt.
export function createPlannerActions(cb: PlannerActionCallbacks): PlannerActions {
  let active = true
  const submit = createGuardedSubmit<{ action: PlannerAction; draft: Session }, Session>({
    perform: ({ draft }) => cb.upsert(draft),
    onPending: (pending, { action }) => cb.onPending(pending ? action : null),
    onSuccess: (saved, { action }) => {
      if (!active) return
      if (action === 'save') cb.navSessions()
      else cb.navLive(saved.id)
    },
    onFailure: (err, { action }) => cb.onFailure(action, err),
  })
  return {
    save: (draft) => submit({ action: 'save', draft }),
    start: (draft, readOnly) => {
      if (readOnly) {
        cb.navLive(draft.id)
        return Promise.resolve()
      }
      return submit({ action: 'start', draft })
    },
    setActive: (v) => {
      active = v
    },
  }
}
