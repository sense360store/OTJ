# Storage boundary: the media bucket

The authorisation design for the private `media` bucket, enforced by
`supabase/migrations/0027_storage_boundary.sql` and verified executably by
`tests/security/storage.test.ts`. Before 0027 the bucket held three
policies from `0001_init.sql` that distinguished only unauthenticated from
authenticated callers: any signed in user of any club could read, list,
create and delete every object. 0027 drops those three policies and
replaces them with the class based design below.

## Effective object classes and accepted path formats

Every writer in the app and in the Edge Functions produces one of three
path shapes. This was verified against the hosted bucket before the design
was chosen: every existing object matches one of the first two shapes
(no crest object exists yet), so **no legacy compatibility arm is needed
and none exists**. A path outside these shapes is writable by nobody.

| Class | Path format | Produced by |
|---|---|---|
| Club content | `{club_id}/…` (first folder is the owning club's UUID; anything except a second folder named `crest`) | Media Library uploads, drill form uploads, media replacement, planner video attachments (`src/lib/queries.ts`), FA session and programme import assets (`supabase/functions/_shared/fa.ts`, running with the caller's JWT) |
| Club crest | `{club_id}/crest/…` | `useUploadCrest` in `src/lib/queries.ts` (changed from the unscoped `club/…` in the same PR as 0027; no object under the old prefix exists in the hosted bucket) |
| Avatars | `avatars/{user_id}/…` (second folder is the owning user's UUID) | `useUploadAvatar` in `src/lib/queries.ts` |

## Capability matrix

Reads of club content stay club wide for every member, matching the
product rule that visibility is club wide. Writes follow the capability
catalogue from `0012_rbac` / `0015_rbac_roles` via `public.has_perm()`.
`public.my_club()` scopes every arm to the caller's own club; both
functions return null/false for callers without a profile, so everything
fails closed.

| Operation | Club content `{club_id}/…` | Crest `{club_id}/crest/…` | Avatar `avatars/{user_id}/…` |
|---|---|---|---|
| SELECT (read, list, sign) | member of that club | member of that club | the owner, plus members of the owner's club |
| INSERT | `media.create`, own club prefix only | `club.manage`, own club prefix only | own folder only, any authenticated member (parents included, mirroring the self service `avatar_url` column) |
| UPDATE (upsert, move) | **nobody** — no policy, deliberate | **nobody** | **nobody** |
| DELETE | `media.manage`, or the object's uploader holding `media.create` | `club.manage`, own club prefix only | own folder only |

Consequences, spelled out:

- The parent role holds no capabilities, so a parent can create, replace
  and delete nothing except objects in their own avatar folder.
- A member of one club cannot read, list, sign, create or delete anything
  under another club's prefix.
- FA imports keep working unchanged: the import functions write with the
  caller's JWT to `{club_id}/{uuid}-{slug}.{ext}` and every importer holds
  `media.create`.
- The app's cleanup of a just uploaded object after a failed database
  write keeps working: the uploader is the object's owner.
- Removing another member's avatar object (part of member removal) is done
  by the `remove-user` Edge Function with the service role, which RLS does
  not constrain; no client facing policy arm exists for it.

## Ownership

Object ownership for the delete arm is `storage.objects.owner_id`, which
the Storage service sets from the authenticated JWT on upload. It is not
client supplied metadata and cannot be spoofed through the Storage API.
The policies never read client controlled object metadata.

## Legacy compatibility

None required, by evidence rather than assumption. A read only inspection
of the hosted bucket at design time found every object either club
prefixed (108, of which 102 referenced by `media.storage_path` rows and 6
unreferenced orphans) or under `avatars/` with the owner matching the path
(2). Zero objects exist under the old crest prefix `club/`, which is why
the crest path could move under the club prefix with no object migration.

## Known residual risks (accepted)

- **Owner mismatch on replaced objects.** Three hosted objects were
  uploaded by a different member than the media row's `created_by`
  (admin replacement flows). Their row owner can delete the row but not
  the old object; a `media.manage` holder can. Orphaned objects stay club
  readable and can be swept by an admin.
- **Orphaned objects.** Six club prefixed objects have no media row. They
  are club readable and deletable by `media.manage`; harmless, sweepable.
- **Owner delete then recreate.** In place replacement is closed for
  everyone, but an object's uploader holding `media.create` can delete
  their own object and re-upload different bytes at the same path. This is
  no more power than editing their own media row grants and is accepted.
- **Avatar folder as personal storage.** Any member, parents included, can
  put arbitrary bytes in their own `avatars/{user_id}/` folder. The
  content type check is client side only. Scope is limited to their own
  folder, readable only inside their club; accepted.
- **No size or content type enforcement in policy.** Policies gate paths
  and capabilities, not payloads. Size limits remain the bucket/global
  Storage configuration's job.

## Required production application procedure

0027 is a **gated migration** (review required under CLAUDE.md). It has
not been applied to the hosted project by the PR that introduces it.

1. Human security review of the PR, then merge.
2. Confirm the ledger's next free number is still 0027
   (`supabase migration list` against the hosted project); renumber the
   file if another migration landed first.
3. Apply through the connector or `npx supabase db push` from `main`.
   The migration only drops and creates policies on `storage.objects`;
   it moves no objects and touches no rows, so it is instant and does not
   interrupt serving of already issued signed URLs.
4. Deploy the front end from the same `main` so new crest uploads use the
   `{club_id}/crest/…` path. Order does not matter for safety: the old
   `club/…` upload path simply fails closed under the new policies, and
   no crest object exists yet.

## Post-apply hosted verification (disposable objects only)

Use only disposable objects under `{club_id}/security-verify-{date}/…`;
never touch real member content.

1. As an admin account, upload a small text object to
   `{club_id}/security-verify-{date}/probe.txt`. Expect success.
2. As a parent account, attempt to upload alongside it and to delete the
   probe. Expect both refused, and the probe unchanged.
3. With the bare anon key (no session), attempt to download the probe.
   Expect a refusal.
4. As the admin, create a signed URL for the probe and fetch it. Expect
   the content back.
5. As the admin, delete the probe. Expect success and a subsequent
   download to fail.
6. Confirm real flows: open the Media Library (previews render via signed
   URLs), upload and delete a disposable media item, and set then remove
   a profile photo.

## Rollback procedure

Rollback restores the pre-0027 policies and **reopens findings 1 and 2**
(any authenticated user of any club can read, create and delete every
object). It is an emergency lever only, applied as a new gated migration,
never by editing 0027:

```sql
drop policy if exists "media_bucket_select_club"        on storage.objects;
drop policy if exists "media_bucket_select_avatar"      on storage.objects;
drop policy if exists "media_bucket_insert_club_media"  on storage.objects;
drop policy if exists "media_bucket_insert_crest"       on storage.objects;
drop policy if exists "media_bucket_insert_avatar_own"  on storage.objects;
drop policy if exists "media_bucket_delete_club_media"  on storage.objects;
drop policy if exists "media_bucket_delete_crest"       on storage.objects;
drop policy if exists "media_bucket_delete_avatar_own"  on storage.objects;

create policy "media_bucket_read_authed" on storage.objects
  for select using ( bucket_id = 'media' and auth.uid() is not null );
create policy "media_bucket_write_authed" on storage.objects
  for insert with check ( bucket_id = 'media' and auth.uid() is not null );
create policy "media_bucket_delete_authed" on storage.objects
  for delete using ( bucket_id = 'media' and auth.uid() is not null );
```

The one app behaviour 0027 does not restore on rollback is crest upload,
which writes `{club_id}/crest/…` from this PR onward; that path is also
writable under the legacy policies, so crest upload keeps working either
way.

## Out of scope here

The board token safeguarding finding (finding 3, `boards.test.ts`,
marked `it.fails`) is deliberately not addressed by 0027 and remains the
expected failure in the security suite until its own remediation records
a decision.
