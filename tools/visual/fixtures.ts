// Invented data for the harness. No real child, coach or club member appears
// here, and none of it reaches the application: nothing under src/ imports
// this file.
import { blankSession } from '../../src/lib/data'
import type { Drill, MediaItem, RegisteredPlayer, Season, Session, Template } from '../../src/lib/data'

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

export type CapSet = 'coach' | 'parent' | 'viewer' | 'admin'

const CAPS: Record<CapSet, string[]> = {
  // A coach with the full club-wide set. players.delete, players.export and
  // players.import were added for the Registered players surface; none of the
  // three appears in nav.ts's ITEM_CAP, so the shell, the bottom row and the
  // More sheet render exactly as they did before, and the Home, Sessions and
  // More shots are unchanged.
  coach: [
    'sessions.create',
    'players.view',
    'players.manage',
    'players.delete',
    'players.export',
    'players.import',
    'club.manage',
    'teams.manage',
    'audit.view',
    'shares.manage',
  ],
  // A parent: read only, no coaching write, no roster. The Registered players
  // route is guarded on players.view, so this set proves the redirect rather
  // than an empty screen.
  parent: [],
  // A member who may see the club's sessions but not create one: the
  // capability variant that hides New session and the planner links. On
  // Registered players it is the read only variant: the register renders, and
  // every write affordance and the whole bulk flow are absent.
  viewer: ['players.view'],
  // seasons.manage on top of the coach set, which is the only way to reach the
  // "Set up the first season" call to action. It DOES add the Admin, Seasons
  // nav item, which is why it is a separate set rather than a widening of
  // coach: no existing shot moves.
  admin: [
    'sessions.create',
    'players.view',
    'players.manage',
    'players.delete',
    'players.export',
    'players.import',
    'seasons.manage',
    'club.manage',
    'teams.manage',
    'audit.view',
    'shares.manage',
  ],
}

const capSet = (params.get('caps') ?? 'coach') as CapSet

// A named variant of the data a screen reads, so a state a screenshot claims
// is REACHED through the real code path rather than drawn. The screens that
// take no `state` ignore it.
export type HarnessState =
  | 'default'
  | 'loading'
  | 'rowsloading'
  | 'empty'
  | 'error'
  | 'archived'
  | 'withdrawn'
  | 'noseason'
  | 'stale'
  | 'overlimit'

export const harnessState = (params.get('state') ?? 'default') as HarnessState

export const fixtures = {
  me: 'coach-me',
  capSet,
  caps: new Set(CAPS[capSet] ?? CAPS.coach),
  role: capSet === 'parent' ? ('parent' as const) : ('coach' as const),
  state: harnessState,
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

/* ---- Registered players ------------------------------------------
   Two seasons, so the archived and read only variant is reached by
   selecting one rather than by pretending the current season is archived.
   Every name here is invented; no real child appears. */
export const CURRENT_SEASON: Season = {
  id: 'season-2627',
  name: '2026/27',
  startsOn: '2026-08-01',
  endsOn: '2027-06-30',
  isCurrent: true,
  archivedAt: null,
}

export const PAST_SEASON: Season = {
  id: 'season-2526',
  name: '2025/26',
  startsOn: '2025-08-01',
  endsOn: '2026-06-30',
  isCurrent: false,
  archivedAt: '2026-07-01T00:00:00Z',
}

export const SEASONS: Season[] = [CURRENT_SEASON, PAST_SEASON]

const reg = (
  n: number,
  displayName: string,
  over: Partial<RegisteredPlayer> = {},
): RegisteredPlayer => ({
  registrationId: `reg-${n}`,
  playerId: `player-${n}`,
  seasonId: CURRENT_SEASON.id,
  teamId: 'titans',
  displayName,
  shirtNumber: n,
  status: 'registered',
  registeredDate: '2026-08-14',
  createdBy: 'coach-me',
  updatedAt: '2026-08-20T09:12:00Z',
  ...over,
})

// A register that exercises the row states the table and the card both have to
// carry: every status, a missing shirt number, an unassigned player, a long
// name, and a spread of teams so the team filter and the sort have work to do.
export const REGISTERED_PLAYERS: RegisteredPlayer[] = [
  reg(4, 'Aria Bexley-Thornton'),
  reg(7, 'Callum Hedge', { teamId: 'trojans' }),
  reg(9, 'Devon Marsh', { status: 'pending', registeredDate: null, shirtNumber: null }),
  reg(11, 'Elin Rowbotham', { teamId: 'gladiators' }),
  reg(2, 'Fenn Askwith', { teamId: null }),
  reg(14, 'Georgie Villiers', { status: 'withdrawn', updatedAt: '2026-08-22T17:40:00Z' }),
  reg(3, 'Hal Winterbourne', { teamId: 'spartans', shirtNumber: null }),
  reg(21, 'Immy Radcliffe', { teamId: 'argonauts', status: 'pending', registeredDate: null }),
  reg(5, 'Jools Pennington', { teamId: 'trojans' }),
  reg(18, 'Kai Ashworth-Beaumont', { teamId: 'gladiators', status: 'withdrawn' }),
]

// One past the server's cap of 200, so pressing Select all and then Delete
// reaches the over limit refusal through the real path rather than a stub.
export const OVER_LIMIT_PLAYERS: RegisteredPlayer[] = Array.from({ length: 201 }, (_, i) =>
  reg(i + 1, `Squad Member ${i + 1}`, { teamId: i % 2 === 0 ? 'titans' : 'trojans' }),
)
