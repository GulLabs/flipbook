# Contributing

Thanks for looking. This monorepo holds the page-flip core and React wrapper maintained by [Gul Labs](https://github.com/GulLabs).

Only [@atifgul99](https://github.com/atifgul99) can push or merge to `main`. Everyone else works on a fork or a feature branch and opens a pull request.

## Dev setup

**Node `20.19.x`** (see `.nvmrc` and `engines`: `>=20.19.0`). Use `nvm use` / `fnm use` so local Node matches CI. Package manager is **pnpm 9.12.0** (see `packageManager` in the root `package.json`).

```bash
pnpm install
pnpm build              # packages only
pnpm build:examples     # vanilla / vite-react / nextjs demos
pnpm build:all          # packages + examples
pnpm typecheck          # packages + examples
pnpm lint               # ESLint flat config, --max-warnings=0 (incl. examples)
pnpm test               # Vitest unit (core + react projects)
pnpm test:coverage      # v8 coverage + thresholds
pnpm quality            # fast local: preflight + typecheck + lint + test
pnpm quality:ci         # **merge bar**: + format:check + coverage + package build + size + isolated types
pnpm quality:examples   # demo builds only
pnpm quality:full       # quality:ci + examples + full audit
```

### Which quality command?

| Command                 | When                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `pnpm quality`          | Day-to-day while iterating on packages                                        |
| `pnpm quality:ci`       | Before opening a PR / ready-for-review — **same packages bar as CI `verify`** |
| `pnpm quality:examples` | When you touch `examples/*`                                                   |
| `pnpm quality:full`     | Optional full local sweep                                                     |

CI runs **`verify`** (`quality:ci` on packages) and a separate **`examples`** job (`quality:examples`). The release gate uses the packages bar only.

The Next.js example can flake on Node versions other than `.nvmrc`; pin Node 20.19 before blaming the library.

Demo-only Next lint rules (`@next/eslint-plugin-next`) are intentionally **not** in the monorepo ESLint config — examples share the React/TS bar (LINT-007).

## AI agents

If you are (or are directing) an AI coding agent, [`AGENTS.md`](AGENTS.md) is
mandatory reading — it encodes the working standards this repo enforces, and
`CLAUDE.md` documents the architecture and invariants.

## Principles

- Keep the public surface small. Breaking changes follow SemVer.
- Prefer focused diffs. One concern per PR.
- Do not commit secrets, live credentials, or customer payloads.
- Preserve upstream MIT attribution in `LICENSE` / `NOTICE`.
- Core stays **zero runtime dependencies**.

## Pull requests

1. Branch from `main` (or fork).
2. Keep the diff focused.
3. Run `pnpm quality:ci` locally when the change touches packages.
4. Fill in the PR template.
5. Wait for CI `verify` (and `examples` if you touched demos) to go green.

## Code owners

See [`CODEOWNERS`](./CODEOWNERS). Default owner is `@atifgul99`.

## Conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Developer Certificate of Origin

Commits should include a `Signed-off-by: Name <email>` trailer (DCO). No CLA.
