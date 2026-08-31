// =====================================================================
// VISUAL-02, Admin Users: the real page, rendered.
//
// WHAT THIS IS FOR. AdminUsers.test.tsx covers the one piece that is
// presentational over a capability flag (the public links warning). This
// mounts the PAGE, with the data layer stubbed, because what this slice
// changed is page level: which vocabulary draws each part, and which
// controls each capability set is offered.
//
// The half that must not move at all is the security and product
// behaviour, so it is asserted here against the screen an administrator
// actually gets: the last admin protection, the reserved capabilities,
// the all teams flag, the invite defaults, and which tick belongs to
// which role and which capability. A visual refactor that moved any of
// those would look identical in a diff.
//
// WHAT IT DOES NOT DO, and why the harness exists. This project has no
// DOM, so these are static renders: a dialog, a write in flight, the
// sequential save and every focus rule are unreachable here. They are
// driven in a browser through tools/visual/admin.mjs and measured in
// tools/visual/checks.mjs.
//
// Every name in the fixtures is invented, and no child data appears on
// this screen at all.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Capability, Member, RoleCapability, RoleInfo, Team } from '../lib/data'

const ME = 'coach-me'

const ROLE_ADMIN: RoleInfo = { id: 'role-admin', key: 'admin', label: 'Admin', system: true }
const ROLE_MANAGER: RoleInfo = { id: 'role-manager', key: 'manager', label: 'Manager', system: true }
const ROLE_COACH: RoleInfo = { id: 'role-coach', key: 'coach', label: 'Coach', system: true }
const ROLE_PARENT: RoleInfo = { id: 'role-parent', key: 'parent', label: 'Parent', system: true }
const ROLE_CUSTOM: RoleInfo = { id: 'role-kit', key: 'kit_officer', label: 'Kit Officer', system: false }

const ALL_ROLES = [ROLE_ADMIN, ROLE_MANAGER, ROLE_COACH, ROLE_PARENT, ROLE_CUSTOM]

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
]

const member = (over: Partial<Member> & Pick<Member, 'id' | 'fullName'>): Member => ({
  avatar: null,
  avatarUrl: null,
  role: 'coach',
  teamId: null,
  joined: '2026-02-11',
  roles: [ROLE_COACH],
  teamIds: [],
  allTeams: false,
  ...over,
})

const TWO_ADMINS: Member[] = [
  member({ id: ME, fullName: 'Sam Ashworth', roles: [ROLE_ADMIN, ROLE_COACH], allTeams: true }),
  member({ id: 'member-2', fullName: 'Priya Raghunathan', teamIds: ['titans', 'trojans'] }),
  member({ id: 'member-3', fullName: 'Marguerite Ashby', roles: [ROLE_ADMIN], allTeams: true }),
  member({ id: 'member-4', fullName: 'Tom Brearley', roles: [ROLE_CUSTOM], teamIds: ['titans'] }),
  member({ id: 'member-5', fullName: 'Jo Hartley', roles: [] }),
]

// Exactly one admin, and it is somebody else: the only arrangement in which
// the last admin lock is reachable on a row the signed in member can act on.
const ONE_ADMIN: Member[] = TWO_ADMINS.map((m) =>
  m.id === ME ? { ...m, roles: [ROLE_COACH], allTeams: false } : m,
)

const CAPABILITIES: Capability[] = [
  { key: 'drills.create', label: 'Create drills', description: 'Add drills to the club library.' },
  { key: 'sessions.create', label: 'Plan sessions', description: 'Build and run training sessions.' },
  { key: 'players.view', label: 'See registered players', description: "Read the club's player register." },
  { key: 'teams.manage', label: 'Manage teams', description: "Add, rename and remove the club's teams." },
  { key: 'users.manage', label: 'Manage users', description: 'Invite members, set roles and remove people.' },
  { key: 'club.manage', label: 'Manage the club', description: 'Edit the club record and its integrations.' },
]

const MAPPING: RoleCapability[] = [
  ...['drills.create', 'sessions.create', 'players.view', 'teams.manage', 'users.manage', 'club.manage'].map(
    (capability) => ({ roleId: ROLE_ADMIN.id, capability }),
  ),
  { roleId: ROLE_MANAGER.id, capability: 'drills.create' },
  { roleId: ROLE_MANAGER.id, capability: 'teams.manage' },
  { roleId: ROLE_COACH.id, capability: 'sessions.create' },
  { roleId: ROLE_CUSTOM.id, capability: 'players.view' },
]

// What each read answers, so one describe can vary it without a second mock.
const reads = {
  caps: new Set<string>(['users.manage']),
  members: TWO_ADMINS,
  roles: ALL_ROLES,
  teams: TEAMS,
  states: { [ME]: 'active', 'member-4': 'invited' } as Record<string, 'invited' | 'active'> | undefined,
  capabilities: CAPABILITIES as Capability[] | undefined,
  mapping: MAPPING as RoleCapability[] | undefined,
  loading: false,
  isError: false,
  gridError: false,
  shareCount: undefined as number | undefined,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: () => {},
  ...over,
})

const mutation = () => ({ mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false, isError: false, error: null })

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useProfiles: () =>
    query(reads.loading || reads.isError ? undefined : reads.members, {
      isLoading: reads.loading,
      isError: reads.isError,
      isSuccess: !reads.loading && !reads.isError,
    }),
  useRoles: () =>
    query(reads.loading || reads.isError ? undefined : reads.roles, {
      isLoading: reads.loading,
      isError: reads.isError,
      isSuccess: !reads.loading && !reads.isError,
    }),
  useTeams: () => query(reads.teams),
  useMemberStates: () => query(reads.states),
  useCapabilities: () =>
    query(reads.gridError ? undefined : reads.capabilities, { isError: reads.gridError, isSuccess: !reads.gridError }),
  useRoleCapabilities: () =>
    query(reads.gridError ? undefined : reads.mapping, { isError: reads.gridError, isSuccess: !reads.gridError }),
  useMemberActiveShareCount: () => query(reads.shareCount),
  useInviteUser: mutation,
  useRemoveUser: mutation,
  useSetMemberRoles: mutation,
  useSetMemberTeams: mutation,
  useSetMemberAllTeams: mutation,
  useCreateRole: mutation,
  useRenameRole: mutation,
  useDeleteRole: mutation,
  useSaveRoleCapabilities: mutation,
  // UserAvatar resolves an uploaded photo through the same signed URL hook as
  // the media previews. Every fixture here has none, so it falls back to
  // initials; the hook still has to exist.
  useSignedMediaUrl: () => query(null),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { id: ME, club_id: 'club' }, role: 'coach' }),
}))

const { AdminUsers, MemberShareWarning } = await import('./AdminUsers')

function page(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  reads.caps = new Set<string>(['users.manage'])
  reads.members = TWO_ADMINS
  reads.roles = ALL_ROLES
  reads.teams = TEAMS
  reads.states = { [ME]: 'active', 'member-4': 'invited' }
  reads.capabilities = CAPABILITIES
  reads.mapping = MAPPING
  reads.loading = false
  reads.isError = false
  reads.gridError = false
  reads.shareCount = undefined
})

/* Every checkbox in the rendered page, keyed by its accessible name. The
   grid's cells are named "<capability> for <role>" and the pickers' rows are
   named by the text beside the box, so this is the one place both are read
   and the identity of a tick is never inferred from its position. */
function boxes(html: string): { name: string; checked: boolean; disabled: boolean }[] {
  const out: { name: string; checked: boolean; disabled: boolean }[] = []
  // Each <input type="checkbox"> tag, with the label text that follows it
  // where there is one.
  const re = /<input type="checkbox"([^>]*)\/?>(?:<span class="tick-box"[^>]*>.*?<\/span><\/span><span>([^<]*)<\/span>)?/gs
  for (const m of html.matchAll(re)) {
    const attrs = m[1]
    const aria = attrs.match(/aria-label="([^"]*)"/)?.[1]
    out.push({
      name: aria ?? (m[2] ?? '').trim(),
      checked: /\bchecked\b/.test(attrs),
      disabled: /\bdisabled\b/.test(attrs),
    })
  }
  return out
}

const box = (html: string, name: string) => boxes(html).find((b) => b.name === name)

describe('the page and its capability gate', () => {
  it('renders one h1 naming the page', () => {
    const html = page()
    expect((html.match(/<h1>/g) ?? []).length).toBe(1)
    expect(html).toContain('<h1>Users</h1>')
  })

  it('renders nothing at all for a member without users.manage', () => {
    // The route guard keeps them out; this is the brief render before the
    // redirect, and it must surface no member, no role and no control.
    reads.caps = new Set<string>(['teams.manage', 'club.manage'])
    expect(page()).toBe('')
  })

  it('is a labelled spinner while the page level reads answer, not a half drawn list', () => {
    reads.loading = true
    const html = page()
    expect(html).toContain('role="status"')
    expect(html).toContain('spinner')
    expect(html).not.toContain('Priya Raghunathan')
  })

  it('is an alert with a retry when a page level read fails', () => {
    reads.isError = true
    const html = page()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Retry')
  })
})

describe('the member list', () => {
  it('lists every member with their roles, their teams and their state', () => {
    const html = page()
    for (const m of TWO_ADMINS) expect(html).toContain(m.fullName)
    /* The team summary in the row's own META LINE, anchored to the separator
       and the closing tag. A bare `toContain('All teams')` held for the wrong
       reason and was found by mutation: the invite form's own toggle reads
       "All teams, current and future", so the substring was on the page
       whatever the row said. */
    expect(html).toContain('· All teams</span>')
    expect(html).toContain('· Titans, Trojans</span>')
    expect(html).toContain('· No teams</span>')
  })

  it('marks the signed in member and offers no removal on their own row', () => {
    const html = page()
    expect(html).toContain('(you)')
    expect(html).not.toContain('aria-label="Remove Sam Ashworth"')
    // Everybody else can be removed.
    expect(html).toContain('aria-label="Remove Priya Raghunathan"')
  })

  it('says invited or active in words as well as in colour, and says neither when the read has not answered', () => {
    const html = page()
    expect(html).toContain('Invited')
    expect(html).toContain('Active')
    expect(html).toContain('badge-dot')
    reads.states = undefined
    const quiet = page()
    expect(quiet).not.toContain('>Invited<')
    expect(quiet).not.toContain('>Active<')
  })

  it('marks a member with no roles in danger and says what it costs them', () => {
    const html = page()
    expect(html).toContain('badge badge-danger')
    expect(html).toContain('No roles')
    expect(html).toContain('No roles means no write access')
  })
})

describe('the last admin protection', () => {
  it('offers removal while the club has a second admin', () => {
    const html = page()
    expect(html).toContain('aria-label="Remove Marguerite Ashby"')
    expect(html).not.toMatch(/aria-label="Remove Marguerite Ashby"[^>]*disabled/)
  })

  it("refuses removal of the club's only admin and says why in the row rather than in a tooltip", () => {
    reads.members = ONE_ADMIN
    const html = page()
    // The control is disabled AND points at a sentence that is on the page.
    const tag = html.match(/<button[^>]*aria-label="Remove Marguerite Ashby"[^>]*>/)?.[0] ?? ''
    expect(tag).toContain('disabled')
    const describedBy = tag.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${describedBy}"`)
    expect(html).toContain("The club&#x27;s only admin cannot be removed")
    // And never as a tooltip, which does not survive touch.
    expect(tag).not.toContain('title=')
  })

  it('leaves every other row removable while one member is the only admin', () => {
    reads.members = ONE_ADMIN
    const html = page()
    const tag = html.match(/<button[^>]*aria-label="Remove Priya Raghunathan"[^>]*>/)?.[0] ?? ''
    expect(tag).not.toContain('disabled')
  })
})

describe('the invite form', () => {
  it('defaults to the Coach role and to no teams, which is what the invite function assumes', () => {
    const html = page()
    expect(box(html, 'Coach')?.checked).toBe(true)
    expect(box(html, 'Admin')?.checked).toBe(false)
    expect(box(html, 'All teams, current and future')?.checked).toBe(false)
    expect(box(html, 'Titans')?.checked).toBe(false)
  })

  it('offers every role and every team as a named, labelled tick', () => {
    const names = boxes(page()).map((b) => b.name)
    for (const r of ALL_ROLES) expect(names).toContain(r.label)
    for (const t of TEAMS) expect(names).toContain(t.name)
  })

  it('groups the roles and the teams in a real fieldset with a legend', () => {
    const html = page()
    expect(html).toContain('<legend>Roles</legend>')
    expect(html).toContain('<legend>Teams</legend>')
    expect(html).toContain('choice-group')
  })

  it('says where to add teams when the club has none, rather than showing an empty box', () => {
    reads.teams = []
    expect(page()).toContain('No teams yet. Add them on the Teams screen.')
  })

  it('offers no warning while a role is ticked, since Send is live', () => {
    expect(page()).not.toContain('An invite with no role grants nothing')
  })
})

describe('an inert control points at the sentence that accounts for it', () => {
  it('binds the Send button to the no roles warning, and to nothing while a role is held', () => {
    // The default has Coach ticked, so there is no warning and nothing to
    // point at. This asserts the WIRING is absent then, because a describedby
    // left permanently on would name an element that is not on the page.
    const html = page()
    const send = html.match(/<button[^>]*>(?:(?!<\/button>).)*Send invite/s)?.[0] ?? ''
    expect(send).not.toContain('aria-describedby')
  })
})

describe('the roles manager', () => {
  it('offers no rename or delete on a system role, and both on a custom one', () => {
    const html = page()
    for (const r of [ROLE_ADMIN, ROLE_MANAGER, ROLE_COACH, ROLE_PARENT]) {
      expect(html).not.toContain(`aria-label="Delete ${r.label}"`)
    }
    expect(html).toContain('aria-label="Delete Kit Officer"')
    // System is stated in words rather than only by the absence of controls.
    expect((html.match(/>System</g) ?? []).length).toBe(4)
  })

  it('counts the holders of each role from the member list', () => {
    const html = page()
    // Two admins, one coach beside them, one custom role holder, no parents.
    expect(html).toContain('2 member')
    expect(html).toContain('0 members')
  })
})

describe('the capability grid', () => {
  it('is a real table with a caption and scoped headers', () => {
    const html = page()
    expect(html).toContain('<table class="cap-grid">')
    expect(html).toContain('<caption class="sr-only">')
    expect((html.match(/scope="col"/g) ?? []).length).toBe(1 + ALL_ROLES.length)
    expect((html.match(/scope="row"/g) ?? []).length).toBe(CAPABILITIES.length)
  })

  it('names every tick by BOTH its capability and its role', () => {
    const html = page()
    // The identity a visual refactor is most likely to move silently.
    expect(box(html, 'Create drills for Manager')?.checked).toBe(true)
    expect(box(html, 'Create drills for Coach')?.checked).toBe(false)
    expect(box(html, 'Plan sessions for Coach')?.checked).toBe(true)
    expect(box(html, 'Plan sessions for Manager')?.checked).toBe(false)
    expect(box(html, 'See registered players for Kit Officer')?.checked).toBe(true)
    expect(box(html, 'Manage teams for Parent')?.checked).toBe(false)
  })

  it('locks a reserved capability on for Admin and offers it on no other role', () => {
    const html = page()
    for (const key of ['Manage users', 'Manage the club']) {
      const admin = box(html, `${key} for Admin`)
      expect(admin?.checked).toBe(true)
      expect(admin?.disabled).toBe(true)
      for (const r of [ROLE_MANAGER, ROLE_COACH, ROLE_PARENT, ROLE_CUSTOM]) {
        expect(box(html, `${key} for ${r.label}`)).toBeUndefined()
      }
    }
    // The cell that offers nothing says which rather than being blank: two
    // reserved rows across four non admin roles.
    expect((html.match(/class="cap-none"/g) ?? []).length).toBe(8)
    expect(html).toContain('Reserved to the admin role')
  })

  it('offers no pending change bar until a tick is moved', () => {
    const html = page()
    expect(html).not.toContain('Review 1 change')
    expect(html).not.toContain('>Discard<')
  })

  it('says the grid is unavailable, as an alert, when its own reads fail', () => {
    reads.gridError = true
    const html = page()
    expect(html).toContain('needs the RBAC migrations')
    expect(html).toContain('role="alert"')
    // The rest of the page still works: this is the grid's own state.
    expect(html).toContain('Priya Raghunathan')
  })
})

describe('the public links warning is advisory and never gates a removal', () => {
  it('states the count as a polite Note with a glyph rather than as red text', () => {
    reads.caps = new Set<string>(['users.manage', 'shares.manage'])
    reads.shareCount = 2
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MemberShareWarning memberId="member-2" />
      </MemoryRouter>,
    )
    expect(html).toContain('note note-warning')
    expect(html).toContain('role="status"')
    expect(html).toContain('<svg')
    expect(html).toContain('2 public links still working')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('disabled')
  })
})

describe('no inline font size or off scale step is left on the page', () => {
  it('writes no style attribute at all outside the bib swatch, which is a colour', () => {
    // The screen carried thirty seven inline font sizes and a dozen literal
    // steps. Its own layout rules live in the shared stylesheet now, which
    // src/lib/designSystem.invariant.test.ts already polices.
    const html = page()
    expect(html).not.toMatch(/style="[^"]*font-size/)
    expect(html).not.toMatch(/style="[^"]*padding/)
    expect(html).not.toMatch(/style="[^"]*margin/)
  })
})
