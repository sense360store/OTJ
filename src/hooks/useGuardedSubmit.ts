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
}: {
  // Names the flow in the diagnostic log; never carries session content.
  operation: string
  perform: (input: T) => Promise<R>
  // Navigate or close here. Runs only after the write resolves, and only
  // while the surface is still mounted.
  onSuccess: (result: R, input: T) => void
}): {
  submit: (input: T) => Promise<void>
  // The in-flight input, null when idle. Callers derive their pending flag or
  // per-row pending id from it.
  pending: T | null
  failed: boolean
} {
  const [pending, setPending] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [guard] = useState(() =>
    createGuardedSubmit<T, R>({
      perform,
      onPending: (p, input) => {
        setPending(p ? input : null)
        // A new attempt clears the previous attempt's error.
        if (p) setFailed(false)
      },
      onSuccess,
      onFailure: (err) => {
        logSessionWriteError(operation, err)
        setFailed(true)
      },
    }),
  )
  useEffect(() => {
    guard.setActive(true)
    return () => guard.setActive(false)
  }, [guard])
  return { submit: guard.run, pending, failed }
}
