import { HTMLFlipBook } from '@gullabs/react-flipbook';

/**
 * Isolated pnpm consumer: width and height stay required. If those props
 * become optional, this file is the wrong proof — tsc would still pass.
 * The companion missing-props.ts is type-checked with tsc --noEmit and
 * expected to error; see scripts/check-isolated-types.mjs.
 */
export function Book() {
  return (
    <HTMLFlipBook width={300} height={500}>
      <div>one</div>
      <div>two</div>
    </HTMLFlipBook>
  );
}
