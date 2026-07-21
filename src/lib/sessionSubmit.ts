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
// Save and share fails at the save: the link is never shared from stale or
// pre-save data, so the message names the save, not the share.
export const SESSION_SHARE_ERROR = "We couldn't save this session, so the link wasn't shared. Check your connection and try again."

// Diagnostic logging: the operation name and the error object only. Session
// drafts carry venue and team details, so they never go to the log.
export function logSessionWriteError(operation: string, err: unknown): void {
  console.error(`session write failed: ${operation}`, err)
}

// A create flow that mints a fresh id on every attempt turns a retry after an
// ambiguous network outcome into a duplicate session. stableCreateId mints an
// id once per logical create (keyed by, for example, the template, week or
// Spond event) and reuses it on a retry, so the retry targets the same row,
// which the server-safe write (upsertSessionWrite) recovers into an update
// rather than a second insert. The store is held in a ref for the life of the
// surface; a success navigates away and discards it, so a later, separate
// create of the same key starts fresh.
export function stableCreateId(store: Map<string, string>, key: string, mint: () => string = () => crypto.randomUUID()): string {
  const existing = store.get(key)
  if (existing) return existing
  const id = mint()
  store.set(key, id)
  return id
}

export interface GuardedSubmitCallbacks<T, R> {
  // The awaited write.
  perform: (input: T) => Promise<R>
  // Fires with true as an attempt starts and false as it settles, before
  // onSuccess or onFailure. Starting a new attempt is the moment to clear a
  // previous attempt's error.
  onPending: (pending: boolean, input: T) => void
  // Runs only after the write resolves, and only while the guard is active;
  // this is where a caller navigates or closes. A failed write never reaches
  // it, and neither does a write that settles after the caller has gone.
  onSuccess: (result: R, input: T) => void
  onFailure: (err: unknown, input: T) => void
}

export interface GuardedSubmit<T> {
  // Never rejects; failures land in onFailure.
  run: (input: T) => Promise<void>
  // The caller's lifecycle switch. While inactive, a settling write still
  // reports pending and failure (so nothing is lost from the log), but
  // onSuccess is skipped: a write that resolves after the user has dismissed
  // the surface or navigated away must not close anything or yank them to
  // another screen. The write itself still lands and the sessions cache
  // picks it up on the settled invalidation.
  setActive: (active: boolean) => void
}

export function createGuardedSubmit<T, R>(cb: GuardedSubmitCallbacks<T, R>): GuardedSubmit<T> {
  let inFlight = false
  let active = true
  return {
    run: async (input: T) => {
      if (inFlight) return
      inFlight = true
      cb.onPending(true, input)
      try {
        const result = await cb.perform(input)
        inFlight = false
        cb.onPending(false, input)
        if (active) cb.onSuccess(result, input)
      } catch (err) {
        inFlight = false
        cb.onPending(false, input)
        cb.onFailure(err, input)
      }
    },
    setActive: (v) => {
      active = v
    },
  }
}

// A stable, key-order independent serialisation, so a session compared to the
// copy it was cloned from is equal regardless of column order, while a changed
// value, a reordered activity or an added or removed one reads as different.
// Arrays keep their order (activity order is meaningful); object keys are
// sorted (column order is not).
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}'
  }
  return JSON.stringify(v) ?? 'null'
}

// A serialised baseline for a saved session, held by the planner to decide
// whether the draft is dirty. Null for a session that has never been saved.
export function sessionBaseline(saved: Session | null): string | null {
  return saved ? stableStringify(saved) : null
}

// Whether the draft differs from the baseline it was last saved against. A
// draft with no baseline (a new, never-saved session) is always dirty, so it
// takes the Save and share path rather than sharing a URL that does not exist
// yet.
export function sessionDirty(draft: Session, baseline: string | null): boolean {
  if (baseline === null) return true
  return stableStringify(draft) !== baseline
}

// The planner's share routing as a tested pure decision: a session that is
// saved (has a stable id) and unchanged since that save shares its canonical
// URL directly with no write; a new (no id) or dirty draft must save first.
export function shareDecision(savedId: string | null, dirty: boolean): 'direct' | 'save' {
  return savedId !== null && !dirty ? 'direct' : 'save'
}

export type PlannerAction = 'save' | 'start' | 'share'

// The planner's busy state composes its own Save or Start pending action with a
// Plan from Spond create running on the same screen (reported up from that
// surface). Either one freezes the whole editable planner, and because both
// feed one flag, neither create path can start while the other runs.
export function plannerBusy(pendingAction: PlannerAction | null, spondPending: boolean): boolean {
  return pendingAction !== null || spondPending
}

export interface PlannerActionCallbacks {
  // The awaited session write; the draft passed in is the one submitted.
  upsert: (draft: Session) => Promise<Session>
  navSessions: () => void
  navLive: (sessionId: string) => void
  // Runs only after a Save and share write resolves, with the saved session
  // (the server-returned id is the canonical one) and the draft that was
  // submitted. This is where the caller shares the final saved-session URL, so
  // the link is never built from stale or pre-save data. Runs only on success
  // and only while the guard is active, exactly like navigation.
  shareSaved: (saved: Session, draft: Session) => void
  // null clears the pending action as an attempt settles.
  onPending: (action: PlannerAction | null) => void
  onFailure: (action: PlannerAction, err: unknown) => void
}

export interface PlannerActions {
  save: (draft: Session) => Promise<void>
  // A read-only viewer never writes: Watch live navigates straight to the
  // live screen, exactly as before this seam existed.
  start: (draft: Session, readOnly: boolean) => Promise<void>
  // Save the draft, then share the saved session's canonical URL. Rides the
  // same guard as Save and Start, so it cannot run alongside either and a rapid
  // double click fires one save. The share runs only after the write resolves.
  saveAndShare: (draft: Session) => Promise<void>
  // The guard's lifecycle switch (see GuardedSubmit.setActive): while the
  // editor is unmounted a settling save never navigates or shares.
  setActive: (active: boolean) => void
}

// Save and Start share one guard, so neither can run while the other is in
// flight. Each call submits the draft it is given, so a retry made from the
// component naturally carries the latest visible draft, not a payload
// captured by the failed attempt.
export function createPlannerActions(cb: PlannerActionCallbacks): PlannerActions {
  const guard = createGuardedSubmit<{ action: PlannerAction; draft: Session }, Session>({
    perform: ({ draft }) => cb.upsert(draft),
    onPending: (pending, { action }) => cb.onPending(pending ? action : null),
    onSuccess: (saved, { action, draft }) => {
      if (action === 'save') cb.navSessions()
      else if (action === 'start') cb.navLive(saved.id)
      else cb.shareSaved(saved, draft)
    },
    onFailure: (err, { action }) => cb.onFailure(action, err),
  })
  return {
    save: (draft) => guard.run({ action: 'save', draft }),
    start: (draft, readOnly) => {
      if (readOnly) {
        cb.navLive(draft.id)
        return Promise.resolve()
      }
      return guard.run({ action: 'start', draft })
    },
    saveAndShare: (draft) => guard.run({ action: 'share', draft }),
    setActive: guard.setActive,
  }
}
