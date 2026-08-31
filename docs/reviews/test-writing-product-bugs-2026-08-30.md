# Consumer re-evaluation — bugs, gaps, and customization value

**File:** `docs/reviews/test-writing-product-bugs-2026-08-30.md`  
**Date:** 2026-08-30 (re-evaluated same day)  
**Packages:** `@gullabs/flipbook-core`, `@gullabs/react-flipbook`

This is not a laundry list of engineer taste. It is a **product-consumer**
re-read of every prior finding: who the buyer is, what they must control at
runtime, why a broken claim costs money, and what is still missing that a
shipped reader needs.

Method unchanged: published package entry only; claims checked against runtime;
failures pinned in `packages/core/tests/consumer-audit.test.ts` where possible.

---

## 1. Who the real-world consumer is

Three buyers show up repeatedly. They are not “people calling `flipNext` in a
demo.”

| Buyer                          | Product                                              | What they embed                                                                |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. Content reader**          | Story books, magazines, catalogs, comics             | Full-bleed pages, brand paper colour, RTL locales, deep links to page N        |
| **B. Learning / docs product** | Courses, manuals, onboarding carousels               | Progress chrome, keyboard, screen-reader path, “page 3 of 12”, resume position |
| **C. Design system host**      | Marketing site or app shell that already owns layout | The book must **look like the host**, not like a default white widget          |

All three treat this library as a **leaf component inside a larger UI**, not as
the whole app. That single fact drives every customization need below.

---

## 2. Why a consumer must pass styles, settings, and runtime control

### 2.1 Styles (`className`, `style`, host CSS, `FLIPBOOK_CSS`)

**Why they want it**

- The book sits in a grid/sidebar/modal that already has tokens (spacing,
  radius, shadow, dark mode). A hard-coded white rectangle breaks the shell.
- Marketing wants a cream paper fold (`pageBackground`), not `#fff`.
- Focus rings and control chrome must match the host’s a11y styling, or WCAG
  reviewers fail the page for “inconsistent focus indicator.”
- `className` / `style` on the React root is how every other design-system
  component is themed. If the engine **clobbers** `className` (it used to drop
  `stf__parent`), layout collapses mid-session — measured, fixed as MIN-8.

**What “passing styles” actually means in this codebase**

| Surface                                     | Consumer intent                                   | Value if it works                                       |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `className` / `style` on `HTMLFlipBook`     | Place and theme the root in the host layout       | Book participates in flex/grid without a wrapper hack   |
| `pageBackground`                            | Opaque paper colour under the curl                | No text bleed (the §4.2 product promise)                |
| `startZIndex` / host stacking               | Sit above/below modals, drawers                   | Avoid z-index wars                                      |
| `ensureFlipbookStyles` / `FLIPBOOK_CSS`     | SSR or CSP: inject CSS when/where the host allows | No flash of unstyled book; no inline-style ban breakage |
| Leaf content CSS (`object-fit`, typography) | Author owns page HTML                             | Library stays a turner, not a layout engine             |
| Built-in `controls` styling                 | Skip-link vs visible chrome                       | A11y without shipping a second design language          |

**Why broken styling control is bad**

If the consumer cannot own the root class/style, they wrap the book in three
divs and fight `position`/`overflow`. Support tickets become “why is my book
0 height” instead of product work. If `pageBackground` silently becomes white
(P0), brand paper is a lie and the fold shows the wrong colour — visible on
every turn.

### 2.2 Settings at construction and at runtime (`FlipOptions`, `updateSettings`)

**Why they want it**

Settings are **product policy**, not demo knobs:

| Setting                                          | Real product reason                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `flippingTime: 0` / `respectReducedMotion`       | Legal/a11y: respect OS reduced motion; deep links should not animate |
| `usePortrait` / `sizing` / min/max bounds        | Phone vs desk layout without two components                          |
| `hardCovers`                                     | Magazines vs picture books (cover is its own spread)                 |
| `readingDirection: 'rtl'`                        | Locale, not a niche flag                                             |
| `pointerInput`                                   | Kiosk: touch only; desktop article: mouse only                       |
| `flipOnClick: 'never' \| 'corners'`              | Drag-to-turn readers vs click-anywhere                               |
| `drawShadow` / `maxShadowOpacity`                | Performance on low-end devices; brand flat vs skeuomorphic           |
| `allowTouchScroll` / `respectInteractiveContent` | Pages with forms/links must not steal scroll or clicks               |
| `initialPage`                                    | Resume reading position from URL or server                           |

**Runtime `updateSettings` is not optional polish.** Host apps:

- Toggle reduced motion when the user flips an in-app a11y switch.
- Change `width`/`height` on resize or orientation without remounting (remount
  loses page + in-flight turn).
- Disable pointer turning while a paywall modal is open (`pointerInput: []`).
- Soften shadows when battery saver is on.

Without live settings, every policy change becomes **destroy + recreate**, which
fires a second `ready`, drops gesture state, and confuses analytics.

**Why weak validation is bad (P0, P8)**

- Silent wrong paper colour (P0) ships to production looking “fine” in QA on
  `#fff` fixtures and broken on brand tokens (`oklch`, `var(--paper)`).
- No public `validateSettings` (P8) means a CMS cannot reject bad JSON before
  mount. The alternative is construct-a-throwaway-`PageFlip`, which needs a DOM
  and is absurd in a Node config pipeline.

### 2.3 Runtime behaviour control (events, handle, chrome)

**Why they want it**

A reader product is 30% turner, 70% chrome:

- Progress bar, “page X of Y”, thumbnail strip → need **truthful** visible
  leaves and turn availability.
- Next/Prev buttons, keyboard, swipe → need **`flipNext` to actually turn**.
- Analytics (“user reached chapter 2”) → need `flip` / `onPageChange`, not
  silent no-ops.
- Error UX (“couldn’t open that link”) → need `turnRejected` with a reason a
  human can map, not `setup` + internal geometry codes.
- Controlled URL `?page=4` → need `page` + `pageTransition: 'instant'` without
  fighting the engine.

**Events a consumer wires in production**

| Event                             | Chrome use                                  |
| --------------------------------- | ------------------------------------------- |
| `ready` / `onReady`               | Hide skeleton, enable buttons once          |
| `loaded` / `onLoaded`             | “Book replaced” after CMS fetch             |
| `pagesChanged` / `onPagesChanged` | Rebuild TOC when chapter list changes       |
| `flip` / `onPageChange`           | Sync URL, analytics, progress               |
| `changeOrientation`               | Swap portrait/landscape chrome              |
| `changeState`                     | Disable buttons mid-fold; show “turning…”   |
| `turnRejected` / `onTurnRejected` | Disable Next at end; toast on bad deep link |

If `flipNext` fails while `canTurn('next')` is true (P7), **every** chrome
path above lies: buttons stay enabled, analytics under-count, keyboard feels
broken, and the bug is blamed on the host app.

---

## 3. Re-evaluated findings

Each item answers four questions:

1. **Is it still real?**
2. **Why is it bad for a real product?**
3. **What is missing / what value does a fix unlock?**
4. **Evidence / test pin**

Closed or intentional items are marked so they stop consuming attention.

---

### P7 — BLOCKER: `flipNext` / instant fold dies on `COLLINEAR_SEGMENTS`

|                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**            | **Yes.** Measured: ready book, `canTurn('next')===true`, `flipNext()===false`, `turnRejected { reason:'setup', code:'COLLINEAR_SEGMENTS' }`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Why bad**                | This is the **primary verb** of the library. A page-flip that cannot flip is not a niche edge case — it is the product. Host chrome (built-in controls, `usePageFlip().flipNext`, keyboard, custom Next buttons) all call this path. `canTurn` enabling Next while `flipNext` no-ops is worse than a throw: users click a live control and nothing happens, with no host-level error. Instant turns (`flippingTime: 0`, reduced motion) are **exactly** the path a11y and deep links need — and that path only runs the last animation frame, which is the collinear one. |
| **Missing / value of fix** | A fold completion that does not throw on the terminal pose; or treat collinear end as success/`GeometryAbort`. Unlocks: trustworthy chrome, reduced-motion compliance, keyboard, analytics, and the ~70 unit tests that currently fail for this reason alone.                                                                                                                                                                                                                                                                                                             |
| **Evidence**               | Root: terminal curl y equals page edge → `Helper.intersectLines` → `COLLINEAR_SEGMENTS`; `FlipCalculation` only swallows `GeometryAbort`. Pin: `consumer-audit.test.ts` “BUG: flipNext…”.                                                                                                                                                                                                                                                                                                                                                                                 |

**Consumer story:** Learning product ships “Next” + ArrowRight. QA on a real
phone with non-zero duration may pass intermediate frames; CI and reduced-motion
users hit the last frame only and stall on page 0. Support cannot reproduce
without reduced motion on.

---

### P0 — `pageBackground` accepts modern/junk colour, paints white

|                     |                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes** for unknown syntax; translucent legacy colours do throw.                                                                                                                                                                                                                                                                                                                                              |
| **Why bad**         | Paper colour is a **brand and readability** contract (opaque fold). Design tokens in 2026 are `oklch`, `color-mix`, `var(--paper)`. Accepting them at the boundary and substituting white at draw time means: construction succeeds, every QA screenshot on default fixtures is green, production brand builds show the wrong paper and/or bleed. Silent visual wrongness is the most expensive class of bug. |
| **Missing / value** | Boundary rejection (or real parsing) for non-legacy colours, with `INVALID_SETTING` + `setting: 'pageBackground'`. Unlocks safe CMS/theme integration and honest fail-fast config.                                                                                                                                                                                                                            |
| **Evidence**        | `isOpaquePageBackground` treats “no alpha channel” as opaque; `foldFill` falls back to white.                                                                                                                                                                                                                                                                                                                 |

**Consumer story:** Design system passes `pageBackground: 'var(--color-paper)'`.
Book mounts. Folds look white. Designer files “engine ignores token.” Engineer
finds silent substitution after a day of CSS debugging.

---

### P8 — No public settings validator (`Settings` off the package entry)

|                     |                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes.** `import { Settings } from '@gullabs/flipbook-core'` is not on the entry. Types `FlipOptions` / `LiveSetting` remain.                                                                                                                                                                                                                                     |
| **Why bad**         | Buyer C and CMS pipelines validate config **before** they have a document. Without a pure function or class on the entry, they either (a) mount a throwaway engine (needs DOM, slow, side-effecting), or (b) reimplement validation and drift from the engine. Runtime `updateSettings` failures in a live book are worse than compile-time or pre-flight errors. |
| **Missing / value** | e.g. `validateFlipOptions(partial): FlipSetting` or re-export `Settings.resolve`. Unlocks config UIs, storybook knobs, and server-side “is this book JSON publishable?”                                                                                                                                                                                           |
| **Evidence**        | `public-surface.test.ts` asserts `Settings` absent from entry.                                                                                                                                                                                                                                                                                                    |

**Note:** Removing the class from the entry is a valid packaging choice. The
**gap** is not “export the class for purity” — it is “give consumers _some_
supported preflight that shares the engine’s rules.”

---

### P9 — Public `attachMode` / `replacePages` with unexported argument types

|                     |                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes.** Methods public; `UI` / `Render` / `PageCollection` not exported.                                                                                                                                                                                                                      |
| **Why bad**         | Accidental surface. TypeScript consumers cannot call them without `any`. That trains people to cast, which then reaches real internals. Docs that say “the façade is the API” are contradicted by the `.d.ts`. Support cost: “how do I replacePages?” has no honest answer except “you don’t.” |
| **Missing / value** | Either **delete/internalize** (symbol) or export a **supported** high-level API (`replaceHtmlPages(els)` already exists as `updateFromHtml`). Value is a smaller, teachable surface and fewer false extension points.                                                                          |
| **Evidence**        | `public-surface.test.ts` allowlist; consumer-audit pins methods exist.                                                                                                                                                                                                                         |

`startUserTouch` / `userMove` / `userStop` are different: a **custom input
layer** (gamepad, remote control, canvas overlay) is a real product need. Keep
those; document them as the supported escape hatch.

---

### P2 — `forwardRef` page children warn falsely

|                     |                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes** (noise while mount succeeds).                                                                                                                                                             |
| **Why bad**         | Design systems wrap pages in `forwardRef` primitives (`<Page as={Box}>`). Console warnings on every mount fail CI log policies, scare engineers, and hide real `DETACHED_PAGE` failures in noise. |
| **Missing / value** | Warn only when the ref slot is still null after commit (D1 already throws then). Quiet happy path.                                                                                                |
| **Evidence**        | design-tranche-critical forwardRef control; stderr warning.                                                                                                                                       |

---

### P10 — Docs lag the façade collapse

|                     |                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes** for MIGRATION lifecycle text still naming `getUI` / `getRender` / …                                                             |
| **Why bad**         | Adopters follow MIGRATION and write code that does not typecheck. Agents “restore” deleted getters. Trust in the rest of the doc drops. |
| **Missing / value** | Single source of truth = `public-surface.test.ts` allowlist + short “supported façade” section in README/MIGRATION.                     |
| **Evidence**        | MIGRATION destroy section vs live `PageFlip` public list.                                                                               |

---

### P11 — Dual `getBlock` vs `getBlockElement`

|                     |                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Still real?**     | **Yes.**                                                                                                                                                                                                                                                                                               |
| **Why bad**         | React portals need `.stf__block` (`getBlockElement`). Construction host is `getBlock`. Calling the wrong one is a silent layout bug (portal into host → React parent mismatch → `NotFoundError` class of failure). Two names for “the DOM node” without a one-line doc rule guarantees the wrong call. |
| **Missing / value** | One documented portal target; demote or rename the other (`getHostElement` vs `getPageHost`).                                                                                                                                                                                                          |
| **Evidence**        | consumer-audit: after load they are different nodes.                                                                                                                                                                                                                                                   |

---

### P12 — Empty shell vs `isReady`

|                     |                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real?**     | **Yes** as ambiguity.                                                                                                                                                                     |
| **Why bad**         | React mounts `loadFromHTML([])` then fills pages. Chrome that enables Next on `isReady` alone can flash enabled controls on a zero-page shell. Combined with P7, “ready” is not “usable.” |
| **Missing / value** | Document: usable ⇒ `isReady() && getPageCount() > 0` (and after P7, successful turn path). Optional `isInteractive` helper.                                                               |
| **Evidence**        | consumer-audit empty shell; React portal mount pattern.                                                                                                                                   |

---

### P1 — `GeometryAbort` (mostly closed; residual is P7)

|                                 |                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still real as original D20?** | **Partially fixed** — `FlipCalculation` uses `isGeometryAbort`.                                                                                                                        |
| **Why residual is bad**         | Collinear end is a **`PageFlipError`**, not a sentinel abort, so it becomes `turnRejected` `setup` (P7). Callers cannot distinguish “user at end of book” from “engine math exploded.” |
| **Value of finishing**          | Map geometry completion to abort/success, not `setup`.                                                                                                                                 |

---

### P3 — Destroyed engine + React handle (likely closed)

|                     |                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Still real?**     | **Likely fixed** (`isDestroyed()` in `runRelative`).                                                               |
| **Why it mattered** | Out-of-band `pageFlip()!.destroy()` returned `false` with no `onTurnRejected` — chrome could not show “book gone.” |
| **Action**          | Keep a regression test; do not re-open unless it fails.                                                            |

---

### P4–P6 — Intentional / fixed migration debt

| ID  | Status      | Consumer note                                                 |
| --- | ----------- | ------------------------------------------------------------- |
| P4  | Fixed       | Fixture uses real `FlipOptions` names                         |
| P5  | Intentional | `resolve` not `getSettings` on Settings class                 |
| P6  | Intentional | One `BookSnapshot` shape — good for consumers once docs match |

---

## 4. What is extra (costs more than it helps)

| Extra                                                  | Why a consumer does not need it | Prefer                                        |
| ------------------------------------------------------ | ------------------------------- | --------------------------------------------- |
| Public `attachMode` / `replacePages` with secret types | Cannot call safely              | `updateFromHtml` only                         |
| `getBlock` + `getBlockElement` without naming          | Wrong portal target             | One name                                      |
| Re-exporting `WidgetEvent` to React                    | Handlers already unwrapped      | Drop from React entry or document “core only” |
| Console warn on successful `forwardRef` pages          | Noise                           | Warn on null slot only                        |

Extra API is not free: it appears in autocomplete, gets used, and becomes
semver forever.

---

## 5. What is missing (and why it is worth building)

Prioritized by **product value**, not elegance.

| Missing capability                                                         | Who needs it            | Why it brings value                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **P7 fix — working animated / instant fold**                               | Everyone                | Core verb; without it chrome and a11y paths are theater                                                              |
| **Honest turn result** (`canTurn` ≈ `flipNext` success, or progress event) | Chrome authors          | Buttons and keyboard stay consistent                                                                                 |
| **Preflight `validateFlipOptions`**                                        | CMS / design systems    | Fail in CI before paint                                                                                              |
| **Strict or real `pageBackground` tokens**                                 | Brand / dark mode       | Paper colour is a visible brand surface                                                                              |
| **`getSpreadCount` / current spread index**                                | Scrubbers, PDF-like UI  | `canTurn` is boolean; scrubbers need position in spread space                                                        |
| **`onProgress` or frame tick** (optional)                                  | Custom animation chrome | Drive scrubber thumb during turn without rAF hacking                                                                 |
| **Documented customization recipe**                                        | All buyers              | “How do I theme controls, paper, z-index, reduced motion” in one place                                               |
| **Control styling hooks**                                                  | Design systems          | Today: unstyled buttons + skip-link CSS. Need classNames or slot/`renderControls` so hosts do not fork the component |
| **Clear “portal here” API doc**                                            | React hosts             | One sentence: always `getBlockElement()`                                                                             |

### Controls styling specifically

Built-in controls exist because browse-mode AT users cannot use arrows (H4).
That is correct product. What is still thin:

- Default is visually hidden until focus — good for layout, bad if the host
  wants always-visible branded buttons without `controls="visible"` + full
  custom CSS against `data-flipbook-control`.
- There is no `controlsClassName` / render prop. Hosts either accept naked
  buttons or set `controls="none"` and reimplement a11y (easy to get wrong).

**Value of a small styling seam:** keep H4 behaviour, let the design system
paint the buttons. That is how every other headless/a11y component library
ships (behaviour owned by lib, look owned by host).

---

## 6. Claims vs reality (consumer trust)

| Claim (README / docs / types)              | Reality                                     | Trust impact             |
| ------------------------------------------ | ------------------------------------------- | ------------------------ |
| Library flips pages (`flipNext`)           | Can no-op with `setup`/`COLLINEAR_SEGMENTS` | High — core promise      |
| `canTurn` for disabling Next               | Bounds only; not fold success               | High — chrome lies       |
| `flippingTime: 0` / reduced motion instant | Instant path still runs broken last frame   | High — a11y path         |
| Opaque `pageBackground`                    | Unknown tokens → white                      | Medium — brand           |
| Façade is the whole API                    | Dead-end public methods remain              | Medium — adopters cast   |
| MIGRATION lists current getters            | Stale `getUI` etc.                          | Medium — copy-paste fail |
| `Settings` for validation                  | Not importable from entry                   | Low–medium — CMS only    |

---

## 7. Suggested product order (re-ranked by consumer value)

1. **P7** — Make `flipNext` / instant fold complete without `COLLINEAR_SEGMENTS`.  
   _Unlocks the product._
2. **Align `canTurn` / rejection reasons** so chrome can trust the API.
3. **P0** — Honest `pageBackground` for real design tokens.
4. **P10** — Docs = live façade (stop sending adopters into deleted APIs).
5. **P8** — Supported settings preflight for config pipelines.
6. **P11 / P9** — One portal getter; hide dead-end methods.
7. **Controls styling seam** — optional, high leverage for design-system hosts.
8. **P2** — Quiet successful `forwardRef` pages.

---

## 8. Test anchors

| File                                         | Role                                         |
| -------------------------------------------- | -------------------------------------------- |
| `packages/core/tests/consumer-audit.test.ts` | Public-API consumer scenarios; **P7 pin**    |
| `packages/core/tests/public-surface.test.ts` | Façade allowlist freeze                      |
| `packages/core/tests/ssr-import.test.ts`     | Entry without `window`; no `Settings` export |
| `packages/core/tests/engine-access.ts`       | Test-only symbol seams (not public API)      |
| `packages/core/tests/html-book-fixture.ts`   | Shared harness using `getBlockElement`       |

---

## 9. One-sentence summary

A real consumer needs to **theme the shell**, **set product policy as
settings**, and **drive chrome from truthful runtime signals**; today the
biggest gap is that the **turn verb can fail while the library claims the turn
is available**, which makes every control, keyboard path, and analytics hook
built on top of it unreliable until P7 is fixed.
