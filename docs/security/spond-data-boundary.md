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
mappings do **not** reach, each reduced to `{ display_name, subgroup_ids }`
(`collectLinkDiagnostics` and `SPOND_DIAGNOSTIC_MEMBER_FIELDS` in
`supabase/functions/_shared/spond.ts`). They exist so the screen can say why a
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

- **A diagnostic row carries no member id.** Nothing can be linked from one, so
  the closed `LinkCandidate` shape stays the only thing linking is built on.
  The id is read in memory solely to count one person once across two mapped
  groups, and is returned nowhere.
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
