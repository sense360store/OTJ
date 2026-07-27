// media.storage_path: the canonical path boundary for public sharing
// (0042_public_media_path_boundary).
//
// Intended contract (docs/security/content-sharing-boundary.md):
//   * A stored media object lives at the canonical path of its OWN club:
//     {club_id}/{segment}[/{segment}...] , each segment starting alphanumeric
//     and drawn from [A-Za-z0-9._-], never the avatars namespace, never a
//     traversal, encoded or control-character form. The CHECK constraint
//     media_storage_path_canonical is the boundary; the Deno and browser
//     validators mirror it.
//   * At most one media row may name any stored object
//     (media_storage_path_unique), so the rights class of a row can never be
//     detached from the bytes it protects by pointing a second, weaker row at
//     the same key.
//   * read_public_share signs the LIVE media row's storage_path, revalidated,
//     never the path frozen in the snapshot. A snapshot whose _path disagrees
//     with the live row fails the WHOLE share closed, neutrally.
//   * Changing a storage_path (or a club_id) invalidates every dependent
//     active share and records the reason as path_changed.
//   * public.is_canonical_media_path stays executable by the writing role,
//     because a CHECK constraint is evaluated with the writer's privileges.
//
// The three implementations of the grammar are pinned to one another by
// tests/fixtures/media-path-cases.json: this suite asserts the Postgres one,
// supabase/functions/_shared/mediaPath_test.ts the Deno one and
// src/lib/mediaPath.test.ts the browser one, all over the same case list.
//
// All fixtures are synthetic and created through the service role; out of band
// verification of the private tables is done through the local database
// container as the owner. Nothing here is real production data.

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, runId, runSqlInContainer, serviceClient, signIn } from './stack'

interface PathCase {
  name: string
  path: string
  valid: boolean
}
interface Fixture {
  clubId: string
  otherClubId: string
  cases: PathCase[]
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/media-path-cases.json', import.meta.url), 'utf8'),
) as Fixture

const RUN = runId()
const MARK = `sec-mediapath-${RUN}`

// A path that is canonical for CLUB_A, unique per call so the unique index does
// not make two unrelated assertions collide.
let counter = 0
function goodPath(club = CLUB_A): string {
  counter += 1
  return `${club}/${RUN}-${counter}-clip.mp4`
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

let admin: SupabaseClient
const createdMedia: string[] = []

async function insertMedia(fields: Record<string, unknown>) {
  return await admin
    .from('media')
    .insert({ club_id: CLUB_A, name: MARK, type: 'video', ...fields })
    .select('id')
    .single()
}

beforeAll(() => {
  admin = serviceClient()
})

afterAll(async () => {
  if (createdMedia.length > 0) await admin.from('media').delete().in('id', createdMedia)
})

describe('the canonical media path grammar in Postgres', () => {
  it('agrees with the shared fixture on every representable case', () => {
    // A Postgres text value cannot hold a NUL byte at all, so that case is
    // unrepresentable in the column rather than rejected by the grammar.
    const cases = fixture.cases.filter((c) => !c.path.includes('\u0000'))
    expect(cases.length).toBeGreaterThan(40)

    const payload = JSON.stringify({ clubId: fixture.clubId, cases })
    expect(payload).not.toContain('$json$')

    const sql = `
      with fx as (select $json$${payload}$json$::jsonb as j),
      c as (
        select e->>'name' as name, e->>'path' as path, (e->>'valid')::boolean as expected,
               (select j->>'clubId' from fx)::uuid as club
        from fx, jsonb_array_elements((select j->'cases' from fx)) as e
      )
      select coalesce(string_agg(name, ' | '), 'none') as mismatches
      from c where public.is_canonical_media_path(path, club) is distinct from expected;`

    expect(runSqlInContainer(sql)).toContain('none')
  })

  // Deliberately NOT revoked. A CHECK constraint is evaluated with the
  // privileges of the role performing the write, so taking EXECUTE away turns
  // every media insert and update by a coach into "permission denied for
  // function is_canonical_media_path" (42501) instead of a clean constraint
  // violation. The function is a pure predicate over two scalars: it reads no
  // table and discloses nothing the caller did not already supply.
  it('stays executable by the writing role so the constraint can bite', () => {
    const sql = `select
      has_function_privilege('authenticated', 'public.is_canonical_media_path(text, uuid)', 'execute')::text;`
    expect(runSqlInContainer(sql).trim()).toBe('true')
  })
})

describe('the storage_path CHECK constraint', () => {
  it('accepts a canonical same club path', async () => {
    const { data, error } = await insertMedia({ storage_path: goodPath(), rights: 'internal_only' })
    expect(error).toBeNull()
    if (data) createdMedia.push(data.id as string)
  })

  it('accepts media with no stored object', async () => {
    const { data, error } = await insertMedia({
      storage_path: null,
      type: 'youtube',
      yt_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      rights: 'public_full',
    })
    expect(error).toBeNull()
    if (data) createdMedia.push(data.id as string)
  })

  // The service role bypasses RLS but never a CHECK constraint, so each of
  // these is refused by the boundary itself rather than by a policy.
  const refused: Array<[string, string]> = [
    ['another club prefix', `${CLUB_B}/${RUN}-cross.mp4`],
    ['the avatars namespace', `avatars/${CLUB_A}/${RUN}-face.jpg`],
    ['a nested avatars namespace', `${CLUB_A}/avatars/${RUN}-face.jpg`],
    ['a leading slash', `/${CLUB_A}/${RUN}-x.mp4`],
    ['a dot dot traversal', `${CLUB_A}/../${CLUB_B}/${RUN}-x.mp4`],
    ['an encoded traversal', `${CLUB_A}/%2e%2e/${RUN}-x.mp4`],
    ['an encoded separator', `${CLUB_A}%2f${RUN}-x.mp4`],
    ['a backslash', `${CLUB_A}\\${RUN}-x.mp4`],
    ['an empty segment', `${CLUB_A}//${RUN}-x.mp4`],
    ['a trailing slash', `${CLUB_A}/${RUN}-x.mp4/`],
    ['an absolute url', `https://evil.test/${CLUB_A}/${RUN}-x.mp4`],
    ['a bare club prefix with no separator', `${CLUB_A}9/${RUN}-x.mp4`],
    ['a control character', `${CLUB_A}/${RUN}\n-x.mp4`],
  ]

  it.each(refused)('refuses %s', async (_label, path) => {
    const { data, error } = await insertMedia({ storage_path: path, rights: 'public_full' })
    if (data) createdMedia.push(data.id as string)
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toMatch(/media_storage_path_canonical|violates check constraint/i)
  })
})

describe('the one object one row rule', () => {
  it('refuses a second media row naming an existing object', async () => {
    const shared = goodPath()
    const first = await insertMedia({ storage_path: shared, rights: 'internal_only' })
    expect(first.error).toBeNull()
    if (first.data) createdMedia.push(first.data.id as string)

    // The duplicate path attack: a public_full row naming an internal_only
    // row's object would inherit access to bytes it was never classified for.
    const second = await insertMedia({ storage_path: shared, rights: 'public_full' })
    if (second.data) createdMedia.push(second.data.id as string)
    expect(second.error).not.toBeNull()
    expect(second.error?.message ?? '').toMatch(/media_storage_path_unique|duplicate key/i)
  })
})

describe('a coach cannot move a media row outside its club namespace', () => {
  it('refuses an update to another club, an avatar and a traversal alike', async () => {
    const coach = await signIn('coachOne')
    const { data, error } = await insertMedia({
      storage_path: goodPath(),
      rights: 'internal_only',
      created_by: coach.userId,
    })
    expect(error).toBeNull()
    const id = data?.id as string
    createdMedia.push(id)

    for (const path of [
      `${CLUB_B}/${RUN}-stolen.mp4`,
      `avatars/${coach.userId}/${RUN}-face.jpg`,
      `${CLUB_A}/../${CLUB_B}/${RUN}-x.mp4`,
    ]) {
      const res = await coach.client.from('media').update({ storage_path: path }).eq('id', id)
      expect(res.error).not.toBeNull()
    }

    // The row is untouched.
    const after = runSqlInContainer(
      `select storage_path from public.media where id = ${sqlLiteral(id)}::uuid;`,
    )
    expect(after).not.toContain(CLUB_B)
    expect(after).not.toContain('avatars/')
  })
})

// The read path assertions run entirely through the database container:
// read_public_share is service_role only, needs a request.jwt.claim.role of
// service_role, and no client may reach content_shares at all.
describe('the public read path signs the live path, not the frozen one', () => {
  it('signs the live path, refuses a stale one and invalidates on a move', () => {
    const club = CLUB_A
    const share = `00000000-0000-4000-8000-${RUN.replace(/\W/g, '').slice(0, 12).padStart(12, '0')}`
    const script = `
      begin;
      create temporary table probe_out (msg text);
      do $probe$
      declare
        v_club   uuid := ${sqlLiteral(club)}::uuid;
        v_fail   text;
        v_user   uuid;
        v_media  uuid;
        v_drill  uuid;
        v_share  uuid := ${sqlLiteral(share)}::uuid;
        v_hash   bytea := decode(repeat('ab', 32), 'hex');
        v_live   text := v_club::text || '/${RUN}-live.mp4';
        v_old    text := v_club::text || '/${RUN}-old.mp4';
        v_res    jsonb;
        v_was    boolean;
      begin
        select id into v_user from public.profiles where club_id = v_club limit 1;
        select public_sharing_enabled into v_was from public.clubs where id = v_club;
        update public.clubs set public_sharing_enabled = true where id = v_club;

        insert into public.media (club_id, name, type, storage_path, rights, created_by)
          values (v_club, '${MARK}', 'video', v_old, 'public_full', v_user) returning id into v_media;
        insert into public.drills (club_id, title, media_id, rights, created_by)
          values (v_club, '${MARK}', v_media, 'public_full', v_user) returning id into v_drill;
        insert into public.content_shares
          (id, club_id, kind, drill_id, token_hash, snapshot_version, snapshot, created_by)
        values (v_share, v_club, 'drill', v_drill, v_hash, 1, jsonb_build_object(
          'public','true','snapshotVersion','1','kind','drill',
          'media', jsonb_build_array(jsonb_build_object(
            'ref','m1','type','video','caption','c','_mid', v_media::text, '_path', v_old))), v_user);
        insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id)
          values (v_share, v_club, 'media', v_media), (v_share, v_club, 'drill', v_drill);

        perform set_config('request.jwt.claim.role', 'service_role', true);
        v_res := public.read_public_share(v_share, v_hash);
        perform set_config('request.jwt.claim.role', '', true);
        if v_res->>'status' <> 'ok' then raise exception 'PROBE_FAIL healthy share not ok'; end if;
        if v_res->'media'->0->>'path' <> v_old then raise exception 'PROBE_FAIL wrong signed path'; end if;
        if (v_res->'snapshot'->'media'->0) ? '_path' or (v_res->'snapshot'->'media'->0) ? '_mid' then
          raise exception 'PROBE_FAIL markers survived';
        end if;

        -- Move the object. The trigger must invalidate the dependent share.
        update public.media set storage_path = v_live where id = v_media;
        if exists (select 1 from public.content_shares where id = v_share and revoked_at is null) then
          raise exception 'PROBE_FAIL move did not invalidate';
        end if;
        if not exists (select 1 from public.audit_events
          where entity_id = v_share and action = 'content_share.invalidated'
            and metadata->>'reason_code' = 'path_changed') then
          raise exception 'PROBE_FAIL no path_changed event';
        end if;

        -- Undo the invalidation: a snapshot naming the OLD path must still fail
        -- the whole share closed rather than signing either path.
        update public.content_shares set revoked_at = null, snapshot = jsonb_build_object(
          'public','true','snapshotVersion','1','kind','drill',
          'media', jsonb_build_array(jsonb_build_object(
            'ref','m1','type','video','caption','c','_mid', v_media::text, '_path', v_old)))
          where id = v_share;
        insert into public.content_share_dependencies (share_id, club_id, dependency_kind, dependency_id)
          values (v_share, v_club, 'media', v_media), (v_share, v_club, 'drill', v_drill)
          on conflict do nothing;

        perform set_config('request.jwt.claim.role', 'service_role', true);
        v_res := public.read_public_share(v_share, v_hash);
        perform set_config('request.jwt.claim.role', '', true);
        if v_res is distinct from jsonb_build_object('status','unavailable') then
          raise exception 'PROBE_FAIL stale path served';
        end if;

        insert into probe_out values ('PROBE_OK');
      exception when others then
        -- Report the verdict on stdout rather than aborting: runSqlInContainer
        -- runs with ON_ERROR_STOP, so an uncaught raise would throw in the
        -- test runner instead of failing the assertion with a readable reason.
        v_fail := sqlerrm;
        insert into probe_out values ('PROBE_FAIL: ' || v_fail);
      end $probe$;
      select msg from probe_out;
      -- Everything the probe did is discarded, including the club it had to
      -- enable to exercise the read path at all. Rolling back explicitly rather
      -- than by raising, because runSqlInContainer runs with ON_ERROR_STOP and
      -- would turn a deliberate exception into a failed test.
      rollback;`

    const out = runSqlInContainer(script)
    expect(out).toContain('PROBE_OK')
    expect(out).not.toContain('PROBE_FAIL')
    // The whole probe rolled back: no share, no fixture drill, no enabled club.
    expect(runSqlInContainer(`select count(*) from public.content_shares;`)).toContain('0')
    expect(
      runSqlInContainer(`select count(*) from public.clubs where public_sharing_enabled;`),
    ).toContain('0')
  })
})

describe('every existing media row satisfies the invariant', () => {
  it('finds no row outside its own club namespace', () => {
    const out = runSqlInContainer(`
      select count(*) from public.media
      where storage_path is not null
        and not public.is_canonical_media_path(storage_path, club_id);`)
    expect(out).toContain('0')
  })
})
