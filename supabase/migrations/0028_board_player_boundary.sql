-- =====================================================================
-- OTJ Training Hub, migration 0028_board_player_boundary: no player names
-- in board tokens
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge. No Edge Function changes accompany this.
--
-- THE PROBLEM THIS CLOSES, a confirmed safeguarding finding. The players
-- table is the only table naming children and its select is gated to
-- sessions.create (0021, 0023), so parents can never read it. But the
-- board's roster seeding copied each child's display_name into the token
-- label inside boards.tokens, and boards are club readable by design. The
-- parent UI hid the labels (numberOnly), but that was presentation only:
-- the database still handed every club member, parents included, the
-- children's names inside the tokens jsonb. The 0020 header's "no name from
-- any roster reaches this column" was broken by the roster seeding feature.
--
-- THE MODEL AFTER THIS MIGRATION. A token persists AT MOST six fields:
--   id, number, side, x, y, playerId
-- playerId references the roster row (no foreign key: tokens are jsonb, and
-- a deleted player must leave the board intact, its disc simply showing the
-- number). The NAME IS NEVER STORED; the client resolves it at render time
-- through the players select, which RLS answers for sessions.create holders
-- only. So the same club wide board row shows a coach names and a parent
-- numbers, and the difference is enforced by Postgres, not by the UI.
-- A playerId alone identifies nothing to a reader who cannot query players.
--
-- WHAT THE BACKFILL DOES, and why it is certain, not heuristic:
--   * Every token keeps its id, number, side, x and y: positions, shirt
--     numbers, token ids and hand placed tactical tokens all survive.
--   * A token whose label exactly matches (after trimming) the display_name
--     of EXACTLY ONE player in the board's club gains that player's id as
--     playerId, so a coach's board resolves the same name it showed before.
--     An ambiguous match (two players sharing the name) links nothing.
--   * Every label is then REMOVED, matched or not. This is deliberate and
--     it is the certain-safe direction: the token label input was removed
--     from the UI before this migration (there has been no way to type a
--     label since), so a persisted label is either a roster derived name or
--     old free text that cannot be PROVEN not to be a child's name (for
--     example the name of a player since renamed or deleted). We do not
--     guess which is which; anything that could be a name goes. What a
--     matched label meant is preserved through playerId; an unmatched label
--     is dropped without replacement, leaving a numbered disc.
--   * Any stray key outside the six field shape is dropped with it.
--
-- THE CONSTRAINT. After the backfill, boards_tokens_minimal_shape rejects
-- any future write whose tokens carry a key outside the six field shape,
-- label included. The boundary stops being a comment and becomes schema:
-- a regression that tries to persist a name fails at the database whatever
-- client wrote it, service role included (check constraints are not RLS).
--
-- ROLLBACK. Structurally: drop the constraint, then the two functions
-- (alter table public.boards drop constraint boards_tokens_minimal_shape;
-- drop function public.board_tokens_without_names(jsonb, uuid);
-- drop function public.board_tokens_are_minimal(jsonb);). The removed
-- labels are NOT recoverable by rollback, by design: eliminating the
-- duplicated names is the point. Recovery, were it ever needed, is a
-- point in time restore, not this migration.
--
-- Numbering: the live ledger ends at 0027_storage_boundary (checked
-- 2026-07-14), so this is 0028.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The shape test the constraint (and the backfill's where clause) uses:
-- tokens must be an array of objects whose keys all come from the six
-- field shape. Immutable: it computes on its argument alone.
-- ---------------------------------------------------------------------
create or replace function public.board_tokens_are_minimal(p_tokens jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_tokens) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_tokens) as e(tok)
      where jsonb_typeof(e.tok) <> 'object'
         or exists (
              select 1
              from jsonb_object_keys(e.tok) as k(key)
              where k.key not in ('id', 'number', 'side', 'x', 'y', 'playerId')
            )
    )
$$;

comment on function public.board_tokens_are_minimal(jsonb) is
  $$True when a boards.tokens value is an array of objects carrying only the six allowed token fields (id, number, side, x, y, playerId). Backs the boards_tokens_minimal_shape check constraint: no label, and so no player name, can be persisted in a board token. See 0028_board_player_boundary.sql.$$;

-- ---------------------------------------------------------------------
-- The backfill transform, kept as a function so the security harness can
-- exercise the exact semantics the migration ran with (tests/security/
-- boards.test.ts). For each token: keep only the six allowed fields; if
-- the token had a label that exactly matches (trimmed) the display_name of
-- exactly one player in the given club, and it does not already carry a
-- playerId, add that player's id as playerId. Token order is preserved.
-- Non object entries are dropped, matching the client's defensive loader.
-- Runs with invoker rights: resolving a label needs read on players, which
-- RLS grants to sessions.create holders and the service role only, and the
-- function never returns a name either way.
-- ---------------------------------------------------------------------
create or replace function public.board_tokens_without_names(p_tokens jsonb, p_club uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      (
        select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
        from jsonb_each(e.tok) as f(key, value)
        where f.key in ('id', 'number', 'side', 'x', 'y', 'playerId')
      )
      || case
           when not (e.tok ? 'playerId')
            and btrim(coalesce(e.tok ->> 'label', '')) <> ''
            and m.player_id is not null
           then jsonb_build_object('playerId', m.player_id)
           else '{}'::jsonb
         end
      order by e.ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_tokens) with ordinality as e(tok, ord)
  left join lateral (
    select min(p.id::text)::uuid as player_id
    from public.players p
    where p.club_id = p_club
      and btrim(coalesce(e.tok ->> 'label', '')) <> ''
      and p.display_name = btrim(e.tok ->> 'label')
    having count(*) = 1
  ) m on true
  where jsonb_typeof(e.tok) = 'object'
$$;

comment on function public.board_tokens_without_names(jsonb, uuid) is
  $$The 0028 backfill transform: reduces each board token to the six allowed fields, converting a label that exactly matches one club player's display_name into a playerId reference and dropping every label. Kept so the security harness can prove the migration's semantics. Never returns a name.$$;

-- ---------------------------------------------------------------------
-- Backfill every board whose tokens are not already minimal.
-- ---------------------------------------------------------------------
update public.boards b
set tokens = public.board_tokens_without_names(b.tokens, b.club_id)
where not public.board_tokens_are_minimal(b.tokens);

-- ---------------------------------------------------------------------
-- Verify the backfill before the constraint lands. If any row still fails
-- the shape test the whole migration aborts, leaving the database as it
-- was, rather than half applying the boundary.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  select count(*) into bad
  from public.boards
  where not public.board_tokens_are_minimal(tokens);
  if bad > 0 then
    raise exception
      'board name boundary: % board row(s) still carry non-minimal tokens after the backfill',
      bad;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- The boundary as schema: no future write can persist a token field
-- outside the six field shape, so no label and no name, from any client.
-- ---------------------------------------------------------------------
alter table public.boards
  add constraint boards_tokens_minimal_shape
  check (public.board_tokens_are_minimal(tokens));

comment on column public.boards.tokens is
  $$Array of board tokens, each carrying only: id, number, side, x, y and optionally playerId. x and y are pitch fractions (0 to 1). playerId references public.players without a foreign key, so deleting a player leaves the board intact and its disc shows the number alone. NO NAME IS EVER STORED HERE: names resolve at render time through the players select, which RLS gates to sessions.create holders, never parents. Enforced by the boards_tokens_minimal_shape check constraint. See 0028_board_player_boundary.sql and docs/security/board-data-boundary.md.$$;
