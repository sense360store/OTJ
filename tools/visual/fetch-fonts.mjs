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

// fetch() resolves for a 429 or a 503 as happily as for a 200, so an error
// body would otherwise be written as fonts.css, the manifest published, and
// shoot.mjs would announce that it is serving the cache while Chromium
// silently fell back to a system typeface. A screenshot in the wrong
// typeface verifies nothing about a type scale, and it does not look wrong
// enough to notice. So every response is checked, the bytes are checked for
// the woff2 signature, and nothing is written until all of it has passed.
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`)
  return res
}

const cssRes = await get(CSS_URL)
const css = await cssRes.text()
if (!/@font-face/.test(css)) throw new Error(`no @font-face in the stylesheet from ${CSS_URL}`)

const files = []
const manifest = { [CSS_URL]: 'fonts.css' }
let i = 0
for (const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
  const url = m[1]
  if (manifest[url]) continue
  const name = `f${i++}.woff2`
  const bytes = Buffer.from(await (await get(url)).arrayBuffer())
  // wOF2. A 200 carrying an HTML error page would pass the status check.
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(`${url} did not return woff2 (${bytes.length} bytes)`)
  }
  files.push([name, bytes])
  manifest[url] = name
}
if (files.length === 0) throw new Error(`the stylesheet from ${CSS_URL} named no font files`)

await mkdir(OUT, { recursive: true })
for (const [name, bytes] of files) await writeFile(path.join(OUT, name), bytes)
await writeFile(path.join(OUT, 'fonts.css'), css)
// The manifest is the last thing written, so a run that throws leaves no
// cache for shoot.mjs to find and claim.
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`cached ${files.length} font files to ${OUT}`)
