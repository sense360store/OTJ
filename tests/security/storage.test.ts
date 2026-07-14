// Storage policy matrix for the private `media` bucket. INTENDED contract
// (docs/security/policy-test-matrix.md): unauthenticated callers can do
// nothing; members holding media.create can upload, read and delete their
// own objects; the parent role can read via the app's signed URL flow but
// never create, replace or delete objects; and objects are isolated to the
// owning club.
//
// The CURRENT policies (0001_init) distinguish only unauthenticated from
// authenticated (findings 1 and 2), so the parent and club isolation tests
// in this file FAIL against the current migrations. Those failures are the
// evidence for the remediation PR; do not weaken the assertions to make
// this file green.
//
// Every object path is disposable and unique per run, under
// security-test/<unique-id>/ in the local stack only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, runId, serviceClient, signIn } from './stack'

const BUCKET = 'media'
const RUN = runId()
const PREFIX = `security-test/${RUN}`

function body(text: string): Blob {
  return new Blob([text], { type: 'text/plain' })
}

async function objectExists(path: string): Promise<boolean> {
  const { error } = await serviceClient().storage.from(BUCKET).download(path)
  return !error
}

async function objectText(path: string): Promise<string | null> {
  const { data, error } = await serviceClient().storage.from(BUCKET).download(path)
  if (error || !data) return null
  return await data.text()
}

describe('media bucket storage policies', () => {
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  const anon = anonClient()
  const coachObject = `${PREFIX}/coach-object.txt`

  beforeAll(async () => {
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { error } = await coachOne.storage
      .from(BUCKET)
      .upload(coachObject, body('created by coach one'))
    if (error) throw new Error(`could not create the coach fixture object: ${error.message}`)
  })

  afterAll(async () => {
    const service = serviceClient()
    const { data } = await service.storage.from(BUCKET).list(PREFIX)
    const names = (data ?? []).map((o) => `${PREFIX}/${o.name}`)
    if (names.length > 0) await service.storage.from(BUCKET).remove(names)
  })

  it('unauthenticated caller cannot list the bucket', async () => {
    const { data, error } = await anon.storage.from(BUCKET).list(PREFIX)
    if (error === null) expect(data ?? []).toEqual([])
  })

  it('unauthenticated caller cannot read an object', async () => {
    const { error } = await anon.storage.from(BUCKET).download(coachObject)
    expect(error).not.toBeNull()
  })

  it('unauthenticated caller cannot create an object', async () => {
    const path = `${PREFIX}/anon-created.txt`
    const { error } = await anon.storage.from(BUCKET).upload(path, body('anon'))
    expect(error).not.toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('unauthenticated caller cannot delete an object', async () => {
    await anon.storage.from(BUCKET).remove([coachObject])
    expect(await objectExists(coachObject)).toBe(true)
  })

  it('a coach holding media.create can upload, list, read and delete their own object', async () => {
    const path = `${PREFIX}/coach-lifecycle.txt`
    const { error: uploadErr } = await coachOne.storage.from(BUCKET).upload(path, body('lifecycle'))
    expect(uploadErr).toBeNull()

    const { data: listing, error: listErr } = await coachOne.storage.from(BUCKET).list(PREFIX)
    expect(listErr).toBeNull()
    expect((listing ?? []).map((o) => o.name)).toContain('coach-lifecycle.txt')

    const { data: file, error: readErr } = await coachOne.storage.from(BUCKET).download(path)
    expect(readErr).toBeNull()
    expect(await file?.text()).toBe('lifecycle')

    const { error: removeErr } = await coachOne.storage.from(BUCKET).remove([path])
    expect(removeErr).toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  // EXPECTED FAILURE before remediation (finding 2): the current bucket
  // policies admit any authenticated user, so the parent upload succeeds
  // and this test is red. It is the evidence for the remediation PR.
  it('parent must not create objects', async () => {
    const path = `${PREFIX}/parent-created.txt`
    try {
      const { error } = await parent.storage.from(BUCKET).upload(path, body('parent'))
      expect(error, 'parent upload must be refused by the storage policies').not.toBeNull()
      expect(await objectExists(path)).toBe(false)
    } finally {
      await serviceClient().storage.from(BUCKET).remove([path])
    }
  })

  // EXPECTED FAILURE before remediation (finding 2): the delete policy also
  // admits any authenticated user, so a parent can remove another member's
  // object today.
  it('parent must not delete an object created by another user', async () => {
    const path = `${PREFIX}/coach-owned-for-delete.txt`
    const { error: seedErr } = await coachOne.storage.from(BUCKET).upload(path, body('keep me'))
    expect(seedErr).toBeNull()
    try {
      await parent.storage.from(BUCKET).remove([path])
      expect(
        await objectExists(path),
        'the object a parent tried to delete must still exist',
      ).toBe(true)
    } finally {
      await serviceClient().storage.from(BUCKET).remove([path])
    }
  })

  // Replacement is upload with upsert, which the storage API treats as an
  // update. Intended: refused for parents; the content must be unchanged
  // afterwards whatever the API returns.
  it('parent must not replace an existing object', async () => {
    const { error } = await parent.storage
      .from(BUCKET)
      .upload(coachObject, body('replaced by parent'), { upsert: true })
    expect(error, 'parent replace must be refused by the storage policies').not.toBeNull()
    expect(await objectText(coachObject)).toBe('created by coach one')
  })

  // EXPECTED FAILURE before remediation (finding 1, club isolation): the
  // current policies scope nothing to the club, so a member of another club
  // can read and list this club's objects. The target contract isolates
  // objects per club even though the production seed has one club today.
  it('a member of another club must not read this club object', async () => {
    const { error } = await outsider.storage.from(BUCKET).download(coachObject)
    expect(error, 'cross-club object read must be refused').not.toBeNull()
  })

  it('a member of another club must not list this club objects', async () => {
    const { data, error } = await outsider.storage.from(BUCKET).list(PREFIX)
    if (error === null) expect(data ?? []).toEqual([])
  })
})
