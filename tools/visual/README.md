# Visual harness

A development only harness for the visual verification the VISUAL programme
requires. It is not part of the application: nothing under `src/` imports it,
`index.html` never reaches it, and `npm run build` does not include it.

It exists because the acceptance surfaces in
`docs/design/visual-design-read.md` cannot be opened in a browser without a
Supabase project and a signed-in club member, and a redesign that is only
inspected as source is not verified at all.

What it does: mounts the REAL route components, the REAL shell and the REAL
stylesheet, with the data layer replaced by fixtures. Everything a screenshot
shows is the component that ships; only the rows behind it are invented. No
real child, coach or club member appears in the fixtures.

Chromium and `playwright-core` drive it. `playwright-core` is deliberately
NOT a dependency of the application: install it on demand.

```bash
npm install --no-save playwright-core
node tools/visual/fetch-fonts.mjs                    # once: cache the two families

# to look at it
npx vite --config vite.visual.config.ts              # then open the printed URL

# to screenshot and check it
npx vite build --config vite.visual.config.ts
npx vite preview --config vite.visual.config.ts &
node tools/visual/shoot.mjs visual-shots             # one PNG per surface, width, theme and role
node tools/visual/checks.mjs                         # computed styles and live interaction
```

Build and preview rather than the dev server for the screenshots: the dev
server re-transforms two hundred modules on every page load, which turns a
hundred and thirty six shots into half an hour.

Query string, all optional:

| Key | Values |
|---|---|
| `screen` | `home`, `sessions`, `login`, `more`, `dialog`, `primitives` |
| `caps` | `coach` (default), `parent`, `viewer` |
| `theme` | `light` (default), `dark` |

`tools/visual/shoot.mjs` drives Chromium over the matrix and writes PNGs. It
fails, rather than degrading quietly, when it cannot earn its own result: no
font cache, a cache that does not actually load, a page that threw, or a
required interaction whose control has gone. A screenshot that is present,
plausible and wrong is worse than none.
