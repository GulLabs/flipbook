VERDICT: BLOCK

# Codex design signoff

Reviewed against the current tree at
`177ae3ff101b3cbbe199f75530039ad8f8a997b5`. `BLOCK` means **do not implement
the audit as written**; it is not a rejection of the audit's problem inventory.
D1, D2, D4, D13 and D14 identify real problems. D22 removes state the engine
needs, D23 describes observation windows the current guards have already
closed, and several proposed shapes stop one layer short of the stated goal.

## Load-bearing claim check

| Item | Result                                                  | Source-grounded judgment                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | Premise true; shape rejected                            | Ref collection is append-only and a non-forwarding component never contributes a node (`packages/react/src/HTMLFlipBook.tsx:215-267,374-400`). An owned slot is better than detecting the missing ref after commit.                                                                                                                                                                |
| D2   | Premise true; shape rejected                            | One boolean gates all Pointer Events listeners (`packages/core/src/UI/UI.ts:345-365`); replacing it with another boolean cannot preserve touch while disabling mouse.                                                                                                                                                                                                              |
| D4   | Premise true; shape incomplete                          | Fixed settings overwrite all four bounds (`packages/core/src/Settings.ts:294-310`), but live validation receives a fully normalised object (`packages/core/src/PageFlip.ts:812-817`) and no longer knows which keys were authored.                                                                                                                                                 |
| D13  | True                                                    | The controlled effect depends only on `[controlledPage, pages]` (`packages/react/src/HTMLFlipBook.tsx:684-731`), while an engine turn changes `enginePage` in the `flip` handler (`packages/react/src/HTMLFlipBook.tsx:442-447`). Add engine state to reconciliation, but distinguish initial seeding, external prop navigation and an engine-originated turn the parent declines. |
| D14  | True; transition contract incomplete                    | The controlled path calls instant `turnToPage` (`packages/react/src/HTMLFlipBook.tsx:702-706`) while the ref's animated path calls `engine.flip` (`packages/react/src/HTMLFlipBook.tsx:351-360`). Initial controlled state must seed without a mount animation; later external changes may animate.                                                                                |
| D22  | Factual conclusion false                                | The index is only derivable after a spread is settled. It is the remapping anchor while orientation changes and the old spread index is being interpreted against a new table (`packages/core/src/Render/Render.ts:703-726`; `packages/core/src/Collection/PageCollection.ts:357-365`).                                                                                            |
| D23  | Historical premise, current mechanism still undesirable | The phantom is now restored before consumer dispatch and reinstalled only for synchronous commit (`packages/core/src/Flip/Flip.ts:183-224,789-808`). Replace state borrowing, but do not claim current listeners can still see the old window.                                                                                                                                     |

## Material findings

### 1. BLOCK — D22 deletes selected-leaf state instead of separating it

D22 correctly notices that one field is carrying more than one meaning, but its
proposed replacement keeps only the announcement meaning. `show()` uses
`currentPageIndex` as the logical leaf to remap into the active spread table
(`packages/core/src/Collection/PageCollection.ts:357-365`), while
`showSpread()` then canonicalises it to that spread's head
(`packages/core/src/Collection/PageCollection.ts:492-521`). The existing
orientation test demonstrates the distinction: portrait leaf 3 becomes the
landscape spread head 2 (`packages/core/tests/lifecycle.test.ts:719-732`). A
derived `getSpread()[currentSpreadIndex][0]` cannot carry leaf 3 through the
moment `Render.update()` installs the new orientation before the collection is
re-shown (`packages/core/src/Render/Render.ts:703-726`).

The replacement must model at least two values: a stable selected/logical leaf
used when re-spreading, and the current orientation's spread/head used for
rendering and events. `lastAnnouncedIndex` is useful for the ADR 0003 guard but
cannot replace the selected leaf. Do not build D22 as proposed.

### 2. MAJOR — D1 should remove the consumer-ref contract, not diagnose it later

D1's factual diagnosis survives: refs are appended only when a cloned child
ultimately yields a host node (`packages/react/src/HTMLFlipBook.tsx:215-267,
374-400`), and the load path accepts any non-empty shorter node list
(`packages/react/src/HTMLFlipBook.tsx:545-566`). Index-keyed nullable refs would
turn the silent mismatch into an exception, but would retain the deeper design
defect: the engine writes collision-prone `--soft` / `--hard` / `--left` /
`--right` classes and replaces the consumer page root's entire inline style
(`packages/core/src/Page/HTMLPage.ts:21-28,136-181,287-300,319-328`).

Use one stable, index-keyed, engine-owned host wrapper per child and render the
consumer subtree inside it. The engine then owns the ref, positioning, classes,
temporary visual copy and lazy-placeholder identity; arbitrary React components
need not forward refs, and consumer root styles/classes remain consumer-owned.

### 3. MAJOR — D2's proposed boolean cannot express D2's own use case

The premise is correct: `useMouseEvents` gates the one Pointer Events listener
set, so `false` disables mouse, touch and pen together
(`packages/core/src/UI/UI.ts:345-365`). Renaming that gate to
`pointerInput: boolean` makes the name honest but still cannot express the
stated requirement, "disable mouse turning, keep swipe on tablets." Use an
accepted-pointer policy (for example a readonly set/array of `mouse | touch |
pen`, with an ergonomic default), or classify D2 as rename-only and drop the
use-case claim.

### 4. MAJOR — D4's explicitness test is unavailable on the live-update path

`definedOnly()` sees authored keys when construction first enters
`Settings.getSettings()` (`packages/core/src/Settings.ts:123-171`). Fixed-mode
normalisation then synthesises all four bounds from width/height
(`packages/core/src/Settings.ts:294-310`). Every later `updateSettings()` call
re-validates a complete merge of that already-normalised object and the partial
update (`packages/core/src/PageFlip.ts:782-817`). A check for "bound was
explicitly supplied" at that point would treat every synthesised bound as
authored and make an unrelated `updateSettings({ drawShadow: false })` fail.

Keep authored input separately from resolved live settings, or validate a
discriminated fixed/responsive input before normalisation and use a different
validator for live partial updates. D4 and D19 must share that model; the
existing `definedOnly` helper is not sufficient machinery.

### 5. MAJOR — D23's diagnosis is stale and its replacement stops halfway

The phantom-spread mechanism is still fragile, but the audit describes
observation windows that the current code has already closed. `runFlip()` lends
the index only while `start()` selects the two leaves, restores it in `finally`,
and only then dispatches `changeState` (`packages/core/src/Flip/Flip.ts:183-224`);
the adversarial test specifically proves a listener cannot observe it
(`packages/core/tests/flip-state-machine.test.ts:1400-1422`). At commit it is
reinstalled and immediately consumed synchronously
(`packages/core/src/Flip/Flip.ts:789-808`).

The design should still stop borrowing public collection state, but
`getTurnLeaves(from, to)` only fixes selection. Removing `pendingTarget` and the
target-minus/plus-one encoding also requires an absolute commit operation that
commits directly to the destination spread. Prefer one immutable internal
`TurnPlan` containing semantic direction, source spread, destination spread,
flipping leaf and bottom leaf; selection and commit then consume the same plan.

### 6. MAJOR — the audit does not define the package facade or emitted-type proof

The package has one supported JavaScript subpath, but that root barrel exports
the façade beside `Flip`, Render/Page/Collection implementations, geometry
algorithms, renderer predicates and style internals
(`packages/core/src/index.ts:5-41`; `packages/core/package.json:17-29`). The test
suite then imports geometry implementation helpers through the public package
because they are exported (`packages/core/tests/geometry.test.ts:1-24`). D24 is
therefore not currently an "invisible" internal collapse; those base and
concrete classes are in the emitted API.

Keep the existing package `exports` map shape — its ESM/CJS type conditions and
blocked deep imports are good — but first define the intended root façade and
remove unsupported collaborators and test helpers from it. Keep public geometry
**data types** needed by `getBoundsRect`; do not publish curl algorithms merely
to make unit tests convenient.

The declaration proof must move with that decision. Vitest intentionally aliases
package imports to source (`vitest.config.ts:4-18`), and the packed consumer only
type-checks a representative handful of symbols
(`scripts/check-packed-artifacts.mjs:550-567`). D9-D20 could therefore omit or
mis-emit one of the new event payloads/settings types while source tests remain
green. Add a packed-tarball contract fixture that imports every supported symbol
and contains positive and `@ts-expect-error` cases for the new settings,
navigation and event shapes.

### 7. MAJOR — accessibility is not finished at the two redesign seams

Every soft turn deep-clones the consumer subtree, deliberately retains duplicate
IDs, and appends the clone to the live document before marking it inert and
`aria-hidden` (`packages/core/src/Page/HTMLPage.ts:83-115`). `inert` correctly
removes interaction and accessibility exposure, but it does not restore the
document-wide uniqueness of IDs. Strict consumer queries become ambiguous while
a turn runs, and ID/IDREF behaviour is left to tree-order assumptions. The audit
should not list the a11y path as wholly closed without either a visual-copy design
that avoids duplicate IDs or an explicit, browser-tested accepted constraint.

D14 also changes announcement timing. `currentPage` prefers the controlled prop
over committed engine state, and the live-region effect calls the consumer's
formatter from that value (`packages/react/src/HTMLFlipBook.tsx:326-347`) before
the controlled navigation effect runs (`packages/react/src/HTMLFlipBook.tsx:684-731`).
Once controlled changes animate, announcements must be driven from the committed
engine snapshot, not from the requested prop, or assistive technology can be
told about a page before it is on screen.

## Where the status quo is better than the proposal

### Keep `pageBackground`; reject `foldBackground`

D3's silent fallback is a real usability defect, but its rename states something
false. `pageBackground` paints the temporary copy and animated leaf, and it also
paints every static leaf (`packages/core/src/Page/HTMLPage.ts:83-85,181-187,
287-300`). `foldBackground` would hide half of its contract. Keep
`pageBackground` (or, if a rename is mandatory, use `leafBackground`) and make an
unsupported authored value a typed boundary error while retaining the draw-time
opaque fallback for mutation that bypasses the boundary.

Modern CSS parsing and opacity are separate decisions. The present regex
deliberately rejects `var()`, `oklch()` and modern `rgb()` syntax
(`packages/core/src/Render/pageBackground.ts:11-21,74-113`). Use the browser's
property parser / `CSS.supports` for modern concrete colours. Do **not** promise a
CSS custom-property value until the engine can guarantee an opaque underlay even
when that variable resolves late or resolves translucent; the fold-opacity
invariant outranks syntactic convenience.

### Keep the `flippingTime` default at 1000

The audit treats `1000` as the ordinary duration, but the engine scales it by
trajectory length and only uses the full value at 1000 or more generated points
(`packages/core/src/Flip/Flip.ts:949-957`). A normal 400-point move is therefore
about 400 ms at the current default; changing the default to 600 would make it
about 240 ms. Keep 1000. If the setting is renamed in the naming pass, describe
it as a maximum/scale, and change it only after browser measurements show that
actual turns — not the raw setting — are slow.

## Naming recommendation

There are three axes and they should have three names.

1. **Keep `FlipDirection.FORWARD` / `BACK` for logical page-order movement.** Do
   not rename them to NEXT/PREVIOUS. `next` and `previous` are commands relative
   to current state; `FlipDirection` is the stable axis a turn carries through
   selection and commit (`packages/core/src/Flip/Flip.ts:53-63,805-808`). The
   rename buys no type safety and collides conceptually with `flipNext` /
   `flipPrev`.
2. **Split the physical fold side into its own type.** This is a genuine type
   defect, not cosmetic churn. `foldSide()` documents a physical side but returns
   `FlipDirection`, and `Render.direction` is typed as `FlipDirection` while
   storing the mirrored result (`packages/core/src/Render/Render.ts:89-108,
127-138,1027-1031`). Downstream code then compares that physical value as a
   direction when assigning mover/underside orientation
   (`packages/core/src/Render/Render.ts:1066-1089`). Introduce a distinct
   `FoldSide.LEFT | RIGHT` (or an equivalently distinct type), rename the field
   to `foldSide`, make `getFoldSide()` return it, and carry that type through
   `FlipCalculation` and geometric conversions. Keep `setTurnDirection()` as the
   only logical-to-physical conversion point.
3. **Keep the leaf side physical: LEFT/RIGHT.** The value chooses an x coordinate,
   hard-page transform origin and public CSS decoration
   (`packages/core/src/Page/HTMLPage.ts:227-229,287-300,319-324`). RTL is applied
   when logical spread entries are assigned to physical leaves
   (`packages/core/src/Collection/PageCollection.ts:403-444`). CSS
   `inline-start` / `inline-end` are useful prior art precisely because they are
   _logical_ and change with writing direction; these classes intentionally do
   not. If the type is renamed, use `LeafSide`, not BACK/FORWARD or
   NEXT/PREVIOUS. Preserve the left/right meaning while namespacing the actual
   class tokens (for example `stf__item--left`) so they no longer collide with a
   consumer's `--left`.

Decisive answer: **split (b), keep (a), keep (c) physical, and do not rename
FORWARD/BACK to NEXT/PREVIOUS.**

## Recommendations on the four undecided items

1. **Rename `direction` to `readingDirection`, and
   `FlipDirectionSetting` to `ReadingDirection`.** The current setting type and
   field (`packages/core/src/Settings.ts:18,84-90`) sit beside a logical turn type
   and a currently mis-typed physical fold field. The qualified name removes real
   ambiguity and is free before first publish.
2. **Collapse all one-implementation inheritance pairs now — including
   `PageCollection` — after pruning the public barrel.** `Render` has two abstract
   methods, `UI` and `PageCollection` one each
   (`packages/core/src/Render/Render.ts:264-269`;
   `packages/core/src/UI/UI.ts:302`;
   `packages/core/src/Collection/PageCollection.ts:83`), and the sole HTML
   collection subclass only constructs HTML pages and calls `createSpread`
   (`packages/core/src/Collection/HTMLPageCollection.ts:14-43`). Collapse
   Render/HTMLRender, UI/HTMLUI, Page/HTMLPage and
   PageCollection/HTMLPageCollection. The deferred WebGL analysis explicitly
   says `Render` is the wrong seam and that a future implementation should
   consume a headless controller, extracted only when a second real consumer
   exists (`docs/WEBGL_RENDERER.md:65-98`). Preserving an abstract
   `PageCollection` subclass hook is speculative and is not that controller.
3. **Complete `usePageFlip`; do not delete it.** It is the natural React adapter
   once `page`/`onPageChange` is primary, and orientation/page count/state are
   engine-derived values a caller otherwise has to wire repeatedly. Complete it
   _after_ the event snapshot redesign. Return one readonly, atomically updated
   snapshot plus commands and controlled `bookProps`; remove the public
   `setPageCount`, which mutates derived state
   (`packages/react/src/usePageFlip.ts:17-20,56-87`).
4. **Keep the 1000 default.** The source uses it as a scaled maximum, not a
   guaranteed one-second turn (`packages/core/src/Flip/Flip.ts:949-957`). A taste
   claim is not enough to shorten every ordinary animation by 40 percent.

## Sequencing and size

The audit's "Tier 4 last" order is unsafe: this checkout is already closer to
all three ceilings than the prompt states. A fresh core build at the reviewed SHA
produced **56,599 raw / 13,879 brotli / 15,562 gzip**, against the configured
57,000 / 14,000 / 16,000 ceilings
(`packages/core/package.json:41-60`). Headroom is only **401 / 121 / 438 bytes**.
D20's code-to-kind table, D21's richer strings and event/payload reshaping can
cross brotli first even if raw remains green. Do not raise a ceiling or delete
working behavior to compensate.

Recommended order:

1. Land C1-C5 independently, with the required revert proofs and hostile
   variants.
2. Define and prune the supported root exports; add the exhaustive packed `.d.ts`
   contract fixture. This makes later structural edits honest public-API edits.
3. Collapse the vestigial inheritance pairs and remove proven dead/test-only
   surface. Rebuild and record all three size numbers before spending any saved
   bytes.
4. Replace D22 with explicit selected-leaf plus spread/head state, then replace
   D23 with an immutable `TurnPlan` and direct absolute commit. Event semantics
   and React control both depend on those meanings being stable.
5. Introduce engine-owned React leaf slots and settle the clone-ID, class
   namespace and background/custom-property contracts together. The React-only
   wrapper does not consume the core packed-engine budget; any core clone or CSS
   machinery does.
6. Build one authored-versus-resolved settings model, then perform D2-D9 and D19-
   D21 against it. Re-measure after each core tranche; do not batch all names,
   validation and errors behind one final size reading.
7. Redesign event snapshots and navigation results, then implement D13-D18 and
   the completed hook against that single contract. Initial controlled state is
   instant; later external changes may animate; announcements follow committed
   engine state.
8. Finish internal-only cleanup last. Cosmetic names must not be allowed to hide
   behavior changes in the same diff.

## Verification record

- Read `docs/DESIGN_AUDIT_2026-08-30.md`, `CLAUDE.md`, `AGENTS.md`, the named
  source/caller paths, package manifests, build configs, packed-artifact gate,
  WebGL ADR and relevant tests.
- Fresh build: `pnpm --filter @gullabs/flipbook-core build` — passed; packed HTML
  engine 56,599 bytes.
- Exact size gate: `./node_modules/.bin/size-limit --json` from `packages/core` —
  passed at 56,599 raw / 13,879 brotli / 15,562 gzip.
- Focused verification: six files, 204 tests passed (`lifecycle`, flip state,
  settings, page background, React binding and accessibility).
- Full gate: `pnpm quality:ci` — passed (49 test files and 767 tests, plus
  typecheck, lint, formatting, coverage floors, both package builds, all three
  size ceilings, isolated declarations and packed ESM/CJS/type consumers).
