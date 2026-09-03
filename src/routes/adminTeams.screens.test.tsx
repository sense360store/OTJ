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
// COACH-1B added the club's TEAM ORDER to this page: the list in club
// order, Move up and Move down on every row, the three states said in
// words, and one Save team order checkpoint. The static half of that is
// pinned here: what each state says, that every control is named for its
// own team, that the boundaries are disabled, that Save is offered when
// pressing it would state something and withheld when it would not, and
// that rendering the page writes nothing.
//
// WHAT IT DOES NOT DO, and why the harness exists. This project has no
// DOM, so these are static renders: the dialog, a write in flight, a
// refused rename, a press on Move up and the focus rule are unreachable
// here. They are driven in a browser through tools/visual/admin.mjs and
// measured in tools/visual/checks.mjs; the draft and save rules themselves
// are pure and are driven in src/lib/teamOrder.test.ts.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BIB_COLOURS } from '../lib/bibs'
import type { Member, Session, Team } from '../lib/data'

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue', sortOrder: null },
  { id: 'trojans', name: 'Trojans', bibColour: 'red', sortOrder: null },
  { id: 'gladiators', name: 'Gladiators', bibColour: null, sortOrder: null },
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

const writes: string[] = []
const mutation = () => ({ mutate: () => void writes.push('write'), isPending: false, isError: false, error: null })
/* The order save's own state, so a write in flight and a refused write can
   be rendered without a DOM: the page reads isPending and error off the
   mutation and nothing else. */
const saveState: { isPending: boolean; isError: boolean; error: Error | null } = { isPending: false, isError: false, error: null }

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
  useSaveTeamOrder: () => ({ ...mutation(), ...saveState }),
}))

vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: SESSIONS }),
}))

const { AdminTeams, BibColourField, DeleteTeamModal, TEAM_ORDER_COPY, TeamOrderStatus } = await import('./AdminTeams')
const { TeamOrderChanged, TeamOrderRefused, saveFailureMessage } = await import('../lib/teamOrder')

const page = (): string => renderToStaticMarkup(<AdminTeams />)

beforeEach(() => {
  reads.caps = new Set<string>(['teams.manage'])
  reads.teams = TEAMS
  reads.loading = false
  reads.isError = false
  writes.length = 0
  saveState.isPending = false
  saveState.isError = false
  saveState.error = null
})

/* The rows in the order the page rendered them, read off each row's own
   Remove control, which is named for its team. */
const renderedOrder = (html: string): string[] =>
  [...html.matchAll(/aria-label="Remove ([^"]+)"/g)].map((m) => m[1])

const button = (html: string, label: string): string => {
  const m = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))
  expect(m, label).not.toBeNull()
  return m![0]
}

const saveButton = (html: string): string => {
  const m = html.match(/<button[^>]*>(?:(?!<\/button>).)*Save team order(?:(?!<\/button>).)*<\/button>/s)
  expect(m, 'Save team order').not.toBeNull()
  return m![0]
}

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

/* ---- COACH-1B: the club's team order ---- */

const ORDERED: Team[] = [
  { id: 'argonauts', name: 'Argonauts', bibColour: null, sortOrder: 3 },
  { id: 'titans', name: 'Titans', bibColour: 'blue', sortOrder: 1 },
  { id: 'trojans', name: 'Trojans', bibColour: 'red', sortOrder: 2 },
]

describe('the team order says which of its three states it is in', () => {
  it('says the order is not set when every team is unplaced, names the fallback as alphabetical, and lists alphabetically', () => {
    const html = page()
    expect(html).toContain('Team order is not set')
    expect(html).toContain('listed alphabetically, which is not a coaching order')
    expect(renderedOrder(html)).toEqual(['Gladiators', 'Titans', 'Trojans'])
  })

  it('says the order is incomplete, names the unplaced teams, and lists the placed teams first by position', () => {
    reads.teams = [
      { id: 'zulu', name: 'Zulu', bibColour: null, sortOrder: null },
      { id: 'trojans', name: 'Trojans', bibColour: 'red', sortOrder: 2 },
      { id: 'argonauts', name: 'Argonauts', bibColour: null, sortOrder: null },
      { id: 'titans', name: 'Titans', bibColour: 'blue', sortOrder: 1 },
    ]
    const html = page()
    expect(html).toContain('Team order is incomplete: Argonauts and Zulu have no position yet')
    expect(renderedOrder(html)).toEqual(['Titans', 'Trojans', 'Argonauts', 'Zulu'])
  })

  it('renders the saved order by position when configured, whatever order the read returned', () => {
    reads.teams = ORDERED
    const html = page()
    expect(html).toContain('Saved club order')
    expect(html).not.toContain('Team order is not set')
    expect(html).not.toContain('Team order is incomplete')
    expect(renderedOrder(html)).toEqual(['Titans', 'Trojans', 'Argonauts'])
  })

  it('reads a team just added as unplaced, which makes a configured order incomplete', () => {
    reads.teams = [...ORDERED, { id: 'new', name: 'Spartans', bibColour: null, sortOrder: null }]
    const html = page()
    expect(html).toContain('Team order is incomplete: Spartans has no position yet')
    expect(renderedOrder(html)).toEqual(['Titans', 'Trojans', 'Argonauts', 'Spartans'])
  })

  it('states the status as words a coach reads, for one unplaced team and for several', () => {
    const one = renderToStaticMarkup(<TeamOrderStatus state="incomplete" unplaced={[TEAMS[0]]} dirty={false} />)
    expect(one).toContain('Titans has no position yet and is listed')
    const two = renderToStaticMarkup(<TeamOrderStatus state="incomplete" unplaced={[TEAMS[0], TEAMS[1]]} dirty={false} />)
    expect(two).toContain('Titans and Trojans have no position yet and are listed')
    expect(renderToStaticMarkup(<TeamOrderStatus state="unset" unplaced={TEAMS} dirty={false} />)).toContain('Team order is not set')
    expect(renderToStaticMarkup(<TeamOrderStatus state="configured" unplaced={[]} dirty={false} />)).toContain('Saved club order')
  })

  it('stops describing the list as alphabetical, or as saved, once the admin has moved something', () => {
    // The list shows the draft, so a sentence about what is STORED must not
    // describe what is on screen as alphabetical or as the saved order.
    const unset = renderToStaticMarkup(<TeamOrderStatus state="unset" unplaced={TEAMS} dirty />)
    expect(unset).toContain('Team order is not set')
    expect(unset).toContain('the order you are arranging')
    expect(unset).not.toContain('listed alphabetically')
    const incomplete = renderToStaticMarkup(<TeamOrderStatus state="incomplete" unplaced={[TEAMS[0]]} dirty />)
    expect(incomplete).toContain('Titans has no position yet')
    expect(incomplete).toContain('the order you are arranging')
    expect(incomplete).not.toContain('listed after the ordered teams')
    const configured = renderToStaticMarkup(<TeamOrderStatus state="configured" unplaced={[]} dirty />)
    expect(configured).toContain('changes not yet stored')
  })

  it('says what the order is for, strongest first, in the one exported sentence', () => {
    expect(TEAM_ORDER_COPY).toContain('strongest team first')
    expect(page()).toContain(TEAM_ORDER_COPY)
  })

  it('does not claim the order is in use, because nothing consumes it yet', () => {
    // Present tense would send an admin to Players and groups expecting a
    // change; the sentence says a later release will use it.
    expect(TEAM_ORDER_COPY).not.toMatch(/^Used for/)
    expect(TEAM_ORDER_COPY).toContain('later release')
    expect(TEAM_ORDER_COPY).toContain('nothing uses it yet')
  })

  it('carries a polite live region for the move announcements, empty until a move', () => {
    const html = page()
    expect(html).toMatch(/<div class="sr-only" aria-live="polite"><\/div>/)
  })

  it('shows each row its draft position', () => {
    reads.teams = ORDERED
    const html = page()
    expect(html).toContain('aria-label="Team order for Titans: position 1 of 3"')
    expect(html).toContain('aria-label="Team order for Argonauts: position 3 of 3"')
    expect((html.match(/class="admin-position"/g) ?? []).length).toBe(3)
  })
})

describe('the ordering controls', () => {
  it('names Move up and Move down for their own team rather than by an arrow', () => {
    const html = page()
    for (const t of TEAMS) {
      expect(html).toContain(`aria-label="Move ${t.name} up"`)
      expect(html).toContain(`aria-label="Move ${t.name} down"`)
    }
    // Icon only, so an accessible name is the only name there is.
    expect((html.match(/class="icon-btn"[^>]*>/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('cannot move the first team further up or the last further down', () => {
    reads.teams = ORDERED
    const html = page()
    expect(button(html, 'Move Titans up')).toContain('disabled')
    expect(button(html, 'Move Titans down')).not.toContain('disabled')
    expect(button(html, 'Move Argonauts down')).toContain('disabled')
    expect(button(html, 'Move Argonauts up')).not.toContain('disabled')
    expect(button(html, 'Move Trojans up')).not.toContain('disabled')
    expect(button(html, 'Move Trojans down')).not.toContain('disabled')
  })

  it('is a plain button, keyboard operable, with no drag handle and no drag attribute anywhere', () => {
    const html = page()
    expect(html).not.toMatch(/draggable/)
    expect(html).not.toMatch(/drag/i)
    expect(html).toMatch(/<button[^>]*aria-label="Move Titans up"/)
  })

  it('keeps the name field, the bib select, Rename and Remove exactly as they were', () => {
    const html = page()
    for (const t of TEAMS) {
      expect(html).toContain(`Team name for ${t.name}`)
      expect(html).toContain(`Default bib colour for ${t.name}`)
      expect(html).toContain(`aria-label="Rename ${t.name}"`)
      expect(html).toContain(`aria-label="Remove ${t.name}"`)
    }
  })
})

describe('Save team order is a checkpoint, offered when pressing it would state something', () => {
  it('is offered for an unset club even though nothing was moved: pressing it accepts the order shown', () => {
    const html = page()
    expect(saveButton(html)).not.toContain('disabled')
  })

  it('is offered for an incomplete club, because saving places every team', () => {
    reads.teams = [...ORDERED, { id: 'new', name: 'Spartans', bibColour: null, sortOrder: null }]
    expect(saveButton(page())).not.toContain('disabled')
  })

  it('is withheld for a configured club whose draft nobody has moved', () => {
    reads.teams = ORDERED
    const html = page()
    expect(saveButton(html)).toContain('disabled')
    expect(html).not.toContain('Not saved yet')
  })

  it('writes nothing when the page renders, in any state', () => {
    page()
    reads.teams = ORDERED
    page()
    reads.teams = [...ORDERED, { id: 'new', name: 'Spartans', bibColour: null, sortOrder: null }]
    page()
    expect(writes).toEqual([])
  })

  it('renders no success or refusal until a save has happened', () => {
    const html = page()
    expect(html).not.toContain('Team order saved')
    expect(html).not.toContain('Could not save the team order')
  })

  it('freezes every ordering control, Remove and Add team while the order is being written', () => {
    saveState.isPending = true
    const html = page()
    const saving = html.match(/<button[^>]*>(?:(?!<\/button>).)*Saving order…(?:(?!<\/button>).)*<\/button>/s)
    expect(saving, 'Saving order…').not.toBeNull()
    expect(saving![0]).toContain('disabled')
    for (const t of TEAMS) {
      expect(button(html, `Move ${t.name} up`)).toContain('disabled')
      expect(button(html, `Move ${t.name} down`)).toContain('disabled')
      expect(button(html, `Remove ${t.name}`)).toContain('disabled')
    }
    const add = html.match(/<button[^>]*>(?:(?!<\/button>).)*Add team(?:(?!<\/button>).)*<\/button>/s)
    expect(add).not.toBeNull()
    expect(add![0]).toContain('disabled')
    expect(html).not.toContain('Not saved yet')
  })

  it('renders a refused save as an alert in the refusal\'s own words', () => {
    saveState.isError = true
    saveState.error = new TeamOrderChanged()
    const html = page()
    expect(html).toMatch(/role="alert"/)
    expect(html).toContain('Could not save the team order.')
    expect(html).toContain('The list has been refreshed; check it and save again.')
    // The refusal wrapper is the thing focus goes to.
    expect(html).toMatch(/<div tabindex="-1" class="admin-note"><div[^>]*role="alert"/)
  })

  it('writes one sentence per refusal, and a general one for anything else', () => {
    const changed = saveFailureMessage(new TeamOrderChanged())
    expect(changed).toBe(`Could not save the team order. ${new TeamOrderChanged().message}`)
    const refused = saveFailureMessage(new TeamOrderRefused('A position was not stored. 1 of 2 moved teams were placed.'))
    expect(refused).toContain('A position was not stored. 1 of 2 moved teams were placed.')
    expect(refused).toContain('press Save team order again')
    const other = saveFailureMessage(new Error('network down'))
    expect(other).toContain('Could not save the team order.')
    expect(other).not.toContain('network down')
    expect(other).toContain('press Save team order again')
    expect(saveFailureMessage(undefined)).toBe(other)
  })
})

