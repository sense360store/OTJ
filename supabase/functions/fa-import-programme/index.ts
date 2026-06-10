// =====================================================================
// fa-import-programme Edge Function
//
// REVIEW REQUIRED. The FA publishes a session programme as an overview
// page linking its weekly session pages. This function imports a whole
// programme on behalf of a signed in coach: it fetches the overview,
// finds its week links, imports each week through the shared
// session-import core (the same drills, media and template fa-import
// creates), and ties the results to one programme row, with the
// programme PDF stored unmodified and attached when present.
//
// This is the single sanctioned one-level link follow (CLAUDE.md,
// Third-party content): a programme overview's own week links may be
// followed, one level, same host, capped, as part of importing that
// one user-chosen resource. Nothing deeper, never another host, at
// most MAX_PROGRAMME_WEEKS pages.
//
// Security model matches fa-import:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that user. The
//     service role key is not used in this function at all.
//   * Hard allowlist: pages on learn.englandfootball.com, assets on
//     cdn.englandfootball.com, https only.
//   * CORS to APP_ORIGIN, shared with fa-import and invite-user.
//
// Idempotence: re-importing the same overview URL updates the existing
// programme row (matched on club_id plus the normalised source_url)
// rather than duplicating, and weeks whose templates already exist for
// it are reported as skipped. A failed week is reported and the rest
// continue. Deploy with
// `npx supabase functions deploy fa-import-programme`.
// =====================================================================
import {
  allowedUrl,
  corsHeaders,
  fetchFaPage,
  importParsedSession,
  normalisedHref,
  PAGE_HOST,
  parseOverviewPage,
  parseSessionPage,
  reply,
  resolveCaller,
  SOURCE_LABEL,
  storeFaAsset,
  MAX_PROGRAMME_WEEKS,
} from '../_shared/fa.ts'
import type { FaCaller } from '../_shared/fa.ts'

interface WeekOutcome {
  week: number
  url: string
  status: 'imported' | 'skipped' | 'failed'
  template_id?: string
  template_name?: string
  created?: { drills: number; media: number; template: number }
  warnings?: string[]
  error?: string
}

// The FA titles overviews "Session programme: moving with the ball and
// turning to attack"; the programme is named by what follows the prefix.
function programmeName(title: string): string {
  const m = title.match(/^session programme[:\s]+(.+)$/i)
  const name = (m ? m[1] : title).trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : title
}

// Find or create the programme row for this overview. One programme per
// overview URL per club; a name that already exists (a programme backfilled
// from the legacy labels, or week pages imported singly before the overview)
// is adopted and pointed at this overview rather than duplicated.
async function upsertProgramme(
  caller: FaCaller,
  name: string,
  sourceUrl: string,
  fresh: Record<string, unknown>,
  warnings: string[],
): Promise<{ id: string; pdfMediaId: string | null } | null> {
  const { data: existing } = await caller.db
    .from('programmes')
    .select('id, pdf_media_id')
    .eq('club_id', caller.clubId)
    .eq('source_url', sourceUrl)
    .maybeSingle()
  if (existing) {
    const { error } = await caller.db.from('programmes').update(fresh).eq('id', existing.id)
    if (error) warnings.push('Could not refresh the programme details.')
    return { id: existing.id as string, pdfMediaId: (existing.pdf_media_id as string | null) ?? null }
  }

  const { data: inserted, error: insertError } = await caller.db
    .from('programmes')
    .insert({ club_id: caller.clubId, created_by: caller.userId, name, ...fresh })
    .select('id, pdf_media_id')
    .single()
  if (inserted) return { id: inserted.id as string, pdfMediaId: null }

  // 23505 is the unique (club_id, name) violation: adopt the existing row.
  if (insertError?.code === '23505') {
    const { data: byName } = await caller.db
      .from('programmes')
      .select('id, pdf_media_id')
      .eq('club_id', caller.clubId)
      .eq('name', name)
      .maybeSingle()
    if (byName) {
      const { error } = await caller.db.from('programmes').update(fresh).eq('id', byName.id)
      if (error) warnings.push('Could not refresh the programme details.')
      return { id: byName.id as string, pdfMediaId: (byName.pdf_media_id as string | null) ?? null }
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // Validate the payload: one overview URL, which must be on the FA
  // Learning site. Only that page and the week links it names are fetched.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : ''
  const pageUrl = allowedUrl(rawUrl, PAGE_HOST)
  if (!pageUrl) {
    return reply(400, { error: 'Paste a programme overview link from learn.englandfootball.com.' })
  }

  const html = await fetchFaPage(pageUrl)
  if (html == null) {
    return reply(422, { error: 'Could not fetch that page from England Football Learning.' })
  }

  const overview = parseOverviewPage(html, pageUrl)
  if (!overview.title) {
    return reply(422, { error: 'That page does not look like an England Football programme page.' })
  }

  // The mirror of fa-import's overview refusal: a single session page pasted
  // here would manufacture a junk programme named after one session. A
  // session page carries a setup strip or an activity gallery; an overview
  // titled "Session programme" is never refused.
  if (!/^session\s+programme/i.test(overview.title)) {
    const asSession = parseSessionPage(html)
    const hasSetup = !!(asSession.space || asSession.players || asSession.equipment.length > 0)
    if (hasSetup || asSession.activities.length > 0) {
      return reply(422, {
        error: 'That link looks like a single session page. Use Import from England Football for one session, or paste the programme overview link.',
      })
    }
  }

  // Partial parses warn, never abort the run.
  const warnings: string[] = []
  if (overview.intentions.length === 0) warnings.push('No session intentions were found on the overview.')
  if (overview.weekLinks.length === 0) warnings.push('No week links were found on the overview.')
  if (overview.truncated) warnings.push(`Only the first ${MAX_PROGRAMME_WEEKS} week links were imported.`)
  if (!overview.pdfUrl) warnings.push('No programme PDF was found on the overview.')

  const name = programmeName(overview.title)
  const sourceUrl = normalisedHref(pageUrl)
  const fresh = {
    summary: overview.summary || null,
    intentions: overview.intentions,
    weeks: overview.weekLinks.length || 6,
    source_url: sourceUrl,
    source_label: SOURCE_LABEL,
  }

  // The programme row comes first, so every imported week has something to
  // point at even if a later step fails.
  const programme = await upsertProgramme(caller, name, sourceUrl, fresh, warnings)
  if (!programme) {
    return reply(500, { error: 'Could not create the programme. Check your access and try again.', warnings })
  }

  // The programme PDF, stored unmodified with attribution and attached once;
  // a re-import never duplicates an already attached copy.
  if (overview.pdfUrl && !programme.pdfMediaId) {
    const sourceFields = { source_url: sourceUrl, source_label: SOURCE_LABEL }
    const stored = await storeFaAsset(caller, warnings, sourceFields, overview.pdfUrl, `${name} programme PDF`, 'pdf')
    if (stored) {
      const { error } = await caller.db.from('programmes').update({ pdf_media_id: stored }).eq('id', programme.id)
      if (error) warnings.push('Stored the programme PDF but could not attach it.')
    }
  }

  // Weeks already imported for this programme are skipped, not duplicated.
  const { data: existingTemplates } = await caller.db
    .from('templates')
    .select('programme_week')
    .eq('programme_id', programme.id)
    .not('programme_week', 'is', null)
  const existingWeeks = new Set((existingTemplates ?? []).map((t) => t.programme_week as number))

  // Import each week through the shared core, in page order. A failed week
  // is reported and the rest continue.
  const outcomes: WeekOutcome[] = []
  for (let i = 0; i < overview.weekLinks.length; i++) {
    const link = overview.weekLinks[i]
    const week = link.week ?? i + 1
    if (existingWeeks.has(week)) {
      outcomes.push({ week, url: link.url, status: 'skipped' })
      continue
    }
    const weekUrl = allowedUrl(link.url, PAGE_HOST)
    if (!weekUrl) {
      outcomes.push({ week, url: link.url, status: 'failed', error: 'The week link is not on the allowlisted host.' })
      continue
    }
    const weekHtml = await fetchFaPage(weekUrl)
    if (weekHtml == null) {
      outcomes.push({ week, url: link.url, status: 'failed', error: 'Could not fetch the week page.' })
      continue
    }
    const page = parseSessionPage(weekHtml)
    if (!page.title) {
      outcomes.push({ week, url: link.url, status: 'failed', error: 'The week page does not look like a session page.' })
      continue
    }
    const result = await importParsedSession(caller, page, weekUrl.href, {
      programme_id: programme.id,
      programme_week: week,
    })
    if (!result.templateId) {
      outcomes.push({
        week,
        url: link.url,
        status: 'failed',
        error: 'Imported the drills but could not create the week template.',
        created: result.created,
        warnings: result.warnings,
      })
      continue
    }
    existingWeeks.add(week)
    outcomes.push({
      week,
      url: link.url,
      status: 'imported',
      template_id: result.templateId,
      template_name: page.title,
      created: result.created,
      warnings: result.warnings,
    })
  }

  return reply(200, {
    ok: true,
    programme_id: programme.id,
    programme_name: name,
    weeks: outcomes,
    warnings,
  })
})
