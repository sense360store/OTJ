-- =====================================================================
-- OTJ Training Hub, migration 0052_atomic_team_order: one transactional,
-- capability gated RPC that writes the club's COMPLETE team order, or
-- writes nothing at all.
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand through the gated
-- workflow after line by line review, and only once the live ledger is
-- confirmed to have this slot free. Do not auto-merge. No Edge Function
-- deploy accompanies this migration.
--
-- Numbering: 0052. The files on disk end at 0051_team_sort_order.sql and
-- the live hosted ledger's newest row is 20260902150212 / team_sort_order,
-- read 3 September 2026. Per the standing rule the ledger is the
-- authority; confirm 0052 is still free against it immediately before
-- applying.
--
-- WHAT THIS ADDS. One function, public.set_team_order. Nothing else. It
-- adds NO table, NO column, NO index, NO policy, NO grant on any table, NO
-- capability key, NO trigger, and NO value to any vocabulary, including
-- audit_events.source and audit_events.action. Every write it performs is a
-- write a teams.manage holder could already perform by hand through the
-- teams_manage policy; what it adds is that the whole order lands together
-- or not at all, under one serialization point.
--
-- WHY IT EXISTS, and this is the whole review. COACH-1B (#225) saves the
-- club order from the browser as a sequence of separate PostgREST
-- statements: clear the moved rows, then place them, each conditioned on
-- the value the screen last read (a compare and set). That is the best a
-- client without a transaction can do, and it is not enough. Two admins
-- who move DISJOINT rows never collide:
--
--     stored:      A=1  B=2  C=3  D=4
--     admin one:   swap A and B   ->  B=1 A=2 C=3 D=4
--     admin two:   swap C and D   ->  A=1 B=2 D=3 C=4
--
-- Neither one touches a row the other writes, so every compare and set
-- passes, both commit, and the club is left with B=1 A=2 D=3 C=4: a
-- complete, valid, uniquely indexed order that NEITHER admin submitted and
-- neither will recognise. teams_sort_order_unique cannot object, because
-- the merge is a permutation like any other. The client can only read the
-- damage back afterwards and say so, which is what #225 does today.
--
-- The fix has to be in the database, because the missing thing is a
-- transaction: the read that validates the order and the writes that
-- store it must be one atomic, serialized unit. That is this function.
--
-- WHAT IT IS NOT, and these are the load bearing negatives:
--
--   * IT IS NOT A PRIVILEGE. It self gates on teams.manage, exactly the
--     capability the teams_manage policy (0012) already names, so it grants
--     no caller any authority they did not already hold. It is SECURITY
--     DEFINER, so RLS does not bind it and the in body checks ARE the
--     enforcement; they fail closed. A caller without the capability, or
--     without a club, is refused before anything is read.
--   * IT NEVER TOUCHES ANOTHER CLUB. The club is derived server side from
--     public.my_club(). The caller cannot name one, and every id they pass
--     is required to belong to that club, so no other club's teams are
--     readable, writable or nameable through this path. A foreign id is
--     refused by count, never echoed back.
--   * IT NEVER CHANGES ANY OTHER COLUMN. There is one UPDATE statement
--     shape in this function and it assigns sort_order. A team's name, bib
--     colour, club or creation time cannot move through it.
--   * IT CREATES AND DELETES NO TEAM. There is no insert into and no delete
--     from public.teams in this file. A club's membership is exactly what
--     it was; this orders what is there.
--   * IT WEAKENS teams_sort_order_unique BY NOTHING. The partial unique
--     index from 0051 is untouched and is still the last guard: this
--     function's clear-then-place exists precisely because the index is
--     checked per row and an in place swap would collide.
--   * IT LEAVES NO PARTIAL ORDER. Every failure path raises, and one raise
--     inside one function call rolls the whole call back. A dropped
--     connection mid call is rolled back by the server for the same reason.
--     The "honestly incomplete order" that #225's multi statement client
--     save can leave behind is not reachable through this path at all.
--
-- SERIALIZATION, which is the reason the function exists rather than a
-- nicety. Two locks, always in this order, both taken before any team row
-- is read:
--
--   1. A CLUB SCOPED ADVISORY TRANSACTION LOCK. Serialises whole order
--      saves against each other, per club. Two admins of one club are
--      strictly ordered: the second reads what the first committed, finds
--      its expected snapshot stale, and is refused. Two admins of
--      DIFFERENT clubs never wait on each other for this. Same idiom and
--      same 'otj.<domain>:' || club key shape as 0031, 0032, 0036 and 0049.
--
--   2. SHARE ROW EXCLUSIVE ON public.teams. The advisory lock alone does
--      not stop a team being ADDED or REMOVED by an ordinary teams_manage
--      write, which takes no advisory lock. Without this, the complete set
--      validated in step 4 could stop being complete before step 7 writes:
--      a team inserted in between would be left unplaced by an order that
--      claimed to place everybody, and a team deleted in between would
--      make one of the placements a silent no-op. SHARE ROW EXCLUSIVE
--      conflicts with ROW EXCLUSIVE, so no concurrent INSERT, UPDATE or
--      DELETE on teams can interleave; it does not conflict with ACCESS
--      SHARE or ROW SHARE, so ordinary reads are unaffected. teams is a
--      five row per club configuration table and this is an admin screen's
--      explicit Save, so the cost is a lock held for the length of one
--      small transaction and the gain is that "complete" means complete.
--
--      IT IS TABLE WIDE, not club wide, because PostgreSQL has no narrower
--      lock that blocks inserts, and an insert has no row to lock. So a
--      team being added to club B does briefly wait behind club A's order
--      save. That is stated rather than hidden: it is the correctness
--      trade the header claims, on a table whose whole content is a
--      handful of rows per club.
--
--   DEADLOCK FREEDOM. Every call takes the advisory key first and the
--   table lock second, and takes at most one of each, so a cycle would
--   need a transaction holding the table lock to wait on an advisory key,
--   which no caller of this function can do (it takes the key before the
--   table). Ordinary team writes take neither, so they cannot close a
--   cycle either: they wait for the table lock and hold nothing this
--   function wants.
--
-- THE EXPECTED SNAPSHOT, and why it is per team rather than a version
-- number. p_expected_sort_orders is aligned with p_team_ids and carries,
-- for each team, the sort_order the admin's draft was drawn from. null is
-- a real expected value and means "this team was unplaced when I looked",
-- which is the ordinary state of a club that has never configured an
-- order. Under the locks the function compares every current value with
-- the expected one and refuses BEFORE writing if any differ. So:
--
--   * the disjoint merge above cannot happen: admin two's expected values
--     for C and D still say 3 and 4, but by the time they hold the lock
--     the stored values are what admin one committed, and A and B differ.
--     Refused, with nothing written.
--   * a team added or removed since the draft is caught by the complete
--     set check before the comparison is even reached.
--   * there is no version column to add, no backfill, and nothing for a
--     future writer to remember to bump. The evidence is the data itself.
--
-- THE REFUSAL SQLSTATE IS 40001, chosen so a client can recognise a
-- concurrency refusal without parsing English. PostgREST returns the
-- SQLSTATE as the error body's `code`, which is how src/lib/queries.ts
-- already tells 23505 and 42501 apart. 40001 is PostgreSQL's own
-- serialization_failure, which is exactly what this is: a transaction
-- refused because concurrent work invalidated the snapshot it was built
-- on. A client stack that auto retries a 40001 is safe here rather than
-- dangerous: the retry carries the SAME stale expected snapshot, so it is
-- refused again, idempotently, and never writes. It could only succeed if
-- the stored order had meanwhile returned to what the admin saw, in which
-- case writing their intent is correct.
--
-- Every other refusal is a caller error rather than a race and keeps the
-- codes this repo already uses: 42501 for not signed in and for the
-- missing capability (as 0049), P0001 for a malformed request (mismatched
-- lengths, a null or duplicate id, an incomplete set, a foreign team).
--
-- AUDIT. Deliberately no new writer, no new action and no new vocabulary.
-- audit_teams() (0037, replaced by 0044, allow list extended by 0051) is
-- the record and already fires on every UPDATE of teams, emitting
-- team.updated with changed_fields naming sort_order and never a value.
--
-- IT FIRES TWICE FOR A MOVED, ALREADY PLACED TEAM, and that is stated
-- honestly rather than engineered away. The clear-then-place below writes
-- such a row twice inside this one transaction (to null, then to its new
-- position), so the trigger sees two distinct changes and records two
-- team.updated events. A team that was unplaced records one. A team
-- already at its final position is not written at all and records none.
-- Collapsing that would mean suppressing the trigger, deferring it, or
-- writing through a mechanism it does not see, and every one of those is a
-- larger and more dangerous change to the audit boundary than the cost it
-- would save. Atomic data correctness is the purpose of this slice; the
-- audit trail stays exactly as loud and exactly as truthful as it is.
--
-- CHILD DATA. None is reachable. The function reads and writes public.teams
-- and nothing else: no player, no registration, no register entry, no
-- session, no Spond row of any kind is read, written or referenced.
--
-- FOUNDATION SQL CONVENTIONS (the 0028..0051 form): SECURITY DEFINER with
-- set search_path = '' and fully schema qualified references; EXECUTE
-- granted to authenticated and revoked from public and anon; the migration
-- self verifies before it commits.
-- =====================================================================

-- ONE transaction, as 0041 through 0051 are, so a failed assertion at the
-- end rolls the function creation back rather than leaving it live.
begin;

-- ---------------------------------------------------------------------
-- The BEFORE fingerprint, taken here rather than inside the verification
-- block, because a fingerprint read after the change and compared with
-- itself asserts nothing. The whole "this migration changes no data, no
-- policy, no grant and no trigger" claim is a comparison across the DDL,
-- so one side of it has to be read before the DDL runs.
--
-- ON COMMIT DROP, so it exists for this transaction only and a rollback or
-- a commit both leave nothing behind.
-- ---------------------------------------------------------------------
create temporary table _0052_before on commit drop as
select
  (select count(*) from public.teams)                                         as teams,
  (select count(*) from public.teams where sort_order is not null)            as teams_placed,
  -- Every team's ordering state, whole, so "ordered nobody" is a comparison
  -- of the actual values rather than of two counts that could both hold
  -- while the positions moved among the rows.
  (select coalesce(string_agg(id::text || '=' || coalesce(sort_order::text, 'null'),
                              ',' order by id), '')
     from public.teams)                                                       as team_order,
  (select count(*) from public.audit_events)                                  as audit_rows,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'teams')                     as policies,
  (select coalesce(string_agg(grantee || ':' || privilege_type, ','
                              order by grantee, privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'teams'
      and grantee in ('anon', 'authenticated', 'service_role'))               as grants,
  (select coalesce(string_agg(tgname, ',' order by tgname), '')
     from pg_trigger
    where tgrelid = 'public.teams'::regclass and not tgisinternal)            as triggers,
  -- The index this function is built around. Its definition, not its name,
  -- so a redefinition would show as a change.
  (select coalesce(pg_get_indexdef(c.oid), '')
     from pg_class c join pg_index x on x.indexrelid = c.oid
    where x.indrelid = 'public.teams'::regclass
      and c.relname = 'teams_sort_order_unique')                              as sort_order_index;

-- ---------------------------------------------------------------------
-- set_team_order
--
-- Signature:
--   set_team_order(
--     p_team_ids             uuid[],    -- the COMPLETE desired club order;
--                                       -- first id becomes position 1
--     p_expected_sort_orders integer[]  -- aligned with p_team_ids; each is
--                                       -- the sort_order that team held when
--                                       -- the admin's draft was drawn. null
--                                       -- is a valid expected value
--   ) returns jsonb
--
-- Returns, on success:
--   {"teams": [{"id": ..., "sort_order": 1}, ...], "changed": <int>}
-- in position order. `changed` is how many rows were actually written,
-- which is also how many teams the audit trail will show moving.
--
-- Raises (nothing is written, the whole call is rolled back):
--   42501  not signed in to a club; or no teams.manage capability
--   40001  the club's stored order no longer matches the expected snapshot
--          (another admin saved in between). THE ONLY concurrency code
--   P0001  the request is malformed: the two arrays differ in length, an id
--          is null, an id repeats, the set is not exactly the club's
--          current teams, or an id is not a team of this club
-- ---------------------------------------------------------------------
create or replace function public.set_team_order(
  p_team_ids             uuid[],
  p_expected_sort_orders integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club     uuid := public.my_club();
  v_len      integer;
  v_actual   integer;
  v_changed  integer := 0;
  v_result   jsonb;
begin
  -- ============ Identity and capability, before anything is read =========
  -- Re checked in the body because SECURITY DEFINER is not bound by RLS,
  -- so these checks ARE the enforcement rather than a second opinion on it.
  if v_club is null then
    raise exception 'set_team_order: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('teams.manage') then
    raise exception 'set_team_order: requires the teams.manage capability'
      using errcode = '42501';
  end if;

  -- ============ Shape of the request, before any lock is taken ===========
  -- Cheap, caller local checks first: a malformed call should not queue
  -- behind another club's save to be told it was malformed.
  if p_team_ids is null or p_expected_sort_orders is null then
    raise exception 'set_team_order: both arrays are required'
      using errcode = 'P0001';
  end if;
  v_len := coalesce(array_length(p_team_ids, 1), 0);
  if v_len <> coalesce(array_length(p_expected_sort_orders, 1), 0) then
    raise exception 'set_team_order: the expected positions must be aligned with the team ids'
      using errcode = 'P0001';
  end if;
  -- A null id cannot be compared, matched or written, so it is refused
  -- rather than silently skipped by an equality that is never true.
  if exists (select 1 from unnest(p_team_ids) as t(id) where t.id is null) then
    raise exception 'set_team_order: a team id is null'
      using errcode = 'P0001';
  end if;
  -- Duplicates would make "the complete set" true by count while one team
  -- got two positions and another none.
  if (select count(distinct t.id) from unnest(p_team_ids) as t(id)) <> v_len then
    raise exception 'set_team_order: a team id appears more than once'
      using errcode = 'P0001';
  end if;

  -- ============ Serialise whole order saves for this club ================
  -- Taken before any team row is read, so the whole decision (read the
  -- club's teams, compare them with the expected snapshot, write the new
  -- order) is one critical section per club. It releases at commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('otj.set_team_order:' || v_club::text)
  );

  -- ============ And freeze the club's team MEMBERSHIP ====================
  -- The advisory lock orders callers of this function against each other.
  -- It does nothing about an ordinary Add team or Remove team, which takes
  -- no advisory lock, so without this the set validated below could stop
  -- being complete before the writes below land. SHARE ROW EXCLUSIVE
  -- conflicts with the ROW EXCLUSIVE that INSERT, UPDATE and DELETE take,
  -- and with itself; it does not conflict with the ACCESS SHARE that reads
  -- take. Always second, never first: see the header's deadlock argument.
  lock table public.teams in share row exclusive mode;

  -- ============ The club's teams, as they are under the lock =============
  -- Read directly, club scoped in every statement, rather than into a
  -- temporary table. A temporary table here was wrong twice over: `on
  -- commit drop` outlives a single CALL, so a caller invoking this function
  -- twice in one transaction failed on the second with "relation already
  -- exists" (the CI harness caught it), and a per call temporary
  -- relation is catalogue churn for a read of a handful of rows. The locks
  -- above are what make these reads stable, not where they are stored.
  --
  -- The request must name the club's CURRENT team set exactly: no missing
  -- id, no extra id, no foreign id. The count plus "every named id is a
  -- team of this club" plus the distinctness check above prove set
  -- equality between them, and none of the three names an id back.
  select count(*) into v_actual from public.teams t where t.club_id = v_club;
  if v_actual <> v_len then
    raise exception 'set_team_order: the order must name every team of the club exactly once (% given, % in the club)',
      v_len, v_actual using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_team_ids) as t(id)
     where not exists (
       select 1 from public.teams n where n.id = t.id and n.club_id = v_club
     )
  ) then
    raise exception 'set_team_order: the order names a team that is not in your club'
      using errcode = 'P0001';
  end if;

  -- ============ The expected snapshot, compared before any write =========
  -- This is the check the whole migration exists for. Every team's stored
  -- position must still be what the admin's draft was drawn from. One
  -- difference anywhere refuses the WHOLE order: a save is a statement
  -- about the club's arrangement, not about the rows that happen to move.
  if exists (
    select 1
      from unnest(p_team_ids, p_expected_sort_orders) as want(id, expected)
      join public.teams n on n.id = want.id and n.club_id = v_club
     where n.sort_order is distinct from want.expected
  ) then
    raise exception 'set_team_order: another admin saved a different order, so this one was not applied'
      using errcode = '40001';
  end if;

  -- ============ Write, in two phases, in this one transaction ============
  -- teams_sort_order_unique is checked per row, so "1 becomes 2 while 2
  -- becomes 1" collides on the first statement. Clearing the rows that
  -- move frees their positions first. Both phases are inside this function
  -- call, so they are inside one transaction: there is no state between
  -- them that any other transaction can observe or that a failure can
  -- leave behind.
  --
  -- Only rows whose position actually changes are touched. A team already
  -- at its final position is not written, so it produces no audit event and
  -- no needless row version. That is safe against the index because the
  -- target positions are 1..N over the complete set: an untouched row keeps
  -- position p and is the only member of the set whose target is p, so no
  -- row being placed can want it.
  with target as (
    select t.id, ordinality::integer as pos
      from unnest(p_team_ids) with ordinality as t(id, ordinality)
  )
  update public.teams s
     set sort_order = null
    from target
   where s.id = target.id
     and s.club_id = v_club
     and s.sort_order is distinct from target.pos
     and s.sort_order is not null;

  with target as (
    select t.id, ordinality::integer as pos
      from unnest(p_team_ids) with ordinality as t(id, ordinality)
  ), placed as (
    update public.teams s
       set sort_order = target.pos
      from target
     where s.id = target.id
       and s.club_id = v_club
       and s.sort_order is distinct from target.pos
    returning s.id
  )
  select count(*) into v_changed from placed;

  -- ============ What is stored now, read back inside the same call =======
  -- Not a courtesy: it is read from the table after the writes, so a caller
  -- is told what the database holds rather than what was asked for.
  select jsonb_build_object(
           'teams', coalesce(jsonb_agg(
                      jsonb_build_object('id', o.id, 'sort_order', o.sort_order)
                      order by o.sort_order
                    ), '[]'::jsonb),
           'changed', v_changed
         )
    into v_result
    from public.teams o
   where o.club_id = v_club;

  return v_result;
end
$$;

comment on function public.set_team_order(uuid[], integer[]) is
  $$Writes the club's COMPLETE team order atomically (0052_atomic_team_order.sql). SECURITY DEFINER, self gates on teams.manage, derives the club from my_club() server side and refuses any id that is not a team of that club. p_team_ids is the whole desired order, first id to position 1; p_expected_sort_orders is aligned with it and carries the sort_order each team held when the admin's draft was drawn, with null a valid expected value. THE POINT IS ATOMICITY AND SERIALIZATION: a club scoped advisory transaction lock orders whole order saves against each other, SHARE ROW EXCLUSIVE on teams stops a team being added or removed underneath the complete set validation, and every stored position is compared with the expected snapshot BEFORE any write, so two admins moving disjoint rows can no longer both succeed and leave a merged order neither submitted. A stale snapshot raises 40001 and writes nothing; a malformed or incomplete request raises P0001; no club or no capability raises 42501. The whole order commits or nothing does, so no partial order is reachable through this path. Writes only sort_order, on rows whose position actually changes, and creates and deletes no team. teams_sort_order_unique (0051) is untouched and remains the last guard; the clear-then-place exists because it is checked per row. Audited by the existing audit_teams() trigger only: a moved, already placed team records two team.updated events (the clear and the placement), an unplaced one records one, an unmoved one records none, and none carries a value.$$;

revoke execute on function public.set_team_order(uuid[], integer[]) from public, anon;
grant execute on function public.set_team_order(uuid[], integer[]) to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Same transaction as everything above, so any failure
-- rolls the whole release back and leaves the database exactly as it was.
--
-- It proves what this migration ADDS by reading the created function's
-- shape, privileges and STORED SOURCE back, so the boundaries hold against
-- what will actually run rather than against what this file says. It
-- proves what it did NOT change by comparing against the fingerprint taken
-- before the DDL, rather than by asserting a posture it cannot know.
--
-- It does NOT call the function. Section 4 is the reasoning, and it is not
-- an omission: a migration apply has no caller identity, and this function
-- is gated on one.
-- ---------------------------------------------------------------------
do $$
declare
  b        _0052_before;
  n        integer;
  v_src    text;
begin
  select * into b from _0052_before;
  if not found then
    raise exception 'atomic_team_order: the before fingerprint is missing, so nothing can be compared';
  end if;

  -- ---- 1. The function exists, exactly once, in the reviewed shape -----
  if to_regprocedure('public.set_team_order(uuid[], integer[])') is null then
    raise exception 'atomic_team_order: the function was not created';
  end if;
  -- NOT EXISTS rather than `if not (select ...)`, and a mutation of this file
  -- is what taught the difference. proconfig is NULL for a function with no
  -- SET clause, so `null @> array[...]` is null, `not null` is null, and
  -- `if null then` does nothing: the check written that way passed happily
  -- with the empty search_path REMOVED, which is the one thing it exists to
  -- catch. An existence test is total: no row means the property does not
  -- hold, whatever made it not hold.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.set_team_order(uuid[], integer[])')
       and p.prosecdef
  ) then
    raise exception 'atomic_team_order: the function must be SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.set_team_order(uuid[], integer[])')
       and p.proconfig @> array['search_path=' || chr(34) || chr(34)]
  ) then
    raise exception 'atomic_team_order: the function must set search_path to empty';
  end if;
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'set_team_order';
  if n <> 1 then
    raise exception 'atomic_team_order: more than one overload of the function exists (%)', n;
  end if;

  -- ---- 2. Its privileges: authenticated yes, anon no -------------------
  -- anon is tested rather than inferred from PUBLIC, because a grant to
  -- PUBLIC would reach anon without ever naming it.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.set_team_order(uuid[], integer[])')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'atomic_team_order: authenticated cannot execute the function';
  end if;
  if exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.set_team_order(uuid[], integer[])')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'atomic_team_order: anon must not execute the function';
  end if;

  -- ---- 3. The stored source, read back, carries its boundaries ---------
  -- Against what will actually run, not against this file, so a later edit
  -- that keeps the comments and drops a rule fails the apply.
  --
  -- \y is PostgreSQL's own word boundary in ARE syntax. \b is the BACKSPACE
  -- CHARACTER here and matches nothing, which is the defect 0049's review
  -- found in its own source checks; the harness proves each pattern bites.
  v_src := pg_get_functiondef(to_regprocedure('public.set_team_order(uuid[], integer[])'));

  if v_src !~ 'has_perm\(''teams\.manage''\)' then
    raise exception 'atomic_team_order: the teams.manage gate is missing from the function';
  end if;
  if v_src !~ 'public\.my_club\(\)' then
    raise exception 'atomic_team_order: the club must be derived server side';
  end if;
  if v_src ~ '\yp_club\y' or v_src ~ '\yp_club_id\y' then
    raise exception 'atomic_team_order: the caller must not be able to name a club';
  end if;
  -- Both locks, in this order. The advisory key serialises this function
  -- against itself; the table lock stops membership moving underneath the
  -- complete set check. Either alone leaves a hole the header names.
  if v_src !~ 'pg_advisory_xact_lock' then
    raise exception 'atomic_team_order: the club advisory lock is missing from the function';
  end if;
  if v_src !~ 'otj\.set_team_order:' then
    raise exception 'atomic_team_order: the advisory lock key must be club scoped and named';
  end if;
  if v_src !~ 'lock table public\.teams in share row exclusive mode' then
    raise exception 'atomic_team_order: the teams membership lock is missing from the function';
  end if;
  if position('pg_advisory_xact_lock' in v_src) > position('lock table public.teams' in v_src) then
    raise exception 'atomic_team_order: the advisory key must be taken before the table lock';
  end if;
  -- The expected snapshot comparison, and that it refuses with the code a
  -- client can recognise.
  if v_src !~ 'is distinct from want\.expected' then
    raise exception 'atomic_team_order: the expected snapshot comparison is missing from the function';
  end if;
  if v_src !~ '40001' then
    raise exception 'atomic_team_order: the stale snapshot refusal must use SQLSTATE 40001';
  end if;
  if position('want.expected' in v_src) > position('set sort_order = null' in v_src) then
    raise exception 'atomic_team_order: the snapshot must be compared BEFORE anything is written';
  end if;
  -- It writes one column, on one table, and adds and removes no team.
  if v_src ~ 'insert into public\.teams' or v_src ~ 'delete from public\.teams' then
    raise exception 'atomic_team_order: the function must create and delete no team';
  end if;
  if v_src ~ 'set\s+name\s*=' or v_src ~ 'set\s+bib_colour\s*=' or v_src ~ 'set\s+club_id\s*=' then
    raise exception 'atomic_team_order: the function must write no column but sort_order';
  end if;
  if v_src ~ '\yplayers\y' or v_src ~ '\yregister_entries\y' or v_src ~ '\ysessions\y'
     or v_src ~ '\yspond_' then
    raise exception 'atomic_team_order: the function must reach no player, register, session or Spond row';
  end if;
  -- Every write is club scoped in the statement itself, so a row of another
  -- club cannot be reached even if an id somehow got past the checks.
  if (length(v_src) - length(replace(v_src, 'club_id = v_club', ''))) / length('club_id = v_club') < 3 then
    raise exception 'atomic_team_order: every read and write of teams must be club scoped';
  end if;

  -- ---- 4. THERE IS NO IN MIGRATION BEHAVIOURAL PROBE, AND WHY ---------
  -- This is the one place 0051's pattern does not carry over, and the
  -- difference is not stylistic. 0051 added an INDEX, which any caller
  -- exercises: its probe inserted synthetic rows and watched the unique
  -- constraint bite. set_team_order is gated on an IDENTITY. It calls
  -- public.my_club() and public.has_perm(), both of which resolve through
  -- auth.uid(), and a migration apply has no JWT: the file runs as the
  -- database owner over a direct connection, so auth.uid() is null,
  -- my_club() is null, and the function correctly refuses its own probe
  -- with 42501. An earlier draft of this file did carry that probe and
  -- aborted the apply exactly there, which is the gate working.
  --
  -- Giving the probe an identity would mean writing a synthetic row into
  -- auth.users, letting the 0029 signup trigger fire on it, and forging
  -- request.jwt.claims. That is a bigger claim on the auth boundary than
  -- anything this migration is for, and it would be made by the very file
  -- whose whole point is that it touches nothing else. 0049 is the
  -- precedent and reached the same conclusion for the same reason: its
  -- SECURITY DEFINER function is verified here by fingerprints and by
  -- reading the stored source back, and never by calling it.
  --
  -- So the behavioural proof lives where a caller can have an identity,
  -- and it is stronger there than it could ever be here:
  --
  --   * .github/scripts/production-migration/test_0052_atomic_team_order.sh
  --     applies THIS file to a real PostgreSQL and drives the function as
  --     four different callers, including the disjoint merge run with TWO
  --     REAL CONNECTIONS, both ways round, asserting that the loser
  --     actually blocked on the lock before being refused. One
  --     transaction cannot contend with itself, so that proof was never
  --     available in this file at all.
  --   * tests/security/set-team-order.test.ts drives it through PostgREST
  --     with real JWTs against the REAL schema, policies, capabilities
  --     and grants, which the harness stand-in cannot reproduce.
  --
  -- What remains here is what a migration CAN prove about itself: the
  -- function exists in the reviewed shape with the reviewed privileges
  -- (sections 1 and 2), its stored source carries every boundary this
  -- header claims (section 3), and nothing else in the database moved
  -- (sections 6 to 10, against a fingerprint taken before the DDL).

  -- ---- 6. What this migration did NOT change ---------------------------
  -- Compared against the fingerprint taken BEFORE the function was created,
  -- so each of these is a real comparison across the DDL rather than a value
  -- compared with itself.
  if (select count(*) from public.teams) <> b.teams
     or (select count(*) from public.teams where sort_order is not null) <> b.teams_placed then
    raise exception 'atomic_team_order: the migration must add, remove and place no team';
  end if;
  if (select coalesce(string_agg(id::text || '=' || coalesce(sort_order::text, 'null'),
                                 ',' order by id), '')
        from public.teams) is distinct from b.team_order then
    raise exception 'atomic_team_order: the migration must order nobody';
  end if;
  if (select count(*) from public.audit_events) <> b.audit_rows then
    raise exception 'atomic_team_order: the migration must write no audit event';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'teams') <> b.policies then
    raise exception 'atomic_team_order: the migration must change no policy on teams';
  end if;
  if (select coalesce(string_agg(grantee || ':' || privilege_type, ','
                                 order by grantee, privilege_type), '')
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'teams'
         and grantee in ('anon', 'authenticated', 'service_role')) is distinct from b.grants then
    raise exception 'atomic_team_order: the migration must change no grant on teams';
  end if;
  if (select coalesce(string_agg(tgname, ',' order by tgname), '')
        from pg_trigger
       where tgrelid = 'public.teams'::regclass and not tgisinternal) is distinct from b.triggers then
    raise exception 'atomic_team_order: the migration must change no trigger on teams';
  end if;
  if b.triggers = '' then
    raise exception 'atomic_team_order: the trigger fingerprint is empty, so it asserts nothing';
  end if;

  -- ---- 7. The index this function is built around is exactly as 0051 ----
  -- left it. Weakening it would make the clear-then-place unnecessary and
  -- the whole ordering guarantee softer, so it is checked rather than
  -- assumed.
  if (select coalesce(pg_get_indexdef(c.oid), '')
        from pg_class c join pg_index x on x.indexrelid = c.oid
       where x.indrelid = 'public.teams'::regclass
         and c.relname = 'teams_sort_order_unique') is distinct from b.sort_order_index then
    raise exception 'atomic_team_order: teams_sort_order_unique must be untouched';
  end if;
  if b.sort_order_index = '' then
    raise exception 'atomic_team_order: teams_sort_order_unique is missing, so 0051 has not been applied';
  end if;
  if not exists (
    select 1 from pg_index x join pg_class c on c.oid = x.indexrelid
     where x.indrelid = 'public.teams'::regclass
       and c.relname = 'teams_sort_order_unique'
       and x.indisunique and not x.indisprimary and x.indpred is not null
  ) then
    raise exception 'atomic_team_order: teams_sort_order_unique must still be unique and partial';
  end if;

  -- ---- 8. The two teams policies still say what they said ---------------
  -- The read stays club wide and the write still takes teams.manage, so
  -- this function narrows nothing and widens nothing about direct writes.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'teams' and policyname = 'teams_manage'
       and qual like '%has_perm%teams.manage%'
  ) then
    raise exception 'atomic_team_order: teams_manage must still require the teams.manage capability';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'teams' and policyname = 'teams_select_club'
  ) then
    raise exception 'atomic_team_order: teams_select_club must still exist';
  end if;

  -- ---- 9. audit_teams() still names sort_order on its allow list --------
  -- 0051 put it there and this migration depends on it: the audit claim in
  -- the header is only true while the trigger records an ordering change.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.audit_teams()')
       and position('new.sort_order is distinct from old.sort_order'
                    in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'atomic_team_order: audit_teams() must still record an ordering change';
  end if;

  -- ---- 10. The audit vocabulary gained nothing --------------------------
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_events'::regclass
       and conname = 'audit_events_source_check'
       and pg_get_constraintdef(oid) not like '%team_order%'
  ) then
    raise exception 'atomic_team_order: the audit source vocabulary must not gain a value';
  end if;
end
$$;

commit;
