-- =====================================================================
-- OTJ Training Hub - local development seed
-- Ported from design-reference/data.js. LOCAL ONLY. Never run in production:
-- production data comes from invite based sign-up and the app itself.
--
-- This file creates a demo auth user so the three sessions have a coach to
-- belong to. Hand inserting into auth.users is a local convenience that suits
-- the local stack created by `supabase start`. Do not seed users in the cloud.
--
-- Stable UUID scheme (auditable map from the prototype text ids):
--   club     11111111-1111-1111-1111-111111111111
--   user     22222222-2222-2222-2222-222222222222
--   drills   d000000d-0000-0000-0000-0000000000NN   (NN = 01..12)
--   media    e000000e-0000-0000-0000-0000000000NN   (NN = 01..10)
--   templates f000000f-0000-0000-0000-0000000000NN  (NN = 01..03)
--   sessions a000000a-0000-0000-0000-0000000000NN   (NN = 01..03)
--
-- Local sign-in: coach@ossetttownjnr.com / training123
-- =====================================================================

-- Club ----------------------------------------------------------------
insert into public.clubs (id, name, crest_url, motto)
values (
  '11111111-1111-1111-1111-111111111111',
  'Ossett Town Juniors',
  '/crest.png',
  'Where football and friendships flourish'
)
on conflict (id) do nothing;

-- Demo auth user ------------------------------------------------------
-- The handle_new_user trigger creates a profile row from this metadata; the
-- explicit upsert below then sets the avatar and age groups.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated',
  'coach@ossetttownjnr.com',
  crypt('training123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Sarah Thompson","club_id":"11111111-1111-1111-1111-111111111111","role":"admin"}',
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  '22222222-2222-2222-2222-222222222222',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"coach@ossetttownjnr.com"}',
  'email',
  '22222222-2222-2222-2222-222222222222',
  now(), now(), now()
)
on conflict (provider, provider_id) do nothing;

-- Admin profile for the demo user (trigger creates the base row).
insert into public.profiles (id, club_id, full_name, avatar, role, age_groups)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Sarah Thompson', 'ST', 'admin', '{U8}'
)
on conflict (id) do update set
  club_id = excluded.club_id,
  full_name = excluded.full_name,
  avatar = excluded.avatar,
  role = excluded.role,
  age_groups = excluded.age_groups;

-- Media (10) ----------------------------------------------------------
insert into public.media (id, club_id, name, type, kind, yt_url, size, dims, length, pages, created_by) values
('e000000e-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Dynamic Warm-Up.mp4','video','pitch',null,'10.1 MB','640×480','1:32',null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Protect The Bib.mp4','video','pitch',null,'10.1 MB','640×480','2:08',null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Six Second Game.png','image','diagram',null,'0.09 MB','1200×800',null,null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Coerver Ball Mastery','youtube','pitch','https://youtu.be/',null,null,'4:11',null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','1v1 Attacking Moves','youtube','pitch','https://youtu.be/',null,null,'6:24',null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Passing Patterns Diagram.png','image','diagram',null,'0.12 MB','1400×900',null,null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','FA Session Card – Possession.pdf','pdf','pdf',null,'0.4 MB',null,null,2,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Cool-Down Stretch Routine.pdf','pdf','pdf',null,'0.3 MB',null,null,1,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','Sharks & Minnows Setup.png','image','diagram',null,'0.10 MB','1200×800',null,null,'22222222-2222-2222-2222-222222222222'),
('e000000e-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','Rondo 4v1 Clip.mp4','video','pitch',null,'14.2 MB','720×480','3:02',null,'22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- Drills (12) ---------------------------------------------------------
insert into public.drills (id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, media_id, created_by) values
('d000000d-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Sharks & Minnows','Classic dribbling chaos game — minnows dribble across, sharks try to knock balls out.','technical','Dribbling','Foundation',ARRAY['U6','U7','U8'],8,'Whole group','20×20m',ARRAY['Cones','1 ball each','Bibs'],ARRAY['Eyes up, find the space','Small, close touches under pressure','Use both feet to change direction','Shield the ball when a shark gets close'],ARRAY['fun','close control','ABCs'],'e000000e-0000-0000-0000-000000000009','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Dynamic Warm-Up','Pulse-raiser with footwork, skips and gentle ball rolls to get bodies ready.','physical','Movement','Foundation',ARRAY['U6','U7','U8','U9','U10'],10,'Whole group','15×15m',ARRAY['Cones'],ARRAY['Light on toes, stay active','Good range of movement at the joints','Build intensity gradually','Add a ball for the second half'],ARRAY['warm-up','coordination','ABCs'],'e000000e-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Coerver Ball Mastery','Footwork patterns — toe taps, rolls, V-pulls and step-overs to build comfort on the ball.','technical','Ball Mastery','Developing',ARRAY['U7','U8','U9','U10','U11'],12,'1 ball each','Grid 10×10m',ARRAY['1 ball each','Cones'],ARRAY['Quality over speed first','Both feet, every rep','Head up between touches','Add speed once the pattern is clean'],ARRAY['technique','footwork','repetition'],'e000000e-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Win The Ball Back In 6','Lose the ball? Whole team presses to win it back within 6 seconds — points for fast recovery.','social','Defending','Developing',ARRAY['U9','U10','U11','U12'],12,'Teams of 4-6','30×20m',ARRAY['Cones','Balls','Bibs'],ARRAY['React instantly when possession is lost','Press as a unit, close the nearest option','Communicate — who goes, who covers','Celebrate the recovery as a team'],ARRAY['counter-press','teamwork','transitions'],'e000000e-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','1v1 Attacking Moves','Take players on with confidence — commit the defender, then explode past into space.','psychological','1v1','Developing',ARRAY['U8','U9','U10','U11'],14,'Pairs','10×8m channels',ARRAY['Cones','Balls'],ARRAY['Attack the defender, don''t wait','Sell the feint with your body','Change of pace is the move','Be brave — try, fail, try again'],ARRAY['confidence','beating a player','decision-making'],'e000000e-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Rondo 4v1','Keep-ball in a tight grid — quick passing and movement to beat the defender in the middle.','technical','Passing','Developing',ARRAY['U9','U10','U11','U12'],10,'5 per grid','8×8m grid',ARRAY['Cones','1 ball','Bibs'],ARRAY['Open body shape to see two options','Pass to feet, weight it right','Move after you pass','First touch out of pressure'],ARRAY['possession','first touch','scanning'],'e000000e-0000-0000-0000-000000000010','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Traffic Lights','Red/amber/green calls control dribbling speed — fun way to build close control and listening.','physical','Ball Mastery','Foundation',ARRAY['U6','U7','U8'],8,'Whole group','15×15m',ARRAY['1 ball each'],ARRAY['Stop the ball dead on ''red''','Tiny touches on ''amber''','Drive into space on ''green''','Keep heads up to hear the call'],ARRAY['fun','listening','close control'],null,'22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Shooting Gallery','Rotating finishing stations — laces strike, side-foot placement and a 1v1 vs keeper.','technical','Shooting','Developing',ARRAY['U8','U9','U10','U11','U12'],12,'Groups of 3-4','Half pitch + goals',ARRAY['Balls','Goals','Cones'],ARRAY['Plant foot beside the ball','Strike through the middle for laces','Pick your spot for placement','Follow your shot in'],ARRAY['finishing','striking the ball','goals'],'e000000e-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','Possession Squares','Two teams compete to keep the ball — string 6 passes together to score a point.','social','Passing','Advanced',ARRAY['U10','U11','U12'],14,'Teams of 5-6','30×30m',ARRAY['Cones','Balls','Bibs'],ARRAY['Create angles to support the ball','Scan before you receive','Switch play to the free side','Talk constantly — demand the ball'],ARRAY['possession','support play','communication'],'e000000e-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','Cool-Down & Stretch','Gentle jog, static stretches and a quick chat about what went well today.','physical','Movement','Foundation',ARRAY['U6','U7','U8','U9','U10','U11','U12'],6,'Whole group','Anywhere',ARRAY[]::text[],ARRAY['Bring the heart rate down gradually','Hold each stretch ~15 seconds','Reflect: one thing we did well','End on a positive note'],ARRAY['cool-down','recovery','reflection'],'e000000e-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','Turning Gates','Dribble to a gate, perform a turn (Cruyff, drag-back, hook) and drive out the other side.','technical','Turning','Foundation',ARRAY['U7','U8','U9','U10'],10,'1 ball each','15×15m gates',ARRAY['Cones','1 ball each'],ARRAY['Decide your turn early','Protect the ball through the turn','Accelerate out of it','Try a new turn each round'],ARRAY['turning','close control','variety'],null,'22222222-2222-2222-2222-222222222222'),
('d000000d-0000-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','Keeper Reaction Saves','Rapid-fire shots from short range to sharpen reactions, set position and bravery.','psychological','Goalkeeping','Developing',ARRAY['U9','U10','U11','U12'],10,'GK + servers','One goal',ARRAY['Balls','Goal','Gloves'],ARRAY['Set before the shot — feet ready','Strong hands behind the ball','Brave, get your body behind it','Reset quickly for the next one'],ARRAY['goalkeeping','reactions','bravery'],null,'22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- Templates (3) -------------------------------------------------------
insert into public.templates (id, club_id, name, focus, author, activities) values
('f000000f-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Standard Training Night','All-round','Sarah Thompson','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000002","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000003","duration":12},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000011","duration":10},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000004","duration":12},
  {"phase":"Cool-Down","drill_id":"d000000d-0000-0000-0000-000000000010","duration":6}
]'::jsonb),
('f000000f-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Dribbling & 1v1 Focus','Technical / Confidence','Sarah Thompson','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000007","duration":8},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000001","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000005","duration":14},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000001","duration":10},
  {"phase":"Cool-Down","drill_id":"d000000d-0000-0000-0000-000000000010","duration":6}
]'::jsonb),
('f000000f-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Possession & Passing','Technical / Social','Dev Manager','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000002","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000006","duration":10},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000009","duration":14},
  {"phase":"Cool-Down","drill_id":"d000000d-0000-0000-0000-000000000010","duration":6}
]'::jsonb)
on conflict (id) do nothing;

-- Sessions (3) --------------------------------------------------------
insert into public.sessions (id, club_id, coach_id, name, focus, date, start_time, venue, age_group, status, activities) values
('a000000a-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Tuesday Training','Dribbling & 1v1','2026-06-09','17:30','Springmill 3G','U8s','upcoming','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000002","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000001","duration":8},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000005","duration":14},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000004","duration":12},
  {"phase":"Cool-Down","drill_id":"d000000d-0000-0000-0000-000000000010","duration":6}
]'::jsonb),
('a000000a-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Thursday Skills','Passing & Possession','2026-06-11','17:30','Springmill 3G','U8s','upcoming','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000007","duration":8},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000006","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000003","duration":12},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000009","duration":14},
  {"phase":"Cool-Down","drill_id":"d000000d-0000-0000-0000-000000000010","duration":6}
]'::jsonb),
('a000000a-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Saturday Pre-Match','Activation & Shooting','2026-06-13','09:30','Springmill Pitch 1','U8s','upcoming','[
  {"phase":"Warm-Up","drill_id":"d000000d-0000-0000-0000-000000000002","duration":10},
  {"phase":"Skill","drill_id":"d000000d-0000-0000-0000-000000000008","duration":12},
  {"phase":"Game","drill_id":"d000000d-0000-0000-0000-000000000004","duration":10}
]'::jsonb)
on conflict (id) do nothing;

-- Verify counts -------------------------------------------------------
do $$
declare d int; m int; t int; s int;
begin
  select count(*) into d from public.drills;
  select count(*) into m from public.media;
  select count(*) into t from public.templates;
  select count(*) into s from public.sessions;
  if d <> 12 or m <> 10 or t <> 3 or s <> 3 then
    raise exception 'Seed count mismatch: drills=% media=% templates=% sessions=% (expected 12/10/3/3)', d, m, t, s;
  end if;
  raise notice 'Seed OK: % drills, % media, % templates, % sessions', d, m, t, s;
end $$;
