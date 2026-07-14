// Storage policy matrix for the private `media` bucket. INTENDED contract
// (docs/security/policy-test-matrix.md and docs/security/storage-boundary.md):
// unauthenticated callers can do nothing; club content lives under the
// owning club's UUID as the first path folder and is readable by that
// club's members only; creating club content requires media.create;
// deleting it requires media.manage or being the object's uploader holding
// media.create; the crest subfolder ({club_id}/crest/) is club.manage
// territory; avatars (avatars/{user_id}/) are self service for every
// member, own folder only, readable within the owner's club; and there is
// deliberately no update policy, so in place replacement (upsert) is
// refused for everyone, managers included.
//
// Before 0027_storage_boundary the bucket policies distinguished only
// unauthenticated from authenticated (findings 1 and 2), so the parent and
// club isolation tests in this file FAILED against the migrations then on
// disk. 0027 is the remediation; do not weaken these assertions.
//
// Every object path is disposable and unique per run, under
// <club-uuid>/security-test/<unique-id>/ (or the fixture users' own avatar
// folders) in the local stack only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, anonClient, runId, serviceClient, signIn } from './stack'

const BUCKET = 'media'
const RUN = runId()
const PREFIX = `${CLUB_A}/security-test/${RUN}`
const PREFIX_B = `${CLUB_B}/security-test/${RUN}`
const CREST_PREFIX = `${CLUB_A}/crest`

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
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let parentId: string
  let outsider: SupabaseClient
  let outsiderId: string
  const anon = anonClient()
  const coachObject = `${PREFIX}/coach-object.txt`
  const outsiderObject = `${PREFIX_B}/outsider-object.txt`
  // Paths created outside the two run prefixes (avatars, crest) register
  // here so the cleanup removes them whatever each test's outcome was.
  const strayPaths: string[] = []

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    coachOne = (await signIn('coachOne')).client
    const parentUser = await signIn('parent')
    parent = parentUser.client
    parentId = parentUser.userId
    const outsiderUser = await signIn('outsider')
    outsider = outsiderUser.client
    outsiderId = outsiderUser.userId

    const { error } = await coachOne.storage
      .from(BUCKET)
      .upload(coachObject, body('created by coach one'))
    if (error) throw new Error(`could not create the coach fixture object: ${error.message}`)

    // Club B content, so the cross-club read tests have a target on the
    // other side of the boundary too. The outsider is a coach of club B
    // holding media.create there, so this also proves an authorised member
    // of another club keeps their own upload path.
    const { error: bErr } = await outsider.storage
      .from(BUCKET)
      .upload(outsiderObject, body('created by the club B coach'))
    if (bErr) throw new Error(`could not create the club B fixture object: ${bErr.message}`)
  })

  afterAll(async () => {
    const service = serviceClient()
    for (const prefix of [PREFIX, PREFIX_B]) {
      const { data } = await service.storage.from(BUCKET).list(prefix)
      const names = (data ?? []).map((o) => `${prefix}/${o.name}`)
      if (names.length > 0) await service.storage.from(BUCKET).remove(names)
    }
    if (strayPaths.length > 0) await service.storage.from(BUCKET).remove(strayPaths)
  })

  // ---- Unauthenticated callers -----------------------------------------

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

  // ---- Authorised club content flows ------------------------------------

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

  it('a coach can create an FA import shaped asset under the club prefix', async () => {
    // The FA import Edge Functions write with the caller's JWT to
    // {club_id}/{uuid}-{slug}.{ext}; this replays that exact shape.
    const path = `${CLUB_A}/${crypto.randomUUID()}-security-test-${RUN}-fa-asset.pdf`
    strayPaths.push(path)
    const { error } = await coachOne.storage
      .from(BUCKET)
      .upload(path, new Blob(['%PDF-fixture'], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
      })
    expect(error, 'the FA import asset shape must stay writable for coaches').toBeNull()
  })

  it('a coach cannot create an object outside a club prefix', async () => {
    const path = `security-test/${RUN}/unprefixed.txt`
    strayPaths.push(path)
    const { error } = await coachOne.storage.from(BUCKET).upload(path, body('unprefixed'))
    expect(error, 'paths without the club UUID as the first folder are dead').not.toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('an admin holding media.manage can delete an object uploaded by a coach', async () => {
    const path = `${PREFIX}/coach-owned-for-admin-delete.txt`
    const { error: seedErr } = await coachOne.storage.from(BUCKET).upload(path, body('managed'))
    expect(seedErr).toBeNull()
    const { error } = await admin.storage.from(BUCKET).remove([path])
    expect(error).toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('a parent can read club content through the signed URL flow', async () => {
    const { data, error } = await parent.storage.from(BUCKET).createSignedUrl(coachObject, 60)
    expect(error, 'parent signed URL creation must keep working').toBeNull()
    const res = await fetch(data!.signedUrl)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('created by coach one')
  })

  // ---- Parent write lockout ----------------------------------------------

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

  // The delete-then-recreate path is how replacement could be reached
  // without an update policy; both halves must be refused independently.
  it('parent must not delete then recreate another object path', async () => {
    await parent.storage.from(BUCKET).remove([coachObject])
    expect(await objectExists(coachObject), 'the delete half must be refused').toBe(true)
    const { error: createErr } = await parent.storage
      .from(BUCKET)
      .upload(coachObject, body('recreated by parent'))
    expect(createErr, 'the recreate half must be refused').not.toBeNull()
    expect(await objectText(coachObject)).toBe('created by coach one')
  })

  // ---- Upsert stays closed for everyone ----------------------------------

  it('replace via upsert is refused even for the object own uploader', async () => {
    const { error } = await coachOne.storage
      .from(BUCKET)
      .upload(coachObject, body('replaced by uploader'), { upsert: true })
    expect(error, 'there is deliberately no update policy on the bucket').not.toBeNull()
    expect(await objectText(coachObject)).toBe('created by coach one')
  })

  it('replace via upsert is refused even for an admin holding media.manage', async () => {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(coachObject, body('replaced by admin'), { upsert: true })
    expect(error, 'in place replacement is closed for managers too').not.toBeNull()
    expect(await objectText(coachObject)).toBe('created by coach one')
  })

  // ---- Club isolation ------------------------------------------------------

  it('a member of another club must not read this club object', async () => {
    const { error } = await outsider.storage.from(BUCKET).download(coachObject)
    expect(error, 'cross-club object read must be refused').not.toBeNull()
  })

  it('a member of another club must not list this club objects', async () => {
    const { data, error } = await outsider.storage.from(BUCKET).list(PREFIX)
    if (error === null) expect(data ?? []).toEqual([])
  })

  it('a member of another club must not create an object under this club prefix', async () => {
    const path = `${PREFIX}/outsider-created.txt`
    try {
      const { error } = await outsider.storage.from(BUCKET).upload(path, body('outsider'))
      expect(error, 'cross-club create must be refused').not.toBeNull()
      expect(await objectExists(path)).toBe(false)
    } finally {
      await serviceClient().storage.from(BUCKET).remove([path])
    }
  })

  it('a member of another club must not create a signed URL for this club object', async () => {
    const { data, error } = await outsider.storage.from(BUCKET).createSignedUrl(coachObject, 60)
    expect(error, 'cross-club signed URL creation must be refused').not.toBeNull()
    expect(data).toBeNull()
  })

  it('a parent must not read or list another club prefix', async () => {
    const { error: readErr } = await parent.storage.from(BUCKET).download(outsiderObject)
    expect(readErr, 'cross-club object read must be refused for parents too').not.toBeNull()
    const { data, error } = await parent.storage.from(BUCKET).list(PREFIX_B)
    if (error === null) expect(data ?? []).toEqual([])
  })

  // ---- Crest ({club_id}/crest/): club.manage territory ---------------------

  it('an admin holding club.manage can create and delete a crest object', async () => {
    const path = `${CREST_PREFIX}/security-test-${RUN}-crest.png`
    strayPaths.push(path)
    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(path, new Blob(['png-fixture'], { type: 'image/png' }), { contentType: 'image/png' })
    expect(uploadErr, 'the crest workflow must keep working for club.manage').toBeNull()

    // The crest renders for every member of the club.
    const { error: memberReadErr } = await coachOne.storage.from(BUCKET).download(path)
    expect(memberReadErr, 'club members must be able to render the crest').toBeNull()

    const { error: removeErr } = await admin.storage.from(BUCKET).remove([path])
    expect(removeErr, 'replacing a crest removes the old object via club.manage').toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('a coach holding media.create must not write into the crest folder', async () => {
    const path = `${CREST_PREFIX}/security-test-${RUN}-coach-crest.png`
    strayPaths.push(path)
    const { error } = await coachOne.storage.from(BUCKET).upload(path, body('not a crest'))
    expect(error, 'the crest folder requires club.manage, not media.create').not.toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('a coach must not delete a crest object', async () => {
    const path = `${CREST_PREFIX}/security-test-${RUN}-crest-keep.png`
    strayPaths.push(path)
    const { error: seedErr } = await admin.storage
      .from(BUCKET)
      .upload(path, new Blob(['png-fixture'], { type: 'image/png' }), { contentType: 'image/png' })
    expect(seedErr).toBeNull()
    await coachOne.storage.from(BUCKET).remove([path])
    expect(await objectExists(path), 'the crest a coach tried to delete must still exist').toBe(true)
  })

  it('an admin must not create a crest under another club prefix', async () => {
    const path = `${CLUB_B}/crest/security-test-${RUN}-foreign-crest.png`
    strayPaths.push(path)
    const { error } = await admin.storage.from(BUCKET).upload(path, body('foreign'))
    expect(error, 'club.manage is scoped to the caller own club prefix').not.toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  // ---- Avatars (avatars/{user_id}/): own folder only ------------------------

  it('any member, parents included, can create, read and delete their own avatar', async () => {
    const path = `avatars/${parentId}/security-test-${RUN}-avatar.png`
    strayPaths.push(path)
    const { error: uploadErr } = await parent.storage
      .from(BUCKET)
      .upload(path, new Blob(['png-fixture'], { type: 'image/png' }), { contentType: 'image/png' })
    expect(uploadErr, 'own avatar upload is self service for every member').toBeNull()

    const { error: readErr } = await parent.storage.from(BUCKET).download(path)
    expect(readErr).toBeNull()

    // Members of the same club render each other's avatars.
    const { error: clubReadErr } = await coachOne.storage.from(BUCKET).download(path)
    expect(clubReadErr, 'club members must be able to render the avatar').toBeNull()

    // A member of another club must not.
    const { error: outsiderReadErr } = await outsider.storage.from(BUCKET).download(path)
    expect(outsiderReadErr, 'avatars must not leak across clubs').not.toBeNull()

    const { error: removeErr } = await parent.storage.from(BUCKET).remove([path])
    expect(removeErr, 'replacing an avatar removes the old object as its owner').toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('a member must not write into another member avatar folder', async () => {
    const path = `avatars/${outsiderId}/security-test-${RUN}-not-yours.png`
    strayPaths.push(path)
    const { error } = await parent.storage.from(BUCKET).upload(path, body('not yours'))
    expect(error, 'avatar writes are locked to the caller own folder').not.toBeNull()
    expect(await objectExists(path)).toBe(false)
  })

  it('a member must not delete another member avatar object', async () => {
    const path = `avatars/${outsiderId}/security-test-${RUN}-keep.png`
    strayPaths.push(path)
    const { error: seedErr } = await outsider.storage
      .from(BUCKET)
      .upload(path, new Blob(['png-fixture'], { type: 'image/png' }), { contentType: 'image/png' })
    expect(seedErr, 'a member of another club still writes their own avatar folder').toBeNull()
    await coachOne.storage.from(BUCKET).remove([path])
    expect(await objectExists(path), 'the avatar another member tried to delete must exist').toBe(true)
  })
})
