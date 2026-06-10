import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { useAuth } from '../hooks/useAuth'
import { screenFromPath } from '../lib/screen'

interface BottomItem {
  id: string
  label: string
  icon: IconComponent
  to: string
}

const COACH_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'planner', label: 'Plan', icon: Icon.layers, to: '/planner' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]

// Parents are read-only and lose the planner; templates take its slot so the
// whole parent surface stays reachable on a phone.
const PARENT_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'templates', label: 'Templates', icon: Icon.book, to: '/templates' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]

export function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { role } = useAuth()
  const screen = screenFromPath(pathname)
  const items = role === 'parent' ? PARENT_ITEMS : COACH_ITEMS
  return (
    <nav className="bottom-nav">
      {items.map((it) => {
        const active = screen === it.id || (it.id === 'library' && screen === 'drill')
        return (
          <button key={it.id} className={'bn-item' + (active ? ' active' : '')} onClick={() => navigate(it.to)}>
            <it.icon />
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
