// Inline playback for the two video media types. Uploaded clips play in an
// HTML5 element on the same signed URL the cards use; playsinline keeps iOS
// from hijacking playback into the native fullscreen player. YouTube items
// render the privacy-enhanced nocookie embed, with a small link out kept for
// anyone who wants the app or channel context. Images and PDFs never open
// here; they keep their existing open behaviour.
import type { MediaItem } from '../lib/data'
import { youtubeId } from '../lib/data'
import { useSignedMediaUrl } from '../lib/queries'
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
  const filePath = item.type === 'video' ? item.storagePath : undefined
  const { data: signedUrl, isLoading } = useSignedMediaUrl(filePath)
  const ytId = item.type === 'youtube' ? youtubeId(item.yt) : null

  if (item.type === 'video' && signedUrl) {
    return <video src={signedUrl} controls playsInline preload="metadata" style={FILL} />
  }
  if (item.type === 'video' && isLoading) {
    return (
      <div className="thumb thumb-diagram" style={{ position: 'absolute', inset: 0 }}>
        <span className="thumb-label">loading…</span>
      </div>
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
