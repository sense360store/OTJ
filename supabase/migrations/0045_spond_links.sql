-- =====================================================================
-- OTJ Training Hub, migration 0045_spond_links: Release B of the
-- training day feature. Spond RSVP as context beside the register.
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free. Do not auto-merge. The Edge Function changes
-- that write these tables are deployed separately, after this applies.
--
-- Numbering: 0045. Slot 0044 is occupied by training_day_core, applied
-- to hosted as 20260809184949. The live ledger is the authority; confirm
-- the next free slot before applying. A file numbered 0045_spond_links
-- exists on the abandoned branch claude/training-day-logistics-rxr9lw-pr4
-- and was never applied anywhere; this file is not that file and shares
-- neither its table shapes nor its enforcement model.
--
-- WHAT THIS ADDS
--   player_spond_links     one opaque Spond member id bound to one
--                          public.players row, written by a human in a
--                          management screen
--   spond_event_responses  per event RSVP state for LINKED members only,
--                          written by spond-sync, four closed values
--
-- THE PRODUCT RULE THIS SCHEMA ENFORCES. Spond RSVP is CONTEXT. The
-- register is the coach's own record. Nothing here writes, reads,
-- constrains or defaults register_entries, and register_entries carries
-- no reference to anything in this file. Going and not present, declined
-- and present, and no reply and present are all valid and all storable.
-- A club that never links a member keeps the complete register.
--
-- WHY ONE MIGRATION. spond_event_responses carries a foreign key into
-- player_spond_links that is simultaneously the only invariant that
-- matters (a response row exists ONLY for a linked member) and the
-- erasure mechanism (unlinking drains). Split in two there is an
-- interval where the responses table exists with that invariant
-- unenforced. One apply, one release, one rollback, as 0044 argued.
--
-- THE CHILDREN'S DATA BOUNDARY, amended here deliberately. 0013 wrote
-- that Spond attendance is counts only and that per person attendance is
-- a later phase "gated behind the production readiness phase and the
-- players data model phase, where GDPR and safeguarding get deliberate
-- design". That phase is this one, and the amended boundary is:
--
--   * The ONLY Spond identifier this app persists is the opaque member
--     id, and only for a member a human has bound to a roster child.
--     Its column check refuses anything that is not uppercase hex, so a
--     name, an email address or a phone number does not fit the column.
--   * NO Spond name is persisted here, by any path. Names shown in the
--     product come from public.players.display_name. The linking screen
--     receives a Spond display name transiently from
--     spond-link-members so a manager can identify the person, and
--     stores nothing.
--   * NO guardian, contact, comment, recipients object or raw payload
--     fragment is persisted, in any column, by any path. Neither table
--     has a jsonb, text[] or otherwise free shaped column: there is no
--     escape hatch to widen later without a gated migration.
--   * Response rows for an UNLINKED member are unrepresentable, not
--     merely undesirable: the foreign key refuses them.
--   * Unlinking a player, or erasing a child, removes every stored
--     response for that member by cascade, in the same statement.
--   * spond_events keeps its four integer counts and gains no column.
--     Unlinked members remain represented only in those aggregates.
--
-- Both tables carry pseudonymous child personal data: a row resolves to
-- a named child through the roster. So both read gates are players.view,
-- exactly the gate register_entries and players themselves ride, and NOT
-- the capability free club wide read spond_events uses. Parents hold no
-- capabilities and read neither table.
--
-- See docs/security/spond-data-boundary.md and
-- docs/adr/ADR-0008-spond-member-links.md.
-- =====================================================================

-- ONE transaction, as 0041 through 0044 are. The self verification at the
-- end runs in the same transaction as every statement above it, so a failed
-- assertion rolls the whole release back rather than leaving a half applied
-- schema live. This matters because the header instructs a by-hand apply: on
-- a statement-at-a-time path an assertion that fires late would otherwise
-- leave the two tables, their policies and grants and the audit trigger
-- permanently in place, with a corrective re-run blocked because create
-- table is not idempotent.
begin;

-- ---------------------------------------------------------------------
-- Enabling constraint. spond_events is club scoped but carries only a
-- uuid primary key and a (club_id, spond_event_id) unique, so a composite
-- club scoped reference into it has no target yet. Guarded, following
-- 0044, so a corrective re-run does not fail on a duplicate constraint.
--
-- Nothing else about spond_events changes: no new column, so the Edge
-- Function's SPOND_EVENT_COLUMNS list and its exact key set assertion in
-- spond_test.ts stay untouched, and the counts pipeline is unaffected.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'spond_events_id_club_unique'
      and conrelid = 'public.spond_events'::regclass
  ) then
    alter table public.spond_events
      add constraint spond_events_id_club_unique unique (id, club_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- player_spond_links: one Spond member is one roster child.
--
-- The identity key is (club_id, spond_member_id) and it is also the key
-- spond_event_responses references, so the identity key and the
-- enforcement key are the same object. A surrogate uuid would have made
-- them two things that must agree.
--
-- spond_member_id is the ONLY Spond identifier this app stores. The
-- character class is the boundary, not a validation nicety: uppercase
-- hex admits no space, no '@', no '+', no '.' and no lowercase letter,
-- so a person's name, an email address and a phone number are all
-- unstorable in this column. src/lib/spond.ts already assumes exactly
-- this shape for group and subgroup ids (/^[0-9A-F]{16,}$/).
--
-- matched_by records HOW A HUMAN decided, and both values mean a human
-- decided. 'suggested' is a name suggestion the manager accepted;
-- 'chosen' is a roster row the manager picked. There is deliberately no
-- 'auto': no server side name matcher exists in this release, suggestions
-- are computed in the browser from a transient candidate list, and a
-- value implying a machine matched would misdescribe the record.
--
-- There is NO UPDATE PATH: no update policy, no update grant, and
-- therefore no immutability trigger to get wrong. A link is created or
-- removed. Correcting one is a delete then an insert, and both are
-- audited. "A link's player can never silently change" is a structural
-- fact here, not a trigger's promise.
-- ---------------------------------------------------------------------
create table public.player_spond_links (
  club_id         uuid not null references public.clubs (id) on delete cascade,
  spond_member_id text not null
    check (spond_member_id ~ '^[0-9A-F]{16,64}$'),
  player_id       uuid not null,
  matched_by      text not null check (matched_by in ('suggested', 'chosen')),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (club_id, spond_member_id),
  -- One child has at most one Spond member, club wide. Its index also
  -- serves the cascade from players.
  constraint player_spond_links_player_unique unique (player_id),
  constraint player_spond_links_player_fk
    foreign key (player_id, club_id) references public.players (id, club_id) on delete cascade
);

comment on table public.player_spond_links is
  $$One opaque Spond member id bound to one public.players child (0045). The only Spond identifier this app persists, and only for a member a human bound in the management screen. Holds NO Spond name, guardian, contact detail or payload fragment: names shown anywhere in the product come from players.display_name, and spond-link-members returns a Spond display name transiently to the linking screen and stores nothing. Pseudonymous child personal data, so select is gated players.view (never readable by parents) and writes take players.manage. Immutable: there is no update policy and no update grant. Deleting the child, or the club, removes the link; deleting the link drains every stored response for that member.$$;

comment on column public.player_spond_links.spond_member_id is
  $$The opaque Spond member id, uppercase hex only. The character class IS the data boundary: it admits no space, no '@', no '+', no '.' and no lowercase letter, so a name, an email address or a phone number cannot be stored here even by a caller that tried. Widening it is a gated migration and a boundary change.$$;

comment on column public.player_spond_links.matched_by is
  $$How the human decided: 'suggested' means a manager accepted a name suggestion computed in the browser, 'chosen' means a manager picked a roster row. Both mean a person decided. There is deliberately no 'auto' value: no server side name matcher exists.$$;

comment on column public.player_spond_links.player_id is
  $$The roster child this member is. Unique club wide, so one child carries at most one Spond member. The composite foreign key to players (id, club_id) makes a cross club link unrepresentable.$$;

-- Provenance, stamped by the database rather than sent by the client, so
-- a caller cannot forge who linked a child or backdate when. Following
-- register_entries_touch (0044): not SECURITY DEFINER, because it reads
-- nothing outside the row it is rewriting, and the policy does not
-- restate created_by, because this trigger is its single authority.
-- INSERT only: there is no update path to stamp.
create or replace function public.player_spond_links_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

create trigger player_spond_links_touch
  before insert on public.player_spond_links
  for each row execute function public.player_spond_links_touch();

-- ---------------------------------------------------------------------
-- spond_event_responses: per event RSVP state, LINKED MEMBERS ONLY.
--
-- spond_event_responses_link_fk is the most load bearing line in this
-- migration. It does two jobs at once, both of which the abandoned
-- design left to an Edge Function to remember:
--
--   1. It makes a response row for an UNLINKED member unrepresentable.
--      The rule is not "the sync should only write linked members"; it
--      is that the database refuses anything else.
--   2. It IS the unlink drain. Removing a link removes every stored
--      response for that member, club wide, in the same statement, run
--      by Postgres. There is no sweep, no diff, no job and no cursor,
--      so there is nothing to truncate, skip or get wrong. An erased
--      child cascades players to links to responses in one step.
--
-- The status vocabulary is closed and is exactly Spond's four states,
-- the same four the integer counts on spond_events already name.
-- unconfirmedIds is not one of them and is never read, unchanged.
--
-- There is no payload column, no jsonb, no name column and no free
-- shaped column of any kind: the table cannot be widened by writing to
-- it, only by a gated migration.
--
-- synced_at carries the run that last confirmed this row, which is what
-- lets the sync reconcile an event by upserting the rows it saw and
-- deleting only strictly older ones. It is never an attendance time.
-- ---------------------------------------------------------------------
create table public.spond_event_responses (
  club_id         uuid not null,
  spond_event_id  uuid not null,
  spond_member_id text not null
    check (spond_member_id ~ '^[0-9A-F]{16,64}$'),
  status          text not null
    check (status in ('accepted', 'declined', 'unanswered', 'waiting')),
  synced_at       timestamptz not null,
  primary key (spond_event_id, spond_member_id),
  constraint spond_event_responses_event_fk
    foreign key (spond_event_id, club_id) references public.spond_events (id, club_id) on delete cascade,
  constraint spond_event_responses_link_fk
    foreign key (club_id, spond_member_id)
      references public.player_spond_links (club_id, spond_member_id) on delete cascade
);
-- The index the unlink drain scans. Without it the cascade from a link
-- delete is a sequential scan of every response in the club.
create index spond_event_responses_link_idx
  on public.spond_event_responses (club_id, spond_member_id);

comment on table public.spond_event_responses is
  $$One Spond event RSVP for one LINKED member (0045). Context beside the register, never attendance: the coach's record is register_entries, which this table neither writes, reads nor constrains. A row can exist only for a member with a player_spond_links row, enforced by spond_event_responses_link_fk, and unlinking or erasing that child removes the rows by cascade in the same statement. Holds no name, no guardian, no contact detail, no comment and no payload fragment. Pseudonymous child personal data, so select is gated players.view (never readable by parents); writes take sessions.create, the capability spond-sync already runs under. Unlinked Spond members are represented only in the aggregate counts on spond_events.$$;

comment on column public.spond_event_responses.status is
  $$Spond's own reply state, closed vocabulary: accepted, declined, unanswered, waiting. The same four the integer counts on spond_events name. This is what a parent replied in Spond and never what happened on the night.$$;

comment on column public.spond_event_responses.synced_at is
  $$The sync run that last confirmed this row. The reconcile upserts what it saw with this run's stamp and deletes only strictly older rows for the event, so a partial failure leaves the previous context intact rather than emptying the event. Never an attendance time.$$;

-- ---------------------------------------------------------------------
-- Row level security. Seven policies, none of them FOR ALL: a FOR ALL
-- policy's USING arm becomes a permissive OR on select, which would
-- widen each read gate to its write capability. 0044 asserts against
-- exactly that and so does the verification below.
-- ---------------------------------------------------------------------
alter table public.player_spond_links    enable row level security;
alter table public.spond_event_responses enable row level security;

-- Read: players.view, the gate the roster and the register ride. A row
-- here resolves to a named child, so it must be no more readable than
-- the roster it resolves against. Deliberately NOT the capability free
-- club wide read spond_events uses: aggregate counts name nobody, these
-- rows do.
create policy "player_spond_links_select_view" on public.player_spond_links
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

-- Write: players.manage, held by admin and manager, the same capability
-- that curates the roster. A stated choice, not an inherited default.
-- Not sessions.create, which would let every coach bind a Spond member
-- id to a named child; that is a roster identity operation, not a
-- session one. Not club.manage, which is admin only and would exclude
-- the managers who actually keep the roster. No new capability key is
-- introduced, so the 22 key catalogue is untouched.
--
-- created_by is not restated here: player_spond_links_touch is its
-- single authority and stamps auth.uid() on every insert.
create policy "player_spond_links_insert" on public.player_spond_links
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );

create policy "player_spond_links_delete" on public.player_spond_links
  for delete using (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );

-- Read: players.view, as above.
create policy "spond_event_responses_select_view" on public.spond_event_responses
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

-- Write: sessions.create, the capability spond-sync already checks
-- before contacting Spond and the one the spond_events write policy
-- names, so the sync's early check and the enforcement here cannot
-- drift. update is granted, unlike coverage in 0044, because it is what
-- lets the per event reconcile be one idempotent upsert instead of a
-- delete followed by an insert with an empty window between them.
create policy "spond_event_responses_insert" on public.spond_event_responses
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('sessions.create')
  );
create policy "spond_event_responses_update" on public.spond_event_responses
  for update using (
    club_id = public.my_club()
    and public.has_perm('sessions.create')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('sessions.create')
  );
create policy "spond_event_responses_delete" on public.spond_event_responses
  for delete using (
    club_id = public.my_club()
    and public.has_perm('sessions.create')
  );

-- ---------------------------------------------------------------------
-- Grants. Revoke first, then grant exactly what the policies allow. The
-- hosted project's default privileges auto grant ALL on new tables to
-- anon and authenticated, so without the revoke these statements would
-- leave a wider grant behind than the file appears to give. This is
-- load bearing on both tables: anon must reach neither.
--
-- Links carry no UPDATE grant, matching the absent update policy, so
-- immutability holds at the grant as well as at the policy.
-- ---------------------------------------------------------------------
revoke all on public.player_spond_links    from anon, authenticated;
revoke all on public.spond_event_responses from anon, authenticated;

grant select, insert, delete         on public.player_spond_links    to authenticated;
grant select, insert, update, delete on public.spond_event_responses to authenticated;

-- ---------------------------------------------------------------------
-- Audit. Links are audited; responses deliberately are not.
--
-- Binding a Spond member to a named child, and severing that binding,
-- are decisions about a child's identity and must leave a trail. The
-- OPAQUE MEMBER ID IS NEVER PASSED AS A VALUE: the action name alone
-- carries the fact, and audit_events.safe_changes is untouched by this
-- release, so the immutable allow list that keeps values out of the
-- trail needs no change.
--
-- Responses are unaudited for the reason register_entries is: they are
-- high frequency sync output, the row is the record, and one event per
-- member per event per run would swamp the trail. The verification
-- asserts no audit trigger exists on them.
--
-- An unlink whose player is already gone emits nothing: player.deleted
-- is already the record, and the cascade from that delete is not a
-- separate decision. The club gone case is handled inside
-- audit_domain_event, which returns early when the club row has been
-- cascaded away.
-- ---------------------------------------------------------------------
create or replace function public.audit_player_spond_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid; v_player uuid; v_action text;
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_player := new.player_id; v_action := 'player.spond_linked';
  else
    if not exists (select 1 from public.players p where p.id = old.player_id) then
      return old;  -- a cascade from player.deleted; that event is the record
    end if;
    v_club := old.club_id; v_player := old.player_id; v_action := 'player.spond_unlinked';
  end if;

  perform public.audit_domain_event(v_club, auth.uid(), v_action, 'player', v_player, null, null);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_player_spond_links
  after insert or delete on public.player_spond_links
  for each row execute function public.audit_player_spond_links();

-- ---------------------------------------------------------------------
-- The statement of record on public.players is corrected. Its 0032 text
-- asserts the club holds no "link to auth.users or Spond member ids",
-- which stops being true the moment this migration applies. A schema
-- comment that contradicts the schema is worse than no comment: the next
-- reader trusts it. The auth.users half of the claim is unchanged and
-- still true.
-- ---------------------------------------------------------------------
comment on table public.players is
  $$The stable club level identity of one child (0032_registered_players.sql, evolving 0021/0023; Spond boundary amended by 0045_spond_links.sql). Holds ONE bounded display_name (the child's full name) and nothing else personal: no date of birth, age, guardian or contact data, medical or safeguarding fields, photographs, consent records, or link to auth.users. A child may carry ONE opaque Spond member id, held on public.player_spond_links (never on this table, never a Spond name), bound by a human holding players.manage; see 0045_spond_links.sql and docs/security/spond-data-boundary.md. Seasonal facts (team, shirt, status, dates) live on public.player_registrations, one per child per season. team_id and shirt_number are FROZEN legacy compatibility columns retained until PR 3 (nullable, ON DELETE SET NULL); new code never writes them. Reads require players.view (club wide); writes require players.manage; permanent identity deletion requires players.delete. A player linked audit_events row is pseudonymous child personal data. See docs/adr/ADR-0005-registered-players-and-seasons.md and docs/security/registered-players-boundary.md.$$;

-- ---------------------------------------------------------------------
-- Self verification. Same transaction as everything above, so any
-- failure rolls the entire release back and leaves the schema exactly as
-- it was. Every assertion below states a boundary this release claims.
-- ---------------------------------------------------------------------
do $$
declare
  n int;
  cols text[];
begin
  -- The tables exist and RLS is on. Without the second half every policy
  -- below is decoration.
  if to_regclass('public.player_spond_links') is null
     or to_regclass('public.spond_event_responses') is null then
    raise exception 'spond_links: a table is missing';
  end if;
  select count(*) into n from pg_class
   where relname in ('player_spond_links', 'spond_event_responses')
     and relnamespace = 'public'::regnamespace
     and relrowsecurity;
  if n <> 2 then
    raise exception 'spond_links: row level security must be enabled on both tables (got %)', n;
  end if;

  -- The exact column sets, pinned by name. This is the assertion that
  -- turns "these tables must never gain a name, guardian, contact or
  -- payload column" into something the apply itself checks: adding one
  -- without amending this list fails the migration.
  select array_agg(attname order by attname) into cols
    from pg_attribute
   where attrelid = 'public.player_spond_links'::regclass and attnum > 0 and not attisdropped;
  if cols <> array['club_id','created_at','created_by','matched_by','player_id','spond_member_id'] then
    raise exception 'spond_links: player_spond_links has unexpected columns (%)', cols;
  end if;
  select array_agg(attname order by attname) into cols
    from pg_attribute
   where attrelid = 'public.spond_event_responses'::regclass and attnum > 0 and not attisdropped;
  if cols <> array['club_id','spond_event_id','spond_member_id','status','synced_at'] then
    raise exception 'spond_links: spond_event_responses has unexpected columns (%)', cols;
  end if;

  -- No FOR ALL policy on either table: its USING arm would become a
  -- permissive OR on select and widen the read gate to the write one.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('player_spond_links', 'spond_event_responses')
       and cmd = 'ALL'
  ) then
    raise exception 'spond_links: a FOR ALL policy would widen the read gate';
  end if;

  -- Both reads ride players.view, so parents (who hold no capability)
  -- read neither table and neither is as open as spond_events.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'player_spond_links'
       and cmd = 'SELECT' and qual like '%players.view%'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'spond_event_responses'
       and cmd = 'SELECT' and qual like '%players.view%'
  ) then
    raise exception 'spond_links: both select policies must be gated on players.view';
  end if;

  -- Linking a Spond member to a named child is a roster identity write.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'player_spond_links'
       and cmd = 'INSERT' and with_check like '%players.manage%'
  ) then
    raise exception 'spond_links: linking must require players.manage';
  end if;

  -- There is no update path on links at all: no policy and no grant.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'player_spond_links' and cmd = 'UPDATE'
  ) then
    raise exception 'spond_links: a link must not be updatable';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'player_spond_links'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'spond_links: player_spond_links must not grant UPDATE';
  end if;

  -- The three club scoped references are declared and all cascade. The
  -- link one is the drain; weakening any of them to SET NULL or NO
  -- ACTION would leave stored responses behind an erased child.
  if not exists (
    select 1 from pg_constraint
     where conname = 'player_spond_links_player_fk'
       and conrelid = 'public.player_spond_links'::regclass and confdeltype = 'c'
  ) then
    raise exception 'spond_links: the player reference must exist and cascade';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'spond_event_responses_event_fk'
       and conrelid = 'public.spond_event_responses'::regclass and confdeltype = 'c'
  ) then
    raise exception 'spond_links: the event reference must exist and cascade';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'spond_event_responses_link_fk'
       and conrelid = 'public.spond_event_responses'::regclass and confdeltype = 'c'
  ) then
    raise exception 'spond_links: the link reference must exist and cascade (it is the unlink drain)';
  end if;

  -- anon holds nothing on either table. Neither has an anonymous read
  -- path, and a stack with permissive default privileges would otherwise
  -- leave one behind the grants above.
  select count(*) into n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('player_spond_links', 'spond_event_responses')
     and grantee = 'anon';
  if n <> 0 then
    raise exception 'spond_links: anon must hold no grant on the new tables (got %)', n;
  end if;

  -- The audit trigger exists on links and does NOT exist on responses.
  if not exists (select 1 from pg_trigger where tgname = 'audit_player_spond_links') then
    raise exception 'spond_links: the link audit trigger is missing';
  end if;
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.spond_event_responses'::regclass and tgname like 'audit%'
  ) then
    raise exception 'spond_links: responses must not be audited per member per sync';
  end if;
  -- The trail records the fact, never the identifier.
  if position('spond_member_id' in pg_get_functiondef('public.audit_player_spond_links()'::regprocedure)) <> 0 then
    raise exception 'spond_links: the audit trigger must never touch the member id';
  end if;

  -- The member id column refuses everything that is not an opaque id.
  -- Both directions, because a check that accepts nothing would pass a
  -- one sided probe.
  begin
    insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
    values ((select id from public.clubs limit 1), 'Jack Thompson',
            (select id from public.players limit 1), 'chosen');
    raise exception 'spond_links: the member id column accepted a name';
  exception
    when check_violation then null;
    when not_null_violation then null;
    when foreign_key_violation then raise exception 'spond_links: the member id check did not fire before the foreign key';
  end;
  begin
    insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
    values ((select id from public.clubs limit 1), 'parent@example.invalid',
            (select id from public.players limit 1), 'chosen');
    raise exception 'spond_links: the member id column accepted an email address';
  exception
    when check_violation then null;
    when not_null_violation then null;
    when foreign_key_violation then raise exception 'spond_links: the member id check did not fire before the foreign key';
  end;
  begin
    insert into public.player_spond_links (club_id, spond_member_id, player_id, matched_by)
    values ((select id from public.clubs limit 1), 'abcdef0123456789',
            (select id from public.players limit 1), 'chosen');
    raise exception 'spond_links: the member id column accepted lowercase hex';
  exception
    when check_violation then null;
    when not_null_violation then null;
    when foreign_key_violation then raise exception 'spond_links: the member id check did not fire before the foreign key';
  end;
  -- And accepts a real one, so the check is a boundary and not a wall.
  if not ('0123456789ABCDEF0123456789ABCDEF' ~ '^[0-9A-F]{16,64}$') then
    raise exception 'spond_links: the member id check refuses a real Spond id';
  end if;

  -- A response for a member nobody linked is unrepresentable. This is
  -- the invariant the whole release rests on, so it is probed, not
  -- assumed from the constraint's existence.
  begin
    insert into public.spond_event_responses (club_id, spond_event_id, spond_member_id, status, synced_at)
    values ((select id from public.clubs limit 1),
            coalesce((select id from public.spond_events limit 1), gen_random_uuid()),
            '0123456789ABCDEF0123456789ABCDEF', 'accepted', now());
    raise exception 'spond_links: a response for an unlinked member was accepted';
  exception
    when foreign_key_violation then null;
    when not_null_violation then null;
  end;

  -- The migration invents no links and no responses, and touches no
  -- existing register, session or player row.
  if (select count(*) from public.player_spond_links) <> 0 then
    raise exception 'spond_links: the migration must not create link rows';
  end if;
  if (select count(*) from public.spond_event_responses) <> 0 then
    raise exception 'spond_links: the migration must not create response rows';
  end if;
end
$$;

commit;
