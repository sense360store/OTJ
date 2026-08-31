// Drives Chromium over the acceptance matrix the Design Read's Part 4 names,
// and writes one PNG per surface, width, theme, capability variant and state.
// Development only.
//
//   node tools/visual/shoot.mjs [outDir]
//
// Expects the harness to be serving: npx vite --config vite.visual.config.ts
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { assertServingCurrentBuild } from './fresh.mjs'
import { DIALOGS, openDialog, openRowMenu, queryFor, DIALOG_PLAYER } from './dialogs.mjs'
import { ACCOUNT_FLOWS, longValuesRendered, queryForFlow, runFlow } from './account.mjs'
import { AUTH_FLOWS, BRAND, GUARD_CASES, brandRendered, runAuthFlow, urlForAuth } from './auth.mjs'
import { FEEDBACK_ENTRIES, queryForFeedback, runFeedbackFlow } from './feedback.mjs'
import { ADMIN_ENTRIES, queryForAdmin, runAdminFlow } from './admin.mjs'

const OUT = process.argv[2] ?? 'visual-shots'
const BASE = process.env.HARNESS ?? 'http://localhost:5199'
await assertServingCurrentBuild(BASE)
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium'

// The seven widths from Part 4, plus 900 where the breakpoint itself matters.
const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1600]
const PHONE = [360, 390, 430, 768, 900]

// An auth entry by key. A missing key is a thrown error at load rather than a
// silently absent shot, because a shot that is not taken is not a shot that
// failed: nothing in the run would mention it.
const authFlow = (key) => {
  const found = AUTH_FLOWS.find((f) => f.key === key)
  if (!found) throw new Error(`no auth flow named ${key}`)
  return found
}

// The same, for the feedback entries, and for the same reason: a missing key
// is a thrown error at load rather than a silently absent shot.
const feedbackEntry = (key) => {
  const found = FEEDBACK_ENTRIES.find((f) => f.key === key)
  if (!found) throw new Error(`no feedback entry named ${key}`)
  return found
}

// The same, for the admin entries, and for the same reason.
const adminEntry = (key) => {
  const found = ADMIN_ENTRIES.find((e) => e.key === key)
  if (!found) throw new Error(`no admin entry named ${key}`)
  return found
}

const SHOTS = [
  // Home and Sessions in every capability variant they render.
  ...['home', 'sessions'].flatMap((screen) =>
    ['coach', 'viewer', 'parent'].flatMap((caps) =>
      WIDTHS.map((w) => ({ screen, caps, w })),
    ),
  ),
  // Login is outside the shell, so it has no capability variant. Every state
  // it can be driven into is in the VISUAL-02 block at the end of this list,
  // beside Set Password's, because the two screens are one family and one
  // driver reaches both.
  ...WIDTHS.map((w) => ({ screen: 'login', w })),
  // The More sheet only exists under the phone breakpoint, and only for a
  // member whose capability set fills the overflow.
  ...PHONE.map((w) => ({ screen: 'home', caps: 'coach', w, open: 'more' })),
  // A dialog at every width plus the 900px changeover, where a form dialog
  // becomes a bottom sheet.
  ...[...WIDTHS, 900].map((w) => ({ screen: 'dialog', w })),
  // Every primitive and state in one render.
  ...[390, 1280].map((w) => ({ screen: 'primitives', w })),

  /* ---- VISUAL-02, Registered players ---------------------------------
     The wave's primary acceptance surface, and the one that carries the two
     primitives VISUAL-01 defined and could not accept: the table with its
     card equivalent, and the badge. Part 4 names the table at 1280, the
     column drop at 1024 and the card list at 390 and 360, so the register
     is shot at every width in every capability variant it renders. */
  ...['coach', 'viewer', 'parent'].flatMap((caps) =>
    WIDTHS.map((w) => ({ screen: 'players', caps, w })),
  ),
  // The state matrix, at one phone width and one desktop width each. Every
  // one is the screen's own branch, reached through the query's own flags or
  // through the address the screen opens on, never drawn.
  ...['rowsloading', 'empty', 'error', 'archived', 'withdrawn'].flatMap((state) =>
    [390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state, w })),
  ),
  // The page level gate (the seasons read), and the pre setup call to
  // action, which only a seasons.manage holder sees.
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'loading', w })),
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'admin', state: 'noseason', w })),
  // Selection, in both layouts and across the breakpoint.
  ...[360, 390, 900, 1024, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'select' })),
  // The destructive dialog, at 900 in both of its forms because 2.13 turns a
  // form dialog into a bottom sheet at and below that width.
  ...[360, 390, 900, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'delete' })),
  // Its two refusals, each reached by the real path: a preview the server
  // answered with fewer live players than were asked about, and a selection
  // past the server's cap of 200.
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'stale', w, open: 'delete' })),
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'overlimit', w, open: 'delete' })),
  /* The header's action hierarchy. `allactions` is the fullest header a coach
     can reach: Import from Spond is the one action gated on the team filter,
     so every one of the nine is offered only with a Spond mapped team
     selected, and that is the case the hierarchy has to hold. Shot closed at
     the three phone widths the acceptance names plus a desktop pair, and
     open at the same widths plus the 900px changeover. The capability limited
     variants need no entry of their own: viewer and parent are already shot
     at every width above, and neither is offered an overflow at all. */
  ...[360, 390, 430, 1024, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'allactions', w })),
  ...[360, 390, 430, 900, 1280].map((w) => ({
    screen: 'players',
    caps: 'coach',
    state: 'allactions',
    w,
    open: 'moreactions',
  })),
  /* A ROW's overflow, which is the surface whose item height this slice
     brings to 44px. Shot in both layouts, because above 900px the row shows
     Edit and History beside the trigger and below it the card holds every
     action in the menu, so the two popups are different lists. */
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'rowmenu' })),

  /* ---- VISUAL-02, the six remaining dialog files ----------------------
     Eleven dialogs across six files, plus the states each one owns. Every
     entry is opened by pressing the controls a coach presses, and proves
     both that it is the dialog its name claims and that it is in the state
     its name claims (tools/visual/dialogs.mjs).

     390 and 1280 for all of them, which is the phone and the desktop; the
     five that are forms are also shot at 900, where 2.13 turns a form dialog
     into a bottom sheet and the footer has to stay above the keyboard. */
  ...DIALOGS.flatMap((d) => [390, 1280].map((w) => ({ screen: 'players', caps: 'coach', dialog: d, w }))),
  ...DIALOGS.filter((d) => ['add', 'edit', 'export', 'import-preview', 'renew'].includes(d.key)).map((d) => ({
    screen: 'players',
    caps: 'coach',
    dialog: d,
    w: 900,
  })),

  /* ---- VISUAL-02, the club wide Activity feed ------------------------
     Part 4 names the CSS only row to card reflow at 900, the inline filters
     against the phone filter dialog, Load more, the empty states and long
     names. So the feed is shot at every width plus BOTH sides of the 900px
     boundary, in every capability variant it renders: a holder of audit.view
     and players.view, a holder of audit.view alone (where every player
     reference falls closed), and a member with neither, whom the route guard
     sends to Home. */
  ...['coach', 'auditor'].flatMap((caps) => [...WIDTHS, 900, 901].map((w) => ({ screen: 'activity', caps, w }))),
  ...WIDTHS.map((w) => ({ screen: 'activity', caps: 'viewer', state: 'guarded', w })),
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'parent', state: 'guarded', w })),
  // The state matrix, at one phone width and one desktop width each. Every
  // one is the screen's own branch: `loading` and `error` are the feed read's
  // own flags, `empty` returns no rows, and `longnames` is a long acting
  // adult's name beside a long team name, which are the two strings the feed
  // can render at any length.
  ...['loading', 'error', 'empty', 'longnames'].flatMap((state) =>
    [390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', state, w })),
  ),
  // The batch deep link, which is the one URL persisted filter, with rows and
  // with none. Reached by opening the address a batch chip links to.
  ...[360, 390, 900, 1280].map((w) => ({ screen: 'activity', caps: 'coach', at: 'batch', w })),
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', state: 'empty', at: 'batch', w })),
  // The phone filter overlay, at every width it can be opened at, and once
  // with a filter already applied so its Clear filters footer is shown.
  ...[360, 390, 430, 900].map((w) => ({ screen: 'activity', caps: 'coach', w, open: 'filters' })),
  ...[390].map((w) => ({ screen: 'activity', caps: 'coach', at: 'batch', w, open: 'filters' })),
  // More than one filter at once, driven through the controls a coach uses:
  // the dialog under the breakpoint, the inline bar above it.
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', w, open: 'multifilter' })),
  // Load more, pressed, in both of its states.
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', w, open: 'loadmore' })),
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', state: 'loadingmore', w, open: 'loadmorebusy' })),
  // The gated History dialog, which is the ONE place a child's name appears.
  ...[390, 1280].map((w) => ({ screen: 'activity', caps: 'coach', state: 'history', w, open: 'history' })),

  /* ---- VISUAL-02, the Account screen ---------------------------------
     Part 4 names forms, avatar upload and the success and error outcomes.
     The coach variant is shot at every width plus the 900px boundary, since
     the shell changes there and this page's own rows wrap on the way down.
     The other three capability variants are shot at the two phone widths,
     the boundary and desktop: they differ from the coach only in whether the
     Default team control and the Admin card are there, which is a presence
     rather than a layout, and shooting each of them seven times says the
     same thing four more times. */
  ...[...WIDTHS, 900].map((w) => ({ screen: 'account', caps: 'coach', w })),
  ...['planner', 'parent', 'clubadmin'].flatMap((caps) =>
    [360, 390, 900, 1280].map((w) => ({ screen: 'account', caps, w })),
  ),
  // The states the reads answer with: a coach who has uploaded a photo, the
  // page level gate, and every string the club chooses at the length a club
  // would really make it.
  ...['photo', 'profileloading', 'longvalues'].flatMap((state) =>
    [390, 1280].map((w) => ({ screen: 'account', caps: 'coach', state, w })),
  ),
  /* Every outcome, driven through the controls a coach uses
     (tools/visual/account.mjs). Each entry proves the state its own name
     claims before its screenshot is filed, so a press that quietly no-ops
     fails the run rather than filing an untouched form under a name that
     says otherwise. A phone width and a desktop width each, in both themes,
     because the semantic Note is the thing these shots exist to show and its
     surface, border and glyph all flip. */
  ...ACCOUNT_FLOWS.flatMap((flow) => [390, 1280].map((w) => ({ screen: 'account', caps: 'coach', flow, w }))),

  /* ---- VISUAL-02, Login and Set Password ------------------------------
     The product outside the shell, and the one family it forms. Part 4 names
     Login at all seven widths, so Set Password is shot at all seven beside
     it: it wears the same card, and a family that is only checked at one
     width is a family by assertion.

     Everything else is DRIVEN through tools/visual/auth.mjs, the same entries
     checks.mjs measures and contrast.mjs sweeps, and every one of them proves
     the state its own name claims before its screenshot is filed. Nothing is
     faked: the harness varies what the server answers and who the guard is
     told is signed in, never what is drawn. */
  ...WIDTHS.map((w) => ({ authEntry: authFlow('sp-empty'), w })),
  // Every other state either screen can be driven into, at a phone width and
  // a desktop width, in both themes: the semantic Note is what most of these
  // shots exist to show and its surface, border and glyph all flip.
  ...AUTH_FLOWS.filter((f) => f.key !== 'sp-empty').flatMap((f) =>
    [390, 1280].map((w) => ({ authEntry: f, w })),
  ),
  /* And at 360, the three states that add a note ABOVE the form, which is the
     narrowest case where the card grows and the identity block, the note and
     the two full width buttons have to share 312px. The other driven states
     change a label or a disabled flag and lay out identically to the ones
     already shot at 360, so shooting all eighteen here would file fifteen
     pictures of the same layout. */
  ...['signin-failed', 'link-ok', 'sp-mismatch'].map((key) => ({ authEntry: authFlow(key), w: 360 })),
  // The two strings the CLUB chooses, each at a length a committee would
  // really produce, at the narrowest phone and a desktop.
  ...['longclub', 'longmotto'].flatMap((state) =>
    [360, 390, 1280].map((w) => ({ screen: 'login', state, w })),
  ),
  // What the auth guard does, at each address, for each auth condition. These
  // mount the real App, so the redirect in a shot is the product's own.
  ...GUARD_CASES.flatMap((g) => [390, 1280].map((w) => ({ authEntry: g, w }))),

  /* ---- VISUAL-02, the club feedback log -------------------------------
     Part 4 names create, list, status change as an admin, and the read only
     variant. The list itself is shot at all seven widths in the three
     capability variants it renders: a club.manage holder, an ordinary member
     who filed two of the rows, and the lowest capability member the product
     has. One list carries every axis at once, so an owner's row and a
     stranger's, a promoted item and an unpromoted one, and a row with
     comments beside rows with none are all in every shot. */
  ...['coach', 'viewer', 'parent'].flatMap((caps) =>
    WIDTHS.map((w) => ({ screen: 'feedback', caps, w })),
  ),
  // The page's own state matrix, at one phone width and one desktop width
  // each. Every one is the screen's own branch, reached through the query's
  // own flags or through the rows the read answers with.
  ...['loading', 'error', 'empty', 'longnames'].flatMap((state) =>
    [390, 1280].map((w) => ({ screen: 'feedback', caps: 'coach', state, w })),
  ),
  /* Everything else is DRIVEN through tools/visual/feedback.mjs, the same
     entries checks.mjs measures and contrast.mjs sweeps, and every one of
     them proves the state its own name claims before its screenshot is
     filed. 390 and 1280, in both themes: most of these shots exist to show a
     semantic Note or a Badge, and the surface, border and glyph of each flip
     with the theme. */
  ...FEEDBACK_ENTRIES.flatMap((f) => [390, 1280].map((w) => ({ feedbackEntry: f, w }))),
  /* And at 900 for the six that are a FORM DIALOG, where 2.13 turns one into
     a bottom sheet and the footer has to stay above the keyboard. */
  ...['create-open', 'create-valid', 'edit-open', 'comment-edit-open', 'promote-open', 'delete-open'].map((key) => ({
    feedbackEntry: feedbackEntry(key),
    w: 900,
  })),
  /* And at 360, the states that put an expanded thread or a wrapped action
     cluster in the narrowest card the product designs for. The other driven
     states change a label or a disabled flag and lay out identically to what
     is already shot at 390. */
  ...['expanded-thread', 'expanded-no-details', 'comment-moderation', 'role-member', 'status-pending', 'promote-open'].map((key) => ({
    feedbackEntry: feedbackEntry(key),
    w: 360,
  })),

  /* ---- VISUAL-02, Admin Users and Admin Teams ------------------------
     Both screens at all seven of Part 4's widths, in both themes, because
     what changes across them is the whole composition: the member row's
     controls wrap under the name, the role and team pickers go from four
     columns to one, and the capability grid starts scrolling inside its own
     container. */
  ...['adminusers', 'adminteams'].flatMap((screen) =>
    WIDTHS.map((w) => ({ screen, caps: 'clubadmin', w })),
  ),
  /* Every driven state, at 390 and 1280. Each is DRIVEN through
     tools/visual/admin.mjs, the same entries checks.mjs measures and
     contrast.mjs sweeps, and every one of them proves the state its own name
     claims before its screenshot is filed. Both themes for the same reason
     the feedback matrix uses both: most of these shots exist to show a
     semantic Note or a Badge, and the surface, border and glyph of each flip
     with the theme. */
  ...ADMIN_ENTRIES.flatMap((e) => [390, 1280].map((w) => ({ adminEntry: e, w }))),
  /* And at 900 for the four that are a FORM DIALOG or a destructive one,
     where 2.13 turns a dialog into a bottom sheet and the footer has to stay
     above the keyboard. */
  ...['manage-open', 'remove-open', 'role-delete-open', 'grid-confirm', 'teams-remove-open'].map((key) => ({
    adminEntry: adminEntry(key),
    w: 900,
  })),
  /* And at 360, the states that put a wrapped action cluster, a full width
     picker or the scrolling grid in the narrowest width the product designs
     for. The other driven states change a label or a disabled flag and lay
     out identically to what is already shot at 390. */
  ...[
    'users-default',
    'users-long-names',
    'invite-admin-all-teams',
    'manage-open',
    'remove-open',
    'grid-identity',
    'teams-default',
    'teams-long-name',
    'teams-remove-open',
  ].map((key) => ({ adminEntry: adminEntry(key), w: 360 })),
]

// A state and an ADDRESS are two different things, and two shots that differ
// only by the address would otherwise share a filename and overwrite each
// other. The address rides in the state slot, so no existing name moves.
const name = (s, theme) =>
  [
    // An auth entry names the surface it mounts rather than the query key,
    // so a Set Password shot is filed under `auth` and a Login one under
    // `login` exactly as the browser opened them.
    s.authEntry
      ? (s.authEntry.screen ?? 'auth')
      : s.feedbackEntry
        ? 'feedback'
        : // An admin entry names WHICH of the two screens it drives, because
          // the pair share one driver and one entry list.
          s.adminEntry
          ? (s.adminEntry.screen ?? 'adminusers')
          : s.screen,
    // A feedback entry carries its own capability set, so the name says which
    // member the shot is of rather than defaulting to `na`.
    s.feedbackEntry
      ? (s.feedbackEntry.caps ?? 'coach')
      : s.adminEntry
        ? (s.adminEntry.caps ?? 'clubadmin')
        : (s.caps ?? 'na'),
    // A guard case has no state; what varies is the AUTH CONDITION, so that
    // is what rides in the state slot for it. Not to avoid a collision, which
    // the entry's own key in the next slot already rules out: it is so the
    // filename says which auth state produced the screen, which is the whole
    // of what a guard case claims.
    s.authEntry
      ? (s.authEntry.state ?? s.authEntry.auth ?? 'default') + (s.authEntry.at ? `-at-${s.authEntry.at}` : '')
      : s.dialog
        ? s.dialog.state
        : s.flow
          ? s.flow.state
          : s.feedbackEntry
            ? (s.feedbackEntry.state ?? 'default')
            : s.adminEntry
              ? (s.adminEntry.state ?? 'default')
              : (s.state ?? 'default') + (s.at ? `-at-${s.at}` : ''),
    s.authEntry
      ? `auth-${s.authEntry.key}`
      : s.dialog
        ? `dialog-${s.dialog.key}`
        : s.flow
          ? `flow-${s.flow.key}`
          : s.feedbackEntry
            ? `fb-${s.feedbackEntry.key}`
            : s.adminEntry
              ? `adm-${s.adminEntry.key}`
              : (s.open ?? 'default'),
    theme,
    `${s.w}w`,
  ].join('_') + '.png'

// An overlay is shot at the viewport rather than full page: a full page shot
// of a dialog over a two hundred row register is a picture of the register.
const OVERLAY = new Set(['more', 'delete', 'moreactions', 'rowmenu', 'filters', 'history'])
// A feedback entry says whether it leaves a dialog up, because several of them
// close one on the way to the outcome they claim and those ARE page shots.
const isOverlay = (s) => !!s.dialog || !!s.feedbackEntry?.overlay || !!s.adminEntry?.overlay || OVERLAY.has(s.open)


// Every entry whose name claims a state must PROVE that state before its
// screenshot is filed. Without this the interaction can no-op and leave an
// ordinary page under a name that says otherwise, which is worse evidence
// than a missing file because it looks like proof. The selector is what the
// state actually renders, so a primitive that stops rendering fails here too.
//
// The filename carries TWO claims, and both are proved. `open` is a state the
// run drives by pressing a control; `state` is one the harness's own reads
// answer with. A shot named for a state whose read quietly returned the
// ordinary register is the exact failure this map exists to stop, and the
// state axis was the half that had no proof when it was introduced.
const REACHED = {
  more: '.more-sheet',
  // The header's own overflow, which is a popup rather than the bottom sheet
  // `more` names. Scoped to .players-more so a row menu left open by another
  // press could not stand in for it.
  moreactions: '.players-more .menu-list',
  // And the row's, scoped the other way for the same reason: NOT inside
  // .players-more, so the header's popup cannot stand in for a row's.
  rowmenu: '.menu:not(.players-more) .menu-list',
  select: '.bulk-bar',
  delete: '.modal',
  /* ---- the Activity feed's own driven states ---- */
  // The phone filter overlay, named by its title so the History dialog cannot
  // stand in for it.
  filters: '.modal:has-text("Filters")',
  history: '.modal:has-text("History")',
  // The next page ARRIVED: a fifty first row exists, which cannot happen
  // without the press.
  loadmore: '.activity-list li:nth-child(51)',
  // And the press that never settles: the control disabled and saying so.
  loadmorebusy: '.activity-more button[disabled]',
  // Two filters at once. A predicate, because at 1280 the counted control is
  // display:none (the inline bar is what a coach uses there) and a visibility
  // wait would fail on a state that is correctly reached.
  multifilter: async (page) =>
    page.$eval('.activity-filters-btn', (el) => el.getAttribute('aria-label') === 'Filters, 2 active').catch(() => false),
}

// What each named state actually renders. `default` claims nothing, so it
// needs nothing; every other value MUST be listed, and an unlisted one is a
// failure rather than a pass, so adding a state without its proof cannot go
// quiet. Playwright's :has-text() is what separates two states that render
// the same element with different words.
//
// A value may be a PREDICATE instead of a selector, for a state whose proof is
// not "an element is on screen". `allactions` is one: what it claims is that
// the address put the team filter on the Spond mapped team, which is what
// makes Import from Spond available, and no selector can ask a <select> what
// it is set to. Proving it by some element that merely happens to render
// alongside would be the same false proof this map exists to stop.
const REACHED_STATE = {
  // A state is one thing; what a SCREEN renders for it is another. "The read
  // has not answered" is the register's page level gate and the Activity
  // feed's skeleton rows, because 2.14 asks for a skeleton where the shape is
  // known. A predicate takes the shot as well as the page, so each screen's
  // proof stays exact rather than one being widened to cover the other.
  loading: async (page, s) =>
    s.screen === 'activity' || s.screen === 'feedback'
      ? visible(page, '.skeleton-list')
      : visible(page, '.content > .loading[role="status"]'),
  rowsloading: '.skeleton-list',
  empty: '.empty',
  error: '.state-error[role="alert"]',
  archived: '.note-neutral:has-text("archived and read only")',
  // :visible, because this state renders in whichever of the two layouts the
  // width selects and the other is display:none. Without it a comma list
  // resolves to the first match in DOM ORDER, which is the table row, and
  // every phone width failed against a row it had correctly hidden.
  withdrawn: '.player-card.withdrawn:visible, table.reg-table tr.withdrawn:visible',
  noseason: '.empty:has-text("season")',
  stale: '.modal .note-danger:has-text("out of date")',
  overlimit: '.modal .note-danger:has-text("At most 200")',
  allactions: async (page) =>
    page.$eval('#filter-team', (el) => el.value === 'titans').catch(() => false),
  /* ---- the Activity feed ---- */
  // The route guard's answer. An absence alone is not a proof of it: a blank
  // shell, a redirect to the wrong route and a guard returning null all lack
  // Activity's markup, and all three would be filed under a name claiming a
  // redirect. Codex. So the claim is both halves, Activity gone AND the
  // redirect landed on `/`, read from the harness's route witness rather than
  // from anything the page draws: Home has capability variants and the
  // navigation falls back to Home for a path it does not know, so both can say
  // Home for a route that is not.
  guarded: async (page) =>
    page.evaluate(
      () =>
        document.querySelector('.content')?.getAttribute('data-path') === '/' &&
        !document.querySelector('.activity-list') &&
        !document.querySelector('.activity-filters-btn') &&
        (document.querySelector('h1')?.textContent ?? '') !== 'Activity',
    ),
  // The same state name on two screens, and each proves its OWN long string:
  // the feed's is a long acting adult, the log's is a long title beside a
  // long author. A selector naming one would pass on the screen that renders
  // neither.
  longnames: async (page, s) =>
    s.screen === 'feedback'
      ? visible(page, '.fb-title:has-text("Sessionplannerrecalculates")')
      : visible(page, '.activity-item:has-text("Fotheringay-Wallington-Smythe")'),
  history: '.modal .history-item',
  // What this state alone produces: the press was made and NOTHING arrived.
  // The ordinary feed answers the same press with twelve more rows, so this
  // separates the state from the control that `loadmorebusy` proves.
  loadingmore: async (page) =>
    page.evaluate(() => document.querySelectorAll('.activity-item').length === 50 &&
      !!document.querySelector('.activity-more button[disabled]')),
  /* ---- the Account screen ---- */
  // A photo really rendered, rather than the initials fallback under a name
  // claiming one, AND the removal offered, which only a photo offers.
  photo: async (page) =>
    page.evaluate(
      () =>
        !!document.querySelector('.account-photo img.avatar') &&
        [...document.querySelectorAll('.account-photo-acts button')].some((b) =>
          (b.textContent || '').includes('Remove photo'),
        ),
    ),
  // The page level gate: a labelled load and no account behind it.
  profileloading: async (page) =>
    page.evaluate(
      () => !!document.querySelector('.content > .loading[role="status"]') && !document.querySelector('.account'),
    ),
  // ALL FOUR strings the club chooses, each compared exactly against the
  // fixture, because a selector naming one of them is filed under a name
  // claiming four. Codex.
  longvalues: (page) => longValuesRendered(page),
  /* ---- Login ---- */
  // Each names which of the two club strings it is claiming AND that the
  // other is still ordinary, so a state that quietly made both long could not
  // pass under either name. Compared exactly against the fixture rather than
  // by length. */
  longclub: (page) => brandRendered(page, { name: BRAND.longClub, motto: BRAND.motto }),
  longmotto: (page) => brandRendered(page, { name: BRAND.club, motto: BRAND.longMotto }),
}

async function visible(page, selector) {
  return page.waitForSelector(selector, { state: 'visible', timeout: 3000 }).then(() => true, () => false)
}

async function reached(page, s, theme) {
  let ok = true
  if (s.open) {
    // A selector, or a PREDICATE where the proof is not "an element is on
    // screen": the filter count rides on a control that is display:none above
    // the breakpoint, and a visibility wait would fail a state that is
    // correctly reached.
    const proof = REACHED[s.open]
    if (!proof) {
      failures++
      console.log(`ERROR ${name(s, theme)}: no proof selector for open=${s.open}, so the shot claims a state nothing checked`)
      ok = false
    } else if (!(typeof proof === 'function' ? await proof(page, s) : await visible(page, proof))) {
      failures++
      const shown = typeof proof === 'function' ? `the ${s.open} predicate` : proof
      console.log(`ERROR ${name(s, theme)}: ${shown} never held, so the ${s.open} state was not reached`)
      ok = false
    }
  }
  if (s.state && s.state !== 'default') {
    const proof = REACHED_STATE[s.state]
    if (!proof) {
      failures++
      console.log(`ERROR ${name(s, theme)}: no proof selector for state=${s.state}, so the shot claims a state nothing checked`)
      ok = false
    } else if (!(typeof proof === 'function' ? await proof(page, s) : await visible(page, proof))) {
      failures++
      // A predicate stringifies to its whole body, which buries the message
      // it is attached to. It is named rather than printed.
      const shown = typeof proof === 'function' ? `the ${s.state} predicate` : proof
      console.log(`ERROR ${name(s, theme)}: ${shown} never held, so the ${s.state} state was not reached`)
      ok = false
    }
  }
  return ok
}

await mkdir(OUT, { recursive: true })
// No proxy and no outbound request: the only external resource the harness
// loads is the font stylesheet, and that is served from the cache below.
const browser = await chromium.launch({ executablePath: EXE })
const context = await browser.newContext({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 })

// Google Fonts is not reachable from the browser in every environment, and a
// request that times out costs twelve seconds a page. Serve the cache that
// fetch-fonts.mjs wrote; with no cache, abort the request at once and say so,
// rather than shooting the whole matrix in a fallback typeface
// without noticing.
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
// No cache means every font request is aborted and every shot renders in a
// fallback typeface. These screenshots exist to verify a type scale, so that
// is a failed run rather than a degraded one, and it fails HERE rather than
// after writing the whole matrix as useless PNGs.
if (!existsSync(path.join(FONTS, 'manifest.json'))) {
  console.log('NO FONT CACHE: run `node tools/visual/fetch-fonts.mjs` first. These shots verify a type scale and cannot do that in a fallback face.')
  process.exit(1)
}
const manifest = JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8'))
// A predicate rather than a glob: a glob treats the ? that begins the css2
// query string as a single character wildcard, and the pattern silently
// matches nothing.
const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
await context.route(isFont, async (route) => {
  const file = manifest[route.request().url()]
  if (!file) return route.abort()
  const body = await readFile(path.join(FONTS, file))
  await route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2' })
})
console.log('serving the local font cache')

let failures = 0
// Serving a cache is not the same as rendering in the right typeface: a stale
// or malformed cache produces a CSS decode error, which is a console message
// rather than a pageerror, and Chromium falls back silently. So the claim
// above is checked once against the browser, and a run that made it falsely
// fails rather than shipping the whole matrix in the wrong face.
let fontsChecked = false
async function verifyFonts(page) {
  if (fontsChecked) return
  fontsChecked = true
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
  )
  for (const family of ['Archivo', 'Hanken Grotesk']) {
    if (!loaded.includes(family)) {
      failures++
      console.log(`ERROR font cache served but ${family} did not load: [${loaded.join(', ')}]`)
    }
  }
}

for (const theme of ['light', 'dark']) {
  for (const s of SHOTS) {
    const page = await context.newPage()
    await page.setViewportSize({ width: s.w, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // A dialog entry carries its own state and address (they are not always
    // the same thing), so its query string is built by the module that owns
    // the entry rather than assembled again here.
    // An auth entry owns its whole ADDRESS rather than only its query string,
    // because one of them reproduces an arrival that is defined by its URL
    // fragment: an expired invite or recovery link lands with an error hash
    // and no session, and a case that dropped the fragment would be a case
    // about something else.
    const q = s.dialog
      ? queryFor(s.dialog, { theme, caps: s.caps })
      : s.flow
      ? queryForFlow(s.flow, { theme, caps: s.caps })
      : s.feedbackEntry
      ? queryForFeedback(s.feedbackEntry, { theme })
      : s.adminEntry
      ? queryForAdmin(s.adminEntry, { theme })
      : (() => {
          const p = new URLSearchParams({ screen: s.screen, theme })
          if (s.caps) p.set('caps', s.caps)
          if (s.state) p.set('state', s.state)
          if (s.at) p.set('at', s.at)
          return p
        })()
    const url = s.authEntry ? urlForAuth(BASE, s.authEntry, { theme }) : `${BASE}/?${q}`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts.ready)
    await verifyFonts(page)
    await page.waitForTimeout(250)
    if (s.open === 'more') {
      // The matrix only asks for this with the coach capability set, where
      // the button must exist; a parent legitimately has no More.
      const more = page.getByRole('button', { name: 'More', exact: true })
      if ((await more.count()) === 0) {
        failures++
        console.log(`ERROR ${name(s, theme)}: no More button, so the sheet was never opened`)
      } else {
        await more.first().click()
      }
    }
    // Selection and the destructive dialog are DRIVEN, through the same
    // controls a coach presses: enter selection mode, select every shown row,
    // then open the dialog. Nothing is faked, so a control that stops
    // rendering fails the run rather than producing a plausible shot.
    if (s.open === 'select' || s.open === 'delete') {
      const press = async (nameRe) => {
        const b = page.getByRole('button', { name: nameRe })
        if ((await b.count()) === 0) {
          failures++
          console.log(`ERROR ${name(s, theme)}: no ${nameRe} button, so the ${s.open} state was never reached`)
          return false
        }
        await b.first().click()
        await page.waitForTimeout(150)
        return true
      }
      if (await press(/^Select players$/)) {
        if (s.open === 'delete') {
          if (await press(/^Select all \d+ shown$/)) await press(/^Delete \d+ players?$/)
        }
      }
    }
    if (s.open === 'moreactions') {
      // Pressed, never faked, and named EXACTLY: every row's menu trigger is
      // called "More actions for <child>", so a loose name matches nine
      // controls and the first of them is a row.
      const more = page.getByRole('button', { name: 'More actions', exact: true })
      if ((await more.count()) === 0) {
        failures++
        console.log(`ERROR ${name(s, theme)}: no More actions button, so the overflow was never opened`)
      } else {
        await more.first().click()
        await page.waitForTimeout(150)
      }
    }
    if (s.open === 'rowmenu') {
      // A row's own overflow, opened on a named row so it is the same list at
      // both widths rather than whichever row happens to be first.
      if (!(await openRowMenu(page, DIALOG_PLAYER))) {
        failures++
        console.log(`ERROR ${name(s, theme)}: the row's More actions trigger is not on the page`)
      }
      await page.waitForTimeout(150)
    }
    /* ---- the Activity feed, driven through the controls a coach presses --
       Nothing here is faked: the overlay is opened by its own button, the
       filters are chosen in whichever of the two mount points that width
       shows, Load more is pressed, and View history is pressed on a row. A
       control that stops rendering fails the run rather than producing a
       plausible shot, because reached() then finds no proof. */
    if (s.screen === 'activity' && s.open) {
      const press = async (nameRe, exact) => {
        const b = page.getByRole('button', exact ? { name: nameRe, exact: true } : { name: nameRe })
        if ((await b.count()) === 0) {
          failures++
          console.log(`ERROR ${name(s, theme)}: no ${nameRe} button, so the ${s.open} state was never reached`)
          return false
        }
        await b.first().click()
        await page.waitForTimeout(200)
        return true
      }
      if (s.open === 'filters') await press(/^Filters/)
      if (s.open === 'multifilter') {
        // Below the breakpoint the filters live in the overlay; above it they
        // are the inline bar. The count is the same page state either way,
        // which is the thing worth photographing.
        const phone = s.w <= 900
        if (!phone || (await press(/^Filters/))) {
          const root = phone ? page.locator('.modal') : page.locator('.activity-filters')
          await root.getByLabel('Filter by entity type').selectOption('player')
          await root.getByLabel('Filter by source').selectOption('csv_import')
          await page.waitForTimeout(200)
          if (phone) await press(/^Done$/, true)
        }
      }
      if (s.open === 'loadmore' || s.open === 'loadmorebusy') await press(/^Load more$/, true)
      if (s.open === 'history') await press(/^View history$/, true)
    }
    // An Account outcome carries its own proof, for the same reason: it is
    // reached by typing into the fields and pressing the control a coach
    // presses, and a press that quietly no-ops leaves an untouched form under
    // a name claiming an outcome.
    if (s.flow) {
      const why = await runFlow(page, s.flow)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    // An auth entry carries its own proof for the same reason, and a guard
    // case carries one with nothing to drive: what it claims is what the
    // product's own guard did at that address, which is a state to prove
    // rather than a control to press.
    if (s.authEntry) {
      const why = await runAuthFlow(page, s.authEntry)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    // A feedback entry carries its own proof for the same reason: several of
    // its states ARE a change to the log, and a press that quietly no-ops
    // leaves an untouched list under a name claiming an outcome.
    if (s.feedbackEntry) {
      const why = await runFeedbackFlow(page, s.feedbackEntry)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    // An admin entry carries its own proof for the same reason: most of its
    // states ARE a change to a list of members, roles or teams, and eleven of
    // them are about a write that must NOT have happened, which no selector
    // can see.
    if (s.adminEntry) {
      const why = await runAdminFlow(page, s.adminEntry)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    // A dialog carries its own proof, of the dialog AND of the state its name
    // claims, so a press that quietly no-ops fails here rather than filing an
    // ordinary dialog under a name that says otherwise.
    if (s.dialog) {
      const why = await openDialog(page, s.dialog)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    await reached(page, s, theme)
    await page.screenshot({ path: `${OUT}/${name(s, theme)}`, fullPage: !isOverlay(s) })
    if (errors.length) {
      failures++
      console.log(`ERROR ${name(s, theme)}: ${errors[0].slice(0, 160)}`)
    }
    await page.close()
  }
}

await context.close()
await browser.close()
console.log(`${SHOTS.length * 2} shots written to ${OUT}/, ${failures} with page errors`)
// A crashed page produces a screenshot of a blank or half rendered surface,
// which is worse than no screenshot: it looks like evidence. Fail the run so a
// chained verification cannot accept it on the strength of a log line nobody
// read, the same way checks.mjs fails on a failed check.
if (failures > 0) process.exitCode = 1
