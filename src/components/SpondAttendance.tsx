// The Spond attendance block a session shows when linked to a synced event,
// and the picker that links one. Shared by the planner's side panel (where
// linking edits the draft and Save writes it) and the session day view
// (where linking writes at once through useLinkSessionSpondEvent).
//
// Counts only, the children's data boundary (CLAUDE.md, Spond integration):
// the block renders the four counts and event facts from the spond_events
// read and nothing else. The counts are a synced snapshot, so the freshness
// label shows synced_at; no client code ever calls Spond, and the numbers
// change only when someone presses Sync now on the admin Spond screen.
//
// canEdit only surfaces the link and unlink affordances. The sessions update
// RLS (owner, or sessions.manage) is the real enforcement of who may change
// the link, unchanged by this feature.
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSpondEvents } from '../lib/queries'
import { bySpondEventCloseness, SPOND_COUNT_LABELS, spondEventWhen, syncedAgo } from '../lib/spond'
import { Icon } from './icons'
import { Chip, Modal } from './ui'

export function CancelledBadge() {
  return (
    <span
      className="tag"
      style={{ background: 'color-mix(in srgb, var(--m-pdf) 14%, transparent)', color: 'var(--m-pdf)' }}
    >
      Cancelled
    </span>
  )
}

// The picker. Defaults to the session's team, nearest event to the session
// date first; the all club events toggle exists because whole group events
// (a gala, say) are attributed to a single mapping's team and would
// otherwise never show for the others.
function LinkSpondEventModal({
  teamId,
  date,
  time,
  onPick,
  onClose,
}: {
  teamId: string | null
  date: string
  time: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const { data: events = [], isPending, isError } = useSpondEvents()
  const [showAll, setShowAll] = useState(!teamId)
  const shown = useMemo(() => {
    const pool = showAll || !teamId ? events : events.filter((e) => e.teamId === teamId)
    return [...pool].sort(bySpondEventCloseness(date, time))
  }, [events, showAll, teamId, date, time])

  return (
    <Modal
      title="Link Spond event"
      sub="Attendance counts from the linked event show on this session."
      onClose={onClose}
    >
      {teamId && (
        <div className="row" style={{ gap: 7, marginBottom: 12 }}>
          <Chip on={!showAll} onClick={() => setShowAll(false)}>
            Team events
          </Chip>
          <Chip on={showAll} onClick={() => setShowAll(true)}>
            All club events
          </Chip>
        </div>
      )}
      {isPending ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Loading…
        </p>
      ) : isError ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Could not load the synced events. Close and try again.
        </p>
      ) : shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {events.length > 0
            ? 'No synced events for this team. Try all club events.'
            : 'Nothing synced yet. An admin presses Sync now on the Spond screen first.'}
        </p>
      ) : (
        <div>
          {shown.map((e) => (
            <button
              key={e.id}
              onClick={() => onPick(e.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 0,
                cursor: 'pointer',
                color: 'inherit',
                font: 'inherit',
                padding: '10px 0',
                borderTop: '1px solid var(--line)',
              }}
            >
              <span className="row" style={{ gap: 8 }}>
                <b style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{e.title}</b>
                {e.cancelled && <CancelledBadge />}
              </span>
              <span className="muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
                {spondEventWhen(e.startsAt)} · {e.teamName ?? 'No team'} · {e.accepted} accepted
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function SpondAttendanceCard({
  spondEventId,
  teamId,
  date,
  time,
  canEdit,
  onLink,
  busy,
  errorText,
  style,
}: {
  spondEventId: string | null
  teamId: string | null
  date: string
  time: string
  canEdit: boolean
  onLink: (spondEventId: string | null) => void
  busy?: boolean
  errorText?: string
  style?: CSSProperties
}) {
  const { data: events, isPending } = useSpondEvents()
  const [picking, setPicking] = useState(false)
  const event = spondEventId ? (events ?? []).find((e) => e.id === spondEventId) : undefined

  // Unlinked and not editable: nothing to show and nothing to offer.
  if (!spondEventId && !canEdit) return null

  const pick = (id: string) => {
    setPicking(false)
    onLink(id)
  }

  return (
    <div className="card" style={{ padding: 16, ...style }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Spond attendance
      </div>
      {!spondEventId ? (
        <>
          <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 10 }}>
            Link the Spond event this session is arranged as to see who is coming.
          </p>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPicking(true)}>
            <Icon.link />
            Link Spond event
          </button>
        </>
      ) : !event ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {isPending ? 'Loading…' : 'The linked Spond event is no longer in the mirror.'}
          {!isPending && canEdit && (
            <button className="btn btn-quiet btn-sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => onLink(null)}>
              Unlink
            </button>
          )}
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <b style={{ fontSize: 14.5, flex: 1, minWidth: 0 }}>{event.title}</b>
            {event.cancelled && <CancelledBadge />}
          </div>
          <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
            {spondEventWhen(event.startsAt)}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {SPOND_COUNT_LABELS.map((label) => (
              <span key={label} className="pill">
                <b>{event[label]}</b> {label}
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
              {syncedAgo(event.syncedAt)}
            </span>
            {canEdit && (
              <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => onLink(null)}>
                <Icon.x />
                Unlink
              </button>
            )}
          </div>
        </>
      )}
      {errorText && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', margin: '8px 0 0' }}>
          {errorText}
        </p>
      )}
      {picking && (
        <LinkSpondEventModal teamId={teamId} date={date} time={time} onPick={pick} onClose={() => setPicking(false)} />
      )}
    </div>
  )
}
