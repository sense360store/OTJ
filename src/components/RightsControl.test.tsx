import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RightsFieldView, RightsNewNote } from './RightsControl'
import { FA_LOCK_NOTE, rightsControlState } from '../lib/contentRights'

const noop = () => {}

function render(
  over: Partial<Parameters<typeof RightsFieldView>[0]> = {},
  state = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: true }),
): string {
  return renderToStaticMarkup(
    <RightsFieldView
      noun="programme"
      state={state}
      selected="internal_only"
      confirmed={false}
      saving={false}
      saved={false}
      onSelect={noop}
      onConfirm={noop}
      onSave={noop}
      {...over}
      {...(over.state ? {} : { state })}
    />,
  )
}

describe('the sharing level control', () => {
  it('offers the three levels in the club’s words, never an enum name', () => {
    const html = render()
    expect(html).toContain('Club only')
    expect(html).toContain('Public text only')
    expect(html).toContain('Public, including files')
    expect(html).not.toContain('internal_only<')
    expect(html).not.toContain('public_full<')
  })

  it('states the stored level plainly', () => {
    expect(render()).toContain('This programme is set to club only.')
  })

  it('starts on the stored level, so opening the control promotes nothing', () => {
    const html = render()
    // Exactly one radio is checked, and it is the club only one.
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1)
    expect(html).toMatch(/id="rights-internal_only"[^>]*checked/)
  })

  it('requires an explicit save: the control never writes on selection alone', () => {
    expect(render()).toContain('Save sharing level')
  })

  it('disables the save until something actually changes', () => {
    const html = render({ selected: 'internal_only' })
    expect(html).toMatch(/Save sharing level/)
    expect(html).toContain('disabled=""')
  })

  it('enables the save once a different level is chosen', () => {
    const html = render({ selected: 'public_full' })
    // The save button carries no disabled attribute in this state.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Save sharing level/)
  })

  it('keeps every option and the save at a 44px target', () => {
    const html = render()
    expect((html.match(/min-height:44px/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('associates every label with its own control', () => {
    const html = render()
    for (const value of ['internal_only', 'public_link_only', 'public_full']) {
      expect(html).toContain(`for="rights-${value}"`)
      expect(html).toContain(`id="rights-${value}"`)
    }
  })

  it('announces a save through a live region', () => {
    expect(render({ saved: true })).toContain('role="status"')
    expect(render({ saved: true })).toContain('Sharing level saved')
  })
})

describe('England Football content', () => {
  const locked = rightsControlState({ current: 'internal_only', provenance: 'fa', canEdit: true })
  const html = render({}, locked)

  it('renders locked, with the reason, rather than a control the server will refuse', () => {
    expect(html).toContain(FA_LOCK_NOTE)
    expect(html).not.toContain('Save sharing level')
    expect(html).not.toContain('type="radio"')
  })

  it('says the club may still use it, so the lock does not read as a fault', () => {
    expect(html).toContain('coaching')
  })
})

describe('content with another recorded source', () => {
  const state = rightsControlState({ current: 'internal_only', provenance: 'third_party', canEdit: true })

  it('asks for an explicit confirmation before a public level is saved', () => {
    const html = render({ selected: 'public_full' }, state)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Confirm the club may publish it')
  })

  it('asks for nothing when the choice is club only', () => {
    const html = render({ selected: 'internal_only' }, state)
    expect(html).not.toContain('type="checkbox"')
  })
})

describe('a file', () => {
  it('always asks for the confirmation, whatever its recorded source says', () => {
    const state = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: true, isMedia: true })
    const html = render({ selected: 'public_full', noun: 'file' }, state)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('cleared to publish it')
  })
})

describe('someone who does not own the content', () => {
  const state = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: false })
  const html = render({}, state)

  it('sees the level but no way to change it', () => {
    expect(html).toContain('This programme is set to club only.')
    expect(html).not.toContain('Save sharing level')
    expect(html).toContain('Only the person who created this')
  })

  it('has every radio disabled, not merely visually inert', () => {
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('a new, unsaved item', () => {
  it('says plainly that it starts as club only rather than showing a control that would be dropped', () => {
    const html = renderToStaticMarkup(<RightsNewNote noun="drill" />)
    expect(html).toContain('A new drill starts as club only')
    expect(html).toContain('after saving')
  })
})
