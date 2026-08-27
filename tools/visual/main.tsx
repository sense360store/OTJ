// The harness entry. It mounts the REAL shell and the REAL route components
// against the fixtures, so what a screenshot shows is what ships.
//
// This is an entry point rather than a module: it defines components and
// exports nothing, which the fast refresh rule flags. It never runs in the
// application, so the rule has nothing to protect here.
/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '../../src/components/Sidebar'
import { TopBar, MobileTop } from '../../src/components/TopBar'
import { BottomNav } from '../../src/components/BottomNav'
import { SessionsProvider } from '../../src/context/SessionsContext'
import { ThemeProvider } from '../../src/hooks/useTheme'
import { ListInput, Modal } from '../../src/components/ui'
import { Badge, Button, Card, IconButton, Note, PageHeader, TextField, Toggle } from '../../src/components/primitives'
import { Icon } from '../../src/components/icons'
import { Home } from '../../src/routes/Home'
import { Sessions } from '../../src/routes/Sessions'
import { Login } from '../../src/routes/Login'
import { SESSIONS } from './fixtures'
import '../../src/styles.css'

const params = new URLSearchParams(location.search)
const screen = params.get('screen') ?? 'home'
// The theme provider reads localStorage, so the harness sets what it reads
// rather than the class, or the provider's first effect would undo it.
localStorage.setItem('otj_dark', params.get('theme') === 'dark' ? '1' : '0')

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <MobileTop />
        <div className="content">{children}</div>
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

function Harness() {
  if (screen === 'login') return <Login />
  if (screen === 'dialog') return <DialogDemo />
  if (screen === 'primitives') return <Primitives />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sessions" element={<Sessions />} />
      </Routes>
    </Shell>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ThemeProvider>
      <MemoryRouter initialEntries={[screen === 'sessions' ? '/sessions' : '/']}>
        <SessionsProvider>
          <Harness />
        </SessionsProvider>
      </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
