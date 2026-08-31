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
//
// VISUAL-02 brought it onto the shared system: PageHeader, Card, Button and
// IconButton, the field primitives, Note, Badge and the shared state
// families, with the capability grid becoming a real table. Nothing about the
// queries, the invite defaults, the last admin protection, the reserved
// capabilities, the all teams flag or the order the member save writes in
// moved; what changed is which vocabulary draws them, and that eight title
// attributes became sentences a coach can read on a phone. Six of them
// carried a RULE (why every team is ticked, why an Admin tick is held on,
// why a member with no role has no write access, why the club's only admin
// cannot be removed, why a system role cannot be renamed, why a reserved
// capability is offered on no other role); the other two named a control
// that already had an aria-label.
import { useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useFocusRestore } from '../hooks/useFocusRestore'
import {
  useCapabilities,
  useCreateRole,
  useDeleteRole,
  useInviteUser,
  useMemberActiveShareCount,
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
import { RESERVED_CAPABILITIES, roleKeyFromLabel, SHARE_CAPS } from '../lib/data'
import type { Capability, Member, RoleCapability, RoleInfo, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { Tick } from '../components/Tick'
import { UserAvatar } from '../components/UserAvatar'
import { ErrorNote, Loading, Modal, Pill } from '../components/ui'
import { Badge, Button, Card, IconButton, Note, PageHeader, TextField } from '../components/primitives'

const isAdminRole = (r: RoleInfo) => r.system && r.key === 'admin'
const holdsAdmin = (m: Member) => m.roles.some(isAdminRole)

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

// One labelled checkbox, shared by the role and team pickers. The row is the
// shared .check-row, so the LABEL is the 44px target rather than the 16px
// box, and the drawn Tick inside it is the same control the capability grid
// renders. The inline layout, colour and size this used to carry are all
// .check-row's now.
function CheckItem({
  label,
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  // The id of the sentence that accounts for this row being inert.
  describedBy?: string
  onChange: () => void
}) {
  return (
    <label className={disabled ? 'check-row is-disabled' : 'check-row'}>
      <Tick checked={checked} disabled={disabled} describedBy={describedBy} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

// A named set of check rows: a real fieldset and legend, so the group has a
// name rather than a styled word sitting above it.
function CheckGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
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
  /* Turning All teams on ticks and freezes every team below it at once. The
     sentence saying so is BOUND to the toggle rather than merely sitting
     under it, and announced when it appears, because the five boxes that
     just changed are disabled and therefore out of the tab order: without
     this nothing tells a member using a screen reader that they changed. */
  const allTeamsHintId = useId()
  return (
    <div>
      <CheckItem
        label="All teams, current and future"
        checked={allTeams}
        disabled={disabled}
        describedBy={allTeams && teams.length > 0 ? allTeamsHintId : undefined}
        onChange={() => onAllTeams(!allTeams)}
      />
      {/* The team list nests under the all teams toggle, indented behind a
          faint rule, so the toggle clearly governs the group. */}
      <div className="team-nest">
        {teams.length === 0 ? (
          <p className="admin-hint">No teams yet. Add them on the Teams screen.</p>
        ) : (
          <>
            <div className="check-grid">
              {teams.map((t) => (
                <CheckItem
                  key={t.id}
                  label={t.name}
                  checked={allTeams || teamIds.has(t.id)}
                  disabled={allTeams || disabled}
                  onChange={() => onToggleTeam(t.id)}
                />
              ))}
            </div>
            {/* The reason every team is ticked and inert, said once and in
                the open. It was a title on each row, which is a tooltip and
                does not survive touch. */}
            {allTeams && (
              <p className="admin-hint" id={allTeamsHintId} role="status">
                All teams is on, so every team is included. Turn it off to pick teams.
              </p>
            )}
          </>
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
  /* Sending disables Send, and on a success the cleared fields keep it
     disabled, so the browser drops focus onto the document body whichever way
     the call goes. Reproduced in a browser before it was repaired, which is
     the rule #215, #216 and #217 left.

     Focus lands on the OUTCOME rather than back on Send, which is the error
     summary pattern the auth screens settled: the message and the focus move
     land in the same commit, and a screen reader flushes its speech queue on
     a focus change, so an announcement made through the live region in that
     commit can be cut short. What it costs is a member sending a second
     invite, who now tabs back up to the Email field. */
  const outcomeRef = useRef<HTMLDivElement>(null)
  const wantOutcomeFocus = useFocusRestore(note !== null, outcomeRef)
  // So the inert submit POINTS at the sentence that accounts for it, rather
  // than the sentence merely sitting above it.
  const noRolesId = useId()

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
    wantOutcomeFocus()
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

  const noRoles = roleIds.size === 0

  return (
    <Card>
      <div className="section-title section-title-tight">
        <h2>Invite someone</h2>
      </div>
      <p className="admin-intro">
        They get an email with a link to the app, set a password and are signed in to this club with the roles and
        teams you pick here.
      </p>
      <div className="admin-add">
        <TextField
          label="Email"
          type="email"
          className="field-flush admin-field-grow"
          placeholder="coach@club.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Full name"
          className="field-flush admin-field-grow"
          placeholder="First and last name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="admin-note">
        <CheckGroup legend="Roles">
          <div className="check-grid">
            {roles.map((r) => (
              <CheckItem key={r.id} label={r.label} checked={roleIds.has(r.id)} onChange={() => toggleRole(r)} />
            ))}
          </div>
        </CheckGroup>
        <CheckGroup legend="Teams">
          <TeamPicker
            teams={teams}
            allTeams={allTeams}
            teamIds={teamIds}
            onAllTeams={setAllTeams}
            onToggleTeam={toggleTeam}
          />
        </CheckGroup>
      </div>
      {/* The reason Send is inert, in the open rather than left to be
          inferred from a greyed control. */}
      {noRoles && (
        <Note tone="warning" role="status" id={noRolesId} className="admin-note">
          Pick at least one role. An invite with no role grants nothing.
        </Note>
      )}
      <div className="admin-acts-end">
        <Button
          variant="primary"
          icon={Icon.plus}
          onClick={send}
          aria-describedby={noRoles ? noRolesId : undefined}
          disabled={invite.isPending || !email.trim() || !fullName.trim() || noRoles}
        >
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>
      {note && (
        <div ref={outcomeRef} tabIndex={-1} className="admin-note">
          {note.kind === 'error' ? (
            <Note tone="danger" role="alert">
              {note.text}
            </Note>
          ) : (
            <Note tone="success" role="status">
              {note.text}
            </Note>
          )}
        </div>
      )}
    </Card>
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
  const noRolesId = useId()
  const lockHintId = useId()

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

  // The club must keep one admin; the trigger refuses server side and this
  // keeps the obvious case from a round trip.
  const isLocked = (r: RoleInfo) => isAdminRole(r) && lastAdmin && roleIds.has(r.id)
  const anyLocked = roles.some(isLocked)

  return (
    <Modal
      title="Roles and teams"
      sub={member.fullName || 'Unnamed'}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icon.check}
            onClick={() => void save()}
            aria-describedby={roleIds.size === 0 ? noRolesId : undefined}
            disabled={saving || roleIds.size === 0}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <CheckGroup legend="Roles">
        <p className="admin-intro">A member can hold several roles and gets everything any of them grants.</p>
        <div className="check-grid">
          {roles.map((r) => (
            <CheckItem
              key={r.id}
              label={r.label}
              checked={roleIds.has(r.id)}
              disabled={isLocked(r) || saving}
              describedBy={isLocked(r) ? lockHintId : undefined}
              onChange={() => toggleRole(r.id)}
            />
          ))}
        </div>
        {/* Why the Admin tick is inert, said in the open. It was a title on
            the row, which does not survive touch. */}
        {anyLocked && (
          <p className="admin-hint" id={lockHintId}>
            The club must keep at least one admin. Make someone else an admin first.
          </p>
        )}
      </CheckGroup>
      {roleIds.size === 0 && (
        <Note tone="warning" role="status" id={noRolesId} className="admin-note">
          Keep at least one role. A member with none has no write access.
        </Note>
      )}
      <CheckGroup legend="Teams">
        <TeamPicker
          teams={teams}
          allTeams={allTeams}
          teamIds={teamIds}
          disabled={saving}
          onAllTeams={setAllTeams}
          onToggleTeam={toggleTeam}
        />
      </CheckGroup>
      {error && (
        <Note tone="danger" role="alert">
          {error}
        </Note>
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
  // states read is pending or unavailable; no badge shows.
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
  const lockedRemoval = !isSelf && lastAdmin
  const lockId = `member-lock-${m.id}`
  return (
    <li className="admin-row">
      <UserAvatar name={m.fullName} fallbackText={m.avatar} path={m.avatarUrl} />
      <div className="admin-row-main">
        <div className="admin-name">
          {m.fullName || 'Unnamed'}
          {isSelf && <span className="muted"> (you)</span>}
        </div>
        <div className="admin-meta">
          {/* Invited is the state worth spotting in a list; active is the
              ordinary one, so it takes the neutral tone rather than a green
              that would paint most of the club. Both carry a dot AND a word,
              so neither is colour alone. */}
          {state && <Badge tone={state === 'invited' ? 'info' : 'neutral'}>{state === 'invited' ? 'Invited' : 'Active'}</Badge>}
          <span>
            Joined {joinedLabel(m.joined)} · {teamSummary}
          </span>
        </div>
        {m.roles.length === 0 && <p className="admin-hint">No roles means no write access. Assign one.</p>}
        {lockedRemoval && (
          <p className="admin-hint" id={lockId}>
            The club's only admin cannot be removed. Promote another admin first.
          </p>
        )}
      </div>
      {/* Every held role, in privilege order. A role is a classification
          rather than a state, so it takes no semantic tone; holding none is
          a state and takes the danger one. */}
      <div className="admin-tags">
        {m.roles.map((r) => (
          <Pill key={r.id}>{r.label}</Pill>
        ))}
        {m.roles.length === 0 && <Badge tone="danger">No roles</Badge>}
      </div>
      <div className="admin-row-acts">
        {/* Named for its own member: a screen reader listing the page's
            buttons gets one identical "Manage" per row otherwise, which is
            exactly the context that listing strips away. The visible word is
            still the start of the name, so the label matches what a voice
            user says. */}
        <Button size="sm" icon={Icon.edit} aria-label={'Manage ' + (m.fullName || 'member')} onClick={onManage}>
          Manage
        </Button>
        {/* Removal is for administering others, and the only admin cannot be
            removed; remove-user enforces both server side. */}
        {!isSelf && (
          <IconButton
            tone="danger"
            icon={Icon.trash}
            label={'Remove ' + (m.fullName || 'member')}
            disabled={lastAdmin}
            aria-describedby={lockedRemoval ? lockId : undefined}
            onClick={onRemove}
          />
        )}
      </div>
    </li>
  )
}

// The public links warning inside the removal modal. It is advisory only and
// never gates the removal: an admin without shares.manage sees nothing, a count
// that fails to load renders nothing, and the Remove button is untouched in
// every case. The count is the server's own total for that member's active
// links, so no page of another member's shares is pulled into the browser, and
// nothing about an individual link is shown here.
export function MemberShareWarning({ memberId }: { memberId: string }) {
  const { caps } = useMyCapabilities()
  const canManage = caps.has(SHARE_CAPS.manage)
  const { data: count } = useMemberActiveShareCount(canManage ? memberId : null)
  if (!canManage || typeof count !== 'number' || count < 1) return null
  return (
    <Note tone="warning" role="status">
      This member has {count} public {count === 1 ? 'link' : 'links'} still working. Removing them does not turn
      {count === 1 ? ' it' : ' them'} off: the {count === 1 ? 'link keeps' : 'links keep'} working and will show as
      made by a former member. <Link to={`/admin/shares?createdBy=${memberId}`}>Review their links</Link>
    </Note>
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
          <Button variant="quiet" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Icon.trash}
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
            {remove.isPending ? 'Removing…' : 'Remove member'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        This removes their sign in and their profile. Everything they created (drills, media, templates, programmes
        and sessions) stays with the club as club content. This cannot be undone; they can be invited again later.
      </p>
      <MemberShareWarning memberId={member.id} />
      {remove.isError && (
        <Note tone="danger" role="alert" className="admin-note">
          {remove.error.message}
        </Note>
      )}
    </Modal>
  )
}

// ---- The roles manager ------------------------------------------------------

function DeleteRoleModal({
  role,
  holders,
  onClose,
  onDeleted,
}: {
  role: RoleInfo
  holders: number
  onClose: () => void
  onDeleted: () => void
}) {
  const deleteRole = useDeleteRole()
  return (
    <Modal
      title="Delete role"
      sub={role.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={deleteRole.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Icon.trash}
            disabled={deleteRole.isPending}
            onClick={() =>
              deleteRole.mutate(
                { id: role.id },
                {
                  onSuccess: () => {
                    onDeleted()
                    onClose()
                  },
                },
              )
            }
          >
            {deleteRole.isPending ? 'Deleting…' : 'Delete role'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        {holders === 0
          ? 'Nobody holds this role.'
          : `${holders} member${holders === 1 ? ' holds' : 's hold'} this role; deleting it takes the role and its capabilities off them.`}{' '}
        Its capability ticks are removed with it. Members keep their other roles and stay in the club.
      </p>
      {deleteRole.isError && (
        <Note tone="danger" role="alert">
          {deleteRole.error.message}
        </Note>
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
  const [deleted, setDeleted] = useState<{ id: string; message: string } | null>(null)
  /* Deleting a role takes the row and the trash button focus is restored to,
     one network round trip after the dialog closes, so this waits for the ROW
     LEAVING THE LIST rather than for the write settling. Same rule and same
     reason as the member removal below. */
  const deletedRef = useRef<HTMLDivElement>(null)
  const roleGone = deleted !== null && !roles.some((r) => r.id === deleted.id)
  const wantDeletedFocus = useFocusRestore(roleGone, deletedRef)
  /* Create role disables while the write is out and the success empties the
     field, so it stays disabled; focus goes back to the field, which is where
     the next role is typed. A rename replaces the row's field and Save with
     the display form, so both unmount: focus goes to that row's own Rename
     button, which is the control the coach pressed to get there. */
  const newRoleRef = useRef<HTMLInputElement>(null)
  const wantNewRoleFocus = useFocusRestore(!createRole.isPending, newRoleRef)
  const renamedRef = useRef<HTMLButtonElement>(null)
  const [renamed, setRenamed] = useState<string | null>(null)
  const wantRenamedFocus = useFocusRestore(renamed !== null && renaming === null, renamedRef)

  const key = roleKeyFromLabel(label)
  const holders = (r: RoleInfo) => members.filter((m) => m.roles.some((x) => x.id === r.id)).length

  const create = () => {
    if (!key) return
    wantNewRoleFocus()
    createRole.mutate({ key, label: label.trim() }, { onSuccess: () => setLabel('') })
  }

  const saveRename = () => {
    if (!renaming || !renaming.label.trim()) return
    const id = renaming.id
    wantRenamedFocus()
    renameRole.mutate(
      { id, label: renaming.label.trim() },
      {
        onSuccess: () => {
          setRenamed(id)
          setRenaming(null)
        },
      },
    )
  }

  return (
    <Card>
      <div className="section-title section-title-tight">
        <h2>Roles</h2>
      </div>
      <p className="admin-intro">
        The four system roles are fixed and cannot be renamed or deleted; their capabilities stay editable. Custom
        roles recombine the content capabilities in the grid below. User and club administration stay with Admin.
      </p>
      {deleted && (
        <div ref={deletedRef} tabIndex={-1} className="admin-note">
          <Note tone="success" role="status">
            {deleted.message}
          </Note>
        </div>
      )}
      <ul className="admin-list">
        {roles.map((r) => (
          <li key={r.id} className="admin-row">
            {renaming?.id === r.id ? (
              <>
                <TextField
                  label={`New name for ${r.label}`}
                  labelHidden
                  className="field-flush admin-field-grow"
                  value={renaming.label}
                  autoFocus
                  onChange={(e) => setRenaming({ id: r.id, label: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                />
                <div className="admin-row-acts">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveRename}
                    disabled={renameRole.isPending || !renaming.label.trim()}
                  >
                    {renameRole.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" onClick={() => setRenaming(null)} disabled={renameRole.isPending}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="admin-row-main">
                  <span className="admin-name">{r.label}</span>{' '}
                  <span className="mono muted">{r.key}</span>
                </div>
                <div className="admin-tags">
                  <Pill>
                    {holders(r)} member{holders(r) === 1 ? '' : 's'}
                  </Pill>
                  {r.system && <Badge>System</Badge>}
                </div>
                {!r.system && (
                  <div className="admin-row-acts">
                    <Button
                      size="sm"
                      icon={Icon.edit}
                      aria-label={'Rename ' + r.label}
                      ref={r.id === renamed ? renamedRef : undefined}
                      onClick={() => setRenaming({ id: r.id, label: r.label })}
                    >
                      Rename
                    </Button>
                    <IconButton
                      tone="danger"
                      icon={Icon.trash}
                      label={'Delete ' + r.label}
                      onClick={() => {
                        setDeleted(null)
                        setDeleting(r)
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="admin-add admin-note">
        <TextField
          label="New role"
          className="field-flush admin-field-grow"
          ref={newRoleRef}
          placeholder="For example Team Manager"
          value={label}
          hint={
            label && key ? (
              <>
                Saved with the key <span className="mono">{key}</span>. Tick its capabilities in the grid below, then
                assign it to members.
              </>
            ) : undefined
          }
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button variant="primary" icon={Icon.plus} onClick={create} disabled={createRole.isPending || !key}>
          {createRole.isPending ? 'Creating…' : 'Create role'}
        </Button>
      </div>
      {createRole.isError && (
        <Note tone="danger" role="alert" className="admin-note">
          {createRole.error.message}
        </Note>
      )}
      {renameRole.isError && (
        <Note tone="danger" role="alert" className="admin-note">
          {renameRole.error.message}
        </Note>
      )}
      {deleting && (
        <DeleteRoleModal
          role={deleting}
          holders={holders(deleting)}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            wantDeletedFocus()
            setDeleted({ id: deleting.id, message: `${deleting.label} deleted. Members keep their other roles.` })
          }}
        />
      )}
    </Card>
  )
}

// ---- The role to capability grid ------------------------------------------

// Render order: content entities first, then the registered players domain,
// then club administration, with the audit oversight capability last.
// Unknown entities sort after these so a future capability still shows.
const ENTITY_ORDER = [
  'drills',
  'media',
  'templates',
  'programmes',
  'sessions',
  'players',
  'seasons',
  'teams',
  'users',
  'club',
  'audit',
]

// Within an entity, order by increasing scope and impact rather than
// alphabetically, so a family with several verbs (players) reads coherently:
// read, then the write verbs, then the destructive one. create stays before
// manage as before. Unknown verbs sort last.
const ACTION_ORDER = ['view', 'create', 'manage', 'import', 'export', 'delete']

function rankIn(order: string[], value: string): number {
  const i = order.indexOf(value)
  return i === -1 ? order.length : i
}

function capabilityOrder(a: Capability, b: Capability): number {
  const [entA, actA = ''] = a.key.split('.')
  const [entB, actB = ''] = b.key.split('.')
  const d = rankIn(ENTITY_ORDER, entA) - rankIn(ENTITY_ORDER, entB)
  if (d !== 0) return d
  const e = rankIn(ACTION_ORDER, actA) - rankIn(ACTION_ORDER, actB)
  return e !== 0 ? e : actA.localeCompare(actB)
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
          <Button variant="quiet" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon={Icon.check} onClick={onApply} disabled={pending}>
            {pending ? 'Applying…' : 'Apply to the whole club'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        Capabilities attach to roles, not people. These changes take effect immediately for every member holding the
        role.
      </p>
      <ul className="cap-changes">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {error && (
        <Note tone="danger" role="alert" className="admin-note">
          {error}
        </Note>
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
  const [saved, setSaved] = useState<number | null>(null)
  // The base for each row header's own name id; the capability key makes each
  // one unique within the grid.
  const capNameId = useId()
  /* Applying closes the dialog AND clears the draft, which removes the
     "Review N changes…" button the dialog was opened from, so Modal's own
     restore finds its opener already gone and the browser leaves focus on the
     document body. Focus goes to the outcome, which is the only thing on the
     page that says what happened. Reproduced in a browser before it was
     repaired. */
  const savedRef = useRef<HTMLDivElement>(null)
  const wantSavedFocus = useFocusRestore(saved !== null, savedRef)

  const current = useMemo(() => new Set((mapping ?? []).map((rc) => tickKey(rc.roleId, rc.capability))), [mapping])
  const rows = useMemo(() => [...(catalogue ?? [])].sort(capabilityOrder), [catalogue])

  const heading = (
    <>
      <div className="section-title section-title-tight">
        <h2>Roles and capabilities</h2>
      </div>
      <p className="admin-intro">
        Ticks decide what every member holding a role can do, club wide. A member with several roles gets everything
        any of them grants. Reading club content is open to every member and is not gated here.
      </p>
    </>
  )

  if (catalogueLoading || mappingLoading) {
    return (
      <Card>
        {heading}
        <Loading label="Loading the grid…" />
      </Card>
    )
  }
  if (catalogueError || mappingError || rows.length === 0 || roles.length === 0) {
    return (
      <Card>
        {heading}
        <ErrorNote>
          The capability grid is not available. It needs the RBAC migrations (0012 and 0015); apply them and reload.
        </ErrorNote>
      </Card>
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
    setSaved(null)
    setDraft(next)
  }

  const apply = () => {
    wantSavedFocus()
    save.mutate(
      { adds, removes },
      {
        onSuccess: () => {
          setSaved(changeCount)
          setDraft(null)
          setConfirming(false)
        },
      },
    )
  }

  return (
    <Card>
      {heading}
      {/* A real table: a capability per row, a role per column and a tick
          where they cross. It was a CSS grid of unlabelled cells, so nothing
          told a screen reader which role a tick belonged to except the tick's
          own aria-label, which is unchanged and still says both. */}
      <div className="cap-scroll">
        <table className="cap-grid">
          <caption className="sr-only">Which capabilities each role grants</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {roles.map((r) => (
                <th key={r.id} scope="col">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const reserved = RESERVED_CAPABILITIES.includes(c.key)
              return (
                <tr key={c.key}>
                  {/* The header's NAME is the capability alone. Without the
                      aria-labelledby the whole description joins it, and a
                      screen reader reads roughly thirty words before every
                      one of the five cells in the row; the sentence is still
                      read when the header cell itself is. */}
                  <th scope="row" aria-labelledby={`${capNameId}-${c.key}`}>
                    <span className="cap-name" id={`${capNameId}-${c.key}`}>
                      {c.label}
                    </span>
                    <span className="cap-desc">
                      {c.description}
                      {reserved && ' Reserved to the admin role.'}
                    </span>
                  </th>
                  {roles.map((r) => {
                    // Reserved capabilities: shown locked on for admin, not
                    // offered at all on any other role. The cell says which
                    // rather than being blank.
                    if (reserved && !isAdminRole(r)) {
                      return (
                        <td key={r.id}>
                          <span aria-hidden="true" className="cap-none">
                            —
                          </span>
                          <span className="sr-only">Not offered on this role. Reserved to the admin role.</span>
                        </td>
                      )
                    }
                    const locked = reserved && isAdminRole(r)
                    return (
                      <td key={r.id}>
                        {/* The 44px hit area is this label, not the 16px box
                            inside it; the cells are 92px apart, so an
                            enlarged target cannot reach its neighbour. */}
                        <label className={locked ? 'check-cell is-locked' : 'check-cell'}>
                          <Tick
                            checked={locked || ticks.has(tickKey(r.id, c.key))}
                            disabled={locked || save.isPending}
                            ariaLabel={`${c.label} for ${r.label}`}
                            onChange={() => toggle(r.id, c.key)}
                          />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {changeCount > 0 && (
        <div className="admin-acts-end">
          <Button size="sm" onClick={() => setDraft(null)} disabled={save.isPending}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={() => setConfirming(true)} disabled={save.isPending}>
            Review {changeCount} change{changeCount === 1 ? '' : 's'}…
          </Button>
        </div>
      )}
      {/* Applying used to close the dialog and leave the page exactly as it
          was, so a club wide change confirmed nothing at all. */}
      {saved !== null && changeCount === 0 && (
        <div ref={savedRef} tabIndex={-1} className="admin-note">
          <Note tone="success" role="status">
            {saved} change{saved === 1 ? '' : 's'} applied to the whole club.
          </Note>
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
    </Card>
  )
}

export function AdminUsers() {
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: members = [], isLoading, isError, refetch: refetchMembers } = useProfiles()
  const { data: roles = [], isLoading: rolesLoading, isError: rolesError, refetch: refetchRoles } = useRoles()
  const { data: teams = [] } = useTeams()
  const { data: states } = useMemberStates()
  const [managingId, setManagingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removed, setRemoved] = useState<{ id: string; message: string } | null>(null)
  /* Removing a member takes their row and the trash button Modal restores
     focus to, one network round trip after the dialog closes, so the browser
     drops focus onto the document body. Reproduced in a browser before it was
     repaired. What is waited for is the ROW LEAVING THE LIST rather than the
     write settling: on the settling render the trigger is still there and
     still focused, so a hook keyed on the write would find focus where it
     should be, do nothing, and forget it had been asked. */
  const removedRef = useRef<HTMLDivElement>(null)
  const rowGone = removed !== null && !members.some((m) => m.id === removed.id)
  const wantRemovedFocus = useFocusRestore(rowGone, removedRef)
  if (isLoading || rolesLoading) return <Loading />
  // Either read can be the one that failed, and the page needs both, so the
  // retry asks for both rather than for whichever one it was written against.
  if (isError || rolesError)
    return (
      <ErrorNote
        onRetry={() => {
          void refetchMembers()
          void refetchRoles()
        }}
      />
    )
  // The route guard already keeps members without users.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('users.manage')) return null
  const adminCount = members.filter(holdsAdmin).length
  const managing = managingId ? members.find((m) => m.id === managingId) : undefined
  return (
    <div>
      <PageHeader
        title="Users"
        sub="Invite and remove members, manage roles and teams, and decide what each role can do."
      />

      <div className="admin-stack">
        <InviteCard teams={teams} roles={roles} />

        <Card>
          <div className="section-title section-title-spread">
            <h2>Club members</h2>
            <Pill icon={Icon.users}>{members.length}</Pill>
          </div>
          {removed && (
            <div ref={removedRef} tabIndex={-1} className="admin-note">
              <Note tone="success" role="status">
                {removed.message}
              </Note>
            </div>
          )}
          <ul className="admin-list">
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
                  setRemoved(null)
                  setRemoving(m)
                }}
              />
            ))}
          </ul>
        </Card>

        <RolesCard roles={roles} members={members} />

        <CapabilityGrid roles={roles} />
      </div>

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
            wantRemovedFocus()
            setRemoved({ id: removing.id, message })
            setRemoving(null)
          }}
        />
      )}
    </div>
  )
}
