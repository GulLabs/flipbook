# Releasing

Publishing is intended to run from GitHub Actions on `main` after CI is green — not from a developer laptop.

## Current state

The monorepo currently vendors the historical `page-flip` and `react-pageflip` packages. Scoped `@gullabs/*` package names, Changesets, and npm provenance are the target release path (same pattern as [GulLabs/any-llm](https://github.com/GulLabs/any-llm)).

Until that cutover lands:

1. Do not publish from a local machine unless it is an emergency.
2. Keep `repository.url` on every publishable `package.json` pointing at `https://github.com/GulLabs/flipbook.git`.
3. When Changesets is wired, the Release workflow will request `id-token: write` and set `NPM_CONFIG_PROVENANCE=true`.

## Required repository secret (when publishing)

| Secret      | Description                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `NPM_TOKEN` | npm automation token with publish access to the packages you own (eventually `@gullabs` scope). |

`GITHUB_TOKEN` is provided by GitHub Actions.

## Manual release (emergency only)

```bash
pnpm install
pnpm -r build
# publish individual packages only if you know what you are doing
```

Prefer CI once the Release workflow is active.
