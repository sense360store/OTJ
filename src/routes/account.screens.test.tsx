// =====================================================================
// VISUAL-02, Account: the real page, rendered.
//
// WHAT THIS IS FOR. Account.test.tsx covers the two pieces that are
// presentational over a capability (the Admin card and the team setting).
// This mounts the PAGE, with the data layer stubbed, because what this
// slice changed is page level: which vocabulary draws each section, which
// controls a capability set is offered, and whether every field is still
// bound to its own label with the autocomplete a password manager reads.
//
// WHAT IT DOES NOT DO, and why the harness exists. This project has no
// DOM, so these are static renders: they cover what the page shows for a
// given read. Every OUTCOME on this screen is the result of a write, so
// none of them is reachable here at all. The messages are pinned below as
// source text, which is a tripwire rather than a proof, and the outcomes
// themselves are driven in a browser by tools/visual/account.mjs, which
// types into the fields and presses the control a coach presses.
//
// Names and addresses in the fixtures are invented; the email domain is
// .invalid, which can never resolve.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Team } from '../lib/data'

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
]

// What each read answers, so one describe can vary it without a second mock.
const reads = {
  caps: new Set<string>(['sessions.create']),
  profileLoading: false,
  avatarUrl: null as string | null,
  clubName: 'Ossett Town Juniors' as string | null,
}

const query = <T,>(data: T) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: () => {},
})

const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, error: null })

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useTeams: () => query(TEAMS),
  useClub: () => query({ name: reads.clubName, motto: null, crestUrl: null }),
  useUpdateMyProfile: mutation,
  useUploadAvatar: mutation,
  useRemoveAvatar: mutation,
  useSignedMediaUrl: () => query(null),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'me', email: 'coach@example.invalid' },
    profile: {
      id: 'me',
      full_name: 'Sam Whitfield',
      avatar: null,
      avatar_url: reads.avatarUrl,
      team_id: 'titans',
      created_at: '2026-01-01T00:00:00Z',
    },
    role: 'coach',
    profileLoading: reads.profileLoading,
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: () => Promise.resolve({ data: null, error: null }) } },
}))

const { Account } = await import('./Account')

function page(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Account />
    </MemoryRouter>,
  )
}

// Restore the default reads after a describe has varied them, so the order
// tests run in cannot change what they assert.
function withReads(over: Partial<typeof reads>, run: () => void) {
  const before = { ...reads }
  Object.assign(reads, over)
  try {
    run()
  } finally {
    Object.assign(reads, before)
  }
}

/* ---- the capability boundary ---------------------------------------- */

describe('a capability set is offered exactly the controls it opens', () => {
  it('gives a planner the Default team control and no Admin card', () => {
    const html = page()
    expect(html).toContain('id="default-team"')
    expect(html).not.toContain('set by a club admin')
    expect(html).not.toContain('>Admin<')
    // Feedback is open to every role and is deliberately not in the Admin
    // card, so a member with no admin capability still reaches the log.
    expect(html).toContain('Feedback log')
  })

  it('replaces the control with the admin managed line for a member who cannot plan', () => {
    withReads({ caps: new Set() }, () => {
      const html = page()
      expect(html).not.toContain('id="default-team"')
      expect(html).toContain('Your team is set by a club admin.')
      expect(html).toContain('Feedback log')
    })
  })

  it('offers only the admin rows a partial administrative set opens', () => {
    withReads({ caps: new Set(['sessions.create', 'club.manage', 'teams.manage']) }, () => {
      const html = page()
      for (const row of ['Club', 'Teams', 'Spond']) expect(html).toContain(`<b>${row}</b>`)
      expect(html).not.toContain('<b>Users</b>')
    })
  })

  it('offers all four to a set holding users.manage as well', () => {
    withReads({ caps: new Set(['sessions.create', 'club.manage', 'teams.manage', 'users.manage']) }, () => {
      const html = page()
      for (const row of ['Club', 'Users', 'Teams', 'Spond']) expect(html).toContain(`<b>${row}</b>`)
    })
  })

  // Removing an account stays with admins and is stated rather than offered.
  // A visual pass is exactly the kind of change that could add a destructive
  // affordance to a page of forms, so its absence is asserted.
  it('offers no way to remove an account, whatever the capability set', () => {
    for (const caps of [new Set<string>(), new Set(['sessions.create']), new Set(['users.manage', 'club.manage'])]) {
      withReads({ caps }, () => {
        const html = page()
        expect(html).not.toMatch(/>Delete account|>Remove account|>Close account/)
        expect(html).toContain('so is removing an account')
      })
    }
  })
})

/* ---- the forms ------------------------------------------------------- */

describe('every field is bound to its own label and keeps its autocomplete', () => {
  it('binds each label to the control it names', () => {
    const html = page()
    for (const id of ['full-name', 'default-team', 'new-password', 'confirm-password', 'new-email']) {
      expect(html, `${id} has a label`).toContain(`for="${id}"`)
      expect(html, `${id} exists`).toContain(`id="${id}"`)
    }
  })

  it('keeps the autocomplete a password manager reads', () => {
    // Matched case insensitively, because the static renderer emits the JSX
    // spelling (autoComplete) while the browser sets the attribute itself.
    // HTML attribute names are ASCII case insensitive, so both are the same
    // attribute; checks.mjs reads the PROPERTY off the live element, which is
    // the authoritative form and the one a password manager sees.
    const autocompletes = page().match(/autocomplete="[a-z-]+"/gi) ?? []
    expect(autocompletes.filter((a) => a.toLowerCase().includes('new-password')).length).toBe(2)
    expect(autocompletes.filter((a) => a.toLowerCase().endsWith('"email"')).length).toBe(1)
  })

  it('keeps the photo picker out of the tab order and behind its own button', () => {
    const html = page()
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="image/*"')
    // `hidden` rather than a visually hidden class: a file input reached only
    // through a button must not be a control a keyboard lands on.
    expect(html).toMatch(/type="file"[^>]*hidden|hidden[^>]*type="file"/)
  })

  it('offers Add photo with no photo and both actions with one', () => {
    expect(page()).toContain('Add photo')
    expect(page()).not.toContain('Remove photo')
    withReads({ avatarUrl: 'avatars/me/photo.png' }, () => {
      const html = page()
      expect(html).toContain('Change photo')
      expect(html).toContain('Remove photo')
      expect(html).not.toContain('Add photo')
    })
  })
})

/* ---- membership, which is read only --------------------------------- */

describe('membership renders as read only facts', () => {
  it('names the role, the club and the joined date', () => {
    const html = page()
    expect(html).toContain('<dt>Role</dt>')
    expect(html).toContain('<dt>Club</dt>')
    expect(html).toContain('<dt>Joined</dt>')
    expect(html).toContain('Ossett Town Juniors')
    expect(html).toContain('1 January 2026')
  })

  it('falls back to the club name rather than rendering nothing', () => {
    withReads({ clubName: null }, () => expect(page()).toContain('Ossett Town Juniors'))
  })
})

/* ---- the page level gate --------------------------------------------- */

describe('the profile gate', () => {
  it('is a labelled load rather than an account with nothing in it', () => {
    withReads({ profileLoading: true }, () => {
      const html = page()
      expect(html).toContain('role="status"')
      expect(html).not.toContain('class="account"')
      expect(html).not.toContain('Membership')
    })
  })
})

/* ---- the messages, pinned -------------------------------------------- */

describe('every message this screen can produce is the one it produced before', () => {
  // A source-text tripwire, in the style of the other invariants here, and
  // carrying their caveat: it catches a rewording, not a message routed
  // somewhere else. What proves each one is REACHABLE is the browser run,
  // which drives the write that produces it.
  //
  // These strings are the screen's whole vocabulary of outcomes. The visual
  // pass changed the treatment they render in, deliberately not the words.
  const source = readFileSync(fileURLToPath(new URL('./Account.tsx', import.meta.url)), 'utf8')

  const MESSAGES = [
    'Photo updated.',
    'Photo removed. Your initials show instead.',
    'Name updated.',
    'Default team updated.',
    'The passwords do not match.',
    'Password changed. Use it next time you sign in.',
    'That is already your sign in email.',
    'A confirmation email is on its way to ${next}. Your sign in email changes only once you confirm it from there.',
    'Your team is set by a club admin.',
  ]

  for (const message of MESSAGES) {
    it(`keeps "${message.slice(0, 44)}"`, () => {
      expect(source).toContain(message)
    })
  }

  it('routes every one of them through the shared Note rather than coloured text', () => {
    // The treatment that replaced a coloured <p>: one component, both tones,
    // each with the live region role its urgency calls for.
    expect(source).toContain("tone={error ? 'danger' : 'success'}")
    expect(source).toContain("role={error ? 'alert' : 'status'}")
    // And exactly one place that decides it, so a future message cannot get
    // its own treatment by accident.
    expect(source.match(/<Note\b/g)?.length).toBe(1)
    expect(source.match(/<OutcomeNote\b/g)?.length).toBe(5)
  })
})
