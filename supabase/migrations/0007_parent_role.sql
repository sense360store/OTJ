-- =====================================================================
-- OTJ Training Hub - the parent role: read everything, write nothing
-- Migration 0007_parent_role
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review. Do not auto-merge. The invite-user Edge Function gains
-- parent as an invitable role in the same phase and needs redeploying
-- after this merges.
--
-- Parents are read-only club members. Select policies are club-wide by
-- design and stay untouched, so parents read everything, including live
-- sessions over realtime. Update and delete policies are already owner
-- or admin and a parent owns nothing, so they stay untouched too. The
-- insert policies below currently allow any club member; they are
-- recreated with the writing roles spelled out, which closes them to
-- parents and to any future role that is not named.
--
-- The fa-import function needs no change: it inserts drills, media and
-- templates as the caller through RLS, so this migration automatically
-- closes it to parents too.
-- =====================================================================

-- drills: creating is for coaching roles
drop policy "drills_insert_club" on public.drills;
create policy "drills_insert_club" on public.drills
  for insert with check ( club_id = public.my_club() and public.my_role() in ('coach','admin') );

-- media: same
drop policy "media_insert_club" on public.media;
create policy "media_insert_club" on public.media
  for insert with check ( club_id = public.my_club() and public.my_role() in ('coach','admin') );

-- templates: same
drop policy "templates_insert_club" on public.templates;
create policy "templates_insert_club" on public.templates
  for insert with check ( club_id = public.my_club() and public.my_role() in ('coach','admin') );

-- sessions: insert already requires coach_id = auth.uid(); the added role
-- condition means a parent cannot create a session naming themselves.
drop policy "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check ( coach_id = auth.uid() and club_id = public.my_club() and public.my_role() in ('coach','admin') );
