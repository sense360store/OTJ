# Spond data boundary

What this app persists, reads and shows from Spond, and what it never touches.
This is the authoritative statement of the boundary. Where it and an older
comment, PR description or branch disagree, this document and the migrations it
cites are correct.

Companion documents: `docs/adr/ADR-0008-spond-member-links.md` (the decision
record for member links), `docs/security/registered-players-boundary.md` (the
roster the links resolve against), `docs/security/app-audit-boundary.md` (the
append only trail).

Throughout, confirmed current behaviour carries a citation to a file and a
constraint, policy or function.

## The one sentence version

Spond is read only, attendance in this app is the coach's own record, and the
only Spond identifier stored is an opaque member id a human bound to a roster
child.

## Standing rules, unchanged

1. **Read only toward Spond.** Authentication is the only non GET call the
   platform makes. Nothing creates, modifies, cancels or responds to anything
   on Spond, and no write of any kind flows from this app to Spond without an
   explicit new decision (`supabase/functions/_shared/spond.ts`,
   `spond-sync/index.ts`).
2. **A dedicated organiser account, never a personal login.** Its credentials
   live only in the `SPOND_EMAIL` and `SPOND_PASSWORD` function secrets, never
   in the repository and never in the client. Every Spond reading function
   fails closed with a 503 when either is missing.
3. **Sync direction is Spond to app only.** Sessions are arranged and answered
   in Spond; this app holds a synced copy.
4. **Aggregates carry no identity.** `spond_events` holds four integer counts
   per event (accepted, declined, unanswered, waiting) plus event facts, and
   has no member column and no payload column by design
   (`supabase/migrations/0013_spond.sql`). `spond_type` ("EVENT" or "MATCH") is
   a fact about the event, not about a person. This is unchanged by member
   links: an unlinked Spond member is represented in the counts and nowhere
   else.
5. **Test fixtures are synthetic.** No real Spond payload is committed.

## What is persisted, exhaustively

Four tables hold a Spond **identifier**. Two other columns elsewhere hold
something Spond derived, and are named here so the list below is not read as
covering more than it does:

- `sessions.spond_event_id`, the link one Hub session carries to one mirrored
  event (`0013_spond.sql`, made unique by `0048_spond_session_link_unique.sql`).
  It references `spond_events` and holds no Spond value of its own.
- `players.display_name`, when a manager has run the Spond squad import. The
  name is then the roster's, and everything downstream reads it from there.
  See "Two functions read a Spond name; one persists one" below.

| Table | Holds | Never holds |
|---|---|---|
| `spond_groups` | a Hub team mapped to a Spond group or subgroup id, plus a team display label | any person |
| `spond_events` | four integer counts, title, times, location, cancelled, `spond_type`, plus `club_id`, `team_id` and `synced_at` | member ids, names, payload |
| `player_spond_links` | one opaque member id bound to one `players` row, who bound it and when | any Spond name, guardian, contact |
| `spond_event_responses` | one of four reply states per linked member per event, and the sync run that confirmed it | any Spond name, guardian, contact, comment, payload |

The last two arrive in `supabase/migrations/0045_spond_links.sql`. Their exact
column sets are asserted by the migration's own self verification and again by
`tests/security/spond_links.test.ts`, so adding a name capable column fails the
apply rather than passing review.

### The member id is the only identifier, and its column is the boundary

`player_spond_links.spond_member_id` is checked against `^[0-9A-F]{16,64}$`.
Uppercase hex admits no space, no `@`, no `+`, no `.` and no lowercase letter,
so a person's name, an email address and a phone number are all unstorable in
that column, by any caller, including the service role. The check is a schema
constraint below RLS, not a validation the application could forget.

Widening that character class is a boundary change and a gated migration.

### Names come from the roster, never from Spond storage

Every name the product shows for a linked child is
`public.players.display_name`. The linking screen receives a Spond display name
transiently from `spond-link-members` so a manager can tell who they are
binding, and stores none of it: the function persists nothing, the insert the
browser then sends carries exactly four fields,
`{ club_id, player_id, spond_member_id, matched_by }` (`linkRow` in
`src/lib/queries.ts`), of which only the member id is Spond derived, and the
candidate list is held in a mutation result with `gcTime: 0` so it does
not outlive the screen. The setup diagnostics below ride in the same mutation
result, under the same `gcTime: 0`, and are likewise never written anywhere.

### The linking screen's setup diagnostics

`spond-link-members` returns two lists from the one `groups/` response it
already fetches. The first is the linking candidates: the members of the team's
mapped subgroup, each reduced to `{ spond_member_id, display_name }`. The second
is the setup diagnostics: the members of that same parent group whom the team's
mappings do **not** reach, each reduced to
`{ display_name, spond_member_id, subgroup_ids }` (`collectLinkDiagnostics` and
`SPOND_DIAGNOSTIC_MEMBER_FIELDS` in `supabase/functions/_shared/spond.ts`; the
member id was added by the team reconciliation and the reasoning is below).
`LinkCandidate` was deliberately NOT widened alongside it: adding
`subgroup_ids` there would only answer whether a member of the team's own
subgroup is also in another team's, and the answer to that is "offer nothing"
either way, so the two field boundary the deploy workflow asserts buys more
than the precision would. They exist so the screen can say why a
registered player has no candidate: their Spond member is in the group with no
subgroup, or in another one, or is not in the group data at all. Those were
three different Spond side problems presenting as one unexplained list.

The scope of what is read widens by one thing and one thing only: the members of
the same already fetched parent group who sit outside the mapped subgroup. No
extra Spond request is made, and this function's own deploy workflow
(`.github/workflows/deploy-spond-link-members.yml`) refuses any source reaching
a Spond path other than `auth2/login` and `groups/`. That assertion is
`spond-link-members`'s alone; the sync and the squad import workflows carry no
equivalent, and the endpoints each reaches are stated in
`docs/spond-api-capabilities.md`. Per member the fields read
are unchanged from the candidate reduction plus the two structural lists already
described below: the opaque id, `firstName`/`lastName`, `subGroups` and `roles`.

Three properties hold by construction and are pinned by
`supabase/functions/_shared/spond_link_test.ts`:

- **A diagnostic row carries the member id, and that is an amendment.** It
  carried none while this screen could only DESCRIBE a mismatch, on the
  reasoning that nothing links from a diagnostic row so nothing needs one. The
  team reconciliation (`0049_spond_team_reconcile.sql`, and the section below)
  ends that: a child who is ALREADY LINKED is resolved against this scan by
  member id, which is the whole reason the reconciliation is not a name match,
  and a child who is not linked can only be bound to a member that has an id to
  bind. The rule that replaces the old one is about the ACTION rather than the
  payload, and is stronger for it: **nothing links and nothing moves from a
  diagnostic row without an explicit human press on a row that is unambiguous
  on both sides**, and the database refuses to move an unlinked child at all.
  The id is the same opaque uppercase hex value a candidate row already
  carries, it is still returned to one screen under `gcTime: 0`, and it is
  still persisted only when a manager presses. A member whose id the links
  table would refuse carries `''` instead, which the client reads as no
  identity and offers no action on; the row survives so the name based
  sentences below are unaffected.
- **Staff leave first.** The exclusion runs over the whole parent group before
  a single diagnostic row is emitted, so a manager or coach in another subgroup
  can never be reported as somebody's child, including the case the feature
  exists for, a role holder with no subgroup at all.
- **An unproved scan returns nothing and claims nothing.** A group the
  organiser account cannot see, a malformed payload, no mapping, and either cap
  biting all return `complete: false` **with an empty member list**, so a
  partial scan cannot be read as the whole group even by a caller that ignores
  the flag. The client then states no diagnosis in either direction: not a
  match, because a short list can hide a second member of the same name, and
  not an absence, because absence from an incomplete read is not absence. A
  name carried by more than one member is reported as ambiguous and never as a
  category that implies identity.

Who sees what is unchanged. The caller already holds `players.manage`, the
club-wide capability that the candidate list, the roster import and the whole
`players` table already ride, and every name involved is a name in the club's
own Spond group. The one honest consequence to state: because the scan covers
the parent group rather than one subgroup, a diagnostic row can name a child who
sits in a Spond subgroup the Hub maps to no team at all. That is deliberate, and
it is the case the feature exists for.

Nothing here is persisted. The diagnostics add no table, no column and no row,
and `player_spond_links` still only ever receives what a manager pressed.

### Making OTJ's team assignment agree with Spond

Spond is where the club moves a child between teams, so Spond is the source of
truth for which team a child is in now. The linking screen could already see
the disagreement and could only describe it; `spond_reconcile_player_team`
(`0049_spond_team_reconcile.sql`) is the write that closes it, and every rule
below exists because **a name is not an identity**.

That principle is not new here. `planRosterImport`
(`supabase/functions/_shared/spond.ts`) already refuses to move a child across
teams for exactly this reason, and says why: refusing on a false name match
declines one import and reports it, while acting on one would move a different
child's registration silently and would look correct. Its own comment names
this work as the sequel: "Moving on a proved identity is the reconciliation
that the durable Spond member link makes possible; it is deliberately not
attempted here." That guard is unchanged and still refuses.

**The identity rule is a database rule, not a screen's convention.** The RPC
refuses to touch a registration for a child with no `player_spond_links` row.
There are exactly two paths through it:

- **Proved.** The child already carries a link, and the caller NAMES the member
  whose Spond subgroups produced the destination. Their Spond team is read from
  the member id and the name is not consulted at all. "This child has a link" is
  deliberately not sufficient: between the scan and the press another manager
  can unlink that member and correctly link the child to a different one whose
  Spond team is somewhere else, and the child's OTJ team need not have moved, so
  neither a bare link check nor the expected-team check would notice. A link
  that no longer points at the named member is `stale_link`, and nothing moves.
- **Confirmed.** The child carries no link, so the caller must supply the
  opaque member id a human confirmed in a dialog that names both sides and both
  effects. The link is created and the team moved **in one transaction**;
  neither lands without the other. `matched_by` records `'suggested'`, which is
  what that value has always meant: a manager accepted a name suggestion
  computed in the browser. There is still no `'auto'`, because there is still
  no server side name matcher.

Exactly one of the two member arguments must be supplied, so a null can never
mean "any existing link is acceptable"; naming neither, or both, is refused
outright.

Everything else fails closed and offers nothing: a member Spond has in more
than one mapped team's subgroup, a member in a subgroup **two teams both
claim**, a member in a subgroup no team maps (which is deliberately NOT read as
Unassigned, since that would take a child out of a squad because a mapping is
missing), two Spond members of one name, two registered children of one name
anywhere in the club's current season, a scan that is not provably whole, and a
club where any team is mapped to a whole Spond group rather than a subgroup.

**A contested subgroup is evidence, not a leftover, and that was a review
finding.** When two mappings claim one subgroup for two different teams it
names neither, and the first version simply deleted it from the resolution map.
Deleting it made it indistinguishable from a subgroup nobody maps, and those
are opposite facts: nobody claiming a subgroup is silence, and a member in it
plus one properly mapped subgroup really is on that one team; two teams
claiming it is membership of a MAPPED team that cannot be named, and the same
member is then in two mapped teams' subgroups, one nameable and one not. The
first version resolved only the nameable one and offered an actionable move on
half the evidence. The contested ids are now carried beside the map as one
value (`SubgroupIndex` in `src/lib/spondLinking.ts`, one object for the reason
`EventKindContext` is one object), and membership of a contested subgroup is
checked FIRST by both readers, so it
outranks any simultaneous unique mapping. The read only diagnostic refuses too,
with its own sentence: `In Spond · in more than one team, so Spond gives no
single answer`, rather than naming one of the two teams or borrowing the
sentence about two people of one name. The rules are pure in
`src/lib/spondReconcile.ts` and the ambiguity half is not reimplemented there:
it composes `spondSetupRows`, so there is one name matcher on the screen.

What the RPC may never do, enforced by its own self-verification against the
stored function definition and exercised against a real PostgreSQL by
`.github/scripts/production-migration/test_0049_spond_team_reconcile.sh`:

- **Name a season.** The season is derived from `seasons.is_current` server
  side, so no historic or archived registration is addressable through this
  path at all. Season history is untouched by construction.
- **Create a player identity.** There is no insert into `public.players`, so
  this path cannot produce the duplicate child the roster import's cross team
  guard exists to prevent. An unregistered id is refused, never invented.
- **Remove or repoint a link.** There is no delete and no update of
  `player_spond_links` (which still has no update policy and no update grant).
  A member already bound to a different child, and a child already bound to a
  different member, are named refusals.
- **Touch the register or the mirror.** `register_entries`, `sessions`,
  `session_teams`, `spond_events` and `spond_event_responses` are not read,
  written or referenced. A saved night's attendance, inclusion and bibs are
  facts about that night and do not move when a team assignment does.
- **Contact Spond.** It makes no network call of any kind. It receives one
  opaque member id a browser already held and stores it in the one column that
  has always held one. Spond remains read only, and this adds no write toward
  it, no new endpoint and no new Edge Function.

**It is not a privilege.** It self gates on `players.manage`, exactly the
capability the `player_spond_links` insert policy and the
`player_registrations` update policy already name, so it grants no caller any
authority they did not already hold; it NARROWS that authority, because a
direct registration update carries no identity rule and this refuses an
unlinked child. It adds no capability key.

**Concurrency.** Four mechanisms, each covering a case the others cannot:

- a per `(club, player)` advisory lock, so two presses on one child are strictly
  ordered rather than interleaved;
- a per `(club, spond_member_id)` advisory lock, taken second and always second,
  which covers the case the row locks structurally cannot: a member with no link
  yet has **no row** to hold, so two confirmations of the same free member would
  both read "nobody owns this" and both reach the insert, and the loser would
  surface a raw unique violation instead of the documented
  `member_linked_elsewhere`. The fixed order is what keeps the pair deadlock
  free;
- a `unique_violation` handler around the confirmation insert, because **the
  locks bind only callers of this function** and a review made that explicit.
  The ordinary linking screen still inserts into `player_spond_links` directly,
  from Accept and from Choose, taking no advisory lock, so the confirmation
  insert can lose either unique key between its ownership read and its write.
  The database stays correct (the constraints are the enforcement); what would
  be wrong is the report. The handler re-reads ownership after the conflicting
  transaction has resolved and returns `member_linked_elsewhere` or
  `player_linked_elsewhere`, never a raw `23505`, never a move, and never a
  repointed or deleted link. A violation neither read explains is re-raised
  rather than guessed at, and the audit batch stamp is set outside the block so
  the subtransaction rollback cannot take it. This is fixed at the RPC boundary
  deliberately: requiring every present and future direct insert to join a lock
  protocol is the assumption that would rot;
- `FOR UPDATE` over every link row the decision could touch, in ONE statement
  ordered by member id, so two crossed confirmations cannot take the same two
  rows in opposite orders;
- `FOR UPDATE` on the registration plus an optimistic expected-team check: a row
  somebody else moved is refused rather than overwritten, and a row already on
  the destination is an idempotent no-op rather than a second event.

A bulk apply is one call per child, each its own transaction, so a refusal is
reported against the child it belongs to.

**The self-verification is checked to bite, not assumed to.** Its stored-source
assertions use PostgreSQL's own word boundaries (`\y`, `\M`). They previously
used `\b`, which in PostgreSQL's ARE syntax is the BACKSPACE CHARACTER rather
than a word boundary, so those checks matched nothing and passed for the wrong
reason; a review caught it. The mutation section of
`.github/scripts/production-migration/test_0049_spond_team_reconcile.sh` now
injects each forbidden thing (an insert into `public.players`, and a reference
to `register_entries`, `session_teams`, `spond_events` and
`spond_event_responses`) into the function body and asserts the apply aborts,
then runs the same injections against a `\b` version and asserts it does not,
so the tests demonstrate the difference rather than asserting a posture.

**Audit.** No new writer and no new vocabulary. The existing triggers are the
record: `player.team_changed` from `0032` with the old and new team ids and no
name, and `player.spond_linked` from `0045` carrying the fact and never the
member id. Both ride `audit_batch_context`, so one press leaves one batch and
the confirm path's two events are grouped. `audit_events.source` stays
`manual`, which is exactly what it means: a signed in person pressed a button.
Adding a `spond_reconcile` value would be an audit boundary change for a label
the paired events already imply.

### Two functions read a Spond name; one persists one

- `spond-roster-import` reads `firstName` and `lastName` for a specific mapped
  team when somebody presses Import, and writes the child's full name and an
  optional shirt number to the `players` roster. Its gate is `players.import`,
  which defaults to managers and admins, so it is not admin only. It never
  reads a guardian, a contact or any other profile field. It runs only on that
  press, never on a schedule and never as part of the attendance sync.
- `spond-link-members` reads the same two fields and returns them to the
  linking screen, for the team's mapped subgroup as linking candidates and
  for the rest of the same parent group as setup diagnostics. It persists
  nothing.
- Both of those functions additionally read two structural fields per member,
  and neither is ever persisted or logged.
  - `roles`, the list of opaque role uids Spond assigns only to group staff.
    It is read solely to exclude staff from the candidate, diagnostic and
    import lists so a coach or manager in a subgroup is never offered,
    reported or imported as a child; role names are never read. A plain
    participant has no `roles` key, and a malformed value reads as no roles,
    so a strange shape can only offer a member, never hide one. The
    `SPOND_IGNORED_MEMBER_IDS` function secret is the backstop for staff the
    club has not assigned a role: opaque member ids only, parsed through the
    same character class the links table enforces, so a name cannot be
    expressed in it.
  - `subGroups`, the list of opaque subgroup uids a member belongs to. It is
    Spond's own group structure, the same ids `spond_groups` already stores
    as mappings. It has always scoped both functions to the mapped subgroup;
    `spond-link-members` additionally returns it on a diagnostic row, which
    is how the screen distinguishes "in the group with no team assigned"
    from "in another team's subgroup". The client resolves it against the
    club's own mappings and names a team only where exactly one is mapped.
- `spond-sync` never reads a name at all. Of the member facing payload it
  reads only four of the five response arrays, for their member ids and their
  lengths; `unconfirmedIds` is not one of the four counts the schema holds and
  is never read. The event facts it stores (title, times, location, type) are
  read by `buildEventRow` and name nobody. The event `recipients` object, which
  embeds member names, is never read. It neither reads nor needs
  `SPOND_IGNORED_MEMBER_IDS`: its filter is the proven linked set, so the
  backstop covers exactly the two functions that read a name.
- **The event's `location` reaches a screen**, as of the venue prefill work.
  It is one free text line the arranger typed, stored since `0013_spond.sql`
  and written by every sync run; it is a fact about a place, names nobody, and
  is now selected by the client so a new session planned from an event can
  default to the club venue that line identifies (`matchVenueByLocation` in
  `src/lib/venues.ts`). Nothing about it is stored on the session beyond the
  chosen `venue_id`, and it reaches no public snapshot. The one stored event
  fact that still reaches no screen is `ends_at`.

## What is never persisted

Spond member names; guardian names; guardian ids; email addresses; phone
numbers; addresses; contacts; comments; arbitrary member payloads; the
`recipients` object; raw Spond response payloads of any kind. Neither new table
has a `jsonb`, `json` or array column, so there is no free shaped column
through which any of that could arrive; `tests/security/spond_links.test.ts`
asserts that directly.

## Who can read and write

Both new tables carry pseudonymous child personal data: a row resolves to a
named child through the roster. So both read gates are `players.view`, exactly
the gate `players` and `register_entries` ride, and deliberately **not** the
capability free club wide read `spond_events` uses. Parents hold no
capabilities and read neither table.

| Operation | Capability | Who holds it |
|---|---|---|
| Read links and responses | `players.view` | admin, manager, coach |
| Link or unlink a child | `players.manage` | admin, manager |
| Write response context | `sessions.create` | admin, manager, coach (the capability `spond-sync` runs under) |
| Update a link | none: there is no update policy and no update grant | nobody |

`anon` holds no grant on either table. No new capability key is introduced, so
the 22 key catalogue is unchanged.

Linking takes `players.manage` rather than `sessions.create` because binding an
opaque Spond id to a named child is a roster identity operation, not a session
one; it is not `club.manage`, which is admin only and would exclude the
managers who actually keep the roster.

## Erasure

Three cascades, all executed by Postgres in the same statement as the delete
that triggers them. There is no sweep, no scheduled job and no client side
diff, so there is nothing to truncate, skip, or fail to run.

- **Unlink a child** → every stored response for that member is removed, club
  wide (`spond_event_responses_link_fk ... on delete cascade`).
- **Erase a child** → the link goes, and the link's cascade takes the responses
  with it, in one step.
- **Delete a synced event** → its response rows go
  (`spond_event_responses_event_fk ... on delete cascade`).

That same foreign key is also the invariant: a response row for an **unlinked**
member is unrepresentable, not merely undesirable. The sync cannot write one
even if its own filtering were wrong.

## What the sync may and may not do

- It writes response rows only for members it can prove are linked. If it
  cannot read the link set completely, for any reason, it writes and deletes
  **nothing** and reports that it skipped the response context. An inability to
  prove the linked set is never read as "the linked set is empty". The reasons,
  named so the condition is auditable: the caller lacks `players.view`, any
  page of the link read errors, or the read passes `MAX_LINKED_MEMBERS`
  (2000, `spond-sync/index.ts`), which is a cap rather than a page size and so
  proves nothing beyond it.
- It reconciles an event by upserting what it saw with this run's timestamp and
  then deleting only strictly older rows for that event, so a partial failure
  leaves the previous context intact rather than emptying the event. Of the
  concurrency properties, exactly one holds without a lock: two overlapping
  runs cannot store an unlinked member, because the response foreign key
  refuses the row. They **can** leave an event holding an older view of who
  replied, and they **can** transiently leave it holding none at all, both
  because the upsert overwrites `synced_at` downward and the tail delete keys
  on that stamp alone. Both are accepted, recorded debt, self healing on the
  next sync, and neither can touch attendance. See ADR-0008 decision 7.
- It reconciles **both** event sources on the same terms: events found through a
  subgroup mapping, and events addressed to the whole parent group, which is
  where this club's weekly training is discovered and which store `team_id`
  null. One implementation serves both, so the boundary cannot hold on one path
  and not the other. Only the `responses` object of an event the pass actually
  classified is read; the unmapped subgroup's events are not carried at all.
- It never writes, reads, defaults or constrains `register_entries`. Attendance
  is the coach's record.
- It logs HTTP status, PostgREST error codes and its own mapping ids. Never a
  member id, never a name, never a payload fragment.
- Its response body reports how many response rows were written and whether the
  context was updated or skipped. It does not report how many children are
  linked, which would leak a figure the `players.view` gate withholds.

## What RSVP means in the product

RSVP is **context**. Attendance is the coach's record.

Going and not present, declined and present, and no reply and present are all
valid, all storable and all displayed without comment. Nothing in the app infers
attendance from a reply, auto ticks, auto clears, hides a declined child,
reorders a register by reply, or prevents a quick add because somebody
declined. A club that has never configured Spond gets the complete register.

A Spond failure renders as no context at all, which is the same as a child who
is not linked. It never renders as "nobody is coming", "no players", or any
other state that could be mistaken for information.

## Audit

Binding and severing a link are audited as `player.spond_linked` and
`player.spond_unlinked` against the player, through
`public.audit_domain_event`. The opaque member id is never passed as a value:
the action name alone carries the fact, and
`tests/security/spond_links.test.ts` asserts no audit row holds a member id in
any column. An unlink that is a cascade from erasing the child emits nothing,
because `player.deleted` is already the record.

Response rows are deliberately unaudited, for the reason `register_entries` is:
they are high frequency sync output, the row is the record, and one event per
member per event per run would swamp the trail.

## Public sharing

`spond_member_id`, `player_spond_links`, `spond_event_responses`, `matched_by`,
`rsvp` and their camel case variants are in the forbidden key lists on both
sides of the public sharing boundary
(`supabase/functions/_shared/share.ts`, `src/lib/publicShare.ts`). Nothing
Spond derived about a child can reach a public snapshot, and a future field
rename that reintroduced one would trip the scanner rather than leak.

## History of this boundary

`0013_spond.sql` established counts only storage and recorded that per person
attendance was a later phase "gated behind the production readiness phase and
the players data model phase, where GDPR and safeguarding get deliberate
design". `0045_spond_links.sql` is that phase. The amendment it makes is narrow
and stated in full above: one opaque identifier, for linked members only, bound
by a human, drained on unlink, and never a name.
