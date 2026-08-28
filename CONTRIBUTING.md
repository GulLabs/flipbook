# Contributing

Thanks for looking. This monorepo holds the page-flip core and React wrapper maintained by [Gul Labs](https://github.com/GulLabs).

Only [@atifgul99](https://github.com/atifgul99) can push or merge to `main`. Everyone else works on a fork or a feature branch and opens a pull request.

## Dev setup

Node `>=20.9.0`. Package manager is **pnpm 9.12.0** (see `packageManager` in the root `package.json`).

```bash
pnpm install
pnpm build
pnpm quality   # same gate CI runs
```

## Principles

- Keep the public surface small. Breaking changes follow SemVer.
- Prefer focused diffs. One concern per PR.
- Do not commit secrets, live credentials, or customer payloads.
- Preserve upstream MIT attribution in `LICENSE` / `NOTICE`.

## Pull requests

1. Branch from `main` (or fork).
2. Keep the diff focused.
3. Run `pnpm quality` locally when the change touches packages.
4. Fill in the PR template.
5. Wait for CI (`verify`) to go green.

## Code owners

See [`CODEOWNERS`](./CODEOWNERS). Default owner is `@atifgul99`.

## Conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Developer Certificate of Origin

Commits should include a `Signed-off-by: Name <email>` trailer (DCO). No CLA.
