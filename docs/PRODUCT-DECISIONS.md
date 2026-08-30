# What the design sprint removes — for the owner to decide

The design tranche renamed a lot and removed a little. This separates the two
honestly, because they are not the same risk, and puts the genuine capability
losses in front of the person who should decide them.

**The standing correction to my own reasoning:** several decisions in the design
audit were justified by "there are no consumers yet". That is a reason a change
is CHEAP, not a reason it is RIGHT. This is a public library; the day after
launch there are consumers, and a capability deleted now is one they never get
to ask for. Cheapness belongs in the sequencing argument, never in the
should-we-do-it argument. Everything below is re-argued on the merits.

---

## A. Renames — nothing lost

Twelve settings and several events were renamed because the old name stated
something the code contradicted. Every capability survives; only the spelling
changed. These need a migration entry, not a decision.

`showCover`→`hardCovers`, `size:'stretch'`→`sizing:'responsive'`,
`disableFlipByClick`→`flipOnClick`, `showPageCorners`→`foldCornerOnHover`,
`clickEventForward`→`respectInteractiveContent`,
`mobileScrollSupport`→`allowTouchScroll`, `direction`→`readingDirection`,
`startPage`→`initialPage`, `useMouseEvents`→`pointerInput`,
`Settings.getSettings`→`Settings.resolve`.

## B. Capability GAINS

Worth stating, because the sprint is not only subtraction.

| Gained                                                                  | Was                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `flipOnClick: 'never'` — drag/swipe only                                | unreachable; `disableFlipByClick: true` still flipped on corners        |
| `pointerInput: ['touch']` — per-device policy                           | one boolean that silently killed touch and pen together                 |
| `ready` vs `loaded` — distinguish first load from reload                | one `init` that fired on both, indistinguishably                        |
| `pageCount` and `orientation` on every event payload                    | `init` carried neither, so "page 1 of N" was impossible                 |
| `turnRejected.direction` / `.targetPage`                                | `reason: 'boundary'` alone — could not tell you which button to disable |
| `error.kind` (`usage`/`lifecycle`/`internal`) + `error.setting`         | a flat union with no way to write "report this" once                    |
| Real previous/next **buttons**                                          | a browse-mode screen-reader user could not turn a page **at all**       |
| Controlled `page` that animates and re-asserts                          | silent, instant, and not actually controlled                            |
| `usePageFlip` exposing `orientation`, `canGoNext/Prev`, `lastRejection` | none of these were obtainable without hand-binding events               |

---

## C. Genuine capability losses — YOUR CALL

Five. Each is stated as what a real consumer could do before and cannot now.

### C1. `maxHeight` — deleted

**Was:** a documented setting, validated and returned by `getSettings()`.
**Truth:** never read by any code. A responsive book could not be height-capped.
**So:** nothing that WORKED was removed — but an advertised feature was.

**The real decision is not "delete or keep the dead key". It is "should a
responsive book be height-capped?"** If yes, this should be _implemented_, not
deleted. `maxWidth` is implemented and read; the asymmetry is the suspicious
part, and a book in a short viewport is a real layout.

**My recommendation: implement it.** It is a small change in
`Render.computeBounds` beside the existing `maxWidth` clamp, and the fact that
someone declared the setting suggests the need was real.

### C2. `renderOnlyPageLengthChange` — deleted

**Was:** skip the React reconciliation when the page count is unchanged.
**Truth:** it short-circuited before `setPages`, so changing a page's CONTENT
without changing the count showed stale content forever, with no signal. It had
already needed one carve-out to stop it breaking lazy mounting.
**Cost it avoided:** one React reconciliation. The expensive part — rebuilding
the engine's `PageCollection` — is already avoided by the `sameNodes`
reference check, which is unconditional.

**Decision:** is there a performance escape hatch you want here? If a consumer
has 500 pages and re-renders often, they may want one — but it should be a
correct one, e.g. `React.memo` on the page components, which costs us nothing
and cannot go stale.
**My recommendation: stay deleted.** It traded correctness for a cost that is
already paid elsewhere.

### C3. `onNavigationError` — folded into `onTurnRejected`

**Lost:** the `actual` field — where the book actually landed after clamping.
`turnRejected` reports `targetPage` (what you asked for) but not the resolution.
**Kept and improved:** the real error `code`, which `onNavigationError`
discarded by hardcoding `INVALID_PAGE` — throwing away the
`PAGE_NOT_IN_SPREAD` distinction the core paid for.

**Decision:** add `landedOn: number | null` to `turnRejected`?
**My recommendation: yes, add it.** It is one field, it is genuinely useful for
"we clamped you to page 40 of 40", and losing it is the one place this
consolidation actually subtracted.

### C4. `usePageFlip`'s `setPage` and `setPageCount` — deleted

**`setPageCount`: delete, no question.** It wrote to state DERIVED from the
engine; the next event overwrote it. It could only ever produce a lie.
**`setPage`: a real loss.** A consumer could seed or force the hook's page.

**Decision:** the hook no longer feeds a controlled `page` by default, so
`setPage` has no coherent meaning — setting it moved nothing. But someone
restoring a saved reading position wants exactly that.
**My recommendation: re-add as `goToPage(n)`** — an action that actually turns
the book, rather than a setter that desynced state from it.

### C5. `onFlip`, `onInit`, `onUpdate`, `onCollectionRebuild` — removed

`onFlip` was a duplicate of `onPageChange` — pure subtraction of a synonym.
`onInit` → `onReady` + `onLoaded` is strictly more.
`onUpdate` + `onCollectionRebuild` → `onPagesChanged`: these ALWAYS fired
together, atomically, with the same page — verified in the old code.
**No capability lost.** Migration cost only.

---

## D. NOT YET DONE, and I am holding it for you

These are the ones that genuinely worried me once you raised the question, and I
have **stopped** rather than proceed.

### D1. Pruning the public barrel

The plan removes `Render`, `HTMLRender`, `PageCollection`,
`HTMLPageCollection`, `Page`, `HTMLPage` and the geometry helpers from the
public API. Codex's design signoff flagged that these are currently _emitted
API_, which is exactly why removing them is a product decision and not a
cleanup.

**Who this affects:** anyone subclassing to build a custom renderer or page
type. That is a real extension story for a rendering library.
**Against keeping:** `docs/WEBGL_RENDERER.md` concluded `Render` is the WRONG
seam for a second renderer, so publishing it advertises an extension point that
does not actually work.

**This needs your decision.** Options: (a) prune fully and document "no
subclassing"; (b) keep the classes exported as TYPES only, so consumers can
annotate but not extend; (c) keep as-is and design a real plug-in seam later.
**My recommendation: (b).** It keeps every legitimate typing use working, kills
the false extension promise, and does not foreclose a real seam.

### D2. Collapsing the abstract base classes (D24)

Same surface, same decision. Blocked on D1.

---

## E. My process failure, stated plainly

Codex's audit of the tranche found three features I had NAMED in the API and not
built: `pointerInput` did not filter by device, `flipOnClick: 'never'` still
flipped, and every content refresh jumped to `initialPage`. All three are fixed.

That is the opposite failure from the one you were worried about — not deleting
working features, but shipping non-working new ones — and it is the stronger
argument for the review loop, not against it. It also means the removals above
deserve the same scepticism as the additions: **assume nothing on this page is
right until you have decided it.**
