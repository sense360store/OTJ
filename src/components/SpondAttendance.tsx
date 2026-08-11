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
import { pickerEvents, SPOND_COUNT_LABELS, spondEventWhen, spondTeamLabel, syncedAgo } from '../lib/spond'
import {
  ALL_EVENTS_LABEL,
  DEFAULT_EVENT_KIND,
  type EventKind,
  isSpondMatch,
  TRAINING_LABEL,
} from '../lib/eventKind'
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

// Spond classed this event as a match (spond_type 'MATCH'); training and
// other events carry no badge.
export function MatchBadge() {
  return (
    <span
      className="tag"
      style={{ background: 'color-mix(in srgb, var(--m-video) 14%, transparent)', color: 'var(--m-video)' }}
    >
      Match
    </span>
  )
}

// The picker. Defaults to Training and to the session's team, nearest event
// to the session date first. Club events, those with no team because more
// than one mapping matched them, show under every team's filter; the all club
// events toggle remains for finding another team's events.
//
// Training first here for the same reason as everywhere else: the thing being
// linked is a training session, so the list a coach scrolls should be the
// training nights. All events is one tap away for the session that really is
// arranged as a fixture.
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
  const [kind, setKind] = useState<EventKind>(DEFAULT_EVENT_KIND)
  const [showAll, setShowAll] = useState(!teamId)
  const shown = useMemo(() => pickerEvents(events, { kind, showAll, teamId, date, time }), [
    events,
    kind,
    showAll,
    teamId,
    date,
    time,
  ])

  return (
    <Modal
      title="Link Spond event"
      sub="Attendance counts from the linked event show on this session."
      onClose={onClose}
    >
      <div className="row wrap" style={{ gap: 7, marginBottom: 12 }}>
        <Chip on={kind === 'training'} onClick={() => setKind('training')}>
          {TRAINING_LABEL}
        </Chip>
        <Chip on={kind === 'all'} onClick={() => setKind('all')}>
          {ALL_EVENTS_LABEL}
        </Chip>
        {teamId && (
          <>
            <Chip on={!showAll} onClick={() => setShowAll(false)}>
              Team events
            </Chip>
            <Chip on={showAll} onClick={() => setShowAll(true)}>
              All club events
            </Chip>
          </>
        )}
      </div>
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
          {/* Name only the widenings this picker is actually offering: the
              team chips are absent for a session with no team, and pointing
              at a control that is not on screen is worse than saying less. */}
          {events.length > 0
            ? teamId
              ? `No synced events here. Try ${ALL_EVENTS_LABEL}, or all club events.`
              : `No synced events here. Try ${ALL_EVENTS_LABEL}.`
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
                {isSpondMatch(e) && <MatchBadge />}
                {e.cancelled && <CancelledBadge />}
              </span>
              <span className="muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
                {spondEventWhen(e.startsAt)} · {spondTeamLabel(e.teamName)} · {e.accepted} accepted
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
            {/* The picker rows carry this badge and so must the card the
                pick produces. Linking a session to a MATCH takes it out of
                every Training view, so the screen that did it has to say
                what it linked; an unbadged card would leave a coach hunting
                for a session that is one tap away under All events. */}
            {isSpondMatch(event) && <MatchBadge />}
            {event.cancelled && <CancelledBadge />}
          </div>
          <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
            {spondEventWhen(event.startsAt)} · {spondTeamLabel(event.teamName)}
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
