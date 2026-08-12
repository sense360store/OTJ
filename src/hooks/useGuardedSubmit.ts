// React wiring for the guarded submit seam (src/lib/sessionSubmit.ts), shared
// by every single-action flow that writes a session and then navigates or
// closes: pending and failed state, the clear-error-on-new-attempt rule, safe
// failure logging, and the unmount gate that stops a late-settling write from
// navigating after the user has left. The planner wires its own two-action
// variant through createPlannerActions with the same guard underneath.
//
// The guard is constructed once, so the duplicate-click protection survives
// re-renders. perform and onSuccess are captured from the first render:
// callers pass functions built from stable pieces (the context upsert
// delegates to the mutation's stable mutateAsync; nav only pushes absolute
// routes; a modal's onClose is a stable parent setState), and anything
// per-attempt travels through the submitted input instead.
import { useEffect, useState } from 'react'
import { createGuardedSubmit, logSessionWriteError } from '../lib/sessionSubmit'

export function useGuardedSubmit<T, R>({
  operation,
  perform,
  onSuccess,
  onPendingChange,
  onFailure,
}: {
  // Names the flow in the diagnostic log; never carries session content.
  operation: string
  perform: (input: T) => Promise<R>
  // Navigate or close here. Runs only after the write resolves, and only
  // while the surface is still mounted.
  onSuccess: (result: R, input: T) => void
  // Fires synchronously as the attempt starts (true) and settles (false),
  // inside the submit call rather than a render later, so a parent composing
  // this pending state into its own busy flag freezes in the same tick the
  // create begins. Captured once, so callers pass a stable function (a
  // useState dispatcher).
  onPendingChange?: (pending: boolean) => void
  // Runs after the failure has been logged and recorded, for the caller that
  // has to DO something about a particular failure rather than only show it:
  // Plan from Spond refetches server truth when the database refuses a
  // duplicate Spond link. Captured once like the rest, so callers build it
  // from stable pieces (a query client, a setState dispatcher).
  onFailure?: (err: unknown, input: T) => void
}): {
  submit: (input: T) => Promise<void>
  // The in-flight input, null when idle. Callers derive their pending flag or
  // per-row pending id from it.
  pending: T | null
  failed: boolean
  // The last attempt's error, null while idle or after a success. Exposed so
  // a caller can tell one refusal apart from another and say something
  // specific; `failed` alone can only say that something went wrong.
  error: unknown
} {
  const [pending, setPending] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [guard] = useState(() =>
    createGuardedSubmit<T, R>({
      perform,
      onPending: (p, input) => {
        setPending(p ? input : null)
        // A new attempt clears the previous attempt's error.
        if (p) {
          setFailed(false)
          setError(null)
        }
        onPendingChange?.(p)
      },
      onSuccess,
      onFailure: (err, input) => {
        logSessionWriteError(operation, err)
        setFailed(true)
        setError(err)
        onFailure?.(err, input)
      },
    }),
  )
  useEffect(() => {
    guard.setActive(true)
    return () => guard.setActive(false)
  }, [guard])
  return { submit: guard.run, pending, failed, error }
}
