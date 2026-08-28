'use client';

import {
  Children,
  cloneElement,
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
import type { FlipBookHandle, HTMLFlipBookProps } from './types';

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

function defaultLiveText(page: number, pageCount: number): string {
  if (pageCount <= 0) return 'Book';
  return `Page ${page + 1} of ${pageCount}`;
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

function wrapChildren(
  children: ReactNode,
  currentPage: number,
  lazyRadius: number | undefined,
  collect: (el: HTMLElement | null) => void,
): ReactElement[] {
  const list: ReactElement[] = [];
  Children.forEach(children, (child, index) => {
    const far =
      lazyRadius !== undefined && Number.isFinite(lazyRadius)
        ? Math.abs(index - currentPage) > lazyRadius
        : false;

    if (far) {
      list.push(
        <div key={`lazy-${index}`} data-flipbook-lazy="1" aria-hidden="true" ref={collect} />,
      );
      return;
    }

    if (!isValidElement(child)) {
      list.push(
        <div key={`page-${index}`} ref={collect}>
          {child}
        </div>,
      );
      return;
    }

    const element = child as ReactElement<{ ref?: PageRef }> & { ref?: PageRef };

    list.push(
      cloneElement(element, {
        key: child.key ?? `page-${index}`,
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

    const currentPage = controlledPage ?? enginePage;
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

    const lazyPage = lazyRadius !== undefined ? currentPage : 0;

    useEffect(() => {
      const collect = (el: HTMLElement | null) => {
        if (el) childNodes.current.push(el);
      };
      const next = wrapChildren(children, lazyPage, lazyRadius, collect);

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
    }, [children, lazyPage, lazyRadius, renderOnlyPageLengthChange]);

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

    useEffect(() => {
      const engine = engineRef.current;
      if (!engine || controlledPage === undefined) return;
      if (!engine.getFlipController()) return;
      // Empty portal shell has no leaves yet — don't treat start page as OOB.
      if (engine.getPageCount() <= 0) return;
      if (controlledPage === engine.getCurrentPageIndex()) return;
      try {
        engine.turnToPage(controlledPage);
      } catch {
        const count = engine.getPageCount();
        const actual = count <= 0 ? 0 : Math.min(Math.max(0, controlledPage), count - 1);
        try {
          if (count > 0 && actual !== engine.getCurrentPageIndex()) engine.turnToPage(actual);
        } catch {
          /* empty */
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
        } catch {
          // empty book / not loaded
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        try {
          const last = Math.max(0, engine.getPageCount() - 1);
          engine.turnToPage(last);
        } catch {
          // empty book / not loaded
        }
      }
    };

    /* Composite widget: keyboard turns when focused (Arrow/Home/End). */
    return (
      <div
        ref={rootRef}
        className={className}
        style={style}
        data-flipbook-placeholder={hydrated ? undefined : ''}
        aria-label={ariaLabel}
        role={useKeyboard ? 'application' : 'group'}
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
            {liveRegionText(currentPage, pageCount)}
          </div>
        ) : null}
      </div>
    );
  },
);
