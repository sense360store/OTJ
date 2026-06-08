import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { templates, drillById } from '../lib/data'
import type { Activity, Session, Template } from '../lib/data'
import { Icon } from '../components/icons'
import { Modal, PHASE_COLOR } from '../components/ui'
import { AddDrillModal } from '../components/AddDrillModal'

type Nav = ReturnType<typeof useNav>
type Upsert = (s: Session) => void

let T_SEQ = 200

function TemplateCard({
  t,
  nav,
  upsertSession,
  onManage,
}: {
  t: Template
  nav: Nav
  upsertSession: Upsert
  onManage: (t: Template) => void
}) {
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0)
  const use = () => {
    const s: Session = {
      id: 's' + T_SEQ++,
      name: t.name,
      date: '2026-06-16',
      time: '17:30',
      ageGroup: 'U8s',
      venue: 'Springmill 3G',
      focus: t.focus,
      status: 'upcoming',
      activities: JSON.parse(JSON.stringify(t.activities)) as Activity[],
    }
    upsertSession(s)
    nav('planner', { sessionId: s.id })
  }
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 20 }}>{t.name}</h3>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 3 }}>
          Created by {t.author}
        </div>
        <span className="tag corner-technical" style={{ marginTop: 9 }}>
          {t.focus}
        </span>
      </div>
      <div className="row" style={{ gap: 7 }}>
        <span className="pill">
          <Icon.list />
          {t.activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock />
          {mins} min
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
        {t.activities.map((a, i) => (
          <div key={i} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }} title={a.phase}></div>
        ))}
      </div>
      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={use}>
          <Icon.copy />
          Use template
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onManage(t)}>
          <Icon.book />
          Drills
        </button>
      </div>
    </div>
  )
}

function ManageTemplateModal({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const [acts, setActs] = useState<Activity[]>(() => JSON.parse(JSON.stringify(tpl.activities)) as Activity[])
  const [adding, setAdding] = useState(false)
  const mins = acts.reduce((a, x) => a + (x.duration || 0), 0)
  return (
    <Modal
      title={tpl.name}
      sub="Manage drills in this template"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          <Icon.check />
          Done
        </button>
      }
    >
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="role-badge" style={{ fontSize: 12 }}>
            {acts.length} activities
          </span>
          <span className="pill">
            <Icon.clock />
            {mins} min
          </span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          <Icon.plus />
          Add from Library
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {acts.map((a, i) => {
          const d = a.drillId ? drillById[a.drillId] : null
          return (
            <div key={i} className="act-card" style={{ marginBottom: 0 }}>
              <span className="act-grip">
                <Icon.grip />
              </span>
              <span className="tag-dot" style={{ background: PHASE_COLOR[a.phase], width: 10, height: 10 }}></span>
              <div className="ac-body">
                <h4>{d ? d.title : a.title}</h4>
                <div className="ac-sub">
                  <span>{a.phase}</span>
                  {d && <span>{d.skill}</span>}
                </div>
              </div>
              <span className="act-dur">{a.duration} min</span>
              <button className="act-x" onClick={() => setActs((x) => x.filter((_, j) => j !== i))}>
                <Icon.trash />
              </button>
            </div>
          )
        })}
      </div>
      {adding && (
        <AddDrillModal
          onClose={() => setAdding(false)}
          onAdd={(items) => {
            setActs((x) => [...x, ...items])
            setAdding(false)
          }}
        />
      )}
    </Modal>
  )
}

export function Templates() {
  const nav = useNav()
  const { upsertSession } = useSessions()
  const [q, setQ] = useState('')
  const [manage, setManage] = useState<Template | null>(null)
  const list = templates.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Session Templates</h2>
          <div className="sub">Reusable session shells — build a new plan in one click.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('planner')}>
          <Icon.plus />
          New template
        </button>
      </div>
      <div className="search-lg" style={{ maxWidth: 460, marginBottom: 20 }}>
        <Icon.search />
        <input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 18 }}>
        {list.map((t) => (
          <TemplateCard key={t.id} t={t} nav={nav} upsertSession={upsertSession} onManage={setManage} />
        ))}
      </div>
      {manage && <ManageTemplateModal tpl={manage} onClose={() => setManage(null)} />}
    </div>
  )
}
