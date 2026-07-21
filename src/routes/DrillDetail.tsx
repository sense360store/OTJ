import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useDrill, useDrills, useMediaMap, useMyCapabilities, useSignedMediaUrl } from '../lib/queries'
import { embedSrc, isSampleMedia, PHASES } from '../lib/data'
import { relatedDrills } from '../lib/contentOrder'
import { isFaVideo } from '../lib/fa'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { DRILL_ADD_ERROR } from '../lib/sessionSubmit'
import type { Drill, Phase, Session } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import {
  ActionError,
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
  TopicTags,
} from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { DeleteDrillModal } from '../components/DeleteDrillModal'
import { MediaPlayerModal, MediaPlayerSurface } from '../components/MediaPlayerModal'
import { ShareButton } from '../components/ShareButton'
import { PublicShareControl } from '../components/PublicShareControl'

function SetupCell({ icon: Ico, k, v }: { icon: IconComponent; k: string; v: string }) {
  return (
    <div className="setup-cell">
      <div className="k">
        <Ico />
        {k}
      </div>
      <div className="v">
        {v || (
          <span className="muted" style={{ fontWeight: 500 }}>
            Not set
          </span>
        )}
      </div>
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

// The modal body pulled out as a presentational component, so the static
// renderer can prove that while a write is in flight the surface is not
// dismissible (Escape, overlay and X frozen via Modal) and every control that
// shapes the write (the session choice and the phase) is disabled, alongside
// Cancel and Add drill. A failure re-enables them with the choices intact.
export function AddToSessionView({
  drill,
  sessions,
  target,
  phase,
  adding,
  failed,
  onClose,
  onTarget,
  onPhase,
  onAdd,
}: {
  drill: Drill
  sessions: Session[]
  target: string
  phase: Phase
  adding: boolean
  failed: boolean
  onClose: () => void
  onTarget: (id: string) => void
  onPhase: (p: Phase) => void
  onAdd: () => void
}) {
  return (
    <Modal
      title="Add to session"
      sub={drill.title}
      onClose={onClose}
      dismissible={!adding}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={adding}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onAdd} disabled={!target || adding}>
            <Icon.plus />
            {adding ? 'Adding…' : 'Add drill'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Choose a session</label>
        <select value={target} disabled={adding} onChange={(e) => onTarget(e.target.value)}>
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
            <Chip key={p} on={phase === p} dot={PHASE_COLOR[p]} disabled={adding} onClick={() => onPhase(p)}>
              {p}
            </Chip>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13.5 }}>
        Adds <b style={{ color: 'var(--ink)' }}>{drill.duration} min</b> to the session.
      </div>
      {failed && <ActionError style={{ marginTop: 10 }}>{DRILL_ADD_ERROR}</ActionError>}
    </Modal>
  )
}

function AddToSessionModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { sessions: allSessions, upsertSession } = useSessions()
  // The sessions read is club-wide, but adding a drill writes the session, so
  // only sessions the signed-in user can edit are offered: any with
  // sessions.manage, their own otherwise.
  const sessions = allSessions.filter((s) => caps.has('sessions.manage') || s.coachId === user?.id)
  const [phase, setPhase] = useState<Phase>('Skill')
  const [target, setTarget] = useState(sessions[0]?.id || '')
  // The write is awaited: the modal closes and the planner opens only after
  // the session lands. A failure keeps the modal open with the choices intact
  // and a calm note; Add drill doubles as the retry. While the write is in
  // flight the modal is not dismissible, so it can never be closed to hide the
  // pending write and then encourage a duplicate retry.
  const { submit, pending, failed } = useGuardedSubmit<Session, Session>({
    operation: 'add drill to session',
    perform: (updated) => upsertSession(updated),
    onSuccess: (saved) => {
      onClose()
      nav('planner', { sessionId: saved.id })
    },
  })
  const adding = pending !== null
  const add = () => {
    const s = sessions.find((x) => x.id === target)
    if (!s) return
    void submit({ ...s, activities: [...s.activities, { phase, drillId: drill.id, duration: drill.duration }] })
  }
  return (
    <AddToSessionView
      drill={drill}
      sessions={sessions}
      target={target}
      phase={phase}
      adding={adding}
      failed={failed}
      onClose={onClose}
      onTarget={setTarget}
      onPhase={setPhase}
      onAdd={add}
    />
  )
}

export function DrillDetail() {
  const { id } = useParams()
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
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
  // Match keys and creation ordering live in relatedDrills
  // (src/lib/contentOrder.ts), kept out of the newest first change to the
  // list reads.
  const related = relatedDrills(drill, allDrills)
  const MediaIcon = media ? MEDIA_META[media.type].icon : null
  // A sample (a seeded row with no file or playable link behind it) offers no
  // Play or Open here; it is labelled for what it is instead.
  const sample = !!media && isSampleMedia(media)
  // An embedded video plays inline here in a sandboxed iframe, so it needs no
  // Play overlay or open out. An FA sourced video never plays inline (the FA
  // domain locks its player), so it takes the same slot but the surface
  // renders the link out to England Football Learning instead.
  const embed = media ? embedSrc(media.embedUrl) : null
  const faVideo = !!media && isFaVideo(media)
  const playable = !sample && (media?.type === 'video' || media?.type === 'youtube')
  const openHref = signedUrl ?? undefined
  // Adding to a session writes a session, so it follows sessions.create.
  const canPlan = caps.has('sessions.create')
  // Sharing an internal club link is a coaching affordance: shown to members
  // who can plan (sessions.create), hidden from parents. It is only a UI
  // decision about who sees the button, not an access boundary: the link is the
  // canonical protected page and grants nothing on its own, RLS decides access,
  // and no capability changes for PR 0.
  const canShare = caps.has('sessions.create')
  // Edit and delete mirror the drills RLS arms: drills.manage on any drill,
  // an owner holding drills.create on their own. The capability condition
  // matters for a coach demoted to parent, who still matches created_by on
  // old drills. Seeded drills have no creator, so only a manage holder
  // touches them. The database is the real enforcement; this only decides
  // whether to surface the actions.
  const canManage =
    caps.has('drills.manage') || (caps.has('drills.create') && !!drill.createdBy && drill.createdBy === user?.id)
  // Public sharing (PR 2) mirrors the server's create authority: shares.create
  // combined with the drill create/manage arm (canManage). A manager holding
  // shares.manage may turn off any club link, but never rotate or refresh one.
  // The UI only surfaces controls; the Edge Function and RPC are the boundary.
  const canPublishShare = caps.has('shares.create') && canManage
  const canRevokeAnyShare = caps.has('shares.manage')

  return (
    <div>
      <button className="btn btn-quiet btn-sm" style={{ marginBottom: 16 }} onClick={() => nav('library')}>
        <Icon.chevL />
        Back to library
      </button>

      <div className="detail-grid">
        <div>
          <div className="detail-media">
            {(embed || faVideo) && media ? (
              <div className="player">
                <MediaPlayerSurface item={media} />
              </div>
            ) : playable && media ? (
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
                <MediaThumb media={media} label={media ? (sample ? 'sample' : undefined) : 'no media yet'} />
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
              {sample ? (
                <span className="pill" style={{ color: 'var(--slate-2)' }}>
                  Sample, no file attached
                </span>
              ) : embed || faVideo ? null : playable ? (
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
                <button className="btn btn-ghost btn-sm" disabled>
                  <Icon.external />
                  Open
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          {/* The classification slot: the corner when one was set, the real
              topic tags otherwise. A corner is never defaulted or invented
              from the tags. */}
          <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
            {drill.corner ? <CornerTag corner={drill.corner} /> : <TopicTags tags={drill.tags} />}
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
              {/* Tags render once: in the classification slot above when the
                  drill has no corner, down here otherwise. */}
              {drill.corner != null &&
                drill.tags.map((t) => (
                  <span className="pill" key={t}>
                    #{t}
                  </span>
                ))}
            </div>
          </div>

          {canPlan && (
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
          {canShare && (
            <div style={{ marginTop: 10 }}>
              <ShareButton kind="drill" id={drill.id} title={drill.title} />
            </div>
          )}
          {(canPublishShare || canRevokeAnyShare) && (
            <PublicShareControl
              drillId={drill.id}
              drillTitle={drill.title}
              canPublish={canPublishShare}
              canRevokeAny={canRevokeAnyShare}
            />
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
      {deleteOpen && (
        <DeleteDrillModal drill={drill} onClose={() => setDeleteOpen(false)} afterDelete={() => nav('library')} />
      )}
      {playerOpen && media && <MediaPlayerModal item={media} onClose={() => setPlayerOpen(false)} />}
    </div>
  )
}
