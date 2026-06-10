import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useDeleteDrill, useDrill, useDrills, useMediaMap, useSignedMediaUrl } from '../lib/queries'
import { PHASES } from '../lib/data'
import type { Drill, Phase } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import {
  CornerTag,
  MediaThumb,
  MediaAttribution,
  MEDIA_META,
  Modal,
  Empty,
  ErrorNote,
  Loading,
  PHASE_COLOR,
  Chip,
  DrillCard,
  SourceLink,
} from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { MediaPlayerModal } from '../components/MediaPlayerModal'

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

// The small uppercase label used for the side blocks (equipment, setup notes).
function SideLabel({ icon: Ico, children }: { icon: IconComponent; children: string }) {
  return (
    <div
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
      <Ico style={{ width: 13, height: 13 }} />
      {children}
    </div>
  )
}

// Numbered sentence list, the same shape as coaching points; used for the
// make it easier and make it harder STEP adaptations.
function NumberedList({ items, size = 15 }: { items: string[]; size?: number }) {
  return (
    <div className="coach-points">
      {items.map((p, i) => (
        <div className="cp" key={i}>
          <span className="cp-num">{i + 1}</span>
          <span style={{ fontSize: size, lineHeight: 1.45 }}>{p}</span>
        </div>
      ))}
    </div>
  )
}

function AddToSessionModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const nav = useNav()
  const { user, role } = useAuth()
  const { sessions: allSessions, upsertSession } = useSessions()
  // The sessions read is club-wide, but adding a drill writes the session, so
  // only sessions the signed-in user can edit are offered (own, or admin).
  const sessions = allSessions.filter((s) => role === 'admin' || s.coachId === user?.id)
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

// Plain confirm before a delete. Sessions and templates that reference the
// drill keep their timing and show a removed drill placeholder.
function DeleteDrillModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const nav = useNav()
  const del = useDeleteDrill()
  const remove = () => {
    del.mutate(
      { id: drill.id },
      {
        onSuccess: () => {
          onClose()
          nav('library')
        },
      },
    )
  }
  return (
    <Modal
      title="Delete drill"
      sub={drill.title}
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
        This removes the drill from the club library. Sessions and templates that include it keep their timings and show a
        removed drill placeholder instead.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}

export function DrillDetail() {
  const { id } = useParams()
  const nav = useNav()
  const { user, role } = useAuth()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const { data: drill, isLoading, isError } = useDrill(id)
  const { data: allDrills = [] } = useDrills()
  const mediaById = useMediaMap()
  // Resolved before the early returns so the signed URL hook is called
  // unconditionally. The bucket is private, so opening an image or PDF goes
  // through the same signed URL path as the media library. Both video types
  // play inline in the player overlay instead of opening out.
  const media = drill?.mediaId ? mediaById[drill.mediaId] : undefined
  const openPath = media && (media.type === 'image' || media.type === 'pdf') ? media.storagePath : undefined
  const { data: signedUrl } = useSignedMediaUrl(openPath)
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  if (!drill)
    return (
      <Empty icon={Icon.grid} title="Drill not found">
        It may have been removed.
      </Empty>
    )
  const related = allDrills
    .filter((d) => d.id !== drill.id && (d.corner === drill.corner || d.skill === drill.skill))
    .slice(0, 3)
  const MediaIcon = media ? MEDIA_META[media.type].icon : null
  const playable = media?.type === 'video' || media?.type === 'youtube'
  const openHref = signedUrl ?? undefined
  // Adding to a session writes a session, which parents cannot do.
  const coaching = role === 'coach' || role === 'admin'
  // Edit and delete are owner or admin only, mirroring the drills RLS. The
  // role condition matters for a coach demoted to parent, who still matches
  // created_by on old drills. Seeded drills have no creator, so only an admin
  // can manage them. The database is the real enforcement; this only decides
  // whether to surface the actions.
  const canManage = role === 'admin' || (coaching && !!drill.createdBy && drill.createdBy === user?.id)

  return (
    <div>
      <button className="btn btn-quiet btn-sm" style={{ marginBottom: 16 }} onClick={() => nav('library')}>
        <Icon.chevL />
        Back to library
      </button>

      <div className="detail-grid">
        <div>
          <div className="detail-media">
            {playable && media ? (
              <button
                className="player"
                onClick={() => setPlayerOpen(true)}
                aria-label={'Play ' + media.name}
                style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
              >
                <MediaThumb media={media} />
              </button>
            ) : (
              <div className="player">
                <MediaThumb media={media} label={media ? undefined : 'no media yet'} />
              </div>
            )}
          </div>
          <MediaAttribution media={media} style={{ display: 'block', marginTop: 8 }} />
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
              {playable ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setPlayerOpen(true)}>
                  <Icon.play />
                  Play
                </button>
              ) : openHref ? (
                <a className="btn btn-ghost btn-sm" href={openHref} target="_blank" rel="noreferrer">
                  <Icon.external />
                  Open
                </a>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => nav('media')}>
                  <Icon.external />
                  Open
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
            <CornerTag corner={drill.corner} />
            <span className="pill">{drill.level}</span>
            {drill.theme && <span className="pill">{drill.theme}</span>}
            {drill.format && <span className="pill">{drill.format}</span>}
          </div>
          <h2 style={{ fontSize: 28, lineHeight: 1.1 }}>{drill.title}</h2>
          <p className="muted" style={{ fontSize: 15.5, lineHeight: 1.55, marginTop: 10 }}>
            {drill.summary}
          </p>
          {drill.sourceUrl && (
            <div style={{ marginTop: 10 }}>
              <SourceLink url={drill.sourceUrl} label={drill.sourceLabel} />
            </div>
          )}

          <div className="eyebrow" style={{ marginTop: 20 }}>
            Setup
          </div>
          <div className="setup-grid" style={{ marginTop: 10 }}>
            <SetupCell icon={Icon.clock} k="Duration" v={drill.duration + ' min'} />
            <SetupCell icon={Icon.users} k="Players" v={drill.players} />
            <SetupCell icon={Icon.ruler} k="Area" v={drill.area} />
            <SetupCell icon={Icon.target} k="Skill" v={drill.skill} />
          </div>

          <div style={{ marginTop: 18 }}>
            <SideLabel icon={Icon.cone}>Equipment</SideLabel>
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

          {drill.setupNotes && (
            <div style={{ marginTop: 16 }}>
              <SideLabel icon={Icon.note}>Setup notes</SideLabel>
              <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>{drill.setupNotes}</p>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {drill.ages.length > 0 && (
                <span className="pill">
                  Ages {drill.ages[0]}–{drill.ages[drill.ages.length - 1]}
                </span>
              )}
              {drill.tags.map((t) => (
                <span className="pill" key={t}>
                  #{t}
                </span>
              ))}
            </div>
          </div>

          {coaching && (
            <div className="row" style={{ gap: 10, marginTop: 22 }}>
              <button className="btn btn-primary btn-block" onClick={() => setAddOpen(true)}>
                <Icon.plus />
                Add to session
              </button>
            </div>
          )}
          {canManage && (
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditOpen(true)}>
                <Icon.edit />
                Edit drill
              </button>
              <button
                className="btn btn-ghost btn-sm icon-only"
                style={{ width: 42, padding: 0, alignSelf: 'stretch', height: 'auto' }}
                aria-label="Delete drill"
                onClick={() => setDeleteOpen(true)}
              >
                <Icon.trash />
              </button>
            </div>
          )}
        </div>
      </div>

      {drill.easier.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-title">
            <Icon.chevDown />
            <h3>Make it easier</h3>
          </div>
          <div style={{ maxWidth: 760 }}>
            <NumberedList items={drill.easier} />
          </div>
        </>
      )}

      {drill.harder.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-title">
            <Icon.bolt />
            <h3>Make it harder</h3>
          </div>
          <div style={{ maxWidth: 760 }}>
            <NumberedList items={drill.harder} />
          </div>
        </>
      )}

      {drill.points.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-title">
            <Icon.whistle />
            <h3>Coaching points</h3>
          </div>
          <div style={{ maxWidth: 760 }}>
            <NumberedList items={drill.points} />
          </div>
        </>
      )}

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
      {editOpen && <DrillFormModal drill={drill} onClose={() => setEditOpen(false)} />}
      {deleteOpen && <DeleteDrillModal drill={drill} onClose={() => setDeleteOpen(false)} />}
      {playerOpen && media && <MediaPlayerModal item={media} onClose={() => setPlayerOpen(false)} />}
    </div>
  )
}
