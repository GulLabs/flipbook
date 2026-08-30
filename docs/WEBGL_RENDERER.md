# A WebGL renderer — deferred, with the homework done

**Status:** deferred by the owner on 2026-08-28. Not scheduled. This document
exists so the analysis does not have to be redone, and so the decision is
revisited on evidence rather than on enthusiasm.

**Read this first if:** someone proposes a 3D flipbook, or asks why the engine
is not built around a renderer plug-in system.

---

## The short version

For a picture-book app that already rasterizes pages to bitmaps, a WebGL
renderer is viable and would look categorically better than the DOM one. It is
deferred because 3.0.0 is not released, the downstream migration has not
happened, and adding a third renderer to an abstraction whose second renderer
is vestigial is the wrong order of work.

When it is revisited, the important finding is this: **do not implement
`Render`.** The seam a WebGL renderer needs is the state machine, not the
renderer interface. See [The seam](#the-seam) below — that section is the
reason this document is worth keeping.

---

## Why WebGL is viable here (and usually is not)

The usual objections to a WebGL flipbook did not survive contact with the
actual downstream app. Recorded with evidence so nobody re-litigates from
first principles:

| Objection                                    | Why it does not apply                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| three.js is ~600 kB against an 11 kB engine  | Only cheap if the consuming app already loads three / r3f. A consumer that does not should not take this renderer.                   |
| Pages become textures, so you lose live HTML | Some picture-book apps already rasterize composed HTML to page-sized bitmaps before flip. That cost is already paid there.           |
| Text selection and a11y regress              | Already gone for the same reason — the type is pixels. Alt text on the `<img>` is the accessibility story today and would remain so. |
| It is a rendering engine to hand-roll        | If r3f is already in the consuming stack, this is components, not an engine.                                                         |

None of this generalises to other consumers of `@gullabs/react-flipbook`. A
consumer with live HTML pages pays all four costs. If this ever ships as a
package, that distinction belongs in its README in the first paragraph.

## What "beautiful" actually requires

The DOM renderer folds a page with a `clip-path` polygon and a rotation. That
is a **flat fold** — a triangular crease. Paper curls into a cylinder, and the
gap between those two is most of the visual difference.

The technique is a **SkinnedMesh**, not a shader trick:

1. **Geometry** — `PlaneGeometry(w, h, ~30, 2)`, skinned. The ~30 segments
   along the width are what permit a real cylindrical bend.
2. **Bones** — one per segment column, chained along x; skin weights derived
   from each vertex's x position.
3. **Materials** — front texture, back texture, and a thin edge material so the
   leaf has thickness.
4. **Animation** — map flip progress to per-bone rotation with a **delay
   cascade** (each bone lags its predecessor) and spring easing. That lag is
   what reads as weight; without it the curl looks like a folding screen.
5. **Lighting** — one directional light plus an environment map. Specular sheen
   travelling across the curve is most of what sells the effect, and it is
   exactly what CSS gradients can only approximate.

## The seam

This is the part that matters, and it is the opposite of the obvious answer.

`Render` is the wrong base class. Its interface is DOM-shaped to the bone:
clip areas as polygon point lists, `cssText` assembly, `convertToGlobal`,
`setPageRect`. `FlipCalculation` computes fold polygons. A WebGL renderer wants
none of it — it wants a scalar and a corner, and derives its own bone
rotations.

What a WebGL renderer actually needs from this engine:

- current spread and page indices, honouring `showCover` and RTL ordering
- a normalized flip progress (0..1) with direction and corner
- a "commit this turn" signal

That is `PageCollection` plus a progress signal. It is also, not
coincidentally, the part of this engine that was hardest to get right —
spread-bounded turns, RTL direction resolution, reduced motion, synchronous
instant turns.

So the extensibility work, when it is justified, is **extracting a headless
controller** that both `HTMLRender` and a WebGL renderer consume — not adding
a third `Render` subclass.

Two things follow from that:

- The existing `Render` abstraction has never been validated. Its only other
  implementation, `CanvasRender`, came from upstream (Nodlik, 2020-07-08) and
  sits near 5% coverage. It is inherited, not designed-for, and it is not
  evidence that the seam works.
- Do the extraction only when there is a second real consumer. Building it
  ahead of one is speculative generality, and the interface will be wrong in
  ways nobody can predict from the armchair.

## The risk that kills WebGL books

**GPU texture memory on mobile.**

1600×2400 RGBA is roughly **15 MB uncompressed per page**. Twenty pages is
~300 MB resident, and mobile Safari will kill the tab.

Mitigations, both required:

- **Compressed textures** — KTX2/Basis, roughly a 6–8× reduction.
- **A resident window** — keep textures only for pages near the current spread.
  Conceptually the same idea as `lazyRadius` in the DOM renderer, applied to
  GPU memory instead of the DOM.

This matters more here than for most projects: this fork exists because of a
**mobile portrait** bug. A renderer that is beautiful on desktop and dies on a
phone has traded away the core use case. Any prototype must be judged on a real
low-end Android device before anything else about it is discussed.

## How to revisit

Prototype **outside this repository first** — in the consuming app, standalone.
One spread, two real page JPEGs, r3f, bones, one light. Roughly a day.

Judge it on two questions, in this order:

1. Does it hold up on a real phone, with the memory budget above respected?
2. Does it actually look better with _your_ art — not with a demo asset?

Only if both are yes does the headless-controller extraction become the next
piece of work in this repo. Until then, the DOM renderer is the product.

## Prerequisites that are not negotiable

None of this starts before:

- 3.0.0 is published, and
- the downstream migration is done — consumers that monkey-patched the engine
  for a portrait back-curl can delete that layer and the book still works.

That migration is the acceptance test for the fixes this fork was built to
deliver. A second renderer built on unverified fixes inherits every one of
them.
