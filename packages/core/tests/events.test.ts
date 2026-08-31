/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { EventObject } from '../src/Event/EventObject';
import type { BookSnapshot, WidgetEvent, FlipbookEventMap } from '../src/Event/EventObject';
import type { PageFlip } from '../src/PageFlip';

/** Minimal snapshot payload — flip used to carry a bare page index. */
const snap = (page: number): BookSnapshot => ({
  page,
  pageCount: 10,
  orientation: 'portrait',
  visiblePages: [page],
});

/**
 * `trigger` is protected and `EventObject` is abstract, so the dispatch
 * semantics can only be driven from a subclass. This is the whole engine-side
 * surface the tests need — no DOM, no book.
 */
class Emitter extends EventObject {
  public emit<K extends keyof FlipbookEventMap>(name: K, data: FlipbookEventMap[K]): void {
    // The emitter identity is only ever handed back to listeners as
    // `event.object`; no test reads a `PageFlip` member off it.
    this.trigger(name, this as unknown as PageFlip, data);
  }

  public clear(): void {
    this.clearListeners();
  }
}

type FlipEvent = WidgetEvent<FlipbookEventMap['flip']>;

afterEach(() => {
  vi.useRealTimers();
});

describe('E1 — the listener set is snapshotted at dispatch', () => {
  test('a listener registered during a dispatch does NOT run in that dispatch', () => {
    const book = new Emitter();
    const late = vi.fn();

    book.on('flip', () => {
      book.on('flip', late);
    });

    book.emit('flip', snap(1));
    expect(late).not.toHaveBeenCalled();

    // ...but it is registered, and runs on the next emit.
    book.emit('flip', snap(2));
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0]?.[0]).toMatchObject({ data: snap(2) });
  });

  test('a self-re-registering listener runs exactly once per emit and terminates', () => {
    const book = new Emitter();
    let calls = 0;

    const handler = (): void => {
      calls += 1;
      // The cap is the only reason this test can fail instead of hanging: on
      // the live-array implementation each call appends another listener to
      // the array still being iterated, so the loop never reaches its end.
      if (calls < 500) book.on('flip', handler);
    };

    book.on('flip', handler);
    book.emit('flip', snap(1));

    expect(calls).toBe(1);
  });

  test('a listener removed during a dispatch still runs for that dispatch', () => {
    const book = new Emitter();
    const second = vi.fn();

    book.on('flip', () => {
      book.off('flip');
    });
    book.on('flip', second);

    book.emit('flip', snap(1));
    expect(second).toHaveBeenCalledTimes(1);

    // The removal took effect for every LATER dispatch.
    book.emit('flip', snap(2));
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('a listener that removes itself by reference still runs for that dispatch', () => {
    const book = new Emitter();
    const second = vi.fn();
    const first = vi.fn(() => {
      book.off('flip', first);
      book.off('flip', second);
    });

    book.on('flip', first);
    book.on('flip', second);

    book.emit('flip', snap(1));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    book.emit('flip', snap(2));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('every listener of the dispatch gets its own event object', () => {
    const book = new Emitter();
    const seen: unknown[] = [];

    book.on('flip', (e: FlipEvent) => {
      (e as { data: unknown }).data = 'mutated';
    });
    book.on('flip', (e: FlipEvent) => {
      seen.push(e.data);
    });

    book.emit('flip', snap(7));
    expect(seen).toEqual([snap(7)]);
  });
});

describe('E2 — a throwing listener does not cancel the others', () => {
  test('later listeners still run, and the error still reaches the caller', () => {
    const book = new Emitter();
    const boom = new Error('consumer defect');
    const later = vi.fn();
    const evenLater = vi.fn();

    book.on('flip', () => {
      throw boom;
    });
    book.on('flip', later);
    book.on('flip', evenLater);

    expect(() => {
      book.emit('flip', snap(3));
    }).toThrow(boom);

    expect(later).toHaveBeenCalledTimes(1);
    expect(evenLater).toHaveBeenCalledTimes(1);
    // The surviving listeners got the real payload, not a placeholder.
    expect(later.mock.calls[0]?.[0]).toMatchObject({ data: snap(3) });
  });

  test('the FIRST error is the one thrown; the rest reach the host uncaught', () => {
    vi.useFakeTimers();

    const book = new Emitter();
    const first = new Error('first');
    const second = new Error('second');

    book.on('flip', () => {
      throw first;
    });
    book.on('flip', () => {
      throw second;
    });

    expect(() => {
      book.emit('flip', snap(1));
    }).toThrow(first);

    // Not swallowed: the second error is rethrown on a fresh task, where it
    // becomes window.onerror / uncaughtException instead of vanishing.
    expect(() => {
      vi.runAllTimers();
    }).toThrow(second);
  });

  test('a dispatch with no throwing listener schedules nothing', () => {
    vi.useFakeTimers();

    const book = new Emitter();
    book.on('flip', vi.fn());
    book.emit('flip', snap(1));

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('E3 — off(event, callback) detaches one listener', () => {
  test('detaching one flip handler leaves the other attached', () => {
    const book = new Emitter();
    const counter = vi.fn();
    const analytics = vi.fn();

    book.on('flip', counter);
    book.on('flip', analytics);

    book.off('flip', counter);
    book.emit('flip', snap(1));

    expect(counter).not.toHaveBeenCalled();
    expect(analytics).toHaveBeenCalledTimes(1);
  });

  test('off(event) with no callback still removes every listener', () => {
    const book = new Emitter();
    const a = vi.fn();
    const b = vi.fn();

    book.on('flip', a);
    book.on('flip', b);
    book.off('flip');
    book.emit('flip', snap(1));

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  test('matching is by reference: an equivalent function does not detach', () => {
    const book = new Emitter();
    const seen: number[] = [];
    const handler = (e: FlipEvent): void => {
      seen.push(e.data.page);
    };

    book.on('flip', handler);
    // Same source, different function object — must NOT detach, or `off` would
    // be silently removing something the caller did not name.
    book.off('flip', (e: FlipEvent): void => {
      seen.push(e.data.page);
    });

    book.emit('flip', snap(5));
    expect(seen).toEqual([5]);
  });

  test('on twice / off once leaves exactly one registration', () => {
    const book = new Emitter();
    const handler = vi.fn();

    book.on('flip', handler);
    book.on('flip', handler);
    book.off('flip', handler);

    book.emit('flip', snap(1));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('off is a no-op for an unknown event or an unregistered callback', () => {
    const book = new Emitter();
    const handler = vi.fn();

    book.on('flip', handler);
    expect(book.off('changeState', handler)).toBe(book);
    expect(book.off('flip', vi.fn())).toBe(book);

    book.emit('flip', snap(1));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('removing the last listener does not resurrect it on the next emit', () => {
    const book = new Emitter();
    const handler = vi.fn();

    book.on('flip', handler);
    book.off('flip', handler);
    book.emit('flip', snap(1));
    book.on('flip', handler);
    book.emit('flip', snap(2));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ data: snap(2) });
  });
});

describe('E4 — an event name that nothing emits is a compile error', () => {
  test('known names compile; a typo does not', () => {
    const book = new Emitter();
    const handler = vi.fn();

    book.on('flip', handler);
    // @ts-expect-error 'flpi' is not an engine event — this used to register
    // silently against a name nothing ever emits (E4).
    book.on('flpi', handler);
    // @ts-expect-error same for `off`.
    book.off('flpi', handler);

    book.emit('flip', snap(1));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('clearListeners still behaves as documented (Y2)', () => {
  test('clear drops everything and on() after a clear registers again', () => {
    const book = new Emitter();
    const handler = vi.fn();

    book.on('flip', handler);
    book.clear();
    book.emit('flip', snap(1));
    expect(handler).not.toHaveBeenCalled();

    book.on('flip', handler);
    book.emit('flip', snap(2));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
