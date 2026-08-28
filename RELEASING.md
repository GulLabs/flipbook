# Releasing

Publishing runs from GitHub Actions on `main` after CI is green — not from a developer laptop.

Packages are `@gullabs/flipbook-core` and `@gullabs/react-flipbook`, currently versioned **3.0.0**. The Release workflow (`.github/workflows/release.yml`) uses Changesets with `id-token: write` and `NPM_CONFIG_PROVENANCE=true`.

1. Do not publish from a local machine unless it is an emergency.
2. Keep `repository.url` on every publishable `package.json` pointing at `https://github.com/GulLabs/flipbook.git`.
3. First 3.0.0 publish is from the committed package versions (no pending changeset). Later minors/patches go through Changesets.

## Required repository secret

| Secret      | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `NPM_TOKEN` | npm automation token with publish access to the `@gullabs` scope.           |

`GITHUB_TOKEN` is provided by GitHub Actions.

## Manual release (emergency only)

```bash
pnpm install
pnpm test
pnpm build
pnpm exec changeset publish
```
