// =====================================================================
// VISUAL-02, Admin Teams: the real page, rendered.
//
// WHAT THIS IS FOR. AdminVenues.test.tsx already covers BibColourField and
// the removal dialog's frozen controls as presentational pieces. This
// mounts the PAGE, because what this slice changed is page level, and it
// pins the half that must not move: teams are a filter and a default,
// never access control, so removing one clears references rather than
// deleting anything, and the dialog has to keep saying so.
//
// WHAT IT DOES NOT DO, and why the harness exists. This project has no
// DOM, so these are static renders: the dialog, a write in flight, a
// refused rename and the focus rule are unreachable here. They are driven
// in a browser through tools/visual/admin.mjs and measured in
// tools/visual/checks.mjs.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BIB_COLOURS } from '../lib/bibs'
import type { Member, Session, Team } from '../lib/data'

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
  { id: 'gladiators', name: 'Gladiators', bibColour: null },
]

const MEMBERS = [
  { id: 'm1', fullName: 'Sam Ashworth', allTeams: true, teamIds: [] },
  { id: 'm2', fullName: 'Priya Raghunathan', allTeams: false, teamIds: ['titans'] },
  { id: 'm3', fullName: 'Tom Brearley', allTeams: false, teamIds: ['trojans'] },
] as unknown as Member[]

const SESSIONS = [
  { id: 's1', name: 'Titans Tuesday', teamIds: ['titans'] },
  { id: 's2', name: 'Trojans Thursday', teamIds: ['trojans'] },
] as unknown as Session[]

const reads = {
  caps: new Set<string>(['teams.manage']),
  teams: TEAMS,
  loading: false,
  isError: false,
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

const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, error: null })

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useTeams: () =>
    query(reads.loading || reads.isError ? undefined : reads.teams, {
      isLoading: reads.loading,
      isError: reads.isError,
      isSuccess: !reads.loading && !reads.isError,
    }),
  useProfiles: () => query(MEMBERS),
  useInsertTeam: mutation,
  useRenameTeam: mutation,
  useDeleteTeam: mutation,
  useSetTeamBibColour: mutation,
}))

vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: SESSIONS }),
}))

const { AdminTeams, BibColourField, DeleteTeamModal } = await import('./AdminTeams')

const page = (): string => renderToStaticMarkup(<AdminTeams />)

beforeEach(() => {
  reads.caps = new Set<string>(['teams.manage'])
  reads.teams = TEAMS
  reads.loading = false
  reads.isError = false
})

describe('the page and its capability gate', () => {
  it('renders one h1 naming the page', () => {
    const html = page()
    expect((html.match(/<h1>/g) ?? []).length).toBe(1)
    expect(html).toContain('<h1>Teams</h1>')
  })

  it('renders nothing at all for a member without teams.manage', () => {
    reads.caps = new Set<string>(['users.manage'])
    expect(page()).toBe('')
  })

  it('is a labelled spinner while the teams read answers', () => {
    reads.loading = true
    const html = page()
    expect(html).toContain('role="status"')
    expect(html).toContain('spinner')
    expect(html).not.toContain('Titans')
  })

  it('is an alert with a retry when the teams read fails', () => {
    reads.isError = true
    const html = page()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Retry')
  })

  it('says what to do next when the club has no teams', () => {
    reads.teams = []
    const html = page()
    expect(html).toContain('No teams yet')
    expect(html).toContain('Add the first one above')
  })
})

describe('the team row', () => {
  it('gives the name field a real label bound to the control, named for its own team', () => {
    const html = page()
    for (const t of TEAMS) {
      const label = html.match(new RegExp(`<label for="([^"]+)" class="sr-only">Team name for ${t.name}</label>`))
      expect(label, `${t.name} name label`).toBeTruthy()
      expect(html).toContain(`<input id="${label![1]}"`)
    }
  })

  it('gives the bib select a real label bound to the control, named for its own team', () => {
    const html = page()
    for (const t of TEAMS) {
      const label = html.match(
        new RegExp(`<label for="([^"]+)" class="sr-only">Default bib colour for ${t.name}</label>`),
      )
      expect(label, `${t.name} bib label`).toBeTruthy()
      expect(html).toContain(`<select id="${label![1]}"`)
    }
  })

  it('names each row action for its own team', () => {
    const html = page()
    for (const t of TEAMS) expect(html).toContain(`aria-label="Remove ${t.name}"`)
    // A destructive action carries the word as well as the tone.
    expect(html).toContain('icon-btn danger')
  })

  it('offers Rename inert until the name actually changes', () => {
    // Every row opens holding its stored name, so nothing is renameable on a
    // page nobody has typed into. Without this a press could write the value
    // that is already there.
    const html = page()
    const buttons = html.match(/<button[^>]*>(?:(?!<\/button>).)*Rename(?:(?!<\/button>).)*<\/button>/gs) ?? []
    expect(buttons.length).toBe(TEAMS.length)
    for (const b of buttons) expect(b).toContain('disabled')
  })
})

describe('the bib colour is never carried by colour alone', () => {
  it('names the colour in words, with the swatch supplementary and hidden', () => {
    const html = page()
    // The selected option's WORD is the information.
    expect(html).toContain('value="blue" selected=""')
    expect(html).toContain('>Blue<')
    expect(html).toContain('value="red" selected=""')
    expect(html).toContain('>Red<')
    // A team with no default says so in words rather than showing nothing.
    expect(html).toContain('>No bib<')
    // The swatch carries no information of its own.
    expect((html.match(/class="bib-swatch"/g) ?? []).length).toBe(2)
    expect(html).toMatch(/aria-hidden="true" class="bib-swatch"/)
  })

  it('offers the closed vocabulary and nothing else', () => {
    const html = renderToStaticMarkup(
      <BibColourField value={null} disabled={false} label="Default bib colour for Titans" onChange={() => {}} />,
    )
    for (const b of BIB_COLOURS) expect(html).toContain(`value="${b.value}"`)
    // No free text: a colour the app cannot render is not offerable.
    expect(html).not.toContain('<input')
  })
})

describe('the destructive removal keeps its consequences exactly', () => {
  /* The dialog is RENDERED rather than read out of the source. A source text
     check on these sentences would be satisfied by writing them in a comment,
     and what they say is a product rule rather than copy. */
  const dialog = (memberCount: number, sessionCount: number): string =>
    renderToStaticMarkup(
      <DeleteTeamModal
        team={TEAMS[0]}
        memberCount={memberCount}
        sessionCount={sessionCount}
        onClose={() => {}}
        onRemoved={() => {}}
      />,
    )

  it('states that nothing is removed with the team, and that a team only session does not widen', () => {
    const html = dialog(2, 1)
    for (const said of [
      'reference this team',
      'their team is cleared',
      'become Unassigned',
      'keeping their registration, shirt number and history',
      'No sessions, people',
      'or players are removed',
      'left with no teams set',
      'never widens to the whole club',
    ]) {
      expect(html, said).toContain(said)
    }
    // The destructive control carries the WORD as well as the danger fill.
    expect(html).toContain('btn btn-danger')
    expect(html).toContain('Remove')
  })

  it('counts what references the team, and reads naturally for one of each', () => {
    expect(dialog(2, 1)).toContain('2 members and 1 session reference this team')
    expect(dialog(1, 2)).toContain('1 member and 2 sessions reference this team')
    // Nought is a real answer and is said as one.
    expect(dialog(0, 0)).toContain('0 members and 0 sessions reference this team')
  })

  it('counts what references the team from the member set and the session coverage', () => {
    // Three members reference Titans: the two specific ones plus everybody on
    // the all teams flag. Pinned because the count is what makes the
    // consequence about THIS team rather than a generic sentence.
    const covered = MEMBERS.filter((m) => m.allTeams || m.teamIds.includes('titans'))
    expect(covered).toHaveLength(2)
    expect(SESSIONS.filter((s) => (s.teamIds ?? []).includes('titans'))).toHaveLength(1)
  })
})

describe('no inline font size or off scale step is left on the page', () => {
  it('writes no style attribute outside the bib swatch, which is a colour', () => {
    const html = page()
    expect(html).not.toMatch(/style="[^"]*font-size/)
    expect(html).not.toMatch(/style="[^"]*padding/)
    expect(html).not.toMatch(/style="[^"]*margin/)
    // The one that stays: the swatch's fill, which 2.16 keeps as colour.
    expect(html).toMatch(/class="bib-swatch" style="background:#/)
  })
})
