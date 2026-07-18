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

- All content is club wide readable by any authenticated club member. `sessions` select became club wide in `0002_teams_roles.sql` (`sessions_select_club`, replacing the original own or admin rule). `drills`, `media`, `templates`, `programmes`, `boards` all select on `club_id = my_club()`. There is no anonymous or public select policy on any table; the live hosted `list_tables` read confirms RLS is enabled on all 20 tables.
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
- YouTube media store `yt_url` only; the public thumbnail (`img.youtube.com`) and the `youtube-nocookie.com` embed need no signing. Embedded video players are host allowlisted to `player.vimeo.com` only (`embedSrc`, `src/lib/data.ts`); this is the FA video path.
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
- The audit boundary document already reserves future actions `content_share.created`, `content_share.refreshed`, `content_share.revoked` (`docs/security/app-audit-boundary.md:197`). The sharing audit actions are pre anticipated there.
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

- The security suite lives in `tests/security/`, runs local only (`assertLocal` refuses any non local URL), mints real JWTs for six synthetic fixture users (admin, manager, two coaches and a parent in one club, an outsider coach in a second club) through the auth admin API and `signInWithPassword`, and exercises PostgREST and Storage exactly as a production client does. A new table is tested with a read matrix, a write matrix asserting `42501` on direct writes, a writer or RPC boundary section, and rollback proven via `docker exec ... psql`. `capabilities.test.ts` pins `EXPECTED_CATALOGUE` at exactly 20 keys and cross checks a static `src` regex, so adding a capability requires updating both or the tripwire fails.
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
- A dirty saved session must save successfully before its refreshed saved content is shared. A "Save and share" action is appropriate.
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

### 8.2 Honest limitation on immutability

The roadmap must not claim stronger immutability than the system enforces.

- CONFIRMED CURRENT STATE: the `media` bucket has no UPDATE policy, so in place replacement of an object is refused for every client, and app uploads always mint a fresh random path. Under normal app operation the bytes at a given path do not change.
- Residual: a text snapshot is fixed once stored, but a private Storage object at a path the snapshot references could be deleted and a different object placed by an authorised client (delete then insert) or by a service role operator, and a deleted object simply becomes unavailable. So the underlying media bytes are not perfectly immutable unless assets are copied into the snapshot or content addressed. This roadmap does not copy media bytes in v1; it references paths and signs them briefly, and it states this residual plainly. Section 20 covers the media handling; section 23 lists the delete then recreate threat.

### 8.3 Owner experience (one shared Share surface)

RECOMMENDED DEFAULT: one Share modal (built on the existing `Modal` primitive, `dismissible={!writing}`) that supports, according to eligibility and role:

- Copy club link.
- Preview public version (the exact snapshot, with any blocked content listed).
- Create public link.
- Native Share and Copy public link (shown only immediately after Create or Rotate, when the raw secret is available; see section 14).
- Current status, created time, refreshed time, expiry.
- Refresh snapshot.
- Rotate link.
- Revoke.
- A calm unavailable or rights blocked explanation when public sharing is not possible.

Lifecycle semantics:

- REFRESH keeps the same link, rebuilds the snapshot from the current saved content, rechecks permissions and rights, and updates `refreshed_at`. It does not publish unsaved Planner state; it reads the saved row.
- ROTATE invalidates the previous secret immediately and produces a new complete link. The snapshot is retained or rebuilt per the approved design (recommended: retained, since rotation is about the secret, not the content).
- REVOKE immediately makes the public read return the generic unavailable response, does not delete the underlying drill, session or programme, and records an audit event.
- EXPIRY returns the same response as invalid and revoked once passed.

### 8.4 Expiry policy

Comparison: no expiry; a fixed default; optional expiry; different defaults per content kind.

RECOMMENDED DEFAULT to evaluate (UNRESOLVED DECISION, section 30):

- Default 90 days.
- The owner may shorten it.
- A manager (`shares.manage`) may allow no expiry.
- Expiry can be extended through Refresh (Refresh recomputes `expires_at`).
- Expired links return the same response as invalid and revoked.

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
- `activities`, ordered, each carrying: `phase`, `duration`, and either a `customTitle` (for a custom activity, free text) or a snapshot local reference to a safe drill snapshot.
- `referencedDrills`: safe drill snapshots (section 11.2), keyed by snapshot local id.
- `media`: eligible referenced media (section 20), by snapshot local id.
- `board`: safe board presentation (section 11.4) where one is attached.
- `sourceAttribution` (`source_url`, `source_label`) where present and rights eligible.
- `snapshotAt` (created or refreshed time).

Exclude (each maps to a real column that must never enter the snapshot): `club_id`; `coach_id`; coach name; `created_by` (sessions have none, but the principle stands for the referenced entities); `team_id`; team name; `date`; `start_time`; `venue`; `spond_event_id` (and therefore all attendance counts and event facts one join away); attendance counts; `live_activity_index` and `live_activity_started_at`; `status`; `programme_id` and `programme_week` (internal linkage); the real `board_id`, `media_id` and any database uuid; player names; player ids; member ids; raw media storage paths; signed URLs stored in the snapshot; audit data; internal ownership information.

Rationale for the operational exclusions (grounded in the section 3.3 leak inventory): `date`, `start_time`, `venue`, `team_id` and `age_group` together describe when and where a specific youth team trains, which is safeguarding sensitive if made public; `spond_event_id` is one join from attendance counts, the very boundary the counts only Spond policy protects; the live state fields reveal a session is being run right now.

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

Exclude: template `author` (a member full name in plain text, a hard exclusion); `created_by` and any creator or owner; linked club sessions and their completion state; team progress; dates and venues; internal ids; ownership; the private programme PDF unless its sharing rights are explicitly eligible (section 20).

Nested drill representation. UNRESOLVED sub decision: repeat full drill snapshots inside a programme, or reference snapshot local ids. RECOMMENDED DEFAULT: reference by snapshot local id, with a single `referencedDrills` map, so a drill used in several weeks is stored once and the snapshot stays small. If references are used they must be snapshot local identifiers minted in the snapshot, never database uuids, so the public payload never carries a real drill id.

### 11.4 Public board snapshot

RECOMMENDED DEFAULT, and a binding constraint, not a preference. `docs/security/registered-players-boundary.md:559-564` fixes the baseline: "a shared or public board representation must strip playerId values entirely and must never resolve names. Shape and numbers only." Honour it.

For each token retain only: `number`, `side`, `x`, `y`.

Remove: `playerId` (a stable child id, even though it carries no name and resolves to nothing without the `players` select); `id` (the token id); labels; names; roster references; board ownership (`created_by`); team identity (`team_id`).

Formation name: `formation` is a standard label such as "4-4-2" and carries no personal data. RECOMMENDED DEFAULT: include `formation` as harmless and useful context. Treat the board `name` as free text (section 12), not as `formation`.

## 12. Free text risk

Known structured fields can be removed by the allow list, but several included fields are free text and could contain a name or private information: `displayTitle` (session name), custom activity titles, `intentions`, `setupNotes`, `coachingPoints`, drill `summary`, and the board `name`.

The design must include:

- An exact pre publish preview. The owner sees precisely what will be public, rendered from the built snapshot, before the link is created. This is the primary control.
- A calm warning next to the preview: "Check that no player names or private information appear in titles or notes before you share this." No alarm, no blocking on a heuristic.
- No claim that automated filtering guarantees privacy. It cannot.
- A requirement that the server still enforces every structured exclusion regardless of preview. The preview is a human check on free text; the allow list is the machine guarantee on structured fields.

Lightweight warning scan. UNRESOLVED sub decision (section 30): whether a lightweight client side scan that flags text looking like a full name (two capitalised words) is worth adding. Assessment: false positives are common in coaching text ("Small Sided", "Third Man", place names), and false negatives are guaranteed (single names, nicknames), so a scan risks giving false confidence. If added it is a soft, dismissible hint on the preview, never a gate and never a claim of safety.

RECOMMENDED DEFAULT: do not introduce automated AI redaction in v1. The preview plus the calm warning plus the machine enforced structured allow list is the v1 control. AI redaction would add a dependency, a cost and a false sense of guarantee for no proven gain at a single club's scale.

## 13. Content rights boundary

This is a hard design gate. The current product permits England Football content inside an invite only, non commercial club application, and CLAUDE.md states it is not made public. Public sharing is the first intentional breach of that boundary.

CONFIRMED CURRENT STATE:
- CLAUDE.md, Third party content: FA content is used on the terms that images are unmodified, never recreated, the use is not for profit, and "Nothing is sold or made public. The app is invite-only club membership." FA videos "must never be sold or placed behind any paid or subscription access." For non FA third party content "the default remains link and attribute, do not copy."
- Nothing in code enforces "not made public"; it is enforced only by the whole app being behind login and the media bucket being private. The one place the app deliberately makes text world readable is the feedback to GitHub promotion, which is hand scrubbed of identifying data and never carries FA media (`Feedback.tsx`, `queries.ts`). The codebase currently equates "public" with "a GitHub issue," nothing else.
- There is no rights or eligibility classification field on any content or media row. FA versus club original versus non FA third party is inferable only at runtime from `source_url` and `source_label` via `isFaUrl` and `sourceLabelForUrl` (`src/lib/fa.ts`). Club original is signalled only by an absent `source_url`. FA images and PDFs are stored in the private bucket; FA videos are `player.vimeo.com` embeds, not downloaded files.

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
- A session or programme containing any internal only nested item is blocked from public sharing in v1 (option 5), rather than silently producing an incomplete plan. The preview names what blocked it.

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

RECOMMENDED DEFAULT: a downgrade to `internal_only` immediately revokes or disables active public shares that depend on that item. Refresh rechecks rights, so any refresh after a downgrade also fails closed, but the downgrade itself does not wait for a refresh; it invalidates dependent shares at downgrade time. Section 15 and section 17 place this in the data model and transaction design.

### 13.4 Human confirmation required before public FA sharing

Before any public external sharing of England Football derived content is implemented, the roadmap requires a human and content owner decision, recorded by the owner:

- May any England Football text be included on a public link, or must all FA derived content remain internal only? This is UNRESOLVED DECISION 1 in section 30.
- The default this roadmap builds to is the safe one: FA derived content is `internal_only` and never public until the owner records a decision otherwise, informed by the FA's stated terms and any confirmation the club seeks from the FA.

A warning is not a substitute for rights enforcement. The rights class is enforced server side in the snapshot builder and the read function; the preview warning is an additional human check, not the control.

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
- SHA-256 of the raw secret is the stored lookup hash. A single SHA-256 is appropriate here because the secret is high entropy (256 bits), so a slow password hash buys nothing; the lookup is by `shareId` then a constant time compare of the SHA-256 digest.
- No plaintext token column.
- No token in any log, analytics or exception message.
- A generic invalid response for any bad, missing, revoked or expired secret.
- The comparison is a constant time digest comparison, or equivalently a database lookup keyed on `shareId` that fetches the stored hash and compares digests server side.

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
- `snapshot_version` integer.
- `snapshot` jsonb, the stored safe public projection.
- `rights_version` or an eligibility result recorded at build time (which rights inputs were evaluated), so a later rights change can be compared against what the snapshot assumed.
- `created_by` uuid, references `profiles(id)`, the creating member.
- `updated_by` uuid, references `profiles(id)`.
- `created_at`, `refreshed_at`, `expires_at`, `revoked_at`, `revoked_by`, `rotated_at` timestamps.

Source entity integrity. RECOMMENDED DEFAULT: three nullable foreign keys plus the exactly one check, over a generic `entity_type`/`entity_id` pair. Real foreign keys mean source deletion invalidates the share automatically through `on delete cascade` (the share row is removed, so the public read finds nothing and returns the neutral unavailable response). A generic pair would need a trigger to emulate that and could dangle. REJECTED ALTERNATIVE: generic `entity_type`/`entity_id`, because it loses referential integrity for the one property (source deletion invalidates the share) that most cheaply satisfies a threat.

How many active links per source. Options: one active public link per source entity; multiple independent links per source; one per creator.

RECOMMENDED DEFAULT for v1: one active public link per source entity per club, enforced by a partial unique index on the source foreign key where `revoked_at is null`. Rationale:

- Simpler owner UI: one status, one link, one set of controls.
- No forgotten duplicate links to track or leak.
- Refresh covers content updates, Rotate covers a compromised secret, Revoke covers removal, so the three lifecycle actions cover the real needs without multiple links.

FUTURE OPTION: multiple links and audience specific links (a link per recipient, a link with a different expiry), deferred to section 29.

Snapshot assets. UNRESOLVED sub decision: whether a structured `content_share_assets` table is needed, or media references may live inside the private snapshot jsonb. RECOMMENDED DEFAULT: keep media references inside the private snapshot jsonb (the snapshot names snapshot local media ids and their storage paths), because the snapshot is never exposed raw to any client and the public function signs only the referenced paths. A separate assets table adds joins for no boundary gain in v1. Revisit if media needs its own lifecycle independent of the share.

Direct database access. RECOMMENDED DEFAULT:

- anon has no direct table access to `content_shares` (no anon policy, matching every other table).
- Authenticated browser clients have no direct `content_shares` read or write. Owner management goes through the authenticated management function; public reads go through the public read function.
- No anonymous SELECT policy is added to `sessions`, `drills`, `programmes`, `templates`, `boards`, `media`, `profiles`, `teams` or `players`. This is the single most important invariant in the design.
- The raw `snapshot` rows are never exposed directly to authenticated or anonymous clients. Owners receive lifecycle status from the management function, not a select on the table.

If a restricted metadata view for owners is later proposed (status, times, expiry without the snapshot or token), it must justify why it is safer or simpler than returning status from the management function. RECOMMENDED DEFAULT: return status from the management function, so there is exactly one authenticated read path and no direct client select on `content_shares` to reason about.

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
- Uses the service role only after authenticating and authorising the caller, and only to call the private transactional RPC (section 17). The authorisation decision is made under the caller's identity via `has_perm`, exactly as the write policy will, so the early check and the RLS or RPC enforcement cannot drift.
- Returns no secret except on Create or Rotate.

### 16.2 read-content-share (verify_jwt OFF)

CONFIRMED CURRENT STATE: this would be the first public Edge Function in the project; every current function authenticates and 401s without a JWT. There is no existing auth model to copy, so the departures are called out.

- `verify_jwt` off. Public. This must be pinned at deploy (config has no `[functions.*]` blocks today) and stated explicitly in the deploy procedure, because the platform default is on.
- Accepts only `shareId` and `secret` in a POST body.
- Looks up the share by `shareId`, verifies the SHA-256 of `secret` against the stored `token_hash` with a constant time comparison.
- Checks `revoked_at` and `expires_at`.
- Returns only the versioned safe public `snapshot`.
- Signs only the private media storage paths explicitly referenced by that eligible snapshot, with a short lifetime (section 20), and removes all raw storage paths before responding.
- Sets `Cache-Control: no-store`.
- Uses generic unavailable responses for invalid, revoked and expired, indistinguishable from each other.
- Does not log the secret or the snapshot.
- Applies defensible request size and response size limits.
- CORS: the public read is called from the public share page, which is served from the same Vercel origin as the app, so the existing `APP_ORIGIN` CORS lock still applies and needs no relaxation. This is a reason to serve the public page from the app origin rather than a separate host. If a genuinely cross origin consumer is ever needed, relaxing CORS is a deliberate, review gated change, not a copy of the existing header.

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

RECOMMENDED DEFAULT: a private transactional RPC for lifecycle writes, `EXECUTE` restricted to `service_role`, called by `manage-content-share` after it authenticates and authorises the caller. This mirrors the CONFIRMED `log_audit_event` and `grant_club_membership` pattern: a SECURITY DEFINER function, `set search_path = ''`, service role only, that does the mutation and the audit write in one transaction.

- The RPC revalidates the actor and the source authority rather than trusting actor ids from the function layer. It reads the actor from the JWT propagated context or is passed a verified actor id and re checks `has_perm` and ownership inside the transaction. It does not blindly trust an actor id supplied by the function.
- Create and the audit insert happen in one statement path, so there is no share without its audit event (Create) and no audit without its mutation (Revoke).
- The one active share invariant is enforced by a partial unique index on the source foreign key where `revoked_at is null`, so a concurrent second Create fails the unique constraint rather than creating a duplicate; the function maps that to "the existing active share" using the idempotency key.
- An idempotency key on create, refresh and rotate makes a lost response retry resolve to the same row: the RPC upserts on `(source, idempotency_key)` so a repeat with the same key returns the existing result rather than acting again.
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

How they are written. CONFIRMED CURRENT STATE: `audit_events.action` and `entity_type` have no check constraint, so these actions and an `entity_type` of `content_share` need no change to the table; `source` already allows `edge_function`. The writer's allow list is player and export specific today, and its metadata allow list is bounded to player and export keys. So the sharing lifecycle RPC needs its own writer path: either extend `log_audit_event` with a sharing action, entity type and metadata allow list, or add a sibling private writer for sharing events. RECOMMENDED DEFAULT: a sibling private writer (or an extended `log_audit_event`) with a sharing specific metadata allow list, service role only, called inside the lifecycle RPC so the audit commits with the mutation.

Do not log every public view in v1. RECOMMENDED DEFAULT: no per view logging. Rationale:

- Per view logging introduces personal data and IP considerations for anonymous viewers.
- It is noisy: messaging clients and link preview bots open links, so counts would be misleading.
- It is not required to fulfil Phil's request.

Audit metadata may include safe facts only: content `kind`, an expiry class (for example `default`, `short`, `none`), the lifecycle `action`, and a count of blocked rights categories at creation. It must never store the raw link, the secret, the `token_hash`, the public snapshot, the content title, any free text, a recipient identity, an IP address, a user agent, or the public response payload. The metadata allow list is enforced server side exactly like `audit_metadata_ok`.

`content_share.expired` only exists if a scheduled job flips `revoked_at` style state at expiry. RECOMMENDED DEFAULT for v1: expiry is evaluated at read time (the read function compares `expires_at` to now), so no background process and no `expired` event is needed. If a sweeper is later added for tidiness, it emits `content_share.expired`.

## 20. Media and Storage

CONFIRMED CURRENT STATE: the `media` bucket is private, `to authenticated` only, no anon read, no UPDATE policy, paths `{club_id}/{uuid}-file` and avatars at `avatars/{user_id}/`. Client signing is a one hour URL.

RECOMMENDED DEFAULT: do not create a public bucket for this feature. The private bucket plus short lived server signed URLs is sufficient and keeps the boundary intact. Creating a public bucket would be a new, standing anonymous read surface for exactly the class of asset (FA images) that must not be public.

For eligible stored media (an image or PDF whose rights class is `public_full` and whose path is referenced by the validated snapshot):

- The public `read-content-share` function generates a short lived signed URL, shorter than the client's one hour default (for example five to fifteen minutes), long enough to load the page, short enough to limit a leaked URL.
- The signed URL is returned only for a path explicitly present in the validated snapshot. The function never signs an arbitrary caller supplied path. This closes the "sign any path could reach avatars or another club's object" threat, because the only inputs are `shareId` and `secret`, and the only paths signed are those the snapshot named.
- Raw storage paths are removed from the response; the client receives a signed URL and never the path.
- A page reload requests a fresh URL (the snapshot references the path; the function re signs on each read).
- An expired media URL has a recoverable Reload action on the public page (section 21).
- Deleting or reclassifying media degrades the share safely: a deleted object yields a failed sign, which the page shows as unavailable media rather than an error; a reclassification to `internal_only` makes the next Refresh drop the media, and a rights downgrade invalidates the share per section 13.3.

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
- Rendering states: loading; generic unavailable; available snapshot; expired media reload; a print layout; a mobile layout.
- Club branding limited to approved public brand fields (section 21.2).
- No internal navigation and no management links, unless the viewer separately signs in.

Because the whole app is one Vite bundle behind the SPA rewrite, the public route still loads the same JavaScript. The safety property is not a separate bundle; it is that the `PublicShare` component tree imports and mounts none of the authenticated providers or hooks, initialises no Supabase authenticated query, and reaches Supabase only through the public function. A component test asserts the public route mounts no `SessionsProvider` and fires no protected query (section 24).

### 21.1 Response headers and page hardening

- Document title set to a neutral, content free value on the public page (for example "Shared session, Ossett Town Juniors"), avoiding leaking the free text title into the tab or link preview beyond what the snapshot already shows.
- `robots` noindex and nofollow. UNRESOLVED sub decision: client side meta injection alone is weak because not every crawler runs JavaScript. RECOMMENDED DEFAULT: set `X-Robots-Tag: noindex, nofollow` at the edge for `/share/*` via a Vercel `headers` rule in `vercel.json` (a server level guarantee), in addition to a client side `<meta name="robots">`. This is the assessment the task asks for: client side meta is not sufficient on a Vite SPA for robots control; a Vercel header is needed.
- `Referrer-Policy: no-referrer` on the public page, so a click out to an attributed source URL sends no referrer carrying the share.
- `Cache-Control: no-store` at the read API (section 16.2), so intermediaries do not cache the snapshot.
- A Content Security Policy suitable for the public page: self plus the Supabase project origin for the function call and signed media, `img.youtube.com` for thumbnails, framing limited to sandboxed `youtube-nocookie.com` and `player.vimeo.com` only where rights allow, and no third party script origins.
- Safe external link `rel` attributes (`rel="noopener noreferrer nofollow"`) on any attribution link.
- Sandboxed embeds (`sandbox` on any iframe, and referrer stripping) so an embed cannot reach back into the page or receive the fragment.
- No third party analytics by default (section 25).

Assessment requested by the task: on the Vite SPA, client side meta changes are sufficient for the document title and a client `<meta robots>`, but they are not sufficient for a robust noindex or for security headers, because they run only after the bundle loads and not every consumer runs the bundle. Vercel `headers` config is therefore needed for `X-Robots-Tag`, `Referrer-Policy`, and the CSP on `/share/*`. This is a `vercel.json` change in the implementation PR, not now.

### 21.2 Public page branding

CONFIRMED CURRENT STATE: the per club crest is either a private Storage path under `{club_id}/crest/` or a URL, and a bundled public static asset `public/crest.png` exists. The club name and motto live on the `clubs` row (`name`, `motto`).

RECOMMENDED DEFAULT for safe public branding: the club name, the motto, and the bundled public static `/crest.png`. Do not sign or return the private Storage crest for the public page, and do not return the club database id. Rationale: the bundled crest is already a public static asset (favicon and fallback), so it is safe and needs no signing; the club name and motto are public facts the club publishes itself. Options considered: bundle a public branding asset (chosen, it already exists); sign the private crest through the public function (rejected, it puts a private object on a public page for no gain); omit branding (rejected, some club identity helps the recipient trust the link). The club database id is never returned.

## 22. Accessibility and mobile

CONFIRMED CURRENT STATE: there is no `Button` React primitive; buttons are raw `<button className="btn">` with a base height of 42px, `btn-sm` 36px, `icon-btn` 38px, and 44px is applied ad hoc per component via inline `style`, not enforced by CSS. The `Modal` primitive has the `dismissible` contract but no built in focus trap (an open accessibility item in the Product Excellence roadmap, initiative 10). The bottom nav breakpoint is 900px.

Specify for the Share controls and the public page:

- Share buttons with clear accessible labels ("Share this session", "Copy link", "Create public link"), not icon only without a label.
- 44px minimum touch targets on every new share control, set explicitly since the base classes are 42px and smaller and there is no enforced minimum.
- Native share and clipboard feedback announced to screen readers: a `role="status"` live region announcing "Link copied" or "Sharing" so the outcome is not visual only.
- Full keyboard operation of the Share modal and every control.
- Focus placement into the Share modal on open and restoration to the trigger on close. This should reuse the focus trap work that Product Excellence initiative 10 adds to the shared `Modal`, or add it as part of the sharing work if that lands first; the two should not build two focus traps.
- A non dismissible modal while lifecycle writes are pending, reusing the existing `dismissible={false}` contract from PR #103, not a new mechanism.
- `role="alert"` on failures (the existing `ActionError` pattern).
- Link status expressed as text, not colour only ("Active, expires in 89 days", "Revoked"), so status is available without colour perception.
- The public page usable from 320px to desktop, following the existing 900px and 1080px and 520px breakpoints.
- Accessible activity order: the ordered activities render as an ordered list with real order semantics, not colour coded stripes alone (the Product Excellence roadmap already flags colour only timelines as an accessibility gap).
- A board diagram accessible summary: an alternative text description of the shape (for example "4-4-2 formation, eleven home tokens") because the board is otherwise a visual only artefact, and the public board carries numbers and positions only.
- A print style for the public page (shared with the export work, section 9).
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
11. Service role misuse. Likelihood low, impact high. Prevention: the service role is used only after the function authenticates and authorises the caller, and only to call the lifecycle RPC, which itself revalidates authority. Test: the RPC refuses when the revalidated actor lacks authority even if called with a mismatched actor id.
12. Client built snapshot injection. Likelihood medium, impact high. Prevention: the function never accepts a snapshot from the browser; it always builds server side. Test: a request carrying a `snapshot` field is ignored or rejected; the stored snapshot matches the server build.
13. Nested content overlooked by redaction. Likelihood medium, impact high. Prevention: the recursive allow list scanner asserts no key outside the allow list reaches the payload, at every nesting level (session to activity to drill to media to board). Test: a unit test feeds a snapshot with an injected forbidden key at each level and asserts the scanner rejects it.
14. playerId leaked through board tokens. Likelihood medium, impact high (child data boundary). Prevention: the board projection keeps only `number, side, x, y`; `playerId` and `id` are dropped; this honours `registered-players-boundary.md:559-564`. Test: board projection test asserts `playerId` is absent from the public snapshot.
15. Names in free text. Likelihood medium, impact high. Prevention: the exact pre publish preview plus the calm warning (section 12); structured name fields (`author`, coach name, player name) are excluded by the allow list. Residual: a coach could type a child's name into a note; the preview is the human control and the design claims no automated guarantee. Test: allow list excludes `author` and all name columns; preview renders the exact free text.
16. Spond fields included by mistake. Likelihood low, impact high. Prevention: `spond_event_id` is excluded and the builder never joins `spond_events`; attendance counts are never in a session snapshot. Test: session snapshot test asserts no Spond field and no attendance count appears.
17. Date, venue or team leaked from a session. Likelihood medium, impact high (safeguarding). Prevention: `date`, `start_time`, `venue`, `team_id`, team name excluded by the allow list. Test: session snapshot test asserts these are absent.
18. FA content made public. Likelihood medium, impact high (rights). Prevention: FA derived content defaults to `internal_only`; a nested internal only item blocks the public aggregate; the read function signs only `public_full` media. Test: a session or drill referencing FA media fails closed (cannot be publicly shared) until the owner records a rights decision.
19. Unclassified media made public. Likelihood medium, impact high. Prevention: unknown or unclassified media defaults to `internal_only`. Test: a media row with no rights class is treated as internal only.
20. Rights change after share creation. Likelihood low, impact high. Prevention: a downgrade to `internal_only` invalidates dependent active shares immediately (section 13.3); Refresh rechecks rights. Test: downgrading a nested item's rights disables the dependent share.
21. Delete and recreate of a Storage path. Likelihood low, impact medium. Prevention: the app never reuses a path (fresh random path per upload) and has no UPDATE policy; the snapshot references a path and signs it briefly. Residual: an authorised client (delete then insert) or a service role operator could place different bytes at a path a snapshot references; the roadmap states this plainly and does not claim byte immutability without content addressing. Detection: none. Test: documented as an accepted limitation, matching the existing foundation retrospective accepted risk.
22. Stale snapshot. Likelihood expected, impact low. Prevention: by design a snapshot does not auto update; Refresh is explicit and rechecks rights and permissions. Residual: a public link may show older content than the private row until refreshed, which is the intended behaviour. Test: an edit to the source does not change the public snapshot until Refresh.
23. Oversized programme snapshot. Likelihood low, impact medium (denial of service, cost). Prevention: snapshot size cap 256 KiB, media asset cap 64, week cap 12 (section 20); the builder reports rather than truncates. Test: a programme exceeding the caps is refused with a clear message.
24. Denial of service against the public read function. Likelihood medium, impact medium. Prevention: request and response size limits; `Cache-Control: no-store` but a cheap lookup keyed on `shareId`; consider a rate limit per id or per IP. Detection: function success and failure counts (section 25). Residual: a determined attacker can still call the function; the work per call is bounded and reads a single indexed row. Test: the function enforces the size caps and returns quickly for an invalid id.
25. Brute force attempts against the secret. Likelihood low, impact low. Prevention: 256 bit secret makes brute force infeasible; a generic response gives no oracle; a rate limit slows automated attempts. Detection: a spike in failed reads for a single id. Residual: negligible given the entropy. Test: wrong secret always returns the generic unavailable response.
26. Public search engine indexing. Likelihood medium, impact medium. Prevention: `X-Robots-Tag: noindex, nofollow` at the edge plus a client meta; unlisted links are not linked from anywhere indexable. Test: the Vercel header rule is present for `/share/*`.
27. Messaging preview bots. Likelihood high, impact low. Prevention: view only snapshot, no secret in the request line, no per view logging that a preview bot would pollute; the page reveals only the safe snapshot. Residual: a preview bot renders the safe snapshot, which is acceptable. Test: not applicable; noted as a reason not to log views.
28. Source deleted while a refresh runs. Likelihood low, impact low. Prevention: `on delete cascade` removes the share when the source is deleted; a refresh that races a delete either completes against the row or finds it gone and the share is cascaded away; the public read then returns unavailable. Test: deleting the source removes the share and the public read returns the generic response.
29. Concurrent rotate and read. Likelihood low, impact low. Prevention: rotate replaces `token_hash` in one atomic update, so a read either validates against the old hash (before commit) or the new (after), never a torn state. Test: rotation is a single update; the old secret stops validating immediately after.
30. Concurrent revoke and refresh. Likelihood low, impact low. Prevention: both are single authoritative statements guarded by the lifecycle RPC; revoke sets `revoked_at`, and a refresh on a revoked row is refused. Test: a refresh after revoke is refused; revoke wins.
31. Creator removed. Likelihood low, impact low. Prevention: creator removal does not auto expose new data (the snapshot is frozen), and a manager holding `shares.manage` can still revoke; `created_by` referencing a removed profile is a set null, not a cascade delete of the share. Test: after the creator is removed, a manager can still revoke the share.
32. Audit failure. Likelihood low, impact medium. Prevention: the audit insert is in the same transaction as the mutation, so an audit failure aborts the mutation (fail closed); a lifecycle action never succeeds without its audit event. Test: a forced audit failure rolls back the lifecycle mutation.
33. Partial lifecycle write. Likelihood low, impact medium. Prevention: each lifecycle action is one transactional RPC; there is no multi statement client orchestration to leave half done. Test: a failed RPC leaves the row in its prior state.
34. Malformed old snapshot version. Likelihood low, impact low. Prevention: the snapshot carries `snapshot_version`; the read function and the public page handle a known set of versions and show the neutral unavailable state for an unknown one rather than rendering garbage. Test: a snapshot with an unknown version renders the unavailable state, not an error.
35. Public page accidentally bootstrapping authenticated queries. Likelihood medium if not guarded, impact high. Prevention: the public component imports and mounts none of the authenticated providers or hooks; a component test asserts no `SessionsProvider` and no protected query fires. Test: section 24 route test.
36. Signed media URL reaches an unintended object (avatars, another club). Likelihood low, impact high. Prevention: the function signs only paths present in the validated snapshot, never a caller supplied path; the only inputs are `shareId` and `secret`. Test: the function ignores any path not in the snapshot and never signs an avatar path.

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
- The one active share invariant holds under concurrency (the partial unique index).
- Source deletion invalidates the share (cascade).
- A rights downgrade invalidates the share.
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
- An uptime check on the public route (a simple external probe hitting a known invalid share and asserting a fast generic response) is worthwhile once public sharing is live, because the public route is the first thing an external person sees; it is low cost and carries no personal data. RECOMMENDED as a small operational add when the public slice ships, not a v1 code dependency.
- Retention of operational logs follows the platform defaults; no new personal data is introduced, so no new retention decision is forced beyond the audit retention question already open (section 30).

Analytics is not a prerequisite for v1. Do not gate the release on it.

## 26. Rollout and rollback

Per phase (section 27), the rollout follows the CONFIRMED gated discipline.

- Migrations are gated: opened as a PR, reviewed line by line, run by hand via the connector after the live ledger confirms the slot is free, never auto merged. Confirm a usable backup or point in time restore window before applying a destructive or boundary changing migration (the `0028` precedent).
- Edge Functions deploy from files on disk, never inline paste, verified by byte for byte readback of the deployed source (the `_shared/fa.ts` lesson).
- The security suite gates in CI (added in PR #105). Any migration ships with its `tests/security/` additions green locally and in CI.
- Vercel deploys `main` to production and every PR to a preview URL. The public route and its headers are verified on a preview URL before merge.
- Post deploy verification for the public functions reads the deployed source back and exercises a real invalid, revoked and expired link against the deployed function, plus a real eligible share end to end on the preview URL.

Disable and rollback mechanism:

- A club level kill switch. RECOMMENDED DEFAULT: a boolean the read function checks (for example a `clubs` setting or a function environment flag) that makes every public read return the generic unavailable response without touching share rows, so public sharing can be turned off instantly without a deploy or a data change. UNRESOLVED DECISION (section 30): whether public sharing is disabled globally through a club setting in addition to capabilities.
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

- User outcome: none visible yet; this is the security substrate.
- Current code evidence: no rights field exists (section 13); capabilities are data with a pinned catalogue test (section 18); `audit_events` supports new actions without a table change (section 19).
- Scope: `shares.create` and `shares.manage` capabilities and grants; a content rights classification (the `internal_only` / `public_link_only` / `public_full` vocabulary) on media and content, with an FA derivation backfill defaulting FA content to internal only; the `content_shares` table with the hashed fragment secret model and the three foreign key exactly one design; the exact direct access revocations (no anon or authenticated client access to `content_shares`); the lifecycle RPC skeleton; the sharing audit writer and actions; the security harness additions; no public page yet.
- Non scope: the public functions and the public route (PR 2).
- Likely files: a provisional migration at 0038 or the next free slot; `supabase/seed.sql` and `supabase/seed_teams` style grants; `tests/security/content-shares.test.ts`; `tests/security/capabilities.test.ts` update to 22 keys; `src/lib/data.ts` capability and rights types; `docs/security/` a new sharing boundary document.
- Migrations: one gated migration (provisional 0038+), creating `content_shares`, the rights columns, the grants, the RPC, and the writer.
- RPCs: the lifecycle RPC (service role only) and the sharing audit writer.
- Edge Functions: none.
- Capability changes: add `shares.create`, `shares.manage`; grants per section 18.
- Audit actions: register `content_share.created/refreshed/rotated/revoked` in the writer's allow list and metadata shape.
- Tests: the security suite additions (section 24 database and security list) and the capabilities tripwire update.
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

- User outcome: a coach creates a public link to a drill; an external recipient opens it without an account and sees the drill and its eligible media.
- Current code evidence: Drill Detail exists; drills are the smallest complete content unit and the first to exercise media signing and rights.
- Scope: the two Edge Functions (`manage-content-share`, `read-content-share`); the pure shared snapshot builder and allow list scanner in `_shared/share.ts`; the public route `/share/:shareId` outside auth; the Drill Detail public share flow (preview, create, refresh, rotate, revoke); eligible media signing; mobile and accessibility; deployed function byte readback.
- Non scope: sessions and programmes (PR 3 and PR 4); export (PR 6); a management page (PR 5).
- Likely files: `supabase/functions/manage-content-share/index.ts`, `supabase/functions/read-content-share/index.ts`, `supabase/functions/_shared/share.ts` and `share_test.ts`, `src/routes/PublicShare.tsx`, `src/App.tsx` (the public route), `vercel.json` (the `/share/*` headers), `src/routes/DrillDetail.tsx`, a Share modal on the existing `Modal` primitive, `src/lib/queries.ts` (the public and management query hooks), `ci.yml` (`deno check` and `deno test` additions).
- Migrations: none if PR 1 provided the schema; otherwise a follow up gated migration.
- RPCs: uses the PR 1 lifecycle RPC.
- Edge Functions: two new; `read-content-share` is the first public function and must pin `verify_jwt = false` at deploy.
- Capability changes: none beyond PR 1.
- Audit actions: emits the PR 1 registered actions.
- Tests: the unit builders and scanner; the Deno function tests; the route and component tests; the security suite already covers the table.
- Accessibility: the full section 22 list for the Share modal and the public page.
- Human gates: public function, public route, rights boundary; do not auto merge; byte for byte readback of both deployed functions.
- Rollout order: after PR 1.
- Backup requirement: none new (no destructive migration).
- Post deploy verification: readback of both functions; a real eligible drill share end to end on a preview URL; invalid, revoked and expired all return the generic response; the public route mounts no authenticated provider.
- Rollback or disable: the club level kill switch (section 26); the read function can be rolled back independently.
- Estimated size: L.
- Dependencies: PR 1.
- Auto merge: prohibited.

### PR 3: Public session sharing

- User outcome: a coach shares a saved session; the external recipient sees the ordered activities, referenced drills, safe board and safe fields.
- Current code evidence: Session Day and the Planner save seam exist; sessions carry the operational fields the allow list must exclude (section 11.1).
- Scope: the saved session share flow; the Session Day Share action; Planner Save and share; activity and referenced drill projection; the safe board projection (numbers and positions only); operational fields excluded; unsaved and dirty state handling through the PR #103 seam.
- Non scope: programmes (PR 4).
- Likely files: `_shared/share.ts` (session builder), `src/routes/SessionDay.tsx`, `src/routes/Planner.tsx`, `src/routes/PublicShare.tsx` (session render and board render).
- Migrations: none. RPCs: reuse. Edge Functions: extend the builder, redeploy with readback.
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
- Scope: a "Shared links" management screen for `shares.manage` holders; filter by kind and status; creator; expiry; revoke and rotate. No token display after initial creation.
- Assessment of placement: this can be folded into PR 2 to PR 4 as per entity controls, or be its own screen. RECOMMENDED: per entity controls ship in PR 2 to PR 4 (each detail page manages its own share), and a club wide management screen is its own PR here for managers who need the whole picture.
- Important: because the database stores only a hash, the raw secret cannot be displayed later. So the management screen shows status, times and expiry, offers Revoke and Rotate, but cannot show the live link for an existing share. RECOMMENDED SECURITY DEFAULT: the raw secret is shown only on Create or Rotate and is never recoverable from the database; an owner who lost the link rotates to get a new one. UNRESOLVED DECISION (section 30): whether the current URL is instead stored encrypted so it can be reshown, at the cost of holding a reversible secret. The recommended default keeps only a hash.
- Likely files: a new `src/routes/AdminShares.tsx` (or a section of an existing admin route), `src/lib/queries.ts` (a management list hook via the management function), `src/App.tsx` (a `RequireCap cap="shares.manage"` route).
- Migrations: none. RPCs: reuse (a list action on the management function). Edge Functions: extend `manage-content-share` with a list action.
- Capability changes: none. Audit actions: reuse (rotate and revoke).
- Tests: route tests for the list, filter, revoke and rotate; a test that the raw secret is not shown for an existing share.
- Accessibility: the section 22 list for the screen.
- Human gates: touches the management function (redeploy with readback); do not auto merge.
- Rollout order: after PR 2 at the earliest; naturally after PR 4.
- Backup requirement: none.
- Post deploy verification: the list shows status without secrets; revoke and rotate work from the screen.
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

5. Do managers receive `shares.manage`?
   - Recommended: yes, managers and admins get `shares.manage`.
   - Strongest alternative: only admins manage shares.
   - User value: a manager can revoke a mistaken or stale club share without an admin.
   - Privacy and security: `shares.manage` can revoke any club share, a safety lever; it does not expose content.
   - Implementation: a grant row.
   - Evidence that would change it: if the club wants share revocation reserved to admins.

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

9. Are session date, time, venue and team always excluded?
   - Recommended: yes, always excluded from public snapshots.
   - Strongest alternative: allow the owner to opt in to showing a date.
   - User value: a date can help an external coach place a session; excluding it is safer.
   - Privacy and security: when and where a youth team trains is safeguarding sensitive; excluding it is the safe default.
   - Implementation: the allow list excludes them; an opt in would add per field controls.
   - Evidence that would change it: a safeguarding reviewed opt in for a coarse label (a month, not a date and venue), if ever wanted.

10. Is the club name and crest public on the share page?
    - Recommended: yes, club name, motto and the bundled public `/crest.png`; never the private crest object or the club id.
    - Strongest alternative: omit branding.
    - User value: branding helps the recipient trust the link.
    - Privacy and security: the bundled crest and the public name and motto are already public; the club id and the private crest are not returned.
    - Implementation: use the static asset and the `name` and `motto` fields.
    - Evidence that would change it: if the club prefers unbranded shares.

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

13. Does creator removal revoke links?
    - Recommended: no automatic revoke on creator removal; the snapshot is frozen, `created_by` becomes null, and a manager can revoke.
    - Strongest alternative: revoke all of a removed member's shares automatically.
    - User value: keeping a useful share alive after a coach leaves may be desirable; auto revoke is tidier.
    - Privacy and security: the frozen snapshot exposes nothing new when the creator leaves; a manager retains the revoke lever.
    - Implementation: a set null on `created_by`; auto revoke would be a trigger.
    - Evidence that would change it: a policy that a departed member's shares must all be revoked.

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

18. Should public sharing be disabled globally through a club setting as well as capabilities?
    - Recommended: yes, a club level kill switch the read function checks, in addition to capabilities.
    - Strongest alternative: capabilities only.
    - User value: a kill switch lets an admin turn everything off instantly in an incident.
    - Privacy and security: a single switch that fails public reads closed is a strong safety lever.
    - Implementation: a boolean read by the function; small.
    - Evidence that would change it: if capability revocation is judged sufficient (but it does not stop already created links, so the switch is recommended).

19. What is the retention period for revoked share metadata and audit events?
    - Recommended: retain share rows and audit events indefinitely at current scale, reviewed annually, matching the audit foundation's stated default.
    - Strongest alternative: prune revoked shares after a fixed window.
    - User value: retained audit history answers "who shared what and when"; pruning reduces clutter.
    - Privacy and security: audit rows hold no secret, no snapshot and no viewer identity, so retention is low risk; a revoked share row could keep its snapshot, so pruning the snapshot from a long revoked share is a reasonable tidy up.
    - Implementation: none for retain; a sweeper for prune.
    - Evidence that would change it: a data minimisation policy that sets an explicit retention window.

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
- Both Edge Functions exist with the correct `verify_jwt` settings and are verified by byte for byte readback.
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

This roadmap was reviewed against twelve perspectives and revised before it was opened for owner review: a grassroots coach on a phone, an OTJ manager, an external recipient with no account, a product owner, a privacy and safeguarding reviewer, a third party content rights reviewer, a Supabase security engineer, an Edge Function engineer, a database and migration engineer, an accessibility reviewer, an operational support reviewer, and a future multi club architect. Material findings from those perspectives are folded into the sections above (the club wide readability that makes club links trivial, the single unauthenticated route constraint, the first public function departure, the CORS same origin nuance, the audit metadata allow list gap for sharing events, the capability count tripwire coupling, the private crest versus bundled crest branding choice, the delete then recreate immutability residual, the programme expiry exception, and the aggregate rights block).

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

Note: `sourceAttribution` is null here because the synthetic drill is club original (`public_full`). An FA derived drill would either carry its attribution and be blocked from public sharing (media internal only) or, if the owner records an FA text decision, show the attribution. No `club_id`, `created_by`, `media_id`, `source_key`, storage path or database id appears.

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

Note: no `date`, `start_time`, `venue`, `team_id`, team name, `coach_id`, coach name, `spond_event_id`, attendance count, live state, `programme_id`, real `board_id`, real drill id or storage path appears. Board tokens carry `number`, `side`, `x`, `y` only; there is no `playerId` and no `id`.

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

Note: no template `author`, no `created_by` or owner, no linked club sessions or completion state, no dates, no venues, no internal ids. Referenced drills use snapshot local ids (`d1`, `d2`), never database uuids. The attached programme PDF is present only if its media rights class is `public_full`; an FA PDF is internal only and omitted, and a programme that requires it to be complete is blocked from public sharing.

### 33.4 Generic unavailable response (synthetic)

```json
{ "status": "unavailable" }
```

The same response is returned for an invalid `shareId`, a wrong secret, a revoked share and an expired share, so a reader cannot tell which, and cannot tell whether a link ever existed.



