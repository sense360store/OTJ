// Admin: roles as data. The tick grid edits role_permissions per role, the
// tags section edits role_filters, and creating, renaming and deleting
// custom roles edits roles. The 0010 RLS (roles.manage) is the real
// enforcement everywhere; the protect_admin_grants trigger keeps the Admin
// role's roles.manage and users.manage locked on, and system roles refuse
// rename and delete at the policy level. REVIEW: role gated admin surface.
import { useState } from 'react'
import {
  useAddRoleFilterTag,
  useCreateRole,
  useDeleteRole,
  useFilterOptions,
  usePerm,
  useProfiles,
  useRemoveRoleFilterTag,
  useRenameRole,
  useRolePermissions,
  useRoleFilterTags,
  useRoles,
  useSetRolePermission,
} from '../lib/queries'
import { CAPABILITIES, LOCKED_ADMIN_CAPABILITIES } from '../lib/permissions'
import type { Capability } from '../lib/permissions'
import { FILTER_KINDS } from '../lib/data'
import type { ClubRole, FilterKind, RoleFilterTag } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'

function CreateRoleCard() {
  const create = useCreateRole()
  const [name, setName] = useState('')
  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate({ name: trimmed }, { onSuccess: () => setName('') })
  }
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0, maxWidth: 360 }}>
          <label>New role</label>
          <input
            placeholder="Role name, e.g. Lead Coach"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ alignSelf: 'flex-end' }}
          disabled={!name.trim() || create.isPending}
          onClick={add}
        >
          <Icon.plus />
          Add role
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>
        A new role starts with no capabilities: its members can read club content and nothing else. Tick what it may
        do below.
      </p>
      {create.isError && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 6, marginBottom: 0 }}>
          Could not add the role. The name may already exist.
        </p>
      )}
    </div>
  )
}

// Deleting a role someone still holds moves those members to a replacement
// role first. Moving members needs user management on top of role
// management; without it the delete stays blocked.
function DeleteRoleModal({
  role,
  memberCount,
  others,
  onClose,
}: {
  role: ClubRole
  memberCount: number
  others: ClubRole[]
  onClose: () => void
}) {
  const del = useDeleteRole()
  const canMoveMembers = usePerm('users.manage')
  const coach = others.find((r) => r.isSystem && r.name === 'Coach')
  const [target, setTarget] = useState(coach?.id ?? others[0]?.id ?? '')
  const needsMove = memberCount > 0
  const blocked = needsMove && !canMoveMembers
  const remove = () =>
    del.mutate({ id: role.id, reassignTo: needsMove ? target : undefined }, { onSuccess: onClose })
  return (
    <Modal
      title="Delete role"
      sub={role.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={del.isPending || blocked || (needsMove && !target)}
          >
            <Icon.trash />
            {del.isPending
              ? 'Deleting…'
              : needsMove
                ? `Move ${memberCount} member${memberCount !== 1 ? 's' : ''} and delete`
                : 'Delete role'}
          </button>
        </>
      }
    >
      {needsMove ? (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
            {memberCount} member{memberCount !== 1 ? 's' : ''} hold{memberCount === 1 ? 's' : ''} this role. Choose
            the role they move to; their content and sessions are untouched.
          </p>
          <div className="field">
            <label>Move members to</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={blocked}>
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {blocked && (
            <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)' }}>
              Moving members needs the manage users capability, which your role does not hold.
            </p>
          )}
        </>
      ) : (
        <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
          No member holds this role. Deleting it removes its ticks and filter tags; nothing else changes.
        </p>
      )}
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete the role. Try again.
        </p>
      )}
    </Modal>
  )
}

// One row of the tick grid: a capability with its plain one line description.
function TickRow({
  cap,
  on,
  locked,
  pending,
  onToggle,
}: {
  cap: (typeof CAPABILITIES)[number]
  on: boolean
  locked: boolean
  pending: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <label
      className="row"
      style={{ gap: 10, alignItems: 'flex-start', padding: '7px 0', cursor: locked ? 'default' : 'pointer' }}
      title={locked ? 'Locked on for the Admin role so a club can never lock itself out.' : undefined}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={locked || pending}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {cap.label}
          {locked && <Icon.lock style={{ width: 12, height: 12, color: 'var(--slate-2)' }} />}
        </b>
        <span className="muted" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.4 }}>
          {cap.description}
        </span>
      </span>
    </label>
  )
}

// Filter tags on a role: kind plus value chips picked from the managed
// filter options. A tagged role's library, templates, media and sessions
// views lock to matching content. Curation at the application layer; the
// club boundary in RLS stays the only hard security boundary.
function RoleTags({ role, tags }: { role: ClubRole; tags: RoleFilterTag[] }) {
  const { data: options = [] } = useFilterOptions()
  const addTag = useAddRoleFilterTag()
  const removeTag = useRemoveRoleFilterTag()
  const [kind, setKind] = useState<FilterKind>('age_band')
  const [value, setValue] = useState('')
  const kindLabel = (k: FilterKind) => FILTER_KINDS.find((f) => f.kind === k)?.one ?? k
  const candidates = options.filter(
    (o) => o.kind === kind && o.active && !tags.some((t) => t.kind === kind && t.value === o.value),
  )
  const add = () => {
    if (!value) return
    addTag.mutate({ roleId: role.id, kind, value }, { onSuccess: () => setValue('') })
  }
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Filter tags
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 10 }}>
        A tagged role sees only matching drills, templates, media and sessions, shown as fixed chips its members
        cannot remove. Curation in the app, not a security boundary; club membership in the database remains that.
      </p>
      {tags.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {tags.map((t) => (
            <span key={t.kind + ':' + t.value} className="pill">
              {kindLabel(t.kind)}: {t.value}
              <button
                aria-label={`Remove ${t.value}`}
                onClick={() => removeTag.mutate({ roleId: role.id, kind: t.kind, value: t.value })}
                style={{ display: 'inline-flex', border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
              >
                <Icon.x style={{ width: 12, height: 12 }} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <select
          className="select"
          style={{ height: 36 }}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as FilterKind)
            setValue('')
          }}
        >
          {FILTER_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.one}
            </option>
          ))}
        </select>
        <select className="select" style={{ height: 36, minWidth: 150 }} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose a value…</option>
          {candidates.map((o) => (
            <option key={o.id} value={o.value}>
              {o.value}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm" disabled={!value || addTag.isPending} onClick={add}>
          <Icon.plus />
          Add tag
        </button>
      </div>
    </div>
  )
}

function RoleCard({
  role,
  memberCount,
  perms,
  tags,
  others,
}: {
  role: ClubRole
  memberCount: number
  perms: Capability[]
  tags: RoleFilterTag[]
  others: ClubRole[]
}) {
  const rename = useRenameRole()
  const setPerm = useSetRolePermission()
  const [draft, setDraft] = useState(role.name)
  const [deleting, setDeleting] = useState(false)
  const changed = draft.trim() !== role.name && draft.trim() !== ''
  const lockedAdmin = role.isSystem && role.name === 'Admin'
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
        {role.isSystem ? (
          <b style={{ fontSize: 17, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {role.name}
            <span className="pill" title="Seeded for every club; cannot be renamed or deleted.">
              <Icon.lock style={{ width: 11, height: 11 }} />
              System
            </span>
          </b>
        ) : (
          <>
            <div className="field" style={{ marginBottom: 0, width: 220 }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} />
            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!changed || rename.isPending}
              onClick={() => rename.mutate({ id: role.id, name: draft.trim() })}
            >
              <Icon.check />
              Rename
            </button>
          </>
        )}
        <span className="pill">
          <Icon.users />
          {memberCount} member{memberCount !== 1 ? 's' : ''}
        </span>
        <span style={{ flex: 1 }}></span>
        {!role.isSystem && (
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 38, padding: 0 }}
            aria-label={'Delete ' + role.name}
            onClick={() => setDeleting(true)}
          >
            <Icon.trash />
          </button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
          columnGap: 18,
          marginTop: 8,
        }}
      >
        {CAPABILITIES.map((cap) => (
          <TickRow
            key={cap.key}
            cap={cap}
            on={perms.includes(cap.key)}
            locked={lockedAdmin && LOCKED_ADMIN_CAPABILITIES.includes(cap.key)}
            pending={setPerm.isPending}
            onToggle={(next) => setPerm.mutate({ roleId: role.id, permission: cap.key, on: next })}
          />
        ))}
      </div>
      {setPerm.isError && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 6, marginBottom: 0 }}>
          The change did not save. Try again.
        </p>
      )}
      <RoleTags role={role} tags={tags} />
      {deleting && (
        <DeleteRoleModal role={role} memberCount={memberCount} others={others} onClose={() => setDeleting(false)} />
      )}
    </div>
  )
}

export function AdminRoles() {
  const { data: roles = [], isLoading, isError } = useRoles()
  const { data: permsByRole = {} } = useRolePermissions()
  const { data: tagsByRole = {} } = useRoleFilterTags()
  const { data: members = [] } = useProfiles()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  const memberCount = (roleId: string) => members.filter((m) => m.roleId === roleId).length
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Roles</h2>
          <div className="sub">
            What each role can do, as ticks. Postgres enforces every tick; the app only decides what to show.
          </div>
        </div>
      </div>
      <CreateRoleCard />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {roles.map((r) => (
          <RoleCard
            key={r.id}
            role={r}
            memberCount={memberCount(r.id)}
            perms={permsByRole[r.id] ?? []}
            tags={tagsByRole[r.id] ?? []}
            others={roles.filter((o) => o.id !== r.id)}
          />
        ))}
      </div>
    </div>
  )
}
