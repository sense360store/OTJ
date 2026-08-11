import { defineConfig } from 'vite'
// Importing from vitest/config also augments vite's config type with the
// `test` block, replacing the previous triple slash reference.
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest reads this block; `vite build` ignores it. The dummy Supabase
  // values let modules that import the client (queries.ts) load under test
  // without real keys. They are placeholders, not secrets, and no test makes
  // a network call. The setup file supplies a WebSocket on Node 20 so the
  // client constructs. See src/lib/supabase.ts and vitest.setup.ts.
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // The security policy suite under tests/security needs a running local
    // Supabase stack and is deliberately red until the RLS and Storage
    // remediation lands, so it runs only through `npm run test:security`
    // (vitest.security.config.ts), never as part of `npm test`.
    exclude: [...configDefaults.exclude, 'tests/**'],
    env: {
      VITE_SUPABASE_URL: 'http://localhost',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      // The club is in Yorkshire and the product is defined in its local
      // wall clock: `date` and `time` are read as the coach typed them, and
      // whether a session "ended earlier today" is a question about the
      // local calendar day. Under a UTC runner every one of those rules is
      // still exercised, but the interesting half of them, the hours where
      // BST and UTC disagree, never happens. Pinning the club's zone is what
      // makes the DST tests in lib/sessionLifecycle.test.ts mean anything.
      //
      // The whole suite was run under this zone before it was pinned and
      // nothing changed, so this narrows what the tests can miss without
      // altering what they assert.
      TZ: 'Europe/London',
    },
  },
})
