// =====================================================================
// Shared GitHub issue promotion core
//
// REVIEW REQUIRED. This module is the pure logic behind the
// feedback-to-github Edge Function, kept separate from the function's
// network and database orchestration so it can be unit tested with no
// network and no database, the same split spond.ts uses for spond-sync.
//
// THE PUBLIC BOUNDARY. sense360store/OTJ is a PUBLIC repository, so every
// issue created from a feedback item is world readable. The issue carries
// only the admin's approved title and body: never the filer's name, never
// a child's name, never a member email or contact, never any field the
// app holds that is not meant to be public. The function reads the
// feedback row for its promotion state only (the issue number and url and
// the status), never to copy member data into the issue. The admin sees
// and edits the exact text before it is sent; the strip here and the
// admin's review are the two layers.
//
// This module performs no input invention: in this phase the issue body is
// the admin's edited text, passed through unchanged. There is no AI
// drafting here.
// =====================================================================

// The repository every promoted issue is created in. Public by design; see
// the header. Hardcoded rather than read from a header so a caller can never
// redirect the issue to another repository.
export const GITHUB_REPO = 'sense360store/OTJ'
export const GITHUB_API_BASE = 'https://api.github.com'

// The provenance label, applied so an issue opened from the Hub is
// distinguishable from one filed directly on GitHub. The issues endpoint
// creates a label that does not yet exist when an issue names it, so no
// separate label call is needed and the fine grained token needs only the
// Issues permission. A label that already exists is reused.
export const GITHUB_ISSUE_LABEL = 'from-hub'

// A short timeout: a single issue create, no retry. A slow GitHub fails the
// promotion plainly rather than holding the request open.
export const GITHUB_TIMEOUT_MS = 15_000

// Title and body bounds. The title bound mirrors what a sensible issue title
// is; the body bound is a defensive cap well under GitHub's own limit so a
// pasted wall of text cannot be sent. The minimum title length matches the
// feedback table's own check so a refusal the form would give never leaves
// the function.
export const ISSUE_TITLE_MIN = 3
export const ISSUE_TITLE_MAX = 256
export const ISSUE_BODY_MAX = 60_000

// The validated promotion request: which feedback item, and the admin's final
// title and body. body may be empty; GitHub accepts an empty issue body.
export interface PromoteInput {
  feedbackId: string
  title: string
  body: string
}

// Read and validate the request body the client sends. The title and body are
// the admin's approved text and are authoritative in this phase, so the
// function does not invent or rewrite them; it only trims and bounds them so a
// bypassed client cannot send junk the create would reject anyway. Returns the
// trimmed input or a single plain error string.
export function readPromoteInput(raw: unknown): PromoteInput | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid request body.' }
  const b = raw as Record<string, unknown>
  const feedbackId = typeof b.feedback_id === 'string' ? b.feedback_id.trim() : ''
  if (!feedbackId) return { error: 'No feedback item named.' }
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (title.length < ISSUE_TITLE_MIN) return { error: `The issue title needs at least ${ISSUE_TITLE_MIN} characters.` }
  if (title.length > ISSUE_TITLE_MAX) return { error: `The issue title is over ${ISSUE_TITLE_MAX} characters.` }
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (body.length > ISSUE_BODY_MAX) return { error: `The issue body is over ${ISSUE_BODY_MAX} characters.` }
  return { feedbackId, title, body }
}

// The issue creation payload. The admin's title and body pass through
// unchanged; the provenance label rides along.
export interface IssuePayload {
  title: string
  body: string
  labels: string[]
}

export function buildIssuePayload(input: PromoteInput): IssuePayload {
  return { title: input.title, body: input.body, labels: [GITHUB_ISSUE_LABEL] }
}

// The feedback row's promotion state, the only columns the function reads off
// the row. The issue text is never taken from the row; it is the admin's
// edited input.
export interface FeedbackPromotionRow {
  id: string
  status: string
  github_issue_number: number | null
  github_issue_url: string | null
}

// True when the item already carries a created issue, so a second promotion
// must not create a duplicate. A real issue number is a positive integer; null
// or a non positive value is treated as not promoted.
export function alreadyPromoted(row: { github_issue_number: number | null }): boolean {
  return typeof row.github_issue_number === 'number' && row.github_issue_number > 0
}

// The status a successful promotion moves the item to. Promotion is the
// standing signal that an item has been picked up, so it becomes 'planned',
// unless it is already done or declined, which are terminal and left alone, or
// already planned, which needs no write. Returns the new status, or null when
// the status should not change.
export function promotedStatus(current: string): 'planned' | null {
  if (current === 'done' || current === 'declined' || current === 'planned') return null
  return 'planned'
}

// The created issue, read from GitHub's 201 response: the issue number and the
// browser url. Anything missing or mistyped is treated as a failed read so the
// function does not write back a half issue.
export interface CreatedIssue {
  number: number
  url: string
}

export function readIssueResponse(body: unknown): CreatedIssue | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const number = b.number
  const url = b.html_url
  if (typeof number !== 'number' || number <= 0) return null
  if (typeof url !== 'string' || !url) return null
  return { number, url }
}

// A plain message for a GitHub failure status, the issue not created and
// nothing written back. The body content is never echoed; only the status
// shapes the message.
export function githubErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'GitHub refused the request. Check the GITHUB_TOKEN secret and its Issues permission. No issue was created.'
  }
  if (status === 404) {
    return 'GitHub could not find the repository, or the token cannot reach it. No issue was created.'
  }
  if (status === 422) {
    return 'GitHub rejected the issue content. No issue was created.'
  }
  if (status === 429) {
    return 'GitHub is rate limiting requests. Try again later. No issue was created.'
  }
  return `GitHub returned HTTP ${status}. No issue was created.`
}
