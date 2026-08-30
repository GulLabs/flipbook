# React binding & public API — round 2 (signoff pass)

Commit audited: **3014f00** (over `c4ecdb1`, `90aa7a9`). Baseline: `7500ffe`.
Scope: `packages/*/src` only; test code ignored by instruction. Audited in an
isolated worktree at `3014f00`, removed afterwards.

| check                                              | result                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm build`                                       | **pass**                                                                     |
| `tsc --noEmit -p packages/core/tsconfig.src.json`  | **pass**                                                                     |
| `tsc --noEmit -p packages/react/tsconfig.src.json` | **pass** (core-first ordering now documented in the tsconfig — MIN-7 closed) |

## Verdict: **BLOCK** — one blocker.

R-1 is **fixed for mount but not for the flip path**. Everything else on the
round-1 list is genuinely fixed, and the four new capabilities are good. This is a
narrow, well-understood re-open, not a re-litigation.

---

## BLOCKER

### R-1b — `readNodes()` still throws, now on the first turn of any book whose parent re-renders

`HTMLFlipBook.tsx:814-822` (inert effect), and the same shape at `:733-745` (load
effect). The guard added for R-1 is:

```ts
if (pageCount <= 0 || pages.length === 0 || pages.length !== childCount.current) return;
const nodes = readNodes();
```

`pages.length === childCount.current` is not proof that the ref-filling commit has
happened, because **`childCount.current` is advanced in the children effect of the
same commit while `pages` is still the previous list**. When the child _count_ is
unchanged — which is the normal case — the two are trivially equal, and the guard
lets a stale-length comparison stand in for a freshness check.

`children` is a fresh array identity on every parent render, so the children effect
re-runs (`:549`, deps `[children, lazyAnchors, lazyRadius]`), publishes a **new,
empty** `slotsRef.current`, and calls `setPages`. If anything else the inert effect
depends on — `visiblePages`, `pageCount` — changed in that same commit, the inert
effect re-runs _before_ the refs for the new list have fired, passes the guard, and
throws.

That coincidence is not exotic; it is the ordinary controlled/observed book:

```jsx
function Consumer() {
  const [p, setP] = useState(0);
  return (
    <HTMLFlipBook … onPageChange={(s) => setP(s.page)}>
      {items.map((i) => <div key={i}>page {i}</div>)}
    </HTMLFlipBook>
  );
}
```

A turn fires `flip` → the binding's `setEnginePage` (changing `visiblePages`) **and**
the consumer's `setP` (changing `children` identity) land in one auto-batched React
18 render. Confirmed with a jsdom probe in the worktree (removed afterwards; not
added to the suite):

```
P5: THREW(    at HTMLFlipBook.tsx:822:21)
```

— line 822 is the inert effect's `readNodes()`. The control probe with the same
component and `onPageChange` omitted walks the whole book cleanly:

```
P4: t0:prev=null,next=null  t1:prev=null,next=true  t2:prev=null,next=true …
```

So the trigger is precisely "parent re-rendered in the same commit as a spread
change". The load effect is currently safe only because none of its deps
(`pages`, `pageHost`, `bindHandlers`, `remountKey`, `readNodes`) can change in that
commit — but `remountKey` can (`hardCovers` / `initialPage` changed alongside a
parent re-render), so it is the same latent defect with a narrower trigger.

**Suggested repair.** Stop inferring freshness from a length. Make the slot array
and the rendered list carry a matching stamp, so the check is an identity check
rather than a coincidence:

```ts
const slotsGen = useRef(0);
// children effect:
const gen = ++slotsGen.current;
slotsRef.current = { gen, slots };
setPages({ gen, list: next });
// consumers:
if (pages.gen !== slotsRef.current.gen) return;
```

`readNodes()` itself should stay exactly as it is — the probe confirms it still
throws correctly for a genuine defect (see below), and that contract is worth
keeping.

---

## Round-1 findings: verified fixed

Each was re-checked in the built worktree, not just read.

- **R-1 (mount)** — ✅ `<HTMLFlipBook width={100} height={150}>{six divs}</HTMLFlipBook>`
  now mounts cleanly; the round-1 probe that threw is silent. The guard at `:743-745`
  is correct _for mount_, where `pages` is `[]` and `childCount` is N, so the
  lengths genuinely differ. And the throw is untouched and still fires for a real
  defect: a component child that does not forward its ref still produces
  `HTMLFlipBook: 1 page element(s) never reached the engine (child index 1)`.
  Only the batched-commit path (R-1b) survives.

- **R-2** — ✅ Genuinely fixed, and fixed in the right place. `PageFlip.ts:606`
  defers when `snapshot.pageCount === 0`; `:819-825` announces from
  `updateFromHtml`'s `openingFresh` branch. A React book now emits exactly
  `ready:0/6`, `loaded:0/6`, `pagesChanged:0/6` — one of each, with a **real**
  page count. A vanilla `loadFromHTML(pages)` with content still announces
  synchronously, since the guard only trips on an empty load. The added
  `announceLoad` generation check (`:613-624`) is a genuine improvement I had not
  asked for: it closes a reload-from-`ready` reordering hole that the deleted
  `dispatchCollectionChange` had been carrying.

- **R-3** — ✅ in the component. `atEnd` (`:439`) reads the last element of
  `visiblePages`, which comes from `spreadPages` and therefore knows `hardCovers`.
  Probe on a landscape six-leaf book: `next` is enabled on spreads `[0,1]` and
  `[2,3]` and `aria-disabled` on `[4,5]` — the exact case that was broken. Traced
  by hand for portrait, landscape-no-covers, landscape-with-covers, and a trailing
  odd leaf; all correct. `atStart` is correct everywhere. (One narrow hole remains
  in `usePageFlip` — MIN-A below.)

- **R-4** — ✅ Both `INVALID_PAGE` and `PAGE_NOT_IN_SPREAD` now map to
  `'invalidPage'` at both sites (`:490-494`, `:941-945`). `'setup'` is left to
  `FLIP_SETUP` and friends, which is right.

- **R-5** — ✅ `runRelative` (`:503-519`) gives all four handle methods the same
  contract; `flipNext`/`flipPrev` emit `{ reason: 'notReady', code: 'NOT_LOADED' }`
  with the direction filled in, which is strictly better than `runHandle`'s
  `direction: null`. The engine's own `requestTurn` still covers the mounted case,
  so there is no double-report.

- **R-6** — ✅ Verified in the DOM, not just in the source. Probe on a fresh book:
  `prev(disabledAttr=false, aria=true)`, `next(disabledAttr=false, aria=null)`.
  No `disabled` attribute is ever written, so the browser never blurs a focused
  control, and `aria-disabled="true"` announces the state. The `onClick` guards
  (`:1114`, `:1127`) short-circuit before `runRelative`, so a click at a boundary is
  a genuine no-op rather than a rejected turn — which also means it does not spam
  `onTurnRejected`. This is the APG shape and it is right.

- **R-7** — ✅ and the design judgement is sound. `'auto' | 'visible' | 'none'`
  with `'auto'` default is the correct call: it keeps the controls in the
  accessibility tree and the tab order (which is the entire point of H4) while
  adding zero layout height to every existing book, so nobody is pushed toward
  `'none'` and back into the hole. The reveal works as written —
  `[data-flipbook-controls]:focus-within{…!important}` is an important author
  declaration, which outranks the normal-priority inline `VISUALLY_HIDDEN_UNTIL_FOCUS`
  in the cascade. Confirmed in the DOM that the controls are a direct child of the
  root, outside `.stf__block`, with reading order `.stf__wrapper` → `<style>` →
  controls → live region. One deployment caveat as MIN-C below.

- **MIN-1** — ✅ The controlled-`page` reasoning is removed and replaced with an
  accurate statement of the shape (`usePageFlip.ts:32-34`).
- **MIN-2** — ✅ `initialPage` is now in `bookProps` and reaches the engine.
- **MIN-3** — ✅ `apply(snapshot, false)` from `onLoaded`; `lastRejection` now
  survives a load, matching its docs.
- **MIN-4** — ✅ `pickSettings(props, true)` sends absent keys as explicit
  `undefined`, and `Settings.resolve`'s `definedOnly` (`Settings.ts:210,275`) drops
  them against the defaults. `drawShadow={cond ? false : undefined}` no longer
  latches.
- **MIN-5** — ✅ `sizing` out of `remountKeyOf`; it is in `LiveSetting` and
  `updateSettings` recalculates layout for it.
- **MIN-6** — ✅ The call site destructures and annotates `Partial<LiveSetting>`,
  so excess-property checking actually applies where it matters.
- **MIN-7** — ✅ Documented in `packages/react/tsconfig.src.json`; core-first
  ordering verified clean.
- **MIN-8** — ✅ `className` now carries `stf__parent` (probe: `rootClass=stf__parent`),
  so a runtime `className` change cannot strip the positioning context. Side effect
  worth knowing: `UI`'s `hostHadParentClass` is now always true for React hosts, so
  the engine never removes the class on destroy — correct, since React owns it.
- **MIN-10** — ✅ `Flip.flipToPage` and `PageFlip.flip` return `boolean`; the
  controlled effect reports `reason: 'superseded'` with a correct `landedOn`
  (`:904-914`). The `next === current` early return correctly reports `true`
  (satisfied postcondition), not a refusal.
- **MIN-11** — ✅ `controlledPage` removed from the load effect's deps.

**MIN-9 — I agree with you, with one caveat.** A component that swallows its ref
cannot be detected before it renders, so a lazy book genuinely cannot know at mount.
The one thing that _would_ be cheap: `wrapChildren` already inspects
`isValidElement(child)` and `typeof keyed.type === 'string'` for the placeholder
fallback (`:297`). A non-string `type` on a page child is exactly the population at
risk, so a one-time `console.warn` naming those indices at mount would give the
signal without a throw. Optional, and not a blocker.

---

## New capabilities — judged as product

- **`TurnRejected.landedOn`** — ✅ Right to restore, and right to make it
  **required** rather than optional: every dispatch site had to be updated, and the
  compiler proved they were. "We clamped you to 40 of 40" is genuinely underivable
  from `targetPage`. Populated consistently as
  `pages === null ? null : resolvedPageIndex(pages)`. One documentation nit: like
  `BookSnapshot.page` it is the spread **head**, while `targetPage` is a leaf index
  — the docblock at `EventObject.ts:44-51` should say so, since the two fields sit
  side by side and invite direct comparison.

- **`usePageFlip.goToPage(n, transition?)`** — ✅ The right replacement for
  `setPage`. An action that turns the book and lets the resulting event update state
  cannot desync, which is exactly what the old setter could not promise. Default
  `'animate'` matches `pageTransition`. Good.

- **`maxHeight` implemented** — ✅ Correct, and I specifically checked the
  collapse hazard: the raw default is `0` (`Settings.ts:250`), and
  `Math.min(0, blockHeight)` would flatten the book. It cannot happen —
  `Settings.ts:426` raises `maxHeight` to `max(2000, minHeight)` whenever it is
  below `minHeight` in responsive mode, and the non-responsive branch sets it to
  `height`. The cap is applied before the block-height fit so the tighter of the two
  wins with the ratio preserved (`Render.ts:776-790`). Implementing rather than
  deleting was the right call given it was advertised.

- **`PageFlip.flip` → `boolean`** — ✅ Source-compatible (`void` → `boolean`),
  and it closes MIN-10 at the layer that knows the answer rather than by inference
  in the binding.

---

## MINOR

- **MIN-A — `usePageFlip.canGoNext` is wrong for a two-leaf hard-cover landscape
  book.** `usePageFlip.ts:74-75` pairs from the head without knowing `hardCovers`:

  ```ts
  const lastVisible = pairs && state.page + 1 <= state.pageCount - 1 ? state.page + 1 : state.page;
  ```

  `PageCollection.createSpread` (`:145-155`) emits `[0]` then `[1]` for
  `hardCovers` with two leaves, so from the cover there _is_ a next spread — but
  the hook computes `lastVisible = 1`, then `1 < 1` is false and `canGoNext` is
  `false`. The book cannot be advanced through the hook's own state. The error is
  one-directional (it only ever over-estimates the last visible leaf, so only false
  negatives) and `pageCount === 2` is the only case where the over-estimate reaches
  the end, so this is genuinely narrow. The root cause is that the hook has
  `orientation` but not `hardCovers`; carrying spread membership on `BookSnapshot`,
  or exposing `hardCovers` in the snapshot, would remove the whole class. The
  component gets this right because `spreadPages` knows.

- **MIN-B — `replacePages` never announces a deferred load.** Only
  `updateFromHtml` carries the `openingFresh` announcement (`PageFlip.ts:819`). A
  vanilla consumer who builds a shell with `loadFromHTML([])` and then supplies
  content via `replacePages` gets `pagesChanged` but never `ready` or `loaded`.
  Narrow (React does not take that path, and `replacePages` is the advanced API),
  but the deferral is now a documented behaviour of empty loads and this is the one
  route out of it that was not wired up.

- **MIN-C — the H4 reveal CSS is not in the shipped stylesheet, so a strict-CSP
  consumer loses it.** Both rules live in a React-rendered inline `<style>`
  (`:1063-1071`); `packages/core/src/styles.ts` and `@gullabs/flipbook-core/style.css`
  contain neither (`grep` count: 0). Under a `style-src` policy without
  `'unsafe-inline'` the element is blocked, and the `controls="auto"` buttons stay
  1×1 clipped forever — still focusable and still announced, so the accessibility
  contract holds, but a sighted keyboard user never sees what they have focused.
  The same `<style>` is also now rendered unconditionally and duplicated once per
  book instance. Both go away by moving the two rules into `ensureFlipbookStyles()`,
  which already has an injection story and a `style.css` counterpart.

- **MIN-D — `className=""` yields a leading space.** `:1034` produces
  `" stf__parent"` for an empty-string `className`, because the guard tests
  `=== undefined`. Cosmetic only.

---

## Checked and found correct (no change requested)

- The `announceLoad` generation guard (`PageFlip.ts:613-624`) correctly handles a
  listener that reloads or destroys from inside `ready`, including the re-check
  between `ready` and `loaded`. The comment explaining why `isDestroyed()` is called
  through a method rather than the field — to keep TypeScript from narrowing away a
  real re-entrancy check — is right, and better than a lint suppression.
- `pointerInput` compared as a set rather than elementwise (`:877-882`): a reordered
  list no longer abandons the reader's in-flight gesture.
- `wasEmpty` captured before `previous.destroy()` (`:742-746`): the old
  `previous.getPageCount() === 0` read after the in-place empty would have reported
  `0` for every replacement and re-seeded to `initialPage`. Real fix, correctly
  ordered.
- `flipOnClick: 'never'` is now actually enforced (`:1125-1133`) — previously
  declared and unreachable.
- `EMIT_PAGE_INDEX` no longer dispatches through `renderOrThrow` (`:1268`);
  a throwing emit path is worth removing even where it is currently unreachable.
- Effect ordering is unchanged and still correct: handlers sync (`:594`) runs before
  mount (`:660`), so events dispatched during `loadFromHTML([])` reach current
  handlers.
- `firstControlledApply`, the controlled effect's spread-membership guard, the
  keyboard handler's modified-key and focus-ownership rules, and the
  `ENGINE_SETTING_KEYS` / settings-dependency correspondence (now 22 keys, with
  `maxHeight` added on both sides) are all unchanged from round 1 and still correct.

---

Fix R-1b and this is an approve. Nothing else on this list is blocking.
