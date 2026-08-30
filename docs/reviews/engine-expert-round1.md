# Engine correctness review — round 1

Reviewer: standing engine-correctness reviewer (adversarial).
Commits under review, pinned:

- `c01cdbe` — fix(core): a settle must drop the POINTER gesture, not just the engine flags **[C1]**
- `be475d8` — fix(core): a nonzero startPage must not fabricate a flip on mount **[C2]**
- `206e7c9` — test(core): parameterize the C1 gesture teardown over every caller

**Verdict: no BLOCKERs. One MAJOR (C2 is incomplete on one reachable path), three
MINORs.** Both fixes are put in the right place and neither introduces a
correctness regression I could construct. Gate state at review time on the
current worktree: `pnpm test` 50 files / 779 tests passed, `pnpm lint` clean,
`pnpm typecheck` clean.

---

## MAJOR — C2 is incomplete: `clear()` then `loadFromHTML` still fabricates the pre-`init` `flip`

`packages/core/src/PageFlip.ts:542`

```ts
const isFirstLoad = this.pages === null;
```

`clear()` (`packages/core/src/PageFlip.ts:945-1005`) destroys the collection but
deliberately leaves `this.pages` pointing at the emptied one — `PageCollection.destroy()`
(`packages/core/src/Collection/PageCollection.ts:103-124`) empties `pages` and the
spread tables while explicitly keeping `currentPageIndex`. So the next
`loadFromHTML` reaches `attachMode` with `this.pages !== null`, takes the
**reload** branch, and gets `outgoing = this.resolvedPageIndex(this.pages)` —
which is `0`, because `resolvedPageIndex` (`PageFlip.ts:399-402`) returns `0` for
any collection with `getPageCount() === 0`.

That `0` is a placeholder for "no position", not an index the book was ever on.
The ADR 0003 guard in `showSpread` (`PageCollection.ts:534-541`) then compares it
against the head of the opening spread and announces exactly the event C2 exists
to remove — and, per C2's own second argument, announces it **before** `init`,
which is dispatched from the 1 ms timer at `PageFlip.ts:615`.

Reproduced against the current worktree (temporary test, since removed):

```
book = new PageFlip(host, { …, startPage: 4 });
book.loadFromHTML(pages);   // C2 seeds; silent. correct.
book.clear();
book.loadFromHTML(pages);   // -> emits flip:4, then init. index 4.
```

Observed: `["flip:4"]`, ordered before `init`. The two other shapes I checked
behave correctly: a plain reload while already on 4 is silent (`[]`, index 4 —
the guard is right to stay silent, nothing moved), and the React-shaped
`loadFromHTML([])` + `updateFromHtml(pages)` is silent (index 0 — see MINOR 3).

The commit message's reasoning is what misses it: _"A RELOAD keeps `outgoing`:
there the index really can move, and the guard is right to say so."_ True for a
reload from a **populated** collection. An emptied one has no index that can
move, which is precisely the distinction `resolvedPageIndex` already draws and
which ADR 0003's "Why `clear()` stays silent" section spells out ("'The index
changed' is not well-defined there").

Suggested fix — one predicate, matching the rule already in the file:

```ts
const isFirstLoad = this.pages === null || this.pages.getPageCount() === 0;
```

Regression cover to add: `clear()` → `loadFromHTML` with a nonzero `startPage`
emits no `flip` and nothing before `init`; and the existing reload-from-a-real-
index case must still emit when the head genuinely moves (that one is the mutant
this predicate could break, so assert it in the same file).

---

## MINOR 1 — C1: the `attachMode` call site hits the OLD, already-destroyed UI, and the comment says otherwise

`packages/core/src/PageFlip.ts:1320-1323`

```
// Guarded: `attachMode` reaches here with no UI yet, …
this.ui?.[DROP_POINTER_GESTURE]();
```

Answering the question directly: **the recipient is the outgoing UI, and on the
first attach it is `null`.** `attachMode` destroys the old UI at
`PageFlip.ts:541` (`this.ui?.destroy()`), calls `resetUserGesture()` at `:562`,
and only assigns `this.ui = ui` at `:581`. So `this.ui` at `:1323` is never the
incoming UI.

That is the correct object to _not_ need — the incoming UI is freshly
constructed with `touchPoint = null` / `activePointerId = null`
(`UI.ts:41-63`) — but it also makes the call **provably dead on this path**:
`UI.destroy()` → `removeHandlers()` (`UI.ts:330-345`) → `cancelGesture()`
(`UI.ts:511-517`) has already run `DROP_POINTER_GESTURE` one line earlier in the
same call.

Is a call on a destroyed UI genuinely harmless? Yes, and it is not
belt-and-braces luck: `DROP_POINTER_GESTURE` (`UI.ts:497-500`) only nulls a field
and delegates to `releaseCapturedPointer` (`UI.ts:471-484`), which early-returns
on a null `activePointerId` — so it never touches `distElement` after teardown.
Idempotent by construction.

Two consequences worth acting on:

1. The comment is wrong for every attach but the first ("with no UI yet" ⇒ "with
   the previous, already-destroyed UI"). Fix the text.
2. The comment's second justification — the public `startUserTouch` / `userMove`
   / `userStop` surface driven by a custom input layer — is a good reason for the
   `?.`, but it is **not** a reason the `attachMode` call does anything: that
   surface writes only `PageFlip`'s three fields, which the lines above already
   clear. Commit `206e7c9`'s changelog is already honest that only `clear` and
   `replacePages` depend on the fix; `attachMode` belongs on the "second path"
   list too, one step stronger than "belt-and-braces".

No behavioural change requested.

---

## MINOR 2 — C1: `cancelGesture()`'s `wasActive` now reads false after a settle, short-circuiting a later `removeHandlers()`

`packages/core/src/UI/UI.ts:513-527`

`cancelGesture` computes `wasActive` from `touchPoint`/`activePointerId` and
returns early when both are already clear. After C1 that is now the state on
every path where `resetUserGesture()` ran first, so the tail of `cancelGesture`
(`userStop(lastPos, true)`, `flip.abandon()`, `getPageCollection().show()`) is
skipped where it previously ran.

Traced the one path where this actually happens — `updateFromHtml`:
`resetUserGesture()` at `PageFlip.ts:740`, then `ui.updateItems(items)` at
`:775` → `removeHandlers()` (`HTMLUI.ts:225`) → `cancelGesture()`. All three
skipped calls are already no-ops there:

- `userStop(lastPos, true)` — `isUserTouch` is already false (`PageFlip.ts:1345`).
- `flip.abandon()` — already called at `PageFlip.ts:739`.
- `getPageCollection().show()` — `this.pages` is assigned at `:745` but
  `pages.load()` only runs at `:776`, so `show()` hits the
  `pageNum >= this.pages.length` early return at `PageCollection.ts:375`.

So **no behavioural loss today.** It is a new implicit coupling: a future caller
that pairs `resetUserGesture()` with a path expecting `cancelGesture`'s repaint
gets silence. One line in the `DROP_POINTER_GESTURE` docblock in
`internal.ts:61-77` would pin it — that block already explains why this seam is
narrower than `cancelGesture()`; it should also say that calling it _disarms_
`cancelGesture()` for the rest of the tick.

---

## MINOR 3 — C2: the stated motivation is not reachable through this repo's React binding

The commit message and the source comment at `PageFlip.ts:604-606` both cite "a
controlled React binding acts on that `flip` and navigates itself". That
consumer does not exist here.

`HTMLFlipBook` mounts with `engine.loadFromHTML([])`
(`packages/react/src/HTMLFlipBook.tsx:495`) — the empty-shell load CLAUDE.md
documents — and delivers pages through `updateFromHtml`
(`HTMLFlipBook.tsx:565`), which never runs `attachMode`'s `startPage` logic at
all. It then honors `startPage` itself with an explicit `engine.turnToPage(start)`
(`HTMLFlipBook.tsx:586`), a real index move that legitimately emits.

Verified: `loadFromHTML([])` + `updateFromHtml(6 pages)` with `startPage: 4`
emits no `flip` and lands on index `0`, before _and_ after C2.

C2 is therefore a fix for **direct core consumers and the vanilla example**,
which is worth having and is correct — but the blast radius as written is
overstated, and the practical consequence is that C2's own two tests are the only
coverage it will ever get. Reword the motivation.

(Adjacent and out of scope: on the pure-core `loadFromHTML([])` →
`updateFromHtml(pages)` sequence, `startPage` is silently ignored — `attachMode`
resolves it against an empty collection and `updateFromHtml` clamps to the
inherited `0`. Pre-existing; noted so it is found rather than rediscovered.)

---

## Areas checked, nothing wrong found

Stated explicitly rather than padded into findings.

**C1 — pointer-event re-entrancy.** No handler resurrects the dropped gesture,
and none loses an event the engine needed.

- `onPointerDown` (`UI.ts:624-666`) writes `activePointerId`, `pointerCaptured`
  and `touchPoint` **before** `app.startUserTouch(pos)`, and does nothing
  state-bearing after it (only a conditional `preventDefault`). A listener-driven
  settle inside `startUserTouch`'s call tree therefore cannot be clobbered by the
  remainder of the handler. `startUserTouch` itself dispatches nothing.
- `onPointerMove` (`UI.ts:668-701`) has no UI-state writes after `app.userMove`.
  A `changeState` listener calling `updateSettings` with a fold-invalidating key
  reaches the settle at `PageFlip.ts:870-872`; the handler simply ends. The
  `mobileScrollSupport` branch's post-move `preventDefault` is then skipped
  because state is `READ` — correct for an abandoned gesture.
- `onPointerUp` (`UI.ts:703-746`) calls `releaseCapturedPointer()` on its first
  line and re-nulls `touchPoint` idempotently, so a settle triggered from inside
  its own `flipNext`/`flipPrev` (reachable with `flippingTime: 0`, where
  `onAnimateEnd` runs synchronously) cannot be undone by the rest of the handler.
- `onPointerCancel` / `onPointerLeave` route through `cancelGesture`, which is
  itself `DROP`-first.

**C1 — what survives a settle.** Nothing that can commit or misdirect a turn:

| State                                            | Cleared by                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `touchPoint` (swipe anchor)                      | `DROP_POINTER_GESTURE`, `UI.ts:498`                                                                                                    |
| `activePointerId`, `pointerCaptured`             | `releaseCapturedPointer`, `UI.ts:471-484`                                                                                              |
| hover-corner fold                                | `abandon()` → `setState(READ)` (`Flip.ts:1029`); `unfoldHoverCorner` requires `FOLD_CORNER` (`UI.ts:601-608`) so it can no longer fire |
| `Flip.calc`, `pendingTarget`, turn generation    | `abandon()`, `Flip.ts:1023-1029`                                                                                                       |
| `Render` animation / flipping / bottom / shadows | `render.cancelAnimation()`, called at every settle site                                                                                |
| `render.pageRect`                                | recomputed by the trailing `this.update()` (`PageFlip.ts:1006-1010`)                                                                   |
| the `swipeTimeout` window                        | not a timer — it is `Date.now() - touchPoint.time` at `UI.ts:722`, unreachable once the anchor is null                                 |

All five callers pair `cancelAnimation` + `abandon` + `resetUserGesture`:
`replacePages` `:471-474`, `attachMode` `:562`/`:576`, `updateFromHtml`
`:738-740`, the `updateSettings` settle `:870-872`, `clear` `:980`/`:983`
(abandon deliberately after, for the ordering reason documented there).
`destroy()` does not call `resetUserGesture` and does not need to — `ui.destroy()`
runs the full `cancelGesture`.

**C2 — the `SEED_OPENING_INDEX` no-op branch leaves no stale value.**
`PageCollection.ts:88-93` returns early when `getSpreadIndexByPage` is `null`.
That is reachable **only** for `pageCount === 0`: `resolveStartPage`
(`PageFlip.ts:103-109`) returns `0` for an empty book, and otherwise returns a
value it has _already proven_ resolves to a spread. For the empty case the
baseline correctly stays at the `INHERIT_PAGE_INDEX` value (`0` on a first load)
and `pages.show(start)` is a no-op too (`PageCollection.ts:375`), so the two stay
consistent. No path leaves a baseline that fabricates or suppresses a later flip.

**C2 — `resolveStartPage` validation.** Every hostile input lands on a page the
seed can resolve: `NaN` → `Math.min(Math.max(NaN, 0), n-1)` is `NaN` →
`getSpreadIndexByPage(NaN)` is `null` → `0`; `Infinity` → clamped to
`pageCount - 1`; `-Infinity` / negative → `0`; `1.5` → in range but a member of no
spread → `0`; out-of-range → clamped. The seed is never handed an index it will
refuse for a non-empty book.

**C2 — ADR 0003 orientation re-canonicalisation is not suppressed.** The seed
writes `currentPageIndex` only in the gap between `pages.load()` and the very
next `pages.show(start)` (`PageFlip.ts:611-613`), with no orientation change in
between and no other reader of the field in that window (`currentSpreadIndex` is
set by `show()` immediately after). The only announcement it can suppress is the
mount's own. The init-timer `ui.update()` (`PageFlip.ts:617`) re-canonicalisation
still fires, because the baseline it compares against is the **load-time head**:
portrait-at-load with `startPage: 1` seeds `1`, and a landscape re-resolve to
spread `[0, 1]` moves the head `1 → 0` and emits — which ADR 0003 requires. I
could not construct a case where the seed silences a real head move. The
landscape test in `flip-event-semantics.test.ts` documents the same hazard from
the other direction and is honest that it is a shape guard, not a second
reproduction.

**C2 — `isFirstLoad` across `destroy()`.** Correct by unreachability rather than
by the predicate: `destroy()` nulls `this.pages` (`PageFlip.ts:238`) but sets
`destroyed = true` first, and `attachMode` early-returns on `destroyed`
(`PageFlip.ts:525-529`), so the `pages === null`-after-destroy state is never
observed by the seed. `attachMode` reached twice (a plain reload) is handled
correctly — `isFirstLoad` is false and `outgoing` is a genuine index. The one gap
is `clear()`, above.

**Commit `206e7c9`.** The parameterization is the right response to both Codex
blockers and I have no findings against it. The stateful capture shims close the
mutant the earlier fixture could not (jsdom has no `hasPointerCapture`, so
`onPointerDown` takes its "did not throw, assume captured" fallback at
`UI.ts:645-651` and the no-op shims recorded nothing). Deleting the two
superseded `rtl-layout.test.ts` tests rather than keeping them is the correct
call, and the file records honestly that only `clear` and `replacePages` _depend_
on the fix. Per MINOR 1, `attachMode` should join `updateFromHtml` and
`loadFromHTML` on that second-path list.
