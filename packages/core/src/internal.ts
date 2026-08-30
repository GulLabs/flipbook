/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Capability keys for seams that exist between engine objects and nowhere else.
 *
 * `PageFlip`, `PageCollection` and `Render` have to call into one another, and
 * TypeScript has no way to say "public to my siblings, closed to the outside".
 * `public` with an `@internal` tag is documentation, not a fence: it survives
 * into the emitted `.d.ts` and a consumer can call it. Two of those turned out
 * to hand a consumer the power to break the very invariant they implement:
 *
 *  - the page-index inheritance seam let a consumer pre-load the ADR 0003
 *    baseline and then SUPPRESS a real `flip` — set 4 while on page 2, call
 *    `update()`, and the guard sees 4 === 4 and stays silent through a visible
 *    2 -> 4 change;
 *  - `updatePageIndex` only EMITS, so a consumer could FABRICATE a `flip(4)`
 *    for a book sitting on page 0 — and a controlled React binding acts on it,
 *    navigating itself to a page nothing ever turned to.
 *
 * Symbol keys close both. Neither symbol is re-exported from `src/index.ts`,
 * and the `exports` map blocks deep imports, so a consumer cannot name them.
 *
 * They are not a security boundary and this file does not claim otherwise:
 * walking the prototype chain with `Object.getOwnPropertySymbols` still finds
 * them. That is deliberate reflection against an engine's internals, in the
 * same class as writing to a field TypeScript's `protected` erased. The point
 * is that no ordinary use — and no honest mistake — can reach them.
 *
 * They live in their own module because the alternative is a cycle:
 * `PageFlip` already imports from `Collection/PageCollection`, so a value
 * import back the other way would close the loop at runtime.
 *
 * @internal
 */

/** Seeds a replacement collection with the index the outgoing one reported. */
export const INHERIT_PAGE_INDEX = Symbol('flipbook.inheritPageIndex');

/** Dispatches `flip`. Emits only — it does not move the book. */
export const EMIT_PAGE_INDEX = Symbol('flipbook.emitPageIndex');

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
