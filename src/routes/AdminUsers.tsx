// Admin only: the club's people. Lists club profiles, sends invites through
// the invite-user Edge Function, and changes roles and teams through the
// profiles_admin_all policy. The route guard in App.tsx keeps coaches out and
// RLS would stop them anyway; the function re-checks the caller is an admin
// server side. REVIEW: invite and role-assignment logic.
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useInviteUser, useProfiles, useTeams, useUpdateProfile } from '../lib/queries'
import type { Member, Role, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading } from '../components/ui'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'coach', label: 'Coach' },
  { value: 'admin', label: 'Admin' },
  { value: 'parent', label: 'Parent' },
]

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || 'OTJ'
}

function InviteCard({ teams }: { teams: Team[] }) {
  const invite = useInviteUser()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('coach')
  const [teamId, setTeamId] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const send = () => {
    setNote(null)
    invite.mutate(
      { email: email.trim(), fullName: fullName.trim(), role, teamId: teamId || null },
      {
        onSuccess: (data) => {
          setNote({ kind: 'ok', text: data.warning ?? `Invite sent to ${email.trim()}.` })
          setEmail('')
          setFullName('')
          setRole('coach')
          setTeamId('')
        },
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Invite someone</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        They get an email with a link to the app, set a password and are signed in to this club.
      </p>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
          <label>Email</label>
          <input
            type="email"
            placeholder="coach@club.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label>Full name</label>
          <input placeholder="First and last name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 110, marginBottom: 0 }}>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <label>Team (optional)</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={invite.isPending || !email.trim() || !fullName.trim()}
        >
          <Icon.plus />
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {note && (
        <p
          className="muted"
          style={{ fontSize: 13.5, marginTop: 12, color: note.kind === 'error' ? 'var(--m-pdf)' : 'var(--m-image)' }}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}

function MemberRow({
  m,
  teams,
  isSelf,
  lastAdmin,
}: {
  m: Member
  teams: Team[]
  isSelf: boolean
  lastAdmin: boolean
}) {
  const update = useUpdateProfile()
  // The club must keep at least one admin, so the only admin cannot demote
  // themselves; promote someone else first.
  const roleLocked = isSelf && lastAdmin
  return (
    <div
      className="row wrap"
      style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
    >
      <div className="avatar">{m.avatar || initials(m.fullName)}</div>
      <div style={{ flex: 2, minWidth: 160 }}>
        <b style={{ fontSize: 14.5 }}>
          {m.fullName || 'Unnamed'}
          {isSelf && (
            <span className="muted" style={{ fontWeight: 600 }}>
              {' '}
              (you)
            </span>
          )}
        </b>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Joined {joinedLabel(m.joined)}
        </div>
      </div>
      <div className="field" style={{ width: 130, marginBottom: 0 }}>
        <label>Role</label>
        <select
          value={m.role}
          disabled={roleLocked || update.isPending}
          title={roleLocked ? "You are the club's only admin. Promote another admin first." : undefined}
          onChange={(e) => update.mutate({ id: m.id, role: e.target.value as Role })}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ width: 150, marginBottom: 0 }}>
        <label>Team</label>
        <select
          value={m.teamId ?? ''}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ id: m.id, teamId: e.target.value || null })}
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {roleLocked && (
        <div className="muted" style={{ fontSize: 12.5, flexBasis: '100%' }}>
          You are the club's only admin, so your role is locked. Promote another admin first.
        </div>
      )}
      {update.isError && (
        <div className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', flexBasis: '100%' }}>
          The change did not save. Try again.
        </div>
      )}
    </div>
  )
}

export function AdminUsers() {
  const { user } = useAuth()
  const { data: members = [], isLoading, isError } = useProfiles()
  const { data: teams = [] } = useTeams()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  const adminCount = members.filter((m) => m.role === 'admin').length
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <div className="sub">Invite coaches and parents and manage roles and teams. Admin only.</div>
        </div>
      </div>

      <InviteCard teams={teams} />

      <div className="card" style={{ padding: '6px 18px 4px' }}>
        <div className="row" style={{ padding: '12px 0 8px', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 17 }}>Club members</h3>
          <span className="pill">
            <Icon.users />
            {members.length}
          </span>
        </div>
        {members.map((m) => (
          <MemberRow key={m.id} m={m} teams={teams} isSelf={m.id === user?.id} lastAdmin={adminCount === 1 && m.role === 'admin'} />
        ))}
      </div>
    </div>
  )
}
