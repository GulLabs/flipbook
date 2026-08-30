VERDICT: BLOCK

# Codex design tranche review

Reviewed commit `7500ffeda69ca328cc4f1f98f291afb755616c5a` against its
parent, restricted to `packages/*/src` as requested. Test code and test results
are outside this review.

## Findings

### BLOCKER — C7 treats every non-empty content replacement as a fresh opening

`updateFromHtml` destroys the outgoing collection at
`packages/core/src/PageFlip.ts:697`, then asks that already-destroyed collection
whether it was empty at `packages/core/src/PageFlip.ts:747`. `destroy()` has
emptied it, so `previous.getPageCount() === 0` is true for every replacement
whose incoming page count is nonzero. The method consequently selects
`initialPage`, calls `SEED_OPENING_INDEX`, and shows that page
(`packages/core/src/PageFlip.ts:748-763`) even for a genuine non-empty to
non-empty replacement. A live content refresh therefore jumps back to the
opening page, and the seed suppresses the `flip` announcement for that real
visible move. Capture the outgoing-empty fact before `previous.destroy()` and
use that captured value for `openingFresh`.

### BLOCKER — `pointerInput` does not filter pointer kinds

The renamed setting promises an accepted-pointer policy, but handler setup only
checks whether the array is empty and otherwise registers one unfiltered Pointer
Events path (`packages/core/src/UI/UI.ts:349-357`). `onPointerDown` checks the
mouse button and target, but never tests `e.pointerType` against `pointerInput`
before claiming the gesture (`packages/core/src/UI/UI.ts:630-667`). Thus
`pointerInput: ['touch']` still lets mouse and pen turn the book; every non-empty
configuration behaves as the old `true`. Filter pointer entry (and hover) by the
configured kinds, not merely by array length.

### MAJOR — `flipOnClick: 'never'` still turns on click

`requestUserTurn` rejects only the `'corners'` case when the point is outside a
corner; every other value falls through to `requestTurn`
(`packages/core/src/PageFlip.ts:1056-1067`). Therefore the newly advertised
drag-only state, `flipOnClick: 'never'`, behaves like `'anywhere'`. Reject the
click for `'never'` while leaving drag and swipe paths enabled.

_Review in progress; remaining React, lifecycle/event, settings round-trip, and
build checks are still being completed._
