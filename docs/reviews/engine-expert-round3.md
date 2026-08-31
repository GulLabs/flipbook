# Engine correctness review — round 3

Reviewer: standing engine-correctness reviewer (adversarial).
Commit under review, pinned: **`7500ffe`** — the design tranche (D1–D21, H4, C7).

Scope, per the coordinator: **`packages/*/src` only.** No test code was read,
run, or counted. Audited in an isolated worktree at `7500ffe`; nothing in the
main checkout was touched except this file.

**Verdict: 2 BLOCKERs, 4 MAJORs, 4 MINORs.**

Compilation is clean and is not a finding:

- `pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json` — clean.
- `pnpm build` — succeeds, 58286 B raw.
- `pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json` — clean **after**
  `pnpm build`. Run against an unbuilt `packages/core/dist` it reports 11 errors,
  all cascading from `Cannot find module '@gullabs/flipbook-core'`; they vanish
  once core is built. Worth knowing before someone reports them.

Every BLOCKER and MAJOR below except #4 was reproduced by executing the built
engine under jsdom. Verbatim output is quoted.

---

## BLOCKER 1 — `openingFresh` reads a collection it has already emptied, so it is _always_ true: every `updateFromHtml` silently resets the reader's page

`packages/core/src/PageFlip.ts:747`

```ts
const openingFresh = previous.getPageCount() === 0 && pageCount > 0;
```

`previous.destroy()` runs 50 lines earlier at `PageFlip.ts:697`, and
`PageCollection.destroy()` sets `this.pages = []`
(`packages/core/src/Collection/PageCollection.ts:107`). So
`previous.getPageCount()` is **0 unconditionally** by the time `openingFresh` is
computed. The outgoing index is captured correctly before the destroy
(`const current = this.resolvedPageIndex(previous)`, `PageFlip.ts:684`) — the
emptiness test is the one read that was left on the wrong side of it.

Consequences, both at `PageFlip.ts:756-762`:

1. `requested` becomes `resolveStartPage(pages, pageCount, initialPage)` instead
   of `current`, so **every content replacement snaps the book back to
   `initialPage`** (default `0`).
2. `pages[SEED_OPENING_INDEX](target)` is used instead of
   `INHERIT_PAGE_INDEX(current)`, so the ADR 0003 guard is seeded with the
   destination and **stays silent about the move**. The reader is relocated and
   no `flip` says so.

Reproduced against `packages/core/dist`:

```
reader is on page 4
after updateFromHtml (same size, new nodes): index = 0   flips = []
with initialPage:2, reader on 5 -> after replace: index = 2   flips = []
```

This is the hottest path in the library — the React binding calls
`updateFromHtml` for every change to the page nodes — so a book that adds,
removes or re-renders a leaf throws the reader back to the front cover without a
word. It also inverts C7's own intent: C7 exists so an _opening_ does not
announce; as written it makes every _replacement_ not announce either, which is
strictly the ADR 0003 defect (a suppressed real change) rather than the fix.

**Fix:** capture the predicate before the teardown, beside `current`:

```ts
const current = this.resolvedPageIndex(previous);
const wasEmpty = previous.getPageCount() === 0;   // BEFORE previous.destroy()
…
const openingFresh = wasEmpty && pageCount > 0;
```

I checked the composition question the coordinator asked, and with `wasEmpty`
captured correctly it is right: an empty-outgoing collection is exactly the case
`attachMode` already classifies as a first load (`PageFlip.ts:474`), the seed
resolves the request to the spread **head** rather than the request itself, and
`show(target)` then finds the guard already equal — silent, which is what an
opening should be. The design is sound; only the read ordering is wrong.

---

## BLOCKER 2 — D4's responsive-only-bound rejection misfires on three legitimate paths, including the round-trip the `FlipOptions` split was introduced to enable

`packages/core/src/Settings.ts:297-307`

```ts
if (result.sizing === SizeMode.FIXED) {
  for (const bound of RESPONSIVE_ONLY_BOUNDS) {
    if (supplied[bound] !== undefined) reject(bound, …);
```

The check asks "did the caller author this bound?" but not "did they author it
_for this sizing?_". Three reachable configurations, all reproduced:

```
responsive->fixed THREW:  INVALID_SETTING | minWidth: expected no value under sizing: 'fixed' …, received 150
round-trip THREW:         INVALID_SETTING | minWidth: … received 200
ctor from getSettings() THREW: INVALID_SETTING | minWidth: … received 200
```

**(a) The `responsive → fixed` live transition is impossible.**
`new PageFlip(host, { sizing: 'responsive', minWidth: 150, … })` then
`updateSettings({ sizing: 'fixed' })`. `sizing` is deliberately live — it is
excluded from `CONSTRUCTION_TIME_SETTINGS` (`PageFlip.ts:39`) and the docblock
above it says so — and `updateSettings` re-resolves
`{ ...this.authored, ...effective }` (`PageFlip.ts:813`), which still carries the
author's `minWidth`. There is an escape (`{ sizing: 'fixed', minWidth: undefined }`,
which `definedOnly` drops) but nothing points at it, and the error message
actively misdirects: the caller did not supply `minWidth` under `'fixed'`.

**(b) `updateSettings(getSettings())` throws** — the exact call the method's own
comment at `PageFlip.ts:788-793` says must not throw ("passing a whole settings
object back through `updateSettings` is plausible usage, and turning a silent
no-op into an exception would break those callers"). That paragraph is now false
about the method it documents.

**(c) `new PageFlip(host, otherBook.getSettings())` throws.** `getSettings()`
returns `FlipSetting`, which is structurally assignable to `FlipOptions` (every
`FlipOptions` key is optional except `width`/`height`, and all are present), so
this compiles and fails at runtime. `Settings.ts:53-58` advertises exactly this
round-trip as a benefit of keeping `authored` alongside the resolved settings:
"`getSettings()` can round-trip. Previously `responsive → fixed → responsive`
returned bounds pinned to width/height". The new model does not return the wrong
bounds — it **throws**, which is not the improvement the comment claims.

Directly answering the coordinator's sub-question: **`resolve()` is not
idempotent.** `resolve(resolve(x))` throws for every fixed-sized book, because
the resolved object always carries synthesised `minWidth`/`maxWidth`/`minHeight`
(`Settings.ts:399-403`) and the second pass cannot tell them from authored ones.
That non-idempotence is the root of all three cases above.

**React blast radius, from source.** `pickSettings` includes all three bounds
(`packages/react/src/HTMLFlipBook.tsx:33-35`), and `sizing` is in
`remountKeyOf` (`:85`). So `<HTMLFlipBook sizing="responsive" minWidth={300}>`
followed by flipping that one prop to `"fixed"` remounts, hits
`new PageFlip(root, settings)` (`HTMLFlipBook.tsx:571`) and throws **out of a
`useEffect`** — an uncaught exception that takes the tree down, for a one-prop
change.

**Fix options, in preference order:** (i) only reject when the bound was authored
_in the same call that set `sizing: 'fixed'`_ — i.e. test `effective`/the current
call's input rather than the accumulated `authored`; (ii) keep the check for the
constructor only and drop it for `updateSettings`; (iii) warn rather than throw.
Whichever is chosen, `getSettings()` must round-trip or `FlipSetting` should stop
being assignable to `FlipOptions`.

---

## MAJOR 3 — the synchronous `ready`/`loaded` lost the stale-announcement guard: a `ready` listener that reloads makes the outer `attachMode` announce a book that no longer exists

`packages/core/src/PageFlip.ts:566-585`

Making `init` synchronous is the right call and I found no _state_ corruption
from it. What went with the timer is the invalidation. The old code paired
`cancelPendingInit()` with a `if (this.destroyed) return;` inside the callback,
so a superseded load could not announce. The new code calls
`this.nextGeneration()` at `PageFlip.ts:447` and **never reads it back**, and
re-checks neither `destroyed` nor the generation between `pages.show(start)` and
the two dispatches.

`pages.show(start)` can emit `flip`, `ui.update()` can emit `changeOrientation`,
and `ready` itself is consumer code — every one of them can re-enter
`loadFromHTML` / `updateFromHtml` / `clear` / `destroy`. Reproduced with a
`ready` listener that reloads a 6-page book with a 2-page one:

```
ready  {"page":0,"pageCount":6,"orientation":"portrait"}
loaded {"page":0,"pageCount":2,"orientation":"portrait"}    <- inner, correct
loaded {"page":0,"pageCount":6,"orientation":"portrait"}    <- outer, STALE
final pageCount = 2
```

The **last** event a consumer receives describes a collection that was destroyed
mid-dispatch. That is verbatim the RE-2 failure ("`collectionRebuild` arriving
last, with the count of a collection that no longer exists… a consumer rendering
'page N of M' is then permanently wrong") whose guard was deleted along with
`dispatchCollectionChange`. The old guard re-derived from the live collection; the
new code has no equivalent.

**Fix:** stamp the generation in `attachMode` and bail before each announcement:

```ts
const generation = this.nextGeneration();
…
if (this.destroyed || this.loadGeneration !== generation) return;
```

Two related checks, both **clean**, stated so they are not re-investigated:

- **`destroy()` from a `ready` listener is survivable.** `destroy()` runs
  `clearListeners()` (`PageFlip.ts:268`), so the trailing `this.dispatch('loaded', …)`
  reaches nobody. Reproduced: `loadFromHTML` returns normally and no `loaded`
  handler fires. It is still worth guarding — `ui.update()` at `:566` now runs
  unguarded on a torn-down UI if a `flip` listener destroys during
  `pages.show(start)` — but I could not make it throw.
- **`readyAnnounced` is correct across `clear()` + reload.** Reproduced:
  `["ready","loaded","loaded"]`. It is never reset, which is right: `attachMode`
  early-returns on `destroyed` (`PageFlip.ts:450`), so a destroyed engine cannot
  re-announce, and `ready` is documented as once per engine.

---

## MAJOR 4 — D17's stated rationale inverts in the React binding: `onReady` / `onLoaded` now _deterministically_ describe the empty shell

The D17 justification (`PageFlip.ts:551-558`, `EventObject.ts:56-64`) is that the
1 ms timer "made it a RACE in the React binding — that binding loads an empty book
and adds pages in a later effect, so whether `init` described the real book or an
empty one depended on timer ordering."

The synchronous version resolves that race to the **wrong** answer, always:

- the mount effect binds handlers (`HTMLFlipBook.tsx:575`) and then calls
  `engine.loadFromHTML([])` (`:578`), which now dispatches `ready` and `loaded`
  **synchronously**, with `pageCount: 0`;
- the real pages arrive in a _later_ effect (`:638-669`) via `updateFromHtml`,
  which emits `pagesChanged` — **not** `loaded`.

`flip.on('ready', …)` and `flip.on('loaded', …)` forward straight to `onReady` /
`onLoaded` with no filtering (`HTMLFlipBook.tsx:541-546`). So a React consumer's
`onReady` and `onLoaded` fire exactly once each, both reporting an empty book,
and `onLoaded` never fires again for the real one. Under the old timer the effects
for that commit had all run before the 1 ms callback, so `init` normally
described the real book — the behaviour the change was meant to _guarantee_.

The `pageCount` field was added to the payload specifically so a consumer could
render "page 1 of N" (`EventObject.ts:62-64`). In the binding it is always `0`.

**Fix (design, not a one-liner):** either the binding should not announce for its
own empty shell (defer `ready` until the first non-empty collection, which is what
"the book is usable" actually means), or `updateFromHtml` should emit `loaded`
when `openingFresh` — which is the same predicate BLOCKER 1 already needs fixed.
The second is the smaller change and makes `openingFresh` earn its keep.

---

## MAJOR 5 — `flipOnClick: 'never'` is not implemented

`packages/core/src/PageFlip.ts:1059` is the **only** read of `flipOnClick` in the
entire engine (verified by grep across `packages/core/src`):

```ts
if (flip !== null && this.setting.flipOnClick === 'corners' && !flip.isPointOnCorners(pos)) {
```

There is no `'never'` branch, so `'never'` falls through to
`requestTurn((f) => f.flip(pos), …)` and turns the page exactly like
`'anywhere'`. The enum's entire justification — `Settings.ts:31-36`, "Three
states, one of which — 'drag only' — was previously unreachable" — is unmet: the
state is still unreachable, now with a documented name and a `!` migration
requiring consumers to adopt it.

`'corners'` correctly preserves the old `disableFlipByClick: true` semantics, and
`'anywhere'` the old `false`, so this is an unshipped feature rather than a
regression. It is ranked MAJOR because the setting silently lies: the value
validates, round-trips through `getSettings()`, and does nothing.

---

## MAJOR 6 — `pointerInput`'s per-kind filtering is not implemented either

`packages/core/src/UI/UI.ts:351` is the **only** read of `pointerInput` outside
`Settings`:

```ts
if (this.app.getSettings().pointerInput.length === 0) return;
```

Only empty-vs-non-empty is honoured. No pointer handler consults membership —
`onPointerDown` tests `e.pointerType` solely for the mouse-button guard
(`UI.ts:633`), and `allowTouchScroll` is the only other `pointerType` consumer
(`:669`, `:689-691`). So `pointerInput: ['touch']` still turns pages under a
mouse, and `['mouse']` still turns under touch.

`Settings.ts:113-121` sells the array precisely on this: "a consumer wanting 'no
mouse turning, keep swipe on tablets' shipped a book that could not be turned on
a phone. A list is the smallest thing that expresses that." That consumer's
config is now accepted, validated, echoed back — and ignored. The boolean it
replaced at least worked for its one case; the replacement is a superset in the
type and a subset in behaviour.

**Fix:** one guard in `onPointerDown`, e.g.
`if (!this.app.getSettings().pointerInput.includes(e.pointerType as PointerKind)) return;`
— read live, so `updateSettings` keeps working. Note `hasPointerCapture`-style
UAs report `pointerType: ''` for synthetic events; decide whether an unknown kind
is admitted, and say which.

---

## MINOR findings

1. **Stale comments now describing deleted code.**
   `PageFlip.ts:30-38` (the `CONSTRUCTION_TIME_SETTINGS` docblock) still names
   `showCover`, `startPage` and `size`, all three renamed by this commit.
   `PageFlip.ts:537` says the fabricated flip was announced "BEFORE `init`, which
   is dispatched from the timer below" — there is no timer and no `init`.
   `PageFlip.ts:951` and `:975` (inside `clear()`) still reason in terms of
   "`update` … `collectionRebuild`". This repo's own standard is that a comment
   asserting something false is worse than none.

2. **`SizeModeValue` is named backwards.** `index.ts:6` exports the const
   `SizeMode`, and `:11` re-exports `SizeMode as SizeModeValue` under
   `export type`. Because `SizeMode` is a merged type+const, `export { SizeMode }`
   already carries both meanings (confirmed in the built
   `packages/core/dist/index.d.ts:2710`), so `SizeModeValue` is a redundant alias
   — and it aliases the _type_ while being named "Value". Either drop it or name
   it `SizeModeType`.

3. **`pointerInput` change detection is order-sensitive.**
   `PageFlip.ts:815-817` compares elementwise, so
   `['mouse','touch'] → ['touch','mouse']` counts as changed and calls
   `ui.refreshHandlers()`, which runs `removeHandlers() → cancelGesture()` and
   abandons an in-flight gesture. A set-like setting should compare as a set.
   Harmless today because nothing else reads the array (MAJOR 6); it becomes a
   real gesture-drop the moment MAJOR 6 is fixed.

4. **`EMIT_PAGE_INDEX` acquired a throwing dependency.**
   `PageFlip.ts` `[EMIT_PAGE_INDEX]` now calls `this.renderOrThrow.getOrientation()`
   to fill the `BookSnapshot`. I traced every caller of `showSpread()` and could
   not reach it with `render === null` — `destroy()` sets `destroyed` and nulls
   `pages` before `render`, and `UI.cancelGesture()`'s `show()` is guarded by
   `isDestroyed()`. Recording it because an _emit_ path that can throw is a new
   hazard class, and `this.render?.getOrientation()` would cost nothing.

---

## Verified correct — nothing wrong found

Stated explicitly rather than padded.

### The rename sweep is clean

`git grep` across `packages/core/src` and `packages/react/src` for `showCover`,
`startPage`, `useMouseEvents`, `disableFlipByClick`, `showPageCorners`,
`clickEventForward`, `mobileScrollSupport`, `maxHeight` and `direction:` returns
**no live read site** — every hit is prose in a comment (listed in MINOR 1). The
two places settings are reached other than by property access are both safe:

- `Settings.ts:217`, inside `definedOnly`, iterates `Object.keys` of the caller's
  own object — name-agnostic by construction.
- `HTMLFlipBook.tsx:63`, inside `pickSettings`, writes through a
  `Record<string, unknown>` cast but only for keys drawn from
  `ENGINE_SETTING_KEYS`, which is
  `as const satisfies readonly (keyof FlipOptions)[]` (`:53`) — so a missed
  rename there is a compile error, and core `tsc` is clean.

`FOLD_INVALIDATING_SETTINGS` (`PageFlip.ts:67-77`) and `BOOLEAN_SETTINGS`
(`Settings.ts:193-202`) carry the same `satisfies` guard and are both fully
renamed. `remountKeyOf` (`HTMLFlipBook.tsx:85`) and the settings-effect
dependency array (`HTMLFlipBook.tsx:605-625`) use the new names throughout.

### No default drifted

Compared key-by-key against `3565533`'s `_default`: `startPage 0 → initialPage 0`,
`size fixed → sizing fixed`, `showCover false → hardCovers false`,
`mobileScrollSupport true → allowTouchScroll true`,
`clickEventForward true → respectInteractiveContent true`,
`useMouseEvents true → pointerInput ALL_POINTERS`,
`showPageCorners true → foldCornerOnHover true`,
`disableFlipByClick false → flipOnClick 'anywhere'`,
`direction 'ltr' → readingDirection 'ltr'`; `maxHeight` removed. Polarity is
preserved everywhere, including `allowTouchScroll`'s two live reads
(`UI.ts:669`, `:691`), which match the old `mobileScrollSupport` logic exactly.
Moving `width`/`height` out of the defaults and into required `FlipOptions` keys
is a strict improvement over defaulting them to `0` and then rejecting `0`.

### D10 — the `update` + `collectionRebuild` deletion loses nothing that mattered

I read the deleted `dispatchCollectionChange` at `3565533` in full. It carried two
guarantees, and **both are structural consequences of the split, not properties
worth preserving**:

- _"an `update` listener that threw took `collectionRebuild` with it"_ — the
  `try/catch` + `failure ??=` pair. With one dispatch there is no second half to
  protect.
- _"the second half fires with numbers captured before a re-entrant swap"_ — the
  `loadGeneration` re-derive. With one dispatch the payload is captured
  immediately before the only dispatch, and a listener that re-enters emits its
  own `pagesChanged` **after**, so the last event a consumer sees is the correct
  one. That is strictly better than the old ordering, which put the stale half
  last.

The commit message's claim is accurate. One consequence worth stating rather than
fixing: `attachMode` announces `ready`/`loaded` and **not** `pagesChanged`, so a
consumer tracking `pageCount` must bind both — the same asymmetry the old code
called out ("a full load announces `init`, never `collectionRebuild`"), now
harmless because `loaded` carries `pageCount`. Except in React, where it carries
`0` — see MAJOR 4.

### `updateSettings` maintains `authored` correctly

`PageFlip.ts:813-822`: `nextAuthored` is built from `this.authored` merged with
`effective` (construction-time keys already stripped), `resolve` runs **before**
either field is committed, and `this.authored`/`this.setting` are assigned only
after it returns. So a rejected update leaves both untouched and the throw
propagates with the engine unchanged — verified by reproduction (the D4 throws
above leave the book usable). The construction-time refusal correctly uses
`this.setting[key]` for the "only warn when it differs" comparison, and
`CONSTRUCTION_TIME_SETTINGS` is `['hardCovers', 'initialPage']`, matching
`LiveSetting = Omit<FlipOptions, 'hardCovers' | 'initialPage'>`. The React
binding passes both keys in its settings object every time, which produces no
warning precisely because both are also in `remountKeyOf` and therefore cannot
differ without a remount — correct, and load-bearing enough to be worth a
comment.

### `flip`'s payload change is wired correctly

`flip` moved from a bare `number` to `BookSnapshot`. `[EMIT_PAGE_INDEX]` builds
it from `this.pages` and the render, and I confirmed `this.pages` is assigned
before the `show()` that can emit on all three replacement paths (`attachMode`
`PageFlip.ts:518` before `:628`; `updateFromHtml` `:700` before `:762`;
`replacePages` before its `show(target)`), so `pageCount` is never read off the
outgoing collection. The ADR 0003 guard itself is untouched.
