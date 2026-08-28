/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest';

describe('React binding Node import', () => {
  test('importing the binding does not touch window', async () => {
    expect(typeof globalThis.window).toBe('undefined');
    const mod = await import('@gullabs/react-flipbook');
    expect(typeof mod.HTMLFlipBook).toBe('function');
    expect(typeof mod.usePageFlip).toBe('function');
  });
});
