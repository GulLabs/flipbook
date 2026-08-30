# Changelog

All notable changes to this monorepo will be documented in this file.

## Unreleased

### Added — canvas fixtures, Phase 2 e2e harness, examples, `ImageFlipBook`

- **`scripts/gen-canvas-fixtures.mjs`** grows fit/blank/error fixtures:
  `square`, `stripe`, `corrupt` (undecodable PNG), `empty`, plus the existing
  identity / tall / wide / transparent set. Written into both
  `examples/vanilla/public` and `examples/vite-react/public`.
- **`e2e/canvas-phase2.spec.ts`** — real-pixel tests for `contain` / `cover` /
  `fill`, fractional inset, blank leaves, 404/corrupt error paths, and a
  negative-control probe on every visual assertion. Suites that need Phase 2
  engine surface **skip cleanly** until `imageFit` / descriptors land, so CI
  stays green while the contract is already encoded.
- **`examples/vanilla/canvas-demo.html`** — public canvas/images showcase
  (defect F3). The pixel harness remains `canvas.html`.
- **`examples/vite-react`** — controlled `page`, `usePageFlip()`, `onFlip` /
  `onChangeState` / `onTurnRejected`, `direction: 'rtl'`, and `ImageFlipBook`.
- **`ImageFlipBook`** in `@gullabs/react-flipbook` — separate component, no
  children, `images: ImagePageLeaf[]`, semantic alt mirror. Tries ADR
  descriptors then falls back to `string[]` until core Phase 2 lands.
- **Read-only bug hunt** recorded in `docs/BUG_HUNT_2026-08-29.md` (failed-image
  spinner routes, A3 still live, no blank leaf yet). No core patches from this
  lane.

### Fixed — pointer coordinates under a transformed ancestor

- **The fold followed the finger at the wrong ratio inside any `transform:
scale()` ancestor** — a zoom-to-fit shell, a responsive wrapper, a CSS zoom on
  a presentation page. `getMousePos` produced a VISUAL-pixel offset (a
  `PointerEvent` is measured through every ancestor transform) and handed it to
  geometry measured in LAYOUT pixels by `offsetWidth`. The drift is proportional
  to distance from the origin, so it is worst at the outer edge — exactly where
  folds start. Pointer offsets are now divided by the element's own
  visual-per-layout ratio, per axis, landing in the same space `Render` uses.
- `z-index:;` — an invalid declaration — is no longer written into every leaf's
  `cssText` on every frame. The CSSOM discarded it, so it was harmless, but it
  was emitted sixty times a second.

### Fixed — four ownership failures across the lifecycle methods

- **`attachMode` did not abandon the outgoing turn**, so a turn's destination
  could be applied to a collection loaded after it. `replacePages`,
  `updateFromHtml` and `clear` all abandon; this path leaned on the UI cancelling
  the gesture, which only happens while a pointer is down — and a programmatic
  turn has none. Measured: `flip(5)` with `flippingTime: 0` and a
  `changeState` listener that swaps in a four-page book threw
  `Invalid spread index 4 (have 4)` out of the animation callback.
- **`clear()` could be aborted half-way by a throwing listener.** It announced
  `read` before releasing the DOM, so a throwing `changeState` handler left the
  book reporting `pageCount: 0` with every leaf still parented to the engine's
  block and neither collection event emitted. All destructive work now happens
  before any announcement; the error stays synchronous.
- **`destroy()`'s error deferral was permanent rather than scoped**, which
  contradicted the documented guarantee that `on()` after `destroy()` still
  registers and receives `turnRejected` — errors from such a listener are
  outside teardown and must stay synchronous.
- **Two engines mounted on one host fought over `stf__parent`.** The first
  recorded that the class was absent and the second that it was present, so
  destroying the first stripped it from a host the second was still rendering
  into. Ownership is reference-counted now, and only the last engine out removes
  it.

### Fixed — `updateFromHtml` left engine classes on the consumer's element

- **A page added after the initial load kept `stf__item` and `--soft` / `--hard`
  forever.** `HTMLUI` records which engine classes a leaf already carried so
  `destroy()` can hand back a node the consumer authored without stripping a
  `--hard` they wrote themselves — but `updateFromHtml` constructed the pages
  (whose constructor stamps those classes) _before_ the UI adopted them, so the
  snapshot recorded the engine's own classes as pre-existing and release
  honoured it. Measured: an element added this way still read
  `class="my-page stf__item --soft"` after `destroy()`, where a leaf present at
  the initial load cleans to `class=""`. This is the one path the React binding
  uses for every page a book grows.

### Fixed — the flagship portrait bug was reachable again through spread construction

- **`showCover: false` no longer makes the last page of an odd-length book a hard
  page.** `PageCollection.createSpread` hardened the final leaf whenever
  landscape page-count parity left it alone in a spread, and `setDensity` writes
  the page's _permanent_ density — the one portrait mode reads. In portrait that
  put the BACK turn from the last page back onto upstream's previous-leaf
  slide-in (`newTemporaryCopy()` returns `this` for a hard page) and then skipped
  the bottom page, because the mover _was_ the bottom page. That is the §4.1
  regression this fork exists to remove, reachable in HTML mode on any
  odd-length book without a cover. Books with `showCover: true` are unchanged;
  declare a hard leaf explicitly with `data-density="hard"`.
- **A `showCover` book with exactly one page drew its cover on the left half of
  the spread.** A single-leaf landscape spread was placed by
  `index === pageCount - 1`, which is also true of the cover when the book has
  one page. The cover now wins the tie and draws to the right of the spine, as
  in every longer book.
- **`PageCollection.destroy()` now clears the spread tables.** A destroyed
  collection answered `getSpreadCount()` and `getSpreadIndexByPage()` for pages
  it had already disposed while `getPageCount()` reported 0.

### Fixed — `destroy()` could be aborted by a consumer's own event listener

- **A listener that read engine state threw out of `destroy()` itself.**
  Teardown sets `destroyed` and then emits — `ui.destroy()` abandons an
  in-flight gesture and `abandon()` announces `read` — so a `changeState`
  listener reading `getPageCollection()` got exactly the `DESTROYED` error the
  contract promises it, and that error came straight back out of `destroy()`,
  skipping the rest of the cleanup. Under React that is a `useEffect` cleanup
  throwing on unmount because of a listener that worked a moment earlier.

  Listener errors raised **during teardown** are now reported on a later task
  instead of thrown. This is not silencing — they still reach `window.onerror` /
  `uncaughtException` — and it is scoped to teardown only: outside it, the first
  listener error is still thrown synchronously, so
  `try { book.updateFromHtml(…) } catch` is unchanged.

### Fixed — host ownership and redundant frames

- **`destroy()` stripped a `stf__parent` class the caller owned.** The teardown
  promises to hand the host back unchanged and records its inline styles to do
  so, but removed the class unconditionally — so a consumer who styles their own
  container with it, or mounts two books through one wrapper, lost it. Only the
  class the engine added is removed now.
- **The engine wrote `display: block` inline on the host**, at construction and
  again on every `updateSettings`. It was redundant — `.stf__parent` already
  declares it — and unbeatable, because an inline style outranks the consumer's
  own stylesheet where the class does not. A host styled `display: flex` for the
  consumer's own layout was silently reset with no way to win, while `width` and
  `maxWidth` were guarded against exactly that. The write is gone; the class
  does the job.
- **A frame action could run more than once for the same frame.** The
  at-most-once guarantee its own type documents was enforced only on the
  overshoot and forced-commit paths, so several ticks landing on one index
  replayed it — measured, two frames over 1000 ms ticked at 0 ms and 100 ms
  played `[0, 0]`. Output was unaffected (a frame action is idempotent) but each
  replay re-ran the fold maths and forced another draw of identical pixels,
  which under the parked loop is the difference between one draw per frame and
  one per tick.

### Fixed — an interrupted turn no longer leaves its destination behind

- **A drag that grabs a `flip(page)` mid-flight landed on that page instead of
  making its own turn.** Cancelling the programmatic turn reset the calculation
  but left the absolute destination behind, so the reader's one-step turn
  consumed a destination they never asked for: catching the leaf of a `flip(5)`
  and carrying it across the spine landed on page 5, not page 1.
- **The phantom spread index was observable from `changeState`.** It exists only
  so the engine picks the destination leaves, and it was installed across the
  whole turn setup — including the synchronous `changeState('flipping')`
  dispatch. A turn started from that listener therefore chose its own pages from
  a spread the book was not on, and under `flippingTime: 0` committed off it,
  leaving `getCurrentPageIndex()` and `getCurrentSpreadIndex()` contradicting
  each other. Its lifetime is now the one call that needs it.
- **A `changeState('user_fold')` listener's turn was dragged by the finger that
  woke it.** The fold's own `do()` moved the nested turn's calculation before it
  had rendered a frame.
- **A `changeState('fold_corner')` listener's turn was force-finished by the
  hover.** The resumed hover committed the listener's turn — a page turned by an
  affordance that must never commit anything — and left a ghost animation
  scheduled against a null calculation.

### Fixed — the render loop no longer runs forever on an untouched book

- **`drawFrame()` ran on every animation frame for the life of the page**,
  whether or not anything had changed, in HTML mode as much as canvas. Measured
  in Chromium on the vanilla example: **73 rAF callbacks per second on an idle
  book, now 0**. It is a permanent battery and CPU cost on every page that
  embeds a book, paid by readers who are not touching it.

  The loop now parks when there is nothing to draw and is woken by every input
  that can change what is on screen: a turn, a drag, a corner hover, a
  `ResizeObserver` / `visualViewport` / window resize, an orientation change,
  `update()`, `updateSettings()`, `replacePages` / `updateFromHtml` / `clear`,
  and an instant turn under `flippingTime: 0` or `prefers-reduced-motion`. A
  turn still gets every one of its frames, and the park decision is taken only
  after a frame has been drawn, so the pose a turn lands on is always painted.

  **Canvas mode keeps its continuous loop for now.** A canvas book paints a
  loader spinner from the wall clock for any page whose bitmap has not decoded,
  and the decode completes on an `img.onload` that changes no renderer state —
  there is nothing to wake a parked loop with, so parking would freeze the
  spinner and never paint the image. `Render.needsContinuousFrames()` is the
  seam where the canvas renderer will opt in once it can answer "is any page I
  am drawing still loading".

### Changed — `PageFlipError.code` is a union, and two overloaded codes are split

- **`code` was typed `string`**, so a consumer could not narrow on it — the one
  thing a code exists to do. It is now `PageFlipErrorCode`, exported, so
  `switch (err.code)` is exhaustive and a typo in a comparison is a compile
  error.
- **`INVALID_SIZE` covered three different failures** — the `size` enum, the
  `width`/`height` pair, and the min/max bounds — separable only by reading the
  human-readable message, which is the one part of an error a library is free to
  reword. It is now the enum only; the others are `INVALID_DIMENSIONS` and
  `INVALID_BOUNDS`.
- **`INVALID_PAGE` covered both** "that page number is out of range" and "that
  page exists but is in no spread". The second is now `PAGE_NOT_IN_SPREAD`,
  which is also what `flipToPage` throws for the same condition (it used
  `FLIP_SETUP`).

Done now because neither package is published, so it costs nothing today and
would be a breaking change the moment it is.

### Added — public type surface

- **`FlipbookEventName` is exported.** The union of event names existed in the
  module and never reached the published `.d.ts`, so a consumer writing a helper
  that takes "an event name" had no type to give the parameter.

### Changed — internal wiring seams are marked as such

- **`updateState`, `updatePageIndex` and `updateOrientation` are `@internal`.**
  All three are public only because their callers (`Flip`, `PageCollection`,
  `Render`) are separate classes, and each is harmful from outside: they
  announce state the engine is not in, fabricate a `flip` event for a page the
  reader is not on, or restyle the UI for an orientation the renderer has not
  adopted. No runtime change — the surrounding methods (`attachMode`,
  `replacePages`, `getBlock`, `applyHostSize`) already carried the marker and
  these three had been missed.

### Fixed — settings and error surface

- **A non-string `pageBackground` threw a bare `TypeError` instead of a
  `PageFlipError`.** `pageBackground: 0` / `{}` / `[]` — reachable from untyped
  JS — hit `.trim()` and came out of the `PageFlip` constructor as
  `pageBackground.trim is not a function`, the only input in `getSettings` that
  did not produce a typed error. A wrong-typed value now takes the route `null`
  always did and falls back to the opaque default. The same guard is on the
  **draw-time** path, where it matters more: `foldFill` runs every frame against
  the live settings object, so assigning a number to `getSettings().pageBackground`
  crashed the render loop on the next frame — the book stopped mid-turn, nowhere
  near the assignment. CSS-safety and opacity checks are unchanged and still
  separate.
- **Stretch bounds could be left inverted.** `size: 'stretch'` with a `minWidth`
  above 2000 and no `maxWidth` filled `maxWidth` with a flat `2000` — below the
  declared minimum. `Render` then chose portrait under `minWidth * 2` and
  clamped `pageWidth` to `maxWidth`, so the book could never reach its own
  declared minimum and nothing was reported. The fallback is now
  `Math.max(2000, minWidth)`, and the same for height.
- **`PageFlipError.cause` is now declared on the class.** The constructor has
  always attached it, but `lib: ES2020` predates `Error.cause`, so the published
  `.d.ts` denied a property that existed at runtime and `err.cause` did not
  compile without a cast. Additive; the old cast still works.
- **The `updateSettings` refusal warning survives minification.** Terser's
  `drop_console: true` stripped it from every published build, so a refused
  construction-time setting was completely silent in production: the value was
  refused, `getSettings()` honestly reported the old one, and nothing said why.

### Fixed — event dispatch: one listener can no longer alter or abort another

- **`trigger` iterated the live listener array**, so one dispatch had two
  different mutation semantics and one non-terminating case: a handler calling
  `on(sameEvent, …)` pushed onto the array being iterated and the new listener
  ran inside the same emit — a handler that re-registers itself never
  terminated — while a handler calling `off(sameEvent)` deleted the map entry
  but left the loop holding the old array, so the rest still ran. The listener
  set is now snapshotted when the dispatch starts: a listener added during a
  dispatch runs from the next emit, and one removed during a dispatch still runs
  for the current one (Node `EventEmitter` semantics).
- **The first throwing listener aborted every later listener for that event.**
  Two `flip` handlers meant one consumer defect silently disabled the other
  handler. Every listener now runs. The first error is still thrown
  synchronously, so `try { … } catch` at the call site is unchanged; a second or
  later error is rethrown on a fresh task, reaching `window.onerror` /
  `uncaughtException` rather than being dropped. Listener errors are never
  swallowed.
- **`off(event, callback)` detaches a single listener.** `off(event)` still
  removes all of them. Matching is by reference, and registering the same
  function twice then calling `off` once leaves one registration.
- **A misspelled event name is a compile error.** The permissive
  `on(eventName: string, …)` overload is gone, so `book.on('flpi', …)` — which
  used to register against a name nothing emits and never fire — no longer
  type-checks.

### Fixed — re-entrancy from the engine's own synchronous events

- **A turn started from `changeState('flipping')` could be overrun the same
  way, through a window the first guard cannot reach.** `setState` dispatches
  between `start()` installing a calculation and `animateFlippingTo` installing
  an animation, so a listener's `flipNext()` found a live `calc` with nothing to
  finish, concluded it had superseded nothing, and took the book from a call
  still holding the calculation it replaced. Measured: the first `flipNext()`
  returned `true`, committed page 1 and left `state: read` with a ghost
  animation; the next committed page 2 immediately and page 3 at completion.
- **A turn started from an `onFlip` handler could be overwritten by the call
  that finished it.** `finishAnimation()` commits the outgoing turn and emits
  `flip` synchronously, and a listener is entitled to start the next turn from
  it (auto-advance, a controlled `page` prop). The caller then carried on and
  clobbered that nested turn's `calc` and `pendingTarget`, handed its running
  animation the caller's own destination, and committed on top. Measured on the
  built engine: the book landed on page 3 with events `[1, 2, 3]` — two page
  turns for one request. The nested turn is the later intent, so it wins and
  the outer call is refused.
- **`turnRejected` gained `reason: 'superseded'`** for exactly that refusal.
  Reporting it as `boundary` told consumers the book was at its end while it was
  mid-turn — the shape of failure that disables a "next" button.
- **`flip(page)` no longer throws `FLIP_SETUP` when a nested turn overtakes
  it.** Nothing about the request was invalid; the book is moving, just not
  where that call asked.
- **`changeState` announced the state the book was LEAVING.** `updateState`
  fired before the field was assigned, so a `changeState('read')` listener read
  `fold_corner` from `getState()` — and `UI.onPointerMove` reads the same field
  to decide whether to `preventDefault()`.
- **A turn started from the `read` announcement was destroyed immediately.**
  `setState(READ)` ran before the turn's own `reset()`, so the listener's fresh
  `calc`, flipping page and animation were all torn down on the next line. The
  nested `flipNext()` returned `true` and nothing moved.
- **The FORWARD corner band was clamped to the BACK band's bound.** Portrait's
  direction split is asymmetric (2/5 back, 3/5 forward), so one shared
  `min(operatingDistance, splitOffset)` shrank a band that had no defect: on a
  100x200 leaf a point 43 px in from the right edge is unambiguously forward and
  was refused, which under `disableFlipByClick` is a corner that will not turn
  the page. Each edge now takes the bound that actually constrains it — the
  split on the left, the midline on the right — which also keeps the two bands
  from meeting.

### Changed — `destroy()` releases event listeners

- **`PageFlip.destroy()` now releases every registered event listener.** Handlers
  are closures — under React they capture component state, refs and DOM — and
  the listener map was the one reference the teardown kept after it nulled
  `pages`, `render`, `ui` and `flipController`. A consumer holding a destroyed
  engine held all of it.
- **Behaviour change:** a listener registered _before_ `destroy()` no longer
  receives the `turnRejected` (`code: 'DESTROYED'`) that a post-destroy
  `flipNext()` / `flipPrev()` emits. The `false` return value — what the API
  tells callers to read — is unchanged. `on()` after `destroy()` still
  registers, and such a listener does receive it.

### Fixed — engine lifecycle

- `clear()` now announces the emptied book. It emits `update` (`page: 0`) and
  `collectionRebuild` (`page: 0, pageCount: 0`) — the same pair
  `updateFromHtml` / `replacePages` emit — so a consumer has a signal that the
  book emptied instead of silently holding a stale page number.
- `clear()` cancels the `init` still pending from a load. Loading and clearing
  in the same tick used to emit `init` a millisecond later, announcing a
  non-zero page for a book with no pages in it.
- `getCurrentPageIndex()` returns `0` for an empty book instead of the index it
  held before the collection was emptied.
- `loadFromHTML()` on a destroyed engine is a no-op. It previously built the
  whole `.stf__parent` / `.stf__wrapper` / `.stf__block` shell and moved the
  caller's page elements into it before tearing it back down — and the teardown
  returns adopted nodes to the engine HOST, not to the parent they came from,
  so the consumer's DOM was permanently relocated. That is the ownership churn
  that surfaces as `NotFoundError` under React.
- `updateSettings()` no longer merges `showCover` or `startPage`. Both are read
  once while the book is built, so accepting them only made `getSettings()`
  report a value in force nowhere. A changed value is refused and reported once;
  passing the current value — as spreading a whole settings object does — stays
  silent.

### Fixed — settings validation

- **A non-finite dimension is now an error, not a blank book.** The checks were
  `value <= 0`, which is **false for `NaN`** — so `{ width: undefined }` (or any
  binding forwarding an optional prop) produced a `NaN` bounds rect and
  `min-width: NaNpx`, and the book rendered nothing with nothing in the console.
  An explicit `undefined` now means "not supplied" and falls back to the default
  instead of clobbering it.
- **`swipeDistance: -5` is rejected** instead of silently making swipes
  impossible: the comparison is `distY < -swipeDistance`, which a negative
  threshold can never satisfy.
- `startZIndex` must be an INTEGER. Negative stays legal — that is valid CSS
  and someone may deliberately want the book behind a sibling — but `z-index:5.5`
  is discarded by the browser exactly as quietly as `z-index:NaN`.
- `maxShadowOpacity` is validated against its declared `[0, 1]` range. Rejecting
  only negatives let `2` through to produce alphas above 1, which browsers clamp
  silently — so the setting looked inert past 1 rather than invalid.
- `limitToCircle` returned `NaN` (and, in another branch, a fabricated
  coordinate with the sign discarded) for a perfectly vertical clamp; the guard
  tested the wrong quantity.
- `pointsBetween` never emitted its destination for a fractional delta, so every
  animation landed up to 1px short per axis.
- `angleBetweenSegments` returned `NaN` for a zero-length segment and had no
  `acos` domain clamp — currently unreachable because a guard two files away
  catches it first, which is exactly why it is worth pinning.
- `PageCollection.nextBy` returned `pages[0]` for a page not in the collection,
  where `prevBy` correctly returned `null`.

### Fixed — input, pointer and teardown

- **`flipToPage` no longer leaks a phantom index.** It parked a speculative
  spread index for the whole animation and let the commit land it, so a second
  call read the phantom as current: `flip(5)` then `flip(2)` finished on page 3,
  and in between `getCurrentPageIndex()` and `getCurrentSpreadIndex()`
  disagreed. The index is now borrowed only for the instant `start()` needs it,
  and the destination travels separately. A second call while one is in flight
  finishes the outgoing turn and starts again from the real index, so the last
  page you asked for is where you end up — refusing would have silently dropped
  navigations from a controlled `page` prop, which is the normal way this engine
  is driven.

_These landed inside commit 295fa85, whose message described only part of the
work it carried. Recorded here rather than left implicit._

- **`destroy()` no longer deletes the caller's pages.** `UI.destroy()` removed
  `.stf__block`, which holds the page elements the engine ADOPTED from the host —
  so after `loadFromHTML(pages); destroy()` the consumer's DOM was gone and
  `host.children.length === 0`. React survived only because its pages are
  portalled rather than adopted. Release now runs through a `releaseNodes()`
  hook backed by `HTMLUI`'s existing record of what it adopted, so
  framework-owned nodes are still never touched.
- **A refused turn no longer wedges the state machine.** `fold()` entered
  `USER_FOLD` before `start()` could refuse it; on refusal nothing put it back,
  so corner hover died for the life of the book and `preventDefault()` fired on
  every touchmove — which broke mobile scrolling over the book.
- **Pointer events are filtered by id.** Any pointer could drive a gesture
  another had started, so a two-finger pinch over the book folded the page and
  lifting either finger could commit a turn nobody asked for. Hover, which has
  no active pointer, still works.
- **A gesture interrupted by `updateSettings` or `updateItems` is cancelled**
  rather than left half-live. `removeHandlers()` released pointer capture but
  left the fold state set, so a later button-less hover kept dragging the page.
- **The swipe corner is computed in book space.** It compared an
  element-relative y against a book-local midpoint, so every upper-half swipe on
  a vertically-centred book was mis-classified. `flipNext` / `flipPrev` had the
  mirror-image error and the two masked each other; both are fixed.
- **`clickEventForward` applies to hover, not only to press** — the corner used
  to fold up over the link the reader was reaching for.
- **`flipToPage` no longer mis-lands.** It pre-mutated the spread index and let
  the animation commit it, so a second call read a phantom index: `flip(5)` then
  `flip(2)` landed on page 3.
- **The landscape density fix-up is restored after a turn.** It marked pages
  `HARD` and never undid it, and because the getter returned the mutated value
  it never re-marked — so a page silently became a hard page for the rest of the
  session and could never curl again.

### Fixed — canvas renderer (first-class work, ahead of the phased plan)

Found by the audit in `docs/CANVAS_FIRST_CLASS.md`, then reviewed by Codex
(`task-mtey3c3u-wlsgsc`, REQUEST_CHANGES) and corrected.

Every fix has a unit test observed failing with the fix reverted. That claim was
**overstated when first written** — G11 and A5 had no test at all, and the G1 and
G2 tests passed against subtly wrong implementations (G1 asserted a clip before
the _last_ paint, but `drawBookShadow` clips and paints after the leaves; G2 was
satisfied by `simpleDraw`'s fill, so deleting only the turning leaf's fill still
passed). Both are now discriminating, and the missing tests exist.

- Canvas frame state no longer leaks between frames. The portrait clip was
  applied at the _end_ of `drawFrame()` with no `restore()`, so it could not
  affect the frame that set it — it constrained every later frame, including
  that frame's `clear()`, leaving stale pixels outside the clip. The frame is
  now bracketed by `save()`/`restore()` (guaranteed by `finally`) and the clip
  is established before anything is painted, which is what upstream intended.
- A turning image leaf is opaque paper. `ImagePage` painted its bitmap straight
  onto the already-drawn page beneath, so a transparent PNG read through the
  fold — the same §4.2 bug `pageBackground` exists to prevent, fixed for HTML
  and missed for canvas. Both the turning and static paths now fill with
  `pageBackground` first.
- The loading placeholder no longer flashes white. `drawLoader` hardcoded
  `rgb(255, 255, 255)`, which sat over a custom `pageBackground` for as long as
  the image took to arrive.
- `PageFlip.clear()` works in canvas mode. It cast the active UI to `HTMLUI`
  unconditionally; `CanvasUI` has no `clear()`, so a public method threw a
  TypeError in one of the two supported modes.
- A slow `loadFromImages` can no longer replace a newer mode. Both image entry
  points await a dynamic import and guarded only `destroyed`, so a load started
  first could resolve later and call `attachMode()` over a newer
  `loadFromHTML`. Every mode-replacing operation now bumps a load generation
  that stale continuations must still match.
- `attachMode()` releases the previous page collection instead of overwriting
  the reference — for canvas that leaked every decoded image on a second load
  or a mode switch. Releasing it means something now: `PageCollection.destroy()`
  disposes each page rather than dropping an array, and `ImagePage.dispose()`
  detaches its load callback and drops its `src`.
- `clear()` stops the render loop drawing the pages it just discarded. It
  emptied the collection while `Render` kept its own left/right references, so
  the book stayed on screen.
- Cross-mode updates are refused with `PageFlipError('WRONG_MODE')` instead of
  failing deep inside. `updateFromHtml` cast `CanvasUI` to `HTMLUI`, and
  `updateFromImages` built image pages against an `HTMLRender` — a book whose
  pages drew into a 2D context that does not exist.
- A cached image is recognised as loaded. `load()` only ever attached `onload`,
  so an already-complete image could sit behind the placeholder forever;
  `naturalWidth` distinguishes a decoded image from a failed one, which is also
  `complete`.
- `ImagePage.getTemporaryCopy()` returns `null` rather than `this`. An image
  page has no temporary copy, and returning itself handed a null-checking
  caller a truthy non-copy.

### Fixed

- Canvas mode no longer paints the turning page twice. `ImagePage.newTemporaryCopy()`
  returns `this`, so the mover and the leaf beneath it are routinely the same
  object there, and `CanvasRender` drew the bottom page unconditionally — an
  unclipped copy sat under the turning image and vanished only when the turn
  finished. `HTMLRender` has guarded this since the §4.1 fix; the guard now
  applies to both. ([StPageFlip #44](https://github.com/Nodlik/StPageFlip/issues/44))
- `pageBackground` is validated against the platform's own colour parser where
  one exists (`CSS.supports`). The safe-value pattern accepts any short word as
  a named colour, but only ~148 are real, and an invented one fails silently in
  exactly the place it matters: CSS drops the declaration, leaving a
  transparent fold — the §4.2 bug the setting exists to prevent — and canvas
  keeps whatever `fillStyle` was there before.
- The platform check (`CSS.supports`) runs once, at the settings boundary,
  rather than on every draw — it parses, and the draw path runs per page per
  frame. The renderers keep the cheap pattern-and-keyword guard, because
  `getSettings()` hands back the live settings object and assigning to it
  bypasses `updateSettings` entirely.
- Canvas mode honours `pageBackground`. The setting is this fork's own and was
  wired only into the HTML renderer, so a cream-paper book came out white on
  canvas. ([StPageFlip #56](https://github.com/Nodlik/StPageFlip/issues/56))
- `clear()` releases only the leaves the engine actually adopted. It moved
  everything in `.stf__block` back to the host element, including pages a
  framework had rendered there itself — React portals its pages into that
  block, so `clear()` invalidated React's recorded parent and the next removal
  or reorder threw `NotFoundError`, the exact failure the portal prevents.

- A refused **click** now reports `turnRejected`. `userStop` discarded the
  result of the turn, so the event fired only for programmatic
  `flipNext`/`flipPrev` — the most common way a turn gets refused was silent.
- `turnRejected` can actually carry `reason: 'disabled'`. It was declared in
  the public event type and emitted by nothing, so a click blocked by
  `disableFlipByClick` produced no signal at all. The policy check moved from
  `Flip.flip` to `PageFlip.userStop`, which is the only path that has clicks.

- `lazyRadius` combined with `renderOnlyPageLengthChange` left every page
  outside the initial window as an empty placeholder for the life of the book.
  Turning a page moves the lazy window without changing the page count, so the
  length short-circuit skipped the re-render that would have mounted the next
  page — the reader turned the page and saw blank paper.
- Flip setup no longer swallows genuine defects. `Flip.start` caught every
  error and returned `false`, so a vanished DOM node or a broken renderer made
  the book simply refuse to turn with nothing in the console — the
  silent-failure class §4.6 exists to remove. Only `PageFlipError` is soft now;
  anything else surfaces.
- `PageFlip.flip(page)` throws `PageFlipError('NOT_LOADED')` before a load
  instead of silently doing nothing. Explicit navigation that quietly no-ops is
  the §4.6 failure, and `turnToPage` already behaved this way.
- `flipNext` / `flipPrev` no longer throw for a rejected turn. They are what a swipe and an arrow
  key call, and are documented to return a boolean plus a `turnRejected`
  event, but an engine-internal `PageFlipError` escaped them and surfaced as an
  unhandled exception from a gesture handler. An engine-typed failure is now
  reported as `turnRejected` carrying its error code; a non-engine error still
  propagates, because hiding a real defect behind "the page would not turn" is
  the same bug in a different place. `turnToPage` / `flip` still
  throw, which is the §4.6 contract.
- An out-of-range `startPage` reports `onNavigationError` instead of quietly
  opening at page 0, matching what an out-of-range controlled `page` already
  did.
- A responsive `width` / `height` no longer rebuilds the engine. The React
  binding keyed the engine's identity on size, so a book sized from its
  container was destroyed and recreated on every resize step — losing the
  current page, the render loop and any in-flight turn. `UI.applyHostSize()`
  restamps the host element from `updateSettings` instead.
- `swipeDistance` is read live. It was captured in the `UI` constructor, so
  `updateSettings({ swipeDistance })` was accepted and echoed by `getSettings()`
  while gestures kept using the value from construction.

### API / accessibility (craft-audit climb)

- `PageFlip.flipNext` / `flipPrev` return `boolean` and emit `turnRejected` when a turn does not start.
- `HTMLFlipBook` `useKeyboard` defaults to `true` (Arrow/Home/End); nested form controls keep their keys.
- Optional `onNavigationError` for controlled `page` out-of-range; `onTurnRejected` mirrors core events.
- `usePageFlip().bookProps` keeps `page` / `pageCount` in sync via engine events.
- Uncontrolled `startPage` is applied once after the first real page collection load.

### Engine

- `Flip.start` no longer catches setup failures at all (superseded below): the
  engine's typed errors are classified by `PageFlip.requestTurn`, and anything
  else propagates.
- `pageBackground` opacity is checked for real. Sanitising the value for CSS
  safety had made `isOpaquePageBackground` unable to return `false`, and let
  translucent values (`rgba(…, 0.4)`, `#ffffff00`, `hsla(…, 0.2)`, `#fff8`,
  `currentColor`) through to the fold — a turning leaf you can read through,
  which is the §4.2 bug the setting exists to prevent.
- Engine state is nullable internally and guarded at the accessors: calling
  `getRender()` / `getPageCollection()` / `getPageCount()` and friends before
  `loadFromHTML` / `loadFromImages` now throws `PageFlipError` with code
  `NOT_LOADED` instead of dereferencing `undefined` deeper in. Public
  signatures are unchanged. See MIGRATION.md.
- `attachMode` disposes the previous mode before replacing it, so loading twice
  cannot leave an old UI listening on the host element, and the deferred `init`
  no longer fires after `destroy()`.
- `attachMode`, `replacePages` and `getBlock` are marked `@internal` — they are
  wiring seams for the lazily-loaded canvas chunk, not supported API.

- Core compiles under `strictNullChecks`, so the published types no longer hide
  nullability: `getFlipController()`, `getCalculation()` and `getTemporaryCopy()`
  are declared `| null`, and `Page.setArea` accepts the sparse clip areas the
  renderers already tolerated.
- `direction: 'rtl'` now applies to click, corner fold and drag as well as swipe.
  The turn direction is mirrored; pointer coordinates are not, so the fold keeps
  following the finger instead of reversing mid-gesture.
- Turns are bounded by spreads instead of page indices. In landscape with a
  two-page final spread, a forward turn used to start and then read past the end
  of the spread list (`showNext` also walked one index too far).
- Static pages paint `pageBackground` like the fold does, so a leaf cannot be
  read through at the start or end of a turn.
- `pointerleave` no longer force-finishes a fold while a pointer is still down;
  under pointer capture it fires right after `pointerup` and started a second
  snap-back animation.
- `UI.destroy()` restores the host element's class and inline styles, and
  `updateItems` no longer wipes `.stf__block` wholesale (it kept deleting the
  render's shadow elements, and nodes a framework still owned).

### Tooling

- One TypeScript across the workspace (6.0.3); the lockfile and manifests had
  diverged, so `pnpm install --frozen-lockfile` — what CI runs — failed.
- Node 24 (`.nvmrc`), `engines: >=22.18.0`. Node 20 is end-of-life and
  size-limit 13 refuses to run on it.
- The release workflow builds before publishing. With `files: ["dist"]` and no
  build step, it would have published empty tarballs; `prepack` covers manual
  publishes too.
- Canvas mode has tests (it was 0% covered), and the browser suite asserts the
  §4.1/§4.2 invariants on Chromium and WebKit in CI instead of writing
  screenshots nothing compared.

### React

- Pages are portalled into the engine's block, so React and the DOM agree on
  their parent. Removing or reordering children threw `NotFoundError` before.
- Event handlers are dispatched through a ref, and the collection is rebuilt only
  when the page nodes actually change. An inline `onFlip` used to tear down and
  rebuild the whole `PageCollection` on every turn, mid-animation.
- `renderOnlyPageLengthChange` no longer empties the collected page nodes on its
  early return, which left the next remount with a blank book.
- The live region is visually hidden. Its text ("Page 2 of 3") rendered under the
  book for every consumer.
- A consumer's own `ref` on a page element is preserved instead of overwritten.
- `updateSettings` runs for every runtime-updatable prop (`clickEventForward`,
  `mobileScrollSupport`, `maxShadowOpacity`, `startZIndex`, size bounds).

### Repo

- Initial Gul Labs monorepo: `packages/core` (StPageFlip) and `packages/react` (react-pageflip).
- Public repository under `gul-labs/flipbook` with open-source governance, CI, and branch protection.

## 3.0.0

Engine + React binding merge. Start of the maintained 3.x line.

### Fixes (in-engine, not monkey-patches)

- Portrait BACK animates a temporary copy of the **current** leaf; local curl stays `to.x = -pageWidth` so `convertToGlobal` BACK-mirror curls right. Bottom page paints unless `flippingPage === bottomPage`. ([StPageFlip #49](https://github.com/Nodlik/StPageFlip/issues/49), [#9](https://github.com/Nodlik/StPageFlip/issues/9))
- Opaque fold / temporary copy via `pageBackground` (default `#fff`).
- React `onUpdate` fires on children change (handlers attach **before** `updateFromHtml`).
- `updateFromHtml` emits typed `collectionRebuild` when `PageCollection` is replaced.
- `updateSettings(partial)` restamps `usePortrait` / `useMouseEvents` at runtime; the React binding remounts when `showCover` / size identity changes.
- `turnToPage` and `flipToPage` throw `PageFlipError` instead of a silent one-page advance.
- React types declare `react` as a peer (`>=18`) and survive pnpm isolated `node_modules`.
- `flippingTime: 0` is instant; no constructor throw.

### Modernization

- Pointer Events (one input path); ResizeObserver + `visualViewport`.
- `respectReducedMotion` default true.
- SSR-safe imports (no `window`/`document` at module scope); React pre-hydration placeholder.
- Opt-in keyboard (arrows/Home/End) and configurable live region.
- `direction: 'rtl'`.
- Controlled `page` + `onPageChange`, imperative handle, `usePageFlip()`.
- Lazy page mounting via `lazyRadius`.
- React 18/19 (`forwardRef` handle so `ref.current.pageFlip()` works on 18; Strict Mode double-mount safe).
- Typed `WidgetEvent<T>`; no `any` in the public API.
