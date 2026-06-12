import { useLocation, useNavigate } from 'react-router-dom'
import { bottomItemsFor } from './nav'
import { useMyCapabilities } from '../lib/queries'
import { screenFromPath } from '../lib/screen'

export function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { caps } = useMyCapabilities()
  const screen = screenFromPath(pathname)
  const items = bottomItemsFor(caps)
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
