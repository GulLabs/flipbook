'use client';

/**
 * Canvas / images React binding (ADR 0001 Decision — separate component).
 *
 * No children, no portal machinery: pages are bitmaps (or blank leaves) the
 * engine owns. HTMLFlipBook is untouched.
 *
 * Until `@gullabs/flipbook-core` exports `ImagePageSource` and accepts
 * descriptors on `loadFromImages`, this component:
 *   1. tries the ADR descriptor list;
 *   2. falls back to bare `src` strings so the demo and tests still run.
 *
 * Blank leaves require Phase 2; with only string[] support they are skipped
 * with a single console.warn (one per book, not per leaf).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  FlipCorner,
  PageFlip,
  PageFlipError,
  type FlipSetting,
  type WidgetEvent,
  type FlipbookEventMap,
} from '@gullabs/flipbook-core';
import type {
  BlankPageSource,
  FlipBookHandle,
  ImageErrorPayload,
  ImageFlipBookProps,
  ImagePageLeaf,
  LiveRegionInfo,
  PageOrientation,
} from './types';

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
  // Canvas-only (ADR). Present when core has landed them; ignored otherwise.
  'imageFit',
  'imageInset',
  'imageLoadRadius',
  'imageKeepRadius',
  'imageCrossOrigin',
] as const;

function pickSettings(props: ImageFlipBookProps): Partial<FlipSetting> {
  const out: Partial<FlipSetting> = {
    width: props.width,
    height: props.height,
  };
  for (const key of ENGINE_SETTING_KEYS) {
    const value = (props as Record<string, unknown>)[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function remountKeyOf(props: ImageFlipBookProps): string {
  return [props.showCover, props.size].join(':');
}

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

function pageLabel(index: number): string {
  return String(index + 1);
}

function defaultLiveText(page: number, pageCount: number, info?: LiveRegionInfo): string {
  if (pageCount <= 0) return 'Book';
  const visible = info && info.pages.length > 0 ? info.pages : [page];
  const first = visible[0] ?? page;
  const second = visible[1];
  if (info?.showCover === true && second === undefined) {
    if (first === 0) return 'Front cover';
    if (pageCount > 1 && first === pageCount - 1) return 'Back cover';
  }
  if (second !== undefined) {
    return `Pages ${pageLabel(first)} and ${pageLabel(second)} of ${pageCount}`;
  }
  return `Page ${pageLabel(first)} of ${pageCount}`;
}

function spreadPages(
  head: number,
  pageCount: number,
  orientation: PageOrientation,
  showCover: boolean,
): number[] {
  if (pageCount <= 0) return [];
  const first = Math.min(Math.max(head, 0), pageCount - 1);
  if (orientation === 'portrait') return [first];
  if (showCover && first === 0) return [0];
  return first + 1 <= pageCount - 1 ? [first, first + 1] : [first];
}

function isBlankLeaf(leaf: ImagePageLeaf): leaf is BlankPageSource {
  return 'blank' in leaf;
}

/** Stable serialisation so an images identity change rebuilds the collection. */
function imagesKey(images: readonly ImagePageLeaf[]): string {
  return images
    .map((leaf) => {
      if (isBlankLeaf(leaf)) {
        return `blank:${leaf.alt}:${leaf.background ?? ''}:${leaf.density ?? ''}`;
      }
      return [
        leaf.src,
        leaf.alt,
        leaf.fit ?? '',
        leaf.inset ?? '',
        leaf.background ?? '',
        leaf.density ?? '',
        leaf.crossOrigin ?? '',
      ].join('\0');
    })
    .join('|');
}

function toStringSources(images: readonly ImagePageLeaf[]): string[] {
  const out: string[] = [];
  let skippedBlank = 0;
  for (const leaf of images) {
    if (isBlankLeaf(leaf)) {
      skippedBlank += 1;
      continue;
    }
    out.push(leaf.src);
  }
  if (skippedBlank > 0) {
    console.warn(
      `[ImageFlipBook] ${String(skippedBlank)} blank leaf(ves) dropped: the engine does not accept blank leaves yet (Phase 2).`,
    );
  }
  return out;
}

export const ImageFlipBook = forwardRef<FlipBookHandle | null, Omit<ImageFlipBookProps, 'ref'>>(
  function ImageFlipBook(props, ref) {
    const {
      images,
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
      onImageError,
      useKeyboard = true,
      liveRegion = true,
      liveRegionText = defaultLiveText,
      roleDescription = 'book',
      'aria-label': ariaLabel = 'Flipbook',
    } = props;

    const rootRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<PageFlip | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const [enginePage, setEnginePage] = useState(props.startPage ?? 0);
    const [pageCount, setPageCount] = useState(0);
    const [announced, setAnnounced] = useState('');
    const didAnnounce = useRef(false);
    const [orientation, setOrientation] = useState<PageOrientation>('landscape');
    /** Visually-hidden list built from each leaf's `alt` (canvas a11y mirror). */
    const [mirrorLabels, setMirrorLabels] = useState<string[]>([]);

    const currentPage = controlledPage ?? enginePage;
    const showCover = props.showCover === true;
    const visiblePages = useMemo(
      () => spreadPages(enginePage, pageCount, orientation, showCover),
      [enginePage, pageCount, orientation, showCover],
    );

    useEffect(() => {
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
    const imagesIdentity = imagesKey(images);

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
      onImageError,
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
        onImageError,
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
        setEnginePage(flip.getCurrentPageIndex());
        eventHandlersRef.current.onCollectionRebuild?.(e);
      });
      flip.on('turnRejected', (e: WidgetEvent<FlipbookEventMap['turnRejected']>) => {
        eventHandlersRef.current.onTurnRejected?.(e);
      });
      // imageError is Phase 2 — bind loosely until core exports it on the map.
      try {
        (flip.on as (event: string, cb: (e: WidgetEvent<ImageErrorPayload>) => void) => void)(
          'imageError',
          (e) => {
            eventHandlersRef.current.onImageError?.(e);
          },
        );
      } catch {
        // pre-Phase 2
      }
    }, []);

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const engine = new PageFlip(root, settings);
      engineRef.current = engine;
      handlersBoundRef.current = false;
      startPageAppliedRef.current = false;
      bindHandlers(engine);
      setHydrated(true);

      return () => {
        handlersBoundRef.current = false;
        startPageAppliedRef.current = false;
        engine.destroy();
        if (engineRef.current === engine) {
          engineRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remountKey, bindHandlers]);

    useEffect(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.updateSettings(settings);
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
      props.imageFit,
      props.imageInset,
      props.imageLoadRadius,
      props.imageKeepRadius,
      props.imageCrossOrigin,
    ]);

    // Load / replace the image collection when the leaf list identity changes.
    useEffect(() => {
      const engine = engineRef.current;
      if (!engine || engine.isDestroyed()) return;

      let cancelled = false;

      const labels = images.map((leaf) => {
        if (isBlankLeaf(leaf)) return leaf.alt;
        return leaf.alt;
      });
      setMirrorLabels(labels);

      void (async () => {
        const stillCurrent = () => !cancelled && !engine.isDestroyed();

        try {
          // Prefer ADR descriptors.
          await engine.loadFromImages(images as unknown as string[]);
        } catch {
          if (!stillCurrent()) return;
          const urls = toStringSources(images);
          if (urls.length === 0) return;
          try {
            await engine.loadFromImages(urls);
          } catch (err) {
            if (!stillCurrent()) return;
            const code = err instanceof PageFlipError ? err.code : 'UNKNOWN';
            let actual = -1;
            try {
              actual = engine.getCurrentPageIndex();
            } catch {
              actual = -1;
            }
            eventHandlersRef.current.onNavigationError?.({
              code: String(code),
              requested: 0,
              actual,
            });
            return;
          }
        }
        if (!stillCurrent()) return;

        setPageCount(engine.getPageCount());
        const landed = engine.getCurrentPageIndex();
        setEnginePage(landed);
        setOrientation(engine.getOrientation() === 'portrait' ? 'portrait' : 'landscape');

        if (!startPageAppliedRef.current) {
          startPageAppliedRef.current = true;
          eventHandlersRef.current.onPageChange?.(landed);
        }
      })();

      return () => {
        cancelled = true;
      };
      // imagesIdentity captures content; images is read inside.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imagesIdentity]);

    // Controlled `page`.
    useEffect(() => {
      const engine = engineRef.current;
      if (!engine || engine.isDestroyed()) return;
      if (controlledPage === undefined) return;

      const safeIndex = (): number => {
        try {
          return engine.getCurrentPageIndex();
        } catch {
          return -1;
        }
      };

      // loadFromImages is async; until it settles, getters throw NOT_LOADED.
      const current = safeIndex();
      if (current < 0) return;
      if (controlledPage === current) return;

      try {
        engine.turnToPage(controlledPage);
        setEnginePage(safeIndex() >= 0 ? engine.getCurrentPageIndex() : controlledPage);
      } catch (err) {
        if (err instanceof PageFlipError) {
          eventHandlersRef.current.onNavigationError?.({
            code: err.code,
            requested: controlledPage,
            actual: safeIndex(),
          });
        }
      }
    }, [controlledPage]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (!useKeyboard) return;
      const engine = engineRef.current;
      if (!engine || engine.isDestroyed()) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (props.direction === 'rtl') engine.flipPrev();
          else engine.flipNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (props.direction === 'rtl') engine.flipNext();
          else engine.flipPrev();
          break;
        case 'Home':
          e.preventDefault();
          try {
            engine.turnToPage(0);
          } catch {
            /* out of range / destroyed */
          }
          break;
        case 'End':
          e.preventDefault();
          try {
            engine.turnToPage(Math.max(0, engine.getPageCount() - 1));
          } catch {
            /* out of range / destroyed */
          }
          break;
        default:
          break;
      }
    };

    // Same a11y pattern as HTMLFlipBook: a named `group` that is also the
    // keyboard target. jsx-a11y wants a widget role; `group` + roledescription
    // is the AT contract this binding already ships.
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above
      <div
        ref={rootRef}
        className={className}
        style={style}
        role="group"
        aria-roledescription={roleDescription}
        aria-label={ariaLabel}
        data-flipbook-mode="images"
        data-hydrated={hydrated ? '1' : '0'}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see above
        tabIndex={useKeyboard ? 0 : -1}
        onKeyDown={useKeyboard ? onKeyDown : undefined}
      >
        {/*
          Canvas is aria-hidden to AT; the semantic mirror carries each leaf's
          alt. Blank decorative leaves (alt: '') are omitted from the list.
        */}
        <ol style={VISUALLY_HIDDEN} aria-hidden={false}>
          {mirrorLabels.map((label, i) =>
            label === '' ? null : (
              <li
                key={`mirror-${String(i)}`}
                aria-current={visiblePages.includes(i) ? 'page' : undefined}
              >
                {label}
              </li>
            ),
          )}
        </ol>
        {liveRegion ? (
          <div role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
            {announced}
          </div>
        ) : null}
      </div>
    );
  },
);

ImageFlipBook.displayName = 'ImageFlipBook';
