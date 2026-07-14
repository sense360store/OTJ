-- =====================================================================
-- OTJ Training Hub, migration 0027_storage_boundary: the media bucket
-- stops trusting bare authentication.
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge, and do not apply to the hosted
-- project before the human security review recorded in the pull
-- request. docs/security/storage-boundary.md is the companion document
-- for this file: object classes, path formats, the capability matrix,
-- rollback and the hosted verification procedure live there.
--
-- What this replaces. 0001_init created the private media bucket with
-- three policies that distinguished only unauthenticated from
-- authenticated callers: any signed in user of any club could read,
-- list, create and delete every object. The executable evidence is the
-- security suite (tests/security/storage.test.ts), which before this
-- migration reports four red tests: a parent can create objects, a
-- parent can delete another member's object, and a member of another
-- club can read and list this club's objects.
--
-- The object classes and their path shapes. Every writer in the app
-- and in the Edge Functions builds one of three shapes (verified
-- against the hosted bucket: every existing object matches, so no
-- legacy compatibility arm is needed):
--
--   {club_id}/...            club content: Media Library uploads,
--                            drill form uploads, FA import assets,
--                            planner video attachments. The first
--                            folder is the owning club's UUID.
--   {club_id}/crest/...      the club crest, written by club.manage
--                            holders from this migration's companion
--                            app change (new crests only; no crest
--                            object exists yet in the hosted bucket).
--   avatars/{user_id}/...    profile photos. The second folder is the
--                            owning user's UUID. Self service for
--                            every member, parents included, exactly
--                            like the avatar_url column they may
--                            already write on their own profile row.
--
-- The boundary, in one paragraph. Reads are club scoped: you read an
-- object only when its first folder is your club, or it is an avatar
-- belonging to you or to a member of your club. Creates require the
-- write capability of the class: media.create for club content,
-- club.manage for the crest, and only your own avatars folder for
-- avatars. Deletes require the same class capability plus, for club
-- content, either media.manage or being the object's uploader
-- (storage.objects.owner_id, which the Storage service sets from the
-- authenticated JWT; it is not client controlled). There is
-- deliberately NO update policy: nothing in the product updates or
-- upserts storage objects in place (uploads always mint a fresh
-- random path), so in place replacement stays closed for everyone,
-- managers included. That absence is a decision, not an omission; the
-- security suite pins it.
--
-- Fail closed notes. my_club() returns null for a caller without a
-- profile and auth.uid() is null for an unauthenticated caller, so
-- every comparison below evaluates to null (refused) rather than
-- true. has_perm() returns false for the parent role, which holds no
-- capabilities. The policies name to authenticated so the anon role
-- never evaluates them at all.
--
-- The one affordance this narrows: three hosted objects were uploaded
-- by a different member than the media row's created_by (admin
-- replacements). Their row owner can still delete the row but not the
-- old object; media.manage can. Recorded as accepted in the companion
-- document.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Drop the three permissive 0001 policies. Explicit, by name.
-- ---------------------------------------------------------------------
drop policy if exists "media_bucket_read_authed"   on storage.objects;
drop policy if exists "media_bucket_write_authed"  on storage.objects;
drop policy if exists "media_bucket_delete_authed" on storage.objects;

-- ---------------------------------------------------------------------
-- SELECT. Club content (crest included: every member renders it) is
-- readable only when the first folder is the caller's club. Avatars
-- are readable by their owner and by members of the owner's club,
-- resolved through the profiles row for the user in the path; the
-- profiles subquery runs under profiles RLS as the caller, which
-- already scopes it to the caller's club.
-- ---------------------------------------------------------------------
create policy "media_bucket_select_club" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_club()::text
  );

create policy "media_bucket_select_avatar" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1
        from public.profiles p
        where p.id::text = (storage.foldername(name))[2]
          and p.club_id = public.my_club()
      )
    )
  );

-- ---------------------------------------------------------------------
-- INSERT. Club content requires media.create in the caller's own club
-- prefix; the crest/ subfolder is reserved for club.manage; avatars
-- are writable only under the caller's own user folder. FA imports
-- pass through the first arm unchanged: the import functions write
-- with the caller's JWT to {club_id}/{uuid}-{slug}.{ext}, and every
-- importer holds media.create.
-- ---------------------------------------------------------------------
create policy "media_bucket_insert_club_media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_club()::text
    and (storage.foldername(name))[2] is distinct from 'crest'
    and public.has_perm('media.create')
  );

create policy "media_bucket_insert_crest" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_club()::text
    and (storage.foldername(name))[2] = 'crest'
    and public.has_perm('club.manage')
  );

create policy "media_bucket_insert_avatar_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- No UPDATE policy, deliberately. The Storage API's upsert and move
-- both require update; with no policy they are refused for every
-- caller. Nothing in the product updates an object in place, and
-- keeping replace closed means a signed URL can never silently start
-- serving different bytes under the same path.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- DELETE. Club content: media.manage removes anything in the club;
-- the uploader (owner_id, set by the Storage service from the JWT,
-- never client supplied) holding media.create removes their own
-- objects, which also covers the app's cleanup of a just uploaded
-- object after a failed database write. Crest: club.manage, within
-- the caller's club prefix. Avatars: own folder only; removing a
-- member's avatar object is done by the remove-user function with the
-- service role, which RLS does not constrain.
-- ---------------------------------------------------------------------
create policy "media_bucket_delete_club_media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_club()::text
    and (storage.foldername(name))[2] is distinct from 'crest'
    and (
      public.has_perm('media.manage')
      or (owner_id = auth.uid()::text and public.has_perm('media.create'))
    )
  );

create policy "media_bucket_delete_crest" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_club()::text
    and (storage.foldername(name))[2] = 'crest'
    and public.has_perm('club.manage')
  );

create policy "media_bucket_delete_avatar_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
