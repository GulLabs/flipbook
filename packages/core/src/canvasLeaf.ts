/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PageDensity } from './Page/Page';
import { PageFlipError } from './errors';
import { isOpaquePageBackground, safePageBackground } from './Render/pageBackground';

/**
 * How a bitmap is fitted into the leaf it is drawn on.
 *
 * `contain` is the default and the only one that cannot crop or distort. The
 * previous behaviour was `fill` — every bitmap stretched to the leaf regardless
 * of its aspect ratio — which is why the default changes here and is called out
 * in MIGRATION.md.
 */
export const ImageFit = {
  /** Whole bitmap, aspect preserved, letterboxed onto `background`. */
  CONTAIN: 'contain',
  /** Fills the leaf, aspect preserved, overflow cropped. */
  COVER: 'cover',
  /** Stretched to the leaf. Distorts unless the ratios already match. */
  FILL: 'fill',
} as const;
export type ImageFit = (typeof ImageFit)[keyof typeof ImageFit];

/** One leaf backed by a bitmap. */
export interface ImagePageSource {
  /** Non-empty URL. */
  readonly src: string;

  /**
   * REQUIRED, and required for a reason.
   *
   * A canvas book has no DOM per page, so the only thing a screen reader can be
   * given is what the descriptor says. Making this optional would mean the
   * engine inventing `''` — silently declaring every page decorative, including
   * the ones carrying the entire story. Making it required moves that from a
   * runtime accessibility failure nobody notices to a compile error.
   *
   * `''` is honoured, and means the leaf is genuinely decorative. That is an
   * assertion the consumer makes deliberately, which is the whole difference.
   *
   * **There is a third answer, and it is usually the right one for a long
   * book.** Faced with twenty pages, "write a real description or type `''`"
   * reads as "write twenty sentences, or two quote marks" — and the quote
   * marks win, which defeats the entire point of the field. A positional label
   * is one template literal, it is TRUE, and it is strictly better than
   * claiming twenty pages are decorative:
   *
   * ```ts
   * await book.loadFromImages(urls.map((src, i) => ({ src, alt: `Page ${i + 1}` })));
   * ```
   *
   * Written out at the call site on purpose: there is no helper that does this
   * for you, because the omission should be visible in your own code and
   * greppable later, rather than a default the engine chose on your behalf.
   */
  readonly alt: string;

  /**
   * Set on the element BEFORE `src`. Omitted by default.
   *
   * Omitting it leaves a cross-origin canvas tainted, which is the browser's own
   * protection and costs this engine nothing — it never reads pixels back.
   * Defaulting to `'anonymous'` would instead turn every book served from a CDN
   * without `Access-Control-Allow-Origin` into a blank one. See ADR 0001.
   *
   * `'use-credentials'` sends credentials and makes authenticated cross-origin
   * bitmaps readable back off the canvas — opt in only where you own both ends.
   */
  readonly crossOrigin?: 'anonymous' | 'use-credentials';

  /** Overrides the book's `imageFit`. */
  readonly fit?: ImageFit;

  /**
   * Inset on every edge, as a FRACTION of page width (`0.028` is 2.8%), not
   * pixels. A book is continuously resized; a pixel inset does not survive that
   * and would have to be recomputed by the consumer on every resize, which is
   * the work this engine exists to do.
   */
  readonly inset?: number;

  /** Opaque paper colour for this leaf. Falls back to the book's. */
  readonly background?: string;

  /** Overrides the structural density inference (covers, terminal singletons). */
  readonly density?: PageDensity;
}

/**
 * One leaf with no bitmap: an inside cover, a parity pad, a deliberate blank.
 *
 * Modelled as its own variant rather than `{ src: null }` so that `alt` can be
 * meaningfully `''` and no draw path has to grow a null check on `src`.
 */
export interface BlankPageSource {
  readonly blank: true;

  /**
   * Optional, and the only value it may take is `''`.
   *
   * It used to be a required `string`, which was alt-text-for-its-own-sake and
   * self-refuting: the discriminant `blank: true` IS the decorative assertion,
   * and it carries strictly more than `alt: ''` does (it also says no bitmap
   * was ever intended). Requiring the field added nothing and made the harmful
   * value both representable and easy — `{ blank: true, alt: 'Blank page' }` on
   * eight parity pads is exactly the "blank, blank, blank" a screen-reader user
   * should never hear, and it is what a conscientious author who has been told
   * "alt is required" will write.
   *
   * Typed `?: ''` rather than deleted so the shape still destructures with
   * `ImagePageSource`, and because `?: ''` → `string` is a widening later while
   * the reverse would be a major.
   */
  readonly alt?: '';
  readonly background?: string;
  readonly density?: PageDensity;
}

export type CanvasLeaf = ImagePageSource | BlankPageSource;

/** Narrow a leaf to the blank variant. */
export function isBlankLeaf(leaf: CanvasLeaf): leaf is BlankPageSource {
  return 'blank' in leaf && leaf.blank;
}

function bad(message: string): never {
  throw new PageFlipError(message, 'INVALID_IMAGE_SOURCE');
}

const FITS: readonly string[] = [ImageFit.CONTAIN, ImageFit.COVER, ImageFit.FILL];
const CROSS_ORIGIN: readonly string[] = ['anonymous', 'use-credentials'];
const DENSITIES: readonly string[] = [PageDensity.SOFT, PageDensity.HARD];

/**
 * Validate the WHOLE list before anything observable changes.
 *
 * Deliberately eager, and deliberately before the canvas chunk is imported or
 * the current mode is touched: a half-applied load that leaves the book showing
 * neither the old collection nor the new one is the failure mode every other
 * load path in this engine goes out of its way to avoid (see `loadGeneration`).
 * A descriptor list is fully checkable up front, so it is.
 */
export function validateCanvasLeaves(leaves: readonly CanvasLeaf[]): void {
  // Every SHAPE check below runs against a deliberately `unknown` alias, and
  // that indirection is load-bearing rather than decorative.
  //
  // `Array.isArray` narrows a `readonly T[]` to `any[]` — a readonly array is
  // not assignable to `any[]`, so the type guard's signature wins — which
  // silently made `leaf` an `any` for the whole loop and cost 27
  // `no-unsafe-member-access` errors: every field check here was being
  // typechecked against nothing at all. Narrowing an `unknown` alias instead
  // leaves the parameters with their declared types.
  //
  // The runtime guards still earn their place after that: the parameter type
  // protects TypeScript callers only, and this is a published JS API.
  const list: unknown = leaves;
  if (!Array.isArray(list)) {
    bad('loadFromImages expects an array of leaf descriptors');
  }

  // Collected, not thrown, and reported ONCE — see the `alt` check below. A
  // warning per leaf turns a fifty-page book with a systematic mistake into
  // fifty identical console lines, which is how a real warning gets scrolled
  // past and then filtered out.
  const missingAlt: number[] = [];

  leaves.forEach((leaf, i) => {
    const at = `leaf ${String(i)}`;
    const raw: unknown = leaf;

    // FIRST, and the ordering is the whole point. This used to sit below the
    // object check, which made it unreachable: a string fails `!== 'object'`
    // and throws there, so the one message written for the single most likely
    // 2.x migration mistake could never actually be produced.
    if (typeof raw === 'string') {
      bad(
        `${at}: bare URL strings are no longer accepted — pass ` +
          `{ src, alt } so the page has an accessible name`,
      );
    }

    if (typeof raw !== 'object' || raw === null) {
      bad(`${at}: expected a descriptor object, got ${typeof raw}`);
    }

    // NOT a throw, and this is the one field where that asymmetry is correct.
    //
    // `alt` is required in the TYPE, which is where the enforcement belongs and
    // costs nothing: a TypeScript consumer gets a compile error. Throwing here
    // as well converted "page 12 has a poor accessible name" into "the book
    // does not load, for anybody" — a harder failure than the accessibility
    // failure it was preventing, and one this engine imposes nowhere else (HTML
    // mode renders an `<img>` with no `alt` quite happily).
    //
    // So absence is reported as ADR 0001 specifies it: **'unknown', never
    // 'decorative'**. The leaf keeps rendering, the mirror falls back to a
    // consumer-supplied label, and the author is told once per book. `''` still
    // means decorative — but only when the author actually wrote it.
    if (typeof leaf.alt !== 'string' && !isBlankLeaf(leaf)) {
      missingAlt.push(i);
    }

    if (leaf.background !== undefined) {
      if (typeof leaf.background !== 'string') bad(`${at}: \`background\` must be a string`);
      // The two jobs stay separate, per CLAUDE.md: sanitising for CSS safety
      // and checking for opacity are different questions, and collapsing them
      // is how a translucent fold shipped once already.
      if (!isOpaquePageBackground(leaf.background)) {
        bad(`${at}: \`background\` must be opaque — a see-through leaf reveals the page beneath`);
      }
      if (safePageBackground(leaf.background) !== leaf.background.trim()) {
        bad(`${at}: \`background\` is not a colour this engine will accept`);
      }
    }

    if (leaf.density !== undefined && !DENSITIES.includes(leaf.density)) {
      bad(`${at}: \`density\` must be 'soft' or 'hard'`);
    }

    if (isBlankLeaf(leaf)) return;

    if (typeof leaf.src !== 'string' || leaf.src.length === 0) {
      bad(`${at}: \`src\` must be a non-empty string`);
    }
    if (leaf.crossOrigin !== undefined && !CROSS_ORIGIN.includes(leaf.crossOrigin)) {
      bad(`${at}: \`crossOrigin\` must be 'anonymous' or 'use-credentials'`);
    }
    if (leaf.fit !== undefined && !FITS.includes(leaf.fit)) {
      bad(`${at}: \`fit\` must be 'contain', 'cover' or 'fill'`);
    }
    if (leaf.inset !== undefined) {
      if (!Number.isFinite(leaf.inset) || leaf.inset < 0 || leaf.inset >= 0.5) {
        bad(`${at}: \`inset\` is a fraction of page width in [0, 0.5), got ${String(leaf.inset)}`);
      }
    }
  });

  if (missingAlt.length > 0) {
    // `console.warn` and not an event: this is an authoring mistake, it is
    // found while writing the code, and a warning is the channel that reaches
    // the person who can fix it. Guarded because core must not assume a
    // console exists (SSR, worker, embedded runtimes).
    if (typeof console !== 'undefined') {
      console.warn(
        `[flipbook] ${String(missingAlt.length)} canvas leaf/leaves have no \`alt\` ` +
          `(index ${missingAlt.slice(0, 10).join(', ')}${missingAlt.length > 10 ? ', …' : ''}). ` +
          `Those pages are announced by position only. Pass \`alt: ''\` to mark a ` +
          `page genuinely decorative — absence is read as unknown, not decorative.`,
      );
    }
  }
}
