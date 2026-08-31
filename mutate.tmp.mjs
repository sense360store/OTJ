import { chromium } from 'playwright-core'
import { ADMIN_ENTRIES, queryForAdmin, runAdminFlow } from './tools/visual/admin.mjs'
const BASE = 'http://localhost:5199'
let keys = process.argv.slice(2)
if (keys[0] === 'all') keys = ADMIN_ENTRIES.map((e) => e.key)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext()
ctx.setDefaultTimeout(8000)
await ctx.route((u) => u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com'), (r) => r.abort())
let failed = 0
for (const key of keys) {
  const entry = ADMIN_ENTRIES.find((e) => e.key === key)
  if (!entry) { console.log(`MISSING ${key}`); failed++; continue }
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${BASE}/?${queryForAdmin(entry, { theme: 'light' })}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.content > *', { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(250)
  const why = await runAdminFlow(page, entry).catch((e) => String(e.message).slice(0, 60))
  if (why) { console.log(`FAIL  ${key} — ${why}`); failed++ }
  await page.close()
}
console.log(`${keys.length} entries, ${failed} failed`)
await browser.close()
