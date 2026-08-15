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
8. **Player roster.** The `players` table, a per team roster of children curated by coaches, gated to `players.view` and never visible to parents.
9. **Parent experience.** A parent dashboard and parent scoped navigation that surface only what the read only role may see.
10. **Feedback log.** A club visible log of requests and bug reports that any member files, parents included, with status moved by admins.
11. **Mobile navigation.** The bottom nav extended to cover the admin and secondary screens.
12. **Training day.** Venues the club picks from, the set of teams a session covers, a team default bib colour, and the pitch side working list: who is in tonight's groups, what they wear, and quick add for whoever turns up. It works with nothing configured beyond a roster.
13. **Training first.** One classifier behind every event list, Training as the default view with All events as the widening, and ownership demoted to a secondary narrowing. See Training first below.
14. **Tonight.** Session day collapsed from a Register plus a passive Spond attendance card into one screen that organises the night: Spond response filters that drive the list, Select all on the visible set, automatic bibs, and an explicit Save groups. See Tonight below.
15. **Session lifecycle.** One derived rule for whether a night is still operational work, Upcoming as the default view with Past as the widening, and nothing deleted. See Session lifecycle below.

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

### Branch preflight

A task branch name handed to a session is not proof the branch is free. Before creating, reusing or pushing one, run these four commands and read them:

```bash
git fetch origin                                    # 1. see the real remote refs
git ls-remote --heads origin <branch>               # 2. does it already exist?
git log --oneline origin/main..origin/<branch>      # 3. what is on it that main lacks?
git merge-base --is-ancestor origin/<branch> origin/main   # 4. exit 0 means fully merged
```

Then:

- Nothing there, or step 4 exits 0: the branch is yours, carry on.
- Step 3 lists commits: that is somebody's unmerged work. Check for an open PR against the branch, and do not force-push. Either rebase those commits onto the new base and keep them, or take a fresh unique branch name for your own work.
- Rewrite history only when the current task explicitly owns the branch and you have read step 3's output. `--force-with-lease` protects against a race, not against overwriting work you never looked at.

This exists because a session took a handed-down branch name, force-pushed over an unmerged commit it had never read, and only found out afterwards. The commit was recovered; the check is four commands and takes seconds.

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
- The children's data boundary is stated in full in `docs/security/spond-data-boundary.md`, which is authoritative where any older comment, PR or branch disagrees. In summary: the only Spond identifier persisted is the opaque member id, and only for a member a human bound to a roster child. No Spond name, guardian, guardian id, email, phone number, address, contact, comment, `recipients` object or raw payload fragment is ever persisted, logged or returned, by any path. `spond_events` keeps its four integer counts (accepted, declined, unanswered, waiting) and has no payload or member columns by design, so an unlinked member is represented in the aggregates and nowhere else. Test fixtures are synthetic, never real payloads.
- `spond-sync` never reads a name. It derives the four counts in memory, and for LINKED members only it writes one closed reply state per event to `spond_event_responses`. It cannot write a row for an unlinked member: a foreign key makes that unrepresentable. When it cannot prove the linked set completely, it writes and deletes nothing rather than treating unknown as empty.
- Two functions read a member's name and only one persists one. `spond-roster-import` is the single, separate, admin triggered place a name is written, to the `players` roster: it runs only when someone presses Import for a specific mapped team, never on a schedule and never as part of the attendance sync, and takes only the child's full name and an optional shirt number. `spond-link-members` returns a member's display name transiently to the linking screen so a manager can identify the person, and persists nothing. Neither reads a guardian, contact or any other profile field, with two structural exceptions, both opaque, both unpersisted and unlogged: the member's `roles` list, solely to keep Spond staff (role holders) out of the candidate, diagnostic and import lists, with the `SPOND_IGNORED_MEMBER_IDS` function secret as the operator backstop for unassigned staff, opaque ids only; and the member's `subGroups` list, which has always scoped both functions to the mapped subgroup and which `spond-link-members` also returns on a setup diagnostic row. Both log only HTTP status and counts, never a name.
- The linking screen's **setup diagnostics** answer why a registered player has no candidate at all, which was three different Spond side problems presenting as one unexplained list. From the SAME `groups/` response the candidates come from, `spond-link-members` returns the members of that parent group the team's mappings do not reach, as their own closed shape `{ display_name, subgroup_ids }` beside the unchanged `LinkCandidate`, so the screen can say `In Spond · no team assigned`, `In Spond · assigned to another team` or `Not found in Spond group data`. No second Spond call is made, a diagnostic row carries no member id so nothing links from one, staff are excluded before any row is emitted, and nothing new is persisted. It fails closed both ways: an unproved scan states nothing rather than claiming a match or an absence, and a name carried by more than one member is ambiguous rather than any category implying identity. "Not found in Spond group data" is deliberately not "not in Spond": absence from one parent group is not absence from Spond.
- Names shown anywhere in the product come from `players.display_name`, never from stored Spond identity data. Unlinking a child, or erasing one, removes every stored reply for that member by cascade, in the same statement.
- Spond RSVP is context. What the coach records in `register_entries` is their own, and nothing in the Spond pipeline reads, writes, defaults or constrains it. Going and not included, declined and included, and no reply and included are all valid. Tonight must be fully usable with no Spond configuration at all, and a Spond failure must render as no context, never as "nobody is coming".
- A dedicated Spond organiser account is used, never a personal login. Its credentials live only in the `SPOND_EMAIL` and `SPOND_PASSWORD` function secrets, never in the repo and never in the client. The sync fails closed when they are missing.
- Sync direction is Spond to app only. Sessions are arranged and answered in Spond; the Hub holds a synced copy of the counts.
- **One mirrored event holds at most one Hub session.** `sessions_spond_event_id_unique` (0048) is a partial unique index over `sessions.spond_event_id`, so the corruption a plain index permitted (the 11 August event linked to both its own session and a June one) cannot recur, including for two coaches pressing Plan this in the same second. Plan from Spond therefore treats an event as planned when ANY club session links it, never only the current coach's, and a refused write is recognised by constraint (`isSpondLinkTaken`), never recovered into an update of a row that does not exist, and reported as one sentence a coach can act on while the sessions and events refetch. 0048 repairs the one production pair by clearing the June session's link, deletes nothing, and aborts rather than guessing if any other duplicate exists.
- An event matched by more than one mapping in a run is shared and becomes a club event, stored with no team. `spond_type` stores Spond's own event classification ("EVENT" or "MATCH") as an event fact about the event itself, not member data.

---

## Training first

The product is a training hub, so training is what every list of events leads with.

- Wherever a list can hold training alongside fixtures, galas and the rest, the default view is **Training** and the one widening is **All events**. No screen defaults to My sessions, All sessions, All teams or a list led by fixtures. Team is a narrowing within the kind and never changes it; ownership ("Mine") is a secondary narrowing that starts off. Ownership still decides who may edit or delete, which is a different question entirely.
- Classification has one implementation, `src/lib/eventKind.ts`. The order is: Spond's own `spond_type` of "MATCH" on the row, then "MATCH" on the Spond event the row is linked to, then a training word in the label ("training", "session", "practice", "warm up" however punctuated), then a football fixture shape, then a non training word, then training. `spond_type` "EVENT" is Spond's catch-all and is never treated as proof of training. The classifier reads either a session's `name` or an event's `title`, so two shapes never mean two classifiers.
- Everything the classifier knows beyond the row arrives as one `EventKindContext`, built by one hook, `useEventKindContext`. It carries the Spond event lookup and the club's team names, and it is one parameter rather than two so a screen cannot supply half the context and read as though it had supplied all of it. `src/lib/eventFilter.ts` takes it as `kindContext`, and `pickerEvents` and `spondPlanSuggestions` take the same shape.
- A session planned from a Spond event keeps only `spond_event_id`, because `sessions` has no `spond_type` column and is not getting one for a filtering rule. So a fixture titled "U8 v Horbury" carries no evidence of being a fixture, and any screen that filters SESSIONS must hand the classifier the lookup so the link resolves back to Spond's own answer. A screen filtering synced events never needs one, since those rows carry `spondType` directly. An unresolvable link, a caller with no lookup or an event that has left the mirror, falls through to the title rules, which is the same fail-towards-showing direction as everything else here.
- **Spond states no classification at this club, so the title is the only evidence there is.** Every `spond_events` row in production carries `spond_type` null, fixtures included, and those rows were written by the deployed sync that does read the payload's `spondType`. No other stored event fact separates a fixture either: `team_id` records which mapping matched the event (training addressed to the whole parent group carries none, which is a fact about recipients and not about football) and `location` is a venue. Production therefore carried "Lindley Moor – TITANS", "Hepworth – TITANS" and "TROJANS – Rastrick" under Training on every screen, each of them present twice, once as a synced event and once as the session a coach planned from it.
- The fixture rule, `isFixtureTitle`, is the narrowest thing that catches those three. All of it must hold at once: the label, with the pre match and match day phrases already taken out, splits on ONE versus separator (an en dash, em dash or hyphen with whitespace both sides, or `v`/`vs`/`versus`) into exactly two sides; one whole side IS one of the club's team names, not a word inside a longer side; and BOTH sides read as the name of somebody playing, meaning at most four words each, every word starting with an uppercase LETTER or being a small joining word, and no word a day or a month. It deliberately misses "U8 v Horbury", "Titans U9 – Hepworth" and "titans – rastrick", each of which is one line to widen, because every miss shows a fixture and every false catch hides a training night. Without the club's teams in hand the rule cannot fire and the classifier is exactly what it was before it existed.
- **A one word Title Case side is the hard case, and it is answered by the rule that can only show.** "Shooting" and "Rastrick" are both one capitalised word, so shape cannot separate them, and the first version of this rule hid "Titans – Shooting", "Titans – Goalkeeping" and "Titans – Passing And Receiving" while keeping the all lower case spelling of the same title. Teaching the fixture rule a list of topics it must refuse to hide would be a hiding rule with an exception list, so the vocabulary went into `TRAINING_WORDS` instead, where a positive statement outranks everything: the FA's own themes and player skills (the lists `src/lib/fa.ts` offers a coach) plus the coaching and venue words that list does not carry. Adding a word there can only ever move a title from fixture to training. Days and months are a closed set and sit in the fixture rule as `NOT_AN_OPPONENT`; a leading digit no longer reads as a name, which is what used to make "Titans – 5-a-side" and "TITANS – Week 3" fixtures. The residual, pinned as a test: a single capitalised word that is none of those still reads as an opponent, so a training night titled that way is one tap away under All events, and the one line fix is another word in `TRAINING_WORDS`.
- The title heuristic is deliberately lopsided, because its two failure modes are not equally bad: showing a gala under Training costs a coach one glance, hiding a training night costs them the session. So the rules that can hide are narrow (whole words and plurals, with "pre match", "post match" and "match day" taken out first, because those are training) and the rules that can show are broad (a positive training word beats the exclusion list outright). Several exclusion words are overloaded on purpose, which is why they lose that contest.
- `src/lib/eventFilter.ts` composes kind, team and ownership in that order, and `pickNextEvent` decides what a schedule leads with, preferring training over a sooner fixture; Home's eyebrow says which "next" it means so the claim matches the row. Home, Sessions, Plan from Spond, the Spond event picker and the admin synced events list all go through those two modules. This is a filtering rule and needs no migration; nothing about it reaches the database.
- `src/lib/eventKind.invariant.test.ts` is a tripwire, not a proof. It reads source text, so it catches the realistic mistakes (a title check, a copied word list, a retyped label, a screen opening on its own literal instead of the shared default) and it names in its own tests the shapes it cannot catch (a word reaching the predicate through a variable, a comparison separated from the label by a call). Treat a pass as "nobody typed the obvious thing", never as "there is only one classifier". It deliberately does not try to check that a screen supplies the classifier context, lookup or team names: presence of an identifier says nothing about which call site uses it, and a review broke that check both ways in one sitting. `src/routes/trainingFirst.screens.test.tsx` is what enforces it, by rendering the real screens over the three production fixture titles and failing if one of them appears.
- The behavioural half is `src/routes/trainingFirst.screens.test.tsx`, which renders the real Sessions, Home and admin Spond containers with the data layer stubbed and asserts a fixture is absent from what they show. It exists because the seam tests and the source-text tripwire together were not enough: with the whole suite green it was possible to filter Sessions on `kind: 'all'` under a pressed Training chip, and to drop the lookup from two of Home's three classification points. Rules that live inside a modal are extracted to pure functions (`pickerEvents` in `src/lib/spond.ts`) rather than left untestable, since this project has no DOM and a modal never opens under test.
- Tonight organises the night the same way: **Going** is the default response view and **Everyone** is the widening. See Tonight below.
- Bibs need no per player setup: a register entry's override wins, otherwise the team's default colour, otherwise none, with a stored override of `none` meaning no bib rather than fall back. The inherit option on a player row is labelled with the colour it resolves to, `Blue (team)` rather than a bare `Team bib`, through `bibInheritLabel` in `src/lib/bibs.ts`; the label is display only and the stored sentinel stays the empty value, so showing the colour never persists an override and a later change of team default still moves every untouched row.

---

## Tonight

Session day has ONE operational surface, and its user visible name is **Players &amp; groups**. Training runs on Saturday mornings as often as Tuesday evenings and a coach organises a session days either side of it, so the surface is named for its job, never for a time of day, and the name never varies with the clock. Tonight survives only as the internal concept and module name (`src/lib/tonight.ts`, `PLAYERS_GROUPS_TITLE` beside it holds the one user visible title); no string a user reads says Tonight, which `tonight.invariant.test.ts` pins. The job is not attendance, it is organisation: who is expected, which children the coach is including, and what bib each needs so the squad splits into groups. `src/lib/tonight.ts` holds the whole model and `src/routes/SessionRegister.tsx` is a thin shell over it. The file name and the `/session-day/:id/register` segment keep the old word to avoid route churn; nothing user visible says Register.

- **Two independent facts per child.** The Spond reply is what the parent said; Included is what the coach decided. A Going child need not be included and a Not going child may be, because they turned up anyway.
- **Five response filters**, `Going / No reply / Not going / Waiting / Everyone`, defaulting to Going. Each carries a count of the Hub players on THIS session, never the raw Spond event aggregate, because the chip filters this list and its number has to be the number of rows. A child with no Spond link has no reply to give: they are counted only under Everyone and are never called No reply. The four reply states are the COVERED SQUAD, so a quick added guest is counted only under Everyone as well: their reply is a fact about their own team's event, which is what `hasResponseContext` has always said when refusing to let a visitor open the filters. One predicate, `matchesResponse`, decides both the chip's number and the rows that chip lists, so excluding a guest from the count while leaving them in the list is not representable. That predicate is why `going + noReply + notGoing + waiting == withResponse` holds for any mix of rows.
- **Five populations, one builder, and none of them is any of the others.** `tonightCounts` in `src/lib/tonight.ts` produces every number the screen shows and the screen counts no array itself. The five are the covered squad, the linked subset of it, the linked players carrying a stored reply for THIS event, the four reply states, and what the coach selected. The Spond event aggregate is a sixth thing that is deliberately absent from the builder: it takes rows and links, so there is no parameter an aggregate could arrive through. This exists because a coach reported "19 vs 11" as a contradiction and it was two correct numbers. 19 was `spond_events.accepted_count`, everybody Spond invited who pressed Going over an audience of 46 to 50. 11 was the Going chip, covered Hub players linked to a member who accepted, out of 27 linked from a squad of 40. Every identity reconciled against production, so nothing was wrong with the data and everything was wrong with two bare numbers wearing one word. `src/lib/spond.ts` names the aggregate wherever it renders (`spondAudience`, `spondAudienceNote`, `SPOND_AUDIENCE_CAPTION`, `spondPickerSummary`), and Players &amp; groups prints the link coverage line that bridges them: `27 of 40 players linked to Spond · 13 not linked`, with `tonightUnlinkedNote` naming the teams that hold the gap (`Not linked: Argonauts 8 · Trojans 5`) so an all team session never sends a coach hunting. Both lines come from the same rows and link set through one rule, an unknown link set renders as silence in both, and neither is ever an aggregate figure. Never put an aggregate figure on a Players &amp; groups chip.
- **The aggregate is one labelled sentence, and never a split.** Naming the population was not enough: the planner card, the Plan from Spond rows and the event picker each rendered the four counts as four figures beside four words, and "20 accepted, 24 declined" is read as a statement about the club's players however it is captioned, because that is what a going figure means on a football app. On the 11 August event those two figures were an audience of 50 people, while the covered squad was 10 going and 14 not going out of 27 linked children from 40. Both pairs were correct. So `spondAudienceNote` now reads `Spond audience: 50 people invited`, a headcount carrying no reply word at all, and **it is the only shape the aggregate takes anywhere in the product**. There is no exempt surface. The admin Synced events card was one for a day, on the reasoning that inspecting the mirror means seeing what was synced, and that reasoning was wrong in the only way that matters: that card is the screen the defect was reported from, so exempting it left the reported screen unchanged. `SPOND_COUNT_LABELS` no longer exists and `tonight.invariant.test.ts` fails the build if a count field off an event row reaches any file but `src/lib/spond.ts`.
- **A reply word may only ever be rendered against a population of players.** Going, No reply, Not going and Waiting describe children or they are not written. Admin Synced events shows them as `Linked players (27) · 10 going · 3 no reply · 14 not going · 0 waiting`, built by `countLinkedResponses` from `spond_event_responses` through the same `matchesResponse` predicate Tonight's chips use, so one predicate answers for both. That population is honestly a different one from Tonight's and wears a different label: it is every linked child who replied to one event, with no session and therefore no coverage to narrow by, whereas a Tonight chip counts the children a SESSION covers. Two populations, two labels, never two words for one. The read (`useSpondEventResponseCounts`) selects `spond_event_id` and `status` and no member id, so it cannot resolve to a child even in memory; a database without 0045, a read in flight and a failed read all render as silence rather than as zero, and an event no linked child replied to says so in words. `src/routes/adminSpondCounts.screens.test.tsx` renders the real screen over the 11 August figures and fails if an API reply word or an aggregate count reaches the markup.
- **The per player figures are not reproduced beside the aggregate.** Establishing which children a session covers is the register composition behind Tonight, and a second screen reading its own way to its own answer is precisely how one honest pair of numbers came to look like a contradiction. So the planner card says what the event is and where the player figures live, and counts nobody itself.
- **A denominator that cannot be established is never guessed.** Zero `session_teams` rows means coverage was never set, so Tonight counts nobody and says the session has no teams yet rather than falling back to every child in the club. The unknown link set and the unsettled reply read behave the same way, one level down.
- **Two things can be unknown, and neither is ever counted as zero.** The link set is `null` when the read has not answered, and the reply read states its own settledness through `responsesKnown`. Both leave a sentence unsaid rather than printing "0 of 40 linked" or "0 with a reply" at a club whose reads were merely slow. A linked child with no stored reply for this event is real (a link made after the last sync, or a member not invited to it), renders exactly like an unlinked child, and is therefore said out loud rather than left as an unexplained gap.
- **Nothing persists until Save groups.** Every tick, Select all, Clear and bib change edits a local draft. Select all applies only to the currently visible filter and never reaches a child the coach has not looked at. Quick add is a draft edit too, so `draftEntries` merges the draft over the stored rows before the list is composed, or a child just added would vanish until saved.
- **Saved means stored.** `useSaveTonight` sends the delta as one upsert and returns the authoritative readback; the screen compares that readback with the draft field for field. A partial write, a refused row or a value that came back different all stay dirty. The bulk upsert is one `INSERT ... ON CONFLICT` so a refused row fails the whole statement, but the Saved claim rests on the comparison, not on that.
- **Groups are the main visual**, keyed on effective bib with team identity beside them, and only selected children appear. A bib change reorganises the draft immediately; Save commits it.
- **Refresh Spond lives here**, on the existing authenticated sync path, so a coach never visits the admin screen during training. A failed refresh keeps the responses already in hand and the draft untouched.
- **Three facts per child, three fields, and none writes another.** The Spond reply is what the parent said, `register_entries.present` is whether the child actually turned up, and `register_entries.included_in_groups` is whether the coach put them in tonight's split. All four combinations of the last two are real nights and all four are storable: a child can attend and be left out of the groups, and be in a group before they arrive. Nothing derives either from the Spond reply. `0047_register_group_inclusion.sql` added the second column; between the Tonight release and 0047 `present` carried both meanings, which meant a coach who split fourteen of the eighteen who came had recorded four children absent. The migration copies nothing between the two columns in either direction and its self-verification fingerprints the attendance record before and after to prove it; rows written in that window keep a value that meant inclusion and are read as attendance, because no rule could tell them apart without guessing. The tick on the row sets inclusion, the Here button sets attendance, and a save sends only the columns that changed, so two coaches editing different facts about one child cannot overwrite each other. `marked_by`/`marked_at` are trigger stamped for either edit.
- `src/lib/tonight.invariant.test.ts` pins the rules that would be quietly expensive to lose: one card on session day, no persistence outside Save, one implementation of the filters, one count builder with no screen filtering rows itself, the bib rule staying in `bibs.ts`, and no user visible Register wording. `src/lib/tonightCounts.test.ts` is the behavioural half and carries the production reconciliation in its header. Two source text checks in that file were removed after they survived mutation: one matched an import line while the caption was deleted from the markup, and one asserted picker wording through a static render, which never opens the modal. Both were replaced by tests of the rendered output and of the pure composer, which is the same reason `pickerEvents` lives in `src/lib/spond.ts`.

---

## Session lifecycle

Training Hub is an operational product, so a night that has happened stops being work. It is never deleted and never unreachable, it moves.

- Whether a session is still active is **derived on every read**, in one place, `src/lib/sessionLifecycle.ts`. Nothing about it is stored and nothing about it writes. `sessions.status` is only ever set to `completed` by the live view's driver pressing End, so almost every finished session in the database still says `upcoming` for ever; trusting that flag is what left yesterday's training on the front page.
- **Three states, because "finished" and "yesterday" are two questions.** `active` is still to come or running and is the only state that may be offered as the next event; `endedToday` has finished but its local calendar day has not, so it is not next and is still fully reachable; `past` is a previous local day or older. A session at 18:00 with no plan took the fallback, became past at 19:30 and left every operational surface while the coach was still on the pitch at 22:30, which is the regression the third state fixes. `isSessionOperational` (active or endedToday) is the complement of `isSessionPast` and is what every LIST and entry point uses; `isSessionActive` is what only "what is next" uses. Getting those two the wrong way round drops a session out of both lists, so `sessionLifecycle.invariant.test.ts` fails the build on a file that names both `isSessionActive` and `isSessionPast` without `isSessionOperational`.
- **A live marker is evidence, and evidence goes stale.** Pressing End is the only thing that clears `live_activity_index`, so a driver who closed the tab leaves it set for ever, and reading the bare column as "this session is running" kept five June and July rows in Upcoming into August. `isSessionLive(event, now)` counts a marker only on the local day it belongs to: the day it was WRITTEN when `live_activity_started_at` is readable (the driver rewrites it on every activity change), and the session's own start day when it is not. A marker on a previous local day is stale; a marker on a day that has not arrived is not evidence either, so a future session carrying contradictory live columns gets no Live badge while remaining active on the clock. A calendar day rather than a grace period, for the reason the third lifecycle state uses one, and it self heals: nothing rewrites those rows, and a stale marker stops mattering when the day turns over. No screen reads the column: `liveActivityNow` gives the live view the driver's activity through the same rule, and the invariant test fails the build on a null comparison against `liveActivityIndex` anywhere outside the seam.
- The precedence, in order: `status` of `completed` is read first and beats the live columns, so a row carrying both cannot be stuck active for ever, but it now means "has ended" rather than "is past" and the day rule places it; a session being driven live, WITH A CURRENT MARKER, is active however far past its expected end; otherwise the expected end is the local start plus the planned duration; the fallback duration applies where the plan cannot answer; `now` later than the expected end means ended, and an ended session is `endedToday` when the local day it started on OR the local day it was expected to end on is today, and `past` otherwise. Everything else, an unreadable date included, is active. A completed session whose own calendar day has not arrived is past, which keeps a contradictory row (marked finished days early, which the planner allows) out of the operational view; the guard compares CALENDAR DAYS rather than instants, because comparing instants would send a session the driver ended EARLY back to past for the rest of its own window and then let it reappear. Every rule that can hide is narrow, and every ambiguity resolves towards keeping the session on screen, the same asymmetry the training classifier uses.
- **The local day is read from local fields**, never from `toISOString().slice(0, 10)`, which asks whether two instants share a UTC day and so answers wrongly for the hour of every British Summer Time evening after 23:00. `isSameLocalDay` compares `getFullYear`/`getMonth`/`getDate`, which is DST safe for free: a 23 hour and a 25 hour day both still have exactly one date. The test suite runs in `TZ=Europe/London` (`vite.config.ts`) so the hours where BST and UTC disagree are actually exercised.
- The planned duration is the sum of the activity durations. Where that is zero or absent the one fallback is **90 minutes**, `FALLBACK_SESSION_MINUTES`, chosen generous because ending a session too late costs a coach one row on a screen and ending it too early takes tonight off the front page while they are standing on the pitch. It is the only fallback duration in the product; the calendar export (`src/lib/ics.ts`) takes its start and length from the same seam rather than deriving a second answer.
- Time is **local wall clock**. `date` and `time` are read as the coach typed them by building the instant from parts, never by handing a string to `Date.parse`, which would read a Yorkshire training night as UTC. A synced Spond event carries `startsAt`, an absolute instant, and is read from that, so two shapes mean one rule the way `name` and `title` do for the classifier. Duration is added to the start **instant** in real minutes, so a clock change cannot shorten a session and a session running past midnight stays active into the small hours.
- **The order is a property of the view.** `useSessions` reads soonest first, which is right for a schedule and wrong for a history: Past led with last June and buried last night. Reversing the query would fix Past by breaking Home, which leads with the front of the same list, so `orderEventsForScope` in `src/lib/eventFilter.ts` decides it beside the filter that composes the view, from the same start instant the lifecycle reads. Upcoming reads soonest first, Past most recent first, which is the pair of rules `spondPlanSuggestions` already applies to synced events. `applyEventFilter` orders what it filters, so a screen cannot get the right rows in the wrong order; a row nothing places in time sorts last in both directions, and ties keep the query's order because the sort is stable. It changes nothing `pickNextEvent` does: that takes an already ordered list and picks the first row that qualifies.
- Every list of events splits **Upcoming** (the default) and **Past** (the widening), composed in `src/lib/eventFilter.ts` after the kind and before team and ownership. Home, Sessions, the parent dashboard and Plan from Spond all go through it. Home offers no Past chip at all: it is the "what is next" surface, and its honest empty state is better than yesterday.
- Two Spond surfaces deliberately do not apply it, for stated reasons. The admin Synced events card is an inspection of what the mirror holds, and hiding last night would hide exactly the evidence an admin came to check. The session day event picker (`pickerEvents` in `src/lib/spond.ts`) orders by closeness to that session's own moment, so a session being linked after the fact needs the events that have run.
- This is presentation only. No migration, no cron, no background reconciliation, and no write triggered by a page rendering. Nothing deletes a session, a saved group, a bib, a Spond reply or a saved board because time passed, and `spond-sync` retention is untouched. Organising a past session is deliberately unchanged: Tonight is the record of what the night was, and it already treats a session that has happened as a record worth keeping correct, so a time based write lockout would be a new policy rather than part of this rule.
- `src/lib/sessionLifecycle.invariant.test.ts` is a tripwire, not a proof. It fails the build on the realistic mistakes (an instant compared against an instant, a date string compared against a today string, an operational surface reading `status`, a screen dropping the seam or opening on its own literal, a second fallback duration) and it names in its own tests the shapes it cannot catch (a comparison hidden behind a local helper, instants compared through variables, the status string assembled rather than written).

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

The core content tables: `clubs`, `profiles`, `teams`, `media`, `drills`, `templates`, `sessions`, `programmes`, `spond_groups`, `spond_events`, `player_spond_links`, `spond_event_responses`, `feedback`, `boards`, `players`, `venues`, `session_teams`, `register_entries`. The capability, season, audit and sharing tables are not listed here; the migrations are the authority. The first six live in `supabase/migrations/0001_init.sql`; `teams` plus the nullable `team_id` columns on `sessions` and `profiles` arrive in `0002_teams_roles.sql`, with the five club teams seeded by `supabase/seed_teams.sql`. The FA session model columns (setup notes, STEP adaptations, theme and format on `drills`; intentions and space on `sessions`; intentions, programme and week on `templates`; source attribution on all four) arrive in `0005_fa_alignment.sql`, with the FA option lists centralised in `src/lib/fa.ts`. The shared live session state (`live_activity_index` and `live_activity_started_at` on `sessions`, both null when not live, plus adding `sessions` to the realtime publication) arrives in `0006_live_state.sql`; the live view's driver writes it once per activity change and watchers compute the running clock locally from the timestamp. The parent role's write lockout (the four insert policies recreated with the writing roles spelled out) arrives in `0007_parent_role.sql`, completed by `0009_parent_owner_writes.sql`, which adds the same role condition to the owner arms of the update and delete policies so a coach demoted to parent loses write on content they created. The profile photo path (`avatar_url` on `profiles`) arrives in `0008_avatars.sql`; the photo object lives in the `media` bucket under `avatars/{user_id}/` with no media row, renders through the same signed URL hook as media previews, and falls back to initials. Programmes become a first-class entity in `0011_programmes.sql`: the `programmes` table (name, focus, summary, intentions, weeks, an attachable PDF via `pdf_media_id`, source attribution), `programme_id` and `programme_week` on `templates` and `sessions`, and a backfill that turns the legacy `templates.programme` and `templates.week` labels into rows. The legacy label columns stay for one phase as the backfill source and are not written by new code. The Spond tables arrive in `0013_spond.sql`: `spond_groups` maps a team to its Spond subgroup, and `spond_events` holds four integer attendance counts per event plus event facts only, with no member or raw payload columns by design; `spond_type` ("EVENT" or "MATCH") is added to `spond_events` in `0018_spond_type.sql` as an event fact, not member data. `feedback` (`0019_feedback.sql`) is the club visible request and bug log, and is the one insert open to the parent role. `boards` (`0020_boards.sql`) saves a tactics board's tokens as pitch fraction coordinates and carries no person data; `0028_board_player_boundary.sql` makes that boundary schema after roster seeding had breached it: a token persists at most id, number, side, x, y and playerId (a check constraint refuses anything else, labels included), names resolve at render time through the players.view gated players select, and parents receive shape and numbers only. `players` (`0021_players.sql`, its boundary restated in `0023_players_fullname.sql`) is the per team roster and the only table that holds children's names; its select is gated to `players.view`, never readable by parents. `sessions` gains a nullable `board_id` (`0022_session_board.sql`) attaching at most one saved board. The training day tables arrive together in `0044_training_day_core.sql`, deliberately as one atomic migration because the screens read all of them at once: `venues` (the club's named places, club wide read, `club.manage` write), `sessions.venue_id` (a club scoped composite reference whose `on delete set null` names `venue_id` alone, since the bare form would null `club_id` too and make a used venue undeletable), `teams.bib_colour` against the closed `is_bib_colour` vocabulary, `session_teams` (which teams a session covers) and `register_entries` (who attended and what bib they wore, select gated `players.view`, writes `sessions.create` club wide, unaudited per tick by decision). `register_entries.included_in_groups` arrives in `0047_register_group_inclusion.sql`, a NOT NULL boolean defaulting to false, so `present` goes back to meaning physical attendance and the coach's arrangement of the night has its own column. That migration adds one column and three comments: it writes no row, copies nothing between the two columns in either direction, and changes no policy, grant or trigger, because the four 0044 policies name no column and the grants are table wide. Its self-verification proves all of that and aborts if any of it has moved. `sessions.venue` and `sessions.team_id` are marked FROZEN there. New code never writes a value to either; it retires them, so the read fallback behind each cannot resurrect and contradict the real field. A save always clears `team_id`, which is safe because `toSession` normalises a legacy row's frozen team into `teamIds` on the way in, so an empty covered set reaching the write path means a coach cleared it. `venue` is cleared only when a real venue is chosen, so a session saved before venues existed keeps its typed label until someone positively replaces it. The Spond linking tables arrive in `0045_spond_links.sql`, one atomic migration because the second's foreign key into the first is simultaneously the only invariant that matters and the erasure mechanism: `player_spond_links` binds one opaque Spond member id (uppercase hex only, so a name, an email or a phone number does not fit the column) to one `players` row, written by a human holding `players.manage` and immutable (no update policy, no update grant), and `spond_event_responses` holds one closed reply state per LINKED member per event, written under `sessions.create` by `spond-sync`. Both selects are gated `players.view`, deliberately not the capability free club wide read `spond_events` uses, because these rows resolve to a named child. `spond_event_responses_link_fk ... on delete cascade` makes an unlinked member's row unrepresentable and makes unlinking, or erasing a child, drain every stored reply in the same statement, so there is no sweep to truncate or skip. Neither table has a `jsonb` or array column, so there is no escape hatch to widen without a gated migration. `0048_spond_session_link_unique.sql` adds `sessions_spond_event_id_unique`, a partial unique index over `sessions.spond_event_id` where it is not null, making one session per mirrored event a database fact rather than a convention, and repairs the single production row that had broken it by clearing one June session's link. It deletes no session, rewrites no status, clears no `live_activity_index` and changes no policy, grant or trigger; its self-verification fingerprints every other session row whole before and after, and it aborts if the hosted database holds any duplicate link other than the reviewed pair. Partial because most sessions carry no link, and not scoped by club because a `spond_events` row already belongs to exactly one club through the foreign key.

Zero `session_teams` rows means coverage was never set, never "all teams". Reading absence as everyone would let deleting a team silently widen a single team session's register to every child in the club. `src/lib/sessionTeams.ts` holds the same rule on the client and is the only place coverage is interpreted.

The register is the coach's own record and takes no Spond input of any kind. A club that has never configured Spond gets the complete register: the roster the session covers, present or not, a per player bib override and quick add for anyone who turns up. Spond RSVP, when it arrives, is context beside a row and never attendance itself.

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
