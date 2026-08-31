# Product bugs found during the test round (2026-08-30)

The product source under `packages/*/src` is frozen for this round. Findings
below are real defects observed while migrating tests and e2e; they are not
fixed here. Each includes why it is a bug, how it was observed, and what a
correct fix must restore.

## BUG-1 — `lazyRadius` infinite re-render (heap exhaustion)

**Where:** `packages/react/src/HTMLFlipBook.tsx` — the lazy-window effect
(~L578–622) that builds `lazyAnchors` from `visiblePages` and calls
`setPages` inside a `useEffect` keyed on `[children, lazyAnchors, lazyRadius]`.

**What happens:** mounting

```tsx
<HTMLFlipBook width={200} height={300} flippingTime={0} lazyRadius={1}>
  {fivePages}
</HTMLFlipBook>
```

in jsdom OOMs the vitest worker within ~50s. No flip is required. The same
crash kills every test that uses `lazyRadius` in
`packages/react/tests/HTMLFlipBook.test.tsx` (early lazy window, RB3 identity,
RB7 spread reach).

**Why it is a bug:** the file itself documents the failure mode at L575–577:

> MEMOISED. This feeds an effect dependency array, and a fresh array literal
> every render re-runs that effect, which re-renders — an infinite loop that
> shows up as a heap exhaustion, not as a failing assertion.

`lazyAnchors` is memoised on `visiblePages`. If `visiblePages` is a new array
reference every render (or if `setPages` produces new `children` that change
`visiblePages` again), the effect loops: wrap → setPages → re-render → new
anchors → wrap → … The reader never gets a stable tree; the process dies.

**Why this likely regressed now:** C4 put `visiblePages` on every snapshot and
the binding derives chrome/`lazyAnchors` from the live engine list. A
reference-unstable `visiblePages` useMemo (or a `setPages` that rebuilds the
child list the engine then re-reads) closes the loop the comment warned about.

**Evidence:**

- Minimal two-test repro (mount-only + mount+flipNext) both OOM alone.
- Pre-change `HTMLFlipBook.test.tsx` already OOMed mid-file (~17/45) on the
  same worker; the early `lazyRadius` cases are the crash site.
- Non-lazy tests in the same file complete in <100 ms.

**Test status:** the four `lazyRadius` cases are `test.skip` with this bug id.
They keep the full assertion body — unskip when the binding stops looping.
Do not weaken them to "mounts without throwing".

**Correct fix (product agent):** make `visiblePages` / `lazyAnchors`
reference-stable across renders that did not change the on-screen set
(compare by value, or reuse the previous array when equal), and/or stop
`setPages` from feeding a dependency that re-triggers the same effect when
the wrapped child list is observably identical. Revert-prove by unskipping
the four tests and confirming they pass; a hostile fix that only memoises
the empty-anchors path must still fail RB3/RB7.

---

## BUG-2 — (none further blocking the type/lint gate)

Typecheck and lint failures in this round were **test/e2e drift only**:

- Event payloads still typed as bare `number` while runtime is `BookSnapshot`
- Error codes still named the deleted `INVALID_SIZE` / `INVALID_DIMENSIONS` /
  `INVALID_BOUNDS` instead of `INVALID_SETTING` + `.setting` + `.kind`
- E2e still called `getRender` / `getFlipController` after C7 symbol-keyed them
- `renderOnlyPageLengthChange` still referenced after removal
- `LiveSetting` correctly rejects `hardCovers` at the type level; the runtime
  refusal test needed a cast, not a product change

No additional product behaviour bugs were proven beyond BUG-1. Critical
deltas B1–B5 / C1–C8 already have dedicated suites
(`consumer-audit`, `instant-jump-settling`, `styling-contract`,
`inject-styles`, `spread-construction`, `public-surface`); this round added
a C7 symbol-form pin on `public-surface.test.ts`.

---

## What was deliberately not changed

- `packages/core/src/**`, `packages/react/src/**` — frozen
- `packages/core/tests/consumer-audit.test.ts` — owned by the delta work
- Foreign dirty files (`README.md`, `examples/**`) — another agent’s work;
  left untouched
