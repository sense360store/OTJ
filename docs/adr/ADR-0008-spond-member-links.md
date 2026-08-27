# ADR-0008: Spond member links and RSVP as register context

Status: Accepted (implemented by `supabase/migrations/0045_spond_links.sql`)
Date: 2026-08-09
Decision owners: Club owner (product); repository maintainer (security and data model)

This record decides how a Spond member becomes a known child, what per child
reply state the app stores, and how that reply state appears beside the
register. The data boundary it commits to is stated in full in
`docs/security/spond-data-boundary.md` and is not repeated here. The roster
these links resolve against is decided in
`docs/adr/ADR-0005-registered-players-and-seasons.md`.

## Context

The register shipped in `0044_training_day_core.sql` is the coach's own record
and works with nothing configured: open a session, see the children it covers,
tick who is here. Coaches also want to know who said they were coming, which
lives in Spond, where parents actually reply.

Until now the app held Spond attendance as four integer counts per event
(`0013_spond.sql`). A count tells a coach that fourteen said yes. It does not
tell them which fourteen, which is the thing they want at the gate.

Connecting the two needs a stable identity for a person on both sides. Spond
identifies a member by an opaque id; the app identifies a child by a
`public.players` row. Nothing joins them today.

## Decision

### 1. RSVP is context. Attendance is the coach's record.

This is the product rule the whole design serves, and it is a schema fact, not
a UI convention: `register_entries` gains no column, no reference and no
default from this work, and nothing in the new tables reads or writes it.

Going and not present, declined and present, and no reply and present are all
valid states and all storable. Nothing infers attendance from a reply, auto
ticks, auto clears, hides a declined child, reorders by reply, or blocks a
quick add. A club with no Spond configuration keeps the complete register; a
Spond failure shows no context rather than a misleading state.

### 2. A human binds a member to a child. No server side name matcher exists.

`player_spond_links` rows are written because a person pressed something. The
`matched_by` vocabulary is `('suggested', 'chosen')`: a name suggestion a
manager accepted, or a roster row a manager picked. Both mean a human decided.

There is deliberately no `'auto'` value, because a value implying a machine
matched would misdescribe what happened and would imply a server side name
comparison that this release does not have. Suggestions are computed in the
browser from a transient candidate list.

Rejected: seeding suggestions into the UI preselected, with one bulk press
writing them all. That makes an unreviewed bulk write the default, and the
record afterwards cannot distinguish a link a human judged from one they never
looked at.

### 3. The opaque member id is the only Spond identifier stored, and its
column check is the boundary.

`^[0-9A-F]{16,64}$` admits no space, no `@`, no `+`, no `.` and no lowercase
letter, so a name, an email address and a phone number cannot be stored in that
column by any caller, service role included. It is a check constraint below
RLS, not a validation the application could forget.

Rejected: the wider `^[A-Za-z0-9_-]{1,64}$` from the abandoned draft, which
accepted `Jack_Thompson` and therefore made the claim "a name cannot be stored
here" false.

### 4. The linked only rule and the erasure drain are the same foreign key.

`spond_event_responses_link_fk (club_id, spond_member_id) references
public.player_spond_links on delete cascade` does two jobs:

- a response row for an unlinked member is **unrepresentable**, so the sync
  cannot write one even if its own filtering were wrong;
- unlinking a child, or erasing one, removes every stored response for that
  member, club wide, in the same statement, executed by Postgres.

Rejected: enforcing "linked members only" inside the Edge Function and draining
stale rows with a client side sweep. Every step of a sweep is defeatable. It
read the stored set and the link set unbounded, and PostgREST truncates at
`max_rows = 1000` silently, so a truncated link set would have deleted live
rows and a truncated stored set would have missed stale ones. It ran only when
a caller holding `players.view` happened to press sync. It deferred erasure to
"the next re-sync", which never comes for an event outside the sync window. A
foreign key has no page, no cursor, no caller and no window.

### 5. Links are immutable: there is no update path at all.

No update policy, no update grant, and therefore no immutability trigger to get
wrong. A link is created or removed; correcting one is a delete then an insert,
and both are audited. "A link's player can never silently change" becomes a
structural fact rather than a trigger's promise.

### 6. Both read gates are `players.view`; linking takes `players.manage`.

A row in either table resolves to a named child through the roster, so it must
be no more readable than the roster itself. This is deliberately not the
capability free club wide read `spond_events` uses: aggregate counts name
nobody, these rows do. Parents hold no capabilities and read neither table.

Linking takes `players.manage` (admin and manager), because binding an opaque
id to a named child is a roster identity operation. Not `sessions.create`,
which would let every coach do it. Not `club.manage`, which is admin only and
would exclude the managers who keep the roster. Response writes take
`sessions.create`, the capability `spond-sync` already checks and the one
`spond_events` writes under, so the function's early check and the enforcement
cannot drift.

No new capability key is introduced.

### 7. Reconcile by upsert then tail delete, never delete then insert.

Per event, the sync upserts the rows it saw stamped with this run's timestamp,
then deletes only rows for that event that are strictly older. This has no
empty window, is idempotent, and leaves the previous context intact when a
write fails rather than emptying the event.

**What two overlapping runs can and cannot do, stated exactly.** Exactly one
property holds without a lock: no run can store a member nobody linked,
because `spond_event_responses_link_fk` refuses the row. That is a database
guarantee, not an ordering argument.

Two earlier drafts of this decision overstated the rest. The first claimed the
reconcile was "safe under two overlapping runs without a lock". The second
narrowed that but still claimed neither run could empty an event, reasoning
that "the upsert always lands before the delete". That ordering is a **within
run** property — `syncedAt` is one constant per invocation — and it does not
generalise across runs. Both residuals below are real and accepted.

**Residual 1, stale stamp.** The upsert sets `synced_at` unconditionally, so
an older run committing after a newer one lowers a row's stamp and the event
holds that older view of who replied.

**Residual 2, transient emptying.** The same cause, one step further. Run B
(newer, `T2`) upserts an event's rows; run A (older, `T1`) then upserts the
same rows, dropping their stamps to `T1` because `ON CONFLICT DO UPDATE`
overwrites `synced_at` downward; B's tail delete, keyed on the stamp alone
with no member restriction, then matches them all, and the event is left with
no stored context at all until the next sync.

Recorded as known debt rather than claimed away.

It is left unserialised deliberately. The cost of being wrong is a stale reply
shown as context, the next successful sync self heals it, and **attendance is
never affected**: the sync reads and writes no `register_entries`, so a raced
RSVP cannot tick, clear or reorder anything a coach recorded. A lock is not
added to Release B for this alone.

### 8. An unprovable link set means "do nothing", never "delete everything".

The sync distinguishes three states: the link set is known and non empty, known
and empty, or **unknown**. Unknown covers a failed capability probe, a failed
read, and a read that hit its cap, and in that state the response pipeline is
skipped entirely: no upsert, no delete, nothing touched. The counts still sync.

The naive collapse of unknown into empty would delete every stored response in
the club on a transient error, so the distinction is written beside the
declaration and pinned by a test on the pure derivation.

## Consequences

- `0013_spond.sql`'s statement that no member identifying data is ever
  persisted is amended, narrowly and deliberately, by 0045. The amended
  boundary is `docs/security/spond-data-boundary.md`. CLAUDE.md's Spond section
  is updated in the same change, and `comment on table public.players` is
  corrected in the migration itself, because its 0032 text asserted the club
  held no link to Spond member ids.
- Unlinked Spond members remain represented only in the aggregate counts, as
  before.
- A club that never links anybody is unaffected: no rows, no reads (the RSVP
  query never fires without a linked event), and a register identical to
  today's.
- Two Edge Functions read a Spond display name; one persists one
  (`spond-roster-import`, to the roster). `spond-link-members` returns names
  transiently and stores nothing.

## Unresolved items

None blocking. Two deliberate non goals, recorded so a later reader does not
mistake them for oversights:

- **No RSVP driven notification, reminder or chase.** Out of scope, and it
  would need a write direction toward parents this platform does not have.
- **No RSVP history.** The tables hold the current reply state per event, not a
  timeline of changes. Reconstructing "who changed their mind" is not a product
  requirement and would mean storing more per child, not less.

## Amendment, 16 August 2026: the link becomes the thing team moves ride on

Implemented by `supabase/migrations/0049_spond_team_reconcile.sql`. This
amends decision 1 (what a link is for) and nothing else; every other decision
above stands unchanged.

**What changed and why.** A link was, until now, read only context: it decided
whose reply appeared beside a child on Players &amp; groups and nothing more.
Production, 16 August, showed the club paying for that: the Spond links screen
correctly reported three Argonauts registrations whose Spond member sat in
Gladiators, in Spartans, and in no team at all, and could offer nothing but a
sentence. Spond is where the club actually moves a child between teams, so
Spond is the source of truth for the current team, and the Hub was the copy
that had drifted.

**The decision.** A durable link is now what a CURRENT SEASON team move may be
made on, and it is the ONLY thing such a move may be made on through this path.
`spond_reconcile_player_team` refuses a child who carries no link. The move is
therefore never a name match, which is the same rule `planRosterImport` states
in its own cross team guard and explicitly defers to a durable link for; that
guard is unchanged and still refuses.

**And it must be the SAME link, named.** A review found that "the child has a
link" is not the proof it looks like. The caller works the destination out from
ONE member's Spond subgroups; between the scan and the press another manager
can unlink that member and correctly link the child to a different one, whose
Spond team may be somewhere else entirely. The child still has a link and their
OTJ team need not have moved, so neither the link check nor the optimistic team
check notices, and the move would apply a destination derived from somebody
this child is no longer. So a proved call NAMES the member it reasoned from and
the function refuses (`stale_link`) when the link no longer points at it.
Exactly one of `p_expected_member_id` and `p_confirm_member_id` must be
supplied: a null never means "any existing link is acceptable".

**The confirm path, and why it does not weaken the rule.** A child who is not
linked yet cannot be moved by any amount of name agreement. What the product
may do is offer a person the chance to CONFIRM the identity, on a row the
existing two sided ambiguity rules have already proved unambiguous, in a dialog
that names both sides and both effects. The confirmation creates the link and
the move rides on it, in one transaction. That is the same "a human decided"
gate `matched_by` has always recorded, which is why the value written is
`'suggested'` and why there is still no `'auto'`.

**Consequences for the boundary.** One field moved: a setup diagnostic row now
carries the opaque member id, because resolving a linked child by identity
needs an identity and a name is not one. That amends the "a diagnostic row
carries no member id" property recorded in
`docs/security/spond-data-boundary.md`, and replaces it with a rule about the
action rather than the payload: nothing links and nothing moves from such a row
without an explicit human press, and the database refuses an unlinked child
outright. No table, column, policy, capability, trigger or vocabulary value was
added, `player_spond_links` is still immutable with no update policy and no
update grant, and Spond is still read only.

**A recorded non goal.** Nothing reconciles automatically, on a schedule or on
a page render. Every change is a manager pressing something, and the bulk
action is hidden outright while any row still needs an identity settled, so a
press can never quietly cover a row a person has not looked at.

### Two corrections from a follow-up review, before either gate ran

Both landed in `0049` while it was still unapplied, so the migration was
corrected in place rather than superseded; the reviewed path and ledger
predecessor are unchanged. It has since been applied to production, on 17
August 2026, at hosted version `20260817104226`.

- **A contested subgroup is ambiguity, and it outranks a unique one.** Two
  mappings claiming one Spond subgroup for two teams names neither team, and
  deleting the id from the resolution map made it indistinguishable from a
  subgroup nobody maps. Those carry opposite consequences for a member who is
  ALSO in one properly mapped subgroup: nobody claiming a subgroup cannot be a
  second team, two teams claiming it is a second team we cannot name. The
  contested ids are carried and checked first, in both the reconciliation and
  the read only diagnostic.
- **Losing the link race to a direct insert is a named outcome.** The RPC's
  advisory locks serialise its own callers; the linking screen's Accept and
  Choose still insert directly and take none of them. The confirmation insert
  therefore handles `unique_violation`, re-reads ownership, and reports which
  side lost instead of surfacing a raw `23505`. It never moves the team after
  losing the identity race, and never repoints or deletes the winner's link.
