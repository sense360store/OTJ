// How a coach reaches each of the Registered players dialogs, in one place.
// Development only.
//
// WHY THIS IS A MODULE. Three tools need the same eleven dialogs: shoot.mjs
// photographs them, checks.mjs measures and drives them, and contrast.mjs
// sweeps every text run inside them. Each of them writing its own presses is
// how a matrix and a check drift apart until one of them is quietly opening
// something else. So the drive lives here, and every entry names both the
// state the harness must answer with and the title the dialog must show, so
// an entry that opens the wrong thing FAILS rather than being photographed.
//
// Nothing here fakes a dialog. Each entry presses the controls a coach
// presses, on the real page, and the extra states (an invalid value, a typed
// confirmation, a chosen file, a write in flight) are reached the same way.

// The register rows the drivers act on. Kept in step with tools/visual/fixtures.ts
// by name; both are invented, and no real child appears in either.
export const DIALOG_PLAYER = 'Aria Bexley-Thornton'
export const WITHDRAWN_PLAYER = 'Georgie Villiers'

// The row a name is in, in whichever of the two layouts the width renders.
// Both are in the markup at every width and one of them is display: none, so
// without :visible a comma list resolves to the first match in DOM order,
// which is always the table row.
const rowSel = (name) =>
  `table.reg-table tbody tr:has-text("${name}"):visible, .player-card:has-text("${name}"):visible`

const pause = (page) => page.waitForTimeout(150)

// A press that reports rather than throws, so a driver returns false and its
// caller records a failed entry instead of the run ending on a timeout.
async function click(locator) {
  if ((await locator.count()) === 0) return false
  try {
    await locator.first().click()
    return true
  } catch {
    return false
  }
}

// The page header's own actions. "Add player" is a button in the slot; the six
// lower frequency ones are behind More actions, which is named EXACTLY because
// every row's trigger is "More actions for <child>".
export async function headerAction(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true })
  if (await direct.count()) return click(direct)
  if (!(await click(page.getByRole('button', { name: 'More actions', exact: true })))) return false
  await pause(page)
  return click(page.locator('.players-more .menu-list').getByRole('button', { name: label, exact: true }))
}

// The row's own overflow trigger. The two layouts name it differently, which
// is a real difference rather than an inconsistency to paper over: the table
// row already shows Edit and History, so its menu holds MORE actions, and the
// card holds all of them. A driver that knew only the table's name found
// nothing on a phone and reported every row dialog as unreachable.
const rowMenuName = (name) => new RegExp(`^(More )?[Aa]ctions for ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

// A row level action, wherever the layout puts it. Above 900px Edit and
// History are their own buttons in the row; at and below it the card puts
// every action in that row's overflow. Scoped to the named row, because
// otherwise "Edit" matches every row and resolves to the first.
export async function rowAction(page, name, label) {
  const row = page.locator(rowSel(name)).first()
  const direct = row.getByRole('button', { name: label, exact: true })
  if (await direct.count()) return click(direct)
  if (!(await click(row.getByRole('button', { name: rowMenuName(name) })))) return false
  await pause(page)
  return click(row.getByRole('button', { name: label, exact: true }))
}

// Opens a row's overflow and leaves it open, which is the surface whose item
// height this slice brings to 44px.
export async function openRowMenu(page, name) {
  const row = page.locator(rowSel(name)).first()
  return click(row.getByRole('button', { name: rowMenuName(name) }))
}

// The control a row action's dialog will return focus to, which is NOT always
// the last control the driver pressed: the overflow closes and focuses its own
// TRIGGER before the action opens the dialog, so the trigger is what Modal
// captures as its opener and the menu item, which has unmounted by then, is
// not. The choice is the same one rowAction makes, so the two cannot disagree
// about which control that is.
export async function rowOpener(page, name, label) {
  const row = page.locator(rowSel(name)).first()
  const direct = row.getByRole('button', { name: label, exact: true })
  return (await direct.count()) ? direct : row.getByRole('button', { name: rowMenuName(name) })
}

// And the header's, which is the trigger itself for a direct action and the
// More actions trigger for anything in the overflow.
export async function headerOpener(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true })
  return (await direct.count()) ? direct : page.getByRole('button', { name: 'More actions', exact: true })
}

const inDialog = (page) => page.locator('.modal')

async function fillField(page, label, value) {
  const field = inDialog(page).getByLabel(label)
  if ((await field.count()) === 0) return false
  await field.first().fill(value)
  return true
}

// Named pressInDialog rather than confirm, which is a browser global and
// would read as one at a glance.
async function pressInDialog(page, name) {
  return click(inDialog(page).getByRole('button', { name, exact: true }))
}

// Hands the file input a spreadsheet. readImportFile parses it in the page, so
// the preview below is the screen's own classification of these rows rather
// than a drawn list. setInputFiles reaches the input through the DOM, which is
// how it works on a visually hidden control.
//
// `settles` is what the parse must produce, and it is waited for rather than
// assumed: the input accepting a file says nothing about whether the file
// parsed, and a driver that returns true on the handover files a screenshot
// of an untouched dropzone under a name claiming a preview.
async function chooseFile(page, name, body, settles) {
  const input = page.locator('.ip-dropzone input[type="file"]')
  if ((await input.count()) === 0) return false
  await input.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(body, 'utf8') })
  return page.waitForSelector(settles, { state: 'visible', timeout: 5000 }).then(
    () => true,
    () => false,
  )
}

// Every needs-your-choice row must carry a decision before Import arms, so a
// driver that wants the confirm resolves them all the way a coach would.
async function skipEveryChoice(page) {
  const skips = inDialog(page).getByRole('button', { name: 'Skip', exact: true })
  const n = await skips.count()
  for (let i = 0; i < n; i++) await skips.nth(i).click()
  await pause(page)
  return true
}

// The spreadsheets the import dialog parses for real. They live here rather
// than in tools/visual/fixtures.ts because a Playwright tool is plain
// JavaScript and cannot import that TypeScript module, and one copy in the
// file that uses them beats two that can disagree.
//
// The header row is the TEMPLATE's own, from src/lib/playersTemplate.ts. The
// first version of this file invented a shorter one, every row was rejected,
// and the preview never rendered; chooseFile returned true because the input
// had accepted a file, and three screenshots were filed under names claiming
// a preview. That is why chooseFile now proves the parse landed rather than
// reporting that a file was handed over.
//
// The rows are chosen for the shapes the preview has to render: one matching
// a registered child by name (needs your choice, and its two inline
// controls), three ordinary additions, one naming a team the club does not
// have (a warning), and one with an out of range shirt (invalid).
const CSV_HEADER = 'Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date'
const csvRow = (name, team, shirt) => `,${name},,${team},Registered,${shirt},`
export const IMPORT_CSV = [
  CSV_HEADER,
  csvRow(DIALOG_PLAYER, 'Titans', '4'),
  csvRow('Sample Child 1', 'Titans', '31'),
  csvRow('Sample Child 2', 'Trojans', '32'),
  csvRow('Sample Child 3', 'Gladiators', ''),
  csvRow('Sample Child 4', 'Vikings', '33'),
  csvRow('Sample Child 5', 'Titans', '900'),
  '',
].join('\n')
export const IMPORT_CSV_LONG = [
  CSV_HEADER,
  ...Array.from({ length: 60 }, (_, i) =>
    csvRow(`Sample Child ${i + 10}`, i % 2 === 0 ? 'Titans' : 'Trojans', String((i % 60) + 30)),
  ),
  '',
].join('\n')

/* ---- the entries ------------------------------------------------------
   Each entry is:

     key    the name a screenshot and a check are filed under
     title  the dialog's <h3>, checked rather than assumed, so an entry that
            opens the wrong dialog is a failure
     state  what the harness's reads and writes must answer with
     at     the address the register opens on, when it differs from the state
     note   what the entry is for, which is what a reviewer reads beside the
            screenshot
     proof  a selector, or a predicate for a claim no selector can make, for
            the STATE the entry's name claims; see openDialog
     opener the control Modal captures as this dialog's opener, on the entries
            whose focus contract is checked. Resolved rather than hardcoded,
            because the two layouts put a row action in two different places
     open   the presses a coach makes to reach it */
export const DIALOGS = [
  /* PlayerFormModal */
  {
    key: 'add',
    title: 'Add player',
    state: 'default',
    note: 'normal, and its own disabled case: Add is inert until a name is typed',
    // The disabled half of that note, proved: Add is inert with no name.
    proof: async (page) => inDialog(page).getByRole('button', { name: 'Add player', exact: true }).isDisabled(),
    opener: (page) => headerOpener(page, 'Add player'),
    open: (page) => headerAction(page, 'Add player'),
  },
  {
    key: 'add-invalid',
    title: 'Add player',
    state: 'default',
    note: 'validation: an unparseable shirt number sets the border, the message and aria-invalid',
    proof: '.modal .field-error',
    open: async (page) => {
      if (!(await headerAction(page, 'Add player'))) return false
      await pause(page)
      return fillField(page, 'Shirt number', '4a')
    },
  },
  {
    key: 'add-saving',
    title: 'Add player',
    state: 'inflight',
    note: 'in flight: the gerund label, every control frozen, and no dismissal route',
    proof: '.modal button:has-text("Saving…")',
    open: async (page) => {
      if (!(await headerAction(page, 'Add player'))) return false
      await pause(page)
      if (!(await fillField(page, 'Name', 'Robin Sample'))) return false
      return pressInDialog(page, 'Add player')
    },
  },
  {
    key: 'add-failed',
    title: 'Add player',
    state: 'writefails',
    note: 'a refused write: the inline ActionError with a retry, and the typed values kept',
    proof: '.modal [role="alert"]',
    open: async (page) => {
      if (!(await headerAction(page, 'Add player'))) return false
      await pause(page)
      if (!(await fillField(page, 'Name', 'Robin Sample'))) return false
      return pressInDialog(page, 'Add player')
    },
  },
  {
    key: 'edit',
    title: 'Edit player',
    state: 'default',
    note: 'normal: name and shirt only, since team and status have their own actions',
    proof: '.modal #pf-name',
    open: (page) => rowAction(page, DIALOG_PLAYER, 'Edit'),
  },

  /* PlayerActionModals */
  {
    key: 'move',
    title: 'Move team',
    state: 'default',
    note: 'normal, and its own ineligible case: Move is inert while the team is unchanged',
    proof: async (page) => inDialog(page).getByRole('button', { name: 'Move', exact: true }).isDisabled(),
    opener: (page) => rowOpener(page, DIALOG_PLAYER, 'Move team'),
    open: (page) => rowAction(page, DIALOG_PLAYER, 'Move team'),
  },
  {
    key: 'withdraw',
    title: 'Withdraw player',
    state: 'default',
    note: 'the reversible removal: a danger button whose label carries the word',
    proof: '.modal .btn-danger',
    open: (page) => rowAction(page, DIALOG_PLAYER, 'Withdraw'),
  },
  {
    key: 'restore',
    title: 'Restore player',
    state: 'withdrawn',
    note: 'the radio pair, on the one row that offers it',
    proof: '.modal .choice-group input[type="radio"]',
    open: (page) => rowAction(page, WITHDRAWN_PLAYER, 'Restore'),
  },
  {
    key: 'delete',
    title: 'Delete player permanently',
    state: 'default',
    note: 'destructive, unarmed: the confirm is inert until the name is typed',
    proof: async (page) =>
      inDialog(page).getByRole('button', { name: 'Delete permanently', exact: true }).isDisabled(),
    open: (page) => rowAction(page, DIALOG_PLAYER, 'Delete permanently'),
  },
  {
    key: 'delete-armed',
    title: 'Delete player permanently',
    state: 'default',
    note: 'destructive, armed: the typed confirmation naming the child',
    proof: async (page) =>
      inDialog(page).getByRole('button', { name: 'Delete permanently', exact: true }).isEnabled(),
    open: async (page) => {
      if (!(await rowAction(page, DIALOG_PLAYER, 'Delete permanently'))) return false
      await pause(page)
      return fillField(page, /^To confirm, type/, DIALOG_PLAYER)
    },
  },
  {
    key: 'delete-deleting',
    title: 'Delete player permanently',
    state: 'inflight',
    note: 'destructive, in flight: nothing can dismiss it while the delete is running',
    proof: '.modal button:has-text("Deleting…")',
    open: async (page) => {
      if (!(await rowAction(page, DIALOG_PLAYER, 'Delete permanently'))) return false
      await pause(page)
      if (!(await fillField(page, /^To confirm, type/, DIALOG_PLAYER))) return false
      return pressInDialog(page, 'Delete permanently')
    },
  },
  {
    key: 'spond',
    title: 'Import from Spond',
    state: 'allactions',
    note: 'normal: the only header action gated on a Spond mapped team being selected',
    proof: '.modal .modal-copy',
    open: (page) => headerAction(page, 'Import from Spond'),
  },
  {
    key: 'spond-importing',
    title: 'Import from Spond',
    state: 'inflight',
    at: 'allactions',
    note: 'in flight: the run reports nothing until it settles, and nothing dismisses it',
    proof: '.modal button:has-text("Importing…")',
    open: async (page) => {
      if (!(await headerAction(page, 'Import from Spond'))) return false
      await pause(page)
      return pressInDialog(page, 'Import')
    },
  },
  {
    key: 'spond-result',
    title: 'Import from Spond',
    state: 'spondresult',
    // The action is only offered with a Spond mapped team selected, so this
    // entry's address and its state are two different things: the address
    // puts the team filter there, the state decides what the write reports.
    at: 'allactions',
    note: 'the run reported: counts, a message and the warning as its own Note',
    proof: '.modal .note-warning',
    // PRESSED, not answered before the dialog opens. The stub used to hand
    // back a result the moment the hook ran, so this proof held whether or not
    // Import did anything and the screenshot showed an outcome no coach could
    // reach. Codex.
    open: async (page) => {
      if (!(await headerAction(page, 'Import from Spond'))) return false
      await pause(page)
      return pressInDialog(page, 'Import')
    },
  },
  {
    key: 'spond-failed',
    title: 'Import from Spond',
    state: 'writefails',
    at: 'allactions',
    note: 'a refused run: nothing was imported, said in the dialog rather than by closing it',
    proof: '.modal [role="alert"]',
    open: async (page) => {
      if (!(await headerAction(page, 'Import from Spond'))) return false
      await pause(page)
      return pressInDialog(page, 'Import')
    },
  },

  /* PlayerHistoryModal */
  {
    key: 'history-empty',
    title: 'History',
    state: 'default',
    note: 'empty: a child added and never edited',
    proof: '.modal p:has-text("No changes recorded yet")',
    open: (page) => rowAction(page, DIALOG_PLAYER, 'History'),
  },
  {
    key: 'history',
    title: 'History',
    state: 'history',
    note: 'normal: a time beside a sentence, with no child name in any entry',
    proof: '.modal .history-list .history-item',
    opener: (page) => rowOpener(page, DIALOG_PLAYER, 'History'),
    open: (page) => rowAction(page, DIALOG_PLAYER, 'History'),
  },
  {
    key: 'history-long',
    title: 'History',
    state: 'historylong',
    note: 'long content: the body scrolls inside the dialog rather than the page',
    proof: async (page) => (await page.locator('.modal .history-item').count()) >= 20,
    open: (page) => rowAction(page, DIALOG_PLAYER, 'History'),
  },
  {
    key: 'history-error',
    title: 'History',
    state: 'historyerror',
    note: 'a failed read: an announced ErrorNote, which no longer looks like the load',
    proof: '.modal .state-error[role="alert"]',
    open: (page) => rowAction(page, DIALOG_PLAYER, 'History'),
  },

  /* ExportConfirmModal */
  {
    key: 'export',
    title: 'Export registered players',
    state: 'allactions',
    note: 'normal: two choice groups, the handling reminder and the template offer',
    proof: '.modal .choice-group legend',
    opener: (page) => headerOpener(page, 'Export'),
    open: (page) => headerAction(page, 'Export'),
  },
  {
    key: 'export-failed',
    title: 'Export registered players',
    state: 'writefails',
    note: 'a refused export: nothing was written and the choices are kept',
    proof: '.modal [role="alert"]',
    open: async (page) => {
      if (!(await headerAction(page, 'Export'))) return false
      await pause(page)
      return pressInDialog(page, 'Download CSV')
    },
  },

  /* ImportPlayersModal */
  {
    key: 'import',
    title: 'Import players',
    state: 'allactions',
    note: 'stage 0: the dropzone, before any file is chosen',
    proof: '.modal .ip-dropzone',
    opener: (page) => headerOpener(page, 'Import players'),
    open: (page) => headerAction(page, 'Import players'),
  },
  {
    key: 'import-preview',
    title: 'Import players',
    state: 'allactions',
    note: 'stage 1: a real parse of a real file, with a needs-your-choice row',
    proof: '.modal .ip-list .ip-row',
    open: async (page) => {
      if (!(await headerAction(page, 'Import players'))) return false
      await pause(page)
      return chooseFile(page, 'register.csv', IMPORT_CSV, '.ip-summary')
    },
  },
  {
    key: 'import-long',
    title: 'Import players',
    state: 'allactions',
    note: 'long content: sixty rows, so the preview list scrolls inside its own container',
    proof: async (page) => (await page.locator('.modal .ip-row').count()) >= 20,
    open: async (page) => {
      if (!(await headerAction(page, 'Import players'))) return false
      await pause(page)
      return chooseFile(page, 'squad.csv', IMPORT_CSV_LONG, '.ip-summary')
    },
  },
  {
    key: 'import-parse-error',
    title: 'Import players',
    state: 'allactions',
    note: 'a file that is not a spreadsheet: the parse refusal, before anything is written',
    proof: '.modal [role="alert"]',
    open: async (page) => {
      if (!(await headerAction(page, 'Import players'))) return false
      await pause(page)
      return chooseFile(page, 'notes.csv', 'this is not a spreadsheet', '.modal [role="alert"]')
    },
  },
  {
    key: 'import-outcome',
    title: 'Import players',
    state: 'allactions',
    note: 'stage 3: the outcome screen, safe counts and a batch reference only',
    proof: '.modal .ip-outcome',
    open: async (page) => {
      if (!(await headerAction(page, 'Import players'))) return false
      await pause(page)
      if (!(await chooseFile(page, 'register.csv', IMPORT_CSV, '.ip-summary'))) return false
      await skipEveryChoice(page)
      return click(inDialog(page).getByRole('button', { name: /^Import \d+ rows?$/ }))
    },
  },

  /* RenewSeasonModal */
  {
    key: 'renew',
    title: 'Renew players',
    state: 'allactions',
    note: 'normal: the two season pickers and the row list, each row a Badge and a name',
    proof: '.modal .renew-list .renew-row',
    opener: (page) => headerOpener(page, 'Renew'),
    open: (page) => headerAction(page, 'Renew'),
  },
  {
    key: 'renew-nothing',
    title: 'Renew players',
    state: 'renewempty',
    note: 'empty: the source season has nobody to bring forward, and says so',
    proof: '.modal p:has-text("no registrations to renew")',
    open: (page) => headerAction(page, 'Renew'),
  },
  {
    key: 'renew-alldone',
    title: 'Renew players',
    state: 'renewalldone',
    note: 'ineligible: every child is already in the target, so the confirm reads 0 and is inert',
    proof: async (page) =>
      inDialog(page).getByRole('button', { name: 'Renew 0 players', exact: true }).isDisabled(),
    open: (page) => headerAction(page, 'Renew'),
  },
  {
    key: 'renew-failed',
    title: 'Renew players',
    state: 'writefails',
    note: 'a refused renewal: nothing was renewed and the selection is kept',
    proof: '.modal [role="alert"]',
    open: async (page) => {
      if (!(await headerAction(page, 'Renew'))) return false
      await pause(page)
      return click(inDialog(page).getByRole('button', { name: /^Renew \d+ players?$/ }))
    },
  },
]

// The query string a dialog's page opens on. `state` is what the harness's
// reads and writes answer with; `at` is the address the register opens on,
// which is the state's own unless the entry says otherwise. Import from Spond
// is the case that needs both: it is offered only with a Spond mapped team
// selected, and its outcome is what the WRITE answers.
export function queryFor(d, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  const q = new URLSearchParams({ screen: 'players', caps: 'coach', ...clean })
  if (d.state !== 'default') q.set('state', d.state)
  if (d.at) q.set('at', d.at)
  return q
}

// Opens the dialog and proves BOTH claims its name makes: that this is the
// dialog the entry names, and that it is in the state the entry names.
// Returns the reason it failed, or null on success.
//
// The second half is not decoration. Every one of these entries files a
// screenshot or a measurement under a name that asserts a state, and a press
// that quietly no-ops leaves an ordinary dialog under that name, which reads
// as evidence. `proof` is a selector for a state that renders something, or a
// predicate for one that does not: a disabled confirm and a count of rows are
// both claims no selector can make.
export async function openDialog(page, d) {
  if (!(await d.open(page))) return 'the controls that open it are not on the page'
  await page.waitForTimeout(300)
  const title = await page.evaluate(() => {
    const h = document.querySelector('.modal h3')
    return h ? h.textContent.trim() : null
  })
  if (title === null) return 'no dialog opened'
  if (title !== d.title) return `opened "${title}" rather than "${d.title}"`
  if (!d.proof) return `the entry claims "${d.note}" and nothing checks it`
  const held =
    typeof d.proof === 'function'
      ? await d.proof(page).catch(() => false)
      : await page
          .waitForSelector(d.proof, { state: 'visible', timeout: 3000 })
          .then(() => true, () => false)
  if (!held) return `it opened, but ${typeof d.proof === 'function' ? 'the state predicate' : d.proof} never held`
  return null
}
