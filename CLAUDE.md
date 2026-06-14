# OTJ Training Hub

A web app for Ossett Town Juniors coaches to build, store and run training sessions. Coaches browse a shared drill library organised by the FA four corners (technical, physical, social, psychological), assemble drills into a timed session in a planner, save sessions to a calendar, and run them on the touchline in a full-screen live mode with a timer. A media library holds the videos, YouTube links, diagrams and PDFs that back each drill.

Repo: `sense360store/OTJ` (private).

---

## Scope: one product, two documents

This repo grew out of a Claude Design handoff that produced two reference documents. They describe the **same product** at two levels of ambition. Do not treat them as two separate builds.

- **`design-reference/Ossett Training Hub.html`** (plus the files it imports: `styles.css`, `data.js`, `icons.js`, `ui.jsx`, `app.jsx`, `screens-*.jsx`) is the **pixel-perfect visual and behavioural source of truth for the front-end**. Match its visual output exactly. It is a clickable prototype built on in-browser Babel with hand-rolled routing and mock data. It is a spec, not shippable code.
- **`design-reference/Build Spec - Frontend, Backend & Login.html`** is the **architecture document**: the stack, the data layer, the database schema, media storage, realtime, login and auth, roles and Row-Level Security, hosting and the phased roadmap. It answers how the backend works.

Build what the Build Spec describes, using the prototype as the visual reference. Everything under `design-reference/` is read-only. Never ship prototype code verbatim; recreate it properly in the real stack.

---

## Stack

| Layer | Choice |
|---|---|
| Front-end | React + Vite + TypeScript |
| Routing | react-router-dom |
| Server state | TanStack Query (`@tanstack/react-query`) |
| Backend | Supabase (Postgres, Auth, Storage, Realtime) |
| Auth | Supabase Auth, email plus password and magic link, invite-only sign-up |
| Front-end host | Vercel (static build, preview deploy per pull request) |

There is no custom application server. The React app talks to Supabase directly over HTTPS carrying the user's JWT, and Postgres Row-Level Security decides access. Do not introduce an Express or Node API layer without raising it first.

---

## Repo structure

```
OTJ/
├─ src/
│  ├─ main.tsx              # mount, router, query client, import styles.css
│  ├─ App.tsx              # shell: sidebar, top bar, bottom nav, auth guard, <Outlet/>
│  ├─ styles.css           # ported from the prototype unchanged (design tokens)
│  ├─ lib/
│  │  ├─ supabase.ts        # the single configured Supabase client
│  │  └─ queries.ts         # every read and write hook in one place
│  ├─ routes/
│  │  ├─ Login.tsx          # new, the front door
│  │  ├─ Home.tsx
│  │  ├─ Library.tsx
│  │  ├─ DrillDetail.tsx
│  │  ├─ Sessions.tsx
│  │  ├─ Planner.tsx
│  │  ├─ Templates.tsx
│  │  ├─ Media.tsx
│  │  └─ LiveSession.tsx
│  ├─ components/           # ui primitives ported from ui.jsx, plus icons
│  └─ hooks/
│     └─ useAuth.ts         # current user plus role context
├─ supabase/
│  ├─ config.toml           # from supabase init
│  ├─ migrations/
│  │  └─ 0001_init.sql       # schema, enums, helpers, RLS (REVIEW REQUIRED)
│  └─ seed.sql              # local-only seed ported from data.js
├─ design-reference/        # the handoff bundle, read-only, never shipped
├─ public/
│  └─ crest.png             # locally hosted club crest (see Assets)
├─ .env                     # gitignored, holds the anon key only
├─ .env.example
├─ .gitignore
└─ CLAUDE.md
```

Routing maps almost one-to-one from the prototype's `screens-*.jsx` to `routes/`. Use real URLs: `/`, `/library`, `/drill/:id`, `/sessions`, `/planner` (accepts `?sessionId=`), `/templates`, `/media`, `/live/:sessionId`, `/login`.

---

## Bootstrap

Run once to stand the project up. Assumes Node 20 plus and Docker (for local Supabase).

```bash
# 1. Get the empty repo locally (create it on GitHub first, no README/license)
git clone https://github.com/sense360store/OTJ.git
cd OTJ
# If the GitHub repo already has commits, scaffold into a temp dir and copy in,
# or run: git pull --rebase origin main  after scaffolding.

# 2. Scaffold Vite + React + TypeScript into this directory
npm create vite@latest . -- --template react-ts
npm install

# 3. App dependencies
npm install react-router-dom @tanstack/react-query @supabase/supabase-js

# 4. Supabase CLI and local stack
npm install -D supabase
npx supabase init
npx supabase start          # boots local Postgres, Auth, Storage in Docker

# 5. Apply schema and seed to the local database
npx supabase db reset       # runs migrations/0001_init.sql then seed.sql

# 6. Front-end
cp .env.example .env        # then paste your local or hosted Supabase keys
npm run dev
```

Hosted backend, when ready:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push        # applies migrations to the hosted Postgres
```

Deploy front-end: connect the GitHub repo in the Vercel dashboard, framework preset Vite, build `npm run build`, output `dist`, and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables. Pushes to `main` deploy to production; pull requests get preview URLs.

---

## Build order

Work one phase per branch, one pull request per phase. Each phase is independently useful. Every branch is cut from current `main`, never from another feature branch. Phases 1 to 5 are the original roadmap and are shipped and live; items 6 onward record the work built since and now live too. This list is a status reflection, not a forward plan.

1. **Project plus login.** Vite migration, prototype components ported into `routes/` and `components/`, `styles.css` in unchanged, Supabase project, the six-table migration applied, Login screen and auth guard. App runs on seeded data behind a password.
2. **Persisted planning.** Replace every `window.OTJ` read with a TanStack Query hook and every `upsertSession` with a Supabase mutation. RLS locks each coach to their own sessions.
3. **Media uploads.** Signed-URL uploads to Supabase Storage, the Media Library backed by real files, drills linked to real clips.
4. **Admin and invites.** Invite-only sign-up, the admin role, coach management, official template curation.
5. **Realtime and parents.** Shared live-session sync over Supabase Realtime, the read-only parent role, add to calendar (.ics download). Email and push reminders are possible future work.
6. **Spond attendance.** Read only sync of Spond event counts into `spond_events`, team to subgroup mappings in `spond_groups`, shared event handling (an event matched by more than one mapping becomes a club event with no team), plan a session from a Spond event, and a separate admin triggered squad roster import.
7. **Tactics board.** A pitch board through phase four: place and drag tokens, seed from a formation or the team roster, save and load boards, and attach a board to a session, rendered in both a view mode and an edit mode.
8. **Player roster.** The `players` table, a per team roster of children curated by coaches, gated to `sessions.create` and never visible to parents.
9. **Parent experience.** A parent dashboard and parent scoped navigation that surface only what the read only role may see.
10. **Feedback log.** A club visible log of requests and bug reports that any member files, parents included, with status moved by admins.
11. **Mobile navigation.** The bottom nav extended to cover the admin and secondary screens.

### Phase 1 detail
- Scaffold per Bootstrap above.
- Port `styles.css` verbatim into `src/styles.css` and import it in `main.tsx`. The design tokens carry over untouched.
- Port `ui.jsx` primitives and `icons.js` into `src/components/`.
- Port each `screens-*.jsx` into `src/routes/`, wired with react-router so the URL reflects the screen.
- Wrap the app in an auth guard: no session renders `Login`; a session renders the shell. The role drives which nav items show.
- Apply `0001_init.sql` and port `data.js` into `supabase/seed.sql` (see Data model).
- For Phase 1, queries may still read seeded data; full read and write wiring is Phase 2.

---

## Review gates (do not auto-merge)

The same discipline applied on the Sense360 repos applies here. The following touch the security boundary and must be opened as a pull request and stopped for human review. Do not auto-merge them, even in auto mode:

- The login and auth flow (`routes/Login.tsx`, `hooks/useAuth.ts`, the auth guard in `App.tsx`).
- Anything under `supabase/migrations/`, especially RLS policies, the `my_club()` and `my_role()` helpers, and the `handle_new_user` trigger.
- The Storage bucket policies.
- Anything that reads or writes secrets or `.env`, or changes which keys reach the client.
- Invite and role-assignment logic (Phase 4).

Everything else (UI port, query hooks, planner logic, media UI, styling) can run in normal sessions, with a pull request reviewed before merge.

### Edge Function deploys

Deploy an Edge Function through Claude Code or the Supabase CLI from the files on disk, never by pasting file contents inline. A deploy that includes a large shared module (for example `_shared/fa.ts`) can be silently truncated or replaced with a placeholder when the file is pasted inline, leaving a broken function that still reports success. Every function deploy is verified by reading the deployed source back byte for byte and checking its content, never by trusting a version number; that readback is what catches a bad inline deploy.

---

## Roles, teams and permissions

Core design rules from Phase 4 onward. Every feature, screen, query and mutation states its role behaviour.

- The roles are admin, coach and parent. Admin is root and is the only role that sees or touches user management. Coach sees and uses everything else, club-wide. Parent is read-only: parents see club content and watch live sessions, and they change nothing; the planner redirects them away and every create, edit, upload, import and drive affordance is absent for them. Postgres RLS is always the enforcement; the UI only decides what to surface. Any change to role behaviour is a gated migration.
- Visibility is club-wide, ownership is personal, teams are a filter. Read access to club content is never restricted by team. Edit and delete follow ownership (own, or admin). Team is an attribute used for filtering and defaults, never for access control. Whose sessions you are looking at is a view filter that defaults to your own (parents, owning nothing, always see the whole club).
- The club's teams are Titans, Trojans, Gladiators, Spartans and Argonauts, held as first-class data in the `teams` table.

| Capability | Coach | Admin | Parent |
|---|---|---|---|
| View drills, media, templates, sessions | yes, club-wide | yes, club-wide | yes, club-wide |
| Watch a live session | yes | yes | yes |
| Drive a live session | own only | any in club | no |
| Create drills and media | yes | yes | no |
| Import from England Football | yes | yes | no |
| Edit or delete a drill or media item | own only | any in club | no |
| Create sessions | yes, own | yes, own | no |
| Edit or delete a session | own only | any in club | no |
| Curate templates | no | yes | no |
| Manage teams | no | yes | no |
| User management, invites, role changes | no | yes | no |

---

## Secrets

- Only the anon public key reaches the front-end, as `VITE_SUPABASE_ANON_KEY`. Vite exposes any `VITE_`-prefixed variable to the browser, so never prefix a secret with `VITE_`.
- The service-role key is never used in the front-end and never committed. It lives only in local CLI env or server-side scripts.
- `.env` is gitignored. `.env.example` documents the shape with placeholders only.

---

## Third-party content

The club is an FA-affiliated charity club and holds permission to use England Football Learning content (learn.englandfootball.com) for its non-commercial coaching purposes, on the terms that FA images are used unmodified, never recreated or redrawn, and the use is not for profit. The platform operates within those terms:

- FA content enters the platform only when a signed-in coach imports a specific resource by URL. The platform never crawls catalogues or bulk-imports, and never follows links beyond the single pasted page, with one sanctioned exception: a programme overview's own week links may be followed, one level, same host, capped, as part of importing that one user-chosen resource.
- Imported images are stored unmodified, with the source URL and "England Football Learning" attribution recorded and displayed wherever the image renders large.
- Nothing is sold or made public. The app is invite-only club membership.
- Where an FA-derived drill needs a diagram, the FA's own image is used, not a recreation.
- FA videos may be downloaded by the club and used in the app under the FA's stated permission for non profit use, and must never be sold or placed behind any paid or subscription access.

For non-FA third-party content the default remains link and attribute, do not copy.

---

## Spond integration

Spond is where the club arranges sessions and parents respond. The Hub mirrors attendance from it under a standing policy:

- The integration is read only toward Spond. Authentication is the only non GET call. The platform never creates, modifies, cancels or responds to anything on Spond, and no write of any kind flows from this app to Spond without an explicit new decision.
- Attendance is counts only, the children's data boundary. Spond event responses identify children and their parents. The `spond-sync` function derives four integer counts per event (accepted, declined, unanswered, waiting) in memory and discards everything else; it never reads a name. No member identifying data (ids, names, emails, phone numbers, comments or payload fragments) is ever persisted, logged, or returned. `spond_events` has no payload or member columns by design, and test fixtures are synthetic, never real payloads.
- The squad roster import is the one exception, and it is isolated. `spond-roster-import` is the single, separate, admin triggered place the Spond pipeline reads member names. It runs only when someone presses Import for a specific mapped team, never on a schedule and never as part of the attendance sync. From each member it takes only the child's full name and an optional shirt number, writing them to the `players` roster; it never reads a guardian, contact or any other profile field, and like `spond-sync` it logs only HTTP status and counts, never a name.
- A dedicated Spond organiser account is used, never a personal login. Its credentials live only in the `SPOND_EMAIL` and `SPOND_PASSWORD` function secrets, never in the repo and never in the client. The sync fails closed when they are missing.
- Sync direction is Spond to app only. Sessions are arranged and answered in Spond; the Hub holds a synced copy of the counts.
- An event matched by more than one mapping in a run is shared and becomes a club event, stored with no team. `spond_type` stores Spond's own event classification ("EVENT" or "MATCH") as an event fact about the event itself, not member data.

---

## Conventions

- Copy style: direct, factual, understated. No hype, no marketing tone, no emojis. This applies to user-facing strings, docs, and commit messages.
- Do not use hyphens or dashes to break or join sentences in any prose output (docs, comments, commit messages). Hyphenated compound words such as front-end, full-screen and invite-only are fine.
- TypeScript throughout, functional components, hooks. Keep `tsconfig` strict.
- TanStack Query is the single source of truth for server data. Local UI state (open filter, dark mode, live timer position) stays in React state and `localStorage`, exactly as the prototype does.
- Keep components close to the prototype's structure where it fits; the goal is matching visual output, not copying the prototype's internals.

---

## Design tokens

Source of truth is `src/styles.css` (`:root` for light, `.theme-dark` for dark). Key values:

- Brand: Navy 900 `#0a1f6b`, Navy `#122a86`, Royal `#1f43d6`, Gold `#f4c020`, Gold-soft `#fff4d1`.
- Four corners: technical `#1f43d6`, physical `#16a34a`, social `#ef8e1b`, psychological `#7c4dff`.
- Media types: video `#1f43d6`, youtube `#e23b3b`, image `#16a34a`, pdf `#ef5a5a`.
- Type: Archivo (500 to 900) for display and headings; Hanken Grotesk (400 to 800) for body; both via Google Fonts. Mono stack for `.mono` numeric metadata.
- Radii: sm `11px`, base `16px`, lg `22px`, pills `999px`.
- Layout: sidebar `264px`, content max-width `1280px`, responsive breakpoint `900px` (sidebar swaps to a bottom nav below it).
- Dark mode toggles `.theme-dark` on `<html>` and persists to `localStorage` (`otj_dark`). All colours are CSS variables that flip.

---

## Data model

Thirteen tables: `clubs`, `profiles`, `teams`, `media`, `drills`, `templates`, `sessions`, `programmes`, `spond_groups`, `spond_events`, `feedback`, `boards`, `players`. The first six live in `supabase/migrations/0001_init.sql`; `teams` plus the nullable `team_id` columns on `sessions` and `profiles` arrive in `0002_teams_roles.sql`, with the five club teams seeded by `supabase/seed_teams.sql`. The FA session model columns (setup notes, STEP adaptations, theme and format on `drills`; intentions and space on `sessions`; intentions, programme and week on `templates`; source attribution on all four) arrive in `0005_fa_alignment.sql`, with the FA option lists centralised in `src/lib/fa.ts`. The shared live session state (`live_activity_index` and `live_activity_started_at` on `sessions`, both null when not live, plus adding `sessions` to the realtime publication) arrives in `0006_live_state.sql`; the live view's driver writes it once per activity change and watchers compute the running clock locally from the timestamp. The parent role's write lockout (the four insert policies recreated with the writing roles spelled out) arrives in `0007_parent_role.sql`, completed by `0009_parent_owner_writes.sql`, which adds the same role condition to the owner arms of the update and delete policies so a coach demoted to parent loses write on content they created. The profile photo path (`avatar_url` on `profiles`) arrives in `0008_avatars.sql`; the photo object lives in the `media` bucket under `avatars/{user_id}/` with no media row, renders through the same signed URL hook as media previews, and falls back to initials. Programmes become a first-class entity in `0011_programmes.sql`: the `programmes` table (name, focus, summary, intentions, weeks, an attachable PDF via `pdf_media_id`, source attribution), `programme_id` and `programme_week` on `templates` and `sessions`, and a backfill that turns the legacy `templates.programme` and `templates.week` labels into rows. The legacy label columns stay for one phase as the backfill source and are not written by new code. The Spond tables arrive in `0013_spond.sql`: `spond_groups` maps a team to its Spond subgroup, and `spond_events` holds four integer attendance counts per event plus event facts only, with no member or raw payload columns by design; `spond_type` ("EVENT" or "MATCH") is added to `spond_events` in `0018_spond_type.sql` as an event fact, not member data. `feedback` (`0019_feedback.sql`) is the club visible request and bug log, and is the one insert open to the parent role. `boards` (`0020_boards.sql`) saves a tactics board's tokens as pitch fraction coordinates and carries no person data. `players` (`0021_players.sql`, its boundary restated in `0023_players_fullname.sql`) is the per team roster and the only table that holds children's names; its select is gated to `sessions.create`, never readable by parents. `sessions` gains a nullable `board_id` (`0022_session_board.sql`) attaching at most one saved board.

The migration files on disk have number gaps: 0003, 0004 and 0010 are absent, and the early init was applied at project setup. This is development renumbering only; the live migration ledger is the source of truth, not the file names. Going forward, confirm the next free number against the live ledger before writing a migration, never assume it from the highest file on disk.

Notes:

- `activities` on `sessions` and `templates` is a `jsonb` array of `{ phase, drill_id, duration }`, read and written as a whole by the planner. `drill_id` inside it references a real `drills.id`.
- Session total minutes is the sum of `activity.duration`, computed in the UI (the prototype's `sessionMinutes`).
- A media item's "Used in n drills" count is derived from drills referencing it, not stored.

### Seeding from the prototype
`design-reference/data.js` holds the demo data. Port it into `supabase/seed.sql` (local development only; production data comes from sign-up and the app itself):

- Insert one club: name "Ossett Town Juniors", motto "Where football and friendships flourish", crest_url pointing at `/crest.png` once the asset is hosted.
- Generate stable UUIDs for every drill, media item and template. Build a map from the prototype's text ids (`d1`, `m1`, `t1`) to the new UUIDs, and rewrite every `activities[].drill_id` accordingly so references stay intact.
- Drop the derived `usedIn` field; it is computed in the UI.
- Sessions require a `coach_id` that references a profile, which references an `auth.users` row. For local seed only, create a demo auth user with a fixed UUID and an admin profile, then seed the three sessions against it. Do not seed users in production.
- Verify counts after seeding: 12 drills, 10 media, 3 templates, 3 sessions.

---

## Assets

- Club crest: the prototype hot-links `https://www.ossetttownjnr.com/imgs/Club_Logo_Transparent.png`. Download it once into `public/crest.png` and reference the local copy. Keep the "OTJ" text fallback for load failures.
- Icons: inline SVG set ported from `icons.js`.
- Fonts: Archivo and Hanken Grotesk via Google Fonts link in `index.html`. Self-hosting is a later refinement.
