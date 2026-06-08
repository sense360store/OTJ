import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { screenFromPath } from '../lib/screen'

const BOTTOM: { id: string; label: string; icon: IconComponent; to: string }[] = [
  { id: 'home', label: 'Home', icon: Icon.home, to: '/' },
  { id: 'library', label: 'Drills', icon: Icon.grid, to: '/library' },
  { id: 'planner', label: 'Plan', icon: Icon.layers, to: '/planner' },
  { id: 'sessions', label: 'Sessions', icon: Icon.calendar, to: '/sessions' },
  { id: 'media', label: 'Media', icon: Icon.film, to: '/media' },
]

export function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const screen = screenFromPath(pathname)
  return (
    <nav className="bottom-nav">
      {BOTTOM.map((it) => {
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
