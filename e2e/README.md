# Browser tests

The engine's flagship fixes — the portrait back-curl (§4.1) and the opaque fold
(§4.2) — cannot be proven by unit tests. They passed downstream while the live
book still showed the slide-in, which is why this suite exists.

It asserts invariants, not pixels. Committed screenshots would be
platform-specific, would go stale on any cosmetic change, and could not say
_why_ a frame is wrong. These read the fold straight off the running engine:

- the leaf being animated is a **copy of the current page**, not the previous
  one, and the previous leaf is painted underneath it;
- the turning leaf is **opaque**;
- the fold travels **rightward on screen** across a backward drag;
- landscape spreads, hard covers, and `direction: 'rtl'` behave.

Chromium and WebKit both run in CI. WebKit is not optional: iOS Safari is where
the upstream bug lives, and the two engines genuinely disagree about the
bounding box of a clipped, transformed leaf — which is why the assertions read
engine state rather than DOM geometry.

```bash
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

The suite drives `examples/vanilla`, which Playwright builds and serves. Its
query string configures the book: `?cover=1`, `?rtl=1`, `?flippingTime=0`.
