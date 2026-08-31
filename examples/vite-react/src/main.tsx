import { StrictMode, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HTMLFlipBook, usePageFlip, type PageState } from '@gullabs/react-flipbook';

/**
 * What a reader app actually reaches for:
 *   - `usePageFlip()` for chrome (visible pages, canGoNext/Prev)
 *   - `controls="visible"` when you do not draw your own buttons
 *   - `hardCovers` for a picture book
 *   - `readingDirection` for RTL
 *   - controlled `page` + `onPageChange` for a URL / resume position
 *
 * Engine owns each page ROOT (`style.cssText` every frame). Put color, padding,
 * and images on an INNER node. Children must be host elements (`div`, …) so
 * the binding can attach a ref — a custom component without `forwardRef`
 * silently empties the book.
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

function svgDataUri(label: string, fill: string, ink = '#111'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="420" viewBox="0 0 560 420">
    <rect width="560" height="420" fill="${fill}"/>
    <text x="280" y="220" text-anchor="middle" font-family="system-ui,sans-serif" font-size="48" font-weight="700" fill="${ink}">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pagesLabel(visible: number[], pageCount: number): string {
  const shown = visible.map((i) => i + 1);
  if (shown.length === 0) return `— of ${pageCount}`;
  return `${shown.join('–')} of ${pageCount}`;
}

function PictureBook() {
  const book = usePageFlip(0, { hardCovers: true });

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
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ margin: '0 0 8px' }}>Picture book — hard covers, built-in controls</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        Pictures are HTML <code>&lt;img alt&gt;</code>. <code>controls=&quot;visible&quot;</code> is
        the previous/next a browse-mode screen reader can actually use. <code>hardCovers</code>{' '}
        shows the first and last leaves alone.
      </p>
      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}>
        pages {pagesLabel(book.visiblePages, book.pageCount)} · {book.orientation}
      </p>
      <HTMLFlipBook
        ref={book.ref}
        width={280}
        height={210}
        sizing="fixed"
        flippingTime={500}
        controls="visible"
        pageBackground="#f4ecd8"
        {...book.bookProps}
        style={{ maxWidth: 560 }}
        aria-label="Picture book"
      >
        {pages.map((p) => (
          <div key={p.alt} style={leafRoot}>
            <img
              src={p.src}
              alt={p.alt}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
      </HTMLFlipBook>
    </section>
  );
}

function InteractiveBook() {
  const book = usePageFlip(0);
  const [state, setState] = useState<PageState>('read');
  const [rtl, setRtl] = useState(false);

  const onChangeState = useCallback((info: { state: PageState }) => {
    setState(info.state);
  }, []);

  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ margin: '0 0 8px' }}>Your own chrome — RTL, goToPage</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        <code>usePageFlip</code> is uncontrolled. Spread <code>bookProps</code>, never pass{' '}
        <code>page={'{book.page}'}</code>. RTL inverts turn direction only — the fold still follows
        the finger.
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
          Go to leaf 3
        </button>
        <button type="button" onClick={() => setRtl((v) => !v)} aria-pressed={rtl}>
          RTL: {rtl ? 'on' : 'off'}
        </button>
      </div>
      <p
        data-demo-status=""
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}
      >
        pages {pagesLabel(book.visiblePages, book.pageCount)} · {state} · rejected{' '}
        {book.lastRejection ? book.lastRejection.reason : '—'}
      </p>
      <HTMLFlipBook
        ref={book.ref}
        width={280}
        height={360}
        sizing="fixed"
        flippingTime={400}
        readingDirection={rtl ? 'rtl' : 'ltr'}
        controls="none"
        {...book.bookProps}
        onChangeState={onChangeState}
        style={{ maxWidth: 560 }}
        aria-label="Interactive HTML flipbook"
      >
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

function ControlledBook() {
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  return (
    <section>
      <h2 style={{ margin: '0 0 8px' }}>Controlled page — resume / deep link</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        Own <code>page</code> and <code>onPageChange</code>. Do not use <code>usePageFlip</code>{' '}
        here. <code>pageTransition=&quot;instant&quot;</code> is the deep-link path; omit it to
        animate.
      </p>
      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}>
        controlled leaf {page + 1} of {pageCount}
      </p>
      <HTMLFlipBook
        width={280}
        height={200}
        sizing="fixed"
        flippingTime={400}
        page={page}
        pageTransition="instant"
        onPageChange={(snapshot) => {
          setPage(snapshot.page);
          setPageCount(snapshot.pageCount);
        }}
        onLoaded={(snapshot) => {
          setPage(snapshot.page);
          setPageCount(snapshot.pageCount);
        }}
        controls="visible"
        style={{ maxWidth: 560 }}
        aria-label="Controlled flipbook"
      >
        <div style={leafRoot}>
          <div style={leafInner('#fde68a')}>A</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#bfdbfe')}>B</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#bbf7d0')}>C</div>
        </div>
        <div style={leafRoot}>
          <div style={leafInner('#fecaca')}>D</div>
        </div>
      </HTMLFlipBook>
    </section>
  );
}

function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>@gullabs/react-flipbook</h1>
      <PictureBook />
      <InteractiveBook />
      <ControlledBook />
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
