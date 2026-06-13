import { useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import { Crest } from './Crest'
import { UserAvatar } from './UserAvatar'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../hooks/useAuth'
import { useMyCapabilities } from '../lib/queries'

// The global search jumps into the drill library on focus, so it shows only
// for members who have the library. Parents are scoped to their team's
// schedule and have no library, so they get no search. Exported for the search
// test.
export function TopSearch({ canSearch }: { canSearch: boolean }) {
  const navigate = useNavigate()
  if (!canSearch) return null
  return (
    <div className="topbar-search">
      <Icon.search />
      <input placeholder="Search drills, skills, media…" onFocus={() => navigate('/library')} readOnly />
    </div>
  )
}

export function TopBar() {
  const navigate = useNavigate()
  const { dark, setDark } = useTheme()
  const { caps } = useMyCapabilities()
  // The planner shortcut and the global search both follow the coaching write
  // capability the Home dispatch uses.
  const canPlan = caps.has('sessions.create')
  return (
    <div className="topbar">
      <TopSearch canSearch={canPlan} />
      <div className="topbar-spacer"></div>
      <button className="icon-btn" title="Notifications">
        <Icon.bell />
      </button>
      <button className="icon-btn" onClick={() => setDark(!dark)} title="Toggle theme">
        {dark ? <Icon.sun /> : <Icon.moon />}
      </button>
      {canPlan && (
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
