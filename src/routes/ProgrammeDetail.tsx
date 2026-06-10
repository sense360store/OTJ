// One programme: its intentions at the top, the weeks in order with their
// templates, the attached PDF opening through the existing signed URL path,
// and the source link. Mobile-first: everything stacks and stays usable at
// 360px with 44px touch targets.
//
// Roles: every club member reads this page. Use week creates a session, so
// it is for coaching roles; Edit follows the programmes RLS (owner, or
// admin). Parents see the plan and the PDF only.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useStartFromTemplate } from '../hooks/useStartFromTemplate'
import { useMediaMap, useProgramme, useSignedMediaUrl, useTemplates } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Programme, Template } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, PHASE_COLOR, SourceLink } from '../components/ui'
import { ProgrammeFormModal } from '../components/ProgrammeFormModal'

function WeekRow({ week, template, coaching }: { week: number; template: Template | null; coaching: boolean }) {
  const startFromTemplate = useStartFromTemplate()
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="role-badge" style={{ fontSize: 12, flex: '0 0 auto' }}>
          Week {week}
        </span>
        {template ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{template.name}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {template.activities.length} activities · {sessionMinutes({ activities: template.activities })} min
              {template.author ? ` · ${template.author}` : ''}
            </div>
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 13.5, alignSelf: 'center' }}>
            No template assigned yet.
          </span>
        )}
      </div>
      {template && (
        <>
          {template.activities.length > 0 && (
            <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
              {template.activities.map((a, i) => (
                <div key={i} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }} title={a.phase}></div>
              ))}
            </div>
          )}
          {coaching && (
            <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => startFromTemplate(template)}>
              <Icon.copy />
              Use this week
            </button>
          )}
        </>
      )}
    </div>
  )
}

// The attached PDF opens in a new tab through a signed URL, the same path
// every other stored file uses. The button waits for the URL.
function PdfButton({ pdfMediaId }: { pdfMediaId: string | null }) {
  const mediaById = useMediaMap()
  const media = pdfMediaId ? mediaById[pdfMediaId] : undefined
  const { data: signedUrl } = useSignedMediaUrl(media?.storagePath)
  if (!media) return null
  return (
    <a
      className="btn btn-ghost"
      style={{ minHeight: 44, ...(signedUrl ? {} : { opacity: 0.6, pointerEvents: 'none' as const }) }}
      href={signedUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
    >
      <Icon.fileText />
      Open PDF
    </a>
  )
}

function ProgrammeView({ p }: { p: Programme }) {
  const nav = useNav()
  const { user, role } = useAuth()
  const { data: templates = [] } = useTemplates()
  const [editing, setEditing] = useState(false)

  const coaching = role === 'coach' || role === 'admin'
  // Backfilled programmes have no owner, so only an admin curates them. The
  // programmes RLS enforces the same rule; this only surfaces the buttons.
  const canManage = role === 'admin' || (!!p.createdBy && p.createdBy === user?.id)

  const weekTemplates: Record<number, Template> = {}
  for (const t of templates) {
    if (t.programmeId === p.id && t.programmeWeek != null && !weekTemplates[t.programmeWeek]) {
      weekTemplates[t.programmeWeek] = t
    }
  }
  const weekCount = Math.max(p.weeks, ...Object.keys(weekTemplates).map(Number), 1)
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1)

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
        <button className="icon-btn" style={{ width: 44, height: 44 }} aria-label="Back" onClick={() => nav('programmes')}>
          <Icon.chevL />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 24 }}>{p.name}</h2>
          {p.focus && (
            <span className="tag corner-technical" style={{ marginTop: 6 }}>
              {p.focus}
            </span>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 9, marginBottom: 14 }}>
        <PdfButton pdfMediaId={p.pdfMediaId} />
        {canManage && (
          <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setEditing(true)}>
            <Icon.edit />
            Edit programme
          </button>
        )}
      </div>

      {p.summary && (
        <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: '0 0 12px', maxWidth: 720 }}>{p.summary}</p>
      )}

      {(p.intentions.length > 0 || p.sourceUrl) && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 18 }}>
          {p.intentions.map((x, i) => (
            <span key={i} className="pill">
              {x}
            </span>
          ))}
          <SourceLink url={p.sourceUrl || null} label={p.sourceLabel || null} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        {weeks.map((w) => (
          <WeekRow key={w} week={w} template={weekTemplates[w] ?? null} coaching={coaching} />
        ))}
      </div>

      {editing && (
        <ProgrammeFormModal programme={p} weekTemplates={weekTemplates} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

export function ProgrammeDetail() {
  const { id } = useParams()
  const nav = useNav()
  const { data: programme, isLoading, isError } = useProgramme(id)
  if (programme) return <ProgrammeView key={programme.id} p={programme} />
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  return (
    <Empty icon={Icon.list} title="Programme not found">
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('programmes')}>
        <Icon.chevL />
        Back to programmes
      </button>
    </Empty>
  )
}
