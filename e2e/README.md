# Playwright visual / gesture tests

Scripted swipe goldens at 25/50/75% of `flippingTime` for
`{portrait, landscape} × {forward, back}` plus hard-cover.

Run when Playwright browsers are installed:

```bash
npx playwright install --with-deps
pnpm exec playwright test
```

If the launcher cannot install or start, unit tests in `packages/core/tests`
and `packages/react/tests` are the gating bar.
