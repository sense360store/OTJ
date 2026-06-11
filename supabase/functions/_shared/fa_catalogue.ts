// =====================================================================
// Shared England Football catalogue listing parser
//
// REVIEW REQUIRED. The parsing behind the fa-catalogue Edge Function:
// it reads the server rendered /sessions listing into catalogue rows of
// facts and links only. Titles, summaries, the FA's own taxonomy labels
// and the listing thumbnail's URL are extracted; nothing is downloaded
// and no asset is stored. See CLAUDE.md, Third-party content.
//
// The listing carries two structures this module reads:
//   * The filter sidebar: one fieldset per taxonomy group
//     (data-category="theme", "player-age", ...), each option a label
//     followed by a checkbox whose value is the option's GUID.
//   * The result cards: anchors classed efl-card linking a resource
//     under /sessions/resources/, carrying the card's GUIDs in a
//     data-filter attribute, with the title, category, description and
//     thumbnail inside.
// Each card's GUIDs resolve to labels through the taxonomy, which keeps
// the parser honest when the FA renames a label: the card text never
// has to be guessed at.
// =====================================================================
import { ASSET_HOST, attrOf, contentRegion, decodeEntities, normalisedHref, PAGE_HOST, textOf } from './fa.ts'

// Defensive caps: the live listing is one page of roughly 190 resources.
export const MAX_INDEX_PAGES = 5
export const MAX_CATALOGUE_CARDS = 400

export interface CatalogueCard {
  url: string
  title: string
  summary: string
  theme: string
  skills: string[]
  format: string
  ageBand: string
  kind: 'programme' | 'session'
  thumbnailUrl: string
}

// group -> guid -> label, e.g. taxonomy['player-age']['ECDE44CE-...'] = '5-11'
export type ListingTaxonomy = Record<string, Record<string, string>>

function normaliseGuid(raw: string): string {
  return raw.replace(/[{}]/g, '').trim().toUpperCase()
}

export function parseListingTaxonomy(html: string): ListingTaxonomy {
  const taxonomy: ListingTaxonomy = {}
  for (const f of html.matchAll(/<fieldset[^>]+data-category="([^"]+)"[^>]*>([\s\S]*?)<\/fieldset>/gi)) {
    const group = f[1].toLowerCase()
    const options: Record<string, string> = {}
    for (const o of f[2].matchAll(/<label[^>]*>([\s\S]*?)<\/label>\s*<input[^>]+value="([^"]+)"/gi)) {
      const label = textOf(o[1])
      const guid = normaliseGuid(o[2])
      if (label && guid) options[guid] = label
    }
    if (Object.keys(options).length > 0) taxonomy[group] = options
  }
  return taxonomy
}

// The labels a card's GUIDs resolve to within one taxonomy group, in the
// group's own option order so the output is stable across syncs.
function labelsFor(taxonomy: ListingTaxonomy, group: string, guids: Set<string>): string[] {
  const options = taxonomy[group] ?? {}
  return Object.entries(options)
    .filter(([guid]) => guids.has(guid))
    .map(([, label]) => label)
}

export function parseListingCards(html: string, pageUrl: URL, taxonomy: ListingTaxonomy): CatalogueCard[] {
  const cards: CatalogueCard[] = []
  const seen = new Set<string>()
  for (const m of contentRegion(html).matchAll(/<a\b([^>]*\bclass="[^"]*efl-card[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `<a ${m[1]}>`
    const inner = m[2]
    let url: URL
    try {
      url = new URL(decodeEntities(attrOf(attrs, 'href')), pageUrl)
    } catch {
      continue
    }
    // Resource pages only, on the allowlisted host.
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== PAGE_HOST) continue
    if (!/^\/sessions\/resources\//i.test(url.pathname)) continue
    const href = normalisedHref(url)
    if (seen.has(href)) continue

    const titleEl = inner.match(/efl-card__content--title[^>]*>([\s\S]*?)<\/div>/i)
    const title = (titleEl ? textOf(titleEl[1]) : '') || attrOf(attrs, 'aria-label')
    if (!title) continue
    const descEl = inner.match(/efl-card__content--description[^>]*>([\s\S]*?)<\/p>/i)
    const summary = descEl ? textOf(descEl[1]) : ''
    const categoryEl = inner.match(/efl-card__content--category[^>]*>([\s\S]*?)<\/div>/i)
    const category = categoryEl ? textOf(categoryEl[1]) : ''

    // The listing thumbnail is linked, never stored, and only from the FA's
    // own CDN.
    let thumbnailUrl = ''
    const img = inner.match(/<img[^>]*>/i)
    if (img) {
      try {
        const src = new URL(decodeEntities(attrOf(img[0], 'src')), pageUrl)
        if (src.protocol === 'https:' && src.hostname.toLowerCase() === ASSET_HOST) thumbnailUrl = src.href
      } catch {
        // no thumbnail
      }
    }

    const guids = new Set((attrOf(attrs, 'data-filter') || '').split('|').map(normaliseGuid).filter(Boolean))
    const themes = labelsFor(taxonomy, 'theme', guids)
    const skills = [...labelsFor(taxonomy, 'player-skill', guids), ...labelsFor(taxonomy, 'coach-skill', guids)]
    const formats = labelsFor(taxonomy, 'football-format', guids)
    const ages = labelsFor(taxonomy, 'player-age', guids)
    const programmeGroup = labelsFor(taxonomy, 'programme', guids)
    const kind =
      programmeGroup.some((l) => /programme/i.test(l)) || /^session\s+programme/i.test(title) ? 'programme' : 'session'

    cards.push({
      url: href,
      title,
      summary,
      // The taxonomy theme labels, falling back to the card's own category
      // text ("Session design", "Intercepting") when no theme GUID matched.
      theme: themes.join(', ') || category,
      skills,
      format: formats.join(', '),
      ageBand: ages.join(', '),
      kind,
      thumbnailUrl,
    })
    seen.add(href)
  }
  return cards
}

// A listing page's next-page link, when the FA paginates: rel="next" on the
// same host and the same /sessions path only. The live listing is one page,
// so this is purely defensive; the caller caps at MAX_INDEX_PAGES.
export function listingNextUrl(html: string, pageUrl: URL): URL | null {
  for (const m of html.matchAll(/<a\b[^>]*\brel="next"[^>]*>/gi)) {
    try {
      const url = new URL(decodeEntities(attrOf(m[0], 'href')), pageUrl)
      if (url.protocol === 'https:' && url.hostname.toLowerCase() === PAGE_HOST && /^\/sessions\b/i.test(url.pathname)) {
        return url
      }
    } catch {
      continue
    }
  }
  return null
}
