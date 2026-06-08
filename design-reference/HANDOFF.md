# Handoff: Ossett Town Juniors — Training Hub

## Overview
A web app for a grassroots football club's coaches to **build, store and run training sessions**. Coaches browse a shared drill library (organised by the FA "four corners" — technical, physical, social, psychological), assemble drills into a timed session in a planner, save sessions to a calendar, and run them on the touchline in a full-screen live mode with a timer. A media library holds the videos, YouTube links, diagrams and PDFs that back each drill.

This package contains a **complete, working front-end prototype** plus a **build spec** for turning it into a real, multi-user product with logins and a database.

---

## About the Design Files
The files in `prototype/` are a **design reference built in HTML/React (via in-browser Babel)** — a high-fidelity, fully clickable prototype showing the intended look and behaviour. They are **not** production code to ship as-is: there is no build step, no backend, and all data is mocked in `data.js`.

**The task** is to recreate this design in a real codebase. Two paths:
1. **If starting fresh (recommended):** lift the existing React components into a proper Vite + React + TypeScript project and add a backend, exactly as the build spec describes. The components and `styles.css` carry over almost unchanged — this is the fastest route.
2. **If an environment already exists:** rebuild the screens using that codebase's framework, component library and patterns, using these files as the visual and behavioural spec.

`build_spec/` contains a full architecture document (also as readable HTML) covering the recommended stack, data layer, database schema, auth/login, roles, media storage and a phased roadmap. **Read it first** — it answers "how should the backend work" in detail.

---

## Fidelity
**High-fidelity (hifi).** Final colours, typography, spacing, component states, dark mode and responsive/mobile behaviour are all settled. Recreate the UI pixel-accurately using the target codebase's libraries. Exact tokens are listed under **Design Tokens** below and defined in `prototype/styles.css`.

---

## Recommended Stack (from the build spec)
| Layer | Choice | Why |
|---|---|---|
| Front-end | React + Vite + TypeScript | Reuses the existing components; real build, routing, types |
| Backend | **Supabase** | One managed service = Postgres + auth + storage + realtime |
| Database | PostgreSQL | Relational data (drills↔sessions↔media); Row-Level Security |
| Auth | Supabase Auth | Email/password + magic-link, JWT, password reset built-in |
| Hosting | Vercel / Netlify (front) + Supabase (back) | Free tier, auto HTTPS, no server to maintain |

A custom Node/Express + Postgres server is a valid alternative — the API operations below map directly onto routes.

---

## Screens / Views
Routing today is hand-rolled in `prototype/app.jsx` (state-based `nav(screen, params)`). In production, make each a real route.

### 1. Login *(new — does not exist in the prototype yet)*
- **Purpose:** front door. Coach signs in with email + password or magic link.
- **Layout:** centred card on the brand navy background; crest, title, email + password fields, primary "Sign in" button, "Email me a link" secondary, "Forgot password" text link.
- **Behaviour:** on success, store the session and load the app shell. On failure, inline error. **Sign-up is invite-only** — no public registration.

### 2. App Shell (`app.jsx` → `App`, `Sidebar`, `TopBar`, `BottomNav`)
- **Layout:** fixed 264px left sidebar + fluid main column. Main = sticky top bar (60px) over a scrolling content area (`max-width: 1280px`, padding `28px 26px 90px`).
- **Sidebar:** crest + "Ossett Town Juniors / Training Hub", club motto + "FA 2-Star Accredited" pill, grouped nav (Home; **Plan**: Drill Library [badge = drill count], Sessions, Session Planner; **Content**: Templates, Media Library), and a footer coach chip (avatar initials + name + role badge). In production the chip and visible nav are driven by the logged-in profile + role.
- **Top bar:** search field (focusing it jumps to Library), notifications bell, dark-mode toggle (sun/moon), gold "New Session" button → planner.
- **Mobile (≤900px):** sidebar hidden; a `mobile-topbar` (crest + title + theme toggle) appears and a fixed 5-item `bottom-nav` (Home, Drills, Plan, Sessions, Media) shows. Hit targets ≥44px.

### 3. Home (`screens-home.jsx`)
- **Purpose:** coach landing — next sessions, quick entry into the library by corner.
- **Components:** greeting/header, upcoming-session cards, "four corners" entry tiles (each routes into Library pre-filtered by corner), quick links.

### 4. Drill Library (`screens-library.jsx` → `Library`)
- **Purpose:** browse/filter all drills.
- **Layout:** page head ("Drill Library" + count subtitle), a horizontal filter row of toggle **chips** (corner, age band U6–U12, skill, level), then a responsive grid of drill cards.
- **Drill card:** media thumbnail (or striped placeholder) with a corner-coloured tag, title, summary line, meta (duration, age range, players), skill/level tags. Click → Drill Detail. Accepts a `preset` (e.g. `{corner}`) when entered from Home.

### 5. Drill Detail (`screens-library.jsx` → `DrillDetail`)
- **Purpose:** full drill info + "add to a session".
- **Components:** title + corner tag, the linked media (video/YouTube/image/PDF), summary, **coaching points** list, setup panel (duration, players, area, equipment list), tags, and an "Add to session" action that upserts into a chosen session's activities.

### 6. Sessions (`screens-sessions.jsx` → `Sessions`)
- **Purpose:** the coach's planned sessions.
- **Components:** session cards (name, date, time, venue, age group, focus, status `upcoming`/`completed`, total minutes = sum of activity durations). Actions: edit (→ Planner with `sessionId`), run (→ Live mode).

### 7. Session Planner (`screens-sessions.jsx` → `Planner`)
- **Purpose:** build/edit a session.
- **Components:** session meta form (name, date, time, venue, age group, focus); an ordered activity list grouped by phase (Warm-Up / Skill / Game / Cool-Down) where each row = a drill + duration; add-drill picker; running total minutes. Save calls `upsertSession`. Supports editing an existing session via `editId`.

### 8. Templates (`screens-sessions.jsx` → `Templates`)
- **Purpose:** reusable session blueprints (e.g. "Standard Training Night").
- **Components:** template cards (name, author, focus, activity preview). Action: "Use template" → creates a new session from its activities (`upsertSession`).

### 9. Media Library (`screens-media.jsx` → `MediaLibrary`)
- **Purpose:** all videos, YouTube links, diagrams, PDFs.
- **Layout:** page head with "Upload media" button; filename search + type filter (`All types`); a totals strip (Video : n · YouTube : n · Image : n · PDF : n); responsive grid of media cards.
- **Media card:** preview area with a type tag (top-right) and kind label (e.g. "PITCH FOOTAGE", "DRILL DIAGRAM"), video length badge, filename, metadata (size · dims · length / pages), "Used in n drill(s)" pill, and View / delete actions.
- **Production:** "Upload media" → signed-URL upload to storage, then create a `media` row (see build spec → Media storage).

### 10. Live Session (`screens-live.jsx` → `LiveSession`)
- **Purpose:** run a session on the touchline. **Full-screen overlay**, forces dark mode.
- **Components:** current activity (drill name, coaching points, media), large countdown timer, progress through the phase list, prev/next controls, exit. Persist timer/position to `localStorage` so a refresh mid-session keeps the place.
- **Production v2:** broadcast state over Supabase Realtime so an assistant's device mirrors the live session.

---

## Interactions & Behavior
- **Navigation:** `nav(screen, params)` sets route state and `window.scrollTo(0,0)`; route persisted to `localStorage` (`otj_route`). → replace with react-router; URLs like `/drill/d6`, `/planner?sessionId=s1`.
- **Dark mode:** toggles `.theme-dark` on `<html>`; persisted to `localStorage` (`otj_dark`). All colours are CSS variables that flip — see `:root` and `.theme-dark` in `styles.css`.
- **Filtering (Library):** chips toggle on/off; `.chip.on` = filled navy. Combine corner + age + skill + level.
- **Live mode:** is a full-screen branch *before* the normal shell renders (see `App` in `app.jsx`).
- **Session math:** total minutes = sum of `activity.duration` (`OTJ.sessionMinutes`).
- **Transitions:** buttons lift `translateY(-1px)` + shadow on hover (`.14s`); nav/chip hovers `.12s`. Keep subtle.
- **Responsive:** breakpoint at **900px** swaps sidebar↔bottom-nav (see `styles.css` media queries).
- **Media placeholders:** when a clip is missing, a diagonal-striped placeholder stands in — replace with real previews.

## State Management
| State | Scope | Today | Production |
|---|---|---|---|
| Drills, templates, media | server data | `window.OTJ` (mock) | TanStack Query → Supabase |
| Sessions | server data | `useState(OTJ.sessions)` + `upsertSession` | query + upsert mutation, scoped to coach |
| Current user + role | session | none | `useAuth()` context from `profiles` row |
| Route | UI | `useState` + localStorage | react-router |
| Dark mode, filters, modals | UI | `useState` / localStorage | unchanged |

## Data Fetching (production)
Replace each `OTJ.*` read with a query hook and each mutation with a Supabase write. Every request carries the user's JWT; **Postgres Row-Level Security** decides access (a coach reads the club's shared library, writes only their own sessions). See build spec → API design, Database schema, Roles & permissions for the exact policies and SQL.

---

## Design Tokens
All defined in `prototype/styles.css` `:root` (light) and `.theme-dark` (dark).

### Brand colours
- Navy 900 `#0a1f6b` · Navy (primary) `#122a86` · Royal `#1f43d6` · Royal-600 `#2c4ee6`
- Gold (accent) `#f4c020` · Gold-600 `#e3ac06` · Gold-soft `#fff4d1`

### Four-corner colours
- Technical `#1f43d6` (blue) · Physical `#16a34a` (green) · Social `#ef8e1b` (amber) · Psychological `#7c4dff` (violet)

### Media-type colours
- Video `#1f43d6` · YouTube `#e23b3b` · Image `#16a34a` · PDF `#ef5a5a`

### Ink & neutrals (light)
- Ink `#101631` · Ink-2 `#2b3350` · Slate `#616b82` · Slate-2 `#8a93a7`
- Line `#e8e8e3` · Line-2 `#f0f0ec` · BG `#f5f5f1` · BG-2 `#efefe9` · Card `#ffffff`

### Dark mode
- Ink `#f4f5fb` · Slate `#a4abbe` · Line `#2a3050` · BG `#0d1130` · BG-2 `#11163a` · Card `#161c44`

### Typography
- Display: **Archivo** (weights 500–900) — all headings, badges, avatars; `letter-spacing: -0.02em`
- Body: **Hanken Grotesk** (400–800) — UI text
- Mono: `ui-monospace, "SF Mono", Menlo` — for `.mono` numeric/metadata
- Both from Google Fonts.

### Radii
- sm `11px` · base `16px` · lg `22px` · pills `999px`

### Shadows
- sm `0 1px 2px rgba(16,22,49,.05), 0 1px 3px rgba(16,22,49,.04)`
- base `0 2px 6px rgba(16,22,49,.06), 0 8px 24px rgba(16,22,49,.06)`
- lg `0 12px 32px rgba(16,22,49,.14), 0 4px 10px rgba(16,22,49,.06)`

### Layout
- Sidebar width `264px` · content max-width `1280px` · responsive breakpoint `900px`

### Buttons
`.btn` base h42; `.btn-primary` navy/white, `.btn-gold` gold/ink, `.btn-ghost`, `.btn-quiet`; sizes `.btn-sm` h36 / `.btn-lg` h52.

---

## Data Model (mock → real)
`prototype/data.js` defines the shapes; the build spec turns them into six tables: **clubs, profiles, drills, media, templates, sessions**. Key entities:
- **drill:** id, title, summary, corner, skill, ages[], level, duration, players, area, equipment[], points[], tags[], mediaId
- **media:** id, name, type (video/youtube/image/pdf), kind, size, dims, length/pages, usedIn
- **session / template:** id, name, focus, (date/time/venue/ageGroup/status for sessions), `activities: [{phase, drillId, duration}]`
- Taxonomy: CORNERS, PHASES, SKILLS, AGES (U6–U12), LEVELS.

See build spec → Database schema for column types, foreign keys, and the jsonb note on `activities`.

---

## Assets
- **Club crest:** loaded from `https://www.ossetttownjnr.com/imgs/Club_Logo_Transparent.png` (declared as an `ext-resource-dependency` in the HTML). A text "OTJ" fallback renders if it fails (`Crest` in `app.jsx`). Replace with a locally hosted asset in production.
- **Icons:** inline SVG components in `prototype/icons.js` (`window.Icon`). Swap for the target codebase's icon library if it has one.
- **Fonts:** Archivo + Hanken Grotesk via Google Fonts `<link>`.
- **Media items** in the prototype are mock metadata only — no real files.

---

## Files
### `prototype/` — the design reference (open `Ossett Training Hub.html`)
- `Ossett Training Hub.html` — entry point; loads scripts in order
- `styles.css` — **all design tokens + component styles** (source of truth for visuals)
- `data.js` — mock data + taxonomy (`window.OTJ`)
- `icons.js` — inline SVG icon set (`window.Icon`)
- `ui.jsx` — shared UI primitives (buttons, badges, cards, etc.)
- `app.jsx` — app shell, sidebar, top/bottom nav, routing, `App` root
- `screens-home.jsx`, `screens-library.jsx`, `screens-sessions.jsx`, `screens-media.jsx`, `screens-live.jsx` — the screens

### `build_spec/` — the implementation plan
- `Build Spec — Frontend, Backend & Login.html` — full architecture doc: stack, code structure, data layer, API, database schema, media storage, realtime, **login & auth**, roles & RLS, hosting/cost, phased roadmap. Open in a browser to read.

---

## Suggested Build Order (from the spec)
1. **Project + login** — Vite migration, Supabase setup, 6 tables, login screen + auth guard.
2. **Persisted planning** — drills/sessions/templates read+write to DB; planner saves; RLS per coach.
3. **Media uploads** — signed-URL uploads to Storage; library backed by real files.
4. **Admin & invites** — invite-only sign-up, admin role, coach management, official templates.
5. **Realtime & parents** — shared live-session sync, read-only parent role, reminders.
