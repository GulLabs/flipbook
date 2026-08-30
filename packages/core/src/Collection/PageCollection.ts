/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PageFlipError } from '../errors';
import type { Render } from '../Render/Render';
import { Orientation } from '../Render/Render';
import type { Page } from '../Page/Page';
import { PageDensity } from '../Page/Page';
import { EMIT_PAGE_INDEX, INHERIT_PAGE_INDEX, SEED_OPENING_INDEX } from '../internal';
import type { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { getPortraitFlippingPage } from './flippingPage';
import { at } from '../arrayAccess';

type NumberArray = number[];

/**
 * Сlass representing a collection of pages
 */
export abstract class PageCollection {
  protected readonly app: PageFlip;
  protected readonly render: Render;
  protected readonly isShowCover: boolean;

  /** Pages List */
  protected pages: Page[] = [];
  /** Index of the current page in list */
  protected currentPageIndex = 0;

  /** Number of the current spread in book */
  protected currentSpreadIndex = 0;
  /**  Two-page spread in landscape mode */
  protected landscapeSpread: NumberArray[] = [];
  /**  One-page spread in portrait mode */
  protected portraitSpread: NumberArray[] = [];

  protected constructor(app: PageFlip, render: Render) {
    this.render = render;
    this.app = app;

    this.currentPageIndex = 0;
    this.isShowCover = this.app.getSettings().showCover;
  }

  /**
   * Inherit the page index the collection this one REPLACES was reporting.
   *
   * ADR 0003 made `flip` fire only when the index changes, and a replacement
   * collection breaks that predicate unless it is told where the book already
   * was. `updateFromHtml` / `replacePages` preserve the outgoing index, build a
   * fresh collection — which starts at 0 — and re-show the preserved index. The
   * guard then compared 0 against 2 and announced a turn to page 2 for a reader
   * already on page 2 and never moved. Swapping page nodes under a React book
   * is the common case, so that fired on essentially every re-render.
   *
   * Seeding closes it without weakening anything: if the new book is shorter
   * and the index clamps, the comparison is against the real outgoing index and
   * the change IS announced.
   *
   * **Keyed by a module-private symbol (see `internal.ts`).** The first
   * shape of this fix was a public `adoptCurrentPageIndex(n)`, which was worse
   * than the bug: `PageCollection` is exported and handed out by
   * `getPageCollection()`, so a consumer could pre-load the baseline and then
   * SUPPRESS a real `flip` — set 4 while on page 2, call `update()`, and the
   * guard sees 4 === 4 and stays silent through a visible 2 -> 4 change. The
   * symbol is not re-exported from the package index and the `exports` map
   * blocks deep imports, so no ordinary use can name it. Not a security
   * boundary: walking the prototype chain with `Object.getOwnPropertySymbols`
   * still finds it, the same way `protected` can be written through once
   * TypeScript has erased it. The claim is that no honest mistake reaches
   * here, not that nothing can.
   *
   * @internal
   */
  public [INHERIT_PAGE_INDEX](index: number): void {
    this.currentPageIndex = index;
  }

  /**
   * Seed the baseline for a first load. See {@link SEED_OPENING_INDEX}.
   *
   * A no-op for an out-of-range request: `show()` returns silently for one too,
   * so the book stays where it is and the baseline must stay with it.
   *
   * @internal — symbol-keyed, unreachable by name from outside the package.
   */
  public [SEED_OPENING_INDEX](pageNum: number): void {
    const spreadIndex = this.getSpreadIndexByPage(pageNum);
    if (spreadIndex === null) return;

    this.currentPageIndex = at(at(this.getSpread(), spreadIndex, 'spread'), 0, 'spread head');
  }

  /**
   * Load pages
   */
  public abstract load(): void;

  /**
   * Clear pages list
   */
  public destroy(): void {
    // Dropping the array released nothing the pages themselves owned — for
    // canvas, a decoded bitmap and live load callbacks per page.
    for (const page of this.pages) page.dispose();

    this.pages = [];

    // PC3. The spread tables outlived the pages they index, so a destroyed
    // collection answered `getSpreadCount() === 4` and `getSpreadIndexByPage(3)
    // === 3` while `getPageCount()` was 0 — three public methods, two of them
    // describing a book that no longer exists. The tables are pure derived
    // state and nothing reads them across a destroy, so clearing them is free.
    //
    // `currentPageIndex` / `currentSpreadIndex` are deliberately left alone:
    // `PageFlip.clear()` and `updateFromHtml` both document reading the index
    // back off the emptied collection (PF3 / L2). Resetting them here was tried
    // and broke no test, so that dependency is no longer pinned by anything —
    // which makes it a `PageFlip` decision to take deliberately, not one to
    // change in passing from here.
    this.landscapeSpread = [];
    this.portraitSpread = [];
  }

  /**
   * Split the book on the two-page spread in landscape mode and one-page spread in portrait mode
   */
  protected createSpread(): void {
    this.landscapeSpread = [];
    this.portraitSpread = [];

    for (let i = 0; i < this.pages.length; i++) {
      this.portraitSpread.push([i]); // In portrait mode - (one spread = one page)
    }

    if (this.pages.length === 0) return;

    let start = 0;
    if (this.isShowCover) {
      at(this.pages, 0).setDensity(PageDensity.HARD);
      this.landscapeSpread.push([start]);
      start++;
    }

    for (let i = start; i < this.pages.length; i += 2) {
      if (i < this.pages.length - 1) this.landscapeSpread.push([i, i + 1]);
      else {
        this.landscapeSpread.push([i]);

        // PC1. Upstream hardened this leaf unconditionally, and `setDensity`
        // writes the page's PERMANENT density — the one portrait reads too.
        //
        // Portrait has no spreads of two and no covers, so a leaf is only ever
        // here because of LANDSCAPE parity: a 4-page book gets no hard leaf, a
        // 5-page book gets one, and neither has declared a cover. The cost is
        // not cosmetic. `HTMLPage.newTemporaryCopy()` returns `this` for a hard
        // page, so `getPortraitFlippingPage` sees `copy === current` and falls
        // back to upstream's previous-leaf slide-in — measured on a 3-page
        // portrait book: the BACK turn from the last page animated `pages[1]`,
        // and `shouldDrawBottomPage` then skipped the bottom page because the
        // mover WAS the bottom page. That is the §4.1 bug this fork exists to
        // kill, reachable in HTML mode on any odd-length book with no cover.
        //
        // So the inference is gated on the one thing that makes a hard terminal
        // leaf mean something: the book said it has covers. `showCover: false`
        // is a statement that it does not, and the engine must not invent one.
        // A `showCover` book's terminal leaf is hardened below, unconditionally
        // — see NF3. Nothing to do here.
      }
    }

    // NF3. The back cover is hard because the book HAS covers, not because of
    // where the page count happened to land.
    //
    // This used to be decided inside the singleton branch above, so it depended
    // on parity: a 6-page book left page 5 alone in a spread and hardened it, a
    // 5-page book paired page 4 and left it soft. Same setting, same intent,
    // opposite result — and an author who added one page silently gained or
    // lost a hard back cover, with nothing in their code to explain it.
    //
    // `showCover: true` says the book has covers, plural. A physical book has
    // two, so the rule is "first and last", and neither depends on arithmetic
    // the author cannot see. Deliberate behaviour change for existing books
    // (owner decision, 2026-08-30), taken before publish because it is free now
    // and a major version later.
    //
    // The `isShowCover` gate is NOT optional, and dropping it is not a
    // simplification: hardening a terminal leaf on a cover-less book is PC1,
    // which puts portrait BACK straight back onto upstream's previous-leaf
    // slide-in — the §4.1 bug this fork exists to kill. A hostile variant that
    // removed this gate failed the PC1 test with "mover is the PREVIOUS leaf".
    //
    // `length > 1` guards the one-page book: page 0 is already the front cover,
    // and it must not be re-hardened as its own back cover — harmless today,
    // but it would make the two rules read as though they could disagree.
    if (this.isShowCover && this.pages.length > 1) {
      at(this.pages, this.pages.length - 1).setDensity(PageDensity.HARD);
    }
  }

  /**
   * Get spread by mode (portrait or landscape)
   */
  protected getSpread(): NumberArray[] {
    return this.render.getOrientation() === Orientation.LANDSCAPE
      ? this.landscapeSpread
      : this.portraitSpread;
  }

  /**
   * Number of spreads in the current orientation. In portrait this equals the
   * page count; in landscape two pages usually share one spread.
   */
  public getSpreadCount(): number {
    return this.getSpread().length;
  }

  /**
   * Get spread index by page number
   *
   * @param {number} pageNum - page index
   */
  public getSpreadIndexByPage(pageNum: number): number | null {
    const spread = this.getSpread();

    for (let i = 0; i < spread.length; i++) {
      const entry = at(spread, i);
      if (pageNum === entry[0] || pageNum === entry[1]) return i;
    }

    return null;
  }

  /**
   * Get the total number of pages
   */
  public getPageCount(): number {
    return this.pages.length;
  }

  /**
   * Get the pages list
   */
  public getPages(): Page[] {
    return this.pages;
  }

  /**
   * Get page by index
   *
   * @param {number} pageIndex
   */
  public getPage(pageIndex: number): Page {
    if (pageIndex >= 0 && pageIndex < this.pages.length) {
      return at(this.pages, pageIndex);
    }

    throw new PageFlipError(`Invalid page index ${pageIndex}`, 'INVALID_PAGE');
  }

  /**
   * Get the next page from the specified
   *
   * @param {Page} current
   */
  public nextBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    // `indexOf` returns -1 for a page that is not in this collection, and
    // `-1 < length - 1` is true — upstream answered `pages[0]` for a stranger.
    // `prevBy` already returned null for the same input.
    if (idx >= 0 && idx < this.pages.length - 1) return at(this.pages, idx + 1);

    return null;
  }

  /**
   * Get previous page from specified
   *
   * @param {Page} current
   */
  public prevBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    if (idx > 0) return at(this.pages, idx - 1);

    return null;
  }

  /**
   * Get flipping page depending on the direction
   *
   * @param {FlipDirection} direction
   */
  public getFlippingPage(direction: FlipDirection): Page {
    const current = this.currentSpreadIndex;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
      return getPortraitFlippingPage(this.pages, current, direction);
    } else {
      const spreads = this.getSpread();
      const spread =
        direction === FlipDirection.FORWARD ? at(spreads, current + 1) : at(spreads, current - 1);

      if (spread.length === 1) return at(this.pages, at(spread, 0));

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 0))
        : at(this.pages, at(spread, 1));
    }
  }

  /**
   * Get Next page at the time of flipping
   *
   * @param {FlipDirection}  direction
   */
  public getBottomPage(direction: FlipDirection): Page {
    const current = this.currentSpreadIndex;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
      return direction === FlipDirection.FORWARD
        ? at(this.pages, current + 1)
        : at(this.pages, current - 1);
    } else {
      const spreads = this.getSpread();
      const spread =
        direction === FlipDirection.FORWARD ? at(spreads, current + 1) : at(spreads, current - 1);

      if (spread.length === 1) return at(this.pages, at(spread, 0));

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 1))
        : at(this.pages, at(spread, 0));
    }
  }

  /**
   * Show next spread
   */
  public showNext(): void {
    // `length - 1`, not `length`: upstream walked one past the end and then
    // read `getSpread()[length]`, which throws inside `showSpread`.
    if (this.currentSpreadIndex < this.getSpread().length - 1) {
      this.currentSpreadIndex++;
      this.showSpread();
    }
  }

  /**
   * Show prev spread
   */
  public showPrev(): void {
    if (this.currentSpreadIndex > 0) {
      this.currentSpreadIndex--;
      this.showSpread();
    }
  }

  /**
   * Get the number of the current spread in book
   */
  public getCurrentPageIndex(): number {
    return this.currentPageIndex;
  }

  /**
   * Show specified page
   * @param {number} pageNum - Page index (from 0s)
   */
  public show(pageNum: number | null = null): void {
    pageNum ??= this.currentPageIndex;

    if (pageNum < 0 || pageNum >= this.pages.length) return;

    const spreadIndex = this.getSpreadIndexByPage(pageNum);
    if (spreadIndex !== null) {
      this.currentSpreadIndex = spreadIndex;
      this.showSpread();
    }
  }

  /**
   * Index of the current page in list
   */
  public getCurrentSpreadIndex(): number {
    return this.currentSpreadIndex;
  }

  /**
   * Set new spread index as current
   *
   * @param {number} newIndex - new spread index
   */
  public setCurrentSpreadIndex(newIndex: number): void {
    if (newIndex >= 0 && newIndex < this.getSpread().length) {
      this.currentSpreadIndex = newIndex;
    } else {
      throw new PageFlipError(
        `Invalid spread index ${newIndex} (have ${this.getSpread().length})`,
        'INVALID_SPREAD',
      );
    }
  }

  /**
   * Show current spread
   */
  private showSpread(): void {
    const spread = at(this.getSpread(), this.currentSpreadIndex);
    // Named for what it IS — the spread HEAD, the page read first — not for
    // where it lands. It is the left leaf only in a left-bound book; under
    // `rtl` the same index is the RIGHT leaf, and a side-shaped name would
    // invite someone to "correct" `currentPageIndex` to match the side.
    const headIdx = at(spread, 0);

    // X2 / RTL mirroring. This is the ONLY reading-direction-dependent branch
    // in the engine, and it is deliberately the only one.
    //
    // A right-bound book — Arabic, Hebrew, Persian, Urdu — puts the spine on
    // the right and page 1 on the right of the first spread. Until now the
    // engine mirrored the TURN direction but not the LAYOUT, which matches no
    // real book: the reader turned right-to-left through pages laid out
    // left-to-right.
    //
    // The mirror belongs here because it is COMBINATORIAL, not geometric: it
    // chooses which of two page objects goes to which of two setters, and
    // `setLeftPage`/`setRightPage` stamp the `PageOrientation` that drives the
    // pixel `left`, the `--left`/`--right` classes and `drawHard`'s
    // transform-origin. Everything spatial mirrors by construction, with no
    // arithmetic anywhere that could drift out of sync.
    //
    // What must NOT mirror, each a live trap:
    //  - Pointer coordinates and local<->global conversion. Mirroring those
    //    makes the fold run away from the finger (the I2 defect). Already
    //    handled by `foldSide`, a GEOMETRIC side that is reading-agnostic.
    //  - `getFlippingPage` / `getBottomPage` face selection. Those are already
    //    correct in both readings, and touching them applies the mirror TWICE.
    //    Derivation: the mover is the destination face on the geometric side
    //    the fold sweeps into. LTR forward -> left face -> `dest[0]`. RTL
    //    forward -> geometric BACK -> right face -> also `dest[0]`. The
    //    semantic and geometric mirrors cancel, which is why a
    //    direction-keyed selection is reading-agnostic. X2 was never a face
    //    bug: the faces were right and the static layout they landed into was
    //    not, so they swapped at commit.
    //  - The portrait branch below. See its own comment.
    //
    // Read live rather than cached: `direction` is not construction-time, so
    // `updateSettings({ direction })` must take effect on the next draw.
    const rtl = this.app.getSettings().direction === 'rtl';

    if (spread.length === 2) {
      const tailIdx = at(spread, 1);
      const head = at(this.pages, headIdx);
      const tail = at(this.pages, tailIdx);

      this.render.setLeftPage(rtl ? tail : head);
      this.render.setRightPage(rtl ? head : tail);
    } else if (this.render.getOrientation() === Orientation.LANDSCAPE) {
      // A landscape spread holding one leaf is either the front cover — which
      // sits to the RIGHT of the spine, with nothing to its left — or the last
      // leaf of the book, which sits to the left.
      //
      // PC2. That used to be decided by `headIdx === pages.length - 1` alone,
      // and for a ONE-page book with `showCover` both descriptions are true of
      // the same leaf: index 0 is also index `length - 1`, so the last-leaf test
      // won and the cover was placed on the left half with the right half empty.
      // Measured on a 520x300 host (rect.left 60, pageWidth 200): the cover drew
      // at `left: 60px` where every other cover draws at `left: 260px`.
      // `createSpread` only ever emits a `[0]` spread for `showCover`, so the
      // cover is the correct tie-break, and it is written as an exception to the
      // last-leaf test rather than as a third branch: a lone leaf that is
      // neither the cover nor the tail cannot be produced, and a branch for it
      // would be unreachable code with an invented default. Every other book is
      // untouched — the two tests cannot both hold once there is more than one
      // page.
      const lone = at(this.pages, headIdx);
      const isTail = headIdx === this.pages.length - 1 && !(this.isShowCover && headIdx === 0);

      // The tail sits away from the spine and the cover sits against it, so
      // mirroring the binding side mirrors both — a straight inversion of the
      // tie-break above, not a second rule.
      const onLeft = rtl ? !isTail : isTail;

      this.render.setLeftPage(onLeft ? lone : null);
      this.render.setRightPage(onLeft ? null : lone);
    } else {
      // PORTRAIT DOES NOT MIRROR, and this is the trap in "just swap the
      // branches when rtl".
      //
      // Portrait shows one centred leaf and has no visible spine, so there is
      // nothing spatial to mirror. It uses `setRightPage` because
      // `Render.computeBounds` places the visible leaf on the RIGHT half of a
      // double-width bounds rect (`left = middle.x - 1.5 * pageWidth`). Sending
      // it left under `rtl` would move the page onto the phantom half —
      // off-centre and partly off-host.
      //
      // Portrait RTL is purely a turn-direction concern, and that is already
      // handled: `getFoldRect` re-anchors on geometric BACK, so an RTL forward
      // turn pivots about the leaf's right edge — exactly where the spine is in
      // a right-bound portrait book.
      this.render.setLeftPage(null);
      this.render.setRightPage(at(this.pages, headIdx));
    }

    // Unchanged, and it must be: the spread HEAD is the first page read, in
    // both readings. "Page 5" means the same page whichever way the book binds,
    // so `getCurrentPageIndex`, `turnToPage` and the React controlled `page`
    // prop keep their meaning. Index order is reading order; the spatial side
    // is derived from it, never the other way round.
    // ADR 0003. The ASSIGNMENT is unconditional — `currentPageIndex` must
    // always describe what is on screen. Only the ANNOUNCEMENT is guarded.
    //
    // Inherited verbatim from upstream, both lines fired on every repaint, so
    // `flip` meant "`showSpread` ran" while its name, its own JSDoc and every
    // consumer binding read it as "the page changed". Mounting a book emitted
    // it twice before any turn; `updateSettings({ drawShadow })` emitted it;
    // `turnToPage(currentIndex)` emitted it; and abandoning an in-flight fold
    // emitted a `flip` for a turn that never committed — enough to drive
    // controlled state, analytics, or an `onFlip` auto-advance.
    //
    // Guarding on the index is safe because within one spread table, spread
    // index and head index are in BIJECTION: portrait pushes `[i]` for every
    // `i`, landscape pushes disjoint ascending groups, so no two spreads share
    // a `spread[0]`. In a fixed orientation "the spread changed" and "the index
    // changed" are therefore the same predicate, and this cannot suppress a
    // real turn — only a repaint announcement.
    //
    // A re-spread across an orientation change is the one case outside that
    // bijection, and it still emits whenever the head actually moves. It must:
    // the payload IS `getCurrentPageIndex()`, so a silent change desyncs every
    // consumer caching it.
    const changed = this.currentPageIndex !== headIdx;

    this.currentPageIndex = headIdx;

    if (changed) {
      this.app[EMIT_PAGE_INDEX](this.currentPageIndex);
    }
  }
}
