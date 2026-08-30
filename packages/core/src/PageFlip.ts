/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageCollection } from './Collection/PageCollection';
import { HTMLPageCollection } from './Collection/HTMLPageCollection';
import type { PageRect, Point } from './BasicTypes';
import { Flip, FlipCorner, FlippingState } from './Flip/Flip';
import type { Orientation, Render } from './Render/Render';
import { HTMLUI } from './UI/HTMLUI';
import { distanceBetween } from './Helper';
import type { Page } from './Page/Page';
import { EventObject } from './Event/EventObject';
import type { FlipbookEventMap } from './Event/EventObject';
import { HTMLRender } from './Render/HTMLRender';
import type { FlipSetting } from './Settings';
import { Settings } from './Settings';
import type { UI } from './UI/UI';
import { PageFlipError } from './errors';
// Type-only, so the canvas chunk stays out of the HTML bundle: this names the
// module `loadCanvasModule` resolves at run time, it does not import it.
import type * as CanvasLoader from './canvas-loader';

/**
 * Settings that are consumed once while the book is being built and never read
 * again, so `updateSettings` cannot make them take effect.
 *
 * `showCover` is captured by `PageCollection`'s constructor and decides the
 * spread layout; `startPage` is read only by `attachMode`. Deliberately NOT
 * including `size` / `width` / `height`: `updateSettings` restamps those via
 * `ui.applyHostSize`, so they are live.
 */
const CONSTRUCTION_TIME_SETTINGS = ['showCover', 'startPage'] as const;

/**
 * Class representing a main PageFlip object
 *
 * @extends EventObject
 */
export class PageFlip extends EventObject {
  private mousePosition: Point = { x: 0, y: 0 };
  private isUserTouch = false;
  private isUserMove = false;

  private readonly setting: FlipSetting;
  private readonly block: HTMLElement; // Root HTML Element

  // Nullable, not `!`: these only exist after `loadFromHTML` / `loadFromImages`.
  // The public getters below keep their non-null signatures and throw a typed
  // error instead — a definite-assignment `!` here would hand callers
  // `undefined` and fail as "cannot read properties of undefined" deep in the
  // engine, and widening every getter to `| null` would break every consumer
  // for a state they cannot observe anyway.
  private pages: PageCollection | null = null;
  private flipController: Flip | null = null;
  private render: Render | null = null;

  private ui: UI | null = null;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  /**
   * Bumped by every operation that replaces or tears down the current mode.
   * `loadFromImages` / `updateFromImages` await a dynamic import, so a load
   * started before a newer one could still call `attachMode` afterwards and
   * silently replace the newer mode. A continuation may only act if the
   * generation it captured is still current.
   */
  private loadGeneration = 0;

  /**
   * How many engine-emitted events are currently on the stack.
   *
   * Non-zero means a consumer callback is running inside the engine, so
   * anything that callback does to the engine is RE-ENTRANT: the engine will
   * carry on with the rest of that operation after the callback returns. The
   * one that matters is `destroy()` — see {@link teardownPages}.
   */
  private dispatchDepth = 0;

  /**
   * The emptied collection and the detached UI, kept alive for the remainder of
   * a teardown that happened mid-dispatch. See {@link destroy}.
   */
  private teardownPages: PageCollection | null = null;
  private teardownUi: UI | null = null;

  /**
   * Create a new PageFlip instance
   *
   * @constructor
   * @param {HTMLElement} inBlock - Root HTML Element
   * @param {Object} setting - Configuration object
   */
  constructor(inBlock: HTMLElement, setting: Partial<FlipSetting>) {
    super();

    this.setting = new Settings().getSettings(setting);
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
   *   `false` plus `turnRejected` with `code: 'DESTROYED'`.
   * - Mutating lifecycle calls are safe no-ops: `destroy` itself (a consumer's
   *   cleanup legitimately runs twice), `update`, `updateSettings`,
   *   `replacePages`, `updateFromHtml`, `updateFromImages`.
   * - Always safe: `getSettings`, `getState` (`READ`), `getFlipController`
   *   (`null`), `getBlock`, `isDestroyed`.
   *
   * A destroyed engine is not reusable — `loadFromHTML` / `loadFromImages`
   * after `destroy()` do not revive it. Construct a new `PageFlip`.
   *
   * ## Destroying from inside an event handler (X4)
   *
   * `destroy()` from an `onFlip` handler is the cleanup this whole contract
   * exists to support — a reader that unmounts the book when it reaches the
   * last page — and it was the one path where `'DESTROYED'` was not safe. The
   * render loop's turn completion runs `onAnimateEnd` (which is what emits
   * `flip`) and then draws ONE more frame, unconditionally; the loop is already
   * past the guard `render.stop()` moves. That trailing frame reads engine
   * state back out — `getPageCollection()` in HTML mode, `getUI()` in canvas —
   * so nulling both threw a `PageFlipError` out of the consumer's rAF callback
   * for doing exactly what the docs told them to.
   *
   * The teardown is complete and synchronous either way; what changes is what
   * that one already-scheduled frame finds. When `destroy()` runs re-entrantly
   * (`dispatchDepth > 0`), the emptied collection and the detached UI are kept
   * for the rest of the current task, so the frame finds a **coherent but empty
   * engine**: no pages to iterate, no page references left in the renderer,
   * nothing painted. Everything else — `isDestroyed()`, the released
   * references, the stopped loop, every other guarded accessor — is unchanged
   * and immediate.
   *
   * The window closes on a microtask, which is strictly inside the same task as
   * the rAF callback and therefore before any consumer code that could observe
   * it asynchronously. The deviation is real and deliberately narrow: for the
   * remainder of that one dispatch, `getPageCollection()` and `getUI()` answer
   * with the inert objects rather than throwing.
   *
   * This is a mitigation, not the whole fix. The trailing draw is `Render`'s
   * (`render()` draws after `onAnimateEnd` with no generation check — U6), and
   * only `Render` can decline to draw at all.
   */
  public destroy(): void {
    // X4. Armed BEFORE the teardown, and only when a consumer callback is on
    // the stack: outside a dispatch there is no frame in flight to keep
    // coherent, and arming it unconditionally would weaken the contract for
    // every ordinary teardown. The stand-ins are the same objects the teardown
    // below empties and detaches — that is the point, they end up inert.
    if (this.dispatchDepth > 0) {
      this.teardownPages = this.pages;
      this.teardownUi = this.ui;

      queueMicrotask(() => {
        this.teardownPages = null;
        this.teardownUi = null;
      });
    }

    this.destroyed = true;
    this.cancelPendingInit();
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
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Emit one engine event, recording that a consumer callback is on the stack.
   *
   * Every `trigger` in this class goes through here so the depth cannot drift:
   * a call site that emitted directly would be invisible to `destroy()`, and
   * the one that matters most (`flip`) is emitted from the render loop.
   */
  private dispatch<K extends keyof FlipbookEventMap>(
    eventName: K,
    data: FlipbookEventMap[K],
  ): void {
    this.dispatchDepth += 1;
    try {
      this.trigger(eventName, this, data);
    } finally {
      this.dispatchDepth -= 1;
    }
  }

  /**
   * Drop a scheduled `init`.
   *
   * `init` is a one-shot "the book is ready" announcement, so this is
   * deliberately NOT called from `updateFromHtml` / `replacePages`: those keep
   * the same `ui` and `render` the pending callback closed over, and the
   * callback reads the resolved index when it fires — so a pending `init`
   * simply reports the newer collection, correctly. Cancelling it there would
   * suppress `init` entirely for the React binding, which loads an empty book
   * (`loadFromHTML([])`) and fills it with `updateFromHtml` in the same tick.
   *
   * `clear()` is the opposite case: there is no book left to announce.
   */
  private cancelPendingInit(): void {
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
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
   * @internal Wiring seam for the lazily-loaded canvas mode. Not part of the
   * supported API; it may change in a minor release.
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
      throw new PageFlipError(
        `${what} not available (loadFromHTML/loadFromImages first)`,
        'NOT_LOADED',
      );
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
   * @internal Wiring seam for the lazily-loaded canvas mode. Not part of the
   * supported API; it may change in a minor release.
   */
  public replacePages(pages: PageCollection, current: number): void {
    if (this.destroyed) return;

    const render = this.renderOrThrow;

    // L5: this is a mode-changing path like any other — it throws away the
    // collection the current mode was attached with — so it has to claim a
    // generation too. Without it, a `loadFromImages` / `updateFromImages`
    // whose dynamic import is still in flight still matched the generation it
    // captured, so its continuation ran `attachMode` *after* this and
    // destroyed the collection just installed. That is exactly the class the
    // counter was added to prevent, on the one path that never opted in.
    this.nextGeneration();

    // An in-flight turn belongs to the OLD collection. `finishAnimation()`
    // would COMMIT it — running `onAnimateEnd` against pages that are about to
    // be destroyed — so it is abandoned instead, along with the fold state and
    // the renderer's transient page references.
    render.cancelAnimation();
    this.flipController?.abandon();
    this.resetUserGesture();

    this.pagesOrThrow.destroy();
    this.pages = pages;
    this.pages.load();

    // `show()` silently returns for an out-of-range index, so a shrinking
    // update used to leave the render holding pages from the old collection
    // while both events reported the rejected index. Clamp, then report what
    // the collection actually settled on.
    const pageCount = pages.getPageCount();
    const target = pageCount === 0 ? 0 : Math.min(Math.max(current, 0), pageCount - 1);

    if (pageCount === 0) {
      // Same hole as `updateFromHtml`: `show()` returns early for any index on
      // an empty collection, so the renderer would keep its references into the
      // collection just destroyed.
      render.releasePages();
    } else {
      this.pages.show(target);
    }

    const resolved = this.resolvedPageIndex(this.pages);

    this.dispatch('update', {
      page: resolved,
      mode: render.getOrientation(),
    });
    this.dispatch('collectionRebuild', {
      page: resolved,
      pageCount,
    });
  }

  /**
   * Wire UI + render + pages after construction. Used by HTML load and by the
   * lazily-loaded canvas chunk, so `CanvasRender` stays out of the HTML bundle.
   *
   * @internal Wiring seam. Not part of the supported API; it may change in a
   * minor release. Use `loadFromHTML` / `loadFromImages`.
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
    // simply overwritten below, so a second load or a mode switch leaked every
    // page it held — which for canvas means every decoded image.
    this.ui?.destroy();
    this.render?.stop();
    this.pages?.destroy();

    this.ui = ui;
    this.render = render;
    this.flipController = new Flip(render, this);
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
    pages.show(pageCount === 0 ? 0 : Math.min(Math.max(this.setting.startPage, 0), pageCount - 1));

    this.cancelPendingInit();
    this.initTimer = setTimeout(() => {
      this.initTimer = null;
      if (this.destroyed) return;
      ui.update();
      // Read the resolved index HERE, not at `show()` time. The resolved index
      // is not the clamped request either — in landscape `show(1)` settles on
      // spread [0, 1], whose canonical index is 0 — and `ui.update()` above can
      // still change the orientation (the host is often measured only after the
      // load), which re-resolves the spread. Reporting what the book actually
      // shows when the event fires is the only version a consumer can trust.
      this.dispatch('init', {
        page: this.resolvedPageIndex(this.pages),
        mode: render.getOrientation(),
      });
    }, 1);
  }

  /** Claim the next generation; the caller's continuation must still match it. */
  private nextGeneration(): number {
    this.loadGeneration += 1;
    return this.loadGeneration;
  }

  /**
   * Fetch the canvas chunk for one load, or `null` if that load no longer
   * matters (L7).
   *
   * Both outcomes of the import are judged by the SAME question — "does this
   * load still have a consumer?" — because the old shape asked it only of the
   * success path: the `.catch` that wraps an import failure sat *before* the
   * `destroyed` check, so a consumer who destroyed the engine while the chunk
   * was downloading got a rejected (and, for the common
   * `book.loadFromImages(...)` without a `.catch`, unhandled) promise for a
   * load they had explicitly abandoned. That contradicts the destroy contract
   * documented above: mutating lifecycle calls are safe no-ops after destroy.
   *
   * A superseded load (`generation !== loadGeneration`) is swallowed for the
   * same reason and with the same safety: it imports the very same module as
   * the load that replaced it, so a genuine failure is still reported — by the
   * newer load, which is the one with a caller waiting on it.
   *
   * A failure that is still current is NOT swallowed. Turning a broken chunk
   * into a silently resolved promise would leave the consumer with a book that
   * never appears and no error to explain it.
   */
  private loadCanvasModule(generation: number): Promise<typeof CanvasLoader | null> {
    return import('./canvas-loader').then(
      (m) => (this.destroyed || generation !== this.loadGeneration ? null : m),
      (err: unknown) => {
        if (this.destroyed || generation !== this.loadGeneration) return null;

        throw new PageFlipError(
          `Failed to load canvas renderer: ${err instanceof Error ? err.message : String(err)}`,
          'CANVAS_LOAD',
        );
      },
    );
  }

  /**
   * Load pages from images on the Canvas mode.
   *
   * The canvas renderer is a separate chunk, so an HTML-only consumer never
   * downloads it. Budgets live in `packages/core/package.json`; the enforced
   * one is brotli, which is what a consumer actually pays for.
   */
  public loadFromImages(imagesHref: string[]): Promise<void> {
    // Cheapest form of the same no-op: an engine that is already destroyed
    // does not download the chunk at all. `loadFromHTML` guards here too.
    if (this.destroyed) return Promise.resolve();

    const generation = this.nextGeneration();

    return this.loadCanvasModule(generation).then((m) => {
      m?.loadFromImages(this, imagesHref);
    });
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
   * Update current pages from images
   *
   * @param {string[]} imagesHref - List of paths to images
   */
  public updateFromImages(imagesHref: string[]): Promise<void> {
    if (this.destroyed) return Promise.resolve();

    const generation = this.nextGeneration();

    return this.loadCanvasModule(generation).then((m) => {
      m?.updateFromImages(this, imagesHref);
    });
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

    // Cross-mode updates are not supported and used to fail deep in: this cast
    // `CanvasUI` to `HTMLUI` and called `updateItems` on it. Load the mode you
    // want instead of updating across modes.
    if (!(ui instanceof HTMLUI)) {
      throw new PageFlipError(
        'updateFromHtml requires HTML mode; use loadFromHTML to switch modes.',
        'WRONG_MODE',
      );
    }

    this.nextGeneration();
    const render = this.renderOrThrow;
    const previous = this.pagesOrThrow;
    const current = previous.getCurrentPageIndex();

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

    previous.destroy();

    const pages = new HTMLPageCollection(this, render, ui.getDistElement(), items);
    this.pages = pages;
    pages.load();
    ui.updateItems(items);
    render.reload();

    // Same clamp-then-report-resolved contract as `replacePages`. `show()`
    // silently returns for an out-of-range index, so a shrinking update used to
    // leave `Render` holding left/right references into the collection that was
    // just destroyed, while both events reported the index carried in from it.
    // Report where the book actually landed — which is not the clamped
    // *request* either: in landscape `show(3)` settles on spread [2, 3], whose
    // canonical index is 2.
    const pageCount = pages.getPageCount();
    const target = pageCount === 0 ? 0 : Math.min(Math.max(current, 0), pageCount - 1);

    if (pageCount === 0) {
      // `show()` returns early for ANY index on an empty collection, so
      // nothing re-seeds the renderer and it keeps painting left/right pages
      // belonging to the collection just destroyed. `reload()` does not help —
      // it only recreates the shadow elements.
      render.releasePages();
    } else {
      pages.show(target);
    }

    const resolved = this.resolvedPageIndex(this.pages);

    this.dispatch('update', {
      page: resolved,
      mode: render.getOrientation(),
    });
    this.dispatch('collectionRebuild', {
      page: resolved,
      pageCount,
    });
  }

  /**
   * Merge settings at runtime. Input handlers rebind when `useMouseEvents` changes;
   * layout is recalculated for portrait / size updates.
   */
  public updateSettings(partial: Partial<FlipSetting>): FlipSetting {
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
    const refused = CONSTRUCTION_TIME_SETTINGS.filter(
      (key) =>
        key in partial &&
        partial[key] !== undefined &&
        (partial[key] as unknown) !== (this.setting[key] as unknown),
    );
    const effective: Partial<FlipSetting> = { ...partial };

    if (refused.length > 0) {
      for (const key of refused) delete effective[key];
      console.warn(
        `[flipbook] updateSettings ignored construction-time setting(s): ${refused.join(', ')}. ` +
          'These are read once when the book is built; rebuild the PageFlip instance to change them.',
      );
    }

    const next = new Settings().getSettings({ ...this.setting, ...effective });
    const mouseChanged = next.useMouseEvents !== this.setting.useMouseEvents;
    Object.assign(this.setting, next);

    // updateSettings can run before create() wires render/ui (React effects).

    if (this.ui) {
      if (mouseChanged) {
        this.ui.refreshHandlers();
      }
      // Size-shaped settings are stamped onto the host element, so a changed
      // `width` / `height` / `size` has to be restamped here. Otherwise the
      // only way to resize a book is to rebuild the engine.
      this.ui.applyHostSize(this.setting);
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
    this.nextGeneration();
    const ui = this.uiOrThrow;
    const render = this.renderOrThrow;

    // L2: a load schedules `init` on a 1 ms timer, and only another
    // `attachMode` used to invalidate it. `loadFromHTML(pages)` immediately
    // followed by `clear()` therefore still announced `init` a millisecond
    // later — and since `PageCollection.destroy()` does not reset
    // `currentPageIndex`, it announced a NON-ZERO page for a book that no
    // longer has any pages. There is nothing left to initialise; drop it.
    this.cancelPendingInit();

    this.pagesOrThrow.destroy();
    // Emptying the collection is not enough: the renderer holds its own
    // left/right/flipping/bottom references, so the rAF loop went on painting
    // the pages that had just been discarded.
    render.releasePages();
    this.flipController?.abandon();
    this.resetUserGesture();
    // Was an unconditional `as HTMLUI` cast. `CanvasUI` has no `clear()`, so
    // this threw a TypeError in canvas mode — a public method that could not be
    // called in one of the two supported modes.
    if (ui instanceof HTMLUI) ui.clear();

    // L3: `clear()` emptied the book and told nobody. `updateFromHtml` and
    // `replacePages` both end with the clamp-then-report-resolved pair, and
    // emptying is just the pageCount === 0 case of the same operation — the one
    // path neither covered. A consumer rendering "page 3 of 12" had no signal
    // at all that the book was gone. Same two events, same shape, so a listener
    // needs no special case: `update` because what is rendered changed,
    // `collectionRebuild` because the collection did. Not `flip` (no turn
    // happened) and not `init` (the book is not becoming ready).
    this.dispatch('update', {
      page: 0,
      mode: render.getOrientation(),
    });
    this.dispatch('collectionRebuild', {
      page: 0,
      pageCount: 0,
    });
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
      throw new PageFlipError(`Page ${page} not in spread`, 'INVALID_PAGE');
    }

    pages.show(page);
  }

  /**
   * Turn to the next page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipNext(corner: FlipCorner = FlipCorner.TOP): boolean {
    return this.requestTurn((flip) => flip.flipNext(corner));
  }

  public flipPrev(corner: FlipCorner = FlipCorner.TOP): boolean {
    return this.requestTurn((flip) => flip.flipPrev(corner));
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

    if (flip !== null && this.setting.disableFlipByClick && !flip.isPointOnCorners(pos)) {
      this.dispatch('turnRejected', { reason: 'disabled' });
      return;
    }

    // Falls through to `requestTurn` when there is no controller yet, so a
    // click before load reports `NOT_LOADED` like every other turn does.
    this.requestTurn((f) => f.flip(pos));
  }

  private requestTurn(run: (flip: Flip) => boolean): boolean {
    const flip = this.flipController;

    if (flip === null) {
      // Same distinction `requireLoaded` draws: "not loaded yet" is a retry,
      // "destroyed" never will be.
      this.dispatch('turnRejected', {
        reason: 'setup',
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

      this.dispatch('turnRejected', { reason: 'setup', code: err.code });
      return false;
    }

    if (started) return true;

    this.dispatch('turnRejected', { reason: 'boundary' });
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
   * @param {FlippingState} newState - New  state of the object
   */
  public updateState(newState: FlippingState): void {
    this.dispatch('changeState', newState);
  }

  /**
   * Call a page number change event trigger
   *
   * @param {number} newPage - New page Number
   */
  public updatePageIndex(newPage: number): void {
    this.dispatch('flip', newPage);
  }

  /**
   * Call a page orientation change event trigger. Update UI and rendering area
   *
   * @param {Orientation} newOrientation - New page orientation (portrait, landscape)
   */
  public updateOrientation(newOrientation: Orientation): void {
    this.uiOrThrow.setOrientationStyle(newOrientation);
    this.update();
    this.dispatch('changeOrientation', newOrientation);
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
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML` / `loadFromImages`.
   * @returns {Render}
   */
  public getRender(): Render {
    return this.renderOrThrow;
  }

  /**
   * Get current object responsible for flipping
   *
   * @returns {Flip} `null` until `loadFromHTML` / `loadFromImages` runs.
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
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML` / `loadFromImages`.
   * @returns {UI}
   */
  public getUI(): UI {
    // X4: the canvas renderer asks for the UI on every frame (`backingScale`),
    // including the frame already scheduled when a handler destroyed the book.
    if (this.teardownUi !== null) return this.teardownUi;

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
   * @throws {PageFlipError} `NOT_LOADED` before `loadFromHTML` / `loadFromImages`.
   * @returns {PageCollection}
   */
  public getPageCollection(): PageCollection {
    // X4: the HTML renderer iterates the collection on every frame (`clear()`),
    // including the frame already scheduled when a handler destroyed the book.
    // `PageCollection.destroy()` has emptied it, so that iteration is a no-op.
    if (this.teardownPages !== null) return this.teardownPages;

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
    if (!this.isUserTouch && !isTouch && this.setting.showPageCorners) {
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
