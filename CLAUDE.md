# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A maintained fork of the abandoned [Nodlik/StPageFlip](https://github.com/Nodlik/StPageFlip) (`page-flip@2.0.7`) and [Nodlik/react-pageflip](https://github.com/Nodlik/react-pageflip) (`2.0.3`), merged into one pnpm monorepo and published by GulLabs as `@gullabs/flipbook-core` + `@gullabs/react-flipbook`, starting at **3.0.0**.

The point of the fork is to fix upstream's long-standing bugs **inside the engine** rather than by monkey-patching private methods from outside (which is what the downstream consumer, the Puddlebend picture-book reader, had been doing and losing). The full mission/spec lives outside this repo at `/Volumes/SSD/code/work/story-book/docs/GULLABS_FLIPBOOK_PROMPT.md` — read §4 (bugs + root causes) and §8 (testing strategy) before touching the flip path.

Upstream import points are tagged: `upstream-page-flip-2.0.7`, `upstream-react-pageflip-2.0.3`. Diff against those to see what the fork actually changed.

## Commands

```bash
pnpm install            # pnpm 9.12.0, Node >=20.9.0
pnpm test               # vitest run, both projects
pnpm build              # tsup per package (see caveat below)
pnpm typecheck          # tsc --noEmit per package
pnpm lint               # eslint flat config, repo-wide
pnpm size               # size-limit on core dist (budget 47 kB raw / 15 kB brotli (packages/core size-limit))
node ./scripts/check-isolated-types.mjs   # pnpm-isolated consumer type fixture
```

Single test file / single test:

```bash
pnpm vitest run packages/core/tests/portrait-back.test.ts
pnpm vitest run --project react -t 'onUpdate fires'
```

Vitest uses `projects`: `core` (node env, `packages/core/tests`) and `react` (jsdom, `packages/react/tests`). Both alias `@gullabs/flipbook-core` / `@gullabs/react-flipbook` to **`src/`**, so unit tests never exercise the built `dist`.

Playwright (`e2e/`) is not wired into CI and its `webServer` runs `pnpm --filter example-vanilla preview`, so the vanilla example must be built first:

```bash
npx playwright install --with-deps
pnpm --filter example-vanilla build && pnpm exec playwright test
```

## Architecture

Two packages, one direction of dependency: `react` → `core` (`workspace:*`). Core has **zero runtime dependencies** and must stay that way.

### Core engine (`packages/core/src`)

`PageFlip` is the façade and the event emitter (extends `EventObject`). It owns four collaborators created in `loadFromHTML` / `loadFromImages`:

- **`UI`** (`HTMLUI` / `CanvasUI`) — all DOM contact. One Pointer Events path (no separate mouse/touch), `ResizeObserver` + `visualViewport`. It builds `.stf__parent > .stf__wrapper > .stf__block` and **moves the caller's page elements into `.stf__block`**. Styles are injected at runtime by `ensureFlipbookStyles()` (`styles.ts`) and also shipped as `@gullabs/flipbook-core/style.css`.
- **`Render`** (`HTMLRender` / `CanvasRender`) — the rAF loop, layout rect, orientation detection, shadows, z-order, and the local↔global coordinate conversion.
- **`Flip`** — the flip state machine (`READ` / `FOLD_CORNER` / `USER_FOLD` / `FLIPPING`), delegating math to `FlipCalculation`.
- **`PageCollection`** (`HTMLPageCollection` / `ImagePageCollection`) — pages, spreads (portrait = 1 page per spread, landscape = 2), and which leaf is the mover vs the leaf underneath.

Input flows `UI` → `PageFlip.startUserTouch/userMove/userStop` → `Flip.fold/flip/showCorner/stopMove` → `Render.startAnimation(frames)` → per-frame `Flip.do()` → `Page.draw()`. Page turns are committed by the animation's `onAnimateEnd` calling `PageFlip.turnToNextPage/turnToPrevPage`.

The fork's fixes are deliberately factored into small, separately exported, unit-testable modules so the invariants can be locked down: `geometry.ts`, `Collection/flippingPage.ts`, `Render/bottomPage.ts`, `Render/pageBackground.ts`, `reducedMotion.ts`, `errors.ts`. Prefer extending those over inlining logic back into `Flip`/`Render`.

### React binding (`packages/react/src`)

`HTMLFlipBook.tsx` is the whole binding (`forwardRef`, `'use client'`). Its structure is load-bearing and easy to break:

- children are wrapped, each page element collected into a `childNodes` ref;
- one effect constructs/destroys the engine, keyed on `remountKeyOf(props)` (`showCover`, `size`, `width`, `height` — the constructor-only settings);
- one effect binds event handlers **before** calling `loadFromHTML`/`updateFromHtml` — this ordering is the §4.3 `onUpdate` fix, do not reorder;
- one effect pushes runtime-updatable settings via `engine.updateSettings(partial)`;
- one effect drives the controlled `page` prop.

React owns the page elements as children of the root div while the engine physically moves them into `.stf__block` and `HTMLUI.updateItems` wipes it with `innerHTML = ''`. Any change to how children are keyed, reordered, or removed risks a React/DOM ownership conflict — verify in a browser, not just jsdom.

## Invariants that must not regress

These encode the flagship fixes; there are unit tests for each, but the tests passed downstream while the live behavior was broken, so **verify visually too**.

- **Portrait BACK animates a temporary copy of the _current_ leaf**, not `pages[current - 1]` (`getPortraitFlippingPage`). Hard pages return `this` from `newTemporaryCopy()` and stay on the vendor previous-leaf path.
- **The local curl is identical for both directions**, ending at `to.x = -pageWidth` (`portraitCurlLocal`). BACK reads as a rightward on-screen curl only because `convertPageToGlobal` mirrors x. A "smarter" back curl with `to.x > pageWidth` re-creates the slide-in regression.
- **The bottom page is skipped only when `flippingPage === bottomPage`** (`shouldDrawBottomPage`), i.e. the hard-cover case — not "portrait AND back" as upstream did.
- **The fold is opaque** via `pageBackground` (default `#fff`), applied to the temporary copy and to `HTMLPage.draw`.
- **`flippingTime: 0` is instant, not an error**; `respectReducedMotion` (default true) makes turns instant under `prefers-reduced-motion`. Instant turns run `onAnimateEnd` synchronously inside `startAnimation` — anything that inspects `calc`/state after calling `flip()` must not treat that as failure. `Flip.flip/flipNext/flipPrev` return a boolean for exactly this reason.
- **`turnToPage` / `flipToPage` throw `PageFlipError`** instead of silently landing one page forward.
- **No `window`/`document` at module scope** (SSR); guard with `typeof … === 'undefined'`. `packages/core/tests/ssr-import.test.ts` runs in the node environment to enforce this.
- **`react` stays a peer dependency (`>=18`)** and the shipped types must survive pnpm's isolated `node_modules` — that is what `fixtures/isolated-consumer` guards.
- **Turns are bounded by spreads, not page indices.** `getCurrentPageIndex()` is `spread[0]`, so in landscape it is below `pageCount - 1` even on the last spread; checking pages there let a turn start and read past the end of the spread list.
- **`direction: 'rtl'` mirrors the turn direction, never the pointer coordinates.** Mirroring coordinates makes the fold run away from the finger; the inversion belongs in `Flip.getDirectionByPoint` (user input) and `UI.swipeDirection`, and programmatic turns pass an explicit direction so they stay index-ordered.
- **Core compiles under `strictNullChecks`.** The published `.d.ts` is the contract; do not silence a null with a cast that makes a public getter lie.

## Who owns which DOM node

This is the subtlety that breaks bindings. React renders the page elements, but
the engine styles and positions them, and they physically live inside the
engine's `.stf__block`. They are therefore **portalled** into that block
(`createPortal`) rather than rendered as children of the component root: React's
recorded parent has to match the real one, or removing / reordering children
throws `NotFoundError`. Two consequences to preserve:

- The mount effect calls `engine.loadFromHTML([])` to build the DOM shell before
  any page exists, so the portal has a target. Pages arrive via `updateFromHtml`.
- `HTMLUI.updateItems` adopts and releases individual leaves; it must never wipe
  `.stf__block` wholesale (that also deletes the render's shadow elements and
  nodes React still owns).

The collection is rebuilt **only when the page nodes themselves change**
(reference comparison against `loadedNodes`). Every flip re-renders the parent
and hands the effect new React elements for the same DOM nodes; rebuilding there
tears the book down mid-animation.

## Known gaps in the current state

- `pnpm build` at the root fails locally because `examples/nextjs` fails
  `next build` while prerendering Next's own `/404`, `/500` and `/_global-error`
  pages. It is not the library: an empty page with no flipbook import and no
  `transpilePackages` fails identically, on both Next 15 and 16. The local Node
  is 24.x while `.nvmrc` (and CI) pin 20.19, which is the likeliest difference —
  verify on Node 20 before spending time on it.
- `e2e/swipe-goldens.spec.ts` takes screenshots but asserts nothing, has no
  committed baselines, and covers portrait only — despite §8.2 calling golden
  comparison the only reliable guard for the two flagship fixes.

## Releasing and licensing

Publishing runs from `.github/workflows/release.yml` (Changesets + npm provenance) on pushes to `main`, never from a laptop. Both packages move together (`fixed` in `.changeset/config.json`). The first 3.0.0 publish comes from the already-committed versions with no pending changeset; later releases go through `pnpm exec changeset`.

`LICENSE`/`NOTICE` must keep the upstream Nodlik MIT notices verbatim alongside GulLabs' own, and the README must keep the "forked from" attribution. Every engine fix should reference its upstream issue in `CHANGELOG.md`, and any change to the drop-in `HTMLFlipBook` prop surface must be documented in `MIGRATION.md`.
