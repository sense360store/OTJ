/* Focus is RESTORED, never stolen.

   An async outcome can take away the control that had focus: a button that
   unmounts with the thing it removed, or one the settling render disables
   because there is nothing left to submit, or one that a screen freezes while
   a call is in flight. The browser drops focus to the document body when that
   happens, and that is the ONLY case this moves focus in. Someone who moved
   into another field while the call was running keeps their place: on the
   Account screen only the photo actions are disabled during a removal, so
   every other control is still theirs to use. Codex.

   It has to be an effect rather than the success callback, and for both
   halves of the same reason. TanStack runs a per-call onSuccess inside its
   notify batch BEFORE it notifies its listeners, so React has not re-rendered
   when it fires: the control is neither disabled nor unmounted yet, which
   makes "did focus get lost" unanswerable, and focusing a control that the
   settling render is about to disable is a no-op. Codex again, one round
   apart, which is why both halves are written down here.

   The ref stays with the component that renders the control, and this takes
   it: a hook that MADE the ref and handed it back through an object reads as
   a ref accessed during render, which it is not, but the shape is worth
   avoiding either way. What it returns is the request.

   ONE implementation, shared. It arrived on the Account screen, and Login and
   Set Password meet the same browser behaviour for the same reason: pressing
   a control that the handler then disables blurs it. A second copy of this
   reasoning is exactly what the visual programme exists to remove, so
   src/lib/designSystem.invariant.test.ts fails the build on a file under src/
   that writes its own. */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export function useFocusRestore(settled: boolean, target: RefObject<HTMLElement | null>) {
  const wanted = useRef(false)
  useEffect(() => {
    if (!settled || !wanted.current) return
    wanted.current = false
    // The body (or nothing) is what the browser leaves behind when a focused
    // control is disabled or removed. Anywhere else is where the person went.
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    target.current?.focus()
  }, [settled, target])
  return () => void (wanted.current = true)
}
