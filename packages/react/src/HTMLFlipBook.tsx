'use client';

import {
  Children,
  cloneElement,
  createElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FlipCorner,
  FLIPBOOK_INTERACTIVE_SELECTOR,
  PageFlip,
  PageFlipError,
  type FlipSetting,
  type WidgetEvent,
  type FlipbookEventMap,
} from '@gullabs/flipbook-core';
import { createPortal } from 'react-dom';
import type { FlipBookHandle, HTMLFlipBookProps, LiveRegionInfo, PageOrientation } from './types';

const ENGINE_SETTING_KEYS = [
  'startPage',
  'size',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'drawShadow',
  'flippingTime',
  'usePortrait',
  'startZIndex',
  'autoSize',
  'maxShadowOpacity',
  'showCover',
  'mobileScrollSupport',
  'clickEventForward',
  'useMouseEvents',
  'swipeDistance',
  'showPageCorners',
  'disableFlipByClick',
  'pageBackground',
  'respectReducedMotion',
  'direction',
] as const satisfies readonly (keyof FlipSetting)[];

function pickSettings(props: HTMLFlipBookProps): Partial<FlipSetting> {
  const out: Partial<FlipSetting> = {
    width: props.width,
    height: props.height,
  };
  for (const key of ENGINE_SETTING_KEYS) {
    const value = props[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Settings the engine can only read at construction.
 *
 * `width` / `height` are deliberately NOT here: they are stamped onto the host
 * element and recalculated by `updateSettings`, so a responsive book restyles
 * instead of rebuilding. Keying on them destroyed and recreated the engine on
 * every resize step, losing the current page and any in-flight turn.
 */
function remountKeyOf(props: HTMLFlipBookProps): string {
  return [props.showCover, props.size].join(':');
}

/**
 * The live region announces turns to screen readers, so it must not paint.
 * Styles are inline rather than in FLIPBOOK_CSS because the region is rendered
 * server-side too, before the engine has injected any stylesheet.
 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/** Reference comparison: React reuses DOM nodes for keyed children. */
function sameNodes(previous: HTMLElement[] | null, next: HTMLElement[]): boolean {
  if (previous?.length !== next.length) return false;

  return previous.every((node, index) => node === next[index]);
}

/**
 * Leaf indices of the spread whose first leaf is `head`.
 *
 * This mirrors `PageCollection.createSpread` exactly: portrait is one leaf per
 * spread; landscape pairs leaves, with the cover (and a trailing odd leaf)
 * standing alone. It is derived rather than read because the collection's
 * spread table is `protected` — `getSpreadIndexByPage` / `getCurrentSpreadIndex`
 * are the only public windows onto it and neither hands back the members.
 * `head` must be the engine's `getCurrentPageIndex()`, which is `spread[0]`.
 */
function spreadPages(
  head: number,
  pageCount: number,
  orientation: PageOrientation,
  showCover: boolean,
): number[] {
  if (pageCount <= 0) return [];

  const first = Math.min(Math.max(head, 0), pageCount - 1);

  if (orientation === 'portrait') return [first];
  // The cover is a spread of its own, so it never pairs with leaf 1.
  if (showCover && first === 0) return [0];

  return first + 1 <= pageCount - 1 ? [first, first + 1] : [first];
}

/**
 * Human label for a leaf.
 *
 * This is the leaf index plus one, which is the printed page number only for a
 * book with no front matter (H5.3). The seam for real labels is here: when the
 * owner decides on a public page-label API, this is the one place that has to
 * consult it — `defaultLiveText` never does the arithmetic itself.
 */
function pageLabel(index: number): string {
  return String(index + 1);
}

function defaultLiveText(page: number, pageCount: number, info?: LiveRegionInfo): string {
  if (pageCount <= 0) return 'Book';

  const visible = info && info.pages.length > 0 ? info.pages : [page];
  const first = visible[0] ?? page;
  const second = visible[1];

  // With a cover, leaf 0 is not "page 1" — it is the front of the book, and the
  // final lone leaf is its back.
  if (info?.showCover === true && second === undefined) {
    if (first === 0) return 'Front cover';
    if (pageCount > 1 && first === pageCount - 1) return 'Back cover';
  }

  if (second !== undefined) {
    return `Pages ${pageLabel(first)} and ${pageLabel(second)} of ${pageCount}`;
  }

  return `Page ${pageLabel(first)} of ${pageCount}`;
}

type PageRef = ((el: HTMLElement | null) => void) | { current: HTMLElement | null } | null;

/**
 * Keep the consumer's own ref on a page element working: the engine needs the
 * node too, so both refs are called.
 */
function composeRefs(
  collect: (el: HTMLElement | null) => void,
  existing: PageRef,
): (el: HTMLElement | null) => void {
  if (!existing) return collect;

  return (el) => {
    collect(el);

    if (typeof existing === 'function') {
      existing(el);
    } else {
      existing.current = el;
    }
  };
}

/** Stable identity: a literal here would re-run the effect every render. */
const EMPTY_ANCHORS: number[] = [0];

function wrapChildren(
  children: ReactNode,
  visiblePages: number[],
  lazyRadius: number | undefined,
  collect: (el: HTMLElement | null) => void,
): ReactElement[] {
  const list: ReactElement[] = [];

  // `lazyRadius` is documented in SPREADS, but the window used to be measured
  // in pages from the spread HEAD. In landscape that is off by a whole leaf:
  // with `lazyRadius={1}` on spread [2, 3], page 4 sits at distance 2 and page
  // 5 at distance 3, so BOTH leaves of the very next spread were still
  // placeholders while the turn to them animated — the reader watched blank
  // paper turn over.
  //
  // Measuring from the nearest VISIBLE page, with the radius scaled by the
  // pages that spread actually shows, makes one radius mean one spread in both
  // orientations. Portrait is unchanged: one visible page, scale of 1.
  const pagesPerSpread = Math.max(1, visiblePages.length);
  const reach = lazyRadius !== undefined ? lazyRadius * pagesPerSpread : 0;
  const anchors = visiblePages.length > 0 ? visiblePages : [0];

  Children.forEach(children, (child, index) => {
    const far =
      lazyRadius !== undefined && Number.isFinite(lazyRadius)
        ? Math.min(...anchors.map((page) => Math.abs(index - page))) > reach
        : false;

    // One identity per leaf, whether or not it is currently inside the lazy
    // window. Keying placeholders `lazy-${index}` gave the same leaf two
    // different identities, so crossing the window boundary UNMOUNTED and
    // REMOUNTED its DOM node — `sameNodes` compares node references, so the
    // load effect then rebuilt the whole PageCollection on every turn, which
    // is precisely the mid-animation teardown the reference check exists to
    // prevent.
    const keyed = isValidElement(child) ? child : null;
    const key = keyed?.key ?? `page-${index}`;

    if (far) {
      // Same element TYPE as the real page too, for the same reason: React
      // replaces the node when the type changes, even under a stable key. The
      // placeholder carries none of the page's own props, so its content stays
      // unmounted — which is the point of lazy mounting. A component child has
      // no host type to match, so that case still remounts; the escape is to
      // give the page a host element of its own.
      const type = typeof keyed?.type === 'string' ? keyed.type : 'div';

      list.push(
        createElement(type, {
          key,
          'data-flipbook-lazy': '1',
          'aria-hidden': 'true',
          ref: collect,
        }),
      );
      return;
    }

    if (!isValidElement(child)) {
      list.push(
        <div key={key} ref={collect}>
          {child}
        </div>,
      );
      return;
    }

    const element = child as ReactElement<{ ref?: PageRef }> & { ref?: PageRef };

    list.push(
      cloneElement(element, {
        key,
        ref: composeRefs(collect, element.props.ref ?? element.ref ?? null),
      }),
    );
  });
  return list;
}

export const HTMLFlipBook = forwardRef<FlipBookHandle | null, Omit<HTMLFlipBookProps, 'ref'>>(
  function HTMLFlipBook(props, ref) {
    const {
      children,
      className,
      style,
      page: controlledPage,
      onPageChange,
      onFlip,
      onChangeOrientation,
      onChangeState,
      onInit,
      onUpdate,
      onCollectionRebuild,
      onTurnRejected,
      onNavigationError,
      renderOnlyPageLengthChange,
      useKeyboard = true,
      lazyRadius,
      liveRegion = true,
      liveRegionText = defaultLiveText,
      // Localisable: VoiceOver and NVDA substitute this for the role, so a
      // hardcoded English string is worse than none for a non-English book.
      roleDescription = 'book',
      'aria-label': ariaLabel = 'Flipbook',
    } = props;

    const rootRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PageFlip | null>(null);
    const childNodes = useRef<HTMLElement[]>([]);
    /** Page nodes currently loaded into the engine. */
    const loadedNodes = useRef<HTMLElement[] | null>(null);
    const [pages, setPages] = useState<ReactElement[]>([]);
    const [hydrated, setHydrated] = useState(false);
    /**
     * The engine's `.stf__block`. Pages are portalled into it so React's idea of
     * their parent matches the DOM: the engine used to move them out of the
     * root element, and any later React removal/reorder threw NotFoundError.
     */
    const [pageHost, setPageHost] = useState<HTMLElement | null>(null);
    const [enginePage, setEnginePage] = useState(props.startPage ?? 0);
    const [pageCount, setPageCount] = useState(0);
    // The live region's text, held separately from `currentPage`/`pageCount` so
    // it can stay empty until a turn actually commits.
    const [announced, setAnnounced] = useState('');
    const didAnnounce = useRef(false);
    /**
     * Landscape shows two leaves, portrait one, and the engine decides which —
     * so both the announcement and the inert set have to follow the engine's
     * orientation rather than a prop. Seeded to the engine's value at load and
     * kept current by `changeOrientation`.
     */
    const [orientation, setOrientation] = useState<PageOrientation>('landscape');

    const currentPage = controlledPage ?? enginePage;
    const showCover = props.showCover === true;
    // `enginePage`, not `currentPage`: the engine's index is always the FIRST
    // leaf of the spread, while a controlled `page` may name either leaf of it.
    // Memoised so both the live region and the inert effect can depend on it by
    // identity; recomputed on every render it would re-announce constantly.
    const visiblePages = useMemo(
      () => spreadPages(enginePage, pageCount, orientation, showCover),
      [enginePage, pageCount, orientation, showCover],
    );

    useEffect(() => {
      // Skip the first settled render: announcing the spread the reader has not
      // turned to yet is noise, and it fires for every book on the page.
      if (!didAnnounce.current) {
        didAnnounce.current = pageCount > 0;
        return;
      }
      setAnnounced(
        liveRegionText(currentPage, pageCount, { pages: visiblePages, orientation, showCover }),
      );
    }, [currentPage, pageCount, liveRegionText, visiblePages, orientation, showCover]);
    const settings = pickSettings(props);
    const remountKey = remountKeyOf(props);

    const handle: FlipBookHandle = useMemo(
      () => ({
        pageFlip: () => engineRef.current,
        flipNext: (corner?: FlipCorner) =>
          engineRef.current?.flipNext(corner ?? FlipCorner.TOP) ?? false,
        flipPrev: (corner?: FlipCorner) =>
          engineRef.current?.flipPrev(corner ?? FlipCorner.TOP) ?? false,
        turnToPage: (page: number) => engineRef.current?.turnToPage(page),
        flipToPage: (page: number) => engineRef.current?.flip(page),
      }),
      [],
    );

    useImperativeHandle(ref, () => handle, [handle]);

    // MEMOISED. This feeds an effect dependency array, and a fresh array
    // literal every render re-runs that effect, which re-renders — an infinite
    // loop that shows up as a heap exhaustion, not as a failing assertion.
    const lazyAnchors = useMemo(
      () => (lazyRadius !== undefined ? visiblePages : EMPTY_ANCHORS),
      [lazyRadius, visiblePages],
    );

    useEffect(() => {
      const collect = (el: HTMLElement | null) => {
        if (el) childNodes.current.push(el);
      };
      const next = wrapChildren(children, lazyAnchors, lazyRadius, collect);

      // Bail out BEFORE clearing `childNodes`: emptying it without re-rendering
      // leaves it empty for good, and the load effect below then skips
      // `loadFromHTML` on the next remount — a blank book.
      //
      // `renderOnlyPageLengthChange` must not apply while lazy mounting is on:
      // turning a page moves the lazy window without changing the page count,
      // so short-circuiting on equal length left every page outside the
      // initial window as an empty placeholder for the life of the book.
      const lazyWindowActive = lazyRadius !== undefined && Number.isFinite(lazyRadius);

      if (
        renderOnlyPageLengthChange === true &&
        !lazyWindowActive &&
        pages.length === next.length
      ) {
        return;
      }

      // Refs re-attach in DOM order during the commit `setPages` triggers.
      childNodes.current = [];
      setPages(next);
      // pages.length is the previous render's count; intentional.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [children, lazyAnchors, lazyRadius, renderOnlyPageLengthChange]);

    // Handlers are dispatched through a ref so `bindHandlers` is stable. With
    // the props in the dependency list, an inline `onFlip={(e) => …}` gave the
    // load effect a new identity on every render — and a flip always causes a
    // render — so the whole PageCollection was torn down and rebuilt on each
    // turn, mid-animation.
    const eventHandlersRef = useRef({
      onPageChange,
      onFlip,
      onChangeOrientation,
      onChangeState,
      onInit,
      onUpdate,
      onCollectionRebuild,
      onTurnRejected,
      onNavigationError,
    });

    useEffect(() => {
      eventHandlersRef.current = {
        onPageChange,
        onFlip,
        onChangeOrientation,
        onChangeState,
        onInit,
        onUpdate,
        onCollectionRebuild,
        onTurnRejected,
        onNavigationError,
      };
    });

    const handlersBoundRef = useRef(false);
    const startPageAppliedRef = useRef(false);
    const bindHandlers = useCallback((flip: PageFlip) => {
      if (handlersBoundRef.current) return;
      handlersBoundRef.current = true;

      flip.on('flip', (e: WidgetEvent<FlipbookEventMap['flip']>) => {
        const next = typeof e.data === 'number' ? e.data : 0;
        setEnginePage(next);
        setPageCount(flip.getPageCount());
        eventHandlersRef.current.onPageChange?.(next);
        eventHandlersRef.current.onFlip?.(e);
      });
      flip.on('changeOrientation', (e: WidgetEvent<FlipbookEventMap['changeOrientation']>) => {
        // Drives how many leaves count as "on screen" — see `spreadPages`.
        setOrientation(e.data === 'portrait' ? 'portrait' : 'landscape');
        eventHandlersRef.current.onChangeOrientation?.(e);
      });
      flip.on('changeState', (e: WidgetEvent<FlipbookEventMap['changeState']>) => {
        eventHandlersRef.current.onChangeState?.(e);
      });
      flip.on('init', (e: WidgetEvent<FlipbookEventMap['init']>) => {
        eventHandlersRef.current.onInit?.(e);
      });
      flip.on('update', (e: WidgetEvent<FlipbookEventMap['update']>) => {
        eventHandlersRef.current.onUpdate?.(e);
      });
      flip.on('collectionRebuild', (e: WidgetEvent<FlipbookEventMap['collectionRebuild']>) => {
        setPageCount(e.data.pageCount);
        // Re-derive the index too. A rebuild that shrinks the book below the
        // current index leaves the engine on a different leaf, and a
        // `pageCount` refreshed without it announced "Page 5 of 3" and inerted
        // the leaf the reader is actually looking at.
        //
        // The ENGINE is asked, not `e.data.page`: `replacePages` reports a
        // clamped, resolved index, but `updateFromHtml` — the path this
        // binding uses — reports the index it carried IN, before the new
        // collection refused it. `getCurrentPageIndex()` is the one value that
        // is true on both paths.
        setEnginePage(flip.getCurrentPageIndex());
        eventHandlersRef.current.onCollectionRebuild?.(e);
      });
      flip.on('turnRejected', (e: WidgetEvent<FlipbookEventMap['turnRejected']>) => {
        eventHandlersRef.current.onTurnRejected?.(e);
      });
    }, []);

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const engine = new PageFlip(root, settings);
      engineRef.current = engine;
      handlersBoundRef.current = false;
      startPageAppliedRef.current = false;
      bindHandlers(engine);

      // Build the DOM shell with no leaves, so there is a portal target before
      // any page exists. Pages are handed to the engine by the effect below.
      engine.loadFromHTML([]);
      loadedNodes.current = [];

      setPageHost(engine.getUI().getDistElement());
      setHydrated(true);

      return () => {
        handlersBoundRef.current = false;
        startPageAppliedRef.current = false;
        engine.destroy();
        setPageHost(null);
        loadedNodes.current = null;
        if (engineRef.current === engine) {
          engineRef.current = null;
        }
      };
      // Recreate only when constructor-level layout identity changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remountKey, bindHandlers]);

    useEffect(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.updateSettings(settings);
      // settings object is rebuilt each render; identity is not load-bearing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      props.width,
      props.height,
      props.usePortrait,
      props.useMouseEvents,
      props.flippingTime,
      props.respectReducedMotion,
      props.direction,
      props.pageBackground,
      props.drawShadow,
      props.showPageCorners,
      props.disableFlipByClick,
      props.swipeDistance,
      props.clickEventForward,
      props.mobileScrollSupport,
      props.maxShadowOpacity,
      props.startZIndex,
      props.autoSize,
      props.minWidth,
      props.maxWidth,
      props.minHeight,
      props.maxHeight,
    ]);

    useEffect(() => {
      const engine = engineRef.current;
      const nodes = childNodes.current;

      if (!engine || !pageHost || pages.length === 0 || nodes.length === 0) {
        return;
      }

      // Handlers MUST be attached before updateFromHtml so `onUpdate` fires
      // (upstream removed listeners, emitted `update`, then re-attached).
      bindHandlers(engine);

      // Rebuild only when the page nodes themselves changed. A parent re-render
      // (every flip causes one) hands us new React elements but the SAME DOM
      // nodes; rebuilding there tore down the PageCollection on every turn,
      // mid-animation, and emitted a spurious `collectionRebuild`.
      if (sameNodes(loadedNodes.current, nodes)) {
        return;
      }

      engine.updateFromHtml(nodes);
      loadedNodes.current = nodes.slice();
      setPageCount(engine.getPageCount());
      // Seed from the engine: `changeOrientation` only fires on a CHANGE, so a
      // book that is landscape from the first layout never emits one.
      setOrientation(engine.getOrientation() === 'portrait' ? 'portrait' : 'landscape');

      // Honor startPage once after the first real collection (FE-001).
      if (controlledPage === undefined && !startPageAppliedRef.current) {
        startPageAppliedRef.current = true;
        const start = props.startPage ?? 0;

        // Ask the engine rather than re-deriving its rules here. A numeric
        // range check is not reachability: `startPage: 0.5` is inside the page
        // count but belongs to no spread, and in landscape `startPage: 1`
        // validly opens the spread [0, 1] whose canonical index is 0 — so
        // comparing indices afterwards would flag a perfectly good page.
        let honored = true;

        if (start !== 0) {
          try {
            engine.turnToPage(start);
          } catch (error: unknown) {
            // Only the engine saying "no such page" means the start page was
            // bad. A listener throwing, or a real render fault, must not be
            // relabelled as an invalid `startPage`.
            if (!(error instanceof PageFlipError)) throw error;
            honored = false;
          }
        }

        const resolved = engine.getCurrentPageIndex();
        setEnginePage(resolved);

        // Opening at page 0 without a word is the failure this event exists
        // for: it reads as "the book has no such page".
        if (!honored) {
          eventHandlersRef.current.onNavigationError?.({
            code: 'INVALID_PAGE',
            requested: start,
            actual: resolved,
          });
        }
      }
    }, [pages, pageHost, bindHandlers, remountKey, controlledPage, props.startPage]);

    /*
     * Every leaf is in the DOM at all times, stacked, so a link or button on a
     * page behind the current spread must not be in the tab order: a keyboard
     * user would tab off the book onto a control they cannot see, on a page
     * they are not reading — WCAG 2.4.3 (Focus Order).
     *
     * Be honest about what this buys: `HTMLRender.clear()` already stamps
     * `display:none` onto every off-spread leaf on each frame, and a
     * `display:none` subtree is untabbable, so a settled book was already safe.
     * `inert` covers what that does not: the mid-flip window, where the
     * outgoing leaf, the fold and the bottom page are all `display:block` at
     * once, and any consumer stylesheet that forces its own display onto
     * `.stf__item`. It is also declarative rather than a side effect of the
     * render loop, so it holds whenever the loop is stopped.
     *
     * `inert` is set on the DOM node rather than rendered as a JSX prop
     * deliberately: React only started passing a boolean `inert` through to the
     * DOM in 19, and `react` here is a peer dependency of `>=18`. On React 18 a
     * boolean `inert` prop is dropped with a warning, so the fix would silently
     * not apply for a large share of consumers. The attribute is the same thing
     * the browser reads, and React never manages it here.
     *
     * Accepted cost: `inert` also removes those pages from find-in-page. A
     * focus-order failure outranks a search convenience — and the pages are
     * visually hidden anyway, so finding text on them was already misleading.
     */
    useEffect(() => {
      const nodes = childNodes.current;
      // Before the collection loads there is no spread yet, and inerting every
      // leaf for that one commit would blank the tab order of a mounting book.
      if (nodes.length === 0 || pageCount <= 0) return;

      const visible = new Set(visiblePages);

      nodes.forEach((node, index) => {
        if (visible.has(index)) node.removeAttribute('inert');
        else node.setAttribute('inert', '');
      });

      return () => {
        // The nodes belong to the consumer; leave none of ours behind.
        for (const node of nodes) node.removeAttribute('inert');
      };
    }, [pages, visiblePages, pageCount]);

    useEffect(() => {
      const engine = engineRef.current;
      if (!engine || controlledPage === undefined) return;
      if (!engine.getFlipController()) return;
      // Empty portal shell has no leaves yet — don't treat start page as OOB.
      if (engine.getPageCount() <= 0) return;

      // A controlled page is satisfied when it is ON SCREEN, not when it
      // equals the engine's index: that index is the spread HEAD, so in
      // landscape the spread [0, 1] reports 0 and `page={1}` never matched.
      // The effect re-issued `turnToPage(1)`, the engine showed the same
      // spread and emitted `flip` with 0, and `onPageChange(0)` rewrote the
      // consumer's own value — the component and the engine then disagreed
      // about a book that was already showing the requested leaf.
      //
      // Membership is asked of the collection rather than derived here: the
      // cover is a spread of one, so "pair the leaves two at a time" is wrong
      // exactly when `showCover` is set.
      const collection = engine.getPageCollection();
      const targetSpread = collection.getSpreadIndexByPage(controlledPage);
      if (targetSpread !== null && targetSpread === collection.getCurrentSpreadIndex()) return;
      try {
        engine.turnToPage(controlledPage);
      } catch (error: unknown) {
        // Only the engine refusing the page is a navigation error. A consumer
        // `onPageChange` that throws, or a broken renderer, must not be
        // relabelled as "invalid page" and hidden.
        if (!(error instanceof PageFlipError)) throw error;

        const count = engine.getPageCount();
        const actual = count <= 0 ? 0 : Math.min(Math.max(0, controlledPage), count - 1);
        try {
          if (count > 0 && actual !== engine.getCurrentPageIndex()) engine.turnToPage(actual);
        } catch (clampError: unknown) {
          // The clamp is a best effort; if even that page is refused we still
          // report below. A non-engine failure is still a defect.
          if (!(clampError instanceof PageFlipError)) throw clampError;
        }
        const resolved = engine.getCurrentPageIndex();
        setEnginePage(resolved);
        eventHandlersRef.current.onPageChange?.(resolved);
        eventHandlersRef.current.onNavigationError?.({
          code: 'INVALID_PAGE',
          requested: controlledPage,
          actual: resolved,
        });
      }
    }, [controlledPage, pages]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!useKeyboard) return;
      const engine = engineRef.current;
      if (!engine) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target !== event.currentTarget &&
        target.closest(FLIPBOOK_INTERACTIVE_SELECTOR)
      ) {
        return;
      }
      const rtl = props.direction === 'rtl';
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (rtl) engine.flipPrev();
        else engine.flipNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (rtl) engine.flipNext();
        else engine.flipPrev();
      } else if (event.key === 'Home') {
        event.preventDefault();
        try {
          engine.turnToPage(0);
        } catch (error: unknown) {
          // An empty or unloaded book has nowhere to go; anything else is real.
          if (!(error instanceof PageFlipError)) throw error;
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        try {
          const last = Math.max(0, engine.getPageCount() - 1);
          engine.turnToPage(last);
        } catch (error: unknown) {
          if (!(error instanceof PageFlipError)) throw error;
        }
      }
    };

    /*
     * Composite widget: keyboard turns when focused (Arrow/Home/End).
     *
     * jsx-a11y objects to a tabIndex and a keydown handler on a `group`. Its
     * model is "make the role interactive" — and the only role that would
     * satisfy it here is `application`, which is precisely what must not be
     * used: it strips the virtual cursor from NVDA and JAWS for the whole
     * subtree, and linear reading is the entire value of a book to a
     * screen-reader user. A single-tab-stop composite with a `group` role is
     * the APG carousel shape; the rule simply does not model composites.
     * Browse-mode users turn pages with the controls, not the arrows.
     */
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        ref={rootRef}
        className={className}
        style={style}
        data-flipbook-placeholder={hydrated ? undefined : ''}
        aria-label={ariaLabel}
        // NEVER `application`. It forces NVDA and JAWS out of browse mode for
        // the whole subtree, which removes the virtual cursor: no
        // element-by-element reading, no heading/graphic quick-nav, no "say
        // all", no find-in-page. For a BOOK, linear reading is the entire value
        // to a screen-reader user, so buying arrow keys with it is the worst
        // trade available. Browse-mode users turn pages with real controls.
        role="group"
        aria-roledescription={roleDescription}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see above
        tabIndex={useKeyboard ? 0 : undefined}
        aria-keyshortcuts={useKeyboard ? 'ArrowLeft ArrowRight Home End' : undefined}
        data-flipbook-kb={useKeyboard ? '' : undefined}
        onKeyDown={useKeyboard ? onKeyDown : undefined}
      >
        {useKeyboard ? (
          <style>{`[data-flipbook-kb]:focus{outline:none}[data-flipbook-kb]:focus-visible{outline:2px solid #2563eb;outline-offset:2px}`}</style>
        ) : null}
        {pageHost ? createPortal(pages, pageHost) : null}
        {liveRegion ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-flipbook-live=""
            style={VISUALLY_HIDDEN}
          >
            {/*
              Mounts EMPTY. `pageCount` starts at 0, so rendering the text
              immediately produced "Book", then a mutation to "Page 1 of 32"
              once the collection loaded — a real live-region change, which AT
              announces. Every book on the page introduced itself during load.
            */}
            {announced}
          </div>
        ) : null}
      </div>
    );
  },
);
