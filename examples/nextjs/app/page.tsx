'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { HTMLFlipBook, usePageFlip, type WidgetEvent } from '@gullabs/react-flipbook';

/**
 * App Router demo: SSR emits `data-flipbook-placeholder` until hydration; the
 * engine then builds `.stf__*` and portals leaves into `.stf__block`.
 *
 * Page ROOT styles are engine-owned — colors/padding live on an inner wrapper.
 * Children must be host elements so the binding can ref them into the engine.
 */

const leafRoot: CSSProperties = { boxSizing: 'border-box', height: '100%' };

const leafInner = (bg: string): CSSProperties => ({
  boxSizing: 'border-box',
  height: '100%',
  background: bg,
  padding: 20,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 18,
  fontWeight: 600,
});

export default function Page() {
  const book = usePageFlip(0);
  const [state, setState] = useState('read');
  // Same value on server and first client paint so hydration matches; flip
  // after mount so the status line can say the book is live.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const onChangeState = useCallback((e: WidgetEvent<string>) => {
    setState(String(e.data));
  }, []);

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
      }}
    >
      <h1 style={{ marginTop: 0 }}>Next.js App Router</h1>
      <p style={{ color: '#555', maxWidth: 520 }}>
        View source / disable JS to see <code>data-flipbook-placeholder</code> on the SSR HTML.
        After hydration the engine mounts and the book becomes interactive.
      </p>
      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
        {hydrated ? 'hydrated' : 'ssr'} · page {book.page} / {Math.max(0, book.pageCount - 1)} ·
        state {state}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 16px' }}>
        <button type="button" onClick={() => book.flipPrev()}>
          Prev
        </button>
        <button type="button" onClick={() => book.flipNext()}>
          Next
        </button>
        <button type="button" onClick={() => book.turnToPage(0)}>
          First
        </button>
      </div>

      <HTMLFlipBook
        ref={book.ref}
        width={300}
        height={400}
        size="fixed"
        flippingTime={0}
        pageBackground="#ffffff"
        page={book.page}
        {...book.bookProps}
        onChangeState={onChangeState}
        style={{ maxWidth: 600 }}
        aria-label="Next.js flipbook demo"
      >
        <div style={leafRoot}>
          <div style={leafInner('#ffe4e1')}>Cover</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#e0f0ff')}>Leaf</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#e6ffe6')}>Back</div>
        </div>
      </HTMLFlipBook>
    </main>
  );
}
