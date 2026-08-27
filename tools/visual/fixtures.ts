// Invented data for the harness. No real child, coach or club member appears
// here, and none of it reaches the application: nothing under src/ imports
// this file.
import { blankSession } from '../../src/lib/data'
import type { Drill, MediaItem, Session, Template } from '../../src/lib/data'

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

export type CapSet = 'coach' | 'parent' | 'viewer'

const CAPS: Record<CapSet, string[]> = {
  // A coach with the full club-wide set.
  coach: ['sessions.create', 'players.view', 'players.manage', 'club.manage', 'teams.manage', 'audit.view', 'shares.manage'],
  // A parent: read only, no coaching write, no roster.
  parent: [],
  // A member who may see the club's sessions but not create one: the
  // capability variant that hides New session and the planner links.
  viewer: ['players.view'],
}

const capSet = (params.get('caps') ?? 'coach') as CapSet

export const fixtures = {
  me: 'coach-me',
  capSet,
  caps: new Set(CAPS[capSet] ?? CAPS.coach),
  role: capSet === 'parent' ? ('parent' as const) : ('coach' as const),
}

function inDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const session = (over: Partial<Session> & Pick<Session, 'id' | 'name'>): Session => ({
  ...blankSession('coach-them', null),
  date: inDays(2),
  time: '17:30',
  status: 'upcoming',
  teamIds: ['titans'],
  focus: 'Receiving on the half turn',
  ...over,
})

export const TEAMS = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
  { id: 'gladiators', name: 'Gladiators', bibColour: null },
  { id: 'spartans', name: 'Spartans', bibColour: 'yellow' },
  { id: 'argonauts', name: 'Argonauts', bibColour: null },
]

export const SESSIONS: Session[] = [
  session({
    id: 's-1',
    name: 'Titans Tuesday',
    coachId: 'coach-me',
    date: inDays(1),
    activities: [
      { phase: 'Warm-Up', drillId: 'd1', duration: 10 },
      { phase: 'Skill', drillId: 'd2', duration: 20 },
      { phase: 'Game', drillId: 'd3', duration: 25 },
      { phase: 'Cool-Down', drillId: 'd4', duration: 10 },
    ],
  }),
  session({ id: 's-2', name: 'Trojans Thursday', coachId: 'coach-them', date: inDays(3), teamIds: ['trojans'] }),
  session({ id: 's-3', name: 'Gladiators Saturday practice', coachId: 'coach-me', date: inDays(5), teamIds: ['gladiators'] }),
  session({ id: 's-4', name: 'Spartans warm up session', coachId: 'coach-them', date: inDays(6), teamIds: ['spartans'] }),
]

export const DRILLS: Drill[] = [
  {
    id: 'd1',
    title: 'Four goal possession',
    corner: 'technical',
    skill: 'Receiving',
    ages: ['U9', 'U10'],
    level: 'Core',
    duration: 15,
    players: '8-12',
    area: '30 x 24',
    equipment: ['12 cones', '4 goals', '3 balls'],
    mediaId: null,
    summary: 'A possession square with four small goals, so the pass forward is always on.',
    points: ['Open the body before the ball arrives', 'Head up between touches'],
    tags: ['possession', 'receiving'],
    setupNotes: '',
    easier: [],
    harder: [],
    theme: '',
    format: '',
    sourceUrl: '',
    sourceLabel: '',
  } as unknown as Drill,
  {
    id: 'd2',
    title: 'Turning gates',
    corner: 'physical',
    skill: 'Turning',
    ages: ['U9'],
    level: 'Core',
    duration: 12,
    players: '6-10',
    area: '20 x 20',
    equipment: ['8 cones', '2 balls'],
    mediaId: null,
    summary: 'Dribble through a gate, turn, and find the next one.',
    points: ['Small touches into the turn'],
    tags: ['turning'],
    setupNotes: '',
    easier: [],
    harder: [],
    theme: '',
    format: '',
    sourceUrl: '',
    sourceLabel: '',
  } as unknown as Drill,
]

export const MEDIA: MediaItem[] = []
export const TEMPLATES: Template[] = []
