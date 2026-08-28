# flipbook

**The maintained page-flip.** A modern fork of StPageFlip + react-pageflip with the mobile back-curl finally fixed.

<p align="center">
  <img src="docs/images/hero.jpg" alt="Hardcover picture book mid-curl: the current leaf peels away and the previous illustration is already there underneath." width="100%">
</p>

Forked from [Nodlik/StPageFlip](https://github.com/Nodlik/StPageFlip) and [Nodlik/react-pageflip](https://github.com/Nodlik/react-pageflip) (both MIT), merged and maintained by [GulLabs](https://github.com/GulLabs). Upstream notices live in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

<p align="center">
  <a href="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml"><img src="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
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

[MIT](./LICENSE) — Copyright (c) 2026 GulLabs, with upstream MIT notices retained.
