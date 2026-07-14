import { defineConfig } from 'vitest/config'

// The database and Storage policy test suite. Runs only against the local
// Supabase stack (the helpers refuse any non-local URL) and only through
// `npm run test:security`, never as part of `npm test`.
//
// IMPORTANT: this suite intentionally reports failures today. It asserts the
// intended permission matrix from docs/security/policy-test-matrix.md, and
// several Storage assertions (and one boards safeguarding assertion) do not
// hold against the current migrations. Those failures are the evidence for
// the remediation migration; do not weaken the assertions to make the suite
// green.
export default defineConfig({
  test: {
    include: ['tests/security/**/*.test.ts'],
    globalSetup: ['tests/security/global-setup.ts'],
    // Test files share seeded fixtures and a live database, so they run one
    // file at a time for deterministic results.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
