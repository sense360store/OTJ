import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpondLinkReviewView } from './SpondLinkModal'
import { planSpondLinking, type PlayerSpondLink } from '../lib/spondLinking'

// The linking review list, presentational: the container resolves the
// candidates, players and links and owns the selection state, so every
// state renders here from plain fixtures. Names are synthetic, never real
// children.

const noop = () => {}

const players = [
  { id: 'p1', displayName: 'Madeup Childname' },
  { id: 'p2', displayName: 'Other Synthetic' },
]

const link: PlayerSpondLink = {
  id: 'link-1',
  playerId: 'p1',
  spondMemberId: 'FAKE-MEMBER-1',
  matchedBy: 'auto',
  confirmedAt: null,
}

function render(planArgs: Parameters<typeof planSpondLinking>, selections: Record<string, string> = {}) {
  const plan = planSpondLinking(...planArgs)
  return renderToStaticMarkup(
    <SpondLinkReviewView
      plan={plan}
      players={players}
      selections={selections}
      busy={false}
      onSelect={noop}
      onUnlink={noop}
    />,
  )
}

describe('SpondLinkReviewView', () => {
  it('shows an automatic match as Matched with the player preselected', () => {
    const html = render(
      [[{ spondMemberId: 'FAKE-MEMBER-1', displayName: 'Madeup Childname' }], players, []],
      { 'FAKE-MEMBER-1': 'p1' },
    )
    expect(html).toContain('Not linked yet')
    expect(html).toContain('Matched')
    expect(/<option[^>]*selected[^>]*value="p1"|value="p1"[^>]*selected/.test(html)).toBe(true)
  })

  it('an ambiguous candidate reads Choose and preselects nothing', () => {
    const twoSame = [
      { id: 'p1', displayName: 'Madeup Childname' },
      { id: 'p3', displayName: 'madeup childname' },
    ]
    const html = renderToStaticMarkup(
      <SpondLinkReviewView
        plan={planSpondLinking([{ spondMemberId: 'FAKE-MEMBER-1', displayName: 'Madeup Childname' }], twoSame, [])}
        players={twoSame}
        selections={{}}
        busy={false}
        onSelect={noop}
        onUnlink={noop}
      />,
    )
    expect(html).toContain('Choose')
    expect(html).not.toContain('Matched')
  })

  it('a linked candidate lists under Linked with the resolved player and an unlink control', () => {
    const html = render([[{ spondMemberId: 'FAKE-MEMBER-1', displayName: 'Madeup Childname' }], players, [link]])
    expect(html).toContain('>Linked<')
    expect(html).toContain('Unlink')
    expect(html).not.toContain('Not linked yet')
  })

  it('renders the plain empty state when there is nothing to show', () => {
    const html = render([[], players, []])
    expect(html).toContain('No Spond members to show for this team.')
  })

  it('freezes the controls while a write is in flight', () => {
    const plan = planSpondLinking([{ spondMemberId: 'FAKE-MEMBER-1', displayName: 'Madeup Childname' }], players, [])
    const html = renderToStaticMarkup(
      <SpondLinkReviewView plan={plan} players={players} selections={{}} busy onSelect={noop} onUnlink={noop} />,
    )
    expect(/<select[^>]*disabled/.test(html)).toBe(true)
  })
})
