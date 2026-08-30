# The public/internal boundary, and the renderer abstraction

My own analysis, written before the consumer expert and Codex report so their
findings can be reconciled against it rather than blurred into it. Where they
disagree, that disagreement is worth more than my confidence.

## Two arguments I have to stop making

**"There are no consumers yet."** This is a statement about how cheap a change
is, never about whether it is right. It has crept into three of my
recommendations today and the owner has now called it out twice. A public
library has consumers the day after launch; the question is always what the
abstraction _should_ be.

**"It is not well tested."** I argued against the `Render` seam partly by noting
that its only other implementation sat near 5% coverage. That is an argument
about our past diligence, not about whether the seam is shaped right. Untested
code gets tested. A wrong abstraction stays wrong.

Both are struck from what follows.

## The principle

A symbol belongs in the public API if a consumer needs it to do something the
library is _for_, and the library intends to keep it working. Everything else is
internal — regardless of whether it is useful, whether it happens to be
exported today, or whether our tests find it convenient.

**Testability never justifies a public export.** Vitest already aliases the
package name to `src`, and tests can deep-import `../src/geometry` and always
could. Publishing an algorithm so a test can name it conveniently converts a
convenience into a compatibility promise, which is a bad trade at any price.

## What the core package exports today

`packages/core/src/index.ts` is the whole public API — the `exports` map blocks
deep imports, so that file is the contract. Four categories, of which one was
designed.

### 1. The façade and its data — PUBLIC, uncontroversial

`PageFlip`; the settings types; `PageFlipError` + its code and kind unions; the
event types (`WidgetEvent`, `FlipbookEventMap`, `BookSnapshot`, `TurnRejected`);
the enums a consumer reads off events (`Orientation`, `FlippingState`,
`FlipCorner`, `PageDensity`, `PageOrientation`); `Point` / `Rect` / `PageRect`;
`ensureFlipbookStyles` and `FLIPBOOK_CSS`;
`FLIPBOOK_INTERACTIVE_SELECTOR` / `isInteractivePointerTarget`.

These are the vocabulary of using a book. They stay.

### 2. Internal algorithms — INTERNAL, no argument

`convertPageToGlobal`, `portraitCurlLocal`, `curlGoesLeft`,
`backCurlAppearsRight`, `FLIP_DIR_FORWARD`, `FLIP_DIR_BACK`,
`getPortraitFlippingPage`, `shouldDrawBottomPage`, `safePageBackground`,
`isOpaquePageBackground`, `effectiveFlippingTime`, `prefersReducedMotion`.

These are how the engine computes a fold. A consumer calling
`portraitCurlLocal` is not using the library, they are reimplementing it. They
were published so unit tests could import them by package name, which is the
convenience-as-contract mistake above.

**Remove all of them.** Tests deep-import from `../src/`. `Curl` / `CurlCorner`
stay as types only if a public signature needs them.

### 3. Implementation classes — the real question

`Render`, `HTMLRender`, `Page`, `HTMLPage`, `PageCollection`,
`HTMLPageCollection`, `Flip`, `Settings`.

These are exported because the façade's getters return them. So the question is
not "should these be exported" but **"should those getters exist"** — which is
section 4.

### 4. The collaborator getters — where the abstraction actually leaks

`getRender(): Render`, `getUI(): UI`, `getPageCollection(): PageCollection`,
`getFlipController(): Flip | null`, `getPage(i): Page`.

**The tell:** `getUI()` returns `UI`, and `UI` is not exported at all. A
consumer cannot name the return type of a public method. Nobody chose that; the
list accreted.

**The evidence, from the product rather than from usage.** Our own React
binding is the most demanding consumer that will ever exist, and it needs
exactly four things from those five getters:

| What it reaches for                                                        | What it actually wants                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| `getUI().getDistElement()`                                                 | the DOM element leaves live in                           |
| `getFlipController() !== null`                                             | is the engine ready?                                     |
| `getPageCollection().getSpreadIndexByPage(p)` + `.getCurrentSpreadIndex()` | is page `p` currently visible?                           |
| —                                                                          | which leaves are visible (**it cannot get this at all**) |

That last row is the diagnosis. `PageCollection.getSpread()` is `protected`, so
the binding **reimplements the engine's spread rules** in its own
`spreadPages()` — portrait is one leaf, landscape pairs, the cover stands alone.
Duplicated logic drifts, and it already has: **MIN-A this session**, where
`usePageFlip.canGoNext` got the `hardCovers` case wrong because it had its own
copy of a rule the engine owns.

So the façade hands out collaborators instead of answers, consumers reach
through them for two methods, and then duplicate a third rule they still cannot
reach. That is a leak diagnosed structurally, and it is the thing to fix.

**Proposed shape.** Replace the getters with methods that answer the real
questions:

| New façade method                        | Replaces                                                                | Why it is the right shape                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `getVisiblePages(): number[]`            | the `getSpreadIndexByPage` dance **and** the duplicated `spreadPages()` | "which leaves am I looking at" is a first-class question for any reader UI — page counters, thumbnails, analytics, a11y announcements |
| `getBlockElement(): HTMLElement`         | `getUI().getDistElement()`                                              | portalling into the book is a legitimate integration need                                                                             |
| `isReady(): boolean`                     | `getFlipController() !== null`                                          | readiness is a state, not an object                                                                                                   |
| `canTurn(direction): boolean`            | consumers deriving it from indices                                      | the boundary rule is spread-based and the engine owns it; every consumer that derives it gets landscape wrong, as ours did            |
| `getPageElement(i): HTMLElement \| null` | `getPage(i)`                                                            | the only thing `Page` is reached for                                                                                                  |

With those, **`getRender` / `getUI` / `getPageCollection` / `getFlipController` /
`getPage` can all disappear** — and with them the reason to export `Render`,
`UI`, `PageCollection`, `Flip` and `Page` at all. Not as values, not as types.
The classes become genuinely internal because nothing public mentions them.

That is a stronger and simpler answer than my earlier "export them as types":
type-only exports were a way to keep a leaky signature compiling. Fixing the
signature removes the need.

## Render + HTMLRender: collapse, and why

The test for a good abstraction is not "does it have one implementation today" —
plenty of good interfaces start with one. It is **"could a genuinely different
implementation satisfy it?"**

Measured against the code rather than the intent:

`Render` is 1,277 lines; `HTMLRender` is 355. The _abstract base_ holds ~78% of
the renderer, and what it holds is DOM-specific: `computeBounds` measures
`offsetWidth` off a DOM element, there is a `navigator.userAgent` sniff and an
`isSafari()` clip-path workaround, and `convertToGlobal` works in CSS pixels.
Two abstract methods against roughly forty concrete ones.

So a WebGL renderer extending `Render` would inherit DOM measurement, a Safari
CSS workaround, and pixel-space conversion — and would have to override or fight
nearly all of it. **It is not an abstraction over rendering. It is one renderer
split in half at an arbitrary line.** That is a design judgement about the
interface's shape, independent of tests.

`docs/WEBGL_RENDERER.md` reaches the same place by a different route and I
believe it is right: what a second renderer needs is the spread and index model,
a normalised flip progress with direction and corner, and a commit signal —
which is `PageCollection` plus a progress signal, not a `Render` subclass.

**Collapsing is reversible; publishing is not.** Merging two classes into one
destroys no information — the seam can be re-cut anywhere later, and cut in the
right place once a second consumer says where that is. Shipping an extension
point, by contrast, is a promise you cannot withdraw without breaking someone.
Given a choice between two reversible-in-principle errors, take the one that
does not create a public commitment.

**Per pair, judged separately** (my view, pending the reviewers):

- **`Render` / `HTMLRender` — collapse.** The base is DOM-bound; the split is
  arbitrary.
- **`UI` / `HTMLUI` — collapse.** Same shape: the base holds the host element,
  the wrapper, the pointer handlers; the subclass adds leaf adoption.
- **`Page` / `HTMLPage` — collapse, with a caveat.** This split is the most
  defensible of the four — the base is logical leaf state, the subclass its DOM
  realisation — but a single realisation makes it theory, and the state is
  small enough to stay cohesive in one class.
- **`PageCollection` / `HTMLPageCollection` — collapse, despite being closest to
  the right seam.** An abstract collection whose only variation is which page
  class it constructs is _not_ the headless controller the WebGL analysis
  identifies. Keeping it preserves the shape of an answer without the answer.
  Extract the controller deliberately when there is a second consumer to shape
  it.

**What "extensible" then means here.** Not "you may subclass our renderer" — an
extension point nobody can successfully use is worse than none, because it
absorbs the effort of whoever tries. It means: a small, honest façade; an engine
whose internal seams we can move freely because nothing depends on them; and a
real controller extracted when a second renderer exists to tell us its shape.
