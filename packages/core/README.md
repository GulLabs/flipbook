# @gullabs/flipbook-core

Framework-agnostic page-curl engine. Maintained fork of StPageFlip.

See the monorepo [README](../../README.md) and [MIGRATION.md](../../MIGRATION.md).

```ts
import { PageFlip } from '@gullabs/flipbook-core';

const pageFlip = new PageFlip(root, { width: 400, height: 300 });
pageFlip.loadFromHTML(pages);
// loadFromImages was removed — use <img> elements inside HTML pages (ADR 0002).
```

License: **MPL-2.0** — file-level copyleft, with no license requirement on the
application you build around it.

Obligations are triggered by distribution, not by modification: private and
internal use carries none. On distribution they reach only this package's own
files (the Covered Software). Any distribution of the engine's source —
modified or not — is under MPL-2.0, with the license notice and without
restricting recipients' rights in it (§3.1). Distributing it in built form,
which includes serving bundled JavaScript to a browser, requires both that the
corresponding source be available on those terms and that recipients be
informed how to obtain it, for each distribution (§3.2).

For the common case — unmodified, installed from npm — the Source Code Form is
<https://github.com/gul-labs/flipbook>, not this package (which ships `dist`
only, and so is Executable Form). Availability is therefore already met, and
what falls to you is the notice: an acknowledgements line naming the package,
its license and that repository URL. If you modified the engine, publish your
version and point the notice there instead.

Copyright (c) 2026 Gul Labs, with upstream Nodlik MIT notices in
[LICENSE](./LICENSE).

## Error codes

Public and engine-boundary failures throw `PageFlipError` with a stable `code`:

| Code                     | When                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `PAGE_FLIP`              | Generic / unspecified                                                  |
| `NOT_LOADED`             | API used before load finished wiring                                   |
| `INVALID_PAGE`           | Page index out of range                                                |
| `PAGE_NOT_IN_SPREAD`     | Page exists but is in no spread                                        |
| `INVALID_SPREAD`         | Spread index invalid during a turn                                     |
| `DESTROYED`              | Called on an engine that has been destroyed                            |
| `INVALID_SWIPE_DISTANCE` | Non-finite or negative `swipeDistance`                                 |
| `INVALID_Z_INDEX`        | `startZIndex` not an integer                                           |
| `INVALID_SHADOW_OPACITY` | Outside `[0, 1]`, or non-finite                                        |
| `INVALID_BOOLEAN`        | A boolean setting was not a real boolean (`'false'`, `0`, `1`, …)      |
| `DETACHED_PAGE`          | A page element left the document mid-turn                              |
| `WRONG_MODE`             | `updateFromHtml` against a non-HTML UI (future renderer guard)         |
| `CANVAS_REMOVED`         | `loadFromImages` / `updateFromImages` — canvas mode removed (ADR 0002) |
| `INVALID_SIZE`           | `size` is not `'fixed'` or `'stretch'`                                 |
| `INVALID_DIMENSIONS`     | `width` / `height` non-finite or `<= 0`                                |
| `INVALID_BOUNDS`         | min/max width or height non-finite or negative                         |
| `INVALID_FLIPPING_TIME`  | Negative or non-finite `flippingTime`                                  |
| `INVALID_DIRECTION`      | `direction` not `ltr`/`rtl`                                            |
| `INVALID_INDEX`          | Internal array access out of range                                     |
| `FLIP_SETUP`             | Could not prepare flipping/bottom pages for a turn                     |
| `RENDER_SETUP`           | Shadow/DOM render setup failed                                         |
| `NO_ANIMATION_FRAME`     | Animation frame list was empty                                         |
| `COLLINEAR_SEGMENTS`     | Geometry: segments are collinear                                       |
| `DEGENERATE_SEGMENT`     | Geometry: a segment has zero length                                    |

`PageFlip.flipNext` / `flipPrev` return `boolean` (`false` = did not start) and emit `turnRejected` when refused.
