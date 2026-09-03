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
-- nicety. It is FOUR things, and only the two locks were in the first
-- draft. The two preconditions either side of them were found in review,
-- each after the locks had been written, tested and believed sufficient,
-- and each is a fact about HOW the call was made rather than about what it
-- asked for. Taking them in the order they are checked:
--
--   0a. THE CALLER'S TRANSACTION MUST BE ABLE TO SEE THE RACE IT LOST.
--      The locks below decide what a caller WAITS FOR. They cannot decide
--      WHEN IT LOOKED. A REPEATABLE READ or SERIALIZABLE transaction fixes
--      its snapshot at its first statement, before it ever reaches a lock
--      here, so it can wait its whole turn and then still read the world as
--      it was before the winner committed: its expected snapshot matches
--      values nobody holds any more, and it writes the rows the winner did
--      not touch. PostgreSQL finds no write conflict on those rows, because
--      nobody else wrote them, and the merge commits. That was reproduced,
--      not theorised: with this check removed a REPEATABLE READ caller is
--      ACCEPTED and stores exactly the merge. So anything but READ
--      COMMITTED is refused outright, before any lock, rather than served
--      on a snapshot that cannot move. READ UNCOMMITTED is accepted, since
--      PostgreSQL runs it AS read committed, and the harness asserts that
--      rather than trusting it, because the first version of this check
--      assumed PostgreSQL rewrote the level at SET time (it does not) and
--      turned away a caller it should have served.
--
--   0b. THE CALLER MUST NOT ALREADY HOLD A WRITE LOCK ON teams. A
--      transaction that writes teams and THEN calls this enters holding
--      ROW EXCLUSIVE, which blocks another caller at the table lock while
--      this one waits for that caller's advisory key: a cycle, broken by
--      PostgreSQL with 40P01. Nothing corrupts, but an admin gets an error
--      they can do nothing about, and no ordering of the two locks below
--      fixes it, because the conflicting lock is held before this function
--      is entered. So that call order is refused, and deadlock freedom is
--      a property of the refusal rather than of the lock order alone.
--
--      EVERY mode but ACCESS SHARE is refused, and the first version of
--      this exempted ROW SHARE as well, on the reasoning that it conflicts
--      with nothing here. True of the RELATION lock and false of the ROW
--      locks that come with it: SELECT ... FOR UPDATE lets a concurrent
--      caller take the advisory key and the table lock, then blocks it on
--      a row this function must write, while the holder waits for that
--      advisory key. The same cycle. Refused as a class, which also
--      refuses the RowShareLock an ordinary foreign key check takes, whose
--      KEY SHARE row locks could not have blocked a non key update: a
--      durable row lock lives in the tuple's xmax and not in pg_locks, so
--      the two are not distinguishable from here. Over refusing costs one
--      clear message; under refusing costs a deadlock nobody can act on. A
--      plain SELECT holds ACCESS SHARE and no row lock, and is served.
--
-- Then two locks, always in this order, both taken before any team row
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
--   DEADLOCK FREEDOM, and the first version of this paragraph was wrong.
--   Every call takes the advisory key first and the table lock second, and
--   takes at most one of each, so no two callers of this function can form
--   a cycle. What that argument then said was that ordinary team writes
--   take neither lock and so cannot close one either. True of a
--   transaction that ONLY writes teams. False of one that writes teams and
--   THEN calls this: it enters already holding ROW EXCLUSIVE, which blocks
--   another caller at the table lock, while it waits for that caller's
--   advisory key. PostgreSQL breaks the cycle with 40P01 rather than
--   hanging, so nothing corrupts, but an admin gets an error they can do
--   nothing about.
--
--   Reordering the two locks does not fix it, because the conflicting lock
--   is already held before the function is entered. So that call order is
--   REFUSED, by a check above these locks, and deadlock freedom is a
--   property of the refusal rather than of the lock order alone. A caller
--   that only SELECTed from teams holds ACCESS SHARE or ROW SHARE, neither
--   of which conflicts with SHARE ROW EXCLUSIVE, and is not refused.
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
-- THE STALE REFUSAL IS P0001 CARRYING THE DETAIL TOKEN 'stale_order', AND
-- IT USED TO BE 40001. That is worth the paragraph, because 40001 looked
-- obviously right and was obviously wrong.
--
-- The reasoning for it was: PostgREST returns the SQLSTATE as the error
-- body's `code`, which is how src/lib/queries.ts already tells 23505 and
-- 42501 apart, and 40001 is PostgreSQL's own serialization_failure, which
-- is what a refusal on a stale snapshot IS. The security suite then showed,
-- twice and deterministically, that a 40001 raised by this function NEVER
-- REACHES a PostgREST client: the request hung until the caller gave up,
-- while every other refusal from the same function over the same client
-- returned in tens of milliseconds. The mechanism inside PostgREST was not
-- isolated further; the behaviour was reproduced, which is what matters
-- here. A refusal the product's own client cannot receive is not a
-- contract, whatever it is named.
--
-- And the name was wrong on its own terms, which is the part worth keeping
-- even if that behaviour ever changes. NOTHING IN THE DATABASE FAILED TO
-- SERIALIZE. The transaction did exactly what it was told; the application
-- logic compared the caller's snapshot with what is stored and found it
-- stale. Calling that serialization_failure tells every layer above that a
-- retry may succeed, and a retry here can NEVER succeed: it carries the
-- same stale expected snapshot, so it is refused identically, for ever.
-- The one code in this file that means "cannot be served as made" is
-- P0001, and this is that.
--
-- The client still needs to tell it from a malformed request without
-- parsing English, so the raise carries DETAIL 'stale_order', which
-- PostgREST returns as the error body's `details`. A stable machine token
-- rather than a message, which is the same shape as 0049's 'stale_link'
-- and 'member_linked_elsewhere' outcome strings.
--
-- Every other refusal is a caller error rather than a race and keeps the
-- codes this repo already uses: 42501 for not signed in and for the
-- missing capability (as 0049), P0001 for a malformed request (mismatched
-- lengths, a null or duplicate id, an incomplete set, a foreign team, and
-- an isolation level this function cannot serialise). The isolation
-- refusal is deliberately NOT 40001: it is not a race that was lost, and a
-- client that read it as one would retry for ever, since the retry is
-- refused identically.
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
-- in position order. `changed` is how many TEAMS ENDED SOMEWHERE ELSE,
-- which is not the same as how many row writes happened: a moved, already
-- placed team is written twice by the clear-then-place below and counted
-- once here, and it is that team's TWO audit events the trail will show. A
-- team already at its final position is neither written nor counted.
--
-- Raises (nothing is written, the whole call is rolled back):
--   42501  not signed in to a club; or no teams.manage capability
--   P0001 with DETAIL 'stale_order'
--          the club's stored order no longer matches the expected snapshot
--          (another admin saved in between). Read `details`, not the
--          message. Never retried automatically: the same snapshot is
--          refused identically for ever
--   P0001  the request cannot be served as made: the calling transaction is
--          not READ COMMITTED (a fixed snapshot cannot see the race it
--          lost, so it would commit the merge); or the request is
--          malformed, meaning the calling transaction already holds a
--          write lock on teams (that call order can deadlock and cannot be
--          served), an array has more than one dimension, the
--          two arrays differ in length, an id is null, an id repeats, the
--          set is not exactly the club's current teams, or an id is not a
--          team of this club. Never retry a P0001 unchanged: it will be
--          refused identically.
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

  -- ============ The caller's snapshot must be able to move ===============
  -- THE LOCKS BELOW ARE NOT ENOUGH ON THEIR OWN, and this is the subtlest
  -- thing in the file. They decide what a caller WAITS FOR; they cannot
  -- decide WHEN it looked. A REPEATABLE READ or SERIALIZABLE transaction
  -- fixes its snapshot at its first statement, which is before it ever
  -- reaches these locks, so after waiting its whole transaction it still
  -- reads the pre race world: the expected snapshot matches values nobody
  -- holds any more, and it writes the rows the winner did not touch.
  -- PostgreSQL finds no write conflict on those rows, because nobody else
  -- wrote them, and the merge this function exists to prevent commits.
  --
  -- Reproduced, not reasoned about: with the guard removed, a REPEATABLE
  -- READ caller whose snapshot predates the winner's commit is ACCEPTED and
  -- stores exactly the merge. The harness runs that race both ways and M16
  -- pins this guard to it.
  --
  -- READ COMMITTED is what makes the design work, because there every
  -- statement takes a new snapshot: the reads after the locks see whatever
  -- committed while this caller was waiting, so a stale expected snapshot
  -- is visible as stale and refused. There is no way to take a fresh
  -- snapshot inside a fixed snapshot transaction, so this is refused rather
  -- than worked around, and refused OUTRIGHT rather than only when it would
  -- have lost a race, because a rule that fires only under contention is a
  -- rule nobody can test and nobody can trust.
  --
  -- READ UNCOMMITTED IS ACCEPTED, and it is named rather than assumed. The
  -- first version of this guard tested equality with 'read committed' on
  -- the belief that PostgreSQL normalises READ UNCOMMITTED when it is SET.
  -- It does not: it BEHAVES as read committed, which is all this function
  -- needs, while transaction_isolation still reports 'read uncommitted'.
  -- The harness asserted the belief instead of trusting it and refused the
  -- caller, which is how the second arm got here. A guard that turned away
  -- a caller PostgreSQL treats as correct would be its own defect.
  --
  -- P0001, like every other refusal here that means "cannot be served as
  -- made". It carries no detail token, because a client has nothing to do
  -- with this but fix how it calls: unlike a stale snapshot, retrying it
  -- unchanged is not merely futile, it is a bug in the caller.
  if pg_catalog.current_setting('transaction_isolation')
       not in ('read committed', 'read uncommitted') then
    raise exception
      'set_team_order: requires a read committed transaction, but this one is %',
      pg_catalog.current_setting('transaction_isolation')
      using errcode = 'P0001';
  end if;

  -- ============ The caller must not already hold a lock on teams =========
  -- The second hole in the locking design, found in the same review as the
  -- first, and it is a hole in the DEADLOCK FREEDOM ARGUMENT rather than in
  -- the serialization. That argument said ordinary team writes take neither
  -- of these locks and so cannot close a cycle. True of a transaction that
  -- ONLY writes teams; false of one that writes teams and THEN calls this.
  --
  --   T1: update public.teams ...        -- holds ROW EXCLUSIVE to commit
  --   T2: set_team_order(...)            -- takes the advisory key, then
  --                                         waits for SHARE ROW EXCLUSIVE,
  --                                         which T1's ROW EXCLUSIVE blocks
  --   T1: set_team_order(...)            -- waits for T2's advisory key
  --
  -- A cycle. PostgreSQL detects it and aborts one of them with 40P01, so
  -- nothing corrupts, but an admin screen gets a deadlock error it can do
  -- nothing about and the header's claim was simply wrong as written.
  --
  -- Refused rather than accommodated, for the same reason as the isolation
  -- level: this function's contract is that it reads the club's teams as
  -- everybody else sees them and compares that with what the admin saw. A
  -- caller holding an uncommitted write to teams is asking it to reason
  -- about a world only that caller can see. There is no ordering of these
  -- two locks that fixes it either, because the conflicting lock is already
  -- held before this function is entered.
  --
  -- ONLY ACCESS SHARE is exempt, and the first version of this check also
  -- exempted ROW SHARE, which was wrong for a reason worth writing down:
  -- it reasoned about RELATION level conflicts and forgot ROW level ones.
  -- SELECT ... FOR UPDATE takes only RowShareLock on the relation, which
  -- conflicts with nothing here, so a concurrent caller is granted the
  -- advisory key and the table lock quite happily and then blocks on one of
  -- the ROWS this function's UPDATE has to write, while this caller enters
  -- and blocks on that advisory key. The same cycle, through a lock mode
  -- the guard had named as safe. It was reproduced: with ROW SHARE exempt,
  -- a caller holding FOR UPDATE is accepted.
  --
  -- ROW SHARE is therefore refused as a CLASS, and that is conservative
  -- rather than exact, which is stated rather than hidden. pg_locks cannot
  -- tell FOR UPDATE apart from the RowShareLock an ordinary foreign key
  -- check takes, because a durable row lock lives in the tuple's xmax and
  -- not in pg_locks. So a transaction that inserted a row referencing teams
  -- holds KEY SHARE row locks, which would NOT block this function's non
  -- key update of sort_order, and is refused anyway. Over refusing a caller
  -- who could have been served costs them one clear message; under refusing
  -- costs somebody a deadlock they cannot act on.
  --
  -- A plain SELECT takes ACCESS SHARE, holds no row lock at all, and is
  -- served. That is asserted in the harness beside the refusals, because a
  -- guard widened to every mode would refuse it and nothing else would say.
  if exists (
    select 1
      from pg_catalog.pg_locks l
     where l.locktype = 'relation'
       and l.relation = 'public.teams'::pg_catalog.regclass
       and l.pid = pg_catalog.pg_backend_pid()
       and l.granted
       and l.mode <> 'AccessShareLock'
  ) then
    raise exception
      'set_team_order: the calling transaction already holds a write lock on teams; call this before any other write to teams, not after one'
      using errcode = 'P0001';
  end if;

  -- ============ Shape of the request, before any lock is taken ===========
  -- Cheap, caller local checks first: a malformed call should not queue
  -- behind another club's save to be told it was malformed.
  if p_team_ids is null or p_expected_sort_orders is null then
    raise exception 'set_team_order: both arrays are required'
      using errcode = 'P0001';
  end if;
  -- ONE DIMENSION, checked before anything counts either array. A
  -- rectangular array of more than one dimension is a real hole rather than
  -- a theoretical one, and it was reached: array_length(x, 1) counts only
  -- the FIRST dimension while every unnest below flattens ALL of them. A 4x2
  -- array over a four team club reports a length of four, offers four
  -- distinct ids to the duplicate check, matches the club's team count, and
  -- pairs consistently against the expected snapshot, so every gate passes.
  -- The target CTE then receives EIGHT rows with ordinalities 1..8, one team
  -- appears twice with two different targets, and a position the contract
  -- says cannot exist is stored. Verified by running it: without this check
  -- the call is ACCEPTED.
  --
  -- Refused rather than flattened. Flattening would be a guess at what a
  -- caller who sent a shape this function never offered actually meant, and
  -- the whole design of this function is that it refuses what it cannot
  -- serve rather than doing something adjacent to it. array_ndims is null
  -- for an empty array, and null > 1 is null, so an empty order still falls
  -- through to the checks below rather than being caught here.
  if array_ndims(p_team_ids) > 1 or array_ndims(p_expected_sort_orders) > 1 then
    raise exception 'set_team_order: the order must be a one dimensional array'
      using errcode = 'P0001';
  end if;
  -- cardinality, not array_length(x, 1): it counts EVERY element whatever
  -- the shape, so if the dimension check above were ever lost this would
  -- disagree with the club's team count instead of silently agreeing with
  -- it. Two independent readings of "how many" rather than one.
  v_len := coalesce(cardinality(p_team_ids), 0);
  if v_len <> coalesce(cardinality(p_expected_sort_orders), 0) then
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
      using errcode = 'P0001', detail = 'stale_order';
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
  $$Writes the club's COMPLETE team order atomically (0052_atomic_team_order.sql). SECURITY DEFINER, self gates on teams.manage, derives the club from my_club() server side and refuses any id that is not a team of that club. p_team_ids is the whole desired order, first id to position 1; p_expected_sort_orders is aligned with it and carries the sort_order each team held when the admin's draft was drawn, with null a valid expected value. THE POINT IS ATOMICITY AND SERIALIZATION: a club scoped advisory transaction lock orders whole order saves against each other, SHARE ROW EXCLUSIVE on teams stops a team being added or removed underneath the complete set validation, and every stored position is compared with the expected snapshot BEFORE any write, so two admins moving disjoint rows can no longer both succeed and leave a merged order neither submitted. REQUIRES A READ COMMITTED TRANSACTION, AND MUST BE CALLED BEFORE ANY OTHER WRITE TO teams IN THAT TRANSACTION. A caller already holding ROW EXCLUSIVE on teams can close a deadlock cycle against another caller holding the advisory key and waiting for the table lock, which no ordering of these two locks can prevent, so it is refused. Read uncommitted is accepted, since PostgreSQL runs it as read committed. On the isolation level: a fixed snapshot transaction waits for the locks and then still reads the pre race world, so it would commit exactly the merge this exists to prevent, and it is refused with P0001 rather than served. A stale snapshot raises P0001 with DETAIL 'stale_order' and writes nothing, a stable machine token a client reads from `details`; it is deliberately NOT 40001, because nothing failed to serialize and a retry with the same snapshot can never succeed; a malformed or incomplete request raises P0001, which covers an array of more than one dimension (array_length counts one dimension while unnest flattens all of them, so a rectangular array would otherwise pass every count and store a position outside 1..N) as well as an isolation level this cannot serialise; no club or no capability raises 42501. The whole order commits or nothing does, so no partial order is reachable through this path. Writes only sort_order, on rows whose position actually changes, and creates and deletes no team. teams_sort_order_unique (0051) is untouched and remains the last guard; the clear-then-place exists because it is checked per row. Audited by the existing audit_teams() trigger only: a moved, already placed team records two team.updated events (the clear and the placement), an unplaced one records one, an unmoved one records none, and none carries a value.$$;

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

  if v_src !~ 'AccessShareLock' or v_src !~ 'pg_backend_pid' then
    raise exception 'atomic_team_order: the prior teams lock check is missing from the function';
  end if;
  if v_src !~ 'if array_ndims\(p_team_ids\) > 1' then
    raise exception 'atomic_team_order: the one dimension check is missing from the function';
  end if;
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
  --
  -- The isolation guard comes first, because it is the precondition BOTH
  -- locks rest on: they decide what a caller waits for and cannot decide
  -- when it looked, so a fixed snapshot caller waits its turn and then
  -- commits the merge anyway. Matched on the executable expression rather
  -- than on the words, because pg_get_functiondef returns the body's
  -- COMMENTS too and this function's comment says both 'transaction
  -- isolation' and 'read committed'; a check on those words would pass with
  -- the statement deleted and the prose left, which is the shape of vacuous
  -- assertion this file's review found elsewhere.
  if v_src !~ ('if pg_catalog\.current_setting\(''transaction_isolation''\)'
               || '[^;]*not in \(''read committed'', ''read uncommitted''\) then') then
    raise exception 'atomic_team_order: the read committed isolation guard is missing from the function';
  end if;
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
  -- The RAISE, not the words. An earlier version of this check read simply
  -- '40001', and the body's own comments say that number: pg_get_functiondef
  -- returns comments, so it passed with the errcode changed, and M5 caught
  -- it. Every positive source check in this section is only as strong as the
  -- narrowest thing the body could say by accident, so anchor on syntax
  -- wherever prose could collide.
  if v_src !~ 'using errcode = ''P0001'', detail = ''stale_order''' then
    raise exception 'atomic_team_order: the stale refusal must carry the stale_order detail token';
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
