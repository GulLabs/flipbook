# Consumer integration report — Puddlebend reader on @gullabs/flipbook 3.0.0

**Status: BLOCKING RELEASE.** First real-world integration (the Puddlebend picture-book
reader, `/Volumes/SSD/code/work/story-book-flipbook-3`, branch `feat/flipbook-3-migration`)
against the 2026-08-30 21:54 tarballs (fork HEAD `51cb90d`). Portrait/mobile is a clean
pass — the back-curl and portrait opacity fixes hold up beautifully. **Landscape/desktop
has two release-blocking defects and one design flaw underneath them.** All evidence
(screenshots, repro scripts, DOM probes) is in `docs/consumer-report-assets/`.

How to reproduce everything below: the consumer app runs at `http://localhost:3601`
(worktree `story-book-flipbook-3`, `pnpm --dir apps/web exec next dev --port 3601 --webpack`),
book `cinders-paw-band`, and each `flip3-*.mjs` script in the assets dir is standalone
Playwright (`node <script>`).

---

## Issue 1 — Landscape fold is translucent (release blocker)

**What the consumer expects:** a turning leaf is paper — opaque, both faces, both
orientations. This is the B3 promise: "opacity of the fold is structural (an opaque base
layer under your paper color)."

**What the product gives:** in landscape, the turning leaf alpha-blends with the
destination page beneath it. `burst-04.png` is unambiguous: the turning page's text
("The more steps he took…") and the destination page's text ("…very unlike Cinder not to
wave…") are **both readable through each other**. `burst-02.png` shows the same with
artwork. Reported independently by the product owner watching live ("the flipping page
seems transparent").

**What makes it interesting:** every layer _claims_ opacity (probe `flip3-probe3.mjs`,
run mid-flip):

- moving item `.stf__item.--soft.--shown.--left` → `::before` computed
  `background-color: rgb(255,255,255)` + `background-image: linear-gradient(rgb(244,239,230), rgb(244,239,230))`
  (`pageBackground: "#f4efe6"` **is** arriving), `z-index: -1`
- consumer inner div → `background-color: rgb(255,255,255)`, `opacity: 1`
- no `opacity` anywhere in the cascade; engine core has no element-opacity writes

So the structural guarantee holds in the _style system_ and fails in the _render_. Prime
suspect: `.stf__item { transform-style: preserve-3d }` + `::before { z-index: -1 }` +
animated `transform` + `clip-path` on the same element. `z-index: -1` inside a
`preserve-3d` context is not a paint-order guarantee — the pseudo (and possibly the whole
opaque base) can be composited onto a different plane than the face during the 3D turn.
Portrait apparently avoids the geometry that triggers it; landscape hits it on every turn,
both directions.

**Update (post-triage split):** part of the perceived transparency was
consumer-side — the reader drew its own spine/gutter overlay ABOVE the engine's
stacking context, so every turning page passed under a permanently-visible seam.
Fixed in the consumer (spine now hides via `onChangeState` while
`state !== 'read'`). **The engine defect remains after that fix**, reduced but
unambiguous: a vertical band at the fold line (~40px in the retest frames) where
the turning page still alpha-blends with the static page beneath — both texts
readable in the band. Consistent with the paper `::before` detaching from the
face plane near the fold, where rotation is steepest.

**Root cause (corrected after adversarial review, codex task-mtgwoxvq):** the
preserve-3d/pseudo-plane theory above is NOT spec behavior — `clip-path` forces
used `transform-style` to `flat`, and negative z-index has defined ordering
inside the leaf's stacking context. The actual weakness: `applyEngineStyle`
strips `background-color` from the leaf root (HTMLPage.ts:65,81) and hangs ALL
opacity on the `z-index:-1` pseudo (styles.ts:31,49), while the soft fold puts
`transform` + `clip-path` on that otherwise-transparent root (HTMLPage.ts:336,376)
— fragile against compositor behavior even if spec-legal. **Minimal fix:** paint
the opaque base + `pageBackground` layer directly on the element that receives
the fold transform/clip (or an engine-owned inner face if consumer root
backgrounds must be preserved). Dropping the unneeded `preserve-3d` is a cheap
hardening A/B. The existing golden-visual idea from
the migration plan (§8: frames at 25/50/75% of flippingTime, portrait × landscape ×
forward × back) would have caught this — landscape frames clearly aren't covered yet, and
must be before release.

---

## Issue 2 — Whole-book DOM teardown at turn end → destination-page flicker (release blocker)

**What the consumer expects:** a turn that lands on the next spread repaints the two
leaves involved. A re-render of the React children with **identical keys and identical
content** is a no-op (the binding's own `sameNodes` guard promises exactly this).

**What the product gives:** the destination page visibly flickers as the turn lands
(product owner, live, desktop). Mutation tracing (`flip3-mut2.mjs`) shows why — at
t=927ms, right at animation end:

```
DIV.stf__wrapper  ← removed  "DIV.stf__block"
DIV.stf__parent   ← removed  "DIV.stf__wrapper --landscape"
DIV.stf__parent   ← added    "DIV.stf__wrapper --landscape"
```

The engine's **entire scaffold is unmounted and remounted** — one frame with no book in
the tree. That is the flicker.

**The trigger is a completely ordinary consumer pattern:** the reader syncs the page turn
to the URL (`router.replace('…?spread=N')`) from `onPageChange`. In Next.js App Router
that re-renders the route (the same trace shows the `<head>` meta churn at the same
timestamp), so the children re-render at exactly turn-end — same keys, same content.

**The design flaw underneath:** the engine stamps its state — `stf__item`, `--shown`,
`--left/--right`, inline styles — **directly onto consumer-rendered elements**. When
React re-renders those elements it re-asserts `className="h-full w-full"`, wiping the
engine's classes (an un-`--shown` leaf is `visibility: hidden` — a flash all by itself),
the collected node list no longer matches, `sameNodes` fails, and `updateFromHtml`
rebuilds the world mid-frame. Two owners, one attribute. React will always win a fight
over DOM it rendered; the engine must not write state where React will erase it.

**Root cause (corrected after adversarial review, codex task-mtgwoxvq — the
class-wipe chain above is REFUTED):** `wrapChildren` keeps keys/types, React
preserves the DOM nodes, `sameNodes` passes, and `updateFromHtml` never removes
the wrapper (only UI destruction does, UI.ts:260,271). The real chain was a
CONSUMER bug amplified by a binding contract: the reader passed its
URL-searchParams `initialSpread` straight into `initialPage`; every
`router.replace` the reader wrote handed back a new `initialPage`, and
`initialPage` is part of the binding's engine **remount key**
(HTMLFlipBook.tsx:98,113) — so every turn remounted the engine
(HTMLFlipBook.tsx:721,740). **Fixed consumer-side** (freeze the deep link at
mount; MutationObserver now shows zero `stf__wrapper` mutations per turn).

**Remaining design asks for the lib (softened from "blocker" to "sharp edge"):**

1. Document loudly — on `initialPage` and in MIGRATION.md — that it is
   remount-keyed, and that URL-sync consumers must freeze it after mount or use
   the controlled `page` prop. This footgun cost a day; every deep-linkable
   reader will step on it.
2. Consider warning (dev-only) when `initialPage` changes identity within N ms
   of a `flip` event — that pattern is almost always this bug.
3. The engine still stamps classes/styles on consumer-rendered roots
   (two-owner DOM). It did not cause this flicker, but binding-owned hosts
   remain the cleaner ownership story for consumer-prop changes.

---

## Issue 3 — Per-frame style churn across the whole book (performance)

During one 800ms landscape turn, MutationObserver (`flip3-mutations.mjs`) counts
**350–460 style/class attribute writes per 100ms** (≈40–60 per frame at 60fps), sustained
for the full animation, on a 15-leaf book.

**Expected:** a turn touches the moving leaf, its temporary copy, the leaf beneath, and
the shadow elements — single-digit writes per frame. Everything else is static.

Not user-visible today on a desktop GPU, but it scales with page count, burns battery on
the mobile devices the portrait mode exists for, and made the flicker diagnosis noisier
than it should have been. Worth a frame-budget test: max style writes per rAF tick during
a turn.

---

## Issue 4 — `flippingTime` is a ceiling, not a duration (API honesty)

Observed by the product owner: mobile flips are visibly faster than desktop.
Cause (Flip.ts `getAnimationDuration` + Helper.ts `pointsBetween`): the
animation is built with one point per px of travel, and duration =
`(points / 1000) × flippingTime` whenever the path is under 1000 points. So
`flippingTime: 800` means 800ms on a ≥500px page and ~560ms on a 350px phone
leaf — the setting silently means different things on different screens.
Inherited from upstream; the magic 1000 is undocumented and unreachable.

**Expected:** `flippingTime` means what it says on every page size (constant
duration, speed derived from path), or the reference is an explicit setting.
Consumer-side we now compensate (`flipTimeForPage`: scale the setting back up
by `1000 / (2×pageW)`), which is exactly the kind of engine-internals
arithmetic a consumer should never need.

## The contract we want, stated plainly: lib out-of-the-box vs consumer-controlled

One day of integration made the ownership line very clear. The principle: **the
engine owns the physics of paper; the consumer owns the meaning of the book.**
Everything that went wrong today was one side reaching across that line.

### What the lib must deliver out of the box (zero config, not opt-in)

1. **Opaque paper, always.** A turning leaf never shows what is under it —
   both faces, both orientations, mid-animation, on every compositor. This is
   the product; nothing else matters if paper is see-through. (Issue 1.)
2. **A stable DOM across turns and consumer re-renders.** Turning a page must
   never unmount the engine scaffold, and a consumer re-render with stable
   keys must be a no-op. Remount-keyed props (`initialPage`, `hardCovers`,
   `injectStyles`) are a legitimate design, but each needs LOUD documentation
   and ideally a dev-mode warning when one churns right after a `flip` —
   that churn is almost always the URL-sync footgun we hit. (Issue 2.)
3. **Correct physics per orientation** — portrait back-turn curls the current
   leaf away (already delivered; it is why this fork exists).
4. **Honest, complete position data**: `BookSnapshot` with the true leaf index
   and `visiblePages`, events firing only on real change. Already good — this
   is what let the consumer build page-number chrome today without touching
   engine internals.
5. **A built-in gutter/spine option.** Today the consumer paints the center
   crease by targeting `.stf__item.--left/--right::after` — stable selectors,
   but still a consumer reaching into engine DOM to draw something the engine
   understands better (it knows the fold geometry and lighting). Offer
   `gutter?: boolean | { width, strength }` rendered under the moving leaf.
   Keep the stable selectors documented for consumers who want their own.
6. **Closed-book centering as an option.** The engine parks a closed book in
   the right half of the stage (physically right), and shows a lone hard back
   cover in the left half. The consumer had to hand-build the slide-to-center
   for the front cover AND its mirror at the back, plus a floor shadow that
   follows. The engine knows exactly when these states hold; a
   `centerClosedBook` option (or at minimum a documented recipe) belongs in
   the box.
7. **Frame discipline.** A turn touches the moving leaf, its copy, the leaf
   beneath, and shadows — single-digit style writes per frame, not 40–60
   across the whole book (Issue 3). Idle book = zero rAF (already promised).
8. **Accessibility floor**: keyboard, live region, skip-link controls,
   reduced-motion — shipped on by default, each individually opt-outable
   (already the design, and the opt-outs all worked first try — keep this).

### What the consumer must stay in control of (the lib exposes data, never renders opinion)

1. **All chrome and all words.** Pills, dots, folio labels, "Page 7 of 28" vs
   "Spread 3", live-region phrasing, localization. The lib's job is the
   snapshot; the moment it renders copy into our night-table reader it is
   wrong. (`liveRegion={false}` + `controls="none"` made this clean today.)
2. **The navigation model.** What position means (we persist desk-spread URLs
   so a phone link opens the same reading position on a desk), what deep links
   look like, what history writes happen. The lib needs only stable leaf
   indices and `turnToPage`/`flipToPage` that do what they say.
3. **Gesture semantics.** Our phone reader owns tap zones (wide-right = next,
   left margin = back, cover always opens) and swipe thresholds tuned for
   two-year-olds' parents. `pointerInput={[]}` as a first-class escape hatch —
   engine input fully off, consumer drives via the imperative handle — is
   exactly right. Never let engine input half-listen when disabled.
4. **Page content and paper identity.** What a leaf renders, inset, paper
   color (`pageBackground` as a consumer-set value painted by engine
   machinery is the right split), hard/soft declaration per leaf.
5. **Stage presentation.** Canvas color, floor shadow, stage padding, sizing
   breakpoints, when to remount for a layout change (`key={layout}`), motion
   durations and easings for everything OUTSIDE the fold itself.

## What passed (so the fixes don't regress it)

- **Portrait back-turn curls** — current leaf peels right, previous leaf revealed
  beneath, opaque throughout (`f3-back-mid1.png`). The flagship fix works.
- **Portrait forward, tap zones, swipe thresholds** — correct and committed to the URL.
- Deep link `?spread=3` lands correctly; desk ArrowRight/chevrons/dot-jump all correct
  (`spread=3 → 4 → 3 → 14`); zero console errors throughout; 420/420 consumer tests and
  typecheck/lint green against the tarballs.

## Consumer-side conclusions (for the puddlebend migration, recorded here for context)

The migration branch deletes the entire `installPortraitBackCurl` monkey-patch layer and
its code compiles/tests green against 3.0.0 unchanged — the façade is good to consume.
The branch stays unmerged until Issues 1 and 2 are fixed in the engine/binding; we will
re-vendor fresh tarballs and re-run this exact battery (scripts in the assets dir) as the
acceptance pass.
