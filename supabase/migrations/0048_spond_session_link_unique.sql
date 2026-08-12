-- =====================================================================
-- OTJ Training Hub, migration 0048_spond_session_link_unique: one
-- mirrored Spond event holds at most one Hub session, and the one
-- production row that broke that is repaired
--
-- REVIEW REQUIRED, and NOT APPLIED. Migrations are gated in this repo.
-- This file ships with the pull request and is applied afterwards through
-- .github/workflows/apply-production-migration.yml, once reviewed. Do not
-- auto-merge, do not run `supabase db push`, and do not dispatch the apply
-- workflow as part of reviewing this change.
--
-- NUMBERING. The live ledger ends at 20260812064038 /
-- register_group_inclusion (0047), checked against the hosted project on
-- 2026-08-12, so this is 0048. The file numbers on disk have gaps (0003,
-- 0004 and 0010 are absent); the ledger is the authority, not the highest
-- file name.
--
-- ---------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------
--
-- sessions.spond_event_id points at the mirrored Spond event a session is
-- arranged as. The product concept has always been one to one: an event is
-- a night, a night is a session, the session shows that event's attendance
-- context and Plan from Spond offers the events that do not have one yet.
--
-- Nothing enforced it. The column carried a plain btree index
-- (sessions_spond_event_id_idx, 0013), which makes the lookup fast and
-- permits any number of sessions to claim the same event. Two paths write
-- the column (Plan from Spond's create, and the session day's Link Spond
-- event picker), neither had a way to know the event was taken, and the
-- hosted database now holds the result:
--
--   spond_events e3065302-c164-4b23-b52a-2ce813271dac, the real
--   11 August 2026 Training event, is linked BOTH to
--
--     243aab0d-02a1-4ebe-887f-d2de588fc29e   2026-08-11  "Training"
--       the session that event belongs to, and
--
--     13637155-706f-4d8a-9dec-b5da5a15f620   2026-06-16
--       "Attacking session: 2v2 to score", a June session that has nothing
--       to do with it.
--
-- Read only inspection of the hosted project on 2026-08-12 found EXACTLY
-- ONE such group across 26 sessions, 10 of which carry a link, over 9
-- distinct events. Both rows belong to the same coach, so this was not two
-- coaches racing: it was one coach linking an old session to an event that
-- already had one, which nothing refused.
--
-- The visible damage is that the June session inherits the August event's
-- attendance context, and that any surface asking "is this event already
-- planned?" gets an answer that depends on which row it looked at.
--
-- ---------------------------------------------------------------------
-- WHAT IT DOES
-- ---------------------------------------------------------------------
--
--   1. Refuses any duplicated Spond link it was not shown, naming every
--      one of them.
--   2. Clears spond_event_id on that ONE June session, where it is still
--      there. Nothing else about the row changes and the row is not
--      deleted.
--   3. Adds sessions_spond_event_id_unique, a partial unique index over
--      spond_event_id where it is not null, so the corruption cannot
--      recur.
--   4. Proves all of it, including the things it must NOT have done.
--
-- IT IS CORRECT IN TWO PLACES, which is why step 2 says "where it is still
-- there". `supabase db reset` applies every migration in this directory to
-- a fresh local stack, on every developer machine and in CI, and that
-- database has never held the hosted damage. A file that INSISTED on
-- finding the bad pair would fail there for being right. So an absence is
-- accepted and reported; an unexpected duplicate is refused.
--
-- ---------------------------------------------------------------------
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------
--
-- IT DELETES NO SESSION. Both rows survive. The June session keeps its
-- name, date, plan, coach, teams, register rows, saved groups and board;
-- it simply stops claiming an event that was never its own.
--
-- IT REPAIRS NOTHING IT WAS NOT SHOWN. If a duplicated event appears that
-- is not the one named above, this file raises and the whole transaction
-- rolls back. There is no "keep the newest" or "keep the one whose date
-- matches" rule here, because either would be a guess about which link a
-- human meant, dressed up as a migration. A second occurrence is a second
-- review. The same applies to the reviewed event itself: it is repaired
-- only while it is held by exactly the two rows described above, each
-- still carrying the date it was reviewed with.
--
-- IT DOES NOT TOUCH live_activity_index. Five historic rows in the hosted
-- database carry a live marker their driver never cleared, which is what
-- kept June sessions sitting in the Upcoming list. That is fixed in the
-- client, by reading the marker as evidence with a date on it
-- (src/lib/sessionLifecycle.ts), and a stale marker is harmless from the
-- day that ships. Clearing them here would be a destructive rewrite of
-- historic rows to work around a display rule, and it would hide whether
-- the display rule is actually right.
--
-- IT REWRITES NO STATUS. sessions.status stays exactly as stored on every
-- row.
--
-- IT CHANGES NO POLICY, GRANT, CAPABILITY, ROLE OR TRIGGER, and needs to
-- change none:
--
--   The four policies on sessions name no column; they gate by club and
--   capability, so they already cover this column and the index does not
--   change what anybody may read or write.
--
--   An index is not an access control. It refuses a value, not a person.
--   A coach who may write the session may still write the session; they
--   simply cannot claim an event another session already holds.
--
--   audit_sessions() fires on every sessions update but records an event
--   only when team_id, date, status, programme_id, programme_week or
--   venue_id changed. spond_event_id is not one of them, so the repair
--   below writes no audit row, and the verification asserts that the audit
--   table is byte identical afterwards rather than assuming it.
--
--   content_rights_fa_lock_sessions() fires BEFORE this update and asserts
--   the row's rights against its source evidence. The June session has
--   source_url null, so it carries no England Football evidence and the
--   assertion passes unchanged. The update touches neither rights nor
--   source_url.
--
-- IT DOES NOT DROP sessions_spond_event_id_idx. The plain index becomes
-- redundant for lookups the unique index can serve, and removing it would
-- be a second, unrelated schema change in a migration whose whole value is
-- being narrow. It costs one index maintenance per session write on a
-- table with 26 rows.
--
-- ---------------------------------------------------------------------
-- WHY A PARTIAL UNIQUE INDEX, AND WHY ON THIS KEY
-- ---------------------------------------------------------------------
--
-- WHY AN INDEX RATHER THAN A UNIQUE CONSTRAINT. A unique constraint cannot
-- be partial, and most sessions have no Spond link at all: 16 of the 26
-- hosted rows are null today. Postgres already permits many nulls in a
-- unique index, so a full unique index would also be CORRECT, but it would
-- index sixteen nulls to say nothing about them. `where spond_event_id is
-- not null` states the rule the product actually holds: a session need not
-- have an event, and an event may not have two sessions.
--
-- WHY NOT (club_id, spond_event_id). A spond_events row is already the
-- property of exactly one club, and sessions.spond_event_id is a foreign
-- key into it, so two clubs cannot reach the same event id. Scoping the
-- uniqueness by club would therefore permit nothing extra and would only
-- weaken the guarantee if a mirror row were ever re-parented.
--
-- WHY NOT A TRIGGER. The invariant is "no two rows share this value",
-- which is what a unique index is. A trigger would have to read the table
-- it is being written to, and would race under concurrency, which is the
-- exact case this exists to close: two coaches pressing Plan this on the
-- same event in the same second.
--
-- ---------------------------------------------------------------------
-- WHAT THE CLIENT DOES WITH THE REFUSAL
-- ---------------------------------------------------------------------
--
-- A refused write arrives as PostgREST 23505 naming this index.
-- src/lib/queries.ts recognises it (isSpondLinkTaken), translates it into
-- one sentence a coach can act on, refetches the sessions and events, and
-- never recovers it into an update of a row that does not exist. Plan from
-- Spond also stops offering an event that ANY club session already links,
-- so the refusal is the backstop for a race rather than the everyday path.
--
-- ---------------------------------------------------------------------
-- SAFETY OF THE CHANGE ITSELF
-- ---------------------------------------------------------------------
--
-- The update touches one row by primary key. The index build takes a brief
-- SHARE lock on a 26 row table and returns immediately; CONCURRENTLY is
-- deliberately not used, because it cannot run inside a transaction and
-- this apply is one transaction by design.
--
-- ---------------------------------------------------------------------
-- APPLY ORDER. THIS MIGRATION GOES FIRST, before the frontend from the
-- same change is deployed, and it is safe to run early:
--
--   * the deployed (old) client reads and writes spond_event_id exactly as
--     it does now. The only behaviour the index adds is refusing a SECOND
--     session on an event that already has one, which the old client would
--     report as a generic "couldn't create the session" rather than the new
--     wording. That is a worse message, not a broken app, and it is the
--     right way round: an unenforced duplicate is silent corruption.
--
--   * the new client's only hard dependency is the wording and the refetch
--     on that refusal. Against a database WITHOUT the index it simply never
--     sees the refusal, because nothing refuses; its club wide "already
--     planned" check still keeps the suggestion list honest.
--
-- So neither order breaks, and applying it first is preferred: it is what
-- makes the duplicate impossible.
--
-- ROLLBACK. Structurally:
--   drop index if exists public.sessions_spond_event_id_unique;
-- The data repair is not reversible by a script, and re-creating the bad
-- link would be a deliberate act: the June session's link was wrong when it
-- was written. Nothing else in the schema references the index.
-- =====================================================================

-- ONE transaction, as 0041 through 0047 are.
begin;

-- ---------------------------------------------------------------------
-- Capture the sessions table BEFORE the change, so the verification at
-- the bottom can prove exactly one row moved and exactly one column of it
-- moved. Held in a temporary table dropped on commit, so it leaves
-- nothing behind.
--
-- to_jsonb over the whole row, rather than a list of columns: a
-- fingerprint that names columns proves only what its author remembered
-- to name, and this one has to prove that NOTHING ELSE changed.
-- ---------------------------------------------------------------------
create temporary table sessions_link_before on commit drop as
select
  (select count(*) from public.sessions)                                     as total_rows,
  (select count(*) from public.sessions where spond_event_id is not null)    as linked_rows,
  -- Every row except the one being repaired, whole. Any change to any of
  -- them, in any column, moves this.
  (select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty')
     from public.sessions s
    where s.id <> '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid)              as other_rows_fingerprint,
  -- The repaired row, whole, minus the one column this migration is
  -- allowed to change.
  (select coalesce(md5((to_jsonb(s) - 'spond_event_id')::text), 'missing')
     from public.sessions s
    where s.id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid)               as repaired_row_fingerprint,
  (select count(*) from public.audit_events)                                 as audit_rows,
  (select count(*) from public.sessions where live_activity_index is not null) as live_marked_rows,
  -- Whether the ONE bad link this file repairs is present: 1 on the hosted
  -- database, 0 anywhere the repair has nothing to do (a fresh `supabase db
  -- reset`, a developer's stack, a restored copy taken after the repair).
  -- Every count below is stated relative to this, so the same file is correct
  -- in both places without either branch guessing.
  (select count(*) from public.sessions
    where id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid
      and spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid)      as bad_link_rows,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'sessions')                  as session_policies;

-- ---------------------------------------------------------------------
-- THE ASSUMPTIONS, AND THE REPAIR, IN ONE BLOCK.
--
-- The file has to be correct in two places: the hosted database, where one
-- named link is wrong and must be cleared, and every OTHER database this
-- repository's migrations run against, where that link has never existed.
-- `supabase db reset` applies every migration to a fresh local stack on
-- every developer machine and in CI, so a file that insisted on finding
-- production's damage would fail there, every time, for being correct.
--
-- So the shape is: refuse anything UNEXPECTED, repair the one thing that is
-- expected IF it is there, and add the guarantee either way. What is
-- refused is a duplicate this file was not shown; what is not refused is an
-- absence.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  dupes text;
  bad integer;
begin
  -- 1. NO DUPLICATE THIS FILE WAS NOT SHOWN. This is the fail closed check:
  --    an unexpected duplicated event has no repair here, because "keep the
  --    newest" and "keep the one whose date matches" are both guesses about
  --    which link a human meant. The message names every offender so the
  --    person reading the failed run knows exactly what to review.
  select count(*), coalesce(string_agg(d.spond_event_id::text, ', ' order by d.spond_event_id), '')
    into n, dupes
    from (select spond_event_id
            from public.sessions
           where spond_event_id is not null
           group by spond_event_id
          having count(*) > 1) d
   where d.spond_event_id <> 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;
  if n <> 0 then
    raise exception 'spond_session_link_unique: % Spond event(s) are held by more than one session and are not the reviewed pair (%). This migration repairs one known link and refuses to guess at any other.', n, dupes;
  end if;

  -- 2. THE REVIEWED PAIR, if it is still here. On the hosted database it is;
  --    on a fresh database none of this matches and there is nothing to do.
  select count(*) into n
    from public.sessions
   where spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;

  if n > 1 then
    -- The event IS duplicated, so it must be duplicated by exactly the two
    -- rows this file was reviewed against, each still what it was described
    -- as. Anything else is an unexpected duplicate wearing a familiar id.
    if n <> 2 then
      raise exception 'spond_session_link_unique: the 11 August event is held by % sessions, and only the reviewed pair of 2 can be repaired here', n;
    end if;
    select count(*) into n
      from public.sessions
     where id = '243aab0d-02a1-4ebe-887f-d2de588fc29e'::uuid
       and date = date '2026-08-11'
       and spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;
    if n <> 1 then
      raise exception 'spond_session_link_unique: the 11 August session 243aab0d is not the row it was reviewed as; refusing to repair';
    end if;
    select count(*) into n
      from public.sessions
     where id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid
       and date = date '2026-06-16'
       and spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;
    if n <> 1 then
      raise exception 'spond_session_link_unique: the 16 June session 13637155 is not the row it was reviewed as; refusing to repair';
    end if;
  end if;

  -- 3. THE INDEX must not already exist. The apply workflow's pre gate
  --    asserts the same thing; asserting it here means the file is safe to
  --    reason about on its own.
  if exists (select 1 from pg_class c
              where c.relname = 'sessions_spond_event_id_unique'
                and c.relnamespace = 'public'::regnamespace) then
    raise exception 'spond_session_link_unique: sessions_spond_event_id_unique already exists';
  end if;

  -- 4. THE REPAIR. One row, one column, by primary key, and only while it
  --    still holds the link being removed. Not a delete, not a rewrite: the
  --    June session keeps everything else it has ever had. Where the link is
  --    already absent this updates nothing, which is the whole point of
  --    counting first.
  select bad_link_rows into bad from sessions_link_before;
  update public.sessions
     set spond_event_id = null
   where id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid
     and spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;
  get diagnostics n = row_count;
  if n <> bad then
    raise exception 'spond_session_link_unique: the repair touched % rows, expected exactly %', n, bad;
  end if;
  if bad = 1 then
    raise notice 'spond_session_link_unique: cleared the erroneous Spond link on session 13637155';
  else
    raise notice 'spond_session_link_unique: no erroneous Spond link present; adding the guarantee only';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- THE GUARANTEE. One session per mirrored Spond event, enforced by
-- Postgres, including for two writes racing in the same second.
-- ---------------------------------------------------------------------
create unique index if not exists sessions_spond_event_id_unique
  on public.sessions (spond_event_id)
  where spond_event_id is not null;

comment on index public.sessions_spond_event_id_unique is
  $$At most one Hub session per mirrored Spond event (0048). The product concept is one to one: an event is a night and a night is a session, which is why Plan from Spond offers the events that have no session and why a session shows one event's attendance context. Nothing enforced it before this index, and the hosted database acquired a June session linked to the 11 August event, so a coach asking "is this planned?" got an answer that depended on which row was looked at. Partial because most sessions have no link and indexing their nulls would say nothing; not scoped by club because spond_events rows already belong to exactly one club through the foreign key. A refused write arrives at the client as 23505 naming this index and is translated there (src/lib/queries.ts isSpondLinkTaken) into one sentence a coach can act on.$$;

-- ---------------------------------------------------------------------
-- Self verification. Proves what this migration did, and just as
-- importantly what it did not do. Any failure aborts the whole
-- transaction, taking the ledger row with it.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  before_total integer;
  before_linked integer;
  before_others text;
  before_repaired text;
  before_audit integer;
  before_live integer;
  before_policies integer;
  before_bad integer;
  after_text text;
begin
  select total_rows, linked_rows, other_rows_fingerprint, repaired_row_fingerprint,
         audit_rows, live_marked_rows, session_policies, bad_link_rows
    into before_total, before_linked, before_others, before_repaired,
         before_audit, before_live, before_policies, before_bad
    from sessions_link_before;

  -- 1. THE INDEX, in the exact shape this file claims: unique, partial,
  --    over the one column, on public.sessions.
  select count(*) into n
    from pg_index x
    join pg_class c on c.oid = x.indexrelid
   where x.indrelid = 'public.sessions'::regclass
     and c.relname = 'sessions_spond_event_id_unique'
     and x.indisunique
     and x.indpred is not null
     and x.indnatts = 1
     and pg_get_indexdef(x.indexrelid) like '%spond_event_id%';
  if n <> 1 then
    raise exception 'spond_session_link_unique: the unique partial index is not present in the reviewed shape (got %)', n;
  end if;

  -- 2. THE INVARIANT HOLDS. Not "the index exists", which is a different
  --    claim: no event is held by two sessions.
  select count(*) into n
    from (select spond_event_id
            from public.sessions
           where spond_event_id is not null
           group by spond_event_id
          having count(*) > 1) d;
  if n <> 0 then
    raise exception 'spond_session_link_unique: % Spond event(s) are still held by more than one session', n;
  end if;

  -- 3. THE RIGHT LINK SURVIVED, where there was a repair to do. The
  --    11 August session still points at the 11 August event and is now the
  --    only session that does. Guarded on before_bad, because on a database
  --    that never held the bad pair neither row exists and there is nothing
  --    to say about them.
  if before_bad = 1 then
    select count(*) into n
      from public.sessions
     where spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid;
    if n <> 1 then
      raise exception 'spond_session_link_unique: the 11 August event is held by % sessions, expected exactly 1', n;
    end if;
    if not exists (select 1 from public.sessions
                    where id = '243aab0d-02a1-4ebe-887f-d2de588fc29e'::uuid
                      and spond_event_id = 'e3065302-c164-4b23-b52a-2ce813271dac'::uuid) then
      raise exception 'spond_session_link_unique: the 11 August session lost its Spond link, which is the one link this migration had to keep';
    end if;

    -- 4. THE JUNE SESSION IS STILL THERE, unlinked. Not deleted, not
    --    renamed, not re-dated, not re-owned.
    if not exists (select 1 from public.sessions
                    where id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid
                      and spond_event_id is null) then
      raise exception 'spond_session_link_unique: the June session is missing or still linked';
    end if;
  end if;

  -- The repaired row, whole, minus the one column this file may change.
  -- Compares 'missing' with 'missing' where the row does not exist, which is
  -- the correct claim there: it did not appear.
  select coalesce(md5((to_jsonb(s) - 'spond_event_id')::text), 'missing')
    into after_text
    from public.sessions s
   where s.id = '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid;
  if after_text is distinct from before_repaired then
    raise exception 'spond_session_link_unique: the June session changed in a column other than spond_event_id (% -> %)', before_repaired, after_text;
  end if;

  -- 5. NO OTHER ROW MOVED AT ALL. Every session except the repaired one,
  --    whole, hashed before and after.
  select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.id)), 'empty')
    into after_text
    from public.sessions s
   where s.id <> '13637155-706f-4d8a-9dec-b5da5a15f620'::uuid;
  if after_text is distinct from before_others then
    raise exception 'spond_session_link_unique: a session other than the repaired one changed (% -> %)', before_others, after_text;
  end if;
  select count(*) into n from public.sessions;
  if n <> before_total then
    raise exception 'spond_session_link_unique: the session count changed (% -> %); this migration deletes nothing', before_total, n;
  end if;
  select count(*) into n from public.sessions where spond_event_id is not null;
  if n <> before_linked - before_bad then
    raise exception 'spond_session_link_unique: expected exactly % link(s) to be cleared (% -> %)', before_bad, before_linked, n;
  end if;

  -- 6. NO AUDIT ROW. audit_sessions() ignores a spond_event_id only
  --    change, so a repair that produced an audit event would mean the
  --    update touched a column this file never intended to write.
  select count(*) into n from public.audit_events;
  if n <> before_audit then
    raise exception 'spond_session_link_unique: the audit trail changed (% -> %); the repair wrote a column it should not have', before_audit, n;
  end if;

  -- 7. THE SECURITY POSTURE IS UNTOUCHED. An index is not an access
  --    control, and this migration has no business moving any of this.
  if not exists (select 1 from pg_class
                  where relname = 'sessions'
                    and relnamespace = 'public'::regnamespace and relrowsecurity) then
    raise exception 'spond_session_link_unique: row level security is not enabled on sessions';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'sessions';
  if n <> before_policies then
    raise exception 'spond_session_link_unique: the sessions policy set changed (% -> %)', before_policies, n;
  end if;
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'sessions' and grantee = 'anon'
               and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'spond_session_link_unique: anon must hold no write on sessions';
  end if;

  -- 8. THE LIVE MARKERS ARE EXACTLY AS THEY WERE, said out loud because
  --    the change this migration ships alongside is about stale live
  --    markers and the tempting thing to do here was to clear them.
  --    Checks 4 and 5 already cover it column by column; this states the
  --    intent so it is a decision rather than an implication. A count, not
  --    an assertion that any exist: how many rows carry a marker is the
  --    club's business and may legitimately be zero by the time this runs.
  select count(*) into n from public.sessions where live_activity_index is not null;
  if n <> before_live then
    raise exception 'spond_session_link_unique: the number of sessions carrying a live marker changed (% -> %); this migration must leave every one of them exactly as it is', before_live, n;
  end if;
end
$$;

commit;
