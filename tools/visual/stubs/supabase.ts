// A Supabase client that answers nothing. The harness overrides every hook
// that reads, so this exists only so the modules that import the client can
// load. It makes no network call.
const answer = () => Promise.resolve({ data: null, error: null })

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
    updateUser: answer,
  },
  storage: { from: () => ({ createSignedUrl: answer, upload: answer, remove: answer }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe() {} }),
  removeChannel() {},
  functions: { invoke: answer },
} as unknown as typeof import('../../../src/lib/supabase').supabase
