import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { useMyCapabilities } from '../lib/queries'
import { screenFromPath } from '../lib/screen'

interface BottomItem {
  id: string
  label: string
  icon: IconComponent
  to: string
}

const PLANNER_ITEMS: BottomItem[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'planner', label: 'Plan', icon: Icon.layers, to: '/planner' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]

// Members who cannot plan (parents) lose the planner; templates take its
// slot so their whole read surface stays reachable on a phone.
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
  const { caps } = useMyCapabilities()
  const screen = screenFromPath(pathname)
  // The planner slot follows the capability that backs it, any held role.
  const items = caps.has('sessions.create') ? PLANNER_ITEMS : READ_ONLY_ITEMS
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
