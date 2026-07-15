# ADR-0003: Invite-only membership, client metadata grants nothing

Status: proposed (lands with the 0029 migration, pending review)
Date: 2026-07-15

## Context

`handle_new_user` (`0001_init.sql`) created each application profile by
copying `club_id` and `role` out of `auth.users.raw_user_meta_data`, and
defaulted `role` to `coach`. That metadata is client controlled: the
`data` option of `auth.signUp` accepts arbitrary values from anyone
holding the anon key (which ships in the browser bundle), and the account
holder can rewrite it later through `auth.updateUser`.

While the hosted project accepts public email signups, that let an
unauthenticated stranger create an auth user carrying `club_id = <the
club's uuid>` and `role = 'admin'` and receive a profile inside the club.
Club membership alone grants every club wide read (drills, media rows and
Storage objects, templates, programmes, sessions, boards, feedback, Spond
counts, teams, every profile) and passes the feedback insert policy. No
content write capability followed, because those flow from `member_roles`,
which stayed empty; but the read compromise of all club data, plus the
admin display role, is a confirmed security defect.

The full lifecycle was traced before choosing a fix: the Login screen
(sign-in, magic link, password reset, no registration form), Supabase
Auth signup, the `handle_new_user` trigger, profile creation, the
`invite-user` Edge Function, `member_roles`/`member_teams` creation, role
and team assignment, removal (`remove-user`), and first login (invite link
lands on `SetPassword`). The product is already invite-only in its UI and
its intent; the trigger was the one place that trusted the client.

## Decision

**Membership is invite-only, and no authorisation value is ever read from
client controlled metadata.**

1. `handle_new_user` writes a quarantined profile for every new auth
   user: `club_id` null, `role` `'parent'`, no roles, no teams. Only the
   `full_name` display string is copied from metadata. The `profiles.role`
   default changes from `coach` to `parent`.

2. A new `grant_club_membership()` database function is the single
   trusted path onto a club. It is `SECURITY DEFINER`, executable only by
   `service_role`, validates club scoping, is idempotent, and refuses
   cross-club claims, wrong-club roles or teams, unknown members and empty
   role sets.

3. `invite-user` provisions members through `grant_club_membership()`
   after inviting the email, and rolls back the auth user if the grant
   fails. Invite metadata carries `full_name` only.

4. The magic-link sign-in sets `shouldCreateUser: false`, so no auth flow
   in the app can register a new user; only an admin invite can.

### Alternatives considered

- **Keep reading metadata but validate it in the trigger.** Rejected: a
  trigger cannot authenticate the caller, so it cannot tell an invited
  member's metadata from a forged payload. The only safe input is no
  input.
- **Disable public signup and leave the trigger as is.** Rejected as the
  sole fix: it depends entirely on a hosted dashboard setting with no
  enforcement in the schema or the tests, and a re-enabled setting would
  silently reopen the hole. Disabling public signup is still recommended
  as defence in depth (documented as follow-up), but the boundary must
  hold in the database regardless.
- **Assign membership from the client after signup.** Rejected: that is
  the same trust-the-client mistake in a different place. Assignment
  belongs in a service-role transaction.

## Consequences

- A stray or malicious direct signup produces a quarantined account with
  no club and no access, rather than an error or a breach.
- Existing invited members are unaffected; the change edits no data.
- `invite-user` must be redeployed with the migration; the window between
  the two fails closed (invites land quarantined, repairable).
- The security suite gains `tests/security/signup.test.ts`, which proves
  the boundary over real JWTs and is part of the standing regression set.
- Hosted Auth settings (public signup, anonymous sign-in, leaked-password
  protection, redirect allow-list) are inspected and recorded in
  `docs/security/auth-membership-boundary.md` as human-performed
  follow-up; this change alters none of them.
