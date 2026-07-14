// Shared plumbing for the security policy suite: local stack discovery,
// per-role authenticated clients, and the seeded test fixtures.
//
// LOCAL ONLY. Every helper here refuses to talk to anything but a local
// Supabase stack (localhost or 127.0.0.1). No production URL, key, JWT or
// object path appears in this suite; the local keys are resolved at runtime
// from `npx supabase status` or from environment variables, never committed.

import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect } from 'vitest'

// ---------------------------------------------------------------------
// Fixture identifiers. All synthetic: fixed UUIDs in the same style as the
// local seed, invented display names, and a reserved-for-testing email
// domain. Club A is the seeded local club; club B exists only so the club
// isolation contract is executable while the real seed has one club.
// ---------------------------------------------------------------------
export const CLUB_A = '11111111-1111-1111-1111-111111111111'
export const CLUB_B = '33333333-3333-3333-3333-333333333333'
export const TEST_TEAM = '44444444-4444-4444-4444-444444444444'
export const SEEDED_SESSION = 'a000000a-0000-0000-0000-000000000001'
export const SEEDED_DRILL = 'd000000d-0000-0000-0000-000000000001'

// One synthetic password for every local test user. This is not a secret:
// it authenticates disposable accounts on a throwaway local stack only.
export const TEST_PASSWORD = 'otj-local-security-tests-only'

export type TestUserName = 'admin' | 'coachOne' | 'coachTwo' | 'parent' | 'outsider'

export interface TestUserSpec {
  email: string
  fullName: string
  role: 'admin' | 'coach' | 'parent'
  clubId: string
}

export const TEST_USERS: Record<TestUserName, TestUserSpec> = {
  admin: {
    email: 'sec-admin@otj-security-tests.local',
    fullName: 'Security Test Admin',
    role: 'admin',
    clubId: CLUB_A,
  },
  coachOne: {
    email: 'sec-coach-one@otj-security-tests.local',
    fullName: 'Security Test Coach One',
    role: 'coach',
    clubId: CLUB_A,
  },
  coachTwo: {
    email: 'sec-coach-two@otj-security-tests.local',
    fullName: 'Security Test Coach Two',
    role: 'coach',
    clubId: CLUB_A,
  },
  parent: {
    email: 'sec-parent@otj-security-tests.local',
    fullName: 'Security Test Parent',
    role: 'parent',
    clubId: CLUB_A,
  },
  outsider: {
    email: 'sec-outsider@otj-security-tests.local',
    fullName: 'Security Test Outsider Coach',
    role: 'coach',
    clubId: CLUB_B,
  },
}

// ---------------------------------------------------------------------
// Stack discovery. Environment variables win (useful for CI); otherwise the
// values come from `npx supabase status` for the running local stack. The
// URL must resolve to a local host or every helper refuses to run.
// ---------------------------------------------------------------------
export interface StackConfig {
  url: string
  anonKey: string
  serviceRoleKey: string
}

let cachedStack: StackConfig | null = null

function assertLocal(url: string): void {
  const host = new URL(url).hostname
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  if (!local) {
    throw new Error(
      `The security suite runs only against a local Supabase stack; refusing URL host "${host}". ` +
        'Start the stack with `npx supabase start` and `npx supabase db reset`.',
    )
  }
}

export function stackConfig(): StackConfig {
  if (cachedStack) return cachedStack
  const fromEnv = {
    url: process.env.OTJ_TEST_SUPABASE_URL,
    anonKey: process.env.OTJ_TEST_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.OTJ_TEST_SUPABASE_SERVICE_ROLE_KEY,
  }
  if (fromEnv.url && fromEnv.anonKey && fromEnv.serviceRoleKey) {
    assertLocal(fromEnv.url)
    cachedStack = { url: fromEnv.url, anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey }
    return cachedStack
  }
  let output: string
  try {
    output = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Error(
      'Could not read the local Supabase stack status. Start it first: ' +
        '`npx supabase start` then `npx supabase db reset`.',
    )
  }
  const values = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim())
    if (match) values.set(match[1], match[2])
  }
  const url = values.get('API_URL')
  const anonKey = values.get('ANON_KEY')
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('`npx supabase status` did not report API_URL, ANON_KEY and SERVICE_ROLE_KEY.')
  }
  assertLocal(url)
  cachedStack = { url, anonKey, serviceRoleKey }
  return cachedStack
}

// ---------------------------------------------------------------------
// Clients. One anonymous client (no session: what an unauthenticated caller
// gets), one service-role client (fixture setup and out-of-band verification
// only, never the subject of an assertion), and one signed-in client per
// test user, authenticated with a real JWT via the password grant.
// ---------------------------------------------------------------------
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

export function anonClient(): SupabaseClient {
  const { url, anonKey } = stackConfig()
  return createClient(url, anonKey, clientOptions)
}

export function serviceClient(): SupabaseClient {
  const { url, serviceRoleKey } = stackConfig()
  return createClient(url, serviceRoleKey, clientOptions)
}

export interface SignedInUser {
  client: SupabaseClient
  userId: string
}

const signedIn = new Map<TestUserName, SignedInUser>()

export async function signIn(name: TestUserName): Promise<SignedInUser> {
  const existing = signedIn.get(name)
  if (existing) return existing
  const spec = TEST_USERS[name]
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: spec.email,
    password: TEST_PASSWORD,
  })
  if (error || !data.user) {
    throw new Error(
      `Could not sign in as ${spec.email}: ${error?.message ?? 'no user returned'}. ` +
        'Did the global setup run against a freshly reset local stack?',
    )
  }
  const entry = { client, userId: data.user.id }
  signedIn.set(name, entry)
  return entry
}

// ---------------------------------------------------------------------
// Assertion helpers for how PostgREST reports refusals: a blocked INSERT
// raises 42501 (insufficient privilege), while blocked UPDATE and DELETE are
// silently filtered by RLS and affect zero rows. Triggers raise P0001.
// ---------------------------------------------------------------------
export interface PgError {
  code?: string
  message: string
}

export function expectRlsInsertRefusal(error: PgError | null): void {
  expect(error, 'expected the insert to be refused by row level security').not.toBeNull()
  expect(error?.code).toBe('42501')
}

export function expectTriggerRefusal(error: PgError | null, messagePart: string): void {
  expect(error, 'expected the write to be refused by a database trigger').not.toBeNull()
  expect(error?.message ?? '').toContain(messagePart)
}

// A short unique suffix so disposable rows and object paths never collide
// across runs against the same local stack.
export function runId(): string {
  return crypto.randomUUID().slice(0, 8)
}
