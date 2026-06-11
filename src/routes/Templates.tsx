import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useStartFromTemplate } from '../hooks/useStartFromTemplate'
import { useActivityTitle, useProgrammes, useTemplates, useDrillMap } from '../lib/queries'
import type { Activity, Template } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal, PHASE_COLOR } from '../components/ui'
import { AddDrillModal } from '../components/AddDrillModal'
import { ImportFAModal } from '../components/ImportFAModal'

function TemplateCard({ t, onManage }: { t: Template; onManage: ((t: Template) => void) | null }) {
  const { role } = useAuth()
  const startFromTemplate = useStartFromTemplate()
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0)
  // Using a template creates a session, which parents cannot do; for them the
  // card is read-only. The session built from a template belongs to the
  // signed-in coach and defaults to their team, the same as one built in the
  // planner. The template's intentions copy onto the new session.
  const coaching = role === 'coach' || role === 'admin'
  const week = t.programmeWeek ?? t.week
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
      <div className="row wrap" style={{ gap: 7 }}>
        {week != null && (
          <span className="pill">
            <Icon.calendar />
            Week {week}
          </span>
        )}
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
      {(coaching || onManage) && (
        <div className="row" style={{ gap: 9 }}>
          {coaching && (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => startFromTemplate(t)}>
              <Icon.copy />
              Use template
            </button>
          )}
          {onManage && (
            <button className="btn btn-ghost btn-sm" onClick={() => onManage(t)}>
              <Icon.book />
              Drills
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ManageTemplateModal({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const [acts, setActs] = useState<Activity[]>(() => JSON.parse(JSON.stringify(tpl.activities)) as Activity[])
  const [adding, setAdding] = useState(false)
  const drillById = useDrillMap()
  const actTitle = useActivityTitle()
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
                <h4>{actTitle(a)}</h4>
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
  const { role } = useAuth()
  const [q, setQ] = useState('')
  const [manage, setManage] = useState<Template | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { data: templates = [], isLoading, isError } = useTemplates()
  const { data: programmes = [] } = useProgrammes()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // Programme weeks live on the Programmes screen now; this grid keeps the
  // standalone shells. The banner below replaces the old programme grouping
  // and links across.
  const standalone = templates.filter((t) => t.programmeId == null)
  const list = standalone.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
  const inProgrammes = templates.length - standalone.length
  // Curating templates is admin only per the permissions matrix; every coach
  // can still use one, and every coaching role can import from England
  // Football. Parents read only. The templates RLS enforces the writes.
  const curator = role === 'admin'
  const coaching = role === 'coach' || role === 'admin'
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Session Templates</h2>
          <div className="sub">Reusable session shells — build a new plan in one click.</div>
        </div>
        <div className="row wrap">
          {coaching && (
            <button className="btn btn-ghost" onClick={() => nav('englandFootball')}>
              <Icon.grid />
              Browse England Football
            </button>
          )}
          {coaching && (
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <Icon.download />
              Import from England Football
            </button>
          )}
          {curator && (
            <button className="btn btn-primary" onClick={() => nav('planner')}>
              <Icon.plus />
              New template
            </button>
          )}
        </div>
      </div>
      {programmes.length > 0 && (
        <button
          className="card row"
          onClick={() => nav('programmes')}
          style={{ width: '100%', textAlign: 'left', gap: 12, padding: '14px 16px', marginBottom: 18, cursor: 'pointer', minHeight: 44 }}
        >
          <Icon.list style={{ width: 20, height: 20, color: 'var(--royal)', flex: '0 0 20px' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 14.5, display: 'block' }}>Programmes</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {programmes.length} programme{programmes.length !== 1 ? 's' : ''} · {inProgrammes} week template
              {inProgrammes !== 1 ? 's' : ''} now live under Plan
            </span>
          </span>
          <Icon.chevR style={{ width: 18, height: 18, color: 'var(--slate-2)', flex: '0 0 18px' }} />
        </button>
      )}
      <div className="search-lg" style={{ maxWidth: 460, marginBottom: 20 }}>
        <Icon.search />
        <input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 18 }}>
        {list.map((t) => (
          <TemplateCard key={t.id} t={t} onManage={curator ? setManage : null} />
        ))}
      </div>
      {manage && <ManageTemplateModal tpl={manage} onClose={() => setManage(null)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}
