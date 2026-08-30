// =====================================================================
// The rule that separates a focus RESTORE from a focus STEAL.
//
// WHY THIS EXISTS. The hook it belongs to is an effect, and this project
// has no DOM, so the effect never runs under vitest and everything about
// it was asserted as source text: that the two guard strings are present,
// not that they gate the focus call. A rule nothing exercises is a rule
// that can be inverted by deleting a `!`.
//
// So the rule is a function and this drives it over every state a browser
// can actually leave behind. What is still not covered here, and is
// covered in a browser by tools/visual/auth.mjs and tools/visual/checks.mjs
// instead: that the effect consults it, that it runs on the settled render
// rather than in the callback, and that the request is one-shot.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { focusWasLost } from './useFocusRestore'

// Stand-ins for the three things document.activeElement can be. They are
// compared by identity, which is all the rule does, so a plain object is a
// faithful model and needs no DOM.
const body = {} as Element
const aButton = {} as Element
const aField = {} as Element

describe('focus was lost, rather than moved by the person using the page', () => {
  it('is lost when the browser dropped it to the body', () => {
    // What a browser leaves behind when the control that had focus is
    // disabled or removed, which is the case the repair exists for.
    expect(focusWasLost(body, body)).toBe(true)
  })

  it('is lost when there is nothing focused at all', () => {
    // Some browsers report null rather than the body during a teardown.
    expect(focusWasLost(null, body)).toBe(true)
  })

  it('is NOT lost when focus is on another control', () => {
    // Somebody carried on using the page while the call was in flight. This
    // is the half that makes it a restore: without it the hook would take
    // focus back off them when the call settled.
    expect(focusWasLost(aField, body)).toBe(false)
    expect(focusWasLost(aButton, body)).toBe(false)
  })

  it('is NOT lost when focus never left the control that was pressed', () => {
    // Pressing Enter in a field submits without moving focus, and no field
    // on either screen is disabled during a call, so this is the ordinary
    // keyboard path and nothing should move.
    expect(focusWasLost(aField, body)).toBe(false)
  })

  it('does not treat a missing body as a lost focus, unless focus is missing too', () => {
    // A defensive case rather than a reachable one, and it is here because
    // the obvious way to write the rule (active === body) would answer true
    // for a document with neither, which is the opposite of what it means.
    expect(focusWasLost(aButton, null)).toBe(false)
    expect(focusWasLost(null, null)).toBe(true)
  })
})
