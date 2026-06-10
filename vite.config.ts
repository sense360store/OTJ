/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
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
    env: {
      VITE_SUPABASE_URL: 'http://localhost',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
