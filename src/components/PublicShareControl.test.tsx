import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublicSharePreviewBody, PublicShareResultView } from './PublicShareControl'
import {
  type PublicDrillSnapshot,
  type PublicSessionSnapshot,
  PUBLIC_SNAPSHOT_VERSION,
  RIGHTS_WARNING,
  SECRET_ONCE_NOTE,
} from '../lib/publicShare'

const noFeedback: { role: 'status' | 'alert' | null; message: string } = { role: null, message: '' }

function snapshot(): PublicDrillSnapshot {
  return {
    snapshotVersion: 1,
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
    snapshotAt: '2026-07-21T10:00:00.000Z',
  }
}

describe('PublicShareResultView (the one-time link reveal)', () => {
  it('shows the link once, with copy, a 44px touch target and the shown-once note', () => {
    const html = renderToStaticMarkup(
      <PublicShareResultView
        url="https://otj.example/share/abc#SECRET"
        expiresAt={null}
        copyState={noFeedback}
        onCopy={() => {}}
        onShare={() => {}}
        canNativeShare={false}
      />,
    )
    expect(html).toContain('https://otj.example/share/abc#SECRET')
    expect(html).toContain('Copy link')
    expect(html).toContain('min-height:44px')
    expect(html).toContain(SECRET_ONCE_NOTE)
    // The input is read-only so the secret cannot be edited away accidentally.
    expect(html.toLowerCase()).toContain('readonly')
    // A persistent role="status" region for the copy announcement.
    expect(html).toContain('role="status"')
  })

  it('shows a native share button only when the platform supports it', () => {
    const without = renderToStaticMarkup(
      <PublicShareResultView url="u" expiresAt={null} copyState={noFeedback} onCopy={() => {}} onShare={() => {}} canNativeShare={false} />,
    )
    expect(without).not.toContain('>Share<')
    const withShare = renderToStaticMarkup(
      <PublicShareResultView url="u" expiresAt={null} copyState={noFeedback} onCopy={() => {}} onShare={() => {}} canNativeShare />,
    )
    expect(withShare).toContain('>Share<')
  })

  it('announces a copied result through role="status"', () => {
    const html = renderToStaticMarkup(
      <PublicShareResultView url="u" expiresAt={null} copyState={{ role: 'status', message: 'Link copied' }} onCopy={() => {}} onShare={() => {}} canNativeShare={false} />,
    )
    expect(html).toContain('Link copied')
  })
})

describe('PublicSharePreviewBody', () => {
  it('shows the rights warning and the free-text marker before publishing', () => {
    const html = renderToStaticMarkup(
      <PublicSharePreviewBody eligible blocked={[]} snapshot={snapshot()} />,
    )
    expect(html).toContain('You wrote this, it will be public.')
    expect(html).toContain(RIGHTS_WARNING)
    expect(html).toContain('Rondo under pressure')
  })

  it('shows a blocked message and offers the club link when ineligible', () => {
    const html = renderToStaticMarkup(
      <PublicSharePreviewBody eligible={false} blocked={['media_internal_only']} snapshot={null} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('England Football')
    expect(html).toContain('internal club link')
  })

  it('renders a session preview and marks its free text as public', () => {
    const sessionSnapshot: PublicSessionSnapshot = {
      snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
      kind: 'session',
      displayTitle: 'Tuesday session',
      focus: null,
      ageGroup: 'U10s',
      totalDuration: 30,
      intentions: [],
      space: null,
      activities: [{ phase: 'Warm-Up', duration: 30, drillRef: null, customTitle: 'Arrival game' }],
      referencedDrills: [],
      board: null,
      media: [],
      sourceAttribution: null,
      snapshotAt: '2026-07-21T10:00:00.000Z',
    }
    const html = renderToStaticMarkup(
      <PublicSharePreviewBody kind="session" eligible blocked={[]} snapshot={sessionSnapshot} />,
    )
    expect(html).toContain('You wrote this, it will be public.')
    expect(html).toContain('Tuesday session')
    expect(html).toContain('Arrival game')
  })

  it('shows a session-specific blocked message for a restricted drill dependency', () => {
    const html = renderToStaticMarkup(
      <PublicSharePreviewBody kind="session" eligible={false} blocked={['drill_internal_only']} snapshot={null} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('England Football')
    expect(html).toContain('internal club link')
  })
})
