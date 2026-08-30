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

/** Every event this engine can emit. */
export type FlipbookEventName = keyof FlipbookEventMap;

/**
 * Rethrow on a fresh task so the error reaches the host's uncaught handler
 * (`window.onerror` / Node's `uncaughtException`) instead of vanishing.
 *
 * Only ever used for the SECOND and later errors of a single dispatch — the
 * first is thrown synchronously, so a caller that already wraps
 * `updateFromHtml` in `try`/`catch` keeps seeing exactly what it sees today.
 * `setTimeout` and not `queueMicrotask`, because a microtask thrown from inside
 * a promise job is reported inconsistently across runtimes; a timer callback is
 * an uncaught exception everywhere.
 */
function rethrowAsync(error: unknown): void {
  setTimeout(() => {
    throw error;
  }, 0);
}

/**
 * A class implementing a basic event model
 */
export abstract class EventObject {
  private events = new Map<string, EventCallback[]>();

  /** See {@link EventObject.deferListenerErrors}. */
  private deferErrors = false;

  /**
   * E4: the event name is constrained to `FlipbookEventMap`.
   *
   * There used to be a second, permissive `on(eventName: string, …)` overload,
   * which made `book.on('flpi', …)` a silent no-op forever: it registered
   * against a name nothing emits. Dropping it turns that into a compile error.
   *
   * Deliberately NOT a runtime throw as well. A JS consumer gets no help from
   * this, which is a real limitation — but rejecting an unknown name at runtime
   * is a behaviour change that can only break working code (anyone using this
   * emitter for their own names), and adding a public validation contract is
   * the owner's call, not this fix's.
   */
  public on<K extends FlipbookEventName>(
    eventName: K,
    callback: EventCallback<FlipbookEventMap[K]>,
  ): this;
  public on(eventName: string, callback: EventCallback): this {
    const list = this.events.get(eventName);
    if (!list) {
      this.events.set(eventName, [callback]);
    } else {
      list.push(callback);
    }
    return this;
  }

  /**
   * Remove one listener, or every listener for an event.
   *
   * E3: `off(event)` detached ALL callbacks for that event, so a consumer with
   * two `flip` handlers — a common shape, one for a page counter and one for
   * analytics — could not detach either without killing the other. `off(event,
   * callback)` removes exactly one registration.
   *
   * Matching is by reference, like `EventTarget.removeEventListener` and
   * `EventEmitter.off`: the value passed to `off` must be the same function
   * object that was passed to `on`. A fresh `.bind(this)` or a new arrow does
   * not match, and this is why — there is no identity to compare a rebound
   * function by, so the alternative would be to silently detach something the
   * caller did not name.
   *
   * Registering the same function twice and calling `off` once leaves one
   * registration, so `on`/`off` calls pair up one-for-one.
   */
  public off<K extends FlipbookEventName>(
    event: K,
    callback?: EventCallback<FlipbookEventMap[K]>,
  ): this;
  public off(event: string, callback?: EventCallback): this {
    if (callback === undefined) {
      this.events.delete(event);
      return this;
    }

    const list = this.events.get(event);
    if (list === undefined) return this;

    const index = list.indexOf(callback);
    if (index === -1) return this;

    list.splice(index, 1);
    // Drop the empty array rather than keep it: `trigger` treats "no entry" and
    // "empty entry" the same, but leaving it makes the map grow without bound
    // for a consumer that binds and unbinds per render.
    if (list.length === 0) this.events.delete(event);

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
  /**
   * Route listener errors asynchronously from here on — see L8 in
   * {@link EventObject.trigger}. One-way: nothing turns it back off, because
   * the only caller is a teardown and there is no "after" for it to restore.
   */
  protected deferListenerErrors(): void {
    this.deferErrors = true;
  }

  /**
   * End the deferral window opened by {@link EventObject.deferListenerErrors}.
   *
   * The window must be a window and not a one-way switch: `on()` after
   * `destroy()` is documented to register, and such a listener still receives
   * the `turnRejected` a dead engine emits. That dispatch is not teardown, so
   * its errors belong on the synchronous path like everyone else's.
   */
  protected resumeListenerErrors(): void {
    this.deferErrors = false;
  }

  protected clearListeners(): void {
    this.events.clear();
  }

  /**
   * Deliver one event to every listener registered for it when the dispatch
   * started.
   *
   * **E1 — the listener set is snapshotted.** The loop used to iterate the live
   * array, which gave one dispatch two different mutation semantics and one
   * infinite loop:
   *
   * - a listener calling `on(sameEvent, …)` pushed onto the array being
   *   iterated, so the new listener ran inside the same emit — and a handler
   *   that re-registers itself never terminated;
   * - a listener calling `off(sameEvent)` deleted the map entry, but the loop
   *   held the old array, so every remaining listener still ran.
   *
   * The snapshot settles both, and settles them the way the platform does:
   * **a listener added during a dispatch does not run until the next emit, and
   * one removed during a dispatch still runs for the current one.** That is
   * Node's `EventEmitter` exactly. `EventTarget` agrees on the first half and
   * differs on the second (it re-checks removal per listener); the copy is
   * chosen over that because it is the cheaper contract to state and because
   * "the set is fixed when the event starts" is what `dispatchCollectionChange`
   * already assumes when it calls its pair atomic.
   *
   * **E2 — one throwing listener no longer cancels the rest.** Every listener
   * runs, then the FIRST error is rethrown synchronously. Three properties,
   * deliberately:
   *
   * - errors are never swallowed. A listener that throws is a consumer defect,
   *   and this engine's rule (`PageFlip.requestTurn`) is that a failure which
   *   is not the engine's own is never converted into silence.
   * - the error stays synchronous, so `try { book.updateFromHtml(…) } catch`
   *   keeps working. Deferring every error to `window.onerror` would have made
   *   the failure uncatchable at the call site, which is its own kind of
   *   silence.
   * - the FIRST error wins, matching what `dispatchCollectionChange` already
   *   documents and what a caller catching today already gets. Later errors go
   *   to the host's uncaught handler rather than being dropped.
   *
   * What this does NOT do is protect the engine from a throwing listener: the
   * error still unwinds out of whatever internal call site emitted, exactly as
   * before. Making listener errors non-fatal to the engine means deferring all
   * of them, which is a public contract change, not a bug fix.
   */
  protected trigger<K extends FlipbookEventName>(
    eventName: K,
    app: PageFlip,
    data: FlipbookEventMap[K],
  ): void {
    const list = this.events.get(eventName);
    if (list === undefined || list.length === 0) return;

    // Copy BEFORE the first listener runs — a copy taken later, or refreshed
    // inside the loop, is the live array again for every listener after the
    // one that mutated it.
    const listeners = list.slice();
    let errors: unknown[] | null = null;

    for (const callback of listeners) {
      try {
        // A fresh event object per listener: one handler mutating `e` must not
        // be able to rewrite what the next one is told.
        callback({ data, object: app });
      } catch (err: unknown) {
        (errors ??= []).push(err);
      }
    }

    if (errors === null) return;

    // L8. During teardown EVERY error is deferred, including the first.
    //
    // The synchronous rethrow below is deliberate (E2): a listener that throws
    // is a consumer defect, and this engine does not convert a failure that is
    // not its own into silence. Teardown is the one place where that rule loses
    // to a stronger one — cleanup must complete. `destroy()` emits `changeState`
    // (via `abandon()`) after `destroyed` is already set, so a listener that
    // reads engine state gets the `DESTROYED` the contract promises it — and
    // that throw came straight back out of `book.destroy()`. A React `useEffect`
    // cleanup therefore threw on unmount because of a listener that had been
    // working a moment earlier, and the rest of the teardown did not run.
    //
    // Deferring is not silencing: every one of these still reaches
    // `window.onerror` / `uncaughtException` on the next task. What changes is
    // that a dying engine cannot take the caller's cleanup down with it.
    if (this.deferErrors) {
      for (const error of errors) rethrowAsync(error);
      return;
    }

    for (let i = 1; i < errors.length; i += 1) rethrowAsync(errors[i]);
    throw errors[0];
  }
}
