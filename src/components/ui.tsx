// Shared UI primitives ported from the prototype ui.jsx. This module pairs the
// primitives with the small constants and helpers they share, so the fast
// refresh component-only rule is relaxed here.
/* eslint-disable react-refresh/only-export-components */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { CORNERS, cornerClass, youtubeThumb } from '../lib/data'
import type { CornerKey, Drill, MediaItem, MediaType, Phase } from '../lib/data'
import { useMediaMap, useSignedMediaUrl } from '../lib/queries'

const REAL_MEDIA_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
} as const

export function fmtMin(m: number): string {
  return m + ' min'
}

export function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}

/* ---- Corner tag ------------------------------------------------ */
export function CornerTag({ corner, small }: { corner: CornerKey; small?: boolean }) {
  const c = CORNERS[corner]
  if (!c) return null
  return (
    <span
      className={'tag corner-' + cornerClass[corner]}
      style={small ? { padding: '2px 7px', fontSize: 11 } : undefined}
    >
      <span className="tag-dot" style={{ background: c.color }}></span>
      {c.label}
    </span>
  )
}

/* ---- media type meta ------------------------------------------- */
export const MEDIA_META: Record<MediaType, { label: string; icon: IconComponent; color: string }> = {
  video: { label: 'Video', icon: Icon.video, color: 'var(--m-video)' },
  youtube: { label: 'YouTube', icon: Icon.youtube, color: 'var(--m-youtube)' },
  image: { label: 'Image', icon: Icon.image, color: 'var(--m-image)' },
  pdf: { label: 'PDF', icon: Icon.fileText, color: 'var(--m-pdf)' },
}

/* ---- thumbnail (placeholder art) ------------------------------- */
export function MediaThumb({
  media,
  showPlay,
  showBadge = true,
  label,
}: {
  media?: MediaItem | null
  showPlay?: boolean
  showBadge?: boolean
  label?: string
}) {
  // The bucket is private, so an image or video preview needs a signed URL.
  // Keyed by storage_path, the hook shares one URL across every card and drill
  // that references the same object. YouTube thumbnails are public and need none.
  const previewPath = media && (media.type === 'image' || media.type === 'video') ? media.storagePath : undefined
  const { data: signedUrl } = useSignedMediaUrl(previewPath)
  if (!media) {
    return (
      <div className="thumb thumb-diagram">
        <span style={{ color: 'var(--slate-2)', fontSize: 12, fontWeight: 700 }}>No media</span>
        <span className="thumb-label">add a clip or diagram</span>
      </div>
    )
  }
  const meta = MEDIA_META[media.type]
  const Ico = meta.icon
  const ytThumb = media.type === 'youtube' ? youtubeThumb(media.yt) : null
  const imgSrc = media.type === 'image' ? signedUrl : ytThumb
  const videoSrc = media.type === 'video' ? signedUrl : null
  const hasReal = !!imgSrc || !!videoSrc
  // With a real preview behind it, drop the patterned placeholder background so
  // the file shows through. Otherwise keep the per-kind placeholder art.
  const kindClass = hasReal
    ? 'thumb-real'
    : media.kind === 'pitch'
      ? 'thumb-pitch'
      : media.kind === 'pdf'
        ? 'thumb-pdf'
        : media.type === 'image'
          ? 'thumb-img'
          : 'thumb-diagram'
  const isVideo = media.type === 'video' || media.type === 'youtube'
  return (
    <div className={'thumb ' + kindClass} style={hasReal ? { background: '#0a0e1a' } : undefined}>
      {imgSrc && <img src={imgSrc} alt={media.name} loading="lazy" style={REAL_MEDIA_STYLE} />}
      {videoSrc && <video src={videoSrc} preload="metadata" muted playsInline style={REAL_MEDIA_STYLE} />}
      {isVideo && showPlay !== false && (
        <div className="play-btn">
          <Icon.play />
        </div>
      )}
      {!isVideo && media.kind === 'pdf' && !hasReal && (
        <Icon.fileText style={{ width: 34, height: 34, color: 'var(--m-pdf)', opacity: 0.6 }} />
      )}
      {showBadge && (
        <span className="media-badge" style={{ background: meta.color }}>
          <Ico />
          {meta.label}
        </span>
      )}
      {showBadge !== false && (
        <span className="thumb-label">
          {label !== undefined
            ? label
            : media.kind === 'pdf'
              ? 'session card'
              : media.kind === 'diagram'
                ? 'drill diagram'
                : 'pitch footage'}
        </span>
      )}
      {media.length && showBadge !== false && <span className="dur-badge">{media.length}</span>}
    </div>
  )
}

/* ---- pills ----------------------------------------------------- */
export function Pill({ icon: Ico, children }: { icon?: IconComponent; children: ReactNode }) {
  return (
    <span className="pill">
      {Ico && <Ico />}
      {children}
    </span>
  )
}

/* ---- filter chip ----------------------------------------------- */
export function Chip({
  on,
  onClick,
  dot,
  icon: Ico,
  children,
}: {
  on?: boolean
  onClick?: () => void
  dot?: string
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <button className={'chip' + (on ? ' on' : '')} onClick={onClick}>
      {dot && <span className="chip-dot" style={{ background: dot }}></span>}
      {Ico && <Ico />}
      {children}
    </button>
  )
}

/* ---- drill card ------------------------------------------------ */
export function DrillCard({ drill, onClick, action }: { drill: Drill; onClick?: () => void; action?: ReactNode }) {
  const mediaById = useMediaMap()
  const media = drill.mediaId ? mediaById[drill.mediaId] : undefined
  const c = CORNERS[drill.corner]
  return (
    <div className="drill-card" onClick={onClick}>
      <div className="dc-corner-strip" style={{ background: c.color }}></div>
      <div style={{ padding: 0 }}>
        <MediaThumb media={media} />
      </div>
      <div className="dc-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <CornerTag corner={drill.corner} small />
          <span className="pill">
            <Icon.clock />
            {drill.duration}m
          </span>
        </div>
        <h3>{drill.title}</h3>
        <p
          className="muted"
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {drill.summary}
        </p>
        <div className="dc-meta">
          <span className="pill">{drill.skill}</span>
          <span className="pill">
            {drill.ages[0]}–{drill.ages[drill.ages.length - 1]}
          </span>
        </div>
        {action}
      </div>
    </div>
  )
}

/* ---- modal shell ----------------------------------------------- */
export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 860 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon.x />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ---- phase color ----------------------------------------------- */
export const PHASE_COLOR: Record<Phase, string> = {
  'Warm-Up': 'var(--c-physical)',
  Skill: 'var(--c-technical)',
  Game: 'var(--c-social)',
  'Cool-Down': 'var(--c-psych)',
}

/* ---- empty state ----------------------------------------------- */
export function Empty({ icon: Ico, title, children }: { icon?: IconComponent; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {Ico && <Ico />}
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
  )
}

/* ---- loading and error ----------------------------------------- */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="muted" style={{ padding: '48px 0', textAlign: 'center', fontWeight: 600 }}>
      {label}
    </div>
  )
}

export function ErrorNote({ children }: { children?: ReactNode }) {
  return (
    <div className="muted" style={{ padding: '48px 0', textAlign: 'center', fontWeight: 600 }}>
      {children ?? 'Something went wrong loading this. Refresh to try again.'}
    </div>
  )
}
