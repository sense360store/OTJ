# Multi-item Share Packs: an ordered public collection of club content

Status: scoping and design. Docs only. No application code, migration, dependency, Edge Function, hosted setting or production data is changed by this document or the branch that carries it.

Owner review required before any implementation PR begins. This roadmap ends at a reviewed design; it does not implement the feature. It also does not alter the in flight Content Sharing rollout: PR 2 (public drill sharing) stays exactly as it is, undeployed on hosted with the per club kill switch off, until its own separate approval.

This is a follow on programme that builds on the Content Sharing programme (`docs/roadmaps/content-sharing-roadmap.md`) and its security contract (`docs/security/content-sharing-boundary.md`). It reuses that substrate rather than inventing a second one. Where a fact is read from the repository as it stands it is labelled CONFIRMED CURRENT STATE; where this roadmap proposes something it is labelled RECOMMENDED DEFAULT, and the alternatives are kept visible.

Grounding: every "Confirmed current state" statement is read from `origin/main` at the merge of Content Sharing PR 2 (migrations through `0039_public_share_read.sql`, the two sharing Edge Functions `manage-content-share` and `read-content-share`, the shared builder `supabase/functions/_shared/share.ts`, the public route `/share/:shareId`, and the client control `src/components/PublicShareControl.tsx`). Statements are labelled so a proposed design is never presented as existing behaviour.

Label key (the same key the Content Sharing roadmap uses, kept identical so the two documents read as one family):
- CONFIRMED CURRENT STATE: read from code, migrations, the hosted ledger or docs as they stand today.
- RECOMMENDED DEFAULT: the design this roadmap proposes unless owner review or new evidence overrides it.
- ALTERNATIVE: a considered option kept on the table.
- REJECTED ALTERNATIVE: an option considered and set aside, with the reason.
- UNRESOLVED DECISION: an owner decision this roadmap cannot make alone. Collected in section 19.
- FUTURE OPTION: out of the initial release, recorded for later.

---

## 1. Executive summary

The Content Sharing programme gives a coach one public link per one source: one drill, one session, or one programme, shared from that entity's own detail page. This roadmap adds the workflow that single item sharing cannot express: a coach selects several pieces of content and sends one coherent link, rather than creating and distributing several unrelated links.

The recommended abstraction is deliberately not "bulk create many links". It is a new first class object:

> Multi-select, Create Share Pack, Preview, one public link.

A SHARE PACK is an ordered collection with one title, an optional introduction, an ordered set of content items, one public preview, one secret, one expiry, one lifecycle, one revoke action, and one aggregate rights decision. The recipient opens a single unlisted read only page that lists the pack's items in order. Nothing about the club leaks that a single item share would not already have leaked, because a pack is projected through the same server side allow list and the same public read path that single item sharing already uses.

The central architectural recommendation is reuse, not reinvention. The Content Sharing substrate already provides, and this roadmap does not rebuild: the hashed fragment secret credential model (`/share/:shareId#secret`), the private `content_shares` row with its lifecycle (create, refresh, rotate, revoke, expire) and its per club kill switch, the private `content_share_dependencies` reverse index, the `content_rights` classification and its fail closed aggregate block rule, the two Edge Functions and the single narrow public read path, the audit actions, and the code split public route outside the authenticated tree. A Share Pack becomes a fourth `kind` of `content_shares` row (`pack`) pointing at a new small pair of tables (`share_packs`, `share_pack_items`) that hold the collection itself. The public link, its security, and its lifecycle are the existing machinery; the new work is the collection model, the pack snapshot branch in the one shared builder, the multi-select and builder UX, and the ordered public page.

The safe staged scope is drill only Share Packs first, mirroring the Content Sharing decision to make public drill sharing the first vertical slice. Mixed content (drills plus sessions, programmes inside a pack) is explicitly not assumed for v1; it is a later evaluation once public session and programme sharing exist and their snapshot builders are proven.

The rights model is fail closed and aggregate, identical in spirit to the existing one: every item and every nested dependency must be eligible, one `internal_only` item blocks the entire public pack, missing or cross club references block creation, England Football derived content stays `internal_only`, and a later downgrade of any included item invalidates the pack through the reverse dependency index. The recommended default when one item is restricted is to block the whole pack, not to silently omit the item.

Chronological placement: this is a new programme, labelled Share Packs PR 0 to PR N. It is not Content Sharing PR 3, 4 or 5. It should follow public session and programme sharing and shared link management (Content Sharing PR 3, PR 4, PR 5), because those prove the multi-item snapshot patterns and provide the management surface a pack extends. It runs before or alongside export (Content Sharing PR 6), which could later render a pack. It must not block the current single item public sharing rollout.

## 2. User problems

The problems this programme addresses, each a real coaching workflow that single item sharing serves badly.

- A coach has assembled a themed set of individual drills (a goalkeeper handling set, a warmup set) that is not a session and not a programme. There is no session structure to it and no weekly cadence; it is a curated list. Today the only way to share it is to send several separate drill links.
- A coach wants to send "warmups for Saturday" to the other coaches: five or six drills, in a sensible order, as one thing to open.
- A coordinator wants to give "ideas for U9 coaches" or a set of "drills for a coaches' meeting": a reference list pulled together for one audience and one occasion.
- A coach needs a temporary cross team coaching resource: a short lived collection handed to a colleague for a specific reason, then revoked.

The shared shape of every one of these is: several existing items, one intended recipient act (open this, look through these), one link, one lifecycle. A session is the wrong tool (these are not a timed plan for one training slot) and a programme is the wrong tool (these are not a multi week curriculum). The gap is an ordered collection with a single public link.

There is also a smaller, immediate problem this roadmap resolves as its first step: single item public sharing today lives only on an entity's detail page (`src/components/PublicShareControl.tsx` on Drill Detail, CONFIRMED CURRENT STATE). A coach browsing the Library or the Sessions list has no way to start a share without opening the item first. A list level Share shortcut for one item is a small, safe, independently useful improvement, and it is the natural on ramp to multi-select.

## 3. Confirmed current state

Everything here is read from the repository as it stands after Content Sharing PR 2. It is the factual base this design builds on; the design adds to it and changes none of it.

### 3.1 The public sharing credential and lifecycle exist and are drill only

CONFIRMED CURRENT STATE.

- The public URL model is `/share/:shareId#secret` (`src/lib/publicShare.ts`, `PUBLIC_SNAPSHOT_VERSION = 1`). `shareId` is a lookup uuid, the secret lives in the URL fragment and is read from `window.location.hash`, and the page POSTs `shareId` and `secret` to the public read function. Only a SHA-256 hash of a 256 bit secret is stored (`token_hash bytea`, 32 bytes).
- `content_shares` is one row per public share, private in the strongest sense (RLS enabled, no client policy or grant of any kind), reached only through the service role gated lifecycle RPC `manage_content_share` and the public read path. It carries `kind` (today `drill`, `session`, `programme` are anticipated by the schema but only `drill` is publicly readable), the three nullable source foreign keys `drill_id` / `session_id` / `programme_id` with an exactly one check, `token_hash`, `idempotency_key`, `snapshot jsonb`, and the person columns `created_by` / `updated_by` / `revoked_by` as `on delete set null`.
- One active (non revoked) share per source is enforced by three partial unique indexes, one per source column, `where <col> is not null and revoked_at is null`.
- The lifecycle is create, refresh, rotate, revoke, plus read time expiry, all through the single service role only RPC `manage_content_share`, which re derives the full authorisation from the passed actor id inside one transaction (actor club, sharing capability, source capability, source ownership, source club, aggregate rights, kill switch) and is the final authority. `auth.uid()` is null under the service role, so the RPC never uses `has_perm`; it reads `member_roles` and `role_capabilities` and the source row directly by the passed actor id.
- `content_share_dependencies` is the private reverse index (RLS on, no client policy), one row per nested entity a share depends on, `dependency_kind` one of `drill`, `template`, `programme`, `media`, `board`, `dependency_id` with deliberately no foreign key, unique per `(share_id, dependency_kind, dependency_id)`, indexed on `(club_id, dependency_kind, dependency_id)` for the reverse lookup.
- CONFIRMED CURRENT STATE, drill only: `read_public_share` refuses any non drill kind, and there is no generic renderer that could expose another source kind. Public session and programme sharing are Content Sharing PR 3 and PR 4, not yet built.

### 3.2 Rights classification and the aggregate block rule exist

CONFIRMED CURRENT STATE (`0038_content_sharing.sql`, `docs/security/content-sharing-boundary.md`).

- `content_rights` is a Postgres enum, `internal_only` / `public_link_only` / `public_full`, carried by `media`, `drills`, `sessions`, `programmes` and `templates`, `not null` with a fail closed default of `internal_only`.
- The backfill promoted only club original content with no third party source evidence (`source_url IS NULL AND source_label IS NULL`, and for drills `source_key IS NULL`) to `public_full`; every media row and every FA derived or third party sourced row stayed `internal_only`.
- One restricted nested item blocks the whole share: create and refresh resolve the full dependency set and refuse the share if the source or any nested rights bearing item is `internal_only` or if a referenced entity is missing (fail closed). Restricted content is never silently omitted.
- A rights downgrade to `internal_only` invalidates every dependent active share in the same transaction through `after update of rights` triggers, found through the source columns and the reverse dependency index, never by a global sweep. PR 2's read path adds a third layer by verifying dependency eligibility on every read.

### 3.3 Capabilities, kill switch and audit exist

CONFIRMED CURRENT STATE.

- Two sharing capabilities are live, taking the catalogue to 22 keys: `shares.create` (create and manage your own eligible shares) and `shares.manage` (club wide oversight, revoke any club share). Grants: admin both, manager both, coach `shares.create`, parent neither. `shares.manage` is not a reserved administrative capability.
- `clubs.public_sharing_enabled` is a `not null` boolean defaulting `false`. Public sharing is off on every club until an admin turns it on. Create, refresh and rotate fail closed while off; revoke stays allowed; the public read fails closed while off.
- Audit actions are registered in the private writer `log_content_share_event`: `content_share.created`, `content_share.refreshed`, `content_share.rotated`, `content_share.revoked`, `content_share.invalidated`, and `content_share.expired` (for the deferred scheduled cleanup). `entity_type` is `content_share`. The metadata allow list `content_share_metadata_ok` admits only `source_kind`, `source_id`, `expiry_state`, `reason_code`, `initiator`, each a bounded vocabulary or a uuid. No secret, hash, snapshot, title or free text can enter the audit log.

### 3.4 The two Edge Functions and the shared builder exist

CONFIRMED CURRENT STATE.

- `manage-content-share` (verify_jwt on) authenticates the caller, makes an early `has_perm` check, derives club and source authority server side, builds the snapshot server side through the pure builder, generates the raw secret only on create or rotate, hashes it before passing to the RPC, and calls the service role lifecycle RPC which is the final authority. It never accepts `club_id`, an actor id or a snapshot from the body.
- `read-content-share` (verify_jwt off, declared in `config.toml`) is the first and only anonymous function. It holds the service role and reaches the database only through the narrow `read_public_share` SECURITY DEFINER function. It accepts only `shareId` and `secret`, returns only the stored snapshot with a short lived (ten minute) signed URL per eligible media, sets `Cache-Control: no-store` and security headers, locks CORS to `APP_ORIGIN`, and returns an identical neutral `{ status: 'unavailable' }` for every lifecycle failure.
- `supabase/functions/_shared/share.ts` holds the pure snapshot builder (`buildDrillSnapshot`), the recursive allow list scanner (`assertAllowlistedKeys`, `assertNoForbiddenKeys`), the snapshot version pin (`SNAPSHOT_VERSION = 1`), and free text sanitisation, all with Deno tests. Both functions and the unit suite exercise the same code.

### 3.5 The list UIs have no multi-select and no list level share

CONFIRMED CURRENT STATE.

- The Drill Library (`src/routes/Library.tsx`) renders a grid of `DrillCard`s. A card carries at most an inline Edit button and a Delete icon for a manager or the owner. There is no overflow (kebab) menu, no selection checkbox, no multi-select mode, and no Share affordance on a card. Public sharing is reached only by opening the drill.
- The Sessions list (`src/routes/Sessions.tsx`) renders `SessionCard`s with Open, Live, Plan, an `.ics` download and a Delete. No selection, no share.
- The Programmes list (`src/routes/Programmes.tsx`) renders `ProgrammeCard`s that open the programme. No selection, no share.
- The internal club link Share button (`src/components/ShareButton.tsx`, `kind` one of `session` / `drill` / `programme`) copies or natively shares a protected club URL and lives on the detail pages, not the lists.

Implication carried forward: multi-select is a genuinely new UI mode to add to the lists; there is no existing selection state to extend, and a list level single item Share is itself new.

### 3.6 What does not exist

CONFIRMED CURRENT STATE. There is no collection, pack, bundle, playlist or multi item share anywhere in `src` or the migrations. There is no `share_packs` or `share_pack_items` table. There is no ordering field for a set of shared items. There is no list multi-select. `read_public_share` handles exactly one kind (`drill`). The next migration slot is provisional: disk ends at `0039`, the Registered Players programme reserves the provisional band 0031 through 0037, so a sharing pack migration is provisional at 0040 and beyond at the time of writing. Confirm the next free number against the live hosted ledger at apply time; never assume it from the highest file on disk.

## 4. Terminology

Used precisely throughout, and recommended for the product where a coach facing term is needed.

- SHARE PACK: an ordered collection of eligible club content published as one unlisted read only public link. The recommended product name is decided in section 19 decision 1 (Share Pack, Collection, Coaching Pack or Resource Pack); this document uses "Share Pack" or "pack" throughout.
- PACK ITEM: one entry in a pack, a reference to an existing content entity (a drill in v1) plus its position in the order.
- PACK DRAFT: the editable, authenticated side collection before it has a public link, or while its published link is stale relative to later edits.
- PUBLISHED PACK: a pack that currently has an active `content_shares` row and therefore a live public link.
- PACK SNAPSHOT: the frozen safe public projection of a published pack, stored on its `content_shares` row exactly as a single item snapshot is, versioned and rebuilt only on an explicit Refresh.
- The engineer terms Refresh, Rotate and Revoke keep the plain language coach labels the existing control already uses ("Update what people see", "Replace this link", "Turn off this link", `src/components/PublicShareControl.tsx`).

A Share Pack is distinct from the two existing aggregates. A SESSION is a timed plan for one training slot with phases and durations. A PROGRAMME is a multi week curriculum of templated weeks. A SHARE PACK is neither: it is a flat ordered list assembled for sharing, with no schedule, no phase timing and no weekly structure. Section 5 makes the "which should I create" decision explicit so packs do not become a confusing replacement for sessions or programmes.

## 5. When to create a session, a programme, or a Share Pack

RECOMMENDED DEFAULT for the product's own guidance copy, so a coach reaches for the right tool and packs do not erode the existing structures.

- Create a SESSION when the content is a plan for one training slot: an ordered set of activities with phases and durations that adds up to a session length, to run on the touchline or save to the calendar. A session has timing and is drivable in live mode. It is not a Share Pack.
- Create a PROGRAMME when the content is a multi week curriculum: a named focus delivered across a sequence of weeks, each week a template. A programme has weekly structure. It is not a Share Pack.
- Create a SHARE PACK when the content is a curated list you want to hand to someone as one link, with no schedule and no weekly structure: a themed drill set, a warmup set, a reference list for a meeting or another coach. A pack is for sharing, not for running or planning.

Guardrails so packs stay a sharing tool, not a planning tool:

- A pack has no durations, no phases, no live mode, no calendar entry. If a coach needs timing, they want a session; the builder offers "Build a session from these instead" as an escape hatch (a future convenience, section 18).
- A pack is not editable by the recipient and is never a working document; it is a read only published list. Collaborative or editable packs are explicitly out of scope (section 8, and the same rejection the Content Sharing roadmap makes of collaborative editing).
- The builder copy states plainly what a pack is for, so a coach does not build a "session" out of a pack or vice versa.

## 6. Personas and journeys

Each journey states its role behaviour, per the CLAUDE.md convention.

### 6.1 A coach shares a warmup set (coach, owner of the drills)

- The coach is in the Library. They enter multi-select, tick five warmup drills, and choose Create Share Pack.
- They order the five, add a title ("Saturday warmups") and an optional line of introduction.
- They see the exact combined public preview: the five drills in order, exactly what an external viewer will see, with any blocked item named.
- They confirm, and receive one public link. They Copy or natively share it.
- Later they can update what people see (Refresh), replace the link (Rotate), or turn it off (Revoke), and they can edit pack membership and re-publish.

Role behaviour: the coach holds `shares.create`, and holds share authority over each included drill (owns it with `drills.create`, or holds `drills.manage`), per section 12. Every drill is `public_full` eligible or the pack is blocked.

### 6.2 A coordinator assembles "ideas for U9 coaches" (coach or manager)

- The coordinator gathers a dozen eligible club original drills into a pack, orders them, titles it, and publishes one link for the U9 group.
- The link is read only and revocable. When the season moves on, they revoke it.

Role behaviour: same as 6.1. If the coordinator wants to include drills owned by other coaches, section 12's owner decision governs whether that is allowed (recommended safe default: only content the coordinator is authorised to share individually).

### 6.3 A manager oversees and revokes a pack (manager)

- A manager holding `shares.manage` sees the club's active packs in the shared links management screen (the same screen Content Sharing PR 5 introduces), with each pack's status, item count, resolved title and `shareId`.
- The manager can review the redacted stored snapshot and revoke any club pack. The manager cannot rotate or refresh another coach's pack, nor silently take it over.

### 6.4 An external recipient opens a pack (no account)

- No OTJ account is required. No app navigation, admin shell or protected query is initialised.
- The page lists the pack's items in order, mobile first and printable, with a table of contents for a larger pack.
- Invalid, expired, revoked, kill switch off and ineligible all show the same neutral unavailable state. The page does not reveal whether a link once existed.

## 7. Product scope: the staged content approach

RECOMMENDED DEFAULT: a drill only first release, then a staged widening, exactly the sequencing the Content Sharing programme used for its own vertical slices. Do not assume mixed content belongs in v1.

Likely first release:

- Drill only Share Packs. A pack contains an ordered set of drills. Each drill projects through the existing `buildDrillSnapshot`, so the pack snapshot is a list of the projection single item sharing already produces and tests. This reuses the most proven part of the substrate and needs no new per item snapshot logic.

Future possibilities, each a FUTURE OPTION assessed in section 18:

- Drills plus sessions in one pack, once public session sharing (Content Sharing PR 3) exists and the session snapshot builder is proven.
- Mixed content (drills, sessions, programmes) once all three public snapshot builders exist.
- Programmes inside a pack, the largest aggregate, last.
- Internal only club packs: a pack that requires club login and may therefore include `internal_only` items, reusing the club link model rather than the public one (section 11, a distinct product from a public pack).
- Printable or exportable packs, once export (Content Sharing PR 6) exists.

Explicit non-scope for v1 (RECOMMENDED DEFAULT, view only, drill only, one link):

- Mixed content packs (drills plus sessions or programmes). Deferred until the relevant public snapshot builders exist.
- Recipient accounts, recipient email collection, comments, public editing, public search or a public library, per view tracking of anonymous viewers, and any viewer identity. These carry the same rights, privacy and safeguarding risks the Content Sharing roadmap already excludes, and a pack changes none of that calculus.
- Bulk creation of many independent links (section 10 assesses and rejects this as the default).
- Duplicating a pack, password protected packs, and audience specific pack links. Recorded as future options in section 18.

## 8. Recommended UX

The design reuses the existing primitives: the shared `Modal`, the existing public share preview body and result view, the plain language lifecycle labels, and the public page renderer. The new surfaces are multi-select on the lists, a pack builder, and an ordered public pack page.

### 8.1 List level single item Share shortcut (the on ramp)

RECOMMENDED DEFAULT. Add a per card overflow (kebab) affordance on the Library drill cards (and, once Content Sharing PR 3 and PR 4 land, on Session and Programme cards) that offers Share for that one item.

- The list level Share is a shortcut for one item only. It launches the same preview and confirmation flow used from the detail page (the existing `PublicShareControl` preview, rights warning, confirm and result), not a separate lighter flow.
- There is no instant publishing from the list. A coach never creates a public link from a list without first seeing the exact public preview and confirming, exactly as from the detail page. This is the single most important rule for this surface.
- Because public sharing is drill only today, the list shortcut is drill only until the corresponding public session and programme sharing exist. The Session and Programme list shortcuts are gated on Content Sharing PR 3 and PR 4 respectively; until then a list level Share on those cards offers only the internal club link (the existing `ShareButton`), never a public link that the backend cannot yet read.

This shortcut is independently useful and is the natural place a coach discovers multi-select ("share several of these at once"). It is Share Packs PR 0.

### 8.2 Multi-select mode on the lists

RECOMMENDED DEFAULT. Add an explicit multi-select mode to the Library first (drill only v1), and later to the Sessions and Programmes lists.

- A "Select" toggle enters selection mode; each card gains a checkbox; a selection bar shows the selected count and a "Create Share Pack" action.
- Eligibility is shown per selected item as it is selected: an item that is `internal_only` (an FA drill, unclassified media) is marked not shareable, with a plain reason ("Uses England Football content"), so a coach sees before building that some ticks cannot go into a public pack. This mirrors the existing preview's blocked reason copy.
- A blocked item does not silently drop out of the selection; it is shown as blocked so the coach can deselect it or understand why the pack cannot publish (section 9's fail closed rule).
- Select all is bounded, never unbounded: it selects at most the pack item cap (section 13), and if the filtered list exceeds the cap it selects the cap and says so, rather than silently selecting everything. This is both a usability and an abuse control.
- Mobile behaviour: selection mode is one handed, the selection bar is fixed and thumb reachable, the checkbox targets are at least 44px, and entering and leaving selection mode is a single clear control.

### 8.3 The pack builder

RECOMMENDED DEFAULT. After "Create Share Pack", a builder opens on the existing `Modal` primitive (`dismissible` while not writing), holding the pack draft.

- Reorder the selected items (drag on desktop, up and down controls on mobile and for keyboard and screen reader users; ordering is a first class accessible action, not drag only).
- Remove an item.
- Add a title (required, bounded length, section 13) and an optional introduction (bounded length).
- A rights warning identical in spirit to the single item one: the title and introduction are coach authored free text and will be public, and the "club's own work or cleared for public use" confirmation applies to them exactly as it does to a drill's free text (section 11). The preview marks the free text group.
- The exact combined public preview: the pack rendered as the external viewer will see it, in order, using the same public renderer the live page uses, so preview and published output cannot drift. A blocked item is named in the preview and blocks publication.
- Choose the expiry (the existing default, section 13).
- Confirm publication, with the same honest confirmation the single item flow uses ("Anyone you send this to can open it with no login, and can pass it on. It works until you turn it off or it expires").

The builder distinguishes clearly, in its copy and layout, between editing the pack (the draft, an authenticated side change) and refreshing the public snapshot (republishing what people see). This distinction is load bearing and is stated in section 12.

### 8.4 Managing a published pack

RECOMMENDED DEFAULT. A published pack is managed exactly like a single item share, through the same plain language controls, plus the pack specific membership editing.

- Update what people see (Refresh): rebuilds the pack snapshot from the current pack draft and its current items, rechecks rights, keeps the same link.
- Replace this link (Rotate): new secret, same snapshot and membership, old link dies instantly. Owner only, never a manager on another coach's pack.
- Turn off this link (Revoke): the public read returns the neutral unavailable response, the snapshot and dependency rows are cleared, the pack draft is retained so the coach can re-publish later if they choose. Owner, or any `shares.manage` holder for oversight.
- Edit pack membership: add, remove or reorder items in the draft. This does not change what is public until Refresh (section 12).
- A stale snapshot indicator: when the draft differs from the published snapshot (an item was added or reordered since the last publish), the management surface shows "The public link does not yet show your latest changes. Update what people see to publish them." This makes the edit versus refresh distinction visible rather than surprising.
- A club wide management view for `shares.manage` holders reuses the Content Sharing PR 5 shared links screen, adding pack rows (kind, status, item count, resolved title, `shareId`), the redacted stored snapshot review, and Revoke. It is a new row type on an existing screen, not a new screen.

### 8.5 The public pack page

RECOMMENDED DEFAULT. The public pack page reuses the public route (`/share/:shareId`, code split, outside the authenticated tree) and the public renderer, adding an ordered multi item layout.

- Mobile first, no app shell, no authenticated provider, no private identifiers, exactly as the single item public page.
- The pack title and optional introduction at the top; then the items in order.
- A table of contents for a larger pack (jump links to each item), shown above a threshold item count, so a viewer can navigate a dozen drills.
- Continuous scroll of the ordered items is the RECOMMENDED DEFAULT rendering (one item after another), with a table of contents for navigation, over a one item at a time paginated view; continuous scroll prints cleanly and needs no client state. One at a time is an ALTERNATIVE that suits a very large pack but complicates printing and accessibility.
- A print stylesheet so the pack prints usably from day one (the same minimal print discipline the single item public page adopts), with each item starting cleanly. Full print or PDF export is Content Sharing PR 6 territory and is deferred (section 18).
- Every failure (invalid, expired, revoked, kill switch off, an item now ineligible) shows the same neutral unavailable state; a transport failure shows a distinct retry state.

## 9. Rights and privacy model

RECOMMENDED DEFAULT: fail closed and aggregate, reusing the existing `content_rights` classification and the existing aggregate block rule unchanged. A pack introduces no new rights vocabulary and no new eligibility mechanism; it is a new aggregate evaluated from its parts, exactly as a session or programme is.

The aggregate rules, restated for a pack:

- Every source item in the pack must be eligible (`public_full`, or `public_link_only` where only a link representation is published).
- Every nested dependency of every item must be eligible (a drill's media, and later a session's drills and board, a programme's templates, drills, media and PDF).
- One `internal_only` item, at any level, blocks the entire public pack. England Football derived content is `internal_only` by default and therefore blocks a public pack that includes it. Unclassified media is `internal_only`.
- A missing referenced entity, or a cross club reference (an item uuid that does not resolve within the creator's club), blocks creation, fail closed. No cross club dependency row is ever recorded, matching the existing club scoped dependency resolution.
- A later rights downgrade of any included item to `internal_only` invalidates the pack through the reverse dependency index, in the same transaction as the downgrade, touching only the dependent packs, exactly as it invalidates single item shares today. Refresh and the read time dependency recheck are the second and third layers.
- No silent omission. A restricted item is never quietly dropped from an otherwise published pack. Dropping one FA diagram while the rest of the pack publishes would be exactly the "not made public" breach the rights model exists to prevent.

The three options the task asks to compare, and the recommendation:

- BLOCK THE WHOLE PACK when one item is restricted. RECOMMENDED DEFAULT. It is the existing behaviour, it is the safe fail closed default, and it needs no new per item substitution design. The coach is told which item blocked the pack and can remove it and re-publish.
- OMIT RESTRICTED ITEMS WITH A WARNING. REJECTED ALTERNATIVE for v1. Silent or semi silent omission risks a rights leak through an overlooked item and produces an incomplete pack the coach did not review; it also contradicts the existing aggregate rule. It could be reconsidered later only as an explicit, clearly marked "some items are not shown" product decision the owner approves, once the rights model is proven (section 19 decision 5).
- ALLOW INTERNAL ONLY CLUB PACKS for authenticated club users. ALTERNATIVE, recommended as a distinct future product, not as a relaxation of public packs. A club pack requires login, so it may include `internal_only` items because the recipient is an authorised club member and RLS is the boundary, exactly as a club link may include content a public link may not (section 11). This is a different object from a public pack and must never be confused with one; a public pack stays fail closed.

The recommended safest default is therefore: block the whole public pack on any restricted item; offer the internal club pack path (a future option) for content that cannot go public; never omit silently.

Free text on a pack: the title and introduction are coach authored free text and carry the same leak risk (a child's name, a team or venue name) as a drill's title or notes. They are subject to the same exact pre publish preview and the same "club's own work or cleared for public use" confirmation, and they are sanitised and rendered as text nodes exactly as the existing snapshot free text is. The preview marks them as the free text group.

## 10. The bulk independent-link alternative, assessed and rejected as the default

The task asks to explicitly assess, and likely reject, the naive alternative: selecting five drills and generating five independent public links.

REJECTED ALTERNATIVE as the default product. Disadvantages, each concrete:

- Five secrets instead of one. Five hashed credentials to hold, and five to leak.
- Mixed success. With five separate lifecycle writes, some can succeed and some fail (one drill is `internal_only`), leaving the coach with a partial, confusing result and no single thing to reason about. A pack is one atomic eligibility decision.
- Five previews. The coach reviews and confirms five times, or worse, publishes without reviewing each.
- Five expiry choices, five lifecycles. Nothing keeps them consistent.
- Difficult distribution. The recipient receives five links with no order, no title and no context, rather than one titled ordered page.
- Difficult revoke and rotation. Turning the set off means revoking five links; rotating means reissuing five. A pack is one revoke and one rotate.
- Confusing user feedback. There is no single status to show; the coach cannot see "the thing I shared" as one object.

The pack abstraction removes every one of these: one secret, one atomic eligibility decision, one preview, one expiry, one lifecycle, one distribution, one revoke, one status.

Bulk independent link creation is kept only as a possible FUTURE OPTION for a narrow administrative need (section 18), never as the default answer to "share several items", and only if a real justification appears. It is not part of this programme's v1.

## 11. Public versus internal (club) packs

RECOMMENDED DEFAULT: v1 delivers the PUBLIC pack (unlisted, login free, fail closed rights). The INTERNAL club pack is recorded as a distinct future option, not built in v1, and never conflated with the public pack.

- A PUBLIC pack is the object this roadmap designs: a `content_shares` row of kind `pack`, a snapshot, a hashed fragment secret, the public read path, fail closed aggregate rights. It can contain only eligible content.
- An INTERNAL club pack (FUTURE OPTION) would be a saved ordered collection shared as a protected club URL, opened by a signed in club member, with RLS as the boundary and no public snapshot. Because the recipient is an authorised club member, an internal pack could include `internal_only` content (FA drills) that a public pack must exclude, exactly as a club link may. It writes no public share row and creates no public boundary. It answers "I want to hand a colleague a curated list but it contains FA content", which the public pack cannot.

The two are deliberately different products with different boundaries. The v1 public pack is fail closed; the future internal pack reuses the existing club link safety (RLS, no anonymous read). This roadmap builds the public pack and records the internal pack as decision 10.

## 12. Lifecycle model: membership change, refresh and revision

The task asks for an explicit answer to what happens when pack membership changes. RECOMMENDED DEFAULT, and this is a load bearing decision:

- Editing pack membership does NOT automatically refresh the public snapshot. A pack draft is edited on the authenticated side; the public snapshot is frozen until the owner explicitly Refreshes ("Update what people see"). This mirrors the existing single item Refresh model exactly: a private edit never silently changes what the public sees.
- Editing pack membership does NOT invalidate the existing link. The link and its secret persist across membership edits; only the published snapshot is stale until Refresh. Invalidating the link on every edit would churn the secret and break distribution for no safety gain.
- A pack carries a REVISION counter. Each Refresh republishes the current draft as a new snapshot revision (the snapshot itself is versioned by `snapshot_version` for schema, and the pack carries its own content revision for "what did I last publish"). The revision is what the stale indicator (section 8.4) compares against to tell the coach the public link is behind the draft.
- Membership change plus a rights downgrade: if an item in the draft is later downgraded to `internal_only`, the published pack is invalidated immediately through the reverse dependency index (section 9), independent of any Refresh, exactly as single item shares are. Refresh then rebuilds and will block the pack if the downgraded item is still a member.

So the recommended explicit behaviour, stated once:

- Change pack membership: draft changes, public link unchanged, snapshot stale until Refresh.
- Refresh: rebuilds the snapshot from the current draft, rechecks rights, bumps the revision, keeps the link.
- Rotate: new secret, same snapshot and membership.
- Revoke: link off, snapshot and dependency rows cleared, draft retained.
- A rights downgrade of a member: immediate invalidation of the published link through the dependency index, regardless of Refresh.

REJECTED ALTERNATIVE: auto refresh on every membership edit. It would silently change what the public sees the instant a coach edits the draft, which is exactly the surprise the frozen snapshot model exists to prevent, and it would republish possibly half finished edits. The explicit Refresh is recommended.

REJECTED ALTERNATIVE: a new pack revision creates a new link and invalidates the old one on every edit. It multiplies links and breaks distribution; Rotate already covers the "I need a new secret" case deliberately.

## 13. Limits and abuse controls

RECOMMENDED DEFAULT, reusing the existing read function's caps and adding pack specific bounds. The pack read is served by the same internet facing `read-content-share` function, so it inherits that function's input caps, body size limit, POST only method allow list, single indexed row lookup, and best effort per worker rate limiter keyed by `shareId` and a hashed source IP (the raw IP is never stored or logged). The honest limitation the Content Sharing roadmap records still holds: that limiter is per worker and not globally durable; a durable distributed limit is a follow up.

Pack specific limits:

- Maximum items per pack: RECOMMENDED 32 (ALTERNATIVE 20), enough for a large themed set, bounded so the snapshot and the signing work stay small. Enforced in the builder and re-enforced in the snapshot builder; a create over the cap is refused, never truncated.
- Maximum snapshot size: a hard byte cap on the pack snapshot (RECOMMENDED 512 KiB, above the single item and programme figures because a pack is many drills, still bounded), enforced by the builder, reported rather than truncated.
- Maximum title length: RECOMMENDED 120 characters. Maximum introduction length: RECOMMENDED 2000 characters. Bounded so free text cannot grow unbounded and to keep the audit and preview small.
- No unbounded select all: select all selects at most the item cap (section 8.2).
- Request and rate limits: inherited from `read-content-share`; the management function inherits the authenticated function's posture.
- No arbitrary remote fetch: a pack references existing club entities by id only. It never fetches a remote URL, never follows a link, and never imports. The FA import boundary is untouched; a pack cannot trigger any outbound fetch.
- Safe media limits: media signing reuses the existing ten minute signed URL for the exact referenced paths only; a pack signs only the paths the definer function names from its validated snapshot, never a caller supplied path, and the per item media count is bounded by the item cap times the existing per item media handling.
- Expiry defaults: reuse the existing default (90 days, owner may shorten, `shares.manage` may allow none), possibly a per kind consideration if packs prove to be reused across a season (section 19 decision 6).
- Audit limits: pack lifecycle events carry only the bounded metadata the existing allow list permits (section 14); no title, introduction, item list, snapshot, secret or hash ever enters the audit log.

## 14. Audit model

The task asks whether pack events should be separate `share_pack.*` actions or whether the existing `content_share.*` actions can carry `source_kind=share_pack`.

RECOMMENDED DEFAULT: reuse the existing `content_share.*` actions with `source_kind = pack`, not a new action family, for the public link lifecycle. Rationale:

- A published pack IS a `content_shares` row (kind `pack`, section 15). Its create, refresh, rotate, revoke, invalidate and expire are the same lifecycle the existing actions already name, and `entity_type = content_share` already covers it.
- The metadata allow list `content_share_metadata_ok` already carries `source_kind` and `source_id`. Setting `source_kind = pack` and `source_id` to the pack id records the durable "who shared which pack, and when" that survives the source and share row deletion, with no new metadata key and no schema change (the writer's allow list is data, and `audit_events.action` has no check constraint).
- The security suite, the audit boundary document and the writer extend minimally: register `pack` as a valid `source_kind` value, and add the acceptance that a pack lifecycle emits the existing actions. No new reserved action to add to `app-audit-boundary.md` for the public link lifecycle.

The bounded action set for a pack's public link, all reusing the existing actions:

- `content_share.created` with `source_kind=pack`.
- `content_share.refreshed` with `source_kind=pack`.
- `content_share.rotated` with `source_kind=pack`.
- `content_share.revoked` with `source_kind=pack`.
- `content_share.invalidated` with `source_kind=pack` (rights downgrade of a member).
- `content_share.expired` with `source_kind=pack` (the deferred scheduled cleanup).

Draft pack editing is intentionally unaudited, matching the way club links are intentionally unaudited (no new public exposure to trace): creating, editing or reordering a pack draft that has no live public link writes no audit event. Only the public link lifecycle, which crosses the club boundary, is audited. If the owner later wants draft provenance, a minimal `share_pack.created` / `share_pack.updated` pair is an ALTERNATIVE (section 19 decision 9), assessed as probably not worth the log volume for v1.

Hard constraint, unchanged: no title, introduction, item list, snapshot, secret, hash, or any free text ever appears in audit metadata. The existing `content_share_metadata_ok` allow list already enforces this and needs no widening.

## 15. Data model

The task asks whether Share Packs need `share_packs`, `share_pack_items`, a `content_shares` row referencing a pack, an immutable snapshot, a snapshot version, an ordering field, title and introduction, creator and club ownership, a lifecycle state, a dependency index, and a revision, and warns against storing one row per selected link.

RECOMMENDED DEFAULT: two new small tables for the collection, plus a fourth `kind` on the existing `content_shares` for the one public link. One pack is one link; there is never a row per selected item in `content_shares`.

### 15.1 share_packs

A new private table holding the editable collection and its identity.

- `id` uuid primary key.
- `club_id` uuid not null, references `clubs(id) on delete cascade`, derived server side from the creator, never from the client.
- `title` text not null, bounded length (section 13).
- `intro` text null, bounded length.
- `created_by` uuid references `profiles(id) on delete set null` (so removing a creator is never blocked, matching the existing person columns).
- `updated_by` uuid references `profiles(id) on delete set null`.
- `revision` integer not null default 1, bumped on each Refresh (the content revision that the stale indicator compares against, section 12).
- `created_at`, `updated_at` timestamps.
- No `snapshot` here: the snapshot lives on the `content_shares` row, so there is exactly one authoritative public projection and one lifecycle owner.
- Direct access posture: RECOMMENDED to keep `share_packs` and `share_pack_items` private and reached through the service role gated management function, consistent with `content_shares`, OR, as an ALTERNATIVE, give them a club scoped authenticated RLS policy like other content (a pack draft is club content and holds no secret). This is section 19 decision 8. The stronger default (no client policy, function mediated) keeps the whole pack pipeline behind the service role exactly as `content_shares` is; the lighter alternative treats a draft like any other club content and only the public link stays private. Recommended: private, function mediated, for uniformity with the rest of the sharing substrate, unless the builder's read and write chattiness makes a club scoped RLS draft materially simpler, in which case the draft (never the snapshot, never the secret) may be a normal club scoped table.

### 15.2 share_pack_items

A new private table holding the ordered membership.

- `id` uuid primary key.
- `pack_id` uuid not null, references `share_packs(id) on delete cascade` (deleting a pack removes its items).
- `club_id` uuid not null, references `clubs(id) on delete cascade`, derived server side, for tenancy scoping and index locality.
- `item_kind` text not null, `drill` in v1, with a check constraint; the enum widens to `session`, `programme`, `media` only when those content kinds are supported in a pack (section 7).
- `item_id` uuid not null, the referenced entity id. No foreign key, deliberately, matching `content_share_dependencies`: a referenced entity may be deleted while the item row is used to decide the pack must be rebuilt or blocked; deletion is handled explicitly, not by a cascade on this column.
- `position` integer not null, the order within the pack.
- `created_at` timestamptz not null default now().
- Unique per `(pack_id, item_kind, item_id)` so an item appears once, and a stable ordering key on `(pack_id, position)`.

### 15.3 The content_shares extension

RECOMMENDED DEFAULT: extend, do not fork. Add a fourth nullable source column and a fourth kind, so the entire existing lifecycle, credential, kill switch, audit and read machinery applies to a pack unchanged.

- Add `pack_id uuid null references share_packs(id) on delete cascade` to `content_shares`.
- Extend `kind` to allow `pack`, and extend the exactly one check so exactly one of `drill_id`, `session_id`, `programme_id`, `pack_id` is non null and matches `kind`.
- Add a fourth partial unique index, `unique (pack_id) where pack_id is not null and revoked_at is null`, so a pack has at most one active public link, exactly as a source entity does.
- Everything else on `content_shares` is unchanged: `token_hash`, `idempotency_key`, `snapshot` (now a pack snapshot when kind is `pack`), the person columns, the lifecycle timestamps, the no client policy posture.

REJECTED ALTERNATIVE: a separate `pack_shares` table duplicating the credential, lifecycle, kill switch and audit wiring. It would fork the most security sensitive, most tested part of the system for no benefit and double the maintenance and the audit surface. The whole point of making a pack a `content_shares` kind is that the public boundary is proven and shared.

### 15.4 Dependencies

RECOMMENDED DEFAULT: reuse `content_share_dependencies` unchanged. A pack's `content_shares` row records, in the existing reverse index, every nested entity the pack depends on: each member drill (`dependency_kind = drill`), each member drill's media (`media`), and later each nested session, template, programme, board as the content scope widens. The existing `dependency_kind` vocabulary (`drill`, `template`, `programme`, `media`, `board`) already covers drill only packs (drill plus media) with no change; a pack member that is itself a session or programme reuses the same kinds for its nested entities. The existing rights downgrade trigger, the create and refresh `FOR SHARE` locking, and the read time dependency recheck therefore all apply to a pack with no new mechanism.

So the full data model is: two new tables for the collection (`share_packs`, `share_pack_items`), one additive column and one widened check and one new partial unique index on `content_shares`, and zero change to `content_share_dependencies`, the rights model, the capabilities, the kill switch, the credential, or the audit metadata shape. This is the smallest model that satisfies "one pack is one link".

## 16. Snapshot design

The task asks for one authoritative server side pack snapshot builder, a strict public allow list, ordered item projections, no internal identifiers, no storage paths, no arbitrary JSON pass through, snapshot size limits, a maximum item count, deterministic output, snapshot versioning, refresh semantics, and a rights recheck during refresh and public read.

RECOMMENDED DEFAULT, all reusing the existing builder module.

- ONE authoritative builder, `buildPackSnapshot`, added to `supabase/functions/_shared/share.ts` next to `buildDrillSnapshot`, pure, Deno tested, and called by both the management function (create, refresh, preview) and exercised by the unit suite. The preview and the create use the same builder so preview and published output cannot drift, exactly as the single item flow guarantees.
- ORDERED ITEM PROJECTIONS: the pack snapshot is `{ snapshotVersion, kind: 'pack', title, intro, items: [ ... ], snapshotAt }`, where each item is the existing per kind projection (in v1, the exact `buildDrillSnapshot` output) plus its position, so a pack is a titled ordered list of the projections single item sharing already produces and tests. No new per drill field logic; the pack reuses the proven drill allow list.
- STRICT ALLOW LIST: the pack snapshot is built by the same allow list discipline and validated by the same recursive scanner (`assertAllowlistedKeys`, `assertNoForbiddenKeys`) at every nesting level, so no key outside the allow list and no forbidden key (no `club_id`, `created_by`, real uuids, `storage_path`, `token_hash`, member id or name) reaches the payload, including inside each item projection.
- NO INTERNAL IDENTIFIERS: items carry a snapshot local id for ordering and table of contents anchors, never a real drill, media, pack or club uuid. Media paths ride in a private `_path` field the read path strips and signs, exactly as the single item snapshot does.
- NO ARBITRARY JSON PASS THROUGH: the builder copies named fields only; it never spreads a source row or a client supplied object into the snapshot. The title and intro are the only pack level free text and are sanitised and bounded.
- SNAPSHOT VERSIONING: the pack snapshot carries the same `snapshotVersion` pin (`SNAPSHOT_VERSION`), and the read path and public page refuse an unknown version. A pack snapshot's builder marker (for example `builder: 'pack@1'`) is stripped by the read path; a PR level placeholder is never publicly readable, matching the existing `builder: 'pending'` behaviour.
- DETERMINISTIC OUTPUT: given the same pack draft and the same source content, the builder produces byte identical output (items in `position` order, stable key order), so a Refresh that changed nothing produces the same snapshot and the tests can assert exact output.
- SIZE AND ITEM CAPS: the builder enforces the item cap and the snapshot byte cap (section 13) and reports rather than truncates; a pack that exceeds a cap is refused at build time with a clear reason, never silently shortened.
- REFRESH SEMANTICS: Refresh rebuilds the snapshot from the current draft and its current source content, rewrites the `content_share_dependencies` set to match, bumps the pack revision, and rechecks aggregate rights, failing closed if any member or nested item is now ineligible. This is the existing refresh contract with a pack shaped builder.
- RIGHTS RECHECK ON READ: `read_public_share` verifies every dependency of the pack is still eligible before returning the snapshot, returning the neutral unavailable response if any member or nested item is now ineligible or missing, exactly as it does for a single item share. So rights are checked at build, at downgrade, and at every public read, the same three layers.

## 17. Technical architecture and public URL

RECOMMENDED DEFAULT: reuse the existing public credential, route and read path with no change to their security shape.

- Public URL: `/share/:shareId#secret`, unchanged. A pack link is the same shape as a single item link; `shareId` is the pack's `content_shares` row uuid, the secret is the same 256 bit fragment secret, only its SHA-256 hash is stored, the raw secret is returned once on create or rotate, losing it requires rotation. There is one share id, one fragment secret, one stored hash, one expiry.
- Public route: `/share/:shareId` (code split, outside `RequireAuth`, `src/App.tsx`), unchanged. The public page component branches on the snapshot `kind` to render either a single drill or an ordered pack; both are the same route and the same anonymous, provider free page.
- Read path: `read_public_share` gains a `pack` branch that verifies the hash, `revoked_at`, `expires_at`, the kill switch, and every dependency's eligibility, then returns the versioned pack snapshot and the list of eligible media paths to sign. The narrow definer function stays the single auditable read path; the function still signs only the paths it names from the validated snapshot, never a caller supplied path.
- Manage path: `manage-content-share` gains the pack actions (preview, create, refresh, rotate, revoke, status for kind `pack`), building the pack snapshot server side through `buildPackSnapshot`, resolving every member and nested entity server side, evaluating aggregate rights server side, and calling the existing service role lifecycle RPC. The RPC re validates the full authorisation (actor club, sharing capability, per item source authority, source club, aggregate rights, kill switch) inside the transaction; it never trusts a client built snapshot or item list.
- Kill switch: `clubs.public_sharing_enabled` gates pack create, refresh, rotate and read exactly as it gates single item sharing. A pack is off on every club until an admin turns public sharing on, and the hosted default stays off until a separate explicit approval.
- Lifecycle changing pack membership does not automatically refresh the public snapshot, requires an explicit Refresh, bumps a pack revision, and keeps the existing link (section 12). The recommended explicit behaviour is stated there.

REJECTED ALTERNATIVE: a new public credential model or a second public read function for packs. It would create a second anonymous elevated endpoint to review and secure, doubling the most sensitive surface. One public read function, one credential model, one route.

## 18. Relationship to the existing roadmap and chronological placement

This is explicitly NOT Content Sharing PR 3, PR 4 or PR 5. It is a new programme.

- Public session and programme sharing should complete first. Content Sharing PR 3 (public session sharing) and PR 4 (public programme sharing) prove the multi item snapshot builder patterns a pack reuses when the content scope widens beyond drills, and PR 4's aggregate handling is the direct precedent for a pack's aggregate rights.
- Shared link management (Content Sharing PR 5) should exist first. It provides the club wide management surface a pack extends (section 8.4); a pack adds a row type, not a new screen.
- Shared link management provides reusable infrastructure: the management list, the redacted snapshot review, the departing member handling, the `shareId` lookup. A pack reuses all of it.
- Export could later render a pack. Content Sharing PR 6 (print and PDF export from the safe public projection) could, once it exists, render a pack's snapshot to a printable or PDF form. A pack ships a minimal print stylesheet from day one but defers full export to that programme.
- Copy and import remains separate. Content Sharing PR 7 (authenticated copy and import) is a distinct future programme; a pack does not copy content into another club and does not import.
- This roadmap must not block the current single item sharing rollout. It changes no existing sharing behaviour; Content Sharing PR 2 stays exactly as it is.

Recommended chronological placement: a new programme, Share Packs PR 0 to PR N, beginning after Content Sharing PR 5 (shared link management), running before or alongside Content Sharing PR 6 (export). The one part that can move earlier is Share Packs PR 0 (the list level single item Share shortcut, section 8.1), which is a small drill only improvement that belongs logically to the Content Sharing programme's public drill sharing and could ship within it as soon as public drill sharing is approved for hosted.

Shared file and slot coupling to manage, in the same spirit as the Content Sharing roadmap's portfolio section:

- Migration numbers: a pack migration is provisional at 0040 and beyond; confirm the next free slot against the live hosted ledger at apply time; treat a merged but unapplied file as taken. The Registered Players programme is consuming the 0031 to 0037 band. Reserve no number.
- `supabase/functions/_shared/share.ts` gains `buildPackSnapshot`; `read-content-share` and `manage-content-share` gain the pack branch. These are the same files Content Sharing PR 3 and PR 4 edit for sessions and programmes, so sequence the pack work after them to avoid churn on the builder.
- `src/App.tsx` and the public page gain a pack render branch; `src/lib/queries.ts` gains pack management hooks. Both are shared, heavily edited files; land the pack hooks in a clearly separated block.
- The capability catalogue is unchanged (no new capability, section 12), so the `capabilities.test.ts` count stays at 22 and there is no coupling with the Registered Players capability count for this programme.

## 19. Owner decision register

Each decision lists the recommended choice, the strongest alternative, and the trade off. These are the decisions this roadmap cannot make alone.

1. Product name: Share Pack, Collection, Coaching Pack, or Resource Pack.
   - Recommended: Share Pack. It says what it is (a pack you share) and pairs with the existing "Share" vocabulary.
   - Alternative: Collection (neutral, but overloaded), Coaching Pack or Resource Pack (warmer, but longer). Owner choice; low implementation impact, a copy constant.

2. Drill only first release.
   - Recommended: yes, drill only in v1, widening to sessions and mixed content later once their public snapshot builders exist.
   - Alternative: include sessions from the start. Rejected for v1 because public session sharing is Content Sharing PR 3 and must be proven first.

3. Maximum items per pack.
   - Recommended: 32.
   - Alternative: 20 (tighter) or 50 (looser). Evidence that would change it: real packs that legitimately exceed the cap.

4. Does one restricted item block the whole public pack.
   - Recommended: yes, block the whole pack, matching the existing aggregate rule and failing closed.
   - Alternative: omit restricted items with a clear warning. Rejected for v1; reconsidered only as an explicit owner approved "some items not shown" design once the rights model is proven.

5. Does editing pack membership auto refresh the public link.
   - Recommended: no. Editing changes the draft; the public snapshot is frozen until an explicit Refresh, with a stale indicator. This mirrors single item Refresh and prevents silent public changes.
   - Alternative: auto refresh on edit. Rejected: it publishes possibly half finished edits and surprises the coach.

6. Expiry default for a pack.
   - Recommended: reuse the existing 90 day default, owner may shorten, `shares.manage` may allow none. Consider a longer default only if packs prove to be reused across a season.
   - Alternative: a distinct pack default. Evidence that would change it: a reuse pattern like the programme case.

7. Is mixed content allowed, and when.
   - Recommended: not in v1. Drills plus sessions once Content Sharing PR 3 lands; full mixed content once PR 3 and PR 4 land.
   - Alternative: mixed from the start. Rejected: it assumes builders that do not yet exist.

8. Direct database access for pack drafts: private and function mediated, or club scoped RLS.
   - Recommended: private and function mediated for uniformity with `content_shares`, unless builder chattiness makes a club scoped RLS draft materially simpler. The snapshot and the secret always stay private regardless.
   - Alternative: treat a pack draft as ordinary club content with a club scoped RLS policy, keeping only the public link private.

9. Are draft pack edits audited.
   - Recommended: no. Only the public link lifecycle is audited (through `content_share.*` with `source_kind=pack`), matching the intentionally unaudited club links; a draft with no live link creates no public exposure.
   - Alternative: a minimal `share_pack.created` / `share_pack.updated` pair for draft provenance. Assessed as probably not worth the log volume for v1.

10. Are internal only (club login) packs useful.
    - Recommended: record as a distinct future product, not a relaxation of public packs. An internal pack could include FA content because the recipient is an authorised member; it is a different object with a different boundary (RLS, no anonymous read).
    - Alternative: build the internal pack alongside the public one. Deferred; the public pack answers the originating workflows and the internal pack widens scope.

11. Does the pack use the existing `content_share.*` audit actions with `source_kind=pack`, or a new `share_pack.*` family.
    - Recommended: reuse `content_share.*` with `source_kind=pack`, since a published pack is a `content_shares` row and the metadata allow list already carries `source_kind`; minimal schema and test change.
    - Alternative: a separate `share_pack.*` family. Rejected: it forks the audit surface for an object that is a kind of share.

12. Does list level single item Share appear before full Share Packs.
    - Recommended: yes. Share Packs PR 0 (the list level single item Share shortcut) is small, safe and independently useful, and it is the on ramp to multi-select. It can even ship within the Content Sharing programme's public drill sharing.
    - Alternative: ship the list shortcut only as part of the pack programme. Recommended against; the shortcut has standalone value.

13. Do public packs include club branding.
    - Recommended: yes, the same club name, motto and single club crest the single item public page shows, with the same multi tenant caveat (a per club crest before any multi club deployment). No new branding decision beyond the one Content Sharing already records.
    - Alternative: omit branding on a pack. Owner choice; branding helps a recipient trust the link.

14. Can viewers print a pack.
    - Recommended: yes, a minimal print stylesheet from day one (continuous scroll prints cleanly), with full print or PDF export deferred to Content Sharing PR 6.
    - Alternative: no print in v1. Recommended against; a printed pack is a natural coaching artefact and a print stylesheet is cheap.

15. Can packs be duplicated.
    - Recommended: not in v1. Duplicating a pack is a convenience (start a new pack from an existing one) with no safety impact but added surface; defer.
    - Alternative: allow duplication from the start. Low priority future option.

16. Chronological placement relative to shared link management and export.
    - Recommended: a new programme after Content Sharing PR 5 (shared link management), before or alongside PR 6 (export), with Share Packs PR 0 (list shortcut) able to move earlier.
    - Alternative: fold packs into the Content Sharing programme. Rejected: packs are a distinct, sizable programme and deserve their own PR arc, though PR 0 belongs with public drill sharing.

## 20. Threat model

The pack inherits the full Content Sharing threat model (that document's section 23) because it reuses the credential, the read path, the kill switch, the rights model and the audit. Only the pack specific threats are called out here; the inherited ones (secret in logs, anonymous read of a content table, media path correlation, stale snapshot, capability revoked mid flight, cross club reference, board `playerId` leak) are unchanged and already mitigated by the reused substrate.

Pack specific threats and mitigations:

- A coach includes another coach's content in a public pack without authority. Mitigation: per item share authority (section 12); the lifecycle RPC re validates that the actor is authorised to share each member item inside the transaction, so a pack cannot bypass source level permissions. Section 19 decision governs whether the default is strict (own or manage each item) or looser (any eligible club content); the recommended default is strict, fail closed.
- One restricted item leaks through an otherwise eligible pack. Mitigation: the aggregate block rule (section 9), enforced at build, at downgrade through the reverse index, and at every read; no silent omission.
- Free text in the title or introduction leaks a child, team or venue name. Mitigation: the exact pre publish preview marking the free text group, the "club's own work or cleared for public use" confirmation, sanitisation, and rendering as text nodes; the same control the single item free text uses, plus the audit never carrying the title or intro.
- A large pack is used to amplify anonymous load or signing work. Mitigation: the item cap, the snapshot size cap, bounded media signing for named paths only, and the read function's input and rate limits (section 13).
- An edited draft silently changes what the public sees, or a stale public link misleads the coach. Mitigation: the explicit Refresh model and the stale indicator (section 12); membership edits never auto publish.
- A pack member deleted or downgraded after publication serves a broken or restricted item. Mitigation: the read time dependency recheck returns the neutral unavailable response rather than a partial or broken pack, and a downgrade invalidates the pack immediately through the reverse index.
- Two anonymous pack links from the same club are correlated through the club uuid embedded in a signed media URL. Mitigation: the same honest residual the Content Sharing roadmap records (a low impact cross share correlation handle, not a name); copying or content addressing media to remove it is deferred past v1, identically to single item sharing.

## 21. Testing strategy

RECOMMENDED DEFAULT, extending the existing harness, not replacing it.

- Unit and Deno tests for `buildPackSnapshot`: exact ordered output for a known pack (deterministic), the item cap and snapshot byte cap enforced with a clear refusal, the recursive allow list and forbidden key scan over the whole nested pack payload (no `club_id`, `created_by`, real uuid, `storage_path`, `token_hash`, member id or name at any level), free text sanitisation of the title and intro, and the aggregate block when any member or nested item is `internal_only`.
- Security suite (`tests/security/`): a pack is a `content_shares` kind, so extend the existing content share tests to cover kind `pack`: the fourth partial unique index (one active pack link per pack), the exactly one check across four source columns, the RPC re validating per item share authority and aggregate rights and the kill switch, a parent refused, a cross club actor refused, and the new tables (`share_packs`, `share_pack_items`) carrying the intended access posture (no anon access; the chosen draft posture from decision 8). Prove rollback via `psql`, matching the existing pattern.
- Rights downgrade tests: downgrading a member drill or its media to `internal_only` invalidates exactly the dependent packs through the reverse index, in the same transaction, touching no other pack, and a subsequent Refresh blocks the pack.
- Read path tests: `read_public_share` for a pack returns the ordered snapshot with signed media only for named eligible paths, and returns the identical neutral unavailable response for invalid, revoked, expired, kill switch off, unknown version, an ineligible member, and a missing member, indistinguishably.
- Route and component tests: multi-select mode and the bounded select all, the builder (reorder including keyboard and screen reader ordering, remove, bounded title and intro, the blocked item path), the exact preview matching the published render, the stale indicator, and the management controls (owner Refresh, Rotate, Revoke; a manager Revoke but not Rotate or Refresh of another coach's pack).
- Audit tests: exactly one `content_share.*` event with `source_kind=pack` per successful lifecycle action, none on preview or draft edit, and no title, intro, item list, snapshot, secret or hash in metadata.
- Deploy discipline: both Edge Functions redeploy from files on disk with a byte for byte readback and the positive `verify_jwt` check (the pack read stays served by the existing anonymous `read-content-share`, every other function stays `verify_jwt = true`), matching the existing gated procedure.

## 22. Deployment and rollback

RECOMMENDED DEFAULT, matching the Content Sharing gated procedure.

- Docs only now. This branch changes no code, migration, function, hosted setting or production data.
- When implemented, the schema PR is a gated migration (provisional 0040+, confirm the live ledger at apply time) that is additive: it creates `share_packs` and `share_pack_items`, adds `pack_id`, the widened `kind` check and the fourth partial unique index to `content_shares`, and needs a confirmed restore window before apply even though it writes no data to existing rows (it adds a column and constraints).
- The Edge Function PR redeploys `manage-content-share` and `read-content-share` from disk with a byte for byte readback and the positive `verify_jwt` post deploy check. No new function is added; the pack rides the existing two.
- The per club kill switch (`clubs.public_sharing_enabled`) gates pack reads exactly as it gates single item reads. Hosted stays off on every club until a separate explicit approval, so a pack PR can merge without turning public sharing on anywhere.
- Rollback: the migration is additive and drops through the gated procedure with a confirmed backup (drop the two tables, the column, the check and the index). The builder change reverts by removing the `pack` branch from `buildPackSnapshot`, `read_public_share` and the two functions and redeploying with readback. The kill switch is the instant per club disable if a live pack must be stopped without a deploy.
- No auto merge for any pack PR that contains a migration, a public function change, a rights boundary or a public route change, matching the standing rule for the sharing programme.

## 23. Acceptance criteria for the programme

The Share Packs programme is delivered when:

- A coach can multi-select eligible drills, create a Share Pack with a title, an optional introduction and an explicit order, preview the exact combined public result, and publish one public link.
- The pack link is one `/share/:shareId#secret`, one hashed 256 bit fragment secret, one snapshot, one expiry, one lifecycle, one revoke, exactly as a single item link.
- The pack snapshot is built by one server side builder, matches a strict allow list at every nesting level (verified by the recursive scanner and the security suite), carries no internal identifier, storage path, secret, hash, member id or name, and is deterministic and versioned.
- The rights model is fail closed and aggregate: every item and nested dependency eligible, one `internal_only` item blocks the whole public pack, a missing or cross club reference blocks creation, FA content stays `internal_only`, and a later downgrade invalidates the pack through the reverse index. No silent omission.
- A pack is a `content_shares` row of kind `pack` pointing at `share_packs`, with `share_pack_items` holding the ordered membership; there is never a row per selected item in `content_shares`, and one active pack link per pack is enforced.
- Editing pack membership does not auto refresh the public link; an explicit Refresh republishes the snapshot, bumps the revision and keeps the link; a stale indicator shows when the draft is ahead of the published snapshot.
- The public pack page lists items in order, is mobile first, printable, has a table of contents for a larger pack, mounts none of the authenticated app, and returns the identical neutral unavailable response for every lifecycle failure.
- Coaches create packs from content they are authorised to share; managers and admins can revoke any pack and review its redacted snapshot but cannot rotate or refresh another coach's pack or take it over; parents cannot create or manage packs; the lifecycle RPC enforces it and the security suite pins it.
- Pack lifecycle actions are audited through the existing `content_share.*` actions with `source_kind=pack`, with no title, introduction, item list, snapshot, secret or hash in metadata; draft edits are unaudited.
- The list level single item Share shortcut launches the same preview and confirmation flow as the detail page, never publishes instantly from the list, and is drill only until public session and programme sharing exist.
- The bulk independent link approach is not the default; a pack is the recommended way to share several items.
- No pack PR that is gated auto merges; both Edge Functions are verified by byte for byte readback and the positive `verify_jwt` check; the hosted kill switch stays off until a separate explicit approval.

## 24. Explicit recommendation

Build Share Packs as a separate programme, after Content Sharing shared link management (PR 5), before or alongside export (PR 6), with the list level single item Share shortcut (Share Packs PR 0) able to move earlier alongside public drill sharing.

Ship drill only Share Packs first. Model a pack as two small private tables (`share_packs`, `share_pack_items`) plus a fourth `content_shares` kind (`pack`), reusing the entire existing public credential, lifecycle, kill switch, rights model, reverse dependency index, audit and public read path with no change to their security shape. Add one pack branch to the single shared snapshot builder and the single public read function; add no new public credential, no new anonymous function, and no new capability.

Make the rights model fail closed and aggregate (one restricted item blocks the whole public pack, no silent omission). Make membership editing require an explicit Refresh with a stale indicator and a pack revision, never an auto publish. Audit the public link lifecycle through the existing `content_share.*` actions with `source_kind=pack`, and leave draft edits unaudited like club links.

Defer mixed content, programmes in a pack, internal only club packs, pack duplication, full print and PDF export, and any bulk independent link creation. Take the twelve to sixteen owner decisions in section 19 before implementation begins, above all the product name, the drill only scope, the per item share authority default, and the block the whole pack rights default.

Stop here for human review. Do not implement Share Packs. Do not alter the existing single item sharing rollout.

## 25. Proposed PR sequence

The task proposes a sequence; this section adopts it where it is sound and improves it where the substrate makes a change worthwhile. Every gated PR is do not auto merge.

- SHARE PACKS PR 0: list level single item Share shortcuts. The overflow affordance on the Library drill cards launching the existing detail page preview and confirm flow, drill only, never an instant publish. Small, safe, independently useful, and the on ramp to multi-select. Improvement over the task list: this PR belongs logically to public drill sharing and can ship within the Content Sharing programme as soon as public drill sharing is approved for hosted, rather than waiting for the whole pack programme.
- SHARE PACKS PR 1: pack schema, rights and dependency substrate. The two new tables, the `content_shares` `pack` kind and its fourth partial unique index, the lifecycle RPC's pack authority and aggregate rights re validation, the reverse dependency reuse, the audit `source_kind=pack` registration, and the security harness additions. No builder, no public read, no UI. Gated migration. Improvement: because the rights model, dependencies, kill switch and audit are reused, this PR is materially smaller than the Content Sharing PR 1 was; it is mostly the two tables and the RPC's pack arm.
- SHARE PACKS PR 2: drill only pack builder and internal preview. Multi-select on the Library, the builder (reorder, remove, title, intro, bounded), the exact internal preview through `buildPackSnapshot`, and the aggregate block path. No public link yet (the builder previews and can save a draft, but publishing is PR 3), so this PR ships with no anonymous surface.
- SHARE PACKS PR 3: public drill pack link. The `pack` branch in `read_public_share` and the two Edge Functions, the public pack page (ordered items, table of contents, print stylesheet), create and the one time link reveal, and the media signing reuse. Gated public function and route change with readback. Improvement: a rights coverage assessment step precedes this PR (a read only count of eligible club original drills, as the Content Sharing roadmap did before its session and programme slices), because most club drills are FA derived and therefore `internal_only`, so drill only packs may have thin eligible coverage; confirm with the owner that coverage justifies shipping.
- SHARE PACKS PR 4: pack management and editing. Membership editing on the draft, the explicit Refresh with the stale indicator and the pack revision, Rotate and Revoke reusing the existing controls, and the pack rows on the Content Sharing PR 5 shared links management screen (kind, status, item count, resolved title, `shareId`, redacted snapshot review, manager Revoke). Improvement over the task list: management and editing are one PR because a pack is inherently editable and the management surface already exists from Content Sharing PR 5; a separate editing PR would split one coherent surface.
- SHARE PACKS PR 5: session and mixed content evaluation. A scoping and design step (not necessarily a shipping PR) that assesses adding sessions, then mixed content, to a pack, once Content Sharing PR 3 and PR 4 have shipped the session and programme snapshot builders. It decides whether mixed content is worth the added rights and preview surface, per decision 7.
- SHARE PACKS PR 6: print and PDF integration. Reuses Content Sharing PR 6's export from the safe public projection to render a pack to a printable or PDF form, once that export exists. Deferred; the pack ships a minimal print stylesheet in PR 3 regardless.

The sequence challenge, stated plainly: the task's PR 4 ("pack management and editing") and its implied separate management step are merged here because Content Sharing PR 5 already provides the club wide management surface, so a pack adds a row type rather than a screen; the task's PR 1, PR 2 and PR 3 are smaller than their Content Sharing equivalents because the credential, rights, dependency, kill switch and audit substrate is reused rather than rebuilt; and a rights coverage assessment is inserted before the public link PR because FA content dominates the library and drill only packs may otherwise launch with little eligible content.
