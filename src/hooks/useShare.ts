// React wiring for the internal share seam (src/lib/share.ts). It holds the
// last outcome as state and derives the plain-language feedback, and it wires
// the pure createShareRunner so rapid duplicate clicks fire a single share and
// a share settling after the surface has unmounted updates nothing. The runner
// is built once so its in-flight guard survives re-renders, mirroring
// useGuardedSubmit.
import { useEffect, useState } from 'react'
import { createShareRunner, shareFeedback, type ShareFeedback, type ShareResult, type SharePayload } from '../lib/share'

export function useShare(): {
  share: (payload: SharePayload) => void
  feedback: ShareFeedback
} {
  const [result, setResult] = useState<ShareResult | null>(null)
  const [runner] = useState(() =>
    createShareRunner((r) => {
      // A cancellation is neutral: keep the surface as it was rather than
      // clearing a prior success. Any other outcome (share, copy, error)
      // becomes the new feedback.
      if (r !== 'cancelled') setResult(r)
    }),
  )
  useEffect(() => {
    runner.setActive(true)
    return () => runner.setActive(false)
  }, [runner])
  return {
    share: (payload) => {
      // A new attempt clears the previous outcome so stale copy does not linger
      // while the next share is in flight. The runner ignores the call if one
      // is already running, so this cannot clear feedback mid-attempt.
      setResult(null)
      void runner.run(payload)
    },
    feedback: result ? shareFeedback(result) : { role: null, message: '' },
  }
}
