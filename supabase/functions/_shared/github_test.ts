// Tests for the GitHub issue promotion core, the pure logic behind the
// feedback-to-github Edge Function. These are hermetic (no network, no
// database): they pin the parts that can be wrong quietly, the input
// validation, the issue payload shape, the de-dupe guard that stops a second
// promotion of the same item, the status move, and the response readers.
// Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/github_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  alreadyPromoted,
  buildIssuePayload,
  GITHUB_ISSUE_LABEL,
  githubErrorMessage,
  ISSUE_BODY_MAX,
  ISSUE_TITLE_MAX,
  promotedStatus,
  readIssueResponse,
  readPromoteInput,
  shouldRetryWithoutTypeLabel,
  typeLabelForKind,
} from './github.ts'

// ---- readPromoteInput ------------------------------------------------------

Deno.test('readPromoteInput trims and accepts a valid request', () => {
  const out = readPromoteInput({ feedback_id: '  f1  ', title: '  Timer drifts  ', body: '  detail  ' })
  assertEquals(out, { feedbackId: 'f1', title: 'Timer drifts', body: 'detail' })
})

Deno.test('readPromoteInput accepts an empty body', () => {
  const out = readPromoteInput({ feedback_id: 'f1', title: 'A title' })
  assertEquals('error' in out ? out.error : out.body, '')
})

Deno.test('readPromoteInput refuses a missing feedback id', () => {
  const out = readPromoteInput({ title: 'A title' })
  assert('error' in out)
})

Deno.test('readPromoteInput refuses a too short title', () => {
  const out = readPromoteInput({ feedback_id: 'f1', title: 'ab' })
  assert('error' in out)
})

Deno.test('readPromoteInput refuses an over long title', () => {
  const out = readPromoteInput({ feedback_id: 'f1', title: 'x'.repeat(ISSUE_TITLE_MAX + 1) })
  assert('error' in out)
})

Deno.test('readPromoteInput refuses an over long body', () => {
  const out = readPromoteInput({ feedback_id: 'f1', title: 'A title', body: 'x'.repeat(ISSUE_BODY_MAX + 1) })
  assert('error' in out)
})

Deno.test('readPromoteInput refuses a non object body', () => {
  assert('error' in readPromoteInput(null))
  assert('error' in readPromoteInput('nope'))
})

// ---- buildIssuePayload -----------------------------------------------------

Deno.test('buildIssuePayload passes the title and body through unchanged and adds the provenance label', () => {
  const payload = buildIssuePayload({ feedbackId: 'f1', title: 'Timer drifts', body: 'Clock reads fast.' })
  assertEquals(payload, { title: 'Timer drifts', body: 'Clock reads fast.', labels: [GITHUB_ISSUE_LABEL] })
})

Deno.test('buildIssuePayload adds the enhancement label for a feature kind', () => {
  const payload = buildIssuePayload({ feedbackId: 'f1', title: 'A title', body: '' }, 'feature')
  assertEquals(payload.labels, [GITHUB_ISSUE_LABEL, 'enhancement'])
})

Deno.test('buildIssuePayload adds the bug label for a bug kind', () => {
  const payload = buildIssuePayload({ feedbackId: 'f1', title: 'A title', body: '' }, 'bug')
  assertEquals(payload.labels, [GITHUB_ISSUE_LABEL, 'bug'])
})

Deno.test('buildIssuePayload adds no type label for a general kind', () => {
  const payload = buildIssuePayload({ feedbackId: 'f1', title: 'A title', body: '' }, 'general')
  assertEquals(payload.labels, [GITHUB_ISSUE_LABEL])
})

// ---- typeLabelForKind: the kind to label mapping ---------------------------

Deno.test('typeLabelForKind maps feature to enhancement, bug to bug, general to none', () => {
  assertEquals(typeLabelForKind('feature'), 'enhancement')
  assertEquals(typeLabelForKind('bug'), 'bug')
  assertEquals(typeLabelForKind('general'), null)
})

Deno.test('typeLabelForKind maps an unknown or missing kind to no label', () => {
  assertEquals(typeLabelForKind('whatever'), null)
  assertEquals(typeLabelForKind(null), null)
  assertEquals(typeLabelForKind(undefined), null)
})

// ---- shouldRetryWithoutTypeLabel: the best effort degrade ------------------
// A missing type label must never block the promotion: a 422 with a type label
// in play degrades to the provenance label alone, so the issue is still
// created. Every other failure, and any failure with no type label sent, is a
// real one and is not retried.

Deno.test('shouldRetryWithoutTypeLabel retries a 422 only when a type label was sent', () => {
  assert(shouldRetryWithoutTypeLabel(422, true))
  assert(!shouldRetryWithoutTypeLabel(422, false))
})

Deno.test('shouldRetryWithoutTypeLabel does not retry other statuses', () => {
  assert(!shouldRetryWithoutTypeLabel(401, true))
  assert(!shouldRetryWithoutTypeLabel(404, true))
  assert(!shouldRetryWithoutTypeLabel(500, true))
})

Deno.test('the degrade target payload carries the provenance label alone', () => {
  // The function builds this when a type label would block the create, so the
  // issue is still created without the type label.
  const payload = buildIssuePayload({ feedbackId: 'f1', title: 'A title', body: '' }, null)
  assertEquals(payload.labels, [GITHUB_ISSUE_LABEL])
})

// ---- alreadyPromoted: the de-dupe guard ------------------------------------

Deno.test('alreadyPromoted is true once an issue number is recorded', () => {
  assert(alreadyPromoted({ github_issue_number: 42 }))
})

Deno.test('alreadyPromoted is false for an unpromoted item', () => {
  assert(!alreadyPromoted({ github_issue_number: null }))
  assert(!alreadyPromoted({ github_issue_number: 0 }))
})

// ---- promotedStatus --------------------------------------------------------

Deno.test('promotedStatus moves a new or in progress item to planned', () => {
  assertEquals(promotedStatus('new'), 'planned')
  assertEquals(promotedStatus('in_progress'), 'planned')
})

Deno.test('promotedStatus leaves a terminal or already planned item alone', () => {
  assertEquals(promotedStatus('done'), null)
  assertEquals(promotedStatus('declined'), null)
  assertEquals(promotedStatus('planned'), null)
})

// ---- readIssueResponse -----------------------------------------------------

Deno.test('readIssueResponse reads the number and url from a created issue', () => {
  const out = readIssueResponse({ number: 7, html_url: 'https://github.com/sense360store/OTJ/issues/7', extra: 1 })
  assertEquals(out, { number: 7, url: 'https://github.com/sense360store/OTJ/issues/7' })
})

Deno.test('readIssueResponse rejects a missing or mistyped field', () => {
  assertEquals(readIssueResponse(null), null)
  assertEquals(readIssueResponse({ number: 7 }), null)
  assertEquals(readIssueResponse({ html_url: 'https://x' }), null)
  assertEquals(readIssueResponse({ number: 0, html_url: 'https://x' }), null)
  assertEquals(readIssueResponse({ number: '7', html_url: 'https://x' }), null)
})

// ---- githubErrorMessage ----------------------------------------------------

Deno.test('githubErrorMessage maps the common failures to plain text', () => {
  assert(githubErrorMessage(401).includes('GITHUB_TOKEN'))
  assert(githubErrorMessage(403).includes('GITHUB_TOKEN'))
  assert(githubErrorMessage(404).includes('repository'))
  assert(githubErrorMessage(429).includes('rate'))
  assert(githubErrorMessage(500).includes('500'))
})
