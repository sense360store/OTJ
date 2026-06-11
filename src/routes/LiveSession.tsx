// Run a session on the touchline. Full-screen overlay that forces dark mode
// for contrast. The owning coach (or an admin) drives: their timer and
// position persist to localStorage so a refresh keeps the place, and every
// activity change writes the shared live state onto the session row. Everyone
// else in the club who opens the same URL watches that row over Supabase
// Realtime, with the clock computed locally from live_activity_started_at.
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import {
  useActivityTitle,
  useSession,
  useDrillMap,
  useMediaMap,
  useTeamMap,
  useLiveSessionSync,
  useSetLiveActivity,
} from '../lib/queries'
import { embedSrc, sessionMinutes } from '../lib/data'
import type { Activity, Drill, MediaItem, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { fmtClock, MediaAttribution, MediaThumb, MEDIA_META, Modal, PHASE_COLOR } from '../components/ui'
import { MediaPlayerSurface } from '../components/MediaPlayerModal'

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

// The activity heading: phase tag, title and the drill's meta line. Shared by
// the driver and watcher stages so the two views match.
function StageHeading({ act, drill }: { act: Activity; drill: Drill | null }) {
  const actTitle = useActivityTitle()
  return (
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
  )
}

// The tappable media strip plus its viewer modal, shared by both views.
function LiveMediaPeek({ media, drill }: { media: MediaItem; drill: Drill }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
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
      {open && (
        <Modal
          title={drill.title}
          sub={MEDIA_META[media.type].label}
          onClose={() => setOpen(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setOpen(false)}>
              Close
            </button>
          }
        >
          <div className="detail-media">
            <div className="player">
              {embedSrc(media.embedUrl) ? <MediaPlayerSurface item={media} /> : <MediaThumb media={media} />}
            </div>
          </div>
          <MediaAttribution media={media} style={{ display: 'block', marginTop: 8 }} />
        </Modal>
      )}
    </>
  )
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
  const setLive = useSetLiveActivity()
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
  // The device's saved place wins; a driver on a fresh device rejoins at the
  // live activity when the session is already running. Clamped because the
  // plan can have changed since either was recorded.
  const startIdx = Math.max(0, Math.min(saved?.idx ?? session.liveActivityIndex ?? 0, acts.length - 1))

  const [idx, setIdx] = useState(startIdx)
  const [remaining, setRemaining] = useState(saved?.remaining ?? (acts[startIdx]?.duration ?? 0) * 60)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0)
  const [done, setDone] = useState<number[]>(saved?.done ?? [])
  const [notes, setNotes] = useState<Record<number, string>>(saved?.notes ?? {})
  const [complete, setComplete] = useState(saved?.complete ?? false)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  // Going live: opening the runner starts the shared state, but only when the
  // loaded row says the session is not already live, so a driver rejoining
  // (or an admin opening a session the owner is mid-way through) does not
  // reset it. Watchers never reach this component.
  useEffect(() => {
    if (!complete && acts.length > 0 && session.liveActivityIndex == null) {
      setLive.mutate({ id: session.id, index: idx })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // Watchers follow the row; the local pause, play and reset stay local.
    setLive.mutate({ id: session.id, index: i })
  }
  const markDoneNext = () => {
    setDone((d) => (d.includes(idx) ? d : [...d, idx]))
    if (idx >= acts.length - 1) {
      setComplete(true)
      setRunning(false)
      // Ending clears the live state and marks the session completed.
      setLive.mutate({ id: session.id, index: null })
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
    setLive.mutate({ id: session.id, index: 0 })
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
          <StageHeading act={act} drill={drill} />

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
          {media && drill && <LiveMediaPeek media={media} drill={drill} />}

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
    </div>
  )
}

// Seconds since the live activity began, clamped so a small clock skew
// between the driver's device and this one never shows a negative time.
function elapsedSince(startedAt: string | null): number {
  if (!startedAt) return 0
  const t = Date.parse(startedAt)
  if (isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 1000))
}

// Read-only live view for everyone who is not driving. State comes from the
// session row (kept fresh by useLiveSessionSync); the clock is computed
// locally from live_activity_started_at, so no stream of updates is needed.
function LiveWatcher({ session, onExit }: { session: Session; onExit: () => void }) {
  const nav = useNav()
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const actTitle = useActivityTitle()
  const teamById = useTeamMap()
  const teamName = session.teamId ? teamById[session.teamId]?.name : 'Club'
  const acts = session.activities
  const live = session.liveActivityIndex

  // A one second tick keeps the computed clock moving while live.
  const [, setNow] = useState(0)
  useEffect(() => {
    if (live == null) return
    const t = setInterval(() => setNow((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  const watchingPill = (
    <span className="pill" style={{ flex: '0 0 auto' }}>
      <Icon.eye />
      Watching
    </span>
  )

  // Ended (or already completed when opened): a quiet complete state.
  if (live == null && session.status === 'completed')
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
              {session.name} · {acts.length} activities
            </div>
            <button className="btn btn-gold btn-lg" style={{ marginTop: 8 }} onClick={onExit}>
              <Icon.check />
              Done
            </button>
          </div>
        </div>
      </div>
    )

  // Not started: show the plan with a quiet waiting state.
  if (live == null)
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
              Not started yet · {session.focus}
              {teamName ? ' · ' + teamName : ''}
            </div>
          </div>
          {watchingPill}
        </div>
        <div className="live-body">
          <div className="live-stage">
            {acts.length === 0 ? (
              <div className="muted" style={{ textAlign: 'center', fontWeight: 600 }}>
                No activities in this session yet.
              </div>
            ) : (
              <div className="live-card" style={{ padding: '16px 18px' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>
                  The plan · {sessionMinutes(session)} min
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {acts.map((a, i) => (
                    <div key={i} className="row" style={{ gap: 10 }}>
                      <span className="cp-num">{i + 1}</span>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 14.5 }}>{actTitle(a)}</span>
                      <span className="tag-dot" style={{ background: PHASE_COLOR[a.phase] }}></span>
                      <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                        {a.duration} min
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="muted" style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 600 }}>
              This page follows the session live once the coach starts it.
            </div>
          </div>
        </div>
      </div>
    )

  // Live. The plan can have been shortened while live, so clamp the index.
  const idx = Math.min(live, acts.length - 1)
  const act = acts[idx]
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
          {watchingPill}
        </div>
      </div>
    )

  const drill = act.drillId ? drillById[act.drillId] : null
  const media = drill && drill.mediaId ? mediaById[drill.mediaId] : null
  const actSecs = (act.duration || 0) * 60
  const remaining = Math.max(0, actSecs - elapsedSince(session.liveActivityStartedAt))
  const frac = actSecs ? 1 - remaining / actSecs : 0

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
        {watchingPill}
      </div>

      <div className="live-progress">
        {acts.map((_, i) => (
          <div key={i} className={'live-seg' + (i < idx ? ' done' : i === idx ? ' cur' : '')}></div>
        ))}
      </div>

      <div className="live-body">
        <div className="live-stage">
          <StageHeading act={act} drill={drill} />

          {/* clock, computed from when the driver started this activity */}
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

          {/* media */}
          {media && drill && <LiveMediaPeek media={media} drill={drill} />}

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
  const { user, role, profileLoading } = useAuth()
  const { data: session, isLoading, isError } = useSession(sessionId)
  // One realtime channel per session id, cleaned up on unmount. The driver
  // subscribes too, harmlessly; its own writes come back as cache freshness.
  useLiveSessionSync(sessionId)
  const onExit = () => nav('sessions')

  // Wait for the role too, so a watcher is never flashed the driver controls.
  if (isLoading || profileLoading) return <LiveLoading />
  if (isError) return <LiveMessage title="Couldn't load this session" sub="Go back and try again." onExit={onExit} />
  if (!session) return <LiveMessage title="Session not found" sub="It may have been removed." onExit={onExit} />
  // Driving follows the sessions update policy: the owner while they hold a
  // coaching role, or an admin. A coach demoted to parent watches their old
  // sessions like anyone else. The RLS is the real enforcement; this only
  // decides which view to render.
  const canDrive = role === 'admin' || (role === 'coach' && session.coachId === user?.id)
  if (canDrive) return <LiveRunner key={session.id} session={session} onExit={onExit} />
  return <LiveWatcher key={session.id} session={session} onExit={onExit} />
}
