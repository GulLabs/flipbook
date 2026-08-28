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

| Change | What to do |
| ------ | ---------- |
| Package names | `@gullabs/flipbook-core`, `@gullabs/react-flipbook`. Do not use `page-flip` / `StPageFlip` as package names. |
| `flippingTime: 0` | Now means **instant**. Upstream threw `Invalid flipping time`. |
| `respectReducedMotion` | Defaults to `true`. Turns become instant under `prefers-reduced-motion`. Set `false` to keep animating. |
| `pageBackground` | New, default `#fff`. Set to your paper color so the fold is opaque. |
| `direction: 'rtl'` | New. Inverts next/prev hit-testing. |
| `turnToPage` / `flipToPage` (`PageFlip.flip`) | Throw `PageFlipError` on setup failure instead of silently advancing one page. |
| React types | `react` is a **peer** (`>=18`). Isolated pnpm `node_modules` type-checks props. |
| React 19 | `ref` is a prop (no `forwardRef`). Imperative handle still exposes `pageFlip()`. |
| `PageFlip.destroy()` | No longer removes the host DOM node (the React tree owns it). |
| CSS | Injected at runtime. Also exported as `@gullabs/flipbook-core/style.css`. |
| `updateFromHtml` | Rebuilds `PageCollection` and emits typed `update` **and** `collectionRebuild`. Attach listeners before calling (the binding does this). |
| Constructor-only settings | `updateSettings(partial)` restamps `usePortrait` / `useMouseEvents` / etc. The React binding remounts when `showCover` / `size` / `width` / `height` change. |

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
