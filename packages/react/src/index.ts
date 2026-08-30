export { HTMLFlipBook } from './HTMLFlipBook';
export { usePageFlip } from './usePageFlip';

// `ImageFlipBook` is DELIBERATELY NOT EXPORTED in 3.0.0.
//
// The component is written to the Phase 2 descriptor API — blank leaves, per-leaf
// `alt`, `crossOrigin`, `density`, fit modes — and the ENGINE supports none of it
// yet. `toStringSources` flattens every descriptor back to a bare URL, so `alt`,
// `crossOrigin` and `density` are silently discarded, and blank leaves are dropped
// with a `console.warn` (`ImageFlipBook.tsx:195`). Its function coverage is 53%.
//
// Exporting it would publish a surface that does not do what its own types say,
// on the first release of a package — and a published API is one-way. Adding
// this export later is purely additive and costs nothing; removing or reshaping
// it after 3.0.0 is a major. The reversal cost is asymmetric, so the recoverable
// direction wins, which is the same argument the ADR uses for `crossOrigin`.
//
// The file and its tests stay: the work is sound and Phase 2 needs it. It lands
// with the engine support, in 3.1.
// export { ImageFlipBook } from './ImageFlipBook';
export type {
  HTMLFlipBookProps,
  FlipBookHandle,
  IFlipSetting,
  IEventProps,
  IBookState,
  PageState,
  PageOrientation,
  WidgetEvent,
  FlipbookEventMap,
} from './types';

export { HTMLFlipBook as default } from './HTMLFlipBook';
