# flipbook

The maintained page-flip. A modern fork of StPageFlip + react-pageflip with the mobile back-curl finally fixed.

Forked from [Nodlik/StPageFlip](https://github.com/Nodlik/StPageFlip) and [Nodlik/react-pageflip](https://github.com/Nodlik/react-pageflip) (both MIT), merged and maintained by GulLabs.

This is a Gul Labs maintained fork of [StPageFlip](https://github.com/Nodlik/StPageFlip) and [react-pageflip](https://github.com/Nodlik/react-pageflip). Upstream MIT notices are preserved in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

<p align="center">
  <a href="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml"><img src="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

## Packages

| Package | Path | Role |
| ------- | ---- | ---- |
| `@gullabs/flipbook-core` | [`packages/core`](./packages/core) | Core page-flip engine (canvas + HTML modes), zero runtime deps |
| `@gullabs/react-flipbook` | [`packages/react`](./packages/react) | React 18/19 wrapper (`react` peer `>=18`) |

## Why this fork

| Bug | Upstream | Fixed in |
| --- | -------- | -------- |
| Portrait back-curl slides in instead of peeling the current leaf | [StPageFlip #49](https://github.com/Nodlik/StPageFlip/issues/49), [#9](https://github.com/Nodlik/StPageFlip/issues/9) | 3.0.0 |
| Fold is transparent; underlying text bleeds through | engine | 3.0.0 |
| `onUpdate` never fires (`removeHandlers` → `updateFromHtml` → `setHandlers`) | react-pageflip 2.0.3 | 3.0.0 |
| `flippingTime: 0` throws in the constructor | Settings.getSettings | 3.0.0 |
| `flipToPage` swallows errors and lands one page forward | Flip.flipToPage empty catch | 3.0.0 |
| Shipped types lose `react` under pnpm isolated `node_modules` | react-pageflip `index.d.ts` | 3.0.0 |

## Migration

```bash
npm uninstall react-pageflip page-flip && npm i @gullabs/react-flipbook
```

See [`MIGRATION.md`](./MIGRATION.md) for the drop-in `HTMLFlipBook` prop surface and breaking changes.

## Features

- Works with simple images on canvas and complex HTML blocks
- Simple API and flexible configuration
- Mobile-friendly; landscape and portrait
- Soft and hard page types (HTML mode)
- No runtime dependencies in the core library

## Install

```bash
pnpm add @gullabs/flipbook-core
# React wrapper (rename in progress):
# pnpm add @gullabs/react-flipbook
```

See [`RELEASING.md`](./RELEASING.md) for publish status.

## Usage (core)

```js
import { PageFlip } from '@gullabs/flipbook-core';

const pageFlip = new PageFlip(htmlParentElement, settings);
pageFlip.loadFromImages(['page1.jpg', 'page2.jpg']);
// or
pageFlip.loadFromHtml(htmlCollection);
```

## Usage (React)

```tsx
import HTMLFlipBook from '@gullabs/react-flipbook';

export function Book() {
  return (
    <HTMLFlipBook width={300} height={500}>
      <div>Page 1</div>
      <div>Page 2</div>
    </HTMLFlipBook>
  );
}
```

## Development

Node `>=20.9.0`. Package manager is **pnpm 9.12.0**.

```bash
pnpm install
pnpm build
pnpm quality
```

## Contributing

Only [@atifgul99](https://github.com/atifgul99) can push or merge to `main`. Everyone else works on a fork and opens a pull request. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — Copyright (c) 2026 GulLabs, with upstream MIT notices retained.
