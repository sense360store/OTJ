import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_DIAGRAM_ELEMENT_KEYS } from './publicDiagram'
import {
  PUBLIC_SNAPSHOT_VERSION,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
  validatePublicSessionSnapshot,
} from './publicShare'
// The REAL Edge Function module, imported directly rather than mirrored. It has
// one relative import and no Deno globals at module level, so vitest loads it.
import {
  buildDrillSnapshot,
  buildProgrammeSnapshot,
  buildSessionSnapshot,
  isPublicDrillDiagram,
  projectDrillDiagram,
  SNAPSHOT_VERSION,
  toPublicProgrammeProjection,
  toPublicProjection,
  toPublicSessionProjection,
} from '../../supabase/functions/_shared/share.ts'

// The tripwire on the two halves of the public snapshot contract (DRILL-02b).
//
// The server module is the authority and the browser re-checks its output
// before rendering, which only means something while the two agree about the
// shape. The BEHAVIOURAL checks here build real snapshots with the server code
// and validate them with the client code, so a widening on one side that the
// other refuses fails the build. The SOURCE TEXT checks are marked and they
// catch the realistic mistake: a key added to one deny list and not the other,
// a column added to the client's drill read, a refresh handler that patches a
// stored snapshot rather than rebuilding it. They are defeated by anything
// indirect and are a tripwire, never a proof.

const ROOT = join(import.meta.dirname, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function quotedKeys(block: string): Set<string> {
  // Comment lines carry prose, and prose carries apostrophes.
  const code = block.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  return new Set([...code.matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

const AT = '2026-09-01T10:00:00.000Z'
const CLUB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const DRILL_A = 'd1111111-1111-1111-1111-111111111111'
const DRILL_B = 'd2222222-2222-2222-2222-222222222222'

const STORED_DIAGRAM = {
  version: 1,
  surface: { kind: 'half_pitch', orientation: 'landscape' },
  elements: [
    { type: 'player', id: 'player-1', x: 0.5, y: 0.5, colour: 'blue', label: '9' },
    { type: 'cone', id: 'cone-2', x: 0.2, y: 0.3, colour: 'orange' },
    { type: 'ball', id: 'ball-3', x: 0.4, y: 0.6 },
    { type: 'goal', id: 'goal-4', x: 0.5, y: 0.1, width: 0.24, facing: 'up' },
    { type: 'arrow', id: 'arrow-5', x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.7, arrow: 'pass' },
    { type: 'zone', id: 'zone-6', x: 0.1, y: 0.1, w: 0.4, h: 0.3, colour: 'yellow' },
    { type: 'text', id: 'text-7', x: 0.5, y: 0.9, text: 'Press' },
  ],
}

function drillRow(over: Record<string, unknown> = {}) {
  return {
    id: DRILL_A,
    club_id: CLUB,
    title: 'Rondo under pressure',
    summary: 'A possession square.',
    corner: 'technical',
    skill: 'Passing',
    level: 'Developing',
    ages: ['U9'],
    duration: 15,
    players: '6',
    area: '12 by 12',
    equipment: ['cones'],
    points: ['Open the body.'],
    tags: [],
    setup_notes: null,
    easier: [],
    harder: [],
    theme: null,
    format: null,
    source_url: null,
    source_label: null,
    source_key: null,
    media_id: null,
    rights: 'public_full' as const,
    diagram: STORED_DIAGRAM,
    ...over,
  }
}

describe('the server builds what the browser accepts', () => {
  it('a drill snapshot with a diagram validates in the browser, and its diagram is the server projection', () => {
    // BEHAVIOURAL, end to end across the two runtimes.
    const pub = toPublicProjection(buildDrillSnapshot(drillRow(), null, AT))
    expect(validatePublicDrillSnapshot(pub)).toBe(true)
    expect(pub.diagram).toEqual(projectDrillDiagram(STORED_DIAGRAM))
    expect(pub.diagram?.elements).toHaveLength(7)
  })

  it('a session snapshot with a drawn referenced drill validates in the browser', () => {
    const session = {
      id: 'c1111111-1111-1111-1111-111111111111',
      club_id: CLUB,
      name: 'Tuesday',
      focus: null,
      age_group: null,
      intentions: [],
      space: null,
      activities: [
        { phase: 'Skill', drill_id: DRILL_A, duration: 15 },
        { phase: 'Game', drill_id: DRILL_B, duration: 20 },
      ],
      board_id: null,
      source_url: null,
      source_label: null,
      rights: 'public_full' as const,
    }
    const pub = toPublicSessionProjection(
      buildSessionSnapshot(session, [drillRow(), drillRow({ id: DRILL_B, title: 'Waves', diagram: null })], [], null, AT),
    )
    expect(validatePublicSessionSnapshot(pub)).toBe(true)
    expect(pub.referencedDrills[0].diagram?.elements).toHaveLength(7)
    expect(pub.referencedDrills[1].diagram).toBeNull()
  })

  it('a programme snapshot with a drawn referenced drill validates in the browser', () => {
    const programme = {
      id: 'f1111111-1111-1111-1111-111111111111',
      name: 'Playing out',
      focus: null,
      summary: null,
      intentions: [],
      weeks: 1,
      pdf_media_id: null,
      source_url: null,
      source_label: null,
      rights: 'public_full' as const,
    }
    const template = {
      id: 'a1111111-1111-1111-1111-111111111111',
      name: 'Week one',
      focus: null,
      activities: [{ phase: 'Skill', drill_id: DRILL_A, duration: 15 }],
      programme_week: 1,
      created_at: AT,
      rights: 'public_full' as const,
    }
    const pub = toPublicProgrammeProjection(buildProgrammeSnapshot(programme, [template], [drillRow()], [], AT))
    expect(validatePublicProgrammeSnapshot(pub)).toBe(true)
    expect(pub.referencedDrills[0].diagram?.elements).toHaveLength(7)
  })

  it('both sides refuse the same widened diagram', () => {
    const wide = { ...projectDrillDiagram(STORED_DIAGRAM)!, elements: [{ type: 'ball', x: 0.5, y: 0.5, id: 'ball-1' }] }
    expect(isPublicDrillDiagram(wide)).toBe(false)
    const pub = toPublicProjection(buildDrillSnapshot(drillRow(), null, AT)) as unknown as Record<string, unknown>
    pub.diagram = wide
    expect(validatePublicDrillSnapshot(pub)).toBe(false)
  })
})

describe('the two halves name the same shapes', () => {
  it('the element allow lists agree, with the stored id removed, and match the 0046 constraint', () => {
    // BEHAVIOURAL for the server (the projection's own output keys) and
    // SOURCE TEXT for the migration, which states the stored shape as SQL.
    const projected = projectDrillDiagram(STORED_DIAGRAM)!
    const sql = read('supabase/migrations/0046_drill_diagram.sql')
    for (const el of projected.elements) {
      const type = el.type as keyof typeof PUBLIC_DIAGRAM_ELEMENT_KEYS
      expect(Object.keys(el), `server keys for ${type}`).toEqual([...PUBLIC_DIAGRAM_ELEMENT_KEYS[type]])
      const stored = new RegExp(`when '${type}'\\s+then public\\.drill_diagram_keys_within\\(p_el, array\\[([^\\]]*)\\]`).exec(sql)
      expect(stored, `the migration has no shape for ${type}`).toBeTruthy()
      const sqlKeys = [...stored![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((k) => k !== 'id')
      expect([...PUBLIC_DIAGRAM_ELEMENT_KEYS[type]].sort(), `0046 keys for ${type}`).toEqual(sqlKeys.sort())
    }
  })

  it('the deny lists agree: the client list is the server list plus the four stripped markers', () => {
    // SOURCE TEXT. A key added to one list and not the other is the realistic
    // drift, and it is silent: the server would refuse a payload the browser
    // accepts, or the reverse, and no test that reads only one side sees it.
    const server = read('supabase/functions/_shared/share.ts')
    const client = read('src/lib/publicShare.ts')
    const serverBlock = server.slice(server.indexOf('const FORBIDDEN_ANYWHERE = ['), server.indexOf('\n]', server.indexOf('const FORBIDDEN_ANYWHERE = [')))
    const clientBlock = client.slice(client.indexOf('const FORBIDDEN = new Set<string>(['), client.indexOf('\n])', client.indexOf('const FORBIDDEN = new Set<string>([')))
    const serverKeys = quotedKeys(serverBlock)
    const clientKeys = quotedKeys(clientBlock)
    expect(serverKeys.size).toBeGreaterThan(50)
    expect([...clientKeys].sort()).toEqual([...serverKeys, 'builder', 'public', '_mid', '_path'].sort())
  })

  it('neither deny list names the diagram any more, and both name the identity keys', () => {
    const server = read('supabase/functions/_shared/share.ts')
    const client = read('src/lib/publicShare.ts')
    const serverBlock = server.slice(server.indexOf('const FORBIDDEN_ANYWHERE = ['), server.indexOf('\n]', server.indexOf('const FORBIDDEN_ANYWHERE = [')))
    const clientBlock = client.slice(client.indexOf('const FORBIDDEN = new Set<string>(['), client.indexOf('\n])', client.indexOf('const FORBIDDEN = new Set<string>([')))
    for (const block of [serverBlock, clientBlock]) {
      const keys = quotedKeys(block)
      expect(keys.has('diagram')).toBe(false)
      for (const key of ['playerId', 'player_id', 'spond_member_id', 'name', 'display_name', 'guardian', 'email', 'phone', 'shirt_number']) {
        expect(keys.has(key), `deny list lacks ${key}`).toBe(true)
      }
    }
  })

  it('pins the snapshot version at 1 on both sides: the widening is additive and no stored share is invalidated', () => {
    // The read path (0039 onward) refuses any other version in SQL, so a bump
    // would take every existing link unavailable at once. A frozen snapshot
    // is told apart by the ABSENCE of the diagram key, not by a version.
    expect(SNAPSHOT_VERSION).toBe(1)
    expect(PUBLIC_SNAPSHOT_VERSION).toBe(1)
    expect(read('supabase/migrations/0041_public_programme_read.sql')).toContain("coalesce(v_share.snapshot->>'snapshotVersion', '') <> '1'")
  })
})

describe('the column reaches the builders and nothing else', () => {
  it('the Edge builder reads the diagram column, and the client drill read still does not', () => {
    // SOURCE TEXT. The one reviewed widening is the sharing function's own
    // drill read. The client's DRILL_COLS stays narrow, so the library, the
    // planner and every list read still cannot see a diagram.
    const edge = read('supabase/functions/manage-content-share/index.ts')
    const edgeCols = /const DRILL_COLS =\s*\n?\s*'([^']*)'/.exec(edge)
    expect(edgeCols, 'Edge DRILL_COLS could not be read').toBeTruthy()
    expect(edgeCols![1].split(',').map((c) => c.trim())).toContain('diagram')
    const client = read('src/lib/queries.ts')
    const clientCols = /const DRILL_COLS =\s*\n?\s*'([^']*)'/.exec(client)
    expect(clientCols, 'client DRILL_COLS could not be read').toBeTruthy()
    expect(clientCols![1]).not.toContain('diagram')
  })

  it('the public drill renderer draws no SVG of its own and mounts the canonical renderer', () => {
    // SOURCE TEXT. The one renderer rule reaches its fifth surface.
    const view = read('src/components/PublicDrillView.tsx')
    expect(view).not.toContain('<svg')
    expect(view).not.toContain('viewBox')
    expect(view).not.toContain('data-el=')
    expect(view).toContain('<DrillDiagramView')
    expect(view).toContain('toDrillDiagram(')
    // And it reads no live row: no query layer, no parser.
    expect(view).not.toContain('useDrillDiagram')
    expect(view).not.toContain('parseDrillDiagram(')
    expect(view).not.toContain("from '../lib/queries'")
  })
})

describe('an existing share gains a diagram only by being rebuilt', () => {
  const edge = read('supabase/functions/manage-content-share/index.ts')
  const fn = (name: string) => {
    const start = edge.indexOf(`async function ${name}(`)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    const next = edge.indexOf('\nasync function ', start + 1)
    return edge.slice(start, next === -1 ? undefined : next)
  }

  it('every refresh handler rebuilds the snapshot from live rows through the same builder create uses', () => {
    // SOURCE TEXT. The frozen share rule has one repair path: the owner
    // presses Update what people see, and the function reads the live rows
    // and builds a fresh snapshot exactly as create does. Patching the stored
    // snapshot in place would be a second projection, and it would need a
    // second review.
    expect(fn('handleRefresh')).toContain('buildDrillSnapshot(')
    expect(fn('handleRefreshSession')).toContain('buildSessionSnapshot(')
    expect(fn('handleRefreshProgramme')).toContain('buildProgrammeSnapshot(')
    for (const name of ['handleRefresh', 'handleRefreshSession', 'handleRefreshProgramme']) {
      const body = fn(name)
      expect(body).toContain("p_action: 'refresh'")
      expect(body).toContain('p_snapshot: snapshot')
      expect(body).not.toContain('jsonb_set')
    }
  })

  it('rotate and revoke never rebuild: a new secret or a closed link does not republish content', () => {
    for (const name of ['handleRotate', 'handleRevoke']) {
      const body = fn(name)
      expect(body).not.toContain('buildDrillSnapshot(')
      expect(body).not.toContain('buildSessionSnapshot(')
      expect(body).not.toContain('buildProgrammeSnapshot(')
      expect(body).not.toContain('p_snapshot')
    }
  })

  it('nothing rebuilds a share without an owner action: no sweep, no cron, no read time rewrite', () => {
    // SOURCE TEXT. The anonymous read function validates and signs; it never
    // calls the lifecycle RPC or a builder. The management screen for
    // shares.manage holders offers no refresh (AdminShares.tsx says why).
    const readFn = read('supabase/functions/read-content-share/index.ts')
    expect(readFn).not.toContain('manage_content_share')
    expect(readFn).not.toContain('buildDrillSnapshot')
    expect(readFn).not.toContain('buildSessionSnapshot')
    expect(readFn).not.toContain('buildProgrammeSnapshot')
    const admin = read('src/routes/AdminShares.tsx')
    expect(admin).not.toContain('useRefreshContentShare')
  })
})
