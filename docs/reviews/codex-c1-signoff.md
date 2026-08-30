VERDICT: BLOCK

# C1 signoff: `c01cdbe`

Commit reviewed: `c01cdbe4c472e0a8c693ad7bb5b35da1ed9297bf`.

This file is being updated during a commit-pinned adversarial review. It will
cover all five `resetUserGesture()` callers, pointer-event re-entrancy, test
mutants, the internal seam, surviving state, and `pnpm quality:ci`.

## Findings

1. **BLOCK — the regression tests do not prove the cleanup is centralized in
   `resetUserGesture()`.** Both new tests settle only through
   `updateSettings({ direction: 'rtl' })` at
   `packages/core/tests/rtl-layout.test.ts:412` and `:468`, which reaches the
   fold-invalidating branch at `packages/core/src/PageFlip.ts:847-850`. A
   hostile mutant that removes the new call at
   `packages/core/src/PageFlip.ts:1301` and puts
   `this.ui?.[DROP_POINTER_GESTURE]()` immediately after that branch's
   `resetUserGesture()` passes both tests, but leaves the UI state alive for
   `replacePages` (`PageFlip.ts:467-469`), `attachMode` (`:539-556`),
   `updateFromHtml` (`:716-718`), and `clear` (`:953-963`). This is precisely
   the half-fix the shared method is meant to prevent. Add a test through at
   least one collection-replacement/clear caller, preferably a parameterized
   assertion covering all five callers, and demonstrate that the mutant fails.

## Validation

In progress. The full quality gate will run against the current worktree,
which also contains unrelated, unreviewed C2 edits; source conclusions above
are pinned to `c01cdbe`.
