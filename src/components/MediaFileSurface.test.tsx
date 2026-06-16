import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MediaFileSurface } from './MediaPlayerModal'
import type { MediaItem } from '../lib/data'

// MediaFileSurface is the image and PDF viewer surface pulled out so the static
// suite can pin how each renders from the signed URL the caller mints, no hook
// running. The pins that matter: a PDF embeds in an <iframe> on the signed URL
// rather than only the striped placeholder (the bug), and an image still
// renders in an <img> on the same URL as before.

const signed = 'https://store.supabase.co/storage/v1/object/sign/media/club/doc.pdf?token=abc'

const pdf: MediaItem = { id: 'm-pdf', name: 'Session card', type: 'pdf', storagePath: 'club/doc.pdf' }
const image: MediaItem = { id: 'm-img', name: 'Pitch diagram', type: 'image', storagePath: 'club/diagram.png' }

const noop = () => {}

function render(item: MediaItem, src: string | null, isLoading = false): string {
  return renderToStaticMarkup(
    <MediaFileSurface item={item} src={src} isLoading={isLoading} onError={noop} onLoad={noop} />,
  )
}

describe('MediaFileSurface', () => {
  it('embeds a PDF in an iframe on the signed URL, not the placeholder', () => {
    const html = render(pdf, signed)
    expect(html).toContain('<iframe')
    expect(html).toContain(`src="${signed}"`)
    expect(html).toContain('title="Session card"')
    // Not the striped placeholder the viewer showed before the fix.
    expect(html).not.toContain('thumb')
  })

  it('renders an image in an img on the signed URL, as before', () => {
    const html = render(image, signed)
    expect(html).toContain('<img')
    expect(html).toContain(`src="${signed}"`)
    expect(html).not.toContain('<iframe')
  })

  it('holds on the loading thumb until the signed URL arrives', () => {
    const html = render(pdf, null, true)
    expect(html).toContain('loading…')
    expect(html).not.toContain('<iframe')
  })
})
