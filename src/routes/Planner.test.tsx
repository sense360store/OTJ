import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  ActivityCardView,
  AddActivityBar,
  CoveredTeamsField,
  PlannerActionsView,
  PlannerHeaderView,
  PlannerWorkspace,
  SessionFieldsView,
} from './Planner'
import type { Venue } from '../lib/venues'
import type { PlannerAction } from '../lib/sessionSubmit'
import { SESSION_SHARE_ERROR } from '../lib/sessionSubmit'
import { SHARE_ACCOUNT_NOTE, type ShareFeedback } from '../lib/share'
import { sessionMinutes } from '../lib/data'
import type { Activity, Drill, Session, Team } from '../lib/data'
import { ActivityDiagramView } from '../components/ActivityDiagram'
import { DRILL_DIAGRAM_VERSION, type DrillDiagram } from '../lib/drillDiagram'

// A saved diagram with one of everything that matters here: a player (the
// element a tactics board would put a name on and this one never does), a cone
// and a passing arrow (whose meaning is a dash pattern, not a colour).
const diagram: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'half_pitch', orientation: 'portrait' },
  elements: [
    { type: 'player', id: 'player-1', x: 0.4, y: 0.5, colour: 'blue', label: '9' },
    { type: 'cone', id: 'cone-1', x: 0.6, y: 0.3, colour: 'orange' },
    { type: 'arrow', id: 'arrow-1', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8, arrow: 'pass' },
  ],
}

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
  sourceKey: '',
  createdAt: '2026-01-01',
  rights: 'internal_only',
}

const act: Activity = { phase: 'Skill', drillId: 'd1', duration: 15 }

const noop = () => {}

function render(
  expanded: boolean,
  opts: { readOnly?: boolean; busy?: boolean; drill?: Drill | null; diagram?: DrillDiagram | null } = {},
): string {
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
        // The real read only diagram node, not a stand-in, so the collapse and
        // coexistence assertions below are about the actual rendered SVG.
        // ActivityDiagramView is the hook free half, so no query client is
        // needed here; the screen's ActivityRow supplies the mounted half.
        expandedDiagram={<ActivityDiagramView diagram={opts.diagram ?? null} className="dd-in-panel" />}
        drillHref="/drill/d1"
        expanded={expanded}
        onToggle={noop}
        onRemove={noop}
        onRole={noop}
        onStandDown={noop}
        activities={[act]}
        onDur={noop}
        onPhase={noop}
        dragHandlers={{ onDragStart: noop, onDragEnter: noop, onDragEnd: noop, onDragOver: noop }}
        dragging={false}
        readOnly={opts.readOnly ?? false}
        busy={opts.busy ?? false}
      />
    </MemoryRouter>,
  )
}

// A helper that pulls every field control out of a markup string with its
// disabled state, so a freeze assertion can target the whole set at once.
function fieldControls(html: string): { tag: string; disabled: boolean }[] {
  return [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => ({
    tag: m[0],
    disabled: /\bdisabled\b/.test(m[0]),
  }))
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

  // ---- The saved Drill Maker diagram in the planner (DRILL-02) -----------

  it('shows the drill diagram in the panel once the card is expanded', () => {
    const html = render(true, { diagram })
    // The canonical renderer's own markers, so this proves the real component
    // drew it rather than something shaped like it.
    expect(html).toContain('data-el="player"')
    expect(html).toContain('data-el="cone"')
    expect(html).toContain('data-el="arrow"')
    expect(html).toContain('class="dd-surface dd-in-panel"')
    // Described in words for anyone who cannot see it.
    expect(html).toContain('role="img"')
    expect(html).toContain('Drill diagram: 1 player, 1 cone, 1 arrow')
  })

  it('draws no diagram while the card is collapsed', () => {
    // The read is lazy in the screen and the node is lazy here: a long session
    // full of diagrams costs nothing until a coach opens a panel.
    const html = render(false, { diagram })
    expect(html).not.toContain('data-el=')
    expect(html).not.toContain('dd-surface')
  })

  it('leaves a card with no diagram exactly as it was', () => {
    // Most drills carry none. An empty frame or a "no diagram" caption on every
    // card would be worse than silence.
    const html = render(true, { diagram: null })
    expect(html).not.toContain('dd-surface')
    expect(html).not.toContain('data-el=')
    // And the rest of the panel is untouched.
    expect(html).toContain('Keep the ball away from the defender.')
    expect(html).toContain('Open full drill')
  })

  it('shows the uploaded media and the drawn diagram together, neither replacing the other', () => {
    const html = render(true, { diagram })
    expect(html).toContain('media-preview')
    expect(html).toContain('data-el="player"')
  })

  it('keeps the diagram read only and out of the tab order', () => {
    const html = render(true, { diagram })
    const panel = html.slice(html.indexOf('act-panel'))
    const surface = panel.slice(panel.indexOf('dd-surface'), panel.indexOf('act-panel-summary'))
    // No control of any kind inside the diagram: the planner preview identifies
    // a drill, it does not edit one. Building a diagram stays in Drill Maker.
    expect(surface).not.toContain('<button')
    expect(surface).not.toContain('tabindex')
    expect(surface).not.toContain('onclick')
    expect(surface).not.toContain('contenteditable')
  })

  it('puts the diagram inside the panel and never inside the draggable card', () => {
    // .act-card is the drag source and is already full at phone width. A
    // diagram in there would both crowd the row and travel with the drag.
    const html = render(true, { diagram })
    const cardStart = html.indexOf('class="act-card"')
    const panelStart = html.indexOf('class="act-panel"')
    const surfaceAt = html.indexOf('dd-surface')
    expect(cardStart).toBeGreaterThanOrEqual(0)
    expect(panelStart).toBeGreaterThan(cardStart)
    expect(surfaceAt).toBeGreaterThan(panelStart)
  })

  it('keeps the row draggable and its controls live with a diagram on screen', () => {
    // Reordering and editing must survive the new block. The row stays
    // draggable and every field control stays enabled.
    const html = render(true, { diagram })
    expect(html).toContain('draggable="true"')
    for (const c of fieldControls(html)) expect(c.disabled).toBe(false)
  })

  it('keeps expanding a diagram live while a save is in flight', () => {
    // Viewing is passive. The busy freeze is for edits, and a coach checking
    // the shape of a drill mid-save is not editing anything.
    const html = render(true, { busy: true, diagram })
    expect(html).toContain('data-el="player"')
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

  it('freezes the phase, duration, remove and drag controls while a write is pending', () => {
    // busy is the editor's flag while a Save or Start is in flight. The row's
    // editing controls all change the draft, so they disable; the remove
    // control stays present (unlike read-only) but disabled, ready to work
    // again once the write settles.
    const html = render(false, { busy: true })
    // The phase select and the duration input are both frozen.
    for (const f of fieldControls(html)) {
      expect(f.disabled).toBe(true)
    }
    // The remove control is present but disabled.
    expect(html).toContain('aria-label="Remove activity"')
    expect(/<button class="act-x"[^>]*disabled/.test(html)).toBe(true)
    // The card is no longer draggable while frozen.
    expect(html).toContain('draggable="false"')
    expect(html).not.toContain('draggable="true"')
  })

  it('leaves the row editable again once the write settles', () => {
    // busy back to false is the post-failure (or idle) state: every editing
    // control is live so the coach can adjust and retry.
    const html = render(false, { busy: false })
    for (const f of fieldControls(html)) {
      expect(f.disabled).toBe(false)
    }
    expect(/<button class="act-x"[^>]*disabled/.test(html)).toBe(false)
    expect(html).toContain('draggable="true"')
  })

  it('keeps expand and collapse live while a write is pending (passive viewing)', () => {
    // Expanding a drill to read its detail changes nothing about the draft, so
    // the toggle stays interactive even while busy.
    const html = render(true, { busy: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Open your body')
    // The toggle button itself is not disabled (attribute order in the static
    // markup puts type before class, so match the whole opening tag).
    const toggleTag = html.match(/<button\b[^>]*class="ac-toggle"[^>]*>/)?.[0] ?? ''
    expect(toggleTag).toContain('aria-expanded="true"')
    expect(toggleTag).not.toContain('disabled')
  })

  it('freezes the Open full drill navigation while a write is pending', () => {
    // Reading the detail is passive, but the link OUT to the full drill leaves
    // the planner and would abandon the draft, so it becomes a disabled button
    // with no navigable href while busy.
    const busyHtml = render(true, { busy: true })
    expect(busyHtml).toContain('Open full drill')
    expect(busyHtml).not.toContain('href="/drill/d1"')
    // Idle (and read-only, who are never busy) keep the live link.
    const idleHtml = render(true, { busy: false })
    expect(idleHtml).toContain('href="/drill/d1"')
  })
})

// The action card pulled out as a presentational component, so the static
// renderer covers the pending labels, the disabled states and the accessible
// failure note. The editor's awaited submit flow itself is covered in
// src/lib/sessionSubmit.test.ts; these tests pin what the coach sees in each
// submit state.
const noShareFeedback: ShareFeedback = { role: null, message: '' }

function renderActions(over: Partial<Parameters<typeof PlannerActionsView>[0]> = {}): string {
  return renderToStaticMarkup(
    <PlannerActionsView
      readOnly={false}
      isExisting
      canStart
      pending={null}
      failed={null}
      shareLabel="Share"
      shareNote={SHARE_ACCOUNT_NOTE}
      shareFeedback={noShareFeedback}
      onStart={noop}
      onSave={noop}
      onShare={noop}
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
function buttons(html: string): { label: string; disabled: boolean; tag: string }[] {
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
    label: m[0].replace(/<[^>]+>/g, ''),
    disabled: m[0].includes('disabled'),
    tag: m[0].match(/<button[^>]*>/)?.[0] ?? m[0],
  }))
}

describe('PlannerActionsView', () => {
  it('offers Start, Save, Share and the secondary actions enabled when idle', () => {
    const all = buttons(renderActions())
    expect(all.map((b) => b.label)).toEqual([
      'Start session',
      'Session day',
      'Add to calendar',
      'Share',
      'Save session',
      'Load a template',
      'Delete session',
    ])
    expect(all.every((b) => !b.disabled)).toBe(true)
  })

  it('shows Saving… and freezes every side-card control while a save is in flight', () => {
    const html = renderActions({ pending: 'save' as PlannerAction })
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Saving…')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Start session')?.disabled).toBe(true)
    // The navigation and destructive controls that would abandon the draft
    // freeze too: Session day and Load a template navigate away, Delete opens a
    // destructive modal.
    expect(all.find((b) => b.label === 'Session day')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Load a template')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Delete session')?.disabled).toBe(true)
    // Add to calendar only exports the current draft, so it stays available.
    expect(all.find((b) => b.label === 'Add to calendar')?.disabled).toBe(false)
    expect(html).not.toContain('role="alert"')
  })

  it('shows Starting… and freezes the same controls while a start is in flight', () => {
    const all = buttons(renderActions({ pending: 'start' as PlannerAction }))
    expect(all.find((b) => b.label === 'Starting…')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Save session')?.disabled).toBe(true)
    // The freeze is driven by the shared pending flag, so a pending Start locks
    // the navigation and destructive controls exactly as a pending Save does.
    expect(all.find((b) => b.label === 'Session day')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Load a template')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Delete session')?.disabled).toBe(true)
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
    // Failure clears the pending flag, so the navigation and destructive
    // controls are live again for the coach to edit, retry or leave.
    expect(all.find((b) => b.label === 'Session day')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Load a template')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Delete session')?.disabled).toBe(false)
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

  it('hides Session day, calendar and delete for a session not yet saved, but keeps Share', () => {
    // A new draft still offers Share (as Save and share), which saves first.
    const labels = buttons(renderActions({ isExisting: false })).map((b) => b.label)
    expect(labels).toEqual(['Start session', 'Share', 'Save session', 'Load a template'])
  })
})

describe('PlannerActionsView share control', () => {
  it('offers a Share control with the account note, enabled and 44px when idle', () => {
    const html = renderActions()
    expect(html).toContain('min-height:44px')
    expect(html).toContain(SHARE_ACCOUNT_NOTE)
    const share = buttons(html).find((b) => b.label === 'Share')
    expect(share).toBeDefined()
    expect(share?.disabled).toBe(false)
  })

  it('renders the Save and share label for a new or dirty draft', () => {
    const html = renderActions({ shareLabel: 'Save and share' })
    expect(buttons(html).some((b) => b.label === 'Save and share')).toBe(true)
  })

  it('shows Saving… and freezes the Share control while a Save and share is in flight', () => {
    const all = buttons(renderActions({ pending: 'share' as PlannerAction, shareLabel: 'Save and share' }))
    const share = all.find((b) => b.label === 'Saving…')
    expect(share?.disabled).toBe(true)
    // The other actions freeze on the shared pending flag too.
    expect(all.find((b) => b.label === 'Start session')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Save session')?.disabled).toBe(true)
  })

  it('announces a copy or share success through role="status"', () => {
    const html = renderActions({ shareFeedback: { role: 'status', message: 'Link copied' } })
    expect(html).toContain('role="status"')
    expect(html).toContain('Link copied')
  })

  it('words a failed Save and share as a save failure with a retry', () => {
    const html = renderActions({ failed: 'share' as PlannerAction })
    expect(html).toContain('role="alert"')
    expect(html).toContain('the link wasn&#x27;t shared')
    expect(html).toContain('Retry')
    // Calm wording only; no raw error internals.
    expect(html).not.toMatch(/supabase|postgres|fetch/i)
    // The message matches the shared constant.
    expect(SESSION_SHARE_ERROR).toContain("wasn't shared")
  })

  it('keeps the Share control for a read-only viewer, who shares with no write', () => {
    const html = renderActions({ readOnly: true })
    expect(buttons(html).some((b) => b.label === 'Share')).toBe(true)
    // A viewer still has no Save or Delete affordance.
    expect(html).not.toContain('Save session')
    expect(html).not.toContain('Delete session')
  })
})

// SessionFieldsView is the planner's session details card pulled out as a
// presentational component. busy is the editor's flag while a Save or Start is
// in flight; every field here edits the draft, so busy must freeze the lot
// without unmounting them (a failure re-enables them for a retry). readOnly is
// the separate viewer state, unchanged by this work.
const teams: Team[] = [
  { id: 't1', name: 'Titans', bibColour: null, sortOrder: null },
  { id: 't2', name: 'Trojans', bibColour: null, sortOrder: null },
]
const venues: Venue[] = [
  { id: 'v1', name: 'Springmill 3G' },
  { id: 'v2', name: 'Ossett Academy' },
]

function sessionFixture(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Monday training',
    date: '2026-06-10',
    time: '17:30',
    ageGroup: 'U8s',
    venue: 'Springmill 3G',
    focus: 'Passing',
    status: 'upcoming',
    activities: [{ phase: 'Skill', drillId: 'd1', duration: 15 }],
    teamIds: [],
    venueId: null,
    coachId: 'coach1',
    teamId: 't1',
    intentions: ['Play out from the back'],
    space: 'Third of a pitch',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    spondEventId: null,
    boardId: 'b1',
    rights: 'internal_only',
    ...over,
  }
}

function renderFields(over: Partial<Parameters<typeof SessionFieldsView>[0]> = {}): string {
  return renderToStaticMarkup(
    <SessionFieldsView
      session={sessionFixture()}
      readOnly={false}
      busy={false}
      teams={teams}
      venues={venues}
      venuesUnavailable={false}
      attachedBoardName="4-3-3 shape"
      onField={noop}
      onIntentions={noop}
      onVenue={noop}
      onToggleTeam={noop}
      onAllTeams={noop}
      onRemoveBoard={noop}
      onOpenBoardPicker={noop}
      {...over}
    />,
  )
}

describe('SessionFieldsView', () => {
  it('freezes every session field, the intentions input and the board controls while a write is pending', () => {
    const html = renderFields({ busy: true })
    const controls = fieldControls(html)
    // Name, date, time, age group, focus, venue, space, the intentions input
    // and the source link: every field control is present and disabled.
    expect(controls.length).toBeGreaterThanOrEqual(9)
    expect(controls.every((c) => c.disabled)).toBe(true)
    // The covered teams chips edit the draft too, so they freeze with it.
    expect(buttons(html).find((b) => b.label === 'Titans')?.disabled).toBe(true)
    expect(buttons(html).find((b) => b.label === 'All teams')?.disabled).toBe(true)
    // The tactics board Change and Remove controls edit the draft too.
    expect(buttons(html).find((b) => b.label === 'Change')?.disabled).toBe(true)
    const removeBoardTag = html.match(/<button\b[^>]*aria-label="Remove board"[^>]*>/)?.[0] ?? ''
    expect(removeBoardTag).toContain('disabled')
    // Removing an intention edits the draft, so its remove control freezes.
    const removeIntentTag = html.match(/<button\b[^>]*aria-label="Remove Play out from the back"[^>]*>/)?.[0] ?? ''
    expect(removeIntentTag).toContain('disabled')
  })

  it('keeps every field editable when idle, so a coach can edit and retry after a failure', () => {
    const html = renderFields({ busy: false })
    const controls = fieldControls(html)
    expect(controls.length).toBeGreaterThanOrEqual(9)
    expect(controls.every((c) => !c.disabled)).toBe(true)
    expect(buttons(html).find((b) => b.label === 'Titans')?.disabled).toBe(false)
    expect(buttons(html).find((b) => b.label === 'Change')?.disabled).toBe(false)
    const removeBoardTag = html.match(/<button\b[^>]*aria-label="Remove board"[^>]*>/)?.[0] ?? ''
    expect(removeBoardTag).not.toContain('disabled')
  })

  it('renders a read-only viewer unchanged: disabled fields, pill intentions, no board controls', () => {
    const html = renderFields({ readOnly: true })
    // The base fields stay disabled exactly as a viewer always saw them.
    expect(fieldControls(html).every((c) => c.disabled)).toBe(true)
    // Intentions render as read-only pills, not an editable list input.
    expect(html).toContain('Play out from the back')
    expect(html).not.toContain('Type an intention and press enter')
    // No edit affordances on the board for a viewer.
    expect(html).not.toContain('>Change<')
    expect(html).not.toContain('aria-label="Remove board"')
    expect(html).toContain('4-3-3 shape')
  })

  it('offers the club venues rather than free text, keeping the old typed value visible', () => {
    const html = renderFields()
    expect(html).toContain('Springmill 3G')
    expect(html).toContain('Ossett Academy')
    // A session saved before venues existed shows what was typed, so the
    // information is not lost while nobody has picked a real venue yet.
    expect(html).toContain('Previously typed as')
  })

  it('drops the legacy note once a real venue is chosen', () => {
    const html = renderFields({ session: sessionFixture({ venueId: 'v1' }) })
    expect(html).not.toContain('Previously typed as')
  })

  it('says where venues come from when the club has none', () => {
    expect(renderFields({ venues: [] })).toContain('Admin, Venues')
  })
})

describe('CoveredTeamsField', () => {
  function renderCover(over: Partial<Parameters<typeof CoveredTeamsField>[0]> = {}): string {
    return renderToStaticMarkup(
      <CoveredTeamsField
        teams={teams}
        selected={['t1']}
        disabled={false}
        readOnly={false}
        onToggle={noop}
        onAll={noop}
        {...over}
      />,
    )
  }

  it('shows a chip per team with the covered ones pressed', () => {
    const html = renderCover()
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Titans')?.tag).toContain('aria-pressed="true"')
    expect(all.find((b) => b.label === 'Trojans')?.tag).toContain('aria-pressed="false"')
    expect(all.find((b) => b.label === 'All teams')?.tag).toContain('aria-pressed="false"')
  })

  it('presses All teams only when every team is covered', () => {
    const html = renderCover({ selected: ['t1', 't2'] })
    expect(buttons(html).find((b) => b.label === 'All teams')?.tag).toContain('aria-pressed="true"')
  })

  it('warns rather than pretending an empty selection means the whole club', () => {
    // The failure this guards: absence read as "everyone", which would put
    // every child in the club on a register meant for one team.
    expect(renderCover({ selected: [] })).toContain('the register will list nobody')
  })

  it('renders a viewer the covered names with nothing to press', () => {
    const html = renderCover({ readOnly: true })
    expect(html).toContain('Titans')
    expect(html).not.toContain('<button')
  })

  it('names a whole club session as All teams for a viewer', () => {
    expect(renderCover({ readOnly: true, selected: ['t1', 't2'] })).toContain('All teams')
  })

  it('tells a viewer when coverage was never set', () => {
    expect(renderCover({ readOnly: true, selected: [] })).toContain('Not set')
  })

  it('is reachable with a thumb: every chip meets the 44px target', () => {
    const html = renderCover()
    for (const b of buttons(html)) expect(b.tag).toContain('min-height:44px')
  })
})

describe('PlannerHeaderView', () => {
  function renderHeader(over: Partial<Parameters<typeof PlannerHeaderView>[0]> = {}): string {
    return renderToStaticMarkup(
      <PlannerHeaderView readOnly={false} isExisting busy={false} ownerName={undefined} onBack={noop} {...over} />,
    )
  }

  it('freezes the back link to the sessions list while a write is pending', () => {
    const all = buttons(renderHeader({ busy: true }))
    expect(all.find((b) => b.label === 'Sessions')?.disabled).toBe(true)
  })

  it('keeps the back link live when idle', () => {
    const all = buttons(renderHeader({ busy: false }))
    expect(all.find((b) => b.label === 'Sessions')?.disabled).toBe(false)
  })

  it('keeps the back link live for a read-only viewer, who starts no write', () => {
    const html = renderHeader({ readOnly: true, busy: false, ownerName: 'Sam Coach' })
    expect(html).toContain('View session')
    // The apostrophe is HTML-escaped in the static markup, as elsewhere.
    expect(html).toContain('Sam Coach&#x27;s session')
    expect(buttons(html).find((b) => b.label === 'Sessions')?.disabled).toBe(false)
  })

  it('titles a new plan, an edit and a view distinctly', () => {
    expect(renderHeader({ isExisting: false })).toContain('Plan a session')
    expect(renderHeader({ isExisting: true })).toContain('Edit session')
    expect(renderHeader({ readOnly: true })).toContain('View session')
  })
})

describe('AddActivityBar', () => {
  function renderBar(busy: boolean): string {
    return renderToStaticMarkup(<AddActivityBar busy={busy} onAddLibrary={noop} onAddCustom={noop} />)
  }

  it('freezes both add controls while a write is pending', () => {
    const all = buttons(renderBar(true))
    expect(all.find((b) => b.label === 'Add from library')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Add custom')?.disabled).toBe(true)
  })

  it('leaves both add controls live when idle', () => {
    const all = buttons(renderBar(false))
    expect(all.find((b) => b.label === 'Add from library')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Add custom')?.disabled).toBe(false)
  })
})

describe('PlannerWorkspace', () => {
  function renderWorkspace(busy: boolean): string {
    return renderToStaticMarkup(
      <PlannerWorkspace busy={busy}>
        <span>content</span>
      </PlannerWorkspace>,
    )
  }

  it('marks the working region aria-busy while a write is pending', () => {
    const html = renderWorkspace(true)
    expect(html).toContain('class="planner"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('content')
  })

  it('clears aria-busy once the write settles, so the failure alert still announces', () => {
    // The editor clears the pending flag before mounting the alert, so the
    // region is not aria-busy when the alert appears.
    expect(renderWorkspace(false)).toContain('aria-busy="false"')
  })
})

// The "min total" headline the coach reads while standing a station down. It
// was an inline reduce of its own until this slice, which made it a fourth
// answer to how long a session runs and the one most likely to disagree,
// because it is the number changing under the coach's finger. It reads the
// shared seam now, and these render the real card to prove it.
describe('the planner total', () => {
  const headline = (html: string): number => Number(html.match(/<span class="big">(\d+)<\/span>/)?.[1])

  it('shows the plain sum of a plan with nothing stood down', () => {
    const html = renderFields({
      session: sessionFixture({
        activities: [
          { phase: 'Warm-Up', duration: 10 },
          { phase: 'Skill', drillId: 'd1', duration: 20 },
          { phase: 'Game', drillId: 'd2', duration: 15 },
        ],
      }),
    })
    expect(headline(html)).toBe(45)
    expect(html).toContain('min total')
  })

  it('is unchanged by declaring the stations and the games phase', () => {
    const html = renderFields({
      session: sessionFixture({
        activities: [
          { phase: 'Warm-Up', duration: 10, slot: 'station' },
          { phase: 'Skill', drillId: 'd1', duration: 20, slot: 'station' },
          { phase: 'Game', drillId: 'd2', duration: 15, slot: 'game' },
        ],
      }),
    })
    expect(headline(html)).toBe(45)
  })

  it('falls by exactly the stood-down station, and the row stays in the plan', () => {
    const activities: Activity[] = [
      { phase: 'Warm-Up', duration: 10, slot: 'station' },
      { phase: 'Skill', drillId: 'd1', duration: 20, slot: 'station', skipped: true },
      { phase: 'Game', drillId: 'd2', duration: 15, slot: 'game' },
    ]
    const html = renderFields({ session: sessionFixture({ activities }) })
    expect(headline(html)).toBe(25)
    // Nothing is deleted: the card still counts three activities.
    expect(html).toContain('3 activities')
  })

  it('keeps a stray skipped on an activity carrying no slot', () => {
    const html = renderFields({
      session: sessionFixture({
        activities: [
          { phase: 'Warm-Up', duration: 10, skipped: true },
          { phase: 'Game', drillId: 'd2', duration: 15, slot: 'game' },
        ],
      }),
    })
    expect(headline(html)).toBe(25)
  })

  it('shows zero, not a fallback, when every operational activity is stood down', () => {
    const html = renderFields({
      session: sessionFixture({
        activities: [
          { phase: 'Skill', drillId: 'd1', duration: 20, slot: 'station', skipped: true },
          { phase: 'Game', drillId: 'd2', duration: 15, slot: 'game', skipped: true },
        ],
      }),
    })
    expect(headline(html)).toBe(0)
  })

  it('agrees with the shared seam on every one of those plans', () => {
    // The point of the change: the headline is not its own arithmetic.
    const plans: Activity[][] = [
      [{ phase: 'Skill', duration: 20 }],
      [{ phase: 'Skill', duration: 20, slot: 'station' }],
      [
        { phase: 'Skill', duration: 20, slot: 'station', skipped: true },
        { phase: 'Game', duration: 15, slot: 'game' },
      ],
      [{ phase: 'Warm-Up', duration: 10, skipped: true }],
      [],
    ]
    for (const activities of plans) {
      const html = renderFields({ session: sessionFixture({ activities }) })
      expect(headline(html)).toBe(sessionMinutes({ activities }))
    }
  })
})
