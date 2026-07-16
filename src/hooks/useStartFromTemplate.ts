// Build a new session from a template and open it in the planner. The
// Templates screen's Use template button and a programme week's Use button
// share this, so a session built from a template always lands the same way:
// owned by the signed-in coach, defaulting to their team, with the
// template's activities and intentions copied on.
//
// The create is awaited: the planner opens only after the session lands, and
// a failure leaves the caller on its screen with the failed flag to show.
// The screen owning the hook holds one guard for all its cards, so only one
// create can run at a time across them; pendingTemplateId names the card in
// flight so the others can disable alongside it.
import { useRef } from 'react'
import { useAuth } from './useAuth'
import { useNav } from './useNav'
import { useGuardedSubmit } from './useGuardedSubmit'
import { useSessions } from '../context/SessionsContext'
import { stableCreateId } from '../lib/sessionSubmit'
import type { Activity, Session, Template } from '../lib/data'

export function useStartFromTemplate() {
  const nav = useNav()
  const { user, profile } = useAuth()
  const { upsertSession } = useSessions()
  // One id per template for the life of this screen, so a retry after an
  // ambiguous failure reuses it and cannot create a duplicate; a success
  // navigates away and unmounts, so using the same template again later mints
  // a fresh id.
  const ids = useRef(new Map<string, string>())
  const { submit, pending, failed } = useGuardedSubmit<{ templateId: string; session: Session }, Session>({
    operation: 'start from template',
    perform: ({ session }) => upsertSession(session),
    onSuccess: (saved) => nav('planner', { sessionId: saved.id }),
  })
  const start = (t: Template) => {
    const session: Session = {
      id: stableCreateId(ids.current, t.id),
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
    void submit({ templateId: t.id, session })
  }
  return { start, pendingTemplateId: pending?.templateId ?? null, failed }
}
