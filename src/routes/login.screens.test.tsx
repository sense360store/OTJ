// =====================================================================
// VISUAL-02, Login and Set Password: the real screens and the real guard.
//
// WHAT THIS IS FOR. The slice rebuilt both signed out screens on the shared
// system and changed no auth behaviour. Nothing pinned that before: no test
// in this repository referenced Login, SetPassword or the auth guard, so
// every call, option, message and redirect they carry was unasserted while
// the files were being rewritten. This is that pin.
//
// WHAT IT DOES NOT DO, and why the harness exists beside it. This project
// has no DOM, so these are static renders: they cover what a screen shows
// for a given auth state, and no press, no focus and no async outcome is
// reachable here at all. Everything driven lives in tools/visual/auth.mjs,
// which types into the fields and presses the control a member presses in a
// real browser.
//
// The split matters most for the REDIRECTS. React Router's <Navigate/> works
// through an effect, and effects do not run under renderToStaticMarkup, so a
// redirect renders as nothing here. "Nothing rendered" is not a redirect: a
// blank frame, a guard returning null and a redirect to the wrong route all
// look identical. So each redirect is asserted here as a DIFFERENTIAL, the
// same route rendered under two auth states with only the guard's answer
// between them, and where it LANDS is proved in the browser by the route
// witness in tools/visual/auth.mjs. Neither half is sufficient alone.
//
// Names and addresses in the fixtures are invented; the email domain is
// .invalid, which can never resolve.
// =====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '../hooks/useTheme'

/* The two browser globals the shell reads at render time. This project has no
   DOM, and the theme provider and the branding cache both go straight to
   localStorage, so the signed in renders below need one to exist at all. It
   holds nothing: what each read answers is the default, which is the state a
   member on a new device is in. */
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const source = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const LOGIN_SRC = source('./Login.tsx')
const SETPASSWORD_SRC = source('./SetPassword.tsx')
const APP_SRC = source('../App.tsx')
const AUTH_SRC = source('../hooks/useAuth.tsx')

/* ---- the auth state the guard is given -------------------------------
   Mocked because it is the guard's INPUT. The guard itself is the product's
   own: every render below goes through the real App, the real LoginGate and
   the real RequireAuth. A fixture that stood in for the guard would be a
   test of the fixture. */
const auth = {
  user: null as { id: string; email: string } | null,
  loading: false,
  needsPassword: false,
}

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: auth.user,
    session: auth.user ? {} : null,
    profile: null,
    role: auth.user ? 'coach' : null,
    loading: auth.loading,
    profileLoading: false,
    needsPassword: auth.needsPassword,
    clearNeedsPassword: () => {},
    refreshProfile: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  }),
  AuthProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: () => Promise.resolve({ data: null, error: null }),
      signInWithOtp: () => Promise.resolve({ data: null, error: null }),
      resetPasswordForEmail: () => Promise.resolve({ data: null, error: null }),
      updateUser: () => Promise.resolve({ data: null, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe() {} }),
    removeChannel() {},
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}))

const { App } = await import('../App')

function at(path: string): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The same provider stack main.tsx mounts, minus AuthProvider, which is the
  // thing under test and is mocked above. The shell reads the theme, so a
  // signed in render needs it.
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const anonymous = () => Object.assign(auth, { user: null, loading: false, needsPassword: false })
const signedIn = () => Object.assign(auth, { user: { id: 'me', email: 'coach@example.invalid' }, loading: false, needsPassword: false })
const invited = () =>
  Object.assign(auth, { user: { id: 'me', email: 'coach@example.invalid' }, loading: false, needsPassword: true })
const resolving = () => Object.assign(auth, { user: null, loading: true, needsPassword: false })

beforeEach(anonymous)

describe('Login renders on the shared system', () => {
  it('is the signed out card, with the crest, the club and the motto', () => {
    const html = at('/login')
    expect(html).toContain('login-bg')
    expect(html).toContain('login-card')
    // The identity block, which both signed out screens now share.
    expect(html).toContain('login-identity')
    expect(html).toContain('<h1>Training Hub</h1>')
    expect(html).toContain('Ossett Town Juniors')
    expect(html).toContain('Where football and friendships flourish')
  })

  it('uses the field primitive for both inputs, bound to real labels', () => {
    const html = at('/login')
    for (const [id, label] of [
      ['email', 'Email'],
      ['password', 'Password'],
    ]) {
      expect(html, `${id} has a label bound to it`).toContain(`<label for="${id}">${label}</label>`)
      expect(html, `${id} is inside a field`).toMatch(new RegExp(`class="field"[^]*?id="${id}"`))
    }
  })

  it('keeps the autocomplete a password manager reads', () => {
    // BEHAVIOUR, not presentation. Dropping one is how a visual pass quietly
    // stops a member's password manager offering to fill the form, and it
    // leaves no visible trace at all.
    //
    // Matched case insensitively because an HTML attribute name is, and this
    // renderer emits the JSX spelling. What the BROWSER ends up with is
    // asserted where it can be read for real, in tools/visual/checks.mjs,
    // which reads getAttribute('autocomplete') off the live control.
    const html = at('/login')
    expect(html).toMatch(/id="email"[^>]*autocomplete="email"/i)
    expect(html).toMatch(/id="password"[^>]*autocomplete="current-password"/i)
  })

  it('uses the Button primitive rather than a hand written class string', () => {
    // The two ways in are the primary and the ghost button, both full width.
    expect(LOGIN_SRC).toContain('<Button ref={signInRef} variant="primary" size="lg" block type="submit"')
    expect(LOGIN_SRC).toContain('<Button ref={linkRef} variant="ghost" block icon={Icon.bolt}')
    // And no hand written .btn string is left anywhere in the file.
    expect(LOGIN_SRC).not.toMatch(/className="btn[ "]/)
  })

  it('offers no way to register, and says why', () => {
    // The invite-only policy is the whole reason there is no sign up form,
    // and the sentence that explains it is the only thing standing between a
    // member and a dead end.
    const html = at('/login')
    expect(html).toContain('Accounts are created by invite. Ask a club admin to add you.')
    for (const word of ['Sign up', 'Create account', 'Register', 'New account']) {
      expect(html, `${word} is not offered`).not.toContain(word)
    }
  })
})

describe('Set Password renders as the same family', () => {
  beforeEach(invited)

  it('wears the same card as Login, with its own heading', () => {
    const html = at('/')
    expect(html).toContain('login-card')
    expect(html).toContain('login-identity')
    expect(html).toContain('<h1>Set your password</h1>')
    // The motto is the visible half of "same family": it was absent from
    // this screen before the two shared one card.
    expect(html).toContain('Where football and friendships flourish')
  })

  it('has both fields, bound and carrying the new-password autocomplete', () => {
    const html = at('/')
    expect(html).toContain('<label for="new-password">New password</label>')
    expect(html).toContain('<label for="confirm-password">Confirm password</label>')
    expect((html.match(/autocomplete="new-password"/gi) ?? []).length).toBe(2)
  })

  it('opens with the submit inert, so nothing can be sent by accident', () => {
    const html = at('/')
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
  })

  it('uses the Button primitive rather than a hand written class string', () => {
    expect(SETPASSWORD_SRC).toContain('<Button ref={saveRef} variant="primary" size="lg" block type="submit"')
    expect(SETPASSWORD_SRC).not.toMatch(/className="btn[ "]/)
  })
})

/* ---- the auth behaviour this slice did not change --------------------
   Every one of these is a line the redesign could have dropped without
   changing a pixel, so each is pinned as source text. The states they
   produce are driven in a browser by tools/visual/auth.mjs; this is what
   stops the call itself being edited. */
describe('the auth calls are exactly what they were', () => {
  it('signs in with email and password', () => {
    expect(LOGIN_SRC).toContain('supabase.auth.signInWithPassword({ email, password })')
  })

  it('keeps shouldCreateUser off on the magic link, so it registers nobody', () => {
    expect(LOGIN_SRC).toContain('supabase.auth.signInWithOtp({')
    expect(LOGIN_SRC).toContain('options: { emailRedirectTo: window.location.origin, shouldCreateUser: false }')
  })

  it('resets a password through resetPasswordForEmail, back to this origin', () => {
    expect(LOGIN_SRC).toContain('supabase.auth.resetPasswordForEmail(email, {')
    expect(LOGIN_SRC).toContain('redirectTo: window.location.origin')
  })

  it('sets a password through updateUser and clears the flag only after it succeeds', () => {
    expect(SETPASSWORD_SRC).toContain('supabase.auth.updateUser({ password })')
    // The refusal returns BEFORE the flag is cleared. Order is the whole
    // claim: clearing it first would hand a member into the application with
    // no password set.
    const refusal = SETPASSWORD_SRC.indexOf('setError(error.message)')
    const cleared = SETPASSWORD_SRC.indexOf('clearNeedsPassword()')
    expect(refusal).toBeGreaterThan(-1)
    expect(cleared).toBeGreaterThan(refusal)
    expect(SETPASSWORD_SRC.slice(refusal, cleared)).toContain('return')
  })

  it('refuses a mismatch before the auth client is reached', () => {
    const check = SETPASSWORD_SRC.indexOf('if (password !== confirm)')
    const call = SETPASSWORD_SRC.indexOf('supabase.auth.updateUser')
    expect(check).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(check)
  })

  it('keeps every refusal and confirmation word for word', () => {
    for (const message of [
      'Enter your email first, then request a link.',
      'Enter your email first, then reset your password.',
      'Check your email for a sign-in link.',
      'Check your email to reset your password.',
    ]) {
      expect(LOGIN_SRC, message).toContain(message)
    }
    expect(SETPASSWORD_SRC).toContain('The passwords do not match.')
  })

  it('clears the last outcome before every new action, and freezes all three controls', () => {
    // One busy flag drew three controls before this slice, so the sign in
    // button claimed to be working whichever was pressed. `pending` names the
    // call; `busy` is still the single disabled rule, which is the behaviour.
    expect(LOGIN_SRC).toMatch(/const start = [^]*setError\(null\)[^]*setInfo\(null\)/)
    expect(LOGIN_SRC).toContain('const busy = pending !== null')
    expect((LOGIN_SRC.match(/disabled=\{busy\}/g) ?? []).length).toBe(3)
  })
})

/* ---- the guard --------------------------------------------------------
   The real App, the real LoginGate, the real RequireAuth. Each redirect is a
   differential: the same address under two auth states, with only the
   guard's answer between them. Where it lands is the browser's half. */
describe('the auth guard decides which of the three screens renders', () => {
  it('renders Login for an anonymous visitor at /login', () => {
    anonymous()
    expect(at('/login')).toContain('login-card')
  })

  it('does not leave a signed in member on /login', () => {
    // The differential. The same address, the same render path, one auth
    // state apart: the login card is there for one and gone for the other,
    // so what removed it is the guard rather than an empty frame.
    anonymous()
    expect(at('/login')).toContain('login-card')
    signedIn()
    expect(at('/login')).not.toContain('login-card')
  })

  it('does not render a protected page for an anonymous visitor', () => {
    signedIn()
    const allowed = at('/')
    expect(allowed).toContain('class="app"')
    anonymous()
    const refused = at('/')
    expect(refused).not.toContain('class="app"')
    // And it is not showing the protected page's content under another name.
    expect(refused).not.toContain('Welcome back')
  })

  it('renders Set Password instead of the application while a password is needed', () => {
    invited()
    const html = at('/')
    expect(html).toContain('<h1>Set your password</h1>')
    // INSTEAD OF, not beside: the application is not behind it.
    expect(html).not.toContain('class="app"')
  })

  it('waits rather than deciding while the session is unknown', () => {
    resolving()
    for (const path of ['/login', '/']) {
      const html = at(path)
      expect(html, `${path} shows neither screen while loading`).not.toContain('login-card')
      expect(html, `${path} shows no application while loading`).not.toContain('class="app"')
      expect(html, `${path} says it is loading`).toContain('Loading…')
    }
  })

  it('checks for a session BEFORE it checks whether a password is needed', () => {
    // Order is load bearing and is what makes the expired link case below
    // collapse to one answer. A member with the flag set and no session is
    // sent to Login rather than shown a Set Password form with no session to
    // set a password on.
    const noUser = APP_SRC.indexOf("if (!user) return <Navigate to=\"/login\" replace />")
    const needs = APP_SRC.indexOf('if (needsPassword) return <SetPassword />')
    expect(noUser).toBeGreaterThan(-1)
    expect(needs).toBeGreaterThan(noUser)
  })
})

/* ---- the expired link -------------------------------------------------
   The Design Read lists expired link as a Login state VISUAL-02 owns. It is
   not a state: this product has no expired link presentation, and a visual
   slice is not the place to invent one. What is here is the proof of what
   actually happens, so the absence is recorded rather than assumed.

   The rule lives at module scope in the real hooks/useAuth.tsx and is read
   once, before the Supabase client consumes the fragment. The harness stubs
   that module wholesale, so this is the only place it can be exercised. */
describe('an expired invite or recovery link', () => {
  const HASHES = {
    // What GoTrue redirects to when a link has expired or has been used.
    expired: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    // And what a link that still works looks like, so the rule is shown to
    // separate the two rather than to refuse everything.
    invite: '#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=invite',
    recovery: '#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery',
    none: '',
  }

  async function needsPasswordFor(hash: string): Promise<boolean> {
    // The rule is evaluated at MODULE LOAD, so each hash needs a fresh
    // module. `window` does not exist in this environment and the rule guards
    // for that, so the shim is what lets the rule run at all.
    vi.resetModules()
    ;(globalThis as unknown as { window: unknown }).window = { location: { hash, origin: 'https://example.test' } }
    const mod = await vi.importActual<typeof import('../hooks/useAuth')>('../hooks/useAuth')
    let seen: boolean | null = null
    function Probe() {
      seen = mod.useAuth().needsPassword
      return null
    }
    renderToStaticMarkup(
      <mod.AuthProvider>
        <Probe />
      </mod.AuthProvider>,
    )
    return seen === true
  }

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('is not read as an arrival to set a password', async () => {
    // The rule matches `type=invite` or `type=recovery` after a # or an &.
    // The error fragment carries error, error_code and error_description and
    // no type at all, so it does not match.
    expect(await needsPasswordFor(HASHES.expired)).toBe(false)
    expect(await needsPasswordFor(HASHES.none)).toBe(false)
  })

  it('while a link that still works is', async () => {
    expect(await needsPasswordFor(HASHES.invite)).toBe(true)
    expect(await needsPasswordFor(HASHES.recovery)).toBe(true)
  })

  it('creates no session, so the guard sends the member to Login either way', () => {
    // The stronger half, and the reason the rule above is not load bearing
    // for this case. An expired link writes no session, and RequireAuth tests
    // for one FIRST, so both branches end at the same screen: a member with
    // the flag set and no session is redirected exactly like one without it.
    anonymous()
    expect(at('/')).not.toContain('class="app"')
    Object.assign(auth, { user: null, loading: false, needsPassword: true })
    const html = at('/')
    expect(html, 'no session means no Set Password, whatever the flag says').not.toContain('Set your password')
    expect(html).not.toContain('class="app"')
  })

  it('is never mentioned, because nothing in the product reads the fragment', () => {
    // The finding itself, pinned. The error is reported by GoTrue only in the
    // URL fragment and in the resolved value of the client's own initialize
    // promise; this product reads neither, and the redirect to /login strips
    // the fragment, so the evidence is gone by the time a member is looking
    // at anything. Giving them a message is a product decision and a change
    // to a gated file, so this slice records the absence rather than filling
    // it.
    for (const token of ['otp_expired', 'error_description', 'access_denied', 'auth.initialize(']) {
      expect(LOGIN_SRC, token).not.toContain(token)
      expect(AUTH_SRC, token).not.toContain(token)
    }
    // The only thing the product reads out of a fragment on this path.
    expect(AUTH_SRC).toContain('/[#&]type=(invite|recovery)/.test(window.location.hash)')
  })
})

/* ---- permission limited ----------------------------------------------
   The Design Read also lists permission limited as a Login state VISUAL-02
   owns. There is no such state, and this is why rather than an assertion
   that there is not. */
describe('there is no permission limited variant of either screen', () => {
  it('neither screen reads a role, a profile or a capability', () => {
    for (const [what, src] of [
      ['Login', LOGIN_SRC],
      ['Set Password', SETPASSWORD_SRC],
    ] as const) {
      for (const token of ['useMyCapabilities', 'RequireCap', 'caps', '.role', 'profile']) {
        expect(src, `${what} does not read ${token}`).not.toContain(token)
      }
    }
    // Set Password takes exactly one thing off the auth context, and it is
    // not an identity.
    expect(SETPASSWORD_SRC).toContain('const { clearNeedsPassword } = useAuth()')
  })

  it('cannot be wrapped by a capability guard, because of where they sit', () => {
    // /login is a sibling of the guarded tree rather than inside it, and Set
    // Password is not a route at all: RequireAuth returns it in place of the
    // Outlet, so no child route, and therefore no RequireCap, mounts while it
    // is showing.
    expect(APP_SRC).toContain('<Route path="/login" element={<LoginGate />} />')
    expect(APP_SRC).toContain('if (needsPassword) return <SetPassword />')
    const loginRoute = APP_SRC.indexOf('<Route path="/login"')
    const firstGuard = APP_SRC.indexOf('<RequireCap')
    expect(firstGuard).toBeGreaterThan(loginRoute)
  })

  it('is the signed in redirect, if it is anything, and that is covered as a guard case', () => {
    // The nearest real thing to "a member who may not be here": LoginGate
    // turns a signed in visitor away. It is a guard answer rather than a
    // limited rendering of the screen, and it is proved as one.
    expect(APP_SRC).toContain('if (user) return <Navigate to="/" replace />')
  })
})
