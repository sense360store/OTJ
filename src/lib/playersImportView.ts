// Pure presentation helpers for the import preview: the class pill vocabulary,
// the filter chip set and counts, and the summary and live-region copy. Kept out
// of the modal component so every string is provable without a DOM (the same
// discipline as playersView.ts) and so the modal file can export only components
// (React fast refresh). No child name is assembled here; these describe counts.
import type { PlanSummary, PreviewFilter, RowClass } from './playersImportPlan'

// The coloured pill and word for each class, plus a colour token. The word is
// always shown, so a class is never conveyed by colour alone (ux section 12).
//
// The pill's label is --on-accent on this fill, so each value is held to the
// 4.5:1 text floor in both themes. already_present was --slate-2, which
// measures 3.80:1 under white in the light theme; VISUAL-01 demoted that token
// to control borders and disabled glyphs for exactly this reason, and --slate
// is the neutral that carries text (5.34:1 light, 7.75:1 dark).
export const PREVIEW_PILL: Record<RowClass, { word: string; color: string }> = {
  new: { word: 'Will add', color: 'var(--success)' },
  update: { word: 'Will update', color: 'var(--royal)' },
  already_present: { word: 'Already present', color: 'var(--slate)' },
  needs_choice: { word: 'Needs your choice', color: 'var(--warning)' },
  invalid: { word: 'Invalid', color: 'var(--danger)' },
}
export const WARNING_COLOR = 'var(--warning)'

// The preview filter chips, in the fixed order from ux section 8.
export const FILTER_CHIPS: { key: PreviewFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'update', label: 'Updates' },
  { key: 'already_present', label: 'Already present' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'needs_choice', label: 'Needs your choice' },
  { key: 'invalid', label: 'Invalid' },
]

export function chipCount(summary: PlanSummary, key: PreviewFilter): number {
  switch (key) {
    case 'all':
      return summary.total
    case 'new':
      return summary.newCount
    case 'update':
      return summary.updateCount
    case 'already_present':
      return summary.alreadyPresent
    case 'warnings':
      return summary.warnings
    case 'needs_choice':
      return summary.needsChoice
    case 'invalid':
      return summary.invalid
  }
}

// Only non-zero primary categories are named; warnings and blank rows are shown
// on separate lines, never folded into this sentence.
export function summarySentence(s: PlanSummary): string {
  const parts: string[] = []
  if (s.newCount) parts.push(`${s.newCount} new`)
  if (s.updateCount) parts.push(`${s.updateCount} ${s.updateCount === 1 ? 'update' : 'updates'}`)
  if (s.alreadyPresent) parts.push(`${s.alreadyPresent} already present`)
  if (s.needsChoice) parts.push(`${s.needsChoice} needs your choice`)
  if (s.invalid) parts.push(`${s.invalid} invalid`)
  const head = `${s.total} ${s.total === 1 ? 'row' : 'rows'}`
  return parts.length ? `${head}: ${parts.join(', ')}.` : `${head}.`
}

// The live-region announcement built when parsing completes (ux section 12).
export function announceSummary(s: PlanSummary): string {
  let msg = `Preview ready. ${summarySentence(s)}`
  if (s.warnings) msg += ` ${s.warnings} carry warnings.`
  return msg
}
