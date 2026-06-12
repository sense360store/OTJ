// Apply a programme to a team: pick the team, a start date, the training
// weekday and time, venue and age group, preview the resulting dates (one
// session per week, each date individually editable, half term happens),
// then confirm. Confirming creates the sessions through the existing session
// create path as the acting coach: name from the programme and week,
// activities and intentions copied from the week's template, team and
// programme links set. They are ordinary planned sessions on the calendar;
// nothing realtime or notification-shaped happens.
//
// Coaching roles only; the sessions insert RLS enforces the same boundary.
import { useMemo, useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useTeams, useUpsertSession } from '../lib/queries'
import { Icon } from './icons'
import { Modal } from './ui'
import type { Activity, Programme, Session, Template } from '../lib/data'

const AGE_GROUPS = ['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s']
// Monday-first display order over Date.getDay() numbering.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

// Date arithmetic on local calendar days. Midday keeps the maths clear of
// DST boundaries; the parts are read back locally, never via UTC.
function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function weekdayOf(iso: string): number {
  return new Date(iso + 'T12:00:00').getDay()
}

function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// The first date on or after start that falls on the chosen weekday.
function alignToWeekday(start: string, weekday: number): string {
  const diff = (weekday - weekdayOf(start) + 7) % 7
  return isoAddDays(start, diff)
}

export function ApplyProgrammeModal({
  programme,
  weekTemplates,
  onClose,
}: {
  programme: Programme
  weekTemplates: Record<number, Template>
  onClose: () => void
}) {
  const nav = useNav()
  const { user, profile } = useAuth()
  const { sessions } = useSessions()
  const { data: teams = [] } = useTeams()
  const upsert = useUpsertSession()

  const weekCount = Math.max(programme.weeks, ...Object.keys(weekTemplates).map(Number), 1)
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1)
  const plannable = weeks.filter((w) => weekTemplates[w])

  const [teamId, setTeamId] = useState(profile?.team_id ?? '')
  const [startDate, setStartDate] = useState(() => isoAddDays(todayIso(), 7))
  const [weekday, setWeekday] = useState(() => weekdayOf(isoAddDays(todayIso(), 7)))
  const [time, setTime] = useState('17:30')
  const [venue, setVenue] = useState('Springmill 3G')
  const [ageGroup, setAgeGroup] = useState('U8s')
  // Per-week date edits survive until the series itself moves.
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<number | null>(null)

  const firstDate = useMemo(() => alignToWeekday(startDate, weekday), [startDate, weekday])
  const dateFor = (week: number) => overrides[week] ?? isoAddDays(firstDate, (week - 1) * 7)

  // Picking a date implies its weekday; picking a weekday shifts the series.
  const pickStart = (iso: string) => {
    if (!iso) return
    setStartDate(iso)
    setWeekday(weekdayOf(iso))
    setOverrides({})
  }
  const pickWeekday = (d: number) => {
    setWeekday(d)
    setOverrides({})
  }

  const teamName = teams.find((t) => t.id === teamId)?.name ?? 'This team'
  const clash = (week: number) => {
    const date = dateFor(week)
    return sessions.some((s) => s.teamId === teamId && s.date === date)
  }

  const confirm = async () => {
    setError(null)
    if (!teamId) {
      setError('Pick a team.')
      return
    }
    if (plannable.length === 0) {
      setError('This programme has no week templates to schedule yet.')
      return
    }
    if (!user) {
      setError('You must be signed in.')
      return
    }
    setSaving(true)
    try {
      for (const week of plannable) {
        const t = weekTemplates[week]
        const s: Session = {
          id: crypto.randomUUID(),
          name: `${programme.name} · Week ${week}`,
          date: dateFor(week),
          time,
          ageGroup,
          venue,
          focus: t.focus || programme.focus,
          status: 'upcoming',
          activities: JSON.parse(JSON.stringify(t.activities)) as Activity[],
          coachId: user.id,
          teamId,
          intentions: [...t.intentions],
          space: '',
          sourceUrl: t.sourceUrl,
          sourceLabel: t.sourceLabel,
          programmeId: programme.id,
          programmeWeek: week,
          liveActivityIndex: null,
          liveActivityStartedAt: null,
          spondEventId: null,
        }
        await upsert.mutateAsync(s)
      }
      setCreated(plannable.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the sessions. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (created !== null) {
    return (
      <Modal title="Programme applied" sub={programme.name} onClose={onClose}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              flex: '0 0 38px',
              background: 'color-mix(in srgb, var(--c-physical) 18%, transparent)',
              color: 'var(--c-physical)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon.checkCircle style={{ width: 20, height: 20 }} />
          </span>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
            {created} session{created !== 1 ? 's' : ''} for {teamName} are on the calendar, one per week. Each is an
            ordinary planned session: open it in the planner to adjust anything.
          </p>
        </div>
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 14, minHeight: 44 }}
          onClick={() => {
            onClose()
            nav('sessions')
          }}
        >
          <Icon.calendar />
          View sessions
        </button>
      </Modal>
    )
  }

  return (
    <Modal
      title="Apply to team"
      sub={programme.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void confirm()} disabled={saving || !teamId}>
            <Icon.check />
            {saving ? 'Creating…' : `Create ${plannable.length} session${plannable.length !== 1 ? 's' : ''}`}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Team</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Pick a team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Age group</label>
          <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
            {AGE_GROUPS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Start date</label>
          <input type="date" value={startDate} onChange={(e) => pickStart(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Weekday</label>
          <select value={weekday} onChange={(e) => pickWeekday(parseInt(e.target.value, 10))}>
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Venue</label>
        <input value={venue} onChange={(e) => setVenue(e.target.value)} />
      </div>

      <div className="field">
        <label>Dates</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {weeks.map((week) => {
            const t = weekTemplates[week]
            return (
              <div
                key={week}
                style={{ padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--card)' }}
              >
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="role-badge" style={{ fontSize: 12, flex: '0 0 auto' }}>
                    Week {week}
                  </span>
                  <span
                    style={{
                      flex: '1 1 140px',
                      minWidth: 0,
                      fontWeight: 700,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      alignSelf: 'center',
                    }}
                    className={t ? undefined : 'muted'}
                  >
                    {t ? t.name : 'No template assigned, skipped'}
                  </span>
                  {t && (
                    <input
                      type="date"
                      value={dateFor(week)}
                      onChange={(e) => e.target.value && setOverrides((o) => ({ ...o, [week]: e.target.value }))}
                      style={{ width: 150, height: 44 }}
                    />
                  )}
                </div>
                {t && teamId && clash(week) && (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {teamName} already have a session on this evening.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
