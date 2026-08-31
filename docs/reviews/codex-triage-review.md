VERDICT: BLOCK

# Codex triage review

Reviewed commit `886710691922e49dc451482c415925bc765d40a6`, restricted to
`packages/*/src`. I re-read the current abstraction-boundary decision and the
two earlier Codex reviews, then the three inputs named by `docs/TRIAGE.md`.
No test source or test result informed this review. The concurrent canvas-mode
removal work is outside scope and is not a finding.

The exact requested compilation check passed:

```text
pnpm build &&
pnpm exec tsc --noEmit -p packages/core/tsconfig.src.json &&
pnpm exec tsc --noEmit -p packages/react/tsconfig.src.json
```

## Findings

### MAJOR — P0 remains a real public-boundary defect; the rejection needs a narrower, enforceable rule

The triage is right to reject the old _"unknown syntax is not opaque"_ framing.
`oklch()` and `color-mix()` are CSS colours, not bad input. It is also right
that opacity and declaration safety are separate questions.

But the proposed conclusion is not yet implemented. `Settings.resolve` accepts
every non-empty string for which the small alpha recogniser finds no transparent
alpha (`packages/core/src/Settings.ts:421-432`; `packages/core/src/Render/pageBackground.ts:57-66`). The existing native parser check,
`safePageBackground`, is unused (`packages/core/src/Render/pageBackground.ts:104-114`). Consequently both a modern colour and
`red;position:fixed` are accepted by the public constructor and then quietly
become white through `foldFill` (`packages/core/src/Render/pageBackground.ts:74-92`; `packages/core/src/Page/HTMLPage.ts:241,365`). That is exactly the silent wrong answer the stated principle prohibits.

One correction to the triage's security wording matters: at this commit
`red;position:fixed` is **not injected at runtime**. `foldFill` rejects it
before `HTMLPage` constructs the declaration string. It would become an
injection route if modern-colour support merely broadened that regex, because
`applyEngineStyle` splits the resulting string on semicolons and applies every
piece (`packages/core/src/Page/HTMLPage.ts:54-70`). The value must nevertheless
be rejected loudly at the public boundary; accepting and silently replacing it
is an API failure, and the current string parser is too dangerous a foundation
to extend.

The rule should be: accept one syntactically valid CSS `<color>` (using the
platform colour parser where it is available), reject declaration breakers and
any invalid grammar regardless of alpha, then accept only a value whose alpha
can be shown to be 1. Modern literal colour functions must therefore work.
Dynamic/unprovable values, notably a `var()` whose eventual alpha is unknown,
cannot promise the opaque-fold invariant: reject them at the settings boundary
or explicitly offer a separately named best-effort fallback policy. Keep the
per-draw fallback for mutation through the live settings object, but never make
it the normal validation result. Finally, write the colour through the CSSOM as
one `background-color` property rather than parsing a concatenated declaration
string.

### MAJOR — the collaborator escape hatch can corrupt the engine model; none of the three sources names it

`PageFlip.getPageCollection()` hands consumers the concrete collection
(`packages/core/src/PageFlip.ts:1372-1380`), and `PageCollection.getPages()`
returns the collection's actual mutable `Page[]`, rather than a copy or readonly
view (`packages/core/src/Collection/PageCollection.ts:247-252`). A consumer can
therefore `splice`, reorder, or replace leaves while the spread table, current
indices, renderer slots, and flip controller still describe the old model. The
result is wrong visible leaves or a later internal failure, rather than a
supported operation or a loud refusal.

This is stronger than an API tidiness concern. It is a mutable alias across the
facade boundary. It confirms the abstraction-boundary conclusion: define the
small query façade (`getVisiblePages`, `isPageVisible`, spread count,
`canTurn`, bounds/readiness as appropriate) and remove the collaborator getters
before publication; do not repair their return types by exporting more
implementation classes.

### MAJOR — a normally controlled book makes its first subsequent declarative turn instant

The controlled-page effect returns when its initial target is already visible
(`packages/react/src/HTMLFlipBook.tsx:947-949`) without clearing
`firstControlledApply`. In the ordinary `page={0}` case, the first later change
therefore still reads as initial and uses `turnToPage` instead of the default
animated `flip` (`packages/react/src/HTMLFlipBook.tsx:960-978`). The user gets a
silent page swap despite `pageTransition` defaulting to `'animate'`. This is
not in any of the three review inputs and should be fixed before documenting a
controlled/deep-link path.

## Answers to the requested checks

### 1. The two “FIXED IN THIS PASS” entries

**GeometryAbort: fixed.** `calc()` returns `false` only for the branded
`GeometryAbort`; it rethrows every other exception
(`packages/core/src/Flip/FlipCalculation.ts:92-121`). The only two intended
no-fold exits now throw that sentinel (`packages/core/src/Flip/FlipCalculation.ts:296-299,308-322`). Thus a genuine `TypeError` takes the non-sentinel path
and propagates. The remaining geometry helper errors are typed invariant
failures for a degenerate or collinear segment, not normal “no fold here” flow
(`packages/core/src/Helper.ts:122-151`), so they should propagate too. I found
no legitimate `calc()` control-flow exit that now escapes as an exception.

**React sizing: fixed.** `props.sizing` is now a dependency of the settings
effect, which calls `updateSettings` (`packages/react/src/HTMLFlipBook.tsx:742-790`). `sizing` is live and fold-invalidating in core
(`packages/core/src/PageFlip.ts:68-78`); after safely abandoning an incompatible
in-flight fold, core reapplies host sizing and re-renders
(`packages/core/src/PageFlip.ts:904-968`). `Render.computeBounds` reads the
mutated live setting (`packages/core/src/Render/Render.ts:766-802`). It cannot
create an effect loop: the dependency is the incoming primitive prop, the
effect does not update that prop or `pages`, and a render caused by engine events
does not change its dependency values. A real sizing change produces one core
settings update and reflow, not a remount or settings thrash.

### 2. Prioritisation

The proposed order correctly puts a silent visual/state answer ahead of a loud
TypeScript import failure, but it is not defensible as written because it omits
the still-open P0 and the controlled-transition failure above.

Recommended pre-publication order:

1. P0 boundary validation and CSSOM write path.
2. Define the façade and remove mutable collaborator access; include
   `getVisiblePages()` and the query methods in the same contract decision.
3. Repair controlled `page` transition state.
4. Document/repair the “Page 1 of 0” first-run path.
5. Close the React re-export gap, but re-export only the contracts exposed by
   React's own public API (not core collaborators).
6. State the page-root/inner-wrapper style contract.
7. Make both React imperative paths report a destroyed engine consistently.
   `runRelative` currently returns its dead engine's `false`, while `runHandle`
   reads it before its `try` and can throw `DESTROYED`
   (`packages/react/src/HTMLFlipBook.tsx:493-544`).
8. Add the deep-link recipe.
9. Remove the false-positive component warning. It is noisy, not a failed
   `forwardRef` book: the warning marks every non-host element suspect before
   observing whether its slot did receive a host ref
   (`packages/react/src/HTMLFlipBook.tsx:597-620`).

### 3. Rejections

Keep the rejections of `loadFromImages`, deprecated aliases, core-throw versus
React-boolean semantics, `WidgetEvent` versus unwrapped React props, and any
loosening of `INVALID_BOOLEAN`. Each preserves an honest boundary: canvas is
removed; aliases permanently preserve lies; the engine and binding serve
different calling/error models; React should unwrap its event adapter; and a
truthy string is not a boolean.

The P0 framing is **partly correct**: do not reject modern CSS colours merely
because the library's legacy regex cannot parse them, do reject declaration
breakers independently of alpha, and retain draw-time defence. The correction
is above: neither a safe fallback nor a regex is an adequate public validation
rule, and `red;position:fixed` is currently a rejected rendering input rather
than an executed injection.

### 4. What the three sources missed

The mutable collection escape hatch and the controlled-transition failure are
both material omissions. The first can corrupt core's model through public API;
the second makes the advertised default controlled transition silently wrong.
They should be added to the triage list at **MAJOR** severity.

## Verification limits

The build and both requested source TypeScript compilations passed. I did not
run, read, or rely on test code. A direct runtime monkey-patch probe of the
private geometry helper was unavailable because this checkout has no `tsx`
runner; the exception-path conclusion above is from the commit-pinned product
call graph.
