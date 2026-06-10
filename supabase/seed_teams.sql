-- =====================================================================
-- OTJ Training Hub - team seed
--
-- Data, not schema: the five club teams for the seeded club. Separate
-- from migration 0002 on purpose; schema lives in migrations, data lives
-- in seeds. Idempotent, safe to run more than once. Run it in the
-- Supabase SQL editor after 0002_teams_roles.sql.
-- =====================================================================

insert into public.teams (club_id, name)
values
  ('11111111-1111-1111-1111-111111111111', 'Titans'),
  ('11111111-1111-1111-1111-111111111111', 'Trojans'),
  ('11111111-1111-1111-1111-111111111111', 'Gladiators'),
  ('11111111-1111-1111-1111-111111111111', 'Spartans'),
  ('11111111-1111-1111-1111-111111111111', 'Argonauts')
on conflict (club_id, name) do nothing;
