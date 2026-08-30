// The card both signed out screens wear. Sign in and Set your password are
// one family: the same brand ground, the same crest led identity block, the
// same compact form, the same footer voice. That was a coincidence of two
// files carrying the same markup before VISUAL-02; it is one component now,
// so the two cannot drift apart by editing only one of them.
//
// It is deliberately NOT the shared Card primitive. Card contains a section
// inside the application shell, on the page ground; this is the product with
// no shell around it at all, standing on the brand gradient, and turning it
// into a generic panel would take away the one signature surface Part 3 of
// the design read asks to keep rare and keep intact.
//
// The stylesheet lives at routes/Login.css and is imported here, because this
// is what it draws. It keeps that name because both routes and the design
// read already refer to it there, and renaming a file is churn a visual slice
// should not spend a reviewer's attention on.
import type { FormEvent, ReactNode, Ref } from 'react'
import { Crest } from './Crest'
import { useClubBranding } from '../hooks/useClubBranding'
import '../routes/Login.css'

// Neither screen can read the club row: they have no session. useClubBranding
// answers from the identity cached while somebody was last signed in, so a
// first visit on a new device legitimately has neither, and the club's own
// name is a better fallback than an empty line.
const FALLBACK_NAME = 'Ossett Town Juniors'
const FALLBACK_MOTTO = 'Where football and friendships flourish'

/* Where an outcome message goes, and where FOCUS goes with it.

   Both screens disable the control that was pressed while the call runs, the
   browser blurs a disabled control, and the outcome then arrives with focus on
   the document body. The repair used to put focus back on the control. It now
   puts focus HERE, on the message, which is the error summary pattern: the
   focus change is what carries the announcement instead of interrupting it.

   A screen reader flushes its speech queue on a focus change, so a message
   inserted into a live region in the same commit as a focus move can be cut
   short. Focusing the message itself has no such race, because the thing being
   announced is the thing receiving focus. Codex, on the measured version of
   this that focused the control; the trade was written down there as the
   alternative to weigh, and this is taking it.

   `tabIndex={-1}` makes it focusable programmatically and leaves it out of the
   tab order, so nothing about tabbing through the form changes. The screens
   render it ONLY when there is something to say, which is what makes "focus
   was lost and there is no message" a no-op rather than a focus move onto an
   empty box: the hook's target is null and it does nothing.

   role stays on the Note inside rather than moving here, because focus is not
   always lost. It is lost whenever the ACTIVATED CONTROL is the one the handler
   disables, which is a mouse click and a keyboard activation of the button
   alike. It is NOT lost when somebody presses Enter inside a field: no field is
   disabled during a call, so focus never leaves it, nothing moves, and the live
   region is the only thing that announces the outcome on that path. */
export function AuthOutcome({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} tabIndex={-1} className="login-outcome">
      {children}
    </div>
  )
}

export function AuthCard({
  title,
  onSubmit,
  children,
  foot,
}: {
  title: string
  onSubmit: (e: FormEvent) => void
  children: ReactNode
  // The closing line under the form. Both screens have one and they say
  // different things, so it is a slot rather than a shared sentence.
  foot: ReactNode
}) {
  const { name, motto } = useClubBranding()
  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-head">
          <Crest />
          <div className="login-identity">
            {/* The page's one h1. It names the screen rather than the club:
                the club is the label above the fold on every screen, and the
                heading is what the person is being asked to do. */}
            <h1>{title}</h1>
            <p>{name ?? FALLBACK_NAME}</p>
            {/* The motto is doing real work here and is not tidied away.
                Part 3 of the design read names it as one of the things that
                make this recognisably the club's product. */}
            <em className="login-motto">&quot;{motto ?? FALLBACK_MOTTO}&quot;</em>
          </div>
        </div>
        {children}
        <div className="login-foot">{foot}</div>
      </form>
    </div>
  )
}
