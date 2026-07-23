import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublicSessionView } from './PublicSessionView'
import { type PublicSessionSnapshot, PUBLIC_SNAPSHOT_VERSION } from '../lib/publicShare'

function sessionSnapshot(over: Partial<PublicSessionSnapshot> = {}): PublicSessionSnapshot {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'session',
    displayTitle: 'Tuesday session',
    focus: 'Playing out from the back',
    ageGroup: 'U10s',
    totalDuration: 45,
    intentions: ['Keep the ball under pressure'],
    space: 'Half pitch',
    activities: [
      { phase: 'Warm-Up', duration: 15, drillRef: 'd1', customTitle: null },
      { phase: 'Skill', duration: 10, drillRef: null, customTitle: 'Free play' },
    ],
    referencedDrills: [
      {
        ref: 'd1',
        title: 'Passing rondo',
        summary: 'A possession square.',
        classification: { type: 'corner', value: 'technical' },
        skill: 'Passing',
        ages: ['U10'],
        level: 'Developing',
        duration: 15,
        playerGuidance: null,
        area: null,
        equipment: [],
        setupNotes: null,
        coachingPoints: ['Open the body.'],
        easier: [],
        harder: [],
        theme: null,
        format: null,
        sourceAttribution: null,
        mediaRefs: ['m1'],
      },
    ],
    board: {
      formation: '2-3-1',
      tokens: [
        { number: 1, side: 'home', x: 0.5, y: 0.95 },
        { number: 7, side: 'home', x: 0.3, y: 0.6 },
        { number: 9, side: 'away', x: 0.7, y: 0.4 },
      ],
    },
    media: [{
      ref: 'm1',
      type: 'image',
      caption: 'Rondo diagram',
      sourceAttribution: null,
      link: null,
      url: 'https://x.supabase.co/signed/rondo.png',
    }],
    sourceAttribution: null,
    snapshotAt: '2026-07-21T10:00:00.000Z',
    ...over,
  }
}

function render(snap: PublicSessionSnapshot): string {
  return renderToStaticMarkup(<PublicSessionView snapshot={snap} mode="public" />)
}

describe('PublicSessionView', () => {
  it('renders the session header, meta and intentions', () => {
    const html = render(sessionSnapshot())
    expect(html).toContain('Tuesday session')
    expect(html).toContain('U10s')
    expect(html).toContain('45 min')
    expect(html).toContain('Playing out from the back')
    expect(html).toContain('Keep the ball under pressure')
    expect(html).toContain('Half pitch')
  })

  it('renders the ordered activities, the referenced drill and a custom activity', () => {
    const html = render(sessionSnapshot())
    // The referenced drill renders through PublicDrillView with its content.
    expect(html).toContain('Passing rondo')
    expect(html).toContain('Open the body.')
    // Its media resolves from the pool to a signed image url.
    expect(html).toContain('https://x.supabase.co/signed/rondo.png')
    // The custom activity renders its title, not a drill.
    expect(html).toContain('Free play')
    // Phase and duration pills.
    expect(html).toContain('Warm-Up')
    expect(html).toContain('15 min')
  })

  it('renders board discs showing token numbers only, with no name or playerId', () => {
    const html = render(sessionSnapshot())
    expect(html).toContain('board-disc')
    // The token numbers appear.
    expect(html).toContain('>1<')
    expect(html).toContain('>9<')
    // No name resolution path exists on the public board.
    for (const forbidden of ['playerId', 'player_id', 'board-token-label']) {
      expect(html).not.toContain(forbidden)
    }
  })

  it('leaks no internal identifier or operational field into the markup', () => {
    const html = render(sessionSnapshot())
    for (const forbidden of ['club_id', 'created_by', 'coach_id', 'drill_id', 'session_id', 'storage_path', '_path', '_mid', 'venue', 'team_id', 'spond']) {
      expect(html).not.toContain(forbidden)
    }
  })

  it('renders a session with no board and only custom activities', () => {
    const html = render(sessionSnapshot({
      board: null,
      referencedDrills: [],
      activities: [{ phase: 'Game', duration: 20, drillRef: null, customTitle: 'Small sided game' }],
    }))
    expect(html).toContain('Small sided game')
    expect(html).not.toContain('board-disc')
  })
})
