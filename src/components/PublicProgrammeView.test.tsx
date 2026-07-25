import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublicProgrammeView } from './PublicProgrammeView'
import {
  type PublicProgrammeSnapshot,
  type PublicReferencedDrill,
  PUBLIC_SNAPSHOT_VERSION,
} from '../lib/publicShare'

function refDrill(over: Partial<PublicReferencedDrill> = {}): PublicReferencedDrill {
  return {
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
    mediaRefs: [],
    ...over,
  }
}

function programmeSnapshot(over: Partial<PublicProgrammeSnapshot> = {}): PublicProgrammeSnapshot {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'programme',
    displayTitle: 'Playing out from the back',
    focus: 'Building from goal kicks',
    summary: 'A two week block on calm build up play.',
    intentions: ['Play forward when it is on'],
    weeks: 2,
    orderedWeekNumbers: [1, 2],
    weekTemplates: [
      {
        week: 1,
        title: 'Week one, short goal kicks',
        focus: 'Receiving on the half turn',
        activities: [
          { phase: 'Warm-Up', duration: 15, drillRef: 'd1', customTitle: null },
          { phase: 'Game', duration: 20, drillRef: null, customTitle: 'Free play' },
        ],
        totalDuration: 35,
      },
      { week: 2, title: null, focus: null, activities: [], totalDuration: 0 },
    ],
    referencedDrills: [refDrill({ mediaRefs: ['m1'] })],
    pdf: null,
    media: [
      {
        ref: 'm1',
        type: 'image',
        caption: 'Square setup',
        sourceAttribution: null,
        link: null,
        url: 'https://example.test/signed/setup.png',
      },
    ],
    sourceAttribution: null,
    snapshotAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('PublicProgrammeView', () => {
  it('renders the programme overview, its weeks and their activities in order', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).toContain('Playing out from the back')
    expect(html).toContain('A two week block on calm build up play.')
    expect(html).toContain('Play forward when it is on')
    expect(html).toContain('Week 1')
    expect(html).toContain('Week one, short goal kicks')
    expect(html).toContain('Week 2')
    // Week 1 must render before week 2.
    expect(html.indexOf('Week 1')).toBeLessThan(html.indexOf('Week 2'))
  })

  it('renders a referenced drill through the drill renderer, resolving its pooled media', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).toContain('Passing rondo')
    expect(html).toContain('Open the body.')
    expect(html).toContain('https://example.test/signed/setup.png')
  })

  it('renders a custom activity title with no drill', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).toContain('Free play')
  })

  it('renders a week no template claims as an empty week', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).toContain('No plan for this week yet.')
  })

  it('renders an eligible attached PDF as a link resolved from the flat media pool', () => {
    const snapshot = programmeSnapshot({
      pdf: { ref: 'm2' },
      media: [
        ...programmeSnapshot().media,
        {
          ref: 'm2',
          type: 'pdf',
          caption: 'Programme booklet',
          sourceAttribution: null,
          link: null,
          url: 'https://example.test/signed/booklet.pdf',
        },
      ],
    })
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={snapshot} mode="public" />)
    expect(html).toContain('Programme document')
    expect(html).toContain('https://example.test/signed/booklet.pdf')
    expect(html).toContain('Programme booklet')
  })

  it('renders no PDF section when the programme has none', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).not.toContain('Programme document')
  })

  it('renders the source attribution when present', () => {
    const html = renderToStaticMarkup(
      <PublicProgrammeView
        snapshot={programmeSnapshot({
          sourceAttribution: { url: 'https://learn.englandfootball.com/x', label: 'England Football Learning' },
        })}
        mode="public"
      />,
    )
    expect(html).toContain('England Football Learning')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('uses an h1 on the public page and an h2 in the owner preview', () => {
    const pub = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    const prev = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="preview" />)
    expect(pub).toContain('<h1 class="public-title">')
    expect(prev).toContain('<h2 class="public-title">')
  })

  it('never renders an operational or private field, at any nesting depth', () => {
    // A snapshot deliberately dirtied with fields the projection must never
    // carry. The renderer reads only allow listed fields, so none may appear.
    const dirty = {
      ...programmeSnapshot(),
      author: 'Jane Coach',
      club_id: 'club-uuid',
      created_by: 'user-uuid',
      programme_id: 'programme-uuid',
      programme_week: 3,
      team_id: 'team-uuid',
      venue: 'Ossett Rec',
      date: '2026-03-01',
      spond_event_id: 'spond-uuid',
    } as unknown as PublicProgrammeSnapshot
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={dirty} mode="public" />)
    for (
      const banned of [
        'Jane Coach', 'club-uuid', 'user-uuid', 'programme-uuid', 'team-uuid',
        'Ossett Rec', 'spond-uuid', '2026-03-01', 'author', 'created_by', 'storage_path', '_path', '_mid',
      ]
    ) {
      expect(html).not.toContain(banned)
    }
  })

  it('renders a programme with no media without attempting to resolve one', () => {
    const html = renderToStaticMarkup(
      <PublicProgrammeView
        snapshot={programmeSnapshot({ media: [], referencedDrills: [refDrill({ mediaRefs: [] })] })}
        mode="public"
      />,
    )
    expect(html).toContain('Passing rondo')
    expect(html).not.toContain('undefined')
  })

  it('carries the print-relevant layout classes so the print stylesheet can break pages', () => {
    const html = renderToStaticMarkup(<PublicProgrammeView snapshot={programmeSnapshot()} mode="public" />)
    expect(html).toContain('class="public-weeks"')
    expect(html).toContain('class="public-week"')
    expect(html).toContain('class="public-activity"')
  })
})
