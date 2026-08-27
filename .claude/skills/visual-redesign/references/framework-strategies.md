# Framework strategies

Use the project's existing styling architecture before introducing another one.

## React / Vite

- Preserve component state, hooks, query/mutation code and route behavior.
- Prefer shared tokens and reusable presentation classes over rewriting component structure.
- Keep component keys, refs and conditional wrappers intact.
- If a class is used by tests or selectors, add a new presentation class rather than renaming it blindly.
- For shared shell changes, work through the existing shell components before touching route-level markup.

## Next.js

- Preserve server/client boundaries, server actions, route handlers, layouts and loading/error semantics.
- Do not add `use client` merely to enable a visual effect.
- Keep metadata and accessibility behavior intact.
- Prefer CSS and existing component primitives over adding client state for animation.

## Tailwind

- Reuse theme tokens and existing utility conventions.
- Consolidate repeated arbitrary values into theme variables/components when the redesign establishes a repeated rule.
- Do not convert an entire CSS codebase to Tailwind as part of a visual redesign unless explicitly requested.
- Keep conditional class logic intact; change only presentation values where safe.

## Bootstrap

- Keep behavior supplied by Bootstrap JS where it is relied upon.
- Prefer a scoped theme/override layer before replacing working components.
- Remove obvious default appearance through variables and component overrides rather than rewriting product behavior.

## CSS modules / SCSS

- Centralise repeated tokens in the project's existing variables/theme location.
- Keep module boundaries where they help avoid leakage.
- Avoid deep specificity escalation; prefer clearer component/state selectors.

## CSS-in-JS

- Reuse the existing theme provider and token system.
- Do not introduce a second styling runtime.
- Keep dynamic values that encode actual behavior separate from visual-only properties.

## Component libraries

When the app uses an established component library:

1. inspect theme/customisation APIs;
2. use tokens/variants first;
3. wrap only where a repeated product-specific pattern is needed;
4. avoid forking library components merely to change appearance;
5. preserve accessibility behavior supplied by the library.

## Vanilla CSS

A redesign can be high quality without a framework. Prefer:

- CSS custom properties for tokens;
- a small consistent type/spacing scale;
- component and state classes;
- modern layout with flex/grid;
- `clamp()` where fluid scale is genuinely useful;
- logical properties where helpful;
- explicit focus-visible states;
- media queries driven by content/layout needs rather than device names.

## Presentation-only markup additions

A new wrapper or decorative element is acceptable only when:

- existing logic does not depend on child position;
- refs/test selectors are unaffected;
- semantics remain valid;
- the addition has no new product state;
- CSS alone cannot reasonably produce the target result.

When uncertain, do not restructure. Style the current DOM.

## Dependency rule

Do not add a package for a visual effect that CSS or an already-installed library can deliver adequately. Any new dependency should have a clear product benefit, not simply make the redesign easier for the implementer.
