import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { useDrill, useDrills, useMediaMap } from '../lib/queries'
import { PHASES } from '../lib/data'
import type { Drill, Phase } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { CornerTag, MediaThumb, MEDIA_META, Modal, Empty, ErrorNote, Loading, PHASE_COLOR, Chip, DrillCard } from '../components/ui'

function SetupCell({ icon: Ico, k, v }: { icon: IconComponent; k: string; v: string }) {
  return (
    <div className="setup-cell">
      <div className="k">
        <Ico />
        {k}
      </div>
      <div className="v">{v}</div>
    </div>
  )
}

function AddToSessionModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const nav = useNav()
  const { sessions, upsertSession } = useSessions()
  const [phase, setPhase] = useState<Phase>('Skill')
  const [target, setTarget] = useState(sessions[0]?.id || '')
  const add = () => {
    const s = sessions.find((x) => x.id === target)
    if (!s) return
    const updated = { ...s, activities: [...s.activities, { phase, drillId: drill.id, duration: drill.duration }] }
    upsertSession(updated)
    onClose()
    nav('planner', { sessionId: s.id })
  }
  return (
    <Modal
      title="Add to session"
      sub={drill.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={add} disabled={!target}>
            <Icon.plus />
            Add drill
          </button>
        </>
      }
    >
      <div className="field">
        <label>Choose a session</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Add to phase</label>
        <div className="row wrap" style={{ gap: 8 }}>
          {PHASES.map((p) => (
            <Chip key={p} on={phase === p} dot={PHASE_COLOR[p]} onClick={() => setPhase(p)}>
              {p}
            </Chip>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13.5 }}>
        Adds <b style={{ color: 'var(--ink)' }}>{drill.duration} min</b> to the session.
      </div>
    </Modal>
  )
}

export function DrillDetail() {
  const { id } = useParams()
  const nav = useNav()
  const [addOpen, setAddOpen] = useState(false)
  const { data: drill, isLoading, isError } = useDrill(id)
  const { data: allDrills = [] } = useDrills()
  const mediaById = useMediaMap()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  if (!drill)
    return (
      <Empty icon={Icon.grid} title="Drill not found">
        It may have been removed.
      </Empty>
    )
  const media = drill.mediaId ? mediaById[drill.mediaId] : undefined
  const related = allDrills
    .filter((d) => d.id !== drill.id && (d.corner === drill.corner || d.skill === drill.skill))
    .slice(0, 3)
  const MediaIcon = media ? MEDIA_META[media.type].icon : null

  return (
    <div>
      <button className="btn btn-quiet btn-sm" style={{ marginBottom: 16 }} onClick={() => nav('library')}>
        <Icon.chevL />
        Back to library
      </button>

      <div className="detail-grid">
        <div>
          <div className="detail-media">
            <div className="player">
              <MediaThumb media={media} label={media ? undefined : 'no media yet'} />
            </div>
          </div>
          {media && MediaIcon && (
            <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="pill" style={{ color: MEDIA_META[media.type].color }}>
                  <MediaIcon /> {MEDIA_META[media.type].label}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {media.name}
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => nav('media')}>
                <Icon.external />
                Open
              </button>
            </div>
          )}

          <hr className="divider" />
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Coaching points</h3>
          <div className="coach-points">
            {drill.points.map((p, i) => (
              <div className="cp" key={i}>
                <span className="cp-num">{i + 1}</span>
                <span style={{ fontSize: 15, lineHeight: 1.45 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
            <CornerTag corner={drill.corner} />
            <span className="pill">{drill.level}</span>
          </div>
          <h2 style={{ fontSize: 28, lineHeight: 1.1 }}>{drill.title}</h2>
          <p className="muted" style={{ fontSize: 15.5, lineHeight: 1.55, marginTop: 10 }}>
            {drill.summary}
          </p>

          <div className="setup-grid" style={{ marginTop: 18 }}>
            <SetupCell icon={Icon.clock} k="Duration" v={drill.duration + ' min'} />
            <SetupCell icon={Icon.users} k="Players" v={drill.players} />
            <SetupCell icon={Icon.ruler} k="Area" v={drill.area} />
            <SetupCell icon={Icon.target} k="Skill" v={drill.skill} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div
              className="k"
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                color: 'var(--slate-2)',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Icon.cone style={{ width: 13, height: 13 }} />
              Equipment
            </div>
            <div className="row wrap" style={{ gap: 7 }}>
              {drill.equipment.length ? (
                drill.equipment.map((e) => (
                  <span className="pill" key={e}>
                    {e}
                  </span>
                ))
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  None needed
                </span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="pill">
                Ages {drill.ages[0]}–{drill.ages[drill.ages.length - 1]}
              </span>
              {drill.tags.map((t) => (
                <span className="pill" key={t}>
                  #{t}
                </span>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 22 }}>
            <button className="btn btn-primary btn-block" onClick={() => setAddOpen(true)}>
              <Icon.plus />
              Add to session
            </button>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-title">
            <Icon.layers />
            <h3>Related drills</h3>
          </div>
          <div className="grid-drills">
            {related.map((d) => (
              <DrillCard key={d.id} drill={d} onClick={() => nav('drill', { drillId: d.id })} />
            ))}
          </div>
        </>
      )}

      {addOpen && <AddToSessionModal drill={drill} onClose={() => setAddOpen(false)} />}
    </div>
  )
}
