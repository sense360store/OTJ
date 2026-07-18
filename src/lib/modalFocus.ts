// Focus helpers for the dialog baseline (src/components/ui.tsx Modal). The
// index arithmetic of the focus trap is kept pure so it is provable without a
// DOM; the DOM query is a thin wrapper. A dialog moves focus inside on open,
// traps Tab while open, and restores focus to the opener on close.

// The elements a Tab cycle should visit inside a dialog. [tabindex="-1"] (the
// dialog container itself) is excluded so the trap cycles the controls, not the
// shell.
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

// The Tab trap: given the active element's index among the dialog's focusables,
// return the index to move focus to, or null to let the browser move normally.
// Forward Tab from the last (or from outside the list, activeIndex -1, on a
// backward Tab) wraps to the first; Shift+Tab from the first wraps to the last.
// An empty dialog returns null (nothing to trap).
export function trapTabIndex(activeIndex: number, count: number, shiftKey: boolean): number | null {
  if (count === 0) return null
  if (shiftKey) {
    if (activeIndex <= 0) return count - 1
    return null
  }
  if (activeIndex >= count - 1) return 0
  return null
}
