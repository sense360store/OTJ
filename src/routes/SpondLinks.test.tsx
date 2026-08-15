import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LinkSectionsView, LinkedRowView, NeedsDecisionRowView, PickerView, TeamChipsView } from './SpondLinks'
import type { LinkCandidate, SpondLink } from '../lib/spondLinking'
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
    renderToStaticMarkup(
      <LinkSectionsView
        candidates={candidates}
        links={links}
        pool={roster}
        busy={false}
        complete
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
      />,
    )

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
      <LinkSectionsView
        candidates={[candidate(M1, 'Alpha Synthetic')]}
        links={[]}
        pool={roster}
        complete
        busy
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
      />,
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
      <LinkSectionsView
        candidates={candidates}
        links={links}
        pool={roster}
        busy={false}
        complete={false}
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
      />,
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
        candidates={[candidate(M1, 'Alpha Synthetic')]}
        links={[link(M2, 'p2')]}
        pool={roster}
        busy={false}
        complete
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
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

describe('registered players not matched yet', () => {
  const render = (candidates: LinkCandidate[], links: SpondLink[], pool: RegisteredPlayer[], complete = true) =>
    renderToStaticMarkup(
      <LinkSectionsView
        candidates={candidates}
        links={links}
        pool={pool}
        busy={false}
        complete={complete}
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
      />,
    )

  it('names them, with a count, when the member list is complete', () => {
    // The view composes the list itself from the raw inputs, so a
    // container cannot hand it an empty list while the suite stays
    // green, which a review demonstrated against the first version.
    const html = render([], [], [player('p3', 'Gamma Synthetic'), player('p4', 'Delta Synthetic')])
    expect(html).toContain('Registered players not matched yet (2)')
    expect(html).toContain('Gamma Synthetic')
    expect(html).toContain('Delta Synthetic')
    // Where the gap is fixed, since the fix lives in Spond, not here.
    expect(html).toContain('in Spond')
  })

  it('claims nothing from an incomplete list, where absence is not evidence', () => {
    const html = render([], [], [player('p3', 'Gamma Synthetic')], false)
    expect(html).not.toContain('Registered players not matched yet')
    expect(html).not.toContain('Gamma Synthetic')
  })

  it('is absent when every registered player has a match', () => {
    const html = render([candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Beta Synthetic')], [], roster)
    expect(html).not.toContain('Registered players not matched yet')
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
    expect(html).toContain('Registered players not matched yet (1)')
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
