import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { DuplicateCard, ResultCard } from './ImportFAModal'
import type { ImportFADuplicate, ImportFAResult } from '../lib/queries'

// DuplicateCard is presentational, so the static renderer covers it without
// a DOM, the same logic-level style as the rest of the suite. The 409
// handling that produces its input is pinned in queries.test.ts. The dialog
// offers only keep or view: there is no re-import path, which faImportBody
// pins by never carrying a reimport flag.

const duplicate: ImportFADuplicate = {
  alreadyImported: true,
  templateId: 'template-1',
  templateName: 'Goalkeeping session: the basics',
}

const noop = () => {}

function render(result: ImportFADuplicate): string {
  return renderToStaticMarkup(<DuplicateCard result={result} onKeep={noop} onView={noop} />)
}

// ResultCard reads useNav for its View template button, so it renders inside
// a memory router; it stays presentational otherwise.
const imported: ImportFAResult = {
  templateId: 'template-1',
  templateName: 'Marking and intercepting session: defend as friends',
  drills: 4,
  media: 5,
  tags: ['Defending', 'Marking', 'Intercepting'],
  warnings: [],
}

function renderResult(result: ImportFAResult): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ResultCard result={result} onClose={noop} />
    </MemoryRouter>,
  )
}

describe('ResultCard', () => {
  it('reports the captured topic tags alongside the created counts', () => {
    const html = renderResult(imported)
    expect(html).toContain('Created 4 drills and stored 5 files')
    expect(html).toContain('Tagged Defending, Marking, Intercepting')
  })

  it('shows no tag line when the page carried no topics', () => {
    expect(renderResult({ ...imported, tags: [] })).not.toContain('Tagged')
  })
})

describe('DuplicateCard', () => {
  it('says the session is already in the library and names the existing template', () => {
    const html = render(duplicate)
    expect(html).toContain('Already in the library')
    expect(html).toContain('This page was imported before as')
    expect(html).toContain('Goalkeeping session: the basics')
  })

  it('offers only keep as the safe default and view the existing template, with no re-import', () => {
    const html = render(duplicate)
    expect(html).toContain('View template')
    expect(html).toContain('Keep the existing one')
    expect(html).not.toContain('Import again anyway')
    expect(html).not.toContain('second copy')
  })

  it('falls back to a plain message when the conflict names no template', () => {
    const html = render({ ...duplicate, templateName: '' })
    expect(html).toContain('This session has already been imported.')
  })
})
