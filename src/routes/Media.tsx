import { useMemo, useRef, useState } from 'react'
import {
  useMedia,
  useDrills,
  useMediaSrc,
  useUploadMedia,
  useReplaceMedia,
  useDeleteMedia,
  useRemoveSampleMedia,
  mediaTypeForFile,
  oversizeMessage,
} from '../lib/queries'
import type { UploadInput } from '../lib/queries'
import type { Drill, MediaItem, MediaType } from '../lib/data'
import { isSampleMedia, youtubeId } from '../lib/data'
import { useAuth } from '../hooks/useAuth'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, MediaAttribution, MediaThumb, MEDIA_META, Modal } from '../components/ui'
import { MediaPlayerModal, MediaPlayerSurface } from '../components/MediaPlayerModal'

function usedLabel(used: number): string {
  return used > 0 ? `Used in ${used} drill${used !== 1 ? 's' : ''}` : 'Not in use'
}

function MediaCard({
  m,
  onOpen,
  onPlay,
  onDelete,
  onReplace,
}: {
  m: MediaItem
  onOpen: () => void
  onPlay: (() => void) | null
  onDelete: (() => void) | null
  onReplace: (() => void) | null
}) {
  const used = m.usedIn ?? 0
  // A sample has nothing to view or play: it is badged plainly, its View
  // button goes, and Replace (owner or admin) attaches real content to it.
  const sample = isSampleMedia(m)
  const thumb = (
    <MediaThumb
      media={m}
      label={sample ? 'sample' : m.kind === 'pdf' ? 'session card' : m.kind === 'diagram' ? 'drill diagram' : 'pitch footage'}
    />
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
        <div className="row wrap" style={{ gap: 6 }}>
          {sample && (
            <span className="pill" style={{ color: 'var(--slate-2)' }}>
              Sample, no file attached
            </span>
          )}
          <span className="pill">{usedLabel(used)}</span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
          {sample ? (
            onReplace ? (
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onReplace}>
                <Icon.upload />
                Replace
              </button>
            ) : (
              <span className="muted" style={{ flex: 1, alignSelf: 'center', fontSize: 12.5 }}>
                Nothing to view
              </span>
            )
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onOpen}>
              <Icon.external />
              View
            </button>
          )}
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
  // A load error on an expired URL retries once on a fresh URL before the
  // thumb fallback shows.
  const { src: signedUrl, isLoading, onError, onLoad } = useMediaSrc(filePath)
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
            <img
              src={signedUrl}
              alt={item.name}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#0a0e1a' }}
              onError={onError}
              onLoad={onLoad}
            />
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

// Admin one-click cleanup: deletes every sample row after a confirm that
// names the drills about to lose their linked media.
function RemoveSamplesModal({ samples, drills, onClose }: { samples: MediaItem[]; drills: Drill[]; onClose: () => void }) {
  const removeSamples = useRemoveSampleMedia()
  const sampleIds = new Set(samples.map((m) => m.id))
  const affected = drills.filter((d) => d.mediaId && sampleIds.has(d.mediaId))
  const remove = () => removeSamples.mutate({ ids: samples.map((m) => m.id) }, { onSuccess: onClose })
  return (
    <Modal
      title="Remove all samples"
      sub={`${samples.length} sample item${samples.length !== 1 ? 's' : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={removeSamples.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={removeSamples.isPending}
          >
            <Icon.trash />
            {removeSamples.isPending ? 'Removing…' : 'Remove samples'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This deletes every sample from the library. Samples have no stored files, so storage is untouched.{' '}
        {affected.length === 0
          ? 'No drills link a sample.'
          : affected.length === 1
            ? 'This drill loses its linked sample and falls back to no media:'
            : `These ${affected.length} drills lose their linked samples and fall back to no media:`}
      </p>
      {affected.length > 0 && (
        <ul style={{ margin: '10px 0 0 18px', fontSize: 14, lineHeight: 1.6 }}>
          {affected.map((d) => (
            <li key={d.id}>{d.title}</li>
          ))}
        </ul>
      )}
      {removeSamples.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 10 }}>
          {removeSamples.error.message}
        </p>
      )}
    </Modal>
  )
}

// One modal for two flows: a plain upload creates a new row; with a replace
// target it points that existing row (a sample) at the new file or link, so
// drills that reference it keep working. Failures never close the modal: the
// underlying error text shows beneath the form, which stays intact.
function UploadModal({ replace, onClose }: { replace?: MediaItem; onClose: () => void }) {
  const upload = useUploadMedia()
  const replaceMedia = useReplaceMedia()
  const isPending = replace ? replaceMedia.isPending : upload.isPending
  const [tab, setTab] = useState<'file' | 'youtube'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState(replace?.name ?? '')
  const [yt, setYt] = useState('')
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pickFile = (f: File | null) => {
    setError(null)
    if (!f) return
    // Type and size checked at pick time so the failure is immediate; the
    // mutation re-checks both before any bytes move.
    if (!mediaTypeForFile(f)) {
      setFile(null)
      setError('Unsupported file type. Upload an image, video or PDF.')
      return
    }
    const tooBig = oversizeMessage(f)
    if (tooBig) {
      setFile(null)
      setError(tooBig)
      return
    }
    setFile(f)
    if (!name) setName(f.name)
  }

  const canSubmit = tab === 'file' ? !!file && !!name.trim() : !!youtubeId(yt) && !!name.trim()

  const submit = () => {
    setError(null)
    const callbacks = { onSuccess: onClose, onError: (e: Error) => setError(e.message) }
    let input: UploadInput
    if (tab === 'file') {
      if (!file) return
      input = { mode: 'file', file, name: name.trim() }
    } else {
      if (!youtubeId(yt)) {
        setError('Enter a valid YouTube link.')
        return
      }
      input = { mode: 'youtube', ytUrl: yt.trim(), name: name.trim() }
    }
    if (replace) replaceMedia.mutate({ id: replace.id, previousPath: replace.storagePath, input }, callbacks)
    else upload.mutate(input, callbacks)
  }

  return (
    <Modal
      title={replace ? 'Replace sample' : 'Upload media'}
      sub={
        replace
          ? `Attach a real file or YouTube link to "${replace.name}". Drills that use it keep working.`
          : 'Add a video, image or PDF, or link a YouTube video.'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit || isPending}>
            <Icon.upload />
            {isPending ? (tab === 'file' ? 'Uploading…' : 'Saving…') : replace ? 'Replace' : tab === 'file' ? 'Upload' : 'Add link'}
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
  const { user, role } = useAuth()
  // Uploading is for coaching roles; parents browse read-only. The media
  // insert RLS is the real enforcement.
  const coaching = role === 'coach' || role === 'admin'
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [open, setOpen] = useState<MediaItem | null>(null)
  const [playing, setPlaying] = useState<MediaItem | null>(null)
  const [del, setDel] = useState<MediaItem | null>(null)
  const [replacing, setReplacing] = useState<MediaItem | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [removeSamplesOpen, setRemoveSamplesOpen] = useState(false)
  const { data: mediaItems = [], isLoading, isError } = useMedia()
  const { data: drills = [] } = useDrills()
  // "Used in N drills" is derived, not stored: count drills referencing each item.
  const media = useMemo(() => {
    const usage: Record<string, number> = {}
    drills.forEach((d) => {
      if (d.mediaId) usage[d.mediaId] = (usage[d.mediaId] || 0) + 1
    })
    return mediaItems.map((m) => ({ ...m, usedIn: usage[m.id] ?? 0 }))
  }, [mediaItems, drills])
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  const list = media.filter((m) => (!type || m.type === type) && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  const counts: Record<MediaType, number> = { video: 0, youtube: 0, image: 0, pdf: 0 }
  media.forEach((m) => counts[m.type]++)
  const samples = media.filter(isSampleMedia)
  // Replace and delete are owner or admin only, mirroring the media RLS. The
  // database is the real enforcement; this only decides whether to surface
  // the actions.
  const canManage = (m: MediaItem) => role === 'admin' || (!!m.createdBy && m.createdBy === user?.id)
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Media Library</h2>
          <div className="sub">All your videos, YouTube links, diagrams and PDFs in one place.</div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          {role === 'admin' && samples.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setRemoveSamplesOpen(true)}>
              <Icon.trash />
              Remove all samples
            </button>
          )}
          {coaching && (
            <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              <Icon.upload />
              Upload media
            </button>
          )}
        </div>
      </div>

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
            onPlay={!isSampleMedia(m) && (m.type === 'video' || m.type === 'youtube') ? () => setPlaying(m) : null}
            onDelete={canManage(m) ? () => setDel(m) : null}
            onReplace={canManage(m) ? () => setReplacing(m) : null}
          />
        ))}
      </div>

      {open && <MediaModal item={open} onClose={() => setOpen(null)} />}
      {playing && <MediaPlayerModal item={playing} onClose={() => setPlaying(null)} />}
      {del && <DeleteModal item={del} onClose={() => setDel(null)} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
      {replacing && <UploadModal replace={replacing} onClose={() => setReplacing(null)} />}
      {removeSamplesOpen && (
        <RemoveSamplesModal samples={samples} drills={drills} onClose={() => setRemoveSamplesOpen(false)} />
      )}
    </div>
  )
}
