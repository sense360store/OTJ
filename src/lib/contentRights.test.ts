import { describe, expect, it } from 'vitest'
import {
  canSaveRights,
  deriveProvenance,
  FA_LOCK_NOTE,
  MEDIA_CONFIRM,
  RIGHTS_NOUN,
  RIGHTS_OPTIONS,
  rightsControlState,
  rightsLabel,
  rightsStatusLine,
  THIRD_PARTY_CONFIRM,
} from './contentRights'

const FA = 'https://learn.englandfootball.com/resources/session/abc'
const FA_CDN = 'https://cdn.englandfootball.com/img/a.png'

describe('deriveProvenance', () => {
  it('reads England Football provenance from either host', () => {
    expect(deriveProvenance({ sourceUrl: FA })).toBe('fa')
    expect(deriveProvenance({ sourceUrl: FA_CDN })).toBe('fa')
  })

  it('reads it from a drill source key, which begins with the England Football URL', () => {
    expect(deriveProvenance({ sourceKey: `${FA}#activity-2` })).toBe('fa')
  })

  it('reads it from the England Football Learning label alone', () => {
    expect(deriveProvenance({ sourceLabel: 'England Football Learning' })).toBe('fa')
  })

  it('treats any other recorded source as third party, not England Football', () => {
    expect(deriveProvenance({ sourceUrl: 'https://example.com/x' })).toBe('third_party')
    expect(deriveProvenance({ sourceLabel: 'A coaching book' })).toBe('third_party')
  })

  it('treats no recorded source as club original', () => {
    expect(deriveProvenance({})).toBe('none')
    expect(deriveProvenance({ sourceUrl: '', sourceLabel: '   ', sourceKey: null })).toBe('none')
  })

  // The bug this whole change exists to fix: club only is the fail closed
  // default on every row created since migration 0038, so it proves nothing
  // about where the content came from.
  it('never infers provenance from a rights value, which it cannot see', () => {
    expect(deriveProvenance({ sourceUrl: null, sourceLabel: null })).toBe('none')
  })

  it('ignores an unparsable URL rather than guessing', () => {
    expect(deriveProvenance({ sourceUrl: 'not a url' })).toBe('third_party')
  })
})

describe('the three levels', () => {
  it('offers exactly three, in widening order, in the club’s words', () => {
    expect(RIGHTS_OPTIONS.map((o) => o.value)).toEqual(['internal_only', 'public_link_only', 'public_full'])
    expect(RIGHTS_OPTIONS.map((o) => o.label)).toEqual(['Club only', 'Public text only', 'Public, including files'])
  })

  it('never shows an enum name to a user', () => {
    for (const o of RIGHTS_OPTIONS) {
      expect(o.label).not.toContain('_')
      expect(o.description).not.toContain('_')
    }
    for (const noun of Object.values(RIGHTS_NOUN)) expect(noun).not.toContain('_')
  })

  it('states the stored level plainly', () => {
    expect(rightsLabel('public_full')).toBe('Public, including files')
    expect(rightsStatusLine('internal_only', 'programme')).toBe('This programme is set to club only.')
    expect(rightsStatusLine('public_link_only', 'drill')).toContain('as text')
  })
})

describe('rightsControlState', () => {
  it('locks England Football content at club only and explains why', () => {
    const s = rightsControlState({ current: 'internal_only', provenance: 'fa', canEdit: true })
    expect(s.locked).toBe(true)
    expect(s.editable).toBe(false)
    expect(s.note).toBe(FA_LOCK_NOTE)
    expect(s.options.map((o) => o.value)).toEqual(['internal_only'])
  })

  it('locks it even for a manager: the database refuses the write either way', () => {
    expect(rightsControlState({ current: 'internal_only', provenance: 'fa', canEdit: true }).editable).toBe(false)
  })

  it('offers all three for club original content the user owns', () => {
    const s = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: true })
    expect(s.locked).toBe(false)
    expect(s.editable).toBe(true)
    expect(s.confirm).toBeNull()
    expect(s.options).toHaveLength(3)
  })

  it('asks for a confirmation when another source is recorded', () => {
    const s = rightsControlState({ current: 'internal_only', provenance: 'third_party', canEdit: true })
    expect(s.confirm).toBe(THIRD_PARTY_CONFIRM)
  })

  it('always asks for a confirmation on a file, whatever its source says', () => {
    const s = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: true, isMedia: true })
    expect(s.confirm).toBe(MEDIA_CONFIRM)
  })

  it('is read only for someone who does not own the content', () => {
    const s = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: false })
    expect(s.editable).toBe(false)
    expect(s.note).toContain('Only the person who created this')
  })
})

describe('canSaveRights', () => {
  const editable = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: true })
  const needsConfirm = rightsControlState({ current: 'internal_only', provenance: 'third_party', canEdit: true })
  const locked = rightsControlState({ current: 'internal_only', provenance: 'fa', canEdit: true })
  const readOnly = rightsControlState({ current: 'internal_only', provenance: 'none', canEdit: false })

  it('needs a change: reselecting the stored level saves nothing', () => {
    expect(canSaveRights({ selected: 'internal_only', current: 'internal_only', state: editable, confirmed: false })).toBe(false)
  })

  it('saves an explicit change on club original content', () => {
    expect(canSaveRights({ selected: 'public_full', current: 'internal_only', state: editable, confirmed: false })).toBe(true)
  })

  it('withholds a publish until the confirmation is ticked', () => {
    expect(canSaveRights({ selected: 'public_full', current: 'internal_only', state: needsConfirm, confirmed: false })).toBe(false)
    expect(canSaveRights({ selected: 'public_full', current: 'internal_only', state: needsConfirm, confirmed: true })).toBe(true)
  })

  it('never asks for a confirmation to go back to club only', () => {
    expect(canSaveRights({ selected: 'internal_only', current: 'public_full', state: needsConfirm, confirmed: false })).toBe(true)
  })

  it('refuses a locked or read only control outright', () => {
    expect(canSaveRights({ selected: 'public_full', current: 'internal_only', state: locked, confirmed: true })).toBe(false)
    expect(canSaveRights({ selected: 'public_full', current: 'internal_only', state: readOnly, confirmed: true })).toBe(false)
  })
})
