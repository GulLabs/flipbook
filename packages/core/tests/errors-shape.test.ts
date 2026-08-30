import { describe, expect, test } from 'vitest';
// Deliberately `../src`, not `@gullabs/flipbook-core`. Vitest aliases the
// package specifier to `src`, but `tsc` does NOT — it resolves it to whatever
// `packages/core/dist/index.d.ts` happens to hold, i.e. the last build on this
// machine. A type assertion written against the package specifier therefore
// checks stale build output and can pass or fail depending on when someone
// last ran `pnpm build`; measured while writing this file. The `cause`
// assertion below is a type-level gate, so it has to reach the real
// declaration.
import { PageFlipError } from '../src/errors';
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
