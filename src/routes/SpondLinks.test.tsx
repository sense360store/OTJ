import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConfirmReconcileView,
  LinkSectionsView,
  LinkedRowView,
  NeedsDecisionRowView,
  PickerView,
  SpondSetupRowView,
  TeamChipsView,
} from './SpondLinks'
import type { LinkCandidate, SpondGroupMember, SpondLink, SubgroupTeam } from '../lib/spondLinking'
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
  [SG_MINE, { teamId: 't1', teamName: 'Argonauts' }],
  [SG_OTHER, { teamId: 't2', teamName: 'Titans' }],
])
const outside = (name: string, subgroupIds: string[] = [], id = ''): SpondGroupMember => ({
  displayName: name,
  spondMemberId: id,
  subgroupIds,
})

// The view's props, with the diagnostics off by default so every test
// that predates them keeps rendering exactly what it rendered before.
const sectionProps = {
  busy: false,
  complete: true,
  outsideMembers: null as SpondGroupMember[] | null,
  outsideComplete: false,
  teamBySubgroup: SUBGROUP_TEAMS as ReadonlyMap<string, SubgroupTeam>,
  clubRoster: [] as RegisteredPlayer[],
  expectedTeam: 'Argonauts' as string | null,
  expectedTeamId: 't1' as string | null,
  subgroupMappingComplete: true,
  reconcileBusy: false,
  onApplyReconcile: noop,
  onConfirmReconcile: noop,
  onApplyAllReconcile: noop,
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

  it('says the name is taken without claiming the two members are one child', () => {
    const html = renderToStaticMarkup(
      <NeedsDecisionRowView
        name="Alpha Synthetic"
        reason="name_taken"
        suggestion={null}
        busy={false}
        onAccept={noop}
        onChoose={noop}
      />,
    )
    expect(html).toContain('Same name as a registered player who is already linked')
    // The false claim this closes.
    expect(html).not.toContain('Not a registered player')
    // And none of the claims the data cannot support. Two equal names do
    // not prove one child, a duplicate registration, or a wrong record;
    // the club may simply hold two children of one name.
    for (const forbidden of ['uplicate', 'same child', 'same person', 'wrong Spond', 'wrong record']) {
      expect(html).not.toContain(forbidden)
    }
    // Nothing is offered to accept, and the human path stays.
    expect(html).not.toContain('Accept')
    expect(html).toContain('Choose')
  })

  it('renders no member id on any reason', () => {
    // The id is a React key and a callback argument, never markup: it is
    // an opaque implementation identifier and a manager has no use for
    // it. Every reason, because the sub line is the thing that changed.
    for (const reason of ['suggested', 'ambiguous', 'name_taken', 'not_on_roster'] as const) {
      const html = renderToStaticMarkup(
        <NeedsDecisionRowView
          name="Alpha Synthetic"
          reason={reason}
          suggestion={reason === 'suggested' ? 'Alpha Synthetic' : null}
          busy={false}
          onAccept={noop}
          onChoose={noop}
        />,
      )
      expect(html).not.toContain(M1)
      expect(html).not.toContain(M1.toLowerCase())
    }
  })
})

// ---- The production shape, through the composed screen ---------------------
//
// The unit above renders one row from a prop. This renders the view that
// composes buildLinkSections itself, which is where the defect actually
// lived: the reason was computed correctly for every case the screen had
// a sentence for, and the case it had none for fell through to the
// sentence for "missing from the player list".
//
// Two Spond members both displaying one name, one of them linked, is the
// 15 August production shape. Names are synthetic.
describe('the second Spond member of an already linked name, composed', () => {
  const billyShape = (
    <LinkSectionsView
      {...sectionProps}
      candidates={[candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Alpha Synthetic')]}
      links={[link(M2, 'p1')]}
      pool={roster}
    />
  )

  it('does not tell a manager that a linked, registered child is unregistered', () => {
    const html = renderToStaticMarkup(billyShape)
    expect(html).toContain('Same name as a registered player who is already linked')
    expect(html).not.toContain('Not a registered player')
  })

  it('still shows the link it already has, so both facts are on screen', () => {
    const html = renderToStaticMarkup(billyShape)
    expect(html).toContain('Alpha Synthetic · chosen')
  })

  it('keeps the genuine finding for a member no registered player matches', () => {
    // The same screen, one member of an unregistered name: the sentence
    // that matters must not have been widened away.
    const html = renderToStaticMarkup(
      <LinkSectionsView
        {...sectionProps}
        candidates={[candidate(M1, 'Gamma Synthetic')]}
        links={[]}
        pool={roster}
      />,
    )
    expect(html).toContain('Not a registered player')
    expect(html).not.toContain('Same name as a registered player')
  })

  it('leaves the two sided ambiguity refusal exactly as it was', () => {
    // Two free members, one free child: no automatic link, no Accept,
    // and the ambiguity sentence rather than the new one.
    const html = renderToStaticMarkup(
      <LinkSectionsView
        {...sectionProps}
        candidates={[candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Alpha Synthetic')]}
        links={[]}
        pool={roster}
      />,
    )
    expect(html).toContain('More than one possible match')
    expect(html).not.toContain('Same name as a registered player')
    expect(html).not.toContain('Accept')
  })

  it('puts no Spond member id on the screen', () => {
    const html = renderToStaticMarkup(billyShape)
    expect(html).not.toContain(M1)
    expect(html).not.toContain(M2)
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

describe('Registered players with no Spond member', () => {
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
    expect(html).toContain('Registered players with no Spond member (2)')
    expect(html).toContain('Gamma Synthetic')
    expect(html).toContain('Delta Synthetic')
    // Where the gap is fixed, since the fix lives in Spond, not here.
    expect(html).toContain('in Spond')
  })

  it('claims nothing from an incomplete list, where absence is not evidence', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], { complete: false })
    expect(html).not.toContain('Registered players with no Spond member')
    expect(html).not.toContain('Gamma Synthetic')
  })

  it('is absent when every registered player has a match', () => {
    const html = render([candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Beta Synthetic')], [], roster)
    expect(html).not.toContain('Registered players with no Spond member')
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
    expect(html).toContain('Registered players with no Spond member (1)')
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
    expect(html).toContain('More than one person here goes by this name')
    expect(html).not.toContain('no team assigned')
    expect(html).not.toContain('assigned to another team')
    expect(html).not.toContain('Not found in Spond group data')
  })

  it('an incomplete scan states nothing, in either direction', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', [])],
      outsideComplete: false,
    })
    expect(html).toContain('Registered players with no Spond member (1)')
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
    expect(html).toContain('Registered players with no Spond member (1)')
    expect(html).toContain('Gamma Synthetic')
    expect(html).toContain('Not compared against the Spond group data')
  })

  it('is read only: the section offers no control at all', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], {
      outsideMembers: [outside('Gamma Synthetic', [])],
      outsideComplete: true,
    })
    const section = html.slice(html.indexOf('Registered players with no Spond member'))
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
      shirtNumber: null,
      state: 'name_taken',
      otherTeam: null,
      expectedTeam: 'Argonauts',
    })
    expect(html).toContain('already linked to another registered player')
    expect(html).not.toContain('Not found in Spond group data')
    expect(html).not.toContain('Expected team')
  })

  it('carries no member id, so nothing can be linked from a diagnostic row', () => {
    const html = render({ name: 'Gamma Synthetic', shirtNumber: 9, state: 'no_subgroup', otherTeam: null, expectedTeam: 'Argonauts' })
    expect(html).not.toContain(M1)
    expect(html).not.toContain(M2)
    expect(html).not.toContain('<button')
  })

  it('keeps the shirt number, the only thing that tells two same named children apart', () => {
    // A review found it dropped in the rewrite, which made the ambiguous
    // state, two children of one name, render as two identical rows.
    const html = render({ name: 'Sam Synthetic', shirtNumber: 7, state: 'ambiguous', otherTeam: null, expectedTeam: 'Argonauts' })
    expect(html).toContain('#7')
    const none = render({ name: 'Sam Synthetic', shirtNumber: null, state: 'ambiguous', otherTeam: null, expectedTeam: 'Argonauts' })
    expect(none).not.toContain('#')
  })
})

describe('the section says what it can and cannot answer', () => {
  it('names what the list is rather than asserting every row is a fault to fix', () => {
    // "Spond setup to fix" is false for two of the states it covers, and
    // false for every row during the window between merging this and
    // deploying the function, when nothing has been compared at all.
    const html = renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} candidates={[]} links={[]} pool={[player('p3', 'Gamma Synthetic')]} />,
    )
    expect(html).toContain('Registered players with no Spond member (1)')
    expect(html).toContain('Not compared against the Spond group data')
    expect(html).not.toContain('setup to fix')
  })

  it('keeps the different name remedy, which absence wording alone loses', () => {
    const html = renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} candidates={[]} links={[]} pool={[player('p3', 'Gamma Synthetic')]} />,
    )
    expect(html).toContain('under a different name')
    expect(html).toContain('Choose')
  })

  it('says staff are not searched, since they were removed before the search ran', () => {
    // "Not found in Spond group data" is an absence claim over a
    // population staff had already been taken out of, so the population
    // is named rather than left implied.
    const html = renderToStaticMarkup(
      <LinkSectionsView {...sectionProps} candidates={[]} links={[]} pool={[player('p3', 'Gamma Synthetic')]} />,
    )
    expect(html).toContain('Staff are not searched')
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

// ---- Making OTJ agree with Spond, through the composed screen -------------
//
// PRODUCTION, 16 August 2026, Argonauts: three mismatches the screen could
// see and could only describe. These render the composed view over those
// three shapes and assert what a manager is offered, because the composition
// is where this kind of defect lives: the pure rule can be exactly right
// while the container hands the view a literal, and no test of the rule
// would notice.

describe('the Spond team assignment section, composed', () => {
  const M3 = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'
  // The three Argonauts children of the production report. Alpha is linked
  // and Spond has them on Titans (t2, the other mapped team); Beta is linked
  // and Spond has them in no team; Gamma is registered on this team and not
  // linked at all.
  const proved = { ...sectionProps, outsideComplete: true }

  const render = (
    links: SpondLink[],
    outsideMembers: SpondGroupMember[],
    pool: RegisteredPlayer[] = roster,
    over: Partial<typeof sectionProps> = {},
  ) =>
    renderToStaticMarkup(
      <LinkSectionsView
        {...proved}
        {...over}
        candidates={[]}
        links={links}
        pool={pool}
        clubRoster={pool}
        outsideMembers={outsideMembers}
      />,
    )

  it('offers a linked child the move Spond states, both ways round', () => {
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    expect(html).toContain('In Spond · assigned to another team: Titans')
    expect(html).toContain('OTJ team: Argonauts')
    expect(html).toContain('Argonauts → Titans')
    expect(html).toContain('Update OTJ to Spond')
  })

  it('offers Unassigned for a linked child Spond has in no team', () => {
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [], M1)])
    expect(html).toContain('In Spond · no team assigned')
    expect(html).toContain('Argonauts → Unassigned')
    expect(html).toContain('Update OTJ to Spond')
  })

  it('offers an UNLINKED child confirmation first, never a bare move', () => {
    // The whole identity rule, at the surface a manager actually reads.
    const html = render([], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    expect(html).toContain('Confirm player &amp; update OTJ to Titans')
    expect(html).not.toContain('Update OTJ to Spond')
    expect(html).toContain('Not linked to a Spond member yet')
  })

  it('offers nothing at all when Spond names two teams', () => {
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [SG_OTHER, SG_MINE], M1)])
    expect(html).toContain('in more than one team, so Spond gives no single answer')
    expect(html).not.toContain('Update OTJ to Spond')
    expect(html).not.toContain('Confirm player')
  })

  it('offers nothing, and guesses no team, for a subgroup nobody maps', () => {
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [SG_UNMAPPED], M1)])
    expect(html).toContain('in a Spond subgroup no team is mapped to')
    expect(html).not.toContain('Unassigned')
    expect(html).not.toContain('Update OTJ to Spond')
  })

  it('says nothing when the club maps a whole Spond group', () => {
    const html = render(
      [link(M1, 'p1')],
      [outside('Alpha Synthetic', [SG_OTHER], M1)],
      roster,
      { subgroupMappingComplete: false },
    )
    expect(html).toContain('mapped to a whole Spond group')
    expect(html).not.toContain('Update OTJ to Spond')
  })

  it('says nothing when the scan is not proved, rather than a shorter list', () => {
    const html = render(
      [link(M1, 'p1')],
      [outside('Alpha Synthetic', [SG_OTHER], M1)],
      roster,
      { outsideComplete: false },
    )
    expect(html).toContain('did not return the member and group data in full')
    expect(html).not.toContain('Update OTJ to Spond')
  })

  it('puts no Spond member id on the screen, even now that the row carries one', () => {
    const html = render([], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    for (const id of [M1, M2, M3]) expect(html).not.toContain(id)
  })

  it('does not also report the moved member as gone from the Spond group', () => {
    // Before this, a linked child whose member had moved subgroup showed up
    // under "Links with no Spond member" saying they were no longer offered,
    // which is false and invites an unlink that drains their stored replies.
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    expect(html).not.toContain('Links with no Spond member')
    expect(html).not.toContain('no longer offered from the team')
  })

  it('still reports a link whose member the scan genuinely never saw', () => {
    // The narrow half: the orphan section is corrected, not removed.
    const html = render([link(M2, 'p2')], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    expect(html).toContain('Links with no Spond member')
  })

  it('does not describe a child twice, once as a gap and once as an offer', () => {
    const html = render([], [outside('Alpha Synthetic', [SG_OTHER], M1)])
    expect(html).toContain('Confirm player')
    // The read only description of the same finding has moved aside, so the
    // screen makes one statement about this child rather than two.
    expect(html).not.toContain('In Spond · assigned to another team: Titans</span><span class="sl-sub">Expected')
    expect(html.split('Alpha Synthetic').length - 1).toBeLessThanOrEqual(2)
  })

  it('says so plainly when every linked player agrees with Spond', () => {
    const html = render([link(M1, 'p1')], [outside('Alpha Synthetic', [SG_MINE], M1)])
    expect(html).toContain('Every linked player on this team is on the same team in Spond.')
  })

  it('offers the bulk apply only when nothing needs an identity settled', () => {
    const both = [player('p1', 'Alpha Synthetic'), player('p2', 'Beta Synthetic')]
    const allProved = render(
      [link(M1, 'p1'), link(M2, 'p2')],
      [outside('Alpha Synthetic', [SG_OTHER], M1), outside('Beta Synthetic', [SG_OTHER], M2)],
      both,
    )
    expect(allProved).toContain('Apply all safe Spond changes (2)')

    const oneUnlinked = render(
      [link(M1, 'p1')],
      [outside('Alpha Synthetic', [SG_OTHER], M1), outside('Beta Synthetic', [SG_OTHER], M2)],
      both,
    )
    expect(oneUnlinked).toContain('Confirm player')
    expect(oneUnlinked).not.toContain('Apply all safe Spond changes')
  })
})

describe('the confirmation a name match earns', () => {
  const gap = player('p1', 'Alpha Synthetic')
  const row = {
    player: gap,
    state: 'confirm' as const,
    from: { kind: 'team' as const, teamId: 't1', teamName: 'Argonauts' },
    to: { kind: 'team' as const, teamId: 't2', teamName: 'Titans' },
    memberId: M1,
    confirmName: 'Alpha Synthetic',
  }
  const render = (busy = false) =>
    renderToStaticMarkup(
      <ConfirmReconcileView row={row} busy={busy} onCancel={noop} onConfirm={noop} />,
    )

  it('says who is being matched to whom, and that it is the manager deciding', () => {
    const html = render()
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('except the name')
    expect(html).toContain('your decision')
  })

  it('names both effects, and that they land together or not at all', () => {
    const html = render()
    expect(html).toContain('together or not at all')
    expect(html).toContain('links that Spond member')
    expect(html).toContain('Argonauts')
    expect(html).toContain('Titans')
  })

  it('states the three things it does not do', () => {
    const html = render()
    expect(html).toContain('Nothing is sent to Spond')
    expect(html).toContain('no past season changes')
    expect(html).toContain('no saved session is touched')
  })

  it('shows no member id, even though the row carries one', () => {
    expect(render()).not.toContain(M1)
  })

  it('freezes while the write is in flight, so no half landed change is dismissible', () => {
    const html = render(true)
    expect(html).toContain('Saving…')
    // Both footer buttons disabled, and the dialog's own dismissal routes with
    // them: this one creates a permanent link.
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
