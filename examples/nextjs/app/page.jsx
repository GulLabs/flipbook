'use client';

import { HTMLFlipBook } from '@gullabs/react-flipbook';

export default function Page() {
  return (
    <main>
      <h1>Next.js App Router</h1>
      <p>Placeholder attribute is present in the SSR HTML until hydration.</p>
      <HTMLFlipBook width={300} height={400} flippingTime={0}>
        <div>Cover</div>
        <div>Leaf</div>
        <div>Back</div>
      </HTMLFlipBook>
    </main>
  );
}
