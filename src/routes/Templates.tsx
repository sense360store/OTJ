import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useStartFromTemplate } from '../hooks/useStartFromTemplate'
import { useDeleteTemplate, useMyCapabilities, useProgrammes, useTemplates } from '../lib/queries'
import { FA_IMPORT_CAPS, hasAllCaps } from '../lib/data'
import type { Template } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal, PHASE_COLOR } from '../components/ui'
import { TemplateFormModal } from '../components/TemplateFormModal'
import { ImportFAModal } from '../components/ImportFAModal'

function TemplateCard({
  t,
  onEdit,
  onDelete,
}: {
  t: Template
  onEdit: ((t: Template) => void) | null
  onDelete: ((t: Template) => void) | null
}) {
  const { caps } = useMyCapabilities()
  const startFromTemplate = useStartFromTemplate()
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0)
  // Using a template creates a session, so it follows sessions.create; for
  // members without it the card is read-only. The session built from a
  // template belongs to the signed-in coach and defaults to their team, the
  // same as one built in the planner. The template's intentions copy onto
  // the new session.
  const coaching = caps.has('sessions.create')
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
      {(coaching || onEdit || onDelete) && (
        <div className="row" style={{ gap: 9 }}>
          {coaching && (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => startFromTemplate(t)}>
              <Icon.copy />
              Use template
            </button>
          )}
          {onEdit && (
            <button className="btn btn-ghost btn-sm" onClick={() => onEdit(t)}>
              <Icon.edit />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-ghost btn-sm icon-only"
              style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
              aria-label="Delete template"
              onClick={() => onDelete(t)}
            >
              <Icon.trash />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Plain confirm before a template delete. Sessions already built from the
// template copied its activities, so they keep their plans.
function DeleteTemplateModal({ t, onClose }: { t: Template; onClose: () => void }) {
  const del = useDeleteTemplate()
  const remove = () => del.mutate({ id: t.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Delete template"
      sub={t.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={remove} disabled={del.isPending}>
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the template from the club library. Sessions already built from it keep their plans, and the
        drills stay in the library.
        {t.programmeId != null ? ' It is a programme week, so that week goes back to having no template.' : ''}
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}

export function Templates() {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
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
  // Edit and delete mirror the templates RLS arms: templates.manage on any
  // template (curation), an owner holding templates.create on their own.
  // Templates without an owner (imports, anything from before ownership)
  // stay curation only. The FA import writes a template plus its drills and
  // media, so it needs every capability the call would use. The templates
  // RLS enforces the writes.
  const canCreate = caps.has('templates.create')
  const canImport = hasAllCaps(caps, FA_IMPORT_CAPS)
  const canManage = (t: Template) =>
    caps.has('templates.manage') || (canCreate && !!t.createdBy && t.createdBy === user?.id)
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
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
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
          <TemplateCard key={t.id} t={t} onEdit={canManage(t) ? setEditing : null} onDelete={canManage(t) ? setDeleting : null} />
        ))}
      </div>
      {creating && <TemplateFormModal onClose={() => setCreating(false)} />}
      {editing && <TemplateFormModal template={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteTemplateModal t={deleting} onClose={() => setDeleting(null)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}
