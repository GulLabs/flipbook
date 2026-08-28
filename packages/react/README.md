# @gullabs/react-flipbook

React 18/19 binding for `@gullabs/flipbook-core`. Maintained fork of react-pageflip.

See the monorepo [README](../../README.md) and [MIGRATION.md](../../MIGRATION.md).

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

`react` is a peer dependency (`>=18`). License: MIT. Copyright (c) 2026 GulLabs, with upstream notices in [LICENSE](./LICENSE).
