// Invented data for the harness. No real child, coach or club member appears
// here, and none of it reaches the application: nothing under src/ imports
// this file.
import { blankSession } from '../../src/lib/data'
import { ACTIVITY_PAGE_SIZE, activityQueryConditions } from '../../src/lib/activityView'
import type { ActivityEvent, ActivityFilters } from '../../src/lib/activityView'
import type {
  Capability,
  Drill,
  FeedbackComment,
  FeedbackItem,
  MediaItem,
  Member,
  PlayerHistoryEntry,
  RegisteredPlayer,
  RoleCapability,
  RoleInfo,
  Season,
  Session,
  Team,
  Template,
} from '../../src/lib/data'

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

export type CapSet = 'coach' | 'parent' | 'viewer' | 'admin' | 'auditor' | 'planner' | 'clubadmin'

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
  // audit.view WITHOUT any players.* capability: the two are distinct
  // boundaries, and this is the set that proves it. On Activity the feed
  // renders in full and every player reference falls closed to a neutral
  // "Player" with no history and no deletion claim, because a viewer who
  // cannot name a child is never told one was deleted. It is a coach set
  // minus the roster, not a parent, so the shell is a coach's.
  auditor: ['sessions.create', 'audit.view', 'club.manage', 'teams.manage', 'shares.manage'],
  // A coach with the coaching write and NOTHING administrative: the Account
  // variant that gets the Default team control and no Admin section at all.
  // It is a separate set rather than a narrowing of `coach` because widening
  // an existing one moves every shot that already uses it.
  planner: ['sessions.create'],
  // The full administrative set, users.manage included. `coach` and `admin`
  // both hold club.manage and teams.manage and NEITHER holds users.manage, so
  // they are the partial admin case: Account offers Club, Teams and Spond and
  // withholds Users. This set is the one that offers all four, and it is
  // separate because users.manage adds the Admin, Users sidebar item.
  clubadmin: [
    'sessions.create',
    'players.view',
    'players.manage',
    'players.delete',
    'players.export',
    'players.import',
    'seasons.manage',
    'users.manage',
    'club.manage',
    'teams.manage',
    'audit.view',
    'shares.manage',
  ],
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

/* ---- the auth condition (VISUAL-02, Login and Set Password) -----------
   Which state the REAL auth guard is given. It is an axis of its own rather
   than a HarnessState, because the two are orthogonal and a single slot
   cannot hold two things at once: "this member arrived through an invite and
   has to set a password" and "the write hangs" are both true of the Set
   Password screen in flight. `caps` and `state` already sit beside each other
   for the same reason.

   The DEFAULT is derived from the screen rather than fixed. `screen=login`
   opens signed out, because a signed in visitor is redirected off /login by
   the product's own guard and a Login screenshot of a redirect is not a Login
   screenshot; every other screen opens signed in exactly as it always has, so
   no existing shot moves. */
export type HarnessAuth = 'signedin' | 'signedout' | 'needspassword' | 'authloading'

/* WHICH SCREEN IS MOUNTED. Exported because exactly one read answers
   differently for two screens: useProfiles is the Activity feed's list of
   acting adults AND the Users screen's list of club members, and the two need
   different rows. Widening the Activity fixture to cover the Users matrix
   would put six names in Activity's Changed by filter and move every shot it
   takes, so the read branches instead, once, with this. Nothing else in the
   harness reads it. */
export const harnessScreen = params.get('screen') ?? 'home'
const screenParam = harnessScreen
export const harnessAuth = (params.get('auth') ??
  (screenParam === 'login' ? 'signedout' : 'signedin')) as HarnessAuth

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
  | 'allactions'
  | 'archivedteam'
  /* ---- the dialog states (VISUAL-02, the six remaining dialog files) ----
     A dialog's own states are not reachable from the page's reads alone: a
     write in flight, a write that failed, and the two reads only a dialog
     makes. Each of these is still the DIALOG's own branch, reached through
     the control a coach presses; what the state changes is what the data
     layer answers, never what is drawn. */
  // Every write hangs, so pressing a confirm leaves the dialog in its real
  // in-flight state: the gerund label, the disabled controls and the frozen
  // dismissal contract. Every one of the eleven dialogs reaches it by being
  // pressed: ten through the guard, and Import from Spond through the stub's
  // own phase, which moves when mutate() is called rather than answering
  // before the dialog opens.
  | 'inflight'
  // Every write rejects, so a confirm reaches the inline ActionError rather
  // than closing.
  | 'writefails'
  // The per player History read, which answers empty by default: entries,
  // a long trail, and a failed read.
  | 'history'
  | 'historylong'
  | 'historyerror'
  // The two Renew cases a club really reaches. The source season having
  // nobody to bring forward, and every child in it already being in the
  // target, which is what leaves the confirm reading 0 and inert.
  //
  // Renew's own "choose two different seasons" branch is deliberately NOT
  // here: playersView gates the action itself on seasonCount >= 2, so a club
  // with one season is never offered Renew at all and that branch is
  // defensive rather than reachable. A state that forced it would be a
  // screenshot of something no coach can open.
  | 'renewempty'
  | 'renewalldone'
  // The Spond roster import's reported outcome, including the warning it can
  // carry. Reached by pressing Import, like its in-flight and refused states.
  | 'spondresult'
  /* ---- Activity (VISUAL-02) --------------------------------------------
     The club wide audit feed. It reuses `loading`, `empty` and `error`,
     which mean the same thing on it as on the register, and adds three of
     its own. */
  // A long acting adult's name and a long team name, which are the two
  // variable strings the feed can render. They are a STATE rather than a
  // widening of the shared teams and profiles, so no existing shot moves.
  | 'longnames'
  // The next page never arrives, so pressing Load more leaves the control in
  // its real in-flight state rather than a drawn one.
  | 'loadingmore'
  // The route guard's own answer: the reads all succeed and the CAPABILITY
  // set is what refuses. Named as a state so the shot claims something a
  // proof can check.
  | 'guarded'
  /* ---- Account (VISUAL-02) ---------------------------------------------
     The self service screen. Its write states are the SHARED `inflight` and
     `writefails`, which mean here exactly what they mean on the Registered
     players dialogs: every write hangs, and every write refuses. That is why
     there is no state per control; which write is driven is decided by which
     control the driver presses.

     The photo is the one axis those two cannot carry, because a removal needs
     a photo to remove and a state cannot be two things at once. So the three
     states below are the photo axis crossed with the same two write phases,
     rather than a new query key. The default stays what it has always been, a
     coach with no photo, so no existing screenshot moves. */
  // The signed in coach has uploaded a photo: Change photo and Remove photo.
  | 'photo'
  // A photo, and every write hangs: Removing… and Uploading… are its own.
  | 'photoinflight'
  // A photo, and every write refuses.
  | 'photofails'
  // The page level gate: the profile read has not answered.
  | 'profileloading'
  // A long name, a long sign in email, a long club name and a long team name,
  // which are the four strings this screen renders at a length the club
  // chooses. A state of its own, so no existing screenshot moves.
  | 'longvalues'
  /* Every write settles, but SLOWLY. `inflight` hangs for ever, which is the
     right shape for photographing an in-flight control and the wrong one for
     the question "what happens to focus while the coach carries on using the
     page": that needs a write a driver can act during AND see settle. Only
     the photo actions are disabled during a removal, so every other control
     is still theirs, and a repair that moves focus on success must not take
     it back from wherever they went. Codex. */
  | 'writeslow'
  // The same, with a photo already uploaded, because the removal is the one
  // write whose control the coach cannot be left on: it unmounts.
  | 'photoslow'
  /* A write that REFUSES, slowly. `writeslow` settles successfully, and on the
     signed out screens a successful call has nothing to say: no message is
     rendered, so the thing focus would move to is not there, and "focus stayed
     where the member put it" is true of a screen with no focus repair at all.
     That makes the no-steal proof vacuous on exactly the target it is meant to
     be checking. This settles slowly AND refuses, so the outcome message is on
     screen when the call lands and declining to move focus is a decision the
     guard made rather than an absence. Used by checks.mjs only. */
  | 'writeslowfails'
  /* ---- Login and Set Password (VISUAL-02) -----------------------------
     The two strings the CLUB chooses on the signed out screens, each at a
     length a club would really make it. They are separate states rather than
     one, so a shot named for a long club name is not also carrying a long
     motto and neither claim rests on the other. The auth calls themselves
     need no state of their own: `inflight` hangs them, `writefails` refuses
     them and `writeslow` settles them, which is what those three already mean
     everywhere else, so which call is driven is decided by the press. */
  | 'longclub'
  | 'longmotto'
  /* ---- Feedback (VISUAL-02) --------------------------------------------
     The club's request and bug log. It reuses `loading`, `empty`, `error`,
     `longnames`, `inflight`, `writefails`, `writeslow` and `writeslowfails`,
     which mean on it exactly what they mean everywhere else: the read has not
     answered, the read is empty, the read failed, the strings this screen
     renders are as long as a club would really make them, and every write
     hangs, refuses, settles slowly or refuses slowly. Which write is driven
     is decided by the control the driver presses, never by a state per
     control, so there is no state named for a dialog here.

     Three are its own, because they are reads and outcomes nothing else on
     the page can answer for. */
  // The per item comment thread, which is a SECOND read and only runs once a
  // row is expanded. Its two unsettled states cannot ride on `loading` and
  // `error`: those answer the page level feedback read, and a page that never
  // rendered a row has no thread to open.
  | 'commentsloading'
  | 'commentserror'
  // A promotion that succeeded AND carried a warning, which is the one
  // outcome that is neither a success nor a failure: the public issue exists
  // and writing the link back to the club's own row did not settle.
  | 'promotewarning'
  /* ---- Admin Users and Admin Teams (VISUAL-02) -------------------------
     Both screens reuse `longnames`, `inflight`, `writefails` and
     `writeslow`, which mean here exactly what they mean everywhere else: the
     strings a club chooses are as long as a club would really make them, and
     every write hangs, refuses or settles slowly. Which write is driven is
     decided by the control the driver presses.

     `writeslowfails` is deliberately NOT claimed. The admin stub branches on
     it because it shares one write hook with the rest, but no entry names it
     and `writeslow` is reached only by the focus no-steal check in
     tools/visual/checks.mjs, which needs a write that SETTLES while somebody
     carries on using the page. On the signed out screens `writeslowfails`
     exists because a success there has nothing to say; here it does, so the
     slow success is the case that separates a restore from a steal.

     The rest are their own, and they are NAMED for these screens rather than
     reusing `loading`, `empty` and `error`. Those three already answer for
     the register, the feed and the log, and the reads this pair needs are
     shared with four other harness screens: making `loading` hold the teams
     read would move Players, Sessions, Account and Activity. */
  // The page's own reads have not answered, and failed. On Users that is
  // profiles and roles together, which is what gates the page; on Teams it is
  // the teams read.
  | 'adminloading'
  | 'adminerror'
  // A club with no teams at all: the Teams screen's empty state, and the
  // Users screen's team picker saying where to add them.
  | 'noteams'
  // The capability grid's own two reads, which are separate from the page's:
  // it renders its heading and its own state either way. `gridunavailable` is
  // the club without the RBAC migrations.
  | 'gridloading'
  | 'gridunavailable'
  // Exactly one member holds Admin, and it is NOT the signed in member. That
  // is what makes the last admin lock reachable on somebody else's row: their
  // Remove is refused and their Admin tick is held on.
  | 'lastadmin'
  // The member_states read has not answered, so no member carries an invited
  // or active badge. A state of its own because the screen's honest answer to
  // an unsettled read is to say nothing rather than to guess active.
  | 'statesunknown'

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

// The team the Spond mapping stub points at, so the harness address that opens
// the fullest header names it once rather than repeating the id.
export const SPOND_TEAM_ID = 'titans'

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

/* ---- the dialogs' own reads --------------------------------------
   The rows behind the six dialog files this slice adopts. The names are the
   invented register names above; no real child, coach or adult appears.

   The rows the DRIVERS press are named in tools/visual/dialogs.mjs, which is
   plain JavaScript and cannot import this module. */

// The previous season's register. Renew reads TWO seasons at once, so the
// same rows answering for both would classify every child as already in the
// target and leave the dialog with nothing to renew, which is a state no real
// club is in. Four children carry over (the same playerId as a current row),
// four are new to the target, and one is withdrawn, which is the row Renew
// asks the coach to decide about.
export const PAST_SEASON_PLAYERS: RegisteredPlayer[] = [
  reg(4, 'Aria Bexley-Thornton', { seasonId: PAST_SEASON.id }),
  reg(7, 'Callum Hedge', { seasonId: PAST_SEASON.id, teamId: 'trojans' }),
  reg(9, 'Devon Marsh', { seasonId: PAST_SEASON.id }),
  reg(11, 'Elin Rowbotham', { seasonId: PAST_SEASON.id, teamId: 'gladiators' }),
  { ...reg(6, 'Rowan Featherstone', { seasonId: PAST_SEASON.id }), playerId: 'player-past-6' },
  { ...reg(8, 'Sasha Ingleby', { seasonId: PAST_SEASON.id, teamId: 'trojans' }), playerId: 'player-past-8' },
  { ...reg(12, 'Teddy Marchant', { seasonId: PAST_SEASON.id, shirtNumber: null }), playerId: 'player-past-12' },
  { ...reg(15, 'Umi Blackwood', { seasonId: PAST_SEASON.id, teamId: 'spartans' }), playerId: 'player-past-15' },
  {
    ...reg(17, 'Vaughn Ledgard', { seasonId: PAST_SEASON.id, status: 'withdrawn' }),
    playerId: 'player-past-17',
  },
]

const historyEntry = (n: number, over: Partial<PlayerHistoryEntry> = {}): PlayerHistoryEntry => ({
  id: `audit-${n}`,
  occurredAt: `2026-08-${String(2 + (n % 26)).padStart(2, '0')}T09:12:00Z`,
  actorId: 'coach-me',
  actorName: 'Sam Coach',
  action: 'player.updated',
  seasonId: CURRENT_SEASON.id,
  teamId: 'titans',
  source: 'ui',
  changedFields: ['shirt_number'],
  safeChanges: { shirt_number: { old: 9, new: 4 } },
  ...over,
})

// A short trail covering the entry shapes the describer has to render: a
// status change, a team move, a shirt change and one with no acting adult
// left to name.
export const PLAYER_HISTORY: PlayerHistoryEntry[] = [
  historyEntry(1, {
    action: 'player.registered',
    changedFields: ['status'],
    safeChanges: { status: { old: 'pending', new: 'registered' } },
  }),
  historyEntry(2, {
    action: 'player.team_changed',
    changedFields: ['team_id'],
    safeChanges: { team_id: { old: 'trojans', new: 'titans' } },
  }),
  historyEntry(3),
  historyEntry(4, { actorName: null, source: 'spond-roster-import' }),
]

// A long trail, for the case where the dialog's own body has to scroll.
export const PLAYER_HISTORY_LONG: PlayerHistoryEntry[] = Array.from({ length: 40 }, (_, i) => historyEntry(i + 5))

// The Spond roster import's reported outcome, counts only, plus the warning
// shape the dialog renders as its own Note.
export const SPOND_IMPORT_RESULT = {
  added: 6,
  alreadyPresent: 11,
  skipped: 2,
  registeredElsewhere: 1,
  message: 'Two Spond members had no full name recorded and were left out.',
  warnings: ['One child is in this Spond subgroup and registered to Trojans in the Hub. Nothing was changed for them.'],
}

// The spreadsheets the import dialog parses live in tools/visual/dialogs.mjs
// beside the driver that hands them to the file input, because a Playwright
// tool is plain JavaScript and cannot import this file.

/* ---- Activity (VISUAL-02) ------------------------------------------
   The club wide audit feed. Two things matter about these rows.

   They are SAFE FIELDS ONLY, exactly as the real query selects: no
   metadata, no request id, no name shaped value. The feed is child name
   free, so an event that concerns a child carries the child's id and
   nothing else, and the harness resolves that id through the same
   players.view gated identity map the product uses.

   And they are enough rows to fill a page. The feed pages by a keyset of
   50, so a fixture set of fewer than 51 rows would never offer Load more
   and the control could rot unseen. */

const member = (id: string, fullName: string): Member => ({
  id,
  fullName,
  avatar: null,
  avatarUrl: null,
  role: 'coach',
  teamId: null,
  joined: '2026-07-01',
  roles: [],
  teamIds: [],
  allTeams: false,
})

// The acting adults the Changed by filter offers. Invented, like every other
// name here.
const ACTIVITY_PROFILES: Member[] = [
  member('coach-me', 'Sam Ashworth'),
  member('coach-them', 'Priya Raghunathan'),
  member('coach-3', 'Marguerite Ashby-Fotheringay'),
]

// The two variable strings the feed can render at any length: the acting
// adult's name snapshot and a resolved team name. Both belong to the
// `longnames` state rather than to the shared fixtures, so no existing
// screenshot moves.
const LONG_ACTOR = member('coach-long', 'Christabel Fotheringay-Wallington-Smythe')
const LONG_TEAM: Team = {
  id: 'team-long',
  name: 'Ossett Town Juniors Development Squad Under Nines',
  bibColour: null,
}

// The hardest realistic entity label: a team name a coach typed with no
// spaces, so it carries no break opportunity at all. A spaced name breaks by
// itself and proves nothing about the wrapping rules.
//
// Measured rather than assumed: forty two characters at 12px is about 230px,
// which still fits the 278px card body at 360, so this does not overflow even
// with the wrapping declarations removed. It is the widest thing a club could
// really put there, not a proof that those declarations are load bearing; they
// stay because they are correct, and the check below measures the rendered
// result rather than the rule.
const UNBROKEN_TEAM: Team = {
  id: 'team-unbroken',
  name: 'OssettTownJuniorsDevelopmentSquadUnderNines',
  bibColour: null,
}

export const ACTIVITY_BATCH_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const ACTIVITY_DELETE_BATCH_ID = 'a1b2c3d4-0000-4000-8000-000000000002'

// A player id the identity map knows (so the row offers View history) and one
// it does not (so the row reads "Deleted player"). The map is built from the
// register above, so player-4 is Aria Bexley-Thornton and the feed must still
// never say so.
const LIVE_PLAYER = 'player-4'
const GONE_PLAYER = 'player-deleted-77'

const at = (n: number): string => new Date(Date.UTC(2026, 7, 28, 19, 40) - n * 37 * 60000).toISOString()

const evt = (n: number, over: Partial<ActivityEvent>): ActivityEvent => ({
  id: `audit-a-${n}`,
  occurredAt: at(n),
  actorId: 'coach-me',
  actorName: 'Sam Ashworth',
  action: 'player.created',
  entityType: 'player',
  entityId: LIVE_PLAYER,
  seasonId: CURRENT_SEASON.id,
  teamId: 'titans',
  source: 'manual',
  changedFields: null,
  safeChanges: null,
  batchId: null,
  ...over,
})

// One of each row shape the renderer has to draw, cycled until the first page
// is full. Every entity kind, every reference shape (a player with history, a
// deleted player, a batch deep link, a season, a live team, a deleted team and
// the neutral labels), an event with no acting adult left to name, and rows
// carrying a batch id so the per row Batch chip renders.
const SHAPES: Partial<ActivityEvent>[] = [
  { action: 'player.withdrawn', changedFields: ['status'], safeChanges: { status: { old: 'registered', new: 'withdrawn' } } },
  { action: 'player.deleted', entityId: GONE_PLAYER, actorId: 'coach-them', actorName: 'Priya Raghunathan' },
  // The batch summary and the per identity rows beside it share the batch id,
  // so a batch deep link shows the run AND what it did. The summary's own
  // reference is already the batch link, which is why the row level chip is
  // rendered for everything except these two entity types.
  { action: 'players.import_completed', entityType: 'import_batch', entityId: ACTIVITY_BATCH_ID, source: 'csv_import', batchId: ACTIVITY_BATCH_ID },
  { action: 'player.registration_created', source: 'csv_import', batchId: ACTIVITY_BATCH_ID },
  { action: 'player.team_changed', safeChanges: { team_id: { old: 'trojans', new: 'titans' } }, teamId: 'titans' },
  { action: 'season.activated', entityType: 'season', entityId: CURRENT_SEASON.id, actorId: null, actorName: null, source: 'system' },
  { action: 'players.bulk_deleted', entityType: 'delete_batch', entityId: ACTIVITY_DELETE_BATCH_ID, source: 'manual', batchId: ACTIVITY_DELETE_BATCH_ID },
  { action: 'player.deleted', entityId: GONE_PLAYER, batchId: ACTIVITY_DELETE_BATCH_ID },
  { action: 'players.exported', entityType: 'export', entityId: 'export-1', source: 'manual' },
  { action: 'team.updated', entityType: 'team', entityId: 'trojans', actorId: 'coach-3', actorName: 'Marguerite Ashby-Fotheringay' },
  { action: 'team.deleted', entityType: 'team', entityId: 'team-gone', teamId: null },
  { action: 'user.role_assigned', entityType: 'user', entityId: 'member-1', changedFields: ['coach'] },
  { action: 'user.capability_granted', entityType: 'role', entityId: 'role-1', changedFields: ['players.manage'] },
  { action: 'spond.mapping_created', entityType: 'spond_mapping', entityId: 'sg-1', source: 'edge_function' },
  { action: 'drill.updated', entityType: 'drill', entityId: 'd1' },
  { action: 'template.created', entityType: 'template', entityId: 't1' },
  { action: 'programme.deleted', entityType: 'programme', entityId: 'pr1' },
  { action: 'session.team_added', entityType: 'session', entityId: 's-1', actorId: 'coach-them', actorName: 'Priya Raghunathan' },
  { action: 'venue.updated', entityType: 'venue', entityId: 'v1', source: 'database_trigger' },
  { action: 'players.spond_imported', entityType: 'import_batch', entityId: ACTIVITY_BATCH_ID, source: 'spond_import' },
  { action: 'player.updated', changedFields: ['display_name'], safeChanges: { display_name: { old: 'x', new: 'y' } } as never },
  { action: 'player.renewed', source: 'renewal', changedFields: ['season_id'] },
]

// Sixty two rows: one full page of fifty, then twelve, so Load more is offered
// once and the feed then says it is exhausted.
const ACTIVITY_EVENTS: ActivityEvent[] = Array.from({ length: 62 }, (_, i) =>
  evt(i, SHAPES[i % SHAPES.length]),
)

// The `longnames` rows, in front of the ordinary feed: a long acting adult's
// name, a long team name as the entity reference, and a team change whose
// description carries two of them.
const LONG_NAME_EVENTS: ActivityEvent[] = [
  evt(-3, { actorId: LONG_ACTOR.id, actorName: LONG_ACTOR.fullName, action: 'player.withdrawn', changedFields: ['status'], safeChanges: { status: { old: 'registered', new: 'withdrawn' } } }),
  evt(-2, { actorId: LONG_ACTOR.id, actorName: LONG_ACTOR.fullName, action: 'team.updated', entityType: 'team', entityId: LONG_TEAM.id, teamId: LONG_TEAM.id }),
  evt(-1, {
    actorId: LONG_ACTOR.id,
    actorName: LONG_ACTOR.fullName,
    action: 'player.team_changed',
    safeChanges: { team_id: { old: LONG_TEAM.id, new: 'team-gone' } },
    teamId: LONG_TEAM.id,
    batchId: ACTIVITY_BATCH_ID,
  }),
  evt(-4, {
    actorId: LONG_ACTOR.id,
    actorName: LONG_ACTOR.fullName,
    action: 'team.updated',
    entityType: 'team',
    entityId: UNBROKEN_TEAM.id,
    teamId: UNBROKEN_TEAM.id,
  }),
]

export const ACTIVITY_PROFILES_FOR = (s: HarnessState): Member[] =>
  s === 'longnames' ? [LONG_ACTOR, ...ACTIVITY_PROFILES] : ACTIVITY_PROFILES

// The Account screen's Default team select renders a team name too, and the
// long one has to be OFFERED there before the profile can be set to it, so
// `longvalues` widens the club the same way `longnames` does.
export const ACTIVITY_TEAMS_FOR = (s: HarnessState): Team[] =>
  s === 'longnames' || s === 'longvalues' ? [...TEAMS, LONG_TEAM, UNBROKEN_TEAM] : TEAMS

/* ---- Account (VISUAL-02) ----------------------------------------------
   The signed in coach, as the Account screen writes them. Three of their
   fields are EDITABLE from that screen, so the harness holds them in a small
   store rather than as constants: a successful upload, name save or team
   change writes to it, every subscriber re-renders, and the screen then shows
   what the product shows after refreshProfile. Without it the stub answered
   with the old value, Save stayed enabled after a save, and a screenshot
   named for a success showed a screen that had not moved.

   Nothing here is a real person. The email is a .invalid address, which can
   never resolve. */
// Mirrored by tools/visual/account.mjs, which is plain JavaScript and cannot
// import this module. A drift is caught rather than tolerated: the entry that
// types this value is proved by the refusal that only appears when the typed
// address matched the signed in one.
export const ACCOUNT_EMAIL = 'coach@example.invalid'
const ACCOUNT_NAME = 'Sam Whitfield'
// The four strings this screen renders at a length the club chooses. The
// email is the hardest of them: it is one token with no space to break at.
const LONG_ACCOUNT_NAME = 'Wilhelmina Fotheringay-Wallington-Smythe'
const LONG_ACCOUNT_EMAIL =
  'wilhelmina.fotheringay-wallington-smythe@ossett-town-juniors-football-club.example'
const LONG_CLUB_NAME = 'Ossett Town Juniors Community Football and Friendship Association'
const DEFAULT_CLUB_NAME = 'Ossett Town Juniors'

/* ---- the club identity the signed out screens render -------------------
   Login and Set Password have no session, so they show the last cached club
   identity rather than reading the club row. Both strings are the club's own
   and both can be as long as a committee makes them, which is the case the
   card has to survive: the name wraps, and the motto is a quoted italic line
   that used to be assumed short.

   Mirrored by tools/visual/auth.mjs, which is plain JavaScript and cannot
   import this module. The entries that claim them compare EXACTLY rather than
   by length, so a stub that stopped applying one fails rather than being
   photographed under a name claiming it. */
export const DEFAULT_MOTTO = 'Where football and friendships flourish'
export const LONG_MOTTO =
  'Where football and friendships flourish, every child plays every week and nobody stands on the touchline alone'

/* The signed out screens get their OWN long club name rather than sharing the
   Account screen's, and it is a single unbroken token on purpose. Account's
   is a long phrase with spaces to break at, which wraps under any rule at
   all; the case this card actually fails on is a name with no break
   opportunity, which sets the grid item's content based minimum and pushes
   the card past a 360px viewport. That is what `.login-identity`'s
   `overflow-wrap: anywhere` is for, and a fixture that never produced the
   case would leave that rule guarded by nothing. Account's own `longvalues`
   makes the same point about the email: it is the hardest of its four because
   it is one token with no space in it. */
const LONG_LOGIN_CLUB_NAME = 'Ossettownjuniorscommunityfootballandfriendshipassociation'

export const LOGIN_CLUB_NAME = harnessState === 'longclub' ? LONG_LOGIN_CLUB_NAME : DEFAULT_CLUB_NAME
export const LOGIN_MOTTO = harnessState === 'longmotto' ? LONG_MOTTO : DEFAULT_MOTTO

// The stored path of an uploaded photo, and what the signed URL read answers
// with for it. An inline SVG rather than a file, so the harness makes no
// request and no real photograph of anybody exists in this repository.
export const AVATAR_PATH = 'avatars/coach-me/photo.png'
export const AVATAR_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
      '<rect width="144" height="144" fill="#1f43d6"/>' +
      '<circle cx="72" cy="56" r="26" fill="#f4c020"/>' +
      '<path d="M16 144c0-31 25-52 56-52s56 21 56 52z" fill="#f4c020"/>' +
      '</svg>',
  )

const LONG_VALUES = harnessState === 'longvalues'
const WITH_PHOTO =
  harnessState === 'photo' ||
  harnessState === 'photoinflight' ||
  harnessState === 'photofails' ||
  harnessState === 'photoslow'

export const ACCOUNT_SIGNIN_EMAIL = LONG_VALUES ? LONG_ACCOUNT_EMAIL : ACCOUNT_EMAIL
export const ACCOUNT_CLUB_NAME = LONG_VALUES ? LONG_CLUB_NAME : DEFAULT_CLUB_NAME

export interface ProfileEdits {
  fullName: string
  avatarPath: string | null
  teamId: string | null
}

let editsNow: ProfileEdits = {
  fullName: LONG_VALUES ? LONG_ACCOUNT_NAME : ACCOUNT_NAME,
  avatarPath: WITH_PHOTO ? AVATAR_PATH : null,
  teamId: LONG_VALUES ? LONG_TEAM.id : 'titans',
}
const editListeners = new Set<() => void>()

export const profileEdits = {
  // A stable reference between writes, which is what useSyncExternalStore
  // requires: a fresh object every read is an infinite render loop.
  read: (): ProfileEdits => editsNow,
  write(patch: Partial<ProfileEdits>) {
    editsNow = { ...editsNow, ...patch }
    for (const l of editListeners) l()
  },
  subscribe(l: () => void): () => void {
    editListeners.add(l)
    return () => {
      editListeners.delete(l)
    }
  },
}

/* ---- the one auth flag a press can change ------------------------------
   Set Password's success is not a message: it calls clearNeedsPassword, the
   guard stops rendering it and the application appears. That hand off is the
   whole point of the screen, so the harness has to be able to make it happen
   rather than draw it. A tiny store, for the same reason profileEdits is one:
   without it the press would report success while the screen stayed exactly
   where it was, and every proof of the hand off would hold whether or not the
   press did anything.

   The boolean is the snapshot, so it is stable by value and
   useSyncExternalStore has nothing to loop on. */
let needsPasswordNow = harnessAuth === 'needspassword'
const authListeners = new Set<() => void>()

export const authFlags = {
  read: (): boolean => needsPasswordNow,
  clearNeedsPassword() {
    if (!needsPasswordNow) return
    needsPasswordNow = false
    for (const l of authListeners) l()
  },
  subscribe(l: () => void): () => void {
    authListeners.add(l)
    return () => {
      authListeners.delete(l)
    }
  },
}

// Every column a filter predicate can name, so the harness applies the REAL
// predicates (activityQueryConditions) rather than a second filter rule
// written out here. A state a screenshot claims is then reached the way a
// coach reaches it: by selecting the filter.
const COLUMN_OF: Record<string, (e: ActivityEvent) => string | null> = {
  occurred_at: (e) => e.occurredAt,
  actor_id: (e) => e.actorId,
  entity_type: (e) => e.entityType,
  action: (e) => e.action,
  team_id: (e) => e.teamId,
  season_id: (e) => e.seasonId,
  source: (e) => e.source,
  batch_id: (e) => e.batchId,
}

export function activityRowsFor(filters: ActivityFilters, s: HarnessState): ActivityEvent[] {
  if (s === 'empty') return []
  const rows = s === 'longnames' ? [...LONG_NAME_EVENTS, ...ACTIVITY_EVENTS] : ACTIVITY_EVENTS
  const conditions = activityQueryConditions(filters)
  return rows.filter((e) =>
    conditions.every((c) => {
      const v = COLUMN_OF[c.column]?.(e) ?? null
      if (v === null) return false
      if (c.op === 'eq') return v === c.value
      return c.op === 'gte' ? v >= c.value : v < c.value
    }),
  )
}

// The pages a keyset read would have handed back. hasNextPage is derived the
// way the real hook derives it, from a FULL last page rather than from a total,
// so the harness offers Load more exactly when the product does.
export function activityPages(rows: ActivityEvent[], pageCount: number): ActivityEvent[][] {
  return Array.from({ length: pageCount }, (_, i) => rows.slice(i * ACTIVITY_PAGE_SIZE, (i + 1) * ACTIVITY_PAGE_SIZE))
}

export const activityHasNext = (pages: ActivityEvent[][]): boolean =>
  (pages[pages.length - 1]?.length ?? 0) === ACTIVITY_PAGE_SIZE

/* ---- Feedback (VISUAL-02) ---------------------------------------------
   The club's request and bug log. Every name here is invented; no real
   member, coach or child appears, and nothing on this screen holds child
   data at all.

   The rows exist to put every axis of the screen on one page at once, so a
   single render covers what would otherwise be five states: all three kinds,
   all five statuses, an item the signed in member filed and items somebody
   else did, an item already promoted to a GitHub issue and items that are
   not, and a thread with comments beside rows with none. Ownership is not a
   state either: `coach-me` is the harness's signed in member, so the same
   list shows an owner's row and a stranger's row side by side. */
const FEEDBACK_MEMBER_ME = 'coach-me'
const FEEDBACK_MEMBER_2 = 'member-2'
const FEEDBACK_MEMBER_3 = 'member-3'

/* The strings this screen renders at whatever length a club types. The title
   is a single unbroken token followed by words, which is the case a wrapping
   rule has to survive; a spaced phrase breaks under any rule at all and would
   guard nothing. */
const LONG_FEEDBACK_TITLE =
  'Sessionplannerrecalculatesthetotalminuteswrongly when a warm up is moved between phases on a phone'
const LONG_FEEDBACK_AUTHOR = 'Christabel Fotheringay-Wallington-Smythe'
const LONG_FEEDBACK_BODY =
  'Reproduced on three separate evenings with the same squad. Drag the warm up out of its phase and back again, ' +
  'and the total at the foot of the planner keeps the old figure until the page is reloaded, which makes a ' +
  'ninety minute session read as a hundred and five. It matters because the total is what the coaches use to ' +
  'decide whether the last game fits before the lights go off, and nobody reloads a page on a touchline.'
const LONG_FEEDBACK_COMMENT =
  'Seen it too, on both an old phone and a new one, so it is not the device. It only happens after a drag; ' +
  'editing a duration in place recalculates correctly every time, which is probably the clue. Happy to sit ' +
  'with whoever picks this up and show them on the pitch rather than describing it again here.'

const hoursAgo = (n: number): string => new Date(Date.now() - n * 3_600_000).toISOString()

const feedback = (over: Partial<FeedbackItem> & Pick<FeedbackItem, 'id' | 'kind' | 'title' | 'status'>): FeedbackItem => ({
  body: '',
  createdBy: FEEDBACK_MEMBER_2,
  createdAt: hoursAgo(48),
  updatedAt: hoursAgo(48),
  githubIssueNumber: null,
  githubIssueUrl: null,
  ...over,
})

const ISSUE = (n: number) => `https://github.com/sense360store/OTJ/issues/${n}`

export const FEEDBACK: FeedbackItem[] = [
  feedback({
    id: 'fb-1',
    kind: 'bug',
    title: 'Timer drifts on the live screen',
    status: 'new',
    createdBy: FEEDBACK_MEMBER_ME,
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
    body: 'After ten minutes the clock reads about two seconds fast against a stopwatch.',
  }),
  feedback({
    id: 'fb-2',
    kind: 'feature',
    title: 'A kit checklist on the session setup',
    status: 'planned',
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(30),
    body: 'Bibs, balls, cones and the first aid bag, ticked off before anyone leaves the car park.',
    githubIssueNumber: 128,
    githubIssueUrl: ISSUE(128),
  }),
  feedback({
    id: 'fb-3',
    kind: 'general',
    title: 'Directions for the away venues',
    status: 'in_progress',
    createdBy: FEEDBACK_MEMBER_3,
    createdAt: hoursAgo(74),
    updatedAt: hoursAgo(74),
    body: 'A map link on the venue would save three phone calls every Saturday morning.',
  }),
  feedback({
    id: 'fb-4',
    kind: 'feature',
    title: 'Show the bib colour on the group view',
    status: 'done',
    createdBy: FEEDBACK_MEMBER_ME,
    createdAt: hoursAgo(200),
    updatedAt: hoursAgo(200),
    githubIssueNumber: 121,
    githubIssueUrl: ISSUE(121),
  }),
  feedback({
    id: 'fb-5',
    kind: 'bug',
    title: 'Duplicate sessions after a Spond sync',
    status: 'declined',
    createdAt: hoursAgo(900),
    updatedAt: hoursAgo(900),
    body: 'Could not reproduce it after the August fix, so closing this one. Reopen it if it happens again.',
  }),
]

const LONG_FEEDBACK: FeedbackItem[] = [
  feedback({
    id: 'fb-long',
    kind: 'bug',
    title: LONG_FEEDBACK_TITLE,
    status: 'planned',
    createdBy: 'member-long',
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
    body: LONG_FEEDBACK_BODY,
  }),
  ...FEEDBACK,
]

const comment = (
  over: Partial<FeedbackComment> & Pick<FeedbackComment, 'id' | 'feedbackId' | 'body'>,
): FeedbackComment => ({
  createdBy: FEEDBACK_MEMBER_2,
  createdAt: hoursAgo(20),
  updatedAt: hoursAgo(20),
  ...over,
})

/* One thread with three comments and one with a single comment, so a driver
   can open a populated thread and an almost empty one without a state of its
   own. Every other row has none, which is the third case. */
const FEEDBACK_COMMENTS: Record<string, FeedbackComment[]> = {
  'fb-2': [
    comment({
      id: 'fbc-1',
      feedbackId: 'fb-2',
      body: 'Would this be per team, or one list for the whole club?',
      createdAt: hoursAgo(26),
      updatedAt: hoursAgo(26),
    }),
    comment({
      id: 'fbc-2',
      feedbackId: 'fb-2',
      body: 'Per team. The under sevens carry different kit from the under elevens.',
      createdBy: FEEDBACK_MEMBER_ME,
      createdAt: hoursAgo(22),
      updatedAt: hoursAgo(22),
    }),
    comment({
      id: 'fbc-3',
      feedbackId: 'fb-2',
      body: LONG_FEEDBACK_COMMENT,
      createdBy: FEEDBACK_MEMBER_3,
      createdAt: hoursAgo(9),
      // Later than createdAt, which is what makes the row say "edited".
      updatedAt: hoursAgo(8),
    }),
  ],
  'fb-3': [
    comment({
      id: 'fbc-4',
      feedbackId: 'fb-3',
      body: 'Venues have a name in the Hub already, so this is probably a small one.',
      createdBy: FEEDBACK_MEMBER_3,
      createdAt: hoursAgo(70),
      updatedAt: hoursAgo(70),
    }),
  ],
  'fb-long': [
    comment({
      id: 'fbc-5',
      feedbackId: 'fb-long',
      body: LONG_FEEDBACK_COMMENT,
      createdBy: 'member-long',
      createdAt: hoursAgo(4),
      updatedAt: hoursAgo(4),
    }),
  ],
}

export const FEEDBACK_FOR = (s: HarnessState): FeedbackItem[] =>
  s === 'empty' ? [] : s === 'longnames' ? LONG_FEEDBACK : FEEDBACK

export const FEEDBACK_COMMENTS_FOR = (feedbackId: string): FeedbackComment[] =>
  FEEDBACK_COMMENTS[feedbackId] ?? []

// The badge on a collapsed row, derived from the same threads the expanded
// row reads, so the number on the row and the number of comments under it
// cannot disagree.
export const FEEDBACK_COMMENT_COUNTS = (s: HarnessState): Record<string, number> =>
  Object.fromEntries(
    FEEDBACK_FOR(s).map((item) => [item.id, FEEDBACK_COMMENTS_FOR(item.id).length]),
  )

/* The members the log resolves an author id through. The three ids are the
   feedback fixtures' own; `coach-them`, which the SESSIONS fixtures use, is
   deliberately absent, so Home and Sessions still fall back to "Another
   coach" and no shot those screens take moves. */
export const FEEDBACK_MEMBERS = (s: HarnessState): Record<string, Member> => ({
  [FEEDBACK_MEMBER_ME]: member(FEEDBACK_MEMBER_ME, 'Sam Whitfield'),
  [FEEDBACK_MEMBER_2]: member(FEEDBACK_MEMBER_2, 'Priya Raghunathan'),
  [FEEDBACK_MEMBER_3]: member(FEEDBACK_MEMBER_3, 'Marguerite Ashby-Fotheringay'),
  ...(s === 'longnames' ? { 'member-long': member('member-long', LONG_FEEDBACK_AUTHOR) } : {}),
})

// What the promote Edge Function answers. The warning is the partial outcome:
// the public issue exists and writing its number back to the club's own row
// did not settle.
export const PROMOTE_RESULT = {
  ok: true,
  alreadyPromoted: false,
  issueNumber: 214,
  issueUrl: ISSUE(214),
  warning: '',
}
export const PROMOTE_WARNING =
  'The issue was created, but the feedback item could not be updated with its number. Refresh to check.'

/* ---- the feedback rows a press can change ------------------------------
   A tiny mutable store, for the same reason `profileEdits` is one: several of
   this screen's outcomes ARE a change to the list, and a stub that answered
   with the same rows either way would make every proof of them hold whether
   or not the press did anything. A deleted row has to leave (which is what
   the focus rule waits for), a status change has to stick (the select is
   controlled, so without it the value snaps back and the screenshot shows a
   control that refused the coach), a filed item has to appear, and a posted
   comment has to join the thread.

   References are stable between writes, which is what useSyncExternalStore
   requires: a fresh array or object on every read is an infinite render loop.
   The counts are recomputed on write rather than on read for exactly that
   reason. */
let feedbackRows: FeedbackItem[] = FEEDBACK_FOR(harnessState)
let commentRows: Record<string, FeedbackComment[]> = Object.fromEntries(
  feedbackRows.map((item) => [item.id, FEEDBACK_COMMENTS_FOR(item.id)]),
)
let commentCounts: Record<string, number> = FEEDBACK_COMMENT_COUNTS(harnessState)
const NO_COMMENTS: FeedbackComment[] = []
const feedbackListeners = new Set<() => void>()

function feedbackChanged() {
  commentCounts = Object.fromEntries(feedbackRows.map((item) => [item.id, (commentRows[item.id] ?? NO_COMMENTS).length]))
  for (const l of feedbackListeners) l()
}

let filedCount = 0

export const feedbackStore = {
  items: (): FeedbackItem[] => feedbackRows,
  comments: (feedbackId: string): FeedbackComment[] => commentRows[feedbackId] ?? NO_COMMENTS,
  counts: (): Record<string, number> => commentCounts,
  subscribe(l: () => void): () => void {
    feedbackListeners.add(l)
    return () => {
      feedbackListeners.delete(l)
    }
  },
  insert(input: { kind: FeedbackItem['kind']; title: string; body: string }) {
    filedCount += 1
    const row = feedback({
      id: `fb-new-${filedCount}`,
      kind: input.kind,
      title: input.title.trim(),
      status: 'new',
      createdBy: FEEDBACK_MEMBER_ME,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      body: input.body.trim(),
    })
    feedbackRows = [row, ...feedbackRows]
    commentRows = { ...commentRows, [row.id]: NO_COMMENTS }
    feedbackChanged()
  },
  update(id: string, input: { kind: FeedbackItem['kind']; title: string; body: string }) {
    feedbackRows = feedbackRows.map((r) =>
      r.id === id ? { ...r, kind: input.kind, title: input.title.trim(), body: input.body.trim() } : r,
    )
    feedbackChanged()
  },
  remove(id: string) {
    feedbackRows = feedbackRows.filter((r) => r.id !== id)
    feedbackChanged()
  },
  setStatus(id: string, status: FeedbackItem['status']) {
    feedbackRows = feedbackRows.map((r) => (r.id === id ? { ...r, status } : r))
    feedbackChanged()
  },
  promote(id: string, issueNumber: number, issueUrl: string) {
    feedbackRows = feedbackRows.map((r) =>
      r.id === id ? { ...r, githubIssueNumber: issueNumber, githubIssueUrl: issueUrl } : r,
    )
    feedbackChanged()
  },
  addComment(feedbackId: string, body: string) {
    const row = comment({
      id: `fbc-new-${Date.now()}`,
      feedbackId,
      body: body.trim(),
      createdBy: FEEDBACK_MEMBER_ME,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    commentRows = { ...commentRows, [feedbackId]: [...(commentRows[feedbackId] ?? NO_COMMENTS), row] }
    feedbackChanged()
  },
  editComment(id: string, body: string) {
    commentRows = Object.fromEntries(
      Object.entries(commentRows).map(([k, list]) => [
        k,
        list.map((c) => (c.id === id ? { ...c, body: body.trim(), updatedAt: new Date().toISOString() } : c)),
      ]),
    )
    feedbackChanged()
  },
  removeComment(id: string) {
    commentRows = Object.fromEntries(
      Object.entries(commentRows).map(([k, list]) => [k, list.filter((c) => c.id !== id)]),
    )
    feedbackChanged()
  },
}

/* ---- Admin Users and Admin Teams (VISUAL-02) --------------------------
   The club's people, its roles, the capability catalogue and the grid that
   maps the two. Nothing here is a real person: the names are invented, the
   emails are .invalid addresses that can never resolve, and none of it
   reaches the application, because nothing under src/ imports this file.

   The MEMBER SET is chosen to cover the matrix the slice is accepted
   against in one render rather than one state per case: the signed in
   holder, another ordinary member, a second admin (so removal is offered by
   default), a member with allTeams, a member on specific teams, a member
   holding three roles, a member holding a custom role, a member holding
   none, and the invited and active states across them. */

const ADMIN_ROLE_ADMIN: RoleInfo = { id: 'role-admin', key: 'admin', label: 'Admin', system: true }
const ADMIN_ROLE_MANAGER: RoleInfo = { id: 'role-manager', key: 'manager', label: 'Manager', system: true }
const ADMIN_ROLE_COACH: RoleInfo = { id: 'role-coach', key: 'coach', label: 'Coach', system: true }
const ADMIN_ROLE_PARENT: RoleInfo = { id: 'role-parent', key: 'parent', label: 'Parent', system: true }
const ADMIN_ROLE_KIT: RoleInfo = { id: 'role-kit', key: 'kit_officer', label: 'Kit Officer', system: false }

// The four system roles in privilege order, then the custom one, which is
// the order useRoles sorts them into.
const ADMIN_ROLES: RoleInfo[] = [
  ADMIN_ROLE_ADMIN,
  ADMIN_ROLE_MANAGER,
  ADMIN_ROLE_COACH,
  ADMIN_ROLE_PARENT,
  ADMIN_ROLE_KIT,
]

// A custom role whose label is as long as a club would really make one, for
// the `longnames` state. It is a column heading in the capability grid, which
// is the narrowest place a long string lands on these two screens.
const ADMIN_ROLE_LONG: RoleInfo = {
  id: 'role-long',
  key: 'safeguarding_and_welfare_officer',
  label: 'Safeguarding and Welfare Officer',
  system: false,
}

const adminMember = (over: Partial<Member> & Pick<Member, 'id' | 'fullName'>): Member => ({
  avatar: null,
  avatarUrl: null,
  role: 'coach',
  teamId: null,
  joined: '2026-02-11',
  roles: [ADMIN_ROLE_COACH],
  teamIds: [],
  allTeams: false,
  ...over,
})

/* The signed in member is `coach-me`, which is what fixtures.me and the auth
   stub both say, so exactly one row reads "(you)" and carries no Remove. */
const ADMIN_MEMBERS: Member[] = [
  adminMember({
    id: 'coach-me',
    fullName: 'Sam Ashworth',
    joined: '2025-08-04',
    roles: [ADMIN_ROLE_ADMIN, ADMIN_ROLE_COACH],
    allTeams: true,
  }),
  adminMember({
    id: 'member-2',
    fullName: 'Priya Raghunathan',
    joined: '2025-09-18',
    roles: [ADMIN_ROLE_COACH],
    teamIds: ['titans', 'trojans'],
  }),
  adminMember({
    id: 'member-3',
    fullName: 'Marguerite Ashby-Fotheringay',
    joined: '2026-01-06',
    roles: [ADMIN_ROLE_ADMIN],
    allTeams: true,
  }),
  adminMember({
    id: 'member-4',
    fullName: 'Tom Brearley',
    joined: '2026-08-20',
    roles: [ADMIN_ROLE_KIT],
    teamIds: ['gladiators'],
  }),
  adminMember({
    id: 'member-5',
    fullName: 'Jo Hartley',
    joined: '2026-08-26',
    // No roles at all: the state the row marks in danger, because a member
    // holding none has no write access anywhere.
    roles: [],
  }),
  adminMember({
    id: 'member-6',
    fullName: 'Dev Chatterjee',
    joined: '2025-11-30',
    roles: [ADMIN_ROLE_MANAGER, ADMIN_ROLE_COACH, ADMIN_ROLE_KIT],
    teamIds: ['spartans', 'argonauts'],
  }),
]

/* The member whose name is as long as a club could really type one, and
   deliberately hyphenated rather than spaced: a spaced name breaks by itself
   and proves nothing about the wrapping rules. */
const ADMIN_MEMBER_LONG: Member = adminMember({
  id: 'member-long',
  fullName: 'Christabel Fotheringay-Wallington-Smythe',
  joined: '2026-03-02',
  roles: [ADMIN_ROLE_LONG, ADMIN_ROLE_COACH],
  teamIds: ['titans'],
})

/* Exactly one Admin, and it is somebody else. That is the only arrangement
   in which the last admin lock is reachable on a row the signed in member can
   act on: their own row carries no Remove at all, so a club where they are
   the sole admin proves the lock nowhere. */
const ADMIN_MEMBERS_LAST_ADMIN: Member[] = ADMIN_MEMBERS.map((m) =>
  m.id === 'coach-me'
    ? { ...m, roles: [ADMIN_ROLE_COACH], allTeams: false, teamIds: ['titans'] }
    : m.id === 'member-3'
      ? m
      : { ...m, roles: m.roles.filter((r) => r.key !== 'admin') },
)

const ADMIN_MEMBERS_FOR = (s: HarnessState): Member[] =>
  s === 'lastadmin'
    ? ADMIN_MEMBERS_LAST_ADMIN
    : s === 'longnames'
      ? [...ADMIN_MEMBERS, ADMIN_MEMBER_LONG]
      : ADMIN_MEMBERS

const ADMIN_ROLES_FOR = (s: HarnessState): RoleInfo[] =>
  s === 'longnames' ? [...ADMIN_ROLES, ADMIN_ROLE_LONG] : ADMIN_ROLES

// Invited until they first sign in, then active. Two of the six have not
// signed in yet, so both badges render in one shot.
const ADMIN_MEMBER_STATES: Record<string, 'invited' | 'active'> = {
  'coach-me': 'active',
  'member-2': 'active',
  'member-3': 'active',
  'member-4': 'invited',
  'member-5': 'invited',
  'member-6': 'active',
  'member-long': 'active',
}

/* The capability catalogue, in the shape the real table has: a key, a label
   and one sentence. It covers every entity the screen's own render order
   names, so the ordering rule is exercised rather than asserted, and it
   carries BOTH reserved keys, which are the two the grid locks on to Admin
   and offers nowhere else. */
const ADMIN_CAPABILITIES: Capability[] = [
  { key: 'drills.create', label: 'Create drills', description: 'Add drills to the club library.' },
  { key: 'drills.manage', label: 'Manage drills', description: 'Edit or delete any drill in the club.' },
  { key: 'media.create', label: 'Add media', description: 'Upload videos, images and PDFs.' },
  { key: 'media.manage', label: 'Manage media', description: 'Edit or delete any media item in the club.' },
  { key: 'templates.create', label: 'Create templates', description: 'Build reusable session templates.' },
  { key: 'templates.manage', label: 'Curate templates', description: 'Mark a template official for the club.' },
  { key: 'programmes.create', label: 'Create programmes', description: 'Build a multi week programme.' },
  { key: 'sessions.create', label: 'Plan sessions', description: 'Build and run training sessions.' },
  { key: 'players.view', label: 'See registered players', description: "Read the club's player register." },
  { key: 'players.manage', label: 'Manage registered players', description: 'Add, edit and move players between teams.' },
  { key: 'players.import', label: 'Import players', description: 'Bring a squad in from a file or from Spond.' },
  { key: 'players.export', label: 'Export players', description: 'Download the register as a spreadsheet.' },
  { key: 'players.delete', label: 'Delete players', description: 'Permanently remove a player and their history.' },
  { key: 'seasons.manage', label: 'Manage seasons', description: 'Open, activate and archive registration seasons.' },
  { key: 'teams.manage', label: 'Manage teams', description: "Add, rename and remove the club's teams." },
  { key: 'users.manage', label: 'Manage users', description: 'Invite members, set roles and remove people.' },
  { key: 'club.manage', label: 'Manage the club', description: 'Edit the club record and its integrations.' },
  { key: 'audit.view', label: 'See the activity log', description: 'Read the club wide record of what changed.' },
  { key: 'shares.create', label: 'Create public links', description: 'Share a drill or a session outside the club.' },
  { key: 'shares.manage', label: 'Manage public links', description: 'Review and revoke any public link in the club.' },
]

const capsFor = (roleId: string, keys: string[]): RoleCapability[] =>
  keys.map((capability) => ({ roleId, capability }))

// Admin holds everything, including the two reserved keys the grid draws
// locked. Every other role is a subset, so a tick is on for some roles and
// off for others in every row a driver might press.
const ADMIN_ROLE_CAPABILITIES: RoleCapability[] = [
  ...capsFor(ADMIN_ROLE_ADMIN.id, ADMIN_CAPABILITIES.map((c) => c.key)),
  ...capsFor(ADMIN_ROLE_MANAGER.id, [
    'drills.create', 'drills.manage', 'media.create', 'media.manage', 'templates.create', 'templates.manage',
    'programmes.create', 'sessions.create', 'players.view', 'players.manage', 'players.import', 'players.export',
    'seasons.manage', 'teams.manage', 'audit.view', 'shares.create', 'shares.manage',
  ]),
  ...capsFor(ADMIN_ROLE_COACH.id, [
    'drills.create', 'media.create', 'templates.create', 'programmes.create', 'sessions.create',
    'players.view', 'players.manage', 'shares.create',
  ]),
  ...capsFor(ADMIN_ROLE_PARENT.id, []),
  ...capsFor(ADMIN_ROLE_KIT.id, ['players.view']),
  ...capsFor(ADMIN_ROLE_LONG.id, ['players.view', 'audit.view']),
]

// The one member with public links still working, which is the advisory
// warning inside the removal dialog. Everybody else has none, so the same
// dialog is reachable both with the warning and without it.
export const ADMIN_SHARE_COUNTS: Record<string, number> = { 'member-2': 3 }

// The email and name a driver types into the invite form.
export const ADMIN_INVITE_EMAIL = 'new.coach@example.invalid'
export const ADMIN_INVITE_NAME = 'Alex Nowell'
// And the label a driver types into the new role field. Its key is derived by
// the product's own roleKeyFromLabel, so the hint under the field is the
// product's answer rather than a fixture's.
export const ADMIN_NEW_ROLE = 'Team Manager'
export const ADMIN_NEW_TEAM = 'Centurions'

/* ---- the rows a press can change --------------------------------------
   A tiny mutable store, for the same reason `feedbackStore` is one: most of
   what these two screens do IS a change to a list, and a stub that answered
   with the same rows either way would make every proof of a press hold
   whether or not the press did anything. A removed member has to leave the
   list (which is what the focus rule waits for), a renamed team has to keep
   its new name, an invited member has to appear, and a capability tick has to
   stick or the grid's pending change count is drawn rather than derived.

   References are stable between writes, which is what useSyncExternalStore
   requires: a fresh array on every read is an infinite render loop. */
let adminMembers: Member[] = ADMIN_MEMBERS_FOR(harnessState)
let adminRoles: RoleInfo[] = ADMIN_ROLES_FOR(harnessState)
/* Teams start as whatever every other screen already reads, so putting them
   behind the store moves no existing shot: only a press on the Teams screen
   changes them. `noteams` is the club that has never added one. */
let adminTeams: Team[] = harnessState === 'noteams' ? [] : ACTIVITY_TEAMS_FOR(harnessState)
let adminRoleCaps: RoleCapability[] = ADMIN_ROLE_CAPABILITIES
let adminStates: Record<string, 'invited' | 'active'> = ADMIN_MEMBER_STATES
const adminListeners = new Set<() => void>()
const adminChanged = () => {
  for (const l of adminListeners) l()
}

let invitedCount = 0
let createdRoleCount = 0
let createdTeamCount = 0

export const adminStore = {
  members: (): Member[] => adminMembers,
  roles: (): RoleInfo[] => adminRoles,
  teams: (): Team[] => adminTeams,
  roleCaps: (): RoleCapability[] => adminRoleCaps,
  states: (): Record<string, 'invited' | 'active'> => adminStates,
  capabilities: (): Capability[] => ADMIN_CAPABILITIES,
  subscribe(l: () => void): () => void {
    adminListeners.add(l)
    return () => {
      adminListeners.delete(l)
    }
  },
  // The invite creates the auth user at once, so the new profile is already
  // in the list, in the invited state until they first sign in. That is what
  // useInviteUser's own comment says the product does.
  invite(input: { email: string; fullName: string; roleIds: string[]; teamIds: string[]; allTeams: boolean }) {
    invitedCount += 1
    const id = `member-invited-${invitedCount}`
    adminMembers = [
      ...adminMembers,
      adminMember({
        id,
        fullName: input.fullName,
        roles: adminRoles.filter((r) => input.roleIds.includes(r.id)),
        teamIds: input.allTeams ? [] : input.teamIds,
        allTeams: input.allTeams,
      }),
    ]
    adminStates = { ...adminStates, [id]: 'invited' }
    adminChanged()
  },
  removeMember(id: string) {
    adminMembers = adminMembers.filter((m) => m.id !== id)
    adminChanged()
  },
  setMemberRoles(memberId: string, roleIds: string[]) {
    adminMembers = adminMembers.map((m) =>
      m.id === memberId ? { ...m, roles: adminRoles.filter((r) => roleIds.includes(r.id)) } : m,
    )
    adminChanged()
  },
  setMemberTeams(memberId: string, teamIds: string[]) {
    adminMembers = adminMembers.map((m) => (m.id === memberId ? { ...m, teamIds } : m))
    adminChanged()
  },
  setMemberAllTeams(memberId: string, allTeams: boolean) {
    adminMembers = adminMembers.map((m) => (m.id === memberId ? { ...m, allTeams } : m))
    adminChanged()
  },
  createRole(key: string, label: string) {
    createdRoleCount += 1
    adminRoles = [...adminRoles, { id: `role-new-${createdRoleCount}`, key, label, system: false }]
    adminChanged()
  },
  renameRole(id: string, label: string) {
    adminRoles = adminRoles.map((r) => (r.id === id ? { ...r, label } : r))
    adminMembers = adminMembers.map((m) => ({
      ...m,
      roles: m.roles.map((r) => (r.id === id ? { ...r, label } : r)),
    }))
    adminChanged()
  },
  // Deleting a role cascades its assignments and its capability ticks away,
  // which is what the dialog says it does.
  deleteRole(id: string) {
    adminRoles = adminRoles.filter((r) => r.id !== id)
    adminRoleCaps = adminRoleCaps.filter((rc) => rc.roleId !== id)
    adminMembers = adminMembers.map((m) => ({ ...m, roles: m.roles.filter((r) => r.id !== id) }))
    adminChanged()
  },
  saveRoleCaps(input: { adds: RoleCapability[]; removes: RoleCapability[] }) {
    const gone = new Set(input.removes.map((r) => `${r.roleId}:${r.capability}`))
    adminRoleCaps = [
      ...adminRoleCaps.filter((rc) => !gone.has(`${rc.roleId}:${rc.capability}`)),
      ...input.adds,
    ]
    adminChanged()
  },
  insertTeam(name: string) {
    createdTeamCount += 1
    adminTeams = [...adminTeams, { id: `team-new-${createdTeamCount}`, name, bibColour: null }]
    adminChanged()
  },
  renameTeam(id: string, name: string) {
    adminTeams = adminTeams.map((t) => (t.id === id ? { ...t, name } : t))
    adminChanged()
  },
  // Removing a team clears the references rather than deleting anything, so
  // members keep their rows with the team taken off them. Nothing about a
  // session, a person or a player is removed here, which is exactly what the
  // dialog promises.
  deleteTeam(id: string) {
    adminTeams = adminTeams.filter((t) => t.id !== id)
    adminMembers = adminMembers.map((m) => ({ ...m, teamIds: m.teamIds.filter((t) => t !== id) }))
    adminChanged()
  },
  setTeamBib(teamId: string, bibColour: string | null) {
    adminTeams = adminTeams.map((t) => (t.id === teamId ? { ...t, bibColour } : t))
    adminChanged()
  },
}
