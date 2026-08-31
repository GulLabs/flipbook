/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'vitest';

/**
 * Allowlist of `public` members on the façade and on types still named in
 * internal source. Adding any `public` member fails until it is reviewed onto
 * this list (see `src/internal.ts` stopping rule).
 *
 * `getUI` / `getRender` / `getPageCollection` / `getFlipController` /
 * `getPage` were collapsed into façade answers (`getBlockElement`,
 * `getVisiblePages`, `canTurn`, `isReady`, `isAnimating`, `getPageElement`)
 * and symbol-keyed seams. They must not reappear as `public` names.
 */

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
interface NodeProcess {
  cwd(): string;
}

const loadNode = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const fs = await loadNode<NodeFs>('node:fs');
const proc = (globalThis as unknown as { process: NodeProcess }).process;
const SRC = `${proc.cwd()}/packages/core/src`;

function publicMembers(relativePath: string): string[] {
  const source = fs.readFileSync(`${SRC}/${relativePath}`, 'utf8');

  return [...source.matchAll(/^ {2}public (?:readonly )?(\[?[A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1] as string)
    .filter((name) => !name.startsWith('['))
    .sort();
}

describe('the engine public surface is frozen', () => {
  test('PageFlip — consumer façade only', () => {
    expect(publicMembers('PageFlip.ts')).toEqual(
      [
        'canTurn',
        'clear',
        'destroy',
        'flipToPage',
        'flipNext',
        'flipPrev',
        'getBlockElement',
        'getBoundsRect',
        'getCurrentPageIndex',
        'getOrientation',
        'getPageCount',
        'getPageElement',
        'getSettings',
        'getState',
        'getVisiblePages',
        'isAnimating',
        'isDestroyed',
        'isReady',
        'loadFromHTML',
        'startUserTouch',
        'turnToNextPage',
        'turnToPage',
        'turnToPrevPage',
        'update',
        'updateFromHtml',
        'updateSettings',
        'userMove',
        'userStop',
      ].sort(),
    );
  });

  test('closed getters stay off the public list', () => {
    const names = publicMembers('PageFlip.ts');
    for (const closed of [
      'getUI',
      'getRender',
      'getPageCollection',
      'getFlipController',
      'getPage',
      'loadFromImages',
      'updateFromImages',
    ]) {
      expect(names).not.toContain(closed);
    }
  });

  test('UI — only reachable via closed GET_UI seam', () => {
    expect(publicMembers('UI/UI.ts')).toEqual(
      [
        'abstract',
        'applyHostSize',
        'destroy',
        'getDistElement',
        'getWrapper',
        'refreshHandlers',
      ].sort(),
    );
  });

  test('PageCollection — only reachable via closed GET_COLLECTION seam', () => {
    expect(publicMembers('Collection/PageCollection.ts')).toEqual(
      [
        'destroy',
        'getBottomPage',
        'getCurrentPageIndex',
        'getCurrentSpreadIndex',
        'getFlippingPage',
        'getPage',
        'getPageCount',
        'getPages',
        'getSpreadCount',
        'getSpreadIndexByPage',
        'load',
        'nextBy',
        'prevBy',
        'show',
        'showNext',
        'showPrev',
      ].sort(),
    );
  });
});

describe('package entry does not re-export internals', () => {
  test('Settings class and geometry helpers are not on the public entry', async () => {
    const core = await import('@gullabs/flipbook-core');
    expect(core).not.toHaveProperty('Settings');
    expect(core).not.toHaveProperty('isOpaquePageBackground');
    expect(core).not.toHaveProperty('effectiveFlippingTime');
    expect(core).not.toHaveProperty('HTMLPageCollection');
    expect(core).not.toHaveProperty('Render');
    expect(core).not.toHaveProperty('Flip');
    expect(core).toHaveProperty('PageFlip');
    expect(core).toHaveProperty('PageFlipError');
    expect(core).toHaveProperty('SizeMode');
    expect(core).toHaveProperty('ALL_POINTERS');
    expect(core).toHaveProperty('FlipCorner');
    expect(core).toHaveProperty('FlippingState');
  });
});
