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

**Status:** `codex_review`  
**Depends on:** nothing  
**Estimate:** same day

### Why

Measured clean at error level already. Leaving them as `warn` under
`--max-warnings=0` is misleading; promote so `any` cannot re-enter via
assignment / call / member / return / argument.

### Work

- [x] `eslint.config.mjs`: all five `@typescript-eslint/no-unsafe-*` → `'error'`
- [x] Ignore generated `packages/**/size-check/**` in ESLint (+ gitignore)
- [x] `pnpm lint` green
- [x] `pnpm quality:ci` green
- [x] Commit on climb branch (`b7c9749`)
- [ ] Codex signoff

### Exit criteria

- ESLint fails the build if any `no-unsafe-*` fires
- No new `eslint-disable` for unsafe rules

### Codex signoff

- Commit: `b7c9749` (and follow-up doc/status if any)
- Job / thread: _pending launch_
- Verdict: _pending_
- Date: _pending_

---

## Phase B — `noUncheckedIndexedAccess` + lifecycle types

**Status:** `todo`  
**Depends on:** Phase A signed off  
**Estimate:** one focused sitting

### Why

`no-unnecessary-condition` is off because guards look “impossible” while
indexed access is loose. Fix the type model first, then the ESLint rule.

### Work

- [ ] `tsconfig.base.json`: `"noUncheckedIndexedAccess": true`
- [ ] Fix ~45 `tsc` errors (majority `PageCollection.ts`)
  - Prefer small helpers (`at(arr, i, label)`) over mass non-null assertions
  - Touch: `PageCollection`, `FlipCalculation`, `Render`, `CanvasUI` as needed
- [ ] Lifecycle types (stop definite-assignment `!` for pre-init):
  - [ ] `PageFlip`: `render` / `ui` as `T | null` until `create()`
  - [ ] `UI`: `distElement` as `HTMLElement | null` until load
- [ ] `pnpm typecheck` + `pnpm quality:ci` green
- [ ] Commit
- [ ] Codex signoff

### Exit criteria

- `noUncheckedIndexedAccess: true` monorepo-wide
- No `// @ts-expect-error` papering over array access
- Pre-init guards type-check as necessary (not dead)

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

| Date       | Phase | Event                           |
| ---------- | ----- | ------------------------------- |
| 2026-08-28 | —     | TODO written; baseline measured |
| 2026-08-28 | A     | Started                         |

---

## Commands

```bash
pnpm quality:ci          # full gate
pnpm lint
pnpm typecheck
pnpm test:coverage
```
