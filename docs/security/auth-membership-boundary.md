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

If public email signup is enabled on the hosted project (its current
state is pending confirmation, see Hosted configuration findings below),
anyone could therefore:

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
`member_roles`). But the read compromise of all club data, plus the admin
display role in the UI, is the confirmed concern this work closes. The
severity depends on whether public signup is enabled on the hosted
project; the fix removes the metadata trust regardless, so the boundary
no longer depends on that setting.

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
   A `SECURITY DEFINER` function, restricted to the service role two
   ways: an in-body guard rejects any caller whose verified JWT role
   (`auth.role()`) is not `service_role`, and `EXECUTE` is revoked from
   `public`, `anon` and `authenticated` and granted only to
   `service_role`. It runs with an empty `search_path` and fully schema
   qualified references. It is a **provisioning** function, not a role
   editor: it moves a member from quarantined to provisioned, and it is
   idempotent for a retried invite, but it never re-shapes an
   already-provisioned member. The display role is **derived inside the
   function** from the assigned role ids (admin > manager > coach >
   parent precedence, coach for custom-only roles), so the caller cannot
   state a display role that disagrees with the roles. It enforces, in
   one transaction:
   - the member must already exist (the invite created the profile);
   - a member already in a different club is refused, so an invite for
     club A can never be claimed into club B;
   - a member already in the target club is accepted only when the whole
     requested state (display role, primary team, all-teams flag, role-id
     set, team-id set) exactly matches what the member already holds,
     making a retried invite a safe no-op; any difference is refused and
     must go through the user-role editor. This closes the
     privilege-accumulation hole where a second grant would otherwise add
     roles alongside the existing ones;
   - null role and team arrays are normalised to empty before validation,
     so a null role array is refused as empty and a primary team with a
     null or empty team set is refused;
   - every role id must belong to the target club; every team id and the
     primary team must belong to the target club; the primary team must
     be one of the assigned teams;
   - at least one role is required;
   - on the provisioning path the role and team sets are replaced
     wholesale (delete then insert), so no stale `member_roles` or
     `member_teams` row from an earlier state stays silently active.

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
- `invite-user` must be redeployed immediately after the migration is
  applied. Between the apply and the redeploy the old function is still
  live and its invites land as quarantined members (it wrote club and
  role through the invite metadata the new trigger now ignores), which
  fails closed but is not a usable account. A duplicate email invite
  returns 409, so such a half-provisioned account **cannot** be repaired
  by simply re-inviting; it is repaired by deleting the auth user in the
  Supabase dashboard and inviting again, or by calling
  `grant_club_membership` from the connector. The rollout below removes
  this window by pausing invitations across it.

## Rollout order

Apply this change in one controlled sequence so no invite is sent while
the trigger and the function are out of step:

1. **Pause invitations.** Tell admins not to send invites, or take the
   Users screen invite action offline, until step 5.
2. **Apply migration 0029** to the hosted database.
3. **Deploy `invite-user` immediately** after the migration, and verify
   the deployed source byte for byte (per the Edge Function deploy rule
   in `CLAUDE.md`).
4. **Verify a real invite:** send one invite and confirm the new member
   lands with the intended club and role (and, for a parent invite, with
   no capabilities).
5. **Resume invitations.**

If an invite was sent in the gap despite the pause, delete that auth user
in the dashboard and re-invite; do not rely on re-inviting the same email
to fix it, because the duplicate returns 409.

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
- granting membership is idempotent (an identical repeat is a no-op);
- a role change on an already-provisioned member is refused (use the role
  editor), and no admin role creeps in;
- an admin role cannot survive a later parent-only grant on the
  provisioning path (the role set is replaced, not accumulated);
- an invite for club A cannot be claimed into club B;
- roles and teams from the wrong club are refused and the member stays
  quarantined;
- a primary team with a null or empty team set is refused;
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
