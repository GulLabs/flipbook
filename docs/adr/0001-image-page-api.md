# ADR 0001 — The image-page API for canvas mode

- **Status:** proposed (agent decision under [`AGENTS.md`](../../AGENTS.md) §5, pending Codex signoff and owner veto)
- **Date:** 2026-08-29
- **Context:** [`docs/CANVAS_FIRST_CLASS.md`](../CANVAS_FIRST_CLASS.md) "Blocking gates before implementation"
- **Defects settled here:** A3, A4, C7, D1, F1, G2, G3, G4 (policy half), G7
- **Supersedes:** the "Proposed design decisions — PENDING OWNER APPROVAL" block in
  `CANVAS_FIRST_CLASS.md`, which this ADR either adopts, sharpens or overrules
  point by point.

## Why this can be decided now, and why the shape of the answer is asymmetric

Neither `@gullabs/flipbook-core` nor `@gullabs/react-flipbook` is published —
both 404 on npm. Under `AGENTS.md` §5 the line is **irreversibility**, not
surface: before the first publish an API decision is a normal design decision;
after it, it is one-way.

That asymmetry is not just permission to decide, it is a **tie-breaker**, and it
is used deliberately throughout this document:

> **Narrow now, widen later.** Where two options are close on merit, prefer the
> one whose reversal is a _widening_ — adding an accepted input type, adding a
> field, adding an event, relaxing a required property. Widenings are
> non-breaking forever. Narrowings (requiring a field that was optional,
> removing an accepted input form, splitting one component into two) are majors
> and, worse, are the kind of major that fails silently in consumer code.

Every decision below states its post-publish reversal cost in those terms.

## What the downstream consumer actually does

Read before arguing with any decision here. Source:
`/Volumes/SSD/code/work/story-book/apps/web/components/reader/` and
`apps/web/lib/reader-flip.ts`.

1. **Pages are pre-rendered JPEGs**, 1600×2400, composed from HTML templates
   with the folio and typography already baked in (`reader-leaves.tsx:109-125`).
   This is the entire reason canvas mode is being made first-class.
2. **They are drawn `object-contain`, centred, never `object-cover`** — cropping
   would cut the baked-in folio. Today's canvas renderer stretches to the leaf
   rect (A3), which is `fill`. So the default fit is a real behaviour decision,
   not a formality.
3. **The inset is a fraction, not pixels.** `LEAF_INSET_FRAC = 0.028`, applied as
   `padding: 2.8%` (`reader-leaves.tsx:30`). It scales with the book, which is
   resized continuously (`measureBook`). A `number` of CSS px — which is what
   `CANVAS_FIRST_CLASS.md` currently proposes — cannot express this consumer's
   only actual use of an inset.
4. **`alt` exists, is meaningful, and is per page**: `pageAlt(page, bookTitle)`,
   `Front cover of ${title}`, `Back cover of ${title}`. So requiring `alt` costs
   this consumer nothing — they already compute it.
5. **A failed image already has product behaviour**: `BackCoverLeaf` holds
   `failed` state, `onError` swaps in a different leaf entirely
   (`reader-leaves.tsx:175-193`). Any error contract that only _reports_ and
   offers no way to substitute artwork is below the bar this consumer already
   meets in HTML mode.
6. **Images are same-origin today** — served out of the Next.js public root with
   `?v=` versioning (`lib/media-version.ts`, `lib/media-headers.ts`). R2 is in
   use for PDFs only. So C7 is not currently biting _this_ consumer; see
   "Questions only the owner can answer".
7. **Not every leaf is an image.** The reader renders narration-only text
   leaves, `BlankLeaf` pads, an `EndPage` fallback and a title-only cover
   fallback (`renderLeaf`, `reader-leaves.tsx:196-207`). An images-only canvas
   mode cannot represent any of them. This is the single most important fact in
   this list and it is a product question, not a technical one — see the last
   section.
8. **The book is 32-ish leaves, remounted on layout change** (`key={size.layout}`),
   with `showCover`, `size: 'fixed'`, `usePortrait={!desk}` and `flippingTime`
   driven by reduced motion.

---

## Decision 1 — the `ImagePageSource` descriptor

### The decision

```ts
// packages/core/src/Page/ImagePageSource.ts — exported from the package entry.

/** How a bitmap is fitted into its leaf rect. */
export type ImageFit = 'contain' | 'cover' | 'fill';

/** Per-page image descriptor. The only accepted element type of an image book. */
export interface ImagePageSource {
  /** Image URL. Required; the only required field besides `alt`. */
  readonly src: string;

  /**
   * Accessible name for this page, rendered into the semantic mirror.
   *
   * REQUIRED. An empty string is a valid, *meaningful* value: it asserts the
   * page is decorative. Omitting the field is a compile error, and at runtime
   * is treated as "unknown", which is NOT the same thing — see below.
   */
  readonly alt: string;

  /** Intrinsic pixel size, if known. Advisory only — see below. */
  readonly width?: number;
  readonly height?: number;

  /**
   * Sets `HTMLImageElement.crossOrigin` before `src` (G7). Omitted means no
   * attribute, which is today's behaviour and taints the canvas for a
   * cross-origin image (C7).
   */
  readonly crossOrigin?: 'anonymous' | 'use-credentials';

  /** Per-page override of the book's `imageFit`. */
  readonly fit?: ImageFit;

  /** Per-page override of the book's `imageInset`. Fraction of page width. */
  readonly inset?: number;

  /** Per-page override of the book's `pageBackground` (G2). Must be opaque. */
  readonly background?: string;

  /** Per-page override of the density the collection would assign. */
  readonly density?: 'soft' | 'hard';
}

// PageFlip
public loadFromImages(sources: readonly ImagePageSource[]): Promise<void>;
public updateFromImages(sources: readonly ImagePageSource[]): Promise<void>;

/** Replace one page's image in place — retry, or substitute fallback art. */
public replaceImage(page: number, source: ImagePageSource): void;
```

**Bare strings: broken now.** `loadFromImages(string[])` no longer compiles.

### Reasoning

**Required `alt`, and the empty-string distinction.** The prior review is right
that normalising a bare string to `{ src, alt: '' }` is a _silent accessibility
failure_, and the fix is not to soften the warning — it is to make the missing
case unrepresentable. `alt: ''` in HTML means "decorative, deliberately skip
me", and a normaliser that fabricates it is putting words in the author's mouth
for every page of the book. So:

- The **type** makes absence a compile error. That is the primary enforcement
  and it is free.
- For a JavaScript consumer, where the type enforces nothing, absence is
  **"unknown", never "decorative"**. The semantic mirror renders the truthful
  fallback `Page ${n}` (or the cover labels, matching `defaultLiveText` in
  `HTMLFlipBook.tsx:147`), and the engine emits one `console.warn` per book —
  one, not per page, and via the same `console.warn` channel the pack script
  already asserts survives minification (`scripts/pack-html-engine.mjs:82`).
- `alt: ''` is honoured exactly: the page is `aria-hidden` in the mirror and no
  warning fires. A blank pad leaf is a real thing (the downstream `BlankLeaf`),
  and it deserves a way to say so.

The engine never _invents_ alt text and never silently drops the question.

**Breaking the bare string rather than deprecating it.** All four options were
considered against reversal cost:

| Option                      | Cost to reverse post-publish                                                   |
| --------------------------- | ------------------------------------------------------------------------------ |
| Keep `string` forever       | Removing it later is a **major** and `alt` can never become required           |
| Accept with normalisation   | Same, plus the silent-a11y failure ships                                       |
| Deprecate + runtime warning | Same removal cost; the warning is noise for a form we still accept             |
| **Break now**               | Re-accepting `string` later is a **widening — non-breaking, always available** |

There are no consumers: the package is unpublished, the downstream reader does
not use canvas mode at all, and the only in-repo callers are tests and
`canvas-loader.ts`. The cost today is a handful of test fixtures. The cost of
the other three options is that `alt` is required in the type and optional in
practice, which is the type lying — the exact failure mode §4.7 of the
downstream spec exists to prevent.

No convenience helper (`imagePages(srcs)`) is provided, deliberately: any such
helper has to invent `alt`, which is the thing this decision refuses to do.

**`width`/`height` are advisory.** Two uses: laying out `contain`/`cover`
geometry _before_ the bitmap decodes (so the art does not pop into position),
and sizing a placeholder. They are never used to scale the drawn bitmap. On
decode, `naturalWidth`/`naturalHeight` win unconditionally; a mismatch produces
one dev `console.warn`. They are optional because most consumers do not know
them, and a required-but-guessed intrinsic size is worse than none.

**`crossOrigin` is per page with a book-level default `imageCrossOrigin`, and
defaults to omitted.** Defaulting to `'anonymous'` would be actively harmful:
an image served without `Access-Control-Allow-Origin` **fails to load** when the
attribute is present, so the default would convert today's "renders, but taints
the canvas" into "does not render" for every consumer whose CDN is not
CORS-configured. Omitted is the honest default; the docs state plainly that
`getImageData`/`toDataURL` on the flipbook canvas require it. The attribute must
be assigned **before** `src` — already recorded as constraint G7 and enforced by
the descriptor path, since the constructor is the only place `src` is set.

### Rejected alternatives

- **Parallel `alt` array** (`loadFromImages(srcs, alts)`). Drifts under reorder
  and partial update — you can insert a page and forget the label, and nothing
  detects it. Already rejected in `CANVAS_FIRST_CLASS.md`; concurred.
- **`alt?: string`, warn at runtime.** Makes the warning the only enforcement,
  and warnings are filtered, dropped in production builds and ignored. Also
  unreversible in the expensive direction (see the table).
- **A `title`/`label` field instead of `alt`.** `alt` is the word every web
  author already knows for this, and the downstream consumer literally names its
  helper `pageAlt`.
- **`ImageBitmap` / `Blob` / `HTMLImageElement` union for `src`.** Genuinely
  attractive (a consumer with a `pdfjs` canvas has no URL), but it changes
  ownership: the engine currently owns creation _and_ disposal of the bitmap,
  and a caller-supplied `ImageBitmap` cannot be `close()`d by the engine without
  breaking the caller. That is a resource-policy fork, not a descriptor field.
  Deferred — and adding a union member later is a widening. The PDF adapter on
  the §7 roadmap is where this gets decided properly.

### Post-publish reversal cost

- Adding a descriptor field: **free** (widening).
- Re-accepting `string`: **free** (widening).
- Making `alt` optional later: **free** (widening).
- Making `alt` required after shipping it optional: **major**, and the failure is
  silent — every book that omitted it keeps compiling under `skipLibCheck` and
  ships unlabelled.
- Changing the default `crossOrigin` to `'anonymous'`: **breaks every non-CORS
  CDN book** with no type-level warning. Effectively unreversible.

---

## Decision 2 — the image-error contract (A4)

### The decision

**Promise semantics.**

```ts
loadFromImages(sources): Promise<void>
```

resolves when: the canvas chunk has imported, the mode is attached, the
collection is built, **and every image of the initial spread has settled**
(decoded or failed). It does _not_ await pages outside the initial spread —
with a lazy window it cannot, and the spread is the smallest set for which
"the book is showable" is true.

- `updateFromImages` follows the same rule against the new collection's resolved
  spread.
- The promise **rejects only for engine failures**: chunk load (`CANVAS_LOAD`),
  invalid input (`INVALID_IMAGE_SOURCE`), wrong mode (`WRONG_MODE`). A page
  image failing is _not_ a promise rejection — a 404 on page 3 must not make
  `await book.loadFromImages(...)` throw and take out a component that would
  otherwise render 31 good pages.
- Superseded and post-`destroy()` loads still resolve to `undefined` silently,
  unchanged (L7 — do not regress this).
- **Stated hazard:** a request that neither loads nor errors (a hung socket)
  keeps the promise pending forever. This is tolerable _only because the book is
  already on screen_ — the mode is attached and the loader draws before the
  promise settles — so a consumer awaiting it is choosing when to hide their own
  chrome, not choosing whether a book exists. No timeout setting; a timeout is a
  policy the consumer can impose with `Promise.race` and cannot un-impose if we
  bake it in.

**The event.**

```ts
export type FlipbookEventMap = {
  // …existing…
  imageError: {
    /** Leaf index at the moment of failure, in the collection that owns it. */
    page: number;
    /** The `src` that failed, exactly as it was set on the element. */
    src: string;
    /** 1 for the initial load; increments per `replaceImage` on that leaf. */
    attempt: number;
  };
};
```

No `error` object: an `HTMLImageElement` `error` event carries no diagnostic,
and inventing a `reason: 'network' | 'decode'` taxonomy we cannot populate is
the "guess recorded as a finding" failure in API form (`AGENTS.md` §3).

**Fallback artwork: none, by design.** A failed page draws `pageBackground`
paper and stops. Specifically: it clears `isLoad`, sets the same `failed` flag
family as `disposed` (C9), and **stops the spinner** — that is the actual A4
bug, a 404 spinning forever. No broken-image glyph, no red X: this is a
children's picture book, and browser-chrome iconography drawn into the page is
worse than blank paper.

**Retry: no automatic retry. One imperative escape hatch.**

```ts
public replaceImage(page: number, source: ImagePageSource): void;
```

Re-arms one leaf with a new descriptor — same `src` with a cache-buster for a
retry, or different art for a fallback. It increments that leaf's `attempt`,
resets its failed state, and redraws. Grounded directly in the downstream
`BackCoverLeaf` behaviour (fact 5 above), which no report-only contract can
express. Automatic retry with backoff was rejected: for a genuinely missing book
it multiplies requests, it hides the failure behind a delay, and the right
backoff is a consumer policy.

**Exactly-once.** One `imageError` per `(leaf identity, attempt)`. Enforced by a
per-page `notifiedAttempt` counter, not by a set keyed on `src` — two leaves may
legitimately share a `src`, and both should report.

**Suppression.** No `imageError` is emitted for a page whose owning collection is
no longer `PageFlip.pages`, nor after `dispose()`, nor after `destroy()`. This
reuses the existing `loadGeneration` counter (`PageFlip.ts:98`) rather than
adding a second lifecycle: a page captures the generation it was built under and
an emission whose generation is stale is dropped. Disposal detaches `onerror`
and `onload` and clears `src`, so in the common case nothing is left to fire.

### How `EventObject`'s dispatch semantics constrain this

`trigger` now snapshots the listener list, runs every listener, rethrows the
**first** error synchronously and the rest via `setTimeout`
(`EventObject.ts:195-222`). Three consequences, all designed for rather than
worked around:

1. **`imageError` is emitted from the image's own `error` handler, never from a
   draw call or an rAF frame.** A throwing listener rethrows synchronously into
   whatever stack emitted; if that stack were `drawFrame`, one bad consumer
   handler would kill the render loop mid-turn. From an image event handler the
   throw lands in `window.onerror`, which is where a consumer defect belongs.
   This is a hard implementation constraint, not a preference.
2. **The synchronous rethrow is deliberately kept.** It means an `imageError`
   listener that throws is not silently swallowed, consistent with the engine's
   rule that a failure which is not the engine's own is never converted into
   silence.
3. **The snapshot means a listener registered from inside an `imageError`
   handler does not receive the current dispatch.** For a per-page error event
   this is the right semantics (you cannot subscribe retroactively to a failure
   already being reported) and matches Node's `EventEmitter`.

The one thing it does constrain: **the promise must not be resolved from inside
`trigger`'s call stack.** If the initial spread's last image fails, the
`imageError` dispatch runs first and may throw; resolution of the load promise
is therefore scheduled independently of listener outcome, so a throwing listener
cannot leave `loadFromImages` pending forever.

### Rejected alternatives

- **Reject the load promise on any image failure.** Turns one missing asset into
  a dead component. Directly contradicts the downstream fallback behaviour.
- **Resolve the promise on attach only (today's meaning).** Honest but nearly
  useless — `CANVAS_FIRST_CLASS.md`'s own Phase 0 fixture notes tests "must still
  wait for pixels" because of exactly this. It also pushes every consumer into
  hand-rolling a readiness signal.
- **Await _all_ pages.** Incompatible with lazy loading (Decision 3), and
  quadratically worse for a 500-page book.
- **An `imageLoad` success event alongside `imageError`.** Useful for progress
  UI, but speculative, N-per-book noisy, and adding it later is a widening.
  Omitted deliberately.
- **`onerror` per descriptor (a callback field).** Puts a function in a data
  structure that is compared, serialised and diffed by consumers, and duplicates
  the emitter that already exists.

### Post-publish reversal cost

- Adding `imageLoad`, or fields to the `imageError` payload: **free**.
- Removing or renaming a payload field: **major**.
- **Changing when the promise resolves: the most expensive item in this whole
  ADR.** It is a pure behaviour change with no type change, so nothing warns
  anybody: consumers who gate a loading screen on it get a flash of unstyled
  book (if it resolves earlier) or a hang (if it resolves later), and the
  compiler is silent in both directions. Decide it once, here.
- Adding automatic retry later: **behaviour-breaking** for anyone whose
  `imageError` handler counts failures. Prefer never; prefer a setting if ever.

---

## Decision 3 — resource policy (G3/G4)

### The decision

**Two new settings, both measured in spreads, both distinct in name from
`lazyRadius`.**

```ts
interface FlipSetting {
  /**
   * Canvas/images mode only. Spreads either side of the current spread whose
   * images are fetched and decoded. `Infinity` restores the pre-3.0 eager
   * behaviour. Default 1.
   */
  imageLoadRadius: number;

  /**
   * Canvas/images mode only. Spreads either side of the current spread whose
   * decoded images are retained. Must be >= `imageLoadRadius`. `Infinity`
   * never evicts. Default 2.
   */
  imageKeepRadius: number;
}
```

Validation in `Settings.getSettings`: each must be a non-negative number or
`Infinity` (`Number.isNaN` rejected), and `imageKeepRadius >= imageLoadRadius`,
else `PageFlipError('…', 'INVALID_IMAGE_RADIUS')`. Both are runtime-updatable —
they are read where they are used, never cached (the `swipeDistance` lesson in
`CLAUDE.md`).

**`lazyRadius` keeps its meaning and is not accepted by `ImageFlipBook` at
all.** It is React-side DOM-mounting policy (`HTMLFlipBook.tsx:194-271`), it was
just changed to be measured in spreads, and there is no page DOM in canvas mode
for it to govern. The two concerns share a unit and nothing else.

**Ownership.** `ImagePageCollection` is the sole owner of the window. It is the
only thing that calls `ImagePage.load()` and `ImagePage.dispose()`. `PageFlip`
never reaches into it; `Render` never triggers a fetch.

**Timing.** The window is recomputed exactly twice:

1. once at `load()` / after `replacePages`, from the resolved start spread;
2. in `PageCollection.showSpread()` (`PageCollection.ts:298`), i.e. after a turn
   or jump commits — the one place that already knows the new current spread and
   already talks to `Render`.

Never on an rAF tick, never on a timer, never inside `draw()`. Eviction inside a
frame is how you drop the bitmap you are painting.

**Pinning.** A page is pinned — never evicted regardless of radius — while it is
any of:

- a member of the current spread (`Render.leftPage` / `rightPage`);
- `Render`'s flipping page or bottom page;
- the origin of a live `temporaryCopy`, or the copy itself.

The last one is where canvas differs from HTML and where G3/G4 interact: a
portrait BACK turn animates `newTemporaryCopy()`, which **shares** the origin's
`HTMLImageElement` (`ImagePage.ts:51-58`). So ref-counting is not needed and must
not be added: **the origin page owns the bitmap; a copy borrows it and disposes
only itself** (already implemented and commented at `ImagePage.ts:193-199` —
this ADR only pins that as policy). Pinning the origin while a copy is live is
what stops eviction from blanking a fold mid-turn.

Concretely, the eviction predicate is `!page.isPinned() && distanceInSpreads >
imageKeepRadius`, where `isPinned()` is the disjunction above.

**Why two knobs rather than one.** A single radius forces keep == fetch, which
thrashes: turn forward one spread and the spread you just left is immediately
evicted; turn back and it is re-fetched, producing a visible loader on a page
the reader saw two seconds ago. Keep > load is hysteresis, and it is the whole
reason the pair exists.

**On the defaults, with the arithmetic stated.** A 1600×2400 source decodes to
roughly 15 MB of RGBA. The downstream books are ~32 leaves. `imageKeepRadius: 2`
in landscape retains on the order of 9-10 leaves, i.e. ~140 MB of decoded data
if the browser retains all of it — browsers do evict decoded bitmaps under
pressure, which is why `CANVAS_FIRST_CLASS.md` refuses to assert decoded-memory
totals and why this ADR does not either. What is _definite_ is the number of
retained `HTMLImageElement`s and the number of network requests, and that is
what these settings control. A larger keep radius is a comfort/memory trade the
consumer can make; the default errs small because the failure mode of too-large
is a mobile Safari tab kill and the failure mode of too-small is a loader.

The initial-load promise (Decision 2) awaits the **initial spread only**, not
the whole `imageLoadRadius` window. Radius 1 must not double the time to first
paint.

### Rejected alternatives

- **Reuse `lazyRadius` for both.** Explicitly warned against in
  `CANVAS_FIRST_CLASS.md`'s gate list, and rightly: one number would mean "keep
  the DOM mounted" in one component and "keep the bitmap decoded" in another,
  the correct values differ (DOM nodes are cheap, 15 MB bitmaps are not), and a
  consumer tuning one would silently retune the other.
- **One `imageRadius`.** Thrashing, above.
- **Radius in pages rather than spreads.** RB7 is the record of what measuring a
  window in pages does in landscape: both leaves of the _next_ spread were still
  placeholders while the turn to them animated. Spreads is the unit that means
  the same thing in both orientations.
- **`IntersectionObserver` / `loading="lazy"`.** Requires the images to be in the
  DOM. In canvas mode they are not.
- **Reference-counted shared bitmaps.** Solves a problem that does not exist —
  the only sharer is the temporary copy, whose lifetime is strictly inside its
  origin's. Adding a refcount would add a class of leak (a missed decrement)
  where there is currently none.
- **Time-based eviction (LRU with a TTL).** Needs a clock in the collection and
  makes behaviour untestable without fake timers. Spread distance is
  deterministic and is exactly the axis the reader moves along.

### Post-publish reversal cost

- Adding a third radius or an eviction strategy setting: **free**.
- Renaming either setting: **major**.
- **Changing a default:** no type change, so silent — lowering `imageKeepRadius`
  post-publish makes existing books visibly re-fetch. Raising it raises memory
  for everyone. Treat the defaults as near-frozen at publish.
- Reusing `lazyRadius` and later splitting it: **major**, plus every existing
  consumer's tuning silently means something new.

---

## Decision 4 — fit modes (A3) and page-local background (G2)

### The decision

```ts
interface FlipSetting {
  /** Canvas/images mode only. Default 'contain'. */
  imageFit: ImageFit;

  /**
   * Canvas/images mode only. Uniform inset around the bitmap, as a FRACTION OF
   * PAGE WIDTH on all four edges — the same resolution rule as CSS percentage
   * padding. Range [0, 0.5). Default 0.
   */
  imageInset: number;
}
```

with per-page overrides `ImagePageSource.fit`, `.inset` and `.background`.

- **Both, not one.** Book setting for the default (one line for a uniform book),
  per-page override for the exception (a spread that must bleed to the edge, a
  cover that must `cover`). The book-level value is read **at draw time** from
  the live settings object so `updateSettings` works for free; only the per-page
  override is normalised once and cached on the page.
- **Default `contain`.** Today's implicit behaviour is `fill` (A3: stretched to
  the leaf rect). `contain` is what the downstream consumer already asks for in
  CSS, and it is the only fit that cannot destroy information — `cover` crops,
  `fill` distorts, and both do it silently. `fill` is retained explicitly for
  anyone who wants the legacy stretch.
- **Inset is a fraction of page width, not CSS px.** Downstream fact 3 above:
  the only real-world inset in evidence is `padding: 2.8%` on a continuously
  resized book. A px inset would be wrong at every size but one. The units match
  CSS percentage padding exactly (all four edges resolve against width), so the
  rule is one sentence to document and matches what consumers already reason
  about. This **overrules** the `imageInset: number // CSS px` proposal in
  `CANVAS_FIRST_CLASS.md`.
- **The letterbox produced by `contain`/`inset` is painted with the page's
  background**, which is `ImagePageSource.background ?? settings.pageBackground`.
  That is what makes G2 and A3 the same change: `contain` _creates_ the
  transparent region that `pageBackground` exists to fill.

**Page-local background, and the sanitise/opacity split.** `CLAUDE.md` requires
that sanitising a background for CSS safety and checking it for opacity stay
**separate jobs**. They do. A descriptor's `background` is accepted only if
**both** hold, checked by their two existing, separately named functions
(`Render/pageBackground.ts`):

```ts
// Descriptor normalisation — runs ONCE per page, not per frame.
function resolvePageBackground(value: string | undefined): string | undefined {
  if (value === undefined) return undefined; // inherit the book's
  if (!isOpaquePageBackground(value)) return undefined; // opacity job
  const safe = safePageBackground(value); // CSS-safety job
  return safe === value.trim() ? safe : undefined; // rejected by sanitiser
}
```

A rejected override falls back to **the book's `pageBackground`**, not to `#fff`
— "override absent" and "override rejected" should land in the same place, and
that place is the book's own paper colour. One `console.warn` per rejected page.
`foldFill` stays the cheap per-frame half, unchanged. No new opacity logic is
written; nothing is collapsed into one function; the translucent-fold regression
that shipped once already has no new route in.

**Where the fit maths lives.** A new pure module `Render/imageFit.ts`, alongside
`geometry.ts`, `bottomPage.ts` and `pageBackground.ts`, exporting

```ts
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitImage(
  fit: ImageFit,
  inset: number,
  pageWidth: number,
  pageHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): FitRect;
```

with `cover` additionally returning the source-rect crop for the nine-argument
`drawImage`. Small, separately exported and unit-testable, which is the pattern
`CLAUDE.md` asks new logic to follow rather than inlining into `ImagePage`. It
must be total: zero or non-finite naturals return the full inset rect rather
than `NaN` (the `Helper.ts` I16/I18 family of lessons).

### Rejected alternatives

- **Book setting only.** Cannot express a full-bleed cover in a `contain` book —
  the downstream cover is `object-cover` while every interior page is
  `object-contain` (`reader-leaves.tsx:94` vs `:124`). This is not hypothetical;
  it is one file.
- **Per-page only.** Forces the setting onto all 500 descriptors of a uniform
  book and makes `updateSettings` useless for it.
- **Keeping `fill` as the default for compatibility.** There is nothing to be
  compatible with; and it is the defect (A3).
- **Adding `scale-down` / `none` now.** CSS has them; nobody has asked; adding a
  union member later is a widening.
- **`inset` as `number | \`${number}px\` | \`${number}%\``.** Two units means two
code paths, two validation rules and two documentation sentences forever, to
serve a px case nobody in evidence needs. Accepting a `px` string later is a
  widening.
- **A per-page `opacity` number.** G2 is about _read-through_, not about fading
  a page. An opacity knob would make the read-through bug expressible again as a
  supported feature.

### Post-publish reversal cost

- Adding fit values, or a `px` inset form: **free**.
- **Changing the default fit: the most visually expensive reversal here.** Every
  existing book's pixels change, silently, with no compile error — a `contain`
  book switched to `cover` starts cropping the folio off pages that shipped
  fine.
- Changing the inset unit from fraction to px: **major and silent** — `0.028`
  would become a 0.028-pixel inset, i.e. nothing, and nothing warns.
- Making `background` book-level only: **major**.

---

## Recommendation — `ImageFlipBook` as a separate React component (D1/F1)

**Recommendation: a separate `ImageFlipBook` export. This is not a taste call —
there are technical reasons — but two of the five are weaker than they look and
are marked as such.**

```ts
// packages/react/src/index.ts
export { HTMLFlipBook } from './HTMLFlipBook';
export { ImageFlipBook } from './ImageFlipBook';
export type { ImageFlipBookProps } from './types';
```

`ImageFlipBook` takes `images: readonly ImagePageSource[]` and **no `children`**;
`HTMLFlipBook` is untouched.

**Technical reasons:**

1. **`HTMLFlipBook` is mostly the portal machinery, and an images book has none
   of it.** `wrapChildren`, the `childNodes` ref, `loadedNodes`/`sameNodes`, the
   `loadFromHTML([])` shell built purely so the portal has a target,
   `createPortal` into `.stf__block`, `HTMLUI.updateItems` adoption, the `inert`
   set for H2 — every one of those is meaningless when the pages are bitmaps in
   a canvas. A `mode` prop makes all of it conditional in a component `CLAUDE.md`
   describes as load-bearing and easy to break, and `AGENTS.md` §4 records
   `NotFoundError` as the symptom when it is broken.
2. **The accessibility trees are different shapes, not different props.** HTML
   mode's a11y _is_ the consumer's real page DOM plus `inert`. Canvas mode needs
   `aria-hidden` on the bitmap plus a visually-hidden semantic mirror built from
   the descriptors' `alt`. Those are two different render outputs from one
   function.
3. **The prop sets are disjoint and half-inert either way.** `lazyRadius` is
   meaningless in canvas mode; `imageLoadRadius`/`imageKeepRadius` are
   meaningless in HTML mode; `children` and `images` are mutually exclusive. Two
   components make each prop set exactly what applies.

**Weaker than they look — stated so nobody leans on them:**

4. _Bundle separation._ The `ImagePageSource` type is type-only and erases, and
   the canvas chunk is already behind a dynamic import policed by
   `scripts/pack-html-engine.mjs`. A merged component would **not** obviously
   drag canvas code into an HTML-only consumer's bundle. Do not cite this.
5. _Type ergonomics._ A discriminated union on `mode` can express
   children-xor-images perfectly well in TypeScript. The problem is the runtime
   branching underneath it, not the types.

**Rejected alternative — grow `HTMLFlipBook`:** its one real advantage is that a
consumer switching an existing book from HTML to images changes one prop instead
of one import. That is a five-second edit, once.

**Reversal cost, which is again what settles it:** merging two components later
is **free** — add `images` to one and re-export the other as a thin wrapper.
Splitting a merged component later is a **major**: removing `mode`/`images` from
`HTMLFlipBook`'s public props. Separate now is the reversible direction.

**Sharing:** do not extract shared hooks up front. Both bindings will want the
engine lifecycle, the live region, keyboard handling and `remountKeyOf`, but
`ImageFlipBook` does not exist yet, and an abstraction derived from one
implementation is a guess. Build it, get it correct in a browser, then extract
what is provably identical.

---

## Consequences and follow-through

- `FlipSetting` gains four canvas-only fields (`imageFit`, `imageInset`,
  `imageLoadRadius`, `imageKeepRadius`, plus `imageCrossOrigin` if the owner
  wants a book-level CORS default). They live in the shared settings object
  rather than a parallel canvas-options object so that `updateSettings`,
  `getSettings` and the refusal-warning path all work unchanged — a second
  settings lifecycle would be more code and a second contract. **The cost is a
  few hundred bytes of validation in the eager HTML graph, which HTML-only
  consumers pay for nothing.** Per `AGENTS.md` §2 that is headroom being spent on
  a feature, and this sentence is the required saying-so; report the measured
  delta in the implementing commit. Document each as "canvas/images mode only".
- New error codes: `INVALID_IMAGE_SOURCE`, `INVALID_IMAGE_INSET`,
  `INVALID_IMAGE_RADIUS`. New event: `imageError`. Both are `MIGRATION.md`
  entries under `AGENTS.md` §3, as is the `string[]` → `ImagePageSource[]` break
  and the `imageFit` default changing the rendered result.
- `ImagePageCollection` grows the window logic and stops calling `page.load()` in
  a loop (G3). `PageCollection.showSpread` gains one call into it.
- Phase 0's pixel probes call `getImageData` on the flipbook canvas, so the e2e
  fixture images **must stay same-origin** or carry `crossOrigin: 'anonymous'` —
  otherwise C7 taints the canvas and the entire Phase 0 harness throws rather
  than failing an assertion.
- Nothing here requires `window`/`document` at module scope; `ImagePageSource` is
  a type, `imageFit.ts` is pure arithmetic, and the descriptor is only realised
  into an `Image()` inside the already-dynamic canvas chunk.

## Questions only the owner can answer

These depend on product facts, not on reading code:

1. **Does canvas mode need to render non-image leaves?** The downstream reader
   has four kinds that are not images: narration-only text pages, blank pads,
   the `EndPage` fallback and the title-only cover fallback. An images-only
   canvas mode cannot render any of them, which means that consumer stays on
   HTML mode and canvas mode's first real user is somebody else. **This
   reframes who canvas mode is for**, and every decision above is written for
   "pre-rendered page images, one bitmap per leaf". If the answer is "canvas must
   also draw text leaves", this ADR needs revisiting before Phase 2, not after.
2. **Will book images ever be served cross-origin?** Today they are same-origin
   (`lib/media-version.ts`); R2 is used for PDFs only. If a CDN move is planned,
   the `imageCrossOrigin` book-level default becomes worth having on day one; if
   not, per-page `crossOrigin` alone is enough and the book-level setting is
   bytes for nobody.
3. **Is `replaceImage` in scope for the first canvas release?** It is the only
   thing that makes `imageError` actionable, and it is modelled on behaviour the
   downstream consumer already ships. But it is public API and a second way to
   mutate the collection.
4. **Publish timing.** Everything above is free to change until the first `npm
publish` and expensive after it. If a publish is imminent, Decision 2's
   promise semantics and Decision 4's default fit are the two to look hardest at,
   because both reverse silently.

## Least-confident recommendation

**Decision 2's promise resolution point.** "Attach plus the initial spread
settled" is a judgement between two defensible positions — attach-only is more
conservative and nearly useless; awaiting everything is impossible under lazy
loading — and it is the one decision in this ADR that reverses _silently_, with
no type change to warn anyone. The hung-request hazard is real and only
mitigated, not removed. If any single item here gets a second opinion, make it
this one.

---

## Addendum — reconciliation with the independent Codex design

Two designs were produced independently against the same brief: this ADR, and a
Codex design round (`gpt-5.6-sol`, high effort). They agree on every load-bearing
decision — descriptors required, `alt` mandatory, bare strings broken now rather
than normalised, a separate image-resource radius, and `ImageFlipBook` as its
own component — which is worth stating, because that agreement is what makes the
rest of this addendum a set of small calls rather than a coin flip.

They disagree on five points. Each is resolved below with the reason, so that a
future reader can see that the alternative was considered by a second designer
and not merely overlooked.

### 1. `crossOrigin` default — RESOLVED IN FAVOUR OF THIS ADR (omit)

Codex argued for defaulting to `'anonymous'`: an origin-tainted canvas
contradicts the first-class canvas contract, and a CDN without CORS headers
would fail loudly through `imageError` instead of appearing to work while
permanently breaking `getImageData()` / `toDataURL()`.

That is a real cost and it is understated in the body above. It is still the
wrong default, because the two failures are not comparable in severity:

- **Tainting** breaks pixel readback. The book renders correctly and every
  reader sees their pages. Only a consumer who reads pixels back is affected,
  and that is a minority of one — our own Phase 0 e2e harness, which can set
  `crossOrigin` explicitly because we own it.
- **`'anonymous'` against a server with no `Access-Control-Allow-Origin`**
  breaks rendering. The image does not load at all. Every reader sees fallback
  artwork where the story should be.

Defaulting to the option that can blank the book, in order to protect a facility
most consumers never use, is the wrong trade. `crossOrigin` is omitted by
default, the taint consequence is documented on the field, and a consumer who
needs readback opts in.

**Reversal cost is asymmetric and favours this direction**: adding a default
later turns working books into failing ones, whereas removing one turns failing
books into working-but-tainted ones. The recoverable direction is the one to
start from.

### 2. Intrinsic `width` / `height` — RESOLVED IN FAVOUR OF CODEX (drop them)

The body above lists them as optional and advisory. Codex is right that they
should not exist at all: `naturalWidth` / `naturalHeight` are authoritative
after decode, canvas pages have no layout shift to prevent, and page dimensions
already come from the book settings. A second caller-declared authority can
disagree with the decoded bitmap and produce wrong `contain` / `cover` geometry
— an advisory field that is only consulted when it cannot be checked.

Dropping them is also the cheap direction: adding optional metadata later is
additive.

### 3. `inset` units — RESOLVED IN FAVOUR OF THIS ADR (fraction, not CSS px)

Codex specified a CSS-pixel inset. The evidence favours a fraction: the
downstream consumer's only real inset is `padding: 2.8%` on a book that is
continuously resized, and a pixel inset does not survive that — it would have to
be recomputed by the consumer on every resize, which is the work the engine
exists to do. A fraction of page width is resolution-independent by
construction.

### 4. Error fallback artwork — RESOLVED IN FAVOUR OF CODEX (draw a glyph)

The body says paper only, with the spinner stopping. Codex's deterministic
vector broken-image glyph is better: a blank leaf is indistinguishable from a
deliberately blank one, and from a book that is still loading. Drawn as Canvas2D
strokes with no text, so core introduces no unlocalizable English string, and
the semantic mirror keeps exposing the descriptor's `alt`.

### 5. Recovery API — BOTH, because they are not the same operation

This ADR proposed `replaceImage(page, source)`; Codex proposed
`retryImage(page)`. They were treated as competing and are not:

- `retryImage(page)` re-attempts **the same URL**. It is the right response to a
  transient network failure, and it is what a "try again" button does.
- `replaceImage(page, source)` swaps in a **different** URL. It is the right
  response to a permanently missing asset, and it is exactly what the downstream
  consumer already does in `BackCoverLeaf`'s `onError` handler.

Neither expresses the other: retrying a 404 fails again forever, and swapping to
recover from a dropped connection needs a URL the consumer does not have. Both
ship, both canvas-only, both throwing `WRONG_MODE` in HTML mode.

### Still blocked on the owner

Nothing above unblocks the one question that matters: **canvas mode as specified
here is images-only, and the downstream consumer's book is not.** Verified in
its own source rather than assumed — `apps/web/lib/book-leaves.ts` defines five
leaf kinds and `renderLeaf` in `reader-leaves.tsx` shows that `inside-cover` and
`pad` draw `<BlankLeaf />`, `front-cover` falls back to a text title when
`coverImage` is null, and `ReaderPage` renders text whenever `page.imagePath` is
absent. An images-only canvas mode cannot draw that book, so either canvas mode
grows non-image leaves (a materially larger Phase 2) or its first real consumer
is somebody else. Every decision in this ADR assumes one bitmap per leaf.

---

## Scope resolved — canvas draws images and blank leaves, and nothing else

**Owner decision, 2026-08-29.** The open question above — whether canvas mode
needs non-image leaves, since the downstream book has four kinds that are not
images — is answered: **images and blank leaves only. No text leaves, no HTML
leaves.**

### Why this is right, and why the alternatives lose

**HTML leaves were measured, not assumed.** `foreignObject` → `drawImage` was
probed in both engines this repo ships against:

|                                                    | Chromium    | WebKit |
| -------------------------------------------------- | ----------- | ------ |
| Renders                                            | yes         | yes    |
| Taints the canvas                                  | no          | no     |
| Cost per leaf (serialize → encode → decode → draw) | ~0.1 ms p90 | ~0 ms  |
| **The page's stylesheet applies**                  | **no**      | **no** |
| **An `<img>` inside the HTML loads**               | **no**      | **no** |

So it works and it is cheap — the common claim that it is broken in WebKit is
wrong. It loses on the bottom two rows. A consumer writes HTML, and it silently
loses their stylesheet and every image inside it: a lookalike that accepts
`<div class="x">` and ignores `x`. That is the same shape of failure as the
portrait back-curl bug this fork exists to remove — it renders, just wrong, and
nothing tells you.

**Text leaves lose on a different axis.** A canvas text API is a text layout
engine: line breaking, font metrics, alignment, vertical centring, overflow,
bidi, shaping. `ctx.fillText` draws one run at one point and provides none of
it. In a package with zero runtime dependencies and a byte budget, it would be a
permanently worse version of what `HTMLRender` already does natively — and text
is exactly where canvas has no advantage to trade for the cost.

**The decisive point is that HTML mode is already first-class.** It renders
text, HTML, images and blank leaves, with real CSS, real fonts, real
accessibility. Canvas exists for what HTML mode does badly: books that are
overwhelmingly images, where a DOM node per page is the cost. A canvas mode that
grew text and HTML would be a second, worse HTML renderer.

**And the bridge already exists in practice.** The downstream consumer's text
pages are not text at run time — its pipeline rasterizes HTML templates to
1600×2400 images with the type baked in
(`apps/web/components/reader/reader-leaves.tsx`). Its text branches are
fallbacks for when rasterization has not run. So "if you need text, give HTML"
is not a workaround there; it is the existing design, and the rasterizer is the
bridge. Any other consumer has the same two honest options — use HTML mode, or
render the page to an image.

### Consequences for this ADR

- **Smaller, not larger.** A blank leaf is a leaf with no bitmap painted with
  the page background, which the renderer already does while an image decodes.
  The leaf model becomes a two-variant union rather than the four-kind rewrite
  that text and HTML would have forced.
- **Modelled as a discriminated union**, not a nullable `src`. `alt` on a blank
  leaf should be `''` — a genuine decorative assertion — and a nullable `src`
  would push a null check into every draw path.
- **The no-text error fallback is now structural, not stylistic.** Codex's
  vector broken-image glyph was chosen so core ships no unlocalizable English
  string. Under images-only there is no text-drawing capability for a string to
  live in at all, which retires the question.
- **A per-leaf `draw(ctx, rect)` escape hatch is DEFERRED, not rejected.** Ten
  lines, and it would let a consumer draw anything without this engine owning a
  text layout engine. It is not shipped because nobody has asked for it, it
  hands consumers a way to stall the render loop, and speculative public API is
  what AGENTS.md §5 exists to prevent. Recorded here as the known escape hatch,
  to be added when someone hits the wall.
