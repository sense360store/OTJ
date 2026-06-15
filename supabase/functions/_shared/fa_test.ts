// Smoke tests for the shared FA import core. These are hermetic (no network,
// no database): they pin the allowlist and the parsing behaviour the Edge
// Functions are built on, so changes can be checked without a live stack.
// The two fixture files are real FA programme overview pages, fetched
// unmodified (see fixtures/README.md). Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/fa_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  allowedUrl,
  alreadyImportedRefusal,
  ASSET_HOST,
  contentRegion,
  countSessionLinks,
  findActivities,
  findTopicTags,
  findVideoEmbeds,
  importParsedSession,
  MAX_PROGRAMME_WEEKS,
  normalisedHref,
  PAGE_HOST,
  parseOverviewPage,
  parseSessionPage,
  themeFromTitle,
  weekFromText,
  weekNumber,
  weeksAreReliable,
} from './fa.ts'
import type { FaCaller } from './fa.ts'

function fixture(name: string): string {
  return Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url))
}

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
<div class="tag-cloud--container">
  <div class="tag-cloud">
    <div class="tag-cloud__item"><span>Session design</span></div>
    <div class="tag-cloud__item"><span>Attacking</span></div>
    <div class="tag-cloud__item"><span>Moving with the ball</span></div>
  </div>
</div>
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
  // The topic tags, the structural "Session design" label dropped.
  assertEquals(page.tags, ['Attacking', 'Moving with the ball'])
})

// ---- Topic tags: the tag cloud under the session title ---------------------
// The page lists its topics as div.tag-cloud__item entries in the article
// info block. The importer writes them to drills.tags so the library's topic
// filter can match FA drills; structural labels naming the page type rather
// than a topic are dropped.

Deno.test('findTopicTags reads the real pages and drops the structural labels', () => {
  // The marking session's cloud is Session design, Defending, Marking,
  // Intercepting: the three topics survive, in page order.
  assertEquals(findTopicTags(fixture('session-2025-marking-defend-as-friends.html')), [
    'Defending',
    'Marking',
    'Intercepting',
  ])
  // The goalkeeping video session's cloud is Goalkeeping, Sessions: the
  // plural scaffolding label is dropped, so a video session is tagged too.
  assertEquals(findTopicTags(fixture('session-2022-goalkeeping-the-basics.html')), ['Goalkeeping'])
})

Deno.test('a page without a tag cloud yields no tags and never fails', () => {
  assertEquals(findTopicTags('<html><body><p>No tags here.</p></body></html>'), [])
  assertEquals(parseSessionPage('<html><body><p>Nothing here.</p></body></html>').tags, [])
})

Deno.test('findTopicTags deduplicates, keeps page order and skips empty items', () => {
  const html = `
    <main>
      <div class="tag-cloud">
        <div class="tag-cloud__item"><span>Session</span></div>
        <div class="tag-cloud__item"><span>Defending</span></div>
        <div class="tag-cloud__item"><span>Marking</span></div>
        <div class="tag-cloud__item"><span>defending</span></div>
        <div class="tag-cloud__item"><span></span></div>
      </div>
    </main>`
  assertEquals(findTopicTags(html), ['Defending', 'Marking'])
})

// ---- Theme from the session title: the text before the word "session" -----

Deno.test('themeFromTitle reads the theme the FA names before the word session', () => {
  assertEquals(themeFromTitle('Goalkeeping session: the basics'), 'Goalkeeping')
  assertEquals(themeFromTitle('Marking and intercepting session: defend as friends'), 'Marking and intercepting')
  assertEquals(themeFromTitle('Pressing session'), 'Pressing')
  // No "session" in the title means no reliable theme, left for the coach.
  assertEquals(themeFromTitle('Moving with the ball: dribbling and turning - week six'), '')
})

// ---- Video session pages: the FA delivers some sessions as Vimeo embeds ----
// The goalkeeping basics page carries no diagrams, setup strip or coaching
// points, only FA large video players. parseSessionPage must read every
// player.vimeo.com embed so the import makes one video drill per video, not
// an empty template and not only the first video.

Deno.test('parseSessionPage reads the FA video embeds and the empty drill shape', () => {
  const page = parseSessionPage(fixture('session-2022-goalkeeping-the-basics.html'))
  assertEquals(page.title, 'Goalkeeping session: the basics')
  assertEquals(page.videoEmbeds.length, 3)
  assertEquals(page.videoEmbeds[0].embedUrl, 'https://player.vimeo.com/video/129532422')
  // No diagrams, no setup strip, no coaching points: the empty drill shape
  // that, without a video, the importer now refuses instead of landing empty.
  assertEquals(page.activities.length, 0)
  assertEquals(page.players, '')
  assertEquals(page.space, '')
  assertEquals(page.equipment.length, 0)
  assertEquals(page.points.length, 0)
})

Deno.test('the goalkeeping fixture yields three video embeds, one drill each, not one', () => {
  // The import creates one media row and one drill per entry here, so three
  // embeds in page order with their section headings means the coach gets all
  // three parts, named apart.
  const embeds = findVideoEmbeds(fixture('session-2022-goalkeeping-the-basics.html'))
  assertEquals(embeds, [
    { embedUrl: 'https://player.vimeo.com/video/129532422', heading: 'Warm up' },
    { embedUrl: 'https://player.vimeo.com/video/129532424', heading: 'Shot-stopping 1' },
    { embedUrl: 'https://player.vimeo.com/video/129532425', heading: 'Shot-stopping 2' },
  ])
})

Deno.test('the goalkeeping video page is not mistaken for a programme overview', () => {
  // fa-import refuses an empty page as an overview only when it links several
  // session pages; a real video session links none, so it reaches the import.
  const url = new URL('https://learn.englandfootball.com/sessions/resources/2022/Goalkeeping-session-the-basics')
  assert(countSessionLinks(fixture('session-2022-goalkeeping-the-basics.html'), url) <= 1)
})

Deno.test('a normal session page with diagrams is not treated as a video session', () => {
  // The marking page carries the large video player too, but it has real
  // activity diagrams, so the import takes the diagram path, not the video one.
  const page = parseSessionPage(fixture('session-2025-marking-defend-as-friends.html'))
  assertEquals(page.title, 'Marking and intercepting session: defend as friends')
  assert(page.activities.length > 0)
})

Deno.test('findVideoEmbeds ignores a page with no allowlisted player', () => {
  assertEquals(findVideoEmbeds('<html><body><iframe src="https://youtube.com/embed/x"></iframe></body></html>'), [])
  // A video-wrap with an unknown player type is not stored.
  assertEquals(
    findVideoEmbeds(
      '<main><div class="efl-large-video-player__video-wrap" data-video-type="dailymotion" data-video-id="123"></div></main>',
    ),
    [],
  )
  // The allowlisted Vimeo player resolves to its player URL; a bare wrap
  // outside a player section carries no heading.
  assertEquals(
    findVideoEmbeds(
      '<main><div class="efl-large-video-player__video-wrap" data-video-type="vimeo" data-video-id="42"></div></main>',
    ),
    [{ embedUrl: 'https://player.vimeo.com/video/42', heading: '' }],
  )
})

// ---- The activity scan is scoped to the content region --------------------
// The live import bug: a page with no real diagram gallery but an image-gallery
// reference elsewhere (a related-content rail, a script) had a phantom activity
// read out of it, which made the activity list non-empty and stopped the video
// import from running, so the three videos were discarded as empty "no media"
// drills. findActivities is scoped to the content region like every other scan,
// so only a gallery inside the page's own content yields activities.

Deno.test('findActivities reads the real diagram gallery and drops a stray gallery in the related rail', () => {
  // The marking page's four diagrams are read.
  assertEquals(findActivities(fixture('session-2025-marking-defend-as-friends.html')).length, 4)
  // The goalkeeping video page has no gallery at all: no activities.
  assertEquals(findActivities(fixture('session-2022-goalkeeping-the-basics.html')).length, 0)
  // A gallery class sitting in the dropped related-sessions rail is not an
  // activity: the scan never reaches it.
  const withStrayRail = fixture('session-2022-goalkeeping-the-basics.html').replace(
    '<h2>Related sessions</h2>',
    `<h2>Related sessions</h2>
     <div class="image-gallery">
       <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/rail-a.jpg" alt="rail thumb">
       <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/rail-b.jpg" alt="rail thumb">
     </div>`,
  )
  assertEquals(findActivities(withStrayRail).length, 0)
})

// ---- Importing a parsed session: diagrams, videos, both or neither ---------
// importParsedSession reads diagrams and videos independently, so a video
// session yields video drills, a diagram session yields diagram drills, and a
// page carrying both yields both. The stub records every insert and answers it
// with a generated id, keeping these hermetic like the rest of the file. The
// goalkeeping import touches no network because it has no diagrams to fetch;
// the mixed-content test uses off-host diagram images so storeFaAsset
// short-circuits before any fetch.

interface RecordedInsert {
  table: string
  row: Record<string, unknown>
}

function importStub() {
  const inserts: RecordedInsert[] = []
  const counts: Record<string, number> = {}
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row })
          counts[table] = (counts[table] ?? 0) + 1
          const id = `${table}-${counts[table]}`
          return {
            select(_columns: string) {
              return { single: () => Promise.resolve({ data: { id }, error: null }) }
            },
          }
        },
      }
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: () => Promise.resolve({ error: null }),
          remove: () => Promise.resolve({ error: null }),
        }
      },
    },
  }
  const caller: FaCaller = { db: db as unknown as FaCaller['db'], userId: 'user-1', clubId: 'club-1' }
  return { caller, inserts }
}

const GK_HREF = 'https://learn.englandfootball.com/sessions/resources/2022/Goalkeeping-session-the-basics'

Deno.test('a video session imports one video drill per embed, not empty activities', async () => {
  const page = parseSessionPage(fixture('session-2022-goalkeeping-the-basics.html'))
  const { caller, inserts } = importStub()
  const result = await importParsedSession(caller, page, GK_HREF, {})
  // Three video drills, three video media rows, one template; no diagrams, and
  // the page is not refused as unimportable.
  assertEquals(result.unimportable, undefined)
  assert(result.templateId !== null)
  assertEquals(result.created, { drills: 3, media: 3, template: 1 })

  const media = inserts.filter((i) => i.table === 'media')
  const drills = inserts.filter((i) => i.table === 'drills')
  const templates = inserts.filter((i) => i.table === 'templates')
  assertEquals([media.length, drills.length, templates.length], [3, 3, 1])
  // Every media row is a Vimeo embed on the allowlisted player host, none a
  // stored diagram file.
  for (const m of media) {
    assertEquals(m.row.type, 'video')
    assertEquals(m.row.kind, 'video')
    assert(String(m.row.embed_url).startsWith('https://player.vimeo.com/video/'))
  }
  assert(!media.some((m) => m.row.kind === 'diagram'))
  // The drills carry the page title plus each section heading, in page order.
  assertEquals(
    drills.map((d) => d.row.title),
    [
      'Goalkeeping session: the basics · Warm up',
      'Goalkeeping session: the basics · Shot-stopping 1',
      'Goalkeeping session: the basics · Shot-stopping 2',
    ],
  )
  // The template ties the three drills together.
  assertEquals((templates[0].row.activities as unknown[]).length, 3)
})

Deno.test('a video page with a stray gallery in the related rail still imports the videos', async () => {
  // The exact live failure shape: scoping the activity scan keeps the rail's
  // gallery class from manufacturing a phantom activity that would block the
  // video import.
  const withStrayRail = fixture('session-2022-goalkeeping-the-basics.html').replace(
    '<h2>Related sessions</h2>',
    `<h2>Related sessions</h2>
     <div class="image-gallery">
       <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/rail-a.jpg" alt="rail thumb">
       <img class="image-gallery__img" src="https://cdn.englandfootball.com/EFLearning/rail-b.jpg" alt="rail thumb">
     </div>`,
  )
  const page = parseSessionPage(withStrayRail)
  assertEquals(page.activities.length, 0)
  assertEquals(page.videoEmbeds.length, 3)
  const { caller, inserts } = importStub()
  const result = await importParsedSession(caller, page, GK_HREF, {})
  assertEquals(result.created, { drills: 3, media: 3, template: 1 })
  // No diagram media was stored from the rail.
  assert(!inserts.some((i) => i.table === 'media' && i.row.kind === 'diagram'))
})

Deno.test('a page with both diagrams and videos imports both, diagrams then videos', async () => {
  // Off-host diagram images so storeFaAsset short-circuits without a network
  // fetch (the drill is still created with no media, enough to count drills).
  const html = `
    <html><head><meta property="og:title" content="Mixed session: shapes and clips" /></head>
    <body><main>
      <section class="container image-gallery">
        <img class="image-gallery__img" src="https://example.com/d1.svg" alt="Shape one: build up">
        <div class="image-gallery__caption">Shape one: build up</div>
        <img class="image-gallery__img" src="https://example.com/d2.svg" alt="Shape two: press">
        <div class="image-gallery__caption">Shape two: press</div>
      </section>
      <section class="efl-large-video-player">
        <h2>Clip one</h2>
        <div class="efl-large-video-player__video-wrap" data-video-type="vimeo" data-video-id="111"></div>
      </section>
    </main></body></html>`
  const page = parseSessionPage(html)
  assertEquals(page.activities.length, 2)
  assertEquals(page.videoEmbeds.length, 1)

  const { caller, inserts } = importStub()
  const result = await importParsedSession(caller, page, 'https://learn.englandfootball.com/sessions/mixed', {})
  // Two diagram drills then one video drill, one video media row (the diagrams
  // were off-host so none stored), one template.
  assertEquals(result.created, { drills: 3, media: 1, template: 1 })
  assertEquals(
    inserts.filter((i) => i.table === 'drills').map((d) => d.row.title),
    [
      'Mixed session: shapes and clips · Shape one',
      'Mixed session: shapes and clips · Shape two',
      'Mixed session: shapes and clips · Clip one',
    ],
  )
  const media = inserts.filter((i) => i.table === 'media')
  assertEquals(media.length, 1)
  assertEquals(media[0].row.kind, 'video')
})

Deno.test('a page with no diagrams, setup, points or video is unimportable and writes nothing', async () => {
  const page = parseSessionPage(
    '<html><head><meta property="og:title" content="Empty session" /></head><body><main><p>Nothing.</p></main></body></html>',
  )
  const { caller, inserts } = importStub()
  const result = await importParsedSession(caller, page, 'https://learn.englandfootball.com/sessions/empty', {})
  assertEquals(result.unimportable, true)
  assertEquals(result.created, { drills: 0, media: 0, template: 0 })
  assertEquals(inserts.length, 0)
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

// ---- The real overview pages parse to their own contiguous weeks ----------
// Live regression: the whole-document scan used to read the "Related
// sessions" rail and return weeks 3 and 9 pointing at unrelated sessions
// ("Receiving and finishing session: festival week", "Pressing and covering
// session: games week"). The scoped scan must yield each programme's six
// real weeks, 1..6 with no gaps, on its own theme.

Deno.test('the 2025 marking and intercepting overview yields its six real weeks', () => {
  const url = new URL(
    'https://learn.englandfootball.com/sessions/resources/2025/Session-programme-marking-and-intercepting-to-defend',
  )
  const overview = parseOverviewPage(fixture('overview-2025-marking-and-intercepting-to-defend.html'), url)
  assertEquals(overview.title, 'Session programme: marking and intercepting to defend')
  assert(overview.intentions.length > 0, 'programme intentions were read')
  assertEquals(
    overview.weekLinks.map((l) => l.week),
    [1, 2, 3, 4, 5, 6],
  )
  assertEquals(
    overview.weekLinks.map((l) => l.url),
    [
      'https://learn.englandfootball.com/sessions/resources/2025/Marking-session-marking-rivals',
      'https://learn.englandfootball.com/sessions/resources/2025/Marking-and-intercepting-session-defend-as-friends',
      'https://learn.englandfootball.com/sessions/resources/2025/Marking-and-intercepting-session-interception-perfection',
      'https://learn.englandfootball.com/sessions/resources/2025/Intercepting-session-table-football',
      'https://learn.englandfootball.com/sessions/resources/2025/Marking-and-intercepting-session-intercept-as-a-team',
      'https://learn.englandfootball.com/sessions/resources/2025/Marking-and-intercepting-session-festival-week',
    ],
  )
  // Nothing from the related rail: those point at other programmes' themes.
  for (const l of overview.weekLinks) {
    assert(!/Receiving-and-finishing|Pressing-and-covering|Passing-and-receiving/i.test(l.url), `unrelated: ${l.url}`)
  }
  assert(weeksAreReliable(overview.weekLinks))
  assertEquals(overview.truncated, false)
})

Deno.test('the 2024 press tackle and cover overview yields its six real weeks', () => {
  const url = new URL(
    'https://learn.englandfootball.com/sessions/resources/2024/Session-programme-press-tackle-and-cover',
  )
  const overview = parseOverviewPage(fixture('overview-2024-press-tackle-and-cover.html'), url)
  assertEquals(overview.title, 'Session programme: press, tackle, and cover')
  assert(overview.intentions.length > 0, 'programme intentions were read')
  assertEquals(
    overview.weekLinks.map((l) => l.week),
    [1, 2, 3, 4, 5, 6],
  )
  // Every week stays on the programme's pressing and tackling theme.
  for (const l of overview.weekLinks) {
    assert(/\/sessions\/resources\/2025\/Pressing/.test(l.url), `unrelated: ${l.url}`)
  }
  assert(weeksAreReliable(overview.weekLinks))
})

Deno.test('contentRegion drops the related rail and keeps the week blocks', () => {
  const region = contentRegion(fixture('overview-2025-marking-and-intercepting-to-defend.html'))
  assert(region.includes('first week of the programme here'))
  assert(region.includes('sixth week of the programme here'))
  assert(!region.includes('Related sessions'))
  assert(!region.includes('efl-carousel-card'))
})

// ---- The safety valve: misread weeks never become a partial programme -----

Deno.test('weeksAreReliable refuses sparse, offset or too few weeks', () => {
  const link = (week: number | null) => ({ url: `https://learn.englandfootball.com/sessions/w${week}`, week, text: '' })
  // The live failure shape: two links numbered 3 and 9.
  assertEquals(weeksAreReliable([link(3), link(9)]), false)
  // Contiguous but fewer than three.
  assertEquals(weeksAreReliable([link(1), link(2)]), false)
  // Offset from one.
  assertEquals(weeksAreReliable([link(2), link(3), link(4)]), false)
  // A gap.
  assertEquals(weeksAreReliable([link(1), link(2), link(4)]), false)
  // The real shape passes.
  assertEquals(weeksAreReliable([link(1), link(2), link(3)]), true)
  // Unnumbered links count by position.
  assertEquals(weeksAreReliable([link(null), link(null), link(null)]), true)
  assertEquals(weeksAreReliable([link(null), link(null)]), false)
})

Deno.test('weekFromText reads both word orders and ignores hyphenated lengths', () => {
  assertEquals(weekFromText('Tactics board: week one'), 1)
  assertEquals(weekFromText('On the pitch: week six'), 6)
  assertEquals(weekFromText('first week of the programme here'), 1)
  assertEquals(weekFromText('sixth week of the programme here'), 6)
  assertEquals(weekFromText('2nd week'), 2)
  assertEquals(weekFromText('Week 4: table football'), 4)
  // A six-week programme names a length, not a week.
  assertEquals(weekFromText('six-week programme here'), null)
  assertEquals(weekFromText('festival week'), null)
  assertEquals(weekFromText('every week counts'), null)
  assertEquals(weekFromText('no weeks here at all'), null)
})

// ---- fa-import's overview refusal counts session links, never follows -----

Deno.test('countSessionLinks counts distinct same-host session pages, not itself', () => {
  // The overview fixture links week one, week two (twice, deduped) and a
  // related session on the page host; the off-host link and the self link
  // do not count.
  assertEquals(countSessionLinks(OVERVIEW_HTML, OVERVIEW_URL), 3)
  // A real session page links no other session pages.
  assertEquals(countSessionLinks(SESSION_HTML, new URL('https://learn.englandfootball.com/sessions/a-session')), 0)
})

// ---- Idempotence rests on the normalised source URL -----------------------

Deno.test('normalisedHref drops query, fragment and trailing slashes', () => {
  assertEquals(
    normalisedHref(new URL('https://learn.englandfootball.com/sessions/a-page/?utm=x#top')),
    'https://learn.englandfootball.com/sessions/a-page',
  )
  assertEquals(normalisedHref(new URL('https://learn.englandfootball.com/')), 'https://learn.englandfootball.com')
})

// ---- The single-session import refuses an already imported page -----------
// alreadyImportedRefusal makes one read of templates through the caller's
// client; the stub below records that read and answers it, keeping these
// tests hermetic like the rest of the file. fa-import passes the same
// pageUrl.href to the check and to importParsedSession, so the form the
// check matches is by construction the form the import writes as
// source_url; the tests pin that the check uses the string it is given
// byte for byte and adds no normalisation of its own.

interface RecordedRead {
  table: string
  select: string
  filters: [string, unknown][]
  order: { column: string; ascending: boolean } | null
  limit: number | null
}

function stubCaller(row: { id: string; name: string } | null) {
  const reads: RecordedRead[] = []
  const db = {
    from(table: string) {
      const read: RecordedRead = { table, select: '', filters: [], order: null, limit: null }
      reads.push(read)
      const builder = {
        select(columns: string) {
          read.select = columns
          return builder
        },
        eq(column: string, value: unknown) {
          read.filters.push([column, value])
          return builder
        },
        order(column: string, opts: { ascending: boolean }) {
          read.order = { column, ascending: opts.ascending }
          return builder
        },
        limit(count: number) {
          read.limit = count
          return builder
        },
        maybeSingle() {
          return Promise.resolve({ data: row, error: null })
        },
      }
      return builder
    },
  }
  const caller: FaCaller = { db: db as unknown as FaCaller['db'], userId: 'user-1', clubId: 'club-1' }
  return { caller, reads }
}

const IMPORTED_HREF = new URL(
  'https://learn.englandfootball.com/sessions/resources/2022/Goalkeeping-session-the-basics',
).href

Deno.test('an already imported page is refused with the conflict naming the existing template', async () => {
  const { caller, reads } = stubCaller({ id: 'template-1', name: 'Goalkeeping session: the basics' })
  const refusal = await alreadyImportedRefusal(caller, IMPORTED_HREF, { url: IMPORTED_HREF })
  assert(refusal !== null)
  assertEquals(refusal.status, 409)
  const body = await refusal.json()
  assertEquals(body.error, 'already_imported')
  assertEquals(body.message, 'This session has already been imported.')
  assertEquals(body.template_id, 'template-1')
  assertEquals(body.template_name, 'Goalkeeping session: the basics')
  // One read of templates, scoped to the caller's club, matched on the page
  // address.
  assertEquals(reads.length, 1)
  assertEquals(reads[0].table, 'templates')
  assertEquals(reads[0].filters, [
    ['club_id', 'club-1'],
    ['source_url', IMPORTED_HREF],
  ])
})

Deno.test('the duplicate check matches the source_url form the import writes, byte for byte', async () => {
  // A trailing slash or query survives URL parsing into pageUrl.href and is
  // stored that way; the check must match that stored form rather than a
  // re-normalised one, or check and write would drift apart.
  const href = new URL('https://learn.englandfootball.com/sessions/a-page/?week=2').href
  const { caller, reads } = stubCaller(null)
  assertEquals(await alreadyImportedRefusal(caller, href, {}), null)
  assertEquals(reads[0].filters[1], ['source_url', 'https://learn.englandfootball.com/sessions/a-page/?week=2'])
})

Deno.test('a page not imported before proceeds', async () => {
  const { caller } = stubCaller(null)
  assertEquals(await alreadyImportedRefusal(caller, IMPORTED_HREF, {}), null)
})

Deno.test('reimport true skips the refusal without reading at all', async () => {
  const { caller, reads } = stubCaller({ id: 'template-1', name: 'Goalkeeping session: the basics' })
  assertEquals(await alreadyImportedRefusal(caller, IMPORTED_HREF, { reimport: true }), null)
  assertEquals(reads.length, 0)
})

Deno.test('the reimport override must be boolean true, never a truthy accident', async () => {
  const { caller } = stubCaller({ id: 'template-1', name: 'Goalkeeping session: the basics' })
  for (const value of ['true', 'yes', 1, {}, []]) {
    const refusal = await alreadyImportedRefusal(caller, IMPORTED_HREF, { reimport: value })
    assert(refusal !== null, `reimport ${JSON.stringify(value)} must not skip the refusal`)
    assertEquals(refusal.status, 409)
  }
})

Deno.test('a club holding duplicates from before the check is pointed at the earliest import', async () => {
  // Clubs that imported a page twice before the check existed hold several
  // matching templates. The read orders by created_at and caps itself at
  // one row, so it refuses cleanly instead of erroring on the surplus.
  const { caller, reads } = stubCaller({ id: 'template-1', name: 'First import' })
  const refusal = await alreadyImportedRefusal(caller, IMPORTED_HREF, {})
  assert(refusal !== null)
  assertEquals(reads[0].order, { column: 'created_at', ascending: true })
  assertEquals(reads[0].limit, 1)
})

Deno.test('weekNumber reads words and digits', () => {
  assertEquals(weekNumber('one'), 1)
  assertEquals(weekNumber('SIX'), 6)
  assertEquals(weekNumber('4'), 4)
  assertEquals(weekNumber('zero'), null)
  assertEquals(weekNumber('soon'), null)
  assert(weekNumber('12') === 12)
})
