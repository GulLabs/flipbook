# Changelog

All notable changes to this monorepo will be documented in this file.

## Unreleased

### Fixed

- Canvas mode no longer paints the turning page twice. `ImagePage.newTemporaryCopy()`
  returns `this`, so the mover and the leaf beneath it are routinely the same
  object there, and `CanvasRender` drew the bottom page unconditionally — an
  unclipped copy sat under the turning image and vanished only when the turn
  finished. `HTMLRender` has guarded this since the §4.1 fix; the guard now
  applies to both. ([StPageFlip #44](https://github.com/Nodlik/StPageFlip/issues/44))
- Canvas mode honours `pageBackground`. The setting is this fork's own and was
  wired only into the HTML renderer, so a cream-paper book came out white on
  canvas. ([StPageFlip #56](https://github.com/Nodlik/StPageFlip/issues/56))
- `clear()` releases only the leaves the engine actually adopted. It moved
  everything in `.stf__block` back to the host element, including pages a
  framework had rendered there itself — React portals its pages into that
  block, so `clear()` invalidated React's recorded parent and the next removal
  or reorder threw `NotFoundError`, the exact failure the portal prevents.

- A refused **click** now reports `turnRejected`. `userStop` discarded the
  result of the turn, so the event fired only for programmatic
  `flipNext`/`flipPrev` — the most common way a turn gets refused was silent.
- `turnRejected` can actually carry `reason: 'disabled'`. It was declared in
  the public event type and emitted by nothing, so a click blocked by
  `disableFlipByClick` produced no signal at all. The policy check moved from
  `Flip.flip` to `PageFlip.userStop`, which is the only path that has clicks.

- `lazyRadius` combined with `renderOnlyPageLengthChange` left every page
  outside the initial window as an empty placeholder for the life of the book.
  Turning a page moves the lazy window without changing the page count, so the
  length short-circuit skipped the re-render that would have mounted the next
  page — the reader turned the page and saw blank paper.
- Flip setup no longer swallows genuine defects. `Flip.start` caught every
  error and returned `false`, so a vanished DOM node or a broken renderer made
  the book simply refuse to turn with nothing in the console — the
  silent-failure class §4.6 exists to remove. Only `PageFlipError` is soft now;
  anything else surfaces.
- `PageFlip.flip(page)` throws `PageFlipError('NOT_LOADED')` before a load
  instead of silently doing nothing. Explicit navigation that quietly no-ops is
  the §4.6 failure, and `turnToPage` already behaved this way.
- `flipNext` / `flipPrev` no longer throw for a rejected turn. They are what a swipe and an arrow
  key call, and are documented to return a boolean plus a `turnRejected`
  event, but an engine-internal `PageFlipError` escaped them and surfaced as an
  unhandled exception from a gesture handler. An engine-typed failure is now
  reported as `turnRejected` carrying its error code; a non-engine error still
  propagates, because hiding a real defect behind "the page would not turn" is
  the same bug in a different place. `turnToPage` / `flip` still
  throw, which is the §4.6 contract.
- An out-of-range `startPage` reports `onNavigationError` instead of quietly
  opening at page 0, matching what an out-of-range controlled `page` already
  did.
- A responsive `width` / `height` no longer rebuilds the engine. The React
  binding keyed the engine's identity on size, so a book sized from its
  container was destroyed and recreated on every resize step — losing the
  current page, the render loop and any in-flight turn. `UI.applyHostSize()`
  restamps the host element from `updateSettings` instead.
- `swipeDistance` is read live. It was captured in the `UI` constructor, so
  `updateSettings({ swipeDistance })` was accepted and echoed by `getSettings()`
  while gestures kept using the value from construction.

### API / accessibility (craft-audit climb)

- `PageFlip.flipNext` / `flipPrev` return `boolean` and emit `turnRejected` when a turn does not start.
- `HTMLFlipBook` `useKeyboard` defaults to `true` (Arrow/Home/End); nested form controls keep their keys.
- Optional `onNavigationError` for controlled `page` out-of-range; `onTurnRejected` mirrors core events.
- `usePageFlip().bookProps` keeps `page` / `pageCount` in sync via engine events.
- Uncontrolled `startPage` is applied once after the first real page collection load.

### Engine

- `Flip.start` no longer catches setup failures at all (superseded below): the
  engine's typed errors are classified by `PageFlip.requestTurn`, and anything
  else propagates.
- `pageBackground` opacity is checked for real. Sanitising the value for CSS
  safety had made `isOpaquePageBackground` unable to return `false`, and let
  translucent values (`rgba(…, 0.4)`, `#ffffff00`, `hsla(…, 0.2)`, `#fff8`,
  `currentColor`) through to the fold — a turning leaf you can read through,
  which is the §4.2 bug the setting exists to prevent.
- Engine state is nullable internally and guarded at the accessors: calling
  `getRender()` / `getPageCollection()` / `getPageCount()` and friends before
  `loadFromHTML` / `loadFromImages` now throws `PageFlipError` with code
  `NOT_LOADED` instead of dereferencing `undefined` deeper in. Public
  signatures are unchanged. See MIGRATION.md.
- `attachMode` disposes the previous mode before replacing it, so loading twice
  cannot leave an old UI listening on the host element, and the deferred `init`
  no longer fires after `destroy()`.
- `attachMode`, `replacePages` and `getBlock` are marked `@internal` — they are
  wiring seams for the lazily-loaded canvas chunk, not supported API.

- Core compiles under `strictNullChecks`, so the published types no longer hide
  nullability: `getFlipController()`, `getCalculation()` and `getTemporaryCopy()`
  are declared `| null`, and `Page.setArea` accepts the sparse clip areas the
  renderers already tolerated.
- `direction: 'rtl'` now applies to click, corner fold and drag as well as swipe.
  The turn direction is mirrored; pointer coordinates are not, so the fold keeps
  following the finger instead of reversing mid-gesture.
- Turns are bounded by spreads instead of page indices. In landscape with a
  two-page final spread, a forward turn used to start and then read past the end
  of the spread list (`showNext` also walked one index too far).
- Static pages paint `pageBackground` like the fold does, so a leaf cannot be
  read through at the start or end of a turn.
- `pointerleave` no longer force-finishes a fold while a pointer is still down;
  under pointer capture it fires right after `pointerup` and started a second
  snap-back animation.
- `UI.destroy()` restores the host element's class and inline styles, and
  `updateItems` no longer wipes `.stf__block` wholesale (it kept deleting the
  render's shadow elements, and nodes a framework still owned).

### Tooling

- One TypeScript across the workspace (6.0.3); the lockfile and manifests had
  diverged, so `pnpm install --frozen-lockfile` — what CI runs — failed.
- Node 24 (`.nvmrc`), `engines: >=22.18.0`. Node 20 is end-of-life and
  size-limit 13 refuses to run on it.
- The release workflow builds before publishing. With `files: ["dist"]` and no
  build step, it would have published empty tarballs; `prepack` covers manual
  publishes too.
- Canvas mode has tests (it was 0% covered), and the browser suite asserts the
  §4.1/§4.2 invariants on Chromium and WebKit in CI instead of writing
  screenshots nothing compared.

### React

- Pages are portalled into the engine's block, so React and the DOM agree on
  their parent. Removing or reordering children threw `NotFoundError` before.
- Event handlers are dispatched through a ref, and the collection is rebuilt only
  when the page nodes actually change. An inline `onFlip` used to tear down and
  rebuild the whole `PageCollection` on every turn, mid-animation.
- `renderOnlyPageLengthChange` no longer empties the collected page nodes on its
  early return, which left the next remount with a blank book.
- The live region is visually hidden. Its text ("Page 2 of 3") rendered under the
  book for every consumer.
- A consumer's own `ref` on a page element is preserved instead of overwritten.
- `updateSettings` runs for every runtime-updatable prop (`clickEventForward`,
  `mobileScrollSupport`, `maxShadowOpacity`, `startZIndex`, size bounds).

### Repo

- Initial Gul Labs monorepo: `packages/core` (StPageFlip) and `packages/react` (react-pageflip).
- Public repository under `GulLabs/flipbook` with open-source governance, CI, and branch protection.

## 3.0.0

Engine + React binding merge. Start of the maintained 3.x line.

### Fixes (in-engine, not monkey-patches)

- Portrait BACK animates a temporary copy of the **current** leaf; local curl stays `to.x = -pageWidth` so `convertToGlobal` BACK-mirror curls right. Bottom page paints unless `flippingPage === bottomPage`. ([StPageFlip #49](https://github.com/Nodlik/StPageFlip/issues/49), [#9](https://github.com/Nodlik/StPageFlip/issues/9))
- Opaque fold / temporary copy via `pageBackground` (default `#fff`).
- React `onUpdate` fires on children change (handlers attach **before** `updateFromHtml`).
- `updateFromHtml` emits typed `collectionRebuild` when `PageCollection` is replaced.
- `updateSettings(partial)` restamps `usePortrait` / `useMouseEvents` at runtime; the React binding remounts when `showCover` / size identity changes.
- `turnToPage` and `flipToPage` throw `PageFlipError` instead of a silent one-page advance.
- React types declare `react` as a peer (`>=18`) and survive pnpm isolated `node_modules`.
- `flippingTime: 0` is instant; no constructor throw.

### Modernization

- Pointer Events (one input path); ResizeObserver + `visualViewport`.
- `respectReducedMotion` default true.
- SSR-safe imports (no `window`/`document` at module scope); React pre-hydration placeholder.
- Opt-in keyboard (arrows/Home/End) and configurable live region.
- `direction: 'rtl'`.
- Controlled `page` + `onPageChange`, imperative handle, `usePageFlip()`.
- Lazy page mounting via `lazyRadius`.
- React 18/19 (`forwardRef` handle so `ref.current.pageFlip()` works on 18; Strict Mode double-mount safe).
- Typed `WidgetEvent<T>`; no `any` in the public API.
