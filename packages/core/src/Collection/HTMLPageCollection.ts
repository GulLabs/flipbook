/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * COLLAPSED into `PageCollection`.
 *
 * This class existed to supply one method — `load()`, which built `HTMLPage`s —
 * and nothing else varied. A subclass hook whose only variation is which
 * concrete class the constructor names is not a renderer seam.
 *
 * Kept as an alias for one release so an in-flight import does not break
 * mid-refactor; it is not part of the public API and `index.ts` does not
 * export it.
 *
 * @internal
 */
export { PageCollection as HTMLPageCollection } from './PageCollection';
