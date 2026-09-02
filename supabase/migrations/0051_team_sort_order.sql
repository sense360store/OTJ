-- =====================================================================
-- OTJ Training Hub, migration 0051_team_sort_order: the club's ordering of
-- its own teams (roadmap COACH-1, migration M1 of the coaching workflow
-- programme; this file is COACH-1A, the database half)
--
-- REVIEW REQUIRED, and NOT APPLIED. Migrations are gated (CLAUDE.md, "Review
-- gates"). This file ships with its pull request and is applied afterwards
-- through .github/workflows/apply-production-migration.yml, once reviewed,
-- by a human pressing the button. Do not auto-merge, do not run `supabase
-- db push`, and do not dispatch the apply workflow as part of reviewing it.
-- Merging the pull request changes no database.
--
-- NUMBERING. The files on disk end at 0050_bulk_delete_players.sql and the
-- hosted ledger's newest row is 20260823065041 / bulk_delete_players, read
-- from the hosted project on 2 September 2026. No remote branch and no open
-- pull request carried a 0051 file on that date (every remote branch was
-- scanned for one). So this is 0051, and its register entry pins that head:
-- expected_previous_version 20260823065041 / bulk_delete_players. The ledger
-- is the authority, not the highest file name; confirm both again
-- immediately before applying.
--
-- ---------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------
--
-- The suggested setup (COACH-3, shipped) groups children for a night by
-- keeping each team whole, and it would combine ADJACENT teams when the
-- numbers ask for it. Adjacent in what order? Nothing in the schema says.
-- public.teams carries id, club_id, name, created_at and bib_colour, and
-- every team order in the product is alphabetical, which for this club
-- matches the club's own ordering nowhere. So the generator says the order
-- is unset and keeps teams whole (src/lib/sessionSetup.ts), which is the
-- honest degradation, and the one this column ends.
--
-- The club's ordering of its own teams is one fact nothing else can
-- produce: not the alphabet, not created_at (which records the order rows
-- were inserted during setup), and not an ordered array of team ids on
-- clubs (which lists teams in a second place and drifts). It is stated by a
-- teams.manage holder, once, on the existing Admin Teams screen.
-- docs/product/coaching-workflow/04-data-model-proposal.md section 5 is the
-- settled shape, and this file implements it exactly.
--
-- ---------------------------------------------------------------------
-- WHAT IT DOES
-- ---------------------------------------------------------------------
--
--   1. Adds public.teams.sort_order, a nullable integer with no default.
--   2. Creates teams_sort_order_unique, a partial unique index on
--      (club_id, sort_order) where sort_order is not null.
--   3. Adds sort_order to the update allow list of public.audit_teams(), so
--      a reorder leaves the existing team.updated trail beside a rename or
--      a bib change. Field NAME only, never a value, as everywhere else.
--   4. Comments the column.
--
-- That is the whole change. One column, one index, one function body, one
-- comment.
--
-- ---------------------------------------------------------------------
-- WHAT THE COLUMN MEANS, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------
--
-- NULL MEANS THE CLUB HAS NOT CONFIGURED ITS ORDER. That is every team on
-- every database this file applies to, and it is exactly what the product
-- already reads today: the generator keeps teams whole and says the order
-- is unset. No behaviour changes on apply.
--
-- POSITIONS MEAN SOMETHING ONLY WITHIN ONE CLUB. Two non-null teams in one
-- club cannot share a position; different clubs may use the same positions.
-- That is what the index key (club_id, sort_order) says, and nothing else
-- in this file says anything about it.
--
-- POSITIONS NEED NOT BE CONTIGUOUS OR START AT ANY NUMBER. The database
-- refuses a collision and nothing more. A reorder written by the admin
-- screen (COACH-1B, a separate frontend pull request) can write a clean
-- 1..n ordering; a gap or an offset is not an error the database pretends
-- to know about.
--
-- IT IS NOT AN ABILITY SCORE, and there is no per-player field of any kind
-- here or anywhere in the programme. It orders the club's teams. What that
-- order is used for is the grouping suggestion's business, and that
-- consumer is not in this pull request: no application code reads the
-- column yet, which src/lib/teamOrder.invariant.test.ts pins.
--
-- NO LITERAL TEAM NAME appears in this file or in any rule that will read
-- the column.
--
-- ---------------------------------------------------------------------
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------
--
-- IT WRITES NO ROW. Nothing is backfilled: not from the alphabet, not from
-- created_at, not from a team's name. Every existing team keeps every
-- stored value it has and gains a null, which claims nothing. The
-- self-verification fingerprints every team row whole before the change
-- and requires the same rows, minus the new column, afterwards, and
-- requires every sort_order to be null.
--
-- IT CHANGES NO POLICY, GRANT, CAPABILITY, ROLE OR TRIGGER, and it needs to
-- change none:
--
--   The two policies on teams name no column. teams_select_club (0002) is
--   `club_id = my_club()`, and teams_manage (0012) is `club_id = my_club()
--   and has_perm('teams.manage')` for every command. A row's visibility and
--   writability already cover every column it has, including ones added
--   later, so the read stays club wide, the write still takes teams.manage,
--   and a coach without it who sends an UPDATE naming sort_order changes
--   zero rows, exactly as they would for name today.
--
--   THE GRANTS ARE CAPTURED, NOT ASSUMED, which is the lesson 0048 paid
--   for. teams was created by 0002, which issued no GRANT, so on the hosted
--   project the Data API roles hold the legacy blanket table privileges
--   inherited from Supabase's default privileges for new tables, and RLS is
--   the layer that decides; on a fresh local stack the privileges are
--   whatever tests/security/local-grants.sql reproduces. This file cannot
--   know which posture it is running against, and it does not need to: it
--   fingerprints the table grants, the raw ACL, every column ACL and the
--   full policy set on entry and requires them unchanged on exit, plus the
--   new column carrying no column scoped grant of its own. anon's posture
--   is whatever it was, and the file proves it did not widen it.
--
--   audit_teams() is REPLACED, not re-attached: the existing audit_teams
--   trigger (0037) picks up the new body, exactly as it did when 0044 added
--   bib_colour. The trigger set on teams is fingerprinted and must not
--   move.
--
--   No capability key is added. teams.manage already covers writing the
--   column, because it covers writing the row.
--
-- IT ADDS NO NEW AUDIT ACTION. team.updated with changed_fields naming
-- 'sort_order' is the trail, rendered as the deliberately general "Team
-- updated" (src/lib/activityView.ts), which a third field does not
-- falsify. No value, old or new, enters the event: audit_domain_event has
-- no argument that could carry one, and the self-verification reads the
-- stored function back and requires that new.sort_order appears in it
-- exactly once, in the comparison that decides whether to name the field.
-- R1 in docs/product/coaching-workflow/08-open-questions.md is therefore
-- decided as its recommended default: yes, it joins the allow list.
--
-- IT ADDS NO CHECK CONSTRAINT. No range, no positivity, no contiguity: the
-- settled shape is an integer and a uniqueness rule, and a constraint here
-- would be a policy this programme has not decided.
--
-- ---------------------------------------------------------------------
-- SAFETY OF THE CHANGE ITSELF
-- ---------------------------------------------------------------------
--
-- `add column` with no default rewrites no rows and takes a brief ACCESS
-- EXCLUSIVE lock on a five row table. The index build takes a SHARE lock
-- on the same five rows and returns immediately; CONCURRENTLY is
-- deliberately not used, because it cannot run inside a transaction and
-- this apply is one transaction by design. `create or replace function`
-- swaps the body atomically under the existing trigger.
--
-- The statements are plain, not `if not exists`. A second run of this file
-- must fail loudly at its first statement rather than skip it and then
-- fail a later assertion for a reason that reads like something else; the
-- production workflow's pre gate refuses a second press before either can
-- happen, and the harness proves both.
--
-- THE SELF-VERIFICATION EXERCISES THE INDEX RATHER THAN DESCRIBING IT. It
-- inserts two synthetic clubs and three synthetic teams inside a
-- subtransaction, proves that two unordered teams coexist, that one club's
-- teams cannot share a position, that two clubs may, that a position can
-- be given back, and that each of those writes leaves exactly the audit
-- trail the allow list says; then it raises a private SQLSTATE that the
-- enclosing block catches, so the subtransaction is ALWAYS rolled back and
-- nothing it did survives, which the block then checks against the before
-- fingerprint rather than trusting. A club insert cascades into
-- clubs_bootstrap_season (0031) and that season's audit row, and all of it
-- rolls back with the rest; on the hosted database the only lasting trace
-- is a few consumed uuid and sequence values. 0044 exercised its venue
-- name check the same way, on the real table, for the same reason: a rule
-- that has been run is a rule that has been proved.
--
-- APPLY ORDER. Safe to apply before or after the frontend, because no
-- deployed client reads or writes the column: TEAM_COLS in
-- src/lib/queries.ts selects an explicit list that does not name it, so
-- the deployed client never sees it, and every write it sends omits it,
-- so the null stands. COACH-1B, which reads and writes it, lands only
-- after this has applied.
--
-- ROLLBACK. Structurally:
--   drop index public.teams_sort_order_unique;
--   alter table public.teams drop column sort_order;
-- and restore audit_teams() to 0044's body. Dropping the column discards
-- the club's stated order and nothing else; no other object references it.
--
-- TRANSACTION SHAPE. The file opens with BEGIN and closes with COMMIT,
-- which the production apply relies on: it wraps the file in an outer
-- transaction with the ledger insert, and the file's own COMMIT commits
-- both. Every assertion below runs before that COMMIT, so a failure rolls
-- the whole migration back and takes the ledger row with it.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Hold teams for the whole transaction BEFORE the fingerprint is read.
-- The ALTER below takes this lock anyway; taking it first means no other
-- session can commit a team write between the fingerprint and the DDL, so
-- a comparison that fails below fails because of THIS file and never
-- because a coach renamed a team at the wrong second. Nothing else is
-- locked: a session save or a register tick elsewhere proceeds, which is
-- why the audit comparisons below count team events only.
-- ---------------------------------------------------------------------
lock table public.teams in access exclusive mode;

-- ---------------------------------------------------------------------
-- The BEFORE fingerprint, taken before any DDL, in a transaction local
-- table dropped on commit. A fingerprint read after the change and
-- compared with itself asserts nothing (0048's review, restated by 0049),
-- so one side of every "changed nothing" claim below is read here.
-- ---------------------------------------------------------------------
create temporary table _0051_before on commit drop as
select
  (select count(*) from public.teams)                                        as team_rows,
  -- Every team row, whole. Any change to any of them, in any column,
  -- moves this; the comparison after the change subtracts the one column
  -- this file is allowed to add.
  (select coalesce(md5(string_agg(to_jsonb(t)::text, ',' order by t.id)), 'empty')
     from public.teams t)                                                    as rows_fingerprint,
  -- Team events only: another table's audit row committed by another
  -- session during the apply is not this file's business.
  (select count(*) from public.audit_events where entity_type = 'team')      as team_audit_rows,
  (select relrowsecurity from pg_class where oid = 'public.teams'::regclass) as rls_enabled,
  -- The policy set in full, not just its size: a policy silently rewritten
  -- keeps the count identical.
  (select coalesce(md5(string_agg(p.policyname || ':' || p.cmd || ':' || p.permissive || ':' ||
                                  coalesce(array_to_string(p.roles, '+'), '') || ':' ||
                                  coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ','
                                  order by p.policyname)), 'none')
     from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'teams')                 as policies_fingerprint,
  -- Three grant fingerprints, because one view cannot see everything: the
  -- readable one, the stored ACL itself, and the column scoped one that
  -- role_table_grants cannot show at all.
  (select coalesce(md5(string_agg(g.grantee || ':' || g.privilege_type || ':' || g.is_grantable, ','
                                  order by g.grantee, g.privilege_type)), 'none')
     from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'teams')              as table_grants_fingerprint,
  (select coalesce(relacl::text, 'default')
     from pg_class where oid = 'public.teams'::regclass)                     as table_acl,
  (select coalesce(md5(string_agg(a.attname || ':' || coalesce(a.attacl::text, '-'), ','
                                  order by a.attname)), 'none')
     from pg_attribute a
    where a.attrelid = 'public.teams'::regclass
      and a.attnum > 0 and not a.attisdropped)                               as column_acl_fingerprint,
  -- The trigger set on teams, by name and by the function each fires. The
  -- audit trigger must still be there and must still fire audit_teams().
  (select coalesce(string_agg(t.tgname || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text, ','
                              order by t.tgname), 'none')
     from pg_trigger t
    where t.tgrelid = 'public.teams'::regclass and not t.tgisinternal)      as triggers_fingerprint,
  -- The capability catalogue, so "no key was added" is a comparison.
  (select count(*) from public.capabilities)                                 as capability_keys;

-- ---------------------------------------------------------------------
-- The column. Nullable, no default: null is "not configured", which is
-- every team on apply and claims nothing.
-- ---------------------------------------------------------------------
alter table public.teams add column sort_order integer;

comment on column public.teams.sort_order is
  $$The club's ordering of its own teams (0051, coaching workflow COACH-1): this team's position in the club's list, meaningful only within one club. Null means the club has not configured its order, which is what every team starts with; nothing backfills it. Two non-null teams in one club cannot share a position (teams_sort_order_unique); different clubs may use the same positions; positions need not be contiguous or start at any number. Written by a teams.manage holder through the existing teams_manage policy, and no policy names this column. It is NOT an ability score and there is no per-player field: it orders teams, and the grouping suggestion (COACH-3) is the consumer that will read it to know which teams are adjacent once COACH-1B wires it; nothing reads it yet. Labels stay alphabetical (sessionTeamsLabel). Changing it records team.updated with changed_fields naming sort_order and never a value.$$;

-- ---------------------------------------------------------------------
-- The uniqueness rule, as a partial unique index: a club may leave any
-- number of teams unordered, and among the ordered ones no two share a
-- position. Keyed by club_id first, because a position means nothing
-- across clubs. A unique constraint cannot be partial, which is why this
-- is an index, as 0048's is.
-- ---------------------------------------------------------------------
create unique index teams_sort_order_unique
  on public.teams (club_id, sort_order)
  where sort_order is not null;

-- ---------------------------------------------------------------------
-- audit_teams gains sort_order on its update allow list. The body is
-- otherwise 0044's verbatim; the existing trigger picks up the
-- replacement. Field NAMES only, never values, as everywhere else.
-- ---------------------------------------------------------------------
create or replace function public.audit_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club   uuid;
  v_id     uuid;
  v_action text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_id := new.id; v_action := 'team.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_id := old.id; v_action := 'team.deleted';
  else
    v_club := new.club_id; v_id := new.id;
    if new.name is distinct from old.name then v_changed := array_append(v_changed, 'name'); end if;
    if new.bib_colour is distinct from old.bib_colour then v_changed := array_append(v_changed, 'bib_colour'); end if;
    if new.sort_order is distinct from old.sort_order then v_changed := array_append(v_changed, 'sort_order'); end if;
    if array_length(v_changed, 1) is null then return new; end if;
    v_action := 'team.updated';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'team', v_id, v_id, nullif(v_changed, '{}'));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Self verification. Same transaction as everything above, so any failure
-- rolls the whole release back and leaves the database exactly as it was.
--
-- It proves what this migration CHANGED, by running the rule rather than
-- describing it, and it proves what it did NOT change, by comparing
-- against the fingerprint taken before the DDL rather than by asserting a
-- posture it cannot know.
-- ---------------------------------------------------------------------
do $$
declare
  b         _0051_before;
  n         integer;
  v_src     text;
  v_def     text;
  v_after   text;
  v_club_a  uuid;
  v_club_b  uuid;
  v_t1      uuid;
  v_t2      uuid;
  v_t3      uuid;
  v_before  integer;
begin
  select * into b from _0051_before;
  if not found then
    raise exception 'team_sort_order: the before fingerprint is missing, so nothing can be compared';
  end if;

  -- ---- 1. The column, in the exact shape the register probe and the ----
  --         future client assume: integer, nullable, no default.
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'teams' and column_name = 'sort_order'
     and data_type = 'integer' and is_nullable = 'YES' and column_default is null;
  if n <> 1 then
    raise exception 'team_sort_order: sort_order must be a nullable integer with no default (got %)', n;
  end if;

  -- ---- 2. NOTHING WAS BACKFILLED. Every team is unordered, every other --
  --         column of every row is byte for byte what it was, and the row
  --         count did not move.
  select count(*) into n from public.teams where sort_order is not null;
  if n <> 0 then
    raise exception 'team_sort_order: % team(s) were given a position; this migration must order nobody', n;
  end if;
  select coalesce(md5(string_agg((to_jsonb(t) - 'sort_order')::text, ',' order by t.id)), 'empty')
    into v_after from public.teams t;
  if v_after is distinct from b.rows_fingerprint then
    raise exception 'team_sort_order: an existing team row changed (% -> %)', b.rows_fingerprint, v_after;
  end if;
  select count(*) into n from public.teams;
  if n <> b.team_rows then
    raise exception 'team_sort_order: the team count changed (% -> %)', b.team_rows, n;
  end if;

  -- ---- 3. THE INDEX, in the exact shape: unique, partial, keyed --------
  --         (club_id, sort_order) in that order, and nothing else. The
  --         rendered definition is compared whole, so a reordered key, a
  --         dropped predicate or a different method is a different index.
  select pg_get_indexdef(c.oid) into v_def
    from pg_index x
    join pg_class c on c.oid = x.indexrelid
   where x.indrelid = 'public.teams'::regclass
     and c.relname = 'teams_sort_order_unique'
     and x.indisunique and not x.indisprimary
     and x.indpred is not null and x.indnkeyatts = 2;
  if v_def is null then
    raise exception 'team_sort_order: teams_sort_order_unique is missing or is not a two column partial unique index';
  end if;
  if v_def <> 'CREATE UNIQUE INDEX teams_sort_order_unique ON public.teams USING btree (club_id, sort_order) WHERE (sort_order IS NOT NULL)' then
    raise exception 'team_sort_order: the index definition is not the reviewed one: %', v_def;
  end if;

  -- ---- 4. THE RULE BITES, AND ONLY WHERE IT SHOULD, proved by running ---
  --         it. Synthetic clubs and teams inside a subtransaction that is
  --         ALWAYS rolled back: the block ends by raising a private
  --         SQLSTATE, which the handler swallows, so nothing here survives
  --         whatever happens above it. Step 5 checks that rather than
  --         trusting it.
  v_before := b.team_audit_rows;
  begin
    insert into public.clubs (name) values ('0051 probe club A') returning id into v_club_a;
    insert into public.clubs (name) values ('0051 probe club B') returning id into v_club_b;
    insert into public.teams (club_id, name) values (v_club_a, '0051 probe team one')   returning id into v_t1;
    insert into public.teams (club_id, name) values (v_club_a, '0051 probe team two')   returning id into v_t2;
    insert into public.teams (club_id, name) values (v_club_b, '0051 probe team three') returning id into v_t3;

    -- Two unordered teams in one club coexist. A unique index treats
    -- nulls as distinct with or without a predicate (NULLS DISTINCT is
    -- the default), so this pins the meaning the product relies on, that
    -- null is not a position, and not the predicate; the predicate is
    -- pinned by step 3's compare of the whole definition.
    select count(*) into n from public.teams where club_id = v_club_a and sort_order is null;
    if n <> 2 then
      raise exception 'team_sort_order: two unordered teams in one club must coexist (got %)', n;
    end if;

    -- One position each within club A.
    update public.teams set sort_order = 1 where id = v_t1;
    update public.teams set sort_order = 2 where id = v_t2;

    -- The SAME position in a DIFFERENT club is allowed: positions mean
    -- something only within one club.
    update public.teams set sort_order = 1 where id = v_t3;

    -- A duplicate position in the SAME club is refused, by this index and
    -- by name. The refused statement's own subtransaction rolls back, so
    -- it leaves no audit row either, which step 4's counts rely on.
    begin
      update public.teams set sort_order = 1 where id = v_t2;
      raise exception 'team_sort_order: two teams in one club took the same position';
    exception
      when unique_violation then
        if sqlerrm not like '%teams_sort_order_unique%' then
          raise exception 'team_sort_order: the duplicate was refused by something other than teams_sort_order_unique: %', sqlerrm;
        end if;
    end;
    select sort_order into n from public.teams where id = v_t2;
    if n is distinct from 2 then
      raise exception 'team_sort_order: the refused write must leave the row where it was (got %)', n;
    end if;

    -- A position can be given back. Null is a value a teams.manage holder
    -- may write, and it frees the position for another team.
    update public.teams set sort_order = null where id = v_t1;
    update public.teams set sort_order = 1 where id = v_t3;   -- same value: no change, no event
    update public.teams set name = '0051 probe team two, renamed' where id = v_t2;

    -- THE AUDIT TRAIL IS THE ALLOW LIST AND NOTHING MORE. Each positioning
    -- is one team.updated naming sort_order and no value; a rename still
    -- names name alone; a write that changes nothing writes nothing; and
    -- the creations are the three team.created events the trigger has
    -- always written. Counted rather than ordered, because every event in
    -- one transaction shares one occurred_at.
    select count(*) into n from public.audit_events
     where entity_id = v_t1 and action = 'team.updated';
    if n <> 2 then
      raise exception 'team_sort_order: a team positioned then unordered must leave two team.updated events (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id = v_t1 and action = 'team.updated'
       and changed_fields = array['sort_order']
       and safe_changes is null and metadata is null
       and entity_type = 'team' and team_id = v_t1;
    if n <> 2 then
      raise exception 'team_sort_order: a position change must be recorded as changed_fields = {sort_order} with no value (got % of 2)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id = v_t2 and action = 'team.updated' and changed_fields = array['sort_order'];
    if n <> 1 then
      raise exception 'team_sort_order: the refused duplicate must leave no event and the accepted position one (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id = v_t2 and action = 'team.updated' and changed_fields = array['name'];
    if n <> 1 then
      raise exception 'team_sort_order: a rename must still be recorded as changed_fields = {name} alone (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id = v_t3 and action = 'team.updated';
    if n <> 1 then
      raise exception 'team_sort_order: a write that changes no allow listed field must write no event (got % for one positioning)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id in (v_t1, v_t2, v_t3) and action = 'team.created' and changed_fields is null;
    if n <> 3 then
      raise exception 'team_sort_order: the three creations must leave three team.created events (got %)', n;
    end if;
    select count(*) into n from public.audit_events
     where entity_id in (v_t1, v_t2, v_t3)
       and (safe_changes is not null or metadata is not null);
    if n <> 0 then
      raise exception 'team_sort_order: no team event may carry a value (% did)', n;
    end if;

    -- Unwind. Nothing this probe did survives.
    raise exception using errcode = 'OTJ51', message = 'team_sort_order: probe complete, rolling back';
  exception
    when sqlstate 'OTJ51' then
      null;
  end;

  -- ---- 5. THE PROBE LEFT NOTHING BEHIND. Checked against the before ----
  --         fingerprint, not against the probe's own bookkeeping.
  select count(*) into n from public.clubs where name like '0051 probe club %';
  if n <> 0 then
    raise exception 'team_sort_order: % probe club(s) survived the rollback', n;
  end if;
  select count(*) into n from public.teams where name like '0051 probe team %';
  if n <> 0 then
    raise exception 'team_sort_order: % probe team(s) survived the rollback', n;
  end if;
  select count(*) into n from public.audit_events where entity_type = 'team';
  if n <> v_before then
    raise exception 'team_sort_order: the migration must write no team audit event (% -> %)', v_before, n;
  end if;
  select count(*) into n from public.teams;
  if n <> b.team_rows then
    raise exception 'team_sort_order: the team count moved after the probe (% -> %)', b.team_rows, n;
  end if;
  select coalesce(md5(string_agg((to_jsonb(t) - 'sort_order')::text, ',' order by t.id)), 'empty')
    into v_after from public.teams t;
  if v_after is distinct from b.rows_fingerprint then
    raise exception 'team_sort_order: a team row changed during the probe (% -> %)', b.rows_fingerprint, v_after;
  end if;
  select count(*) into n from public.teams where sort_order is not null;
  if n <> 0 then
    raise exception 'team_sort_order: % team(s) hold a position after the probe; it must leave every team unordered', n;
  end if;

  -- ---- 6. THE STORED audit_teams() IS THE ALLOW LIST IT CLAIMS TO BE. ---
  --         Read back from the catalogue, so these hold against what will
  --         actually run rather than against the file as reviewed.
  v_src := pg_get_functiondef('public.audit_teams()'::regprocedure);
  if v_src !~ 'new\.sort_order is distinct from old\.sort_order' then
    raise exception 'team_sort_order: the audit_teams allow list must name sort_order by the same comparison the other fields use';
  end if;
  if v_src !~ 'new\.name is distinct from old\.name'
     or v_src !~ 'new\.bib_colour is distinct from old\.bib_colour' then
    raise exception 'team_sort_order: the existing audit_teams allow list (name, bib_colour) must be retained';
  end if;
  -- The field NAME is all that reaches an event. new.sort_order appears
  -- exactly once, in the comparison, and old.sort_order likewise; there is
  -- no second use that could carry the value anywhere.
  if (length(v_src) - length(replace(v_src, 'new.sort_order', ''))) / length('new.sort_order') <> 1
     or (length(v_src) - length(replace(v_src, 'old.sort_order', ''))) / length('old.sort_order') <> 1 then
    raise exception 'team_sort_order: audit_teams must read sort_order only in the comparison that names the field';
  end if;
  -- The writer is still the one that cannot carry a value, called once,
  -- and audit_teams writes no event of its own and names no value column.
  if (length(v_src) - length(replace(v_src, 'public.audit_domain_event(', ''))) / length('public.audit_domain_event(') <> 1 then
    raise exception 'team_sort_order: audit_teams must call audit_domain_event exactly once';
  end if;
  if v_src ~* 'safe_changes|metadata|insert\s+into\s+public\.audit_events' then
    raise exception 'team_sort_order: audit_teams must not write an event itself or name a value column';
  end if;
  -- The three team actions, unchanged, and no fourth.
  if position('''team.created''' in v_src) = 0
     or position('''team.updated''' in v_src) = 0
     or position('''team.deleted''' in v_src) = 0 then
    raise exception 'team_sort_order: audit_teams must keep its three actions';
  end if;
  select count(*) into n from regexp_matches(v_src, '''team\.[a-z_]+''', 'g');
  if n <> 3 then
    raise exception 'team_sort_order: audit_teams must carry exactly three team actions (got %)', n;
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.audit_teams()'::regprocedure
       and p.prosecdef
       and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'team_sort_order: audit_teams must stay SECURITY DEFINER with an empty search_path';
  end if;
  -- And it is still the function the existing AFTER INSERT OR UPDATE OR
  -- DELETE ... FOR EACH ROW trigger fires (tgtype 29 = row | insert |
  -- delete | update, with the BEFORE bit clear).
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.teams'::regclass and t.tgname = 'audit_teams'
       and not t.tgisinternal
       and t.tgfoid = 'public.audit_teams()'::regprocedure
       and (t.tgtype & 29) = 29 and (t.tgtype & 2) = 0
  ) then
    raise exception 'team_sort_order: the audit_teams trigger must still fire audit_teams() after insert, update and delete';
  end if;

  -- ---- 7. WHAT THIS MIGRATION DID NOT CHANGE, compared against the ------
  --         before fingerprint. A column, an index and a function body
  --         cannot move a policy, a grant, a trigger or a capability; these
  --         exist so the claim is checked rather than asserted, and so a
  --         future edit to this file that adds one fails the apply instead
  --         of passing review.
  if not b.rls_enabled
     or not (select relrowsecurity from pg_class where oid = 'public.teams'::regclass) then
    raise exception 'team_sort_order: row level security must be enabled on teams before and after';
  end if;
  if (select coalesce(md5(string_agg(p.policyname || ':' || p.cmd || ':' || p.permissive || ':' ||
                                     coalesce(array_to_string(p.roles, '+'), '') || ':' ||
                                     coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ','
                                     order by p.policyname)), 'none')
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = 'teams') is distinct from b.policies_fingerprint then
    raise exception 'team_sort_order: the migration must change no policy on teams';
  end if;
  -- And the two policies are still the two this file's header describes:
  -- the club wide read, and every write behind teams.manage, with no
  -- policy naming the new column.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'teams';
  if n <> 2 then
    raise exception 'team_sort_order: teams must carry exactly its two policies (got %)', n;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'teams' and policyname = 'teams_manage'
       and cmd = 'ALL' and qual like '%teams.manage%' and with_check like '%teams.manage%'
  ) then
    raise exception 'team_sort_order: every write to teams must still require teams.manage';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'teams' and policyname = 'teams_select_club'
       and cmd = 'SELECT' and qual like '%my_club()%' and qual not like '%has_perm%'
  ) then
    raise exception 'team_sort_order: the club wide read of teams must be unchanged';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'teams'
       and (coalesce(qual, '') like '%sort_order%' or coalesce(with_check, '') like '%sort_order%')
  ) then
    raise exception 'team_sort_order: no policy may name sort_order';
  end if;
  if (select coalesce(md5(string_agg(g.grantee || ':' || g.privilege_type || ':' || g.is_grantable, ','
                                     order by g.grantee, g.privilege_type)), 'none')
        from information_schema.role_table_grants g
       where g.table_schema = 'public' and g.table_name = 'teams') is distinct from b.table_grants_fingerprint then
    raise exception 'team_sort_order: the migration must change no table grant on teams';
  end if;
  if (select coalesce(relacl::text, 'default') from pg_class where oid = 'public.teams'::regclass)
     is distinct from b.table_acl then
    raise exception 'team_sort_order: the stored ACL of teams must not move';
  end if;
  -- The column ACLs, minus the new column, are what they were, and the new
  -- column carries no column scoped grant of its own: pg_attribute.attacl,
  -- not information_schema.column_privileges, which expands a table wide
  -- grant into one row per column and would report a grant nobody made.
  if (select coalesce(md5(string_agg(a.attname || ':' || coalesce(a.attacl::text, '-'), ','
                                     order by a.attname)), 'none')
        from pg_attribute a
       where a.attrelid = 'public.teams'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attname <> 'sort_order') is distinct from b.column_acl_fingerprint then
    raise exception 'team_sort_order: an existing column of teams gained or lost a column scoped grant';
  end if;
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.teams'::regclass and a.attname = 'sort_order' and a.attacl is not null
  ) then
    raise exception 'team_sort_order: sort_order must carry no column scoped grant';
  end if;
  if (select coalesce(string_agg(t.tgname || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text, ','
                                 order by t.tgname), 'none')
        from pg_trigger t
       where t.tgrelid = 'public.teams'::regclass and not t.tgisinternal) is distinct from b.triggers_fingerprint then
    raise exception 'team_sort_order: the trigger set on teams must not move';
  end if;
  if b.triggers_fingerprint = 'none' then
    raise exception 'team_sort_order: the trigger fingerprint is empty, so it asserts nothing';
  end if;
  if (select count(*) from public.capabilities) <> b.capability_keys then
    raise exception 'team_sort_order: the migration must add no capability key';
  end if;
  if exists (select 1 from public.capabilities where key like '%sort%' or key like '%order%') then
    raise exception 'team_sort_order: no capability may be named for the team order; teams.manage covers it';
  end if;
  if not exists (select 1 from public.capabilities where key = 'teams.manage') then
    raise exception 'team_sort_order: the teams.manage capability is missing';
  end if;
end
$$;

commit;
