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
  turnRejected: { reason: 'boundary' | 'setup' | 'disabled'; code?: string };
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
