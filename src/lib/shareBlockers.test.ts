import { describe, expect, it } from 'vitest'
import {
  blockerContentHint,
  EMPTY_PROVENANCE,
  FA_RESTRICTED_NOTE,
  readProvenance,
  shareBlockerView,
  type SharePreviewProvenance,
} from './shareBlockers'

function prov(
  over: { source?: SharePreviewProvenance['source']; restricted?: Partial<SharePreviewProvenance['restricted']> } = {},
): SharePreviewProvenance {
  return {
    source: over.source ?? 'none',
    restricted: { template: false, drill: false, media: false, pdf: false, ...(over.restricted ?? {}) },
  }
}

// =====================================================================
// The bug: club only was reported as England Football content
// =====================================================================
describe('a source that is merely club only', () => {
  it('does not mention England Football for a drill, session or programme', () => {
    for (const noun of ['drill', 'session', 'programme'] as const) {
      const v = shareBlockerView(noun, ['source_internal_only'], prov())
      expect(v.headline).not.toMatch(/England Football/i)
      expect(v.headline).not.toMatch(/restricted/i)
      expect(v.headline).toContain('currently set to club only')
      expect(v.headline).toContain(noun)
    }
  })

  it('offers changing the level as the next step', () => {
    expect(shareBlockerView('programme', ['source_internal_only'], prov()).action).toBe('classify')
  })

  it('says England Football only when the source provenance proves it', () => {
    const v = shareBlockerView('programme', ['source_internal_only'], prov({ source: 'fa' }))
    expect(v.headline).toBe(FA_RESTRICTED_NOTE)
    // Nothing to classify: the database refuses to raise it.
    expect(v.action).toBe('none')
  })

  it('names a recorded non England Football source honestly, without calling it restricted', () => {
    const v = shareBlockerView('drill', ['source_internal_only'], prov({ source: 'third_party' }))
    expect(v.headline).not.toMatch(/England Football/i)
    expect(v.headline).toContain('records another source')
    expect(v.action).toBe('classify')
  })

  it('falls back to no proven provenance when the server sends none', () => {
    const v = shareBlockerView('programme', ['source_internal_only'])
    expect(v.headline).not.toMatch(/England Football/i)
  })
})

// =====================================================================
// Nested layers
// =====================================================================
describe('nested rights', () => {
  it('says which layer is club only, and never which item', () => {
    const week = shareBlockerView('programme', ['template_internal_only'], prov())
    expect(week.headline).toBe('One or more weeks in this programme are set to club only.')
    const drill = shareBlockerView('programme', ['drill_internal_only'], prov())
    expect(drill.headline).toBe('One or more drills in this programme are set to club only.')
    const media = shareBlockerView('session', ['media_internal_only'], prov())
    expect(media.headline).toBe('One or more files this session uses are set to club only.')
    const pdf = shareBlockerView('programme', ['pdf_internal_only'], prov())
    expect(pdf.headline).toBe('The PDF attached to this programme is set to club only.')
  })

  it('names England Football only for the layer whose provenance proves it', () => {
    // The blocking week is club authored; a blocking drill elsewhere is FA. The
    // week copy must not borrow the drill's provenance.
    const week = shareBlockerView('programme', ['template_internal_only'], prov({ restricted: { drill: true } }))
    expect(week.headline).not.toMatch(/England Football/i)
    const drill = shareBlockerView('programme', ['drill_internal_only'], prov({ restricted: { drill: true } }))
    expect(drill.headline).toBe(FA_RESTRICTED_NOTE)
  })

  it('points at the content when the level can be changed elsewhere', () => {
    expect(shareBlockerView('programme', ['drill_internal_only'], prov()).action).toBe('content')
    // Restricted content has no next step: nothing the coach does unblocks it.
    expect(shareBlockerView('programme', ['drill_internal_only'], prov({ restricted: { drill: true } })).action).toBe('none')
  })
})

// =====================================================================
// Ordering
// =====================================================================
describe('reason ordering', () => {
  it('a programme with no weeks leads with that, over every rights reason', () => {
    const v = shareBlockerView(
      'programme',
      ['source_internal_only', 'template_internal_only', 'drill_internal_only', 'no_weeks'],
      prov({ source: 'fa' }),
    )
    expect(v.code).toBe('no_weeks')
    expect(v.headline).toBe('This programme has no weeks yet, so there is nothing to share.')
    expect(v.headline).not.toMatch(/England Football/i)
  })

  it('structure beats caps, caps beat source rights, source rights beat nested rights', () => {
    expect(shareBlockerView('programme', ['drill_missing', 'too_many_weeks'], prov()).code).toBe('drill_missing')
    expect(shareBlockerView('programme', ['too_many_media', 'source_internal_only'], prov()).code).toBe('too_many_media')
    expect(shareBlockerView('programme', ['source_internal_only', 'drill_internal_only'], prov()).code).toBe('source_internal_only')
  })

  it('orders a session structurally too', () => {
    expect(shareBlockerView('session', ['source_internal_only', 'unsupported_item'], prov()).code).toBe('unsupported_item')
    expect(shareBlockerView('session', ['drill_internal_only', 'board_missing'], prov()).code).toBe('board_missing')
  })

  it('orders a drill structurally too', () => {
    expect(shareBlockerView('drill', ['source_internal_only', 'media_missing'], prov()).code).toBe('media_missing')
    expect(shareBlockerView('drill', ['source_internal_only', 'media_internal_only'], prov()).code).toBe('source_internal_only')
  })
})

// =====================================================================
// Every reason has calm, code free copy
// =====================================================================
describe('copy for each reason', () => {
  const cases: Array<[('drill' | 'session' | 'programme'), string, RegExp]> = [
    ['drill', 'media_missing', /missing/],
    ['drill', 'media_path_invalid', /Upload it again/],
    ['session', 'drill_missing', /missing/],
    ['session', 'board_missing', /tactics board/],
    ['session', 'unsupported_item', /activity/],
    ['programme', 'pdf_missing', /PDF/],
    ['programme', 'too_many_weeks', /more weeks/],
    ['programme', 'too_many_media', /more files/],
    ['programme', 'snapshot_too_large', /too large/],
  ]

  for (const [noun, reason, matcher] of cases) {
    it(`${noun} / ${reason}`, () => {
      const v = shareBlockerView(noun, [reason], prov())
      expect(v.headline).toMatch(matcher)
    })
  }

  it('never leaks a reason code into the copy', () => {
    const every = [
      'no_weeks', 'unsupported_item', 'drill_missing', 'media_missing', 'pdf_missing', 'board_missing',
      'media_path_invalid', 'too_many_weeks', 'too_many_media', 'snapshot_too_large',
      'source_internal_only', 'template_internal_only', 'drill_internal_only', 'media_internal_only',
      'pdf_internal_only',
    ]
    for (const r of every) {
      for (const noun of ['drill', 'session', 'programme'] as const) {
        expect(shareBlockerView(noun, [r], prov()).headline).not.toContain('_')
      }
    }
  })

  it('falls back calmly on an unknown reason rather than guessing', () => {
    const v = shareBlockerView('session', ['something_new'], prov())
    expect(v.headline).toBe('This session cannot be shared publicly.')
    expect(v.action).toBe('none')
    expect(shareBlockerView('drill', [], prov()).headline).toBe('This drill cannot be shared publicly.')
  })
})

describe('the next step hint', () => {
  it('tells a coach where to go without naming another coach’s content', () => {
    expect(blockerContentHint('programme', 'no_weeks')).toContain('Add a week template')
    expect(blockerContentHint('programme', 'drill_internal_only')).toContain('Open each drill')
    expect(blockerContentHint('programme', 'template_internal_only')).toContain('Open each week')
    for (const code of ['no_weeks', 'drill_internal_only', 'media_internal_only', 'pdf_internal_only']) {
      expect(blockerContentHint('programme', code)).not.toContain('_')
    }
  })
})

describe('readProvenance', () => {
  it('accepts the server shape', () => {
    expect(readProvenance({ source: 'fa', restricted: { template: true, drill: false, media: false, pdf: false } })).toEqual({
      source: 'fa',
      restricted: { template: true, drill: false, media: false, pdf: false },
    })
  })

  it('falls back to no proven provenance on anything else', () => {
    for (const bad of [undefined, null, 'fa', [], { source: 'nonsense' }, { restricted: 'yes' }]) {
      expect(readProvenance(bad)).toEqual(EMPTY_PROVENANCE)
    }
  })

  it('never invents an England Football claim from a truthy value', () => {
    expect(readProvenance({ source: true }).source).toBe('none')
    expect(readProvenance({ restricted: { drill: 'yes' } }).restricted.drill).toBe(false)
  })
})
