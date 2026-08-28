- [x] Lifecycle types: nullable private fields + guarded accessors — see Decision below
- [x] `pnpm typecheck` + `pnpm quality:ci` green
- [x] Commit

### Decision (2026-08-28, revised) — **nullable fields, non-null accessors**

An earlier revision of this doc rejected touching the lifecycle fields and kept
`pages!` / `render!` / `ui!`. That was reconsidered, and the objection it raised
was half right.

**What it got right:** do not infect the class. Turning every method into
`requireRender()` noise, or widening every public getter to `| null`, would push
a check into call sites that are always past load and break every consumer for a
state they cannot observe.

**What it got wrong:** `!` is not compile-time structure, it is an assertion
that something is true when it is not. Before load, `getRender()` returned
`undefined` while claiming to return `Render`, so the consumer still crashed —
one frame later, inside the engine, as `cannot read properties of undefined`,
with nothing naming the actual mistake. That is not a safer failure mode than a
throw; it is the same failure with worse diagnostics. And "the engine is always
ready after `attachMode`" is exactly the kind of invariant a type should carry
rather than a comment.

**Shipped:**

- `pages` / `render` / `ui` are `T | null`, which is what they are.
- Public getters keep their non-null signatures and throw
  `PageFlipError('NOT_LOADED')` naming the call to make first. No consumer
  signature changes; the undefined dereference becomes a described error.
- Three private accessors (`pagesOrThrow`, `renderOrThrow`, `uiOrThrow`) are the
  only choke point. Nothing else in the class changes shape.
- `update` / `updateSettings` / `getSettings` / `getState` / `destroy` stay safe
  no-ops before load — the React binding calls them from effects that run before
  `loadFromHTML`, and that contract is now pinned by
  `packages/core/tests/lifecycle.test.ts`.

`UI.distElement` keeps definite assignment: it is assigned in the constructor of
every concrete subclass, so it genuinely cannot be observed unset.

---

## Tracked debt — bundle size

The spec (§5) budgets the core at **≤ 35 KiB minified**. It is **47.3 KiB** raw
(11.1 KiB brotli), and the budget has been raised twice to keep the build green,
which is a ratchet rather than a decision.

Recorded rather than papered over:

- The raw ceiling is 48 KiB and the brotli ceiling 12 KiB — the second is the
  tight one and the number consumers actually pay.
- `terser` with three passes and toplevel mangling saves 41 bytes; the size is
  in the inherited geometry code, not in the build config.
- `target: es2022` is _larger_ than `es2020` (+780 B) — measured, not assumed.
- Real reduction means restructuring `FlipCalculation` / `Render`, which is its
  own phase. Do not raise the ceiling again to make a build pass.

# Quality bar climb

Tracked work to raise TypeScript / ESLint strictness to the Veloir / ai-studio /
any-llm bar. Each phase is one PR-sized unit, green `pnpm quality:ci`, and a
**Codex signoff** before the next phase starts.

Baseline measured on `feat/gullabs-flipbook-3.0` (2026-08-28):

| Gate                               | If enabled today       | Size                                   |
| ---------------------------------- | ---------------------- | -------------------------------------- |
| `no-unsafe-*` → error              | **0 errors**           | Free                                   |
| `no-unnecessary-condition` → error | **12 errors**, 3 files | Small (after NUIA)                     |
| `noUncheckedIndexedAccess` → true  | **~45 `tsc` errors**   | Real work; ~80% in `PageCollection.ts` |

---

## Status legend

| Status         | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `todo`         | Not started                                        |
| `in_progress`  | Active                                             |
| `blocked`      | Waiting on prior phase or external signoff         |
| `codex_review` | Implementation done; awaiting Codex signoff        |
| `done`         | Codex signed off; merged or landed on climb branch |

---

## Phase A — Promote `no-unsafe-*` to error

**Status:** `done`  
**Depends on:** nothing  
**Estimate:** same day

### Why

Measured clean at error level already. Leaving them as `warn` under
`--max-warnings=0` is misleading; promote so `any` cannot re-enter via
assignment / call / member / return / argument.

### Work

- [x] `eslint.config.mjs`: all five `@typescript-eslint/no-unsafe-*` → `'error'`
- [x] Ignore generated `packages/*/size-check/**` in ESLint + `.gitignore`
- [x] `pnpm lint` green
- [x] `pnpm quality:ci` green
- [x] Commit on climb branch (`b7c9749`)
- [x] Codex signoff

### Exit criteria

- ESLint fails the build if any `no-unsafe-*` fires
- No new `eslint-disable` for unsafe rules

### Codex signoff

- Commits: `b7c9749`, `0b52e39` (+ nit follow-up)
- Job / thread: `task-mtcx6ei4-6po5r6` (session `01a04850-528e-7810-a5d6-74bd6a0d7ef4`)
- Verdict: **APPROVE_WITH_NITS** — Phase A signoff: **YES**
- Date: 2026-08-28
- Nits addressed: generic `packages/*/size-check/` gitignore; doc status closed

---

## Phase B — `noUncheckedIndexedAccess` (lifecycle nullability rejected)

**Status:** `codex_review`  
**Depends on:** Phase A signed off  
**Estimate:** one focused sitting

### Why

`no-unnecessary-condition` is off because guards look “impossible” while
indexed access is loose. Fix the type model first, then the ESLint rule.

### Work

- [x] `tsconfig.base.json`: `"noUncheckedIndexedAccess": true`
- [x] Fix ~45 `tsc` errors (majority `PageCollection.ts`)
  - Prefer small helpers (`at(arr, i, label)`) over mass non-null assertions
  - Touch: `PageCollection`, `FlipCalculation`, `Render`, `CanvasUI` as needed
- [x] ~~Lifecycle types (nullable fields)~~ **rejected** — keep definite assignment; see Decision below
- [x] `pnpm typecheck` + `pnpm quality:ci` green
- [ ] Commit
- [ ] Codex signoff

### Decision (2026-08-28) — **no nullable PageFlip lifecycle fields**

Do **not** convert `pages` / `render` / `ui` (or `UI.distElement`) from
definite-assignment (`!`) to `T | null` + `require*()` accessors.

**Why that pattern is risky here:**

1. **Runtime throws replace compile-time structure.** After `attachMode` /
   `loadFromHTML`, the engine is always ready; making every method call
   `requireRender()` turns a construction invariant into a latent
   `NOT_READY` footgun at every call site.
2. **Public API behavior change.** `getRender()` / `getUI()` throwing is a
   new failure mode for consumers (React effects, examples) that previously
   only saw fields after load.
3. **TypeScript cannot prove “post-attach” across methods** without a
   full state-machine / branded type. Nullable fields look safer but do not
   actually encode the phase machine; they only add noise.
4. **Pre-init is a tiny surface.** Only `destroy()` / `update()` /
   `updateSettings()` can run before attach. Those already use optional
   chaining (`this.render?.stop()`). Keep that local; do not infect the
   whole class.
5. **Phase C does not need this.** `no-unnecessary-condition` false
   positives on those few pre-init guards get targeted
   `eslint-disable-next-line` with a one-line reason, or a tiny
   `isAttached` boolean — not field nullability.

**Phase B keeps:**

- `noUncheckedIndexedAccess: true`
- `at()` helper for array/spread access
- Hardening in `PageCollection` / `FlipCalculation` / `Render` / `CanvasUI`
- Definite-assignment `pages!` / `render!` / `ui!` / `distElement!`

### Exit criteria

- `noUncheckedIndexedAccess: true` monorepo-wide
- No `// @ts-expect-error` papering over array access
- Pre-init remains a small optional-chain surface (`destroy` / `updateSettings`); fields stay `!`

### Codex signoff

- Job / thread: _pending_
- Verdict: _pending_
- Date: _pending_

---

## Phase C — `no-unnecessary-condition` → error

**Status:** `todo`  
**Depends on:** Phase B signed off  
**Estimate:** follow-up PR

### Why

Only honest after Phase B. Today: 12 sites in `PageFlip`, `UI`, `flippingPage`.

### Work

- [ ] `eslint.config.mjs`: `no-unnecessary-condition` → `'error'`
- [ ] Delete truly dead `?.` / conditions
- [ ] Keep OOB / lifecycle guards that NUIA now requires
- [ ] No long-term `eslint-disable` for this rule on production paths
- [ ] `pnpm lint` + `pnpm quality:ci` green
- [ ] Commit
- [ ] Codex signoff

### Exit criteria

- Rule is error monorepo-wide (packages + examples typed sources)
- Zero suppressions except documented, time-boxed exceptions (if any)

### Codex signoff

- Job / thread: _pending_
- Verdict: _pending_
- Date: _pending_

---

## Phase D — Optional ratchets (post C)

**Status:** `todo`  
**Depends on:** Phase C signed off  
**Estimate:** separate PRs; do not bundle

| Item                                                    | Notes                                           |
| ------------------------------------------------------- | ----------------------------------------------- |
| D1 `useUnknownInCatchVariables: true`                   | Currently `false` in `tsconfig.base.json`       |
| D2 `verbatimModuleSyntax: true`                         | Already lean on `import type`                   |
| D3 `strict-boolean-expressions`                         | ai-studio path: relaxed → error; own PR         |
| D4 Coverage floors 40/35 → 60/50 → 80/70                | Ratchet only when suite grows; no fake excludes |
| D5 Package `typecheck` includes tests (`typecheck:all`) | Veloir pattern                                  |

Each D-item gets its own commit + Codex signoff when picked up.

### Codex signoff

- Per sub-item when executed

---

## Anti-patterns (do not)

- Enable `no-unnecessary-condition` before `noUncheckedIndexedAccess`
- Mass `!` on array access to silence NUIA
- Bundle `strict-boolean-expressions` with NUIA
- Fake coverage with broad `coverage.exclude`
- Ship without Codex signoff on a phase that changes the gate

---

## Climb log

| Date       | Phase | Event                                                  |
| ---------- | ----- | ------------------------------------------------------ |
| 2026-08-28 | —     | TODO written; baseline measured                        |
| 2026-08-28 | A     | Started                                                |
| 2026-08-28 | B     | Landed; lifecycle decision revised, size debt recorded |

---

## Commands

```bash
pnpm quality:ci          # full gate
pnpm lint
pnpm typecheck
pnpm test:coverage
```
