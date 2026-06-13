import { useLocation, useNavigate } from 'react-router-dom'
import { Crest } from './Crest'
import { Icon } from './icons'
import { UserAvatar } from './UserAvatar'
import { ITEM_CAP, navSectionsFor } from './nav'
import { useDrills, useMyCapabilities } from '../lib/queries'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS } from '../lib/data'
import { useClubBranding } from '../hooks/useClubBranding'
import { screenFromPath } from '../lib/screen'

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
  const sections = navSectionsFor(caps)

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
        {sections.map((sec, i) => {
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
