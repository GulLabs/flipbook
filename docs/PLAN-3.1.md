# 3.1 implementation plan — collapse, frame discipline, turnProgress

Status: SIGNED OFF by Codex (gpt-5.6-terra, 4 review rounds, final session
01a059ac, 2026-08-31). Owner: atif. Written 2026-08-31.

This plan is written to be executed by an implementing agent that has NOT read
this session's history. Follow it in order. Where the plan says MUST, a
deviation needs owner approval first.

## Read these before touching anything

1. [`AGENTS.md`](../AGENTS.md) — working standards. The two owner-mandated
   gates apply to every task below:
   - **Revert-prove every new test**: before committing a fix+test pair, stash
     or revert the fix and run the test; it MUST fail. Record the failing
     output in the commit message or PR description.
   - **Unique anchors**: never make an edit keyed on a non-unique string.
2. [`CLAUDE.md`](../CLAUDE.md) — the invariants list. None of them may regress.
3. [`docs/API-CONTRACT.md`](API-CONTRACT.md) — the locked 3.0 surface.
   Campaigns A and B change NOTHING public. Campaign C is additive-only and
   must be recorded in the contract's ledger as an addition.
4. [`docs/ABSTRACTION-BOUNDARY.md`](ABSTRACTION-BOUNDARY.md) — the decision
   record for Campaign A. The per-pair verdicts there are settled; do not
   re-litigate them.

## Gates — run after EVERY commit, all must pass

`pnpm quality:ci` is the definition of done (AGENTS.md) — it covers build,
typecheck, lint, format:check, coverage, size, workflow checks, isolated
types, and packed-artifact checks. E2E is separate:

```bash
pnpm quality:ci
pnpm test:e2e        # 46+ tests, Chromium + WebKit (build the browsers first:
                     # pnpm exec playwright install --with-deps chromium webkit)
```

For fast inner-loop iteration `pnpm test` / `pnpm typecheck` alone are fine,
but a COMMIT requires both commands above green.

Before running e2e, kill any stale preview server — Playwright's `webServer`
has `reuseExistingServer` and a stale `vite preview` on 4173 serves a stale
engine bundle (this bit us during 3.0):

```bash
pkill -f "vite preview" || true
```

Every commit must leave all gates green. Do not batch several tasks into one
commit "to save gate runs".

---

## Campaign A — collapse the three class pairs, then re-ratchet size

**Why:** each pair is one renderer split in half at an arbitrary line (the
abstract base holds most of the DOM-specific code — measured in
ABSTRACTION-BOUNDARY.md). The collapse deletes inheritance scaffolding,
repays the bundle-size loan (owner policy: the raised 62/16/18 kB ceilings
were explicitly temporary), and simplifies the hot path Campaign B rewrites.

**Template:** `packages/core/src/Collection/PageCollection.ts` — the fourth
pair was already collapsed this way. Read its class-level docblock; replicate
that shape: the abstract file survives, the `HTML*` subclass file is deleted,
the merged class keeps the ABSTRACT's name and file so import paths and the
public `Orientation` re-export (`src/index.ts` line
`export { Orientation } from './Render/Render'`) do not move.

**Hard rules for the whole campaign:**

- One pair per commit. Each pair is collapsed WHOLE or not at all — the
  reverted first attempt at a partial collapse is the repo's cautionary tale.
- Behavior-preserving: no logic change of any kind rides along. If you find a
  bug mid-collapse, note it, finish the collapse, fix the bug in a separate
  commit with its own revert-proved test.
- Every docblock and inline comment from BOTH halves survives the merge unless
  it describes the inheritance itself. The comments encode fixed bugs
  (R1–R8, U1–U8, X1–X8, NF1–NF4…); losing one loses the reason a line exists.
- `protected` members that no longer need to be visible outside the class
  become `private`. Members that were `protected` purely for the subclass and
  are still needed by tests: tests deep-import from `../src/` and may use the
  existing `engine-access.ts` helpers — do NOT widen visibility for tests.
- No public API change. `src/index.ts` must be byte-identical after Campaign A
  except (if unavoidable) an import-path adjustment with identical exports.

### A1. Collapse `UI` / `HTMLUI` (smallest pair — do first)

Files: `packages/core/src/UI/UI.ts` (survives),
`packages/core/src/UI/HTMLUI.ts` (deleted).

1. Move every member of `HTMLUI` into `UI`. Resolve overrides by inlining the
   subclass body into the base method (the base half usually runs first via
   `super.…` — preserve exact execution order).
2. Make `UI` concrete: remove `abstract` from the class and from any abstract
   method the subclass implemented.
3. Update the construction site (`PageFlip.loadFromHTML` /
   `attachMode` in `packages/core/src/PageFlip.ts`): `new HTMLUI(…)` →
   `new UI(…)`. Update all imports of `HTMLUI` (grep the whole repo, including
   `packages/core/tests/**` and `e2e/**`).
4. Delete `HTMLUI.ts`.
5. Run all gates. Run the react project tests specifically —
   `HTMLUI.updateItems` adopt/release is load-bearing for the React binding
   ("Who owns which DOM node" in CLAUDE.md).

### A2. Collapse `Page` / `HTMLPage`

Files: `packages/core/src/Page/Page.ts` (survives),
`packages/core/src/Page/HTMLPage.ts` (deleted).

1. As A1: merge members, make `Page` concrete, keep the public
   `export { PageDensity } from './Page/Page'` in `src/index.ts` untouched.
2. Move `ENGINE_LEAF_CLASSES`, `applyEngineStyle`, and `ENGINE_STYLE_PROPS`
   into `Page.ts` (or a sibling module) — `HTMLUI`/`UI.clear()` imports
   `ENGINE_LEAF_CLASSES`; update that import.
3. Delete every now-redundant `as HTMLPage` cast (they exist only because the
   base type lacked `getElement()`; after the merge `Page` has it). Grep:
   `as HTMLPage` appears in `HTMLRender.ts` and several tests.
4. Preserve the `isTemporaryCopy` cross-instance private access pattern in
   `newTemporaryCopy` — it stays legal (TS `private` is per-class).
5. Gates. Pay attention to `styling-contract.test.ts`,
   `html-render-page.test.ts`, `portrait-back.test.ts` — they pin the flagship
   fixes that live in this class.

### A3. Collapse `Render` / `HTMLRender`

Files: `packages/core/src/Render/Render.ts` (survives — it carries the public
`Orientation` export and the `Shadow` type),
`packages/core/src/Render/HTMLRender.ts` (deleted).

1. As A1. `drawFrame` becomes a concrete `private`/`protected` method (it is
   called from `render()` in the same class; tests reach it via
   `engine-access.ts`, keep whatever visibility that helper needs).
2. `needsContinuousFrames()` stays as a method (its docblock explains why),
   but may become `private`.
3. Construction site in `PageFlip`: `new HTMLRender(…)` → `new Render(…)`.
4. Gates, including the FULL e2e suite on both browsers — this is the rAF
   loop and the shadow painter; jsdom alone cannot vouch for it.

### A4. Re-ratchet the size ceilings

1. `pnpm build && pnpm size` — record the new numbers.
2. Edit the `"size-limit"` array in **`packages/core/package.json`** (three
   entries: raw, brotli, gzip): set each ceiling to the measured
   value rounded UP to the next 0.25 kB (raw) / 0.1 kB (brotli, gzip). The
   ceilings are drift alarms, not aspirations — tight on purpose.
3. Update the "Known gaps" bundle-size paragraph in `CLAUDE.md` and the same
   figures in `README.md` if quoted there. (CLAUDE.md itself warns these
   figures have gone stale twice — do not skip this step.)
4. Commit as its own commit: `chore: re-ratchet size ceilings after class-pair
collapse`.

**Expected saving** (estimate from the esbuild metafile, 2026-08-31: the six
files total ~19.3 kB minified of a 62.4 kB bundle; scaffolding is a fraction
of that): 1.5–4 kB raw. If the measured saving is < 1 kB, say so honestly in
the commit message — the collapse is justified by architecture either way.

---

## Campaign B — frame-discipline budget

**The defect (Puddlebend Issue 3):** one 800 ms landscape turn produces 40–60
style/class attribute writes per frame across a 15-leaf book. A turn should
touch only: the mover leaf, its temporary copy, the leaf beneath
(`bottomPage`), the static leaf being drawn under a hard turn, and the four
shadow elements. Correct pixels, wasted work; scales with page count; costs
phone battery.

**Where the waste is** (verified against source, 2026-08-31; line numbers
drift — anchor on the code, not the number):

1. `Page.draw` / `Page.simpleDraw` → `applyEngineStyle` re-stamps every engine
   declaration (~15 `setProperty` calls + the 3-property background pair) on
   every drawn leaf on EVERY frame, even when nothing changed. During a turn
   the two static leaves and the bottom page get identical CSS re-written
   ~60×/second.
2. `HTMLRender.drawFrame` → `clear()` iterates the ENTIRE collection every
   frame. The `classList.remove('--shown')` on already-hidden pages is a no-op
   at the DOM-attribute level, but `hideTemporaryCopy()` and the loop itself
   are per-page work that grows with the book.
3. `drawFrame` re-stamps `style.zIndex` on the mover and bottom page each
   frame even when unchanged.

### B1. Pin the current behavior with a budget test — BEFORE any optimization

New file: `packages/core/tests/frame-discipline.test.ts` (jsdom).

**Instrument by patching the CSSOM/DOM prototypes, NOT with a
MutationObserver.** Probed in jsdom 2026-08-31: `style.setProperty` with an
IDENTICAL value produces **zero** mutation records (jsdom dedups), so an
observer-based test would pass before the fix and prove nothing — while a
no-op `classList.remove` DOES produce a record. The cost model we are pinning
is "calls the engine issues", which is also what dirties style recalc in real
browsers, so count calls directly. In the test file, patch and count (and
restore in `afterEach`/`finally`):

- `CSSStyleDeclaration.prototype.setProperty` and `.removeProperty`
- the `cssText` setter on `CSSStyleDeclaration.prototype` (the shadow
  elements and `clearShadow` write via `cssText`)
- the `zIndex` setter on `CSSStyleDeclaration.prototype` — the render stamps
  z-index via direct assignment (`el.style.zIndex = …`), which does NOT go
  through `setProperty` in jsdom; without this patch B3.3 is unprovable. Add
  a negative-control assertion in the recorder's own self-test: a bare
  `el.style.zIndex = '5'` is counted.
- `DOMTokenList.prototype.add` and `.remove`

For each call, record `{ element, kind }` — resolve the element from the
style declaration via a `WeakMap` populated by also patching the
`Element.prototype.style`/`classList` getters, or more simply: patch at the
`HTMLElement` level by wrapping each page element's own `style`/`classList`
before the test acts (jsdom allows per-instance spies via `vi.spyOn` on the
prototype with `mockImplementation` that calls through and logs
`this.parentElement ?? owner`). Whichever mechanism, the test must be able to
answer "which element received this write". Write ONE shared helper
(`packages/core/tests/style-write-recorder.ts`) so all three tests and any
future test use identical counting.

Three tests, in this order of importance:

1. **Resting redraw writes nothing.** Build a 10-leaf landscape book, draw one
   frame (settle), reset the recorder, call `drawFrame()` again with no state
   change: assert **zero** recorded calls. Pre-fix this FAILS loudly —
   `applyEngineStyle` issues ~15 `setProperty` calls per drawn leaf per frame
   — which is the revert-proof. NOTE this test cannot pass on B3.1–B3.3
   alone: `draw()`/`simpleDraw()` also call `classList.add('--shown')` /
   `add('--simple')` / `remove('--simple')` unconditionally every frame, and
   the recorder counts those calls even when they are DOM no-ops. B3 therefore
   includes a fourth fix, B3.4 below (class-write elision), and this test is
   its revert-proof too.
2. **A mid-fold frame touches only the working set.** 10-leaf landscape book,
   `startUserTouch` + `userMove` to mid-fold (copy the drag setup from
   `styling-contract.test.ts` B3.2), settle one `drawFrame()`, reset the
   recorder, then one more `userMove` + `drawFrame()`: assert every recorded
   element is in the allowed set {mover element, temporary-copy element,
   bottom-page element, the static leaf under a hard turn,
   `.stf__outerShadow`, `.stf__innerShadow`, `.stf__hardShadow`,
   `.stf__hardInnerShadow`}. Assert the identity of the written elements, not
   just a count — counts go stale, identity does not.
3. **Write count is bounded.** Same frame as (2): assert total calls ≤ a
   budget derived from the working set (measure post-fix, set the ceiling at
   measured + 25%, comment the measured number). This is the drift alarm.

Revert-prove: commit the test marked with `test.fails` (vitest) pinning the
CURRENT failing behavior first, or keep it in the fix commit and record the
pre-fix failure output. Either satisfies the gate; the second is this repo's
usual shape.

### B2. Add mid-animation e2e goldens — BEFORE any optimization

The unit budget cannot see pixels. Two new golden screenshots — they MUST go
in **`e2e/golden-flip.spec.ts`**, not `flip-invariants.spec.ts`: the
`test:e2e:golden*` scripts and `scripts/update-golden-linux.sh` target only
that file, so a golden anywhere else never gets Linux baselines generated.
Follow the existing snapshot-naming pattern in that file and `e2e/README.md`
for the per-platform baseline workflow. Name the snapshots
`mid-fold-landscape-forward.png` and `mid-fold-portrait-back.png`:

- Landscape drag held at ~40% progress (pointer down, move, DON'T release —
  deterministic, no animation timing involved).
- Portrait BACK drag held mid-fold (this is the flagship §4.1 geometry).

Commit these with their `-darwin` baselines, regenerate `-linux` baselines in
CI's container (`pnpm test:e2e:golden:update:linux`), commit. These goldens
are the regression net for B3: after every optimization commit they must be
byte-identical (within existing threshold config).

### B3. Optimize — four independent, separately-committed fixes

**B3.1 — memoize `applyEngineStyle` writes.** In `Page` (post-collapse), cache
the last css string + background the engine wrote
(`private lastEngineCss: string | null`), keyed per element. At the top of
`applyEngineStyle` (make it a method, or pass the page), if
`css === lastEngineCss && background === lastBackground`, return without
touching the DOM. Invalidate the cache (`lastEngineCss = null`) in:

- `setOrientation` and `setDrawingDensity`/`setDensity` (class writes change
  meaning of the next draw),
- the page's adopt/release path (`UI.updateItems` adopt + release — a
  consumer may have edited inline styles while the engine wasn't looking),
- `Render.update()` / `reload()` (resize, orientation change, settings
  change — bust every page's cache; add an internal `invalidateDrawCache()`
  on the collection that `update()` calls),
- `updateSettings` (a changed `pageBackground` must repaint; this falls out
  of the `Render.update()` hook if `updateSettings` calls it — verify it
  does, and add the bust if not).

**Each invalidation site gets its own regression test** in
`frame-discipline.test.ts` — the write-budget tests alone would happily
green-pass a stale cache. For each, act, force a `drawFrame()`, and assert
the leaf's inline style reflects the change:

- `updateSettings({ pageBackground })` → `--stf-paper` on visible leaves
  changes to the new value.
- resize / orientation change (`update()` after re-sizing the host) →
  `width`/`left` on visible leaves change.
- density transition (`setDensity`/`setDrawingDensity`) → next draw
  re-stamps.
- `newTemporaryCopy()` → the copy draws fully on its first frame (fresh
  cache).
- `updateFromHtml` with the SAME nodes and with replaced nodes → leaves
  repaint correctly after the rebuild.

**Known accepted behavior change** (document in the commit message): today
the engine re-asserts its inline styles every frame, so a consumer who
mutates e.g. `transform` on a drawn leaf mid-animation gets overwritten
within a frame; post-memoization the overwrite happens on the next CHANGED
frame instead. The API contract claims nothing about this; the styling
contract ("engine owns leaf-root layout and paper") is unchanged.

**B3.2 — shrink `clear()` to a delta.** Maintain
`private lastShown: Set<Page>` on the render. Each `drawFrame`, compute the
current working set; call `classList.remove('--shown')` /
`hideTemporaryCopy()` only for pages in `lastShown` but not in the current
set; replace `lastShown`.

**Temporary-copy ownership is the trap here.** The active mover during a
portrait soft turn is the CLONE, but `hideTemporaryCopy()` must be called on
its OWNER page (the copy has no `hideTemporaryCopy` state of its own — see
`newTemporaryCopy`/`hideTemporaryCopy` in the page class). The link must be
constant-time and travel WITH the clone: the renderer only ever holds the
clone (`setFlippingPage` receives it), and ownership today exists only in the
owner→clone direction. Add a non-public back-reference on the page class —
`private copyOwner: Page | null = null`, set by `newTemporaryCopy` on the
clone it constructs (legal cross-instance private access, same as
`isTemporaryCopy`), exposed via an internal getter. When a page carrying a
`copyOwner` enters the working set, record the owner alongside it in
`lastShown` bookkeeping; when it leaves, call `hideTemporaryCopy()` on that
owner. Frame cleanup must NEVER query the live collection — add a test that
spies on the collection's `getPages` and asserts zero calls from within a
steady-state `drawFrame`. Additionally, "clear the set" on invalidation is NOT sufficient
cleanup — before discarding `lastShown` on `reload()`, `cancelAnimation()`,
or collection replacement, run one cleanup sweep so no stale `--shown` leaf
and no orphaned clone survives the transition. **The sweep must iterate the
RETAINED `lastShown` set (plus recorded copy owners), NOT the live
collection**: `PageFlip.clear()` destroys the collection BEFORE
`releasePages()` → `cancelAnimation()` runs, so a sweep that asks the
collection for its pages at cancel time sees an empty book and cleans
nothing. `lastShown` holds `Page` references of its own, so it stays valid
across that ordering; sweep it, then discard it. The sweep must not run per
frame. Grep for every caller of the current `clear()` semantics first and
enumerate them in the commit message.

Required regression tests (in `frame-discipline.test.ts` or a sibling):
soft-turn cancellation mid-fold (assert the clone element is removed from the
DOM and no leaf outside the resting spread has `--shown`); `PageFlip.clear()`;
and `updateFromHtml` with the same nodes (assert no stale `--shown`, no
orphaned `[data-stf-clone]` element).

**B3.3 — skip redundant `zIndex` writes** in `drawFrame` /
`drawLeftPage` / `drawRightPage` / `drawBottomPage`: read before write
(`if (el.style.zIndex !== target) el.style.zIndex = target`). Note: after
B3.1 the z-index also round-trips through `applyEngineStyle`'s parsed string
(`draw()` re-emits it) — make sure the two mechanisms agree, i.e. the
memoized string includes the same z-index the direct write set, or the cache
will thrash. Simplest correct order: stamp z-index BEFORE calling
`draw()` (already the case) and include it in the cache key (already the
case, since `draw()` embeds it in `commonStyle`).

**B3.4 — class-write elision on the draw paths.** `draw()` calls
`classList.remove('--simple')` + `add('--shown')`, and `simpleDraw()` calls
`add('--simple')` + `add('--shown')`, unconditionally on every frame. Add two
tiny module-level helpers next to the page class —
`addClass(el, cls): void` / `removeClass(el, cls): void` — that check
`el.classList.contains(cls)` first and only then mutate, and use them in
`draw()`, `simpleDraw()`, and the render's `clear()`/sweep `--shown`
removal. Do NOT use them in `setOrientation`/`setDensity`/
`setDrawingDensity` (those are per-event, not per-frame, and their
remove-then-add pattern is load-bearing). B1's resting-redraw test is the
revert-proof: without this fix it fails on the class calls alone.

After each of B3.1–B3.4: full gates + the B2 goldens + the B1 budget test.
After all four: flip B1's `test.fails` markers to plain `test` (they now
pass), and record the before/after per-frame write counts in the commit
message and in `docs/TODO.md` (strike the item through with the numbers).

### B4. Manual visual verification — REQUIRED, not optional

The 3.0 postmortem line "tests passed while live behavior was broken" is why.
Serve the vanilla example (`pnpm build`, then the e2e webServer or
`vite preview`), and in a real browser: drag-fold and release both
directions, programmatic next/prev, portrait and landscape, hard covers,
resize mid-book. Then rebuild the packed tarballs and smoke the story-book
reader against them (see `docs/CONSUMER-REPORT-puddlebend.md` assets for the
harness scripts). Record what was checked in the PR description.

---

## Campaign C — `turnProgress` event + React `onTurnProgress`

**Why:** consumers driving a scrubber/progress UI currently rAF-poll
`getState()` from outside — per-frame cost paid in consumer code. One
additive event ends that. Demand source: Puddlebend.

### C1. Design (settled here; do not improvise)

Addition to `FlipbookEventMap` in
`packages/core/src/Event/EventObject.ts`:

```ts
/**
 * Fires whenever the fold position UPDATES while a turn or user fold is in
 * flight — once per animation frame action for a programmatic turn, once
 * per accepted pointer move for a drag. NOT guaranteed one-per-painted-frame:
 * several pointer moves can land between two paints. Treat it as a value
 * stream, not a frame clock.
 * Progress is the fold's geometric completion in [0, 1]; direction is
 * SEMANTIC (page-index order), so under `direction: 'rtl'` it still means
 * "towards higher indices" — consistent with every other event.
 * Never fires for an instant turn (flippingTime 0 / reduced motion): an
 * instant turn has no frames; consumers get `flip` + `changeState` as always.
 */
turnProgress: {
  progress: number;
  direction: 'next' | 'prev';
}
```

Emission point: `Flip` — the one place that owns both the calculation and the
semantic `turnDirection`. Emit where the fold position is applied (the `do()`
path that already derives shadow progress for `setShadowData`) so drags AND
animated turns both emit, with progress derived from the same source as the
shadow's progress percent (divide by 100; clamp to [0, 1]). Note `do()` runs
per pointer move as well as per animation frame — that is exactly why the
docblock defines the event as "per position update", not "per rendered
frame"; do NOT attempt frame-boundary coalescing (it would couple `Flip` to
the render loop for no consumer benefit).

**Emission ELIGIBILITY — `do()` is not always a turn.** `do()` also serves
the hover corner peel (`FOLD_CORNER`), and an INSTANT turn executes its final
frame action — which calls `do()` — synchronously inside `startAnimation`.
Gate the emit on the flipping state:

- emit only when `getState()` is `USER_FOLD` or `FLIPPING`;
- never during `FOLD_CORNER` (a hover peel is not a turn; a scrubber must not
  twitch on hover);
- never for an instant turn: when `animateFlippingTo` resolves a duration of
  0 (`flippingTime: 0` or reduced motion — `effectiveFlippingTime`), set a
  per-turn `suppressProgress` flag before `startAnimation` and check it in
  the emit gate; clear it in `reset()`. This is what makes the documented
  "never fires for an instant turn" true — without the flag, the synchronous
  final frame action emits one stray event.

**Payload allocation must be behind a listener check, with a testable seam.**
Add a `protected hasListeners(name: FlipbookEventName): boolean` to
`EventObject` (one map lookup). The internal-symbol emit method on `PageFlip`
takes PRIMITIVES — `[EMIT_TURN_PROGRESS](progress: number, direction: 'next'
| 'prev')` — checks `hasListeners('turnProgress')`, and only then builds the
payload via an internal factory OBJECT —
`export const turnProgressPayload = { build(progress, direction) { … } }` in
`EventObject.ts` or `PageFlip.ts`, deep-importable by tests — and the emit
site must call it as `turnProgressPayload.build(…)` (a property lookup a
`vi.spyOn(turnProgressPayload, 'build')` actually intercepts; a bare lexical
function binding is NOT spy-able across modules, which would make the
no-listener test vacuously green). The factory is the observable allocation
boundary. The no-listener test asserts zero calls; pair it with a POSITIVE
control — with a listener subscribed, the same spy records calls — proving
the spy intercepts real allocation.
Otherwise copy the `EMIT_STATE` wiring verbatim; `Flip` passes primitives and
stays ignorant of listener state.

Terminal semantics: no synthetic final `1.0` and no synthetic `0` on
snap-back. The stream is "where the fold is, while there is a fold";
completion/cancellation is already observable via `flip`, `changeState`, and
`turnRejected`. Document exactly this in the event's docblock and README —
the number one consumer bug will be treating the last `turnProgress` as
completion.

Do NOT add throttling, an options flag, or an `onProgress` callback setting —
it is an event like the others; a consumer who doesn't subscribe pays nothing
(the emitter early-returns on no listeners; verify emission is behind that
check, i.e. just use `trigger`).

React binding (`packages/react/src/HTMLFlipBook.tsx`): add optional
`onTurnProgress?: (info: FlipbookEventMap['turnProgress']) => void` to
`IEventProps` in `packages/react/src/types.ts`. **Unwrapped payload, not
`WidgetEvent`** — D18 in that file: every React handler receives the payload;
the engine's `on()` keeps the wrapper, the binding unwraps uniformly. Wire it
at ALL FOUR existing sites, exactly as `onTurnRejected` is wired (grep it):

1. the props destructure (~line 317),
2. the `eventHandlersRef` initial value (~line 646),
3. the handler-ref refresh effect (~line 657),
4. the bind-once handlers effect:
   `flip.on('turnProgress', (e) => eventHandlersRef.current.onTurnProgress?.(e.data))`
   (~line 693 block).

The binding effect runs BEFORE `loadFromHTML`/`updateFromHtml` (the §4.3
ordering — do not reorder that effect). Missing any of the four sites makes
the prop silently dead or permanently stale — the ref-refresh site (3) is the
one a sloppy implementation forgets, and the "changing the handler does not
remount" test below is what catches a wrong wiring, so also assert the NEW
handler (not the mount-time one) receives events after a prop change. The
prop must NOT appear in `remountKeyOf`.

### C2. Contract & docs

- `docs/API-CONTRACT.md`: add to the ledger as a dated ADDITIVE entry; the
  locked surface statement gains the event. Additions are permitted; removals
  and changes are not.
- README (core events table + React props table), and a "scrubber" recipe
  snippet replacing the rAF-poll advice if any exists.
- `CHANGELOG.md` via `pnpm exec changeset` (minor bump, both packages move
  together — the fixed group).

### C3. Tests

Core (jsdom, deep-import as needed):

1. Programmatic animated flip (`flippingTime: 200`, drive rAF like
   `html-render-page.test.ts` does): collect payloads; assert every
   `progress ∈ [0, 1]`, the sequence is non-decreasing, `direction: 'next'`,
   and at least 2 events fired.
2. Drag fold: `startUserTouch` + several `userMove` steps + `drawFrame`;
   assert events fired and progress tracks the drag monotonically for a
   monotonic drag.
3. Instant turn (`flippingTime: 0`): assert ZERO `turnProgress` events, while
   `flip` still fires (guards the documented instant-turn semantics).
4. RTL: `readingDirection: 'rtl'`, `flipNext()`: assert `direction: 'next'`
   (semantic, not geometric — this is the regression the direction split
   exists to prevent).
5. No-listener path: flip with no subscription; spy via
   `vi.spyOn(turnProgressPayload, 'build')` (deep-import the factory object)
   and assert it is NEVER called — the allocation guard, pinned at the
   factory boundary. (Positive control: same spy WITH a listener records
   calls — see C1.)
   5b. Hover corner peel (`showCorner` / `foldCornerOnHover` path): assert ZERO
   `turnProgress` events during a corner peel-in and peel-out.
   5c. Reduced motion (`respectReducedMotion` with `prefers-reduced-motion`
   matched, mirroring `reducedMotion.ts` test setup): animated `flipNext()`
   emits ZERO `turnProgress` events (the instant-turn suppression flag).
6. Snap-back ordering: start a drag, release below the commit threshold;
   assert no `turnProgress` fires AFTER the `changeState` back to `read`, and
   that no `flip` fired at all (the stream ends with the fold, never trails
   it).
7. Terminal ordering on a committed turn: the last `turnProgress` precedes
   the `flip` event; nothing fires after `flip` for that turn.
8. Listener reentrancy/teardown: a `turnProgress` listener that calls
   `destroy()` mid-turn — assert teardown completes without throwing out of
   the emit (the L8 deferral path). TWO permitted exceptions to "silence",
   both platform semantics, assert them rather than fighting them:
   (a) `destroy()` → `abandon()` legitimately emits one `changeState('read')`
   before listeners are cleared; (b) the emitter SNAPSHOTS the listener list
   per dispatch (E1), so a second `turnProgress` listener registered before
   the dispatch still receives the IN-FLIGHT event even though the first
   listener destroyed the book mid-dispatch — register two listeners, destroy
   from the first, assert the second still got that event. Silence is
   asserted only for SUBSEQUENT emissions: after the dispatch completes, no
   further `turnProgress` and no post-teardown emissions of any kind.

React: extend the events test file — mount with `onTurnProgress`, drive an
animated flip, assert the handler received in-range payloads; assert changing
the handler prop does NOT remount the engine AND that the NEW handler (not
the mount-time one) receives subsequent events — this catches a missed
ref-refresh wiring (pattern in `remount-key-change.test.tsx`).

Revert-prove: with the emission line removed, tests 1, 2 and the React test
must fail.

### C4. Size

`turnProgress` adds bytes to core. After C, re-run `pnpm size`; if a ceiling
from A4 is exceeded, raise it by the measured delta ONLY, in the same commit,
and say so (AGENTS.md §2: a feature may spend headroom and must say so).

---

## Order of campaigns, and why

**A → B → C.** A first because B rewrites draw-path code that A relocates —
doing B first means every B change is re-touched during A. C last because it
is the only public-surface change and the least risky; it also benefits from
B's settled emission point. Do not interleave campaigns; finish each
(gates + its own verification) before starting the next.

Branch: one feature branch per campaign (`chore/3.1-collapse`,
`perf/3.1-frame-discipline`, `feat/3.1-turn-progress`), PR each to `main`
separately. `main` is push-protected; the release workflow publishes on merge
when a changeset is present — Campaigns A and B ship with a `patch`… no:
**hold the changeset until C**, then one `minor` changeset covering all
three (they are one release). A and B PRs therefore contain NO changeset
(nothing publishes); C's PR adds the minor changeset and its CHANGELOG text
mentions all three.

## Testing plan — summary of every net we hold

| Net                              | Guards                                                  | When                    |
| -------------------------------- | ------------------------------------------------------- | ----------------------- |
| 960+ unit tests                  | all 3.0 invariants                                      | every commit            |
| `frame-discipline.test.ts` (new) | write budget, working-set identity                      | every commit from B1 on |
| Mid-animation goldens (new, B2)  | pixels during a fold, both orientations, both platforms | every commit from B2 on |
| Existing 46 e2e + goldens        | resting states, gestures, buttons, a11y                 | every commit            |
| `turnProgress` tests (new, C3)   | progress semantics incl. rtl + instant                  | every commit from C on  |
| `check-isolated-types`           | published `.d.ts` under pnpm isolation                  | every commit            |
| `pnpm size`                      | byte drift both directions after A4                     | every commit            |
| Manual browser pass (B4)         | the "tests passed, live broke" gap                      | end of B, end of C      |
| Story-book tarball smoke         | acceptance consumer                                     | end of B, end of C      |

## Explicitly out of scope

Anything else in `docs/TODO.md` — including `--stf-paper-base`,
`centerClosedBook`, gutter/spine, `validateFlipOptions`, `<FlipPage>`,
binding-owned leaf hosts (4.0), and the headless-controller seam. If a task
above appears to require one of these, stop and ask the owner.
