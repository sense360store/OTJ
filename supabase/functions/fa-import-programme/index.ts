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
// The whole request body lives in ../_shared/fa.ts (detectFaPage plus
// runProgrammeImport), shared with fa-import-smart so the programme
// import is one code path wherever it is reached from. The UI now calls
// fa-import-smart; this endpoint stays deployed and behaving as it
// always has for anything still calling it directly.
//
// The import performs the single sanctioned one-level link follow
// (CLAUDE.md, Third-party content): a programme overview's own week
// links may be followed, one level, same host, capped, as part of
// importing that one user-chosen resource. Nothing deeper, never
// another host, at most MAX_PROGRAMME_WEEKS pages.
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
  detectFaPage,
  fetchFaPage,
  PAGE_HOST,
  reply,
  resolveCaller,
  runProgrammeImport,
} from '../_shared/fa.ts'

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

  return await runProgrammeImport(caller, detectFaPage(html, pageUrl), pageUrl)
})
