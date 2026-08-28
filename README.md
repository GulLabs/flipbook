# flipbook

Realistic page-turning for the web. Vanilla TypeScript core and a React wrapper.

This is a Gul Labs maintained fork of [StPageFlip](https://github.com/Nodlik/StPageFlip) and [react-pageflip](https://github.com/Nodlik/react-pageflip). Upstream MIT notices are preserved in [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

<p align="center">
  <a href="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml"><img src="https://github.com/GulLabs/flipbook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

## Packages

| Package | Path | Role |
| ------- | ---- | ---- |
| `@gullabs/flipbook-core` | [`packages/core`](./packages/core) | Core page-flip engine (canvas + HTML modes) |
| `react-pageflip` → `@gullabs/react-flipbook` | [`packages/react`](./packages/react) | React hooks wrapper around the core |

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
import HTMLFlipBook from 'react-pageflip';

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
