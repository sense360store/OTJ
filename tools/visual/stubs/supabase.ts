// A Supabase client that answers nothing. The harness overrides every hook
// that reads, so this exists only so the modules that import the client can
// load. It makes no network call.
import { fixtures } from '../fixtures'

const answer = () => Promise.resolve({ data: null, error: null })

/* ---- the auth client's calls ----------------------------------------
   Four of them do not go through a query hook: Account's password and email
   changes, and Login's sign in, magic link and password reset all await the
   auth client directly and read its error. So these are the calls on the stub
   that answer from the harness state, in the same phases the write hooks use.
   `inflight` never settles, which is what leaves a submit reading its gerund;
   `writefails` answers with an error in the shape the auth client returns;
   and `writeslow` settles after a beat, which is what lets a driver act while
   a call is still running.

   The message depends on WHICH call is being made, because a refused sign in,
   a refused reset and a rejected password are different failures and a
   screenshot of each should say what the server would say. */
const HANGS = () => new Promise<never>(() => {})
const AUTH_ERRORS: Record<'password' | 'email', string> = {
  password: 'Password should be at least 6 characters.',
  email: 'Unable to validate email address: invalid format',
}

/* One phase rule for every call on the auth client, because the three write
   phases mean the same thing here as everywhere else in the harness:
   `inflight` hangs, `writefails` refuses, `writeslow` settles slowly so a
   driver can act while a call is still running, and `writeslowfails` does both
   at once. Which CALL is driven is
   decided by the press, never by a state per control, exactly as the Account
   screen's writes are.

   The message is the caller's own, because a refused sign in and a refused
   reset are different failures and a screenshot of each should carry what
   the server would actually say. */
function phased(message: string, data: unknown = null) {
  const state = fixtures.state
  if (state === 'inflight' || state === 'photoinflight') return HANGS()
  if (state === 'writeslow' || state === 'photoslow') {
    return new Promise((resolve) => setTimeout(() => resolve({ data, error: null }), 1200))
  }
  if (state === 'writefails' || state === 'photofails') {
    return Promise.resolve({ data: null, error: { message } })
  }
  // Slow AND refused, which is the one combination the three phases above
  // cannot express and the only one that puts an outcome message on screen
  // while a driver still has time to move focus. See fixtures.ts.
  if (state === 'writeslowfails') {
    return new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message } }), 1200))
  }
  return Promise.resolve({ data, error: null })
}

/* ---- what the harness can prove about a call that must NOT happen ----
   Three states on these two screens are refusals the SCREEN makes, before the
   auth client is reached: a Set Password mismatch, and each of Login's two
   "enter your email first" sentences. Their whole claim is a negative, and a
   browser cannot see a call that was never made.

   Inferring it from what is drawn is not the same claim. The mismatch proof
   used to read "the Set Password card is still up, and accepting an update
   would have handed the screen to the application, so the client was never
   reached", which is a chain of two behaviours standing in for one fact and
   would still hold if the call were made and its result thrown away. Codex.

   So the calls are counted. The counter lives on the window because a browser
   check reads it from outside the module graph, and it is the harness stub
   rather than the product: nothing under src/ knows it exists.

   A proof reading this must FAIL when the counter is absent, never pass: an
   absent counter means the page is not running this stub, which makes the
   claim unproved rather than true. And a zero is only worth having beside a
   one, so each of the three negatives is paired with a flow that DOES make the
   same call and asserts the count is 1. Without that pair, deleting the
   record() line below would turn all three negatives green. */
const authCalls: Record<string, number> = Object.create(null)
;(globalThis as unknown as { __authCalls?: Record<string, number> }).__authCalls = authCalls
const record = <T>(name: string, answer: T): T => {
  authCalls[name] = (authCalls[name] ?? 0) + 1
  return answer
}

function updateUser(attrs: { password?: string; email?: string }) {
  const field = attrs && 'password' in attrs ? 'password' : 'email'
  return record('updateUser', phased(AUTH_ERRORS[field]))
}

/* ---- the login screen's three calls -----------------------------------
   Each carries the message GoTrue answers that particular refusal with, so
   the danger Note in a screenshot says what a member would really read. The
   messages belong to the server; the screen prints them unchanged, which is
   the behaviour this slice does not touch.

   A SUCCESSFUL password sign in deliberately signs nobody in here: who the
   harness is signed in as is the `auth` query key's business, and the
   redirect a real sign in causes is proved as a route witness rather than as
   a side effect of a press. */
const SESSION_DATA = { user: null, session: null }
const signInWithPassword = () => record('signInWithPassword', phased('Invalid login credentials', SESSION_DATA))
// What shouldCreateUser: false answers for an address that has no account.
const signInWithOtp = () => record('signInWithOtp', phased('Signups not allowed for otp', SESSION_DATA))
const resetPasswordForEmail = () =>
  record('resetPasswordForEmail', phased('For security purposes, you can only request this after 47 seconds.', {}))

function table() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const k of [
    'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or',
    'order', 'limit', 'range', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'filter', 'match',
  ]) {
    chain[k] = self
  }
  chain.single = answer
  chain.maybeSingle = answer
  chain.then = (r: (v: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
  return chain
}

export const supabase = {
  from: table,
  rpc: answer,
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword,
    signInWithOtp,
    resetPasswordForEmail,
    signOut: answer,
    updateUser,
  },
  storage: { from: () => ({ createSignedUrl: answer, upload: answer, remove: answer }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe() {} }),
  removeChannel() {},
  functions: { invoke: answer },
} as unknown as typeof import('../../../src/lib/supabase').supabase
