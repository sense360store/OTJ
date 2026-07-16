import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Chip, Modal, modalDismissControls } from './ui'

const noop = () => {}

// The dismissal contract is kept pure (modalDismissControls) so the three
// routes the Modal wires to it (Escape, the overlay and the X) are provable
// without a DOM. The footer Cancel is the consumer's own button, disabled
// alongside these while a write is in flight.
describe('modalDismissControls', () => {
  it('allows every dismissal route while dismissible', () => {
    const onClose = vi.fn()
    const c = modalDismissControls(true, onClose)
    expect(c.closeDisabled).toBe(false)
    expect(c.onOverlayClick).toBe(onClose)
    c.onEscapeKey('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('freezes Escape, overlay and the X while not dismissible', () => {
    const onClose = vi.fn()
    const c = modalDismissControls(false, onClose)
    // Escape does nothing, the overlay has no close handler, the X is disabled.
    c.onEscapeKey('Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(c.onOverlayClick).toBeUndefined()
    expect(c.closeDisabled).toBe(true)
  })

  it('ignores non-Escape keys even while dismissible', () => {
    const onClose = vi.fn()
    modalDismissControls(true, onClose).onEscapeKey('Enter')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal close button', () => {
  const xButton = (html: string) => html.match(/<button class="icon-btn"[^>]*>/)?.[0] ?? ''

  it('disables the X while a write is in flight (not dismissible)', () => {
    const html = renderToStaticMarkup(
      <Modal title="Add to session" onClose={noop} dismissible={false}>
        body
      </Modal>,
    )
    expect(xButton(html)).toContain('disabled')
  })

  it('leaves the X live by default', () => {
    const html = renderToStaticMarkup(
      <Modal title="Add to session" onClose={noop}>
        body
      </Modal>,
    )
    expect(xButton(html)).not.toContain('disabled')
  })
})

describe('Chip', () => {
  it('disables when asked and stays live otherwise', () => {
    expect(renderToStaticMarkup(<Chip disabled>Skill</Chip>)).toContain('disabled')
    expect(renderToStaticMarkup(<Chip>Skill</Chip>)).not.toContain('disabled')
  })
})
