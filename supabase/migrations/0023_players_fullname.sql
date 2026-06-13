-- =====================================================================
-- OTJ Training Hub, migration 0023_players_fullname: roster name boundary,
-- corrected to the full name
--
-- REVIEW REQUIRED. Migrations are gated. Run by hand via the connector
-- after review, and only once the live ledger is confirmed to have this
-- slot free. Do not auto-merge.
--
-- COMMENT ONLY. This migration makes no structural change: no table, no
-- column, no policy, no index, no grant is added, altered or dropped. It
-- updates the boundary documentation on the players table so the schema
-- carries the truth after the Spond squad import lands. The original
-- boundary prose lived only in the 0021_players header, which said the
-- display_name could be a first name or first name plus last initial. The
-- roster import (spond-roster-import) now stores each child's FULL name, the
-- user's decision: coaches know the children by full name and the roster is
-- the single source, so the minimal form would be less readable than the
-- Spond app it replaces. This migration restates the boundary on the column
-- and table themselves, with COMMENT ON, so the corrected statement is
-- visible to anyone reading the schema, not only the original migration.
--
-- Numbering: the ledger ends at 0022_session_board, so this is 0023.
--
-- WHAT THE BOUNDARY STILL IS, unchanged by the full name and restated here:
--   * display_name holds the child's full name, sourced either from a coach
--     typing it or from a Spond squad import. It is still bounded (1 to 40
--     chars) by the original column check, which 0021 set and this does not
--     touch.
--   * No other personal field is stored: no guardian or parent link, no
--     contact detail (no email, phone or address), no date of birth, no
--     medical or dietary note, no photo, no free text, and no link to an auth
--     user. A player is a label on a roster, never an app account.
--   * The table is still readable only by holders of sessions.create (coaches
--     and admins) within the club, never by parents. That gating, on the
--     0021 policies, is unchanged.
-- =====================================================================

comment on table public.players is
  $$One child on a team's roster, the first child data the app holds. display_name holds the child's full name, sourced either from a coach typing it or from a Spond squad import (spond-roster-import). No other personal field is stored: no guardian or parent link, no contact detail (email, phone, address), no date of birth, no medical or dietary note, no photo, and no link to auth.users. A player is a label on a roster, never an app account. Readable only by holders of sessions.create (coaches and admins) within the club, never by parents. See 0021_players.sql for the table and its RLS, 0023_players_fullname.sql for this corrected boundary.$$;

comment on column public.players.display_name is
  $$The child's full name, sourced either from a coach typing it or from a Spond squad import (spond-roster-import). Bounded to 1 to 40 chars by the column check. This is the only name the roster holds: no guardian name, no contact detail, no other personal field is stored alongside it.$$;
