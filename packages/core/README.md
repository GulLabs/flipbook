# @gullabs/flipbook-core

Framework-agnostic page-curl engine. Maintained fork of StPageFlip.

See the monorepo [README](../../README.md) and [MIGRATION.md](../../MIGRATION.md).

```ts
import { PageFlip } from '@gullabs/flipbook-core';

const pageFlip = new PageFlip(root, { width: 400, height: 300 });
pageFlip.loadFromHTML(pages);
await pageFlip.loadFromImages(['page1.jpg', 'page2.jpg']);
```

License: **MPL-2.0** — file-level copyleft, with no license requirement on the
application you build around it.

Obligations are triggered by distribution, not by modification: private and
internal use carries none. On distribution they reach only this package's own
files (the Covered Software) — modified files must be offered under MPL-2.0
(§3.1), and distributing the engine in built form, which includes serving
bundled JavaScript to a browser, requires both that the corresponding source be
available and that recipients be informed how to obtain it (§3.2). For the
common case — unmodified, installed from npm — an acknowledgements line naming
the package, its license and <https://github.com/GulLabs/flipbook> discharges
§3.2.

Copyright (c) 2026 GulLabs, with upstream Nodlik MIT notices in
[LICENSE](./LICENSE).

## Error codes

Public and engine-boundary failures throw `PageFlipError` with a stable `code`:

| Code                    | When                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `PAGE_FLIP`             | Generic / unspecified                                       |
| `NOT_LOADED`            | API used before load finished wiring                        |
| `INVALID_PAGE`          | Page index out of range or not in any spread                |
| `INVALID_SPREAD`        | Spread index invalid during a turn                          |
| `INVALID_SIZE`          | Width/height/size type invalid in settings                  |
| `INVALID_FLIPPING_TIME` | Negative `flippingTime`                                     |
| `INVALID_DIRECTION`     | `direction` not `ltr`/`rtl`                                 |
| `INVALID_INDEX`         | Internal array access out of range                          |
| `FLIP_SETUP`            | Could not prepare flipping/bottom pages for a turn          |
| `RENDER_NOT_READY`      | Bounds requested before layout                              |
| `RENDER_SETUP`          | Shadow/DOM render setup failed                              |
| `REJECTED`              | Programmatic turn did not start (also `turnRejected` event) |

`PageFlip.flipNext` / `flipPrev` return `boolean` (`false` = did not start) and emit `turnRejected` when refused.
