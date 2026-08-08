import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PublicLinkSectionView,
  PublicShareBlockedView,
  PublicShareResultView,
  PublicSharePreviewBody,
  ShareAction,
} from './ShareModal'
import { FA_RESTRICTED_NOTE, type SharePreviewProvenance } from '../lib/shareBlockers'
import {
  type PublicDrillSnapshot,
  PUBLIC_SNAPSHOT_VERSION,
  RIGHTS_WARNING,
  SECRET_ONCE_NOTE,
} from '../lib/publicShare'

// This repository has no jsdom, testing-library or browser automation, so these
// are static markup pins, not interaction tests. What a click LEADS TO is
// tested as pure state in src/lib/shareFlow.test.ts and shareBlockers.test.ts;
// what is rendered for a given state is pinned here. The gap is stated in the
// pull request rather than papered over.

const noop = () => {}
const noFeedback: { role: 'status' | 'alert' | null; message: string } = { role: null, message: '' }

function prov(over: Partial<SharePreviewProvenance> = {}): SharePreviewProvenance {
  return {
    source: over.source ?? 'none',
    restricted: { template: false, drill: false, media: false, pdf: false, ...(over.restricted ?? {}) },
  }
}

function drillSnapshot(): PublicDrillSnapshot {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'drill',
    title: 'Rondo under pressure',
    summary: 'A possession square.',
    classification: null,
    skill: null,
    ages: [],
    level: null,
    duration: null,
    playerGuidance: null,
    area: null,
    equipment: [],
    setupNotes: null,
    coachingPoints: [],
    easier: [],
    harder: [],
    theme: null,
    format: null,
    sourceAttribution: null,
    media: [],
    snapshotAt: '2026-07-27T10:00:00.000Z',
  }
}

// =====================================================================
// The primary action
// =====================================================================
describe('ShareAction, the page level button', () => {
  const base = {
    kind: 'programme' as const,
    sourceId: 'p1',
    title: 'Mybe',
    rights: 'internal_only' as const,
    source: {},
    canClassify: true,
    canShareInternal: true,
    canPublish: true,
    canRevokeAny: false,
  }

  it('renders one Share button, not two competing ones', () => {
    const html = renderToStaticMarkup(<ShareAction {...base} />)
    expect(html.match(/<button/g) ?? []).toHaveLength(1)
    expect(html).toContain('Share')
  })

  it('meets the 44px touch target and announces that it opens a dialog', () => {
    const html = renderToStaticMarkup(<ShareAction {...base} />)
    expect(html).toContain('min-height:44px')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('is present for a coach who can only share inside the club', () => {
    const html = renderToStaticMarkup(<ShareAction {...base} canPublish={false} canRevokeAny={false} />)
    expect(html).toContain('Share')
  })

  it('is present for a manager who can only turn a link off', () => {
    const html = renderToStaticMarkup(
      <ShareAction {...base} canShareInternal={false} canPublish={false} canRevokeAny />,
    )
    expect(html).toContain('Share')
  })

  // A parent has none of the three affordances anywhere in the app.
  it('renders nothing at all for someone with no sharing affordance', () => {
    const html = renderToStaticMarkup(
      <ShareAction {...base} canShareInternal={false} canPublish={false} canRevokeAny={false} />,
    )
    expect(html).toBe('')
  })

  it('does not open the dialog until it is pressed, so nothing is published by rendering a page', () => {
    const html = renderToStaticMarkup(<ShareAction {...base} />)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('Create a public link')
  })
})

// =====================================================================
// The public section of the dialog
// =====================================================================
describe('PublicLinkSectionView', () => {
  const base = {
    noun: 'programme',
    expiry: 'Active, no expiry',
    expired: false,
    busy: false,
    onCreate: noop,
    onManage: noop,
    onRevoke: noop,
  }

  it('never labels the anonymous action simply Share, and says no login is needed', () => {
    const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section="create" />)
    expect(html).toContain('Create a public link')
    expect(html).toContain('no login')
  })

  it('renders nothing when the viewer has no publishing authority', () => {
    expect(renderToStaticMarkup(<PublicLinkSectionView {...base} section="hidden" />)).toBe('')
  })

  it('states the club kill switch rather than pretending a link can be made', () => {
    const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section="disabled" />)
    expect(html).toContain('Public sharing is turned off for your club')
    expect(html).not.toContain('Create a public link')
  })

  it('gives the owner management of a live link', () => {
    const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section="owned" />)
    expect(html).toContain('Manage this link')
    expect(html).toContain('without signing in')
  })

  it('gives a manager only a turn off, and says whose link it is', () => {
    const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section="others" />)
    expect(html).toContain('Turn off this link')
    expect(html).not.toContain('Manage this link')
    expect(html).toContain('not replace it')
  })

  it('says an expired link has expired, and does not claim anyone can open it', () => {
    // Every link this dialog creates expires after 90 days, and the status read
    // still returns the row, because an expired share is refreshable.
    const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section="owned" expired expiry="Expired" />)
    expect(html).toContain('This public link has expired')
    expect(html).not.toContain('A public link is live')
    expect(html).not.toContain('without signing in')
    expect(html).toContain('unavailable message')
  })

  it('keeps every control at a 44px target', () => {
    for (const section of ['create', 'owned', 'others'] as const) {
      const html = renderToStaticMarkup(<PublicLinkSectionView {...base} section={section} />)
      expect(html).toContain('min-height:44px')
    }
  })
})

// =====================================================================
// The blocked answer
// =====================================================================
describe('PublicShareBlockedView', () => {
  // The production regression: programme f2de855c (six nominal weeks, no week
  // templates, no source, no PDF, rights club only).
  describe('an empty programme', () => {
    const html = renderToStaticMarkup(
      <PublicShareBlockedView
        noun="programme"
        blocked={['no_weeks', 'source_internal_only']}
        provenance={prov()}
        canClassify
        onClassify={noop}
      />,
    )

    it('leads with the fact that there is nothing to share', () => {
      expect(html).toContain('This programme has no weeks yet, so there is nothing to share.')
    })

    it('does not mention England Football', () => {
      expect(html).not.toMatch(/England Football/i)
    })

    it('does not carry the long public content warning', () => {
      expect(html).not.toContain('You wrote this, it will be public')
      expect(html).not.toContain(RIGHTS_WARNING)
    })

    it('does not offer a public link', () => {
      expect(html).not.toContain('Create public link')
    })

    it('renders no empty preview frame', () => {
      expect(html).not.toContain('public-preview-frame')
    })

    it('does not offer a rights change, which would not unblock it', () => {
      expect(html).not.toContain('Change the sharing level')
      expect(html).toContain('Add a week template')
    })

    it('announces the blocker to assistive tech', () => {
      expect(html).toContain('role="alert"')
    })

    it('points at the club link, which still works', () => {
      expect(html).toContain('club link')
    })
  })

  it('offers a rights change when the level is the only blocker and the user owns the content', () => {
    const html = renderToStaticMarkup(
      <PublicShareBlockedView
        noun="programme"
        blocked={['source_internal_only']}
        provenance={prov()}
        canClassify
        onClassify={noop}
      />,
    )
    expect(html).toContain('currently set to club only')
    expect(html).toContain('Change the sharing level')
    expect(html).toContain('min-height:44px')
  })

  it('withholds the rights change from someone who does not own the content', () => {
    const html = renderToStaticMarkup(
      <PublicShareBlockedView
        noun="drill"
        blocked={['source_internal_only']}
        provenance={prov()}
        canClassify={false}
        onClassify={noop}
      />,
    )
    expect(html).not.toContain('Change the sharing level')
    expect(html).toContain('Only the person who created this')
  })

  it('offers no rights change for proven England Football content, and says why', () => {
    const html = renderToStaticMarkup(
      <PublicShareBlockedView
        noun="drill"
        blocked={['source_internal_only']}
        provenance={prov({ source: 'fa' })}
        canClassify
        onClassify={noop}
      />,
    )
    expect(html).toContain(FA_RESTRICTED_NOTE)
    expect(html).not.toContain('Change the sharing level')
  })

  it('names no week, drill or file when a nested item is club only', () => {
    const html = renderToStaticMarkup(
      <PublicShareBlockedView
        noun="programme"
        blocked={['drill_internal_only']}
        provenance={prov()}
        canClassify
        onClassify={noop}
      />,
    )
    expect(html).toContain('One or more drills in this programme are set to club only.')
    expect(html).not.toContain('Change the sharing level')
  })
})

// =====================================================================
// The eligible answer
// =====================================================================
describe('PublicSharePreviewBody', () => {
  const html = renderToStaticMarkup(<PublicSharePreviewBody kind="drill" snapshot={drillSnapshot()} />)

  it('carries the privacy warning, because there is something to check', () => {
    expect(html).toContain('You wrote this, it will be public')
    expect(html).toContain(RIGHTS_WARNING)
  })

  it('renders the projection itself', () => {
    expect(html).toContain('public-preview-frame')
    expect(html).toContain('Rondo under pressure')
  })
})

// =====================================================================
// The one-time secret
// =====================================================================
describe('PublicShareResultView', () => {
  const html = renderToStaticMarkup(
    <PublicShareResultView
      url="https://otj.example/share/abc#SECRET"
      expiresAt={null}
      copyState={noFeedback}
      onCopy={noop}
      onShare={noop}
      canNativeShare={false}
    />,
  )

  it('shows the link once, read only, with a 44px copy target and the shown-once note', () => {
    expect(html).toContain('https://otj.example/share/abc#SECRET')
    expect(html).toContain('Copy link')
    expect(html).toContain('min-height:44px')
    expect(html).toContain(SECRET_ONCE_NOTE)
    expect(html.toLowerCase()).toContain('readonly')
  })

  it('keeps a live region for the copy announcement', () => {
    expect(html).toContain('role="status"')
  })

  it('labels its own input rather than relying on placement', () => {
    expect(html).toContain('for="public-share-url"')
    expect(html).toContain('id="public-share-url"')
  })
})
