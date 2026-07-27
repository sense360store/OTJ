import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

// The public links warning inside the remove member modal. It is advisory and
// must never gate a removal, so the cases that matter are the ones where it
// renders nothing: no shares.manage, no count, a count that failed to load, and
// a member with no live links. Rendered through the static renderer with the
// two data hooks mocked, the same style as PublicShareControl.gating.test.tsx.

let caps = new Set<string>(['users.manage', 'shares.manage'])
let count: number | null | undefined = 2

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    useMyCapabilities: () => ({ caps, isPending: false }),
    useMemberActiveShareCount: () => ({ data: count }),
  }
})

const { MemberShareWarning } = await import('./AdminUsers')

const MEMBER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

function html(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MemberShareWarning memberId={MEMBER_ID} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  caps = new Set<string>(['users.manage', 'shares.manage'])
  count = 2
})

describe('MemberShareWarning', () => {
  it('states the count and what removal does not do', () => {
    const h = html()
    expect(h).toContain('2 public links still working')
    expect(h).toContain('does not turn')
    expect(h).toContain('former member')
  })

  it('reads naturally for a single link', () => {
    count = 1
    const h = html()
    expect(h).toContain('1 public link still working')
    expect(h).toContain('link keeps working')
  })

  it('links to the Shared links screen filtered to that member', () => {
    expect(html()).toContain(`href="/admin/shares?createdBy=${MEMBER_ID}"`)
    expect(html()).toContain('Review their links')
  })

  it('renders nothing when the member has no live links', () => {
    count = 0
    expect(html()).toBe('')
  })

  it('renders nothing when the count could not be read', () => {
    // A failed or still pending count must not turn into a claim either way.
    count = undefined
    expect(html()).toBe('')
    count = null
    expect(html()).toBe('')
  })

  it('renders nothing for an admin who does not hold shares.manage', () => {
    caps = new Set<string>(['users.manage'])
    expect(html()).toBe('')
  })

  it('offers no control of its own, so it can never block a removal', () => {
    const h = html()
    expect(h).not.toContain('<button')
    expect(h).not.toContain('disabled')
    // It is a note, announced politely, not an error that stops the flow.
    expect(h).toContain('role="status"')
    expect(h).not.toContain('role="alert"')
  })
})
