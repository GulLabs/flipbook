# Canvas as a first-class renderer

Owner decision, 2026-08-29: canvas mode stops being an inherited half-feature
and becomes a supported renderer with the same bar as HTML mode — same fixes,
same tests, same accessibility, same React support.

Working rules: [`AGENTS.md`](../AGENTS.md). Architecture: [`CLAUDE.md`](../CLAUDE.md).
Every phase is one PR-sized unit and a **Codex signoff** before the next starts.
Browser-dependent phases require **both** `pnpm quality:ci` **and** the relevant
`pnpm test:e2e` scope — `quality:ci` does not run Playwright, which is a separate
CI job ([ci.yml](../.github/workflows/ci.yml)).

## Revision history

- **r1** (df30cb8) — 15 defects, 9 phases. Sent for signoff.
- **r2** (afdc1cf) — **Codex REQUEST_CHANGES**, job `task-mte7kt7m-wu2hid`
  (gpt-5.6-sol, high). Two findings withdrawn as false, one diagnosis corrected,
  two demoted, **eight new defects added**, phase order rewritten, C1 respecified
  as a scheduler contract.
- **r3** (this) — **Codex REQUEST_CHANGES**, job `task-mtercfv3-kaqjdg`
  (gpt-5.6-sol, high). The r1 corrections were confirmed faithful and the phase
  reorder endorsed, but **Phase 0 was not executable as written** — it required
  covering behaviour that stays broken until Phases 1–8, so it could not be both
  meaningful and green. Phase 0 is now a full acceptance contract. One more
  defect found (**G8**, a mode-attachment race), several citations corrected,
  and two repo-wide test-infrastructure gaps exposed.

Every disputed call in every round was independently re-verified against source
before being accepted or rejected.

## Standing rule: every line read is a line audited

This plan started as three defects. It reached fifteen because reading
`ImagePage` to fix the portrait curl meant reading `CanvasUI` next, which
surfaced the `devicePixelRatio` gap (B1). It reached twenty-one because Codex
read the same files again and found eight more.

So: **while fixing any defect here, audit every line you read, not just the
lines you change.** A phase that touches a file owns what it found in that file.

- New defects get **appended to the inventory with `file:line` and a stated
  failure mode**, immediately, before deciding what to do about them.
- Fix in place only when it is the same failure family and the fix is small.
  Otherwise it becomes its own phase — do not silently widen a PR, and do not
  silently drop the finding either.
- **A guess recorded as a finding is worse than no finding.** r1 contained
  three: B3 and E1 were false, and A2's _cause_ was wrong in a way that would
  have produced a wrong fix. They are kept below, struck, as the record.

## Inventory

### Confirmed defects

| #      | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Portrait BACK uses upstream's previous-leaf slide-in. `newTemporaryCopy()` returns `this`, so `getPortraitFlippingPage` sees `copy === current` and falls to `pages[i-1]`. **The bug this fork exists to kill is present in canvas mode.**                                                                                                                                                                                                                                                                | [ImagePage.ts:120](../packages/core/src/Page/ImagePage.ts:120), [flippingPage.ts:32](../packages/core/src/Collection/flippingPage.ts:32)                                                                             |
| **A2** | No hard-page rendering. ~~`ImagePageCollection` hardcodes SOFT~~ — **corrected**: `createSpread()` _does_ mark the cover hard via `setDensity`. The real failure is that `ImagePage.draw()` ignores density and hard angles entirely, and `CanvasRender` has no hard-page path. A hard cover therefore curls like paper.                                                                                                                                                                                  | [PageCollection.ts:71](../packages/core/src/Collection/PageCollection.ts:71), [ImagePage.ts:27](../packages/core/src/Page/ImagePage.ts:27), [CanvasRender.ts:39](../packages/core/src/Render/CanvasRender.ts:39)     |
| **A3** | Bitmaps stretched to the leaf rect. No aspect preservation, no fit mode, no inset.                                                                                                                                                                                                                                                                                                                                                                                                                        | [ImagePage.ts:49](../packages/core/src/Page/ImagePage.ts:49), [:69](../packages/core/src/Page/ImagePage.ts:69)                                                                                                       |
| **A4** | No `onerror`. A 404 spins the loader forever and emits nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                           | [ImagePage.ts:113](../packages/core/src/Page/ImagePage.ts:113)                                                                                                                                                       |
| **B1** | **No `devicePixelRatio` anywhere in the repo.** One backing pixel per CSS pixel is linearly half-resolution on a 2× display. The most visible defect in the list.                                                                                                                                                                                                                                                                                                                                         | [CanvasUI.ts:32](../packages/core/src/UI/CanvasUI.ts:32)                                                                                                                                                             |
| **B2** | `resizeCanvas()` truncates fractional layout sizes and has no zero-size handling. _(The r1 "`NaN` when `display:none`" claim is withdrawn — unverified, and browsers commonly resolve a hidden box to `0px`.)_                                                                                                                                                                                                                                                                                            | [CanvasUI.ts:33](../packages/core/src/UI/CanvasUI.ts:33)                                                                                                                                                             |
| **C1** | The rAF loop reschedules unconditionally, so `drawFrame()` runs forever on an untouched book. **Repo-wide — this affects HTML mode too, not just canvas.**                                                                                                                                                                                                                                                                                                                                                | [Render.ts:129](../packages/core/src/Render/Render.ts:129), [:151](../packages/core/src/Render/Render.ts:151)                                                                                                        |
| **D1** | No accessibility. Caveat: keyboard and live region live in the **React binding**, not core, so "parity" must name which layer owns what.                                                                                                                                                                                                                                                                                                                                                                  | [CanvasUI.ts:18](../packages/core/src/UI/CanvasUI.ts:18), [HTMLFlipBook.tsx:493](../packages/react/src/HTMLFlipBook.tsx:493)                                                                                         |
| **G1** | **Canvas clip state leaks across frames.** The portrait clip at the end of `drawFrame()` has no `save()`/`restore()` around it. It cannot affect the current frame; it constrains every _subsequent_ frame, including the next `clear()`, Identical repeated clips intersect without further shrinking, so this is not a slow collapse — the defect is **leaked frame state and a stale clip after any geometry change**, with correctness resting on canvas resizing implicitly resetting context state. | [CanvasRender.ts:68](../packages/core/src/Render/CanvasRender.ts:68)                                                                                                                                                 |
| **G2** | **Transparent images defeat `pageBackground`.** `clear()` fills the canvas, but `ImagePage.draw()` paints the turning bitmap straight over the already-painted bottom page. Transparent PNG pixels reveal the page beneath — the §4.2 read-through bug the setting exists to prevent. The turning leaf must fill its own clipped, transformed area with `foldFill(pageBackground)` first.                                                                                                                 | [ImagePage.ts:47](../packages/core/src/Page/ImagePage.ts:47), [:69](../packages/core/src/Page/ImagePage.ts:69), [CanvasRender.ts:184](../packages/core/src/Render/CanvasRender.ts:184)                               |
| **G3** | **Eager resource model.** Every page constructs an `HTMLImageElement` and sets `src` at load, so a 500-page book starts 500 fetches immediately. No lazy window, no eviction. _(Decoded-memory totals are deliberately not asserted — browsers evict. The eager network behaviour is what is definite.)_                                                                                                                                                                                                  | [ImagePage.ts:20](../packages/core/src/Page/ImagePage.ts:20), [ImagePageCollection.ts:23](../packages/core/src/Collection/ImagePageCollection.ts:23)                                                                 |
| **G4** | **`destroy()` releases nothing.** It stops rendering and removes UI but never nulls the collection or render, and `PageCollection.destroy()` only drops its array — no per-page disposal, no load cancellation. A retained destroyed engine retains every image.                                                                                                                                                                                                                                          | [PageFlip.ts:64](../packages/core/src/PageFlip.ts:64), [PageCollection.ts:50](../packages/core/src/Collection/PageCollection.ts:50)                                                                                  |
| **G5** | **Mode lifecycle is unsafe.** `PageFlip.clear()` casts the active UI to `HTMLUI` unconditionally — in canvas mode `CanvasUI` has no `clear()`, so this throws. `updateFromImages()` can also run while HTML mode is active (building image pages against `HTMLRender`) and vice versa.                                                                                                                                                                                                                    | [PageFlip.ts:293](../packages/core/src/PageFlip.ts:293), [:219](../packages/core/src/PageFlip.ts:219), [:238](../packages/core/src/PageFlip.ts:238), [canvas-loader.ts:17](../packages/core/src/canvas-loader.ts:17) |
| **G6** | **Shrinking `updateFromImages()` leaves stale render state.** `replacePages()` preserves the old index; `show()` silently returns when it exceeds the new collection, so the render keeps holding old left/right pages and their images — and `update` / `collectionRebuild` then emit the **rejected old index**.                                                                                                                                                                                        | [PageFlip.ts:127](../packages/core/src/PageFlip.ts:127), [PageCollection.ts:253](../packages/core/src/Collection/PageCollection.ts:253)                                                                              |
| **G8** | **Stale async mode attachment.** `loadFromImages()` awaits a dynamic import and guards only `this.destroyed`. If `loadFromHTML()` runs while that import is in flight, the stale canvas continuation still calls `attachMode()` and replaces the newer HTML mode. `updateFromImages()` has the same race. Needs a monotonically increasing load generation so only the latest operation may attach.                                                                                                       | [PageFlip.ts:188](../packages/core/src/PageFlip.ts:188), [:207](../packages/core/src/PageFlip.ts:207), [:219](../packages/core/src/PageFlip.ts:219)                                                                  |
| **F1** | No React binding for images mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [react/src/index.ts](../packages/react/src/index.ts)                                                                                                                                                                 |
| **F2** | No browser coverage — jsdom with a mocked 2d context, which is how #44 and #56 shipped broken.                                                                                                                                                                                                                                                                                                                                                                                                            | [canvas-mode.test.ts](../packages/core/tests/canvas-mode.test.ts)                                                                                                                                                    |
| **F3** | No example uses canvas mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `examples/`                                                                                                                                                                                                          |
| **F4** | README advertises the back-curl fix unqualified, which A1 makes false for canvas.                                                                                                                                                                                                                                                                                                                                                                                                                         | [README.md:3](../README.md:3), [:18](../README.md:18)                                                                                                                                                                |

### Reclassified

| #      | Was                                                                                 | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A5** | Defect — `getTemporaryCopy()` returns `this` where the base declares `Page \| null` | **Contract cleanup, folded into Phase 2.** Semantically dishonest. The only caller is [HTMLRender.ts:338](../packages/core/src/Render/HTMLRender.ts:338) — but "which only sees `HTMLPage`s" holds **only under the matching-mode invariant G5/G8 do not yet guarantee**: `updateFromImages()` can inject `ImagePage`s into a live `HTMLRender` today. Harmless once mode safety lands, not before.                                                                                             |
| **E2** | Defect — leaf-clip eats the edge, forcing a 2.8% downstream inset                   | **Investigation only.** No repository evidence; it violates this plan's own no-guess rule. Do not promise to delete the downstream workaround before reproducing it.                                                                                                                                                                                                                                                                                                                            |
| **G7** | —                                                                                   | **Not a current bug, but a Phase 2 constraint.** Cached `onload` is not missed today: `src` is set in the constructor and `load()` runs in the same synchronous script, which the HTML Standard guarantees is safe. It becomes a hazard once Phase 2 introduces temporary copies of already-complete images — so install handlers before `src` and distinguish `complete && naturalWidth > 0` (decoded) from `complete && naturalWidth === 0` (**broken** — a failed image is also `complete`). |

### Withdrawn — false as written

| #                | Claim                                                                                           | Why it was wrong                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~**B3**~~       | `CanvasUI` queries `inBlock.querySelector('canvas')` and could match a pre-existing host canvas | `UI` **prepends** its wrapper with `insertAdjacentHTML('afterbegin', …)`, so the new canvas is found first. Scoping the lookup is still cleaner, but there is no current failure. [UI.ts:71](../packages/core/src/UI/UI.ts:71)                  |
| ~~**E1**~~       | The Safari webkit#126207 workaround is part of canvas work                                      | It is HTML-mode CSS/3D debt. Canvas uses Canvas2D clipping and has no `clip-path`/`translate3d` equivalent. Worth auditing — **separately**; it does not make canvas second-class. [HTMLPage.ts:114](../packages/core/src/Page/HTMLPage.ts:114) |
| ~~**A2** cause~~ | `ImagePageCollection` hardcodes `SOFT`, so there are no hard pages                              | Initial density is overridden by `createSpread()`, which sets the cover `HARD`. The defect is real; the _cause_ was wrong, and fixing the collection would have changed nothing.                                                                |

## Settled design decisions

These were open in r1 and are now fixed, per Codex's recommendations.

### Image source descriptor

One normalized type, per-book defaults with per-page overrides. Strings stay
supported as a deprecated form (normalized to `alt: ''`) — **not** a parallel
alt array, which drifts under reorder and update.

```ts
type ImageFit = 'contain' | 'cover' | 'fill';

type ImagePageSource = {
  src: string;
  alt: string;
  fit?: ImageFit;
  inset?: number;
  density?: 'soft' | 'hard';
};

interface FlipSetting {
  imageFit: ImageFit; // default 'contain' — otherwise A3 remains the default
  imageInset: number; // CSS px, default 0
}

loadFromImages(images: readonly (string | ImagePageSource)[]): Promise<void>;
```

Book defaults are read **at draw time** so `updateSettings()` works (AGENTS.md:
a setting must be read where it is used). Only per-page overrides are cached.
`fill` is retained for explicit legacy stretching.

### Accessibility

Not one changing `aria-label` on the canvas. Structure:

- outer book gets `role="region"` (or `group`) with a name;
- the visual canvas is `aria-hidden="true"`;
- a **visually hidden semantic mirror** carries the currently visible page(s),
  each represented separately with its supplied `alt`;
- a polite, atomic live region announces spread changes;
- keyboard focus and shortcuts sit on the component root or a deliberate core
  keyboard API — never on an unnamed bitmap.

### React

A **separate `ImageFlipBook` export**, not a `mode` prop on `HTMLFlipBook`. A
mode prop would create mutually exclusive `children`-vs-`images` contracts,
entangle the portal lifecycle with a renderer that has no page DOM, and make
`lazyRadius` misleading. Share utilities internally only once both are correct.

### Hard pages

Explicit per-image `density`, with `showCover` as the convenience that marks
structural cover leaves hard — position alone cannot express an interior
cardstock insert. Before implementing, specify: spine anchor, projected width
through 90°, backside behaviour, z-order, hard shadows. Also test the inherited
behaviour that marks an unmatched terminal landscape page hard even when
`showCover` is false; making canvas honour density may activate it unexpectedly.

## Phases

Nine phases. Codex explicitly advised **against** compressing to eight: that
would force resource ownership and the mode/update lifecycle into one oversized
phase. `CHANGELOG.md` and `MIGRATION.md` entries belong to **each owning phase**
(AGENTS.md §3), not to a final catch-all.

| #   | Phase                                                                 | Status |
| --- | --------------------------------------------------------------------- | ------ |
| 0   | Browser harness + built-artifact smoke                                | `todo` |
| 1   | Frame isolation (G1), DPR (B1), fractional/zero sizing (B2)           | `todo` |
| 2   | **Owner API gate**, descriptor, A1 portrait BACK, shared resource     | `todo` |
| 3   | Image errors (A4), lazy loading, eviction, disposal (G3, G4)          | `todo` |
| 4   | Mode generation (G8), cross-mode guards, clear/update/shrink (G5, G6) | `todo` |
| 5   | Fit, inset, page-local opacity (A3, G2) + E2 investigation            | `todo` |
| 6   | Hard-page rendering (A2)                                              | `todo` |
| 7   | Idle scheduler (C1)                                                   | `todo` |
| 8   | Accessible `ImageFlipBook` (D1, F1), examples, final docs (F3, F4)    | `todo` |

Frame isolation and DPR precede the portrait fix: a leaking clip and a
half-resolution backing store would corrupt the pixel evidence Phase 2 depends
on. **Codex endorsed this reorder** — there is no hidden dependency requiring A1
first. (Nuance: G1 will not corrupt _every_ stable portrait frame, because the
leaked clip often contains the current drawing region. Relying on that geometry
is not an acceptable renderer invariant.)

### Blocking gates before implementation

- **Phase 2 opens with an owner API-approval gate.** `ImagePageSource`, the
  string deprecation, the new settings, the error event, the lazy policy and
  `ImageFlipBook` are product decisions under AGENTS.md §5 — not implementation
  details to settle mid-patch. _(Note: `loadFromImages(): Promise<void>` already
  exists and is already migrated; Phase 2 is not introducing that.)_
- **A4 must be specified before the API freezes.** With lazy loading the initial
  promise cannot await every page. Define: when load/update promises resolve;
  the per-page error event name and payload; fallback artwork; retry behaviour;
  exactly-once emission; suppression after replacement or disposal. The event map
  has no image-error channel today
  ([EventObject.ts:9](../packages/core/src/Event/EventObject.ts:9)).
- **Resource policy must be explicit**: fetch/decode radius, eviction timing,
  ownership/ref-counting, and which of current / flipping / bottom / temporary-copy
  pages are pinned. State whether `ImageFlipBook.lazyRadius` controls resources —
  the existing `lazyRadius` is **DOM-mounting** policy
  ([HTMLFlipBook.tsx:135](../packages/react/src/HTMLFlipBook.tsx:135)), and
  silently reusing the name for a different meaning would mislead.
- **Settings mutation must be resolved before Phase 7.** `getSettings()` returns
  the live object and the renderer already defends against direct mutation
  ([pageBackground.ts:108](../packages/core/src/Render/pageBackground.ts:108)).
  A parked scheduler cannot observe `book.getSettings().pageBackground = …`.
  Either make `updateSettings()` the typed, documented sole mutation path, or
  introduce observable mutation. This is an API decision, not a fix.

## Phase 7 — the scheduler contract

C1 is the phase most likely to break the product, so it is specified rather than
sketched. "Dirty flag" is not a design.

- `requestDraw()` schedules **one** rAF when none is pending.
- Continue scheduling only while an animation — or an intentionally animated
  loading state — is active.
- Animation `startedAt` derives from the **resumed** frame clock, never a stale
  `this.timer`.
- `startAnimation(…, 0, …)` runs the final action and callback **synchronously**
  (the `flippingTime: 0` invariant in CLAUDE.md), then schedules exactly one
  post-callback draw.
- Invalidation sources: `finishAnimation`, every render setter, collection
  show/replace, resize, DPR change, runtime settings change, image load, image
  error.
- A disposed image resource must not restart an old renderer.
- **Open question to settle in-phase:** animated GIF/WebP/APNG pages — parking
  the loop freezes them. Decide support explicitly rather than by accident.

**Gate matrix**, Chromium and WebKit, HTML **and** canvas: nonzero animation,
instant turns, reduced motion, drag, hover fold, resize/orientation, late image
load, image error, runtime `pageBackground` change, collection replacement,
destroy — plus an assertion that draw and rAF counts **stop increasing at rest**.

## Phase 0 — acceptance contract

r2 failed signoff here: Phase 0 "must cover" listed behaviour that stays broken
until Phases 1–8, so it could not be both meaningful and green. Phase 0 builds
the fixtures and helpers for those later phases but **only asserts what is
already true**. Skipped or expected-failure tests are not coverage.

### Fixture

A test-only `/canvas.html` route on the existing Vite e2e server — separate from
the eventual polished public example. Expose `window.flipbook`, and set a
ready flag after `loadFromImages()` resolves — but **tests must still wait for
pixels**, because that promise does not currently mean images are decoded.

Same-origin lossless PNGs, no text, no ICC profiles, no gamma chunks, no
gradients, no antialiased boundaries:

- six `400×300` opaque pages — red `#E5484D`, blue `#3B82F6`, green `#22C55E`,
  yellow `#FACC15`, purple `#A855F7`, orange `#F97316`;
- each with a flat centre sentinel and four `40×40` corner sentinels (white,
  black, cyan, magenta) so orientation and mirroring are identifiable;
- one `400×300` transparency fixture: opaque 40 px magenta border, fully
  transparent `320×220` centre;
- one `200×400` and one `600×200` quadrant image for `contain`/`cover`/`fill`.

Delay and 404 responses come from **Playwright routing**, never wall-clock server
delays. Functional pixel assertions run with `drawShadow: false` and
`pageBackground: '#f4ecd8'`.

### Reading pixels

`getImageData`, **not** `toDataURL` — encoded PNG bytes and metadata can differ
while pixels are equivalent.

```ts
scaleX = canvas.width / canvas.getBoundingClientRect().width;
scaleY = canvas.height / canvas.getBoundingClientRect().height;
backingX = Math.floor(cssX * scaleX);
backingY = Math.floor(cssY * scaleY);
```

Sample points derive from `book.getBoundsRect()`, never hard-coded:

| Sample                                         | x                                                            |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Landscape left centre                          | `rect.left + 0.5 * rect.pageWidth`                           |
| Landscape right centre / portrait visible page | `rect.left + 1.5 * rect.pageWidth`                           |
| DPR far-edge proof                             | `rect.left + 1.85 * rect.pageWidth` (needs a sentinel there) |

All centre `y` = `rect.top + 0.5 * rect.height`. Read a **5×5 backing-pixel
patch**, compare **median** channels at RGB tolerance **±3**, require alpha
**≥254**. Never sample shadows, fold edges, crop boundaries, or resampled
sentinel edges.

### Timing — the anti-flake protocol

For every mutation, in order:

1. wait for the **semantic** condition (page index, orientation, state, or a
   nonzero held-drag calculation);
2. wait **two** browser rAFs;
3. `expect.poll` until the expected pixel appears — **the poll is authoritative**;
   double-rAF alone is not image readiness;
4. wait one more rAF and assert it is _still_ correct.

This survives Phase 7, because browser rAF keeps running even when the engine's
own scheduler parks. For held folds, keep the pointer down, require `USER_FOLD`
plus nonzero calculation progress, then sample. **Never sample a free-running
animation by elapsed milliseconds** — that is what caused this repo's earlier
e2e flake.

### What Phase 0 asserts (green), Chromium + WebKit

- a real Canvas2D context loads and paints page 0;
- portrait centre identifies page 0; instant next/back changes both the engine
  index and the centre colour;
- landscape centres identify pages 0/1, then 2/3;
- a real held pointer drag engages a fold and changes an interior sparse pixel
  grid; release returns to `READ` with a non-blank page;
- RTL left-edge click, corner drag and swipe advance; programmatic `flipNext()`
  stays index-forward;
- emulated reduced motion makes the index change synchronous; disabling respect
  leaves a nonzero animation active;
- a grow-update paints the new collection; `destroy()` removes the canvas and
  emits no later errors;
- portrait↔landscape resize changes orientation **and** the expected centre pixels;
- the smoke suite also runs at `deviceScaleFactor: 2` (Phase 1 then tightens it
  to exact backing/CSS ratios and far-edge painting);
- **a separate raw built-`dist` route** imports `dist/index.js`, fetches its
  canvas chunk, and paints a page;
- no `pageerror` and no unexpected console error.

Transparent-paper correctness, hard geometry, shrink clamping, load errors and
exact DPR backing size stay **red**, owned by their phases. Phase 0 ships their
fixtures and helpers only.

### Exit criteria

- source **and** built-artifact canvas smoke pass on both browsers;
- the DPR-2 smoke passes;
- a temporary **negative control** (wrong sentinel expectation, or a suppressed
  image response) has been observed failing, then reverted;
- no arbitrary sleeps, no `toDataURL` comparisons;
- `test:e2e:canvas` exists for focused runs, and the full e2e job discovers it
  via `pnpm test:e2e`. **Do not add Playwright to `quality:ci`** — CI already
  runs it as a separate job ([ci.yml](../.github/workflows/ci.yml));
- `playwright.config.ts` fixed: `trace: 'on-first-retry'` with `retries: 0`
  never records a trace. Use `retain-on-failure`, or enable a deliberate CI retry.

### Two repo-wide gaps this exposes

Neither is canvas-specific, and both weaken every existing gate:

1. **E2E never exercises the published artifact.** `examples/vanilla/vite.config.ts`
   aliases `@gullabs/flipbook-core` to `src/`, so no browser test has ever run the
   built `dist`. Hence the built-artifact smoke above.
2. **The lazy-chunk boundary check is weaker than it looks.**
   [pack-html-engine.mjs](../scripts/pack-html-engine.mjs) classifies by chunk
   filename and detects leakage by searching for `getContext`. A canvas-only
   _resource_ or _fit_ helper can leak without that marker. Phase 0 adds
   bundler-metafile reachability checks for both ESM and CJS.

## Non-goals

- WebGL / three.js — [`WEBGL_RENDERER.md`](./WEBGL_RENDERER.md), deferred.
- Making canvas the default. HTML stays the default renderer.
- The webkit#126207 audit (withdrawn E1) — separate HTML maintenance.

## Budget impact

**r1 claimed "Phases 1–5 add code only to the canvas chunk". That was false**
and is withdrawn: the scheduler work changes `Render.ts`, which is in the eager
HTML graph, and new settings and `PageFlip` behaviour may be too. Each phase
reports **measured** eager-graph and canvas-chunk deltas separately. The gate
that matters throughout is the architectural one — canvas must not leak into the
eager graph ([pack-html-engine.mjs](../scripts/pack-html-engine.mjs)).

## Signoffs

| Phase   | Codex job                                  | Verdict             | Date       |
| ------- | ------------------------------------------ | ------------------- | ---------- |
| Plan r1 | `task-mte7kt7m-wu2hid` (gpt-5.6-sol, high) | **REQUEST_CHANGES** | 2026-08-29 |
| Plan r2 | `task-mtercfv3-kaqjdg` (gpt-5.6-sol, high) | **REQUEST_CHANGES** | 2026-08-29 |
| Plan r3 | —                                          | —                   | —          |
