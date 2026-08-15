# Spond API capability matrix

What the Spond consumer API offers versus what the Hub uses, audited on
2026-08-15 against the reference library `github.com/Olen/Spond` (main)
and its typed sibling `elliot-100/Spond-classes`. The Hub ports shapes
from the reference at build time; it is a reference, not a dependency.
Standing policy throughout: read only toward Spond (authentication is the
only POST), and the children's data boundary in
`docs/security/spond-data-boundary.md`. A capability listed here is not a
commitment to use it.

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
  the organisers), `recipients` (embeds member names, never read).

## Staff and role signals

1. **`member.roles`** is the structural staff signal and the one the Hub
   uses: Spond assigns role uids only to group staff (its admin roles),
   and a plain participant has no `roles` key at all. The Hub reads the
   uids only, never role names, solely to exclude staff from link and
   import candidate lists (`excludeNonPlayers`). Coverage caveat: staff
   the club never assigned a role carry no signal, which is what the
   `SPOND_IGNORED_MEMBER_IDS` secret backstops (opaque ids only).
2. **`member.guardians` presence** would separate managed children from
   adults, but the boundary forbids reaching that key at all, even for an
   existence check. Not used.
3. **`member.respondent`** has no attested semantics upstream. Not used.
4. **`member.profile` presence** means a bound Spond account; age
   confounded and drags contact fields into reach. Not used.
5. **`event.owners[].id`** is a policy compatible per event organiser
   signal (opaque ids). Available if ever needed; unused today.
6. There is no `memberType`, no admin flag, no subgroup admins list.

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
  narrowing. The Hub fails closed on truncation everywhere.
- Timestamps in query params are day granular.
- `groups/` grows with the club; the 5MB body cap fails closed.
- Rate limits are undocumented; the Hub's no retry posture is the
  conservative reading.
- The API is unofficial and shapes vary by club configuration (production
  `spond_type` is null despite the sync reading it); every optional field
  must be treated as optional forever.
