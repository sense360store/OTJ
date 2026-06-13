// Build a new session from a template and open it in the planner. The
// Templates screen's Use template button and a programme week's Use button
// share this, so a session built from a template always lands the same way:
// owned by the signed-in coach, defaulting to their team, with the
// template's activities and intentions copied on.
import { useNav } from './useNav'
import { useAuth } from './useAuth'
import { useSessions } from '../context/SessionsContext'
import type { Activity, Session, Template } from '../lib/data'

export function useStartFromTemplate() {
  const nav = useNav()
  const { user, profile } = useAuth()
  const { upsertSession } = useSessions()
  return (t: Template) => {
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
      programmeId: null,
      programmeWeek: null,
      liveActivityIndex: null,
      liveActivityStartedAt: null,
      spondEventId: null,
      boardId: null,
    }
    upsertSession(s)
    nav('planner', { sessionId: s.id })
  }
}
