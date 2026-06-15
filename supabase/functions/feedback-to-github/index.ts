// =====================================================================
// feedback-to-github Edge Function
//
// REVIEW REQUIRED, AND GATED BEYOND MERGE: merging this file puts nothing
// live. After merge the function is reviewed line by line in the main
// session and deployed through the Supabase connector from merged main
// with verify_jwt on, then verified by reading the deployed source back
// and checking its content, never by trusting a version number. Deploy
// from the files on disk through Claude Code or the Supabase CLI, never by
// pasting file contents inline: a deploy that inlines a large shared
// module can be silently truncated and still report success (the
// _shared/fa.ts lesson).
//
// What this is. An admin promotes one feedback item to a GitHub issue on
// sense360store/OTJ. ADMIN ONLY: the gate is has_perm('club.manage'), not
// sessions.create, so a coach cannot promote. No AI in this phase: the
// issue title and body are the admin's own approved text, sent through
// unchanged.
//
// THE PUBLIC BOUNDARY. sense360store/OTJ is a PUBLIC repository, so every
// issue is world readable. The issue carries only the admin's approved
// title and body: never the filer's name, never a child's name, never a
// member email or contact, never any field the app holds that is not meant
// to be public. The function reads the feedback row only for its promotion
// state (the existing issue number and the status), never to copy member
// data into the issue. The admin reviews and edits the exact text in the
// panel first; the admin's review and this strip are the two layers.
//
// Idempotent. If the item already carries a github_issue_number the
// function creates no second issue and returns the existing url with an
// already_promoted flag, so a double press or a re run never duplicates.
//
// Security model, mirroring the spond functions:
//   * The Supabase client is built from the caller's JWT and the anon key,
//     so every read and write goes through RLS as that admin. The service
//     role key is not used in this function at all.
//   * The club.manage capability is required before GitHub is contacted,
//     checked by calling the live has_perm function through the caller's
//     RLS client: the same function the feedback update policy's manage arm
//     uses, so the early check and the RLS enforcement cannot drift.
//   * The GitHub token is the GITHUB_TOKEN function secret, a fine grained
//     personal access token scoped to sense360store/OTJ with Issues read
//     and write only. It is never in the client and never in the repo.
//     When it is missing the function fails closed with a 503 and creates
//     nothing.
//
// Logging. Only status codes and the feedback id are logged, never the
// issue title or body, never a name, consistent with the other functions.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  alreadyPromoted,
  buildIssuePayload,
  GITHUB_API_BASE,
  GITHUB_REPO,
  GITHUB_TIMEOUT_MS,
  githubErrorMessage,
  promotedStatus,
  readIssueResponse,
  readPromoteInput,
  shouldRetryWithoutTypeLabel,
  typeLabelForKind,
} from '../_shared/github.ts'
import type { FeedbackPromotionRow, IssuePayload } from '../_shared/github.ts'

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? ''

// The header shape the GitHub REST API expects: a bearer token, the v3 JSON
// accept type, the pinned API version, and a User-Agent (GitHub refuses a
// request without one). content-type is set on the create call.
function githubHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OTJ Training Hub',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // Fail closed while the GitHub token is not configured. The function can be
  // deployed before the secret exists; only a real promotion needs it.
  if (!GITHUB_TOKEN) {
    return reply(503, {
      error:
        'GitHub is not configured. An administrator must set the GITHUB_TOKEN function secret. No issue was created.',
    })
  }

  // The capability gate, before GitHub is contacted at all. has_perm is the
  // live SECURITY DEFINER function the feedback update policy's manage arm
  // calls, so a yes here means the write back below passes RLS and a no
  // refuses early. club.manage, not sessions.create: a coach cannot promote.
  const { data: canManage, error: permError } = await caller.db.rpc('has_perm', { capability: 'club.manage' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. No issue was created.' })
  }
  if (canManage !== true) {
    return reply(403, { error: 'Promoting feedback to a GitHub issue needs the club.manage capability.' })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    parsedBody = null
  }
  const input = readPromoteInput(parsedBody)
  if ('error' in input) return reply(400, { error: input.error })

  // Read the item through the caller's RLS client. The feedback select is
  // club wide, so this also confirms the item is in the admin's club; a row
  // outside it reads as not found. Only the promotion state is read, never
  // any field that would become issue content.
  const { data: row, error: readError } = await caller.db
    .from('feedback')
    .select('id, status, kind, github_issue_number, github_issue_url')
    .eq('id', input.feedbackId)
    .maybeSingle()
  if (readError) {
    return reply(500, { error: 'Could not read the feedback item. No issue was created.' })
  }
  if (!row) {
    return reply(404, { error: 'That feedback item was not found in your club.' })
  }
  const feedback = row as FeedbackPromotionRow

  // Idempotency guard: a promoted item is not promoted again. Return the
  // existing issue so the caller shows the link rather than creating a
  // duplicate.
  if (alreadyPromoted(feedback)) {
    return reply(200, {
      ok: true,
      already_promoted: true,
      issue_number: feedback.github_issue_number,
      issue_url: feedback.github_issue_url,
    })
  }

  // Create the issue. One POST, a short timeout. The admin's title and body
  // pass through unchanged, with the provenance label and the type label
  // derived from the stored feedback kind (feature to enhancement, bug to bug,
  // general to no type label). The kind is read from the row above, never from
  // client input, so the label reflects the stored kind.
  const typeLabel = typeLabelForKind(feedback.kind)
  function postIssue(payload: IssuePayload): Promise<Response> {
    return fetch(`${GITHUB_API_BASE}/repos/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: { ...githubHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
  }
  let res: Response
  try {
    res = await postIssue(buildIssuePayload(input, feedback.kind))
  } catch {
    return reply(502, { error: 'Could not reach GitHub within the timeout. No issue was created.' })
  }
  // The type label is best effort and must never block the promotion. If GitHub
  // rejects the create with 422 while a type label was in play (a label that
  // did not exist on a repository that does not auto create it), degrade to the
  // provenance label alone and create the issue without the type label.
  if (!res.ok && shouldRetryWithoutTypeLabel(res.status, typeLabel !== null)) {
    console.error('feedback-to-github: retrying create without the type label', {
      feedbackId: feedback.id,
      status: res.status,
    })
    await res.body?.cancel()
    try {
      res = await postIssue(buildIssuePayload(input, null))
    } catch {
      return reply(502, { error: 'Could not reach GitHub within the timeout. No issue was created.' })
    }
  }
  if (!res.ok) {
    console.error('feedback-to-github: issue create failed', { feedbackId: feedback.id, status: res.status })
    await res.body?.cancel()
    return reply(502, { error: githubErrorMessage(res.status) })
  }

  let issueBody: unknown = null
  try {
    issueBody = await res.json()
  } catch {
    issueBody = null
  }
  const issue = readIssueResponse(issueBody)
  if (!issue) {
    console.error('feedback-to-github: issue create returned an unreadable response', { feedbackId: feedback.id })
    return reply(502, { error: 'GitHub created the issue but returned an unexpected response.' })
  }

  // Write the promotion back through the caller's RLS client: the issue
  // coordinates, the moment, and the admin who opened it. Promotion is also
  // the signal the item has been picked up, so the status moves to planned
  // unless it is terminal (done or declined) or already planned. The status
  // change rides the same update; the feedback_guard_status trigger allows it
  // because the caller holds club.manage. A failed write back is reported,
  // but the public issue already exists, so the message says so plainly.
  const nextStatus = promotedStatus(feedback.status)
  const update: Record<string, unknown> = {
    github_issue_number: issue.number,
    github_issue_url: issue.url,
    github_issued_at: new Date().toISOString(),
    github_issued_by: caller.userId,
    updated_at: new Date().toISOString(),
  }
  if (nextStatus) update.status = nextStatus

  const { data: written, error: writeError } = await caller.db
    .from('feedback')
    .update(update)
    .eq('id', feedback.id)
    .select('id')
  if (writeError || !written?.length) {
    console.error('feedback-to-github: write back failed', {
      feedbackId: feedback.id,
      issueNumber: issue.number,
      code: writeError?.code,
    })
    return reply(200, {
      ok: false,
      issue_number: issue.number,
      issue_url: issue.url,
      warning:
        'The GitHub issue was created, but linking it to the feedback item failed. The item may not show the link until you try again.',
    })
  }

  return reply(200, {
    ok: true,
    issue_number: issue.number,
    issue_url: issue.url,
    ...(nextStatus ? { status: nextStatus } : {}),
  })
})
