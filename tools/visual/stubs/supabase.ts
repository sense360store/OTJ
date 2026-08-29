// A Supabase client that answers nothing. The harness overrides every hook
// that reads, so this exists only so the modules that import the client can
// load. It makes no network call.
import { fixtures } from '../fixtures'

const answer = () => Promise.resolve({ data: null, error: null })

/* ---- the auth client's one write ------------------------------------
   The Account screen's password and email changes do not go through a query
   hook: they await supabase.auth.updateUser directly and read its error. So
   this is the one call on the stub that answers from the harness state, in
   the same two phases the write hooks use. `inflight` never settles, which is
   what leaves the submit reading Saving… or Sending…, and `writefails`
   answers with an error in the shape the auth client returns.

   The message depends on WHICH field is being written, because the two are
   different failures and a screenshot of each should say what the server
   would say. */
const HANGS = () => new Promise<never>(() => {})
const AUTH_ERRORS: Record<'password' | 'email', string> = {
  password: 'Password should be at least 6 characters.',
  email: 'Unable to validate email address: invalid format',
}

function updateUser(attrs: { password?: string; email?: string }) {
  const state = fixtures.state
  if (state === 'inflight' || state === 'photoinflight') return HANGS()
  if (state === 'writefails' || state === 'photofails') {
    const field = attrs && 'password' in attrs ? 'password' : 'email'
    return Promise.resolve({ data: null, error: { message: AUTH_ERRORS[field] } })
  }
  return answer()
}

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
    signInWithPassword: answer,
    signInWithOtp: answer,
    resetPasswordForEmail: answer,
    signOut: answer,
    updateUser,
  },
  storage: { from: () => ({ createSignedUrl: answer, upload: answer, remove: answer }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe() {} }),
  removeChannel() {},
  functions: { invoke: answer },
} as unknown as typeof import('../../../src/lib/supabase').supabase
