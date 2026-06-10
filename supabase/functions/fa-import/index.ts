// =====================================================================
// fa-import Edge Function
//
// REVIEW REQUIRED. This function fetches a single England Football
// Learning session page on behalf of a signed in coach and imports it:
// one media row per activity diagram (stored unmodified), one draft
// drill per activity, and one template tying them together. See
// CLAUDE.md, Third-party content, for the standing policy this code
// implements.
//
// Security model:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that user. The
//     service role key is not used in this function at all.
//   * Hard allowlist: the page URL must be on learn.englandfootball.com
//     and asset downloads must come from cdn.englandfootball.com over
//     https. Anything else is rejected or skipped.
//   * One page per call. No link following, no crawling, no caps lifted
//     by the caller.
//
// Parsing is deliberately defensive: a missing piece becomes an empty
// field and a warning in the response, never a failure. Deploy with
// `npx supabase functions deploy fa-import` and make sure APP_ORIGIN is
// set (shared with invite-user).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''

const PAGE_HOST = 'learn.englandfootball.com'
const ASSET_HOST = 'cdn.englandfootball.com'
const SOURCE_LABEL = 'England Football Learning'

// Defensive caps. An FA session page carries a handful of diagrams (a two
// week page carries two galleries); these only exist to bound a malformed or
// unexpected page.
const MAX_ACTIVITIES = 16
const MAX_PAGE_BYTES = 3 * 1024 * 1024
const MAX_ASSET_BYTES = 15 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- HTML helpers ------------------------------------------------------
// The page is server rendered HTML with stable class names. A full DOM
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

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

function textOf(htmlFragment: string): string {
  return decodeEntities(htmlFragment.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// Attribute values on the page are usually quoted, but some (the setup strip
// icons) are not, so both forms are read.
function attrOf(tag: string, name: string): string {
  const quoted = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
  if (quoted) return decodeEntities(quoted[1]).trim()
  const bare = tag.match(new RegExp(name + '\\s*=\\s*([^\\s">]+)', 'i'))
  return bare ? decodeEntities(bare[1]).trim() : ''
}

// List items of the first <ul> that follows a heading text.
function listAfter(html: string, heading: string): string[] {
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

function weekNumber(word: string): number | null {
  const n = WEEK_WORDS[word.toLowerCase()] ?? parseInt(word, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

interface ParsedActivity {
  imageUrl: string
  caption: string
  // The leading phrase before a colon, e.g. "Three-in-a-row", when present.
  phrase: string
}

interface ParsedPage {
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

function parsePage(html: string): ParsedPage {
  const og = (prop: string): string => {
    const m = html.match(new RegExp('<meta[^>]+property="og:' + prop + '"[^>]+content="([^"]*)"', 'i'))
    return m ? decodeEntities(m[1]).trim() : ''
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = og('title') || (h1 ? textOf(h1[1]) : '')
  const desc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)
  const summary = (desc ? decodeEntities(desc[1]).trim() : '') || og('description')

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

// ---- Allowlisted fetching ----------------------------------------------

function allowedUrl(raw: string, host: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host) return null
    return url
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  // Resolve the caller from the Authorization JWT. The client carries that
  // JWT on every request, so RLS applies to everything below.
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: 'Not signed in.' })
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser(jwt)
  if (userError || !userData?.user) return reply(401, { error: 'Not signed in.' })
  const userId = userData.user.id

  const { data: caller } = await db.from('profiles').select('id, club_id').eq('id', userId).maybeSingle()
  if (!caller?.club_id) return reply(403, { error: 'Your account is not linked to a club yet.' })
  const clubId = caller.club_id as string

  // Validate the payload: one page URL, which must be on the FA Learning
  // site. One page per call; nothing else is ever fetched from it.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : ''
  const pageUrl = allowedUrl(rawUrl, PAGE_HOST)
  if (!pageUrl) {
    return reply(400, { error: 'Paste a session link from learn.englandfootball.com.' })
  }

  let html: string
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'OTJ Training Hub importer', Accept: 'text/html' },
    })
    if (!res.ok || new URL(res.url).hostname.toLowerCase() !== PAGE_HOST) {
      return reply(422, { error: 'Could not fetch that page from England Football Learning.' })
    }
    html = await res.text()
    if (html.length > MAX_PAGE_BYTES) html = html.slice(0, MAX_PAGE_BYTES)
  } catch {
    return reply(422, { error: 'Could not fetch that page from England Football Learning.' })
  }

  const page = parsePage(html)
  if (!page.title) {
    return reply(422, { error: 'That page does not look like an England Football session page.' })
  }

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

  const sourceFields = { source_url: pageUrl.href, source_label: SOURCE_LABEL }

  // Store one asset unmodified and register it, returning the media id.
  // Failures become warnings, never aborts: the drill is still created.
  async function storeAsset(raw: string, name: string, kind: 'diagram' | 'pdf'): Promise<string | null> {
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
    const path = `${clubId}/${crypto.randomUUID()}-${slug(name)}.${ext}`
    const { error: uploadError } = await db.storage.from('media').upload(path, asset.bytes, { contentType })
    if (uploadError) {
      warnings.push(`Could not store the file for "${name}".`)
      return null
    }
    const { data: row, error: insertError } = await db
      .from('media')
      .insert({
        club_id: clubId,
        created_by: userId,
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
      await db.storage.from('media').remove([path])
      warnings.push(`Could not register the file for "${name}".`)
      return null
    }
    return row.id as string
  }

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
      mediaId = await storeAsset(act.imageUrl, `${label} diagram`, 'diagram')
      storedByUrl.set(act.imageUrl, mediaId)
      if (mediaId) mediaCount++
    }
    const { data: drill, error: drillError } = await db
      .from('drills')
      .insert({
        club_id: clubId,
        created_by: userId,
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

  let pdfStored = false
  if (page.pdfUrl) {
    pdfStored = !!(await storeAsset(page.pdfUrl, `${page.title} session plan`, 'pdf'))
    if (pdfStored) mediaCount++
  }

  // The template ties the drills together in page order, ten minutes each
  // by default, with the page's intentions and programme grouping.
  const activities = drillIds.map((id) => ({ phase: 'Skill', drill_id: id, duration: 10 }))
  const { data: template, error: templateError } = await db
    .from('templates')
    .insert({
      club_id: clubId,
      name: page.title,
      focus: page.programme || page.title.split(':')[0].trim(),
      author: SOURCE_LABEL,
      activities,
      intentions: page.intentions,
      programme: page.programme || null,
      week: page.week,
      ...sourceFields,
    })
    .select('id')
    .single()
  if (templateError || !template) {
    return reply(500, {
      error: 'Imported the drills but could not create the template. Check the drill library.',
      created: { drills: drillIds.length, media: mediaCount, template: 0 },
      warnings,
    })
  }

  return reply(200, {
    ok: true,
    template_id: template.id,
    template_name: page.title,
    created: { drills: drillIds.length, media: mediaCount, template: 1 },
    warnings,
  })
})
