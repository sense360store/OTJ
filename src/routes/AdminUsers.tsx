// Admin: the club's people. Lists club profiles, sends invites through the
// invite-user Edge Function, changes roles (from the club's roles table) and
// teams through the profiles policy, and removes members through the
// remove-user Edge Function with an explicit choice about their sessions.
// The route guard keeps non holders out and RLS would stop them anyway; both
// functions re-check the caller holds users.manage server side. The last
// member whose role holds users.manage cannot be demoted or removed, here or
// server side. REVIEW: invite and role-assignment logic.
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import {
  useInviteUser,
  useProfiles,
  useRemoveUser,
  useRolePermissions,
  useRoles,
  useTeams,
  useUpdateProfile,
} from '../lib/queries'
import type { ClubRole, Member, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { UserAvatar } from '../components/UserAvatar'
import { ErrorNote, Loading, Modal } from '../components/ui'

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function InviteCard({ teams, roles }: { teams: Team[]; roles: ClubRole[] }) {
  const invite = useInviteUser()
  const defaultRole = roles.find((r) => r.isSystem && r.name === 'Coach') ?? roles[0]
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '')
  const [teamId, setTeamId] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const send = () => {
    setNote(null)
    invite.mutate(
      { email: email.trim(), fullName: fullName.trim(), roleId, teamId: teamId || null },
      {
        onSuccess: (data) => {
          setNote({ kind: 'ok', text: data.warning ?? `Invite sent to ${email.trim()}.` })
          setEmail('')
          setFullName('')
          setRoleId(defaultRole?.id ?? '')
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
        They get an email with a link to the app, set a password and are signed in to this club with the role you
        choose.
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
        <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <label>Role</label>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
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
          disabled={invite.isPending || !email.trim() || !fullName.trim() || !roleId}
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

// The remove confirm states the session consequence and carries the choice:
// move their sessions to the remover, or let them go with the account. The
// remove-user function re-checks everything server side.
function RemoveMemberModal({ m, sessionCount, onClose }: { m: Member; sessionCount: number; onClose: () => void }) {
  const remove = useRemoveUser()
  const [reassign, setReassign] = useState(true)
  const run = () => remove.mutate({ userId: m.id, reassignSessions: reassign }, { onSuccess: onClose })
  return (
    <Modal
      title="Remove member"
      sub={m.fullName || 'Unnamed member'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={run}
            disabled={remove.isPending}
          >
            <Icon.trash />
            {remove.isPending ? 'Removing…' : 'Remove member'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        Their sign in stops working and their profile is removed. Drills and media they added stay in the club
        library. They have {sessionCount} session{sessionCount !== 1 ? 's' : ''} on the calendar.
      </p>
      {sessionCount > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="radio" checked={reassign} onChange={() => setReassign(true)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 14 }}>
              <b>Move their sessions to me.</b> The plans stay on the club calendar under your name.
            </span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="radio" checked={!reassign} onChange={() => setReassign(false)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 14 }}>
              <b>Delete their sessions.</b> The {sessionCount} session{sessionCount !== 1 ? 's' : ''} leave the
              calendar with them.
            </span>
          </label>
        </div>
      )}
      {remove.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {remove.error.message}
        </p>
      )}
    </Modal>
  )
}

function MemberRow({
  m,
  teams,
  roles,
  isSelf,
  lastManager,
  sessionCount,
}: {
  m: Member
  teams: Team[]
  roles: ClubRole[]
  isSelf: boolean
  // True when this member is the last whose role holds users.manage: their
  // role select and remove action lock, with the reason spelled out.
  lastManager: boolean
  sessionCount: number
}) {
  const update = useUpdateProfile()
  const [removing, setRemoving] = useState(false)
  return (
    <div
      className="row wrap"
      style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
    >
      <UserAvatar name={m.fullName} fallbackText={m.avatar} path={m.avatarUrl} />
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
      <div className="field" style={{ width: 150, marginBottom: 0 }}>
        <label>Role</label>
        <select
          value={m.roleId ?? ''}
          disabled={lastManager || update.isPending}
          title={lastManager ? 'The last member who can manage users keeps that role. Give it to someone else first.' : undefined}
          onChange={(e) => e.target.value && update.mutate({ id: m.id, roleId: e.target.value })}
        >
          {m.roleId === null && <option value="">No role</option>}
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
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
      {!isSelf && (
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 38, padding: 0 }}
          aria-label={'Remove ' + (m.fullName || 'member')}
          title={lastManager ? 'The last member who can manage users cannot be removed.' : 'Remove from the club'}
          disabled={lastManager}
          onClick={() => setRemoving(true)}
        >
          <Icon.trash />
        </button>
      )}
      {lastManager && (
        <div className="muted" style={{ fontSize: 12.5, flexBasis: '100%' }}>
          {isSelf ? 'You are' : 'They are'} the last member who can manage users, so the role is locked and removal is
          off. Give another member a user management role first.
        </div>
      )}
      {update.isError && (
        <div className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', flexBasis: '100%' }}>
          The change did not save. Try again.
        </div>
      )}
      {removing && <RemoveMemberModal m={m} sessionCount={sessionCount} onClose={() => setRemoving(false)} />}
    </div>
  )
}

export function AdminUsers() {
  const { user } = useAuth()
  const { data: members = [], isLoading, isError } = useProfiles()
  const { data: teams = [] } = useTeams()
  const { data: roles = [] } = useRoles()
  const { data: permsByRole = {} } = useRolePermissions()
  // The session counts word the remove confirm: the club calendar is the
  // thing the member leaving actually affects.
  const { sessions } = useSessions()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // The members whose role holds users.manage; when only one remains, that
  // member's demote and remove lock. The remove-user function enforces the
  // same guard server side.
  const managerRoleIds = new Set(
    Object.entries(permsByRole)
      .filter(([, perms]) => perms.includes('users.manage'))
      .map(([roleId]) => roleId),
  )
  const managers = members.filter((m) => m.roleId && managerRoleIds.has(m.roleId))
  const sessionsOf = (id: string) => sessions.filter((s) => s.coachId === id).length
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <div className="sub">Invite people, set roles and teams, and remove members who leave.</div>
        </div>
      </div>

      <InviteCard teams={teams} roles={roles} />

      <div className="card" style={{ padding: '6px 18px 4px' }}>
        <div className="row" style={{ padding: '12px 0 8px', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 17 }}>Club members</h3>
          <span className="pill">
            <Icon.users />
            {members.length}
          </span>
        </div>
        {members.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            teams={teams}
            roles={roles}
            isSelf={m.id === user?.id}
            lastManager={managers.length === 1 && managers[0].id === m.id}
            sessionCount={sessionsOf(m.id)}
          />
        ))}
      </div>
    </div>
  )
}
