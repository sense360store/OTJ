-- =====================================================================
-- OTJ Training Hub - close owner update and delete to demoted parents
-- Migration 0009_parent_owner_writes
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge.
--
-- Completes 0007_parent_role, which spelled the writing roles out on the
-- insert policies but left update and delete untouched on the assumption
-- that a parent owns nothing. A coach demoted to parent breaks that
-- assumption: they still match created_by on drills and media and
-- coach_id on sessions they created, so they kept write access to that
-- content. The owner arms below gain the same role condition the insert
-- policies have; the admin arms are unchanged. Raised in review on the
-- Phase 5 landing PR.
--
-- Templates already restrict update and delete to admins; untouched.
-- =====================================================================

-- drills
drop policy "drills_update_owner_or_admin" on public.drills;
create policy "drills_update_owner_or_admin" on public.drills
  for update using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
drop policy "drills_delete_owner_or_admin" on public.drills;
create policy "drills_delete_owner_or_admin" on public.drills
  for delete using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') );

-- media: same
drop policy "media_update_owner_or_admin" on public.media;
create policy "media_update_owner_or_admin" on public.media
  for update using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') )
  with check ( club_id = public.my_club() );
drop policy "media_delete_owner_or_admin" on public.media;
create policy "media_delete_owner_or_admin" on public.media
  for delete using ( club_id = public.my_club() and public.my_role() in ('coach','admin')
    and (created_by = auth.uid() or public.my_role() = 'admin') );

-- sessions: the shape from 0001 kept, with the role condition added. This
-- also governs who can drive a live session, which stays owner or admin.
drop policy "sessions_update_own_or_admin" on public.sessions;
create policy "sessions_update_own_or_admin" on public.sessions
  for update using ( public.my_role() in ('coach','admin')
    and (coach_id = auth.uid() or (club_id = public.my_club() and public.my_role() = 'admin')) )
  with check ( club_id = public.my_club() );
drop policy "sessions_delete_own_or_admin" on public.sessions;
create policy "sessions_delete_own_or_admin" on public.sessions
  for delete using ( public.my_role() in ('coach','admin')
    and (coach_id = auth.uid() or (club_id = public.my_club() and public.my_role() = 'admin')) );
