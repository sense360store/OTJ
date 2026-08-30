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
   that writes its own.

   WHAT THIS TRADES, stated rather than left for somebody to discover. On the
   two signed out screens the outcome message and the focus move land
   together: one render inserts the Note and re-enables the control, and this
   effect then focuses it. A screen reader interrupts its speech queue on a
   focus change, so the announcement of a message inserted in that same commit
   can be cut short or dropped, which is a cost the version that left focus on
   the body did not have.

   It is kept, and NOT quietly: the defect it fixes is measured (a member who
   clicked rather than pressing Enter tabs from the top of the page to reach
   the control again, with an alert on screen telling them to try), and the
   cost is not, because this project's harness drives a browser and no screen
   reader. #215 established that focus behaviour here is not to be changed on
   reasoning alone, and choosing a different target on reasoning alone is the
   same mistake in the other direction. The alternative worth weighing when
   somebody can measure it is the error summary pattern: give the Note
   tabIndex={-1} and move focus to the message rather than to the control, so
   the focus event carries the announcement instead of interrupting it. That
   is a decision about where focus goes after an auth outcome, which is more
   than a visual slice should settle unmeasured. */
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
