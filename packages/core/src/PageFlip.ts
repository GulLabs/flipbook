/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  ADOPT_ORIENTATION,
  DROP_POINTER_GESTURE,
  EMIT_PAGE_INDEX,
  EMIT_STATE,
  INHERIT_PAGE_INDEX,
  SEED_OPENING_INDEX,
  SET_ORIENTATION_STYLE,
} from './internal';
import type { PageCollection } from './Collection/PageCollection';
import { HTMLPageCollection } from './Collection/HTMLPageCollection';
import type { PageRect, Point } from './BasicTypes';
import { Flip, FlipCorner, FlippingState } from './Flip/Flip';
import type { Orientation, Render } from './Render/Render';
import { HTMLUI } from './UI/HTMLUI';
import { distanceBetween } from './Helper';
import type { Page } from './Page/Page';
import { EventObject } from './Event/EventObject';
import type { BookSnapshot, FlipbookEventMap } from './Event/EventObject';
import { HTMLRender } from './Render/HTMLRender';
import type { FlipOptions, FlipSetting, LiveSetting } from './Settings';
import { Settings } from './Settings';
import type { UI } from './UI/UI';
import { PageFlipError } from './errors';

/**
 * Settings that are consumed once while the book is being built and never read
 * again, so `updateSettings` cannot make them take effect.
 *
 * `showCover` is captured by `PageCollection`'s constructor and decides the
 * spread layout; `startPage` is read only by `attachMode`. Deliberately NOT
 * including `size` / `width` / `height`: `updateSettings` restamps those via
 * `ui.applyHostSize`, so they are live.
 */
const CONSTRUCTION_TIME_SETTINGS = ['hardCovers', 'initialPage'] as const;

/**
 * Settings a turn in flight was built against, and cannot absorb a change to.
 *
 * `Flip` freezes per-turn state at turn start on purpose — `Render.direction`
 * is the geometric fold side (the `rtl` mirror applied exactly once), and
 * `FlipCalculation` is constructed from the page dimensions of that moment.
 * Everything here feeds one of those two. `updateSettings` meanwhile pushes
 * straight through to `update()`, which re-lays the STATIC spread immediately.
 *
 * Change one mid-turn and the two halves disagree on screen: the resting pages
 * re-lay at the new geometry while the curl, the underside, the shadows and the
 * z-order keep the old, until the animation ends and snaps. Resizing a 200px
 * landscape book to 150px mid-turn splits it exactly as toggling `direction`
 * did.
 *
 * So a change to any of these settles the fold first. Freezing the static side
 * to match the fold is the other repair and is the wrong one — it makes a
 * public setting silently not take effect for as long as a gesture is held,
 * which is the `swipeDistance` failure this repo already fixed once.
 *
 * `satisfies` catches a MISSPELLED or removed key, and nothing more. It does
 * NOT catch an omission: adding a new geometry setting to `FlipSetting` without
 * listing it here compiles cleanly and re-creates the mid-fold split, silently.
 * Stated rather than implied, because the first version of this comment claimed
 * the stronger guarantee and would have been believed.
 */
const FOLD_INVALIDATING_SETTINGS = [
  'readingDirection',
  'sizing',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'usePortrait',
  'autoSize',
] as const satisfies readonly (keyof FlipSetting)[];

/**
 * Class representing a main PageFlip object
 *
 * @extends EventObject
 */
/**
 * The page a load should actually open on.
 *
 * The numeric clamp alone is not enough: `NaN`, `Infinity` and `0.5` all
 * survive it (`NaN < 0` and `NaN >= length` are both false), and
 * `PageCollection.show()` then silently DECLINES them, with nothing reported.
 *
 * WHAT THIS DOES NOT DO, corrected in round 6 after the earlier claim here was
 * measured and found false: it does not fix a blank book, because no supported
 * configuration produces one. Every new `Render` starts with
 * `orientation === null`, and its first update calls `PageFlip.update()`, which
 * calls `pages.show()` before the explicit start-page show ever runs — so the
 * renderer is seeded whatever `startPage` was. Measured with `NaN`: index 0, a
 * populated `rightPage`, identical with and without this resolver.
 *
 * It stays because a declined `show()` is a silent no-op on a documented
 * setting and the collection is the only thing that can answer "is this index
 * in a spread" for all three cases at once. It is defensive validation, not an
 * observable fix, and the tests written to prove it passed against the unfixed
 * code and were deleted rather than kept as decoration.
 */
function resolveStartPage(pages: PageCollection, pageCount: number, requested: number): number {
  if (pageCount === 0) return 0;

  const clamped = Math.min(Math.max(requested, 0), pageCount - 1);

  return pages.getSpreadIndexByPage(clamped) === null ? 0 : clamped;
}

export class PageFlip extends EventObject {
  private mousePosition: Point = { x: 0, y: 0 };
  private isUserTouch = false;
  private isUserMove = false;

  private readonly setting: FlipSetting;

  /**
   * What the CALLER wrote, kept for the life of the engine.
   *
   * `updateSettings` re-resolves from this rather than from the resolved
   * object, so "was this bound explicitly supplied?" stays answerable — merging
   * into resolved settings makes every synthesised bound look authored, and a
   * rule about explicit bounds would then fail an unrelated
   * `updateSettings({ drawShadow })`. It is also what makes `getSettings()`
   * round-trip: `responsive -> fixed -> responsive` used to return bounds
   * pinned to width/height instead of the ones the caller declared.
   */
  private authored: FlipOptions;
  private readonly block: HTMLElement; // Root HTML Element

  // Nullable, not `!`: these only exist after `loadFromHTML`.
  // The public getters below keep their non-null signatures and throw a typed
  // error instead — a definite-assignment `!` here would hand callers
  // `undefined` and fail as "cannot read properties of undefined" deep in the
  // engine, and widening every getter to `| null` would break every consumer
  // for a state they cannot observe anyway.
  private pages: PageCollection | null = null;
  private flipController: Flip | null = null;
  private render: Render | null = null;

  private ui: UI | null = null;
  /**
   * `ready` is once per ENGINE, `loaded` once per load. See {@link FlipbookEventMap}.
   */
  private readyAnnounced = false;
  private destroyed = false;

  /**
   * Bumped by every operation that replaces or tears down the current book
   * (attach, replacePages, updateFromHtml, clear, load). Kept so a future
   * async attach path cannot re-introduce the stale-continuation class of bug
   * the counter was added to prevent; HTML paths claim a generation too.
   */
  private loadGeneration = 0;

  /**
   * Create a new PageFlip instance
   *
   * @constructor
   * @param {HTMLElement} inBlock - Root HTML Element
   * @param {Object} setting - Configuration object
   */
  constructor(inBlock: HTMLElement, setting: FlipOptions) {
    super();

    this.authored = { ...setting };
    this.setting = new Settings().resolve(this.authored);
    this.block = inBlock;
  }

  /**
   * Destructor. Remove a root HTML element and all event handlers.
   *
   * After this returns the engine holds **no** state, and that is observable:
   *
   * - Anything that reads engine state — `getRender`, `getUI`,
   *   `getPageCollection`, `getPage`, `getPageCount`, `getCurrentPageIndex`,
   *   `getOrientation`, `getBoundsRect`, `turnToPage`, `turnToNextPage`,
   *   `turnToPrevPage`, `flip`, `clear` — throws
   *   `PageFlipError` with code `'DESTROYED'`. Returning a disposed collection
   *   or a stopped render instead is how a "working" call silently does
   *   nothing.
   * - `flipNext` / `flipPrev` keep their "refusal is a boolean" contract:
   *   `false` plus `turnRejected` with `code: 'DESTROYED'`. That event is
   *   still *emitted*, but every listener registered before `destroy()` has
   *   been dropped (see below), so in practice nobody is left to hear it: the
   *   `false` is what a caller should read.
   * - **Every registered listener is forgotten** (Y2). Handlers are closures
   *   over consumer state; keeping them was the one thing the teardown
   *   retained. `on()` after `destroy()` still registers — `EventObject` is a
   *   plain emitter — and such a listener would receive a later
   *   `turnRejected`, which is the only event a dead engine still emits.
   * - Mutating lifecycle calls are safe no-ops: `destroy` itself (a consumer's
   *   cleanup legitimately runs twice), `update`, `updateSettings`,
   *   `replacePages`, `updateFromHtml`, `updateFromImages`.
   * - Always safe: `getSettings`, `getState` (`READ`), `getFlipController`
   *   (`null`), `getBlock`, `isDestroyed`.
   *
   * A destroyed engine is not reusable — `loadFromHTML`
   * after `destroy()` do not revive it. Construct a new `PageFlip`.
   *
   * ## Destroying from inside an event handler (X4)
   *
   * `destroy()` from an `onFlip` handler is the cleanup this whole contract
   * exists to support — a reader that unmounts the book when it reaches the
   * last page — and it used to be the one path where `'DESTROYED'` was not
   * safe. The render loop's turn completion runs `onAnimateEnd` (which is what
   * emits `flip`) and then drew ONE more frame; that trailing frame read engine
   * state back out — `getPageCollection()` in HTML mode, `getUI()` in canvas —
   * so nulling both threw a `PageFlipError` out of the consumer's rAF callback
   * for doing exactly what the docs told them to.
   *
   * That is fixed where it belongs, in `Render`: `render()` declines the draw
   * after `onAnimateEnd` when the loop generation has moved, and `loop()`
   * declines the re-arm for the same reason (`Render.stop()` bumps the
   * generation, and `destroy()` calls it). The frame that used to read a
   * torn-down engine no longer happens at all, so there is nothing here to
   * keep coherent for it: the teardown is complete, synchronous and
   * unconditional,
   * and every guarded accessor reports `'DESTROYED'` from the moment
   * `destroy()` returns — including inside the handler that called it.
   */
  public destroy(): void {
    this.destroyed = true;

    // L8. From here on a listener error cannot abort the teardown — it is
    // reported on the next task instead of thrown. Everything below this line
    // emits (`ui.destroy()` abandons an in-flight gesture, `abandon()`
    // announces READ) while `destroyed` is already true, so any listener that
    // reads engine state gets the `DESTROYED` error the contract promises — and
    // that used to come straight back out of `destroy()`, taking the rest of
    // the cleanup with it. See `EventObject.trigger`.
    this.deferListenerErrors();
    try {
      // May be called before create() finishes wiring render/ui.
      this.render?.stop();
      this.ui?.destroy();
      // Stopping the loop does not release anything. The collection holds every
      // page — for canvas, every decoded image — and the renderer holds its own
      // left/right/flipping/bottom references, so both have to be cleared or a
      // retained destroyed engine retains the whole book.
      this.render?.releasePages();
      this.pages?.destroy();
      this.flipController?.abandon();

      // P3: dropping the references is the *contract*, not just hygiene. Left
      // non-null, every accessor kept working against a dead engine —
      // `getPageCollection()` handed back a disposed collection and `flipNext()`
      // still reached the flip controller against a stopped render, so a
      // post-destroy call looked like it had succeeded. Nulling them routes
      // every guarded accessor through `requireLoaded`, which reports
      // `'DESTROYED'`. It also releases the engine's own retention of the book.
      this.pages = null;
      this.render = null;
      this.ui = null;
      this.flipController = null;
      // The host owns `block` (React/SSR). Do not remove it from the DOM.

      // Y2, and the same reasoning as the four nulls above: a listener is a
      // closure, and under React it captures component state, refs and DOM. The
      // engine kept the whole map alive, so a consumer holding a destroyed engine
      // held every one of those closures too — the one retention the teardown
      // missed. LAST, so anything the teardown itself emits (`ui.destroy()`
      // abandons an in-flight gesture, which reports `changeState`) still reaches
      // the handlers that were registered for it.
      this.clearListeners();
    } finally {
      // SCOPED, not permanent. `deferListenerErrors()` used to be one-way, and
      // that contradicted a documented guarantee two lines of MIGRATION.md
      // away: `on()` after `destroy()` still registers, and such a listener
      // still receives the `turnRejected` a dead engine emits. Its errors are
      // outside teardown and must stay synchronous like every other listener's.
      // `finally`, so an unrelated throw cannot strand a destroyed engine in
      // deferring mode for the rest of its life.
      this.resumeListenerErrors();
    }
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Emit one engine event. A thin alias so call sites do not repeat `this`. */
  private dispatch<K extends keyof FlipbookEventMap>(
    eventName: K,
    data: FlipbookEventMap[K],
  ): void {
    this.trigger(eventName, this, data);
  }

  /**
   * Announce that the collection was replaced.
   *
   * D10. This was a PAIR — `update` then `collectionRebuild` — always fired
   * together, atomically, with the same page. Roughly sixty lines existed to
   * guarantee a cross-event property that one event does not have: an `update`
   * listener that threw taking `collectionRebuild` with it, and an `update`
   * listener that REPLACED the collection leaving the second half to report a
   * count for a book that no longer existed.
   *
   * Both failures are structural consequences of splitting one fact across two
   * dispatches. One event has neither, so the machinery is gone rather than
   * fixed. `update` also shared its name with `PageFlip.update()`, which does
   * not cause it, and is now free for a real repaint signal if one is ever
   * wanted.
   */
  private dispatchPagesChanged(page: number, pageCount: number, orientation: Orientation): void {
    this.dispatch('pagesChanged', { page, pageCount, orientation });
  }

  /**
   * The page index the book has actually settled on, as a caller can observe it.
   *
   * `PageCollection.destroy()` empties the page array but does not reset
   * `currentPageIndex`, so an emptied collection keeps reporting the index it
   * held when it was full. Every path that can produce an empty book already
   * reports `0` for it (`attachMode`, `updateFromHtml`, `replacePages`); this
   * is that same rule in one place, so the getter and the events cannot drift.
   */
  private resolvedPageIndex(pages: PageCollection | null): number {
    if (pages === null || pages.getPageCount() === 0) return 0;
    return pages.getCurrentPageIndex();
  }

  /**
   * Update the render area. Re-show current page.
   */
  public update(): void {
    this.render?.update();
    this.pages?.show();
  }

  /**
   * Host element the engine was constructed with.
   *
   * @internal Wiring seam for load/attach. Not part of the supported API; it
   * may change in a minor release.
   */
  public getBlock(): HTMLElement {
    return this.block;
  }

  /** Loaded engine state, or a typed error naming what the caller must do first. */
  private requireLoaded<T>(value: T | null, what: string): T {
    // Destroyed and not-yet-loaded are both "no engine state", but they are not
    // the same instruction to the caller: one says "load first", the other says
    // "this instance is gone, build a new one". Reporting `NOT_LOADED` after
    // `destroy()` would invite exactly the retry that cannot work, because
    // `attachMode` refuses to attach to a destroyed engine.
    if (this.destroyed) {
      throw new PageFlipError(
        `${what} not available: this PageFlip instance was destroyed`,
        'DESTROYED',
      );
    }
    if (value === null) {
      throw new PageFlipError(`${what} not available (loadFromHTML first)`, 'NOT_LOADED');
    }
    return value;
  }

  private get renderOrThrow(): Render {
    return this.requireLoaded(this.render, 'render');
  }

  private get pagesOrThrow(): PageCollection {
    return this.requireLoaded(this.pages, 'page collection');
  }

  private get uiOrThrow(): UI {
    return this.requireLoaded(this.ui, 'UI');
  }

  /**
   * Swap the page collection in place, keeping the current UI and render.
   *
   * @internal Wiring seam. Not part of the supported API; it may change in a
   * minor release.
   */
  public replacePages(pages: PageCollection, current: number): void {
    if (this.destroyed) return;

    const render = this.renderOrThrow;

    // L5: collection-replacing paths claim a generation so a stale async
    // attach cannot destroy the collection just installed.
    this.nextGeneration();

    // An in-flight turn belongs to the OLD collection. `finishAnimation()`
    // would COMMIT it — running `onAnimateEnd` against pages that are about to
    // be destroyed — so it is abandoned instead, along with the fold state and
    // the renderer's transient page references.
    render.cancelAnimation();
    this.flipController?.abandon();
    this.resetUserGesture();

    // What the consumer last observed, read BEFORE the outgoing collection is
    // torn down. `resolvedPageIndex` because an emptied collection keeps its
    // stale index while the public getter already reports 0.
    const outgoing = this.resolvedPageIndex(this.pages);

    this.pagesOrThrow.destroy();
    this.pages = pages;
    this.pages.load();

    // `show()` silently returns for an out-of-range index, so a shrinking
    // update used to leave the render holding pages from the old collection
    // while both events reported the rejected index. Clamp, then report what
    // the collection actually settled on.
    const pageCount = pages.getPageCount();
    const target = pageCount === 0 ? 0 : Math.min(Math.max(current, 0), pageCount - 1);

    // ADR 0003: inherit where the book already WAS — `outgoing`, captured above
    // before the swap — not `current`, which is where the caller is asking it
    // to GO. Seeding the destination makes the guard compare 4 against 4 and
    // stay silent through a real 2 -> 4 move: the fix would have suppressed the
    // very event it exists to keep honest.
    this.pages[INHERIT_PAGE_INDEX](outgoing);

    if (pageCount === 0) {
      // Same hole as `updateFromHtml`: `show()` returns early for any index on
      // an empty collection, so the renderer would keep its references into the
      // collection just destroyed.
      render.releasePages();
    } else {
      this.pages.show(target);
    }

    this.dispatchPagesChanged(
      this.resolvedPageIndex(this.pages),
      pageCount,
      render.getOrientation(),
    );
  }

  /**
   * Wire UI + render + pages after construction.
   *
   * @internal Wiring seam for HTML load and any future renderer. Not part of
   * the supported API; it may change in a minor release. Use `loadFromHTML`.
   */
  public attachMode(ui: UI, render: Render, pages: PageCollection): void {
    // Mode attachment is the boundary a stale async load must not cross.
    this.nextGeneration();

    if (this.destroyed) {
      ui.destroy();
      render.stop();
      return;
    }
    // Replace any previous mode wholesale so a second load cannot leave the
    // old UI listening on the host element. The collection goes too: it was
    // simply overwritten below, so a second load leaked every page it held.
    // ADR 0003, read BEFORE the outgoing collection is destroyed. A RELOAD is
    // still a collection replacement as far as the consumer is concerned: the
    // book was on page 4 and the fresh collection starts at 0, so without this
    // a reload to `startPage: 0` moved the visible index 4 -> 0 with no `flip`,
    // while a reload to `startPage: 4` announced `flip(4)` for a book that had
    // not moved at all. Both directions wrong, from the same missing baseline.
    //
    // `this.pages` is null on the very first load, which is the case that
    // SHOULD start at 0 — a book with no previous index has not moved.
    // An EMPTY outgoing collection counts as a first load. `clear()` does not
    // null `this.pages` — `PageCollection` is emptied in place and keeps the
    // index it held when it was full — so `=== null` alone sent a reload after
    // a clear down the reload branch, where `outgoing` is the placeholder 0
    // that `resolvedPageIndex` returns for an empty collection. The guard then
    // announced `flip(4)` before `init`: C2 again, one path over.
    //
    // The rule the condition states: a book with no pages is not a book the
    // reader was on, so there is no index to carry across.
    const isFirstLoad = this.pages === null || this.pages.getPageCount() === 0;
    const outgoing = this.pages === null ? 0 : this.resolvedPageIndex(this.pages);

    this.ui?.destroy();
    this.render?.stop();
    this.pages?.destroy();
    // Y1: the last collection-replacing path that had not opted into L6.
    // `replacePages` and `updateFromHtml` both drop the gesture before they
    // swap; this one did not, so a gesture in progress survived into a book
    // that no longer contains the page it was anchored on, and the next
    // `userMove` past the 5 px threshold folded the NEW collection with no
    // `startUserTouch` for it.
    //
    // For a gesture the UI owns this is belt-and-braces — `ui.destroy()` above
    // ends up in `UI.cancelGesture()`, which unwinds `isUserTouch` — and the
    // test below records that honestly. It is NOT belt-and-braces for input
    // driven through the public `startUserTouch` / `userMove` / `userStop`
    // surface (a custom input layer, a synthetic gesture), which reaches these
    // fields without any UI knowing, nor for the first `attachMode` of all,
    // where there is no previous UI to cancel anything.
    this.resetUserGesture();

    // …and the same argument, one level up: the outgoing TURN goes with the
    // outgoing collection, unconditionally.
    //
    // Y1 above drops the gesture. This drops the turn, and it is the same hole
    // one field over: `replacePages`, `updateFromHtml` and `clear` all abandon,
    // while this path leaned on `ui.destroy()` → `cancelGesture()`, which only
    // fires while a POINTER is down. A programmatic turn has none — so an
    // instant turn whose `changeState('flipping')` listener calls
    // `loadFromHTML()` resumed after the swap and applied its old
    // `pendingTarget` through `getPageCollection()`, which by then is the NEW
    // collection.
    //
    // Measured: `flip(5)` with `flippingTime: 0` and a listener swapping in a
    // four-page book threw `Invalid spread index 4 (have 4)` straight out of
    // the animation callback — a destination computed for a book that no longer
    // exists, applied to one that does.
    this.flipController?.abandon();

    this.ui = ui;
    this.render = render;
    this.flipController = new Flip(render, this);
    pages[INHERIT_PAGE_INDEX](outgoing);
    this.pages = pages;
    pages.load();
    render.start();

    // I13: same clamp-then-report-resolved contract as `replacePages` /
    // `updateFromHtml`. `show()` silently returns for an out-of-range index, so
    // `startPage: 99` on a 4-page book left the book on page 0 while `init`
    // announced page 99 — a consumer seeding its state from `init` starts
    // desynced. Clamping also keeps `Render` from being left with no pages set
    // at all, which is what "silently returns" costs on the render side.
    const pageCount = pages.getPageCount();
    const start = resolveStartPage(pages, pageCount, this.setting.initialPage);

    // C2. `outgoing` is 0 for a first load, on the reasoning that a book with
    // no previous index has not moved. True — but the book does not OPEN at 0,
    // it opens at `start`, so the guard compared 0 against the head of the
    // opening spread and announced `flip(4)` for a mount nobody had touched.
    //
    // And it announced it BEFORE `init`, which is dispatched from the timer
    // below. ADR 0003 makes `init` the seeding event, so a consumer's `init`
    // handler ran after the `flip` it was supposed to be the baseline for —
    // the desync is silent. NOT reachable through this repo's own React
    // binding, which mounts with `loadFromHTML([])` and honours `startPage`
    // with its own `turnToPage` — stated because the first version of this
    // comment claimed it was, and an unverified claim about a consumer is the
    // kind that outlives the code. This is a fix for direct core consumers.
    //
    // Only the first load. A RELOAD keeps `outgoing`: there the index really
    // can move, and the guard is right to say so.
    if (isFirstLoad) pages[SEED_OPENING_INDEX](start);

    pages.show(start);

    // D17. SYNCHRONOUS, and `ready` / `loaded` rather than `init`.
    //
    // `init` named a moment this engine has two of: it fired per LOAD, so a
    // reload emitted a second one indistinguishable from the first, and a
    // consumer seeding state from it was re-seeded by every `loadFromHTML`.
    //
    // It was also scheduled on `setTimeout(…, 1)`, which made it a RACE in the
    // React binding — that binding loads an empty book and adds pages in a
    // later effect, so whether `init` described the real book or an empty one
    // depended on timer ordering. `ui.update()` is what the timer was actually
    // waiting for; calling it directly is the same thing without the race.
    //
    // And it carried no `pageCount`, so it could not render "page 1 of N".
    // Both events now carry the full snapshot.
    ui.update();

    // Read the resolved index HERE, not at `show()` time. It is not the clamped
    // request either — in landscape `show(1)` settles on spread [0, 1], whose
    // canonical index is 0 — and `ui.update()` above can still change the
    // orientation (the host is often measured only after the load), which
    // re-resolves the spread. What the book actually shows is the only version
    // a consumer can trust.
    const snapshot: BookSnapshot = {
      page: this.resolvedPageIndex(this.pages),
      pageCount: pages.getPageCount(),
      orientation: render.getOrientation(),
    };

    if (!this.readyAnnounced) {
      this.readyAnnounced = true;
      this.dispatch('ready', snapshot);
    }

    this.dispatch('loaded', snapshot);
  }

  /** Claim the next generation; the caller's continuation must still match it. */
  private nextGeneration(): number {
    this.loadGeneration += 1;
    return this.loadGeneration;
  }

  /**
   * Canvas mode was removed in 3.0.0 (ADR 0002).
   *
   * Always rejects with `CANVAS_REMOVED` unless the engine is already
   * destroyed, in which case it is a safe no-op like other mutating lifecycle
   * calls. Use `loadFromHTML` with `<img>` elements instead — see MIGRATION.md.
   */
  public loadFromImages(_leaves?: unknown): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    return Promise.reject(
      new PageFlipError(
        'Canvas mode was removed in 3.0.0. Use loadFromHTML with <img> elements instead. See MIGRATION.md.',
        'CANVAS_REMOVED',
      ),
    );
  }

  /**
   * Canvas mode was removed in 3.0.0 (ADR 0002). See {@link PageFlip.loadFromImages}.
   */
  public updateFromImages(_leaves?: unknown): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    return Promise.reject(
      new PageFlipError(
        'Canvas mode was removed in 3.0.0. Use loadFromHTML with <img> elements instead. See MIGRATION.md.',
        'CANVAS_REMOVED',
      ),
    );
  }

  /**
   * Load pages from HTML elements on the HTML mode
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    // L1: `attachMode` refuses to attach to a destroyed engine, so this used to
    // "work" — but only after `new HTMLUI(...)` had built the
    // `.stf__parent`/`.stf__wrapper`/`.stf__block` shell, ADOPTED the caller's
    // page nodes into the block and called `setHandlers()`. The teardown then
    // handed those nodes back to the HOST element, not to the parent they came
    // from, so a load on a dead engine silently relocated consumer-owned DOM.
    // Under React that reparenting is the `NotFoundError` class of failure.
    // Guard before anything is constructed, exactly as `updateFromHtml` and
    // `replacePages` do.
    if (this.destroyed) return;

    this.nextGeneration();

    const ui = new HTMLUI(this.block, this, this.setting, items);
    const render = new HTMLRender(this, this.setting, ui.getDistElement());
    const pages = new HTMLPageCollection(this, render, ui.getDistElement(), items);
    this.attachMode(ui, render, pages);
  }

  /**
   * Update current pages from HTML
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    // P1: `replacePages` opens with this guard; this path — the one the React
    // binding actually uses — never got it. A late effect or an async consumer
    // calling it after `destroy()` rebuilt the collection, and `updateItems`
    // ends in `setHandlers()`, so a destroyed engine re-attached its own
    // pointer listeners and retained a fresh book.
    if (this.destroyed) return;

    const ui = this.uiOrThrow;

    // Non-HTML UI (none today; kept for a future renderer) cannot adopt HTML
    // page nodes. Load via the matching entry point instead of updating across
    // renderers.
    if (!(ui instanceof HTMLUI)) {
      throw new PageFlipError(
        'updateFromHtml requires HTML mode; use loadFromHTML to switch modes.',
        'WRONG_MODE',
      );
    }

    this.nextGeneration();
    const render = this.renderOrThrow;
    const previous = this.pagesOrThrow;
    // PF3: `resolvedPageIndex`, not `getCurrentPageIndex()`.
    // `PageCollection.destroy()` empties the page array but leaves
    // `currentPageIndex` where it was, so a `clear()` — which announces page 0
    // to the consumer — followed by `updateFromHtml(pages)` carried the index
    // of the emptied collection into the new book and opened it on the page
    // `clear()` had just said it was no longer on. This helper exists for
    // exactly that and every other index-reporting path here already uses it.
    const current = this.resolvedPageIndex(previous);

    // P2 / I9: an in-flight turn belongs to the OLD collection, and
    // `finishAnimation()` would COMMIT it — running `onAnimateEnd` against
    // pages about to be destroyed. `replacePages` has cancelled it since G10;
    // this path did not, so a drag interrupted by an update left the state at
    // `USER_FOLD` with a calc still holding `flippingPage` / `bottomPage` from
    // the destroyed collection, and the next pointer move went on folding pages
    // that were no longer in the book.
    render.cancelAnimation();
    this.flipController?.abandon();
    this.resetUserGesture();

    // CAPTURED BEFORE `destroy()`, which empties the collection in place — the
    // same property C2 turned on. Asking afterwards returns 0 for EVERY
    // replacement, so a live content refresh jumped back to `initialPage` and
    // the seed suppressed the `flip` for that real, visible move.
    const wasEmpty = previous.getPageCount() === 0;

    previous.destroy();

    const pages = new HTMLPageCollection(this, render, ui.getDistElement(), items);
    this.pages = pages;

    // NF2. ADOPT BEFORE LOADING, and the order is the whole fix.
    //
    // `HTMLUI.adopt` snapshots which engine classes a leaf ALREADY carried, so
    // that `destroy()` hands back a node the consumer authored rather than
    // stripping a `--hard` they wrote themselves. `pages.load()` constructs the
    // `HTMLPage`s, and their constructor stamps `stf__item` and `--soft` /
    // `--hard` onto each element — so running it first meant `adopt` recorded
    // the engine's OWN classes as pre-existing, and release then refused to
    // remove them.
    //
    // Measured: a fresh element handed to `updateFromHtml` still read
    // `class="my-page stf__item --soft"` after `destroy()`, where a leaf present
    // at the initial load cleans to `class=""`. That is U1 again, on the one
    // path the React binding uses for EVERY page it adds — so a book that grows
    // a page leaks engine classes onto the consumer's node for the life of the
    // document.
    //
    // Safe to reorder: `load()` reads only `dataset.density` off each element
    // and stamps classes onto it. It never inspects the node's parent, and the
    // collection was handed `ui.getDistElement()` at construction above, which
    // exists either way.
    ui.updateItems(items);
    pages.load();
    render.reload();

    // Same clamp-then-report-resolved contract as `replacePages`. `show()`
    // silently returns for an out-of-range index, so a shrinking update used to
    // leave `Render` holding left/right references into the collection that was
    // just destroyed, while both events reported the index carried in from it.
    // Report where the book actually landed — which is not the clamped
    // *request* either: in landscape `show(3)` settles on spread [2, 3], whose
    // canonical index is 2.
    const pageCount = pages.getPageCount();
    // C7 / D17. Filling an EMPTY book is an opening, not a turn.
    //
    // The React binding mounts with `loadFromHTML([])` and adds pages in a
    // later effect, so `initialPage` — read only by `attachMode` — never
    // applied, and the binding compensated with its own `turnToPage`, which
    // ANNOUNCES. An uncontrolled `<HTMLFlipBook initialPage={1}>` therefore
    // fired `onPageChange` on mount, which is ADR 0003's defect one layer up.
    //
    // An empty outgoing collection is the same "no reader was anywhere" case
    // `attachMode` already treats as a first load, so it gets the same
    // treatment: honour `initialPage`, and seed the baseline so the guard stays
    // silent.
    const openingFresh = wasEmpty && pageCount > 0;
    const requested = openingFresh
      ? resolveStartPage(pages, pageCount, this.setting.initialPage)
      : current;
    const target = pageCount === 0 ? 0 : Math.min(Math.max(requested, 0), pageCount - 1);

    if (pageCount === 0) {
      // `show()` returns early for ANY index on an empty collection, so
      // nothing re-seeds the renderer and it keeps painting left/right pages
      // belonging to the collection just destroyed. `reload()` does not help —
      // it only recreates the shadow elements.
      render.releasePages();
    } else {
      if (openingFresh) pages[SEED_OPENING_INDEX](target);
      else pages[INHERIT_PAGE_INDEX](current);

      pages.show(target);
    }

    this.dispatchPagesChanged(
      this.resolvedPageIndex(this.pages),
      pageCount,
      render.getOrientation(),
    );
  }

  /**
   * Merge settings at runtime. Input handlers rebind when `pointerInput`
   * changes; layout is recalculated for portrait / sizing updates.
   *
   * D19. Typed `LiveSetting`, so passing `hardCovers` or `initialPage` is a
   * COMPILE error rather than a runtime `console.warn` naming a method the
   * consumer did call. The runtime refusal below stays for JavaScript callers
   * and for anyone handing a whole settings object back in.
   */
  public updateSettings(partial: Partial<LiveSetting>): FlipSetting {
    // L4: `showCover` is baked into `PageCollection` when the spreads are
    // created and `startPage` is read once, in `attachMode` — neither is read
    // again, so merging a new value changed nothing except what `getSettings()`
    // reports. That is the `swipeDistance` bug in reverse: there the engine
    // ignored a live setting, here `getSettings()` lied about a dead one.
    //
    // Not a throw: passing a whole settings object back through
    // `updateSettings` is plausible usage, and turning a silent no-op into an
    // exception would break those callers for a value they may not even have
    // meant to change. So the value is refused (kept out of `this.setting`, so
    // the getter stays honest about what is actually in force) and reported
    // once, and only when it actually DIFFERS — echoing back the current value
    // is not a mistake and must stay silent.
    const asAny = partial as Partial<FlipOptions>;
    const refused = CONSTRUCTION_TIME_SETTINGS.filter(
      (key) =>
        key in asAny &&
        asAny[key] !== undefined &&
        (asAny[key] as unknown) !== (this.setting[key] as unknown),
    );
    const effective: Partial<FlipOptions> = { ...partial };

    if (refused.length > 0) {
      for (const key of refused) delete effective[key];
      console.warn(
        `[flipbook] updateSettings ignored construction-time setting(s): ${refused.join(', ')}. ` +
          'These are read once when the book is built; rebuild the PageFlip instance to change them.',
      );
    }

    const nextAuthored: FlipOptions = { ...this.authored, ...effective };
    const next = new Settings().resolve(nextAuthored);
    const mouseChanged =
      next.pointerInput.length !== this.setting.pointerInput.length ||
      next.pointerInput.some((k, i) => k !== this.setting.pointerInput[i]);
    const foldInvalidated = FOLD_INVALIDATING_SETTINGS.some(
      (key) => (next[key] as unknown) !== (this.setting[key] as unknown),
    );
    this.authored = nextAuthored;
    Object.assign(this.setting, next);

    // A changed geometry setting settles an in-flight fold before applying.
    //
    // These are read live in two places that update at different moments.
    // `PageCollection.showSpread` re-mirrors the STATIC spread on the next
    // `update()`, which is immediate. The FOLD does not: `Render.direction` is
    // the geometric side, stamped once per turn by `Render.setDirection`, and
    // `FlipCalculation` is built from that same stamp — both frozen at turn
    // start so the mirror is applied exactly once and cannot drift mid-turn.
    //
    // Toggling `direction` during a turn therefore split the book in half:
    // begin an LTR landscape `flipNext()`, then flip to `rtl` after the first
    // frame, and the resting pages swap sides instantly while the curl,
    // the underside, the shadow gradients and the z-order stay LTR until the
    // animation ends and snaps. Two readings on screen at once. Resizing the
    // book mid-turn splits it the same way, in the other axis: the static
    // leaves take the new page width while the curl keeps the old one.
    //
    // Freezing the static side to match the fold would be the other repair,
    // and it is the wrong one: it makes a public setting silently not take
    // effect for as long as a gesture is held, which is the `swipeDistance`
    // failure this repo already fixed once. So the fold yields instead — you
    // cannot change which edge a book binds on halfway through turning a page.
    // `cancelAnimation()` + `abandon()` is the same pair every other
    // state-invalidating path uses (`replacePages`, `clear`, `destroy`).
    //
    // `abandon()` emits `changeState`, so a listener may destroy from inside
    // it; the check below is why this sits ABOVE the RE-3 hoist rather than
    // beside `update()`.
    if (foldInvalidated && this.render !== null) {
      this.render.cancelAnimation();
      this.flipController?.abandon();
      this.resetUserGesture();

      if (this.destroyed) return this.setting;
    }

    // updateSettings can run before create() wires render/ui (React effects).

    // RE-3. HOISTED, because the line between these two DISPATCHES.
    //
    // `refreshHandlers()` -> `removeHandlers()` -> `UI.cancelGesture()` ->
    // `flip.abandon()` emits `changeState`, and `pages.show()` emits `flip`. A
    // listener on either that calls `destroy()` nulls `this.ui`, and the next
    // line used to dereference it — measured with a real pointerdown/pointermove
    // followed by `updateSettings({ useMouseEvents: false })`:
    //
    //   TypeError: Cannot read properties of null (reading 'applyHostSize')
    //
    // Not a `PageFlipError`, and it unwound out of a public method the destroy
    // contract lists as a safe no-op. `applyHostSize` on a UI that has already
    // been torn down is harmless — it writes styles to an element the teardown
    // has finished with — so holding the reference is the fix rather than
    // re-checking, and it matches `if (this.render)` below, which survives only
    // because `update()` happens to use optional chaining.
    const ui = this.ui;

    if (ui) {
      if (mouseChanged) {
        ui.refreshHandlers();
      }

      // …but the hoist only makes the reference SAFE to hold, not correct to
      // use. `refreshHandlers()` dispatches, and a listener calling `destroy()`
      // runs `UI.destroy()`, which hands the consumer's host back with its
      // original styles restored. Calling `applyHostSize` afterwards stamps the
      // engine's sizing straight back onto a host the engine no longer owns —
      // trading a `TypeError` for a silent ownership violation, which is worse.
      // Destroyed is the end of the line: there is no host left to own.
      if (this.destroyed) return this.setting;

      // REPLACED is not the same as destroyed, and conflating them left the new
      // UI unsized. A listener may re-enter and LOAD, which builds a fresh UI;
      // the old UI's `destroy()` then restores its host-style snapshot — over
      // the new UI's sizing, because it runs second. Returning here left the
      // book with the pre-engine `minWidth`/`minHeight` and no way back short
      // of another `updateSettings`.
      //
      // So stamp the CURRENT owner rather than the one captured on entry. The
      // captured `ui` must not be touched (that is the ownership violation
      // above), but the engine's live UI both wants this sizing and is the only
      // thing entitled to write it.
      const owner = this.ui;
      if (owner === null) return this.setting;

      // Size-shaped settings are stamped onto the host element, so a changed
      // `width` / `height` / `size` has to be restamped here. Otherwise the
      // only way to resize a book is to rebuild the engine.
      owner.applyHostSize(this.setting);
    }

    if (this.render) {
      this.update();
    }
    return this.setting;
  }

  /**
   * Clear pages from HTML (remove to initinalState)
   */
  public clear(): void {
    // PF2: resolve every piece of engine state FIRST, and only then claim the
    // generation. `nextGeneration()` used to run before `uiOrThrow`, so a
    // `clear()` that then threw `NOT_LOADED` had ALREADY invalidated an in-
    // flight load. An operation that cannot proceed must not invalidate the
    // one that can.
    const ui = this.uiOrThrow;
    const render = this.renderOrThrow;
    const pages = this.pagesOrThrow;

    this.nextGeneration();

    // L2: a load schedules `init` on a 1 ms timer, and only another
    // `attachMode` used to invalidate it. `loadFromHTML(pages)` immediately
    // followed by `clear()` therefore still announced `init` a millisecond
    // later — and since `PageCollection.destroy()` does not reset
    // `currentPageIndex`, it announced a NON-ZERO page for a book that no
    // longer has any pages. There is nothing left to initialise; drop it.

    // EVERY DESTRUCTIVE STEP FIRST, THEN THE ANNOUNCEMENTS.
    //
    // `abandon()` announces READ, and outside `destroy()` a listener error is
    // still thrown synchronously — deliberately, so `try { … } catch` around a
    // public method keeps working. It used to sit in the MIDDLE of this
    // sequence, so a throwing `changeState('read')` listener aborted `clear()`
    // before `HTMLUI.clear()` ran and before either collection event was
    // emitted. Measured against the built engine: `pageCount: 0` reported, six
    // leaves still parented to `.stf__block`, none handed back to the host, and
    // no `update` or `collectionRebuild` — a half-cleared book that every
    // listener still believes is whole.
    //
    // L8's rule is "cleanup must complete". `destroy()` gets there by deferring
    // errors; here ordering achieves it without touching the synchronous
    // contract, which is the better trade for a method the engine survives.
    pages.destroy();
    // Emptying the collection is not enough: the renderer holds its own
    // left/right/flipping/bottom references, so the rAF loop went on painting
    // the pages that had just been discarded.
    render.releasePages();
    this.resetUserGesture();
    // HTML mode only today; `instanceof` stays so a future non-HTML UI is not
    // cast blindly (WRONG_MODE family — same guard as updateFromHtml).
    if (ui instanceof HTMLUI) ui.clear();

    this.flipController?.abandon();

    // L3: `clear()` emptied the book and told nobody. `updateFromHtml` and
    // `replacePages` both end with the clamp-then-report-resolved pair, and
    // emptying is just the pageCount === 0 case of the same operation — the one
    // path neither covered. A consumer rendering "page 3 of 12" had no signal
    // at all that the book was gone. Same two events, same shape, so a listener
    // needs no special case: `update` because what is rendered changed,
    // `collectionRebuild` because the collection did. Not `flip` (no turn
    // happened) and not `init` (the book is not becoming ready).
    this.dispatchPagesChanged(0, 0, render.getOrientation());
  }

  /**
   * Turn to the previous page (without animation)
   */
  public turnToPrevPage(): void {
    this.pagesOrThrow.showPrev();
  }

  /**
   * Turn to the next page (without animation)
   */
  public turnToNextPage(): void {
    this.pagesOrThrow.showNext();
  }

  /**
   * Turn to the specified page number (without animation)
   *
   * @param {number} page - New page number
   */
  public turnToPage(page: number): void {
    const pages = this.pagesOrThrow;

    if (page < 0 || page >= pages.getPageCount()) {
      throw new PageFlipError(`Invalid page: ${page}`, 'INVALID_PAGE');
    }
    if (pages.getSpreadIndexByPage(page) === null) {
      throw new PageFlipError(`Page ${page} not in spread`, 'PAGE_NOT_IN_SPREAD');
    }

    pages.show(page);
  }

  /**
   * Turn to the next page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipNext(corner: FlipCorner = FlipCorner.TOP): boolean {
    return this.requestTurn((flip) => flip.flipNext(corner), {
      direction: 'next',
      targetPage: null,
    });
  }

  public flipPrev(corner: FlipCorner = FlipCorner.TOP): boolean {
    return this.requestTurn((flip) => flip.flipPrev(corner), {
      direction: 'prev',
      targetPage: null,
    });
  }

  /**
   * Run a relative turn and report a *refusal* as a boolean rather than a throw.
   *
   * `flipNext` / `flipPrev` are the "turn if you can" API — the browser calls
   * them from a swipe or an arrow key, where there is nobody to catch. A turn
   * the engine declines is `false` plus a `turnRejected` event. A failure that
   * is not the engine's own still propagates: hiding a broken renderer behind
   * "the page would not turn" is the same silent failure in a different place.
   *
   * Explicit navigation (`turnToPage` / `flip`) throws instead, because asking
   * for a specific page and landing elsewhere is the §4.6 bug this fork fixes.
   */
  /**
   * A click that lands on the book.
   *
   * Unlike `flipNext` / `flipPrev` this turn can be refused by policy, and a
   * refused click used to be silent: `userStop` discarded the boolean, so
   * `turnRejected` fired only for programmatic turns. That is half a contract
   * — the event exists to say "your turn was refused", and being clicked is
   * the most common way a turn gets refused. `reason: 'disabled'` was declared
   * in the public event type and emitted by nothing at all.
   *
   * The `disableFlipByClick` check lives here rather than in `Flip.flip`
   * because it is a policy about *clicks*, and only this path has one.
   */
  private requestUserTurn(pos: Point): void {
    const flip = this.flipController;

    // All three states, and `'never'` was the point of the rename: the old
    // `disableFlipByClick` could not express "drag and swipe only" because its
    // `true` still flipped on a corner. Advertising the state and then falling
    // through to the turn would have been the same defect with a better name.
    const policy = this.setting.flipOnClick;

    if (policy === 'never') {
      this.dispatch('turnRejected', { reason: 'disabled', direction: null, targetPage: null });
      return;
    }

    if (flip !== null && policy === 'corners' && !flip.isPointOnCorners(pos)) {
      this.dispatch('turnRejected', { reason: 'disabled', direction: null, targetPage: null });
      return;
    }

    // Falls through to `requestTurn` when there is no controller yet, so a
    // click before load reports `NOT_LOADED` like every other turn does.
    // A click has no declared direction — the engine picks one from the point.
    this.requestTurn((f) => f.flip(pos), { direction: null, targetPage: null });
  }

  /**
   * D16. `context` carries what the refusal has to be able to say.
   *
   * The canonical use for `turnRejected` — the one the README recommends it
   * for — is disabling a next/prev button at a boundary, and `reason:
   * 'boundary'` alone cannot tell a consumer WHICH button. Re-deriving it from
   * the engine is rejected alternative (d) of ADR 0003 in a new place.
   */
  private requestTurn(
    run: (flip: Flip) => boolean,
    context: { direction: 'next' | 'prev' | null; targetPage: number | null },
  ): boolean {
    const flip = this.flipController;

    if (flip === null) {
      // Same distinction `requireLoaded` draws: "not loaded yet" is a retry,
      // "destroyed" never will be.
      this.dispatch('turnRejected', {
        ...context,
        reason: 'notReady',
        code: this.destroyed ? 'DESTROYED' : 'NOT_LOADED',
      });
      return false;
    }

    let started: boolean;

    // Only the turn is guarded. Emitting `turnRejected` must stay outside, or a
    // listener that throws `PageFlipError` would be misread as an engine setup
    // failure and re-emitted — a listener recursing into its own event.
    try {
      started = run(flip);
    } catch (err: unknown) {
      // Only the engine's own typed failures (a corrupt spread, an index
      // guard) become a rejection. Anything else — a TypeError from the
      // renderer — is a real defect, and swallowing it into a silent `false`
      // would hide it from the consumer and from us.
      if (!(err instanceof PageFlipError)) throw err;

      this.dispatch('turnRejected', { ...context, reason: 'setup', code: err.code });
      return false;
    }

    if (started) return true;

    // `boundary` used to be hard-coded here, on the reasoning that the only way
    // a relative turn can be refused is that there is no spread that way. There
    // is a second way — a `flip` listener started its own turn while this one
    // was finishing the outgoing animation, and that later turn wins (see
    // `Flip.finishOutgoingTurn`). Reporting that as `boundary` tells a consumer
    // the book is at its end while it is mid-turn, which is the shape of
    // failure that disables "next" buttons.
    this.dispatch('turnRejected', { ...context, reason: flip.takeRefusal() });
    return false;
  }

  /**
   * Turn to the specified page number (with animation)
   *
   * @param {number} page - New page number
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flip(page: number, corner: FlipCorner = FlipCorner.TOP): void {
    // Explicit navigation fails loudly, exactly like `turnToPage`. Optional
    // chaining here made "animate to page 7" a silent no-op before load — the
    // §4.6 failure this fork exists to remove.
    this.requireLoaded(this.flipController, 'flip controller').flipToPage(page, corner);
  }

  /**
   * Call a state change event trigger
   *
   * See {@link EMIT_STATE}. Symbol-keyed, because `@internal` on a `public`
   * member is documentation, not a fence: it survives into the emitted `.d.ts`
   * and a consumer can call it.
   *
   * @param {FlippingState} newState - New  state of the object
   */
  public [EMIT_STATE](newState: FlippingState): void {
    this.dispatch('changeState', { state: newState });
  }

  /**
   * Call a page number change event trigger
   *
   * @internal Wiring seam for `PageCollection`. It only EMITS — it does not
   * move the book — so calling it from outside fabricates a `flip` event for a
   * page the reader is not on, which is exactly what a controlled `page` prop
   * binding acts on. Use `turnToPage` / `flipToPage` to actually navigate.
   *
   * @param {number} newPage - New page Number
   */
  public [EMIT_PAGE_INDEX](newPage: number): void {
    this.dispatch('flip', {
      page: newPage,
      pageCount: this.pages === null ? 0 : this.pages.getPageCount(),
      orientation: this.renderOrThrow.getOrientation(),
    });
  }

  /**
   * Call a page orientation change event trigger. Update UI and rendering area
   *
   * See {@link ADOPT_ORIENTATION}. Symbol-keyed for the same reason as the
   * other engine seams: `@internal` on a `public` member is a comment, not a
   * boundary.
   *
   * @param {Orientation} newOrientation - New page orientation (portrait, landscape)
   */
  public [ADOPT_ORIENTATION](newOrientation: Orientation): void {
    this.uiOrThrow[SET_ORIENTATION_STYLE](newOrientation);
    this.update();
    this.dispatch('changeOrientation', { orientation: newOrientation });
  }

  /**
   * Get the total number of pages in a book
   *
   * @returns {number}
   */
  public getPageCount(): number {
    return this.pagesOrThrow.getPageCount();
  }

  /**
   * Get the index of the current page in the page list (starts at 0)
   *
   * @returns {number}
   */
  public getCurrentPageIndex(): number {
    // `pagesOrThrow` first: an empty book still reports 0, but a destroyed or
    // never-loaded one must still throw rather than answer.
    return this.resolvedPageIndex(this.pagesOrThrow);
  }

  /**
   * Get page from collection by number
   *
   * @param {number} pageIndex
   * @returns {Page}
   */
  public getPage(pageIndex: number): Page {
    return this.pagesOrThrow.getPage(pageIndex);
  }

  /**
   * Get the current rendering object.
   *
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML`.
   * @returns {Render}
   */
  public getRender(): Render {
    return this.renderOrThrow;
  }

  /**
   * Get current object responsible for flipping
   *
   * @returns {Flip} `null` until `loadFromHTML` runs.
   */
  public getFlipController(): Flip | null {
    return this.flipController;
  }

  /**
   * Get current page orientation
   *
   * @returns {Orientation} Сurrent orientation: portrait or landscape
   */
  public getOrientation(): Orientation {
    return this.renderOrThrow.getOrientation();
  }

  /**
   * Get current book sizes and position
   *
   * @returns {PageRect}
   */
  public getBoundsRect(): PageRect {
    return this.renderOrThrow.getRect();
  }

  /**
   * Get configuration object
   *
   * @returns {FlipSetting}
   */
  public getSettings(): FlipSetting {
    return this.setting;
  }

  /**
   * Get UI object.
   *
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML`.
   * @returns {UI}
   */
  public getUI(): UI {
    return this.uiOrThrow;
  }

  /**
   * Get current flipping state
   *
   * @returns {FlippingState}
   */
  public getState(): FlippingState {
    return this.flipController?.getState() ?? FlippingState.READ;
  }

  /**
   * Get page collection.
   *
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML`.
   * @returns {PageCollection}
   */
  public getPageCollection(): PageCollection {
    return this.pagesOrThrow;
  }

  /**
   * Forget the pointer gesture in progress (L6).
   *
   * `Flip.abandon()` drops the fold *the controller* owns; `isUserTouch` /
   * `isUserMove` / `mousePosition` are owned here and were left as they were
   * across a collection swap. The pointer is still physically down — the swap
   * came from a React re-render or an async page fetch, not from the user
   * lifting a finger — so the next `userMove` past the 5 px threshold called
   * `fold()` against the NEW collection with no `startUserTouch` for it and an
   * anchor measured in the book that no longer exists.
   *
   * Dropping the gesture is the honest answer rather than re-anchoring it: the
   * book under the finger was replaced, so there is no turn the user can be
   * said to have started. The next `pointerdown` starts a fresh one.
   */
  private resetUserGesture(): void {
    this.isUserTouch = false;
    this.isUserMove = false;
    this.mousePosition = { x: 0, y: 0 };

    // C1. The three fields above are only the engine's half. The swipe anchor
    // and the captured pointer live on `UI`, and every one of these five call
    // sites left them set — so a release inside `swipeTimeout` still ran the
    // swipe branch of `onPointerUp`, which gates on that anchor alone and
    // consults none of the flags above. The reader got a turn they had already
    // been abandoned out of, and after a `direction` settle it landed on
    // mirrored geometry, so it was the wrong page too.
    //
    // The docblock above has always said the next `pointerdown` starts a fresh
    // gesture. This is the line that makes that true.
    //
    // Guarded because the FIRST `attachMode` of all has no UI yet. On every
    // later attach `this.ui` is the OUTGOING UI, already destroyed one line
    // up — so the call lands on a dead object and is a provable no-op there,
    // `UI.destroy()` having gone through `removeHandlers()` -> `cancelGesture()`
    // already. Harmless (`releaseCapturedPointer` early-returns on a null id)
    // and left in place rather than special-cased: the value here is that ONE
    // method is the whole answer, which is what stops the next caller getting
    // half of it.
    //
    // It is not redundant for the paths that keep their UI — `replacePages`,
    // `updateFromHtml`, `clear`, the settle — nor for the public
    // `startUserTouch` / `userMove` / `userStop` surface, which a custom input
    // layer can drive without any UI knowing.
    this.ui?.[DROP_POINTER_GESTURE]();
  }

  /**
   * Start page turning. Called when a user clicks or touches
   *
   * @param {Point} pos - Touch position in coordinates relative to the book
   */
  public startUserTouch(pos: Point): void {
    this.mousePosition = pos; // Save touch position
    this.isUserTouch = true;
    this.isUserMove = false;
  }

  /**
   * Called when a finger / mouse moves
   *
   * @param {Point} pos - Touch position in coordinates relative to the book
   * @param {boolean} isTouch - True if there was a touch event, not a mouse click
   */
  public userMove(pos: Point, isTouch: boolean): void {
    if (!this.isUserTouch && !isTouch && this.setting.foldCornerOnHover) {
      this.flipController?.showCorner(pos); // fold Page Corner
    } else if (this.isUserTouch) {
      if (distanceBetween(this.mousePosition, pos) > 5) {
        this.isUserMove = true;
        this.flipController?.fold(pos);
      }
    }
  }

  /**
   * Сalled when the user has stopped touching
   *
   * @param {Point} pos - Touch end position in coordinates relative to the book
   * @param {boolean} isSwipe - true if there was a mobile swipe event
   */
  public userStop(pos: Point, isSwipe = false): void {
    if (this.isUserTouch) {
      this.isUserTouch = false;

      if (!isSwipe) {
        if (!this.isUserMove) this.requestUserTurn(pos);
        else this.flipController?.stopMove();
      }
    }
  }
}
