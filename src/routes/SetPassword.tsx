// Shown when a user arrives through an invite or password recovery link. The
// link signs them in; this sets the password on that session so they can sign
// in normally next time. The reset emails themselves still come from the
// existing flow on the login screen. REVIEW: part of the auth flow.
//
// VISUAL-02 brought it onto the shared system alongside Login, which it now
// shares a card with (components/AuthCard.tsx): same brand ground, same crest
// led identity, same compact form. It was already the same markup written a
// second time; it is the same component now.
//
// Nothing it writes moved. It still refuses a mismatch before the auth client
// is reached, still calls updateUser({ password }), still clears the flag only
// after a successful update, and still prints the server's own message
// unchanged. The one repair is the focus one Login shares: pressing Save
// disables it, the browser blurs a disabled control, and a refusal used to
// arrive with focus on the document body. Focus goes to the MESSAGE, which is
// the error summary pattern; components/AuthCard.tsx carries the reasoning.
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useFocusRestore } from '../hooks/useFocusRestore'
import { AuthCard, AuthOutcome } from '../components/AuthCard'
import { Button, Note, TextField } from '../components/primitives'

export function SetPassword() {
  const { clearNeedsPassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Rendered only while there is a message, so the ref is null on the path
  // that ends without one and the hook does nothing. See Login for the rest.
  const outcomeRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useFocusRestore(!busy, outcomeRef)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    // Asked for before the call rather than after it, so it covers the
    // refusal as well as the success. On a success there is no message and so
    // no target: clearing the flag hands the whole screen over to the
    // application, and the hook's target has left the document by then.
    restoreFocus()
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    clearNeedsPassword()
  }

  return (
    <AuthCard
      title="Set your password"
      onSubmit={(e) => void submit(e)}
      foot={<p className="login-invite">You can change it later with the reset link on the sign in screen.</p>}
    >
      {/* One slot rather than Login's two: this screen has nothing to confirm,
          because a successful update hands the screen to the application. */}
      {error && (
        <AuthOutcome ref={outcomeRef}>
          <Note tone="danger" role="alert" className="login-note-slot">
            {error}
          </Note>
        </AuthOutcome>
      )}

      <TextField
        id="new-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Choose a password"
        required
      />
      <TextField
        id="confirm-password"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Type it again"
        required
      />

      <Button variant="primary" size="lg" block type="submit" disabled={busy || !password || !confirm}>
        {busy ? 'Saving…' : 'Save password'}
      </Button>
    </AuthCard>
  )
}
