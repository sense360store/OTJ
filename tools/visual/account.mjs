// How a coach reaches each state of the Account screen, in one place.
// Development only.
//
// WHY THIS IS A MODULE, for the reason dialogs.mjs is one: three tools need
// the same presses. shoot.mjs photographs each outcome, checks.mjs measures
// and drives them, and contrast.mjs sweeps the text runs the outcome notes
// paint. Each of them writing its own presses is how a matrix and a check
// drift apart until one of them is quietly photographing an untouched form.
//
// Nothing here is faked. Every entry types into the fields a coach types into
// and presses the control a coach presses; what the harness varies is what the
// server does (tools/visual/fixtures.ts), never what is drawn. The two write
// phases are the SHARED `inflight` and `writefails`, which mean here exactly
// what they mean on the register's dialogs, so which write is driven is
// decided by the press rather than by a state per control.

// Kept in step with tools/visual/fixtures.ts by value. Both are invented and
// the address is .invalid, which can never resolve. A drift is caught rather
// than tolerated: the entry that types this is proved by the refusal that only
// appears when the typed value matched the signed in address.
export const ACCOUNT_EMAIL = 'coach@example.invalid'
const NEW_EMAIL = 'new.coach@example.invalid'
const NEW_NAME = 'Sam Whitfield-Ashby'
const PASSWORD = 'a-long-enough-passphrase'

// A one pixel PNG, so the upload path carries a real image file rather than a
// renamed text buffer: useUploadAvatar refuses anything that is not an image
// in the product, and a fixture that could not pass that test would prove
// nothing about the control that opens it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const pause = (page) => page.waitForTimeout(200)

// A press, a fill and a selection that report rather than throw, so a driver
// returns false and its caller records a failed entry instead of the run
// ending on a timeout.
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
const fill = (page, label, value) => act(page.getByLabel(label, { exact: true }), (el) => el.fill(value))
const choose = (page, label, value) => act(page.getByLabel(label, { exact: true }), (el) => el.selectOption(value))
const press = (page, name) => click(page.getByRole('button', { name, exact: true }))

// The visible photo action, whichever of its two labels the profile puts on
// it. A coach presses one control; which word it carries is what having a
// photo decides.
export const photoButton = (page) => page.getByRole('button', { name: /^(Add|Change) photo$/ })

/* Hands the file picker an image THROUGH the visible button, rather than
   reaching the hidden input directly. That is the accessibility claim this
   screen makes (the input is never a control on its own; the button is), so
   it is the claim the driver exercises: the press must open a file chooser,
   and the chooser must accept the file. A driver that called setInputFiles on
   the input would pass with the button removed entirely. */
export async function addPhoto(page) {
  const button = photoButton(page)
  if ((await button.count()) === 0) return false
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      button.first().click(),
    ])
    await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG })
    return true
  } catch {
    return false
  }
}

/* ---- the entries ------------------------------------------------------
   Each entry is:

     key    the name a screenshot and a check are filed under
     state  what the harness's reads and writes must answer with
     note   what the entry is for, which is what a reviewer reads beside the
            screenshot
     proof  a selector, or a predicate for a claim no selector can make, for
            the state the entry's name claims
     drive  the presses a coach makes to reach it

   `proof` is never "a note is on screen": every message on this page renders
   through the same Note, so a proof that only asked for one would hold for
   the wrong outcome. Each names its own words. */
export const ACCOUNT_FLOWS = [
  /* ---- the photo ---- */
  {
    key: 'upload-pending',
    state: 'inflight',
    note: 'the upload in flight: the button reads Uploading… and both photo actions are frozen',
    proof: 'button:has-text("Uploading…")[disabled]',
    drive: addPhoto,
  },
  {
    key: 'upload-ok',
    state: 'default',
    note: 'the upload succeeded: the photo replaces the initials and the action becomes Change photo',
    // Three claims, because the note alone would hold with a screen that had
    // not moved: the confirmation, the photo, and the relabelled action.
    proof: async (page) =>
      page.evaluate(
        () =>
          !!document.querySelector('.account-photo-block .note-success') &&
          !!document.querySelector('.account-photo img.avatar') &&
          !!document.querySelector('.account-photo-acts button:nth-of-type(2)'),
      ),
    drive: addPhoto,
  },
  {
    key: 'upload-failed',
    state: 'writefails',
    note: 'the upload was refused: the danger Note carries the reason and the photo is unchanged',
    proof: '.account-photo-block .note-danger[role="alert"]:has-text("Could not upload")',
    drive: addPhoto,
  },
  {
    key: 'remove-pending',
    state: 'photoinflight',
    note: 'the removal in flight: Removing… and both photo actions frozen',
    proof: 'button:has-text("Removing…")[disabled]',
    drive: (page) => press(page, 'Remove photo'),
  },
  {
    key: 'remove-ok',
    state: 'photo',
    note: 'the removal succeeded: the initials are back and Remove photo is gone with the photo',
    proof: async (page) =>
      page.evaluate(
        () =>
          !!document.querySelector('.account-photo-block .note-success') &&
          !document.querySelector('.account-photo img.avatar') &&
          ![...document.querySelectorAll('.account-photo-acts button')].some((b) =>
            (b.textContent || '').includes('Remove photo'),
          ),
      ),
    drive: (page) => press(page, 'Remove photo'),
  },
  {
    key: 'remove-failed',
    state: 'photofails',
    note: 'the removal was refused: the danger Note, and the photo still there',
    proof: async (page) =>
      page.evaluate(
        () =>
          !!document.querySelector('.account-photo-block .note-danger[role="alert"]') &&
          !!document.querySelector('.account-photo img.avatar'),
      ),
    drive: (page) => press(page, 'Remove photo'),
  },

  /* ---- the name ---- */
  {
    key: 'name-changed',
    state: 'default',
    note: 'Save armed: it is inert until the typed name differs from the stored one',
    proof: async (page) => page.getByRole('button', { name: 'Save', exact: true }).isEnabled(),
    drive: (page) => fill(page, 'Full name', NEW_NAME),
  },
  {
    key: 'name-pending',
    state: 'inflight',
    note: 'the save in flight: the button reads Saving… and is frozen',
    proof: 'button:has-text("Saving…")[disabled]',
    drive: async (page) => {
      if (!(await fill(page, 'Full name', NEW_NAME))) return false
      await pause(page)
      return press(page, 'Save')
    },
  },
  {
    key: 'name-ok',
    state: 'default',
    note: 'the save succeeded: the confirmation, the new name everywhere, and Save inert again',
    proof: async (page) =>
      page.evaluate(
        (name) =>
          !!document.querySelector('.account-name-block .note-success') &&
          document.querySelector('#full-name')?.value === name &&
          (document.querySelector('.coach-chip b')?.textContent ?? '') === name,
        NEW_NAME,
      ),
    drive: async (page) => {
      if (!(await fill(page, 'Full name', NEW_NAME))) return false
      await pause(page)
      return press(page, 'Save')
    },
  },
  {
    key: 'name-failed',
    state: 'writefails',
    note: 'the save was refused: the danger Note, and the typed name kept so it can be retried',
    proof: '.account-name-block .note-danger[role="alert"]:has-text("Could not save")',
    drive: async (page) => {
      if (!(await fill(page, 'Full name', NEW_NAME))) return false
      await pause(page)
      return press(page, 'Save')
    },
  },

  /* ---- the default team ---- */
  {
    key: 'team-pending',
    state: 'inflight',
    note: 'the team write in flight: the select is frozen while it settles',
    proof: async (page) => page.getByLabel('Default team', { exact: true }).isDisabled(),
    drive: (page) => choose(page, 'Default team', 'trojans'),
  },
  {
    key: 'team-ok',
    state: 'default',
    note: 'the team write succeeded: the confirmation, and the select holding the new team',
    proof: async (page) =>
      page.evaluate(
        () =>
          !!document.querySelector('.account-team-block .note-success') &&
          document.querySelector('#default-team')?.value === 'trojans',
      ),
    drive: (page) => choose(page, 'Default team', 'trojans'),
  },
  {
    key: 'team-failed',
    state: 'writefails',
    note: 'the team write was refused: the danger Note beside the control',
    proof: '.account-team-block .note-danger[role="alert"]:has-text("Could not save")',
    drive: (page) => choose(page, 'Default team', 'trojans'),
  },

  /* ---- the password ---- */
  {
    key: 'password-mismatch',
    state: 'default',
    note: 'the client side refusal: two different values never reach the auth client',
    proof: '.note-danger[role="alert"]:has-text("The passwords do not match.")',
    drive: async (page) => {
      if (!(await fill(page, 'New password', PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', PASSWORD + '-typo'))) return false
      return press(page, 'Change password')
    },
  },
  {
    key: 'password-pending',
    state: 'inflight',
    note: 'the password change in flight: the button reads Saving… and is frozen',
    proof: 'button:has-text("Saving…")[disabled]',
    drive: async (page) => {
      if (!(await fill(page, 'New password', PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', PASSWORD))) return false
      return press(page, 'Change password')
    },
  },
  {
    key: 'password-ok',
    state: 'default',
    note: 'the password changed: the confirmation, and both fields emptied',
    proof: async (page) =>
      page.evaluate(
        () =>
          !!document.querySelector('.note-success') &&
          document.querySelector('#new-password')?.value === '' &&
          document.querySelector('#confirm-password')?.value === '',
      ),
    drive: async (page) => {
      if (!(await fill(page, 'New password', PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', PASSWORD))) return false
      return press(page, 'Change password')
    },
  },
  {
    key: 'password-failed',
    state: 'writefails',
    note: 'the auth client refused it: its own message, in the danger Note',
    proof: '.note-danger[role="alert"]:has-text("Password should be at least")',
    drive: async (page) => {
      if (!(await fill(page, 'New password', PASSWORD))) return false
      if (!(await fill(page, 'Confirm password', PASSWORD))) return false
      return press(page, 'Change password')
    },
  },

  /* ---- the sign in email ---- */
  {
    key: 'email-same',
    state: 'default',
    note: 'the client side refusal: the address already in use never reaches the auth client',
    proof: '.note-danger[role="alert"]:has-text("already your sign in email")',
    drive: async (page) => {
      if (!(await fill(page, 'New email', ACCOUNT_EMAIL))) return false
      return press(page, 'Change email')
    },
  },
  {
    key: 'email-pending',
    state: 'inflight',
    note: 'the email change in flight: the button reads Sending… and is frozen',
    proof: 'button:has-text("Sending…")[disabled]',
    drive: async (page) => {
      if (!(await fill(page, 'New email', NEW_EMAIL))) return false
      return press(page, 'Change email')
    },
  },
  {
    key: 'email-ok',
    state: 'default',
    note: 'the confirmation email is on its way: the success Note names the address, and the field is empty',
    proof: async (page) =>
      page.evaluate(
        (address) =>
          (document.querySelector('.note-success')?.textContent ?? '').includes(address) &&
          document.querySelector('#new-email')?.value === '',
        NEW_EMAIL,
      ),
    drive: async (page) => {
      if (!(await fill(page, 'New email', NEW_EMAIL))) return false
      return press(page, 'Change email')
    },
  },
  {
    key: 'email-failed',
    state: 'writefails',
    note: 'the auth client refused it: its own message, in the danger Note',
    proof: '.note-danger[role="alert"]:has-text("Unable to validate email address")',
    drive: async (page) => {
      if (!(await fill(page, 'New email', NEW_EMAIL))) return false
      return press(page, 'Change email')
    },
  },
]

// The query string a flow's page opens on.
export function queryForFlow(f, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  const q = new URLSearchParams({ screen: 'account', caps: 'coach', ...clean })
  if (f.state !== 'default') q.set('state', f.state)
  return q
}

// Drives the flow and proves the state its name claims. Returns the reason it
// failed, or null on success.
//
// The proof is not decoration. Every entry files a screenshot or a
// measurement under a name that asserts an outcome, and a press that quietly
// no-ops leaves an untouched form under that name, which reads as evidence.
export async function runFlow(page, f) {
  if (!(await f.drive(page))) return 'the controls it drives are not on the page'
  await page.waitForTimeout(300)
  if (!f.proof) return `the entry claims "${f.note}" and nothing checks it`
  const held =
    typeof f.proof === 'function'
      ? await f.proof(page).catch(() => false)
      : await page.waitForSelector(f.proof, { state: 'visible', timeout: 3000 }).then(
          () => true,
          () => false,
        )
  return held ? null : `it was driven, but ${typeof f.proof === 'function' ? 'the state predicate' : f.proof} never held`
}
