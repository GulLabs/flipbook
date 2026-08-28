# Migration from `page-flip` / `react-pageflip`

Drop-in `HTMLFlipBook` keeps **required `width` and `height`**. Other settings stay optional.

## Install

```bash
npm uninstall react-pageflip page-flip && npm i @gullabs/react-flipbook
```

Vanilla engine:

```bash
npm uninstall page-flip && npm i @gullabs/flipbook-core
```

```ts
// before
import { PageFlip } from 'page-flip';
import HTMLFlipBook from 'react-pageflip';

// after
import { PageFlip } from '@gullabs/flipbook-core';
import HTMLFlipBook from '@gullabs/react-flipbook';
```

## Breaking changes (3.0.0)

| Change                                        | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package names                                 | `@gullabs/flipbook-core`, `@gullabs/react-flipbook`. Do not use `page-flip` / `StPageFlip` as package names.                                                                                                                                                                                                                                                                                                                                                               |
| `flippingTime: 0`                             | Now means **instant**. Upstream threw `Invalid flipping time`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `respectReducedMotion`                        | Defaults to `true`. Turns become instant under `prefers-reduced-motion`. Set `false` to keep animating.                                                                                                                                                                                                                                                                                                                                                                    |
| `pageBackground`                              | New, default `#fff`. Set to your paper color so the fold is opaque.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `direction: 'rtl'`                            | New. Click, corner fold, drag and swipe invert _turn direction_. Pointer x is not mirrored (fold follows the finger). Programmatic `flipNext`/`flipPrev` follow page index. Curl geometry stays LTR.                                                                                                                                                                                                                                                                       |
| `loadFromImages` / `updateFromImages`         | Now return `Promise<void>` (canvas is a lazy chunk). Await them or listen for `init`/`update`. Reject with `PageFlipError` if the chunk fails. Destroy-before-resolve is a no-op.                                                                                                                                                                                                                                                                                          |
| Engine getters before load                    | `getRender()`, `getUI()`, `getPageCollection()`, `getPageCount()`, `getCurrentPageIndex()`, `getOrientation()`, `getBoundsRect()`, `getPage()`, `turnToPage()` and `clear()` throw `PageFlipError` with code `NOT_LOADED` if called before `loadFromHTML` / `loadFromImages`. They previously dereferenced `undefined` and failed deeper in with no useful message. `getSettings()`, `getState()`, `update()`, `updateSettings()` and `destroy()` remain safe before load. |
| `turnToPage` / `flipToPage` (`PageFlip.flip`) | Throw `PageFlipError` on setup failure instead of silently advancing one page.                                                                                                                                                                                                                                                                                                                                                                                             |
| React types                                   | `react` is a **peer** (`>=18`). Isolated pnpm `node_modules` type-checks props.                                                                                                                                                                                                                                                                                                                                                                                            |
| React 18/19                                   | Imperative handle uses `forwardRef` so `ref.current.pageFlip()` works on React 18 (peer `>=18`). Spec §6.9 “ref as prop / no forwardRef” is **waived** for 3.0.0 — dropping `forwardRef` would break React 18.                                                                                                                                                                                                                                                             |
| Core min size                                 | Unmodified StPageFlip 2.0.7 minifies to **~42 kB** ESM (~11 kB gzip). Spec §5’s 35 kB _uncompressed_ is below upstream. CI enforces HTML engine **≤ 45 kB uncompressed** and **≤ 15 kB gzip**. Canvas is a separate async chunk.                                                                                                                                                                                                                                           |
| `PageFlip.destroy()`                          | No longer removes the host DOM node (the React tree owns it).                                                                                                                                                                                                                                                                                                                                                                                                              |
| CSS                                           | Injected at runtime. Also exported as `@gullabs/flipbook-core/style.css`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `updateFromHtml`                              | Rebuilds `PageCollection` and emits typed `update` **and** `collectionRebuild`. Attach listeners before calling (the binding does this).                                                                                                                                                                                                                                                                                                                                   |
| Constructor-only settings                     | `updateSettings(partial)` restamps `usePortrait` / `useMouseEvents` / etc. The React binding remounts when `showCover` / `size` / `width` / `height` change.                                                                                                                                                                                                                                                                                                               |

## Compatible props

`HTMLFlipBook` still accepts the upstream settings (`usePortrait`, `showCover`, `maxShadowOpacity`, `disableFlipByClick`, …) plus:

- `page` + `onPageChange` (controlled)
- `useKeyboard`
- `lazyRadius`
- `liveRegion` / `liveRegionText`
- `onCollectionRebuild`

## Lifecycle of `PageCollection`

`updateFromHtml` / `updateFromImages` **replace** the collection instance. Any state you stamped on the old collection is gone. Listen for `collectionRebuild` (or React `onUpdate`, which now actually fires) and re-apply.

## Portrait back-curl

No consumer monkey-patch is required. Portrait BACK animates a temporary copy of the **current** leaf on the vendor local path (`to.x = -pageWidth`). `Render.convertToGlobal` BACK-mirror yields a rightward on-screen curl. The bottom leaf paints unless `flippingPage === bottomPage` (hard cover).

## GulLabs 3.x binding notes (craft-audit climb)

- `HTMLFlipBook` **`useKeyboard` defaults to `true`**. Pass `useKeyboard={false}` to restore pointer-only.
- `PageFlip.flipNext` / `flipPrev` (and the React handle) return **`boolean`** — `false` means the turn did not start. Subscribe to **`turnRejected`** for the same signal as an event.
- Controlled `page` out of range calls optional **`onNavigationError`** and clamps via `onPageChange` to the engine index.
- `usePageFlip()` returns **`bookProps`** — spread onto `<HTMLFlipBook {...bookProps} />` so `pageCount` stays in sync.
