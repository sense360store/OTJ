-- =====================================================================
-- OTJ Training Hub, migration 0046_register_entries: the Register's
-- persisted state (training day logistics, PR 7)
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after line by line review, and only once the live ledger is confirmed
-- to have this slot free (apply order within the queue: 0043, 0044,
-- 0045, then this file). Do not auto-merge. No Edge Function changes
-- accompany this migration.
--
-- Numbering: provisional 0046. The files on disk end at
-- 0045_spond_links.sql (also unapplied, gated); the live ledger is the
-- authority.
--
-- WHAT THIS IS. The Register (ADR-0008): on the day, a coach ticks off
-- arrivals against the players of the session's covered teams. One row
-- per (session, player): whether they are present, an optional per
-- session bib colour override, and whether the row came from the normal
-- Spond backed flow or a quick add for a player who turned up without
-- an RSVP. RSVP is never attendance: the screen lists every player of
-- the covered teams whatever Spond says; these rows only record what
-- the coach ticked.
--
-- CHILD DATA POSTURE. Rows reference a player identity and are
-- pseudonymous child data (docs/security/spond-data-boundary.md): no
-- name column exists here, names resolve through the players.view
-- gated read, and rows cascade with the player (erasure) and with the
-- session (cleanup). Per ADR-0008's recorded default, ticks are NOT
-- audited per row: the register row is the record, like the kit check
-- offs; an arrivals trail would be a catalogue decision of its own.
-- =====================================================================

create table public.register_entries (
  id                  uuid primary key default gen_random_uuid(),
  club_id             uuid not null,
  session_id          uuid not null,
  player_id           uuid not null,
  present             boolean not null default false,
  bib_colour_override text check (bib_colour_override is null or char_length(bib_colour_override) between 1 and 20),
  source              text not null default 'spond' check (source in ('spond', 'manual')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint register_entries_session_player_unique unique (session_id, player_id),
  constraint register_entries_session_fk
    foreign key (session_id, club_id) references public.sessions (id, club_id) on delete cascade,
  constraint register_entries_player_fk
    foreign key (player_id, club_id) references public.players (id, club_id) on delete cascade
);
create index on public.register_entries (club_id);
create index on public.register_entries (player_id);

comment on table public.register_entries is
  $$The Register's per (session, player) state (ADR-0008): present, an optional bib colour override, and the row's source (spond backed flow, or a manual quick add). Pseudonymous child data: no name column, names resolve through the players.view gated read; rows cascade with the player and the session. Ticks are not audited per row by recorded ADR-0008 default.$$;

-- ---------------------------------------------------------------------
-- Identity immutability. A row is per (session, player); edits change
-- present and the bib only. The 0032 touch convention, refusals P0001.
-- ---------------------------------------------------------------------
create or replace function public.register_entries_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.player_id is distinct from old.player_id
     or new.club_id is distinct from old.club_id
     or new.created_at is distinct from old.created_at then
    raise exception 'register_entries: the row''s session, player and club are immutable' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger register_entries_touch
  before update on public.register_entries
  for each row execute function public.register_entries_touch();

-- ---------------------------------------------------------------------
-- RLS. Reads take players.view like every child adjacent read of the
-- programme; parents hold no capabilities and read none of it. Writes
-- take sessions.create, club scoped: any coach marks arrivals at a
-- whole club slot, not only the session's owner (ADR-0008). No FOR ALL
-- policies, so the players.view select gate cannot widen. Note the
-- upsert path: ON CONFLICT DO UPDATE also checks the existing row
-- against the SELECT policies, so ticking effectively needs
-- players.view AND sessions.create; every seeded writer role holds
-- both, and the Register screen itself sits behind players.view.
-- ---------------------------------------------------------------------
alter table public.register_entries enable row level security;

create policy "register_entries_select_view" on public.register_entries
  for select using ( club_id = public.my_club() and public.has_perm('players.view') );

create policy "register_entries_insert_coach" on public.register_entries
  for insert with check ( club_id = public.my_club() and public.has_perm('sessions.create') );

create policy "register_entries_update_coach" on public.register_entries
  for update
  using ( club_id = public.my_club() and public.has_perm('sessions.create') )
  with check ( club_id = public.my_club() and public.has_perm('sessions.create') );

create policy "register_entries_delete_coach" on public.register_entries
  for delete using ( club_id = public.my_club() and public.has_perm('sessions.create') );

revoke all on public.register_entries from anon, authenticated;
grant select, insert, update, delete on public.register_entries to authenticated;

-- ---------------------------------------------------------------------
-- Self verification. Aborts the whole migration unless the substrate is
-- exactly as intended.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  if to_regclass('public.register_entries') is null then
    raise exception 'register_entries: the table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.register_entries'::regclass) then
    raise exception 'register_entries: row level security is not enabled';
  end if;

  -- The exact column set: no name column can ever exist here.
  select count(*) into bad from information_schema.columns
  where table_schema = 'public' and table_name = 'register_entries'
    and column_name not in ('id', 'club_id', 'session_id', 'player_id', 'present', 'bib_colour_override', 'source', 'created_at', 'updated_at');
  if bad > 0 then
    raise exception 'register_entries: % unexpected column(s)', bad;
  end if;

  if not (has_table_privilege('authenticated', 'public.register_entries', 'SELECT')
          and has_table_privilege('authenticated', 'public.register_entries', 'INSERT')
          and has_table_privilege('authenticated', 'public.register_entries', 'UPDATE')
          and has_table_privilege('authenticated', 'public.register_entries', 'DELETE')) then
    raise exception 'register_entries: authenticated is missing an intended grant';
  end if;
  if has_table_privilege('anon', 'public.register_entries', 'SELECT')
     or has_table_privilege('authenticated', 'public.register_entries', 'TRUNCATE') then
    raise exception 'register_entries: grant boundary violated';
  end if;

  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'register_entries';
  if bad <> 4 then
    raise exception 'register_entries: expected 4 policies, found %', bad;
  end if;
  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'register_entries' and cmd = 'ALL';
  if bad > 0 then
    raise exception 'register_entries: FOR ALL policies are forbidden here, found %', bad;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'register_entries_touch' and not tgisinternal) then
    raise exception 'register_entries: the touch trigger is missing';
  end if;
  if exists (select 1 from public.register_entries) then
    raise exception 'register_entries: the table must start empty';
  end if;
end
$$;
