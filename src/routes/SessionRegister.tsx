// The Register (ADR-0008): who is here, against who said they were coming.
// One handed on a phone at the gate: every player of the session's covered
// teams grouped by team, badged by their Spond response through the link
// table, a big tap target to tick arrivals, a quick add for a player who
// turned up without an RSVP, and bib colours from the team default with a
// per session override. Reads load up front and ticks are optimistic local
// state synced behind (pitch side signal is unverified). RSVP is never
// attendance: non responders and the unlinked always list; declined
// collapse last behind a toggle, never hidden.
//
// Roles: reads ride players.view (the route guard and RLS agree), writes
// ride sessions.create. Parents reach neither the route nor the rows.
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import {
  useDeleteRegisterEntry,
  useMyCapabilities,
  usePlayers,
  useRegisterEntries,
  useSession,
  useSetRegisterEntry,
  useSpondEventResponses,
  usePlayerSpondLinks,
  useTeams,
} from '../lib/queries'
import {
  BIB_NONE,
  buildRegister,
  quickAddPool,
  REGISTER_BADGE_META,
  splitDeclined,
  type RegisterGroup,
  type RegisterView,
} from '../lib/register'
import { coveredTeamIds, BIB_COLOURS } from '../lib/sessionTeams'
import type { Player, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { ActionError, Empty, ErrorNote, fmtDate, Loading, Modal } from '../components/ui'
import './SessionDay.css'

// One register row, presentational: the whole row is the tick target, the
// badge never blocks it, the bib select sits apart so a mis-tap cannot
// untick.
export function RegisterRowView({
  name,
  shirtNumber,
  badge,
  present,
  bibValue,
  bibSwatchColour,
  busy,
  manual = false,
  onToggle,
  onBib,
  onRemove,
}: {
  name: string
  shirtNumber: number | null
  badge: keyof typeof REGISTER_BADGE_META
  present: boolean
  // The select's value: '' for the team default, 'none' for an explicit no
  // bib, else the override colour.
  bibValue: string
  bibSwatchColour: string | null
  busy: boolean
  manual?: boolean
  onToggle: () => void
  onBib: (value: string) => void
  onRemove?: () => void
}) {
  const meta = REGISTER_BADGE_META[badge]
  return (
    <div className="row" style={{ gap: 8, borderTop: '1px solid var(--line)', padding: '4px 0', alignItems: 'center' }}>
      <button
        type="button"
        className="sd-kit-item"
        style={{ flex: 1, minWidth: 0, border: 'none', padding: '10px 8px', margin: 0 }}
        aria-pressed={present}
        disabled={busy}
        onClick={onToggle}
      >
        <span className={'sd-check' + (present ? ' on' : '')} style={present ? { background: 'var(--c-physical)', borderColor: 'var(--c-physical)', color: '#fff' } : undefined}>
          {present && <Icon.check />}
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span className="sd-kit-name">
            {name}
            {shirtNumber != null ? ` · ${shirtNumber}` : ''}
          </span>
          <span
            className="sd-kit-drills"
            style={{ display: 'block', color: meta.tone === 'good' ? 'var(--c-physical)' : meta.tone === 'warn' ? 'var(--m-pdf)' : undefined }}
          >
            {meta.label}
          </span>
        </span>
      </button>
      <span className="row" style={{ gap: 5, flex: '0 0 auto' }}>
        {bibSwatchColour && (
          <span className="tag-dot" style={{ background: bibSwatchColour, border: '1px solid var(--line)' }} aria-hidden="true"></span>
        )}
        <select
          className="select"
          style={{ height: 36, maxWidth: 116, fontSize: 12.5 }}
          aria-label={'Bib colour for ' + name}
          value={bibValue}
          disabled={busy}
          onChange={(e) => onBib(e.target.value)}
        >
          <option value="">Team default</option>
          <option value={BIB_NONE}>No bib</option>
          {BIB_COLOURS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        {manual && onRemove && (
          <button
            type="button"
            className="btn btn-quiet btn-sm icon-only"
            style={{ width: 34, padding: 0 }}
            aria-label={'Remove ' + name + ' from the register'}
            disabled={busy}
            onClick={onRemove}
          >
            <Icon.x />
          </button>
        )}
      </span>
    </div>
  )
}

// A team's section: heading with the present count, the active rows, and
// the declined collapsed behind a toggle, never hidden entirely.
export function RegisterGroupView({
  group,
  busy,
  canTick,
  onToggle,
  onBib,
  onRemove,
}: {
  group: RegisterGroup
  busy: boolean
  canTick: boolean
  onToggle: (playerId: string) => void
  onBib: (playerId: string, value: string) => void
  // The quick add's undo, offered on manual rows only.
  onRemove?: (playerId: string) => void
}) {
  const [showDeclined, setShowDeclined] = useState(false)
  const { active, declined } = splitDeclined(group.rows)
  return (
    <div className="sd-card">
      <div className="sd-card-head">
        <h4>{group.teamName}</h4>
        <span className="pill">
          <Icon.users />
          {group.presentCount} of {group.rows.length} here
        </span>
      </div>
      {group.rows.length === 0 && (
        <p className="muted" style={{ fontSize: 13.5, margin: '8px 0 0' }}>
          No players on this team's register.
        </p>
      )}
      {active.map((r) => (
        <RegisterRowView
          key={r.player.id}
          name={r.player.displayName}
          shirtNumber={r.player.shirtNumber}
          badge={r.badge}
          present={r.present}
          bibValue={r.bibValue}
          bibSwatchColour={r.bibSwatch}
          busy={busy || !canTick}
          manual={r.manual}
          onToggle={() => onToggle(r.player.id)}
          onBib={(v) => onBib(r.player.id, v)}
          onRemove={onRemove ? () => onRemove(r.player.id) : undefined}
        />
      ))}
      {declined.length > 0 && (
        <>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            style={{ marginTop: 8 }}
            aria-expanded={showDeclined}
            onClick={() => setShowDeclined((v) => !v)}
          >
            {showDeclined ? 'Hide declined' : `Show declined (${declined.length})`}
          </button>
          {showDeclined &&
            declined.map((r) => (
              <RegisterRowView
                key={r.player.id}
                name={r.player.displayName}
                shirtNumber={r.player.shirtNumber}
                badge={r.badge}
                present={r.present}
                bibValue={r.bibValue}
                bibSwatchColour={r.bibSwatch}
                busy={busy || !canTick}
                manual={r.manual}
                onToggle={() => onToggle(r.player.id)}
                onBib={(v) => onBib(r.player.id, v)}
                onRemove={onRemove ? () => onRemove(r.player.id) : undefined}
              />
            ))}
        </>
      )}
    </div>
  )
}

function QuickAddModal({
  pool,
  busy,
  onAdd,
  onClose,
}: {
  pool: Player[]
  busy: boolean
  onAdd: (playerId: string) => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Add to the register"
      sub="A player who turned up without an RSVP"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {pool.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Everyone is already on the register.
        </p>
      ) : (
        pool.map((p) => (
          <div key={p.id} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>{p.displayName}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAdd(p.id)}>
              <Icon.plus />
              Add here
            </button>
          </div>
        ))
      )}
    </Modal>
  )
}

function RegisterScreen({ session }: { session: Session }) {
  const nav = useNav()
  const { caps } = useMyCapabilities()
  const canTick = caps.has('sessions.create')
  const { data: teams = [] } = useTeams()
  const { data: players = [], isLoading: playersLoading } = usePlayers()
  const { data: links = [] } = usePlayerSpondLinks()
  const { data: responses = [] } = useSpondEventResponses(session.spondEventId)
  const { data: entries = [], isLoading: entriesLoading } = useRegisterEntries(session.id)
  const set = useSetRegisterEntry()
  const remove = useDeleteRegisterEntry()
  const [adding, setAdding] = useState(false)

  const covered = useMemo(() => coveredTeamIds(session, teams.map((t) => t.id)), [session, teams])
  const view: RegisterView = useMemo(
    () => buildRegister(players, covered, teams, links, responses, entries),
    [players, covered, teams, links, responses, entries],
  )
  const pool = useMemo(() => quickAddPool(players, covered, entries), [players, covered, entries])

  const entryFor = (playerId: string) => entries.find((e) => e.playerId === playerId)
  const toggle = (playerId: string) =>
    set.mutate({ sessionId: session.id, playerId, present: !(entryFor(playerId)?.present ?? false) })
  // '' clears the override back to the team default; BIB_NONE is a real
  // override meaning no bib today; a colour overrides the default.
  const setBib = (playerId: string, value: string) =>
    set.mutate({ sessionId: session.id, playerId, bibColourOverride: value || null })
  const removeEntry = (playerId: string) => remove.mutate({ sessionId: session.id, playerId })
  const quickAdd = (playerId: string) =>
    set.mutate({ sessionId: session.id, playerId, present: true, source: 'manual' })

  if (playersLoading || entriesLoading) return <Loading />

  return (
    <div>
      <div className="sd-head">
        <button className="icon-btn" style={{ width: 44, height: 44 }} aria-label="Back" onClick={() => nav('sessionDay', { sessionId: session.id })}>
          <Icon.chevL />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Register</h2>
          <div className="sd-sub">
            {[session.name, fmtDate(session.date), session.time].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className="pill" style={{ fontWeight: 800 }}>
          <Icon.users />
          {view.presentTotal} of {view.playerTotal}
        </span>
      </div>

      {canTick && (
        <div className="row" style={{ gap: 9, marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Icon.plus />
            Quick add
          </button>
        </div>
      )}

      {set.isError && <ActionError style={{ marginBottom: 10 }}>Could not save that change. It will not stick until it saves; try again.</ActionError>}

      {view.groups.length === 0 ? (
        <Empty icon={Icon.users} title="No players to list">
          The covered teams have no registered players this season.
        </Empty>
      ) : (
        <div className="sd-list">
          {view.groups.map((g) => (
            <RegisterGroupView
              key={g.teamId ?? 'unassigned'}
              group={g}
              busy={false}
              canTick={canTick}
              onToggle={toggle}
              onBib={setBib}
              onRemove={canTick ? removeEntry : undefined}
            />
          ))}
        </div>
      )}

      {adding && <QuickAddModal pool={pool} busy={set.isPending} onAdd={quickAdd} onClose={() => setAdding(false)} />}
    </div>
  )
}

export function SessionRegister() {
  const { sessionId } = useParams()
  const nav = useNav()
  const { data: session, isLoading, isError } = useSession(sessionId)
  if (session) return <RegisterScreen key={session.id} session={session} />
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  return (
    <Empty icon={Icon.calendar} title="Session not found">
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('sessions')}>
        <Icon.chevL />
        Back to sessions
      </button>
    </Empty>
  )
}
