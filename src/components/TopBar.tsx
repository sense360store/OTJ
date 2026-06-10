import { useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import { Crest } from './Crest'
import { UserAvatar } from './UserAvatar'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../hooks/useAuth'

export function TopBar() {
  const navigate = useNavigate()
  const { dark, setDark } = useTheme()
  const { role } = useAuth()
  // Parents are read-only; the planner shortcut is a coaching affordance.
  const coaching = role === 'coach' || role === 'admin'
  return (
    <div className="topbar">
      <div className="topbar-search">
        <Icon.search />
        <input placeholder="Search drills, skills, media…" onFocus={() => navigate('/library')} readOnly />
      </div>
      <div className="topbar-spacer"></div>
      <button className="icon-btn" title="Notifications">
        <Icon.bell />
      </button>
      <button className="icon-btn" onClick={() => setDark(!dark)} title="Toggle theme">
        {dark ? <Icon.sun /> : <Icon.moon />}
      </button>
      {coaching && (
        <button className="btn btn-gold" onClick={() => navigate('/planner')}>
          <Icon.plus />
          New Session
        </button>
      )}
    </div>
  )
}

export function MobileTop() {
  const navigate = useNavigate()
  const { dark, setDark } = useTheme()
  const { profile } = useAuth()
  return (
    <div className="mobile-topbar">
      <Crest />
      <b>Training Hub</b>
      <div style={{ flex: 1 }}></div>
      <button className="icon-btn" onClick={() => setDark(!dark)}>
        {dark ? <Icon.sun /> : <Icon.moon />}
      </button>
      {/* The mobile counterpart of the sidebar identity block. */}
      <button
        aria-label="Account"
        onClick={() => navigate('/account')}
        style={{ background: 'none', border: 0, padding: 0, display: 'grid', placeItems: 'center' }}
      >
        <UserAvatar name={profile?.full_name} fallbackText={profile?.avatar} path={profile?.avatar_url} size={34} />
      </button>
    </div>
  )
}
