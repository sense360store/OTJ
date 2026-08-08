-- =====================================================================
-- OTJ Training Hub, migration 0045_spond_links: the player link table
-- and per event response rows of the amended Spond boundary
-- (training day logistics, PR 4)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free (apply order within the queue: 0043, 0044,
-- then this file). Do not auto-merge. No Edge Function changes
-- accompany this migration; the sync extension and linking function
-- arrive in the next PR and are useless without this schema, not the
-- other way round.
--
-- Numbering: provisional 0045. The files on disk end at
-- 0044_session_teams.sql (also unapplied, gated); the live ledger is
-- the authority.
--
-- WHAT THIS IS. The schema half of the owner decision of record in
-- docs/adr/ADR-0008-training-day-logistics.md, the amended children's
-- data boundary whose authoritative statement is
-- docs/security/spond-data-boundary.md. Two tables:
--
--   player_spond_links       one row links one player identity to one
--                            opaque Spond member id. The erasure pivot:
--                            severing it disconnects every stored Spond
--                            fact from a child.
--   spond_event_responses    one row per (event, linked member) with a
--                            status from the four Spond states. Written
--                            only by the sync path, which stores rows
--                            solely for member ids present in the link
--                            table; each sync replaces an event's rows.
--
-- THE BOUNDARY, STRUCTURALLY. Neither table has a name, contact or free
-- text payload column, and spond_member_id is constrained to an opaque
-- token character class (letters, digits, underscore, hyphen, at most
-- 64), so a name, an email or any other forbidden fragment does not fit
-- the one text column either: the forbidden list is unstorable here,
-- not merely unstored. status is constrained to the four Spond states.
-- Names in the app resolve exclusively through
-- public.players.display_name via the link. Rows referencing a player
-- are pseudonymous child data.
--
-- WHAT THIS DELIBERATELY IS NOT. No sync change, no linking function,
-- no linking screen, no register (PRs 5 to 7). Nothing reads or writes
-- these tables until those land.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The composite FK target on spond_events, the 0032 teams enabling step:
-- response rows reference (spond_event_id, club_id) so the row's club
-- must equal the event's club, declaratively for every writer.
-- ---------------------------------------------------------------------
alter table public.spond_events
  add constraint spond_events_id_club_unique unique (id, club_id);

-- ---------------------------------------------------------------------
-- player_spond_links. player_id is unique (a player has at most one
-- Spond identity) and spond_member_id is unique per club (a Spond
-- member links to at most one player), so the mapping is one to one.
-- The composite FK cascades with the player: erasing a child severs the
-- link atomically.
-- ---------------------------------------------------------------------
create table public.player_spond_links (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null,
  player_id       uuid not null,
  spond_member_id text not null check (spond_member_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  matched_by      text not null check (matched_by in ('auto', 'manual')),
  confirmed_at    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint player_spond_links_player_unique unique (player_id),
  constraint player_spond_links_member_unique_per_club unique (club_id, spond_member_id),
  constraint player_spond_links_player_fk
    foreign key (player_id, club_id) references public.players (id, club_id) on delete cascade
);
create index on public.player_spond_links (club_id);

comment on table public.player_spond_links is
  $$The link between a player identity and an opaque Spond member id (ADR-0008, docs/security/spond-data-boundary.md). Pseudonymous child data: the id resolves to a child only through players.display_name inside the app. The erasure pivot: deleting the player cascades this row, and the sync's linked only filter then drains the member's response rows at the next re-sync. No name, contact or payload column exists here by design.$$;

-- ---------------------------------------------------------------------
-- spond_event_responses. One row per (event, linked member); the status
-- vocabulary is exactly Spond's four response states. Cascades with the
-- event; each sync replaces the event's rows wholesale, so retention
-- equals the spond_events retention and the rows never drift from what
-- Spond currently says.
-- ---------------------------------------------------------------------
create table public.spond_event_responses (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null,
  spond_event_id  uuid not null,
  spond_member_id text not null check (spond_member_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  status          text not null check (status in ('accepted', 'declined', 'unanswered', 'waiting')),
  synced_at       timestamptz not null,
  constraint spond_event_responses_event_member_unique unique (spond_event_id, spond_member_id),
  constraint spond_event_responses_event_fk
    foreign key (spond_event_id, club_id) references public.spond_events (id, club_id) on delete cascade
);
create index on public.spond_event_responses (club_id);
create index on public.spond_event_responses (club_id, spond_member_id);

comment on table public.spond_event_responses is
  $$Per event response status for linked Spond members only (ADR-0008, docs/security/spond-data-boundary.md): the sync stores rows solely for member ids present in player_spond_links and discards the rest into the aggregate counts, exactly as before the amendment. Statuses are Spond's four states. No name, contact or payload column exists here by design; rows cascade with their event and every re-sync replaces them.$$;

-- ---------------------------------------------------------------------
-- RLS. Reads of both tables require players.view, the same gate as the
-- roster they resolve against; parents hold no capabilities and read
-- none of it. Link writes are roster curation (players.manage, with
-- created_by pinned on insert; the seeded coach role holds players.view
-- only, so linking is a manager and admin surface). Response writes are
-- the sync path's insert and delete only, gated sessions.create like
-- the spond_events writes (0013); the sync replaces an event's rows
-- wholesale, so no update path exists. Deliberately no FOR ALL
-- policies: the select gate must stay players.view, and a FOR ALL write
-- policy's using arm would open reads to the write capability as a
-- permissive OR.
-- ---------------------------------------------------------------------
alter table public.player_spond_links enable row level security;
alter table public.spond_event_responses enable row level security;

create policy "player_spond_links_select_view" on public.player_spond_links
  for select using ( club_id = public.my_club() and public.has_perm('players.view') );

create policy "player_spond_links_insert_manage" on public.player_spond_links
  for insert with check (
    club_id = public.my_club()
    and public.has_perm('players.manage')
    and created_by = auth.uid()
  );

create policy "player_spond_links_update_manage" on public.player_spond_links
  for update
  using ( club_id = public.my_club() and public.has_perm('players.manage') )
  with check ( club_id = public.my_club() and public.has_perm('players.manage') );

create policy "player_spond_links_delete_manage" on public.player_spond_links
  for delete using ( club_id = public.my_club() and public.has_perm('players.manage') );

create policy "spond_event_responses_select_view" on public.spond_event_responses
  for select using ( club_id = public.my_club() and public.has_perm('players.view') );

create policy "spond_event_responses_insert_sync" on public.spond_event_responses
  for insert with check ( club_id = public.my_club() and public.has_perm('sessions.create') );

create policy "spond_event_responses_delete_sync" on public.spond_event_responses
  for delete using ( club_id = public.my_club() and public.has_perm('sessions.create') );

revoke all on public.player_spond_links from anon, authenticated;
revoke all on public.spond_event_responses from anon, authenticated;
grant select, insert, update, delete on public.player_spond_links to authenticated;
-- No update grant and no update policy on responses: the sync replaces an
-- event's rows wholesale (delete then insert), so in place mutation stays
-- closed for everyone, least privilege by design.
grant select, insert, delete on public.spond_event_responses to authenticated;

-- ---------------------------------------------------------------------
-- Link immutability, the 0032 players_touch precedent. A link update may
-- change the member id (a re-link, audited below) and the match
-- bookkeeping, never which child it resolves to: re-pointing a link to
-- another player would silently move a child's stored Spond history to
-- a different child, so player_id is frozen and re-pointing is an
-- audited unlink plus an audited link. club_id and created_at are
-- immutable; created_by may only null through the genuine profile
-- deletion cascade.
-- ---------------------------------------------------------------------
create or replace function public.player_spond_links_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.player_id is distinct from old.player_id then
    raise exception 'player_spond_links: the link''s player cannot change; unlink and link again' using errcode = 'P0001';
  end if;
  if new.club_id is distinct from old.club_id or new.created_at is distinct from old.created_at then
    raise exception 'player_spond_links: club_id and created_at are immutable' using errcode = 'P0001';
  end if;
  if new.created_by is distinct from old.created_by
     and not public.provenance_change_is_cascade(old.created_by, new.created_by) then
    raise exception 'player_spond_links: created_by cannot be erased or re attributed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger player_spond_links_touch
  before update on public.player_spond_links
  for each row execute function public.player_spond_links_touch();

-- ---------------------------------------------------------------------
-- Audit, the 0037 pattern. Link create, re-link and unlink are player
-- events: pseudonymous child data changes a coach is accountable for.
-- The opaque member id is a VALUE and is never recorded; a re-link
-- records the field name only. An unlink caused by the player delete
-- cascade is covered by player.deleted and writes nothing. Response
-- rows are bulk sync output and carry no per row audit, mirroring
-- spond_events; the reserved spond.sync_completed summary action
-- remains available to the sync itself.
-- ---------------------------------------------------------------------
create or replace function public.audit_player_spond_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'player.spond_linked', 'player', new.player_id, null, null);
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.players p where p.id = old.player_id) then
      return old;
    end if;
    perform public.audit_domain_event(old.club_id, auth.uid(), 'player.spond_unlinked', 'player', old.player_id, null, null);
    return old;
  end if;
  if new.spond_member_id is distinct from old.spond_member_id then
    perform public.audit_domain_event(new.club_id, auth.uid(), 'player.spond_relinked', 'player', new.player_id, null, array['spond_member_id']);
  end if;
  return new;
end;
$$;

create trigger audit_player_spond_links
  after insert or update or delete on public.player_spond_links
  for each row execute function public.audit_player_spond_links();

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  if to_regclass('public.player_spond_links') is null
     or to_regclass('public.spond_event_responses') is null then
    raise exception 'spond_links: a table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.player_spond_links'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.spond_event_responses'::regclass) then
    raise exception 'spond_links: row level security is not enabled';
  end if;

  -- The boundary is structural: neither table may ever gain a column
  -- that could hold a name or contact. Pin the exact column sets.
  select count(*) into bad from information_schema.columns
  where table_schema = 'public' and table_name = 'player_spond_links'
    and column_name not in ('id', 'club_id', 'player_id', 'spond_member_id', 'matched_by', 'confirmed_at', 'created_by', 'created_at');
  if bad > 0 then
    raise exception 'spond_links: player_spond_links carries % unexpected column(s)', bad;
  end if;
  select count(*) into bad from information_schema.columns
  where table_schema = 'public' and table_name = 'spond_event_responses'
    and column_name not in ('id', 'club_id', 'spond_event_id', 'spond_member_id', 'status', 'synced_at');
  if bad > 0 then
    raise exception 'spond_links: spond_event_responses carries % unexpected column(s)', bad;
  end if;

  -- Grants: the four verbs for authenticated, nothing for anon, no
  -- TRUNCATE anywhere.
  if not (has_table_privilege('authenticated', 'public.player_spond_links', 'SELECT')
          and has_table_privilege('authenticated', 'public.player_spond_links', 'INSERT')
          and has_table_privilege('authenticated', 'public.player_spond_links', 'UPDATE')
          and has_table_privilege('authenticated', 'public.player_spond_links', 'DELETE')
          and has_table_privilege('authenticated', 'public.spond_event_responses', 'SELECT')
          and has_table_privilege('authenticated', 'public.spond_event_responses', 'INSERT')
          and has_table_privilege('authenticated', 'public.spond_event_responses', 'DELETE')) then
    raise exception 'spond_links: authenticated is missing an intended grant';
  end if;
  if has_table_privilege('authenticated', 'public.spond_event_responses', 'UPDATE') then
    raise exception 'spond_links: responses must carry no update grant (replace wholesale by design)';
  end if;
  if has_table_privilege('anon', 'public.player_spond_links', 'SELECT')
     or has_table_privilege('anon', 'public.spond_event_responses', 'SELECT') then
    raise exception 'spond_links: anon must hold no grant';
  end if;
  if has_table_privilege('authenticated', 'public.player_spond_links', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.spond_event_responses', 'TRUNCATE') then
    raise exception 'spond_links: authenticated must not hold TRUNCATE';
  end if;

  -- The composite FK target and the one to one link constraints exist.
  if not exists (select 1 from pg_constraint where conname = 'spond_events_id_club_unique') then
    raise exception 'spond_links: spond_events_id_club_unique is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_spond_links_player_unique')
     or not exists (select 1 from pg_constraint where conname = 'player_spond_links_member_unique_per_club') then
    raise exception 'spond_links: a link uniqueness constraint is missing';
  end if;

  -- Policies: four per table, and no FOR ALL policy (the select gate
  -- must stay players.view; a FOR ALL write arm would widen it).
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'player_spond_links';
  if bad <> 4 then
    raise exception 'spond_links: expected 4 player_spond_links policies, found %', bad;
  end if;
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'spond_event_responses';
  if bad <> 3 then
    raise exception 'spond_links: expected 3 spond_event_responses policies, found %', bad;
  end if;
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename in ('player_spond_links', 'spond_event_responses')
    and cmd = 'ALL';
  if bad > 0 then
    raise exception 'spond_links: FOR ALL policies are forbidden here, found %', bad;
  end if;

  -- The member id token pattern bites: a name shaped value is unstorable.
  if 'Jack Thompson' ~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'spond_links: the member id pattern must refuse spaces';
  end if;
  if not ('FAKE-MEMBER-1' ~ '^[A-Za-z0-9_-]{1,64}$') then
    raise exception 'spond_links: the member id pattern must accept opaque tokens';
  end if;

  -- The audit and immutability triggers are attached and the tables start
  -- empty.
  if not exists (select 1 from pg_trigger where tgname = 'audit_player_spond_links' and not tgisinternal) then
    raise exception 'spond_links: the audit trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'player_spond_links_touch' and not tgisinternal) then
    raise exception 'spond_links: the immutability trigger is missing';
  end if;
  if exists (select 1 from public.player_spond_links)
     or exists (select 1 from public.spond_event_responses) then
    raise exception 'spond_links: the tables must start empty';
  end if;
end
$$;
