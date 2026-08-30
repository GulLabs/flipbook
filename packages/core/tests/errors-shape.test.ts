import { describe, expect, test } from 'vitest';
// `../src` alongside the package specifier, and both on purpose.
//
// This comment used to say the package specifier could not be trusted for a
// type-level assertion, because `tsc` resolved it to whatever
// `packages/core/dist/index.d.ts` last held while vitest aliased it to `src` —
// so the same assertion passed or failed depending on when someone last ran
// `pnpm build`. That was true and is what led to finding it. It is fixed (S4):
// the three test-including tsconfigs now carry a matching `paths` mapping, so
// both specifiers reach `src` under tsc and under vitest alike.
//
// The direct `../src` import stays as the belt-and-braces half — it cannot be
// re-broken by a tsconfig edit — while the package-specifier import below is
// what proves the PUBLIC surface actually re-exports these.
import { PageFlipError } from '../src/errors';
import type { FlipbookEventName } from '@gullabs/flipbook-core';
import { PageFlipError as ExportedPageFlipError } from '@gullabs/flipbook-core';

describe('PageFlipError shape', () => {
  test('is an Error subclass with a stable name and code', () => {
    const err = new PageFlipError('boom', 'INVALID_SIZE');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PageFlipError);
    expect(err.name).toBe('PageFlipError');
    expect(err.code).toBe('INVALID_SIZE');
    expect(err.message).toBe('boom');

    // …and the class reached through the public entry point is the same one,
    // so the shape pinned here is the shape consumers get.
    expect(ExportedPageFlipError).toBe(PageFlipError);
  });

  test('defaults the code rather than leaving it undefined', () => {
    expect(new PageFlipError('boom').code).toBe('PAGE_FLIP');
  });

  test('exposes `cause` on the published type, not only at runtime', () => {
    const root = new Error('root');
    const err = new PageFlipError('wrapper', 'CANVAS_LOAD', { cause: root });

    // The load-bearing half of this test is the property access itself: `lib`
    // is ES2020, which predates `Error.cause`, so before `cause` was declared
    // on the class this line failed `pnpm typecheck` with TS2339 — the .d.ts
    // denied a property the constructor had always attached. `tsconfig.json`
    // includes `tests`, so that failure is a gate failure, not a lint nit.
    const cause: unknown = err.cause;

    expect(cause).toBe(root);
  });

  test('an error built without a cause reads back `undefined`', () => {
    // Deliberately `=== undefined` and not `'cause' in err`. Whether the key
    // physically exists is decided by `useDefineForClassFields`, which nobody
    // sets here — it is derived from `target`, so it is `false` at `es2020`
    // (no field emitted) and would flip to `true` at `es2022`. Measured both
    // ways through esbuild while writing this. Asserting the key's absence
    // would pin a compiler flag rather than the contract, and would go red on
    // a target bump that changed nothing a consumer can see.
    expect(new PageFlipError('boom', 'NOT_LOADED').cause).toBeUndefined();
  });

  test('an explicit undefined cause is not attached', () => {
    expect(new PageFlipError('boom', 'NOT_LOADED', { cause: undefined }).cause).toBeUndefined();
  });

  test('cause survives being thrown and caught', () => {
    const root = new TypeError('root');

    try {
      throw new PageFlipError('wrapper', 'CANVAS_LOAD', { cause: root });
    } catch (e) {
      expect(e).toBeInstanceOf(PageFlipError);
      expect((e as PageFlipError).cause).toBe(root);
      expect((e as PageFlipError).code).toBe('CANVAS_LOAD');
    }

    expect.assertions(3);
  });
});

/**
 * E10 — `FlipbookEventName` reaches the published surface.
 *
 * The union existed in the module and was never re-exported, so a consumer
 * writing a helper that takes "an event name" had no type to use. This is a
 * type-only assertion, which is why it is here and not a runtime expectation:
 * it fails at `pnpm typecheck`, and since the tsconfig `paths` fix that grades
 * SOURCE rather than the last build, that failure is real.
 */
describe('E10 — the event-name union is part of the public surface', () => {
  test('a consumer can type a parameter as an event name', () => {
    const names: FlipbookEventName[] = ['flip', 'changeState', 'turnRejected'];

    // @ts-expect-error — a name the engine does not emit is not assignable.
    const bad: FlipbookEventName[] = ['flpi'];

    expect(names).toHaveLength(3);
    expect(bad).toHaveLength(1);
  });
});
