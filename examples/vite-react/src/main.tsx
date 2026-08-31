import { StrictMode, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HTMLFlipBook, usePageFlip, type PageState } from '@gullabs/react-flipbook';

/**
 * React binding showcase.
 *
 * Covers the public surface a consumer actually reaches for:
 *   - `usePageFlip()` (uncontrolled + `goToPage` / `flipNext`)
 *   - `onChangeState` / `lastRejection`
 *   - `readingDirection: 'rtl'`
 *   - HTML pages with `<img>` (canvas mode was removed in 3.0.0 — ADR 0002)
 *
 * The engine owns each page ROOT's styles (`style.cssText` every frame). Put
 * colors, padding, and images on an INNER element — never on the leaf root.
 *
 * Page children must be host elements (`div`, …) so `HTMLFlipBook` can attach
 * a ref and hand the node to the engine. A custom component without
 * `forwardRef` leaves the book empty.
 *
 * Do not pass `page={book.page}`: the hook is uncontrolled. `bookProps` already
 * carries `initialPage` and the load/turn handlers.
 */

const leafRoot: CSSProperties = {
  boxSizing: 'border-box',
  height: '100%',
};

const leafInner = (bg: string): CSSProperties => ({
  boxSizing: 'border-box',
  height: '100%',
  background: bg,
  padding: 16,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 18,
  fontWeight: 600,
});

/** Tiny inline SVG “photo” pages — no fixture files, no canvas mode. */
function svgDataUri(label: string, fill: string, ink = '#111'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="420" viewBox="0 0 560 420">
    <rect width="560" height="420" fill="${fill}"/>
    <text x="280" y="220" text-anchor="middle" font-family="system-ui,sans-serif" font-size="48" font-weight="700" fill="${ink}">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function HtmlDemo() {
  const book = usePageFlip(0);
  const [state, setState] = useState<PageState>('read');
  const [rtl, setRtl] = useState(false);

  const onChangeState = useCallback((info: { state: PageState }) => {
    setState(info.state);
  }, []);

  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ margin: '0 0 8px' }}>HTMLFlipBook — usePageFlip + RTL</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        <code>usePageFlip()</code> is uncontrolled: spread <code>bookProps</code>, call{' '}
        <code>goToPage</code> / <code>flipNext</code>. Toggle RTL to invert turn direction only —
        the fold still follows the finger.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => book.flipPrev()} disabled={!book.canGoPrev}>
          Prev
        </button>
        <button type="button" onClick={() => book.flipNext()} disabled={!book.canGoNext}>
          Next
        </button>
        <button type="button" onClick={() => book.goToPage(0, 'instant')}>
          First
        </button>
        <button type="button" onClick={() => book.goToPage(2)}>
          Go to page 2
        </button>
        <button type="button" onClick={() => setRtl((v) => !v)} aria-pressed={rtl}>
          RTL: {rtl ? 'on' : 'off'}
        </button>
      </div>

      <p
        data-demo-status=""
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}
      >
        page {book.page} / {Math.max(0, book.pageCount - 1)} · state {state} · rejected{' '}
        {book.lastRejection ? JSON.stringify(book.lastRejection) : '—'}
      </p>

      <HTMLFlipBook
        ref={book.ref}
        width={280}
        height={360}
        sizing="fixed"
        flippingTime={400}
        readingDirection={rtl ? 'rtl' : 'ltr'}
        {...book.bookProps}
        onChangeState={onChangeState}
        style={{ maxWidth: 560 }}
        aria-label="HTML demo flipbook"
      >
        {/* Host elements only — see file comment on refs. */}
        <div style={leafRoot}>
          <div style={leafInner('#ffe4e1')}>One</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#e0f0ff')}>Two</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#e6ffe6')}>Three</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#fff5cc')}>Four</div>
        </div>
      </HTMLFlipBook>
    </section>
  );
}

function ImagesDemo() {
  const book = usePageFlip(0);

  const pages = useMemo(
    () => [
      { src: svgDataUri('Cover', '#c45c26', '#fff7ed'), alt: 'Cover — warm terracotta field' },
      { src: svgDataUri('Fox', '#f4ecd8'), alt: 'A fox illustration on cream paper' },
      { src: svgDataUri('Meadow', '#d8efe4'), alt: 'A green meadow spread' },
      { src: svgDataUri('End', '#1e293b', '#e2e8f0'), alt: 'Back matter on slate' },
    ],
    [],
  );

  return (
    <section>
      <h2 style={{ margin: '0 0 8px' }}>HTML pages with &lt;img&gt;</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        Pictures are HTML <code>&lt;img alt&gt;</code> with <code>object-fit</code> — the same
        public path as any other content. There is no image loader.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => book.flipPrev()} disabled={!book.canGoPrev}>
          Prev
        </button>
        <button type="button" onClick={() => book.flipNext()} disabled={!book.canGoNext}>
          Next
        </button>
      </div>

      <p
        data-demo-status=""
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}
      >
        page {book.page} / {Math.max(0, book.pageCount - 1)}
      </p>

      <HTMLFlipBook
        ref={book.ref}
        width={280}
        height={210}
        sizing="fixed"
        flippingTime={400}
        pageBackground="#f4ecd8"
        {...book.bookProps}
        style={{ maxWidth: 560 }}
        aria-label="HTML images demo flipbook"
      >
        {pages.map((p) => (
          <div key={p.alt} style={leafRoot}>
            <img
              src={p.src}
              alt={p.alt}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
        ))}
      </HTMLFlipBook>
    </section>
  );
}

function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>@gullabs/react-flipbook</h1>
      <HtmlDemo />
      <ImagesDemo />
    </main>
  );
}

const rootEl = document.getElementById('root');
if (!(rootEl instanceof HTMLElement)) {
  throw new Error('#root element is required');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
