import { useMemo, useRef, useState } from 'react'
import {
  useMedia,
  useDrills,
  useSignedMediaUrl,
  useUploadMedia,
  useDeleteMedia,
  usePerm,
  detectMediaType,
} from '../lib/queries'
import type { MediaItem, MediaType } from '../lib/data'
import { youtubeId } from '../lib/data'
import { useAuth } from '../hooks/useAuth'
import { useRoleScope } from '../lib/roleFilters'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, LockedTagChips, MediaAttribution, MediaThumb, MEDIA_META, Modal } from '../components/ui'
import { MediaPlayerModal, MediaPlayerSurface } from '../components/MediaPlayerModal'

function usedLabel(used: number): string {
  return used > 0 ? `Used in ${used} drill${used !== 1 ? 's' : ''}` : 'Not in use'
}

function MediaCard({
  m,
  onOpen,
  onPlay,
  onDelete,
}: {
  m: MediaItem
  onOpen: () => void
  onPlay: (() => void) | null
  onDelete: (() => void) | null
}) {
  const used = m.usedIn ?? 0
  const thumb = (
    <MediaThumb media={m} label={m.kind === 'pdf' ? 'session card' : m.kind === 'diagram' ? 'drill diagram' : 'pitch footage'} />
  )
  return (
    <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {onPlay ? (
        <button
          onClick={onPlay}
          aria-label={'Play ' + m.name}
          style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
        >
          {thumb}
        </button>
      ) : (
        thumb
      )}
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {m.size || (m.yt ? 'YouTube link' : '')}
            {m.dims ? ' · ' + m.dims : ''}
            {m.pages ? ' · ' + m.pages + ' pages' : ''}
            {m.length ? ' · ' + m.length : ''}
          </div>
        </div>
        <span className="pill" style={{ alignSelf: 'flex-start' }}>
          {usedLabel(used)}
        </span>
        <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onOpen}>
            <Icon.external />
            View
          </button>
          {onDelete && (
            <button
              className="btn btn-ghost btn-sm icon-only"
              style={{ width: 38, padding: 0 }}
              aria-label="Delete media"
              onClick={onDelete}
            >
              <Icon.trash />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// The open or preview modal. Images render inline from a signed URL, both
// video types play inline through the shared player surface, and PDFs stay a
// thumb with a link out.
function MediaModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const filePath = item.type === 'image' || item.type === 'pdf' ? item.storagePath : undefined
  const { data: signedUrl, isLoading } = useSignedMediaUrl(filePath)
  const openHref = item.type === 'youtube' ? item.yt ?? undefined : item.type === 'video' ? undefined : signedUrl ?? undefined

  return (
    <Modal
      title={item.name}
      sub={MEDIA_META[item.type].label}
      onClose={onClose}
      footer={
        <>
          {openHref && (
            <a className="btn btn-ghost" href={openHref} target="_blank" rel="noreferrer">
              <Icon.external />
              {item.type === 'pdf' ? 'Open in new tab' : item.type === 'youtube' ? 'Open on YouTube' : 'Open'}
            </a>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="detail-media">
        <div className="player">
          {item.type === 'video' || item.type === 'youtube' ? (
            <MediaPlayerSurface item={item} />
          ) : item.type === 'image' && signedUrl ? (
            <img src={signedUrl} alt={item.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#0a0e1a' }} />
          ) : item.storagePath && isLoading ? (
            <div className="thumb thumb-diagram" style={{ position: 'absolute', inset: 0 }}>
              <span className="thumb-label">loading…</span>
            </div>
          ) : (
            <MediaThumb media={item} showPlay={false} />
          )}
        </div>
      </div>
      <MediaAttribution media={item} style={{ display: 'block', marginTop: 8 }} />
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        {item.size && <span className="pill">{item.size}</span>}
        {item.dims && <span className="pill">{item.dims}</span>}
        {item.length && (
          <span className="pill">
            <Icon.clock />
            {item.length}
          </span>
        )}
        {item.pages && (
          <span className="pill">
            <Icon.fileText />
            {item.pages} pages
          </span>
        )}
        {item.type === 'youtube' && item.yt && <span className="pill">YouTube link</span>}
        <span className="pill">{usedLabel(item.usedIn ?? 0)}</span>
      </div>
    </Modal>
  )
}

function DeleteModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const del = useDeleteMedia()
  const used = item.usedIn ?? 0
  const remove = () => {
    del.mutate(
      { id: item.id, storagePath: item.storagePath },
      { onSuccess: onClose },
    )
  }
  return (
    <Modal
      title="Delete media"
      sub={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the file from storage and the library. {usedLabel(used)}
        {used > 0 ? '. Those drills fall back to no media.' : '.'}
      </p>
      {del.isError && <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>Could not delete. Try again.</p>}
    </Modal>
  )
}

// Exported for the Home quick actions, which open the same upload flow.
export function UploadModal({ onClose }: { onClose: () => void }) {
  const upload = useUploadMedia()
  const [tab, setTab] = useState<'file' | 'youtube'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [yt, setYt] = useState('')
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pickFile = (f: File | null) => {
    setError(null)
    if (!f) return
    if (!detectMediaType(f.type)) {
      setFile(null)
      setError('Unsupported file type. Upload an image, video or PDF.')
      return
    }
    setFile(f)
    if (!name) setName(f.name)
  }

  const canSubmit = tab === 'file' ? !!file && !!name.trim() : !!youtubeId(yt) && !!name.trim()

  const submit = () => {
    setError(null)
    if (tab === 'file') {
      if (!file) return
      upload.mutate({ mode: 'file', file, name: name.trim() }, { onSuccess: onClose, onError: (e) => setError(e.message) })
    } else {
      if (!youtubeId(yt)) {
        setError('Enter a valid YouTube link.')
        return
      }
      upload.mutate({ mode: 'youtube', ytUrl: yt.trim(), name: name.trim() }, { onSuccess: onClose, onError: (e) => setError(e.message) })
    }
  }

  return (
    <Modal
      title="Upload media"
      sub="Add a video, image or PDF, or link a YouTube video."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit || upload.isPending}>
            <Icon.upload />
            {upload.isPending ? 'Uploading…' : tab === 'file' ? 'Upload' : 'Add link'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button className={'chip' + (tab === 'file' ? ' on' : '')} onClick={() => { setTab('file'); setError(null) }}>
          <Icon.upload />
          File
        </button>
        <button className={'chip' + (tab === 'youtube' ? ' on' : '')} onClick={() => { setTab('youtube'); setError(null) }}>
          <Icon.youtube />
          YouTube
        </button>
      </div>

      {tab === 'file' ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            pickFile(e.dataTransfer.files?.[0] ?? null)
          }}
          style={{
            border: '1.5px dashed ' + (drag ? 'var(--royal)' : 'var(--line)'),
            borderRadius: 12,
            padding: '28px 16px',
            textAlign: 'center',
            cursor: 'pointer',
            background: drag ? 'var(--bg-2)' : 'transparent',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*,image/svg+xml,.svg,video/*,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <Icon.upload style={{ width: 26, height: 26, color: 'var(--slate-2)' }} />
          <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>
            {file ? file.name : 'Drop a file or click to choose'}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Images (SVG included), videos and PDFs</div>
        </div>
      ) : (
        <div className="field">
          <label>YouTube link</label>
          <input
            placeholder="https://www.youtube.com/watch?v=…"
            value={yt}
            onChange={(e) => { setYt(e.target.value); setError(null) }}
          />
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Display name</label>
        <input placeholder="Name shown in the library" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {error && <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 4 }}>{error}</p>}
    </Modal>
  )
}

export function Media() {
  const { user } = useAuth()
  // Each affordance asks for its own capability; the media RLS is the real
  // enforcement.
  const canUpload = usePerm('media.create')
  const canManageAny = usePerm('media.manage_any')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [open, setOpen] = useState<MediaItem | null>(null)
  const [playing, setPlaying] = useState<MediaItem | null>(null)
  const [del, setDel] = useState<MediaItem | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const { data: mediaItems = [], isLoading, isError } = useMedia()
  const { data: drills = [] } = useDrills()
  // A role with filter tags sees the media library locked to items used by
  // matching drills, the tags shown as fixed chips below.
  const scope = useRoleScope()
  // "Used in N drills" is derived, not stored: count drills referencing each item.
  const media = useMemo(() => {
    const usage: Record<string, number> = {}
    drills.forEach((d) => {
      if (d.mediaId) usage[d.mediaId] = (usage[d.mediaId] || 0) + 1
    })
    return scope.media(mediaItems).map((m) => ({ ...m, usedIn: usage[m.id] ?? 0 }))
  }, [mediaItems, drills, scope])
  if (isLoading || !scope.ready) return <Loading />
  if (isError) return <ErrorNote />
  const list = media.filter((m) => (!type || m.type === type) && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  const counts: Record<MediaType, number> = { video: 0, youtube: 0, image: 0, pdf: 0 }
  media.forEach((m) => counts[m.type]++)
  // Delete is the owner while they can still create media, or a media
  // manager, mirroring the media RLS. The database is the real enforcement;
  // this only decides whether to surface the action.
  const canDelete = (m: MediaItem) => canManageAny || (canUpload && !!m.createdBy && m.createdBy === user?.id)
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Media Library</h2>
          <div className="sub">All your videos, YouTube links, diagrams and PDFs in one place.</div>
        </div>
        {canUpload && (
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            <Icon.upload />
            Upload media
          </button>
        )}
      </div>

      {scope.locked && (
        <div style={{ marginBottom: 8 }}>
          <LockedTagChips tags={scope.tags} />
        </div>
      )}
      <div className="filter-row" style={{ marginBottom: 16 }}>
        <div className="search-lg">
          <Icon.search />
          <input placeholder="Search by filename…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="video">Videos</option>
          <option value="youtube">YouTube</option>
          <option value="image">Images</option>
          <option value="pdf">PDFs</option>
        </select>
      </div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
        <span className="muted" style={{ fontSize: 13.5, fontWeight: 700 }}>
          Total: {media.length}
        </span>
        {(Object.entries(counts) as [MediaType, number][]).map(([k, v]) => {
          const MIcon = MEDIA_META[k].icon
          return (
            <span key={k} className="pill" style={{ color: MEDIA_META[k].color }}>
              <MIcon /> {MEDIA_META[k].label}: {v}
            </span>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 18 }}>
        {list.map((m) => (
          <MediaCard
            key={m.id}
            m={m}
            onOpen={() => setOpen(m)}
            onPlay={m.type === 'video' || m.type === 'youtube' ? () => setPlaying(m) : null}
            onDelete={canDelete(m) ? () => setDel(m) : null}
          />
        ))}
      </div>

      {open && <MediaModal item={open} onClose={() => setOpen(null)} />}
      {playing && <MediaPlayerModal item={playing} onClose={() => setPlaying(null)} />}
      {del && <DeleteModal item={del} onClose={() => setDel(null)} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </div>
  )
}
