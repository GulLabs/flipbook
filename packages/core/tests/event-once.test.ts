import { describe, expect, test, vi } from 'vitest';
import { EventObject } from '../src/Event/EventObject';
import type { BookSnapshot } from '../src/Event/EventObject';
import type { PageFlip } from '../src/PageFlip';

const snap = (page: number): BookSnapshot => ({
  page,
  pageCount: 10,
  orientation: 'portrait',
  visiblePages: [page],
});

/**
 * `EventObject` in isolation, driven directly rather than through a book.
 *
 * Deliberate, and worth stating: this file imports `EventObject` and NOTHING
 * else at runtime — its only other imports are `import type`, which are erased.
 * So these tests exercise the emitter itself, with no engine, no jsdom, no
 * fixture, and therefore none of the shortcuts that have produced fourteen
 * tests in this repo that passed against broken code. There is nothing between
 * the assertion and the behaviour.
 *
 * E9 (`once`) is the subject; E3 (`off(event, callback)`) and E1 (the dispatch
 * snapshot) are re-asserted where `once` interacts with them, because that
 * interaction is where a one-shot listener goes wrong.
 */

/** The emitter is abstract and `trigger` is protected; this exposes both. */
class Emitter extends EventObject {
  public emit(name: 'flip', data: BookSnapshot): void {
    this.trigger(name, this as unknown as PageFlip, data);
  }
}

describe('EventObject.once', () => {
  test('runs exactly once, then detaches itself', () => {
    const book = new Emitter();
    const seen: number[] = [];

    book.once('flip', (e) => seen.push(e.data.page));

    book.emit('flip', snap(1));
    book.emit('flip', snap(2));
    book.emit('flip', snap(3));

    expect(seen).toEqual([1]);
  });

  test('receives the payload, not just the call', () => {
    // Without this, a `once` that fires with a mangled or missing event object
    // still satisfies "runs exactly once".
    const book = new Emitter();
    const calls: Array<{ data: BookSnapshot; object: unknown }> = [];

    book.once('flip', (e) => calls.push({ data: e.data, object: e.object }));
    book.emit('flip', snap(7));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual(snap(7));
    expect(calls[0]?.object).toBe(book);
  });

  test('off(event, yourCallback) cancels it before it ever fires', () => {
    // The reason `once` tags its wrapper. The consumer holds `fn`; the map
    // holds an anonymous wrapper they have never seen. Without the tag this
    // `off` silently does nothing and the listener fires anyway — an `off`
    // that reports success and detaches nothing.
    const book = new Emitter();
    const fn = vi.fn();

    book.once('flip', fn);
    book.off('flip', fn);
    book.emit('flip', snap(1));

    expect(fn).not.toHaveBeenCalled();
  });

  test('a once listener detaches even if the callback throws', () => {
    // Detachment happens BEFORE the callback. A consumer whose handler throws
    // is already having a bad day; re-firing their broken one-shot handler on
    // the next turn makes it worse, and hides the original error behind a
    // second identical one.
    const book = new Emitter();
    let calls = 0;

    book.once('flip', () => {
      calls += 1;
      throw new Error('consumer defect');
    });

    expect(() => {
      book.emit('flip', snap(1));
    }).toThrow('consumer defect');

    // The second emit must be silent — the listener is gone.
    expect(() => {
      book.emit('flip', snap(2));
    }).not.toThrow();
    expect(calls).toBe(1);
  });

  test('once and on coexist, and only the once one detaches', () => {
    const book = new Emitter();
    const persistent: number[] = [];
    const oneShot: number[] = [];

    book.on('flip', (e) => persistent.push(e.data.page));
    book.once('flip', (e) => oneShot.push(e.data.page));

    book.emit('flip', snap(1));
    book.emit('flip', snap(2));

    // The negative control: if `once` detached the whole event (the E3 bug it
    // depends on having been fixed), `persistent` would stop at [1].
    expect(persistent).toEqual([1, 2]);
    expect(oneShot).toEqual([1]);
  });

  test('two once listeners for the same event both fire, once each', () => {
    const book = new Emitter();
    const a: number[] = [];
    const b: number[] = [];

    book.once('flip', (e) => a.push(e.data.page));
    book.once('flip', (e) => b.push(e.data.page));

    book.emit('flip', snap(1));
    book.emit('flip', snap(2));

    // Kills a `once` implemented by clearing the event's whole listener list,
    // which passes every single-listener test above.
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });

  test('a once registered DURING a dispatch waits for the next emit', () => {
    // `trigger` snapshots the listener list, which is `EventEmitter`'s rule and'
    // what stops a self-registering handler looping forever. If `once` bypassed
    // the snapshot, the re-registration below would fire within the same emit
    // and recurse without end — this test would hang rather than fail.
    const book = new Emitter();
    const seen: number[] = [];
    let armed = 0;

    const arm = (): void => {
      armed += 1;
      book.once('flip', (e) => {
        seen.push(e.data.page);
        if (armed < 3) arm();
      });
    };
    arm();

    book.emit('flip', snap(1));
    book.emit('flip', snap(2));
    book.emit('flip', snap(3));
    book.emit('flip', snap(4));

    expect(seen).toEqual([1, 2, 3]);
  });

  test('off(event) with no callback still removes once listeners', () => {
    const book = new Emitter();
    const fn = vi.fn();

    book.once('flip', fn);
    book.off('flip');
    book.emit('flip', snap(1));

    expect(fn).not.toHaveBeenCalled();
  });

  test('off with an unrelated callback detaches nothing', () => {
    // The other direction of the tag lookup: matching by `__onceOriginal` must
    // not turn `off` into "remove something, anything".
    const book = new Emitter();
    const fn = vi.fn();

    book.once('flip', fn);
    book.off('flip', vi.fn());
    book.emit('flip', snap(1));

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('once returns the emitter, so it chains like on', () => {
    const book = new Emitter();
    expect(book.once('flip', vi.fn())).toBe(book);
  });
});
