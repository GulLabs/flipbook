# TODO — the post-3.0 backlog

The canonical list of work that passed triage but sits **below the 3.0 ship
bar** defined by `docs/API-CONTRACT.md` §7. Everything here is additive or
internal — nothing on this list may reopen the locked surface; a 3.1 item that
turns out to need a breaking change goes back to the owner first.

Sources: the API contract's own deferrals (§6), the consumer P-findings
(`docs/reviews/test-writing-product-bugs-2026-08-30.md`), and the
example-authoring B/H findings (`.local/example-authoring-findings.md`).

## API additions (3.1, additive)

- [ ] **`validateFlipOptions(options): FlipSetting`** (P8) — a pure, exported
      preflight sharing `Settings.resolve`'s rules, so a CMS/config pipeline
      can reject bad book JSON in CI without a DOM. Until then the supported
      answer is "construction throws `INVALID_SETTING` with a `setting` key".
- [ ] **Controls styling seam** (P-doc §5) — `controlsClassName` or a
      `renderControls` slot so design systems paint the H4 buttons without
      forking a11y behavior. 3.0 answer: `controls="visible"` + the stable
      `data-flipbook-kb` / `data-flipbook-controls` attributes (documented in
      the README styling section).
- [ ] **Spread-space position** — `getSpreadCount()` / current spread index on
      the façade, for scrubbers and PDF-style pagers that need position in
      spread space rather than leaf space.
- [x] **`turnProgress` / `onTurnProgress`** — drive a scrubber thumb during an
      animated turn without rAF-polling `getState()` (PLAN-3.1 Campaign C,
      2026-08-31).
- [ ] **`<FlipPage>` wrapper component** (B2's optional half) — an inner-slot
      page primitive so consumers never learn the leaf-root layout rule the
      hard way.
- [ ] **`pageLabel` first-class API** — front-matter numbering ("iv") for the
      live region and chrome. 3.0 recipe: `liveRegionText`.
- [ ] **Shadow color tokens** (`--stf-shadow-*`) — brand the fold shadows the
      same way `--stf-paper` brands the paper.
- [ ] **`--stf-paper-base` token** — the opaque ground under the paper is a
      hard `#fff` today. Opaque `pageBackground` values cover it entirely, so
      it only shows through TRANSLUCENT paper — where a dark-themed book
      compositing over white gets washed out. A base token (validated opaque
      at the boundary, structural guarantee preserved) lets dark themes keep
      translucent paper. Additive, so 3.1.
- [ ] **Built-in center seam / gutter shading** — an opt-in spine at the
      landscape gutter (`--stf-gutter-*` tokens or a `spine` setting).
      story-book overlays its own `BookSpine` today (the §8 recipe); every real
      book has one, so first-class support belongs in the engine eventually.
- [ ] **`allowTextSelection` setting** — `.stf__block` sets `user-select: none`
      for drag correctness, which is right for picture books and wrong for
      full-HTML text pages a reader may want to copy from. Needs design (drag
      vs. selection arbitration), so 3.1.
- [ ] **`centerClosedBook` option** (Puddlebend contract ask §6) — the engine
      parks a closed book in the right half of the stage and a lone hard back
      cover in the left half; the consumer hand-builds the slide-to-center and
      a following floor shadow for both ends. The engine knows exactly when
      those states hold. At minimum: a documented recipe with `changeState` +
      `visiblePages`.
- [ ] **Frame discipline budget** (Puddlebend Issue 3) — one 800 ms landscape
      turn produces 40–60 style/class writes per frame across a 15-leaf book;
      a turn should touch the moving leaf, its copy, the leaf beneath, and the
      shadows. Add a max-writes-per-rAF-tick test, then trim the redraw set.
      Not user-visible on desktop GPUs, but it scales with page count and
      burns phone battery.
- [ ] **Binding-owned leaf hosts** (Puddlebend Issue 2 residue) — the engine
      still stamps classes/inline styles on consumer-rendered roots (two-owner
      DOM). It did not cause the remount flicker, but engine-owned host
      elements wrapping consumer content remain the cleaner ownership story.
      Breaking for DOM-selector consumers, so 4.0-shaped; design first.

## Internal hygiene (no observable change)

- [ ] **Collapse the three remaining class pairs** — `Page`/`HTMLPage`,
      `UI`/`HTMLUI`, `Render`/`HTMLRender` — and retire the façade-getter
      service-locator routing between siblings. Decided in
      `docs/ABSTRACTION-BOUNDARY.md`; the consumer-visible half already shipped.
      Do each pair whole or not at all (the reverted first attempt is the
      cautionary tale).
- [ ] **Headless-controller renderer seam** — the real extension point for a
      second (WebGL) renderer, per `docs/WEBGL_RENDERER.md`. Do not publish
      `Render` instead.
- [ ] **Give back bundle bytes** — the owner-raised ceilings (62/16/18 kB) were
      explicitly a loan; re-ratchet after the class collapses land.

## Examples & repo polish

- [ ] **Next.js example gets a real `flippingTime`** (H7) — the App Router demo
      currently proves "instant page swap", not the product. Do with the docs
      round if e2e permits.
- [ ] **Split the vanilla demo from the e2e harness** (B8/H9) —
      `window.flipbook` and `?golden=1` are harness, not consumer teaching
      material. Low priority.
- [ ] **Keep the P3 regression test green** — out-of-band
      `pageFlip()!.destroy()` then `flipNext()` must reject loudly; the fix is
      in, the test guards it (`consumer-audit.test.ts`).
