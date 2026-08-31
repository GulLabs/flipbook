# Consumer / API review — round 1

**Reviewer role:** library consumer advocate (not correctness).
**Reviewed at:** `ccaefe8`, in an isolated worktree.
**Method:** I built both packages from that tree, linked them into a scratch
consumer project (`moduleResolution: bundler`, `strict: true`,
`skipLibCheck: false`, only the published `dist/index.d.ts` visible — no `src`
aliases), and wrote the four personas' code for real. Every compile error quoted
below is one `tsc` actually emitted against the shipped types. Nothing here is
inferred from reading `src`.

The engine is in unusually good shape. Errors are typed and kinded, events are
one payload shape, settings validate loudly, `destroy()` has a written contract,
and `usePageFlip` is a genuinely well-judged hook. What follows is almost
entirely about the **boundary**: what is named public, what a consumer can name
in their own code, and what the façade answers directly versus makes you go
digging for.

---

## Persona 1 — the 10-minute user

Next.js page, 20 images, page turns and a counter. I copied the README snippet
(`README.md:122-139`), swapped in a `map`, and added the counter the obvious way:

```tsx
const [page, setPage] = useState(0);
const [total, setTotal] = useState(0);

<HTMLFlipBook
  width={400} height={600}
  onPageChange={(s) => { setPage(s.page); setTotal(s.pageCount); }}
>
  {images.map((src) => <div key={src}><img src={src} alt="" /></div>)}
</HTMLFlipBook>
<p>Page {page + 1} of {total}</p>
```

It compiles, it renders, and **the counter says "Page 1 of 0" until the reader
turns a page.**

This is the single worst thing in the consumer experience, and it is a direct
consequence of a decision that is right: opening is not turning, so `flip` /
`onPageChange` deliberately does not fire on load
(`PageFlip.ts:563` `SEED_OPENING_INDEX`, ADR 0003). The count arrives on
`onLoaded` (`EventObject.ts:75-76`, `HTMLFlipBook.tsx:687`), which the README
never mentions and which nothing in the type system points at. The
`onPageChange` handler is where a newcomer looks, its payload is a
`BookSnapshot` **carrying `pageCount`**, and that field is a lie for the entire
period before the first turn.

Both shipped examples get this right only because they use `usePageFlip`, which
binds `onLoaded` internally (`usePageFlip.ts:184`). The README's React example
does not, and shows no counter at all.

**Fix, in order of preference:**

1. Put a page counter in the README's React snippet, using `usePageFlip` — and
   say in one line that `onPageChange` fires on _turns_, not on open.
2. Give `HTMLFlipBook` an `onBookState?: (s: BookSnapshot) => void` that fires on
   ready, load, pages-changed **and** turn — i.e. "the snapshot changed". That is
   what 90% of consumers actually want, and today they have to bind four props to
   get it.

Other persona-1 notes:

- `'use client'` is present (`HTMLFlipBook.tsx:1`) and the default export exists
  (`react/src/index.ts:19`), so the Next.js drop-in genuinely works. Good.
- `width`/`height` required is right and the error message when a CMS hands you a
  string is excellent (`Settings.ts:229-242`).
- Nothing told me my 20 `<div><img></div>` children need a fixed height or
  `objectFit`. The README snippet has the inline styles but no sentence saying
  why. A 10-minute user who drops bare `<img>` in gets overflowing pages.

---

## Persona 2 — the product engineer

Own prev/next, a page-number input, thumbnails, `?page=12`, keyboard, analytics,
restored position. Strict TypeScript.

This one goes well, and `usePageFlip` is why: `canGoNext` / `canGoPrev` computed
against **spreads** (`usePageFlip.ts:74-88`), `orientation` surfaced,
`lastRejection` surfaced, `goToPage(n, 'animate' | 'instant')`. That is a better
hook than most libraries in this space ship. Four real frictions:

**2a. Nothing I am handed can be named.** Every one of these is a `tsc` error
against the published `.d.ts`:

```
TS2614: '@gullabs/react-flipbook' has no exported member 'FlipCorner'
TS2614: ... no exported member 'PageFlipError'
TS2614: ... no exported member 'PageFlip'
TS2614: ... no exported member 'FlipOptions'
TS2614: ... no exported member 'FlipSetting'
TS2614: ... no exported member 'SizeMode'
TS2614: ... no exported member 'PointerKind'
TS2614: ... no exported member 'ReadingDirection'
TS2614: ... no exported member 'FlipOnClick'
TS2614: ... no exported member 'PageFlipErrorCode'
TS2724: ... no exported member named 'TurnRejectedReason' (Did you mean 'TurnRejected'?)
TS2724: ... no exported member named 'FlipbookEventName'
TS2614: ... no exported member 'FlipbookState'
```

Consequences, concretely:

- `flipNext(corner)` takes a `FlipCorner` (`types.ts:84`) that a React-only
  consumer **cannot import**. I have to add `@gullabs/flipbook-core` to my
  `package.json` to pass an argument to a React method — a dependency I did not
  ask for, whose version I now have to keep in step by hand.
- `handle.pageFlip(): PageFlip | null` (`types.ts:83`) returns a type I cannot
  name. Same for `FlipbookState`, the **return type of `usePageFlip`** — so
  `function Controls({ book }: { book: ??? })` is unwritable without
  `ReturnType<typeof usePageFlip>`.
- To `instanceof`-check what a throw is, I need `PageFlipError` — the value, not
  the type — which the React entry does not have.

**Fix:** `packages/react/src/index.ts` should re-export the whole of core's
public type surface plus `FlipCorner`, `PageFlipError`, `FlippingState`. This is
a five-line change and it is the highest value-per-byte item in this document. It
is also the difference between "React binding" and "React binding that assumes
you also installed the engine".

**2b. `usePageFlip`'s `bookProps` is a spread-order trap.** It carries
`onPageChange`, `onPagesChanged`, `onChangeOrientation`, `onLoaded`,
`onTurnRejected` (`usePageFlip.ts:172-199`). Analytics on every turn is the
canonical reason to reach for `onPageChange`, so the first thing I write is:

```tsx
<HTMLFlipBook {...book.bookProps} onPageChange={track} /> // hook state now dead
```

…which silently breaks the hook, because my prop wins. The working version is
manual chaining (`book.bookProps.onPageChange?.(s); track(s);`), which compiles
either way. **Fix:** either give the hook an options bag
(`usePageFlip(0, { onPageChange: track })`) that it composes, or document the
chaining pattern loudly in the hook's docblock. Right now the docblock explains
its own design history at length and never mentions this.

**2c. A thumbnail strip cannot ask "is this leaf on screen?".** `book.page` is
the spread **head** (`usePageFlip.ts:43`), so in landscape leaves 4 and 5 are
both visible and only 4 is reported. The binding solves this internally with
`spreadPages` (`HTMLFlipBook.tsx:176-191`) and explicitly notes that the
collection's spread table is `protected` and neither public method hands back the
members. So every consumer building a thumbnail rail, a mini-map, or a
"currently reading" highlight must **reimplement `spreadPages`**, including the
`hardCovers && first === 0` special case — which `usePageFlip` itself got wrong
once (`usePageFlip.ts:76-79`, "MIN-A"). If the library's own two call sites
needed a bugfix to agree, consumers will not get it right.

**Fix:** `PageFlip.getVisiblePages(): number[]` on the façade, and
`visiblePages: number[]` on `FlipbookState`. See §B.

**2d. Restoring a saved position / deep link.** This works and is well designed:
`initialPage` opens without announcing (`PageFlip.ts:812` `openingFresh`), and
controlled `page` + `pageTransition="instant"` is exactly right for `?page=12`
(`types.ts:113`). The default of `'animate'` for the controlled path is a good
call. No complaint — but note `initialPage` is in the remount key
(`HTMLFlipBook.tsx:107`), so a consumer who wires `initialPage={queryPage}`
instead of `page={queryPage}` rebuilds the engine on every navigation. Worth one
sentence in the docs.

---

## Persona 3 — the integrator

Design system, live CMS content, RTL Arabic, a11y audit.

**The a11y story is the best I have seen in this category** and should be
advertised much harder than it is. Real `<button>`s in the tab order revealed on
focus (`HTMLFlipBook.tsx:1147-1191`), `aria-disabled` rather than `disabled` so
focus is not stolen at a boundary, `role="group"` with a deliberate refusal to
use `role="application"`, focus rescue before `inert` lands
(`HTMLFlipBook.tsx:902-907`), unmodified-arrows-only so `Alt+←` stays Back,
`touch-action: pan-y pinch-zoom` so low-vision zoom survives (`styles.ts:5-13`).
Every one of those is a decision most libraries get wrong. The README's
Accessibility section (`README.md:151-158`) undersells it to five bullets.

Frictions:

**3a. Style injection cannot be turned off.** `ensureFlipbookStyles()` is called
unconditionally from the `UI` constructor (`UI/UI.ts:92`) and appends a `<style>`
to `document.head`. A design system with a strict CSP (no `style-src
'unsafe-inline'`) cannot use this without a nonce it has no way to supply. The
package ships `@gullabs/flipbook-core/style.css` for exactly this case, but there
is **no setting to say "I am loading the CSS myself, do not inject"**. And
`HTMLFlipBook` renders a _second_, duplicate inline `<style>` block
(`HTMLFlipBook.tsx:1119-1126`) with rules that `FLIPBOOK_CSS` already contains
(`styles.ts:28-32`) — the source comment in `styles.ts` says they were moved there
_because_ of CSP, but the React copy was never removed.

**Fix:** an `injectStyles?: boolean` (or `styleNonce?: string`) setting, and
delete the duplicated `<style>` in `HTMLFlipBook`.

**3b. Reaching the engine's DOM takes two collaborator getters.** To hang an
overlay or an `IntersectionObserver` on the book's block I write
`ref.current?.pageFlip()?.getUI().getDistElement()`. It compiles — but it routes
me through `getUI()`, whose return type I am not allowed to name (§B), for one
element. **Fix:** `PageFlip.getBlockElement(): HTMLElement`, plus a
`blockRef`/`onMount` escape hatch on `HTMLFlipBook` so React consumers do not
need the engine at all.

**3c. CSS class names are undocumented API.** `.stf__parent`, `.stf__wrapper`,
`.stf__block`, `.stf__item`, `.stf__outerShadow`, `.stf__innerShadow`,
`--soft`/`--hard`, `[data-flipbook-controls]`, `[data-flipbook-control="prev"]`,
`[data-flipbook-live]`, `[data-flipbook-lazy]`. Styling the built-in controls to
match a design system requires all of these, and none appear in the README. They
are `stf__`-prefixed for upstream compatibility, which is fine, but a "Styling"
section listing the stable hooks (and saying which are _not_ stable) is missing.
`controls="visible"` is only useful once you know what to select.

**3d. RTL is turn-direction only, and that is correct — but the seam is thin.**
`readingDirection: 'rtl'` mirrors turns (`Render.ts:1044`, `Flip.ts:363`) and
never touches pointer coordinates, which is the right call and is documented
(`README.md:157`). What is missing: the root gets no `dir` attribute, so I must
wrap it myself; and the built-in control buttons render prev-then-next in DOM
order regardless of `readingDirection`, so in an Arabic book the visually-first
button is "next" only if my own CSS flips them. `controlLabels` is localisable
(good), but the live region gets no `lang`, so a VoiceOver user with an English
system voice hears Arabic page announcements read as English. **Fix:** pass
`dir`/`lang` through, or document that the consumer must own the wrapper.

**3e. Live CMS content.** Keyed children with stable CMS ids work, and the
reference-comparison rebuild guard (`HTMLFlipBook.tsx:816`) is the right design.
But the reader's position is carried across a rebuild **by index**
(`PageFlip.ts:743`), so inserting a page at position 2 silently shifts the reader
by one leaf. For a live-editing CMS that is a visible glitch and there is no way
to opt out or to say "keep me on the leaf with id X". Not necessarily worth a
feature — but it should be a documented consequence.

---

## Persona 4 — the extender

This is where the API leaks, and it leaks in an unusual direction: **almost
everything internal is exported, and almost nothing internal is extensible.**

**4a. I can subclass the renderer. I cannot install it.**

```ts
class MyRender extends HTMLRender {} // compiles fine
```

…and then there is no way to get `PageFlip` to use it. `loadFromHTML` hard-codes
`new HTMLRender(...)` (`PageFlip.ts:702-705`), and the only seam that takes one,
`attachMode(ui, render, pages)`, is marked `@internal` and documented as
unsupported (`PageFlip.ts:458-460`). Identically for `UI`, `PageCollection`,
`Page`. So `Render`, `HTMLRender`, `Page`, `HTMLPage`, `PageCollection`,
`HTMLPageCollection` are exported **as values** — the only reason to export a
class as a value rather than a type is `new` or `extends` — and both are dead
ends. `docs/WEBGL_RENDERER.md` already concludes `Render` is the wrong seam; the
exports say the opposite.

**4b. `getPage(i)` hands back an object I can only damage.**

```
TS2339: Property 'getElement' does not exist on type 'Page'
```

`getElement()` is on `HTMLPage` (`Page/HTMLPage.ts:370`), but `PageFlip.getPage`
is typed `Page` (`PageFlip.ts:1333`). So the one genuinely useful read on a page
— its DOM node — is unreachable without a cast. Everything that _is_ on `Page`
is a per-frame setter the render loop owns: `setPosition`, `setAngle`,
`setArea`, `setHardAngle`, `setDensity`, `setDrawingDensity`, `setOrientation`.
Calling any of them from outside is overwritten on the next frame at best.
`PageCollection.getPages(): Page[]` has the same problem in bulk.

**4c. Driving my own animation from the fold is half-possible.**
`getFlipController()?.getCalculation()` returns a `FlipCalculation` — and:

```
TS2459: Module '@gullabs/flipbook-core' declares 'FlipCalculation' locally, but it is not exported
```

I can _call_ methods on it via inference, but I cannot write
`function progress(c: FlipCalculation): number` — I cannot put it in a signature,
a props type, or a `useRef`. Same failure for `UI`:

```
TS2459: Module '@gullabs/flipbook-core' declares 'UI' locally, but it is not exported
```

`getUI(): UI` is a public method whose return type is not part of the public API.
That is not a style question, it is a hole: `ReturnType<PageFlip['getUI']>` is
the only workaround, and it is the sort of thing consumers cargo-cult and then
break on the next release.

**4d. There is no "is a turn possible?" question.** `flipNext()` returns `false`
and emits `turnRejected` — that is a good refusal contract, but it is _act then
find out_. To disable a button before clicking it, I have to either mirror
`usePageFlip`'s spread arithmetic, or reach
`getPageCollection().getCurrentSpreadIndex() < getSpreadCount() - 1` through a
getter. A vanilla consumer following `README.md:158` ("wire `flipNext`/`flipPrev`
to your own buttons; listen for `turnRejected`") ends up with buttons that look
enabled at the end of the book.

**4e. The exported algorithm helpers are test fixtures.** `curlGoesLeft`,
`backCurlAppearsRight`, `portraitCurlLocal`, `convertPageToGlobal`,
`shouldDrawBottomPage`, `getPortraitFlippingPage`, `FLIP_DIR_FORWARD/BACK` — I
tried to find a consumer use for each and could not. `backCurlAppearsRight` is
literally a predicate for asserting the fork's flagship regression is fixed. They
are in `index.ts` so `tests/geometry.test.ts` can `import { … } from
'@gullabs/flipbook-core'` — but 18 of the core tests already import from
`'../src'`, and vitest aliases the package name to `src` anyway. **Nothing forces
these to be public.** Meanwhile their signatures are consumer-hostile:
`portraitCurlLocal(pageWidth, height, corner)` — I passed a `FlipDirection` as
the third argument on my first attempt, because "the curl is identical for both
directions" is precisely the non-obvious invariant a consumer does not know.

---

## A. Public vs internal — export-by-export

`packages/core/src/index.ts` (56 lines) is the entire supported surface; the
`exports` map correctly blocks deep imports. Verdict per export:

### Genuinely public — keep

| Export                                                                                                       | Why a consumer needs it                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `PageFlip`                                                                                                   | The façade.                                                                                            |
| `FlipOptions`, `FlipSetting`, `LiveSetting`                                                                  | Prop typing, `getSettings()` round-trip.                                                               |
| `SizeMode`, `ReadingDirection`, `FlipOnClick`, `PointerKind`, `ALL_POINTERS`                                 | Setting values, narrowing.                                                                             |
| `PageFlipError`, `PageFlipErrorCode`, `PageFlipErrorKind`                                                    | `instanceof` + `switch (e.code)` + "is this my fault" (`errors.ts:50`). Best-designed part of the API. |
| `FlipbookEventMap`, `FlipbookEventName`, `WidgetEvent`, `BookSnapshot`, `TurnRejected`, `TurnRejectedReason` | Handler typing. `FlipbookEventName` was added for exactly the right reason.                            |
| `FlippingState`                                                                                              | `changeState` payload.                                                                                 |
| `FlipCorner`                                                                                                 | Argument to `flipNext`/`flipPrev`.                                                                     |
| `Orientation`                                                                                                | Field of `BookSnapshot`.                                                                               |
| `Point`, `PageRect`, `Rect`, `RectPoints`, `Segment`                                                         | `getBoundsRect()` return, `startUserTouch` argument.                                                   |
| `FLIPBOOK_CSS`, `ensureFlipbookStyles`                                                                       | CSP / SSR pre-injection. Marginal (the engine already calls it) but harmless and cheap.                |

### Should not be exported — implementation classes

`Render`, `HTMLRender`, `Page`, `HTMLPage`, `PageCollection`,
`HTMLPageCollection`, `Flip`, `Settings`.

- **`Settings`** is the clearest: a consumer never constructs it — `PageFlip`
  does (`PageFlip.ts:171`). Exporting the class means `new Settings().resolve()`
  is API, so the `named` parameter's subtle semantics (`Settings.ts:274-287`)
  become a contract. Export the _types_, not the class.
- **`Render`/`Page`/`PageCollection`/`Flip`** are reachable via the getters, so
  the _types_ must be nameable — but they should be **type-only exports**
  (`export type { Render }`), which removes `extends` and `new` from the contract
  without breaking anyone who annotates a variable. That single change resolves
  4a honestly: today the exports advertise an extensibility story that does not
  exist.
- **`HTMLRender`, `HTMLPage`, `HTMLPageCollection`** are not returned by any
  public method at all (`getRender()` is typed `Render`). Nothing needs them.
  Drop entirely.
- **`PageDensity` / `PageOrientation`** — density is set from HTML via
  `data-density="hard"`, so the const object buys a consumer nothing. Drop or
  keep as types.

### Should not be exported — internal algorithms

`convertPageToGlobal`, `portraitCurlLocal`, `curlGoesLeft`,
`backCurlAppearsRight`, `FLIP_DIR_FORWARD`, `FLIP_DIR_BACK`, `Curl`,
`CurlCorner`, `getPortraitFlippingPage`, `shouldDrawBottomPage`,
`safePageBackground`, `isOpaquePageBackground`, `effectiveFlippingTime`,
`prefersReducedMotion`, `FlipDirection`.

Every one is an invariant-locking helper for this fork's own regression tests.
"Why on earth is this public?" applies most sharply to `backCurlAppearsRight`
and `curlGoesLeft` (pure test predicates), `shouldDrawBottomPage` (a boolean the
renderer asks itself), and `effectiveFlippingTime` / `prefersReducedMotion`
(read inside `Render`; a consumer wanting the media query writes
`matchMedia('(prefers-reduced-motion: reduce)')`).

Two are worth arguing about and both should stay, but as _values_, not
algorithms: `DEFAULT_PAGE_BACKGROUND` (a consumer matching their CSS to the
fold colour genuinely wants it) and `FLIPBOOK_INTERACTIVE_SELECTOR` /
`isInteractivePointerTarget` (a consumer with a custom widget wants to know
what the engine treats as interactive so they can match it). Keep those two;
move the rest to `src` and switch the tests to `'../src/...'` imports, as 18
core tests already do.

**Net:** the supported surface would go from ~50 names to ~25, and every removed
name is one you can never take back after publish.

---

## B. The collaborator getters

What I actually needed, per persona, versus what the getter gives me:

| Getter                                | What I actually wanted                                                                                                                                                               | Real need                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `getUI(): UI`                         | `.getDistElement()` — the block, to portal/overlay/observe into. Both the React binding (`HTMLFlipBook.tsx:725`) and my persona-3 code use it for **only** this.                     | `getBlockElement(): HTMLElement`                                                                     |
| `getRender(): Render`                 | "is a turn animating right now" (to suppress my tooltips/analytics) and the book's pixel rect. `getBoundsRect()`/`getOrientation()` already cover the rect.                          | `isAnimating(): boolean`                                                                             |
| `getPageCollection(): PageCollection` | "which leaves are on screen", "is page N on screen", "how many spreads". The binding itself uses only `getSpreadIndexByPage` + `getCurrentSpreadIndex` (`HTMLFlipBook.tsx:941-943`). | `getVisiblePages(): number[]`, `isPageVisible(n): boolean`, `getSpreadCount(): number`               |
| `getFlipController(): Flip \| null`   | Two unrelated things: (a) "is the engine loaded yet" — the binding uses it as exactly that null-check (`HTMLFlipBook.tsx:923`); (b) fold progress for a custom animation.            | `isReady(): boolean`, and `getFoldProgress(): number \| null` (0–1) if (b) is to be supported at all |
| `getPage(i): Page`                    | The page's DOM element. Which does not typecheck (§4b).                                                                                                                              | `getPageElement(i): HTMLElement \| null`                                                             |

### Proposed façade

```ts
class PageFlip {
  // lifecycle
  isReady(): boolean; // replaces the getFlipController() null-check
  isAnimating(): boolean; // replaces getRender().isAnimating()

  // where the reader is
  getVisiblePages(): number[]; // spread members, in reading order
  isPageVisible(page: number): boolean;
  getSpreadCount(): number;
  canTurn(direction: 'next' | 'prev'): boolean; // §4d — ask before you act

  // DOM
  getBlockElement(): HTMLElement; // replaces getUI().getDistElement()
  getPageElement(page: number): HTMLElement | null; // replaces getPage(i)
}
```

With those, **`getUI()`, `getPage()` and `getPageCollection()` can disappear
entirely**, and `getRender()` / `getFlipController()` become type-only escape
hatches (or go too). `getVisiblePages()` alone removes the duplicated
`spreadPages` logic from the React binding, from `usePageFlip`, and from every
consumer building a thumbnail strip — three copies of a rule that has already
been wrong twice in this repo.

`canTurn` deserves a note: it is not redundant with the `false`-plus-
`turnRejected` contract. That contract answers "did my turn happen"; `canTurn`
answers "should this button be enabled", and today the only honest answer
requires spread arithmetic a consumer cannot see.

**Also fix, whatever else happens:** either export `UI` and `FlipCalculation` as
types, or change the getters to return something nameable. A public method whose
return type is not in the `.d.ts` is a defect, not a design choice.

---

## C. Missing — things I reached for and could not find

1. **`getVisiblePages()` / `visiblePages` on `FlipbookState`.** §2c, §B. Highest
   value item after the React re-exports.
2. **The React entry does not re-export core's types.** §2a. Thirteen names,
   verified. `FlipCorner` and `PageFlipError` are the urgent two because they are
   _values_ needed to call the React API.
3. **`FlipbookState` is not exported** from `@gullabs/react-flipbook`, so the
   return type of the package's own hook is unnameable.
4. **A single "book state changed" signal.** Today the counter needs
   `onLoaded` + `onPageChange` + `onPagesChanged` to be correct, and the failure
   mode of binding only the obvious one is a wrong number on screen (§P1).
5. **`canTurn(direction)`** — §4d.
6. **A styling contract.** §3c: no documented class/data-attribute list, no
   `styleNonce`, no way to opt out of `<style>` injection under CSP.
7. **A page-label API.** `HTMLFlipBook.tsx:200` already flags this: the live
   region says "Page 4 of 32" using `index + 1`, which is wrong for any book with
   front matter — i.e. any real book. The seam is identified in the source and
   there is no public prop for it. A `pageLabel?: (index: number) => string` on
   the React component (and used by `defaultLiveText`) closes it.
8. **Nothing to observe orientation without React.** A vanilla consumer building
   responsive controls binds `changeOrientation`, which only fires on _change_
   (`HTMLFlipBook.tsx:824` works around this by seeding from
   `getOrientation()`). `getOrientation()` exists, so this is fine — but the
   workaround being necessary in the library's own binding suggests documenting
   "seed from the getter, then subscribe".
9. **`updateFromHtml` is not on the documented path for vanilla consumers.**
   README shows `loadFromHTML` only. Anyone with dynamic content will find
   `updateFromHtml` by autocomplete and not know it exists.
10. **No `getVersion()` / no `data-flipbook-version`.** Trivial, but for a
    library that lives inside other people's design systems it is the first thing
    a support ticket needs.

---

## D. Well-designed vs leaking internals

### What is genuinely well designed

- **The error model.** `code` as a closed union plus `kind` derived from a table
  (`errors.ts:50-70`) plus `setting` for field-level attribution is better than
  Stripe's or Prisma's error surfacing, and strictly better than any DOM library
  I know. `switch (e.code)` is exhaustive; `if (e.kind === 'internal') report()`
  is a one-liner.
- **The event model.** One payload shape everywhere (`BookSnapshot`), `once()`,
  reference-matched `off(event, cb)`, snapshotted listener lists with
  `EventEmitter`'s exact semantics, first-error-wins with the rest deferred
  (`EventObject.ts:340-431`). This is `EventEmitter`-grade and the docblocks say
  _why_, which is rare.
- **Settings validation.** Rejecting `'false'` (`Settings.ts:383-385`) and
  translucent `pageBackground` (`Settings.ts:425`) with messages that name the
  key, the received value and the expectation is what a good API does. The
  compile-time `LiveSetting` fence on `updateSettings` (`Settings.ts:150`) is a
  genuinely clever use of the type system to encode a runtime lifecycle rule.
- **`destroy()` has a written, testable contract** (`PageFlip.ts:180-226`)
  covering which calls throw, which no-op, and what is released. Most libraries
  ship "call destroy" and nothing else.
- **The React binding's a11y work.** §3.
- **`usePageFlip` returning one atomic snapshot** rather than four independent
  setters, and `goToPage` as an action rather than `setPage` as a setter
  (`usePageFlip.ts:125-139`). That is the right lesson learned.

### Where it leaks

The pattern is consistent and it has one cause: **`index.ts` was written from
the inside out.** It exports what the test suite imports and what the engine
happens to have classes for, rather than what a consumer needs. Compare:

- **`framer-motion`** exports `motion`, `AnimatePresence`, hooks, and its own
  types — and nothing about its internal `VisualElement`/`Projection` machinery,
  even though those are large, interesting, and would be useful to somebody. It
  ships `MotionValue` (needed) and hides the projection tree (not).
- **`@tanstack/react-table`** exports its column/row/table _types_ aggressively
  and its internal feature modules not at all. Its type surface is enormous; its
  class surface is zero.
- **CodeMirror 6** is the counter-example this repo may be reaching for: it
  genuinely exposes internals, but it also ships a real extension system
  (`StateField`, `ViewPlugin`, facets). Exposing internals **without** an
  installation seam — §4a — is the worst of both: consumers read the exports as a
  promise of extensibility, build on `Render`, and discover the promise is empty.
- **`page-flip@2.0.7` upstream** exported the same class set, which is likely
  where this came from. Inheriting upstream's export list is not a compatibility
  requirement for a package with a new name at a new major.

The concrete tell that this is a leak rather than a policy: `getUI(): UI` where
`UI` is not exported. A designed surface cannot produce that; an inside-out one
produces it by omission.

**The good news:** none of this is published yet, and the fix is subtractive plus
a handful of façade methods. After publish, every one of these names is a
semver-major to remove.

---

## Prioritised

**Before 3.0.0 (breaking after publish):**

1. Re-export core's public types + `FlipCorner` + `PageFlipError` from
   `@gullabs/react-flipbook`; export `FlipbookState`. (§2a, §C2, §C3)
2. Export `UI` and `FlipCalculation` as types, or stop returning them. (§4c)
3. Prune `index.ts`: drop the algorithm helpers and the `HTML*` classes; make
   `Render`/`Page`/`PageCollection`/`Flip`/`Settings` type-only. (§A)
4. Add `getVisiblePages()`, `canTurn()`, `getBlockElement()`,
   `getPageElement()`, `isReady()`, `isAnimating()`; retire `getUI()`,
   `getPage()`, `getPageCollection()`. (§B)

**Before 3.0.0 (cheap, non-breaking):**

5. README: a page counter in the React snippet, and one line saying
   `onPageChange` does not fire on open. (§P1) — _the single biggest
   first-impression fix in this document._
6. Delete the duplicated `<style>` in `HTMLFlipBook`; add `injectStyles` /
   `styleNonce`. (§3a)
7. A "Styling" section listing the stable class/data-attribute hooks. (§3c)
8. `pageLabel` prop for the live region. (§C7)

**Post-3.0, non-breaking:**

9. `onBookState` (or document the four-handler pattern). (§C4)
10. Options bag for `usePageFlip` so `onPageChange` composes. (§2b)
11. `dir`/`lang` pass-through for RTL. (§3d)
