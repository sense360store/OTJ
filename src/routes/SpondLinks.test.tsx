import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LinkSectionsView, LinkedRowView, NeedsDecisionRowView, TeamChipsView } from './SpondLinks'
import { buildLinkSections, type LinkCandidate, type SpondLink } from '../lib/spondLinking'
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
    expect(html).toContain('Not on the roster')
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
        sections={buildLinkSections(candidates, links, roster)}
        busy={false}
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
        sections={buildLinkSections([candidate(M1, 'Alpha Synthetic')], [], roster)}
        busy
        onAccept={noop}
        onChoose={noop}
        onUnlink={noop}
      />,
    )
    expect(html).toContain('disabled')
  })
})
