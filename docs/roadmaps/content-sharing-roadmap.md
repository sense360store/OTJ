# Content sharing, public coaching links, export and future content transfer

Status: scoping and design. Docs only. No application code, migration, dependency, Edge Function, hosted setting or production data is changed by this document or the branch that carries it.

Owner review required before any implementation PR begins. This roadmap ends at a review complete design; it does not implement the feature.

Grounding: every "Confirmed current state" statement below is read from the repository at the merge of PR #105 (`origin/main` at `19f287f`, migrations through `0030_audit_foundation.sql`, eight deployed Edge Functions, the audit foundation live). Statements are labelled so a proposed design is never presented as existing behaviour.

Label key:
- CONFIRMED CURRENT STATE: read from the code, migrations, hosted ledger or docs as they stand today.
- RECOMMENDED DEFAULT: the design this roadmap proposes unless owner review or new evidence overrides it.
- ALTERNATIVE: a considered option kept on the table.
- REJECTED ALTERNATIVE: an option considered and set aside, with the reason.
- UNRESOLVED DECISION: an owner decision this roadmap cannot make alone. Collected in section 30.
- FUTURE OPTION: out of the initial release, recorded for later.

---

## 1. Executive summary

Phil asked for one thing: a coach should be able to share a saved session, drill or programme with another coach, and the recipient may not have an OTJ account. This roadmap turns that request into a phased, repository grounded design.

The design separates four ideas that are easy to blur and dangerous to conflate:

- A CLUB LINK is a normal protected app URL. The recipient signs in, existing Row Level Security is the boundary, nothing public is created. This is the cheapest, safest first release and it already works for a signed in club member because all club content is club wide readable today.
- A PUBLIC SHARE LINK is an unlisted, read only snapshot that someone without an account can open. It carries a deliberately reduced public field set, it is server generated, it can be refreshed, rotated, expired and revoked, and it grants no access to any existing content table.
- An EXPORT is a downloaded or printable file generated from the same safe public projection. Once downloaded it cannot be recalled.
- A COPY or IMPORT lets a future authenticated coach create their own editable copy. It is a separate, later programme with its own provenance, rights and acceptance rules.

The first public release is view only. The recommended architecture is a stored safe snapshot read by a dedicated public Edge Function, behind a hashed URL fragment secret, on a public route that lives entirely outside the authenticated application tree. No existing content table is ever exposed to an anonymous reader.

The hardest gate is not engineering, it is content rights. The club uses England Football Learning content under terms that say it is never sold and never made public, and the current app enforces "not made public" only by being entirely behind login and keeping its media bucket private. Public sharing is therefore the first intentional breach of that boundary, and this roadmap treats third party rights as a hard prerequisite: England Football derived content and any unclassified media default to internal only, and a session or programme that nests any internal only item is blocked from public sharing in v1 rather than silently producing an incomplete plan.

The programme is sequenced so the smallest safe win ships first (internal club links), then the security substrate (capabilities, rights model, the `content_shares` schema, the token model, the audit actions), then a single vertical slice (public drill sharing), then sessions, then programmes, then management, then export, with copy and import held as a separate future programme.

## 2. User request and success definition

The originating request, verbatim in intent:

> A coach should be able to share a saved session, drill or programme with another coach. The recipient may not have an OTJ account.

Success for the overall programme:

- A coach can share a saved session, a drill and a programme.
- For a recipient who has an OTJ account and belongs to the club, sharing is a protected link that opens the existing detail page after sign in.
- For a recipient with no account, sharing produces an unlisted read only page that opens on a phone or a laptop, shows enough to use the content, and reveals nothing operational, identifying or rights restricted.
- The owner can see exactly what the public version will contain before creating it, and can refresh, rotate, expire and revoke it afterwards.
- Nothing that must not leave the club leaves it: no player names, no player ids, no dates, times, venues, teams, coaches, attendance or Spond data, no raw storage paths, no England Football content that has not been explicitly cleared for public use.
- The feature adds no anonymous read path to any existing content table, adds no new plaintext secret store, and every lifecycle action is audited without logging the secret, the snapshot or any free text.

Success for this scoping PR is defined in sections 31 and 32.

## 3. Confirmed current state

Everything in this section is read from the repository as it stands. It is the factual base the design builds on.

### 3.1 Routing and auth

CONFIRMED CURRENT STATE.

- The router is `src/App.tsx:75-129`. There is exactly one route reachable without a session: `/login` (`LoginGate`). Every other route sits inside `<Route element={<RequireAuth />}>`, and `RequireAuth` redirects to `/login` when there is no user (`src/App.tsx:39-49`). The catch all `<Route path="*" element={<Navigate to="/" replace />} />` sends unknown paths to `/`, which is itself behind `RequireAuth`.
- `RequireAuth` mounts `SessionsProvider` around the whole authenticated tree (`src/App.tsx:44-48`). `SessionsProvider` (`src/context/SessionsContext.tsx`) fires the club wide sessions list query on mount (`useSessions`, `src/lib/queries.ts`). So every signed in route initialises that query; a route placed outside `RequireAuth` initialises none of it.
- Detail routes are open to every role read only: `sessions`, `drill/:id`, `session-day/:sessionId`, `programmes/:id` sit inside `AppShell` but outside any `RequireCap`. Browse and authoring routes (`library`, `planner`, `board`, `roster`, `programmes`, `templates`, `media`) are wrapped in `RequireCap cap="sessions.create"`; a parent lacking that capability is redirected to Home. Admin routes are gated by `club.manage`, `teams.manage`, `users.manage`.
- `SetPassword` is not a standalone route; `RequireAuth` renders it inline when a session exists but `needsPassword` is true. It is not reachable without a partial session.
- Vercel serves the single page app through `vercel.json`, whose only content is `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`. Every path returns `index.html`, which bootstraps `/src/main.tsx` (the full app). `index.html` sets no `robots` meta and preconnects to Google Fonts.

Implication carried forward: a public `/share` route needs no Vercel rewrite change, but because every path loads the same bundle, the public route must be an explicit sibling of `/login` outside `RequireAuth`, and its component must mount none of the authenticated tree.

### 3.2 Authorisation model

CONFIRMED CURRENT STATE.

- All content is club wide readable by any authenticated club member. `sessions` select became club wide in `0002_teams_roles.sql` (`sessions_select_club`, replacing the original own or admin rule). `drills`, `media`, `templates`, `programmes`, `boards` all select on `club_id = my_club()`. Precise mechanism: these content select policies are written with no `TO` clause, so they apply to `public` (which includes the `anon` role); the anon role is refused not because a policy excludes it but because `my_club()` returns null for an unauthenticated caller (`auth.uid()` is null), so `club_id = null` evaluates false and the row is refused. This is a different mechanism from the Storage boundary, where `0027_storage_boundary.sql` names `to authenticated` so the anon role never evaluates the policy at all. The anon cannot read property holds either way; the live hosted `list_tables` read confirms RLS is enabled on all 20 tables. The design implication is that `content_shares` should go further than the content tables and carry no client policy at all (neither anon nor authenticated), which is stronger than the existing `TO public` content policies.
- Writes are capability based through `has_perm(capability)`, rewritten in `0012_rbac.sql` and re keyed to roles data in `0015_rbac_roles.sql`. The pattern for content is `has_perm('<domain>.manage') OR (owner AND has_perm('<domain>.create'))`, for example `sessions_update_owner_or_manager` and the same shape on drills, media, programmes, templates. Ownership is `created_by` on drills, media, templates, programmes, boards, and `coach_id` on sessions (sessions have no `created_by`).
- Roles and capabilities are data, not code. The live catalogue is 20 capability keys (hosted `capabilities` table, 20 rows), following the `<domain>.create` and `<domain>.manage` shape: `sessions.create/manage`, `drills.create/manage`, `media.create/manage`, `programmes.create/manage`, `templates.create/manage`, plus `teams.manage`, `club.manage`, `users.manage`, `players.view/manage/import/export/delete`, `seasons.manage`, `audit.view`. `users.manage` and `club.manage` are reserved to admin (`RESERVED_CAPABILITIES`, `src/lib/data.ts:102`, enforced by `role_capabilities_guard_reserved` in `0015`). System roles are admin, manager, coach, parent.
- The UI decides what to surface with `useMyCapabilities()` (`src/lib/queries.ts`), which unions the signed in user's `member_roles` into `role_capabilities` and fails closed to an empty set. Every route inlines a `manage-cap OR (create-cap AND own)` check and states in a comment that RLS is the real enforcement. Boards are the one exception, gated `mine || isAdmin` with no `boards.*` capability.

Implication carried forward: a CLUB LINK needs no new boundary because club content is already club wide readable. A PUBLIC LINK is a genuinely new boundary because no anonymous read exists anywhere today.

### 3.3 Content shapes

CONFIRMED CURRENT STATE. From `src/lib/data.ts` and the column lists in `src/lib/queries.ts`.

- Session (`SESSION_COLS`): `id, club_id, coach_id, team_id, name, focus, date, start_time, venue, age_group, status, activities, created_at, intentions, space, source_url, source_label, programme_id, programme_week, live_activity_index, live_activity_started_at, spond_event_id, board_id`. `activities` is a jsonb array of `{ phase, duration, drill_id?, title? }`. Total minutes is derived in the UI (`sessionMinutes`), not stored.
- Drill (`DRILL_COLS`): `id, club_id, title, summary, corner, skill, level, ages, duration, players, area, equipment, points, tags, media_id, created_by, created_at, setup_notes, easier, harder, theme, format, source_url, source_label`. A further column `source_key` exists on the table but is not in `DRILL_COLS`; it is queried only to identify FA imported drills and is a dedup key, not a rights flag.
- Programme (`PROGRAMME_COLS`): `id, club_id, name, focus, summary, intentions, weeks, pdf_media_id, source_url, source_label, created_by, created_at`.
- Template (`TEMPLATE_COLS`): `id, club_id, name, focus, author, activities, created_by, created_at, intentions, programme, week, programme_id, programme_week, source_url, source_label`. `author` is a member's full name in plain text, set from `profile.full_name` on insert. `programme` and `week` are legacy label columns kept one phase as a backfill source and no longer written.
- Board (`BOARD_COLS`): `id, name, formation, team_id, tokens, created_by, created_at, updated_at`. A token is exactly `{ id, number, side, x, y, playerId }`; `x` and `y` are pitch fractions 0 to 1. The `boards_tokens_minimal_shape` check constraint (`0028_board_player_boundary.sql`) refuses any other key, so no label and no name can be persisted. Names resolve at render time through the `players` select, which RLS gates to `sessions.create` holders.
- Media (`MEDIA_COLS`): `id, club_id, name, type, kind, storage_path, embed_url, yt_url, size, dims, length, pages, created_by, created_at, source_url, source_label`. `type` is one of `video, youtube, image, pdf`.

### 3.4 Media and storage

CONFIRMED CURRENT STATE.

- The `media` bucket is private (`0001_init.sql`, `public = false`). Its Storage policies name `to authenticated` only (`0027_storage_boundary.sql`), so the anon role never evaluates them and cannot read any object. Path shapes are `{club_id}/...` for club content, `{club_id}/crest/...` for the crest, and `avatars/{user_id}/...` for profile photos. Reads are club scoped; there is deliberately no UPDATE policy, so in place replacement is refused for every client and uploads always mint a fresh random path `{club_id}/{uuid}-{filename}`.
- The client signs media with `useSignedMediaUrl` (`src/lib/queries.ts`), which calls `supabase.storage.from('media').createSignedUrl(path, 3600)` from the browser under the caller's JWT, a one hour URL cached per path.
- YouTube media store `yt_url` only; the public thumbnail (`img.youtube.com`) and the `youtube-nocookie.com` embed need no signing. FA video exists in two forms, both worth accounting for: a `player.vimeo.com` embed (`embed_url` set, no `storage_path`, host allowlisted by `embedSrc` in `src/lib/data.ts`), and a downloaded FA supplied MP4 uploaded into the private `media` bucket with `storage_path` set and `source_url` still the FA page, produced by the sanctioned attach flow (`src/lib/faAttach.ts`, `useAttachFAVideoFiles`), which CLAUDE.md permits ("FA videos may be downloaded by the club and used in the app"). So stored FA video bytes do exist at private storage paths, not only embeds.
- The club crest is either a private Storage path under `{club_id}/crest/` or a URL. A bundled public static asset `public/crest.png` also exists (favicon and load failure fallback), which is safe to serve publicly.

### 3.5 The write safety substrate (PR #103, the prerequisite)

CONFIRMED CURRENT STATE. PR #103 ("Session writes: awaited, server-safe, and frozen while pending", merged 2026-07-16) states in its own description that it is a "Prerequisite for public content sharing" and that "Public content sharing remains a separate follow-up that builds on this write contract." It shipped no sharing code, no migration, no RLS change, no Edge Function.

What it established, all reusable by any share or export write flow:

- `src/lib/sessionSubmit.ts`: `createGuardedSubmit` serialises attempts (one in flight, rapid clicks ignored), awaits the write, runs the success step only after it resolves, and carries a lifecycle switch so a write settling after its surface is gone never navigates. `createPlannerActions` builds Save and Start on one shared guard. `stableCreateId` gives a create flow a stable id across retries so a retry is idempotent. `logSessionWriteError` logs the operation name and error only, never session content, because "Session drafts carry venue and team details, so they never go to the log."
- `src/hooks/useGuardedSubmit.ts`: wires the seam into React (pending and failed state, clear error on new attempt, the unmount gate, an optional synchronous pending report to a parent).
- `useUpsertSession` / `upsertSessionWrite` (`src/lib/queries.ts`): a server safe insert versus update decision; a colliding insert (PostgREST `23505`) recovers into an authorised update of the same id; the recovery sends only editable columns, never `coach_id` or `club_id`, so an unauthorised recovery updates zero rows and fails closed.
- The shared `Modal` (`src/components/ui.tsx`) gained a `dismissible` flag (default true). When false, Escape is inert, the overlay has no close handler and the X is disabled (`modalDismissControls`). `ActionError` renders a calm `role="alert"` failure with an optional Retry, and the raw error goes to `console.error` with the operation name only.

The Registered Players delivery plan names the same substrate as a prerequisite for its export and import surfaces (`docs/roadmaps/registered-players-delivery-plan.md:30,133,150`). This roadmap names PR #103 the same way: a prerequisite that is already merged, not implementation work to redo.

RECOMMENDED DEFAULT: reuse this seam for every share or export write. Do not build a second save or submit system.

### 3.6 Audit foundation

CONFIRMED CURRENT STATE. `0030_audit_foundation.sql` (PR #105) created `audit_events` and the private writer.

- Columns: `id, club_id, occurred_at, actor_id, actor_name, action, entity_type, entity_id, season_id, team_id, source, changed_fields, safe_changes, batch_id, metadata, request_id`. The timestamp is `occurred_at`.
- `action` and `entity_type` have no check constraint by design; the writers validate their own allow lists, so a new action needs no change to the table. `source` does check a fixed vocabulary that already includes `edge_function`.
- The writer `log_audit_event` is SECURITY DEFINER, `set search_path = ''`, EXECUTE revoked from public, anon and authenticated and granted to `service_role` only. Actor, actor name, club and timestamp are derived server side; a supplied `club_id` is ignored when a session exists. Its current action allow list is player and export specific, and its metadata allow list (`audit_metadata_ok`) admits only bounded scalar facts, no free text.
- `audit_events` grants authenticated SELECT only, RLS enabled with one select policy `club_id = my_club() AND has_perm('audit.view')`, and no insert, update or delete policy for any client role. The migration self verifies the SELECT only end state.
- The audit boundary document reserves three future actions, `content_share.created`, `content_share.refreshed` and `content_share.revoked` (`docs/security/app-audit-boundary.md:197`). This roadmap plans a fourth core lifecycle action, `content_share.rotated`, plus the conditional `content_share.expired` and `public_share_policy.changed`; those are not yet in the reserved catalogue. Because `audit_events.action` has no check constraint, adding them breaks no schema, but the authoritative catalogue in `app-audit-boundary.md` must be extended too, which is an explicit PR 1 step (section 27), not just a writer allow list change. So three of the four core actions are pre anticipated, not all.
- No application code invokes the writer yet; it is exercised only by the security suite through the service role.

### 3.7 Edge Functions

CONFIRMED CURRENT STATE. Eight functions, all deployed with `verify_jwt = true` (hosted `list_edge_functions`): `fa-import`, `fa-import-programme`, `invite-user`, `remove-user`, `spond-sync`, `spond-roster-import`, `feedback-to-github`, `feedback-github-refresh`. There is no public (unauthenticated) function today.

- `config.toml` has no `[functions.*]` blocks; `verify_jwt` is enforced by the deployer, not the file.
- Two families. Family A (fa-import, fa-import-programme, spond-sync, spond-roster-import, feedback-to-github, feedback-github-refresh) authenticate via `resolveCaller(req)` (`_shared/fa.ts`), which reads the caller JWT, builds a Supabase client carrying that JWT so every read and write runs under RLS as the caller, loads `profiles.club_id`, and 403s when the account has no club. Capability gates re check server side with `caller.db.rpc('has_perm', { capability })`, "the exact function the write policy uses, so the early check and the RLS enforcement cannot drift." Family B (invite-user, remove-user) hold the service role key and therefore authenticate the caller by hand and require `users.manage` by reading `member_roles` into `role_capabilities`, failing closed.
- `club_id` is never taken from a payload; it is always `caller.club_id`. The FA importers hard allowlist the URL host (`learn.englandfootball.com`, assets `cdn.englandfootball.com`) and re check the host after every redirect. `feedback-to-github` hardcodes the repository so a caller cannot redirect the issue.
- Logging is uniform: HTTP status plus our own ids, codes and counts, never payload bodies, headers or names. Spond functions refuse to read a failed login body into a log. `reply(status, body)` shapes `{ ok: true, ... }` on success and `{ error: '<sentence>' }` on failure; a missing secret is a fail closed 503; external response bodies are never echoed. CORS locks `Access-Control-Allow-Origin` to the `APP_ORIGIN` secret, never `*`, methods `POST, OPTIONS` only.
- The `_shared` modules are pure logic split from network and DB orchestration, each with a paired Deno `*_test.ts`. `fa.ts` holds shared plumbing (`corsHeaders`, `reply`, `resolveCaller`, `allowedUrl`) and the FA parser; `spond.ts` and `github.ts` hold pure derivations.
- Deploy discipline: deploy from files on disk, never inline paste (the `_shared/fa.ts` truncation lesson), and verify by reading the deployed source back byte for byte, never by trusting a version number. No deploy or readback script exists; the discipline is a documented human procedure. There is no CI check that performs the readback.

### 3.8 CI and the security test harness

CONFIRMED CURRENT STATE. `.github/workflows/ci.yml` has five jobs: `lint` (eslint), `build` (`tsc -b && vite build`, the typecheck), `test` (`vitest run`, the unit and component suite in a no DOM style), `security` (Node 22, spins a local Supabase stack, `supabase db reset` applies every migration and its self verification plus the seed, then `npm run test:security`), and `functions` (Deno `deno check` over the eight functions and `deno test` over the four `_shared` test files). The security job may sit outside required checks until it proves stable; branch protection is not visible in the repo.

- The security suite lives in `tests/security/`, runs local only (`assertLocal` refuses any non local URL), mints real JWTs for six synthetic fixture users (admin, manager, two coaches and a parent in one club, an outsider coach in a second club) through the auth admin API and `signInWithPassword`, and exercises PostgREST and Storage exactly as a production client does. A new table is tested with a read matrix, a write matrix asserting `42501` on direct writes, a writer or RPC boundary section, and rollback proven via `docker exec ... psql`. `capabilities.test.ts` pins `EXPECTED_CATALOGUE` at exactly 20 keys and separately runs a static `src` scan using a fixed `CAPABILITY_PATTERN` domain alternation. Precise coupling: only the `EXPECTED_CATALOGUE` update is required to keep the suite green, because that is what the DB catalogue is compared against. The `CAPABILITY_PATTERN` regex is a fixed list of domains and does not include a new domain; if it is not extended, the frontend scan simply fails to see the new capability strings and the suite still passes, so omitting the regex change silently drops coverage rather than failing CI. Adding a capability therefore requires the catalogue count update (gated by CI) and, separately, the regex domain update (a required manual step that CI does not enforce).
- The runtime dependency set is five packages: `@supabase/supabase-js`, `@tanstack/react-query`, `react`, `react-dom`, `react-router-dom`. There is no Playwright, Cypress or Puppeteer; there is no browser end to end suite.

### 3.9 Observability

CONFIRMED CURRENT STATE. A whole repo sweep finds no error tracking, analytics, uptime or monitoring integration (no Sentry, Datadog, PostHog, analytics, uptime probe). `src` has no client side logging. Edge Functions log status and counts to `console.error` only, and their run summaries return in the HTTP response, never persisted. There is no automated backup, retention or pruning machinery; restore is treated as an out of band operator action.

### 3.10 What does not exist

CONFIRMED CURRENT STATE. There is no share, public link, snapshot, guest, external coach or copy link feature anywhere in `src`, no `navigator.share`, no clipboard write, no `window.print`, no public route, no `content_shares` table, no rights or eligibility classification column, and no anonymous read path. The only content adjacent egress that exists is the client side `.ics` "Add to calendar" download (`src/lib/ics.ts`) and inbound imports (FA by URL, programme by URL, Spond roster). PDFs render inline; there is no session to PDF export.

## 4. Terminology

These four terms are used precisely throughout this document and should be used precisely in the product.

CLUB LINK. A protected link to an existing OTJ page, for example `/session-day/:sessionId`. The recipient must be signed in. Existing RLS remains the boundary. Suitable for another OTJ coach or manager. It may include content that is permitted internally but not publicly (attendance, dates, team) because the recipient is an authorised club member. It requires no public snapshot and makes no database write.

PUBLIC SHARE LINK. An unlisted, read only snapshot that someone without an account can open. Anyone holding the complete link can view it. It is not indexed and not discoverable. It can expire, be refreshed, rotated and revoked. It contains a deliberately reduced public field set. It grants access to no existing content table.

EXPORT. A downloaded or printable representation, initially print or PDF output. It is a file copy, not a live link. Revocation cannot recall an already downloaded file. It is generated from the same safe public projection, never directly from unrestricted application rows.

COPY or IMPORT. A future process allowing another authenticated coach or club to create their own editable copy. This is not the same as viewing. It requires provenance, duplicate handling, content rights and explicit acceptance. It is not part of the initial public link release.

Naming convention for the product: favour "Share" for links, and reserve "Export" for downloaded files. The document title uses "share" for links throughout.

## 5. Personas and journeys

The design serves these primary journeys. Each names the role behaviour, per the CLAUDE.md convention that every feature states its role behaviour.

### 5.1 Phil shares a saved session (coach, owner)

- Phil opens a saved session at `/session-day/:sessionId`.
- He chooses Share. The Share surface offers Copy club link, and Share outside the club when the session is eligible.
- For a public link he sees the exact public preview and any blocked content before creating anything.
- He confirms that anyone with the link can view it.
- He uses the phone native share sheet or Copy link.
- Later he can refresh the snapshot, rotate the link or revoke it.

Role behaviour: Phil holds `sessions.create` and owns the session (`coach_id`), so he may create and manage its shares. A parent never reaches this affordance.

### 5.2 A coach shares a drill (coach)

- The Share action sits on Drill Detail.
- The recipient sees the drill instructions, setup, coaching points and eligible media without signing in.
- The recipient cannot edit, cannot browse the club library, and cannot infer club data.

Role behaviour: the sharer holds `drills.create` and owns the drill, or holds `drills.manage`. Drills are the smallest complete content unit and the first public vertical slice.

### 5.3 A manager shares a programme (manager)

- The programme share contains its overview and ordered weeks.
- Each week contains enough safe session and drill information to use the programme.
- Restricted content prevents or limits public sharing according to the rights rule in section 13.
- The link remains read only and revocable.

Role behaviour: the sharer holds `programmes.create` and owns the programme, or holds `programmes.manage`. A programme is the largest aggregate and is sequenced last among the public content types.

### 5.4 An internal OTJ coach receives a club link

- They sign in if necessary.
- They reach the existing protected detail page.
- Existing permissions and RLS apply; all club content is club wide readable, so any club member can open it.
- No public snapshot is created unless the sender explicitly chose public sharing.

### 5.5 An external recipient with no account

- No OTJ account is required.
- No app navigation, admin shell or protected query is initialised.
- The page is mobile friendly and printable.
- Invalid, expired and revoked links all show the same neutral unavailable state.
- The page does not reveal whether a link once existed.

## 6. Product scope and non-scope

Terminology for scope, used consistently below: "the programme" is the whole PR 0 to PR 6 arc; "v1" is the first view only public release, which is PR 2 to PR 4 (public drill, session and programme sharing). Internal club links (PR 0) precede v1; export (PR 6) and copy or import (PR 7) follow it. Where a decision or acceptance criterion says v1 it means the view only public release, not the whole arc.

### 6.1 In scope for the programme

- Internal club links on Session Day, Drill Detail, Programme Detail, and saved Planner sessions.
- Public read only share links for drills, sessions and programmes, view only, with preview, create, refresh, rotate, expire and revoke.
- A safe stored snapshot per share and a public read function that returns only that snapshot.
- A content rights model that keeps England Football derived and unclassified content internal only by default.
- Print and PDF export from the safe public projection, as a later phase.

### 6.2 Explicitly NOT in v1 (RECOMMENDED DEFAULT, view only first)

- Comments.
- Public editing.
- Recipient accounts.
- Recipient email collection.
- Public search or browsing.
- A public library.
- Team chat.
- Live session watching.
- Attendance.
- Analytics identifying viewers.
- Player names.
- Copying content into another club.
- PDF export, unless delivered as the later roadmap phase (PR 6).
- Password protected shares, unless justified as a later phase.

Each of these is either a rights, privacy, safeguarding or complexity risk that the view only first release deliberately avoids. Section 29 ranks the ones worth revisiting.

## 7. Club link design (the small first release)

RECOMMENDED DEFAULT. Ship a Share action that constructs the canonical protected URL and shares it, with no public boundary, no migration and no Edge Function. This is the safest possible first step and it works today because club content is club wide readable.

Surfaces to add Share to:

- Session Day (`/session-day/:sessionId`). CONFIRMED CURRENT STATE: this is the saved session detail route, reached with a real `sessionId`; it is the safest primary session share surface because a saved session always has a stable URL and its RLS already permits any club member to read it.
- Drill Detail (`/drill/:id`).
- Programme Detail (`/programmes/:id`).
- Saved Planner session, with the constraints below.

The internal action:

- Constructs the canonical protected URL from the current entity id.
- Uses `navigator.share` when supported, falling back to Copy link.
- States "OTJ account required" so the sender knows the recipient must sign in.
- Makes no database write.
- Creates no public share.
- Does not expose an unsaved Planner draft.

Planner rules. CONFIRMED CURRENT STATE: the Planner works on a local draft held in React state; a new plan has no `/session-day` URL until it is saved through `upsertSession`, and there is no autosave.

- An unsaved new session cannot be shared. There is no stable URL to share.
- A dirty saved session must save successfully before its refreshed saved content is shared. A "Save and share" action is appropriate, with microcopy that makes the double effect explicit ("This saves your changes, then shares the link"), so a coach who made experimental or half finished edits knows Share will first persist those edits to the club wide saved session and overwrite the previous version, and that what gets shared is the saved version.
- The established PR #103 guarded save seam (`createGuardedSubmit` / `useGuardedSubmit`) is reused for "Save and share". No second save system is built.

REJECTED ALTERNATIVE: sharing a Planner draft by serialising it into the URL. It would leak venue, team and other draft fields into a link and bypass RLS entirely. The draft is never shared; only a saved, RLS protected session is.

UNRESOLVED DECISION (section 30): whether PR 0 (internal club links) ships as an early standalone win before the full sharing roadmap is approved, or waits for the roadmap approval so the Share surface is designed once. Recommended: ship PR 0 early because it carries no public boundary, provided the Share surface is built to accept a later "Share outside the club" affordance without a redesign.

## 8. Public share design

### 8.1 The snapshot model comparison

The core architectural choice is how an anonymous reader gets data. Five options:

- A. Anonymous RLS on live content. Add an anon select policy to `sessions`, `drills`, `programmes`, etc., scoped by a share token somehow.
- B. Public Edge Function reading live rows. A public function reads the live tables with the service role and projects a safe subset at request time.
- C. Stored safe snapshot. At share creation the server builds a reduced, safe projection and stores it; the public function returns only that stored snapshot.
- D. Generated PDF only. No live page; the share is a file.
- E. Temporary guest accounts. Issue a throwaway account to the recipient.

RECOMMENDED DEFAULT: C, a stored safe snapshot, read by a public Edge Function (option B's function shape) but reading the stored snapshot rather than live rows.

Why C:

- Later private edits do not become public without an explicit Refresh, so a coach editing a session after sharing it does not silently change or expand what the public sees.
- Revocation is immediate: the public read checks `revoked_at` and returns the neutral unavailable response.
- The exact public field set is centrally controlled in one snapshot builder, not scattered across query projections.
- Existing application tables remain unavailable to anon: the public function returns snapshot columns only and never selects a content row.
- The public page does not need to initialise the authenticated app.
- Snapshots carry a schema version, so they can be migrated deliberately.

Why not the others:

- REJECTED ALTERNATIVE A (anonymous RLS on live content): it adds an anonymous read path to the live content tables, the exact boundary this design must never cross. A token scoped anon policy would still expose the live row shape, would evolve as the schema evolves, and one policy mistake exposes everything. CONFIRMED CURRENT STATE is that no table has an anon policy; this design keeps it that way.
- REJECTED ALTERNATIVE B (public function reading live rows): safer than A but it recomputes the safe projection on every request against mutable rows, so a private edit leaks immediately with no Refresh gate, and the projection logic must be perfect on every read rather than once at creation. C keeps the same public function shape but reads a frozen, reviewed projection.
- FUTURE OPTION D (PDF only): a fine later export path (PR 6) but a poor only mechanism, because it cannot be revoked and cannot be refreshed.
- REJECTED ALTERNATIVE E (temporary guest accounts): it collects or implies a recipient identity, adds an account lifecycle, and grants a real session into the app. It contradicts the view only, no recipient account scope.

REJECTED ALTERNATIVE, the most literal reading of the request: invite the external coach as a real club member through the existing `invite-user` flow. Rejected because club membership grants club wide read of all content and, critically, read of the `players` roster, the only table holding children's names (gated to `sessions.create`). An external or other club coach must never receive that. An unlisted read only snapshot with a reduced public field set gives the recipient exactly what they need to use one piece of content and nothing else, which membership cannot do. This is why the programme builds a public sharing apparatus rather than expanding membership.

### 8.2 Honest limitation on immutability

The roadmap must not claim stronger immutability than the system enforces.

- CONFIRMED CURRENT STATE: the `media` bucket has no UPDATE policy, so in place replacement of an object is refused for every client, and app uploads always mint a fresh random path. Under normal app operation the bytes at a given path do not change.
- Residual: a text snapshot is fixed once stored, but a private Storage object at a path the snapshot references could be deleted and a different object placed by an authorised client (delete then insert) or by a service role operator, and a deleted object simply becomes unavailable. So the underlying media bytes are not perfectly immutable unless assets are copied into the snapshot or content addressed. This roadmap does not copy media bytes in v1; it references paths and signs them briefly, and it states this residual plainly. Section 20 covers the media handling; section 23 lists the delete then recreate threat.

### 8.3 Owner experience (one shared Share surface)

RECOMMENDED DEFAULT: one Share surface, built on the existing `Modal` primitive (`dismissible={!writing}`), using progressive disclosure so the common one handed path is a single obvious tap and the advanced controls are tucked away.

Primary layer (what a coach sees first):

- Copy club link (always, for any club member with read access).
- Share outside the club, when eligible: a Preview of the exact public version, and a single Create and share action.
- After Create or after a new link is issued, the primary layer shows the native Share and Copy link controls and the one time link itself (section 14).

Secondary layer, behind a "Manage this link" step, so destructive and advanced actions do not sit next to the everyday Share:

- Update what people see (the Refresh action).
- Replace this link (the Rotate action), with clear warning that the old link stops working.
- Turn off this link (the Revoke action).
- Status shown as plain text: Active with the expiry ("Active, expires in 89 days"), Expired with a one tap extend, or Off.

Coach facing labels. The engineer terms Refresh, Rotate and Revoke are used only in code and this document, never on buttons. The buttons read in plain language: "Update what people see", "Replace this link (the old link stops working)", "Turn off this link". These plain labels are the accessible labels in section 22.

Confirmation before Create. The word "unlisted" is reserved for this document and never shown to a coach. Before creating a public link the coach confirms exactly: "Anyone you send this to can open it with no login, and can pass it on. It works until you turn it off or it expires." This is the honest description of a forwardable, login free, revocable link.

Preview that directs the eye. The Preview renders the exact snapshot, and it visibly marks the coach authored free text regions (session or drill title, custom activity titles, intentions, setup notes, coaching points, area and space, media captions) as distinct from the machine safe structured fields, labelling that group "You wrote this, it will be public." The section 12 warning is attached to that free text group, not to the whole preview, so the coach's attention lands on exactly the fields that can leak a name (section 12).

Rights blocked path with a working alternative. When public sharing is blocked because the content nests England Football or other internal only material (section 13), the surface says so in coach terms ("This uses England Football content, which we can only share inside the club") and actively offers Copy club link as the working way to share it with a fellow OTJ coach, rather than leaving the coach at a dead end.

Lifecycle semantics:

- REFRESH ("Update what people see") keeps the same link, rebuilds the snapshot from the current saved content, rechecks permissions and rights, and updates `refreshed_at`. It does not publish unsaved Planner state; it reads the saved row.
- ROTATE ("Replace this link") invalidates the previous secret immediately and produces a new complete link. The snapshot is retained (rotation is about the secret, not the content). Rotate is an owner action; a manager holding `shares.manage` may Revoke any club share but does not Rotate another coach's share, because rotation silently kills the owner's distributed link and hands the new secret to the wrong person (section 18).
- REVOKE ("Turn off this link") immediately makes the public read return the generic unavailable response, does not delete the underlying drill, session or programme, records an audit event, and clears the stored snapshot and the share's dependency rows in the same transaction (RECOMMENDED, section 30 decision 19), so any free text that evaded the preview does not persist.
- EXPIRY prevents public reads the moment `expires_at` passes (the read compares it, no background process needed to block access), and returns the same generic response as invalid and revoked. The snapshot of an expired share is physically cleared by a scheduled private cleanup after a short retention window, not instantly, so an expired share can still be extended by Refresh during that window; after the window the cleanup nulls the snapshot and removes the dependency rows and emits `content_share.expired` (section 8.4, section 19, section 26).

### 8.4 Expiry policy

Comparison: no expiry; a fixed default; optional expiry; different defaults per content kind.

RECOMMENDED DEFAULT to evaluate (UNRESOLVED DECISION, section 30):

- Default 90 days.
- The owner may shorten it.
- A manager (`shares.manage`) may allow no expiry.
- Expiry can be extended through Refresh (Refresh recomputes `expires_at`) during the retention window below.
- Expired links return the same response as invalid and revoked.

Executable expiry model (resolving the contradiction the review flagged between "cleared on expiry" and "evaluated only at read time"):

- Enforcement is at read time: `read_public_share` compares `expires_at` to now and returns the generic unavailable response the instant a share is past expiry. No background process is needed to block access.
- Physical clearing is deferred: a scheduled private cleanup nulls the `snapshot` and removes the `content_share_dependencies` rows for shares whose `expires_at` passed more than a short retention window ago (for example seven days), and emits `content_share.expired`. During the window an expired share is inaccessible but still stored, so a Refresh can extend it.
- The cleanup process has a defined owner (the operational owner named in section 25), a defined cadence (daily is ample), failure monitoring through the same operational baseline, and a test (section 24). It also clears the snapshot of revoked shares as a backstop, though Revoke already clears in its own transaction.
- If no scheduler is approved, the fallback is honest: enforcement stays at read time (expired shares serve nothing), but the "expiry automatically clears the snapshot" claim is removed and the retained data limitation is recorded (an expired share keeps its stored snapshot until Revoke or manual cleanup). The recommended model is the scheduler; the fallback never leaves a false claim in the document.

The programme use case complicates a flat 90 day default: a six week programme is reused across a season and beyond, so a coach who shares a programme with an external colleague may reasonably want it live for months. Do not accept the 90 day default without assessing the programme case; a per kind default (drills and sessions 90 days, programmes 180 days or manager set none) is a reasonable outcome.

## 9. Export design

RECOMMENDED DEFAULT: public link first, export later (PR 6). Export is print or PDF from the same safe public projection, never a direct row to file path.

- The public share page carries a print stylesheet; browser print or "Save as PDF" is the initial export, generated from the rendered safe snapshot.
- If browser print proves inadequate (page breaks across activities, board rendering), a server generated PDF is a later option, still built from the safe snapshot, never from unrestricted rows.
- The rights rules are identical to public sharing: an internal only or nested restricted item blocks export exactly as it blocks a public link.
- The UI states clearly that a downloaded file cannot be revoked. Revocation controls the live link and future downloads, not copies already saved.

REJECTED ALTERNATIVE: an "export session to PDF" affordance that reads the live session row and renders every field. It would bypass the safe projection and could print venue, team, coach, date and attendance. Export must consume the snapshot, not the row.

UNRESOLVED DECISION (section 30): whether browser print satisfies the export need or a generated PDF is required. Recommended: start with browser print from the public projection and only build a generated PDF if the print output is inadequate.

## 10. Future copy and import design

FUTURE OPTION. Copy and import is a separate later programme (PR 7), not part of the public link release. It lets an authenticated coach or club create their own editable copy of shared content.

Requirements when it is built:

- The recipient signs in.
- They preview provenance and rights before importing.
- They explicitly import an editable copy; nothing is copied by viewing.
- The copy gets new ids and does not impersonate the source owner.
- Source attribution is retained.
- Duplicate handling is explicit (the club may already hold the same FA imported drill; the existing `source_key` dedup identity is the natural key to reuse).
- Source club data is not exposed to the importer beyond the safe projection.
- Imported third party content obeys its rights class; FA content that is internal only to the source club cannot be laundered into another club by import.
- Every import writes an audit event.

This is deliberately deferred because it multiplies the rights surface (content crossing a club boundary), needs a provenance and acceptance model, and is not required to answer Phil's request. Treat it as its own scoping exercise if its complexity warrants, mirroring the Registered Players import and export work that already exists as a separate programme.

## 11. Exact public field allow lists

These are the load bearing safety artefacts. A snapshot builder is an allow list, never a deny list: it names the fields that may appear and copies only those. A recursive allow list scanner asserts that no key outside the allow list ever reaches the public payload. The builder lives in a pure `_shared` module with Deno tests (section 24).

Eligibility is fail closed, not silent drop. In v1, "eligible referenced media" and "eligible referenced drills" below mean the share is built only when every referenced item is rights eligible; if any nested drill, media, board or attached PDF is `internal_only`, the entire share is BLOCKED (the coach is told why and offered the club link, section 8.3), never published with the offending item silently omitted. Dropping a nested FA diagram while its FA drill text still publishes would be exactly the "not made public" breach the rights model exists to prevent. This block rule applies to a standalone drill share as much as to a session or programme (section 13.2). The allow lists here therefore define what a share contains once it is eligible; the eligibility gate in section 13 decides whether the share may exist at all.

### 11.1 Public session snapshot

RECOMMENDED DEFAULT. Include:

- `snapshotVersion` (schema version integer).
- `kind` ("session").
- `displayTitle` (from `session.name`, free text, see section 12).
- `focus`.
- `ageGroup` (the `age_group` label, for example "U8s", not a team).
- `totalDuration` (derived sum of activity durations, minutes).
- `intentions` (free text array, see section 12).
- `space` (the setup or area requirement, free text).
- `activities`, ordered, each carrying: `phase`, `duration`, and either a `customTitle` (for a custom activity, free text) or a snapshot local reference to a safe drill snapshot. Content sufficiency limitation, stated plainly: a custom (non drill) activity carries only a title and a duration (CONFIRMED: `Activity` is `{ phase, drillId?, title?, duration }`, `src/lib/data.ts`; there is no description field), so it renders to the external viewer as a heading with a time and no instructions. A session built mostly from custom activities is thin for someone who was not in the room. The preview shows the sharer that those phases will appear as bare labels, and a session intended for external use is best built from drill backed activities. This is a known v1 content sufficiency limit, not a defect to fix in the snapshot.
- `referencedDrills`: the full section 11.2 drill snapshots (setup, area, equipment, coaching points, adaptations and all), keyed by snapshot local id, so an external coach gets run ready detail for every drill embedded in the session, not a truncated stub.
- `media`: eligible referenced media (section 11.5 and 20), by snapshot local id.
- `board`: safe board presentation (section 11.4) where one is attached.
- `sourceAttribution` (`source_url`, `source_label`) where present and rights eligible.
- `snapshotAt` (created or refreshed time).

Exclude (each maps to a real column that must never enter the snapshot): `club_id`; `coach_id`; coach name; `created_by` (sessions have none, but the principle stands for the referenced entities); `team_id`; team name; `date`; `start_time`; `venue`; `spond_event_id` (and therefore all attendance counts and event facts one join away); attendance counts; `live_activity_index` and `live_activity_started_at`; `status`; `programme_id` and `programme_week` (internal linkage); the real `board_id`, `media_id` and any database uuid; player names; player ids; member ids; raw media storage paths; signed URLs stored in the snapshot; audit data; internal ownership information.

Rationale for the operational exclusions (grounded in the section 3.3 leak inventory): `date`, `start_time`, `venue` and `team_id` together describe when and where a specific youth team trains, which is safeguarding sensitive if made public; `spond_event_id` is one join from attendance counts, the very boundary the counts only Spond policy protects; the live state fields reveal a session is being run right now. `age_group` is included, and deliberately so: an age band such as "U10s" on its own, absent the date, start time, venue and team, is coarse and non locating (it identifies a coaching level, not a place, a time or a named team), and it is genuinely useful to a recipient judging whether the session fits their group. This inclusion is recorded as section 30 decision 9 for owner confirmation; if the owner judges even the age band too much, it moves to the exclude list and appendix 33.2 changes with it.

### 11.2 Public drill snapshot

RECOMMENDED DEFAULT. Include:

- `title`.
- `summary`.
- `classification`: `corner` when set, otherwise the public topic `tags` (the UI already shows tags in the corner slot when `corner` is null).
- `skill`.
- `ages`.
- `level`.
- `duration`.
- `playerGuidance` (the `players` field).
- `area`.
- `equipment`.
- `setupNotes`.
- `coachingPoints` (the `points` field).
- `easier` (easier adaptations).
- `harder` (harder adaptations).
- `theme`.
- `format`.
- `sourceAttribution` (`source_url`, `source_label`) where present and rights eligible.
- `media`: eligible referenced media (section 20).

Exclude: `club_id`; `created_by` and any creator name; `created_at` and timestamps not needed by the recipient; `media_id` (internal id, replaced by a snapshot local reference); `source_key` (never in `DRILL_COLS`, and a naive select must not add it); internal database ids; storage paths; management metadata.

### 11.3 Public programme snapshot

RECOMMENDED DEFAULT. Include:

- `name`.
- `focus`.
- `summary`.
- `intentions`.
- `weeks` (number).
- `orderedWeekNumbers`.
- Per week: safe template `name` and `focus`, and `orderedActivities` referencing safe drill snapshots.
- `referencedDrills`: safe drill snapshots (snapshot local ids, not database uuids).
- `media`: eligible referenced media.
- `sourceAttribution` where present and rights eligible.
- `snapshotAt` (refreshed time).

Exclude: template `author` (a member full name in plain text, a hard exclusion); `created_by` and any creator or owner; linked club sessions and their completion state; team progress; dates and venues; internal ids; ownership. The attached programme PDF is treated as media: it appears only when its own rights class is `public_full`, and if it is `internal_only` (the default for an FA programme PDF) it blocks the whole programme share per the section 11 block rule, rather than being silently dropped from an otherwise published programme.

Nested drill representation. UNRESOLVED sub decision: repeat full drill snapshots inside a programme, or reference snapshot local ids. RECOMMENDED DEFAULT: reference by snapshot local id, with a single `referencedDrills` map, so a drill used in several weeks is stored once and the snapshot stays small. If references are used they must be snapshot local identifiers minted in the snapshot, never database uuids, so the public payload never carries a real drill id.

### 11.4 Public board snapshot

RECOMMENDED DEFAULT, and a binding constraint, not a preference. `docs/security/registered-players-boundary.md:559-564` fixes the baseline: "a shared or public board representation must strip playerId values entirely and must never resolve names. Shape and numbers only." Honour it.

For each token retain only: `number`, `side`, `x`, `y`.

Remove: `playerId` (a stable child id, even though it carries no name and resolves to nothing without the `players` select); `id` (the token id); labels; names; roster references; board ownership (`created_by`); team identity (`team_id`).

Formation name: `formation` is a standard label such as "4-4-2" and carries no personal data. RECOMMENDED DEFAULT: include `formation` as harmless and useful context. Treat the board `name` as free text (section 12), not as `formation`.

### 11.5 Public media snapshot (per referenced media item)

RECOMMENDED DEFAULT. Media is a load bearing safety artefact too, and it is the object most likely to carry a free text leak through its caption, so its own field allow list is explicit here rather than left to the appendix. For each eligible (`public_full`) media item the snapshot carries:

- `ref` (a snapshot local id, never the database media id).
- `type` (`image`, `pdf`, `video`, `youtube`).
- `caption` (from `media.name`, free text, called out in section 12 as a leak surface; a file name such as a child's first name or an opponent and date is a real vector here).
- For a stored object: a short lived signed URL produced by the read function at request time (section 20), never the raw path.
- For a YouTube item: the video id or the public thumbnail and, where `public_link_only` rights allow, a sandboxed embed (section 20).
- `sourceAttribution` (`source_url`, `source_label`) where present.

Exclude: `storage_path` (the raw path), `club_id`, the database media `id`, `created_by`, `source_key`, `size`, `dims`, `length`, `pages`, timestamps, and any embed URL for `internal_only` media (an FA Vimeo embed or a stored FA video never appears; it blocks the aggregate instead, section 13).

Note on the signed URL and the raw path: a Supabase signed URL for a stored object necessarily contains the object path in cleartext, so "never the raw path" means the snapshot does not store a path and the response carries no separate path field, but the signed URL string itself still embeds the path unless the media is copied or content addressed. Section 20 and section 23 state this residual honestly rather than claiming the path is fully hidden.

## 12. Free text risk

Known structured fields can be removed by the allow list, but the free text surface is larger than the obvious titles and notes, and it is the whole set of text bearing fields the section 11 allow lists admit. Enumerated: `displayTitle` (session name) and drill `title`; custom activity titles; `intentions`; `setupNotes`; drill `summary`; `coachingPoints` (`points`); `easier` and `harder` adaptations; `space` (session area) and `area` (drill area), which can carry a pitch or venue name such as a specific ground even though the structured `venue` field is excluded; `playerGuidance` (`players`), which can carry a pairing instruction naming children; `equipment`, `skill` and `tags`; programme `summary`; per week template `name` and `focus`; and the media `caption` (from `media.name`), a common vector for a child's first name, an opponent name or a match date in a file name.

Two risks travel on that surface: a child's name or other private detail, and a team name or venue re entering through free text after the structured `team_id` and `venue` were excluded.

The design must include:

- An exact pre publish preview. The owner sees precisely what will be public, rendered from the built snapshot, before the link is created. This is the primary control. The preview visibly marks every free text region (section 8.3), so the human check covers the full surface, not just the title.
- A calm warning attached to the marked free text group, broader than titles and names: "Check the text you wrote, the notes, setup, area and space, adaptations and any media captions. Remove any child's name, and any team or venue or pitch name you would not want public, before you share this." No alarm, no blocking on a heuristic.
- A rights line in the same warning: "Confirm this text and any diagrams are the club's own work or cleared for public use, not copied from England Football or another source." This addresses the untagged laundering path (section 13): a coach can paste third party text into a no source field, which the source based rights model classes eligible by default, so the preview is the only control for that class.
- No claim that automated filtering guarantees privacy. It cannot.
- A requirement that the server still enforces every structured exclusion regardless of preview. The preview is a human check on free text; the allow list is the machine guarantee on structured fields.

Lightweight warning scan. UNRESOLVED sub decision (section 30): whether a lightweight client side scan that flags text looking like a full name (two capitalised words) is worth adding. Assessment: false positives are common in coaching text ("Small Sided", "Third Man", place names), and false negatives are guaranteed (single names, nicknames), so a scan risks giving false confidence. If added it is a soft, dismissible hint on the preview, never a gate and never a claim of safety.

RECOMMENDED DEFAULT: do not introduce automated AI redaction in v1. The preview plus the calm warning plus the machine enforced structured allow list is the v1 control. AI redaction would add a dependency, a cost and a false sense of guarantee for no proven gain at a single club's scale.

## 13. Content rights boundary

This is a hard design gate. The current product permits England Football content inside an invite only, non commercial club application, and CLAUDE.md states it is not made public. Public sharing is the first intentional breach of that boundary.

CONFIRMED CURRENT STATE:
- CLAUDE.md, Third party content: FA content is used on the terms that images are unmodified, never recreated, the use is not for profit, and "Nothing is sold or made public. The app is invite-only club membership." FA videos "must never be sold or placed behind any paid or subscription access." For non FA third party content "the default remains link and attribute, do not copy."
- Nothing in code enforces "not made public"; it is enforced only by the whole app being behind login and the media bucket being private. The one place the app deliberately makes text world readable is the feedback to GitHub promotion, which is hand scrubbed of identifying data and never carries FA media (`Feedback.tsx`, `queries.ts`). The codebase currently equates "public" with "a GitHub issue," nothing else.
- There is no rights or eligibility classification field on any content or media row. FA versus club original versus non FA third party is inferable only at runtime from `source_url` and `source_label` via `isFaUrl` and `sourceLabelForUrl` (`src/lib/fa.ts`). Club original is signalled only by an absent `source_url`, which does not prove club originality (a coach can paste third party text into a no source field). FA images and PDFs are stored in the private bucket. FA video exists in two forms: a `player.vimeo.com` embed (no stored file) and a downloaded FA supplied MP4 stored in the private bucket with `storage_path` set and `source_url` still the FA page (`src/lib/faAttach.ts`). The `isFaUrl(source_url)` derivation classes both forms internal only, and the media rights backfill covers stored FA video bytes as well as images and PDFs.

The roadmap must not assume that imported FA text, images, videos or PDFs may be published on a public link.

### 13.1 Options for a rights model

- 1. Derive eligibility from `source_url` and media type at request time. No migration, but fragile: a coach can type any URL, absence of a source does not prove club originality, and derivation cannot record a human decision.
- 2. Add an explicit share policy to content and media. A migration, but authoritative and auditable.
- 3. Make all existing content internal only until manually classified.
- 4. Allow text while replacing restricted media with source links.
- 5. Block the whole aggregate when one nested item is restricted.

RECOMMENDED DEFAULT (a combination):

- Club links may use all content the signed in recipient is authorised to see. No rights gate is needed for a club link because the recipient is an authorised club member and RLS is the boundary.
- Public sharing requires explicit eligibility (option 2), backed by option 3's safe default and option 5's aggregate rule.
- Existing FA derived content defaults to internal only. Derivation via `isFaUrl` on `source_url` is the backfill classifier that sets the initial value; the stored value is authoritative thereafter.
- Unknown or unclassified uploaded media defaults to internal only.
- Club created text with no third party source may be eligible.
- Public YouTube links may be represented as links or embeds only when their existing public availability and embedding terms allow it (a public YouTube video is already public; this is a link, not a copy).
- Non FA third party content defaults to link and attribution, not copied content.
- Any share whose content nests an internal only item is blocked from public sharing in v1 (option 5), rather than silently producing an incomplete plan. This covers a standalone drill (with an internal only media), a session, and a programme alike. The preview names what blocked it and offers the club link instead (section 8.3).

### 13.2 Rights vocabulary

RECOMMENDED DEFAULT: a small enum, applied where it belongs.

- `internal_only`: never leaves the club. Default for FA derived content and for unclassified uploaded media.
- `public_link_only`: may appear on a public share link as a link or reference (for example a public YouTube link, an FA source URL shown as attribution) but its bytes are not published.
- `public_full`: may be published in full on a public link (club created original text and diagrams the club owns).

Which entities carry it:

- Media rows carry it, because media is where the FA rights concentrate (images, PDFs, Vimeo embeds).
- Drills, templates and programmes carry it for their own text, because a coach can paste third party text into a drill.
- The resulting aggregate (a session or a programme) is evaluated from its parts rather than carrying its own bit: a session is publicly shareable only if the session's own text is eligible and every nested drill, media and board projection is eligible. This avoids a stale aggregate bit disagreeing with its contents.

### 13.3 Downgrade behaviour

RECOMMENDED DEFAULT: a downgrade of any item to `internal_only` immediately invalidates the active public shares that depend on that item, and only those. This requires a reliable reverse index from a dependency to the shares that reference it, which the snapshot alone does not provide. Section 15 adds a private `content_share_dependencies` table for exactly this, and the downgrade path uses it:

- The rights change (a trigger on the media or content rights column, or the RPC that performs the reclassification) looks up `content_share_dependencies` by `(club_id, dependency_kind, dependency_id)` to find the active shares that reference the downgraded item, and revokes each of them transactionally in the same statement, so the downgrade and the invalidation commit together.
- It does not scan arbitrary snapshot JSON to decide what to invalidate, and it does not invalidate every share globally. Only the dependent shares are touched.
- A downgrade of a media item, a drill, a template or a programme all resolve through the same table by kind and id.

Refresh remains a second, independent safety net: a Refresh after any downgrade rebuilds the snapshot, re evaluates rights, and fails closed if the aggregate is no longer eligible. But the downgrade itself does not wait for a Refresh; it invalidates the dependents at downgrade time through the dependency table (section 15), and the public read verifies dependency eligibility on every read as a third layer (section 16.2).

### 13.4 Human confirmation required before public FA sharing

Before any public external sharing of England Football derived content is implemented, the roadmap requires a human and content owner decision, recorded by the owner:

- May any England Football text be included on a public link, or must all FA derived content remain internal only? This is UNRESOLVED DECISION 1 in section 30.
- The default this roadmap builds to is the safe one: FA derived content is `internal_only` and never public until the owner records a decision otherwise, informed by the FA's stated terms and any confirmation the club seeks from the FA.

A warning is not a substitute for rights enforcement. The rights class is enforced server side in the snapshot builder and the read function; the preview warning is an additional human check, not the control.

### 13.5 Coverage consequence, to set owner expectations

The safe default has a real product consequence that must be named, not just celebrated as a safety win. FA import is a first class, heavily used content path (the hosted library holds 103 drills and 111 media rows), so a material fraction of the real library is FA derived and therefore internal only. Because a session or programme that nests a single internal only item is blocked from public sharing in v1, Phil's actual sessions and programmes, which routinely nest FA drills and FA diagrams, may be un shareable publicly at launch. In practice, v1 public session and programme sharing will cover mostly club original aggregates until either decision 1 (allow attributed FA text publicly) is resolved or specific media is reclassified.

RECOMMENDED action before PR 3 and PR 4: run a read only count of the club original versus FA derived split of the current drills and media (a `source_url` classification tally, no content output), state the shareable fraction to the owner, and confirm with Phil that club original coverage is enough to make public session and programme sharing worth shipping before the FA rights decision lands. Public drill sharing (PR 2) is less affected because a club original drill with no restricted media is directly shareable. This is a coverage limit of the safe default, recorded as a residual, not a defect.

### 13.6 Untagged third party text residual

The source based classification cannot detect third party text pasted into a no source field: such content defaults to eligible and can reach a public link. The only control for that class is the section 12 preview and its rights confirmation line. This is a genuine residual, recorded in the threat model (section 23), and the reason the preview carries an explicit "club's own work or cleared for public use" prompt rather than relying on `source_url` alone. If the owner wants a stronger control, an explicit "club original or cleared" confirmation before publishing content whose eligibility derives only from an absent `source_url` is the option, at the cost of one extra confirmation.

## 14. Public URL and token model

RECOMMENDED DEFAULT: `/share/:shareId#secret`.

Comparison:
- A. One opaque secret in `/share/:token`. The secret travels in the path, so it lands in Vercel route logs and in Referer headers to any resource the page loads.
- B. Share id plus query secret `/share/:shareId?s=secret`. The secret is in the query string, still logged and still sent in Referer.
- C. Share id plus URL fragment secret `/share/:shareId#secret`. The fragment is never sent in the HTTP request line and never in Referer.
- D. Short code plus password. Usable, but a memorable code is guessable and a password adds recipient friction for a view only page.

RECOMMENDED DEFAULT is C. Rationale:

- `shareId` is not an authorisation secret; it is a lookup id.
- The URL fragment is not sent in the initial HTTP request, so Vercel route logs and ordinary Referer headers do not receive the secret.
- The public React page reads the secret from `window.location.hash`.
- The page sends `shareId` and `secret` to the public read function in a POST body, never in a query string.
- The database stores only a cryptographic hash of the secret.
- Rotation replaces the stored hash.
- The raw secret is returned to the owner only at creation or rotation.

Secret and hash specification:

- At least 256 bits of cryptographic randomness (`crypto.getRandomValues`, 32 bytes).
- base64url encoding, URL safe, no padding.
- SHA-256 of the raw secret is the stored lookup hash. A single SHA-256 is appropriate here because the secret is high entropy (256 bits), so a slow password hash buys nothing.
- No plaintext token column.
- No token in any log, analytics or exception message.
- A generic invalid response for any bad, missing, revoked or expired secret.
- Comparison: the `read_public_share` function looks up the row by `shareId` (an indexed primary key lookup), then compares the caller's SHA-256 digest to the stored `token_hash` as two fixed length byte arrays using a constant time comparison in the function runtime (Deno, for example `crypto.subtle` derived bytes compared with a constant time equality helper). The roadmap does NOT claim a SQL `where token_hash = $1` equality is constant time, because Postgres does not guarantee that; the constant time compare is done in the function on fixed length digests. Even so, the residual timing signal is negligible: the secret is 256 bits, the response is generic for any mismatch, and the read is rate limited, so a timing oracle yields no practical advantage. If the implementation instead does a keyed SQL lookup for simplicity, the design accepts that residual explicitly on the same grounds rather than asserting the SQL path is constant time.

Browser history and clipboard honesty:

- The full link including the fragment lands in the recipient's browser history and in whatever they paste it into. A fragment secret is protected from network logs and Referer, not from the holder's own device. This is acceptable for an unlisted view only share and is stated plainly to the owner.
- Copy link places the full link including the fragment on the clipboard, which is the intended behaviour; the owner is sharing it deliberately.

## 15. Data model

RECOMMENDED DEFAULT: one table, `content_shares`, with real foreign keys to the source entity.

Provisional fields:

- `id` uuid primary key.
- `club_id` uuid not null, references `clubs(id) on delete cascade`, derived server side from the source, never from the client.
- `kind` text, one of `session`, `drill`, `programme`, with a check constraint.
- `session_id` uuid null, references `sessions(id) on delete cascade`.
- `drill_id` uuid null, references `drills(id) on delete cascade`.
- `programme_id` uuid null, references `programmes(id) on delete cascade`.
- A check constraint proving exactly one of `session_id`, `drill_id`, `programme_id` is set and that it matches `kind`.
- `token_hash` bytea or text, the SHA-256 of the secret. No plaintext token column.
- `idempotency_key` text, set by the create, refresh and rotate calls so a lost response retry resolves to the same row (section 17).
- `snapshot_version` integer.
- `snapshot` jsonb, the stored safe public projection. Cleared to null on Revoke immediately in the lifecycle transaction; on expiry it is blocked from public reads immediately at read time (the read compares `expires_at`) and physically cleared by a scheduled private cleanup after a short retention window (section 8.4, section 26, decision 19), so no free text that evaded the preview persists indefinitely past the share's live life.
- `rights_version` or an eligibility result recorded at build time (which rights inputs were evaluated), so a later rights change can be compared against what the snapshot assumed.
- `created_by` uuid references `profiles(id) on delete set null`, the creating member.
- `updated_by` uuid references `profiles(id) on delete set null`.
- `revoked_by` uuid references `profiles(id) on delete set null`, the member who revoked (an actor id, not a timestamp).
- `created_at`, `refreshed_at`, `expires_at`, `revoked_at`, `rotated_at` timestamps.

The `on delete set null` on the three person columns is not optional: `remove-user` deletes the `profiles` row in one transaction, and the default `no action` would block removing any member who ever created, updated or revoked a share. This matches the established pattern (`drills.created_by` and `media.created_by` are `set null` in `0001`, and `0012` deliberately changed `sessions.coach_id` to `set null` for exactly this reason). Who shared what survives via the audit event's `actor_name` snapshot (section 19), not via this column.

Source entity integrity. RECOMMENDED DEFAULT: three nullable foreign keys plus the exactly one check, over a generic `entity_type`/`entity_id` pair. Real foreign keys mean source deletion invalidates the share automatically through `on delete cascade` (the share row is removed, so the public read finds nothing and returns the neutral unavailable response). A generic pair would need a trigger to emulate that and could dangle. REJECTED ALTERNATIVE: generic `entity_type`/`entity_id`, because it loses referential integrity for the one property (source deletion invalidates the share) that most cheaply satisfies a threat.

How many active links per source. Options: one active public link per source entity; multiple independent links per source; one per creator.

RECOMMENDED DEFAULT for v1: one active public link per source entity per club, enforced by three partial unique indexes, one per source column (`unique (session_id) where session_id is not null and revoked_at is null`, and likewise for `drill_id` and `programme_id`), or equivalently one expression index `unique (coalesce(session_id, drill_id, programme_id)) where revoked_at is null`. A single index on one column cannot enforce the invariant across three nullable source columns, so the wording "the source foreign key" means all three, spelled out. Rationale:

- Simpler owner UI: one status, one link, one set of controls.
- No forgotten duplicate links to track or leak.
- Refresh covers content updates, Rotate covers a compromised secret, Revoke covers removal, so the three lifecycle actions cover the real needs without multiple links.

FUTURE OPTION: multiple links and audience specific links (a link per recipient, a link with a different expiry), deferred to section 29.

Snapshot assets for signing. Media references live inside the private snapshot jsonb (the snapshot names snapshot local media ids and their storage paths), because the snapshot is never exposed raw to any client and the read path signs only those referenced paths. This is for public delivery. It is deliberately NOT the mechanism for integrity or invalidation, because a jsonb blob cannot be indexed for a reverse lookup from a dependency to the shares that use it. That is the job of the dependency table below.

### 15.1 content_share_dependencies (private reverse dependency index)

RECOMMENDED DEFAULT: a private `content_share_dependencies` table records, per share, every nested entity the share depends on, so a rights downgrade or a source change can find and invalidate exactly the dependent shares without scanning snapshot JSON and without a global sweep.

Fields:

- `id` uuid primary key.
- `share_id` uuid not null, references `content_shares(id) on delete cascade` (so deleting or cascading a share removes its dependency rows).
- `club_id` uuid not null, references `clubs(id) on delete cascade`, derived server side, for tenancy scoping and index locality.
- `dependency_kind` text not null, one of `drill`, `template`, `programme`, `media`, `board`, with a check constraint.
- `dependency_id` uuid not null, the id of the nested entity. No foreign key, deliberately: a nested entity may be deleted while the dependency row is used to decide that the share must go, and a real FK with cascade would race that decision; deletion is handled explicitly (below), not by a cascade on this column.
- `rights_class_observed` text and `rights_version` (or a single eligibility fingerprint) captured when the snapshot was built, so a later downgrade is detectable by comparison as well as by the current class.
- `created_at` timestamptz not null default now().
- Unique per `(share_id, dependency_kind, dependency_id)`, so a share lists each dependency once.
- An index on `(club_id, dependency_kind, dependency_id)` supporting the reverse lookup from a changed dependency to its dependent shares.
- No client policy at all, anon or authenticated, exactly like `content_shares`; both functions reach it only through the service role gated paths.

Lifecycle:

- Written transactionally with Create and with Refresh: the same lifecycle RPC that writes the snapshot writes the full dependency set for that share in the same transaction, so the snapshot and its dependency rows are always consistent. Refresh replaces the dependency set (delete then insert, or upsert and prune) to match the rebuilt snapshot, so a drill removed from a session on Refresh drops out of the dependency set and a newly added one appears.
- Revoke deletes the share's dependency rows (or they cascade with the share when a share row is deleted); a revoked share holds no live dependencies.
- The public read path (section 16.2) verifies, through `read_public_share`, that every dependency of the share is still eligible before returning the snapshot, as a third safety layer beneath downgrade time invalidation and Refresh.

Behaviour by event:

- Nested media deletion: the media object is gone, so the signed URL fails and the item shows as unavailable media on the page; the dependency row lets a cleanup or the next read mark the share degraded, and a Refresh drops the item or blocks the aggregate per the rights rule.
- Nested drill deletion: the drill's dependency row identifies the dependent shares; the read path finds the drill missing and returns the generic unavailable response for a session or programme that required it, and a Refresh rebuilds without it or blocks if the content is now incomplete.
- Template changes: a template edited into a different drill set changes the dependency set on the next Refresh; until Refresh, the snapshot is the frozen older version (the intended stale snapshot behaviour, threat 22), and the dependency rows still describe what that snapshot referenced.
- Rights downgrade: found through the reverse index and invalidated transactionally (section 13.3), touching only the dependent shares.
- Rights upgrade: does not retroactively widen any existing share; an item becoming eligible only affects shares created or Refreshed after the change, so no action is taken on existing shares.
- Refresh rebuilding the dependency set: the authoritative way the dependency set stays true to the snapshot, since Refresh is the only routine that rebuilds the snapshot from current content.

Direct database access. RECOMMENDED DEFAULT:

- `content_shares` carries no client policy at all, neither anon nor authenticated. This is stronger than the existing content tables, whose select policies are `TO public` and fail closed for anon only because `my_club()` is null (section 3.2); `content_shares` simply has no policy any browser role can satisfy.
- Authenticated browser clients have no direct `content_shares` read or write. Owner management goes through the authenticated management function; public reads go through the public read function; both reach the table through `service_role` gated functions, not client policies (section 16).
- No anonymous SELECT policy is added to `sessions`, `drills`, `programmes`, `templates`, `boards`, `media`, `profiles`, `teams` or `players`. This is the single most important invariant in the design.
- The raw `snapshot` rows are never exposed directly to authenticated or anonymous clients. Owners and managers receive their view through the management function, not a select on the table.

Manager review path. A `shares.manage` holder needs to see what an existing share actually makes public before deciding to revoke it, and the live source preview is not equivalent because the stored snapshot is frozen and may predate later edits. RECOMMENDED DEFAULT: the management function exposes a `shares.manage` gated read that returns, for a given share, the redacted stored public snapshot (no `token_hash`, no secret) plus the resolved source entity name and lifecycle status. This lets a manager audit exactly what is currently public and revoke a mistake with knowledge. It is a function read, not a client select on `content_shares`, so there is still no direct client table access to reason about.

## 16. Edge Function contracts

Two separate functions. This mirrors the CONFIRMED CURRENT STATE two family pattern (caller JWT through RLS versus service role with manual auth).

### 16.1 manage-content-share (verify_jwt ON)

Closest existing model: `feedback-to-github` (caller JWT, `has_perm` gate matching the RLS policy, no service role for the authorisation decision).

- `verify_jwt` on. Authenticates the caller via `resolveCaller(req)` (`_shared/fa.ts`).
- Accepts only: `action` (preview, create, refresh, rotate, revoke, status), `kind`, source id, and approved lifecycle choices (for example an expiry selection). An idempotency key for create, refresh and rotate (section 17).
- Never accepts `club_id`, actor id, owner id or a completed snapshot from the browser. The snapshot is always built server side.
- Verifies entity existence, that the entity is in the caller's club, and that the caller has authority (section 18).
- Builds the snapshot server side, resolving all referenced entities (drills, media, board) server side.
- Evaluates content rights eligibility server side (section 13).
- Creates, previews, refreshes, rotates, revokes, or reads owner status.
- Performs an EARLY REFUSAL capability check under the caller's identity, not the final security decision: it calls `caller.db.rpc('has_perm', { capability })` on the caller JWT client, exactly as `feedback-to-github` does, so an unauthorised caller is refused cheaply and with the same function the policy uses. This early check is a fast path, not the boundary. The final authority is the private transactional RPC (section 17): the function passes a verified actor id (the uid it authenticated from the JWT) plus the source id and lifecycle choice, and the RPC re validates everything inside the lifecycle transaction through explicit joins on that actor id (because `auth.uid()` is null under the service role, `has_perm` cannot be called inside the RPC; the RPC reads `member_roles` and `role_capabilities` and the source row directly by the passed actor id). A capability revoked between the early check and the RPC therefore causes the transaction to fail closed. The Edge Function check is never described as the sole security boundary.
- Returns no secret except on Create or Rotate.
- Exposes a `shares.manage` gated status read (section 15) that returns the redacted stored snapshot and the resolved source name for a share, so a manager can review before revoking.
- Exposes a `shares.manage` gated status lookup keyed on `shareId` (not just source id), returning the lifecycle state (active, expired, revoked, or absent) with no snapshot and no secret, so support can diagnose a reported `/share/:shareId` URL from what the reporter actually holds (section 21).

### 16.2 read-content-share (verify_jwt OFF)

CONFIRMED CURRENT STATE: this would be the first public Edge Function in the project; every current function authenticates and 401s without a JWT. There is no existing auth model to copy, so the departures are called out.

- `verify_jwt` off. Public. RECOMMENDED DEFAULT: declare this in `config.toml` with a per function `[functions.read-content-share] verify_jwt = false` block, so the boundary is version controlled and reviewable in the gated PR rather than remembered as a deploy flag. Adding one per function block does not change the other eight functions' default of `verify_jwt = true`; the framing "config has no blocks, preserve that" was wrong. The byte for byte source readback does not verify `verify_jwt`, so an explicit positive post deploy check is required: confirm `read-content-share` is anon reachable and every other function, `manage-content-share` and the eight pre existing ones (nine in total after PR 2), remains `verify_jwt = true` and is not anonymously reachable (section 26).
- Holds the `service_role` key, because it must read `content_shares` (which has no client policy) and sign objects in the private `media` bucket (which is `to authenticated` only). This makes it the first anonymously reachable function that wields elevated credentials. Honest residual: confining its DB access to the narrow definer function (next bullet) constrains the intended code path, but the function process still possesses the service role key, so a compromise of the function runtime itself (a dependency supply chain issue, a Deno or platform escape) has broad blast radius regardless of the narrow query surface. Narrowing the code path is defence in depth, not a claim that the key's power is reduced. It is a review gated function on the same footing as `invite-user` and `remove-user`, with the same secrets discipline.
- Reaches the database only through a narrow `SECURITY DEFINER` function, for example `read_public_share(p_share_id uuid, p_secret_hash bytea)`, that itself verifies the hash, checks `revoked_at` and `expires_at`, checks the club kill switch (section 26), verifies every row in `content_share_dependencies` for that share is still eligible (section 15.1) before returning anything, and returns only the versioned safe `snapshot` and the list of eligible media paths to sign. If any dependency is no longer eligible or its referenced entity is gone, it returns the generic unavailable response rather than a partial snapshot. So `read-content-share` never holds a broad service role DB client that a logic bug could turn into a whole database read; the definer function is the single, auditable read path, and storage signing is the only raw elevated operation left in the function body.
- Accepts only `shareId` and `secret` in a POST body.
- The `SECURITY DEFINER` function verifies the SHA-256 of `secret` against the stored `token_hash` with a constant time comparison (or a digest keyed lookup).
- Returns only the versioned safe public `snapshot`.
- Signs only the private media storage paths explicitly returned by that definer function for that eligible snapshot, with a short lifetime (section 20), and returns no raw path field. Honest limitation: a Supabase signed URL embeds the object path (including the `club_id` folder and the object uuid) in cleartext, so "no raw path" means the response carries no separate path field, not that the path is hidden inside the signed URL. Section 20 and section 23 record the resulting cross share club correlation residual, and the copy or content address option that would remove it.
- Sets `Cache-Control: no-store`.
- Uses generic unavailable responses for invalid, revoked and expired, indistinguishable from each other. A transport failure (5xx, timeout) is distinct: the public page shows a retry state for that, because a transient outage is not a lifecycle fact and revealing "try again" leaks nothing about whether a link exists (section 21).
- Does not log the secret or the snapshot.
- Applies defensible request size and response size limits, and a rate limit per `shareId` and per source IP, so the first anonymous endpoint has a committed abuse throttle rather than "consider a rate limit" (section 23, section 25).
- CORS: in production the public share page is served from the same Vercel origin as the app, so the existing `APP_ORIGIN` lock applies and needs no relaxation. Two qualifications. First, a Vercel preview deployment has a different origin, so an in browser end to end check of the public page on a preview URL would be blocked by the `APP_ORIGIN` lock; preview verification of the function is therefore server side (a curl against the deployed function), and in browser end to end verification is scoped to the production origin (section 26). Second, the single `APP_ORIGIN` lock and same origin hosting are single tenant simplifications; multi club support with per club subdomains or custom domains needs an allowlist of per club origins (from a `clubs.public_origin` setting), recorded as a multi tenant follow up rather than an assumed permanent design.

Pure logic. The snapshot builder, the recursive allow list scanner, the rights aggregation and the public response redaction live in a shared `_shared` module (for example `_shared/share.ts`) with Deno tests, so both functions and the unit suite exercise the same code. This matches the existing `_shared` pattern.

Deploy discipline. Both functions deploy from files on disk, never inline paste, and are verified by reading the deployed source back byte for byte (the `_shared/fa.ts` truncation lesson). The two functions are added to the `deno check` list and the shared module's `*_test.ts` to the `deno test` list in `ci.yml`.

## 17. Transaction and idempotency model

The lifecycle writes must be atomic and idempotent. The requirements:

- Create must not leave a share without its audit event.
- Refresh must not expose a half written snapshot.
- Rotate must not leave both the old and new secret working.
- Revoke and its audit event commit together.
- Duplicate or concurrent Create calls must not produce multiple active shares.
- A retry after "commit succeeded but the response was lost" resolves to the same active share, not another.
- A stale earlier response must not overwrite a later lifecycle state.

Options assessed: direct service role writes from the Edge Function; a private SECURITY DEFINER RPC called by the function; database trigger generated audit; idempotency keys; row locks and unique indexes.

RECOMMENDED DEFAULT: a private transactional RPC for lifecycle writes, `EXECUTE` restricted to `service_role`, called by `manage-content-share` after it authenticates the caller and makes the capability decision under the caller JWT (section 16.1). This mirrors the CONFIRMED `grant_club_membership` pattern: a SECURITY DEFINER function, `set search_path = ''`, service role only, that does the mutation and the audit write in one transaction. The important correction over a naive design: the capability check (`has_perm`) happens in the function under the caller JWT, not inside the RPC, because a service role invocation has `auth.uid()` null, so `has_perm` inside the RPC would evaluate false and there is no JWT context to read the actor from. This is exactly how `invite-user` works (it checks the capability in the function and calls a service role RPC that validates data, `0029`), and it is the opposite of "the RPC re runs `has_perm`".

- The RPC is the final authority. It gates on `auth.role() = 'service_role'` (so only the authenticated function path reaches it), is passed the verified actor id and the source id, and re validates the full authorisation inside the lifecycle transaction through explicit joins on that actor id, because `auth.uid()` is null under the service role so `has_perm` cannot be used. The checks, all in the same transaction before any mutation:
  - the passed actor still has a profile in the source's club (`profiles` joined by actor id and `club_id`);
  - the actor currently holds the required sharing capability (`shares.create` for create, refresh and rotate by the owner; `shares.manage` for a club wide revoke), read live from `member_roles` into `role_capabilities`;
  - the actor currently holds the relevant source capability (`sessions.create` or `sessions.manage`, `drills.create` or `drills.manage`, `programmes.create` or `programmes.manage`), read the same way;
  - the source ownership or manage arm still holds (`coach_id` or `created_by` equals the actor for the create arm, or the actor holds the source `.manage` for the manage arm);
  - the source row still exists and still belongs to that club.
  If any check fails, the transaction aborts and nothing is written. A capability revoked between the Edge Function early check and this RPC therefore fails closed here (threat 39). It validates data and authority against the passed actor id; it never re derives the caller's identity from `auth.uid()`.
- Create and the audit insert happen in one statement path, and the audit writer is passed the same verified actor id (the audit writer also cannot read `auth.uid()` under a service role call, so the actor is passed explicitly, section 19). The `actor_name` snapshot is resolved only after the authorisation checks above pass, so a rejected attempt records nothing. There is no share without its audit event (Create) and no audit without its mutation (Revoke).
- Create and Refresh also write the `content_share_dependencies` rows (section 15.1) for the built snapshot in the same transaction, so the snapshot, its dependency set and its audit event are always consistent; Revoke deletes the share's dependency rows and clears the snapshot in the same transaction.
- The one active share invariant is enforced by the three partial unique indexes of section 15 (one per source column, `where <col> is not null and revoked_at is null`), so a concurrent second Create for the same source fails the unique constraint rather than creating a duplicate; on that violation the function returns the existing active row found BY SOURCE.
- Idempotency is a separate mechanism for same key retries (a double click, or a lost response retry carrying the same `idempotency_key`, reusing PR #103's `stableCreateId` discipline): a unique constraint on `(coalesce(session_id, drill_id, programme_id), idempotency_key)` backs an upsert so a repeat with the same key returns the existing result rather than acting again. The two dedup paths are distinct: the by source partial unique handles a genuinely concurrent second create from a different key; the idempotency key handles a retry of the same logical create.
- Refresh writes the new snapshot and `refreshed_at` in one update, so a reader never sees a half written snapshot (a jsonb column is written atomically).
- Rotate replaces `token_hash` and sets `rotated_at` in one update, so the old secret stops working the instant the new one starts; there is never a window where both validate.
- A stale earlier response cannot overwrite a later state because lifecycle updates are guarded by a monotonic check (for example an update that only applies when the row's `updated_at` or a lifecycle version is not newer than the caller's basis), or more simply because each action is a single authoritative statement and the client never sends back a snapshot to persist.

Audit on failure. A failed lifecycle mutation produces no success audit, because the audit insert is inside the same transaction as the mutation; if the mutation aborts, the audit insert rolls back with it. This is the CONFIRMED audit design ("a mislabelled write fails the check and aborts the whole transaction").

## 18. Permissions and capabilities

CONFIRMED CURRENT STATE: capabilities are data (20 keys), named `<domain>.create` and `<domain>.manage`, checked by `has_perm`, never by role name in RLS or functions. Adding a capability updates the `capabilities` seed, the `role_capabilities` grants, and the `capabilities.test.ts` `EXPECTED_CATALOGUE` (currently pinned at exactly 20) plus the `src` regex it cross checks.

Options: reuse only existing content capabilities; add one global sharing capability; add create and manage sharing capabilities.

RECOMMENDED DEFAULT: two new capabilities, `shares.create` and `shares.manage`, following the existing shape. The name fits the catalogue's `<domain>.create` and `<domain>.manage` convention exactly; `shares` (plural) matches `sessions`, `drills`, `programmes`, `templates`. UNRESOLVED sub decision (section 30): confirm `shares` is the preferred domain key over an alternative such as `sharing`.

Suggested default grants (each an UNRESOLVED DECISION for owner confirmation, section 30):

- Admin: `shares.create`, `shares.manage`.
- Manager: `shares.create`, `shares.manage`.
- Coach: `shares.create`.
- Parent: neither.

Combine the share capability with the source ownership rule, mirroring the existing content pattern `manage OR (owner AND create)`:

- Session: the source owner holding `sessions.create` and `shares.create`, or `sessions.manage` plus `shares.create`; `shares.manage` may revoke any share in the club.
- Drill: the drill owner holding `drills.create` and `shares.create`, or `drills.manage` plus `shares.create`.
- Programme: the programme owner holding `programmes.create` and `shares.create`, or `programmes.manage` plus `shares.create`.
- An unowned or FA imported entity (no `created_by`, or `coach_id` null after a coach was removed) requires the relevant manage capability.
- Copying a protected club link requires only the existing read access and does not require `shares.create`. A club link is a URL, not a share record.

Scope of `shares.manage`, stated precisely to keep section 18 and PR 5 coherent. RECOMMENDED DEFAULT: `shares.manage` authorises Revoke of any public share in the club, and the redacted read to review what a share exposes, but not Rotate or Refresh of another creator's share. Rotate and Refresh stay with the share owner (the creator, or a source manage holder acting as owner), because Rotate silently kills the owner's already distributed link and Refresh republishes the owner's content on their behalf; a manager doing either would change a coach's live link without the coach knowing and would receive the new secret themselves. A manager who judges a share unsafe revokes it; the owner then creates a fresh one if wanted. This is section 30 decision 5. If the owner body prefers managers to also rotate, the owner handoff (how the coach learns their link died and gets the new secret) must be designed; the recommended default avoids that by scoping managers to Revoke.

The RLS on `content_shares` and the RPC both express these as `has_perm(...)` combined with the ownership predicate, never as a role name. Parents hold neither share capability and cannot create or manage public shares; the write policies and the RPC both refuse them, and the security suite pins that (section 24).

## 19. Audit

Build on the live `audit_events` foundation (section 3.6). The audit boundary document already reserves `content_share.created`, `content_share.refreshed`, `content_share.revoked` as future actions (`docs/security/app-audit-boundary.md:197`).

Committed business events to record:

- `content_share.created`.
- `content_share.refreshed`.
- `content_share.rotated`.
- `content_share.revoked`.
- `content_share.expired`, only if a background process changes state (see below).
- `public_share_policy.changed`, if rights classification becomes managed data (section 13).

How they are written. CONFIRMED CURRENT STATE: `audit_events.action` and `entity_type` have no check constraint, so these actions and an `entity_type` of `content_share` need no change to the table; `source` already allows `edge_function`. The writer's allow list is player and export specific today, and its metadata allow list is bounded to player and export keys. So the sharing lifecycle RPC needs its own writer path: either extend `log_audit_event` with a sharing action, entity type and metadata allow list, or add a sibling private writer for sharing events. RECOMMENDED DEFAULT: a sibling private writer (or an extended `log_audit_event`) with a sharing specific metadata allow list, service role only, called inside the lifecycle RPC so the audit commits with the mutation. Because the writer runs under a service role invocation, `auth.uid()` is null inside it, so the verified actor id is passed explicitly by the RPC (section 17); the writer stamps the `actor_name` snapshot from that id, which is how "who shared what" survives the creator's later removal.

Durable source reference, so the audit outlives the share. `content_shares` is `on delete cascade` from its source (section 15), so once the source session, drill or programme is deleted the share row is gone. The audit event must therefore record the source entity independently: set `entity_type` to `content_share` and record the source kind and the source id (a scalar uuid, no title, no free text) in the event's own columns or metadata, following the existing audit philosophy that ids are immutable historical facts resolved at read time and degraded to a neutral label when the row no longer exists (`0030` header). So who shared which item, and when, resolves even after both the source and the share row are deleted, and decision 19's claim that the audit answers "who shared what" holds.

Reserved catalogue. Only `content_share.created`, `content_share.refreshed` and `content_share.revoked` are reserved in `app-audit-boundary.md:197`. `content_share.rotated` (and the conditional `content_share.expired` and `public_share_policy.changed`) are new; extending that authoritative catalogue is an explicit PR 1 step (section 27), not only a writer allow list change.

Club link sharing is intentionally unaudited. Copying a club link (section 7) writes no audit event, deliberately: the recipient must already be an authorised club member with club wide read, so a club link creates no new exposure to trace. Only public shares, which cross the club boundary, are audited.

Do not log every public view in v1. RECOMMENDED DEFAULT: no per view logging. Rationale:

- Per view logging introduces personal data and IP considerations for anonymous viewers.
- It is noisy: messaging clients and link preview bots open links, so counts would be misleading.
- It is not required to fulfil Phil's request.

Audit metadata may include safe facts only: content `kind`, an expiry class (for example `default`, `short`, `none`), the lifecycle `action`, and a count of blocked rights categories at creation. It must never store the raw link, the secret, the `token_hash`, the public snapshot, the content title, any free text, a recipient identity, an IP address, a user agent, or the public response payload. The metadata allow list is enforced server side exactly like `audit_metadata_ok`.

`content_share.expired` is emitted by the scheduled cleanup process (section 8.4, section 26) when it physically clears an expired share's snapshot and dependency rows after the retention window. Access enforcement itself is at read time (`read_public_share` compares `expires_at`), so the event marks the physical clearing, not the moment access stopped. If the owner declines the scheduler, expiry enforcement stays at read time and no `content_share.expired` event is emitted; the event exists only alongside the cleanup that changes stored state.

## 20. Media and Storage

CONFIRMED CURRENT STATE: the `media` bucket is private, `to authenticated` only, no anon read, no UPDATE policy, paths `{club_id}/{uuid}-file` and avatars at `avatars/{user_id}/`. Client signing is a one hour URL.

RECOMMENDED DEFAULT: do not create a public bucket for this feature. The private bucket plus short lived server signed URLs is sufficient and keeps the boundary intact. Creating a public bucket would be a new, standing anonymous read surface for exactly the class of asset (FA images) that must not be public.

For eligible stored media (an image or PDF whose rights class is `public_full` and whose path is referenced by the validated snapshot):

- The public `read-content-share` function generates a short lived signed URL, shorter than the client's one hour default (for example five to fifteen minutes), long enough to load the page, short enough to limit a leaked URL.
- The signed URL is returned only for a path explicitly returned by the `read_public_share` definer function for the validated snapshot (section 16.2). The function never signs an arbitrary caller supplied path. This closes the "sign any path could reach avatars or another club's object" threat, because the only inputs are `shareId` and `secret`, and the only paths signed are those the definer function named from that snapshot.
- The response carries no separate raw path field. Honest limitation, corrected from an earlier over claim: a Supabase signed URL is of the form `/storage/v1/object/sign/media/{club_id}/{uuid}-file?token=...`, so the object path, including the `club_id` folder uuid and the object uuid, is embedded in cleartext in every signed media URL handed to the anonymous viewer. The recursive allow list scanner checks keys, not the contents of a URL string, so it does not catch this. The consequence is a cross share correlation handle: the same `club_id` appears in the media URL of every public share from that club, letting an outside observer confirm two unrelated public links belong to the same club, and exposing the club and object uuids. This is a residual (section 23), not a claim that the path is hidden. The option that removes it, deferred past v1 for cost, is to copy each eligible `public_full` object at share build time to a share scoped or content addressed path that embeds no `club_id` and no source row id, and sign that, or to proxy the bytes through the read function so no storage URL reaches the client. v1 references and signs the existing path and records the residual honestly.
- A page reload requests a fresh URL (the snapshot references the path; the function re signs on each read).
- An expired media URL has a recoverable Reload action on the public page (section 21).
- Deleting or reclassifying media degrades the share safely through the dependency table (section 15.1): a media reclassification to `internal_only` is a rights downgrade, so it finds the dependent active shares by reverse lookup and invalidates exactly those transactionally (section 13.3); a media deletion leaves the dependency row, so the read path finds the object gone and returns the generic unavailable response for that share rather than a broken image, and a Refresh rebuilds without the item or blocks the aggregate per the rights rule. A signed URL that expires mid session yields a recoverable Reload (section 21), distinct from a deleted object.

For external media:

- YouTube is represented as a link or a sandboxed `youtube-nocookie.com` embed, only when its `public_link_only` or better rights allow (a public YouTube video is already public). The public thumbnail (`img.youtube.com`) needs no signing.
- FA Vimeo embeds and other restricted media follow their rights class: `internal_only` by default, so they are not published, and a session or drill that requires them is blocked from public sharing in v1 (section 13) rather than shown without its diagram or video.
- No external host receives the share secret through a Referer header (the secret is in the fragment, never sent; section 14), and embeds are sandboxed (section 21).
- Source attribution remains visible wherever content renders, per CLAUDE.md.

Caps. RECOMMENDED DEFAULT, using the hosted content counts as a realistic guide (drills 103, media 111, templates 31, sessions 15, programmes 4; FA programmes cap at `MAX_PROGRAMME_WEEKS = 10` weeks): a maximum snapshot size of 256 KiB, a maximum of 64 referenced media assets per share, and a maximum programme week count of 12 (the FA cap plus headroom). These bound the public response and the signing work. The read function enforces the size cap; the builder enforces the asset and week caps and reports when a programme exceeds them rather than silently truncating.

## 21. Public route and rendering

RECOMMENDED DEFAULT: a route `/share/:shareId` registered outside `RequireAuth`, as an explicit sibling of `/login`, before the catch all. The secret stays in the URL fragment and never appears in the route path.

CONFIRMED CURRENT STATE constraint: the router currently places everything except `/login` inside `RequireAuth`, and the catch all `*` redirects to `/`. A new public route must be added as `<Route path="/share/:shareId" element={<PublicShare />} />` at the top level, above `<Route element={<RequireAuth />}>` or as its sibling, and before the catch all, or it will be caught and redirected into the authenticated tree.

The public component requirements:

- No `AppShell` (no sidebar, top bar or bottom nav).
- No `SessionsProvider`.
- No `useAuth` requirement.
- No protected content hooks (`useSessions`, `useDrills`, `useSignedMediaUrl`, `useMyCapabilities` and the rest).
- No profile, team, player, attendance or club member query.
- A dedicated public query that calls `read-content-share` with `shareId` from the route param and `secret` from `window.location.hash`.
- Rendering states: loading; a neutral generic unavailable state (for invalid, revoked or expired, all identical, section 33.4); a distinct transient error and retry state (for a 5xx or a network timeout, which reveals nothing about the link's lifecycle because it is triggered by transport failure, not by the share's status); available snapshot; expired media reload; a print layout; a mobile layout.
- The generic unavailable state carries calm human copy with a next step that does not reveal whether the link ever existed, worded identically for invalid, expired and revoked: a heading and "This link is not available. If someone shared it with you, ask them to check it or send you a new one." The transient error state instead says "This could not load right now. Try again," with a Retry.
- Club branding limited to approved public brand fields (section 21.2).
- No internal navigation and no management links, unless the viewer separately signs in.

Because the whole app is one Vite bundle behind the SPA rewrite, the public route still loads the same JavaScript unless it is split out. The safety property is not a separate bundle; it is that the `PublicShare` component tree imports and mounts none of the authenticated providers or hooks, initialises no Supabase authenticated query, and reaches Supabase only through the public function. A component test asserts the public route mounts no `SessionsProvider` and fires no protected query (section 24).

Usability requirement alongside the safety property: the public `/share` route should be code split with a dynamic import (`React.lazy`), so an external coach opening one shared item on mobile data at a pitch does not download the whole authenticated app's chunks before first paint. Treat first paint for the no account mobile path as a usability budget to keep small, matching the 320px mobile support promised in section 22.

### 21.1 Response headers and page hardening

- Document title set to a neutral, content free value on the public page (for example "Shared session, Ossett Town Juniors"), avoiding leaking the free text title into the tab or link preview beyond what the snapshot already shows.
- `robots` noindex and nofollow. UNRESOLVED sub decision: client side meta injection alone is weak because not every crawler runs JavaScript. RECOMMENDED DEFAULT: set `X-Robots-Tag: noindex, nofollow` at the edge for `/share/*` via a Vercel `headers` rule in `vercel.json` (a server level guarantee), in addition to a client side `<meta name="robots">`. This is the assessment the task asks for: client side meta is not sufficient on a Vite SPA for robots control; a Vercel header is needed.
- `Referrer-Policy: no-referrer` on the public page, so a click out to an attributed source URL sends no referrer carrying the share.
- `Cache-Control: no-store` at the read API (section 16.2), so intermediaries do not cache the snapshot.
- A Content Security Policy suitable for the public page: self plus the Supabase project origin for the function call and signed media, `img.youtube.com` for thumbnails, framing limited to sandboxed `youtube-nocookie.com` only, gated on `public_link_only` YouTube rights, and no third party script origins. `player.vimeo.com` is deliberately not in the frame allowlist: the only Vimeo content in the app is FA video, which is `internal_only` and can never appear on a public snapshot (section 20), and the FA Vimeo player is domain locked and renders as a link out on the app origin anyway, so allowing it would widen the framing surface for a content class that by rule never reaches the public page. A future non FA Vimeo rights path would re add it deliberately.
- Safe external link `rel` attributes (`rel="noopener noreferrer nofollow"`) on any attribution link.
- Sandboxed embeds (`sandbox` on any iframe, and referrer stripping) so an embed cannot reach back into the page or receive the fragment.
- No third party analytics by default (section 25).

Assessment requested by the task: on the Vite SPA, client side meta changes are sufficient for the document title and a client `<meta robots>`, but they are not sufficient for a robust noindex or for security headers, because they run only after the bundle loads and not every consumer runs the bundle. Vercel `headers` config is therefore needed for `X-Robots-Tag`, `Referrer-Policy`, and the CSP on `/share/*`. This is a `vercel.json` change in the implementation PR, not now.

### 21.2 Public page branding

CONFIRMED CURRENT STATE: the per club crest is either a private Storage path under `{club_id}/crest/` or a URL, and a bundled public static asset `public/crest.png` exists. The club name and motto live on the `clubs` row (`name`, `motto`).

RECOMMENDED DEFAULT for safe public branding in the single club deployment: the club name, the motto, and the bundled public static `/crest.png`. Do not return the club database id. Rationale: the bundled crest is already a public static asset (favicon and fallback), so it is safe and needs no signing; the club name and motto are public facts the club publishes itself.

Multi tenant caveat, corrected from the earlier single club reasoning: the bundled `/crest.png` is OTJ's own crest, so in a future multi club deployment it would render OTJ's crest next to a different club's name and motto, a concrete cross club mismatch. Label it explicitly as a single club placeholder. Before multi tenant, resolve the share's own club crest at read time from the share's `club_id`, reusing the same short lived signed URL mechanism the design already builds for media to serve the per club private `clubs.crest_url`, or store a per club public branding asset. So name, motto and crest all come from the share's own club. This is recorded in section 30 decision 10 as a required multi tenant follow up. The club database id is never returned as a discrete branding field or snapshot value; note, though, the honest residual from section 20 and threat 37: it still appears in cleartext inside any signed media URL (and inside a signed per club crest URL), because the storage path is `{club_id}/...`. "Not a returned field" is true; "never reaches the client at all" is not, until media and crest bytes are copied or content addressed.

## 22. Accessibility and mobile

CONFIRMED CURRENT STATE: there is no `Button` React primitive; buttons are raw `<button className="btn">` with a base height of 42px, `btn-sm` 36px, `icon-btn` 38px, and 44px is applied ad hoc per component via inline `style`, not enforced by CSS. The `Modal` primitive has the `dismissible` contract but no built in focus trap (an open accessibility item in the Product Excellence roadmap, initiative 10). The bottom nav breakpoint is 900px.

Specify for the Share controls and the public page:

- Share buttons with clear accessible labels ("Share this session", "Copy link", "Create public link"), not icon only without a label.
- 44px minimum touch targets on every new share control, set explicitly since the base classes are 42px and smaller and there is no enforced minimum.
- Plain language control labels, which are also the accessible labels: "Share this session", "Copy link", "Create public link", and for the lifecycle controls "Update what people see", "Replace this link", "Turn off this link" (section 8.3), never the engineer terms Refresh, Rotate, Revoke.
- Native share and clipboard feedback announced to screen readers: a `role="status"` live region announcing "Link copied" or "Sharing". The region must be persistently present in the DOM (rendered empty) with only its text content updated on copy or share, not mounted on demand, because most screen readers do not announce a live region that appears together with its first message.
- The one time link reveal must be reachable by a screen reader: on Create or Rotate, announce the revealed link region via the live region, move keyboard focus to the link or its Copy control, and keep the reveal on screen until the user dismisses it rather than clearing it on the next state change, since the raw secret is unrecoverable and Rotate is the only second chance.
- Full keyboard operation of the Share modal and every control.
- Dialog semantics on the Share modal, not just a focus trap: `role="dialog"`, `aria-modal="true"`, an accessible name via `aria-labelledby` pointing at the modal title, and an `aria-label` on the close control (the shared `Modal`'s close X is icon only and unnamed today). A focus trap alone does not tell an assistive technology user they are in a dialog or mark the surrounding app inert.
- Focus placement into the Share modal on open and restoration to the trigger on close. This should reuse the focus trap work that Product Excellence initiative 10 adds to the shared `Modal`, or add it as part of the sharing work if that lands first; the two should not build two focus traps, and whichever lands first also adds the dialog semantics above for every `Modal` consumer.
- A non dismissible modal while lifecycle writes are pending, reusing the existing `dismissible={false}` contract from PR #103, not a new mechanism.
- `role="alert"` on failures (the existing `ActionError` pattern).
- Link status expressed as text, not colour only ("Active, expires in 89 days", "Revoked"), so status is available without colour perception.
- The public page usable from 320px to desktop, following the existing 900px and 1080px and 520px breakpoints.
- Accessible activity order: the ordered activities render as an ordered list with real order semantics, not colour coded stripes alone (the Product Excellence roadmap already flags colour only timelines as an accessibility gap).
- A board diagram accessible summary that carries the same numbers and sides the visual board shows, both teams, not just a formation and one count. For example "4-4-2, home shirts 1 to 11, away shirts 1 to 11", accepting that exact x and y positions are approximated in words. A summary that dropped the shirt numbers and the away side would give non visual users materially less than the "numbers and positions only" a sighted user gets.
- A print style for the public page. To avoid a gap, a minimal print stylesheet ships with the first public release (PR 2) so every public page prints usably from day one, and PR 6 refines print and adds any generated PDF. Section 22's print requirement is owned by PR 2 for the minimal fallback and PR 6 for the refinement, not deferred wholly to PR 6.
- Reduced motion behaviour: no essential animation on the public page; respect `prefers-reduced-motion`.
- No inaccessible QR only flow. QR codes may be considered later (section 29) but must never be the only sharing method; the link and the native share and copy paths are always present.

## 23. Threat model

Each threat lists likelihood, impact, prevention, detection where relevant, residual risk, and the test or verification that pins it. Likelihood and impact are qualitative (low, medium, high) at a single club scale.

1. Guessed share ids. Likelihood low, impact low. Prevention: the `shareId` is not the secret; the SHA-256 fragment secret is required and is 256 bits, so guessing the id yields nothing. Detection: not needed. Residual: negligible. Test: read function returns the generic unavailable response for a valid id with a wrong secret.
2. Stolen full link. Likelihood medium, impact medium. Prevention: unlisted, expiring, revocable, rotatable; view only, so a stolen link exposes only the safe snapshot. Detection: none by design (no view logging). Residual: whoever holds the link can view the snapshot until expiry, revoke or rotate; this is inherent to an unlisted link and is stated to the owner. Test: revoke and rotate both invalidate an existing link immediately.
3. Token in Vercel logs. Likelihood low, impact high if it happened. Prevention: the secret is in the URL fragment, never in the request line or query, so Vercel route logs never receive it. Test: a route test asserts the secret is read from `window.location.hash` and sent only in a POST body.
4. Token in Edge Function logs. Likelihood low, impact high. Prevention: the read function logs status and counts only, never the secret or snapshot (the CONFIRMED logging discipline). Test: a function test asserts no log line contains the secret.
5. Token in browser Referer. Likelihood low, impact high. Prevention: fragment secret is never sent in Referer; `Referrer-Policy: no-referrer` on the page. Test: header presence asserted; manual Referer check in the smoke matrix.
6. Token leaked to YouTube or another embed. Likelihood low, impact high. Prevention: fragment secret is not in the URL sent to embeds; embeds are sandboxed and the page sets `no-referrer`. Residual: none expected. Test: embed sandbox attributes asserted.
7. Token in analytics. Likelihood low, impact high. Prevention: no analytics on the public page by default (section 25); no secret is passed to any client side logger. Test: repo has no analytics integration (CONFIRMED), asserted by the observability baseline.
8. Database reader seeing plaintext secrets. Likelihood low, impact high. Prevention: only `token_hash` (SHA-256) is stored; there is no plaintext token column. Test: security suite asserts no plaintext token column and that the stored value is a hash.
9. Parent attempting management. Likelihood medium, impact medium. Prevention: parents hold neither `shares.create` nor `shares.manage`; the RLS and the RPC refuse them. Test: security suite asserts a parent cannot create, refresh, rotate or revoke.
10. Cross club source id injection. Likelihood medium, impact high. Prevention: `manage-content-share` verifies the source is in the caller's club server side; `club_id` is derived from the caller, never the payload. Test: security suite asserts a cross club actor cannot create, refresh, rotate or revoke, and that a cross club source id is refused.
11. Service role misuse, two surfaces. Likelihood low, impact high. In `manage-content-share` the service role is used only after the function authenticates and authorises the caller, and only to call the lifecycle RPC, which gates on `auth.role() = 'service_role'` and re checks ownership against the passed actor id. The harder surface is `read-content-share`: it is the first anonymously reachable function and it holds the service role (to read `content_shares` and sign private media), so it has no caller to authenticate and any logic or injection bug in it is a potential whole database read. Prevention: its database access is confined to the narrow `read_public_share` SECURITY DEFINER function (section 16.2), so the function body never issues arbitrary service role queries; the only raw elevated operation left is storage signing of paths that definer function returned; it is a review gated function on the same footing as `invite-user`; and its inputs are only `shareId` and `secret`. Detection: function error and rate limit counts (section 25). Residual: two, stated honestly. A bug in `read_public_share` itself remains high impact, which is why it is small, single purpose and security tested. And the function process possesses the service role key, so a compromise of the runtime itself (supply chain, platform escape) has broad blast radius regardless of the narrow query path; narrowing the code path is defence in depth, not a reduction of the key's power (section 16.2). Test: the read function cannot read any row other than the one the token authorises; a malformed input returns the generic response; the function holds no code path that selects a content table directly.
12. Client built snapshot injection. Likelihood medium, impact high. Prevention: the function never accepts a snapshot from the browser; it always builds server side. Test: a request carrying a `snapshot` field is ignored or rejected; the stored snapshot matches the server build.
13. Nested content overlooked by redaction. Likelihood medium, impact high. Prevention: the recursive allow list scanner asserts no key outside the allow list reaches the payload, at every nesting level (session to activity to drill to media to board). Test: a unit test feeds a snapshot with an injected forbidden key at each level and asserts the scanner rejects it.
14. playerId leaked through board tokens. Likelihood medium, impact high (child data boundary). Prevention: the board projection keeps only `number, side, x, y`; `playerId` and `id` are dropped; this honours `registered-players-boundary.md:559-564`. Test: board projection test asserts `playerId` is absent from the public snapshot.
15. Names in free text. Likelihood medium, impact high. Prevention: the exact pre publish preview plus the calm warning (section 12); structured name fields (`author`, coach name, player name) are excluded by the allow list. Residual: a coach could type a child's name into a note; the preview is the human control and the design claims no automated guarantee. Test: allow list excludes `author` and all name columns; preview renders the exact free text.
16. Spond fields included by mistake. Likelihood low, impact high. Prevention: `spond_event_id` is excluded and the builder never joins `spond_events`; attendance counts are never in a session snapshot. Test: session snapshot test asserts no Spond field and no attendance count appears.
17. Date, venue or team leaked from a session. Likelihood medium, impact high (safeguarding). Prevention: `date`, `start_time`, `venue`, `team_id`, team name excluded by the allow list. Test: session snapshot test asserts these are absent.
18. FA content made public. Likelihood medium, impact high (rights). Prevention: FA derived content defaults to `internal_only`; a nested internal only item blocks the public aggregate; the read function signs only `public_full` media. Test: a session or drill referencing FA media fails closed (cannot be publicly shared) until the owner records a rights decision.
19. Unclassified media made public. Likelihood medium, impact high. Prevention: unknown or unclassified media defaults to `internal_only`. Test: a media row with no rights class is treated as internal only.
20. Rights change after share creation. Likelihood low, impact high. Prevention: a downgrade to `internal_only` finds the dependent active shares through the `content_share_dependencies` reverse index and invalidates exactly those transactionally at downgrade time (section 13.3, 15.1), not by scanning snapshot JSON and not by a global sweep; Refresh rechecks rights as a second layer; and `read_public_share` verifies every dependency is still eligible on each read as a third layer. Test: downgrading a nested item's rights disables the dependent share and only that share, verified through the dependency table; the public read of a downgraded share returns the generic response even before any Refresh.
21. Delete and recreate of a Storage path. Likelihood low, impact medium. Prevention: the app never reuses a path (fresh random path per upload) and has no UPDATE policy; the snapshot references a path and signs it briefly. Residual: an authorised client (delete then insert) or a service role operator could place different bytes at a path a snapshot references; the roadmap states this plainly and does not claim byte immutability without content addressing. Detection: none. Test: documented as an accepted limitation, matching the existing foundation retrospective accepted risk.
22. Stale snapshot. Likelihood expected, impact low. Prevention: by design a snapshot does not auto update; Refresh is explicit and rechecks rights and permissions. Residual: a public link may show older content than the private row until refreshed, which is the intended behaviour. Test: an edit to the source does not change the public snapshot until Refresh.
23. Oversized programme snapshot. Likelihood low, impact medium (denial of service, cost). Prevention: snapshot size cap 256 KiB, media asset cap 64, week cap 12 (section 20); the builder reports rather than truncates. Test: a programme exceeding the caps is refused with a clear message.
24. Denial of service against the public read function. Likelihood medium, impact medium. Prevention: request and response size limits; `Cache-Control: no-store` with a cheap lookup keyed on `shareId`; a committed rate limit per `shareId` and per source IP (section 16.2), not merely "consider one"; and a Supabase usage or billing alert, since the first anonymous endpoint is a new cost surface. Detection: the section 25 committed baseline (function success and failure counts, rate limit refusal count) plus the uptime probe. Residual: a determined attacker can still call the function; the work per call is bounded and reads a single indexed row. Test: the function enforces the size caps and the rate limit, and returns quickly for an invalid id.
25. Brute force attempts against the secret. Likelihood low, impact low. Prevention: 256 bit secret makes brute force infeasible; a generic response gives no oracle; the committed per id and per IP rate limit slows automated attempts. Detection: the rate limit refusal count and failed read count in the section 25 baseline surface a spike for a single id. Residual: negligible given the entropy. Test: wrong secret always returns the generic unavailable response, and repeated wrong secrets trip the rate limit.
26. Public search engine indexing. Likelihood medium, impact medium. Prevention: `X-Robots-Tag: noindex, nofollow` at the edge plus a client meta; unlisted links are not linked from anywhere indexable. Test: the Vercel header rule is present for `/share/*`.
27. Messaging preview bots. Likelihood high, impact low. Correcting an earlier overstatement: a typical link preview bot fetches the URL without the fragment (the secret lives in `#secret`, which is not sent to the server) and often does not execute the app JavaScript, so most preview bots receive only the generic app shell, not the snapshot; the read function is never called without the fragment and secret. A browser like bot that does execute the page and carries the fragment could render the safe snapshot, which is acceptable because the snapshot is the safe public projection. Prevention: view only snapshot, secret in the fragment (not sent server side), no per view logging that a bot would pollute. Residual: a JavaScript executing bot renders the safe snapshot, acceptable by design. Test: a request to the read function without a secret returns the generic response; noted as a reason not to log views (bot traffic would make counts misleading).
28. Source deleted while a refresh runs. Likelihood low, impact low. Prevention: `on delete cascade` removes the share when the source is deleted; a refresh that races a delete either completes against the row or finds it gone and the share is cascaded away; the public read then returns unavailable. Test: deleting the source removes the share and the public read returns the generic response.
29. Concurrent rotate and read. Likelihood low, impact low. Prevention: rotate replaces `token_hash` in one atomic update, so a read either validates against the old hash (before commit) or the new (after), never a torn state. Test: rotation is a single update; the old secret stops validating immediately after.
30. Concurrent revoke and refresh. Likelihood low, impact low. Prevention: both are single authoritative statements guarded by the lifecycle RPC; revoke sets `revoked_at`, and a refresh on a revoked row is refused. Test: a refresh after revoke is refused; revoke wins.
31. Creator removed. Likelihood low, impact low. Prevention: creator removal does not auto expose new data (the snapshot is frozen), and a manager holding `shares.manage` can still revoke; `created_by` referencing a removed profile is a set null, not a cascade delete of the share. Test: after the creator is removed, a manager can still revoke the share.
32. Audit failure. Likelihood low, impact medium. Prevention: the audit insert is in the same transaction as the mutation, so an audit failure aborts the mutation (fail closed); a lifecycle action never succeeds without its audit event. Test: a forced audit failure rolls back the lifecycle mutation.
33. Partial lifecycle write. Likelihood low, impact medium. Prevention: each lifecycle action is one transactional RPC; there is no multi statement client orchestration to leave half done. Test: a failed RPC leaves the row in its prior state.
34. Malformed old snapshot version. Likelihood low, impact low. Prevention: the snapshot carries `snapshot_version`; the read function and the public page handle a known set of versions and show the neutral unavailable state for an unknown one rather than rendering garbage. Test: a snapshot with an unknown version renders the unavailable state, not an error.
35. Public page accidentally bootstrapping authenticated queries. Likelihood medium if not guarded, impact high. Prevention: the public component imports and mounts none of the authenticated providers or hooks; a component test asserts no `SessionsProvider` and no protected query fires. Test: section 24 route test.
36. Signed media URL reaches an unintended object (avatars, another club). Likelihood low, impact high. Prevention: the function signs only paths the `read_public_share` definer function returned for the validated snapshot, never a caller supplied path; the only inputs are `shareId` and `secret`. Test: the function ignores any path not in the snapshot and never signs an avatar path.
37. Club id and object uuid exposed through the signed media URL. Likelihood certain when a share carries stored media, impact low. A Supabase signed URL embeds the object path (`{club_id}/{uuid}-file`) in cleartext, so the anonymous viewer receives the club uuid and the object uuid, and the same club uuid appears across every public share from that club, a cross share correlation handle. Prevention in v1: none beyond the short URL lifetime; the doc does not claim the path is hidden (section 20). Detection: not applicable. Residual: an observer can confirm two public links belong to the same club and learns two opaque uuids; no name, no human identifier, no other club data. The removal option (copy or content address eligible media to a path carrying no `club_id`, or proxy the bytes) is deferred past v1 for cost. Test: the doc and the media projection tests assert the response has no separate path field, and the residual is recorded rather than asserted away.
38. Third party text laundered into a public link through a no source field. Likelihood medium, impact medium (rights). A coach can paste FA or other third party text into a free text field without a `source_url`, and the source based rights model classes absent source as eligible, so it can reach a public link. Prevention: the section 12 preview and its explicit "club's own work or cleared for public use" rights confirmation are the only control, since no server signal distinguishes club original from unattributed third party text. Detection: none. Residual: real and recorded (section 13.6); the stronger option is an explicit club original confirmation before publishing content eligible only by absent source. Test: not machine testable; the control is the documented preview prompt.
39. Capability revoked between the Edge Function check and the RPC. Likelihood low, impact high. A coach passes the early `has_perm` check in `manage-content-share`, then loses `shares.create` or the source capability (an admin demotes them, or a role change) before the lifecycle RPC runs. Prevention: the Edge Function check is only an early refusal; the RPC is the final authority and re validates the actor's profile, club membership, sharing capability, source capability and source ownership through explicit joins on the verified actor id inside the same transaction (sections 16.1, 17), so a revocation in the gap aborts the transaction and nothing is written. Detection: not needed (fail closed). Residual: negligible; the window is the RPC round trip and the RPC re checks. Test (security suite): grant a coach the capabilities, begin a share operation, revoke the capability, and assert the RPC refuses and writes no share and no success audit; the "capability revoked between checks" case is an explicit test.

For any threat marked residual, the residual is the honest limit of a view only unlisted link and is surfaced to the owner rather than hidden.

## 24. Testing strategy

Tests by layer, following the CONFIRMED repo conventions: no DOM Vitest unit and component tests (`npm test`), the local stack security suite with real JWTs (`npm run test:security`), and Deno tests for the `_shared` modules and `deno check` for the functions.

Pure unit tests (Vitest, in tree `*.test.ts`):

- Public snapshot builders for drill, session and programme.
- The recursive public payload allow list scanner (asserts no forbidden key at any nesting level).
- Board stripping (keeps `number, side, x, y`, drops `playerId` and `id`).
- Rights aggregation (an internal only nested item blocks the aggregate).
- Token generation and hash lookup (256 bit secret, base64url, SHA-256 hash, constant time compare).
- Expiry decisions (before, at, after `expires_at`; expired equals invalid equals revoked in the response).
- Source deletion state.
- Media projection (only referenced eligible paths, raw paths removed).
- Public response redaction (no excluded keys).
- The lifecycle reducer (create, refresh, rotate, revoke, status transitions).
- Native share and clipboard fallback selection (`navigator.share` present versus absent).

Database and security tests (`tests/security/`, real local JWTs, add a `content-shares.test.ts` suite following the `audit.test.ts` pattern):

- anon cannot directly read `content_shares`.
- Authenticated users cannot directly read or mutate `content_shares`.
- A parent cannot create or manage public shares.
- A cross club actor cannot create, refresh, rotate or revoke.
- A normal coach cannot share another coach's session.
- An owner can share eligible own content.
- The relevant manage holder can share club content.
- `shares.manage` can revoke another creator's share.
- Client supplied `club_id` and actor are ignored or rejected.
- The RPC is the final authority: it re validates, inside the transaction, that the actor still has a profile in the source club, still holds the required sharing capability, still holds the relevant source capability, still satisfies the source ownership or manage arm, and that the source still belongs to the club; a client that passes the early check but fails any of these is refused.
- Capability revoked between the early check and the RPC fails closed: after the early check passes, revoke the actor's capability, then assert the RPC writes no share and no success audit (threat 39).
- `actor_name` is resolved only after the authorisation checks pass, so a rejected attempt records nothing.
- The one active share invariant holds under concurrency (the three partial unique indexes).
- Source deletion invalidates the share (cascade).
- A rights downgrade invalidates only the dependent shares, found through `content_share_dependencies`, not others and not globally.
- `content_share_dependencies`: rows are written with Create and rebuilt on Refresh to match the snapshot; anon and authenticated cannot read or write the table; deleting a share cascades its dependency rows; the read path returns the generic response when a dependency is ineligible or its referenced entity is gone.
- The audit event commits with the lifecycle mutation.
- A failed lifecycle mutation produces no success audit.
- Direct audit writes remain refused (unchanged).
- Only `token_hash` is stored, no plaintext token.
- No existing RLS policy is weakened (the suite re runs the existing matrices).
- `capabilities.test.ts` `EXPECTED_CATALOGUE` updated to 22 keys with the `src` regex, so the tripwire passes only when both are updated.

Edge Function tests (Deno, `_shared/share_test.ts`, plus `deno check` on the two functions):

- The manage function requires a valid JWT.
- The read function works without a JWT.
- Raw browser snapshot input is rejected or ignored.
- The public token secret is not logged.
- Invalid, revoked and expired responses are equivalent.
- Media is signed only for referenced eligible assets.
- Raw paths are absent from the response.
- The snapshot size cap is enforced.
- Cross club source ids are refused.
- The public response contains no excluded keys.
- Restricted FA derived content fails closed.
- Replay and lost response retry remain idempotent (the idempotency key).
- The read path verifies dependency eligibility and returns the generic response when a dependency is ineligible or missing.
- Rate limiting (if the pseudonymous limiter is the chosen mechanism, section 25): the limiter key derives from an HMAC of the source IP and never stores the raw IP; limits apply by both `shareId` and pseudonymous source key; a limiter record expires at its TTL; concurrent requests do not miscount; a request with an absent or untrusted IP header is handled by the defined default (fail toward limiting per `shareId`); bypass attempts (spoofed or rotating headers) are bounded by the `shareId` limit. If platform rate limiting is chosen instead, these become configuration assertions rather than unit tests.
- The scheduled cleanup (section 8.4) clears the snapshot and dependency rows of a share expired beyond the retention window and emits `content_share.expired`, and does not touch a share still within the window or an active share.

Route and component tests (Vitest, no DOM, presentational views and pure seams, matching the repo style):

- The protected club link action (constructs the canonical URL, no write).
- Public link eligibility surfacing.
- The exact preview (renders the built snapshot).
- Saved session only (an unsaved draft cannot be shared).
- A dirty Planner uses Save and share safely (through the PR #103 seam).
- Repeated clicks create one operation (the guarded submit dedupe).
- The native share path and the clipboard fallback.
- Refresh keeps the URL; Rotate changes the URL; Revoke makes status unavailable.
- The public route initialises no protected providers or hooks.
- The generic unavailable page.
- Mobile and print rendering.

End to end and browser testing. CONFIRMED CURRENT STATE: the repo has no browser suite and no Playwright, Cypress or Puppeteer dependency. Assessment: a public, unauthenticated boundary is exactly the kind of surface a small real browser smoke test protects (fragment handling, Referer behaviour, print output, embed sandboxing are all browser behaviours the no DOM suite cannot exercise). RECOMMENDED: a small Playwright smoke suite is justified when public sharing ships, but it is a new dependency and is not added in this docs PR. The minimum real browser smoke matrix to run when the public slice lands:

- iPhone Safari.
- Android Chrome.
- Desktop Chrome.
- A logged out link (opens, renders, initialises no app).
- A revoked link (generic unavailable).
- An expired link (generic unavailable, indistinguishable from revoked).
- Private media refresh (an expired signed URL recovers via Reload).
- External link referrer behaviour (no referrer sent).
- Print or PDF output.

## 25. Observability

CONFIRMED CURRENT STATE: no error tracking, analytics, uptime or monitoring exists; `src` has no client logging; Edge Functions log status and counts only; run summaries return in the response and are not persisted.

RECOMMENDED DEFAULT: a privacy minimised operational baseline for the two functions, no more:

- Function success and failure counts.
- The action and content kind only.
- No token, title or snapshot logging.
- No child or member data.
- The error class.
- The response status.
- The execution duration.
- The signed media failure count.
- The rate limit refusal count, if a rate limit is used.

Assessment of where this lives:

- Supabase function logs already carry status and counts (the existing pattern); the sharing functions log the same shape.
- Vercel surfaces build and runtime errors for the front end; the public route errors surface there.
- External error tracking (for example a hosted error service) is not justified for v1 at a single club scale and would be a new dependency and a new data processor; it is a FUTURE OPTION.

Because the threat model's Detection lines (threats 24, 25, 11) rely on someone actually noticing a problem, v1 does not leave detection to a human happening to open the logs. The public slice commits a minimal, privacy minimised detection baseline. Privacy minimised, not "personal data free": rate limiting an anonymous endpoint necessarily processes the source IP, and even transient IP processing is privacy relevant, so the design says so plainly rather than claiming the baseline touches no personal data.

- A committed rate limit on `read-content-share`, by both `shareId` and a pseudonymous source key, with only a refused count logged (the throttle the abuse threats assume, not "consider a rate limit"). Implementation, in order of preference:
  - Use platform rate limiting if the Supabase or edge platform in use supports it, so the raw IP is handled by the platform and never reaches application code or storage.
  - Otherwise derive a short lived HMAC of the source IP with a rotating server only secret, and use that pseudonymous key as the limiter identity. Never store or log the raw IP. Retain the pseudonymous limiter record only for the minimum TTL the window needs, and expire it automatically. The pseudonymous key never enters `audit_events` or any persisted log.
  - Define behaviour when the IP header is absent or untrusted: do not trust a client supplied forwarding header blindly; when a trustworthy source IP is unavailable, fall back to limiting by `shareId` alone so the control still bounds abuse against a single link.
  - This is a PR 2 design gate: if no reliable distributed limiter is selected (platform or a shared store the functions can reach), the control is not claimed as committed; it is marked a PR 2 design gate and the corresponding Detection lines in section 23 (threats 24, 25) are downgraded to "no active detection in v1; function logs are available for manual post incident review only."
- An external uptime probe on the public route, hitting a known invalid `shareId` and asserting a fast generic response. This is committed as part of the public slice, not deferred, because the public route is the first thing an external person sees and the probe carries no personal data.
- A Supabase usage or billing alert, since the first anonymous endpoint is a new cost surface with no upstream auth to bound calls.
- A named owner and a documented periodic log review cadence, so the function success and failure counts are read on a schedule rather than only after an incident. The same owner owns the scheduled expiry cleanup (section 8.4) and its failure monitoring.

If the owner declines any of these for v1, the corresponding Detection lines in section 23 must be downgraded to "no active detection in v1; function logs are available for manual post incident review only," so the threat model does not claim a control that does not operate.

- Retention of operational logs follows the platform defaults; no new personal data is introduced, so no new retention decision is forced beyond the audit retention question already open (section 30).

Analytics that identifies viewers is not a prerequisite for v1 and is out of scope; the baseline above is aggregate operational metrics only, no viewer identity. Do not gate the release on viewer analytics.

## 26. Rollout and rollback

Per phase (section 27), the rollout follows the CONFIRMED gated discipline.

- Migrations are gated: opened as a PR, reviewed line by line, run by hand via the connector after the live ledger confirms the slot is free, never auto merged. Confirm a usable backup or point in time restore window before applying a destructive or boundary changing migration (the `0028` precedent).
- Edge Functions deploy from files on disk, never inline paste, verified by byte for byte readback of the deployed source (the `_shared/fa.ts` lesson).
- The security suite runs in CI (added in PR #105). CONFIRMED CURRENT STATE caveat (section 3.8): the security job "may sit outside required checks until it proves stable," and branch protection is not visible in the repo, so a red security suite may not mechanically block merge yet. The rollout therefore relies on the security job being a required check, and until that is confirmed the real gate is reviewer discipline plus the no auto merge rule on every gated PR. A recommended precondition for the first public PR is confirming the security job is a required check.
- Vercel deploys `main` to production and every PR to a preview URL. The public route markup and headers are verified on a preview URL, but note the CORS constraint (section 16.2): a preview origin differs from `APP_ORIGIN`, so an in browser end to end call from the preview page to the function is blocked. Preview verification of the function is therefore server side (a curl against the deployed function), and in browser end to end verification of the public page is scoped to the production origin, or a preview origin is temporarily allowlisted for the check.
- Post deploy verification for the public functions reads the deployed source back byte for byte, separately confirms `read-content-share` is anon reachable and every other function (`manage-content-share` plus the eight pre existing, nine in total after PR 2) remains `verify_jwt = true` and not anonymously reachable (source readback does not cover `verify_jwt`), and exercises a real invalid, revoked and expired link against the deployed function, plus a real eligible share end to end on the production origin.

Disable and rollback mechanism:

- A club level kill switch, built, not deferred. RECOMMENDED DEFAULT: a `clubs.public_sharing_enabled` boolean (a `clubs` column, since `clubs` has no settings column today, so this is a small gated migration) that the `read_public_share` definer function checks after resolving the share's `club_id`, so every public read for that club returns the generic unavailable response while it is off, without deleting or touching any share row. The boolean is added to the schema in PR 1 and the read path check in PR 2, so the lever exists before the first public read ships; section 30 decision 18 is resolved before PR 2, not after. Honest cost: flipping a per club switch is a single row `update`, a small audited data change, not "no data change"; it is instant, but it is a data change. If an instant all clubs emergency stop is also wanted, that is a separate, explicitly global lever (a function environment flag), kept distinct from the per club switch rather than presented as interchangeable with it.
- Rollback of a lifecycle bug: because the two functions are separate, the read function can be rolled back independently of manage; because share rows carry no content beyond the snapshot, disabling reads exposes nothing while a fix is prepared.
- Rollback of a migration follows the gated procedure with a confirmed restore window; the `content_shares` table is additive and its drop is structural, but a destructive backfill (for example a rights backfill) must confirm a backup first.

## 27. Phased implementation PRs

Every implementation PR below specifies user outcome, current code evidence, scope, explicit non scope, likely files, migrations, RPCs, Edge Functions, capability changes, audit actions, tests, accessibility, human gates, rollout order, backup requirement, post deploy verification, rollback or disable mechanism, estimated size, dependencies, and whether auto merge is prohibited.

Standing rule for every migration in this section: the numbers are provisional. CONFIRMED CURRENT STATE: disk ends at `0030_audit_foundation.sql`; the Registered Players programme reserves the provisional band 0031 through 0037; so the sharing migrations are provisional at 0038 and beyond at the time of writing. Never hardcode a number. Confirm the next free slot against the live hosted ledger at apply time, and treat a merged but unapplied migration file as a taken slot.

No sharing implementation PR that contains a migration, a public function, a rights boundary or a public route may auto merge.

### PR 0: Internal club link sharing

- User outcome: a coach copies or natively shares a protected link to a saved session, drill or programme; the recipient signs in and lands on the existing detail page.
- Current code evidence: Session Day, Drill Detail, Programme Detail exist and are club wide readable (section 3); the Planner draft has no URL until saved (section 7); `navigator.share` and clipboard are ABSENT today.
- Scope: Share buttons on Session Day, Drill Detail, Programme Detail; saved Planner handling with "Save and share" through the PR #103 seam; native share with clipboard fallback; "OTJ account required" copy.
- Non scope: no public data boundary, no snapshot, no rights model.
- Likely files: `src/routes/SessionDay.tsx`, `src/routes/DrillDetail.tsx`, `src/routes/ProgrammeDetail.tsx`, `src/routes/Planner.tsx`, a small share helper in `src/lib/`, `src/components/ui.tsx` if a shared Share control is added.
- Migrations: none. RPCs: none. Edge Functions: none. Capability changes: none. Audit actions: none.
- Tests: route and component tests for the URL construction, the native share path, the clipboard fallback, the unsaved draft guard, and the Save and share seam reuse.
- Accessibility: 44px controls, labelled buttons, `role="status"` copy feedback.
- Human gates: normal review; no gated surface.
- Rollout order: first, and can ship early.
- Backup requirement: none.
- Post deploy verification: a preview URL check that Share copies and shares the canonical URL.
- Rollback or disable: remove the buttons; no data to roll back.
- Estimated size: S.
- Dependencies: PR #103 (merged).
- Auto merge: allowed (no gated surface), but see the UNRESOLVED decision in section 7 on whether to ship it before roadmap approval.

### PR 1: Rights model, capabilities and public share schema

Status: IMPLEMENTED in migration `0038_content_sharing.sql` (the next free slot
after the live ledger's `audit_rollout`, 0037; 0033 remains merged but
deliberately unapplied and is untouched). The security contract for what was
built is `docs/security/content-sharing-boundary.md`. Owner decisions were
approved and applied as fixed requirements: FA and unclassified content default
internal only; coaches get `shares.create`, managers and admins get
`shares.create` and `shares.manage`; one active link per source; hash only
secret; 90 day default expiry with no-expiry reserved to `shares.manage`; the
per club kill switch defaults off and gates create, refresh and rotate while
revoke stays allowed. No public route, public Edge Function, anonymous read or
public snapshot rendering ships in PR 1; those remain PR 2.

- User outcome: none visible yet; this is the security substrate.
- Current code evidence: no rights field exists (section 13); capabilities are data with a pinned catalogue test (section 18); `audit_events` supports new actions without a table change (section 19).
- Scope: `shares.create` and `shares.manage` capabilities and grants; a content rights classification (the `internal_only` / `public_link_only` / `public_full` vocabulary) on media and content, with an FA derivation backfill (`isFaUrl` on `source_url`) defaulting FA content, including stored FA video bytes, to internal only; the `content_shares` table with the hashed fragment secret model, the three foreign key exactly one design, `on delete set null` person FKs, `idempotency_key`, the three partial unique indexes, and `snapshot` cleared on revoke; the private `content_share_dependencies` reverse index table (section 15.1) with no client policy; the `clubs.public_sharing_enabled` kill switch boolean; the exact direct access posture (no client policy at all on `content_shares` or `content_share_dependencies`); the lifecycle RPC that re validates the full authorisation inside the transaction (actor club, sharing capability, source capability, source ownership, source club) through explicit joins on the verified actor id, writes the dependency set, and calls the sharing audit writer with a durable source reference and a sharing specific metadata allow list; the rights downgrade path that invalidates dependent shares through the reverse index; the `content_share.*` action additions to the authoritative catalogue in `app-audit-boundary.md`; the security harness additions; no public page yet.
- Non scope: the public functions and the public route (PR 2).
- Likely files: a provisional migration at 0038 or the next free slot; `supabase/seed.sql` and `supabase/seed_teams` style grants; `tests/security/content-shares.test.ts`; `tests/security/capabilities.test.ts` update to 22 keys; `src/lib/data.ts` capability and rights types; `docs/security/` a new sharing boundary document.
- Migrations: one gated migration (provisional 0038+), creating `content_shares`, the rights columns, the grants, the RPC, and the writer.
- RPCs: the lifecycle RPC (service role only) and the sharing audit writer.
- Edge Functions: none.
- Capability changes: add `shares.create`, `shares.manage`; grants per section 18.
- Audit actions: register `content_share.created/refreshed/rotated/revoked` in the writer's allow list and metadata shape, and add them (rotated included, which is not currently reserved) to the authoritative reserved catalogue in `docs/security/app-audit-boundary.md`.
- Tests: the security suite additions (section 24 database and security list), the `capabilities.test.ts` `EXPECTED_CATALOGUE` update to 22, and the separate `CAPABILITY_PATTERN` regex domain update for the `shares` domain (a required manual step CI does not enforce, section 3.8).
- Accessibility: not applicable (no UI).
- Human gates: migration and RLS and capability and audit changes are all gated; do not auto merge.
- Rollout order: after PR 0, before PR 2.
- Backup requirement: confirm a restore window before the rights backfill (it writes a rights class to existing media and content).
- Post deploy verification: the security suite green in CI; a manual check that a parent and a cross club actor are refused by the new policies.
- Rollback or disable: the table and columns are additive; a rollback drops them via the gated procedure with a confirmed backup.
- Estimated size: L.
- Dependencies: PR 0 optional, the audit foundation (merged, PR #105).
- Auto merge: prohibited.

### PR 2: Public drill sharing vertical slice

Status: IMPLEMENTED in `0039_public_share_read.sql` (the next free slot after
0038), the two Edge Functions `manage-content-share` (verify_jwt on) and
`read-content-share` (verify_jwt off), the shared builder
`supabase/functions/_shared/share.ts`, and the code-split public route
`/share/:shareId`. The security contract is the PR 2 part of
`docs/security/content-sharing-boundary.md`. Drill only; sessions and programmes
remain unsupported publicly. NOT applied or deployed to hosted: the migration is
not run on hosted, no Edge Function is deployed, and `public_sharing_enabled`
stays false on every club, pending separate explicit approval and the human
gates below.

- User outcome: a coach creates a public link to a drill; an external recipient opens it without an account and sees the drill and its eligible media.
- Current code evidence: Drill Detail exists; drills are the smallest complete content unit and the first to exercise media signing and rights.
- Scope: the two Edge Functions (`manage-content-share`, `read-content-share`); the narrow `read_public_share` SECURITY DEFINER read path with the kill switch check and the dependency eligibility verification inside it (section 15.1, 16.2); the `[functions.read-content-share] verify_jwt = false` block in `config.toml`; the pure shared snapshot builder and allow list scanner in `_shared/share.ts`; the code split public route `/share/:shareId` outside auth; the Drill Detail public share flow (preview, create, refresh, rotate, revoke) including the per entity manager Revoke from PR 2 onward so oversight exists as soon as public sharing does; eligible media signing; the rate limit (platform limiting if available, else a pseudonymous HMAC of IP limiter per section 25, or explicitly marked a PR 2 design gate with the Detection claims downgraded if no reliable mechanism is selected); the uptime probe and the billing alert; the scheduled private expiry cleanup process (owner, daily cadence, failure monitoring, test) that clears expired snapshots and dependency rows and emits `content_share.expired`; a minimal print stylesheet so the public page prints usably from day one; mobile and accessibility; deployed function byte readback plus the positive `verify_jwt` check.
- Non scope: sessions and programmes (PR 3 and PR 4); a generated PDF and print refinement (PR 6); the club wide management page (PR 5).
- Likely files: `supabase/functions/manage-content-share/index.ts`, `supabase/functions/read-content-share/index.ts`, `supabase/functions/_shared/share.ts` and `share_test.ts`, `src/routes/PublicShare.tsx`, `src/App.tsx` (the public route), `vercel.json` (the `/share/*` headers), `src/routes/DrillDetail.tsx`, a Share modal on the existing `Modal` primitive, `src/lib/queries.ts` (the public and management query hooks), `ci.yml` (`deno check` and `deno test` additions).
- Migrations: none if PR 1 provided the schema; otherwise a follow up gated migration.
- RPCs: uses the PR 1 lifecycle RPC.
- Edge Functions: two new; `read-content-share` is the first public function and declares `verify_jwt = false` in `config.toml` (version controlled), holds the service role, and reaches the database only through `read_public_share`.
- Capability changes: none beyond PR 1.
- Audit actions: emits the PR 1 registered actions.
- Tests: the unit builders and scanner; the Deno function tests; the route and component tests; the security suite already covers the table.
- Accessibility: the full section 22 list for the Share modal and the public page.
- Human gates: public function, public route, rights boundary; do not auto merge; byte for byte readback of both deployed functions.
- Rollout order: after PR 1.
- Backup requirement: none new (no destructive migration).
- Post deploy verification: readback of both functions and the positive `verify_jwt` check (read function anon reachable, every other function `verify_jwt = true`); a real eligible drill share end to end on the production origin (a preview origin is CORS blocked by the `APP_ORIGIN` lock unless temporarily allowlisted, section 16.2); invalid, revoked and expired all return the generic response; the public route mounts no authenticated provider.
- Rollback or disable: the club level kill switch (section 26); the read function can be rolled back independently.
- Estimated size: L.
- Dependencies: PR 1.
- Auto merge: prohibited.

### PR 3: Public session sharing

Status: IMPLEMENTED in `0040_public_session_read.sql`, the session builder in
`supabase/functions/_shared/share.ts`, the session branches of
`manage-content-share` and `read-content-share`, and the session rendering in
`src/routes/PublicShare.tsx` / `src/components/PublicSessionView.tsx`, with the
Session Day public share control. The security contract is the PR 3 part of
`docs/security/content-sharing-boundary.md`. NOT applied or deployed to hosted;
`public_sharing_enabled` stays false on every club, pending separate explicit
approval and the human gates below.

- User outcome: a coach shares a saved session; the external recipient sees the ordered activities, referenced drills, safe board and safe fields.
- Current code evidence: Session Day and the Planner save seam exist; sessions carry the operational fields the allow list must exclude (section 11.1).
- Scope: the saved session share flow; the Session Day Share action; activity and referenced drill projection; the safe board projection (numbers and positions only); operational fields excluded. The public share operates on a persisted session id (like a drill), so it lives on Session Day; the Planner's existing "Save and share" is the internal club link and is unchanged.
- Non scope: programmes (PR 4).
- Likely files: `_shared/share.ts` (session builder), `src/components/PublicSessionView.tsx`, `src/routes/PublicShare.tsx` (session render and board render), `src/routes/SessionDay.tsx` (the public share control), `manage-content-share`/`read-content-share` (session branch).
- Migrations: one small gated migration (`0040`) was required, correcting the roadmap's earlier "none" estimate. PR 2's `read_public_share` hardcoded the drill-only kind; `0040` widens the kind gate to {drill, session} (the read path's board arm, which already scopes by the canonical `boards.club_id`, is unchanged). `0040` also aligns `content_share_deps`' board dependency scoping to the same canonical `boards.club_id` the read path and the boards RLS use, instead of the board creator's profile club (consistent, canonical, two-valued). The whole PR 1 management substrate (RPC, dependency resolver, downgrade triggers, audit) already supported sessions with no change. RPCs: reuse. Edge Functions: extend the builder, redeploy with readback.
- Capability changes: none. Audit actions: reuse.
- Tests: session builder unit tests (all section 11.1 exclusions), the board stripping test, the Spond and schedule exclusion tests, route tests for Save and share.
- Accessibility: accessible activity order, board accessible summary.
- Human gates: public projection change and function redeploy; do not auto merge; readback.
- Rollout order: after PR 2.
- Backup requirement: none.
- Post deploy verification: a session snapshot on a preview URL shows no date, venue, team, coach, Spond or attendance data; board shows numbers and positions only.
- Rollback or disable: kill switch; revert the builder change and redeploy.
- Estimated size: M to L.
- Dependencies: PR 2.
- Auto merge: prohibited.

### PR 4: Public programme sharing

- User outcome: a manager shares a programme; the recipient sees the overview and ordered weeks with enough safe session and drill information to use it.
- Current code evidence: Programme Detail renders ordered weeks from templates (section 3.3); the FA programme importer caps at 10 weeks.
- Scope: ordered weeks; templates; nested drills and eligible media; programme snapshot size caps; restricted content aggregation (a nested internal only item blocks the aggregate); the attached PDF policy (the private programme PDF is shared only if explicitly `public_full`).
- Non scope: copy and import (PR 7).
- Likely files: `_shared/share.ts` (programme builder), `src/routes/ProgrammeDetail.tsx`, `src/routes/PublicShare.tsx` (programme render).
- Migrations: none. RPCs: reuse. Edge Functions: extend the builder, redeploy with readback.
- Capability changes: none. Audit actions: reuse.
- Tests: programme builder unit tests including the `author` exclusion, the snapshot local reference design, the size and week caps, and the aggregate rights block.
- Accessibility: ordered week and activity semantics.
- Human gates: public projection change and redeploy; do not auto merge; readback.
- Rollout order: after PR 3.
- Backup requirement: none.
- Post deploy verification: a programme snapshot on a preview URL shows no author, owner, dates or internal ids, and a programme nesting an FA drill is blocked from public sharing.
- Rollback or disable: kill switch; revert the builder change.
- Estimated size: L.
- Dependencies: PR 3.
- Auto merge: prohibited.

### PR 5: Shared links management

- User outcome: a manager sees and manages the club's active shares.
- Current code evidence: no management surface exists.
- Scope: a "Shared links" management screen for `shares.manage` holders; filter by kind, status and by unattributed or former member (a share whose `created_by` is null because the creator was removed); the resolved source entity name and the `shareId` shown per row so a reported `/share/:shareId` URL maps to a row; a redacted stored snapshot review so a manager sees what a share exposes before acting; the departing member prompt ("this member has N active public shares, review them") surfaced in or alongside the removal flow, with the original sharer recoverable from the audit `actor_name`; Revoke (not Rotate, section 18); optional bulk revoke of a departed member's shares. No token display after initial creation.
- Assessment of placement: this can be folded into PR 2 to PR 4 as per entity controls, or be its own screen. RECOMMENDED: per entity controls ship in PR 2 to PR 4 (each detail page manages its own share), and a club wide management screen is its own PR here for managers who need the whole picture.
- Important: because the database stores only a hash, the raw secret cannot be displayed later. So the management screen shows status, times, expiry, source name and the redacted stored snapshot, and offers Revoke, but cannot show the live link for an existing share. Revoke only here, not Rotate: Rotate is an owner action on the per entity Share surface (section 18), because a manager rotating another coach's link would silently kill it and receive the new secret. RECOMMENDED SECURITY DEFAULT: the raw secret is shown only on Create or Rotate and is never recoverable from the database; an owner who lost the link rotates their own share to get a new one. UNRESOLVED DECISION (section 30 decision 8): whether the current URL is instead stored encrypted so it can be reshown, at the cost of holding a reversible secret. The recommended default keeps only a hash.
- Likely files: a new `src/routes/AdminShares.tsx` (or a section of an existing admin route), `src/lib/queries.ts` (a management list hook via the management function), `src/App.tsx` (a `RequireCap cap="shares.manage"` route).
- Migrations: none. RPCs: reuse (a list action on the management function). Edge Functions: extend `manage-content-share` with a list action.
- Capability changes: none. Audit actions: reuse (revoke; rotate stays an owner action on the per entity surface).
- Tests: route tests for the list, filter (including unattributed or former member), the redacted snapshot review, the shareId lookup, and Revoke; a test that the raw secret is not shown for an existing share; a test that a manager cannot Rotate another creator's share.
- Accessibility: the section 22 list for the screen.
- Human gates: touches the management function (redeploy with readback); do not auto merge.
- Rollout order: after PR 2 at the earliest; naturally after PR 4.
- Backup requirement: none.
- Post deploy verification: the list shows status and the redacted snapshot without secrets; Revoke works from the screen; a reported shareId resolves to a row.
- Rollback or disable: remove the route; the underlying functions are unchanged.
- Estimated size: M.
- Dependencies: PR 2.
- Auto merge: prohibited (function redeploy).

### PR 6: Print and PDF export

- User outcome: an owner or recipient prints or saves the public page as a PDF.
- Current code evidence: PDFs render inline; there is no session to PDF export; the only export today is the `.ics` download.
- Scope: a print stylesheet for the public page; browser print or save as PDF from the safe public projection; an optional generated PDF only if browser print is inadequate; no unrestricted row to PDF path; a clear warning that a downloaded file cannot be revoked; rights rules identical to public sharing.
- Non scope: any export that reads live rows.
- Likely files: `src/routes/PublicShare.tsx` (print styles), possibly a generated PDF function only if needed.
- Migrations: none. RPCs: none. Edge Functions: none, unless a generated PDF function is built (then a new function with readback).
- Capability changes: none. Audit actions: none new (export from the public projection is a view, not a lifecycle event); if a generated PDF function is built, decide whether to audit it.
- Tests: print layout tests; a test that export consumes the snapshot, not the row.
- Accessibility: print layout legible; the section 22 print item.
- Human gates: normal review unless a generated PDF function is added (then gated).
- Rollout order: after the public slices.
- Backup requirement: none.
- Post deploy verification: printed output matches the safe snapshot with no operational fields.
- Rollback or disable: remove the print styles.
- Estimated size: S to M.
- Dependencies: PR 2 at least; ideally after PR 4.
- Auto merge: allowed for browser print only; prohibited if a generated PDF function is added.

### PR 7: Authenticated copy and import

- User outcome: a future recipient signs in and creates their own editable copy of shared content.
- Current code evidence: none; this is greenfield and mirrors the separate Registered Players import and export programme.
- Scope: the section 10 requirements (sign in, preview provenance and rights, explicit import, new ids, no ownership impersonation, retained attribution, duplicate handling, source club data not exposed, imported third party content obeys rights, audit events).
- Non scope: everything already shipped.
- Likely files: substantial; treat as its own scoping exercise.
- Migrations: likely (an import provenance record); provisional, confirm the free slot at apply time.
- RPCs: an import RPC. Edge Functions: possibly.
- Capability changes: possibly an import capability. Audit actions: an import action.
- Tests: full security and unit coverage; the rights laundering guard is central.
- Human gates: gated throughout; do not auto merge.
- Rollout order: a separate future programme.
- Estimated size: XL; scope separately.
- Dependencies: the public sharing programme.
- Auto merge: prohibited.

### PR 8: Future extensions

Assessed and ranked in section 29. Not scheduled here.

## 28. Portfolio placement

CONFIRMED CURRENT STATE: two active roadmaps sit alongside this one.

- `docs/roadmaps/registered-players-delivery-plan.md`: the Registered Players programme, eight PRs, child data, consuming provisional migrations 0031 through 0037 (0030 already taken on disk by PR #105).
- `docs/roadmap/product-excellence-roadmap.md`: a ranked 1 to 10 reliability and quality list, pinned as of PR #100. Its initiative 1 (newest first) shipped in PR #102 and initiative 2 (make save failures visible) was effectively delivered by PR #103.

What can run in parallel:

- PR 0 (internal club links) can run alongside anything; it touches route UI only and no gated surface.
- The docs and design of this programme run alongside both other roadmaps freely.

What shares files or migration slots, and must be sequenced:

- Migration numbers: the Registered Players programme is consuming the 0031 to 0037 band. This roadmap reserves no number in that band. Every sharing migration chooses its number from the live ledger and the merged files at apply time, provisional at 0038 and beyond at the time of writing, and treats a merged but unapplied file as taken. Do not reserve numbers for content sharing.
- `src/lib/queries.ts` is a shared, heavily edited file (the sharing query hooks and the Registered Players query hooks both land here). Sequence merges to avoid conflicts, or land the sharing hooks in a clearly separated block.
- `src/App.tsx` is edited by any route addition (the public `/share` route here, the Registered Players routes there). Coordinate the two route additions.
- `src/components/ui.tsx` is shared (the `Modal` focus trap from Product Excellence initiative 10, the Share modal here). Do not build two focus traps; whichever lands first provides it.
- The capability catalogue and its `capabilities.test.ts` tripwire are shared and pinned to an exact count. Registered Players PR 1 already moved the count to 20. Adding `shares.create` and `shares.manage` moves it to 22, and moves it again if Registered Players adds more concurrently. Whichever capability PR merges must update the count and the other in flight capability PR must rebase onto the new count. This is a real coupling point to manage.
- The audit action catalogue and the audit writer are shared. Registered Players PR 2 adds the player trigger actions; this programme adds the `content_share.*` actions. The audit boundary document already reserves the sharing actions, so they are additive, but both touch the writer or its siblings.
- The security harness (`tests/security/`) and CI gain suites from both programmes; they compose without conflict but the local stack run time grows.

What must wait:

- Public sharing (PR 2 onward) should follow PR 1 (the schema and rights substrate), which itself waits only on the audit foundation (merged).
- Copy and import (PR 7) waits for the whole public sharing programme.

What should be paused to avoid conflicts:

- Nothing needs pausing, but the capability count coupling and the `queries.ts` and `App.tsx` file coupling mean the two active programmes should not land capability or route migrations in the same window without rebasing. The Registered Players programme is the higher priority child data work and is consuming the near term migration band; content sharing sequences its migrations after that band and rebases its capability count onto whatever the catalogue reads at apply time.

Recommended factual link to the Product Excellence roadmap: a one line pointer noting that content sharing is tracked in this document as separate forward work, added without reordering the ranked list. That single edit is made on this branch (section 26 rollout notes the branch is docs only).

## 29. Future extensions

Ranked and assessed. Each is a FUTURE OPTION.

- Sharing templates: after programmes, because a template is a programme week without the programme wrapper; low extra cost once sessions and programmes ship. Recommended after programmes.
- Board only sharing: only with the existing no name boundary (`registered-players-boundary.md:559-564`, numbers and positions only). A board carries little without its session context, so low priority; allowed later strictly under the shape and numbers rule.
- Audience specific links: multiple links per source, each with its own expiry or note. Useful for a manager sharing with several external colleagues; deferred from the one active link per source v1 default.
- Password or email specific access: a second factor on a public link. Justified only if the club finds unlisted links insufficient; adds recipient friction and a credential to handle. Deferred.
- QR code: a convenience rendering of the same link. Useful on a printed plan; must never be the only method (accessibility). A later convenience.
- View counts without personal tracking: a bare increment with no identity. Low value against the messaging bot noise and the personal data caution; deferred, and if built, aggregate only, never per viewer.
- Comments: not in the initial programme; adds moderation, identity and abuse surface.
- Version comparison: showing what changed between snapshot versions. Niche; deferred.
- Collaborative editing: out of scope entirely; contradicts the read only model.
- Public club coaching library: a discoverable public catalogue. Rejected for the foreseeable future; it contradicts invite only membership and the FA "not made public" terms at scale.
- Content marketplace: selling content. Rejected; the FA terms forbid selling FA content and the club is a non commercial charity.

Default recommendations, restated: template sharing after programmes; board only sharing only under the no name boundary; QR as a later convenience; no comments in the initial programme; no public library; no marketplace; no collaborative editing; no viewer identity tracking.

## 30. Decisions requiring approval

Each decision lists the recommended choice, the strongest alternative, the user value trade off, the privacy or security trade off, the implementation impact, and what evidence would change the recommendation.

1. May any England Football text be included publicly, or must all FA derived content be internal only?
   - Recommended: all FA derived content internal only until the owner records a decision, informed by the FA terms.
   - Strongest alternative: allow FA derived text (not images or video) publicly, on the reasoning that unmodified text attribution is lighter than image reuse.
   - User value: FA text in a shared plan is useful to an external coach; blocking it reduces what a shared FA session shows.
   - Privacy and security: publishing any FA content is the first breach of "not made public"; the safe default avoids it entirely.
   - Implementation: the rights default and the aggregate block already encode internal only; allowing FA text would need a distinct text versus media rights split.
   - Evidence that would change it: a written confirmation from the club or the FA that unmodified attributed FA text may appear on an unlisted non commercial club share.

2. How is club owned versus third party media classified?
   - Recommended: explicit rights class on media, backfilled from `source_url` via `isFaUrl` (FA to internal only), unknown to internal only, absent source to eligible for club original.
   - Strongest alternative: pure runtime derivation with no stored class.
   - User value: an explicit class lets a coach mark their own uploads shareable; runtime derivation cannot record that intent.
   - Privacy and security: an authoritative stored class is auditable and fails closed; runtime derivation is fragile.
   - Implementation: a migration adds the column and backfills; runtime derivation adds none but is weaker.
   - Evidence that would change it: if the club never wants to share any media publicly, the class could stay a simple internal only constant.

3. Does one restricted nested item block the entire public session or programme?
   - Recommended: yes, block the aggregate in v1 rather than produce a partial plan.
   - Strongest alternative: publish the aggregate with the restricted item replaced by an attribution link or a placeholder.
   - User value: a partial plan is still useful; blocking is stricter and may frustrate.
   - Privacy and security: blocking is the safe default; partial publishing risks a rights leak through an overlooked nested item.
   - Implementation: blocking is simpler and safer; partial publishing needs a per item substitution design.
   - Evidence that would change it: owner acceptance of a clearly marked "some content is not shown" partial view, once the rights model is proven.

4. Do coaches receive `shares.create` by default?
   - Recommended: yes, coaches get `shares.create`.
   - Strongest alternative: only managers and admins can create public shares.
   - User value: Phil is a coach; giving coaches the capability serves the request directly.
   - Privacy and security: coaches already own and control their content; sharing their own eligible content is consistent with ownership.
   - Implementation: a grant row per role.
   - Evidence that would change it: if the club wants public sharing centralised through managers for oversight.

5. Do managers receive `shares.manage`, and what does it authorise?
   - Recommended: yes, managers and admins get `shares.manage`, scoped to Revoke any club share and to the redacted review of what a share exposes, but not Rotate or Refresh of another creator's share (those stay with the owner, section 18).
   - Strongest alternative: only admins manage shares; or managers may also Rotate with a defined owner handoff.
   - User value: a manager can revoke a mistaken or stale club share without an admin, and can see what it exposed first; letting managers Rotate too risks silently killing a coach's link.
   - Privacy and security: `shares.manage` Revoke is a safety lever; the redacted review shows the snapshot but no secret; excluding Rotate avoids a manager reissuing a link the owner does not know about.
   - Implementation: a grant row plus the scoped actions in the function.
   - Evidence that would change it: if the club wants revocation reserved to admins, or explicitly wants managers to Rotate (then the owner handoff must be designed).

6. One active link or multiple per source?
   - Recommended: one active public link per source entity per club in v1.
   - Strongest alternative: multiple or audience specific links.
   - User value: multiple links suit several distinct recipients; one link is simpler.
   - Privacy and security: one link is fewer secrets to track and leak; multiple links widen the surface.
   - Implementation: one link is a partial unique index; multiple removes it and complicates the UI.
   - Evidence that would change it: a real need to share the same content with several audiences on different terms.

7. Expiry default, and whether "Never" is allowed?
   - Recommended: 90 days default for drills and sessions, evaluated for programmes (longer or manager set none), owner may shorten, manager may allow none.
   - Strongest alternative: no expiry by default.
   - User value: no expiry is convenient; a default expiry limits a forgotten link.
   - Privacy and security: a default expiry bounds a leaked link; "Never" removes that bound.
   - Implementation: an `expires_at` compared at read time; a per kind default is a small builder rule.
   - Evidence that would change it: the programme reuse pattern may justify a longer or absent programme expiry.

8. Share secret shown once, or stored in a recoverable encrypted form?
   - Recommended: shown only on Create or Rotate; only a SHA-256 hash is stored; an owner who loses it rotates.
   - Strongest alternative: store the URL encrypted so it can be reshown.
   - User value: reshowing is convenient; rotation is a small extra step.
   - Privacy and security: storing only a hash means a database reader never sees a working secret; a reversible store holds a recoverable secret.
   - Implementation: hash only is simplest and safest; a reversible store adds key management.
   - Evidence that would change it: strong owner demand to reshow a link without rotating, weighed against holding reversible secrets.

9. Are session date, time, venue and team always excluded, and is the age band included?
   - Recommended: date, start time, venue and team are always excluded from public snapshots. The `age_group` band (for example "U10s") is included, because on its own, absent date, time, venue and team, it identifies a coaching level, not a place, a time or a named team, and it helps a recipient judge fit (section 11.1).
   - Strongest alternative: exclude the age band too, treating any team related label as sensitive; or allow the owner to opt in to showing a date.
   - User value: the age band helps an external coach place the session; a date would help more but is unsafe; excluding all of it is safest but least useful.
   - Privacy and security: when and where a youth team trains is safeguarding sensitive, so date, time, venue and team stay out; an age band alone is coarse and non locating.
   - Implementation: the allow list includes `age_group` and excludes the rest; moving the band out is a one line change plus appendix 33.2.
   - Evidence that would change it: a safeguarding view that even a coarse age band, combined with the club name on the page, is too identifying, in which case the band moves to the exclude list.

10. Is the club name and crest public on the share page, and how before multi tenant?
    - Recommended: yes, club name, motto and, in the single club deployment, the bundled public `/crest.png`; the club database id is never a returned branding field (though it does appear in cleartext inside any signed media or crest URL, the section 20 and threat 37 residual). Before any multi club deployment, resolve the crest per club from the share's `club_id` (a signed per club crest or a per club public branding asset), because the bundled crest is OTJ's own and would mismatch another club (section 21.2). Label the bundled crest a single club placeholder.
    - Strongest alternative: omit branding, or serve the per club crest from day one.
    - User value: branding helps the recipient trust the link; a wrong crest in multi tenant would erode that trust.
    - Privacy and security: the public name and motto are already public; the bundled crest is a public static asset; the club id is never a returned branding field, though it does appear in cleartext inside any signed media or crest URL (section 20, threat 37); a per club signed crest reuses the media signing already designed.
    - Implementation: single club uses the static asset now; multi tenant adds a per club crest resolution, a recorded follow up.
    - Evidence that would change it: the timeline to multi club, which decides whether per club branding is built now or as the follow up.

11. Are public YouTube embeds allowed, or link only?
    - Recommended: allowed as sandboxed `youtube-nocookie.com` embeds when the video is already public and embedding is permitted, otherwise link only.
    - Strongest alternative: link only always.
    - User value: an inline embed is nicer than a link.
    - Privacy and security: a sandboxed embed with no referrer leaks nothing; a link is even more conservative.
    - Implementation: the embed already exists in app; the public page reuses the sandboxed form.
    - Evidence that would change it: any concern about third party embed behaviour on a public page.

12. Can programme PDFs ever be shared?
    - Recommended: only if the PDF's rights class is explicitly `public_full`; FA PDFs default internal only.
    - Strongest alternative: never share the attached PDF publicly.
    - User value: the PDF is a convenient offline copy; most attached PDFs are FA derived.
    - Privacy and security: FA PDFs are the highest rights risk; the default keeps them internal.
    - Implementation: the media rights class gates the PDF exactly like any other media.
    - Evidence that would change it: a club owned, non FA programme PDF the club wants public.

13. Does creator removal revoke links, and how are a departed coach's shares handled?
    - Recommended: no automatic revoke on creator removal; the snapshot is frozen, `created_by` becomes null (`on delete set null`, section 15), and a manager can revoke. To make "a manager can revoke" real, the removal flow surfaces "this member has N active public shares, review them", the PR 5 list has an unattributed or former member filter, the original sharer stays recoverable from the audit `actor_name`, and a bulk revoke of a departed member's shares is offered.
    - Strongest alternative: revoke all of a removed member's shares automatically at removal.
    - User value: keeping a useful share alive after a coach leaves may be desirable; auto revoke is tidier but may kill a link the club still wants.
    - Privacy and security: the frozen snapshot exposes nothing new when the creator leaves; the review prompt plus the filter mean a departed coach's public links are findable, not orphaned silently.
    - Implementation: `set null` plus the removal prompt and the PR 5 filter; auto revoke would be a trigger.
    - Evidence that would change it: a policy that a departed member's shares must all be revoked, which flips the default to auto revoke.

14. Is a public page view count useful enough to justify collection?
    - Recommended: no view tracking in v1.
    - Strongest alternative: an aggregate, identity free count.
    - User value: a coach might like to know a link was opened.
    - Privacy and security: any view collection touches anonymous viewer data and is polluted by preview bots.
    - Implementation: none in v1; an aggregate counter is a later, careful add.
    - Evidence that would change it: a clear owner need for a count, satisfied by an aggregate only design.

15. Does browser print satisfy PDF export?
    - Recommended: start with browser print from the public projection; build a generated PDF only if print is inadequate.
    - Strongest alternative: a generated PDF from the start.
    - User value: a generated PDF is more controlled; browser print is immediate and free.
    - Privacy and security: both consume the safe snapshot, so both are safe; a generated PDF adds a function to maintain.
    - Implementation: print is a stylesheet; a generated PDF is a new function.
    - Evidence that would change it: print output that breaks activity or board layout badly.

16. When does copy and import become worth building?
    - Recommended: after the public sharing programme is live and used, as its own scoping exercise.
    - Strongest alternative: never, if viewing is enough.
    - User value: copy and import lets a recipient reuse content, a real step beyond viewing.
    - Privacy and security: it multiplies the rights surface (content crossing clubs).
    - Implementation: XL; a separate programme.
    - Evidence that would change it: repeated requests to reuse shared content, not just view it.

17. Does the club need a management page for every active share?
    - Recommended: per entity controls in PR 2 to PR 4, plus a manager wide screen in PR 5.
    - Strongest alternative: per entity controls only.
    - User value: a manager overseeing many shares benefits from one screen; a small club may not need it.
    - Privacy and security: a management screen shows status and never secrets.
    - Implementation: an extra route and a list action.
    - Evidence that would change it: how many shares a club actually accumulates.

18. Should public sharing be disabled through a switch as well as capabilities, and at what scope?
    - Recommended: yes, a per club `clubs.public_sharing_enabled` boolean the `read_public_share` function checks after resolving the share's club, built in PR 1 (schema) and PR 2 (check), resolved before the first public read ships (section 26). Optionally a separate, explicitly global environment flag for an all clubs emergency stop, kept distinct from the per club switch.
    - Strongest alternative: capabilities only.
    - User value: a switch turns public reads off for a club instantly in an incident; capability revocation alone does not stop already created links from being read.
    - Privacy and security: a switch that fails public reads closed is a strong safety lever; per club scope is correct for a multi tenant future, a global env flag is a blunt all clubs stop.
    - Implementation: a `clubs` boolean and one check in the definer function; flipping it is a single row update, a small audited data change, not "no data change".
    - Evidence that would change it: if capability revocation plus per share revoke is judged sufficient, though neither stops an already issued link, so the switch is recommended.

19. What is the retention period for revoked share metadata and audit events, and when is the snapshot cleared?
    - Recommended: retain share rows and audit events indefinitely at current scale, reviewed annually, matching the audit foundation's stated default, BUT bound the snapshot's life. Revoke clears the `content_shares.snapshot` and the share's `content_share_dependencies` rows immediately in the lifecycle transaction. Expiry is enforced at read time (an expired share serves nothing the instant `expires_at` passes) and the snapshot is physically cleared by a scheduled private cleanup after a short retention window (for example seven days), which also emits `content_share.expired` (section 8.4). The snapshot is the one place a child's name or other private free text that evaded the preview could persist; the lifecycle facts plus the audit event (which records the durable source id and `actor_name`, section 19) answer "who shared what and when" without keeping the free text.
    - Strongest alternative: no scheduler, in which case expiry stays enforced at read time but an expired share keeps its stored snapshot until Revoke or manual cleanup, and the "expiry clears the snapshot" claim is removed and the retained data limitation recorded honestly (section 8.4).
    - User value: retained lifecycle and audit history answers who shared what and when; clearing the snapshot loses only the frozen public projection, which is never served again.
    - Privacy and security: audit rows hold no secret, no snapshot and no viewer identity, so retention is low risk; clearing on revoke immediately and on expiry after a short window bounds retention of any personal free text the preview missed.
    - Implementation: null the `snapshot` and delete dependency rows in the revoke path of the lifecycle RPC (immediate) and in the scheduled cleanup for expired shares past the window; the cleanup has a named owner, a daily cadence, failure monitoring and a test (sections 25, 24).
    - Evidence that would change it: a data minimisation policy that sets an explicit retention window for the whole row, not just the snapshot, or a decision to decline the scheduler (adopting the honest fallback).

20. What is the maximum programme snapshot size and week count?
    - Recommended: 256 KiB snapshot, 64 media assets, 12 weeks, from the hosted content counts and the FA 10 week cap.
    - Strongest alternative: higher caps.
    - User value: higher caps allow larger programmes; the recommended caps cover every realistic plan.
    - Privacy and security: caps bound the public response and the signing work, limiting denial of service.
    - Implementation: the builder and read function enforce the caps and report rather than truncate.
    - Evidence that would change it: a real programme that legitimately exceeds the caps.

## 31. Acceptance criteria for the overall programme

The programme is delivered when:

- A coach can share a saved session, a drill and a programme, as a club link and, where eligible, a public link.
- An external recipient can open a public link with no account and see a mobile friendly, printable, read only page that reveals no operational, identifying or rights restricted data.
- The public snapshot for each kind matches the section 11 allow lists exactly, verified by the allow list scanner and the security suite.
- Board projections carry numbers and positions only, honouring `registered-players-boundary.md:559-564`.
- No Spond, schedule, team, coach, date, venue or attendance field appears in any public snapshot.
- Eligible media is signed briefly and only for referenced paths; raw paths never leave the function.
- England Football derived and unclassified content defaults to internal only and a nested restricted item blocks the public aggregate.
- The token model is a hashed 256 bit fragment secret; no plaintext token is stored or logged.
- Revoke, refresh, rotate and expiry all behave as specified, and invalid, revoked and expired reads are indistinguishable.
- Coaches can create shares for content they own; managers and admins can manage club shares; parents cannot create or manage public shares; RLS and the RPC enforce it and the security suite pins it.
- Direct anonymous and authenticated access to `content_shares` and to the content tables is refused; no anon policy is added anywhere.
- Both Edge Functions exist; their deployed source is verified by byte for byte readback, and their `verify_jwt` settings are verified separately by the positive post deploy check (readback does not cover `verify_jwt`): `read-content-share` is anon reachable and every other function is `verify_jwt = true` and not anonymously reachable.
- Every lifecycle action is audited; public views are not logged.
- The public route mounts none of the authenticated app.
- The phased PRs land in order, none of them auto merged where gated, each with its tests, accessibility and post deploy verification.

## 32. Definition of done for this scoping PR

This scoping PR is complete when the roadmap:

- Proves understanding of the current routes and auth (section 3.1, the exact route table and the single unauthenticated route).
- Identifies PR #103 as a prerequisite only, not implementation (sections 3.5, 7, 22).
- Distinguishes internal sharing, public sharing, export and import (section 4).
- Has exact field allow lists (section 11).
- Addresses board `playerId` (sections 11.4, 23 threat 14, and the binding boundary citation).
- Addresses Spond and schedule fields (sections 11.1, 23 threats 16 and 17).
- Addresses media signing (sections 20, 23 threat 36).
- Addresses England Football rights (section 13).
- Recommends a token and URL design (section 14).
- Defines revocation, refresh, rotation and expiry (section 8.3, 8.4).
- Defines owner and manager authority (section 18).
- Defines direct database access restrictions (section 15).
- Defines transactional authorisation: the private lifecycle RPC is the final authority and re validates actor club, sharing capability, source capability, source ownership and source club inside the transaction through explicit joins on the verified actor id, so a capability revoked between the early check and the RPC fails closed; the Edge Function check is an early refusal, not the sole boundary (sections 16.1, 17, 23 threat 39).
- Defines the reverse dependency model (`content_share_dependencies`) and targeted rights downgrade invalidation, with the public read verifying dependency eligibility, rather than scanning snapshot JSON or invalidating globally (sections 13.3, 15.1, 16.2).
- Resolves the expiry and snapshot retention model into one executable design: revoke clears in transaction, expiry enforces at read time, a scheduled cleanup physically clears after a short window, with the honest fallback if no scheduler is approved (sections 8.4, 15, 19, 26, 30.19).
- Defines a privacy aware, implementable rate limit (platform limiting or a pseudonymous HMAC of IP, never the raw IP, auto expiring, not in audit) and corrects the "personal data free" claim, or marks it a PR 2 design gate with the Detection claims downgraded (sections 16.2, 25).
- Defines both Edge Functions (section 16).
- Defines audit events (section 19).
- Defines tests and threats (sections 23, 24).
- Defines phased PRs (section 27).
- Avoids migration number conflicts (sections 27, 28: reserves nothing in 0031 to 0037, provisional 0038+, confirm at apply time).
- Places the feature in the wider roadmap (section 28).
- Clearly records the unresolved owner decisions (section 30).
- Contains no executable change (this branch is docs only).

And when the review loop (section below) has run and every material weakness found has been fixed.

### Review cycles completed

This roadmap was reviewed against twelve perspectives and revised before it was opened for owner review: a grassroots coach on a phone, an OTJ manager, an external recipient with no account, a product owner, a privacy and safeguarding reviewer, a third party content rights reviewer, a Supabase security engineer, an Edge Function engineer, a database and migration engineer, an accessibility reviewer, an operational support reviewer, and a future multi club architect. Fifty eight findings were raised and the material ones folded into the sections above. The corrections worth naming, because several were factual errors an unreviewed draft would have shipped:

- A signed Supabase media URL embeds the object path (`club_id` and object uuid) in cleartext, so the earlier "the client never receives the path or the club id" claim was false; sections 20, 21.2 and 23 now record the correlation residual honestly and name the copy or content address fix.
- FA video exists not only as Vimeo embeds but as downloaded MP4 bytes in the private bucket (`faAttach.ts`); sections 3.4, 13 and 20 now account for stored FA video.
- `has_perm` is `auth.uid()` bound, so it cannot run inside a service role RPC; sections 16.1, 17 and 19 now put the capability check in the function under the caller JWT and pass a verified actor id to a service role gated RPC and audit writer, matching the `invite-user` pattern.
- `read-content-share` must hold the service role to read `content_shares` and sign private media, making the first anonymous function an elevated credential surface; section 16.2 confines its DB access to a narrow `read_public_share` SECURITY DEFINER function and threat 11 now covers this.
- Section 11's "eligible referenced media" read as silent drop while section 13 said block; section 11 now states the v1 fail closed block covers drills, sessions and programmes alike.
- The `content_shares` person FKs need `on delete set null` or member removal breaks; the one active share invariant needs three partial unique indexes; an `idempotency_key` column was missing; the kill switch was named as the disable lever but built by no PR. All corrected (sections 15, 17, 26, 27).
- Only three of the four core audit actions are pre reserved; `content_share.rotated` is new (sections 3.6, 19, 28).

Coach, manager, accessibility and ops findings folded in too: plain language lifecycle labels, the free text preview that marks the risky fields, the rights block that offers the club link, the coverage consequence of the FA safe default, the manager redacted review and the departed coach handling, the transient error state and the neutral unavailable copy, dialog semantics and the one time link reveal, and the committed detection baseline.

A third round then corrected four load bearing architecture inconsistencies raised in owner review:

- Transactional authorisation: the private lifecycle RPC is now the final authority, re validating actor club membership, sharing capability, source capability, source ownership and source club inside the transaction through explicit joins on the verified actor id (auth.uid() is null under the service role), with `actor_name` derived only after validation and a capability revoked between the early check and the RPC failing closed. The Edge Function check is an early refusal, not the sole boundary (sections 16.1, 17, 23 threat 39, 24).
- Share dependencies: a private `content_share_dependencies` reverse index (section 15.1) replaces snapshot JSON scanning and global invalidation, written transactionally with Create and Refresh, verified on every public read, and used to invalidate exactly the dependent shares on a rights downgrade (sections 13.3, 16.2, 20).
- Expiry and retention: one executable model, read time enforcement plus a scheduled cleanup with an owner, cadence, monitoring and test, and an honest fallback if no scheduler is approved (sections 8.4, 15, 19, 26, 30.19).
- Rate limit privacy: the baseline is privacy minimised, not personal data free; the limiter uses platform limiting or a pseudonymous HMAC of the IP with a rotating secret, never the raw IP, auto expiring and never in audit, with defined behaviour for a missing IP header, or is marked a PR 2 design gate with the Detection claims downgraded (sections 16.2, 25, 24).

Smaller accuracy corrections in the same round: the service role key's broad blast radius is stated even with a narrow RPC path; the token comparison is a fixed length constant time compare in the function rather than a claim that SQL digest equality is constant time; and the messaging preview bot wording now reflects that fragment secrets are not sent to bots and most bots see only the generic shell.

## 33. Appendix: proposed snapshot examples (synthetic content only)

These examples are illustrative and use invented content only. They contain no real session names, player names, club member names, private links, live tokens or production row contents. They show the shape a snapshot builder would produce, not real data.

### 33.1 Public drill snapshot (synthetic)

```json
{
  "snapshotVersion": 1,
  "kind": "drill",
  "title": "Rondo under pressure",
  "summary": "A possession square that rewards quick, calm passing when pressed.",
  "classification": { "type": "corner", "value": "technical" },
  "skill": "Passing under pressure",
  "ages": ["U9", "U10"],
  "level": "Developing",
  "duration": 15,
  "playerGuidance": "6 to 8 players",
  "area": "12 by 12 metres",
  "equipment": ["cones", "one ball", "bibs in two colours"],
  "setupNotes": "Four players on the square, two defenders inside. Rotate a defender out on each interception.",
  "coachingPoints": [
    "Open the body before receiving.",
    "First touch out of pressure, not into it.",
    "Support at an angle, not flat."
  ],
  "easier": ["Add a third defender out.", "Enlarge the square to 15 by 15."],
  "harder": ["Two touch maximum.", "Shrink the square to 10 by 10."],
  "theme": "Playing out under pressure",
  "format": "Small sided",
  "sourceAttribution": null,
  "media": [
    { "ref": "m1", "type": "image", "caption": "Square setup", "url": "<short-lived-signed-url>" }
  ],
  "snapshotAt": "synthetic-timestamp"
}
```

Note: `sourceAttribution` is null here because the synthetic drill is club original (`public_full`). An FA derived drill would be blocked from public sharing while its FA media is `internal_only` (section 13), so it would not appear on a public link at all in v1 unless the owner records an FA decision and the media is eligible. No `club_id`, `created_by`, `media_id`, `source_key`, storage path or database id appears. The media `caption` (from `media.name`) is free text and is one of the fields the section 12 preview flags for a name check; the `url` is a short lived signed URL whose string necessarily embeds the object path (section 20).

### 33.2 Public session snapshot (synthetic)

```json
{
  "snapshotVersion": 1,
  "kind": "session",
  "displayTitle": "Midweek technical session",
  "focus": "Playing out from the back",
  "ageGroup": "U10s",
  "totalDuration": 60,
  "intentions": ["Calm first phase", "Support angles", "Decisions under light pressure"],
  "space": "Half pitch, two 12 by 12 grids",
  "activities": [
    { "order": 1, "phase": "Warm-Up", "duration": 10, "customTitle": "Passing gates" },
    { "order": 2, "phase": "Skill", "duration": 20, "drillRef": "d1" },
    { "order": 3, "phase": "Game", "duration": 25, "drillRef": "d2" },
    { "order": 4, "phase": "Cool-Down", "duration": 5, "customTitle": "Stretch and review" }
  ],
  "referencedDrills": {
    "d1": { "title": "Rondo under pressure", "summary": "...", "coachingPoints": ["..."], "media": [] },
    "d2": { "title": "4 v 4 to target goals", "summary": "...", "coachingPoints": ["..."], "media": [] }
  },
  "board": {
    "formation": "2-3-1",
    "tokens": [
      { "number": 1, "side": "home", "x": 0.5, "y": 0.08 },
      { "number": 4, "side": "home", "x": 0.3, "y": 0.28 },
      { "number": 5, "side": "home", "x": 0.7, "y": 0.28 }
    ]
  },
  "sourceAttribution": null,
  "snapshotAt": "synthetic-timestamp"
}
```

Note: no `date`, `start_time`, `venue`, `team_id`, team name, `coach_id`, coach name, `spond_event_id`, attendance count, live state, `programme_id`, real `board_id`, real drill id or storage path appears. Board tokens carry `number`, `side`, `x`, `y` only; there is no `playerId` and no `id`. The `referencedDrills` entries are abbreviated here for space; in the real snapshot each carries the complete section 11.2 drill field set (setup, area, equipment, level, ages, easier, harder and all), so an external coach gets full run ready detail for every embedded drill. Custom activities (the warm up and cool down here) carry only a title and a duration, so they render as headings with no instructions, the content sufficiency limit noted in section 11.1.

### 33.3 Public programme snapshot (synthetic)

```json
{
  "snapshotVersion": 1,
  "kind": "programme",
  "name": "Six week playing out block",
  "focus": "Building from the back",
  "summary": "A six week block that layers a calm first phase into small sided games.",
  "intentions": ["Progress from unopposed to opposed", "Consistent support angles"],
  "weeks": 6,
  "orderedWeekNumbers": [1, 2, 3, 4, 5, 6],
  "weekTemplates": [
    { "week": 1, "name": "Week 1: shape and first touch", "focus": "Receiving", "orderedActivities": [ { "phase": "Skill", "drillRef": "d1" } ] },
    { "week": 2, "name": "Week 2: support angles", "focus": "Support", "orderedActivities": [ { "phase": "Game", "drillRef": "d2" } ] }
  ],
  "referencedDrills": {
    "d1": { "title": "Rondo under pressure", "summary": "...", "media": [] },
    "d2": { "title": "4 v 4 to target goals", "summary": "...", "media": [] }
  },
  "media": [],
  "sourceAttribution": null,
  "snapshotAt": "synthetic-timestamp"
}
```

Note: no template `author`, no `created_by` or owner, no linked club sessions or completion state, no dates, no venues, no internal ids. Referenced drills use snapshot local ids (`d1`, `d2`), never database uuids, and are abbreviated here but carry the full section 11.2 field set in the real snapshot. The attached programme PDF is media: it is present only if its rights class is `public_full`, and an `internal_only` FA PDF does not appear silently; it blocks the whole programme share (section 11.3, 13), which is why this synthetic example has `"media": []`.

### 33.4 Generic unavailable response (synthetic)

```json
{ "status": "unavailable" }
```

The same response is returned for an invalid `shareId`, a wrong secret, a revoked share and an expired share, so a reader cannot tell which, and cannot tell whether a link ever existed.



