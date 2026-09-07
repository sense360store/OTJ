// Drive the COACH-5 harness entries only, at two widths and both themes,
// through the same runAdminFlow contract the full tools use, and file a
// screenshot per entry. Development only, run from the repo root.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { VENUE_FLOWS, urlForAdmin, runAdminFlow } from './admin.mjs'

const BASE = 'http://localhost:5199'
const OUT = process.argv[2] ?? 'venue-shots'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'], timeout: 20000 })
let failed = 0
for (const entry of VENUE_FLOWS) {
  for (const theme of ['light', 'dark']) {
    for (const w of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } })
      page.setDefaultTimeout(4000)
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
      await page.goto(urlForAdmin(BASE, entry, { theme }), { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.locator('h1').first().waitFor({ timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(500)
      const why = await runAdminFlow(page, entry)
      const file = `${OUT}/${entry.key}-${theme}-${w}.png`
      await page.screenshot({ path: file, fullPage: true })
      if (why || errors.length) {
        failed++
        console.log(`FAIL ${entry.key} ${theme} ${w}: ${why ?? ''} ${errors.join(' | ')}`)
      } else {
        console.log(`ok   ${entry.key} ${theme} ${w}`)
      }
      await page.close()
    }
  }
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL VENUE FLOWS HELD')
process.exit(failed ? 1 : 0)
