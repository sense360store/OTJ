import { useState } from 'react'
import { Loading, Modal, MediaThumb } from './ui'
import { Icon } from './icons'
import { useDrills, useMediaMap } from '../lib/queries'
import type { Activity, CornerKey } from '../lib/data'

export function AddDrillModal({ onClose, onAdd }: { onClose: () => void; onAdd: (items: Activity[]) => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const { data: drills = [], isLoading } = useDrills()
  const mediaById = useMediaMap()
  const list = drills.filter((d) => !q || (d.title + d.skill + d.tags.join(' ')).toLowerCase().includes(q.toLowerCase()))
  const count = Object.values(picked).filter(Boolean).length
  const phaseFor = (corner: CornerKey | null): Activity['phase'] =>
    corner === 'physical' ? 'Warm-Up' : corner === 'social' ? 'Game' : 'Skill'
  const confirm = () => {
    const items: Activity[] = drills
      .filter((d) => picked[d.id])
      .map((d) => ({ phase: phaseFor(d.corner), drillId: d.id, duration: d.duration }))
    onAdd(items)
  }
  return (
    <Modal
      title="Add from library"
      sub="Select drills to drop into your session"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!count} onClick={confirm}>
            <Icon.plus />
            Add {count || ''} drill{count !== 1 ? 's' : ''}
          </button>
        </>
      }
    >
      <div className="search-lg" style={{ marginBottom: 16 }}>
        <Icon.search />
        <input placeholder="Search drills…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {list.map((d) => {
          const media = d.mediaId ? mediaById[d.mediaId] : undefined
          const on = !!picked[d.id]
          return (
            <button
              key={d.id}
              onClick={() => setPicked((p) => ({ ...p, [d.id]: !p[d.id] }))}
              style={{
                display: 'flex',
                gap: 11,
                alignItems: 'center',
                textAlign: 'left',
                padding: 9,
                borderRadius: 12,
                border: '1.5px solid ' + (on ? 'var(--navy)' : 'var(--line)'),
                background: on ? 'color-mix(in srgb, var(--navy) 5%, var(--card))' : 'var(--card)',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: 58, height: 40, borderRadius: 8, overflow: 'hidden', flex: '0 0 58px' }}>
                <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.title}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {d.skill} · {d.duration}m
                </div>
              </div>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  flex: '0 0 22px',
                  display: 'grid',
                  placeItems: 'center',
                  background: on ? 'var(--navy)' : 'transparent',
                  border: '1.5px solid ' + (on ? 'var(--navy)' : 'var(--line)'),
                  color: '#fff',
                }}
              >
                {on && <Icon.check style={{ width: 14, height: 14 }} />}
              </span>
            </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
