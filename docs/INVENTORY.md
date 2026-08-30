# Outstanding work — merged inventory and fix order

**As of 2026-08-30, at `177ae3f`.** Supersedes the scattered state of
`docs/CANVAS_FIRST_CLASS.md` (old, pre-3.0 audit rows) and
`docs/DESIGN_AUDIT_2026-08-30.md` (new, pre-publish design audit) as the single
place to look for "what is left".

Those two documents stay: this one is an index and an ordering, not a
replacement. Each row points at the document that carries the argument.

**The governing fact:** 3.0.0 is **not published**. There are no consumers.
Every breaking change in here is free today and expensive the day after the
first `npm publish`. That is why the order below puts design changes _before_
release, against the usual instinct.

---

## Status of the four inputs

| Source                                      | State                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Codex rounds 1–6 (implementation)           | Closed. Round 6 raised no BLOCKERs; its 3 MAJORs are C1–C4 below.                                                     |
| Design audit (`DESIGN_AUDIT_2026-08-30.md`) | Written, **not signed off, nothing built**.                                                                           |
| Codex design signoff                        | **BLOCK** — see `docs/reviews/codex-design-signoff.md`. 1 blocker (D22), 7 majors, 2 items where the status quo wins. |
| Old inventory (`CANVAS_FIRST_CLASS.md`)     | Mostly closed; the 12 genuinely-open rows are reproduced below.                                                       |

Two earlier signoff launches were lost when the Codex broker registry reset. It
now writes its verdict to a file, so a lost session costs nothing.

---

## A. Correctness — found, not fixed

From Codex round 6, against shipped code. These are defects today, independent
of any design decision.

|        | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Where                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **C1** | A settled RTL change leaves the UI gesture alive — `UI.touchPoint` / `activePointerId` survive the settle, so a release inside the swipe window commits a turn the reader never made.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `UI/UI.ts`                     |
| **C2** | First load with a nonzero `startPage` emits `flip` **before** `init` — ADR 0003's own rule, broken by ADR 0003's own fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `PageFlip.ts`                  |
| **C3** | `updateState` and `updateOrientation` are still public seams of exactly the shape `updatePageIndex` was just closed for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `PageFlip.ts`                  |
| **C4** | Four test files each admit a passing wrong implementation: absolute `flip(page)` never exercised; no completed swipe in the RTL file; the soft **outer** gradient unasserted; `drawHard`'s LEFT translation/origin unpinned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | core tests                     |
| **C7** | **React: an uncontrolled `<HTMLFlipBook startPage={1}>` still fires `onPageChange(1)` on mount** — C2's semantics, unfixed on the binding side. The binding mounts with `loadFromHTML([])` then `updateFromHtml`, so `startPage` (read only by `attachMode`) never applies; it compensates with its own `engine.turnToPage(start)` at [HTMLFlipBook.tsx:586](../packages/react/src/HTMLFlipBook.tsx:586), which is a _turn_ and therefore announces. **Blocked on a design decision**: the clean fix needs the engine to expose "open at page N without announcing" — the core already has that as the package-private `SEED_OPENING_INDEX` — so it is new public API and belongs with D6/D13/D17, not as a bolt-on. Found by the test-adequacy expert with a throwaway React test. |
| **C5** | ADR 0003 is not exhaustive — it does not enumerate every path that moves the head index.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `docs/adr/0003`                |
| **C6** | The hard-BACK open-question note in `hard-back-draw.test.ts:146-158` should become an assertion. Codex answered it: `--right` **is** correct, because the flipping and bottom page are the same leaf and RIGHT selects `drawHard`'s right-leaf base, whose origin is the spine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `tests/hard-back-draw.test.ts` |

---

## B. Design — 24 items, none built

Full argument in `docs/DESIGN_AUDIT_2026-08-30.md`. Summarised by tier:

- **Tier 1 — silent failures** (D1–D7). A non-forwarding child ref silently
  misaligns the whole book; `useMouseEvents: false` kills touch and pen;
  `pageBackground` is the one setting that fails silently; `size: 'fixed'`
  overwrites four settings the consumer set; `renderOnlyPageLengthChange`
  freezes page content; `props.startPage` changes are ignored.
- **Tier 2 — names that state something false** (D8–D12). `disableFlipByClick`
  still flips on corners, `showPageCorners` shows nothing, `showCover` is a
  layout switch, `size: 'stretch'` does not stretch, `mode` means orientation,
  the `update` event is not a repaint.
- **Tier 3 — the contracts** (D13–D21). The controlled `page` prop is not
  controlled and never animates; four navigation mechanisms with three failure
  contracts; `turnRejected` cannot answer the question the README recommends it
  for; five payload conventions; `init` names a moment the engine has two of.
- **Tier 4 — internal structure** (D22–D24 + a cheap-together group).
  `currentPageIndex` is stored but derivable and fuses two meanings;
  `flipToPage` installs a phantom spread index into public state; the vestigial
  `Render`/`UI`/`Page` abstract bases mislead. **All three remove bytes.**

Four items need an owner decision: **D9** (`direction` → `readingDirection`),
**D24** (collapse the abstractions), `usePageFlip` complete-or-delete, and the
`flippingTime: 1000` default.

**Signoff outcome (2026-08-30).** D22 is **blocked**: `currentPageIndex` is not
derivable, because `show()` reads it as the _input_ to re-spreading and it must
survive the orientation swap. D23 needs an immutable `TurnPlan`, not just
`getTurnLeaves`. D3's `foldBackground` rename is rejected — `pageBackground`
paints every static leaf too, so the new name would hide half the contract.
**The `flippingTime` item is dead:** 1000 is a scaled _maximum_, and an ordinary
~400-point move already runs ~400 ms, so 600 would make normal turns 240 ms.
Two majors the audit missed entirely: the public barrel publishes geometry
algorithms and renderer internals, so D24 is a public-API change rather than an
invisible one; and the soft-turn deep clone leaves duplicate IDs live in the
document while a turn runs.

---

## C. Old inventory — the rows still genuinely open

Re-verified this session against the code, not copied forward.

|         | Item                                                                                                                                                                                                                              | Class                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **H4**  | Browse-mode screen-reader users have **no way to turn a page at all** — arrows are consumed by the virtual cursor and there are no real `<button>` controls.                                                                      | Accessibility defect |
| **NF4** | `draw()`/`simpleDraw()` write `style.cssText` wholesale. Adopted leaves get a snapshot restored; React-**portalled** leaves are never adopted, so a consumer's `style={{…}}` is destroyed every frame with nothing to restore it. | Defect               |
| **E8**  | A listener calling `destroy()` mid-dispatch leaves the remaining listeners of that dispatch running against a destroyed engine. Fixing it means deciding whether a dispatch aborts on destroy — a public contract call.           | Contract question    |
| **AN5** | `fold()` has the same dispatch-then-act shape as E8. Recorded, **unverified**.                                                                                                                                                    | Observation          |
| **Z3**  | `animateFlippingTo`'s `isTurned` commit runs before the `turnGeneration` guard. No reaching path found.                                                                                                                           | Observation          |
| **V3**  | The normal turn-end path never clears `render.pageRect` — the asymmetry the cancel path closed. Confirmed hygiene, not reproducible.                                                                                              | Hygiene              |
| **S8**  | `getSettings` is not round-trip idempotent: `stretch` → `fixed` → `stretch` returns bounds pinned to width/height.                                                                                                                | Defect               |
| **S9**  | `maxHeight` is validated, defaulted and returned — and never read.                                                                                                                                                                | Dead surface         |
| **U10** | The `SizeType.FIXED` branch in `applyHostSize` is provably inert.                                                                                                                                                                 | Dead code            |
| **E6**  | The 5px move threshold is hard-coded while its sibling `swipeDistance` is a live setting; neither is scale- or DPR-aware.                                                                                                         | Design gap           |
| **T1**  | ~18 tests use jsdom's permanent 0×0 layout as a shortcut to portrait, encoding the bug they were written around.                                                                                                                  | Test debt            |
| **E2**  | _(leaf-clip eats the edge)_ — **investigation only**, no repository evidence. Do not promise a fix before reproducing it.                                                                                                         | Unreproduced         |

**Now dead, do not carry forward:** C13, A2, A3, A4, D1(old), G3, F1, F3 and
**G7** all died with canvas removal (ADR 0002). G7 was image `onload` caching.

---

## D. Verification and release

|         | Item                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V-1** | **The back-flip has never been tried on a real phone.** This is the defect the fork exists to fix. Everything else is inference from unit tests and goldens. Needs no publish: dev server over Wi-Fi + Safari device inspector. |
| **V-2** | The e2e goldens have no `hardcover-back` cell. Five mutants lived in exactly that gap; `hard-back-draw.test.ts` now covers it in jsdom, but not visually.                                                                       |
| **V-3** | RTL mirroring and the `--left`/`--right` semantics need `MIGRATION.md` entries.                                                                                                                                                 |
| **V-4** | `data-stf-direction` is not stamped on the host, and the React live region has no `dir` — so an RTL book announces into an LTR region.                                                                                          |
| **V-5** | Publishing needs the npm token scoped to `@gullabs` ("All packages in selected scopes", or a classic automation token).                                                                                                         |

---

## The order

Two constraints set it. **Breaking changes are free until publish**, so design
lands before release. And **brotli headroom is 121 bytes**, so anything that
recovers bytes must precede anything that spends them — which inverts the
audit's original "Tier 4 last".

### Top 5, in order

**1. Correctness — C1–C6.** Standalone, no design decisions in it. C1's real
fix (move gesture state wholly into `UI`) is also the Tier 4 structural item,
so doing it here means doing it once. Nothing else should start before this
lands: several design items rewrite the same files, and rebasing a correctness
fix onto a rename is how a fix gets silently dropped.

**2. Accessibility — H4 and V-4.** A browse-mode screen-reader user currently
has no way to turn a page at all: arrows go to the virtual cursor and there are
no real `<button>` controls. This is the most serious functional hole open, and
it sat in a table of hygiene observations only because that is where it was
first written down. V-4 (`data-stf-direction`, live-region `dir`) rides along.

**3. Define and prune the public barrel; add a packed `.d.ts` contract
fixture.** The root barrel currently publishes geometry algorithms, renderer
predicates and style internals beside the façade, and the test suite imports
implementation helpers _through the public package_. So D24 is not an invisible
internal collapse — those classes are emitted API. Pruning first makes every
later structural edit an honest public-API edit. The packed fixture must import
every supported symbol with positive and `@ts-expect-error` cases, because
Vitest aliases to source and the current packed check samples a handful of
symbols.

**4. Collapse the vestigial inheritance pairs; delete proven dead surface.**
Recovers bytes, and with 121 bytes of brotli headroom it has to come before
anything that spends. Collapse `Render`/`HTMLRender`, `UI`/`HTMLUI`,
`Page`/`HTMLPage` — and, per the signoff, `PageCollection`/`HTMLPageCollection`
too: `WEBGL_RENDERER.md` says the right seam is a headless controller extracted
when a second real consumer exists, and a speculative abstract subclass hook is
not that controller. Rebuild and record all three size numbers before spending
any recovered bytes.

**5. The naming pass — `FoldSide`, `readingDirection`, class namespacing.**
Signed off. `foldSide()` documents a physical side and returns a
`FlipDirection`; give it its own type and rename `Render.direction` to
`foldSide`. Rename the setting to `readingDirection` and its type to
`ReadingDirection`. Namespace the leaf classes (`stf__item--left`) so they stop
colliding with a consumer's own `--left`.

### After the top 5

6. **Redesign the two blocked internals.** D22 becomes explicit selected-leaf
   **plus** spread/head state — not a derivation. D23 becomes an immutable
   `TurnPlan` (direction, source spread, destination spread, flipping leaf,
   bottom leaf) consumed by both selection and commit, which is what actually
   removes `pendingTarget`. Both need their own design round.
7. **One authored-versus-resolved settings model**, then D2–D9 and D19–D21
   against it. `definedOnly` is not sufficient: after fixed-mode normalisation
   every synthesised bound looks authored, so D4's explicitness test would fail
   an unrelated `updateSettings({ drawShadow: false })`.
8. **Engine-owned React leaf slots**, settling the clone duplicate-ID, class
   namespace and background contracts together. This is D1, reshaped — the
   signoff's point is that index-keyed nullable refs diagnose the mismatch but
   leave the engine overwriting consumer inline styles and classes.
9. **Event snapshots and navigation results**, then D13–D18 and the completed
   `usePageFlip`. Announcements must follow committed engine state, not the
   requested prop, or assistive technology is told about a page before it is on
   screen.
10. **Sweep the residue** — S8, S9, U10, E6, V3, Z3, AN5, E8, NF4, T1. S9 and
    U10 are deletions. E8 needs a contract decision and an ADR line, not a
    silent fix. NF4 is the one real redesign in the group.
11. **Verify — V-1, V-2. Before publish, not after.** If the flagship back-flip
    is wrong on a real phone, everything above is rearranging furniture.
12. **Publish — V-5.**

---

## What we are deliberately not doing

- **E2** — no reproduction, no repository evidence. Investigating is fine;
  promising a fix is not.
- **Lowering `flippingTime` to 600.** Retired by the signoff: 1000 is a scaled
  _maximum_, and an ordinary ~400-point move already runs ~400 ms, so 600 would
  make normal turns 240 ms.
- **Renaming `pageBackground` to `foldBackground`.** It paints every static
  leaf too, so the new name would hide half the contract. The silent-fallback
  defect is still real and stays in scope.
- **The WebGL renderer** — deferred by the owner 2026-08-28. Read
  `docs/WEBGL_RENDERER.md` first.
- **The 35 kB size target** — retired. Upstream `page-flip@2.0.7` is itself
  44,058 B minified, so the target asked this fork to be ~20% smaller than the
  thing it forks while doing strictly more.
