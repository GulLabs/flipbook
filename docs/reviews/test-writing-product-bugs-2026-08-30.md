# Product bugs found while writing design-tranche tests

**Date:** 2026-08-30  
**Context:** Critical-fix coverage for commits in the design-tranche hour
(`7500ffe`, `c4ecdb1`, `90aa7a9`, and follow-on signoff rounds). Tests only —
these items were observed against product code and **not** fixed in the test
pass (product tree was owned by other agents / already dirty).

Each entry has a failure mode, a `file:line` anchor where known, and whether a
test already pins the desired behaviour.

---

## P0 — D3 `pageBackground` still treats unknown syntax as opaque

**Severity:** Major (claimed fix incomplete)

**Failure mode:** `Settings.resolve` only rejects when
`isOpaquePageBackground` is false (`packages/core/src/Settings.ts` ~405–415).
That helper returns **true** for any string with no recognised alpha channel
(`packages/core/src/Render/pageBackground.ts` ~57–65), so modern / junk values
such as `oklch(...)`, `color-mix(...)`, `var(--x)`, and `red;position:fixed`
pass construction. Draw-time `foldFill` then silently substitutes white
(`pageBackground.ts` ~74–91). Codex design-tranche MAJOR on D3 — still open
after the rename.

**Test status:** Boundary throws are pinned for translucent legacy colours
(`transparent`, `rgba(...,0)`, `#fff0`, …). Unknown-syntax silent-white is
**not** green-path covered as a fix (would pass today).

---

## P1 — `GeometryAbort` is dead code (D20 incomplete)

**Severity:** Major (advertised fix not wired)

**Failure mode:** `GeometryAbort` and `isGeometryAbort` are exported from
`packages/core/src/errors.ts` (~127–139) but have **no product-code caller**.
`FlipCalculation.calc` still catches every exception and returns `false`
(`packages/core/src/Flip/FlipCalculation.ts` ~91–110); control-flow exits still
throw bare `Error`. A real `TypeError` on the pointer hot path is therefore
still swallowed — the exact D20 failure the tranche claimed to fix.

**Evidence:** `rg GeometryAbort packages/core/src` → only the definition site.

**Test status:** Not pinned (no honest product path to exercise without wiring
the sentinel first). Hostile test would need the identity check in `calc`.

---

## P2 — `forwardRef` page children still warn as "not a host element"

**Severity:** Minor (correct behaviour, noisy contract)

**Failure mode:** A page child implemented with `forwardRef` that correctly
forwards the ref to a DOM node still triggers:

```text
[flipbook] page child N is a component, not a host element...
```

from the React binding during mount. The book **does** load (ref reaches the
host), so the warning is a false positive for the legitimate D1 pattern the
docs recommend.

**Anchor:** warning path in `packages/react/src/HTMLFlipBook.tsx` (component
child detection around the wrap/collect path).

**Test status:** `design-tranche-critical.test.tsx` negative control
(`a forwardRef page child is accepted`) mounts successfully; the warning is
visible on stderr and is not asserted away.

---

## P3 — React handle after `engine.destroy()` may refuse without `onTurnRejected`

**Severity:** Minor / contract hole

**Failure mode:** `FlipBookHandle.flipNext` / `flipPrev` call through to
`engine.flipNext` when `engineRef` is still set. If the consumer destroyed the
**engine** directly (`pageFlip()!.destroy()`) without unmounting the component,
the core emits `turnRejected` on the engine's listener set — but those
listeners were dropped by `destroy()`, and the React `onTurnRejected` prop is
only bridged while handlers are bound on a live engine. The handle returns
`false` with **no** prop callback.

Unmount (clearing `engineRef`) correctly reports `notReady` via the binding's
own guard. The hole is specifically "destroy the engine out of band".

**Test status:** `flipNext/flipPrev/turnToPage after unmount` pins the unmount
path. Out-of-band destroy was attempted during the test pass and did **not**
reliably deliver `onTurnRejected`.

---

## P4 — Fixture / legacy settings names silently no-op (test debt that hid product gaps)

**Severity:** Test infrastructure (not a consumer bug, but it masked product
regressions)

**Failure mode:** `packages/core/tests/html-book-fixture.ts` still constructed
books with pre-tranche keys (`size`, `showPageCorners`, `showCover` via opts).
`Settings.resolve` ignores unknown keys, so:

- `useMouseEvents: false` did nothing → pointer tests "passed" against a book
  that still accepted mouse (until assertions checked index).
- `direction: 'rtl'` did nothing → RTL suites ran as LTR.
- `disableFlipByClick: true` did nothing → click-policy tests saw empty
  `turnRejected` arrays.
- `size: 'stretch'` + bounds under a defaulted fixed book threw only when
  bounds conflicted with fixed derivation.

**Fix in this pass:** fixture migrated to the current `FlipOptions` names;
legacy suites updated to match. Listed here so a future rename cannot silently
rot the harness again.

---

## P5 — `Settings` class lost `getSettings`; many suites still call it

**Severity:** API migration (intentional break; tests lagged)

**Failure mode:** `new Settings().getSettings(...)` throws
`TypeError: getSettings is not a function`. The method is now `resolve`.
`PageFlip#getSettings()` remains on the engine instance.

**Test status:** Migrated in the legacy suite pass. Not a product defect —
documented so agents stop "restoring" `getSettings` on `Settings`.

---

## P6 — Event payload shape break is total for listeners typed against 2.x

**Severity:** Expected breaking change; called out because half-migrated tests
looked like product bugs

**Failure mode:**

| Was                                  | Now                                               |
| ------------------------------------ | ------------------------------------------------- |
| `init` (timer, bare-ish)             | `ready` once + `loaded` per load (`BookSnapshot`) |
| `update` + `collectionRebuild`       | `pagesChanged` (`BookSnapshot`)                   |
| `flip` data as page number (binding) | `BookSnapshot` everywhere                         |
| `changeState` data as string         | `{ state: FlippingState }`                        |
| `onNavigationError` (React)          | folded into `onTurnRejected` + `landedOn`         |
| `onFlip`                             | removed; use `onPageChange`                       |
| `usePageFlip().setPage`              | `goToPage` (turns the engine)                     |

Empty `loadFromHTML([])` deliberately does **not** announce — React's portal
shell path. Suites that `await init` on an empty load hang forever.

---

## Intentionally not filed as product bugs

- jsdom normalising `clip: rect(0 0 0 0)` → `rect(0px)` — environment, not
  engine.
- Legacy test files failing while product is on the new API — test debt, fixed
  in the migration commit that accompanies this note.
- Codex design-tranche BLOCKERs already fixed in `c4ecdb1` / `90aa7a9` /
  signoff rounds — do not re-open unless a test regresses.

---

## Suggested fix order (owner / product agents)

1. **P1** — wire `GeometryAbort` through `FlipCalculation.calc` and convert
   remaining bare `Error` throws; add a revert-prove test that a `TypeError`
   propagates and a sentinel does not.
2. **P2** — treat `forwardRef` function components that return a host as
   satisfied once the ref slot is non-null; warn only when the slot stays null
   after commit (D1 already throws `DETACHED_PAGE` then).
3. **P3** — handle path: if `engine.isDestroyed()`, report `notReady` /
   `DESTROYED` through `onTurnRejected` the same way a null ref does.
