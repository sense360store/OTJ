// The club's people and what each role can do. Lists club profiles with
// their invited or active state, sends invites through the invite-user Edge
// Function, removes members through the remove-user Edge Function, changes
// roles and teams through the profiles_users_manage policy, and edits the
// role to capability grid (role_capabilities) that the policies consult on
// every request. The route guard in App.tsx keeps members without
// users.manage out, and the RLS and the functions enforce the same boundary
// server side; the checks here only decide what to surface. REVIEW: invite,
// removal and role assignment logic.
import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  useCapabilities,
  useInviteUser,
  useMemberStates,
  useMyCapabilities,
  useProfiles,
  useRemoveUser,
  useRoleCapabilities,
  useSaveRoleCapabilities,
  useTeams,
  useUpdateProfile,
} from '../lib/queries'
import type { Capability, Member, Role, RoleCapability, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { UserAvatar } from '../components/UserAvatar'
import { ErrorNote, Loading, Modal } from '../components/ui'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'coach', label: 'Coach' },
  { value: 'admin', label: 'Admin' },
  { value: 'parent', label: 'Parent' },
]

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
  state,
  onRemove,
}: {
  m: Member
  teams: Team[]
  isSelf: boolean
  lastAdmin: boolean
  // Invited until they first sign in, then active. Undefined while the
  // states read is pending or unavailable; no chip shows.
  state?: 'invited' | 'active'
  onRemove: () => void
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
          {state && (
            <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>
              {state === 'invited' ? 'Invited' : 'Active'}
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
      {/* Removal is for administering others, and the only admin cannot be
          removed; remove-user enforces both server side. */}
      {!isSelf && (
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 38, padding: 0 }}
          aria-label={'Remove ' + (m.fullName || 'member')}
          title={lastAdmin ? "The club's only admin cannot be removed. Promote another admin first." : 'Remove from the club'}
          disabled={lastAdmin}
          onClick={onRemove}
        >
          <Icon.trash />
        </button>
      )}
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

function RemoveMemberModal({
  member,
  onClose,
  onRemoved,
}: {
  member: Member
  onClose: () => void
  onRemoved: (message: string) => void
}) {
  const remove = useRemoveUser()
  return (
    <Modal
      title="Remove member"
      sub={member.fullName || 'Unnamed'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { userId: member.id },
                {
                  onSuccess: (data) =>
                    onRemoved(data.message ?? 'Member removed. Their content stays with the club.'),
                },
              )
            }
          >
            <Icon.trash />
            {remove.isPending ? 'Removing…' : 'Remove member'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes their sign in and their profile. Everything they created (drills, media, templates, programmes
        and sessions) stays with the club as club content. This cannot be undone; they can be invited again later.
      </p>
      {remove.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {remove.error.message}
        </p>
      )}
    </Modal>
  )
}

// ---- The role to capability grid ------------------------------------------

// Render order: content entities first, administration last, create before
// manage within an entity. Unknown entities sort last so a future capability
// still shows.
const ENTITY_ORDER = ['drills', 'media', 'templates', 'programmes', 'sessions', 'teams', 'users', 'club']

function capabilityOrder(a: Capability, b: Capability): number {
  const [entA, actA = ''] = a.key.split('.')
  const [entB, actB = ''] = b.key.split('.')
  const iA = ENTITY_ORDER.indexOf(entA)
  const iB = ENTITY_ORDER.indexOf(entB)
  const d = (iA === -1 ? ENTITY_ORDER.length : iA) - (iB === -1 ? ENTITY_ORDER.length : iB)
  return d !== 0 ? d : actA.localeCompare(actB)
}

const tickKey = (role: Role, capability: string) => `${role}:${capability}`

function ConfirmGridModal({
  adds,
  removes,
  catalogue,
  pending,
  error,
  onClose,
  onApply,
}: {
  adds: RoleCapability[]
  removes: RoleCapability[]
  catalogue: Capability[]
  pending: boolean
  error: string | null
  onClose: () => void
  onApply: () => void
}) {
  const label = (key: string) => catalogue.find((c) => c.key === key)?.label ?? key
  const roleLabel = (r: Role) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r
  const lines = [
    ...adds.map((a) => `${roleLabel(a.role)} gains ${label(a.capability)}`),
    ...removes.map((r) => `${roleLabel(r.role)} loses ${label(r.capability)}`),
  ]
  return (
    <Modal
      title="Apply capability changes"
      sub={`${lines.length} change${lines.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onApply} disabled={pending}>
            <Icon.check />
            {pending ? 'Applying…' : 'Apply to the whole club'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        Capabilities attach to roles, not people. These changes take effect immediately for every member with the
        role.
      </p>
      <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 18 }}>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}

function CapabilityGrid() {
  const { data: catalogue, isLoading: catalogueLoading, isError: catalogueError } = useCapabilities()
  const { data: mapping, isLoading: mappingLoading, isError: mappingError } = useRoleCapabilities()
  const save = useSaveRoleCapabilities()
  // draft holds the edited ticks; null means no edits, render server state.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [confirming, setConfirming] = useState(false)

  const current = useMemo(() => new Set((mapping ?? []).map((rc) => tickKey(rc.role, rc.capability))), [mapping])
  const rows = useMemo(() => [...(catalogue ?? [])].sort(capabilityOrder), [catalogue])

  const heading = (
    <>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Roles and capabilities</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Ticks decide what every member of a role can do, club wide. Reading club content is open to every member and
        is not gated here.
      </p>
    </>
  )

  if (catalogueLoading || mappingLoading) {
    return (
      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        {heading}
        <Loading label="Loading the grid…" />
      </div>
    )
  }
  if (catalogueError || mappingError || rows.length === 0) {
    return (
      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        {heading}
        <p className="muted" style={{ fontSize: 13.5 }}>
          The capability grid is not available. It arrives with the 0012_rbac migration; apply it and reload.
        </p>
      </div>
    )
  }

  const ticks = draft ?? current
  const adds: RoleCapability[] = []
  const removes: RoleCapability[] = []
  if (draft) {
    for (const r of ROLE_OPTIONS) {
      for (const c of rows) {
        const k = tickKey(r.value, c.key)
        if (draft.has(k) && !current.has(k)) adds.push({ role: r.value, capability: c.key })
        if (!draft.has(k) && current.has(k)) removes.push({ role: r.value, capability: c.key })
      }
    }
  }
  const changeCount = adds.length + removes.length

  const toggle = (role: Role, capability: string) => {
    // Admins keep user management, so the grid cannot lock everyone out.
    if (role === 'admin' && capability === 'users.manage') return
    const k = tickKey(role, capability)
    const next = new Set(ticks)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setDraft(next)
  }

  const apply = () =>
    save.mutate(
      { adds, removes },
      {
        onSuccess: () => {
          setDraft(null)
          setConfirming(false)
        },
      },
    )

  return (
    <div className="card" style={{ padding: 18, marginTop: 18 }}>
      {heading}
      <div style={{ overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) repeat(3, 84px)',
            alignItems: 'center',
            minWidth: 480,
          }}
        >
          <span />
          {ROLE_OPTIONS.map((r) => (
            <b key={r.value} style={{ fontSize: 13, textAlign: 'center', padding: '6px 0' }}>
              {r.label}
            </b>
          ))}
          {rows.map((c) => (
            <Fragment key={c.key}>
              <div style={{ borderTop: '1px solid var(--line)', padding: '10px 12px 10px 0' }}>
                <b style={{ fontSize: 13.5 }}>{c.label}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {c.description}
                </div>
              </div>
              {ROLE_OPTIONS.map((r) => {
                const locked = r.value === 'admin' && c.key === 'users.manage'
                return (
                  <div
                    key={r.value}
                    style={{ textAlign: 'center', borderTop: '1px solid var(--line)', padding: '10px 0', alignSelf: 'stretch', display: 'grid', placeItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={ticks.has(tickKey(r.value, c.key))}
                      disabled={locked || save.isPending}
                      title={locked ? 'Admins keep user management, so the grid cannot lock everyone out.' : undefined}
                      aria-label={`${c.label} for ${r.label}`}
                      onChange={() => toggle(r.value, c.key)}
                    />
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {changeCount > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)} disabled={save.isPending}>
            Discard
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setConfirming(true)} disabled={save.isPending}>
            Review {changeCount} change{changeCount === 1 ? '' : 's'}…
          </button>
        </div>
      )}
      {confirming && changeCount > 0 && (
        <ConfirmGridModal
          adds={adds}
          removes={removes}
          catalogue={rows}
          pending={save.isPending}
          error={save.isError ? 'Could not save every change. The grid shows what saved; try again.' : null}
          onClose={() => setConfirming(false)}
          onApply={apply}
        />
      )}
    </div>
  )
}

export function AdminUsers() {
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: members = [], isLoading, isError } = useProfiles()
  const { data: teams = [] } = useTeams()
  const { data: states } = useMemberStates()
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removedNote, setRemovedNote] = useState<string | null>(null)
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // The route guard already keeps members without users.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('users.manage')) return null
  const adminCount = members.filter((m) => m.role === 'admin').length
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <div className="sub">Invite and remove members, manage roles and teams, and decide what each role can do.</div>
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
        {removedNote && (
          <p className="muted" style={{ fontSize: 13.5, color: 'var(--m-image)', paddingBottom: 10 }}>
            {removedNote}
          </p>
        )}
        {members.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            teams={teams}
            isSelf={m.id === user?.id}
            lastAdmin={adminCount === 1 && m.role === 'admin'}
            state={states?.[m.id]}
            onRemove={() => {
              setRemovedNote(null)
              setRemoving(m)
            }}
          />
        ))}
      </div>

      <CapabilityGrid />

      {removing && (
        <RemoveMemberModal
          member={removing}
          onClose={() => setRemoving(null)}
          onRemoved={(message) => {
            setRemoving(null)
            setRemovedNote(message)
          }}
        />
      )}
    </div>
  )
}
