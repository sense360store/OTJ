// The navigation model shared by the sidebar and the bottom nav, kept in its
// own module so those component files export only components. Capabilities
// drive which destinations show, granting on any held role, so the nav tracks
// the tick grid; the route guards and RLS enforce the same boundary.
//
// sessions.create is the coaching write capability and the same test the Home
// dispatch uses. A member holding it (a coach, an admin, or someone who also
// holds the parent role) gets the full nav; a member without it is a parent
// and gets two destinations, Home and Sessions, because their world is their
// team's schedule, not a browsable coaching database. The browse and authoring
// routes redirect parents to Home.
import { Icon } from './icons'
import type { IconComponent } from './icons'

export interface NavItem {
  id: string
  label: string
  icon: IconComponent
  to: string
}
export interface NavSection {
  group: string | null
  items: NavItem[]
}
export interface BottomItem {
  id: string
  label: string
  icon: IconComponent
  to: string
}

const HOME: NavItem = { id: 'home', label: 'Home', icon: Icon.home, to: '/' }
const SESSIONS: NavItem = { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' }

// The admin section rides in both navs, gated by capability, so admin logic is
// untouched by the coach and parent split.
const ADMIN_SECTION: NavSection = {
  group: 'Admin',
  items: [
    { id: 'admin-club', label: 'Club', icon: Icon.star, to: '/admin/club' },
    { id: 'admin-users', label: 'Users', icon: Icon.users, to: '/admin/users' },
    { id: 'admin-teams', label: 'Teams', icon: Icon.flag, to: '/admin/teams' },
    { id: 'admin-spond', label: 'Spond', icon: Icon.link, to: '/admin/spond' },
  ],
}

// Coaches and admins: the full grouped nav, the schedule sitting in the Plan
// group with the library, planner and programmes.
const FULL_NAV: NavSection[] = [
  { group: null, items: [HOME] },
  {
    group: 'Plan',
    items: [
      { id: 'library', label: 'Drill Library', icon: Icon.grid, to: '/library' },
      SESSIONS,
      { id: 'planner', label: 'Session Planner', icon: Icon.layers, to: '/planner' },
      { id: 'programmes', label: 'Programmes', icon: Icon.list, to: '/programmes' },
    ],
  },
  {
    group: 'Content',
    items: [
      { id: 'templates', label: 'Templates', icon: Icon.book, to: '/templates' },
      { id: 'media', label: 'Media Library', icon: Icon.film, to: '/media' },
    ],
  },
  ADMIN_SECTION,
]

// Parents: two destinations, Home and Sessions, with no Plan or Content groups.
const PARENT_NAV: NavSection[] = [{ group: null, items: [HOME, SESSIONS] }, ADMIN_SECTION]

// The mobile bottom nav, the planner slot following the same coaching write
// capability.
const PLANNER_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'planner', label: 'Plan', icon: Icon.layers, to: '/planner' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]
const PARENT_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
]

// Items without a capability are read surfaces open to every member, parents
// included; the keyed ones gate on the capability that backs them.
export const ITEM_CAP: Record<string, string> = {
  planner: 'sessions.create',
  'admin-club': 'club.manage',
  'admin-users': 'users.manage',
  'admin-teams': 'teams.manage',
  'admin-spond': 'club.manage',
}

// The sidebar nav layout for a capability set.
export function navSectionsFor(caps: ReadonlySet<string>): NavSection[] {
  return caps.has('sessions.create') ? FULL_NAV : PARENT_NAV
}

// The visible sidebar destinations for a capability set, sections flattened to
// the items the set opens. Exported for the nav test.
export function navItemsFor(caps: ReadonlySet<string>): NavItem[] {
  return navSectionsFor(caps)
    .flatMap((s) => s.items)
    .filter((it) => {
      const cap = ITEM_CAP[it.id]
      return !cap || caps.has(cap)
    })
}

// The bottom nav layout for a capability set. Exported for the nav test.
export function bottomItemsFor(caps: ReadonlySet<string>): BottomItem[] {
  return caps.has('sessions.create') ? PLANNER_ITEMS : PARENT_ITEMS
}
