import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveSetupPeekView } from './LiveSession'

// The live view's setup photo strip, presentational: the container resolves
// the storage path and signed URL, so here src is a plain prop. Driver and
// watcher render the same strip; without a resolved URL it renders nothing,
// so a session with no photo costs no space on the stage.

const noop = () => {}

describe('LiveSetupPeekView', () => {
  it('renders nothing without a resolved photo', () => {
    expect(renderToStaticMarkup(<LiveSetupPeekView src={null} onOpen={noop} />)).toBe('')
  })

  it('renders the tappable strip with the photo thumbnail', () => {
    const html = renderToStaticMarkup(
      <LiveSetupPeekView src="https://signed.example/setup.jpg" onOpen={noop} />,
    )
    expect(html).toContain('Setup photo')
    expect(html).toContain('tap to view')
    expect(html).toContain('https://signed.example/setup.jpg')
    expect(html).toContain('<button')
  })
})
