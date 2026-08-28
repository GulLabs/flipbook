# Releasing

Publishing runs from GitHub Actions on `main` after the **Release** workflow’s
same-SHA `gate` job is green — not from a developer laptop.

Packages are `@gullabs/flipbook-core` and `@gullabs/react-flipbook`, currently
versioned **3.0.0**. The workflow (`.github/workflows/release.yml`) runs:

1. **`gate`** — gitleaks, `pnpm audit`, `pnpm quality:ci` (packages bar)
2. **`release`** — Changesets publish with **OIDC trusted publishing only**
   (`id-token: write`, `NPM_CONFIG_PROVENANCE=true`, no long-lived `NPM_TOKEN`)

3. Do not publish from a local machine unless it is an emergency.
4. Keep `repository.url` on every publishable `package.json` pointing at
   `https://github.com/GulLabs/flipbook.git`.
5. First 3.0.0 publish is from the committed package versions (no pending
   changeset). Later minors/patches go through Changesets.

## One-time setup (ops — outside the repo)

These steps activate the in-repo OIDC path. Until they are done, publish will
fail closed (no classic token fallback).

1. **GitHub Environment `npm-publish`**  
   Repo → Settings → Environments → create `npm-publish`. Optionally require
   reviewers before the release job runs.

2. **npm trusted publishers** for both packages  
   On [npmjs.com](https://www.npmjs.com/), for `@gullabs/flipbook-core` and
   `@gullabs/react-flipbook`, add a trusted publisher:
   - Provider: GitHub Actions
   - Repository: `GulLabs/flipbook`
   - Workflow: `release.yml`
   - Environment: `npm-publish` (if required by npm UI)

3. **Branch protection on `main`** (human check — not auto-verified from git)  
   Require status check `CI / verify` (packages quality). Prefer also
   Dependency Review and CodeQL. Restrict who can push to `main`.

`GITHUB_TOKEN` is provided by GitHub Actions. There is **no** `NPM_TOKEN`
secret in the release path.

## Manual release (emergency only)

If Actions is unavailable and a human must publish once:

```bash
pnpm install
pnpm quality:ci
pnpm exec changeset publish
```

Prefer restoring OIDC CI publish over leaving a long-lived token on a laptop.

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
