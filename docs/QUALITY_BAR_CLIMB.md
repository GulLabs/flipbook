# Quality bar climb

Tracked work to raise TypeScript / ESLint strictness to the Veloir / ai-studio /
any-llm bar. Each phase is one PR-sized unit, green `pnpm quality:ci`, and a
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
- [ ] Codex signoff (this turn)

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
- [ ] Commit
- [ ] Codex signoff

### Exit criteria

- Rule is error on typed package + example sources
- Zero suppressions except documented exceptions (none expected)

### Codex signoff

- Job: `task-mtd1t60z-35bpcf` (session `01a048c7-0cee-7bb0-82ae-54a70666605f`)
- Verdict: **APPROVE** — Phase C signoff: **YES**
- Date: 2026-08-28

---

## Phase D — Optional ratchets (post C)

**Status:** `todo`  
**Depends on:** Phase C signed off  
**Estimate:** separate PRs; do not bundle

| Item                                  | Notes                                     |
| ------------------------------------- | ----------------------------------------- |
| D1 `useUnknownInCatchVariables: true` | Currently `false` in `tsconfig.base.json` |
| D2 `verbatimModuleSyntax: true`       | Already lean on `import type`             |
| D3 `strict-boolean-expressions`       | Own PR                                    |
| D4 Coverage floors ratchet            | Only when suite grows; no fake excludes   |
| D5 Package `typecheck` includes tests | Veloir pattern                            |

---

## Tracked debt — bundle size

Spec budgets core at **≤ 35 KiB minified**. Current raw ~**47.3 KiB** (brotli
~11.1 KiB). Ceiling has been raised to keep builds green — that is a ratchet,
not a product decision (AGENTS.md §2: **do not raise again**).

- Raw ceiling 48 KiB / brotli 12 KiB (tight one is brotli).
- Real reduction means restructuring `FlipCalculation` / `Render` — own phase.

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

| Date       | Phase | Event                                            |
| ---------- | ----- | ------------------------------------------------ |
| 2026-08-28 | —     | TODO written; baseline measured                  |
| 2026-08-28 | A     | Done — Codex APPROVE_WITH_NITS                   |
| 2026-08-28 | B     | Landed (NUIA + AGENTS lifecycle); awaiting Codex |
| 2026-08-28 | C     | Rule on (0 debt); awaiting Codex                 |

---

## Commands

```bash
pnpm quality:ci
pnpm lint
pnpm typecheck
pnpm test:coverage
```
