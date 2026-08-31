# Consumer verification — round 3

**Reviewed at:** `aba6a25`, isolated worktree.
**Method:** built both packages from that tree, linked them into a scratch
consumer project resolving **only** the published `dist/index.d.ts`
(`moduleResolution: bundler`, `strict`, `skipLibCheck: false`, no `src`
aliases), and re-wrote all four personas' code. Every compile result quoted is
one `tsc` emitted. Scope is `packages/*/src`; test code ignored per instruction.

Build and both src typechecks are clean:

```
pnpm build → core DTS 108.79 KB, react DTS 9.72 KB
tsc -p packages/core/tsconfig.src.json   → 0 errors
tsc -p packages/react/tsconfig.src.json  → 0 errors
```

**Headline:** the engine-side work is real and most of it is excellent. One
claim is not true, and it is the one the whole barrel prune was justified by.

---

## BLOCKER

### B1. The five collaborator getters were never removed

> _"`getRender/getUI/getPageCollection/getFlipController/getPage` are gone."_

They are not. All five are still `public` on `PageFlip`
(`PageFlip.ts:1366`, `:1376`, `:1385`, `:1422`, `:1441`) and all five still work.
Persona 4, verbatim, compiles with **zero errors**:

```ts
export const r = book.getRender();
export const u = book.getUI();
export const c = book.getPageCollection();
export const f = book.getFlipController();
export const p = book.getPage(0);

export const animating = book.getRender().isAnimating();
export const dist = book.getUI().getDistElement();
export const spreads = book.getPageCollection().getSpreadCount();
export const calc = book.getFlipController()?.getCalculation();
```

What the barrel prune removed is the ability to **name** the types. That is
confirmed too — five `TS2459`s where round 1 had two:

```
TS2459: '@gullabs/flipbook-core' declares 'Render' locally, but it is not exported
TS2459: ... declares 'UI' locally, but it is not exported
TS2459: ... declares 'PageCollection' locally, but it is not exported
TS2459: ... declares 'Flip' locally, but it is not exported
TS2459: ... declares 'Page' locally, but it is not exported
```

So the answer to _"is anything I legitimately needed now unreachable?"_ is
**nothing is unreachable, and the blockage is not honest.** The extender is not
blocked; they have exactly the access they had before, minus the types. And the
workaround compiles, which means it will be adopted and then cited:

```ts
type Render = ReturnType<PageFlip['getRender']>; // compiles
type UI = ReturnType<PageFlip['getUI']>; // compiles
```

The reason this is a BLOCKER rather than a MAJOR is what `index.ts:5-12` now says
about itself:

> _"The tell was `getUI(): UI` with `UI` never exported, so a consumer could not
> name the return type of a public method. A designed surface cannot produce
> that."_

That diagnosis was right and it is the justification given for the whole prune.
After the prune it is true of **five** methods instead of one. The file that
names the defect is shipped alongside five instances of it.

The consequences are all semver-locked:

- **Deleting these methods after publish is a major.** They are in the
  `.d.ts` (`dist/index.d.ts:2488, 2495, 2501, 2526, 2539`) and they run.
- **The internal classes are still fully emitted into the published types.**
  `declare abstract class Render` (`:944`), `UI` (`:1890`), `Page` (`:620`),
  `PageCollection`, `declare class Flip` (`:310`) — all present, none exported.
  That is why the `.d.ts` only fell 115.4 KB → 108.8 KB for a "21 names → 12"
  prune. The weight is dragged in by these five return types.
- **`ROUND-CODE-COMPLETE.md` records that "the consumer-visible half of the
  abstraction work is finished."** It is not, and that sentence is the one most
  likely to stop someone re-checking.

**Fix:** delete the five methods. Every legitimate need behind them now has a
façade answer (`getBlockElement`, `getPageElement`, `getVisiblePages`,
`canTurn`, `isReady`, `getOrientation`, `getBoundsRect`, `getState`,
`getPageCount`) — that is precisely why they were added, and I could not find a
persona-4 need that survives their removal. The one gap is `isAnimating()`,
which is reachable today only via `getRender()`; add it to the façade in the
same commit. Do this before publish or the prune is cosmetic.

---

## MAJOR

### M1. The `display` fix only works for inline styles

The engine genuinely stopped writing `display`: it is out of
`ENGINE_STYLE_PROPS` (`HTMLPage.ts:76-91`), out of the draw strings, and
`HTMLRender.clear()` now toggles a class (`HTMLRender.ts:335-338`) instead of
wiping `cssText`. That last part also closes the final wipe. Good work, and the
`--shown` idea is right.

But visibility moved from an **inline** declaration to a **stylesheet** rule:

```css
.stf__item {
  display: none;
}
.stf__item.--shown {
  display: block;
} /* styles.ts:25 — specificity (0,2,0) */
```

An inline `style={{ display: 'flex' }}` now wins, so my §3a probe passes. A
**class** does not:

```css
.ds-page {
  display: flex;
} /* (0,1,0) — loses to .stf__item.--shown */
```

Design systems style with classes and CSS modules, not inline objects. Persona 3
is the persona this was fixed for, and it is the one still broken. A consumer
who writes `.ds-page{display:grid}` in a CSS module gets `block`, silently, and
now with no inline declaration to point at when they open devtools — the losing
rule at least used to be obvious.

Worse, `.book .ds-page` (0,2,0) _ties_, so the winner is document order — which
depends on whether the bundler emits the consumer's stylesheet before or after
`ensureFlipbookStyles()` injects the engine's into `<head>`. Non-deterministic
across builds is worse than deterministic and wrong.

**Fix, and it is the clean one: stop using `display` for visibility at all.**
Hide with `visibility:hidden` (leaves are `position:absolute`, so the layout cost
is nil; hidden elements are not hit-testable and are skipped by find-in-page,
exactly as `display:none` was). Then the engine owns `visibility` and the
consumer owns `display`, and the two axes cannot collide at any specificity. A
consumer setting `visibility` on a page is not a thing that happens.

`@layer` is the other candidate and I would **not** use it here: it would make
the _hiding_ rule losable too, so a consumer's `.ds-page{display:block}` would
un-hide every leaf in the book at once. Decoupling the properties is safer than
re-ranking them.

### M2. `background-color` — the rule you asked for

You are right that the invariant needs _something opaque behind the content_,
not that this element's `background-color` be `pageBackground`. Today the engine
writes it (`ENGINE_STYLE_PROPS` line 83, `HTMLPage.ts` `commonStyle`), so a
consumer's `style={{ background: '#f4ecd8' }}` loses — the shorthand's longhand
is set first and the engine's `setProperty('background-color', …)` lands after it
in the same block. Sepia paper on one chapter does nothing, in a library whose
README has a section called "Opaque paper".

**Recommended rule: the engine paints the paper on the leaf's `::before`, driven
by a custom property.**

```css
.stf__item::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--stf-paper, #fff);
  pointer-events: none;
}
```

and the engine writes only `--stf-paper` on the element. Why this and not the
alternatives:

- **It preserves the invariant unconditionally.** There is always an opaque
  layer behind the leaf's content, whatever the consumer does.
- **`background-color` becomes entirely the consumer's.** A negative `z-index`
  inside the leaf's own stacking context (leaves already carry `transform`, so
  they establish one) puts the paper _behind_ the element's own background, so a
  consumer's colour paints over it and a consumer's _translucent_ colour still
  has opaque paper underneath. That is the semantics you want and it falls out
  for free.
- **No DOM ownership conflict.** This is the objection to the obvious fix — an
  engine-inserted underlay `<div>` would mean the engine inserting a child into a
  node React owns, which is the hazard `CLAUDE.md` warns about. A pseudo-element
  is not a node. The engine writes one custom property, which collides with
  nothing.
- **A custom property is not on any consumer's collision surface**, unlike
  `background-color`.

Two caveats, both cheap to check and neither a reason not to do it: negative
`z-index` combined with `transform-style: preserve-3d` has historically been
quirky in Safari, and this codebase already carries a Safari clip-path
workaround (`HTMLPage.ts` `isSafari()`), so that territory is known. And
`::before` needs the leaf not to be a replaced element — a consumer whose page
child is a bare `<img>` gets no pseudo-element. That case wants the current
`background-color` behaviour as a fallback, which is a one-line check at adopt
time, not per frame.

If you do not want to do this now, the acceptable interim is **write it down**:
`display` is the consumer's, `background-color` is the engine's. That line is
defensible, but "the engine owns layout" no longer describes it, and nobody can
guess it.

### M3. The README is unchanged

`README.md` has no `onLoaded`, no `pageCount`, no counter in the React snippet,
no styling section, no `stf__` class list, no SSR note. So:

- **"Page 1 of 0" is not fixed** — your own triage ranked it #2 and I called it
  the cheapest high-value item in the document. I re-ran persona 1 verbatim
  against this build; it compiles and it still reads "of 0" until the first turn,
  because `onPageChange` still (correctly) does not fire on open.
- **No `pageLabel` prop** (`types.ts:97-150`), so the live region still says
  `index + 1` — wrong for any book with front matter. This one is semver-locked:
  adding the prop later is fine, changing the default announcement later is not.
- **No `injectStyles` / `styleNonce`**, so a strict-CSP design system still
  cannot use the package.
- **No SSR limitation note.** I re-confirmed the mechanism: `createPortal(pages.list, pageHost)`
  with `pageHost` set only in the mount effect (`HTMLFlipBook.tsx:698`), so the
  server still emits zero page content.

None of this is wrong to stage after the engine work. It is only wrong to
describe as built.

---

## MINOR

### m1. `var(--typo)` produces a transparent fold

The `pageBackground` rewrite is good and I could not break it (see "Answers to
your direct questions"). One residual: `VAR_RE` (`pageBackground.ts:75`) accepts
`var(--x)` with **no fallback**, and `isOpaquePageBackground` returns `true` for
it as a stated trade. But the trade you documented is _"a translucent custom
property is the caller's to get right"_ — the far more likely case is an
**undefined** one. `background-color: var(--papr)` (a typo) is invalid at
computed-value time, so the declaration drops and the leaf paints `transparent`:
the page underneath reads through the fold, which is the exact bug the setting
exists to prevent, reached by a misspelling.

`var(--x, red))` is also accepted (`[^;]*` is greedy, the trailing `)` is eaten
into the fallback), and `setProperty` then drops it — same transparent outcome.

**Fix:** make the fallback mandatory and validate it — `var(--x, <colour>)`.
`VAR_RE` already captures the group; requiring it turns a typo into a visible
fallback colour instead of a see-through page, and closes the malformed case
with it.

### m2. `usePageFlip`'s subscription is keyed on a state proxy

The structural fix is real — the hook subscribes to `flip`/`pagesChanged`/
`changeOrientation` directly (`usePageFlip.ts:220-246`), and persona 2 with
`{...book.bookProps}` spread first and `onPageChange` overridden now works.

But the effect's dependency is `[apply, state.pageCount]`, and the comment
concedes it ("`pageCount` moving off 0 is that signal"). `remountKey`
(`hardCovers` / `initialPage`) destroys the engine and builds a new one; if the
new book has the **same page count**, the effect does not re-run, so the hook
stays subscribed to the destroyed engine and never subscribes to the new one.
State then flows only through `bookProps` — which is the channel prop order can
defeat. So the freeze is reachable again by: change `hardCovers` at runtime
**and** override `onPageChange`. Narrow, but it is the same bug the fix targeted.

**Fix:** key on engine identity, not on a value that correlates with it. The
cleanest is for `HTMLFlipBook` to publish the engine as state the hook can
depend on, rather than the hook inferring existence from `pageCount`.

### m3. `lastRejection` no longer matches its documented contract

`FlipbookState.lastRejection` is documented "Cleared by the next successful
turn" (`usePageFlip.ts:52`). The authoritative `sync` calls
`apply(snapshot, false)` — `clearRejection: false` (`usePageFlip.ts:226-234`). It
is cleared today only because `bookProps.onPageChange` also fires and runs first.
Override that prop — the case m2's fix exists for — and a rejection sticks
forever, so a consumer rendering "you're at the end" never stops.

### m4. Four failure conventions across five new façade methods

`getBlockElement()` throws (`uiOrThrow`), `getPageElement()` returns `null`,
`getVisiblePages()` returns `[]`, `canTurn()` returns `false`, `isReady()`
returns a boolean — while the neighbouring `getPageCount()` /
`getCurrentPageIndex()` throw `NOT_LOADED` / `DESTROYED`. A consumer writing one
effect that uses several needs a different guard for each. The lenient choices
are right for chrome-rendering queries called from effects; `getBlockElement()`
is the odd one out and should return `HTMLElement | null` to match
`getPageElement()`. Worth settling now, since these are new.

### m5. `getVisiblePages()` says "in reading order" and returns index order

`PageFlip.ts:1306` and `usePageFlip.ts:51` both promise reading order.
`[VISIBLE_PAGES]()` returns `[...spread]` straight from the spread table
(`PageCollection.ts:284-291`), and the table is built in index order —
`readingDirection: 'rtl'` is applied later, in `showSpread`, as _which side each
leaf is placed on_. So an RTL book returns `[4, 5]` where reading order is
`[5, 4]`. A consumer building an Arabic thumbnail strip or an announcement gets
it backwards. Either reverse for RTL or change the docs to "in index order".

### m6. Three orphan exports

`FlipDirection`, `PageDensity` and `PageOrientation` are still exported
(`index.ts:60-62`) and **no public signature mentions any of them** — I checked
the emitted `.d.ts`; they appear only as their own `declare const`s. They were
reachable before through `Render.getDirection()` and `Page`, which are now
unnameable. Density is set from HTML via `data-density`, so a consumer never
needs the const. By the barrel's own stated standard these three go.

### m7. `atStart` / `atEnd` still hand-rolled next to `canTurn`

`HTMLFlipBook.tsx:443-444` derives boundaries from
`visiblePages[last] >= pageCount - 1` and `enginePage <= 0`. Both give the right
answer in the cases I traced (including hardCovers and the trailing odd leaf) —
but `canTurn('next')` / `canTurn('prev')` now exist precisely to be the single
owner of that rule, and `usePageFlip` already uses them. This is the last copy.

---

## Answers to your direct questions

**Have you opened an injection hole? No — and the guard is stronger than the
comment claims.** I ran the predicates against a hostile battery. Everything
that should be refused was: `red;position:fixed`, `red}body{display:none`,
`url(https://evil/x.png)`, `expression(alert(1))`, `red /* x */`, `\75 rl(x)`,
`red\n;position:fixed` → all `unsafe`. Everything that should now be accepted
was: `oklch(0.98 0.02 90)`, `color-mix(in srgb, red 50%, blue)`, `var(--paper)`,
`light-dark(#fff, #000)`, `#f4ecd8`. And the round-2 inversion is fixed —
`rgb(0 0 0 / 50%)`, `oklch(… / 0.4)`, `#fff0`, `#ffffff80` all correctly
`translucent`, where the old `functionalAlpha` reported the slash form opaque.

Worth knowing: the value reaches the DOM through
`element.style.setProperty()` (`HTMLPage.ts:68`), not a raw attribute write, and
CSSOM `setProperty` cannot introduce a second declaration — an invalid value is
simply dropped. The one genuine vector was `applyEngineStyle`'s `css.split(';')`,
and `;` is banned. So the safety story rests on one character, and that character
is covered.

**Is the SSR fallback acceptable? Yes, and for a better reason than the comment
gives.** `COLOUR_SHAPE_RE` is more permissive than a browser — `notacolour` and
`image-set("https://evil/x.png")` both pass under SSR. That is harmless not
merely because "the engine only paints in a browser", but because the value is
re-checked _in the browser_ before it paints: `foldFill` → `rejectPageBackground`
runs again on every draw, with `CSS.supports` available, and rejects both. The
permissive path cannot reach a pixel. I would add that sentence to the docblock —
it is the argument that actually closes the question.

**Is the duplication genuinely gone? Yes.** `spreadPages()` is deleted;
`grep -rn "spreadPages"` in `packages/react/src` returns only two comment lines.
`usePageFlip.withBounds` now calls `engine.canTurn()` / `engine.getVisiblePages()`
(`:78-80`). The controlled effect asks `engine.getVisiblePages().includes(page)`
(`HTMLFlipBook.tsx:920`). The one residual copy is m7.

**Are the answers right in all four cases? Yes, by construction.**
`[VISIBLE_PAGES]()` reads the spread table rather than re-deriving it, so it
cannot drift from `createSpread`. Traced: portrait → `[[0],[1],…]`, one leaf;
landscape no covers → `[0,1],[2,3],…`; `hardCovers` → `[[0]]` then `[1,2],[3,4],…`,
cover alone; trailing odd leaf → singleton (`PageCollection.ts` `createSpread`,
the `i < length-1` branch); `hardCovers` + 6 pages → `[[0]],[1,2],[3,4],[5]`,
back cover alone per NF3. It returns a copy, so a consumer cannot mutate the
engine's table. This is the right implementation — a read, not a re-derivation.
The only defect is the RTL ordering claim (m5).

**The 13 TS errors: all gone.** `FlipCorner` and `PageFlipError` import as
values, `FlipbookState` names the hook's return, and
`import '@gullabs/flipbook-core'` is no longer needed in a React consumer's
`package.json`. Persona 2's `Chrome({ book }: { book: FlipbookState })` — the
thing that was unwritable — compiles.

**The three class collapses: they do not matter to a consumer, and reverting the
half-finished merge was right.** Nothing exports them and no public signature
names them, so a consumer cannot observe the difference. Their only
consumer-visible cost is `.d.ts` weight, and that weight is caused by B1, not by
the collapses — deleting the five getters removes the class declarations from
the published types whether or not the classes are ever merged. Fix B1 and this
becomes pure internal hygiene, correctly deferred.

---

## Verified as claimed

- `sizing` live (`HTMLFlipBook.tsx:34`, `:770`).
- `GeometryAbort` wired — thrown at `FlipCalculation.ts:297`/`:318`,
  identity-checked at `:118`; correctly **not** re-exported from `index.ts`.
- The false-positive component warning is gone (no `warnedNonHost` remains).
- Out-of-band `destroy()` reports: `isDestroyed()` checked at
  `HTMLFlipBook.tsx:477` and `:518`.
- `HTMLRender.clear()`'s `cssText` wipe is gone (`:335-338`).
- The five façade methods exist and personas 1–3 compile against them.

## Priority

1. **B1** — delete the five getters, add `isAnimating()`. Semver-locked, and it
   is the claim the prune was sold on.
2. **M1** — `visibility` instead of `display` for the shown/hidden axis.
3. **M2** — `::before` + `--stf-paper`, or write the ownership line down.
4. **M3** — README: the counter, the class contract, the SSR note; `pageLabel`
   is the semver-locked part.
5. **m1** — require a `var()` fallback.
6. The rest as hygiene.
