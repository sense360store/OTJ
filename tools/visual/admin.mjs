// How an administrator reaches each state of Admin Users and Admin Teams, in
// one place. Development only.
//
// WHY THIS IS A MODULE, for the reason dialogs.mjs, account.mjs, auth.mjs and
// feedback.mjs are ones: three tools need the same presses. shoot.mjs
// photographs each state, checks.mjs measures and drives them, and contrast.mjs
// sweeps the text runs each one paints. Each of them writing its own presses is
// how a matrix and a check drift apart until one of them is quietly
// photographing an untouched page.
//
// NOTHING HERE IS FAKED. Every entry presses the control an administrator
// presses and types into the field they type into; what the harness varies is
// what the server does (tools/visual/stubs/queries.tsx) and which capabilities
// the member holds (tools/visual/fixtures.ts), never what is drawn.

/* ---- the rows, mirrored from tools/visual/fixtures.ts ------------------
   This is plain JavaScript and cannot import the fixtures, so the names are
   repeated here. A drift is caught rather than tolerated: every entry below
   scopes its presses to a row BY NAME, so a renamed fixture makes the driver
   report "the controls it drives are not on the page" rather than quietly
   pressing a different row's control. */
export const MEMBERS = {
  // The signed in holder of users.manage. Their row reads "(you)" and is the
  // only one with no Remove at all.
  me: 'Sam Ashworth',
  // An ordinary member on two specific teams, and the one with public links
  // still working, so their removal dialog carries the advisory warning.
  other: 'Priya Raghunathan',
  // The second Admin. With two admins in the club nobody is the last one, so
  // this is the row that proves removal is OFFERED; under `lastadmin` they
  // are the only admin and the same row proves it is refused.
  admin: 'Marguerite Ashby-Fotheringay',
  // Invited rather than active, and the holder of the custom role.
  invited: 'Tom Brearley',
  // Invited and holding NO role at all, which is the state the row marks in
  // danger because it grants nothing.
  noRoles: 'Jo Hartley',
  // Three roles at once.
  manyRoles: 'Dev Chatterjee',
  // The `longnames` member.
  long: 'Christabel Fotheringay-Wallington-Smythe',
}

export const ROLES = {
  admin: 'Admin',
  manager: 'Manager',
  coach: 'Coach',
  parent: 'Parent',
  // The one custom role, and so the only row offering Rename and Delete.
  custom: 'Kit Officer',
  long: 'Safeguarding and Welfare Officer',
}

export const TEAMS = {
  first: 'Titans',
  second: 'Trojans',
  noBib: 'Gladiators',
  // The two the `longnames` state adds. The second has no space in it at all,
  // which is the case a wrapping rule has to answer; a spaced name breaks by
  // itself and proves nothing.
  long: 'Ossett Town Juniors Development Squad Under Nines',
  unbroken: 'OssettTownJuniorsDevelopmentSquadUnderNines',
}

// What a driver types. The invite address is a .invalid domain, which can
// never resolve.
const TYPED_EMAIL = 'new.coach@example.invalid'
const TYPED_NAME = 'Alex Nowell'
const TYPED_ROLE = 'Team Manager'
const TYPED_TEAM = 'Centurions'
const TYPED_TEAM_RENAME = 'Titans Under Nines'

const pause = (page) => page.waitForTimeout(250)

/* A press, a fill and a selection that report rather than throw, so a driver
   returns false and its caller records a failed entry instead of the run
   ending on a timeout. Same contract as account.mjs, auth.mjs and
   feedback.mjs. */
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
const choose = (locator, value) => act(locator, (el) => el.selectOption(value))

/* ---- scoping ----------------------------------------------------------
   Members and roles are the same row class inside two cards on one screen,
   and several strings appear in both: "Kit Officer" is a role's own row AND
   a pill on the member who holds it. So every locator below is scoped to its
   card BY THE CARD'S OWN HEADING, which is the only thing on the page that
   tells the two apart, rather than by an nth-child a reordering would
   silently move. */
const card = (page, heading) =>
  page.locator('.card').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

export const memberRow = (page, name) => card(page, 'Club members').locator('.admin-row').filter({ hasText: name })
export const roleRow = (page, label) => card(page, 'Roles').locator('.admin-row').filter({ hasText: label })
/* Teams is one card, so its rows need no card scope. What they DO need is a
   locator that is not text: a team's name lives in an input's VALUE and in
   two labels that are read rather than shown, so filtering on text would
   depend on how the runner extracts it and would stop matching the moment a
   driver typed into the field. The row's own Remove button names the team
   outright, which is exactly the identity the row is being scoped to. */
export const teamRow = (page, name) =>
  page.locator('.admin-row').filter({ has: page.getByRole('button', { name: `Remove ${name}`, exact: true }) })
/* COACH-1B. The team rows in the order the page SHOWS them, read off each
   row's own Remove control, and the draft position each row shows beside its
   Move controls. Both are the thing the order entries are about: a row count
   is true of any order. */
export const orderOf = (page) =>
  page
    .locator('.admin-row')
    .evaluateAll((rows) =>
      rows.map((r) => (r.querySelector('button[aria-label^="Remove "]')?.getAttribute('aria-label') ?? '').replace(/^Remove /, '')),
    )
export const positionsOf = (page) => page.locator('.admin-position').allTextContents()
export const saveOrderButton = (page) => page.locator('.admin-order-save button')
/* COACH-1B. What the order write carries beside the order: the positions the
   screen READ, in the order the read returned them, so a position another
   admin stored in between is refused rather than overwritten. The fixture
   club is stored 2, 1, 3, 5, 4 in array order (see fixtures.ts TEAMS). */
const READ_POSITIONS = [
  { id: 'titans', sortOrder: 2 },
  { id: 'trojans', sortOrder: 1 },
  { id: 'gladiators', sortOrder: 3 },
  { id: 'spartans', sortOrder: 5 },
  { id: 'argonauts', sortOrder: 4 },
]
const UNSET_POSITIONS = READ_POSITIONS.map((r) => ({ id: r.id, sortOrder: null }))
/* The LAST write of a name, with its arguments, compared whole: the order
   entries claim what was sent, which a counter cannot say. */
const lastWriteWas = (page, name, vars) =>
  page.evaluate(
    ({ name, vars }) => {
      const log = window.__adminCalls
      const w = [...(log?.writes ?? [])].reverse().find((x) => x.name === name)
      return !!w && JSON.stringify(w.vars) === JSON.stringify(vars)
    },
    { name, vars },
  )
// The one input inside a role row, which exists only while that row is being
// renamed. The New role field is outside .admin-row, so this cannot reach it.
const renameInput = (page) => card(page, 'Roles').locator('.admin-row input')

const inviteCard = (page) => card(page, 'Invite someone')
const gridCard = (page) => card(page, 'Roles and capabilities')

const rowButton = (scope, name) => scope.getByRole('button', { name, exact: true })
/* Every row action is named for its OWN row now, so a screen reader listing
   the page's buttons does not get six identical "Manage". The driver names
   them the same way, which is also what stops a press landing on a different
   row's control. */
const manage = (name) => `Manage ${name}`
const renameOf = (name) => `Rename ${name}`
const modal = (page) => page.locator('.modal')
const modalButton = (page, name) => modal(page).getByRole('button', { name, exact: true })

/* ---- the proofs -------------------------------------------------------
   Three shapes recur, and each exists because the loose version of it was
   ruled out on the screens this harness already covers.

   A note is never proved by "a note is on screen". Every message on these two
   screens renders through the same Note, so a proof that only asked for one
   would hold for the wrong outcome. Each names the tone, the live region role
   and the words.

   A count is never inferred from what is drawn. Eleven of this pair's claims
   are about a call that must NOT happen, and a browser cannot see one of
   those.

   A checkbox is never found by position. Which tick belongs to which role and
   which capability is exactly what a visual refactor can silently change, so
   every grid press names BOTH halves through the control's accessible name. */
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
   deleted counter looks like. */
// Every write the two screens can make, named here so a counter that is
// renamed, dropped or never added fails rather than reading as nought.
export const WRITE_NAMES = [
  'invite',
  'removeUser',
  'setMemberRoles',
  'setMemberTeams',
  'setMemberAllTeams',
  'createRole',
  'renameRole',
  'deleteRole',
  'saveRoleCaps',
  'insertTeam',
  'renameTeam',
  'deleteTeam',
  'setTeamBib',
  'saveTeamOrder',
]

export const calls = (name, want) => (page) =>
  page.evaluate(
    ({ name, want }) => {
      const log = window.__adminCalls
      if (!log || typeof log !== 'object') return false
      /* The KEY has to EXIST, not merely read as nought. `log[name] ?? 0`
         made every negative proof hold against a counter somebody had
         renamed, which is the exact hole the comment above claims to close:
         rename saveRoleCaps in the stub and four `calls(..., 0)` proofs stay
         green while only the two paired `calls(..., 1)` catch it. */
      if (!Object.prototype.hasOwnProperty.call(log, name)) return false
      return log[name] === want
    },
    { name, want },
  )

// The ORDER the writes went out in. Two counters both reading 1 hold
// whichever way round they went, and the member save's order is a rule.
export const callOrder = (want) => (page) =>
  page.evaluate(
    (want) => {
      const log = window.__adminCalls
      if (!log || !Array.isArray(log.writes)) return false
      const made = log.writes.map((w) => w.name)
      return made.length === want.length && made.every((n, i) => n === want[i])
    },
    want,
  )

/* What a write actually CARRIED. A counter says a write happened and the
   order says when; neither says what was sent, so the frozen payload rules
   (an invite's teams are empty when All teams is on; the member save sends
   the specific selection underneath it) held against a payload that had been
   emptied. Ids are compared through the store's own names, so an assertion
   reads in the same vocabulary as the presses above and a renamed fixture
   fails rather than silently matching. An array compares as a SET, because
   the product builds both lists from a Set and their order means nothing;
   anything else compares by value. Exactly one write of that name must have
   been made, so this cannot pass by finding an earlier one.

   WHO the write was about is part of the payload, and the member save's three
   writes each carry their own `memberId`. Two of the three are invisible on
   the row the dialog was opened from, so a save that sent one of them for a
   different member left the entry green: the row still read All teams, which
   the middle write had set correctly. Every entry that asserts a save's
   arguments names the member. */
export const callArgs = (name, want) => (page) =>
  page.evaluate(
    ({ name, want }) => {
      const log = window.__adminCalls
      const names = window.__adminNames
      if (!log || !Array.isArray(log.writes) || !names) return false
      const made = log.writes.filter((w) => w.name === name)
      if (made.length !== 1) return false
      const vars = made[0].vars
      if (!vars || typeof vars !== 'object') return false
      /* A role capability pair reads as the tick's OWN accessible name, so a
         payload assertion and a grid press are written the same way. */
      const named = (field, v) =>
        v && typeof v === 'object' && 'roleId' in v && 'capability' in v
          ? `${names.capability(v.capability)} for ${names.role(v.roleId)}`
          : field === 'teamIds'
            ? names.team(v)
            : field === 'roleIds'
              ? names.role(v)
              : field === 'memberId' || field === 'userId'
                ? names.member(v)
                : v
      return Object.entries(want).every(([field, expected]) => {
        const got = vars[field]
        if (Array.isArray(expected)) {
          if (!Array.isArray(got) || got.length !== expected.length) return false
          const mine = got.map((v) => named(field, v)).sort()
          const theirs = [...expected].sort()
          return mine.every((v, i) => v === theirs[i])
        }
        return named(field, got) === expected
      })
    },
    { name, want },
  )

/* Every counter is zero: what a page that has been looked at rather than
   pressed must be able to claim.

   EVERY EXPECTED counter, present and zero, rather than every counter the log
   happens to hold. `Object.values({}).every(...)` is true, so an emptied or
   never-installed log made six entries whose whole point is "nothing was
   written" report that a page nobody had instrumented wrote nothing. */
export const noWrites = (page) =>
  page.evaluate((names) => {
    const log = window.__adminCalls
    if (!log || typeof log !== 'object') return false
    return names.every((n) => Object.prototype.hasOwnProperty.call(log, n) && log[n] === 0)
  }, WRITE_NAMES)

/* A control POINTS at the sentence that accounts for it: aria-describedby
   naming an element that exists and says the words. A sentence merely near a
   control is not an explanation a screen reader ever reaches, which is the
   whole difference this asserts. */
/* The same, for a BUTTON that has gone inert. Found by name rather than by
   position, and it fails when the attribute is absent, which is what makes
   deleting the binding a failing check rather than a silent one. */
export const buttonDescribedBy = (page, scope, name, text) =>
  page.evaluate(
    ({ scope, name, text }) => {
      const el = [...document.querySelectorAll(`${scope} button`)].find((b) =>
        ((b.getAttribute('aria-label') ?? b.textContent) ?? '').trim().startsWith(name),
      )
      const id = el ? el.getAttribute('aria-describedby') : null
      if (!id) return false
      const said = document.getElementById(id)
      return !!said && (said.textContent ?? '').includes(text)
    },
    { scope, name, text },
  )

export const describedByHolds = (page, scope, labelText, text) =>
  page.evaluate(
    ({ scope, labelText, text }) => {
      // The row is found by the WORDING beside its box, which is also how a
      // member finds it, rather than by a position a reordering would move.
      const label = [...document.querySelectorAll(`${scope} label.check-row`)].find(
        (l) => (l.textContent ?? '').trim() === labelText,
      )
      const id = label ? label.querySelector('input')?.getAttribute('aria-describedby') : null
      if (!id) return false
      const said = document.getElementById(id)
      return !!said && (said.textContent ?? '').includes(text)
    },
    { scope, labelText, text },
  )

/* Where focus ended up. The outcome messages on both screens are wrapped in a
   tabIndex={-1} box, so a repair that worked put focus on the box HOLDING the
   message rather than merely somewhere off the body. */
export const focusOnOutcome = (tone) => (page) =>
  page.evaluate(
    (tone) => {
      const el = document.activeElement
      return (
        !!el &&
        el !== document.body &&
        el.getAttribute('tabindex') === '-1' &&
        !!el.querySelector(`.note-${tone}`)
      )
    },
    tone,
  )

/* Focus landed on THIS control, by identity rather than by shape. The four
   repairs below put it back on a field or a select the browser blurred when
   the write disabled it, and there is no outcome message involved, so
   `focusOnOutcome` cannot speak for them. Identity, because "some input has
   focus" is satisfied by the wrong row's field and by every tick on the
   screen. */
const focusedOn = (locator) => async (page) => {
  void page
  if ((await locator.count()) !== 1) return false
  return locator.first().evaluate((el) => el === document.activeElement)
}

// A control that is in flight rather than merely inert: it carries its own
// gerund AND is disabled AND the write it names has actually been made. A
// disabled control on its own is what an unfilled form looks like.
const inFlight = (selectorText, name) => async (page) =>
  (await page.locator(`button:has-text("${selectorText}")[disabled]`).count()) > 0 && (await calls(name, 1)(page))

/* A refusal that belongs to the row it was made on. `noteIn` takes a CSS
   scope, so `.admin-row` matched a note on ANY row; these two say "the row
   says so", which is a claim about WHICH row, and the team's own name is the
   only token in the sentence that can tell them apart. */
const rowNote = (rowLocator, tone, text) => async (page) => {
  void page
  const notes = rowLocator.locator(`.note-${tone}[role="alert"]`).filter({ hasText: text })
  return (await notes.count()) === 1
}

const dialogTitled = (title) => (page) =>
  page.evaluate((title) => (document.querySelector('.modal h3')?.textContent ?? '').trim() === title, title)

const noDialog = (page) => page.evaluate(() => document.querySelectorAll('.modal').length === 0)

// The state of one capability tick, by BOTH halves of its name. This is the
// proof that a visual refactor did not move which box means what.
export const tickState = (capability, role) => (page) =>
  page.evaluate(
    ({ capability, role }) => {
      const el = document.querySelector(`input[type="checkbox"][aria-label="${capability} for ${role}"]`)
      if (!el) return null
      return { checked: el.checked, disabled: el.disabled }
    },
    { capability, role },
  )

const tickIs = (capability, role, want) => async (page) => {
  const got = await tickState(capability, role)(page)
  return !!got && got.checked === want.checked && got.disabled === want.disabled
}

const pressTick = (page, capability, role) =>
  click(page.getByRole('checkbox', { name: `${capability} for ${role}`, exact: true }))

/* A reserved tick is DISABLED, so a press on the control itself is refused by
   the browser before the product ever sees it, and an entry that drove it
   would be proving the browser rather than the screen. The press goes to the
   44px cell around it instead, which is what a thumb actually lands on. */
/* The WORD a select is currently showing, which is the information a bib
   colour carries; the stored value is not one. */
const selectedWord = (rowLocator) =>
  rowLocator
    .locator('select')
    .evaluate((el) => (el.options[el.selectedIndex]?.textContent ?? '').trim())

const pressCell = (page, capability, role) =>
  act(
    page
      .locator('.check-cell')
      .filter({ has: page.getByRole('checkbox', { name: `${capability} for ${role}`, exact: true }) }),
    (el) => el.click({ force: true }),
  )

/* ---- the entries ------------------------------------------------------
   Each entry is:

     key     the name a screenshot and a check are filed under
     screen  'adminusers' (the default) or 'adminteams'
     caps    the capability set, when it is not the users.manage holder
     state   what the harness's reads and writes must answer with
     note    what the entry is for, which is what a reviewer reads beside the
             screenshot
     proof   a predicate for the state the entry's own name claims
     drive   the presses an administrator makes to reach it, where there are any
     overlay whether a dialog is still up when the shot is taken */

export const USER_FLOWS = [
  /* ---- the page itself ---- */
  {
    key: 'users-default',
    note: 'the screen as it opens: six members, both member states, three roles on one of them, and nobody written to',
    proof: async (page) =>
      (await card(page, 'Club members').locator('.admin-row').count()) === 6 &&
      (await memberRow(page, MEMBERS.me).locator('.badge').filter({ hasText: 'Active' }).count()) === 1 &&
      (await memberRow(page, MEMBERS.invited).locator('.badge').filter({ hasText: 'Invited' }).count()) === 1 &&
      (await memberRow(page, MEMBERS.manyRoles).locator('.pill').count()) === 3 &&
      (await noWrites(page)),
  },
  {
    key: 'users-no-roles-member',
    note: 'a member holding no role: the danger badge and the sentence saying what that costs them, rather than a bare gap',
    proof: async (page) =>
      (await memberRow(page, MEMBERS.noRoles).locator('.badge-danger').filter({ hasText: 'No roles' }).count()) === 1 &&
      (await memberRow(page, MEMBERS.noRoles).locator('.admin-hint').count()) === 1,
  },
  {
    key: 'users-states-unknown',
    state: 'statesunknown',
    note: 'the member states read has not answered: no member claims invited or active, rather than every one reading active',
    proof: async (page) =>
      (await card(page, 'Club members').locator('.admin-row').count()) === 6 &&
      (await card(page, 'Club members').locator('.badge').filter({ hasText: 'Active' }).count()) === 0 &&
      (await card(page, 'Club members').locator('.badge').filter({ hasText: 'Invited' }).count()) === 0,
  },
  {
    key: 'users-loading',
    state: 'adminloading',
    note: 'the page level reads have not answered: the labelled spinner, not a half drawn list',
    proof: async (page) =>
      (await page.locator('.loading[role="status"] .spinner').count()) === 1 &&
      (await page.locator('.admin-row').count()) === 0,
  },
  {
    key: 'users-error',
    state: 'adminerror',
    note: 'the page level reads failed: the danger state with its retry, announced as an alert',
    proof: async (page) =>
      (await page.locator('.state-error[role="alert"]').count()) === 1 &&
      (await page.locator('.state-error').getByRole('button', { name: 'Retry' }).count()) === 1,
  },
  {
    key: 'users-long-names',
    state: 'longnames',
    note: 'a member name, a role label and a team name each as long as a club would really make them',
    proof: async (page) =>
      (await memberRow(page, MEMBERS.long).count()) === 1 &&
      (await roleRow(page, ROLES.long).count()) === 1,
  },

  /* ---- the invite form ---- */
  {
    key: 'invite-open',
    note: 'the form as it opens: Coach ticked by default, Send inert because no address has been typed, and nothing sent',
    proof: async (page) =>
      (await inviteCard(page).getByRole('checkbox', { name: ROLES.coach, exact: true }).isChecked()) &&
      (await rowButton(inviteCard(page), 'Send invite').isDisabled()) &&
      (await calls('invite', 0)(page)),
  },
  {
    key: 'invite-no-role',
    note: 'every role unticked on an OTHERWISE COMPLETE form: the warning says why Send is inert, Send is inert, and it points at the warning',
    /* The fields are filled FIRST. Without that Send is disabled by the empty
       address and name alone, so deleting the role rule from the disabled
       expression left this entry green under a name claiming to prove it. */
    proof: async (page) =>
      (await noteIn('.card', 'warning', 'status', 'Pick at least one role')(page)) &&
      (await rowButton(inviteCard(page), 'Send invite').isDisabled()) &&
      (await buttonDescribedBy(page, '.card', 'Send invite', 'Pick at least one role')) &&
      (await calls('invite', 0)(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      return click(inviteCard(page).getByRole('checkbox', { name: ROLES.coach, exact: true }))
    },
  },
  {
    key: 'invite-admin-all-teams',
    note: 'ticking Admin turns All teams on, as the invite function would: every team reads ticked and inert, and one sentence says why',
    proof: async (page) =>
      (await inviteCard(page).getByRole('checkbox', { name: 'All teams, current and future', exact: true }).isChecked()) &&
      (await inviteCard(page).getByRole('checkbox', { name: TEAMS.first, exact: true }).isDisabled()) &&
      (await inviteCard(page).locator('.admin-hint').filter({ hasText: 'All teams is on' }).count()) === 1 &&
      // BOUND to the toggle, not merely near it: the five boxes that just
      // changed are disabled and so out of the tab order, and this is the
      // only thing on the tab path that accounts for them.
      (await describedByHolds(page, '.card', 'All teams, current and future', 'All teams is on')) &&
      (await calls('invite', 0)(page)),
    drive: (page) => click(inviteCard(page).getByRole('checkbox', { name: ROLES.admin, exact: true })),
  },
  {
    key: 'invite-valid',
    note: 'a complete form: Send is live, and it still has not been pressed',
    proof: async (page) =>
      (await rowButton(inviteCard(page), 'Send invite').isEnabled()) && (await calls('invite', 0)(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      return fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME)
    },
  },
  {
    key: 'invite-teams-picked',
    note: 'two specific teams ticked with All teams off, which is the selection the invite carries',
    proof: async (page) =>
      (await inviteCard(page).getByRole('checkbox', { name: TEAMS.first, exact: true }).isChecked()) &&
      (await inviteCard(page).getByRole('checkbox', { name: TEAMS.second, exact: true }).isChecked()) &&
      !(await inviteCard(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true }).isChecked()) &&
      !(await inviteCard(page)
        .getByRole('checkbox', { name: 'All teams, current and future', exact: true })
        .isChecked()),
    drive: async (page) => {
      if (!(await click(inviteCard(page).getByRole('checkbox', { name: TEAMS.first, exact: true })))) return false
      return click(inviteCard(page).getByRole('checkbox', { name: TEAMS.second, exact: true }))
    },
  },
  {
    /* The two teams SENT, rather than the two teams ticked. `invite-teams-picked`
       above never presses Send, so nothing observed the payload the picker
       feeds; emptying `teamIds` on the way out left both green. */
    key: 'invite-sent-teams',
    note: 'a complete invite for two specific teams: the payload carries exactly those two and All teams is off',
    proof: async (page) =>
      (await calls('invite', 1)(page)) &&
      (await callArgs('invite', {
        teamIds: [TEAMS.first, TEAMS.second],
        allTeams: false,
      })(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      if (!(await click(inviteCard(page).getByRole('checkbox', { name: TEAMS.first, exact: true })))) return false
      if (!(await click(inviteCard(page).getByRole('checkbox', { name: TEAMS.second, exact: true })))) return false
      return click(rowButton(inviteCard(page), 'Send invite'))
    },
  },
  {
    /* The frozen rule itself: `teamIds: allTeams ? [] : [...teamIds]`. The
       teams are ticked FIRST and All teams turned on afterwards, so the
       selection is still held in state and the payload has to drop it. A
       picker state assertion cannot see this at all. */
    key: 'invite-sent-all-teams',
    note: 'teams picked and then All teams turned on: the invite carries no specific teams at all',
    proof: async (page) =>
      (await calls('invite', 1)(page)) &&
      (await callArgs('invite', {
        teamIds: [],
        allTeams: true,
        roleIds: [ROLES.coach, ROLES.admin],
      })(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      if (!(await click(inviteCard(page).getByRole('checkbox', { name: TEAMS.first, exact: true })))) return false
      if (!(await click(inviteCard(page).getByRole('checkbox', { name: ROLES.admin, exact: true })))) return false
      return click(rowButton(inviteCard(page), 'Send invite'))
    },
  },
  {
    key: 'invite-pending',
    state: 'inflight',
    note: 'the invite in flight: the submit reads Sending… and is frozen',
    proof: inFlight('Sending…', 'invite'),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      return click(rowButton(inviteCard(page), 'Send invite'))
    },
  },
  {
    key: 'invite-failed',
    state: 'writefails',
    note: 'the invite was refused: the danger Note, announced as an alert, with focus on the message rather than on the body',
    proof: async (page) =>
      (await noteIn('.card', 'danger', 'alert', 'already a member')(page)) &&
      (await focusOnOutcome('danger')(page)) &&
      (await calls('invite', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      return click(rowButton(inviteCard(page), 'Send invite'))
    },
  },
  {
    key: 'invite-ok',
    note: 'the invite sent: the success Note, the form emptied, the new member listed as invited, and focus on the message',
    proof: async (page) =>
      (await noteIn('.card', 'success', 'status', `Invite sent to ${TYPED_EMAIL}`)(page)) &&
      (await focusOnOutcome('success')(page)) &&
      (await inviteCard(page).getByLabel('Email', { exact: true }).inputValue()) === '' &&
      (await memberRow(page, TYPED_NAME).locator('.badge').filter({ hasText: 'Invited' }).count()) === 1 &&
      (await calls('invite', 1)(page)) &&
      // What it CARRIED, not merely that it was made: the typed address and
      // name, the default role and nothing else, and no teams with All teams
      // off, which is the shape the invite function is given.
      (await callArgs('invite', {
        email: TYPED_EMAIL,
        fullName: TYPED_NAME,
        roleIds: [ROLES.coach],
        teamIds: [],
        allTeams: false,
      })(page)),
    drive: async (page) => {
      if (!(await fillIn(inviteCard(page).getByLabel('Email', { exact: true }), TYPED_EMAIL))) return false
      if (!(await fillIn(inviteCard(page).getByLabel('Full name', { exact: true }), TYPED_NAME))) return false
      return click(rowButton(inviteCard(page), 'Send invite'))
    },
  },
  {
    key: 'invite-no-teams',
    state: 'noteams',
    note: 'a club with no teams: the picker says where to add them rather than showing an empty box',
    proof: async (page) =>
      (await inviteCard(page).locator('.admin-hint').filter({ hasText: 'No teams yet' }).count()) === 1,
  },

  /* ---- managing one member ---- */
  {
    key: 'manage-open',
    overlay: true,
    note: "the member's own roles and teams as they stand, and nothing written",
    proof: async (page) =>
      (await dialogTitled('Roles and teams')(page)) &&
      (await modal(page).getByRole('checkbox', { name: ROLES.coach, exact: true }).isChecked()) &&
      (await modal(page).getByRole('checkbox', { name: TEAMS.first, exact: true }).isChecked()) &&
      !(await modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true }).isChecked()) &&
      (await noWrites(page)),
    drive: (page) => click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))),
  },
  {
    key: 'manage-zero-roles',
    overlay: true,
    note: 'every role unticked: the warning says what that would mean, Save is inert, and nothing is written',
    proof: async (page) =>
      (await noteIn('.modal', 'warning', 'status', 'Keep at least one role')(page)) &&
      (await modalButton(page, 'Save').isDisabled()) &&
      (await buttonDescribedBy(page, '.modal', 'Save', 'Keep at least one role')) &&
      (await noWrites(page)),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      return click(modal(page).getByRole('checkbox', { name: ROLES.coach, exact: true }))
    },
  },
  {
    key: 'manage-last-admin-locked',
    state: 'lastadmin',
    overlay: true,
    note: "the club's only admin: their Admin tick is held on and inert, and the sentence says why rather than a tooltip",
    proof: async (page) =>
      (await modal(page).getByRole('checkbox', { name: ROLES.admin, exact: true }).isChecked()) &&
      (await modal(page).getByRole('checkbox', { name: ROLES.admin, exact: true }).isDisabled()) &&
      (await modal(page).locator('.admin-hint').filter({ hasText: 'must keep at least one admin' }).count()) === 1 &&
      (await describedByHolds(page, '.modal', ROLES.admin, 'must keep at least one admin')) &&
      // Every other role stays editable: the lock is on the one tick that
      // would leave the club with no administrator, not on the dialog.
      !(await modal(page).getByRole('checkbox', { name: ROLES.coach, exact: true }).isDisabled()) &&
      (await noWrites(page)),
    drive: (page) => click(rowButton(memberRow(page, MEMBERS.admin), manage(MEMBERS.admin))),
  },
  {
    key: 'manage-all-teams',
    overlay: true,
    note: 'All teams turned on: every team reads ticked and inert, with one sentence saying why',
    proof: async (page) =>
      (await modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true }).isChecked()) &&
      (await modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true }).isDisabled()) &&
      (await modal(page).locator('.admin-hint').filter({ hasText: 'All teams is on' }).count()) === 1,
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      return click(modal(page).getByRole('checkbox', { name: 'All teams, current and future', exact: true }))
    },
  },
  {
    key: 'manage-pending',
    state: 'inflight',
    overlay: true,
    note: 'the save in flight: the submit reads Saving… and every control in the dialog is frozen',
    proof: async (page) =>
      (await inFlight('Saving…', 'setMemberRoles')(page)) &&
      (await modal(page).getByRole('checkbox', { name: ROLES.manager, exact: true }).isDisabled()),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      if (!(await click(modal(page).getByRole('checkbox', { name: ROLES.manager, exact: true })))) return false
      return click(modalButton(page, 'Save'))
    },
  },
  {
    key: 'manage-partial-failure',
    state: 'writefails',
    overlay: true,
    note: 'the FIRST of two writes refused: the dialog stays open with the message, and the second write is never attempted',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'at least one admin')(page)) &&
      (await dialogTitled('Roles and teams')(page)) &&
      (await calls('setMemberRoles', 1)(page)) &&
      (await callArgs('setMemberRoles', { memberId: MEMBERS.other })(page)) &&
      // The teams change was queued behind it and must not have been sent.
      (await calls('setMemberTeams', 0)(page)) &&
      (await calls('setMemberAllTeams', 0)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      // Both halves changed, so the order the saves go in is what decides
      // which counter moves.
      if (!(await click(modal(page).getByRole('checkbox', { name: ROLES.manager, exact: true })))) return false
      if (!(await click(modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true })))) return false
      return click(modalButton(page, 'Save'))
    },
  },
  {
    key: 'manage-saved',
    note: 'roles and teams both changed: both writes made, IN THAT ORDER, the dialog closed and the row showing the new set',
    // The order is read off the stub's own sequence rather than off two
    // counters, which both read 1 whichever way round the awaits went.
    proof: async (page) =>
      (await noDialog(page)) &&
      (await callOrder(['setMemberRoles', 'setMemberTeams'])(page)) &&
      (await memberRow(page, MEMBERS.other).locator('.pill').filter({ hasText: ROLES.manager }).count()) === 1 &&
      // And both writes were about THIS member.
      (await callArgs('setMemberRoles', {
        memberId: MEMBERS.other,
        roleIds: [ROLES.coach, ROLES.manager],
      })(page)) &&
      (await callArgs('setMemberTeams', {
        memberId: MEMBERS.other,
        teamIds: [TEAMS.first, TEAMS.second, TEAMS.noBib],
      })(page)),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      if (!(await click(modal(page).getByRole('checkbox', { name: ROLES.manager, exact: true })))) return false
      if (!(await click(modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true })))) return false
      return click(modalButton(page, 'Save'))
    },
  },
  {
    key: 'manage-saved-all-three',
    note: 'roles, the all teams flag and the specific teams all changed: three writes in the documented order, roles then all teams then teams',
    /* The one entry that observes the all teams write at all, and the only
       place the documented sequence is a claim rather than a comment. The
       team is ticked BEFORE All teams, because turning All teams on freezes
       the team rows, and the save still sends the specific selection
       underneath it. */
    proof: async (page) =>
      (await noDialog(page)) &&
      (await callOrder(['setMemberRoles', 'setMemberAllTeams', 'setMemberTeams'])(page)) &&
      (await calls('setMemberAllTeams', 1)(page)) &&
      (await memberRow(page, MEMBERS.other).locator('.admin-meta').filter({ hasText: 'All teams' }).count()) === 1 &&
      /* And WHAT each of the three carried. The row reads All teams either
         way, so emptying the teams payload left this entry green: the
         specific selection is kept underneath the flag and the third write
         is the only place that is visible. */
      (await callArgs('setMemberRoles', {
        memberId: MEMBERS.other,
        roleIds: [ROLES.coach, ROLES.manager],
      })(page)) &&
      (await callArgs('setMemberAllTeams', { memberId: MEMBERS.other, allTeams: true })(page)) &&
      (await callArgs('setMemberTeams', {
        memberId: MEMBERS.other,
        teamIds: [TEAMS.first, TEAMS.second, TEAMS.noBib],
      })(page)),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      if (!(await click(modal(page).getByRole('checkbox', { name: ROLES.manager, exact: true })))) return false
      if (!(await click(modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true })))) return false
      if (!(await click(modal(page).getByRole('checkbox', { name: 'All teams, current and future', exact: true }))))
        return false
      return click(modalButton(page, 'Save'))
    },
  },
  {
    key: 'manage-teams-only',
    note: 'only the teams changed: the roles write is never made, which is what saving only what changed means',
    proof: async (page) =>
      (await noDialog(page)) &&
      (await callOrder(['setMemberTeams'])(page)) &&
      (await calls('setMemberRoles', 0)(page)) &&
      (await calls('setMemberAllTeams', 0)(page)) &&
      (await callArgs('setMemberTeams', {
        memberId: MEMBERS.other,
        teamIds: [TEAMS.first, TEAMS.second, TEAMS.noBib],
      })(page)),
    drive: async (page) => {
      if (!(await click(rowButton(memberRow(page, MEMBERS.other), manage(MEMBERS.other))))) return false
      await pause(page)
      if (!(await click(modal(page).getByRole('checkbox', { name: TEAMS.noBib, exact: true })))) return false
      return click(modalButton(page, 'Save'))
    },
  },

  /* ---- removing a member ---- */
  {
    key: 'remove-open',
    overlay: true,
    note: 'the removal dialog: what stays with the club, the advisory public links warning, and nothing removed',
    proof: async (page) =>
      (await dialogTitled('Remove member')(page)) &&
      (await modal(page).locator('.modal-copy').filter({ hasText: 'stays with the club' }).count()) === 1 &&
      (await noteIn('.modal', 'warning', 'status', '3 public links still working')(page)) &&
      (await calls('removeUser', 0)(page)),
    drive: (page) => click(memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.other}` })),
  },
  {
    key: 'remove-no-links',
    overlay: true,
    note: 'a member with no public links: the same dialog with no warning, so the warning is never boilerplate',
    proof: async (page) =>
      (await dialogTitled('Remove member')(page)) &&
      (await modal(page).locator('.note-warning').count()) === 0 &&
      (await calls('removeUser', 0)(page)),
    drive: (page) => click(memberRow(page, MEMBERS.invited).getByRole('button', { name: `Remove ${MEMBERS.invited}` })),
  },
  {
    key: 'remove-pending',
    state: 'inflight',
    overlay: true,
    note: 'the removal in flight: the destructive control reads Removing… and is frozen',
    proof: inFlight('Removing…', 'removeUser'),
    drive: async (page) => {
      if (!(await click(memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.other}` }))))
        return false
      await pause(page)
      return click(modalButton(page, 'Remove member'))
    },
  },
  {
    key: 'remove-failed',
    state: 'writefails',
    overlay: true,
    note: 'the removal refused: the server sentence in a danger Note, and the member still listed',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'only admin cannot be removed')(page)) &&
      (await dialogTitled('Remove member')(page)) &&
      (await calls('removeUser', 1)(page)),
    drive: async (page) => {
      if (!(await click(memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.other}` }))))
        return false
      await pause(page)
      return click(modalButton(page, 'Remove member'))
    },
  },
  {
    key: 'remove-ok',
    note: 'the member removed: the row gone, the success Note saying their content stays, and focus on that message',
    proof: async (page) =>
      (await memberRow(page, MEMBERS.other).count()) === 0 &&
      (await noteIn('.card', 'success', 'status', 'content stays with the club')(page)) &&
      (await focusOnOutcome('success')(page)) &&
      (await calls('removeUser', 1)(page)) &&
      // The member the dialog named, which is the worst thing on either
      // screen to get wrong.
      (await callArgs('removeUser', { userId: MEMBERS.other })(page)),
    drive: async (page) => {
      if (!(await click(memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.other}` }))))
        return false
      await pause(page)
      return click(modalButton(page, 'Remove member'))
    },
  },
  {
    key: 'remove-last-admin-refused',
    state: 'lastadmin',
    note: "the club's only admin: Remove is inert, a sentence in the row says why, and the control points at it",
    proof: async (page) =>
      (await memberRow(page, MEMBERS.admin).getByRole('button', { name: `Remove ${MEMBERS.admin}` }).isDisabled()) &&
      /* Scoped to the members card like every other locator in this file.
         It read every .admin-row on the page and took the first whose text
         held the name, which reaches the Roles card too. */
      (await memberRow(page, MEMBERS.admin).evaluate((row, name) => {
        const btn = row.querySelector(`button[aria-label="Remove ${name}"]`)
        const id = btn ? btn.getAttribute('aria-describedby') : null
        const said = id ? document.getElementById(id)?.textContent ?? '' : ''
        return said.includes('only admin cannot be removed')
      }, MEMBERS.admin)) &&
      (await calls('removeUser', 0)(page)),
  },
  {
    key: 'remove-absent-on-self',
    note: 'the signed in member: no Remove at all on their own row, which is the one the function refuses outright',
    /* The absence of a CONTROL rather than of one exact label: a Remove that
       lost its own name would satisfy a proof written against the string. The
       row carries exactly one button and it is Manage, and the row beside it
       carries two, which is what stops "one button" holding for a page that
       renders no actions at all. */
    proof: async (page) =>
      (await memberRow(page, MEMBERS.me).getByRole('button').count()) === 1 &&
      (await memberRow(page, MEMBERS.me).getByRole('button', { name: manage(MEMBERS.me), exact: true }).count()) === 1 &&
      (await memberRow(page, MEMBERS.other).getByRole('button').count()) === 2,
  },

  /* ---- the roles manager ---- */
  {
    key: 'role-system-locked',
    note: 'a system role: a count and the System badge, and no Rename or Delete anywhere on the row',
    proof: async (page) =>
      (await roleRow(page, ROLES.coach).locator('.badge').filter({ hasText: 'System' }).count()) === 1 &&
      (await roleRow(page, ROLES.coach).getByRole('button').count()) === 0 &&
      (await roleRow(page, ROLES.custom).getByRole('button', { name: renameOf(ROLES.custom), exact: true }).count()) === 1,
  },
  {
    key: 'role-create-disabled',
    note: 'nothing typed: Create role is inert and no role is created',
    proof: async (page) =>
      (await card(page, 'Roles').getByRole('button', { name: 'Create role' }).isDisabled()) &&
      (await calls('createRole', 0)(page)),
  },
  {
    key: 'role-create-valid',
    note: "a label typed: the key the product derives is shown under the field, Create is live, and nothing is created",
    proof: async (page) =>
      (await card(page, 'Roles').getByRole('button', { name: 'Create role' }).isEnabled()) &&
      (await card(page, 'Roles').locator('.field').filter({ hasText: 'team_manager' }).count()) === 1 &&
      (await calls('createRole', 0)(page)),
    drive: (page) => fillIn(card(page, 'Roles').getByLabel('New role', { exact: true }), TYPED_ROLE),
  },
  {
    key: 'role-created',
    note: 'the role created: it joins the list holding nobody, the field is emptied, and focus is back in it',
    proof: async (page) =>
      (await roleRow(page, TYPED_ROLE).locator('.pill').filter({ hasText: '0 members' }).count()) === 1 &&
      (await card(page, 'Roles').getByLabel('New role', { exact: true }).inputValue()) === '' &&
      // The success EMPTIES the field, so Create stays disabled and the
      // browser drops focus. Without this the repair could be deleted and
      // every other assertion here would still hold.
      (await focusedOn(card(page, 'Roles').getByLabel('New role', { exact: true }))(page)) &&
      (await calls('createRole', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(card(page, 'Roles').getByLabel('New role', { exact: true }), TYPED_ROLE))) return false
      return click(card(page, 'Roles').getByRole('button', { name: 'Create role' }))
    },
  },
  {
    key: 'role-create-failed',
    state: 'writefails',
    note: 'the role refused: the danger Note with the server sentence, announced as an alert',
    proof: async (page) =>
      (await noteIn('.card', 'danger', 'alert', 'already exists')(page)) && (await calls('createRole', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(card(page, 'Roles').getByLabel('New role', { exact: true }), TYPED_ROLE))) return false
      return click(card(page, 'Roles').getByRole('button', { name: 'Create role' }))
    },
  },
  {
    key: 'role-rename-open',
    note: 'renaming a custom role: the row becomes a labelled field holding the current name, and nothing is written',
    proof: async (page) =>
      (await renameInput(page).inputValue()) === ROLES.custom && (await calls('renameRole', 0)(page)),
    drive: (page) => click(rowButton(roleRow(page, ROLES.custom), renameOf(ROLES.custom))),
  },
  {
    key: 'role-renamed',
    note: 'the role renamed: the list and every member holding it show the new label, from one write',
    proof: async (page) =>
      (await roleRow(page, 'Kit and Equipment').count()) === 1 &&
      (await memberRow(page, MEMBERS.invited).locator('.pill').filter({ hasText: 'Kit and Equipment' }).count()) === 1 &&
      (await calls('renameRole', 1)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(roleRow(page, ROLES.custom), renameOf(ROLES.custom))))) return false
      await pause(page)
      if (!(await fillIn(renameInput(page), 'Kit and Equipment'))) return false
      return click(card(page, 'Roles').locator('.admin-row').getByRole('button', { name: 'Save', exact: true }))
    },
  },
  {
    key: 'role-rename-failed',
    state: 'writefails',
    note: 'the rename refused: the danger Note with the server sentence, and the row still in its editing state to retry from',
    proof: async (page) =>
      (await noteIn('.card', 'danger', 'alert', 'System roles cannot be renamed')(page)) &&
      (await renameInput(page).count()) === 1 &&
      (await calls('renameRole', 1)(page)),
    drive: async (page) => {
      if (!(await click(rowButton(roleRow(page, ROLES.custom), renameOf(ROLES.custom))))) return false
      await pause(page)
      if (!(await fillIn(renameInput(page), 'Kit and Equipment'))) return false
      return click(card(page, 'Roles').locator('.admin-row').getByRole('button', { name: 'Save', exact: true }))
    },
  },
  {
    key: 'role-delete-open',
    overlay: true,
    note: 'the delete dialog: how many hold the role, what happens to them, and nothing deleted',
    proof: async (page) =>
      (await dialogTitled('Delete role')(page)) &&
      (await modal(page).locator('.modal-copy').filter({ hasText: 'keep their other roles' }).count()) === 1 &&
      (await calls('deleteRole', 0)(page)),
    drive: (page) => click(roleRow(page, ROLES.custom).getByRole('button', { name: `Delete ${ROLES.custom}` })),
  },
  {
    key: 'role-deleted',
    note: 'the role deleted: gone from the list and off the members who held it, the success Note, and focus on it',
    proof: async (page) =>
      (await roleRow(page, ROLES.custom).count()) === 0 &&
      (await memberRow(page, MEMBERS.invited).locator('.badge-danger').count()) === 1 &&
      (await noteIn('.card', 'success', 'status', 'keep their other roles')(page)) &&
      (await focusOnOutcome('success')(page)) &&
      (await calls('deleteRole', 1)(page)),
    drive: async (page) => {
      if (!(await click(roleRow(page, ROLES.custom).getByRole('button', { name: `Delete ${ROLES.custom}` }))))
        return false
      await pause(page)
      return click(modalButton(page, 'Delete role'))
    },
  },

  /* ---- the capability grid ---- */
  {
    key: 'grid-identity',
    note: 'which tick means what: named by capability AND role, checked for the roles that hold it and clear for the ones that do not',
    proof: async (page) =>
      (await tickIs('Manage drills', ROLES.manager, { checked: true, disabled: false })(page)) &&
      (await tickIs('Manage drills', ROLES.coach, { checked: false, disabled: false })(page)) &&
      (await tickIs('See registered players', ROLES.custom, { checked: true, disabled: false })(page)) &&
      (await tickIs('Plan sessions', ROLES.parent, { checked: false, disabled: false })(page)) &&
      (await noWrites(page)),
  },
  {
    key: 'grid-reserved',
    note: 'a reserved capability: held on and inert for Admin, and not offered at all on any other role',
    proof: async (page) =>
      (await tickIs('Manage users', ROLES.admin, { checked: true, disabled: true })(page)) &&
      (await tickIs('Manage the club', ROLES.admin, { checked: true, disabled: true })(page)) &&
      (await tickState('Manage users', ROLES.coach)(page)) === null &&
      (await tickState('Manage the club', ROLES.manager)(page)) === null &&
      // The cell says which rather than being blank: two reserved rows, four
      // roles each, one of which is Admin.
      (await gridCard(page).locator('.cap-none').count()) === 8,
  },
  {
    /* WHAT THIS ISOLATES, stated because a mutation showed it isolates less
       than its first name claimed. Two things refuse this press: the tick is
       DISABLED, and toggle() refuses a reserved key even if it is called.
       Either alone still refuses it, so removing one leaves this entry
       passing; what it catches is a reserved capability becoming editable,
       which is the failure that matters. The disabled half is caught on its
       own by grid-reserved, which reads the control's state. */
    key: 'grid-reserved-inert',
    note: 'a reserved tick refuses the press: it stays on and inert, and no change is queued',
    proof: async (page) =>
      (await tickIs('Manage users', ROLES.admin, { checked: true, disabled: true })(page)) &&
      (await gridCard(page).getByRole('button', { name: /^Review/ }).count()) === 0 &&
      (await calls('saveRoleCaps', 0)(page)),
    drive: (page) => pressCell(page, 'Manage users', ROLES.admin),
  },
  {
    key: 'grid-changed',
    note: 'one tick moved: the pending bar counts it, and nothing is saved until it is confirmed',
    proof: async (page) =>
      (await tickIs('Manage drills', ROLES.coach, { checked: true, disabled: false })(page)) &&
      (await gridCard(page).getByRole('button', { name: 'Review 1 change…' }).count()) === 1 &&
      (await gridCard(page).getByRole('button', { name: 'Discard' }).count()) === 1 &&
      (await calls('saveRoleCaps', 0)(page)),
    drive: (page) => pressTick(page, 'Manage drills', ROLES.coach),
  },
  {
    key: 'grid-discarded',
    note: 'Discard puts the grid back where the server has it, with nothing written',
    proof: async (page) =>
      (await tickIs('Manage drills', ROLES.coach, { checked: false, disabled: false })(page)) &&
      (await gridCard(page).getByRole('button', { name: /^Review/ }).count()) === 0 &&
      (await calls('saveRoleCaps', 0)(page)),
    drive: async (page) => {
      if (!(await pressTick(page, 'Manage drills', ROLES.coach))) return false
      await pause(page)
      return click(gridCard(page).getByRole('button', { name: 'Discard' }))
    },
  },
  {
    key: 'grid-confirm',
    overlay: true,
    note: 'the confirmation: every change named in words, with the club wide consequence, and nothing written yet',
    proof: async (page) =>
      (await dialogTitled('Apply capability changes')(page)) &&
      (await modal(page).locator('.cap-changes li').count()) === 2 &&
      (await modal(page).locator('.cap-changes').filter({ hasText: 'Coach gains Manage drills' }).count()) === 1 &&
      (await modal(page).locator('.cap-changes').filter({ hasText: 'Coach loses Plan sessions' }).count()) === 1 &&
      (await calls('saveRoleCaps', 0)(page)),
    drive: async (page) => {
      if (!(await pressTick(page, 'Manage drills', ROLES.coach))) return false
      if (!(await pressTick(page, 'Plan sessions', ROLES.coach))) return false
      await pause(page)
      return click(gridCard(page).getByRole('button', { name: 'Review 2 changes…' }))
    },
  },
  {
    key: 'grid-applied',
    note: 'the changes applied: the grid holds them, the pending bar is gone, one write says so in words, and focus is on it',
    proof: async (page) =>
      (await tickIs('Manage drills', ROLES.coach, { checked: true, disabled: false })(page)) &&
      (await gridCard(page).getByRole('button', { name: /^Review/ }).count()) === 0 &&
      (await noteIn('.card', 'success', 'status', '1 change applied to the whole club')(page)) &&
      // Applying closes the dialog AND takes the Review button it was opened
      // from with the draft, so Modal's own restore finds its opener gone.
      (await focusOnOutcome('success')(page)) &&
      (await calls('saveRoleCaps', 1)(page)) &&
      /* And EXACTLY that one grant, named the way the tick that made it is.
         The tick, the vanished Review button and the change count are all
         drawn from the pre submit draft, so a payload carrying a capability
         nobody ticked changed what the whole club may do and left every one
         of them looking right. */
      (await callArgs('saveRoleCaps', {
        adds: [`Manage drills for ${ROLES.coach}`],
        removes: [],
      })(page)),
    drive: async (page) => {
      if (!(await pressTick(page, 'Manage drills', ROLES.coach))) return false
      await pause(page)
      if (!(await click(gridCard(page).getByRole('button', { name: 'Review 1 change…' })))) return false
      await pause(page)
      return click(modalButton(page, 'Apply to the whole club'))
    },
  },
  {
    key: 'grid-apply-pending',
    state: 'inflight',
    overlay: true,
    note: 'the apply in flight: the confirm reads Applying… and the grid behind it is frozen',
    proof: async (page) =>
      (await inFlight('Applying…', 'saveRoleCaps')(page)) &&
      (await tickIs('Manage drills', ROLES.coach, { checked: true, disabled: true })(page)),
    drive: async (page) => {
      if (!(await pressTick(page, 'Manage drills', ROLES.coach))) return false
      await pause(page)
      if (!(await click(gridCard(page).getByRole('button', { name: 'Review 1 change…' })))) return false
      await pause(page)
      return click(modalButton(page, 'Apply to the whole club'))
    },
  },
  {
    key: 'grid-apply-failed',
    state: 'writefails',
    overlay: true,
    note: 'the apply refused: the danger Note in the dialog, and the draft still there to retry on',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'shows what saved')(page)) &&
      (await dialogTitled('Apply capability changes')(page)) &&
      (await calls('saveRoleCaps', 1)(page)),
    drive: async (page) => {
      if (!(await pressTick(page, 'Manage drills', ROLES.coach))) return false
      await pause(page)
      if (!(await click(gridCard(page).getByRole('button', { name: 'Review 1 change…' })))) return false
      await pause(page)
      return click(modalButton(page, 'Apply to the whole club'))
    },
  },
  {
    key: 'grid-loading',
    state: 'gridloading',
    note: "the grid's own reads have not answered: its heading and a labelled spinner, with the rest of the page rendered in full",
    proof: async (page) =>
      (await gridCard(page).locator('.loading[role="status"]').count()) === 1 &&
      (await card(page, 'Club members').locator('.admin-row').count()) === 6,
  },
  {
    key: 'grid-unavailable',
    state: 'gridunavailable',
    note: 'a club without the RBAC migrations: the grid says so as an alert, and the rest of the screen still works',
    proof: async (page) =>
      (await gridCard(page).locator('.state-error[role="alert"]').count()) === 1 &&
      (await card(page, 'Club members').locator('.admin-row').count()) === 6,
  },
]

export const TEAM_FLOWS = [
  {
    key: 'teams-default',
    screen: 'adminteams',
    note: 'the screen as it opens: five teams, three with a default bib colour named in words, and nothing written',
    proof: async (page) =>
      (await page.locator('.admin-row').count()) === 5 &&
      (await teamRow(page, TEAMS.first).locator('.bib-swatch').count()) === 1 &&
      (await teamRow(page, TEAMS.first).locator('select').inputValue()) === 'blue' &&
      // The WORD, not only the stored value. Found by mutation: deleting the
      // option's own label left this entry passing, because a value is not a
      // word and 2.16 keeps bib colour paired with one.
      (await selectedWord(teamRow(page, TEAMS.first)) ) === 'Blue' &&
      (await selectedWord(teamRow(page, TEAMS.second))) === 'Red' &&
      // A team with no default shows no swatch at all rather than an empty
      // circle, and the select still carries a word.
      (await teamRow(page, TEAMS.noBib).locator('.bib-swatch').count()) === 0 &&
      (await teamRow(page, TEAMS.noBib).locator('select').inputValue()) === '' &&
      (await selectedWord(teamRow(page, TEAMS.noBib))) === 'No bib' &&
      (await noWrites(page)),
  },
  {
    key: 'teams-empty',
    screen: 'adminteams',
    state: 'noteams',
    note: 'a club with no teams: the empty state says what to do next rather than showing a bare list',
    proof: async (page) =>
      (await page.locator('.empty h3').filter({ hasText: 'No teams yet' }).count()) === 1 &&
      (await page.locator('.admin-row').count()) === 0,
  },
  {
    key: 'teams-loading',
    screen: 'adminteams',
    state: 'adminloading',
    note: 'the teams read has not answered: the labelled spinner, not an empty club',
    // Both halves. The spinner alone would hold for a page that rendered it
    // AND fell through to "No teams yet", which is the reading this state
    // exists to rule out.
    proof: async (page) =>
      (await page.locator('.loading[role="status"] .spinner').count()) === 1 &&
      (await page.locator('.admin-row').count()) === 0 &&
      (await page.locator('.empty').count()) === 0,
  },
  {
    key: 'teams-error',
    screen: 'adminteams',
    state: 'adminerror',
    note: 'the teams read failed: the danger state with its retry, announced as an alert',
    proof: async (page) =>
      (await page.locator('.state-error[role="alert"]').count()) === 1 &&
      (await page.locator('.state-error').getByRole('button', { name: 'Retry' }).count()) === 1,
  },
  {
    key: 'teams-long-name',
    screen: 'adminteams',
    state: 'longnames',
    note: 'a team named as long as a club could type one, including one with no break opportunity at all',
    /* The NAMES, not a row count. Seven rows is true of a club whose long
       teams were called A and B, and the screenshot and the contrast sweep
       are filed under this key. teamRow finds a row by its own Remove
       button's label, so a name that is not rendered has no row. */
    proof: async (page) =>
      (await page.locator('.admin-row').count()) === 7 &&
      (await teamRow(page, TEAMS.long).count()) === 1 &&
      (await teamRow(page, TEAMS.unbroken).count()) === 1 &&
      (await teamRow(page, TEAMS.long).locator('input').inputValue()) === TEAMS.long,
  },
  {
    key: 'teams-add-disabled',
    screen: 'adminteams',
    note: 'nothing typed: Add team is inert and no team is created',
    proof: async (page) =>
      (await page.getByRole('button', { name: 'Add team' }).isDisabled()) && (await calls('insertTeam', 0)(page)),
  },
  {
    key: 'teams-add-valid',
    screen: 'adminteams',
    note: 'a name typed: Add team is live, and it still has not been pressed',
    proof: async (page) =>
      (await page.getByRole('button', { name: 'Add team' }).isEnabled()) && (await calls('insertTeam', 0)(page)),
    drive: (page) => fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM),
  },
  {
    key: 'teams-add-pending',
    screen: 'adminteams',
    state: 'inflight',
    note: 'the add in flight: the submit reads Adding… and is frozen',
    proof: inFlight('Adding…', 'insertTeam'),
    drive: async (page) => {
      if (!(await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM))) return false
      return click(page.getByRole('button', { name: 'Add team' }))
    },
  },
  {
    key: 'teams-add-failed',
    screen: 'adminteams',
    state: 'writefails',
    note: 'the add refused: the danger Note, announced as an alert, with the typed name still there',
    proof: async (page) =>
      (await noteIn('.card', 'danger', 'alert', 'may already exist')(page)) && (await calls('insertTeam', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM))) return false
      return click(page.getByRole('button', { name: 'Add team' }))
    },
  },
  {
    key: 'teams-added',
    screen: 'adminteams',
    note: 'the team added: it joins the list with no bib set, the field is emptied, and focus is back in it',
    proof: async (page) =>
      (await teamRow(page, TYPED_TEAM).count()) === 1 &&
      (await page.getByLabel('New team', { exact: true }).inputValue()) === '' &&
      (await focusedOn(page.getByLabel('New team', { exact: true }))(page)) &&
      (await calls('insertTeam', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM))) return false
      return click(page.getByRole('button', { name: 'Add team' }))
    },
  },
  {
    key: 'teams-rename-unchanged',
    screen: 'adminteams',
    note: 'the name untouched: Rename is inert, so a press cannot write the value that is already there',
    proof: async (page) =>
      (await rowButton(teamRow(page, TEAMS.first), renameOf(TEAMS.first)).isDisabled()) && (await calls('renameTeam', 0)(page)),
  },
  {
    key: 'teams-rename-changed',
    screen: 'adminteams',
    note: 'the name edited: Rename is live, and it still has not been pressed',
    proof: async (page) =>
      (await rowButton(teamRow(page, TEAMS.first), renameOf(TEAMS.first)).isEnabled()) && (await calls('renameTeam', 0)(page)),
    drive: (page) => fillIn(teamRow(page, TEAMS.first).locator('input'), TYPED_TEAM_RENAME),
  },
  {
    key: 'teams-rename-pending',
    screen: 'adminteams',
    state: 'inflight',
    note: 'the rename in flight: the control reads Renaming… and is frozen',
    proof: inFlight('Renaming…', 'renameTeam'),
    drive: async (page) => {
      if (!(await fillIn(teamRow(page, TEAMS.first).locator('input'), TYPED_TEAM_RENAME))) return false
      return click(rowButton(teamRow(page, TEAMS.first), renameOf(TEAMS.first)))
    },
  },
  {
    key: 'teams-rename-failed',
    screen: 'adminteams',
    state: 'writefails',
    note: 'the rename refused: THIS row says so rather than swallowing it, which is what it used to do',
    /* Scoped to the row that was driven, and naming the team. `.admin-row` as
       a CSS scope matched a note on ANY row, and the substring stopped short
       of the only token in the sentence that tells the rows apart. */
    proof: async (page) =>
      (await rowNote(teamRow(page, TEAMS.first), 'danger', `Could not rename ${TEAMS.first}`)(page)) &&
      (await teamRow(page, TEAMS.second).locator('.note-danger').count()) === 0 &&
      (await calls('renameTeam', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(teamRow(page, TEAMS.first).locator('input'), TYPED_TEAM_RENAME))) return false
      return click(rowButton(teamRow(page, TEAMS.first), renameOf(TEAMS.first)))
    },
  },
  {
    key: 'teams-renamed',
    screen: 'adminteams',
    note: 'the rename stuck: the row carries the new name, focus is back in its field, and one write was made',
    proof: async (page) =>
      (await teamRow(page, TYPED_TEAM_RENAME).count()) === 1 &&
      (await teamRow(page, TYPED_TEAM_RENAME).locator('input').inputValue()) === TYPED_TEAM_RENAME &&
      (await teamRow(page, TEAMS.first).count()) === 0 &&
      // Settling makes the stored name equal the draft, so Rename goes inert
      // under the press and the browser blurs it.
      (await focusedOn(teamRow(page, TYPED_TEAM_RENAME).locator('input'))(page)) &&
      (await calls('renameTeam', 1)(page)),
    drive: async (page) => {
      if (!(await fillIn(teamRow(page, TEAMS.first).locator('input'), TYPED_TEAM_RENAME))) return false
      return click(rowButton(teamRow(page, TEAMS.first), renameOf(TEAMS.first)))
    },
  },
  {
    key: 'teams-bib-set',
    screen: 'adminteams',
    note: 'a default bib chosen: the colour is named in words, the swatch appears beside it, and focus stays on that row\'s select',
    proof: async (page) =>
      (await teamRow(page, TEAMS.noBib).locator('select').inputValue()) === 'green' &&
      (await teamRow(page, TEAMS.noBib).locator('.bib-swatch').count()) === 1 &&
      // THIS row's select, not any: the write disables the control under the
      // coach's finger and the restore has to put it back where they were.
      (await focusedOn(teamRow(page, TEAMS.noBib).locator('select'))(page)) &&
      (await calls('setTeamBib', 1)(page)),
    drive: (page) => choose(teamRow(page, TEAMS.noBib).locator('select'), 'green'),
  },
  {
    key: 'teams-bib-cleared',
    screen: 'adminteams',
    note: 'a default bib cleared: No bib in words, the swatch gone, and one write',
    proof: async (page) =>
      (await teamRow(page, TEAMS.first).locator('select').inputValue()) === '' &&
      (await teamRow(page, TEAMS.first).locator('.bib-swatch').count()) === 0 &&
      (await calls('setTeamBib', 1)(page)),
    drive: (page) => choose(teamRow(page, TEAMS.first).locator('select'), ''),
  },
  {
    key: 'teams-bib-pending',
    screen: 'adminteams',
    state: 'inflight',
    note: 'the bib change in flight: the select is frozen while the write is out',
    proof: async (page) =>
      (await teamRow(page, TEAMS.noBib).locator('select').isDisabled()) && (await calls('setTeamBib', 1)(page)),
    drive: (page) => choose(teamRow(page, TEAMS.noBib).locator('select'), 'green'),
  },
  {
    key: 'teams-bib-failed',
    screen: 'adminteams',
    state: 'writefails',
    note: 'the bib change refused: THIS row says so rather than swallowing it, which is what it used to do',
    proof: async (page) =>
      (await rowNote(teamRow(page, TEAMS.noBib), 'danger', `Could not change the bib colour for ${TEAMS.noBib}`)(page)) &&
      (await teamRow(page, TEAMS.first).locator('.note-danger').count()) === 0 &&
      (await calls('setTeamBib', 1)(page)),
    drive: (page) => choose(teamRow(page, TEAMS.noBib).locator('select'), 'green'),
  },
  {
    key: 'teams-remove-open',
    screen: 'adminteams',
    overlay: true,
    note: 'the removal dialog: what references the team, that nothing is deleted, and that a team only session never widens',
    proof: async (page) =>
      (await dialogTitled('Remove team')(page)) &&
      (await modal(page).locator('.modal-copy').filter({ hasText: 'No sessions, people' }).count()) === 1 &&
      (await modal(page).locator('.modal-copy').filter({ hasText: 'never widens to the whole club' }).count()) === 1 &&
      (await modal(page).locator('.modal-copy').filter({ hasText: 'become Unassigned' }).count()) === 1 &&
      (await calls('deleteTeam', 0)(page)),
    drive: (page) => click(teamRow(page, TEAMS.first).getByRole('button', { name: `Remove ${TEAMS.first}` })),
  },
  {
    key: 'teams-remove-counts',
    screen: 'adminteams',
    overlay: true,
    note: 'the dialog counts what references the team: three members and one session for Titans, not a sentence shaped like a count',
    /* The NUMBERS, not the shape. A regex over "\\d+ members and \\d+ sessions"
       is satisfied by "0 members and 0 sessions", which is exactly the
       generic sentence this entry's name rules out. Counted from the
       fixtures: one member is on Titans specifically (Priya) and two hold the
       all teams flag (the signed in member and Marguerite), and one session
       covers it. */
    proof: async (page) =>
      page.evaluate(() => {
        const said = [...document.querySelectorAll('.modal .modal-copy')].map((p) => p.textContent ?? '').join(' ')
        return said.includes('3 members and 1 session reference this team')
      }),
    drive: (page) => click(teamRow(page, TEAMS.first).getByRole('button', { name: `Remove ${TEAMS.first}` })),
  },
  {
    key: 'teams-remove-pending',
    screen: 'adminteams',
    state: 'inflight',
    overlay: true,
    note: 'the removal in flight: the destructive control reads Removing… and is frozen',
    proof: inFlight('Removing…', 'deleteTeam'),
    drive: async (page) => {
      if (!(await click(teamRow(page, TEAMS.first).getByRole('button', { name: `Remove ${TEAMS.first}` })))) return false
      await pause(page)
      return click(modalButton(page, 'Remove'))
    },
  },
  {
    key: 'teams-remove-failed',
    screen: 'adminteams',
    state: 'writefails',
    overlay: true,
    note: 'the removal refused: the danger Note in the dialog, and the team still listed behind it',
    proof: async (page) =>
      (await noteIn('.modal', 'danger', 'alert', 'Could not remove the team')(page)) &&
      (await dialogTitled('Remove team')(page)) &&
      (await calls('deleteTeam', 1)(page)),
    drive: async (page) => {
      if (!(await click(teamRow(page, TEAMS.first).getByRole('button', { name: `Remove ${TEAMS.first}` })))) return false
      await pause(page)
      return click(modalButton(page, 'Remove'))
    },
  },
  {
    key: 'teams-removed',
    screen: 'adminteams',
    note: 'the team removed: the row gone, the success Note repeating that nothing else was, and focus on that message',
    proof: async (page) =>
      (await teamRow(page, TEAMS.first).count()) === 0 &&
      (await noteIn('.card', 'success', 'status', 'No sessions, people or players were removed')(page)) &&
      (await focusOnOutcome('success')(page)) &&
      (await calls('deleteTeam', 1)(page)),
    drive: async (page) => {
      if (!(await click(teamRow(page, TEAMS.first).getByRole('button', { name: `Remove ${TEAMS.first}` })))) return false
      await pause(page)
      return click(modalButton(page, 'Remove'))
    },
  },

  /* ---- COACH-1B: the club's team order ----
     The order is a DRAFT until Save team order: every entry that moves a row
     and does not press Save proves nothing was written, and the ones that
     press it prove what was sent, whole. */
  {
    key: 'teams-order-default',
    screen: 'adminteams',
    note: 'the club order as it opens, configured: the saved order sentence, the rows by STORED position rather than by name or by the read order, the two boundaries disabled, Save withheld, and nothing written',
    proof: async (page) =>
      (await page.locator('.admin-hint').filter({ hasText: 'Saved club order' }).count()) === 1 &&
      (await orderOf(page)).join(',') === 'Trojans,Titans,Gladiators,Argonauts,Spartans' &&
      (await positionsOf(page)).join(',') === '1,2,3,4,5' &&
      (await page.getByRole('button', { name: 'Move Trojans up', exact: true }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Move Spartans down', exact: true }).isDisabled()) &&
      !(await page.getByRole('button', { name: 'Move Trojans down', exact: true }).isDisabled()) &&
      !(await page.getByRole('button', { name: 'Move Spartans up', exact: true }).isDisabled()) &&
      (await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
  },
  {
    key: 'teams-order-unset',
    screen: 'adminteams',
    state: 'orderunset',
    note: 'a club that has never placed a team: the order is SAID to be not set, the list is alphabetical and named as such, and Save is offered without a move',
    proof: async (page) =>
      (await page.locator('.note-warning').filter({ hasText: 'Team order is not set' }).count()) === 1 &&
      (await page.locator('.note-warning').filter({ hasText: 'listed alphabetically, which is not a coaching order' }).count()) === 1 &&
      (await orderOf(page)).join(',') === 'Argonauts,Gladiators,Spartans,Titans,Trojans' &&
      !(await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
  },
  {
    key: 'teams-order-incomplete',
    screen: 'adminteams',
    state: 'orderincomplete',
    note: 'two teams placed and three not: the incomplete sentence names the three, the placed teams lead by position and the rest follow alphabetically',
    proof: async (page) =>
      (await page
        .locator('.note-warning')
        .filter({ hasText: 'Team order is incomplete: Argonauts, Gladiators and Spartans have no position yet' })
        .count()) === 1 &&
      (await orderOf(page)).join(',') === 'Trojans,Titans,Argonauts,Gladiators,Spartans' &&
      !(await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
  },
  {
    key: 'teams-order-moved',
    screen: 'adminteams',
    note: 'one press of Move up: the row moves, every position renumbers, the draft is named as unsaved, Save is offered, and NOTHING is written',
    proof: async (page) =>
      (await orderOf(page)).join(',') === 'Titans,Trojans,Gladiators,Argonauts,Spartans' &&
      (await positionsOf(page)).join(',') === '1,2,3,4,5' &&
      (await page.getByRole('button', { name: 'Move Titans up', exact: true }).isDisabled()) &&
      !(await page.getByRole('button', { name: 'Move Trojans up', exact: true }).isDisabled()) &&
      (await page.locator('.admin-order-save .admin-hint').filter({ hasText: 'Not saved yet' }).count()) === 1 &&
      (await page.locator('.admin-hint').filter({ hasText: 'changes not yet stored' }).count()) === 1 &&
      !(await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
    drive: (page) => click(page.getByRole('button', { name: 'Move Titans up', exact: true })),
  },
  {
    key: 'teams-order-saved',
    screen: 'adminteams',
    note: 'the moved order saved: ONE write carrying the whole intended order and the positions the screen read, the success note with focus on it, the saved order sentence again, Save withheld again, and the refetch NOT taken for another admin\'s change',
    proof: async (page) =>
      (await calls('saveTeamOrder', 1)(page)) &&
      (await page.locator('.note-warning[role="status"]').count()) === 0 &&
      (await lastWriteWas(page, 'saveTeamOrder', {
        orderedIds: ['titans', 'trojans', 'gladiators', 'argonauts', 'spartans'],
        expected: READ_POSITIONS,
      })) &&
      (await page.locator('.note-success[role="status"]').filter({ hasText: 'Team order saved' }).count()) === 1 &&
      (await page.evaluate(() => document.activeElement?.querySelector('[role="status"]')?.textContent ?? '')) === 'Team order saved.' &&
      (await orderOf(page)).join(',') === 'Titans,Trojans,Gladiators,Argonauts,Spartans' &&
      (await positionsOf(page)).join(',') === '1,2,3,4,5' &&
      (await page.locator('.admin-hint').filter({ hasText: 'Saved club order' }).count()) === 1 &&
      (await saveOrderButton(page).isDisabled()),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await click(saveOrderButton(page))),
  },
  {
    key: 'teams-order-accepted-unset',
    screen: 'adminteams',
    state: 'orderunset',
    note: 'Save pressed on an unset club with nothing moved: the alphabetical order shown is accepted as the club order, in one write, and the screen says it is saved',
    proof: async (page) =>
      (await calls('saveTeamOrder', 1)(page)) &&
      (await lastWriteWas(page, 'saveTeamOrder', {
        orderedIds: ['argonauts', 'gladiators', 'spartans', 'titans', 'trojans'],
        expected: UNSET_POSITIONS,
      })) &&
      (await page.locator('.note-success[role="status"]').filter({ hasText: 'Team order saved' }).count()) === 1 &&
      (await page.locator('.admin-hint').filter({ hasText: 'Saved club order' }).count()) === 1,
    drive: (page) => click(saveOrderButton(page)),
  },
  {
    key: 'teams-order-pending',
    screen: 'adminteams',
    state: 'inflight',
    note: 'the order write in flight: the gerund label, every Move frozen, Add team and Remove frozen so the draft cannot be invalidated under the write (Enter in the New team field adds nothing either), and a rename still live',
    proof: async (page) =>
      (await saveOrderButton(page).isDisabled()) &&
      (await page.getByRole('button', { name: 'Saving order…', exact: true }).count()) === 1 &&
      (await page.getByRole('button', { name: 'Move Gladiators up', exact: true }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Move Gladiators down', exact: true }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Remove Gladiators', exact: true }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Add team', exact: true }).isDisabled()) &&
      !(await teamRow(page, TEAMS.first).locator('input').isDisabled()) &&
      (await calls('insertTeam', 0)(page)) &&
      (await calls('saveTeamOrder', 1)(page)),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await click(saveOrderButton(page))) &&
      (await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM)) &&
      (await page.getByLabel('New team', { exact: true }).press('Enter').then(() => true)),
  },
  {
    key: 'teams-order-failed',
    screen: 'adminteams',
    state: 'writefails',
    note: 'the order write refused: the alert says so and holds focus, the list keeps the arrangement as unsaved after the refetch lands, no success is claimed, no refresh warning is raised, and Save is offered again rather than the refusal being swallowed',
    proof: async (page) =>
      (await page.locator('.note-danger[role="alert"]').filter({ hasText: 'Could not save the team order' }).count()) === 1 &&
      (await page.evaluate(() => !!document.activeElement?.querySelector('.note-danger[role="alert"]'))) &&
      (await orderOf(page)).join(',') === 'Titans,Trojans,Gladiators,Argonauts,Spartans' &&
      (await page.locator('.admin-order-save .admin-hint').filter({ hasText: 'Not saved yet' }).count()) === 1 &&
      (await page.locator('.note-warning[role="status"]').count()) === 0 &&
      !(await saveOrderButton(page).isDisabled()) &&
      (await page.locator('.note-success').count()) === 0 &&
      (await calls('saveTeamOrder', 1)(page)),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await click(saveOrderButton(page))),
  },
  {
    key: 'teams-order-refreshed-under-draft',
    screen: 'adminteams',
    note: "another admin's order landing under an open draft: the draft is dropped, the screen says why as a status, the list shows what is now stored, Save is withheld again, and this screen wrote nothing",
    proof: async (page) =>
      (await page.locator('.note-warning[role="status"]').filter({ hasText: "The club's teams changed while the order was being arranged" }).count()) === 1 &&
      (await orderOf(page)).join(',') === 'Spartans,Argonauts,Gladiators,Titans,Trojans' &&
      (await positionsOf(page)).join(',') === '1,2,3,4,5' &&
      (await page.locator('.admin-order-save .admin-hint').filter({ hasText: 'Not saved yet' }).count()) === 0 &&
      (await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await page
        .evaluate(() => window.__adminStore.saveTeamOrder(['spartans', 'argonauts', 'gladiators', 'titans', 'trojans']))
        .then(() => true)),
  },
  {
    key: 'teams-order-refresh-keeps-agreeing-draft',
    screen: 'adminteams',
    note: 'a refetch that changed nothing lands under an open draft: the arrangement is kept, no status is raised, and Save stays offered',
    proof: async (page) =>
      (await page.locator('.note-warning[role="status"]').count()) === 0 &&
      (await orderOf(page)).join(',') === 'Titans,Trojans,Gladiators,Argonauts,Spartans' &&
      (await page.locator('.admin-order-save .admin-hint').filter({ hasText: 'Not saved yet' }).count()) === 1 &&
      !(await saveOrderButton(page).isDisabled()) &&
      (await noWrites(page)),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await page
        .evaluate(() => window.__adminStore.saveTeamOrder(['trojans', 'titans', 'gladiators', 'argonauts', 'spartans']))
        .then(() => true)),
  },
  {
    key: 'teams-order-blocked-while-adding',
    screen: 'adminteams',
    state: 'inflight',
    note: 'a team insert in flight: Save team order is withheld until the read that carries the new team, so an order that does not know it cannot be sent',
    proof: async (page) =>
      (await calls('insertTeam', 1)(page)) &&
      (await page.getByRole('button', { name: 'Adding…', exact: true }).count()) === 1 &&
      (await saveOrderButton(page).isDisabled()) &&
      (await calls('saveTeamOrder', 0)(page)),
    drive: async (page) =>
      (await click(page.getByRole('button', { name: 'Move Titans up', exact: true }))) &&
      (await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM)) &&
      (await click(page.getByRole('button', { name: 'Add team', exact: true }))),
  },
  {
    key: 'teams-order-new-team-unplaced',
    screen: 'adminteams',
    note: 'a team added to a configured club is UNPLACED: the order reads incomplete naming it, it lands last, and no order was written for it',
    proof: async (page) =>
      (await page
        .locator('.note-warning')
        .filter({ hasText: `Team order is incomplete: ${TYPED_TEAM} has no position yet` })
        .count()) === 1 &&
      (await orderOf(page)).join(',') === `Trojans,Titans,Gladiators,Argonauts,Spartans,${TYPED_TEAM}` &&
      (await calls('insertTeam', 1)(page)) &&
      (await calls('saveTeamOrder', 0)(page)),
    drive: async (page) =>
      (await fillIn(page.getByLabel('New team', { exact: true }), TYPED_TEAM)) &&
      (await click(page.getByRole('button', { name: 'Add team', exact: true }))),
  },
]

/* ---- the capability matrix --------------------------------------------
   The point of these is that mounting a component in a harness grants
   nothing: both screens sit behind a real RequireCap, and a member without
   the capability is redirected to Home rather than shown an empty frame.

   The route witness is what proves the redirect landed: the harness routes in
   memory, so window.location says nothing, and a blank page, a guard
   returning null and a redirect to the wrong route all look the same from the
   markup. */
const redirectedHome = async (page) =>
  (await page.locator('.content[data-path="/"]').count()) === 1 &&
  (await page.getByRole('heading', { name: 'Users', exact: true }).count()) === 0 &&
  (await page.getByRole('heading', { name: 'Teams', exact: true }).count()) === 0

export const ADMIN_ROLES_MATRIX = [
  {
    key: 'users-role-holder',
    note: 'a holder of users.manage: the whole screen, which is the only set that gets it',
    proof: async (page) => (await page.getByRole('heading', { name: 'Users', exact: true }).count()) === 1,
  },
  {
    key: 'users-role-partial-admin',
    caps: 'coach',
    note: 'a partial administrator holding teams.manage and club.manage but NOT users.manage: redirected, not shown a frame',
    proof: redirectedHome,
  },
  {
    key: 'users-role-planner',
    caps: 'planner',
    note: 'a coach who can only plan: redirected',
    proof: redirectedHome,
  },
  {
    key: 'users-role-parent',
    caps: 'parent',
    note: 'the lowest capability member the product has: redirected',
    proof: redirectedHome,
  },
  {
    key: 'teams-role-holder',
    screen: 'adminteams',
    caps: 'coach',
    note: 'a holder of teams.manage who is not a user administrator: the Teams screen in full, which is the two capabilities staying apart',
    proof: async (page) =>
      (await page.getByRole('heading', { name: 'Teams', exact: true }).count()) === 1 &&
      (await page.locator('.admin-row').count()) === 5,
  },
  {
    key: 'teams-role-planner',
    screen: 'adminteams',
    caps: 'planner',
    note: 'a coach without teams.manage: redirected, not shown a frame',
    proof: redirectedHome,
  },
  {
    key: 'teams-role-parent',
    screen: 'adminteams',
    caps: 'parent',
    note: 'the lowest capability member the product has: redirected',
    proof: redirectedHome,
  },
]

// Every entry the tools drive, in one list, so a tool cannot cover the flows
// and quietly skip the capability matrix.
export const ADMIN_ENTRIES = [...USER_FLOWS, ...TEAM_FLOWS, ...ADMIN_ROLES_MATRIX]

// The query string an admin entry's page opens on. The default capability set
// is the users.manage holder, because it is the only one either screen fully
// renders for; an entry that means somebody else names them.
export function queryForAdmin(entry, extra = {}) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  const q = new URLSearchParams({
    screen: entry.screen ?? 'adminusers',
    caps: entry.caps ?? 'clubadmin',
    ...clean,
  })
  if (entry.state && entry.state !== 'default') q.set('state', entry.state)
  return q
}

export const urlForAdmin = (base, entry, extra = {}) => `${base}/?${queryForAdmin(entry, extra)}`

/* Drives an entry and proves the state its name claims. Returns the reason it
   failed, or null on success.

   The proof is not decoration. Every entry files a screenshot or a
   measurement under a name that asserts an outcome, and a press that quietly
   no-ops leaves an untouched page under that name, which reads as evidence. */
export async function runAdminFlow(page, entry) {
  if (entry.drive && !(await entry.drive(page))) return 'the controls it drives are not on the page'
  await page.waitForTimeout(350)
  if (!entry.proof) return `the entry claims "${entry.note}" and nothing checks it`
  const held = await entry.proof(page).catch(() => false)
  return held ? null : 'it was driven, but the state its name claims never held'
}
