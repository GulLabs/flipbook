# Review of `docs/TRIAGE.md` — consumer advocate

**Reviewed at:** `8867106`, in an isolated worktree.
**Scope:** the triage's ordering, its rejections, its gaps, and the `<FlipPage>`
proposal. Not a re-review of the three source documents.

The triage is good. The principles are stated and then actually applied — the
`INVALID_BOOLEAN` and alias rejections are correct and correctly argued, and
"the pattern worth naming" at the end is the most useful paragraph in the
document. What follows is where I think it is wrong, and it is wrong in three
places: one ordering inversion, one rejection that shoots a strawman, and one
whole class of consumer pain that all three sources missed.

## Verification of the three "already fixed"

All three are genuinely done, not moved:

- **Duplicate inline `<style>`** — gone. `HTMLFlipBook.tsx:1126-1127` now carries
  a comment pointing at `FLIPBOOK_CSS` instead of the rules. Confirmed by grep:
  no `<style>` element remains in the component.
- **B1 `sizing`** — `HTMLFlipBook.tsx:34` (in `ENGINE_SETTING_KEYS`) and `:770`
  (in the settings-effect dependency array). Live.
- **P1 `GeometryAbort`** — wired: thrown at `FlipCalculation.ts:297` and `:318`,
  identity-checked at `:118` (`if (isGeometryAbort(error)) return false;`), so a
  real `TypeError` now propagates. This is the fix as specified.

One note on P1: `GeometryAbort`, `isGeometryAbort` and `GEOMETRY_ABORT` are
exported from `errors.ts` but correctly **not** re-exported from
`packages/core/src/index.ts`. Good — that is principle 3 held. Keep it that way
when the tests for this land; they should deep-import from `../src/errors`.

---

## 1. Is the ordering right?

**No — but the flaw is not which items are where. It is that the list is
sorted on one axis when the work has two.**

The triage's "FIX NEXT — ordered by what a consumer loses" mixes items that
**must land before the version number is frozen** (façade methods, React
re-exports, any change to which CSS properties the engine owns) with items that
can land in any patch release forever (README lines, a recipe, a warning
threshold). Sorting those together forces a false comparison: a README line and
a public method are not competing for the same slot.

Sorted by **when a real adopter feels it**, the order is different from the
triage's:

| Minute | What happens                                                                                                                             | Triage rank                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| ~3     | They style a page — `display: flex` to centre the content, `background` for the paper colour. Both are silently overwritten every frame. | **#4 (understated — see §3)** |
| ~5     | They add a page counter. It reads "of 0".                                                                                                | #2                            |
| ~10    | They type a handler or pass a `corner`. Thirteen names are missing.                                                                      | #3                            |
| ~60    | They build a scrubber or a toolbar and discover `page` is the spread head.                                                               | **#1**                        |

`getVisiblePages()` is ranked first and is felt last. That is not an argument for
demoting it — by principle 4 it is the right first thing to _build_, because it
is the abstraction fix and it is semver-locked. It is an argument for saying so
explicitly, because as written the list reads as "this is what hurts most",
and it isn't.

**Recommended restructure.** Two lists, not one:

**A. Semver-locked (must land before 3.0.0 publish)**

1. `getVisiblePages()` + the façade methods — unchanged, right at the top, for
   the reasons the triage gives.
2. React package re-exports (currently #3).
3. Decide what the engine owns on a leaf root — see §3. If `display` and
   `background-color` come off the engine's list, that is a behavioural change
   and now is the only free moment to make it.
4. `pageLabel` prop (currently buried in #8).
5. B5: delete the `loadFromImages` stubs or keep them — see §2. Deleting is
   semver-locked; keeping is not.

**B. Any-time (docs, warnings, recipes)**

1. "Page 1 of 0" README fix (currently #2) — cheapest high-value item in the
   whole document, should ship today regardless of everything else.
2. The leaf-root styling contract + `<FlipPage>` (currently #4).
3. `usePageFlip` `bookProps` swallowing `onPageChange` (currently inside #8).
4. P2/B3 warning false positive (currently #5).
5. H2 deep-link recipe (currently #6).
6. P3 out-of-band `destroy()` (currently #7).
7. CSP escape, class contract (rest of #8).

**What is ranked too low, concretely:**

- **#8 is a dumping ground and it is hiding a principle-5 violation.**
  `usePageFlip`'s `bookProps` carries `onPageChange`, `onPagesChanged`,
  `onChangeOrientation`, `onLoaded`, `onTurnRejected` (`usePageFlip.ts:172-199`).
  The first thing a product engineer does with a hook like this is add analytics:
  `<HTMLFlipBook {...book.bookProps} onPageChange={track} />`. That compiles,
  runs, tracks correctly — **and silently kills the hook's own state**, so
  `book.page`, `book.canGoNext` and `book.canGoPrev` freeze at their initial
  values. Nothing warns. The buttons stop working and the counter stops moving,
  and the cause is prop order in JSX. That is a silent wrong answer produced by
  the library's nicest API on its most obvious use, and it is currently ranked
  below "no CSP escape". It belongs at the top of list B, and the fix is small:
  an options bag (`usePageFlip(0, { onPageChange, onTurnRejected })`) that the
  hook composes, or at minimum a line in the hook's docblock — which today spends
  thirty lines on design history and never mentions this.

- **`pageLabel` is semver-locked and is inside #8.** It is a new prop on
  `HTMLFlipBook` and it changes what the live region says. `HTMLFlipBook.tsx:200`
  already documents the seam ("when the owner decides on a public page-label API,
  this is the one place that has to consult it"). Adding a prop later is
  non-breaking; changing the _default announcement_ later is not. Decide now.

- **P3 (#7) is ranked about right but described too narrowly.** The triage frames
  it as "out-of-band `destroy()`". The general form is: the binding's guards
  check `!engine` (`HTMLFlipBook.tsx` `runRelative` / `runHandle`) and never
  `engine.isDestroyed()`, so every path that leaves a destroyed engine in
  `engineRef` has the same hole. `isDestroyed()` is public and free; check it.

---

## 2. Challenging the rejections

Five of the six are right. I will be brief on those and long on the one that
isn't.

**Correct, no argument:**

- **Deprecated aliases.** Right, and for the right reason — an alias freezes a
  lie into the `.d.ts` permanently and the old names lied. `MIGRATION.md` is the
  migrator's tool.
- **Unify `WidgetEvent` with the unwrapped React props.** Right. Two audiences.
  The engine's `on()` is `EventEmitter`-shaped and should stay; the React unwrap
  is the better React API. This one is not close.
- **Loosen `INVALID_BOOLEAN` / strict settings.** Right, emphatically. `'false'`
  is a truthy string and every ordinary config source hands over strings
  (`Settings.ts:383-385`). Loosening re-ships the bug. Keep.
- **P4/P5/P6.** Correctly filed as test debt and expected breaks by their own
  author.

**Correct but incomplete — `loadFromImages`:**

The triage rejects "restore `loadFromImages` / an images API". Nobody asked for
that. The examples doc (B5) asked a _different_ question and the triage answered
the one that wasn't live: **delete the stubs, or keep them?** That decision is
still open, it is semver-locked (deleting a method later is breaking), and B5
names a real consumer symptom the triage does not repeat: `loadFromImages`
returns a **rejected Promise** (`PageFlip.ts:660-668`), and upstream
`page-flip` callers routinely invoked it without `await` — so a migrator gets an
**unhandled promise rejection**, which surfaces as a red console error and a
crash-shaped failure, not as "that mode was removed". A migration signpost that
looks like a crash is worse than no signpost.

My vote: **delete both stubs and the `CANVAS_REMOVED` code.** A `TS2339` at
compile time says "this method is gone" more clearly than a runtime rejection
ever will, and the public line is that canvas is gone. If the stubs stay, make
them throw synchronously — an unhandled rejection is the one form the message
cannot survive. Either way, the triage should record the decision rather than
answer an adjacent question.

**Correct but the mitigation is unscheduled — core throws vs React booleans:**

Agree with the rejection: two audiences, the engine throws where a caller can
catch, the binding reports. But the stated remedy is "document the seam, do not
merge it" — and no item anywhere in FIX NEXT is that documentation. A rejection
whose mitigation is a doc needs the doc on the list, or it is a deferral wearing
a rejection's clothes. Put it in list B: one paragraph saying `pageFlip()` is the
engine escape hatch and follows engine rules (throws), while the handle is the
React contract (booleans + `onTurnRejected`).

---

### The rejection that is wrong: P0's framing

The triage rejects the framing of P0 on the grounds that `oklch()` and
`color-mix()` are ordinary 2026 colours and "throwing on them makes the library
the thing that is out of date", and relocates the real bug to `red;position:fixed`
as a CSS-injection vector.

**The premise is right and the conclusion loses the finding.**

Nobody proposed throwing on `oklch()`. Here is what actually happens today, read
off the code:

1. `Settings.resolve` throws only when `!isOpaquePageBackground(background)`
   (`Settings.ts:425`).
2. `isOpaquePageBackground('oklch(0.98 0.02 90)')` → not in `SEE_THROUGH_RE`;
   `functionalAlpha` splits on commas, gets one part, returns `null`; `hexAlpha`
   returns `null`; `alpha === null` → **returns `true`** (`pageBackground.ts:59-65`).
   So construction **does not throw**. It accepts the value.
3. Every frame, `foldFill` → `normalizePageBackground` → `SAFE_CSS_COLOR.test()`
   fails (the regex admits only legacy `#hex` / `rgb[a]()` / `hsl[a]()` /
   bare keywords, `pageBackground.ts:20`) → **returns `#fff`**.

So the consumer writes `pageBackground: 'oklch(0.98 0.02 90)'`, gets **no error,
no warning, and a white fold**. That is not "we throw on modern colours". It is a
silent wrong answer — principle 5, verbatim — and it is exactly what the test
author filed. The reframe rebuts a position nobody held and drops the half that
matters to a consumer.

Worse, the proposed remedy keeps the defect: _"keep the draw-time opaque fallback
for anything whose alpha we cannot statically prove."_ The draw-time fallback
**is** the silent substitution. Making the syntax gate smarter while leaving an
unprovable value to fall back to white means a design-system consumer still gets
white paper and still gets told nothing.

**And the case all three sources missed: `var(--paper)`.** It is the single most
likely value a design-system integrator will pass — that is how a design system
works — and it is _safe_ (a custom property's value cannot inject a declaration;
CSS forbids it), so the injection rewrite does not help it. Today it silently
becomes `#fff`. `SAFE_CSS_COLOR` rejects it at `pageBackground.ts:20`.

**What I would do instead.** Separate the three questions the current code
collapses into one regex:

- **Safety** — the value is interpolated into `cssText`
  (`HTMLPage.ts:241`), so it must not contain a declaration breaker. That is a
  character-class ban (`;`, `}`, `{`, `/*`, `\`, `url(`, `expression(`), not an
  allowlist of colour syntaxes. This is the triage's point and it is correct.
- **Validity** — `CSS.supports('color', value)` already runs in
  `safePageBackground` (`pageBackground.ts:110`) and answers this for every
  syntax including `oklch()` and `color-mix()`. Modern colours pass. Nothing
  needs to be taught about them.
- **Opacity** — this is the one that cannot be statically proven for modern
  syntax, and it is the one the triage proposes to answer silently. Two honest
  options, and it must be one of them:
  - **Prove it at runtime.** One offscreen `CanvasRenderingContext2D.fillStyle`
    round-trip normalises any colour the browser understands to `#rrggbb` or
    `rgba(...)`, giving you the alpha for `oklch`, `color-mix`, `lab`, anything.
    Memoise per string; it runs once per book, not per frame. `var()` still
    cannot be resolved this way — which leads to:
  - **Say so.** For a value whose alpha is genuinely unknowable (`var()`,
    `currentColor` in some contexts), accept it and `console.warn` once:
    _"pageBackground `var(--paper)` cannot be checked for opacity; if it is
    translucent, page content will read through the fold."_ That is a loud
    partial failure, which principle 5 ranks above a silent correct-looking one.

Note the internal inconsistency this exposes, which is the sharpest way to make
the case: **the same function throws loudly for `drawShadow: 'false'` and
substitutes silently for `pageBackground: 'oklch(...)'`.** Two philosophies, one
`Settings.resolve`, twenty lines apart (`Settings.ts:383` vs `:425` → draw-time
fallback). The boolean rejection is right. The colour behaviour should match it.

Finally: `safePageBackground` and `isOpaquePageBackground` are still exported
from `index.ts` (`packages/core/src/index.ts`, the `pageBackground` block). Both
are on the abstraction doc's own "internal, no argument" list. Whatever P0's
resolution, they go.

---

## 3. Missing from the triage entirely

### 3a. The engine owns `display` and `background-color`. Nobody said so.

This is my strongest finding and it makes the triage's item #4 materially
understated.

The triage says: _"the engine legitimately owns `position` / `left` / `top` /
`width` / `height` / `clip-path` on the leaf root."_ Six properties. The actual
list is **fifteen**, at `HTMLPage.ts:28-43`:

```
position, display, z-index, left, top, width, height, background-color,
pointer-events, transform, transform-origin, clip-path, -webkit-clip-path,
backface-visibility, -webkit-backface-visibility
```

Nine of those are layout and are not negotiable. **Two are not layout, and they
are the two a consumer writes first:**

- **`display`.** Every draw path writes `display:block`
  (`HTMLPage.ts:241` and `:361`). So
  `<div style={{ display: 'flex', alignItems: 'center' }}>` — the single most
  common thing anyone does to a page — is silently reverted on the first frame
  and every frame after. The consumer sees their content stuck to the top-left
  and concludes the library does not support flex layout. The engine does not
  actually need `block`: it needs "block-level, not `none`", and `flex`, `grid`
  and `flow-root` all satisfy that identically for its absolute positioning. It
  writes `block` because hiding is done via `.stf__item{display:none}`
  (`styles.ts:18`), so `draw()` must un-hide. Hiding with a class toggle or
  `visibility`/`content-visibility` instead would let the engine stop writing
  `display` at all — and that is a cheap, contained change that removes the most
  visible half of B2.

- **`background-color`.** The opacity invariant requires _something opaque behind
  the leaf content_ — it does not require that it be **this element's**
  `background-color`. As written, `pageBackground` (a per-book setting) beats a
  per-page background the consumer set themselves, and it beats the `background`
  shorthand too, because the engine's `setProperty('background-color', …)`
  (`HTMLPage.ts:68`) lands after the shorthand's longhand in the same block. So
  `<div style={{ background: '#f4ecd8' }}>` — sepia paper on one chapter — does
  nothing, on a library whose README section is titled "Opaque paper". Either
  paint the opaque layer on an engine-owned underlay, or only write
  `background-color` when the leaf has none of its own, or — at absolute minimum
  — **say in the README that per-page background must go on an inner wrapper**,
  which the triage's item #4 currently does not distinguish from the layout
  properties.

The triage's framing, "the engine owning layout is correct and must not change",
is true and is not the whole question. The question it skips is _which properties
are layout_ — and two of the fifteen are not.

### 3b. Server-rendered HTML contains zero page content.

None of the three sources mention this and it is the persona-1 (Next.js) case the
README leads with.

`HTMLFlipBook.tsx:1132` renders `{pageHost ? createPortal(pages.list, pageHost) : null}`,
and `pageHost` is `useState<HTMLElement | null>(null)` (`:426`) populated only by
the mount effect. So on the server the component emits the root `<div>`, the
controls and the live region — **and none of the pages**. The book's content does
not exist in the SSR HTML at all.

For a picture book that is defensible. For a magazine, a manual, a document
reader — the things people build with this — it means the content is not
indexable, not readable before hydration, and not present for a no-JS reader.
The repo knows the shell is a placeholder (`examples/nextjs/app/page.tsx:55`
prints `ssr`/`hydrated`) and the README advertises the example as
"SSR placeholder → hydrate" as though the placeholder were the feature.

I do not think there is a cheap engine fix — the portal target cannot exist
before mount, and rendering children in place and then moving them is exactly the
React/DOM ownership conflict `CLAUDE.md` warns about. So the ask is honest
documentation, not code: **name it as a limitation in the README and in the
Next.js example**, and tell consumers who need indexable content to render their
own SEO copy alongside. A limitation a consumer discovers from a Lighthouse
report two weeks in is much more expensive than one they read on day one.

### 3c. Smaller, still missing

- **No version marker.** No `getVersion()`, no `data-flipbook-version` on the
  root. For a library that lives inside other people's design systems it is the
  first thing a support thread needs, and it costs one line. This was in my
  round-1 §C10 and did not survive into the triage.
- **The `dir`/`lang` gap for RTL** (round-1 §3d) also did not survive. `readingDirection: 'rtl'`
  mirrors turns but the root gets no `dir`, and the live region gets no `lang`,
  so an Arabic announcement is read by an English voice. Minor, but it is on the
  a11y surface this project has otherwise invested heavily in.

---

## 4. The `<FlipPage>` idea

**The shape is right. The reasoning under it is a plaster, and there is a better
version of the same idea.**

Three separate things are being conflated:

1. **Documenting "style an inner wrapper, not the leaf root"** — necessary
   regardless, ship it today. No argument.
2. **Shipping `<FlipPage>` as an optional convenience** — this is the weak
   version. An optional component does not prevent the failure; a consumer who
   never reads the docs writes `<div>` and hits it anyway. It buys the docs
   something to point at, at the cost of a new public component with props, a
   ref-forwarding contract and a styling contract of its own — permanent surface
   for a problem prose already solves.
3. **Fixing which properties the engine owns** — §3a. `display` should come off
   the list. That is not a plaster, it is the actual defect, and it is the half
   the triage does not consider because its list of engine-owned properties is
   missing the two that matter.

So: do (1) now, do (3) before publish, and treat (2) on its own merits.

**On its own merits, `<FlipPage>` is stronger than the triage argues — for a
reason the triage does not give.** It collapses item #4 into item #5. The P2/B3
problem is that a page child must be a host element that forwards its ref, which
is an unusual rule, which is why the binding needs a mount warning
(`HTMLFlipBook.tsx:607-621`) that currently false-positives on the very pattern
the docs recommend. A `<FlipPage>` that forwards its own ref makes that rule
disappear by construction: the recommended shape is one the consumer cannot get
wrong, the warning becomes "use `<FlipPage>`" instead of a heuristic about
`typeof child.type`, and the false positive stops being a problem to solve.

That argument only works if `<FlipPage>` is **the documented default**, not an
optional extra. My recommendation:

- Ship `<FlipPage>`; make it the shape every example and the README use.
- Keep bare host elements working (the drop-in story needs them) — so it is
  recommended, not required.
- Point the P2/B3 warning at it: _"page child N is a component; wrap it in
  `<FlipPage>` or forward its ref to a host element."_
- Have it render `<div>` with the consumer's `className`/`style` on an **inner**
  node and nothing on the root — so §3a's `display` and `background-color`
  problems cannot be reached through the recommended path even before the engine
  change lands.

What `<FlipPage>` must **not** be is a reason to leave `display:block` on the
engine's list. Those are independent: the component protects consumers who use
it, and the engine change protects everyone else.

---

## Summary of asks

1. **Split FIX NEXT into semver-locked and any-time.** The current single
   ordering makes a README line compete with a public method.
2. **Promote `usePageFlip` `bookProps` prop-swallowing out of #8.** It is a
   principle-5 violation on the library's nicest API's most obvious use.
3. **Reopen P0's framing.** The premise (accept modern colours) is right; the
   conclusion drops a silent-wrong-answer bug and the proposed remedy keeps it.
   Add `var(--token)`. Fix the inconsistency with the boolean throw twenty lines
   away.
4. **Record a decision on the `loadFromImages` stubs.** Semver-locked, and an
   unhandled rejection is a crash-shaped migration message.
5. **Correct item #4's list of engine-owned properties from six to fifteen**, and
   take `display` (and ideally `background-color`) off it.
6. **File the SSR-empty-book limitation**, at least as documentation.
7. **Schedule the "core throws vs React booleans" doc** that the rejection
   depends on.
