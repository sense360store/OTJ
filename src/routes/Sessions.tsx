// The club calendar of sessions. Visibility is club-wide: every coach sees
// every club session. Whose sessions you are looking at is a view filter that
// defaults to your own, and team narrows further. Edit and delete follow
// ownership (own, or admin); other coaches' sessions render read-only with
// the owner's name. The sessions RLS enforces the same rules on write.
import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useDeleteSession, useMemberMap, useTeamMap, useTeams } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Session } from '../lib/data'
import { Icon } from '../components/icons'
import { Chip, Empty, ErrorNote, fmtDate, Loading, Modal, PHASE_COLOR } from '../components/ui'
import { downloadSessionIcs } from '../lib/ics'

type Nav = ReturnType<typeof useNav>

function DeleteSessionModal({ s, onClose }: { s: Session; onClose: () => void }) {
  const del = useDeleteSession()
  const remove = () => del.mutate({ id: s.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Delete session"
      sub={s.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={remove} disabled={del.isPending}>
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the session and its plan from the club calendar. The drills themselves stay in the library.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}

function SessionCard({
  s,
  nav,
  ownerName,
  teamName,
  canManage,
  onDelete,
}: {
  s: Session
  nav: Nav
  ownerName: string | null
  teamName: string | null
  canManage: boolean
  onDelete: () => void
}) {
  const mins = sessionMinutes(s)
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span
              className="pill"
              style={{ color: 'var(--royal)', background: 'color-mix(in srgb, var(--royal) 10%, transparent)' }}
            >
              <Icon.calendar />
              {fmtDate(s.date)}
            </span>
            <span className="pill">
              <Icon.clock />
              {s.time}
            </span>
          </div>
          <h3 style={{ fontSize: 19 }}>{s.name}</h3>
          <div style={{ color: 'var(--gold-600)', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{s.focus}</div>
        </div>
        <div className="avatar" style={{ background: 'var(--bg-2)', color: 'var(--navy)', fontSize: 13 }}>
          {s.ageGroup}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 7 }}>
        <span className="pill">
          <Icon.pin />
          {s.venue}
        </span>
        {teamName && (
          <span className="pill">
            <Icon.flag />
            {teamName}
          </span>
        )}
        <span className="pill">
          <Icon.list />
          {s.activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock />
          {mins} min
        </span>
        {ownerName && (
          <span className="pill">
            <Icon.user />
            {ownerName}
          </span>
        )}
      </div>

      {/* mini timeline */}
      <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
        {s.activities.map((a, i) => (
          <div key={i} title={a.phase} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }}></div>
        ))}
      </div>

      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => nav('sessionDay', { sessionId: s.id })}>
          <Icon.cone />
          Session day
        </button>
        {/* Driving is owner or admin; everyone else opens the same live view
            as a watcher, so the label says what will happen. */}
        <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => nav('live', { sessionId: s.id })}>
          {canManage ? <Icon.play /> : <Icon.eye />}
          {canManage ? 'Start' : 'Watch'}
        </button>
      </div>
      <div className="row" style={{ gap: 9 }}>
        {canManage ? (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('planner', { sessionId: s.id })}>
            <Icon.edit />
            Edit plan
          </button>
        ) : (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('planner', { sessionId: s.id })}>
            <Icon.eye />
            View plan
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
          aria-label="Add to calendar"
          title="Add to calendar"
          onClick={() => downloadSessionIcs(s)}
        >
          <Icon.calendar />
        </button>
        {canManage && (
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
            aria-label="Delete session"
            onClick={onDelete}
          >
            <Icon.trash />
          </button>
        )}
      </div>
    </div>
  )
}

export function Sessions() {
  const nav = useNav()
  const { user, role } = useAuth()
  const { sessions, loading, error } = useSessions()
  const { data: teams = [] } = useTeams()
  const teamById = useTeamMap()
  const memberById = useMemberMap()
  const [view, setView] = useState<'mine' | 'all'>('mine')
  const [teamId, setTeamId] = useState('')
  const [deleting, setDeleting] = useState<Session | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorNote />

  // The filter's club value selects sessions saved without a team, a valid
  // state for club-wide events. Team ids are UUIDs, so the sentinel is safe.
  const list = sessions.filter(
    (s) =>
      (view === 'mine' ? s.coachId === user?.id : true) &&
      (!teamId || (teamId === 'club' ? !s.teamId : s.teamId === teamId)),
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Sessions</h2>
          <div className="sub">Training nights across the club. You see your own by default.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('planner')}>
          <Icon.plus />
          New session
        </button>
      </div>

      <div className="filter-row" style={{ marginBottom: 18 }}>
        <Chip on={view === 'mine'} onClick={() => setView('mine')}>
          My sessions
        </Chip>
        <Chip on={view === 'all'} onClick={() => setView('all')}>
          All sessions
        </Chip>
        <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ height: 40 }}>
          <option value="">All teams</option>
          <option value="club">Club</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <Empty icon={Icon.calendar} title="No sessions here yet">
          {view === 'mine' && !teamId
            ? 'Plan your first session and it will appear here.'
            : 'Nothing matches this filter. Try All sessions or another team.'}
        </Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 18 }}>
          {list.map((s) => {
            const mine = s.coachId === user?.id
            return (
              <SessionCard
                key={s.id}
                s={s}
                nav={nav}
                ownerName={mine ? null : memberById[s.coachId]?.fullName || 'Another coach'}
                teamName={s.teamId ? (teamById[s.teamId]?.name ?? null) : 'Club'}
                canManage={mine || role === 'admin'}
                onDelete={() => setDeleting(s)}
              />
            )
          })}
        </div>
      )}

      {deleting && <DeleteSessionModal s={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}
