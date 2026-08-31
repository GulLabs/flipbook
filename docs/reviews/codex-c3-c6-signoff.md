VERDICT: BLOCK

# C3–C6 and U10 signoff: `e96b29c`, `45f0e2e`

Commit-pinned adversarial review of `e96b29c` and `45f0e2e`. Findings use
`git show <sha>:<path>` content; the working tree acquired a separate
`HTMLRender.ts` test mutant during this review and is not treated as the batch.

## Findings

1. **BLOCK — C3 did not close the last named engine-to-engine seams.** The
   new two symbols are sound, but the claim is materially false. `getRender()`
   hands consumers the mutable renderer at `packages/core/src/PageFlip.ts:1231`.
   Its named state writers remain public: `setShadowData` / `clearShadow`
   (`packages/core/src/Render/Render.ts:813-862`), `setPageRect` /
   `setDirection` (`:1003-1032`), and `setRightPage`, `setLeftPage`,
   `setBottomPage`, and `setFlippingPage` (`:1039-1094`). Only `Flip` and
   `PageCollection` write these (`packages/core/src/Flip/Flip.ts:356,433-461`
   and `packages/core/src/Collection/PageCollection.ts:458-504`), yet an
   ordinary consumer can set a stale fold rect, shadow, direction, or leaf that
   disagrees with the collection.

   The other remaining named seams are `PageCollection.setCurrentSpreadIndex`
   (`packages/core/src/Collection/PageCollection.ts:396-405`), used by `Flip`
   at `packages/core/src/Flip/Flip.ts:203-206,804`; and UI's
   `applyHostSize`, `refreshHandlers`, and `setOrientationStyle`
   (`packages/core/src/UI/UI.ts:152-165,302-320`), exposed by
   `PageFlip.getUI()` (`PageFlip.ts:1277-1279`). In particular a direct
   `setOrientationStyle` restyles and updates UI for an orientation the renderer
   has not adopted — exactly the failure C3 says it eliminated. The new seam
   test checks only the four names already moved
   (`packages/core/tests/flip-event-semantics.test.ts:362-389`), so it cannot
   support the exhaustiveness assertion.

   For completeness, the named internal plumbing still exposed in the same four
   classes also includes `PageFlip.getBlock`, `replacePages`, and `attachMode`
   (`PageFlip.ts:420-423,461-515,523-640`); `Render.reload`, `start`, `stop`,
   `startAnimation`, `finishAnimation`, `cancelAnimation`, and `releasePages`
   (`Render.ts:270,359-645,858-931`); UI `destroy` and `update`
   (`UI.ts:252-297`); and `PageCollection.load` / `destroy`
   (`PageCollection.ts:98-124`). They are all callable through package exports
   or the public collaborator getters. Some are destructive rather than
   getter-contradicting, but that is not a reason to call the named seam sweep
   exhaustive; they need an explicit supported-extension contract or the same
   private capability treatment.

2. **BLOCK — C4's completed-swipe test accepts an implementation that does
   not use swipe displacement.** Its fixture selects pointer-down side from
   the sign of `dx` (`packages/core/tests/rtl-layout.test.ts:459-483`): every
   leftward swipe starts right of centre and every rightward swipe starts left
   of centre. A broken `onPointerUp` can select prev/next from that start side
   (with the RTL side mapping) rather than from `dx`; it passes both new
   relations at `:485-517`, but reverses a swipe made from the same side in the
   opposite direction. The real contract calculates `dx` on pointer-up and
   passes it to `swipeDirection` (`packages/core/src/UI/UI.ts:715-742`). Keep
   pointer-down constant while varying `dx`, for both readings.

3. **MAJOR — C4's outer-shadow test can pass a visibly reversed gradient.**
   It asserts only the `to left` / `to right` token
   (`packages/core/tests/shadow-direction.test.ts:158-185`). Reverse the two
   gradient stops in `HTMLRender.drawOuterShadow` —
   `rgba(...,0), rgba(...,opacity)` instead of the order at
   `packages/core/src/Render/HTMLRender.ts:223-229` — and every assertion still
   passes while the dark end moves to the opposite physical side. The test must
   assert the complete `linear-gradient(...)` value (including stop order), or
   parse and assert the direction and ordered stops.

4. **BLOCK — U10 breaks the existing React runtime-width contract.** The
   deleted branch was not inert at the call boundary: `pnpm quality:ci` now
   fails the pre-existing responsive React test at
   `packages/react/tests/HTMLFlipBook.test.tsx:632-683`, receiving host
   `minWidth: 0px` after a `width={300}` → `width={320}` update where the
   contract requires `320px`. The only production difference in `e96b29c` is
   deletion of the FIXED restamp (`packages/core/src/UI/UI.ts:165-172` in its
   parent); the replacement writes `setting.minWidth` at `e96b29c`'s
   `UI.ts:165-166`. The new U10 test only constructs normalised settings
   (`packages/core/tests/runtime-settings.test.ts:227-258`) and misses this
   live React `updateSettings` path (`packages/react/src/HTMLFlipBook.tsx:515-543`,
   `packages/core/src/PageFlip.ts:849-941`). Restore the fixed-size restamp or
   repair the broken invariant before deleting it, then add this discriminating
   runtime regression to the U10 evidence.

   Separately, even if that runtime regression did not exist, the branch would
   only be inert on `Settings.getSettings()` input: fixed settings are
   normalised at `packages/core/src/Settings.ts:294-311`, but `getUI()` exposes
   `UI.applyHostSize(setting)` (`PageFlip.ts:1277-1279`, `UI.ts:152-165`) and
   its comment explicitly permits a caller-provided settings object
   (`UI.ts:154-162`). A fixed caller with a different `minWidth` observed the
   old width-based stamp and now observes the supplied minimum.

5. **MINOR — the C5 table's `turnToPage` emissions cell is false as written.**
   ADR 0003 says it emits “yes” (`docs/adr/0003-flip-event-semantics.md:120-128`),
   but `turnToPage` delegates to `show` (`packages/core/src/PageFlip.ts:1032-1043`),
   which accepts the current page and either page in the current landscape
   spread (`packages/core/src/Collection/PageCollection.ts:372-381`); the
   emitter then dispatches only when the head changed (`:534-540`). The cell
   must say “guarded / only when the head changes.” The requested call sweep is
   otherwise exhaustive: `showSpread` has only `showNext`, `showPrev`, and
   `show`; `show` is reached by `PageFlip.update`, `UI.cancelGesture`,
   `turnToPage`, `replacePages`, `updateFromHtml`, and `attachMode`.

6. **MINOR — C6 pins the final class but not the premise that makes it
   meaningful.** The earlier answer is correct: on a hard BACK fold the shared
   mover/bottom leaf is stamped last by `setFlippingPage` and is RIGHT
   (`packages/core/src/Flip/Flip.ts:433-436`,
   `packages/core/src/Render/Render.ts:1067-1093`); RIGHT selects
   `drawHard`'s spine origin at `packages/core/src/Page/HTMLPage.ts:197-233`,
   and `drawBottomPage` skips that shared object
   (`packages/core/src/Render/HTMLRender.ts:276-312`). The new test checks only
   the final class and hard density (`packages/core/tests/hard-back-draw.test.ts:203-215`).
   A broken bottom-page selection or stamp can still pass if the later mover
   stamp yields `--right`. Assert `bottomPage === flippingPage` and the rendered
   hard transform origin/translation, so the test establishes the reason rather
   than merely observing its current symptom.

## C3 design judgment

Six independent symbols are the right factoring for the seams already moved.
Each represents a separate narrow authority; one capability object would hand
every importing sibling the whole bundle and would not make the fence stronger.
The problem is incomplete application, not symbol accretion. Move the remaining
state-mutating seams under similarly narrow module-private keys (or stop
returning mutable collaborators) and make the exhaustive seam test enumerate
that complete list. Do not remove the documented custom-input surface
`startUserTouch` / `userMove` / `userStop`; it has an explicit valid consumer
role (`docs/reviews/engine-expert-round1.md:107-110`).

## Validation

- `git diff --check e96b29c^ e96b29c` and `git diff --check 45f0e2e^ 45f0e2e`:
  passed.
- `pnpm vitest run packages/core/tests/shadow-direction.test.ts --configLoader runner`:
  passed (11 tests) **against a dirty working tree containing a non-batch
  `MUTANT_S3` that reverses outer-shadow translation**. This is evidence that
  C4 does not cover the broader outer-shadow placement relation; it is not
  commit-pinned validation.
- `pnpm quality:ci`: **failed** at `test:coverage`: 787 passed / 1 failed.
  `packages/react/tests/HTMLFlipBook.test.tsx:669` expected `320px` after a
  live fixed-width update and received `0px`. No source change other than the
  concurrent `MUTANT_S3` in `HTMLRender.ts` was present; that mutant cannot
  affect host sizing. The failure is therefore batch evidence for U10. The gate
  stopped before coverage-area, build, size, isolated-types, and packed-artifact
  stages.
- Independent Claude gate: unavailable. The repository-required wrapper could
  not create its cache under `~/.cache/claude-review` (`Operation not permitted`)
  before starting a run; no Claude result is claimed.
