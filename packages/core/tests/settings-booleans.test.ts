/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'vitest';
import { Settings } from '../src/Settings';
import type { FlipOptions, FlipSetting } from '../src/Settings';
import type { PageFlipError } from '../src/errors';

/**
 * S6 — every boolean setting is validated as a BOOLEAN.
 *
 * Imported from `../src/Settings` directly rather than through the package
 * index, and that is deliberate on two counts. `Settings` pulls in only
 * `pageBackground` and `errors`, so these tests need no engine, no DOM and no
 * fixture — nothing between the assertion and the validator. It also means the
 * file is independent of whatever else is mid-change in the tree.
 *
 * What was broken: none of the booleans was checked at all, so
 * `drawShadow: 'false'` survived verbatim — and `'false'` is a TRUTHY string,
 * so shadows stayed ON for an author who had just written "false". Silent, and
 * the opposite of the intent.
 *
 * Why it matters more than a typo: every ordinary configuration source hands
 * over strings. `data-*` attributes, URL query parameters, and `JSON.parse` of
 * a settings file or CMS response all produce `'false'`, and
 * `data-draw-shadow="false"` is exactly what a person writes.
 *
 * Why TypeScript does not cover it: `FlipSetting.drawShadow` has been typed
 * `boolean` the whole time. Types are erased at runtime, so they protect the
 * developer writing a literal and nobody else — not a JS consumer, not
 * `JSON.parse` (which returns `any`), not a value that passed through one `as`.
 *
 * New names only. The old booleans `useMouseEvents` / `disableFlipByClick` /
 * `showCover` / `mobileScrollSupport` / `clickEventForward` / `showPageCorners`
 * are gone — replaced by `pointerInput`, `flipOnClick`, `hardCovers`,
 * `allowTouchScroll`, `respectInteractiveContent`, `foldCornerOnHover`.
 */

const base: FlipOptions = { width: 300, height: 400 };

/** Matches `BOOLEAN_SETTINGS` in Settings.ts — new names only. */
const BOOLEANS = [
  'drawShadow',
  'usePortrait',
  'autoSize',
  'hardCovers',
  'allowTouchScroll',
  'respectInteractiveContent',
  'foldCornerOnHover',
  'respectReducedMotion',
] as const satisfies readonly (keyof FlipSetting)[];

const codeOf = (setting: Record<string, unknown>): string => {
  try {
    new Settings().resolve(setting as FlipOptions);
  } catch (error) {
    return (error as PageFlipError).code;
  }
  return 'NO_THROW';
};

const settingOf = (setting: Record<string, unknown>): string | undefined => {
  try {
    new Settings().resolve(setting as FlipOptions);
  } catch (error) {
    return (error as PageFlipError).setting;
  }
  return undefined;
};

const withKey = (key: string, value: unknown): Record<string, unknown> => ({
  ...base,
  [key]: value,
});

describe('S6 — boolean settings are validated', () => {
  test.each(BOOLEANS)('%s rejects the truthy string "false"', (key) => {
    // The headline case, and the one that silently inverted intent.
    expect(codeOf(withKey(key, 'false'))).toBe('INVALID_SETTING');
    expect(settingOf(withKey(key, 'false'))).toBe(key);
  });

  test.each(BOOLEANS)('%s rejects "true" as well, not just the wrong-looking one', (key) => {
    // A validator that only rejected `'false'` would pass every test above
    // while still accepting strings. The rule is the TYPE, not the value.
    expect(codeOf(withKey(key, 'true'))).toBe('INVALID_SETTING');
  });

  test.each(BOOLEANS)('%s rejects 0 and 1 — a deliberate 2.x break', (key) => {
    // Accepted since 2.x. Rejecting them is the owner's call (2026-08-30): a
    // boolean is a datatype a schema can validate, and accepting two spellings
    // of it invites the third and fourth. Pinned so it cannot be quietly
    // softened later by someone who reads a bug report and reaches for
    // permissiveness.
    expect(codeOf(withKey(key, 1))).toBe('INVALID_SETTING');
    expect(codeOf(withKey(key, 0))).toBe('INVALID_SETTING');
  });

  test.each(BOOLEANS)('%s rejects null and objects', (key) => {
    expect(codeOf(withKey(key, null))).toBe('INVALID_SETTING');
    expect(codeOf(withKey(key, {}))).toBe('INVALID_SETTING');
  });

  test.each(BOOLEANS)('%s still accepts real booleans — the negative control', (key) => {
    // Without this, every assertion above is satisfied by a validator that
    // rejects EVERY value of every boolean. That validator makes the engine
    // unusable and would still go green.
    expect(codeOf(withKey(key, true))).toBe('NO_THROW');
    expect(codeOf(withKey(key, false))).toBe('NO_THROW');
  });

  test('a defaulted book, with no booleans supplied at all, is valid', () => {
    // The defaults must themselves be booleans. If one were ever changed to a
    // truthy non-boolean, every consumer would fail at construction — the
    // validator would have turned a silent bug into a total outage.
    expect(codeOf(base)).toBe('NO_THROW');
  });

  test('an explicit undefined still falls back to the default, it does not throw', () => {
    // `definedOnly` drops undefined-valued keys before the merge, so
    // `drawShadow: undefined` means "not supplied". A React binding forwarding
    // an optional prop (`drawShadow={props.drawShadow}`) does this constantly,
    // and it must not be an error.
    const settings = new Settings().resolve({
      ...base,
      drawShadow: undefined,
      hardCovers: undefined,
    } as unknown as FlipOptions);

    expect(settings.drawShadow).toBe(true);
    expect(settings.hardCovers).toBe(false);
  });

  test('the message names the offending setting and what it got', () => {
    // A bare code cannot tell an author WHICH boolean they got wrong; `.setting`
    // is the machine-readable half, the message the human half.
    let message = '';
    let setting: string | undefined;
    try {
      new Settings().resolve(withKey('drawShadow', 'false') as FlipOptions);
    } catch (error) {
      message = (error as PageFlipError).message;
      setting = (error as PageFlipError).setting;
    }

    expect(setting).toBe('drawShadow');
    expect(message).toMatch(/drawShadow/);
    expect(message).toMatch(/true or false/);
    // Received value is shown as a JSON string, e.g. received "false".
    expect(message).toMatch(/"false"/);
  });

  test('the first offending boolean throws, and validation is not order-dependent', () => {
    // Two wrong at once must still throw, whichever the loop reaches first —
    // guards against a validator that only ever checks one key.
    expect(codeOf({ ...base, drawShadow: 'no', usePortrait: 'yes' })).toBe('INVALID_SETTING');
  });
});
