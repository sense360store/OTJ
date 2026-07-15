# Auth membership boundary: client metadata grants nothing

The trust boundary between Supabase Auth and the application schema,
enforced by `supabase/migrations/0029_signup_hardening.sql` and the
reworked `supabase/functions/invite-user/index.ts`, and verified
executably by `tests/security/signup.test.ts`.

## The previous risk

`handle_new_user` (from `0001_init.sql`) built each new profile row by
copying `club_id` and `role` straight out of
`auth.users.raw_user_meta_data`:

```sql
insert into public.profiles (id, full_name, club_id, role)
values (
  new.id,
  coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
  nullif(new.raw_user_meta_data ->> 'club_id', '')::uuid,
  coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::role_kind, 'coach')
);
```

`raw_user_meta_data` is client controlled. It is set by the `data` option
of `auth.signUp`, which any caller holding the anon key can send, and the
anon key ships in the browser bundle by design. It can also be rewritten
later by the account holder through `auth.updateUser`. So the metadata is
attacker chosen input, and the trigger treated it as authorisation data.

While the hosted project accepts public email signups, anyone could
therefore:

- create an auth user with `club_id` set to the club's UUID and land a
  profile row inside the club, and
- set `role: 'admin'` to carry the admin display role, and
- fall back to the `'coach'` default even with no metadata at all.

Club membership alone (a non-null `club_id` matching the club) is enough
to read every club scoped resource, because reads are club wide by
design and every select policy is `club_id = public.my_club()`:

- drills, media rows, templates, programmes, sessions (club wide since
  `0002`), boards, feedback, Spond attendance counts and mappings, the
  teams list, the players roster's existence, and every member's profile
  row;
- media Storage objects, whose read policy (`0027`) is keyed on
  `my_club()`;
- the feedback insert policy, which requires only club membership, so a
  metadata intruder could also write feedback rows.

`member_roles` stayed empty for such an account, so no write capability
on content followed (writes go through `has_perm()`, which reads
`member_roles`). But the read compromise of all club data by an
unauthenticated stranger, plus the admin display role in the UI, is the
confirmed concern this work closes.

## The chosen trust boundary

**Nothing that authorises anything is ever read from client metadata.**
Membership is granted only inside a trusted server-side transaction.

1. **`handle_new_user` quarantines every new auth user.** Whatever the
   signup carries, the new profile is written with `club_id` null and
   `role` `'parent'` (the display enum's least privileged value). No
   `member_roles`, no `member_teams`, no `team_id`. The only value still
   copied from metadata is `full_name`, a display string that appears in
   no policy and is overwritten authoritatively by the invite. The
   `profiles.role` column default is also changed from `'coach'` to
   `'parent'` so no privileged role is ever the default.

2. **A quarantined profile has no access.** `my_club()` returns null for
   a null `club_id`, and null never equals a club id, so every club
   scoped select and write policy fails closed. The account cannot even
   read its own profile row (the select policy is `club_id =
   my_club()`), read any content, or pass any write arm. `has_perm()`
   returns false for it (no `member_roles`), and the self-service profile
   update policy pins `role` and `club_id` to their current values, so it
   cannot self-escalate.

3. **`grant_club_membership()` is the single trusted path onto a club.**
   A `SECURITY DEFINER` function whose `EXECUTE` is revoked from
   `public`, `anon` and `authenticated` and granted only to
   `service_role`. It updates the profile's club, display role, primary
   team and all-teams flag, and inserts the `member_roles` and
   `member_teams` rows, all in one transaction. It enforces:
   - the member must already exist (the invite created the profile);
   - a member already in a different club is refused, so an invite for
     club A can never be claimed into club B;
   - every role id must belong to the target club; every team id and the
     primary team must belong to the target club; the primary team must
     be one of the assigned teams;
   - at least one role is required;
   - re-running with the same arguments converges to the same state
     (idempotent), so a retried invite repairs a quarantined member
     rather than erroring or duplicating rows.

4. **`invite-user` provisions through that path.** It authenticates the
   caller, requires `users.manage`, validates the roles and teams against
   the caller's own club (never the payload's), invites the email
   (metadata now carries `full_name` only), then calls
   `grant_club_membership()`. If the grant fails, the just created auth
   user is deleted again, so the invite either provisions the member
   completely or leaves nothing behind. `club_id` is always the caller's
   own club and is never taken from the request body.

## Account model

Membership is **invite-only**. There is no public registration UI: the
Login screen offers sign-in, magic link and password reset only, and
states that accounts are created by invite. The magic-link button sets
`shouldCreateUser: false` so it can only sign in an existing member, never
register a new auth user. The product has no requirement for public
self-registration; a stranger who nonetheless reaches the Auth signup
endpoint directly gets a quarantined account with no club and no access,
which is the intended fail-closed outcome rather than an error.

## Compatibility

- Existing rows are untouched. Every already-invited member keeps their
  profile, club, roles, teams and display role. The migration edits no
  data and changes only the trigger body, the `role` default, and adds
  the new function.
- The trigger change affects only auth users created after the apply.
- `invite-user` must be redeployed together with the migration. In the
  window between applying the migration and redeploying the function, an
  invite sent by the old function would create a quarantined member
  (fails closed, visible on the Users screen, repaired by re-inviting or
  by calling `grant_club_membership` from the connector). No access is
  granted incorrectly in that window.

## Rollback

Restore the `0001` trigger body and drop `grant_club_membership()`. Doing
so reopens the metadata hole, so the only sanctioned rollback is forward:
fix whatever broke and keep the boundary.

## Local test evidence

`tests/security/signup.test.ts` runs over real JWTs against the local
stack and proves:

- metadata `club_id`, `role` and `team_id` are all ignored: the profile
  is quarantined (null club, parent role, no roles, no teams);
- a direct signup reads nothing club scoped across every table and the
  media bucket;
- a direct signup holds zero capabilities, passes no write policy
  (drills and the parent-open feedback insert both refused), and cannot
  self-escalate its profile;
- an invited coach receives exactly the intended club, role and
  capabilities and can perform coach writes;
- an invited parent reads club content but holds no capability;
- granting membership is idempotent;
- an invite for club A cannot be claimed into club B;
- roles and teams from the wrong club are refused and the member stays
  quarantined;
- an unknown member and an empty role set both fail closed;
- `grant_club_membership` is not executable by anon or authenticated
  callers;
- a duplicate invite for an existing email is refused, and a forged
  invite token verifies to nothing;
- the standing fixtures still authenticate and retain their access.

## Hosted configuration findings

Read-only inspection of the hosted project (`otj-dev`,
`uynorsnrvocksgqweucu`) at the time of this change. The live migration
ledger ends at `board_player_boundary`, confirming `0029` as the next
free slot. Some Auth setting reads were blocked by connector approval in
this session; the values below marked *pending* need confirming in the
dashboard as documented follow-up. Nothing was changed.

| Setting | Local `config.toml` | Hosted | Action |
|---|---|---|---|
| Public email signup | `enable_signup = true` | pending confirm | Recommend disabling public email signup on the hosted project. The migration makes a stray signup harmless (quarantined), but disabling it removes the ability to create the account at all. |
| Anonymous sign-in | `enable_anonymous_sign_ins = false` | pending confirm | Keep disabled. |
| Email confirmation | `enable_confirmations = false` | pending confirm | Not load-bearing for this boundary; a confirmed or unconfirmed signup is quarantined either way. |
| Leaked-password protection | not set locally | pending confirm | Recommend enabling on the hosted project (defence in depth for member passwords). |
| Redirect allow-list | `site_url` + `additional_redirect_urls` | pending confirm | The invite `redirectTo` is `APP_ORIGIN`; confirm the deployed Vercel origin is on the hosted allow-list so invite links resolve. |

This PR does not change any hosted Auth setting. The dashboard follow-ups
above are recorded for a separate, human-performed change.

## Post-deployment verification

After the migration is applied and `invite-user` redeployed (both by a
human, out of this PR):

1. Read the deployed `handle_new_user` body back from the hosted
   database and confirm it writes null club and parent role.
2. Confirm `grant_club_membership` exists and that `EXECUTE` is granted
   to `service_role` only (not `anon`/`authenticated`).
3. Send a real invite from the Users screen and confirm the new member
   lands with the intended club and role.
4. Attempt a direct signup against the hosted Auth endpoint (or confirm
   public signup is disabled) and confirm the resulting profile, if any,
   is quarantined with no readable club data.
5. Re-run `get_advisors` (security) and confirm no new findings.
