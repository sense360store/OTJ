import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ActivityCardView, PlannerActionsView } from './Planner'
import type { PlannerAction } from '../lib/sessionSubmit'
import type { Activity, Drill } from '../lib/data'

// ActivityCardView is the planner's drill row pulled out as a presentational
// component, so the static renderer covers expand and collapse and the row
// controls without a DOM or a query client, the same style as the rest of the
// suite. ActivityRow in the screen resolves the drill and the media nodes and
// passes them in; here they are plain fixtures, and the media preview is a
// stand-in so no signed-URL hook runs.

const drill: Drill = {
  id: 'd1',
  title: 'Rondo 4v1',
  corner: 'technical',
  skill: 'Passing',
  ages: ['U9', 'U10'],
  level: 'Foundation',
  duration: 15,
  players: '5',
  area: '12x12',
  equipment: ['Cones', 'Bibs'],
  mediaId: null,
  summary: 'Keep the ball away from the defender.',
  points: ['Open your body', 'Pass and move'],
  tags: ['rondo'],
  setupNotes: '',
  easier: ['Make the area bigger'],
  harder: ['Add a second defender'],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  createdAt: '2026-01-01',
}

const act: Activity = { phase: 'Skill', drillId: 'd1', duration: 15 }

const noop = () => {}

function render(expanded: boolean, opts: { readOnly?: boolean; drill?: Drill | null } = {}): string {
  const rowDrill = 'drill' in opts ? opts.drill! : drill
  return renderToStaticMarkup(
    <MemoryRouter>
      <ActivityCardView
        act={act}
        idx={0}
        title={rowDrill ? rowDrill.title : 'Custom activity'}
        drill={rowDrill}
        thumb={<span>thumb</span>}
        expandedMedia={<span>media-preview</span>}
        drillHref="/drill/d1"
        expanded={expanded}
        onToggle={noop}
        onRemove={noop}
        onDur={noop}
        onPhase={noop}
        dragHandlers={{ onDragStart: noop, onDragEnter: noop, onDragEnd: noop, onDragOver: noop }}
        dragging={false}
        readOnly={opts.readOnly ?? false}
      />
    </MemoryRouter>,
  )
}

describe('ActivityCardView', () => {
  it('keeps the drill detail out of the markup until the card is expanded', () => {
    const html = render(false)
    expect(html).toContain('Rondo 4v1')
    expect(html).toContain('aria-expanded="false"')
    // No summary, coaching points, adaptations or detail link while collapsed.
    expect(html).not.toContain('Keep the ball away from the defender.')
    expect(html).not.toContain('Open your body')
    expect(html).not.toContain('Make it harder')
    expect(html).not.toContain('Open full drill')
    expect(html).not.toContain('media-preview')
  })

  it('shows the summary, coaching points and adaptations when expanded', () => {
    const html = render(true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Keep the ball away from the defender.')
    expect(html).toContain('Coaching points')
    expect(html).toContain('Open your body')
    expect(html).toContain('Pass and move')
    expect(html).toContain('Make it easier')
    expect(html).toContain('Make the area bigger')
    expect(html).toContain('Make it harder')
    expect(html).toContain('Add a second defender')
    expect(html).toContain('Cones')
    // The injected media preview and the link out to the full drill route.
    expect(html).toContain('media-preview')
    expect(html).toContain('Open full drill')
    expect(html).toContain('href="/drill/d1"')
  })

  it('keeps the remove and phase controls present and wired in both states', () => {
    for (const html of [render(false), render(true)]) {
      // The phase select offers every phase, so changing it still drives onPhase.
      expect(html).toContain('<select')
      for (const phase of ['Warm-Up', 'Skill', 'Game', 'Cool-Down']) {
        expect(html).toContain(`>${phase}</option>`)
      }
      // The remove control survives expansion rather than being swallowed.
      expect(html).toContain('aria-label="Remove activity"')
    }
  })

  it('offers no expansion for a custom activity that has no drill', () => {
    const html = render(false, { drill: null })
    expect(html).toContain('Custom activity')
    expect(html).not.toContain('aria-expanded')
  })

  it('drops the grip and remove control in a read-only session but still expands', () => {
    const html = render(true, { readOnly: true })
    expect(html).not.toContain('aria-label="Remove activity"')
    expect(html).not.toContain('act-grip')
    // Expansion is independent of edit rights: the detail still renders, and
    // the phase select is disabled rather than removed.
    expect(html).toContain('Open your body')
    expect(html).toContain('disabled')
  })
})

// The action card pulled out as a presentational component, so the static
// renderer covers the pending labels, the disabled states and the accessible
// failure note. The editor's awaited submit flow itself is covered in
// src/lib/sessionSubmit.test.ts; these tests pin what the coach sees in each
// submit state.
function renderActions(over: Partial<Parameters<typeof PlannerActionsView>[0]> = {}): string {
  return renderToStaticMarkup(
    <PlannerActionsView
      readOnly={false}
      isExisting
      canStart
      pending={null}
      failed={null}
      onStart={noop}
      onSave={noop}
      onSessionDay={noop}
      onCalendar={noop}
      onLoadTemplate={noop}
      onDelete={noop}
      {...over}
    />,
  )
}

// The buttons in document order, with their disabled state, so assertions can
// target one button rather than the whole markup string.
function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
    label: m[0].replace(/<[^>]+>/g, ''),
    disabled: m[0].includes('disabled'),
  }))
}

describe('PlannerActionsView', () => {
  it('offers Start, Save and the secondary actions enabled when idle', () => {
    const all = buttons(renderActions())
    expect(all.map((b) => b.label)).toEqual([
      'Start session',
      'Session day',
      'Add to calendar',
      'Save session',
      'Load a template',
      'Delete session',
    ])
    expect(all.every((b) => !b.disabled)).toBe(true)
  })

  it('shows Saving… and disables both Save and Start while a save is in flight', () => {
    const html = renderActions({ pending: 'save' as PlannerAction })
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Saving…')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Start session')?.disabled).toBe(true)
    expect(html).not.toContain('role="alert"')
  })

  it('shows Starting… and disables both actions while a start is in flight', () => {
    const all = buttons(renderActions({ pending: 'start' as PlannerAction }))
    expect(all.find((b) => b.label === 'Starting…')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Save session')?.disabled).toBe(true)
  })

  it('announces a failed save calmly, with a Retry, and re-enables the buttons', () => {
    const html = renderActions({ failed: 'save' as PlannerAction })
    expect(html).toContain('role="alert"')
    expect(html).toContain('We couldn&#x27;t save this session. Check your connection and try again.')
    // Calm wording only: no raw error internals reach the markup.
    expect(html).not.toMatch(/supabase|postgres|fetch/i)
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Retry')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Save session')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Start session')?.disabled).toBe(false)
  })

  it('words a failed start as a save-before-start failure', () => {
    const html = renderActions({ failed: 'start' as PlannerAction })
    expect(html).toContain('save this session before starting it')
    expect(html).toContain('Retry')
  })

  it('withholds Retry for a failed start once the session has no activities left', () => {
    // Retrying a start must honour the same empty-session gate as the Start
    // button, or Retry would open the live view on an empty session.
    const html = renderActions({ failed: 'start' as PlannerAction, canStart: false })
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('Retry')
    // A failed save keeps its Retry regardless: saving an empty session is
    // allowed, only starting one is not.
    const saveHtml = renderActions({ failed: 'save' as PlannerAction, canStart: false })
    expect(saveHtml).toContain('Retry')
  })

  it('renders read-only as Watch live with no save affordances and no error slot', () => {
    const html = renderActions({ readOnly: true })
    expect(html).toContain('Watch live')
    expect(html).not.toContain('Save session')
    expect(html).not.toContain('Delete session')
    expect(html).not.toContain('role="alert"')
    expect(buttons(html).find((b) => b.label === 'Watch live')?.disabled).toBe(false)
  })

  it('holds Start closed on an empty session but leaves Save available', () => {
    const all = buttons(renderActions({ canStart: false }))
    expect(all.find((b) => b.label === 'Start session')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Save session')?.disabled).toBe(false)
  })

  it('hides Session day, calendar and delete for a session not yet saved', () => {
    const labels = buttons(renderActions({ isExisting: false })).map((b) => b.label)
    expect(labels).toEqual(['Start session', 'Save session', 'Load a template'])
  })
})
