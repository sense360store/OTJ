// One programme: its intentions at the top, the weeks in order with their
// templates, the attached PDF opening through the existing signed URL path,
// the source link, and once applied to a team, each week's linked sessions
// and their status. Mobile-first: everything stacks and stays usable at
// 360px with 44px touch targets.
//
// Roles: every club member reads this page. Use week and Apply to team
// create sessions, so they are for coaching roles; Edit and Delete follow
// the programmes RLS (owner, or admin). Parents see the plan, the progress
// and the PDF only.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useStartFromTemplate } from '../hooks/useStartFromTemplate'
import { useSessions } from '../context/SessionsContext'
import { useDeleteProgramme, useMediaMap, useMyCapabilities, useProgramme, useSignedMediaUrl, useTeamMap, useTemplates } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Programme, Session, Template } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, fmtDate, Loading, Modal, PHASE_COLOR, SourceLink } from '../components/ui'
import { ProgrammeFormModal } from '../components/ProgrammeFormModal'
import { TemplateFormModal } from '../components/TemplateFormModal'
import { ApplyProgrammeModal } from '../components/ApplyProgrammeModal'

type NavFn = ReturnType<typeof useNav>

function WeekRow({
  week,
  template,
  linked,
  coaching,
  manyTeams,
  nav,
  onEditTemplate,
}: {
  week: number
  template: Template | null
  linked: Session[]
  coaching: boolean
  manyTeams: boolean
  nav: NavFn
  // Editing a week's template is a templates update, which the RLS reserves
  // for admins; null hides the affordance for everyone else.
  onEditTemplate: ((t: Template) => void) | null
}) {
  const startFromTemplate = useStartFromTemplate()
  const teamById = useTeamMap()
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
        {template && onEditTemplate && (
          <button
            className="icon-btn"
            style={{ width: 34, height: 34, flex: '0 0 auto' }}
            aria-label={`Edit week ${week} template`}
            title="Edit template"
            onClick={() => onEditTemplate(template)}
          >
            <Icon.edit style={{ width: 15, height: 15 }} />
          </button>
        )}
      </div>
      {template && template.activities.length > 0 && (
        <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
          {template.activities.map((a, i) => (
            <div key={i} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }} title={a.phase}></div>
          ))}
        </div>
      )}
      {/* The week's scheduled sessions, once the programme is applied: status
          from the ordinary session status, per team where applied to more
          than one. Tapping one opens its session day view. */}
      {linked.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {linked.map((s) => {
            const done = s.status === 'completed'
            const team = s.teamId ? (teamById[s.teamId]?.name ?? null) : 'Club'
            return (
              <button
                key={s.id}
                className="pill"
                style={{ minHeight: 32, cursor: 'pointer', color: done ? 'var(--c-physical)' : undefined }}
                onClick={() => nav('sessionDay', { sessionId: s.id })}
              >
                {done ? <Icon.checkCircle /> : <Icon.calendar />}
                {manyTeams && team ? `${team} · ` : ''}
                {fmtDate(s.date) || 'No date'}
                {done ? ' · Completed' : ' · Planned'}
              </button>
            )
          })}
        </div>
      )}
      {template && coaching && (
        <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => startFromTemplate(template)}>
          <Icon.copy />
          Use this week
        </button>
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

// Deleting a programme leaves its templates and sessions intact; the foreign
// keys null out. The confirm says so.
function DeleteProgrammeModal({ p, onClose, onDeleted }: { p: Programme; onClose: () => void; onDeleted: () => void }) {
  const del = useDeleteProgramme()
  const remove = () => del.mutate({ id: p.id }, { onSuccess: onDeleted })
  return (
    <Modal
      title="Delete programme"
      sub={p.name}
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
        This removes the programme only. Its week templates stay in the template library and any scheduled sessions
        stay on the calendar; they just stop pointing at a programme.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}

function ProgrammeView({ p }: { p: Programme }) {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: templates = [] } = useTemplates()
  const { sessions } = useSessions()
  const teamById = useTeamMap()
  const [editing, setEditing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  // Building a session from a week needs the sessions create capability.
  const coaching = caps.has('sessions.create')
  // Backfilled programmes have no owner, so only programmes.manage reaches
  // them. The owner arm carries programmes.create, so a coach demoted to parent
  // loses the buttons with the access. The RLS enforces the same rule; this
  // only surfaces the buttons.
  const canManage =
    caps.has('programmes.manage') || (!!p.createdBy && p.createdBy === user?.id && caps.has('programmes.create'))

  const weekTemplates: Record<number, Template> = {}
  for (const t of templates) {
    if (t.programmeId === p.id && t.programmeWeek != null && !weekTemplates[t.programmeWeek]) {
      weekTemplates[t.programmeWeek] = t
    }
  }
  const weekCount = Math.max(p.weeks, ...Object.keys(weekTemplates).map(Number), 1)
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1)

  // Progress: the sessions this programme created, grouped per team. A team
  // is done with a week once any of its sessions for that week completes.
  const linked = sessions.filter((s) => s.programmeId === p.id)
  const byWeek = (w: number) => linked.filter((s) => s.programmeWeek === w)
  const teamIds = [...new Set(linked.map((s) => s.teamId ?? ''))]
  const manyTeams = teamIds.length > 1
  const progress = teamIds.map((id) => {
    const ofTeam = linked.filter((s) => (s.teamId ?? '') === id)
    const completed = new Set(ofTeam.filter((s) => s.status === 'completed').map((s) => s.programmeWeek)).size
    return { id, name: id ? (teamById[id]?.name ?? 'Team') : 'Club', completed }
  })

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
        {coaching && Object.keys(weekTemplates).length > 0 && (
          <button className="btn btn-gold" style={{ minHeight: 44 }} onClick={() => setApplying(true)}>
            <Icon.flag />
            Apply to team
          </button>
        )}
        <PdfButton pdfMediaId={p.pdfMediaId} />
        {canManage && (
          <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setEditing(true)}>
            <Icon.edit />
            Edit programme
          </button>
        )}
        {canManage && (
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 44, minHeight: 44, padding: 0 }}
            aria-label="Delete programme"
            onClick={() => setDeleting(true)}
          >
            <Icon.trash />
          </button>
        )}
      </div>

      {p.summary && <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: '0 0 12px', maxWidth: 720 }}>{p.summary}</p>}

      {(p.intentions.length > 0 || p.sourceUrl) && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {p.intentions.map((x, i) => (
            <span key={i} className="pill">
              {x}
            </span>
          ))}
          <SourceLink url={p.sourceUrl || null} label={p.sourceLabel || null} />
        </div>
      )}

      {progress.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 18 }}>
          {progress.map((t) => (
            <span key={t.id} className="pill" style={{ fontWeight: 700 }}>
              <Icon.flag />
              {t.name} · {t.completed} of {weekCount} completed
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        {weeks.map((w) => (
          <WeekRow
            key={w}
            week={w}
            template={weekTemplates[w] ?? null}
            linked={byWeek(w)}
            coaching={coaching}
            manyTeams={manyTeams}
            nav={nav}
            onEditTemplate={caps.has('templates.manage') ? setEditingTemplate : null}
          />
        ))}
      </div>

      {editing && <ProgrammeFormModal programme={p} weekTemplates={weekTemplates} onClose={() => setEditing(false)} />}
      {editingTemplate && <TemplateFormModal template={editingTemplate} onClose={() => setEditingTemplate(null)} />}
      {applying && <ApplyProgrammeModal programme={p} weekTemplates={weekTemplates} onClose={() => setApplying(false)} />}
      {deleting && (
        <DeleteProgrammeModal
          p={p}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            nav('programmes')
          }}
        />
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
