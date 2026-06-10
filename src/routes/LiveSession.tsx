// Run a session on the touchline. Full-screen overlay that forces dark mode
// for contrast. Timer and position persist to localStorage so a refresh keeps
// the place. Realtime sync across devices is Phase 5.
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useActivityTitle, useSession, useDrillMap, useMediaMap, useTeamMap } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Session } from '../lib/data'
import { Icon } from '../components/icons'
import { fmtClock, MediaAttribution, MediaThumb, MEDIA_META, Modal, PHASE_COLOR } from '../components/ui'

function lsKey(id: string) {
  return 'otj_live_' + id
}

interface LiveSaved {
  idx?: number
  remaining?: number
  elapsed?: number
  done?: number[]
  notes?: Record<number, string>
  complete?: boolean
}

function LiveComplete({
  session,
  elapsed,
  notes,
  onExit,
  onRestart,
}: {
  session: Session
  elapsed: number
  notes: Record<number, string>
  onExit: () => void
  onRestart: () => void
}) {
  const actTitle = useActivityTitle()
  const noteList = Object.entries(notes).filter(([, v]) => v && v.trim())
  return (
    <div className="live theme-dark">
      <div className="live-body" style={{ justifyContent: 'center' }}>
        <div className="live-stage" style={{ textAlign: 'center', alignItems: 'center' }}>
          <span
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--c-physical) 22%, transparent)',
              color: 'var(--c-physical)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon.checkCircle style={{ width: 46, height: 46 }} />
          </span>
          <h2 style={{ fontSize: 34 }}>Session complete</h2>
          <div className="muted" style={{ fontSize: 16 }}>
            {session.name} · {session.activities.length} activities · {fmtClock(elapsed)} on the pitch
          </div>

          {noteList.length > 0 && (
            <div className="live-card" style={{ padding: '16px 18px', textAlign: 'left', width: '100%' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                Your session notes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {noteList.map(([i, v]) => {
                  const a = session.activities[Number(i)]
                  return (
                    <div key={i}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a ? actTitle(a) : ''}</div>
                      <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
                        {v}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <button className="btn btn-ghost btn-lg" onClick={onRestart}>
              <Icon.rotate />
              Run again
            </button>
            <button className="btn btn-gold btn-lg" onClick={onExit}>
              <Icon.check />
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LiveRunner({ session, onExit }: { session: Session; onExit: () => void }) {
  const nav = useNav()
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const actTitle = useActivityTitle()
  const teamById = useTeamMap()
  // A session without a team is a club-wide event, shown as Club.
  const teamName = session.teamId ? teamById[session.teamId]?.name : 'Club'
  const acts = session.activities
  const load = (): LiveSaved | null => {
    try {
      return JSON.parse(localStorage.getItem(lsKey(session.id)) ?? 'null') as LiveSaved | null
    } catch {
      return null
    }
  }
  const saved = load()

  const [idx, setIdx] = useState(saved?.idx ?? 0)
  const [remaining, setRemaining] = useState(saved?.remaining ?? (acts[saved?.idx ?? 0]?.duration ?? 0) * 60)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0)
  const [done, setDone] = useState<number[]>(saved?.done ?? [])
  const [notes, setNotes] = useState<Record<number, string>>(saved?.notes ?? {})
  const [complete, setComplete] = useState(saved?.complete ?? false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        setElapsed((e) => e + 1)
        setRemaining((r) => Math.max(0, r - 1))
      }, 1000)
      return () => {
        if (tick.current) clearInterval(tick.current)
      }
    }
  }, [running])

  useEffect(() => {
    localStorage.setItem(lsKey(session.id), JSON.stringify({ idx, remaining, elapsed, done, notes, complete }))
  }, [session, idx, remaining, elapsed, done, notes, complete])

  const act = acts[idx]
  const drill = act?.drillId ? drillById[act.drillId] : null
  const media = drill && drill.mediaId ? mediaById[drill.mediaId] : null
  const total = sessionMinutes(session)
  const actSecs = (act?.duration ?? 0) * 60
  const frac = actSecs ? 1 - remaining / actSecs : 0

  const goTo = (i: number) => {
    if (i < 0 || i >= acts.length) return
    setIdx(i)
    setRemaining((acts[i].duration || 0) * 60)
    setRunning(false)
  }
  const markDoneNext = () => {
    setDone((d) => (d.includes(idx) ? d : [...d, idx]))
    if (idx >= acts.length - 1) {
      setComplete(true)
      setRunning(false)
    } else {
      goTo(idx + 1)
    }
  }
  const restart = () => {
    localStorage.removeItem(lsKey(session.id))
    setIdx(0)
    setRemaining((acts[0]?.duration ?? 0) * 60)
    setElapsed(0)
    setDone([])
    setNotes({})
    setComplete(false)
    setRunning(false)
  }

  if (complete)
    return <LiveComplete session={session} elapsed={elapsed} notes={notes} onExit={onExit} onRestart={restart} />

  if (!act)
    return (
      <div className="live theme-dark">
        <div className="live-top">
          <button className="icon-btn" onClick={onExit} title="Exit">
            <Icon.x />
          </button>
          <div style={{ flex: 1 }}>
            <div className="ltitle">{session.name}</div>
            <div className="lsub">No activities in this session yet</div>
          </div>
        </div>
      </div>
    )

  return (
    <div className="live theme-dark">
      <div className="live-top">
        <button className="icon-btn" onClick={onExit} title="Exit">
          <Icon.x />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ltitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {session.name}
          </div>
          <div className="lsub">
            Activity {idx + 1} of {acts.length} · {session.focus}
            {teamName ? ' · ' + teamName : ''}
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => nav('sessionDay', { sessionId: session.id })}
          title="Session day"
          aria-label="Session day"
        >
          <Icon.cone />
        </button>
        <div style={{ textAlign: 'right' }}>
          <div className="ltitle mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtClock(elapsed)}
          </div>
          <div className="lsub">of ~{total} min</div>
        </div>
      </div>

      <div className="live-progress">
        {acts.map((_, i) => (
          <div key={i} className={'live-seg' + (done.includes(i) ? ' done' : i === idx ? ' cur' : '')}></div>
        ))}
      </div>

      <div className="live-body">
        <div className="live-stage">
          {/* phase + title */}
          <div style={{ textAlign: 'center' }}>
            <span
              className="tag"
              style={{
                background: 'color-mix(in srgb,' + PHASE_COLOR[act.phase] + ' 20%, transparent)',
                color: PHASE_COLOR[act.phase],
                fontSize: 13,
              }}
            >
              <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
              {act.phase}
            </span>
            <h2 style={{ fontSize: 'clamp(26px,6vw,38px)', marginTop: 12 }}>{actTitle(act, 'Activity')}</h2>
            {drill && (
              <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>
                {drill.skill} · {drill.players} · {drill.area}
              </div>
            )}
          </div>

          {/* timer */}
          <div className="timer-ring">
            <div className={'timer-num' + (remaining <= 30 && remaining > 0 ? ' warn' : '')}>{fmtClock(remaining)}</div>
            <div style={{ width: '70%', maxWidth: 300, height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: frac * 100 + '%',
                  background: remaining <= 30 ? 'var(--m-pdf)' : 'var(--gold)',
                  transition: 'width 1s linear',
                }}
              ></div>
            </div>
          </div>

          {/* controls */}
          <div className="live-controls">
            <button className="round-btn" onClick={() => goTo(idx - 1)} disabled={idx === 0} title="Previous">
              <Icon.skipBack />
            </button>
            <button className="round-btn play" onClick={() => setRunning((r) => !r)}>
              {running ? <Icon.pause /> : <Icon.play />}
            </button>
            <button className="round-btn" onClick={() => setRemaining(actSecs)} title="Reset timer">
              <Icon.rotate />
            </button>
          </div>

          {/* media */}
          {media && (
            <button
              onClick={() => setMediaOpen(true)}
              style={{
                border: '1px solid var(--line)',
                background: 'var(--card)',
                borderRadius: 14,
                padding: 10,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ width: 92, height: 58, borderRadius: 9, overflow: 'hidden', flex: '0 0 92px' }}>
                <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{MEDIA_META[media.type].label} · tap to view</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {media.name}
                </div>
              </div>
              <span style={{ color: 'var(--gold)' }}>
                <Icon.play />
              </span>
            </button>
          )}

          {/* coaching points */}
          {drill && (
            <div className="live-card" style={{ padding: '16px 18px' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                Coaching points
              </div>
              <div className="coach-points">
                {drill.points.map((p, i) => (
                  <div className="cp" key={i}>
                    <span className="cp-num">{i + 1}</span>
                    <span style={{ fontSize: 14.5, lineHeight: 1.4 }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* quick note */}
          <div className="live-card" style={{ padding: '14px 16px' }}>
            <div className="eyebrow" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon.note style={{ width: 14, height: 14 }} />
              Quick note
            </div>
            <textarea
              value={notes[idx] || ''}
              onChange={(e) => setNotes((n) => ({ ...n, [idx]: e.target.value }))}
              placeholder="Jot what worked, who shone, what to revisit…"
              rows={2}
              style={{
                width: '100%',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--bg)',
                color: 'var(--ink)',
                padding: 10,
                fontFamily: 'inherit',
                fontSize: 14,
                resize: 'vertical',
              }}
            />
          </div>

          {/* up next */}
          {idx < acts.length - 1 &&
            (() => {
              const n = acts[idx + 1]
              return (
                <div className="row" style={{ justifyContent: 'center', gap: 8, color: 'var(--slate)', fontSize: 13.5, fontWeight: 600 }}>
                  <span className="muted">Up next:</span>
                  <span style={{ color: 'var(--ink)' }}>{actTitle(n)}</span>
                  <span className="muted">· {n.duration} min</span>
                </div>
              )
            })()}
        </div>
      </div>

      <div className="live-foot">
        <button className="btn btn-ghost" style={{ flex: '0 0 auto' }} onClick={() => goTo(idx - 1)} disabled={idx === 0}>
          <Icon.chevL />
        </button>
        <button className="btn btn-gold btn-block" style={{ flex: 1, height: 52, fontSize: 16 }} onClick={markDoneNext}>
          <Icon.check />
          {idx >= acts.length - 1 ? 'Finish session' : 'Mark done & next'}
        </button>
      </div>

      {mediaOpen && media && drill && (
        <Modal
          title={drill.title}
          sub={MEDIA_META[media.type].label}
          onClose={() => setMediaOpen(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setMediaOpen(false)}>
              Close
            </button>
          }
        >
          <div className="detail-media">
            <div className="player">
              <MediaThumb media={media} />
            </div>
          </div>
          <MediaAttribution media={media} style={{ display: 'block', marginTop: 8 }} />
        </Modal>
      )}
    </div>
  )
}

// Quiet dark states for the full-screen live view, matching its theme.
function LiveLoading() {
  return (
    <div className="live theme-dark">
      <div className="live-body" style={{ justifyContent: 'center' }}>
        <div className="muted" style={{ fontWeight: 600 }}>
          Loading…
        </div>
      </div>
    </div>
  )
}

function LiveMessage({ title, sub, onExit }: { title: string; sub?: string; onExit: () => void }) {
  return (
    <div className="live theme-dark">
      <div className="live-top">
        <button className="icon-btn" onClick={onExit} title="Exit">
          <Icon.x />
        </button>
        <div style={{ flex: 1 }}>
          <div className="ltitle">{title}</div>
          {sub && <div className="lsub">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

export function LiveSession() {
  const { sessionId } = useParams()
  const nav = useNav()
  const { data: session, isLoading, isError } = useSession(sessionId)
  const onExit = () => nav('sessions')

  if (isLoading) return <LiveLoading />
  if (isError) return <LiveMessage title="Couldn't load this session" sub="Go back and try again." onExit={onExit} />
  if (!session) return <LiveMessage title="Session not found" sub="It may have been removed." onExit={onExit} />
  return <LiveRunner key={session.id} session={session} onExit={onExit} />
}
