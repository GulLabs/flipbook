/**
 * Test-only access to seams closed behind symbols on the public façade.
 *
 * Production code must use `getBlockElement` / `getVisiblePages` / `canTurn` /
 * `isReady` / `isAnimating`. Engine unit tests still need the live UI, render,
 * collection and flip controller to assert internals — those getters are no
 * longer on the published surface (see `packages/core/src/internal.ts`).
 */
import type { PageFlip } from '@gullabs/flipbook-core';
import { GET_COLLECTION, GET_FLIP, GET_RENDER, GET_UI } from '../src/internal';
import type { UI } from '../src/UI/UI';
import type { Render } from '../src/Render/Render';
import type { PageCollection } from '../src/Collection/PageCollection';
import type { Flip } from '../src/Flip/Flip';

type Seamed = PageFlip & {
  [GET_UI](): UI;
  [GET_RENDER](): Render;
  [GET_COLLECTION](): PageCollection;
  [GET_FLIP](): Flip | null;
};

export function testUI(book: PageFlip): UI {
  return (book as Seamed)[GET_UI]();
}

export function testRender(book: PageFlip): Render {
  return (book as Seamed)[GET_RENDER]();
}

export function testCollection(book: PageFlip): PageCollection {
  return (book as Seamed)[GET_COLLECTION]();
}

export function testFlip(book: PageFlip): Flip | null {
  return (book as Seamed)[GET_FLIP]();
}

/** Page leaf by index — `PageFlip.getPage` is no longer public. */
export function testPage(book: PageFlip, index: number) {
  return testCollection(book).getPage(index);
}

/** Dist element — preferred public path when only the DOM host is needed. */
export function testDist(book: PageFlip): HTMLElement {
  return book.getBlockElement();
}
