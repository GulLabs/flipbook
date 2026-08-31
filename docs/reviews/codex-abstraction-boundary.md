RECOMMENDATION: Collapse all four abstract/concrete inheritance pairs now, preserve `PageCollection` as a concrete internal book-model module, do not treat the current `Render` hierarchy as the future renderer plug-in seam, and reduce the core root to `PageFlip`, `PageFlipError`, and type-only facade contracts.

# Codex abstraction-boundary decision

This decision is pinned to `ccaefe81f0753c69ff0179487e4ea8b06c921785`.
The live worktree advanced beyond that commit and contained concurrent product
edits, so all source citations below refer to the requested commit, not the
worktree. The evidence scope is `packages/*/src` only. No test file or test
result was used.

## Part 1 — collapse the inheritance pairs

The decisive criterion is not line count or whether inheritance is aesthetically
pleasing. It is whether each base class is a truthful seam: can another adapter
satisfy it without inheriting assumptions that belong to HTML's particular
rendering model? On that test, all four class pairs should collapse. They do not,
however, fail in the same way.

| Pair                                    | Decision                                                                                           | Judgment                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Render` / `HTMLRender`                 | Collapse the inheritance; retain scheduler/layout logic as internal modules.                       | A plausible seam for another _planar clip-polygon_ renderer, but not a valid general renderer seam. |
| `UI` / `HTMLUI`                         | Collapse.                                                                                          | A DOM host/input implementation divided into “DOM” and “more DOM,” not a renderer abstraction.      |
| `Page` / `HTMLPage`                     | Collapse.                                                                                          | The weakest seam: its substitution promise is already false inside the HTML implementation.         |
| `PageCollection` / `HTMLPageCollection` | Collapse the subclass hook, but preserve the collection/model as its own concrete internal module. | The domain abstraction is valuable; overriding `load()` is not the right seam.                      |

### `Render` / `HTMLRender`: useful implementation, wrong seam

The strongest case for keeping this pair is real. `Render` owns substantial,
cohesive behavior: frame scheduling and animation ownership
(`packages/core/src/Render/Render.ts:277-354,481-688`), bounds and orientation
(`packages/core/src/Render/Render.ts:693-815`), and coordinate conversion
(`packages/core/src/Render/Render.ts:1115-1245`). `HTMLRender` supplies DOM
shadows and the final paint pass
(`packages/core/src/Render/HTMLRender.ts:18-79,295-354`). A second Canvas or SVG
implementation of the same flat-fold model is conceivable. It is therefore too
strong to say this base class could _never_ have a second subclass.

That does not make it the clean extensibility seam. The real subclass contract
is much larger than its two abstract methods, `drawFrame()` and `reload()`
(`packages/core/src/Render/Render.ts:254-270`). A subclass inherits protected
mutable left/right/flipping/bottom pages, fold direction, shadow state and a
page polygon (`packages/core/src/Render/Render.ts:114-149`), then participates in
the imperative setter protocol at
`packages/core/src/Render/Render.ts:1016-1107`. It also inherits browser/HTML
assumptions: host measurement reaches back through
`getUI().getDistElement().offsetWidth/offsetHeight`
(`packages/core/src/Render/Render.ts:949-957`), and the base carries a WebKit
feature decision consumed by HTML page drawing
(`packages/core/src/Render/Render.ts:1124-1126`;
`packages/core/src/Page/HTMLPage.ts:338-349`).

Most importantly, the protocol has already chosen the deformation model before
the renderer sees it. `Flip` mutates page position, polygon area, angle and
hard-page angles, then separately supplies shadow state
(`packages/core/src/Flip/Flip.ts:406-462`). That is a flat 2D fold scene. A
skinned WebGL mesh wants semantic turn state from which it derives bone
deformation; implementing this class would require it to pretend CSS-style
polygons and page mutations are its native inputs.

So the class abstraction is bad even though much of its implementation is good.
Merge the hierarchy into an honestly named internal HTML renderer, while
keeping animation scheduling and layout in private/composed modules where that
preserves locality. “Collapse” must not mean concatenating everything into one
undifferentiated class.

### `UI` / `HTMLUI`: not renderer-neutral at all

`UI` describes itself as DOM work, stores `HTMLElement`s, creates the wrapper,
injects browser styles, observes resize APIs and owns Pointer Events
(`packages/core/src/UI/UI.ts:20-39,91-140,341-395`). Its only abstract public
operation is `update()`; the other subclass hook exists to release adopted DOM
nodes (`packages/core/src/UI/UI.ts:283-303`). `HTMLUI` adds `.stf__block`, adopts
and restores consumer nodes, and forwards resize updates to the renderer
(`packages/core/src/UI/HTMLUI.ts:67-90,120-188,198-259`).

A WebGL renderer may also live in a browser and may reuse host measurement or
pointer normalization. That supports future composition such as a
`BrowserHost` and an `InputController`; it does not support `WebGLUI extends UI`.
The present inheritance varies node adoption/surface construction while
hard-wiring everything else to the DOM. Collapse it.

### `Page` / `HTMLPage`: a false substitution boundary

`PageState` is not renderer-neutral page data. It is a 2D render command:
polygon area, position, angle and two hard-page angles
(`packages/core/src/Page/Page.ts:11-26`). The abstract operations are drawing,
loading and making/hiding a temporary visual copy
(`packages/core/src/Page/Page.ts:43-89,193-199`). `HTMLPage` realizes those
operations through cloned DOM nodes, CSS transforms and clip polygons
(`packages/core/src/Page/HTMLPage.ts:110-181,196-370`).

The decisive evidence is that the sole renderer does not honor the abstraction.
`HTMLRender` repeatedly casts `Page` to `HTMLPage` to call `getElement()`
(`packages/core/src/Render/HTMLRender.ts:243-245,265-267,290,307-309,327-340`).
The types permit another `Page` implementation, but the running HTML renderer
would fail when handed one. That is not an extensibility seam; it is a false
promise. Collapse it. A later renderer-neutral leaf model should carry identity,
source/resource metadata and material semantics, not mutable CSS-fold state.

### `PageCollection` / `HTMLPageCollection`: keep the model, remove the subclass

This pair contains the best abstraction of the four. `PageCollection` owns the
difficult domain behavior: building portrait and landscape spreads
(`packages/core/src/Collection/PageCollection.ts:134-205`), resolving membership
and bounds (`packages/core/src/Collection/PageCollection.ts:210-265`), selecting
the mover and underside (`packages/core/src/Collection/PageCollection.ts:301-341`),
and committing navigation (`packages/core/src/Collection/PageCollection.ts:347-410`).
That logic should remain concentrated.

The inheritance hook adds almost no leverage. `HTMLPageCollection` only turns
elements into `HTMLPage`s and invokes `createSpread()`; its stored `element` is
otherwise unused (`packages/core/src/Collection/HTMLPageCollection.ts:14-43`).
Loading is a factory/input concern masquerading as a collection subtype.

Nor is the base currently headless. It stores `PageFlip`, `Render` and mutable
`Page` objects (`packages/core/src/Collection/PageCollection.ts:26-49`), asks the
renderer which spread table applies (`packages/core/src/Collection/PageCollection.ts:210-213`),
and pushes page objects into renderer slots while emitting through the facade
(`packages/core/src/Collection/PageCollection.ts:415-545`). The correct immediate
shape is a concrete internal collection supplied with already-created leaves (or
an internal leaf factory), not an abstract collection with an HTML `load()`
override. The later headless extraction should separate its pure spread/index
model from those renderer effects.

## Attack on `WEBGL_RENDERER.md`

The document's principal conclusion is correct: a WebGL renderer should not
implement the current `Render`, and a renderer contract should be extracted only
when a second real adapter exists (`docs/WEBGL_RENDERER.md:65-98`). The supporting
argument needs two corrections.

First, “DOM-shaped to the bone” overstates the evidence. `Render` does not
assemble `cssText`; that code lives in `HTMLRender` and `HTMLPage`
(`packages/core/src/Render/HTMLRender.ts:92-104,151-179,202-229`;
`packages/core/src/Page/HTMLPage.ts:196-241`). Polygon geometry is flat-fold
renderer-shaped, not inherently DOM-shaped; Canvas and SVG can consume polygons.
`convertToGlobal` and `setPageRect` are coordinate/scene operations rather than
DOM operations (`packages/core/src/Render/Render.ts:1016-1020,1159-1173`). The
real defect is narrower and stronger: `Render` is shaped around one _planar
deformation protocol_. WebGL needs a different scene representation.

Second, “`PageCollection` plus a progress signal” is not yet a sufficient seam.
The current collection is renderer-coupled, as shown above. A scalar also omits
facts both adapters need to agree on: source and destination spreads; mover and
underside leaf identity; semantic next/previous direction versus physical fold
side; corner; hard/soft behavior; drag, settle, cancellation and commit phase;
turn identity for re-entrancy; and resource lifetime. Current progress is passed
as part of optional shadow state (`packages/core/src/Render/Render.ts:826-865`),
which cannot become the rendering contract.

The right eventual seam is an immutable headless frame, approximately:

```ts
type TurnFrame = Readonly<{
  turnId: number;
  phase: 'idle' | 'dragging' | 'animating' | 'committing' | 'cancelled';
  sourceSpread: readonly number[];
  destinationSpread: readonly number[];
  visiblePages: readonly number[];
  direction: 'next' | 'prev';
  foldSide: 'left' | 'right';
  corner: 'top' | 'bottom';
  progress: number;
  pageSize: Readonly<{ width: number; height: number }>;
  orientation: 'portrait' | 'landscape';
}>;
```

The headless controller, not a renderer callback, must own commit/cancel and
publish the resulting atomic book snapshot. The HTML adapter can derive clip
polygons and CSS from the frame; a WebGL adapter can derive bones and materials.
The exact shape should remain internal until a working second renderer proves
which information is actually common.

### Collapsing is reversible

No necessary future-renderer information lives in the abstract keywords. The
current abstract slots say only “draw/reload,” “update,” “draw/load/copy,” and
“load”; they do not encode the requirements of a second renderer. The useful
information is the implementation itself: spread rules, turn planning,
animation ownership, flat-fold geometry, DOM ownership and input behavior. All
of that remains after collapse, and the WebGL analysis records why it must not
be mistaken for a universal renderer contract.

The reversible path is:

1. Collapse the speculative inheritance while retaining coherent internal
   modules and direct dependencies.
2. Prototype the second renderer against real pages outside the public core
   contract.
3. Extract a pure `BookModel` from the collection's spread/index logic and a
   `TurnController` from turn selection, gesture/animation ownership and
   commit/cancel behavior.
4. Have that controller publish immutable book snapshots and turn frames.
5. Make DOM and WebGL separate adapters over that seam.
6. Consider publishing the renderer interface only after both adapters make the
   contract factual.

The one irreversible mistake would be a naive merge that interleaves collection
policy, animation scheduling, pointer input and DOM painting. The recommendation
is to remove subclass contracts, not module locality.

## Part 2 — the core public/internal boundary

`packages/core/src/index.ts:5-55` currently mixes the facade, constructible
implementation objects, renderer state tokens, pure algorithms, browser policy
and CSS machinery. A consumer should learn the page-flip module, not the object
graph that implements it.

### Recommended root exports

#### Runtime values — keep exactly two

- `PageFlip`: the constructible operational facade. It owns settings resolution
  and constructs the HTML mode itself
  (`packages/core/src/PageFlip.ts:167-173,688-705`).
- `PageFlipError`: consumers need its runtime identity for `instanceof`; its
  `code`, `kind`, `setting` and `cause` are supported diagnostics
  (`packages/core/src/errors.ts:73-117`).

`SizeMode`, `FlipCorner`, `FlippingState` and `Orientation` should remain public
vocabulary, but as type-only literal unions, not runtime namespace objects.
Callers can pass or compare `'responsive'`, `'bottom'`, `'flipping'` and
`'portrait'`. The type exports retain autocomplete, narrowing and exhaustive
switches without promising enumerable runtime objects and their member names.

#### Type-only exports — keep facade contracts

- Configuration: `FlipOptions`, `LiveSetting`, `FlipSetting`, `SizeMode`,
  `ReadingDirection`, `FlipOnClick`, `PointerKind`
  (`packages/core/src/Settings.ts:15-43,59-178`). `FlipSetting` should describe a
  readonly resolved snapshot; `ResolvedFlipSettings` would be the more honest
  name if a rename is still available.
- Navigation and observable state: `FlipCorner`, `FlippingState`, `Orientation`,
  plus a public `TurnDirection = 'next' | 'prev'` for the snapshot/query surface
  (`packages/core/src/Flip/enums.ts:13-26`;
  `packages/core/src/Render/Render.ts:81-88`).
- Errors and events: `PageFlipErrorCode`, `PageFlipErrorKind`, `WidgetEvent`,
  `FlipbookEventMap`, `FlipbookEventName`, `BookSnapshot`, `TurnRejected`,
  `TurnRejectedReason` (`packages/core/src/errors.ts:21-50`;
  `packages/core/src/Event/EventObject.ts:20-114`).
- Facade geometry: `PageRect`, returned by `getBoundsRect()`
  (`packages/core/src/BasicTypes.ts:38-47`).

These types let a TypeScript consumer describe supported inputs and observations.
They do not create constructors, `instanceof` identities or subclass points.

#### Remove entirely — not even type-only

- Implementation graph: `Settings`, `Flip`, `Render`, `HTMLRender`, `Page`,
  `HTMLPage`, `PageCollection`, `HTMLPageCollection`, and `UI` (do not add it to
  repair `getUI`).
- Internal direction/render tokens: `FlipDirection`, `PageDensity`,
  `PageOrientation`, `ALL_POINTERS`.
- Geometry algorithms and their helper types/constants: `convertPageToGlobal`,
  `portraitCurlLocal`, `curlGoesLeft`, `backCurlAppearsRight`,
  `FLIP_DIR_FORWARD`, `FLIP_DIR_BACK`, `Curl`, `CurlCorner`, `Point`, `Rect`,
  `RectPoints`, `Segment`.
- Selection/draw policy: `getPortraitFlippingPage`, `shouldDrawBottomPage`.
- Background and motion policy: `safePageBackground`,
  `isOpaquePageBackground`, `DEFAULT_PAGE_BACKGROUND`,
  `effectiveFlippingTime`, `prefersReducedMotion`.
- DOM implementation policy: `ensureFlipbookStyles`, `FLIPBOOK_CSS`,
  `FLIPBOOK_INTERACTIVE_SELECTOR`, `isInteractivePointerTarget`.

`PageDensity` is meaningful internally, and HTML currently reads the literal
`data-density="hard"` (`packages/core/src/Collection/HTMLPageCollection.ts:30-36`).
It still does not occur in a supported facade signature. If a later typed leaf
descriptor makes density a real input, publish a semantic density type then;
do not publish the mutable `Page` machinery now in anticipation of it.

Type-only is not a harmless compromise for implementation collaborators. It
would foreclose runtime construction and `instanceof`, but it would still freeze
their structural contracts and invite consumers to implement or depend on them.
Those names should disappear, not move from value exports to type exports.

### Testability does not justify public exports

The owner's position is correct without qualification. Repository tests are
privileged callers and can import source modules directly; a package-root export
is a consumer compatibility promise. Product code already demonstrates that the
listed helpers are implementation policy: `convertPageToGlobal` is consumed by
`Render` (`packages/core/src/Render/Render.ts:14,1169-1173`),
`portraitCurlLocal` by `Flip` (`packages/core/src/Flip/Flip.ts:14,255`),
`getPortraitFlippingPage` by the collection
(`packages/core/src/Collection/PageCollection.ts:18,301-305`), and
`shouldDrawBottomPage` by `HTMLRender`
(`packages/core/src/Render/HTMLRender.ts:12,281-293`). Exposing them makes an
implementation choice public; it does not make the product more testable.

The same conclusion covers helpers with no current product caller. An unused
helper is not made into a consumer capability by exporting it from the barrel.

### Remove all five collaborator getters

All five expose mutable implementation objects instead of supported outcomes
(`packages/core/src/PageFlip.ts:1327-1354,1383-1410`). They should disappear.

1. **`getRender()` — no replacement collaborator.** `getBoundsRect()` and
   `getOrientation()` already expose the legitimate layout results
   (`packages/core/src/PageFlip.ts:1356-1372`); `getState()` exposes meaningful
   controller state (`packages/core/src/PageFlip.ts:1393-1400`). Renderer
   cancellation, page setters and coordinate machinery remain internal.
2. **`getUI()` — replace with `getPageContainer(): HTMLElement`.** The real
   cross-package need is the DOM element into which leaves are rendered. React's
   only use is `engine.getUI().getDistElement()` to obtain its portal target
   (`packages/react/src/HTMLFlipBook.tsx:720-726`), while `getDistElement()` merely
   returns that element (`packages/core/src/UI/UI.ts:308-310`). Expose the
   capability directly and document that consumers may mount leaves there but
   must not replace engine-owned structure. Exporting `UI` merely to make the
   current return type nameable would enlarge the mistake.
3. **`getPageCollection()` — replace with authoritative immutable state.** Add
   `getSnapshot(): Readonly<BookSnapshot>` and expand the event snapshot from its
   current `{ page, pageCount, orientation }`
   (`packages/core/src/Event/EventObject.ts:20-25`) to include the logical current
   spread and spread-correct turn availability:

   ```ts
   interface BookSnapshot {
     readonly page: number;
     readonly pageCount: number;
     readonly orientation: Orientation;
     readonly visiblePages: readonly number[];
     readonly canTurn: Readonly<Record<TurnDirection, boolean>>;
   }
   ```

   `visiblePages` means the committed logical spread, not every transient visual
   participating in an animation. React currently duplicates spread construction
   (`packages/react/src/HTMLFlipBook.tsx:166-190`) and reaches into the collection
   to decide whether a controlled target is already on screen
   (`packages/react/src/HTMLFlipBook.tsx:927-943`). `usePageFlip` separately
   re-derives turn bounds from leaf arithmetic
   (`packages/react/src/usePageFlip.ts:63-87`). Those are domain rules escaping
   because the facade withholds their result. The engine already has the exact
   spread-bounded predicate (`packages/core/src/Flip/Flip.ts:974-987`).

4. **`getFlipController()` — delete with no replacement.** Commands already live
   on `PageFlip`; state already has `getState()`. React uses controller existence
   only as a loaded sentinel and immediately checks page count
   (`packages/react/src/HTMLFlipBook.tsx:920-925`). Readiness belongs to
   `ready`/`loaded` and command results, not collaborator reachability.
5. **`getPage()` — replace with `getPageElement(index): HTMLElement`.** The real
   HTML capability is the caller-owned leaf element. Returning `Page` instead
   exposes drawing and geometry mutation (`packages/core/src/Page/Page.ts:72-199`),
   while the HTML implementation's useful capability is simply `getElement()`
   (`packages/core/src/Page/HTMLPage.ts:370-372`).

Keep `getPageCount()`, `getCurrentPageIndex()`, `getOrientation()` and
`getState()` as ergonomic projections of the authoritative snapshot. They expose
domain facts, not collaborators.

Two existing value getters also need defensive boundaries:

- `getBoundsRect()` currently returns the renderer's cached object
  (`packages/core/src/Render/Render.ts:974-992`;
  `packages/core/src/PageFlip.ts:1370-1372`). Return a copied
  `Readonly<PageRect>` so a caller cannot mutate renderer geometry.
- `getSettings()` returns the live settings object
  (`packages/core/src/PageFlip.ts:1374-1381`), which `updateSettings()` later
  mutates in place (`packages/core/src/PageFlip.ts:889-905`). Return a copied
  `Readonly<FlipSetting>` so assignment cannot bypass validation and live-update
  rules.

### Close the remaining facade-shaped internal seams

Pruning the barrel is necessary but insufficient because every public member of
`PageFlip` remains part of the class contract. `getBlock()`, `replacePages()` and
`attachMode()` explicitly describe themselves as internal wiring while remaining
public (`packages/core/src/PageFlip.ts:337-460`). Move them behind private or
module-private capabilities as part of the collapse.

The raw `startUserTouch()` / `userMove()` / `userStop()` trio is likewise used by
the one internal DOM input implementation
(`packages/core/src/UI/UI.ts:688-698,700-736,739-782`). Its `Point` plus `isTouch`
protocol is not a designed external input adapter. Internalize it now. If a real
second input adapter appears, extract a named input seam from both callers rather
than treating today's UI-to-engine wiring as public by accident.

Finally, replace internal service-location through the facade while collapsing:
`UI` reaches `getRender()` (`packages/core/src/UI/UI.ts:247-250`), `Render`
reaches `getUI()` (`packages/core/src/Render/Render.ts:949-957`), and
`HTMLRender` reaches `getPageCollection()`
(`packages/core/src/Render/HTMLRender.ts:327-340`). Direct private collaboration
will let the public getters disappear for real instead of merely disappearing
from documentation.

## Final decision

The clean design is one deep public module: `PageFlip` accepts configuration and
leaves, owns navigation/lifecycle/events, and exposes immutable book state plus
the two intentional DOM capabilities (`getPageContainer` and `getPageElement`).
The renderer, input, leaf and collection machinery are internal implementation.

Collapse all four inheritance pairs. Preserve conceptual modules and the
collection's domain logic. When a real WebGL adapter exists, extract a headless
model/controller seam from observed common requirements; do not keep today's
misleading base classes as a down payment on it.
