'use client';

import { HTMLFlipBook } from '@gullabs/react-flipbook';

export default function Page() {
  return (
    <main>
      <h1>Next.js App Router</h1>
      <p>Placeholder attribute is present in the SSR HTML until hydration.</p>
      <HTMLFlipBook width={300} height={400} flippingTime={0}>
        <div key="cover">Cover</div>
        <div key="leaf">Leaf</div>
        <div key="back">Back</div>
      </HTMLFlipBook>
    </main>
  );
}
