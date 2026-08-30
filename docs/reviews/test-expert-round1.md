# Test adequacy / mutation review — round 1

Scope: the tests introduced or modified by

- `c01cdbe` — C1 fix + initial tests in `rtl-layout.test.ts` (superseded)
- `206e7c9` — C1 replacement tests, `packages/core/tests/gesture-teardown.test.ts`
- `be475d8` — C2 fix + tests in `packages/core/tests/flip-event-semantics.test.ts`

Method: every mutant below was **actually applied to the source, run, and
reverted**. Every SURVIVED / KILLED label is measured, not reasoned. Where a
remedy is proposed it was also measured (proved to kill the surviving mutant and
to pass on the fixed engine). The working tree is clean.

Baseline: `pnpm vitest run --project core` → 46 files / 722 tests passing.

---

## Mutant ledger

| #   | Mutant                                                                                | Edit                                                                                                                                                      | Result                                                                                    | Killed by                                                          |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| M1  | C1 fully reverted                                                                     | delete `this.ui?.[DROP_POINTER_GESTURE]();` — `PageFlip.ts:1308`                                                                                          | **KILLED**                                                                                | 5/10 gesture-teardown tests                                        |
| M2  | Codex's half-fix                                                                      | delete the line at `PageFlip.ts:1308`, add `this.ui?.[DROP_POINTER_GESTURE]();` after `resetUserGesture()` in the settle branch (`PageFlip.ts:872`)       | **KILLED**                                                                                | `replacePages` (both), `clear` (capture)                           |
| M3  | drop the anchor, never the capture                                                    | `UI.ts:497` body → `this.touchPoint = null;` only                                                                                                         | **KILLED**                                                                                | all 5 capture tests                                                |
| M4  | leak the DOM capture, clear the bookkeeping                                           | delete the `try { releasePointerCapture } catch` in `UI.releaseCapturedPointer` (`UI.ts:481-485`)                                                         | **KILLED**                                                                                | all 5 capture tests                                                |
| M5  | release the DOM capture, keep ownership                                               | delete `this.activePointerId = null;` in `releaseCapturedPointer` (`UI.ts:487`)                                                                           | **SURVIVED gesture-teardown** (killed only incidentally by `runtime-settings.test.ts:92`) | —                                                                  |
| M5b | same, written inline in `DROP_POINTER_GESTURE` so it does not touch the shared helper | `UI.ts:497` body → inline `releasePointerCapture` + `pointerCaptured = false`, no id clear                                                                | **SURVIVED the entire core suite (722/722 green)**                                        | —                                                                  |
| M7  | fix at the wrong layer: revert C1, gate the swipe branch on `isUserTouch` instead     | revert `PageFlip.ts:1308`; add `this.app.isUserTouchActive() &&` to the swipe `if` at `UI.ts:720`                                                         | **KILLED**                                                                                | capture tests only                                                 |
| M8  | C2 fully reverted                                                                     | delete `if (isFirstLoad) pages[SEED_OPENING_INDEX](start);` — `PageFlip.ts:611`                                                                           | **KILLED**                                                                                | _one_ test: `flip-event-semantics.test.ts:63`                      |
| M9  | seed the REQUESTED page, not the spread head                                          | `PageCollection.ts:89` → `this.currentPageIndex = pageNum;`                                                                                               | **KILLED**                                                                                | _one_ test: the LANDSCAPE test, `flip-event-semantics.test.ts:108` |
| M10 | seed unconditionally (drop `isFirstLoad`)                                             | `PageFlip.ts:611` → `pages[SEED_OPENING_INDEX](start);`                                                                                                   | **KILLED**                                                                                | the pre-existing RELOAD test, `:381`                               |
| M11 | drop the out-of-range guard in `SEED_OPENING_INDEX`                                   | `PageCollection.ts:88` → `?? 0` instead of `if (… === null) return;`                                                                                      | **KILLED**                                                                                | 8 pre-existing tests (empty-book / React-shaped paths)             |
| M12 | defer the spurious emit into the init timer, **before** `init`                        | keep the seed; add `this.dispatch('flip', …)` immediately after `ui.update()` in the init timer (`PageFlip.ts:617`) gated on `isFirstLoad && start !== 0` | **SURVIVED the entire core suite (722/722 green)**                                        | —                                                                  |

---

## BLOCKER

### B1. The C1 capture test does not assert the harm the fix exists to prevent — M5b survives the whole suite

`gesture-teardown.test.ts:195-213` asserts exactly one thing: `b.captured.has(1) === false`,
i.e. that `releasePointerCapture` reached the DOM. It never asserts that the
engine **relinquished ownership** of the pointer.

That is not the stated defect. `c01cdbe`'s own commit message says:

> Leaving `activePointerId` set makes `isActivePointer` reject every other
> pointer, so the book goes dead to the next finger for the rest of its life.

**M5b** implements exactly that: `DROP_POINTER_GESTURE` releases the DOM capture
and clears `pointerCaptured`, but leaves `activePointerId` set. All 722 core
tests pass. The book is then permanently dead — `onPointerDown` (`UI.ts:627`)
early-returns on `this.activePointerId !== null`, so **no** subsequent pointer,
not even the same id, can start a gesture.

Measured remedy (verified: fails under M5b, passes on the fixed engine) — after
`run(b)`, drive a _fresh_ gesture with a different pointer id and assert the
engine responds:

```ts
run(b);
expect(b.captured.has(1)).toBe(false);

// The next finger must still be able to fold a page.
b.book.turnToPage(2); // pre-state, so a fold is legal
pointer(b, 'pointerdown', startX, 2);
pointer(b, 'pointermove', startX - 100, 2);
expect(b.book.getState()).not.toBe('read');
```

(Note the `turnToPage(2)` matters: at index 0 with `direction: 'rtl'` a leftward
drag is a `prev` at the boundary and legitimately folds nothing, so the naive
version of this probe fails on the _fixed_ engine too. Measured.)

Ranked BLOCKER rather than MAJOR because this is a fix whose primary named
consequence is untested, in a file written specifically to close that gap, in a
repo whose standard is "a test that passes for a reason other than the fix is
worse than no test".

---

## MAJOR

### M-1. The `clear` swipe test passes for a reason unrelated to the fix — and the file claims the opposite

`gesture-teardown.test.ts:170-193`, `clear` case. Under **M1** (C1 fully
reverted) this test still passes. Measured why, with a `turnRejected` listener on
the unfixed engine:

```
REJECTED {"reason":"boundary"}
after: idx 0 count 0
```

The gesture is _not_ dropped: `onPointerUp` runs the swipe branch and calls
`flipNext`, which is refused only because `clear()` left the book with zero
pages. `expect(flips).toEqual([])` is satisfied by the emptiness of the book, not
by the fix.

This directly contradicts the file's own measurement note at
`gesture-teardown.test.ts:152-166`:

> only `clear` and `replacePages` actually DEPEND on the C1 fix … Codex's mutant
> … is killed here by `clear`, not by all eight tests.

The measured dependency table (from M1, full revert) is:

| caller           | swipe test     | capture test   |
| ---------------- | -------------- | -------------- |
| `updateSettings` | **depends**    | **depends**    |
| `updateFromHtml` | passes unfixed | passes unfixed |
| `loadFromHTML`   | passes unfixed | passes unfixed |
| `replacePages`   | **depends**    | **depends**    |
| `clear`          | passes unfixed | **depends**    |

So the note is wrong in two directions: it omits `updateSettings`, which depends
on the fix in **both** halves, and it credits `clear`'s swipe half, which depends
on nothing. And M2 (Codex's mutant) is killed by `replacePages` as well as
`clear`, not by `clear` alone.

This repo grades an overclaiming comment as worse than no comment (AGENTS.md §3,
"a guess recorded as a finding"). The note is presented as _measured_, which
makes it more dangerous than an unmeasured one.

Measured remedy for the test itself: also watch `turnRejected`. On the fixed
engine `clear` + release emits **nothing at all**; on the unfixed engine it emits
`turnRejected {reason:'boundary'}`. Adding

```ts
const rejects: unknown[] = [];
b.book.on('turnRejected', (e) => rejects.push(e.data));
…
expect(rejects).toEqual([]);
```

makes the `clear` swipe case discriminate. Worth doing for all five callers —
"no turn was even attempted" is the behaviour, "no turn landed" is a proxy.

And correct the note to the table above.

### M-2. The C2 test's "and none before init" ordering claim is vacuous — M12 survives

`flip-event-semantics.test.ts:63-106`. The test's title and its comment
(`:70-74`) make an ordering claim:

> The ordering half matters independently: `init` is dispatched from a
> `setTimeout`, so any synchronous emit necessarily precedes it.

But the assertions are `expect(flips).toEqual([])` and `expect(order).toEqual([])`,
taken **synchronously**. The timer is never advanced and the test never awaits,
so `'init'` can never be pushed into `order` at all. The test proves "nothing
fired synchronously"; it cannot see anything about ordering.

**M12** — keep the seed, but dispatch a spurious `flip` from inside the init
timer immediately _before_ `init` — passes all 722 core tests. That is precisely
the desync the comment describes (a consumer's `init` handler running after the
`flip` it is supposed to baseline), reintroduced, undetected.

Measured remedy (fails under M12, fails under M8, passes on the fixed engine):

```ts
book.loadFromHTML(pages);
expect(order).toEqual([]); // keep: nothing synchronous
await new Promise((r) => setTimeout(r, 10));
expect(order).toEqual(['init']); // new: init fires, alone
expect(book.getCurrentPageIndex()).toBe(4);
```

This strictly dominates the current assertion — it still kills M8.

### M-3. Not covered: the React binding still fabricates the very mount `flip` C2 removes

Measured, with a throwaway React test:

```
<HTMLFlipBook width={200} height={300} flippingTime={0} startPage={1} usePortrait onPageChange={…}>
MOUNT onPageChange calls: [[1]]
```

C2 closes the core path, but the React binding never uses it: per CLAUDE.md the
mount effect calls `loadFromHTML([])` and pages arrive via `updateFromHtml`, so
`startPage` is applied by the binding itself with `engine.turnToPage(start)`
(`HTMLFlipBook.tsx:572-586`) — which announces, correctly, by ADR 0003. Net
effect: an **uncontrolled** `<HTMLFlipBook startPage={1}>` fires `onPageChange(1)`
on mount, for a book nobody has touched. That is the consumer-visible symptom
the C2 commit message names ("a controlled React binding acts on that `flip` and
navigates itself"), still live one layer up.

No test in either package asserts anything about `onFlip` / `onPageChange`
during mount. Whether the binding _should_ suppress it is a design question, not
mine to settle — but it should not be closed as "C2 fixed the mount flip" while
the only shipped consumer still emits one.

Also uncovered and measured (via the untracked scratch file, see MIN-4):
`clear()` then `loadFromHTML` with `startPage: 4` emits `flip:4`. Defensible
under the "a reload that moves the page announces" rule, but it is the nearest
neighbour to the fixed case and nothing pins the intended answer.

### M-4. `gesture-teardown.test.ts` has no positive control

Every one of its ten tests asserts an _absence_. A mutant that made
`DROP_POINTER_GESTURE` run on every `pointermove` — killing swipes globally —
leaves this file entirely green. The file is saved only by an unrelated test
(`runtime-settings.test.ts:92`, `swipeDistance is read live`), which is
load-bearing coverage nothing in this file declares a dependency on.

This is the same structural point `flip-event-semantics.test.ts:14-17` makes for
itself ("every suppression test here is paired with a test that a real turn still
announces exactly once") and does not apply to its sibling.

A positive control in this exact fixture is measured and green:

```ts
test('control: with NO teardown the same release DOES commit', () => {
  const b = makeBook();
  b.book.turnToPage(2);
  const flips: number[] = [];
  b.book.on('flip', (e) => flips.push(e.data as number));
  pointer(b, 'pointerdown', startX);
  pointer(b, 'pointermove', startX - 40);
  pointer(b, 'pointerup', startX - 200);
  expect(flips.length).toBeGreaterThan(0);
});
```

Had this existed, the `clear` false-pass (M-1) would have been obvious: the
control and the `clear` case would have been the same assertion with opposite
expectations and the same cause.

---

## Verified-good (do not "improve" these)

These earned their place and the measurements back the claims made about them:

- **The stateful pointer-capture shims** (`gesture-teardown.test.ts:74-85`) are
  faithful enough to matter. Because they provide `hasPointerCapture`, the
  engine's real branch at `UI.ts:646-649` takes the _query_ path rather than the
  jsdom "the call did not throw, assume captured" fallback, so `pointerCaptured`
  is genuinely `true` during the gesture and M7's `pointerleave`-adjacent
  behaviour is exercised. M3 and M4 are both killed by them and were not killed
  by the old no-op shims. BLOCKER 2 from Codex is genuinely closed — with the
  ownership gap at B1 as the remaining seam.
- **The parameterization is not decoration.** M2 (Codex's BLOCKER 1) is killed by
  `replacePages` and `clear`, neither of which existed in the superseded
  `rtl-layout.test.ts` version. Keeping the four non-depending cases is a
  defensible call and the file argues it correctly at `:160-166`.
- **The LANDSCAPE C2 test is honest and it earns its place.** Its comment
  (`:109-113`) says the unfixed engine passes it. Measured: true (M8 kills only
  the portrait sibling). And it is the **sole** killer of M9, the single most
  plausible wrong fix — seeding the requested page instead of the spread head.
  A test that kills one specific mutant and nothing else, and says so, is the
  correct shape. Keep it.
- **Both C2 negative controls hold.** M10 (seed every load, not just the first)
  is killed by the RELOAD test; M11 (drop the range guard) is killed loudly by
  the empty-book paths, which confirms the `if (spreadIndex === null) return;`
  at `PageCollection.ts:88` is load-bearing for `loadFromHTML([])` — the call
  the React binding makes on every mount.

---

## MINOR

### MIN-1. `flip-event-semantics.test.ts:285-302` pins a name, not a behaviour

`expect(typeof api['updatePageIndex']).toBe('undefined')` passes if the method is
renamed and left public. The behaviour ("a consumer cannot fabricate a flip") is
only proxied. Cheap strengthening: assert that the reachable public surface
cannot move the announced index — e.g. iterate `Object.getOwnPropertyNames` of
the prototype and assert no enumerable member accepts an index and dispatches.
Low value; noting it because the test's title claims the stronger property.

### MIN-2. T1: the C2 reproduction gets portrait by accident

`flip-event-semantics.test.ts:83-88` constructs the book with no `usePortrait`
and no host sizing, so jsdom's 0×0 layout is what makes it portrait (the default
`usePortrait` is `true`, `Settings.ts:151`). The test _relies_ on portrait —
head === request is why `startPage: 4` reproduces — but never says so in code.
The landscape sibling correctly states its `usePortrait: false` as load-bearing
(`:122-127`); this one should state its portrait-ness the same way. It would
still pass in landscape (spread `[4,5]`, head 4), so this is documentation, not
a live fragility.

### MIN-3. C1 is only ever exercised with `pointerType: 'mouse'`

`gesture-teardown.test.ts:94-108` hard-codes `pointerType: 'mouse'`. The defect
is described throughout as a _swipe_ — a touch gesture — and `mobileScrollSupport`
(default `true`, `Settings.ts:156`) routes touch pointers down a different
`onPointerMove` branch (`UI.ts:686-698`). The `onPointerUp` swipe branch itself
is shared, so nothing is currently mis-covered, but the parameterization axis
that would most cheaply catch a future divergence is the pointer type, not a
sixth caller.

### MIN-4. An untracked, assertion-free scratch test is sitting in `packages/core/tests/`

`packages/core/tests/zz-scratch.test.ts` (untracked, mtime 14:18, i.e. from the
implementing agent's session — **not mine, and left in place per AGENTS.md §1**).
It contains three `test()` blocks that assert nothing and `console.log` their
findings. It runs as part of `pnpm test` and inflates the core count by 3.

Per AGENTS.md §2 this is the golden-e2e liability shape ("wrote screenshots and
asserted nothing"). Its probes are genuinely useful — they are the source of the
`clear()`-then-reload observation in M-3 — so the right move is to convert the
useful ones into real assertions and delete the file, not to keep it. Flagging
rather than acting: it is not my work to discard.

---

## Summary of recommended changes

1. **B1** — add a fresh-pointer assertion to the C1 capture tests. (verified)
2. **M-1** — add `turnRejected` to the C1 swipe tests, and correct the
   measurement note at `gesture-teardown.test.ts:152-166` to the table above.
   (verified)
3. **M-2** — await the init timer in the C2 test and assert `order === ['init']`.
   (verified)
4. **M-4** — add a positive control to `gesture-teardown.test.ts`. (verified)
5. **M-3** — decide, and then test, what an uncontrolled React mount with
   `startPage` should emit.
6. MIN-2, MIN-3, MIN-4 as convenient.
