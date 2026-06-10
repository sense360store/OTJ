// Admin only: rename, add or remove the club's teams, backed by the teams
// RLS. Teams are a filter and a default, never access control, so removing
// one never hides or orphans content: the foreign keys null the references
// and the confirm spells that out. REVIEW: role gated admin surface.
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useDeleteTeam, useInsertTeam, useProfiles, useRenameTeam, useTeams } from '../lib/queries'
import type { Team } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'

function DeleteTeamModal({
  team,
  memberCount,
  sessionCount,
  onClose,
}: {
  team: Team
  memberCount: number
  sessionCount: number
  onClose: () => void
}) {
  const del = useDeleteTeam()
  const remove = () => del.mutate({ id: team.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Remove team"
      sub={team.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={remove} disabled={del.isPending}>
            <Icon.trash />
            {del.isPending ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        {memberCount} member{memberCount !== 1 ? 's' : ''} and {sessionCount} session
        {sessionCount !== 1 ? 's' : ''} reference this team. They keep working; their team is cleared. No sessions or
        people are removed.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not remove the team. Try again.
        </p>
      )}
    </Modal>
  )
}

function TeamRow({ team, onDelete }: { team: Team; onDelete: () => void }) {
  const rename = useRenameTeam()
  const [draft, setDraft] = useState(team.name)
  const changed = draft.trim() !== team.name && draft.trim() !== ''
  return (
    <div className="row" style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!changed || rename.isPending}
        onClick={() => rename.mutate({ id: team.id, name: draft.trim() })}
      >
        <Icon.check />
        Rename
      </button>
      <button
        className="btn btn-ghost btn-sm icon-only"
        style={{ width: 38, padding: 0 }}
        aria-label={'Remove ' + team.name}
        onClick={onDelete}
      >
        <Icon.trash />
      </button>
    </div>
  )
}

export function AdminTeams() {
  const { data: teams = [], isLoading, isError } = useTeams()
  const { data: members = [] } = useProfiles()
  const { sessions } = useSessions()
  const insert = useInsertTeam()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Team | null>(null)
  const { role } = useAuth()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // The route guard already keeps coaches out; this is belt and braces for
  // the brief render before a redirect.
  if (role !== 'admin') return null

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    insert.mutate({ name: trimmed }, { onSuccess: () => setName('') })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Teams</h2>
          <div className="sub">The club's teams. A filter and a default for sessions and coaches, never a wall.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div className="row" style={{ gap: 10, marginBottom: 4 }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>New team</label>
            <input
              placeholder="Team name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-end' }}
            disabled={!name.trim() || insert.isPending}
            onClick={add}
          >
            <Icon.plus />
            Add team
          </button>
        </div>
        {insert.isError && (
          <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginBottom: 8 }}>
            Could not add the team. The name may already exist.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          {teams.map((t) => (
            <TeamRow key={t.id} team={t} onDelete={() => setRemoving(t)} />
          ))}
          {teams.length === 0 && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              No teams yet. Add the first one above.
            </p>
          )}
        </div>
      </div>

      {removing && (
        <DeleteTeamModal
          team={removing}
          memberCount={members.filter((m) => m.teamId === removing.id).length}
          sessionCount={sessions.filter((s) => s.teamId === removing.id).length}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
