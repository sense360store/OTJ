import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeleteVenueModalView } from './AdminVenues'
import { BibColourField } from './AdminTeams'

const noop = () => {}

// The two admin surfaces Release A adds, rendered without a query client.
// What matters here is the copy on removal, which is the club's only
// warning about what happens to the sessions at a venue, and that a bib
// colour is chosen from the closed vocabulary rather than typed.

describe('DeleteVenueModalView', () => {
  it('says the sessions survive, unplaced', () => {
    const html = renderToStaticMarkup(
      <DeleteVenueModalView
        venue={{ id: 'v1', name: 'Springmill 3G' }}
        sessionCount={4}
        busy={false}
        failed={false}
        onCancel={noop}
        onConfirm={noop}
      />,
    )
    expect(html).toContain('Springmill 3G')
    expect(html).toContain('4 sessions are at this venue')
    expect(html).toContain('keep their date, plan and')
  })

  it('says the number is unknown rather than zero when the session list has not loaded', () => {
    const html = renderToStaticMarkup(
      <DeleteVenueModalView
        venue={{ id: 'v1', name: 'Springmill 3G' }}
        sessionCount={null}
        busy={false}
        failed={false}
        onCancel={noop}
        onConfirm={noop}
      />,
    )
    expect(html).toContain('not known here')
    expect(html).not.toContain('0 session')
  })

  it('agrees with itself about one session', () => {
    const html = renderToStaticMarkup(
      <DeleteVenueModalView
        venue={{ id: 'v1', name: 'Springmill 3G' }}
        sessionCount={1}
        busy={false}
        failed={false}
        onCancel={noop}
        onConfirm={noop}
      />,
    )
    expect(html).toContain('1 session is at this venue')
    expect(html).toContain('It keeps its')
  })

  it('freezes both controls while the removal is in flight', () => {
    const html = renderToStaticMarkup(
      <DeleteVenueModalView
        venue={{ id: 'v1', name: 'Springmill 3G' }}
        sessionCount={0}
        busy
        failed={false}
        onCancel={noop}
        onConfirm={noop}
      />,
    )
    expect(html).toContain('Removing…')
    // Cancel and Remove both freeze; the modal's own close control stays
    // live so a stuck write is never a trap.
    const all = [...html.matchAll(/<button[^>]*>.*?<\/button>/gs)].map((m) => ({
      label: m[0].replace(/<[^>]+>/g, ''),
      disabled: m[0].includes('disabled'),
    }))
    expect(all.find((b) => b.label === 'Cancel')?.disabled).toBe(true)
    expect(all.find((b) => b.label.includes('Removing'))?.disabled).toBe(true)
  })
})

describe('BibColourField', () => {
  it('offers the closed vocabulary and No bib, with a swatch for the current colour', () => {
    const html = renderToStaticMarkup(
      <BibColourField value="red" disabled={false} label="Default bib colour for Titans" onChange={noop} />,
    )
    // A real <label> bound to the control, read but not shown: in a list of
    // five teams the row's own name is what a sighted reader is reading, and
    // the label repeats it. VISUAL-02 moved this off aria-label, which is an
    // accessible name with no element behind it.
    expect(html).toMatch(/<label for="([^"]+)" class="sr-only">Default bib colour for Titans<\/label>/)
    const id = html.match(/<label for="([^"]+)" class="sr-only">/)?.[1]
    expect(html).toContain(`<select id="${id}"`)
    expect(html).toContain('value="red" selected')
    expect(html).toContain('>No bib<')
    // The colour's NAME is the information and the swatch is supplementary:
    // 2.16 keeps bib colour as colour, and keeps it paired with its word.
    expect(html).toContain('>Red<')
    expect(html).toContain('#e23b3b')
    expect(html).toContain('aria-hidden="true"')
    // No free text: a colour the app cannot render is not offerable.
    expect(html).not.toContain('<input')
  })

  it('shows no swatch when a team has no default bib', () => {
    const html = renderToStaticMarkup(
      <BibColourField value={null} disabled={false} label="Default bib colour for Trojans" onChange={noop} />,
    )
    expect(html).toContain('value="" selected')
    expect(html).not.toContain('bib-swatch')
  })

  it('takes the shared control height from the field primitive', () => {
    // It used to carry min-height: 44px inline. The height is .field select's
    // now (var(--control-h), which IS 44px), so what this pins is that the
    // control is on the shared treatment rather than on a literal of its own.
    // The rendered 44px is measured in a browser by tools/visual/checks.mjs,
    // which is the only place that can compute it.
    const html = renderToStaticMarkup(
      <BibColourField value={null} disabled={false} label="Default bib colour for Titans" onChange={noop} />,
    )
    expect(html).toContain('class="field field-flush bib-select"')
    expect(html).not.toMatch(/style="[^"]*height/)
  })
})
