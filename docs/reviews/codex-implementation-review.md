VERDICT: BLOCK

# Codex implementation review

This review is pinned to `aba6a25b37c695b168a9d2d353b80301dc11a37d`.
Its evidence scope is `packages/*/src` only. No test or coverage result was used.
Concurrent source edits appeared after the review began, so every conclusion and
line citation below was rechecked against `git show aba6a25:<path>`, not the live
worktree.

## BLOCKER

### 1. The collaborator getters were not removed, so the facade and declaration boundary are still open

`PageFlip` still publicly exposes `getPage(): Page`, `getRender(): Render`,
`getFlipController(): Flip | null`, `getUI(): UI`, and
`getPageCollection(): PageCollection` at
`packages/core/src/PageFlip.ts:1366-1442`. It also still publishes the wiring
methods `replacePages(PageCollection, ...)` and
`attachMode(UI, Render, PageCollection)` at
`packages/core/src/PageFlip.ts:386-462`, `getBlock()` at
`packages/core/src/PageFlip.ts:339-346`, and the raw input protocol at
`packages/core/src/PageFlip.ts:1492-1535`.

This directly contradicts the barrel's statement that those getters are gone
(`packages/core/src/index.ts:26-31`) and recreates exactly the
`getUI(): UI`-with-no-exported-`UI` defect described at
`packages/core/src/index.ts:8-12`. The emitted declaration is syntactically
self-contained, but only because the declaration bundler pulls the hidden
`UI`, `Render`, `Flip`, `Page`, and `PageCollection` declarations into it. It
therefore resolves while still exposing the entire internal object graph from
the exported `PageFlip` class.

This is an active mutation escape, not just an untidy type surface.
`PageCollection.getPages()` returns its live array at
`packages/core/src/Collection/PageCollection.ts:311-315`, and the returned
renderer exposes destructive state operations such as `releasePages()` at
`packages/core/src/Render/Render.ts:938-942`. A consumer can consequently empty
or corrupt engine collaborators while facade state still reports a loaded
book. Removing their root exports does not make those objects internal.

## MAJOR

### 2. Odd-length hard-cover books do not show the back cover alone

The public setting promises that the first and last leaves are hard and shown
alone (`packages/core/src/Settings.ts:93-98`). `createSpread()` singles out only
leaf 0, then pairs every remaining leaf before hardening the last leaf
afterwards (`packages/core/src/Collection/PageCollection.ts:184-194,218-244`).

For five leaves with `hardCovers: true`, the landscape table is therefore
`[0], [1,2], [3,4]`. Leaf 4 is hard but is still shown beside leaf 3.
`getVisiblePages()` faithfully returns the incorrect `[3,4]`, and `canTurn()`
is bounded against that incorrect spread table. This is the requested
hard-cover/trailing-odd case, and it violates the setting's own contract.

### 3. The `--shown` rewrite neither preserves consumer display modes nor reliably hides pages

The new stylesheet hides `.stf__item` with `display:none` and shows
`.stf__item.--shown` with `display:block`
(`packages/core/src/styles.ts:18-25`). The draw paths add `--shown`
(`packages/core/src/Page/HTMLPage.ts:243,361-362`), and
`HTMLRender.clear()` hides an off-spread leaf only by removing that class
(`packages/core/src/Render/HTMLRender.ts:327-343`).

That has two opposite failure modes:

- A normal consumer rule such as `.page { display:flex }` loses on specificity
  to `.stf__item.--shown`, so the visible leaf is still forced to block.
- An inline `style="display:flex"` beats both engine stylesheet rules, so
  removing `--shown` does not hide an off-spread leaf at all. Old pages remain
  visible and can overlap the current spread.

Temporary copies are not the hole: `hideTemporaryCopy()` physically removes
their nodes at `packages/core/src/Page/HTMLPage.ts:188-193`. The ordinary
collection-page clear path is.

### 4. The shared `pageBackground` predicate still accepts translucent paint

The declaration-escape guard at
`packages/core/src/Render/pageBackground.ts:44-55` rejects semicolons, braces,
comments, backslashes, network-bearing `url()`, and the other relevant breakout
constructs; I found no injection bypass. `CSS.supports('color', value)` is also
the right syntactic authority when it exists
(`packages/core/src/Render/pageBackground.ts:157-168`).

The opacity decision is not sound. `var()` is declared opaque unconditionally,
and any function whose alpha cannot be reduced with `Number(...)` is treated as
opaque (`packages/core/src/Render/pageBackground.ts:85-107,121-140`). Thus all
of these pass the shared predicate and are painted verbatim:

- `var(--paper, transparent)`;
- `color-mix(in srgb, transparent 50%, red)`;
- `rgb(0 0 0 / calc(.5))`.

The first is explicitly allowed at
`packages/core/src/Render/pageBackground.ts:124-135`; the other two are valid
CSS for which `functionalAlpha()` returns `null`, and line 139 equates `null`
with opaque. A shared predicate has removed boundary/draw disagreement, but it
now lets the page underneath read through, violating the documented opaque-fill
contract at `packages/core/src/Settings.ts:137-143`. Accepting unresolved
`var()` is therefore not defensible under the current contract unless opacity
is checked after resolution or an opaque fallback is guaranteed.

The SSR fallback is safe from declaration injection, but it intentionally
accepts invalid color names (`packages/core/src/Render/pageBackground.ts:57-72`).
That is harmless in a genuinely non-painting SSR process; it is not a sound
paint-time fallback in the older-browser-without-`CSS.supports` branch that the
same code also covers.

### 5. The two required defensive value boundaries are still mutable aliases

`getBoundsRect()` returns `Render.getRect()` directly at
`packages/core/src/PageFlip.ts:1403-1405`; the renderer caches and returns that
same object at `packages/core/src/Render/Render.ts:986-990`. A caller can mutate
live renderer geometry through a result presented as an observation.

`getSettings()` returns `this.setting` itself at
`packages/core/src/PageFlip.ts:1412-1413`, and `FlipSetting` is mutable at
`packages/core/src/Settings.ts:157-181`. Direct assignment bypasses validation,
gesture settling, handler rebinding, and construction-time-setting refusal. For
example, the collection captured `hardCovers` in its constructor at
`packages/core/src/Collection/PageCollection.ts:64-75`; mutating the returned
settings object can then report a cover mode the spread model never adopted.
The draw-time `pageBackground` fallback explicitly acknowledges this bypass at
`packages/core/src/Render/pageBackground.ts:186-204` instead of closing it.

### 6. The root was pruned, but not to the recommended facade

The core root still exports 15 runtime values, not 12 and not the recommended
two. In addition to `PageFlip` and `PageFlipError`, it exports `SizeMode`,
`ALL_POINTERS`, four turn/orientation objects, `PageDensity`,
`PageOrientation`, the style APIs, the interactive-target APIs, and
`DEFAULT_PAGE_BACKGROUND` (`packages/core/src/index.ts:45-80`). React republishes
several of them at `packages/react/src/index.ts:31-57`.

The implementation classes and algorithms were removed from the barrel, which
is useful, but the original recommendation to make the enums type-only and
remove internal render/input/style policy from the root was not implemented.

### 7. The authoritative immutable snapshot was replaced by separate live queries

`BookSnapshot` still contains only mutable `{ page, pageCount, orientation }`
(`packages/core/src/Event/EventObject.ts:20-25`). There is no `getSnapshot()`,
no `visiblePages` or `canTurn` in event snapshots, and no shared public
`TurnDirection` type. `usePageFlip` instead combines an event payload with
separate live engine queries at
`packages/react/src/usePageFlip.ts:72-109,220-246`.

That is a material omission from the original recommendation: consumers still
cannot receive one authoritative atomic book state, and the React hook's
`FlipbookState` is assembled from two observations rather than one snapshot.
The direct facade queries are useful, but they are not the immutable state
boundary that was specified.

### 8. Three of the four false inheritance seams and their service locator remain

Only the collection pair collapsed. The following pairs remain unchanged:

- `Page` / `HTMLPage` at `packages/core/src/Page/Page.ts:43` and
  `packages/core/src/Page/HTMLPage.ts:93`;
- `UI` / `HTMLUI` at `packages/core/src/UI/UI.ts:34` and
  `packages/core/src/UI/HTMLUI.ts:53`;
- `Render` / `HTMLRender` at `packages/core/src/Render/Render.ts:114` and
  `packages/core/src/Render/HTMLRender.ts:18`.

The original false-substitution evidence remains: `HTMLRender` casts base
`Page` values back to `HTMLPage` at
`packages/core/src/Render/HTMLRender.ts:243,265,290,307,338`. Internal
collaboration also still routes through facade getters at
`packages/core/src/UI/UI.ts:247-250,535-543,614-618,764-767`,
`packages/core/src/Render/Render.ts:947-955`, and
`packages/core/src/Render/HTMLRender.ts:327-338`.

Leaving these three pairs temporarily would be acceptable internal debt after
the public collaborator methods are removed. At `aba6a25` they are not actually
internal, because finding 1 exposes them, and leaving three of the four is a
direct material miss of the instruction to collapse all four now.

## MINOR

### 9. `isReady()` is true for the empty, deliberately unannounced portal shell

The method says it means the book has finished loading and can be turned, but it
checks only that the controller and collection objects exist
(`packages/core/src/PageFlip.ts:1356-1363`). `loadFromHTML([])` constructs both
while deliberately withholding `ready` because there are no pages
(`packages/core/src/PageFlip.ts:608-622`). The React binding compensates with a
separate page-count check at `packages/react/src/HTMLFlipBook.tsx:902-907`, but
the public readiness query itself is false for the empty-book case it claims to
answer.

### 10. The collapsed collection is concrete, but its “renderer-agnostic model” description is overstated

The merged constructor and `load()` are mechanically correct: they retain the
inputs, construct the same `HTMLPage` objects with the same density rule, load
them, and then build spreads
(`packages/core/src/Collection/PageCollection.ts:64-75,127-143`). The internal
`HTMLPageCollection` alias introduces no second implementation or inheritance
hook (`packages/core/src/Collection/HTMLPageCollection.ts:5-18`).

However, the concrete model now accepts DOM element arrays and directly
constructs `HTMLPage`; it also retains `PageFlip` and `Render`. Calling that
class renderer-agnostic at `packages/core/src/Collection/PageCollection.ts:31-58`
is not accurate. This does not create a current runtime failure, but it is not
the recommended “book model supplied with leaves/factory” boundary either.

## Verified behavior that is not a finding

- `canTurn()` uses current spread index versus spread count at
  `packages/core/src/PageFlip.ts:1328-1334`, exactly matching the controller's
  spread-bounded rule. It is correct at both ends for portrait, coverless
  landscape, even-length hard-cover books, and empty books. The odd-length
  hard-cover failure comes from the spread table, not this predicate.
- Portrait visible pages are one leaf each; coverless landscape pairs leaves
  and leaves a trailing odd leaf alone; empty books return `[]` and cannot turn.
  These follow `createSpread()` and `VISIBLE_PAGES` at
  `packages/core/src/Collection/PageCollection.ts:174-194,284-290`.
- `getVisiblePages()` does allocate on every call by cloning the current spread
  at `packages/core/src/Collection/PageCollection.ts:284-290`. The array has at
  most two entries and the method is called from React memo/event paths, not the
  animation-frame renderer, so the defensive allocation is appropriate rather
  than a hot-path defect.
- `getPageElement()` is correct for the only concrete page implementation at
  `packages/core/src/PageFlip.ts:1347-1354`.
- `HTMLRender.clear()` and temporary-copy removal are internally coherent; the
  visibility failure is the CSS cascade contract described in finding 3.

## Validation

Before the concurrent source edits appeared, with `HEAD` exactly at `aba6a25`,
all requested commands passed:

```text
pnpm build
pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json
pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json
```

The build emitted both package declarations successfully. I did not run or use
the red test suite, any test file, or coverage. A small CSS cascade diagnostic
independently resolved `.page.stf__item.--shown` to `display: block`; a Chromium
diagnostic could not launch in the macOS sandbox because Mach port registration
was denied, so no browser-run result is claimed.
