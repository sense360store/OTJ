import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublicDrillView } from './PublicDrillView'
import type { PublicDrillSnapshot } from '../lib/publicShare'

function snapshot(over: Partial<PublicDrillSnapshot> = {}): PublicDrillSnapshot {
  return {
    snapshotVersion: 1,
    kind: 'drill',
    title: 'Rondo under pressure',
    summary: 'A possession square that rewards calm passing.',
    classification: { type: 'corner', value: 'technical' },
    skill: 'Passing under pressure',
    ages: ['U9', 'U10'],
    level: 'Developing',
    duration: 15,
    playerGuidance: '6 to 8 players',
    area: '12 by 12 metres',
    equipment: ['cones', 'one ball'],
    setupNotes: 'Four on the square, two inside.',
    coachingPoints: ['Open the body before receiving.'],
    easier: ['Add a defender.'],
    harder: ['Two touch maximum.'],
    theme: 'Playing out',
    format: 'Small sided',
    sourceAttribution: null,
    media: [],
    snapshotAt: '2026-07-21T10:00:00.000Z',
    ...over,
  }
}

describe('PublicDrillView', () => {
  it('renders the drill title, coaching points and details', () => {
    const html = renderToStaticMarkup(<PublicDrillView snapshot={snapshot()} mode="public" />)
    expect(html).toContain('Rondo under pressure')
    expect(html).toContain('Open the body before receiving.')
    expect(html).toContain('Coaching points')
    expect(html).toContain('12 by 12 metres')
    expect(html).toContain('Developing')
  })

  it('renders the title inside an h1 on the public page', () => {
    const html = renderToStaticMarkup(<PublicDrillView snapshot={snapshot()} mode="public" />)
    expect(html).toMatch(/<h1[^>]*class="public-title"[^>]*>Rondo under pressure<\/h1>/)
  })

  it('escapes free text and never renders raw markup', () => {
    const html = renderToStaticMarkup(
      <PublicDrillView snapshot={snapshot({ title: 'Rondo <script>x</script>' })} mode="public" />,
    )
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a signed image in public mode', () => {
    const html = renderToStaticMarkup(
      <PublicDrillView
        snapshot={snapshot({ media: [{ ref: 'm1', type: 'image', caption: 'Setup', sourceAttribution: null, link: null, url: 'https://ref.supabase.co/sign/x' }] })}
        mode="public"
      />,
    )
    expect(html).toContain('src="https://ref.supabase.co/sign/x"')
    expect(html).toContain('Setup')
  })

  it('describes media in preview mode without a signed url', () => {
    const html = renderToStaticMarkup(
      <PublicDrillView
        snapshot={snapshot({ media: [{ ref: 'm1', type: 'image', caption: 'Setup', sourceAttribution: null, link: null }] })}
        mode="preview"
      />,
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('temporary link')
  })

  it('contains no internal identifiers in the rendered markup', () => {
    const html = renderToStaticMarkup(
      <PublicDrillView
        snapshot={snapshot({ media: [{ ref: 'm1', type: 'image', caption: 'Setup', sourceAttribution: null, link: null, url: 'https://ref.supabase.co/sign/x' }] })}
        mode="public"
      />,
    )
    for (const forbidden of ['club_id', 'created_by', 'media_id', 'drill_id', 'storage_path', '_mid', '_path']) {
      expect(html).not.toContain(forbidden)
    }
  })

  it('renders a source attribution link with safe rel attributes', () => {
    const html = renderToStaticMarkup(
      <PublicDrillView snapshot={snapshot({ sourceAttribution: { url: 'https://learn.englandfootball.com/x', label: 'England Football Learning' } })} mode="public" />,
    )
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('England Football Learning')
  })
})
