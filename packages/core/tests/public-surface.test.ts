/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'vitest';

/**
 * Node reached through a runtime-resolved dynamic import with a hand-written
 * signature, the same way `release-gates.test.ts` does it: this project has no
 * `@types/node`, and adding it to typecheck one test would put Node's globals
 * in scope for the whole engine, which is the opposite of what
 * `ssr-import.test.ts` guards.
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

/**
 * The declared public surface of every engine object a consumer can reach.
 *
 * AN ALLOWLIST, NOT A BLOCKLIST, and that inversion is the whole point.
 *
 * The seam tests used to list the removed method names and assert each was
 * undefined. That is a blocklist, and it failed one round after it was written:
 * two seams of exactly the same shape — `UI.setOrientationStyle` and
 * `PageCollection.setCurrentSpreadIndex` — were simply not on the list, and a
 * measured mutant that re-exposed a closed seam under a NEW name
 * (`public emitState(s) { this[EMIT_STATE](s); }`) passed the entire suite. A
 * list of what is forbidden cannot notice what nobody thought of.
 *
 * So the direction is inverted. Adding any `public` member to these classes
 * fails this test until someone puts it on the list, which is the review step
 * the blocklist skipped.
 *
 * READ FROM SOURCE, not from the runtime object: TypeScript erases `private`
 * and `protected`, so enumerating the prototype at runtime reports `checkTarget`
 * and `swipeDirection` alongside `destroy` — freezing that would be brittle and
 * would imply those are API. `public` in the source is what reaches the emitted
 * `.d.ts`, and the `.d.ts` is the contract.
 *
 * WHEN THIS FAILS, the question to answer is in `src/internal.ts`: if the new
 * member exists only for a sibling engine object to call, AND an outside call
 * could make a public getter lie or fabricate or suppress an event, it belongs
 * behind a symbol rather than on this list.
 */

function publicMembers(relativePath: string): string[] {
  const source = fs.readFileSync(`${SRC}/${relativePath}`, 'utf8');

  return [...source.matchAll(/^ {2}public (?:readonly )?(\[?[A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1] as string)
    .filter((name) => !name.startsWith('[')) // symbol-keyed seams are the closed ones
    .sort();
}

describe('the engine public surface is frozen', () => {
  test('PageFlip', () => {
    expect(publicMembers('PageFlip.ts')).toEqual(
      [
        'attachMode',
        'clear',
        'destroy',
        'flip',
        'flipNext',
        'flipPrev',
        'getBlock',
        'getBoundsRect',
        'getCurrentPageIndex',
        'getFlipController',
        'getOrientation',
        'getPage',
        'getPageCollection',
        'getPageCount',
        'getRender',
        'getSettings',
        'getState',
        'getUI',
        'isDestroyed',
        'loadFromHTML',
        'replacePages',
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

  test('UI — reachable through getUI()', () => {
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

  test('PageCollection — reachable through getPageCollection()', () => {
    expect(publicMembers('Collection/PageCollection.ts')).toEqual(
      [
        'abstract',
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
        'nextBy',
        'prevBy',
        'show',
        'showNext',
        'showPrev',
      ].sort(),
    );
  });
});
