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

### BLOCKER — D1 reads the new ref slots before legitimate refs can mount

The children effect publishes a fresh, empty local slot array, sets the expected
child count, and only then schedules the render containing the new ref callbacks
(`packages/react/src/HTMLFlipBook.tsx:456-484`). Later in the same passive-effect
flush, the collection effect calls `readNodes()` before checking the render-time
`pages.length` and `pageHost` guards (`packages/react/src/HTMLFlipBook.tsx:628-633`).
The scheduled portal render has not happened, so `readNodes()` sees every
ordinary child as missing and throws `DETACHED_PAGE`
(`packages/react/src/HTMLFlipBook.tsx:319-337`). The inert effect repeats the
same call-before-guard ordering (`packages/react/src/HTMLFlipBook.tsx:697-701`).
This can prevent any non-empty React book from mounting, and swapping the slot
array before its JSX commits also creates the same false-missing window during
lazy/child transitions. Keep the committed slot generation readable until the
new portal generation has attached, and perform pre-mount guards before reading
it.

The timing fix alone would still leave the shape rejected in the prior signoff:
`wrapChildren` continues to clone the consumer root and require its ref
(`packages/react/src/HTMLFlipBook.tsx:237-272`), rather than giving every leaf a
stable engine-owned host. Thus a legitimate component that does not forward a
ref is still rejected, and the engine still writes its classes/styles onto a
consumer-owned root. The D1 repair should close that ownership contract rather
than merely move this exception later.

### MAJOR — three renamed setting contracts are declared but not enforced

- `pointerInput` promises an accepted-pointer policy, but handler setup only
  checks whether the array is empty and otherwise registers one unfiltered
  Pointer Events path (`packages/core/src/UI/UI.ts:349-357`). `onPointerDown`
  never tests `e.pointerType` against the allowlist before claiming the gesture
  (`packages/core/src/UI/UI.ts:630-667`). Thus `['touch']` still accepts mouse
  and pen; every non-empty configuration behaves as the old `true`.
- `requestUserTurn` rejects only the `'corners'` case outside a corner, then
  always calls `requestTurn` (`packages/core/src/PageFlip.ts:1056-1067`). The
  new drag-only state `flipOnClick: 'never'` therefore behaves like
  `'anywhere'`.
- The D3 boundary calls only `isOpaquePageBackground`
  (`packages/core/src/Settings.ts:374-395`). That helper treats any string with
  no recognised alpha as opaque (`packages/core/src/Render/pageBackground.ts:57-65`),
  so invented colours, declaration-like junk, and valid modern colours such as
  `oklch()` all pass construction. The draw-time `foldFill` then rejects their
  syntax and silently substitutes white (`packages/core/src/Render/pageBackground.ts:74-91`).
  `safePageBackground`, the only platform-parser path, has no product-code
  caller (`packages/core/src/Render/pageBackground.ts:94-113`). D3 consequently
  retains the exact silent-white failure it was meant to replace with
  `INVALID_SETTING`.

### MAJOR — the authored/resolved model cannot preserve responsive bounds through fixed mode

`updateSettings` merges every old authored key into `nextAuthored` and resolves
that whole object (`packages/core/src/PageFlip.ts:796-814`). `Settings.resolve`
then rejects every supplied responsive-only bound whenever the resulting mode
is fixed (`packages/core/src/Settings.ts:288-307`). Starting with
`{ sizing: 'responsive', minWidth: 320 }`, therefore,
`updateSettings({ sizing: 'fixed' })` throws because the retained `minWidth` is
misread as having been authored under fixed mode. Clearing the bounds with
`undefined` permits fixed mode but discards the values that were supposed to
return on the transition back to responsive.

There is a second path to the same failure: passing the resolved object from
`getSettings()` back to `updateSettings()` copies its synthesised fixed bounds
into `effective`; unchanged construction-time keys are not removed
(`packages/core/src/PageFlip.ts:796-813`), so D4 again mistakes synthesised
bounds for authored ones. The narrow case explicitly called out in the review
prompt—`updateSettings({ drawShadow: false })` on a book constructed as
fixed—does work, but the promised responsive → fixed → responsive round-trip
does not. Authorship needs mode-aware provenance, not just one accumulated
object.

### MAJOR — the replacement lifecycle events are not re-entrancy-safe

There are three observable failures in the new synchronous stream:

- `attachMode` captures one snapshot, marks `readyAnnounced`, dispatches
  `ready`, then unconditionally dispatches `loaded` from the captured snapshot
  (`packages/core/src/PageFlip.ts:568-585`). A `ready` listener can synchronously
  clear, replace, or reload the book; the abandoned outer attach then emits
  stale `loaded` after the newer operation. A throwing `ready` listener also
  prevents the first `loaded` entirely. `readyAnnounced` itself correctly
  remains once per live engine; the unsafe part is the unguarded tail after the
  callback.
- In React, the handlers are bound and `loadFromHTML([])` synchronously fires
  both events for the empty portal shell
  (`packages/react/src/HTMLFlipBook.tsx:567-580`). The real leaves arrive later
  through `updateFromHtml` (`packages/react/src/HTMLFlipBook.tsx:628-668`),
  which emits only `pagesChanged`. `onReady`/`onLoaded` therefore deterministically
  report `pageCount: 0` and `onLoaded` never describes the consumer's loaded
  book; the old timer race has become a guaranteed empty snapshot.
- Collapsing the old atomic pair to one bare dispatch did remove its
  cross-event throw window, but also removed its latest-wins re-derivation.
  `dispatchPagesChanged` just emits captured data
  (`packages/core/src/PageFlip.ts:294-312`), while `EventObject.trigger` keeps
  iterating the outer listener snapshot after a listener performs a nested
  replacement (`packages/core/src/Event/EventObject.ts:374-396`). A later
  listener consequently receives the nested/new `pagesChanged` first and the
  outer/stale snapshot last, ending permanently desynchronised. One event still
  needs an explicit nested-dispatch ordering/coalescing rule.

### MAJOR — controlled transitions and announcements still use requested state instead of committed state

The common initial `page={0}` path returns when the page is already in the
opening spread (`packages/react/src/HTMLFlipBook.tsx:744-767`) before clearing
`firstControlledApply`. The first later external prop change is consequently
treated as the initial application and jumps instantly at
`packages/react/src/HTMLFlipBook.tsx:778-783`, despite the default
`pageTransition="animate"`. When an animated controlled change does occur, the
live-region source is `controlledPage ?? enginePage`, and its effect announces
that requested value immediately (`packages/react/src/HTMLFlipBook.tsx:365-386`),
before the engine commits the destination. The prior signoff required both
initial seeding and announcements to follow committed engine state. Adding
`enginePage` to the reconciliation dependency does not itself create an
infinite loop, but these two D14/announcement contracts remain wrong.

### MAJOR — H4 and `usePageFlip` compute forward availability from leaves, not spreads

The built-in Next button disables only when
`enginePage >= pageCount - 1` (`packages/react/src/HTMLFlipBook.tsx:945-953`),
and `usePageFlip.canGoNext` repeats the same comparison
(`packages/react/src/usePageFlip.ts:55-60`). `enginePage` is the spread head: in
a four-leaf landscape book, the final spread is `[2, 3]`, so its head is 2 and
both surfaces advertise an available forward turn even though no forward spread
exists. This repeats the page-index-versus-spread-boundary bug called out in
`CLAUDE.md`. The controls are correctly outside the portal and outside the leaf
inert set; their boundary state is not correct.

### MAJOR — D20's sentinel/error escape repair is dead code

`GeometryAbort` and its identity predicate are defined
(`packages/core/src/errors.ts:127-139`) but have no product-code caller.
`FlipCalculation.calc` still catches every exception indiscriminately and
returns `false` (`packages/core/src/Flip/FlipCalculation.ts:91-110`), while its
two control-flow exits still throw bare `Error`
(`packages/core/src/Flip/FlipCalculation.ts:275-308`). A real `TypeError` in the
pointer hot path is therefore still swallowed on every move—the exact D20
failure the tranche says it fixed. The third bare engine error also remains in
`HTMLUI` (`packages/core/src/UI/HTMLUI.ts:78-80`). Wire the identity-compared
sentinel and let non-sentinel faults propagate; convert the remaining engine
invariant to the typed error model.

### MINOR — D12 is not in the claimed D1–D21 tranche

The internal naming cleanup is absent: `getSpread()` still returns the whole
spread table (`packages/core/src/Collection/PageCollection.ts:210-213`), the UI
and HTML renderer still call the same block `distElement` and `element`
(`packages/core/src/UI/UI.ts:38`, `packages/core/src/Render/HTMLRender.ts:20`),
the calculation call remains `calc.calc(...)`
(`packages/core/src/Flip/Flip.ts:414`), the frame timestamp remains `timer`
(`packages/core/src/Render/Render.ts:151-156`), and `foldFill` remains a bare
alias (`packages/core/src/Render/pageBackground.ts:116-125`). This is not a
runtime blocker, but a commit represented as implementing D1–D21 is missing D12.

## Verification

- Inspected `git show 7500ffe` and its parent product call paths only; no test
  file was inspected and no test command was run. The worktree advanced to a
  later commit and acquired concurrent product edits during the audit; those
  changes were left untouched and are not folded into this verdict.
- Legacy setting-name search across `packages/*/src` found no stale executable
  read through a cast or index signature. The material missed read behavior is
  reported above (`pointerInput`, `flipOnClick`, and `pageBackground`).
- `readyAnnounced` remains once per engine and is not reset on reload; destroyed
  engines cannot reload. The post-`ready` tail is the lifecycle defect.
- The requested build command passed from an isolated `git archive 7500ffe`
  after producing the archived core declaration artifact needed by React's
  package-name resolution:
  `pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json && pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json && pnpm build`.
  The build reported the packed HTML engine at 58,286 bytes.
