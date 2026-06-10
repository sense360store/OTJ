import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useActivityTitle, usePerm, useTemplates, useDrillMap } from '../lib/queries'
import type { Activity, Session, Template } from '../lib/data'
import { useRoleScope } from '../lib/roleFilters'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, LockedTagChips, Modal, PHASE_COLOR } from '../components/ui'
import { AddDrillModal } from '../components/AddDrillModal'
import { ImportFAModal } from '../components/ImportFAModal'

type Nav = ReturnType<typeof useNav>
type Upsert = (s: Session) => void

function TemplateCard({
  t,
  nav,
  upsertSession,
  onManage,
}: {
  t: Template
  nav: Nav
  upsertSession: Upsert
  onManage: ((t: Template) => void) | null
}) {
  const { user, profile } = useAuth()
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0)
  // Using a template creates a session, so the affordance follows
  // sessions.create; read-only roles get a read-only card. The session built
  // from a template belongs to the signed-in coach and defaults to their
  // team, the same as one built in the planner. The template's intentions
  // copy onto the new session.
  const coaching = usePerm('sessions.create')
  const use = () => {
    const s: Session = {
      id: crypto.randomUUID(),
      name: t.name,
      date: '2026-06-16',
      time: '17:30',
      ageGroup: 'U8s',
      venue: 'Springmill 3G',
      focus: t.focus,
      status: 'upcoming',
      activities: JSON.parse(JSON.stringify(t.activities)) as Activity[],
      coachId: user?.id ?? '',
      teamId: profile?.team_id ?? null,
      intentions: [...t.intentions],
      space: '',
      sourceUrl: '',
      sourceLabel: '',
      liveActivityIndex: null,
      liveActivityStartedAt: null,
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
      <div className="row wrap" style={{ gap: 7 }}>
        {t.week != null && (
          <span className="pill">
            <Icon.calendar />
            Week {t.week}
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
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={use}>
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

// Templates with a programme group under it, ordered by week (templates
// without a week sort after those with one). Programmes themselves list
// alphabetically; everything without a programme stays in the plain grid.
function groupByProgramme(list: Template[]): { groups: { name: string; items: Template[] }[]; rest: Template[] } {
  const byName = new Map<string, Template[]>()
  const rest: Template[] = []
  for (const t of list) {
    if (!t.programme) {
      rest.push(t)
      continue
    }
    const items = byName.get(t.programme) ?? []
    items.push(t)
    byName.set(t.programme, items)
  }
  const groups = [...byName.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({
      name,
      items: [...items].sort(
        (a, b) => (a.week ?? Infinity) - (b.week ?? Infinity) || a.name.localeCompare(b.name),
      ),
    }))
  return { groups, rest }
}

export function Templates() {
  const nav = useNav()
  const { upsertSession } = useSessions()
  const [q, setQ] = useState('')
  const [manage, setManage] = useState<Template | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { data: templates = [], isLoading, isError } = useTemplates()
  // A role with filter tags sees templates locked to those referencing
  // matching drills, the tags shown as fixed chips below.
  const scope = useRoleScope()
  // Curating is the templates.manage capability, importing is import.fa, and
  // creating one is templates.create. The templates RLS enforces the writes;
  // these only decide what to surface.
  const curator = usePerm('templates.manage')
  const canImport = usePerm('import.fa')
  const canCreate = usePerm('templates.create')
  if (isLoading || !scope.ready) return <Loading />
  if (isError) return <ErrorNote />
  const list = scope.templates(templates).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
  const { groups, rest } = groupByProgramme(list)
  const grid = (items: Template[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 18 }}>
      {items.map((t) => (
        <TemplateCard key={t.id} t={t} nav={nav} upsertSession={upsertSession} onManage={curator ? setManage : null} />
      ))}
    </div>
  )
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Session Templates</h2>
          <div className="sub">Reusable session shells — build a new plan in one click.</div>
        </div>
        <div className="row wrap">
          {canImport && (
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <Icon.download />
              Import from England Football
            </button>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={() => nav('planner')}>
              <Icon.plus />
              New template
            </button>
          )}
        </div>
      </div>
      {scope.locked && (
        <div style={{ marginBottom: 8 }}>
          <LockedTagChips tags={scope.tags} />
        </div>
      )}
      <div className="search-lg" style={{ maxWidth: 460, marginBottom: 20 }}>
        <Icon.search />
        <input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 26 }}>
          <div className="section-title">
            <Icon.book />
            <h3>{g.name}</h3>
          </div>
          {grid(g.items)}
        </div>
      ))}
      {groups.length > 0 && rest.length > 0 && (
        <div className="section-title">
          <Icon.layers />
          <h3>Other templates</h3>
        </div>
      )}
      {grid(rest)}
      {manage && <ManageTemplateModal tpl={manage} onClose={() => setManage(null)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}
