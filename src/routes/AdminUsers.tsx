// The club's people, their roles and what each role can do. Lists club
// profiles with their invited or active state, sends invites through the
// invite-user Edge Function, removes members through the remove-user Edge
// Function, assigns role and team sets through member_roles and member_teams
// (plus the all teams flag), manages custom roles in the roles table, and
// edits the role to capability grid (role_capabilities, keyed by role_id)
// that the policies consult on every request. The route guard in App.tsx
// keeps members without users.manage out, and the RLS, the triggers and the
// functions enforce the same boundaries server side; the checks here only
// decide what to surface. REVIEW: invite, removal and role assignment logic.
import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  useCapabilities,
  useCreateRole,
  useDeleteRole,
  useInviteUser,
  useMemberStates,
  useMyCapabilities,
  useProfiles,
  useRemoveUser,
  useRenameRole,
  useRoleCapabilities,
  useRoles,
  useSaveRoleCapabilities,
  useSetMemberAllTeams,
  useSetMemberRoles,
  useSetMemberTeams,
  useTeams,
} from '../lib/queries'
import { RESERVED_CAPABILITIES, roleKeyFromLabel } from '../lib/data'
import type { Capability, Member, RoleCapability, RoleInfo, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { Tick } from '../components/Tick'
import { UserAvatar } from '../components/UserAvatar'
import { ErrorNote, Loading, Modal } from '../components/ui'

const isAdminRole = (r: RoleInfo) => r.system && r.key === 'admin'
const holdsAdmin = (m: Member) => m.roles.some(isAdminRole)

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

// One labelled checkbox, shared by the role and team pickers. Renders the
// shared Tick, so the pickers and the capability grid keep one look. The
// disabled dimming of the box itself lives in Tick.css; this dims the text.
// Layout, margin and colour are inline because these labels sit inside
// .field wrappers, whose label rule (display block, slate, bottom margin)
// would otherwise win over a class and detach the box from its wording.
function CheckItem({
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
      title={title}
      style={{
        display: 'flex',
        gap: 7,
        alignItems: 'center',
        margin: 0,
        color: 'var(--ink)',
        fontSize: 13.5,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Tick checked={checked} disabled={disabled} onChange={onChange} />
      <span style={{ opacity: disabled ? 0.55 : 1 }}>{label}</span>
    </label>
  )
}

// Team membership editor: the durable all teams flag plus the specific
// selection. While all teams is on every team shows ticked and disabled, so
// the state is unmistakable; the specific selection is kept underneath and
// applies again when the flag goes off.
function TeamPicker({
  teams,
  allTeams,
  teamIds,
  disabled,
  onAllTeams,
  onToggleTeam,
}: {
  teams: Team[]
  allTeams: boolean
  teamIds: Set<string>
  disabled?: boolean
  onAllTeams: (on: boolean) => void
  onToggleTeam: (id: string) => void
}) {
  return (
    <div>
      <CheckItem
        label="All teams, current and future"
        checked={allTeams}
        disabled={disabled}
        onChange={() => onAllTeams(!allTeams)}
      />
      {/* The team list nests under the all teams toggle, indented behind a
          faint rule, so the toggle clearly governs the group. */}
      <div
        className="row wrap"
        style={{ gap: '8px 14px', margin: '8px 0 0 7px', padding: '1px 0 1px 16px', borderLeft: '2px solid var(--line)' }}
      >
        {teams.map((t) => (
          <CheckItem
            key={t.id}
            label={t.name}
            checked={allTeams || teamIds.has(t.id)}
            disabled={allTeams || disabled}
            title={allTeams ? 'All teams is on, so every team is included.' : undefined}
            onChange={() => onToggleTeam(t.id)}
          />
        ))}
        {teams.length === 0 && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            No teams yet. Add them on the Teams screen.
          </span>
        )}
      </div>
    </div>
  )
}

function InviteCard({ teams, roles }: { teams: Team[]; roles: RoleInfo[] }) {
  const invite = useInviteUser()
  const defaultRoleIds = () => new Set(roles.filter((r) => r.system && r.key === 'coach').map((r) => r.id))
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [roleIds, setRoleIds] = useState<Set<string>>(defaultRoleIds)
  const [allTeams, setAllTeams] = useState(false)
  const [teamIds, setTeamIds] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const toggleRole = (r: RoleInfo) => {
    setRoleIds((prev) => {
      const next = new Set(prev)
      if (next.has(r.id)) {
        next.delete(r.id)
      } else {
        next.add(r.id)
        // Admin and manager default to every team, as the invite function
        // would; the toggle stays editable.
        if (r.system && (r.key === 'admin' || r.key === 'manager')) setAllTeams(true)
      }
      return next
    })
  }

  const toggleTeam = (id: string) =>
    setTeamIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const send = () => {
    setNote(null)
    invite.mutate(
      {
        email: email.trim(),
        fullName: fullName.trim(),
        roleIds: [...roleIds],
        teamIds: allTeams ? [] : [...teamIds],
        allTeams,
      },
      {
        onSuccess: (data) => {
          setNote({ kind: 'ok', text: data.warning ?? `Invite sent to ${email.trim()}.` })
          setEmail('')
          setFullName('')
          setRoleIds(defaultRoleIds())
          setAllTeams(false)
          setTeamIds(new Set())
        },
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Invite someone</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
        They get an email with a link to the app, set a password and are signed in to this club with the roles and
        teams you pick here.
      </p>
      <div className="row wrap" style={{ gap: 10 }}>
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
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>Roles</label>
        <div className="row wrap" style={{ gap: '8px 14px' }}>
          {roles.map((r) => (
            <CheckItem key={r.id} label={r.label} checked={roleIds.has(r.id)} onChange={() => toggleRole(r)} />
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label>Teams</label>
        <TeamPicker
          teams={teams}
          allTeams={allTeams}
          teamIds={teamIds}
          onAllTeams={setAllTeams}
          onToggleTeam={toggleTeam}
        />
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 12 }}>
        {roleIds.size === 0 && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            Pick at least one role.
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={invite.isPending || !email.trim() || !fullName.trim() || roleIds.size === 0}
        >
          <Icon.plus />
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {note && (
        <p
          className="muted"
          style={{ fontSize: 13.5, marginTop: 10, color: note.kind === 'error' ? 'var(--m-pdf)' : 'var(--m-image)' }}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}

// Edits one member's role set and team membership. Saves only what changed,
// in order: roles, the all teams flag, then the specific teams. Server
// refusals (the last admin trigger, a permission failure) surface verbatim
// and the modal stays open.
function ManageMemberModal({
  member,
  roles,
  teams,
  lastAdmin,
  onClose,
}: {
  member: Member
  roles: RoleInfo[]
  teams: Team[]
  lastAdmin: boolean
  onClose: () => void
}) {
  const setMemberRoles = useSetMemberRoles()
  const setMemberTeams = useSetMemberTeams()
  const setMemberAllTeams = useSetMemberAllTeams()
  const [roleIds, setRoleIds] = useState<Set<string>>(() => new Set(member.roles.map((r) => r.id)))
  const [allTeams, setAllTeams] = useState(member.allTeams)
  const [teamIds, setTeamIds] = useState<Set<string>>(() => new Set(member.teamIds))
  const [error, setError] = useState<string | null>(null)

  const saving = setMemberRoles.isPending || setMemberTeams.isPending || setMemberAllTeams.isPending

  const toggleRole = (id: string) =>
    setRoleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleTeam = (id: string) =>
    setTeamIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    setError(null)
    try {
      const nextRoles = [...roleIds]
      if (!sameSet(nextRoles, member.roles.map((r) => r.id))) {
        await setMemberRoles.mutateAsync({ memberId: member.id, roleIds: nextRoles })
      }
      if (allTeams !== member.allTeams) {
        await setMemberAllTeams.mutateAsync({ memberId: member.id, allTeams })
      }
      const nextTeams = [...teamIds]
      if (!sameSet(nextTeams, member.teamIds)) {
        await setMemberTeams.mutateAsync({ memberId: member.id, teamIds: nextTeams })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change did not save. Try again.')
    }
  }

  return (
    <Modal
      title="Roles and teams"
      sub={member.fullName || 'Unnamed'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || roleIds.size === 0}>
            <Icon.check />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Roles</label>
        <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>
          A member can hold several roles and gets everything any of them grants.
        </p>
        <div className="row wrap" style={{ gap: '8px 14px' }}>
          {roles.map((r) => {
            // The club must keep one admin; the trigger refuses server side
            // and this keeps the obvious case from a round trip.
            const locked = isAdminRole(r) && lastAdmin && roleIds.has(r.id)
            return (
              <CheckItem
                key={r.id}
                label={r.label}
                checked={roleIds.has(r.id)}
                disabled={locked || saving}
                title={locked ? 'The club must keep at least one admin. Make someone else an admin first.' : undefined}
                onChange={() => toggleRole(r.id)}
              />
            )
          })}
        </div>
        {roleIds.size === 0 && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Keep at least one role.
          </p>
        )}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Teams</label>
        <TeamPicker
          teams={teams}
          allTeams={allTeams}
          teamIds={teamIds}
          disabled={saving}
          onAllTeams={setAllTeams}
          onToggleTeam={toggleTeam}
        />
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 12 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}

function MemberRow({
  m,
  teams,
  isSelf,
  lastAdmin,
  state,
  onManage,
  onRemove,
}: {
  m: Member
  teams: Team[]
  isSelf: boolean
  lastAdmin: boolean
  // Invited until they first sign in, then active. Undefined while the
  // states read is pending or unavailable; no chip shows.
  state?: 'invited' | 'active'
  onManage: () => void
  onRemove: () => void
}) {
  const teamSummary = m.allTeams
    ? 'All teams'
    : m.teamIds.length > 0
      ? m.teamIds
          .map((id) => teams.find((t) => t.id === id)?.name)
          .filter(Boolean)
          .join(', ')
      : 'No teams'
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
          Joined {joinedLabel(m.joined)} · {teamSummary}
        </div>
      </div>
      {/* Every held role, in privilege order. */}
      <div className="row wrap" style={{ gap: 6, flex: 1, minWidth: 140, justifyContent: 'flex-end' }}>
        {m.roles.map((r) => (
          <span key={r.id} className="pill" style={{ fontSize: 11.5 }}>
            {r.label}
          </span>
        ))}
        {m.roles.length === 0 && (
          <span className="pill" style={{ fontSize: 11.5, color: 'var(--m-pdf)' }} title="No roles means no write access. Assign one.">
            No roles
          </span>
        )}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onManage}>
        <Icon.edit />
        Manage
      </button>
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

// ---- The roles manager ------------------------------------------------------

function DeleteRoleModal({
  role,
  holders,
  onClose,
}: {
  role: RoleInfo
  holders: number
  onClose: () => void
}) {
  const deleteRole = useDeleteRole()
  return (
    <Modal
      title="Delete role"
      sub={role.label}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={deleteRole.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            disabled={deleteRole.isPending}
            onClick={() => deleteRole.mutate({ id: role.id }, { onSuccess: onClose })}
          >
            <Icon.trash />
            {deleteRole.isPending ? 'Deleting…' : 'Delete role'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        {holders === 0
          ? 'Nobody holds this role.'
          : `${holders} member${holders === 1 ? ' holds' : 's hold'} this role; deleting it takes the role and its capabilities off them.`}{' '}
        Its capability ticks are removed with it. Members keep their other roles and stay in the club.
      </p>
      {deleteRole.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {deleteRole.error.message}
        </p>
      )}
    </Modal>
  )
}

function RolesCard({ roles, members }: { roles: RoleInfo[]; members: Member[] }) {
  const createRole = useCreateRole()
  const renameRole = useRenameRole()
  const [label, setLabel] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null)
  const [deleting, setDeleting] = useState<RoleInfo | null>(null)

  const key = roleKeyFromLabel(label)
  const holders = (r: RoleInfo) => members.filter((m) => m.roles.some((x) => x.id === r.id)).length

  const create = () => {
    if (!key) return
    createRole.mutate({ key, label: label.trim() }, { onSuccess: () => setLabel('') })
  }

  const saveRename = () => {
    if (!renaming || !renaming.label.trim()) return
    renameRole.mutate({ id: renaming.id, label: renaming.label.trim() }, { onSuccess: () => setRenaming(null) })
  }

  return (
    <div className="card" style={{ padding: 18, marginTop: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Roles</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>
        The four system roles are fixed; custom roles recombine the content capabilities in the grid below. User and
        club administration stay with Admin.
      </p>
      {roles.map((r) => (
        <div
          key={r.id}
          className="row wrap"
          style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
        >
          {renaming?.id === r.id ? (
            <>
              <input
                value={renaming.label}
                autoFocus
                onChange={(e) => setRenaming({ id: r.id, label: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                style={{ flex: 1, minWidth: 140 }}
              />
              <button className="btn btn-primary btn-sm" onClick={saveRename} disabled={renameRole.isPending || !renaming.label.trim()}>
                {renameRole.isPending ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)} disabled={renameRole.isPending}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 140 }}>
                <b style={{ fontSize: 14 }}>{r.label}</b>{' '}
                <span className="mono muted" style={{ fontSize: 11.5 }}>
                  {r.key}
                </span>
              </div>
              <span className="pill" style={{ fontSize: 11.5 }}>
                {holders(r)} member{holders(r) === 1 ? '' : 's'}
              </span>
              {r.system ? (
                <span className="pill" style={{ fontSize: 11.5 }} title="System roles cannot be renamed or deleted; their capabilities stay editable.">
                  System
                </span>
              ) : (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: r.id, label: r.label })}>
                    <Icon.edit />
                    Rename
                  </button>
                  <button
                    className="btn btn-ghost btn-sm icon-only"
                    style={{ width: 38, padding: 0 }}
                    aria-label={'Delete ' + r.label}
                    title="Delete this role"
                    onClick={() => setDeleting(r)}
                  >
                    <Icon.trash />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 10, paddingTop: 14, borderTop: '1px solid var(--line)', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
          <label>New role</label>
          <input placeholder="For example Team Manager" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={create} disabled={createRole.isPending || !key}>
          <Icon.plus />
          {createRole.isPending ? 'Creating…' : 'Create role'}
        </button>
      </div>
      {label && key && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Saved with the key <span className="mono">{key}</span>. Tick its capabilities in the grid below, then assign
          it to members.
        </p>
      )}
      {createRole.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 8 }}>
          {createRole.error.message}
        </p>
      )}
      {renameRole.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 8 }}>
          {renameRole.error.message}
        </p>
      )}
      {deleting && <DeleteRoleModal role={deleting} holders={holders(deleting)} onClose={() => setDeleting(null)} />}
    </div>
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

const tickKey = (roleId: string, capability: string) => `${roleId}:${capability}`

function ConfirmGridModal({
  adds,
  removes,
  catalogue,
  roles,
  pending,
  error,
  onClose,
  onApply,
}: {
  adds: RoleCapability[]
  removes: RoleCapability[]
  catalogue: Capability[]
  roles: RoleInfo[]
  pending: boolean
  error: string | null
  onClose: () => void
  onApply: () => void
}) {
  const label = (key: string) => catalogue.find((c) => c.key === key)?.label ?? key
  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? 'Role'
  const lines = [
    ...adds.map((a) => `${roleLabel(a.roleId)} gains ${label(a.capability)}`),
    ...removes.map((r) => `${roleLabel(r.roleId)} loses ${label(r.capability)}`),
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
        Capabilities attach to roles, not people. These changes take effect immediately for every member holding the
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

function CapabilityGrid({ roles }: { roles: RoleInfo[] }) {
  const { data: catalogue, isLoading: catalogueLoading, isError: catalogueError } = useCapabilities()
  const { data: mapping, isLoading: mappingLoading, isError: mappingError } = useRoleCapabilities()
  const save = useSaveRoleCapabilities()
  // draft holds the edited ticks; null means no edits, render server state.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [confirming, setConfirming] = useState(false)

  const current = useMemo(() => new Set((mapping ?? []).map((rc) => tickKey(rc.roleId, rc.capability))), [mapping])
  const rows = useMemo(() => [...(catalogue ?? [])].sort(capabilityOrder), [catalogue])

  const heading = (
    <>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Roles and capabilities</h3>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Ticks decide what every member holding a role can do, club wide. A member with several roles gets everything
        any of them grants. Reading club content is open to every member and is not gated here.
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
  if (catalogueError || mappingError || rows.length === 0 || roles.length === 0) {
    return (
      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        {heading}
        <p className="muted" style={{ fontSize: 13.5 }}>
          The capability grid is not available. It needs the RBAC migrations (0012 and 0015); apply them and reload.
        </p>
      </div>
    )
  }

  const ticks = draft ?? current
  const adds: RoleCapability[] = []
  const removes: RoleCapability[] = []
  if (draft) {
    for (const r of roles) {
      for (const c of rows) {
        const k = tickKey(r.id, c.key)
        if (draft.has(k) && !current.has(k)) adds.push({ roleId: r.id, capability: c.key })
        if (!draft.has(k) && current.has(k)) removes.push({ roleId: r.id, capability: c.key })
      }
    }
  }
  const changeCount = adds.length + removes.length

  const toggle = (roleId: string, capability: string) => {
    // The reserved capabilities never change from the grid: locked on for
    // admin, not offered anywhere else. The database trigger enforces the
    // same rule.
    if (RESERVED_CAPABILITIES.includes(capability)) return
    const k = tickKey(roleId, capability)
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
            gridTemplateColumns: `minmax(220px, 1fr) repeat(${roles.length}, 92px)`,
            alignItems: 'center',
            minWidth: 220 + roles.length * 92,
          }}
        >
          <span />
          {roles.map((r) => (
            <b key={r.id} style={{ fontSize: 13, textAlign: 'center', padding: '6px 4px' }}>
              {r.label}
            </b>
          ))}
          {rows.map((c) => {
            const reserved = RESERVED_CAPABILITIES.includes(c.key)
            return (
              <Fragment key={c.key}>
                <div style={{ borderTop: '1px solid var(--line)', padding: '10px 12px 10px 0' }}>
                  <b style={{ fontSize: 13.5 }}>{c.label}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.description}
                    {reserved && ' Reserved to the admin role.'}
                  </div>
                </div>
                {roles.map((r) => {
                  const cell = {
                    textAlign: 'center' as const,
                    borderTop: '1px solid var(--line)',
                    padding: '10px 0',
                    alignSelf: 'stretch' as const,
                    display: 'grid',
                    placeItems: 'center',
                  }
                  // Reserved capabilities: shown locked on for admin, not
                  // offered at all on any other role.
                  if (reserved && !isAdminRole(r)) return <div key={r.id} style={cell} />
                  const locked = reserved && isAdminRole(r)
                  return (
                    <div key={r.id} style={cell}>
                      <Tick
                        checked={locked || ticks.has(tickKey(r.id, c.key))}
                        disabled={locked || save.isPending}
                        title={locked ? 'Reserved to the admin role, so the club always keeps an administrator.' : undefined}
                        ariaLabel={`${c.label} for ${r.label}`}
                        onChange={() => toggle(r.id, c.key)}
                      />
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
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
          roles={roles}
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
  const { data: roles = [], isLoading: rolesLoading, isError: rolesError } = useRoles()
  const { data: teams = [] } = useTeams()
  const { data: states } = useMemberStates()
  const [managingId, setManagingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removedNote, setRemovedNote] = useState<string | null>(null)
  if (isLoading || rolesLoading) return <Loading />
  if (isError || rolesError) return <ErrorNote />
  // The route guard already keeps members without users.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('users.manage')) return null
  const adminCount = members.filter(holdsAdmin).length
  const managing = managingId ? members.find((m) => m.id === managingId) : undefined
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Users</h2>
          <div className="sub">Invite and remove members, manage roles and teams, and decide what each role can do.</div>
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
            lastAdmin={adminCount === 1 && holdsAdmin(m)}
            state={states?.[m.id]}
            onManage={() => setManagingId(m.id)}
            onRemove={() => {
              setRemovedNote(null)
              setRemoving(m)
            }}
          />
        ))}
      </div>

      <RolesCard roles={roles} members={members} />

      <CapabilityGrid roles={roles} />

      {managing && (
        <ManageMemberModal
          key={managing.id}
          member={managing}
          roles={roles}
          teams={teams}
          lastAdmin={adminCount === 1 && holdsAdmin(managing)}
          onClose={() => setManagingId(null)}
        />
      )}

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
