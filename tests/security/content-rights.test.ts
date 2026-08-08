// The content rights classification write path (0043_content_rights_fa_lock).
//
// Intended contract (docs/security/content-sharing-boundary.md):
//   * Classification is an ordinary RLS backed UPDATE on the row's own table.
//     The existing owner-or-manager UPDATE policy is the authority: an owning
//     coach may classify their own content, a manager may classify any club
//     content, a parent may classify nothing, and no one may classify another
//     club's content.
//   * England Football derived content is locked at internal_only by a
//     BEFORE INSERT OR UPDATE trigger on all five rights carrying tables. The
//     lock is provenance based (an England Football Learning source_url,
//     drills.source_key, or the England Football Learning source_label) and is
//     never inferred from the rights value.
//   * The lock refuses every path equally: the owning coach, a manager, an
//     admin, and the service role. It is a data rule, not a permission.
//   * Lowering to internal_only is always allowed, including on a locked row.
//   * A row that acquires an England Football source while already classified
//     as publishable is refused rather than silently left public.
//   * Classifying a source does not classify anything nested inside it, so an
//     aggregate stays blocked while a nested item is club only.
//
// All fixtures are synthetic. Nothing here is real production data.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const MARK = `sec-rights-${RUN}`

const FA_URL = 'https://learn.englandfootball.com/resources/session/abc'
const FA_CDN_URL = 'https://cdn.englandfootball.com/img/abc.png'
const OTHER_URL = 'https://example.com/a-drill'

let svc: SupabaseClient
let coachOne: SupabaseClient
let manager: SupabaseClient
let parent: SupabaseClient
let outsider: SupabaseClient
let coachOneId: string
let coachTwoId: string

const drills: string[] = []
const media: string[] = []
const sessions: string[] = []

async function makeDrill(opts: {
  owner: string | null
  rights?: 'internal_only' | 'public_link_only' | 'public_full'
  sourceUrl?: string | null
  sourceLabel?: string | null
  sourceKey?: string | null
  club?: string
}): Promise<string> {
  const { data, error } = await svc
    .from('drills')
    .insert({
      club_id: opts.club ?? CLUB_A,
      title: `${MARK}-drill`,
      created_by: opts.owner,
      rights: opts.rights ?? 'internal_only',
      source_url: opts.sourceUrl ?? null,
      source_label: opts.sourceLabel ?? null,
      source_key: opts.sourceKey ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeDrill: ${error.message}`)
  drills.push(data!.id)
  return data!.id
}

async function makeMedia(opts: { sourceUrl?: string | null; club?: string }): Promise<string> {
  const { data, error } = await svc
    .from('media')
    .insert({
      club_id: opts.club ?? CLUB_A,
      name: `${MARK}-media`,
      type: 'image',
      rights: 'internal_only',
      source_url: opts.sourceUrl ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeMedia: ${error.message}`)
  media.push(data!.id)
  return data!.id
}

async function makeSession(opts: { owner: string; drillIds?: string[]; club?: string }): Promise<string> {
  const activities = (opts.drillIds ?? []).map((id) => ({ phase: 'Skill', drill_id: id, duration: 10 }))
  const { data, error } = await svc
    .from('sessions')
    .insert({
      club_id: opts.club ?? CLUB_A,
      coach_id: opts.owner,
      name: `${MARK}-session`,
      rights: 'internal_only',
      activities,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeSession: ${error.message}`)
  sessions.push(data!.id)
  return data!.id
}

async function rightsOf(table: string, id: string): Promise<string> {
  const { data, error } = await svc.from(table).select('rights').eq('id', id).single()
  if (error) throw new Error(`rightsOf: ${error.message}`)
  return (data as { rights: string }).rights
}

beforeAll(async () => {
  svc = serviceClient()
  coachOne = (await signIn('coachOne')).client
  manager = (await signIn('manager')).client
  parent = (await signIn('parent')).client
  outsider = (await signIn('outsider')).client
  coachOneId = (await signIn('coachOne')).userId
  coachTwoId = (await signIn('coachTwo')).userId
})

afterAll(async () => {
  if (sessions.length) await svc.from('sessions').delete().in('id', sessions)
  if (drills.length) await svc.from('drills').delete().in('id', drills)
  if (media.length) await svc.from('media').delete().in('id', media)
})

// =====================================================================
// Who may classify
// =====================================================================
describe('classification authority is the existing owner-or-manager update arm', () => {
  it('an owning coach can classify their own club original drill', async () => {
    const id = await makeDrill({ owner: coachOneId })
    const { data, error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id, rights')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(await rightsOf('drills', id)).toBe('public_full')
  })

  it("a coach cannot classify another coach's drill", async () => {
    const id = await makeDrill({ owner: coachTwoId })
    const { data, error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    // RLS returns no row rather than an error; either way nothing changed.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('a manager can classify any club drill', async () => {
    const id = await makeDrill({ owner: coachTwoId })
    const { error } = await manager.from('drills').update({ rights: 'public_link_only' }).eq('id', id).select('id')
    expect(error).toBeNull()
    expect(await rightsOf('drills', id)).toBe('public_link_only')
  })

  it('a parent can classify nothing', async () => {
    const id = await makeDrill({ owner: coachOneId })
    const { data } = await parent.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(data ?? []).toHaveLength(0)
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('a member of another club cannot classify this club’s drill', async () => {
    const id = await makeDrill({ owner: coachOneId })
    const { data } = await outsider.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(data ?? []).toHaveLength(0)
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('a client cannot classify a row in another club, even one it owns nothing in', async () => {
    const id = await makeDrill({ owner: null, club: CLUB_B })
    const { data } = await manager.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(data ?? []).toHaveLength(0)
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })
})

// =====================================================================
// The England Football lock
// =====================================================================
describe('England Football derived content is locked at club only', () => {
  it('refuses an owning coach raising an FA sourced drill', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('refuses public_link_only just as firmly as public_full', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne.from('drills').update({ rights: 'public_link_only' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('refuses a manager', async () => {
    const id = await makeDrill({ owner: coachTwoId, sourceUrl: FA_URL })
    const { error } = await manager.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('refuses the service role: the lock is a data rule, not a permission', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await svc.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('locks on the drill source_key alone, with no source_url', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceKey: `${FA_URL}#activity-2` })
    const { error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('locks on the England Football Learning source label alone', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceLabel: 'England Football Learning' })
    const { error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('locks the FA CDN host as well as the learning host', async () => {
    const id = await makeMedia({ sourceUrl: FA_CDN_URL })
    const { error } = await svc.from('media').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('media', id)).toBe('internal_only')
  })

  it('allows lowering a locked row back to club only', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne.from('drills').update({ rights: 'internal_only' }).eq('id', id).select('id')
    expect(error).toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('allows an ordinary edit of a locked row that leaves its level alone', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne.from('drills').update({ summary: 'edited' }).eq('id', id).select('id')
    expect(error).toBeNull()
  })

  it('refuses an insert that arrives already classified from an FA source', async () => {
    const { error } = await svc
      .from('drills')
      .insert({ club_id: CLUB_A, title: `${MARK}-fa-insert`, rights: 'public_full', source_url: FA_URL })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('refuses attaching an FA source to a row that is already publishable', async () => {
    const id = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { error } = await coachOne.from('drills').update({ source_url: FA_URL }).eq('id', id).select('id')
    expect(error).not.toBeNull()
    // Unchanged: it is still publishable, and still has no FA source.
    const { data } = await svc.from('drills').select('rights, source_url').eq('id', id).single()
    expect((data as { rights: string }).rights).toBe('public_full')
    expect((data as { source_url: string | null }).source_url).toBeNull()
  })

  // The two-save bypass. Rule 1 alone is cosmetic: the source columns are
  // ordinary editable columns, so clearing the Source link field (one save,
  // rights untouched) leaves nothing for rule 1 to see on the second save.
  it('refuses clearing the source of an FA sourced row, so the lock cannot be stripped', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne
      .from('drills')
      .update({ source_url: null, source_label: null })
      .eq('id', id)
      .select('id')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
    const { data } = await svc.from('drills').select('source_url').eq('id', id).single()
    expect((data as { source_url: string | null }).source_url).toBe(FA_URL)
  })

  it('refuses clearing the source and raising the level in one statement', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne
      .from('drills')
      .update({ source_url: null, source_label: null, rights: 'public_full' })
      .eq('id', id)
      .select('id')
    expect(error).not.toBeNull()
    expect(await rightsOf('drills', id)).toBe('internal_only')
  })

  it('refuses clearing the drill source key, the other England Football evidence', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceKey: `${FA_URL}#activity-2` })
    const { error } = await coachOne.from('drills').update({ source_key: null }).eq('id', id).select('id')
    expect(error).not.toBeNull()
  })

  it('refuses the strip on every table, not only drills', async () => {
    const mediaId = await makeMedia({ sourceUrl: FA_URL })
    const { error } = await svc.from('media').update({ source_url: null }).eq('id', mediaId).select('id')
    expect(error).not.toBeNull()
    for (const table of ['programmes', 'templates', 'sessions'] as const) {
      const row: Record<string, unknown> = {
        club_id: CLUB_A,
        name: `${MARK}-strip-${table}`,
        rights: 'internal_only',
        source_url: FA_URL,
      }
      if (table === 'sessions') row.coach_id = coachOneId
      if (table === 'programmes') row.weeks = 1
      const { data, error: insertError } = await svc.from(table).insert(row).select('id').single()
      expect(insertError).toBeNull()
      const { error: stripError } = await svc
        .from(table)
        .update({ source_url: null })
        .eq('id', (data as { id: string }).id)
        .select('id')
      expect(stripError, `${table} must refuse the strip`).not.toBeNull()
      await svc.from(table).delete().eq('id', (data as { id: string }).id)
    }
  })

  it('allows swapping one England Football source for another', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
    const { error } = await coachOne
      .from('drills')
      .update({ source_url: 'https://learn.englandfootball.com/resources/session/other' })
      .eq('id', id)
      .select('id')
    expect(error).toBeNull()
  })

  it('allows clearing the source of a row that was never England Football', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: OTHER_URL })
    const { error } = await coachOne.from('drills').update({ source_url: null }).eq('id', id).select('id')
    expect(error).toBeNull()
  })

  it('matches the URL parser on userinfo, a port and stray whitespace', async () => {
    // The 0038 host extraction stopped at the first colon and treated userinfo
    // as part of the host, so it disagreed with the WHATWG parser the two
    // TypeScript readers use, and it disagreed the permissive way.
    const cases: Array<[string, boolean]> = [
      ['https://x@learn.englandfootball.com/a', true],
      ['https://learn.englandfootball.com:443/a', true],
      ['  https://cdn.englandfootball.com/a  ', true],
      // The WHATWG parser accepts backslashes and any run of slashes after
      // a special scheme, including none; all of these carry the host to
      // the JS readers, so the database must lock them too.
      ['https:\\learn.englandfootball.com\\a', true],
      ['https:/learn.englandfootball.com/a', true],
      ['https:learn.englandfootball.com/a', true],
      // The WHATWG host parser percent-decodes, so an escaped hostname is
      // still the England Football host to the JS readers.
      ['https://%6cearn.englandfootball.com/a', true],
      ['https://learn%2Eenglandfootball.com/a', true],
      ['https://learn.englandfootball.com%40evil.test/', false],
      ['https://learn.englandfootball.com:8080@evil.test/', false],
      ['https://learn.englandfootball.com.evil.test/a', false],
      ['https://notenglandfootball.com/a', false],
      ['learn.englandfootball.com/a', false],
    ]
    for (const [url, expected] of cases) {
      const { data, error } = await svc.rpc('content_rights_is_fa_url', { p_url: url })
      expect(error).toBeNull()
      expect(data, url).toBe(expected)
    }
  })

  it('does not lock a non England Football source: that is evidence, not proof', async () => {
    const id = await makeDrill({ owner: coachOneId, sourceUrl: OTHER_URL })
    const { error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).toBeNull()
    expect(await rightsOf('drills', id)).toBe('public_full')
  })

  it('does not lock a club original row with no source at all', async () => {
    const id = await makeDrill({ owner: coachOneId })
    const { error } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', id).select('id')
    expect(error).toBeNull()
  })
})

// =====================================================================
// Nested content stays independently authoritative
// =====================================================================
describe('classifying a source does not classify what is inside it', () => {
  it('a session classified public_full still has a club only drill inside it', async () => {
    const nested = await makeDrill({ owner: coachOneId })
    const sessionId = await makeSession({ owner: coachOneId, drillIds: [nested] })
    const { error } = await coachOne.from('sessions').update({ rights: 'public_full' }).eq('id', sessionId).select('id')
    expect(error).toBeNull()
    expect(await rightsOf('sessions', sessionId)).toBe('public_full')
    // The drill it references is untouched, so the aggregate is still blocked.
    expect(await rightsOf('drills', nested)).toBe('internal_only')
  })

  it('a coach cannot classify a nested drill owned by someone else', async () => {
    const nested = await makeDrill({ owner: coachTwoId })
    const sessionId = await makeSession({ owner: coachOneId, drillIds: [nested] })
    await coachOne.from('sessions').update({ rights: 'public_full' }).eq('id', sessionId).select('id')
    const { data } = await coachOne.from('drills').update({ rights: 'public_full' }).eq('id', nested).select('id')
    expect(data ?? []).toHaveLength(0)
    expect(await rightsOf('drills', nested)).toBe('internal_only')
  })
})

// =====================================================================
// The lock is installed everywhere it is meant to be
// =====================================================================
describe('the lock covers every rights carrying table', () => {
  it('all five triggers exist', async () => {
    const { data, error } = await svc.rpc('content_rights_is_fa_url', { p_url: FA_URL })
    expect(error).toBeNull()
    expect(data).toBe(true)
    for (const table of ['drills', 'sessions', 'programmes', 'templates', 'media'] as const) {
      const id =
        table === 'drills'
          ? await makeDrill({ owner: coachOneId, sourceUrl: FA_URL })
          : table === 'media'
          ? await makeMedia({ sourceUrl: FA_URL })
          : null
      if (id) {
        const { error: e } = await svc.from(table).update({ rights: 'public_full' }).eq('id', id).select('id')
        expect(e, `${table} must refuse an FA sourced promotion`).not.toBeNull()
      }
    }
    // programmes, templates and sessions carry no source_key, so one insert
    // apiece proves the trigger is attached.
    for (const table of ['programmes', 'templates', 'sessions'] as const) {
      const base: Record<string, unknown> = {
        club_id: CLUB_A,
        name: `${MARK}-${table}`,
        rights: 'public_full',
        source_url: FA_URL,
      }
      if (table === 'sessions') base.coach_id = coachOneId
      if (table === 'programmes') base.weeks = 1
      const { error: e } = await svc.from(table).insert(base).select('id')
      expect(e, `${table} must refuse an FA sourced insert above club only`).not.toBeNull()
    }
  })
})
