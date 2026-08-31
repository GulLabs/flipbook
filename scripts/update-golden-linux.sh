#!/usr/bin/env bash
# Regenerate the Linux golden baselines that CI compares against.
#
# Screenshot baselines are per-platform: Playwright looks for
# `<name>-<project>-<platform>.png`, so baselines written on macOS are invisible
# to an ubuntu-latest runner, and the test fails with "A snapshot doesn't
# exist". Generating them here — in the same image CI uses — is the only way the
# committed baselines mean anything.
#
# Usage: pnpm test:e2e:golden:update:linux
set -euo pipefail

PW_VERSION="$(node -p "require('@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

echo "Staging a clean copy of the worktree (no node_modules / dist)…"
tar --exclude=node_modules \
    --exclude=.git \
    --exclude='**/dist' \
    --exclude='**/.next' \
    --exclude='**/size-check' \
    --exclude=test-results \
    --exclude=playwright-report \
    --exclude=coverage \
    -cf - -C "$REPO_ROOT" . | (cd "$STAGE" && tar xf -)

echo "Running golden suite in ${IMAGE}…"
docker run --rm -v "$STAGE":/work -w /work -e CI=1 "$IMAGE" bash -lc '
  corepack enable >/dev/null 2>&1
  # The Playwright webServer command shells out to `pnpm`, which is not on PATH
  # in the image; corepack provides it.
  printf "#!/bin/sh\nexec corepack pnpm \"\$@\"\n" > /usr/local/bin/pnpm
  chmod +x /usr/local/bin/pnpm
  corepack pnpm install --frozen-lockfile
  corepack pnpm exec playwright test e2e/golden-flip.spec.ts --update-snapshots
'

echo "Copying *-linux.png baselines back…"
cp "$STAGE"/e2e/golden-flip.spec.ts-snapshots/*-linux.png \
   "$REPO_ROOT"/e2e/golden-flip.spec.ts-snapshots/

echo "Done. Review the diff before committing — a changed baseline is either a"
echo "real rendering regression or an intended visual change."
