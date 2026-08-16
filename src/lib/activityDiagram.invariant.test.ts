// =====================================================================
// One resolver for a session activity's diagram, pinned at the call sites.
//
// DRILL-02 put the same question on three screens: given an activity,
// which diagram belongs on it. The rule has two halves that are cheap to
// lose and expensive to lose quietly, because losing either shows
// something rather than hiding something:
//
//   an EMPTY diagram is no diagram, and
//   an ENGLAND FOOTBALL DERIVED drill shows no hand drawn diagram at all.
//
// The second is the club's licence rather than a permission it grants
// (CLAUDE.md, Third-party content: FA images are "used unmodified, never
// recreated or redrawn"). A surface that resolved its own diagram would
// breach it silently, on a screen nobody was looking at, and the drill
// page would go on suppressing the same row correctly.
//
// Source text, so the usual honesty about what that buys: a rename or an
// extra indirection defeats these, and they say nothing about a fourth
// surface appearing tomorrow. What they catch is the realistic edit,
// a screen reaching past the shared rule to the map underneath.
// The behavioural half is ../routes/activityDiagram.screens.test.tsx,
// which renders the real screens over an England Football derived drill
// that is holding a diagram and fails if a pitch reaches the markup.
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(import.meta.dirname, p), 'utf8')
const strip = (raw: string) =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('{/*') && !l.trim().startsWith('*'))
    .join('\n')

// The three surfaces a session's activities are shown on.
const SURFACES = ['../routes/Planner.tsx', '../routes/SessionDay.tsx', '../routes/LiveSession.tsx'] as const

describe('every session surface resolves its diagram through the one rule', () => {
  for (const path of SURFACES) {
    const name = path.split('/').pop()

    it(`${name} calls activityDiagram`, () => {
      const src = strip(read(path))
      expect(src).toMatch(/activityDiagram\(/)
    })

    it(`${name} reads the diagram map through the shared batch hook`, () => {
      // A surface that built its own map, or called the per drill read in a
      // loop, would be one request per activity and a second place for the
      // ids to be chosen.
      const src = strip(read(path))
      expect(src).toMatch(/useDrillDiagramMap\(activityDrillIds\(/)
    })

    it(`${name} does not restate either half of the rule`, () => {
      const src = strip(read(path))
      // The empty rule and the licence rule both live in activityDiagram.
      // A surface naming them is a surface that has started deciding.
      expect(src).not.toMatch(/diagramIsEmpty/)
      expect(src).not.toMatch(/deriveProvenance/)
    })

    it(`${name} renders the diagram through the shared frame, not the raw view`, () => {
      // DrillDiagramView is the one that draws and ActivityDiagram is the
      // one frame around it. A surface importing the view directly would be
      // free to size and label it its own way.
      const src = strip(read(path))
      expect(src).toMatch(/import \{ ActivityDiagram \}/)
      expect(src).not.toMatch(/import \{ DrillDiagramView \}/)
    })
  }
})

describe('the rule itself still says both halves', () => {
  const lib = read('./activityDiagram.ts')

  it('refuses an empty diagram', () => {
    expect(lib).toMatch(/diagramIsEmpty\(diagram\)/)
  })

  it('refuses an England Football derived drill, before it reads the diagram', () => {
    expect(lib).toMatch(/deriveProvenance\(drillSource\(drill\)\) !== 'fa'/)
    expect(lib).toMatch(/if \(!drillMayShowDiagram\(drill\)\) return null/)
  })

  it('takes no viewer, so the licence rule cannot be given an exception', () => {
    // A role, a capability or a "canManage" parameter here would be the
    // first step to an admin seeing what the licence forbids.
    expect(lib).not.toMatch(/canManage|caps|role|capabilit/i)
  })
})

describe('the public share boundary is untouched by any of this', () => {
  // DRILL-02 is an authenticated feature. What keeps a diagram off a public
  // page is the projection refusing the key on both sides of the wire, and
  // nothing here may soften that. Publishing one is a separate reviewed
  // change: the server list, the snapshot schema and its version, and a
  // security review.
  it('the browser half still forbids the diagram key', () => {
    expect(read('./publicShare.ts')).toMatch(/'diagram',/)
  })

  it('no public view resolves an activity diagram', () => {
    for (const p of [
      '../components/PublicSessionView.tsx',
      '../components/PublicProgrammeView.tsx',
      '../components/PublicDrillView.tsx',
      '../routes/PublicShare.tsx',
    ]) {
      const src = strip(read(p))
      expect(src, p).not.toMatch(/activityDiagram|ActivityDiagram|useDrillDiagram/)
    }
  })

  it('the drill list read still does not carry the diagram', () => {
    // DRILL_COLS gaining `diagram` would put it on every drill read at once,
    // including the ones the share snapshot builders use. The batch read
    // selects DRILL_DIAGRAM_COLS instead, which is the two column read.
    const q = read('./queries.ts')
    const cols = q.match(/const DRILL_COLS =[\s\S]*?\n/)?.[0] ?? ''
    expect(cols).not.toMatch(/diagram/)
    expect(q).toMatch(/select\(DRILL_DIAGRAM_COLS\)\.in\('id', ids\)/)
  })
})

describe('names what it cannot catch', () => {
  it('is a tripwire, not a proof', () => {
    // It cannot see a rule reached through a variable, a fourth surface
    // nobody added here, or a screen that calls activityDiagram and then
    // ignores the answer. Rendering is what proves those, and that is
    // ../routes/activityDiagram.screens.test.tsx.
    expect(true).toBe(true)
  })
})
