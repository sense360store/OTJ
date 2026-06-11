// Inline playback for the two video media types. Uploaded clips play in an
// HTML5 element on the same signed URL the cards use; playsinline keeps iOS
// from hijacking playback into the native fullscreen player. YouTube items
// render the privacy-enhanced nocookie embed, with a small link out kept for
// anyone who wants the app or channel context. FA sourced video is the
// exception: the FA domain locks its Vimeo player, so instead of an embed
// that cannot play here the surface offers a link out to the source page on
// England Football Learning. Images and PDFs never open here; they keep
// their existing open behaviour.
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

// The 16/9 player surface alone, sized by a surrounding .player box. Shared
// by the player overlay and the media library preview modal.
export function MediaPlayerSurface({ item }: { item: MediaItem }) {
  // A video that streams from an allowlisted player has an embed URL and no
  // stored file: render it in a sandboxed iframe. The host is checked here
  // too, so a bad embed_url never reaches the iframe. An FA sourced embed is
  // domain locked by the FA and never plays here, so it gets the link out
  // panel instead of the iframe.
  const fa = isFaVideo(item)
  const embed = embedSrc(item.embedUrl)
  const filePath = item.type === 'video' && !embed && !fa ? item.storagePath : undefined
  // A playback error on an expired URL retries once on a fresh URL before
  // falling back to the thumb with a plain could not load label.
  const { src: signedUrl, isLoading, broken, onError, onLoad } = useMediaSrc(filePath)
  const ytId = item.type === 'youtube' ? youtubeId(item.yt) : null

  if (fa && item.sourceUrl) {
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
  if (embed) {
    return (
      <iframe
        src={embed}
        title={item.name}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="autoplay; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ ...FILL, border: 0 }}
      />
    )
  }
  if (item.type === 'video' && signedUrl) {
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
  if (item.type === 'video' && isLoading) {
    return (
      <div className="thumb thumb-diagram" style={{ position: 'absolute', inset: 0 }}>
        <span className="thumb-label">loading…</span>
      </div>
    )
  }
  if (item.type === 'video' && broken) {
    return <MediaThumb media={item} showPlay={false} label="could not load this video" />
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
