# Engine correctness review — round 4 (signoff pass)

Reviewer: standing engine-correctness reviewer (adversarial).
Commit under review, pinned: **`3014f00`** (covering `c4ecdb1`, `c062f1e`,
`90aa7a9`, `3014f00`).

Scope, per the coordinator: **`packages/*/src` only.** No test code was read,
run, or counted. Audited in an isolated worktree at `3014f00`; nothing in the
main checkout was touched except this file.

**Verdict: NOT a plain approve — 1 MAJOR, 1 MINOR.** Everything else is
genuinely fixed rather than moved, and the three new engine behaviours are
correct. The MAJOR is my round-3 BLOCKER 2, which is two-thirds fixed: one of
its three documented cases still fails, and the repair introduced a new delayed
failure on the very operation it was meant to unblock.

Verification gates, all clean:

```
pnpm build                                              → ok, 58?kB
pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json   → clean
pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json  → clean
```

Every claim below is reproduced against the built `packages/core/dist` under
jsdom, with positive controls where a passing result could otherwise be vacuous.
Verbatim output is quoted.

---

## MAJOR — BLOCKER 2 is two-thirds fixed: the `responsive → fixed` transition still throws, and the round-trip now arms a delayed failure

`packages/core/src/Settings.ts` — the `sizing === FIXED` conflict loop.

The new rule rejects only when `authored !== derived`, where `derived` is
`result.width` for `minWidth`/`maxWidth` and `result.height` for
`minHeight`/`maxHeight`. Re-running all three round-3 reproductions plus two
controls:

```
(a) responsive->fixed w/ authored minWidth 150 : THREW INVALID_SETTING
       minWidth: expected either 200 or nothing under sizing: 'fixed' …, received 150
(b) updateSettings(getSettings())              : OK
(b2)  THEN updateSettings({width:500})         : THREW INVALID_SETTING
       minWidth: expected either 500 or nothing under sizing: 'fixed' …, received 200
(c) new PageFlip(getSettings())                : OK
(d) plain resize width 200->500 (no round-trip first) : OK
(e) genuinely conflicting fixed+minWidth       : THREW  ← correct, diagnostic preserved
(f) resolve idempotence (responsive)           : true   ← correct
```

**(a) is unfixed, and it is the commit's own first bullet.** The comment above
the loop lists "`updateSettings({ sizing: 'fixed' })` on a responsive book that
had authored a `minWidth`, which is a documented live transition" as one of the
three things being repaired. It still throws. The rule cannot fix it, because an
authored responsive bound will essentially never equal `width` — a caller
authors `minWidth` precisely _because_ it differs from the page width. So the
new predicate rejects exactly the configurations the transition is for.

**(b2) is new, and it is the defect moving rather than leaving.** The round-trip
now succeeds — but `updateSettings` commits `this.authored = nextAuthored`, so
the derived bounds are absorbed into the authored record. A later, entirely
ordinary `updateSettings({ width: 500 })` then re-derives `500` and finds the
absorbed `minWidth: 200` conflicting. Line (d) is the control: the same resize
on a book that never round-tripped is fine. So the operation this class
advertises as safe (`Settings.ts` "…`getSettings()` can round-trip") succeeds
and silently arms the next resize.

**Answering the coordinator's question directly: no, "compare against the
derived value" is not the right rule** — and the reason is structural rather
than a missing case. `authored` exists to record _what the caller wrote_.
Validating an entry in it against the _current_ value of a different setting
makes a stored intent's validity depend on state it was never written against,
so the same `authored` object is valid or invalid depending on what happened
since. That is why (a) and (b2) fall out of it, and why patching either
individually will not hold.

It does not wrongly _accept_ anything I could construct: `minWidth: 400` under
`width: 400` is admitted, but it is a genuine no-op that resolves to the same
value, and the real diagnostic case (e) still fires. The failure mode is
entirely false positives.

**Recommended fix (minimal, and it satisfies all of a/b/b2/c/d/e):** validate
only the bounds **named in the current call**, not the accumulated ones. In
`PageFlip.updateSettings`, the current call's keys are already isolated as
`effective`; pass that key set into `resolve` and skip the conflict check for
any bound not in it. The constructor passes its whole input, so (e) still
throws where it should. With this:

- (a) `updateSettings({ sizing: 'fixed' })` carries the inherited `minWidth: 150`
  through, the fixed branch overwrites it to `width` for the resolved settings,
  and `authored` keeps `150` — so switching back to `'responsive'` restores the
  caller's declared bound, which is the round-trip the class advertises;
- (b2) disappears, because the absorbed bounds were never "named in the call".

A cleaner variant of the same idea is a `resolve(authored, { strict })` flag,
`true` from the constructor and `false` from `updateSettings` — the diagnostic
is most valuable to a new consumer at construction, which is where it was
motivated.

---

## MINOR — `replacePages` does not participate in the deferred announcement

`PageFlip.attachMode` now defers when the load is empty (`if (snapshot.pageCount > 0)
this.announceLoad(...)`, `PageFlip.ts:606`) and `updateFromHtml` picks the
deferral up (`if (openingFresh && !this.readyAnnounced)`, `PageFlip.ts:819`).
`replacePages` — the third collection-replacing path — has neither: it emits
`pagesChanged` only.

So `loadFromHTML([])` followed by `replacePages(nonEmptyCollection, 0)` leaves a
populated, working book for which `ready` and `loaded` never fire, and
`readyAnnounced` stays `false` for the life of the engine.

Ranked MINOR because `replacePages` is an `@internal` wiring seam for a future
renderer and nothing in-tree reaches it — the React binding uses
`updateFromHtml`. But the deferral is now an invariant spread across two of
three paths, which is the "every caller must remember" shape this codebase
repeatedly refactors away from. Either route the third path through
`announceLoad` too, or state in `announceLoad`'s docblock that `replacePages` is
deliberately excluded and why.

---

## Verified fixed — round 3 findings

Each re-run rather than read.

### BLOCKER 1 (`openingFresh` always true) — fixed

`wasEmpty` is captured at `PageFlip.ts:746`, two lines before
`previous.destroy()` at `:748`, and `openingFresh` at `:798` reads the captured
value.

```
reader stays on 4?  4  | flips []          (was: 0, and silent)
empty-shell honours initialPage?  3        (React mount path preserved)
```

Both halves hold: a genuine 6-node replacement leaves the reader in place and
announces nothing, and the `loadFromHTML([])` → `updateFromHtml(6)` shell mount
still opens on `initialPage`.

### MAJOR 3 (lost stale-announcement guard) — fixed

`announceLoad` (`PageFlip.ts:613-631`) stamps the generation, re-checks
`isDestroyed() || loadGeneration !== generation` before `ready` and **again**
between `ready` and `loaded`. Re-running the reload-from-`ready` repro:

```
ready  {"page":0,"pageCount":6,…}
loaded {"page":0,"pageCount":2,…}      ← inner, correct
final pageCount 2
```

The stale outer `loaded{pageCount:6}` is gone. The `superseded()` closure rather
than a narrowed field is the right call and the comment explaining why
TypeScript's narrowing is wrong here is accurate.

### MAJOR 4 (`ready`/`loaded` described the empty shell) — fixed

Seven-row matrix, `[events]` with `pageCount`:

| Sequence                                              | Events                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `loadFromHTML(6)`                                     | `ready:6, loaded:6`                                 |
| `loadFromHTML([])`, `updateFromHtml(6)`               | `ready:6, loaded:6, pagesChanged:6`                 |
| …then `updateFromHtml(4)`                             | `pagesChanged:4` only                               |
| `load(6)`, `clear()`, `load(6)`                       | `ready:6, loaded:6, pagesChanged:0, loaded:6`       |
| `load([])`, `updateFromHtml([])`, `updateFromHtml(6)` | `pagesChanged:0, ready:6, loaded:6, pagesChanged:6` |
| `load(6)`, `updateFromHtml([])`, `updateFromHtml(3)`  | `ready:6, loaded:6, pagesChanged:0, pagesChanged:3` |
| `load([])`, `loadFromHTML(6)`                         | `ready:6, loaded:6`                                 |

No path announces twice — the `&& !this.readyAnnounced` gate at `:819` is what
makes the deferral strictly once per engine — and no populated book is left
without a snapshot event. `ready` is exactly once per engine; `loaded` is once
per `loadFromHTML` plus the one deferred pickup. Row 6 is the only case worth
naming: a book emptied and repopulated through `updateFromHtml` gets
`pagesChanged:3` and no second `loaded`, which is correct — `updateFromHtml` is
not a load, and the snapshot shape is identical.

### MAJOR 5 (`flipOnClick: 'never'`) — fixed, and it does not over-reach

`requestUserTurn` (`PageFlip.ts:1129-1140`) handles `'never'` before the
`'corners'` branch. Critically, `requestUserTurn` is reached only from
`userStop` when `!isSwipe && !isUserMove` — a click — so drags (`stopMove`) and
swipes (`flipNext`/`flipPrev` via `requestTurn`) bypass it. Measured, mid-book:

```
after CLICK:  idx 2, rejections ["disabled"]
after SWIPE:  idx 4                            ← swipe still works
```

### MAJOR 6 (`pointerInput` filtering) — fixed, turns and hover-peel both

`acceptsPointer` (`UI.ts:646-652`) is consulted in `onPointerDown` (`:658`) and
`onPointerMove` (`:705`). With `pointerInput: ['touch']`:

```
POSITIVE CONTROL  default        -> mouse hover state: fold_corner
BLOCKED           ['touch']      -> mouse hover state: read
                  ['touch']      -> mouse swipe idx: 2 (unmoved)
```

The positive control matters: without it the "blocked" row would pass for a test
that simply missed the corner. Admitting an unknown `pointerType` only when the
list is un-narrowed is a defensible reading and is documented. Deliberately
_not_ gating `onPointerUp` / `onPointerCancel` / `onPointerLeave` is also
correct — a rejected pointer leaves no state, and gating the release paths would
be the only way to strand some.

### MINORS 1–4 — all fixed

Stale comments corrected; `mouseChanged` compares as a Set
(`PageFlip.ts:883`); `[EMIT_PAGE_INDEX]` uses `this.render?.getOrientation() ??
'landscape'`; `SizeModeValue` is gone from `index.ts:6`.

---

## New in `3014f00` — audited as engine changes

### `maxHeight` in `Render.computeBounds` — correct

`heightCap = Math.min(this.setting.maxHeight, blockHeight)` clamped before the
fit, with `pageWidth = pageHeight * ratio` re-derived. Measured, page 400×200
(ratio 2:1):

| Config                           | block     | result                            |
| -------------------------------- | --------- | --------------------------------- |
| no `maxHeight`                   | 1000×1000 | `w 500 h 250`, `maxHeight → 2000` |
| `maxHeight: 100`                 | 1000×1000 | `w 200 h 100` — cap wins          |
| `maxHeight: 100`                 | 1000×50   | `w 100 h 50` — block wins         |
| `maxHeight: 5000`                | 1000×1000 | `w 500 h 250` — inert             |
| `maxHeight 300 < minHeight 400`  | 1000×1000 | `maxHeight → 2000`, uncapped      |
| `maxHeight: 0` explicit          | 1000×1000 | `maxHeight → 2000`, uncapped      |
| `maxWidth 300` + `maxHeight 100` | 1000×1000 | `w 200 h 100` — tighter wins      |

- **Composes with `maxWidth`:** the width cap runs first, height is derived, the
  height cap then re-derives width — so a height cap can only shrink width
  further and the two compose as "tighter wins", exactly as the comment claims.
- **Aspect ratio preserved** in every row (2:1 throughout).
- **Portrait threshold untouched:** the orientation test is
  `blockWidth < minWidth * 2`, evaluated before any height work, so `maxHeight`
  cannot change orientation. Correct — orientation is a width question.
- **No zero / negative / NaN reachable.** `maxHeight` passes `isNonNegative`
  (finite, ≥ 0) in the bounds loop, and the responsive branch forces
  `maxHeight ≥ minHeight ≥ 100` via `Math.max(2000, minHeight)`, so both the
  unset default (`0`) and an explicit `0` are synthesised away before
  `computeBounds` reads it. The only route to a zero page is `blockHeight === 0`,
  which predates this change and is guarded by the `observed` check in
  `Render.update`.
- **Fixed sizing:** `maxHeight` is derived to `height` and the fixed branch of
  `computeBounds` never reads it — inert, as intended.

One consistency note, not a finding: `maxHeight < minHeight` is silently raised
to 2000, mirroring the existing `maxWidth` behaviour. That is internally
consistent but is the same "silently overwritten and echoed back" shape D4 was
created to catch on the fixed path.

### `Flip.flipToPage` / `PageFlip.flip` returning boolean — correct on every path

| Path                                                | Result                      | Verified                              |
| --------------------------------------------------- | --------------------------- | ------------------------------------- |
| same-spread no-op (`flip(1)` while showing `[0,1]`) | `true`, index unchanged     | `-> true`, idx 0                      |
| ordinary turn                                       | `true`                      | `flip(3) -> true`, idx 2              |
| superseded by a nested turn                         | `false`                     | `outer flip(2) returned false`, idx 6 |
| page out of range                                   | throws `PAGE_NOT_IN_SPREAD` | ✓                                     |
| non-integer page                                    | throws `PAGE_NOT_IN_SPREAD` | ✓                                     |
| before load                                         | throws `NOT_LOADED`         | ✓                                     |

The same-spread `true` is right and the reasoning in the comment is right: the
postcondition of `flipToPage(p)` is "page p is visible", which a partner-half
request already satisfies. Both early-return-`false` sites (`finishOutgoingTurn`
and `refusal === 'superseded'`) are supersession, not error, and the
`takeRefusal()` read-and-clear before the branch prevents a stale `superseded`
attaching to a later boundary refusal.

### `TurnRejected.landedOn` — correct at every site

All five core sites use `this.pages === null ? null : this.resolvedPageIndex(this.pages)`
read at dispatch time, so it reports where the reader actually is rather than a
captured value. Measured:

```
flipNext at the end   -> false {"direction":"next","landedOn":4,"reason":"boundary"}
flipPrev at the start -> false {"direction":"prev","landedOn":0,"reason":"boundary"}
flipNext before load  -> false {"direction":"next","landedOn":null,"reason":"notReady","code":"NOT_LOADED"}
```

The `notReady` site is hard-coded `null` (`PageFlip.ts:1176`), which is right —
there is no book to have landed on. The React sites guard with
`engine.getPageCount() > 0 ? … : null`, which is necessary because both getters
throw on an unloaded engine; the controlled-page catch block reads `landedOn`
_after_ its clamping `turnToPage`, so it reports the post-clamp position rather
than the request. That is the field's stated meaning.
