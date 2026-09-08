// =====================================================================
// COACH-10 at the seam: one editor, two hosts, nothing visibly new.
//
// The existing Planner.test.tsx, TemplateFormModal.test.tsx and
// coach2b.screens.test.tsx suites pass UNCHANGED against the extracted
// rows, which is the refactor's primary guard. What they cannot see is
// the editor's own plumbing: which host callback each control actually
// reaches, with which index. A swapped phase and duration callback, or a
// reorder off by one, renders byte-identical markup, so markup tests
// cannot catch it.
//
// There is no DOM in this project, so the wiring half walks the element
// tree the REAL component returns, invoking function components as the
// pure functions they are, and fires the collected handlers directly.
// Every component under the editor is hook-free by design (the invariant
// suite pins that), which is what makes direct invocation sound.
//
// Names in fixtures are invented. No real coach or child appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityListEditor, type DragHandlers } from './ActivityListEditor'
import { NOT_RUNNING_LABEL, type ActivityRole } from '../lib/activityRole'
import type { Activity, Drill, Phase } from '../lib/data'

const noop = () => {}

const act = (over: Partial<Activity> = {}): Activity => ({
  phase: 'Skill',
  title: 'Passing square',
  duration: 10,
  ...over,
})

// ---- The element-tree walker -----------------------------------------

interface HostEl {
  type: string
  props: Record<string, unknown>
}

function collect(node: unknown, out: HostEl[]): void {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out)
    return
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (!el.type) return
  if (typeof el.type === 'function') {
    collect((el.type as (p: unknown) => unknown)(el.props), out)
    return
  }
  if (typeof el.type === 'string') out.push({ type: el.type, props: el.props ?? {} })
  collect((el.props as { children?: unknown } | undefined)?.children, out)
}

function elements(node: unknown): HostEl[] {
  const out: HostEl[] = []
  collect(node, out)
  return out
}

function textOf(props: Record<string, unknown>): string {
  const parts: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string' || typeof n === 'number') {
      parts.push(String(n))
      return
    }
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    const el = n as { props?: { children?: unknown } } | null
    if (el && typeof el === 'object' && el.props) walk(el.props.children)
  }
  walk(props.children)
  return parts.join('')
}

const selects = (els: HostEl[]) => els.filter((e) => e.type === 'select')
const numberInputs = (els: HostEl[]) => els.filter((e) => e.type === 'input' && e.props.type === 'number')
const buttonsBy = (els: HostEl[], match: (e: HostEl) => boolean) => els.filter((e) => e.type === 'button' && match(e))
const removeButtons = (els: HostEl[]) => buttonsBy(els, (e) => e.props['aria-label'] === 'Remove activity')
const chipButtons = (els: HostEl[]) =>
  buttonsBy(els, (e) => typeof e.props.className === 'string' && (e.props.className as string).startsWith('chip'))

// ---- Fixtures ---------------------------------------------------------

// Three activities: a custom row, a station and the games phase, so the
// role rows and the stand-down are all exercised through the editor.
const PLAN: Activity[] = [act({ title: 'Arrival games' }), act({ slot: 'station' }), act({ slot: 'game' })]

function spies() {
  const handlers: DragHandlers[] = PLAN.map(() => ({
    onDragStart: noop,
    onDragEnter: noop,
    onDragEnd: noop,
    onDragOver: noop,
  }))
  return {
    onPhase: vi.fn<(i: number, phase: Phase) => void>(),
    onDuration: vi.fn<(i: number, duration: number) => void>(),
    onRole: vi.fn<(i: number, role: ActivityRole) => void>(),
    onRemove: vi.fn<(i: number) => void>(),
    onAddLibrary: vi.fn<() => void>(),
    onAddCustom: vi.fn<() => void>(),
    onToggle: vi.fn<(i: number) => void>(),
    onStandDown: vi.fn<(i: number, on: boolean) => void>(),
    onMove: vi.fn<(i: number, dir: -1 | 1) => void>(),
    dragHandlersFor: vi.fn((i: number) => handlers[i]),
    handlers,
  }
}

type SessionSpies = ReturnType<typeof spies>

function sessionEditor(s: SessionSpies, over: { readOnly?: boolean; busy?: boolean; activities?: Activity[] } = {}) {
  return (
    <ActivityListEditor
      activities={over.activities ?? PLAN}
      variant={{
        kind: 'session',
        readOnly: over.readOnly ?? false,
        busy: over.busy ?? false,
        empty: <span>host-empty</span>,
        expandedIdx: null,
        onToggle: s.onToggle,
        onStandDown: s.onStandDown,
        draggingIdx: null,
        dragHandlersFor: s.dragHandlersFor,
        content: (a) => ({
          title: a.title ?? 'Untitled',
          drill: null,
          thumb: <span>thumb</span>,
          expandedMedia: null,
          expandedDiagram: null,
          drillHref: '',
        }),
      }}
      onPhase={s.onPhase}
      onDuration={s.onDuration}
      onRole={s.onRole}
      onRemove={s.onRemove}
      onAddLibrary={s.onAddLibrary}
      onAddCustom={s.onAddCustom}
    />
  )
}

function planEditor(s: SessionSpies, over: { activities?: Activity[] } = {}) {
  return (
    <ActivityListEditor
      activities={over.activities ?? PLAN}
      variant={{
        kind: 'plan',
        busy: false,
        meta: (a) => ({ title: a.title ?? 'Untitled', skill: null }),
        onMove: s.onMove,
      }}
      onPhase={s.onPhase}
      onDuration={s.onDuration}
      onRole={s.onRole}
      onRemove={s.onRemove}
      onAddLibrary={s.onAddLibrary}
      onAddCustom={s.onAddCustom}
    />
  )
}

// ---------------------------------------------------------------------

describe('the wiring: each control reaches its own host callback with its own index', () => {
  it('a phase change writes the phase of that row and touches no duration', () => {
    for (const editor of [sessionEditor, planEditor]) {
      const s = spies()
      const els = elements(editor(s))
      const sel = selects(els)
      expect(sel).toHaveLength(3)
      ;(sel[1].props.onChange as (e: unknown) => void)({ target: { value: 'Game' } })
      expect(s.onPhase).toHaveBeenCalledExactlyOnceWith(1, 'Game')
      expect(s.onDuration).not.toHaveBeenCalled()
    }
  })

  it('a duration change writes the duration of that row and touches no phase', () => {
    for (const editor of [sessionEditor, planEditor]) {
      const s = spies()
      const els = elements(editor(s))
      const inputs = numberInputs(els)
      expect(inputs).toHaveLength(3)
      ;(inputs[2].props.onChange as (e: unknown) => void)({ target: { value: '25' } })
      expect(s.onDuration).toHaveBeenCalledExactlyOnceWith(2, 25)
      expect(s.onPhase).not.toHaveBeenCalled()
      // The cleared-input rule both hosts always had: empty reads as zero.
      ;(inputs[0].props.onChange as (e: unknown) => void)({ target: { value: '' } })
      expect(s.onDuration).toHaveBeenLastCalledWith(0, 0)
    }
  })

  it('remove targets exactly the pressed row', () => {
    for (const editor of [sessionEditor, planEditor]) {
      const s = spies()
      const removes = removeButtons(elements(editor(s)))
      expect(removes).toHaveLength(3)
      ;(removes[0].props.onClick as () => void)()
      expect(s.onRemove).toHaveBeenCalledExactlyOnceWith(0)
    }
  })

  it('a role press reaches onRole with the row index and the pressed role', () => {
    for (const editor of [sessionEditor, planEditor]) {
      const s = spies()
      const chips = chipButtons(elements(editor(s)))
      // Three roles per row, three rows.
      expect(chips).toHaveLength(9)
      const stationChipRow1 = chips.filter((c) => textOf(c.props) === 'Station')[1]
      ;(stationChipRow1.props.onClick as () => void)()
      expect(s.onRole).toHaveBeenCalledExactlyOnceWith(1, 'station')
      expect(s.onPhase).not.toHaveBeenCalled()
    }
  })

  it('the dated stand-down reaches onStandDown for its own station row', () => {
    const s = spies()
    const els = elements(sessionEditor(s))
    const boxes = els.filter((e) => e.type === 'input' && e.props.type === 'checkbox')
    // Only the station row carries one: never the custom row, never games.
    expect(boxes).toHaveLength(1)
    ;(boxes[0].props.onChange as (e: unknown) => void)({ target: { checked: true } })
    expect(s.onStandDown).toHaveBeenCalledExactlyOnceWith(1, true)
  })

  it('the week plan reorder reaches onMove with the row index and direction', () => {
    const s = spies()
    const els = elements(planEditor(s))
    const ups = buttonsBy(els, (e) => e.props['aria-label'] === 'Move up')
    const downs = buttonsBy(els, (e) => e.props['aria-label'] === 'Move down')
    expect(ups).toHaveLength(3)
    ;(ups[1].props.onClick as () => void)()
    expect(s.onMove).toHaveBeenCalledExactlyOnceWith(1, -1)
    ;(downs[1].props.onClick as () => void)()
    expect(s.onMove).toHaveBeenLastCalledWith(1, 1)
    // The ends stay closed, exactly as before.
    expect(ups[0].props.disabled).toBe(true)
    expect(downs[2].props.disabled).toBe(true)
  })

  it('the session drag handlers on each card are the host object for that index', () => {
    const s = spies()
    const els = elements(sessionEditor(s))
    const cards = els.filter((e) => e.props.className === 'act-card')
    expect(cards).toHaveLength(3)
    cards.forEach((card, i) => {
      expect(card.props.draggable).toBe(true)
      // Identity, not shape: the wrong index would carry the wrong object.
      expect(card.props.onDragEnter).toBe(s.handlers[i].onDragEnter)
    })
    expect(s.dragHandlersFor).toHaveBeenCalledWith(0)
    expect(s.dragHandlersFor).toHaveBeenCalledWith(2)
  })

  it('expanding toggles the pressed row', () => {
    const s = spies()
    const withDrill = [act({ drillId: 'd1' }), act({ drillId: 'd2' })]
    const els = elements(
      <ActivityListEditor
        activities={withDrill}
        variant={{
          kind: 'session',
          readOnly: false,
          busy: false,
          empty: null,
          expandedIdx: null,
          onToggle: s.onToggle,
          onStandDown: s.onStandDown,
          draggingIdx: null,
          dragHandlersFor: s.dragHandlersFor,
          content: () => ({
            title: 'Rondo',
            drill: {
              id: 'd1',
              title: 'Rondo',
              corner: 'technical',
              skill: '',
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
              createdAt: '',
              rights: 'internal_only',
            },
            thumb: null,
            expandedMedia: null,
            expandedDiagram: null,
            drillHref: '/drill/d1',
          }),
        }}
        onPhase={s.onPhase}
        onDuration={s.onDuration}
        onRole={s.onRole}
        onRemove={s.onRemove}
        onAddLibrary={s.onAddLibrary}
        onAddCustom={s.onAddCustom}
      />,
    )
    const toggles = buttonsBy(els, (e) => e.props.className === 'ac-toggle')
    expect(toggles).toHaveLength(2)
    ;(toggles[1].props.onClick as () => void)()
    expect(s.onToggle).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('the add bar reaches the host add callbacks, and only when pressed', () => {
    for (const editor of [sessionEditor, planEditor]) {
      const s = spies()
      const els = elements(editor(s))
      const library = buttonsBy(els, (e) => textOf(e.props) === 'Add from library')[0]
      const custom = buttonsBy(els, (e) => textOf(e.props) === 'Add custom')[0]
      expect(s.onAddLibrary).not.toHaveBeenCalled()
      ;(library.props.onClick as () => void)()
      ;(custom.props.onClick as () => void)()
      expect(s.onAddLibrary).toHaveBeenCalledOnce()
      expect(s.onAddCustom).toHaveBeenCalledOnce()
    }
  })
})

describe('both hosts still agree on what the surface shows', () => {
  const sessionHtml = (over: Parameters<typeof sessionEditor>[1] = {}) =>
    renderToStaticMarkup(sessionEditor(spies(), over))
  const planHtml = (over: Parameters<typeof planEditor>[1] = {}) => renderToStaticMarkup(planEditor(spies(), over))

  it('renders the rows in source order on both surfaces', () => {
    const titles = ['First block', 'Second block', 'Third block']
    const acts = titles.map((t) => act({ title: t }))
    for (const html of [sessionHtml({ activities: acts }), planHtml({ activities: acts })]) {
      const positions = titles.map((t) => html.indexOf(t))
      expect(positions.every((p) => p >= 0)).toBe(true)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    }
  })

  it('offers the stand-down on a dated station and never on a week plan', () => {
    expect(sessionHtml()).toContain(NOT_RUNNING_LABEL)
    expect(planHtml()).not.toContain(NOT_RUNNING_LABEL)
    expect(planHtml()).not.toContain('type="checkbox"')
  })

  it('carries the role group and the derived badge through both variants', () => {
    for (const html of [sessionHtml(), planHtml()]) {
      expect(html).toContain('Session role')
      expect(html).toMatch(/<span class="role-badge"[^>]*>Station 1</)
      expect(html).toMatch(/<span class="role-badge"[^>]*>Games phase</)
    }
  })

  it('freezes the session controls while a write is in flight, and never the week plan', () => {
    const busy = sessionHtml({ busy: true })
    expect(busy).not.toContain('draggable="true"')
    expect((busy.match(/<select[^>]*>/g) ?? []).every((t) => t.includes('disabled'))).toBe(true)
    expect((busy.match(/<input type="number"[^>]*>/g) ?? []).every((t) => t.includes('disabled'))).toBe(true)
    expect((busy.match(/<button class="add-slot"[^>]*>/g) ?? []).every((t) => t.includes('disabled'))).toBe(true)
    // The week plan variant has no busy state to receive: its current
    // behaviour is that no activity control ever froze, and it still holds.
    const plan = planHtml()
    expect((plan.match(/<select[^>]*>/g) ?? []).some((t) => t.includes('disabled'))).toBe(false)
    expect((plan.match(/<button class="add-slot"[^>]*>/g) ?? []).some((t) => t.includes('disabled'))).toBe(false)
  })

  it('renders a read-only session with no write controls and no add bar', () => {
    const html = sessionHtml({ readOnly: true })
    expect(html).not.toContain('act-grip')
    expect(html).not.toContain('aria-label="Remove activity"')
    expect(html).not.toContain('add-slot')
    expect(html).not.toContain('Session role')
    // The derived structure still reaches the viewer.
    expect(html).toMatch(/<span class="role-badge"[^>]*>Station 1</)
  })

  it('shows the host empty state and keeps the add bar when the plan is empty', () => {
    const html = sessionHtml({ activities: [] })
    expect(html).toContain('host-empty')
    expect(html).not.toContain('timeline')
    expect(html).toContain('Add from library')
  })

  it('keeps the two add affordances and no more when a host supplies no drill authoring', () => {
    // COACH-11's New drill and Turn into a drill arrive through optional
    // callbacks. A host that passes neither (a member without drills.create
    // is one) gets exactly what each host could add before this seam existed.
    for (const html of [sessionHtml(), planHtml()]) {
      expect(html.match(/add-slot/g)).toHaveLength(2)
      expect(html).toContain('Add from library')
      expect(html).toContain('Add custom')
      expect(html).not.toContain('New drill')
      expect(html).not.toContain('Turn into a drill')
      expect(html).not.toContain('Draw it')
    }
  })
})

// =====================================================================
// COACH-11 at the seam: New drill in the add bar, Turn into a drill on a
// custom row, on both surfaces, reaching the host with the right index.
// =====================================================================

function authoringSpies() {
  return {
    ...spies(),
    onNewDrill: vi.fn<() => void>(),
    onTurnIntoDrill: vi.fn<(i: number) => void>(),
  }
}
type AuthoringSpies = ReturnType<typeof authoringSpies>

// A drill row between two custom rows, so "only a custom row offers it" is
// asserted against a real mix rather than an all custom plan.
const MIXED: Activity[] = [act({ title: 'Arrival games' }), act({ drillId: 'd1', title: undefined }), act({ slot: 'station' })]

function withAuthoring(kind: 'session' | 'plan', s: AuthoringSpies, over: { readOnly?: boolean; busy?: boolean } = {}) {
  const shared = {
    activities: MIXED,
    onPhase: s.onPhase,
    onDuration: s.onDuration,
    onRole: s.onRole,
    onRemove: s.onRemove,
    onAddLibrary: s.onAddLibrary,
    onAddCustom: s.onAddCustom,
    onNewDrill: s.onNewDrill,
    onTurnIntoDrill: s.onTurnIntoDrill,
  }
  if (kind === 'plan') {
    return <ActivityListEditor {...shared} variant={{ kind: 'plan', busy: over.busy ?? false, meta: (a) => ({ title: a.title ?? 'Rondo', skill: null }), onMove: s.onMove }} />
  }
  return (
    <ActivityListEditor
      {...shared}
      variant={{
        kind: 'session',
        readOnly: over.readOnly ?? false,
        busy: over.busy ?? false,
        empty: null,
        expandedIdx: null,
        onToggle: s.onToggle,
        onStandDown: s.onStandDown,
        draggingIdx: null,
        dragHandlersFor: s.dragHandlersFor,
        content: (a) => ({
          title: a.title ?? 'Rondo',
          drill: a.drillId ? ({ id: a.drillId, title: 'Rondo', skill: '', equipment: [], points: [], easier: [], harder: [] } as unknown as Drill) : null,
          thumb: null,
          expandedMedia: null,
          expandedDiagram: null,
          drillHref: a.drillId ? '/drill/d1' : '',
        }),
      }}
    />
  )
}

describe('COACH-11: creating a drill from either surface', () => {
  it('offers New drill as a third add action on both surfaces, reaching the host only when pressed', () => {
    for (const kind of ['session', 'plan'] as const) {
      const s = authoringSpies()
      const els = elements(withAuthoring(kind, s))
      const adds = buttonsBy(els, (e) => e.props.className === 'add-slot')
      expect(adds.map((b) => textOf(b.props))).toEqual(['Add from library', 'Add custom', 'New drill'])
      expect(s.onNewDrill).not.toHaveBeenCalled()
      ;(adds[2].props.onClick as () => void)()
      expect(s.onNewDrill).toHaveBeenCalledOnce()
      expect(s.onAddLibrary).not.toHaveBeenCalled()
      expect(s.onAddCustom).not.toHaveBeenCalled()
    }
  })

  it('offers Turn into a drill on the custom rows alone, with each row its own index', () => {
    for (const kind of ['session', 'plan'] as const) {
      const s = authoringSpies()
      const els = elements(withAuthoring(kind, s))
      const turns = buttonsBy(els, (e) => textOf(e.props) === 'Turn into a drill')
      // Rows 0 and 2 are custom; row 1 has a drill and has nothing to turn.
      expect(turns).toHaveLength(2)
      ;(turns[1].props.onClick as () => void)()
      expect(s.onTurnIntoDrill).toHaveBeenCalledExactlyOnceWith(2)
      ;(turns[0].props.onClick as () => void)()
      expect(s.onTurnIntoDrill).toHaveBeenLastCalledWith(0)
      // A press turns; it never removes, re-phases or re-times the row.
      expect(s.onRemove).not.toHaveBeenCalled()
      expect(s.onPhase).not.toHaveBeenCalled()
      expect(s.onDuration).not.toHaveBeenCalled()
    }
  })

  it('never offers Turn into a drill on a row whose drill was deleted', () => {
    // The dated row renders the custom body when the drill resolves to
    // null, and a deleted drill resolves to null too. The offer keys on the
    // activity's own drillId, because the plan rules refuse to replace a
    // drill row and the created drill would reach no plan.
    const s = authoringSpies()
    const removed: Activity[] = [act({ drillId: 'd-gone', title: undefined })]
    const html = renderToStaticMarkup(
      <ActivityListEditor
        activities={removed}
        variant={{
          kind: 'session',
          readOnly: false,
          busy: false,
          empty: null,
          expandedIdx: null,
          onToggle: s.onToggle,
          onStandDown: s.onStandDown,
          draggingIdx: null,
          dragHandlersFor: s.dragHandlersFor,
          content: () => ({ title: 'Removed drill', drill: null, thumb: null, expandedMedia: null, expandedDiagram: null, drillHref: '' }),
        }}
        onPhase={s.onPhase}
        onDuration={s.onDuration}
        onRole={s.onRole}
        onRemove={s.onRemove}
        onAddLibrary={s.onAddLibrary}
        onAddCustom={s.onAddCustom}
        onNewDrill={s.onNewDrill}
        onTurnIntoDrill={s.onTurnIntoDrill}
      />,
    )
    expect(html).toContain('Removed drill')
    expect(html).not.toContain('Turn into a drill')
    expect(html).toContain('New drill')
  })

  it('freezes both with every other write control while a session write is in flight', () => {
    const s = authoringSpies()
    const els = elements(withAuthoring('session', s, { busy: true }))
    const newDrill = buttonsBy(els, (e) => textOf(e.props) === 'New drill')[0]
    expect(newDrill.props.disabled).toBe(true)
    for (const t of buttonsBy(els, (e) => textOf(e.props) === 'Turn into a drill')) expect(t.props.disabled).toBe(true)
  })

  it('offers neither to a read only viewer of a session', () => {
    const html = renderToStaticMarkup(withAuthoring('session', authoringSpies(), { readOnly: true }))
    expect(html).not.toContain('New drill')
    expect(html).not.toContain('Turn into a drill')
    expect(html).not.toContain('add-slot')
  })

  it('draws the affordances with the shared vocabulary, on both surfaces', () => {
    for (const kind of ['session', 'plan'] as const) {
      const html = renderToStaticMarkup(withAuthoring(kind, authoringSpies()))
      // The add bar is a class, so the third action wraps rather than clips.
      expect(html).toContain('class="add-bar"')
      expect(html.match(/class="add-slot"/g)).toHaveLength(3)
      // Turn into a drill is the Button primitive's quiet small variant.
      expect(html).toMatch(/<button type="button" class="btn btn-quiet btn-sm act-turn"[^>]*>(?:(?!<\/button>).)*Turn into a drill/)
      // No inline style on the controls this slice owns: the phase select,
      // the minutes field and the add bar draw from the stylesheet. (The
      // role row beneath is COACH-2B's file and keeps its own until its
      // wave; this asserts nothing about it.)
      for (const tag of html.match(/<select[^>]*>|<input class="act-dur-input"[^>]*>|<button type="button" class="add-slot"[^>]*>/g) ?? []) {
        expect(tag).not.toContain('style=')
      }
      expect(html).toContain('<select class="act-phase"')
    }
  })

  it('names the two row controls, which the row never did', () => {
    // A select with no label is a phase to a sighted coach and a list of
    // four words to a screen reader.
    const html = renderToStaticMarkup(withAuthoring('session', authoringSpies()))
    expect(html).toContain('aria-label="Phase"')
    expect(html).toContain('aria-label="Minutes"')
  })
  it('freezes both authoring affordances on BOTH hosts while a save is in flight', () => {
    // Codex, second round. The week plan variant hard coded busy to false,
    // which was harmless while every action in its bar was a local draft
    // edit and became a defect the moment COACH-11 put a WRITE there. Both
    // orderings lose: a template save that lands first closes the host and
    // unmounts the drill form mid insert, and a drill insert that lands
    // first writes into a draft whose payload the submit already captured.
    // Either creates a library drill the saved week never carries.
    for (const kind of ['session', 'plan'] as const) {
      const html = renderToStaticMarkup(withAuthoring(kind, authoringSpies(), { busy: true }))
      // Every add-bar action is disabled, New drill included.
      for (const tag of html.match(/<button type="button" class="add-slot"[^>]*>/g) ?? []) {
        expect(tag, kind).toContain('disabled')
      }
      // And so is Turn into a drill on the custom row.
      const turn = html.match(/<button type="button" class="btn btn-quiet btn-sm act-turn"[^>]*>/g) ?? []
      expect(turn.length, kind).toBeGreaterThan(0)
      for (const tag of turn) expect(tag, kind).toContain('disabled')
    }
  })
})
