/**
 * Test-only access to seams closed behind symbols on the public façade.
 *
 * E2e runs in the browser against the vanilla example's `window.flipbook`.
 * `getRender` / `getFlipController` left the published surface (C7 /
 * `packages/core/src/internal.ts`). Unit tests use
 * `packages/core/tests/engine-access.ts`; Playwright `page.evaluate` cannot
 * import that module into the page, so these helpers re-resolve the same
 * symbols by description **inside** each browser callback (closed-over
 * helpers do not serialise across the Playwright boundary).
 *
 * Descriptions must match `Symbol('…')` in `internal.ts`:
 *   flipbook.getRender · flipbook.getFlip
 */

import type { Page } from '@playwright/test';

/** Fold position in on-screen coordinates, or null when no calc is live. */
export function foldX(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Calc = { getPosition(): Pt };
    type Flip = { getCalculation(): Calc | null };
    type Render = { convertPointToGlobal(point: Pt): Pt };

    const book = (window as unknown as { flipbook: object }).flipbook;

    const callSymbol = (target: object, description: string): unknown => {
      let proto: object | null = target;
      while (proto) {
        for (const sym of Object.getOwnPropertySymbols(proto)) {
          if (sym.description === description) {
            const method = (target as Record<symbol, unknown>)[sym];
            if (typeof method === 'function') {
              return (method as (this: object) => unknown).call(target);
            }
          }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      throw new Error(`e2e engine-access: symbol "${description}" not found on PageFlip`);
    };

    const flip = callSymbol(book, 'flipbook.getFlip') as Flip | null;
    const calc = flip?.getCalculation() ?? null;
    if (!calc) return null;
    const render = callSymbol(book, 'flipbook.getRender') as Render;
    return render.convertPointToGlobal(calc.getPosition()).x;
  });
}

/** Flipping progress 0–100, or null when no fold is engaged. */
export function foldProgress(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    type Calc = { getFlippingProgress(): number };
    type Flip = { getCalculation(): Calc | null };

    const book = (window as unknown as { flipbook: object }).flipbook;

    const callSymbol = (target: object, description: string): unknown => {
      let proto: object | null = target;
      while (proto) {
        for (const sym of Object.getOwnPropertySymbols(proto)) {
          if (sym.description === description) {
            const method = (target as Record<symbol, unknown>)[sym];
            if (typeof method === 'function') {
              return (method as (this: object) => unknown).call(target);
            }
          }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      throw new Error(`e2e engine-access: symbol "${description}" not found on PageFlip`);
    };

    const flip = callSymbol(book, 'flipbook.getFlip') as Flip | null;
    const calc = flip?.getCalculation() ?? null;
    return calc ? calc.getFlippingProgress() : null;
  });
}

/**
 * Finish any in-flight animation, jump to `pageIndex`, restart the rAF loop.
 * Replaces the old `getRender().finishAnimation()` + `turnToPage` + `start()`
 * sequence that golden screenshots depend on for a settled start frame.
 */
export async function settleAtPage(page: Page, pageIndex: number): Promise<void> {
  await page.evaluate((idx) => {
    type Render = { finishAnimation(): void; start(): void };
    type Book = { turnToPage(index: number): void };

    const book = (window as unknown as { flipbook: Book & object }).flipbook;

    const callSymbol = (target: object, description: string): unknown => {
      let proto: object | null = target;
      while (proto) {
        for (const sym of Object.getOwnPropertySymbols(proto)) {
          if (sym.description === description) {
            const method = (target as Record<symbol, unknown>)[sym];
            if (typeof method === 'function') {
              return (method as (this: object) => unknown).call(target);
            }
          }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      throw new Error(`e2e engine-access: symbol "${description}" not found on PageFlip`);
    };

    const render = callSymbol(book, 'flipbook.getRender') as Render;
    render.finishAnimation();
    book.turnToPage(idx);
    render.start();
  }, pageIndex);
}

/** Live engine snapshot used by gesture e2e. */
export function engineSnapshot(page: Page): Promise<{
  state: string;
  page: number;
  folding: boolean;
  foldX: number | null;
}> {
  return page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Calc = { getPosition(): Pt };
    type Flip = { getCalculation(): Calc | null };
    type Book = {
      getState(): string;
      getCurrentPageIndex(): number;
    };

    const book = (window as unknown as { flipbook: Book & object }).flipbook;

    const callSymbol = (target: object, description: string): unknown => {
      let proto: object | null = target;
      while (proto) {
        for (const sym of Object.getOwnPropertySymbols(proto)) {
          if (sym.description === description) {
            const method = (target as Record<symbol, unknown>)[sym];
            if (typeof method === 'function') {
              return (method as (this: object) => unknown).call(target);
            }
          }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      throw new Error(`e2e engine-access: symbol "${description}" not found on PageFlip`);
    };

    const flip = callSymbol(book, 'flipbook.getFlip') as Flip | null;
    const calc = flip?.getCalculation() ?? null;
    return {
      state: book.getState(),
      page: book.getCurrentPageIndex(),
      folding: calc != null,
      foldX: calc?.getPosition().x ?? null,
    };
  });
}
