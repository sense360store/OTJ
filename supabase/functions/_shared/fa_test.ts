// Smoke tests for the shared FA import core. These are hermetic (no network,
// no database): they pin the allowlist and the parsing behaviour the two
// Edge Functions are built on, so the refactor out of fa-import can be
// checked without a live stack. Run with:
//
//   deno test --allow-env supabase/functions/_shared/fa_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  allowedUrl,
  ASSET_HOST,
  MAX_PROGRAMME_WEEKS,
  normalisedHref,
  PAGE_HOST,
  parseOverviewPage,
  parseSessionPage,
  weekNumber,
} from './fa.ts'

// ---- The allowlist (the wrong-domain rejection happens before any fetch) --

Deno.test('allowedUrl rejects other hosts', () => {
  assertEquals(allowedUrl('https://example.com/sessions/x', PAGE_HOST), null)
  assertEquals(allowedUrl('https://www.learn.englandfootball.com/x', PAGE_HOST), null)
  assertEquals(allowedUrl('https://learn.englandfootball.com.evil.com/x', PAGE_HOST), null)
  assertEquals(allowedUrl('https://learn.englandfootball.com/x', ASSET_HOST), null)
})

Deno.test('allowedUrl rejects non-https and junk', () => {
  assertEquals(allowedUrl('http://learn.englandfootball.com/x', PAGE_HOST), null)
  assertEquals(allowedUrl('ftp://learn.englandfootball.com/x', PAGE_HOST), null)
  assertEquals(allowedUrl('not a url', PAGE_HOST), null)
  assertEquals(allowedUrl('', PAGE_HOST), null)
})

Deno.test('allowedUrl accepts the allowlisted hosts', () => {
  assertEquals(allowedUrl('https://learn.englandfootball.com/sessions/x', PAGE_HOST)?.hostname, PAGE_HOST)
  assertEquals(allowedUrl('https://LEARN.ENGLANDFOOTBALL.COM/sessions/x', PAGE_HOST)?.hostname.toLowerCase(), PAGE_HOST)
  assertEquals(allowedUrl('https://cdn.englandfootball.com/EFLearning/a.pdf', ASSET_HOST)?.hostname, ASSET_HOST)
})

// ---- Dead or wrong pages: no title means the 422 "does not look like" path

Deno.test('parseSessionPage yields no title for a page that is not a session', () => {
  const page = parseSessionPage('<html><body><p>Nothing here.</p></body></html>')
  assertEquals(page.title, '')
  assertEquals(page.activities.length, 0)
})

// ---- A representative session page parses as fa-import always has ---------

const SESSION_HTML = `
<html><head>
<meta property="og:title" content="Moving with the ball: dribbling and turning - week six" />
<meta name="description" content="A session about moving with the ball." />
</head><body>
<p>This is week six of the moving with the ball and turning to attack session programme.</p>
<h2>Session intentions</h2>
<ul><li>Move with the ball</li><li>Turn away from pressure</li></ul>
<div class="session-setup__grid__item"><img src="/icons/players.svg"><p>8-16 players</p></div>
<div class="session-setup__grid__item"><img src="/icons/pitch.svg"><p>20x20 yards</p></div>
<div class="session-setup__grid__item"><img src="/icons/cones.svg"><p>Cones</p></div>
<div class="image-gallery">
  <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/d1.svg" alt="Three-in-a-row: pass and move">
  <div class="image-gallery__caption">Three-in-a-row: pass and move</div>
  <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/d2.svg" alt="Second practice">
  <div class="image-gallery__caption">Second practice</div>
</div>
<h2>Make it easier</h2><ul><li>Bigger area</li></ul>
<h2>Make it harder</h2><ul><li>Add a defender</li></ul>
<section class="course-important-information"><p>Keep the ball close.</p><p>Look up before turning.</p></section>
<a href="https://cdn.englandfootball.com/EFLearning/plans/week-six.pdf">Download session plan</a>
</body></html>`

Deno.test('parseSessionPage extracts the session model fields', () => {
  const page = parseSessionPage(SESSION_HTML)
  assertEquals(page.title, 'Moving with the ball: dribbling and turning - week six')
  assertEquals(page.summary, 'A session about moving with the ball.')
  assertEquals(page.intentions, ['Move with the ball', 'Turn away from pressure'])
  assertEquals(page.players, '8-16 players')
  assertEquals(page.space, '20x20 yards')
  assertEquals(page.equipment, ['Cones'])
  assertEquals(page.activities.length, 2)
  assertEquals(page.activities[0].imageUrl, 'https://cdn.englandfootball.com/EFLearning/d1.svg')
  assertEquals(page.activities[0].phrase, 'Three-in-a-row')
  assertEquals(page.easier, ['Bigger area'])
  assertEquals(page.harder, ['Add a defender'])
  assertEquals(page.points, ['Keep the ball close.', 'Look up before turning.'])
  assertEquals(page.pdfUrl, 'https://cdn.englandfootball.com/EFLearning/plans/week-six.pdf')
  assertEquals(page.programme, 'Moving with the ball and turning to attack')
  assertEquals(page.week, 6)
})

// ---- The overview parser: week links, allowlist, dedupe, cap --------------

const OVERVIEW_URL = new URL('https://learn.englandfootball.com/sessions/session-programmes/moving-with-the-ball')

const OVERVIEW_HTML = `
<html><head>
<meta property="og:title" content="Session programme: moving with the ball and turning to attack" />
<meta name="description" content="A six week programme." />
</head><body>
<h2>Session intentions</h2>
<ul><li>Move with the ball</li></ul>
<a href="/sessions/session-programmes/moving-with-the-ball">This page</a>
<a href="/sessions/week-one-attack"><h3>Week one: dribble fast</h3></a>
<a href="https://learn.englandfootball.com/sessions/week-two-attack?utm=x#top">Week two: turning</a>
<a href="https://learn.englandfootball.com/sessions/week-two-attack">Week two again</a>
<a href="https://evil.com/sessions/week-three-attack">Week three: elsewhere</a>
<a href="https://learn.englandfootball.com/sessions/some-related-session">A related session</a>
<a href="https://cdn.englandfootball.com/EFLearning/plans/other.pdf">Download session plan</a>
<a href="https://cdn.englandfootball.com/EFLearning/plans/programme.pdf">Download the programme</a>
</body></html>`

Deno.test('parseOverviewPage finds the named weeks on the same host only', () => {
  const overview = parseOverviewPage(OVERVIEW_HTML, OVERVIEW_URL)
  assertEquals(overview.title, 'Session programme: moving with the ball and turning to attack')
  assertEquals(overview.summary, 'A six week programme.')
  assertEquals(overview.intentions, ['Move with the ball'])
  // The programme PDF wins over the plain session plan PDF.
  assertEquals(overview.pdfUrl, 'https://cdn.englandfootball.com/EFLearning/plans/programme.pdf')
  // Two weeks: the relative link resolved, the duplicate and the off-host
  // link dropped, the unnumbered related link ignored, the self link ignored.
  assertEquals(overview.weekLinks.length, 2)
  assertEquals(overview.weekLinks[0].week, 1)
  assertEquals(overview.weekLinks[0].url, 'https://learn.englandfootball.com/sessions/week-one-attack')
  assertEquals(overview.weekLinks[1].week, 2)
  assertEquals(overview.weekLinks[1].url, 'https://learn.englandfootball.com/sessions/week-two-attack')
  assertEquals(overview.truncated, false)
})

Deno.test('parseOverviewPage falls back to document order without named weeks', () => {
  const html = `
    <html><head><meta property="og:title" content="Session programme: passing" /></head><body>
    <a href="/sessions/first-block">First block</a>
    <a href="/sessions/second-block">Second block</a>
    </body></html>`
  const overview = parseOverviewPage(html, OVERVIEW_URL)
  assertEquals(overview.weekLinks.length, 2)
  assertEquals(overview.weekLinks[0].week, null)
  assertEquals(overview.weekLinks[0].url, 'https://learn.englandfootball.com/sessions/first-block')
  assertEquals(overview.weekLinks[1].url, 'https://learn.englandfootball.com/sessions/second-block')
})

Deno.test('parseOverviewPage caps the week links', () => {
  const links = Array.from(
    { length: MAX_PROGRAMME_WEEKS + 2 },
    (_, i) => `<a href="/sessions/week-${i + 1}">Week ${i + 1}: practice</a>`,
  ).join('\n')
  const html = `<html><head><meta property="og:title" content="Session programme: big" /></head><body>${links}</body></html>`
  const overview = parseOverviewPage(html, OVERVIEW_URL)
  assertEquals(overview.truncated, true)
  assertEquals(overview.weekLinks.length, MAX_PROGRAMME_WEEKS)
  assertEquals(overview.weekLinks[0].week, 1)
  assertEquals(overview.weekLinks[MAX_PROGRAMME_WEEKS - 1].week, MAX_PROGRAMME_WEEKS)
})

// ---- Idempotence rests on the normalised source URL -----------------------

Deno.test('normalisedHref drops query, fragment and trailing slashes', () => {
  assertEquals(
    normalisedHref(new URL('https://learn.englandfootball.com/sessions/a-page/?utm=x#top')),
    'https://learn.englandfootball.com/sessions/a-page',
  )
  assertEquals(normalisedHref(new URL('https://learn.englandfootball.com/')), 'https://learn.englandfootball.com')
})

Deno.test('weekNumber reads words and digits', () => {
  assertEquals(weekNumber('one'), 1)
  assertEquals(weekNumber('SIX'), 6)
  assertEquals(weekNumber('4'), 4)
  assertEquals(weekNumber('zero'), null)
  assertEquals(weekNumber('soon'), null)
  assert(weekNumber('12') === 12)
})
