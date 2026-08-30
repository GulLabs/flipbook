# Round: code complete

**Started 2026-08-30 at `3565533`.** Owner's instruction: implement all product
code in one go, fix every known issue, **no test work this round**. Experts and
Codex audit the **product code only** and ignore the test code. Tests are the
next round.

## Standing facts for this round

- **The test suite will go red, and that is expected.** Renames and removals
  land without their test updates. Every break is recorded in "Broken tests" so
  the next round has a work-list rather than a discovery problem.
- **The gate is reduced to `typecheck` + `lint` + `build` + `size`.** Those must
  stay green at every commit. `pnpm quality:ci` will not pass until round 2.
- **Size ceilings were raised by the OWNER**, not ratcheted by an agent:
  57→62 kB raw, 14→16 kB brotli, 16→18 kB gzip. AGENTS.md §2 forbids an agent
  doing this on its own; this is an explicit owner decision, recorded here and
  in `CHANGELOG.md`. The design work removes bytes on net (D22, D23, D24), so
  the expectation is to give some back before publish.

## Commit ledger

| #   | SHA       | What                                              |
| --- | --------- | ------------------------------------------------- |
| 0   | `3565533` | round start — 793 tests green, brotli 14000/14000 |

## Broken tests

Recorded as they break, with the reason, so round 2 is mechanical.

| Test file | Why it broke | Fix in round 2 |
| --------- | ------------ | -------------- |

## Decisions taken without asking

Per the owner's instruction to decide rather than ask.

| Decision                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Render` seams: close `setDirection` and the four page setters; leave `setShadowData` / `clearShadow` / `setPageRect` / `releasePages` | The first five make `getRender()` describe a fold that does not exist — condition (2) of the stopping rule in `src/internal.ts`. The rest are destructive but honest: every getter still reports the truth. Resolves the disagreement between the engine expert (leave all) and Codex (close all). |
| `usePageFlip`: complete, not delete                                                                                                    | Codex design signoff; `orientation` alone justifies it, since a consumer cannot render correct controls without knowing whether one leaf or two are showing.                                                                                                                                       |
| C7 folds into D17 rather than getting its own API                                                                                      | Bolting on "open at page N without announcing" would be a fourth navigation mechanism in a library the audit already faults for having three too many.                                                                                                                                             |
| `flippingTime` default stays 1000                                                                                                      | Retired by the Codex design signoff: it is a scaled maximum, and an ordinary ~400-point move already runs ~400 ms.                                                                                                                                                                                 |
