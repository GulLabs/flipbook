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
- **r2** (this) — **Codex REQUEST_CHANGES**, job `task-mte7kt7m-wu2hid`
  (gpt-5.6-sol, high). Two findings withdrawn as false, one diagnosis corrected,
  two demoted, **eight new defects added**, phase order rewritten, C1 respecified
  as a scheduler contract. Every disputed call was independently re-verified
  against source before accepting it.

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

| #      | Defect                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Portrait BACK uses upstream's previous-leaf slide-in. `newTemporaryCopy()` returns `this`, so `getPortraitFlippingPage` sees `copy === current` and falls to `pages[i-1]`. **The bug this fork exists to kill is present in canvas mode.**                                                                                                                                                | [ImagePage.ts:120](../packages/core/src/Page/ImagePage.ts:120), [flippingPage.ts:32](../packages/core/src/Collection/flippingPage.ts:32)                                                                         |
| **A2** | No hard-page rendering. ~~`ImagePageCollection` hardcodes SOFT~~ — **corrected**: `createSpread()` _does_ mark the cover hard via `setDensity`. The real failure is that `ImagePage.draw()` ignores density and hard angles entirely, and `CanvasRender` has no hard-page path. A hard cover therefore curls like paper.                                                                  | [PageCollection.ts:70](../packages/core/src/Collection/PageCollection.ts:70), [ImagePage.ts:27](../packages/core/src/Page/ImagePage.ts:27), [CanvasRender.ts:39](../packages/core/src/Render/CanvasRender.ts:39) |
| **A3** | Bitmaps stretched to the leaf rect. No aspect preservation, no fit mode, no inset.                                                                                                                                                                                                                                                                                                        | [ImagePage.ts:49](../packages/core/src/Page/ImagePage.ts:49), [:69](../packages/core/src/Page/ImagePage.ts:69)                                                                                                   |
| **A4** | No `onerror`. A 404 spins the loader forever and emits nothing.                                                                                                                                                                                                                                                                                                                           | [ImagePage.ts:113](../packages/core/src/Page/ImagePage.ts:113)                                                                                                                                                   |
| **B1** | **No `devicePixelRatio` anywhere in the repo.** One backing pixel per CSS pixel is linearly half-resolution on a 2× display. The most visible defect in the list.                                                                                                                                                                                                                         | [CanvasUI.ts:32](../packages/core/src/UI/CanvasUI.ts:32)                                                                                                                                                         |
| **B2** | `resizeCanvas()` truncates fractional layout sizes and has no zero-size handling. _(The r1 "`NaN` when `display:none`" claim is withdrawn — unverified, and browsers commonly resolve a hidden box to `0px`.)_                                                                                                                                                                            | [CanvasUI.ts:33](../packages/core/src/UI/CanvasUI.ts:33)                                                                                                                                                         |
| **C1** | The rAF loop reschedules unconditionally, so `drawFrame()` runs forever on an untouched book. **Repo-wide — this affects HTML mode too, not just canvas.**                                                                                                                                                                                                                                | [Render.ts:129](../packages/core/src/Render/Render.ts:129), [:151](../packages/core/src/Render/Render.ts:151)                                                                                                    |
| **D1** | No accessibility. Caveat: keyboard and live region live in the **React binding**, not core, so "parity" must name which layer owns what.                                                                                                                                                                                                                                                  | [CanvasUI.ts:18](../packages/core/src/UI/CanvasUI.ts:18), [HTMLFlipBook.tsx:493](../packages/react/src/HTMLFlipBook.tsx:493)                                                                                     |
| **G1** | **Canvas clip state leaks across frames.** The portrait clip at the end of `drawFrame()` has no `save()`/`restore()` around it. It cannot affect the current frame; it constrains every _subsequent_ frame, including the next `clear()`, and repeated clips intersect. Correctness currently depends on canvas resizing implicitly resetting context state.                              | [CanvasRender.ts:66](../packages/core/src/Render/CanvasRender.ts:66)                                                                                                                                             |
| **G2** | **Transparent images defeat `pageBackground`.** `clear()` fills the canvas, but `ImagePage.draw()` paints the turning bitmap straight over the already-painted bottom page. Transparent PNG pixels reveal the page beneath — the §4.2 read-through bug the setting exists to prevent. The turning leaf must fill its own clipped, transformed area with `foldFill(pageBackground)` first. | [ImagePage.ts:34](../packages/core/src/Page/ImagePage.ts:34), [CanvasRender.ts:184](../packages/core/src/Render/CanvasRender.ts:184)                                                                             |
| **G3** | **Eager resource model.** Every page constructs an `HTMLImageElement` and sets `src` at load, so a 500-page book starts 500 fetches immediately. No lazy window, no eviction. _(Decoded-memory totals are deliberately not asserted — browsers evict. The eager network behaviour is what is definite.)_                                                                                  | [ImagePage.ts:20](../packages/core/src/Page/ImagePage.ts:20), [ImagePageCollection.ts:23](../packages/core/src/Collection/ImagePageCollection.ts:23)                                                             |
| **G4** | **`destroy()` releases nothing.** It stops rendering and removes UI but never nulls the collection or render, and `PageCollection.destroy()` only drops its array — no per-page disposal, no load cancellation. A retained destroyed engine retains every image.                                                                                                                          | [PageFlip.ts:64](../packages/core/src/PageFlip.ts:64), [PageCollection.ts:50](../packages/core/src/Collection/PageCollection.ts:50)                                                                              |
| **G5** | **Mode lifecycle is unsafe.** `PageFlip.clear()` casts the active UI to `HTMLUI` unconditionally — in canvas mode `CanvasUI` has no `clear()`, so this throws. `updateFromImages()` can also run while HTML mode is active (building image pages against `HTMLRender`) and vice versa.                                                                                                    | [PageFlip.ts:290](../packages/core/src/PageFlip.ts:290)                                                                                                                                                          |
| **G6** | **Shrinking `updateFromImages()` leaves stale render state.** `replacePages()` preserves the old index; `show()` silently returns when it exceeds the new collection, so the render keeps holding old left/right pages and their images.                                                                                                                                                  | [PageFlip.ts:127](../packages/core/src/PageFlip.ts:127), [PageCollection.ts:253](../packages/core/src/Collection/PageCollection.ts:253)                                                                          |
| **F1** | No React binding for images mode.                                                                                                                                                                                                                                                                                                                                                         | [react/src/index.ts](../packages/react/src/index.ts)                                                                                                                                                             |
| **F2** | No browser coverage — jsdom with a mocked 2d context, which is how #44 and #56 shipped broken.                                                                                                                                                                                                                                                                                            | [canvas-mode.test.ts](../packages/core/tests/canvas-mode.test.ts)                                                                                                                                                |
| **F3** | No example uses canvas mode.                                                                                                                                                                                                                                                                                                                                                              | `examples/`                                                                                                                                                                                                      |
| **F4** | README advertises the back-curl fix unqualified, which A1 makes false for canvas.                                                                                                                                                                                                                                                                                                         | [README.md:3](../README.md:3), [:18](../README.md:18)                                                                                                                                                            |

### Reclassified

| #      | Was                                                                                 | Now                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A5** | Defect — `getTemporaryCopy()` returns `this` where the base declares `Page \| null` | **Contract cleanup, folded into Phase 2.** Semantically dishonest but not currently harmful: the only caller is [HTMLRender.ts:338](../packages/core/src/Render/HTMLRender.ts:338), which operates on `HTMLPage`s. Canvas never calls it.                                                                                                                            |
| **E2** | Defect — leaf-clip eats the edge, forcing a 2.8% downstream inset                   | **Investigation only.** No repository evidence; it violates this plan's own no-guess rule. Do not promise to delete the downstream workaround before reproducing it.                                                                                                                                                                                                 |
| **G7** | —                                                                                   | **Not a current bug, but a Phase 2 constraint.** Cached `onload` is not missed today: `src` is set in the constructor and `load()` runs in the same synchronous script, which the HTML Standard guarantees is safe. It becomes a hazard once Phase 2 introduces temporary copies of already-complete images — so install handlers before `src` and check `complete`. |

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

| #   | Phase                                                             | Status |
| --- | ----------------------------------------------------------------- | ------ |
| 0   | Browser harness + CI wiring                                       | `todo` |
| 1   | Canvas frame-state correctness (G1) + DPR/sizing (B1, B2)         | `todo` |
| 2   | A1 portrait BACK + shared image resource (A5, G7)                 | `todo` |
| 3   | Freeze the `ImagePageSource` public contract                      | `todo` |
| 4   | Resources: errors, lazy window, disposal, mode guards (A4, G3–G6) | `todo` |
| 5   | Fit / inset / page-local opaque paper (A3, G2)                    | `todo` |
| 6   | Hard-page rendering (A2)                                          | `todo` |
| 7   | Accessibility (D1)                                                | `todo` |
| 8   | Idle scheduler (C1)                                               | `todo` |
| 9   | React `ImageFlipBook` (F1)                                        | `todo` |
| 10  | E2 investigation, examples, docs, migration (F3, F4)              | `todo` |

Phase 0 first because jsdom is how #44 and #56 shipped. Frame-state and sizing
precede the portrait fix because a leaking clip and a half-resolution buffer
would corrupt any pixel assertion Phase 2 depends on. The idle scheduler lands
late because it is the most regression-prone change in the plan.

**Phase 0 must additionally cover:** DPR 2×, transparent PNGs, hard covers, RTL,
reduced motion, update/shrink, destroy, and portrait↔landscape resize.

### Phase 8 — the scheduler contract (replaces r1's "dirty flag")

C1 is the phase most likely to break the product. It is specified, not sketched:

- `requestDraw()` schedules **one** rAF when none is pending.
- Continue scheduling only while an animation — or an intentionally animated
  loading state — is active.
- Animation `startedAt` derives from the **resumed** frame clock, never a stale
  `this.timer`.
- `startAnimation(…, 0, …)` runs the final action and callback **synchronously**
  (the `flippingTime: 0` invariant), then schedules exactly one post-callback draw.
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
| Plan r2 | —                                          | —                   | —          |
