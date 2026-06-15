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

// The type label applied alongside the provenance label, derived from the
// feedback item's stored kind so the engineering backlog is filterable by
// type. The mapping is deliberate, not the kind verbatim: a feature request is
// an "enhancement" in GitHub's vocabulary, a bug is "bug", and a general note
// carries no type label. Both targets are GitHub default labels, so they
// already exist on the repository. The kind is read from the feedback row the
// function loads, never from client input, so the label reflects the stored
// kind. An unknown kind maps to no label rather than guessing.
export function typeLabelForKind(kind: string | null | undefined): string | null {
  if (kind === 'feature') return 'enhancement'
  if (kind === 'bug') return 'bug'
  return null
}

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
// unchanged; the provenance label always rides along, and the type label from
// the feedback kind rides along when the kind maps to one.
export interface IssuePayload {
  title: string
  body: string
  labels: string[]
}

// Build the create payload. The provenance label is always present; the type
// label derived from kind is added when present (feature and bug), and absent
// for general or an unknown kind. Passing no kind, or null, yields the
// provenance only payload, which is also the degrade target when a type label
// would block the create (see shouldRetryWithoutTypeLabel).
export function buildIssuePayload(input: PromoteInput, kind?: string | null): IssuePayload {
  const typeLabel = typeLabelForKind(kind)
  const labels = typeLabel ? [GITHUB_ISSUE_LABEL, typeLabel] : [GITHUB_ISSUE_LABEL]
  return { title: input.title, body: input.body, labels }
}

// Whether a failed create should be retried with the provenance label alone.
// The type label is best effort and must never block the promotion: if a label
// did not exist on a repository that does not auto create it, GitHub answers
// 422, so the create is retried once without the type label. Only a 422 with a
// type label in play is retried; every other failure is a real one and passes
// through unchanged.
export function shouldRetryWithoutTypeLabel(status: number, hadTypeLabel: boolean): boolean {
  return hadTypeLabel && status === 422
}

// The feedback row's promotion state, the only columns the function reads off
// the row. The issue text is never taken from the row; it is the admin's
// edited input.
export interface FeedbackPromotionRow {
  id: string
  status: string
  kind: string
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

// =====================================================================
// Issue state read back (phase 2: lifecycle, the issue-state-flows-back half)
//
// The promotion above is one way: an admin opens a public issue from a
// feedback item. This second half reflects the issue's lifecycle back onto
// the feedback item, in ONE direction only: when the linked issue is closed,
// the feedback item moves to done. Nothing else flows back. The refresh never
// reopens an item, never moves a status away from a terminal state, and never
// closes, edits or deletes an issue: issues are a durable record. This is
// polling, run when an admin opens the feedback screen, not a webhook, so
// there is no public endpoint and no signature verification.
//
// THE PUBLIC BOUNDARY is unchanged: the GitHub issue read here returns the
// issue's own fields (its state, its number); only the state is read, and no
// member data is ever stored, logged or returned. The decision is pure and
// network free so it is unit testable; the function does the GitHub read and
// the write back through the caller's own RLS client.
// =====================================================================

// A defensive cap on how many issues one refresh reads, so a pathological
// number of promoted items cannot make a single open fan out without bound.
// A club's open promoted items are few; the rest, if ever there were more,
// are simply picked up on the next open.
export const MAX_ISSUES_PER_REFRESH = 50

// The terminal feedback statuses, the ones the refresh never moves away from.
// A done or declined item is left exactly as it is whatever its issue now
// says: done is the target and declined is a deliberate human decision.
export function isTerminalStatus(status: string): boolean {
  return status === 'done' || status === 'declined'
}

// The columns the refresh reads off a feedback row: its id, its current
// status, and the linked issue number. Never any field that is issue content
// or member data; the refresh only decides a status move.
export interface FeedbackIssueRow {
  id: string
  status: string
  github_issue_number: number | null
}

// The promoted, non terminal items worth a GitHub read this run. An item with
// no real issue number is not promoted and is skipped; a terminal item can
// never change and is skipped. Filtering here keeps the function reading only
// what could move, and makes the rule unit testable.
export function issuesToCheck(rows: FeedbackIssueRow[]): FeedbackIssueRow[] {
  return rows.filter((r) => alreadyPromoted(r) && !isTerminalStatus(r.status))
}

// GitHub's issue state, read from a GET /issues/{number} response. GitHub
// returns 'open' or 'closed' and nothing else for this field; a missing or
// mistyped value, or a non object body, reads as null so the refresh leaves
// the status unchanged on any doubt. Only the state is taken; every other
// field GitHub returns (including any that could carry text) is ignored.
export interface IssueState {
  state: 'open' | 'closed'
}

export function readIssueState(body: unknown): IssueState | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const state = b.state
  if (state === 'open' || state === 'closed') return { state }
  return null
}

// The decision the refresh makes per promoted item, pure and network free. A
// closed issue moves a non terminal feedback item to done; everything else is
// no change. An open issue never moves a status, and a closed issue never
// moves an item that is already done or declined. This only ever returns
// 'done' or null: the refresh can move a status TO done and nothing else.
export function closedIssueStatus(currentStatus: string, issueState: 'open' | 'closed'): 'done' | null {
  if (issueState !== 'closed') return null
  if (isTerminalStatus(currentStatus)) return null
  return 'done'
}
