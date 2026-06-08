// App shell and routing. The auth guard decides Login versus the shell, and
// the shell hosts the sidebar, top bar, bottom nav and the routed content.
// REVIEW: contains the auth guard.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { SessionsProvider } from './context/SessionsContext'
import { Sidebar } from './components/Sidebar'
import { TopBar, MobileTop } from './components/TopBar'
import { BottomNav } from './components/BottomNav'
import { Login } from './routes/Login'
import { Home } from './routes/Home'
import { Library } from './routes/Library'
import { DrillDetail } from './routes/DrillDetail'
import { Sessions } from './routes/Sessions'
import { Planner } from './routes/Planner'
import { Templates } from './routes/Templates'
import { Media } from './routes/Media'
import { LiveSession } from './routes/LiveSession'

function Splash() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--slate)' }}>Loading…</div>
}

// No session redirects to Login; a session renders the protected tree.
function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
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
          <Route path="library" element={<Library />} />
          <Route path="drill/:id" element={<DrillDetail />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="planner" element={<Planner />} />
          <Route path="templates" element={<Templates />} />
          <Route path="media" element={<Media />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
