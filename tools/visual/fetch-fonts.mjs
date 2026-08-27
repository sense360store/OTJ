// Caches the two Google Fonts families locally so the harness renders in
// Archivo and Hanken Grotesk rather than a fallback stack. The screenshots
// are the point of the harness, and a shot in the wrong typeface verifies
// nothing about the type scale.
//
//   node tools/visual/fetch-fonts.mjs
//
// Writes to node_modules/.visual-harness-fonts/, which is never committed.
// shoot.mjs serves the cache to the browser by intercepting the font
// requests; with no cache it aborts them and says so.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const OUT = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap'
// Google serves woff2 only to a browser-shaped request.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

await mkdir(OUT, { recursive: true })
const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text()

const manifest = { [CSS_URL]: 'fonts.css' }
let rewritten = css
let i = 0
for (const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
  const url = m[1]
  if (manifest[url]) continue
  const name = `f${i++}.woff2`
  const bytes = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer())
  await writeFile(path.join(OUT, name), bytes)
  manifest[url] = name
  rewritten = rewritten.split(url).join(url)
}
await writeFile(path.join(OUT, 'fonts.css'), rewritten)
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`cached ${Object.keys(manifest).length - 1} font files to ${OUT}`)
