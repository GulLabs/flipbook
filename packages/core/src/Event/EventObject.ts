/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageFlip } from '../PageFlip';
import type { FlippingState } from '../Flip/Flip';
import type { Orientation } from '../Render/Render';

export type FlipbookEventMap = {
  flip: number;
  changeOrientation: Orientation;
  changeState: FlippingState;
  init: { page: number; mode: Orientation };
  update: { page: number; mode: Orientation };
  collectionRebuild: { page: number; pageCount: number };
  turnRejected: { reason: 'boundary' | 'setup' | 'disabled' | 'superseded'; code?: string };
};

/**
 * Data type passed to the event handler
 */
export interface WidgetEvent<T = unknown> {
  data: T;
  object: PageFlip;
}

type EventCallback<T = unknown> = (e: WidgetEvent<T>) => void;

/**
 * A class implementing a basic event model
 */
export abstract class EventObject {
  private events = new Map<string, EventCallback[]>();

  public on<K extends keyof FlipbookEventMap>(
    eventName: K,
    callback: EventCallback<FlipbookEventMap[K]>,
  ): this;
  public on(eventName: string, callback: EventCallback): this;
  public on(eventName: string, callback: EventCallback): this {
    const list = this.events.get(eventName);
    if (!list) {
      this.events.set(eventName, [callback]);
    } else {
      list.push(callback);
    }
    return this;
  }

  public off(event: string): this {
    this.events.delete(event);
    return this;
  }

  /**
   * Forget every registered listener.
   *
   * Y2. `off(name)` is per-event and the consumer has to remember every name
   * they bound, so the only complete unbind was "drop the whole engine" — and
   * that does not work: a callback is a closure, and under React it captures
   * component state, refs and DOM. `PageFlip.destroy()` nulls `pages`,
   * `render`, `ui` and `flipController` precisely because retention is part of
   * its documented contract; the listener map was the one reference it kept, so
   * a consumer holding a destroyed engine still held everything its handlers
   * had closed over.
   *
   * Deliberately `protected`, and deliberately not lifecycle-aware:
   *
   * - `EventObject` is a plain emitter with no notion of being destroyed, and
   *   teaching it one to make `on()` refuse after a teardown it cannot observe
   *   would put the engine's lifecycle in the wrong class. So `on()` and
   *   `off()` keep meaning exactly what they always meant — `on()` after a
   *   clear registers, `off()` deletes, both on a map that is simply empty.
   * - `protected` because the class is not exported from the package entry
   *   (only its types are), so this adds no public surface. Consumers already
   *   have `off(name)`.
   */
  protected clearListeners(): void {
    this.events.clear();
  }

  protected trigger<K extends keyof FlipbookEventMap>(
    eventName: K,
    app: PageFlip,
    data: FlipbookEventMap[K],
  ): void;
  protected trigger(eventName: string, app: PageFlip, data?: unknown): void;
  protected trigger(eventName: string, app: PageFlip, data: unknown = null): void {
    const list = this.events.get(eventName);
    if (!list) return;
    for (const callback of list) {
      callback({ data, object: app });
    }
  }
}
