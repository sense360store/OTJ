import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TopSearch } from './TopBar'

// TopSearch is the global search pulled out as a presentational component over
// canSearch, so the static renderer covers it without the live capability
// read. The search jumps into the drill library, which parents do not have, so
// they get no search. The router wrapper satisfies useNavigate.

function render(canSearch: boolean): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TopSearch canSearch={canSearch} />
    </MemoryRouter>,
  )
}

describe('TopSearch', () => {
  it('hides the global search for a parent', () => {
    expect(render(false)).toBe('')
  })

  it('shows the global search for a coach', () => {
    expect(render(true)).toContain('Search drills')
  })
})
