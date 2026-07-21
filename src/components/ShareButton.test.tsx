import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShareButton } from './ShareButton'
import { ShareControlView } from './ui'
import { SHARE_ACCOUNT_NOTE, SHARE_COPY_FAILED, type ShareFeedback } from '../lib/share'

// ShareControlView is the internal Share control pulled out as a presentational
// component, so the static renderer covers the label, the 44px touch target,
// the explanatory copy and the success and failure feedback without the share
// hook or a DOM. ShareButton is the container each detail route mounts; it only
// uses the share hook, so it static-renders too and proves the control is
// labelled and keyboard accessible on Session Day, Drill Detail and Programme
// Detail alike.

const noop = () => {}
const noFeedback: ShareFeedback = { role: null, message: '' }

function renderControl(over: Partial<Parameters<typeof ShareControlView>[0]> = {}): string {
  return renderToStaticMarkup(
    <ShareControlView label="Share" note={SHARE_ACCOUNT_NOTE} feedback={noFeedback} onShare={noop} {...over} />,
  )
}

describe('ShareControlView', () => {
  it('renders a keyboard-accessible Share button with a 44px touch target and the account note', () => {
    const html = renderControl()
    // A native button, so it is reachable and operable by keyboard, and its
    // visible text is its accessible name.
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('Share')
    // Minimum 44px touch target.
    expect(html).toContain('min-height:44px')
    // Plain-language copy that an OTJ account is required.
    expect(html).toContain(SHARE_ACCOUNT_NOTE)
    // Nothing to announce yet: no status and no alert region.
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
  })

  it('carries the Save and share label for the planner variant', () => {
    const html = renderControl({ label: 'Save and share' })
    expect(html).toContain('Save and share')
  })

  it('announces a copy success through role="status"', () => {
    const html = renderControl({ feedback: { role: 'status', message: 'Link copied' } })
    expect(html).toContain('role="status"')
    expect(html).toContain('Link copied')
    expect(html).not.toContain('role="alert"')
  })

  it('announces a native share success through role="status"', () => {
    const html = renderControl({ feedback: { role: 'status', message: 'Shared' } })
    expect(html).toContain('role="status"')
    expect(html).toContain('Shared')
  })

  it('announces a calm, retryable failure through role="alert"', () => {
    const html = renderControl({ feedback: { role: 'alert', message: SHARE_COPY_FAILED } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Try again')
    // A Retry affordance is offered, and no browser internals leak.
    expect(html).toContain('Retry')
    expect(html).not.toMatch(/DOMException|NotAllowed|clipboard/i)
  })

  it('freezes the button while a write it owns is in flight', () => {
    const html = renderControl({ busy: true })
    expect(/<button[^>]*disabled/.test(html)).toBe(true)
  })

  it('leaves the button live when idle', () => {
    const html = renderControl({ busy: false })
    expect(/<button[^>]*disabled/.test(html)).toBe(false)
  })
})

describe('ShareButton container', () => {
  it('mounts a labelled, keyboard-accessible Share control for a session', () => {
    const html = renderToStaticMarkup(<ShareButton kind="session" id="s1" title="Monday training" />)
    expect(html).toContain('<button')
    expect(html).toContain('Share')
    expect(html).toContain('min-height:44px')
    expect(html).toContain(SHARE_ACCOUNT_NOTE)
  })

  it('mounts the same control for a drill', () => {
    const html = renderToStaticMarkup(<ShareButton kind="drill" id="d1" title="Rondo 4v1" />)
    expect(html).toContain('Share')
    expect(html).toContain(SHARE_ACCOUNT_NOTE)
  })

  it('mounts the same control for a programme', () => {
    const html = renderToStaticMarkup(<ShareButton kind="programme" id="p1" title="Autumn block" />)
    expect(html).toContain('Share')
    expect(html).toContain(SHARE_ACCOUNT_NOTE)
  })
})
