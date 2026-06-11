// The club's people and what each role can do. Lists club profiles with
// their invited or active state, sends invites through the invite-user Edge
// Function, removes members through the remove-user Edge Function, edits each
// member's roles and teams through member_roles and member_teams (the
// profiles_users_manage and join table policies), and edits the role to
// capability grid (role_capabilities) that the policies consult on every
// request. Roles and teams are both many to many (migration B): a member can
// hold several roles and belong to several teams. The route guard in App.tsx
// keeps members without users.manage out, and the RLS and the functions
// enforce the same boundary server side; the checks here only decide what to
// surface. REVIEW: invite, removal and role assignment logic.
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
  useSetMemberRoles,
  useSetMemberTeams,
  useTeams,
} from '../lib/queries'
import { ROLE_PRIVILEGE } from '../lib/data'
import type { Capability, Member, Role, RoleCapability, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { UserAvatar } from '../components/UserAvatar'
import { ErrorNote, Loading, Modal } from '../components/ui'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'coach', label: 'Coach' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'parent', label: 'Parent' },
]

const roleLabel = (r: Role) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r
const byPriv = (a: Role, b: Role) => ROLE_PRIVILEGE.indexOf(a) - ROLE_PRIVILEGE.indexOf(b)

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// A labelled checkbox, used for roles and teams in both the invite card and
// each member row.
function Check({
  label,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  title?: string
  onChange: () => void
}) {
  return (
    <label
      className="row"
      style={{ gap: 6, alignItems: 'center', fontSize: 13.5, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}
      title={title}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  )
}

// The roles a member holds, shown as badges, in privilege order.
function RoleBadges({ roles }: { roles: Role[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {[...roles].sort(byPriv).map((r) => (
        <span key={r} className="pill" style={{ fontSize: 11 }}>
          {roleLabel(r)}
        </span>
      ))}
    </span>
  )
}

function InviteCard({ teams }: { teams: Team[] }) {
  const invite = useInviteUser()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [roles, setRoles] = useState<Role[]>(['coach'])
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const toggleRole = (role: Role) =>
    setRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]))
  const toggleTeam = (id: string) =>
    setTeamIds((ts) => (ts.includes(id) ? ts.filter((t) => t !== id) : [...ts, id]))

  const send = () => {
    setNote(null)
    invite.mutate(
      { email: email.trim(), fullName: fullName.trim(), roles, teamIds },
      {
        onSuccess: (data) => {
          setNote({ kind: 'ok', text: data.warning ?? `Invite sent to ${email.trim()}.` })
          setEmail('')
          setFullName('')
          setRoles(['coach'])
          setTeamIds([])
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
      </div>
      <div className="row wrap" style={{ gap: 24, marginTop: 14 }}>
        <div>
          <label className="muted" style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            Roles
          </label>
          <div className="row wrap" style={{ gap: 12 }}>
            {ROLE_OPTIONS.map((r) => (
              <Check key={r.value} label={r.label} checked={roles.includes(r.value)} onChange={() => toggleRole(r.value)} />
            ))}
          </div>
        </div>
        <div>
          <label className="muted" style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            Teams (optional)
          </label>
          {teams.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              No teams yet.
            </span>
          ) : (
            <div className="row wrap" style={{ gap: 12 }}>
              {teams.map((t) => (
                <Check key={t.id} label={t.name} checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={invite.isPending || !email.trim() || !fullName.trim() || roles.length === 0}
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
  // True when this member is the club's only admin: their admin role cannot
  // be unticked and they cannot be removed, or nobody could manage the club.
  lastAdmin: boolean
  // Invited until they first sign in, then active. Undefined while the states
  // read is pending or unavailable; no chip shows.
  state?: 'invited' | 'active'
  onRemove: () => void
}) {
  const setRoles = useSetMemberRoles()
  const setTeams = useSetMemberTeams()
  const pending = setRoles.isPending || setTeams.isPending

  const toggleRole = (role: Role) => {
    const next = m.roles.includes(role) ? m.roles.filter((r) => r !== role) : [...m.roles, role]
    if (next.length === 0) return
    setRoles.mutate({ memberId: m.id, roles: next })
  }
  const toggleTeam = (id: string) => {
    const next = m.teamIds.includes(id) ? m.teamIds.filter((t) => t !== id) : [...m.teamIds, id]
    setTeams.mutate({ memberId: m.id, teamIds: next })
  }

  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
        <UserAvatar name={m.fullName} fallbackText={m.avatar} path={m.avatarUrl} />
        <div style={{ flex: 1, minWidth: 180 }}>
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
          <div style={{ marginTop: 6 }}>
            <RoleBadges roles={m.roles} />
          </div>
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
      </div>

      <div className="row wrap" style={{ gap: 28, marginTop: 12, paddingLeft: 2 }}>
        <div>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            Roles
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            {ROLE_OPTIONS.map((r) => {
              const checked = m.roles.includes(r.value)
              const lockAdmin = r.value === 'admin' && lastAdmin
              const lockLast = checked && m.roles.length === 1
              const disabled = pending || lockAdmin || lockLast
              const title = lockAdmin
                ? "The club's only admin cannot lose the admin role. Promote another admin first."
                : lockLast
                  ? 'A member must keep at least one role.'
                  : undefined
              return (
                <Check
                  key={r.value}
                  label={r.label}
                  checked={checked}
                  disabled={disabled}
                  title={title}
                  onChange={() => toggleRole(r.value)}
                />
              )
            })}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            Teams
          </div>
          {teams.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              No teams yet.
            </span>
          ) : (
            <div className="row wrap" style={{ gap: 12 }}>
              {teams.map((t) => (
                <Check
                  key={t.id}
                  label={t.name}
                  checked={m.teamIds.includes(t.id)}
                  disabled={pending}
                  onChange={() => toggleTeam(t.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {(setRoles.isError || setTeams.isError) && (
        <div className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 8 }}>
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
            gridTemplateColumns: `minmax(220px, 1fr) repeat(${ROLE_OPTIONS.length}, 84px)`,
            alignItems: 'center',
            minWidth: 220 + ROLE_OPTIONS.length * 84,
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
  // An admin is any member holding the admin role through member_roles, so a
  // member who is admin plus coach still counts.
  const adminCount = members.filter((m) => m.roles.includes('admin')).length
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
            lastAdmin={adminCount === 1 && m.roles.includes('admin')}
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
