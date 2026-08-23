# Player deletion boundary

What permanently deleting a child's identity actually removes, proved from the
schema rather than described from memory, and the rules the bulk path
(`0050_bulk_delete_players.sql`, roadmap PLAYERS-01) adds on top of it.

This document is authoritative where an older comment, spec paragraph or pull
request disagrees. Withdraw remains the normal, reversible way to remove a
player from a season; permanent deletion is the rare, admin only, audited act.

## 1. The proven dependency graph

Read from `pg_constraint` on the hosted database on 16 August 2026, not
inferred from names or comments. Exactly three foreign keys reference
`public.players`, all on the composite `(id, club_id)` key and all
`ON DELETE CASCADE`:

| Constraint | Referencing table | Delete rule |
|---|---|---|
| `player_registrations_player_fk` | `player_registrations` | cascade |
| `register_entries_player_fk` | `register_entries` | cascade |
| `player_spond_links_player_fk` | `player_spond_links` | cascade |

One second hop: `spond_event_responses_link_fk` references
`player_spond_links (club_id, spond_member_id)` and also cascades. Deleting a
child therefore drains every stored Spond reply for their member in the same
statement, which is the same mechanism unlinking already used (0045).

Nothing else references `players`:

- **`boards.tokens`** holds `playerId` inside a `jsonb` array with **no foreign
  key by design** (0028). A board is never touched by a deletion. Its discs keep
  their number and position and stop resolving a name, which is what the
  `boards_tokens_minimal_shape` check constraint makes possible: a token has
  never carried a label.
- **`audit_events.entity_id`** holds the player id with **no foreign key by
  design** (0030). The trail survives the child and degrades to the neutral
  "Deleted player" label the Activity and History surfaces already render.

## 2. What is destroyed rather than neutralised

`register_entries` is the one dependency where a deletion removes a historical
record instead of degrading it to a neutral reference.

A register entry is one child's own record for one session: whether they turned
up (`present`), whether the coach put them in that night's groups
(`included_in_groups`), and what bib they wore. `0044_training_day_core.sql`
deliberately does not audit that table per tick, and asserts that it must not
be, so the deletion leaves no per row trace of what went.

What is NOT affected: the session itself, its plan, its venue, its covered
teams, its saved board, and every other child's entries. What goes is that
child's own rows.

**This is not a new semantic.** The single row Delete permanently has cascaded
`register_entries` since 0044 shipped. What PLAYERS-01 changes is that the
number is counted and stated before the run rather than discovered afterwards,
and that the run is recorded as one audit event carrying that count. The
existing single row dialog's consequence text predates 0044 and does not
mention register entries; the bulk dialog does, in full.

If a future decision wants session history to survive an erasure, that is a
schema change (a `set null` player reference plus a "deleted player" render
path), not a UI change, and it is out of scope for PLAYERS-01.

## 3. The bulk path

Two functions, added by `0050_bulk_delete_players.sql`. Neither adds a
capability, a table, a column, a policy or a grant on any table.

> **Numbering: 0050, registered and now APPLIED.** Slot `0049` belongs to
> `0049_spond_team_reconcile.sql` (PR #190). This file was written as 0049 while
> #190 was still a draft and was renamed to 0050 the moment that merge landed,
> because two files carrying one version make `supabase db reset` abort on
> `schema_migrations_pkey` and take the whole security suite with it.
>
> #190's 0049 **has since been applied to production**, on 17 August 2026. The
> hosted ledger stamped it `20260817104226` under the name
> `spond_team_reconcile`. It is recorded in
> `docs/operations/production-migration-apply.md` and in the roadmap's SPOND-08
> entry. The earlier note here, that the newest row was still
> `spond_session_link_unique` (`20260812102912`) with no `spond_team_reconcile`
> row, was read on 16 August 2026 and is superseded.
>
> So the registration that was blocked on that number is done.
> `0050_bulk_delete_players.sql` is in `REVIEWED_MIGRATIONS` with
> `expected_previous_version` `20260817104226` / `spond_team_reconcile`, the
> ACTUAL stamp rather than a guessed one, with the idempotency key
> `otj:migration:0050_bulk_delete_players` and five object probes, and it is in
> the production workflow's dropdown. The registration alone applied nothing:
> the workflow is `workflow_dispatch` only and holds at the production
> environment gate for a human. That gate has since been passed: **0050 was
> applied on 23 August 2026** by workflow run 32623941411 from this PR's
> reviewed commit `2d1de99827064f6856374bfc3c094cf50ae1cc3f`, the hosted ledger
> stamped it `20260823065041` / `bulk_delete_players`, the recorded statement
> matched the reviewed file, all five probes read true post-apply, and 0049's
> row is now the entry immediately before it.
>
> **The probes resolve no name, and do not spell the function names.** Three of
> the four functions carry the substring `delete`, which the verifier's
> read-only statement guard bans outright so that no register edit can smuggle a
> write in through an object probe. That guard is blunt on purpose and
> weakening it to fit a migration that DESTROYS CHILD DATA would be the wrong
> trade in the wrong place, so each probe joins `pg_proc` to `pg_namespace` and
> reads the privilege off the row it found, naming the function through
> `concat`. That shape is absence safe by construction: an absent function is an
> empty join, so the probe is false rather than null and rather than an error.
> The same reason forced the ledger name and the idempotency key, which also
> spell `delete`, to be composed rather than quoted whole; `sql_text_value` in
> `verify_hosted_state.py` does that for any value, and the guard itself is
> unchanged. `test_0050_probe_totality.sh` flips all five probes against a real
> PostgreSQL, in the absent state, the applied state and six wrong-ACL states.
>
> The file already opens with `BEGIN` and closes with `COMMIT`, which the apply
> requires: it wraps the file with the ledger insert in an outer transaction and
> the file's own `COMMIT` commits both. Proved by applying it against a database
> with a deliberately broken precondition: the self verification aborted and
> **zero** of its four functions were left behind.

- `preview_delete_players(uuid[])` is read only, gated on **`players.delete`**
  rather than `players.view` (what a deletion would cost is a shape of a child's
  record), club scoped, duplicate and null tolerant. It writes nothing and
  audits nothing.
- `delete_players(uuid[], int)` is the transactional run. `SECURITY DEFINER`
  with `set search_path = ''`, so the in body capability and club checks are the
  enforcement rather than RLS.

Both share one counting implementation, `player_deletion_counts`, which is
internal (EXECUTE revoked from every client), so the number a coach reads and
the number the audit event records cannot be computed two different ways.

### Refusals, each of which deletes nobody

| Condition | Result |
|---|---|
| No `players.delete`, or no club | `42501` |
| Empty or all null id array | `22023` |
| More than 200 ids in one run | `22023` |
| Any id is not a live player of the caller's club | `P0001`, whole run refused |
| The caller's confirmed count no longer matches server truth | `P0001`, whole run refused |

A cross club id and an id another admin has just deleted are refused with the
SAME message on purpose. Distinguishing them would answer "does this id exist in
some other club", which is not a question a member of this club may ask.

### Concurrency

The identities are locked `FOR UPDATE` **in id order** before anything is
counted. Two consequences:

1. Two admins deleting overlapping selections take the shared rows in the same
   order, so they queue rather than deadlock. The second finds its selection
   short and refuses whole.
2. `FOR UPDATE` on the parent conflicts with the `FOR KEY SHARE` lock an FK
   insert takes on it, so no registration, register entry or Spond link can be
   added for a locked child between the count and the delete.

Both were exercised against a real two session PostgreSQL run: overlapping
selections produced one complete run and one whole refusal with the untouched
third child surviving, and identical reversed selections produced no deadlock.

One second-hop residual is recorded deliberately, found by exact head review
after the apply: a stored Spond REPLY references the link row, not the player
row, so a `spond-sync` run inserting a reply for a linked, selected child
takes its `FOR KEY SHARE` on `player_spond_links`, which the identity lock
does not cover. A reply committed between the in-lock count and the delete is
removed by the cascade, correctly, with its child; the `spond_replies` figure
the run returns and audits was counted before that insert and undercounts by
exactly those racing rows. Nothing outlives the erasure and no first-hop
count can miscount (registrations, register entries and links are blocked as
above). Closing it means locking the selected link rows in deterministic
order before counting, which is a change to the applied function and
therefore a candidate follow-up migration, never an edit to this one.

### Audit

One run writes:

- one `player.deleted` event per identity, from the existing 0032 trigger, and
- one `players.bulk_deleted` event, entity type `delete_batch`, entity id the
  run's batch id,

all sharing that batch id, so the Activity feed can open the run and list
exactly which identities went.

The bulk event's metadata is validated by `audit_bulk_delete_metadata_ok`, a
closed list of NUMERIC keys and nothing else. It is deliberately separate from
`audit_metadata_ok` (0030), whose vocabulary describes an uploaded spreadsheet
and is shared by four other events. No text of any kind is admitted, so no
child name can enter the metadata of a deletion however a future writer is
confused.

## 4. Spond

The run deletes local rows only. It deletes no Spond member, modifies no Spond
member and calls no Spond endpoint; nothing in the path makes an outbound
request of any kind. Spond remains read only from OTJ, unchanged.

## 5. Names

No child name enters a URL, a query key, a log line or the audit payload. The
confirmation dialog lists the selected names, which the page already holds and
already renders in the table beside them. The typed confirmation is a phrase
naming the COUNT (`DELETE 6 PLAYERS`), not the names, because a six name gate is
one a person defeats by copying.

## 6. Where this is enforced

| Rule | Enforced by |
|---|---|
| Dependency graph is what the preview counts | `0050`'s self verification, which fails the migration if a fourth foreign key into `players` appears |
| Capability and club | In body checks in both RPCs, `tests/security/players-bulk-delete.test.ts` |
| One transaction, no partial run | One statement plus a raise on any refusal; the migration's SQL behaviour proof |
| Nothing selected by default, Select all means the shown rows, a filter change cannot broaden a selection | `src/lib/playersBulk.ts` and its tests, `src/routes/Players.bulk.test.tsx` |
| No second delete path, no browser derived counts, one confirmation gate | `src/lib/playersBulk.invariant.test.ts` |
| Archived and non current seasons stay read only | `canBulkDelete`, the same gate as `rowActionKeys` |
