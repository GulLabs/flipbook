/**
 * Permanence guard: published package.json repository metadata must keep the
 * `gul-labs/flipbook` org/repo path exactly. The path is matched literally against
 * the provenance attestation — a redirect from a former org name does not satisfy
 * it, and neither does different casing. The Release workflow compares the same
 * path to `GITHUB_REPOSITORY` immediately before publish. After an org/repo
 * rename, update `repoPath` here first so CI and the Release gate stay aligned.
 *
 * Mirrors gul-labs/any-llm `packages/core/src/package-metadata.test.ts`.
 * Imports manifests as JSON so the core tsconfig (DOM lib, no @types/node) typechecks.
 */

import { describe, expect, it } from 'vitest';
import corePkg from '../package.json';
import reactPkg from '../../react/package.json';

const repoPath = 'gul-labs/flipbook';
const hostedUrl = `https://github.com/${repoPath}`;

type Manifest = {
  name?: string;
  private?: boolean;
  repository?: { type?: string; url?: string; directory?: string };
  homepage?: string;
  bugs?: string;
};

/** Every public workspace package — keep this list complete. */
const publishedManifests: { dir: string; pkg: Manifest }[] = [
  { dir: 'core', pkg: corePkg },
  { dir: 'react', pkg: reactPkg },
];

describe('published package metadata', () => {
  it('lists every public workspace package', () => {
    expect(publishedManifests.map((m) => m.dir).sort()).toEqual(['core', 'react']);
  });

  it.each(publishedManifests)(
    '$dir repository path is exactly gul-labs/flipbook',
    ({ dir, pkg }) => {
      expect(pkg.private).not.toBe(true);
      expect(typeof pkg.name).toBe('string');
      expect(pkg.repository?.type).toBe('git');
      expect(pkg.repository?.directory).toBe(`packages/${dir}`);
      expect(pkg.repository?.url).toMatch(
        new RegExp(`^(?:git\\+)?https://github\\.com/${repoPath}(?:\\.git)?$`),
      );
      expect(pkg.homepage).toBe(`${hostedUrl}/tree/main/packages/${dir}#readme`);
      expect(pkg.bugs).toBe(`${hostedUrl}/issues`);
    },
  );
});
