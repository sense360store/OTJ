// =====================================================================
// Shared England Football Learning import core
//
// REVIEW REQUIRED. This module is the parsing and import core behind
// the fa-import and fa-import-programme Edge Functions, extracted from
// fa-import so the session-import behaviour stays single-sourced. See
// CLAUDE.md, Third-party content, for the standing policy this code
// implements.
//
// Security model (shared by both functions):
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that user. The
//     service role key is not used here at all.
//   * Hard allowlist: page URLs must be on learn.englandfootball.com
//     and asset downloads must come from cdn.englandfootball.com over
//     https. Anything else is rejected or skipped.
//   * fa-import fetches one page per call, nothing else. The programme
//     import performs the single sanctioned one-level follow: the
//     overview's own week links, same host only, capped at
//     MAX_PROGRAMME_WEEKS, nothing deeper.
//
// Parsing is deliberately defensive: a missing piece becomes an empty
// field and a warning in the response, never a failure.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''

export const PAGE_HOST = 'learn.englandfootball.com'
export const ASSET_HOST = 'cdn.englandfootball.com'
export const SOURCE_LABEL = 'England Football Learning'

// Defensive caps. An FA session page carries a handful of diagrams (a two
// week page carries two galleries) and a programme overview links a handful
// of weeks; these only exist to bound a malformed or unexpected page.
export const MAX_ACTIVITIES = 16
export const MAX_PROGRAMME_WEEKS = 10
// The FA programme format is six weeks. Fewer than this many extracted week
// links means the overview's weekly sessions were not read reliably.
export const MIN_PROGRAMME_WEEKS = 3
export const MAX_PAGE_BYTES = 3 * 1024 * 1024
export const MAX_ASSET_BYTES = 15 * 1024 * 1024
export const FETCH_TIMEOUT_MS = 20_000

export const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- Caller resolution ---------------------------------------------------
// Resolve the caller from the Authorization JWT. The client carries that JWT
// on every request, so RLS applies to every read and write the caller's
// client makes.

export interface FaCaller {
  db: SupabaseClient
  userId: string
  clubId: string
}

export async function resolveCaller(req: Request): Promise<{ caller: FaCaller } | { response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return { response: reply(401, { error: 'Not signed in.' }) }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser(jwt)
  if (userError || !userData?.user) return { response: reply(401, { error: 'Not signed in.' }) }
  const userId = userData.user.id

  const { data: caller } = await db.from('profiles').select('id, club_id').eq('id', userId).maybeSingle()
  if (!caller?.club_id) return { response: reply(403, { error: 'Your account is not linked to a club yet.' }) }
  return { caller: { db, userId, clubId: caller.club_id as string } }
}

// ---- HTML helpers ------------------------------------------------------
// The pages are server rendered HTML with stable class names. A full DOM
// parser is overkill; these helpers decode entities and strip tags so the
// regex extraction below stays readable.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

export function textOf(htmlFragment: string): string {
  return decodeEntities(htmlFragment.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// Attribute values on the page are usually quoted, but some (the setup strip
// icons) are not, so both forms are read.
export function attrOf(tag: string, name: string): string {
  const quoted = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
  if (quoted) return decodeEntities(quoted[1]).trim()
  const bare = tag.match(new RegExp(name + '\\s*=\\s*([^\\s">]+)', 'i'))
  return bare ? decodeEntities(bare[1]).trim() : ''
}

// List items of the first <ul> that follows a heading text.
export function listAfter(html: string, heading: string): string[] {
  const at = html.indexOf(heading)
  if (at === -1) return []
  const seg = html.slice(at)
  const ulStart = seg.search(/<ul[\s>]/i)
  if (ulStart === -1) return []
  const ulEnd = seg.indexOf('</ul>', ulStart)
  if (ulEnd === -1) return []
  const ul = seg.slice(ulStart, ulEnd)
  return [...ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => textOf(m[1])).filter(Boolean)
}

const WEEK_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

// The overviews name weeks both ways round: a heading says "week one" while
// the week link itself says "first week of the programme here".
const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
}

export function weekNumber(word: string): number | null {
  const n = WEEK_WORDS[word.toLowerCase()] ?? parseInt(word, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// The week named in a run of text, either way round: "week six" and
// "Tactics board: week one", or "first week of the programme" and "2nd
// week". Hyphenated counts ("six-week programme") name a length, not a
// week, and stay null, as does any text without a number.
export function weekFromText(text: string): number | null {
  const after = text.match(/\bweek\s+([a-z0-9]+)/i)
  if (after) {
    const n = weekNumber(after[1])
    if (n != null) return n
  }
  const before = text.match(/\b([a-z]+|\d+)(?:st|nd|rd|th)?\s+week\b/i)
  if (before) {
    const word = before[1].toLowerCase()
    const n = ORDINAL_WORDS[word] ?? weekNumber(word)
    if (n != null) return n
  }
  return null
}

// The og:<prop> meta content and the description meta, shared by the session
// and overview parsers.
function ogContent(html: string, prop: string): string {
  const m = html.match(new RegExp('<meta[^>]+property="og:' + prop + '"[^>]+content="([^"]*)"', 'i'))
  return m ? decodeEntities(m[1]).trim() : ''
}

function metaDescription(html: string): string {
  const desc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)
  return (desc ? decodeEntities(desc[1]).trim() : '') || ogContent(html, 'description')
}

// ---- Session page parsing ------------------------------------------------

export interface ParsedActivity {
  imageUrl: string
  caption: string
  // The leading phrase before a colon, e.g. "Three-in-a-row", when present.
  phrase: string
}

export interface ParsedPage {
  title: string
  summary: string
  intentions: string[]
  space: string
  players: string
  equipment: string[]
  activities: ParsedActivity[]
  easier: string[]
  harder: string[]
  points: string[]
  pdfUrl: string
  programme: string
  week: number | null
}

export function parseSessionPage(html: string): ParsedPage {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = ogContent(html, 'title') || (h1 ? textOf(h1[1]) : '')
  const summary = metaDescription(html)

  const intentions = listAfter(html, 'Session intentions')

  // Setup strip: one grid item per fact. The player range names players, the
  // pitch icon marks the space, everything else is equipment.
  let space = ''
  let players = ''
  const equipment: string[] = []
  for (const m of html.matchAll(/session-setup__grid__item"?>([\s\S]*?)<\/div>/gi)) {
    const item = m[1]
    const p = item.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const text = p ? textOf(p[1]) : ''
    if (!text) continue
    const icon = item.match(/<img[^>]*>/i)?.[0] ?? ''
    const iconSrc = attrOf(icon, 'src').toLowerCase()
    if (!players && /\bplayers?\b/i.test(text)) players = text
    else if (!space && (iconSrc.includes('pitch') || /\b(pitch|area|grid|court|yards?|metres?)\b/i.test(text)))
      space = text
    else equipment.push(text)
  }

  // Activity carousel: each slide is an image on the FA CDN plus a caption.
  // The caption is also present as the image's alt text; prefer the caption
  // div and fall back to alt.
  const activities: ParsedActivity[] = []
  const galleryAt = html.indexOf('image-gallery')
  if (galleryAt !== -1) {
    const gallery = html.slice(galleryAt)
    const imgs = [...gallery.matchAll(/<img[^>]*image-gallery__img[^>]*>/gi)].map((m) => m[0])
    const captions = [...gallery.matchAll(/image-gallery__caption[^"]*"\s*>([\s\S]*?)<\/div>/gi)].map((m) =>
      textOf(m[1]),
    )
    imgs.forEach((tag, i) => {
      const src = attrOf(tag, 'src')
      if (!src) return
      const caption = captions[i] || attrOf(tag, 'alt')
      const colon = caption.indexOf(':')
      const phrase = colon > 0 && colon <= 48 ? caption.slice(0, colon).trim() : ''
      activities.push({ imageUrl: src, caption, phrase })
    })
  }

  const easier = listAfter(html, 'Make it easier')
  const harder = listAfter(html, 'Make it harder')

  // Coaching points: the paragraphs of the highlighted information section.
  // A missing closing tag yields no points rather than swallowing the rest
  // of the page.
  const points: string[] = []
  const pointsAt = html.indexOf('course-important-information')
  if (pointsAt !== -1) {
    const pointsEnd = html.indexOf('</section>', pointsAt)
    const section = pointsEnd === -1 ? '' : html.slice(pointsAt, pointsEnd)
    for (const m of section.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = textOf(m[1])
      if (text) points.push(text)
    }
  }

  // The session plan PDF, when linked: prefer the anchor whose text says
  // session plan, fall back to any FA Learning PDF on the CDN.
  let pdfUrl = ''
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1])
    const label = textOf(m[2]).toLowerCase()
    if (label.includes('session plan')) {
      pdfUrl = href
      break
    }
    if (!pdfUrl && href.includes('/EFLearning/')) pdfUrl = href
  }

  // Programme and week, only when the page makes them obvious: the intro
  // sentence "This is week six of the ... session programme" or a week in
  // the title itself.
  let programme = ''
  let week: number | null = null
  const pageText = textOf(html.slice(0, galleryAt === -1 ? html.length : galleryAt))
  const prog = pageText.match(/week\s+(\w+)\s+of\s+the\s+(.+?)\s+session\s+programme/i)
  if (prog) {
    week = weekNumber(prog[1])
    const name = prog[2].trim()
    programme = name.charAt(0).toUpperCase() + name.slice(1)
  } else {
    const inTitle = title.match(/week\s+(\w+)/i)
    if (inTitle) week = weekNumber(inTitle[1])
  }

  return { title, summary, intentions, space, players, equipment, activities, easier, harder, points, pdfUrl, programme, week }
}

// ---- Programme overview parsing -------------------------------------------
// The FA publishes a programme as an overview page linking its weekly session
// pages. The parser extracts the programme's own fields, its PDF when linked,
// and the week links. Only same-host links count, capped at
// MAX_PROGRAMME_WEEKS; the caller follows them one level, nothing deeper.

export interface OverviewWeekLink {
  url: string
  // The week number named in the link text, when the page names one.
  week: number | null
  text: string
}

export interface ParsedOverview {
  title: string
  summary: string
  intentions: string[]
  pdfUrl: string
  weekLinks: OverviewWeekLink[]
  // True when more week links were found than the cap allows.
  truncated: boolean
}

// A stable form of an FA page URL for matching and storing: https origin plus
// path, query and fragment dropped, no trailing slash. Re-importing the same
// overview matches the stored source_url through this.
export function normalisedHref(url: URL): string {
  return url.origin + url.pathname.replace(/\/+$/, '')
}

// The page region the link scans read. FA pages wrap their own content in
// <main> and append related-content rails (the "Related sessions" carousel,
// twenty cards of unrelated session links) inside it as full-width carousel
// sections. Reading link candidates from the whole document made the parser
// read week numbers out of that rail's card text; this is the same
// containment approach parseSessionPage uses for the gallery and the
// coaching-points section. Headings, metas and PDFs are unaffected: only
// the link scans are scoped.
export function contentRegion(html: string): string {
  let region = html
  const mainOpen = region.search(/<main\b[^>]*>/i)
  if (mainOpen !== -1) {
    const mainClose = region.indexOf('</main>', mainOpen)
    region = mainClose === -1 ? region.slice(mainOpen) : region.slice(mainOpen, mainClose)
  }
  // Drop every full-width carousel section, wherever it sits.
  for (;;) {
    const marker = region.indexOf('efl-full-width-carousel')
    if (marker === -1) break
    const sectionOpen = region.lastIndexOf('<section', marker)
    const from = sectionOpen === -1 ? marker : sectionOpen
    const sectionClose = region.indexOf('</section>', marker)
    if (sectionClose === -1) {
      region = region.slice(0, from)
      break
    }
    region = region.slice(0, from) + region.slice(sectionClose + '</section>'.length)
  }
  // Belt and braces for a page without the carousel class: cut at a
  // recommended-content heading.
  const related = region.search(/<h\d[^>]*>\s*(related sessions|you might also like|recommended)/i)
  return related === -1 ? region : region.slice(0, related)
}

// Distinct same-host links to session pages other than the page itself,
// within the page's own content region. A programme overview links each of
// its weekly sessions; a real session page links at most a couple. fa-import
// refuses an overview pasted as a session through this. Counted only, never
// followed.
export function countSessionLinks(html: string, self: URL): number {
  const selfPath = self.pathname.replace(/\/+$/, '').toLowerCase()
  const paths = new Set<string>()
  for (const m of contentRegion(html).matchAll(/<a[^>]+href\s*=\s*"([^"]+)"/gi)) {
    let target: URL
    try {
      target = new URL(decodeEntities(m[1]), self)
    } catch {
      continue
    }
    if (target.hostname.toLowerCase() !== PAGE_HOST) continue
    const path = target.pathname.replace(/\/+$/, '').toLowerCase()
    if (!/\/sessions\/.+/.test(path) || path === selfPath) continue
    paths.add(path)
  }
  return paths.size
}

export function parseOverviewPage(html: string, pageUrl: URL): ParsedOverview {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = ogContent(html, 'title') || (h1 ? textOf(h1[1]) : '')
  const summary = metaDescription(html)
  // Overviews head their list "Programme intentions"; older or synthetic
  // pages may carry the session wording.
  const intentions = (() => {
    const programme = listAfter(html, 'Programme intentions')
    return programme.length > 0 ? programme : listAfter(html, 'Session intentions')
  })()

  // The programme PDF, when linked: prefer an anchor naming the programme,
  // then a session plan, then any FA Learning PDF on the CDN.
  let programmePdf = ''
  let planPdf = ''
  let anyPdf = ''
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1])
    const label = textOf(m[2]).toLowerCase()
    if (!programmePdf && label.includes('programme')) programmePdf = href
    if (!planPdf && label.includes('session plan')) planPdf = href
    if (!anyPdf && href.includes('/EFLearning/')) anyPdf = href
  }
  const pdfUrl = programmePdf || planPdf || anyPdf

  // Candidate week links: within the page's own content region (never the
  // related-content rails), same host over https, not the overview itself,
  // one entry per distinct page, and either a session path or a week named
  // in the link text (cards wrap their heading in the anchor, so textOf
  // sees it).
  const self = normalisedHref(pageUrl)
  const seen = new Set<string>()
  const candidates: OverviewWeekLink[] = []
  for (const m of contentRegion(html).matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(m[1]), pageUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== PAGE_HOST) continue
    const openTag = m[0].match(/^<a\b[^>]*>/i)?.[0] ?? ''
    const text = textOf(m[2]) || attrOf(openTag, 'aria-label') || attrOf(openTag, 'title')
    const week = weekFromText(text)
    if (week == null && !/session/i.test(url.pathname)) continue
    const href = normalisedHref(url)
    if (href === self || seen.has(href)) continue
    seen.add(href)
    candidates.push({ url: href, week, text })
  }

  // Links that name a week order and label the weeks; when any exist, only
  // they count (the rest are navigation and related content). Without any,
  // document order stands and the caller numbers the weeks by position.
  const numbered = candidates.filter((l) => l.week != null)
  let weekLinks: OverviewWeekLink[]
  if (numbered.length > 0) {
    const byWeek = new Map<number, OverviewWeekLink>()
    for (const l of numbered) if (!byWeek.has(l.week!)) byWeek.set(l.week!, l)
    weekLinks = [...byWeek.values()].sort((a, b) => a.week! - b.week!)
  } else {
    weekLinks = candidates
  }

  const truncated = weekLinks.length > MAX_PROGRAMME_WEEKS
  if (truncated) weekLinks = weekLinks.slice(0, MAX_PROGRAMME_WEEKS)

  return { title, summary, intentions, pdfUrl, weekLinks, truncated }
}

// The safety valve behind the programme import. Extracted week links count
// as reliable only when there are at least MIN_PROGRAMME_WEEKS of them and
// their week numbers run 1..n with no gaps (a link without a named week
// takes its position). A parse that misread stray links instead of the
// programme's own weeks fails this, and the import refuses rather than
// creating a misleading partial programme.
export function weeksAreReliable(links: OverviewWeekLink[]): boolean {
  if (links.length < MIN_PROGRAMME_WEEKS) return false
  return links.every((l, i) => (l.week ?? i + 1) === i + 1)
}

// ---- Allowlisted fetching ----------------------------------------------

export function allowedUrl(raw: string, host: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host) return null
    return url
  } catch {
    return null
  }
}

// Fetch one allowlisted FA page, capped at MAX_PAGE_BYTES; null when the page
// cannot be fetched from the allowlisted host (redirects included).
export async function fetchFaPage(pageUrl: URL): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'OTJ Training Hub importer', Accept: 'text/html' },
    })
    if (!res.ok || new URL(res.url).hostname.toLowerCase() !== PAGE_HOST) return null
    let html = await res.text()
    if (html.length > MAX_PAGE_BYTES) html = html.slice(0, MAX_PAGE_BYTES)
    return html
  } catch {
    return null
  }
}

async function fetchAsset(url: URL): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'OTJ Training Hub importer' },
  })
  if (!res.ok) return null
  // Redirects must stay on the asset host; anything else is not downloaded.
  if (new URL(res.url).hostname.toLowerCase() !== ASSET_HOST) return null
  const declared = parseInt(res.headers.get('content-length') ?? '0', 10)
  if (declared > MAX_ASSET_BYTES) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) return null
  return { bytes, contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim() }
}

function extensionFor(url: URL, contentType: string): string {
  const m = url.pathname.toLowerCase().match(/\.(svg|png|jpe?g|webp|pdf)$/)
  if (m) return m[1]
  if (contentType.includes('svg')) return 'svg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('pdf')) return 'pdf'
  return 'bin'
}

function slug(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
  return cleaned.slice(0, 60) || 'file'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

// ---- Import core ---------------------------------------------------------

export interface SourceFields {
  source_url: string
  source_label: string
}

// Store one asset unmodified and register it, returning the media id.
// Failures become warnings, never aborts: the caller's drill or programme is
// still created.
export async function storeFaAsset(
  caller: FaCaller,
  warnings: string[],
  sourceFields: SourceFields,
  raw: string,
  name: string,
  kind: 'diagram' | 'pdf',
): Promise<string | null> {
  const url = allowedUrl(raw, ASSET_HOST)
  if (!url) {
    warnings.push(`Skipped "${name}": its file is not hosted on ${ASSET_HOST}.`)
    return null
  }
  let asset: { bytes: Uint8Array; contentType: string } | null
  try {
    asset = await fetchAsset(url)
  } catch {
    asset = null
  }
  if (!asset) {
    warnings.push(`Could not download the file for "${name}".`)
    return null
  }
  const ext = extensionFor(url, asset.contentType)
  const contentType = asset.contentType || (ext === 'svg' ? 'image/svg+xml' : ext === 'pdf' ? 'application/pdf' : undefined)
  const path = `${caller.clubId}/${crypto.randomUUID()}-${slug(name)}.${ext}`
  const { error: uploadError } = await caller.db.storage.from('media').upload(path, asset.bytes, { contentType })
  if (uploadError) {
    warnings.push(`Could not store the file for "${name}".`)
    return null
  }
  const { data: row, error: insertError } = await caller.db
    .from('media')
    .insert({
      club_id: caller.clubId,
      created_by: caller.userId,
      name,
      type: kind === 'pdf' ? 'pdf' : 'image',
      kind,
      storage_path: path,
      size: formatBytes(asset.bytes.byteLength),
      ...sourceFields,
    })
    .select('id')
    .single()
  if (insertError || !row) {
    await caller.db.storage.from('media').remove([path])
    warnings.push(`Could not register the file for "${name}".`)
    return null
  }
  return row.id as string
}

// The parse warnings for a session page, in the order fa-import has always
// reported them. Trims the activities to the cap as a side effect.
export function sessionPageWarnings(page: ParsedPage): string[] {
  const warnings: string[] = []
  if (page.intentions.length === 0) warnings.push('No session intentions were found on the page.')
  if (!page.space && !page.players && page.equipment.length === 0)
    warnings.push('No setup strip was found on the page.')
  if (page.activities.length === 0) warnings.push('No activity diagrams were found on the page.')
  if (page.activities.length > MAX_ACTIVITIES) {
    warnings.push(`Only the first ${MAX_ACTIVITIES} activities were imported.`)
    page.activities = page.activities.slice(0, MAX_ACTIVITIES)
  }
  if (page.easier.length === 0 && page.harder.length === 0)
    warnings.push('No make it easier or make it harder adaptations were found.')
  if (page.points.length === 0) warnings.push('No coaching points were found.')
  return warnings
}

export interface SessionImportResult {
  templateId: string | null
  created: { drills: number; media: number; template: number }
  warnings: string[]
}

// Import one parsed session page as the caller: one media row per activity
// diagram (stored unmodified), one draft drill per activity in page order,
// the session plan PDF when linked, and one template tying the drills
// together. templateFields carries the per-caller template columns:
// fa-import passes the legacy programme and week labels it has always
// written; the programme import passes programme_id and programme_week and
// leaves the legacy columns alone.
export async function importParsedSession(
  caller: FaCaller,
  page: ParsedPage,
  pageHref: string,
  templateFields: Record<string, unknown>,
): Promise<SessionImportResult> {
  const warnings = sessionPageWarnings(page)
  const sourceFields: SourceFields = { source_url: pageHref, source_label: SOURCE_LABEL }

  // One draft drill per activity, in page order. The diagram is stored
  // unmodified first; the drill then references it. Theme, format, corner
  // and level are left for the coach. A page that repeats an image (a two
  // week page revisiting a practice) stores the file once and reuses it.
  let mediaCount = 0
  const drillIds: string[] = []
  const storedByUrl = new Map<string, string | null>()
  for (let i = 0; i < page.activities.length; i++) {
    const act = page.activities[i]
    const label = act.phrase || `Activity ${i + 1}`
    let mediaId: string | null
    if (storedByUrl.has(act.imageUrl)) {
      mediaId = storedByUrl.get(act.imageUrl) ?? null
    } else {
      mediaId = await storeFaAsset(caller, warnings, sourceFields, act.imageUrl, `${label} diagram`, 'diagram')
      storedByUrl.set(act.imageUrl, mediaId)
      if (mediaId) mediaCount++
    }
    const { data: drill, error: drillError } = await caller.db
      .from('drills')
      .insert({
        club_id: caller.clubId,
        created_by: caller.userId,
        title: `${page.title} · ${label}`,
        summary: act.caption || null,
        duration: 10,
        players: page.players || null,
        area: page.space || null,
        equipment: page.equipment,
        points: page.points,
        easier: page.easier,
        harder: page.harder,
        media_id: mediaId,
        ...sourceFields,
      })
      .select('id')
      .single()
    if (drillError || !drill) {
      warnings.push(`Could not create the drill for "${label}".`)
      continue
    }
    drillIds.push(drill.id as string)
  }

  if (page.pdfUrl) {
    const pdfStored = await storeFaAsset(caller, warnings, sourceFields, page.pdfUrl, `${page.title} session plan`, 'pdf')
    if (pdfStored) mediaCount++
  }

  // The template ties the drills together in page order, ten minutes each
  // by default, with the page's intentions.
  const activities = drillIds.map((id) => ({ phase: 'Skill', drill_id: id, duration: 10 }))
  const { data: template, error: templateError } = await caller.db
    .from('templates')
    .insert({
      club_id: caller.clubId,
      name: page.title,
      focus: page.programme || page.title.split(':')[0].trim(),
      author: SOURCE_LABEL,
      activities,
      intentions: page.intentions,
      ...templateFields,
      ...sourceFields,
    })
    .select('id')
    .single()
  if (templateError || !template) {
    return { templateId: null, created: { drills: drillIds.length, media: mediaCount, template: 0 }, warnings }
  }
  return {
    templateId: template.id as string,
    created: { drills: drillIds.length, media: mediaCount, template: 1 },
    warnings,
  }
}
