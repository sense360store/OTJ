import { useLocation, useNavigate } from 'react-router-dom'
import { Crest } from './Crest'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { UserAvatar } from './UserAvatar'
import { useDrills, useMyCapabilities } from '../lib/queries'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../lib/data'
import { useClubBranding } from '../hooks/useClubBranding'
import { screenFromPath } from '../lib/screen'

interface NavItem {
  id: string
  label: string
  icon: IconComponent
  to: string
}
interface NavSection {
  group: string | null
  items: NavItem[]
}

const NAV: NavSection[] = [
  { group: null, items: [{ id: 'home', label: 'Home', icon: Icon.home, to: '/' }] },
  {
    group: 'Plan',
    items: [
      { id: 'library', label: 'Drill Library', icon: Icon.grid, to: '/library' },
      { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
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
  {
    group: 'Admin',
    items: [
      { id: 'admin-club', label: 'Club', icon: Icon.star, to: '/admin/club' },
      { id: 'admin-users', label: 'Users', icon: Icon.users, to: '/admin/users' },
      { id: 'admin-teams', label: 'Teams', icon: Icon.flag, to: '/admin/teams' },
    ],
  },
]

// Capabilities drive which nav items show, granting on any held role, so the
// nav tracks the tick grid; the route guards and RLS enforce the same
// boundary. Items without a capability are read surfaces open to every
// member, parents included.
const ITEM_CAP: Record<string, string> = {
  planner: 'sessions.create',
  'admin-club': 'club.manage',
  'admin-users': 'users.manage',
  'admin-teams': 'teams.manage',
}

export function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const screen = screenFromPath(pathname)
  const { profile, role, signOut } = useAuth()
  const { name, motto } = useClubBranding()
  const { data: drills } = useDrills()
  const { caps } = useMyCapabilities()
  const showItem = (id: string) => {
    const cap = ITEM_CAP[id]
    return !cap || caps.has(cap)
  }
  const isActive = (id: string) => screen === id || (id === 'library' && screen === 'drill')
  // The library badge is the live drill count, shown once the read resolves.
  const badgeFor = (id: string): string | undefined =>
    id === 'library' && drills ? String(drills.length) : undefined

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <Crest />
        <div>
          <h1>{name ?? 'Ossett Town Juniors'}</h1>
          <p>Training Hub</p>
        </div>
      </div>
      <div className="sb-tag">
        <em>"{motto ?? 'Where football and friendships flourish'}"</em>
        <span className="sb-accred">
          <Icon.star style={{ width: 12, height: 12 }} />
          FA 2-Star Accredited
        </span>
      </div>
      <div className="sb-scroll">
        {NAV.map((sec, i) => {
          const items = sec.items.filter((it) => showItem(it.id))
          if (items.length === 0) return null
          return (
            <div key={i}>
              {sec.group && <div className="sb-section">{sec.group}</div>}
              {items.map((it) => (
                <button
                  key={it.id}
                  className={'nav-item' + (isActive(it.id) ? ' active' : '')}
                  onClick={() => navigate(it.to)}
                >
                  <it.icon className="nav-ico" />
                  {it.label}
                  {badgeFor(it.id) && <span className="nav-badge">{badgeFor(it.id)}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="sb-foot">
        <div className="coach-chip">
          {/* The identity block opens the account screen; log out stays its
              own button beside it. */}
          <button
            title="Account"
            onClick={() => navigate('/account')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 0,
              padding: 0,
              textAlign: 'left',
              color: 'inherit',
              font: 'inherit',
            }}
          >
            <UserAvatar name={profile?.full_name} fallbackText={profile?.avatar} path={profile?.avatar_url} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{profile?.full_name ?? 'Coach'}</b>
              {/* The display primary role; the full set lives on the Users
                  screen and the Account screen. */}
              <span className="role-badge">{role ? ROLE_LABELS[role] : 'Coach'}</span>
            </div>
          </button>
          <button className="icon-btn" title="Log out" onClick={() => void signOut()}>
            <Icon.logout />
          </button>
        </div>
      </div>
    </aside>
  )
}
