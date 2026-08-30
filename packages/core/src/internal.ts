/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Capability keys for seams that exist between engine objects and nowhere else.
 *
 * `PageFlip`, `Render`, `UI` and `PageCollection` have to call into one
 * another, and TypeScript has no way to say "public to my siblings, closed to
 * the outside". `public` with an `@internal` tag is documentation, not a fence:
 * it survives into the emitted `.d.ts`, and a consumer reaching the object
 * through `getUI()` / `getRender()` / `getPageCollection()` can call it.
 *
 * THE STOPPING RULE. This module grew twice by finding "one more" seam of the
 * same shape, because nothing said where it ends. A member is symbol-keyed when
 * BOTH hold:
 *
 *   1. every caller is a sibling engine object — no consumer has a legitimate
 *      reason to call it; and
 *   2. an outside call can make a public getter LIE, or fabricate or suppress
 *      an event.
 *
 * Condition 2 is what distinguishes these from ordinary internals. `Render` has
 * thirteen untagged public mutators; calling `releasePages()` from outside
 * blanks the book, which is destructive but HONEST — every getter still reports
 * the truth, and no event is invented. Those stay public. The eight below can
 * each produce a book whose own getters contradict each other, which is the
 * failure a consumer cannot debug because the engine is lying to them.
 *
 * They are not a security boundary and this file does not claim otherwise:
 * `Object.getOwnPropertySymbols` still finds them. That is deliberate
 * reflection against an engine's internals, in the same class as writing to a
 * field TypeScript's `protected` erased. The point is that no ordinary use —
 * and no honest mistake — can reach them.
 *
 * They live in their own module because the alternative is a cycle: `PageFlip`
 * already imports from `Collection/PageCollection`, so a value import back the
 * other way would close the loop at runtime.
 *
 * @internal
 */

// ---------------------------------------------------------------------------
// PageFlip — called by Flip, Render and PageCollection
// ---------------------------------------------------------------------------

/** Seeds a replacement collection with the index the outgoing one reported. */
export const INHERIT_PAGE_INDEX = Symbol('flipbook.inheritPageIndex');

/** Dispatches `flip`. Emits only — it does not move the book. */
export const EMIT_PAGE_INDEX = Symbol('flipbook.emitPageIndex');

/**
 * Announces a flipping-state change. `Flip.setState`'s seam.
 *
 * Public, it let a consumer announce a state the engine is not in — and
 * `UI.onPointerMove` reads that state to decide whether to `preventDefault()`,
 * so a spurious READ turns page scrolling back on in the middle of a turn.
 */
export const EMIT_STATE = Symbol('flipbook.emitState');

/**
 * Adopts a new orientation. `Render.update`'s seam, called only after the
 * renderer has decided the orientation from the measured box.
 *
 * Public, it rebuilt the spreads and restyled the UI for an orientation the
 * renderer has NOT adopted, leaving `Render`, `UI` and `PageCollection`
 * disagreeing about how many leaves are on screen.
 */
export const ADOPT_ORIENTATION = Symbol('flipbook.adoptOrientation');

// ---------------------------------------------------------------------------
// PageCollection — called by PageFlip and Flip
// ---------------------------------------------------------------------------

/**
 * Seeds a FIRST load's baseline with the head of the spread the book is about
 * to open on.
 *
 * Distinct from {@link INHERIT_PAGE_INDEX}, which carries an outgoing
 * collection's index across a replacement verbatim — and must, because when an
 * orientation change re-canonicalises that index the head really has moved and
 * the guard is right to announce it. Canonicalising there would suppress a real
 * change; not canonicalising here fabricates one.
 *
 * The resolution has to happen inside the collection: the requested page is not
 * the head it lands on. In landscape, opening at page 1 shows spread `[0, 1]`,
 * whose head is 0 — so seeding the request rather than the head would trade a
 * spurious `flip(1)` for a spurious `flip(0)`.
 */
export const SEED_OPENING_INDEX = Symbol('flipbook.seedOpeningIndex');

/**
 * Re-bases the collection on another spread WITHOUT showing it. `Flip`'s seam,
 * used to select the two leaves of a turn and to re-base before a commit.
 *
 * Public, it wrote `currentSpreadIndex` while leaving `currentPageIndex`
 * behind, so the book displayed one spread and believed it was on another —
 * measured on a 6-page landscape book, `setCurrentSpreadIndex(2)` from spread 0
 * left `getCurrentPageIndex()` at 0 and then made `turnToNextPage()` a SILENT
 * refusal, because the bounds check reads the forged index. An un-turnable book
 * with no error. `Flip` itself documents that same two-getters-contradicting
 * failure as one it already had to fix once.
 */
export const SET_SPREAD_INDEX = Symbol('flipbook.setSpreadIndex');

// ---------------------------------------------------------------------------
// UI — called by PageFlip
// ---------------------------------------------------------------------------

/**
 * Restyles the wrapper for an orientation `Render` has already adopted.
 *
 * The other half of {@link ADOPT_ORIENTATION}, and it was left named one method
 * along — which is why the first attempt at this module claimed to have closed
 * "the last two" seams and had not. Public, it restyled the book for an
 * orientation the renderer has not adopted: measured, a landscape book given
 * `setOrientationStyle('portrait')` reports `getOrientation() === 'landscape'`
 * while its wrapper carries `--portrait` and has been re-laid at the portrait
 * ratio, with no `changeOrientation` emitted.
 */
export const SET_ORIENTATION_STYLE = Symbol('flipbook.setOrientationStyle');

/**
 * Drops the pointer half of an in-flight gesture: the swipe anchor and the
 * captured pointer, and nothing else.
 *
 * `PageFlip.resetUserGesture()` clears the engine's three fields, but the
 * anchor lives on `UI` and survived every settle. The swipe branch in
 * `onPointerUp` gates on that anchor alone, so a release inside `swipeTimeout`
 * committed a turn the reader had already been abandoned out of — and did it
 * against geometry that had just been mirrored, so it landed on the wrong page
 * as well.
 *
 * Narrower than `cancelGesture()` on purpose. That path also runs `userStop`,
 * `abandon()` and `show()`; every caller of this one has already done the
 * engine half itself, and re-running it would dispatch `changeState` twice for
 * one settle.
 */
export const DROP_POINTER_GESTURE = Symbol('flipbook.dropPointerGesture');
