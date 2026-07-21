import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PublicShare from './PublicShare'
import { UNAVAILABLE_BODY, UNAVAILABLE_HEADING } from '../lib/publicShare'

function renderAt(path: string): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/share/:shareId" element={<PublicShare />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PublicShare route', () => {
  it('renders the neutral unavailable state for a malformed link', () => {
    const html = renderAt('/share/not-a-uuid')
    expect(html).toContain(UNAVAILABLE_HEADING)
    expect(html).toContain(UNAVAILABLE_BODY)
  })

  it('mounts no app shell, sidebar or private navigation', () => {
    const html = renderAt('/share/not-a-uuid')
    // No authenticated chrome classes.
    for (const marker of ['sidebar', 'app-shell', 'bottom-nav', 'topbar', 'nav-item']) {
      expect(html.toLowerCase()).not.toContain(marker)
    }
  })

  it('renders no internal identifiers in the unavailable markup', () => {
    const html = renderAt('/share/not-a-uuid')
    for (const forbidden of ['club_id', 'created_by', 'drill_id', 'token_hash', 'storage_path']) {
      expect(html).not.toContain(forbidden)
    }
  })
})
