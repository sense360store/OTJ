// Account self-service, open to every role, reached from the identity block
// in the sidebar and the mobile top bar. Profile details write through the
// profiles_update_self policy; the password and email changes go through the
// auth client on the signed-in session. Role and club render read-only:
// changing them, and removing an account, stays with club admins.
// REVIEW: part of the auth flow (signed-in password and email updates).
import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useClub, useMyCapabilities, useRemoveAvatar, useTeams, useUpdateMyProfile, useUploadAvatar } from '../lib/queries'
import { ROLE_LABELS } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { UserAvatar } from '../components/UserAvatar'
import { Loading } from '../components/ui'

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

type Note = { kind: 'ok' | 'error'; text: string } | null

function NoteLine({ note }: { note: Note }) {
  if (!note) return null
  return (
    <p
      className="muted"
      style={{ fontSize: 13.5, marginTop: 10, marginBottom: 0, color: note.kind === 'error' ? 'var(--m-pdf)' : 'var(--m-image)' }}
    >
      {note.text}
    </p>
  )
}

function SectionCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 14, marginTop: 0 }}>
        {sub}
      </p>
      {children}
    </div>
  )
}

function PhotoRow() {
  const { profile } = useAuth()
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const inputRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<Note>(null)
  const busy = upload.isPending || remove.isPending

  const pick = (file: File | null) => {
    if (!file) return
    setNote(null)
    upload.mutate(
      { file },
      {
        onSuccess: () => setNote({ kind: 'ok', text: 'Photo updated.' }),
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <UserAvatar name={profile?.full_name} fallbackText={profile?.avatar} path={profile?.avatar_url} size={72} />
        <div className="row wrap" style={{ gap: 9 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              pick(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          <button className="btn btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon.upload />
            {upload.isPending ? 'Uploading…' : profile?.avatar_url ? 'Change photo' : 'Add photo'}
          </button>
          {profile?.avatar_url && (
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => {
                setNote(null)
                remove.mutate(undefined, {
                  onSuccess: () => setNote({ kind: 'ok', text: 'Photo removed. Your initials show instead.' }),
                  onError: (e) => setNote({ kind: 'error', text: e.message }),
                })
              }}
            >
              <Icon.x />
              Remove photo
            </button>
          )}
        </div>
      </div>
      <NoteLine note={note} />
    </div>
  )
}

function NameRow() {
  const { profile } = useAuth()
  const update = useUpdateMyProfile()
  const [draft, setDraft] = useState(profile?.full_name ?? '')
  const [note, setNote] = useState<Note>(null)
  const changed = draft.trim() !== '' && draft.trim() !== (profile?.full_name ?? '')

  const save = () => {
    setNote(null)
    update.mutate(
      { fullName: draft.trim() },
      {
        onSuccess: () => setNote({ kind: 'ok', text: 'Name updated.' }),
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="full-name">Full name</label>
          <input
            id="full-name"
            value={draft}
            placeholder="First and last name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && save()}
          />
        </div>
        <button className="btn btn-primary" disabled={!changed || update.isPending} onClick={save}>
          <Icon.check />
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  )
}

function TeamRow() {
  const { profile } = useAuth()
  const { data: teams = [] } = useTeams()
  const update = useUpdateMyProfile()
  const [note, setNote] = useState<Note>(null)

  return (
    <div style={{ marginTop: 14 }}>
      <div className="field" style={{ marginBottom: 0, maxWidth: 280 }}>
        <label htmlFor="default-team">Default team</label>
        <select
          id="default-team"
          value={profile?.team_id ?? ''}
          disabled={update.isPending}
          onChange={(e) => {
            setNote(null)
            update.mutate(
              { teamId: e.target.value || null },
              {
                onSuccess: () => setNote({ kind: 'ok', text: 'Default team updated.' }),
                onError: (err) => setNote({ kind: 'error', text: err.message }),
              },
            )
          }}
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 6, marginBottom: 0 }}>
        New sessions you plan start on this team. It never limits what you can see.
      </p>
      <NoteLine note={note} />
    </div>
  )
}

function PasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setNote(null)
    if (password !== confirm) {
      setNote({ kind: 'error', text: 'The passwords do not match.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setNote({ kind: 'error', text: error.message })
      return
    }
    setPassword('')
    setConfirm('')
    setNote({ kind: 'ok', text: 'Password changed. Use it next time you sign in.' })
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginBottom: 18 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder="Choose a password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            placeholder="Type it again"
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !password || !confirm}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
      <NoteLine note={note} />
    </form>
  )
}

function EmailForm() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setNote(null)
    const next = email.trim()
    if (next.toLowerCase() === (user?.email ?? '').toLowerCase()) {
      setNote({ kind: 'error', text: 'That is already your sign in email.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email: next })
    setBusy(false)
    if (error) {
      setNote({ kind: 'error', text: error.message })
      return
    }
    setEmail('')
    setNote({
      kind: 'ok',
      text: `A confirmation email is on its way to ${next}. Your sign in email changes only once you confirm it from there.`,
    })
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 10 }}>
        You sign in as <b style={{ color: 'var(--ink)' }}>{user?.email}</b>. Changing it sends a confirmation email to
        the new address; the change completes only when it is confirmed.
      </p>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
          <label htmlFor="new-email">New email</label>
          <input
            id="new-email"
            type="email"
            autoComplete="email"
            value={email}
            placeholder="you@club.com"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Change email'}
        </button>
      </div>
      <NoteLine note={note} />
    </form>
  )
}

// The admin screens are linked only from the desktop sidebar; the mobile
// bottom nav carries no admin entries, so this section is how an admin
// reaches them on a phone. Each row gates on the same capability id as the
// sidebar's ITEM_CAP map, and a member with no admin capability sees no
// section at all.
const ADMIN_LINKS: { cap: string; label: string; sub: string; icon: IconComponent; to: string }[] = [
  { cap: 'club.manage', label: 'Club', sub: 'Name, motto and crest', icon: Icon.star, to: '/admin/club' },
  { cap: 'users.manage', label: 'Users', sub: 'Members, invites and roles', icon: Icon.users, to: '/admin/users' },
  { cap: 'teams.manage', label: 'Teams', sub: 'The club teams', icon: Icon.flag, to: '/admin/teams' },
  { cap: 'club.manage', label: 'Spond', sub: 'Attendance mirrored from Spond', icon: Icon.link, to: '/admin/spond' },
]

export function AdminSection({ caps }: { caps: Set<string> }) {
  const navigate = useNavigate()
  const links = ADMIN_LINKS.filter((l) => caps.has(l.cap))
  if (links.length === 0) return null
  return (
    <SectionCard title="Admin" sub="Club management screens your capabilities open.">
      {links.map((l) => (
        <button
          key={l.to}
          className="row"
          onClick={() => navigate(l.to)}
          style={{
            gap: 12,
            alignItems: 'center',
            width: '100%',
            padding: '10px 0',
            background: 'none',
            border: 0,
            borderTop: '1px solid var(--line)',
            textAlign: 'left',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <l.icon style={{ width: 18, height: 18, color: 'var(--royal)', flex: '0 0 auto' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{l.label}</b>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {l.sub}
            </span>
          </span>
          <Icon.chevR style={{ width: 16, height: 16, flex: '0 0 auto' }} className="muted" />
        </button>
      ))}
    </SectionCard>
  )
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row" style={{ gap: 12, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
      <span className="muted" style={{ fontSize: 13, fontWeight: 700, width: 90, flex: '0 0 90px' }}>
        {label}
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

export function Account() {
  const { profile, role, profileLoading } = useAuth()
  const { data: club } = useClub()
  const { caps } = useMyCapabilities()

  if (profileLoading) return <Loading />

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-head">
        <div>
          <h2>Account</h2>
          <div className="sub">Your details, how you sign in, and your club membership.</div>
        </div>
      </div>

      <SectionCard title="Profile" sub="How you appear across the club. Changes show everywhere at once.">
        <PhotoRow />
        <NameRow />
        <TeamRow />
      </SectionCard>

      <SectionCard title="Security" sub="Change your password or the email you sign in with.">
        <PasswordForm />
        <EmailForm />
      </SectionCard>

      <SectionCard title="Membership" sub="Set by your club admins; shown here for reference.">
        <div style={{ marginBottom: 10 }}>
          <FactRow label="Role" value={role ? ROLE_LABELS[role] : '—'} />
          <FactRow label="Club" value={club?.name ?? 'Ossett Town Juniors'} />
          <FactRow label="Joined" value={profile?.created_at ? joinedLabel(profile.created_at) : '—'} />
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          Roles and club membership are managed by admins, and so is removing an account. Ask a club admin if you need
          either changed.
        </p>
      </SectionCard>

      <AdminSection caps={caps} />
    </div>
  )
}
