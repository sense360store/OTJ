// The front door. Email and password sign-in with a magic-link option and a
// password reset link. Sign-up is invite-only, so there is no registration
// form. REVIEW: part of the auth flow.
//
// VISUAL-02 brought it onto the shared system: the AuthCard both signed out
// screens wear, the field and Button primitives, and the Note for every
// message. Nothing about what it CALLS moved, and no message string changed:
// the three auth calls, their options, their refusals and their
// confirmations are exactly what they were. What changed is the vocabulary
// that draws them, plus two accessibility repairs a visual pass owns.
//
// The first repair: one busy flag drew three controls, so pressing Email me a
// link left the SIGN IN button reading "Signing in…" while the control that
// was actually working said nothing. `pending` names which call is running,
// so each control speaks for itself; all three are still disabled while any
// one of them is in flight, which is the behaviour rather than the wording.
//
// The second: pressing any of the three disables it, the browser blurs a
// disabled control, and focus was still on the document body when the outcome
// arrived. Somebody who clicked rather than pressed Enter had to tab from the
// top of the page to reach the control again, with an alert on screen telling
// them to try. Driven and measured in a browser first (tools/visual/auth.mjs)
// rather than reasoned about, which is the lesson #215 left.
import { useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { supabase } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'
import { Icon } from '../components/icons'
import { Button, Note, TextField } from '../components/primitives'
import { useFocusRestore } from '../hooks/useFocusRestore'

// Which of the three calls is running. `null` is idle; the screen is busy
// whenever it is not null, which is the single disabled rule the screen has
// always had.
type Pending = 'signin' | 'link' | 'reset' | null

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const busy = pending !== null

  // The control the person actually pressed, captured when the call starts.
  // Which one it was cannot be read off the DOM afterwards, because by then
  // the browser has already moved focus to the body. The hook places it back
  // ONLY if focus is still there when the call settles, so pressing Enter in
  // a field (where nothing is disabled and focus never moves) is untouched.
  const signInRef = useRef<HTMLButtonElement>(null)
  const linkRef = useRef<HTMLButtonElement>(null)
  const resetRef = useRef<HTMLButtonElement>(null)
  const pressed = useRef<HTMLElement | null>(null)
  const restoreFocus = useFocusRestore(!busy, pressed)

  // Every call starts the same way: clear whatever the last one said, note
  // which control is working, and ask for focus back if the browser takes it.
  // Clearing the stale error and info first is the existing behaviour and is
  // deliberately unchanged.
  const start = (what: Exclude<Pending, null>, from: RefObject<HTMLButtonElement | null>) => {
    setError(null)
    setInfo(null)
    pressed.current = from.current
    setPending(what)
    restoreFocus()
  }

  const signIn = async (e: FormEvent) => {
    e.preventDefault()
    start('signin', signInRef)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setPending(null)
    if (error) setError(error.message)
  }

  const magicLink = async () => {
    if (!email) {
      setError('Enter your email first, then request a link.')
      return
    }
    start('link', linkRef)
    // shouldCreateUser stays off: the magic link signs in existing invited
    // members only. Without it, this button would register a fresh auth user
    // for any email address while the project accepts signups.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    })
    setPending(null)
    if (error) setError(error.message)
    else setInfo('Check your email for a sign-in link.')
  }

  const forgot = async () => {
    if (!email) {
      setError('Enter your email first, then reset your password.')
      return
    }
    start('reset', resetRef)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setPending(null)
    if (error) setError(error.message)
    else setInfo('Check your email to reset your password.')
  }

  return (
    <AuthCard
      title="Training Hub"
      onSubmit={(e) => void signIn(e)}
      foot={
        <>
          {/* A text link rather than a third button, and deliberately so: two
              full width buttons already carry the two ways in, and a third
              would read as a third way in. No shared primitive owns a text
              link, so this class stays; it takes the shared focus ring from
              the element rule and carries its own 44px minimum. */}
          <button ref={resetRef} className="login-link" type="button" onClick={() => void forgot()} disabled={busy}>
            {pending === 'reset' ? 'Sending a reset link…' : 'Forgot password?'}
          </button>
          <p className="login-invite">Accounts are created by invite. Ask a club admin to add you.</p>
        </>
      }
    >
      {/* The error is the danger Note; the confirmation is the success
          treatment. Both used to borrow a classification colour, the PDF
          media red and the physical corner green, to mean a state.

          Two separate slots rather than one element with a tone, which is
          what makes a refusal replacing a confirmation a fresh insertion into
          a live region rather than a text swap inside one that has already
          been announced: React reconciles children by position, so these are
          different elements without needing a key to say so. Every action
          clears both before it starts, so at most one is ever up. */}
      {error && (
        <Note tone="danger" role="alert" className="login-note-slot">
          {error}
        </Note>
      )}
      {info && (
        <Note tone="success" role="status" className="login-note-slot">
          {info}
        </Note>
      )}

      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@club.com"
        required
      />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Your password"
      />

      <Button ref={signInRef} variant="primary" size="lg" block type="submit" disabled={busy}>
        {pending === 'signin' ? 'Signing in…' : 'Sign in'}
      </Button>

      <div className="login-divider">or</div>

      <Button ref={linkRef} variant="ghost" block icon={Icon.bolt} onClick={() => void magicLink()} disabled={busy}>
        {pending === 'link' ? 'Sending a link…' : 'Email me a link'}
      </Button>

    </AuthCard>
  )
}
