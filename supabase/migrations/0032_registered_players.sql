-- =====================================================================
-- OTJ Training Hub, migration 0032_registered_players: stable child
-- identity and seasonal registrations (Registered Players PR 2, part 2 of 2)
--
-- REVIEW REQUIRED, and this is a CHILD DATA migration. It reshapes the one
-- table that names children (players) into a stable identity table, adds the
-- seasonal player_registrations table, backfills every existing roster row,
-- re gates read and write on the players.view / players.manage / players.delete
-- capabilities, and attaches the append only audit triggers that make a
-- player linked audit row pseudonymous child personal data. Migrations are
-- gated. Run by hand via the connector after line by line review, and only
-- once the live ledger is confirmed to have this slot free. Do not auto-merge.
-- No Edge Function changes accompany this migration (the Spond shim is a
-- separate function deploy).
--
-- Numbering: confirmed 0032. Files on disk end at 0031_seasons.sql (this PR's
-- part 1) and the live hosted ledger ends at audit_foundation (0030); 0031 and
-- 0032 are this PR's two slots, confirmed free from both sources. Per the
-- standing rule the ledger is the authority.
--
-- DEPENDS ON 0031: the backfill writes one registration per player into the
-- club's current season, which 0031 created. 0031 must be applied first.
--
-- THE CHILD DATA BOUNDARY, carried over unchanged from 0021 and 0023 and
-- restated on the tables below. The identity table holds ONE name per child
-- and nothing else personal: no date of birth, no age, no guardian or contact
-- data, no medical or safeguarding fields, no photographs, no consent records,
-- no link to auth users, no Spond member ids. The registration table holds
-- only seasonal operational facts (season, team, status, shirt, dates) and
-- NEVER a name. The audit rows hold no name by construction (the 0030
-- safe_changes allow list excludes display_name).
--
-- PSEUDONYMOUS CHILD PERSONAL DATA. Once the triggers below attach, an
-- audit_events row whose entity_type is 'player' is pseudonymous child
-- personal data: it carries no name but holds a stable player id plus that
-- child's attribute history. Retention and subject erasure of those rows are
-- CHILD data decisions (retain indefinitely at current scale, reviewed
-- annually; a substantiated erasure request must address the child linked
-- audit identifiers and safe_changes and backups, not the players deletion
-- path alone). See docs/security/app-audit-boundary.md (Retention, Data
-- classification). Do not describe these audit events as containing no child
-- data.
--
-- THE COMPATIBILITY SEAM. The old Roster page and any cached or already open
-- old browser build still write the pre PR 2 players shape (an insert into
-- players carrying team_id and shirt_number; an update of shirt_number or the
-- name). No such write may succeed while creating invalid, unaudited or
-- invisible data. So team_id and shirt_number are RETAINED on players as
-- FROZEN compatibility columns (made nullable, ON DELETE SET NULL) and a
-- compatibility trigger translates every legacy shape write into the canonical
-- identity plus current season registration, atomically and audited. New code
-- never writes the frozen columns. They and the compatibility trigger are
-- dropped in a later migration (provisional 0033, PR 3) once old clients have
-- aged out; this migration does NOT drop them.
--
-- FOUNDATION SQL CONVENTIONS (the 0028, 0029, 0030, 0031 form): privileged
-- functions are SECURITY DEFINER (except add_player, deliberately INVOKER, see
-- below) with set search_path = '' and schema qualified references; grants are
-- explicit; the migration self verifies before it commits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- teams gains a composite unique key so registrations can reference
-- (team_id, club_id) and enforce "the team belongs to the same club"
-- declaratively. teams.id is already the primary key; this is the extra
-- constraint the composite foreign key needs as its target.
-- ---------------------------------------------------------------------
alter table public.teams
  add constraint teams_id_club_unique unique (id, club_id);

-- =====================================================================
-- PART 1: evolve public.players into the stable child identity table.
-- =====================================================================

-- New accountability columns. updated_by is nullable ON DELETE SET NULL;
-- updated_at defaults to now() and is maintained by the touch trigger.
alter table public.players
  add column updated_by uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz not null default now();

-- created_by: was NOT NULL ON DELETE CASCADE, the confirmed hazard that
-- deleted a coach's players when the coach was removed. Becomes nullable
-- ON DELETE SET NULL so removing the adult creator preserves the child.
alter table public.players
  drop constraint players_created_by_fkey,
  alter column created_by drop not null,
  add constraint players_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

-- team_id and shirt_number are the FROZEN compatibility columns. team_id was
-- NOT NULL ON DELETE CASCADE (deleting a team hard deleted its roster rows).
-- It becomes nullable ON DELETE SET NULL so the team deletion data loss fix
-- bites immediately even for a legacy created row, and so add_player can leave
-- it null on the identity (team lives on the registration). shirt_number is
-- already nullable.
alter table public.players
  drop constraint players_team_id_fkey,
  alter column team_id drop not null,
  add constraint players_team_id_fkey
    foreign key (team_id) references public.teams (id) on delete set null;

-- The composite unique key registrations reference so a registration's player
-- and club must agree.
alter table public.players
  add constraint players_id_club_unique unique (id, club_id);

comment on table public.players is
  $$The stable club level identity of one child (0032_registered_players.sql, evolving 0021/0023). Holds ONE bounded display_name (the child's full name) and nothing else personal: no date of birth, age, guardian or contact data, medical or safeguarding fields, photographs, consent records, link to auth.users or Spond member ids. Seasonal facts (team, shirt, status, dates) live on public.player_registrations, one per child per season. team_id and shirt_number are FROZEN legacy compatibility columns retained until PR 3 (nullable, ON DELETE SET NULL); new code never writes them. Reads require players.view (club wide); writes require players.manage; permanent identity deletion requires players.delete. A player linked audit_events row is pseudonymous child personal data. See docs/adr/ADR-0005-registered-players-and-seasons.md and docs/security/registered-players-boundary.md.$$;

comment on column public.players.team_id is
  $$FROZEN legacy compatibility column (nullable, ON DELETE SET NULL). The canonical team is player_registrations.team_id per season. Retained only as the compatibility trigger's translation source and the read only UI rollback lever until PR 3 drops it. New code never writes it.$$;

comment on column public.players.shirt_number is
  $$FROZEN legacy compatibility column. The canonical shirt number is player_registrations.shirt_number per season. Retained only for the compatibility trigger and the UI rollback lever until PR 3 drops it. New code never writes it.$$;

-- Re gate players RLS onto the Registered Players capabilities. The old
-- sessions.create policies (0021) are replaced: read is club wide on
-- players.view (no team arm), writes require players.manage with created_by
-- pinned to the writer (fixing the confirmed 0021 comment versus clause
-- mismatch), and permanent identity delete requires players.delete so an
-- ordinary players.manage holder cannot erase a child.
drop policy "players_select_coach" on public.players;
drop policy "players_manage_coach" on public.players;

create policy "players_select_view" on public.players
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

create policy "players_insert_manage" on public.players
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
    and created_by = auth.uid()
  );

create policy "players_update_manage" on public.players
  for update using (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );

create policy "players_delete_admin" on public.players
  for delete using (
    club_id = public.my_club()
    and public.has_perm('players.delete')
  );

-- Grants unchanged in verbs (select, insert, update, delete) but re issued
-- explicitly after the revoke, matching the 0030 hygiene (no stray TRUNCATE).
revoke all on public.players from anon, authenticated;
grant select, insert, update, delete on public.players to authenticated;

-- Players touch and immutability trigger (BEFORE UPDATE). Maintains updated_at
-- and updated_by; refuses rewriting club_id and created_at, and refuses re
-- attributing created_by to a DIFFERENT non null profile (a null created_by is
-- allowed because that is exactly the ON DELETE SET NULL cascade when the
-- creating adult is removed). display_name, and the frozen team_id/shirt_number,
-- stay writable (the latter only by the legacy path).
create or replace function public.players_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is distinct from old.club_id then
    raise exception 'players: club_id is immutable' using errcode = 'P0001';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'players: created_at is immutable' using errcode = 'P0001';
  end if;
  -- created_by may only change through a genuine profile deletion cascade (the
  -- referenced profile is gone); an authenticated or service caller cannot
  -- erase it to null or re attribute it while the profile still exists.
  if new.created_by is distinct from old.created_by
     and not public.provenance_change_is_cascade(old.created_by, new.created_by) then
    raise exception 'players: created_by cannot be erased or re attributed' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger players_touch
  before update on public.players
  for each row execute function public.players_touch();

-- =====================================================================
-- PART 2: public.player_registrations, the seasonal registration table.
-- =====================================================================

create table public.player_registrations (
  id              uuid primary key default gen_random_uuid(),
  -- Denormalised for RLS; must equal the player's, the season's and the
  -- team's club, enforced by the composite foreign keys below.
  club_id         uuid not null,
  player_id       uuid not null,
  season_id       uuid not null,
  -- Nullable: null means Unassigned. ON DELETE SET NULL (team_id only) turns a
  -- deleted team's registrations Unassigned instead of deleting children.
  team_id         uuid,
  status          text not null default 'pending'
                    check (status in ('pending', 'registered', 'withdrawn')),
  shirt_number    int check (shirt_number between 1 and 99),
  registered_date date,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  -- One registration per child per season.
  constraint player_registrations_player_season_unique unique (player_id, season_id),
  -- Player and club agree; deleting a child cascades their registrations.
  constraint player_registrations_player_fk
    foreign key (player_id, club_id) references public.players (id, club_id) on delete cascade,
  -- Season and club agree; a season with registrations cannot be deleted.
  constraint player_registrations_season_fk
    foreign key (season_id, club_id) references public.seasons (id, club_id) on delete restrict,
  -- Team and club agree when a team is set; deleting a team nulls team_id only
  -- (not the denormalised club_id), so the row survives as Unassigned.
  constraint player_registrations_team_fk
    foreign key (team_id, club_id) references public.teams (id, club_id) on delete set null (team_id)
);

create index player_registrations_club_season_idx
  on public.player_registrations (club_id, season_id);
create index player_registrations_season_team_idx
  on public.player_registrations (season_id, team_id);
create index player_registrations_player_idx
  on public.player_registrations (player_id);

comment on table public.player_registrations is
  $$One child's registration for one season (0032_registered_players.sql): the season, team (nullable for Unassigned), status (pending, registered, withdrawn), optional shirt number and registration date. Holds NO name and no other child personal data; the name lives once on public.players and resolves by id. club_id is denormalised for RLS and must equal the player's, season's and team's club (composite foreign keys). Reads require players.view (club wide); writes require players.manage; there is no ordinary product path that deletes a single registration (Withdraw is a status change), and a registration is removed only when its identity is deleted (players.delete) or its season, never. See docs/adr/ADR-0005-registered-players-and-seasons.md.$$;

-- Grants: explicit after revoke, matching 0030 hygiene. NO DELETE for any
-- client: a registration is never deleted on its own. The only way a
-- registration goes is when its player identity is deleted (players.delete),
-- which cascades through the (player_id, club_id) foreign key. Removing the
-- direct delete verb closes the last-registration orphan hazard (a
-- players.delete holder could otherwise delete a player's final registration
-- and leave the identity invisible), and is the counterpart of the deferred
-- require-registration constraint below.
revoke all on public.player_registrations from anon, authenticated;
grant select, insert, update on public.player_registrations to authenticated;

-- Row level security. Read is club wide on players.view (no team arm); writes
-- require players.manage with created_by pinned to the writer. There is
-- deliberately NO delete policy: no client may delete a registration directly
-- (Withdraw is a status change, and permanent erasure is the players.delete
-- identity cascade), so a player identity can never be orphaned by losing its
-- last registration.
alter table public.player_registrations enable row level security;

create policy "player_registrations_select_view" on public.player_registrations
  for select using (
    club_id = public.my_club()
    and public.has_perm('players.view')
  );

create policy "player_registrations_insert_manage" on public.player_registrations
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
    and created_by = auth.uid()
  );

create policy "player_registrations_update_manage" on public.player_registrations
  for update using (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  )
  with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
  );
-- No delete policy and no delete grant (see the grant note above).

-- ---------------------------------------------------------------------
-- Registration BEFORE triggers. Split by concern; all raise P0001 on refusal
-- per the harness convention.
-- ---------------------------------------------------------------------

-- Immutability and touch (BEFORE UPDATE): maintain updated_at/updated_by;
-- refuse rewriting provenance and linkage (created_at, player_id, season_id,
-- club_id, and created_by except through a genuine profile deletion cascade).
create or replace function public.registrations_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is distinct from old.club_id then
    raise exception 'player_registrations: club_id is immutable' using errcode = 'P0001';
  end if;
  if new.player_id is distinct from old.player_id then
    raise exception 'player_registrations: player_id is immutable' using errcode = 'P0001';
  end if;
  if new.season_id is distinct from old.season_id then
    raise exception 'player_registrations: season_id is immutable' using errcode = 'P0001';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'player_registrations: created_at is immutable' using errcode = 'P0001';
  end if;
  if new.created_by is distinct from old.created_by
     and not public.provenance_change_is_cascade(old.created_by, new.created_by) then
    raise exception 'player_registrations: created_by cannot be erased or re attributed' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger registrations_touch
  before update on public.player_registrations
  for each row execute function public.registrations_touch();

-- Status transition validation (BEFORE UPDATE): only the approved transitions.
create or replace function public.registrations_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status = 'pending'    and new.status in ('registered', 'withdrawn'))
     or (old.status = 'registered' and new.status = 'withdrawn')
     or (old.status = 'withdrawn'  and new.status in ('pending', 'registered')) then
    return new;
  end if;
  raise exception 'player_registrations: status transition % to % is not allowed', old.status, new.status
    using errcode = 'P0001';
end;
$$;

create trigger registrations_status_transition
  before update on public.player_registrations
  for each row execute function public.registrations_status_transition();

-- registered_date default (BEFORE INSERT OR UPDATE): set automatically to the
-- club's current date the first time status is registered and the field is
-- empty; a supplied value (backfill, backdated paper registration, import) is
-- never overwritten.
create or replace function public.registrations_registered_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'registered' and new.registered_date is null then
    new.registered_date := (now() at time zone 'utc')::date;
  end if;
  return new;
end;
$$;

create trigger registrations_registered_date
  before insert or update on public.player_registrations
  for each row execute function public.registrations_registered_date();

-- Archived season immutability (BEFORE INSERT OR UPDATE). An archived season is
-- read only for registration content: no new registration, and no change to
-- status, shirt_number, registered_date or a team reassignment to a non null
-- team. A team_id change to null is allowed so the team deletion ON DELETE SET
-- NULL cascade still turns archived registrations Unassigned, and DELETE is not
-- guarded so the players.delete erasure cascade can remove a child's rows
-- across every season. Refusals raise P0001.
create or replace function public.registrations_guard_archived()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_archived boolean;
begin
  select (s.archived_at is not null) into v_archived
    from public.seasons s where s.id = new.season_id;
  if not coalesce(v_archived, false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'player_registrations: cannot add a registration to an archived season'
      using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     or new.shirt_number is distinct from old.shirt_number
     or new.registered_date is distinct from old.registered_date
     or (new.team_id is distinct from old.team_id and new.team_id is not null) then
    raise exception 'player_registrations: an archived season is read only'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger registrations_guard_archived
  before insert or update on public.player_registrations
  for each row execute function public.registrations_guard_archived();

-- ---------------------------------------------------------------------
-- The identity <-> registration invariant, enforced for EVERY writer, not only
-- the app hooks. A committed players row must have at least one registration.
-- A DEFERRABLE INITIALLY DEFERRED constraint trigger checks this at transaction
-- commit, so both halves of a legitimate create have landed by then:
--   * add_player inserts the identity and its current-season registration in
--     one transaction -> passes;
--   * a legacy shape insert fires the AFTER INSERT compatibility trigger, which
--     inserts the current-season registration in the same transaction -> passes;
--   * a direct null/null insert into players from any players.manage holder
--     (which the RLS insert policy permits) creates no registration -> fails at
--     commit, so it can never leave an orphan identity invisible to usePlayers.
-- The check is club-safe (it looks up only the inserted row's own id) and
-- schema-qualified. It fires only for rows INSERTed within a transaction, so the
-- backfill (which inserts registrations, not players) never triggers it, and the
-- already-registered existing players are untouched.
-- ---------------------------------------------------------------------
create or replace function public.players_require_registration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.player_registrations r where r.player_id = new.id
  ) then
    raise exception 'players: a player identity must have at least one registration (id %)', new.id
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger players_require_registration
  after insert on public.players
  deferrable initially deferred
  for each row execute function public.players_require_registration();

-- =====================================================================
-- PART 3: backfill every existing players row into one current season
-- registration. Runs BEFORE the audit triggers attach, so the backfill writes
-- no audit events; the migration itself is the record.
-- =====================================================================
insert into public.player_registrations
  (club_id, player_id, season_id, team_id, status, shirt_number, registered_date,
   created_by, created_at, updated_at, updated_by)
select
  p.club_id,
  p.id,
  (select s.id from public.seasons s where s.club_id = p.club_id and s.is_current),
  p.team_id,
  'registered',
  p.shirt_number,
  p.created_at::date,
  case when exists (select 1 from public.profiles pr where pr.id = p.created_by)
    then p.created_by else null end,
  p.created_at,
  p.created_at,
  null
from public.players p
where not exists (
  select 1 from public.player_registrations r
  where r.player_id = p.id
    and r.season_id = (select s.id from public.seasons s where s.club_id = p.club_id and s.is_current)
);

-- Prove the backfill before anything else can run.
do $$
declare
  v_players integer;
  v_regs integer;
  v_missing integer;
  v_dupes integer;
begin
  select count(*) into v_players from public.players;
  select count(*) into v_regs from public.player_registrations;
  if v_regs <> v_players then
    raise exception 'backfill: registration count % does not equal player count %', v_regs, v_players;
  end if;

  -- No player without a current season registration.
  select count(*) into v_missing
  from public.players p
  where not exists (
    select 1 from public.player_registrations r
    join public.seasons s on s.id = r.season_id
    where r.player_id = p.id and s.is_current and s.club_id = p.club_id
  );
  if v_missing > 0 then
    raise exception 'backfill: % player(s) have no current season registration', v_missing;
  end if;

  -- No duplicate registration per player and season (the unique constraint
  -- guarantees it; assert as belt and braces).
  select count(*) into v_dupes from (
    select player_id, season_id from public.player_registrations
    group by player_id, season_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'backfill: % duplicate player/season registration(s)', v_dupes;
  end if;

  -- Every registration's club matches its player, season and team.
  if exists (
    select 1 from public.player_registrations r
    join public.players p on p.id = r.player_id
    where p.club_id <> r.club_id
  ) then
    raise exception 'backfill: a registration club does not match its player club';
  end if;

  -- No audit event was written by the backfill (triggers attach below).
  if exists (select 1 from public.audit_events where entity_type = 'player') then
    raise exception 'backfill: player audit events exist before the triggers attach';
  end if;
end
$$;

-- =====================================================================
-- PART 4: audit triggers, attached AFTER the backfill.
-- =====================================================================

-- Player identity audit (AFTER INSERT OR UPDATE OR DELETE).
--   INSERT -> player.created
--   UPDATE -> player.updated, ONLY when display_name changed (changed_fields
--             = ['display_name'], NO name value anywhere); other identity
--             updates (a frozen column legacy translation, a created_by null
--             cascade, the touch fields) write no player event, because the
--             canonical registration change is audited on its own table.
--   DELETE -> player.deleted (entity id retained, no name).
create or replace function public.audit_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_club       uuid;
  v_entity     uuid;
  v_action     text;
  v_changed    text[] := null;
begin
  if tg_op = 'INSERT' then
    v_club := new.club_id; v_entity := new.id; v_action := 'player.created';
  elsif tg_op = 'DELETE' then
    v_club := old.club_id; v_entity := old.id; v_action := 'player.deleted';
  else
    if new.display_name is distinct from old.display_name then
      v_club := new.club_id; v_entity := new.id;
      v_action := 'player.updated'; v_changed := array['display_name'];
    else
      return new;  -- no audited identity change
    end if;
  end if;

  -- During a clubs cascade the whole tenancy, including its audit trail, is
  -- being removed and the club row is already gone; skip the event rather than
  -- violate the audit_events club foreign key (the event would cascade-delete
  -- with the club anyway).
  if not exists (select 1 from public.clubs c where c.id = v_club) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_actor is not null then
    select pr.full_name into v_actor_name from public.profiles pr where pr.id = v_actor;
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, source, changed_fields, batch_id
  )
  values (
    v_club, now(), v_actor, v_actor_name, v_action, 'player',
    v_entity, public.audit_source_context(v_actor), v_changed, public.audit_batch_context()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_players
  after insert or update or delete on public.players
  for each row execute function public.audit_players();

-- Registration audit (AFTER INSERT OR UPDATE OR DELETE). Registration changes
-- surface as PLAYER events (entity_type 'player', entity_id the player id).
--   INSERT -> player.registration_created, or player.renewed when the
--             transaction local source is 'renewal' (the PR 6 renewal flow).
--   UPDATE -> ONE event by precedence (docs/security/app-audit-boundary.md,
--             refined to one semantic event per UPDATE per the PR 2 brief):
--               status -> withdrawn         : player.withdrawn
--               status leaves withdrawn     : player.restored
--               any other status change     : player.status_changed
--               team_id change (no status)  : player.team_changed
--               shirt/registered_date only  : player.registration_updated
--             All changed safe fields still populate changed_fields and
--             safe_changes.
--   DELETE -> when the parent identity is gone (the players.delete cascade),
--             no event (the player.deleted covers it); when the parent
--             survives (a data repair), player.registration_updated.
create or replace function public.audit_registrations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_club       uuid;
  v_player     uuid;
  v_season     uuid;
  v_team       uuid;
  v_action     text;
  v_changed    text[] := '{}';
  v_safe       jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    -- A cascade from player.deleted leaves no parent; emit nothing.
    if not exists (select 1 from public.players p where p.id = old.player_id) then
      return old;
    end if;
    v_club := old.club_id; v_player := old.player_id; v_season := old.season_id; v_team := old.team_id;
    v_action := 'player.registration_updated';
  elsif tg_op = 'INSERT' then
    v_club := new.club_id; v_player := new.player_id; v_season := new.season_id; v_team := new.team_id;
    if public.audit_source_context(v_actor) = 'renewal' then
      v_action := 'player.renewed';
    else
      v_action := 'player.registration_created';
    end if;
    v_safe := jsonb_build_object(
      'season_id', jsonb_build_object('new', new.season_id),
      'status',    jsonb_build_object('new', new.status)
    );
    v_changed := array['season_id', 'status'];
    if new.team_id is not null then
      v_safe := v_safe || jsonb_build_object('team_id', jsonb_build_object('new', new.team_id));
      v_changed := array_append(v_changed, 'team_id');
    end if;
    if new.shirt_number is not null then
      v_safe := v_safe || jsonb_build_object('shirt_number', jsonb_build_object('new', new.shirt_number));
      v_changed := array_append(v_changed, 'shirt_number');
    end if;
    if new.registered_date is not null then
      v_safe := v_safe || jsonb_build_object('registered_date', jsonb_build_object('new', new.registered_date));
      v_changed := array_append(v_changed, 'registered_date');
    end if;
  else
    -- UPDATE. Collect all changed safe fields, then pick one action by precedence.
    v_club := new.club_id; v_player := new.player_id; v_season := new.season_id; v_team := new.team_id;
    if new.status is distinct from old.status then
      v_safe := v_safe || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      v_changed := array_append(v_changed, 'status');
    end if;
    if new.team_id is distinct from old.team_id then
      v_safe := v_safe || jsonb_build_object('team_id', jsonb_build_object('old', old.team_id, 'new', new.team_id));
      v_changed := array_append(v_changed, 'team_id');
    end if;
    if new.shirt_number is distinct from old.shirt_number then
      v_safe := v_safe || jsonb_build_object('shirt_number', jsonb_build_object('old', old.shirt_number, 'new', new.shirt_number));
      v_changed := array_append(v_changed, 'shirt_number');
    end if;
    if new.registered_date is distinct from old.registered_date then
      v_safe := v_safe || jsonb_build_object('registered_date', jsonb_build_object('old', old.registered_date, 'new', new.registered_date));
      v_changed := array_append(v_changed, 'registered_date');
    end if;
    if array_length(v_changed, 1) is null then
      return new;  -- only touch fields changed; no audited change
    end if;
    -- One semantic event per UPDATE, by precedence.
    if new.status is distinct from old.status then
      if new.status = 'withdrawn' then
        v_action := 'player.withdrawn';
      elsif old.status = 'withdrawn' then
        v_action := 'player.restored';
      else
        v_action := 'player.status_changed';
      end if;
    elsif new.team_id is distinct from old.team_id then
      v_action := 'player.team_changed';
    else
      v_action := 'player.registration_updated';
    end if;
  end if;

  -- Skip during a clubs cascade (see audit_players): the club is already gone.
  if not exists (select 1 from public.clubs c where c.id = v_club) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_actor is not null then
    select pr.full_name into v_actor_name from public.profiles pr where pr.id = v_actor;
  end if;

  insert into public.audit_events (
    club_id, occurred_at, actor_id, actor_name, action, entity_type,
    entity_id, season_id, team_id, source, changed_fields, safe_changes, batch_id
  )
  values (
    v_club, now(), v_actor, v_actor_name, v_action, 'player',
    v_player, v_season, v_team, public.audit_source_context(v_actor),
    nullif(v_changed, '{}'), nullif(v_safe, '{}'::jsonb), public.audit_batch_context()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_registrations
  after insert or update or delete on public.player_registrations
  for each row execute function public.audit_registrations();

-- =====================================================================
-- PART 5: legacy compatibility triggers on players, attached AFTER the backfill
-- (so the backfill itself, which touches only player_registrations, never fires
-- them). They translate an old or cached client's legacy shape write into
-- canonical registration data, atomically and audited.
-- =====================================================================

-- Legacy INSERT (AFTER INSERT). An old client inserts into players carrying
-- team_id and/or shirt_number and no registration. Create the current season
-- registration from those frozen values, status registered (today's behaviour).
-- The new path (add_player) writes NULL frozen columns, so its identity insert
-- does not match this predicate and is never translated here; add_player
-- creates its own registration. Fail closed: a legacy insert with no current
-- season raises rather than leaving an orphan identity.
create or replace function public.players_legacy_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
begin
  if new.team_id is null and new.shirt_number is null then
    return new;  -- the canonical add_player path; nothing to translate
  end if;
  select s.id into v_season from public.seasons s
    where s.club_id = new.club_id and s.is_current;
  if v_season is null then
    raise exception 'players: cannot create a legacy player, the club has no current season'
      using errcode = 'P0001';
  end if;
  insert into public.player_registrations
    (club_id, player_id, season_id, team_id, status, shirt_number, created_by)
    values (new.club_id, new.id, v_season, new.team_id, 'registered', new.shirt_number, new.created_by)
    on conflict (player_id, season_id) do nothing;
  return new;
end;
$$;

create trigger players_legacy_insert
  after insert on public.players
  for each row execute function public.players_legacy_insert();

-- Legacy UPDATE (AFTER UPDATE). An old client updates the frozen team_id or
-- shirt_number on players. Translate into the current season registration so
-- the canonical value never silently diverges. A team_id change to null is a
-- team deletion cascade, handled by the registration's own ON DELETE SET NULL
-- (its audit fires there), so it is skipped here to avoid a double event. A
-- display_name change is an identity change audited by audit_players; it needs
-- no translation. Writing only to player_registrations (never back to players)
-- means the trigger cannot re fire itself.
create or replace function public.players_legacy_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
begin
  if new.shirt_number is not distinct from old.shirt_number
     and new.team_id is not distinct from old.team_id then
    return new;  -- no frozen column change to translate
  end if;
  select s.id into v_season from public.seasons s
    where s.club_id = new.club_id and s.is_current;
  if v_season is null then
    return new;  -- no current season; nothing canonical to update
  end if;
  if new.shirt_number is distinct from old.shirt_number then
    update public.player_registrations r
      set shirt_number = new.shirt_number
      where r.player_id = new.id and r.season_id = v_season
        and r.shirt_number is distinct from new.shirt_number;
  end if;
  if new.team_id is distinct from old.team_id and new.team_id is not null then
    update public.player_registrations r
      set team_id = new.team_id
      where r.player_id = new.id and r.season_id = v_season
        and r.team_id is distinct from new.team_id;
  end if;
  return new;
end;
$$;

create trigger players_legacy_update
  after update on public.players
  for each row execute function public.players_legacy_update();

-- =====================================================================
-- PART 6: RPCs.
-- =====================================================================

-- add_player: the only new client creation path. SECURITY INVOKER (the
-- deliberate exception to the programme's definer RPCs) with set search_path =
-- '' and EXECUTE for authenticated, so the players and registration RLS
-- policies bind both inserts directly and no new definer surface is added. It
-- commits the identity and its current season registration in one transaction:
-- neither can exist without the other. A client minted p_id makes an ambiguous
-- lost response retry idempotent (ON CONFLICT DO NOTHING reuses the same
-- identity rather than duplicating the child). Cross club id injection fails
-- closed. Returns the adapted legacy Player shape the temporary Roster and
-- board seeding consume.
create or replace function public.add_player(
  p_id              uuid,
  p_display_name    text,
  p_team_id         uuid  default null,
  p_shirt_number    int   default null,
  p_status          text  default 'pending',
  p_registered_date date  default null
)
returns table (id uuid, team_id uuid, display_name text, shirt_number int, created_by uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_club   uuid := public.my_club();
  v_season uuid;
  v_player uuid := coalesce(p_id, pg_catalog.gen_random_uuid());
begin
  if v_actor is null or v_club is null then
    raise exception 'add_player: not signed in to a club' using errcode = '42501';
  end if;
  select s.id into v_season from public.seasons s
    where s.club_id = v_club and s.is_current;
  if v_season is null then
    raise exception 'add_player: the club has no current season' using errcode = 'P0001';
  end if;

  -- Identity. RLS enforces players.manage and pins created_by. ON CONFLICT
  -- DO NOTHING makes a same id retry reuse the committed identity.
  insert into public.players (id, club_id, display_name, created_by)
    values (v_player, v_club, p_display_name, v_actor)
    on conflict on constraint players_pkey do nothing;
  -- Confirm the identity is in the caller's club (a cross club id fails here).
  if not exists (select 1 from public.players p where p.id = v_player and p.club_id = v_club) then
    raise exception 'add_player: player id is not in your club' using errcode = '42501';
  end if;

  -- Registration for the current season. ON CONFLICT keeps the retry idempotent.
  insert into public.player_registrations
    (club_id, player_id, season_id, team_id, status, shirt_number, registered_date, created_by)
    values (v_club, v_player, v_season, p_team_id, p_status, p_shirt_number, p_registered_date, v_actor)
    on conflict (player_id, season_id) do nothing;

  return query
    select p.id, r.team_id, p.display_name, r.shirt_number, p.created_by
    from public.players p
    join public.player_registrations r on r.player_id = p.id and r.season_id = v_season
    where p.id = v_player;
end;
$$;

comment on function public.add_player(uuid, text, uuid, int, text, date) is
  $$The only new client path to create a registered player: SECURITY INVOKER, atomically inserts the stable identity and its current season registration under the caller's players.manage RLS, returns the adapted legacy Player shape. A client minted p_id makes a lost response retry idempotent. See 0032_registered_players.sql and docs/roadmaps/registered-players-delivery-plan.md.$$;

revoke execute on function public.add_player(uuid, text, uuid, int, text, date) from public, anon;
grant execute on function public.add_player(uuid, text, uuid, int, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- update_player: the transactional edit path for the interim Roster. The old
-- useUpdatePlayer wrote the identity rename and the current-season shirt in two
-- separate PostgREST calls, so a failure after the first left a partial change.
-- This RPC does both in ONE transaction (all or nothing) and never touches the
-- frozen players.team_id / players.shirt_number columns.
--
-- SECURITY INVOKER + set search_path = '': the players and registration UPDATE
-- policies (players.manage, club scoped) bind directly, so no new definer
-- surface is added. actor and club are derived server side. Only fields
-- deliberately supplied change: p_display_name null leaves the name; p_set_shirt
-- false leaves the shirt (p_set_shirt true sets it, and null clears it).
--
-- Concurrency with activate_season: the RPC takes the same per club advisory
-- lock activate_season uses, so an activation cannot run mid edit, and it
-- refuses when the caller's displayed season (p_expected_season) is no longer
-- the current season. Together these stop a shirt edit ever landing on a
-- different (or freshly archived) season than the screen showed.
--
-- Fail closed: a cross club id, a missing player, a missing current-season
-- registration, or an update that matches zero rows all raise rather than
-- reporting a false success. A retry with the same values changes nothing and
-- emits no audit event (each UPDATE is a no-op the audit triggers ignore).
-- ---------------------------------------------------------------------
create or replace function public.update_player(
  p_id              uuid,
  p_expected_season uuid,
  p_display_name    text    default null,
  p_set_shirt       boolean default false,
  p_shirt_number    int     default null
)
returns table (id uuid, team_id uuid, display_name text, shirt_number int, created_by uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_club   uuid := public.my_club();
  v_season uuid;
  v_reg    uuid;
begin
  if v_actor is null or v_club is null then
    raise exception 'update_player: not signed in to a club' using errcode = '42501';
  end if;
  if not public.has_perm('players.manage') then
    raise exception 'update_player: requires the players.manage capability' using errcode = '42501';
  end if;

  -- Serialise with activate_season on the same key, so the current season
  -- cannot change while this edit runs.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('otj.season_activation:' || v_club::text));

  select s.id into v_season from public.seasons s
    where s.club_id = v_club and s.is_current;
  if v_season is null then
    raise exception 'update_player: the club has no current season' using errcode = 'P0001';
  end if;
  if p_expected_season is not null and p_expected_season <> v_season then
    raise exception 'update_player: the current season changed; reload and retry' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.players p where p.id = p_id and p.club_id = v_club) then
    raise exception 'update_player: player is not in your club' using errcode = '42501';
  end if;
  select r.id into v_reg from public.player_registrations r
    where r.player_id = p_id and r.season_id = v_season and r.club_id = v_club;
  if v_reg is null then
    raise exception 'update_player: no current season registration for this player' using errcode = 'P0001';
  end if;

  if p_display_name is not null then
    update public.players p set display_name = p_display_name
      where p.id = p_id and p.club_id = v_club;
    if not found then
      raise exception 'update_player: the identity update matched no row' using errcode = '42501';
    end if;
  end if;

  if p_set_shirt then
    update public.player_registrations r set shirt_number = p_shirt_number
      where r.id = v_reg and r.club_id = v_club;
    if not found then
      raise exception 'update_player: the registration update matched no row' using errcode = '42501';
    end if;
  end if;

  return query
    select p.id, r.team_id, p.display_name, r.shirt_number, p.created_by
    from public.players p
    join public.player_registrations r on r.player_id = p.id and r.season_id = v_season
    where p.id = p_id;
end;
$$;

comment on function public.update_player(uuid, uuid, text, boolean, int) is
  $$The transactional interim edit path: SECURITY INVOKER, atomically renames the stable identity and/or updates the current-season registration shirt under the caller's players.manage RLS, never touching the frozen players columns. Takes the same per club advisory lock as activate_season and refuses when p_expected_season is no longer current, so a concurrent activation cannot redirect the edit. Fails closed on cross club, missing or zero-row updates. See 0032_registered_players.sql.$$;

revoke execute on function public.update_player(uuid, uuid, text, boolean, int) from public, anon;
grant execute on function public.update_player(uuid, uuid, text, boolean, int) to authenticated;

-- player_history: the database read path for the future per player History
-- modal. SECURITY DEFINER (it reads audit_events, whose select policy the gate
-- re checks) with set search_path = '' and EXECUTE for authenticated, self
-- gating on audit.view per the History access decision (managers and admins
-- hold audit.view; coaches do not see historical audit records by default). It
-- is club scoped, censors a cross club id by returning nothing, returns only
-- approved audit fields (never a child name; safe_changes carries none by
-- construction), orders newest first with a deterministic id tiebreak, and
-- bounds pagination. No History UI ships in this PR.
create or replace function public.player_history(
  p_player_id uuid,
  p_limit     int default 50,
  p_offset    int default 0
)
returns table (
  id             uuid,
  occurred_at    timestamptz,
  actor_id       uuid,
  actor_name     text,
  action         text,
  entity_id      uuid,
  season_id      uuid,
  team_id        uuid,
  source         text,
  changed_fields text[],
  safe_changes   jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid := public.my_club();
  v_lim  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off  int  := greatest(coalesce(p_offset, 0), 0);
begin
  if v_club is null or not public.has_perm('audit.view') then
    raise exception 'player_history: requires the audit.view capability' using errcode = '42501';
  end if;
  -- Club scoped: an id outside the caller's club returns nothing (censored).
  if not exists (select 1 from public.players p where p.id = p_player_id and p.club_id = v_club) then
    return;
  end if;
  return query
    select ae.id, ae.occurred_at, ae.actor_id, ae.actor_name, ae.action, ae.entity_id,
           ae.season_id, ae.team_id, ae.source, ae.changed_fields, ae.safe_changes
    from public.audit_events ae
    where ae.club_id = v_club
      and ae.entity_type = 'player'
      and ae.entity_id = p_player_id
    order by ae.occurred_at desc, ae.id desc
    limit v_lim offset v_off;
end;
$$;

comment on function public.player_history(uuid, int, int) is
  $$The database read path for a player's audit history: SECURITY DEFINER, self gates on audit.view (History access decision), club scoped and censoring cross club ids, returns only approved audit fields (never a child name), newest first with an id tiebreak, bounded pagination. No History UI ships in PR 2. See 0032_registered_players.sql and docs/security/app-audit-boundary.md.$$;

revoke execute on function public.player_history(uuid, int, int) from public, anon;
grant execute on function public.player_history(uuid, int, int) to authenticated;

-- =====================================================================
-- PART 7: self verification. Aborts the migration unless the end state is
-- exactly as intended. Written so grant and data assertions are vacuous on a
-- fresh local reset (zero clubs, zero players at migration time) and strict on
-- the hosted project.
-- =====================================================================
do $$
declare
  v_bad integer;
begin
  -- Tables exist with RLS enabled.
  if to_regclass('public.player_registrations') is null then
    raise exception 'registrations: the table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.player_registrations'::regclass) then
    raise exception 'registrations: row level security is not enabled';
  end if;

  -- players is nullable/SET NULL on created_by and team_id now.
  if (select attnotnull from pg_attribute where attrelid = 'public.players'::regclass and attname = 'created_by') then
    raise exception 'players: created_by must be nullable';
  end if;
  if (select attnotnull from pg_attribute where attrelid = 'public.players'::regclass and attname = 'team_id') then
    raise exception 'players: team_id must be nullable (frozen compatibility column)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'players_created_by_fkey' and confdeltype = 'n'  -- 'n' = SET NULL
  ) then
    raise exception 'players: created_by must be ON DELETE SET NULL';
  end if;

  -- Grants: authenticated holds SELECT, INSERT, UPDATE only. NOT DELETE (a
  -- registration is removed only through the players.delete identity cascade,
  -- never directly, so an identity cannot be orphaned by losing its last
  -- registration) and NOT TRUNCATE; anon holds nothing.
  if not (has_table_privilege('authenticated', 'public.player_registrations', 'SELECT')
          and has_table_privilege('authenticated', 'public.player_registrations', 'INSERT')
          and has_table_privilege('authenticated', 'public.player_registrations', 'UPDATE')) then
    raise exception 'registrations: authenticated is missing an intended grant (select/insert/update)';
  end if;
  if has_table_privilege('authenticated', 'public.player_registrations', 'DELETE')
     or has_table_privilege('authenticated', 'public.player_registrations', 'TRUNCATE') then
    raise exception 'registrations: authenticated must not hold DELETE or TRUNCATE';
  end if;
  if has_table_privilege('anon', 'public.player_registrations', 'SELECT') then
    raise exception 'registrations: anon must hold no grant';
  end if;

  -- No delete policy on player_registrations.
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'player_registrations' and cmd = 'DELETE') then
    raise exception 'registrations: there must be no delete policy';
  end if;

  -- The identity <-> registration invariant is a deferred constraint trigger.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'players' and t.tgname = 'players_require_registration'
      and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
  ) then
    raise exception 'players: the deferred require-registration constraint trigger is missing';
  end if;

  -- RPC EXECUTE: add_player and player_history for authenticated not anon.
  if not has_function_privilege('authenticated', 'public.add_player(uuid, text, uuid, int, text, date)', 'EXECUTE') then
    raise exception 'add_player: authenticated cannot execute';
  end if;
  if has_function_privilege('anon', 'public.add_player(uuid, text, uuid, int, text, date)', 'EXECUTE') then
    raise exception 'add_player: anon must not execute';
  end if;
  if not has_function_privilege('authenticated', 'public.player_history(uuid, int, int)', 'EXECUTE') then
    raise exception 'player_history: authenticated cannot execute';
  end if;
  if has_function_privilege('anon', 'public.player_history(uuid, int, int)', 'EXECUTE') then
    raise exception 'player_history: anon must not execute';
  end if;
  if not has_function_privilege('authenticated', 'public.update_player(uuid, uuid, text, boolean, int)', 'EXECUTE') then
    raise exception 'update_player: authenticated cannot execute';
  end if;
  if has_function_privilege('anon', 'public.update_player(uuid, uuid, text, boolean, int)', 'EXECUTE') then
    raise exception 'update_player: anon must not execute';
  end if;
  -- The provenance classifier is private to the definer touch triggers.
  if has_function_privilege('anon', 'public.provenance_change_is_cascade(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.provenance_change_is_cascade(uuid, uuid)', 'EXECUTE') then
    raise exception 'provenance_change_is_cascade: must not be executable by clients';
  end if;

  -- Policies present. player_registrations now has three (no delete policy);
  -- players keeps four (select/insert/update/delete).
  if (select count(*) from pg_policies where tablename = 'player_registrations') <> 3 then
    raise exception 'registrations: expected three RLS policies (no delete)';
  end if;
  if (select count(*) from pg_policies where tablename = 'players') <> 4 then
    raise exception 'players: expected four RLS policies after re gating';
  end if;

  -- Triggers present on players (touch, audit, legacy insert, legacy update).
  if (select count(*) from pg_trigger where tgrelid = 'public.players'::regclass and not tgisinternal) < 4 then
    raise exception 'players: expected the touch, audit and two legacy triggers';
  end if;

  -- Backfill invariant holds on hosted (vacuous locally): every player has
  -- exactly one current season registration.
  select count(*) into v_bad
  from public.players p
  where (select count(*) from public.player_registrations r
         join public.seasons s on s.id = r.season_id
         where r.player_id = p.id and s.is_current and s.club_id = p.club_id) <> 1;
  if v_bad > 0 then
    raise exception 'registrations: % player(s) lack exactly one current season registration', v_bad;
  end if;
end
$$;
