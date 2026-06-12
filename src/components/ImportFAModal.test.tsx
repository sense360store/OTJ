import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DuplicateCard } from './ImportFAModal'
import type { ImportFADuplicate } from '../lib/queries'

// DuplicateCard is presentational, so the static renderer covers it without
// a DOM, the same logic-level style as the rest of the suite. The 409
// handling that produces its input is pinned in queries.test.ts; the
// re-import button is wired in ImportFAModal to mutate with reimport: true,
// whose body shape faImportBody pins.

const duplicate: ImportFADuplicate = {
  alreadyImported: true,
  templateId: 'template-1',
  templateName: 'Goalkeeping session: the basics',
}

const noop = () => {}

function render(result: ImportFADuplicate): string {
  return renderToStaticMarkup(<DuplicateCard result={result} onKeep={noop} onView={noop} onReimport={noop} />)
}

describe('DuplicateCard', () => {
  it('says the session is already in the library and names the existing template', () => {
    const html = render(duplicate)
    expect(html).toContain('Already in the library')
    expect(html).toContain('This page was imported before as')
    expect(html).toContain('Goalkeeping session: the basics')
  })

  it('offers the existing template, keep as the safe default, and the explicit second copy', () => {
    const html = render(duplicate)
    expect(html).toContain('View template')
    expect(html).toContain('Keep the existing one')
    expect(html).toContain('Import again anyway')
    expect(html).toContain('second copy')
  })

  it('falls back to a plain message when the conflict names no template', () => {
    const html = render({ ...duplicate, templateName: '' })
    expect(html).toContain('This session has already been imported.')
  })
})
