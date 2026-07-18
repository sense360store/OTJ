-- =====================================================================
-- OTJ Training Hub, migration 0033_players_legacy_columns: drop the PR 2
-- compatibility seam (Registered Players PR 3, the single destructive step)
--
-- REVIEW REQUIRED, and DESTRUCTIVE. This migration removes the fail closed
-- compatibility seam that 0032 put in place: the two legacy translation
-- triggers on public.players and the frozen public.players.team_id and
-- public.players.shirt_number columns. It is the one destructive step of the
-- whole Registered Players programme.
--
-- DO NOT APPLY DURING PR REVIEW. This file ships in the PR 3 branch but stays
-- UNAPPLIED. The sequence (docs/roadmaps/registered-players-delivery-plan.md,
-- PR 3 rollout order) is: merge and deploy the Registered players page, run it
-- live for a verification period so any old or cached client has aged out, and
-- ONLY THEN confirm the ledger slot and apply this by hand via the connector.
-- The deferred drop keeps the deepest UI rollback lever (a pre seam build that
-- reads the frozen columns) available until the new page has bedded in. The
-- PR 2 build remains the rollback floor before this applies; the PR 3 build is
-- the floor after. There is no down migration; recovery within the apply window
-- is PITR restore per the 0028 procedure.
--
-- Numbering: confirmed 0033. At authoring time the files on disk ended at
-- 0032_registered_players.sql and the live hosted ledger ended at
-- registered_players (0031 seasons and 0032 registered_players were applied in
-- the PR 2 hosted rollout), so 0033 is the next free slot from BOTH sources.
-- Per the standing rule the ledger is the authority; confirm 0033 is still free
-- against the live ledger immediately before applying, because between PR 3's
-- merge and this late apply a merged but unapplied migration still counts as a
-- taken slot (delivery plan).
--
-- WHY IT IS SAFE. The 0032 compatibility trigger translated every legacy shape
-- write from an old or cached client into a valid, audited identity plus
-- current season registration, so no legacy write ever created an orphan
-- identity or an unaudited row. The new frontend never reads or writes the
-- frozen columns (usePlayers and the Registered players page read
-- player_registrations, never players.team_id / players.shirt_number), so once
-- old clients have aged out the seam has no remaining reader or writer. The
-- preflight below is the belt and braces proof before the drop.
--
-- WHAT THIS DELIBERATELY IS NOT. It does not touch player_registrations (its
-- team_id and shirt_number are the canonical seasonal values and stay), does
-- not change any RLS policy, grant, RPC or audit trigger, and removes no child
-- data: every child's name (public.players.display_name) and every registration
-- is untouched. It only removes the now dead compatibility scaffolding.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Preflight, verified inside the migration BEFORE anything is dropped, so a
-- failed check aborts the whole migration and drops nothing. The compatibility
-- trigger guaranteed every legacy insert created a registration, so this should
-- always pass; it is belt and braces against ever dropping the seam while a
-- player identity still depends on it.
-- ---------------------------------------------------------------------
do $$
declare
  v_orphans integer;
begin
  -- No player identity may lack a registration in ANY season. An identity with
  -- zero registrations would become permanently invisible to usePlayers and the
  -- Registered players page once the frozen columns (the last legacy read
  -- fallback) are gone, so refuse the drop if one exists.
  select count(*) into v_orphans
  from public.players p
  where not exists (select 1 from public.player_registrations r where r.player_id = p.id);
  if v_orphans > 0 then
    raise exception '0033 preflight: % player identity(ies) have no registration in any season; aborting the legacy column drop', v_orphans;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Drop the compatibility triggers first (they depend on their functions), then
-- the functions. IF EXISTS so a re-run or a stack that never had them is a
-- no-op.
-- ---------------------------------------------------------------------
drop trigger if exists players_legacy_insert on public.players;
drop trigger if exists players_legacy_update on public.players;

drop function if exists public.players_legacy_insert();
drop function if exists public.players_legacy_update();

-- ---------------------------------------------------------------------
-- Drop the frozen legacy columns. Dropping the column also drops its FK
-- (players_team_id_fkey) and its comment. The canonical team and shirt live on
-- player_registrations and are untouched.
-- ---------------------------------------------------------------------
alter table public.players
  drop column if exists team_id,
  drop column if exists shirt_number;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the migration unless the end state is exactly as
-- intended: both frozen columns gone, both legacy triggers gone, both legacy
-- functions gone, and (unchanged) every player identity still has at least one
-- registration.
-- ---------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.players'::regclass and attname in ('team_id', 'shirt_number') and not attisdropped
  ) then
    raise exception '0033: the frozen players.team_id / players.shirt_number columns were not dropped';
  end if;

  if exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'players' and t.tgname in ('players_legacy_insert', 'players_legacy_update') and not t.tgisinternal
  ) then
    raise exception '0033: a legacy compatibility trigger survives on players';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('players_legacy_insert', 'players_legacy_update')
  ) then
    raise exception '0033: a legacy compatibility function survives';
  end if;

  -- The invariant the whole feature rests on still holds after the drop.
  select count(*) into v_bad
  from public.players p
  where not exists (select 1 from public.player_registrations r where r.player_id = p.id);
  if v_bad > 0 then
    raise exception '0033: % player identity(ies) lack a registration after the drop', v_bad;
  end if;
end
$$;
