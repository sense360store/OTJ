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

describe('Modal dialog and focus semantics', () => {
  it('renders the dialog role, aria wiring and an accessible close label', () => {
    const html = renderToStaticMarkup(
      <Modal title="Edit player" sub="Jack Reed" onClose={noop}>
        body
      </Modal>,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    // The title and body are wired to the dialog through aria-labelledby and
    // aria-describedby, so a screen reader announces both on open.
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    // The X carries an accessible label rather than an unlabelled icon.
    expect(html).toContain('aria-label="Close"')
    // The dialog container is focusable so focus can move inside on open.
    expect(html).toContain('tabindex="-1"')
  })
})

describe('Chip', () => {
  it('disables when asked and stays live otherwise', () => {
    expect(renderToStaticMarkup(<Chip disabled>Skill</Chip>)).toContain('disabled')
    expect(renderToStaticMarkup(<Chip>Skill</Chip>)).not.toContain('disabled')
  })

  it('exposes the pressed state on a toggle chip, and none on a plain chip', () => {
    expect(renderToStaticMarkup(<Chip on>Registered</Chip>)).toContain('aria-pressed="true"')
    expect(renderToStaticMarkup(<Chip on={false}>Registered</Chip>)).toContain('aria-pressed="false"')
    expect(renderToStaticMarkup(<Chip>Registered</Chip>)).not.toContain('aria-pressed')
  })
})
