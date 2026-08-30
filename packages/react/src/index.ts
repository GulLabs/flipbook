export { HTMLFlipBook } from './HTMLFlipBook';
export { usePageFlip } from './usePageFlip';

// `ImageFlipBook` STAYS UNEXPORTED in 3.0.0. Do not re-add the export without
// the owner opening the gate; owner decision, 2026-08-29.
//
// It was briefly exported earlier that day, on the argument that the technical
// precondition had been met: the engine now takes `readonly CanvasLeaf[]`, the
// component passes descriptors through uncast, and `pnpm typecheck` therefore
// proves the surface is real — "the gate was `pnpm typecheck`, not a judgement
// call".
//
// That reasoning is sound and answers the wrong question. Compiling is not
// approval to ship. `docs/CANVAS_FIRST_CLASS.md` opens Phase 2 with an owner
// API-approval gate that names `ImageFlipBook` explicitly, alongside
// `ImagePageSource`, the error event and the lazy policy, as product decisions
// under AGENTS.md §5. That gate has not been opened, and an implementation
// landing is not what opens it.
//
// It matters here specifically because un-exporting after publish is a major
// version, which is the irreversibility line §5 draws. Nothing is published
// yet, so this costs nothing today and cannot be undone later.
//
// The component and its full test suite stay in the tree. Exporting it is one
// line, the day the gate opens.
export type {
  HTMLFlipBookProps,
  // `ImageFlipBookProps` goes with the component, as it did in 3342a0d: a props
  // type for a component nobody can import is surface with no referent, and it
  // is how an unexported thing leaks back into the public `.d.ts` by accident.
  FlipBookHandle,
  IFlipSetting,
  IEventProps,
  IBookState,
  PageState,
  PageOrientation,
  LiveRegionInfo,
  LiveRegionTextFn,
  WidgetEvent,
  FlipbookEventMap,
  CanvasLeaf,
  ImagePageSource,
  BlankPageSource,
  ImageFit,
} from './types';

export { HTMLFlipBook as default } from './HTMLFlipBook';
