// How a member reaches each state of Login and Set Password, and what the
// auth guard does at each address, in one place. Development only.
//
// WHY THIS IS A MODULE, for the reason account.mjs and dialogs.mjs are ones:
// three tools need the same presses. shoot.mjs photographs each state,
// checks.mjs measures and drives them, and contrast.mjs sweeps the text runs
// the notes paint. Each of them writing its own presses is how a matrix and a
// check drift apart until one of them is quietly photographing an untouched
// form. contrast.mjs had already done exactly that: it pressed a button named
// /magic link/i on the login screen, no control on that screen has ever been
// called that, the press was wrapped in a catch, and every login sweep since
// has measured a form nobody had touched.
//
// NOTHING HERE IS FAKED. Every entry types into the fields a member types into
// and presses the control a member presses; what the harness varies is what
// the server does (tools/visual/stubs/supabase.ts) and who the guard is told
// is signed in (tools/visual/stubs/useAuth.tsx), never what is drawn. The
// GUARD ITSELF is the product's own: the harness mounts the real App, so
// LoginGate and RequireAuth are the ones that ship, and a case that claims a
// redirect is a claim about them.

/* The values typed in. Both are invented and the address is .invalid, which
   can never resolve. The password is long enough that a real project would
   accept it, so a refusal in a screenshot is the harness's refusal and not an
   accidental length rule. */
export const LOGIN_EMAIL = 'coach@example.invalid'
export const LOGIN_PASSWORD = 'a-long-enough-passphrase'

/* The club's two strings, mirrored from tools/visual/fixtures.ts because this
   is plain JavaScript and cannot import it. Compared EXACTLY rather than by
   length, for the reason account.mjs compares its four exactly: a stub that
   stopped applying one would otherwise be photographed under a name claiming
   it, and a drift in the fixture would go unnoticed. */
export const BRAND = {
  club: 'Ossett Town Juniors',
  motto: 'Where football and friendships flourish',
  // A single unbroken token, which is the case the card fails on without
  // .login-identity's overflow-wrap. See the note in tools/visual/fixtures.ts.
  longClub: 'Ossettownjuniorscommunityfootballandfriendshipassociation',
  longMotto:
    'Where football and friendships flourish, every child plays every week and nobody stands on the touchline alone',
}

/* WHAT THE TWO EXPIRED LINK CASES CAN AND CANNOT SHOW, because the difference
   is easy to lose and a case that claims the wrong half is the defect this
   whole file exists to prevent.

   An expired or already used invite, magic link or recovery link redirects to
   a BARE ORIGIN carrying an error fragment. Two facts follow, and they are
   proved in two different places:

   1. The fragment leaves the member ANONYMOUS. GoTrue writes no session for
      it, and the rule in src/hooks/useAuth.tsx that decides "this arrival is
      here to set a password" matches `type=invite` or `type=recovery` and
      nothing else, which an error fragment carries neither of. That is a fact
      about a module this harness REPLACES, so it cannot be shown here at all;
      it is proved against the real module in
      src/routes/login.screens.test.tsx.
   2. Given that state, at that address, this is the screen. THAT is what the
      cases below drive, and it is not covered by any other case: `/` is
      where these emails actually land (both flows pass
      window.location.origin, and invite-user passes APP_ORIGIN), so
      RequireAuth is the guard that meets the arrival and the redirect to
      /login is part of what is being shown rather than its setup.

   The fragment itself is deliberately NOT put on the harness URL. It would
   reach nothing: the harness routes in memory from the `at` key, and the
   module that reads window.location.hash on THIS path is the one the harness
   stubs. (It is not the only reader in the product: PublicShare reads it for
   the anonymous share secret and is not stubbed, but it mounts only at
   /share/:shareId, which no auth case opens.) A URL that carried the fragment
   would imply the case was driving something it was not, and the same case
   would pass unchanged with a WORKING invite fragment in its place, which is
   the opposite arrival. */

const pause = (page) => page.waitForTimeout(200)

// A press and a fill that report rather than throw, so a driver returns false
// and its caller records a failed entry instead of the run ending on a
// timeout. Same contract as account.mjs.
async function act(locator, run) {
  if ((await locator.count()) === 0) return false
  try {
    await run(locator.first())
    return true
  } catch {
    return false
  }
}
const fill = (page, label, value) => act(page.getByLabel(label, { exact: true }), (el) => el.fill(value))
const press = (page, name) => act(page.getByRole('button', { name, exact: true }), (el) => el.click())

/* ---- the proofs ------------------------------------------------------
   Two shapes recur, and both exist because the loose version of each was
   explicitly ruled out.

   A note is never proved by "a note is on screen". Every message on these
   screens renders through the same Note, so a proof that only asked for one
   would hold for the wrong outcome, and a success proof that matched any
   .note-success would hold for a confirmation the entry never asked for.
   This names the tone, the live region role, the EXACT words, and the glyph,
   and it refuses to pass while more than one note is up.

   A busy control is never proved by "something says a gerund". One busy flag
   used to draw three controls, so the sign in button claimed to be working
   whichever of the three had been pressed. This names WHICH control is
   working, checks that no other control claims to be, and checks that all
   three are frozen, which is the disabled contract the screen has always had
   and which this slice deliberately did not change. */
const CARD = '.login-card'

const noteIs = (tone, role, text) => (page) =>
  page.evaluate(
    ({ tone, role, text, card }) => {
      const notes = [...document.querySelectorAll(`${card} .note`)]
      if (notes.length !== 1) return false
      const note = notes[0]
      const body = note.querySelector('.note-body')
      return (
        note.classList.contains(`note-${tone}`) &&
        note.getAttribute('role') === role &&
        !!body &&
        body.textContent.trim() === text &&
        // A glyph as well as a hue, which is what stops the state being
        // carried by colour alone.
        !!note.querySelector('svg')
      )
    },
    { tone, role, text, card: CARD },
  )

// No note at all, which is a claim in its own right: it is what the product
// says to somebody arriving on an expired link.
const noNote = (page) => page.evaluate((card) => document.querySelectorAll(`${card} .note`).length === 0, CARD)

/* Which control is working. `which` is a selector for the one that must carry
   the gerund; every other control in the card must carry its ordinary label
   and every one of them must be disabled. */
const busyIs = (which, label) => (page) =>
  page.evaluate(
    ({ which, label, card }) => {
      const working = document.querySelector(which)
      const all = [...document.querySelectorAll(`${card} button`)]
      if (!working || all.length === 0) return false
      const text = (el) => (el.textContent || '').trim()
      return (
        text(working) === label &&
        working.disabled === true &&
        // Nobody else claims to be working. The ellipsis is the whole
        // vocabulary of a gerund label on these screens.
        all.filter((b) => text(b).endsWith('…')).length === 1 &&
        // And every control is frozen, which is the behaviour rather than
        // the wording.
        all.every((b) => b.disabled === true)
      )
    },
    { which, label, card: CARD },
  )

/* How many times a named call on the auth client was made, straight from the
   harness stub's counter (tools/visual/stubs/supabase.ts). Three of the states
   below are refusals the SCREEN makes before the client is reached, and that
   is a negative a browser cannot see: nothing is drawn by a call that never
   happened. They used to be inferred from what WAS drawn, which is a different
   claim and one that would still hold if the call were made and its answer
   discarded. Codex.

   An ABSENT counter fails. It means the page is not running the stub this
   proof was written against, so the claim is unproved rather than true, and a
   missing global reading as zero is exactly how a negative proof goes quietly
   vacuous.

   Every `calls(name, 0)` below is paired with a `calls(name, 1)` on a flow
   that does make the same call, because a zero on its own is also what a
   deleted record() line looks like. */
const calls = (name, want) => (page) =>
  page.evaluate(
    ({ name, want }) => {
      const counter = window.__authCalls
      if (!counter || typeof counter !== 'object') return false
      return (counter[name] ?? 0) === want
    },
    { name, want },
  )

// The three controls, named by what makes each of them unique in the card.
const SUBMIT = `${CARD} button[type="submit"]`
const MAGIC_LINK = `${CARD} .btn-ghost`
const RESET = `${CARD} .login-link`

/* The club identity, both strings, each compared exactly. A long name and a
   long motto are separate states, so each entry names which one it is
   claiming and asserts the OTHER is still ordinary: a state that quietly
   applied both would otherwise pass under either name. */
export const brandRendered = (page, want) =>
  page.evaluate(
    (want) => {
      const name = (document.querySelector('.login-identity p')?.textContent ?? '').trim()
      const motto = (document.querySelector('.login-motto')?.textContent ?? '').trim()
      return name === want.name && motto === `"${want.motto}"`
    },
    want,
  )

/* ---- Login ------------------------------------------------------------
   Every entry is:

     key    the name a screenshot and a check are filed under
     screen the harness surface, which decides what is mounted
     auth   the auth condition the guard is given, when it is not the
            screen's own default
     state  what the harness's reads and writes must answer with
     at     the address, where a case is about an address
     note   what the entry is for, which is what a reviewer reads beside the
            screenshot
     proof  a predicate for the state the entry's own name claims
     drive  the presses a member makes to reach it, where there are any */
export const LOGIN_FLOWS = [
  {
    key: 'populated',
    state: 'default',
    note: 'both fields filled, nothing pressed: the form as it looks a moment before a sign in',
    proof: (page) =>
      page.evaluate(
        (want) =>
          document.querySelector('#email')?.value === want.email &&
          document.querySelector('#password')?.value === want.password &&
          document.querySelectorAll('.login-card .note').length === 0,
        { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
      ),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return fill(page, 'Password', LOGIN_PASSWORD)
    },
  },
  {
    key: 'signin-pending',
    state: 'inflight',
    note: 'the sign in in flight: the submit reads Signing in… and every control is frozen',
    proof: busyIs(SUBMIT, 'Signing in…'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      if (!(await fill(page, 'Password', LOGIN_PASSWORD))) return false
      return press(page, 'Sign in')
    },
  },
  {
    key: 'signin-failed',
    state: 'writefails',
    note: 'the sign in was refused: the auth client’s own message, in the danger Note',
    proof: noteIs('danger', 'alert', 'Invalid login credentials'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      if (!(await fill(page, 'Password', LOGIN_PASSWORD))) return false
      return press(page, 'Sign in')
    },
  },
  {
    key: 'link-noemail',
    state: 'default',
    note: 'the client side refusal: an empty address never reaches the auth client',
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'Enter your email first, then request a link.')(page)) &&
      (await calls('signInWithOtp', 0)(page)),
    drive: (page) => press(page, 'Email me a link'),
  },
  {
    key: 'link-pending',
    state: 'inflight',
    note: 'the magic link in flight: the LINK button reads Sending a link… and the submit does not',
    proof: busyIs(MAGIC_LINK, 'Sending a link…'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Email me a link')
    },
  },
  {
    key: 'link-ok',
    state: 'default',
    note: 'the link is on its way: the success treatment, with its tick and its live region',
    proof: noteIs('success', 'status', 'Check your email for a sign-in link.'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Email me a link')
    },
  },
  {
    key: 'link-failed',
    state: 'writefails',
    note: 'the server refused the link: what shouldCreateUser false answers for an address with no account',
    // The second half is what makes link-noemail's zero worth having: this
    // flow reaches the same call, so a counter that stopped recording would
    // fail here rather than turning the negative green.
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'Signups not allowed for otp')(page)) &&
      (await calls('signInWithOtp', 1)(page)),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Email me a link')
    },
  },
  {
    key: 'reset-noemail',
    state: 'default',
    note: 'the client side refusal on the reset: a different sentence from the link’s, and it is unchanged',
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'Enter your email first, then reset your password.')(page)) &&
      (await calls('resetPasswordForEmail', 0)(page)),
    drive: (page) => press(page, 'Forgot password?'),
  },
  {
    key: 'reset-pending',
    state: 'inflight',
    note: 'the reset in flight: the text link reads Sending a reset link… and the submit still reads Sign in',
    proof: busyIs(RESET, 'Sending a reset link…'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Forgot password?')
    },
  },
  {
    key: 'reset-ok',
    state: 'default',
    note: 'the reset email is on its way: the success treatment, with its own words',
    proof: noteIs('success', 'status', 'Check your email to reset your password.'),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Forgot password?')
    },
  },
  {
    key: 'reset-failed',
    state: 'writefails',
    note: 'the server refused the reset: its rate limit, printed unchanged',
    // And the positive control for reset-noemail's zero.
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'For security purposes, you can only request this after 47 seconds.')(page)) &&
      (await calls('resetPasswordForEmail', 1)(page)),
    drive: async (page) => {
      if (!(await fill(page, 'Email', LOGIN_EMAIL))) return false
      return press(page, 'Forgot password?')
    },
  },
]

/* ---- Set Password -----------------------------------------------------
   Reached the way the product reaches it, through RequireAuth: the member has
   a session and the invite or recovery flag set, so the guard renders this
   INSTEAD of the application. `auth=needspassword` is what says so, and it is
   an axis of its own rather than a state, because "has to set a password" and
   "the write hangs" are both true of the in-flight case at once. */
const NEW_PASSWORD = 'a-long-enough-passphrase'

const setPasswordCard = (page) =>
  page.evaluate(
    () =>
      !!document.querySelector('.login-card') &&
      (document.querySelector('h1')?.textContent ?? '') === 'Set your password',
  )

export const SETPASSWORD_FLOWS = [
  {
    key: 'sp-empty',
    state: 'default',
    note: 'the screen as it opens: both fields empty and Save inert, so nothing can be submitted by accident',
    proof: async (page) =>
      (await setPasswordCard(page)) &&
      page.evaluate(
        () =>
          document.querySelector('#new-password')?.value === '' &&
          document.querySelector('#confirm-password')?.value === '' &&
          document.querySelector('.login-card button[type="submit"]')?.disabled === true,
      ),
    drive: async () => true,
  },
  {
    key: 'sp-one-field',
    state: 'default',
    note: 'one field filled: Save is still inert, because a password nobody has confirmed is not a password',
    proof: (page) =>
      page.evaluate(
        (value) =>
          document.querySelector('#new-password')?.value === value &&
          document.querySelector('#confirm-password')?.value === '' &&
          document.querySelector('.login-card button[type="submit"]')?.disabled === true,
        NEW_PASSWORD,
      ),
    drive: (page) => fill(page, 'New password', NEW_PASSWORD),
  },
  {
    key: 'sp-armed',
    state: 'default',
    note: 'both fields filled: Save is live',
    proof: (page) =>
      page.evaluate(
        (value) =>
          document.querySelector('#new-password')?.value === value &&
          document.querySelector('#confirm-password')?.value === value &&
          document.querySelector('.login-card button[type="submit"]')?.disabled === false,
        NEW_PASSWORD,
      ),
    drive: async (page) => {
      if (!(await fill(page, 'New password', NEW_PASSWORD))) return false
      return fill(page, 'Confirm password', NEW_PASSWORD)
    },
  },
  {
    key: 'sp-mismatch',
    state: 'default',
    // The second half is the real claim, and it is COUNTED rather than
    // inferred. It used to rest on the card still being on screen: under
    // `default` the stub accepts an update, and accepting one clears the flag
    // and hands the screen to the application, so a card still there meant no
    // call was made. That is two behaviours standing in for one fact, and it
    // would hold just as well if the call were made and its answer thrown
    // away. Codex. The card check stays, because the screen staying put is
    // its own claim and a member's actual experience of the refusal.
    note: 'the client side refusal: two different values never reach the auth client, and the screen stays',
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'The passwords do not match.')(page)) &&
      (await setPasswordCard(page)) &&
      (await calls('updateUser', 0)(page)),
    drive: async (page) => {
      if (!(await fill(page, 'New password', NEW_PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', NEW_PASSWORD + '-typo'))) return false
      return press(page, 'Save password')
    },
  },
  {
    key: 'sp-pending',
    state: 'inflight',
    note: 'the update in flight: Save reads Saving… and is frozen',
    proof: busyIs(SUBMIT, 'Saving…'),
    drive: async (page) => {
      if (!(await fill(page, 'New password', NEW_PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', NEW_PASSWORD))) return false
      return press(page, 'Save password')
    },
  },
  {
    key: 'sp-failed',
    state: 'writefails',
    note: 'the auth client refused it: its own message in the danger Note, and the screen still there to retry on',
    // And the positive control for sp-mismatch's zero: the same call, made.
    proof: async (page) =>
      (await noteIs('danger', 'alert', 'Password should be at least 6 characters.')(page)) &&
      (await setPasswordCard(page)) &&
      (await calls('updateUser', 1)(page)),
    drive: async (page) => {
      if (!(await fill(page, 'New password', NEW_PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', NEW_PASSWORD))) return false
      return press(page, 'Save password')
    },
  },
  {
    key: 'sp-ok',
    state: 'default',
    // The hand off IS the success. There is no confirmation message to look
    // for, because clearing the flag lets RequireAuth render the application,
    // which is what the member sees instead.
    note: 'the password was set: the guard stops holding the member and the application appears',
    proof: (page) =>
      page.evaluate(
        () =>
          !document.querySelector('.login-card') &&
          !!document.querySelector('.app') &&
          !!document.querySelector('.content') &&
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/',
      ),
    drive: async (page) => {
      if (!(await fill(page, 'New password', NEW_PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', NEW_PASSWORD))) return false
      return press(page, 'Save password')
    },
  },
]

/* ---- the auth guard ---------------------------------------------------
   What LoginGate and RequireAuth actually do, at each address, for each auth
   condition. The harness mounts the real App, so these are the product's own
   guards rather than a fixture standing in for them.

   Every proof is three claims rather than one, because an ABSENCE is not a
   redirect: a blank frame, a guard returning null and a redirect to the wrong
   route all lack the markup a one-sided check looks for. So each names where
   the router ended up (read from the route witness, not from anything a page
   draws), what is now on screen, and what is gone. */
export const GUARD_CASES = [
  {
    key: 'anon-protected',
    auth: 'signedout',
    at: 'protected',
    note: 'an anonymous visitor asking for a protected page is sent to the login screen',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/login' &&
          !!document.querySelector('.login-card') &&
          (document.querySelector('h1')?.textContent ?? '') === 'Training Hub' &&
          // The protected page itself is gone, not merely unrendered: neither
          // of the two layouts the register can take is present, and nor is
          // the application shell that would hold them.
          !document.querySelector('.app') &&
          !document.querySelector('.reg-table') &&
          !document.querySelector('.player-card'),
      ),
  },
  {
    key: 'signedin-login',
    auth: 'signedin',
    at: 'login',
    note: 'a signed in member cannot stay on the login screen: the guard sends them to the application',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/' &&
          !document.querySelector('.login-card') &&
          !!document.querySelector('.app') &&
          !!document.querySelector('.content') &&
          !!document.querySelector('h1'),
      ),
  },
  {
    key: 'needspassword',
    auth: 'needspassword',
    at: 'home',
    // The address does not move, which is the point: this is not a redirect,
    // it is the guard rendering something else at the address that was asked
    // for, so the member lands where they were going once it is done.
    note: 'a member who arrived through an invite or a recovery link sets a password before the application',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/' &&
          !!document.querySelector('.login-card') &&
          (document.querySelector('h1')?.textContent ?? '') === 'Set your password' &&
          !document.querySelector('.app'),
      ),
  },
  {
    key: 'loading-login',
    auth: 'authloading',
    at: 'login',
    note: 'the session is still being resolved on the login route: neither screen is shown until it is known',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/login' &&
          !document.querySelector('.login-card') &&
          !document.querySelector('.app') &&
          document.body.innerText.trim() === 'Loading…',
      ),
  },
  {
    key: 'loading-protected',
    auth: 'authloading',
    at: 'protected',
    // The same splash, but through the OTHER guard. Both branches matter: a
    // guard that redirected while the session was still unknown would bounce
    // a signed in member off the page they asked for on every cold load.
    note: 'the same on a protected route: RequireAuth waits rather than deciding on an unknown session',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/players' &&
          !document.querySelector('.login-card') &&
          !document.querySelector('.app') &&
          document.body.innerText.trim() === 'Loading…',
      ),
  },
  {
    key: 'expired-link',
    auth: 'signedout',
    // The address an expired link ACTUALLY lands on, which is not /login.
    // All three flows redirect to a bare origin (Login.tsx passes
    // window.location.origin, invite-user passes APP_ORIGIN), so the arrival
    // is at `/`, RequireAuth is the guard that meets it, and the redirect to
    // /login is part of what this case reproduces rather than its setup.
    at: 'home',
    /* THE HONEST FINDING, driven rather than asserted. There is no expired
       link presentation in this product to photograph: the member reads the
       ordinary login screen with NOTHING said about the link that failed, and
       the redirect strips the fragment on the way, so even the URL evidence
       is gone. This is what is actually there, and the shot is filed under a
       name that says so.

       A visual slice is not the place to invent one. What it can do is stop
       the absence being a surprise, which is what naming it here does. */
    note: 'the state an expired invite or recovery link leaves, at the address it lands on: redirected to the ordinary login screen, which says nothing about it',
    proof: async (page) =>
      (await noNote(page)) &&
      page.evaluate(
        () =>
          // The redirect happened: the arrival was at `/` and the router is
          // at /login. An assertion that only found the login card would hold
          // for a page that had never moved.
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/login' &&
          !!document.querySelector('.login-card') &&
          (document.querySelector('h1')?.textContent ?? '') === 'Training Hub',
      ),
  },
  {
    key: 'expired-link-signedin',
    auth: 'signedin',
    at: 'home',
    /* The other half of the same arrival, and the reason the absence above is
       not simply a missing screen. The client writes no session for an error
       fragment, but it does not clear one either, so a member whose device
       already holds a valid session is let straight into the application with
       the failed link's fragment still in the address bar. Two members follow
       the same dead link and get two different screens, and neither is told
       anything. Recorded rather than changed: giving either of them a message
       is a product decision, not a visual one. */
    note: 'the same dead link on a device that is already signed in: straight into the application, nothing said',
    proof: (page) =>
      page.evaluate(
        () =>
          document.querySelector('[data-route]')?.getAttribute('data-route') === '/' &&
          !document.querySelector('.login-card') &&
          !!document.querySelector('.app') &&
          !!document.querySelector('.content'),
      ),
  },
]

/* Every entry the tools drive, in one list, so a tool cannot cover Login and
   quietly skip Set Password. `screen` and `auth` are filled in here rather
   than repeated on each entry above. */
export const AUTH_FLOWS = [
  ...LOGIN_FLOWS.map((f) => ({ ...f, screen: 'login' })),
  ...SETPASSWORD_FLOWS.map((f) => ({ ...f, screen: 'auth', auth: 'needspassword' })),
]

// The query string an auth entry's page opens on. The address and the auth
// condition ride beside the state rather than inside it, for the reason `at`
// exists everywhere else in the harness: they are different things.
export function queryForAuth(entry, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  const q = new URLSearchParams({ screen: entry.screen ?? 'auth', ...clean })
  if (entry.auth) q.set('auth', entry.auth)
  if (entry.at) q.set('at', entry.at)
  if (entry.state && entry.state !== 'default') q.set('state', entry.state)
  return q
}

// The whole address, in one place, so the three tools cannot open an entry
// two different ways. There is no fragment: see the note above the guard
// cases for why an expired link's is deliberately not put on this URL.
export const urlForAuth = (base, entry, extra = {}) => `${base}/?${queryForAuth(entry, extra)}`

/* Drives an entry and proves the state its name claims. Returns the reason it
   failed, or null on success.

   The proof is not decoration. Every entry files a screenshot or a
   measurement under a name that asserts an outcome, and a press that quietly
   no-ops leaves an untouched form under that name, which reads as evidence. */
export async function runAuthFlow(page, entry) {
  if (entry.drive && !(await entry.drive(page))) return 'the controls it drives are not on the page'
  await pause(page)
  if (!entry.proof) return `the entry claims "${entry.note}" and nothing checks it`
  const held = await entry.proof(page).catch(() => false)
  return held ? null : `it was driven, but the state its name claims never held`
}
