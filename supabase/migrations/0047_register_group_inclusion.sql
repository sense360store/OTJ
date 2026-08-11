-- =====================================================================
-- OTJ Training Hub, migration 0047_register_group_inclusion: attendance
-- and group inclusion are two facts, and each gets its own column
--
-- REVIEW REQUIRED, and NOT APPLIED. Migrations are gated in this repo.
-- This file ships with the pull request and is applied afterwards through
-- .github/workflows/apply-production-migration.yml, once reviewed. Do not
-- auto-merge, do not run `supabase db push`, and do not dispatch the apply
-- workflow as part of reviewing this change.
--
-- NUMBERING. The live ledger ends at 20260811210248 / drill_diagram
-- (0046), checked against the hosted project on 2026-08-11, so this is
-- 0047. The file numbers on disk have gaps (0003, 0004 and 0010 are
-- absent); the ledger is the authority, not the highest file name.
--
-- ---------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------
--
-- register_entries.present was created by 0044 to mean what its name says:
-- this child was physically at this session. The Tonight release then
-- reused the same column to mean "included in tonight's working groups",
-- because the two happened to be ticked with the same control. They are
-- not the same fact and they disagree constantly:
--
--   * a child can attend and be left out of the working groups, because
--     the coach split fourteen of the eighteen who came;
--   * a child can be put in a group and not attend, because the coach
--     arranged the night in advance and one of them did not turn up;
--   * and the parent's Spond reply is a third thing again, which predicts
--     both and determines neither.
--
-- Once one column carries two meanings, every read of it is ambiguous and
-- there is no repair that does not guess. So the second meaning moves to
-- its own column and `present` goes back to meaning attendance.
--
-- ---------------------------------------------------------------------
-- WHAT IT DOES
-- ---------------------------------------------------------------------
--
--   1. Adds public.register_entries.included_in_groups, a NOT NULL boolean
--      defaulting to false.
--   2. Restates in the column comments which fact each of the two columns
--      now carries.
--
-- That is the whole change. One column, two comments.
--
-- ---------------------------------------------------------------------
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------
--
-- IT WRITES NO ROW. In particular it does NOT copy `present` into
-- `included_in_groups`. Both directions of copying are wrong:
--
--   copying present -> included_in_groups would claim a coach had selected
--   children they never selected, on every row that recorded genuine
--   attendance from before the Tonight release;
--
--   copying included_in_groups -> present, or clearing present, would
--   destroy attendance data, which is the one thing in this table that
--   cannot be reconstructed by asking anybody.
--
-- So every existing row keeps its stored `present` value, read from here
-- on as attendance, and starts with included_in_groups false, which claims
-- nothing. A false default cannot be wrong in the damaging direction: it
-- says "no coach has selected this child for a group", which is true of
-- every row until a coach opens Tonight and saves.
--
-- THE ONE AMBIGUOUS POPULATION, stated plainly rather than repaired
-- silently. Rows written while Tonight was reusing the column hold a
-- `present` value that meant inclusion when it was written and will be
-- read as attendance from now on. Nothing in the schema distinguishes them
-- from genuine attendance rows, and any rule that tried (marked_at before
-- some deploy timestamp, say) would be a guess dressed as a migration. On
-- the hosted project this population is small enough to name: at the time
-- of writing the whole table holds 9 rows across 2 sessions, of which
-- exactly 1 has present = true. Re-ticking one session's groups is a
-- smaller cost than any automated reinterpretation of a child's record.
--
-- IT CHANGES NO POLICY, GRANT, CAPABILITY, ROLE OR TRIGGER, and it needs
-- to change none. This is worth stating precisely rather than asserting,
-- because "add a column, add a policy" is a reflex:
--
--   The four policies on register_entries (0044) are
--   register_entries_select_players_view, _insert, _update and _delete.
--   Not one of them names a column: they are all
--   `club_id = my_club() and has_perm(...)`. A row's visibility and
--   writability therefore already cover every column it has, including
--   ones added later. Adding a policy here would be a second, weaker
--   statement of a boundary that already holds.
--
--   The grants are table wide (`grant select, insert, update, delete ...
--   to authenticated`), never column scoped, so the new column inherits
--   exactly the access the existing ones have and anon still holds
--   nothing.
--
--   register_entries_touch() stamps marked_by and marked_at on every
--   insert and update and refuses to let a row change its session, player
--   or club. It reads no other column, so it needs no amendment, and it
--   keeps stamping provenance for a group-inclusion edit exactly as it
--   does for an attendance edit.
--
-- If a future change to this table DOES need a policy or grant change,
-- that is a flag to raise in review, not a line to add quietly. The
-- self-verification below fails the migration if the policy set, the
-- grants or the RLS switch have moved.
--
-- IT ADDS NO INDEX. The column is read as part of the session's register,
-- which is already fetched by session_id through an existing key, and it
-- is never filtered or searched on by itself.
--
-- IT ADDS NO CONSTRAINT BETWEEN THE TWO COLUMNS, on purpose. Every one of
-- the four combinations is a real night: present and included, present and
-- not included, absent and included, absent and not included. A check
-- constraint tying them together would be the same conflation this
-- migration exists to undo.
--
-- ---------------------------------------------------------------------
-- SAFETY OF THE ADD ITSELF
-- ---------------------------------------------------------------------
--
-- `add column ... not null default false` on PostgreSQL 11 and later
-- stores the default in the catalogue and rewrites no rows, so it takes a
-- brief ACCESS EXCLUSIVE lock and returns immediately on a table this
-- size. No existing row is read or written by it.
--
-- ---------------------------------------------------------------------
-- APPLY ORDER. THIS MIGRATION GOES FIRST, before the frontend from the
-- same change is deployed, and it is safe to run early:
--
--   * the deployed (old) client selects an explicit column list that does
--     not include included_in_groups, so it never sees the new column, and
--     its upserts omit it, so every row it writes takes the false default;
--   * the new client selects and writes included_in_groups, and against a
--     database without the column PostgREST answers 42703, which would
--     fail the whole register read and leave Tonight unusable.
--
-- Applying it late is therefore the hazard, exactly as it was for 0046.
--
-- ROLLBACK. Structurally:
--   alter table public.register_entries drop column included_in_groups;
-- That discards every saved group selection and leaves attendance intact,
-- which is the right way round: attendance is the record, the groups are
-- the arrangement. Nothing else in the schema references the column, so no
-- other object breaks.
-- =====================================================================

-- ONE transaction, as 0041 through 0046 are.
begin;

-- ---------------------------------------------------------------------
-- Capture the attendance record BEFORE the change, so the verification at
-- the bottom can prove this migration did not touch it. Held in a
-- temporary table dropped on commit, so it leaves nothing behind.
-- ---------------------------------------------------------------------
create temporary table register_entries_before on commit drop as
select
  (select count(*) from public.register_entries)                as total_rows,
  (select count(*) from public.register_entries where present)  as present_true,
  (select coalesce(md5(string_agg(session_id::text || ':' || player_id::text || ':' || present::text,
                                  ',' order by session_id, player_id)), 'empty')
     from public.register_entries)                              as attendance_fingerprint;

-- ---------------------------------------------------------------------
-- The column. NOT NULL with a false default: "no coach has selected this
-- child for a working group", which is true of every existing row and
-- claims nothing about any of them.
-- ---------------------------------------------------------------------
alter table public.register_entries
  add column if not exists included_in_groups boolean not null default false;

-- ---------------------------------------------------------------------
-- The two columns, said out loud, because the whole defect was that one
-- of them was carrying both sentences.
-- ---------------------------------------------------------------------
comment on column public.register_entries.included_in_groups is
  $$Whether the coach has put this child in one of tonight's working groups (0047). The coach's ARRANGEMENT of the session: who is being split into which bib group. Independent of register_entries.present, which records whether the child actually attended, and independent of the parent's Spond reply, which is neither. All four combinations are real: a child can attend without being in a group, and be in a group without attending. Written only by the Tonight save (src/lib/queries.ts useSaveTonight), and only for the fields that change, so one coach organising groups cannot overwrite another coach's attendance mark on the same row. Defaults false, which claims nothing.$$;

comment on column public.register_entries.present is
  $$Whether this child was PHYSICALLY PRESENT at the session (0044, restored to that meaning by 0047). Attendance and nothing else. Between the Tonight release and 0047 this column was also used to mean "included in tonight's working groups", which is what 0047 separates out into included_in_groups; rows written in that window carry a value that meant inclusion when it was written, and no migration reinterprets them, because there is no way to tell them apart from genuine attendance without guessing. Never set from a Spond reply: what a parent answered and whether the child turned up are different facts, and spond-sync neither reads nor writes this column.$$;

comment on table public.register_entries is
  $$The session register (0044, split by 0047): who ATTENDED (present), who the coach put in tonight's working GROUPS (included_in_groups), and what bib each wore. Three independent facts live around this row: the parent's Spond reply (spond_event_responses, context only), attendance, and group inclusion. None of them sets or constrains another. Holds player ids only and never a name, so it carries the same child data weight as the roster it resolves against: select is gated players.view and parents never read it. Writes take sessions.create club wide, because any coach on the day marks arrivals, not only the session's owner. Erasing a child or deleting a session removes the rows by cascade. Not audited per tick by deliberate decision: the row is the record and a tick is a high frequency operational touch.$$;

-- ---------------------------------------------------------------------
-- Self verification. Proves the four things that would matter if they
-- were wrong: the column exists in the shape the client expects, no row
-- was told a coach had selected it, the attendance record is byte for
-- byte what it was before this file ran, and the security posture of the
-- table is untouched. Any failure aborts the migration.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  before_total integer;
  before_present integer;
  before_fingerprint text;
  after_fingerprint text;
begin
  -- 1. The column, in the exact shape the client and this file assume.
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'register_entries'
     and column_name = 'included_in_groups'
     and data_type = 'boolean' and is_nullable = 'NO'
     and column_default = 'false';
  if n <> 1 then
    raise exception 'register_group_inclusion: included_in_groups must be a NOT NULL boolean defaulting to false (got %)', n;
  end if;

  -- 2. NOBODY WAS SILENTLY SELECTED. The whole point of the false default
  --    is that this migration makes no claim about any coach's intent.
  select count(*) into n from public.register_entries where included_in_groups;
  if n <> 0 then
    raise exception 'register_group_inclusion: % row(s) were marked as included in groups; this migration must select nobody', n;
  end if;

  -- 3. ATTENDANCE IS UNTOUCHED. Not "probably": the same fingerprint over
  --    every (session, player, present) triple, before and after.
  select total_rows, present_true, attendance_fingerprint
    into before_total, before_present, before_fingerprint
    from register_entries_before;
  select coalesce(md5(string_agg(session_id::text || ':' || player_id::text || ':' || present::text,
                                 ',' order by session_id, player_id)), 'empty')
    into after_fingerprint from public.register_entries;
  if after_fingerprint is distinct from before_fingerprint then
    raise exception 'register_group_inclusion: the attendance record changed (% -> %)', before_fingerprint, after_fingerprint;
  end if;
  select count(*) into n from public.register_entries;
  if n <> before_total then
    raise exception 'register_group_inclusion: the row count changed (% -> %)', before_total, n;
  end if;
  select count(*) into n from public.register_entries where present;
  if n <> before_present then
    raise exception 'register_group_inclusion: the number of children marked present changed (% -> %)', before_present, n;
  end if;

  -- 4. THE SECURITY POSTURE IS EXACTLY WHAT 0044 LEFT. A column addition
  --    has no business moving any of this, so the migration refuses to
  --    complete if it has.
  if not exists (select 1 from pg_class
                  where relname = 'register_entries'
                    and relnamespace = 'public'::regnamespace and relrowsecurity) then
    raise exception 'register_group_inclusion: row level security is not enabled on register_entries';
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'register_entries';
  if n <> 4 then
    raise exception 'register_group_inclusion: register_entries must carry exactly the four 0044 policies (got %)', n;
  end if;
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'register_entries' and cmd = 'ALL') then
    raise exception 'register_group_inclusion: register_entries must not carry a FOR ALL policy';
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'register_entries'
                   and cmd = 'SELECT' and qual like '%players.view%') then
    raise exception 'register_group_inclusion: the register select gate must still require players.view';
  end if;

  -- Grants: unchanged, table wide, and still nothing for anon. A column
  -- scoped grant appearing here would mean somebody narrowed or widened
  -- access to one of these two columns, which is exactly the change that
  -- must never happen quietly.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'register_entries' and grantee = 'authenticated'
     and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if n <> 4 then
    raise exception 'register_group_inclusion: authenticated must hold exactly select, insert, update and delete (got %)', n;
  end if;
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'register_entries' and grantee = 'anon') then
    raise exception 'register_group_inclusion: anon must hold nothing on register_entries';
  end if;
  -- pg_attribute.attacl, NOT information_schema.column_privileges. That
  -- view expands a table wide grant into one row per column, so it reports
  -- column privileges for a table nobody has ever column scoped and this
  -- check failed on its own first run against a faithful stand-in of 0044.
  -- attacl is null unless a grant was actually made on the column itself,
  -- which is the thing being refused here.
  if exists (select 1 from pg_attribute
             where attrelid = 'public.register_entries'::regclass
               and attnum > 0 and not attisdropped and attacl is not null) then
    raise exception 'register_group_inclusion: register_entries must carry no column scoped grant';
  end if;

  -- The provenance trigger still fires for both columns' edits.
  if not exists (select 1 from pg_trigger
                 where tgname = 'register_entries_touch'
                   and tgrelid = 'public.register_entries'::regclass and not tgisinternal) then
    raise exception 'register_group_inclusion: the register_entries_touch trigger is missing';
  end if;

  -- 5. The two columns are independent by construction: no check
  --    constraint may tie them together, because all four combinations
  --    are real nights.
  if exists (select 1 from pg_constraint
             where conrelid = 'public.register_entries'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) like '%included_in_groups%'
               and pg_get_constraintdef(oid) like '%present%') then
    raise exception 'register_group_inclusion: attendance and group inclusion must not be constrained against each other';
  end if;
end
$$;

commit;
