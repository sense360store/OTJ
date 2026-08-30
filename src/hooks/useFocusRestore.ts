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

   The ref stays with the component that renders the target, and this takes
   it: a hook that MADE the ref and handed it back through an object reads as
   a ref accessed during render, which it is not, but the shape is worth
   avoiding either way. What it returns is the request. A ref whose element is
   not on screen when the call settles reads as null and moves nothing, which
   is a case the auth screens use deliberately (below) rather than a hole.

   ONE implementation, shared. It arrived on the Account screen, and Login and
   Set Password meet the same browser behaviour for the same reason: pressing
   a control that the handler then disables blurs it. A second copy of this
   reasoning is exactly what the visual programme exists to remove, so
   src/lib/designSystem.invariant.test.ts fails the build on a file under src/
   that writes its own. That check reads source text and keys on this NAME, so
   it catches a copy that reuses it and not one called useRestoreFocus; it is
   a tripwire against the obvious mistake rather than a proof there is one
   implementation, which is what every other invariant in that file says about
   itself too.

   WHERE IT PUTS FOCUS is the caller's decision, and the two callers make it
   differently for a stated reason rather than by accident.

   Account puts it back on a NAMED CONTROL, because each of its four outcomes
   removes or disables the control that had focus while leaving the rest of the
   screen live, and the useful next thing is another control.

   Login and Set Password put it on the OUTCOME MESSAGE, which is the error
   summary pattern. Their outcome and their focus move land in the same commit:
   one render inserts the Note and re-enables the control. A screen reader
   flushes its speech queue on a focus change, so a message announced through a
   live region in that commit can be cut short by a focus move to something
   else. Focusing the message removes the race, because the thing being
   announced is the thing receiving focus.

   That was written here as the alternative to weigh, on the reasoning that
   #215 established focus behaviour is not to be changed unmeasured and that
   choosing a different target unmeasured is the same mistake in the other
   direction. Codex weighed it and answered: the announcement outweighs the
   focus position on a screen whose whole content is one short form, where the
   controls are two Tab presses from the message either way. Taken, and the
   reasoning kept rather than deleted, because what makes it defensible is that
   both sides of it are written down.

   The measured defect is fixed under either target: a member who clicked
   rather than pressing Enter no longer tabs from the top of the page with an
   alert on screen telling them to try. What the callers must NOT do is aim it
   at something that is not there: the auth screens render the message wrapper
   only while there is a message, so a settled call with nothing to say leaves
   the ref null and this does nothing, rather than moving focus to an empty
   box. */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/* The rule that separates a restore from a steal, as a function rather than a
   condition inside the effect. It is the whole of the difference between this
   hook and one that takes focus off somebody, and an effect cannot be run at
   all in this project's test environment, which has no DOM. Naming it makes
   the rule itself testable: src/hooks/focusRestore.test.ts drives every case
   the browser can leave behind.

   `body` is passed in rather than read, so the predicate holds no reference to
   a global and a test needs no document. */
export function focusWasLost(active: Element | null, body: Element | null): boolean {
  return active === null || active === body
}

export function useFocusRestore(settled: boolean, target: RefObject<HTMLElement | null>) {
  const wanted = useRef(false)
  useEffect(() => {
    if (!settled || !wanted.current) return
    wanted.current = false
    // The body (or nothing) is what the browser leaves behind when a focused
    // control is disabled or removed. Anywhere else is where the person went.
    if (!focusWasLost(document.activeElement, document.body)) return
    target.current?.focus()
  }, [settled, target])
  return () => void (wanted.current = true)
}
