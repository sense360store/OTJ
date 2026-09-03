# Applying a migration to production

`.github/workflows/apply-production-migration.yml` applies ONE reviewed
Supabase migration to the hosted production database, from a button, and
records it in the hosted ledger. It deploys no frontend code, no Edge Function,
no Storage policy and no secret.

Migrations are a review gate in this repository (CLAUDE.md, "Review gates").
This workflow does not loosen that gate. It replaces the by-hand SQL client
with a button and keeps every check the hand was supposed to perform, in an
order where each one fails before the next can do damage.

## Applied through this workflow

| Migration | Hosted version | Ledger name | Applied |
|---|---|---|---|
| `0046_drill_diagram` | `20260811210248` | `drill_diagram` | 2026-08-11 |
| `0047_register_group_inclusion` | `20260812064038` | `register_group_inclusion` | 2026-08-12 |
| `0048_spond_session_link_unique` | `20260812102912` | `spond_session_link_unique` | 2026-08-12 |
| `0049_spond_team_reconcile` | `20260817104226` | `spond_team_reconcile` | 2026-08-17 |
| `0050_bulk_delete_players` | `20260823065041` | `bulk_delete_players` | 2026-08-23 |
| `0051_team_sort_order` | `20260902150212` | `team_sort_order` | 2026-09-02 |

`0050` was applied from the reviewed PLAYERS-01 branch commit
`2d1de99827064f6856374bfc3c094cf50ae1cc3f` (PR #191) before that branch merged,
the reverse rollout order its register entry documents: `main` auto-deploys to
Vercel and the new Registered players screens call these functions, so merging
first would have shipped a client calling functions the database did not have.
#191 merged on 27 August 2026, so the migration file and its register entry are
on `main`; the hosted ledger, which is the authority, had already recorded the
apply.

`0051` went the same way round: applied from the reviewed COACH-1A branch
commit `855b0dc9fb0adfd7fa8e47cffe930638c2bf5759` (PR #223) at 15:02 UTC on
2 September 2026, three minutes before that branch merged. Here either order
was safe, because no deployed client reads the column; the apply was simply
the human gate the pull request had waited on.

`0047` stays in the dropdown and in `REVIEWED_MIGRATIONS` now that it has run.
Entries are never removed once applied: the register is the closed list of what
this workflow may apply, and an applied entry is what makes a second press fail
closed rather than fail unrecognised. Selecting it again stops at the pre-apply
gate, which now finds the ledger moved, the migration already recorded and the
column already present, and the UNIQUE `idempotency_key` refuses the insert
behind that. Its `expected_previous_version` stays `20260811210248` for the same
reason: it records the state `0047` was REVIEWED against, not the current head.

`0047`'s ledger row records `created_by` as the workflow and the commit it ran
from, `b3f5d5c1a6610a5ff804a7b1b008adc8a4def6cf`, an `idempotency_key` of
`otj:migration:0047_register_group_inclusion`, and one `statements` entry
hashing to `317101852faf1ddc68f8e641f24579b9`, the reviewed file with its
trailing newline stripped. The post-apply gate confirmed it was the unique
newest row with `20260811210248` / `drill_diagram` before it, and that
`public.register_entries.included_in_groups` exists as a NOT NULL boolean
defaulting to false. The attendance record was read either side and did not
move: 9 register rows before and after, 1 with `present` true before and after,
and 0 with `included_in_groups` true immediately afterwards, which is what a
defaulted column with no backfill must read. The four `register_entries` RLS
policies remained 4, with no `FOR ALL` policy introduced.

`0048` repairs one bad Spond link and adds
`sessions_spond_event_id_unique`, so a mirrored Spond event can hold at most
one Hub session. Its `expected_previous_version` stays `20260812064038` for the
same reason `0047`'s stays `20260811210248`: it records the state `0048` was
REVIEWED against, not the current head. That is a historical review fact and it
does not move when the ledger does.

`0048`'s ledger row records `created_by` as the workflow and the commit it ran
from, `74621ef8a04c45cb61ff4963e700a5fad968c2ca`, an `idempotency_key` of
`otj:migration:0048_spond_session_link_unique`, and one `statements` entry
hashing to `a559695830bfa6713dc741f9fd27b2e2`, the reviewed file with its
trailing newline stripped. The post-apply gate confirmed it was the unique
newest row with `20260812064038` / `register_group_inclusion` before it, and
that `sessions_spond_event_id_unique` exists as a unique partial index on
`public.sessions` rather than merely as a matching name. The outcome was read
back afterwards: across the 10 sessions carrying a `spond_event_id` there are
zero duplicated links, which is what the repair plus the index must read.

It was applied BEFORE the frontend from its pull request reached production,
which was the point of ordering it that way. The repository auto-deploys `main`
to Vercel, so the safe order is: merge nothing, run this workflow on the
migration's branch commit, confirm the post-apply gate, then merge. Applying it
late would not have been catastrophic (the new client works against a database
without the index; it simply never sees the refusal it knows how to explain),
but the duplicate it prevents is silent corruption, so early was the right way
round.

It proves it **changed** nothing rather than asserting what the schema looks
like. That distinction cost a CI run: a first draft asserted that `anon` held
no INSERT, UPDATE or DELETE on `public.sessions`, which is false on this
project and always has been. Every Data API role (`anon`, `authenticated`,
`service_role`) holds the full table privilege set there, inherited from
Supabase's default privileges for new tables in `public`; row level security is
the layer that decides what any of them may actually do. The assertion would
have aborted the apply against production as well as against a fresh local
stack. The self-verification now fingerprints the table grants, the raw ACL,
the column ACLs and the full policy set on entry and compares them on exit.

It is correct in two places, which is not optional: `supabase db reset`
applies every migration in `supabase/migrations/` to a fresh local stack on
every developer machine and in the CI security job, and that database has never
held the hosted damage. So `0048` refuses any duplicated link it was not shown,
repairs the one it was shown only if it is still there, and adds the index
either way, saying which branch it took.

Its behaviour was exercised against a real PostgreSQL before shipping:
`.github/scripts/production-migration/test_0048_spond_link_unique.sh` builds a
stand-in and runs five databases. Against the hosted state it asserts exactly
one row moved, that no other row and no live marker changed, and that the index
then refuses a second session on the same event including for two racing
connections. Against an unexpected third duplicate it asserts the whole run
aborts with the database untouched. Against a database with nothing to repair,
and against an empty one, it asserts the file applies and changes no row. And
against the one odd state the assumption checks step over (only the wrong
session holding the link), it asserts the verification catches it and the
transaction rolls back. Its stand-in grants the full Supabase table privilege
set to `anon`, `authenticated` and `service_role`, which is what the first
version did not do and why the false assertion reached CI; a sixth database
proves each grant fingerprint actually moves when a grant, a column grant or a
policy changes. It
needs a local PostgreSQL server and is therefore not part of CI; run it by hand
when reviewing the migration.

`0046` is the first migration this workflow applied. Its ledger row records
`created_by` as the workflow and the commit it ran from, an `idempotency_key`
of `otj:migration:0046_drill_diagram`, and one `statements` entry hashing to
the reviewed file. The post-apply gate confirmed it was the unique newest row
with `20260810182333` / `spond_links` before it, and that the column, the check
constraint and the three validation functions all exist.

`0049` was applied on 17 August 2026. The workflow ran to the end: the
pre-apply gate passed, the apply committed, and the post-apply gate passed. The
hosted ledger assigned it version `20260817104226` under the name
`spond_team_reconcile`, the newest row until `0050`'s apply on 23 August 2026.

Its `expected_previous_version` stays `20260812102912` /
`spond_session_link_unique` for the same reason `0047`'s and `0048`'s stay where
they are: it records the state `0049` was REVIEWED against, checked 16 August
2026, not the current head. That is a historical review fact and it does not
move when the ledger does.

The post-apply gate confirmed `spond_team_reconcile` was the unique newest
ledger row, that the row before it was `20260812102912` /
`spond_session_link_unique`, that the recorded `statements` array held exactly
one entry hashing to the reviewed file, and that all three registered object
probes were true: the function exists with the reviewed six argument signature,
it is SECURITY DEFINER with an empty `search_path`, and `authenticated` may
execute it while `anon` may not.

Getting there took two runs, and the first one is the reason
`.github/scripts/production-migration/test_probe_totality.sh` exists. The
pre-apply gate stopped with `function
"public.spond_reconcile_player_team(uuid, ...)" does not exist`, reported as a
role or readability problem. Nothing was unreadable and nothing was wrong with
the database: the function had not been created yet, which is the one state a
pre gate exists to confirm. The probe asked the question through
`has_function_privilege(role, 'public.f(uuid, ...)', 'EXECUTE')`, which resolves
the textual signature first and raises when nothing matches, so it could never
answer no. A second probe carried a matching defect at the other gate:
`pg_get_function_identity_arguments()` renders the argument NAMES as well as
the types, so its comparison was false with the function correctly in place and
the POST gate would have failed after the apply had already run. Both were fixed
before the successful run, and the database was untouched throughout the first
one.

`0051` was applied on 2 September 2026, by workflow run 33645893501, from the
reviewed COACH-1A branch commit `855b0dc9fb0adfd7fa8e47cffe930638c2bf5759`
(PR #223), three minutes before that branch merged. The workflow ran to the end
in one run: the pre-apply gate passed against a ledger still headed by
`20260823065041` / `bulk_delete_players` with all three of its objects absent,
the apply committed (the file's own `lock table`, DDL and self-verification ran
inside the workflow's single transaction), and the post-apply gate passed. The
hosted ledger assigned it version `20260902150212` under the name
`team_sort_order`, and that is now the newest row: 46 rows, exactly one so
named, the recorded statement matching the reviewed file, and the column, the
index and the allow list entry all present. Read back afterwards, outside the
gate: the index definition is the reviewed string, `audit_teams()` is still
`SECURITY DEFINER` with an empty `search_path`, `teams` still carries exactly
its two policies with row level security enabled, and every one of the five
hosted teams carries a null position, which is the "no backfill" claim on the
live rows. Its `expected_previous_version` stays `20260823065041` /
`bulk_delete_players`, as every entry's does. The content-sharing deploy pin
moves to `20260902150212` in the change that records this apply (see
`EXPECTED_LAST_MIGRATION` below).

An earlier dispatch of the workflow that afternoon, run 33643220492, was
submitted with the migration input left on the dropdown's first entry,
`0046_drill_diagram`, and the pre gate refused it before any write: the ledger
had moved past 0046's pin, 0046 was already recorded, and its objects were
present. That failed safe only because the dropdown's first entry is the oldest
registered file, which is long applied. A sentinel first entry that the "is on
the reviewed list" step refuses would make a careless press fail at the first
step instead; never reorder the list newest first, which would make the live
migration the default.

`0050` was applied on 23 August 2026, by workflow run 32623941411, from the
reviewed PLAYERS-01 branch commit `2d1de99827064f6856374bfc3c094cf50ae1cc3f`
rather than from `main` (see the note under the table above). The workflow ran
to the end in one run: the pre-apply gate passed against a ledger still headed
by `20260817104226` / `spond_team_reconcile` with every object the migration
creates absent, the apply committed, and the post-apply gate passed. The hosted
ledger assigned it version `20260823065041` under the name
`bulk_delete_players`, and that is now the newest row. Applying it destroyed
nothing: the migration creates four functions and deletes no row, and its entry
point is destructive only when called.

Its `expected_previous_version` stays `20260817104226` / `spond_team_reconcile`
for the same reason `0047`'s, `0048`'s and `0049`'s stay where they are: it
records the state `0050` was REVIEWED against, not the current head.

The post-apply gate confirmed `bulk_delete_players` was the unique newest
ledger row, that the VERSION of the row before it was `20260817104226` (the
gate compares only the version; the name `spond_team_reconcile` was asserted
by the pre-apply gate as the newest row before the apply, and confirmed again
by the reconciliation's own readback), that the recorded `statements` array
held exactly one entry hashing to the reviewed file, MD5
`a34ad8932597a467795d47867254fe62`, and that all five registered object probes
were true: the bulk deletion entry point `(uuid[], int)` and the deletion
preview `(uuid[])` exist as SECURITY DEFINER with an empty `search_path` and
are executable by `authenticated` and not by `anon`, the counting helper
`(uuid, uuid[])` exists and no client role may execute it, and the audit
metadata predicate `(jsonb)` exists. No gate reads a SHA-256: the plan step
recorded the file's SHA-256,
`caeadd53de608ae7ae83e789ea5b4733328b59f2f38bfad048115159cdf16a08`, computed
like the recorded statement over the file with its trailing newline stripped,
which is the shape the ledger stores.

## What `0049` does, kept for reference

It adds ONE function, `public.spond_reconcile_player_team`, and nothing else:
no table, no column, no index, no policy, no grant on any table, no capability
key, no trigger, and no value added to `audit_events.source` or to
`player_spond_links.matched_by`. The only privilege it moves is EXECUTE on its
own function (revoked from `public` and `anon`, granted to `authenticated`),
and the function self gates on `players.manage` in its body, which is the
capability both writes it performs already require. It changes no row.

The function makes one child's CURRENT SEASON team assignment agree with Spond,
optionally binding the opaque Spond member id a human confirmed in the same
transaction. It refuses to move a child who carries no `player_spond_links`
row, and refuses again when that row no longer points at the member the caller
derived its destination from; exactly one of `p_expected_member_id` and
`p_confirm_member_id` must be supplied, so a null never means "any link will
do". It creates no player identity, deletes and repoints no link, names no
season (so no historic or archived registration is addressable through it),
touches no register entry, session or Spond mirror row, and makes no network
call. See `docs/security/spond-data-boundary.md` and the file's own header.

Its self-verification takes a BEFORE fingerprint of the registrations, links,
register entries, stored RSVP, audit rows, policies, grants and triggers into a
transaction local table **before** the function is created and compares it
after, so the "changed nothing" claim is a comparison across the DDL rather
than a value compared with itself. It also reads the STORED function definition
back and asserts the boundaries the header claims, so those hold against what
will actually run rather than against the file as reviewed.

Its behaviour was exercised against a real PostgreSQL before shipping:
`.github/scripts/production-migration/test_0049_spond_team_reconcile.sh` builds
a stand-in with the tables, triggers, policies and grants the function reads or
asserts against, and runs the proved move, the Unassigned move, the idempotent
repeat, the stale refusal, the unlinked refusal, the repointed-link refusal,
the confirm-and-move, the atomicity of those two halves when the move is
refused, both link preservation refusals, every gate (capability, club, member
id vocabulary, unregistered id, naming neither or both members), and three
concurrency shapes: two managers on one child, two crossed confirmations, and
two confirmations of the same not yet linked member.

It also proves the self-verification BITES rather than asserting that it does.
Section N injects each forbidden thing (an insert into `public.players`, and a
reference to `register_entries`, `session_teams`, `spond_events` and
`spond_event_responses`) into the function body and asserts the apply aborts,
then runs the same five injections against a `\b` version of the file and
asserts it does NOT. That second half is the point: the checks originally used
`\b`, which in PostgreSQL's ARE syntax is the backspace character rather than a
word boundary, so every one of them matched nothing and passed for the wrong
reason. A review caught it and the assertions now use `\y` and `\M`.

The two concurrency mechanisms were mutation tested the same way: removing the
per member advisory lock reproduces the raw `23505` the loser used to see, and
the crossed confirmation section states plainly that it exercises the shape
without reliably reproducing the interleaving.

It needs a local PostgreSQL server and is therefore not part of CI; run it by
hand when reviewing this migration.

Ordering. Unlike `0048`, this one was safe to apply either side of the
frontend: a client running against a database without it gets `PGRST202` from
the RPC and says the database change has not been applied yet
(`isMissingFunction`/`RECONCILE_UNAVAILABLE` in `src/lib/queries.ts`), and no
other screen calls it. The `spond-link-members` deploy in the same pull request
was a separate gated step and was likewise safe in either order: a deployment
that does not return the member id yet lands as `''`, which the client reads as
no identity, so the reconciliation offers nothing rather than misfiring.

## What `0050` does, kept for reference

`0050_bulk_delete_players` is **DESTRUCTIVE** when its entry point is called,
and the one entry in this document that deletes child data; applying it
destroyed nothing, since it only creates functions. Registered against
`20260817104226` / `spond_team_reconcile`, the row `0049`'s apply stamped, with
the idempotency key `otj:migration:0050_bulk_delete_players`, and applied on
23 August 2026 at hosted version `20260823065041` (see the apply record above).

It adds four functions and nothing else: no table, no column, no index, no
policy, no grant on any table, no capability key and no trigger. It creates no
permission. `players.delete` is admin only by default (0030) and the
`players_delete_admin` policy from 0032 is untouched, so nobody gains the
ability to delete a child who could not already delete one; what it adds is a
way to spend that same permission on many identities in one transaction, with a
preview, an expected count and an audit row. A deleted player takes their
register entries with them by cascade, exactly as the single row Delete
permanently has done since 0044. The full boundary is
`docs/security/player-deletion-boundary.md`.

**Its probes are shaped unlike every other entry here, for two reasons.** They
resolve no name at all: each joins `pg_proc` to `pg_namespace` and reads the
privilege off the row it found, so an absent function is an empty join and the
probe is false rather than null and rather than an error. And they do not spell
the function names, because three of the four carry the substring `delete`,
which the read-only statement guard bans outright. So does the ledger name.
Rather than weaken a guard that exists to stop a register edit smuggling a write
through a probe, the names are composed: `sql_text_value` renders any value that
spells a banned word as a `concat` of pieces, and the statement compares the
identical text without carrying the word.
`test_0050_probe_totality.sh` flips all five probes against a real PostgreSQL
in the absent state, the applied state and six wrong-ACL states, and runs in CI.

**The rollout order for this one was the reverse of the usual.** `0048` was
applied before its frontend merged and this document explains why that is
normally right. Here it was not merely right, it was required: the repository
auto-deploys `main` to Vercel and the new Registered players screens call these
RPCs, so merging first would have shipped a client calling functions the
database did not have. The workflow was therefore run against the reviewed
**#191 branch commit** `2d1de99827064f6856374bfc3c094cf50ae1cc3f` on 23 August
2026, the post-apply gate passed, and only then did the branch merge.

## Reviewed, registered, not yet applied

`0052_atomic_team_order`. Registered against the head `0051`'s apply left,
`20260902150212` / `team_sort_order`, confirmed live on 3 September 2026, with
the idempotency key `otj:migration:0052_atomic_team_order`. It waits here for
the human production apply. What it does is below.

`0051_team_sort_order` sat here between its review and its apply on 2 September
2026 and is now in the applied table above. Each migration after it is numbered
and registered against the head the previous apply left, at its own review, and
only if nothing else has applied first.

## What `0051` does, kept for reference

`0051_team_sort_order` adds ONE nullable integer column,
`public.teams.sort_order`, with no default and no backfill; ONE partial unique
index, `teams_sort_order_unique` on `(club_id, sort_order)` where the position
is not null; and `sort_order` on the update allow list of the existing
`public.audit_teams()`, field name only, never a value. Nothing else: no
policy, no grant, no capability key, no trigger, no row. Null means the club
has not configured its order, which is every team on apply, so no behaviour
changes when it lands; positions mean something only within one club and need
not be contiguous; it is not an ability score and there is no per-player
field. The full reasoning is the file's own header, and the settled shape is
`docs/product/coaching-workflow/04-data-model-proposal.md` section 5.
Registered against `20260823065041` / `bulk_delete_players` with the
idempotency key `otj:migration:0051_team_sort_order`, and applied on
2 September 2026 at hosted version `20260902150212` (see the apply record
above).

Its self-verification takes a BEFORE fingerprint of every team row, the policy
set, the three grant views (`role_table_grants`, the stored ACL, and every
column ACL) and the trigger set into a transaction local table before the DDL,
and requires each unchanged afterwards, with the row fingerprint compared minus
the one column the file adds and every position required to be null. It then
runs the rule rather than describing it: inside a subtransaction it always
rolls back it inserts two synthetic clubs and three synthetic teams, proves two
unordered teams coexist, that one club's teams cannot share a position, that
two clubs may, that a position can be given back, and that each write leaves
exactly the `team.updated` trail the allow list says with no value in it, then
checks the rollback against the before fingerprint rather than trusting it.
Finally it reads the stored `audit_teams()` back and requires `sort_order` to
appear only in the comparison that names the field.

Its three probes are the column by shape (`information_schema.columns`:
integer, nullable, no default), the index by shape (`pg_index`: unique, not the
primary key, partial, two key columns) and the allow list by the stored
function body (`to_regprocedure` then `pg_get_functiondef`). The third is the
first probe in this register that flips on the BODY of a function that already
exists rather than on presence, because `audit_teams()` has existed since 0037.

`.github/scripts/production-migration/test_0051_team_sort_order.sh` runs in CI
against a throwaway PostgreSQL: it applies the reviewed file to a stand-in of
the teams substrate, flips the three probes in both gate states, drives the
column through row level security as a `teams.manage` holder, a coach without
it, a `teams.manage` holder of another club and anon, proves a second apply
fails at its first statement and changes nothing, and mutates the file
seventeen ways to prove the self-verification bites, each mutation pinned to
the message of the one check that catches it. Ten do one thing the header
forbids (a backfill, a non partial index, reversed key columns, the allow list
entry removed, a new policy, a column scoped grant, the audit writer called
twice, a new capability key, the audit trigger dropped, and a value written
into an event). Seven change nothing a behavioural probe could see (the
comparison's operands swapped, a second read of the column, a second writer
and a fourth action string in dead code, SECURITY DEFINER dropped, the audit
trigger recreated under another name, and a second trigger that does nothing),
so the stored source and trigger checks are proved to bite on their own rather
than behind the probe's counts. The security policy suite's `tests/security/team-order.test.ts`
covers the contract through PostgREST on the local stack for the roles the
fixtures hold: a club admin holding `teams.manage`, a coach without it, a
parent, a coach of another club and an unauthenticated caller. No fixture
holds `teams.manage` in a second club, so the cross club write refusal by a
holder of that capability is proved in the harness alone, and the same
position in another club is seeded there by the service role as a fixture and
asserted through the members' own reads.

Ordering. Safe to apply either side of the frontend: no deployed client reads
or writes the column, because `TEAM_COLS` in `src/lib/queries.ts` names an
explicit list without it, and `src/lib/teamOrder.invariant.test.ts` fails the
build if a consumer arrives before COACH-1B, the frontend half.

## What `0052` does, kept for reference

`0052_atomic_team_order` adds ONE function,
`public.set_team_order(p_team_ids uuid[], p_expected_sort_orders integer[])`,
and nothing else: no table, no column, no index, no policy, no grant on any
table, no capability key, no trigger, and no value added to any vocabulary,
`audit_events.source` and `audit_events.action` included. The only privilege it
moves is EXECUTE on its own function, revoked from `public` and `anon` and
granted to `authenticated`. Every write it performs is a write a `teams.manage`
holder could already make by hand through the `teams_manage` policy. What it
adds is that the whole order lands together or not at all, under one
serialization point.

**Why it exists.** COACH-1B writes the club order from the browser as separate
PostgREST statements, each conditioned on the value the screen last read. Two
admins who move DISJOINT rows never collide. From a stored `A=1 B=2 C=3 D=4`,
one swaps A and B while the other swaps C and D: no compare and set fails,
both commit, and the club is left with `B=1 A=2 D=3 C=4`, a complete valid
order NEITHER admin submitted. `teams_sort_order_unique` cannot object, because
the merge is a permutation like any other. A client without a transaction can
only read the damage back afterwards and say so, which is what COACH-1B does
today. The missing thing is a transaction, so the fix is in the database.

**Serialization.** Three things, and the first was found in review after the
other two were written and tested.

The locks decide what a caller WAITS FOR. They cannot decide WHEN IT LOOKED. A
`REPEATABLE READ` or `SERIALIZABLE` transaction fixes its snapshot at its first
statement, before it reaches any lock here, so it can wait its whole turn and
then still read the world as it was before the winner committed: its expected
snapshot matches values nobody holds any more, and it writes the rows the winner
did not touch, where PostgreSQL finds no write conflict. The merge commits. That
was reproduced against a real server rather than reasoned about, and with the
guard removed the harness watches a `REPEATABLE READ` caller be accepted and
store exactly the merge. So anything but `READ COMMITTED` is refused with `P0001`
before any lock, rather than served on a snapshot that cannot move. `READ
UNCOMMITTED` is accepted, because PostgreSQL runs it AS read committed; the
harness asserts that rather than trusting it, after the first version of the
guard assumed PostgreSQL rewrites the level at SET time (it does not) and turned
that caller away.

Then two locks, always in that order, both taken before a team
row is read. A club scoped advisory transaction lock, the
`otj.<domain>:' || club` idiom 0031, 0032, 0036 and 0049 already use, orders
whole order saves against each other per club. Then SHARE ROW EXCLUSIVE on
`public.teams`, because the advisory lock does not stop an ordinary
`teams.manage` write ADDING or REMOVING a team underneath the complete set
validation, and an insert has no row to lock. SHARE ROW EXCLUSIVE conflicts
with ROW EXCLUSIVE, so no concurrent insert, update or delete on `teams` can
interleave; it does not conflict with ACCESS SHARE or ROW SHARE, so ordinary
reads are unaffected. It is table wide rather than club wide because PostgreSQL
has no narrower lock that blocks an insert, so a team being added to club B does
briefly wait behind club A's order save. That is stated rather than hidden:
`teams` holds a handful of rows per club and this is an admin screen's explicit
Save. Deadlock freedom follows from the fixed order and from ordinary team
writes taking neither lock.

**The expected snapshot.** `p_expected_sort_orders` is aligned with
`p_team_ids` and carries, for each team, the position that team held when the
admin's draft was drawn; `null` is a real expected value meaning the team was
unplaced. Under the locks the function requires the request to name the club's
current team set exactly (no missing, extra, duplicate or null id), compares
every stored position with the expected one, and refuses BEFORE writing if any
differ. The disjoint merge is therefore unreachable rather than merely
reported: admin two's expected values for C and D still hold, but A and B no
longer match what admin one committed. There is no version column to add, no
backfill and nothing for a future writer to remember to bump; the evidence is
the data itself.

**Refusal codes.** A stale snapshot is `P0001` carrying the DETAIL token
`stale_order`, which PostgREST returns as the error body's `details`. It was
`40001` first, and that is worth recording. The security suite showed, twice
and deterministically, that a `40001` raised by this function **never reaches a
PostgREST client**: the request hung until the caller gave up, while every
other refusal from the same function over the same client returned in tens of
milliseconds. The mechanism inside PostgREST was not isolated further; the
behaviour was reproduced, which is what decides it. A refusal the product's own
client cannot receive is not a contract.

The name was also wrong on its own terms, which is the part that would still
hold if that behaviour changed. **Nothing in the database failed to serialize.**
The transaction did what it was told; the application logic found the caller's
snapshot stale. Calling that `serialization_failure` tells every layer above
that a retry may succeed, and a retry here can never succeed: it carries the
same snapshot and is refused identically, for ever. A stable machine token in
`details` is the same shape as 0049's `stale_link` outcome strings, and it is
what separates a stale order from a malformed one without parsing English.
Not signed in and the missing capability are `42501`, as 0049.
A request that cannot be served as made is `P0001`: an array of more than one
dimension, an isolation level this cannot serialise, mismatched lengths, a null
or duplicate id, an incomplete set, or a foreign team. The dimension check is
not defensive tidiness: `array_length(x, 1)` counts only the first dimension
while every `unnest` flattens all of them, so a rectangular 4x2 array over a
four team club passes the length, duplicate, completeness and snapshot checks
and then hands the write EIGHT ordinalities, storing a position outside 1..N.
That was run before it was fixed, and the call was accepted. A foreign team id is refused by count and never
echoed back, so no other club is nameable, readable or writable through this
path.

**Security posture.** SECURITY DEFINER with `set search_path = ''` and fully
schema qualified references, so RLS does not bind it and the in body checks ARE
the enforcement. The club comes from `public.my_club()` and the caller cannot
name one. The capability check is `public.has_perm('teams.manage')`, exactly the
capability the `teams_manage` policy (0012) already names, so the function grants
no caller any authority they did not hold and narrows it, since it also refuses
requests a direct `teams.manage` update would accept. No new capability key.
There is one UPDATE statement shape in the function and it assigns `sort_order`,
so no other column can move through it, and there is no insert into or delete
from `teams` in the file. No player, registration, register entry, session or
Spond row is read, written or referenced.

**The 0051 index is untouched.** `teams_sort_order_unique` is still the last
guard, and the function's clear-then-place exists precisely because that index
is checked per row and an in place swap would collide. Both phases run inside
the one function call, so a failure at any point rolls the whole call back and
the "honestly incomplete order" a multi statement client save can leave is not
reachable through this path.

**Audit, stated honestly.** No new writer, no new action, no new vocabulary.
`audit_teams()` (0037, replaced by 0044, allow list extended by 0051) already
fires on every UPDATE of `teams` and emits `team.updated` with `changed_fields`
naming `sort_order` and never a value. The clear-then-place writes a moved,
already placed team TWICE inside the one transaction, so such a team records TWO
`team.updated` events; a team that was unplaced records one, and a team already
at its final position is not written at all and records none. Collapsing that
would mean suppressing, deferring or bypassing the trigger, each a larger and
more dangerous change to the audit boundary than the noise it would save.

Registered against `20260902150212` / `team_sort_order` with the idempotency key
`otj:migration:0052_atomic_team_order`. Its three probes are the function
resolving through `to_regprocedure` (never a textual signature cast, for the
reason 0049's review found: `has_function_privilege` raises `42883` for a name
that does not resolve, so it could not return false in the state the PRE gate
reads), the function being SECURITY DEFINER with an empty `search_path`
(`proconfig` compared against a value composed with `chr(34)`, because the
verifier refuses a probe carrying a quote), and `authenticated` holding EXECUTE
while `anon` does not, with `anon` tested rather than inferred from `PUBLIC`.

Its self-verification takes a BEFORE fingerprint of the team rows, every team's
position whole, the audit row count, the policy set, the grant set, the trigger
set and the `teams_sort_order_unique` definition into a transaction local table
BEFORE the DDL, and requires each unchanged afterwards, so "changes no data, no
policy, no grant and no trigger" is a comparison across the DDL rather than a
value compared with itself. It then reads the STORED function definition back
and asserts the boundaries the header claims, so they hold against what will
actually run rather than against what the file says.

It deliberately does NOT call the function, and section 4 of the file is that
reasoning rather than a gap. This is the one place 0051's pattern does not
carry over: 0051 added an INDEX, which any caller exercises, while
`set_team_order` is gated on an IDENTITY. It resolves `my_club()` and
`has_perm()` through `auth.uid()`, and a migration apply has no JWT, so the
function correctly refuses its own probe with `42501`. An earlier draft did
carry that probe and aborted the apply exactly there, which is the gate
working. Giving the probe an identity would mean writing a synthetic row into
`auth.users`, letting the 0029 signup trigger fire on it and forging
`request.jwt.claims`, from inside the very file whose claim is that it touches
nothing else. `0049` is the precedent and reached the same conclusion for the
same reason.

So the behavioural proof lives where a caller can have an identity, and it is
stronger there than it could have been in the file. A DO block cannot contend
with itself either, so whether TWO CONCURRENT CONNECTIONS can both commit and
leave a merge neither submitted was never provable there at all.
`.github/scripts/production-migration/test_0052_atomic_team_order.sh` is that
proof and runs in CI with `REQUIRE_POSTGRES=1`. It builds a stand-in of the
substrate as 0051 leaves it and runs eight sections: the probes total in the
state the PRE gate reads, the migration applying and ordering nobody, the
disjoint race with two real connections BOTH WAYS ROUND plus the overlapping
race and the per club independence of the advisory key, the atomicity of a
refusal, every gate including the foreign id refusal that does not leak, the
unset and incomplete and unchanged cases with the audit trail as documented,
eighteen mutations of the file that must each abort the apply, and a second raw
apply. The race sections assert that the loser actually BLOCKED before being
refused, because a race that never contends proves nothing, and assert both
that the stored order equals exactly one submission and that it is never the
merge.

Four of those eighteen are not like the other fourteen, and each is there
because something got past a check that looked sufficient. M18 is the dimension
check, invisible to any test that sends a one dimensional array.

M16 removes the isolation guard and M17 replaces it with a comment saying the
same words. The second exists because `pg_get_functiondef` returns the body's
COMMENTS, so the guard's own prose satisfied a source check anchored on the
words `transaction isolation` and `read committed`; the check now matches the
executable `if` instead. That same trap had already been sprung once in this
file without being noticed: the stale refusal's check read simply `'40001'`,
and the body's own comments say that number, which made it pass with the
errcode changed. M5 caught it on the next run. Every positive source
check is only as strong as the narrowest thing the body could say by accident.

M15 is there because the harness once lied. It re-adds a call to `set_team_order` from inside the
migration and requires the apply to abort. That defect was real: the draft that
carried a behavioural probe PASSED this harness and failed the moment CI ran
`supabase db reset`, because this harness's stand-in `my_club()` reads a GUC the
probe could set for itself while the real one resolves through `auth.uid()`. A
stand-in more permissive than the schema it stands in for is the one way this
file can mislead, so the place it did is now a test. The apply itself is also
now made on a connection asserted to hold no club and no capability, which is
the state every real apply is in.

Section H is honest about a difference from 0051. `create or replace` is
idempotent where `add column` is not, so a second RAW apply of this file is not
refused by its own self-verification; the harness asserts instead that it
changes nothing (the same rows, an identical `pg_get_functiondef` hash, still
exactly one overload), and that what refuses a second apply THROUGH THE WORKFLOW
is the ledger's unique `idempotency_key`, which the pre-apply gate hits before
any DDL runs.

`tests/security/set-team-order.test.ts` covers the contract through PostgREST on
the local stack for the roles the fixtures hold: a club admin with
`teams.manage`, a coach without it, a parent, a coach of another club and an
unauthenticated caller.

Ordering. Apply BEFORE COACH-1B (#225) merges. The pull request that replaces
the client's multi statement save with one `set_team_order` call cannot ship
against a database without the function, and #225 as it stands today is the
client save this migration exists to retire.

## What runs, in order

| Step | What it proves |
|---|---|
| Check out the selected commit | The applied file is the one at `github.sha`, not a working copy |
| Confirm target project | The typed ref equals the hardcoded ref AND the `SUPABASE_PROJECT_ID` secret |
| Confirm the migration is on the reviewed list | The path is a key of `REVIEWED_MIGRATIONS`, even when dispatched via the API rather than the dropdown |
| Pin and assert the Supabase CLI | Version `2.105.0`, the same pin the Edge Function deploys use |
| Confirm the token sees the project | `SUPABASE_ACCESS_TOKEN` authenticates and the target project is visible to it |
| Refuse a dirty working tree | Nothing uncommitted can reach the database |
| Record the apply plan | Commit SHA and the migration's SHA-256, in the step summary, BEFORE anything is applied |
| Check the connection string | `SUPABASE_DB_URL` names the expected project ref in its user or host |
| Pre-apply gate | The hosted ledger is still the reviewed one and this migration has never run |
| Apply | One transaction: ledger row, then the migration, one COMMIT |
| Post-apply gate | The migration is now the unique newest row, its recorded statement hashes to the reviewed file, and every object exists |

## The safety model

**It cannot run itself.** `workflow_dispatch` is the only trigger. Merging the
workflow changes no database, and merging a migration changes no database
either. No push, pull request, schedule or workflow_call reaches it, and a test
fails the build if one is added.

**It cannot run unapproved.** The job declares `environment: production`.
Configure a required reviewer on that environment so GitHub holds the run at
"Waiting" until a human approves it. That is a repository setting, not a file,
so nothing in the repository can prove it is set. Check it before the first
run.

**It cannot reach another project.** The operator types the project ref, and it
must equal both a ref hardcoded in the workflow and the configured
`SUPABASE_PROJECT_ID` secret. A valid token pointed elsewhere gets nowhere.

Those three checks all guard values psql never uses, so they are not enough on
their own: `SUPABASE_DB_URL` is a separate secret and is the only thing the
apply actually connects through. `check_db_url_project.py` asserts that it
names the expected project ref as a dotted component of its connection user
(`postgres.<ref>`, session pooler) or its host (`db.<ref>.supabase.co`,
direct), never as a loose substring. It runs in the pre-apply gate and again in
the apply step itself, because the step that opens the connection checks its
own connection. It never prints the string.

**It cannot apply an unreviewed file.** The migration is chosen from a dropdown
whose options are the keys of `REVIEWED_MIGRATIONS` in
`.github/scripts/production-migration/reviewed_migrations.py`. A test fails the
build if the dropdown and the register drift apart. Adding a migration to the
register is its own reviewed pull request, so "this SQL is correct" and "this
SQL may be applied to production" are one review.

**It cannot apply more than one.** There is no "apply everything pending"
operation anywhere in it. The apply opens exactly one database connection and
runs exactly one script, and tests assert both.

**It cannot apply the same migration twice.** Three independent things stop it:
the pre gate refuses when the ledger already carries the migration, the pre
gate refuses when any object the migration creates already exists, and the
ledger's UNIQUE `idempotency_key` makes the insert itself fail. The third is
the database refusing, not a script deciding.

**It cannot half-apply.** The ledger row is inserted FIRST, inside the
transaction, and the migration file's own `COMMIT` commits both together. Any
failure, including the migration's own self-verification blocks, rolls back the
schema change and the ledger row as one. A role that cannot write the ledger
fails before a single DDL statement runs. When the apply does fail, a further
step re-runs the pre gate and states in the summary whether the database is
genuinely untouched.

## Why not `supabase db push`

The repository names its migration files `0001`..`0046`. The hosted ledger
records 14 digit timestamp versions assigned at apply time: `0045_spond_links`
is recorded as `20260810182333` / `spond_links`. `db push` reconciles the two
by pushing every unapplied local file under its own file name as the version,
which would both apply more than one migration in a run and write a version
shape this ledger has never used, permanently splitting the history.

The apply instead records the migration the way every existing hosted row is
recorded: `statements` holding ONE entry with the whole file text, `name`
holding the file stem without its number, and `version` stamped from the
database server clock. That shape was read off the hosted project and is pinned
by a test (`0044_training_day_core`'s stored statement hashes to its file with
the trailing newline stripped).

## Why psql rather than the Management API

`docs/operations/content-sharing-edge-function-deploy.md` records the finding:
the classic personal access token in `SUPABASE_ACCESS_TOKEN` returns HTTP 403
against the Management API database endpoints on this project. Every database
read and the apply itself therefore go through a direct psql connection using
`SUPABASE_DB_URL`, the connection the no-residue verifier already uses from
Actions. `SUPABASE_ACCESS_TOKEN` still authenticates the pinned CLI, used here
for one thing only: proving the run is pointed at a project this account can
see, before psql opens anything.

## Required GitHub configuration

Secrets, on the `production` environment (all three already exist for the Edge
Function deploys):

- `SUPABASE_PROJECT_ID` — the target project ref, `uynorsnrvocksgqweucu`.
- `SUPABASE_ACCESS_TOKEN` — classic personal access token, used only to
  authenticate the CLI for `supabase projects list`.
- `SUPABASE_DB_URL` — the full PostgreSQL connection string from Project ->
  Connect -> Direct -> Session pooler. It carries the database password and is
  exposed only to the three steps that need it, never to the job. It is never
  printed: psql output passes through `redact.py` on success and on failure.

## Running it

1. Merge the migration and its register entry to `main` after review.
2. Actions -> "Apply production migration" -> Run workflow, from `main`.
3. Choose the migration file from the dropdown.
4. Type `uynorsnrvocksgqweucu` for `confirm_project`.
5. Approve the run when GitHub prompts (production environment gate).
6. Read the job summary: the plan with the commit and SHA-256, the pre gate,
   and the post gate with the assigned hosted version.

## Afterwards: reconcile EXPECTED_LAST_MIGRATION

The hosted ledger version is assigned BY THE APPLY, so it cannot be known
before the apply happens. The post gate prints it under "The assigned hosted
migration version".

1. Copy that value.
2. Open a SEPARATE reconciliation pull request setting `EXPECTED_LAST_MIGRATION`
   in `.github/scripts/content-sharing-deploy/verify_no_residue.py` to exactly
   that string, updating its tests, its sample fixture and
   `docs/operations/content-sharing-edge-function-deploy.md` alongside it.
3. Merge it after CI.

Until that lands, the content-sharing Edge Function deploy workflow fails
closed on its own ledger gate. That is intended: it is far safer than a check
that passes regardless.

**Reconciled.** `EXPECTED_LAST_MIGRATION` is `20260902150212`
(`0051_team_sort_order`), matching the hosted head applied on 2 September
2026. Each move is its own reviewed change rather than being folded into
anything else, and the gate fails closed between an apply and its
reconciliation, which is intended. The apply evidence behind the move is
recorded in `docs/operations/content-sharing-edge-function-deploy.md`.

`0052_atomic_team_order` is registered against that same head and not yet
applied, so the pin is current. When it applies, the version its apply stamps
goes through this same route, in its own pull request, before the
content-sharing deploy workflow will run again.

## Writing an object probe

Every register entry names the objects its migration creates, as boolean SQL
expressions that must be FALSE before the apply and TRUE after it. A probe has
to be TOTAL: false when the object is absent, true when it is present and
correct, and never an error merely because the thing it was written to find is
not there yet. The pre gate reads a database where, by definition, none of it
exists.

What breaks that is EAGER TEXTUAL OBJECT RESOLUTION. PostgreSQL's privilege
inquiry functions resolve a textual object name before doing anything else and
raise when nothing matches, so a probe written this way can never answer no:

```sql
has_function_privilege('authenticated', 'public.f(uuid)', 'EXECUTE')  -- raises
has_table_privilege('authenticated', 'public.new_table', 'SELECT')    -- raises
has_schema_privilege('authenticated', 'new_schema', 'USAGE')          -- raises
has_sequence_privilege('authenticated', 'public.new_seq', 'USAGE')    -- raises
```

Resolve the name once through the absence-safe `to_reg*` family, which returns
null, then read the privilege off the catalog row that resolution found:

```sql
(select count(*) > 0 from pg_class c
  where c.oid = to_regclass('public.new_table')
    and c.relkind = 'r'
    and has_table_privilege('authenticated', c.oid, 'SELECT'))
```

An absent object makes `c.oid = null` match nothing, so the count is 0 and the
probe is false. `to_regprocedure` for a function, `to_regclass` for a relation
or a sequence, `to_regnamespace` for a schema, `to_regtype` for a type,
`to_regrole` for a role. Where no `to_reg*` exists (a database, a tablespace, a
language, a foreign data wrapper, a foreign server) a nullable catalog lookup
yielding the oid is the same shape from another source.

Three things that look safe and are not. A `::regclass` or `::regprocedure` cast
raises exactly as the textual name does; it is the same resolution with
different punctuation. A `to_reg*` result handed STRAIGHT to a privilege
function is null rather than false, because those functions are strict, and the
gate refuses a non boolean rather than reading it as absent, so the run stops
with the reviewed object correctly missing. And a dollar quoted name is a
textual name: `$$public.new_table$$` resolves exactly as `'public.new_table'`
does, so `$` is refused outright in a probe, alongside `"` and `\`. Compose
`chr(36)` if a literal dollar is ever genuinely needed, as the register already
composes `chr(34)` for a double quote.

`assert_probe_is_total` in `verify_hosted_state.py` refuses all of these shapes
before the run connects to anything, for every privilege inquiry function
PostgreSQL 16 has and for the `regclass` argument family beside them. It is
about the ARGUMENT POSITION rather than about the punctuation inside a string,
so ordinary literals are untouched: `nspname = 'public'` and
`relname = 'players'` are comparisons, not lookups.

## What the tests cover, and what they cannot

`.github/scripts/production-migration/test_reviewed_migrations.py` and
`test_workflow_invariants.py` run in CI on every pull request. They check the
register, the gate assertions against sample hosted reads, the apply script's
statement order, and the workflow's shape.

`test_probe_totality.sh` runs in CI too, against a throwaway PostgreSQL the
job starts for it. It is the behavioural half: the offline tests pin the SHAPE
of a probe, and only a server can tell a shape mistake apart from a true
statement about the wrong string, which is what the second `0049` defect was.
It surveys every privilege inquiry function the server has, runs the four
protected object classes through the pre state, the post state and a wrong ACL,
and mutates each safe probe back to the eager textual form to prove the guard
refuses it before anything connects. CI runs it with `REQUIRE_POSTGRES=1`, which
turns every skip inside it into a failure, because a skipped proof reported as
a green check is worth less than no check at all. Run by hand it still skips
where no server is installed.

They are tripwires, not proofs. The Python tests never connect to a database,
and the harness connects only to a throwaway local one, so none of them can
tell you the migration is correct, tell you the production environment has a
required reviewer, or tell you the hosted project is in the state the register
expects. The first is what the migration's own pull request is for; the second
is the manual check above; the third is what the pre gate does at run time,
against the real database. The probe guard reads the register as text, so a
name reaching an eager function through a variable or a view is invisible to
it, and it says nothing about the role named in a probe's user argument.

The apply mechanics were exercised end to end against a throwaway PostgreSQL 16
before this shipped: a clean apply, a repeat apply refused by the unique
idempotency key, and a migration failing part way through, which rolled back
the schema change and the ledger row together.
