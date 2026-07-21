import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  ActivityCardView,
  AddActivityBar,
  PlannerActionsView,
  PlannerHeaderView,
  PlannerWorkspace,
  SessionFieldsView,
} from './Planner'
import type { PlannerAction } from '../lib/sessionSubmit'
import { SESSION_SHARE_ERROR } from '../lib/sessionSubmit'
import { SHARE_ACCOUNT_NOTE, type ShareFeedback } from '../lib/share'
import type { Activity, Drill, Session, Team } from '../lib/data'

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

function render(expanded: boolean, opts: { readOnly?: boolean; busy?: boolean; drill?: Drill | null } = {}): string {
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
function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
    label: m[0].replace(/<[^>]+>/g, ''),
    disabled: m[0].includes('disabled'),
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
  { id: 't1', name: 'Titans' },
  { id: 't2', name: 'Trojans' },
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
      attachedBoardName="4-3-3 shape"
      onField={noop}
      onIntentions={noop}
      onTeam={noop}
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
    // Name, date, time, age group, venue, team, focus, space, the intentions
    // input and the source link: every field control is present and disabled.
    expect(controls.length).toBeGreaterThanOrEqual(10)
    expect(controls.every((c) => c.disabled)).toBe(true)
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
    expect(controls.length).toBeGreaterThanOrEqual(10)
    expect(controls.every((c) => !c.disabled)).toBe(true)
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
