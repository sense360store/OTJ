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
// The parsing and import core lives in ../_shared/fa.ts, shared with
// fa-import-programme so the session-import behaviour stays
// single-sourced. This function's external behaviour is unchanged:
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
import {
  allowedUrl,
  corsHeaders,
  fetchFaPage,
  importParsedSession,
  PAGE_HOST,
  parseSessionPage,
  reply,
  resolveCaller,
} from '../_shared/fa.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

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

  const html = await fetchFaPage(pageUrl)
  if (html == null) {
    return reply(422, { error: 'Could not fetch that page from England Football Learning.' })
  }

  const page = parseSessionPage(html)
  if (!page.title) {
    return reply(422, { error: 'That page does not look like an England Football session page.' })
  }

  // The single-page import keeps writing the legacy programme and week
  // labels it has always written; the entity-backed links are set by the
  // programme import only.
  const result = await importParsedSession(caller, page, pageUrl.href, {
    programme: page.programme || null,
    week: page.week,
  })

  if (!result.templateId) {
    return reply(500, {
      error: 'Imported the drills but could not create the template. Check the drill library.',
      created: result.created,
      warnings: result.warnings,
    })
  }

  return reply(200, {
    ok: true,
    template_id: result.templateId,
    template_name: page.title,
    created: result.created,
    warnings: result.warnings,
  })
})
