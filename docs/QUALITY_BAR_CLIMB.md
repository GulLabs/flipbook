# Quality bar climb

Tracked work to raise TypeScript / ESLint strictness to the bar used on other
GulLabs libraries. Each phase is one PR-sized unit, green `pnpm quality:ci`, and a
**Codex signoff** before the next phase starts.

Agent working rules: [`AGENTS.md`](../AGENTS.md). Architecture: [`CLAUDE.md`](../CLAUDE.md).

Baseline measured on `feat/gullabs-flipbook-3.0` (2026-08-28):

| Gate                               | If enabled at baseline | Size                                  |
| ---------------------------------- | ---------------------- | ------------------------------------- |
| `no-unsafe-*` → error              | **0 errors**           | Free                                  |
| `no-unnecessary-condition` → error | **~12 errors** then    | Free after B (re-measured 0)          |
| `noUncheckedIndexedAccess` → true  | **~45 `tsc` errors**   | Real work; mostly `PageCollection.ts` |

---

## Status legend

| Status         | Meaning                                     |
| -------------- | ------------------------------------------- |
| `todo`         | Not started                                 |
| `in_progress`  | Active                                      |
| `blocked`      | Waiting on prior phase or external signoff  |
| `codex_review` | Implementation done; awaiting Codex signoff |
| `done`         | Codex signed off; landed on climb branch    |

---

## Phase A — Promote `no-unsafe-*` to error

**Status:** `done`  
**Depends on:** nothing

### Work

- [x] `eslint.config.mjs`: all five `@typescript-eslint/no-unsafe-*` → `'error'`
- [x] Ignore generated `packages/*/size-check/**` in ESLint + `.gitignore`
- [x] `pnpm lint` / `pnpm quality:ci` green
- [x] Commit (`b7c9749` + follow-ups)
- [x] Codex signoff

### Codex signoff

- Job: `task-mtcx6ei4-6po5r6` (session `01a04850-528e-7810-a5d6-74bd6a0d7ef4`)
- Verdict: **APPROVE_WITH_NITS** — Phase A signoff: **YES**
- Date: 2026-08-28

---

## Phase B — `noUncheckedIndexedAccess` + lifecycle boundary

**Status:** `done`  
**Depends on:** Phase A signed off

### Why

Indexed access was loose, so OOB guards looked “impossible” to ESLint. Enable
NUIA and fix the type model. Lifecycle fields follow **AGENTS.md §4**, not
definite-assignment `!` and not nullable public getters.

### Decision — nullable **private** fields, non-null **public** getters

Per `AGENTS.md`:

> Internals that don't exist before `loadFromHTML` are `| null` **privately**;
> public getters keep non-null signatures and throw `PageFlipError('NOT_LOADED')`.
> Do not "clean up" either half: definite-assignment `!` makes the published
> `.d.ts` lie; nullable public getters break every consumer.

**Shipped:**

- [x] `tsconfig.base.json`: `"noUncheckedIndexedAccess": true`
- [x] `at()` helper (`packages/core/src/arrayAccess.ts`) for spreads/pages/frames
- [x] Hardened `PageCollection` / `FlipCalculation` / `Render` / `CanvasUI`
- [x] `pages` / `render` / `ui` are `T | null` privately
- [x] Public getters throw `PageFlipError` with code `NOT_LOADED`
- [x] Private choke points: `pagesOrThrow` / `renderOrThrow` / `uiOrThrow`
- [x] Pre-load safe no-ops: `update` / `updateSettings` / `destroy` / `getState`
- [x] `packages/core/tests/lifecycle.test.ts`
- [x] `UI.distElement` stays definite-assignment (set in every subclass ctor)
- [x] `pnpm quality:ci` green
- [x] Commits on branch (incl. `7be60fd`, `2b19268`, and follow-ups)
- [x] Codex signoff (this turn)

### Exit criteria

- NUIA on monorepo-wide
- No `@ts-expect-error` papering over array access
- Lifecycle matches AGENTS.md §4
- Do **not** raise size ceilings further (AGENTS.md §2) — debt tracked below

### Codex signoff

- Jobs: `task-mtd1ib9r-d60hct` (REQUEST_CHANGES), then `task-mtd1t60z-35bpcf` after fixes
- Verdict: **APPROVE** — Phase B signoff: **YES**
- Date: 2026-08-28
- Size ceiling history remains tracked debt (no further raises)

---

## Phase C — `no-unnecessary-condition` → error

**Status:** `done`  
**Depends on:** Phase B implementation (NUIA + lifecycle)

### Why

Only honest after NUIA. Re-measured after B: **0 errors** with the rule at
`error`.

### Work

- [x] `eslint.config.mjs`: `no-unnecessary-condition` → `'error'`
- [x] No new long-term suppressions required
- [x] `pnpm lint` green
- [x] Commit
- [x] Codex signoff

### Exit criteria

- Rule is error on typed package + example sources
- Zero suppressions except documented exceptions (none expected)

### Codex signoff

- Job: `task-mtd1t60z-35bpcf` (session `01a048c7-0cee-7bb0-82ae-54a70666605f`)
- Verdict: **APPROVE** — Phase C signoff: **YES**
- Date: 2026-08-28

---

## Phase D — Optional ratchets (post C)

**Status:** `done` (D1–D5 complete)  
**Depends on:** Phase C signed off  
**Estimate:** one sub-item per commit + Codex signoff

| Item                                  | Status | Notes                                               |
| ------------------------------------- | ------ | --------------------------------------------------- |
| D1 `useUnknownInCatchVariables: true` | `done` | Codex APPROVE_WITH_NITS                             |
| D2 `verbatimModuleSyntax: true`       | `done` | Codex APPROVE                                       |
| D3 `strict-boolean-expressions`       | `done` | error + pragmatic allowString/Number/nullableObject |
| D4 Coverage floors ratchet            | `done` | 58/66/42/57 (from 40/40/35/40); do not lower        |
| D5 Package `typecheck` includes tests | `done` | core include tests; react `tsconfig.tests.json`     |

### D1 — `useUnknownInCatchVariables: true`

**Status:** `done`

- [x] `tsconfig.base.json`: `"useUnknownInCatchVariables": true`
- [x] `pnpm typecheck` / `pnpm quality:ci` green
- [x] Commit
- [x] Codex signoff

#### Codex signoff

- Job: `task-mtd24vll-ks0412` (session `01a048cf-6273-7023-b0db-ec206c12ba3e`)
- Verdict: **APPROVE_WITH_NITS** — Phase D1 signoff: **YES**
- Date: 2026-08-28

### D2 — `verbatimModuleSyntax: true`

**Status:** `done`

- [x] `tsconfig.base.json`: `"verbatimModuleSyntax": true`
- [x] `pnpm typecheck` green (0 residual debt)
- [x] Commit
- [x] Codex signoff

#### Codex signoff

- Jobs: `task-mtd28yf0-cbi00t` (REQUEST_CHANGES doc), then `task-mtd2dfnr-4kepog`
- Verdict: **APPROVE** — Phase D2 signoff: **YES**
- Date: 2026-08-28

### D3 — `strict-boolean-expressions`

**Status:** `done`

- [x] Rule on typed package sources (allowString/Number/NullableObject)
- [x] Fix residual debt (nullable boolean prop checks)
- [x] `pnpm lint` green
- [x] Commit
- [x] Codex signoff

### D4 — Coverage floors ratchet

**Status:** `done`

- [x] Raise thresholds toward measured suite (not above flaky headroom)
- [x] `pnpm test:coverage` green
- [x] Commit
- [x] Codex signoff

### D5 — Package `typecheck` includes tests

**Status:** `done`

Root `pnpm typecheck` runs `tsc -p tsconfig.json` (covers `vitest.setup.ts`, `playwright.config.ts`, package tests globs) then per-package typecheck. React `tsconfig.tests.json` also includes `vitest.setup.ts`.

- [x] `packages/core` typecheck includes `tests/`
- [x] `packages/react` `tsconfig.tests.json` + dual typecheck script
- [x] `vitest.setup.ts` included in root + react test typecheck programs
- [x] `pnpm typecheck` green
- [x] Commit
- [x] Codex signoff

---

### Phase D batch Codex signoff (D3–D5)

- Job: `task-mtd3wqd0-yoi8yv` (session `01a048fc-d6c8-7cb1-9e7d-0ce89c884325`)
- Verdict: **APPROVE_WITH_NITS**
- D3 YES / D4 YES / D5 YES / Phase D **COMPLETE**
- Date: 2026-08-28

---

## Tracked debt — bundle size

Superseded by "Bundle size: the measured baseline" below, which replaces the
figures that used to live here. They were wrong: they cited a 35 KiB spec target
that upstream itself never met, an unmeasured upstream baseline, and KiB/kB
units that disagreed with what `size-limit` enforces.

---

## Anti-patterns (do not)

- Enable `no-unnecessary-condition` before NUIA
- Mass `!` on array access to silence NUIA
- Definite-assignment `!` on pre-load engine fields (lies in `.d.ts`)
- Nullable **public** getters for engine services
- Raise size / coverage ceilings to make a gate green
- Ship a gate change without Codex signoff

---

## Climb log

| Date       | Phase | Event                                                 |
| ---------- | ----- | ----------------------------------------------------- |
| 2026-08-28 | —     | TODO written; baseline measured                       |
| 2026-08-28 | A     | Done — Codex APPROVE_WITH_NITS                        |
| 2026-08-28 | B     | Done — Codex APPROVE (NUIA + lifecycle)               |
| 2026-08-28 | C     | Done — Codex APPROVE (no-unnecessary-condition)       |
| 2026-08-28 | D1    | Done — Codex APPROVE_WITH_NITS                        |
| 2026-08-28 | D2    | Done — Codex APPROVE                                  |
| 2026-08-28 | D3–D5 | strict-boolean, coverage, typecheck-tests             |
| 2026-08-28 | D3    | Done — strict-boolean-expressions                     |
| 2026-08-28 | D4    | Done — coverage floors ratchet                        |
| 2026-08-28 | D5    | Done — typecheck includes tests                       |
| 2026-08-28 | size  | Merged quality-guards: extra engine tests + size pass |
| 2026-08-28 | cov   | Lock-in after engine tests — global + per-area floors |

---

## Coverage lock-in (post engine-test climb)

**Status:** `done` (measured 2026-08-28; floors only move UP)

After the geometry / pointer / fold / canvas / React test climb, global and
per-area floors were ratcheted to just under measured. `pnpm quality:ci` runs
both `test:coverage` (global) and `test:coverage-areas` (critical files).

### Global (`vitest.config.ts`)

| Metric     | Floor | Measured |
| ---------- | ----- | -------- |
| Lines      | 90    | ~92.2    |
| Statements | 88    | ~90.2    |
| Branches   | 74    | ~75.1    |
| Functions  | 94    | ~95.1    |

### Per-area (`scripts/check-coverage-areas.mjs`)

| File               | Floor L/B | Role                                     |
| ------------------ | --------- | ---------------------------------------- |
| FlipCalculation.ts | 93 / 85   | Mirror-invariant fold math               |
| UI.ts              | 86 / 66   | Pointer / swipe / capture                |
| HTMLRender.ts      | 89 / 63   | Fold opacity, z-order (cssText)          |
| HTMLPage.ts        | 98 / 73   | Page draw path                           |
| Flip.ts            | 86 / 78   | State machine                            |
| CanvasRender.ts    | 87 / 70   | Minority canvas path (above smoke floor) |
| ImagePage.ts       | 86 / 64   | Image page draw                          |
| HTMLFlipBook.tsx   | 92 / 77   | React binding                            |
| usePageFlip.ts     | 98 / 98   | Hook actions + pre-attach no-ops         |

Do **not** drop a floor to make CI green. If coverage falls, restore the test
or the path — AGENTS.md §2.

Remaining low-ROI pockets (not area-gated): `Settings.ts` validation branches,
base `Render.ts` animation edge paths. Prefer invariant / e2e work over chasing
global 95%+.

---

## Commands

```bash
pnpm quality:ci
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:coverage-areas   # after test:coverage; needs coverage/coverage-final.json
```

---

## Bundle size: the measured baseline

Every size argument in this repo until 2026-08-29 was conducted against numbers
nobody had measured. Here is the measurement. Both artifacts are terser-minified
single-line ESM/UMD; `page-flip@2.0.7` was measured from its published tarball
(`npm pack page-flip@2.0.7`, `dist/js/page-flip.browser.js`).

|                                                            | raw (min) |   gzip | brotli |
| ---------------------------------------------------------- | --------: | -----: | -----: |
| `page-flip@2.0.7` (upstream, **includes** canvas)          |    44,058 | 10,360 |  9,261 |
| `@gullabs/flipbook-core` HTML engine (**excludes** canvas) |    45,002 | 12,269 | 11,011 |
| delta                                                      |     +2.1% | +18.4% | +18.9% |

Canvas ships here as a lazily-imported chunk (5,779 B raw / 1,698 B brotli) that
upstream carried inline. So an HTML-mode consumer downloads **944 bytes more
than upstream** and gets the flip-state-machine fixes, RTL, reduced motion,
typed errors, `strictNullChecks` guards and `pageBackground` validation.
A canvas-mode consumer pays ~+15% raw.

**The §5 "≤ 35 kB minified" target was never achievable and is retired.**
Upstream itself is 44 kB minified; the target asked this fork to be ~20% smaller
than the thing it forks while doing strictly more. It was not a stretch goal, it
was a number with no derivation, and enforcing it produced only churn.

Two claims that circulated and were both false: that upstream is "~26–27 kB"
(it is 44,058 B), and that this engine is "~73% larger" than upstream (it is
+2.1% raw for the common case). Neither was ever measured before being acted on.

### The enforced numbers

The 45 kB raw alarm was reached by ratcheting 35→45→47→48→45 to keep builds
green, and the brotli budget was reverse-engineered from wherever the code
happened to sit. A budget pinned to "current + 0" is not a budget; it turns
every later fix into a negotiation, and it did — four correctness fixes cost 13
bytes and a public helper was deleted to pay for them.

They are now **52 kB raw / 13 kB brotli / 14.5 kB gzip**, roughly 16–18% above
the current artifact. Gzip is gated as well as brotli because not every
consumer's CDN negotiates brotli. All three are hard gates that fail the build;
what makes them workable is headroom, not leniency. `AGENTS.md` §2 carries the
policy: dead code always goes, working code never goes to buy bytes, fixes and
features may spend the headroom and say so, and a breach is a question about
growth rather than a hunt for something to delete.

### What the raw check is not

`scripts/pack-html-engine.mjs` concatenates the shipped chunks into one
envelope. That is a drift signal — it catches an accidental dependency, a broken
tree-shake, a duplicated runtime — but it is **not** what a consumer's bundler
emits for `import { PageFlip }`, and it should not be quoted as a per-consumer
payload figure.

### Peer context

At 12.3 kB gzip the engine sits between Splide (~11 kB, which likewise keeps
accessibility in core) and Swiper (20–47 kB), above headless carousels like
Embla (4–7 kB) and keen-slider (~5.5 kB) that delegate their controls surface to
the consumer. Reasonable for a widget owning page geometry, curl rendering, DOM
ownership, pointer input and responsive layout.

Splitting RTL / reduced motion behind opt-in subpath exports was considered and
rejected: they are not separable modules but small conditionals threaded through
`Flip` / `UI` / `Render` (`reducedMotion.ts` is 681 B of _source_), and they
change input and animation semantics rather than decorating them. The one
genuinely separable unit — the canvas renderer — is already split.

### Still missing

There is no gate on animation frame time, which is what actually determines
perceived quality during a curl. See "Frame-time gate" below.

---

## Frame-time gate (not yet built)

A flipbook's perceived quality is dominated by what happens during the curl, not
at load: the rAF loop, `clip-path` recalculation and shadow gradients, on
mid-range mobile. The repo gates bytes to 0.5% precision and does not measure
this at all, which is backwards.

Proposed: a deterministic Playwright fixture on pinned Chromium — ordinary HTML
pages (no raster images, so the engine is what is being measured), default
shadows, a scripted forward and back flip. Establish a baseline first, then gate:

| Metric                                      | Threshold |
| ------------------------------------------- | --------- |
| p95 rAF interval during a flip              | ≤ 20 ms   |
| p99 rAF interval during a flip              | ≤ 33 ms   |
| Long Animation Frames > 50 ms during a flip | 0         |
| Pointer/key to first visual response        | ≤ 100 ms  |

A 60 Hz frame is ~16.7 ms end to end, of which roughly 10 ms is available to
application work. The [Long Animation Frames API][loaf] captures missed
rendering updates directly and attributes forced style/layout cost.

Do **not** state or imply that this library "passes INP". INP is a field metric
for the host page, where the consumer's own DOM, framework and third-party
scripts dominate. What this repo can honestly claim is a bounded frame profile
in its own fixture; hosts should target p75 INP ≤ 200 ms themselves.

[loaf]: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing
