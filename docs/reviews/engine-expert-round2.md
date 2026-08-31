# Engine correctness review — round 2

Reviewer: standing engine-correctness reviewer (adversarial).
Commits under review, pinned:

- `e96b29c` — refactor(core)!: delete the inert `SizeType.FIXED` branch in `applyHostSize` **[U10]**
- `45f0e2e` — fix(core)!: close the last two named seams, and the four test gaps **[C3–C6]**
- `b73726e`, `9f79712` — context (test hardening; C7 recorded)

**Verdict: no BLOCKERs. Three MAJORs, four MINORs.**

U10 is correct and I could not break it. C3's _mechanism_ is right and complete
for the two members it names — but the claim that these were **the last two**
is false, and I disprove it below with two measured counterexamples reachable
through public getters. The C5 enumeration is structurally complete against
source; two cells in it are wrong.

Reviewed at the pinned SHAs. Note the worktree carries an uncommitted
modification to `packages/core/src/Render/HTMLRender.ts` from a concurrent
agent — not mine, not reviewed here. I modified nothing; my scratch test was
run and deleted.

---

## MAJOR 1 — C3's "last two" claim is false: `UI.setOrientationStyle` leaves the _same_ harm reachable by name

`packages/core/src/UI/UI.ts:315`

```ts
public setOrientationStyle(orientation: Orientation): void {
```

Its only caller in the engine is `PageFlip[ADOPT_ORIENTATION]`
(`packages/core/src/PageFlip.ts:1190`) — it is a pure sibling seam. It is
`public`, it carries **no `@internal` tag at all**, and `PageFlip.getUI()`
(`PageFlip.ts:1277`) hands the object to any consumer.

`ADOPT_ORIENTATION`'s own docblock (`internal.ts:57-62`) states the harm being
closed:

> Public, it rebuilt the spreads and restyled the UI for an orientation the
> renderer has NOT adopted, leaving `Render`, `UI` and `PageCollection`
> disagreeing about how many leaves are on screen.

`setOrientationStyle` is the **restyle half of exactly that sentence**, still
named. Measured on a landscape book, using only public named members:

```
before: orientation=landscape  wrapper="stf__wrapper --landscape"
book.getUI().setOrientationStyle('portrait')
after:  orientation=landscape  wrapper="stf__wrapper --portrait"  changeOrientation events=[]
```

`Render.orientation` is untouched, so `getOrientation()` keeps reporting
`landscape` while the wrapper is styled `--portrait`; `applyWrapperRatio(PORTRAIT)`
and `this.update()` (`UI.ts:319-320`) both run, and **no `changeOrientation`
fires**, so a consumer caching orientation has no signal. That is the
`Render`/`UI` disagreement the symbol was introduced to prevent, reached one
method further along the same call chain.

Two aggravating details: the method has no runtime `Orientation` guard, so a JS
caller passing any string lands in the `--landscape` else-branch; and unlike
`attachMode` / `replacePages` / `getBlock` / `applyHostSize`, it is not even
marked `@internal`, so `docs/CANVAS_FIRST_CLASS.md:205`'s E5 criterion ("AGENTS.md
§3 requires `@internal` here") applies to it and was never raised.

Closing `PageFlip.updateOrientation` while leaving this open closes the front
door and leaves the side door. Symbol-key it, or state in the inventory why the
restyle half is acceptable when the announce half was not.

---

## MAJOR 2 — `PageCollection.setCurrentSpreadIndex` is a named sibling seam that measurably corrupts state

`packages/core/src/Collection/PageCollection.ts:396`

Callers: `Flip.ts:203`, `Flip.ts:206`, `Flip.ts:804` — all three inside
`flipToPage`'s phantom-index seam. Nowhere else. `public`, no `@internal` tag,
and `PageFlip.getPageCollection()` (`PageFlip.ts:1296`) hands the object out.

It writes `currentSpreadIndex` **without** calling `showSpread()`
(`PageCollection.ts:397-399`), so nothing repaints, nothing emits, and the two
public getters diverge. Measured on a 6-page landscape book sitting at spread 0
(spreads `[0,1] [2,3] [4,5]`):

```
start:            getCurrentPageIndex()=0  getCurrentSpreadIndex()=0
setCurrentSpreadIndex(2)
after:            getCurrentPageIndex()=0  getCurrentSpreadIndex()=2  flips=[]
turnToNextPage()
after showNext:   getCurrentPageIndex()=0  getCurrentSpreadIndex()=2  flips=[]
```

The last line is the damage. `showNext()` guards on
`currentSpreadIndex < getSpread().length - 1` (`PageCollection.ts:345`), which
is now `2 < 2` — false. **The book is silently un-turnable forward while still
displaying spread 0**, with no event, no error and no way for a consumer to
detect it. Nudge the index the other way instead and the next `showNext()`
paints an arbitrarily distant spread as if it were one step.

`Flip.ts:194-196` documents this precise failure as a bug it already fixed —
"`getCurrentPageIndex() === 5` and `getCurrentSpreadIndex() === 0` — two public
getters contradicting each other". C3's stated premise is that a member which
can make the engine lie should not be reachable by name. This one can, and is.

Note the seam is genuinely needed by `Flip` (the `try`/`finally` restore at
`:203-206` and the commit re-base at `:804`), so the fix is the symbol, not
removal.

---

## MAJOR 3 — a breaking public-surface removal is absent from `MIGRATION.md`, and the `Unreleased` changelog entry now describes the opposite of what ships

`45f0e2e` is marked `fix(core)!`. It removes `updateState` and
`updateOrientation` from `PageFlip`'s named surface. Neither file records it.

`CHANGELOG.md:415` — inside `## Unreleased` (the only other heading is
`## 3.0.0` at `:836`) — currently reads:

> **`updateState`, `updatePageIndex` and `updateOrientation` are `@internal`.**
> … **No runtime change** …

All three statements are now false: none of the three is `@internal`-and-named
any more (all three are symbol-keyed), and removing a named member from an
exported class _is_ a surface change. That entry is the release note for a state
that will never ship.

`MIGRATION.md:346` documents `updatePageIndex()`'s removal in full and stops
there. `updateState` and `updateOrientation` — both `public` in the shape this
fork inherited, both removed by a `!` commit — get no entry, so a consumer
upgrading gets a compile error with nothing in the migration guide to explain
it. CLAUDE.md makes the changelog record part of the deliverable for engine
fixes.

Fix: rewrite the `:415` bullet as a removal (it can absorb `updatePageIndex`'s
existing story), and add one `MIGRATION.md` section covering both, pointing
`updateState` readers at `getState()` / the `changeState` event and
`updateOrientation` readers at `getOrientation()` / `changeOrientation` — i.e.
"observe it, do not announce it", which is the actual replacement.

---

## MINOR 1 — C5: the `turnToPage(page)` row's "Emits: yes" contradicts the ADR's own defect list

`docs/adr/0003-flip-event-semantics.md`, second table:

| Caller                      | Baseline                      | Emits   |
| --------------------------- | ----------------------------- | ------- |
| `PageFlip.turnToPage(page)` | unchanged — a real navigation | **yes** |

`turnToPage` is `pages.show(page)` (`PageFlip.ts:1042`), which is guarded like
every other `show()`. `turnToPage(currentIndex)` emits **nothing** — and the
ADR's own "The defect" section lists "`turnToPage(currentIndex)` fired `flip`"
as one of the five measured defects this change removes, and the `Unreleased`
changelog repeats it at `CHANGELOG.md:15`.

Every sibling row in the same table is phrased correctly ("only if the head
really moved"). This one should read the same. As written, a reader taking the
table as the contract concludes the fix does not cover `turnToPage`.

---

## MINOR 2 — C5: `setCurrentSpreadIndex` is missing from the enumeration, and it falsifies "moves the head by one spread"

First table:

| Entry        | Moves the head?        |
| ------------ | ---------------------- |
| `showNext()` | yes, **by one spread** |

True of `currentSpreadIndex`, not of the head. `Flip`'s animated commit
(`Flip.ts:804`) re-bases the collection first —
`getPageCollection().setCurrentSpreadIndex(target)` — and _then_ calls
`turnToNextPage()` / `turnToPrevPage()`. So a `flipToPage(5)` from page 0
reaches `showNext()` with `currentSpreadIndex` already forged to the
destination-minus-one, and the head jumps the whole distance in a single
`showSpread()`. The emit is still correct (the head really moved, and it is
announced once), so this is a wording defect in an explicitly exhaustive list,
not a behavioural one.

`setCurrentSpreadIndex` — the fourth and only writer of `currentSpreadIndex`
outside `showNext`/`showPrev`/`show` (`PageCollection.ts:346, 356, 379, 398`) —
appears nowhere in the enumeration. Given the ADR's stated purpose ("so a new one
cannot be added without noticing it needs a baseline"), the one call that can
change _which_ head `showNext()` lands on deserves a row or a sentence.

---

## MINOR 3 — the rest of the sweep: `Render`'s mutators are named sibling seams too

Ranked below the two above because they corrupt the _picture_ rather than the
_reported_ state — no public getter starts lying and no event is fabricated — but
they defeat the "last two" claim on its letter. All are `public` on `Render.ts`,
**none carries an `@internal` tag**, all exist only for `Flip` / `PageCollection`
/ `PageFlip` to call, and all are reachable through the public `getRender()`:

`setPageRect` (`:1003`), `setDirection` (`:1028`), `setRightPage` (`:1039`),
`setLeftPage` (`:1055`), `setBottomPage` (`:1067`), `setFlippingPage` (`:1083`),
`setShadowData` (`:813`), `clearShadow` (`:858`), `releasePages` (`:927`),
`startAnimation` (`:589`), `finishAnimation` (`:645`), `start` (`:359`),
`stop` (`:558`).

Measured: `book.getRender().releasePages()` leaves the engine reporting
`getCurrentPageIndex() === 0` and `getState() === read` with nothing drawn — a
blank book whose every getter reads normal.

I am **not** recommending symbol-keying these (see the recommendation below for
the stopping rule). I am recommending that `docs/INVENTORY.md`'s C3 entry stop
saying these were the last two, and that the `@internal` gap be closed on the
whole set — `docs/CANVAS_FIRST_CLASS.md:205` already sets that bar and thirteen
`Render` members plus `UI.setOrientationStyle` plus
`PageCollection.setCurrentSpreadIndex` fail it.

---

## MINOR 4 — the seam test proves presence but not exclusivity

`packages/core/tests/flip-event-semantics.test.ts:356-390`

The added half is a real improvement — asserting the symbols still exist kills
the "delete the seam" mutant that the name-only version accepted. Two gaps:

- Only one absence is asserted (`DROP_POINTER_GESTURE` is not on `PageFlip`).
  Nothing checks that `EMIT_STATE` / `ADOPT_ORIENTATION` are _not_ on `UI` or
  `PageCollection`, or that `INHERIT_PAGE_INDEX` / `SEED_OPENING_INDEX` are not
  on `PageFlip` — so a mutant that installs a seam on the wrong owner passes.
  The loop already has the shape for it; it needs an owner matrix rather than
  one hand-picked negative.
- `Render` is not examined at all, in either half.

---

## C3 factoring — recommendation

**Keep the single module. Do not split, do not introduce a registry.** The cycle
argument in `internal.ts:31-34` is correct and load-bearing: per-class symbol
modules put a value import back the way `PageFlip → Collection/PageCollection`
already runs. A registry object or branded seam interface costs bytes against a
brotli headroom the U10 commit measured at 24 and buys nothing a comment does
not.

Six is not yet a mess. What is missing is a **stopping rule**, and its absence is
what produced MAJOR 1 and MAJOR 2 — the batch symbol-keyed the two members
someone happened to be looking at rather than the ones that meet a criterion.
Write the criterion into the file's preamble:

> A member gets a symbol when **both** hold: (i) its only callers are sibling
> engine classes, and (ii) calling it from outside can make a public getter lie,
> or fabricate or suppress a public event. Members that merely break rendering
> stay named and `@internal`.

Applied, that admits `UI.setOrientationStyle` (desyncs `getOrientation()` from
what is on screen, suppresses `changeOrientation`) and
`PageCollection.setCurrentSpreadIndex` (desyncs `getCurrentSpreadIndex()` from
`getCurrentPageIndex()`, silently disables a turn) — taking the file to eight —
and excludes all thirteen `Render` mutators. That is a rule that yields a stable
answer, which is what "is this accreting" is really asking.

Two cheap, zero-byte hygiene changes alongside it:

1. **Tag each symbol with its owner and order the file by owner.** The question a
   reader has at a call site is "may I call this from here", and the answer is
   the owning class. Today `PageFlip`-owned (`EMIT_PAGE_INDEX`, `EMIT_STATE`,
   `ADOPT_ORIENTATION`), `PageCollection`-owned (`INHERIT_PAGE_INDEX`,
   `SEED_OPENING_INDEX`) and `UI`-owned (`DROP_POINTER_GESTURE`) are interleaved
   in the order they were added.
2. **Refresh the file-level docblock.** `internal.ts:5-36` still motivates the
   whole module from the two original page-index symbols ("Two of those turned
   out to hand a consumer…"), which now describes a third of the file. It reads
   as the historical note it has become rather than the contract it is titled as.

---

## Verified correct — nothing wrong found

Stated explicitly rather than padded into findings.

### U10 is inert on every reachable configuration

The claim holds, and it holds for a stronger reason than the commit message
gives. `SizeType` is `'fixed' | 'stretch'` and nothing else (`Settings.ts:11`),
and `getSettings` **throws** `INVALID_SIZE` for any third value
(`Settings.ts:173-176`) — so "non-stretch" and "fixed" are the same predicate,
and the deleted `size === FIXED` branch was the exact else-arm of the
`size === STRETCH` test at `Settings.ts:294`. That else-arm
(`Settings.ts:306-311`) assigns `minWidth = width` / `minHeight = height`
**unconditionally**, overwriting anything the caller supplied. Both branches of
the deleted code used the same `k`, and neither touched `autoSize`.

Every route into `applyHostSize` passes a `FlipSetting` that came out of
`getSettings`: the `PageFlip` constructor, `UI`'s constructor
(`UI.ts:136`, handed `this.setting`), and `updateSettings`
(`PageFlip.ts:943`, after `new Settings().getSettings({...})` at `:849`).
`size` is deliberately **not** in `CONSTRUCTION_TIME_SETTINGS`
(`PageFlip.ts:38` and its docblock), so a `stretch → fixed` switch at runtime
also re-derives through the same else-arm.

Measured across the combinations that could plausibly diverge — all host
`minWidth` / `minHeight` after load:

| Config                                                                               | Result                                              |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `fixed`, landscape, explicit `minWidth: 50, minHeight: 40`                           | `400px` / `300px` (settings coerced to 200/300)     |
| `fixed`, `usePortrait`, `autoSize`, explicit `minWidth: 50`                          | `200px` / `300px`, `maxWidth: 400px`, `width: 100%` |
| `fixed`, then `updateSettings({ minWidth: 50, minHeight: 40 })`                      | `400px` / `300px` — unchanged                       |
| `fixed`, then `updateSettings({ width: 250 })`                                       | `500px` / `300px` — correctly restamped             |
| `stretch` (`minWidth: 111, minHeight: 77`), then `updateSettings({ size: 'fixed' })` | `222px`/`77px` → `400px`/`300px`                    |

The one construction where old and new differ is a hand-built `FlipSetting`
with `size: 'fixed'` and `minWidth !== width` passed straight to the public
`applyHostSize` — which is an `@internal` seam and is not producible through any
supported path. The existing Y5 tests
(`packages/core/tests/pointer-transform.test.ts:602-664`) pass hand-built
objects but every one either spreads a fixed book's `live` (where
`minWidth === width` already) or sets `size: 'stretch'`, so none of them crosses
the deleted branch in either direction. **Not a blocker; no config to fix.**

The new pin at `runtime-settings.test.ts:226-258` is the right test for the right
coupling. One suggestion, not a finding: it asserts the landscape `k = 2` case
only. A second assertion with an explicit `minWidth: 50` alongside `size: 'fixed'`
would pin the _overwrite_ rather than the coincidence — that is the line in
`Settings.getSettings` the deletion actually depends on.

### C3 conversion is complete — no path reaches the old names

`git grep` over `packages/core/src`, `packages/react/src`, all test
directories, `examples/`, `e2e/`, `fixtures/` and `docs/` for `updateState`,
`updateOrientation`, `updatePageIndex`, `adoptCurrentPageIndex` returns **no live
call site**. Every remaining hit is one of: prose in a comment
(`Flip.ts:885`, `Render.ts:382,696`, `PageCollection.ts:62`, `internal.ts:18`),
a doc or changelog line, the deliberate name-absence list in
`flip-event-semantics.test.ts:365-368`, or a local variable in the
`render-loop.test.ts` harness whose mock is correctly keyed
`[ADOPT_ORIENTATION]` (`render-loop.test.ts:87`).

No bracket access by string literal and no `as unknown as Record<string, …>`
cast in `packages/core/src` or `packages/react/src` reaches either member — the
only such casts in the repo are in the seam test itself, and they assert
`undefined`. Both new call sites are correct: `Flip.ts:891`
(`this.app[EMIT_STATE](newState)`, still after the `this.state = newState`
assignment the F-series fix requires) and `Render.ts:726`
(`this.app[ADOPT_ORIENTATION](orientation)`, still inside the
`if (this.orientation !== orientation)` guard the ADR relies on at `:43-46`).

### C5's structure is exhaustive against source

- **`showSpread()` has exactly three callers**, as claimed:
  `showNext` (`PageCollection.ts:347`), `showPrev` (`:357`), `show` (`:380`).
  The definition is `private` (`:410`), so there is no fourth entry from outside.
- **`show()` has exactly six call sites in `src`**, and they map one-to-one onto
  the ADR's second table: `PageFlip.update()` (`:411`), `replacePages` (`:507`),
  `attachMode` (`:628`), `updateFromHtml` (`:805`), `turnToPage` (`:1042`),
  `UI.cancelGesture()` (`UI.ts:535`). No caller is missing and no row is invented.
- **Every writer of `currentPageIndex` is accounted for**: the constructor
  (`:42`), `INHERIT_PAGE_INDEX` (`:77`), `SEED_OPENING_INDEX` (`:92`) and
  `showSpread` (`:536`). The first three are the table's "Baseline" column; the
  fourth is the guarded assignment itself.
- The `UI.cancelGesture()` row's **"Emits: no" is unconditionally true**, and I
  checked the case that could have broken it: `show(null)` re-derives the spread
  from `currentPageIndex` (`:373, 377-379`), so even when `Flip` has forged
  `currentSpreadIndex` via `setCurrentSpreadIndex`, the repaint overwrites the
  forgery and lands on the same head. No emit.
- The `PageFlip.update()` row's **"only when an orientation change
  re-canonicalises the head" is true**. `show(null)` reads `currentPageIndex`,
  which `showSpread` always leaves equal to a spread head, so within a fixed
  table the guard is always false. The one window where `currentPageIndex` is
  _not_ a head of the live table — between `INHERIT_PAGE_INDEX` and the
  following `show(target)` — contains no `update()` on any of the three paths
  (`PageFlip.ts:499→507`, `:804→805`, `:611→628`), and the empty-collection
  branch that skips `show()` entirely (`:502-506`) leaves an index that
  `show()` later rejects at the `pageNum >= this.pages.length` guard.
- The C2 clarification added to the ADR ("An **emptied** outgoing collection
  counts as a first load — `clear()` does not null `PageFlip.pages`") matches
  `3f3eece` and matches round 1's reproduction.

### Nothing found against C4 / C6 / the context commits

`b73726e`'s four fixes are the right fixes and the `init`-ordering one is
strictly stronger than what it replaces (a synchronous assertion on an event log
could only ever see `[]`, so the original ordering claim was vacuous — correct
diagnosis). C6's answer is consistent with the engine: on a hard BACK fold
`getFlippingPage` and `getBottomPage` resolve to the same leaf, `shouldDrawBottomPage`
skips the bottom draw for exactly that case, and `--right` selects `drawHard`'s
right-leaf base whose origin is the spine — `--left` would rotate a closing cover
about its outer edge. C7 is correctly _recorded_ rather than fixed; note it is
the same defect class as C2 and its existence means the React binding still
announces a mount turn, so C2's user-visible win remains core-only.
