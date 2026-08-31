# Residual product findings from PLAN-3.1 implementation

Written 2026-08-31 while implementing `docs/PLAN-3.1.md` (Campaigns A–C).
These are **still in the product** (or still in the repo tooling). They are not
the fixed class-pair / frame-discipline / `turnProgress` work.

Severity is relative to a picture-book reader: **P0** would ship-block;
nothing here is P0. Items are ordered roughly by how much they still cost a
real consumer.

---

## 1. Frame-discipline residual — soft static leaves + shadows still hot every rAF

**Kind:** performance (Puddlebend Issue 3 residue)  
**Where:** `Render.drawLeftPage` / `drawRightPage` (`simpleDraw` branch),
`drawOuterShadow` / `drawInnerShadow` / hard-shadow siblings  
**Evidence:** B1 budget tests after B3.1–B3.4 — resting redraw is **0** writes;
mid-fold soft landscape is still **~48** recorded writes (was **106**).

What shipped fixed the worst of it (style memo, delta `--shown` clear, z-index
and class elision). What did **not** ship:

- Soft landscape still calls `simpleDraw` on **both** static halves every
  frame while a fold is in progress. Memoization usually turns the style write
  into a no-op, but the path still runs (string build, `classList.contains`,
  function call).
- Soft (and hard) **shadow nodes** still take a full `style.cssText = …`
  replacement every frame (`Render.ts` outer/inner/hard shadow drawers). There
  is no stamp-memo parallel to `Page.applyEngineStyle`.
- The flipping leaf’s clip/transform string changes every frame, so it is a
  permanent memo **miss** — expected — and still pays full style application.

**User-visible?** No pixel bug on desktop GPUs for typical page counts. Still
the battery / main-thread cost that scales with leaf count during a held drag.

**Not fixed because:** PLAN-3.1 B3 scoped to memo + delta clear + z/class
elision. Skipping `simpleDraw` entirely for unchanged static leaves, and
memoizing shadow cssText, is a follow-on.

---

## 2. `foldFill` / `CSS.supports` still on the paint hot path

**Kind:** performance + test-noise  
**Where:** `packages/core/src/Render/pageBackground.ts` (`foldFill` →
`normalizePageBackground` → `CSS.supports('color', …)`), called from
`Page.applyEngineStyle` on every **cache miss**

B3.1 correctly moved `foldFill` **after** the memo check so a resting hit does
not pay it. The flipping leaf misses every frame, so colour re-validation still
runs ~once per rAF for the duration of a turn.

In jsdom, `CSS.supports` probes via a throwaway element (writes that show up as
a bare `<div>` in the style-write recorder). Browsers are cheaper, but it is
still work that does not need to repeat when `pageBackground` has not changed
since construction / `updateSettings`.

**User-visible?** No. Wrong colours are still rejected; the cost is pure
overhead.

**Not fixed because:** caching the last accepted fill string next to settings
(or on the page after first successful foldFill) was out of B3 scope.

---

## 3. Engine style memo — intentional contract change mid-animation

**Kind:** product contract / integration gotcha (accepted in PLAN-3.1 B3.1)  
**Where:** `Page.applyEngineStyle` memo (`lastEngineCss` / `lastBackground`)

Before B3.1 the engine re-stamped engine-owned inline declarations every frame.
After B3.1 it skips when the stamp string is unchanged. A consumer who mutates
those same properties **during** an animation (fighting the engine with
inline `clip-path` / `transform` / paper vars) only gets overwritten on the
next frame whose stamp **differs**, not on every rAF.

**User-visible?** Only for apps that deliberately fight engine paint mid-turn.
Normal React/vanilla usage is unaffected. Resting frames and real fold motion
still stamp correctly; invalidation covers density, orientation, adopt/release,
`update` / `reload`, and `pageBackground` settings changes.

**Documented as accepted** in the B3.1 commit message; repeated here so it is
not mistaken for an accidental regression.

---

## 4. Pointer hit-testing ignores rotate / skew on ancestors

**Kind:** interaction geometry  
**Where:** `UI.getMousePos` — `packages/core/src/UI/UI.ts` (comment at the
known-limitation block)

`getBoundingClientRect()` + `offsetWidth` recovers **translation and scale**
only. Under an ancestor `rotate()` or `skew()`, the fold runs away from the
finger: the ratio is a cos/sin mix, and `left/top` is a bounding-box corner
rather than the element origin.

**User-visible?** Yes, if a book is rendered on a rotated/skewed surface.
No known in-tree consumer does that today.

**Not fixed because:** already marked known-limitation; full `DOMMatrix`
inversion is size-budget-sensitive and had no requesting consumer. Still true
after the UI collapse.

---

## 5. `turnProgress` will not drive a scrubber alone

**Kind:** API semantics / authoring gotcha (by design in PLAN-3.1 C, still easy
to misuse)  
**Where:** `Flip.do` → `EMIT_TURN_PROGRESS`; React `onTurnProgress`

Still true after Campaign C ships:

| Situation                                       | `turnProgress` behavior                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `flippingTime: 0` / reduced-motion instant turn | **No events** (`suppressProgress`)                                                              |
| Corner hover peel (`FOLD_CORNER`)               | **No events**                                                                                   |
| Animated turn / drag                            | Events with `progress ∈ [0, 1]`, no promise of a terminal `1.0`                                 |
| Snap-back cancel                                | Progress falls; **no** synthetic `0`                                                            |
| Turn completes                                  | Completion is `flip` / `changeState` / `changePage` — **not** a guaranteed final `turnProgress` |

A scrubber that only listens to `turnProgress` will freeze on instant turns and
may never reach the end thumb position without also handling `flip` (or
`changeState`).

**User-visible?** For authors who wire only `onTurnProgress`. Documented in
the event docblock / README; still a footgun.

---

## 6. Two-owner leaf DOM (unchanged by collapse)

**Kind:** architecture / integration risk  
**Where:** engine still stamps classes + inline styles on consumer-owned page
roots; React portals into `.stf__block`

Campaign A collapsed the class pairs; it did **not** introduce binding-owned
leaf hosts. Consumer roots remain dual-owned. Already on `docs/TODO.md` as
4.0-shaped (Puddlebend Issue 2 residue). Re-stated because collapse work
re-read this path and confirmed it is still the live model.

---

## 7. Tooling: Linux golden updater breaks under `set -u`

**Kind:** repo tooling (not runtime product)  
**Where:** `scripts/update-golden-linux.sh:35`

```bash
echo "Running golden suite in $IMAGE…"
```

With `set -u`, bash treats `$IMAGE…` as a single parameter name (`IMAGE` +
Unicode ellipsis), not `$IMAGE` followed by an ellipsis character. The script
exits with unbound variable before Docker runs. B2 worked around it by invoking
the Playwright image manually.

**User-visible?** Only maintainers regenerating `-linux` baselines via
`pnpm test:e2e:golden:update:linux`.

**Fix:** `"Running golden suite in ${IMAGE}…"` (brace the variable).

---

## Explicitly **not** listed here

- Bugs that **were** fixed in A–C (class-pair dead code paths, full-collection
  `clear()` every frame, missing `turnProgress`, etc.).
- Backlog already on `docs/TODO.md` that this session did not newly observe
  (`--stf-paper-base`, `centerClosedBook`, gutter, `allowTextSelection`, …).
- Test-harness-only issues (e.g. `TestRender` ctor shape) that never shipped to
  consumers.

---

## Suggested follow-ups (owner triage)

| ID  | Item                                                                                | Suggested track                           |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| R1  | Skip `simpleDraw` when static leaf stamp unchanged **and** memoize shadow `cssText` | perf / frame-discipline round 2           |
| R2  | Cache last `foldFill` result on settings or page                                    | micro-perf                                |
| R3  | Brace `$IMAGE` in `update-golden-linux.sh`                                          | one-line tooling fix                      |
| R4  | Scrubber recipe: `turnProgress` + `flip` completion (docs sample)                   | docs only if README snippet is incomplete |
| R5  | Rotated-host hit testing                                                            | only if a real consumer needs it          |
