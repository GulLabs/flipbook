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

| #   | SHA       | What                                                                                            |
| --- | --------- | ----------------------------------------------------------------------------------------------- |
| 0   | `3565533` | round start — 793 tests green, brotli 14000/14000                                               |
| 1   | `0ffec68` | owner raises the size ceilings: 57→62 raw, 14→16 brotli, 16→18 gzip                             |
| 2   | `7500ffe` | **the design tranche** — D1–D21, H4, C7. Settings model, error model, event map, React binding. |
| 3   | `c4ecdb1` | three advertised capabilities that were not implemented (Codex)                                 |
| 4   | `90aa7a9` | the review round — R-1b, D4, five majors                                                        |
| 5   | `3014f00` | R-6 + all minors; re-added maxHeight, landedOn, goToPage                                        |
| 6   | `d6e92a0` | NF4 — stop destroying consumer inline styles                                                    |
| 7   | `3aa645a` | signoff round — generation stamps, the D4 rule                                                  |
| 8   | `8867106` | GeometryAbort wired; sizing revived; triage of three sources                                    |
| 9   | `1def931` | pageBackground silently whited out modern colours; engine stops owning display                  |
| 10  | `536888e` | **the façade methods** — getVisiblePages/canTurn/getBlockElement/getPageElement/isReady         |
| 11  | `3a51417` | **the barrel prune** — 21 exported names to 12                                                  |
| 12  | `425bab8` | collapse PageCollection/HTMLPageCollection                                                      |

## Still open at the end of this round

- **Three of the four class collapses.** `PageCollection`/`HTMLPageCollection`
  is done. `Page`/`HTMLPage`, `UI`/`HTMLUI` and `Render`/`HTMLRender` are
  decided (`docs/ABSTRACTION-BOUNDARY.md`, and Codex's
  `codex-abstraction-boundary.md`) and NOT built. An attempt at the `Page` pair
  was REVERTED rather than committed half-merged — the mechanical slice dropped
  an interface and left abstract declarations behind, and a partially collapsed
  class is worse than either state.

  These are now INTERNAL-only: `index.ts` exports none of them, so the
  consumer-visible half of the abstraction work is complete. What remains is
  hygiene and byte recovery, not API.

- **From the triage, not yet built:** the "Page 1 of 0" README fix, a
  `pageLabel` API, the engine's ownership of `background-color`, the SSR
  no-page-content documentation, the deep-link recipe, the styling contract.

## Broken tests

Recorded as they break, with the reason, so round 2 is mechanical.

| Test file                | Why it broke                                                                                                                                                   | Fix in round 2                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ~all core + react suites | 12 settings renamed; event map reshaped (`init`→`ready`/`loaded`, `update`+`collectionRebuild`→`pagesChanged`, every payload an object); error codes collapsed | Mechanical: rename keys, unwrap payloads, update code assertions |
| `errors-shape.test.ts`   | 8 `INVALID_*` codes removed                                                                                                                                    | Assert `INVALID_SETTING` + `setting` key + the new `kind` axis   |
| `HTMLFlipBook.test.tsx`  | `onFlip`/`onInit`/`onUpdate`/`onCollectionRebuild`/`onNavigationError` removed; handlers take payloads, not `WidgetEvent`                                      | Rename handlers, drop `.data`                                    |
| `settings*.test.ts`      | `Settings.getSettings` → `Settings.resolve`; `maxHeight` gone                                                                                                  | Rename; delete `maxHeight` cases; add `setting` assertions       |

**Two round-scoped tsconfigs exist for this:** `packages/core/tsconfig.src.json`
and `packages/react/tsconfig.src.json` type-check `src` only, because the
repo-wide `tsconfig.json` includes `tests`. Delete both once `tests` is green.

## Decisions taken without asking

Per the owner's instruction to decide rather than ask.

| Decision                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Render` seams: close `setDirection` and the four page setters; leave `setShadowData` / `clearShadow` / `setPageRect` / `releasePages` | The first five make `getRender()` describe a fold that does not exist — condition (2) of the stopping rule in `src/internal.ts`. The rest are destructive but honest: every getter still reports the truth. Resolves the disagreement between the engine expert (leave all) and Codex (close all). |
| `usePageFlip`: complete, not delete                                                                                                    | Codex design signoff; `orientation` alone justifies it, since a consumer cannot render correct controls without knowing whether one leaf or two are showing.                                                                                                                                       |
| C7 folds into D17 rather than getting its own API                                                                                      | Bolting on "open at page N without announcing" would be a fourth navigation mechanism in a library the audit already faults for having three too many.                                                                                                                                             |
| `flippingTime` default stays 1000                                                                                                      | Retired by the Codex design signoff: it is a scaled maximum, and an ordinary ~400-point move already runs ~400 ms.                                                                                                                                                                                 |
