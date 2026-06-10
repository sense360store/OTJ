// Shown when a user arrives through an invite or password recovery link. The
// link signs them in; this sets the password on that session so they can sign
// in normally next time. The reset emails themselves still come from the
// existing flow on the login screen. REVIEW: part of the auth flow.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Crest } from '../components/Crest'
import { useClubBranding } from '../hooks/useClubBranding'
import './Login.css'

export function SetPassword() {
  const { clearNeedsPassword } = useAuth()
  const { name } = useClubBranding()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    clearNeedsPassword()
  }

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <Crest />
          <div>
            <h1>Set your password</h1>
            <p>{name ?? 'Ossett Town Juniors'}</p>
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choose a password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            required
          />
        </div>

        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !password || !confirm}>
          {busy ? 'Saving…' : 'Save password'}
        </button>

        <div className="login-foot">
          <p style={{ marginTop: 14 }}>You can change it later with the reset link on the sign in screen.</p>
        </div>
      </form>
    </div>
  )
}
