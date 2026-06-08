import { useMemo, useState } from 'react'
import { useMedia, useDrills } from '../lib/queries'
import type { MediaItem, MediaType } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, MediaThumb, MEDIA_META, Modal } from '../components/ui'

function MediaCard({ m, onOpen }: { m: MediaItem; onOpen: () => void }) {
  const used = m.usedIn ?? 0
  return (
    <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <MediaThumb media={m} label={m.kind === 'pdf' ? 'session card' : m.kind === 'diagram' ? 'drill diagram' : 'pitch footage'} />
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
          {used > 0 ? `Used in ${used} drill${used !== 1 ? 's' : ''}` : 'Not in use'}
        </span>
        <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onOpen}>
            <Icon.external />
            View
          </button>
          <button className="btn btn-ghost btn-sm icon-only" style={{ width: 38, padding: 0 }}>
            <Icon.trash />
          </button>
        </div>
      </div>
    </div>
  )
}

export function Media() {
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [open, setOpen] = useState<MediaItem | null>(null)
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
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Media Library</h2>
          <div className="sub">All your videos, YouTube links, diagrams and PDFs in one place.</div>
        </div>
        <button className="btn btn-primary">
          <Icon.upload />
          Upload media
        </button>
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
          <MediaCard key={m.id} m={m} onOpen={() => setOpen(m)} />
        ))}
      </div>

      {open && (
        <Modal
          title={open.name}
          sub={MEDIA_META[open.type].label}
          onClose={() => setOpen(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setOpen(null)}>
              Close
            </button>
          }
        >
          <div className="detail-media">
            <div className="player">
              <MediaThumb media={open} />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
            {open.size && <span className="pill">{open.size}</span>}
            {open.dims && <span className="pill">{open.dims}</span>}
            {open.length && (
              <span className="pill">
                <Icon.clock />
                {open.length}
              </span>
            )}
            {open.pages && (
              <span className="pill">
                <Icon.fileText />
                {open.pages} pages
              </span>
            )}
            <span className="pill">{(open.usedIn ?? 0) > 0 ? `Used in ${open.usedIn} drill(s)` : 'Not in use'}</span>
          </div>
        </Modal>
      )}
    </div>
  )
}
