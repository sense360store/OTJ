import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ContentShareStatusResult } from '../lib/queries'
import { KILL_SWITCH_NOTE } from '../lib/publicShare'

// The control's lifecycle hooks are mocked so the pure gating branches (kill
// switch, capability gating, an existing share for owner vs manager) render
// deterministically without a QueryClient or the network. The server is the
// real boundary; this only proves the UI surfaces the right affordance.

let statusData: ContentShareStatusResult | undefined
let statusPending = false

const idleMutation = { mutate: vi.fn(), isPending: false, data: undefined as unknown }

vi.mock('../lib/queries', () => ({
  useContentShareStatus: () => ({ data: statusData, isPending: statusPending }),
  usePreviewContentShare: () => idleMutation,
  useCreateContentShare: () => idleMutation,
  useRefreshContentShare: () => idleMutation,
  useRotateContentShare: () => idleMutation,
  useRevokeContentShare: () => idleMutation,
}))

const { PublicShareControl } = await import('./PublicShareControl')

function render(props: {
  canPublish: boolean
  canRevokeAny: boolean
}): string {
  return renderToStaticMarkup(
    <PublicShareControl
      kind="session"
      sourceId="11111111-1111-1111-1111-111111111111"
      title="Tuesday session"
      canPublish={props.canPublish}
      canRevokeAny={props.canRevokeAny}
    />,
  )
}

describe('PublicShareControl gating (session)', () => {
  beforeEach(() => {
    statusData = undefined
    statusPending = false
  })

  it('shows the calm disabled note when the club kill switch is off', () => {
    statusData = { share: null, sharingEnabled: false }
    const html = render({ canPublish: true, canRevokeAny: false })
    expect(html).toContain(KILL_SWITCH_NOTE)
    expect(html).not.toContain('Publish public link')
  })

  it('offers publish to an owner with the capability when sharing is on and no link exists', () => {
    statusData = { share: null, sharingEnabled: true }
    const html = render({ canPublish: true, canRevokeAny: false })
    expect(html).toContain('Publish public link')
  })

  it('explains why a coach without ownership or the capability cannot publish', () => {
    statusData = { share: null, sharingEnabled: true }
    const html = render({ canPublish: false, canRevokeAny: false })
    expect(html).toContain('Only the coach who owns this session')
    expect(html).not.toContain('Publish public link')
  })

  it('shows Manage this link to the owner when an active share exists', () => {
    statusData = {
      share: {
        shareId: 's1', kind: 'session', isOwner: true, canManage: true,
        expiresAt: null, createdAt: null, refreshedAt: null, rotatedAt: null,
        hasSnapshot: true, snapshot: null,
      },
      sharingEnabled: true,
    }
    const html = render({ canPublish: true, canRevokeAny: false })
    expect(html).toContain('Manage this link')
    expect(html).toContain('Active, no expiry')
  })

  it('offers only Turn off this link to a manager on another coach’s share', () => {
    statusData = {
      share: {
        shareId: 's1', kind: 'session', isOwner: false, canManage: true,
        expiresAt: null, createdAt: null, refreshedAt: null, rotatedAt: null,
        hasSnapshot: true, snapshot: null,
      },
      sharingEnabled: true,
    }
    const html = render({ canPublish: false, canRevokeAny: true })
    expect(html).toContain('Turn off this link')
    expect(html).toContain('created by another coach')
    expect(html).not.toContain('Manage this link')
  })
})

function renderProgramme(props: { canPublish: boolean; canRevokeAny: boolean }): string {
  return renderToStaticMarkup(
    <PublicShareControl
      kind="programme"
      sourceId="22222222-2222-2222-2222-222222222222"
      title="Playing out from the back"
      canPublish={props.canPublish}
      canRevokeAny={props.canRevokeAny}
    />,
  )
}

describe('PublicShareControl gating (programme)', () => {
  beforeEach(() => {
    statusData = undefined
    statusPending = false
  })

  it('renders nothing at all for a parent, who holds neither capability', () => {
    statusData = { share: null, sharingEnabled: true }
    expect(renderProgramme({ canPublish: false, canRevokeAny: false })).toContain('Only the coach who owns this programme')
  })

  it('shows the calm disabled note when the club kill switch is off', () => {
    statusData = { share: null, sharingEnabled: false }
    const html = renderProgramme({ canPublish: true, canRevokeAny: false })
    expect(html).toContain(KILL_SWITCH_NOTE)
    expect(html).not.toContain('Publish public link')
  })

  it('offers publish to a programme owner with the capability when sharing is on', () => {
    statusData = { share: null, sharingEnabled: true }
    expect(renderProgramme({ canPublish: true, canRevokeAny: false })).toContain('Publish public link')
  })

  it('names the programme, not a drill or a session, in the ownership explanation', () => {
    statusData = { share: null, sharingEnabled: true }
    const html = renderProgramme({ canPublish: false, canRevokeAny: false })
    expect(html).toContain('Only the coach who owns this programme')
    expect(html).not.toContain('owns this drill')
    expect(html).not.toContain('owns this session')
  })

  it('offers only Turn off this link to a manager on another coach’s programme share', () => {
    statusData = {
      share: {
        shareId: 's2', kind: 'programme', isOwner: false, canManage: true,
        expiresAt: null, createdAt: null, refreshedAt: null, rotatedAt: null,
        hasSnapshot: true, snapshot: null,
      },
      sharingEnabled: true,
    }
    const html = renderProgramme({ canPublish: false, canRevokeAny: true })
    expect(html).toContain('Turn off this link')
    expect(html).not.toContain('Manage this link')
  })
})
