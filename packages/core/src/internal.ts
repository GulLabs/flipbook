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
