import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { bottomItemsFor, moreItemsFor } from './nav'
import { Icon } from './icons'
import { useMyCapabilities } from '../lib/queries'
import { screenFromPath } from '../lib/screen'

export function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { caps } = useMyCapabilities()
  const screen = screenFromPath(pathname)
  const items = bottomItemsFor(caps)
  // The overflow destinations the short row cannot hold: the Roster and the
  // admin screens, gated by the same capability map as the sidebar.
  const more = moreItemsFor(caps)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreIds = new Set(more.map((it) => it.id))
  // The drill detail screen sits behind the library entry, which now rides in
  // the More sheet, so a drill view highlights More rather than a row slot.
  const moreActive = moreIds.has(screen) || (screen === 'drill' && moreIds.has('library'))

  const go = (to: string) => {
    setMoreOpen(false)
    navigate(to)
  }

  return (
    <>
      <nav className="bottom-nav">
        {items.map((it) => {
          const active = screen === it.id
          return (
            <button key={it.id} className={'bn-item' + (active ? ' active' : '')} onClick={() => go(it.to)}>
              <it.icon />
              {it.label}
            </button>
          )
        })}
        {more.length > 0 && (
          <button
            className={'bn-item' + (moreActive ? ' active' : '')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <Icon.more />
            More
          </button>
        )}
      </nav>
      {moreOpen && (
        <div className="sheet-overlay" onClick={() => setMoreOpen(false)}>
          <div className="more-sheet" role="menu" aria-label="More destinations" onClick={(e) => e.stopPropagation()}>
            <div className="more-sheet-head">
              <h3>More</h3>
              <button className="icon-btn" aria-label="Close" onClick={() => setMoreOpen(false)}>
                <Icon.x />
              </button>
            </div>
            <div className="more-sheet-list">
              {more.map((it) => (
                <button
                  key={it.id}
                  className={'more-sheet-item' + (screen === it.id ? ' active' : '')}
                  role="menuitem"
                  onClick={() => go(it.to)}
                >
                  <it.icon className="nav-ico" />
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
