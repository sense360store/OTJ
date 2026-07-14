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
    },
  },
})
