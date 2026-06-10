// App shell and routing. The auth guard decides Login versus the shell, and
// the shell hosts the sidebar, top bar, bottom nav and the routed content.
// REVIEW: contains the auth guard and the capability route guards.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useAccessLoading, usePerm } from './lib/queries'
import type { Capability } from './lib/permissions'
import { SessionsProvider } from './context/SessionsContext'
import { Sidebar } from './components/Sidebar'
import { TopBar, MobileTop } from './components/TopBar'
import { BottomNav } from './components/BottomNav'
import { Login } from './routes/Login'
import { SetPassword } from './routes/SetPassword'
import { Home } from './routes/Home'
import { Library } from './routes/Library'
import { DrillDetail } from './routes/DrillDetail'
import { Sessions } from './routes/Sessions'
import { Planner } from './routes/Planner'
import { Templates } from './routes/Templates'
import { Media } from './routes/Media'
import { LiveSession } from './routes/LiveSession'
import { SessionDay } from './routes/SessionDay'
import { Account } from './routes/Account'
import { AdminClub } from './routes/AdminClub'
import { AdminUsers } from './routes/AdminUsers'
import { AdminTeams } from './routes/AdminTeams'
import { AdminRoles } from './routes/AdminRoles'
import { AdminFilters } from './routes/AdminFilters'

function Splash() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--slate)' }}>Loading…</div>
}

// No session redirects to Login; a session renders the protected tree. A user
// arriving from an invite or recovery link sets a password first.
function RequireAuth() {
  const { user, loading, needsPassword } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (needsPassword) return <SetPassword />
  return (
    <SessionsProvider>
      <Outlet />
    </SessionsProvider>
  )
}

// Each admin screen is guarded by its own capability; the nav shows the
// Admin group to anyone holding at least one of them. The RLS policies
// behind usePerm enforce the same boundary server side; a member navigating
// directly to a screen they cannot use is redirected home. Waits for the
// capability read so a direct URL hit is not bounced before it is known.
function RequireCap({ cap }: { cap: Capability }) {
  const loading = useAccessLoading()
  const allowed = usePerm(cap)
  if (loading) return <Splash />
  if (!allowed) return <Navigate to="/" replace />
  return <Outlet />
}

// The planner is a write surface: members who can plan their own sessions or
// manage any session get in; read-only roles are redirected to the sessions
// list, direct URLs included. The sessions RLS refuses their writes anyway;
// this keeps the surface honest.
function RequirePlanner() {
  const loading = useAccessLoading()
  const canCreate = usePerm('sessions.create')
  const canManageAny = usePerm('sessions.manage_any')
  if (loading) return <Splash />
  if (!canCreate && !canManageAny) return <Navigate to="/sessions" replace />
  return <Outlet />
}

// Keep signed-in users out of the login screen.
function LoginGate() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (user) return <Navigate to="/" replace />
  return <Login />
}

function AppShell() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <MobileTop />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route element={<RequireAuth />}>
        <Route path="/live/:sessionId" element={<LiveSession />} />
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="drill/:id" element={<DrillDetail />} />
          <Route path="sessions" element={<Sessions />} />
          {/* Session day stays inside the shell so the bottom nav remains
              reachable pitch-side; the full-screen viewer overlays it. */}
          <Route path="session-day/:sessionId" element={<SessionDay />} />
          <Route element={<RequirePlanner />}>
            <Route path="planner" element={<Planner />} />
          </Route>
          <Route path="templates" element={<Templates />} />
          <Route path="media" element={<Media />} />
          {/* Account self-service is open to every role, parents included. */}
          <Route path="account" element={<Account />} />
          <Route element={<RequireCap cap="club.manage" />}>
            <Route path="admin/club" element={<AdminClub />} />
          </Route>
          <Route element={<RequireCap cap="users.manage" />}>
            <Route path="admin/users" element={<AdminUsers />} />
          </Route>
          <Route element={<RequireCap cap="teams.manage" />}>
            <Route path="admin/teams" element={<AdminTeams />} />
          </Route>
          <Route element={<RequireCap cap="roles.manage" />}>
            <Route path="admin/roles" element={<AdminRoles />} />
          </Route>
          <Route element={<RequireCap cap="filters.manage" />}>
            <Route path="admin/filters" element={<AdminFilters />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
