import { describe, expect, it } from 'vitest'
import {
  ACTION_OPTIONS,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_SELECT_COLUMNS,
  ENTITY_OPTIONS,
  EMPTY_FILTERS,
  activeFilterCount,
  activityBatchHref,
  activityFiltersToParams,
  activityQueryConditions,
  compareActivity,
  describeActivityEvent,
  entityRef,
  filtersAreActive,
  flattenPages,
  fromBoundaryIso,
  isUuid,
  keysetOrFilter,
  nextCursor,
  parseActivityFilters,
  sourceLabel,
  toBoundaryExclusiveIso,
  type ActivityEvent,
  type ActivityFilters,
} from './activityView'

// A synthetic event. No real child, actor, name or payload appears anywhere in
// this suite; every value is invented.
function ev(p: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    occurredAt: '2026-07-20T12:00:00.000000+00:00',
    actorId: 'actor-1',
    actorName: 'Test Actor',
    action: 'player.created',
    entityType: 'player',
    entityId: 'player-1',
    seasonId: null,
    teamId: null,
    source: 'manual',
    changedFields: null,
    safeChanges: null,
    batchId: null,
    ...p,
  }
}

const renderOpts = {
  teamName: (id: string | null | undefined) =>
    id == null ? 'Unassigned' : id === 'titans' ? 'Titans' : id === 'trojans' ? 'Trojans' : 'Deleted team',
  formatDate: (iso: string) => `date(${iso})`,
}

// The names that must never appear in any rendered description.
const FORBIDDEN_NAMES = ['Old Synthetic', 'New Synthetic', 'Synthetic Child']

describe('describeActivityEvent: player actions (shared History grammar)', () => {
  it('renders every player lifecycle action without a name', () => {
    expect(describeActivityEvent(ev({ id: 'a', action: 'player.created' }), renderOpts)).toBe('Player added')
    expect(describeActivityEvent(ev({ id: 'a', action: 'player.deleted' }), renderOpts)).toBe('Player deleted')
    expect(describeActivityEvent(ev({ id: 'a', action: 'player.registration_created' }), renderOpts)).toBe(
      'Registration created',
    )
    expect(describeActivityEvent(ev({ id: 'a', action: 'player.renewed' }), renderOpts)).toBe('Registration renewed')
    expect(describeActivityEvent(ev({ id: 'a', action: 'player.withdrawn' }), renderOpts)).toBe('Withdrawn')
  })

  it('renders a status change with the status words', () => {
    const e = ev({ id: 'a', action: 'player.status_changed', safeChanges: { status: { old: 'pending', new: 'registered' } } })
    expect(describeActivityEvent(e, renderOpts)).toBe('Registration changed: Pending to Registered')
  })

  it('renders a restore with the status words', () => {
    const e = ev({ id: 'a', action: 'player.restored', safeChanges: { status: { old: 'withdrawn', new: 'registered' } } })
    expect(describeActivityEvent(e, renderOpts)).toBe('Restored: Withdrawn to Registered')
  })

  it('renders a team change with resolved team names', () => {
    const e = ev({ id: 'a', action: 'player.team_changed', safeChanges: { team_id: { old: 'titans', new: 'trojans' } } })
    expect(describeActivityEvent(e, renderOpts)).toBe('Team changed: Titans to Trojans')
  })

  it('renders a team change to Unassigned and from a deleted team neutrally', () => {
    const toNull = ev({ id: 'a', action: 'player.team_changed', safeChanges: { team_id: { old: 'titans', new: null } } })
    expect(describeActivityEvent(toNull, renderOpts)).toBe('Team changed: Titans to Unassigned')
    const fromGone = ev({ id: 'b', action: 'player.team_changed', safeChanges: { team_id: { old: 'ghost', new: 'titans' } } })
    expect(describeActivityEvent(fromGone, renderOpts)).toBe('Team changed: Deleted team to Titans')
  })

  it('renders a shirt and a registered date change from the safe fields', () => {
    const shirt = ev({ id: 'a', action: 'player.registration_updated', safeChanges: { shirt_number: { old: 7, new: 9 } } })
    expect(describeActivityEvent(shirt, renderOpts)).toBe('Shirt number changed: 7 to 9')
    const date = ev({
      id: 'b',
      action: 'player.registration_updated',
      safeChanges: { registered_date: { old: null, new: '2026-07-16' } },
    })
    expect(describeActivityEvent(date, renderOpts)).toBe('Registered date set: date(2026-07-16)')
  })
})

describe('describeActivityEvent: the display name rule', () => {
  it('renders player.updated as the fixed copy, never an old or new name', () => {
    // Even if a name value somehow rode along in safe_changes (the schema
    // forbids it), the renderer ignores it and emits the fixed copy.
    const e = ev({
      id: 'a',
      action: 'player.updated',
      changedFields: ['display_name'],
      safeChanges: { display_name: { old: 'Old Synthetic', new: 'New Synthetic' } } as never,
    })
    const text = describeActivityEvent(e, renderOpts)
    expect(text).toBe('Player name corrected')
    for (const name of FORBIDDEN_NAMES) expect(text).not.toContain(name)
  })
})

describe('describeActivityEvent: season, import and export actions', () => {
  it('renders every season action', () => {
    expect(describeActivityEvent(ev({ id: 'a', action: 'season.created', entityType: 'season' }), renderOpts)).toBe(
      'Season created',
    )
    expect(describeActivityEvent(ev({ id: 'a', action: 'season.updated', entityType: 'season' }), renderOpts)).toBe(
      'Season updated',
    )
    expect(describeActivityEvent(ev({ id: 'a', action: 'season.activated', entityType: 'season' }), renderOpts)).toBe(
      'Season activated',
    )
    expect(describeActivityEvent(ev({ id: 'a', action: 'season.archived', entityType: 'season' }), renderOpts)).toBe(
      'Season archived',
    )
  })

  it('renders every import and export action', () => {
    expect(
      describeActivityEvent(ev({ id: 'a', action: 'players.import_completed', entityType: 'import_batch' }), renderOpts),
    ).toBe('Players imported')
    expect(
      describeActivityEvent(ev({ id: 'a', action: 'players.import_failed', entityType: 'import_batch' }), renderOpts),
    ).toBe('Player import failed')
    expect(describeActivityEvent(ev({ id: 'a', action: 'players.exported', entityType: 'export' }), renderOpts)).toBe(
      'Players exported',
    )
    expect(
      describeActivityEvent(ev({ id: 'a', action: 'players.spond_imported', entityType: 'import_batch' }), renderOpts),
    ).toBe('Players imported from Spond')
  })

  it('renders an unknown future action as its bare action key (never user data)', () => {
    // A namespace PR 8 does NOT cover (media is out of scope), so it stays
    // unmapped and falls through to the bare key.
    expect(describeActivityEvent(ev({ id: 'a', action: 'media.created', entityType: 'season' }), renderOpts)).toBe(
      'media.created',
    )
  })
})

describe('describeActivityEvent: PR 8 wider rollout actions', () => {
  // Every action this PR adds must render fixed, human readable copy, never the
  // raw action key, and never interpolate an unsafe value. The table pins the
  // exact copy for each.
  const CASES: [string, string][] = [
    ['user.invited', 'Member invited'],
    ['user.removed', 'Member removed'],
    ['user.role_assigned', 'Role assigned'],
    ['user.role_removed', 'Role removed'],
    ['user.capability_granted', 'Capability granted'],
    ['user.capability_revoked', 'Capability revoked'],
    ['user.team_assigned', 'Added to a team'],
    ['user.team_removed', 'Removed from a team'],
    ['team.created', 'Team created'],
    ['team.updated', 'Team renamed'],
    ['team.deleted', 'Team deleted'],
    ['spond.mapping_created', 'Spond mapping created'],
    ['spond.mapping_changed', 'Spond mapping updated'],
    ['spond.mapping_removed', 'Spond mapping removed'],
    ['drill.created', 'Drill created'],
    ['drill.updated', 'Drill updated'],
    ['drill.deleted', 'Drill deleted'],
    ['template.created', 'Template created'],
    ['template.updated', 'Template updated'],
    ['template.deleted', 'Template deleted'],
    ['programme.created', 'Programme created'],
    ['programme.updated', 'Programme updated'],
    ['programme.deleted', 'Programme deleted'],
    ['session.created', 'Session created'],
    ['session.updated', 'Session updated'],
    ['session.deleted', 'Session deleted'],
  ]

  it.each(CASES)('renders %s as fixed copy, never the raw key', (action, copy) => {
    const text = describeActivityEvent(ev({ id: 'a', action }), renderOpts)
    expect(text).toBe(copy)
    // Never the raw action key, and never a role key, capability key or any
    // value: these events carry role/capability keys in changedFields, which
    // this renderer must not surface into the sentence.
    expect(text).not.toContain(action)
    expect(text).not.toContain('.')
  })

  it('never leaks a role key, capability key or member name even when they ride in changedFields', () => {
    // A role assignment event carries the safe role key in changedFields; the
    // renderer must ignore it and emit only the fixed copy.
    const roleEv = ev({
      id: 'r',
      action: 'user.role_assigned',
      entityType: 'user',
      changedFields: ['coach'],
    })
    expect(describeActivityEvent(roleEv, renderOpts)).toBe('Role assigned')
    const capEv = ev({
      id: 'c',
      action: 'user.capability_granted',
      entityType: 'role',
      changedFields: ['players.manage'],
    })
    expect(describeActivityEvent(capEv, renderOpts)).toBe('Capability granted')
  })

  it('the ACTION filter options cover every PR 8 action with a fixed label', () => {
    const optionValues = new Set(ACTION_OPTIONS.map((o) => o.value))
    for (const [action] of CASES) expect(optionValues.has(action)).toBe(true)
    // Every option label is non empty and is not the raw key.
    for (const o of ACTION_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0)
      expect(o.label).not.toBe(o.value)
    }
  })

  it('the ENTITY filter options cover every PR 8 entity type', () => {
    const values = new Set(ENTITY_OPTIONS.map((o) => o.value))
    for (const t of ['user', 'role', 'team', 'spond_mapping', 'drill', 'template', 'programme', 'session'] as const) {
      expect(values.has(t)).toBe(true)
    }
  })
})

describe('sourceLabel', () => {
  it('labels every source in the vocabulary', () => {
    expect(sourceLabel('manual')).toBe('Manual')
    expect(sourceLabel('csv_import')).toBe('CSV import')
    expect(sourceLabel('xlsx_import')).toBe('XLSX import')
    expect(sourceLabel('spond_import')).toBe('Spond import')
    expect(sourceLabel('renewal')).toBe('Renewal')
    expect(sourceLabel('system')).toBe('System')
    expect(sourceLabel('edge_function')).toBe('Edge function')
    expect(sourceLabel('database_trigger')).toBe('Database trigger')
  })

  it('falls back to the raw value for an unknown source', () => {
    expect(sourceLabel('future_source')).toBe('future_source')
  })
})

describe('entityRef', () => {
  const exists = (id: string) => id === 'player-1'
  const seasonName = (id: string) => (id === 'season-1' ? '2026/27' : null)
  const teamName = (id: string | null | undefined) =>
    id == null ? 'Unassigned' : id === 'titans' ? 'Titans' : 'Deleted team'
  const opts = { canSeeNames: true, playerExists: exists, seasonName, teamName }

  it('offers View history for an existing player the viewer can name', () => {
    const r = entityRef(ev({ id: 'a', entityType: 'player', entityId: 'player-1' }), opts)
    expect(r).toEqual({ kind: 'player-history', playerId: 'player-1' })
  })

  it('renders a deleted player neutrally when the viewer can name but the id is gone', () => {
    const r = entityRef(ev({ id: 'a', entityType: 'player', entityId: 'gone' }), opts)
    expect(r).toEqual({ kind: 'player-deleted' })
  })

  it('fails closed to a neutral player when the viewer cannot see names (never a false deleted)', () => {
    const r = entityRef(ev({ id: 'a', entityType: 'player', entityId: 'player-1' }), { ...opts, canSeeNames: false })
    expect(r).toEqual({ kind: 'player-anon' })
  })

  it('resolves a season name, falling back to a neutral Season label', () => {
    expect(entityRef(ev({ id: 'a', entityType: 'season', entityId: 'season-1' }), opts)).toEqual({
      kind: 'season',
      label: '2026/27',
    })
    expect(entityRef(ev({ id: 'a', entityType: 'season', entityId: 'gone' }), opts)).toEqual({
      kind: 'season',
      label: 'Season',
    })
  })

  it('links an import batch and labels an export', () => {
    expect(entityRef(ev({ id: 'a', entityType: 'import_batch', entityId: 'batch-1' }), opts)).toEqual({
      kind: 'batch',
      batchId: 'batch-1',
    })
    expect(entityRef(ev({ id: 'a', entityType: 'export', entityId: null }), opts)).toEqual({ kind: 'export' })
  })

  // ---- PR 8 wider rollout entities ------------------------------------
  it('resolves a team name and degrades to "Deleted team" once the team is gone', () => {
    expect(entityRef(ev({ id: 'a', entityType: 'team', entityId: 'titans' }), opts)).toEqual({
      kind: 'team',
      label: 'Titans',
    })
    expect(entityRef(ev({ id: 'b', entityType: 'team', entityId: 'gone' }), opts)).toEqual({
      kind: 'team',
      label: 'Deleted team',
    })
  })

  it('renders neutral, deletion proof labels for member, role, spond and content entities', () => {
    const cases: [string, string][] = [
      ['user', 'Member'],
      ['role', 'Role'],
      ['spond_mapping', 'Spond mapping'],
      ['drill', 'Drill'],
      ['template', 'Template'],
      ['programme', 'Programme'],
      ['session', 'Session'],
    ]
    for (const [entityType, label] of cases) {
      // A live id and a deleted (unresolvable) id render identically: the label
      // never depends on the id, so a deletion leaks nothing and never breaks.
      expect(entityRef(ev({ id: 'x', entityType, entityId: 'some-id' }), opts)).toEqual({ kind: 'label', label })
      expect(entityRef(ev({ id: 'y', entityType, entityId: null }), opts)).toEqual({ kind: 'label', label })
    }
  })
})

describe('isUuid and batch deep link parsing', () => {
  const good = '11111111-2222-3333-4444-555555555555'

  it('accepts a well formed uuid and rejects anything else', () => {
    expect(isUuid(good)).toBe(true)
    expect(isUuid(good.toUpperCase())).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('11111111-2222-3333-4444-55555555555')).toBe(false) // one short
    expect(isUuid(`${good}; drop table`)).toBe(false)
  })

  it('parses only a valid ?batch= from the URL, dropping a malformed one', () => {
    expect(parseActivityFilters(new URLSearchParams(`batch=${good}`)).batchId).toBe(good)
    expect(parseActivityFilters(new URLSearchParams('batch=nonsense')).batchId).toBe('')
    expect(parseActivityFilters(new URLSearchParams('batch=')).batchId).toBe('')
    expect(parseActivityFilters(new URLSearchParams('')).batchId).toBe('')
  })

  it('lower cases the batch id so the round trip is stable', () => {
    expect(parseActivityFilters(new URLSearchParams(`batch=${good.toUpperCase()}`)).batchId).toBe(good)
  })

  it('ignores every non batch query parameter (only batch persists in v1)', () => {
    const f = parseActivityFilters(new URLSearchParams(`batch=${good}&actor=x&from=2026-01-01&source=manual`))
    expect(f).toEqual({ ...EMPTY_FILTERS, batchId: good })
  })
})

describe('activityFiltersToParams (serialisation)', () => {
  const good = '11111111-2222-3333-4444-555555555555'

  it('writes only the batch filter, and only when it is a valid uuid', () => {
    expect(activityFiltersToParams(EMPTY_FILTERS).toString()).toBe('')
    // Non batch filters never enter the URL.
    const withState: ActivityFilters = { ...EMPTY_FILTERS, actorId: 'a', from: '2026-01-01', source: 'manual' }
    expect(activityFiltersToParams(withState).toString()).toBe('')
    // A valid batch round trips.
    expect(activityFiltersToParams({ ...EMPTY_FILTERS, batchId: good }).get('batch')).toBe(good)
    // A malformed batch is not written.
    expect(activityFiltersToParams({ ...EMPTY_FILTERS, batchId: 'bad' }).toString()).toBe('')
  })

  it('round trips a batch deep link', () => {
    const params = activityFiltersToParams({ ...EMPTY_FILTERS, batchId: good })
    expect(parseActivityFilters(params).batchId).toBe(good)
  })
})

describe('activeFilterCount and filtersAreActive', () => {
  it('counts each applied dimension and treats the default as inactive', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(filtersAreActive(EMPTY_FILTERS)).toBe(false)
    const f: ActivityFilters = {
      from: '2026-01-01',
      to: '2026-02-01',
      actorId: 'a',
      entity: 'player',
      action: 'player.created',
      teamId: 't',
      seasonId: 's',
      source: 'manual',
      batchId: '11111111-2222-3333-4444-555555555555',
    }
    expect(activeFilterCount(f)).toBe(9)
    expect(filtersAreActive(f)).toBe(true)
  })

  it('counts the batch filter on its own', () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, batchId: 'x' })).toBe(1)
    expect(filtersAreActive({ ...EMPTY_FILTERS, batchId: 'x' })).toBe(true)
  })
})

describe('date boundaries', () => {
  // Boundaries are the viewer's LOCAL day (to match the locally rendered feed
  // times), so the expected instant is computed the same way, keeping the test
  // deterministic in any runtime timezone rather than hard coding a UTC string.
  it('builds an inclusive local-day start for From and an exclusive next local day for To', () => {
    expect(fromBoundaryIso('2026-07-20')).toBe(new Date(2026, 6, 20).toISOString())
    expect(toBoundaryExclusiveIso('2026-07-20')).toBe(new Date(2026, 6, 21).toISOString())
  })

  it('rolls a month and year boundary correctly for To', () => {
    expect(toBoundaryExclusiveIso('2026-01-31')).toBe(new Date(2026, 1, 1).toISOString())
    expect(toBoundaryExclusiveIso('2026-12-31')).toBe(new Date(2027, 0, 1).toISOString())
  })

  it('the To boundary is strictly one local day after the From boundary of the same date', () => {
    const from = new Date(fromBoundaryIso('2026-07-20')!).getTime()
    const to = new Date(toBoundaryExclusiveIso('2026-07-20')!).getTime()
    expect(to - from).toBe(24 * 60 * 60 * 1000)
  })

  it('returns null for a blank or malformed date', () => {
    expect(fromBoundaryIso('')).toBeNull()
    expect(fromBoundaryIso('2026-7-1')).toBeNull()
    expect(toBoundaryExclusiveIso('nonsense')).toBeNull()
  })
})

describe('activityQueryConditions', () => {
  it('produces no predicates for the default filter (never a client club_id)', () => {
    const c = activityQueryConditions(EMPTY_FILTERS)
    expect(c).toEqual([])
    expect(c.some((p) => p.column === 'club_id')).toBe(false)
  })

  it('maps each filter to its column predicate and never includes club_id', () => {
    const good = '11111111-2222-3333-4444-555555555555'
    const f: ActivityFilters = {
      from: '2026-07-01',
      to: '2026-07-31',
      actorId: 'actor-x',
      entity: 'player',
      action: 'player.withdrawn',
      teamId: 'team-x',
      seasonId: 'season-x',
      source: 'csv_import',
      batchId: good,
    }
    const c = activityQueryConditions(f)
    expect(c).toContainEqual({ column: 'occurred_at', op: 'gte', value: new Date(2026, 6, 1).toISOString() })
    expect(c).toContainEqual({ column: 'occurred_at', op: 'lt', value: new Date(2026, 7, 1).toISOString() })
    expect(c).toContainEqual({ column: 'actor_id', op: 'eq', value: 'actor-x' })
    expect(c).toContainEqual({ column: 'entity_type', op: 'eq', value: 'player' })
    expect(c).toContainEqual({ column: 'action', op: 'eq', value: 'player.withdrawn' })
    expect(c).toContainEqual({ column: 'team_id', op: 'eq', value: 'team-x' })
    expect(c).toContainEqual({ column: 'season_id', op: 'eq', value: 'season-x' })
    expect(c).toContainEqual({ column: 'source', op: 'eq', value: 'csv_import' })
    expect(c).toContainEqual({ column: 'batch_id', op: 'eq', value: good })
    expect(c.some((p) => p.column === 'club_id')).toBe(false)
  })

  it('drops a malformed batch id from the predicates (a forged batch cannot query)', () => {
    const c = activityQueryConditions({ ...EMPTY_FILTERS, batchId: "'; drop table audit_events; --" })
    expect(c.some((p) => p.column === 'batch_id')).toBe(false)
    expect(c).toEqual([])
  })

  it('composes several filters at once', () => {
    const c = activityQueryConditions({ ...EMPTY_FILTERS, entity: 'season', source: 'manual' })
    expect(c).toHaveLength(2)
  })
})

describe('keyset pagination', () => {
  // A deterministic total order: occurred_at desc, id desc. Two batches share
  // an occurred_at (a bulk import writes many rows with one now()), so the id
  // tiebreak decides within them.
  const t1 = '2026-07-20T10:00:00.000000+00:00'
  const t2 = '2026-07-20T09:00:00.000000+00:00'
  const all: ActivityEvent[] = [
    ev({ id: 'id-9', occurredAt: t1 }),
    ev({ id: 'id-8', occurredAt: t1 }),
    ev({ id: 'id-7', occurredAt: t1 }),
    ev({ id: 'id-3', occurredAt: t2 }),
    ev({ id: 'id-2', occurredAt: t2 }),
    ev({ id: 'id-1', occurredAt: t2 }),
  ]

  it('orders by occurred_at desc then id desc', () => {
    const shuffled = [all[3], all[0], all[5], all[1], all[4], all[2]]
    const sorted = [...shuffled].sort(compareActivity)
    expect(sorted.map((e) => e.id)).toEqual(['id-9', 'id-8', 'id-7', 'id-3', 'id-2', 'id-1'])
  })

  it('returns a cursor only when the page is full', () => {
    expect(nextCursor(all.slice(0, 3), 3)).toEqual({ occurredAt: t1, id: 'id-7' })
    expect(nextCursor(all.slice(0, 2), 3)).toBeNull() // short page, feed exhausted
    expect(nextCursor([], 3)).toBeNull()
  })

  it('builds a keyset predicate that is strictly after the cursor', () => {
    expect(keysetOrFilter(null)).toBeNull()
    expect(keysetOrFilter({ occurredAt: t1, id: 'id-7' })).toBe(
      `occurred_at.lt.${t1},and(occurred_at.eq.${t1},id.lt.id-7)`,
    )
  })

  it('window and cursor reassemble the full ordered sequence with no gaps', () => {
    // Simulate paging by the cursor over the ordered list, page size 3.
    const ordered = [...all].sort(compareActivity)
    const cut = (from: number) => ordered.slice(from, from + 3)
    const page1 = cut(0)
    const c1 = nextCursor(page1, 3)!
    expect(c1).toEqual({ occurredAt: t1, id: 'id-7' })
    const page2 = cut(3)
    // page2 begins strictly after the cursor in the total order.
    expect(compareActivity(page2[0], { ...page1[2] } as ActivityEvent)).toBeGreaterThan(0)
    // The two windows are disjoint and complete.
    const union = [...page1, ...page2].map((e) => e.id)
    expect(new Set(union).size).toBe(union.length)
    expect(union).toEqual(ordered.map((e) => e.id))
  })
})

describe('flattenPages (append reducer)', () => {
  it('concatenates pages in order', () => {
    const p1 = [ev({ id: 'a' }), ev({ id: 'b' })]
    const p2 = [ev({ id: 'c' })]
    expect(flattenPages([p1, p2]).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('de-duplicates by id so a shifted boundary never yields a duplicate row', () => {
    // A concurrent insert could, in the worst case, put the same row at the end
    // of one page and the start of the next; the reducer must not render it
    // twice.
    const p1 = [ev({ id: 'a' }), ev({ id: 'b' })]
    const p2 = [ev({ id: 'b' }), ev({ id: 'c' })]
    const out = flattenPages([p1, p2])
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length)
  })

  it('handles an empty trailing page (the keyset boundary probe)', () => {
    const p1 = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) => ev({ id: `id-${i}` }))
    expect(flattenPages([p1, []]).length).toBe(ACTIVITY_PAGE_SIZE)
  })
})

describe('pagination stability under a concurrent insert', () => {
  it('a newer event inserted between requests never duplicates or skips a fetched window', () => {
    const t = (s: string) => `2026-07-20T${s}+00:00`
    // Existing ordered events, page size 2.
    const existing: ActivityEvent[] = [
      ev({ id: 'e5', occurredAt: t('10:00:00.000000') }),
      ev({ id: 'e4', occurredAt: t('09:00:00.000000') }),
      ev({ id: 'e3', occurredAt: t('08:00:00.000000') }),
      ev({ id: 'e2', occurredAt: t('07:00:00.000000') }),
      ev({ id: 'e1', occurredAt: t('06:00:00.000000') }),
    ].sort(compareActivity)

    const pageOf = (rows: ActivityEvent[], cursor: { occurredAt: string; id: string } | null, size: number) => {
      const after = cursor
        ? rows.filter(
            (r) =>
              r.occurredAt < cursor.occurredAt || (r.occurredAt === cursor.occurredAt && r.id < cursor.id),
          )
        : rows
      return [...after].sort(compareActivity).slice(0, size)
    }

    // Page 1 over the original set.
    const page1 = pageOf(existing, null, 2)
    expect(page1.map((e) => e.id)).toEqual(['e5', 'e4'])
    const cur = nextCursor(page1, 2)!

    // A NEWER event arrives between requests (largest occurred_at).
    const withNew = [...existing, ev({ id: 'e6', occurredAt: t('11:00:00.000000') })].sort(compareActivity)

    // Page 2 is fetched with the cursor against the now larger set.
    const page2 = pageOf(withNew, cur, 2)
    expect(page2.map((e) => e.id)).toEqual(['e3', 'e2'])

    // The new event does not appear in page 2 (it sorts above the cursor), and
    // no existing row is duplicated or skipped across the two fetched windows.
    const seen = flattenPages([page1, page2]).map((e) => e.id)
    expect(seen).toEqual(['e5', 'e4', 'e3', 'e2'])
    expect(seen).not.toContain('e6')
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('activityBatchHref', () => {
  it('links to the batch deep link for a valid uuid, else the bare page', () => {
    const good = '11111111-2222-3333-4444-555555555555'
    expect(activityBatchHref(good)).toBe(`/activity?batch=${good}`)
    expect(activityBatchHref('bad')).toBe('/activity')
  })
})

describe('ACTIVITY_SELECT_COLUMNS privacy shape', () => {
  it('selects only the safe columns and never metadata or request_id', () => {
    const cols = ACTIVITY_SELECT_COLUMNS.split(',').map((c) => c.trim())
    expect(cols).not.toContain('metadata')
    expect(cols).not.toContain('request_id')
    expect(cols).toContain('safe_changes')
    expect(cols).toContain('actor_name')
    // club_id is enforced by RLS, not selected or shown.
    expect(cols).not.toContain('club_id')
  })
})
