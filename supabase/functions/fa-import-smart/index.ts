// =====================================================================
// fa-import-smart Edge Function
//
// REVIEW REQUIRED. The one import action behind "Import from England
// Football": a signed in coach pastes any England Football Learning
// link and this function decides what it is. A title beginning
// "Session programme", or a weekly-sessions container of named week
// links running 1..n, routes to the programme import; a setup strip or
// an activity gallery routes to the single session import. The coach
// never classifies a URL, and the mirror-guard 422s remain only for a
// page that matches neither shape. See CLAUDE.md, Third-party content,
// for the standing policy.
//
// This is a thin dispatcher: detection and both import paths live in
// ../_shared/fa.ts (detectFaPage, runSessionImport, runProgrammeImport),
// the same code paths fa-import and fa-import-programme serve, so each
// import kind has exactly one implementation. The reply carries
// kind: 'programme' | 'session' on top of the routed function's fields.
//
// Security model matches the other two:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that user. The
//     service role key is not used in this function at all.
//   * Hard allowlist: pages on learn.englandfootball.com, assets on
//     cdn.englandfootball.com, https only. One page per call, plus the
//     programme overview's own week links (the single sanctioned
//     one-level follow, same host, capped at MAX_PROGRAMME_WEEKS).
//   * CORS to APP_ORIGIN, shared with the other functions.
//
// Deploy with `npx supabase functions deploy fa-import-smart` and make
// sure APP_ORIGIN is set (shared with invite-user).
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
  runSessionImport,
} from '../_shared/fa.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // Validate the payload: one page URL, which must be on the FA Learning
  // site. The page is fetched once and detection reads that one fetch.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : ''
  const pageUrl = allowedUrl(rawUrl, PAGE_HOST)
  if (!pageUrl) {
    return reply(400, { error: 'Paste a link from learn.englandfootball.com.' })
  }

  const html = await fetchFaPage(pageUrl)
  if (html == null) {
    return reply(422, { error: 'Could not fetch that page from England Football Learning.' })
  }

  const detected = detectFaPage(html, pageUrl)
  if (detected.kind === 'programme') {
    return await runProgrammeImport(caller, detected, pageUrl, { kind: 'programme' })
  }
  if (detected.kind === 'session') {
    return await runSessionImport(caller, detected, pageUrl, { kind: 'session' })
  }
  // The genuine fallback: a page that is neither a session nor a programme
  // overview (a listing, an article, a dead page).
  return reply(422, {
    error:
      'That page does not look like an England Football session or programme. Paste a session page or a programme overview link.',
  })
})
