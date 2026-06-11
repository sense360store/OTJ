// Smoke tests for the catalogue listing parser, hermetic like fa_test.ts.
// The fixture is the real server rendered /sessions listing (see
// fixtures/README.md). Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/fa_catalogue_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { listingNextUrl, parseListingCards, parseListingTaxonomy } from './fa_catalogue.ts'

const LISTING_URL = new URL('https://learn.englandfootball.com/sessions')

function fixture(name: string): string {
  return Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url))
}

const LISTING_HTML = fixture('listing-sessions-index.html')

Deno.test('parseListingTaxonomy reads the FA filter groups with their labels', () => {
  const taxonomy = parseListingTaxonomy(LISTING_HTML)
  assertEquals(Object.values(taxonomy['theme'] ?? {}).sort(), ['Attacking', 'Coaching', 'Defending', 'Futsal', 'Goalkeeping'])
  assert(Object.values(taxonomy['player-age'] ?? {}).includes('5-11'))
  assert(Object.values(taxonomy['player-age'] ?? {}).includes('12-16'))
  assert(Object.values(taxonomy['player-skill'] ?? {}).includes('Intercepting'))
  assert(Object.values(taxonomy['football-format'] ?? {}).includes('5-8 Per Side'))
  assert(Object.values(taxonomy['programme'] ?? {}).includes('Session programme'))
})

Deno.test('parseListingCards reads every resource card with facts and links only', () => {
  const taxonomy = parseListingTaxonomy(LISTING_HTML)
  const cards = parseListingCards(LISTING_HTML, LISTING_URL, taxonomy)
  // The live listing carries roughly 190 resources; pin a sane floor, not
  // the exact count, so a couple of additions or removals do not break it.
  assert(cards.length > 150, `${cards.length} cards`)
  // Every card is a resource page on the allowlisted host, deduplicated.
  const urls = new Set(cards.map((c) => c.url))
  assertEquals(urls.size, cards.length)
  for (const c of cards) {
    assert(c.url.startsWith('https://learn.englandfootball.com/sessions/resources/'), c.url)
    assert(c.title.length > 0)
    // Thumbnails are linked from the FA CDN or absent, never anything else.
    if (c.thumbnailUrl) assert(c.thumbnailUrl.startsWith('https://cdn.englandfootball.com/'), c.thumbnailUrl)
  }
})

Deno.test('a known session card resolves its taxonomy labels', () => {
  const taxonomy = parseListingTaxonomy(LISTING_HTML)
  const cards = parseListingCards(LISTING_HTML, LISTING_URL, taxonomy)
  const festival = cards.find((c) => c.url.endsWith('/2026/Receiving-and-finishing-session-festival-week'))
  assert(festival, 'festival week card present')
  assertEquals(festival.title, 'Receiving and finishing session: festival week')
  assertEquals(festival.kind, 'session')
  assertEquals(festival.theme, 'Attacking')
  assertEquals(festival.ageBand, '5-11')
  assert(festival.skills.includes('Receiving'))
  assert(festival.skills.includes('Finishing'))
  assert(festival.summary.length > 0)
  assert(festival.thumbnailUrl.startsWith('https://cdn.englandfootball.com/'))
})

Deno.test('a known programme card detects as a programme', () => {
  const taxonomy = parseListingTaxonomy(LISTING_HTML)
  const cards = parseListingCards(LISTING_HTML, LISTING_URL, taxonomy)
  const programme = cards.find((c) => c.url.endsWith('/2025/Session-programme-marking-and-intercepting-to-defend'))
  assert(programme, 'marking and intercepting programme card present')
  assertEquals(programme.kind, 'programme')
  assertEquals(programme.theme, 'Defending')
  // The listing's programmes are the dozen "Session programme" entries.
  const programmes = cards.filter((c) => c.kind === 'programme')
  assert(programmes.length >= 10 && programmes.length <= 20, `${programmes.length} programmes`)
})

Deno.test('listingNextUrl is defensive only: the live listing is one page', () => {
  assertEquals(listingNextUrl(LISTING_HTML, LISTING_URL), null)
  // A paginating listing is followed on the same host and path only.
  const paged = '<a rel="next" href="/sessions?page=2">Next</a>'
  assertEquals(listingNextUrl(paged, LISTING_URL)?.href, 'https://learn.englandfootball.com/sessions?page=2')
  const offHost = '<a rel="next" href="https://evil.com/sessions?page=2">Next</a>'
  assertEquals(listingNextUrl(offHost, LISTING_URL), null)
  const offPath = '<a rel="next" href="/account?page=2">Next</a>'
  assertEquals(listingNextUrl(offPath, LISTING_URL), null)
})
