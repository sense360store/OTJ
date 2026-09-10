// Build a new session from a template and open it in the planner. The
// Templates screen's Use template button and a programme week's Use button
// share this, so a session built from a template always lands the same way:
// owned by the signed-in coach, covering the whole club, with the
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
import { useClubAgeGroups, useTeams } from '../lib/queries'
import { stableCreateId } from '../lib/sessionSubmit'
import { sessionFromTemplate } from '../lib/sessionFromTemplate'
import type { Session, Template } from '../lib/data'

export function useStartFromTemplate() {
  const nav = useNav()
  const { user } = useAuth()
  const { upsertSession } = useSessions()
  // The club's teams decide what the new session covers, so `ready` below
  // reports whether that read has ANSWERED. This path saves before the
  // coach sees anything and opens the planner on a stored row, which does
  // not re-seed coverage, so building one over an unanswered read would
  // write a session covering nobody with no later repair. A pending read,
  // a failed read and a club with no teams all reach `data` as nothing,
  // and only the first two are worth waiting through.
  const teamsQuery = useTeams()
  const teams = teamsQuery.data ?? []
  // The club's age group list (COACH-5): a new session starts on it when it
  // has answered, and on the one label it always started on when it has
  // not. Not waited for, unlike the team read: an age group is corrected in
  // one tap on the planner the coach lands on, coverage is not.
  const { data: clubAgeGroups } = useClubAgeGroups()
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
    const session = sessionFromTemplate({
      id: stableCreateId(ids.current, t.id),
      template: t,
      coachId: user?.id ?? '',
      allTeamIds: teams.map((team) => team.id),
      clubAgeGroups,
    })
    void submit({ templateId: t.id, session })
  }
  return {
    start,
    pendingTemplateId: pending?.templateId ?? null,
    failed,
    // Whether the club's teams are known yet. The screens disable Use
    // until they are, so a press can never save a session covering nobody.
    ready: teamsQuery.data !== undefined,
  }
}
