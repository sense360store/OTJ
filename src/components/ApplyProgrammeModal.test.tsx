import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApplyProgrammeFormView } from './ApplyProgrammeModal'
import type { ApplyWeekRow } from './ApplyProgrammeModal'
import type { Team } from '../lib/data'

// ApplyProgrammeFormView is the Apply to team form pulled out as a presentational
// component, so the static renderer can prove that while the sessions are being
// created the surface is not dismissible (the X is disabled through Modal;
// Escape and overlay are proven inert in ui.test.tsx) and every input that
// shapes the write is disabled, then re-enabled with the entries intact on
// failure. The container owns the date arithmetic and the write loop.

const teams: Team[] = [{ id: 't1', name: 'Titans' }]
const weekRows: ApplyWeekRow[] = [
  { week: 1, templateName: 'Week 1: Passing', date: '2026-09-07', clash: false },
  { week: 2, templateName: 'Week 2: Shooting', date: '2026-09-14', clash: true },
]
const noop = () => {}

function render(over: Partial<Parameters<typeof ApplyProgrammeFormView>[0]> = {}): string {
  return renderToStaticMarkup(
    <ApplyProgrammeFormView
      sub="Autumn programme"
      saving={false}
      plannableCount={2}
      teams={teams}
      teamId="t1"
      onTeamId={noop}
      ageGroup="U8s"
      onAgeGroup={noop}
      startDate="2026-09-07"
      onStartDate={noop}
      weekday={1}
      onWeekday={noop}
      time="17:30"
      onTime={noop}
      venue="Springmill 3G"
      onVenue={noop}
      weekRows={weekRows}
      teamName="Titans"
      onWeekDate={noop}
      error={null}
      onClose={noop}
      onConfirm={noop}
      {...over}
    />,
  )
}

function fieldControls(html: string): { disabled: boolean }[] {
  return [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => ({ disabled: /\bdisabled\b/.test(m[0]) }))
}

function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
    label: m[0].replace(/<[^>]+>/g, '').trim(),
    disabled: m[0].includes('disabled'),
  }))
}

describe('ApplyProgrammeFormView freeze', () => {
  it('freezes every input and the dismissal while the sessions are being created', () => {
    const html = render({ saving: true })
    // team, age, start date, weekday, time, venue, and one date input per
    // templated week: every field control disabled.
    const controls = fieldControls(html)
    expect(controls.length).toBeGreaterThanOrEqual(8)
    expect(controls.every((c) => c.disabled)).toBe(true)
    // Not dismissible: the X is disabled.
    expect(/<button class="icon-btn"[^>]*disabled/.test(html)).toBe(true)
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Cancel')?.disabled).toBe(true)
    expect(all.find((b) => b.label === 'Creating…')?.disabled).toBe(true)
  })

  it('leaves every input live when idle, with Create ready once a team is picked', () => {
    const html = render({ saving: false })
    expect(fieldControls(html).every((c) => !c.disabled)).toBe(true)
    expect(/<button class="icon-btn"[^>]*disabled/.test(html)).toBe(false)
    const all = buttons(html)
    expect(all.find((b) => b.label === 'Cancel')?.disabled).toBe(false)
    expect(all.find((b) => b.label === 'Create 2 sessions')?.disabled).toBe(false)
  })

  it('holds Create closed until a team is chosen', () => {
    const all = buttons(render({ teamId: '' }))
    expect(all.find((b) => b.label === 'Create 2 sessions')?.disabled).toBe(true)
  })

  it('shows a calm error and keeps the entries editable for a retry', () => {
    const html = render({ error: "We couldn't create all the sessions. Check your connection and try again." })
    expect(html).toContain('We couldn&#x27;t create all the sessions')
    expect(fieldControls(html).every((c) => !c.disabled)).toBe(true)
  })
})
