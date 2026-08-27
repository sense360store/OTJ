// Development only. Serves tools/visual, which mounts the real screens with
// the data layer swapped for fixtures so the acceptance surfaces can be
// opened and screenshotted. `npm run build` uses vite.config.ts and never
// sees this file.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

// The modules that reach Supabase, and only those. Everything else the
// screens import is the real thing.
const STUBS: Record<string, string> = {
  'src/lib/queries.ts': 'tools/visual/stubs/queries.tsx',
  'src/lib/supabase.ts': 'tools/visual/stubs/supabase.ts',
  'src/hooks/useAuth.tsx': 'tools/visual/stubs/useAuth.tsx',
  'src/hooks/useClubBranding.ts': 'tools/visual/stubs/useClubBranding.ts',
}

function visualStubs(): Plugin {
  return {
    name: 'otj-visual-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // A stub re-exports the real module it replaces, so it must be able to
      // reach it without being redirected back to itself.
      if (importer && importer.includes('/tools/visual/stubs/')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      const rel = path.relative(root, resolved.id).split(path.sep).join('/')
      const stub = STUBS[rel]
      return stub ? path.resolve(root, stub) : null
    },
  }
}

export default defineConfig({
  root: path.resolve(root, 'tools/visual'),
  plugins: [react(), visualStubs()],
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  // Built into the scratch directory rather than dist/, so it can never be
  // mistaken for the application's own build output. shoot.mjs runs against
  // the built copy: a dev server re-transforms two hundred modules on every
  // page load, which turns a hundred and thirty screenshots into half an hour.
  build: { outDir: path.resolve(root, 'node_modules/.visual-harness'), emptyOutDir: true },
})
