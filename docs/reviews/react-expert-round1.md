# React binding & public API — round 1

Commit audited: **7500ffe** ("feat(core,react)!: the design tranche — Tier 1-3, H4, C7").
Scope: `packages/react/src` + the public API surface. Test code deliberately ignored
(suite is red by instruction). Audited in an isolated worktree at `7500ffe`.

Compilation, in the worktree:

| check                                              | result                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| `tsc --noEmit -p packages/core/tsconfig.src.json`  | **pass**                                       |
| `tsc --noEmit -p packages/react/tsconfig.src.json` | **pass** (only after `pnpm build` — see MIN-7) |
| `pnpm build`                                       | **pass**                                       |

Verdict: **BLOCK**. R-1 makes the component non-functional for every consumer.

---

## BLOCKER

### R-1 — `readNodes()` throws `DETACHED_PAGE` on the first mount of every book

`packages/react/src/HTMLFlipBook.tsx:319-340` (`readNodes`), `:475-484` (children
effect), `:628-634` (load effect), `:697-701` (inert effect).

The children effect allocates a **fresh, empty** `slots` array on every run and
publishes it immediately, while simultaneously setting `childCount` to the full
child count:

```ts
const slots: Array<HTMLElement | null> = [];
const collect = (index: number) => (el) => {
  slots[index] = el;
};
const next = wrapChildren(children, lazyAnchors, lazyRadius, collect);

slotsRef.current = slots; // EMPTY — nothing has been rendered with these refs yet
childCount.current = next.length; // N
setPages(next); // the render that will fill `slots` is only scheduled here
```

The refs that write into `slots` belong to elements that have not been committed
yet. So between this effect and the _next_ commit, `slotsRef.current` is empty
while `childCount.current` is `N` — and `readNodes()` treats exactly that state as
proof of a detached page.

Two effects in the **same passive-effect flush** call `readNodes()` before any
guard:

```ts
// load effect, :629-634
const nodes = readNodes(); // <- unguarded, runs first
if (!engine || !pageHost || pages.length === 0 || nodes.length === 0) return;

// inert effect, :698-701
const nodes = readNodes(); // <- same
if (nodes.length === 0 || pageCount <= 0) return;
```

Effect order in the component is children(456) → handlers(501) → mount(567) →
settings(599) → **load(628)** → inert(697) → controlled(744), so on commit #1 the
load effect runs with `childCount = N` and zero slots.

Confirmed empirically (ad-hoc probe in the worktree, jsdom, plain host children —
not part of the suite):

```
HTMLFlipBook: 2 page element(s) never reached the engine (child index 0, 1).
A page child must render a host element and forward its ref. …
```

`<HTMLFlipBook width={100} height={150}><div>a</div><div>b</div></HTMLFlipBook>`
throws during `render()`. This is not an edge case — it is the documented happy
path.

This is a regression introduced by D1. The previous implementation
(`7500ffe^:packages/react/src/HTMLFlipBook.tsx:374-378`) kept `childNodes.current`
**across commits** and only cleared it conditionally, so the load effect always read
the previous commit's nodes. Replacing that with a per-run array removed the one
property the load effect depended on.

The same swap also breaks the StrictMode claim at `:472-474`. Index-keyed writes
_are_ idempotent **within one array**, but StrictMode's simulated remount detaches
refs (writing `null`), re-runs the children effect (allocating array #2 and
publishing it), and then re-attaches the refs of the _currently rendered_ elements
— which close over array #1. `slotsRef.current` stays empty until `setPages`
commits. The defect is the array swap, not the double-invoke.

**The fix is not to soften `readNodes()`.** The throw is a good contract. What is
wrong is _when_ it is consulted: the slot array must not be replaced until the
render that fills it has committed, or `readNodes()` must be reachable only from
code that runs after that commit. A minimal repair is to keep writing into a
persistent array (clearing per index), and to move `childCount` forward only in the
commit where the new refs have actually fired — i.e. derive both from the same
`pages` state that the load effect already depends on, not from the pre-commit
`next`.

---

## MAJOR

### R-2 — `onReady` and `onLoaded` always report `pageCount: 0` in React

`HTMLFlipBook.tsx:579` (`engine.loadFromHTML([])`), `:541-546`;
`packages/core/src/PageFlip.ts:582,585` vs `:766`; `types.ts:63-66`.

`ready` and `loaded` are dispatched from `attachMode`, i.e. from `loadFromHTML`.
The binding calls `loadFromHTML([])` — deliberately, to build the portal target —
and then hands the real pages over via `updateFromHtml`, which dispatches only
`pagesChanged`. There is no second `loadFromHTML`.

Consequence: for **every** React consumer, `onReady` and `onLoaded` fire exactly
once, with `{ page: 0, pageCount: 0 }`.

D17's stated justification for splitting `init` is that `init` "carried no
`pageCount`, so it could not render 'page 1 of N'", and that its timer made it "a
RACE in the React binding — which loads an empty book and adds pages in a later
effect". The split fixes the timer, but the payload problem is unchanged in React:
both replacements describe the empty shell. `types.ts:63-66` documents them as
"Once per engine" / "Every load, including the first" without saying that in this
binding "every load" means "the empty one".

Either the binding must re-dispatch (or defer) `ready`/`loaded` around the first
`updateFromHtml`, or the prop docs must say plainly that React consumers should use
`onPagesChanged` for counts. Shipping a `BookSnapshot` that is structurally
guaranteed to be empty is the "payload was wrong" failure D17 was written to
remove.

### R-3 — The `next` control is enabled on the last landscape spread (and `usePageFlip.canGoNext` with it)

`HTMLFlipBook.tsx:953` and `packages/react/src/usePageFlip.ts:55-61`.

```ts
disabled={pageCount <= 0 || enginePage >= pageCount - 1}     // :953
canGoNext: state.pageCount > 0 && state.page < state.pageCount - 1,  // usePageFlip:59
```

`enginePage` / `state.page` is the **spread head**, and both files say so
(`HTMLFlipBook.tsx:367-368`, `usePageFlip.ts:36`). CLAUDE.md states the invariant
outright: _"Turns are bounded by spreads, not page indices. `getCurrentPageIndex()`
is `spread[0]`, so in landscape it is below `pageCount - 1` even on the last
spread."_

- Landscape, no covers, 10 leaves → spreads `[0,1] … [8,9]`; last head is `8`,
  `pageCount - 1` is `9` → **next stays enabled** on the final spread.
- Landscape, `hardCovers`, 7 leaves → `[0] [1,2] [3,4] [5,6]`; last head is `5`,
  `pageCount - 1` is `6` → **next stays enabled**.
- Portrait is correct; `prev` (`head <= 0`) is correct in all three.

For H4 this is the failure that matters most: the browse-mode screen-reader user —
the only user who _has_ no other way to turn a page — is told "Next page, button"
at the end of the book and gets a silent `turnRejected` instead of a turn.

The component already computes the right answer: `visiblePages` (`:371-374`) via
`spreadPages`. Use its last element. `usePageFlip` has `orientation` in state but
not `hardCovers`, so it cannot derive it — the honest options are to carry the
spread membership in the snapshot or to derive `canGoNext` from the engine.

### R-4 — `TurnRejected.reason` mapping is inverted for `INVALID_PAGE`

`HTMLFlipBook.tsx:424` and the identical line at `:806`:

```ts
reason: error.code === 'PAGE_NOT_IN_SPREAD' ? 'invalidPage' : 'setup',
```

`turnToPage` throws `INVALID_PAGE` for an out-of-range page
(`packages/core/src/PageFlip.ts:1002-1004`) and `PAGE_NOT_IN_SPREAD` only for an
in-range page that no spread contains (`:1005-1007`). The mapping sends the
genuinely invalid page to `reason: 'setup'` and reserves `'invalidPage'` for the
subtler case.

So `handle.turnToPage(999)` reports `{ reason: 'setup', code: 'INVALID_PAGE' }` —
`reason` says the engine failed to set up a turn, while `code` says the page was
invalid. A consumer switching on `reason` (which the payload is designed for, per
D16) mislabels the single most common navigation mistake. Both codes should map to
`'invalidPage'`; `'setup'` belongs to `FLIP_SETUP` and friends.

### R-5 — `handle.flipNext` / `flipPrev` report nothing when there is no engine

`HTMLFlipBook.tsx:436-439` vs `runHandle` at `:405-431`.

```ts
flipNext: (corner) => engineRef.current?.flipNext(corner ?? FlipCorner.TOP) ?? false,
flipPrev: (corner) => engineRef.current?.flipPrev(corner ?? FlipCorner.TOP) ?? false,
turnToPage: (page) => runHandle(page, false),
flipToPage: (page) => runHandle(page, true),
```

`runHandle` emits `{ reason: 'notReady', code: 'NOT_LOADED' }` when
`engineRef.current` is null. The two relative methods return a bare `false`. When
the engine _does_ exist they are fine — the core's `requestTurn` dispatches
`turnRejected` itself — so the gap is exactly the pre-mount / post-unmount window,
which is the window `types.ts:74-81` and `HTMLFlipBook.tsx:391-404` claim to have
unified ("One failure contract for all four", "a refusal is reported through
`onTurnRejected` like every other refusal"). Two of the four still refuse silently.

`usePageFlip` inherits it: `lastRejection` stays `null` for a pre-mount
`flipNext()`, while a pre-mount `turnToPage()` populates it.

### R-6 — Focus is dropped to `<body>` when the focused control becomes disabled

`HTMLFlipBook.tsx:936-957`, and the focus-rescue effect at `:697-742`.

The rescue effect only looks for focus inside a **page node**
(`nodes.some((node, index) => !visible.has(index) && node.contains(active))`). The
controls are not page nodes, so the rescue never applies to them — correct as far
as it goes, and focus on a control that stays enabled is preserved.

But the controls' `disabled` state is derived from `enginePage`, so reaching a
boundary _by clicking the control_ disables the element that currently has focus.
Browsers blur a disabled element, and focus resets to `<body>`. The keyboard/AT
user who clicks "Previous page" until they reach the cover is silently teleported to
the top of the document — precisely the WCAG 2.4.3 failure the rescue effect exists
to prevent, arriving through the control H4 added for that user.

Either keep the buttons enabled with `aria-disabled="true"` and a no-op handler
(the usual APG answer for a control that must retain focus), or move focus to the
book root when the focused control is about to be disabled.

### R-7 — `controls: true` by default ships unstyled, unstyleable DOM into every book

`HTMLFlipBook.tsx:936-958`, `types.ts:116-129`; `packages/core/src/styles.ts` has no
rule for `[data-flipbook-controls]` or `[data-flipbook-control]`.

The default is defensible on the merits — the reasoning at `:917-935` is right that
a browse-mode reader previously had no way to turn a page. The problem is the
delivery: two raw browser `<button>` elements land in normal flow inside the host,
below the book, for every existing consumer, with no shipped CSS, no `className`
prop, and no render-prop escape. `.stf__parent` is `position:relative;display:block`
(`styles.ts:15`) and the wrapper reserves the aspect ratio with `padding-bottom`, so
the buttons genuinely add height to the host — a layout change for anyone who sized
the container.

`controls={false}` is the only escape, and it is all-or-nothing: a consumer who
wants their own styled controls has to reimplement the boundary logic (which, per
R-3, is currently wrong). At minimum this needs a default stylesheet rule and a way
to pass a `className` to the wrapper and the buttons; a `renderControls` seam would
be better. As shipped, the realistic outcome is that most consumers set
`controls={false}` and the a11y defect returns.

---

## MINOR

- **MIN-1 — `usePageFlip` cannot feed a controlled `page`, but says it can.**
  `usePageFlip.ts:93-96` reasons that a wrong value "re-issues a turn on a leaf that
  may not exist" because "this hook can feed a CONTROLLED `page`". `bookProps`
  (`:117-134`) contains only event handlers — there is no `page` and no
  `pageTransition`, and `setPage` was removed. The hook is now purely uncontrolled
  plus imperative actions. The reasoning is sound but describes a shape that no
  longer exists.

- **MIN-2 — `usePageFlip(initialPage)` does not reach the book.** `:63-67` seeds
  local state only; nothing is passed to the component, and the first `onLoaded`
  overwrites it with `page: 0`. The comment at `:130` ("Previously omitted, so
  `usePageFlip(999)` clamped with no signal at all") implies the argument drives the
  engine. It does not, and never will emit `turnRejected` for an out-of-range
  argument. Either drop the parameter or forward it as `initialPage` in `bookProps`.

- **MIN-3 — `lastRejection` is cleared by `onLoaded`, not only by a turn.** `apply`
  (`:69-79`) sets `lastRejection: null` and is bound to both `onPageChange` and
  `onLoaded` (`:123,125`). The doc at `:42-43` says "Cleared by the next successful
  turn."

- **MIN-4 — a prop reverting to `undefined` never returns to its default.**
  `pickSettings` (`:55-67`) omits `undefined` values, and `updateSettings` merges
  into `this.authored` (`PageFlip.ts:815`). So `drawShadow={cond ? false : undefined}`
  latches `false` for the life of the engine. Conditional props are ordinary React;
  the binding should send an explicit reset for keys that were present and are not.

- **MIN-5 — `sizing` is a live setting but forces a full remount.**
  `LiveSetting = Omit<FlipOptions, 'hardCovers' | 'initialPage'>`
  (`packages/core/src/Settings.ts:149`) includes `sizing`, and `updateSettings`
  recalculates layout for it. `remountKeyOf` (`HTMLFlipBook.tsx:85`) still keys on
  it, so changing `sizing` destroys the engine and loses the current page and any
  in-flight turn — the cost `remountKeyOf`'s own docblock (`:69-76`) explains why
  `width`/`height` avoid.

- **MIN-6 — the binding defeats D19's compile-time fence on itself.** `settings` is
  a `FlipOptions` variable containing `hardCovers` / `initialPage`, and passing a
  variable to `updateSettings(partial: Partial<LiveSetting>)` (`:602`) skips excess
  property checking. It is harmless today only because `remountKeyOf` guarantees the
  values are unchanged, so the engine's runtime refusal stays quiet. The type is
  doing no work at the one call site that matters most.

- **MIN-7 — `pnpm exec tsc -p packages/react/tsconfig.src.json` requires a prior
  `pnpm build`.** On a clean worktree it fails with `TS2307: Cannot find module
'@gullabs/flipbook-core'` and eight cascading `TS18046` errors that look like real
  narrowing failures but are not. Worth a `paths` mapping or a note, so a future
  round does not chase phantom findings.

- **MIN-8 — a runtime `className` change strips `.stf__parent` off the host.**
  `UI.ts:129` adds the class to the same element React writes `className` onto
  (`HTMLFlipBook.tsx:891`). React replaces the whole attribute, taking
  `position:relative;display:block;touch-action` with it. Pre-existing, not from this
  commit, but the H4 controls now share that host.

- **MIN-9 — `lazyRadius` + component children defers `DETACHED_PAGE` until the
  reader arrives.** A far leaf renders a placeholder host element whose ref always
  fires (`:246-253`), so the slot is full; the same leaf inside the window is a
  `cloneElement` of a component that may swallow the ref. Once R-1 is fixed, a book
  that mounts cleanly can still throw several turns later.

- **MIN-10 — a superseded controlled turn is neither applied nor reported.**
  `Flip.flipToPage` returns silently when `finishOutgoingTurn()` fails or the
  refusal is `superseded` (`Flip.ts:498`, `:585`). `engine.flip` returns `void`, so
  the controlled effect (`:782`) cannot tell. `enginePage` does not change, the
  effect does not re-run, and the book rests somewhere the prop did not ask for —
  with no `onTurnRejected`. Narrow, but it is a hole in "`page` without
  `onPageChange` is a genuinely locked book" (`:820-822`).

- **MIN-11 — spurious dependency.** `controlledPage` is in the load effect's
  dependency array (`:669`) but is not read in its body; it forces the
  `sameNodes` short-circuit to re-evaluate on every controlled page change.

---

## Checked and found correct

Stated explicitly rather than padded into findings.

- **Event mapping is complete and 1:1.** Core emits seven events
  (`flip`, `changeOrientation`, `changeState`, `ready`, `loaded`, `pagesChanged`,
  `turnRejected` — `EventObject.ts:47-79`); `IEventProps` exposes seven props, one
  per event, all unwrapped to the payload (`types.ts:58-70`, bound at `:528-564`).
  No event is unreachable and no prop is orphaned. The four removals are honest
  substitutions: `onFlip`→`onPageChange` (one occurrence, one name),
  `onInit`→`onReady`+`onLoaded`, `onUpdate`+`onCollectionRebuild`→`onPagesChanged`,
  `onNavigationError`→`onTurnRejected`. Subject to R-2 and R-4, no refusal that was
  reported before is unreported now, and none is double-reported: `engine.flip` and
  `engine.turnToPage` throw rather than dispatching, so `runHandle`'s own
  `onTurnRejected` is the only emission on that path.

- **No infinite loop in the controlled `page` effect.** The spread-membership guard
  (`:765-767`) settles it in all three configurations I traced — portrait (spread of
  one), landscape (head + partner), and `hardCovers` (lone cover, lone trailing
  leaf) — because the guard asks the collection rather than pairing indices.
  Re-entry via `setEnginePage` terminates: on the success path the next run hits the
  guard; on the throw path the clamp converges and `setEnginePage` with an unchanged
  value bails out of the re-render, so the deps do not change again. Adding
  `enginePage` to the deps is what makes `page` genuinely controlled, and it does not
  cost a loop.

- **`firstControlledApply` is correct.** Set at `:519`, re-armed on construction
  (`:574`) and on teardown (`:587`). On commit #1 the controlled effect returns at
  the `getPageCount() <= 0` guard (`:749`) _without_ consuming the flag, so the flag
  is still live when the first real collection arrives — the first application is
  instant, every later one animates. (The one wrinkle: a book that becomes
  controlled later, rather than mounting controlled, also gets an instant first
  application. That matches the prop's name, so I am not calling it a defect.)

- **The controls are correctly placed relative to the engine.** They are React
  children of the root, outside `createPortal(pages, pageHost)`, so they never enter
  `.stf__block`. `HTMLUI` adopts only the nodes handed to `loadFromHTML` /
  `updateFromHtml` and tracks them in its own `adopted` set (`HTMLUI.ts:181-229`), so
  nothing sweeps them up. `UI.ts:130` inserts `.stf__wrapper` with
  `insertAdjacentHTML('afterbegin', …)`, which puts the book _before_ the React
  children — so the DOM reading order really is pages → controls → live region, as
  `:933-934` claims. The `inert` effect only touches page nodes, so the controls stay
  in the tab order at all times, and they are real `<button>` elements with text
  content, reachable in browse mode. Boundary behaviour on an empty book
  (`pageCount <= 0` → both disabled) is right. `prev` is right everywhere. Only
  `next` (R-3) and the disable-under-focus interaction (R-6) are wrong.

- **`ENGINE_SETTING_KEYS` is exhaustive and the settings effect matches it.** All 21
  optional `FlipOptions` keys (`Settings.ts:66-141`) appear in the list; the effect's
  dependency array (`:605-626`) is exactly those 21 minus the three construction-time
  keys, plus `width`/`height` — 20 entries, no drift. No prop on
  `HTMLFlipBookProps` is silently ignored, and `maxHeight` is gone from both sides.

- **Exports are coherent.** `index.ts` re-exports the twelve types a consumer needs
  and nothing internal (`spreadPages`, `pickSettings`, `remountKeyOf`, `pageLabel`,
  `defaultLiveText`, `PageRef` all stay module-private). `PageState` is re-exported
  from core rather than redeclared, which removes the two-types-one-name hazard
  `types.ts:14-19` describes. `FlipbookState` is _not_ exported from `index.ts`
  although `usePageFlip` returns it — a consumer typing a variable holding the hook's
  result has to use `ReturnType<typeof usePageFlip>`. Small, and arguably fine, but it
  is the only type I would consider adding.

- **`spreadPages` matches `PageCollection.createSpread`** for portrait, landscape,
  and landscape-with-covers, including the lone trailing leaf. It is the right helper;
  it is simply not used by the two places that need it most (R-3).

- **The keyboard handler** correctly declines modified keys (`:838`) and defers to
  focus rather than a pointer-oriented selector (`:851`) — the reasoning at
  `:840-850` holds up, and `aria-keyshortcuts` matches what is actually handled.
