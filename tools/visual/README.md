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

```
npx vite --config vite.visual.config.ts    # then open the printed URL
```

Query string, all optional:

| Key | Values |
|---|---|
| `screen` | `home`, `sessions`, `login`, `more`, `dialog`, `primitives` |
| `caps` | `coach` (default), `parent`, `viewer` |
| `theme` | `light` (default), `dark` |

`tools/visual/shoot.mjs` drives Chromium over the matrix and writes PNGs.
