/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkRegisteredField } from './PlayerFormModal'

// The interactive Edit and Add flows (the atomic RPCs, the guarded submit, the
// retry idempotency) are covered by the players security suite and the
// playersView unit tests. This file pins the layout regression fixed in the
// "Mark as registered" hotfix: the checkbox is a compact row, not a full-width
// text-input-sized block, and the shared .field input sizing never reaches a
// checkbox. See src/styles.css (.field input sizing, .check-row).

const styles = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8')

function markup(checked = false, disabled = false) {
  return renderToStaticMarkup(<MarkRegisteredField checked={checked} disabled={disabled} onChange={() => {}} />)
}

describe('MarkRegisteredField', () => {
  it('renders one clickable label wrapping the native checkbox, giving it an accessible name', () => {
    const html = markup()
    // The label wraps the input, so the whole row is clickable and the input's
    // accessible name is the adjacent text.
    expect(html).toContain('<label class="check-row">')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Mark as registered')
    // The input sits inside the label, before its text.
    expect(html).toMatch(/<label class="check-row">.*type="checkbox".*Mark as registered.*<\/label>/s)
  })

  it('uses the compact check-row class, not a text-input sizing class', () => {
    const html = markup()
    // The row carries the check-row class and none of the text-input width or
    // height is applied inline to the checkbox.
    expect(html).toContain('class="check-row"')
    expect(html).not.toMatch(/type="checkbox"[^>]*style=/)
    expect(html).not.toContain('class="row"')
  })

  it('reflects the checked and disabled state', () => {
    expect(markup(true, false)).toContain('checked')
    expect(markup(false, false)).not.toContain('checked')
    expect(markup(false, true)).toContain('disabled')
  })
})

describe('shared field styles keep checkboxes off the text-input sizing rule', () => {
  it('scopes the .field input width and height rule to exclude checkbox and radio', () => {
    // The root cause: the text-input sizing selector must skip checkbox and radio
    // so a checkbox in a .field is not stretched to a full-width 42px block.
    const sizing = styles.match(/\.field input[^{]*\{[^}]*width: 100%; height: 42px;/)
    expect(sizing).not.toBeNull()
    expect(sizing?.[0]).toContain(':not([type="checkbox"])')
    expect(sizing?.[0]).toContain(':not([type="radio"])')
  })

  it('sizes the check-row checkbox as a standard control, not full width', () => {
    const rule = styles.match(/\.check-row input\[type="checkbox"\] \{[^}]*\}/)
    expect(rule).not.toBeNull()
    expect(rule?.[0]).toContain('width: 16px')
    expect(rule?.[0]).toContain('height: 16px')
    expect(rule?.[0]).not.toContain('width: 100%')
  })

  it('keeps text inputs sized (no regression to other modals and fields)', () => {
    // The text-input rule still applies width:100%;height:42px to real inputs,
    // so Name, Shirt number and every other .field input are unchanged.
    expect(styles).toMatch(/\.field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[^{]*\{ width: 100%; height: 42px;/)
  })
})
