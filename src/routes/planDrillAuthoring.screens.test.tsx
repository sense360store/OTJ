// =====================================================================
// COACH-11 on the SCREENS a coach actually uses.
//
// The seam suite proves the affordances reach a host callback. What it
// cannot see is whether the REAL hosts hand them over, to whom, and
// when: a planner that offers New drill to a member without
// drills.create, a read only viewer offered Turn into a drill, or a
// week plan editor that never mounted the hook would all pass every
// seam test. So these mount the real Planner, the real TemplateFormModal
// and the real Drill Maker route with the data layer stubbed, and
// assert on what comes out.
//
// STATIC RENDER ONLY. There is no DOM in this project: what these cover
// is what a surface SHOWS for a given member and plan. What a press
// does is proved over the pure rules and at the seam.
//
// Names in fixtures are invented. No child or coach appears.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { blankSession } from '../lib/data'
import type { Drill, Session } from '../lib/data'
import { CUSTOM_ACTIVITY_TITLE } from '../lib/planDrillAuthoring'

const ME = 'coach-me'
const THEM = 'coach-them'

const drill = (id: string, title: string): Drill =>
  ({
    id,
    title,
    corner: 'technical',
    skill: 'Passing',
    ages: [],
    level: 'Foundation',
    duration: 10,
    players: '',
    area: '',
    equipment: [],
    mediaId: null,
    summary: '',
    points: [],
    tags: [],
    setupNotes: '',
    easier: [],
    harder: [],
    theme: '',
    format: '',
    sourceUrl: '',
    sourceLabel: '',
    sourceKey: '',
    rights: 'internal_only',
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: ME,
  }) as Drill

const state = {
  caps: new Set<string>(['sessions.create', 'drills.create']),
  session: null as Session | null,
}

const query = <T,>(data: T) => ({ data, isLoading: false, isPending: false, isError: false, isSuccess: true, error: null })
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false })

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { id: ME, full_name: 'Sam Whitfield', club_id: 'club' } }),
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: [], loading: false, error: false, upsertSession: async (s: Session) => s }),
}))
// The planner's Spond surfaces, the board picker and the attendance card read
// their own hooks and none of them is what this slice touched.
vi.mock('../components/PlanFromSpond', () => ({ PlanFromSpond: () => null }))
vi.mock('../components/SpondAttendance', () => ({ SpondAttendanceCard: () => null }))
vi.mock('../components/RightsControl', () => ({ RightsControl: () => null, RightsNewNote: () => null }))
vi.mock('../components/ActivityDiagram', () => ({ ActivityDiagram: () => null }))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useSession: () => query(state.session),
  useTeams: () => query([{ id: 'titans', name: 'Titans' }]),
  useVenues: () => query([]),
  // COACH-5's club age group list. Empty here on purpose: this file's
  // subject is the authoring affordances, and an unconfigured club is the
  // state that leaves every label exactly as the planner had it.
  useClubAgeGroups: () => query([] as string[]),
  useBoards: () => query([]),
  useMemberMap: () => ({ [THEM]: { fullName: 'Jo Bloggs' } }),
  useDrillMap: () => ({ d1: drill('d1', 'Rondo 4v1') }),
  useDrills: () => query([drill('d1', 'Rondo 4v1')]),
  useMediaMap: () => ({}),
  useMediaSrc: () => ({ src: null, isLoading: false, isError: false, onError: () => {}, onLoad: () => {} }),
  useActivityTitle: () => (a: { drillId?: string; title?: string }) => (a.drillId ? 'Rondo 4v1' : a.title || CUSTOM_ACTIVITY_TITLE),
  useInsertTemplate: () => mutation(),
  useUpdateTemplate: () => mutation(),
  useInsertDrill: () => mutation(),
  useUpdateDrill: () => mutation(),
  useUploadMedia: () => mutation(),
  useMedia: () => query([]),
  useDrill: () => query(drill('d1', 'Rondo 4v1')),
  useDrillDiagram: () => query(null),
  useUpdateDrillDiagram: () => mutation(),
  mediaTypeForFile: () => null,
  oversizeMessage: () => null,
}))

import { Planner } from './Planner'
import { TemplateFormModal } from '../components/TemplateFormModal'
import { DrillDiagramEditor, BACK_TO_DRILL, BACK_TO_PLAN } from './DrillDiagramEditor'

const custom = { phase: 'Skill' as const, title: CUSTOM_ACTIVITY_TITLE, duration: 10 }
const withDrill = { phase: 'Skill' as const, drillId: 'd1', duration: 10 }

function planner(at = '/planner'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/planner" element={<Planner />} />
      </Routes>
    </MemoryRouter>,
  )
}

function weekPlan(activities = [custom, withDrill]): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/templates']}>
      <TemplateFormModal
        template={{ id: 't1', name: 'Week 2', author: 'Club', focus: '', activities, intentions: [], createdAt: '', rights: 'club' } as never}
        onClose={() => {}}
      />
    </MemoryRouter>,
  )
}

function drillMaker(at: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/drill/:id/diagram" element={<DrillDiagramEditor />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.caps = new Set(['sessions.create', 'drills.create'])
  state.session = null
})

describe('the dated session planner', () => {
  it('offers New drill on a new session to a coach holding drills.create', () => {
    const html = planner()
    expect(html).toContain('New drill')
    expect(html.match(/class="add-slot"/g)).toHaveLength(3)
  })

  it('offers Turn into a drill on the custom row of the coach’s own session, and not on the drill row', () => {
    state.session = { ...blankSession(ME), id: 's1', activities: [custom, withDrill] }
    const html = planner('/planner?sessionId=s1')
    expect(html.match(/Turn into a drill/g)).toHaveLength(1)
    expect(html).toContain('New drill')
  })

  it('offers neither to a coach without drills.create, and the rest of the add bar is as it was', () => {
    state.caps = new Set(['sessions.create'])
    state.session = { ...blankSession(ME), id: 's1', activities: [custom] }
    const html = planner('/planner?sessionId=s1')
    expect(html).not.toContain('New drill')
    expect(html).not.toContain('Turn into a drill')
    expect(html.match(/class="add-slot"/g)).toHaveLength(2)
  })

  it('offers neither to a read only viewer of another coach’s session', () => {
    // drills.create held, sessions.manage not: the viewer may create drills
    // from the Library, and may not edit this plan, so nothing here.
    state.session = { ...blankSession(THEM), id: 's2', activities: [custom] }
    const html = planner('/planner?sessionId=s2')
    expect(html).toContain('View session')
    expect(html).not.toContain('New drill')
    expect(html).not.toContain('Turn into a drill')
    expect(html).not.toContain('add-slot')
  })

  it('keeps the drill form closed until a press, so a planner opens as a planner', () => {
    expect(planner()).not.toContain('Add to plan')
    expect(planner()).not.toContain('Save and draw it')
  })
})

describe('the week plan editor', () => {
  it('offers New drill and Turn into a drill to a member holding drills.create', () => {
    const html = weekPlan()
    expect(html).toContain('New drill')
    expect(html.match(/Turn into a drill/g)).toHaveLength(1)
    expect(html.match(/class="add-slot"/g)).toHaveLength(3)
  })

  it('offers neither without drills.create, whatever else the member holds', () => {
    state.caps = new Set(['sessions.create', 'templates.manage', 'templates.create'])
    const html = weekPlan()
    expect(html).not.toContain('New drill')
    expect(html).not.toContain('Turn into a drill')
    expect(html.match(/class="add-slot"/g)).toHaveLength(2)
  })
})

describe('the Drill Maker opened from a plan', () => {
  it('names the plan as where Back goes when a plan opened it', () => {
    const html = drillMaker(`/drill/d1/diagram?return=${encodeURIComponent('/planner?sessionId=s1&draft=tok')}`)
    expect(html).toContain(`aria-label="${BACK_TO_PLAN}"`)
    expect(html).not.toContain(`aria-label="${BACK_TO_DRILL}"`)
  })

  it('goes back to the drill as before when nothing opened it, or when the address is not a plan', () => {
    expect(drillMaker('/drill/d1/diagram')).toContain(`aria-label="${BACK_TO_DRILL}"`)
    for (const bad of ['https://example.com/planner', '//example.com', '/library', '/drill/d2']) {
      const html = drillMaker(`/drill/d1/diagram?return=${encodeURIComponent(bad)}`)
      expect(html, bad).toContain(`aria-label="${BACK_TO_DRILL}"`)
      expect(html, bad).not.toContain(BACK_TO_PLAN)
    }
  })

  it('still refuses a drill the member may not draw, with the plan as the way back', () => {
    // Ownership is unchanged by the way in: a return address grants nothing.
    state.caps = new Set(['sessions.create'])
    const html = drillMaker(`/drill/d1/diagram?return=${encodeURIComponent('/planner')}`)
    expect(html).toContain('cannot be changed')
    expect(html).toContain(`aria-label="${BACK_TO_PLAN}"`)
    expect(html).not.toContain('dde-tools')
  })
})
