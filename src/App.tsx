// App shell and routing. The auth guard decides Login versus the shell, and
// the shell hosts the sidebar, top bar, bottom nav and the routed content.
// REVIEW: contains the auth guard and the capability route guards.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useMyCapabilities } from './lib/queries'
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
import { Programmes } from './routes/Programmes'
import { ProgrammeDetail } from './routes/ProgrammeDetail'
import { Media } from './routes/Media'
import { LiveSession } from './routes/LiveSession'
import { SessionDay } from './routes/SessionDay'
import { Account } from './routes/Account'
import { AdminClub } from './routes/AdminClub'
import { AdminUsers } from './routes/AdminUsers'
import { AdminTeams } from './routes/AdminTeams'

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

// Capability gated routes. Every guard follows a capability, never a role
// name, so a member holding any role that grants it gets in and the tick
// grid stays the single place access is defined. The RLS, the triggers and
// the Edge Functions enforce the same boundary server side; a member without
// the capability navigating directly is redirected. Waits for the capability
// read so a direct URL hit is not bounced before the set is known.
function RequireCap({ cap, redirect = '/' }: { cap: string; redirect?: string }) {
  const { caps, isPending } = useMyCapabilities()
  if (isPending) return <Splash />
  if (!caps.has(cap)) return <Navigate to={redirect} replace />
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
          {/* The planner is a write surface: building a plan needs
              sessions.create, so members without it (parents) go to the
              sessions list instead, direct URLs included. */}
          <Route element={<RequireCap cap="sessions.create" redirect="/sessions" />}>
            <Route path="planner" element={<Planner />} />
          </Route>
          <Route path="templates" element={<Templates />} />
          {/* Programmes are a read surface for every role; the create, import
              and edit affordances are role-gated in the screens and the
              programmes RLS enforces the writes. */}
          <Route path="programmes" element={<Programmes />} />
          <Route path="programmes/:id" element={<ProgrammeDetail />} />
          <Route path="media" element={<Media />} />
          {/* Account self-service is open to every role, parents included. */}
          <Route path="account" element={<Account />} />
          <Route element={<RequireCap cap="club.manage" />}>
            <Route path="admin/club" element={<AdminClub />} />
          </Route>
          <Route element={<RequireCap cap="teams.manage" />}>
            <Route path="admin/teams" element={<AdminTeams />} />
          </Route>
          <Route element={<RequireCap cap="users.manage" />}>
            <Route path="admin/users" element={<AdminUsers />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
