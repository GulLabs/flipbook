VERDICT: BLOCK

# Codex design-tranche signoff, round 2

Reviewed `c4ecdb1`, `90aa7a9`, and `3014f00` on top of
`7500ffeda69ca328cc4f1f98f291afb755616c5a`. Scope is product code only
(`packages/*/src`); test sources and the intentionally deferred test suite were
not inspected or run.

## Findings

### MAJOR — A normal responsive-to-fixed transition still throws and cannot preserve its responsive bounds

`PageFlip.updateSettings()` merges the retained authored responsive bounds into
the new fixed-mode input at [PageFlip.ts:875](../../packages/core/src/PageFlip.ts:875),
then passes that single, mode-unqualified object to `Settings.resolve()` at
[PageFlip.ts:876](../../packages/core/src/PageFlip.ts:876). `resolve()` rejects
each retained bound that differs from the new fixed dimension at
[Settings.ts:295](../../packages/core/src/Settings.ts:295)-[Settings.ts:326).
Thus a book created with `{ sizing: 'responsive', width: 400, minWidth: 320 }`
throws `INVALID_SETTING/minWidth` on `updateSettings({ sizing: 'fixed' })`,
despite the source describing that as a supported live transition at
[Settings.ts:302](../../packages/core/src/Settings.ts:302)-[Settings.ts:311).

The derived-value comparison fixes resolved-snapshot idempotence, but cannot
distinguish a stale responsive value from an explicitly conflicting fixed-mode
value. Preserve bounds with their authoring mode (or otherwise separate the
round-trip provenance) before validating the active mode.

### MAJOR — A re-entrant `ready` listener can leave the current non-empty book with no `loaded` event

`announceLoad()` correctly marks `ready` before dispatching it and abandons its
outer `loaded` dispatch when the listener advances `loadGeneration`
([PageFlip.ts:624](../../packages/core/src/PageFlip.ts:624)-[PageFlip.ts:630)).
However, if that listener synchronously calls `updateFromHtml()` with replacement
pages, that method advances the generation at
[PageFlip.ts:719](../../packages/core/src/PageFlip.ts:719), but only calls
`announceLoad()` for an empty-to-non-empty replacement
([PageFlip.ts:798](../../packages/core/src/PageFlip.ts:798)-[PageFlip.ts:824)).

For `loadFromHTML(nonEmpty)` with a `ready` handler that replaces those pages,
the nested update is non-empty-to-non-empty and emits no `loaded`; the outer
call then observes supersession and also emits no `loaded`. The latest book has
pages but is never announced. The same `!readyAnnounced` condition loses the
deferred `loaded` event for a later empty-shell reload. `ready` should remain
once per engine, but `loaded` needs its own per-generation completion rule.

### MAJOR — The React imperative `flipToPage` reports success after the core says it was superseded

Core `PageFlip.flip()` now returns the boolean from `Flip.flipToPage()` at
[PageFlip.ts:1238](../../packages/core/src/PageFlip.ts:1238), and the latter
correctly returns `false` only when a newer turn overtakes it, while treating a
same-spread request as successful at
[Flip.ts:508](../../packages/core/src/Flip/Flip.ts:508),
[Flip.ts:549](../../packages/core/src/Flip/Flip.ts:549)-[Flip.ts:551](../../packages/core/src/Flip/Flip.ts:551), and
[Flip.ts:590](../../packages/core/src/Flip/Flip.ts:590)-[Flip.ts:601](../../packages/core/src/Flip/Flip.ts:601).

The React imperative adapter discards that result: `runHandle()` calls
`engine.flip(page)` at [HTMLFlipBook.tsx:484](../../packages/react/src/HTMLFlipBook.tsx:484)
and unconditionally returns `true` at
[HTMLFlipBook.tsx:486](../../packages/react/src/HTMLFlipBook.tsx:486). Its public
`FlipBookHandle.flipToPage` therefore returns success for a superseded request,
contrary to its documented boolean contract at
[types.ts:88](../../packages/react/src/types.ts:88), and emits no rejection to
compensate. Return and handle the core boolean on this path just as the
controlled path does.

### MINOR — An allowlist with duplicate known pointer kinds admits an unknown pointer type

`acceptsPointer()` considers an unrecognised `pointerType` allowed solely when
`allowed.length === ALL_POINTERS.length`
([UI.ts:646](../../packages/core/src/UI/UI.ts:646)-[UI.ts:652)). Validation accepts
duplicates and does not require a set containing all three known kinds
([Settings.ts:381](../../packages/core/src/Settings.ts:381)-[Settings.ts:389)).
Consequently `pointerInput: ['touch', 'touch', 'touch']` is a narrowed,
valid configuration but admits an unrecognised pointer type. Compare set
membership, not array length, before using the forward-compatible admission
rule.

## Verified closures

- C7 now snapshots `wasEmpty` before destruction at
  [PageFlip.ts:742](../../packages/core/src/PageFlip.ts:742)-[PageFlip.ts:748),
  so a genuine replacement retains its current page while the React empty shell
  takes the opening path at [PageFlip.ts:798](../../packages/core/src/PageFlip.ts:798)-[PageFlip.ts:812).
- `['touch']` rejects mouse input at both pointer entry points
  ([UI.ts:655](../../packages/core/src/UI/UI.ts:655)-[UI.ts:659) and
  [UI.ts:700](../../packages/core/src/UI/UI.ts:700)-[UI.ts:705)), including the
  hover/corner-peel path. Admitting a genuinely unrecognised pointer type for a
  full, non-duplicated all-kinds list is a reasonable forward-compatibility
  policy; the duplicate-list hole above is the defect.
- `flipOnClick: 'never'` is confined to `requestUserTurn()`
  ([PageFlip.ts:1122](../../packages/core/src/PageFlip.ts:1122)-[PageFlip.ts:1154)).
  `userStop()` calls it only for a non-swipe, non-move click; drags continue to
  `stopMove()` and swipes bypass it
  ([PageFlip.ts:1477](../../packages/core/src/PageFlip.ts:1477)-[PageFlip.ts:1484)).
- Fixed resolved settings round-trip, including `new PageFlip(host,
getSettings())`, and a conflicting fixed `{ width: 400, minWidth: 200 }`
  still rejects. Equal fixed bounds must be accepted to make a bare resolved
  snapshot idempotent; the remaining provenance failure is reported above.
- `maxHeight` composes with `maxWidth` by deriving the other dimension after
  each cap ([Render.ts:773](../../packages/core/src/Render/Render.ts:773)-[Render.ts:792)).
  Settings normalise a responsive `maxHeight` to at least a positive
  `minHeight` ([Settings.ts:418](../../packages/core/src/Settings.ts:418)-[Settings.ts:431)).
  As before, an unmeasured zero-size host deliberately yields a zero geometry
  rect ([Render.ts:742](../../packages/core/src/Render/Render.ts:742)-[Render.ts:744));
  that is not a `maxHeight`-introduced negative/zero setting path.

## Verification

- Passed: `pnpm build && pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json && pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json` (core built before React).
- Ran built-product settings smoke checks for resolved-settings idempotence,
  `new PageFlip({}, getSettings())`, and the conflicting fixed bound rejection.
- Did not run or inspect tests, as explicitly required.
- Concurrent staged edits to `packages/core/src/Page/HTMLPage.ts` and
  `packages/core/tests/design-tranche-critical.test.ts` appeared after the
  commit-scoped audit started. They were left untouched and are not part of
  this review.
