# Triage — three review sources, one set of principles

Sources: `docs/reviews/consumer-expert-round1.md` (consumer advocate, four
personas, built against the published `.d.ts`), `docs/reviews/test-writing-product-bugs-2026-08-30.md`
(P0–P6, found while writing tests), `.local/example-authoring-findings.md`
(B1–B8, H1–H9, found while authoring examples).

## The principles these are judged against

1. **"No consumers yet" is a statement about cost, never about correctness.**
2. **"Not tested" is not an argument about design.** Untested code gets tested;
   a wrong abstraction stays wrong.
3. **Testability never justifies a public export.** The runner already aliases
   the package name to `src`; tests deep-import.
4. **Judge by what the abstraction should be**, not by what exists or who uses
   it today.
5. **A silent wrong answer outranks a loud failure.** The failure mode that
   costs a consumer most is the one they cannot see.

## Three findings that converged from all three sources independently

When a consumer advocate, a test author and an example author each arrive at the
same thing by different routes, that is the signal to act on first.

| Finding                                         | Consumer           | Tests | Examples |
| ----------------------------------------------- | ------------------ | ----- | -------- |
| "Which leaves are on screen?" is not answerable | B/H8               | —     | H8/B7    |
| A component page child fails confusingly        | `getPage` critique | P2    | B3       |
| Page-root styles are wiped                      | —                  | —     | B2       |

---

## FIXED IN THIS PASS

### B1 — `sizing` was a dead prop. **My regression.**

Last round I removed `sizing` from `remountKeyOf` (correctly — it is live and
`updateSettings` handles it) and never added it to the settings effect. So it
did nothing at all, which is worse than the remount it replaced, and silent.

A consumer toggling `fixed` ↔ `responsive` at a breakpoint sees `width` and
`height` update — those _are_ in the dependency list — while the mode does not.
The book gets a new pixel size in the wrong mode, and it reads as a bug in their
own CSS. Principle 5, and it is the flagship phone-vs-desk story.

### P1 — `GeometryAbort` was dead code. **My incomplete fix.**

D20 said: convert the bare `Error` throws, narrow the broad `catch` on the
pointer hot path to an identity-compared sentinel. I shipped the sentinel and
not the fix — `rg GeometryAbort packages/core/src` found only the definition.

`FlipCalculation.calc` still had a bare `catch {}`, so a genuine `TypeError` in
the fold maths was swallowed on **every frame of every drag**. The old comment
defended that breadth on bundle size, which is both the wrong trade and the
wrong reason: a defect the engine cannot see is not cheaper than a few bytes.
Now wired, with the two geometry guards throwing `GeometryAbort` and
`HTMLUI`'s bare `Error` typed as `RENDER_SETUP`.

---

## FIX NEXT — ordered by what a consumer loses

### 1. `getVisiblePages()` and the façade methods (consumer B, H8/B7)

**Three sources, one finding.** `page` is the spread _head_, so in landscape a
12-page book sits on head 4 while leaves 4 **and 5** are showing. Every
consumer drawing chrome — a page counter, a scrubber, a table of contents, an
analytics call — reimplements spread pairing and gets the cover and odd-leaf
cases wrong.

It is not hypothetical: **this repo has got it wrong twice**, most recently
MIN-A this session, where `usePageFlip.canGoNext` mishandled `hardCovers`
because it owned a copy of a rule the engine owns. Our own binding maintains a
third copy in `spreadPages()` because `PageCollection.getSpread()` is
`protected`.

This is the abstraction fix, not a convenience: the façade currently hands out
_collaborators_ and consumers reach through them for answers it should give
directly. See `docs/ABSTRACTION-BOUNDARY.md`.

### 2. "Page 1 of 0" (consumer, persona 1)

The obvious counter — `onPageChange` → `setPageCount` — reads zero until the
reader turns a page, because opening deliberately does not emit `flip` (ADR
0003, working as designed). The count arrives on `onLoaded`, which the README
never mentions. Both shipped examples only work because `usePageFlip` binds it
internally.

Worst possible first impression, and the fix is one README line plus a counter
in the snippet. Principle 5.

### 3. The React package re-exports almost nothing (consumer)

13 confirmed `TS2614`/`TS2724` errors, including **`FlipbookState` — the return
type of our own hook**. To pass a `corner` to `flipNext`, a React consumer must
add `@gullabs/flipbook-core` to their `package.json`. Mechanical to fix; a
plain defect in the package boundary.

### 4. B2 — page-root styles are wiped

Half-fixed: NF4 stopped the engine destroying _unrelated_ inline properties.
But the engine legitimately owns `position` / `left` / `top` / `width` /
`height` / `clip-path` on the leaf root, so a consumer styling the root the
obvious way still loses those.

The engine owning layout is **correct and must not change**. What is missing is
that this is a _contract_ nobody states: the README should say "style an inner
wrapper, not the leaf root", and a `<FlipPage>` component would make it
unnecessary to know. Documentation plus an optional component, not an engine
change.

### 5. P2 / B3 — the component-child warning is a false positive

My mount warning fires for `forwardRef` children that correctly forward to a
host node — the very pattern the docs recommend. Warn only when the slot is
still null after commit, at which point `DETACHED_PAGE` already throws.

### 6. H2 — no deep-link recipe

`usePageFlip` + a URL-controlled `page` fight each other: the hook has no
`page` in `bookProps`, and passing one without a matching `onPageChange` gives
a deliberately locked book. "Current page in the query string" is the first
thing a reader app does. Ten lines of README, or a controlled mode on the hook.

### 7. P3 — out-of-band `destroy()` refuses silently

If a consumer calls `pageFlip()!.destroy()` without unmounting, `flipNext`
returns `false` with no `onTurnRejected` — the engine's listeners were cleared
by `destroy()` and the binding's own guard only covers a null ref. Check
`isDestroyed()` in `runRelative`/`runHandle`.

### 8. Consumer's remaining gaps

No CSP escape for `ensureFlipbookStyles`; no documented class/data-attribute
styling contract; no `pageLabel` API (the live region says `index + 1`, wrong
for any book with front matter — the source already flags this seam);
`usePageFlip`'s `bookProps` silently swallows a consumer's `onPageChange` if
spread first.

---

## REJECTED, with reasons

| Item                                               | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 — `pageBackground` accepts unknown syntax**   | _Partly accepted, partly rejected._ The **rejection** is of the framing: `oklch()` and `color-mix()` are not junk, they are ordinary 2026 colours, and throwing on them makes the library the thing that is out of date. The **real** bug is `red;position:fixed` — a CSS-injection vector — which must be rejected regardless of the opacity question. Fix: reject on syntax (declaration breakers), accept modern colour functions, keep the draw-time opaque fallback for anything whose alpha we cannot statically prove. |
| Restore `loadFromImages` / an images API           | That is canvas, removed on purpose (ADR 0002). Pictures are `<img>` inside `loadFromHTML`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Deprecated aliases for the renamed settings        | 3.0 is a major. Aliases freeze the lies into the `.d.ts` permanently; `MIGRATION.md` is the migrator's tool.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Unify core throws with React booleans              | Two audiences, deliberately. The engine throws where a caller can catch; the binding reports. Document the seam, do not merge it.                                                                                                                                                                                                                                                                                                                                                                                             |
| Unify `WidgetEvent` with the unwrapped React props | Same reason. The engine's `on()` keeps its wrapper; the binding unwraps uniformly.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Loosen `INVALID_BOOLEAN` / strict settings         | That throw exists because `'false'` is a truthy string, and every ordinary config source hands over strings. Undoing it re-ships the bug.                                                                                                                                                                                                                                                                                                                                                                                     |
| P4, P5, P6                                         | Test debt and expected breaking changes, correctly filed as not-product-bugs by their own author.                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## The pattern worth naming

Of the two most severe items here, **both are mine, and both are the same
mistake**: I shipped the _visible half_ of a fix and not the half that does the
work. `GeometryAbort` was exported and never thrown. `sizing` was removed from
the remount key and never added to the effect.

Both compiled. Both looked done in a diff. Neither was reachable by any test,
because the tests are the next round. That is the argument for keeping the
review loop that has been finding them — three independent sources, none of
which could see the others' findings.
