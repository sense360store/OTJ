import { describe, expect, it } from 'vitest'
import {
  creatorFilterPatch,
  countByStatus,
  EMPTY_SHARE_FILTERS,
  filtersToRequest,
  shareFiltersAreActive,
  shareFiltersFromParams,
  shareIdFromInput,
  SHARES_MAX_PAGE_SIZE,
  SHARES_PAGE_SIZE,
  sourceKindLabel,
  statusLabel,
  type ShareFilters,
} from './sharesView'

// The Shared links screen's pure layer: the wire shape a filter set becomes,
// the share id a manager may paste in, and the status and kind copy. The
// load bearing case is the pasted public link, which carries a live secret in
// its fragment; those tests pin that the secret is discarded and never reaches
// the request body.

const A_UUID = '3f1c9d2e-4b7a-4c8d-9e10-5a6b7c8d9e0f'
const B_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const SECRET = 'zzTOPSECRETzz-do-not-keep-me'

function filters(over: Partial<ShareFilters> = {}): ShareFilters {
  return { ...EMPTY_SHARE_FILTERS, ...over }
}

describe('shareIdFromInput', () => {
  it('accepts a bare uuid', () => {
    expect(shareIdFromInput(A_UUID)).toBe(A_UUID)
  })

  it('trims surrounding whitespace and lowercases, so the same link keys one cache entry', () => {
    expect(shareIdFromInput(`  ${A_UUID.toUpperCase()}  `)).toBe(A_UUID)
  })

  it('takes the id out of a pasted public share URL', () => {
    expect(shareIdFromInput(`https://otj.example/share/${A_UUID}`)).toBe(A_UUID)
  })

  it('DISCARDS the fragment entirely: the secret is never returned', () => {
    const pasted = `https://otj.example/share/${A_UUID}#${SECRET}`
    const id = shareIdFromInput(pasted)
    expect(id).toBe(A_UUID)
    expect(id).not.toContain('#')
    expect(id).not.toContain(SECRET)
    expect(id).not.toContain('zzTOPSECRETzz')
  })

  it('discards a query string as well as the fragment', () => {
    expect(shareIdFromInput(`https://otj.example/share/${A_UUID}?from=email#${SECRET}`)).toBe(A_UUID)
  })

  it('discards the host, so a link from a preview deployment resolves the same', () => {
    expect(shareIdFromInput(`https://otj-git-preview.vercel.app/share/${A_UUID}#${SECRET}`)).toBe(A_UUID)
    expect(shareIdFromInput(`http://localhost:5173/share/${A_UUID}#${SECRET}`)).toBe(A_UUID)
  })

  it('accepts a path only paste and still drops the secret', () => {
    expect(shareIdFromInput(`/share/${A_UUID}#${SECRET}`)).toBe(A_UUID)
  })

  it('tolerates a trailing slash', () => {
    expect(shareIdFromInput(`https://otj.example/share/${A_UUID}/`)).toBe(A_UUID)
  })

  it('returns null for anything that is not a share id or a share link', () => {
    for (const bad of [
      '',
      '   ',
      'not a uuid',
      '1234',
      `${A_UUID}-extra`,
      'https://otj.example/drill/' + A_UUID,
      `https://otj.example/share/${A_UUID}/extra`,
      'https://otj.example/share/not-a-uuid',
      'https://otj.example/share/',
      `javascript:/share/${A_UUID}`,
    ]) {
      expect(shareIdFromInput(bad)).toBeNull()
    }
  })

  it('returns null for null and undefined', () => {
    expect(shareIdFromInput(null)).toBeNull()
    expect(shareIdFromInput(undefined)).toBeNull()
  })

  it('never returns the secret even when the fragment itself looks like a uuid', () => {
    const id = shareIdFromInput(`https://otj.example/share/${A_UUID}#${B_UUID}`)
    expect(id).toBe(A_UUID)
    expect(id).not.toBe(B_UUID)
  })
})

describe('filtersToRequest', () => {
  it('sends the list action and the page size, and nothing else, for an empty filter set', () => {
    expect(filtersToRequest(EMPTY_SHARE_FILTERS)).toEqual({ action: 'list', limit: SHARES_PAGE_SIZE })
  })

  it('omits the default status rather than sending "all"', () => {
    expect(filtersToRequest(filters({ status: 'all' }))).not.toHaveProperty('status')
  })

  it('carries a narrowed status and kind', () => {
    expect(filtersToRequest(filters({ status: 'active', kind: 'session' }))).toEqual({
      action: 'list',
      status: 'active',
      kind: 'session',
      limit: SHARES_PAGE_SIZE,
    })
  })

  it('carries a creator id', () => {
    expect(filtersToRequest(filters({ createdBy: B_UUID }))).toEqual({
      action: 'list',
      createdBy: B_UUID,
      limit: SHARES_PAGE_SIZE,
    })
  })

  it('omits a creator id that is only whitespace', () => {
    expect(filtersToRequest(filters({ createdBy: '   ' }))).not.toHaveProperty('createdBy')
  })

  it('never emits both createdBy and unattributed (the server answers 400)', () => {
    const body = filtersToRequest(filters({ createdBy: B_UUID, unattributed: true }))
    expect(body.unattributed).toBe(true)
    expect(body).not.toHaveProperty('createdBy')
  })

  it('omits unattributed entirely when it is off, rather than sending false', () => {
    expect(filtersToRequest(EMPTY_SHARE_FILTERS)).not.toHaveProperty('unattributed')
  })

  it('resolves a pasted link to a share id and puts no secret on the wire', () => {
    const body = filtersToRequest(filters({ shareId: `https://otj.example/share/${A_UUID}#${SECRET}` }))
    expect(body.shareId).toBe(A_UUID)
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(JSON.stringify(body)).not.toContain('#')
  })

  it('omits an unparseable share id rather than sending the raw text', () => {
    const body = filtersToRequest(filters({ shareId: 'something a coach typed' }))
    expect(body).not.toHaveProperty('shareId')
  })

  it('carries a cursor for the next page and omits it on the first', () => {
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { cursor: null })).not.toHaveProperty('cursor')
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { cursor: '2026-07-01T00:00:00.000Z' }).cursor).toBe(
      '2026-07-01T00:00:00.000Z',
    )
  })

  it('clamps the limit to the server range', () => {
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: 1 }).limit).toBe(1)
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: 0 }).limit).toBe(1)
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: -5 }).limit).toBe(1)
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: 500 }).limit).toBe(SHARES_MAX_PAGE_SIZE)
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: 12.7 }).limit).toBe(12)
    expect(filtersToRequest(EMPTY_SHARE_FILTERS, { limit: Number.NaN }).limit).toBe(SHARES_PAGE_SIZE)
  })

  it('builds the one row member count request the removal warning uses', () => {
    const body = filtersToRequest(filters({ createdBy: B_UUID, status: 'active' }), { limit: 1 })
    expect(body).toEqual({ action: 'list', status: 'active', createdBy: B_UUID, limit: 1 })
  })
})

describe('shareFiltersFromParams', () => {
  it('reads a creator deep link', () => {
    expect(shareFiltersFromParams(new URLSearchParams(`createdBy=${B_UUID}`))).toEqual({ createdBy: B_UUID })
  })

  it('lowercases so the deep link and the picker key one cache entry', () => {
    expect(shareFiltersFromParams(new URLSearchParams(`createdBy=${B_UUID.toUpperCase()}`))).toEqual({
      createdBy: B_UUID,
    })
  })

  it('ignores anything that is not a member id', () => {
    expect(shareFiltersFromParams(new URLSearchParams())).toEqual({})
    expect(shareFiltersFromParams(new URLSearchParams('createdBy='))).toEqual({})
    expect(shareFiltersFromParams(new URLSearchParams('createdBy=everyone'))).toEqual({})
    expect(shareFiltersFromParams(new URLSearchParams('other=1'))).toEqual({})
  })
})

describe('shareFiltersAreActive', () => {
  it('is false for the empty set', () => {
    expect(shareFiltersAreActive(EMPTY_SHARE_FILTERS)).toBe(false)
  })

  it('is true for each narrowing dimension', () => {
    expect(shareFiltersAreActive(filters({ status: 'revoked' }))).toBe(true)
    expect(shareFiltersAreActive(filters({ kind: 'drill' }))).toBe(true)
    expect(shareFiltersAreActive(filters({ createdBy: B_UUID }))).toBe(true)
    expect(shareFiltersAreActive(filters({ unattributed: true }))).toBe(true)
    expect(shareFiltersAreActive(filters({ shareId: A_UUID }))).toBe(true)
  })
})

describe('countByStatus', () => {
  it('counts nothing for an empty list', () => {
    expect(countByStatus([])).toEqual({ active: 0, expired: 0, revoked: 0 })
  })

  it('counts each status in the loaded rows', () => {
    expect(
      countByStatus([
        { status: 'active' },
        { status: 'active' },
        { status: 'revoked' },
        { status: 'expired' },
      ]),
    ).toEqual({ active: 2, expired: 1, revoked: 1 })
  })
})

describe('copy helpers', () => {
  it('labels a status in the same words as the coach facing control', () => {
    expect(statusLabel('active')).toBe('Active')
    expect(statusLabel('expired')).toBe('Expired')
    // "Turn off this link" is the control, so the log says "Turned off".
    expect(statusLabel('revoked')).toBe('Turned off')
  })

  it('labels each source kind', () => {
    expect(sourceKindLabel('drill')).toBe('Drill')
    expect(sourceKindLabel('session')).toBe('Session')
    expect(sourceKindLabel('programme')).toBe('Programme')
  })
})

describe('creatorFilterPatch', () => {
  const members = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { id: 'bbbbbbbb-0000-4000-8000-000000000002' }]

  it('clears the creator filter for Anyone', () => {
    // Number('') is 0. Coercing it would select the first member and silently
    // narrow a club-wide review to one person, which is the harmful direction
    // on a screen whose purpose is to show every link the club has made.
    expect(creatorFilterPatch('', members)).toEqual({ unattributed: false, createdBy: '' })
  })

  it('clears the creator filter for Anyone even when a member is already chosen', () => {
    // The regression path: arrive from the member removal deep link with a
    // creator pre-set, then pick Anyone.
    const patch = creatorFilterPatch('', members)
    expect(patch.createdBy).toBe('')
    expect(patch.createdBy).not.toBe(members[0].id)
  })

  it('selects the member at the given position', () => {
    expect(creatorFilterPatch('0', members)).toEqual({ unattributed: false, createdBy: members[0].id })
    expect(creatorFilterPatch('1', members)).toEqual({ unattributed: false, createdBy: members[1].id })
  })

  it('sets the former member flag and never a creator alongside it', () => {
    expect(creatorFilterPatch('unattributed', members)).toEqual({ unattributed: true, createdBy: '' })
  })

  it('clears rather than guessing for an unresolvable position', () => {
    for (const value of ['unresolved', '-1', '2', '1.5', 'NaN', 'abc']) {
      expect(creatorFilterPatch(value, members)).toEqual({ unattributed: false, createdBy: '' })
    }
  })

  it('clears when there are no members to choose from', () => {
    expect(creatorFilterPatch('0', [])).toEqual({ unattributed: false, createdBy: '' })
  })

  it('never returns both a creator and the former member flag', () => {
    for (const value of ['', '0', '1', 'unattributed', 'unresolved', '9']) {
      const patch = creatorFilterPatch(value, members)
      expect(patch.unattributed && patch.createdBy !== '').toBe(false)
    }
  })
})
