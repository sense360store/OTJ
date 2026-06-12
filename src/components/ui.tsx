// Shared UI primitives ported from the prototype ui.jsx. This module pairs the
// primitives with the small constants and helpers they share, so the fast
// refresh component-only rule is relaxed here.
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { CORNERS, cornerClass, youtubeThumb } from '../lib/data'
import type { CornerKey, Drill, MediaItem, MediaType, Phase } from '../lib/data'
import { sourceLabelForUrl } from '../lib/fa'
import { useMediaMap, useMediaSrc } from '../lib/queries'

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

// The session date as the cards and pitch-side views show it: Mon 16 Jun.
export function fmtDate(d: string): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
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

/* ---- Topic tags ------------------------------------------------- */
// The classification slot for a drill with no corner: the real topic tags
// (FA imports carry them) instead of a defaulted corner. Tags and corner
// are different classifications, so a corner is never invented from them;
// with neither, the slot renders nothing.
export function TopicTags({ tags, small }: { tags: string[]; small?: boolean }) {
  if (tags.length === 0) return null
  return (
    <span className="row wrap" style={{ gap: 5 }}>
      {tags.map((t) => (
        <span key={t} className="pill" style={small ? { padding: '2px 7px', fontSize: 11 } : undefined}>
          #{t}
        </span>
      ))}
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
  // that references the same object, and a load error (an expired URL) retries
  // once on a fresh URL before falling back to the placeholder art. YouTube
  // thumbnails are public and need none of this.
  const previewPath = media && (media.type === 'image' || media.type === 'video') ? media.storagePath : undefined
  const { src: signedUrl, onError, onLoad } = useMediaSrc(previewPath)
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
      {imgSrc && (
        <img
          src={imgSrc}
          alt={media.name}
          loading="lazy"
          style={REAL_MEDIA_STYLE}
          onError={media.type === 'image' ? onError : undefined}
          onLoad={media.type === 'image' ? onLoad : undefined}
        />
      )}
      {videoSrc && (
        <video
          src={videoSrc}
          preload="metadata"
          muted
          playsInline
          style={REAL_MEDIA_STYLE}
          onError={onError}
          onLoadedMetadata={onLoad}
        />
      )}
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

/* ---- chip and numbered list editor ------------------------------ */
// Comma or enter adds an item; points and adaptations are sentences, so with
// numbered they split on enter only and render as a numbered list. Shared by
// the drill form (equipment, points, tags, easier, harder) and the planner
// (session intentions).
export function ListInput({
  value,
  onChange,
  placeholder,
  numbered,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
  numbered?: boolean
}) {
  const [draft, setDraft] = useState('')
  const commit = (text: string) => {
    const parts = numbered ? [text] : text.split(',')
    const items = parts.map((s) => s.trim()).filter((s) => s && !value.includes(s))
    if (items.length) onChange([...value, ...items])
    setDraft('')
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || (!numbered && e.key === ',')) {
      e.preventDefault()
      commit(draft)
    }
  }
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))
  return (
    <div>
      {value.length > 0 &&
        (numbered ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {value.map((v, i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span className="cp-num">{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14, lineHeight: 1.45 }}>{v}</span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Remove" onClick={() => remove(i)}>
                  <Icon.x style={{ width: 13, height: 13 }} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            {value.map((v, i) => (
              <span key={i} className="pill">
                {v}
                <button
                  aria-label={'Remove ' + v}
                  onClick={() => remove(i)}
                  style={{ display: 'inline-flex', border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                >
                  <Icon.x style={{ width: 12, height: 12 }} />
                </button>
              </span>
            ))}
          </div>
        ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  )
}

/* ---- source attribution ----------------------------------------- */
// A clearly labelled source link for content with a source_url. The label is
// the stored one, or derives from the URL ("England Football Learning" for
// learn.englandfootball.com, the domain otherwise).
export function SourceLink({ url, label }: { url?: string | null; label?: string | null }) {
  if (!url) return null
  const text = label || sourceLabelForUrl(url) || url
  return (
    <a className="pill" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
      <Icon.external />
      Source: {text}
    </a>
  )
}

// The small attribution line shown wherever an attributed image renders
// large (drill detail, the media preview, the full-screen viewer). See
// CLAUDE.md, Third-party content.
export function MediaAttribution({ media, style }: { media?: MediaItem | null; style?: CSSProperties }) {
  if (!media?.sourceLabel) return null
  const noun = media.type === 'video' || media.type === 'youtube' ? 'Video' : 'Image'
  const line = `${noun}: ${media.sourceLabel}`
  const base: CSSProperties = { fontSize: 12, fontWeight: 600, ...style }
  if (media.sourceUrl) {
    return (
      <a className="muted" href={media.sourceUrl} target="_blank" rel="noreferrer" style={base}>
        {line}
      </a>
    )
  }
  return (
    <div className="muted" style={base}>
      {line}
    </div>
  )
}

/* ---- drill card ------------------------------------------------ */
export function DrillCard({ drill, onClick, action }: { drill: Drill; onClick?: () => void; action?: ReactNode }) {
  const mediaById = useMediaMap()
  const media = drill.mediaId ? mediaById[drill.mediaId] : undefined
  // An unclassified drill gets a neutral strip and its topic tags in the
  // corner slot, never a defaulted corner.
  const c = drill.corner ? CORNERS[drill.corner] : null
  return (
    <div className="drill-card" onClick={onClick}>
      <div className="dc-corner-strip" style={{ background: c ? c.color : 'var(--line)' }}></div>
      <div style={{ padding: 0 }}>
        <MediaThumb media={media} />
      </div>
      <div className="dc-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {drill.corner ? <CornerTag corner={drill.corner} small /> : <TopicTags tags={drill.tags} small />}
          <span className="pill" style={{ marginLeft: 'auto' }}>
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
          {drill.skill && <span className="pill">{drill.skill}</span>}
          {drill.ages.length > 0 && (
            <span className="pill">
              {drill.ages[0]}–{drill.ages[drill.ages.length - 1]}
            </span>
          )}
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
