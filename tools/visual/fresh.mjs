// Refuses to measure a build that is not the one on disk. Development only.
//
// `vite build` writes with emptyOutDir, which UNLINKS the output directory and
// recreates it. A `vite preview` started before that build keeps its handle on
// the deleted directory and goes on serving the old, now unlinked, files. The
// server answers 200, every page renders, and every measurement describes a
// build that no longer exists. Nothing about it looks wrong.
//
// That is the same failure the screenshot proofs exist to stop, one level
// down: a result that is present, plausible and about the wrong thing is worse
// than no result, because it reads as evidence. So each tool asserts, before
// it measures anything, that the asset the server hands out is the asset the
// last build wrote, AND that the last build is of the source on disk.
//
// Both halves matter and only one of them was here first. A preview older
// than the build serves unlinked files; a build older than the source
// measures the previous rule. The second is the easier one to cause, because
// nothing about it needs a mistake: editing a stylesheet and running a tool
// is enough.
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OUT = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness', import.meta.url)))

const assetsOf = (html) => (html.match(/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)/g) ?? []).sort()

/* Everything the harness BUNDLE is built from, and nothing else. The three
   Playwright tools, this file and the two drive modules are read by node at
   run time rather than compiled into the page, so editing one of them must
   not invalidate a build; editing a stylesheet, a screen or a fixture must.
   Listed rather than globbed for exactly that reason: a directory sweep of
   tools/visual would make every check runner its own input and the guard
   would cry stale on every edit until it was ignored. */
const BUNDLE_INPUTS = [
  'src',
  'tools/visual/main.tsx',
  'tools/visual/index.html',
  'tools/visual/fixtures.ts',
  'tools/visual/stubs',
  'vite.visual.config.ts',
]

// The newest modification time under a path, skipping the tests, which are
// not bundled either.
async function newest(rel) {
  const full = path.join(ROOT, rel)
  if (!existsSync(full)) return { at: 0, file: null }
  const info = await stat(full)
  if (!info.isDirectory()) return { at: info.mtimeMs, file: rel }
  let best = { at: 0, file: null }
  for (const entry of await readdir(full, { withFileTypes: true })) {
    if (entry.name.includes('.test.')) continue
    const found = await newest(path.join(rel, entry.name))
    if (found.at > best.at) best = found
  }
  return best
}

export async function assertServingCurrentBuild(base) {
  const indexPath = path.join(OUT, 'index.html')
  if (!existsSync(indexPath)) {
    console.log(`NO BUILD at ${OUT}: run \`npx vite build --config vite.visual.config.ts\` first.`)
    process.exit(1)
  }

  /* A build older than the source it was built from is the same failure as a
     preview older than the build, one level further up, and it is the one the
     first version of this file could not see: it compared the SERVER against
     the BUILD and said nothing about whether the build was of the current
     source. A stylesheet edited and not rebuilt then measures clean against
     the previous rule, which is a result that is present, plausible and about
     the wrong thing. Found by editing a rule and watching the run pass. */
  const built = (await stat(indexPath)).mtimeMs
  for (const input of BUNDLE_INPUTS) {
    const { at, file } = await newest(input)
    if (at > built) {
      console.log(
        `STALE BUILD: ${file} was changed after the harness was last built.\n` +
          '  Every measurement below would describe the previous source. Rebuild and restart the\n' +
          '  preview: `npx vite build --config vite.visual.config.ts`, then restart `vite preview`.',
      )
      process.exit(1)
    }
  }

  const onDisk = assetsOf(await readFile(indexPath, 'utf8'))

  let served
  try {
    const res = await fetch(base + '/')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    served = assetsOf(await res.text())
  } catch (e) {
    console.log(`NO HARNESS at ${base}: ${e.message}. Serve it with \`npx vite preview --config vite.visual.config.ts\`.`)
    process.exit(1)
  }

  const stale = (why) => {
    console.log(
      `STALE SERVER: ${why}\n` +
        `  served:  ${served.join(', ') || '(none)'}\n` +
        `  on disk: ${onDisk.join(', ') || '(none)'}\n` +
        'A preview started before the last build keeps serving the unlinked output directory, so every\n' +
        'measurement below would describe the wrong build. Restart the preview and run this again.',
    )
    process.exit(1)
  }

  if (onDisk.length === 0 || served.join('|') !== onDisk.join('|')) {
    stale('the preview is serving a build that is not the one on disk.')
  }

  // Matching NAMES are not enough, and this is the case that actually shipped:
  // a rebuild whose output is byte identical writes the same content hashes,
  // so index.html looks right while the files it names have been unlinked
  // underneath the running server. Every asset is fetched and sized against
  // the file on disk, so an unlinked directory fails here rather than as a
  // navigation error a hundred measurements later.
  for (const asset of onDisk) {
    let body
    try {
      const res = await fetch(base + '/' + asset)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.arrayBuffer()
    } catch (e) {
      stale(`${asset} is named by the served index but the preview cannot serve it (${e.message}).`)
    }
    const { size } = await stat(path.join(OUT, asset))
    if (body.byteLength !== size) {
      stale(`${asset} is served at ${body.byteLength} bytes and is ${size} bytes on disk.`)
    }
  }
}
