import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LinkSectionsView,
  LinkedRowView,
  NeedsDecisionRowView,
  PickerView,
  SpondSetupRowView,
  TeamChipsView,
} from './SpondLinks'
import type { LinkCandidate, SpondGroupMember, SpondLink } from '../lib/spondLinking'
import type { RegisteredPlayer, Team } from '../lib/data'

// The screen's presentational shells, rendered without hooks or a query
// client, the house style. Names are synthetic, never real children, and
// the member ids are invented uppercase hex.

const M1 = '0123456789ABCDEF0123456789ABCDEF'
const M2 = 'FEDCBA9876543210FEDCBA9876543210'

const player = (id: string, name: string): RegisteredPlayer => ({
  registrationId: `r-${id}`,
  playerId: id,
  seasonId: 'season',
  teamId: 't1',
  displayName: name,
  shirtNumber: null,
  status: 'registered',
  registeredDate: null,
  createdBy: null,
  updatedAt: '2026-08-09T00:00:00Z',
})

const roster = [player('p1', 'Alpha Synthetic'), player('p2', 'Beta Synthetic')]
const candidate = (id: string, name: string): LinkCandidate => ({ spondMemberId: id, displayName: name })
const link = (memberId: string, playerId: string): SpondLink => ({
  spondMemberId: memberId,
  playerId,
  matchedBy: 'chosen',
  createdAt: '2026-08-09T00:00:00Z',
})

const noop = () => {}

// Invented Spond subgroup ids, and the mapped subgroup for the team under
// test (t1). SG_OTHER is another team's, SG_UNMAPPED is a subgroup the
// club maps to nothing.
const SG_MINE = 'SUBGROUP-SYNTH-MINE'
const SG_OTHER = 'SUBGROUP-SYNTH-OTHER'
const SG_UNMAPPED = 'SUBGROUP-SYNTH-UNMAPPED'
const SUBGROUP_TEAMS = new Map([
  [SG_MINE, 'Argonauts'],
  [SG_OTHER, 'Titans'],
])
const outside = (name: string, subgroupIds: string[] = []): SpondGroupMember => ({
  displayName: name,
  subgroupIds,
})

// The view's props, with the diagnostics off by default so every test
// that predates them keeps rendering exactly what it rendered before.
const sectionProps = {
  busy: false,
  complete: true,
  outsideMembers: null as SpondGroupMember[] | null,
  outsideComplete: false,
  teamBySubgroup: SUBGROUP_TEAMS as ReadonlyMap<string, string>,
  expectedTeam: 'Argonauts' as string | null,
  onAccept: noop,
  onChoose: noop,
  onUnlink: noop,
}

describe('TeamChipsView', () => {
  const teams: Team[] = [
    { id: 't1', name: 'Titans', bibColour: 'red' },
    { id: 't2', name: 'Trojans', bibColour: null },
  ]

  it('shows progress per team so a manager can see where to work', () => {
    const html = renderToStaticMarkup(
      <TeamChipsView
        teams={teams}
        selected="t1"
        countFor={(id) => (id === 't1' ? { linked: 7, total: 12 } : { linked: 0, total: 9 })}
        onSelect={noop}
      />,
    )
    expect(html).toContain('7/12 linked')
    expect(html).toContain('0/9 linked')
    expect(html).toContain('aria-pressed="true"')
  })

  it('says what is missing when no team is mapped, rather than showing nothing', () => {
    const html = renderToStaticMarkup(
      <TeamChipsView teams={[]} selected={null} countFor={() => ({ linked: 0, total: 0 })} onSelect={noop} />,
    )
    expect(html).toContain('No team has a Spond group mapped')
  })
})

describe('NeedsDecisionRowView', () => {
  it('offers Accept only where there is a suggestion to accept', () => {
    const suggested = renderToStaticMarkup(
      <NeedsDecisionRowView
        name="Alpha Synthetic"
        reason="suggested"
        suggestion="Alpha Synthetic"
        busy={false}
        onAccept={noop}
        onChoose={noop}
      />,
    )
    expect(suggested).toContain('Suggested: Alpha Synthetic')
    expect(suggested).toContain('Accept')

    const ambiguous = renderToStaticMarkup(
      <NeedsDecisionRowView
        name="Alpha Synthetic"
        reason="ambiguous"
        suggestion={null}
        busy={false}
        onAccept={noop}
        onChoose={noop}
      />,
    )
    expect(ambiguous).toContain('More than one possible match')
    expect(ambiguous).not.toContain('Accept')
    expect(ambiguous).toContain('Choose')
  })

  it('names the child who is in Spond and missing from the roster', () => {
    const html = renderToStaticMarkup(
      <NeedsDecisionRowView
        name="Gamma Synthetic"
        reason="not_on_roster"
        suggestion={null}
        busy={false}
        onAccept={noop}
        onChoose={noop}
      />,
    )
    // British English, and what the pool actually was: this member was
    // judged against the team's current season registrations.
    expect(html).toContain('Not a registered player')
    expect(html).not.toContain('Not on the roster')
  })
})

describe('LinkedRowView', () => {
  it('says what the link is and how it was made, and offers both Change and Unlink', () => {
    const html = renderToStaticMarkup(
      <LinkedRowView
        name="Alpha Synthetic"
        playerName="Alpha Synthetic"
        matchedBy="suggested"
        orphan={false}
        busy={false}
        onChange={noop}
        onUnlink={noop}
      />,
    )
    expect(html).toContain('accepted a suggestion')
    expect(html).toContain('Change')
    expect(html).toContain('Unlink')
  })

  it('an orphan can be unlinked but not changed, since there is no member to rebind', () => {
    const html = renderToStaticMarkup(
      <LinkedRowView
        name="No longer in this Spond group"
        playerName="Alpha Synthetic"
        matchedBy="chosen"
        orphan
        busy={false}
        onUnlink={noop}
      />,
    )
    expect(html).toContain('Unlink')
    expect(html).not.toContain('Change')
  })
})

describe('LinkSectionsView', () => {
  const render = (candidates: LinkCandidate[], links: SpondLink[]) =>
    renderToStaticMarkup(<LinkSectionsView {...sectionProps} candidates={candidates} links={links} pool={roster} />)

  it('nothing is preselected: no checkbox, no checked state, no pending set', () => {
    const html = render([candidate(M1, 'Alpha Synthetic')], [])
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('checked')
  })

  it('lists the three sections and hides the orphan one when it is empty', () => {
    const plain = render([candidate(M1, 'Alpha Synthetic')], [])
    expect(plain).toContain('Needs a decision')
    expect(plain).toContain('Linked')
    expect(plain).not.toContain('Links with no Spond member')

    const withOrphan = render([candidate(M1, 'Alpha Synthetic')], [link(M2, 'p2')])
    expect(withOrphan).toContain('Links with no Spond member')
    expect(withOrphan).toContain('Beta Synthetic')
  })

  it('explains why an orphan blocks a child rather than leaving it a mystery', () => {
    const html = render([], [link(M2, 'p2')])
    expect(html).toContain('still holds that child')
  })

  it('every row is disabled while a write is in flight, so one press cannot double write', () => {
    const html = renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} busy candidates={[candidate(M1, 'Alpha Synthetic')]} links={[]} pool={roster} />,
    )
    expect(html).toContain('disabled')
  })
})

// ---- What an incomplete Spond read must NOT be allowed to imply --------
//
// This is the review finding worth a test of its own: a short or empty
// member list made every stored link look like a dead orphan and invited
// the manager to unlink it, which drains that child's stored replies for
// a reason that was never true.

describe('an incomplete member list is never treated as evidence', () => {
  const incomplete = (candidates: LinkCandidate[], links: SpondLink[]) =>
    renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} complete={false} candidates={candidates} links={links} pool={roster} />,
    )

  it('does not offer to unlink a member who is merely missing from a short list', () => {
    const html = incomplete([], [link(M2, 'p2')])
    expect(html).not.toContain('Links with no Spond member')
    expect(html).toContain('came back incomplete')
  })

  it('does not claim everyone is linked when it never saw everyone', () => {
    const html = incomplete([], [])
    expect(html).not.toContain('Every Spond member in this group is linked')
  })

  it('a complete list still surfaces a genuine orphan', () => {
    const html = renderToStaticMarkup(
      <LinkSectionsView
        {...sectionProps}
        candidates={[candidate(M1, 'Alpha Synthetic')]}
        links={[link(M2, 'p2')]}
        pool={roster}
      />,
    )
    expect(html).toContain('Links with no Spond member')
    expect(html).not.toContain('came back incomplete')
  })
})

// ---- The registered players the screen previously never mentioned ------
//
// Production, 15 August: Argonauts held six unlinked registered players
// and Trojans five, and no section named any of them, because every
// section is candidate led and these children have no candidate. "Needs
// a decision" showed one staff member and a manager reasonably concluded
// there was nothing left to do.

describe('Spond setup to fix', () => {
  const render = (
    candidates: LinkCandidate[],
    links: SpondLink[],
    pool: RegisteredPlayer[],
    over: Partial<typeof sectionProps> = {},
  ) =>
    renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} {...over} candidates={candidates} links={links} pool={pool} />,
    )

  it('names them, with a count, when the member list is complete', () => {
    // The view composes the list itself from the raw inputs, so a
    // container cannot hand it an empty list while the suite stays
    // green, which a review demonstrated against the first version.
    const html = render([], [], [player('p3', 'Gamma Synthetic'), player('p4', 'Delta Synthetic')])
    expect(html).toContain('Spond setup to fix (2)')
    expect(html).toContain('Gamma Synthetic')
    expect(html).toContain('Delta Synthetic')
    // Where the gap is fixed, since the fix lives in Spond, not here.
    expect(html).toContain('in Spond')
  })

  it('claims nothing from an incomplete list, where absence is not evidence', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], { complete: false })
    expect(html).not.toContain('Spond setup to fix')
    expect(html).not.toContain('Gamma Synthetic')
  })

  it('is absent when every registered player has a match', () => {
    const html = render([candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Beta Synthetic')], [], roster)
    expect(html).not.toContain('Spond setup to fix')
  })

  it('surfaces the second of two same named children when the first is correctly linked', () => {
    // The review's counterexample: one "Alex" candidate, correctly
    // linked; a second Alex on the player list. The first version left
    // the second child in no section at all.
    const html = render(
      [candidate(M1, 'Alex Synthetic')],
      [link(M1, 'p5')],
      [player('p5', 'Alex Synthetic'), player('p6', 'Alex Synthetic')],
    )
    expect(html).toContain('Spond setup to fix (1)')
  })

  // ---- The three states, distinguished on the rendered screen ---------
  //
  // Production, 15 August: an Argonauts player sat under the old generic
  // list and Spond showed them in the club's group with no team assigned.
  // These render the real component over the three shapes and fail if any
  // two of them read the same.

  const threeCases = () =>
    render(
      [],
      [],
      [player('p3', 'Gamma Synthetic'), player('p4', 'Delta Synthetic'), player('p5', 'Epsilon Synthetic')],
      {
        outsideMembers: [outside('Gamma Synthetic', []), outside('Delta Synthetic', [SG_OTHER])],
        outsideComplete: true,
      },
    )

  it('distinguishes no team assigned, another team, and not found in the group data', () => {
    const html = threeCases()
    expect(html).toContain('In Spond · no team assigned')
    expect(html).toContain('In Spond · assigned to another team: Titans')
    expect(html).toContain('Not found in Spond group data')
    // Never the claim the group data cannot support.
    expect(html).not.toContain('Not in Spond')
  })

  it('names the expected team on the two Spond assignment findings and nowhere else', () => {
    const html = threeCases()
    expect(html.match(/Expected team: Argonauts/g)).toHaveLength(2)
    // The not found row carries a name and a finding, and no expected
    // team: there is no Spond assignment to compare it with.
    expect(html).toContain('Epsilon Synthetic')
  })

  it('says another Spond subgroup where no OTJ team can be determined', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', [SG_UNMAPPED])],
      outsideComplete: true,
    })
    expect(html).toContain('In Spond · assigned to another Spond subgroup')
    expect(html).not.toContain('assigned to another team:')
  })

  it('refuses to assert identity where two Spond members share the name', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', []), outside('Gamma Synthetic', [SG_OTHER])],
      outsideComplete: true,
    })
    expect(html).toContain('More than one Spond member goes by this name')
    expect(html).not.toContain('no team assigned')
    expect(html).not.toContain('assigned to another team')
    expect(html).not.toContain('Not found in Spond group data')
  })

  it('an incomplete scan states nothing, in either direction', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', [])],
      outsideComplete: false,
    })
    expect(html).toContain('Spond setup to fix (1)')
    expect(html).toContain('Not compared against the Spond group data')
    expect(html).not.toContain('no team assigned')
    expect(html).not.toContain('Not found in Spond group data')
  })

  it('a deployment that does not answer yet degrades to the old, unclaimed list', () => {
    // Merging this does not deploy the function; between the two, the
    // response carries no diagnostic field at all.
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: null,
      outsideComplete: false,
    })
    expect(html).toContain('Spond setup to fix (1)')
    expect(html).toContain('Gamma Synthetic')
    expect(html).toContain('Not compared against the Spond group data')
  })

  it('is read only: the section offers no control at all', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', [])],
      outsideComplete: true,
    })
    const section = html.slice(html.indexOf('Spond setup to fix'))
    expect(section).not.toContain('<button')
    expect(section).not.toContain('type="checkbox"')
  })
})

describe('SpondSetupRowView', () => {
  const render = (props: Parameters<typeof SpondSetupRowView>[0]) =>
    renderToStaticMarkup(<SpondSetupRowView {...props} />)

  it('says a name is already linked rather than calling it missing', () => {
    const html = render({
      name: 'Alex Synthetic',
      state: 'name_taken',
      otherTeam: null,
      expectedTeam: 'Argonauts',
    })
    expect(html).toContain('already linked to another registered player')
    expect(html).not.toContain('Not found in Spond group data')
    expect(html).not.toContain('Expected team')
  })

  it('carries no member id, so nothing can be linked from a diagnostic row', () => {
    const html = render({ name: 'Gamma Synthetic', state: 'no_subgroup', otherTeam: null, expectedTeam: 'Argonauts' })
    expect(html).not.toContain(M1)
    expect(html).not.toContain(M2)
    expect(html).not.toContain('<button')
  })
})

// ---- The picker: linking a member, in the product's own words ----------

describe('PickerView', () => {
  const render = () =>
    renderToStaticMarkup(
      <PickerView memberName="Synthetic Member" roster={roster} links={[link(M1, 'p1')]} onPick={noop} onClose={noop} />,
    )

  it('says Link Spond member, never the old question', () => {
    const html = render()
    expect(html).toContain('Link Spond member')
    expect(html).toContain('Select the matching registered player')
    expect(html).not.toContain('Which child is this?')
  })

  it('an already linked player cannot be picked, and says why', () => {
    const html = render()
    // Alpha is linked: the row is disabled with the reason beside it.
    expect(html).toMatch(/disabled=""><span>Alpha Synthetic<\/span>/)
    expect(html).toContain('linked to another Spond member')
    // Beta is free: no disabled attribute on that row.
    expect(html).toMatch(/<button class="sl-picker-row"><span>Beta Synthetic<\/span>/)
  })
})
