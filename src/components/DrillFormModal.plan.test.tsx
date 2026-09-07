// =====================================================================
// COACH-11: the drill form in plan mode, and the Library form unchanged.
//
// Static renders with the data layer stubbed. What they pin is what a
// coach is OFFERED in each mode: plan mode leads with the four fields a
// plan needs and folds the rest under one disclosure, and its footer
// offers Add to plan and Save and draw it; the Library form is what it
// was before this slice, field for field, so nothing about creating a
// drill from the Library moved. The insert both modes share is proved
// by the same mutation stub receiving the same shape.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillFormModal } from './DrillFormModal'

const insertMutate = vi.fn()
vi.mock('../lib/queries', () => ({
  useInsertDrill: () => ({ mutate: insertMutate, isPending: false }),
  useUpdateDrill: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadMedia: () => ({ mutate: vi.fn(), isPending: false }),
  useMedia: () => ({ data: [], isLoading: false }),
  useMyCapabilities: () => ({ caps: new Set<string>(), isPending: false }),
  mediaTypeForFile: () => null,
  oversizeMessage: () => null,
}))
vi.mock('./RightsControl', () => ({ RightsControl: () => null, RightsNewNote: () => <span>rights-note</span> }))

const noop = () => {}

function planForm(over: { title?: string; replacing?: boolean } = {}): string {
  return renderToStaticMarkup(
    <DrillFormModal
      onClose={noop}
      plan={{
        preset: { title: over.title ?? '', phase: 'Game', duration: 12 },
        replacing: over.replacing ?? false,
        onCreated: noop,
      }}
    />,
  )
}

const libraryForm = () => renderToStaticMarkup(<DrillFormModal onClose={noop} />)

// The labels rendered as real <label> elements bound to a control.
const labels = (html: string) => [...html.matchAll(/<label[^>]*>([^<]*)<\/label>/g)].map((m) => m[1])

describe('plan mode', () => {
  it('leads with the four fields a plan needs, and folds the rest under one disclosure', () => {
    const html = planForm()
    const before = html.slice(0, html.indexOf('<details'))
    expect(labels(before)).toEqual(['Title', 'What it works on', 'Phase', 'Minutes'])
    // One native disclosure, closed, holding the long tail.
    expect(html.match(/<details class="form-more">/g)).toHaveLength(1)
    expect(html).not.toContain('<details class="form-more" open')
    expect(html).toContain('<summary>More details</summary>')
    const inside = html.slice(html.indexOf('<details'))
    for (const l of ['Corner', 'Skill', 'Level', 'Theme', 'Format', 'Ages', 'Players', 'Area', 'Setup notes', 'Equipment', 'Coaching points', 'Tags', 'Source link', 'Sharing', 'Media']) {
      expect(inside, l).toContain(`>${l}</label>`)
    }
    // The minutes field in front IS the drill's duration; there is no second one.
    expect(inside).not.toContain('Duration (min)')
  })

  it('starts from the preset: the phase and minutes the row had', () => {
    const html = planForm({ title: 'Arrival games' })
    expect(html).toMatch(/<input[^>]*value="Arrival games"/)
    expect(html).toMatch(/<option value="Game" selected="">Game<\/option>/)
    expect(html).toMatch(/<input[^>]*type="number"[^>]*value="12"/)
  })

  it('offers Add to plan and Save and draw it, disabled until there is a title', () => {
    const empty = planForm()
    expect(empty).toMatch(/<button type="button" class="btn btn-ghost" disabled=""[^>]*>[\s\S]*?Save and draw it/)
    expect(empty).toMatch(/<button type="button" class="btn btn-primary" disabled=""[^>]*>[\s\S]*?Add to plan/)
    const titled = planForm({ title: 'Rondo' })
    expect(titled).toMatch(/<button type="button" class="btn btn-ghost"(?! disabled)[^>]*>[\s\S]*?Save and draw it/)
    expect(titled).toMatch(/<button type="button" class="btn btn-primary"(?! disabled)[^>]*>[\s\S]*?Add to plan/)
    // And never the Library's own submit.
    expect(titled).not.toContain('>Add drill<')
    expect(titled).not.toContain('Add drill</button>')
  })

  it('says what the drill will do in the plan, and which plan action it is', () => {
    expect(planForm()).toContain('Goes into this plan, and into the club library.')
    expect(planForm({ replacing: true })).toContain('Takes the place of the custom activity, and joins the club library.')
    expect(planForm()).toContain('>New drill<')
  })

  it('binds every leading field to its label, so a screen reader names what a coach fills in', () => {
    const html = planForm()
    for (const m of html.matchAll(/<label for="([^"]+)"/g)) {
      expect(html, m[1]).toContain(`id="${m[1]}"`)
    }
  })
})

describe('the Library form is unchanged', () => {
  it('keeps every field in the open, in the order it always had, with its own submit', () => {
    const html = libraryForm()
    expect(html).not.toContain('<details')
    expect(html).not.toContain('More details')
    expect(labels(html).slice(0, 4)).toEqual(['Title', 'Summary', 'Corner', 'Skill'])
    expect(html).toContain('Duration (min)')
    expect(html).toContain('Add drill')
    expect(html).not.toContain('Add to plan')
    expect(html).not.toContain('Save and draw it')
    expect(html).not.toContain('>Phase</label>')
    expect(html).toContain('Add a drill to the club library.')
  })
})
