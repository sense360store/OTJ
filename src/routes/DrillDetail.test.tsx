import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddToSessionView } from './DrillDetail'
import type { Drill, Session } from '../lib/data'

// AddToSessionView is the Add to session modal body pulled out as a
// presentational component, so the static renderer can prove that while the
// write is in flight the surface is not dismissible (the X is disabled through
// Modal) and every control that shapes the write is frozen, then re-enabled
// with the choices intact after a failure. The Escape and overlay routes are
// proven at the Modal contract level in ui.test.tsx.

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
  equipment: ['Cones'],
  mediaId: null,
  summary: 'Keep the ball.',
  points: [],
  tags: ['rondo'],
  setupNotes: '',
  easier: [],
  harder: [],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  createdAt: '2026-01-01',
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Monday training',
    date: '2026-06-10',
    time: '17:30',
    ageGroup: 'U8s',
    venue: 'Springmill 3G',
    focus: 'Passing',
    status: 'upcoming',
    activities: [],
    coachId: 'coach1',
    teamId: null,
    intentions: [],
    space: '',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    spondEventId: null,
    boardId: null,
    ...over,
  }
}

const noop = () => {}

function renderView(over: Partial<Parameters<typeof AddToSessionView>[0]> = {}): string {
  return renderToStaticMarkup(
    <AddToSessionView
      drill={drill}
      sessions={[session({ id: 's1', name: 'Monday' }), session({ id: 's2', name: 'Tuesday' })]}
      target="s1"
      phase="Skill"
      adding={false}
      failed={false}
      onClose={noop}
      onTarget={noop}
      onPhase={noop}
      onAdd={noop}
      {...over}
    />,
  )
}

function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
    label: m[0].replace(/<[^>]+>/g, '').trim(),
    disabled: m[0].includes('disabled'),
  }))
}

describe('AddToSessionView freeze', () => {
  it('freezes the session choice, the phase, Cancel, Add and the X while adding', () => {
    const html = renderView({ adding: true })
    // The session select is frozen.
    expect(/<select[^>]*disabled/.test(html)).toBe(true)
    // Every button in the surface is disabled: the four phase chips, Cancel,
    // the Adding… button and the close X.
    const all = buttons(html)
    expect(all.length).toBeGreaterThanOrEqual(7)
    expect(all.every((b) => b.disabled)).toBe(true)
    expect(all.some((b) => b.label === 'Adding…')).toBe(true)
    // The X (icon-btn) is disabled, so Escape/overlay/X cannot dismiss it.
    expect(/<button class="icon-btn"[^>]*disabled/.test(html)).toBe(true)
  })

  it('leaves every control live when idle', () => {
    const html = renderView({ adding: false })
    expect(/<select[^>]*disabled/.test(html)).toBe(false)
    expect(buttons(html).every((b) => !b.disabled)).toBe(true)
    expect(/<button class="icon-btn"[^>]*disabled/.test(html)).toBe(false)
  })

  it('re-enables the controls after a failure with the choices intact', () => {
    const html = renderView({ adding: false, failed: true, target: 's2', phase: 'Game' })
    // The calm error shows.
    expect(html).toContain('role="alert"')
    expect(html).toContain('We couldn&#x27;t add the drill to that session')
    // The choices survive the failure: SSR marks the chosen option selected
    // (a controlled select's value stamps selected on its option, not a value
    // attribute on the select), and the Game phase chip is on.
    expect(html).toContain('value="s2" selected')
    expect(html).toContain('chip on')
    // The controls are live again for a retry.
    expect(/<select[^>]*disabled/.test(html)).toBe(false)
    expect(buttons(html).every((b) => !b.disabled)).toBe(true)
  })
})
