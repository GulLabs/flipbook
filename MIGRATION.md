# Migration from `page-flip` / `react-pageflip`

Drop-in `HTMLFlipBook` keeps **required `width` and `height`**. Other settings stay optional.

## 3.0.0 — canvas mode removed (ADR 0002)

Canvas / images mode is **gone**. There is no `ImageFlipBook`, no
`loadFromImages` implementation, and no `imageFit` / `imageInset` settings.

`PageFlip.loadFromImages` / `updateFromImages` remain only as stubs that reject
with `PageFlipError` code **`CANVAS_REMOVED`** (after `destroy()` they are still
safe no-ops). Use HTML pages with `<img>` elements:

### Vanilla

```ts
import { PageFlip } from '@gullabs/flipbook-core';

const root = document.getElementById('book')!;
const book = new PageFlip(root, { width: 400, height: 300 });

const pages = ['/p1.jpg', '/p2.jpg', '/p3.jpg'].map((src, i) => {
  const el = document.createElement('div');
  const img = document.createElement('img');
  img.src = src;
  img.alt = `Page ${i + 1}`;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  el.appendChild(img);
  return el;
});

book.loadFromHTML(pages);
```

### React

```tsx
import HTMLFlipBook from '@gullabs/react-flipbook';

<HTMLFlipBook width={400} height={300}>
  <div>
    <img
      src="/p1.jpg"
      alt="Cover of My Book"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  </div>
  <div>
    <img
      src="/p2.jpg"
      alt="Page 2"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  </div>
</HTMLFlipBook>;
```

`object-fit: contain|cover|fill` replaces the removed canvas `imageFit` setting.
`alt` on the `<img>` replaces canvas leaf descriptors and `getPageAltText`.

## 3.0.0 — engine lifecycle and settings validation

These are behaviour changes on the public surface, landed while hardening the
engine. Each replaces a silent failure with a reported one.

### A destroyed engine is observably dead

`PageFlip.destroy()` now drops the engine's internal `pages` / `render` / `ui`
and flip controller, so a destroyed instance no longer quietly serves a disposed
collection and a stopped render.

`getRender`, `getUI`, `getPageCollection`, `getPage`, `getPageCount`,
`getCurrentPageIndex`, `getOrientation`, `getBoundsRect`, `turnToPage`,
`turnToNextPage`, `turnToPrevPage`, `flip` and `clear` throw `PageFlipError`
with the **new code `'DESTROYED'`**. `flipNext` / `flipPrev` keep their boolean
contract and emit `turnRejected` with `code: 'DESTROYED'`.

`'DESTROYED'` is deliberately distinct from `'NOT_LOADED'`: the remedy differs.
`NOT_LOADED` means "load first", but a destroyed engine refuses to attach a new
mode, so it can only be replaced — reporting `NOT_LOADED` would invite a retry
that cannot work.

Cleanup-shaped calls stay safe, because tearing down twice is normal: `destroy`,
`update`, `updateSettings`, `replacePages`, `updateFromHtml` and
`updateFromImages` are no-ops after destroy. `getSettings`, `getState` (`READ`),
`getFlipController` (`null`), `getBlock` and `isDestroyed` remain safe.

**If you inspect an engine after tearing it down** — a late effect, an async
callback, a `finally` block — guard with `isDestroyed()` or catch
`PageFlipError`.

### `init` reports where the book landed, not what you asked for

The `init` event's `page` is now the index the book actually settled on.

- An out-of-range `startPage` is **clamped into the book**: `startPage: 99` on a
  4-page book lands on page 3 and reports 3. It previously stayed on page 0 and
  reported 99.
- In landscape a valid request resolves to its spread head: `startPage: 3`
  reports 2.

Consumers seeding page state from `init` no longer start desynced. If you relied
on `init` echoing your `startPage` back, read it from settings instead.

### `Render.getDirection()` returns the GEOMETRIC fold side

`direction: 'rtl'` used to mirror the turn direction and, through
`convertToPage`, silently mirror the pointer coordinates with it — which is why
an RTL drag ran away from the finger. The fix splits the two: `setDirection()`
takes the SEMANTIC direction (which way the book moves in page order) and stores
the GEOMETRIC side (which physical half folds).

`Render` is exported, so `getDirection()` is reachable. It now answers the
geometric question. Every internal consumer — coordinate conversion, page
orientation, shadow gradients, hard-page z-order — wanted that already. If you
were reading it to learn which way a turn was heading, read the `flip` event or
compare page indices instead.

### `showCover: false` with an odd number of pages

The last page is no longer promoted to a hard page.

- **Landscape:** that leaf now curls like paper on the final turn instead of
  swinging rigidly from the spine.
- **Portrait:** the back turn from it now animates a copy of the current leaf —
  this fork's corrected curl — instead of sliding the previous leaf in.

If you relied on the old rigid rendering, mark the page explicitly with
`data-density="hard"` on its element, which has always been the supported way to
declare a hard leaf. Books with `showCover: true` are unaffected.

`showCover: true` now hardens **both** covers, regardless of page-count parity.
A five-page book and a six-page book both get a hard back leaf. Previously the
last page was hard only when it sat alone in a spread (even count), so adding
one page silently gained or lost a hard back cover. `showCover: false` never
hardens a terminal leaf — that path is the portrait back-curl fix and must stay
soft.

### `showCover: true` with exactly one page

The cover now renders in the right half of the landscape spread, matching every
longer book. There is no opt-out — the previous left-half placement was a
tie-break accident, not a supported layout.

### `destroy()` no longer throws because of your event listener

If one of your listeners throws while the engine is tearing down, `destroy()`
now completes and the error surfaces as an uncaught error on a later task,
rather than propagating out of the `destroy()` call and skipping the rest of the
cleanup. Nothing is swallowed.

This matters most for a listener that reads engine state: `destroy()` emits
`changeState` after the engine is already marked destroyed, so
`getPageCollection()`, `getRender()` and friends throw `DESTROYED` from inside
that handler by design. Guard such a listener with `book.isDestroyed()` if you
want it to stay quiet.

Outside teardown nothing changes: the first listener error is still thrown
synchronously from the call that emitted.

### The render loop is scheduled on demand, not continuously

An idle HTML book no longer calls `requestAnimationFrame`. The engine wakes
itself for everything that changes what is drawn — turns, drags, hovers,
resizes, orientation changes, collection swaps and `update()` — so no consumer
change is needed for supported usage.

Two things to know if you reach past the public API:

- **If you mutate a page's DOM directly and expect the engine to repaint it,**
  call `book.update()`. In practice nothing changes: the HTML renderer only
  writes position, clip and z-index, so your own content updates paint
  themselves.
- **If you subclass the exported `Render` class,** it now has protected members
  `requestFrame()`, `needsContinuousFrames()` and private scheduler state
  (`running`, `dirty`, `framePending`, `frameLoop`). A subclass that already
  declares a member of one of those names will fail to compile. Override
  `needsContinuousFrames()` to return `true` if your renderer paints something
  that changes without the engine being told (an animated background, a
  spinner); otherwise call `requestFrame()` when you change state the base
  class does not own.

### `PageFlipError.code` is a union, and three codes changed

`code` was `string`; it is now the exported `PageFlipErrorCode` union. If you
compare it against a string literal nothing changes. If you assign it to a
`string`-typed variable, that still works. If you were constructing
`PageFlipError` with a code of your own, that is now a type error — the codes are
the engine's.

Three throw sites now report a more specific code:

| Condition                                                   | Was                          | Now                  |
| ----------------------------------------------------------- | ---------------------------- | -------------------- |
| Invalid `width` / `height`                                  | `INVALID_SIZE`               | `INVALID_DIMENSIONS` |
| Invalid `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | `INVALID_SIZE`               | `INVALID_BOUNDS`     |
| `turnToPage` / `flipToPage` on a page in no spread          | `INVALID_PAGE`, `FLIP_SETUP` | `PAGE_NOT_IN_SPREAD` |

`INVALID_SIZE` still exists and now means only "the `size` value is not
`fixed` or `stretch`". If you branch on any of these codes, update the
comparison; if you only log `err.code`, nothing to do.

### `PageFlipError.cause` is now part of the published type

`PageFlipError` has always attached `cause` when constructed with
`{ cause: someError }`, but the shipped `.d.ts` did not declare it, so reading
it required a cast. The cast is no longer needed:

```ts
catch (e) {
  if (e instanceof PageFlipError) console.error(e.code, e.cause);
}
```

Runtime behaviour is unchanged: an error built without a cause still reads back
`undefined`. This is an additive type change — no existing code breaks, and the
old cast still compiles.

### `on()` and `off()` only accept real event names

`on(eventName: string, callback)` was a public overload, so any string compiled.
`on`/`off` are now keyed to `FlipbookEventMap`, and a typo is a type error at
the call site. Runtime behaviour is unchanged — a name nothing emits never fired
before either; you now find out at build time instead of never. If you were
using the engine's emitter for event names of your own, keep your own emitter:
this one is typed to the events the engine emits.

### `once(name, callback)` fires at most once

`PageFlip.once(event, fn)` registers a listener that is removed **before** `fn`
runs, so a throwing handler cannot stay armed. `off(event, fn)` cancels it using
the same function reference you passed to `once` (not an internal wrapper). A
`once` registered during a dispatch waits for the next emit.

### Boolean settings must be booleans

`drawShadow`, `usePortrait`, `autoSize`, `showCover`, `mobileScrollSupport`,
`clickEventForward`, `useMouseEvents`, `showPageCorners`, `disableFlipByClick`
and `respectReducedMotion` now throw `PageFlipError` with code
`'INVALID_BOOLEAN'` unless the value is a real boolean. Upstream (and this fork
until this change) accepted `'false'` / `0` / `1`; `'false'` is truthy, so
shadows stayed **on**. That is a deliberate break for JavaScript callers and for
anything forwarding `data-*` strings.

### `off(name, callback)` detaches one listener

`off(name)` is unchanged and still removes every listener for that event. It now
takes an optional second argument that removes exactly one registration, so two
`flip` handlers can be detached independently — previously the only way to drop
one was to drop both and re-register the survivor.

Matching is by reference, like `removeEventListener`: pass the same function
object you passed to `on`. A fresh arrow or a new `.bind(this)` will not match
and is a no-op. Registering the same function twice and calling `off` once
leaves one registration.

### A throwing event listener no longer silences the listeners after it

Before: the first listener that threw ended the dispatch, and every listener
registered after it for that event was skipped — silently.

Now: every listener runs. The first error is still thrown synchronously from the
call that emitted, so existing `try`/`catch` around `updateFromHtml`, `clear`,
`flipNext` and friends behaves as it did. If more than one listener throws in a
single dispatch, the first is thrown and the rest are rethrown asynchronously,
where they surface as uncaught errors instead of disappearing.

Also: the listener set is fixed when a dispatch begins. A listener you register
from inside a handler will not receive the event being dispatched — it receives
the next one — and a listener you remove from inside a handler still receives
the current one.

### `turnRejected` has a fourth reason: `superseded`

`reason` was `'boundary' | 'setup' | 'disabled'`. It is now
`'boundary' | 'setup' | 'disabled' | 'superseded'`.

You will see `superseded` when a turn you asked for was overtaken by one your
own `onFlip` handler started — the common auto-advance shape. It means "a newer
turn is running", not "there is no page that way", so a consumer disabling a
next/previous button on `turnRejected` should treat it differently from
`boundary`. If you `switch` exhaustively on `reason`, TypeScript will point at
the new arm.

### `destroy()` unbinds your event handlers

Before: handlers registered with `on()` stayed registered on a destroyed engine,
and a `flipNext()` / `flipPrev()` on that engine still called your
`turnRejected` handler with `code: 'DESTROYED'`.

Now: `destroy()` forgets every listener, so those closures — and everything they
capture — are released with the rest of the engine. If you relied on a
pre-registered `turnRejected` handler to observe post-destroy refusals, read the
boolean instead: `flipNext()` / `flipPrev()` still return `false`. If you
genuinely want the event, register **after** `destroy()`; `EventObject` has no
notion of a destroyed owner and `on()` still works.

There is no public `offAll()`. `off(name)` still removes every listener for one
event (and `off(name, callback)` removes just one), while complete unbinding
across all events is what `destroy()` now does.

### `flip` fires only when the page actually changes (ADR 0003)

**Read this one even if you skim the rest.** It is the highest-risk change here:
it compiles, it type-checks, and it surfaces later in analytics or in an
auto-advance loop rather than at the call site.

`flip` — and therefore React's `onFlip` and `onPageChange` — used to fire every
time the spread was repainted. That was inherited from upstream, where the same
two lines ran unconditionally, and it was never intentional. It now fires only
when `getCurrentPageIndex()` changes.

What stops firing:

- **Mounting.** A book that opens at page 0 emits no `flip` at all — previously
  two. **`onPageChange` is not an initialization event.** If you seeded initial
  page state from the first `flip` / `onPageChange`, that worked only because of
  this defect; use `init` / `onInit`, which carries the resolved index and always
  did. This is the only path where the change is observable as a loss, and it is
  the one to check first.
- `updateSettings({ … })` on anything that cannot move the page.
- `turnToPage(n)` when `n` is already on screen — including the other page of
  the same landscape spread, since both report the spread head.
- An orientation change that leaves the head where it was (landscape `[2,3]` →
  portrait `[2]` both report `2`). `changeOrientation` carries that news.
- Abandoning an in-flight fold. It previously announced a turn that never
  committed.

What still fires, unchanged: every real turn, exactly once — including an
orientation change that genuinely moves the head (portrait page `3` → landscape
spread `[2,3]`, head `2`). And `clear()` still does not emit `flip`, which it
never did.

If you were using `flip` as a "the book repainted" signal, **there is currently
no replacement.** An earlier version of this note said to use `update`; that was
wrong. `update` fires only when the page collection is replaced or cleared — not
on a repaint, a resize, or `PageFlip.update()`, which shares its name and does
not cause it.

The React binding needs no change: `HTMLFlipBook` and `usePageFlip` already
re-derive the index and page count from the engine on `collectionRebuild`
rather than trusting the flip stream.

### `updatePageIndex()` is gone from the public surface

It only ever EMITTED — it dispatched `flip` without moving the book — so
calling it fabricated a page change: `book.updatePageIndex(4)` on a book sitting
on page 0 announced `flip(4)`, and a controlled React binding acts on that by
navigating itself to a page nothing had turned to. Under ADR 0003 that is
precisely the thing `flip` is supposed to make impossible, so the seam is now
keyed by a module-private symbol and cannot be named from outside the engine.

To move the book, use `turnToPage(n)` or `flipToPage(n)`, which is what the
method's own documentation already told you to do.

### `updateState()`, `updateOrientation()`, `setOrientationStyle()` and `setCurrentSpreadIndex()` are gone too

Same reason, same fix: each is a call between two engine objects that a
consumer could reach through `getUI()` / `getPageCollection()`, and each can
leave the book in a state its own getters disagree about.

| Removed                                   | What it did from outside                                                                                                                                                                                                                                                                               | Use instead                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `PageFlip.updateState(s)`                 | Announced a flipping state the engine was not in. `UI.onPointerMove` reads that state to decide whether to `preventDefault()`, so a spurious `READ` turned page scrolling back on mid-turn.                                                                                                            | Nothing — read `getState()`; the engine owns transitions.             |
| `PageFlip.updateOrientation(o)`           | Rebuilt the spreads and restyled the UI for an orientation `Render` had not adopted, leaving the three collaborators disagreeing about how many leaves are on screen.                                                                                                                                  | `updateSettings({ usePortrait })`, or let the `ResizeObserver` do it. |
| `UI.setOrientationStyle(o)`               | The restyle half of the same thing: a landscape book kept `getOrientation() === 'landscape'` while its wrapper carried `--portrait` and had been re-laid at the portrait ratio, with no `changeOrientation` emitted.                                                                                   | As above.                                                             |
| `PageCollection.setCurrentSpreadIndex(i)` | Wrote the spread index without showing it, so the book displayed one spread and believed it was on another. Measured: from spread 0, `setCurrentSpreadIndex(2)` then made `turnToNextPage()` a **silent** refusal, because the bounds check reads the forged index. An un-turnable book with no error. | `turnToPage(n)` / `flipToPage(n)`.                                    |

If you were calling any of these to work around a missing feature, that is a
bug report worth filing — none of them was ever a supported way to drive the
book.

### `clear()` now emits events

`clear()` emits `update` and `collectionRebuild` with `page: 0` and
`pageCount: 0`. A handler that assumed `collectionRebuild` only ever meant "new
pages arrived" will now also see it for "the book emptied" — branch on
`pageCount === 0`. Previously `clear()` was silent and `getCurrentPageIndex()`
kept returning the pre-clear index; that index is now `0`.

### `updateSettings()` ignores `showCover` and `startPage`

Both are construction-time: `showCover` is baked into the page collection when
spreads are created, and `startPage` is read once at load. Passing a **changed**
value now leaves `getSettings()` reporting the value actually in force and logs
a warning; previously the new value was stored and silently did nothing.
Passing the current value — which spreading a whole settings object does — is
unchanged and silent. To change either, construct a new `PageFlip`; the React
binding already remounts on `showCover` via `remountKeyOf`.

### Settings are validated for finiteness, not just sign

`getSettings` now throws `PageFlipError` for values it previously accepted:

| Setting                                          | Now rejected                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `width`, `height`                                | non-finite, or `<= 0` (`INVALID_DIMENSIONS`)                                                                     |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | non-finite, or negative (`INVALID_BOUNDS`). `0` remains the "unset" sentinel                                     |
| `flippingTime`                                   | non-finite or negative (`INVALID_FLIPPING_TIME`). `0` remains instant                                            |
| `swipeDistance`                                  | non-finite or negative (**new** `INVALID_SWIPE_DISTANCE`)                                                        |
| `startZIndex`                                    | non-integer, including non-finite (**new** `INVALID_Z_INDEX`). Negative stays legal — `z-index` takes an integer |
| `maxShadowOpacity`                               | outside `[0, 1]`, or non-finite (**new** `INVALID_SHADOW_OPACITY`)                                               |
| Every boolean setting                            | not a real boolean (`INVALID_BOOLEAN`). `'false'` / `0` / `1` throw — they used to be accepted and were truthy   |

An explicit `undefined` is now treated as "not supplied" and falls back to the
default, rather than clobbering it. The checks were `value <= 0`, which is
**false for `NaN`** — so `{ width: undefined }` produced a `NaN` bounds rect and
`min-width: NaNpx`, and the book rendered nothing with no error anywhere.
`swipeDistance: -5` was accepted and silently made swipes impossible.

TypeScript consumers with `exactOptionalPropertyTypes` were already protected at
compile time; this closes the runtime hole for JavaScript consumers and for
bindings forwarding an optional prop (`width={props.width}`).

## Install

```bash
npm uninstall react-pageflip page-flip && npm i @gullabs/react-flipbook
```

Vanilla engine:

```bash
npm uninstall page-flip && npm i @gullabs/flipbook-core
```

```ts
// before
import { PageFlip } from 'page-flip';
import HTMLFlipBook from 'react-pageflip';

// after
import { PageFlip } from '@gullabs/flipbook-core';
import HTMLFlipBook from '@gullabs/react-flipbook';
```

## Breaking changes (3.0.0)

| Change                                        | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package names                                 | `@gullabs/flipbook-core`, `@gullabs/react-flipbook`. Do not use `page-flip` / `StPageFlip` as package names.                                                                                                                                                                                                                                                                                                                                            |
| `flippingTime: 0`                             | Now means **instant**. Upstream threw `Invalid flipping time`.                                                                                                                                                                                                                                                                                                                                                                                          |
| `respectReducedMotion`                        | Defaults to `true`. Turns become instant under `prefers-reduced-motion`. Set `false` to keep animating.                                                                                                                                                                                                                                                                                                                                                 |
| `pageBackground`                              | New, default `#fff`. Set to your paper color so the fold is opaque.                                                                                                                                                                                                                                                                                                                                                                                     |
| `direction: 'rtl'`                            | New. Click, corner fold, drag and swipe invert _turn direction_. Pointer x is not mirrored (fold follows the finger). Programmatic `flipNext`/`flipPrev` follow page index. Curl geometry stays LTR.                                                                                                                                                                                                                                                    |
| `loadFromImages` / `updateFromImages`         | **Removed.** Stubs reject with `PageFlipError` code `'CANVAS_REMOVED'`. After `destroy()` they are still no-ops. Use `loadFromHTML` with `<img>` elements — see the section at the top of this file.                                                                                                                                                                                                                                                    |
| Engine getters before load                    | `getRender()`, `getUI()`, `getPageCollection()`, `getPageCount()`, `getCurrentPageIndex()`, `getOrientation()`, `getBoundsRect()`, `getPage()`, `turnToPage()` and `clear()` throw `PageFlipError` with code `NOT_LOADED` if called before `loadFromHTML`. They previously dereferenced `undefined` and failed deeper in with no useful message. `getSettings()`, `getState()`, `update()`, `updateSettings()` and `destroy()` remain safe before load. |
| `turnToPage` / `flipToPage` (`PageFlip.flip`) | Throw `PageFlipError` on setup failure instead of silently advancing one page.                                                                                                                                                                                                                                                                                                                                                                          |
| React types                                   | `react` is a **peer** (`>=18`). Isolated pnpm `node_modules` type-checks props.                                                                                                                                                                                                                                                                                                                                                                         |
| React 18/19                                   | Imperative handle uses `forwardRef` so `ref.current.pageFlip()` works on React 18 (peer `>=18`). Spec §6.9 “ref as prop / no forwardRef” is **waived** for 3.0.0 — dropping `forwardRef` would break React 18.                                                                                                                                                                                                                                          |
| Core min size                                 | Unmodified StPageFlip 2.0.7 minifies to **~44 kB** ESM (~10 kB gzip / ~9 kB brotli). Spec §5’s 35 kB _uncompressed_ is below upstream and is retired. CI enforces the packed HTML engine **≤ 57 kB raw / 14 kB brotli / 16 kB gzip**. There is no canvas chunk.                                                                                                                                                                                         |
| `PageFlip.destroy()`                          | No longer removes the host DOM node (the React tree owns it).                                                                                                                                                                                                                                                                                                                                                                                           |
| CSS                                           | Injected at runtime. Also exported as `@gullabs/flipbook-core/style.css`.                                                                                                                                                                                                                                                                                                                                                                               |
| Boolean settings                              | Must be real booleans. `'false'` / `0` / `1` throw `INVALID_BOOLEAN`.                                                                                                                                                                                                                                                                                                                                                                                   |
| `once(event, fn)`                             | New. One-shot listener; `off(event, fn)` cancels it. Additive.                                                                                                                                                                                                                                                                                                                                                                                          |
| `updateFromHtml`                              | Rebuilds `PageCollection` and emits typed `update` **and** `collectionRebuild`. Attach listeners before calling (the binding does this).                                                                                                                                                                                                                                                                                                                |
| Constructor-only settings                     | Engine `updateSettings` ignores a **changed** `showCover` or `startPage` (warns, getter stays honest). The React binding remounts on `showCover` and `size`. `width` / `height` are live — the host is restamped in place.                                                                                                                                                                                                                              |

## Compatible props

`HTMLFlipBook` still accepts the upstream settings (`usePortrait`, `showCover`, `maxShadowOpacity`, `disableFlipByClick`, …) plus:

- `page` + `onPageChange` (controlled)
- `useKeyboard`
- `lazyRadius`
- `liveRegion` / `liveRegionText`
- `onCollectionRebuild`

## Lifecycle of `PageCollection`

`updateFromHtml` **replaces** the collection instance. Any state you stamped on the old collection is gone. Listen for `collectionRebuild` (or React `onUpdate`, which now actually fires) and re-apply. `updateFromImages` is a removed stub (`CANVAS_REMOVED`).

## Portrait back-curl

No consumer monkey-patch is required. Portrait BACK animates a temporary copy of the **current** leaf on the vendor local path (`to.x = -pageWidth`). `Render.convertToGlobal` BACK-mirror yields a rightward on-screen curl. The bottom leaf paints unless `flippingPage === bottomPage` (hard cover).

## GulLabs 3.x binding notes (craft-audit climb)

- `HTMLFlipBook` **`useKeyboard` defaults to `true`**. Pass `useKeyboard={false}` to restore pointer-only.
- `foldFill` / `foldFillCss` are no longer exported from `@gullabs/flipbook-core`. They were incidental exports of an internal helper, never documented, and they are no longer part of the package surface. The engine still uses `foldFill` internally as a draw-time guard, because `getSettings()` hands back the live settings object and assigning to it would otherwise put an unvalidated value in front of the fold; the heavier platform check (`CSS.supports`) runs once in `Settings.getSettings`. `safePageBackground` and `isOpaquePageBackground` remain exported. `foldFillCss` is gone too, but only because nothing called it — `HTMLPage` builds its `cssText` inline.
- `Flip.flip(pos, skipClickCheck, direction)` is now `Flip.flip(pos, direction)`. The `disableFlipByClick` policy moved to `PageFlip.userStop`, so the parameter had no callers left. Only reachable via `getFlipController()`; the `PageFlip` methods are unchanged.
- `turnRejected` now also fires for **clicks**: `reason: 'disabled'` when `disableFlipByClick` blocks one, `reason: 'boundary'` at the ends of the book. `code` is now present only when the engine has a real error code to give (`NOT_LOADED`, a spread failure); a plain boundary no longer carries the placeholder `'REJECTED'`, which only restated `reason`. Previously it fired only for programmatic turns, and `'disabled'` was never emitted at all. Handlers that assumed the event meant "a programmatic turn failed" will now see user clicks too.
- `PageFlip.flipNext` / `flipPrev` report a turn that cannot start as `false` plus a `turnRejected` event, carrying the engine's error code. A failure that is _not_ the engine's own (`PageFlipError`) — a broken renderer, a vanished node — still propagates rather than being hidden behind a refused turn. Explicit `turnToPage` / `flip` throw, including `PageFlipError('NOT_LOADED')` when called before a load — `flip` previously no-opped there. The **React** handle and `usePageFlip()` actions deliberately do not: before mount (or after unmount) `ref.current` is null, so `turnToPage` / `flipToPage` are no-ops and `flipNext` / `flipPrev` return `false`. Calling them from an effect or an event handler that can fire early is normal, and throwing there would punish correct code.
- `PageFlip.flipNext` / `flipPrev` (and the React handle) return **`boolean`** — `false` means the turn did not start. Subscribe to **`turnRejected`** for the same signal as an event.
- Controlled `page` out of range calls optional **`onNavigationError`** and clamps via `onPageChange` to the engine index. An out-of-range uncontrolled **`startPage`** reports the same event instead of quietly opening at page 0; a `startPage` that resolves to a valid spread (landscape `startPage: 1` opens the `[0, 1]` spread) is not an error.
- `usePageFlip()` returns **`bookProps`** — spread onto `<HTMLFlipBook {...bookProps} />` so `pageCount` stays in sync.
