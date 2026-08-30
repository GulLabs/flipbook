/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageFlip } from '../PageFlip';
import type { FlippingState } from '../Flip/Flip';
import type { Orientation } from '../Render/Render';
import type { PageFlipErrorCode } from '../errors';

/**
 * What every event carries about where the book is.
 *
 * D18. There used to be five payload conventions — a bare number, a bare enum,
 * `{page, mode}`, `{page, pageCount}`, `{reason, code?}` — and the React
 * binding handed `onPageChange` an unwrapped number while every other handler
 * received a `WidgetEvent` the consumer had to reach into. ADR 0003 identified
 * that asymmetry as the reason consumers bound the wrong event in the first
 * place. One shape now, everywhere.
 */
export interface BookSnapshot {
  /** The spread HEAD — the first leaf on screen. */
  page: number;
  pageCount: number;
  orientation: Orientation;
}

/** Why a turn did not happen. */
export type TurnRejectedReason =
  'boundary' | 'disabled' | 'superseded' | 'notReady' | 'invalidPage' | 'setup';

/**
 * D16. The payload the README already recommended this event for could not
 * answer the question it was recommended for: disabling a next/prev button at a
 * boundary needs to know WHICH boundary, and `reason: 'boundary'` alone does
 * not say. Re-deriving it from the engine is rejected alternative (d) of ADR
 * 0003 in a new place.
 */
export interface TurnRejected {
  reason: TurnRejectedReason;
  /** Which way the refused turn was going, when that is meaningful. */
  direction: 'next' | 'prev' | null;
  /** The page the caller asked for, for an absolute navigation. */
  targetPage: number | null;
  code?: PageFlipErrorCode;
}

export type FlipbookEventMap = {
  /** The reader is now on a different page. Never fires for a repaint. */
  flip: BookSnapshot;
  changeOrientation: { orientation: Orientation };
  changeState: { state: FlippingState };

  /**
   * D17. `ready` fires ONCE per engine; `loaded` fires on every load including
   * the first.
   *
   * They replace `init`, which named a moment the engine has two of: it fired
   * per LOAD, so a reload emitted a second one indistinguishable from the
   * first. It was also scheduled on a timer, so in the React binding — which
   * loads an empty book and adds pages in a later effect — whether it described
   * the real book or an empty one was a race. And it carried no `pageCount`,
   * so it could not render "page 1 of N"; this repo's own test hard-coded the
   * count in its `onInit` handler, which is the strongest evidence available
   * that the payload was wrong.
   */
  ready: BookSnapshot;
  loaded: BookSnapshot;

  /**
   * D10. The collection was replaced. Replaces `update` + `collectionRebuild`,
   * which always fired together, atomically, with the same page — so the
   * ~60 lines of atomic-pair machinery existed to guarantee a property that one
   * event does not need. `update` also shared its name with `PageFlip.update()`,
   * which does not cause it.
   */
  pagesChanged: BookSnapshot;

  turnRejected: TurnRejected;
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
 * A `once()` wrapper, tagged with the callback the consumer actually handed us.
 *
 * The tag is what lets `off(event, theirCallback)` cancel a `once` listener.
 * Without it the consumer holds a reference the emitter does not recognise —
 * they registered `fn` and the map contains an anonymous wrapper — so a
 * one-shot listener would be impossible to cancel before it fired. Node's
 * `EventEmitter` solves it the same way (`wrapper.listener`).
 */
interface OnceWrapper extends EventCallback {
  __onceOriginal?: EventCallback;
}

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

  /**
   * NESTING DEPTH, not a flag. See {@link EventObject.deferListenerErrors}.
   *
   * A boolean was wrong, and wrong in the direction that matters: a teardown
   * listener is allowed to re-enter `destroy()`, and the inner call's `finally`
   * then cleared the deferral while the OUTER teardown was still running. The
   * next listener's exception escaped `destroy()` synchronously — exactly the
   * failure L8 exists to prevent, reachable by the exact re-entrancy this
   * engine documents as legal everywhere else.
   */
  private deferDepth = 0;

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
    this.addListener(eventName, callback);
    return this;
  }

  /**
   * Register a listener that runs at most once, then detaches itself.
   *
   * E9. Hand-rolling this needs `off(event, callback)`, which only became
   * possible with E3 — before that, detaching one listener took every listener
   * for the event with it, so a one-shot handler could not clean up after
   * itself without breaking its neighbours. Both `EventEmitter` and
   * `EventTarget` provide this, so consumers expect it to exist.
   *
   * Three properties worth stating, because each is a decision:
   *
   * - **Detached BEFORE the callback runs.** If the consumer's handler throws,
   *   it has still fired and must still be gone; detaching afterwards would
   *   leave a "once" listener armed for the next emit precisely when their
   *   code is already misbehaving.
   * - **`off(event, yourCallback)` cancels it**, using the reference you passed
   *   to `once` — not the wrapper, which you never see. See {@link OnceWrapper}.
   * - **Registering during a dispatch does not run in that dispatch.**
   *   `trigger` snapshots the listener list, so a `once` registered from inside
   *   a handler for the same event waits for the next emit. That is
   *   `EventEmitter`'s rule and it is what stops a self-registering handler
   *   looping forever.
   */
  public once<K extends FlipbookEventName>(
    eventName: K,
    callback: EventCallback<FlipbookEventMap[K]>,
  ): this;
  public once(eventName: string, callback: EventCallback): this {
    const wrapper: OnceWrapper = (event) => {
      // BEFORE, deliberately — see the docblock.
      this.removeListener(eventName, wrapper);
      callback(event);
    };

    wrapper.__onceOriginal = callback;

    this.addListener(eventName, wrapper);
    return this;
  }

  /**
   * The untyped internals behind `on` / `off` / `once`.
   *
   * They exist because the public `on` and `off` expose ONLY their generic
   * overload, so `once` — which works with a plain `string` event name and an
   * anonymous wrapper — could not call them without casting the callback to a
   * type it is not. Casts there would be load-bearing lies in the one place
   * that must not have them: `off`'s matching logic decides whether a
   * consumer's listener is ever detached.
   */
  private addListener(eventName: string, callback: EventCallback): void {
    const list = this.events.get(eventName);
    if (!list) {
      this.events.set(eventName, [callback]);
    } else {
      list.push(callback);
    }
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

    this.removeListener(event, callback);
    return this;
  }

  /** See {@link EventObject.addListener}. */
  private removeListener(event: string, callback: EventCallback): void {
    const list = this.events.get(event);
    if (list === undefined) return;

    // Identity first, then the `once` tag. A consumer who called
    // `once(event, fn)` holds `fn`, but the map holds an anonymous wrapper they
    // have never seen — so a plain `indexOf` would silently fail to detach it
    // and `off` would look like it worked. Identity is still checked first so
    // that `off` from inside the wrapper (which passes the wrapper itself)
    // remains an exact match and cannot collide with a tagged entry.
    let index = list.indexOf(callback);
    if (index === -1) {
      index = list.findIndex((entry) => (entry as OnceWrapper).__onceOriginal === callback);
    }
    if (index === -1) return;

    list.splice(index, 1);
    // Drop the empty array rather than keep it: `trigger` treats "no entry" and
    // "empty entry" the same, but leaving it makes the map grow without bound
    // for a consumer that binds and unbinds per render.
    if (list.length === 0) this.events.delete(event);
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
    this.deferDepth += 1;
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
    // Floor at zero. An unpaired `resume` is a defect in this engine, not in the
    // consumer, and going negative would make the NEXT legitimate deferral
    // window a no-op — turning an internal bookkeeping slip into an escaped
    // teardown error somewhere else entirely.
    if (this.deferDepth > 0) this.deferDepth -= 1;
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
    if (this.deferDepth > 0) {
      for (const error of errors) rethrowAsync(error);
      return;
    }

    for (let i = 1; i < errors.length; i += 1) rethrowAsync(errors[i]);
    throw errors[0];
  }
}
