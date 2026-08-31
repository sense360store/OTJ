// The harness entry. It mounts the REAL shell and the REAL route components
// against the fixtures, so what a screenshot shows is what ships.
//
// This is an entry point rather than a module: it defines components and
// exports nothing, which the fast refresh rule flags. It never runs in the
// application, so the rule has nothing to protect here.
/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '../../src/components/Sidebar'
import { TopBar, MobileTop } from '../../src/components/TopBar'
import { BottomNav } from '../../src/components/BottomNav'
import { SessionsProvider } from '../../src/context/SessionsContext'
import { ThemeProvider } from '../../src/hooks/useTheme'
import { ListInput, Modal } from '../../src/components/ui'
import { Badge, Button, Card, IconButton, Note, PageHeader, TextField, Toggle } from '../../src/components/primitives'
import { Icon } from '../../src/components/icons'
import { RequireCap } from '../../src/components/RequireCap'
import { App } from '../../src/App'
import { Home } from '../../src/routes/Home'
import { Sessions } from '../../src/routes/Sessions'
import { Players } from '../../src/routes/Players'
import { Activity } from '../../src/routes/Activity'
import { Account } from '../../src/routes/Account'
import { Feedback } from '../../src/routes/Feedback'
import { AdminUsers } from '../../src/routes/AdminUsers'
import { AdminTeams } from '../../src/routes/AdminTeams'
import { ACTIVITY_BATCH_ID, PAST_SEASON, SESSIONS, SPOND_TEAM_ID, harnessState } from './fixtures'
import '../../src/styles.css'

const params = new URLSearchParams(location.search)
const screen = params.get('screen') ?? 'home'
// The theme provider reads localStorage, so the harness sets what it reads
// rather than the class, or the provider's first effect would undo it.
localStorage.setItem('otj_dark', params.get('theme') === 'dark' ? '1' : '0')

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Shell({ children }: { children: React.ReactNode }) {
  // A ROUTE WITNESS, for the checks that have to prove a redirect landed
  // somewhere rather than merely left where it was. The harness routes in
  // memory, so window.location says nothing about which route is rendering,
  // and neither the page body nor the navigation can stand in for it: Home has
  // capability variants (a member without sessions.create gets ParentHome, with
  // no hero), and screenFromPath falls back to 'home' for any path it does not
  // know, so both can say "Home" for a route that is not Home. Found by
  // mutating the guard to redirect somewhere that renders nothing: the proof
  // held. This is an attribute, so it changes no pixel of any screenshot.
  const { pathname } = useLocation()
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <MobileTop />
        <div className="content" data-path={pathname}>
          {children}
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

// The destructive dialog: the Modal primitive, the new danger button and the
// consequence sentence, standing in for Delete session without its mutation.
function DialogDemo() {
  const [open, setOpen] = useState(true)
  return (
    <Shell>
      <PageHeader title="Sessions" sub="A dialog over the shell" actions={<Button variant="gold" icon={Icon.plus}>New session</Button>} />
      <Button variant="danger" icon={Icon.trash} onClick={() => setOpen(true)}>
        Delete session
      </Button>
      {open && (
        <Modal
          title="Delete session"
          sub={SESSIONS[0].name}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" icon={Icon.trash}>
                Delete session
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 'var(--leading-body)' }}>
            This removes the session and its plan for everyone in the club. It cannot be undone.
          </p>
        </Modal>
      )}
    </Shell>
  )
}

// Every primitive in one place, for the state matrix that no acceptance
// screen reaches in a single render.
function Primitives() {
  const [on, setOn] = useState(true)
  const row = { display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' as const, alignItems: 'center' }
  return (
    <Shell>
      <PageHeader eyebrow="Foundation" title="Primitives" sub="Every variant and state the system defines" />
      <div style={{ display: 'grid', gap: 'var(--space-24)' }}>
        <Card>
          <h3 style={{ marginBottom: 'var(--space-12)' }}>Buttons</h3>
          <div style={row}>
            <Button variant="primary">Primary</Button>
            <Button variant="gold">Gold</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger" icon={Icon.trash}>Delete</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <IconButton label="Edit" icon={Icon.edit} />
            <IconButton label="Remove" icon={Icon.trash} tone="danger" />
          </div>
          <div style={{ ...row, marginTop: 'var(--space-12)' }}>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary">Medium</Button>
            <Button variant="primary" size="lg">Large</Button>
          </div>
          <div style={{ ...row, marginTop: 'var(--space-12)', background: 'var(--brand-gradient)', padding: 'var(--space-16)', borderRadius: 'var(--radius-md)' }}>
            <Button variant="gold">Gold on dark</Button>
            <Button variant="on-dark" icon={Icon.play}>On dark</Button>
            <IconButton label="Close" icon={Icon.x} tone="on-dark" />
          </div>
        </Card>
        <Card>
          <h3 style={{ marginBottom: 'var(--space-12)' }}>Notes and states</h3>
          <div style={{ display: 'grid', gap: 'var(--space-8)' }}>
            <Note tone="info">A neutral fact worth reading before you act.</Note>
            <Note tone="success" role="status">Check your email for a sign-in link.</Note>
            <Note tone="warning">Two children share this name, so nothing is offered here.</Note>
            <Note tone="danger" role="alert">That email and password did not match.</Note>
            <Note tone="neutral">This season is archived. Nothing here can be changed.</Note>
          </div>
          <div style={{ ...row, marginTop: 'var(--space-16)' }}>
            <Badge>New</Badge>
            <Badge tone="info">Planned</Badge>
            <Badge tone="success">Registered</Badge>
            <Badge tone="warning">In progress</Badge>
            <Badge tone="danger">Withdrawn</Badge>
          </div>
        </Card>
        <Card>
          <h3 style={{ marginBottom: 'var(--space-12)' }}>Controls</h3>
          <TextField label="Child's name" placeholder="Full name" />
          <TextField label="Email" defaultValue="not-an-email" error="Enter an email address like you@club.com" />
          <div style={row}>
            <select className="select" defaultValue="titans">
              <option value="titans">Titans</option>
            </select>
            <Toggle checked={on} onChange={setOn} label="Dark mode" />
          </div>
          {/* A numbered ListInput: the densest stack of icon buttons in the
              product, and the one place an enlarged hit area can reach a
              neighbouring control. */}
          <div style={{ marginTop: 'var(--space-16)' }}>
            <ListInput numbered value={['Open the body before the ball arrives', 'Head up between touches', 'Small touches into the turn']} onChange={() => {}} placeholder="Add a coaching point" />
          </div>
          <div style={{ ...row, marginTop: 'var(--space-12)' }}>
            <button className="chip on" aria-pressed="true">Training</button>
            <button className="chip" aria-pressed="false">All events</button>
            <button className="chip" disabled>Disabled</button>
          </div>
        </Card>
      </div>
    </Shell>
  )
}

/* A ROUTE WITNESS for the surfaces that mount the whole application, which is
   every auth surface. `Shell` carries one on `.content`, and the auth screens
   have no `.content` to carry it: the login card, the set password card and
   the auth guard's own splash all render OUTSIDE the shell, and a redirect
   between them is exactly the thing that has to be proved. It reads the real
   router rather than anything a page draws, because an absence is not a
   redirect: a blank shell, a guard returning null and a redirect to the wrong
   route all lack the markup the check is looking for.

   It is rendered only on the auth screens, so no existing surface gains a
   node. `hidden` keeps it out of every screenshot and out of the contrast
   sweep, which measures rendered text runs.

   `data-route` is deliberately a different attribute from the `data-path` on
   `Shell`'s `.content` above, because they are witnesses to two different
   things and neither can stand in for the other. `data-path` belongs to the
   HARNESS's own shell, which the auth screens never mount: there the real
   App renders its own, so an auth check that reached for `.content[data-path]`
   would find nothing whatever the guard had decided. One name for both would
   hide that rather than fix it. */
function RouteWitness() {
  const { pathname } = useLocation()
  return <div data-route={pathname} hidden />
}

/* The auth surfaces mount the REAL App, so the guard a check names is the
   guard the product runs: `/login` goes through LoginGate, a protected
   address goes through RequireAuth, and an invited member's Set Password is
   the one RequireAuth renders in place of the application. Mounting `Login`
   on its own would prove the screen and nothing about the boundary in front
   of it, and a fixture that answered for the guard would be a picture of a
   redirect that never happened. */
function Harness() {
  if (screen === 'login' || screen === 'auth') {
    return (
      <>
        <RouteWitness />
        <App />
      </>
    )
  }
  if (screen === 'dialog') return <DialogDemo />
  if (screen === 'primitives') return <Primitives />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sessions" element={<Sessions />} />
        {/* Behind the real route guard, so the capability variant that has no
            access shows what a parent actually gets (a redirect to Home)
            rather than an empty content frame. */}
        <Route element={<RequireCap cap="players.view" />}>
          <Route path="/players" element={<Players />} />
        </Route>
        {/* Behind the real audit.view guard, so the capability variant with
            no access shows what a member actually gets (a redirect to Home)
            rather than an empty content frame. audit.view and players.view
            are two different boundaries and the harness keeps them apart. */}
        <Route element={<RequireCap cap="audit.view" />}>
          <Route path="/activity" element={<Activity />} />
        </Route>
        {/* Account is open to every role, parents included, so it carries no
            guard here for the same reason App.tsx gives it none. */}
        <Route path="/account" element={<Account />} />
        {/* Feedback carries no guard for the same reason: App.tsx gives it
            none, because the log is the one surface every member of the club
            reads AND writes, parents included. A capability variant of this
            screen is a variant of what it SURFACES (the status select, the
            promote action), never of whether it renders. */}
        <Route path="/feedback" element={<Feedback />} />
        {/* Behind the real users.manage guard, so the capability variant with
            no access shows what a member actually gets (a redirect to Home)
            rather than an empty content frame. It is a THIRD boundary beside
            players.view and audit.view, and the harness keeps all three
            apart: `coach` holds teams.manage and not users.manage, which is
            exactly the partial administrator this guard has to turn away. */}
        <Route element={<RequireCap cap="users.manage" />}>
          <Route path="/admin/users" element={<AdminUsers />} />
        </Route>
        <Route element={<RequireCap cap="teams.manage" />}>
          <Route path="/admin/teams" element={<AdminTeams />} />
        </Route>
      </Routes>
    </Shell>
  )
}

// The register reads its structural filters from the URL, so the states that
// are a filter (an archived season selected, withdrawn rows shown) are reached
// by the address the screen opens on, exactly as a coach reaches them.
//
// The address is the STATE's own by default, because most of these states ARE
// an address. `at` names it separately for the case where the two differ: the
// Spond roster import's outcome is what the WRITE answers, but the action that
// opens the dialog is offered only with a Spond mapped team selected, so that
// shot needs `state=spondresult` for the reads and `at=allactions` for the
// address. Folding one into the other would mean inventing a state per
// combination.
function playersEntry(): string {
  const at = params.get('at') ?? harnessState
  if (at === 'archived') return `/players?season=${PAST_SEASON.id}`
  if (at === 'withdrawn') return '/players?status=all'
  // Every header action at once. Import from Spond is the only one gated on
  // the team filter (it needs a specific Spond mapped team selected), so the
  // fullest header a coach can reach is only reachable through the address,
  // and the six the overflow is specified to hold are all present only here.
  if (at === 'allactions') return `/players?team=${SPOND_TEAM_ID}`
  // An archived season WITH the mapped team selected. `archived` alone leaves
  // the team filter on All teams, and Import from Spond is then absent because
  // no mapped team is selected rather than because the season is not the
  // current one, so a check asserting the archived gate against it cannot
  // fail. This is the address that makes the two reasons distinguishable.
  if (at === 'archivedteam') return `/players?season=${PAST_SEASON.id}&team=${SPOND_TEAM_ID}`
  return '/players'
}

// The Activity feed's one URL persisted filter is the batch deep link, so the
// state that IS an address is reached by opening that address, exactly as a
// coach reaches it from a batch chip. Everything else it filters by is page
// state and is reached by driving the controls.
function activityEntry(): string {
  return params.get('at') === 'batch' ? `/activity?batch=${ACTIVITY_BATCH_ID}` : '/activity'
}

/* The address an auth surface opens on. Named rather than written as a path,
   for the reason `at` exists everywhere else in the harness: what a case
   claims is "an anonymous visitor who asked for a protected page", not
   "/players", and the particular protected page is an implementation detail
   of the claim. `/players` is the one used because it is behind BOTH
   RequireAuth and a capability guard, so a case that reached it proves the
   outer guard let it through rather than that no guard was there. */
function authEntry(): string {
  const at = params.get('at')
  if (at === 'login') return '/login'
  if (at === 'protected') return '/players'
  return '/'
}

const ENTRY: Record<string, string> = {
  sessions: '/sessions',
  adminusers: '/admin/users',
  adminteams: '/admin/teams',
  players: playersEntry(),
  activity: activityEntry(),
  account: '/account',
  feedback: '/feedback',
  login: '/login',
  auth: authEntry(),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ThemeProvider>
      <MemoryRouter initialEntries={[ENTRY[screen] ?? '/']}>
        {/* The auth screens mount the real App, whose RequireAuth wraps a
            SessionsProvider of its own, so a signed in auth render nests two.
            Harmless: the inner one wins for everything below it and both read
            the same stubbed query. Left rather than made conditional, because
            a provider that is present on some screens and not others is a
            second thing to reason about on every screen. */}
        <SessionsProvider>
          <Harness />
        </SessionsProvider>
      </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
