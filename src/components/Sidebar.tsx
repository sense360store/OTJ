import { useLocation, useNavigate } from 'react-router-dom'
import { Crest } from './Crest'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { drills } from '../lib/data'
import { useAuth } from '../hooks/useAuth'
import type { Role } from '../hooks/useAuth'
import { screenFromPath } from '../lib/screen'

interface NavItem {
  id: string
  label: string
  icon: IconComponent
  to: string
  badge?: string
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
      { id: 'library', label: 'Drill Library', icon: Icon.grid, to: '/library', badge: String(drills.length) },
      { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
      { id: 'planner', label: 'Session Planner', icon: Icon.layers, to: '/planner' },
    ],
  },
  {
    group: 'Content',
    items: [
      { id: 'templates', label: 'Templates', icon: Icon.book, to: '/templates' },
      { id: 'media', label: 'Media Library', icon: Icon.film, to: '/media' },
    ],
  },
]

// The role drives which nav items show. Coach and admin see everything in
// Phase 1; parent is read-only and loses the planning and template tools.
const ROLE_NAV: Record<Role, Set<string>> = {
  coach: new Set(['home', 'library', 'sessions', 'planner', 'templates', 'media']),
  admin: new Set(['home', 'library', 'sessions', 'planner', 'templates', 'media']),
  parent: new Set(['home', 'library', 'sessions', 'media']),
}

const ROLE_LABEL: Record<Role, string> = { coach: 'Coach', admin: 'Admin', parent: 'Parent' }

function initials(name: string | null): string {
  if (!name) return 'OTJ'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const screen = screenFromPath(pathname)
  const { profile, role, signOut } = useAuth()
  const allowed = ROLE_NAV[role ?? 'coach']
  const isActive = (id: string) => screen === id || (id === 'library' && screen === 'drill')

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <Crest />
        <div>
          <h1>Ossett Town Juniors</h1>
          <p>Training Hub</p>
        </div>
      </div>
      <div className="sb-tag">
        <em>"Where football and friendships flourish"</em>
        <span className="sb-accred">
          <Icon.star style={{ width: 12, height: 12 }} />
          FA 2-Star Accredited
        </span>
      </div>
      <div className="sb-scroll">
        {NAV.map((sec, i) => {
          const items = sec.items.filter((it) => allowed.has(it.id))
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
                  {it.badge && <span className="nav-badge">{it.badge}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="sb-foot">
        <div className="coach-chip">
          <div className="avatar">{profile?.avatar || initials(profile?.full_name ?? null)}</div>
          <div style={{ flex: 1 }}>
            <b>{profile?.full_name ?? 'Coach'}</b>
            <span className="role-badge">{role ? ROLE_LABEL[role] : 'Coach'}</span>
          </div>
          <button className="icon-btn" title="Log out" onClick={() => void signOut()}>
            <Icon.logout />
          </button>
        </div>
      </div>
    </aside>
  )
}
