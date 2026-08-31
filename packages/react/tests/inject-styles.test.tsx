/**
 * C5, the React half (docs/API-CONTRACT.md §4): `injectStyles` must reach the
 * engine AND participate in the remount key. A false-only mount proves
 * nothing about the key — the decisive assertion is the `false → true`
 * rerender, which is only observable if the prop change rebuilds the engine.
 */
// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HTMLFlipBook } from '@gullabs/react-flipbook';

afterEach(() => {
  cleanup();
  document.head.querySelector('style[data-gullabs-flipbook]')?.remove();
});

const pages = ['a', 'b'].map((id) => (
  <div key={id} style={{ width: '100%', height: '100%' }}>
    {id}
  </div>
));

test('injectStyles={false} mounts with no engine <style>; flipping it to true rebuilds and injects', () => {
  document.head.querySelector('style[data-gullabs-flipbook]')?.remove();

  const view = render(
    <HTMLFlipBook width={200} height={300} flippingTime={0} injectStyles={false}>
      {pages}
    </HTMLFlipBook>,
  );
  expect(document.head.querySelector('style[data-gullabs-flipbook]')).toBeNull();

  view.rerender(
    <HTMLFlipBook width={200} height={300} flippingTime={0} injectStyles={true}>
      {pages}
    </HTMLFlipBook>,
  );
  // Observable only if injectStyles is in remountKeyOf: the old engine read
  // the setting at construction, so without a rebuild nothing would inject.
  expect(document.head.querySelector('style[data-gullabs-flipbook]')).not.toBeNull();
});

test('updateSettings({ injectStyles }) is a compile error — LiveSetting omits it', () => {
  // Type-level pin only; the runtime warn-and-drop twin lives in
  // packages/core/tests/styling-contract.test.ts.
  const assertOmitted = (engine: import('@gullabs/react-flipbook').PageFlip): void => {
    // @ts-expect-error — injectStyles is construction-time, not a LiveSetting.
    void (() => engine.updateSettings({ injectStyles: false }));
  };
  expect(typeof assertOmitted).toBe('function');
});
