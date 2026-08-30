// How a member reaches each state of the Feedback log, in one place.
// Development only.
//
// WHY THIS IS A MODULE, for the reason dialogs.mjs, account.mjs and auth.mjs
// are ones: three tools need the same presses. shoot.mjs photographs each
// state, checks.mjs measures and drives them, and contrast.mjs sweeps the text
// runs each one paints. Each of them writing its own presses is how a matrix
// and a check drift apart until one of them is quietly photographing an
// untouched page.
//
// NOTHING HERE IS FAKED. Every entry presses the control a member presses and
// types into the field they type into; what the harness varies is what the
// server does (tools/visual/stubs/queries.tsx) and which capabilities the
// member holds (tools/visual/fixtures.ts), never what is drawn.

/* ---- the rows, mirrored from tools/visual/fixtures.ts ------------------
   This is plain JavaScript and cannot import the fixtures, so the titles are
   repeated here. A drift is caught rather than tolerated: every entry below
   scopes its presses to a row BY TITLE, so a renamed fixture makes the driver
   report "the controls it drives are not on the page" rather than quietly
   pressing a different row's control. */
export const ROWS = {
  // Filed by the signed in member, unpromoted, no comments, status New. The
  // owner row: it is the only one that carries Edit and Delete for a member
  // who is not an admin.
  own: 'Timer drifts on the live screen',
  // Filed by somebody else, already promoted to issue #128, three comments,
  // one of them the signed in member's own and one of them long and edited.
  thread: 'A kit checklist on the session setup',
  // Filed by somebody else, unpromoted, one comment.
  other: 'Directions for the away venues',
  // Filed by the signed in member AND already promoted, which is the pair
  // that proves the issue link replaces the promote action rather than the
  // owner actions.
  ownPromoted: 'Show the bib colour on the group view',
}

// The comments in the `thread` row, by author, so an entry can name the one
// it is acting on rather than an index.
export const COMMENT_AUTHORS = {
  mine: 'Sam Whitfield',
  theirs: 'Priya Raghunathan',
  long: 'Marguerite Ashby-Fotheringay',
}

const TYPED_TITLE = 'Bib colours are hard to read in sunlight'
const TYPED_BODY = 'On a bright morning the yellow and the white read the same from the far touchline.'
const TYPED_COMMENT = 'Agreed, and it is worse on the older phones.'

const pause = (page) => page.waitForTimeout(250)

/* A press, a fill and a selection that report rather than throw, so a driver
   returns false and its caller records a failed entry instead of the run
   ending on a timeout. Same contract as account.mjs and auth.mjs. */
async function act(locator, run) {
  if ((await locator.count()) === 0) return false
  try {
    await run(locator.first())
    return true
  } catch {
    return false
  }
}
const click = (locator) => act(locator, (el) => el.click())
const fillIn = (locator, value) => act(locator, (el) => el.fill(value))

// One row of the log, scoped by its title. Every press below goes through
// this, so an entry cannot act on whichever row happens to be first.
export const row = (page, title) => page.locator('.fb-item').filter({ hasText: title })

// Opens a row's details, which is what mounts its comment thread.
export async function expandRow(page, title) {
  const toggle = row(page, title).locator('.fb-toggle')
  if (!(await click(toggle))) return false
  await pause(page)
  return true
}

const rowButton = (page, title, name) => row(page, title).getByRole('button', { name, exact: true })
const modal = (page) => page.locator('.modal')
const modalButton = (page, name) => modal(page).getByRole('button', { name, exact: true })
const modalField = (page, label) => modal(page).getByLabel(label, { exact: true })

// The comment row belonging to one author, inside an expanded item.
const commentOf = (page, title, author) => row(page, title).locator('.fb-comment').filter({ hasText: author })

/* ---- the proofs -------------------------------------------------------
   Two shapes recur, and both exist because the loose version of each was
   ruled out on the screens this harness already covers.

   A note is never proved by "a note is on screen". Every message on this
   screen renders through the same Note, so a proof that only asked for one
   would hold for the wrong outcome. Each names the tone, the live region
   role and the words.

   A count is never inferred from what is drawn. Three claims this screen
   makes are about a call that must NOT happen, and a browser cannot see one
   of those. */
const noteIn = (scope, tone, role, text) => async (page) =>
  page.evaluate(
    ({ scope, tone, role, text }) => {
      const notes = [...document.querySelectorAll(`${scope} .note-${tone}`)]
      return notes.some(
        (n) =>
          n.getAttribute('role') === role &&
          (n.querySelector('.note-body')?.textContent ?? '').trim().includes(text) &&
          // A glyph as well as a hue, which is what stops the state being
          // carried by colour alone.
          !!n.querySelector('svg'),
      )
    },
    { scope, tone, role, text },
  )

/* How many times a named write was made, straight from the harness stub's
   counter (tools/visual/stubs/queries.tsx).

   An ABSENT counter fails. It means the page is not running the stub this
   proof was written against, so the claim is unproved rather than true, and a
   missing global reading as zero is how a negative proof goes quietly vacuous.

   Every `calls(name, 0)` below is paired with a `calls(name, 1)` on an entry
   that does make the same call, because a zero on its own is also what a
   deleted record() line looks like. */
export const calls = (name, want) => (page) =>
  page.evaluate(
    ({ name, want }) => {
      const log = window.__feedbackCalls
      if (!log || typeof log !== 'object') return false
      return (log[name] ?? 0) === want
    },
    { name, want },
  )

/* Which feedback items have READ their comment thread. The claim "a collapsed
   row fetches nothing" is a negative in the same way, and it is the reason
   this is a list of ids rather than a count: what matters is WHICH rows
   fetched. */
export const threadsRead = (want) => (page) =>
  page.evaluate(
    (want) => {
      const log = window.__feedbackCalls
      if (!log || !Array.isArray(log.threads)) return false
      const got = [...log.threads].sort()
      return got.length === want.length && got.every((id, i) => id === [...want].sort()[i])
    },
    want,
  )

// A control that is in flight rather than merely inert: it carries its own
// gerund AND is disabled AND the write it names has actually been made. A
// disabled control on its own is what an unfilled form looks like.
const inFlight = (selectorText, name) => async (page) =>
  (await page.locator(`button:has-text("${selectorText}")[disabled]`).count()) > 0 && (await calls(name, 1)(page))

const dialogTitled = (title) => (page) =>
  page.evaluate(
    (title) => (document.querySelector('.modal h3')?.textContent ?? '').trim() === title,
    title,
  )

const noDialog = (page) => page.evaluate(() => document.querySelectorAll('.modal').length === 0)

/* ---- the entries ------------------------------------------------------
   Each entry is:

     key    the name a screenshot and a check are filed under
     caps   the capability set, when it is not the club.manage holder
     state  what the harness's reads and writes must answer with
     note   what the entry is for, which is what a reviewer reads beside the
            screenshot
     proof  a predicate for the state the entry's own name claims
     drive  the presses a member makes to reach it, where there are any
     overlay  whether a dialog is still up when the shot is taken, so the
            screenshot is of the dialog rather than a full page picture of the
            log behind it. Several entries CLOSE a dialog on the way to the
            outcome they claim, and those are page shots. */
export const FEEDBACK_FLOWS = [
  /* ---- the row itself ---- */
  {
    key: 'expanded-thread',
    note: 'an item opened: the details, a populated thread and the reply box, with the read only made for THIS row',
    proof: async (page) =>
      (await row(page, ROWS.thread).locator('.fb-comment').count()) === 3 &&
      (await threadsRead(['fb-2'])(page)),
    drive: (page) => expandRow(page, ROWS.thread),
  },
  {
    key: 'expanded-empty',
    note: 'an item with no comments: the thread says so rather than showing an empty box',
    proof: async (page) =>
      (await row(page, ROWS.own).locator('.fb-thread-empty').count()) === 1 &&
      (await row(page, ROWS.own).locator('.fb-comment').count()) === 0,
    drive: (page) => expandRow(page, ROWS.own),
  },
  {
    key: 'comments-loading',
    state: 'commentsloading',
    note: 'the thread read has not answered: a skeleton under an item that itself rendered in full',
    proof: async (page) =>
      (await row(page, ROWS.thread).locator('.skeleton-list').count()) === 1 &&
      (await page.locator('.fb-item').count()) === 5,
    drive: (page) => expandRow(page, ROWS.thread),
  },
  {
    key: 'comments-error',
    state: 'commentserror',
    note: 'the thread read failed: the error state with its retry, and the reply box still there',
    proof: async (page) =>
      (await row(page, ROWS.thread).locator('.state-error[role="alert"]').count()) === 1 &&
      (await row(page, ROWS.thread).getByLabel('Reply', { exact: true }).count()) === 1,
    drive: (page) => expandRow(page, ROWS.thread),
  },

  /* ---- the status a club.manage holder moves ---- */
  {
    key: 'status-pending',
    state: 'inflight',
    note: 'a status change in flight: the select frozen and the word beside it, announced through role="status"',
    proof: async (page) =>
      (await row(page, ROWS.own).locator('select[disabled]').count()) === 1 &&
      (await row(page, ROWS.own).locator('[role="status"]:has-text("Saving…")').count()) === 1 &&
      (await calls('setStatus', 1)(page)),
    drive: (page) => act(row(page, ROWS.own).locator('select'), (el) => el.selectOption('planned')),
  },
  {
    key: 'status-failed',
    state: 'writefails',
    note: 'a status change refused: the danger Note on the row, and the select back in the coach’s hands',
    proof: async (page) =>
      (await noteIn('.fb-item', 'danger', 'alert', 'club.manage')(page)) &&
      (await row(page, ROWS.own).locator('select[disabled]').count()) === 0 &&
      (await calls('setStatus', 1)(page)),
    drive: (page) => act(row(page, ROWS.own).locator('select'), (el) => el.selectOption('planned')),
  },
  {
    key: 'status-ok',
    note: 'a status change that stuck: the select holds the new value and no message is left behind',
    proof: async (page) =>
      page.evaluate(() => {
        const item = [...document.querySelectorAll('.fb-item')].find((el) =>
          (el.textContent ?? '').includes('Timer drifts on the live screen'),
        )
        return (
          !!item &&
          item.querySelector('select')?.value === 'planned' &&
          item.querySelectorAll('.note-danger').length === 0
        )
      }),
    drive: (page) => act(row(page, ROWS.own).locator('select'), (el) => el.selectOption('planned')),
  },

  /* ---- filing an item ---- */
  {
    key: 'create-open',
    overlay: true,
    note: 'the form as it opens: Kind, Title and Details, and Send inert because no title has been typed',
    proof: async (page) =>
      (await dialogTitled('New feedback')(page)) &&
      (await modalButton(page, 'Send feedback').isDisabled()) &&
      (await calls('insert', 0)(page)),
    drive: (page) => click(page.getByRole('button', { name: 'New feedback', exact: true })),
  },
  {
    key: 'create-short',
    overlay: true,
    note: 'a title under the 3 character minimum the check constraint enforces: Send stays inert and nothing is sent',
    proof: async (page) =>
      (await modalButton(page, 'Send feedback').isDisabled()) && (await calls('insert', 0)(page)),
    drive: async (page) => {
      if (!(await click(page.getByRole('button', { name: 'New feedback', exact: true })))) return false
      await pause(page)
      return fillIn(modalField(page, 'Title'), 'ab')
    },
  },
  {
    key: 'create-valid',
    overlay: true,
    note: 'a complete form: Send is live, and it still has not been pressed',
    proof: async (page) =>
      (await modalButton(page, 'Send feedback').isEnabled()) && (await calls('insert', 0)(page)),
    drive: async (page) => {
      if (!(await click(page.getByRole('button', { name: 'New feedback', exact: true })))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return fillIn(modalField(page, 'Details'), TYPED_BODY)
    },
  },
  {
    key: 'create-pending',
    overlay: true,
    state: 'inflight',
    note: 'the send in flight: the submit reads Sending… and is frozen',
    proof: inFlight('Sending…', 'insert'),
    drive: async (page) => {
      if (!(await click(page.getByRole('button', { name: 'New feedback', exact: true })))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Send feedback'))
    },
  },
  {
    key: 'create-failed',
    overlay: true,
    state: 'writefails',
    note: 'the send was refused: the danger Note in the dialog, with the typed text still there to retry on',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'Could not send')(page)) &&
      (await modalField(page, 'Title').inputValue()) === TYPED_TITLE,
    drive: async (page) => {
      if (!(await click(page.getByRole('button', { name: 'New feedback', exact: true })))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Send feedback'))
    },
  },
  {
    key: 'create-ok',
    note: 'the item was filed: the dialog closes and the new row is at the top of the log',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await page.locator('.fb-item').first().locator('.fb-title').textContent()) === TYPED_TITLE &&
      (await calls('insert', 1)(page)),
    drive: async (page) => {
      if (!(await click(page.getByRole('button', { name: 'New feedback', exact: true })))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Send feedback'))
    },
  },

  /* ---- editing an item the member filed ---- */
  {
    key: 'edit-open',
    overlay: true,
    note: 'the edit form prefilled from the item, with Save live because the title already passes',
    proof: async (page) =>
      (await dialogTitled('Edit feedback')(page)) &&
      (await modalField(page, 'Title').inputValue()) === ROWS.own &&
      (await modalButton(page, 'Save changes').isEnabled()),
    drive: (page) => click(rowButton(page, ROWS.own, `Edit ${ROWS.own}`)),
  },
  {
    key: 'edit-pending',
    overlay: true,
    state: 'inflight',
    note: 'the edit in flight: the submit reads Saving… and is frozen',
    proof: inFlight('Saving…', 'update'),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Edit ${ROWS.own}`)))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Save changes'))
    },
  },
  {
    key: 'edit-failed',
    overlay: true,
    state: 'writefails',
    note: 'the edit was refused: the RLS answer the hook reports, in the danger Note',
    proof: noteIn('.modal', 'danger', 'alert', 'You can only edit feedback you filed.'),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Edit ${ROWS.own}`)))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Save changes'))
    },
  },
  {
    key: 'edit-ok',
    note: 'the edit was saved: the dialog closes and the row carries the new title',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await page.locator('.fb-title').filter({ hasText: TYPED_TITLE }).count()) === 1 &&
      (await calls('update', 1)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Edit ${ROWS.own}`)))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Title'), TYPED_TITLE))) return false
      return click(modalButton(page, 'Save changes'))
    },
  },

  /* ---- deleting an item the member filed ---- */
  {
    key: 'delete-open',
    overlay: true,
    note: 'the destructive confirmation: it names the item, states the consequence, and nothing has been deleted',
    proof: async (page) =>
      (await dialogTitled('Delete feedback')(page)) &&
      (await modal(page).locator('.modal-copy').textContent()).includes("club's log") &&
      (await modal(page).locator('.btn-danger').count()) === 1 &&
      (await calls('remove', 0)(page)),
    drive: (page) => click(rowButton(page, ROWS.own, `Delete ${ROWS.own}`)),
  },
  {
    key: 'delete-pending',
    overlay: true,
    state: 'inflight',
    note: 'the delete in flight: the destructive control reads Deleting… and is frozen',
    proof: inFlight('Deleting…', 'remove'),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Delete ${ROWS.own}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },
  {
    key: 'delete-failed',
    overlay: true,
    state: 'writefails',
    note: 'the delete was refused: the danger Note, and the item still in the log behind it',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'You can only delete feedback you filed.')(page)) &&
      (await page.locator('.fb-item').count()) === 5,
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Delete ${ROWS.own}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },
  {
    key: 'delete-ok',
    note: 'the item was deleted: the dialog closes, the row is gone, and the log is one shorter',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await row(page, ROWS.own).count()) === 0 &&
      (await page.locator('.fb-item').count()) === 4 &&
      (await calls('remove', 1)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Delete ${ROWS.own}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },

  /* ---- the comment thread ---- */
  {
    key: 'single-comment',
    note: 'a row with ONE comment: the badge says comment rather than comments, and the thread that opens is that row’s',
    proof: async (page) =>
      (await row(page, ROWS.other).locator('.fb-comments').getAttribute('aria-label')) === '1 comment' &&
      (await row(page, ROWS.other).locator('.fb-comment').count()) === 1 &&
      (await threadsRead(['fb-3'])(page)),
    drive: (page) => expandRow(page, ROWS.other),
  },
  {
    key: 'comment-inert',
    note: 'the reply box empty: Post comment is inert and no comment has been posted',
    proof: async (page) =>
      (await row(page, ROWS.thread).getByRole('button', { name: 'Post comment', exact: true }).isDisabled()) &&
      (await calls('addComment', 0)(page)),
    drive: (page) => expandRow(page, ROWS.thread),
  },
  {
    key: 'comment-typed',
    note: 'a reply typed: Post comment is live, and it still has not been pressed',
    proof: async (page) =>
      (await row(page, ROWS.thread).getByRole('button', { name: 'Post comment', exact: true }).isEnabled()) &&
      (await calls('addComment', 0)(page)),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      return fillIn(row(page, ROWS.thread).getByLabel('Reply', { exact: true }), TYPED_COMMENT)
    },
  },
  {
    key: 'comment-pending',
    state: 'inflight',
    note: 'the post in flight: the control reads Posting… and is frozen',
    proof: inFlight('Posting…', 'addComment'),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await fillIn(row(page, ROWS.thread).getByLabel('Reply', { exact: true }), TYPED_COMMENT))) return false
      return click(row(page, ROWS.thread).getByRole('button', { name: 'Post comment', exact: true }))
    },
  },
  {
    key: 'comment-failed',
    state: 'writefails',
    note: 'the post was refused: the danger Note under the control, with the typed reply kept',
    proof: async (page) =>
      (await noteIn('.fb-thread', 'danger', 'alert', 'Could not post')(page)) &&
      (await row(page, ROWS.thread).getByLabel('Reply', { exact: true }).inputValue()) === TYPED_COMMENT,
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await fillIn(row(page, ROWS.thread).getByLabel('Reply', { exact: true }), TYPED_COMMENT))) return false
      return click(row(page, ROWS.thread).getByRole('button', { name: 'Post comment', exact: true }))
    },
  },
  {
    key: 'comment-ok',
    note: 'the comment was posted: it joins the thread, the box is empty again and the row badge counts four',
    proof: async (page) =>
      (await row(page, ROWS.thread).locator('.fb-comment').count()) === 4 &&
      (await row(page, ROWS.thread).getByLabel('Reply', { exact: true }).inputValue()) === '' &&
      (await row(page, ROWS.thread).locator('.fb-comments').getAttribute('aria-label')) === '4 comments' &&
      (await calls('addComment', 1)(page)),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await fillIn(row(page, ROWS.thread).getByLabel('Reply', { exact: true }), TYPED_COMMENT))) return false
      return click(row(page, ROWS.thread).getByRole('button', { name: 'Post comment', exact: true }))
    },
  },
  {
    key: 'comment-edit-open',
    overlay: true,
    note: 'editing a comment the member wrote: the body prefilled, and body only, which is what the policy allows',
    proof: async (page) =>
      (await dialogTitled('Edit comment')(page)) &&
      (await modalField(page, 'Comment').inputValue()).includes('Per team.') &&
      (await modal(page).locator('input, select').count()) === 0,
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      return click(rowButton(page, ROWS.thread, `Edit comment by ${COMMENT_AUTHORS.mine}`))
    },
  },
  {
    key: 'comment-edit-failed',
    overlay: true,
    state: 'writefails',
    note: 'the comment edit was refused: the RLS answer the hook reports, in the danger Note',
    proof: noteIn('.modal', 'danger', 'alert', 'You can only edit comments you wrote.'),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await click(rowButton(page, ROWS.thread, `Edit comment by ${COMMENT_AUTHORS.mine}`)))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Comment'), TYPED_COMMENT))) return false
      return click(modalButton(page, 'Save changes'))
    },
  },
  {
    key: 'comment-edit-ok',
    note: 'the comment edit was saved: the dialog closes and the thread carries the new text',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await row(page, ROWS.thread).locator('.fb-comment-body').filter({ hasText: TYPED_COMMENT }).count()) === 1 &&
      (await calls('editComment', 1)(page)),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await click(rowButton(page, ROWS.thread, `Edit comment by ${COMMENT_AUTHORS.mine}`)))) return false
      await pause(page)
      if (!(await fillIn(modalField(page, 'Comment'), TYPED_COMMENT))) return false
      return click(modalButton(page, 'Save changes'))
    },
  },
  {
    key: 'comment-delete-open',
    overlay: true,
    note: 'the comment delete confirmation, opened on somebody ELSE’s comment, which is the moderation case',
    proof: async (page) =>
      (await dialogTitled('Delete comment')(page)) &&
      (await modal(page).locator('.btn-danger').count()) === 1 &&
      (await calls('removeComment', 0)(page)),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      return click(rowButton(page, ROWS.thread, `Delete comment by ${COMMENT_AUTHORS.theirs}`))
    },
  },
  {
    key: 'comment-delete-pending',
    overlay: true,
    state: 'inflight',
    note: 'the comment delete in flight: Deleting… and frozen',
    proof: inFlight('Deleting…', 'removeComment'),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await click(rowButton(page, ROWS.thread, `Delete comment by ${COMMENT_AUTHORS.theirs}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },
  {
    key: 'comment-delete-failed',
    overlay: true,
    state: 'writefails',
    note: 'the comment delete was refused: the danger Note, and all three comments still in the thread',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'You can only delete comments you wrote.')(page)) &&
      (await row(page, ROWS.thread).locator('.fb-comment').count()) === 3,
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await click(rowButton(page, ROWS.thread, `Delete comment by ${COMMENT_AUTHORS.theirs}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },
  {
    key: 'comment-delete-ok',
    note: 'the comment was deleted: the dialog closes, the thread is two long and the row badge follows it',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.theirs).count()) === 0 &&
      (await row(page, ROWS.thread).locator('.fb-comment').count()) === 2 &&
      (await calls('removeComment', 1)(page)),
    drive: async (page) => {
      if (!(await expandRow(page, ROWS.thread))) return false
      if (!(await click(rowButton(page, ROWS.thread, `Delete comment by ${COMMENT_AUTHORS.theirs}`)))) return false
      await pause(page)
      return click(modalButton(page, 'Delete'))
    },
  },
  {
    key: 'comment-author-only',
    caps: 'viewer',
    note: 'a member without club.manage: edit and delete on their own comment, and nothing on anybody else’s',
    proof: async (page) =>
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.mine).getByRole('button').count()) === 2 &&
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.theirs).getByRole('button').count()) === 0 &&
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.long).getByRole('button').count()) === 0,
    drive: (page) => expandRow(page, ROWS.thread),
  },
  {
    key: 'comment-moderation',
    note: 'a club.manage holder: delete on every comment for moderation, and edit still only on their own',
    proof: async (page) =>
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.mine).getByRole('button').count()) === 2 &&
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.theirs).getByRole('button').count()) === 1 &&
      (await commentOf(page, ROWS.thread, COMMENT_AUTHORS.theirs)
        .getByRole('button', { name: /^Delete comment/ })
        .count()) === 1,
    drive: (page) => expandRow(page, ROWS.thread),
  },

  /* ---- promoting an item to a public GitHub issue ----------------------
     club.manage only, and a sensitive boundary even in a visual slice: the
     caution, the two editable fields and what is posted are what these
     entries pin. */
  {
    key: 'promote-open',
    overlay: true,
    note: 'the promote panel: the public repository caution, the prefilled title and details, and nothing posted yet',
    proof: async (page) =>
      (await dialogTitled('Promote to GitHub issue')(page)) &&
      (await noteIn('.modal', 'danger', null, 'The repository is public')(page)) &&
      (await modalField(page, 'Issue title').inputValue()) === ROWS.own &&
      (await modalField(page, 'Issue details').inputValue()).length > 0 &&
      // The two fields are the WHOLE of what the panel offers to edit, so
      // nothing else can be typed into what is posted.
      (await modal(page).locator('input, textarea, select').count()) === 2 &&
      (await calls('promote', 0)(page)),
    drive: (page) => click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)),
  },
  {
    key: 'promote-short',
    overlay: true,
    note: 'an issue title under the 3 character minimum: Create issue is inert and nothing reaches GitHub',
    proof: async (page) =>
      (await modalButton(page, 'Create issue').isDisabled()) && (await calls('promote', 0)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      return fillIn(modalField(page, 'Issue title'), 'ab')
    },
  },
  {
    key: 'promote-pending',
    overlay: true,
    state: 'inflight',
    note: 'the promotion in flight: the submit reads Creating… and is frozen',
    proof: inFlight('Creating…', 'promote'),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      return click(modalButton(page, 'Create issue'))
    },
  },
  {
    key: 'promote-failed',
    overlay: true,
    state: 'writefails',
    note: 'the promotion was refused: the danger Note, with the caution still above the fields',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'Could not create the GitHub issue')(page)) &&
      (await noteIn('.modal', 'danger', null, 'The repository is public')(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      return click(modalButton(page, 'Create issue'))
    },
  },
  {
    key: 'promote-ok',
    overlay: true,
    note: 'the issue was created: the success Note, the returned number as a link, and one call made',
    proof: async (page) =>
      (await noteIn('.modal', 'success', 'status', 'The issue was created.')(page)) &&
      (await modal(page).locator('.fb-issue-link a').textContent()).includes('Issue #214') &&
      (await modal(page).locator('.fb-issue-link a').getAttribute('href')) ===
        'https://github.com/sense360store/OTJ/issues/214' &&
      (await calls('promote', 1)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      return click(modalButton(page, 'Create issue'))
    },
  },
  {
    key: 'promote-warning',
    overlay: true,
    state: 'promotewarning',
    note: 'the issue was created AND the write back did not settle: the success beside a warning, which is neither outcome alone',
    proof: async (page) =>
      (await noteIn('.modal', 'success', 'status', 'The issue was created.')(page)) &&
      (await noteIn('.modal', 'warning', 'alert', 'could not be updated with its number')(page)),
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      return click(modalButton(page, 'Create issue'))
    },
  },
  {
    key: 'promote-done',
    note: 'the promoted row afterwards: the issue link has replaced the promote action, and the item is promoted once',
    proof: async (page) =>
      (await rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`).count()) === 0 &&
      (await row(page, ROWS.own).getByRole('link', { name: 'GitHub issue #214' }).count()) === 1,
    drive: async (page) => {
      if (!(await click(rowButton(page, ROWS.own, `Promote ${ROWS.own} to a GitHub issue`)))) return false
      await pause(page)
      if (!(await click(modalButton(page, 'Create issue')))) return false
      await pause(page)
      return click(modalButton(page, 'Done'))
    },
  },
]

/* ---- what a capability set is offered, with nothing driven -------------
   These claim what is ON the page for a member rather than what a press
   does, so they carry no `drive`. They are the role matrix: the club.manage
   holder, an ordinary member who filed one of the items, and the lowest
   capability member the product has. */
export const FEEDBACK_ROLES = [
  {
    key: 'role-manager',
    note: 'a club.manage holder: a status select on every row, Promote on the unpromoted ones, and the admin refresh fired once',
    proof: async (page) =>
      (await page.locator('.fb-item select').count()) === 5 &&
      (await page.getByRole('button', { name: /^Promote .* to a GitHub issue$/ }).count()) === 3 &&
      (await page.getByRole('link', { name: /^GitHub issue #/ }).count()) === 2 &&
      (await calls('refreshFromGithub', 1)(page)),
  },
  {
    key: 'role-member',
    caps: 'viewer',
    note: 'an ordinary member: the status as a read only badge, no promote anywhere, edit and delete on their own two rows only, and the admin refresh never fired',
    proof: async (page) =>
      (await page.locator('.fb-item select').count()) === 0 &&
      // Ten badges in the ROW, not merely ten in the meta line: a kind and a
      // status each, with the status rendered exactly once. Scoping this to
      // .fb-meta hid a duplicate status badge in the action cluster.
      (await page.locator('.fb-item .badge').count()) === 10 &&
      (await page.locator('.fb-meta .badge').count()) === 10 &&
      (await page.getByRole('button', { name: /Promote/ }).count()) === 0 &&
      (await page.getByRole('button', { name: /^Edit / }).count()) === 2 &&
      (await page.getByRole('button', { name: /^Delete / }).count()) === 2 &&
      // The issue link stays club wide: a member without club.manage cannot
      // promote and can still follow what was promoted.
      (await page.getByRole('link', { name: /^GitHub issue #/ }).count()) === 2 &&
      (await calls('refreshFromGithub', 0)(page)),
  },
  {
    key: 'role-parent',
    caps: 'parent',
    note: 'the lowest capability member the product has: the log reads in full and New feedback is offered, which is what the RLS allows',
    proof: async (page) =>
      (await page.getByRole('button', { name: 'New feedback', exact: true }).count()) === 1 &&
      (await page.locator('.fb-item').count()) === 5 &&
      (await page.locator('.fb-item select').count()) === 0 &&
      (await page.getByRole('button', { name: /Promote/ }).count()) === 0 &&
      (await calls('refreshFromGithub', 0)(page)),
  },
]

// Every entry the tools drive, in one list, so a tool cannot cover the
// dialogs and quietly skip the role matrix.
export const FEEDBACK_ENTRIES = [...FEEDBACK_FLOWS, ...FEEDBACK_ROLES]

// The query string a feedback entry's page opens on.
export function queryForFeedback(entry, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  const q = new URLSearchParams({ screen: 'feedback', caps: entry.caps ?? 'coach', ...clean })
  if (entry.state && entry.state !== 'default') q.set('state', entry.state)
  return q
}

export const urlForFeedback = (base, entry, extra = {}) => `${base}/?${queryForFeedback(entry, extra)}`

/* Drives an entry and proves the state its name claims. Returns the reason it
   failed, or null on success.

   The proof is not decoration. Every entry files a screenshot or a
   measurement under a name that asserts an outcome, and a press that quietly
   no-ops leaves an untouched page under that name, which reads as evidence. */
export async function runFeedbackFlow(page, entry) {
  if (entry.drive && !(await entry.drive(page))) return 'the controls it drives are not on the page'
  await page.waitForTimeout(350)
  if (!entry.proof) return `the entry claims "${entry.note}" and nothing checks it`
  const held = await entry.proof(page).catch(() => false)
  return held ? null : 'it was driven, but the state its name claims never held'
}
