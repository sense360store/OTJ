// App shell and routing. The auth guard decides Login versus the shell, and
// the shell hosts the sidebar, top bar, bottom nav and the routed content.
// REVIEW: contains the auth guard and the capability route guards.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { SessionsProvider } from './context/SessionsContext'
import { RequireCap } from './components/RequireCap'
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
import { Board } from './routes/Board'
import { Roster } from './routes/Roster'
import { Templates } from './routes/Templates'
import { Programmes } from './routes/Programmes'
import { ProgrammeDetail } from './routes/ProgrammeDetail'
import { Media } from './routes/Media'
import { LiveSession } from './routes/LiveSession'
import { SessionDay } from './routes/SessionDay'
import { Account } from './routes/Account'
import { Feedback } from './routes/Feedback'
import { AdminClub } from './routes/AdminClub'
import { AdminUsers } from './routes/AdminUsers'
import { AdminTeams } from './routes/AdminTeams'
import { AdminSpond } from './routes/AdminSpond'

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
          {/* Detail routes stay reachable read only for every role: the parent
              dashboard and schedule link straight into them, and that is the
              only path by which a parent meets a drill. Action buttons inside
              are capability gated, so a parent sees them read only. Session day
              stays inside the shell so the bottom nav remains reachable
              pitch-side; the full-screen viewer overlays it. */}
          <Route path="sessions" element={<Sessions />} />
          <Route path="drill/:id" element={<DrillDetail />} />
          <Route path="session-day/:sessionId" element={<SessionDay />} />
          <Route path="programmes/:id" element={<ProgrammeDetail />} />
          {/* Browse and authoring surfaces need the coaching write capability.
              A parent (no sessions.create) is redirected to Home, not shown an
              empty shell: their world is their team's schedule, not a
              browsable coaching database. The create, import and edit
              affordances inside are role gated and the RLS enforces the
              writes. */}
          <Route element={<RequireCap cap="sessions.create" />}>
            <Route path="library" element={<Library />} />
            <Route path="planner" element={<Planner />} />
            <Route path="board" element={<Board />} />
            <Route path="roster" element={<Roster />} />
            <Route path="programmes" element={<Programmes />} />
            <Route path="templates" element={<Templates />} />
            <Route path="media" element={<Media />} />
          </Route>
          {/* Account self-service is open to every role, parents included. */}
          <Route path="account" element={<Account />} />
          {/* The feedback log is open to every role too, filing included:
              feedback is about the app, not coaching content. The feedback
              RLS enforces the writes. */}
          <Route path="feedback" element={<Feedback />} />
          <Route element={<RequireCap cap="club.manage" />}>
            <Route path="admin/club" element={<AdminClub />} />
            <Route path="admin/spond" element={<AdminSpond />} />
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
