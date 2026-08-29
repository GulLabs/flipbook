# Canvas as a first-class renderer

Owner decision, 2026-08-29: canvas mode stops being an inherited half-feature
and becomes a supported renderer with the same bar as HTML mode — same fixes,
same tests, same accessibility, same React support.

Working rules: [`AGENTS.md`](../AGENTS.md). Architecture: [`CLAUDE.md`](../CLAUDE.md).
Every phase is one PR-sized unit, green `pnpm quality:ci`, and a **Codex signoff**
before the next starts.

## Why this is not a small job

Canvas mode was inherited from upstream StPageFlip and has never been held to
this fork's standards. Every item below was verified by reading the shipped
code, not inferred:

| #      | Defect                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Portrait BACK uses upstream's previous-leaf slide-in. `ImagePage.newTemporaryCopy()` returns `this`, so `getPortraitFlippingPage` sees `copy === current` and falls to `pages[i - 1]`. **The bug this fork exists to kill is present in canvas mode.**                                                       | [ImagePage.ts:120](../packages/core/src/Page/ImagePage.ts:120), [flippingPage.ts:33](../packages/core/src/Collection/flippingPage.ts:33) |
| **A2** | No hard pages. `ImagePageCollection` hardcodes `PageDensity.SOFT`, so `showCover` yields a cover that curls like paper instead of swinging like card.                                                                                                                                                        | [ImagePageCollection.ts](../packages/core/src/Collection/ImagePageCollection.ts)                                                         |
| **A3** | Bitmaps are stretched to the leaf rect — `drawImage(img, 0, 0, pageWidth, pageHeight)`. No aspect preservation, no fit mode, no paper inset. A 1600×2400 page in a leaf of a different ratio is distorted.                                                                                                   | [ImagePage.ts:52](../packages/core/src/Page/ImagePage.ts:52), [:72](../packages/core/src/Page/ImagePage.ts:72)                           |
| **A4** | No `onerror`. A 404 page spins the loader forever and emits no event.                                                                                                                                                                                                                                        | [ImagePage.ts:113](../packages/core/src/Page/ImagePage.ts:113)                                                                           |
| **A5** | `getTemporaryCopy()` returns `this` where the base declares `Page \| null`. Callers that null-check receive a truthy non-copy.                                                                                                                                                                               | [ImagePage.ts:124](../packages/core/src/Page/ImagePage.ts:124), [Page.ts:187](../packages/core/src/Page/Page.ts:187)                     |
| **B1** | **No `devicePixelRatio`.** The backing store is sized in CSS pixels, so on a 2× display every page renders at half resolution. For an image renderer this is the most visible defect in the list.                                                                                                            | [CanvasUI.ts:32](../packages/core/src/UI/CanvasUI.ts:32)                                                                                 |
| **B2** | `resizeCanvas()` `parseInt`s computed width/height — `NaN` when the block is `display:none`, and it truncates fractional layout sizes.                                                                                                                                                                       | [CanvasUI.ts:33](../packages/core/src/UI/CanvasUI.ts:33)                                                                                 |
| **B3** | The constructor writes `wrapper.innerHTML`, then queries `inBlock.querySelector('canvas')` — which can match a canvas the host already had rather than its own.                                                                                                                                              | [CanvasUI.ts:20](../packages/core/src/UI/CanvasUI.ts:20)                                                                                 |
| **C1** | The rAF loop never idles. `render()` calls `drawFrame()` every frame for the life of the book, so canvas does a full clear + `drawImage` + gradient composite at 60 fps on a book nobody is touching.                                                                                                        | [Render.ts:155](../packages/core/src/Render/Render.ts:155)                                                                               |
| **D1** | No accessibility of any kind. No per-page alt text, no fallback DOM, no live region. None of the HTML-mode a11y work transfers.                                                                                                                                                                              | [CanvasUI.ts:18](../packages/core/src/UI/CanvasUI.ts:18)                                                                                 |
| **E1** | Safari. HTML mode carries a workaround for [webkit#126207](https://bugs.webkit.org/show_bug.cgi?id=126207) (clip-path dropped on a 3D-transformed element at angle 0) that has no test proving it is still needed or correct. Canvas has no equivalent audit.                                                | [HTMLPage.ts:114](../packages/core/src/Page/HTMLPage.ts:114)                                                                             |
| **E2** | Suspected leaf-clip inset bug. The downstream reader shrinks every page by 2.8% (`LEAF_INSET_FRAC`) because "page-flip clips the leaf hard; without inset, 0.18in folios vanish". If the clip polygon is short of the element box, that is an engine bug and the workaround should be deletable. Unverified. | downstream `reader-flip.ts:307`                                                                                                          |
| **F1** | No React binding. Zero references to images mode in `packages/react/src`; `@gullabs/react-flipbook` consumers cannot reach canvas at all.                                                                                                                                                                    | —                                                                                                                                        |
| **F2** | No browser coverage. `flip-invariants`, `gestures` and `golden-flip` never touch canvas; it is jsdom-only with mocked 2d contexts — which is how #44 and #56 survived to be found in week one.                                                                                                               | `e2e/`                                                                                                                                   |
| **F3** | No example uses canvas mode.                                                                                                                                                                                                                                                                                 | `examples/`                                                                                                                              |
| **F4** | The README advertises "the mobile back-curl finally fixed" without qualifying that A1 makes this false in canvas mode.                                                                                                                                                                                       | [README.md](../README.md)                                                                                                                |

## Ambiguity to resolve with the owner

"The Safari bug" could mean **E1** (the existing webkit#126207 workaround) or
**E2** (the leaf-clip inset that forces a downstream workaround). They are
different bugs in different code. This plan covers **both**, because neither is
expensive and leaving either out would make "first class" untrue.

## Standing rule: every line read is a line audited

This plan started as three defects. It reached fifteen because reading
`ImagePage` to fix the portrait curl meant reading `CanvasUI` next, which
surfaced the `devicePixelRatio` gap (B1) — the most visible defect in the list,
which nobody was looking for.

So: **while fixing any defect here, audit every line you read, not just the
lines you change.** A phase that touches a file owns what it found in that file.

- New defects found mid-phase get **appended to the inventory table with
  evidence** (file:line), immediately, before deciding what to do about them.
- Fix it in place only when it is in the same failure family and the fix is
  small. Otherwise it becomes its own phase — do not silently widen a PR, and
  do not silently drop the finding either.
- Record findings even when they will not be fixed now. An unrecorded bug is
  indistinguishable from one nobody noticed, and this codebase already lost
  #44 and #56 that way.
- Do not report a defect without a file:line and a stated failure mode. This
  session's cost centre was unverified claims (a "27 kB" upstream baseline that
  was really 44 kB, a "73% larger" figure derived from it); a guess recorded as
  a finding is worse than no finding.

## Phases

Ordering rationale: correctness before quality before infrastructure, and the
browser harness lands early because every later phase needs it to prove
anything. A1/B1 are the two defects a user would actually see.

### Phase 0 — Browser harness for canvas · `todo`

Nothing below can be honestly verified without this, and jsdom is what let #44
and #56 ship.

- Canvas fixture page in `e2e/` with real images (deterministic solid-colour
  PNGs so pixel assertions are exact).
- Chromium + WebKit specs asserting: pages appear, a forward turn advances,
  a back turn advances backwards, no page is painted twice.
- Pixel probes via `canvas.toDataURL()` / `getImageData` rather than golden
  screenshots, so assertions state _what_ is true, not "it looks the same".

**Exit:** canvas has browser coverage on both engines; the A1 test below can be
written as a failing test first.

### Phase 1 — A1: portrait BACK on canvas · `todo`

The flagship fix, absent in canvas mode.

- `ImagePage.newTemporaryCopy()` returns a real second page sharing the already
  decoded `HTMLImageElement` (no second network request) with its own
  `PageState`. Hard pages keep returning `this`, matching `HTMLPage`.
- `getTemporaryCopy()` / `hideTemporaryCopy()` get honest semantics (A5).
- `shouldDrawBottomPage` then behaves correctly because the mover is no longer
  the leaf beneath it.
- **Failing browser test first**, then the fix. The unit test must fail if
  `newTemporaryCopy` is reverted to `return this`.

**Exit:** canvas portrait BACK curls the current leaf away, proven in Chromium
and WebKit; README's claim becomes true for both renderers.

### Phase 2 — B1/B2/B3: rendering quality · `todo`

- Size the backing store by `devicePixelRatio` and scale the context, so pages
  render at native resolution. Cap the ratio (memory: a 3× retina spread is
  substantial) and re-evaluate on `resize` and DPR change
  (`matchMedia('(resolution: …)')`).
- Replace `parseInt(getComputedStyle(...))` with the measured box, handling a
  zero/hidden block without producing `NaN`.
- Scope the canvas lookup to the element the UI created.

**Exit:** a canvas book is pixel-sharp on a 2× display; a hidden-then-shown book
sizes correctly.

### Phase 3 — A3: fit modes and paper · `todo`

Canvas must be able to express what an HTML leaf expresses, or "first class" is
a slogan. Minimum: preserve aspect ratio (`contain`), fill (`cover`), and an
optional uniform inset over `pageBackground` paper.

Design note: this is new public API surface (a per-book or per-page fit mode).
It needs a settings shape agreed before implementation, not invented mid-patch.

**Exit:** a 1600×2400 image in a non-matching leaf is not distorted.

### Phase 4 — A4 + D1: failures and accessibility · `todo`

- `onerror` → a typed `PageFlipError`, a `pageLoadError` event, and a drawn
  failure state instead of an eternal spinner.
- Accessibility: the canvas gets `role="img"` plus a per-spread accessible name
  driven by caller-supplied alt text, and images mode accepts
  `{ src, alt }` rather than bare strings. Keyboard and live-region parity with
  the HTML path.

**Exit:** a 404 page is reported, not spun; a screen reader announces what
spread is open.

### Phase 5 — C1: idle · `todo`

Stop repainting a book nobody is touching. Dirty-flag the render loop: draw on
animation frames, on state change, on resize, and on image load — then park.

Risk: this touches both renderers and is the most likely phase to introduce a
"the book stopped updating" regression. It lands last among engine work, behind
the Phase 0 harness, and needs a test that a late-loading image still appears.

**Exit:** an idle book consumes no per-frame work; no visual regression in
either renderer.

### Phase 6 — E1/E2: Safari and the leaf clip · `todo`

- Pin the webkit#126207 workaround with a WebKit test that fails when the
  workaround is removed. If it does not fail, the workaround is stale and goes.
- Investigate E2: render a leaf with a known 1 px border, measure what survives
  the clip in both engines, and determine whether `LEAF_INSET_FRAC` downstream
  is compensating for an engine defect. If it is, fix it here and delete the
  workaround downstream.

**Exit:** both Safari behaviours are characterised by tests rather than
folklore.

### Phase 7 — F1: React binding · `todo`

Expose images mode through `@gullabs/react-flipbook`. Open question to settle
first: whether that is a prop on `HTMLFlipBook` or a separate component, given
React's value in HTML mode is owning the page DOM — which canvas removes.

**Exit:** canvas is reachable from React without dropping into core.

### Phase 8 — F3/F4: examples and docs · `todo`

- One example using canvas mode.
- README states what each renderer is for and what it costs; the back-curl
  claim is either true for both or scoped.
- `CHANGELOG.md` entries reference upstream issues; `MIGRATION.md` covers any
  new API from Phases 3, 4 and 7.

**Exit:** a consumer can tell which renderer they want without reading source.

## Non-goals

- WebGL / three.js — see [`WEBGL_RENDERER.md`](./WEBGL_RENDERER.md), deferred.
- Making canvas the default. HTML stays the default renderer.
- Per-capability bundle budgets. Canvas stays a lazy chunk; the boundary is
  enforced by assertion in `scripts/pack-html-engine.mjs`, and it is the growth
  of _that chunk_ that this work will move.

## Budget impact

Phases 1–5 add code to the canvas chunk, which HTML-only consumers never
download. The gates that matter here are the architectural ones — canvas must
not leak into the eager graph — not the raw/brotli/gzip ceilings, which measure
the HTML engine. Expect the canvas chunk to grow substantially and say so in
each commit, per `AGENTS.md` §2.

## Signoffs

| Phase | Codex job | Verdict | Date |
| ----- | --------- | ------- | ---- |
| Plan  | —         | —       | —    |
| 0–8   | —         | —       | —    |
