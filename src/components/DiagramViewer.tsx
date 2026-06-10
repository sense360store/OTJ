// Full-screen diagram viewer: swipe between a session's diagrams in activity
// order, the FA carousel pattern. Swiping is native horizontal scroll with
// snap, so pinch and double-tap zoom stay standard browser behaviour on the
// image. Works for SVG, PNG and JPG through the same signed URL path as
// every other preview. The caption beneath comes from the drill title and
// summary, with the attribution line when the media carries a source_label.
import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../lib/data'
import { useMediaSrc } from '../lib/queries'
import { Icon } from './icons'
import './DiagramViewer.css'

export interface DiagramSlide {
  media: MediaItem
  title: string
  summary?: string
}

function Slide({ slide }: { slide: DiagramSlide }) {
  // A load error on an expired URL retries once on a fresh URL before the
  // could not load state shows.
  const { src: url, isLoading, onError, onLoad } = useMediaSrc(slide.media.storagePath)
  return (
    <div className="dv-slide">
      <div className="dv-imgwrap">
        {url ? (
          <img src={url} alt={slide.media.name} onError={onError} onLoad={onLoad} />
        ) : (
          <div className="dv-loading">{isLoading ? 'Loading…' : 'Could not load this diagram'}</div>
        )}
      </div>
      <div className="dv-caption">
        <div className="dv-cap-title">{slide.title}</div>
        {slide.summary && <div className="dv-cap-sub">{slide.summary}</div>}
        {slide.media.sourceLabel &&
          (slide.media.sourceUrl ? (
            <a className="dv-attrib" href={slide.media.sourceUrl} target="_blank" rel="noreferrer">
              Image: {slide.media.sourceLabel}
            </a>
          ) : (
            <span className="dv-attrib">Image: {slide.media.sourceLabel}</span>
          ))}
      </div>
    </div>
  )
}

export function DiagramViewer({
  slides,
  startIndex = 0,
  onClose,
}: {
  slides: DiagramSlide[]
  startIndex?: number
  onClose: () => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(() => Math.min(Math.max(startIndex, 0), slides.length - 1))

  // Open on the tapped diagram before paint, then let native scroll drive.
  useEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = idx * el.clientWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    const next = Math.round(el.scrollLeft / el.clientWidth)
    if (next !== idx && next >= 0 && next < slides.length) setIdx(next)
  }

  const goTo = (i: number) => {
    const el = track.current
    if (!el || i < 0 || i >= slides.length) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  if (slides.length === 0) return null

  return (
    <div className="dv" role="dialog" aria-label="Diagrams">
      <div className="dv-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon.x />
        </button>
        <span className="dv-count" style={{ marginLeft: 'auto' }}>
          {idx + 1} of {slides.length}
        </span>
      </div>
      <div className="dv-track" ref={track} onScroll={onScroll}>
        {slides.map((s, i) => (
          <Slide key={i} slide={s} />
        ))}
      </div>
      {slides.length > 1 && (
        <div className="dv-foot">
          <button className="icon-btn" onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Previous diagram">
            <Icon.chevL />
          </button>
          <div className="dv-dots">
            {slides.map((_, i) => (
              <span key={i} className={'dv-dot' + (i === idx ? ' on' : '')}></span>
            ))}
          </div>
          <button
            className="icon-btn"
            onClick={() => goTo(idx + 1)}
            disabled={idx === slides.length - 1}
            aria-label="Next diagram"
          >
            <Icon.chevR />
          </button>
        </div>
      )}
    </div>
  )
}
