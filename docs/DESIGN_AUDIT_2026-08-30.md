# Pre-publish design audit — 2026-08-30

**Status:** proposal, awaiting Codex signoff and owner approval. Nothing here is
built.

**Why now.** 3.0.0 is not on npm. There are zero consumers. Every item below is
free today and a major version after the first publish. The owner's framing:
_"I do not care about downstream or upstream, I want to fix and make it A++"_
and _"when we fix the design, we do it properly and fix it all the way, not just
the api or interface."_

**Method.** Four independent read-only audits — events, settings, React binding +
error model, core internals — each briefed that backward compatibility is not a
constraint, that "upstream did it this way" is not a justification, and that
saying "this part is well designed" was a required output rather than a
courtesy. Roughly fifty findings, deduplicated here into 24 items. A concurrent
Codex review of the last ten commits contributed the four correctness items in
Part 1.

Every item is traced to `file:line` in the audit reports. Where two audits found
the same thing from different directions it is noted, because independent
convergence is the strongest signal available.

---

## Part 0 — what is NOT changing

Stated first so the rest reads as a list of defects rather than a demand to
rewrite the engine. All four audits were asked to defend what is good, and did:

- **`EventObject`** — the listener snapshot, first-error-sync/rest-async
  isolation, the `once` wrapper tagged so `off(event, fn)` cancels it, the
  nesting **depth** rather than a boolean, and dropping the permissive
  `on(string, …)` overload. Judged better than most emitters in wide use.
- **`foldSide` + `Render.setDirection`** — applying the RTL mirror _inside the
  setter_ so there is no un-mirrored path to the field. Make-illegal-states-
  unrepresentable, not a comment.
- **The parked render loop** — `dirty` / `framePending` / `running` with every
  mutator routed through `requestFrame()`, making "is there anything to draw" a
  decidable question.
- **The portal ownership model** and `HTMLUI.adopt`/release. Hard-won, correct.
- **The `inert` + focus-rescue a11y path.**
- **The flat 24-key settings object** — nesting would break the live shallow
  merge every collaborator depends on, and cost bytes for discoverability a docs
  table gives free.
- **Strict boolean validation**, `PageFlipError.cause`, the throw-vs-boolean
  split between explicit navigation and "turn if you can", and the extracted
  pure modules (`geometry`, `flippingPage`, `bottomPage`, `reducedMotion`).
- **`internal.ts`'s symbol seams** — a real answer to package-private, honestly
  scoped.

---

## Part 1 — correctness, outstanding now (Codex round 6)

These are defects in shipped code, not design opinions. They should land first
and independently of everything below.

### C1. A settled RTL change leaves the UI gesture alive — MAJOR

`updateSettings` cancels the animation, abandons `Flip`, and calls
`resetUserGesture()` — but that clears only `PageFlip`'s three fields. `UI`
keeps `touchPoint` and `activePointerId`. Drag left under LTR, switch to
`rtl`, release within the swipe timeout: the stale gesture is processed under
the **new** RTL mapping and commits a turn the reader never made. This is the
same finding the internals audit reached from the other side (item 15: gesture
state split across two objects, resynced by hand in five places).

### C2. A first load with a nonzero `startPage` fabricates a pre-`init` `flip` — MAJOR

With no previous collection, `attachMode` invents an outgoing index of 0, seeds
it, then shows `startPage` — emitting `flip(2)` _before_ `init`. The reader was
never observably on page 0; `getCurrentPageIndex()` throws before load. ADR 0003
says `init` is the first-load announcement, so this is that ADR's own rule
broken by its own fix.

### C3. Two more named seams of the shape the symbols were meant to close — MAJOR

`updateState()` and `updateOrientation()` are still public, `@internal`-tagged,
and present in the published `.d.ts`. A consumer can announce `READ` while
`getState()` returns `FLIPPING`, or announce portrait while the renderer stays
landscape. Same defect as `updatePageIndex`, which was just fixed; the inventory
was incomplete. Codex confirms there is no fifth.

### C4. Four test files each admit a passing wrong implementation — MAJOR

Adversarially constructed, one per file:

- `flip-event-semantics` — make absolute `PageFlip.flip(page)` a no-op; the file
  never exercises the absolute animated API.
- `rtl-layout` — remove the RTL inversion from `UI.swipeDirection()`; the file
  never completes a swipe.
- `shadow-direction` — invert the **soft outer** gradient; only the soft inner
  and the hard faces are asserted.
- `hard-back-draw` — restore the wrong LEFT `drawHard()` translation/origin while
  keeping the asserted `rotateY` and z-index.

### C5. ADR 0003 is not exhaustive — MINOR

It calls the guarded dispatch "the whole change", omitting the index inheritance
and the seam removal, and documents only `clear()` as a silent nonzero→0
transition when empty `replacePages`, empty `updateFromHtml` and an empty reload
do it too.

### …and the open question is answered

**`--right` is correct** for the underside of a hard BACK fold. The flipping and
bottom page are the same leaf; RIGHT selects `drawHard`'s right-leaf base —
origin at the left edge, translation to the spine — so the negative BACK
rotation starts with the leaf visually left and swings it shut onto the right.
LEFT would rotate about the wrong edge or expose the backface-hidden side. The
note in `hard-back-draw.test.ts` should be replaced with an assertion.

---

## Part 2 — the design

Ranked by what most improves the library for someone using it for the first
hour. **R** = recommended, **D** = needs an owner decision.

### Tier 1 — silent failures. The class this fork exists to remove.

**D1 — A non-host child yields a blank or, worse, a silently misaligned book. (R)**
`collect` is attached via `cloneElement(el, { ref })`; a component that does not
forward its ref never calls it. With _some_ host children the node list is
shorter than the page list, `updateFromHtml` succeeds, and every index the
binding computes — `inert`, the live region, `visiblePages` — is against a
different list than the engine's. Pages silently mis-inert and the announcement
silently lies. This constraint is documented in three examples and the README,
which is the signal: a rule needing that much prose and producing no runtime
signal is an API defect, not a docs gap.
**Shape:** index-keyed slots — `collect(i)` writes `slots.current[i]`,
pre-filled `null`. A null slot after commit is _provably_ a child that could not
be reffed, so throw naming the index and the component. Order comes from the
index, so the append-order reset dance and its documented "bail out BEFORE
clearing" hazard disappear, and StrictMode's re-attach becomes idempotent.
**Keep `children` as the model** — a `pages={data}` prop would force a
`renderPage` callback, re-invent keys, and lose arbitrary JSX inside a leaf. It
is the ref contract that is under-specified, not the model.

**D2 — `useMouseEvents: false` disables touch and pen. (R)**
There is one Pointer Events path and no mouse path; the flag gates the entire
registration. A consumer wanting "no mouse turning, keep swipe on tablets" ships
a book that cannot be turned on a phone, and nothing corrects them.
**Shape:** `pointerInput: boolean`, default `true`.

**D3 — `pageBackground` is the one setting that fails silently. (R)**
Every other invalid value throws a typed error; this one substitutes white via
`safePageBackground`. The accepted grammar is a narrow legacy subset, so
`oklch()`, `color-mix()`, modern `rgb(… / …)` and CSS variables are all rejected
— an ordinary 2026 colour produces a white fold with no diagnostic.
**Shape:** throw `INVALID_SETTING` at the boundary for a non-empty rejected
value; keep the silent fallback at draw time, where it guards the untyped path
and is correct. Rename to **`foldBackground`** — it is the fill of the _turning_
leaf, which the setting's own doc comment already says.

**D4 — `size: 'fixed'` silently overwrites four settings the consumer set. (R)**
`minWidth`/`maxWidth`/`minHeight`/`maxHeight` are overwritten with
`width`/`height`, and `getSettings()` then reports the engine's values as though
the consumer had written them. `size: 'fixed', minWidth: 200` is a config a
reasonable person writes; it does nothing.
**Shape:** throw if any bound was _explicitly supplied_ under `'fixed'`. The
`definedOnly` helper already distinguishes supplied from defaulted, so this is a
condition, not machinery.

**D5 — `renderOnlyPageLengthChange` freezes page content. (R — delete)**
With it on, changing a page's content without changing the count short-circuits
before `setPages`, so the book shows stale content forever with no signal. The
cost it was invented to avoid is already paid by the `sameNodes` reference gate;
what remains is one React reconciliation. It already needed a carve-out to stop
it breaking lazy mounting — a second is waiting.

**D6 — `props.startPage` changes are silently ignored, or produce an
unactionable warning. (R)**
`pickSettings` includes `startPage`, but the settings effect does not list it as
a dependency. Change it alone → nothing. Change it _with_ any live prop →
`updateSettings` fires and the consumer gets a console warning naming an engine
method they never called. Two layers disagreeing by accident of a dependency
array.

**D7 — smaller silent failures. (R)** `usePageFlip(999)` clamps with no signal
because `bookProps` omits the error handler. `Home`/`End` swallow the refusal
that `ArrowLeft`/`Right` report. `handle.turnToPage` before mount is a silent
no-op and after mount throws.

### Tier 2 — names that state something false

Each of these makes a factual claim the code contradicts. Grouped because they
should land as one pass, one migration entry, one ADR.

**D8 (R).** `disableFlipByClick: true` still flips on corners → **`flipOnClick:
'anywhere' | 'corners' | 'never'`**, which also opens the "drag only" state that
is currently unreachable. `showPageCorners` shows nothing; it enables a hover
peel → **`foldCornerOnHover`**. `showCover` is the layout switch for the entire
book, not a visibility toggle → **`hardCovers`**. `clickEventForward` forwards
nothing; the engine declines to fold → **`respectInteractiveContent`**.
`mobileScrollSupport` tests `pointerType !== 'mouse'`, so it covers pen and any
touch surface, not "mobile" → **`allowTouchScroll`**. `size: 'stretch'` does not
stretch, it fits preserving aspect ratio → **`sizing: 'fixed' | 'responsive'`**.

**D9 (D).** `direction` (`'ltr'|'rtl'`) sits one word from `FlipDirection`
(`FORWARD`/`BACK`), and the type is named `FlipDirectionSetting` — which reads
as "the setting form of `FlipDirection`", exactly what it is not, and both
autocomplete together. **Shape:** `readingDirection: ReadingDirection`. Leave
`FlipDirection` alone; the word "direction" then never appears unqualified.

**D10 (R).** The `update` event fires only on collection replacement, never on a
repaint, and shares its name with `PageFlip.update()` which does not cause it.
`collectionRebuild` is named for an internal class. They always fire together,
atomically, with the same `page`. **Shape:** merge into one
**`pagesChanged: { page, pageCount, orientation }`**, which also deletes ~60
lines of atomic-pair machinery whose whole purpose is a cross-event guarantee
that one event does not need. `update` is then free for a real repaint signal if
one is ever wanted.

**D11 (R).** `mode` means orientation in the `init`/`update` payloads, while
"mode" is this fork's word for _renderer_ mode (`attachMode`, `WRONG_MODE`, ADR
0002's "canvas mode"). Rename the field **`orientation`**.

**D12 (R).** Internal names: `getSpread()` returns the spread **table**;
`distElement` is `.stf__block` while `PageFlip.block` is the host — two nodes,
one word; `HTMLRender.element` is a third name for the same node;
`this.calc.calc(pos)`; `Render.timer` is a timestamp; `foldFill` is a bare alias
of `normalizePageBackground`. Plus **four docblocks attached to the wrong
symbol** and two swapped JSDocs (`getCurrentPageIndex` and
`getCurrentSpreadIndex` document each other) — in a codebase where the comments
_are_ the design record, that is a defect in the primary artifact.

### Tier 3 — the contracts

**D13 — The controlled `page` prop is not controlled. (R)**
The effect depends on `[controlledPage, pages]`; nothing re-asserts when the
_engine_ moves. A swipe turns the book, the prop is unchanged, the effect never
re-runs, and the book stays where the user put it. The component knows it
disagrees and says nothing. `<input value="a">` does not become `"b"`.
**Shape:** add `enginePage` to the deps and re-assert. Then `page` without
`onPageChange` is a genuinely locked book and `page` + `onPageChange`
round-trips.

**D14 — The controlled path never animates. (R)**
It calls `turnToPage` (instant); the ref's `flipToPage` calls `engine.flip`
(animated). In a page-_flip_ library the declarative path silently opts out of
the entire point, undiscoverably. The engine's own comments describe the better
design — `Flip.flipToPage` reasons explicitly about being "driven straight from
the React binding's controlled `page` prop", which is not what the binding does.
**Shape:** controlled `page` calls `engine.flip`, plus
`pageTransition?: 'animate' | 'instant'` for deep links. `engine.flip` returns
on a same-spread request rather than throwing, so the hand-rolled spread-
membership check can be deleted.

**D15 — Four navigation mechanisms, three failure contracts, no stated primary. (R)**
`flipNext`/`flipPrev` return `boolean` and never throw; `turnToPage`/`flipToPage`
throw after mount and are silent no-ops before it. So the same call is an
uncaught throw that takes down the React tree, or nothing, depending on timing.
The repo's own example app uses three of the four mechanisms at once — the
honest signal that nothing is primary.
**Shape:** declare `page` + `onPageChange` primary and the ref an escape hatch
(D13 and D14 are what make that true); unify the handle on `boolean` + a
reported refusal; keep the throw on the _core_, where the caller can catch.

**D16 — `turnRejected` cannot answer the question the README recommends it for. (R)**
Its payload is `{reason, code?}` — not which direction was refused, not the
target. The canonical use is disabling a next/prev button at a boundary, and
with `reason: 'boundary'` alone the consumer cannot tell which button. They must
re-derive it from the engine, which is the rejected option (d) of ADR 0003 in a
new place. And `code?: string` is the third un-narrowed copy of what `errors.ts`
deliberately made a union.
**Shape:** `{ reason: 'boundary' | 'disabled' | 'superseded' | 'notReady' |
'invalidPage'; direction: 'next' | 'prev' | null; targetPage: number | null;
code?: PageFlipErrorCode }`. **`onNavigationError` then disappears** — it is a
React-only fourth channel for a condition the engine already reports, hardcoding
`code: 'INVALID_PAGE'` and discarding the real `PAGE_NOT_IN_SPREAD` distinction
the core paid for.

**D17 — `init` is not fit to be the seeding path ADR 0003 just made it. (R)**
It fires per _load_, so a reload emits a second `init` indistinguishable from the
first. It is scheduled on `setTimeout(…, 1)`, so in the React binding — which
loads an empty book then adds pages in a later effect — whether it describes the
real book or an empty one is a race. And it carries no `pageCount`, so it cannot
render "page 1 of N"; the repo's own React test hard-codes the count in its
`onInit` handler, which is the strongest available evidence.
**Shape:** two synchronous events — **`ready`** once per engine, **`loaded`** on
every load including the first — both carrying `{ page, pageCount, orientation }`.
Retire `init`: it names a moment the engine has two of.

**D18 — One payload convention, applied everywhere. (R)**
Today there are five: bare `number`, bare enum, `{page, mode}`, `{page,
pageCount}`, `{reason, code?}` — plus React handing `onPageChange` an unwrapped
number while every other handler gets a `WidgetEvent` the consumer must reach
into, and `onNavigationError` getting neither. ADR 0003 already identified that
asymmetry as _why_ consumers bound the wrong event.
**Shape:** every payload is an object; every React handler receives the payload
directly, not a `WidgetEvent`. Keep the wrapper on the engine's `on()` if wanted
— but the binding unwraps uniformly rather than for one prop.
**Also:** drop **`onFlip`**, keep `onPageChange`. Two props for one occurrence is
a support burden forever, and `onPageChange` is the name matching what ADR 0003
made the event mean.

**D19 — Type-level enforcement instead of runtime refusal. (R)**
`width`/`height` are mandatory but typed optional, with defaults (`0`) the
validator always rejects — two values in the defaults object that exist only to
be thrown. And `updateSettings` accepts settings it refuses at runtime with a
`console.warn`.
**Shape:** `FlipOptions` (constructor, `width`/`height` required) and
`LiveSetting = Omit<FlipSetting, 'showCover' | 'startPage'>` for
`updateSettings`. The refusal becomes a compile error for TypeScript consumers;
the runtime check stays for JS. Rename `startPage` → **`initialPage`**.

**D20 — The error model: one axis is missing, three throws escape it. (R)**
24 codes in a flat union, of which ~8 (`COLLINEAR_SEGMENTS`, `INVALID_SPREAD`,
`FLIP_SETUP`, …) are engine-invariant violations a consumer can neither cause
nor fix. `switch (err.code)` — the thing the union exists for — offers 24
branches, 8 of which have one correct handler ("report this"), with no way to
write it once. Separately, three sites throw bare `Error`s, two of them as
control flow inside a broad `catch` on the pointer-move hot path, so a genuine
`TypeError` there is swallowed on every frame of a drag.
**Shape:** add `readonly kind: 'usage' | 'lifecycle' | 'internal'`, derived from
the code by a lookup table. Add `readonly setting?: keyof FlipSetting`, which
also lets eight `INVALID_*` codes collapse into one `INVALID_SETTING` with a
machine-readable key — strictly more information from a smaller union. Convert
the bare throws; narrow the broad catch to an identity-compared sentinel, or
record the blind spot deliberately.

**D21 — Validation messages name a category, not a fact. (R)**
`'Invalid width or height'` does not say which, what was received, or what to
do. This is the first error a new consumer hits — a prop that arrived as a
string from a CMS, a `NaN` from a layout measurement. AGENTS.md already records
that these were golfed for a byte budget that returned **19 bytes**, so the cost
side is measured and ~zero. `updateSettings`' warning text is already exactly
this good and is the model.

### Tier 4 — internal structure

**D22 — `currentPageIndex` is stored but derivable, and fuses two meanings. (R)**
It is always `getSpread()[currentSpreadIndex][0]` except after `destroy()`,
which deliberately leaves it stale. That one staleness has spawned
`resolvedPageIndex`, eight call sites that must remember to use it (each with a
comment naming the bug that happened when one was missed — PF3, L2, L3), the
`INHERIT_PAGE_INDEX` seam, and a `destroy()` comment declining to reset it
because `PageFlip` depends on the staleness.
**Shape:** delete the field; derive the index; keep a private
`lastAnnouncedIndex` used _only_ by the ADR 0003 guard. `resolvedPageIndex`
disappears, the seam can no longer suppress a real `flip` even if reached, and
PF3/L2/L3 stop being three separate bugs. **Removes bytes.**

**D23 — `flipToPage` installs a phantom spread index into public state. (R)**
It writes a deliberately-wrong index into the consumer-reachable
`setCurrentSpreadIndex`, calls `start()`, restores it in a `finally`, then
re-installs it for the instant of commit — because `getFlippingPage(direction)`
can only answer "one spread from wherever I am". Four documented incidents live
on this mechanism, every one of the shape "consumer code ran while a lie was
installed". The guards are right; the mechanism keeps producing them.
**Shape:** `getTurnLeaves(from, to)`. Both methods already compute `current ± 1`
on their first line, so the change is local — and the entire
install/restore/reinstall dance and the `pendingTarget = target ∓ 1` encoding go
with it. **Removes bytes.**

**D24 — The vestigial abstractions actively mislead. (D)**
Three of the four abstract/concrete pairs are not earning their keep, and the
bases are DOM-bound anyway: `Render` measures with `offsetWidth`, sniffs
`navigator.userAgent`, and has an `isSafari()` clip-path workaround; `UI`'s base
holds all the DOM while `distElement` is declared there and assigned only by the
subclass. Two abstract methods against ~40 concrete ones. Meanwhile live
comments still reason about `CanvasRender`, `CanvasUI` and `ImagePage` as though
they constrain the design — a future contributor reads archaeology as
requirements.
**Shape:** collapse `Render`+`HTMLRender`, `UI`+`HTMLUI`, `Page`+`HTMLPage`.
**Keep `PageCollection` abstract** — it is exactly the seam
`docs/WEBGL_RENDERER.md` identifies as the right one, and that should be stated
in a comment. This does not pre-empt the deferred renderer decision; the WebGL
doc's own conclusion is that `Render` is the _wrong_ seam, so removing it
removes a false affordance. **Removes bytes.** Flagged **D** because it touches
the deferred-renderer question, which is the owner's.

**Also in this tier, lower individually but cheap together (R):** gesture state
belongs entirely to `UI`, which already owns pointer identity, capture and
timing — that is C1's structural fix and it deletes five hand-placed
`resetUserGesture()` calls; `Render` should own the element it measures instead
of round-tripping `app.getUI().getDistElement().offsetWidth` through a guarded
accessor that can throw; `Render.update()` should return "the orientation
changed" rather than upcalling into `PageFlip` → `UI` → back into
`Render.update()`, a three-way mutual recursion that runs `computeBounds` three
times and six forced layout reads per orientation change, and whose termination
depends on an assignment order nothing states or tests; six modules import
`FlipDirection` from `Flip/Flip` instead of the `Flip/enums` module created for
exactly that, forming a real `Flip ⇄ Render` runtime cycle that works by
declaration-order luck; and the four re-entrancy counters (correctly four, not
one — book, turn, loop, animation are different lifetimes) should share a
10-line `Epoch` helper so every guard is uniformly shaped and cannot be written
backwards.

**Dead surface to delete (R):** `IFlipSetting`, `IBookState`, and React's
`PageState` — which collides with core's unrelated `PageState` interface, so a
consumer importing both gets two types with one name; `usePageFlip`'s
`setPageCount`, which writes to derived state; `Render.convertRectToGlobal`,
`UI.getWrapper`, `Flip.getCalculation`, `Render.needsContinuousFrames`,
`Page.load`; and `FLIP_DIR_FORWARD`/`FLIP_DIR_BACK`/`curlGoesLeft`/
`backCurlAppearsRight` — test scaffolding published as public API.

---

## What this leaves undecided for the owner

1. **D9** — `direction` → `readingDirection`. Recommended, but it is the most
   visible rename in the set.
2. **D24** — collapsing the renderer abstractions. Touches the deferred
   3D-renderer question.
3. **`usePageFlip`** — complete it (add `orientation`, `state`, bind the full
   handler set) or delete it. After D13–D15 a consumer's own `useState` plus
   `page`/`onPageChange` is the whole hook. Recommendation: complete it;
   `orientation` alone justifies it, since a consumer cannot render correct
   controls without knowing whether one leaf or two are showing.
4. **`flippingTime: 1000`** — a slow default by 2026 standards; ~600 would be
   better. A taste call with no technically better answer, recorded rather than
   decided.

## Sequencing

Part 1 first, standalone. Then Tier 1, which is behaviour and where the user-
visible wins are. Tiers 2 and 3 are one coordinated rename-and-reshape pass with
a single migration entry and an ADR per decision, because doing them piecemeal
means three migration notes for one consumer-visible change. Tier 4 last: it is
invisible from outside, it removes bytes rather than spending them, and items
D22 and D23 each make the next one smaller.
