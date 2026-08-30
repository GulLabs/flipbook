import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Release workflow runs on `workflow_run`, which is the "pwn request"
 * trigger: it executes in the BASE repository with full secrets — `NPM_TOKEN`
 * and `contents: write` — and it fires for CI runs triggered by
 * `pull_request`, which `ci.yml` accepts from anywhere including forks.
 *
 * The `branches: [main]` filter on a `workflow_run` matches `head_branch`, and
 * for a fork PR that is the FORK's branch name. So a fork whose branch is
 * called `main` satisfies it. Without the guards below, that fork's commit is
 * checked out and built — `pnpm install --frozen-lockfile` with their lockfile,
 * `tsup` with their config — inside a job that can publish to npm.
 *
 * These conditions cannot be unit-tested: GitHub Actions does not run locally.
 * So they are asserted statically instead, and this script is wired into the
 * quality gate. If someone reformats the `if:` or "simplifies" it, the build
 * fails here rather than silently re-opening the hole.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

const REQUIRED = [
  ["github.event.workflow_run.conclusion == 'success'", 'CI must have passed'],
  [
    "github.event.workflow_run.event == 'push'",
    'THE load-bearing one: a pull_request-triggered CI run must never reach the publish job',
  ],
  [
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'the commit must come from this repository, not a fork',
  ],
  ["github.event.workflow_run.head_branch == 'main'", 'and from main specifically'],
];

const missing = REQUIRED.filter(([needle]) => !release.includes(needle));

if (missing.length > 0) {
  console.error('Release workflow is missing required trigger guards:\n');
  for (const [needle, why] of missing) console.error(`  MISSING: ${needle}\n           ${why}\n`);
  console.error(
    'Without all four, a fork PR whose branch is named `main` can reach a job\n' +
      'holding NPM_TOKEN and contents: write, and publish arbitrary code as\n' +
      '@gullabs/*. See the comment above the `if:` in release.yml.',
  );
  process.exit(1);
}

// The publish step must not be reachable without the token being scoped by the
// job's own permissions block; a workflow-level `contents: write` would grant it
// to every future job in the file.
if (/^permissions:\s*\n\s+contents:\s*write/m.test(release)) {
  console.error(
    'release.yml declares `contents: write` at WORKFLOW level. That grants it to\n' +
      'every job added to this file later. Keep elevated permissions on the job\n' +
      'that needs them.',
  );
  process.exit(1);
}

console.log(
  `release workflow: ${String(REQUIRED.length)} trigger guards present, permissions job-scoped`,
);
