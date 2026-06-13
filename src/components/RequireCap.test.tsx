import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CapGate } from './RequireCap'

// CapGate is the capability route guard pulled out as a presentational gate, so
// the static renderer covers the redirect decision without the live capability
// read, the same style as HomeSwitch. The tree mirrors App.tsx: the browse
// routes sit behind the gate (cap sessions.create, redirect to Home) and the
// detail routes sit outside it, open to every role. A redirect renders null
// under the static renderer, so a blocked screen simply never appears.

function renderAt(path: string, caps: Set<string>): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CapGate caps={caps} cap="sessions.create" redirect="/" />}>
          <Route path="library" element={<span>DRILL_LIBRARY</span>} />
        </Route>
        <Route path="drill/:id" element={<span>DRILL_DETAIL</span>} />
        <Route path="/" element={<span>HOME</span>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Browse route capability gate', () => {
  it('redirects a parent away from the drill library', () => {
    // No sessions.create, so the gate renders a redirect to Home and the
    // library never mounts.
    expect(renderAt('/library', new Set())).not.toContain('DRILL_LIBRARY')
  })

  it('lets a coach into the drill library', () => {
    expect(renderAt('/library', new Set(['sessions.create']))).toContain('DRILL_LIBRARY')
  })

  it('leaves drill detail reachable for a parent', () => {
    // Detail routes carry no gate, so a parent reaches them read only: this is
    // the path by which a parent meets a drill.
    expect(renderAt('/drill/d1', new Set())).toContain('DRILL_DETAIL')
  })
})
