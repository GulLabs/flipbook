# flipbook

**The maintained page-flip.** A modern fork of StPageFlip + react-pageflip with the mobile back-curl finally fixed.

<p align="center">
  <img src="docs/images/hero.jpg" alt="Hardcover picture book mid-curl: the current leaf peels away and the previous illustration is already there underneath." width="100%">
</p>

Forked from [Nodlik/StPageFlip](https://github.com/Nodlik/StPageFlip) and [Nodlik/react-pageflip](https://github.com/Nodlik/react-pageflip) (both MIT), merged and maintained by [GulLabs](https://github.com/GulLabs). Upstream notices live in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

<p align="center">
  <a href="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml"><img src="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./packages/core/LICENSE"><img src="https://img.shields.io/badge/core-MPL--2.0-blue.svg" alt="core: MPL-2.0"></a>
  <a href="./packages/react/LICENSE"><img src="https://img.shields.io/badge/react-MIT-blue.svg" alt="react: MIT"></a>
  <img src="https://img.shields.io/badge/core-zero%20runtime%20deps-0f172a.svg" alt="Zero runtime dependencies">
</p>

On a phone, a back swipe must curl the **current** leaf away and show the previous leaf underneath. Upstream slides the previous page in from the left. That is the bug this fork exists to kill — in the engine, not with a monkey-patch.

---

## Packages

| Package                                       | Path             | Role                                                               |
| --------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| [`@gullabs/flipbook-core`](./packages/core)   | `packages/core`  | Framework-agnostic curl engine (HTML + canvas). Zero runtime deps. |
| [`@gullabs/react-flipbook`](./packages/react) | `packages/react` | React 18/19 binding. `react` peer `>=18`.                          |

---

## Portrait is a peel, not a slide

<p align="center">
  <img src="docs/images/phone.jpg" alt="Child holding a phone; the on-screen picture-book leaf curls away to the right like paper, fox illustration remaining underneath." width="420">
</p>

One 2:3 leaf. Swipe left for next, right for previous. Back must peel the page you are looking at. Hard covers stay hard. Reduced motion makes the turn instant instead of throwing.

On a desk, the book is a two-leaf spread. Mouse and corners work the way the vendor always did.

<p align="center">
  <img src="docs/images/desk.jpg" alt="Open landscape picture book on a walnut desk, two-page forest-to-meadow spread, a mouse cursor folding the top-right corner." width="100%">
</p>

---

## Opaque paper

<p align="center">
  <img src="docs/images/fold.jpg" alt="Macro of a turning leaf: cream paper is fully opaque, watercolor printed on the surface, nothing ghosting through from below." width="100%">
</p>

The fold and its temporary copy fill with `pageBackground` (default `#fff`). Underlying type does not bleed through the curl.

---

## Why this fork

| Bug                                                                          | Upstream                                                                                                              | Fixed in |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Portrait back-curl slides in instead of peeling the current leaf             | [StPageFlip #49](https://github.com/Nodlik/StPageFlip/issues/49), [#9](https://github.com/Nodlik/StPageFlip/issues/9) | 3.0.0    |
| Fold is transparent; underlying text bleeds through                          | engine                                                                                                                | 3.0.0    |
| `onUpdate` never fires (`removeHandlers` → `updateFromHtml` → `setHandlers`) | react-pageflip 2.0.3                                                                                                  | 3.0.0    |
| `flippingTime: 0` throws in the constructor                                  | Settings.getSettings                                                                                                  | 3.0.0    |
| `flipToPage` swallows errors and lands one page forward                      | Flip.flipToPage empty catch                                                                                           | 3.0.0    |
| Shipped types lose `react` under pnpm isolated `node_modules`                | react-pageflip `index.d.ts`                                                                                           | 3.0.0    |

Also: Pointer Events (one input path), `ResizeObserver` + `visualViewport`, `respectReducedMotion` (default on), SSR-safe imports, opt-in keyboard, `direction: 'rtl'` (turn direction only — the fold still follows the finger), controlled `page` + `usePageFlip()`.

---

## Install

```bash
npm uninstall react-pageflip page-flip && npm i @gullabs/react-flipbook
```

Vanilla:

```bash
npm uninstall page-flip && npm i @gullabs/flipbook-core
```

`width` and `height` stay required. Everything else is optional. Breaking changes: [`MIGRATION.md`](./MIGRATION.md). Publish notes: [`RELEASING.md`](./RELEASING.md).

---

## Usage

**Core**

```js
import { PageFlip } from '@gullabs/flipbook-core';

const pageFlip = new PageFlip(root, { width: 400, height: 600 });
pageFlip.loadFromHTML(pages);
// canvas mode (lazy chunk):
await pageFlip.loadFromImages(['page1.jpg', 'page2.jpg']);
```

**React**

```tsx
import HTMLFlipBook from '@gullabs/react-flipbook';

export function Book() {
  return (
    <HTMLFlipBook width={300} height={500}>
      <div>Page 1</div>
      <div>Page 2</div>
    </HTMLFlipBook>
  );
}
```

---

## Accessibility

- **`useKeyboard`** — ArrowLeft/Right, Home, End. Default is on for copy-paste demos; set `false` if you ship your own labeled controls.
- **`aria-label`** names the book (default `"Flipbook"`).
- **`liveRegion`** announces page changes (`role="status"`). Override with `liveRegionText`.
- **`respectReducedMotion`** (engine, default `true`) — turns become instant under `prefers-reduced-motion`.
- **`direction: 'rtl'`** inverts turn direction only, never pointer coordinates.
- Vanilla: wire `flipNext` / `flipPrev` to your own buttons; listen for `turnRejected` when a turn does not start.

---

## Development

Node `>=22` (`.nvmrc` pins 24). Package manager is **pnpm**.

```bash
pnpm install
pnpm quality:ci
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md). Other GulLabs open source: [github.com/GulLabs](https://github.com/GulLabs).

---

## License

Licensed per package — Copyright (c) 2026 GulLabs, with upstream Nodlik MIT
notices retained in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

| Package                   | License                            |                   |
| ------------------------- | ---------------------------------- | ----------------- |
| `@gullabs/flipbook-core`  | [MPL-2.0](./packages/core/LICENSE) | the flip engine   |
| `@gullabs/react-flipbook` | [MIT](./packages/react/LICENSE)    | the React binding |

**What MPL-2.0 means for you.** It is file-level copyleft, not application
copyleft. Your own code is never subject to it: you may install the engine, ship
it inside a closed-source product, and sell that product, and MPL-2.0 places no
license requirement whatsoever on the application around it.

**Nothing is triggered until you distribute.** MPL-2.0's obligations are
distribution-triggered, not modification-triggered. Fork the engine, rewrite it,
run it on an internal tool forever — if you never distribute it, you owe
nothing. Private and internal use carries no obligation of any kind.

**When you do distribute, two duties attach**, and only ever to the Covered
Software — the engine's own files — never to the rest of your application:

- **Distributing the engine's source** (§3.1) — modified or not — must be
  under MPL-2.0, carrying the license notice and without restricting
  recipients' rights in that source. Modification is not what triggers this;
  distribution is. A file of your own is Covered only if you put Covered
  Software into it; wrapping, configuring or calling the public API does not
  make your file a Modification.
- **Distributing the engine in built form** (§3.2) requires that the
  corresponding Source Code Form be available _and_ that recipients be informed
  how to obtain it. Both, for each distribution — not a one-off. Note this
  includes serving bundled JavaScript from a website: shipping client-side code
  to a browser is distribution.

In the common case — `npm install`, bundle, deploy, engine unmodified — the
source-availability half is already met by
<https://github.com/GulLabs/flipbook>, which is the Source Code Form and is
offered under MPL-2.0. (The npm package is not: it ships `dist` only, so it is
Executable Form. Point people at the repository, not at the tarball.) What
remains yours is the notice: carry a line in your licenses/acknowledgements such as “includes
@gullabs/flipbook-core, MPL-2.0, source at
https://github.com/GulLabs/flipbook”. Most bundlers' license plugins emit this
automatically. Note the notice accompanies each distribution, and it depends on
that source staying reachable — if this repository ever disappeared you would
need to make the corresponding source available yourself.

If you modified the engine, the source you point at must be _your_ version:
publish those files under MPL-2.0, per §3.1, and point your notice at them
rather than at this repository.

The practical test for whether you have modifications to publish is whether you
edit files under
`packages/core/src`.

## Trademark

"GulLabs", "@gullabs", the GulLabs name and the GulLabs logo are trademarks of
GulLabs. The licenses above grant rights to the code, not to the marks.

You may state that your project uses or is built on `@gullabs/flipbook-core`.
You may not use the GulLabs name or marks to name, brand or promote a fork or a
derived product in a way that suggests it is the official project or endorsed by
GulLabs. Forks are welcome — please rename them.
