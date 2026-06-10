import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { usePerm } from '../lib/queries'
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

// Read-only roles cannot plan, so the planner slot goes to templates and the
// whole read-only surface stays reachable on a phone.
const READ_ONLY_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'templates', label: 'Templates', icon: Icon.book, to: '/templates' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]

export function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const canPlan = usePerm('sessions.create')
  const screen = screenFromPath(pathname)
  const items = canPlan ? COACH_ITEMS : READ_ONLY_ITEMS
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
