import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { bottomItemsFor, moreItemsFor } from './nav'
import { Icon } from './icons'
import { Sheet } from './primitives'
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
            <button
              key={it.id}
              className={'bn-item' + (active ? ' active' : '')}
              // The current destination is a navy tint AND a gold rule above
              // it AND aria-current, so it is never signalled by colour alone.
              aria-current={active ? 'page' : undefined}
              onClick={() => go(it.to)}
            >
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
      {/* The Sheet primitive. A menu is not a dialog, so this keeps
          role="menu" and takes Escape and focus return without the Tab trap. */}
      {moreOpen && (
        <Sheet title="More" label="More destinations" role="menu" trapFocus={false} onClose={() => setMoreOpen(false)}>
          <div className="more-sheet-list">
            {more.map((it) => {
              const active = screen === it.id
              return (
                <button
                  key={it.id}
                  className={'more-sheet-item' + (active ? ' active' : '')}
                  role="menuitem"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => go(it.to)}
                >
                  <it.icon className="nav-ico" />
                  {it.label}
                </button>
              )
            })}
          </div>
        </Sheet>
      )}
    </>
  )
}
