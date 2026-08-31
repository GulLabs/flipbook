# Test adequacy / mutation review — round 2

Scope: `e96b29c` (U10 deletion) and `45f0e2e` (C3–C6).

Method as round 1: every mutant below was **applied to the source, run, and
restored**. This round every restore was from a private copy under
`/private/tmp/.../scratchpad/r2`, never `git checkout`, so nothing raced with the
engine-expert or Codex work on the same tree.

Baseline before and after: `pnpm vitest run --project core` → 46 files /
**731 tests** passing. `git status --porcelain` at the end shows only two
untracked docs belonging to other agents (`codex-c3-c6-signoff.md`,
`engine-expert-round2.md`) — **no source or test file is modified by me**.

---

## Mutant ledger

| #     | Mutant                                                                                             | Edit                                                                              | Result                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| H1    | `setBottomPage` stamps no orientation at all                                                       | delete the `page.setOrientation(BACK ? LEFT : RIGHT)` call, `Render.ts:1070-1073` | **SURVIVED the new hard-BACK test** (and the soft-BACK test); only the soft FORWARD control failed |
| H2    | `setFlippingPage` ternary inverted                                                                 | `Render.ts:1081-1085`, `LEFT`/`RIGHT` swapped                                     | **KILLED** — by the new hard-BACK test, and _only_ by it                                           |
| H3    | `setLeftPage` stamps nothing                                                                       | delete `page.setOrientation(LEFT)`, `Render.ts:1058`                              | **SURVIVED all 6 tests in the file**                                                               |
| H1+H3 | both stamps gone                                                                                   | as above, together                                                                | soft-BACK `--left` **still passes** (third source: `HTMLRender.update()`, `HTMLRender.ts:344-353`) |
| H4    | `setBottomPage` ternary inverted (the realistic hostile variant)                                   | `Render.ts:1072`, `LEFT`/`RIGHT` swapped                                          | **KILLED** by the two SOFT tests                                                                   |
| S1    | `drawOuterShadow` gradient ternary swapped                                                         | `HTMLRender.ts:193`                                                               | **KILLED** by both new outer tests                                                                 |
| S2    | **both** gradient ternaries swapped together                                                       | `HTMLRender.ts:145` and `:193`                                                    | **KILLED** — but by the _literals_, not the relation (see S2b)                                     |
| S2b   | S2, with the new block's two literal assertions replaced by a genuine relation (`outer !== inner`) | test-side                                                                         | **all three new outer tests SURVIVED**                                                             |
| S3    | `drawOuterShadow` `shadowTranslate` ternary inverted                                               | `HTMLRender.ts:192` → `BACK ? 0 : shadow.width`                                   | **SURVIVED the entire suite (731/731)**                                                            |
| S4    | `drawOuterShadow` BACK clip mirror dropped                                                         | `HTMLRender.ts:212` → `x: p.x - shadow.pos.x`                                     | **SURVIVED the entire suite (731/731)**                                                            |
| R1    | `UI.swipeDirection` rtl mirror dropped (both branches)                                             | `UI.ts:538-542`                                                                   | **KILLED** — _both_ new tests fail, plus `rtl swipe mapping`                                       |
| R1a   | only the `dx > 0` branch unmirrored                                                                | `UI.ts:539` → `return 'prev';`                                                    | **KILLED** by test 2 only                                                                          |
| R1b   | only the `dx <= 0` branch unmirrored                                                               | `UI.ts:542` → `return 'next';`                                                    | **KILLED** by test 1 only                                                                          |
| R2    | pointer coordinates mirrored under rtl (the AGENTS.md §4 regression)                               | `UI.getMousePos`, `UI.ts:465-468`, return `layoutWidth - px` when rtl             | **KILLED** by both new tests                                                                       |
| T3    | the `EMIT_STATE` seam re-exposed under a **new** public name (`public emitState()`)                | added to `PageFlip.ts` beside `[EMIT_STATE]`                                      | **SURVIVED the entire suite (731/731)**                                                            |
| T4    | `[ADOPT_ORIENTATION]` exists but is a no-op                                                        | `PageFlip.ts:1189-1192` body emptied                                              | **KILLED** (by behaviour tests elsewhere, not by the seam test)                                    |
| U1a   | `Settings` non-stretch branch stops assigning `minWidth = width`                                   | `Settings.ts:307`                                                                 | **KILLED** — by **7** tests, only one of which is the new U10 test                                 |
| U1b   | …stops assigning `minHeight = height`                                                              | `Settings.ts:309`                                                                 | **KILLED** — by 4 tests, one of which is the new U10 test                                          |
| U2    | `applyHostSize` uses `* 2` instead of `* k`                                                        | `UI.ts:165`                                                                       | **KILLED** — by 4 tests, **none** of them the new U10 test                                         |

---

## BLOCKER

### B1. The new hard-BACK `--right` assertion does not test what it says — it is killed by `setFlippingPage`, and survives `setBottomPage` being gutted entirely

`hard-back-draw.test.ts:203-216`, inside `describe('the leaf under a BACK fold')`,
whose premise (`:149-152`) is:

> `setBottomPage` picks the orientation from the fold direction, and that stamp
> drives the `--left` / `--right` classes … and `drawHard`'s transform-origin.

Measured, that is not what the new test observes:

- **H1** — `setBottomPage` stamps _nothing at all_: the new hard-BACK test still
  **passes**.
- **H2** — `setFlippingPage`'s ternary inverted: the new hard-BACK test is the
  **only** test in the suite that fails.

The mechanism, measured with a probe:

```
bottom===flipping: true
bottom===left:  false
bottom===right: false
```

On a hard BACK fold `bottomPage` and `flippingPage` are the **same object**
(`newTemporaryCopy()` returns `this` for a hard page). `Render.showSpread` calls
`setBottomPage` (BACK → `LEFT`) and then `setFlippingPage` (BACK → `RIGHT`) on
that one leaf, so the last writer wins and the element ends `--right`. And
`drawBottomPage` never runs for it at all — `shouldDrawBottomPage`
(`bottomPage.ts:17-21`) returns false precisely when `flippingPage === bottomPage`,
which is this case. So `setBottomPage`'s stamp on a hard BACK fold is **written,
overwritten, and never read**.

The coordinator's guessed alternative cause — `drawRightPage` having run first —
is measured **false**: the leaf is neither the left nor the right static page.

Why this is a BLOCKER rather than a nit: C6's deliverable was the _justification_,
not the value. The value is right, and Codex's reasoning is right — "RIGHT selects
`drawHard`'s right-leaf base, whose origin is the spine" is a statement about
`setFlippingPage`. But the assertion was filed under the `setBottomPage` block,
reads `bottomPage.getElement()`, and its comment says "here the flipping leaf and
the leaf under it are the SAME page, so **the stamp** has to serve `drawHard`" —
leaving which stamp ambiguous exactly where the answer was the point. A reader
who takes the block at face value will believe the hard-BACK _bottom-page_ rule
is now pinned. It is not, and there is no such rule to pin.

Remedy (all three parts measured true):

```ts
test('is stamped RIGHT under a HARD back fold — the answered question', () => {
  const book = hardBackFold(60);
  const r = inner(book);

  // WHY this leaf is --right: it is the flipping page. `setBottomPage` also
  // stamps it (BACK -> LEFT) and is immediately overwritten by
  // `setFlippingPage` (BACK -> RIGHT); `drawBottomPage` then skips it entirely,
  // because `shouldDrawBottomPage` is false when the two are the same leaf.
  expect(r.bottomPage).toBe(r.flippingPage);
  expect(r.flippingPage?.getDrawingDensity()).toBe('hard');

  const el = r.flippingPage!.getElement();
  expect(el.className).toContain('--right');
  expect(el.className).not.toContain('--left');
});
```

and move it out of `describe('the leaf under a BACK fold')` into a block about
the hard flipping leaf, or state in that block that the hard case is the
exception where the two are one leaf.

---

## MAJOR

### M-1. The outer-shadow block's stated rationale is exactly inverted: the relation does **not** kill the both-swap; the literals do — and there is no relation assertion in the file

`shadow-direction.test.ts:147-186`. The commit message and the block comment both
claim:

> Asserted as a relation to the inner, which also kills a mutant that swaps both
> together … matching literals alone would not catch [it].

Measured, the opposite is true, twice over:

1. There is **no relation assertion**. Each test asserts two independent
   literals (`outer` contains `'to right'`, `inner` contains `'to left'`). A
   relation would be `outer !== inner`.
2. **S2b** — I replaced those two literal pairs with the genuine relation
   (`/to (left|right)/` extracted from each, `expect(outer).not.toBe(inner)`)
   and re-ran with **S2** (both ternaries swapped) applied. **All three new
   outer tests passed.** A both-swap keeps the two shadows opposite; it is
   invariant under exactly the assertion the comment credits.

So the block is _stronger_ than its rationale claims, and the rationale is the
part that will be trusted the next time someone touches it. Under this repo's
own rule (a comment that overclaims is worse than none) the comment has to be
corrected: **the literals are load-bearing; do not "simplify" them into a
relation.** That sentence is the one worth writing, because the current text
invites precisely that refactor.

Worth noting for completeness: S2 is also killed by the _pre-existing_ inner
tests (`:110-144`), which pin absolute literals for the same reason.

### M-2. Two mutants inside `drawOuterShadow` survive the whole suite — the block covers one of its four direction-dependent expressions

`drawOuterShadow` (`HTMLRender.ts:185-...`) branches on `getDirection()` in four
places: the gradient token, `shadowTranslate`, the clip-polygon mirror, and the
resulting `transform` / `transform-origin` that consume `shadowTranslate`. The
new block asserts the first only.

- **S3** — `shadowTranslate` inverted (`BACK ? 0 : shadow.width`): **731/731
  green**. The outer shadow's `transform-origin` and `translate3d` are then a
  full `shadow.width` off in _both_ directions.
- **S4** — the BACK clip mirror dropped: **731/731 green**. The outer shadow's
  clip polygon is then computed in unmirrored space on every BACK fold.

Both are the same failure family the block was written for (an outer-shadow
direction branch silently wrong on the flagship BACK flip), and both are
invisible to the golden screenshots for the reason the file's own header gives
(a thin gradient strip is under `maxDiffPixelRatio: 0.05`).

Note that the block's third test — `expect(shadowCss(forward, …)).not.toBe(shadowCss(back, …))`
at `:174-186` — compares the _full_ cssText and still does not catch either:
under S3 the two directions remain different, just both wrong.

The fix is the same shape the block already uses for the gradient: pin
`transform-origin` absolutely per direction, e.g.
`expect(shadowCss(forward, '.stf__outerShadow')).toContain('transform-origin:0px 100px')`
and the BACK counterpart at `shadow.width`.

### M-3. The C3 seam test is a blocklist of four historical names, not an invariant — a seam re-exposed under any new name passes

`flip-event-semantics.test.ts:356-390`. The new existence half is a real
improvement and answers the coordinator's question in one direction: **T4**
(symbol method present but a no-op) is killed, though by behaviour tests
elsewhere rather than by this one — which is fine, reachability is this test's
job.

The gap is the other direction. **T3** — add

```ts
/** the seam, re-exposed under a fresh public name */
public emitState(newState: FlippingState): void {
  this[EMIT_STATE](newState);
}
```

next to `PageFlip[EMIT_STATE]` — **passes 731/731**. The test enumerates
`updatePageIndex`, `updateState`, `updateOrientation`, `adoptCurrentPageIndex`
and checks those four are gone. It cannot see a fifth. Since C3's whole thesis
is that a _public named member_ is the hazard (`@internal` being documentation,
not a fence), a test that only knows the names already removed does not defend
the thesis — it records history.

The invariant is expressible: enumerate
`Object.getOwnPropertyNames(Object.getPrototypeOf(book))` (and the same for
`UI` / `PageCollection`) and assert the set equals an approved allowlist, so any
_newly added_ public method has to be added to the list deliberately. That also
subsumes the four-name blocklist and would have caught T3. It is the same
technique `pointer-transform.test.ts` already uses elsewhere in this suite.

---

## Verified-good

- **The rtl completed-swipe pair earns its place, and the "only one failed"
  observation is correct behaviour, not a defect.** `UI.swipeDirection`
  (`UI.ts:535-543`) has exactly two branches, and the two tests drive exactly
  one each: test 1 swipes `dx = -200`, test 2 `dx = +200`. So **R1a** (only the
  `dx > 0` branch unmirrored) kills test 2 alone and **R1b** kills test 1 alone,
  while the **full** mirror drop (**R1**) kills both — measured. That is the
  right shape: the pair is two independent branch tests, not a redundant pair,
  and a half-regression producing exactly one failure is the pair working.
  Nothing to change; the commit message could say "one branch each" so the next
  reader is not puzzled by the same observation.
- **And the pair defends the flagship RTL invariant.** **R2** — mirroring x in
  `getMousePos` under rtl, the exact regression AGENTS.md §4 names ("the fold
  runs away from the finger") — is killed by both new tests. Before this block
  the rtl suite asserted only which `FlipDirection` was resolved, so this is a
  genuine new capability, not a restatement.
- **`setBottomPage`'s ternary is adequately pinned** by the two soft tests
  (**H4** killed). The over-determination found by H1/H3 only shows up when the
  stamp is _removed_ rather than _inverted_, and removal is not a plausible
  regression. Recorded below as MIN-1 rather than actioned.
- **U10 (`e96b29c`): nothing the deleted branch covered is now untested.** The
  branch was provably inert — `Settings.getSettings` assigns
  `minWidth = width` / `minHeight = height` for the only non-stretch size
  (`Settings.ts:306-311`; the validator at `:174` admits only `stretch` and
  `fixed`), so it rewrote the two lines above it with identical values. The
  coupling it now depends on is killed by **U1a** and **U1b**. No gap.

---

## MINOR

### MIN-1. Three sources stamp `--left` / `--right`, and the `describe` block names only one

Measured: `setBottomPage` / `setFlippingPage` (`Render.ts:1067-1094`),
`setLeftPage` / `setRightPage` (`:1039-1061`), **and** `HTMLRender.update()`
(`HTMLRender.ts:344-353`), which re-stamps both static leaves on every update.
**H1+H3** removes two of the three and the soft-BACK `--left` assertion still
passes. Not a live risk (H4 shows inversions are caught), but the block header's
"that stamp drives the `--left` / `--right` classes" reads as though
`setBottomPage` were the sole author, and it is one of three.

### MIN-2. The U10 test is redundant, and its stated justification is measurably false

`runtime-settings.test.ts:227-259` and `e96b29c`'s message:

> Deleting it makes host sizing depend on that `Settings` assignment, **which
> nothing stated and nothing tested**.

Measured, at least three pre-existing tests already stated and tested it:
`settings.test.ts` _"fixed size pins min/max to width/height"_ pins the
assignment directly, and `pointer-transform.test.ts:603-623` pins the host
consequence — for **both** `k = 1` (`minWidth === '200px'`, `:612`) and `k = 2`
(`'400px'`, `:620`). All three fail under **U1a**.

The new test does discriminate (U1a and U1b kill it), so it is not inert — but it
is a strict subset of `pointer-transform.test.ts:603`, covering only the
landscape half. **U2** (`* k` → `* 2`) is killed by four tests and **not** by the
new one, which is the clean demonstration.

Recommend either deleting it and citing the two existing tests in the U10 commit
note, or extending it to the portrait case so it is at least not a subset. Either
way the "nothing tested" claim should be corrected — an agent who believes it
will not go looking for the guard that already exists.

### MIN-3. The seam test's `DROP_POINTER_GESTURE` negative assertion is the only one of its kind

`flip-event-semantics.test.ts:378` asserts `PageFlip` does **not** carry
`DROP_POINTER_GESTURE`. Good instinct, but it is applied to one symbol out of
six. If the point is "each seam lives on exactly one owner", the cheap version is
a small table of `[symbol, owner]` iterated over all three objects, asserting
present on the owner and absent on the other two.

---

## Summary of recommended changes

1. **B1** — reassert the hard-BACK stamp on `flippingPage`, add
   `expect(bottomPage).toBe(flippingPage)`, and move it out of the
   `setBottomPage` block. (measured)
2. **M-1** — correct the block comment and the commit note: the literals kill
   the both-swap, the relation does not; say "do not replace these with a
   relation". (measured)
3. **M-2** — pin `drawOuterShadow`'s `transform-origin` per direction; S3 and S4
   are live survivors. (measured)
4. **M-3** — replace the four-name blocklist with a public-surface allowlist;
   T3 is a live survivor. (measured)
5. MIN-1 / MIN-2 / MIN-3 as convenient.

**Tree state: clean.** `git status --porcelain` reports only
`docs/reviews/codex-c3-c6-signoff.md` and `docs/reviews/engine-expert-round2.md`
(both untracked, both other agents') plus this file. No source or test file is
left modified; `grep -rn "MUTANT_" packages/` returns nothing.

---

## Addendum — concurrent work in flight

While this review ran, the engine-expert agent again landed **uncommitted**
changes (`internal.ts`, `PageFlip.ts`, `Flip.ts`, `UI.ts`, `PageCollection.ts`,
`flip-event-semantics.test.ts`, `navigation.test.ts`, `rtl-and-spreads.test.ts`,
plus `CHANGELOG.md` / `MIGRATION.md`). Two notes:

1. **M-3 is strengthened, not resolved, by that work.** The seam test's name
   check now runs six names across four objects instead of four names across
   two, and its new comment says: _"The previous version examined two of the
   four, and both seams it missed — `UI.setOrientationStyle` and
   `PageCollection.setCurrentSpreadIndex` — were still public."_ That is the
   blocklist failing in exactly the predicted way, in-flight, one round after it
   was written. **T3 still survives it**: a seam exposed under a name not on the
   list passes regardless of how long the list grows. Growing the list by hand
   after each miss is the pattern an allowlist over
   `Object.getOwnPropertyNames(prototype)` exists to end.

2. **Coordination, reported rather than glossed.** The `/private/tmp` restore
   protocol removed the `git checkout` hazard, but not the underlying race: my
   snapshots were taken at the start of this review, so restoring one still
   overwrites anything written to that file in between. All of the engine
   expert's edits above are present and internally coherent now (the new symbols
   in `internal.ts` are consumed by the matching call sites), so nothing of
   theirs is missing as of this writing — but if they edited `Flip.ts`,
   `PageFlip.ts` or `UI.ts` between my snapshot and a restore, that edit would
   have been lost. They should diff against what they intended before
   committing. For a future round the safe protocol is a git worktree per
   reviewer, not a file snapshot.
