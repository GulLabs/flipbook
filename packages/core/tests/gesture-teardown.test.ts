// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { HTMLPageCollection, PageFlip } from '@gullabs/flipbook-core';
import { makePages, sizeElement } from './html-book-fixture';

/**
 * C1 — every path that tears down or re-lays the book drops the POINTER
 * gesture, not just the engine's three flags.
 *
 * `resetUserGesture()` clears `isUserTouch` / `isUserMove` / `mousePosition` on
 * `PageFlip`. The swipe anchor and the captured pointer live on `UI`, and the
 * swipe branch of `onPointerUp` gates on that anchor alone — it consults none
 * of the engine flags. So a release inside `swipeTimeout`, past
 * `swipeDistance`, committed a turn the reader had already been abandoned out
 * of.
 *
 * WHY THIS FILE IS PARAMETERIZED, and it is the whole point. The first version
 * of these tests settled only through `updateSettings({ direction })`. Codex
 * killed them with a one-line mutant: move the UI cleanup out of
 * `resetUserGesture()` and put it directly after the settle branch's own call.
 * Both tests passed, and `replacePages`, `attachMode`, `updateFromHtml` and
 * `clear` were all still broken — the exact half-fix that centralising the
 * cleanup in a shared method is supposed to make impossible. A test that only
 * covers the caller you were thinking about certifies the bug in the other
 * four.
 */

const books: Array<() => void> = [];

afterEach(() => {
  while (books.length) books.pop()?.();
});

type Book = {
  book: PageFlip;
  host: HTMLElement;
  /** Mutable: `loadFromHTML` builds a new one. See {@link refresh}. */
  dist: HTMLElement;
  /** Pointer ids the element currently believes it has captured. */
  captured: Set<number>;
};

/**
 * A landscape book with STATEFUL pointer-capture shims.
 *
 * `installPointerCaptureShims` installs no-ops, which is enough to keep the
 * real code path callable but not enough to observe it: with no
 * `hasPointerCapture` the engine falls back to "the call did not throw, assume
 * captured", and nothing records whether the release ever happened. Codex's
 * second blocker was exactly this — a mutant that cleared `activePointerId`
 * without releasing the capture passed, while a real browser would still be
 * routing pointer 1's events here.
 */
function makeBook(settings: Record<string, unknown> = {}): Book {
  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, 520, 300);
  const pages = makePages(6);
  for (const p of pages) host.appendChild(p);

  const book = new PageFlip(host, {
    width: 200,
    height: 300,
    size: 'fixed',
    usePortrait: false,
    flippingTime: 0,
    ...settings,
  });
  book.loadFromHTML(pages);

  const dist = book.getUI().getDistElement();
  sizeElement(dist, 520, 300);
  book.update();

  const captured = new Set<number>();
  shim(dist, captured);

  books.push(() => {
    book.destroy();
    host.remove();
  });
  return { book, host, dist, captured };
}

/** Stateful pointer-capture shims sharing one ledger. */
function shim(el: HTMLElement, captured: Set<number>): void {
  Object.assign(el, {
    setPointerCapture(id: number) {
      captured.add(id);
    },
    releasePointerCapture(id: number) {
      captured.delete(id);
    },
    hasPointerCapture(id: number) {
      return captured.has(id);
    },
  });
}

/**
 * Re-resolve the dist element after a teardown.
 *
 * `loadFromHTML` replaces the whole UI, so the element the shims were installed
 * on is no longer the one the engine listens to. Without this the fresh-pointer
 * assertion below dispatches into a detached node and passes vacuously — it
 * did, on the first run.
 */
function refresh(b: Book): void {
  const current = b.book.getUI().getDistElement();
  if (current === b.dist) return;

  b.dist = current;
  shim(current, b.captured);
}

function pointer(b: Book, type: string, x: number, id = 1): void {
  const rect = b.book.getBoundsRect();
  b.dist.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

/**
 * Every path that calls `resetUserGesture()`. Named by the public method a
 * consumer would call, because that is what has to stay safe.
 */
const TEARDOWNS: Array<{ name: string; run: (b: Book) => void }> = [
  {
    name: 'updateSettings — the fold-invalidating settle',
    run: (b) => b.book.updateSettings({ direction: 'rtl' }),
  },
  {
    name: 'updateFromHtml — same UI, fresh collection',
    run: (b) => {
      const next = makePages(6);
      for (const p of next) b.host.appendChild(p);
      b.book.updateFromHtml(next);
    },
  },
  {
    name: 'loadFromHTML again — attachMode, whole mode replaced',
    run: (b) => {
      const next = makePages(6);
      for (const p of next) b.host.appendChild(p);
      b.book.loadFromHTML(next);
    },
  },
  {
    name: 'replacePages — the entry a non-HTML renderer would use',
    run: (b) => {
      const next = makePages(6);
      for (const p of next) b.host.appendChild(p);
      b.book.replacePages(
        new HTMLPageCollection(b.book, b.book.getRender(), b.dist, next),
        b.book.getCurrentPageIndex(),
      );
    },
  },
  {
    name: 'clear — the book is emptied under the finger',
    run: (b) => b.book.clear(),
  },
];

/**
 * WHICH CALLERS ACTUALLY DEPEND ON THE FIX — measured by the test expert with a
 * full C1 revert, and NOT what an earlier version of this note claimed. It said
 * `clear` and `replacePages` were the only dependents. Measured:
 *
 *   - `updateSettings` (the settle) depends in BOTH halves;
 *   - `replacePages` depends in both halves;
 *   - `clear` depends only in the CAPTURE half — its swipe test passed under a
 *     full revert, because the swipe branch really does run and call
 *     `flipNext`, which an emptied book refuses at the boundary. It was passing
 *     for the wrong reason, so it now also asserts that nothing was REFUSED:
 *     a refusal means the turn was attempted, which is the bug;
 *   - `updateFromHtml` and `loadFromHTML` depend in neither, because
 *     `HTMLUI.updateItems` -> `removeHandlers()` -> `cancelGesture()` drops the
 *     same state by a second path.
 *
 * The last two stay anyway: that second path is an implementation detail of the
 * HTML UI which a future renderer need not have, and they pin the behaviour
 * either way. The note is here because the previous one was confidently wrong,
 * which is the failure mode this repo keeps repeating.
 */

describe('a teardown drops the pointer gesture, whichever path reaches it', () => {
  for (const { name, run } of TEARDOWNS) {
    test(`${name}: a later release cannot commit a turn`, () => {
      const b = makeBook();
      b.book.turnToPage(2);

      const rect = b.book.getBoundsRect();
      const startX = rect.left + rect.width - 10;

      const flips: number[] = [];
      const refusals: string[] = [];
      b.book.on('flip', (e) => flips.push(e.data as number));
      // A refusal proves the turn was ATTEMPTED, which is the defect. Without
      // this the `clear` case passes under a full revert: the swipe branch runs,
      // calls `flipNext`, and an emptied book simply refuses it at the boundary.
      b.book.on('turnRejected', () => refusals.push('rejected'));

      // Press and drag. Do NOT release — the gesture is live across the
      // teardown, which is the case a reader actually produces.
      pointer(b, 'pointerdown', startX);
      pointer(b, 'pointermove', startX - 40);

      run(b);
      flips.length = 0; // the teardown's own announcements are not what is under test

      // Well past `swipeDistance` (default 30) and inside `swipeTimeout`:
      // exactly the input the swipe branch commits on.
      pointer(b, 'pointerup', startX - 200);

      expect(flips).toEqual([]);
      expect(refusals).toEqual([]);
    });

    test(`${name}: the pointer CAPTURE is released too`, () => {
      // The sibling above cannot prove this half: `onPointerUp` calls
      // `releaseCapturedPointer()` on its own first line, so by the time it has
      // run the capture is gone however the teardown behaved. The
      // distinguishing case is a teardown with NO release after it — the reader
      // is still holding the screen — where a leaked capture keeps the browser
      // routing that pointer here and `isActivePointer` rejects every other one.
      const b = makeBook();
      const rect = b.book.getBoundsRect();
      const startX = rect.left + rect.width - 10;

      pointer(b, 'pointerdown', startX);
      pointer(b, 'pointermove', startX - 40);
      expect(b.captured.has(1)).toBe(true);

      run(b);

      expect(b.captured.has(1)).toBe(false);

      // B1, and this is the assertion that matters. Releasing the DOM capture
      // while leaving `activePointerId` set passed the whole suite — measured.
      // That is verbatim the failure C1 exists to prevent: `onPointerDown`
      // early-returns whenever an id is held, so the book goes dead to every
      // later finger for the rest of its life. A fresh pointer being ACCEPTED
      // (and captured) is the only observable that proves ownership was given
      // up; the DOM release alone does not.
      refresh(b);
      pointer(b, 'pointerdown', startX, 2);
      expect(b.captured.has(2)).toBe(true);
    });
  }
});

test('POSITIVE CONTROL: with no teardown, that same swipe DOES turn the page', () => {
  // Every assertion above is an absence, and an engine with the swipe branch
  // deleted outright satisfies all of them. This is the one test in the file
  // that fails if turning by swipe stops working at all, so the absences above
  // mean something.
  const b = makeBook();
  b.book.turnToPage(2);

  const flips: number[] = [];
  b.book.on('flip', (e) => flips.push(e.data as number));

  const rect = b.book.getBoundsRect();
  const startX = rect.left + rect.width - 10;

  pointer(b, 'pointerdown', startX);
  pointer(b, 'pointermove', startX - 40);
  pointer(b, 'pointerup', startX - 200);

  expect(flips).not.toEqual([]);
});
