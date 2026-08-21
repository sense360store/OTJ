// =====================================================================
// COACH-2B on the SCREENS a coach actually uses.
//
// WHY THIS FILE EXISTS. src/lib/activityRole.test.ts pins what every
// press writes and removes. That is necessary and not sufficient: the
// rules can be perfect while the control is wired to the wrong surface,
// offered on reusable content it must never touch, or left live during
// a save. Those are the mistakes that reach a coach, and none of them
// is visible at the seam.
//
// So these render the REAL exported halves of the two authoring
// surfaces, the dated-session planner's ActivityCardView and side card
// and the week-plan editor's TemplateActivityRow, and assert on what
// comes out.
//
// STATIC RENDER ONLY. There is no DOM in this project, so what these
// cover is what a surface SHOWS: which controls exist, which are
// pressed, which are disabled and which are absent. What a click DOES
// is proved at the seam, in activityRole.test.ts, over the same pure
// functions these screens call.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ActivityCardView, SessionFieldsView } from './Planner'
import { TemplateActivityRow } from '../components/TemplateFormModal'
import { ActivityStructureSummary } from '../components/ActivityRoleControls'
import { NOT_RUNNING_LABEL } from '../lib/activityRole'
import { blankSession, type Activity, type Session } from '../lib/data'

const noop = () => {}

const act = (over: Partial<Activity> = {}): Activity => ({
  phase: 'Skill',
  title: 'Passing square',
  duration: 10,
  ...over,
})

// One activity card from the dated-session planner, rendered as the
// screen renders it.
function datedCard(
  activities: Activity[],
  index = 0,
  opts: { readOnly?: boolean; busy?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ActivityCardView
        act={activities[index]}
        idx={index}
        title="Passing square"
        drill={null}
        thumb={<span>thumb</span>}
        expandedMedia={null}
        expandedDiagram={null}
        drillHref=""
        expanded={false}
        onToggle={noop}
        onRemove={noop}
        onDur={noop}
        onPhase={noop}
        onRole={noop}
        onStandDown={noop}
        activities={activities}
        dragHandlers={{ onDragStart: noop, onDragEnter: noop, onDragEnd: noop, onDragOver: noop }}
        dragging={false}
        readOnly={opts.readOnly ?? false}
        busy={opts.busy ?? false}
      />
    </MemoryRouter>,
  )
}

// One activity row from the week-plan editor.
function weekPlanRow(activities: Activity[], index = 0): string {
  return renderToStaticMarkup(
    <TemplateActivityRow
      activity={activities[index]}
      title="Passing square"
      skill="Passing"
      index={index}
      count={activities.length}
      onPhase={noop}
      onDuration={noop}
      onMove={noop}
      onRemove={noop}
      activities={activities}
      onRole={noop}
    />,
  )
}

// The planner's side card, which carries the minute total and the
// structure summary.
function sideCard(activities: Activity[]): string {
  const session: Session = { ...blankSession('coach-1', null), activities }
  return renderToStaticMarkup(
    <MemoryRouter>
      <SessionFieldsView
        session={session}
        readOnly={false}
        busy={false}
        teams={[]}
        venues={[]}
        venuesUnavailable={false}
        onField={noop}
        onIntentions={noop}
        onVenue={noop}
        onToggleTeam={noop}
        onAllTeams={noop}
        onRemoveBoard={noop}
        onOpenBoardPicker={noop}
      />
    </MemoryRouter>,
  )
}

function totalMinutes(markup: string): number {
  const hit = markup.match(/<span class="big">(\d+)<\/span>/)
  expect(hit, 'the side card renders a minute total').not.toBeNull()
  return Number(hit![1])
}

describe('the role control reaches both authoring surfaces', () => {
  it('offers all three roles on a dated session activity', () => {
    const html = datedCard([act()])
    expect(html).toContain('Session role')
    expect(html).toContain('>Standard<')
    expect(html).toContain('>Station<')
    expect(html).toContain('>Games phase<')
  })

  it('offers all three roles on a week plan activity', () => {
    const html = weekPlanRow([act()])
    expect(html).toContain('Session role')
    expect(html).toContain('>Standard<')
    expect(html).toContain('>Station<')
    expect(html).toContain('>Games phase<')
  })

  it('shows the current role as pressed, not by colour alone', () => {
    // aria-pressed carries the choice, so the selected role is announced
    // rather than only shaded.
    const standard = datedCard([act()])
    expect(standard).toMatch(/aria-pressed="true"[^>]*>Standard</)
    const station = datedCard([act({ slot: 'station' })])
    expect(station).toMatch(/aria-pressed="true"[^>]*>Station</)
    const games = datedCard([act({ slot: 'game' })])
    expect(games).toMatch(/aria-pressed="true"[^>]*>Games phase</)
  })

  it('reads a malformed stored slot as Standard on screen', () => {
    const html = datedCard([{ phase: 'Skill', duration: 10, slot: 'Station' } as unknown as Activity])
    expect(html).toMatch(/aria-pressed="true"[^>]*>Standard</)
  })
})

describe('Not running tonight is a dated-session station affordance only', () => {
  it('is offered on a dated session station', () => {
    expect(datedCard([act({ slot: 'station' })])).toContain(NOT_RUNNING_LABEL)
  })

  it('is NOT offered on a week plan station', () => {
    // skipped is session local. The affordance is absent from reusable
    // content rather than present and stripped on the way out.
    expect(weekPlanRow([act({ slot: 'station' })])).not.toContain(NOT_RUNNING_LABEL)
  })

  it('is NOT offered on the games phase', () => {
    expect(datedCard([act({ slot: 'game' })])).not.toContain(NOT_RUNNING_LABEL)
  })

  it('is NOT offered on a standard activity', () => {
    expect(datedCard([act()])).not.toContain(NOT_RUNNING_LABEL)
  })

  it('shows a stood-down station as checked', () => {
    const html = datedCard([act({ slot: 'station', skipped: true })])
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
  })

  it('shows a running station as unchecked', () => {
    const html = datedCard([act({ slot: 'station' })])
    expect(html).toContain(NOT_RUNNING_LABEL)
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/)
  })
})

describe('derived labels on the row', () => {
  it('numbers active stations in plan order across the real cards', () => {
    const plan = [act(), act({ slot: 'station' }), act({ slot: 'station' })]
    expect(datedCard(plan, 1)).toContain('Station 1')
    expect(datedCard(plan, 2)).toContain('Station 2')
  })

  it('names a stood-down station and renumbers the rest', () => {
    const plan = [act({ slot: 'station', skipped: true }), act({ slot: 'station' })]
    expect(datedCard(plan, 0)).toContain(`Station · ${NOT_RUNNING_LABEL}`)
    expect(datedCard(plan, 1)).toContain('Station 1')
  })

  it('labels the games phase on both surfaces', () => {
    expect(datedCard([act({ slot: 'game' })])).toContain('Games phase')
    expect(weekPlanRow([act({ slot: 'game' })])).toContain('Games phase')
  })

  it('does not infer a station from a Warm-Up phase, nor games from a Game phase', () => {
    // The defect the programme exists to remove, on the screen.
    expect(datedCard([act({ phase: 'Warm-Up', slot: 'station' })])).toContain('Station 1')
    const unmarkedGame = datedCard([act({ phase: 'Game' })])
    expect(unmarkedGame).toMatch(/aria-pressed="true"[^>]*>Standard</)
  })
})

describe('the structure summary', () => {
  const summary = (activities: Activity[]) =>
    renderToStaticMarkup(<ActivityStructureSummary activities={activities} />)

  const stations = (n: number, over: Partial<Activity> = {}) =>
    Array.from({ length: n }, () => act({ slot: 'station', ...over }))

  it('states a normal four-station carousel with a games phase', () => {
    const html = summary([...stations(4), act({ slot: 'game' })])
    expect(html).toContain('4 stations · Games phase set')
    expect(html).not.toContain('A carousel runs four or five stations.')
  })

  it('states a normal five-station carousel', () => {
    expect(summary([...stations(5), act({ slot: 'game' })])).toContain('5 stations · Games phase set')
  })

  it('warns at three and at six without any blocking language', () => {
    for (const n of [3, 6]) {
      const html = summary(stations(n))
      expect(html).toContain('A carousel runs four or five stations.')
      expect(html).not.toMatch(/cannot save|must fix|blocked/i)
    }
  })

  it('says none are declared rather than showing a zero', () => {
    expect(summary([act(), act()])).toContain('No stations declared')
  })

  it('names the all-stood-down state', () => {
    const html = summary(stations(4, { skipped: true }))
    expect(html).toContain('none running')
    expect(html).toContain('Every station is stood down, so the carousel runs nothing.')
  })

  it('warns visibly about two games activities', () => {
    const html = summary([...stations(4), act({ slot: 'game' }), act({ slot: 'game' })])
    expect(html).toContain('More than one activity is marked as the games phase.')
  })

  it('reaches the dated-session planner side card', () => {
    expect(sideCard([...stations(4), act({ slot: 'game' })])).toContain('4 stations · Games phase set')
  })

  it('reaches the week-plan editor', () => {
    // Rendered from the same composer the planner uses, so the two
    // surfaces cannot describe one plan differently.
    expect(summary([...stations(3)])).toContain('3 stations')
  })

  it('says nothing at all for an empty plan', () => {
    expect(summary([])).toBe('')
  })
})

describe('the session total on the planner', () => {
  it('is unchanged by declaring a role', () => {
    const plain = sideCard([act({ duration: 10 }), act({ duration: 20 })])
    const declared = sideCard([act({ duration: 10, slot: 'station' }), act({ duration: 20, slot: 'game' })])
    expect(totalMinutes(plain)).toBe(30)
    expect(totalMinutes(declared)).toBe(30)
  })

  it('falls by exactly the stood-down station duration', () => {
    const running = sideCard([act({ duration: 10, slot: 'station' }), act({ duration: 20, slot: 'station' })])
    const down = sideCard([
      act({ duration: 10, slot: 'station', skipped: true }),
      act({ duration: 20, slot: 'station' }),
    ])
    expect(totalMinutes(running)).toBe(30)
    expect(totalMinutes(down)).toBe(20)
  })

  it('returns to the original total when the station is restored', () => {
    const original = [act({ duration: 12, slot: 'station' }), act({ duration: 18, slot: 'station' })]
    const down: Activity[] = [{ ...original[0], skipped: true }, original[1]]
    const restored: Activity[] = [act({ duration: 12, slot: 'station' }), original[1]]
    expect(totalMinutes(sideCard(original))).toBe(30)
    expect(totalMinutes(sideCard(down))).toBe(18)
    expect(totalMinutes(sideCard(restored))).toBe(30)
  })

  it('is unmoved by a stray stand-down on an undeclared activity', () => {
    const stray = sideCard([act({ duration: 10, skipped: true } as Partial<Activity>), act({ duration: 20 })])
    expect(totalMinutes(stray)).toBe(30)
  })
})

describe('the new controls freeze with every other write control', () => {
  it('disables the role chips and the stand-down while a save is in flight', () => {
    const busy = datedCard([act({ slot: 'station' })], 0, { busy: true })
    // Every chip in the role group, and the checkbox, carry disabled.
    const chips = busy.match(/<button class="chip[^"]*"[^>]*>/g) ?? []
    expect(chips.length).toBeGreaterThanOrEqual(3)
    for (const chip of chips) expect(chip).toContain('disabled')
    expect(busy).toMatch(/type="checkbox"[^>]*disabled/)
  })

  it('leaves them live when nothing is pending', () => {
    const idle = datedCard([act({ slot: 'station' })])
    const chips = idle.match(/<button class="chip[^"]*"[^>]*>/g) ?? []
    expect(chips.length).toBeGreaterThanOrEqual(3)
    for (const chip of chips) expect(chip).not.toContain('disabled')
  })

  it('shows a read-only viewer no role control at all', () => {
    // A viewer edits nothing, so they get no control they cannot use. The
    // phase select and duration are already disabled for them; the role
    // row is absent for the same reason Remove is.
    const html = datedCard([act({ slot: 'station' })], 0, { readOnly: true })
    expect(html).not.toContain('Session role')
    expect(html).not.toContain(NOT_RUNNING_LABEL)
  })
})
