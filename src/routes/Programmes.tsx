// The club's programmes: ordered sets of weekly session templates, the FA
// six-week format being the model, built by importing an FA overview or by
// hand from the club's own templates. Visibility is club-wide; creating is
// for coaching roles and editing follows ownership (owner, or admin), all
// enforced by the programmes RLS. Parents read only: no create, import or
// edit affordances.
import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useProgrammes, useTemplates } from '../lib/queries'
import type { Programme } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading } from '../components/ui'
import { ProgrammeFormModal } from '../components/ProgrammeFormModal'
import { ImportProgrammeModal } from '../components/ImportProgrammeModal'

function ProgrammeCard({ p, templateCount, onOpen }: { p: Programme; templateCount: number; onOpen: () => void }) {
  return (
    <button
      className="card"
      onClick={onOpen}
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', cursor: 'pointer' }}
    >
      <div>
        <h3 style={{ fontSize: 20 }}>{p.name}</h3>
        {p.summary && (
          <p
            className="muted"
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              margin: '4px 0 0',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {p.summary}
          </p>
        )}
        {p.focus && (
          <span className="tag corner-technical" style={{ marginTop: 9 }}>
            {p.focus}
          </span>
        )}
      </div>
      <div className="row wrap" style={{ gap: 7 }}>
        <span className="pill">
          <Icon.calendar />
          {p.weeks} week{p.weeks !== 1 ? 's' : ''}
        </span>
        <span className="pill">
          <Icon.book />
          {templateCount} template{templateCount !== 1 ? 's' : ''}
        </span>
        {p.pdfMediaId && (
          <span className="pill">
            <Icon.fileText />
            PDF
          </span>
        )}
        {p.sourceLabel && (
          <span className="pill">
            <Icon.external />
            {p.sourceLabel}
          </span>
        )}
      </div>
    </button>
  )
}

export function Programmes() {
  const nav = useNav()
  const { role } = useAuth()
  const [importOpen, setImportOpen] = useState(false)
  const [building, setBuilding] = useState(false)
  const { data: programmes = [], isLoading, isError } = useProgrammes()
  const { data: templates = [] } = useTemplates()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  const coaching = role === 'coach' || role === 'admin'
  const templateCount = (id: string) => templates.filter((t) => t.programmeId === id).length
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Programmes</h2>
          <div className="sub">Six-week blocks of linked sessions, imported from England Football or built by hand.</div>
        </div>
        {coaching && (
          <div className="row wrap">
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <Icon.download />
              Import a programme
            </button>
            <button className="btn btn-primary" onClick={() => setBuilding(true)}>
              <Icon.plus />
              New programme
            </button>
          </div>
        )}
      </div>
      {programmes.length === 0 ? (
        <Empty icon={Icon.list} title="No programmes yet">
          {coaching
            ? 'Import an England Football programme from its overview link, or build one from your templates.'
            : 'Nothing here yet. Programmes appear once a coach imports or builds one.'}
        </Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 18 }}>
          {programmes.map((p) => (
            <ProgrammeCard key={p.id} p={p} templateCount={templateCount(p.id)} onOpen={() => nav('programme', { programmeId: p.id })} />
          ))}
        </div>
      )}
      {importOpen && <ImportProgrammeModal onClose={() => setImportOpen(false)} />}
      {building && (
        <ProgrammeFormModal onClose={() => setBuilding(false)} onSaved={(id) => nav('programme', { programmeId: id })} />
      )}
    </div>
  )
}
