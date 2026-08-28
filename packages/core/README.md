# @gullabs/flipbook-core

Framework-agnostic page-curl engine. Maintained fork of StPageFlip.

See the monorepo [README](../../README.md) and [MIGRATION.md](../../MIGRATION.md).

```ts
import { PageFlip } from '@gullabs/flipbook-core';

const pageFlip = new PageFlip(root, { width: 400, height: 300 });
pageFlip.loadFromHTML(pages);
await pageFlip.loadFromImages(['page1.jpg', 'page2.jpg']);
```

License: MIT. Copyright (c) 2026 GulLabs, with upstream Nodlik notices in [LICENSE](./LICENSE).
