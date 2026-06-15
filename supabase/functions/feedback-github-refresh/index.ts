// =====================================================================
// feedback-github-refresh Edge Function
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
// What this is. The second half of the feedback-to-GitHub lifecycle (issue
// #83), the issue-state-flows-back direction. An admin opens the feedback
// screen; the screen calls this function once; it reads the open/closed
// state of each promoted item's linked issue and, for any issue now closed
// whose feedback item is not already done or declined, moves that item's
// status to done. This is POLLING ON OPEN, not a webhook: there is no
// public endpoint and no signature to verify, which suits a low traffic
// club tool.
//
// ONE DIRECTION, AND ONLY TO DONE. The refresh never reopens an item, never
// moves a status away from a terminal state (done or declined), and never
// closes, edits or deletes a GitHub issue: issues are a durable work record.
// The only state change it can make is moving a non terminal item to done
// because its issue closed. It is idempotent: once an item is done it is
// terminal, so a later run reads it no more and changes nothing.
//
// THE PUBLIC BOUNDARY. sense360store/OTJ is a PUBLIC repository. The GitHub
// read here returns the issue's own fields; only the state is taken, and no
// member data is ever read, stored, logged or returned. The function reads
// the feedback row only for its id, status and linked issue number, never
// any field that is issue content or member data.
//
// Security model, mirroring feedback-to-github and the spond functions:
//   * The Supabase client is built from the caller's JWT and the anon key,
//     so every read and write goes through RLS as that admin. The service
//     role key is not used in this function at all.
//   * The club.manage capability is required before GitHub is contacted,
//     checked by calling the live has_perm function through the caller's
//     RLS client: the same function the feedback update policy's manage arm
//     and the feedback_guard_status trigger use, so the early check and the
//     RLS enforcement cannot drift. A coach cannot trigger a refresh.
//   * The GitHub token is the GITHUB_TOKEN function secret, the same fine
//     grained token the promote function uses. It is never in the client
//     and never in the repo. When it is missing the function fails closed
//     with a 503 and changes nothing.
//
// Best effort. A GitHub read failure, a rate limit, or a single unreadable
// issue never breaks the screen and never changes a status wrongly: on any
// doubt the item is left unchanged. A bad token or a rate limit stops the
// run early (every read would fail the same way) and changes nothing further.
//
// Logging. Only HTTP status codes and feedback ids are logged, never an
// issue title or body, never a name, consistent with the other functions.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  closedIssueStatus,
  GITHUB_API_BASE,
  GITHUB_REPO,
  GITHUB_TIMEOUT_MS,
  issuesToCheck,
  MAX_ISSUES_PER_REFRESH,
  readIssueState,
} from '../_shared/github.ts'
import type { FeedbackIssueRow } from '../_shared/github.ts'

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? ''

// The header shape the GitHub REST API expects on a read: a bearer token, the
// v3 JSON accept type, the pinned API version, and a User-Agent (GitHub
// refuses a request without one). No content-type: every call here is a GET.
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
  // deployed before the secret exists; only a real refresh needs it.
  if (!GITHUB_TOKEN) {
    return reply(503, {
      error:
        'GitHub is not configured. An administrator must set the GITHUB_TOKEN function secret. Nothing was refreshed.',
    })
  }

  // The capability gate, before GitHub is contacted at all. has_perm is the
  // live SECURITY DEFINER function the feedback update policy's manage arm and
  // the status guard trigger call, so a yes here means the status write below
  // passes RLS and the trigger, and a no refuses early. club.manage, not
  // sessions.create: a coach cannot trigger the refresh.
  const { data: canManage, error: permError } = await caller.db.rpc('has_perm', { capability: 'club.manage' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. Nothing was refreshed.' })
  }
  if (canManage !== true) {
    return reply(403, { error: 'Refreshing feedback from GitHub needs the club.manage capability.' })
  }

  // Read the promoted items through the caller's RLS client. The feedback
  // select is club wide, so this returns only this admin's club's items; an
  // item outside it is never seen. Only the promotion state is read, never any
  // field that is issue content or member data.
  const { data: rows, error: readError } = await caller.db
    .from('feedback')
    .select('id, status, github_issue_number')
    .not('github_issue_number', 'is', null)
  if (readError) {
    return reply(500, { error: 'Could not read the feedback items. Nothing was refreshed.' })
  }

  // Filter in memory to the promoted, non terminal items: only those can move,
  // so only those are read from GitHub. The cap bounds a single open.
  const toCheck = issuesToCheck((rows ?? []) as FeedbackIssueRow[]).slice(0, MAX_ISSUES_PER_REFRESH)

  let checked = 0
  let updated = 0
  let failed = 0
  let stopped = false

  for (const item of toCheck) {
    checked++
    let res: Response
    try {
      res = await fetch(`${GITHUB_API_BASE}/repos/${GITHUB_REPO}/issues/${item.github_issue_number}`, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      })
    } catch {
      // A timeout or network error on one issue: leave it unchanged, go on.
      failed++
      continue
    }

    // A refused token (401/403) or a rate limit (429) would fail every
    // remaining read the same way, so stop the run, change nothing further,
    // and report it. Best effort: a stopped run never moves a status wrongly.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      console.error('feedback-github-refresh: github read refused, stopping', { status: res.status })
      await res.body?.cancel()
      stopped = true
      break
    }

    if (!res.ok) {
      // A 404 (the issue is gone) or any other per issue failure: skip this
      // one, leave its status unchanged, and continue.
      console.error('feedback-github-refresh: issue read failed', { feedbackId: item.id, status: res.status })
      await res.body?.cancel()
      failed++
      continue
    }

    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const state = readIssueState(body)
    if (!state) {
      // An unreadable response: change nothing on doubt.
      failed++
      continue
    }

    // The only move the refresh can make: a closed issue takes a non terminal
    // item to done. An open issue, or an already terminal item, returns null.
    const next = closedIssueStatus(item.status, state.state)
    if (!next) continue

    // Write the status through the caller's RLS client. The manage arm of the
    // feedback update policy plus the feedback_guard_status trigger allow it
    // because the caller holds club.manage. The two neq guards keep the
    // invariant at the database too: never move away from a terminal state,
    // even under a concurrent change between the read above and this write.
    const { data: written, error: writeError } = await caller.db
      .from('feedback')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .neq('status', 'done')
      .neq('status', 'declined')
      .select('id')
    if (writeError) {
      console.error('feedback-github-refresh: status write back failed', { feedbackId: item.id, code: writeError.code })
      failed++
      continue
    }
    // No rows written with no error means the item went terminal under us
    // (a concurrent decline or done): benign, not a failure, just no move.
    if (written?.length) updated++
  }

  return reply(200, { ok: true, checked, updated, failed, stopped })
})
