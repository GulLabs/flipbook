VERDICT: BLOCK

# C1 signoff: `c01cdbe`

Commit reviewed: `c01cdbe4c472e0a8c693ad7bb5b35da1ed9297bf`.

This commit-pinned adversarial review covers all five `resetUserGesture()`
callers, pointer-event re-entrancy, test mutants, the internal seam, surviving
state, and `pnpm quality:ci`.

## Findings

1. **BLOCK — the regression tests do not prove the cleanup is centralized in
   `resetUserGesture()`.** Both new tests settle only through
   `updateSettings({ direction: 'rtl' })` at
   `packages/core/tests/rtl-layout.test.ts:412` and `:468`, which reaches the
   fold-invalidating branch at `packages/core/src/PageFlip.ts:847-850`. A
   hostile control-flow mutant that removes the new call at
   `packages/core/src/PageFlip.ts:1301` and puts
   `this.ui?.[DROP_POINTER_GESTURE]()` immediately after that branch's
   `resetUserGesture()` passes both tests, but leaves the UI state alive for
   `replacePages` (`PageFlip.ts:467-469`), `attachMode` (`:539-556`),
   `updateFromHtml` (`:716-718`), and `clear` (`:953-963`). This is precisely
   the half-fix the shared method is meant to prevent. Add a test through at
   least one collection-replacement/clear caller, preferably a parameterized
   assertion covering all five callers, and demonstrate that the mutant fails.

2. **BLOCK — the test named “releases the CAPTURE” does not exercise browser
   pointer capture.** Its `makeHtmlBook` fixture never installs the optional
   pointer-capture shims (`packages/core/tests/html-book-fixture.ts:94-101`),
   so `onPointerDown` takes its catch path when `setPointerCapture` is absent
   (`packages/core/src/UI/UI.ts:636-655`). Consequently, a second hostile
   mutant which clears `activePointerId` but does not call
   `releasePointerCapture()` still accepts pointer 2 and passes the test at
   `rtl-layout.test.ts:462-475`, while a real browser keeps pointer 1 captured.
   Install stateful shims in this test and assert that capture was released
   (or call/has-capture state changed) by the settle.

## Targeted assessment

The implementation itself places the state where it belongs. `UI` owns
`touchPoint`, `activePointerId`, and `pointerCaptured`
(`packages/core/src/UI/UI.ts:41-63`), and the new symbol method clears the
anchor then delegates capture release to the existing idempotent routine
(`:477-500`). `PageFlip.resetUserGesture()` remains the right coordination
point: it clears the three engine fields and invokes that UI half
(`packages/core/src/PageFlip.ts:1282-1301`).

All five callers are compatible with dropping the UI half:

| Caller                                 | Assessment                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `replacePages` (`PageFlip.ts:454-500`) | The old turn and gesture are abandoned before its collection is destroyed; UI remains installed, so it must be reset.                                                                |
| `attachMode` (`:516-580`)              | It destroys the old UI before reset; a second release on that old, detached UI is idempotent. On first attach `this.ui` is null. It never reaches the incoming UI before assignment. |
| `updateFromHtml` (`:677-768`)          | It keeps the same UI while replacing pages, exactly the stale-anchor case.                                                                                                           |
| changed-settings settle (`:812-853`)   | It abandons a fold built with stale geometry before `update()` applies the changed layout; clearing the still-down pointer prevents its later release from swiping.                  |
| `clear` (`:918-973`)                   | It releases renderer/pages before clearing the HTML UI; dropping the gesture first prevents late pointer input from referring to the emptied book.                                   |

I found no normal-path surviving turn state outside this C1 seam: the settle
calls `Render.cancelAnimation()`, which clears animation, shadow, flipping and
bottom pages, and `pageRect` (`Render.ts:884-917`); `Flip.abandon()` resets its
calculation, pending target, density overrides and state (`Flip.ts:980-1030`);
and `resetUserGesture()` clears `isUserMove` as well as the touch flag
(`PageFlip.ts:1282-1285`).

The symbol seam is ordinarily unreachable: `internal.ts` is not re-exported
from `src/index.ts:5-41`, and the package export map permits only the package
root, stylesheet, and package metadata (`packages/core/package.json:17-30`).
`internal.ts:22-29` accurately documents reflection as intentionally outside
the supported contract.

For pointer-event re-entrancy, the meaningful case is a `changeState` listener
calling `updateSettings` during `onPointerMove`. The handler has no UI-state
work after `app.userMove` (`UI.ts:669-701`), so clearing the gesture there does
not resume the cancelled drag. `onPointerUp` releases its capture before
examining the swipe anchor (`:704-746`), so it is likewise safe; with the
anchor cleared it cannot take the swipe branch. A physical pointer that remains
down after a settle is intentionally abandoned and needs a fresh
`pointerdown` to start another gesture.

## Validation

- `pnpm vitest run packages/core/tests/rtl-layout.test.ts` — passed: 1 file,
  17 tests.
- `pnpm quality:ci` — failed at lint, before later stages. The failures are in
  unrelated in-progress C2 edits: forbidden non-null assertions at
  `packages/core/src/Collection/PageCollection.ts:92` and
  `packages/core/src/PageFlip.ts:543`. This gate result is for the current
  worktree, not a claim about the commit-pinned C1 diff.
