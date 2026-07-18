import { describe, expect, it } from 'vitest'
import { trapTabIndex } from './modalFocus'

// The focus trap index arithmetic is pure, so the wraparound is provable without
// a DOM: forward Tab from the last focusable wraps to the first, Shift+Tab from
// the first wraps to the last, and a move in the middle is left to the browser.
describe('trapTabIndex', () => {
  it('wraps forward Tab from the last element to the first', () => {
    expect(trapTabIndex(2, 3, false)).toBe(0)
  })

  it('wraps Shift+Tab from the first element to the last', () => {
    expect(trapTabIndex(0, 3, true)).toBe(2)
  })

  it('leaves a middle move to the browser', () => {
    expect(trapTabIndex(1, 3, false)).toBeNull()
    expect(trapTabIndex(1, 3, true)).toBeNull()
  })

  it('wraps Shift+Tab in from outside the list (active index -1) to the last', () => {
    expect(trapTabIndex(-1, 3, true)).toBe(2)
  })

  it('does nothing for an empty dialog', () => {
    expect(trapTabIndex(-1, 0, false)).toBeNull()
    expect(trapTabIndex(0, 0, true)).toBeNull()
  })
})
