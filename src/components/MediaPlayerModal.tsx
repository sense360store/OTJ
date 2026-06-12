// Inline playback for video media. Uploaded clips play in an HTML5 element on
// the same signed URL the cards use; playsinline keeps iOS from hijacking
// playback into the native fullscreen player. YouTube items render the
// privacy-enhanced nocookie embed, with a small link out kept for anyone who
// wants the app or channel context. FA sourced video falls back to a link out
// to the source page on England Football Learning only when no stored file is
// available: a stored file always wins. Images and PDFs never open here; they
// keep their existing open behaviour. The module pairs the player components
// with the videoDisplayMode helper they share with the tests, so the fast
// refresh component-only rule is relaxed here.
/* eslint-disable react-refresh/only-export-components */
import type { MediaItem } from '../lib/data'
import { embedSrc, youtubeId } from '../lib/data'
import { isFaVideo } from '../lib/fa'
import { useMediaSrc } from '../lib/queries'
import { Icon } from './icons'
import { MediaThumb, MEDIA_META, Modal } from './ui'

const FILL = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  background: '#0a0e1a',
} as const

// Determine which display mode to use for a media item. Precedence:
// a stored file beats an FA link out, which beats an allowlisted embed.
export function videoDisplayMode(
  item: Pick<MediaItem, 'type' | 'storagePath' | 'embedUrl' | 'sourceUrl' | 'yt'>,
): 'file' | 'fa-link' | 'embed' | 'youtube' | 'thumb' {
  if (item.type === 'video' && item.storagePath) return 'file'
  if (isFaVideo(item)) return 'fa-link'
  if (embedSrc(item.embedUrl)) return 'embed'
  if (item.type === 'youtube' && youtubeId(item.yt)) return 'youtube'
  return 'thumb'
}

// The 16/9 player surface alone, sized by a surrounding .player box. Shared
// by the player overlay and the media library preview modal.
export function MediaPlayerSurface({ item }: { item: MediaItem }) {
  const mode = videoDisplayMode(item)
  // A stored file always wins: pass its path to the signed URL hook regardless
  // of whether the row also carries an embed URL or an FA source URL.
  const filePath = mode === 'file' ? item.storagePath : undefined
  // A playback error on an expired URL retries once on a fresh URL before
  // falling back to the thumb with a plain could not load label.
  const { src: signedUrl, isLoading, broken, onError, onLoad } = useMediaSrc(filePath)
  const ytId = mode === 'youtube' ? youtubeId(item.yt) : null

  // Stored file: always the first choice. Checked before FA and embed sources.
  if (mode === 'file') {
    if (signedUrl) {
      return (
        <video
          src={signedUrl}
          controls
          playsInline
          preload="metadata"
          style={FILL}
          onError={onError}
          onLoadedMetadata={onLoad}
        />
      )
    }
    if (isLoading) {
      return (
        <div className="thumb thumb-diagram" style={{ position: 'absolute', inset: 0 }}>
          <span className="thumb-label">loading…</span>
        </div>
      )
    }
    if (broken) {
      return <MediaThumb media={item} showPlay={false} label="could not load this video" />
    }
    // Waiting for the query to settle: hold in loading state.
    return (
      <div className="thumb thumb-diagram" style={{ position: 'absolute', inset: 0 }}>
        <span className="thumb-label">loading…</span>
      </div>
    )
  }

  // FA domain locked: link out as fallback when no stored file is present.
  if (mode === 'fa-link' && item.sourceUrl) {
    return (
      <div
        style={{
          ...FILL,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: '0 22px',
          textAlign: 'center',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,.85)', fontSize: 13.5, lineHeight: 1.5 }}>
          This FA video plays on the England Football Learning site.
        </span>
        <a
          className="btn btn-gold"
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          style={{ whiteSpace: 'normal', height: 'auto', minHeight: 42, padding: '10px 16px' }}
        >
          <Icon.external />
          Watch on England Football Learning
        </a>
      </div>
    )
  }

  // Non-FA allowlisted embed: sandboxed iframe.
  if (mode === 'embed') {
    return (
      <iframe
        src={embedSrc(item.embedUrl)!}
        title={item.name}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ ...FILL, border: 0 }}
      />
    )
  }

  if (ytId) {
    return (
      <iframe
        src={'https://www.youtube-nocookie.com/embed/' + ytId}
        title={item.name}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ ...FILL, border: 0 }}
      />
    )
  }

  return <MediaThumb media={item} showPlay={false} />
}

export function MediaPlayerModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  return (
    <Modal
      title={item.name}
      sub={MEDIA_META[item.type].label}
      onClose={onClose}
      wide
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="detail-media">
        <div className="player">
          <MediaPlayerSurface item={item} />
        </div>
      </div>
      {item.type === 'youtube' && item.yt && (
        <div style={{ marginTop: 12 }}>
          <a className="btn btn-quiet btn-sm" href={item.yt} target="_blank" rel="noreferrer">
            <Icon.youtube />
            Open on YouTube
          </a>
        </div>
      )}
    </Modal>
  )
}
