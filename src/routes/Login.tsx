// The front door. Email and password sign-in with a magic-link option and a
// password reset link. Sign-up is invite-only, so there is no registration
// form. REVIEW: part of the auth flow.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Crest } from '../components/Crest'
import { Icon } from '../components/icons'
import './Login.css'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
  }

  const magicLink = async () => {
    if (!email) {
      setError('Enter your email first, then request a link.')
      return
    }
    setError(null)
    setInfo(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setInfo('Check your email for a sign-in link.')
  }

  const forgot = async () => {
    if (!email) {
      setError('Enter your email first, then reset your password.')
      return
    }
    setError(null)
    setInfo(null)
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setInfo('Check your email to reset your password.')
  }

  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={signIn}>
        <div className="login-head">
          <Crest />
          <div>
            <h1>Training Hub</h1>
            <p>Ossett Town Juniors</p>
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}
        {info && <div className="login-note">{info}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@club.com"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </div>

        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-divider">or</div>

        <button className="btn btn-ghost btn-block" type="button" onClick={magicLink} disabled={busy}>
          <Icon.bolt />
          Email me a link
        </button>

        <div className="login-foot">
          <button className="login-link" type="button" onClick={forgot} disabled={busy}>
            Forgot password?
          </button>
          <p style={{ marginTop: 14 }}>Accounts are created by invite. Ask a club admin to add you.</p>
        </div>
      </form>
    </div>
  )
}
