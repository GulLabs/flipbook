# Product bugs & consumer-audit findings

**Date:** 2026-08-30 (updated same day — consumer audit pass)  
**File:** `docs/reviews/test-writing-product-bugs-2026-08-30.md`

**Method:** Act as a real product consumer of `@gullabs/flipbook-core` +
`@gullabs/react-flipbook`. Use only the **published** package entry. Cross-check
README / MIGRATION claims against runtime. Pin failures in tests where possible.

Each entry: severity, failure mode, `file:line` when known, test status.

---

## How a real consumer wants to use this library

| Need                                  | Wanted API                                                     | Status                              |
| ------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| Mount a book, know when it is ready   | `isReady()`, `ready` / `loaded`                                | **OK**                              |
| Page counter / TOC / scrubber         | `getVisiblePages()`, `getCurrentPageIndex()`, `getPageCount()` | **OK** (new façade)                 |
| Enable/disable next/prev chrome       | `canTurn('next'\|'prev')`                                      | **OK** (spread-bounded)             |
| Programmatic next/prev with animation | `flipNext` / `flipPrev`                                        | **BROKEN in jsdom unit env — P7**   |
| Jump without animation (deep link)    | `turnToPage`                                                   | **OK**                              |
| Controlled React page                 | `page` + `onPageChange` + `pageTransition`                     | Covered by React suites             |
| Built-in a11y controls                | `controls`, `controlLabels`                                    | **OK** (skip-link default)          |
| RTL                                   | `readingDirection: 'rtl'`                                      | Setting OK; fold path same as P7    |
| Reject bad config early               | `PageFlipError` + `setting` key                                | **OK** for most; D3 incomplete — P0 |
| One-shot listeners                    | `once()`                                                       | **OK**                              |
| Detach one of two flip handlers       | `off(event, fn)`                                               | **OK**                              |
| Portal React children into engine     | `getBlockElement()`                                            | **OK**                              |
| Offline validate settings without DOM | `new Settings().resolve(...)`                                  | **GONE from package entry — P8**    |

---

## P0 — D3 `pageBackground` still treats unknown syntax as opaque

**Severity:** Major (claimed fix incomplete)

**Failure mode:** `Settings.resolve` only rejects when `isOpaquePageBackground`
is false (`packages/core/src/Settings.ts`). That helper returns **true** for any
string with no recognised alpha (`packages/core/src/Render/pageBackground.ts`).
Modern / junk values (`oklch(...)`, `color-mix(...)`, `var(--x)`,
`red;position:fixed`) pass construction. Draw-time `foldFill` silently
substitutes white.

**Test status:** Translucent legacy colours throw (consumer-audit + settings).
Unknown-syntax silent-white is **not** fixed.

---

## P1 — `GeometryAbort` (historical; partially fixed)

**Severity:** Was Major; **now wired** in `FlipCalculation.calc` via
`isGeometryAbort` (`packages/core/src/Flip/FlipCalculation.ts`).

**Remaining issue:** real geometry faults still surface as **`PageFlipError`
`COLLINEAR_SEGMENTS`** on the public `flipNext` path and become
`turnRejected` `reason: 'setup'` — see **P7**. That is not the sentinel path;
it is a hard failure presented as a soft turn refusal.

---

## P2 — `forwardRef` page children still warn as "not a host element"

**Severity:** Minor (correct mount, noisy contract)

**Failure mode:** Legitimate `forwardRef` leaves still log
`[flipbook] page child N is a component, not a host element...` while loading
successfully.

**Anchor:** `packages/react/src/HTMLFlipBook.tsx` (wrap/collect path).

**Test status:** design-tranche-critical negative control mounts; warning on stderr.

---

## P3 — React handle after out-of-band `engine.destroy()` (likely fixed)

**Severity:** Was Minor

**Status:** `runRelative` now checks `engine.isDestroyed()` and reports
`onTurnRejected` `notReady` (`HTMLFlipBook.tsx` ~527–542). Re-verify with a
dedicated test if not already in design-tranche suite.

---

## P4 — Fixture legacy setting names (fixed)

`html-book-fixture.ts` now uses `FlipOptions` names and `getBlockElement()`.

---

## P5 — `Settings.getSettings` → `resolve` (intentional break)

Documented. `Settings` class itself is **no longer on the package entry** (P8).

---

## P6 — Event payload shape break (intentional)

`ready`/`loaded`/`pagesChanged`/`flip` → `BookSnapshot`; `changeState` →
`{ state }`. README still mentions historical `onUpdate` in the “why this fork”
table with a note that 3.0 uses `pagesChanged` — OK if table is historical.

---

## P7 — **BLOCKER for consumers: `flipNext` / animated fold fails with `COLLINEAR_SEGMENTS`**

**Severity:** **Blocker** for any product that uses programmatic or gesture
turns under incomplete layout; **Major** even in real browsers if the same
math path is hit with a degenerate rect.

**Failure mode (measured 2026-08-30, jsdom):**

```text
book.isReady() === true
book.canTurn('next') === true
book.flipNext() === false
turnRejected: { reason: 'setup', code: 'COLLINEAR_SEGMENTS', direction: 'next', landedOn: 0 }
getCurrentPageIndex() stays 0
```

`turnToPage(1)` still works. So:

- README claim “flipNext turns the page” is false in the unit environment and
  any environment where the page rect / fold segments go collinear.
- `canTurn('next')` lies relative to `flipNext` success — chrome enables Next,
  click does nothing but `setup` rejection.
- Instant `flippingTime: 0` does **not** skip the broken fold math; it still
  runs `FlipCalculation` and dies.

**Root cause (measured):**

1. `portraitCurlLocal` ends the curl at `y: 0` (TOP) or `y: height` (BOTTOM) —
   collinear with the page border segment.
2. `flippingTime: 0` runs **only the last animation frame**.
3. That frame hits `intersectLines` → `PageFlipError('COLLINEAR_SEGMENTS')`.
4. `FlipCalculation.calc` only swallows `GeometryAbort`; `PageFlipError` is
   rethrown. `Helper.ts` comments still claim calc swallows collinear cases —
   that claim is false.
5. `PageFlip.requestTurn` maps the error to `turnRejected` `reason: 'setup'`,
   returns `false`, and can leave `state: 'flipping'` with the index stuck.

**Anchors:**

- Throw: `packages/core/src/Helper.ts` ~145 (`intersectLines` → `COLLINEAR_SEGMENTS`)
- Curl end: portrait curl local path (geometry module / Flip animation end)
- Catch path → refusal: `PageFlip.requestTurn` maps `PageFlipError` →
  `turnRejected` `reason: 'setup'`
- Call chain: `flipNext` → `Flip.flipNext` → `animateFlippingTo` /
  `startAnimation` → `FlipCalculation.calc`

**Blast radius:** ~70+ core unit tests and ~13 React tests that call
`flipNext` / complete an instant fold fail for this reason (not leftover API
migration). `turnToPage` still works.

**Test status:** Pinned in
`packages/core/tests/consumer-audit.test.ts`
(`BUG: flipNext from page 0 reports setup/COLLINEAR_SEGMENTS instead of turning`).
Do **not** green this by asserting `flipNext() === true` until the product is
fixed. E2E with non-zero `flippingTime` may still pass if intermediate frames
succeed — verify before claiming “jsdom only.”

**Consumer impact:**

- Keyboard / control buttons calling `flipNext` may no-op.
- `usePageFlip().flipNext` same.
- Analytics listening only for `flip` never fire on “next” clicks that hit this.

---

## P8 — `Settings` class removed from package entry without a consumer validator

**Severity:** Major for library authors / CMS config UIs; fine for in-app only

**Failure mode:** `import { Settings } from '@gullabs/flipbook-core'` is
undefined. Offline validation must construct a throwaway `PageFlip` or deep-
import (blocked by `exports`). Claim in older docs that `Settings` is public is
false.

**What is exported:** `SizeMode`, `ALL_POINTERS`, types `FlipOptions` /
`FlipSetting` / `LiveSetting` only.

**Test status:** `public-surface.test.ts` asserts `Settings` is absent from the
entry. Unit tests deep-import `../src/Settings`.

---

## P9 — Public methods that take types the package does not export

**Severity:** Major API design smell / accidental surface

**Failure mode:** `PageFlip.attachMode(ui, render, pages)` and
`replacePages(pages, current)` are still **public**, but `UI`, `Render`, and
`PageCollection` are **not** exported from the package entry. A TypeScript
consumer cannot name the arguments. The methods are only usable via `any` or
internal knowledge — the exact “extension point that type-checks and dead-ends”
the index.ts comment says was removed for the class hierarchy, recreated as
methods.

Also public: `startUserTouch` / `userMove` / `userStop` (custom input layers —
legitimate) and `getBlock()` marked `@internal` in a comment but still `public`
(dual with `getBlockElement()`).

**Test status:** consumer-audit pins `typeof attachMode/replacePages ===
'function'`. Allowlist in `public-surface.test.ts`.

---

## P10 — Docs lag the façade collapse

**Severity:** Docs / agent confusion

**Examples:**

- MIGRATION still documents `getUI` / `getRender` / `getPageCollection` /
  `getFlipController` as throwing `DESTROYED` — those getters are **gone**
  (symbol seams + `isReady` / `getBlockElement` / …).
- CLAUDE.md / older agent memory may still describe exporting internal
  algorithms; `packages/core/src/index.ts` now explicitly does not.
- README “why this fork” still says `Settings.getSettings` historically —
  fine as history if clearly past tense.

**Action:** rewrite MIGRATION lifecycle section against the live allowlist in
`public-surface.test.ts`.

---

## P11 — Dual host getters (`getBlock` vs `getBlockElement`)

**Severity:** Minor (extra surface)

**Failure mode:** Two public methods answer “where is the DOM?”

- `getBlock()` — construction host (comment says `@internal`, still public)
- `getBlockElement()` — `.stf__block` portal target (the one React needs)

Consumers will call the wrong one. Prefer documenting only `getBlockElement`
and demoting `getBlock` to a symbol or deleting it.

**Test status:** consumer-audit asserts they differ after load.

---

## P12 — Empty book / shell readiness is ambiguous

**Severity:** Minor

**Failure mode:** `loadFromHTML([])` does not fire `ready`/`loaded` (good), but
`isReady()` may still be true if a controller was wired, while `flipNext`
refuses. Consumer chrome that keys only on `isReady` will show enabled controls
for a book with no pages.

**Test status:** consumer-audit empty-shell case pins `flipNext() === false`.

---

## What is extra (candidate to remove or hide)

1. `attachMode`, `replacePages` as public (P9)
2. `getBlock` alongside `getBlockElement` (P11)
3. Raw pointer simulation trio if only UI should drive input (keep if custom
   input is a supported product)
4. Re-exporting `WidgetEvent` to React consumers who only get unwrapped payloads

---

## What is missing (consumer wishlist)

1. **Working `flipNext` / fold path** in all environments with valid layout (P7)
2. **Public settings validator** without constructing a `PageFlip` (P8)
3. **`onProgress` / animation tick** for custom chrome scrubbers
4. **Spread count / current spread index** on the façade (only via closed
   collection today) — `canTurn` helps but scrubbers want `getSpreadCount()`
5. **Stable `page` identity for landscape** when controlled prop names either
   leaf of a spread (partially handled; still a support FAQ)
6. **Documented event list** in README matching `FlipbookEventMap` exactly
   (`ready`, `loaded`, `pagesChanged`, `flip`, `changeState`,
   `changeOrientation`, `turnRejected`) — no stale `init`/`update`/`onFlip`

---

## Claims that do not hold (or hold only sometimes)

| Claim                                  | Reality                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `flipNext` turns the page              | Fails with `COLLINEAR_SEGMENTS` / `setup` in measured jsdom (P7)    |
| `canTurn('next')` means next will work | True for bounds; false for fold success (P7)                        |
| `flippingTime: 0` is instant turn      | Instant **if** the fold path runs; currently fold path errors first |
| D3 rejects bad `pageBackground`        | Only translucent legacy; not unknown CSS (P0)                       |
| `Settings` is a public API             | Not on package entry (P8)                                           |
| MIGRATION “getUI after destroy throws” | `getUI` does not exist (P10)                                        |

---

## Test files from this work

| File                                         | Role                                         |
| -------------------------------------------- | -------------------------------------------- |
| `packages/core/tests/consumer-audit.test.ts` | Public-API-only consumer scenarios + P7 pin  |
| `packages/core/tests/engine-access.ts`       | Test-only symbol seams for engine unit tests |
| `packages/core/tests/public-surface.test.ts` | Allowlist freeze after façade collapse       |
| `packages/core/tests/ssr-import.test.ts`     | Entry loads without `window`; no Settings    |
| `packages/core/tests/html-book-fixture.ts`   | Uses `getBlockElement`                       |

---

## Suggested fix order (owner / product)

1. **P7** — fold / `flipNext` collinear failure (highest user impact)
2. **P10** — MIGRATION + README alignment with live façade
3. **P9 / P11** — remove or internalize dead-end public methods
4. **P0** — D3 unknown-syntax `pageBackground`
5. **P8** — optional `validateSettings(options)` export if CMS configs matter
6. **P2** — quiet `forwardRef` warning
