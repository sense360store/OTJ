# Spond API capability matrix

What the Spond consumer API offers versus what the Hub uses, audited on
2026-08-15 against the reference library `github.com/Olen/Spond` (main)
and its typed sibling `elliot-100/Spond-classes`, and reconciled against
the code again on 2026-08-15 (evening) (the corrections are marked below). The Hub
ports shapes from the reference at build time; it is a reference, not a
dependency. Standing policy throughout: read only toward Spond
(authentication is the only POST), and the children's data boundary in
`docs/security/spond-data-boundary.md`. A capability listed here is not a
commitment to use it.

## How the Hub reaches Spond

There is no Spond client library, no fork and no dependency. `package.json`
carries no Spond package, the Edge Functions import only their own
`_shared/spond.ts`, and that file is a hand written `fetch` client over one
base constant, `https://api.spond.com/core/v1/`. Three endpoints are reached
in the whole repository:

| Function | Endpoints | Gate |
|---|---|---|
| `spond-sync` | `auth2/login`, `groups/`, `sponds/` | `sessions.create` |
| `spond-link-members` | `auth2/login`, `groups/` | `players.manage` |
| `spond-roster-import` | `auth2/login`, `groups/` | `players.import` |

Only `spond-link-members` has that list asserted at deploy time
(`.github/workflows/deploy-spond-link-members.yml`); the other two workflows
carry no endpoint assertion, so this table is the record for them.

## Endpoints

| Area | Endpoint | Notes |
|---|---|---|
| Auth | `POST auth2/login` | Token at `accessToken.token`. Expiration returned but there is no refresh flow; 2FA on the account breaks login outright. |
| Events | `GET sponds/` | Params: `max` (cap, not a page; no pagination exists), `scheduled`, `minStartTimestamp`/`maxStartTimestamp` (day granularity, times zeroed), `groupId`, `subGroupId`, `includeHidden`. |
| Groups | `GET groups/` | One monolithic response: every group with its whole membership inline. No per group endpoint in use upstream. |
| Attendance export | `GET sponds/{uid}/export` | XLSX with names, no member ids. Collides with the no names boundary; unused. |
| RSVP write | `PUT sponds/{uid}/responses/{memberId}` | A write; forbidden by policy. |
| Chat, posts, payments | separate hosts/endpoints | Person authored content or person data; unused, out of scope. |

## Shapes the Hub cares about

- **Group**: `id`, `name`, `members[]`, `roles[]` (`{id, name}` definitions),
  `subGroups[]` (`{id, name}` only, no member list, no admins list),
  `fieldDefs[]`, optional `contactPerson`.
- **Member**: always `id`, `firstName`, `lastName`, `createdTime`,
  `respondent`, `subGroups: [uid]`, `fields`; optionally `email`,
  `phoneNumber`, `profile` (bound Spond account), `roles: [uid]` (absent on
  plain participants), `guardians[]` (managed child profiles).
- **Event**: `id`, `heading`, `spondType` ("EVENT"/"MATCH"), `type`
  ("EVENT"/"RECURRING"/"AVAILABILITY"), `startTimestamp`, `endTimestamp`,
  `meetupTimestamp` (matches), `cancelled`, `location`
  (`{id, feature, address, latitude, longitude}`), `responses` (five id
  arrays: accepted, declined, unanswered, waitinglist, unconfirmed, plus
  `declineMessages` free text, never read), `owners[]` (`{id, response}`,
  the organisers), `recipients` (embeds member names, never read). Four
  of the five response arrays are read; `unconfirmedIds` is not one of
  the four counts the schema holds and is never read.

## Staff and role signals

1. **`member.roles`** is the structural staff signal and the one the Hub
   uses: Spond assigns role uids only to group staff (its admin roles),
   and a plain participant has no `roles` key at all. The Hub reads the
   uids only, never role names, solely to exclude staff from the three
   member lists the Hub builds (`excludeNonPlayers`): linking candidates,
   the squad import, and the setup diagnostics, which is the one that
   makes claims about absence and therefore the one exclusion matters
   most on. Coverage caveat: staff the club never assigned a role carry
   no signal, which is what the `SPOND_IGNORED_MEMBER_IDS` secret
   backstops (opaque ids only). `spond-sync` uses neither: it reads no
   member list, and its filter is the proven set of linked members.
2. **`member.guardians` presence** would separate managed children from
   adults, but the boundary forbids reaching that key at all, even for an
   existence check. Not used.
3. **`member.respondent`** has no attested semantics upstream. Not used.
4. **`member.profile` presence** means a bound Spond account; age
   confounded and drags contact fields into reach. Not used.
5. **`event.owners[].id`** is a policy compatible per event organiser
   signal (opaque ids). Available if ever needed; unused today.
6. There is no `memberType`, no admin flag, no subgroup admins list.

## Stored event facts, and whether they reach a screen

`buildEventRow` writes exactly the fourteen columns of `SPOND_EVENT_COLUMNS`.
Two of them were stored for a long time and read by nothing:

- `location`, one free text line built from `location.feature` and
  `location.address`. It **now reaches the client**: a new session planned
  from an event defaults its venue to the club venue that line names, where
  it names exactly one (`matchVenueByLocation`, `src/lib/venues.ts`). It is a
  fact about a place and names nobody.
- `ends_at`. Still stored on every row and still read by nothing. Session
  length in this product is the sum of the planned activity durations, so
  there is no surface asking for it.

## Useful fields currently discarded

- `event.meetupTimestamp`: the touchline relevant time for fixtures.
- `location.latitude/longitude`: would enable directions; event facts.
- `event.type`: would distinguish availability requests and recurring
  instances from real events without title heuristics.
- `event.updated`: change stamp; would allow skip if unchanged syncing.
- `group.fieldDefs` + `member.fields`: where clubs actually keep shirt
  numbers; the current `shirtNumber` read targets a field no upstream
  model carries. Sits at the boundary's edge (arbitrary member data), so
  widening there needs its own decision.

## Risks

- `max` is a cap with no paging; the only remedy for overflow is window
  narrowing. **Corrected 2026-08-15 (evening):** "fails closed on truncation
  everywhere" was too broad. It holds for the whole group pass, the
  linked member read and the linking candidate and diagnostic lists,
  which all refuse rather than guess. It does not hold in two places:
  `selectGroupMembers` discards the `truncated` flag `scanGroupMembers`
  computes, so a group over `MAX_ROSTER_MEMBERS` (200) is imported from a
  silently short list; and a per mapping events query at
  `MAX_EVENTS_PER_GROUP` stores what it got and only warns. Both are
  stated here rather than changed, because changing either is a
  behaviour decision with its own review.
- Timestamps in query params are day granular.
- `groups/` grows with the club. **Corrected 2026-08-15 (evening):** the 5MB body
  cap (`readCappedJson`) is in `spond-link-members` and
  `spond-roster-import` only. `spond-sync` reads login, `groups/` and
  `sponds/` through a bare `res.json()` with no cap, so its exposure to a
  large `groups/` body is memory rather than a closed failure.
- Rate limits are undocumented; the Hub's no retry posture is the
  conservative reading.
- The API is unofficial and shapes vary by club configuration (production
  `spond_type` is null despite the sync reading it); every optional field
  must be treated as optional forever.
