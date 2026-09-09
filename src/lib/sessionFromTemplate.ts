// Building a session from a week plan, as a pure function.
//
// It lived inline in ../hooks/useStartFromTemplate.ts, which is a hook, so
// the only way to check what it produced was to read it. That is how the
// hardcoded date survived there: `blankSession` and this path each carried
// the literal '2026-06-16', and a grep over one of them proved nothing about
// the other. The rules are out here now, so what a template turns into is a
// test rather than a reading, and the hook is the wiring it always was.
//
// NOTHING ABOUT THE BEHAVIOUR CHANGED except the date, which is today
// through ./localDate rather than a fixed day in the past.
import { defaultAgeGroup } from './ageGroups'
import { todayIso } from './localDate'
import { newSessionCoverage } from './sessionTeams'
import type { Activity, Session, Template } from './data'

export function sessionFromTemplate(input: {
  id: string
  template: Template
  coachId: string
  // Every team the club has. The session covers all of them, through the
  // one rule, because a template names no team. The caller must not ask
  // until this read has answered: a session saved covering nobody opens a
  // planner that will not re-seed it.
  allTeamIds: readonly string[]
  // The club's age group list, or undefined while that read is out.
  clubAgeGroups?: readonly string[]
}): Session {
  return {
    id: input.id,
    name: input.template.name,
    date: todayIso(),
    time: '17:30',
    ageGroup: defaultAgeGroup(input.clubAgeGroups),
    venue: '',
    focus: input.template.focus,
    status: 'upcoming',
    activities: JSON.parse(JSON.stringify(input.template.activities)) as Activity[],
    coachId: input.coachId,
    teamId: null,
    intentions: [...input.template.intentions],
    space: '',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    spondEventId: null,
    boardId: null,
    venueId: null,
    // The whole club, the same default a fresh planner draft starts from
    // and through the same rule. It used to be the coach's own team when
    // their profile named one, which is a personal default about the coach
    // standing in for a statement about the night: a coach whose profile
    // said Trojans got a Trojans session out of a club template without
    // being asked. Never left unset: this session is saved before the coach
    // sees it, and an unset session's register lists nobody.
    teamIds: newSessionCoverage([...input.allTeamIds]),
    // Club only until classified; the upsert never writes the column.
    rights: 'internal_only',
  }
}
