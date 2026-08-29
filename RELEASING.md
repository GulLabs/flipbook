# Releasing

Publishing runs from GitHub Actions, never from a laptop. The **Release**
workflow triggers on a successful **CI** run on `main` and checks out that
exact commit (`workflow_run` + `head_sha`), so what ships is what CI proved.

Packages are `@gullabs/flipbook-core` and `@gullabs/react-flipbook`, currently
versioned **3.0.0**. They are `fixed` in `.changeset/config.json` and always
move together.

The release job:

1. `pnpm install --frozen-lockfile`
2. `pnpm preflight` — publishable packages point at this repo, ship dist-only,
   core stays dependency-free, TypeScript stays inside typescript-eslint's
   supported range
3. `changesets/action` → `pnpm release`, which is `pnpm build && changeset publish`

The build is inside the publish script on purpose: both packages declare
`files: ["dist"]`, so publishing an unbuilt workspace ships an empty tarball.
`prepack` in each package covers `npm pack` and manual publishes for the same
reason.

## One-time setup

1. **`NPM_TOKEN` repository secret.** An npm **granular access token** scoped to
   the `@gullabs` packages, with write access and the shortest expiry you will
   tolerate re-issuing. Repo → Settings → Secrets and variables → Actions.

   The workflow sets both `NODE_AUTH_TOKEN` (which the `.npmrc` written by
   `setup-node` expands) and `NPM_TOKEN` (which changesets reads). Setting only
   one is the classic failure: publish dies with `ENEEDAUTH`.

2. **Provenance.** `NPM_CONFIG_PROVENANCE=true` with `id-token: write` makes npm
   attach a signed provenance attestation linking each published tarball to this
   repository, workflow and commit. Consumers can verify it with
   `npm audit signatures`. This works with a token — it is not the same thing as
   trusted publishing.

3. **Branch protection on `main`.** Require the `CI / verify` and `CI / e2e`
   checks. Restrict who can push. (Not verifiable from the repo; a human must
   confirm it.)

### On OIDC trusted publishing

npm's trusted publishing would remove the long-lived token entirely, and it is
worth moving to — but not silently. Two things must be true first: `changeset
publish` resolves to `pnpm publish` in this workspace, so pnpm must be a version
that implements OIDC (10+), and each package needs a trusted publisher
registered on npmjs.com naming this repository and `release.yml` **before** the
first publish. Until both are done, a token-less workflow fails closed at
publish time. `gul-labs/any-llm` publishes with the token + provenance path
today; this repo matches it deliberately.

## Manual release (emergency only)

```bash
pnpm install --frozen-lockfile
pnpm quality:ci
pnpm release          # builds, then changeset publish
```

Prefer restoring CI publishing over leaving a long-lived token on a laptop.

## Rollback / yank

If a bad version reaches npm:

1. **Do not force-push** git tags that already published.
2. **Deprecate** the bad version on **both** fixed packages (they move together):

   ```bash
   npm deprecate @gullabs/flipbook-core@X.Y.Z "Broken release; use X.Y.Z+1"
   npm deprecate @gullabs/react-flipbook@X.Y.Z "Broken release; use X.Y.Z+1"
   ```

3. Open a **patch** release via Changesets that fixes the defect and publish
   through the normal Release workflow.
4. Unpublish is rarely allowed after 72h and is discouraged; prefer deprecate +
   patch. See npm docs on
   [deprecate](https://docs.npmjs.com/cli/v10/commands/npm-deprecate) vs
   [unpublish](https://docs.npmjs.com/cli/v10/commands/npm-unpublish).
