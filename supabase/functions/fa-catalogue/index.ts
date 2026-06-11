// =====================================================================
// fa-catalogue Edge Function
//
// REVIEW REQUIRED. Syncs the England Football Learning sessions listing
// into the club's fa_catalogue index so coaches can browse it and
// import per selection through fa-import-smart. The sync stores facts
// and links only: titles, summaries, the FA's taxonomy labels and the
// listing thumbnail's URL (hot-linked, never downloaded). No asset is
// fetched or stored here; full assets are stored only when a coach
// imports that one resource. Syncing is always user initiated, never
// scheduled. See CLAUDE.md, Third-party content.
//
// Security model matches the import functions:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that user (the
//     fa_catalogue writes need a coaching role). No service role.
//   * The function fetches only the /sessions listing on
//     learn.englandfootball.com. The caller passes a filter query
//     string at most, never a URL: the host and path are fixed here.
//     Pagination follows rel="next" on the same host and path only,
//     capped at MAX_INDEX_PAGES (the live listing is one page).
//   * CORS to APP_ORIGIN, shared with the other functions.
//
// Each sync also reconciles which entries are already imported, by
// matching entry URLs against the club's programmes and templates
// source URLs. An import made before the catalogue existed shows as
// imported, and a deleted import unmarks. Deploy with
// `npx supabase functions deploy fa-catalogue`.
// =====================================================================
import { corsHeaders, fetchFaPage, PAGE_HOST, reply, resolveCaller } from '../_shared/fa.ts'
import {
  listingNextUrl,
  MAX_CATALOGUE_CARDS,
  MAX_INDEX_PAGES,
  parseListingCards,
  parseListingTaxonomy,
} from '../_shared/fa_catalogue.ts'
import type { CatalogueCard } from '../_shared/fa_catalogue.ts'

const MAX_FILTER_LENGTH = 400

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // The payload carries at most a filter query string for the listing
  // (theme, age band and so on, the FA's own filter parameters). It is
  // parsed and re-serialised through URLSearchParams, so only well formed
  // query pairs reach the URL, and the host and path are fixed here.
  let payload: Record<string, unknown>
  try {
    payload = req.body ? await req.json() : {}
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const rawFilter = typeof payload.filter === 'string' ? payload.filter.trim() : ''
  if (rawFilter.length > MAX_FILTER_LENGTH) {
    return reply(400, { error: 'That filter is too long.' })
  }
  const listingUrl = new URL(`https://${PAGE_HOST}/sessions`)
  if (rawFilter) listingUrl.search = new URLSearchParams(rawFilter).toString()

  // Fetch the listing, following defensive pagination only: same host,
  // same path, capped.
  const warnings: string[] = []
  const cards: CatalogueCard[] = []
  const seen = new Set<string>()
  let pages = 0
  let next: URL | null = listingUrl
  while (next && pages < MAX_INDEX_PAGES && cards.length < MAX_CATALOGUE_CARDS) {
    const html = await fetchFaPage(next)
    if (html == null) {
      if (pages === 0) return reply(422, { error: 'Could not fetch the catalogue from England Football Learning.' })
      warnings.push('Could not fetch a follow-on listing page; the catalogue may be partial.')
      break
    }
    pages++
    const taxonomy = parseListingTaxonomy(html)
    if (Object.keys(taxonomy).length === 0) warnings.push('No filter taxonomy was found on the listing.')
    for (const card of parseListingCards(html, next, taxonomy)) {
      if (seen.has(card.url) || cards.length >= MAX_CATALOGUE_CARDS) continue
      seen.add(card.url)
      cards.push(card)
    }
    next = listingNextUrl(html, next)
  }
  if (cards.length === 0) {
    return reply(422, { error: 'No resources were found on the catalogue listing.' })
  }

  // Reconcile which entries are already imported: the smart importer stores
  // the normalised page URL as source_url on the programme (an overview) or
  // the template (a session page), so a URL match names the import. Reads
  // go through RLS as the caller, club-wide like every other read.
  const importedByUrl = new Map<string, { ref: string; kind: 'programme' | 'session' }>()
  const { data: programmeRefs } = await caller.db
    .from('programmes')
    .select('id, source_url')
    .not('source_url', 'is', null)
  for (const p of programmeRefs ?? []) {
    if (p.source_url) importedByUrl.set(p.source_url as string, { ref: p.id as string, kind: 'programme' })
  }
  const { data: templateRefs } = await caller.db
    .from('templates')
    .select('id, source_url')
    .not('source_url', 'is', null)
  for (const t of templateRefs ?? []) {
    const url = t.source_url as string
    // A programme match wins: its overview URL never collides with a week
    // page URL, but the guard keeps the intent plain.
    if (url && !importedByUrl.has(url)) importedByUrl.set(url, { ref: t.id as string, kind: 'session' })
  }

  // One bulk upsert on (club_id, url): refreshed facts, the sync stamp and
  // the reconciled import marking. RLS enforces the coaching-role write.
  const syncedAt = new Date().toISOString()
  const rows = cards.map((c) => {
    const imported = importedByUrl.get(c.url) ?? null
    return {
      club_id: caller.clubId,
      url: c.url,
      title: c.title,
      summary: c.summary || null,
      theme: c.theme || null,
      skills: c.skills,
      format: c.format || null,
      age_band: c.ageBand || null,
      kind: c.kind,
      thumbnail_url: c.thumbnailUrl || null,
      imported_ref: imported?.ref ?? null,
      imported_kind: imported?.kind ?? null,
      synced_at: syncedAt,
    }
  })
  const { error: upsertError } = await caller.db.from('fa_catalogue').upsert(rows, { onConflict: 'club_id,url' })
  if (upsertError) {
    return reply(500, { error: 'Could not store the catalogue. Check your access and try again.', warnings })
  }

  return reply(200, {
    ok: true,
    pages,
    entries: rows.length,
    imported: rows.filter((r) => r.imported_ref).length,
    synced_at: syncedAt,
    warnings,
  })
})
